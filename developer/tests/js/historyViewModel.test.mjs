import assert from 'node:assert/strict'
import { normalizeHistoryViewModel } from '../../../apps/writing-vue/src/api/history-view-model.js'
import {
  ACTIVITIES,
  buildTrendSeries,
  formatDayHeading,
  formatDuration,
  groupByDay,
  recordDetail,
  recordTimeLine,
  scoreTone,
  sortNewestFirst,
  scoreToQuery,
  summarizeRecords,
  summaryStats,
  toRecord,
  validateScoreRange
} from '../../../apps/writing-vue/src/modules/history/records.js'
import {
  emptyView,
  hasFilters,
  parseView,
  sameView,
  serializeView,
  statisticsRange,
  switchActivity,
  toListQuery,
  validateView,
  viewScopeKey
} from '../../../apps/writing-vue/src/modules/history/view-state.js'
import { buildHistoryMarkdown } from '../../../apps/writing-vue/src/modules/history/markdown.js'

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

// ── Unified record shape: every activity goes through the same adapter table ──
const readingRecord = toRecord(reading)
assert.deepEqual(Object.keys(readingRecord).sort(), [
  'activity', 'detailRoute', 'durationSec', 'id', 'kind', 'meta', 'occurredAt', 'raw', 'score', 'subtitle', 'title'
])
assert.equal(readingRecord.subtitle, '阅读 · 套题')
assert.equal(readingRecord.durationSec, 305)
assert.deepEqual(readingRecord.score, { value: 0.8, scale: 'ratio', label: '正确率', display: '80%' })
assert.deepEqual(readingRecord.detailRoute, {
  name: 'PracticeReadingReview',
  params: { assetId: 'p2-urban', sessionId: 'attempt-reading-1' },
  query: { suiteSessionId: 'suite-7' }
})

const writingRecord = toRecord(writingTask1)
assert.equal(writingRecord.kind, 'task1')
assert.equal(writingRecord.subtitle, 'Task 1')
assert.deepEqual(writingRecord.detailRoute, { name: 'Result', params: { sessionId: 'attempt-writing-task1' } })
assert.equal(toRecord(writingUnknown).subtitle, '未标注')
assert.equal(toRecord(writingUnknown).kind, 'unlabeled')

// A reading record without review identifiers has no route (the page reports it).
assert.equal(toRecord(normalizeHistoryViewModel({ id: 'orphan', activity: 'reading' })).detailRoute, null)

// Listening needs no adapter code: the view model passes the activity through,
// and the generic fallback keeps the row readable until an adapter exists.
const listening = normalizeHistoryViewModel({
  id: 'attempt-listening-1',
  activity: 'listening',
  title: 'Section 1',
  scoreValue: 31,
  scoreScale: 'raw40',
  scoreDisplay: '31/40',
  submittedAt: '2026-07-16T08:00:00.000Z'
})
assert.equal(listening.activity, 'listening')
const listeningRecord = toRecord(listening)
assert.equal(listeningRecord.subtitle, '听力')
assert.equal(listeningRecord.detailRoute, null)
assert.equal(listeningRecord.score.display, '31/40')
assert.equal(ACTIVITIES.listening.trend, null)

// Trend: grouped by the activity's own scale, oldest first, unscored records skipped.
const series = buildTrendSeries([readingRecord, writingRecord, toRecord(legacyInput), listeningRecord])
assert.deepEqual(series.map((item) => item.key), ['reading', 'writing'], 'series follow the ACTIVITIES order')
assert.equal(series[0].title, '阅读正确率')
const readingSeries = series.find((item) => item.key === 'reading')
assert.deepEqual(readingSeries.data.map((point) => point.score), [100, 80])
assert.equal(readingSeries.maxScore, 100)
assert.equal(series.find((item) => item.key === 'writing').data[0].score, 6.5)

// The point limit is per series: a busy activity must not starve the other one.
const crowded = [
  ...Array.from({ length: 20 }, (_, index) => ({
    ...readingRecord, id: `r${index}`, occurredAt: `2026-07-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`
  })),
  writingRecord,
  { ...writingRecord, id: 'w2', occurredAt: '2026-07-16T09:00:00.000Z' }
]
const crowdedSeries = buildTrendSeries(crowded)
assert.equal(crowdedSeries[0].data.length, 15)
assert.equal(crowdedSeries[0].total, 20)
assert.equal(crowdedSeries[1].data.length, 2)

// Score filter: validated and converted per activity scale.
assert.equal(validateScoreRange(ACTIVITIES.reading.score, 50, 120), '阅读正确率必须在 0–100% 之间')
assert.equal(validateScoreRange(ACTIVITIES.writing.score, 5, 7.5), '')
assert.equal(validateScoreRange(null, 5, null), '请先选择阅读或写作，再按分数筛选')
assert.equal(scoreToQuery(ACTIVITIES.reading.score, 80), 0.8)
assert.equal(scoreToQuery(ACTIVITIES.writing.score, 6.5), 6.5)
assert.equal(scoreToQuery(ACTIVITIES.writing.score, null), null)

// Markdown export: one document for any mix of activities.
const markdown = buildHistoryMarkdown([readingRecord, writingRecord], { scopeLabel: '全部', now: new Date('2026-07-16T00:00:00Z') })
assert.match(markdown, /^# 练习记录（全部）/)
assert.match(markdown, /## 1\. Urban transport/)
assert.match(markdown, /- 正确率: 80%/)
assert.match(markdown, /- Session: attempt-reading-1/)
assert.match(markdown, /- 类型: Task 1/)
assert.equal(formatDuration(305), '5m 5s')
assert.equal(formatDuration(0), '—')

// ── Summary sentence: wording comes from the ACTIVITIES table ──
const band = (id, value, occurredAt) => ({
  ...writingRecord, id, occurredAt, score: { ...writingRecord.score, value, display: value.toFixed(1) }
})
const ratio = (id, value, occurredAt) => ({
  ...readingRecord, id, occurredAt, score: { ...readingRecord.score, value }
})
const mixed = [
  ratio('a', 0.8, '2026-07-15T08:00:00.000Z'),
  ratio('b', 0.72, '2026-07-14T08:00:00.000Z'),
  band('c', 6.5, '2026-07-14T07:00:00.000Z'),
  band('d', 6.0, '2026-07-13T07:00:00.000Z')
]
assert.equal(summarizeRecords(mixed, '全部记录'), '全部记录：阅读 2 篇，平均正确率 76%；写作 2 篇，平均 Band 6.3。')
assert.equal(
  summarizeRecords(mixed.filter((record) => record.activity === 'reading'), '当前筛选'),
  '当前筛选：阅读 2 篇，平均正确率 76%。',
  'a single-activity scope shows only that clause'
)
assert.equal(summarizeRecords([], '全部记录'), '', 'no records, no sentence')
assert.equal(
  summarizeRecords([listeningRecord], '全部记录'),
  '全部记录：听力 1 套。',
  'listening is worded by its own table entry; unscored activities count only'
)
assert.equal(
  summarizeRecords([{ ...readingRecord, score: { ...readingRecord.score, value: null } }], '全部记录'),
  '全部记录：阅读 1 篇。',
  'records without a score are counted but not averaged'
)

// ── Day grouping (local calendar days, order preserved) ──
const now = new Date(2026, 9, 5, 12, 0) // Mon 5 Oct 2026, local
const local = (month, day, hour) => new Date(2026, month - 1, day, hour, 15).toISOString()
const dated = [
  { ...readingRecord, id: 'x1', occurredAt: local(10, 5, 9) },
  { ...readingRecord, id: 'x2', occurredAt: local(10, 5, 8) },
  { ...readingRecord, id: 'x3', occurredAt: local(10, 4, 23) },
  { ...readingRecord, id: 'x4', occurredAt: local(10, 3, 7) },
  { ...readingRecord, id: 'x5', occurredAt: '' }
]
const days = groupByDay(dated, now)
assert.deepEqual(days.map((day) => day.label), [
  '今天 · 10月5日 星期一', '昨天 · 10月4日 星期日', '10月3日 星期六', '时间未知'
])
assert.deepEqual(days.map((day) => day.records.map((record) => record.id)), [['x1', 'x2'], ['x3'], ['x4'], ['x5']])
// Whatever order records arrive in (activities interleaved, oldest first, mixed),
// the list is newest first across all activities before it is grouped.
const shuffled = [
  { ...writingRecord, id: 'w-old', occurredAt: local(10, 1, 8) },
  { ...readingRecord, id: 'r-new', occurredAt: local(10, 5, 9) },
  { ...writingRecord, id: 'w-mid', occurredAt: local(10, 3, 12) },
  { ...readingRecord, id: 'r-unknown', occurredAt: '' },
  { ...readingRecord, id: 'r-mid', occurredAt: local(10, 3, 7) },
  { ...writingRecord, id: 'w-new', occurredAt: local(10, 5, 11) }
]
assert.deepEqual(sortNewestFirst(shuffled).map((record) => record.id), ['w-new', 'r-new', 'w-mid', 'r-mid', 'w-old', 'r-unknown'])
assert.deepEqual(shuffled.map((record) => record.id)[0], 'w-old', 'sorting never mutates the input')
assert.deepEqual(
  groupByDay(shuffled, now).map((day) => day.records.map((record) => record.id)),
  [['w-new', 'r-new'], ['w-mid', 'r-mid'], ['w-old'], ['r-unknown']]
)
assert.equal(formatDayHeading(new Date(2025, 11, 3), now), '2025年12月3日 星期三')
assert.equal(recordTimeLine({ ...dated[0], occurredAt: local(10, 5, 9), durationSec: 305 }), '09:15 · 用时 5m 5s')
assert.equal(recordTimeLine({ ...writingRecord, occurredAt: local(10, 5, 9), durationSec: 0 }), '09:15')
assert.equal(recordTimeLine({ ...dated[0], occurredAt: local(10, 5, 9), durationSec: 60 }), '09:15 · 用时 1m 0s')
assert.equal(recordDetail({ ...dated[0], subtitle: '阅读 · 套题', activity: 'reading' }), '套题')
assert.equal(recordDetail({ ...dated[0], subtitle: '阅读', activity: 'reading' }), '')
assert.equal(recordDetail(writingRecord), 'Task 1')
assert.deepEqual(
  summaryStats(mixed),
  [
    { activity: 'reading', label: '阅读 2 篇', detail: '平均正确率 76%' },
    { activity: 'writing', label: '写作 2 篇', detail: '平均 Band 6.3' }
  ]
)
assert.deepEqual(summaryStats([]), [], 'no records, no chips')
assert.deepEqual(
  summaryStats([listeningRecord]),
  [{ activity: 'listening', label: '听力 1 套', detail: '' }],
  'an activity without a metric has a count chip only'
)
assert.equal(scoreTone(readingRecord), 'success', 'reading 92% is a success tone')
assert.equal(scoreTone({ ...readingRecord, score: { ...readingRecord.score, value: 0.6 } }), 'warning')
assert.equal(scoreTone({ ...readingRecord, score: { ...readingRecord.score, value: 0.3 } }), 'danger')
assert.equal(scoreTone({ ...readingRecord, score: { ...readingRecord.score, value: null } }), '', 'unscored has no tone')
assert.equal(scoreTone({ ...writingRecord, score: { ...writingRecord.score, value: 6.5 } }), 'success')
assert.equal(scoreTone({ ...writingRecord, score: { ...writingRecord.score, value: 5.5 } }), 'warning')
assert.equal(scoreTone({ ...writingRecord, score: { ...writingRecord.score, value: 4 } }), 'danger')

// ── View state lives in the URL query ──
assert.deepEqual(serializeView(emptyView()), {}, 'the plain page has a plain URL')
const view = parseView({
  activity: 'writing', kind: 'task1', q: 'urban ', from: '2026-08-01', to: 'nope', min: '6', max: '7.5', page: '3'
})
assert.deepEqual(view, {
  activity: 'writing', kind: 'task1', search: 'urban ', startDate: '2026-08-01', endDate: '',
  minScore: 6, maxScore: 7.5, page: 3
})
assert.ok(sameView(parseView(serializeView(view)), view), 'query round-trips')
// One rule keeps views coherent: foreign kinds and scores on the mixed tab are dropped.
assert.equal(parseView({ activity: 'reading', kind: 'task1' }).kind, '')
assert.equal(parseView({ kind: 'task1', min: '5' }).minScore, null)
assert.equal(parseView({ activity: 'bogus', page: '-2' }).page, 1)
const switched = switchActivity(view, 'reading')
assert.deepEqual([switched.activity, switched.kind, switched.minScore, switched.page, switched.startDate], ['reading', '', null, 1, '2026-08-01'])
assert.equal(viewScopeKey(view), viewScopeKey({ ...view, page: 9 }), 'the page is not part of the scope')
assert.notEqual(viewScopeKey(view), viewScopeKey({ ...view, search: 'x' }))
assert.equal(hasFilters(emptyView()), false)
assert.equal(hasFilters({ ...emptyView(), search: '  ' }), false)
assert.equal(hasFilters({ ...emptyView(), search: 'a' }), true)
assert.equal(statisticsRange(view), 'task1')
assert.equal(statisticsRange(emptyView()), 'all')
assert.equal(validateView({ ...emptyView(), startDate: '2026-09-01', endDate: '2026-08-01' }), '开始日期不能晚于结束日期')
assert.equal(validateView(parseView({ activity: 'reading', min: '120' })), '阅读正确率必须在 0–100% 之间')
assert.deepEqual(toListQuery(parseView({ activity: 'reading', q: ' coral ', min: '80' }), { limit: 20, offset: 20 }), {
  activity: 'reading', limit: 20, offset: 20, search: 'coral', startDate: '', endDate: '',
  minScore: 0.8, maxScore: null, scoreScale: 'ratio', taskType: null
})

console.log('history view model: ok')
