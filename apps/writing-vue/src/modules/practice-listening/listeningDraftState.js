const MAX_AUDIO_POSITION_MS = 86_400_000

export function readListeningDraftPosition(position, groups) {
  const section = Number(position?.part)
  const questions = (groups || []).filter(group => Number(group?.section) === section)
    .flatMap(group => group.questionIds || [])
  if (!Number.isInteger(section) || section < 1 || section > 4 || !questions.length) return null
  const audioMs = Number(position?.audioPositionMs)
  return {
    section,
    questionId: questions.includes(position.questionId) ? position.questionId : questions[0],
    audioSeconds: Number.isFinite(audioMs) && audioMs >= 0 && audioMs <= MAX_AUDIO_POSITION_MS
      ? audioMs / 1000 : 0
  }
}

export function createListeningDraftClock(monotonic = () => performance.now(), wall = Date.now) {
  let accumulated = 0
  let started = null
  function elapsed() {
    return Math.max(0, Math.round(accumulated + (started == null ? 0 : monotonic() - started)))
  }
  function start() {
    if (started == null) started = monotonic()
  }
  function pause() {
    accumulated = elapsed()
    started = null
  }
  function restore(ms) {
    accumulated = Number.isFinite(ms) && ms > 0 ? ms : 0
    started = null
  }
  function snapshot() {
    const now = wall()
    const anchor = now - elapsed()
    return {
      source: 'single', anchorMs: anchor, effectiveStartTimeMs: anchor,
      mode: 'elapsed', pausedOffsetMs: 0, pausedAtMs: now, running: false
    }
  }
  return { elapsed, start, pause, restore, snapshot }
}
