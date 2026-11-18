/**
 * Vocabulary session queue: due words first, then never-scheduled words.
 * Pure state transitions only. The caller owns persistence and must submit a
 * backend review exactly once per item flagged `needsReview`.
 *
 * Grades are the numeric backend contract (0 wrong, 1 hard, 2 good, 3 easy).
 */

export const BATCH_SIZE = 24

export const GRADE = Object.freeze({
  wrong: 0,
  hard: 1,
  good: 2,
  easy: 3
})

const RATINGS = Object.freeze(Object.keys(GRADE))

function emptyStats() {
  return Object.fromEntries(RATINGS.map((rating) => [rating, 0]))
}

function hasDueAt(item) {
  const dueAt = item.review?.dueAt
  return dueAt !== null && dueAt !== undefined
}

// The backend writes last_reviewed_at on the first review but leaves due_at
// NULL until the second one schedules an interval. Checking only
// lastReviewedAt would strand that word: it is neither due nor fresh, so it
// leaves the queue forever. A missing due_at is still first contact.
function isFirstContact(item) {
  return !item.review?.lastReviewedAt || !hasDueAt(item)
}

function parseDueAt(item) {
  if (isFirstContact(item)) return null
  const dueAt = Date.parse(item.review.dueAt)
  return Number.isFinite(dueAt) ? dueAt : null
}

/**
 * Split words into a review queue. Scheduled words whose due time has not
 * arrived are intentionally omitted: they are neither due nor fresh.
 */
export function buildQueue(items, nowMs) {
  const due = []
  const fresh = []

  items.forEach((item, index) => {
    if (isFirstContact(item)) {
      fresh.push(item)
      return
    }
    const dueAt = parseDueAt(item)
    if (dueAt !== null && dueAt <= nowMs) due.push({ item, dueAt, index })
  })

  due.sort((left, right) => left.dueAt - right.dueAt || left.index - right.index)

  const dueItems = due.map((entry) => entry.item)
  return {
    due: dueItems,
    fresh,
    backlog: dueItems.concat(fresh)
  }
}

function startBatch(backlog, batchSize) {
  const nextBacklog = backlog.slice()
  const nextBatch = nextBacklog.splice(0, batchSize)
  return { batch: nextBatch, backlog: nextBacklog }
}

export function createSession(items, { now = Date.now(), batchSize = BATCH_SIZE } = {}) {
  const { due, fresh, backlog } = buildQueue(items, now)
  const first = startBatch(backlog, batchSize)
  const current = first.batch[0] || null

  return {
    batch: first.batch,
    backlog: first.backlog,
    current,
    stage: current ? 'recall' : 'complete',
    recognition: null,
    spellingMisses: 0,
    stats: emptyStats(),
    dueTotal: due.length,
    freshTotal: fresh.length,
    requeuedIds: [],
    batchSize
  }
}

export function rateRecall(session, rating) {
  if (!RATINGS.includes(rating)) {
    throw new Error(`invalid vocabulary rating: ${String(rating)}`)
  }
  if (session.stage !== 'recall' || !session.current) {
    throw new Error(`rateRecall requires stage "recall" (received "${session.stage}")`)
  }
  return {
    ...session,
    stage: 'spelling',
    recognition: rating,
    spellingMisses: 0
  }
}

export function submitSpelling(session, typed) {
  if (session.stage !== 'spelling' || !session.current) {
    throw new Error(`submitSpelling requires stage "spelling" (received "${session.stage}")`)
  }

  const expected = String(session.current.term ?? '').trim().toLowerCase()
  const actual = String(typed ?? '').trim().toLowerCase()
  if (actual === expected) return finalize(session)

  const spellingMisses = session.spellingMisses + 1
  const missed = { ...session, spellingMisses }
  return spellingMisses >= 3 ? finalize(missed) : missed
}

export function skip(session) {
  if (session.stage === 'complete' || !session.current) {
    throw new Error('skip requires a current word')
  }
  return finalize(session, { skipped: true })
}

function finalGrade(session, skipped) {
  if (skipped || session.spellingMisses >= 3) return 'wrong'
  if (session.spellingMisses >= 2) return 'hard'
  if (session.spellingMisses === 1 && session.recognition === 'easy') return 'good'
  return session.recognition || 'wrong'
}

function finalize(session, { skipped = false } = {}) {
  const item = session.current
  const grade = finalGrade(session, skipped)
  const firstPass = item.requeued !== true
  const shouldRequeue = firstPass
    && isFirstContact(item)
    && (grade === 'good' || grade === 'hard')
    && !session.requeuedIds.includes(item.id)
  // origin/main defers the first good/hard answer: the in-session retest is
  // the answer that gets saved and counted. Saving the first pass would record
  // a grade the learner immediately disproved.
  const needsReview = !shouldRequeue

  const batch = session.batch.slice(1)
  if (shouldRequeue) batch.push({ ...item, requeued: true })

  const next = batch.length === 0 && session.backlog.length > 0
    ? startBatch(session.backlog, session.batchSize)
    : { batch, backlog: session.backlog }

  const current = next.batch[0] || null
  return {
    ...session,
    batch: next.batch,
    backlog: next.backlog,
    current,
    stage: current ? 'recall' : 'complete',
    recognition: null,
    spellingMisses: 0,
    stats: needsReview
      ? { ...session.stats, [grade]: session.stats[grade] + 1 }
      : session.stats,
    requeuedIds: shouldRequeue
      ? session.requeuedIds.concat(item.id)
      : session.requeuedIds,
    lastResult: {
      id: item.id,
      grade,
      needsReview,
      requeued: shouldRequeue
    }
  }
}

export default {
  BATCH_SIZE,
  GRADE,
  buildQueue,
  createSession,
  rateRecall,
  submitSpelling,
  skip
}
