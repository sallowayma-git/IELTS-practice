/**
 * "← 返回历史": a record opened from /history remembers where it came from.
 *
 * vue-router stores the previous location in `history.state.back`, and the
 * History page keeps its tab / filters / page in the URL query — so the
 * previous location *is* the view to restore.  No parameters are added to the
 * record's own URL (reading review URLs stay exactly as they were).
 */
const DETAIL_ROUTES = new Set(['Result', 'PracticeReadingReview'])

/**
 * The /history location a detail page was opened from, or null.
 * Reads `route.fullPath` first so callers re-evaluate on every navigation.
 */
export function historyReturnPath(route) {
  if (!route) return null
  void route.fullPath
  if (!DETAIL_ROUTES.has(route.name)) return null
  const back = typeof window === 'undefined' ? null : window.history.state?.back
  const previous = typeof back === 'string' ? back : ''
  return previous === '/history' || previous.startsWith('/history?') ? previous : null
}
