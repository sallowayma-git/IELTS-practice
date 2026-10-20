/**
 * 札记 weekly reports — schema v3 narrative + typed data blocks, with the
 * schema v2 remote reports and local v2 digests read-only for history.
 *
 * The host computes every number (crates/ielts-domain/src/weekly_report.rs and
 * the block skills); this module only picks, labels and formats them, and
 * shapes each chart's series. Nothing here adds, averages or compares: a value
 * the page shows is a value the block's data or the report's fact map carries.
 * The title is the report's `displayTitle`, never derived here.
 */
import { formatJournalDate } from '../agent-console/format.js'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export const BLOCK_HEADINGS = {
  volume: '练习量',
  accuracy: '阅读正确率',
  question_types: '题型',
  repeated_misses: '反复出错',
  redo_progress: '重做',
  writing_bands: '写作分数',
  coach_signals: '教练反馈',
  next_week_plan: '下一步练习'
}

export const STATE_LINES = {
  live: { text: '本周进行中，周末会整理成完整周记', settings: false },
  final_no_ai: { text: '没有配置 AI，这一周只有数据部分', settings: true },
  narrative_failed: { text: 'AI 总结这次没写成，会自动重试；下面的数据已经是这一周的最终结果', settings: false }
}

const MEMORY_ACTIONS = {
  ADD: '新记下',
  REINFORCE: '更确定了',
  REFINE: '说得更准了',
  IMPROVE: '在变好',
  REGRESS: '有退步',
  CONTRADICT: '出现了反例',
  SUPERSEDE: '改写了',
  ARCHIVE: '收起了'
}

// Legacy local v2 digests named facts by their source path; v3 facts carry a
// Chinese label of their own, so this table is only a fallback.
const FACT_LABELS = {
  count: '记录数', attemptsCount: '练习次数', correctCount: '答对题数', questionCount: '题目数',
  attemptOrdinal: '练习序次', todayCorrect: '本次答对', todayTotal: '本次题数',
  baselineCorrect: '基线答对', baselineTotal: '基线题数', missedAssetCount: '失分题集数',
  wrong: '错题数', total: '题目数', overall: '总分', taskResponse: '任务回应',
  coherence: '连贯与衔接', lexical: '词汇', grammar: '语法', averageBand: '平均分',
  previousAverageBand: '上一篇平均分', bandDelta: '分数变化', today: '本篇分数',
  previous: '上一篇分数', delta: '分数变化', dueReviewCount: '到期复习数',
  mastery: '掌握度', recentErrorRate: '近期错误率', essayCount: '涉及作文数', value: '练习结果'
}

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return String(value ?? '').trim()
}

/** A fraction from the host (0.75) as the page writes it (75%). */
export function percent(rate) {
  return rate === null || rate === undefined || !Number.isFinite(Number(rate)) ? '—' : `${Math.round(Number(rate) * 100)}%`
}

/** A band as the host wrote it: 6.5 stays 6.5, 7 stays 7. */
function band(value) {
  return String(count(value))
}

/**
 * One v3 fact as the page writes it. The host decides the unit (`format`);
 * this only writes it: percent is an integer percent, minutes carries 分钟,
 * band and number keep the host's value (6.5 stays 6.5, integers stay integers).
 */
export function weeklyFactValue(fact) {
  const value = fact?.value
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  switch (String(fact?.format || '').toLowerCase()) {
    case 'percent':
      return `${Math.round(number * 100)}%`
    case 'minutes':
      return `${number} 分钟`
    default:
      return String(number)
  }
}

/**
 * No HTML is interpreted. The only generated elements are text, strong, em,
 * code and citation buttons; raw HTML and Markdown links remain escaped text.
 * A `{{f:ID}}` token keeps the fact's label and provenance for the source note.
 */
export function weeklyTokens(value, facts = {}) {
  const chunks = String(value || '').split(/(\{\{[fq]:[^{}]+\}\}|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
  return chunks.filter(Boolean).map((part) => {
    const ref = /^\{\{([fq]):([^{}]+)\}\}$/.exec(part)
    if (ref) {
      const fact = facts[ref[2]]
      return fact
        ? {
            tag: 'ref',
            text: weeklyFactValue(fact),
            id: ref[2],
            source: fact.source,
            label: fact.label || '',
            provenance: fact.provenance || {}
          }
        : { tag: 'span', text: '' }
    }
    if (part.startsWith('**') && part.endsWith('**')) return styledToken('strong', part.slice(2, -2), facts)
    if (part.startsWith('*') && part.endsWith('*')) return styledToken('em', part.slice(1, -1), facts)
    if (part.startsWith('`') && part.endsWith('`')) return styledToken('code', part.slice(1, -1), facts)
    return { tag: 'span', text: part }
  })
}

function styledToken(tag, inner, facts) {
  return { tag, inner, text: weeklyTokens(inner, facts).map((token) => token.text).join('') }
}

export const weeklyText = (value, facts) => weeklyTokens(value, facts).map((token) => token.text).join('')

/** The Chinese name of a fact's source, for citation notes and legacy rows. */
export function weeklyFactLabel(fact = {}) {
  if (text(fact.label)) return text(fact.label)
  if (text(fact.provenance?.label)) return text(fact.provenance.label)
  const key = String(fact.source || '').split('/').at(-1)
  return FACT_LABELS[key] || BLOCK_HEADINGS[key] || (key === 'soul' ? '个人情况' : '练习记录')
}

export function weeklyTarget(target) {
  const key = String(target?.key || '')
  if (!/^[\p{L}\p{N}_.-]{1,160}$/u.test(key)) return null
  if (target.type === 'asset') return `/reading/${encodeURIComponent(key)}`
  if (target.type === 'kind') return { path: '/', query: { view: 'browse', kind: libraryKind(key) } }
  if (target.type === 'writing' && ['task1', 'task2'].includes(key)) return { path: '/writing', query: { taskType: key } }
  return null
}

// Weekly evidence uses domain kinds; library cards use seven display tags.
function libraryKind(key) {
  const aliases = { tfng: 'judgement', ynng: 'judgement', true_false_not_given: 'judgement', yes_no_not_given: 'judgement', matching_headings: 'heading_match', matching_information: 'paragraph_match', matching_features: 'matching', classification: 'matching', short_answer: 'completion' }
  return aliases[key] || (key.endsWith('_completion') ? 'completion' : key)
}

/**
 * A legacy local v2 digest (title, body, one facts map) as display data.
 * Read-only history: the integration never writes this shape again.
 */
export function weeklyV2(digest) {
  const facts = digest?.facts || {}
  const render = (value) => weeklyText(value, facts)
  const body = (digest?.body || []).map(render)
  const groups = ['changes', 'nextSteps', 'strengths', 'weaknesses'].map((key) => ({
    key,
    title: { changes: '变化', nextSteps: '下一步', strengths: '优势', weaknesses: '劣势' }[key],
    items: (digest?.[key] || []).map((item) => ({
      text: typeof item === 'string' ? item : item?.text,
      route: weeklyTarget(item?.target)
    }))
  })).filter((group) => group.items.length)
  const numeric = Object.entries(facts).filter(([, fact]) => typeof fact?.value === 'number')
  const points = groups.flatMap((group) => group.items).filter((item) => /\{\{f:/.test(item.text)).map((item) => render(item.text)).slice(0, 2)
  for (const [, fact] of numeric) {
    if (points.length < 2) points.push(`${weeklyFactLabel(fact)}：${weeklyFactValue(fact)}`)
  }
  return {
    schemaVersion: 2,
    digest,
    facts,
    body,
    groups,
    observations: body,
    changes: [],
    nextPractice: [],
    title: render(digest?.title),
    firstSentence: body[0]?.split(/[。！？]/)[0] || '',
    points,
    practiceCount: digest?.practiceCount || 0
  }
}

/** "10/5" and its weekday "一" for a "YYYY-MM-DD" day. */
export function dayTick(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!match) return { short: String(day || ''), weekday: '' }
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()
  return { short: `${Number(match[2])}/${Number(match[3])}`, weekday: WEEKDAYS[weekday] }
}

/** The viewer's local calendar day ("YYYY-MM-DD") of an instant, or ''. */
function localDay(time) {
  if (Number.isNaN(time.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`
}

/**
 * The window's local days. The start instant is exclusive, so the first day is
 * the one just after it (as the host's week facts count it).
 */
export function windowDays(windowStart, windowEnd) {
  const start = new Date(Date.parse(String(windowStart || '')) + 1000)
  return { startDay: localDay(start), endDay: localDay(new Date(String(windowEnd || ''))) }
}

/** "2026年10月5日 – 10月11日": the window's date range (year repeated only if it changes). */
export function formatWindowRange(startDay, endDay) {
  if (startDay === endDay) return formatJournalDate(startDay)
  const start = formatJournalDate(startDay)
  const end = formatJournalDate(endDay)
  const sameYear = start.slice(0, start.indexOf('年')) === end.slice(0, end.indexOf('年'))
  return `${start} – ${sameYear ? end.slice(end.indexOf('年') + 1) : end}`
}

function stat(label, value, delta = '') {
  return { label, value: String(value), delta }
}

function previousNote(previous, field, unit = '') {
  return previous ? `上周 ${count(previous[field])}${unit}` : ''
}

function dayAria(title, days, describe) {
  return `${title}：${days.map((day) => `${day.label} ${describe(day)}`).join('；')}`
}

function volumeBlock(data) {
  const previous = data.previous || null
  const days = list(data.perDay).map((entry) => ({
    day: String(entry.day || ''),
    label: formatJournalDate(entry.day).replace(/^\d+年/, ''),
    tick: dayTick(entry.day),
    values: [count(entry.reading), count(entry.writing)],
    gap: false
  }))
  const max = Math.max(1, ...days.map((day) => day.values[0] + day.values[1]))
  return {
    stats: [
      stat('阅读', `${count(data.readingAttempts)} 篇`, previousNote(previous, 'readingAttempts', ' 篇')),
      stat('写作', `${count(data.writingEssays)} 篇`, previousNote(previous, 'writingEssays', ' 篇')),
      stat('练习天数', `${count(data.activeDays)} 天`, previousNote(previous, 'activeDays', ' 天')),
      stat('阅读用时', `${count(data.minutes)} 分钟`, previousNote(previous, 'minutes', ' 分钟'))
    ],
    chart: days.length ? {
      kind: 'dayBars',
      max,
      days,
      legend: [{ label: '阅读', tone: 'ink' }, { label: '写作', tone: 'accent' }],
      ariaLabel: dayAria('每天的练习', days, (day) => `阅读 ${day.values[0]} 篇，写作 ${day.values[1]} 篇`)
    } : null
  }
}

function accuracyBlock(data) {
  const previous = data.previous || null
  const days = list(data.perDay).map((entry) => {
    const answered = count(entry.answered)
    const rate = entry.rate === null || entry.rate === undefined ? null : count(entry.rate)
    return {
      day: String(entry.day || ''),
      label: formatJournalDate(entry.day).replace(/^\d+年/, ''),
      tick: dayTick(entry.day),
      values: rate === null ? [] : [rate],
      gap: rate === null,
      note: rate === null ? '没有做题' : `正确 ${count(entry.correct)}/${answered}（${percent(rate)}）`
    }
  })
  const stats = [
    stat('正确率', percent(data.rate), previous ? `上周 ${percent(previous.rate)}` : ''),
    stat('答对', `${count(data.correct)} / ${count(data.answered)}`, previous ? `上周 ${count(previous.correct)} / ${count(previous.answered)}` : '')
  ]
  if (count(data.blank) > 0) stats.push(stat('空着', `${count(data.blank)} 题`, `共 ${count(data.total)} 题`))
  return {
    stats,
    chart: days.length ? {
      kind: 'dayBars',
      max: 1,
      days,
      legend: [],
      ariaLabel: dayAria('每天的正确率', days, (day) => day.note)
    } : null
  }
}

function questionTypesBlock(data) {
  const rows = list(data.types).map((type) => ({
    key: String(type.qtype || ''),
    label: text(type.label),
    part: count(type.wrong),
    total: count(type.answered),
    text: `错 ${count(type.wrong)} / ${count(type.answered)}`,
    note: `${count(type.passages)} 篇文章`
  }))
  return {
    rows: [],
    chart: rows.length ? {
      kind: 'hBars',
      max: Math.max(1, ...rows.map((row) => row.total)),
      rows,
      ariaLabel: `各题型错题：${rows.map((row) => `${row.label} 错 ${row.part} 题，共 ${row.total} 题`).join('；')}`
    } : null
  }
}

function repeatedMissesBlock(data) {
  const across = list(data.acrossPassages).map((entry) => ({
    key: `type:${entry.qtype}`,
    text: `${text(entry.label)}：在 ${count(entry.passages)} 篇文章里错了 ${count(entry.wrong)} 题`
  }))
  const same = list(data.sameQuestion).map((entry) => ({
    key: `question:${entry.assetId}:${entry.question}`,
    text: `「${text(entry.title)}」${text(entry.question)}：做了 ${count(entry.attempts)} 次都错`
  }))
  return { rows: [...across, ...same] }
}

function labels(value) {
  return list(value).map(text).filter(Boolean).join('、')
}

function redoBlock(data) {
  const fixed = count(data.fixed)
  const still = count(data.stillWrong)
  const newly = count(data.newlyWrong)
  const segments = [
    { label: '改对', value: fixed, tone: 'success' },
    { label: '仍错', value: still, tone: 'warning' },
    { label: '新错', value: newly, tone: 'danger' }
  ]
  const rows = list(data.items).map((item) => ({
    key: `${item.assetId}:${item.day}`,
    text: [
      `「${text(item.title)}」${dayTick(item.day).short}`,
      labels(item.fixed) && `改对 ${labels(item.fixed)}`,
      labels(item.stillWrong) && `仍错 ${labels(item.stillWrong)}`,
      labels(item.newlyWrong) && `新错 ${labels(item.newlyWrong)}`
    ].filter(Boolean).join('　')
  }))
  return {
    stats: [stat('重做', `${count(data.redos)} 篇`), ...segments.map((segment) => stat(segment.label, `${segment.value} 题`))],
    rows,
    chart: fixed + still + newly > 0 ? {
      kind: 'stackBar',
      total: fixed + still + newly,
      segments,
      ariaLabel: `重做结果：${segments.map((segment) => `${segment.label} ${segment.value} 题`).join('，')}`
    } : null
  }
}

function writingBlock(data) {
  const previous = data.previous || null
  const essays = list(data.essays)
  const points = essays.map((essay, index) => ({
    key: `${essay.day}:${index}`,
    label: dayTick(essay.day).short,
    value: count(essay.band),
    note: `${text(essay.taskType)} ${band(essay.band)}`
  }))
  const stats = [
    stat('平均', band(data.average), previous ? `上周 ${band(previous.average)}（${count(previous.essays)} 篇）` : ''),
    stat('最高', band(data.best)),
    stat('作文', `${essays.length} 篇`)
  ]
  const weakest = data.weakest
  return {
    stats,
    rows: weakest ? [{ key: `weakest:${weakest.criterion}`, text: `最常落在最低两项里的是${text(weakest.label)}（${count(weakest.timesLowest)} 次）` }] : [],
    chart: points.length ? {
      kind: 'bandLine',
      min: 4,
      max: 9,
      points,
      ariaLabel: `每篇作文的分数：${points.map((point) => `${point.label} ${point.note}`).join('；')}`
    } : null
  }
}

function coachBlock(data) {
  return {
    stats: [stat('用到教练的练习', `${count(data.attempts)} 次`), stat('再问', `${count(data.reasks)} 次`)],
    tags: list(data.feedback).map((entry) => ({ key: String(entry.kind || ''), text: `${text(entry.label)} × ${count(entry.count)}` }))
  }
}

function planBlock(data, examples) {
  const items = list(data.items).map((item, index) => ({
    key: String(item.skillKey || index),
    label: text(item.label),
    probeLabel: text(item.probeLabel),
    minutes: count(item.minutes),
    link: examples[index]?.link || null
  }))
  return { plan: { items, totalMinutes: count(data.totalMinutes) } }
}

const BUILDERS = {
  volume: volumeBlock,
  accuracy: accuracyBlock,
  question_types: questionTypesBlock,
  repeated_misses: repeatedMissesBlock,
  redo_progress: redoBlock,
  writing_bands: writingBlock,
  coach_signals: coachBlock,
  next_week_plan: planBlock
}

function readExamples(value) {
  return list(value)
    .filter((example) => example?.link?.name)
    .map((example, index) => ({
      key: `${index}:${example.label}`,
      label: text(example.label),
      detail: text(example.detail),
      link: { name: String(example.link.name), params: { ...(example.link.params || {}) } }
    }))
}

/**
 * One block as the page lays it out, or null for a kind this page does not
 * know. `options.legacy` keeps the v2 per-block sentence; a v3 report never
 * shows one (the narrative is the only prose).
 */
export function buildBlock(block, options = {}) {
  const build = BUILDERS[block?.kind]
  if (!build) return null
  const examples = readExamples(block.examples)
  const view = build(block.data && typeof block.data === 'object' ? block.data : {}, examples)
  return {
    id: String(block.id || block.kind),
    kind: block.kind,
    heading: BLOCK_HEADINGS[block.kind],
    lead: options.legacy === false ? '' : text(block.narrative),
    stats: [],
    rows: [],
    tags: [],
    chart: null,
    plan: null,
    ...view
  }
}

function memoryChanges(value) {
  return list(value)
    .map((change) => ({
      key: `${change.action}:${change.memoryId}`,
      action: MEMORY_ACTIONS[String(change.action || '').toUpperCase()] || '',
      statement: text(change.statement).replace(/[。．.!！?？\s]+$/u, '')
    }))
    .filter((change) => change.action && change.statement)
}

const GROUP_TITLES = { changes: '变化', nextSteps: '下一步', strengths: '优势', weaknesses: '劣势' }

function narrativeGroups(narrative) {
  return Object.entries(GROUP_TITLES)
    .map(([key, title]) => ({
      key,
      title,
      items: list(narrative?.[key])
        .map((item) => typeof item === 'string'
          ? { text: item, route: null }
          : { text: text(item?.text), route: weeklyTarget(item?.target) })
        .filter((item) => item.text)
    }))
    .filter((group) => group.items.length)
}

function plainFirstSentence(value) {
  return value.split(/[。！？!?]/)[0] || ''
}

// The card's points are narrative sentences that cite facts, in group order.
function narrativePoints(groups, facts) {
  const points = []
  for (const group of groups) {
    for (const item of group.items) {
      if (!/\{\{[fq]:/.test(item.text)) continue
      const point = weeklyText(item.text, facts)
      if (point && !points.includes(point)) points.push(point)
      if (points.length === 2) return points
    }
  }
  return points
}

function reportPracticeCount(report, facts, legacy) {
  const fact = facts['volume.total']
  const countValue = Number(fact?.value)
  if (Number.isFinite(countValue)) return countValue
  if (!legacy) return null
  const legacyValue = Number(report?.practiceCount)
  return Number.isFinite(legacyValue) ? legacyValue : null
}

/**
 * One weekly report as a notebook entry, or null when it has nothing to show.
 *
 * v3: `title` is `displayTitle` verbatim (Rust owns the one derivation);
 * `paragraphs` are the narrative's raw fact-placeholder paragraphs (WeeklyText
 * turns them into prose with clickable citations), `body` is the same text
 * rendered plain for summaries, and `groups` are the actionable lines with
 * their routes. `blocks` are the typed data appendix. A state other than a
 * complete `final` (or a final without a body) carries no narrative at all.
 *
 * v1/v2: read-only blocks and the stored `title`.
 */
export function buildWeeklyReport(report) {
  const window = text(report?.window)
  const { startDay, endDay } = windowDays(report?.windowStart, report?.windowEnd)
  if (!window || !startDay || !endDay) return null
  const schemaVersion = Number(report?.schemaVersion) || 0
  const legacy = schemaVersion < 3
  const state = String(report?.state || '')
  const blocks = list(report?.blocks).map((block) => buildBlock(block, { legacy })).filter(Boolean)
  const narrative = !legacy && state === 'final' && report?.narrative && typeof report.narrative === 'object'
    ? report.narrative
    : null
  const paragraphs = narrative ? list(narrative.body).map(text).filter(Boolean) : []
  const facts = !legacy && report?.facts && typeof report.facts === 'object' ? report.facts : {}
  const body = paragraphs.map((line) => weeklyText(line, facts))
  const hasNarrative = body.length > 0
  const groups = hasNarrative ? narrativeGroups(narrative) : []
  if (!blocks.length && !hasNarrative) return null
  return {
    key: `${state === 'live' ? 'live' : 'week'}:${window}`,
    window,
    state,
    schemaVersion,
    startDay,
    endDay,
    dateLabel: formatWindowRange(startDay, endDay),
    title: legacy ? text(report?.title) || '这一周' : String(report?.displayTitle ?? ''),
    facts,
    paragraphs,
    body,
    groups,
    askUser: hasNarrative && narrative.askUser && typeof narrative.askUser === 'object' ? narrative.askUser : null,
    firstSentence: hasNarrative ? plainFirstSentence(body[0]) : legacy ? text(blocks[0]?.lead) : '',
    points: hasNarrative ? narrativePoints(groups, facts) : [],
    practiceCount: reportPracticeCount(report, facts, legacy),
    stateLine: STATE_LINES[state] || null,
    blocks,
    memoryChanges: memoryChanges(report?.memoryChanges)
  }
}

/**
 * The weekly entries in page order: this week's live report first, then the
 * finished weeks newest first. A v3 report is the final word for its week, so a
 * legacy v1/v2 digest of the same week is dropped; legacy weeks fill the older
 * history the report list no longer covers.
 */
export function weeklyEntries(current, persisted, legacy = []) {
  const finished = list(persisted).map(buildWeeklyReport).filter(Boolean)
  const weeks = new Set(finished.map((entry) => entry.window))
  const older = []
  for (const entry of list(legacy)) {
    if (!entry?.window || weeks.has(entry.window)) continue
    weeks.add(entry.window)
    older.push(entry)
  }
  const ordered = [...finished, ...older]
    .sort((left, right) => right.endDay.localeCompare(left.endDay) || right.window.localeCompare(left.window))
  const live = current ? buildWeeklyReport(current) : null
  const fresh = live && !ordered.some((entry) => entry.window === live.window)
  return fresh ? [live, ...ordered] : ordered
}

export function weekThursday(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(week?.window || '')
  if (!match) return new Date(`${week?.startDay}T00:00:00Z`)
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4))
  jan4.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() + 6) % 7 + (Number(match[2]) - 1) * 7 + 3)
  return jan4
}

export const weeklyMonth = (week) => weekThursday(week).toISOString().slice(0, 7)

// Global numbering by window start: the first generated week is 1, and switching
// months never renumbers a card. Newest first, like the report list.
export function weeklySequence(weeks) {
  return [...list(weeks)]
    .sort((left, right) => String(left.startDay).localeCompare(right.startDay) || String(left.window).localeCompare(right.window))
    .map((week, index) => ({ ...week, sequence: index + 1 }))
    .reverse()
}

export function weeklyMonthSlots(weeks, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) return []
  const date = new Date(`${month}-01T00:00:00Z`)
  const slots = []
  while (date.toISOString().startsWith(month)) {
    if (date.getUTCDay() === 4) {
      const day = date.toISOString().slice(0, 10)
      const week = list(weeks).find((entry) => weekThursday(entry).toISOString().slice(0, 10) === day) || null
      slots.push({ day, week })
    }
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return slots
}
