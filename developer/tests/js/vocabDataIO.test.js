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

function makeCsvFile(payload, name = 'data.csv') {
    const blob = new Blob([payload], { type: 'text/csv' });
    Object.defineProperty(blob, 'name', { value: name });
    return blob;
}

const vendorWords = await window.VocabDataIO.importWordList(makeJsonFile({
    version: 'vendor-1',
    words: [
        {
            id: 'vendor-1',
            word: '  alpha  ',
            meaning: '  A  ',
            phonetic: '  /ˈæl.fə/  ',
            correctCount: 2
        },
        { id: 'vendor-2', word: 'beta', meaning: 'B', phonetic: '   ' },
        { id: 'vendor-3', word: 'gamma', meaning: 'C', phonetic: 42 },
        { id: 'vendor-4', word: 'delta', meaning: 'D', phonetic: ' / ' },
        { id: 'vendor-5', word: 'epsilon', meaning: 'E', phonetic: ' /// ' },
        { id: 'vendor-6', word: 'zeta', meaning: 'F', phonetic: ' /fu: ' },
        { id: 'vendor-7', word: 'eta', meaning: 'G', phonetic: ' fu:/ ' }
    ]
}, 'vendor.json'));
assert.strictEqual(vendorWords.type, 'wordlist');
assert.strictEqual(vendorWords.entries.length, 7);
assert.strictEqual(vendorWords.entries[0].word, 'alpha');
assert.strictEqual(vendorWords.entries[0].meaning, 'A');
assert.strictEqual(vendorWords.entries[0].phonetic, 'ˈæl.fə');
assert.strictEqual(Object.prototype.hasOwnProperty.call(vendorWords.entries[1], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(vendorWords.entries[2], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(vendorWords.entries[3], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(vendorWords.entries[4], 'phonetic'), false);
assert.strictEqual(vendorWords.entries[5].phonetic, 'fu:');
assert.strictEqual(vendorWords.entries[6].phonetic, 'fu:');

const entryEnvelopeWords = await window.VocabDataIO.importWordList(makeJsonFile({
    version: 'vendor-entries-1',
    entries: [
        { word: 'delta', meaning: 'D', phonetic: '  ˈdel.tə  ' },
        { word: 'epsilon', meaning: 'E', phonetic: null }
    ]
}, 'vendor-entries.json'));
assert.strictEqual(entryEnvelopeWords.type, 'wordlist');
assert.strictEqual(entryEnvelopeWords.entries.length, 2);
assert.strictEqual(entryEnvelopeWords.entries[0].phonetic, 'ˈdel.tə');
assert.strictEqual(Object.prototype.hasOwnProperty.call(entryEnvelopeWords.entries[1], 'phonetic'), false);

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
assert.strictEqual(Object.prototype.hasOwnProperty.call(multilineCsv.entries[0], 'phonetic'), false);

const phoneticCsv = await window.VocabDataIO.importWordList(makeCsvFile(
    'word,meaning,phonetic,example,freq\n'
    + 'alpha,A,"  /ˈæl.fə/  ",example,0.8\n'
    + 'beta,B,,example,0.5\n'
    + 'gamma,C,/fu:,example,0.4\n'
    + 'delta,D,fu:/,example,0.3\n'
));
assert.strictEqual(phoneticCsv.entries.length, 4);
assert.strictEqual(phoneticCsv.entries[0].phonetic, 'ˈæl.fə');
assert.strictEqual(Object.prototype.hasOwnProperty.call(phoneticCsv.entries[1], 'phonetic'), false);
assert.strictEqual(phoneticCsv.entries[2].phonetic, 'fu:');
assert.strictEqual(phoneticCsv.entries[3].phonetic, 'fu:');

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
    words: [{
        id: 'word-1',
        word: '  garden  ',
        meaning: '  花园  ',
        phonetic: '  /ˈɡɑː.dən/  ',
        nextReview: '2026-07-25T00:00:00.000Z'
    }]
})], { type: 'application/json' });
Object.defineProperty(importBlob, 'name', { value: 'progress.json' });

const imported = await window.VocabDataIO.importWordList(importBlob);
assert.strictEqual(imported.type, 'progress');
assert.strictEqual(imported.meta.listId, 'spelling-errors-p1');
assert.strictEqual(imported.entries[0].word, 'garden');
assert.strictEqual(imported.entries[0].meaning, '花园');
assert.strictEqual(imported.entries[0].phonetic, 'ˈɡɑː.dən');
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
    {
        id: 'word-1',
        word: '  garden  ',
        meaning: '  花园  ',
        phonetic: '  /ˈɡɑː.dən/  ',
        userInput: 'gardon'
    },
    { id: 'word-2', word: 'river', meaning: '河流', phonetic: '' },
    { id: 'word-3', word: 'forest', meaning: '森林', phonetic: { value: 'ˈfɒr.ɪst' } }
]);
const exported = JSON.parse(await exportBlob.text());
assert.strictEqual(exported.listId, 'spelling-errors-p1');
assert.strictEqual(exported.type, 'progress');
assert.strictEqual(exported.words[0].word, 'garden');
assert.strictEqual(exported.words[0].meaning, '花园');
assert.strictEqual(exported.words[0].phonetic, 'ˈɡɑː.dən');
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported.words[1], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported.words[2], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(exported, 'reviewQueue'), false);
const roundTrip = await window.VocabDataIO.importWordList(makeJsonFile(exported, 'round-trip.json'));
assert.strictEqual(roundTrip.type, 'progress');
assert.strictEqual(roundTrip.entries[0].meaning, '花园');
assert.strictEqual(roundTrip.entries[0].phonetic, 'ˈɡɑː.dən');
assert.strictEqual(Object.prototype.hasOwnProperty.call(roundTrip.entries[1], 'phonetic'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(roundTrip.entries[2], 'phonetic'), false);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'CSV parsing and canonical vocab phonetic import/export checks passed'
}, null, 2));
