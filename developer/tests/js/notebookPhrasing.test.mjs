import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ENTRY_LIMIT,
  JOURNAL_WINDOW,
  buildNotebookEntry,
  changes,
  factSheet,
  isPracticed,
  journalWindow,
  previousPracticedDay
} from '../../../apps/writing-vue/src/modules/notebook/compose.js'
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

const DAY = '2026-10-07'
const ISO = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10)
const sweep = (from, count) => Array.from({ length: count }, (_, index) => ISO(dayNumber(from) + index))

const BAND = { completed: 1, degraded: 0, averageBand: 6.5 }
// One scenario per (fact type, condition key): journal facts + context that must select it.
const DAILY_SCENARIOS = [
  ['title', 'quiet', { attemptsCount: 0 }],
  ['title', 'improved', { attemptsCount: 2, skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }] }],
  ['title', 'recurring', { attemptsCount: 2, skillDeltas: [{ skillKey: 'reading.tfng', delta: -0.4, trend: 'recurring' }] }],
  ['title', 'first', { attemptsCount: 2 }, { previousDay: null }],
  ['title', 'gap', { attemptsCount: 2 }, { previousDay: '2026-10-01' }],
  ['title', 'several', { attemptsCount: 2 }],
  ['title', 'single', { attemptsCount: 1 }],
  ['title', 'writing', { writingEvalSummary: BAND }],
  ['title', 'coach', { coachFeedbackCount: 2 }],
  ['title', 'noted', { memoryEvents: [{ memoryId: 'm1', changeKind: 'reinforced' }] }],
  ['opening', 'quiet', { attemptsCount: 0 }],
  ['opening', 'noted', { memoryEvents: [{ memoryId: 'm1', changeKind: 'reinforced' }] }],
  ['opening', 'first', { attemptsCount: 2 }, { previousDay: null }],
  ['opening', 'gap', { attemptsCount: 2 }, { previousDay: '2026-10-01' }],
  ['opening', 'default', { attemptsCount: 2 }, { previousDay: '2026-10-06' }],
  ['attempts', 'single_timed', { attemptsCount: 1, timeSpentMs: 1_800_000 }],
  ['attempts', 'single', { attemptsCount: 1 }],
  ['attempts', 'several_timed', { attemptsCount: 4, timeSpentMs: 3_120_000 }],
  ['attempts', 'several', { attemptsCount: 4 }],
  ['writing', 'band_single', { writingEvalSummary: BAND }],
  ['writing', 'band_several', { writingEvalSummary: { completed: 3, degraded: 0, averageBand: 6.5 } }],
  ['writing', 'single', { writingEvalSummary: { completed: 1, degraded: 0, averageBand: null } }],
  ['writing', 'several', { writingEvalSummary: { completed: 2, degraded: 0, averageBand: null } }],
  ['degraded', 'single', { writingEvalSummary: { completed: 1, degraded: 1, averageBand: 6 } }],
  ['degraded', 'several', { writingEvalSummary: { completed: 3, degraded: 2, averageBand: 6 } }],
  ['coach', 'default', { coachFeedbackCount: 3 }],
  ['reask', 'default', { coachReaskCount: 2 }],
  ['changeLead', 'both', { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'reading.yng', delta: -0.2, trend: 'recurring' }] }],
  ['changeLead', 'improved', { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }] }],
  ['changeLead', 'recurring', { skillDeltas: [{ skillKey: 'reading.tfng', delta: -0.4, trend: 'recurring' }] }]
]

const sheetOf = (facts, context = { previousDay: '2026-10-06' }, day = DAY) => factSheet(facts, changes(facts), day, context)

// Fact types whose sheet is not the daily one.
const SMALL_SCENARIOS = [
  ['note', 'new', { kind: 'new_candidate' }],
  ['note', 'new', { kind: 'created' }],
  ['note', 'reinforced', { kind: 'reinforced' }],
  ['note', 'promoted', { kind: 'promoted' }],
  ['note', 'refined', { kind: 'refined' }],
  ['note', 'improved', { kind: 'improved' }],
  ['note', 'regressed', { kind: 'regressed' }],
  ['note', 'contradicted', { kind: 'contradicted' }],
  ['note', 'superseded', { kind: 'superseded' }],
  ['note', 'other', { kind: 'something_new' }],
  ...Object.entries({ new: 'new_candidate', reinforced: 'reinforced', promoted: 'promoted', refined: 'refined', improved: 'improved', regressed: 'regressed', contradicted: 'contradicted', superseded: 'superseded', other: 'something_new' })
    .map(([key, kind]) => ['noteAgain', key, { kind }])
]

const scenarioSheets = () => [
  ...DAILY_SCENARIOS.map(([type, key, facts, context]) => ({ type, key, sheet: sheetOf(facts, context) })),
  ...SMALL_SCENARIOS.map(([type, key, sheet]) => ({ type, key, sheet }))
]

test('every phrase-bank key is reachable and every scenario selects exactly the key it is named for', () => {
  const covered = new Set()
  for (const { type, key, sheet } of scenarioSheets()) {
    assert.equal(keyFor(type, sheet), key, `${type}: ${JSON.stringify(sheet)} should select ${key}`)
    covered.add(`${type}.${key}`)
  }
  const declared = Object.entries(BANK).flatMap(([type, keys]) => Object.keys(keys).map((key) => `${type}.${key}`))
  assert.deepEqual([...covered].sort(), declared.sort(), 'a bank key without a scenario is untested')
  assert.deepEqual(Object.keys(RULES).sort(), Object.keys(BANK).sort(), 'every fact type has a rule and a bank')
})

test('the bank is 4-6 plain variants per key, with no cheerleading, emoji or exclamation', () => {
  const banned = ['！', '!', '太棒', '加油', '恭喜', '很棒', '优秀', '完美', '%', '…', '先把这一天', '这一天留下的痕迹', '只做了', '练习只有', '不太理想', '分成两头', '向教练请教过', '对教练的讲解给出了', '还差一点火候', '请教教练']
  for (const [type, keys] of Object.entries(BANK)) {
    for (const [key, variants] of Object.entries(keys)) {
      const where = `${type}.${key}`
      assert.ok(variants.length >= 4 && variants.length <= 6, `${where} has ${variants.length} variants`)
      assert.equal(new Set(variants).size, variants.length, `${where} repeats a variant`)
      for (const variant of variants) {
        assert.ok(variant.trim() === variant && variant.length > 0, `${where}: blank edge in "${variant}"`)
        assert.ok(!/\p{Extended_Pictographic}/u.test(variant), `${where}: emoji in "${variant}"`)
        for (const word of banned) assert.ok(!variant.includes(word), `${where}: "${word}" in "${variant}"`)
        // Titles are bare headings; every other line is a finished sentence.
        assert.equal(/[。]$/.test(variant), type !== 'title', `${where}: wrong ending in "${variant}"`)
      }
    }
  }
})

test('every placeholder of every variant is filled from the real fact sheet', () => {
  for (const { type, key, sheet } of scenarioSheets()) {
    for (const variant of BANK[type][key]) {
      const text = fill(variant, sheet)
      assert.ok(text, `${type}.${key} left "${variant}" unfilled for ${JSON.stringify(sheet)}`)
      assert.ok(!/[{}]|undefined|NaN|null/.test(text), `${type}.${key}: stray token in "${text}"`)
      assert.ok(!/[，；：、]。/.test(text) && !/。。/.test(text), `${type}.${key}: dangling punctuation in "${text}"`)
    }
  }
  // A fact that is not there silences the sentence instead of leaving a hole.
  assert.equal(fill('{a} 天', {}), '')
  assert.equal(fill('{a} 天', { a: '' }), '')
  assert.equal(fill('{a} 天', { a: Number.NaN }), '')
  assert.equal(fill('{a} 天', { a: 0 }), '0 天')
})

test('condition keys pick the edge cases: quiet, first page, long gap, single, zero misses', () => {
  const key = (type, facts, context) => keyFor(type, sheetOf(facts, context))
  // Quiet beats first page beats gap; a writing-only day is not a quiet day.
  assert.equal(key('title', { attemptsCount: 0 }, { previousDay: null }), 'quiet')
  assert.equal(key('opening', { attemptsCount: 3 }, { previousDay: null }), 'first')
  assert.equal(key('opening', { attemptsCount: 0, writingEvalSummary: BAND }, { previousDay: '2026-09-01' }), 'gap')
  assert.equal(key('title', { writingEvalSummary: BAND }), 'writing')
  // The gap threshold is data: one day short is an ordinary day.
  const before = (days) => ISO(dayNumber(DAY) - days)
  assert.equal(key('opening', { attemptsCount: 1 }, { previousDay: before(LONG_GAP_DAYS - 1) }), 'default')
  assert.equal(key('opening', { attemptsCount: 1 }, { previousDay: before(LONG_GAP_DAYS) }), 'gap')
  // No context (or an unknown predecessor) means no first-page / gap wording at all.
  assert.equal(key('opening', { attemptsCount: 1 }, {}), 'default')
  assert.equal(key('opening', { attemptsCount: 1 }, { previousDay: undefined }), 'default')
  // Zero misses: nothing recurring means no lead about trouble, only the good half.
  assert.equal(key('changeLead', { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.2, trend: 'improving' }] }), 'improved')
  assert.equal(key('changeLead', { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0, trend: 'steady' }] }), null)
  assert.equal(key('changeLead', {}), null)
  // Singular / plural and timed / untimed.
  assert.equal(key('attempts', { attemptsCount: 1, timeSpentMs: 29_000 }), 'single', 'under half a minute is not a time')
  assert.equal(key('attempts', { attemptsCount: 2, timeSpentMs: 90_000 }), 'several_timed')
  assert.equal(key('writing', { writingEvalSummary: { completed: 1, averageBand: 0 } }), 'single', 'a zero band is no band')
  assert.equal(key('degraded', { writingEvalSummary: { completed: 0, degraded: 1 } }), null)
})

test('the same date reads the same: stable across calls, order and what else was rendered', () => {
  const facts = {
    attemptsCount: 3,
    timeSpentMs: 3_120_000,
    writingEvalSummary: BAND,
    coachFeedbackCount: 2,
    coachReaskCount: 1,
    skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'reading.yng', delta: -0.2, trend: 'recurring' }]
  }
  const render = (day) => JSON.stringify(buildNotebookEntry({ journalDate: day, facts }, new Map(), { previousDay: '2026-10-01' }))
  const once = sweep('2026-10-02', 14).map(render)
  const reversed = sweep('2026-10-02', 14).reverse().map(render).reverse()
  assert.deepEqual(reversed, once)
  assert.deepEqual(sweep('2026-10-02', 14).map(render), once)
})

test('different days vary: a fortnight uses every variant of a key, and whole entries differ', () => {
  for (const { type, key, sheet } of scenarioSheets()) {
    const size = BANK[type][key].length
    const texts = new Set(sweep('2026-10-01', 14).map((day) => phrase(type, { ...sheet, day }, day)))
    assert.equal(texts.size, size, `${type}.${key}: 14 days showed ${texts.size} of ${size} variants`)
  }
  const facts = { attemptsCount: 3, timeSpentMs: 3_120_000, writingEvalSummary: BAND, coachFeedbackCount: 2 }
  const paragraphs = sweep('2026-10-01', 14).map((day) =>
    buildNotebookEntry({ journalDate: day, facts }, new Map(), { previousDay: ISO(dayNumber(day) - 1) }).observations.join(''))
  assert.ok(new Set(paragraphs).size >= 13, `only ${new Set(paragraphs).size} distinct 观察 paragraphs in 14 days`)
})

test('consecutive days never repeat a variant, across months, years and every bank size', () => {
  for (const size of [3, 4, 5, 6, 7, 12]) {
    for (const label of ['title.improved', 'attempts.several_timed']) {
      let previous = -1
      for (const day of sweep('2025-11-20', 800)) {
        const index = pickIndex(label, size, day)
        assert.ok(index >= 0 && index < size)
        assert.notEqual(index, previous, `${label}/${size} repeated on ${day}`)
        previous = index
      }
    }
  }
  // A two-variant list alternates strictly; a single variant is all there is.
  const pair = sweep('2026-01-01', 60).map((day) => pickIndex('x', 2, day))
  pair.slice(1).forEach((index, at) => assert.notEqual(index, pair[at]))
  assert.equal(pickIndex('x', 1, DAY), 0)
  // Every rendered fact type, day after day, with the facts held fixed.
  for (const { type, key, sheet } of scenarioSheets()) {
    let previous = ''
    for (const day of sweep('2026-09-01', 120)) {
      const text = phrase(type, sheet, day)
      assert.notEqual(text, previous, `${type}.${key} repeated verbatim on ${day}`)
      previous = text
    }
  }
})

test('texts are unique across the keys of one fact type, and across note and noteAgain', () => {
  const check = (groups, where) => {
    const owner = new Map()
    for (const [group, keys] of groups) {
      for (const [key, variants] of Object.entries(keys)) {
        for (const variant of variants) {
          assert.ok(!owner.has(variant) || owner.get(variant) === `${group}.${key}`, `${where}: "${variant}" is in ${owner.get(variant)} and ${group}.${key}`)
          owner.set(variant, `${group}.${key}`)
        }
      }
    }
  }
  for (const [type, keys] of Object.entries(BANK)) {
    if (type !== 'note' && type !== 'noteAgain') check([[type, keys]], type)
  }
  check([['note', BANK.note], ['noteAgain', BANK.noteAgain]], 'notes')
})

test('a later note of the same kind carries its own verdict; consecutive days never collide', () => {
  const memory = (id) => ({ id, statement: `记忆 ${id}`, evidenceIds: [] })
  const memories = new Map(['a', 'b', 'c'].map((id) => [id, memory(id)]))
  const facts = () => ({ memoryEvents: [
    { memoryId: 'a', changeKind: 'reinforced' },
    { memoryId: 'b', changeKind: 'reinforced' },
    { memoryId: 'c', changeKind: 'created' }
  ] })
  const notesOn = (day) => buildNotebookEntry({ journalDate: day, facts: facts() }, memories, { previousDay: null }).notes
  for (const day of sweep('2026-10-01', 30)) {
    const [first, second, third] = notesOn(day)
    assert.ok(first.phrase && second.phrase && third.phrase, `${day}: every note carries a verdict`)
    assert.ok(BANK.noteAgain.reinforced.includes(second.phrase), `${day}: the repeat uses noteAgain: ${second.phrase}`)
    assert.notEqual(second.phrase, first.phrase, `${day}: the two notes of one kind do not read alike`)
  }
  for (const kind of ['reinforced', 'created']) {
    let previous = ''
    for (const day of sweep('2026-10-01', 120)) {
      const text = phrase('note', { kind }, day)
      assert.notEqual(text, previous, `${kind} repeated verbatim on ${day}`)
      previous = text
    }
  }
  let previousAgain = ''
  for (const day of sweep('2026-10-01', 120)) {
    const text = phrase('noteAgain', { kind: 'reinforced' }, day)
    assert.notEqual(text, previousAgain, `noteAgain repeated verbatim on ${day}`)
    previousAgain = text
  }
})

test('seeds are independent per fact type: types do not move in lockstep', () => {
  const days = sweep('2026-10-01', 30)
  const a = days.map((day) => pickIndex('attempts.several_timed', 5, day))
  const b = days.map((day) => pickIndex('writing.band_single', 4, day))
  const c = days.map((day) => pickIndex('title.improved', 5, day))
  assert.notDeepEqual(a, c, 'same-sized lists must not share a sequence')
  assert.ok(new Set(b).size === 4)
})

test('numbers and names come through verbatim; nothing is invented', () => {
  for (const day of sweep('2026-10-01', 14)) {
    const entry = buildNotebookEntry({
      journalDate: day,
      facts: {
        attemptsCount: 7,
        timeSpentMs: 7_500_000,
        writingEvalSummary: { completed: 2, degraded: 1, averageBand: 6.5 },
        coachFeedbackCount: 11,
        coachReaskCount: 3,
        skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'reading.yng', delta: -0.1, trend: 'recurring' }, { skillKey: 'reading.short_answer', delta: 0.9, trend: 'improving' }]
      }
    }, new Map(), { previousDay: ISO(dayNumber(day) - 9) })
    const prose = entry.observations.join('')
    assert.deepEqual([...prose.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]).sort(),
      ['11', '125', '2', '3', '6.5', '7', '9', '1'].sort(), `${day}: ${prose}`)
    assert.ok(entry.changeLead.includes('简答题') && entry.changeLead.includes('是非题'), entry.changeLead)
    // Strongest first: 简答题 (0.9) leads the improved list and the title.
    assert.deepEqual(entry.changes.improved, ['简答题', '判断题'])
    assert.ok(entry.title.startsWith('简答题'), entry.title)
  }
  // Averages are shown to one decimal; whole bands carry no ".0".
  const band = (averageBand) => buildNotebookEntry({ journalDate: DAY, facts: { writingEvalSummary: { completed: 2, averageBand } } })
    .observations.join('')
  assert.match(band(6.6666666), /Band 6\.7/)
  assert.match(band(7), /Band 7[^.\d]/)
  assert.match(band(6.5), /Band 6\.5/)
  // The gap is the calendar distance to the previous entry, month ends included.
  assert.equal(daysBetween('2026-09-28', '2026-10-05'), 7)
  const gap = buildNotebookEntry({ journalDate: '2026-10-05', facts: { attemptsCount: 2 } }, new Map(), { previousDay: '2026-09-28' })
  assert.match(`${gap.title}${gap.observations.join('')}`, /7/)
})

test('missing facts omit their sentence: no holes, no dangling punctuation, no stray spaces', () => {
  const bare = buildNotebookEntry({ journalDate: DAY, facts: { attemptsCount: 1 } }, new Map(), { previousDay: '2026-10-06' })
  const prose = bare.observations.join('')
  assert.equal(bare.observations.length, 2, 'an opening line and the attempt, nothing else')
  assert.ok(!/Band|写作|教练|追问/.test(prose), prose)
  assert.equal(bare.changeLead, '')

  // A quiet day still gets one line, so the page is not just a heading.
  const quiet = buildNotebookEntry({ journalDate: DAY, facts: { attemptsCount: 0 } }, new Map(), { previousDay: null })
  assert.equal(quiet.observations.length, 1)
  assert.ok(BANK.opening.quiet.includes(quiet.observations[0]))
  assert.ok(BANK.title.quiet.includes(quiet.title))
  // A malformed day still renders (no seed collapse, no crash).
  const malformed = buildNotebookEntry({ journalDate: '', facts: { attemptsCount: 2 } })
  assert.ok(malformed.title && malformed.observations.length === 2)
})

test('the ASCII skill name is set off from the Chinese around it', () => {
  const entry = buildNotebookEntry({ journalDate: DAY, facts: { attemptsCount: 1, skillDeltas: [{ skillKey: 'writing.new_criterion', delta: 0.5, trend: 'improving' }] } })
  assert.ok(entry.title.includes('「new criterion」'), entry.title)
  assert.deepEqual(entry.changes.improved, ['new criterion'], 'the 变化 rows keep the bare label')
})

test('the gap runs back to the previous practiced day, and unknown history stays unknown', () => {
  const job = (day) => ({ status: 'completed', dedupeKey: `daily_journal:local:${day}` })
  const jobs = [job('2026-10-05'), job('2026-10-01'), job('2026-09-20')]
  const window = journalWindow(jobs)
  assert.deepEqual(window.days, ['2026-10-05', '2026-10-01', '2026-09-20'])
  assert.equal(window.cutOff, false)
  const practiced = new Map([['2026-10-05', true], ['2026-10-01', false], ['2026-09-20', true]])
  // The quiet 10-01 is skipped: 10-05 is measured from 09-20, not from the previous page.
  assert.equal(previousPracticedDay(window.days, 0, practiced, false), '2026-09-20')
  assert.equal(previousPracticedDay(window.days, 2, practiced, false), null, 'the first practiced day has no predecessor')
  // An unread journal in between makes the answer unknown rather than wrong.
  assert.equal(previousPracticedDay(window.days, 0, new Map([['2026-10-05', true], ['2026-10-01', undefined], ['2026-09-20', true]]), false), undefined)
  // The job list is cut at 50: older days may be hidden, so "first" cannot be claimed.
  const full = [...jobs, ...Array.from({ length: 47 }, (_, index) => ({ status: 'failed', dedupeKey: `weekly_dream:local:w${index}` }))]
  const cut = journalWindow(full)
  assert.equal(cut.cutOff, true)
  assert.equal(previousPracticedDay(cut.days, 2, practiced, cut.cutOff), undefined)
  // Beyond the scan window an older day may exist unread: unknown, not first.
  const wide = journalWindow(sweep('2026-09-01', 40).map(job))
  assert.equal(wide.days.length, JOURNAL_WINDOW)
  assert.equal(previousPracticedDay(wide.days, JOURNAL_WINDOW - 1, new Map(wide.days.map((day) => [day, false])), false), undefined)
  assert.equal(journalWindow(null).days.length, 0)
  assert.equal(ENTRY_LIMIT, 14)
})

test('a quiet day in between does not reset the gap; the gap title is number-free', () => {
  const days = ['2026-10-12', '2026-10-10', '2026-10-01']
  const practiced = new Map([['2026-10-12', true], ['2026-10-10', false], ['2026-10-01', true]])
  const previous = previousPracticedDay(days, 0, practiced, false)
  assert.equal(previous, '2026-10-01')
  const entry = buildNotebookEntry({ journalDate: '2026-10-12', facts: { attemptsCount: 2 } }, new Map(), { previousDay: previous })
  assert.match(entry.observations[0], /11 天/, entry.observations[0])
  assert.ok(!/\d/.test(entry.title), entry.title)
})

test('isPracticed: practice facts count, memory events alone do not', () => {
  assert.equal(isPracticed({ facts: { attemptsCount: 0 } }), false)
  assert.equal(isPracticed({ facts: { attemptsCount: 1 } }), true)
  assert.equal(isPracticed({ facts: { attemptsCount: 0, memoryEvents: [{ memoryId: 'x', changeKind: 'reinforced' }] } }), false)
  assert.equal(isPracticed({ facts: { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.2, trend: 'improving' }] } }), true)
  assert.equal(isPracticed(null), false)
})

test('a day with only memory events is titled as a note, not as a quiet or coach day', () => {
  const day = buildNotebookEntry({ journalDate: DAY, facts: { memoryEvents: [{ memoryId: 'm1', changeKind: 'reinforced' }] } }, new Map(), { previousDay: '2026-10-06' })
  assert.ok(BANK.title.noted.includes(day.title), day.title)
  assert.ok(BANK.opening.noted.includes(day.observations[0]), day.observations[0])
})

test('names carry the change lead: skills by name, at most three, ASCII names set off', () => {
  const entry = buildNotebookEntry({ journalDate: DAY, facts: { attemptsCount: 2, skillDeltas: [
    { skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'reading.yng', delta: 0.3, trend: 'improving' }, { skillKey: 'writing.new_criterion', delta: 0.2, trend: 'improving' }, { skillKey: 'reading.short_answer', delta: 0.1, trend: 'improving' },
    { skillKey: 'reading.matching_headings', delta: -0.2, trend: 'recurring' }
  ] } }, new Map(), { previousDay: '2026-10-06' })
  const quote = (label) => (/^[ -~]+$/.test(label) ? `「${label}」` : label)
  const [first, second, third, fourth] = entry.changes.improved.map(quote)
  assert.ok(entry.changeLead.includes(`${first}、${second}、${third}`), entry.changeLead)
  assert.ok(!entry.changeLead.includes(fourth), `only three names: ${entry.changeLead}`)
  assert.ok(entry.changeLead.includes('段落大意配对'), entry.changeLead)
  const recurring = buildNotebookEntry({ journalDate: DAY, facts: { attemptsCount: 2, skillDeltas: [{ skillKey: 'writing.new_criterion', delta: -0.2, trend: 'recurring' }] } }, new Map(), { previousDay: '2026-10-06' })
  assert.ok(recurring.changeLead.includes('「new criterion」'), recurring.changeLead)
  assert.ok(!entry.changeLead.includes('个方面'), 'no counts in the lead')
})

test('the day word appears at most once per entry, and only in the opening line', () => {
  const offending = []
  for (const [type, keys] of Object.entries(BANK)) {
    if (type === 'opening') continue
    for (const [key, variants] of Object.entries(keys)) for (const variant of variants) {
      if (variant.includes('这一天')) offending.push(`${type}.${key}: ${variant}`)
    }
  }
  assert.deepEqual(offending, [], 'only the opening line may say 这一天')
  for (const [key, variants] of Object.entries(BANK.opening)) for (const variant of variants) {
    assert.ok(variant.split('这一天').length - 1 <= 1, `opening.${key}: ${variant}`)
  }
  let checked = 0
  for (let index = 0; index < 60; index += 1) {
    const day = ISO(dayNumber('2026-09-01') + index)
    const facts = {
      attemptsCount: 1 + (index % 4), timeSpentMs: index % 2 ? 0 : 1_500_000,
      writingEvalSummary: { completed: index % 3, degraded: index % 2, averageBand: 6 },
      coachFeedbackCount: index % 3, coachReaskCount: index % 2,
      skillDeltas: [{ skillKey: 'reading.tfng', delta: index % 2 ? 0.3 : -0.3, trend: index % 2 ? 'improving' : 'recurring' }],
      memoryEvents: index % 5 ? [{ memoryId: 'm1', changeKind: 'reinforced' }, { memoryId: 'm1', changeKind: 'reinforced' }] : []
    }
    const memories = new Map([['m1', { id: 'm1', statement: '一条记忆', evidenceIds: [] }]])
    const entry = buildNotebookEntry({ journalDate: day, facts }, memories, { previousDay: index % 4 ? ISO(dayNumber(day) - 2) : null })
    const text = [entry.title, ...entry.observations, entry.changeLead, ...entry.notes.map((note) => `${note.statement}。${note.phrase}`)].join('\n')
    assert.ok(text.split('这一天').length - 1 <= 1, `${day} says 这一天 twice:\n${text}`)
    for (const bannedPhrase of ['只做了', '练习只有', '不太理想', '分成两头', '向教练请教过', '对教练的讲解给出了']) {
      assert.ok(!text.includes(bannedPhrase), `${day}: "${bannedPhrase}"`)
    }
    checked += 1
  }
  assert.equal(checked, 60)
})

test('there is no model in this path: no network, no host calls, no API imports', () => {
  const calls = []
  const trap = (name) => (...args) => { calls.push([name, args]); throw new Error(`${name} must not be called`) }
  const traps = {
    fetch: trap('fetch'),
    XMLHttpRequest: trap('XMLHttpRequest'),
    WebSocket: trap('WebSocket'),
    __TAURI__: { core: { invoke: trap('invoke') } },
    __TAURI_INTERNALS__: { invoke: trap('invoke') }
  }
  const saved = Object.keys(traps).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  for (const [name, value] of Object.entries(traps)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  try {
    for (const day of sweep('2026-10-01', 14)) {
      buildNotebookEntry({ journalDate: day, facts: { attemptsCount: 3, writingEvalSummary: BAND, coachFeedbackCount: 1 } }, new Map(), { previousDay: null })
    }
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  assert.deepEqual(calls, [])

  for (const file of ['phrasing.js', 'compose.js']) {
    const source = readFileSync(new URL(`../../../apps/writing-vue/src/modules/notebook/${file}`, import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1])
    for (const specifier of specifiers) {
      assert.ok(/^\.\/phrasing\.js$|^\.\.\/agent-console\/format\.js$/.test(specifier), `${file} imports ${specifier}`)
    }
    assert.ok(!/\bfetch\s*\(|\binvoke\w*\s*\(|\bMath\.random\b|\bDate\.now\b|new Date\(\)/.test(source), `${file} reaches outside its inputs`)
  }
})
test('no bank text says 今天: entries are often historical, so the day is named 这一天 or 当天', () => {
  for (const [type, keys] of Object.entries(BANK)) {
    for (const [key, variants] of Object.entries(keys)) {
      for (const variant of variants) assert.ok(!variant.includes('今天'), `${type}.${key}: ${variant}`)
    }
  }
})

test('noteAgain lines stand alone: they never point back at an earlier note', () => {
  const pointers = ['另一', '又一', '又记下', '在别处', '同一点', '同样的一点', '也出现在']
  for (const [key, variants] of Object.entries(BANK.noteAgain)) {
    for (const variant of variants) {
      for (const pointer of pointers) assert.ok(!variant.includes(pointer), `noteAgain.${key}: "${pointer}" in ${variant}`)
      assert.ok(variant.startsWith('这一条'), `noteAgain.${key}: ${variant}`)
    }
  }
})

test('an all-ASCII skill list is set off once, not per name', () => {
  const facts = { attemptsCount: 2, skillDeltas: [
    { skillKey: 'writing.new_criterion', delta: 0.4, trend: 'improving' }, { skillKey: 'writing.task1', delta: 0.3, trend: 'improving' }
  ] }
  const sheet = factSheet(facts, changes(facts), DAY)
  assert.equal(sheet.improvedNames, '「' + changes(facts).improved.join('、') + '」', sheet.improvedNames)
  const mixed = factSheet({ attemptsCount: 2, skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'writing.new_criterion', delta: 0.3, trend: 'improving' }] }, changes({ skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' }, { skillKey: 'writing.new_criterion', delta: 0.3, trend: 'improving' }] }), DAY)
  assert.equal(mixed.improvedNames.split('「').length - 1, 1, 'a mixed list brackets only its ASCII name')
})
