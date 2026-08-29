'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_SCHEMA_VERSION = 1;

function elapsedMilliseconds(started) {
    return Number((process.hrtime.bigint() - started) / 1000000n);
}

function errorCode(error) {
    if (error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
        return error.code;
    }
    const message = error && error.message || '';
    if (/Account block not found/.test(message)) return 'ACCOUNT_BLOCK_NOT_FOUND';
    if (/authentication failed/.test(message)) return 'AUTHENTICATION_FAILED';
    if (/signature verification failed/.test(message)) return 'SIGNATURE_VERIFICATION_FAILED';
    if (/Missing channel history/.test(message)) return 'CHANNEL_HISTORY_MISSING';
    if (/Missing encrypted blob/.test(message)) return 'ENCRYPTED_BLOB_MISSING';
    if (/not valid JSON|invalid JSON/.test(message)) return 'INVALID_JSON';
    if (/EACCES|permission denied/i.test(message)) return 'PERMISSION_DENIED';
    if (/EEXIST|already exists/i.test(message)) return 'OUTPUT_ALREADY_EXISTS';
    return 'UNEXPECTED_ERROR';
}

function normalizeStack(stack) {
    if (typeof stack !== 'string') return undefined;
    return stack
        .split('\n')
        .slice(0, 12)
        .map((line) => line.replace(/\((?:file:\/\/)?[^()]*?\/(src|bin|vendor)\//g, '($1/'))
        .join('\n');
}

class SupportLog {
    constructor(logPath, buildInfo = {}) {
        this.path = path.resolve(logPath);
        this.started = process.hrtime.bigint();
        this.sensitive = new Set();
        fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
        this.fd = fs.openSync(this.path, 'wx', 0o600);
        this.event('session.start', {
            schema: LOG_SCHEMA_VERSION,
            toolVersion: buildInfo.version || 'development',
            sourceCommit: buildInfo.commit || 'development',
            bundledNodeVersion: buildInfo.nodeVersion || null,
            runtime: {
                node: process.version,
                platform: process.platform,
                architecture: process.arch,
                kernel: os.release(),
            },
            process: {
                effectiveUserId: typeof process.geteuid === 'function' ? process.geteuid() : null,
                effectiveGroupId: typeof process.getegid === 'function' ? process.getegid() : null,
            },
        });
    }

    addSensitive(value) {
        if (typeof value === 'string' && value.length > 0) this.sensitive.add(value);
    }

    sanitizeString(value) {
        let output = value;
        Array.from(this.sensitive)
            .sort((a, b) => b.length - a.length)
            .forEach((secret) => {
                output = output.split(secret).join('<redacted>');
            });

        // Absolute paths can include CryptPad channels, blob IDs, block-key
        // filenames, user names, or document names. Retain the error and stack
        // structure but not those values.
        output = output.replace(/(?:file:\/\/)?\/(?:[^\s:'"()]+\/)+[^\s:'"()]*/g, '<path>');
        return output;
    }

    sanitize(value) {
        if (typeof value === 'string') return this.sanitizeString(value);
        if (Array.isArray(value)) return value.map((item) => this.sanitize(item));
        if (!value || typeof value !== 'object') return value;
        const result = {};
        Object.entries(value).forEach(([key, item]) => {
            if (/password|content|filename|title|username|href|channel|cryptkey|secret/i.test(key)) {
                result[key] = '<redacted-field>';
                return;
            }
            result[key] = this.sanitize(item);
        });
        return result;
    }

    event(name, details = {}) {
        const record = {
            timestamp: new Date().toISOString(),
            elapsedMs: elapsedMilliseconds(this.started),
            event: name,
            ...this.sanitize(details),
        };
        fs.writeSync(this.fd, `${JSON.stringify(record)}\n`);
    }

    error(name, error, details = {}) {
        this.event(name, {
            ...details,
            outcome: 'error',
            error: {
                code: errorCode(error),
                name: error && error.name || 'Error',
                message: error && error.message || String(error),
                errno: error && error.errno,
                syscall: error && error.syscall,
                stack: normalizeStack(error && error.stack),
            },
        });
    }

    close(outcome, details = {}) {
        if (this.fd === undefined) return;
        this.event('session.end', { outcome, ...details });
        fs.fsyncSync(this.fd);
        fs.closeSync(this.fd);
        this.fd = undefined;
    }
}

module.exports = {
    LOG_SCHEMA_VERSION,
    SupportLog,
    errorCode,
};
