import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const CORE_JSON_PATH = path.join(root, 'assets', 'wordlists', 'ielts_core.json');
const CORE_BUNDLE_PATH = path.join(root, 'assets', 'wordlists', 'ielts_core.bundle.js');
const ECDICT_BUNDLE_PATH = path.join(root, 'assets', 'wordlists', 'ecdict_reading.bundle.js');
const ECDICT_LICENSE_PATH = path.join(root, 'assets', 'wordlists', 'ECDICT_LICENSE.txt');
const MIN_UNIQUE_COVERAGE = 3535;
const MAX_RUNTIME_PAYLOAD_GROWTH = 150_000;
const checkOnly = process.argv.includes('--check');

function normalizeLookupKey(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizePhonetic(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/^\/+|\/+$/g, '').trim();
}

function loadEcdictEntries() {
    const source = fs.readFileSync(ECDICT_BUNDLE_PATH, 'utf8');
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox, {
        filename: path.relative(root, ECDICT_BUNDLE_PATH),
        timeout: 15_000
    });
    const entries = sandbox.__LOCAL_DICTIONARIES__
        && sandbox.__LOCAL_DICTIONARIES__.ecdict
        && sandbox.__LOCAL_DICTIONARIES__.ecdict.entries;
    if (!Array.isArray(entries) || !entries.length) {
        throw new Error('The checked-in ECDICT bundle does not expose any entries.');
    }
    return entries;
}

function buildPhoneticLookup(entries) {
    const lookup = new Map();
    entries.forEach((entry) => {
        const key = normalizeLookupKey(entry && entry.w);
        const phonetic = normalizePhonetic(entry && entry.p);
        if (key && phonetic && !lookup.has(key)) {
            lookup.set(key, phonetic);
        }
    });
    return lookup;
}

function renderCoreBundle(entries) {
    return [
        '(function(window){',
        "  'use strict';",
        '  var root = window || globalThis;',
        '  var existing = root.__EMBEDDED_WORDLISTS__ || {};',
        `  existing.ielts_core = ${JSON.stringify(entries)};`,
        '  root.__EMBEDDED_WORDLISTS__ = existing;',
        "})(typeof window !== 'undefined' ? window : globalThis);",
        ''
    ].join('\n');
}

function assertCurrent(pathname, expected, stale) {
    const actual = fs.existsSync(pathname) ? fs.readFileSync(pathname, 'utf8') : null;
    if (actual !== expected) {
        stale.push(path.relative(root, pathname).replace(/\\/g, '/'));
    }
}

if (!fs.existsSync(ECDICT_LICENSE_PATH)) {
    throw new Error('ECDICT attribution is missing from assets/wordlists/ECDICT_LICENSE.txt.');
}

const currentCore = JSON.parse(fs.readFileSync(CORE_JSON_PATH, 'utf8'));
if (!Array.isArray(currentCore) || !currentCore.length) {
    throw new Error('IELTS core vocabulary must be a non-empty JSON array.');
}

const baseCore = currentCore.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('IELTS core vocabulary contains a non-object entry.');
    }
    const { phonetic: _ignored, ...base } = entry;
    return base;
});
const phoneticLookup = buildPhoneticLookup(loadEcdictEntries());
const coveredUniqueWords = new Set();
let coveredRows = 0;
const enrichedCore = baseCore.map((entry) => {
    const key = normalizeLookupKey(entry.word);
    const phonetic = phoneticLookup.get(key) || '';
    if (!phonetic) return entry;
    coveredRows += 1;
    coveredUniqueWords.add(key);
    return { ...entry, phonetic };
});

const uniqueCoreWords = new Set(baseCore.map((entry) => normalizeLookupKey(entry.word)).filter(Boolean));
if (coveredUniqueWords.size < MIN_UNIQUE_COVERAGE) {
    throw new Error(`IELTS core phonetic coverage ${coveredUniqueWords.size}/${uniqueCoreWords.size} is below ${MIN_UNIQUE_COVERAGE}.`);
}
if (enrichedCore.some((entry) => entry.phonetic !== undefined && !normalizePhonetic(entry.phonetic))) {
    throw new Error('IELTS core contains an empty phonetic value.');
}
if (enrichedCore.some((entry) => typeof entry.phonetic === 'string' && (entry.phonetic.startsWith('/') || entry.phonetic.endsWith('/')))) {
    throw new Error('IELTS core phonetics must be stored without presentation slashes.');
}

const basePayloadBytes = Buffer.byteLength(JSON.stringify(baseCore), 'utf8');
const enrichedPayloadBytes = Buffer.byteLength(JSON.stringify(enrichedCore), 'utf8');
const payloadGrowth = enrichedPayloadBytes - basePayloadBytes;
const prettyPayloadGrowth = Buffer.byteLength(JSON.stringify(enrichedCore, null, 2), 'utf8')
    - Buffer.byteLength(JSON.stringify(baseCore, null, 2), 'utf8');
if (payloadGrowth > MAX_RUNTIME_PAYLOAD_GROWTH || prettyPayloadGrowth > MAX_RUNTIME_PAYLOAD_GROWTH) {
    throw new Error(`IELTS core payload growth (${payloadGrowth} compact, ${prettyPayloadGrowth} pretty bytes) exceeds the ${MAX_RUNTIME_PAYLOAD_GROWTH}-byte budget.`);
}

const expectedJson = `${JSON.stringify(enrichedCore, null, 2)}\n`;
const expectedBundle = renderCoreBundle(enrichedCore);
if (checkOnly) {
    const stale = [];
    assertCurrent(CORE_JSON_PATH, expectedJson, stale);
    assertCurrent(CORE_BUNDLE_PATH, expectedBundle, stale);
    if (stale.length) {
        throw new Error(`Stale IELTS core phonetic assets:\n${stale.map((item) => `  - ${item}`).join('\n')}`);
    }
} else {
    fs.writeFileSync(CORE_JSON_PATH, expectedJson, 'utf8');
    fs.writeFileSync(CORE_BUNDLE_PATH, expectedBundle, 'utf8');
}

console.log(`IELTS core phonetics: ${coveredRows}/${baseCore.length} rows, ${coveredUniqueWords.size}/${uniqueCoreWords.size} unique headwords`);
console.log(`IELTS core payload growth: ${payloadGrowth} compact, ${prettyPayloadGrowth} pretty bytes`);
console.log(checkOnly ? 'IELTS core phonetic assets are current.' : 'Wrote IELTS core JSON and embedded bundle.');
