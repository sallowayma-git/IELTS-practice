import assert from 'node:assert/strict'
import {
  buildEndlessNextRoute,
  buildSuiteReviewNavigationTarget,
  canSnapshotReadingAnswers,
  findNextActiveSuitePassage,
  mapTauriSubmissionToUi,
  readingDraftOwnerMatches
} from '../../../apps/writing-vue/src/modules/practice-reading/readingModeFlowCore.js'

const ui = mapTauriSubmissionToUi({
  attempt: { id: 'att-1' },
  score: { accuracy: 0.8, correct: 8, total: 10, percentage: 80 },
  comparisons: [
    {
      questionId: 'q1',
      userAnswer: 'A',
      correctAnswer: 'A',
      isCorrect: true,
      weight: 1,
      matchMode: 'exact'
    }
  ]
}, {
  assetId: 'asset-1',
  answers: { q1: 'A' },
  markedQuestions: ['q2'],
  durationSec: 120.4,
  source: 'tauri-endless'
})

assert.equal(ui.sessionId, 'att-1')
assert.equal(ui.attemptId, 'att-1')
assert.equal(ui.assetId, 'asset-1')
assert.equal(ui.score, 0.8)
assert.equal(ui.duration, 120)
assert.equal(ui.source, 'tauri-endless')
assert.deepEqual(ui.scoreInfo, { correct: 8, totalQuestions: 10, percentage: 80 })
assert.deepEqual(ui.answerComparison.q1, {
  questionId: 'q1',
  userAnswer: 'A',
  correctAnswer: 'A',
  isCorrect: true,
  weight: 1,
  matchMode: 'exact'
})

const sequence = [
  { status: 'submitted', assetId: 'a1', sessionId: 's1' },
  { status: 'active', assetId: 'a2' },
  { status: 'pending', assetId: 'a3' }
]
assert.equal(findNextActiveSuitePassage(sequence, 'a1').assetId, 'a2')
assert.equal(findNextActiveSuitePassage(sequence, 'a2'), null)

const reviewTarget = buildSuiteReviewNavigationTarget({
  direction: 'next',
  currentIndex: 0,
  sequence,
  suiteSessionId: 'suite-1'
})
assert.equal(reviewTarget.name, 'PracticeReading')
assert.equal(reviewTarget.params.assetId, 'a2')
assert.equal(reviewTarget.query.suiteSessionId, 'suite-1')

const prevTarget = buildSuiteReviewNavigationTarget({
  direction: 'prev',
  currentIndex: 1,
  sequence,
  suiteSessionId: 'suite-1'
})
assert.equal(prevTarget.name, 'PracticeReadingReview')
assert.equal(prevTarget.params.sessionId, 's1')

const endlessRoute = buildEndlessNextRoute('next-asset', 'endless-1')
assert.deepEqual(endlessRoute, {
  name: 'PracticeReading',
  params: { assetId: 'next-asset' },
  query: { mode: 'endless', endlessSessionId: 'endless-1' }
})
assert.equal(buildEndlessNextRoute(''), null)

const snapshotBase = {
  isTauriRuntime: true,
  hasAsset: true,
  hasPayload: true,
  loading: false,
  submitting: false,
  leaving: false,
  readOnly: false,
  isEndlessMode: false
}
assert.equal(canSnapshotReadingAnswers(snapshotBase), true)
assert.equal(canSnapshotReadingAnswers({ ...snapshotBase, readOnly: true }), false)
assert.equal(canSnapshotReadingAnswers({ ...snapshotBase, isEndlessMode: true }), false)
assert.equal(canSnapshotReadingAnswers({ ...snapshotBase, leaving: true }), false)
assert.equal(canSnapshotReadingAnswers({ ...snapshotBase, isTauriRuntime: false }), false)

// Endless drafts persist the endless session id as their owner (suite_id).
// Reloading an endless passage must resume that draft instead of discarding it
// and letting the next autosave overwrite the saved answer map.
const endlessDraft = { id: 'att-e', suiteId: 'endless-1' }
assert.equal(readingDraftOwnerMatches(endlessDraft, { endlessSessionId: 'endless-1' }), true)
assert.equal(readingDraftOwnerMatches(endlessDraft, { endlessSessionId: 'endless-2' }), false)
assert.equal(readingDraftOwnerMatches(endlessDraft, {}), false)
assert.equal(readingDraftOwnerMatches({ id: 'att-s', suite_id: 'suite-1' }, { suiteId: 'suite-1' }), true)
assert.equal(readingDraftOwnerMatches({ id: 'att-s', suiteId: 'suite-1' }, {}), false)
assert.equal(readingDraftOwnerMatches({ id: 'att-1', suiteId: null }, {}), true)
assert.equal(readingDraftOwnerMatches({ id: 'att-1' }, { endlessSessionId: 'endless-1' }), false)

console.log('reading mode flow core: ok')
