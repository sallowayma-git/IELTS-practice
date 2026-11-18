import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dueLabel,
  filterVocabRows,
  sortVocabRows,
  vocabCounts,
  vocabStatus
} from '../../../apps/writing-vue/src/modules/vocabulary/vocabListView.js'

const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function iso(ms) {
  return new Date(ms).toISOString()
}

function word(id, { term = id, definition = '', createdAt = NOW - DAY, dueAt = null, lastReviewedAt = null, lapses = 0 } = {}) {
  return {
    id,
    term,
    normalizedTerm: term.toLowerCase(),
    definition,
    tags: [],
    createdAt: iso(createdAt),
    updatedAt: iso(createdAt),
    review: {
      ease: 2.5,
      intervalDays: 1,
      repetitions: 0,
      dueAt: dueAt === null ? null : iso(dueAt),
      lastReviewedAt: lastReviewedAt === null ? null : iso(lastReviewedAt),
      lapses
    }
  }
}

function freshWord(id, term, createdAt = NOW - DAY) {
  return word(id, { term, createdAt })
}

function dueWord(id, dueAt, term = id) {
  return word(id, { term, dueAt, lastReviewedAt: dueAt - DAY })
}

function scheduledWord(id, dueAt, term = id) {
  return word(id, { term, dueAt, lastReviewedAt: dueAt - 2 * DAY })
}

test('counts split reviewed-due words, never-reviewed words and the full total', () => {
  const invalid = word('invalid', { dueAt: NOW - DAY, lastReviewedAt: NOW - 2 * DAY })
  invalid.review.dueAt = 'not-a-date'
  const items = [
    dueWord('due-now', NOW - HOUR),
    dueWord('due-old', NOW - 2 * DAY),
    word('future', { dueAt: NOW + DAY, lastReviewedAt: NOW - DAY }),
    invalid,
    freshWord('fresh-a', 'alpha'),
    freshWord('fresh-b', 'beta')
  ]

  assert.deepEqual(vocabCounts(items, NOW), { total: 6, due: 2, fresh: 2 })
  assert.deepEqual(vocabStatus(items[0], NOW), 'due')
  assert.deepEqual(vocabStatus(items[2], NOW), 'scheduled')
  assert.deepEqual(vocabStatus(invalid, NOW), 'scheduled')
  assert.deepEqual(vocabStatus(items[4], NOW), 'fresh')
})

test('a reviewed word with no due time is still a new word, not a scheduled one', () => {
  // The backend leaves due_at NULL after the first review: lastReviewedAt is
  // set, but the word has no schedule yet, so it must stay reviewable.
  const stranded = word('stranded', { term: 'abandon', lastReviewedAt: NOW - DAY })
  assert.equal(vocabStatus(stranded, NOW), 'fresh')
  assert.equal(dueLabel(stranded, NOW), '新词')
  assert.deepEqual(vocabCounts([stranded], NOW), { total: 1, due: 0, fresh: 1 })
  assert.deepEqual(filterVocabRows([stranded], { filter: 'fresh', nowMs: NOW }).map((item) => item.id), ['stranded'])
})

test('dueLabel returns the trail text and formats the ISO date part without timezone shifts', () => {
  assert.equal(dueLabel(dueWord('due', NOW - HOUR), NOW), '待复习')
  assert.equal(dueLabel(freshWord('fresh', 'alpha'), NOW), '新词')
  const offsetDate = scheduledWord('scheduled', NOW + 6 * DAY)
  offsetDate.review.dueAt = '2026-11-20T23:30:00.000+08:00'
  assert.equal(dueLabel(offsetDate, NOW), '复习: 2026-11-20')
  const invalid = word('invalid', { dueAt: NOW + DAY, lastReviewedAt: NOW - DAY })
  invalid.review.dueAt = 'not-a-date'
  assert.equal(dueLabel(invalid, NOW), '复习: —')
})

test('sortVocabRows orders due first, then fresh newest first, then scheduled, without reordering the input', () => {
  const items = [
    scheduledWord('scheduled-later', NOW + 10 * DAY),
    freshWord('fresh-old', 'old', NOW - 10 * DAY),
    dueWord('due-late', NOW - HOUR),
    freshWord('fresh-new', 'new', NOW - HOUR),
    scheduledWord('scheduled-soon', NOW + DAY),
    dueWord('due-early', NOW - 2 * HOUR)
  ]
  const original = items.slice()

  assert.deepEqual(
    sortVocabRows(items, NOW).map((item) => item.id),
    ['due-early', 'due-late', 'fresh-new', 'fresh-old', 'scheduled-soon', 'scheduled-later']
  )
  assert.deepEqual(items, original)
})

test('filterVocabRows applies the active tab and a trimmed case-insensitive term or definition search', () => {
  const items = [
    dueWord('due', NOW - HOUR, 'Abandon'),
    freshWord('fresh', 'Meticulous'),
    scheduledWord('later', NOW + DAY, 'Lucid')
  ]
  items[0].definition = 'To give up completely.'
  items[1].definition = 'Very careful and precise.'
  items[2].definition = 'Clear and easy to understand.'
  const original = items.slice()

  assert.deepEqual(filterVocabRows(items, { filter: 'due', nowMs: NOW }).map((item) => item.id), ['due'])
  assert.deepEqual(filterVocabRows(items, { filter: 'fresh', nowMs: NOW }).map((item) => item.id), ['fresh'])
  assert.deepEqual(filterVocabRows(items, { filter: 'all', nowMs: NOW }).map((item) => item.id), ['due', 'fresh', 'later'])
  assert.deepEqual(
    filterVocabRows(items, { filter: 'all', keyword: '  ABANDON ', nowMs: NOW }).map((item) => item.id),
    ['due']
  )
  assert.deepEqual(
    filterVocabRows(items, { filter: 'all', keyword: 'CLEAR', nowMs: NOW }).map((item) => item.id),
    ['later']
  )
  assert.deepEqual(filterVocabRows(items, { filter: 'all', keyword: 'missing', nowMs: NOW }), [])
  assert.deepEqual(filterVocabRows(items, { filter: 'all', keyword: '   ', nowMs: NOW }), items)
  assert.deepEqual(items, original)
})

test('every helper leaves frozen inputs untouched', () => {
  const items = Object.freeze([
    dueWord('due', NOW - HOUR, 'Abandon'),
    freshWord('fresh', 'Meticulous')
  ])
  items.forEach((item) => {
    Object.freeze(item.review)
    Object.freeze(item)
  })
  const snapshot = structuredClone(items)

  assert.deepEqual(vocabCounts(items, NOW), { total: 2, due: 1, fresh: 1 })
  assert.equal(dueLabel(items[0], NOW), '待复习')
  assert.equal(dueLabel(items[1], NOW), '新词')
  const sorted = sortVocabRows(items, NOW)
  assert.notEqual(sorted, items)
  assert.deepEqual(sorted.map((item) => item.id), ['due', 'fresh'])
  assert.deepEqual(filterVocabRows(sorted, { filter: 'fresh', keyword: 'meticulous', nowMs: NOW }).map((item) => item.id), ['fresh'])
  assert.deepEqual(items, snapshot)
})
