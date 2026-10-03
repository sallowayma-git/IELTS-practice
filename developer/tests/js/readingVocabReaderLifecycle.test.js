import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installReadingAuthority } from './helpers/readingVocabReaderHarness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(root, 'js/components/readingVocabReader.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/vocab-reader.css'), 'utf8');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

async function createPage(browser) {
    const page = await browser.newPage();
    await page.route('https://reader-lifecycle.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body><button id="entry">Open reader</button></body></html>'
    }));
    await page.goto('https://reader-lifecycle.test/');
    await page.addStyleTag({ content: css });
    await installReadingAuthority(page);
    await page.evaluate(() => {
        const payloads = new Map(['a', 'b'].map(id => [id, {
            meta: { title: `Article ${id}` },
            passage: { blocks: [{ html: `<p><strong>A</strong> A sufficiently long <em>${id}</em> passage for independent reading.</p>` }] },
            questionGroups: [{ bodyHtml: `<p>Questions for ${id}</p>` }]
        }]));
        window.__READING_EXAM_DATA__ = { get: id => payloads.get(id), register: (id, data) => payloads.set(id, data) };
        window.__READING_EXPLANATION_MANIFEST__ = {};
        window.__visits = window.__recordedExams;
        window.__listeners = [];
        const add = EventTarget.prototype.addEventListener;
        const remove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function(type, callback, options) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            if (!__listeners.some(item => item.target === this && item.type === type && item.callback === callback && item.capture === capture)) {
                __listeners.push({ target: this, type, callback, capture });
            }
            return add.call(this, type, callback, options);
        };
        EventTarget.prototype.removeEventListener = function(type, callback, options) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            window.__listeners = __listeners.filter(item => !(item.target === this && item.type === type && item.callback === callback && item.capture === capture));
            return remove.call(this, type, callback, options);
        };
        window.__activeReaderListeners = () => __listeners.filter(({ target, type }) =>
            (target === window && type === 'keydown') || target.closest?.('#reading-vocab-reader-overlay')
        ).length;
    });
    await page.addScriptTag({ content: source });
    return page;
}

test('reader lifecycle restores its initiating view and releases reader interactions', async t => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
        await t.test('repeated Questions/close/reopen resets content and removes listeners, including nested Escape focus', async () => {
            const page = await createPage(browser);
            try {
                const states = await page.evaluate(async () => {
                    const result = [];
                    const entry = document.getElementById('entry');
                    for (let iteration = 0; iteration < 5; iteration += 1) {
                        entry.focus();
                        await openReadingVocabReader('a', { fromPractice: true });
                        const overlay = document.getElementById('reading-vocab-reader-overlay');
                        const activeCount = __activeReaderListeners();
                        const reopened = {
                            activeTab: ReadingVocabReader.activeTab,
                            selectedTab: overlay.querySelector('.vocab-tab-btn.active').dataset.para,
                            passageVisible: getComputedStyle(document.getElementById('vocab-passage-section')).display !== 'none',
                            questionsVisible: getComputedStyle(document.getElementById('vocab-questions-section')).display !== 'none',
                            focus: document.activeElement.id
                        };
                        overlay.querySelector('[data-para="questions"]').click();
                        const questionsOnly = getComputedStyle(document.getElementById('vocab-passage-section')).display === 'none';
                        const fab = document.getElementById('vocab-fab');
                        fab.focus();
                        fab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                        const modalFocus = document.activeElement.id;
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                        const modalClosed = !ReadingVocabReader.modalOpen && document.activeElement === fab;
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                        result.push({
                            reopened, questionsOnly, modalFocus, modalClosed, activeCount,
                            closedCount: __activeReaderListeners(),
                            returnedFocus: document.activeElement === entry,
                            hidden: getComputedStyle(overlay).display === 'none',
                            ariaHidden: overlay.getAttribute('aria-hidden'),
                            bodyUnlocked: !document.body.classList.contains('vocab-reader-open')
                        });
                    }
                    return result;
                });
                const activeCount = states[0].activeCount;
                assert.ok(activeCount > 0);
                for (const state of states) {
                    assert.deepEqual(state, {
                        reopened: { activeTab: 'all', selectedTab: 'all', passageVisible: true, questionsVisible: true, focus: 'vocab-reader-back-btn' },
                        questionsOnly: true, modalFocus: 'vocab-manual-input', modalClosed: true,
                        activeCount, closedCount: 0, returnedFocus: true, hidden: true,
                        ariaHidden: 'true', bodyUnlocked: true
                    });
                }
            } finally { await page.close(); }
        });

        await t.test('old tabs, vocabulary controls and retries cannot act on a later article', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    await ReadingVocabReader.open('missing');
                    const retry = document.querySelector('.vocab-error-state button');
                    ReadingVocabReader.close();
                    const failedCloseCount = __activeReaderListeners();
                    await ReadingVocabReader.open('a');
                    const oldTab = document.querySelector('[data-para="questions"]');
                    await ReadingVocabStore.add('preserved', 'a', 'Article a');
                    ReadingVocabReader.openModal();
                    const oldDelete = document.querySelector('.vocab-delete-btn');
                    ReadingVocabReader.close();
                    // Closed reader controls must not reopen the modal or delete words.
                    document.getElementById('vocab-fab').click();
                    oldDelete.click();
                    const closedInert = !ReadingVocabReader.modalOpen && ReadingVocabStore.getAll().length === 1;
                    await ReadingVocabReader.open('b');
                    ReadingVocabReader.openModal();
                    ReadingVocabReader.closeModal();
                    oldTab.click();
                    oldDelete.click();
                    retry.click();
                    await Promise.resolve();
                    return {
                        closedInert, failedCloseCount, current: ReadingVocabReader.currentExamId,
                        tab: ReadingVocabReader.activeTab, title: document.getElementById('vocab-reader-title').textContent,
                        words: ReadingVocabStore.getAll().map(item => item.word), visits: __visits
                    };
                });
                assert.deepEqual(state, {
                    closedInert: true, failedCloseCount: 0, current: 'b', tab: 'all', title: 'Article b',
                    words: ['preserved'], visits: ['a', 'a', 'b']
                });
            } finally { await page.close(); }
        });

        await t.test('vocabulary collected after a late A-to-B race belongs only to the latest article', async () => {
            const page = await createPage(browser);
            try {
                await page.evaluate(async () => {
                    window.__READING_EXAM_MANIFEST__ = {
                        'race-a': { examId: 'race-a', script: 'race-a.js' },
                        'race-b': { examId: 'race-b', script: 'race-b.js' }
                    };
                    const pending = new Map();
                    const append = document.head.appendChild.bind(document.head);
                    document.head.appendChild = node => {
                        if (node.tagName === 'SCRIPT' && node.src) {
                            pending.set(node.src.split('/').pop(), node);
                            return node;
                        }
                        return append(node);
                    };
                    const finish = (id, title) => {
                        __READING_EXAM_DATA__.register(id, {
                            meta: { title },
                            passage: { blocks: [{ html: `<p><strong>A</strong> This sufficiently long passage belongs to ${title}.</p>` }] },
                            questionGroups: [{ bodyHtml: `<p>Questions for ${title}</p>` }]
                        });
                        pending.get(`${id}.js`).onload();
                    };
                    const openA = ReadingVocabReader.open('race-a');
                    // Storage/source resolution precedes loading each payload. Keep
                    // both real requests pending before completing them out of order.
                    for (let step = 0; step < 50 && !pending.has('race-a.js'); step += 1) await Promise.resolve();
                    if (!pending.has('race-a.js')) throw new Error('Article A did not reach the payload loader');
                    const openB = ReadingVocabReader.open('race-b');
                    for (let step = 0; step < 50 && !pending.has('race-b.js'); step += 1) await Promise.resolve();
                    if (!pending.has('race-b.js')) throw new Error('Article B did not reach the payload loader');
                    finish('race-b', 'Latest race article');
                    await openB;
                    finish('race-a', 'Stale race article');
                    await openA;
                    document.head.appendChild = append;
                });
                await page.locator('#vocab-fab').click();
                await page.locator('#vocab-manual-input').fill('chrysoprase');
                await page.locator('#vocab-manual-add-btn').click();
                await page.waitForFunction(() => ReadingVocabStore.getAll().some(item => item.word === 'chrysoprase'));
                const state = await page.evaluate(() => ({
                    current: ReadingVocabReader.currentExamId,
                    title: document.getElementById('vocab-reader-title').textContent,
                    words: ReadingVocabStore.getAll().map(({ word, examId, examTitle }) => ({ word, examId, examTitle })),
                    visits: __visits
                }));
                assert.deepEqual(state, {
                    current: 'race-b', title: 'Latest race article',
                    words: [{ word: 'chrysoprase', examId: 'race-b', examTitle: 'Latest race article' }],
                    visits: ['race-b', 'race-b']
                });
            } finally { await page.close(); }
        });

        await t.test('closing cancels deferred vocabulary work and a later open preserves the original focus target', async () => {
            const page = await createPage(browser);
            try {
                const state = await page.evaluate(async () => {
                    document.getElementById('entry').focus();
                    await ReadingVocabReader.open('a');
                    const scheduled = new Map();
                    const callbacks = [];
                    const setTimer = window.setTimeout;
                    const clearTimer = window.clearTimeout;
                    window.setTimeout = callback => {
                        callbacks.push(callback);
                        scheduled.set(callbacks.length, callback);
                        return callbacks.length;
                    };
                    window.clearTimeout = id => scheduled.delete(id);
                    const range = document.createRange();
                    range.selectNodeContents(document.querySelector('#vocab-passage-content em'));
                    window.getSelection().removeAllRanges();
                    window.getSelection().addRange(range);
                    document.getElementById('vocab-reader-body').dispatchEvent(new MouseEvent('mouseup'));
                    ReadingVocabReader.showToast('pending');
                    const pendingBefore = scheduled.size;
                    await ReadingVocabReader.open('b');
                    const pendingAfterOpen = scheduled.size;
                    ReadingVocabReader.close();
                    callbacks.forEach(callback => callback());
                    window.setTimeout = setTimer;
                    window.clearTimeout = clearTimer;
                    return {
                        pendingBefore, pendingAfterOpen, pendingAfterClose: scheduled.size,
                        toast: document.getElementById('vocab-toast').textContent,
                        selection: window.getSelection().toString(),
                        words: ReadingVocabStore.getAll(), focus: document.activeElement.id
                    };
                });
                assert.deepEqual(state, {
                    pendingBefore: 2, pendingAfterOpen: 0, pendingAfterClose: 0,
                    toast: '', selection: '', words: [], focus: 'entry'
                });
            } finally { await page.close(); }
        });
    } finally { await browser.close(); }
});
