#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

global.window = global;
global.AppData = {
    ready: Promise.resolve(),
    vocab: {
        async getConfig() {
            return { activeListId: 'spelling-errors-p1', dailyNew: 8 };
        },
        async readList(listId) {
            assert.strictEqual(listId, 'spelling-errors-p1');
            return {
                id: listId,
                words: [{ id: 'word-1', word: 'garden', meaning: '花园' }]
            };
        }
    }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
eval(fs.readFileSync(path.join(repoRoot, 'js/utils/vocabDataIO.js'), 'utf8'));

function makeJsonFile(payload, name = 'data.json') {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    Object.defineProperty(blob, 'name', { value: name });
    return blob;
}

const vendorWords = await window.VocabDataIO.importWordList(makeJsonFile({
    version: 'vendor-1',
    words: [{ id: 'vendor-1', word: 'alpha', meaning: 'A', correctCount: 2 }]
}, 'vendor.json'));
assert.strictEqual(vendorWords.type, 'wordlist');
assert.strictEqual(vendorWords.entries.length, 1);

const importBlob = new Blob([JSON.stringify({
    version: '2.0',
    listId: 'spelling-errors-p1',
    config: { activeListId: 'spelling-errors-p1', dailyNew: 8 },
    reviewQueue: ['legacy-derived-id'],
    words: [{ id: 'word-1', word: 'garden', meaning: '花园', nextReview: '2026-07-25T00:00:00.000Z' }]
})], { type: 'application/json' });
Object.defineProperty(importBlob, 'name', { value: 'progress.json' });

const imported = await window.VocabDataIO.importWordList(importBlob);
assert.strictEqual(imported.type, 'progress');
assert.strictEqual(imported.meta.listId, 'spelling-errors-p1');
assert.strictEqual(imported.meta.reviewQueue, undefined, 'derived review queue must not cross the import boundary');
assert.strictEqual(imported.entries[0].nextReview, '2026-07-25T00:00:00.000Z');

const exported = JSON.parse(await (await window.VocabDataIO.exportProgress()).text());
assert.strictEqual(exported.listId, 'spelling-errors-p1');
assert.strictEqual(exported.words[0].word, 'garden');
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported, 'reviewQueue'), false);
assert.strictEqual(imported.entries[0].nextReview, '2026-07-25T00:00:00.000Z');

await assert.rejects(
    window.VocabDataIO.importWordList(makeJsonFile({
        type: 'progress',
        version: '2.0',
        listId: 'spelling-errors-p1',
        config: { activeListId: 'spelling-errors-p1' },
        words: [{ word: 123, meaning: { value: 'bad' } }]
    }, 'bad-progress.json')),
    /invalid|无效/i
);

await assert.rejects(
    window.VocabDataIO.importWordList(makeJsonFile({
        type: 'progress',
        words: [{ word: 'alpha', meaning: 'A' }]
    }, 'incomplete-progress.json')),
    /v2|配置|词表/i
);

await assert.rejects(
    window.VocabDataIO.importWordList(makeJsonFile({
        version: '0.6.2-fix',
        config: { activeListId: 'default' },
        words: [{ word: 'alpha', meaning: 'A', correctCount: 2 }],
        reviewQueue: ['alpha']
    }, 'v1-progress.json')),
    /不支持 v1 进度备份/
);

const exportBlob = await window.VocabDataIO.exportProgress([
    { id: 'word-1', word: 'garden', meaning: '花园', userInput: 'gardon' }
]);
const roundTripExported = JSON.parse(await exportBlob.text());
assert.strictEqual(roundTripExported.listId, 'spelling-errors-p1');
assert.strictEqual(roundTripExported.type, 'progress');
assert.strictEqual(roundTripExported.words[0].word, 'garden');
assert.strictEqual(Object.prototype.hasOwnProperty.call(roundTripExported, 'reviewQueue'), false);
const roundTrip = await window.VocabDataIO.importWordList(makeJsonFile(roundTripExported, 'round-trip.json'));
assert.strictEqual(roundTrip.type, 'progress');
assert.strictEqual(roundTrip.entries[0].meaning, '花园');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'vocab progress import/export preserves canonical list identity and excludes derived queue'
}, null, 2));
