#!/usr/bin/env node
// Builds or checks the vocabulary-reader block baseline for every reading asset.
// The baseline records each normalized block's identity and content so a
// normalizer change can prove it keeps block sequence, count, content and
// passage/p-n identities unchanged.
//
//   node developer/tests/js/helpers/readingVocabBlockBaseline.mjs --write
//
// Regenerate it only when a reading asset's passage content changes on purpose.
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage();
        await page.addScriptTag({ path: path.join(root, 'js/components/readingVocabContent.js') });
        const results = await page.evaluate(normalizeInPage, loadReadingAssets());
        const baseline = Object.fromEntries(results.map(({ id, blocks }) => [id, baselineRows(blocks)]));
        const text = `${JSON.stringify(baseline, null, 0).replace(/\],"/g, '],\n"')}\n`;
        if (process.argv.includes('--write')) {
            fs.writeFileSync(baselinePath, text);
            console.log(`Wrote ${Object.keys(baseline).length} assets to ${path.relative(root, baselinePath)}`);
        } else {
            const same = fs.existsSync(baselinePath) && fs.readFileSync(baselinePath, 'utf8') === text;
            console.log(same ? 'Baseline matches.' : 'Baseline differs.');
            process.exitCode = same ? 0 : 1;
        }
    } finally {
        await browser.close();
    }
}
