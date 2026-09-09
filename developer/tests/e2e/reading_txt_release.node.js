#!/usr/bin/env node
/** #160: qualify source or freshly extracted static assets using actual downloads and IndexedDB. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    assert.ok(['--root', '--label', '--reports'].includes(key) && process.argv[index + 1], `Unsupported argument ${key}`);
    options[key.slice(2)] = process.argv[index + 1];
}
const root = path.resolve(options.root || process.env.READING_RELEASE_ROOT || repository);
const label = options.label || process.env.READING_RELEASE_LABEL || (root === repository ? 'source' : 'package');
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'Report label must be a safe filename component');
const reports = path.resolve(options.reports || process.env.READING_RELEASE_REPORT_DIR || path.join(repository, 'developer/tests/e2e/reports'));
assert.ok(fs.existsSync(path.join(root, 'index.html')), `No release index.html in ${root}`);
fs.mkdirSync(reports, { recursive: true });
const reportFile = path.join(reports, `reading-txt-release-${label}-report.json`);
const started = Date.now();
const builtin = { kind: 'builtin', id: 'default' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => { try { return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim(); } catch { return null; } };
const report = {
    generatedAt: new Date().toISOString(), status: 'running', label, assetRoot: root,
    repositoryHead: git(['rev-parse', 'HEAD']),
    repositoryDirty: Boolean(git(['status', '--porcelain'])),
    command: process.argv.join(' '),
    https: 'Loopback static HTTPS with an ephemeral certificate and isolated ignoreHTTPSErrors; no public deployment tested.',
    importer: 'UTF-8 plain-text bytes only; no named third-party application import was performed.',
    assetHashes: Object.fromEntries(['index.html', 'js/bundles/core-foundation.bundle.js', 'js/bundles/browse.bundle.js',
        'js/bundles/more.bundle.js', 'js/bundles/reading-page.bundle.js', 'js/data/v2/readingVocabularyModel.js'].filter(file => fs.existsSync(path.join(root, file)))
        .map(file => [file, hash(fs.readFileSync(path.join(root, file)))])),
    cases: [], downloads: [], checkpoints: []
};
function persist() {
    report.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(3));
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}
async function checkpoint(name, action) {
    const entry = { name, status: 'running' };
    report.checkpoints.push(entry); persist();
    console.error(`[issue160 ${label}] START ${name}`);
    try { const value = await action(); entry.status = 'pass'; persist(); return value; }
    catch (error) { entry.status = 'fail'; entry.error = error.stack || String(error); persist(); throw error; }
}
function pass(name, evidence = {}) { report.cases.push({ name, status: 'pass', ...evidence }); persist(); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
function serve(request, response) {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
        const body = fs.readFileSync(filename);
        response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); response.end(body);
    }
    catch { response.writeHead(404).end(); }
}
let openssl = process.env.OPENSSL_EXECUTABLE_PATH || 'openssl';
if (process.platform === 'win32' && !process.env.OPENSSL_EXECUTABLE_PATH) {
    const gitPath = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const bundled = path.resolve(path.dirname(gitPath), '../usr/bin/openssl.exe');
    if (fs.existsSync(bundled)) openssl = bundled;
}
const certificate = path.join(reports, `issue160-${label}-localhost-cert.pem`);
const privateKey = path.join(reports, `issue160-${label}-localhost-key.pem`);
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey,
    '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'pipe' });
const server = http.createServer(serve);
const secureServer = https.createServer({ key: fs.readFileSync(privateKey), cert: fs.readFileSync(certificate) }, serve);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const secureOrigin = `https://127.0.0.1:${secureServer.address().port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
let browser;

async function poll(read, expected, message) {
    const deadline = Date.now() + 15_000;
    while (true) {
        const actual = await read();
        if (JSON.stringify(actual) === JSON.stringify(expected)) return actual;
        if (Date.now() >= deadline) assert.deepEqual(actual, expected, message);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
async function newContext() {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    context.setDefaultTimeout(15_000); context.setDefaultNavigationTimeout(60_000);
    context.on('page', page => page.on('dialog', dialog => dialog.accept()));
    // AppData intentionally deletes its bootstrap channel. Observe its original
    // definition before production startup, solely to schedule a later fault at
    // the real transaction boundary without substituting any packaged module.
    await context.addInitScript(() => {
        const define = Object.defineProperty;
        Object.defineProperty = function(target, property, descriptor) {
            if (target === window && property === '__AppDataV2Internals') {
                window.__txtKernelPrototype = descriptor.value.DataKernel.prototype;
                Object.defineProperty = define;
            }
            return define.call(this, target, property, descriptor);
        };
    });
    return context;
}
async function ready(page, protocol) {
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href
        : `${protocol === 'https' ? secureOrigin : origin}/index.html`;
    await page.goto(`${url}?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60_000 });
    await page.evaluate(async () => {
        await AppData.ready; await window.LicenseModal?.accept();
        document.querySelector('#library-loader-overlay [data-library-action="close"]')?.click();
    });
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}
const snapshot = page => page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
const state = page => page.evaluate(() => AppData.vocab.getReadingSnapshot());
const articleId = (page, examId, source = builtin) => page.evaluate(({ examId, source }) => AppData.vocab.readingModel.articleId(source, examId), { examId, source });
const card = (page, examId) => page.locator('.bookshelf-card').filter({ has: page.locator(`[data-action="open-reading-vocab"][data-exam-id="${examId}"]`) });
const globalButton = page => page.locator('[data-action="export-all-bookshelf"]');
async function shelf(page) {
    await page.locator('nav button[data-view="more"]').click();
    await page.locator('#bookshelf-tool-card').click();
    await page.locator('#bookshelf-view').waitFor({ state: 'visible' });
    await page.locator('.bookshelf-stat-value').first().waitFor();
}
async function shelfSettled(page) {
    const revision = (await state(page)).revision;
    await poll(() => page.evaluate(revision => !ReadingBookshelfStore._loading && ReadingBookshelfStore._revision === revision, revision), true, 'Shelf must project the final acknowledged revision');
}
async function readerReady(page, examId) {
    await page.waitForFunction(id => window.ReadingVocabReader?.currentExamId === id && !!ReadingVocabReader.currentPayload
        && !!document.querySelector('.vocab-paragraph-text') && window.BookshelfView?.state.readerLoading !== true, examId);
    assert.equal(await page.locator('.vocab-error-state').count(), 0);
}
async function manual(page, word, count) {
    await page.locator('#vocab-manual-input').fill(word);
    await page.locator('#vocab-manual-add-btn').click();
    await poll(() => page.locator('#vocab-fab-count').textContent(), String(count), `Manual add ${word}`);
}
async function collect(page, examId, word, options = {}, source = builtin) {
    return page.evaluate(({ examId, word, options, source }) => AppData.vocab.mutateReading('collect', {
        source, article: { examId, title: examId }, word: { word, meaning: 'A rich definition that must never be exported' }, manual: true
    }, options), { examId, word, options, source });
}
function expectedContent(words) {
    return [...words].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)
        .map(word => word.replace(/\s+/g, ' ').trim()).join('\n');
}
async function download(page, button, words, name) {
    const promised = page.waitForEvent('download');
    await button.click();
    const saved = await promised;
    assert.equal(await saved.failure(), null);
    assert.match(saved.suggestedFilename(), /\.txt$/i);
    const bytes = fs.readFileSync(await saved.path());
    const expected = Buffer.from(expectedContent(words), 'utf8');
    assert.deepEqual(bytes, expected, `${name}: exact UTF-8, canonical terms, LF only, no header/BOM/trailing LF`);
    const artifact = `issue160-${label}-${name}.txt`;
    fs.writeFileSync(path.join(reports, artifact), bytes);
    report.downloads.push({ name, filename: saved.suggestedFilename(), artifact, bytes: bytes.length, sha256: hash(bytes), terms: words.length }); persist();
}
async function noDownload(page, action, message) {
    const events = [];
    const onDownload = download => events.push(download.suggestedFilename());
    page.on('download', onDownload);
    try { await action(); await page.waitForTimeout(250); assert.deepEqual(events, [], message); }
    finally { page.off('download', onDownload); }
}
async function selectRepeated(page, quote, occurrence) {
    await page.evaluate(({ quote, occurrence }) => {
        const root = document.querySelector('#vocab-passage-content');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = []; let text = '';
        while (walker.nextNode()) { nodes.push({ node: walker.currentNode, start: text.length }); text += walker.currentNode.textContent; }
        const matches = [...text.matchAll(new RegExp(`\\b${quote}\\b`, 'g'))];
        const start = matches[occurrence]?.index;
        if (start === undefined) throw new Error('Repeated real passage occurrence was not found');
        const end = start + quote.length;
        const from = nodes.find(item => item.start <= start && item.start + item.node.length > start);
        const to = nodes.find(item => item.start < end && item.start + item.node.length >= end);
        const range = document.createRange(); range.setStart(from.node, start - from.start); range.setEnd(to.node, end - to.start);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        from.node.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, { quote, occurrence });
    await poll(() => page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot.reading.occurrences.length), occurrence + 1, 'DOM selection must receive a persisted occurrence');
    await page.waitForFunction(() => ReadingVocabReader._selectionPending.size === 0);
}

async function browseFlow(page, protocol) {
    await ready(page, protocol);
    const emptyBackup = await page.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
    assert.equal(await page.evaluate(() => !!window.ReadingVocabReader), false, 'The first Browse entry must load production modules lazily');
    await page.locator('nav button[data-view="browse"]').click();
    const entries = page.locator('#exam-list-container [data-action="vocab-book"]');
    await entries.first().waitFor();
    const examA = await entries.nth(0).getAttribute('data-exam-id');
    const examB = await entries.nth(1).getAttribute('data-exam-id');
    assert.notEqual(examA, examB);
    await entries.first().click(); await readerReady(page, examA);
    const shared = await page.evaluate(() => {
        const text = document.querySelector('#vocab-passage-content').textContent;
        return [...text.matchAll(/\b[a-z]{5,}\b/g)].map(match => match[0]).find(word =>
            [...text.matchAll(new RegExp(`\\b${word}\\b`, 'g'))].length >= 2);
    });
    assert.ok(shared, 'Real packaged passage must provide a repeated selectable term');
    const display = shared[0].toUpperCase() + shared.slice(1);
    await page.evaluate(async display => {
        const current = (await AppData.vocab.getReadingSnapshot()).snapshot;
        const receipt = await AppData.vocab.saveWords([...current.words,
            { id: 'issue160-reviewed', word: display, meaning: 'Preserved definition', note: 'Preserved learner note', repetitions: 7 },
            { id: 'issue160-unrelated', word: 'unrelatedreviewonly', meaning: 'Never an intensive reading association' }]);
        if (!receipt.committed) throw new Error('Canonical review seed was not acknowledged');
    }, display);
    await selectRepeated(page, shared, 0); await selectRepeated(page, shared, 1);
    await poll(() => page.locator('mark.vocab-highlight').evaluateAll(nodes => new Set(nodes.map(node => node.dataset.occurrenceId)).size), 2, 'Both distinct selected occurrences must be visible');
    await page.locator('#vocab-fab').click();
    await manual(page, 'zuluword', 2); await manual(page, 'Café', 3);
    const wordsA = [display, 'zuluword', 'Café'];
    await download(page, page.locator('#vocab-export-btn'), wordsA, `${protocol}-reader-A`);
    await page.locator('#vocab-modal-close').click(); await page.locator('#vocab-reader-back-btn').click();
    await entries.first().click(); await readerReady(page, examA);
    await poll(() => page.locator('mark.vocab-highlight').evaluateAll(nodes => new Set(nodes.map(node => node.dataset.occurrenceId)).size), 2, 'Close/reopen restores exactly the selected occurrences');
    await page.locator('#vocab-reader-back-btn').click();
    await entries.nth(1).click(); await readerReady(page, examB);
    await page.locator('#vocab-fab').click();
    await manual(page, shared.toUpperCase(), 1); await manual(page, 'bravoword', 2); await manual(page, 'Ice   Shelf', 3);
    const wordsB = [display, 'bravoword', 'Ice   Shelf'];
    await download(page, page.locator('#vocab-export-btn'), wordsB, `${protocol}-reader-B`);
    await page.locator('#v-tab-all').click();
    assert.match(await page.locator('#v-tab-all').textContent(), /全部精读生词/);
    await download(page, page.locator('#vocab-export-btn'), [...wordsA, 'bravoword', 'Ice   Shelf'], `${protocol}-reader-global`);
    await page.locator('#vocab-modal-close').click(); await page.locator('#vocab-reader-back-btn').click();
    await ready(page, protocol);
    assert.equal(await page.evaluate(() => !!window.ReadingVocabReader), false, 'Reload gives a cold bookshelf entry');
    await shelf(page); await shelfSettled(page);
    await download(page, card(page, examA).locator('[data-action="export-exam-txt"]'), wordsA, `${protocol}-shelf-A`);
    await page.locator('.bookshelf-search-input').fill('bravoword');
    await poll(() => page.locator('.bookshelf-card').count(), 1, 'Shelf filter should hide A');
    assert.match(await globalButton(page).textContent(), /全部精读生词/);
    await download(page, globalButton(page), [...wordsA, 'bravoword', 'Ice   Shelf'], `${protocol}-filtered-global`);
    await page.locator('.bookshelf-search-input').fill('');
    await card(page, examA).locator('button[data-action="open-reading-vocab"]').click(); await readerReady(page, examA);
    await page.locator('#vocab-fab').click(); await page.locator('#vocab-clear-btn').click();
    await poll(() => page.locator('#vocab-fab-count').textContent(), '0', 'Clear A must acknowledge before export');
    await noDownload(page, () => page.locator('#vocab-export-btn').click(), 'Empty article must not download');
    assert.match(await page.locator('#vocab-toast').textContent(), /空|暂无/);
    await page.locator('#vocab-modal-close').click(); await page.locator('#vocab-reader-back-btn').click(); await shelfSettled(page);
    await download(page, card(page, examB).locator('[data-action="export-exam-txt"]'), wordsB, `${protocol}-B-after-clear-A`);
    await download(page, globalButton(page), wordsB, `${protocol}-global-after-clear-A`);
    const persisted = await snapshot(page);
    assert.equal(persisted.words.find(word => word.id === 'issue160-reviewed').repetitions, 7);
    assert.equal(persisted.reading.associations.filter(row => row.articleId === JSON.stringify(['article', JSON.stringify(['source', 'builtin', 'default']), examA])).length, 0);
    assert.deepEqual(await page.evaluate(() => AppData.practice.list()), []);
    pass(`${protocol}-browse-reopen-cold-shelf-A-B-scope-canonical-bytes-clear`, { examA, examB, shared, repeatedOccurrences: 2, globalAfterClear: wordsB.length });
    return { examA, examB, wordsB, emptyBackup };
}

async function multiWindow(page, context, protocol, { examB, wordsB }) {
    const other = await context.newPage();
    try {
        await ready(other, protocol);
        const concurrent = await Promise.all([collect(page, 'issue160-window-A', 'windowalpha'), collect(other, 'issue160-window-B', 'windowbeta')]);
        assert.ok(concurrent.every(receipt => receipt.committed === true && receipt.saved === true));
        await shelfSettled(page);
        await download(page, globalButton(page), [...wordsB, 'windowalpha', 'windowbeta'], `${protocol}-concurrent-additions`);
        // Pause only the real kernel boundary, then let the other page delete.
        // No fake persistence implementation or in-memory IndexedDB is used.
        await other.evaluate(() => {
            const proto = window.__txtKernelPrototype;
            const mutate = proto.mutate;
            proto.mutate = async function(changes, options) {
                if (options?.operationId === 'issue160-delayed') {
                    window.__txtAttempts = (window.__txtAttempts || 0) + 1;
                    if (!window.__txtBlocked) {
                        window.__txtBlocked = true;
                        await new Promise(resolve => { window.__txtRelease = resolve; });
                    }
                }
                return mutate.call(this, changes, options);
            };
            window.__txtPending = AppData.vocab.mutateReading('collect', {
                source: { kind: 'builtin', id: 'default' }, article: { examId: 'issue160-window-A', title: 'issue160-window-A' },
                word: { word: 'windowalpha' }, manual: true
            }, { operationId: 'issue160-delayed' }).then(receipt => ({ receipt }), error => ({ code: error.code, committed: error.committed }));
        });
        await other.waitForFunction(() => window.__txtBlocked === true);
        const id = await articleId(page, 'issue160-window-A');
        assert.equal((await page.evaluate(articleId => AppData.vocab.mutateReading('clearArticle', { articleId }), id)).committed, true);
        const stale = await other.evaluate(async () => { window.__txtRelease(); return window.__txtPending; });
        assert.deepEqual(stale, { code: 'CONFLICT', committed: false });
        await shelfSettled(page);
        await download(page, globalButton(page), [...wordsB, 'windowbeta'], `${protocol}-deletion-fences-stale-window`);
        // Inject an actual IndexedDB transaction failure at its put boundary.
        await card(page, examB).locator('button[data-action="open-reading-vocab"]').click(); await readerReady(page, examB);
        await page.locator('#vocab-fab').click();
        const before = await snapshot(page);
        await page.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            window.__txtRestorePut = () => { IDBObjectStore.prototype.put = put; };
            IDBObjectStore.prototype.put = function(value, ...args) {
                if (value?.logicalKey === 'vocab.readingState') {
                    window.__txtFailedPuts = (window.__txtFailedPuts || 0) + 1;
                    throw new DOMException('Issue 160 injected storage failure', 'QuotaExceededError');
                }
                return put.call(this, value, ...args);
            };
        });
        await page.locator('#vocab-manual-input').fill('failedwriteword'); await page.locator('#vocab-manual-add-btn').click();
        await page.waitForFunction(() => window.__txtFailedPuts > 0 && document.querySelector('#vocab-toast')?.textContent.includes('失败'));
        assert.deepEqual(await snapshot(page), before, 'A failed UI write cannot acknowledge or partially persist vocabulary');
        assert.equal(await page.locator('#vocab-fab-count').textContent(), String(wordsB.length));
        await page.evaluate(() => window.__txtRestorePut());
        await download(page, page.locator('#vocab-export-btn'), wordsB, `${protocol}-after-failed-acknowledgement`);
        await page.locator('#vocab-modal-close').click(); await page.locator('#vocab-reader-back-btn').click();
        const missingSource = { kind: 'imported', id: 'issue160-missing-library' };
        assert.equal((await collect(page, 'issue160-missing-article', 'missingword', {}, missingSource)).committed, true);
        await shelfSettled(page);
        await card(page, 'issue160-missing-article').locator('button[data-action="open-reading-vocab"]').click();
        await page.locator('.vocab-error-state').waitFor();
        assert.equal(await page.evaluate(() => ReadingVocabReader.currentPayload), null);
        await page.locator('#vocab-fab').click();
        await download(page, page.locator('#vocab-export-btn'), ['missingword'], `${protocol}-missing-source-reader`);
        await page.locator('#vocab-modal-close').click(); await page.locator('#vocab-reader-back-btn').click();
        await download(page, card(page, 'issue160-missing-article').locator('[data-action="export-exam-txt"]'), ['missingword'], `${protocol}-missing-source-shelf`);
        pass(`${protocol}-actual-indexeddb-concurrent-add-delete-failed-acknowledgement-missing-source`, { staleResult: stale, concurrentRevisions: concurrent.map(row => row.revision) });
    } finally { await other.close(); }
}

async function migrationAndBackups(protocol, emptyBackup) {
    const context = await newContext();
    try {
        await context.addInitScript(() => {
            if (sessionStorage.getItem('issue160-legacy-seeded')) return;
            sessionStorage.setItem('issue160-legacy-seeded', '1');
            localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify([
                { id: 'issue160-legacy', word: 'Legacyword', examId: 'issue160-legacy-article', examTitle: 'Legacy retained article',
                    source: { kind: 'imported', id: 'issue160-legacy-library' }, createdAt: '2026-09-08T01:00:00.000Z', note: 'Never export this note' }
            ]));
        });
        const page = await context.newPage(); await ready(page, protocol); await shelf(page); await shelfSettled(page);
        await download(page, globalButton(page), ['Legacyword'], `${protocol}-after-migration`);
        const backup = await page.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
        const other = await context.newPage(); await ready(other, protocol);
        assert.equal((await collect(other, 'issue160-merged', 'Line\r\nBreak')).committed, true);
        const importBackup = (data, replace = false) => page.evaluate(async ({ data, replace }) => {
            const plan = await AppData.backups.previewImport(data, { replace });
            return AppData.backups.commitImport(plan.id, { confirmDestructive: replace });
        }, { data, replace });
        assert.equal((await importBackup(backup)).committed, true); await shelfSettled(page);
        await download(page, globalButton(page), ['Legacyword', 'Line\r\nBreak'], `${protocol}-after-merge-newline-normalization`);
        const id = await articleId(page, 'issue160-legacy-article', { kind: 'imported', id: 'issue160-legacy-library' });
        assert.equal((await other.evaluate(articleId => AppData.vocab.mutateReading('clearArticle', { articleId }), id)).committed, true);
        assert.equal((await importBackup(backup)).committed, true); await shelfSettled(page);
        await download(page, globalButton(page), ['Line\r\nBreak'], `${protocol}-merge-retains-deletion`);
        const stale = await state(other);
        assert.equal((await importBackup(emptyBackup, true)).committed, true); await shelfSettled(page);
        assert.equal((await snapshot(page)).reading.associations.length, 0);
        const conflict = await other.evaluate(async stale => {
            try { await AppData.vocab.mutateReading('collect', {
                source: { kind: 'builtin', id: 'default' }, article: { examId: 'issue160-merged', title: 'issue160-merged' },
                word: { word: 'resurrectedword' }, manual: true
            }, { observedRevision: stale.revision, observedGeneration: stale.generation }); return null; }
            catch (error) { return { code: error.code, committed: error.committed }; }
        }, stale);
        assert.deepEqual(conflict, { code: 'CONFLICT', committed: false });
        assert.equal(await globalButton(page).isDisabled(), true, 'An empty global export has an explicitly disabled control');
        await noDownload(page, async () => assert.equal(await page.evaluate(() => ReadingBookshelfStore.exportAllBookshelfTxt()), false), 'Empty replace must produce no download');
        await other.evaluate(() => {
            localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify([{ id: 'stale', word: 'resurrectedword', examId: 'stale' }]));
            localStorage.setItem('ielts_reading_bookshelf_exams_v1', JSON.stringify([{ examId: 'stale', firstUsedAt: 1 }]));
        });
        await ready(page, protocol); await shelf(page); await shelfSettled(page);
        await ready(other, protocol);
        assert.equal((await snapshot(page)).reading.associations.length, 0);
        assert.deepEqual(await snapshot(other), await snapshot(page), 'Both windows must reload the empty authoritative replacement');
        assert.equal(await globalButton(page).isDisabled(), true);
        await noDownload(page, async () => assert.equal(await page.evaluate(() => ReadingBookshelfStore.exportAllBookshelfTxt()), false), 'Reload must not resurrect migrated mirrors');
        pass(`${protocol}-migration-merge-deletion-empty-replace-stale-window-reload`, { emptyExport: false, staleResult: conflict });
    } finally { await context.close(); }
}

try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    report.browser = browser.version(); persist();
    const protocols = ['http', 'https', 'file'];
    const results = await Promise.allSettled(protocols.map(async protocol => {
        const context = await newContext(); let fixtures;
        try {
            const page = await context.newPage();
            fixtures = await checkpoint(`${protocol}-production-browse-download-flow`, () => browseFlow(page, protocol));
            await checkpoint(`${protocol}-multi-window-indexeddb`, () => multiWindow(page, context, protocol, fixtures));
        } finally { await context.close(); }
        await checkpoint(`${protocol}-migration-backup-authority`, () => migrationAndBackups(protocol, fixtures.emptyBackup));
    }));
    report.protocols = results.map((result, index) => ({ protocol: protocols[index], status: result.status === 'fulfilled' ? 'pass' : 'fail',
        ...(result.status === 'rejected' ? { error: result.reason?.stack || String(result.reason) } : {}) }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'TXT release qualification failed');
    report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = error.stack || String(error); process.exitCode = 1; }
finally {
    persist();
    if (browser) await browser.close();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => secureServer.close(resolve))]);
    console.log(JSON.stringify(report, null, 2));
}
