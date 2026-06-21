#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/practice-page-enhancer.js'), 'utf8');

const maliciousConfig = JSON.parse(`{
    "autoInitialize": false,
    "excludedSelectors": [".safe-selector"],
    "__proto__": { "pollutedEnhancerConfig": true },
    "constructor": { "prototype": { "pollutedEnhancerConfig": true } },
    "nested": {
        "safe": "ok",
        "prototype": { "pollutedNestedEnhancerConfig": true }
    }
}`);

const context = {
    console: {
        log() {},
        warn() {},
        error() {},
        info() {}
    },
    document: {
        readyState: 'complete',
        currentScript: null,
        querySelectorAll() {
            return [];
        },
        addEventListener() {}
    },
    window: {
        practicePageEnhancerConfig: maliciousConfig,
        location: {
            href: 'http://127.0.0.1:3000/templates/mock/exam.html',
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:'
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        CSS: {
            escape(value) {
                return String(value);
            }
        }
    },
    URL,
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {}
};
context.window.window = context.window;
context.window.document = context.document;
context.globalThis = context.window;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/practice-page-enhancer.js' });

const config = context.window.practicePageEnhancer.config;

assert(config);
assert.equal(config.autoInitialize, false);
assert(config.excludedSelectors.includes('.safe-selector'));
assert.equal(Object.prototype.pollutedEnhancerConfig, undefined);
assert.equal(Object.prototype.pollutedNestedEnhancerConfig, undefined);
assert.equal('pollutedEnhancerConfig' in config, false);
assert.equal(Object.prototype.hasOwnProperty.call(config, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(config, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(config, 'prototype'), false);
assert.equal(config.nested.safe, 'ok');
assert.equal(Object.prototype.hasOwnProperty.call(config.nested, 'prototype'), false);
assert.equal('pollutedNestedEnhancerConfig' in config.nested, false);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'practice page enhancer config guard tests passed'
}, null, 2));
