import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildNotebookEntry,
  formatEntryDate,
  journalDaysFromJobs,
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
      skillDeltas: [
        { skillKey: 'reading.tfng', delta: 0.4123, trend: 'improving' },
        { skillKey: 'reading.matching_headings', delta: 0, trend: 'recurring' },
        { skillKey: 'reading.summary_completion', delta: -0.2, trend: 'steady' }
      ],
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
  // Legacy journals stored the raw day mean as `delta` (always >= 0) with no
  // trend; that must not be read as "在变好".
  const legacy = buildNotebookEntry({
    journalDate: '2026-10-01',
    facts: { attemptsCount: 1, skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.8, evidenceCount: 2 }] }
  })
  assert.deepEqual(legacy.changes, { improved: [], recurring: [] })
  assert.equal(buildNotebookEntry({ journalDate: '2026-10-01' }), null)
  assert.equal(formatEntryDate('not-a-date'), 'not-a-date')
})

test('memories are active plain sentences, newest first', () => {
  const sentences = rememberedSentences({ entries: [
    { id: 'a', statement: '旧的', status: 'active', version: 3, lastSeen: '2026-09-01' },
    { id: 'b', statement: '新的', status: 'active', lastSeen: '2026-10-01' },
    { id: 'c', statement: '归档的', status: 'archived' }
  ] })
  assert.deepEqual(sentences.map((memory) => memory.statement), ['新的', '旧的'])
  assert.equal(sentences[1].version, 3)
})
