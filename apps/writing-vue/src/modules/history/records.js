/**
 * History records — ONE shape for every activity.
 *
 *   {
 *     id, activity, kind, title, subtitle,
 *     occurredAt,                      // ISO string, '' when unknown
 *     durationSec,                     // whole seconds, 0 when unknown
 *     score: { value, scale, label, display },
 *     detailRoute,                     // vue-router location, or null
 *     meta,                            // [[label, value], …] for exports
 *     raw                              // the normalized view model, untouched
 *   }
 *
 * Input is the camelCase view model from `api/history-view-model.js`.
 * Activity-specific knowledge lives in exactly two tables below
 * (`ACTIVITIES`, `adapters`); consumers never branch on the activity name.
 * A new activity (listening) is one entry in each table — or, until its
 * adapter exists, the generic fallback keeps its rows readable and the
 * activity tab appears on its own as soon as records exist.
 */

const BAND_AXIS = { min: 0, max: 9, gridLines: [0, 1.5, 3, 4.5, 6, 7.5, 9], decimals: 1 }
const percent = (mean) => `${Math.round(mean * 100)}%`
const PERCENT_AXIS = { min: 0, max: 100, gridLines: [0, 20, 40, 60, 80, 100], decimals: 0 }

/**
 * Per-activity presentation data.
 *   scoreLabel — UI wording for the score (falls back to the backend label).
 *   score  — how the score filter behaves (null: no meaningful filter).
 *   analytics — has a rubric comparison table beyond the trend.
 *   kinds  — optional secondary filter (writing task type).
 *   trend  — how records are plotted (null: not plotted).
 *   summary — how the one-sentence summary counts and averages the activity.
 *   empty / start — the empty-state wording and where practice begins.
 */
export const ACTIVITIES = {
  reading: {
    label: '阅读',
    scoreLabel: '正确率',
    score: {
      scale: 'ratio',
      label: '阅读正确率范围（%）',
      unit: '正确率（%）',
      min: 0,
      max: 100,
      step: 1,
      divisor: 100,
      error: '阅读正确率必须在 0–100% 之间'
    },
    kinds: [],
    summary: { unit: '篇', metric: '平均正确率', format: percent },
    empty: '还没有阅读记录。完成一篇阅读后，成绩会出现在这里。',
    start: { label: '去做一篇阅读', to: '/' },
    trend: {
      key: 'reading',
      title: '阅读正确率',
      ...PERCENT_AXIS,
      prefix: '',
      suffix: '%',
      plot: (value) => value * 100
    }
  },
  writing: {
    label: '写作',
    scoreLabel: 'Band',
    score: {
      scale: 'band9',
      label: '写作 Band 分数范围',
      unit: 'Band 分数',
      min: 0,
      max: 9,
      step: 0.5,
      divisor: 1,
      error: '写作 Band 分数必须在 0–9 之间'
    },
    kinds: [
      { value: 'task1', label: 'Task 1' },
      { value: 'task2', label: 'Task 2' }
    ],
    // The four-criteria comparison table only exists for writing.
    analytics: true,
    summary: { unit: '篇', metric: '平均 Band', format: (mean) => mean.toFixed(1) },
    empty: '还没有写作记录。提交一篇作文并获得评分后，会出现在这里。',
    start: { label: '写一篇作文', to: '/writing' },
    trend: {
      key: 'writing',
      title: '写作 Band',
      ...BAND_AXIS,
      prefix: 'Band ',
      suffix: '',
      plot: (value) => value
    }
  },
  // Label only: no records, no adapter, no filter semantics yet.
  listening: {
    label: '听力',
    score: null,
    kinds: [],
    summary: { unit: '套', metric: null, format: null },
    empty: '还没有听力记录。',
    start: null,
    trend: null
  }
}

export function isKnownActivity(value) {
  return Object.prototype.hasOwnProperty.call(ACTIVITIES, value)
}

export function activityLabel(activity) {
  return ACTIVITIES[activity]?.label || String(activity || '')
}

function readingReviewRoute(item) {
  if (!item.assetId || !item.sessionId) return null
  const route = {
    name: 'PracticeReadingReview',
    params: { assetId: item.assetId, sessionId: item.sessionId }
  }
  if (item.suiteId) route.query = { suiteSessionId: item.suiteId }
  return route
}

const WRITING_KINDS = {
  task1: 'Task 1',
  task2: 'Task 2'
}

/** activity -> fields that differ per activity. Everything else is shared. */
const adapters = {
  reading: (item) => ({
    kind: 'reading',
    subtitle: item.suiteId ? '阅读 · 套题' : '阅读',
    detailRoute: readingReviewRoute(item),
    meta: [['Session', item.sessionId || ''], ['Asset', item.assetId || '']]
  }),
  writing: (item) => ({
    kind: item.taskType || 'unlabeled',
    subtitle: WRITING_KINDS[item.taskType] || '未标注',
    detailRoute: { name: 'Result', params: { sessionId: item.id } },
    meta: []
  })
}

const fallbackAdapter = (item) => ({
  kind: item.activity,
  subtitle: activityLabel(item.activity),
  detailRoute: null,
  meta: []
})

export function toRecord(item) {
  const adapt = adapters[item.activity] || fallbackAdapter
  return {
    id: item.id,
    activity: item.activity,
    title: item.title,
    occurredAt: item.submittedAt || '',
    durationSec: Number(item.duration) || 0,
    score: {
      value: item.scoreValue,
      scale: item.scoreScale,
      label: ACTIVITIES[item.activity]?.scoreLabel || item.scoreLabel,
      display: item.scoreDisplay
    },
    ...adapt(item),
    raw: item
  }
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total === 0) return '—'
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

export function formatOccurredAt(value) {
  return value ? String(value).replace('T', ' ').substring(0, 16) : ''
}

const pad2 = (value) => String(value).padStart(2, '0')
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function localDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

/** Local wall-clock time of a record, "09:30" ('' when unknown). */
export function formatClock(value) {
  const date = localDate(value)
  return date ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : ''
}

const dayKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
const dayNumber = (date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)

/** "今天 · 10月5日 星期一", "昨天 · …", "10月3日 星期五", "2025年12月3日 星期三". */
export function formatDayHeading(date, now = new Date()) {
  const month = `${date.getMonth() + 1}月${date.getDate()}日`
  const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`
  const plain = `${year}${month} ${WEEKDAYS[date.getDay()]}`
  const age = dayNumber(now) - dayNumber(date)
  if (age === 0) return `今天 · ${plain}`
  if (age === 1) return `昨天 · ${plain}`
  return plain
}

/**
 * Newest first by `occurredAt`, whatever order the records arrive in.
 * Stable (equal times keep their given order); unknown times go last.
 * `list_history` already pages one globally newest-first query across every
 * activity, so this never moves a record across a page boundary — it only
 * guarantees the order the day groups below rely on.
 */
export function sortNewestFirst(records) {
  const time = (record) => {
    const value = Date.parse(record.occurredAt || '')
    return Number.isNaN(value) ? -Infinity : value
  }
  return [...records].sort((left, right) => time(right) - time(left))
}

/**
 * Records grouped by local calendar day, newest day first. Records without a
 * usable time share one trailing group.
 */
export function groupByDay(records, now = new Date()) {
  const groups = new Map()
  for (const record of sortNewestFirst(records)) {
    const date = localDate(record.occurredAt)
    const key = date ? dayKey(date) : 'unknown'
    if (!groups.has(key)) {
      groups.set(key, { key, label: date ? formatDayHeading(date, now) : '时间未知', records: [] })
    }
    groups.get(key).records.push(record)
  }
  return [...groups.values()]
}

/** The part of `subtitle` that says more than the activity name ("套题", "Task 2"). */
export function recordDetail(record) {
  const label = activityLabel(record.activity)
  if (!record.subtitle.startsWith(label)) return record.subtitle
  return record.subtitle.slice(label.length).replace(/^\s*·\s*/, '')
}

/** "09:30 · 用时 12m 0s · Task 2" — empty parts are dropped. */
export function recordMetaLine(record) {
  const duration = record.durationSec > 0 ? `用时 ${formatDuration(record.durationSec)}` : ''
  return [formatClock(record.occurredAt), duration, recordDetail(record)].filter(Boolean).join(' · ')
}

function summaryClause(activity, entry) {
  const { unit, metric, format } = ACTIVITIES[activity].summary
  const count = `${activityLabel(activity)} ${entry.count} ${unit}`
  if (!metric || entry.scored === 0) return count
  return `${count}，${metric} ${format(entry.sum / entry.scored)}`
}

/**
 * One deterministic sentence about a set of records, e.g.
 * "全部记录：阅读 12 篇，平均正确率 76%；写作 3 篇，平均 Band 6.5。"
 * Clause wording comes from each activity's `summary`; '' when nothing counts.
 */
export function summarizeRecords(records, scopeLabel = '全部记录') {
  const totals = {}
  for (const record of records) {
    if (!ACTIVITIES[record.activity]?.summary) continue
    const entry = totals[record.activity] ??= { count: 0, sum: 0, scored: 0 }
    entry.count += 1
    const value = record.score.value
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue
    entry.sum += Number(value)
    entry.scored += 1
  }
  const clauses = Object.keys(ACTIVITIES)
    .filter((activity) => totals[activity])
    .map((activity) => summaryClause(activity, totals[activity]))
  return clauses.length > 0 ? `${scopeLabel}：${clauses.join('；')}。` : ''
}

/**
 * Trend series for the chart block: records are grouped by the activity's
 * own `trend` config, oldest first, the last `limit` points of each series.
 * Activities without a trend config, and records without a score, are not
 * plotted.
 */
export function buildTrendSeries(records, limit = 15) {
  const ordered = [...records].sort(
    (left, right) => Date.parse(left.occurredAt || '') - Date.parse(right.occurredAt || '')
  )
  const groups = new Map()
  for (const record of ordered) {
    const trend = ACTIVITIES[record.activity]?.trend
    if (!trend || record.score.value === null || record.score.value === undefined) continue
    if (!groups.has(trend.key)) groups.set(trend.key, { trend, points: [] })
    const date = new Date(record.occurredAt || 0)
    groups.get(trend.key).points.push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      score: trend.plot(Number(record.score.value))
    })
  }
  const order = Object.values(ACTIVITIES).map((config) => config.trend?.key)
  const byTable = [...groups.values()].sort((a, b) => order.indexOf(a.trend.key) - order.indexOf(b.trend.key))
  return byTable.map(({ trend, points }) => ({
    key: trend.key,
    title: trend.title,
    total: points.length,
    data: points.slice(-limit),
    minScore: trend.min,
    maxScore: trend.max,
    gridLines: trend.gridLines,
    scorePrefix: trend.prefix,
    scoreSuffix: trend.suffix,
    axisLabelDecimals: trend.decimals
  }))
}

/**
 * Score-filter validation against the active activity's score config.
 * Returns an error message, or '' when valid.
 */
export function validateScoreRange(config, min, max) {
  const hasValue = (value) => value !== null && value !== undefined && value !== ''
  const hasRange = hasValue(min) || hasValue(max)
  if (!hasRange) return ''
  if (!config) return '请先选择阅读或写作，再按分数筛选'
  if (hasValue(min) && hasValue(max) && Number(min) > Number(max)) return '最低分不能高于最高分'
  for (const value of [min, max]) {
    if (!hasValue(value)) continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < config.min || numeric > config.max) return config.error
  }
  return ''
}

/** Filter-form score value -> list_history query value (reading: % -> ratio). */
export function scoreToQuery(config, value) {
  if (!config || value === null || value === undefined || value === '') return null
  return Number(value) / config.divisor
}
