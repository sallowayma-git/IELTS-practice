import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const source = name => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const scripts = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
    'core/vocabScheduler.js', 'core/practiceReviewScheduler.js',
    'data/v2/readingVocabularyModel.js', 'data/v2/readingViewCache.js', 'data/v2/appData.js'
].map(source);
const dictionary = source('runtime/reviewHighlightDictionary.js');
const addSelector = '#review-highlight-dictionary-bubble [data-vocab-add]';

async function install(page) {
    // Keep the immutable production AppData facade in a same-origin frame so
    // the popup's facade can inject delays/failures without replacing storage.
    const storageFrame = page.frames().find(frame => frame !== page.mainFrame());
    for (const content of scripts) await storageFrame.addScriptTag({ content });
    await page.evaluate(async () => {
        window.authority = document.getElementById('authority').contentWindow.AppData;
        await authority.ready;
        window.control = {
            context: { examId: 'p2-low-08', libraryConfigurationId: null },
            host: false, posted: [], reads: [], delayReads: false, failRead: false, failWrite: false, writes: 0
        };
        // Only timing and failure boundaries are controlled. Successful reads and
        // mutations use production AppData, the relationship model and IndexedDB.
        window.AppData = { ...authority, ready: authority.ready, vocab: { ...authority.vocab,
            async getReadingSnapshot() {
                if (control.failRead) throw new Error('Injected read failure');
                const state = await authority.vocab.getReadingSnapshot();
                if (control.delayReads) return new Promise((resolve, reject) => {
                    control.reads.push({ resolve: () => resolve(state), reject });
                });
                return state;
            },
            async mutateReading(...args) {
                control.writes += 1;
                if (control.failWrite) throw new Error('Injected write failure');
                return authority.vocab.mutateReading(...args);
            }
        } };
        window.DictionaryService = {
            lookup(term) {
                return { term: term.trim(), found: term !== 'should', zh: term === 'should' ? '' : 'Fixture definition' };
            }
        };
    });
    await page.addScriptTag({ content: dictionary });
    await page.evaluate(() => ReviewHighlightDictionary.attach({
        roots: { passage: document.getElementById('passage') },
        getContext: () => control.context,
        postMessage(type, payload) {
            if (!control.host) return false;
            control.posted.push({ type, payload });
            return true;
        }
    }));
}

async function createPage(browser) {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route('https://highlight.test/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head></head><body><iframe id="authority" hidden></iframe><p id="passage">'
            + '<span class="hl" id="appreciation">appreciation</span> '
            + '<span class="hl" id="microscope">microscope</span> '
            + '<span class="hl" id="should">should</span></p></body></html>'
    }));
    await page.goto('https://highlight.test/');
    await install(page);
    return page;
}

async function expectButton(page, text, disabled) {
    await page.waitForFunction(({ selector, text, disabled }) => {
        const button = document.querySelector(selector);
        return button?.textContent === text && button.disabled === disabled;
    }, { selector: addSelector, text, disabled }, { timeout: 5000 });
}

async function open(page, word = 'appreciation') {
    await page.locator(`#${word}`).click();
}

async function close(page) {
    await page.locator('[data-vocab-close]').click();
}

async function snapshot(page) {
    return page.evaluate(async () => (await authority.vocab.getReadingSnapshot()).snapshot);
}

async function collect(page, { word = 'appreciation', examId = 'p2-low-08', source = { kind: 'builtin', id: 'default' } } = {}) {
    await page.evaluate(input => authority.vocab.mutateReading('collect', {
        source: input.source, article: { examId: input.examId },
        word: { word: input.word, meaning: 'Persisted definition' }, manual: true,
        at: new Date().toISOString()
    }), { word, examId, source });
}

test('highlight dictionary reads persisted article membership for each popup instance', async t => {
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    t.after(() => browser.close());

    await t.test('direct saves remain Added after close, reopen and page reload, including missing definitions', async () => {
        const page = await createPage(browser);
        try {
            for (const word of ['appreciation', 'should']) {
                await open(page, word);
                await expectButton(page, '加入生词本', false);
                await page.locator(addSelector).click();
                await expectButton(page, '已加入', true);
                await close(page);
                await open(page, word);
                await expectButton(page, '已加入', true);
                await close(page);
            }
            const saved = await snapshot(page);
            assert.equal(saved.reading.terms.length, 2);
            assert.equal(saved.reading.associations.length, 2);
            await page.reload();
            await install(page);
            for (const word of ['appreciation', 'should']) {
                await open(page, word);
                await expectButton(page, '已加入', true);
                await close(page);
            }
            assert.deepEqual(await snapshot(page), saved, 'opening a popup must not recollect or alter persisted vocabulary');
        } finally { await page.close(); }
    });

    await t.test('global vocabulary and other sources/articles do not suppress collection; deletion permits recollection', async () => {
        const page = await createPage(browser);
        try {
            await page.frames().find(frame => frame !== page.mainFrame()).evaluate(() => AppData.vocab.saveWords([{
                id: 'reviewed-appreciation', word: 'APPRECIATION', meaning: 'My definition', note: 'My note',
                phonetic: 'my-phonetic', interval: 21, repetitions: 7, correctCount: 9,
                lastReviewed: '2026-09-01T01:00:00.000Z', nextReview: '2026-09-22T01:00:00.000Z'
            }]));
            const existingWord = (await snapshot(page)).words[0];
            await collect(page, { source: { kind: 'imported', id: 'default' } });
            await collect(page, { examId: 'another-article' });
            await collect(page, { word: 'microscope' });
            await page.locator('#appreciation').evaluate(node => { node.textContent = '  Appreciation  '; });
            await open(page);
            await expectButton(page, '加入生词本', false);
            await page.locator(addSelector).click();
            await expectButton(page, '已加入', true);
            await close(page);
            const saved = await snapshot(page);
            assert.deepEqual(saved.words[0], existingWord);
            assert.equal(saved.reading.terms.length, 2);
            assert.equal(saved.reading.associations.length, 4);
            await page.evaluate(async () => {
                const model = authority.vocab.readingModel;
                await authority.vocab.mutateReading('removeArticleTerm', {
                    articleId: model.articleId({ kind: 'builtin', id: 'default' }, 'p2-low-08'),
                    termId: model.termId('appreciation')
                });
            });
            await open(page);
            await expectButton(page, '加入生词本', false);
            await page.locator(addSelector).click();
            await expectButton(page, '已加入', true);
            await close(page);
            const restored = await snapshot(page);
            assert.deepEqual(restored.words, saved.words);
            assert.deepEqual(restored.lists, saved.lists);
            assert.deepEqual(restored.reading.associations.filter(row => row.id !== saved.reading.associations.at(-1).id),
                saved.reading.associations.slice(0, -1));
            await page.evaluate(() => authority.vocab.mutateReading('removeTermAssociations', {
                termId: authority.vocab.readingModel.termId('appreciation')
            }));
            await open(page);
            await expectButton(page, '加入生词本', false);
            await page.locator(addSelector).click();
            await expectButton(page, '已加入', true);
            assert.equal((await snapshot(page)).reading.terms.length, 2);
            assert.deepEqual((await snapshot(page)).words, saved.words);
        } finally { await page.close(); }
    });

    await t.test('late membership reads cannot update another word or a later opening of the same highlight', async () => {
        const page = await createPage(browser);
        try {
            await collect(page);
            await page.evaluate(() => { control.delayReads = true; });
            await open(page);
            await page.waitForFunction(() => control.reads.length === 1);
            await close(page);
            await open(page, 'microscope');
            await page.waitForFunction(() => control.reads.length === 2);
            await page.evaluate(() => { control.reads[1].resolve(); });
            await expectButton(page, '加入生词本', false);
            await page.evaluate(() => { control.reads[0].resolve(); });
            await expectButton(page, '加入生词本', false);
            await close(page);
            await open(page);
            await page.waitForFunction(() => control.reads.length === 3);
            await close(page);
            await page.evaluate(() => authority.vocab.mutateReading('deleteCanonicalTerm', {
                termId: authority.vocab.readingModel.termId('appreciation')
            }));
            await open(page);
            await page.waitForFunction(() => control.reads.length === 4);
            await page.evaluate(() => { control.reads[3].resolve(); });
            await expectButton(page, '加入生词本', false);
            await page.evaluate(() => { control.reads[2].resolve(); });
            await expectButton(page, '加入生词本', false);
            await close(page);
            await open(page);
            await page.waitForFunction(() => control.reads.length === 5);
            await close(page);
            await page.evaluate(() => { control.reads[4].resolve(); });
            assert.equal(await page.locator(addSelector).count(), 0);
        } finally { await page.close(); }
    });

    await t.test('latched membership backend failures require reload and recover only with a new AppData instance', async () => {
        const page = await createPage(browser);
        try {
            await collect(page, { word: 'microscope' });
            const saved = await snapshot(page);
            const storageFrame = page.frames().find(frame => frame !== page.mainFrame());
            await storageFrame.evaluate(() => {
                window.originalTransaction = IDBDatabase.prototype.transaction;
                IDBDatabase.prototype.transaction = function () {
                    throw new DOMException('Injected transaction failure', 'InvalidStateError');
                };
            });
            await open(page);
            await page.waitForFunction(() => authority.status().state === 'failed');
            await storageFrame.evaluate(() => {
                IDBDatabase.prototype.transaction = window.originalTransaction;
            });
            await expectButton(page, '请刷新页面后重试', true);
            assert.equal(await page.locator(addSelector).getAttribute('title'), '请刷新页面后重试');
            assert.equal(await page.evaluate(async () => {
                try { await authority.vocab.getReadingSnapshot(); }
                catch (error) { return error.code; }
            }), 'BACKEND_UNAVAILABLE', 'restoring IndexedDB does not recover the latched AppData instance');
            await page.locator(addSelector).evaluate(button => button.click());
            assert.equal(await page.evaluate(() => control.writes), 0);
            assert.equal(await page.evaluate(() => control.posted.length), 0);
            await close(page);
            await open(page, 'microscope');
            await expectButton(page, '请刷新页面后重试', true);
            await page.reload();
            await install(page);
            await open(page);
            await expectButton(page, '加入生词本', false);
            await close(page);
            await open(page, 'microscope');
            await expectButton(page, '已加入', true);
            assert.deepEqual(await snapshot(page), saved, 'reload must preserve the existing collection');
        } finally { await page.close(); }
    });

    await t.test('read and write failures stay explicit and retryable; host results only settle their initiating popup', async () => {
        const page = await createPage(browser);
        try {
            await page.evaluate(() => { control.failRead = true; });
            await open(page);
            await expectButton(page, '读取失败，点击重试', false);
            await page.evaluate(() => { control.failRead = false; });
            await page.locator(addSelector).click();
            await expectButton(page, '加入生词本', false);
            assert.equal(await page.evaluate(() => control.writes), 0);
            await page.evaluate(() => { control.failWrite = true; });
            await page.locator(addSelector).click();
            await expectButton(page, '保存失败', false);
            await page.evaluate(() => { control.failWrite = false; });
            await page.locator(addSelector).click();
            await expectButton(page, '已加入', true);
            await close(page);
            await page.evaluate(() => { control.host = true; });
            await open(page, 'microscope');
            await expectButton(page, '加入生词本', false);
            await page.locator(addSelector).click();
            await expectButton(page, '保存中…', true);
            await page.evaluate(() => ReviewHighlightDictionary.handleSaveOutcome(control.posted[0].payload, false));
            await expectButton(page, '保存失败', false);
            assert.equal(await page.evaluate(() => control.writes), 2, 'a host rejection must not fall through to a direct write');
            await page.locator(addSelector).click();
            await expectButton(page, '保存中…', true);
            await page.evaluate(() => { window.oldSaveButton = document.querySelector('[data-vocab-add]'); });
            await close(page);
            await open(page, 'should');
            await expectButton(page, '加入生词本', false);
            await collect(page, { word: 'microscope' });
            await page.evaluate(() => ReviewHighlightDictionary.handleSaveOutcome(control.posted[1].payload, true));
            await expectButton(page, '加入生词本', false);
            assert.equal(await page.evaluate(() => oldSaveButton.textContent), '保存中…', 'a closed popup must not be updated by its late acknowledgement');
            await close(page);
            await open(page, 'microscope');
            await expectButton(page, '已加入', true);
        } finally { await page.close(); }
    });
});
