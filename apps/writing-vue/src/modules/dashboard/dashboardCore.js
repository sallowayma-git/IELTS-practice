/**
 * Overview dashboard: pure functions over history records (`toRecord` output).
 * No Vue, no I/O. Reading score.value is a 0–1 ratio; writing score.value is a band.
 */
import { ACTIVITIES, buildTrendSeries, sortNewestFirst } from '../history/records.js'

const DAY_MS = 86_400_000
const AVERAGE_WINDOW = 10
const RECENT_LIMIT = 6
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** Local calendar day as an integer, so day arithmetic ignores clock time and DST. */
export function dayIndex(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS)
}

/** Attempts (any activity) whose local day is today or one of the six days before. */
export function weekCount(records, now = new Date()) {
  const today = dayIndex(now)
  return records.filter((record) => {
    const day = dayIndex(record.occurredAt)
    return day !== null && day > today - 7 && day <= today
  }).length
}

const scoredOf = (records, activity) => sortNewestFirst(records)
  .filter((record) => record.activity === activity && Number.isFinite(record.score?.value))

const mean = (records) => records.reduce((sum, record) => sum + record.score.value, 0) / records.length

/**
 * Mean score of the last `n` scored attempts of one activity, and its change
 * against the `n` attempts before them. value/delta are null when there is
 * nothing to average / nothing to compare with. Delta is in score units.
 */
export function recentAverage(records, activity, n = AVERAGE_WINDOW) {
  const scored = scoredOf(records, activity)
  if (scored.length === 0) return { value: null, delta: null, count: 0 }
  const latest = scored.slice(0, n)
  const previous = scored.slice(n, 2 * n)
  const value = mean(latest)
  return {
    value,
    delta: previous.length > 0 ? value - mean(previous) : null,
    count: latest.length
  }
}

/** Consecutive local days with at least one attempt, ending today or yesterday. */
export function streakDays(records, now = new Date()) {
  const days = new Set(records.map((record) => dayIndex(record.occurredAt)).filter((day) => day !== null))
  const today = dayIndex(now)
  let cursor = days.has(today) ? today : today - 1
  let streak = 0
  while (days.has(cursor)) {
    streak += 1
    cursor -= 1
  }
  return streak
}

/** The `n` newest records, newest first, whatever activity they belong to. */
export function recentRecords(records, n = RECENT_LIMIT) {
  return sortNewestFirst(records).slice(0, n)
}

/** "刚刚", "12 分钟前", "3 小时前", "昨天", "4 天前", "10月3日". '' when the time is unknown. */
export function relativeTime(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`
  const days = dayIndex(now) - dayIndex(date)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** Page kicker for the overview: "10月19日 · 周日". */
export function formatTodayLabel(now = new Date()) {
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`
}

/** Average for display: reading as a whole percent, writing as one decimal Band. */
export function formatAverage(activity, value) {
  if (value === null || value === undefined) return '—'
  return activity === 'reading' ? `${Math.round(value * 100)}%` : value.toFixed(1)
}

/** Change against the previous window, with a tone for the colour class. */
export function formatDelta(activity, delta) {
  if (delta === null || delta === undefined) return { text: '', tone: '' }
  if (activity === 'reading') {
    const points = Math.round(delta * 100)
    if (points === 0) return { text: '持平', tone: 'flat' }
    return { text: `${points > 0 ? '+' : ''}${points}%`, tone: points > 0 ? 'up' : 'down' }
  }
  const band = Math.round(delta * 10) / 10
  if (band === 0) return { text: '持平', tone: 'flat' }
  return { text: `${band > 0 ? '+' : ''}${band.toFixed(1)}`, tone: band > 0 ? 'up' : 'down' }
}

/** Trend series key that a record belongs to ('' when it is not plotted). */
const trendKeyOf = (record) => ACTIVITIES[record.activity]?.trend?.key || ''

/** The series of the most recently attempted activity, else the first series. */
export function defaultTrendKey(trendSeries, records) {
  const keys = new Set(trendSeries.map((series) => series.key))
  const newest = sortNewestFirst(records).find((record) => keys.has(trendKeyOf(record)))
  return newest ? trendKeyOf(newest) : (trendSeries[0]?.key || '')
}

/** Everything the overview renders, computed in one pass from one record list. */
export function buildDashboard(records, now = new Date()) {
  const count = (activity) => records.filter((record) => record.activity === activity)
  const latest = recentRecords(records, 1)[0] || null
  const trendSeries = buildTrendSeries(records)
  return {
    week: {
      total: weekCount(records, now),
      reading: weekCount(count('reading'), now),
      writing: weekCount(count('writing'), now)
    },
    reading: recentAverage(records, 'reading'),
    writing: recentAverage(records, 'writing'),
    streak: streakDays(records, now),
    lastLabel: latest ? relativeTime(latest.occurredAt, now) : '',
    recent: recentRecords(records).map((record) => ({ record, ago: relativeTime(record.occurredAt, now) })),
    trendSeries,
    defaultTrendKey: defaultTrendKey(trendSeries, records)
  }
}
