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
const startedAt = Date.now();
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
const report = { generatedAt: new Date().toISOString(), browser: browser.version(), status: 'running',
    https: 'Local static HTTPS server with an ephemeral certificate; isolated browser ignores certificate validation.', cases: [], checkpoints: [] };
const persistReport = () => {
    report.updatedAt = new Date().toISOString();
    report.elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    report.activeCheckpoints = report.checkpoints.filter(entry => entry.status === 'running').map(entry => entry.name);
    fs.writeFileSync(path.join(reports, 'reading-bookshelf-entrypoints-report.json'), `${JSON.stringify(report, null, 2)}\n`);
};
const log = message => console.error(`[issue159 +${((Date.now() - startedAt) / 1000).toFixed(3)}s] ${message}`);
const recordFailure = error => {
    report.status = 'fail';
    report.error ||= error.stack || String(error);
    persistReport();
};
async function checkpoint(name, action) {
    const entry = { name, status: 'running', startedAt: new Date().toISOString(), elapsedSeconds: (Date.now() - startedAt) / 1000 };
    report.checkpoints.push(entry);
    report.currentCheckpoint = name;
    persistReport();
    log(`START ${name}`);
    try {
        const result = await action();
        entry.status = 'pass';
        entry.finishedAt = new Date().toISOString();
        persistReport();
        log(`DONE ${name}`);
        return result;
    } catch (error) {
        entry.status = 'fail';
        entry.error = error.stack || String(error);
        recordFailure(error);
        log(`FAIL ${name}: ${error.message || error}`);
        throw error;
    }
}
const pass = (name, evidence = {}) => {
    report.cases.push({ name, status: 'pass', ...evidence });
    persistReport();
    log(`${name}: pass`);
};

async function newContext() {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(60_000);
    return context;
}

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
    try {
        await page.locator('.bookshelf-search-input').fill(query);
        await poll(() => page.locator('.bookshelf-card').evaluateAll(nodes => nodes.map(node => node.dataset.examId).sort()), ids.sort(), `search ${query}`);
        await page.locator('.bookshelf-search-input').fill('');
    } catch (error) {
        recordFailure(error);
        const diagnostic = await page.evaluate(query => ({
            query, url: location.href, inputValue: document.querySelector('.bookshelf-search-input')?.value,
            stateQuery: BookshelfView.state.searchQuery,
            activeElement: document.activeElement?.className,
            loading: ReadingBookshelfStore._loading, revision: ReadingBookshelfStore._revision,
            loadSequence: ReadingBookshelfStore._loadSequence,
            cards: [...document.querySelectorAll('.bookshelf-card')].map(node => ({
                articleId: node.dataset.articleId, examId: node.dataset.examId,
                title: node.querySelector('.bookshelf-card__title')?.textContent.trim()
            }))
        }), query).catch(diagnosticError => ({ query, error: diagnosticError.message }));
        (report.searchFailures ||= []).push(diagnostic);
        persistReport();
        throw error;
    }
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
        const diagnostic = await page.evaluate(() => ({
            view: document.querySelector('.view.active')?.id,
            text: document.querySelector('#browse-view')?.textContent.slice(-4000),
            list: document.querySelector('#exam-list-container')?.innerHTML.slice(0, 3000)
        }));
        (report.browseFailures ||= []).push({ protocol, ...diagnostic });
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
    const donorContext = await checkpoint(`${protocol}-import-donor-context`, () => newContext());
    let backup;
    try {
        const donor = await checkpoint(`${protocol}-import-donor-page`, () => donorContext.newPage());
        await checkpoint(`${protocol}-import-donor-ready`, () => ready(donor, protocol));
        await checkpoint(`${protocol}-import-donor-collect`, () => collect(donor, 'issue159-restored', vocabulary.map(word => `restored${word}`)));
        backup = await checkpoint(`${protocol}-import-donor-export`, () => donor.evaluate(() => AppData.backups.export({ domains: ['vocab'] })));
    } finally { await checkpoint(`${protocol}-import-donor-close`, () => donorContext.close()); }
    for (const replace of [false, true]) {
        const mode = replace ? 'replace' : 'merge';
        const planId = await checkpoint(`${protocol}-import-${mode}-preview`, () => page.evaluate(async ({ backup, replace }) =>
            (await AppData.backups.previewImport(backup, { replace })).id, { backup, replace }));
        const receipt = await checkpoint(`${protocol}-import-${mode}-commit`, () => page.evaluate(({ planId, replace }) =>
            AppData.backups.commitImport(planId, { confirmDestructive: replace }), { planId, replace }));
        assert.equal(receipt.committed, true);
        await checkpoint(`${protocol}-import-${mode}-original-counts`, () =>
            expectCounts(page, replace ? { 'issue159-restored': 7 } : { [examA]: 0, [examB]: 2, 'issue159-restored': 7 }, replace ? 7 : 9));
        await checkpoint(`${protocol}-import-${mode}-original-search`, () => search(page, 'restoredbeyondpreview', ['issue159-restored']));
    }
    const other = await checkpoint(`${protocol}-cross-window-page`, () => context.newPage());
    try {
        await checkpoint(`${protocol}-cross-window-ready`, () => ready(other, protocol));
        await checkpoint(`${protocol}-cross-window-collect`, () => collect(other, 'issue159-restored', ['otherwindowword']));
        await checkpoint(`${protocol}-cross-window-original-counts`, () => expectCounts(page, { 'issue159-restored': 8 }, 8));
        await checkpoint(`${protocol}-cross-window-original-search`, () => search(page, 'otherwindowword', ['issue159-restored']));
    } finally { await checkpoint(`${protocol}-cross-window-close`, () => other.close()); }
    await checkpoint(`${protocol}-import-bookshelf-screenshot`, () => page.screenshot({ path: path.join(reports, `issue159-${protocol}-bookshelf.png`) }));
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
    const fixtureRevision = await page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).revision);
    // Fixture writes acknowledge persistence before the live shelf finishes
    // replacing its controls. Wait for the final projection before typing.
    await checkpoint(`${protocol}-source-fixture-projection`, () => poll(() => page.evaluate(({ ids, fixtureRevision }) => {
        const store = ReadingBookshelfStore;
        return !store._loading && store._revision === fixtureRevision && Object.values(ids).every(id => {
            const article = store._snapshot?.reading.articles.find(row => row.id === id);
            return article && store._sourceMetadata.get(article.sourceId)?.index?.some(row =>
                String(row.id || row.examId) === article.examId);
        });
    }, { ids, fixtureRevision }), true, 'source fixture projection must finish before search input'));
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
    const context = await newContext();
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
    } catch (error) {
        recordFailure(error);
        throw error;
    } finally { await context.close(); }
}

async function browseReplacedArticle(protocol) {
    const context = await newContext();
    const page = await context.newPage();
    const source = { kind: 'imported', id: 'issue166-browse-replacement' };
    const examId = 'issue166-shared-article';
    const originalTitle = 'Library A original article';
    const replacementTitle = 'Replacement at the same article locator';
    try {
        await ready(page, protocol);
        await page.evaluate(async ({ source, examId, originalTitle, protocol, html }) => {
            let entry = { id: examId, examId, title: originalTitle, category: 'P1', type: 'reading',
                path: 'developer/tests/e2e/reports/', filename: 'issue159-library-a.html', hasHtml: true, sourceKind: 'custom' };
            if (protocol === 'file') {
                const discovered = await LibraryDiscovery.discover([new File([html], 'issue159-library-a.html', { type: 'text/html' })], { type: 'reading' });
                entry = { ...entry, sourceKind: 'file-picker', sourcePath: discovered.entries[0].sourcePath,
                    importKey: discovered.entries[0].importKey };
            }
            await AppData.library.import({ id: source.id, configuration: { name: 'Browse replacement fixture' }, index: [entry] });
            await LibraryManager.switchLibraryConfig(source.id);
        }, { source, examId, originalTitle, protocol, html: fs.readFileSync(path.join(reports, 'issue159-library-a.html'), 'utf8') });
        await page.locator('nav button[data-view="browse"]').click();
        const entry = page.locator(`#exam-list-container [data-action="vocab-book"][data-exam-id="${examId}"]`);
        await entry.waitFor();
        await entry.click();
        await readerReady(page, examId);
        await page.locator('#vocab-fab').click();
        await page.locator('#vocab-manual-input').fill('retainedoriginal');
        await page.locator('#vocab-manual-add-btn').click();
        await poll(() => page.locator('#vocab-fab-count').textContent(), '1', 'original Browse article vocabulary');
        const originalSnapshot = await snapshot(page);
        await page.locator('#vocab-modal-close').click();
        await page.locator('#vocab-reader-back-btn').click();
        await page.evaluate(async ({ source, replacementTitle }) => {
            const index = await AppData.library.getIndex(source.id);
            index[0].title = replacementTitle;
            await AppData.library.import({ id: source.id, configuration: { name: 'Browse replacement fixture' }, index });
        }, { source, replacementTitle });
        // Reload production modules and render the replacement's real Browse
        // button; its options.title must not override the persisted identity.
        await ready(page, protocol);
        await page.locator('nav button[data-view="browse"]').click();
        await poll(() => entry.getAttribute('data-exam-title'), replacementTitle, 'replacement Browse title');
        const originalArticle = originalSnapshot.reading.articles.find(row => row.examId === examId);
        assert.deepEqual(originalArticle.contentRefs, [await entry.getAttribute('data-content-ref')], 'replacement keeps the same content locator');
        await entry.click();
        await page.locator('[data-source-unavailable]').waitFor();
        assert.match(await page.locator('[data-source-unavailable]').textContent(), /文章已更改/);
        assert.equal(await page.evaluate(() => ReadingVocabReader._openOptions.title), replacementTitle);
        assert.equal(await page.locator('#vocab-reader-title').textContent(), originalTitle);
        assert.equal(await page.evaluate(() => ReadingVocabReader.currentPayload), null);
        assert.equal(await page.locator('#vocab-fab-count').textContent(), '1');
        assert.deepEqual(await snapshot(page), originalSnapshot, 'blocked Browse opens must preserve the original article and visit');
        await page.getByRole('button', { name: '查看已保存生词', exact: true }).click();
        assert.ok((await exportText(page, page.locator('#vocab-export-btn'))).includes('retainedoriginal'));
        assert.equal(await page.locator('#vocab-manual-add-btn').isEnabled(), false);
        pass(`${protocol}-browse-replacement-preserves-saved-article-and-vocabulary`);
    } catch (error) {
        recordFailure(error);
        throw error;
    } finally { await context.close(); }
}

async function runProtocol(protocol) {
    const context = await newContext();
    try {
        const page = await context.newPage();
        page.on('dialog', dialog => dialog.accept());
        const examA = await checkpoint(`${protocol}-browse-and-cold-shelf`, () => browseAndColdShelf(page, protocol));
        const examB = await checkpoint(`${protocol}-counts-and-controls`, () => countsAndControls(page, examA, protocol));
        await checkpoint(`${protocol}-import-and-cross-window`, () => importAndCrossWindow(page, context, examA, examB, protocol));
        await checkpoint(`${protocol}-source-identity`, () => sourceIdentity(page, protocol));
        assert.deepEqual(await page.evaluate(() => AppData.practice.list()), [], 'reader and bookshelf use must not create practice records');
    } catch (error) {
        recordFailure(error);
        throw error;
    } finally { await context.close(); }
    await checkpoint(`${protocol}-practice-first-invocation`, () => practiceFirstInvocation(protocol));
    await checkpoint(`${protocol}-browse-replaced-article`, () => browseReplacedArticle(protocol));
}

try {
    // Protocols have independent storage and download contexts. Wait for every
    // flow, including after a failure, before closing their shared browser.
    const protocols = ['http', 'https', 'file'];
    const results = await Promise.allSettled(protocols.map(protocol => runProtocol(protocol)));
    report.protocols = results.map((result, index) => ({
        protocol: protocols[index], status: result.status === 'fulfilled' ? 'pass' : 'fail',
        ...(result.status === 'rejected' ? { error: result.reason?.stack || String(result.reason) } : {})
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
        throw new AggregateError(failures.map(result => result.reason), 'Bookshelf protocol regressions failed');
    }
    report.status = 'pass';
} catch (error) {
    recordFailure(error);
    process.exitCode = 1;
} finally {
    persistReport();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
    console.log(JSON.stringify(report, null, 2));
    persistReport();
}
