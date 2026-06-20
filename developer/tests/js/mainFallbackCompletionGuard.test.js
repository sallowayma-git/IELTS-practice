#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');

assert(
    source.includes('MAX_FALLBACK_ANSWER_ENTRIES = 200') &&
    source.includes('MAX_FALLBACK_ANSWER_TEXT_LENGTH = 500') &&
    source.includes('MAX_FALLBACK_ANSWER_KEY_LENGTH = 80') &&
    source.includes('MAX_FALLBACK_ANSWER_ARRAY_ITEMS = 25') &&
    source.includes('MAX_FALLBACK_ANSWER_OBJECT_KEYS = 25') &&
    source.includes('MAX_FALLBACK_ANSWER_DEPTH = 4'),
    'fallback completion answers must define bounded entry, text, key, array, object, and depth limits'
);

assert(
    source.includes("FALLBACK_ANSWER_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    source.includes('function normalizeFallbackAnswerKey') &&
    source.includes('FALLBACK_ANSWER_POLLUTION_KEYS.has(key)') &&
    source.includes('const map = Object.create(null)') &&
    source.includes('const details = Object.create(null)') &&
    source.includes('const normalized = Object.create(null)'),
    'fallback completion answer maps must reject prototype-polluting keys and use null-prototype containers'
);

assert(
    source.includes('function countFallbackAnswerKeys') &&
    source.includes('Object.prototype.hasOwnProperty.call(value, key)') &&
    source.includes('countFallbackAnswerKeys(payload.answerComparison)') &&
    source.includes('countFallbackAnswerKeys(payload.answers)'),
    'fallback completion score extraction must count answer keys with bounded enumeration'
);

assert(
    source.includes('rawAnswers.slice(0, MAX_FALLBACK_ANSWER_ENTRIES)') &&
    source.includes('if (count >= MAX_FALLBACK_ANSWER_ENTRIES)') &&
    source.includes('Array.from(keys).slice(0, MAX_FALLBACK_ANSWER_ENTRIES)') &&
    source.includes('Array.from(mergedKeys).slice(0, MAX_FALLBACK_ANSWER_ENTRIES)'),
    'fallback completion answer normalization must cap arrays, objects, details, and comparison merges'
);

assert(
    source.includes('.slice(0, MAX_FALLBACK_ANSWER_ARRAY_ITEMS)') &&
    source.includes('if (depth > MAX_FALLBACK_ANSWER_DEPTH)') &&
    source.includes('state.seen.has(value)') &&
    source.includes('copied >= MAX_FALLBACK_ANSWER_OBJECT_KEYS') &&
    source.includes('truncateFallbackAnswerText(json)'),
    'fallback completion answer values must cap nested arrays/objects and avoid circular or oversized stringification'
);

assert(
    !source.includes('const map = {};') &&
    !source.includes('const details = {};') &&
    !source.includes('const normalized = {};') &&
    !source.includes('Object.entries(rawAnswers).forEach') &&
    !source.includes('Object.entries(source).forEach'),
    'fallback completion code must not keep old unbounded plain-object normalization paths'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'main fallback completion payload guard tests passed'
}, null, 2));
