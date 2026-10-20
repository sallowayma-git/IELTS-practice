#!/usr/bin/env node
/** Mascot mood tables: run with `node developer/tests/js/moodFor.test.js`. */
import assert from 'node:assert/strict'
import { dayMood, emptyMood, moodLabel, trendMood } from '../../../apps/writing-vue/src/components/mascot/moodFor.js'

// emptyMood: every kind, plus the fallback.
assert.equal(emptyMood('empty'), 'calm')
assert.equal(emptyMood('no-results'), 'confused')
assert.equal(emptyMood('error'), 'hurt')
assert.equal(emptyMood('unknown'), 'calm')

// trendMood: no data wins over everything.
assert.equal(trendMood({ delta: { reading: 0.5, writing: 2 }, streak: 30, count: 0 }), 'calm')
// Streak of 7+ days.
assert.equal(trendMood({ delta: { reading: -0.5, writing: -2 }, streak: 7, count: 3 }), 'energized')
assert.equal(trendMood({ streak: 6, count: 3 }), 'calm')
// Improvement only.
assert.equal(trendMood({ delta: { reading: 0.03, writing: null }, streak: 1, count: 3 }), 'excited')
assert.equal(trendMood({ delta: { reading: null, writing: 0.3 }, streak: 1, count: 3 }), 'excited')
// Threshold edges: reading must exceed 2 points, writing must reach 0.3.
assert.equal(trendMood({ delta: { reading: 0.02, writing: 0.2 }, count: 1 }), 'calm')
// Decline only.
assert.equal(trendMood({ delta: { reading: -0.03, writing: null }, count: 1 }), 'tired')
assert.equal(trendMood({ delta: { reading: null, writing: -0.3 }, count: 1 }), 'tired')
// Mixed signals.
assert.equal(trendMood({ delta: { reading: 0.1, writing: -0.4 }, count: 1 }), 'focused')
// Neither moved (flat or no comparison).
assert.equal(trendMood({ delta: { reading: 0, writing: 0 }, count: 1 }), 'calm')
assert.equal(trendMood({ delta: { reading: null, writing: null }, count: 1 }), 'calm')
assert.equal(trendMood({ count: 1 }), 'calm')

// dayMood: real comparisons only; never stressed, hurt or tired.
const day = (mood) => ({ mood })
assert.equal(dayMood(day({ up: 0, down: 0, light: false, streak: 0 })), 'calm', 'no comparison is calm')
assert.equal(dayMood(day({ up: 3, down: 0, light: true, streak: 9 })), 'calm', 'a light day is calm')
assert.equal(dayMood(day({ up: 1, down: 0, light: false, streak: 0 })), 'joyful')
assert.equal(dayMood(day({ up: 2, down: 0, light: false, streak: 0 })), 'proud')
assert.equal(dayMood(day({ up: 1, down: 1, light: false, streak: 0 })), 'focused', 'mixed is focused')
assert.equal(dayMood(day({ up: 0, down: 2, light: false, streak: 0 })), 'focused', 'regressions are focused, not stressed')
assert.equal(dayMood(day({ up: 2, down: 0, light: false, streak: 7 })), 'energized', 'long streak with improvements')
assert.equal(dayMood(day({ up: 2, down: 1, light: false, streak: 7 })), 'focused', 'a regression beats the streak')
assert.equal(dayMood(day({ up: 1, down: 0, light: false, streak: 6 })), 'joyful')
assert.equal(dayMood({}), 'calm')
assert.equal(dayMood(null), 'calm')

assert.equal(moodLabel('excited'), '进步中')
assert.equal(moodLabel('joyful'), '开心')
assert.equal(moodLabel('proud'), '有成绩')
assert.equal(moodLabel('nope'), '')

console.log('moodFor tests passed')
