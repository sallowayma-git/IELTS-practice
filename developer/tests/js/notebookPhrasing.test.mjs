import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  BANK,
  LONG_GAP_DAYS,
  RULES,
  dayNumber,
  daysBetween,
  fill,
  keyFor,
  phrase,
  pickIndex,
  placeholdersOf
} from '../../../apps/writing-vue/src/modules/notebook/phrasing.js'

const ISO = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10)
const sweep = (from, count) => Array.from({ length: count }, (_, index) => ISO(dayNumber(from) + index))
const DAY = '2026-10-07'
const EMOJI = /\p{Extended_Pictographic}/u
const HEADING_TYPES = new Set(['title', 'insightTitle', 'weekTitle'])

/** Every (fact type, key, variants) triple in the bank. */
function slots() {
  return Object.entries(BANK).flatMap(([factType, keys]) =>
    Object.entries(keys).map(([key, variants]) => ({ factType, key, variants })))
}

// A fact sheet that fills every placeholder any variant can use.
const EVERYTHING = {
  up: '摘要填空', down: '段落信息配对', criterion: 'GRA', rise: 'TR', name: 'TFNG', zh: '段落信息配对',
  total: 14, correct: 11, pct: 79, basePct: 57, points: 22, assets: 2, repeat: true,
  title: 'A Brief History of Tea', wrong: 3, label: '判断题 · 对照练习', rate: 31, due: 2,
  delta: '半分', band: '6.5', prevBand: '6', count: 2, attempts: 3, minutes: 52, gap: 6,
  improved: ['判断题'], recurring: ['段落信息配对'],
  improvedNames: '判断题', recurringNames: '段落信息配对', type: '判断题'
}

/**
 * The same fields with every rule-selecting flag off, so a scenario chooses its
 * key because of its own facts and not because of a placeholder default.
 */
const NEUTRAL = {
  ...EVERYTHING,
  up: '', down: '', criterion: '', rise: '', repeat: false, wrong: 0, label: '',
  due: 0, count: 0, attempts: 0, minutes: 0, written: 0, feedback: 0, reask: 0,
  quiet: false, notesOnly: false, first: false, longGap: false,
  improved: [], recurring: [], legacy: false, bandUp: false, bandDown: false,
  hasBase: true, trend: '', highError: false, theme: '', kind: '', key: '', reading: false
}

/**
 * One scenario per (fact type, key). The first four fields are the flat sheet
 * phrasing.js reads; the scenarios are deliberately independent of compose.js
 * so a rule change shows up here as a wording change.
 */
const SCENARIOS = [
  ['title', 'quiet', { quiet: true }],
  ['title', 'noted', { notesOnly: true }],
  ['title', 'improved', { improved: ['判断题'] }],
  ['title', 'recurring', { recurring: ['段落信息配对'] }],
  ['title', 'first', { first: true }],
  ['title', 'gap', { longGap: true, gap: 6 }],
  ['title', 'several', { attempts: 2 }],
  ['title', 'single', { attempts: 1 }],
  ['title', 'writing', { written: 1 }],
  ['title', 'reading', { reading: true }],
  // Integration-only fallback: a coach day still needs a heading.
  ['title', 'coach', { feedback: 2 }],
  ['title', 'coach', { reask: 1 }],
  ['insightTitle', 'both', { up: '摘要填空', down: '段落信息配对' }],
  ['insightTitle', 'writingDrop', { criterion: 'GRA' }],
  ['insightTitle', 'readingUp', { up: '摘要填空' }],
  ['insightTitle', 'readingMiss', { down: '段落信息配对' }],
  ['insightTitle', 'writingRise', { rise: 'TR' }],
  ['insightTitle', 'steady', {}],
  ['readingLine', 'repeat', { repeat: true, hasBase: true, trend: 'up' }],
  ['readingLine', 'insufficient', { hasBase: false }],
  ['readingLine', 'down', { trend: 'down', hasBase: true }],
  ['readingLine', 'high', { trend: 'flat', hasBase: true, highError: true }],
  ['readingLine', 'up', { trend: 'up', hasBase: true }],
  ['readingLine', 'flat', { trend: 'flat', hasBase: true }],
  ['topMiss', 'withKind', { zh: '段落信息配对', wrong: 3, total: 5 }],
  ['topMiss', 'plain', { zh: '', wrong: 3, total: 5 }],
  ['writingLine', 'legacy', { legacy: true, band: '6.5' }],
  ['writingLine', 'first', { band: '6.5', prevBand: '' }],
  ['writingLine', 'up', { band: '6.5', prevBand: '6', bandUp: true }],
  ['writingLine', 'down', { band: '6', prevBand: '6.5', bandDown: true }],
  ['writingLine', 'same', { band: '6.5', prevBand: '6.5' }],
  ['criterionLine', 'up', { up: true }],
  ['criterionLine', 'down', { up: false }],
  ['dueLine', 'due', { due: 2 }],
  ['weakLine', 'weak', { label: '判断题', rate: 31 }],
  ['tomorrow', 'missKind', { key: 'missKind' }],
  ['tomorrow', 'writing', { key: 'writing' }],
  ['tomorrow', 'readingDown', { key: 'readingDown' }],
  ['tomorrow', 'due', { key: 'due' }],
  ['tomorrow', 'keep', { key: 'keep' }],
  ['planLink', 'link', { label: '判断题 · 对照练习' }],
  ['opening', 'first', { first: true }],
  ['opening', 'gap', { longGap: true, gap: 6 }],
  ['opening', 'quiet', { quiet: true }],
  ['opening', 'noted', { notesOnly: true }],
  ['attempts', 'single_timed', { attempts: 1, minutes: 30 }],
  ['attempts', 'single', { attempts: 1, minutes: 0 }],
  ['attempts', 'several_timed', { attempts: 3, minutes: 52 }],
  ['attempts', 'several', { attempts: 3, minutes: 0 }],
  ['practice', 'single', { count: 1, label: '判断题 · 对照练习' }],
  ['practice', 'several', { count: 2 }],
  ['weekTitle', 'writing', { theme: 'writing' }],
  ['weekTitle', 'reading', { theme: 'reading' }],
  ['weekTitle', 'general', { theme: 'general' }],
  ['changeLead', 'both', { improved: ['判断题'], recurring: ['段落信息配对'] }],
  ['changeLead', 'improved', { improved: ['判断题'] }],
  ['changeLead', 'recurring', { recurring: ['段落信息配对'] }],
  ...['new', 'reinforced', 'promoted', 'refined', 'improved', 'regressed', 'contradicted', 'superseded', 'other']
    .map((key) => ['note', key, { kind: key === 'new' ? 'new_candidate' : key }]),
  ...['new', 'reinforced', 'promoted', 'refined', 'improved', 'regressed', 'contradicted', 'superseded', 'other']
    .map((key) => ['noteAgain', key, { kind: key === 'new' ? 'created' : key }])
]

/** The sheet a scenario reads, with every rule flag off unless the scenario sets it. */
const sheetOf = (facts) => ({ ...NEUTRAL, ...facts })

test('every bank key has a scenario, and every scenario selects exactly its key', () => {
  const covered = new Set()
  for (const [type, key, facts] of SCENARIOS) {
    assert.equal(keyFor(type, sheetOf(facts)), key, `${type}: ${JSON.stringify(facts)} should select ${key}`)
    covered.add(`${type}.${key}`)
  }
  const declared = Object.entries(BANK).flatMap(([type, keys]) => Object.keys(keys).map((key) => `${type}.${key}`))
  assert.deepEqual([...covered].sort(), declared.sort(), 'a bank key without a scenario is untested')
  assert.deepEqual(Object.keys(RULES).sort(), Object.keys(BANK).sort(), 'every fact type has a rule and a bank')
})

test('every slot has at least six distinct plain variants: no exclamation, emoji, or 今天', () => {
  for (const { factType, key, variants } of slots()) {
    assert.ok(variants.length >= 6, `${factType}.${key} has ${variants.length} variants`)
    assert.equal(new Set(variants).size, variants.length, `${factType}.${key} repeats a variant`)
    for (const text of variants) {
      assert.ok(!text.includes('！'), `${factType}.${key}: ${text}`)
      assert.ok(!EMOJI.test(text), `${factType}.${key}: ${text}`)
      assert.ok(!text.includes('今天'), `${factType}.${key}: ${text}`)
    }
  }
})

test('headings carry no full stop; every other line is a finished sentence', () => {
  for (const { factType, key, variants } of slots()) {
    for (const text of variants) {
      assert.equal(/。$/.test(text), !HEADING_TYPES.has(factType), `${factType}.${key}: ${text}`)
      assert.ok(text.trim() === text && text.length > 0, `${factType}.${key}: blank edge in "${text}"`)
    }
  }
})

test('the day word appears only in the opening bank', () => {
  for (const { factType, variants } of slots()) {
    if (factType === 'opening') continue
    for (const text of variants) assert.ok(!text.includes('这一天'), `${factType}: ${text}`)
  }
})

test('texts are unique across the keys of one fact type, and across note and noteAgain', () => {
  for (const factType of Object.keys(BANK)) {
    if (factType === 'note' || factType === 'noteAgain') continue
    const all = Object.values(BANK[factType]).flat()
    assert.equal(new Set(all).size, all.length, `${factType} repeats a sentence across keys`)
  }
  const notes = [...Object.values(BANK.note).flat(), ...Object.values(BANK.noteAgain).flat()]
  assert.equal(new Set(notes).size, notes.length)
})

test('every placeholder is filled from a full fact sheet, and nothing is left dangling', () => {
  for (const { factType, key, variants } of slots()) {
    for (const template of variants) {
      for (const name of placeholdersOf(template)) {
        assert.ok(name in EVERYTHING, `${factType}.${key} uses unknown {${name}}`)
      }
      const text = fill(template, EVERYTHING)
      assert.ok(text && !/[{}]|undefined|NaN|null/.test(text), `${factType}.${key}: ${template}`)
      assert.ok(!/[，；：、]。|。。/.test(text), `${factType}.${key}: dangling punctuation in "${text}"`)
    }
  }
})

test('a missing fact omits its sentence: no holes, no stray punctuation', () => {
  assert.equal(phrase('topMiss', { title: '', zh: '段落信息配对', wrong: 2, total: 5 }, DAY), '')
  assert.equal(phrase('readingLine', { name: 'TFNG', total: 14, correct: 11, pct: 79, hasBase: true, trend: 'down' }, DAY), '')
  assert.equal(phrase('writingLine', { band: '', prevBand: '6', bandUp: true, count: 1, delta: '半分' }, DAY), '')
  assert.equal(phrase('weakLine', { label: '', rate: 31 }, DAY), '')
  assert.equal(fill('{a} 天', {}), '')
  assert.equal(fill('{a} 天', { a: '' }), '')
  assert.equal(fill('{a} 天', { a: Number.NaN }), '')
  assert.equal(fill('{a} 天', { a: 0 }), '0 天')
})

test('the same date reads the same; a full sweep of days uses every variant of a key', () => {
  for (const { factType, key, variants } of slots()) {
    const facts = sheetOf(sampleFor(factType, key))
    const first = phrase(factType, facts, DAY)
    const again = phrase(factType, facts, DAY)
    assert.equal(first, again)
    const seen = new Set(sweep(DAY, variants.length * 2).map((day) => pickIndex(`${factType}.${key}`, variants.length, day)))
    assert.equal(seen.size, variants.length, `${factType}.${key} does not use every variant`)
  }
})

test('consecutive days never repeat a variant, across months, years and bank sizes', () => {
  for (const size of [6, 7, 8]) {
    for (const start of ['2026-01-25', '2026-10-27', '2027-12-29']) {
      const picks = sweep(start, 400).map((day) => pickIndex(`probe.${size}`, size, day))
      for (let index = 1; index < picks.length; index += 1) {
        assert.notEqual(picks[index], picks[index - 1], `repeat at ${start}+${index} for size ${size}`)
      }
    }
  }
})

test('pick indices are stable, in range, and independent per fact type', () => {
  for (const day of sweep('2026-09-01', 60)) {
    const index = pickIndex('readingLine.up', 6, day)
    assert.ok(index >= 0 && index < 6)
  }
  const moving = sweep('2026-09-01', 30).filter((day) => pickIndex('readingLine.up', 6, day) !== pickIndex('writingLine.up', 6, day))
  assert.ok(moving.length > 0, 'types move in lockstep')
})

test('rule: insightTitle picks the headline the day earns, in priority order', () => {
  assert.equal(keyFor('insightTitle', { up: '判断题', down: '段落信息配对' }), 'both')
  assert.equal(keyFor('insightTitle', { up: '判断题' }), 'readingUp')
  assert.equal(keyFor('insightTitle', { criterion: 'GRA' }), 'writingDrop')
  assert.equal(keyFor('insightTitle', { down: '段落信息配对' }), 'readingMiss')
  assert.equal(keyFor('insightTitle', { rise: 'TR' }), 'writingRise')
  assert.equal(keyFor('insightTitle', {}), 'steady')
})

test('rule: readingLine speaks to the baseline, flags high error, and never over-generalises', () => {
  const row = { name: 'TFNG', total: 14, correct: 11, pct: 79, basePct: 57, hasBase: true, points: 22, missedAssets: 1 }
  assert.equal(keyFor('readingLine', { ...row, trend: 'up' }), 'up')
  assert.equal(keyFor('readingLine', { ...row, trend: 'down', pct: 40 }), 'down')
  assert.equal(keyFor('readingLine', { ...row, trend: 'flat', highError: true, pct: 40 }), 'high')
  assert.equal(keyFor('readingLine', { ...row, trend: 'flat' }), 'flat')
  assert.equal(keyFor('readingLine', { ...row, hasBase: false, trend: 'insufficient' }), 'insufficient')
  // "反复" / "常常" only when the kind was missed across two or more assets.
  assert.equal(keyFor('readingLine', { ...row, highError: true, repeat: false }), 'high')
  assert.equal(keyFor('readingLine', { ...row, repeat: true }), 'repeat')
  const reps = BANK.readingLine.repeat.join('')
  assert.ok(reps.includes('套'), 'repeat wording names the number of sets')
  for (const text of [...BANK.readingLine.insufficient, ...BANK.readingLine.up, ...BANK.readingLine.down, ...BANK.readingLine.flat, ...BANK.readingLine.high]) {
    assert.ok(!/反复|常常/.test(text), `over-generalised: ${text}`)
  }
})

test('numbers: whole percents, percentage points, counts; never decimals or a plus sign', () => {
  const up = phrase('readingLine', { ...EVERYTHING, trend: 'up', hasBase: true, repeat: false }, DAY)
  assert.match(up, /11\/14|11/)
  assert.match(up, /79%/)
  assert.match(up, /百分点|往上走|在变好|进步|高了|提升|有进步/)
  for (const { factType, variants } of slots()) {
    for (const template of variants) {
      const text = fill(template, EVERYTHING)
      if (!text) continue
      assert.ok(!/\d\.\d/.test(text.replace(/Band \d\.\d/g, '')), `${factType}: ${text}`)
      assert.ok(!/[+＋]\s?\d+%/.test(text), `${factType}: ${text}`)
    }
  }
})

test('rule: topMiss names the set and, when known, the kind; no kind leaves the kind out', () => {
  assert.equal(keyFor('topMiss', { title: 'A', zh: '段落信息配对', wrong: 3, total: 5 }), 'withKind')
  assert.equal(keyFor('topMiss', { title: 'A', zh: '', wrong: 3, total: 5 }), 'plain')
  assert.equal(keyFor('topMiss', { title: '', zh: '段落信息配对', wrong: 3, total: 5 }), null)
  assert.equal(keyFor('topMiss', { title: 'A', zh: '段落信息配对', wrong: 0, total: 5 }), null)
  const sentence = phrase('topMiss', { title: 'The return of the black-footed ferret', zh: '段落信息配对', wrong: 3, total: 5 }, DAY)
  assert.match(sentence, /《The return of the black-footed ferret》/)
  assert.match(sentence, /段落信息配对/)
  assert.ok(BANK.topMiss.withKind.some((text) => text.includes('错得最多') && text.includes('主要在{zh}')))
})

test('rule: writing lines read the band against the previous writing day, in half bands', () => {
  assert.equal(keyFor('writingLine', { band: '6.5', prevBand: '6', bandUp: true }), 'up')
  assert.equal(keyFor('writingLine', { band: '6', prevBand: '6.5', bandDown: true }), 'down')
  assert.equal(keyFor('writingLine', { band: '6.5', prevBand: '6.5' }), 'same')
  assert.equal(keyFor('writingLine', { band: '6.5', prevBand: '' }), 'first')
  assert.equal(keyFor('writingLine', { legacy: true, band: '6.5', count: 1 }), 'legacy')
  assert.equal(keyFor('writingLine', { band: '' }), null)
  assert.equal(keyFor('criterionLine', { up: true }), 'up')
  assert.equal(keyFor('criterionLine', { up: false }), 'down')
})

test('rule: tomorrow sentence follows the worst signal', () => {
  assert.equal(keyFor('tomorrow', { key: 'missKind' }), 'missKind')
  assert.equal(keyFor('tomorrow', { key: 'writing' }), 'writing')
  assert.equal(keyFor('tomorrow', {}), null)
  assert.ok(phrase('tomorrow', { key: 'writing', criterion: 'GRA', zh: '语法' }, DAY).includes('GRA（语法）'))
  assert.ok(phrase('tomorrow', { key: 'due', due: 2 }, DAY).includes('2'))
  assert.ok(phrase('tomorrow', { key: 'keep' }, DAY).startsWith('明天只做一件事'))
})

test('rule: the weak-skill and due-review lines say what the learner model holds', () => {
  assert.equal(keyFor('dueLine', { due: 0 }), null)
  assert.equal(keyFor('dueLine', { due: 3 }), 'due')
  assert.equal(keyFor('weakLine', { label: '判断题', rate: 31 }), 'weak')
  assert.ok(phrase('weakLine', { label: '判断题', rate: 31 }, DAY).includes('31%'))
})

test('the legacy title and opening rules still pick their keys, coach heading included', () => {
  assert.equal(keyFor('title', { quiet: true }), 'quiet')
  assert.equal(keyFor('title', { notesOnly: true }), 'noted')
  assert.equal(keyFor('title', { first: true }), 'first')
  assert.equal(keyFor('title', { feedback: 2 }), 'coach')
  assert.equal(keyFor('title', { reask: 1 }), 'coach')
  assert.equal(keyFor('title', {}), null)
  assert.equal(keyFor('opening', { first: true }), 'first')
  assert.equal(keyFor('opening', { longGap: true, gap: 6 }), 'gap')
  assert.equal(keyFor('opening', { quiet: false, notesOnly: false, first: false, longGap: false }), null)
  assert.equal(keyFor('attempts', { attempts: 1, minutes: 0 }), 'single')
  assert.equal(keyFor('practice', { count: 1 }), 'single')
})

test('the gap rule and the day helpers', () => {
  assert.equal(LONG_GAP_DAYS, 5)
  assert.equal(daysBetween('2026-10-01', '2026-10-07'), 6)
  assert.ok(Number.isNaN(daysBetween('garbage', '2026-10-07')))
  assert.equal(pickIndex('x', 1, DAY), 0)
  assert.equal(RULES.weekTitle({ theme: 'writing' }), 'writing')
  assert.equal(RULES.weekTitle({}), null)
})

test('the source has no model call, no network, no host call', () => {
  const source = readFileSync(new URL('../../../apps/writing-vue/src/modules/notebook/phrasing.js', import.meta.url), 'utf8')
  for (const forbidden of ['fetch(', 'invoke', 'import(', 'XMLHttpRequest', 'api/']) {
    assert.ok(!source.includes(forbidden), `phrasing.js mentions ${forbidden}`)
  }
})

/** Facts that make a given key the one that is chosen (used by the stability test). */
function sampleFor(factType, key) {
  return SCENARIOS.find(([type, named]) => type === factType && named === key)?.[2] ?? {}
}
