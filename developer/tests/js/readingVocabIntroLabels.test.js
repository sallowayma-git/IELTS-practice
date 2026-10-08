import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPage } from './helpers/readingVocabReaderHarness.js';
import { baselinePath, compareToBaseline, digest, loadReadingAssets, normalizeInPage } from './helpers/readingVocabBlockBaseline.mjs';

// #239: unlabelled blocks before the first explicit paragraph label render as
// Intro / Intro 1..n and must not change block sequence, count, content or
// passage/p-n identities.
const contentSource = fs.readFileSync(new URL('../../../js/components/readingVocabContent.js', import.meta.url), 'utf8');
const assets = loadReadingAssets();
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const launch = () => chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
const expectedLabel = block => block.letter ? `Para ${block.letter}` : block.introLabel;

test('baseline comparison permits only the approved intro-label delta', () => {
    const fixture = {
        sample: [
            ['p-1', 'A', false, digest('<p>Lead</p>'), digest('Lead')],
            ['p-2', 'A', true, digest('<p>Paragraph A</p>'), digest('Paragraph A')]
        ]
    };
    const results = [{
        id: 'sample',
        blocks: [
            { id: 'p-1', letter: '', introLabel: 'Intro', explicitLabel: false, html: '<p>Lead</p>', text: 'Lead' },
            { id: 'p-2', letter: 'A', explicitLabel: true, html: '<p>Paragraph A</p>', text: 'Paragraph A' }
        ]
    }];
    assert.deepEqual(compareToBaseline(results, fixture), []);

    const changed = structuredClone(results);
    changed[0].blocks[0].introLabel = 'Preface';
    changed[0].blocks[1].letter = 'B';
    changed[0].blocks[1].text = 'Changed';
    assert.deepEqual(compareToBaseline(changed, fixture), [
        'sample #1: lead block should be unlettered "Intro"',
        'sample #2: text changed',
        'sample #2: letter A -> B'
    ]);
});

test('intro labelling keeps every reading asset block identical to the pre-change baseline', async t => {
    const browser = await launch();
    const page = await browser.newPage();
    try {
        await page.addScriptTag({ content: contentSource });
        const results = await page.evaluate(normalizeInPage, assets);

        await t.test('every block keeps its identity, content and explicit-label status', () => {
            assert.ok(results.length > 0, 'reading assets are loaded');
            assert.deepEqual(compareToBaseline(results, baseline), [], 'only the approved intro-label delta differs from the pre-change baseline');
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

test('the baseline helper check passes against the committed baseline', () => {
    const helper = fileURLToPath(new URL('./helpers/readingVocabBlockBaseline.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [helper], { encoding: 'utf8', env: process.env, timeout: 120_000 });
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.match(run.stdout, /^Baseline matches \(\d+ assets\)\./m);
});
