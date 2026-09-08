#!/usr/bin/env node
/** #158: production reader rendering, DOM Range selection, and IndexedDB receipts. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
const source = { kind: 'builtin', id: 'default' };
const fixtureId = 'issue158-occurrence-fixture';
const reviewedCoral = {
    id: 'issue158-reviewed-coral', word: 'coral', meaning: 'A preserved definition',
    note: 'A preserved learner note', easeFactor: 2.4, repetitions: 8, interval: 32,
    correctCount: 11, lastReviewed: '2026-09-01T00:00:00.000Z',
    nextReview: '2026-10-03T00:00:00.000Z',
    reviewHistory: [{ at: '2026-09-01T00:00:00.000Z', grade: 4 }]
};
const longLead = 'A scientist recorded the changing temperature and light around the ocean. '.repeat(9);
const fixture = {
    schemaVersion: 'ReadingExamSourceV1', examId: fixtureId,
    meta: { title: 'Occurrence regression fixture', category: 'P1' },
    passage: { blocks: [
        { blockId: 'first-block', kind: 'text', bodyHtml: `<h2>READING PASSAGE 1</h2><p>You should spend about 20 minutes on Questions 1–3.</p><h3>Occurrence regression fixture</h3><h5>Every ordered block survives</h5><p>The first coral is close to the shore. ${longLead}The second <em>cor</em>al shelters tiny fish beside this distinctive ledge. A distantword appears near the end. The third coral grows deeper.</p><p>A (keyboardword), remains available for keyboard collection, while touchword supports a touch selection.</p><p>The preserved <span class="hl" data-note-id="issue158-original">annotationword</span> belongs to the practice annotation system.</p>` },
        { blockId: 'second-block', kind: 'text', html: '<h4>Second ordered block</h4><p>A second block contains finalblockword and must remain after the first block.</p>' }
    ] },
    questionGroups: [
        { groupId: 'question-first', kind: 'sentence_completion', questionIds: ['q1'], leadHtml: '<p>Choose ONE WORD ONLY from the passage.</p>', bodyHtml: '<h4>Questions 1–2</h4><p>1. The coral grows near questionword. <input name="q1" id="q1" type="text"></p>' },
        { groupId: 'question-second', kind: 'true_false_not_given', questionIds: ['q2'], bodyHtml: '<h4>Question 2</h4><p>2. Different coral belongs to a separate question section.</p><label><input type="radio" name="q2" id="q2" value="true">True</label>' }
    ], answerKey: { q1: 'coral', q2: 'true' }
};
fs.mkdirSync(reports, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
        const body = fs.readFileSync(filename);
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
const report = { generatedAt: new Date().toISOString(), browser: browser.version(), cases: [] };
const pass = (name, evidence = {}) => report.cases.push({ name, status: 'pass', ...evidence });

async function ready(page, protocol = 'http') {
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : `${origin}/index.html`;
    await page.goto(`${url}?test_env=1`);
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60_000 });
    await page.evaluate(async () => {
        await AppData.ready;
        await window.LicenseModal?.accept();
        document.querySelector('#library-loader-overlay [data-library-action="close"]')?.click();
        await window.AppLazyLoader.ensureGroup('browse-runtime');
    });
    await page.waitForFunction(() => !!window.ReadingVocabReader);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
    await page.evaluate(() => {
        // Observe the production mutation boundary; do not replace its implementation.
        window.__occurrenceReceipts = [];
        const mutate = ReadingVocabStore.mutate;
        ReadingVocabStore.mutate = async function(type, command, ...options) {
            const receipt = await mutate.call(this, type, command, ...options);
            window.__occurrenceReceipts.push({ type, saved: receipt.saved, revision: receipt.revision });
            return receipt;
        };
    });
}

async function open(page, id = fixtureId, payload = null) {
    await page.evaluate(async ({ id, payload, source }) => {
        if (payload) window.__READING_EXAM_DATA__.register(id, payload);
        await ReadingVocabReader.open(id, { source });
    }, { id, payload, source });
    await page.locator('#vocab-reader-tabs [data-para="questions"]').waitFor();
    assert.equal(await page.locator('.vocab-error-state').count(), 0);
}

async function snapshot(page) {
    return page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
}

async function occurrences(page, word = null, article = fixtureId) {
    return page.evaluate(async ({ word, article, source }) => {
        const state = (await AppData.vocab.getReadingSnapshot()).snapshot;
        const model = AppData.vocab.readingModel;
        return model.query(state, { articleId: model.articleId(source, article) }).terms
            .filter(row => !word || row.word.word.toLowerCase() === word.toLowerCase())
            .flatMap(row => row.occurrences);
    }, { word, article, source });
}

async function waitForOccurrences(page, count, word = null) {
    // Playwright waitForFunction treats a returned Promise as truthy; poll the
    // acknowledged async persistence read explicitly rather than racing it.
    const deadline = Date.now() + 15_000;
    while ((await occurrences(page, word)).length !== count) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${count} acknowledged ${word || 'total'} occurrences`);
        await page.waitForTimeout(50);
    }
    await page.waitForFunction(() => ReadingVocabReader._selectionPending.size === 0 && !ReadingVocabReader._occurrenceBusy);
}

async function select(page, selector, quote, occurrence = 0, event = 'mouse') {
    return page.evaluate(({ selector, quote, occurrence, event }) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error(`Missing selection root: ${selector}`);
        const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let text = '';
        while (walker.nextNode()) {
            const node = walker.currentNode;
            nodes.push({ node, start: text.length });
            text += node.textContent;
        }
        let start = -1;
        for (let index = 0; index <= occurrence; index++) start = text.indexOf(quote, start + 1);
        if (start < 0) throw new Error(`Missing occurrence ${occurrence} of ${quote}`);
        const end = start + quote.length;
        const from = nodes.find(item => item.start <= start && item.start + item.node.length > start);
        const to = nodes.find(item => item.start < end && item.start + item.node.length >= end);
        const range = document.createRange();
        range.setStart(from.node, start - from.start);
        range.setEnd(to.node, end - to.start);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const eventTarget = from.node.parentElement;
        if (event === 'mouse') eventTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        else if (event === 'touch') eventTarget.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
        else if (event === 'keyboard') eventTarget.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
        return { start, end, quote: range.toString(), crossesInlineNodes: from.node !== to.node };
    }, { selector, quote, occurrence, event });
}

async function marks(page, selector = '#vocab-passage-content') {
    return page.locator(`${selector} mark.vocab-highlight`).evaluateAll(nodes => {
        const grouped = new Map();
        for (const node of nodes) {
            if (grouped.has(node.dataset.occurrenceId)) {
                const existing = grouped.get(node.dataset.occurrenceId);
                existing.text += node.textContent;
                existing.fragments += 1;
            } else {
                const range = document.createRange();
                range.selectNodeContents(node.closest('.vocab-paragraph-text') || node.closest('[data-vocab-scope]'));
                range.setEndBefore(node);
                grouped.set(node.dataset.occurrenceId, { text: node.textContent,
                    occurrenceId: node.dataset.occurrenceId, fragments: 1,
                    scope: node.closest('[data-vocab-scope]')?.dataset.vocabScope,
                    before: range.toString() });
            }
        }
        return [...grouped.values()];
    });
}

async function selectWithKeyboard(page, quote) {
    await select(page, '#vocab-passage-content', quote, 0, 'none');
    await page.evaluate(() => {
        const selection = getSelection();
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(true);
        range.startContainer.parentElement.closest('[data-vocab-scope]').focus();
        selection.removeAllRanges();
        selection.addRange(range);
    });
    await page.keyboard.down('Shift');
    for (let index = 0; index < quote.length; index++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => getSelection().toString()), quote, 'trusted keyboard events must build the intended real DOM Range');
    await page.waitForTimeout(75);
    assert.equal((await occurrences(page, 'keyboardword')).length, 0, 'holding Shift while extending a selection must not save partial words');
    await page.keyboard.up('Shift');
}

async function assets(page) {
    for (const id of ['p1-high-216', 'p2-high-192', 'p2-low-051', 'p1-high-101', 'p1-high-171', 'p1-high-229', 'p2-low-08']) {
        await open(page, id);
        const evidence = await page.evaluate(() => {
            const reader = ReadingVocabReader;
            const overlay = document.querySelector('#reading-vocab-reader-overlay');
            const visibleText = overlay.querySelector('#vocab-passage-content').textContent;
            const rendered = [overlay.querySelector('#vocab-passage-title').textContent, overlay.querySelector('#vocab-passage-intro').textContent, visibleText].join(' ');
            const normalize = value => value.replace(/\s+/g, ' ').trim();
            const doc = document.createElement('div');
            doc.innerHTML = (reader.currentPayload.passage?.blocks || []).map(block => block.bodyHtml || block.html || '').join('\n');
            const expected = [...doc.querySelectorAll('p,h3,h4,h5')]
                .filter(node => !node.closest('.paragraph-dropzone,.dropzone,.match-dropzone,script,style'))
                .map(node => normalize(node.textContent)).filter(text => text.length >= 40);
            const missing = expected.filter(text => !normalize(rendered).includes(text));
            const ids = [...overlay.querySelectorAll('[id]')].map(node => node.id);
            const scopes = [...overlay.querySelectorAll('[data-vocab-scope]')].map(node => node.dataset.vocabScope);
            return { characters: normalize(visibleText).length, expectedParagraphs: expected.length, missing, duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index), duplicateScopes: scopes.filter((id, index) => scopes.indexOf(id) !== index), paragraphCount: overlay.querySelectorAll('.vocab-paragraph-text').length, h5: [...doc.querySelectorAll('h5')].map(node => normalize(node.textContent)), rendered: normalize(rendered) };
        });
        assert.ok(evidence.characters > 1000, `${id}: passage must be nonempty`);
        assert.deepEqual(evidence.missing, [], `${id}: all source paragraphs and instructions must survive`);
        assert.deepEqual(evidence.duplicateIds, [], `${id}: DOM IDs must be unique`);
        assert.deepEqual(evidence.duplicateScopes, [], `${id}: internal scope identities must be unique`);
        for (const subtitle of evidence.h5) assert.ok(evidence.rendered.includes(subtitle), `${id}: H5 subtitle must survive`);
        delete evidence.rendered;
        pass(`${id}-complete-render-and-identities`, evidence);
    }
}

async function occurrenceRegression(page, protocol) {
    await page.evaluate(async word => {
        const receipt = await AppData.vocab.saveWords([word]);
        if (receipt.committed !== true) throw new Error('Canonical review seed was not acknowledged');
    }, reviewedCoral);
    await open(page, fixtureId, fixture);
    const ordered = await page.locator('#vocab-passage-content').textContent();
    assert.ok(ordered.indexOf('first coral') < ordered.indexOf('finalblockword'));
    assert.ok(await page.locator('#vocab-passage-intro').textContent().then(text => text.includes('Every ordered block survives')));
    const scopes = await page.locator('[data-vocab-scope]').evaluateAll(nodes => nodes.map(node => node.dataset.vocabScope));
    assert.equal(new Set(scopes).size, scopes.length);
    const annotationBefore = await page.locator('#vocab-passage-content .hl').evaluateAll(nodes => nodes.map(node => node.outerHTML));
    assert.equal(annotationBefore.length, 1);
    const second = await select(page, '.vocab-paragraph-text', 'coral', 1);
    assert.equal(second.crossesInlineNodes, true, 'selected second term must cross real inline text nodes');
    assert.ok(second.start > 500, 'selected context must come from far into a long paragraph');
    await waitForOccurrences(page, 1, 'coral');
    const [saved] = await occurrences(page, 'coral');
    let highlighted = await marks(page);
    assert.equal(highlighted.length, 1, JSON.stringify(await page.evaluate(saved => ({ saved,
        unresolved: ReadingVocabReader.unresolvedOccurrences,
        resolved: ReadingVocabAnchors.resolve(document.querySelector('#vocab-reader-body'), saved)?.toString(),
        toast: document.querySelector('#vocab-toast').textContent
    }), saved)));
    assert.equal(highlighted[0].text, 'coral');
    assert.equal(highlighted[0].occurrenceId, saved.id);
    assert.equal(highlighted[0].before.length, second.start);
    const coralEntry = await page.evaluate(id => ReadingVocabStore.getByExam(id).find(row => row.word === 'coral'), fixtureId);
    // The selection context is retained on the occurrence even if an existing
    // canonical word owns the learner's original example field.
    assert.ok(saved.quote === 'coral' && saved.before && saved.after);
    if (coralEntry.context) assert.ok(coralEntry.context.includes('coral'));
    assert.deepEqual(await page.locator('#vocab-passage-content .hl').evaluateAll(nodes => nodes.map(node => node.outerHTML)), annotationBefore);
    await page.locator('#vocab-reader-back-btn').click();
    await open(page);
    highlighted = await marks(page);
    assert.equal(highlighted.length, 1);
    assert.equal(highlighted[0].before.length, second.start);
    assert.equal(highlighted[0].occurrenceId, saved.id);

    await select(page, '#vocab-passage-content', 'distantword');
    await waitForOccurrences(page, 1, 'distantword');
    const distantEntry = await page.evaluate(id => ReadingVocabStore.getByExam(id).find(row => row.word === 'distantword'), fixtureId);
    assert.ok(distantEntry, JSON.stringify(await page.evaluate(async id => ({
        projected: ReadingVocabStore.getByExam(id), persisted: (await AppData.vocab.getReadingSnapshot()).snapshot,
        pending: [...ReadingVocabReader._selectionPending], receipts: window.__occurrenceReceipts,
        toast: document.querySelector('#vocab-toast').textContent
    }), fixtureId)));
    assert.ok(distantEntry.context.includes('distantword'), 'stored context must contain a selected term far beyond the first 150 paragraph characters');
    await selectWithKeyboard(page, '(keyboardword),');
    await waitForOccurrences(page, 1, 'keyboardword');
    await select(page, '#vocab-passage-content', 'touchword', 0, 'touch');
    // Browsers may emit a compatibility mouseup after touchend. It must not
    // create a second occurrence for the same selected Range.
    await page.locator('#vocab-passage-content').dispatchEvent('mouseup');
    await waitForOccurrences(page, 1, 'touchword');
    const keyboardEntry = await page.evaluate(id => ReadingVocabStore.getByExam(id).find(row => row.word === 'keyboardword'), fixtureId);
    assert.ok(keyboardEntry.context.includes('keyboardword'));
    await page.locator('#vocab-reader-tabs [data-para="questions"]').click();
    assert.equal(await page.locator('#vocab-questions-content input,#vocab-questions-content select,#vocab-questions-content textarea,#vocab-questions-content [contenteditable="true"]').count(), 0);
    await select(page, '#vocab-questions-content .vocab-question-group', 'coral');
    await waitForOccurrences(page, 2, 'coral');
    const questionMarks = await marks(page, '#vocab-questions-content');
    assert.equal(questionMarks.length, 1);
    assert.notEqual(questionMarks[0].scope, highlighted[0].scope);
    const beforeReload = await occurrences(page);
    const selectionReceipts = await page.evaluate(() => window.__occurrenceReceipts.filter(row => row.type === 'collect'));
    assert.equal(selectionReceipts.length, 5, 'each input path must receive one acknowledged collection receipt');
    assert.ok(selectionReceipts.every(row => row.saved === true));
    await ready(page, protocol);
    await open(page, fixtureId, fixture);
    assert.deepEqual(await occurrences(page), beforeReload, 'actual page reload must retain acknowledged occurrences');
    const allRestored = [...await marks(page), ...await marks(page, '#vocab-questions-content')];
    assert.deepEqual(allRestored.map(mark => mark.occurrenceId).sort(), beforeReload.map(row => row.id).sort(), 'every mouse, touch and keyboard occurrence must visibly restore');
    assert.equal((await marks(page)).filter(mark => mark.text === 'coral').length, 1);
    assert.equal((await marks(page, '#vocab-questions-content')).length, 1);
    assert.deepEqual((await snapshot(page)).words.find(word => word.id === reviewedCoral.id), reviewedCoral, 'collecting an existing canonical word must preserve its original review history');
    await page.screenshot({ path: path.join(reports, `issue158-${protocol}-occurrences.png`) });
    pass(`${protocol}-exact-inline-occurrence-and-input-paths`, { selectedOffset: second.start, persistedOccurrenceIds: beforeReload.map(row => row.id), scopeIds: beforeReload.map(row => row.scopeId), selectionReceipts });
    return { saved, annotationBefore };
}

async function rejectedSelections(page) {
    const before = await snapshot(page);
    await select(page, '#vocab-passage-content', 'annotationword');
    await page.waitForTimeout(75);
    await page.evaluate(() => {
        const start = document.querySelector('.vocab-paragraph-text').firstChild;
        const end = document.querySelectorAll('.vocab-paragraph-text')[1].lastChild;
        const range = document.createRange();
        range.setStart(start, 0); range.setEnd(end, end.childNodes.length || end.length || 0);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.querySelector('#vocab-passage-content').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(75);
    await page.locator('#vocab-reader-tabs [data-para="questions"]').click();
    await page.evaluate(() => {
        const groups = document.querySelectorAll('#vocab-questions-content .vocab-question-group');
        const range = document.createRange(); range.setStart(groups[0], 0); range.setEnd(groups[1], groups[1].childNodes.length);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        groups[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.waitForTimeout(75);
    await select(page, '#vocab-reader-back-btn', '返回题库');
    // Give the production selection debounce a chance to reject every path.
    await page.waitForTimeout(400);
    assert.deepEqual(await snapshot(page), before, 'annotations, controls and cross-section selections must not mutate vocabulary');
    await page.locator('#vocab-reader-tabs [data-para="all"]').click();
    pass('ineligible-and-cross-section-selections-do-not-mutate');
}

async function removalRegression(page, saved, annotationBefore) {
    await page.evaluate(async ({ source, fixtureId }) => {
        for (const examId of [fixtureId, 'issue158-other-article']) {
            const receipt = await ReadingVocabStore.mutate('collect', { source, article: { examId, title: examId }, word: { word: 'coral', meaning: 'Ignored duplicate meaning' }, manual: true, at: '2026-09-08T02:00:00.000Z' });
            if (receipt.saved !== true) throw new Error('Manual association was not acknowledged');
        }
        const receipt = await ReadingVocabStore.mutate('collect', { source, article: { examId: fixtureId, title: fixtureId }, word: { word: 'finalblockword', meaning: 'Manual only' }, manual: true, at: '2026-09-08T02:00:01.000Z' });
        if (receipt.saved !== true) throw new Error('Manual term was not acknowledged');
    }, { source, fixtureId });
    assert.equal((await marks(page)).filter(mark => mark.text === 'finalblockword').length, 0, 'manual terms must not highlight matching text');
    const before = await snapshot(page);
    const selectedMark = page.locator('#vocab-passage-content mark.vocab-highlight[data-word="coral"]').first();
    await selectedMark.click();
    await page.locator('#vocab-occurrence-actions [data-action="remove-occurrence"]').click();
    await waitForOccurrences(page, 1, 'coral');
    assert.equal((await marks(page)).filter(mark => mark.text === 'coral').length, 0);
    const removed = await snapshot(page);
    assert.deepEqual(removed.words, before.words, 'canonical review history must survive occurrence removal');
    assert.deepEqual(removed.lists, before.lists);
    assert.deepEqual(removed.reading.associations, before.reading.associations, 'manual and other article associations must survive');
    assert.ok(removed.reading.occurrences.every(row => row.id !== saved.id));
    await page.locator('[data-action="undo-occurrence"]').click();
    await waitForOccurrences(page, 2, 'coral');
    assert.ok((await occurrences(page, 'coral')).some(row => row.id === saved.id));
    assert.deepEqual((await snapshot(page)).words, before.words);
    assert.deepEqual((await snapshot(page)).lists, before.lists);

    // A sole nonmanual occurrence drops its article association; undo restores
    // that association while the canonical word remains intact throughout.
    await page.locator('mark.vocab-highlight').filter({ hasText: /^keyboardword$/ }).click();
    await page.locator('#vocab-occurrence-actions [data-action="remove-occurrence"]').click();
    await waitForOccurrences(page, 0, 'keyboardword');
    assert.equal(await page.evaluate(id => ReadingVocabStore.getByExam(id).some(row => row.word === 'keyboardword'), fixtureId), false);
    await page.locator('[data-action="undo-occurrence"]').click();
    await waitForOccurrences(page, 1, 'keyboardword');
    assert.deepEqual(await page.locator('#vocab-passage-content .hl').evaluateAll(nodes => nodes.map(node => node.outerHTML)), annotationBefore);
    pass('remove-undo-preserves-manual-other-article-and-canonical-review');
}

async function unresolvedRegression(page, saved) {
    const variants = {
        changed: '<p>The first coral is close to the shore. The selected source text has been rewritten. The third coral grows deeper.</p>',
        missing: '<p>This replacement paragraph has no selected term and the original paragraph is absent.</p>',
        ambiguous: `<p>${saved.before}${saved.quote}${saved.after} A separating sentence. ${saved.before}${saved.quote}${saved.after}</p>`
    };
    for (const [name, bodyHtml] of Object.entries(variants)) {
        const changed = structuredClone(fixture);
        changed.passage.blocks[0].bodyHtml = bodyHtml;
        await open(page, fixtureId, changed);
        assert.equal((await marks(page)).filter(mark => mark.text === 'coral').length, 0, `${name}: must not choose another matching occurrence`);
        assert.ok((await occurrences(page, 'coral')).some(row => row.id === saved.id), `${name}: association and anchor must remain recoverable`);
        assert.ok((await page.locator('#vocab-anchor-status').textContent()).includes('无法定位'));
        await page.locator('#vocab-fab').click();
        const statuses = await page.locator('[data-anchor-status="unresolved"]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.occurrenceId, text: node.textContent })));
        assert.ok(statuses.some(item => item.id === saved.id), `${name}: unresolved state must be visible in the reader DOM`);
        await open(page, fixtureId, fixture);
        assert.ok((await marks(page)).some(mark => mark.occurrenceId === saved.id), `${name}: restoring the source must recover the same anchor`);
        pass(`${name}-anchor-is-recoverable-without-wrong-highlight`);
    }
}

try {
    for (const protocol of ['http', 'file']) {
        const context = await browser.newContext({ hasTouch: true });
        const page = await context.newPage();
        page.on('dialog', dialog => dialog.accept());
        try {
            await ready(page, protocol);
            if (protocol === 'http') await assets(page);
            const { saved, annotationBefore } = await occurrenceRegression(page, protocol);
            if (protocol === 'http') {
                await rejectedSelections(page);
                await removalRegression(page, saved, annotationBefore);
                await unresolvedRegression(page, saved);
            }
            const receipts = await page.evaluate(() => window.__occurrenceReceipts);
            assert.ok(receipts.length && receipts.every(row => row.saved === true && Number.isInteger(row.revision)));
            pass(`${protocol}-production-mutation-receipts`, { receipts });
        } finally { await context.close(); }
    }
    report.status = 'pass';
} catch (error) {
    report.status = 'fail';
    report.error = error.stack || String(error);
    process.exitCode = 1;
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(reports, 'reading-reader-occurrences-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
