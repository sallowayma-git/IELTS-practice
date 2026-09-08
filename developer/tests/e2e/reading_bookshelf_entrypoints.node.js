#!/usr/bin/env node
/** #159: production entrypoints, source identity, and live IndexedDB bookshelf projections. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
const builtin = { kind: 'builtin', id: 'default' };
const vocabulary = ['coral', 'ocean', 'island', 'harbour', 'lagoon', 'turtle', 'beyondpreview'];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
fs.mkdirSync(reports, { recursive: true });
for (const label of ['A', 'B']) {
    fs.writeFileSync(path.join(reports, `issue159-library-${label.toLowerCase()}.html`),
        `<!doctype html><title>Library ${label} original article</title><div id="passage"><p>Original source ${label} contains distinctive ${label === 'A' ? 'alphacontent' : 'betacontent'} for intensive reading.</p></div><div id="questions"><p>Question from source ${label}.</p></div>`);
}
function serveStatic(request, response) {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        response.end(body);
    } catch { response.writeHead(404).end(); }
}
const server = http.createServer(serveStatic);
// Exercise real static HTTPS URLs locally. Certificate validation is disabled
// only in these isolated browser contexts; this is not a deployment smoke test.
let openssl = process.env.OPENSSL_EXECUTABLE_PATH || 'openssl';
if (process.platform === 'win32' && !process.env.OPENSSL_EXECUTABLE_PATH) {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const bundled = path.resolve(path.dirname(git), '../usr/bin/openssl.exe');
    if (fs.existsSync(bundled)) openssl = bundled;
}
const certificate = path.join(reports, 'issue159-localhost-cert.pem');
const privateKey = path.join(reports, 'issue159-localhost-key.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey,
    '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'pipe' });
const secureServer = https.createServer({ key: fs.readFileSync(privateKey), cert: fs.readFileSync(certificate) }, serveStatic);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const secureOrigin = `https://127.0.0.1:${secureServer.address().port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }).catch(async error => {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
    throw error;
});
const report = { generatedAt: new Date().toISOString(), browser: browser.version(),
    https: 'Local static HTTPS server with an ephemeral certificate; isolated browser ignores certificate validation.', cases: [] };
const pass = (name, evidence = {}) => {
    report.cases.push({ name, status: 'pass', ...evidence });
    console.error(`[issue159] ${name}: pass`);
};

async function ready(page, protocol) {
    const url = urlFor(protocol, 'index.html');
    await page.goto(`${url}?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60_000 });
    await page.evaluate(async () => {
        await AppData.ready;
        await window.LicenseModal?.accept();
        document.querySelector('#library-loader-overlay [data-library-action="close"]')?.click();
    });
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

function urlFor(protocol, relative) {
    return protocol === 'file' ? pathToFileURL(path.join(root, relative)).href
        : `${protocol === 'https' ? secureOrigin : origin}/${relative}`;
}

async function poll(read, expected, label) {
    const deadline = Date.now() + 15_000;
    let actual;
    while (true) {
        actual = await read();
        if (JSON.stringify(actual) === JSON.stringify(expected)) return;
        if (Date.now() >= deadline) assert.deepEqual(actual, expected, label);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

async function snapshot(page) {
    return page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
}

async function articleId(page, examId, source = builtin) {
    return page.evaluate(({ source, examId }) => AppData.vocab.readingModel.articleId(source, examId), { source, examId });
}

function card(page, id) {
    return page.locator('.bookshelf-card').filter({ has: page.locator(`[data-action="open-reading-vocab"][data-exam-id="${id}"]`) });
}

function sourceCard(page, id) {
    return page.locator(`.bookshelf-card[data-article-id=${JSON.stringify(id)}]`);
}

async function showShelf(page) {
    await page.locator('nav button[data-view="more"]').click();
    await page.locator('#bookshelf-tool-card').click();
    await page.locator('#bookshelf-view').waitFor({ state: 'visible' });
    await page.locator('.bookshelf-stat-value').first().waitFor();
}

async function readerReady(page, examId) {
    await page.locator('#vocab-reader-tabs [data-para="questions"]').waitFor();
    await page.waitForFunction(id => ReadingVocabReader.currentExamId === id && !!ReadingVocabReader.currentPayload
        && !!document.querySelector('.vocab-paragraph-text') && window.BookshelfView?.state.readerLoading !== true, examId);
    assert.equal(await page.locator('.vocab-error-state').count(), 0);
}

async function openCard(page, examId) {
    await card(page, examId).locator('button[data-action="open-reading-vocab"]').click();
    await readerReady(page, examId);
}

async function collect(page, examId, words, source = builtin, title = null) {
    const receipts = await page.evaluate(async ({ examId, words, source, title }) => {
        const receipts = [];
        const snapshot = (await AppData.vocab.getReadingSnapshot()).snapshot;
        const id = AppData.vocab.readingModel.articleId(source, examId);
        const resolvedTitle = title || snapshot.reading.articles.find(row => row.id === id)?.title
            || window.__READING_EXAM_MANIFEST__?.[examId]?.title || examId;
        for (const word of words) {
            const receipt = await AppData.vocab.mutateReading('collect', {
                source, article: { examId, title: resolvedTitle }, word: { word, meaning: `Definition of ${word}` }, manual: true
            });
            receipts.push({ saved: receipt.saved, revision: receipt.revision });
        }
        return receipts;
    }, { examId, words, source, title });
    assert.ok(receipts.every(receipt => receipt.saved === true && Number.isInteger(receipt.revision)));
}

async function expectCounts(page, counts, globalCount) {
    await poll(() => page.evaluate(() => ReadingBookshelfStore.getBookshelfExams().map(row => [row.examId, row.wordCount]).sort()),
        Object.entries(counts).sort(), 'acknowledged article counts must refresh automatically');
    await poll(() => page.locator('.bookshelf-stat-value').nth(1).textContent(), String(globalCount), 'visible global count must deduplicate associated terms');
    for (const [id, count] of Object.entries(counts)) {
        if (count) assert.ok((await card(page, id).textContent()).includes(`${count} 个生词`), `${id}: visible article count`);
    }
}

async function search(page, query, ids) {
    await page.locator('.bookshelf-search-input').fill(query);
    await poll(() => page.locator('.bookshelf-card').evaluateAll(nodes => nodes.map(node => node.dataset.examId).sort()), ids.sort(), `search ${query}`);
    await page.locator('.bookshelf-search-input').fill('');
}

async function exportText(page, button) {
    const downloaded = page.waitForEvent('download');
    await button.click();
    const download = await downloaded;
    return fs.readFileSync(await download.path(), 'utf8');
}

async function browseAndColdShelf(page, protocol) {
    await ready(page, protocol);
    assert.equal(await page.evaluate(() => !!window.ReadingVocabReader), false, 'first load must not prewarm the reader');
    await page.locator('nav button[data-view="browse"]').click();
    await page.waitForFunction(async () => typeof window.app?.browseCategory === 'function'
        && typeof window.resolveActiveLibraryIndex === 'function'
        && (await window.resolveActiveLibraryIndex()).some(exam => exam.id === 'p2-low-08'), null, { timeout: 60_000 });
    const entry = page.locator('#exam-list-container [data-action="vocab-book"]').first();
    await entry.waitFor().catch(async error => {
        report.browseFailure = await page.evaluate(() => ({
            view: document.querySelector('.view.active')?.id,
            text: document.querySelector('#browse-view')?.textContent.slice(-4000),
            list: document.querySelector('#exam-list-container')?.innerHTML.slice(0, 3000)
        }));
        throw error;
    });
    const examId = await entry.getAttribute('data-exam-id');
    await entry.click();
    await readerReady(page, examId);
    const initial = await snapshot(page);
    assert.equal(initial.reading.visits.length, 1);
    assert.equal(initial.reading.associations.length, 0);
    await page.locator('#vocab-reader-back-btn').click();
    assert.equal(await page.locator('#browse-view').isVisible(), true);
    assert.equal(await entry.evaluate(node => node === document.activeElement), true, 'Browse return must restore the actual entry');
    // A real page reload removes every reader/Browse module cache; only IndexedDB persists.
    await ready(page, protocol);
    assert.equal(await page.evaluate(() => !!window.ReadingVocabReader), false);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(row => /browse\.bundle\.js/.test(row.name))), false);
    await showShelf(page);
    await expectCounts(page, { [examId]: 0 }, 0);
    const shelfEntry = card(page, examId).locator('button[data-action="open-reading-vocab"]');
    await shelfEntry.click();
    await readerReady(page, examId);
    await page.locator('#vocab-reader-back-btn').click();
    assert.equal(await page.locator('#bookshelf-view').isVisible(), true);
    assert.equal(await shelfEntry.evaluate(node => node === document.activeElement), true, 'Bookshelf return must restore the entry even after live rerender');
    assert.equal((await snapshot(page)).reading.visits.length, 1, 'reopening may update a visit, never duplicate it');
    await page.locator('#bookshelf-root [data-action="return-more"]').click();
    assert.equal(await page.locator('#more-view').isVisible(), true);
    await showShelf(page);
    pass(`${protocol}-first-browse-and-cold-zero-word-bookshelf`, { examId });
    return examId;
}

async function countsAndControls(page, examA, protocol) {
    const examB = examA === 'p2-low-08' ? 'p1-high-216' : 'p2-low-08';
    await collect(page, examA, vocabulary);
    await collect(page, examB, ['coral', 'bword']);
    await expectCounts(page, { [examA]: 7, [examB]: 2 }, 8);
    assert.equal(await card(page, examA).locator('.bookshelf-vocab-chip').count(), 6);
    await search(page, 'beyondpreview', [examA]);
    await openCard(page, examA);
    await page.locator('#vocab-fab').click();
    await page.locator('#vocab-manual-input').fill('manualaddition');
    await page.locator('#vocab-manual-add-btn').click();
    await poll(() => page.locator('#vocab-fab-count').textContent(), '8', 'manual collection must show acknowledged count');
    const exported = await exportText(page, page.locator('#vocab-export-btn'));
    assert.ok(exported.includes('manualaddition') && exported.includes('beyondpreview'));
    await page.locator('#vocab-clear-btn').click();
    await poll(() => page.locator('#vocab-fab-count').textContent(), '0', 'clear article control');
    await page.locator('#vocab-modal-close').click();
    await page.locator('#vocab-reader-back-btn').click();
    await expectCounts(page, { [examA]: 0, [examB]: 2 }, 2);
    const idA = await articleId(page, examA);
    assert.equal((await snapshot(page)).reading.visits.some(row => row.articleId === idA), true);
    assert.ok((await exportText(page, page.locator('[data-action="export-all-bookshelf"]'))).includes('bword'));
    pass(`${protocol}-distinct-counts-full-search-manual-clear-export`, { examA, examB, globalAfterClear: 2 });
    return examB;
}

async function importAndCrossWindow(page, context, examA, examB, protocol) {
    const donorContext = await browser.newContext({ ignoreHTTPSErrors: true });
    let backup;
    try {
        const donor = await donorContext.newPage();
        await ready(donor, protocol);
        await collect(donor, 'issue159-restored', vocabulary.map(word => `restored${word}`));
        backup = await donor.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
    } finally { await donorContext.close(); }
    for (const replace of [false, true]) {
        const receipt = await page.evaluate(async ({ backup, replace }) => {
            const plan = await AppData.backups.previewImport(backup, { replace });
            return AppData.backups.commitImport(plan.id, { confirmDestructive: replace });
        }, { backup, replace });
        assert.equal(receipt.committed, true);
        await expectCounts(page, replace ? { 'issue159-restored': 7 } : { [examA]: 0, [examB]: 2, 'issue159-restored': 7 }, replace ? 7 : 9);
        await search(page, 'restoredbeyondpreview', ['issue159-restored']);
    }
    const other = await context.newPage();
    try {
        await ready(other, protocol);
        await collect(other, 'issue159-restored', ['otherwindowword']);
        await expectCounts(page, { 'issue159-restored': 8 }, 8);
        await search(page, 'otherwindowword', ['issue159-restored']);
    } finally { await other.close(); }
    await page.screenshot({ path: path.join(reports, `issue159-${protocol}-bookshelf.png`) });
    pass(`${protocol}-merge-replace-cross-window-refresh`, { distinctGlobalCount: 8 });
}

async function sourceIdentity(page, protocol) {
    const examId = 'p2-low-08'; // Deliberately collides with an existing built-in exam as well.
    const ids = {};
    for (const label of ['A', 'B']) {
        const source = { kind: 'imported', id: `issue159-library-${label.toLowerCase()}` };
        await page.evaluate(async ({ source, label, examId, protocol, html }) => {
            let entry = { id: examId, examId, title: `Library ${label} original article`, category: 'P1', type: 'reading',
                path: 'developer/tests/e2e/reports/', filename: `issue159-library-${label.toLowerCase()}.html`, hasHtml: true, sourceKind: 'custom' };
            if (protocol === 'file') {
                const file = new File([html], `issue159-library-${label.toLowerCase()}.html`, { type: 'text/html' });
                const discovered = await LibraryDiscovery.discover([file], { type: 'reading' });
                if (discovered.entries.length !== 1 || discovered.runtime.html !== 1) throw new Error('File-picker source fixture registration failed');
                // Persist only JSON metadata; discovery can also return absent
                // optional fields such as pdfFilename with undefined values.
                entry = { ...entry, sourceKind: 'file-picker', sourcePath: discovered.entries[0].sourcePath,
                    importKey: discovered.entries[0].importKey };
            }
            const receipt = await AppData.library.import({ id: source.id,
                configuration: { name: `Original library ${label}` },
                index: [entry] });
            if (receipt.committed !== true) throw new Error('Library import was not acknowledged');
        }, { source, label, examId, protocol, html: fs.readFileSync(path.join(reports, `issue159-library-${label.toLowerCase()}.html`), 'utf8') });
        await collect(page, examId, [`source${label.toLowerCase()}word`], source, `Library ${label} original article`);
        ids[label] = await articleId(page, examId, source);
    }
    await search(page, 'Library A original article', [examId]);
    await search(page, 'P1', [examId, examId]);
    for (const label of ['A', 'B']) {
        const original = sourceCard(page, ids[label]);
        await original.waitFor();
        assert.ok((await original.locator('.bookshelf-card__source').textContent()).includes(`issue159-library-${label.toLowerCase()}`));
        await original.locator('button[data-action="open-reading-vocab"]').click();
        await readerReady(page, examId);
        const text = await page.locator('#vocab-passage-content').textContent();
        assert.ok(text.includes(label === 'A' ? 'alphacontent' : 'betacontent'));
        assert.ok(!text.includes(label === 'A' ? 'betacontent' : 'alphacontent'));
        await page.locator('#vocab-reader-back-btn').click();
    }
    await page.evaluate(async ({ examId, ids }) => {
        await Promise.all(['A', 'B'].map(label => ReadingVocabReader.open(examId, {
            source: { kind: 'imported', id: `issue159-library-${label.toLowerCase()}` }, articleId: ids[label]
        })));
    }, { examId, ids });
    await readerReady(page, examId);
    assert.equal(await page.evaluate(() => ReadingVocabReader.currentSource.id), 'issue159-library-b');
    assert.ok((await page.locator('#vocab-passage-content').textContent()).includes('betacontent'));
    await page.locator('#vocab-reader-back-btn').click();
    const visits = (await snapshot(page)).reading.visits;
    assert.equal(new Set(visits.map(row => row.articleId)).size, visits.length, 'rapid opens must not duplicate visit rows');
    await page.evaluate(() => AppData.library.remove('issue159-library-a'));
    await sourceCard(page, ids.A).locator('button[data-action="open-reading-vocab"]').click();
    await page.locator('.vocab-error-state').waitFor();
    assert.equal(await page.evaluate(() => ReadingVocabReader.currentPayload), null, 'a missing imported source must never borrow built-in content');
    await page.locator('#vocab-fab').click();
    assert.ok((await page.locator('#vocab-list').textContent()).includes('sourceaword'));
    assert.ok((await exportText(page, page.locator('#vocab-export-btn'))).includes('sourceaword'));
    await page.locator('#vocab-modal-close').click();
    await page.locator('#vocab-reader-back-btn').click();
    await search(page, 'issue159-library-b', [examId]);
    pass(`${protocol}-same-exam-distinct-original-sources-and-missing-source-export`, { articleIds: ids });
}

async function practiceFirstInvocation(protocol) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    try {
        const relative = 'assets/generated/reading-exams/reading-practice-unified.html';
        const url = urlFor(protocol, relative);
        await page.goto(`${url}?examId=p2-low-08`);
        await page.locator('#question-groups input[name="q1"][value="A"]').waitFor();
        await page.locator('#question-groups input[name="q1"][value="A"]').check();
        await page.locator('#reading-vocab-header-btn').click();
        await readerReady(page, 'p2-low-08');
        assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
        const selected = await page.evaluate(() => {
            const paragraph = document.querySelector('.vocab-paragraph-text');
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const match = /[A-Za-z]{4,}/.exec(node.textContent);
                if (!match) continue;
                const range = document.createRange();
                range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
                const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
                node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                return match[0];
            }
            throw new Error('Practice reader has no selectable paragraph word');
        });
        await poll(() => page.locator('#vocab-fab-count').textContent(), '1', 'first practice reader selection');
        await page.locator('#vocab-fab').click();
        await page.locator('#vocab-manual-input').fill('practicefirstword');
        await page.locator('#vocab-manual-add-btn').click();
        await poll(() => page.locator('#vocab-fab-count').textContent(), '2', 'first practice panel manual add');
        const exported = await exportText(page, page.locator('#vocab-export-btn'));
        assert.ok(exported.includes('practicefirstword') && exported.includes(selected));
        await page.locator('#vocab-modal-close').click();
        await page.locator('#vocab-reader-back-btn').click();
        assert.equal(await page.locator('#reading-vocab-header-btn').evaluate(node => node === document.activeElement), true);
        assert.equal(await page.locator('#question-groups input[name="q1"][value="A"]').isChecked(), true);
        pass(`${protocol}-first-practice-panel-entry-controls-return`);
    } finally { await context.close(); }
}

try {
    for (const protocol of ['http', 'https', 'file']) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        page.on('dialog', dialog => dialog.accept());
        try {
            const examA = await browseAndColdShelf(page, protocol);
            const examB = await countsAndControls(page, examA, protocol);
            await importAndCrossWindow(page, context, examA, examB, protocol);
            await sourceIdentity(page, protocol);
            assert.deepEqual(await page.evaluate(() => AppData.practice.list()), [], 'reader and bookshelf use must not create practice records');
        } finally { await context.close(); }
        await practiceFirstInvocation(protocol);
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail';
    report.error = error.stack || String(error);
    process.exitCode = 1;
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(reports, 'reading-bookshelf-entrypoints-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
