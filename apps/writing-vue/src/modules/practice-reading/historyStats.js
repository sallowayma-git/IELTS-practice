export function safeDateMs(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function historyPercentage(record) {
  const accuracy = Number(record?.accuracy)
  if (!Number.isFinite(accuracy)) return 0
  return Math.round(Math.min(1, Math.max(0, accuracy)) * 100)
}

function historyDurationSeconds(record) {
  const duration = Number(record?.duration)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

export function calculateStreakDays(records, now = new Date()) {
  const days = new Set((Array.isArray(records) ? records : []).map((record) => {
    const value = String(record?.submittedAt || '').trim()
    if (!value) return ''
    return value.slice(0, 10)
  }).filter(Boolean))
  if (!days.size) return 0

  let streak = 0
  const cursor = new Date(now)
  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (!days.has(key)) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function sortReadingHistory(records) {
  return (Array.isArray(records) ? records : []).slice().sort((left, right) => (
    safeDateMs(right?.submittedAt)
    - safeDateMs(left?.submittedAt)
  ))
}

export function historyRecordMatchesType(record, type) {
  if (type !== 'reading') return true
  const activity = String(record?.activity || '').trim().toLowerCase()
  const recordType = String(record?.taskType || '').trim().toLowerCase()
  return activity === 'reading' || recordType === 'reading' || Boolean(record?.assetId || record?.examId)
}

export function filterReadingHistory(records, options = {}) {
  const query = String(options.keyword || '').trim().toLowerCase()
  const selectedHistoryType = options.selectedHistoryType || 'all'
  return sortReadingHistory(records).filter((record) => {
    if (!historyRecordMatchesType(record, selectedHistoryType)) return false
    if (!query) return true
    return [
      record?.id,
      record?.title,
      record?.assetId,
      record?.examId,
      record?.activity,
      record?.taskType,
      record?.metadata?.activity,
      record?.submittedAt
    ].filter(Boolean).join(' ').toLowerCase().includes(query)
  })
}

export function buildHistoryStats(records, options = {}) {
  const list = Array.isArray(records) ? records : []
  const totalPracticed = list.length
  const totalAccuracy = list.reduce((sum, record) => sum + historyPercentage(record) / 100, 0)
  const totalDuration = list.reduce((sum, record) => sum + historyDurationSeconds(record), 0)
  return {
    totalPracticed,
    averageAccuracy: totalPracticed ? Math.round((totalAccuracy / totalPracticed) * 100) : 0,
    studyMinutes: Math.round(totalDuration / 60),
    streakDays: calculateStreakDays(list, options.now)
  }
}

export function getPracticeTrendRecords(records, range, ranges, now = Date.now()) {
  const list = sortReadingHistory(records)
  const config = (Array.isArray(ranges) ? ranges : []).find((item) => item.value === range) || ranges?.[0] || { limit: 10 }
  if (config.days) {
    const cutoff = now - config.days * 24 * 60 * 60 * 1000
    return list.filter((record) => safeDateMs(record?.submittedAt) >= cutoff)
  }
  return list.slice(0, config.limit || 10)
}

export function buildPracticeTrendSummary(records, range, ranges, now = Date.now()) {
  const trendRecords = getPracticeTrendRecords(records, range, ranges, now)
  const totalAccuracy = trendRecords.reduce((sum, record) => sum + historyPercentage(record), 0)
  const resolvedRange = (Array.isArray(ranges) ? ranges : []).find((item) => item.value === range) || ranges?.[0] || { label: '' }
  return {
    count: trendRecords.length,
    averageAccuracy: trendRecords.length ? Math.round(totalAccuracy / trendRecords.length) : 0,
    rangeLabel: resolvedRange.label
  }
}

export function buildPracticeTrendBars(records, range, ranges, now = Date.now()) {
  return getPracticeTrendRecords(records, range, ranges, now)
    .slice()
    .reverse()
    .map((record, index) => {
      const accuracy = historyPercentage(record)
      return {
        id: String(record?.id || record?.sessionId || index),
        label: record?.title || `记录 ${index + 1}`,
        accuracy,
        height: Math.max(8, Math.min(100, accuracy))
      }
    })
}
