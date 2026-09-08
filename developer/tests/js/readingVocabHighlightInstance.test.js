#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createPage, openArticle } from './helpers/readingVocabReaderHarness.js';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

test('production range calculation and restoration preserve one selected instance', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    try {
        const results = await page.evaluate(() => {
            const fullText = 'Clean water is essential for life, but contaminated water causes severe diseases. Stored water must be protected.';
            const root = document.createElement('p');
            root.textContent = fullText;
            document.body.append(root);
            return [6, 52, 89].map((offset, occurrence) => {
                const range = document.createRange();
                range.setStart(root.firstChild, offset);
                range.setEnd(root.firstChild, offset + 5);
                const location = ReadingVocabReader.calculateRangeLocation(root, range, 'water');
                const restored = ReadingVocabReader.resolveRangeForHighlight(root, { ...location, text: 'water' });
                const fallback = ReadingVocabReader.resolveRangeForHighlight(root, { startOffset: -1, endOffset: -1, occurrence, text: 'water' });
                return {
                    startOffset: location.startOffset, endOffset: location.endOffset, occurrence: location.occurrence,
                    restored: { text: restored.toString(), start: restored.startOffset, end: restored.endOffset },
                    fallback: { text: fallback.toString(), start: fallback.startOffset, end: fallback.endOffset }
                };
            });
        });
        assert.deepEqual(results, [6, 52, 89].map((offset, occurrence) => ({
            startOffset: offset, endOffset: offset + 5, occurrence,
            restored: { text: 'water', start: offset, end: offset + 5 },
            fallback: { text: 'water', start: offset, end: offset + 5 }
        })));
    } finally { await page.close(); await browser.close(); }
});

test('acknowledged highlights restore only the selected instance in the active library', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await createPage(browser);
    const sourceA = { kind: 'builtin', id: 'default' };
    const sourceB = { kind: 'imported', id: 'library-b' };
    try {
        await openArticle(page, 'shared-exam', 'water water water', { source: sourceA });
        await page.evaluate(() => {
            __selectText('#vocab-passage-content em', 'water', 1);
            document.querySelector('#vocab-reader-body').dispatchEvent(new MouseEvent('mouseup'));
        });
        await page.waitForFunction(() => __readingAuthority.snapshot.reading.occurrences.length === 1);
        await page.evaluate(async source => {
            const captured = __readingAuthority.snapshot.reading.occurrences[0];
            await ReadingVocabStore.add('water', 'shared-exam', 'An imported article', '', {
                ...captured, text: captured.quote,
                startOffset: captured.startOffset + 6, endOffset: captured.endOffset + 6
            }, source);
        }, sourceB);
        await page.evaluate(source => ReadingVocabReader.open('shared-exam', { source }), sourceA);
        assert.deepEqual(await page.evaluate(() => {
            const container = document.querySelector('#vocab-passage-content em');
            const mark = container.querySelector('mark.vocab-highlight');
            return { count: container.querySelectorAll('mark').length, before: mark.previousSibling.textContent, after: mark.nextSibling.textContent };
        }), { count: 1, before: 'water ', after: ' water' });
        await page.evaluate(async source => {
            await ReadingVocabStore.clear('shared-exam', source);
            ReadingVocabReader.applyVocabHighlights();
        }, sourceA);
        assert.equal(await page.locator('mark.vocab-highlight').count(), 0);
        assert.deepEqual(await page.evaluate(source => ({
            terms: ReadingVocabStore.getByExam('shared-exam', source).length,
            occurrences: __readingAuthority.snapshot.reading.occurrences.length
        }), sourceB), { terms: 1, occurrences: 1 });
    } finally { await page.close(); await browser.close(); }
});

test('reader preserves the floating vocabulary entry and expanded paragraph navigation', () => {
    const reader = fs.readFileSync(new URL('../../../js/components/readingVocabReader.js', import.meta.url), 'utf8');
    const css = fs.readFileSync(new URL('../../../css/vocab-reader.css', import.meta.url), 'utf8');
    assert.doesNotMatch(reader, /id="vocab-open-modal-btn"/, 'The redundant header button must remain removed');
    assert.match(reader, /id="vocab-fab"/, 'The floating vocabulary button remains available');
    assert.match(reader, /Para \$\{b\.letter\}/, 'Paragraph tabs retain their compact labels');
    assert.match(css, /\.vocab-reader-tabs\s*\{[^}]*flex-wrap:\s*wrap;/m, 'Paragraph tabs wrap to show every option');
    assert.doesNotMatch(css, /\.vocab-reader-tabs\s*\{[^}]*overflow-x:\s*auto;/m, 'Paragraph tabs do not require horizontal scrolling');
});
