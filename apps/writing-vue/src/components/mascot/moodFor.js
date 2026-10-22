/**
 * Mood lookups. Pure functions over small tables: no Vue, no I/O.
 * A table entry is the only place a mood is chosen; callers never branch on mood names.
 */

const EMPTY_MOODS = { empty: 'calm', 'no-results': 'confused', error: 'hurt' }

/** Page or section state (`empty` | `no-results` | `error`) -> mascot mood. */
export function emptyMood(kind) {
  return EMPTY_MOODS[kind] || 'calm'
}

// A signal votes +1 (improved), -1 (declined) or 0 (within noise).
// Reading delta is a 0–1 ratio, so it is converted to whole accuracy points first.
const SIGNALS = [
  { key: 'reading', toStep: (delta) => Math.round(delta * 100), up: (step) => step > 2, down: (step) => step < -2 },
  { key: 'writing', toStep: (delta) => Math.round(delta * 10) / 10, up: (step) => step >= 0.3, down: (step) => step <= -0.3 }
]
const TREND_MOODS = { improving: 'excited', declining: 'tired', mixed: 'focused', steady: 'calm' }
const ENERGIZED_STREAK = 7

function voteOf(signal, delta) {
  if (!Number.isFinite(delta)) return 0
  const step = signal.toStep(delta)
  if (signal.up(step)) return 1
  return signal.down(step) ? -1 : 0
}

function trendOf(votes) {
  const up = votes.includes(1)
  const down = votes.includes(-1)
  if (up && down) return 'mixed'
  if (up) return 'improving'
  return down ? 'declining' : 'steady'
}

/**
 * Dashboard mood. `delta` = { reading, writing } as produced by recentAverage
 * (reading in 0–1 ratio, writing in band); `count` = scored attempts in the window.
 */
export function trendMood({ delta = {}, streak = 0, count = 0 } = {}) {
  if (count === 0) return 'calm'
  if (streak >= ENERGIZED_STREAK) return 'energized'
  const votes = SIGNALS.map((signal) => voteOf(signal, delta[signal.key]))
  return TREND_MOODS[trendOf(votes)]
}

const ENERGIZED_STREAK_DAYS = 7

/**
 * Notebook daily mood. `entry.mood` = { up, down, light, streak } as computed by
 * compose.js (up/down: reading kinds and writing criteria that moved against the
 * student's own baseline). Never stressed, hurt or tired: a bad day is focused.
 *   no comparison or a light day     -> calm
 *   any regression (mixed too)       -> focused
 *   long streak with improvements    -> energized
 *   two or more improvements         -> proud
 *   one improvement                  -> joyful
 */
export function dayMood(entry) {
  const { up = 0, down = 0, light = false, streak = 0 } = entry?.mood ?? {}
  if (light || (up === 0 && down === 0)) return 'calm'
  if (down > 0) return 'focused'
  if (streak >= ENERGIZED_STREAK_DAYS) return 'energized'
  return up >= 2 ? 'proud' : 'joyful'
}

const MOOD_LABELS = {
  excited: '进步中',
  energized: '连续坚持',
  focused: '有进有退',
  calm: '平稳',
  tired: '有些退步',
  joyful: '开心',
  proud: '有成绩',
  stressed: '有些吃力',
  confused: '有点困惑',
  hurt: '受挫'
}

/** Short Chinese name of a mood, for aria labels ("最近状态：进步中"). */
export function moodLabel(mood) {
  return MOOD_LABELS[mood] || ''
}
