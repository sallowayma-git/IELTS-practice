import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildNotebookEntry,
  buildWeeklyEntry,
  formatEntryDate,
  journalDaysFromJobs,
  nextPractice,
  rememberedSentences
} from '../../../apps/writing-vue/src/modules/notebook/compose.js'
import { BANK } from '../../../apps/writing-vue/src/modules/notebook/phrasing.js'

test('only finished journal/dream days are read, newest first, deduplicated', () => {
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

test('entry prose carries words, not machinery or fake precision', () => {
  const memories = new Map([['mem-1', { id: 'mem-1', statement: '判断题常把未提及判为错误。', evidenceIds: ['obs-1'] }]])
  const entry = buildNotebookEntry({
    journalDate: '2026-10-02',
    facts: {
      attemptsCount: 3,
      timeSpentMs: 3_120_000,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4123 }, { skillKey: 'reading.matching_headings', delta: -0.3 }],
      memoryChanges: { newCandidates: 4 },
      memoryEvents: [
        { memoryId: 'mem-1', changeKind: 'reinforced', evidenceObservationIds: ['obs-1'] },
        { memoryId: 'candidate-not-active', changeKind: 'new_candidate' }
      ],
      sourceHash: 'deadbeef'
    }
  }, memories)
  assert.equal(entry.dateLabel, '2026年10月2日 · 星期五')
  assert.ok(BANK.title.improved.map((variant) => variant.replace('{type}', '判断题')).includes(entry.title), entry.title)
  assert.deepEqual(entry.changes, { improved: ['判断题'], recurring: ['段落大意配对'] })
  assert.equal(entry.notes.length, 1, 'inactive candidates stay invisible')
  assert.equal(entry.notes[0].statement, '判断题常把未提及判为错误')
  const prose = JSON.stringify(entry)
  for (const forbidden of ['0.41', 'deadbeef', 'candidate', '新候选', '4 ']) {
    assert.ok(!prose.includes(forbidden), `entry leaks ${forbidden}`)
  }
  assert.match(entry.observations.join(''), /52 分钟/, 'the minutes come through whichever variant the day picks')
})

test('quiet days and malformed journals degrade honestly', () => {
  const quiet = buildNotebookEntry({ journalDate: '2026-10-01', facts: { attemptsCount: 0 } })
  assert.ok(BANK.title.quiet.includes(quiet.title), quiet.title)
  assert.deepEqual(quiet.changes, { improved: [], recurring: [] })
  assert.equal(buildNotebookEntry({ journalDate: '2026-10-01' }), null)
  assert.equal(formatEntryDate('not-a-date'), 'not-a-date')
})

test('memories are active plain sentences; plan shows open items only', () => {
  const sentences = rememberedSentences({ entries: [
    { id: 'a', statement: '旧的', status: 'active', version: 3, lastSeen: '2026-09-01' },
    { id: 'b', statement: '新的', status: 'active', lastSeen: '2026-10-01' },
    { id: 'c', statement: '归档的', status: 'archived' }
  ] })
  assert.deepEqual(sentences.map((memory) => memory.statement), ['新的', '旧的'])
  assert.equal(sentences[1].version, 3)
  const practice = nextPractice({ items: [
    { id: '1', skillProbe: { skillKey: 'reading.tfng', probeKind: 'contrastive_pair' }, whyText: '对照', estimatedMinutes: 15, done: false },
    { id: '2', skillProbe: 'reading.tfng', whyText: '已完成', done: true }
  ] })
  assert.deepEqual(practice, [{ id: '1', label: '判断题 · 对照练习', why: '对照', minutes: 15 }])
  const sub = nextPractice({ items: [
    { id: 's', skillProbe: { skillKey: 'reading.tfng.false_vs_not_given', probeKind: 'contrastive_pair' }, whyText: '对照', estimatedMinutes: 10, done: false },
    { id: 'm', skillProbe: { skillKey: 'reading.multi_choice.evidence_completeness', probeKind: 'novel_item' }, whyText: '换材料', estimatedMinutes: 10, done: false },
    { id: 'w', skillProbe: { skillKey: 'writing.coherence', probeKind: 'writing_rewrite' }, whyText: '重写', estimatedMinutes: 20, done: false }
  ] })
  assert.deepEqual(sub.map((item) => item.label), [
    '判断题·错误与未提及 · 对照练习',
    '多选题·证据完整度 · 新题',
    '连贯与衔接 · 改写练习'
  ])
})

// Window instants sit at midday UTC so the viewer's local calendar day is the same
// in every time zone the tests may run in.
test('weekly entry is the prose the pass wrote, labelled by the window it actually covered', () => {
  const entry = buildWeeklyEntry({
    window: '2026-W41',
    windowStart: '2026-10-03T12:00:00Z',
    windowEnd: '2026-10-10T12:00:00Z',
    finishedAt: '2026-10-10T13:00:00Z',
    observations: ['P1 第 14 题和 P2 第 3 题都在判断题上选错。', '  '],
    changes: ['重做 P1 后修正了一道错题'],
    nextPractice: ['换一篇文章再练判断题！']
  })
  assert.equal(entry.window, '2026-W41')
  assert.equal(entry.dateLabel, '2026年10月3日 – 10月10日')
  assert.equal(entry.title, '这段时间的整理')
  // Sentences are trimmed of their own full stop: the page adds it back once.
  assert.deepEqual(entry.observations, ['P1 第 14 题和 P2 第 3 题都在判断题上选错'])
  assert.deepEqual(entry.changes, ['重做 P1 后修正了一道错题'])
  assert.deepEqual(entry.nextPractice, ['换一篇文章再练判断题'])
  const prose = JSON.stringify(entry)
  for (const forbidden of ['mem-', 'obs-', '2026-10-10T', 'finishedAt']) {
    assert.ok(!prose.includes(forbidden), `weekly entry leaks ${forbidden}`)
  }
})

test('a missed weekend is folded in: the label spans the whole window; snake_case hosts read the same', () => {
  const entry = buildWeeklyEntry({
    window: '2026-W41',
    window_start: '2026-09-19T12:00:00Z',
    window_end: '2026-10-10T12:00:00Z',
    observations: ['节奏稳定'],
    next_practice: ['继续保持']
  })
  assert.equal(entry.dateLabel, '2026年9月19日 – 10月10日')
  assert.deepEqual(entry.changes, [])
  assert.deepEqual(entry.nextPractice, ['继续保持'])
})

test('weekly entry without prose, window or a readable range is not shown', () => {
  const span = { windowStart: '2026-10-03T12:00:00Z', windowEnd: '2026-10-10T12:00:00Z' }
  assert.equal(buildWeeklyEntry({ window: '2026-W41', ...span, observations: [], changes: [], nextPractice: [] }), null)
  assert.equal(buildWeeklyEntry({ window: '2026-W41', ...span, observations: ['  ', '。'] }), null)
  assert.equal(buildWeeklyEntry({ window: '2026-W41', ...span }), null)
  assert.equal(buildWeeklyEntry({ ...span, observations: ['x'] }), null)
  assert.equal(buildWeeklyEntry({ window: '2026-W41', observations: ['x'] }), null)
  assert.equal(buildWeeklyEntry({ window: '2026-W41', windowStart: 'garbage', windowEnd: 'garbage', observations: ['x'] }), null)
  assert.equal(buildWeeklyEntry(null), null)
  // A window spanning New Year repeats the year; a same-day window is a single date.
  assert.equal(buildWeeklyEntry({ window: '2026-W53', windowStart: '2026-12-26T12:00:00Z', windowEnd: '2027-01-02T12:00:00Z', changes: ['x'] }).dateLabel, '2026年12月26日 – 2027年1月2日')
  assert.equal(buildWeeklyEntry({ window: '2026-W41', windowStart: '2026-10-10T08:00:00Z', windowEnd: '2026-10-10T16:00:00Z', nextPractice: ['x'] }).dateLabel, '2026年10月10日')
})
