import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installReadingAuthority } from './helpers/readingVocabReaderHarness.js';

const readerSource = fs.readFileSync(new URL('../../../js/components/readingVocabReader.js', import.meta.url), 'utf8');
const registryPath = fileURLToPath(new URL('../../../js/runtime/readingExamRegistry.js', import.meta.url));

test('reader questions are selectable text with isolated identities and no answering behavior', async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage();
        await page.route('https://reader.test/**', route => route.fulfill({ contentType: 'text/html', body: `
            <button id="launch">Open reader</button><div id="practice">
              <input type="radio" id="choice-a" name="q1" value="A" checked>
              <input type="radio" name="q1" value="B">
              <input type="text" id="answer" name="q2" value="original">
              <p id="description">Practice description</p>
            </div>` }));
        await page.goto('https://reader.test/');
        await installReadingAuthority(page);
        await page.addScriptTag({ path: registryPath });
        await page.evaluate(() => {
            window.__READING_EXPLANATION_MANIFEST__ = {};
            __READING_EXAM_DATA__.register('isolation', {
                meta: { title: 'Isolation fixture' },
                passage: { blocks: [{ html: '<p>A sufficiently long article for selectable reading content.</p>' }] },
                questionGroups: [{ bodyHtml: `
                    <form id="practice" onsubmit="window.__submitted=true">
                      <p id="description">Read the <em>question</em> and choose a response.</p>
                      <label for="choice-a"><input type="radio" id="choice-a" name="q1" value="B" checked> B Alternative</label>
                      <label for="answer">Answer</label><input id="answer" name="q2" value="reader" aria-describedby="description outside">
                      <input type="checkbox" name="q3" checked><textarea name="q4">preset</textarea>
                      <select name="q5"><option>Choose</option><option value="A">A Alpha</option><option value="B">B Beta</option></select>
                      <input type="hidden" name="q6" value="hidden"><button type="submit">Submit</button>
                      <a href="#answer" onclick="window.__clicked=true">Reference</a>
                      <div id="answer" class="match-dropzone" data-question="q7" tabindex="0" contenteditable="true"></div>
                      <div class="drag-item" draggable="true" data-option="A" onmousedown="window.__dragged=true">A Selectable option</div>
                      <div class="drop-target-summary" data-question="q8"></div>
                      <div class="options-pool pool-items"><span class="draggable-word">summary option</span></div>
                      <div class="cardpool"><div class="card">card option</div></div>
                    </form>` }, { bodyHtml: '<p id="answer">Repeated source identity</p>' }]
            });
        });
        await page.addScriptTag({ content: readerSource });
        await page.evaluate(() => ReadingVocabReader.open('isolation', { fromPractice: true }));
        const state = await page.evaluate(() => {
            const questions = document.getElementById('vocab-questions-content');
            const identities = [...document.querySelectorAll('[id]')].map(node => node.id);
            const range = document.createRange();
            range.selectNodeContents(questions.querySelector('em'));
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            const selected = getSelection().toString();
            questions.querySelector('em').click();
            questions.querySelector('.vocab-question-options').click();
            return {
                selected, text: questions.textContent,
                controls: questions.querySelectorAll('input, textarea, select, button, form, label, [name], [for], [href], [contenteditable], [draggable], [tabindex]:not([data-vocab-scope]), [onclick], [onmousedown], .drag-item, .match-dropzone, .drop-target-summary, .draggable-word, .card, .pool-items, .options-pool, .cardpool, [data-question]').length,
                keyboardScopes: [...questions.querySelectorAll('[data-vocab-scope]')].map(node => ({ id: node.dataset.vocabScope, tabIndex: node.tabIndex })),
                duplicateIds: identities.filter((id, index) => identities.indexOf(id) !== index),
                answer: document.getElementById('answer').value,
                checked: document.getElementById('choice-a').checked,
                action: !!(window.__clicked || window.__submitted || window.__dragged)
            };
        });
        assert.equal(state.selected, 'question');
        assert.equal(state.controls, 0);
        assert.ok(state.keyboardScopes.length > 0, 'Question text remains reachable for keyboard selections');
        assert.ok(state.keyboardScopes.every(scope => /^questions\/q-\d+\/p-\d+$/.test(scope.id) && scope.tabIndex === 0));
        assert.equal(new Set(state.keyboardScopes.map(scope => scope.id)).size, state.keyboardScopes.length);
        assert.deepEqual(state.duplicateIds, []);
        assert.equal(state.answer, 'original');
        assert.equal(state.checked, true, 'checked reader radios must be inert before insertion');
        assert.equal(state.action, false);
        for (const text of ['B Alternative', 'A Alpha / B Beta', 'A Selectable option', '________']) assert.ok(state.text.includes(text), text);
        await page.evaluate(() => ReadingVocabReader.close());
        assert.equal(await page.locator('#vocab-questions-content input, #vocab-questions-content select').count(), 0);
    } finally { await browser.close(); }
});
