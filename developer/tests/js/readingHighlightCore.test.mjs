import assert from 'node:assert/strict'
import {
  collectHighlightAnnotationIds,
  findSequentialTextMatch,
  normalizeComparableText,
  normalizeDictionaryLookupResult,
  normalizeHighlightSnapshot,
  resolveSupersededAnnotationCleanup
} from '../../../apps/writing-vue/src/modules/practice-reading/readingHighlightCore.js'

assert.equal(normalizeComparableText('  a   b\n'), 'a b')

const snapshot = normalizeHighlightSnapshot([
  {
    id: 'ann-1',
    scope: 'passage',
    text: '  hello  world ',
    kind: 'highlight',
    questionId: 'q1',
    startOffset: 10,
    endOffset: 21,
    before: 'xx',
    after: 'yy',
    occurrence: 2,
    mismatch: 'offset-shift'
  },
  { text: '' },
  null
], {
  normalizeQuestionId: (value) => String(value || '').trim().toLowerCase()
})

assert.equal(snapshot.length, 1)
assert.deepEqual(snapshot[0], {
  id: 'ann-1',
  scope: 'passage',
  text: 'hello world',
  kind: 'highlight',
  questionId: 'q1',
  startOffset: 10,
  endOffset: 21,
  before: 'xx',
  after: 'yy',
  occurrence: 2,
  createdAt: snapshot[0].createdAt,
  mismatch: 'offset-shift'
})
assert.ok(snapshot[0].createdAt)

const ids = collectHighlightAnnotationIds([
  { id: 'a' },
  { annotationId: 'b' },
  { node: { dataset: { annotationId: 'c' } } },
  {}
])
assert.deepEqual([...ids].sort(), ['a', 'b', 'c'])

const firstMatch = findSequentialTextMatch('alpha beta alpha beta', 'alpha', 0)
const secondMatch = findSequentialTextMatch('alpha beta alpha beta', 'alpha', firstMatch.nextCursor)
assert.deepEqual(firstMatch, { start: 0, end: 5, nextCursor: 5 })
assert.deepEqual(secondMatch, { start: 11, end: 16, nextCursor: 16 })
assert.equal(findSequentialTextMatch('alpha', 'missing', 0), null)

assert.equal(resolveSupersededAnnotationCleanup({
  previousId: null,
  persistedId: 'new-orphan',
  generationCurrent: false,
  nodeConnected: false
}), 'new-orphan')
assert.equal(resolveSupersededAnnotationCleanup({
  previousId: 'existing',
  persistedId: 'existing',
  generationCurrent: false,
  nodeConnected: false
}), null)
assert.equal(resolveSupersededAnnotationCleanup({
  previousId: null,
  persistedId: 'current',
  generationCurrent: true,
  nodeConnected: true
}), null)

const missing = normalizeDictionaryLookupResult(null, 'alpha')
assert.equal(missing.found, false)
assert.equal(missing.term, 'alpha')
assert.equal(missing.sourceLabel, '本地词典')

const found = normalizeDictionaryLookupResult({
  found: true,
  term: 'beta',
  zh: '贝塔',
  en: 'definition',
  phonetic: 'ˈbiːtə',
  pos: 'n.',
  source: 'ecdict',
  license: 'MIT',
  parts: [
    { term: 'beta', zh: '贝塔', en: 'definition', phonetic: 'ˈbiːtə', pos: 'n.' }
  ]
}, 'fallback')
assert.equal(found.found, true)
assert.equal(found.term, 'beta')
assert.equal(found.parts.length, 1)
assert.equal(found.parts[0].term, 'beta')
assert.ok(found.sourceLine.includes('ECDICT'))

console.log('reading highlight core: ok')
