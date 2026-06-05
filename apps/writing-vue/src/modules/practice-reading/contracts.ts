export const READING_ACTIVITY = 'reading'
export const READING_COACH_ENABLED_SETTING_KEY = 'practice.readingCoach.enabled'

export const READING_LIBRARY_SOURCE = Object.freeze({
  BUILTIN: 'builtin',
  NAS_SQLITE: 'nas-sqlite',
  NAS_JS: 'nas-js'
})

export function normalizeReadingRecordId(value) {
  return String(value || '').trim()
}

export function normalizeReadingCoachEnabled(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback)
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  const normalized = String(value).trim().toLowerCase()
  if (['false', '0', 'off', 'disabled', 'no'].includes(normalized)) {
    return false
  }
  if (['true', '1', 'on', 'enabled', 'yes'].includes(normalized)) {
    return true
  }
  return Boolean(fallback)
}

export function normalizeReadingSuitePayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const normalized = {
    flowMode: source.flowMode,
    frequencyScope: source.frequencyScope
  }
  if (Array.isArray(source.sequence) && source.sequence.length) {
    normalized.sequence = source.sequence
  }
  return normalized
}
