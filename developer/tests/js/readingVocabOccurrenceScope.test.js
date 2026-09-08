import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { createPage, openArticle } from './helpers/readingVocabReaderHarness.js';

test('All-tab occurrence removal and undo retain the owning article and library', async t => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    t.after(() => browser.close());

    for (const other of [
        { source: { kind: 'builtin', id: 'default' }, article: { examId: 'article-b', title: 'Article B' } },
        { source: { kind: 'imported', id: 'library-b' }, article: { examId: 'article-a', title: 'Library B article' } }
    ]) {
        await t.test(other.article.title, async t => {
            const page = await createPage(browser);
            t.after(() => page.close());
            await openArticle(page, 'article-a', 'Article A');
            const seeded = await page.evaluate(async other => {
                __selectText('#vocab-passage-content', 'passage');
                await ReadingVocabReader.captureSelection();
                const currentOccurrence = ReadingVocabStore.getByExam('article-a')[0].occurrences[0];
                // A shared term and an other-article-only term must both appear in All.
                await ReadingVocabStore.add('passage', other.article.examId, other.article.title,
                    'Other saved passage context', currentOccurrence, other.source);
                await ReadingVocabStore.add('exclusive', other.article.examId, other.article.title,
                    'An exclusive saved context', { ...currentOccurrence, quote: 'exclusive',
                        startOffset: 0, endOffset: 9, before: '', after: ' saved context' }, other.source);
                // Manual membership and canonical review fields survive occurrence removal.
                await ReadingVocabStore.add('passage', other.article.examId, other.article.title, '', null, other.source);
                const state = ReadingVocabStore._state.snapshot;
                const words = state.lists['reading-highlights'].words;
                words.find(row => row.word === 'passage').note = 'Keep the canonical note';
                __readingAuthority.snapshot = structuredClone(state);
                const otherItems = ReadingVocabStore.getByExam(other.article.examId, other.source);
                ReadingVocabReader.openModal();
                return { currentOccurrence, otherItems, words: structuredClone(words) };
            }, other);

            assert.equal(await page.locator('.vocab-occurrence-row').count(), 1);
            assert.equal(await page.locator('.vocab-item').count(), 1);
            await page.locator('#v-tab-all').click();
            assert.equal(await page.locator('.vocab-item').count(), 2);
            assert.equal(await page.locator('.vocab-occurrence-row').count(), 3);
            assert.equal(await page.locator('.vocab-occurrence-row[data-anchor-status="resolved"]').count(), 1);
            assert.equal(await page.locator('.vocab-occurrence-row[data-anchor-status="unverified"]').count(), 2,
                'unopened article anchors must not be claimed as restored in the current article');
            assert.deepEqual(await page.locator('.vocab-occurrence-row .vocab-item__source').allTextContents(),
                ['Article A', other.article.title, other.article.title]);

            for (const item of seeded.otherItems) {
                const occurrence = item.occurrences[0];
                // Select by exact persisted identity because shared quotes can be identical.
                await page.evaluate(id => {
                    const button = [...document.querySelectorAll('#vocab-list [data-action="remove-occurrence"]')]
                        .find(button => button.dataset.occurrenceId === id);
                    button.click();
                }, occurrence.id);
                await page.waitForFunction(() => !ReadingVocabReader._occurrenceBusy);
                const removed = await page.evaluate(({ other, id }) => ({
                    current: ReadingVocabStore.getByExam('article-a'),
                    other: ReadingVocabStore.getByExam(other.article.examId, other.source),
                    undo: ReadingVocabReader._undoOccurrence,
                    exists: __readingAuthority.snapshot.reading.occurrences.some(row => row.id === id),
                    revision: __readingAuthority.revision,
                    generation: __readingAuthority.generation
                }), { other, id: occurrence.id });
                assert.equal(removed.exists, false);
                assert.equal(removed.current[0].occurrences[0].id, seeded.currentOccurrence.id);
                assert.equal(removed.undo.command.article.examId, other.article.examId);
                assert.equal(removed.undo.command.article.title, other.article.title);
                assert.deepEqual(removed.undo.command.source, other.source);
                assert.deepEqual(removed.undo.observed, { revision: removed.revision, generation: removed.generation });
                assert.equal(await page.locator('.vocab-occurrence-row').count(), 2);
                assert.equal(await page.locator('mark.vocab-highlight').count(), 1);
                if (item.word === 'passage') {
                    const retained = removed.other.find(row => row.word === 'passage');
                    assert.equal(retained.occurrences.length, 0);
                    assert.equal(retained.associations[0].manual, true);
                } else assert.equal(removed.other.some(row => row.word === 'exclusive'), false);

                await page.locator('[data-action="undo-occurrence"]').click();
                await page.waitForFunction(() => !ReadingVocabReader._occurrenceBusy);
                const restored = await page.evaluate(({ other, id }) => ({
                    current: ReadingVocabStore.getByExam('article-a'),
                    other: ReadingVocabStore.getByExam(other.article.examId, other.source),
                    occurrences: __readingAuthority.snapshot.reading.occurrences.filter(row => row.id === id),
                    words: __readingAuthority.snapshot.lists['reading-highlights'].words,
                    lastCall: __readingAuthority.calls.at(-1), undo: ReadingVocabReader._undoOccurrence
                }), { other, id: occurrence.id });
                assert.equal(restored.occurrences.length, 1, 'undo must restore the original occurrence identity');
                assert.equal(restored.other.find(row => row.word === item.word).occurrences[0].id, occurrence.id);
                assert.equal(restored.current[0].occurrences.length, 1);
                assert.equal(restored.current[0].occurrences[0].id, seeded.currentOccurrence.id);
                assert.deepEqual(restored.words, seeded.words);
                assert.deepEqual(restored.lastCall.options, {
                    observedRevision: removed.revision, observedGeneration: removed.generation
                });
                assert.equal(restored.undo, null);
                assert.equal(await page.locator('.vocab-occurrence-row').count(), 3);
                assert.equal(await page.locator('mark.vocab-highlight').count(), 1);
            }
            await page.locator('#v-tab-current').click();
            assert.equal(await page.locator('.vocab-occurrence-row').count(), 1);
            assert.equal(await page.locator('.vocab-item').count(), 1);
        });
    }
});
