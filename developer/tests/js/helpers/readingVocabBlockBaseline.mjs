#!/usr/bin/env node
// Builds or checks the vocabulary-reader block baseline for every reading asset.
// The baseline records each normalized block's identity and content so a
// normalizer change can prove it keeps block sequence, count, content and
// passage/p-n identities unchanged.
//
//   node developer/tests/js/helpers/readingVocabBlockBaseline.mjs           check
//   node developer/tests/js/helpers/readingVocabBlockBaseline.mjs --write   rebuild
//
// The check compares the preserved invariants (see compareToBaseline), not the
// file bytes. Rebuild only when a reading asset's passage content changes on
// purpose.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const baselinePath = path.join(root, 'developer/tests/js/fixtures/reading-vocab-block-baseline.json');
const assetDir = path.join(root, 'assets/generated/reading-exams');

export const digest = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);

export function loadReadingAsset(id) {
    let payload = null;
    const global = { __READING_EXAM_DATA__: { register: (_key, value) => { payload = value; } } };
    vm.runInNewContext(fs.readFileSync(path.join(assetDir, `${id}.js`), 'utf8'), { window: global, globalThis: global });
    return payload;
}

export function loadReadingAssets() {
    return fs.readdirSync(assetDir)
        .filter(name => /^p[1-3]-.+\.js$/.test(name))
        .sort()
        .map(name => ({ id: name.replace(/\.js$/, ''), payload: loadReadingAsset(name.replace(/\.js$/, '')) }))
        .filter(asset => asset.payload?.passage);
}

// Runs inside a page that has readingVocabContent.js loaded.
export function normalizeInPage(assets) {
    return assets.map(({ id, payload }) => {
        const data = window.ReadingVocabContent.normalizePassage(payload.passage, payload.meta?.title || '');
        return { id, blocks: data.blocks.map(block => ({ ...block })) };
    });
}

export function baselineRows(blocks) {
    return blocks.map(block => [block.id, block.letter, block.explicitLabel, digest(block.html), digest(block.text)]);
}

// The contract shared by the check mode and the tests: every block keeps its
// passage/p-n id, html, text and explicit-label status. Letters are kept too,
// except the intentional #239 delta: unlabelled blocks before the first explicit
// label take no letter and are labelled Intro, or Intro 1, Intro 2, ... in order.
// Returns the list of violations (empty when the baseline holds).
export function compareToBaseline(results, baseline) {
    const problems = [];
    const ids = results.map(result => result.id).sort();
    const expectedIds = Object.keys(baseline).sort();
    if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) problems.push('reading asset set differs from the baseline');
    for (const { id, blocks } of results) {
        const before = baseline[id];
        if (!before) continue;
        if (blocks.length !== before.length) {
            problems.push(`${id}: block count ${before.length} -> ${blocks.length}`);
            continue;
        }
        const leads = Math.max(0, blocks.findIndex(block => block.explicitLabel));
        blocks.forEach((block, index) => {
            const [beforeId, beforeLetter, beforeExplicit, beforeHtml, beforeText] = before[index];
            const where = `${id} #${index + 1}`;
            if (block.id !== beforeId) problems.push(`${where}: id ${beforeId} -> ${block.id}`);
            if (digest(block.html) !== beforeHtml) problems.push(`${where}: html changed`);
            if (digest(block.text) !== beforeText) problems.push(`${where}: text changed`);
            if (block.explicitLabel !== beforeExplicit) problems.push(`${where}: explicit-label status changed`);
            if (index < leads) {
                const introLabel = leads === 1 ? 'Intro' : `Intro ${index + 1}`;
                if (block.letter !== '' || block.introLabel !== introLabel) {
                    problems.push(`${where}: lead block should be unlettered "${introLabel}"`);
                }
            } else {
                if (block.letter !== beforeLetter) problems.push(`${where}: letter ${beforeLetter} -> ${block.letter}`);
                if (block.introLabel !== undefined) problems.push(`${where}: unexpected intro label`);
            }
        });
    }
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage();
        await page.addScriptTag({ path: path.join(root, 'js/components/readingVocabContent.js') });
        const results = await page.evaluate(normalizeInPage, loadReadingAssets());
        if (process.argv.includes('--write')) {
            const baseline = Object.fromEntries(results.map(({ id, blocks }) => [id, baselineRows(blocks)]));
            fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 0).replace(/\],"/g, '],\n"')}\n`);
            console.log(`Wrote ${Object.keys(baseline).length} assets to ${path.relative(root, baselinePath)}`);
        } else {
            const problems = fs.existsSync(baselinePath)
                ? compareToBaseline(results, JSON.parse(fs.readFileSync(baselinePath, 'utf8')))
                : ['baseline file is missing'];
            if (problems.length) {
                console.log(`Baseline differs (${problems.length}):\n${problems.slice(0, 20).join('\n')}`);
                process.exitCode = 1;
            } else {
                console.log(`Baseline matches (${results.length} assets).`);
            }
        }
    } finally {
        await browser.close();
    }
}
