import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BATCH_SIZE,
  GRADE,
  buildQueue,
  createSession,
  rateRecall,
  skip,
  submitSpelling
} from '../../../apps/writing-vue/src/modules/vocabulary/vocabSessionCore.js'

const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function iso(ms) {
  return new Date(ms).toISOString()
}

function reviewState({ dueAt = null, lastReviewedAt = null } = {}) {
  return {
    ease: 2.5,
    intervalDays: 1,
    repetitions: 0,
    dueAt: dueAt === null ? null : iso(dueAt),
    lastReviewedAt: lastReviewedAt === null ? null : iso(lastReviewedAt),
    lapses: 0
  }
}

function word(id, term, state = {}) {
  return {
    id,
    term,
    normalizedTerm: term.toLowerCase(),
    tags: [],
    createdAt: iso(NOW - DAY),
    updatedAt: iso(NOW - DAY),
    review: reviewState(state)
  }
}

function fresh(id, term = id) {
  return word(id, term)
}

function dueWord(id, dueAtMs, term = id) {
  return word(id, term, { dueAt: dueAtMs, lastReviewedAt: dueAtMs - DAY })
}

function answerCorrectly(session, rating = 'easy') {
  const recalled = rateRecall(session, rating)
  return submitSpelling(recalled, recalled.current.term)
}

test('constants expose the batch size and the numeric backend ratings', () => {
  assert.equal(BATCH_SIZE, 24)
  assert.deepEqual(GRADE, { wrong: 0, hard: 1, good: 2, easy: 3 })
  assert.ok(Object.isFrozen(GRADE))
})

test('30 due + 10 fresh: the batch is 24 due words and the rest stay in backlog', () => {
  const dueWords = Array.from({ length: 30 }, (_, index) => dueWord(`d${index}`, NOW - (30 - index) * 60_000))
  const freshWords = Array.from({ length: 10 }, (_, index) => fresh(`f${index}`))
  const items = [...dueWords].reverse().concat(freshWords)

  const queue = buildQueue(items, NOW)
  assert.equal(queue.due.length, 30)
  assert.equal(queue.fresh.length, 10)
  assert.equal(queue.backlog.length, 40)
  assert.deepEqual(queue.due.map((item) => item.id), dueWords.map((item) => item.id))
  assert.deepEqual(queue.fresh.map((item) => item.id), freshWords.map((item) => item.id))

  const session = createSession(items, { now: NOW })
  assert.equal(session.batch.length, BATCH_SIZE)
  assert.deepEqual(session.batch.map((item) => item.id), dueWords.slice(0, BATCH_SIZE).map((item) => item.id))
  assert.deepEqual(
    session.backlog.map((item) => item.id),
    dueWords.slice(BATCH_SIZE).map((item) => item.id).concat(freshWords.map((item) => item.id))
  )
  assert.equal(session.dueTotal, 30)
  assert.equal(session.freshTotal, 10)
  assert.equal(session.current.id, 'd0')
  assert.equal(session.stage, 'recall')
})

test('due order is dueAt ascending with input order breaking ties; unparseable or future due dates are queued nowhere', () => {
  const first = dueWord('a', NOW - 5_000)
  const second = dueWord('b', NOW - 5_000)
  const earliest = dueWord('c', NOW - 9_000)
  const future = dueWord('future', NOW + 5_000)
  const invalid = word('invalid', 'invalid', { lastReviewedAt: NOW - DAY })
  invalid.review.dueAt = 'not-a-date'

  const queue = buildQueue([first, second, earliest, future, invalid], NOW)
  assert.deepEqual(queue.due.map((item) => item.id), ['c', 'a', 'b'])
  assert.deepEqual(queue.fresh.map((item) => item.id), [])
  assert.deepEqual(queue.backlog.map((item) => item.id), ['c', 'a', 'b'])
})

test('20 due + 10 fresh: a batch fills with every due word and then fresh words', () => {
  const dueWords = Array.from({ length: 20 }, (_, index) => dueWord(`d${index}`, NOW - (20 - index) * 60_000))
  const freshWords = Array.from({ length: 10 }, (_, index) => fresh(`f${index}`))

  const session = createSession([...dueWords, ...freshWords], { now: NOW })
  assert.equal(session.batch.length, BATCH_SIZE)
  assert.deepEqual(session.batch.slice(0, 20).map((item) => item.id), dueWords.map((item) => item.id))
  assert.deepEqual(session.batch.slice(20).map((item) => item.id), freshWords.slice(0, 4).map((item) => item.id))
  assert.deepEqual(session.backlog.map((item) => item.id), freshWords.slice(4).map((item) => item.id))
})

test('a new word graded good is requeued once at the batch end and the copy never requeues again', () => {
  const original = fresh('w1', 'Abandon')
  const session = createSession([original], { now: NOW })

  const firstPass = answerCorrectly(session, 'good')
  assert.deepEqual(firstPass.lastResult, { id: 'w1', grade: 'good', needsReview: true, requeued: true })
  assert.equal(firstPass.stage, 'recall')
  assert.equal(firstPass.current.id, 'w1')
  assert.equal(firstPass.current.requeued, true)
  assert.notEqual(firstPass.current, original)
  assert.equal(firstPass.batch.length, 1)
  assert.deepEqual(firstPass.requeuedIds, ['w1'])
  assert.equal(original.requeued, undefined, 'the source item is never mutated')

  const secondPass = answerCorrectly(firstPass, 'good')
  assert.deepEqual(secondPass.lastResult, { id: 'w1', grade: 'good', needsReview: false, requeued: false })
  assert.equal(secondPass.stage, 'complete')
  assert.equal(secondPass.current, null)
  assert.deepEqual(secondPass.requeuedIds, ['w1'])
  assert.deepEqual(secondPass.stats, { wrong: 0, hard: 0, good: 1, easy: 0 })
})

test('a new word graded easy is not requeued in the session', () => {
  const session = createSession([fresh('w1', 'Abandon')], { now: NOW })
  const done = answerCorrectly(session, 'easy')

  assert.deepEqual(done.lastResult, { id: 'w1', grade: 'easy', needsReview: true, requeued: false })
  assert.equal(done.stage, 'complete')
  assert.deepEqual(done.requeuedIds, [])
  assert.deepEqual(done.stats, { wrong: 0, hard: 0, good: 0, easy: 1 })
})

test('one spelling miss after an easy recall becomes good', () => {
  const recalled = rateRecall(createSession([fresh('w1', 'abandon')], { now: NOW }), 'easy')
  const missed = submitSpelling(recalled, 'abandonn')
  assert.equal(missed.stage, 'spelling')
  assert.equal(missed.spellingMisses, 1)
  assert.equal(missed.current.id, 'w1')

  const done = submitSpelling(missed, '  ABANDON ')
  assert.equal(done.lastResult.grade, 'good')
})

test('two spelling misses become hard', () => {
  let session = rateRecall(createSession([fresh('w1', 'abandon')], { now: NOW }), 'good')
  session = submitSpelling(session, 'abandonn')
  session = submitSpelling(session, 'abandom')
  assert.equal(session.stage, 'spelling')
  assert.equal(session.spellingMisses, 2)

  session = submitSpelling(session, 'abandon')
  assert.equal(session.lastResult.grade, 'hard')
})

test('three spelling misses finalize as wrong immediately', () => {
  let session = rateRecall(createSession([fresh('w1', 'abandon')], { now: NOW }), 'good')
  session = submitSpelling(session, 'a')
  assert.equal(session.stage, 'spelling')
  session = submitSpelling(session, 'b')
  assert.equal(session.stage, 'spelling')
  session = submitSpelling(session, 'c')

  assert.equal(session.lastResult.grade, 'wrong')
  assert.equal(session.lastResult.needsReview, true)
  assert.equal(session.lastResult.requeued, false)
  assert.equal(session.stage, 'complete')
})

test('skip finalizes as wrong from either the recall or spelling stage', () => {
  const fromRecall = skip(createSession([fresh('w1', 'abandon')], { now: NOW }))
  assert.deepEqual(fromRecall.lastResult, { id: 'w1', grade: 'wrong', needsReview: true, requeued: false })

  const recalled = rateRecall(createSession([fresh('w2', 'beta')], { now: NOW }), 'good')
  const fromSpelling = skip(recalled)
  assert.equal(fromSpelling.lastResult.grade, 'wrong')
  assert.equal(fromSpelling.stage, 'complete')
})

test('invalid ratings and wrong stages throw programmer errors', () => {
  const session = createSession([fresh('w1')], { now: NOW })
  assert.throws(() => rateRecall(session, 'perfect'), /invalid vocabulary rating/)
  assert.throws(() => rateRecall(session, 2), /invalid vocabulary rating/)
  assert.throws(() => rateRecall({ ...session, stage: 'complete' }, 'good'), /requires stage "recall"/)
  assert.throws(() => submitSpelling(session, 'w1'), /requires stage "spelling"/)
  assert.throws(() => skip({ ...session, stage: 'complete', current: null }), /requires a current word/)
})

test('backend review is requested exactly once per first-pass item', () => {
  let session = createSession([fresh('a', 'alpha'), fresh('b', 'beta')], { now: NOW })
  const results = []

  while (session.stage !== 'complete') {
    if (session.stage === 'recall') {
      session = rateRecall(session, 'good')
    } else {
      session = submitSpelling(session, session.current.term)
      results.push(session.lastResult)
    }
  }

  assert.deepEqual(
    results.map((result) => [result.id, result.needsReview, result.requeued]),
    [
      ['a', true, true],
      ['b', true, true],
      ['a', false, false],
      ['b', false, false]
    ]
  )
  const reviewed = {}
  for (const result of results) {
    if (result.needsReview) reviewed[result.id] = (reviewed[result.id] || 0) + 1
  }
  assert.deepEqual(reviewed, { a: 1, b: 1 })
  assert.deepEqual(session.stats, { wrong: 0, hard: 0, good: 2, easy: 0 })
})

test('stage transitions pull the next batch from the backlog and end in complete', () => {
  let session = createSession([fresh('a'), fresh('b'), fresh('c')], { now: NOW, batchSize: 2 })
  assert.deepEqual(session.batch.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(session.backlog.map((item) => item.id), ['c'])

  session = answerCorrectly(session, 'easy')
  assert.equal(session.stage, 'recall')
  assert.equal(session.current.id, 'b')
  assert.deepEqual(session.batch.map((item) => item.id), ['b'])

  session = answerCorrectly(session, 'easy')
  assert.equal(session.stage, 'recall')
  assert.equal(session.current.id, 'c')
  assert.deepEqual(session.batch.map((item) => item.id), ['c'])
  assert.deepEqual(session.backlog, [])

  session = answerCorrectly(session, 'easy')
  assert.equal(session.stage, 'complete')
  assert.equal(session.current, null)
  assert.deepEqual(session.batch, [])
  assert.deepEqual(session.backlog, [])

  let defaultBatch = createSession(
    Array.from({ length: 26 }, (_, index) => fresh(`w${index}`)),
    { now: NOW }
  )
  for (let index = 0; index < BATCH_SIZE; index += 1) defaultBatch = answerCorrectly(defaultBatch, 'easy')
  assert.equal(defaultBatch.stage, 'recall')
  assert.equal(defaultBatch.batch.length, 2)
  assert.equal(defaultBatch.backlog.length, 0)
})

test('buildQueue, createSession and every transition leave inputs and sessions untouched', () => {
  const due = dueWord('due', NOW - DAY)
  const newWord = fresh('new', 'New')
  const items = [due, newWord]
  const queue = buildQueue(items, NOW)
  assert.deepEqual(items, [due, newWord])
  assert.deepEqual(queue.backlog.map((item) => item.id), ['due', 'new'])

  Object.freeze(due.review)
  Object.freeze(due)
  Object.freeze(newWord.review)
  Object.freeze(newWord)
  Object.freeze(items)

  let session = createSession(items, { now: NOW, batchSize: 1 })
  const initial = structuredClone(session)
  assert.equal(session.current.id, 'due')

  const recalled = rateRecall(session, 'good')
  assert.deepEqual(session, initial)
  const missed = submitSpelling(recalled, 'wrong')
  assert.deepEqual(session, initial)
  assert.equal(missed.stage, 'spelling')
  assert.equal(missed.spellingMisses, 1)
  assert.deepEqual(session, initial)

  session = submitSpelling(missed, 'due')
  assert.equal(session.current.id, 'new')
  assert.deepEqual(session.stats, { wrong: 0, hard: 0, good: 1, easy: 0 })
  assert.equal(due.requeued, undefined)
  assert.equal(due.grade, undefined)
  assert.equal(newWord.requeued, undefined)

  const goodPass = answerCorrectly(session, 'good')
  assert.equal(goodPass.current.requeued, true)
  assert.equal(newWord.requeued, undefined)
  assert.equal(newWord.needsReview, undefined)
  assert.deepEqual(items, [due, newWord])
  assert.equal(items.length, 2)
})
