import assert from 'node:assert/strict'
import { normalizeHistoryViewModel } from '../../../apps/writing-vue/src/api/history-view-model.js'
import {
  buildHistoryStats,
  buildPracticeTrendBars,
  sortReadingHistory
} from '../../../apps/writing-vue/src/modules/practice-reading/historyStats.js'

const reading = normalizeHistoryViewModel({
  id: 'attempt-reading-1',
  activity: 'reading',
  title: 'Urban transport',
  status: 'completed',
  mode: 'suite',
  submittedAt: '2026-07-15T08:00:00.000Z',
  durationMs: 305_000,
  scoreValue: 0.8,
  scoreScale: 'ratio',
  scoreLabel: 'Accuracy',
  scoreDisplay: '80%',
  assetId: 'p2-urban',
  sessionId: 'attempt-reading-1',
  suiteId: 'suite-7'
})

assert.deepEqual(reading, {
  id: 'attempt-reading-1',
  activity: 'reading',
  title: 'Urban transport',
  status: 'completed',
  mode: 'suite',
  submittedAt: '2026-07-15T08:00:00.000Z',
  durationMs: 305_000,
  duration: 305,
  scoreValue: 0.8,
  scoreScale: 'ratio',
  scoreLabel: 'Accuracy',
  scoreDisplay: '80%',
  assetId: 'p2-urban',
  sessionId: 'attempt-reading-1',
  suiteId: 'suite-7',
  metadata: {
    activity: 'reading',
    assetId: 'p2-urban',
    sessionId: 'attempt-reading-1',
    suiteSessionId: 'suite-7'
  },
  source: 'tauri',
  examId: 'p2-urban',
  accuracy: 0.8,
  taskType: 'reading'
})
assert.equal(Object.keys(reading).some((key) => key.includes('_')), false)

const legacyInput = normalizeHistoryViewModel({
  id: 'attempt-reading-2',
  activity: 'reading',
  submitted_at: '2026-07-14T08:00:00.000Z',
  duration_ms: 120_000,
  score_value: 1.4,
  score_scale: 'ratio',
  asset_id: 'p1-legacy',
  session_id: 'attempt-reading-2',
  suite_id: 'suite-legacy'
})
assert.equal(legacyInput.submittedAt, '2026-07-14T08:00:00.000Z')
assert.equal(legacyInput.duration, 120)
assert.equal(legacyInput.accuracy, 1)
assert.equal(legacyInput.assetId, 'p1-legacy')
assert.equal(legacyInput.metadata.suiteSessionId, 'suite-legacy')
assert.equal(Object.keys(legacyInput).some((key) => key.includes('_')), false)

const writingTask1 = normalizeHistoryViewModel({
  id: 'attempt-writing-task1',
  activity: 'writing',
  title: 'Describe the chart',
  status: 'completed',
  mode: 'bank',
  submittedAt: '2026-07-15T09:00:00.000Z',
  durationMs: 1_200_000,
  scoreValue: 6.5,
  scoreScale: 'band9',
  taskType: 'task_1'
})
assert.equal(writingTask1.taskType, 'task1')

const writingUnknown = normalizeHistoryViewModel({
  id: 'attempt-writing-legacy',
  activity: 'writing',
  title: 'Legacy essay',
  status: 'completed',
  mode: 'freeform',
  submittedAt: '2026-07-15T10:00:00.000Z',
  durationMs: 0,
  scoreValue: 6,
  scoreScale: 'band9'
})
assert.equal(writingUnknown.taskType, null)
assert.notEqual(writingUnknown.taskType, 'task2')
assert.equal(Object.keys(writingUnknown).some((key) => key.includes('_')), false)

const stats = buildHistoryStats([reading, legacyInput], {
  now: new Date('2026-07-15T12:00:00.000Z')
})
assert.deepEqual(stats, {
  totalPracticed: 2,
  averageAccuracy: 90,
  studyMinutes: 7,
  streakDays: 2
})
assert.deepEqual(sortReadingHistory([legacyInput, reading]).map((item) => item.id), [
  'attempt-reading-1',
  'attempt-reading-2'
])
assert.equal(buildPracticeTrendBars([reading], 'latest', [{ value: 'latest', limit: 1 }])[0].accuracy, 80)

console.log('history view model: ok')
