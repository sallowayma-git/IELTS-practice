#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'runtime', 'reviewHighlightDictionary.js'), 'utf8');

function createLocalStorage(seed = {}) {
    const store = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function loadReviewHighlightDictionary() {
    const context = {
        console,
        Date,
        JSON,
        Map,
        Object,
        Set,
        String,
        Number,
        Array,
        WeakSet,
        module: { exports: {} },
        exports: {}
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'reviewHighlightDictionary.js' });
    return { api: context.module.exports, context };
}

test('review highlight fallback vocab strips unsafe stored keys before saving', () => {
    const { api, context } = loadReviewHighlightDictionary();
    const unsafeStoredList = JSON.parse(`{
        "id": "reading-highlights",
        "name": "Reading highlights",
        "__proto__": { "pollutedReviewHighlight": true },
        "constructor": { "prototype": { "pollutedReviewHighlight": true } },
        "words": [
            {
                "id": "old-word",
                "word": "archive",
                "meaning": "old",
                "__proto__": { "pollutedReviewHighlight": true },
                "prototype": { "pollutedReviewHighlight": true },
                "constructor": { "prototype": { "pollutedReviewHighlight": true } }
            }
        ]
    }`);
    context.localStorage = createLocalStorage({
        [api.storageKey]: JSON.stringify({ data: unsafeStoredList })
    });

    api._test.writeFallbackVocab({
        word: 'example',
        meaning: 'sample meaning',
        definition: 'sample definition',
        sourceLabel: 'Unit test'
    });

    const savedEnvelope = JSON.parse(context.localStorage.getItem(api.storageKey));
    const savedList = savedEnvelope.data;
    assert.equal(Object.prototype.hasOwnProperty.call(savedList, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(savedList, 'prototype'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(savedList, 'constructor'), false);
    assert.equal(savedList.words.length, 2);

    const oldWord = savedList.words.find((word) => word.id === 'old-word');
    assert(oldWord);
    assert.equal(Object.prototype.hasOwnProperty.call(oldWord, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(oldWord, 'prototype'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(oldWord, 'constructor'), false);
    assert.equal(Object.prototype.pollutedReviewHighlight, undefined);
});
