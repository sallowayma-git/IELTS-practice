/**
 * Boundary between Compose's UI toggle (`free` / `bank`) and the persisted
 * Rust attempt enum (`freeform` / `bank`).  Keep this mapping here so no
 * caller can silently turn an omitted source mode into a bank attempt.
 */
export function writingTopicModeToAttemptMode(topicMode) {
  const value = String(topicMode || '').trim().toLowerCase()
  if (value === 'free') return 'freeform'
  if (value === 'bank') return 'bank'
  throw new TypeError('writing topic mode must be free or bank')
}

export function requireWritingAttemptMode(mode) {
  const value = String(mode || '').trim().toLowerCase()
  if (value === 'freeform' || value === 'bank') return value
  throw new TypeError('writing attempt mode must be freeform or bank')
}
