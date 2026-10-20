/**
 * 札记 (Notebook) composition — journal facts and memories in plain prose.
 *
 * The notebook shows what the system concluded, never how: no counts of jobs
 * or candidates, no ids, no confidence numbers, no coach bookkeeping. Every
 * export returns display data; the view only lays it out.
 *
 * Daily entries are rule-generated (insight.js compares the day with the
 * student's own baseline) and worded by the seeded phrase bank in phrasing.js.
 * No model is involved.
 */
import { formatJournalDate, formatMemoryStatement, formatSkillKey } from '../agent-console/format.js'
import { LONG_GAP_DAYS, daysBetween, dayNumber, keyFor, phrase } from './phrasing.js'
import {
  changeRows,
  changedNames,
  headlineFacts,
  kindOf,
  lineRows,
  modelView,
  moodSignals,
  readingRows,
  shortSkill,
  tomorrowView,
  writingView
} from './insight.js'

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
  return facts ? factSheet(facts, '').practiced : false
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

/** "星期五" for a "YYYY-MM-DD" day; '' when it is not a date. */
export function weekdayName(day) {
  const number = dayNumber(day)
  if (!Number.isFinite(number)) return ''
  return `星期${WEEKDAYS[new Date(number * 86_400_000).getUTCDay()]}`
}

/**
 * Consecutive practiced days ending at `days[index]` (itself included). A day
 * that is unknown or unpracticed, or a calendar gap, ends the run.
 */
export function streakLength(days, index, practiced) {
  let length = 0
  for (let at = index; at < days.length && practiced.get(days[at]) === true; at += 1) {
    if (at > index && daysBetween(days[at], days[at - 1]) !== 1) break
    length += 1
  }
  return length
}

export function formatEntryDate(day) {
  const weekday = weekdayName(day)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return formatJournalDate(day)
  return `${formatJournalDate(day)} · ${weekday}`
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

/**
 * The flat fact sheet phrasing.js reads. `context.previousDay` is the finished
 * day before this one: a date, `null` (there is none: first page) or
 * `undefined` (not known). v1 facts (writingEvalSummary, skillDeltas) and v2
 * facts (writing, readingByKind) both feed it; the host owns every number.
 */
export function factSheet(facts, day, context = {}) {
  const legacyWriting = pick(facts, 'writingEvalSummary', 'writing_eval_summary') || {}
  const writing = pick(facts, 'writing', 'writing') || {}
  const rows = changeRows(facts, writingView(facts))
  const attempts = asNumber(pick(facts, 'attemptsCount', 'attempts_count'))
  // v2 hosts report the writing count in `writing`; v1 hosts in the summary.
  const written = asNumber(legacyWriting.completed) || asNumber(writing.count)
  const feedback = asNumber(pick(facts, 'coachFeedbackCount', 'coach_feedback_count'))
  const reask = asNumber(pick(facts, 'coachReaskCount', 'coach_reask_count'))
  const gap = context.previousDay ? daysBetween(context.previousDay, day) : Number.NaN
  const events = pick(facts, 'memoryEvents', 'memory_events')
  const eventCount = Array.isArray(events) ? events.length : 0
  const improved = rows.filter((row) => row.trend === 'up').map((row) => row.zh)
  const recurring = rows.filter((row) => row.trend === 'down').map((row) => row.zh)
  const answered = rows.some((row) => row.total > 0) || written > 0
  const practiced = Boolean(attempts || written || feedback || reask || answered || improved.length || recurring.length)
  return {
    day,
    attempts,
    minutes: Math.round(asNumber(pick(facts, 'timeSpentMs', 'time_spent_ms')) / 60000),
    written,
    feedback,
    reask,
    improved,
    recurring,
    improvedNames: formatNames(improved),
    recurringNames: formatNames(recurring),
    type: typeLabel(improved[0] ?? recurring[0]),
    practiced,
    reading: rows.some((row) => row.total > 0),
    events: eventCount,
    quiet: !practiced && eventCount === 0,
    notesOnly: !practiced && eventCount > 0,
    first: context.previousDay === null,
    gap: gap > 0 ? gap : undefined,
    longGap: gap >= LONG_GAP_DAYS
  }
}

/**
 * Plain-prose headline lines, one per part of the entry. The number of lines a
 * part shows is capped here, not in the view.
 */
function readingSection(rows, topMiss, topMissKind, day) {
  const lines = lineRows(rows).slice(0, 4).map((row) => {
    const repeat = row.highError && row.missedAssets >= 2
    return {
      kind: row.kind,
      text: phrase('readingLine', {
        name: row.name,
        total: row.total,
        correct: row.correct,
        pct: row.pct,
        basePct: row.basePct ?? '',
        hasBase: row.basePct !== null,
        points: row.points === null ? '' : Math.abs(Math.round(row.points)),
        assets: row.missedAssets,
        repeat,
        trend: row.trend,
        highError: row.highError
      }, day)
    }
  }).filter((line) => line.text)
  const missKind = pick(topMiss, 'questionKind', 'question_kind')
    || (typeof topMissKind === 'string' ? topMissKind : topMissKind?.kind)
    || ''
  const miss = topMiss && asNumber(topMiss.wrong) > 0
    ? phrase('topMiss', {
      title: pick(topMiss, 'assetTitle', 'asset_title') || '',
      zh: kindOf(missKind).zh,
      wrong: asNumber(topMiss.wrong),
      total: asNumber(topMiss.total)
    }, day)
    : ''
  return { lines, topMiss: miss }
}

function writingSection(writing, day) {
  if (!writing) return null
  if (writing.legacy) {
    return { lines: [phrase('writingLine', { legacy: true, count: writing.count, band: writing.band ?? '' }, day)].filter(Boolean) }
  }
  const main = phrase('writingLine', {
    legacy: false,
    count: writing.count,
    band: writing.band ?? '',
    delta: writing.deltaText,
    bandUp: writing.bandUp,
    bandDown: writing.bandDown,
    prevBand: writing.prevBand ?? ''
  }, day)
  const criteria = writing.criteria
    .filter((item) => item.up || item.down)
    .map((item) => phrase('criterionLine', { up: item.up, label: `${item.code}（${item.name}）`, delta: item.deltaText }, day))
  return { lines: [main, ...criteria].filter(Boolean) }
}

function modelSection(model, day) {
  return {
    lines: [
      phrase('dueLine', { due: model.due }, day),
      phrase('weakLine', { label: model.weakest?.label ?? '', rate: model.weakest?.rate ?? '' }, day)
    ].filter(Boolean)
  }
}

/** The flat fact sheet for the headline's title (v1 fallback included). */
function legacyTitleSheet(sheet, change) {
  return {
    ...sheet,
    improved: change.improved,
    recurring: change.recurring,
    type: typeLabel(change.improved[0] ?? change.recurring[0]),
    attempts: sheet.attempts
  }
}

/**
 * The one-sentence headline, or '' when the day has no comparison to stand on.
 * v1 facts carry no reading baseline (skillDeltas only name a host-classified
 * trend), so a "steady" claim is never invented from them.
 */
function headlineFor(rows, writing, day) {
  const facts = headlineFacts(rows, writing)
  // "平稳" is a comparison too: only say it when the host actually compared
  // this day with a baseline and found it flat, never when the baseline (or the
  // trend field) is simply missing.
  const flat = rows.some((row) => row.trend === 'flat' && row.basePct !== null)
    || Boolean(writing && !writing.legacy && writing.prevBand !== null && !writing.bandUp && !writing.bandDown)
  const moved = Boolean(facts.up || facts.down || facts.criterion || facts.rise)
  if (!moved && !flat) return ''
  return phrase('insightTitle', facts, day)
}

/**
 * One dated notebook entry from a persisted daily journal. `context` says where
 * the day sits among the finished days: `previousDay` (see previousPracticedDay),
 * `streak` (see streakLength), `plan` (open study-plan items, see nextPractice).
 */
export function buildNotebookEntry(journal, memoriesById = new Map(), context = {}) {
  const facts = journal?.facts && typeof journal.facts === 'object' ? journal.facts : null
  if (!facts) return null
  const day = String(journal.journalDate || journal.journal_date || pick(facts, 'journalDate', 'journal_date') || '')
  const readingRowsList = readingRows(facts)
  const writing = writingView(facts)
  const rows = changeRows(facts, writing)
  const model = modelView(facts)
  const sheet = factSheet(facts, day, context)
  const topMiss = pick(facts, 'topMiss', 'top_miss')
  const topMissKind = pick(facts, 'topMissKind', 'top_miss_kind')
  const moved = rows.some((row) => row.trend === 'up' || row.trend === 'down')
  const hasInsight = readingRowsList.some((row) => row.total > 0)
    || moved
    || Boolean(writing)
    || model.due > 0
    || Boolean(model.weakest)
  const reading = readingSection(readingRowsList, topMiss, topMissKind, day)
  const writingPart = writingSection(writing, day)
  const modelPart = modelSection(model, day)
  const tomorrow = hasInsight || Boolean(reading.topMiss)
    ? tomorrowView({ topMissKind, rows: readingRowsList, writing, due: model.due, plan: context.plan ?? [] })
    : null
  const tomorrowLine = tomorrow ? phrase('tomorrow', tomorrow.facts, day) : ''
  const tomorrowLink = tomorrow?.link ? phrase('planLink', tomorrow.link, day) : ''
  const names = changedNames(rows, writing)
  const headline = !sheet.quiet ? headlineFor(readingRowsList, writing, day) : ''
  const title = headline || phrase('title', legacyTitleSheet(sheet, names), day)
  const changeLead = phrase('changeLead', {
    improved: names.improved,
    recurring: names.recurring,
    improvedNames: formatNames(names.improved),
    recurringNames: formatNames(names.recurring)
  }, day)
  const observations = [phrase('opening', sheet, day), phrase('attempts', sheet, day)].filter(Boolean)
  const summaryLines = [reading.lines[0]?.text, writingPart?.lines[0], tomorrowLine].filter(Boolean).slice(0, 3)
  const assetKinds = pick(facts, 'assetQuestionKinds', 'asset_question_kinds')
  return {
    day,
    dateLabel: formatEntryDate(day),
    weekday: weekdayName(day),
    title,
    observations,
    notes: memoryNotes(facts, memoriesById, day),
    reading,
    writing: writingPart,
    model: modelPart,
    tomorrow: { line: tomorrowLine, link: tomorrowLink },
    summaryLines: summaryLines.length ? summaryLines : observations.slice(0, 2),
    changes: names,
    changeLead,
    mood: { ...moodSignals(rows, writing), streak: context.streak ?? 0 },
    // Reserved: the question-kind map per asset. Read here so the entry model has it;
    // not displayed until the question-file schema upgrade (see developer/docs).
    assetKinds: assetKinds && typeof assetKinds === 'object' && !Array.isArray(assetKinds) ? assetKinds : {}
  }
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
        skillKey: String(skillKey || ''),
        label: [shortSkill(skillKey), kind].filter(Boolean).join(' · '),
        why: String(item.whyText || item.why_text || ''),
        minutes: asNumber(item.estimatedMinutes ?? item.estimated_minutes)
      }
    })
}
