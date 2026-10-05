/**
 * The History page's view state — activity tab, filters, page — lives in the
 * URL query, so a deep link, a reload and "← 返回历史" all restore the same
 * view.  This module is the only place that turns the query into a view, a
 * view back into a query, and a view into a `list_history` request.
 *
 *   ?activity=writing&kind=task1&q=urban&from=2026-08-01&to=2026-08-31
 *   &min=6&max=7.5&page=2          (defaults are omitted)
 *
 * `normalizeView` is the single rule-keeper: a kind that does not belong to
 * the activity, or a score bound on an activity without a score filter, is
 * dropped there — no caller special-cases it.
 */
import { ACTIVITIES, isKnownActivity, scoreToQuery, validateScoreRange } from './records.js'

export const PAGE_SIZE = 20

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function emptyView() {
  return {
    activity: '',
    kind: '',
    search: '',
    startDate: '',
    endDate: '',
    minScore: null,
    maxScore: null,
    page: 1
  }
}

const first = (value) => (Array.isArray(value) ? value[0] : value)

function numberOrNull(value) {
  const raw = String(first(value) ?? '').trim()
  if (raw === '') return null
  const number = Number(raw)
  return Number.isFinite(number) ? number : null
}

function dateOrEmpty(value) {
  const raw = String(first(value) ?? '').trim()
  return DATE_PATTERN.test(raw) ? raw : ''
}

export function normalizeView(input = {}) {
  const activity = isKnownActivity(first(input.activity)) ? first(input.activity) : ''
  const config = ACTIVITIES[activity]
  const kind = String(first(input.kind) ?? '')
  const scored = Boolean(config?.score)
  const page = Math.floor(Number(first(input.page)))
  return {
    activity,
    kind: config?.kinds.some((option) => option.value === kind) ? kind : '',
    search: String(first(input.search) ?? ''),
    startDate: dateOrEmpty(input.startDate),
    endDate: dateOrEmpty(input.endDate),
    minScore: scored ? numberOrNull(input.minScore) : null,
    maxScore: scored ? numberOrNull(input.maxScore) : null,
    page: page >= 1 ? page : 1
  }
}

const QUERY_KEYS = {
  activity: 'activity',
  kind: 'kind',
  search: 'q',
  startDate: 'from',
  endDate: 'to',
  minScore: 'min',
  maxScore: 'max',
  page: 'page'
}

export function parseView(query = {}) {
  const input = {}
  for (const [field, key] of Object.entries(QUERY_KEYS)) input[field] = query[key]
  return normalizeView(input)
}

/** View -> route query; defaults are left out so the plain page keeps a plain URL. */
export function serializeView(view) {
  const defaults = emptyView()
  const query = {}
  for (const [field, key] of Object.entries(QUERY_KEYS)) {
    if (view[field] !== defaults[field] && view[field] !== '') query[key] = String(view[field])
  }
  return query
}

export function sameView(left, right) {
  return JSON.stringify(serializeView(left)) === JSON.stringify(serializeView(right))
}

/** Everything that decides *which* records are in scope (not which page). */
export function viewScopeKey(view) {
  return JSON.stringify(serializeView({ ...view, page: 1 }))
}

/** Filters that live in the disclosure panel (search lives in the toolbar). */
export function hasPanelFilters(view) {
  return Boolean(
    view.kind || view.startDate || view.endDate || view.minScore !== null || view.maxScore !== null
  )
}

export function hasFilters(view) {
  return Boolean(view.search.trim()) || hasPanelFilters(view)
}

/** The same filters on the neighbouring tab, minus what only fits one activity. */
export function switchActivity(view, activity) {
  return normalizeView({ ...view, activity, kind: '', minScore: null, maxScore: null, page: 1 })
}

export function clearFilters(view) {
  return { ...emptyView(), activity: view.activity }
}

/** The one place a view becomes a list_history query. */
export function toListQuery(view, { limit, offset = 0 } = {}) {
  const score = ACTIVITIES[view.activity]?.score ?? null
  return {
    activity: view.activity || null,
    limit,
    offset,
    search: view.search.trim(),
    startDate: view.startDate,
    endDate: view.endDate,
    minScore: scoreToQuery(score, view.minScore),
    maxScore: scoreToQuery(score, view.maxScore),
    scoreScale: score?.scale ?? null,
    taskType: view.kind || null
  }
}

/** Error message for an unusable filter combination, '' when fine. */
export function validateView(view) {
  if (view.startDate && view.endDate && view.startDate > view.endDate) {
    return '开始日期不能晚于结束日期'
  }
  return validateScoreRange(ACTIVITIES[view.activity]?.score ?? null, view.minScore, view.maxScore)
}

/** Statistics range for the writing criteria table (the API knows these three). */
export function statisticsRange(view) {
  return view.kind === 'task1' || view.kind === 'task2' ? view.kind : 'all'
}

/** What the summary sentence calls the records it counted. */
export function summaryScopeLabel(view) {
  return hasFilters(view) ? '当前筛选' : '全部记录'
}
