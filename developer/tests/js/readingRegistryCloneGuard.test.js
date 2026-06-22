#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadRegistry(relativePath, registryName) {
    const context = vm.createContext({
        console,
        Date,
        JSON,
        Map,
        Number,
        Object,
        Set,
        String,
        WeakSet,
        globalThis: {}
    });
    context.globalThis = context;
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
    return {
        registry: context[registryName],
        source
    };
}

function makePayload() {
    const shared = { label: 'shared' };
    const payload = {
        title: 'Reading Registry',
        big: 10n,
        badNumber: Number.POSITIVE_INFINITY,
        sharedA: shared,
        sharedB: shared,
        answers: Array.from({ length: 5002 }, (_, index) => ({ id: index })),
        nested: {
            ok: true
        }
    };
    payload.self = payload;
    payload.nested.parent = payload;
    Object.defineProperty(payload, '__proto__', {
        value: { pollutedReadingRegistry: true },
        enumerable: true,
        configurable: true
    });
    payload.constructor = { unsafe: true };
    payload.nested.prototype = { unsafe: true };
    return payload;
}

function assertRegistry(relativePath, registryName) {
    const { registry, source } = loadRegistry(relativePath, registryName);
    assert(registry && typeof registry.register === 'function', `${registryName} must be registered`);

    registry.register('payload-1', makePayload());
    const first = registry.get('payload-1');
    assert.equal(first.title, 'Reading Registry');
    assert.equal(first.big, '10');
    assert.equal(first.badNumber, null);
    assert.equal(first.self, '[Circular]');
    assert.equal(first.nested.parent, '[Circular]');
    assert.equal(first.sharedA.label, 'shared');
    assert.equal(first.sharedB.label, 'shared');
    assert.notStrictEqual(first.sharedA, first.sharedB, 'shared non-circular objects should be cloned independently');
    assert.equal(first.answers.length, 5001);
    assert.equal(first.answers[5000], '[Truncated 2 items]');
    assert.equal(Object.prototype.hasOwnProperty.call(first, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(first, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(first.nested, 'prototype'), false);
    assert.equal(Object.prototype.pollutedReadingRegistry, undefined);

    first.title = 'mutated';
    first.nested.ok = false;
    const second = registry.get('payload-1');
    assert.equal(second.title, 'Reading Registry');
    assert.equal(second.nested.ok, true);

    assert(source.includes('function cloneRegistryValue(value, depth = 0'));
    assert(source.includes("READING_REGISTRY_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])"));
    assert(!source.includes('JSON.parse(JSON.stringify(value))'));
}

assertRegistry('js/runtime/readingExamRegistry.js', '__READING_EXAM_DATA__');
assertRegistry('js/runtime/readingExplanationRegistry.js', '__READING_EXPLANATION_DATA__');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'reading registry clone guard passed'
}, null, 2));
