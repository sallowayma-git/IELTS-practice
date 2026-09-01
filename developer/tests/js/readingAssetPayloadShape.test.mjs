#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  createReadingAssetController,
  normalizeReadingAssetViewModel
} from '../../../apps/writing-vue/src/modules/practice-reading/readingAssetCore.js'

const canonical = {
  id: 'p1-demo',
  title: 'Demo',
  fingerprint: 'fp-1',
  payload: {
    examId: 'p1-demo',
    meta: { title: 'Demo' },
    questionOrder: ['q1']
  }
}

assert.deepEqual(normalizeReadingAssetViewModel(canonical), canonical)

const canonicalEnvelope = normalizeReadingAssetViewModel({
  asset: { id: 'p1-demo', title: 'Demo', fingerprint: 'fp-1' },
  payload: canonical.payload
})
assert.equal(canonicalEnvelope.id, 'p1-demo')
assert.deepEqual(canonicalEnvelope.payload.questionOrder, ['q1'])

const legacyDoubleWrapped = {
  id: 'p1-demo',
  payload: {
    asset: { id: 'p1-demo', title: 'Demo', fingerprint: 'fp-1' },
    payload: canonical.payload
  }
}
const normalized = normalizeReadingAssetViewModel(legacyDoubleWrapped)
assert.equal(normalized.id, 'p1-demo')
assert.equal(normalized.fingerprint, 'fp-1')
assert.deepEqual(normalized.payload.questionOrder, ['q1'])
assert.equal(normalized.payload.asset, undefined)

const controller = createReadingAssetController({
  async getAsset() {
    return legacyDoubleWrapped
  },
  async listAssets() {
    return []
  }
}, String)
await controller.loadReadingAsset('p1-demo')
assert.deepEqual(controller.state.asset.payload.meta, { title: 'Demo' })

console.log('reading asset payload shape: ok')
