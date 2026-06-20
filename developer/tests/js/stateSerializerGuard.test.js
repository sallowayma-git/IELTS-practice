#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

const StateSerializer = require(path.join(repoRoot, 'js/utils/stateSerializer.js'));

function assertNoUnsafeKeys(value) {
    if (!value || typeof value !== 'object') {
        return;
    }
    assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'prototype'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'constructor'), false);
    if (Array.isArray(value)) {
        value.forEach(assertNoUnsafeKeys);
        return;
    }
    for (const item of Object.values(value)) {
        assertNoUnsafeKeys(item);
    }
}

{
    const polluted = JSON.parse(`{
      "safe": 1,
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "nested": {
        "ok": 2,
        "prototype": { "polluted": true }
      }
    }`);

    const restored = StateSerializer.deserialize(polluted);

    assert.deepEqual(restored, { safe: 1, nested: { ok: 2 } });
    assert.equal(Object.prototype.polluted, undefined);
    assertNoUnsafeKeys(restored);
}

{
    const polluted = JSON.parse(`{
      "safe": 1,
      "__proto__": { "polluted": true },
      "nested": {
        "constructor": { "prototype": { "polluted": true } },
        "ok": 2
      }
    }`);

    const serialized = StateSerializer.serialize(polluted);

    assert.deepEqual(serialized, { safe: 1, nested: { ok: 2 } });
    assert.equal(Object.prototype.polluted, undefined);
    assertNoUnsafeKeys(serialized);
}

{
    const wideObject = Object.fromEntries(
        Array.from({ length: 700 }, (_, index) => [`k${index}`, index])
    );
    const wideArray = Array.from({ length: 6000 }, (_, index) => index);
    const wideSet = new Set(Array.from({ length: 6000 }, (_, index) => `s${index}`));
    const wideMap = new Map(Array.from({ length: 6000 }, (_, index) => [`m${index}`, index]));

    assert.equal(Object.keys(StateSerializer.deserialize(wideObject)).length, 500);
    assert.equal(StateSerializer.deserialize(wideArray).length, 5000);
    assert.equal(StateSerializer.serialize(wideSet).__value.length, 5000);
    assert.equal(StateSerializer.serialize(wideMap).__value.length, 5000);
    assert.equal(StateSerializer.deserialize(StateSerializer.serialize(wideSet)).size, 5000);
    assert.equal(StateSerializer.deserialize(StateSerializer.serialize(wideMap)).size, 5000);
}

{
    const cyclic = { name: 'cycle' };
    cyclic.self = cyclic;

    const serialized = StateSerializer.serialize(cyclic);

    assert.deepEqual(serialized, { name: 'cycle', self: null });
}

{
    const shared = { value: 42 };
    const serialized = StateSerializer.serialize({ first: shared, second: shared });

    assert.deepEqual(serialized, { first: { value: 42 }, second: { value: 42 } });
}

{
    let deep = { leaf: true };
    for (let index = 0; index < 40; index += 1) {
        deep = { child: deep };
    }

    assert.throws(
        () => StateSerializer.serialize(deep),
        /too deeply nested/
    );
}

{
    const original = {
        tags: new Set(['a', 'b']),
        lookup: new Map([
            ['score', 7],
            ['label', 'practice']
        ]),
        createdAt: new Date('2026-01-02T03:04:05.000Z')
    };

    const restored = StateSerializer.deserialize(StateSerializer.serialize(original));

    assert.deepEqual(Array.from(restored.tags), ['a', 'b']);
    assert.deepEqual(Array.from(restored.lookup.entries()), [['score', 7], ['label', 'practice']]);
    assert.equal(restored.createdAt.toISOString(), '2026-01-02T03:04:05.000Z');
}

{
    const invalidDate = StateSerializer.deserialize({ __type: 'Date', __value: null });
    assert.equal(invalidDate, null);
}
