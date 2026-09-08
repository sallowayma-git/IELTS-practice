#!/usr/bin/env node
/** Real Chromium regression for #157. Run with --baseline-only to prove the old collision. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
const baselineSha = '0d6833dda6a28cf1ea7f4d92a060f3625b512505';
const baselineOnly = process.argv.includes('--baseline-only');
const baselineFile = path.join(reports, 'issue157-baseline-reading-page.bundle.js');
const practicePath = 'assets/generated/reading-exams/reading-practice-unified.html';
const examId = 'p2-low-08';
fs.mkdirSync(reports, { recursive: true });
if (baselineOnly && !fs.existsSync(baselineFile)) {
    fs.writeFileSync(baselineFile, execFileSync('git', ['show', `${baselineSha}:js/bundles/reading-page.bundle.js`], { cwd: root, maxBuffer: 8_000_000 }));
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
        let body = fs.readFileSync(filename);
        if (baselineOnly && relative === 'js/bundles/reading-page.bundle.js') {
            // Expose the existing collector without changing its implementation.
            body = fs.readFileSync(baselineFile, 'utf8').replace('                buildReplayResults,', '                collectAnswers,\n                collectCurrentDraft,\n                buildReplayResults,');
        }
        res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--allow-file-access-from-files'] }).catch(async error => {
    await new Promise(resolve => server.close(resolve));
    throw error;
});
const report = { generatedAt: new Date().toISOString(), baselineSha, browser: browser.version(), cases: [] };

async function newContext() {
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
        const records = [];
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function(type, fn, options) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            if (!records.some(item => item.target === this && item.type === type && item.fn === fn && item.capture === capture)) {
                records.push({ target: this, type, fn, capture });
            }
            return add.call(this, type, fn, options);
        };
        EventTarget.prototype.removeEventListener = function(type, fn, options) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const index = records.findIndex(item => item.target === this && item.type === type && item.fn === fn && item.capture === capture);
            if (index >= 0) records.splice(index, 1);
            return remove.call(this, type, fn, options);
        };
        window.__readerListenerCounts = () => {
            const overlay = document.getElementById('reading-vocab-reader-overlay');
            return records.reduce((counts, { target, type }) => {
                const scope = target === window ? 'window' : target === document ? 'document' : overlay?.contains(target) ? 'reader' : '';
                if (scope) counts[`${scope}:${type}`] = (counts[`${scope}:${type}`] || 0) + 1;
                return counts;
            }, {});
        };
    });
    return context;
}

async function practiceReady(page) {
    await page.waitForFunction(() => document.querySelector('#question-groups input[name="q1"]') && window.__IELTS_UNIFIED_READING_PAGE_TEST__, null, { timeout: 30_000 });
}

async function openReader(page, useEntry = true) {
    if (useEntry) await page.locator('#reading-vocab-header-btn').click();
    else await page.evaluate(id => ReadingVocabReader.open(id, { fromPractice: true }), examId);
    await page.locator('#vocab-reader-tabs [data-para="questions"]').waitFor();
}

async function baselineCollision() {
    const context = await newContext();
    try {
        const page = await context.newPage();
        await page.goto(`${origin}/${practicePath}?examId=${examId}`);
        await practiceReady(page);
        await page.locator('#question-groups input[name="q1"][value="A"]').check();
        await openReader(page, false); // The integration baseline intentionally gates the practice button.
        await page.locator('#vocab-reader-tabs [data-para="questions"]').click();
        await page.locator('#vocab-questions-content input[name="q1"][value="B"]').check();
        await page.locator('#vocab-reader-back-btn').click();
        const collision = await page.evaluate(() => ({
            originalA: document.querySelector('#question-groups input[name="q1"][value="A"]').checked,
            hiddenB: document.querySelector('#vocab-questions-content input[name="q1"][value="B"]').checked,
            collected: window.__IELTS_UNIFIED_READING_PAGE_TEST__.collectAnswers().q1
        }));
        assert.deepEqual(collision, { originalA: false, hiddenB: true, collected: 'B' });
        await page.screenshot({ path: path.join(reports, 'issue157-baseline-collision.png') });
        report.cases.push({ name: 'before-fix-real-radio-collision', status: 'pass', ...collision });
    } finally { await context.close(); }
}

async function hostReady(page, protocol) {
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : `${origin}/index.html`;
    await page.goto(`${url}?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60_000 });
    await page.evaluate(async () => { await AppData.ready; await window.LicenseModal?.accept(); });
    await page.evaluate(() => {
        document.querySelector('#library-loader-overlay [data-library-action="close"]')?.click();
        document.querySelector('nav button[data-view="browse"]')?.click();
    });
    await page.waitForFunction(async id => typeof window.app?.openExam === 'function' && (await window.resolveActiveLibraryIndex()).some(exam => exam.id === id), examId, { timeout: 60_000 });
    await page.evaluate(() => window.AppLazyLoader.ensureGroup('browse-runtime'));
    await page.waitForFunction(() => !!window.ReadingVocabReader);
}

async function hostSnapshot(page) {
    return page.evaluate(async () => ({
        history: await AppData.practice.list({ projection: 'full' }),
        active: (await AppData.recovery.listActiveSessions()).map(item => ({ id: item.id, examId: item.examId, sessionId: item.sessionId })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
        interrupted: await AppData.recovery.listInterrupted(),
        sessions: [...(window.app.components.practiceRecorder?.activeSessions || [])].map(([id, value]) => ({ id, sessionId: value.sessionId, startTime: value.startTime })),
        windows: [...(window.app.examWindows || [])].map(([id, value]) => ({ id, sessionId: value.expectedSessionId }))
    }));
}

async function practiceSnapshot(page) {
    return page.evaluate(() => {
        const api = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
        const state = api.getTestState();
        const answers = api.collectAnswers();
        const results = api.buildResultsFromAnswers(window.__READING_EXAM_DATA__.get(state.dataKey), answers);
        return { state, answers, results, draft: api.collectCurrentDraft(), timer: window.__IELTS_PRACTICE_TIMER__.getSnapshot() };
    });
}

async function selectWord(page, selector, word = '') {
    return page.evaluate(({ selector, word }) => {
        const target = document.querySelector(selector);
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let text;
        while ((text = walker.nextNode())) {
            if (text.parentElement.closest('button, script, style, .vocab-paragraph-tag, .vocab-translation-card, .hl, mark')) continue;
            const match = word ? text.textContent.indexOf(word) : text.textContent.search(/[A-Za-z]{5,}/);
            if (match < 0) continue;
            const selected = word || text.textContent.slice(match).match(/^[A-Za-z]+/)[0];
            const range = document.createRange();
            range.setStart(text, match);
            range.setEnd(text, match + selected.length);
            const selection = getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            text.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            return selected;
        }
        throw new Error(`No selectable word in ${selector}`);
    }, { selector, word });
}

async function finalRegression(protocol) {
    const context = await newContext();
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    try {
        await hostReady(page, protocol);
        const empty = await hostSnapshot(page);
        await page.evaluate(() => window.app.browseCategory('all', 'reading'));
        const browseEntry = page.locator('#exam-list-container [data-action="vocab-book"]').first();
        await browseEntry.waitFor();
        const readerOnlyExamId = await browseEntry.getAttribute('data-exam-id');
        for (const entry of ['Browse', 'Bookshelf']) {
            if (entry === 'Browse') await browseEntry.click();
            else {
                await page.locator('nav button[data-view="more"]').click();
                await page.locator('#bookshelf-tool-card').click();
                await page.locator(`#bookshelf-view button[data-action="open-reading-vocab"][data-exam-id="${readerOnlyExamId}"]`).click();
            }
            await page.locator('#vocab-reader-tabs [data-para="questions"]').waitFor();
            await page.locator('#vocab-reader-back-btn').click();
            assert.deepEqual(await hostSnapshot(page), empty, `${protocol}: reader-only ${entry} must not create practice data`);
        }
        const popupPromise = page.waitForEvent('popup');
        await page.evaluate(async id => { await window.app.openExam(id); }, examId);
        const practice = await popupPromise;
        practice.on('dialog', dialog => dialog.accept());
        await practiceReady(practice);
        await practice.waitForFunction(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().sessionId && window.__IELTS_UNIFIED_READING_PAGE_TEST__.getTestState().sessionReadySent);
        await practice.locator('#question-groups input[name="q1"][value="A"]').check();
        await practice.locator('#question-groups input[name="q13"]').fill('adhering');
        // The reported real exam supplies radio/text/dropzone controls. Add checkbox/select
        // fixtures to that actual rendered answer container to exercise the other supported types.
        await practice.evaluate(() => {
            for (const name of ['q2', 'q3']) document.querySelectorAll(`#question-groups input[name="${name}"]`).forEach(node => node.remove());
            const fixture = document.createElement('div');
            fixture.id = 'reader-isolation-answer-fixture';
            fixture.innerHTML = '<input type="checkbox" name="q2" value="A" checked><input type="checkbox" name="q2" value="C" checked><select name="q3"><option value="">Choose</option><option value="D" selected>Delta</option></select>';
            document.querySelector('#question-groups').append(fixture);
            fixture.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await selectWord(practice, '#left');
        await practice.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.updateSelectionToolbar());
        await practice.locator('#btnHL').click();
        assert.ok(await practice.locator('#left .hl').count(), 'practice selection highlighting must work');
        await selectWord(practice, '#left');
        await practice.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.updateSelectionToolbar());
        await practice.locator('#btnNote').click();
        await practice.locator('#reading-note-editor [data-note-body]').fill('Reader isolation regression note');
        await practice.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.closeNoteEditor());
        await page.waitForFunction(async id => (await AppData.recovery.listDrafts()).some(draft => draft.examId === id && draft.answers?.q1 === 'A'), examId);
        const before = await practiceSnapshot(practice);
        assert.equal(before.answers.q1, 'A');
        assert.deepEqual(before.answers.q2, ['A', 'C']);
        assert.equal(before.answers.q3, 'D');
        assert.equal(before.answers.q13, 'adhering');
        assert.ok(before.state.notes.some(note => note.body === 'Reader isolation regression note'));
        const hostBefore = await hostSnapshot(page);
        let firstListenerCounts;
        for (let cycle = 0; cycle < 3; cycle++) {
            await openReader(practice);
            assert.equal(await practice.locator('#vocab-reader-tabs [data-para="all"]').getAttribute('class').then(value => value.includes('active')), true);
            assert.equal(await practice.locator('#vocab-passage-content').isVisible(), true);
            await practice.locator('#vocab-reader-tabs [data-para="questions"]').click();
            assert.equal(await practice.locator('#vocab-questions-content').isVisible(), true);
            assert.equal(await practice.locator('#vocab-questions-content input, #vocab-questions-content select, #vocab-questions-content textarea, #vocab-questions-content [contenteditable="true"]').count(), 0);
            assert.equal(await practice.locator('#vocab-questions-content [draggable="true"], #vocab-questions-content .drop-target-summary, #vocab-questions-content [data-question]').count(), 0);
            const selected = await selectWord(practice, '#vocab-questions-content');
            await practice.waitForFunction(word => ReadingVocabStore.getAll().some(entry => entry.word === word), selected);
            assert.deepEqual((await practiceSnapshot(practice)).answers, before.answers, 'reader selection must preserve every answer');
            if (cycle === 0) {
                await practice.screenshot({ path: path.join(reports, `issue157-${protocol}-questions.png`) });
                await practice.evaluate(() => {
                    const foreign = document.createElement('div');
                    foreign.id = 'reader-isolation-foreign-controls';
                    foreign.hidden = true;
                    foreign.innerHTML = '<input type="checkbox" name="q2" value="Z" checked><input type="radio" name="q16" value="B" checked><input type="text" name="q14" value="foreign"><select name="q15"><option selected value="foreign">Foreign</option></select>';
                    document.body.append(foreign);
                });
                assert.deepEqual((await practiceSnapshot(practice)).answers, before.answers, 'answer collection must exclude independently injected hidden controls');
                await practice.evaluate(() => document.getElementById('reader-isolation-foreign-controls').remove());
                await practice.waitForFunction(duration => window.__IELTS_PRACTICE_TIMER__.getSnapshot().durationSeconds > duration, before.timer.durationSeconds);
            }
            await practice.locator('#vocab-reader-back-btn').click();
            assert.equal(await practice.locator('#reading-vocab-header-btn').evaluate(node => node === document.activeElement), true, 'close must restore practice entry focus');
            assert.equal(await practice.locator('#reading-vocab-reader-overlay input[name], #reading-vocab-reader-overlay select[name], #reading-vocab-reader-overlay textarea[name]').count(), 0);
            const listenerCounts = await practice.evaluate(() => window.__readerListenerCounts());
            if (!firstListenerCounts) firstListenerCounts = listenerCounts;
            else assert.deepEqual(listenerCounts, firstListenerCounts, 'repeated cycles must not accumulate active listeners');
        }
        const after = await practiceSnapshot(practice);
        assert.deepEqual(after.answers, before.answers);
        assert.deepEqual(after.results, before.results, 'answer comparisons and score calculation must remain identical');
        for (const key of ['examId', 'sessionId', 'windowSessionToken', 'sessionReadySent', 'submitted', 'submissionStatus', 'readOnly', 'reviewMode', 'notes']) {
            assert.deepEqual(after.state[key], before.state[key], `${protocol}: practice ${key} changed`);
        }
        assert.deepEqual(after.draft.highlights, before.draft.highlights);
        assert.deepEqual(after.draft.notes, before.draft.notes);
        assert.equal(after.timer.anchorMs, before.timer.anchorMs);
        assert.equal(after.timer.running, before.timer.running);
        assert.ok(after.timer.durationSeconds > before.timer.durationSeconds);
        assert.deepEqual(await hostSnapshot(page), hostBefore, `${protocol}: practice/history/recovery ownership changed`);
        const draft = await page.evaluate(async id => (await AppData.recovery.listDrafts()).find(item => item.examId === id), examId);
        assert.deepEqual(draft.answers, before.answers, 'persisted recovery answer payload must remain identical');
        // Check annotation and dictionary UI after returning, with a deterministic lookup provider.
        const oldHighlightCount = await practice.locator('#left .hl').count();
        await selectWord(practice, '#left');
        await practice.evaluate(() => window.__IELTS_UNIFIED_READING_PAGE_TEST__.updateSelectionToolbar());
        await practice.locator('#btnHL').click();
        assert.ok(await practice.locator('#left .hl').count() > oldHighlightCount);
        await practice.evaluate(() => {
            window.__dictionaryLookups = [];
            window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTestState({ reviewMode: true });
            window.ReviewHighlightDictionary.enhance({ lookupService: { lookup(term) {
                window.__dictionaryLookups.push(term);
                return { found: false, requested: term, term, reason: 'regression-fixture' };
            } } });
        });
        const reviewHighlight = practice.locator('#left .hl:not([data-note-id])').first();
        const highlightWord = await reviewHighlight.textContent();
        await reviewHighlight.click();
        await practice.locator('#review-highlight-dictionary-bubble').waitFor({ state: 'visible' });
        assert.deepEqual(await practice.evaluate(() => window.__dictionaryLookups), [highlightWord]);
        await practice.evaluate(() => {
            window.__IELTS_UNIFIED_READING_PAGE_TEST__.setTestState({ reviewMode: false });
            window.ReviewHighlightDictionary.close();
        });
        await practice.screenshot({ path: path.join(reports, `issue157-${protocol}-preserved.png`) });
        report.cases.push({ name: `${protocol}-hosted-practice-isolation`, status: 'pass', readerOnlyEntries: ['Browse button', 'Bookshelf button'], sessionId: before.state.sessionId, answers: before.answers, timerBefore: before.timer.durationSeconds, timerAfter: after.timer.durationSeconds, annotationAndReviewDictionary: 'pass (deterministic lookup provider)', activeListenerCounts: firstListenerCounts });
    } finally { await context.close(); }
}

try {
    if (baselineOnly) await baselineCollision();
    else for (const protocol of ['http', 'file']) await finalRegression(protocol);
    report.status = 'pass';
} catch (error) {
    report.status = 'fail';
    report.error = error.stack || String(error);
    process.exitCode = 1;
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(reports, baselineOnly ? 'reading-reader-isolation-baseline.json' : 'reading-reader-isolation-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
