'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { SupportLog } = require('../src/support-log');

test('support log redacts registered values, sensitive fields, and absolute paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptpad-support-log-test-'));
    const logPath = path.join(root, 'support-log.jsonl');
    const log = new SupportLog(logPath, { version: 'test', commit: '0123456789abcdef0123456789abcdef01234567' });
    log.addSensitive('private-document-name.txt');
    log.addSensitive('example-user');
    log.event('test.event', {
        message: 'Failed private-document-name.txt for example-user at /private/data/private-document-name.txt',
        username: 'example-user',
        password: 'do-not-record',
        content: 'do-not-record-file-data',
        safeDiagnostic: 'retained',
    });
    log.close('success');

    const contents = fs.readFileSync(logPath, 'utf8');
    assert.ok(!contents.includes('private-document-name.txt'));
    assert.ok(!contents.includes('example-user'));
    assert.ok(!contents.includes('do-not-record'));
    assert.ok(!contents.includes('do-not-record-file-data'));
    assert.ok(!contents.includes('/private/data'));
    assert.ok(contents.includes('retained'));
    assert.ok(contents.includes('0123456789abcdef0123456789abcdef01234567'));
    fs.rmSync(root, { recursive: true, force: true });
});

test('standalone CLI log excludes fixture credentials, names, data, and capabilities', {
    skip: !process.env.CRYPTPAD_TEST_PASSWORD,
}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptpad-cli-log-test-'));
    const output = path.join(root, 'session');
    const username = 'recovery-fixture-20260828';
    const result = childProcess.spawnSync(process.execPath, [
        path.resolve(__dirname, '..', 'bin', 'cryptpad-recover.js'),
        '--data', path.resolve(__dirname, '..', 'testdata', 'encrypted-phase6'),
        '--output', output,
        '--no-archive',
    ], {
        input: `${username}\n${process.env.CRYPTPAD_TEST_PASSWORD}\n`,
        encoding: 'utf8',
        env: process.env,
    });
    assert.strictEqual(result.status, 0, result.stderr);

    const contents = fs.readFileSync(path.join(output, 'support-log.jsonl'), 'utf8');
    const forbidden = [
        username,
        process.env.CRYPTPAD_TEST_PASSWORD,
        'recovery-canary-short.txt',
        'recovery-canary-unicode.md',
        'recovery-canary-long.txt',
        'recovery-canary-binary.bin',
        'recovery-canary-kanban',
        'recovery-canary-rich-text',
        'recovery-canary-rich-text-phase6',
        'recovery-canary-sheet',
        'recovery-canary-slides',
        'RECOVERY-FIXTURE-SHORT',
        'RECOVERY-FIXTURE-BOARD',
        'RECOVERY-FIXTURE-RICH-TEXT',
        'ddab0eb00ef95debe7de77440fe425d0',
        '47fa80fe5b7b6d8f4964061efddc45cfb5be91b7e4635e19',
        'ed40473126148ba4384062c11b7ce2e3',
    ];
    forbidden.forEach((value) => assert.ok(!contents.includes(value), `support log leaked ${value}`));
    assert.ok(contents.includes('item.recover'));
    assert.ok(contents.includes('verifiedMessages'));
    assert.ok(contents.includes('verifiedSecondaryMessages'));
    assert.ok(contents.includes('verifiedChunks'));
    fs.rmSync(root, { recursive: true, force: true });
});

test('failed account recovery produces a useful log without credential leakage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptpad-cli-failure-log-test-'));
    const output = path.join(root, 'session');
    const username = 'recovery-fixture-20260828';
    const rejectedPassword = 'intentionally-incorrect-test-password';
    const result = childProcess.spawnSync(process.execPath, [
        path.resolve(__dirname, '..', 'bin', 'cryptpad-recover.js'),
        '--data', path.resolve(__dirname, '..', 'testdata', 'encrypted-phase5'),
        '--output', output,
        '--no-archive',
    ], {
        input: `${username}\n${rejectedPassword}\n`,
        encoding: 'utf8',
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /ACCOUNT_BLOCK_NOT_FOUND/);

    const contents = fs.readFileSync(path.join(output, 'support-log.jsonl'), 'utf8');
    assert.ok(contents.includes('ACCOUNT_BLOCK_NOT_FOUND'));
    assert.ok(contents.includes('session.failure'));
    assert.ok(!contents.includes(username));
    assert.ok(!contents.includes(rejectedPassword));
    assert.ok(!contents.includes('/embassy-data'));
    assert.ok(!contents.includes(path.resolve(__dirname, '..')));
    fs.rmSync(root, { recursive: true, force: true });
});
