#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Math,
    Date,
    JSON,
    window: {
        location: { protocol: 'http:', origin: 'http://localhost:3000' },
        crypto: {
            randomUUID: () => 'test-uuid'
        },
        document: {
            addEventListener() {},
            removeEventListener() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() { return { style: {}, dataset: {}, setAttribute() {}, appendChild() {} }; }
        },
        CSS: {
            escape(value) {
                return String(value);
            }
        }
    }
};
sandbox.globalThis = sandbox.window;
sandbox.document = sandbox.window.document;
sandbox.CSS = sandbox.window.CSS;

const context = vm.createContext(sandbox);
const source = fs.readFileSync(path.join(repoRoot, 'js/app/examSessionMixin.js'), 'utf8');
vm.runInContext(source, context, { filename: 'js/app/examSessionMixin.js' });

const mixin = sandbox.window.ExamSystemAppMixins?.examSession;
assert(mixin && typeof mixin._cloneReviewData === 'function', 'examSession mixin must expose _cloneReviewData');

const shared = { answer: 'A' };
const circular = { label: 'loop' };
circular.self = circular;
const raw = {
    safe: 'ok',
    veryLong: 'x'.repeat(20050),
    big: 10n,
    sharedA: shared,
    sharedB: shared,
    circular,
    list: Array.from({ length: 2005 }, (_, index) => index)
};
Object.defineProperty(raw, '__proto__', { value: { polluted: true }, enumerable: true, configurable: true });
raw.constructor = { unsafe: true };
raw.prototype = { unsafe: true };

const cloned = mixin._cloneReviewData(raw);

assert.strictEqual(cloned.safe, 'ok');
assert.strictEqual(cloned.big, '10');
assert.strictEqual(cloned.circular.self, '[Circular]');
assert.strictEqual(cloned.sharedA.answer, 'A');
assert.strictEqual(cloned.sharedB.answer, 'A');
assert.notStrictEqual(cloned.sharedA, shared, 'shared objects must be cloned before replay');
assert.notStrictEqual(cloned.sharedB, shared, 'shared objects must be cloned before replay');
assert(!Object.prototype.hasOwnProperty.call(cloned, '__proto__'), 'unsafe __proto__ key must be stripped');
assert(!Object.prototype.hasOwnProperty.call(cloned, 'constructor'), 'unsafe constructor key must be stripped');
assert(!Object.prototype.hasOwnProperty.call(cloned, 'prototype'), 'unsafe prototype key must be stripped');
assert.strictEqual(cloned.veryLong.length, 20003, 'long strings must be capped with an ellipsis');
assert.strictEqual(cloned.list.length, 2001, 'long arrays must be capped with a truncation marker');
assert.strictEqual(cloned.list[2000], '[Truncated 5 items]');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'exam session replay clone guard passed'
}, null, 2));
