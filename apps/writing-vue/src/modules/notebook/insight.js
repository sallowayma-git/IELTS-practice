/**
 * Daily insight rules: what a journal day's v2 facts mean against the student's
 * own baseline. Pure functions over plain objects: no Vue, no I/O, no wording.
 * phrasing.js decides how each result is said; this file decides what it is.
 *
 * Every reader accepts the v2 journal shape (readingByKind, writing, topMiss,
 * topMissKind, skillStates, dueReviewCount) and degrades to the v1 shape when a
 * field is missing, so an older host keeps working without errors.
 */
import { formatSkillKey } from '../agent-console/format.js'

/** Kinds with fewer questions than this today are not worded (too few to say anything). */
export const MIN_KIND_QUESTIONS = 3
/** Accuracy below this (on enough questions) is a high error rate. */
const HIGH_ERROR_RATIO = 0.5
/** A skill whose recent error rate reaches this is named as the weakest one. */
const WEAK_SKILL_RATIO = 0.2
/** Fewer answered questions than this, with no writing, is a light day: the mood stays calm. */
export const LIGHT_DAY_QUESTIONS = 5
const TRENDS = ['up', 'down', 'flat', 'insufficient']

/**
 * Question kind -> short code (when the exam uses one) and Chinese name. The
 * names mirror the learner-model catalog (`learner/labels.js`), so a kind reads
 * the same here as it does on the rest of the notebook.
 */
const KIND_NAMES = {
  tfng: { code: 'TFNG', zh: '判断题' },
  yng: { code: 'YNG', zh: '是非题' },
  single_choice: { zh: '单选题' },
  multi_choice: { zh: '多选题' },
  sentence_completion: { zh: '句子填空' },
  summary_completion: { zh: '摘要填空' },
  notes_completion: { zh: '笔记填空' },
  note_completion: { zh: '笔记填空' },
  table_completion: { zh: '表格填空' },
  flow_chart_completion: { zh: '流程图填空' },
  matching_headings: { zh: '段落大意配对' },
  matching_information: { zh: '段落信息配对' },
  matching_features: { zh: '特征配对' },
  matching_sentence_endings: { zh: '句尾配对' },
  short_answer: { zh: '简答题' },
  classification: { zh: '分类题' },
  matching: { zh: '配对题' },
  map_labelling: { zh: '地图标注' },
  diagram_completion: { zh: '图示填空' },
  diagram_labelling: { zh: '图示填空' }
}

/** IELTS writing criteria, in the order the report lists them. */
export const CRITERIA = { TR: '任务回应', CC: '连贯与衔接', LR: '词汇', GRA: '语法' }

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** A field the host may send as camelCase or snake_case. */
function pick(record, camel, snake) {
  if (!record || typeof record !== 'object') return undefined
  return record[camel] ?? record[snake]
}

/** Half-band precision: an average is never shown with more digits than a half band. */
export function halfBand(value) {
  return Math.round(value * 2) / 2
}

/** "6.5" or "7": a whole band has no decimal point. */
export function formatBand(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const DELTA_WORDS = { 0.5: '半分', 1: '一分', 1.5: '一分半', 2: '两分' }

/** A half-band move in words: 0.5 -> 半分, 1 -> 一分. Sign is dropped; the verb carries it. */
export function deltaWords(delta) {
  const size = Math.abs(halfBand(delta))
  return DELTA_WORDS[size] ?? `${formatBand(size)}分`
}

/** Whole percent, never a decimal. */
export function percentOf(correct, total) {
  return Math.round((correct / total) * 100)
}

/** Name of a question kind: short code when there is one, else the Chinese name. */
export function kindOf(kind) {
  const key = String(kind || '')
  const names = KIND_NAMES[key]
  if (!names) {
    // Unknown kinds still get the app's label rules rather than a raw snake_case key.
    const label = key ? shortSkill(`reading.${key}`) : ''
    return { kind: key, code: '', zh: label, name: label }
  }
  return { kind: key, code: names.code || '', zh: names.zh || '', name: names.code || names.zh || '' }
}

/** A skill key as a short Chinese label ("reading.tfng" -> "判断题"). */
export function shortSkill(skillKey) {
  const parts = formatSkillKey(skillKey).split('·').map((part) => part.trim()).filter(Boolean)
  return (parts.length > 1 ? parts.slice(1) : parts).join('·')
}

function rowFromKind(item) {
  const kind = String(item?.kind || '')
  if (!kind) return null
  const correct = num(pick(item, 'todayCorrect', 'today_correct')) ?? 0
  const total = num(pick(item, 'todayTotal', 'today_total')) ?? 0
  const baselineTotal = num(pick(item, 'baselineTotal', 'baseline_total')) ?? 0
  const baselineCorrect = num(pick(item, 'baselineCorrect', 'baseline_correct')) ?? 0
  const pct = total > 0 ? percentOf(correct, total) : null
  const basePct = baselineTotal > 0 ? percentOf(baselineCorrect, baselineTotal) : null
  const trend = TRENDS.includes(item?.trend) ? item.trend : 'insufficient'
  return {
    ...kindOf(kind),
    correct,
    total,
    pct,
    basePct,
    points: pct !== null && basePct !== null ? pct - basePct : null,
    trend,
    highError: total >= MIN_KIND_QUESTIONS && correct / total < HIGH_ERROR_RATIO,
    // Only distinct missed assets justify "反复"; older hosts default to one.
    missedAssets: num(pick(item, 'missedAssetCount', 'missed_asset_count')) ?? 1
  }
}

/** The host's trend vocabulary for a skill delta, in the row vocabulary. */
const SKILL_TRENDS = {
  improving: 'up',
  up: 'up',
  recurring: 'down',
  down: 'down',
  steady: 'flat',
  flat: 'flat',
  insufficient: 'insufficient'
}

/**
 * v1 skill deltas as change rows. The host already classified the trend
 * (ielts-db journal `skill_trend`); a journal written before that field existed
 * has no trend and is never re-derived from the raw delta here, so a stale
 * value cannot resurrect a fake improvement.
 */
function skillDeltaRows(deltas) {
  return (Array.isArray(deltas) ? deltas : [])
    .filter((item) => String(pick(item, 'skillKey', 'skill_key') || ''))
    .map((item) => {
      const skillKey = String(pick(item, 'skillKey', 'skill_key'))
      const trend = SKILL_TRENDS[String(pick(item, 'trend', 'trend') || '').toLowerCase()] || 'insufficient'
      return {
        skillKey,
        kind: skillKey.split('.')[1] || '',
        zh: shortSkill(skillKey),
        trend,
        // Only used to order the strongest move first; never worded.
        move: num(pick(item, 'delta', 'delta')) ?? 0,
        total: 0
      }
    })
}

/**
 * v1 fallback: reading skill deltas, no question counts, so no lines are worded
 * from them. One skill-label source for the whole app: "matching_headings" is
 * 段落大意配对 here, exactly as in the rest of the notebook.
 */
function rowsFromSkillDeltas(deltas) {
  return skillDeltaRows(deltas)
    .filter((row) => row.skillKey.startsWith('reading.') && row.kind)
    .map((row) => ({
      ...kindOf(row.kind),
      zh: row.zh,
      name: row.zh,
      correct: 0,
      total: 0,
      pct: null,
      basePct: null,
      points: null,
      trend: row.trend,
      highError: false,
      missedAssets: 1,
      move: row.move
    }))
    .sort((left, right) => Math.abs(right.move) - Math.abs(left.move))
}

/**
 * v1 skill deltas outside reading. A v1 host classifies writing skills in the
 * same `skillDeltas` list as reading ones; the notebook's change lead and
 * heading must keep naming them.
 */
export function v1ChangeRows(facts) {
  return skillDeltaRows(pick(facts, 'skillDeltas', 'skill_deltas'))
    .filter((row) => !row.skillKey.startsWith('reading.'))
}

/**
 * Every row the change lead may name: the day's reading rows, plus v1 writing
 * skill deltas when no v2 writing report already carries the same movement.
 * Sorted strongest first so the heading names the biggest move.
 */
export function changeRows(facts, writing) {
  const rows = readingRows(facts)
  if (writing && !writing.legacy) return rows
  const extras = v1ChangeRows(facts)
  if (!extras.length) return rows
  return [...rows, ...extras].sort((left, right) => Math.abs(right.move ?? 0) - Math.abs(left.move ?? 0))
}

/** One row per question kind: today against the student's own baseline. */
export function readingRows(facts) {
  const byKind = pick(facts, 'readingByKind', 'reading_by_kind')
  const deltas = pick(facts, 'skillDeltas', 'skill_deltas')
  const rows = Array.isArray(byKind) ? byKind.map(rowFromKind).filter(Boolean) : rowsFromSkillDeltas(deltas)
  // One row per kind: a kind listed twice is counted once, the first occurrence wins.
  const seen = new Set()
  return rows.filter((row) => (seen.has(row.kind) ? false : seen.add(row.kind)))
}

/** Rows worth a line today: enough questions, worst first (down, high error, up, flat, then the rest). */
export function lineRows(rows) {
  const rank = (row) => {
    if (row.trend === 'down') return 0
    if (row.highError) return 1
    if (row.trend === 'up') return 2
    return row.trend === 'flat' ? 3 : 4
  }
  return rows.filter((row) => row.total >= MIN_KIND_QUESTIONS).sort((left, right) => rank(left) - rank(right))
}

function criterionOf(item) {
  const key = String(item?.key || '')
  if (!CRITERIA[key]) return null
  const delta = halfBand(num(item.delta) ?? 0)
  return { key, code: key, name: CRITERIA[key], delta, deltaText: deltaWords(delta), up: delta >= 0.5, down: delta <= -0.5 }
}

/** A raw average as a display band; a non-positive value is never a band. */
function bandOf(value) {
  const band = num(value)
  return band !== null && band > 0 ? formatBand(halfBand(band)) : null
}

/** Writing today against the previous writing day; null when nothing was written. */
export function writingView(facts) {
  const writing = pick(facts, 'writing', 'writing')
  const count = num(pick(writing, 'count', 'count')) ?? 0
  if (writing && typeof writing === 'object' && count > 0) {
    const bandValue = num(pick(writing, 'averageBand', 'average_band'))
    const previous = num(pick(writing, 'previousAverageBand', 'previous_average_band'))
    const band = bandOf(bandValue)
    const prevBand = bandOf(previous)
    const bandDelta = halfBand(num(pick(writing, 'bandDelta', 'band_delta'))
      ?? (band !== null && prevBand !== null ? halfBand(bandValue) - halfBand(previous) : 0))
    const criteriaValue = pick(writing, 'criteria', 'criteria')
    const criteria = (Array.isArray(criteriaValue) ? criteriaValue : []).map(criterionOf).filter(Boolean)
    return {
      legacy: false,
      count,
      band,
      prevBand,
      bandDelta,
      deltaText: deltaWords(bandDelta),
      bandUp: bandDelta >= 0.5,
      bandDown: bandDelta <= -0.5,
      criteria
    }
  }
  // v1 host: only the count and the average are known.
  const summary = pick(facts, 'writingEvalSummary', 'writing_eval_summary')
  const completed = num(summary?.completed) ?? 0
  if (completed <= 0) return null
  return {
    legacy: true,
    count: completed,
    band: bandOf(pick(summary, 'averageBand', 'average_band')),
    prevBand: null,
    bandDelta: 0,
    deltaText: '',
    bandUp: false,
    bandDown: false,
    criteria: []
  }
}

/** Learner-model signals: reviews due today and the weakest skill by recent error rate. */
export function modelView(facts) {
  const due = Math.max(0, num(pick(facts, 'dueReviewCount', 'due_review_count')) ?? 0)
  const statesValue = pick(facts, 'skillStates', 'skill_states')
  const states = (Array.isArray(statesValue) ? statesValue : [])
    .map((state) => ({
      skillKey: String(pick(state, 'skillKey', 'skill_key') || ''),
      rate: num(pick(state, 'recentErrorRate', 'recent_error_rate'))
    }))
    .filter((state) => state.skillKey && state.rate !== null)
    .sort((left, right) => right.rate - left.rate)
  const worst = states[0]
  const weakest = worst && worst.rate >= WEAK_SKILL_RATIO
    ? { label: shortSkill(worst.skillKey), rate: Math.round(worst.rate * 100) }
    : null
  return { due, weakest }
}

/** The headline's facts: the best reading gain, the worst reading loss, and the writing criteria that moved. */
export function headlineFacts(rows, writing) {
  const gains = rows.filter((row) => row.trend === 'up').sort((left, right) => (right.points ?? 0) - (left.points ?? 0))
  const losses = rows.filter((row) => row.trend === 'down').sort((left, right) => (left.points ?? 0) - (right.points ?? 0))
  const worst = losses[0] || rows.find((row) => row.highError)
  const criteria = writing?.criteria ?? []
  const drop = criteria.filter((item) => item.down).sort((left, right) => left.delta - right.delta)[0]
  const rise = criteria.filter((item) => item.up).sort((left, right) => right.delta - left.delta)[0]
  return {
    up: gains[0]?.zh || '',
    down: worst?.zh || '',
    criterion: drop?.code || '',
    rise: rise?.code || ''
  }
}

/**
 * The one suggestion for tomorrow, from the worst signal: the top-miss kind first,
 * then the lowest writing criterion, then a sliding reading kind, then due reviews.
 * `plan` is the open study-plan items (compose.js nextPractice).
 */
export function tomorrowView({ topMissKind, rows, writing, due, plan = [] }) {
  const linkFor = (kind) => plan.find((item) => {
    const skillKey = pick(item, 'skillKey', 'skill_key')
    return skillKey && String(skillKey).split('.').includes(kind)
  }) || null
  const kind = typeof topMissKind === 'string' ? topMissKind : String(topMissKind?.kind || '')
  if (kind) {
    const item = kindOf(kind)
    const link = linkFor(kind)
    return { facts: { key: 'missKind', name: item.zh }, link: link ? { label: link.label } : null }
  }
  const drop = (writing?.criteria ?? []).filter((item) => item.down).sort((left, right) => left.delta - right.delta)[0]
  if (drop) return { facts: { key: 'writing', criterion: drop.code, zh: drop.name }, link: null }
  const slipping = rows.find((row) => row.trend === 'down' || row.highError)
  if (slipping) {
    const link = linkFor(slipping.kind)
    return { facts: { key: 'readingDown', name: slipping.zh }, link: link ? { label: link.label } : null }
  }
  if (due > 0) return { facts: { key: 'due', due }, link: null }
  return { facts: { key: 'keep' }, link: null }
}

/**
 * Up and down movements for the mood, and whether the day is too light to read.
 * A regression is any down reading kind or any criterion/band drop.
 */
export function moodSignals(rows, writing) {
  const writingCounts = writing?.criteria?.length
    ? { up: writing.criteria.filter((item) => item.up).length, down: writing.criteria.filter((item) => item.down).length }
    : { up: writing?.bandUp ? 1 : 0, down: writing?.bandDown ? 1 : 0 }
  const up = rows.filter((row) => row.trend === 'up').length + writingCounts.up
  const down = rows.filter((row) => row.trend === 'down').length + writingCounts.down
  const answered = rows.reduce((sum, row) => sum + row.total, 0)
  const hasWriting = Boolean(writing && writing.count > 0)
  const light = answered > 0 && answered < LIGHT_DAY_QUESTIONS && !hasWriting
  return { up, down, light }
}

/** Chinese names of the kinds that went up / down today, for the pills. */
export function changedNames(rows, writing) {
  const names = (trend) => rows.filter((row) => row.trend === trend).map((row) => row.zh)
  const criteria = (writing?.criteria ?? [])
  return {
    improved: [...names('up'), ...criteria.filter((item) => item.up).map((item) => item.code)],
    recurring: [...names('down'), ...criteria.filter((item) => item.down).map((item) => item.code)]
  }
}
