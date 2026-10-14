/**
 * The learner's own preference notes ("先给我看例句", "解释用中文").
 *
 * These are explicit preferences the learner typed, stored under
 * `user_note.*` keys. The host validates every write (length, injection and
 * secret guards) and answers with a Chinese message; the limits here only keep
 * the form honest before the round trip. Keep them in sync with
 * crates/ielts-domain/src/preference.rs.
 */

export const USER_NOTE_PREFIX = 'user_note.'
export const MAX_PREFERENCE_CHARS = 60
export const MAX_PREFERENCE_NOTES = 20

/** Characters, not UTF-16 units, so the count matches the host's `chars()`. */
export function preferenceLength(text) {
  return [...String(text ?? '').trim()].length
}

/** A client-side reason the text cannot be saved yet, or '' when it can. */
export function preferenceDraftProblem(text) {
  const length = preferenceLength(text)
  if (!length) return '请先写下你的偏好。'
  if (length > MAX_PREFERENCE_CHARS) return `偏好请控制在 ${MAX_PREFERENCE_CHARS} 个字以内。`
  return ''
}

/** The learner's notes from a `memory_list_explicit_preferences` result. */
export function userPreferenceNotes(preferences) {
  return (Array.isArray(preferences) ? preferences : [])
    .filter((row) => typeof row?.preferenceKey === 'string'
      && row.preferenceKey.startsWith(USER_NOTE_PREFIX)
      && row.status === 'active'
      && typeof row.value === 'string'
      && row.value.trim())
    .map((row) => ({
      // A preference is identified by scope + key; the same key may exist in two scopes.
      id: `${row.scope || 'global'}:${row.preferenceKey}`,
      key: row.preferenceKey,
      scope: row.scope || 'global',
      text: row.value.trim(),
      updatedAt: row.updatedAt || ''
    }))
}

/** A fresh key for a new note: `user_note.` + 16 lowercase hex characters. */
export function newPreferenceKey(random = globalThis.crypto) {
  const bytes = new Uint8Array(8)
  if (random?.getRandomValues) random.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return USER_NOTE_PREFIX + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Host codes whose message is written for the learner (see ExplicitPreferenceIssue).
const LEARNER_FACING_CODES = new Set([
  'memory.preference_invalid_key',
  'memory.preference_invalid_scope',
  'memory.preference_invalid_value',
  'memory.preference_empty',
  'memory.preference_too_long',
  'memory.preference_rejected',
  'memory.preference_limit'
])

/** What to tell the learner when a write failed. */
export function preferenceErrorMessage(error, fallback) {
  if (error && LEARNER_FACING_CODES.has(error.code) && error.message) return String(error.message)
  return fallback
}
