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

function replayChannel(dataRoot, secret, options = {}) {
    const json = Boolean(options.json);
    const initialState = json ? '{}' : '';
    const file = historyPath(dataRoot, secret.channel);
    if (!fs.existsSync(file)) throw new Error(`Missing channel history: ${file}`);
    if (!secret.keys || !secret.keys.cryptKey) throw new Error(`No decryption key for channel ${secret.channel}`);

    const cryptor = Crypto.createEncryptor(secret.keys);
    const config = { initialState, logLevel: 0 };
    if (json) {
        config.patchTransformer = ChainPad.SmartJSONTransformer;
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
    const records = readHistoryMessages(file, secret.channel);
    let verified = 0;

    records.forEach((record) => {
        const ciphertext = removeCheckpointPrefix(record.ciphertext);
        let plaintext;
        try {
            // Unlike the browser history path, offline recovery verifies the
            // attached Ed25519 signature as well as the secretbox authenticator.
            plaintext = cryptor.decrypt(ciphertext, secret.keys.validateKey, false);
        } catch (err) {
            throw new Error(`${file}:${record.line}: message authentication failed: ${err.message}`);
        }
        if (typeof plaintext !== 'string') {
            throw new Error(`${file}:${record.line}: message signature verification failed`);
        }
        realtime.message(removeLegacyBencode(plaintext));
        verified += 1;
    });

    return {
        channel: secret.channel,
        file,
        messageCount: verified,
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
        const replay = replayChannel(dataRoot, driveSecret, { json: true });
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
    return items.sort((a, b) => a.path.localeCompare(b.path));
}

function recoverCodeDocument(dataRoot, entry) {
    if (!entry || entry.type !== 'code') throw new Error('Entry is not a Code document');
    const href = entry.item.href || entry.item.roHref;
    const parsed = Hash.parsePadUrl(href);
    if (!parsed || !parsed.hash) throw new Error(`Invalid document capability for ${entry.path}`);
    const secret = Hash.getSecrets(parsed.type, parsed.hash, entry.item.password);
    if (entry.channel && secret.channel !== entry.channel) {
        throw new Error(`Derived channel does not match drive metadata for ${entry.path}`);
    }
    const replay = replayChannel(dataRoot, secret, { json: false });
    let state;
    try {
        state = JSON.parse(replay.document);
    } catch (err) {
        throw new Error(`Replayed Code state is not valid JSON for ${entry.path}: ${err.message}`);
    }
    if (typeof state.content !== 'string') throw new Error(`Code state has no text content: ${entry.path}`);
    return { entry, secret, replay, state, content: state.content };
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
    deriveBytes,
    allocateBlockKeys,
    locateBlock,
    decryptAccountBlock,
    replayChannel,
    recoverAccount,
    enumerateDrive,
    recoverCodeDocument,
    recoverUploadedFile,
};
