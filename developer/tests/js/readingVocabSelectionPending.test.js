import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createPage, openArticle } from './helpers/readingVocabReaderHarness.js';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

async function select(page, word, key, selector = '#vocab-passage-content', occurrence = 0) {
    await page.evaluate(({ word, key, selector, occurrence }) => {
        __selectText(selector, word, occurrence);
        window[key] = ReadingVocabReader.captureSelection();
    }, { word, key, selector, occurrence });
}

async function state(page) {
    return page.evaluate(() => ({
        calls: __readingAuthority.calls.filter(call => call.type === 'collect').length,
        pending: __readingAuthority.pending.length,
        quotes: __readingAuthority.snapshot.reading.occurrences.map(row => row.quote),
        marks: [...document.querySelectorAll('mark.vocab-highlight')].map(mark => mark.textContent),
        unresolved: ReadingVocabReader.unresolvedOccurrences.length,
        message: document.querySelector('#vocab-toast').textContent
    }));
}

test('pending selections reserve only overlapping intervals until save acknowledgement', { timeout: 60_000 }, async t => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    t.after(() => browser.close());

    for (const [label, first, second] of [
        ['identical', 'passage with', 'passage with'],
        ['contained', 'passage with', 'passage'],
        ['containing', 'passage', 'passage with'],
        ['partial overlap', 'passage with', 'with enough']
    ]) {
        await t.test(`rejects ${label} selection while the first save is delayed`, async t => {
            const page = await createPage(browser);
            t.after(() => page.close());
            await openArticle(page);
            await page.evaluate(() => { __readingAuthority.defer = true; });
            await select(page, first, '__firstCapture');
            await page.waitForFunction(() => __readingAuthority.pending.length === 1);
            await select(page, second, '__secondCapture');
            await page.evaluate(() => __secondCapture);
            assert.deepEqual(await state(page), {
                calls: 1, pending: 1, quotes: [], marks: [], unresolved: 0, message: '正在保存…'
            });
            await page.evaluate(async () => {
                __readingAuthority.pending.shift().resolve();
                await __firstCapture;
            });
            const saved = await state(page);
            assert.deepEqual({ ...saved, message: undefined }, {
                calls: 1, pending: 0, quotes: [first], marks: [first], unresolved: 0, message: undefined
            });
            assert.equal(saved.message, `✅ "${first}" 已收录并黄色高亮`);
        });
    }

    await t.test('allows adjacent and disjoint intervals in the same scope', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page, 'article', 'watermelon water');
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'water', '__firstCapture', '#vocab-passage-content em');
        await select(page, 'melon', '__adjacentCapture', '#vocab-passage-content em');
        await select(page, 'water', '__disjointCapture', '#vocab-passage-content em', 1);
        await page.waitForFunction(() => __readingAuthority.pending.length === 3);
        assert.deepEqual(await state(page), {
            calls: 3, pending: 3, quotes: [], marks: [], unresolved: 0, message: '正在保存…'
        });
        const intervals = await page.evaluate(() => __readingAuthority.calls.filter(call => call.type === 'collect')
            .map(call => call.command.occurrence));
        assert.equal(intervals[0].endOffset, intervals[1].startOffset, 'the first two captures share an endpoint');
        assert.ok(intervals[1].endOffset < intervals[2].startOffset);
        await page.evaluate(async () => {
            for (const key of ['__firstCapture', '__adjacentCapture', '__disjointCapture']) {
                __readingAuthority.pending.shift().resolve();
                await window[key];
            }
        });
        const saved = await state(page);
        assert.deepEqual(saved.quotes, ['water', 'melon', 'water']);
        assert.deepEqual(saved.marks, ['water', 'melon', 'water']);
        assert.equal(saved.unresolved, 0);
    });

    await t.test('allows the same interval in separate text scopes', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page, 'article', 'water');
        await page.evaluate(() => {
            const question = document.querySelector('#vocab-questions-content [data-vocab-scope]');
            question.textContent = document.querySelector('#vocab-passage-content [data-vocab-scope]').textContent;
            __readingAuthority.defer = true;
        });
        await select(page, 'water', '__passageCapture');
        await select(page, 'water', '__questionCapture', '#vocab-questions-content');
        await page.waitForFunction(() => __readingAuthority.pending.length === 2);
        const intervals = await page.evaluate(() => __readingAuthority.calls.filter(call => call.type === 'collect')
            .map(call => call.command.occurrence));
        assert.equal(intervals[0].startOffset, intervals[1].startOffset);
        assert.equal(intervals[0].endOffset, intervals[1].endOffset);
        assert.notEqual(intervals[0].scopeId, intervals[1].scopeId);
        assert.deepEqual((await state(page)).marks, []);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __passageCapture;
            __readingAuthority.pending.shift().resolve();
            await __questionCapture;
        });
        const saved = await state(page);
        assert.deepEqual(saved.quotes, ['water', 'water']);
        assert.deepEqual(saved.marks, ['water', 'water']);
        assert.equal(saved.unresolved, 0);
    });

    await t.test('releases a failed interval so an overlapping retry can save', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page);
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'passage with', '__firstCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 1);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().reject(new Error('Injected save failure'));
            await __firstCapture;
        });
        const failed = await state(page);
        assert.deepEqual(failed.quotes, []);
        assert.deepEqual(failed.marks, []);
        assert.match(failed.message, /保存失败/);
        await select(page, 'passage', '__retryCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 1);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __retryCapture;
        });
        const saved = await state(page);
        assert.equal(saved.calls, 2);
        assert.deepEqual(saved.quotes, ['passage']);
        assert.deepEqual(saved.marks, ['passage']);
        assert.equal(saved.unresolved, 0);
    });

    await t.test('reopening the same article retains overlapping reservations until a stale save succeeds', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page);
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'passage with', '__oldCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 1);
        await page.evaluate(async () => {
            ReadingVocabReader.close();
            __readingAuthority.defer = false;
            await ReadingVocabReader.open('article');
            __readingAuthority.defer = true;
        });
        await select(page, 'passage', '__newCapture');
        await page.evaluate(() => __newCapture);
        assert.deepEqual(await state(page), {
            calls: 1, pending: 1, quotes: [], marks: [], unresolved: 0, message: ''
        });
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __oldCapture;
        });
        await select(page, 'passage', '__overlapCapture');
        await page.evaluate(() => __overlapCapture);
        assert.deepEqual(await state(page), {
            calls: 1, pending: 0, quotes: ['passage with'], marks: ['passage with'], unresolved: 0, message: ''
        });
    });

    await t.test('stale failure releases only its own interval and permits an overlapping retry', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page);
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'passage with', '__oldCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 1);
        await page.evaluate(async () => {
            ReadingVocabReader.close();
            __readingAuthority.defer = false;
            await ReadingVocabReader.open('article');
            __readingAuthority.defer = true;
        });
        await select(page, 'enough text', '__newCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 2);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().reject(new Error('Injected stale-session failure'));
            await __oldCapture;
        });
        await select(page, 'enough', '__overlapCapture');
        await page.evaluate(() => __overlapCapture);
        assert.deepEqual(await state(page), {
            calls: 2, pending: 1, quotes: [], marks: [], unresolved: 0, message: '正在保存…'
        });
        await select(page, 'passage', '__retryCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 2);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __newCapture;
            __readingAuthority.pending.shift().resolve();
            await __retryCapture;
        });
        const saved = await state(page);
        assert.equal(saved.calls, 3);
        assert.deepEqual(saved.quotes, ['enough text', 'passage']);
        assert.deepEqual(saved.marks, ['passage', 'enough text']);
        assert.equal(saved.unresolved, 0);
    });

    await t.test('a pending save does not reserve matching text in a different article', async t => {
        const page = await createPage(browser);
        t.after(() => page.close());
        await openArticle(page, 'article-a', 'same title');
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'passage with', '__oldCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 1);
        await page.evaluate(() => { __readingAuthority.defer = false; });
        await openArticle(page, 'article-b', 'same title');
        await page.evaluate(() => { __readingAuthority.defer = true; });
        await select(page, 'passage', '__newCapture');
        await page.waitForFunction(() => __readingAuthority.pending.length === 2);
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __oldCapture;
        });
        const pending = await state(page);
        assert.deepEqual(pending.quotes, ['passage with']);
        assert.deepEqual(pending.marks, []);
        assert.equal(pending.message, '正在保存…');
        await page.evaluate(async () => {
            __readingAuthority.pending.shift().resolve();
            await __newCapture;
        });
        const saved = await state(page);
        assert.equal(saved.calls, 2);
        assert.deepEqual(saved.quotes, ['passage with', 'passage']);
        assert.deepEqual(saved.marks, ['passage']);
        assert.equal(saved.unresolved, 0);
    });
});
