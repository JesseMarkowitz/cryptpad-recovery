'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const {
    recoverAccount,
    enumerateDrive,
    recoverCodeDocument,
    recoverUploadedFile,
} = require('../src/recovery');

const DATA_ROOT = path.resolve(__dirname, '..', 'testdata', 'encrypted-phase4');
const EXPECTED_ROOT = path.resolve(__dirname, '..', 'fixtures', 'expected');
const USERNAME = 'recovery-fixture-20260828';

test('offline account, drive, and Code recovery', { skip: !process.env.CRYPTPAD_TEST_PASSWORD }, async () => {
    const account = await recoverAccount(DATA_ROOT, USERNAME, process.env.CRYPTPAD_TEST_PASSWORD);
    assert.strictEqual(account.block.User_name, USERNAME);
    assert.strictEqual(account.driveSecret.channel, 'ddab0eb00ef95debe7de77440fe425d0');

    const entries = enumerateDrive(account.accountDocument);
    assert.deepStrictEqual(entries.map((entry) => entry.path), [
        'recovery-canary-long.txt',
        'recovery-canary-short.txt',
        'recovery-canary-unicode.md',
    ]);

    entries.forEach((entry) => {
        const recovered = recoverCodeDocument(DATA_ROOT, entry);
        const expected = fs.readFileSync(path.join(EXPECTED_ROOT, entry.path));
        assert.ok(Buffer.from(recovered.content).equals(expected), entry.path);
        assert.strictEqual(
            crypto.createHash('sha256').update(recovered.content).digest('hex'),
            crypto.createHash('sha256').update(expected).digest('hex')
        );
    });
});

test('offline uploaded-file recovery', { skip: !process.env.CRYPTPAD_TEST_PASSWORD }, async () => {
    const phase5 = path.resolve(__dirname, '..', 'testdata', 'encrypted-phase5');
    const account = await recoverAccount(phase5, USERNAME, process.env.CRYPTPAD_TEST_PASSWORD);
    const entry = enumerateDrive(account.accountDocument)
        .find((candidate) => candidate.path === 'recovery-canary-binary.bin');
    assert.ok(entry);
    assert.strictEqual(entry.type, 'file');

    const recovered = recoverUploadedFile(phase5, entry);
    const expected = fs.readFileSync(path.join(EXPECTED_ROOT, entry.path));
    assert.strictEqual(recovered.chunkCount, 3);
    assert.ok(recovered.content.equals(expected));
    assert.strictEqual(
        crypto.createHash('sha256').update(recovered.content).digest('hex'),
        '9a9845aa18e177d426c70a13cd0535de112d4a4f69dbfd949aef1b59f46a28b6'
    );
});
