#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/core/resourceCore.js'), 'utf8');
const BASE_PREFIX_STORAGE_KEY = 'hp.basePrefix';

function createLocalStorage(seed = {}) {
    const state = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

function createHarness(seed = {}) {
    const localStorage = createLocalStorage(seed);
    const window = {
        localStorage,
        location: {
            href: 'http://127.0.0.1:3000/',
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:'
        }
    };
    const context = vm.createContext({
        window,
        localStorage,
        console: {
            warn() {},
            error() {},
            log() {}
        }
    });
    vm.runInContext(source, context, { filename: 'js/core/resourceCore.js' });
    return { window, localStorage };
}

const harness = createHarness({
    [BASE_PREFIX_STORAGE_KEY]: 'https://attacker.example/assets'
});
const core = harness.window.ResourceCore;

assert.equal(core.normalizeThemeBasePrefix('./'), './');
assert.equal(core.normalizeThemeBasePrefix('themes/hp/'), 'themes/hp');
assert.equal(core.normalizeThemeBasePrefix('../assets//reading/'), '../assets/reading');
assert.equal(core.normalizeThemeBasePrefix('/IELTS-practice/'), '/IELTS-practice');
assert.equal(core.normalizeThemeBasePrefix('https://attacker.example/assets'), './');
assert.equal(core.normalizeThemeBasePrefix('//attacker.example/assets'), './');
assert.equal(core.normalizeThemeBasePrefix('javascript:alert(1)'), './');
assert.equal(core.normalizeThemeBasePrefix('data:text/html,hello'), './');
assert.equal(core.normalizeThemeBasePrefix('C:\\Users\\Public\\IELTS'), './');
assert.equal(core.normalizeThemeBasePrefix('assets?debug=true'), './');
assert.equal(core.normalizeThemeBasePrefix('assets#fragment'), './');
assert.equal(core.normalizeThemeBasePrefix('bad\npath'), './');

assert.equal(core.getBasePrefix(), './');
assert.equal(core.setBasePrefix('https://attacker.example/assets'), './');
assert.equal(harness.localStorage.getItem(BASE_PREFIX_STORAGE_KEY), null);
assert.equal(core.setBasePrefix('themes/hp/'), 'themes/hp');
assert.equal(harness.localStorage.getItem(BASE_PREFIX_STORAGE_KEY), 'themes/hp');

const pathFromSafePrefix = core.buildResourcePath({
    type: 'reading',
    path: 'Cambridge 18/Test 1/',
    filename: 'Reading Passage 1.html'
});
assert(pathFromSafePrefix.startsWith('themes/hp/'), 'safe relative prefix should still be used');
assert(!pathFromSafePrefix.includes('attacker.example'), 'resource paths must not inherit rejected external prefixes');

assert.equal(core.sanitizeFilename('folder/Reading Passage 1.html', 'html'), 'folder/Reading Passage 1.html');
assert.equal(core.sanitizeFilename('../secrets.html', 'html'), '');
assert.equal(core.sanitizeFilename('%2e%2e/secrets.html', 'html'), '');
assert.equal(core.sanitizeFilename('https://attacker.example/paper.html', 'html'), '');
assert.equal(core.sanitizeFilename('paper.html?debug=true', 'html'), '');
assert.equal(core.sanitizeFilename('paper.html#fragment', 'html'), '');

assert.equal(core.buildResourcePath({
    type: 'reading',
    path: 'Cambridge 18/Test 1/',
    filename: '../secrets.html'
}), '');
assert.equal(core.buildResourcePath({
    type: 'reading',
    path: '../backend/src/',
    filename: 'app.html'
}), '');
assert.deepEqual(core.getResourceAttempts({
    type: 'reading',
    path: '../backend/src/',
    filename: 'app.html'
}, 'html'), []);
assert.deepEqual(core.getResourceAttempts({
    type: 'reading',
    path: 'Cambridge 18/Test 1/',
    filename: '%2e%2e/secrets.html'
}, 'html'), []);

assert(
    source.includes('const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i') &&
    source.includes('BASE_PREFIX_CONTROL_RE') &&
    source.includes('RESOURCE_PATH_CONTROL_RE') &&
    source.includes('function hasUnsafeRelativeResourcePath') &&
    source.includes('PATH_PROTOCOL_RE.test(normalized)') &&
    source.includes('URL_SCHEME_RE.test(normalized)') &&
    source.includes('normalized.includes(\'?\')') &&
    source.includes('normalized.includes(\'#\')'),
    'resource base prefix normalization must reject external protocols and URL fragments'
);

console.log('resourceCoreBasePrefix.test.js passed');
