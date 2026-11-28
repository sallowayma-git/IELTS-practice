import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadVocabulary } from '../../../apps/writing-vue/src/modules/vocabulary/loadVocabulary.js'

test('review queue includes words beyond the old 500-word boundary', async () => {
  const words = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) }))
  const offsets = []
  const result = await loadVocabulary(async (limit, offset) => {
    offsets.push(offset)
    return words.slice(offset, offset + limit)
  })
  assert.deepEqual(result, words)
  assert.deepEqual(offsets, [0, 500, 1000])
})

test('repeated full pages fail instead of an endless network loop', async () => {
  await assert.rejects(loadVocabulary(async () => [{ id: 'a' }, { id: 'b' }], 2), /did not advance/)
})

test('page failure does not publish a partial review list', async () => {
  await assert.rejects(loadVocabulary(async (_limit, offset) => {
    if (offset) throw new Error('offline')
    return [{ id: 'a' }]
  }, 1), /offline/)
})
