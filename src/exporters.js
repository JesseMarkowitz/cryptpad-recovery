'use strict';

const SAFE_PAD_TAGS = new Set([
    'A', 'ABBR', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'LI', 'OL', 'P',
    'PRE', 'S', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD',
    'TFOOT', 'TH', 'THEAD', 'TR', 'U', 'UL',
]);
const SAFE_PAD_ATTRIBUTES = new Set([
    'colspan', 'dir', 'href', 'lang', 'rowspan', 'scope', 'title',
]);

function jsonBuffer(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeLink(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (/^(https?:|mailto:|#)/i.test(trimmed)) return trimmed;
    return null;
}

function hyperJsonToHtml(node) {
    if (typeof node === 'string') return escapeHtml(node);
    if (!Array.isArray(node) || typeof node[0] !== 'string') return '';
    const originalTag = node[0].toUpperCase();
    const children = Array.isArray(node[2]) ? node[2].map(hyperJsonToHtml).join('') : '';

    if (originalTag === 'IMG') {
        const alt = node[1] && node[1].alt ? `: ${escapeHtml(node[1].alt)}` : '';
        return `<span>[Recovered image${alt}; source omitted for safe offline viewing]</span>`;
    }
    if (originalTag === 'MEDIA-TAG') {
        return '<span>[Recovered encrypted media reference; see the raw CryptPad state]</span>';
    }

    const tag = SAFE_PAD_TAGS.has(originalTag) ? originalTag.toLowerCase() : 'div';
    const attributes = node[1] && typeof node[1] === 'object' ? node[1] : {};
    const renderedAttributes = [];
    Object.entries(attributes).forEach(([name, value]) => {
        const lower = name.toLowerCase();
        if (!SAFE_PAD_ATTRIBUTES.has(lower)) return;
        if (lower === 'href') {
            const href = safeLink(value);
            if (!href) return;
            renderedAttributes.push(`href="${escapeHtml(href)}"`);
            renderedAttributes.push('rel="noreferrer noopener"');
            return;
        }
        renderedAttributes.push(`${lower}="${escapeHtml(value)}"`);
    });
    if (!SAFE_PAD_TAGS.has(originalTag)) {
        renderedAttributes.push(`data-recovered-tag="${escapeHtml(originalTag)}"`);
    }
    const attrText = renderedAttributes.length ? ` ${renderedAttributes.join(' ')}` : '';
    if (tag === 'br' || tag === 'hr') return `<${tag}${attrText}>`;
    return `<${tag}${attrText}>${children}</${tag}>`;
}

function exportPad(state) {
    if (!Array.isArray(state)) throw new Error('Rich-text Pad state is not HyperJSON');
    const body = state[0] && String(state[0]).toUpperCase() === 'BODY'
        ? (state[2] || []).map(hyperJsonToHtml).join('')
        : hyperJsonToHtml(state);
    return Buffer.from([
        '<!DOCTYPE html>',
        '<html><head><meta charset="utf-8"><title>Recovered CryptPad document</title></head>',
        `<body>${body}</body></html>`,
        '',
    ].join('\n'), 'utf8');
}

function csvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function exportPoll(state) {
    const content = state && (state.content || state.table || state);
    if (!content || !Array.isArray(content.rowsOrder) || !Array.isArray(content.colsOrder)) {
        throw new Error('Poll state has no ordered rows and columns');
    }
    const rows = [];
    rows.push([''].concat(content.colsOrder.map((id) => content.cols && content.cols[id] || 'Anonymous'), 'Total'));
    content.rowsOrder.forEach((rowId) => {
        let total = 0;
        const votes = content.colsOrder.map((columnId) => {
            const value = content.cells && content.cells[`${columnId}_${rowId}`];
            if (value === 1) total += 1;
            return value === undefined ? 3 : value;
        });
        rows.push([content.rows && content.rows[rowId] || 'Option'].concat(votes, total));
    });
    return Buffer.from(`${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`, 'utf8');
}

function primaryExport(type, state) {
    if (type === 'code') {
        if (!state || typeof state.content !== 'string') throw new Error('Code state has no text content');
        return { suffix: '', format: 'text', content: Buffer.from(state.content, 'utf8') };
    }
    if (type === 'slide') {
        if (!state || typeof state.content !== 'string') throw new Error('Slide state has no Markdown content');
        return { suffix: '.md', format: 'markdown', content: Buffer.from(state.content, 'utf8') };
    }
    if (type === 'pad') {
        return { suffix: '.html', format: 'safe-html', content: exportPad(state) };
    }
    if (type === 'kanban') {
        if (!state || !state.content || typeof state.content !== 'object') {
            throw new Error('Kanban state has no board content');
        }
        return { suffix: '.json', format: 'kanban-json', content: jsonBuffer(state.content) };
    }
    if (type === 'poll') {
        return { suffix: '.csv', format: 'poll-csv', content: exportPoll(state) };
    }
    if (type === 'whiteboard') {
        if (!state || state.content === undefined) throw new Error('Whiteboard state has no canvas content');
        return { suffix: '.fabric.json', format: 'fabric-json', content: jsonBuffer(state.content) };
    }
    return null;
}

function exportOnlyOfficeHistory(type, history) {
    if (!history) return null;
    return {
        suffix: '.onlyoffice-history.json',
        format: 'onlyoffice-authenticated-history',
        content: jsonBuffer({
            format: 'cryptpad-onlyoffice-history-v1',
            applicationType: type,
            secondaryChannel: history.channel,
            authenticatedMessageCount: history.messageCount,
            messages: history.messages.map((record) => ({
                timestamp: record.timestamp,
                plaintext: record.plaintext,
            })),
        }),
    };
}

function exportDocument(type, state, options = {}) {
    const primary = primaryExport(type, state);
    const raw = {
        suffix: '.cryptpad.json',
        format: 'cryptpad-raw-json',
        content: jsonBuffer(state),
    };
    const outputs = primary ? [primary, raw] : [raw];
    const onlyOffice = exportOnlyOfficeHistory(type, options.onlyOfficeHistory);
    if (onlyOffice) outputs.push(onlyOffice);
    return outputs;
}

module.exports = {
    escapeHtml,
    hyperJsonToHtml,
    exportPad,
    exportPoll,
    exportOnlyOfficeHistory,
    exportDocument,
};
