#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadVocabDataIO() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const sandbox = {
        window: {},
        console: quietConsole,
        Blob,
        FileReader: class {},
        module: { exports: {} },
        exports: {}
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/vocabDataIO.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/utils/vocabDataIO.js' });
    return sandbox.module.exports;
}

function createImportFile(text, name, type) {
    const file = new Blob([text], { type });
    Object.defineProperty(file, 'name', { value: name });
    return file;
}

function createWord(index, extra = {}) {
    return {
        word: `word-${index}`,
        meaning: `meaning-${index}`,
        example: `example-${index}`,
        ...extra
    };
}

async function testJsonArrayImportCapsEntries() {
    const api = loadVocabDataIO();
    const payload = Array.from({ length: 5002 }, (_, index) => createWord(index));
    const file = createImportFile(JSON.stringify(payload), 'words.json', 'application/json');

    const result = await api.importWordList(file);

    assert.equal(result.type, 'wordlist');
    assert.equal(result.entries.length, 5000);
    assert.equal(result.meta.originalLength, 5002);
    assert.equal(result.entries.at(-1).word, 'word-4999');
    assert(!result.entries.some((entry) => entry.word === 'word-5001'));
}

async function testProgressImportCapsWordsAndReviewQueue() {
    const api = loadVocabDataIO();
    const payload = {
        version: '1.0.0',
        reviewQueue: Array.from({ length: 5002 }, (_, index) => `word-${index}`),
        words: Array.from({ length: 5002 }, (_, index) => createWord(index, { id: `id-${index}` }))
    };
    const file = createImportFile(JSON.stringify(payload), 'progress.json', 'application/json');

    const result = await api.importWordList(file);

    assert.equal(result.type, 'progress');
    assert.equal(result.entries.length, 5000);
    assert.equal(result.meta.originalLength, 5002);
    assert.equal(result.meta.reviewQueue.length, 5000);
    assert.equal(result.entries.at(-1).word, 'word-4999');
}

async function testProgressImportStripsUnsafeKeys() {
    const api = loadVocabDataIO();
    const payload = `{
        "version": "1.0.0",
        "name": "Unsafe progress backup",
        "config": {
            "dailyNew": 25,
            "reviewLimit": 90,
            "theme": "dark",
            "__proto__": { "pollutedConfig": true },
            "constructor": { "prototype": { "pollutedConfig": true } },
            "admin": true
        },
        "reviewQueue": ["safe-id", "__proto__", "constructor", "next-id"],
        "words": [{
            "id": "safe-id",
            "word": "secure",
            "meaning": "safe",
            "example": "safe example",
            "note": "safe note",
            "source": "import",
            "correctCount": 3,
            "lastReviewed": "2026-06-19T10:00:00.000Z",
            "__proto__": { "pollutedEntry": true },
            "constructor": { "prototype": { "pollutedEntry": true } },
            "isAdmin": true,
            "html": "<img src=x onerror=alert(1)>",
            "metadata": {
                "ok": "yes",
                "__proto__": { "pollutedMetadata": true },
                "constructor": { "prototype": { "pollutedMetadata": true } }
            },
            "acceptedAnswers": [
                "secure",
                {
                    "text": "safe",
                    "__proto__": { "pollutedAnswer": true }
                }
            ]
        }]
    }`;
    const file = createImportFile(payload, 'progress.json', 'application/json');

    const result = await api.importWordList(file);
    const entry = result.entries[0];

    assert.equal(result.type, 'progress');
    assert.equal(entry.word, 'secure');
    assert.equal(entry.correctCount, 3);
    assert.equal(entry.isAdmin, undefined);
    assert.equal(entry.html, undefined);
    assert.equal(entry.pollutedEntry, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(entry, 'constructor'), false);
    assert.equal(entry.metadata.ok, 'yes');
    assert.equal(entry.metadata.pollutedMetadata, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(entry.metadata, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(entry.metadata, 'constructor'), false);
    assert.equal(entry.acceptedAnswers[1].text, 'safe');
    assert.equal(entry.acceptedAnswers[1].pollutedAnswer, undefined);
    assert.deepEqual(result.meta.config, {
        dailyNew: 25,
        reviewLimit: 90,
        theme: 'dark'
    });
    assert.deepEqual(result.meta.reviewQueue, ['safe-id', 'next-id']);
    assert.equal(Object.prototype.pollutedEntry, undefined);
    assert.equal(Object.prototype.pollutedMetadata, undefined);
    assert.equal(Object.prototype.pollutedConfig, undefined);
}

async function testCsvImportCapsRows() {
    const api = loadVocabDataIO();
    const rows = ['word,meaning,example'];
    for (let index = 0; index < 5002; index += 1) {
        rows.push(`word-${index},meaning-${index},example-${index}`);
    }
    const file = createImportFile(rows.join('\n'), 'words.csv', 'text/csv');

    const result = await api.importWordList(file);

    assert.equal(result.type, 'wordlist');
    assert.equal(result.entries.length, 5000);
    assert.equal(result.meta.originalLength, 5002);
    assert.equal(result.entries.at(-1).word, 'word-4999');
}

function testValidateSchemaRejectsOversizedPayloads() {
    const api = loadVocabDataIO();
    const payload = Array.from({ length: 5001 }, (_, index) => createWord(index));
    assert.equal(api.validateSchema(payload), false);
    assert.equal(api.validateSchema({ words: payload }), false);
}

async function main() {
    await testJsonArrayImportCapsEntries();
    await testProgressImportCapsWordsAndReviewQueue();
    await testProgressImportStripsUnsafeKeys();
    await testCsvImportCapsRows();
    testValidateSchemaRejectsOversizedPayloads();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'vocab data import limit tests passed'
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
