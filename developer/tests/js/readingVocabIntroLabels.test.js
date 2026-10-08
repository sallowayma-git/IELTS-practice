import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createPage } from './helpers/readingVocabReaderHarness.js';
import { baselinePath, digest, loadReadingAssets, normalizeInPage } from './helpers/readingVocabBlockBaseline.mjs';

// #239: unlabelled blocks before the first explicit paragraph label render as
// Intro / Intro 1..n and must not change block sequence, count, content or
// passage/p-n identities.
const contentSource = fs.readFileSync(new URL('../../../js/components/readingVocabContent.js', import.meta.url), 'utf8');
const assets = loadReadingAssets();
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const launch = () => chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const expectedLabel = block => block.letter ? `Para ${block.letter}` : block.introLabel;
const leadCount = blocks => Math.max(0, blocks.findIndex(block => block.explicitLabel));

test('intro labelling keeps every reading asset block identical to the pre-change baseline', async t => {
    const browser = await launch();
    const page = await browser.newPage();
    try {
        await page.addScriptTag({ content: contentSource });
        const results = await page.evaluate(normalizeInPage, assets);

        await t.test('every block keeps its identity, content and explicit-label status', () => {
            assert.ok(results.length > 0, 'reading assets are loaded');
            assert.deepEqual(results.map(result => result.id).sort(), Object.keys(baseline).sort(), 'baseline covers exactly the current reading assets');
            for (const { id, blocks } of results) {
                const before = baseline[id];
                assert.equal(blocks.length, before.length, `${id}: block count is unchanged`);
                const leads = leadCount(blocks);
                blocks.forEach((block, index) => {
                    const [beforeId, beforeLetter, beforeExplicit, beforeHtml, beforeText] = before[index];
                    assert.equal(block.id, beforeId, `${id} #${index}: passage/p-n identity is unchanged`);
                    assert.equal(digest(block.html), beforeHtml, `${id} ${block.id}: html is unchanged`);
                    assert.equal(digest(block.text), beforeText, `${id} ${block.id}: text is unchanged`);
                    assert.equal(block.explicitLabel, beforeExplicit, `${id} ${block.id}: explicit-label status is unchanged`);
                    if (index < leads) {
                        assert.equal(block.letter, '', `${id} ${block.id}: lead block takes no letter`);
                        assert.equal(block.introLabel, leads === 1 ? 'Intro' : `Intro ${index + 1}`, `${id} ${block.id}: intro label`);
                    } else {
                        assert.equal(block.letter, beforeLetter, `${id} ${block.id}: paragraph letter is unchanged`);
                        assert.equal(block.introLabel, undefined, `${id} ${block.id}: only lead blocks carry an intro label`);
                    }
                });
            }
        });

        await t.test('every reading asset has unique, visible paragraph labels', () => {
            for (const { id, blocks } of results) {
                const labels = blocks.map(expectedLabel);
                assert.ok(labels.every(label => typeof label === 'string' && label.trim()), `${id}: every label is visible`);
                assert.equal(new Set(labels).size, labels.length, `${id}: labels are unique (${labels.join(', ')})`);
            }
        });

        await t.test('the affected assets resolve to the approved labels', () => {
            const labelsOf = id => results.find(result => result.id === id).blocks.map(expectedLabel);
            const idsOf = id => results.find(result => result.id === id).blocks.map(block => block.id);
            const nine = Array.from({ length: 9 }, (_, index) => `p-${index + 1}`);
            for (const id of ['p1-medium-251', 'p2-high-250']) {
                assert.deepEqual(labelsOf(id), ['Intro 1', 'Intro 2', ...'ABCDEFG'.split('').map(letter => `Para ${letter}`)], id);
                assert.deepEqual(idsOf(id), nine, `${id}: keeps p-1 through p-9`);
            }
            const singleLead = ['p1-medium-57', 'p2-high-120', 'p2-high-91', 'p2-low-65', 'p2-medium-129', 'p2-medium-144', 'p3-high-181', 'p3-medium-18'];
            for (const id of singleLead) {
                const labels = labelsOf(id);
                assert.equal(labels[0], 'Intro', id);
                assert.deepEqual(labels.slice(1), labels.slice(1).map((_, index) => `Para ${String.fromCharCode(65 + index)}`), id);
            }
            const withIntro = results.filter(result => result.blocks.some(block => block.introLabel)).map(result => result.id).sort();
            assert.deepEqual(withIntro, ['p1-medium-251', 'p2-high-250', ...singleLead].sort(), 'only the ten affected assets gain intro labels');
        });
    } finally {
        await page.close();
        await browser.close();
    }
});

test('the production reader renders matching tab and card labels for every reading asset', async () => {
    const browser = await launch();
    const page = await createPage(browser);
    try {
        await page.evaluate(() => {
            // The reader creates this registry lazily on its first script load;
            // register the real assets directly so no script loading is involved.
            if (!window.__READING_EXAM_DATA__) {
                const store = new Map();
                window.__READING_EXAM_DATA__ = {
                    register: (key, value) => store.set(String(key), JSON.parse(JSON.stringify(value))),
                    get: key => (store.has(String(key)) ? JSON.parse(JSON.stringify(store.get(String(key)))) : null),
                    has: key => store.has(String(key)),
                    keys: () => [...store.keys()],
                    clear: () => store.clear()
                };
            }
            return ReadingVocabStore.init();
        });
        const failures = [];
        let checked = 0;
        for (const { id, payload } of assets) {
            const rendered = await page.evaluate(async ({ id, payload }) => {
                window.__READING_EXAM_DATA__.register(id, payload);
                await ReadingVocabReader.open(id, { source: { kind: 'builtin', id: 'default' } });
                const overlay = document.querySelector('#reading-vocab-reader-overlay');
                const tabs = [...overlay.querySelectorAll('#vocab-reader-tabs .vocab-tab-btn')]
                    .filter(button => !['all', 'questions'].includes(button.dataset.para))
                    .map(button => ({ id: button.dataset.para, label: button.textContent.trim() }));
                const cards = [...overlay.querySelectorAll('.vocab-paragraph-card')]
                    .map(card => ({ id: card.dataset.paragraphId, label: card.querySelector('.vocab-para-letter')?.textContent.trim() }));
                const expected = ReadingVocabContent.normalizePassage(payload.passage, payload.meta?.title || '').blocks
                    .map(block => ({ id: block.id, label: block.letter ? `Para ${block.letter}` : block.introLabel }));
                return { tabs, cards, expected };
            }, { id, payload });
            checked += 1;
            const labels = rendered.tabs.map(tab => tab.label);
            if (JSON.stringify(rendered.tabs) !== JSON.stringify(rendered.expected)
                || JSON.stringify(rendered.cards) !== JSON.stringify(rendered.expected)
                || new Set(labels).size !== labels.length || labels.some(label => !label)) {
                failures.push({ id, ...rendered });
            }
        }
        assert.equal(checked, Object.keys(baseline).length, 'every baseline asset is rendered');
        assert.deepEqual(failures, [], 'tabs and cards render the same unique, visible labels');
    } finally {
        await page.close();
        await browser.close();
    }
});
