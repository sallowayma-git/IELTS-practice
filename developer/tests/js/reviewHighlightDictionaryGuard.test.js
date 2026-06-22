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

function loadReviewHighlightDictionary(options = {}) {
    const context = {
        console,
        Date,
        JSON: {
            parse(value) {
                if (typeof options.onJsonParse === 'function') {
                    options.onJsonParse(value);
                }
                return JSON.parse(value);
            },
            stringify: JSON.stringify
        },
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

test('review highlight context keeps shared references but drops cycles', () => {
    const { api } = loadReviewHighlightDictionary();
    const shared = { selected: 'same paragraph' };
    const context = {
        first: shared,
        second: shared
    };
    context.self = context;

    const normalized = api._test.normalizeContextValue(context);

    assert.deepEqual(normalized.first, { selected: 'same paragraph' });
    assert.deepEqual(normalized.second, { selected: 'same paragraph' });
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'self'), false);
});

test('review highlight fallback rejects oversized storage before parsing', () => {
    let oversizedParsed = false;
    const { api, context } = loadReviewHighlightDictionary({
        onJsonParse(value) {
            if (String(value || '').length > 5 * 1024 * 1024) {
                oversizedParsed = true;
            }
        }
    });
    context.localStorage = createLocalStorage({
        [api.storageKey]: '{"data":{"words":[]},"padding":"' + 'x'.repeat((5 * 1024 * 1024) + 1) + '"}'
    });

    const saved = api._test.writeFallbackVocab({
        word: 'bounded',
        meaning: 'safe fallback',
        sourceLabel: 'Unit test'
    });

    assert.equal(saved, true);
    assert.equal(oversizedParsed, false, 'oversized fallback storage must be rejected before JSON.parse');
    const savedEnvelope = JSON.parse(context.localStorage.getItem(api.storageKey));
    assert.equal(savedEnvelope.data.words.length, 1);
    assert.equal(savedEnvelope.data.words[0].word, 'bounded');
});
