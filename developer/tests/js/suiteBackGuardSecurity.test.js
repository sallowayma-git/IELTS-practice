#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/suiteBackGuard.js'), 'utf8');
const practiceEnhancerSource = fs.readFileSync(path.join(repoRoot, 'js/practice-page-enhancer.js'), 'utf8');

const pushedStates = [];
const replacedStates = [];
const context = {
    console,
    setTimeout(callback) {
        if (typeof callback === 'function') callback();
        return 1;
    },
    addEventListener() {},
    removeEventListener() {},
    crypto: {
        randomUUID() {
            return 'test-token';
        }
    },
    document: { title: 'Suite' },
    location: { href: 'http://127.0.0.1:3000/' },
    history: {
        state: JSON.parse(`{
            "safe": "keep",
            "__proto__": { "pollutedSuiteGuard": true },
            "constructor": { "prototype": { "pollutedSuiteGuard": true } }
        }`),
        pushState(state) {
            pushedStates.push(state);
            this.state = state;
        },
        replaceState(state) {
            replacedStates.push(state);
            this.state = state;
        }
    }
};
context.window = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/utils/suiteBackGuard.js' });

const guard = context.createSuiteBackGuard({
    context,
    getSuiteSessionId: () => 'suite-1',
    tokenPrefix: 'test_suite_guard'
});

assert.equal(guard.activate(), true);
assert.equal(pushedStates.length, 1);
assert.equal(pushedStates[0].safe, 'keep');
assert.equal(Object.prototype.hasOwnProperty.call(pushedStates[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(pushedStates[0], 'constructor'), false);
assert.equal(Object.prototype.pollutedSuiteGuard, undefined);

guard.deactivate();
assert.equal(replacedStates.length, 1);
assert.equal(replacedStates[0].safe, 'keep');
assert.equal(Object.prototype.hasOwnProperty.call(replacedStates[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(replacedStates[0], 'constructor'), false);
assert.equal(Object.prototype.pollutedSuiteGuard, undefined);

assert(
    practiceEnhancerSource.includes('function copySafeHistoryState(baseState)'),
    'practice page enhancer fallback guard must use explicit history-state sanitization'
);
assert(
    !/Object\.assign\(\{\},\s*\(?\s*(?:event|window\.history\.state|state)/.test(practiceEnhancerSource),
    'practice page enhancer fallback guard must not Object.assign untrusted history state'
);
assert(
    practiceEnhancerSource.includes("HISTORY_STATE_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])"),
    'practice page enhancer fallback guard must drop prototype-pollution history keys'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'suite back guard history state sanitization tests passed'
}, null, 2));
