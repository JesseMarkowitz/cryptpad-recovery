#!/usr/bin/env node
'use strict';

// Development-only browser fixture creator. The password is accepted only via
// CRYPTPAD_TEST_PASSWORD and is never written to disk or printed.

const BASE_URL = process.env.CRYPTPAD_TEST_URL ||
    'https://dy4sld6zjzvtegayzrpkrwjoj35nca4s7xhrjpmvl64bvt4aadiwswyd.local';
const USERNAME = process.env.CRYPTPAD_TEST_USERNAME || 'recovery-fixture-20260828';
const PLAYWRIGHT_PATHS = [
    process.env.PLAYWRIGHT_MODULE,
    '/home/jesse/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
].filter(Boolean);
const SELECTED_APPS = new Set((process.env.PHASE6_APPS || 'pad,slide,kanban,sheet')
    .split(',').map((value) => value.trim()).filter(Boolean));

const FIXTURES = {
    pad: {
        title: 'recovery-canary-rich-text-phase6',
        html: [
            '<h1>RECOVERY-FIXTURE-RICH-TEXT</h1>',
            '<p>Rich text with <strong>bold</strong>, <em>italics</em>, and Unicode: café 漢字 🚀</p>',
            '<ul><li>alpha item</li><li>beta item</li></ul>',
        ].join(''),
    },
    slide: {
        title: 'recovery-canary-slides',
        markdown: [
            '# RECOVERY-FIXTURE-SLIDES',
            '',
            'First slide with Unicode: café 漢字 🚀',
            '',
            '---',
            '',
            '## Second slide',
            '',
            '- alpha',
            '- beta',
            '',
        ].join('\n'),
    },
    kanban: {
        title: 'recovery-canary-kanban',
        board: 'RECOVERY-FIXTURE-BOARD',
        card: 'RECOVERY-FIXTURE-CARD café 漢字 🚀',
    },
    sheet: {
        title: 'recovery-canary-sheet',
    },
};

function loadPlaywright() {
    for (const candidate of PLAYWRIGHT_PATHS) {
        try {
            return require(candidate);
        } catch (_) {
            // Try the next known development installation.
        }
    }
    throw new Error('Playwright is unavailable; set PLAYWRIGHT_MODULE');
}

async function innerFrame(page, app) {
    await page.waitForFunction((name) => Array.from(document.querySelectorAll('iframe'))
        .some((iframe) => iframe.src.includes(`/${name}/inner.html`)), app, { timeout: 60000 });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const frame = page.frames().find((candidate) => candidate.url().includes(`/${app}/inner.html`));
        if (frame) return frame;
        await page.waitForTimeout(100);
    }
    throw new Error(`No inner frame for ${app}`);
}

async function waitSaved(frame) {
    await frame.getByText('Saved', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
}

async function setTitle(frame, title) {
    await frame.locator('.cp-toolbar-title-value').click();
    const input = frame.locator('.cp-toolbar-title input');
    await input.waitFor({ state: 'visible' });
    await input.fill(title);
    await input.press('Enter');
}

async function storeInDrive(frame) {
    let button = frame.locator('button:visible').filter({ hasText: /^\s*Store\s*$/ }).last();
    try {
        await button.waitFor({ state: 'visible', timeout: 15000 });
    } catch (_) {
        const toolbarStore = frame.locator('.cp-toolbar-storeindrive:visible');
        if (await toolbarStore.count()) await toolbarStore.click();
        button = frame.locator('button:visible').filter({ hasText: /^\s*Store\s*$/ }).last();
        await button.waitFor({ state: 'visible', timeout: 10000 });
    }
    await button.click();
    await frame.waitForFunction(() => !Array.from(document.querySelectorAll('button'))
        .some((element) => element.offsetParent && element.textContent.trim() === 'Store'),
    null, { timeout: 30000 });
}

async function createDocument(page, app, title, mutate) {
    await page.goto(`${BASE_URL}/${app}/#`, { waitUntil: 'domcontentloaded' });
    let frame = await innerFrame(page, app);
    const create = frame.locator('#cp-creation .cp-creation-create button');
    await create.waitFor({ state: 'visible', timeout: 60000 });
    await create.click();
    await page.waitForFunction((name) => location.pathname === `/${name}/` && location.hash.length > 2,
        app, { timeout: 60000 });
    frame = await innerFrame(page, app);
    await waitSaved(frame);
    await setTitle(frame, title);
    await mutate(frame, page);
    // The toolbar can still display the previous Saved state while the editor's
    // asynchronous change handler schedules a new ChainPad message.
    await page.waitForTimeout(4000);
    await storeInDrive(frame);
    await waitSaved(frame);
    process.stdout.write(`Created ${app} fixture: ${title}\n`);
}

async function main() {
    if (!process.env.CRYPTPAD_TEST_PASSWORD) {
        throw new Error('CRYPTPAD_TEST_PASSWORD is required');
    }
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({
        headless: true,
        executablePath: '/home/jesse/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
        args: ['--no-sandbox', '--ignore-certificate-errors'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
        await page.goto(`${BASE_URL}/login/`, { waitUntil: 'domcontentloaded' });
        // DOMContentLoaded precedes RequireJS attaching the login handler.
        await page.waitForTimeout(2000);
        await page.locator('#name').fill(USERNAME);
        await page.locator('#password').fill(process.env.CRYPTPAD_TEST_PASSWORD);
        await page.locator('button.login').click();
        try {
            await page.waitForURL(/\/drive\//, { timeout: 60000 });
        } catch (error) {
            const visibleText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 500);
            throw new Error(`Login did not reach the drive (URL ${page.url()}): ${visibleText}; ${error.message}`);
        }

        if (SELECTED_APPS.has('pad')) await createDocument(page, 'pad', FIXTURES.pad.title, async (frame) => {
            await frame.waitForFunction(() => window.CKEDITOR && Object.keys(window.CKEDITOR.instances).length > 0,
                null, { timeout: 60000 });
            await frame.evaluate((html) => {
                const editor = window.CKEDITOR.instances.editor1;
                if (!editor) throw new Error('CKEditor editor1 instance is unavailable');
                const editable = editor.editable().$;
                editable.innerHTML = html;
                editable.dispatchEvent(new Event('input', { bubbles: true }));
                editor.fire('change');
                editor.fire('blur');
            }, FIXTURES.pad.html);
            const editorHtml = await frame.evaluate(() =>
                window.CKEDITOR.instances.editor1.editable().$.innerHTML);
            if (!editorHtml.includes('RECOVERY-FIXTURE-RICH-TEXT')) {
                throw new Error(`CKEditor did not retain the rich-text fixture: ${JSON.stringify(editorHtml.slice(0, 300))}`);
            }
        });

        if (SELECTED_APPS.has('slide')) await createDocument(page, 'slide', FIXTURES.slide.title, async (frame) => {
            await frame.waitForFunction(() => {
                const node = document.querySelector('.CodeMirror');
                return node && node.CodeMirror;
            }, null, { timeout: 60000 });
            await frame.evaluate((markdown) => {
                const editor = document.querySelector('.CodeMirror').CodeMirror;
                editor.setValue(markdown);
                editor.focus();
            }, FIXTURES.slide.markdown);
        });

        if (SELECTED_APPS.has('kanban')) await createDocument(page, 'kanban', FIXTURES.kanban.title, async (frame) => {
            await frame.locator('#kanban-addboard').click();
            const board = frame.locator('.kanban-board').last();
            await board.waitFor({ state: 'visible' });
            await board.locator('.kanban-title-board').click();
            const boardInput = board.locator('.kanban-title-board input');
            await boardInput.fill(FIXTURES.kanban.board);
            await boardInput.press('Enter');
            await board.locator('.kanban-title-button:not([data-top])').click();
            const cardInput = board.locator('.kanban-item.new-item input');
            await cardInput.fill(FIXTURES.kanban.card);
            await cardInput.press('Enter');
            const nextInput = board.locator('.kanban-item.new-item input');
            if (await nextInput.count()) await nextInput.press('Escape');
        });

        // A real OnlyOffice sheet fixture exercises both its primary ChainPad
        // state and authenticated secondary edit history even before a native
        // XLSX converter is available offline.
        if (SELECTED_APPS.has('sheet')) await createDocument(page, 'sheet', FIXTURES.sheet.title, async (frame, outerPage) => {
            await outerPage.waitForTimeout(3000);
            const editorFrame = outerPage.frames().find((candidate) =>
                /spreadsheeteditor|frameEditor/i.test(candidate.url()));
            if (!editorFrame) throw new Error('OnlyOffice spreadsheet editor frame is unavailable');
            const canvas = editorFrame.locator('#ws-canvas-graphic-overlay');
            if (!await canvas.count()) throw new Error('OnlyOffice spreadsheet canvas is unavailable');
            await canvas.click({ position: { x: 180, y: 120 }, force: true });
            await outerPage.keyboard.type('RECOVERY-FIXTURE-SHEET');
            await outerPage.keyboard.press('Enter');
        });
    } finally {
        await context.close();
        await browser.close();
    }
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
