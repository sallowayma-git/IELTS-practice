/**
 * 札记 (Notebook) composition — journal facts and memories in plain prose.
 *
 * The notebook shows what the system concluded, never how: no counts of jobs
 * or candidates, no ids, no confidence numbers. Every export returns display
 * data; the view only lays it out.
 */
import { formatJournalDate, formatMemoryStatement, formatSkillKey } from '../agent-console/format.js'

const DAY_KEY = /^(?:daily_journal|daily_dream):local:(\d{4}-\d{2}-\d{2})$/
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const CHANGE_PHRASES = {
  new_candidate: '这是新注意到的一点。',
  created: '这是新注意到的一点。',
  reinforced: '这一点再次得到印证。',
  promoted: '这一点已确认为长期了解。',
  refined: '这一点的表述更准确了。',
  improved: '这一点正在改善。',
  regressed: '这一点出现了回退。',
  contradicted: '这一点出现了反例，会被重新审视。',
  superseded: '这一点已被新的判断取代。'
}

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
  const label = formatSkillKey(skillKey)
  return label.includes('·') ? label.split('·').pop().trim() : label
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

function observationSentences(facts) {
  const sentences = []
  const attempts = asNumber(pick(facts, 'attemptsCount', 'attempts_count'))
  const minutes = Math.round(asNumber(pick(facts, 'timeSpentMs', 'time_spent_ms')) / 60000)
  if (attempts) {
    sentences.push(minutes
      ? `这一天完成了 ${attempts} 次练习，用时约 ${minutes} 分钟。`
      : `这一天完成了 ${attempts} 次练习。`)
  }
  const writing = pick(facts, 'writingEvalSummary', 'writing_eval_summary') || {}
  const completed = asNumber(writing.completed)
  const band = pick(writing, 'averageBand', 'average_band')
  const hasBand = band !== null && band !== undefined && Number.isFinite(Number(band))
  if (completed && hasBand) {
    sentences.push(completed === 1
      ? `提交了 1 篇写作，评分约为 Band ${Number(band)}。`
      : `提交了 ${completed} 篇写作，平均约为 Band ${Number(band)}。`)
  } else if (completed) {
    sentences.push(`提交了 ${completed} 篇写作。`)
  }
  const degraded = asNumber(writing.degraded)
  if (degraded) sentences.push(`其中 ${degraded} 篇的逐句详解没能完整生成，评分本身不受影响。`)
  const coach = asNumber(pick(facts, 'coachFeedbackCount', 'coach_feedback_count'))
  if (coach) sentences.push(`在阅读中向教练提问，得到了 ${coach} 条讲解。`)
  return sentences
}

function memoryNotes(facts, memoriesById) {
  const events = pick(facts, 'memoryEvents', 'memory_events')
  const seen = new Set()
  const notes = []
  for (const event of Array.isArray(events) ? events : []) {
    const memory = memoriesById.get(String(pick(event, 'memoryId', 'memory_id') || ''))
    if (!memory || seen.has(memory.id)) continue
    seen.add(memory.id)
    const kind = String(pick(event, 'changeKind', 'change_kind') || '')
    const evidenceIds = pick(event, 'evidenceObservationIds', 'evidence_observation_ids')
    notes.push({
      id: memory.id,
      phrase: CHANGE_PHRASES[kind] || '这一点有所更新。',
      statement: memory.statement.replace(/[。．.!！?？\s]+$/u, ''),
      evidenceIds: Array.isArray(evidenceIds) && evidenceIds.length ? evidenceIds : memory.evidenceIds
    })
  }
  return notes
}

function changes(facts) {
  const deltas = pick(facts, 'skillDeltas', 'skill_deltas')
  const improved = []
  const recurring = []
  for (const item of Array.isArray(deltas) ? deltas : []) {
    const delta = asNumber(pick(item, 'delta', 'delta'))
    const label = shortSkill(pick(item, 'skillKey', 'skill_key'))
    if (delta > 0) improved.push(label)
    if (delta < 0) recurring.push(label)
  }
  return { improved, recurring }
}

function entryTitle(facts, change) {
  const attempts = asNumber(pick(facts, 'attemptsCount', 'attempts_count'))
  if (!attempts) return '安静的一天'
  if (change.improved.length) return `${change.improved[0]}开始稳定`
  if (change.recurring.length) return `${change.recurring[0]}仍需留意`
  return attempts > 1 ? '一段扎实的练习' : '一次练习'
}

/** One dated notebook entry from a persisted daily journal. */
export function buildNotebookEntry(journal, memoriesById = new Map()) {
  const facts = journal?.facts && typeof journal.facts === 'object' ? journal.facts : null
  if (!facts) return null
  const day = String(journal.journalDate || journal.journal_date || facts.journalDate || '')
  const change = changes(facts)
  const unresolved = (journal.unresolvedQuestions || journal.unresolved_questions || [])
    .map((item) => typeof item === 'string' ? item : String(item?.question || item?.text || ''))
    .filter(Boolean)
  return {
    day,
    dateLabel: formatEntryDate(day),
    title: entryTitle(facts, change),
    observations: observationSentences(facts),
    notes: memoryNotes(facts, memoriesById),
    changes: change,
    unresolved
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

function unique(values) {
  return [...new Set(values)]
}

/**
 * One weekly notebook entry from a finished weekly consolidation: the patterns
 * it found (这段时间的观察) and the skill changes gathered from the daily entries
 * inside the window it actually covered (变化). The window is whatever the run
 * covered (a missed weekend folds into the next one, so it can span weeks), and
 * the entry is labelled by that range. No counts, no ids, no confidence.
 */
export function buildWeeklyEntry(digest, dailyEntries = []) {
  const window = String(digest?.window || '')
  const startDay = localDay(pick(digest, 'windowStart', 'window_start'))
  const endDay = localDay(pick(digest, 'windowEnd', 'window_end'))
  if (!window || !startDay || !endDay) return null
  const patterns = (Array.isArray(digest.patterns) ? digest.patterns : [])
    .map((pattern) => String(pattern?.statement || '').trim().replace(/[。．.!！?？\s]+$/u, ''))
    .filter(Boolean)
  if (!patterns.length) return null
  const days = (Array.isArray(dailyEntries) ? dailyEntries : [])
    .filter((entry) => entry?.day >= startDay && entry.day <= endDay)
  const change = {
    improved: unique(days.flatMap((entry) => entry.changes?.improved || [])),
    recurring: unique(days.flatMap((entry) => entry.changes?.recurring || []))
  }
  return {
    window,
    startDay,
    dateLabel: formatWindowRange(startDay, endDay),
    title: change.improved.length
      ? `这段时间，${change.improved[0]}开始稳定`
      : change.recurring.length ? `这段时间，${change.recurring[0]}仍需留意` : '这段时间的整理',
    observations: patterns,
    changes: change
  }
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
