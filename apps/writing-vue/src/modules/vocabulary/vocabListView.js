/**
 * Vocabulary list view-model: status counts, row labels, order and filtering.
 * Pure functions only; callers own the data and every input stays untouched.
 */

const STATUS = Object.freeze({ due: 'due', fresh: 'fresh', scheduled: 'scheduled' })
const STATUS_RANK = Object.freeze({ due: 0, fresh: 1, scheduled: 2 })

function parseTime(value) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A reviewed word is due once its due time has arrived. */
export function vocabStatus(item, nowMs) {
  if (!item.review?.lastReviewedAt) return STATUS.fresh
  const dueAt = parseTime(item.review.dueAt)
  return dueAt !== null && dueAt <= nowMs ? STATUS.due : STATUS.scheduled
}

export function vocabCounts(items, nowMs) {
  let due = 0
  let fresh = 0
  for (const item of items) {
    const status = vocabStatus(item, nowMs)
    if (status === STATUS.due) due += 1
    else if (status === STATUS.fresh) fresh += 1
  }
  return { total: items.length, due, fresh }
}

/** Trail text: 待复习 / 新词 / 复习: YYYY-MM-DD. */
export function dueLabel(item, nowMs) {
  const status = vocabStatus(item, nowMs)
  if (status === STATUS.due) return '待复习'
  if (status === STATUS.fresh) return '新词'
  const dueAt = String(item.review?.dueAt ?? '')
  const date = parseTime(dueAt) === null ? '' : dueAt.slice(0, 10)
  return `复习: ${date || '—'}`
}

function sortKey(item, status) {
  if (status === STATUS.fresh) {
    const createdAt = parseTime(item.createdAt)
    return createdAt === null ? Infinity : -createdAt
  }
  const dueAt = parseTime(item.review?.dueAt)
  return dueAt === null ? Infinity : dueAt
}

/** Due words by dueAt, then fresh words newest first, then scheduled words. */
export function sortVocabRows(items, nowMs) {
  return items
    .map((item, index) => {
      const status = vocabStatus(item, nowMs)
      return { item, status, index, key: sortKey(item, status) }
    })
    .sort((left, right) => (
      STATUS_RANK[left.status] - STATUS_RANK[right.status]
      || left.key - right.key
      || left.index - right.index
    ))
    .map((row) => row.item)
}

/** `filter` is a tab value (all | due | fresh); `keyword` matches term or definition. */
export function filterVocabRows(rows, { filter = 'all', keyword = '', nowMs = Date.now() } = {}) {
  const needle = String(keyword ?? '').trim().toLowerCase()
  return rows.filter((item) => {
    if (filter !== 'all' && vocabStatus(item, nowMs) !== filter) return false
    if (!needle) return true
    return String(item.term ?? '').toLowerCase().includes(needle)
      || String(item.definition ?? '').toLowerCase().includes(needle)
  })
}

export default {
  vocabStatus,
  vocabCounts,
  dueLabel,
  sortVocabRows,
  filterVocabRows
}
