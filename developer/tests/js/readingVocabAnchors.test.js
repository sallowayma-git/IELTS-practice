import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const source = fs.readFileSync(new URL('../../../js/components/readingVocabAnchors.js', import.meta.url), 'utf8');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

test('reading vocabulary anchors capture real DOM boundaries and reject unsafe selections', async t => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    try {
        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({ content: source });
        await t.test('element endpoints and inline markup preserve exact trimmed offsets and a local context', async () => {
            const result = await page.evaluate(() => {
                const scope = document.createElement('p');
                scope.dataset.vocabScope = 'source:article:passage:0';
                scope.innerHTML = `${'Long introduction. '.repeat(35)}<span> “clean <em>water</em>,” </span>then the ending.`;
                document.body.replaceChildren(scope);
                const span = scope.querySelector('span');
                const range = document.createRange();
                range.setStart(span, 0);
                range.setEnd(span, span.childNodes.length);
                const captured = ReadingVocabAnchors.capture(scope, range);
                const restored = ReadingVocabAnchors.resolve(document.body, captured);
                return {
                    word: captured.word, quote: captured.quote, selected: captured.range.toString(),
                    start: captured.startOffset, expectedStart: scope.textContent.indexOf('clean'),
                    end: captured.endOffset, context: captured.context,
                    restored: restored.toString(), emphasis: scope.querySelector('em').textContent
                };
            });
            assert.equal(result.word, 'clean water');
            assert.equal(result.quote, 'clean water');
            assert.equal(result.selected, 'clean water');
            assert.equal(result.start, result.expectedStart);
            assert.equal(result.end, result.start + 11);
            assert.equal(result.context.includes('clean water'), true);
            assert.ok(result.context.length <= 141);
            assert.equal(result.restored, 'clean water');
            assert.equal(result.emphasis, 'water');
        });
        await t.test('excluded descendants never enter the text map and cannot be crossed', async () => {
            const results = await page.evaluate(() => {
                const cases = [
                    '<button><span>control</span></button>', '<input value="answer">',
                    '<textarea>answer</textarea>', '<select><option>answer</option></select>',
                    '<span class="vocab-translation-card"><b>translation</b></span>',
                    '<span class="vocab-paragraph-tag">A</span>',
                    '<span class="vocab-answer-blank">____</span>',
                    '<span hidden>hidden</span>', '<span style="display:none">hidden</span>',
                    '<span aria-hidden="true">hidden</span>', '<br>'
                ];
                return cases.map(html => {
                    const scope = document.createElement('div');
                    scope.dataset.vocabScope = 'scope';
                    scope.innerHTML = `clean ${html}water`;
                    document.body.replaceChildren(scope);
                    const range = document.createRange();
                    range.selectNodeContents(scope);
                    return { text: ReadingVocabAnchors.text(scope), rejected: ReadingVocabAnchors.capture(scope, range) === null };
                });
            });
            assert.equal(results.every(result => result.text === 'clean water' && result.rejected), true);
        });
        await t.test('highlight overlaps, multiple paragraphs, scopes, newlines and invalid lengths are rejected', async () => {
            const results = await page.evaluate(() => [
                'clean <mark class="vocab-highlight">water</mark>', 'clean <span class="hl">water</span>',
                '<p>clean</p><p>water</p>', 'clean <span data-vocab-scope="other">water</span>',
                'clean\nwater', '12345', 'a'.repeat(46)
            ].map(html => {
                const scope = document.createElement('div');
                scope.dataset.vocabScope = 'scope';
                scope.innerHTML = html;
                document.body.replaceChildren(scope);
                const range = document.createRange();
                range.selectNodeContents(scope);
                return ReadingVocabAnchors.capture(scope, range) === null;
            }));
            assert.equal(results.every(Boolean), true);
        });
    } finally { await page.close(); await browser.close(); }
});

test('reading vocabulary restoration requires the exact version or one complete context match', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    try {
        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({ content: source });
        const result = await page.evaluate(() => {
            const scope = document.createElement('p');
            scope.dataset.vocabScope = 'source:article:passage:0';
            document.body.append(scope);
            scope.textContent = 'water water water';
            const range = ReadingVocabAnchors.resolveOffsets(scope, 6, 11);
            const captured = ReadingVocabAnchors.capture(scope, range);
            const exact = ReadingVocabAnchors.resolve(document.body, captured).toString();
            const originalVersion = ReadingVocabAnchors.version(scope);
            const mark = document.createElement('mark');
            mark.className = 'vocab-highlight';
            mark.setAttribute('role', 'button');
            mark.tabIndex = 0;
            ReadingVocabAnchors.resolveOffsets(scope, 0, 5).surroundContents(mark);
            const stableWrapperVersion = originalVersion === ReadingVocabAnchors.version(scope);
            const sequential = ReadingVocabAnchors.capture(scope, ReadingVocabAnchors.resolveOffsets(scope, 12, 17));
            const beforeResolve = scope.innerHTML;
            const stillExact = ReadingVocabAnchors.resolve(document.body, captured).toString();
            const secondExact = ReadingVocabAnchors.resolve(document.body, sequential).toString();
            const readOnly = beforeResolve === scope.innerHTML;
            const alreadyHighlighted = ReadingVocabAnchors.resolve(scope, { ...captured, startOffset: 0, endOffset: 5 });
            scope.textContent = 'intro water water water ending';
            const changed = ReadingVocabAnchors.resolve(document.body, captured);
            const changedLocation = ReadingVocabAnchors.calculateLocation(scope, changed);
            const noOrdinalFallback = ReadingVocabAnchors.resolve(scope, { scope: captured.scope, text: 'water', occurrence: 1 }) === null;
            const partial = ReadingVocabAnchors.resolve(scope, { ...captured, before: 'water ', after: 'missing' }) === null;
            const missing = ReadingVocabAnchors.resolve(document.body, { ...captured, scopeId: 'missing' }) === null;
            const legacy = ReadingVocabAnchors.resolve(scope, { scope: captured.scope, text: 'water', before: 'water ', after: ' water' });
            const legacyLocation = ReadingVocabAnchors.calculateLocation(scope, legacy);
            scope.textContent = 'intro water water water water ending';
            const ambiguous = ReadingVocabAnchors.resolve(scope, captured) === null;
            const legacyAmbiguous = ReadingVocabAnchors.resolve(scope, { scope: captured.scope, text: 'water', before: 'water ', after: ' water' }) === null;
            scope.textContent = 'water water water';
            const wrongVersionOffset = ReadingVocabAnchors.resolve(scope, { ...captured, startOffset: 100, endOffset: 105 }) === null;
            const secondScope = scope.cloneNode(true);
            document.body.append(secondScope);
            const duplicateScope = ReadingVocabAnchors.resolve(document.body, captured) === null;
            return {
                exact, stableWrapperVersion, stillExact, secondExact, readOnly, sequentialOffset: sequential.startOffset,
                alreadyHighlighted: alreadyHighlighted === null, shiftedOffset: changedLocation.startOffset,
                noOrdinalFallback, partial, missing, legacyOffset: legacyLocation.startOffset,
                ambiguous, legacyAmbiguous, wrongVersionOffset, duplicateScope
            };
        });
        assert.deepEqual(result, {
            exact: 'water', stableWrapperVersion: true, stillExact: 'water', secondExact: 'water', readOnly: true,
            sequentialOffset: 12, alreadyHighlighted: true,
            shiftedOffset: 12, noOrdinalFallback: true, partial: true, missing: true, legacyOffset: 12,
            ambiguous: true, legacyAmbiguous: true, wrongVersionOffset: true, duplicateScope: true
        });
    } finally { await page.close(); await browser.close(); }
});

test('source edits never relocate a captured occurrence onto a different identical paragraph', async () => {
    const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    try {
        await page.setContent('<!doctype html><html><body data-vocab-source-root></body></html>');
        await page.addScriptTag({ content: source });
        const result = await page.evaluate(() => {
            const anchors = ReadingVocabAnchors;
            function render(passages, questions = []) {
                const sourceVersion = anchors.hashText(JSON.stringify({ passages, questions }));
                const scopes = [];
                for (const [area, paragraphs] of [['passage', passages], ['questions', questions]]) {
                    paragraphs.forEach((value, index) => {
                        const scope = document.createElement('p');
                        scope.dataset.vocabScope = `${area}/p-${index + 1}`;
                        scope.dataset.vocabSourceVersion = sourceVersion;
                        scope.textContent = value;
                        scopes.push(scope);
                    });
                }
                document.body.replaceChildren(...scopes);
                return scopes;
            }
            function capture(scope) {
                const offset = scope.textContent.indexOf('water');
                return anchors.capture(scope, anchors.resolveOffsets(scope, offset, offset + 5));
            }
            const paragraph = 'Clean water is precious.';
            const original = render([paragraph, paragraph]);
            const firstDuplicate = capture(original[0]);
            const secondDuplicate = capture(original[1]);
            const exactFirst = anchors.resolve(document.body, firstDuplicate).startContainer.parentElement.dataset.vocabScope;
            const exactSecond = anchors.resolve(document.body, secondDuplicate).startContainer.parentElement.dataset.vocabScope;
            const originalVersion = anchors.version(original[1]);
            const inserted = render(['A new introductory paragraph.', paragraph, paragraph]);
            const changedSourceVersion = originalVersion !== anchors.version(inserted[1]);
            const insertedDuplicateRejected = anchors.resolve(document.body, secondDuplicate) === null;
            render([paragraph]);
            const deletedDuplicateRejected = anchors.resolve(document.body, firstDuplicate) === null;
            const missingOriginalScopeRejected = anchors.resolve(document.body, secondDuplicate) === null;

            const unique = capture(render([paragraph, 'A different paragraph.'])[0]);
            render(['A different paragraph.', paragraph]);
            const moved = anchors.resolve(document.body, unique);
            const movedUniqueScope = moved.startContainer.parentElement.dataset.vocabScope;
            const missingFlagRejected = anchors.resolve(document.body, {
                ...unique, contentVersion: unique.contentVersion.replace(/\|context-unique$/, '')
            }) === null;
            render([paragraph, paragraph]);
            const newlyDuplicatedRejected = anchors.resolve(document.body, unique) === null;
            const mark = document.createElement('mark');
            mark.className = 'vocab-highlight';
            const first = document.querySelector('[data-vocab-scope="passage/p-1"]');
            const offset = first.textContent.indexOf('water');
            anchors.resolveOffsets(first, offset, offset + 5).surroundContents(mark);
            const paintedDuplicateStillAmbiguous = anchors.resolve(document.body, unique) === null;
            render(['A different paragraph.'], [paragraph]);
            const otherAreaRejected = anchors.resolve(document.body, unique) === null;
            render(['A different paragraph.', paragraph], [paragraph]);
            const questionsDoNotCreatePassageAmbiguity = !!anchors.resolve(document.body, unique);
            return {
                originalScoped: firstDuplicate.contentVersion.endsWith('|context-scoped'),
                originalUnique: unique.contentVersion.endsWith('|context-unique'),
                exactFirst, exactSecond, changedSourceVersion, insertedDuplicateRejected,
                deletedDuplicateRejected, missingOriginalScopeRejected, movedUniqueScope,
                missingFlagRejected, newlyDuplicatedRejected, paintedDuplicateStillAmbiguous,
                otherAreaRejected, questionsDoNotCreatePassageAmbiguity
            };
        });
        assert.deepEqual(result, {
            originalScoped: true, originalUnique: true, exactFirst: 'passage/p-1', exactSecond: 'passage/p-2',
            changedSourceVersion: true, insertedDuplicateRejected: true, deletedDuplicateRejected: true,
            missingOriginalScopeRejected: true, movedUniqueScope: 'passage/p-2', missingFlagRejected: true,
            newlyDuplicatedRejected: true, paintedDuplicateStillAmbiguous: true, otherAreaRejected: true,
            questionsDoNotCreatePassageAmbiguity: true
        });
    } finally { await page.close(); await browser.close(); }
});
