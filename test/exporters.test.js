'use strict';

const assert = require('assert');
const test = require('node:test');
const {
    hyperJsonToHtml,
    exportPad,
    exportPoll,
    exportDocument,
} = require('../src/exporters');

test('rich-text HyperJSON export preserves safe structure and blocks active content', () => {
    const state = ['BODY', {}, [
        ['H1', {}, ['Recovery heading']],
        ['P', {}, ['Unicode: café 漢字 🚀']],
        ['A', { href: 'https://example.com/', onclick: 'alert(1)' }, ['safe link']],
        ['A', { href: 'javascript:alert(1)' }, ['unsafe link']],
        ['IMG', { src: 'https://tracker.invalid/pixel', alt: 'fixture image' }, []],
        ['SCRIPT', {}, ['alert(1)']],
    ]];
    const html = exportPad(state).toString('utf8');
    assert.match(html, /<h1>Recovery heading<\/h1>/);
    assert.match(html, /Unicode: café 漢字 🚀/);
    assert.match(html, /href="https:\/\/example\.com\/"/);
    assert.ok(!html.includes('onclick'));
    assert.ok(!html.includes('javascript:'));
    assert.ok(!html.includes('tracker.invalid'));
    assert.ok(!html.includes('<script'));
    assert.match(html, /data-recovered-tag="SCRIPT"/);
    assert.match(hyperJsonToHtml('a < b & c'), /a &lt; b &amp; c/);
});

test('poll export emits ordered quoted CSV with totals', () => {
    const state = { content: {
        rowsOrder: ['r1', 'r2'],
        colsOrder: ['c1', 'c2'],
        rows: { r1: 'Yes', r2: 'No, maybe' },
        cols: { c1: 'Alice', c2: 'Bob "B"' },
        cells: { c1_r1: 1, c2_r1: 2, c1_r2: 1 },
    } };
    const csv = exportPoll(state).toString('utf8');
    assert.strictEqual(csv,
        '"","Alice","Bob ""B""","Total"\n' +
        '"Yes","1","2","1"\n' +
        '"No, maybe","1","3","1"\n');
});

test('every document export includes lossless raw state', () => {
    const state = { content: '# Slide\n\nHello', metadata: { title: 'fixture' } };
    const outputs = exportDocument('slide', state);
    assert.deepStrictEqual(outputs.map((item) => item.suffix), ['.md', '.cryptpad.json']);
    assert.strictEqual(outputs[0].content.toString(), state.content);
    assert.deepStrictEqual(JSON.parse(outputs[1].content.toString()), state);

    const unknown = exportDocument('sheet', { content: { cells: [] } });
    assert.deepStrictEqual(unknown.map((item) => item.suffix), ['.cryptpad.json']);
});

test('OnlyOffice export preserves authenticated secondary messages verbatim', () => {
    const plaintext = '{"type":"saveChanges","changes":[{"change":"opaque-patch"}]}';
    const outputs = exportDocument('sheet', { content: { channel: 'secondary' } }, {
        onlyOfficeHistory: {
            channel: 'secondary',
            messageCount: 1,
            messages: [{ timestamp: 1234, plaintext }],
        },
    });
    assert.deepStrictEqual(outputs.map((item) => item.suffix), [
        '.cryptpad.json',
        '.onlyoffice-history.json',
    ]);
    const artifact = JSON.parse(outputs[1].content.toString());
    assert.strictEqual(artifact.format, 'cryptpad-onlyoffice-history-v1');
    assert.strictEqual(artifact.authenticatedMessageCount, 1);
    assert.strictEqual(artifact.messages[0].plaintext, plaintext);
});
