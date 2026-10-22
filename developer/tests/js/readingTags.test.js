#!/usr/bin/env node
import assert from 'node:assert'
import { QUESTION_KIND_LABELS, questionKindTags } from '../../../apps/writing-vue/src/modules/practice-reading/readingTags.js'

function testLabelsCoverKnownKinds() {
  assert.deepStrictEqual(QUESTION_KIND_LABELS, {
    single_choice: '单选',
    multi_choice: '多选',
    judgement: '判断',
    completion: '填空',
    heading_match: '段落大意',
    paragraph_match: '段落匹配',
    matching: '配对'
  })
}

function testMissingKindsYieldEmptyList() {
  assert.deepStrictEqual(questionKindTags({}), [])
  assert.deepStrictEqual(questionKindTags({ questionKinds: null }), [])
  assert.deepStrictEqual(questionKindTags(null), [])
  assert.deepStrictEqual(questionKindTags({ questionKinds: [] }), [])
}

function testTagsFollowCanonicalOrderAndDropUnknown() {
  const tags = questionKindTags({ questionKinds: ['matching', 'bogus', 'single_choice', 'single_choice'] })
  assert.deepStrictEqual(tags, [
    { key: 'single_choice', label: '单选' },
    { key: 'matching', label: '配对' }
  ])
}

function testEveryKnownKeyMapsToLabel() {
  const all = Object.keys(QUESTION_KIND_LABELS)
  const tags = questionKindTags({ questionKinds: all.slice().reverse() })
  assert.deepStrictEqual(tags.map((tag) => tag.key), all)
  assert.ok(tags.every((tag) => tag.label === QUESTION_KIND_LABELS[tag.key]))
}

testLabelsCoverKnownKinds()
testMissingKindsYieldEmptyList()
testTagsFollowCanonicalOrderAndDropUnknown()
testEveryKnownKeyMapsToLabel()
console.log('readingTags.test.js passed')
