/**
 * 札记 (Notebook) composition — journal facts and memories in plain prose.
 *
 * The notebook shows what the system concluded, never how: no counts of jobs
 * or candidates, no ids, no confidence numbers. Every export returns display
 * data; the view only lays it out.
 *
 * Daily entries are rule-generated from the journal's structured facts and
 * worded by the seeded phrase bank in phrasing.js. No model is involved.
 */
import { formatJournalDate, formatMemoryStatement, formatSkillKey } from '../agent-console/format.js'
import { LONG_GAP_DAYS, daysBetween, keyFor, phrase } from './phrasing.js'

const DAY_KEY = /^(?:daily_journal|daily_dream):local:(\d{4}-\d{2}-\d{2})$/
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const PROBE_PHRASES = {
  novel_item: '新题',
  same_item_retention: '回看原题',
  contrastive_pair: '对照练习',
  coach_micro_drill: '教练小练习',
  writing_rewrite: '改写练习'
}

function pick(record, camel, snake) {
  if (!record || typeof record !== 'object') return undefined
  return record[camel] ?? record[snake]
}

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function shortSkill(skillKey) {
  const parts = formatSkillKey(skillKey).split('·').map((part) => part.trim()).filter(Boolean)
  return (parts.length > 1 ? parts.slice(1) : parts).join('·')
}

/**
 * Days whose journal the host has already finished. Reading such a day is a
 * pure read; reading any other day would make the host build a journal, so
 * the notebook never probes dates on its own.
 */
export function journalDaysFromJobs(jobs, limit = 14) {
  const days = new Set()
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (job?.status !== 'completed') continue
    const match = DAY_KEY.exec(String(pick(job, 'dedupeKey', 'dedupe_key') || ''))
    if (match) days.add(match[1])
  }
  return [...days].sort().reverse().slice(0, limit)
}

/** The host's job list is its most recent jobs only (see `background_job_status`). */
const JOB_WINDOW = 50
export const ENTRY_LIMIT = 14
/** Finished days read to find each entry's previous practiced day (one read each). */
export const JOURNAL_WINDOW = 30

/**
 * The finished days to read, newest first, and whether the job list may have
 * hidden older ones (`cutOff`).
 */
export function journalWindow(jobs) {
  return {
    days: journalDaysFromJobs(jobs, JOURNAL_WINDOW),
    cutOff: (Array.isArray(jobs) ? jobs.length : 0) >= JOB_WINDOW
  }
}

/** A day counts as practiced when it has any practice fact (memory events alone do not; see factSheet). */
export function isPracticed(journal) {
  const facts = journal?.facts && typeof journal.facts === 'object' ? journal.facts : null
  return facts ? factSheet(facts, changes(facts), '').practiced : false
}

/**
 * The newest practiced day before `days[index]`, read from `practiced` (a Map of
 * day -> boolean, or undefined when that journal could not be read).
 * `null` = no earlier practice exists (first page); `undefined` = unknown,
 * because a day in between could not be read or older days may be hidden.
 */
export function previousPracticedDay(days, index, practiced, cutOff = false) {
  for (const older of days.slice(index + 1)) {
    const flag = practiced.get(older)
    if (flag === undefined) return undefined
    if (flag) return older
  }
  const windowFull = days.length >= JOURNAL_WINDOW
  return cutOff || windowFull ? undefined : null
}

export function formatEntryDate(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!match) return formatJournalDate(day)
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
  return `${formatJournalDate(day)} · 星期${WEEKDAYS[weekday]}`
}

export function readMemory(row) {
  const id = String(row?.id || '')
  if (!id) return null
  return {
    id,
    version: asNumber(row.version) || 1,
    status: String(row.status || 'active').toLowerCase(),
    statement: formatMemoryStatement({ value: row, key: row.canonicalKey }, (entry, field, fallback) => entry.value?.[field] ?? fallback),
    evidenceIds: Array.isArray(row.evidenceObservationIds) ? row.evidenceObservationIds : []
  }
}

/** Active memories as plain sentences, newest first. */
export function rememberedSentences(catalog) {
  const rows = Array.isArray(catalog?.entries) ? catalog.entries : []
  return rows
    .map((row) => ({ memory: readMemory(row), seen: String(row?.lastSeen || row?.firstSeen || '') }))
    .filter(({ memory }) => memory && memory.status === 'active' && memory.statement)
    .sort((left, right) => right.seen.localeCompare(left.seen))
    .map(({ memory }) => memory)
}

/**
 * Every note carries its own verdict. The first note with a phrase key uses the
 * `note` bank; a later note with that key uses `noteAgain`, so the two never
 * collide on the same day and each (bank, key, day) is one bag pick.
 */
function memoryNotes(facts, memoriesById, day) {
  const events = pick(facts, 'memoryEvents', 'memory_events')
  const seen = new Set()
  const keysSeen = new Set()
  const notes = []
  for (const event of Array.isArray(events) ? events : []) {
    const memory = memoriesById.get(String(pick(event, 'memoryId', 'memory_id') || ''))
    if (!memory || seen.has(memory.id)) continue
    seen.add(memory.id)
    const kind = String(pick(event, 'changeKind', 'change_kind') || '')
    const evidenceIds = pick(event, 'evidenceObservationIds', 'evidence_observation_ids')
    const bank = keysSeen.has(keyFor('note', { kind })) ? 'noteAgain' : 'note'
    keysSeen.add(keyFor('note', { kind }))
    notes.push({
      id: memory.id,
      phrase: phrase(bank, { kind }, day),
      statement: memory.statement.replace(/[。．.!！?？\s]+$/u, ''),
      evidenceIds: Array.isArray(evidenceIds) && evidenceIds.length ? evidenceIds : memory.evidenceIds
    })
  }
  return notes
}

/** Skill labels that went up / down on the day, strongest first. */
export function changes(facts) {
  const deltas = pick(facts, 'skillDeltas', 'skill_deltas')
  const improved = []
  const recurring = []
  for (const item of Array.isArray(deltas) ? deltas : []) {
    const delta = asNumber(pick(item, 'delta', 'delta'))
    const label = shortSkill(pick(item, 'skillKey', 'skill_key'))
    if (delta > 0) improved.push({ label, delta })
    if (delta < 0) recurring.push({ label, delta })
  }
  improved.sort((left, right) => right.delta - left.delta)
  recurring.sort((left, right) => left.delta - right.delta)
  return {
    improved: improved.map((item) => item.label),
    recurring: recurring.map((item) => item.label)
  }
}

/** A name that is plain ASCII ("Task 2") is set off so it does not fuse with the Chinese around it. */
function typeLabel(label) {
  return label && /^[\x20-\x7e]+$/.test(label) ? `「${label}」` : label
}

/**
 * Skill names for the lead, at most three. An all-ASCII list is set off once (「Task 2、Task 1」);
 * a mixed list sets off each ASCII name so it does not fuse with the Chinese around it.
 */
function formatNames(labels) {
  const items = labels.slice(0, 3)
  if (items.length && items.every((label) => /^[\x20-\x7e]+$/.test(label))) return `「${items.join('、')}」`
  return items.map(typeLabel).join('、')
}

/** One decimal at most: an average of several bands is not worth more digits than that. */
function roundBand(value) {
  return Math.round(value * 10) / 10
}

/**
 * The flat fact sheet phrasing.js reads. `context.previousDay` is the finished
 * day before this one: a date, `null` (there is none: first page) or
 * `undefined` (not known).
 */
export function factSheet(facts, change, day, context = {}) {
  const writing = pick(facts, 'writingEvalSummary', 'writing_eval_summary') || {}
  const attempts = asNumber(pick(facts, 'attemptsCount', 'attempts_count'))
  const written = asNumber(writing.completed)
  const feedback = asNumber(pick(facts, 'coachFeedbackCount', 'coach_feedback_count'))
  const reask = asNumber(pick(facts, 'coachReaskCount', 'coach_reask_count'))
  const gap = context.previousDay ? daysBetween(context.previousDay, day) : Number.NaN
  const events = pick(facts, 'memoryEvents', 'memory_events')
  const eventCount = Array.isArray(events) ? events.length : 0
  const practiced = Boolean(attempts || written || feedback || reask || change.improved.length || change.recurring.length)
  return {
    day,
    attempts,
    minutes: Math.round(asNumber(pick(facts, 'timeSpentMs', 'time_spent_ms')) / 60000),
    written,
    degraded: asNumber(writing.degraded),
    band: roundBand(asNumber(pick(writing, 'averageBand', 'average_band'))),
    feedback,
    reask,
    improved: change.improved,
    recurring: change.recurring,
    improvedNames: formatNames(change.improved),
    recurringNames: formatNames(change.recurring),
    type: typeLabel(change.improved[0] ?? change.recurring[0]),
    practiced,
    events: eventCount,
    quiet: !practiced && eventCount === 0,
    notesOnly: !practiced && eventCount > 0,
    first: context.previousDay === null,
    gap: gap > 0 ? gap : undefined,
    longGap: gap >= LONG_GAP_DAYS
  }
}

// The 观察 paragraph, in reading order. Each type says nothing when its fact is absent.
const OBSERVATION_FACTS = ['opening', 'attempts', 'writing', 'degraded', 'coach', 'reask']

/**
 * One dated notebook entry from a persisted daily journal. `context` says
 * where the day sits among the finished days (`previousDay`, see factSheet);
 * without it the entry simply has no first-page / long-gap wording.
 */
export function buildNotebookEntry(journal, memoriesById = new Map(), context = {}) {
  const facts = journal?.facts && typeof journal.facts === 'object' ? journal.facts : null
  if (!facts) return null
  const day = String(journal.journalDate || journal.journal_date || facts.journalDate || '')
  const change = changes(facts)
  const sheet = factSheet(facts, change, day, context)
  return {
    day,
    dateLabel: formatEntryDate(day),
    title: phrase('title', sheet, day),
    observations: OBSERVATION_FACTS.map((type) => phrase(type, sheet, day)).filter(Boolean),
    notes: memoryNotes(facts, memoriesById, day),
    changeLead: phrase('changeLead', sheet, day),
    changes: change
  }
}

/** The viewer's local calendar day ("YYYY-MM-DD") of an RFC3339 instant, or ''. */
function localDay(instant) {
  const time = new Date(String(instant || ''))
  if (Number.isNaN(time.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
}

/** "2026年10月5日 – 10月11日": the window's date range (year repeated only if it changes). */
function formatWindowRange(startDay, endDay) {
  if (startDay === endDay) return formatJournalDate(startDay)
  const start = formatJournalDate(startDay)
  const end = formatJournalDate(endDay)
  const sameYear = start.slice(0, start.indexOf('年')) === end.slice(0, end.indexOf('年'))
  return `${start} – ${sameYear ? end.slice(end.indexOf('年') + 1) : end}`
}

function sentences(value) {
  return (Array.isArray(value) ? value : [])
    .map((line) => String(line ?? '').trim().replace(/[。．.!！?？\s]+$/u, ''))
    .filter(Boolean)
}

/**
 * One weekly notebook entry from a finished weekly pass: the three sections of
 * prose the pass wrote (这段时间的观察 / 变化 / 下一步练习). The window is whatever
 * the run covered (a missed weekend folds into the next one, so it can span
 * weeks), and the entry is labelled by that range. No counts, no ids, no
 * confidence; a pass that wrote nothing has no entry.
 */
export function buildWeeklyEntry(digest) {
  const window = String(digest?.window || '')
  const startDay = localDay(pick(digest, 'windowStart', 'window_start'))
  const endDay = localDay(pick(digest, 'windowEnd', 'window_end'))
  if (!window || !startDay || !endDay) return null
  const entry = {
    window,
    startDay,
    dateLabel: formatWindowRange(startDay, endDay),
    title: '这段时间的整理',
    observations: sentences(digest.observations),
    changes: sentences(digest.changes),
    nextPractice: sentences(pick(digest, 'nextPractice', 'next_practice'))
  }
  return entry.observations.length || entry.changes.length || entry.nextPractice.length ? entry : null
}

/**
 * The closing line above the open plan items (`items` from nextPractice), or ''
 * when there is nothing to suggest. Worded for `day` like any other fact.
 */
export function practiceLead(items, day) {
  const list = Array.isArray(items) ? items : []
  return phrase('practice', { count: list.length, label: list[0]?.label }, day)
}

/** Study-plan items still open, as practice suggestions. */
export function nextPractice(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : []
  return items
    .filter((item) => item && !item.done)
    .map((item) => {
      const probe = item.skillProbe ?? item.skill_probe
      const skillKey = typeof probe === 'string' ? probe : probe?.skillKey
      const kind = typeof probe === 'object' ? PROBE_PHRASES[probe?.probeKind] : ''
      return {
        id: String(item.id),
        label: [shortSkill(skillKey), kind].filter(Boolean).join(' · '),
        why: String(item.whyText || item.why_text || ''),
        minutes: asNumber(item.estimatedMinutes ?? item.estimated_minutes)
      }
    })
}
