#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const {
    recoverAccount,
    enumerateDrive,
    recoverDocument,
    recoverUploadedFile,
    DEFAULT_DATA_ROOTS,
    resolveDefaultDataRoot,
} = require('../src/recovery');
const { exportDocument } = require('../src/exporters');
const { SupportLog, errorCode } = require('../src/support-log');

function usage(stream = process.stdout) {
    stream.write([
        'Usage: cryptpad-recover [--data DATA_ROOT] [--output DIRECTORY] [--no-archive]',
        '',
        'CryptPad username and password are always read from prompts, never arguments.',
        'Default encrypted data (first present wins):',
        ...DEFAULT_DATA_ROOTS.map((candidate) => `  ${candidate.path}  (${candidate.label})`),
        'Default output: a new timestamped directory in the current directory.',
        '',
    ].join('\n'));
}

function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--data' || arg === '--output') {
            if (!argv[i + 1]) throw new Error(`${arg} requires a value`);
            options[arg.slice(2)] = argv[++i];
        } else if (arg === '--no-archive') {
            options.archive = false;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function sessionName(now = new Date()) {
    const suffix = crypto.randomBytes(3).toString('hex');
    return `cryptpad-recovery-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${suffix}`;
}

function readBuildInfo() {
    const candidates = [
        path.resolve(__dirname, '..', 'BUILD_INFO.json'),
        path.resolve(__dirname, '..', 'package.json'),
    ];
    for (const candidate of candidates) {
        try {
            return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        } catch (_) {
            // Development checkouts do not have generated release metadata.
        }
    }
    return {};
}

function createCredentialReader() {
    if (!process.stdin.isTTY) {
        const values = fs.readFileSync(0, 'utf8').split(/\r?\n/);
        let index = 0;
        return async (prompt) => {
            process.stderr.write(prompt);
            const value = values[index++] || '';
            process.stderr.write('\n');
            return value;
        };
    }

    return (prompt, hidden = false) => new Promise((resolve, reject) => {
        if (!hidden) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
            rl.question(prompt, (answer) => {
                rl.close();
                resolve(answer);
            });
            return;
        }

        let value = '';
        const input = process.stdin;
        const wasRaw = input.isRaw;
        process.stderr.write(prompt);
        input.setRawMode(true);
        input.resume();
        input.setEncoding('utf8');
        const finish = () => {
            input.removeListener('data', onData);
            input.setRawMode(Boolean(wasRaw));
            input.pause();
            process.stderr.write('\n');
        };
        const onData = (chunk) => {
            for (const character of chunk) {
                if (character === '\u0003') {
                    finish();
                    reject(Object.assign(new Error('Interrupted'), { code: 'INTERRUPTED' }));
                    return;
                }
                if (character === '\r' || character === '\n') {
                    finish();
                    resolve(value);
                    return;
                }
                if (character === '\u007f' || character === '\b') {
                    value = value.slice(0, -1);
                    continue;
                }
                value += character;
            }
        };
        input.on('data', onData);
    });
}

function safeOutputPath(root, logicalPath) {
    const parts = logicalPath.split('/').filter(Boolean).map((part) => {
        const cleaned = part.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
        return cleaned === '.' || cleaned === '..' ? `_${cleaned}_` : cleaned;
    });
    if (!parts.length) throw Object.assign(new Error('Recovered item has no usable output path'), { code: 'UNSAFE_OUTPUT_PATH' });
    const output = path.resolve(root, ...parts);
    const resolvedRoot = `${path.resolve(root)}${path.sep}`;
    if (!output.startsWith(resolvedRoot)) {
        throw Object.assign(new Error('Recovered item resolved outside the output directory'), { code: 'UNSAFE_OUTPUT_PATH' });
    }
    return output;
}

function appendSuffix(logicalPath, suffix) {
    if (!suffix) return logicalPath;
    if (logicalPath.toLowerCase().endsWith(suffix.toLowerCase()) && suffix !== '.cryptpad.json') {
        return logicalPath;
    }
    return `${logicalPath}${suffix}`;
}

function writeDocumentExports(filesRoot, entry, exports) {
    const targets = exports.map((item) => ({
        ...item,
        output: safeOutputPath(filesRoot, appendSuffix(entry.path, item.suffix)),
    }));
    targets.forEach((target) => {
        if (fs.existsSync(target.output)) {
            throw Object.assign(new Error('A recovered output destination already exists'), {
                code: 'OUTPUT_ALREADY_EXISTS',
            });
        }
    });
    targets.forEach((target) => {
        fs.mkdirSync(path.dirname(target.output), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target.output, target.content, { flag: 'wx', mode: 0o600 });
    });
    return targets;
}

function inspectDataRoot(dataRoot) {
    const stores = ['block', 'datastore', 'blob'];
    return stores.reduce((result, store) => {
        const candidate = path.join(dataRoot, store);
        try {
            const stat = fs.statSync(candidate);
            fs.accessSync(candidate, fs.constants.R_OK);
            result[store] = { exists: true, directory: stat.isDirectory(), readable: true };
        } catch (error) {
            result[store] = { exists: false, directory: false, readable: false, errorCode: error.code || 'ERROR' };
        }
        return result;
    }, {});
}

function readStartOsVersion() {
    try {
        return fs.readFileSync('/usr/lib/startos/VERSION.txt', 'utf8').trim();
    } catch (_) {
        return null;
    }
}

function sha256(file) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    return hash.digest('hex');
}

function createArchive(filesRoot, sessionRoot, log) {
    const archivePath = `${sessionRoot}.tar.gz`;
    if (fs.existsSync(archivePath) || fs.existsSync(`${archivePath}.sha256`)) {
        const error = Object.assign(new Error('Recovery archive destination already exists'), {
            code: 'OUTPUT_ALREADY_EXISTS',
        });
        log.error('archive.finish', error);
        return null;
    }
    // Reserve the name without overwriting anything. tar replaces only this
    // zero-byte file created by the current recovery session.
    fs.closeSync(fs.openSync(archivePath, 'wx', 0o600));
    const result = childProcess.spawnSync('tar', [
        '-czf', archivePath,
        '-C', path.dirname(filesRoot),
        path.basename(filesRoot),
    ], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
        const error = result.error || Object.assign(new Error('tar failed while creating the recovery archive'), {
            code: 'ARCHIVE_FAILED',
        });
        log.error('archive.finish', error, { status: result.status, stderrPresent: Boolean(result.stderr) });
        return null;
    }
    fs.chmodSync(archivePath, 0o600);
    const digest = sha256(archivePath);
    fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`, { flag: 'wx', mode: 0o600 });
    log.event('archive.finish', { outcome: 'success', bytes: fs.statSync(archivePath).size });
    return archivePath;
}

function printCopyInstructions(archivePath, logPath) {
    const user = process.env.SUDO_USER || os.userInfo().username || 'start9';
    process.stdout.write([
        '',
        'Copy the recovered-files archive from a terminal on your other computer:',
        `  scp ${user}@YOUR_STARTOS_HOST:${JSON.stringify(archivePath)} .`,
        `  scp ${user}@YOUR_STARTOS_HOST:${JSON.stringify(`${archivePath}.sha256`)} .`,
        '',
        'If support is needed, send only this diagnostic log (it contains no passwords, filenames, or file data):',
        `  scp ${user}@YOUR_STARTOS_HOST:${JSON.stringify(logPath)} .`,
        '',
        'Do not send the recovered-files archive for diagnostics; it contains recovered private data.',
    ].join('\n') + '\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        usage();
        return;
    }

    const defaultDataRoot = options.data ? null : resolveDefaultDataRoot();
    const dataRoot = path.resolve(options.data || defaultDataRoot.path);
    const outputBase = path.resolve(options.output || process.cwd());
    const sessionRoot = options.output ? outputBase : path.join(outputBase, sessionName());
    const filesRoot = path.join(sessionRoot, 'recovered-files');
    const logPath = path.join(sessionRoot, 'support-log.jsonl');
    fs.mkdirSync(path.dirname(sessionRoot), { recursive: true, mode: 0o700 });
    fs.mkdirSync(sessionRoot, { mode: 0o700 });
    fs.mkdirSync(filesRoot, { mode: 0o700 });

    const log = new SupportLog(logPath, readBuildInfo());
    log.addSensitive(dataRoot);
    log.addSensitive(sessionRoot);
    let password = '';
    let recoveredCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let archivePath = null;

    try {
        log.event('environment.inspect', {
            startOsVersion: readStartOsVersion(),
            dataRootKind: options.data ? 'custom' : 'startos-default',
            dataRootDefaultLabel: defaultDataRoot && defaultDataRoot.label,
            outputKind: options.output ? 'custom' : 'timestamped-default',
            stores: inspectDataRoot(dataRoot),
        });

        const readCredential = createCredentialReader();
        const username = await readCredential('CryptPad username: ');
        password = await readCredential('CryptPad password: ', true);
        log.addSensitive(username);
        log.event('credentials.received', {
            inputMode: process.stdin.isTTY ? 'interactive-terminal' : 'standard-input',
        });

        if (!username || !password) {
            throw Object.assign(new Error('Both CryptPad username and password are required'), { code: 'CREDENTIALS_REQUIRED' });
        }

        log.event('account.recover', { stage: 'start' });
        const account = await recoverAccount(dataRoot, username, password);
        password = '';
        log.addSensitive(account.blockPath);
        log.addSensitive(account.driveSecret.channel);
        log.event('account.recover', {
            stage: 'finish',
            outcome: 'success',
            verifiedDriveMessages: account.driveReplay.messageCount,
        });

        const entries = enumerateDrive(account.accountDocument);
        const totalsByType = entries.reduce((totals, entry) => {
            totals[entry.type] = (totals[entry.type] || 0) + 1;
            return totals;
        }, {});
        log.event('drive.enumerate', { outcome: 'success', itemCount: entries.length, totalsByType });
        process.stdout.write(`Found ${entries.length} drive items. Recovering supported items...\n`);

        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index];
            const itemId = `item-${String(index + 1).padStart(6, '0')}`;
            log.addSensitive(entry.path);
            log.addSensitive(entry.channel);
            log.event('item.recover', { stage: 'start', itemId, type: entry.type, namespace: entry.namespace });

            try {
                let recovered;
                if (entry.type === 'file') {
                    recovered = recoverUploadedFile(dataRoot, entry);
                } else {
                    recovered = recoverDocument(dataRoot, entry);
                }

                log.addSensitive(recovered.secret && recovered.secret.channel);
                let outputCount;
                let totalBytes;
                let formats;
                if (entry.type === 'file') {
                    const output = safeOutputPath(filesRoot, entry.path);
                    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
                    fs.writeFileSync(output, recovered.content, { flag: 'wx', mode: 0o600 });
                    outputCount = 1;
                    totalBytes = recovered.content.length;
                    formats = ['uploaded-file'];
                } else {
                    if (recovered.onlyOfficeHistory) {
                        log.addSensitive(recovered.onlyOfficeHistory.channel);
                        log.addSensitive(recovered.onlyOfficeHistory.file);
                    }
                    const documentExports = exportDocument(entry.type, recovered.state, {
                        onlyOfficeHistory: recovered.onlyOfficeHistory,
                    });
                    const written = writeDocumentExports(filesRoot, entry, documentExports);
                    outputCount = written.length;
                    totalBytes = written.reduce((sum, item) => sum + item.content.length, 0);
                    formats = written.map((item) => item.format);
                }
                recoveredCount += 1;
                log.event('item.recover', {
                    stage: 'finish',
                    itemId,
                    type: entry.type,
                    outcome: 'success',
                    outputCount,
                    bytes: totalBytes,
                    formats,
                    verifiedMessages: recovered.replay && recovered.replay.messageCount,
                    verifiedSecondaryMessages: recovered.onlyOfficeHistory && recovered.onlyOfficeHistory.messageCount,
                    verifiedChunks: recovered.chunkCount,
                });
                process.stdout.write(`[${index + 1}/${entries.length}] Recovered ${entry.type} item (${outputCount} output file${outputCount === 1 ? '' : 's'}).\n`);
            } catch (error) {
                failedCount += 1;
                log.error('item.recover', error, { stage: 'finish', itemId, type: entry.type });
                process.stderr.write(`[${index + 1}/${entries.length}] Failed ${entry.type} item (${errorCode(error)}).\n`);
            }
        }

        if (options.archive !== false && recoveredCount > 0) {
            log.event('archive.create', { stage: 'start', recoveredItemCount: recoveredCount });
            archivePath = createArchive(filesRoot, sessionRoot, log);
            if (!archivePath) failedCount += 1;
        }

        const outcome = failedCount > 0 || skippedCount > 0 ? 'partial' : 'success';
        log.close(outcome, { recoveredCount, failedCount, skippedCount });
        process.stdout.write(`Recovery ${outcome}: ${recoveredCount} recovered, ${failedCount} failed, ${skippedCount} skipped.\n`);
        process.stdout.write(`Support log: ${logPath}\n`);
        if (archivePath) {
            process.stdout.write(`Recovered-files archive: ${archivePath}\n`);
            printCopyInstructions(archivePath, logPath);
        } else {
            process.stdout.write(`Recovered files directory: ${filesRoot}\n`);
        }
        if (outcome !== 'success') process.exitCode = 1;
    } catch (error) {
        password = '';
        log.error('session.failure', error);
        log.close('failure', { recoveredCount, failedCount, skippedCount });
        process.stderr.write(`Recovery failed (${errorCode(error)}). See the support log for diagnostic details.\n`);
        process.stderr.write(`Support log: ${logPath}\n`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    process.stderr.write(`Recovery could not start (${errorCode(error)}): ${error.message}\n`);
    process.exitCode = 1;
});
