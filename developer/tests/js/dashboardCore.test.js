#!/usr/bin/env node
/** Pure overview-dashboard functions: run with `node developer/tests/js/dashboardCore.test.js`. */
import assert from 'node:assert/strict'
import {
  dayIndex,
  defaultTrendKey,
  formatDelta,
  recentAverage,
  recentRecords,
  streakDays,
  weekCount
} from '../../../apps/writing-vue/src/modules/dashboard/dashboardCore.js'

// Local-time ISO helpers so the tests do not depend on the machine's zone.
const at = (y, m, d, hh = 9) => new Date(y, m - 1, d, hh, 0, 0).toISOString()
const NOW = new Date(2026, 9, 19, 12, 0, 0) // 2026-10-19 local noon
const reading = (occurredAt, value) => ({ activity: 'reading', occurredAt, score: { value } })
const writing = (occurredAt, value) => ({ activity: 'writing', occurredAt, score: { value } })

function testWeekCountWindowIsSevenLocalDays() {
  const records = [
    reading(at(2026, 10, 19), 0.5), // today
    writing(at(2026, 10, 13), 6), // 6 days ago: inside
    reading(at(2026, 10, 12), 0.5), // 7 days ago: outside
    reading(at(2026, 10, 20, 8), 0.5), // future: outside
    reading('', 0.5) // unknown time: ignored
  ]
  assert.equal(weekCount(records, NOW), 2)
  assert.equal(weekCount([], NOW), 0)
}

function testRecentAverageUsesLastNAndComparesWithPrevious() {
  const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 0.5, 0.5]
  const records = scores.map((value, index) => reading(at(2026, 10, 19 - index), value))
  const result = recentAverage(records, 'reading', 10)
  assert.equal(result.count, 10)
  assert.ok(Math.abs(result.value - 0.45) < 1e-9, `mean of newest 10 was ${result.value}`)
  assert.ok(Math.abs(result.delta - (0.45 - 0.5)) < 1e-9, `delta was ${result.delta}`)
}

function testRecentAverageHandlesEmptyAndUnpairedActivities() {
  assert.deepEqual(recentAverage([], 'writing'), { value: null, delta: null, count: 0 })
  const onlyOne = recentAverage([writing(at(2026, 10, 18), 6.5), reading(at(2026, 10, 18), 0.4)], 'writing')
  assert.equal(onlyOne.value, 6.5)
  assert.equal(onlyOne.delta, null, 'no previous window means no delta')
  const unscored = recentAverage([writing(at(2026, 10, 18), null)], 'writing')
  assert.equal(unscored.value, null, 'records without a score do not count')
}

function testStreakEndsTodayOrYesterday() {
  const run = [at(2026, 10, 19), at(2026, 10, 18), at(2026, 10, 17)]
  assert.equal(streakDays(run.map((t) => reading(t, 0.5)), NOW), 3)
  const endsYesterday = [at(2026, 10, 18), at(2026, 10, 17)].map((t) => reading(t, 0.5))
  assert.equal(streakDays(endsYesterday, NOW), 2)
  const gap = [at(2026, 10, 19), at(2026, 10, 17)].map((t) => reading(t, 0.5))
  assert.equal(streakDays(gap, NOW), 1)
  const stale = [reading(at(2026, 10, 15), 0.5)]
  assert.equal(streakDays(stale, NOW), 0)
  assert.equal(streakDays([], NOW), 0)
  assert.equal(dayIndex(at(2026, 10, 19, 23)) - dayIndex(at(2026, 10, 19, 1)), 0, 'same local day')
}

function testRecentRecordsNewestFirstAndLimited() {
  const records = [
    reading(at(2026, 10, 1), 0.1),
    writing(at(2026, 10, 3), 6),
    reading(at(2026, 10, 2), 0.2)
  ]
  const top = recentRecords(records, 2)
  assert.deepEqual(top.map((record) => record.occurredAt), [at(2026, 10, 3), at(2026, 10, 2)])
  assert.equal(records.length, 3, 'input is not mutated')
}

function testDeltaFormatting() {
  assert.deepEqual(formatDelta('reading', 0.03), { text: '+3%', tone: 'up' })
  assert.deepEqual(formatDelta('reading', -0.02), { text: '-2%', tone: 'down' })
  assert.deepEqual(formatDelta('reading', 0.001), { text: '持平', tone: 'flat' })
  assert.deepEqual(formatDelta('writing', 0.5), { text: '+0.5', tone: 'up' })
  assert.deepEqual(formatDelta('writing', null), { text: '', tone: '' })
}

function testDefaultTrendKeyFollowsNewestAttempt() {
  const records = [reading(at(2026, 10, 1), 0.5), writing(at(2026, 10, 5), 6)]
  const series = [{ key: 'reading' }, { key: 'writing' }]
  assert.equal(defaultTrendKey(series, records), 'writing')
  assert.equal(defaultTrendKey([{ key: 'reading' }], records), 'reading')
  assert.equal(defaultTrendKey([], records), '')
}

const tests = [
  testWeekCountWindowIsSevenLocalDays,
  testRecentAverageUsesLastNAndComparesWithPrevious,
  testRecentAverageHandlesEmptyAndUnpairedActivities,
  testStreakEndsTodayOrYesterday,
  testRecentRecordsNewestFirstAndLimited,
  testDeltaFormatting,
  testDefaultTrendKeyFollowsNewestAttempt
]
for (const test of tests) test()
console.log(`dashboardCore: ${tests.length} tests passed`)
