'use strict';

const fs = require('fs');
const path = require('path');

const VENDOR_ROOT = path.resolve(__dirname, '..', 'vendor', 'cryptpad-5.1.0');
const Cred = require(path.join(VENDOR_ROOT, 'www/common/common-credential.js'));
const Hash = require(path.join(VENDOR_ROOT, 'www/common/common-hash.js'));
const Crypto = require(path.join(VENDOR_ROOT, 'www/bower_components/chainpad-crypto/crypto.js'));
const ChainPad = require(path.join(VENDOR_ROOT, 'www/bower_components/chainpad/chainpad.dist.js'));
const Nacl = require(path.join(VENDOR_ROOT, 'node_modules/tweetnacl/nacl-fast.js'));

const REQUIRED_DERIVED_BYTES = 192;

function deriveBytes(username, password) {
    return new Promise((resolve, reject) => {
        try {
            Cred.deriveFromPassphrase(username, password, REQUIRED_DERIVED_BYTES, (bytes) => {
                resolve(new Uint8Array(bytes));
            });
        } catch (err) {
            reject(err);
        }
    });
}

function safeAccountPublicKey(publicKey) {
    return Nacl.util.encodeBase64(publicKey).replace(/\//g, '-');
}

function allocateBlockKeys(derivedBytes) {
    // customize.dist/login.js:allocateBytes consumes 98 bytes before the
    // 64-byte login-block seed (32-byte Ed25519 seed + 32-byte secretbox key).
    const seed = derivedBytes.subarray(98, 162);
    return {
        sign: Nacl.sign.keyPair.fromSeed(seed.subarray(0, Nacl.sign.seedLength)),
        symmetric: seed.subarray(Nacl.sign.seedLength, 64),
    };
}

// The CryptPad package's persistent-volume mount point has moved across
// StartOS releases even though the volume's own internal layout (block/,
// datastore/, blob/) has not. Newest first: StartOS 0.4.0 moved package data
// under /media/startos/data; 0.3.5.1 and earlier used /embassy-data.
const DEFAULT_DATA_ROOTS = [
    { path: '/media/startos/data/package-data/volumes/cryptpad/data', label: 'startos-0.4.0' },
    { path: '/embassy-data/package-data/volumes/cryptpad/data', label: 'startos-0.3.5.1' },
];

function looksLikeCryptPadDataRoot(root) {
    return ['block', 'datastore', 'blob'].every((store) => {
        try {
            return fs.statSync(path.join(root, store)).isDirectory();
        } catch (_) {
            return false;
        }
    });
}

// Returns the first candidate whose volume layout is actually present, so a
// StartOS upgrade that relocates the mount point does not require a manual
// --data override. Falls back to the newest-known candidate (rather than
// throwing) so a missing path still surfaces as a normal, diagnosable
// ACCOUNT_BLOCK_NOT_FOUND / ENOENT failure instead of an upfront guess error.
function resolveDefaultDataRoot(candidates = DEFAULT_DATA_ROOTS) {
    return candidates.find((candidate) => looksLikeCryptPadDataRoot(candidate.path)) || candidates[0];
}

function locateBlock(dataRoot, blockKeys) {
    const publicKey = safeAccountPublicKey(blockKeys.sign.publicKey);
    return path.join(path.resolve(dataRoot), 'block', publicKey.slice(0, 2), publicKey);
}

function decryptAccountBlock(blockPath, blockKeys) {
    const raw = new Uint8Array(fs.readFileSync(blockPath));
    if (raw.length < 1 + Nacl.secretbox.nonceLength + Nacl.secretbox.overheadLength) {
        throw new Error(`Account block is too short: ${blockPath}`);
    }
    const nonce = raw.subarray(1, 1 + Nacl.secretbox.nonceLength);
    const box = raw.subarray(1 + Nacl.secretbox.nonceLength);
    const plaintext = Nacl.secretbox.open(box, nonce, blockKeys.symmetric);
    if (!plaintext) {
        throw new Error('Account block authentication failed (wrong credentials or corrupt block)');
    }
    try {
        return JSON.parse(Nacl.util.encodeUTF8(plaintext));
    } catch (err) {
        throw new Error(`Decrypted account block is not valid JSON: ${err.message}`);
    }
}

function historyPath(dataRoot, channel) {
    return path.join(path.resolve(dataRoot), 'datastore', channel.slice(0, 2), `${channel}.ndjson`);
}

function removeCheckpointPrefix(ciphertext) {
    // chainpad-netflux 1.0.0:removeCp
    return ciphertext.replace(/^cp\|([A-Za-z0-9+\/=]{0,20}\|)?/, '');
}

function removeLegacyBencode(message) {
    // chainpad-netflux 1.0.0:unBencode
    return message.replace(/^\d+:/, '');
}

function readHistoryMessages(file, channel) {
    const text = fs.readFileSync(file, 'utf8');
    const messages = [];
    text.split('\n').forEach((line, index) => {
        if (!line) return;
        let record;
        try {
            record = JSON.parse(line);
        } catch (err) {
            throw new Error(`${file}:${index + 1}: invalid JSON: ${err.message}`);
        }
        if (!Array.isArray(record) || record[3] !== channel || typeof record[4] !== 'string') return;
        messages.push({ ciphertext: record[4], timestamp: record[5], line: index + 1 });
    });
    return messages;
}

function decryptHistoryMessages(dataRoot, secret, channel = secret.channel) {
    const file = historyPath(dataRoot, channel);
    if (!fs.existsSync(file)) throw new Error(`Missing channel history: ${file}`);
    if (!secret.keys || !secret.keys.cryptKey) throw new Error(`No decryption key for channel ${channel}`);
    const cryptor = Crypto.createEncryptor(secret.keys);
    const records = readHistoryMessages(file, channel);
    return {
        channel,
        file,
        messages: records.map((record) => {
            const ciphertext = removeCheckpointPrefix(record.ciphertext);
            let plaintext;
            try {
                plaintext = cryptor.decrypt(ciphertext, secret.keys.validateKey, false);
            } catch (err) {
                throw new Error(`${file}:${record.line}: message authentication failed: ${err.message}`);
            }
            if (typeof plaintext !== 'string') {
                throw new Error(`${file}:${record.line}: message signature verification failed`);
            }
            return {
                plaintext,
                timestamp: record.timestamp,
                line: record.line,
            };
        }),
    };
}

function replayChannel(dataRoot, secret, options = {}) {
    const transformer = options.transformer || (options.json ? 'smart' : 'text');
    if (!['text', 'smart', 'naive'].includes(transformer)) {
        throw new Error(`Unsupported replay transformer: ${transformer}`);
    }
    const json = transformer !== 'text';
    const initialState = options.initialState === undefined ? '' : options.initialState;
    const config = { initialState, logLevel: 0 };
    if (json) {
        config.patchTransformer = transformer === 'smart'
            ? ChainPad.SmartJSONTransformer
            : ChainPad.NaiveJSONTransformer;
        config.validateContent = (content) => {
            try {
                JSON.parse(content);
                return true;
            } catch (_) {
                return false;
            }
        };
    }
    const realtime = ChainPad.create(config);
    const decrypted = decryptHistoryMessages(dataRoot, secret);
    const file = decrypted.file;
    let verified = 0;

    decrypted.messages.forEach((record) => {
        realtime.message(removeLegacyBencode(record.plaintext));
        verified += 1;
    });

    return {
        channel: secret.channel,
        file,
        messageCount: verified,
        transformer,
        document: realtime.getUserDoc(),
    };
}

async function recoverAccount(dataRoot, username, password) {
    if (typeof username !== 'string' || !username) throw new Error('Username is required');
    if (typeof password !== 'string' || !password) throw new Error('Password is required');

    // Historical login lowercases but does not trim its username input.
    const normalizedUsername = username.toLowerCase();
    const derived = await deriveBytes(normalizedUsername, password);
    const blockKeys = allocateBlockKeys(derived);
    const blockPath = locateBlock(dataRoot, blockKeys);
    try {
        if (!fs.existsSync(blockPath)) throw new Error(`Account block not found: ${blockPath}`);
        const block = decryptAccountBlock(blockPath, blockKeys);
        if (!block.User_hash) throw new Error('Decrypted account block has no User_hash');
        if (block.User_name !== normalizedUsername) {
            throw new Error('Account block username does not match supplied username');
        }

        const driveSecret = Hash.getSecrets('pad', block.User_hash);
        const replay = replayChannel(dataRoot, driveSecret, {
            transformer: 'smart',
            initialState: '{}',
        });
        let accountDocument;
        try {
            accountDocument = JSON.parse(replay.document);
        } catch (err) {
            throw new Error(`Replayed CryptDrive is not valid JSON: ${err.message}`);
        }
        return {
            normalizedUsername,
            blockPath,
            block: {
                User_name: block.User_name,
                User_hash: block.User_hash,
                edPublic: block.edPublic,
            },
            driveSecret,
            driveReplay: replay,
            accountDocument,
        };
    } finally {
        derived.fill(0);
        blockKeys.symmetric.fill(0);
        blockKeys.sign.secretKey.fill(0);
    }
}

function inferType(item) {
    const href = item.href || item.roHref;
    if (!href) return item.uploaded ? 'file' : 'unknown';
    const parsed = Hash.parsePadUrl(href);
    return parsed && parsed.type || 'unknown';
}

function enumerateDrive(accountDocument) {
    const drive = accountDocument && accountDocument.drive;
    if (!drive || typeof drive !== 'object') throw new Error('Account document has no drive object');
    const filesData = drive.filesData || {};
    const items = [];

    const walk = (node, prefix, namespace) => {
        if (!node || typeof node !== 'object') return;
        Object.entries(node).forEach(([storedName, element]) => {
            if (typeof element === 'number') {
                const item = filesData[String(element)];
                if (!item) return;
                const name = item.title || item.filename || storedName;
                items.push({
                    id: String(element),
                    path: prefix.concat(name).join('/'),
                    namespace,
                    type: inferType(item),
                    channel: item.channel,
                    item,
                });
                return;
            }
            if (element && typeof element === 'object' && !Array.isArray(element)) {
                walk(element, prefix.concat(storedName), namespace);
            }
        });
    };

    walk(drive.root || {}, [], 'drive');
    Object.entries(drive.trash || {}).forEach(([name, entries]) => {
        if (!Array.isArray(entries)) return;
        entries.forEach((entry, index) => {
            if (!entry) return;
            const base = ['__trash__', name, String(index + 1)];
            if (typeof entry.element === 'number') {
                const item = filesData[String(entry.element)];
                if (!item) return;
                items.push({
                    id: String(entry.element),
                    path: base.concat(item.title || item.filename || name).join('/'),
                    namespace: 'trash',
                    type: inferType(item),
                    channel: item.channel,
                    item,
                });
            } else {
                walk(entry.element, base, 'trash');
            }
        });
    });
    deduplicatePaths(items);
    return items.sort((a, b) => a.path.localeCompare(b.path));
}

// CryptPad drive titles are not unique: two sibling items (or an item and a
// trashed item sharing a folder name) can carry the same title, which would
// otherwise collide on the same recovery output path. Disambiguate every
// group of colliding paths by the item's stable element id, keeping output
// paths deterministic across repeated recovery runs of the same account.
function deduplicatePaths(items) {
    const groups = new Map();
    items.forEach((item) => {
        if (!groups.has(item.path)) groups.set(item.path, []);
        groups.get(item.path).push(item);
    });
    groups.forEach((group) => {
        if (group.length < 2) return;
        group
            .slice()
            .sort((a, b) => Number(a.id) - Number(b.id))
            .forEach((item, index) => {
                if (index === 0) return;
                item.path = `${item.path} (${item.id})`;
            });
    });
}

function recoverCodeDocument(dataRoot, entry) {
    if (!entry || entry.type !== 'code') throw new Error('Entry is not a Code document');
    const recovered = recoverDocument(dataRoot, entry);
    if (typeof recovered.state.content !== 'string') {
        throw new Error(`Code state has no text content: ${entry.path}`);
    }
    return { ...recovered, content: recovered.state.content };
}

function documentTransformer(type) {
    if (type === 'pad' || type === 'whiteboard') return 'naive';
    // sframe-app-framework defaults to SmartJSONTransformer for Code, Slide,
    // Kanban, Form, and OnlyOffice apps. Poll/calendar use listmap, which also
    // uses SmartJSONTransformer but starts from an explicit empty object.
    return 'smart';
}

function documentInitialState(type) {
    if (type === 'poll' || type === 'calendar') return '{}';
    return '';
}

function recoverOnlyOfficeHistory(dataRoot, secret, state, type) {
    if (!['sheet', 'doc', 'presentation'].includes(type)) return null;
    const channel = state && state.content && state.content.channel;
    if (typeof channel !== 'string' || !channel) return null;

    // sframe-common-outer.js and common/outer/onlyoffice.js load this random
    // secondary channel using the primary document's encryption/signing keys.
    const decrypted = decryptHistoryMessages(dataRoot, secret, channel);
    const messages = decrypted.messages.map((record) => {
        const plaintext = removeLegacyBencode(record.plaintext);
        try {
            JSON.parse(plaintext);
        } catch (err) {
            const error = new Error(`OnlyOffice history message is not valid JSON at record ${record.line}: ${err.message}`);
            error.code = 'INVALID_ONLYOFFICE_HISTORY';
            throw error;
        }
        return {
            timestamp: record.timestamp,
            // Keep the authenticated plaintext byte-for-byte instead of
            // reserializing it. OnlyOffice change strings are opaque binary
            // patches encoded inside this JSON message.
            plaintext,
        };
    });
    return {
        channel,
        file: decrypted.file,
        messageCount: messages.length,
        messages,
    };
}

function recoverDocument(dataRoot, entry) {
    if (!entry || entry.type === 'file') throw new Error('Entry is not a document');
    const href = entry.item.href || entry.item.roHref;
    const parsed = Hash.parsePadUrl(href);
    if (!parsed || !parsed.hash) throw new Error(`Invalid document capability for ${entry.path}`);
    const secret = Hash.getSecrets(parsed.type, parsed.hash, entry.item.password);
    if (entry.channel && secret.channel !== entry.channel) {
        throw new Error(`Derived channel does not match drive metadata for ${entry.path}`);
    }
    const transformer = documentTransformer(parsed.type);
    const replay = replayChannel(dataRoot, secret, {
        transformer,
        initialState: documentInitialState(parsed.type),
    });
    let state;
    try {
        state = JSON.parse(replay.document);
    } catch (err) {
        throw new Error(`Replayed ${entry.type} state is not valid JSON for ${entry.path}: ${err.message}`);
    }
    const onlyOfficeHistory = recoverOnlyOfficeHistory(dataRoot, secret, state, parsed.type);
    return { entry, secret, replay, state, transformer, onlyOfficeHistory };
}

function incrementFileNonce(nonce) {
    // www/file/file-crypto.js:increment intentionally leaves byte 0 alone.
    let index = nonce.length;
    while (index-- > 1) {
        if (nonce[index] !== 255) {
            nonce[index] += 1;
            return;
        }
        nonce[index] = 0;
    }
    throw new Error('File nonce exhausted');
}

function recoverUploadedFile(dataRoot, entry) {
    if (!entry || entry.type !== 'file') throw new Error('Entry is not an uploaded file');
    const href = entry.item.href || entry.item.roHref;
    const parsed = Hash.parsePadUrl(href);
    if (!parsed || !parsed.hash) throw new Error(`Invalid file capability for ${entry.path}`);
    const secret = Hash.getSecrets(parsed.type, parsed.hash, entry.item.password);
    if (entry.channel && secret.channel !== entry.channel) {
        throw new Error(`Derived blob ID does not match drive metadata for ${entry.path}`);
    }

    const file = path.join(path.resolve(dataRoot), 'blob', secret.channel.slice(0, 2), secret.channel);
    if (!fs.existsSync(file)) throw new Error(`Missing encrypted blob: ${file}`);
    const encrypted = new Uint8Array(fs.readFileSync(file));
    if (encrypted.length < 2) throw new Error(`Encrypted blob is too short: ${file}`);

    const metadataLength = (encrypted[0] << 8) | encrypted[1];
    if (metadataLength < Nacl.secretbox.overheadLength || 2 + metadataLength > encrypted.length) {
        throw new Error(`Invalid encrypted metadata length in ${file}`);
    }
    const nonce = new Uint8Array(Nacl.secretbox.nonceLength);
    const metadataBytes = Nacl.secretbox.open(
        encrypted.subarray(2, 2 + metadataLength),
        nonce,
        secret.keys.cryptKey
    );
    if (!metadataBytes) throw new Error(`Blob metadata authentication failed: ${file}`);
    incrementFileNonce(nonce);

    let metadata;
    try {
        metadata = JSON.parse(Nacl.util.encodeUTF8(metadataBytes));
    } catch (err) {
        throw new Error(`Blob metadata is not valid JSON: ${err.message}`);
    }

    const cipherChunkLength = 131088;
    const chunks = [];
    let offset = 2 + metadataLength;
    let chunkIndex = 0;
    while (offset < encrypted.length) {
        const end = Math.min(offset + cipherChunkLength, encrypted.length);
        const plaintext = Nacl.secretbox.open(
            encrypted.subarray(offset, end),
            nonce,
            secret.keys.cryptKey
        );
        if (!plaintext) throw new Error(`Blob chunk ${chunkIndex} authentication failed: ${file}`);
        chunks.push(Buffer.from(plaintext));
        incrementFileNonce(nonce);
        offset = end;
        chunkIndex += 1;
    }
    return {
        entry,
        secret,
        file,
        metadata,
        chunkCount: chunks.length,
        content: Buffer.concat(chunks),
    };
}

module.exports = {
    VENDOR_ROOT,
    DEFAULT_DATA_ROOTS,
    resolveDefaultDataRoot,
    deriveBytes,
    allocateBlockKeys,
    locateBlock,
    decryptAccountBlock,
    decryptHistoryMessages,
    replayChannel,
    recoverAccount,
    enumerateDrive,
    documentTransformer,
    documentInitialState,
    recoverOnlyOfficeHistory,
    recoverDocument,
    recoverCodeDocument,
    recoverUploadedFile,
};
