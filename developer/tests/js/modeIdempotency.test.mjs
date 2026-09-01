import assert from 'node:assert/strict'
import { endlessSubmitIdempotencyKey } from '../../../apps/writing-vue/src/api/mode-idempotency.js'

const first = endlessSubmitIdempotencyKey('endless-1', 'asset-a')
assert.equal(first, 'endless-submit:endless-1:asset-a')
assert.equal(endlessSubmitIdempotencyKey('endless-1', 'asset-a'), first)
assert.notEqual(endlessSubmitIdempotencyKey('endless-1', 'asset-b'), first)
assert.throws(() => endlessSubmitIdempotencyKey('', 'asset-a'), /required/)
assert.throws(() => endlessSubmitIdempotencyKey('endless-1', ''), /required/)

console.log('mode idempotency: ok')
