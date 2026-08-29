'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
    recoverAccount,
    enumerateDrive,
    documentTransformer,
    documentInitialState,
    recoverDocument,
    recoverCodeDocument,
    recoverUploadedFile,
    resolveDefaultDataRoot,
} = require('../src/recovery');
const { exportDocument } = require('../src/exporters');

const DATA_ROOT = path.resolve(__dirname, '..', 'testdata', 'encrypted-phase4');
const EXPECTED_ROOT = path.resolve(__dirname, '..', 'fixtures', 'expected');

function makeCryptPadDataRoot(root) {
    ['block', 'datastore', 'blob'].forEach((store) => fs.mkdirSync(path.join(root, store), { recursive: true }));
}
const USERNAME = 'recovery-fixture-20260828';

test('application replay modes match the CryptPad 5.1.0 frameworks', () => {
    assert.strictEqual(documentTransformer('pad'), 'naive');
    assert.strictEqual(documentTransformer('whiteboard'), 'naive');
    ['code', 'slide', 'kanban', 'form', 'poll', 'calendar', 'sheet', 'doc', 'presentation']
        .forEach((type) => assert.strictEqual(documentTransformer(type), 'smart', type));
    assert.strictEqual(documentInitialState('poll'), '{}');
    assert.strictEqual(documentInitialState('calendar'), '{}');
    assert.strictEqual(documentInitialState('pad'), '');
    assert.strictEqual(documentInitialState('sheet'), '');
});

test('enumerateDrive disambiguates duplicate drive titles', () => {
    const accountDocument = {
        drive: {
            filesData: {
                10: { title: 'Untitled', uploaded: true, channel: 'chan-a' },
                5: { title: 'Untitled', uploaded: true, channel: 'chan-b' },
                7: { title: 'Unique', uploaded: true, channel: 'chan-c' },
            },
            root: { slotA: 10, slotB: 5, slotC: 7 },
        },
    };
    const entries = enumerateDrive(accountDocument);
    const byId = new Map(entries.map((entry) => [entry.id, entry.path]));
    assert.strictEqual(byId.get('5'), 'Untitled');
    assert.strictEqual(byId.get('10'), 'Untitled (10)');
    assert.strictEqual(byId.get('7'), 'Unique');
});

test('resolveDefaultDataRoot picks the first present StartOS volume layout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptpad-default-root-test-'));
    const newRoot = path.join(root, 'startos-0.4.0');
    const oldRoot = path.join(root, 'startos-0.3.5.1');
    const candidates = [
        { path: newRoot, label: 'startos-0.4.0' },
        { path: oldRoot, label: 'startos-0.3.5.1' },
    ];

    // Neither candidate present: falls back to the newest-known candidate
    // rather than throwing, so the failure still surfaces later as a normal,
    // diagnosable recovery error instead of an upfront path guess error.
    assert.strictEqual(resolveDefaultDataRoot(candidates), candidates[0]);

    makeCryptPadDataRoot(oldRoot);
    assert.strictEqual(resolveDefaultDataRoot(candidates), candidates[1]);

    makeCryptPadDataRoot(newRoot);
    assert.strictEqual(resolveDefaultDataRoot(candidates), candidates[0]);

    fs.rmSync(root, { recursive: true, force: true });
});

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

test('offline Phase 6 recovery covers rich text, slides, kanban, and OnlyOffice history', {
    skip: !process.env.CRYPTPAD_TEST_PASSWORD,
}, async () => {
    const phase6 = path.resolve(__dirname, '..', 'testdata', 'encrypted-phase6');
    const account = await recoverAccount(phase6, USERNAME, process.env.CRYPTPAD_TEST_PASSWORD);
    const entries = enumerateDrive(account.accountDocument);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));

    assert.deepStrictEqual(entries.map((entry) => entry.path), [
        'recovery-canary-binary.bin',
        'recovery-canary-kanban',
        'recovery-canary-long.txt',
        'recovery-canary-rich-text',
        'recovery-canary-rich-text-phase6',
        'recovery-canary-sheet',
        'recovery-canary-short.txt',
        'recovery-canary-slides',
        'recovery-canary-unicode.md',
    ]);

    const pad = recoverDocument(phase6, byPath.get('recovery-canary-rich-text-phase6'));
    assert.strictEqual(pad.transformer, 'naive');
    const padExports = exportDocument('pad', pad.state);
    assert.ok(padExports[0].content.equals(
        fs.readFileSync(path.join(EXPECTED_ROOT, 'recovery-canary-rich-text-phase6.html'))
    ));

    const slide = recoverDocument(phase6, byPath.get('recovery-canary-slides'));
    const slideExports = exportDocument('slide', slide.state);
    assert.ok(slideExports[0].content.equals(
        fs.readFileSync(path.join(EXPECTED_ROOT, 'recovery-canary-slides.md'))
    ));

    const kanban = recoverDocument(phase6, byPath.get('recovery-canary-kanban'));
    const kanbanText = JSON.stringify(kanban.state.content);
    assert.match(kanbanText, /RECOVERY-FIXTURE-BOARD/);
    assert.match(kanbanText, /RECOVERY-FIXTURE-CARD café 漢字 🚀/);

    const sheet = recoverDocument(phase6, byPath.get('recovery-canary-sheet'));
    assert.ok(sheet.onlyOfficeHistory, 'sheet secondary history was not recovered');
    assert.strictEqual(sheet.onlyOfficeHistory.channel, sheet.state.content.channel);
    assert.strictEqual(sheet.onlyOfficeHistory.messageCount, 1);
    const onlyOfficeMessage = JSON.parse(sheet.onlyOfficeHistory.messages[0].plaintext);
    assert.strictEqual(onlyOfficeMessage.type, 'saveChanges');
    assert.ok(Array.isArray(onlyOfficeMessage.changes));
    assert.ok(onlyOfficeMessage.changes.length > 0);
    assert.ok(onlyOfficeMessage.changes.every((change) => typeof change.change === 'string'));

    const sheetExports = exportDocument('sheet', sheet.state, {
        onlyOfficeHistory: sheet.onlyOfficeHistory,
    });
    assert.deepStrictEqual(sheetExports.map((item) => item.suffix), [
        '.cryptpad.json',
        '.onlyoffice-history.json',
    ]);
    const historyArtifact = JSON.parse(sheetExports[1].content.toString());
    assert.strictEqual(historyArtifact.authenticatedMessageCount, 1);
    assert.strictEqual(historyArtifact.messages[0].plaintext, sheet.onlyOfficeHistory.messages[0].plaintext);
});
