import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ENTRY_LIMIT,
  JOURNAL_WINDOW,
  buildNotebookEntry,
  factSheet,
  formatEntryDate,
  isPracticed,
  journalDaysFromJobs,
  journalWindow,
  nextPractice,
  practiceLead,
  previousPracticedDay,
  rememberedSentences,
  streakLength,
  weekdayName
} from '../../../apps/writing-vue/src/modules/notebook/compose.js'
import {
  BANK,
  fill
} from '../../../apps/writing-vue/src/modules/notebook/phrasing.js'
import {
  changedNames,
  deltaWords,
  formatBand,
  halfBand,
  headlineFacts,
  kindOf,
  lineRows,
  MIN_KIND_QUESTIONS,
  modelView,
  moodSignals,
  percentOf,
  readingRows,
  shortSkill,
  tomorrowView,
  writingView
} from '../../../apps/writing-vue/src/modules/notebook/insight.js'
import { dayMood } from '../../../apps/writing-vue/src/components/mascot/moodFor.js'

// ----- v2 days: a richer host that reports per-kind baselines and a writing report
const UP_DAY = {
  journalDate: '2026-10-18',
  facts: {
    attemptsCount: 3,
    timeSpentMs: 52 * 60_000,
    writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.6 },
    readingByKind: [
      { kind: 'tfng', todayCorrect: 11, todayTotal: 14, baselineCorrect: 8, baselineTotal: 14, trend: 'up' },
      { kind: 'matching_information', todayCorrect: 3, todayTotal: 5, baselineCorrect: 2, baselineTotal: 6, trend: 'flat' },
      { kind: 'summary_completion', todayCorrect: 4, todayTotal: 4, baselineCorrect: 3, baselineTotal: 5, trend: 'up' }
    ],
    topMiss: { assetId: 'p1-high-01', assetTitle: 'A Brief History of Tea', questionKind: 'matching_information', wrong: 2, total: 5 },
    topMissKind: { kind: 'matching_information', wrong: 2, total: 5 },
    writing: {
      count: 1,
      averageBand: 6.6,
      previousDay: '2026-10-15',
      previousAverageBand: 6.0,
      bandDelta: 0.5,
      criteria: [{ key: 'TR', today: 6.5, previous: 6, delta: 0.5 }, { key: 'GRA', today: 6, previous: 6.5, delta: -0.5 }, { key: 'LR', today: 6, previous: 6, delta: 0 }]
    },
    skillStates: [{ skillKey: 'reading.summary_completion', masteryMean: 0.5, recentErrorRate: 0.31, nextReviewAt: '2026-10-20T00:00:00Z' }],
    dueReviewCount: 2,
    assetQuestionKinds: { 'p1-high-01': ['heading_match', 'matching'] },
    memoryEvents: []
  }
}

const DOWN_DAY = {
  journalDate: '2026-10-19',
  facts: {
    attemptsCount: 2,
    timeSpentMs: 30 * 60_000,
    readingByKind: [
      { kind: 'tfng', todayCorrect: 6, todayTotal: 12, baselineCorrect: 9, baselineTotal: 14, trend: 'down' },
      { kind: 'single_choice', todayCorrect: 4, todayTotal: 5, baselineCorrect: 4, baselineTotal: 6, trend: 'flat' }
    ],
    topMiss: { assetId: 'p2-high-235', assetTitle: 'The return of the black-footed ferret', questionKind: 'matching_information', wrong: 3, total: 5 },
    topMissKind: { kind: 'matching_information', wrong: 3, total: 5 },
    writing: { count: 1, averageBand: 6.0, previousDay: '2026-10-16', previousAverageBand: 6.5, bandDelta: -0.5, criteria: [{ key: 'GRA', today: 6, previous: 6.5, delta: -0.5 }] },
    skillStates: [{ skillKey: 'reading.matching_information', recentErrorRate: 0.42 }],
    dueReviewCount: 0,
    memoryEvents: []
  }
}

const PLAN = [{ id: 'a', skillKey: 'reading.matching_information', label: '段落信息配对 · 对照练习', why: '', minutes: 15 }]

const titlesIn = (bank, facts) => bank.map((text) => fill(text, facts))

test('only finished journal/dream days are read, newest first, deduplicated (fallback path)', () => {
  const days = journalDaysFromJobs([
    { status: 'completed', dedupeKey: 'daily_journal:local:2026-09-30' },
    { status: 'completed', dedupeKey: 'daily_dream:local:2026-10-02' },
    { status: 'completed', dedupe_key: 'daily_journal:local:2026-10-02' },
    { status: 'running', dedupeKey: 'daily_journal:local:2026-10-03' },
    { status: 'completed', dedupeKey: 'daily_journal:other:2026-10-01' },
    { status: 'completed', dedupeKey: 'weekly_dream:local:2026-10-01' }
  ])
  assert.deepEqual(days, ['2026-10-02', '2026-09-30'])
  assert.deepEqual(journalDaysFromJobs(null), [])
})

test('the journal window says when its answer may be cut off', () => {
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
  const ISO = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10)
  const sweep = Array.from({ length: 40 }, (_, index) => ISO(Date.UTC(2026, 8, 1) / 86_400_000 + index)).map(job)
  const wide = journalWindow(sweep)
  assert.equal(wide.days.length, JOURNAL_WINDOW)
  assert.equal(previousPracticedDay(wide.days, JOURNAL_WINDOW - 1, new Map(wide.days.map((day) => [day, false])), false), undefined)
  assert.equal(journalWindow(null).days.length, 0)
  assert.equal(ENTRY_LIMIT, 14)
})

test('v1 day: host-classified reading and writing deltas become the headline and the change rows', () => {
  const memories = new Map([['mem-1', { id: 'mem-1', statement: '判断题常把未提及判为错误。', evidenceIds: ['obs-1'] }]])
  const entry = buildNotebookEntry({
    journalDate: '2026-10-02',
    facts: {
      attemptsCount: 3,
      timeSpentMs: 3_120_000,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [
        { skillKey: 'reading.tfng', delta: 0.4123, evidenceCount: 2, trend: 'improving' },
        { skillKey: 'reading.matching_headings', delta: 0, evidenceCount: 1, trend: 'recurring' },
        { skillKey: 'reading.summary_completion', delta: -0.2, trend: 'steady' },
        { skillKey: 'writing.taskResponse', delta: 0.5, trend: 'improving' }
      ],
      memoryChanges: { newCandidates: 4 },
      memoryEvents: [
        { memoryId: 'mem-1', changeKind: 'reinforced', evidenceObservationIds: ['obs-1'] },
        { memoryId: 'candidate-not-active', changeKind: 'new_candidate' }
      ],
      sourceHash: 'deadbeef'
    }
  }, memories)
  assert.equal(entry.day, '2026-10-02')
  assert.equal(entry.dateLabel, '2026年10月2日 · 星期五')
  assert.ok(titlesIn(BANK.insightTitle.both, { up: '判断题', down: '段落大意配对' }).includes(entry.title), entry.title)
  assert.deepEqual(entry.changes, { improved: ['任务回应', '判断题'], recurring: ['段落大意配对'] })
  assert.ok(entry.changeLead.includes('任务回应') && entry.changeLead.includes('判断题') && entry.changeLead.includes('段落大意配对'), entry.changeLead)
  assert.equal(entry.reading.lines.length, 0, 'v1 deltas carry no question counts, so no reading lines')
  assert.equal(entry.reading.topMiss, '')
  assert.match(entry.writing.lines[0], /Band 6\.5/)
  assert.match(entry.observations.join(''), /52 分钟/)
  assert.equal(entry.notes.length, 1, 'inactive candidates stay invisible')
  assert.equal(entry.notes[0].statement, '判断题常把未提及判为错误')
  assert.deepEqual(entry.mood, { up: 2, down: 1, light: false, streak: 0 })
  assert.equal(dayMood(entry), 'focused')
  assert.deepEqual(entry.assetKinds, {})
  const prose = JSON.stringify(entry)
  for (const forbidden of ['0.41', 'deadbeef', 'candidate', '新候选', '4 ', '逐句']) {
    assert.ok(!prose.includes(forbidden), `entry leaks ${forbidden}`)
  }
  // The page still receives the fields it reads today.
  assert.ok(Array.isArray(entry.observations) && Array.isArray(entry.notes))
  assert.equal(typeof entry.changeLead, 'string')
  assert.equal(typeof entry.title, 'string')
})

test('v1 writing-only deltas are not lost: they count as practice and still earn a change lead', () => {
  const entry = buildNotebookEntry({
    journalDate: '2026-10-02',
    facts: { skillDeltas: [
      { skillKey: 'writing.taskResponse', delta: 0.5, trend: 'improving' },
      { skillKey: 'writing.coherence', delta: 0.3, trend: 'improving' }
    ] }
  })
  assert.deepEqual(entry.changes, { improved: ['任务回应', '连贯与衔接'], recurring: [] })
  assert.ok(titlesIn(BANK.title.improved, { type: '任务回应' }).includes(entry.title), entry.title)
  assert.ok(entry.changeLead.includes('任务回应') && entry.changeLead.includes('连贯与衔接'), entry.changeLead)
  assert.equal(isPracticed({ facts: { skillDeltas: [{ skillKey: 'writing.taskResponse', delta: 0.5, trend: 'improving' }] } }), true)
})

test('legacy journals: a raw delta without a host trend is never read as a change', () => {
  const entry = buildNotebookEntry({
    journalDate: '2026-10-01',
    facts: { attemptsCount: 1, skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.8, evidenceCount: 2 }] }
  })
  assert.deepEqual(entry.changes, { improved: [], recurring: [] })
  assert.equal(entry.changeLead, '')
  assert.equal(entry.reading.lines.length, 0)
  assert.ok(!titlesIn(BANK.insightTitle.readingUp, { up: '判断题' }).includes(entry.title), entry.title)
  // A day whose only fact is an unclassified delta has no practice to report.
  const deltaOnly = buildNotebookEntry({ journalDate: '2026-10-01', facts: { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.8 }] } })
  assert.ok(BANK.title.quiet.includes(deltaOnly.title), deltaOnly.title)
  assert.equal(isPracticed({ facts: { skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.8 }] } }), false)
})

test('writing averages are shown in half bands; a zero average is no band at all', () => {
  const text = (averageBand) => buildNotebookEntry({ journalDate: '2026-10-02', facts: { writingEvalSummary: { completed: 1, averageBand } } }).writing.lines.join('')
  assert.match(text(6.6666666), /Band 6\.5/, 'an average is never shown with more precision than a half band')
  assert.ok(!text(6.6666666).includes('6.7'))
  assert.match(text(7), /Band 7[^.\d]/)
  assert.match(text(6.5), /Band 6\.5/)
  const zero = buildNotebookEntry({ journalDate: '2026-10-02', facts: { writingEvalSummary: { completed: 1, averageBand: 0 } } })
  assert.deepEqual(zero.writing.lines, [], 'Band 0 is not a score')
  assert.ok(!JSON.stringify(zero).includes('Band 0'))
  assert.equal(halfBand(6.66), 6.5)
  assert.equal(formatBand(7), '7')
  assert.equal(formatBand(6.5), '6.5')
  assert.equal(deltaWords(1.5), '一分半')
  assert.equal(percentOf(2, 3), 67)
})

test('every fact shape the host can send still yields a titled, page-safe entry', () => {
  const shapes = [
    {},
    { attemptsCount: 1 },
    { writingEvalSummary: { completed: 1, averageBand: 6 } },
    { writing: { count: 1, averageBand: 6 } },
    { coachFeedbackCount: 1 },
    { coachReaskCount: 1 },
    { readingByKind: [{ kind: 'tfng', todayCorrect: 2, todayTotal: 4 }] },
    { skillDeltas: [{ skillKey: 'writing.taskResponse', delta: 0.4, trend: 'improving' }] },
    { memoryEvents: [{ memoryId: 'm1', changeKind: 'reinforced' }] }
  ]
  for (const facts of shapes) {
    const entry = buildNotebookEntry({ journalDate: '2026-10-02', facts })
    assert.ok(entry && entry.title.length > 0, JSON.stringify(facts))
    assert.equal(entry.day, '2026-10-02')
    assert.equal(entry.dateLabel, '2026年10月2日 · 星期五')
    assert.ok(Array.isArray(entry.observations) && Array.isArray(entry.notes))
    assert.ok(Array.isArray(entry.changes.improved) && Array.isArray(entry.changes.recurring))
    assert.equal(typeof entry.changeLead, 'string')
    assert.ok(Array.isArray(entry.summaryLines))
  }
})

test('quiet day: no practice, no comparison, no tomorrow sentence; the entry is still dated', () => {
  const quiet = buildNotebookEntry({ journalDate: '2026-10-01', facts: { attemptsCount: 0, memoryEvents: [] } })
  assert.ok(BANK.title.quiet.includes(quiet.title), quiet.title)
  assert.ok(BANK.opening.quiet.includes(quiet.observations[0]), quiet.observations[0])
  assert.equal(quiet.tomorrow.line, '')
  assert.equal(quiet.tomorrow.link, '')
  assert.equal(quiet.reading.lines.length, 0)
  assert.deepEqual(quiet.changes, { improved: [], recurring: [] })
  assert.deepEqual(quiet.summaryLines, quiet.observations.slice(0, 2))
  assert.equal(dayMood(quiet), 'calm')
  assert.equal(buildNotebookEntry({ journalDate: '2026-10-01' }), null)
})

test('a coach-only v1 day still has a heading, but no feedback bookkeeping', () => {
  const entry = buildNotebookEntry({ journalDate: '2026-10-02', facts: { coachFeedbackCount: 2, coachReaskCount: 1 } })
  assert.ok(BANK.title.coach.includes(entry.title), entry.title)
  assert.deepEqual(entry.observations, [])
  assert.deepEqual(entry.changes, { improved: [], recurring: [] })
  assert.deepEqual(entry.notes, [])
  assert.ok(!/2 次|1 次|反馈 2|追问 1/.test(JSON.stringify(entry)), JSON.stringify(entry))
})

test('a day with only memory events is titled as a note, not as a quiet or coach day', () => {
  const day = buildNotebookEntry({ journalDate: '2026-10-07', facts: { memoryEvents: [{ memoryId: 'm1', changeKind: 'reinforced' }] } }, new Map(), { previousDay: '2026-10-06' })
  assert.ok(BANK.title.noted.includes(day.title), day.title)
  assert.ok(BANK.opening.noted.includes(day.observations[0]), day.observations[0])
  assert.deepEqual(day.changes, { improved: [], recurring: [] })
})

test('up day: the headline names the gain, reading lines carry the baseline, writing is in half bands', () => {
  const entry = buildNotebookEntry(UP_DAY, new Map(), { plan: PLAN, previousDay: '2026-10-17', streak: 1 })
  assert.ok(titlesIn(BANK.insightTitle.readingUp, { up: '摘要填空' }).includes(entry.title), entry.title)
  assert.equal(entry.reading.lines.length, 3)
  assert.match(entry.reading.lines[0].text, /TFNG|11\/14|79%/)
  assert.match(entry.reading.topMiss, /《A Brief History of Tea》/)
  assert.match(entry.reading.topMiss, /段落信息配对/)
  assert.match(entry.writing.lines.join(''), /Band 6\.5/, 'the average is shown in half bands')
  assert.ok(!entry.writing.lines.join('').includes('6.6'))
  assert.match(entry.writing.lines.join(''), /半分/)
  assert.match(entry.writing.lines.join(''), /TR（任务回应）/)
  assert.match(entry.writing.lines.join(''), /GRA（语法）/)
  assert.match(entry.model.lines.join(''), /2 个/)
  assert.match(entry.model.lines.join(''), /31%/)
  assert.match(entry.tomorrow.line, /练段落信息配对|段落信息配对/)
  assert.match(entry.tomorrow.link, /段落信息配对 · 对照练习/)
  assert.equal(entry.summaryLines.length, 3)
  assert.deepEqual(entry.changes, { improved: ['判断题', '摘要填空', 'TR'], recurring: ['GRA'] })
  // Up on reading and writing with one regression (GRA) is mixed: focused.
  assert.deepEqual(entry.mood, { up: 3, down: 1, light: false, streak: 1 })
  assert.equal(dayMood(entry), 'focused')
  assert.deepEqual(entry.assetKinds, { 'p1-high-01': ['heading_match', 'matching'] })
  assert.match(entry.observations.join(''), /52 分钟/)
})

test('down day: the writing drop leads, the top-missed set is named, tomorrow targets the missed kind', () => {
  const entry = buildNotebookEntry(DOWN_DAY, new Map(), { plan: PLAN })
  assert.ok(titlesIn(BANK.insightTitle.writingDrop, { criterion: 'GRA' }).includes(entry.title), entry.title)
  assert.match(entry.reading.topMiss, /《The return of the black-footed ferret》/)
  assert.match(entry.reading.topMiss, /段落信息配对/)
  assert.match(entry.reading.lines[0].text, /50%/)
  assert.match(entry.tomorrow.line, /段落信息配对/)
  assert.equal(entry.mood.down >= 2, true)
  assert.equal(dayMood(entry), 'focused', 'a regression is focused, never stressed')
})

test('nothing in a v2 entry says stressed, hurt or tired; no decimal accuracy, no plus sign, no coach bookkeeping', () => {
  for (const journal of [UP_DAY, DOWN_DAY]) {
    const entry = buildNotebookEntry(journal, new Map(), { plan: PLAN })
    const text = JSON.stringify(entry)
    assert.ok(!/\+\d/.test(text), 'no plus-signed numbers')
    assert.ok(!/\d\.\d+%/.test(text), 'no decimal percentages')
    assert.ok(!/教练|反馈|追问/.test(text), 'no coach bookkeeping')
    assert.ok(!['stressed', 'hurt', 'tired'].includes(dayMood(entry)))
  }
})

test('light day: under five answers and no writing is calm, however the numbers look', () => {
  const light = buildNotebookEntry({
    journalDate: '2026-10-14',
    facts: {
      attemptsCount: 1,
      readingByKind: [{ kind: 'tfng', todayCorrect: 3, todayTotal: 3, baselineCorrect: 6, baselineTotal: 10, trend: 'up' }],
      memoryEvents: []
    }
  }, new Map(), { streak: 9 })
  assert.equal(light.mood.light, true)
  assert.equal(dayMood(light), 'calm')
})

test('a day with comparisons only one way: proud for two gains, joyful for one, energized on a streak', () => {
  const proud = buildNotebookEntry({
    journalDate: '2026-10-13',
    facts: {
      readingByKind: [
        { kind: 'tfng', todayCorrect: 10, todayTotal: 12, baselineCorrect: 6, baselineTotal: 12, trend: 'up' },
        { kind: 'single_choice', todayCorrect: 8, todayTotal: 9, baselineCorrect: 5, baselineTotal: 10, trend: 'up' }
      ],
      memoryEvents: []
    }
  }, new Map(), { streak: 2 })
  assert.equal(dayMood(proud), 'proud')
  const joyful = buildNotebookEntry({
    journalDate: '2026-10-13',
    facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 10, todayTotal: 12, baselineCorrect: 6, baselineTotal: 12, trend: 'up' }], memoryEvents: [] }
  }, new Map(), { streak: 2 })
  assert.equal(dayMood(joyful), 'joyful')
  assert.equal(dayMood({ ...joyful, mood: { ...joyful.mood, streak: 7 } }), 'energized')
})

test('insufficient baselines say nothing comparative; the line still states the numbers', () => {
  const entry = buildNotebookEntry({
    journalDate: '2026-10-12',
    facts: {
      readingByKind: [{ kind: 'matching_headings', todayCorrect: 2, todayTotal: 4, baselineCorrect: 0, baselineTotal: 0, trend: 'insufficient' }],
      memoryEvents: []
    }
  })
  assert.match(entry.reading.lines[0].text, /段落大意配对/)
  assert.match(entry.reading.lines[0].text, /2\/4|对了 2|4 题/)
  assert.ok(!/这周此前|百分点/.test(entry.reading.lines[0].text))
  assert.equal(dayMood(entry), 'calm')
})

test('a baseline without a host trend never becomes a "steady" headline', () => {
  const unclassified = buildNotebookEntry({
    journalDate: '2026-10-12',
    facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 8, todayTotal: 10, baselineCorrect: 8, baselineTotal: 10 }] }
  })
  assert.ok(BANK.title.reading.includes(unclassified.title), unclassified.title)
  assert.ok(!BANK.insightTitle.steady.map((text) => fill(text, {})).includes(unclassified.title), unclassified.title)
  const flat = buildNotebookEntry({
    journalDate: '2026-10-12',
    facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 8, todayTotal: 10, baselineCorrect: 8, baselineTotal: 10, trend: 'flat' }] }
  })
  assert.ok(BANK.insightTitle.steady.map((text) => fill(text, {})).includes(flat.title), flat.title)
})

test('over-generalisation: 反复 / 常常 only when the kind was missed across two or more assets', () => {
  const single = buildNotebookEntry({
    journalDate: '2026-10-12',
    facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 1, todayTotal: 5, baselineCorrect: 3, baselineTotal: 10, trend: 'flat' }], memoryEvents: [] }
  })
  assert.ok(!/反复|常常/.test(JSON.stringify(single.reading)))
  const repeated = buildNotebookEntry({
    journalDate: '2026-10-12',
    facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 1, todayTotal: 5, baselineCorrect: 3, baselineTotal: 10, trend: 'flat', missedAssetCount: 3 }], memoryEvents: [] }
  })
  assert.match(repeated.reading.lines[0].text, /3 套/)
})

test('a v1 host (no v2 fields) still gets a title, a writing line and a plan, without errors', () => {
  const entry = buildNotebookEntry({
    journalDate: '2026-10-02',
    facts: {
      attemptsCount: 3,
      timeSpentMs: 3_120_000,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4123 }, { skillKey: 'reading.matching_headings', delta: -0.3 }],
      memoryEvents: []
    }
  }, new Map(), { plan: PLAN })
  assert.ok(entry.title.length > 0)
  assert.equal(entry.reading.lines.length, 0, 'no question counts, so no lines to word')
  assert.match(entry.writing.lines[0], /Band 6\.5/)
  assert.ok(entry.observations.length > 0)
  assert.equal(typeof entry.assetKinds, 'object')
  assert.equal(entry.tomorrow.line.startsWith('明天只做一件事'), true)
})

test('v1 skill keys use the app-wide labels, and host trends are read as they are', () => {
  const rows = readingRows({ skillDeltas: [
    { skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' },
    { skillKey: 'reading.matching_headings', delta: -0.3, trend: 'recurring' },
    { skillKey: 'reading.summary_completion', delta: 0.2, trend: 'steady' },
    { skillKey: 'reading.short_answer', delta: 0.1 }
  ] })
  assert.deepEqual(rows.map((row) => [row.zh, row.trend]), [
    ['判断题', 'up'],
    ['段落大意配对', 'down'],
    ['摘要填空', 'flat'],
    ['简答题', 'insufficient']
  ])
  assert.deepEqual(rows.map((row) => row.total), [0, 0, 0, 0])
  assert.equal(lineRows(rows).length, 0)
  const entry = buildNotebookEntry({ journalDate: '2026-10-02', facts: { skillDeltas: [
    { skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' },
    { skillKey: 'reading.yng', delta: -0.3, trend: 'insufficient' }
  ] } })
  assert.ok(titlesIn(BANK.insightTitle.readingUp, { up: '判断题' }).includes(entry.title), entry.title)
})

test('snake_case v2 facts read the same as camelCase ones', () => {
  const entry = buildNotebookEntry({
    journal_date: '2026-10-20',
    facts: {
      attempts_count: 2,
      time_spent_ms: 1_800_000,
      reading_by_kind: [
        { kind: 'tfng', today_correct: 10, today_total: 12, baseline_correct: 6, baseline_total: 12, trend: 'up' }
      ],
      top_miss: { asset_title: 'Tea', question_kind: 'tfng', wrong: 2, total: 4 },
      top_miss_kind: 'tfng',
      writing: {
        count: 1,
        average_band: 6.5,
        previous_average_band: 6,
        band_delta: 0.5,
        criteria: [{ key: 'TR', delta: 0.5 }]
      },
      due_review_count: 1,
      skill_states: [{ skill_key: 'reading.tfng', recent_error_rate: 0.4 }],
      asset_question_kinds: { a: ['tfng'] },
      memory_events: []
    }
  })
  assert.equal(entry.day, '2026-10-20')
  assert.match(entry.reading.lines[0].text, /TFNG|10\/12|83%/)
  assert.match(entry.reading.topMiss, /Tea/)
  assert.match(entry.writing.lines.join(''), /Band 6\.5/)
  assert.match(entry.model.lines.join(''), /1 个/)
  assert.match(entry.model.lines.join(''), /判断题/)
  assert.deepEqual(entry.assetKinds, { a: ['tfng'] })
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

test('memories are active plain sentences; plan shows open items only, with the skill key kept', () => {
  const sentences = rememberedSentences({ entries: [
    { id: 'a', statement: '旧的', status: 'active', version: 3, lastSeen: '2026-09-01' },
    { id: 'b', statement: '新的', status: 'active', lastSeen: '2026-10-01' },
    { id: 'c', statement: '归档的', status: 'archived' }
  ] })
  assert.deepEqual(sentences.map((memory) => memory.statement), ['新的', '旧的'])
  const practice = nextPractice({ items: [
    { id: '1', skillProbe: { skillKey: 'reading.tfng', probeKind: 'contrastive_pair' }, whyText: '对照', estimatedMinutes: 15, done: false },
    { id: '2', skillProbe: 'reading.tfng', whyText: '已完成', done: true }
  ] })
  assert.deepEqual(practice, [{ id: '1', skillKey: 'reading.tfng', label: '判断题 · 对照练习', why: '对照', minutes: 15 }])
  const sub = nextPractice({ items: [
    { id: 's', skillProbe: { skillKey: 'reading.tfng.false_vs_not_given', probeKind: 'contrastive_pair' }, whyText: '对照', estimatedMinutes: 10, done: false },
    { id: 'w', skillProbe: { skillKey: 'writing.coherence', probeKind: 'writing_rewrite' }, whyText: '重写', estimatedMinutes: 20, done: false }
  ] })
  assert.deepEqual(sub.map((item) => item.label), ['判断题·错误与未提及 · 对照练习', '连贯与衔接 · 改写练习'])
  assert.ok(BANK.practice.single.map((text) => fill(text, { label: practice[0].label })).includes(practiceLead(practice, '2026-10-07')))
  assert.ok(BANK.practice.several.map((text) => fill(text, { count: sub.length })).includes(practiceLead(sub, '2026-10-07')))
})

test('practiced days: practice facts count, memory events alone do not; the streak counts consecutive practiced days', () => {
  assert.equal(isPracticed({ facts: { attemptsCount: 1 } }), true)
  assert.equal(isPracticed({ facts: { attemptsCount: 0, memoryEvents: [{ memoryId: 'x' }] } }), false)
  assert.equal(isPracticed({ facts: { readingByKind: [{ kind: 'tfng', todayCorrect: 1, todayTotal: 3 }] } }), true)
  assert.equal(isPracticed({ facts: { writing: { count: 1, averageBand: 6 } } }), true)
  assert.equal(isPracticed(null), false)
  const days = ['2026-10-05', '2026-10-04', '2026-10-03', '2026-10-01', '2026-09-30']
  const practiced = new Map([['2026-10-05', true], ['2026-10-04', true], ['2026-10-03', true], ['2026-10-01', true], ['2026-09-30', true]])
  assert.equal(streakLength(days, 0, practiced), 3, 'the gap on 10-02 ends the run')
  assert.equal(streakLength(days, 3, practiced), 2)
  assert.equal(streakLength(days, 0, new Map([['2026-10-05', true]])), 1)
})

test('weekday comes from the day itself; the date label carries it once', () => {
  assert.equal(weekdayName('2026-10-02'), '星期五')
  assert.equal(formatEntryDate('2026-10-02'), '2026年10月2日 · 星期五')
  assert.equal(weekdayName('garbage'), '')
  assert.equal(formatEntryDate('not-a-date'), 'not-a-date')
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
  const ISO = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10)
  const sweep = (from, count) => Array.from({ length: count }, (_, index) => ISO(Date.UTC(2026, 9, 1) / 86_400_000 + index))
  for (const day of sweep('2026-10-01', 30)) {
    const [first, second, third] = notesOn(day)
    assert.ok(first.phrase && second.phrase && third.phrase, `${day}: every note carries a verdict`)
    assert.ok(BANK.noteAgain.reinforced.includes(second.phrase), `${day}: the repeat uses noteAgain: ${second.phrase}`)
    assert.notEqual(second.phrase, first.phrase, `${day}: the two notes of one kind do not read alike`)
  }
})

test('the day word appears at most once per entry, and only in the opening line', () => {
  for (const [type, keys] of Object.entries(BANK)) {
    if (type === 'opening') continue
    for (const [key, variants] of Object.entries(keys)) for (const variant of variants) {
      assert.ok(!variant.includes('这一天'), `${type}.${key}: ${variant}`)
    }
  }
  const ISO = (number) => new Date(number * 86_400_000).toISOString().slice(0, 10)
  for (let index = 0; index < 60; index += 1) {
    const day = ISO(Date.UTC(2026, 8, 1) / 86_400_000 + index)
    const facts = {
      attemptsCount: 1 + (index % 4), timeSpentMs: index % 2 ? 0 : 1_500_000,
      writingEvalSummary: { completed: index % 3, degraded: index % 2, averageBand: 6 },
      coachFeedbackCount: index % 3, coachReaskCount: index % 2,
      skillDeltas: [{ skillKey: 'reading.tfng', delta: index % 2 ? 0.3 : -0.3, trend: index % 2 ? 'improving' : 'recurring' }],
      memoryEvents: index % 5 ? [{ memoryId: 'm1', changeKind: 'reinforced' }, { memoryId: 'm1', changeKind: 'reinforced' }] : []
    }
    const memories = new Map([['m1', { id: 'm1', statement: '一条记忆', evidenceIds: [] }]])
    const entry = buildNotebookEntry({ journalDate: day, facts }, memories, { previousDay: index % 4 ? ISO(Date.UTC(2026, 8, 1) / 86_400_000 + index - 2) : null })
    const text = [entry.title, ...entry.observations, entry.changeLead, ...entry.notes.map((note) => `${note.statement}。${note.phrase}`)].join('\n')
    assert.ok(text.split('这一天').length - 1 <= 1, `${day} says 这一天 twice:\n${text}`)
  }
  const malformed = buildNotebookEntry({ journalDate: '', facts: { attemptsCount: 2 } })
  assert.ok(malformed.title && malformed.observations.length === 1)
})

test('the source of the daily path has no model call, no network and no host call', () => {
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
    for (const journal of [UP_DAY, DOWN_DAY]) buildNotebookEntry(journal, new Map(), { plan: PLAN })
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  assert.deepEqual(calls, [])

  const allowed = {
    'compose.js': new Set(['./phrasing.js', './insight.js', '../agent-console/format.js']),
    'insight.js': new Set(['../agent-console/format.js']),
    'phrasing.js': new Set()
  }
  for (const [file, imports] of Object.entries(allowed)) {
    const source = readFileSync(new URL(`../../../apps/writing-vue/src/modules/notebook/${file}`, import.meta.url), 'utf8')
    const specifiers = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1])
    for (const specifier of specifiers) assert.ok(imports.has(specifier), `${file} imports ${specifier}`)
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

test('an all-ASCII skill list is set off once; a mixed list brackets only its ASCII name', () => {
  const facts = { skillDeltas: [
    { skillKey: 'writing.new_criterion', delta: 0.4, trend: 'improving' },
    { skillKey: 'writing.task1', delta: 0.3, trend: 'improving' }
  ] }
  const sheet = factSheet(facts, '2026-10-07')
  assert.equal(sheet.improvedNames, '「new criterion、task1」')
  const mixed = factSheet({ skillDeltas: [
    { skillKey: 'reading.tfng', delta: 0.4, trend: 'improving' },
    { skillKey: 'writing.new_criterion', delta: 0.3, trend: 'improving' }
  ] }, '2026-10-07')
  assert.equal(mixed.improvedNames, '判断题、「new criterion」')
  const entry = buildNotebookEntry({ journalDate: '2026-10-07', facts: { skillDeltas: [{ skillKey: 'writing.new_criterion', delta: 0.5, trend: 'improving' }] } })
  assert.ok(entry.title.includes('「new criterion」'), entry.title)
  assert.deepEqual(entry.changes.improved, ['new criterion'], 'the 变化 rows keep the bare label')
})

test('insight helpers: rows, bands, criteria and names are the app-wide, whole-number shapes', () => {
  assert.equal(MIN_KIND_QUESTIONS, 3)
  const rows = readingRows({ readingByKind: [
    { kind: 'tfng', todayCorrect: 10, todayTotal: 12, baselineCorrect: 6, baselineTotal: 12, trend: 'up', missedAssetCount: 2 },
    { kind: 'tfng', todayCorrect: 0, todayTotal: 3, trend: 'down' },
    { kind: 'single_choice', todayCorrect: 1, todayTotal: 2, trend: 'down' }
  ] })
  assert.equal(rows.length, 2, 'one row per kind')
  assert.deepEqual(rows[0], {
    kind: 'tfng', code: 'TFNG', zh: '判断题', name: 'TFNG',
    correct: 10, total: 12, pct: 83, basePct: 50, points: 33,
    trend: 'up', highError: false, missedAssets: 2
  })
  assert.equal(lineRows(rows).length, 1, 'two answered questions are too few to word')
  assert.deepEqual(lineRows(rows).map((row) => row.kind), ['tfng'])
  assert.deepEqual(lineRows(rows).map((row) => row.name), ['TFNG'])

  const view = writingView({ writing: {
    count: 1, average_band: 6.66, previous_average_band: 6.0, band_delta: 0.5,
    criteria: [{ key: 'TR', delta: 0.5 }, { key: 'GRA', delta: -0.4 }, { key: 'XX', delta: 0.5 }]
  } })
  assert.equal(view.band, '6.5')
  assert.equal(view.prevBand, '6')
  assert.equal(view.deltaText, '半分')
  assert.deepEqual(view.criteria.map((item) => [item.code, item.up, item.down, item.deltaText]), [
    ['TR', true, false, '半分'],
    ['GRA', false, true, '半分']
  ])
  assert.equal(writingView({ writingEvalSummary: { completed: 1, averageBand: 0 } }).band, null)

  const model = modelView({ due_review_count: 3, skill_states: [
    { skill_key: 'reading.tfng', recent_error_rate: 0.4 },
    { skill_key: 'reading.yng', recent_error_rate: 0.1 }
  ] })
  assert.deepEqual(model, { due: 3, weakest: { label: '判断题', rate: 40 } })

  const miss = tomorrowView({ topMissKind: 'tfng', rows: [], writing: null, due: 0, plan: [{ skill_key: 'reading.tfng', label: '判断题 · 对照练习' }] })
  assert.deepEqual(miss.facts, { key: 'missKind', name: '判断题' })
  assert.deepEqual(miss.link, { label: '判断题 · 对照练习' })
  assert.equal(tomorrowView({ rows: [], writing: null, due: 0 }).facts.key, 'keep')

  assert.deepEqual(changedNames(rows, view), { improved: ['判断题', 'TR'], recurring: ['单选题', 'GRA'] })
  assert.deepEqual(headlineFacts(rows, view), { up: '判断题', down: '单选题', criterion: 'GRA', rise: 'TR' })
  assert.deepEqual(moodSignals(rows, view), { up: 2, down: 2, light: false })
  assert.equal(kindOf('matching_headings').zh, '段落大意配对')
  assert.equal(shortSkill('reading.matching_information'), '段落信息配对')
})
