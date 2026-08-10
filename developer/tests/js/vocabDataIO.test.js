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
        async readList() {
            throw new Error('进度导出不应读取原始 collection 词条');
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

function makeCsvFile(payload, name = 'data.csv') {
    const blob = new Blob([payload], { type: 'text/csv' });
    Object.defineProperty(blob, 'name', { value: name });
    return blob;
}

const vendorWords = await window.VocabDataIO.importWordList(makeJsonFile({
    version: 'vendor-1',
    words: [{ id: 'vendor-1', word: 'alpha', meaning: 'A', correctCount: 2 }]
}, 'vendor.json'));
assert.strictEqual(vendorWords.type, 'wordlist');
assert.strictEqual(vendorWords.entries.length, 1);

const multilineCsv = await window.VocabDataIO.importWordList(makeCsvFile(
    '\uFEFFword,meaning,example,freq\r\n'
    + 'alpha,"第一行释义\r\n第二行释义","He said ""hello"", today",0.8\r\n'
    + 'beta,B,"plain example",0.5\r\n'
));
assert.strictEqual(multilineCsv.entries.length, 2);
assert.strictEqual(multilineCsv.meta.originalLength, 2);
assert.strictEqual(multilineCsv.entries[0].meaning, '第一行释义\n第二行释义');
assert.strictEqual(multilineCsv.entries[0].example, 'He said "hello", today');
assert.strictEqual(multilineCsv.entries[0].freq, 0.8);

const leadingBlankSemicolonCsv = await window.VocabDataIO.importWordList(makeCsvFile(
    '\r\n\n\uFEFFword;meaning;example;freq\r\nalpha;A;example;0.7\r\n',
    'leading-blank-semicolon.csv'
));
assert.strictEqual(leadingBlankSemicolonCsv.entries.length, 1);
assert.strictEqual(leadingBlankSemicolonCsv.entries[0].word, 'alpha');
assert.strictEqual(leadingBlankSemicolonCsv.entries[0].meaning, 'A');
assert.strictEqual(leadingBlankSemicolonCsv.entries[0].freq, 0.7);

const leadingBlankTabCsv = await window.VocabDataIO.importWordList(makeCsvFile(
    '\n\t\nword\tmeaning\texample\tfreq\nalpha\tA\texample\t0.6\n',
    'leading-blank-tab.csv'
));
assert.strictEqual(leadingBlankTabCsv.entries.length, 1);
assert.strictEqual(leadingBlankTabCsv.entries[0].word, 'alpha');
assert.strictEqual(leadingBlankTabCsv.entries[0].meaning, 'A');
assert.strictEqual(leadingBlankTabCsv.entries[0].freq, 0.6);

await assert.rejects(
    window.VocabDataIO.importWordList(makeCsvFile('word,meaning\nalpha,"未闭合释义\n')),
    /未闭合|引号/
);

const importBlob = new Blob([JSON.stringify({
    version: '2.0',
    listId: 'spelling-errors-p1',
    config: { activeListId: 'spelling-errors-p1', dailyNew: 8 },
    words: [{ id: 'word-1', word: 'garden', meaning: '花园', nextReview: '2026-07-25T00:00:00.000Z' }]
})], { type: 'application/json' });
Object.defineProperty(importBlob, 'name', { value: 'progress.json' });

const imported = await window.VocabDataIO.importWordList(importBlob);
assert.strictEqual(imported.type, 'progress');
assert.strictEqual(imported.meta.listId, 'spelling-errors-p1');
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
const exported = JSON.parse(await exportBlob.text());
assert.strictEqual(exported.listId, 'spelling-errors-p1');
assert.strictEqual(exported.type, 'progress');
assert.strictEqual(exported.words[0].word, 'garden');
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported, 'reviewQueue'), false);
const roundTrip = await window.VocabDataIO.importWordList(makeJsonFile(exported, 'round-trip.json'));
assert.strictEqual(roundTrip.type, 'progress');
assert.strictEqual(roundTrip.entries[0].meaning, '花园');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'CSV multiline parsing and canonical vocab progress import/export checks passed'
}, null, 2));
