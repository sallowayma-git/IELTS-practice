/**
 * 札记 weekly report (v2) — typed blocks into display data.
 *
 * The host computes every number (crates/ielts-domain/src/weekly_report.rs and
 * the block skills); this module only picks, labels and formats them, and
 * shapes each chart's series. Nothing here adds, averages or compares: a value
 * the page shows is a value the block's data carries.
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

/** One block as the page lays it out, or null for a kind this page does not know. */
export function buildBlock(block) {
  const build = BUILDERS[block?.kind]
  if (!build) return null
  const examples = readExamples(block.examples)
  const view = build(block.data && typeof block.data === 'object' ? block.data : {}, examples)
  return {
    id: String(block.id || block.kind),
    kind: block.kind,
    heading: BLOCK_HEADINGS[block.kind],
    lead: text(block.narrative),
    stats: [],
    rows: [],
    tags: [],
    chart: null,
    plan: null,
    ...view,
    // The plan's links sit on its items; every other block lists its examples.
    examples: block.kind === 'next_week_plan' ? [] : examples
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

/** One weekly report as a notebook entry, or null when it has nothing to show. */
export function buildWeeklyReport(report) {
  const window = text(report?.window)
  const { startDay, endDay } = windowDays(report?.windowStart, report?.windowEnd)
  const blocks = list(report?.blocks).map(buildBlock).filter(Boolean)
  if (!window || !startDay || !endDay || !blocks.length) return null
  const state = String(report.state || '')
  return {
    key: `${state === 'live' ? 'live' : 'week'}:${window}`,
    window,
    state,
    startDay,
    endDay,
    dateLabel: formatWindowRange(startDay, endDay),
    title: text(report.title) || '这一周',
    stateLine: STATE_LINES[state] || null,
    blocks,
    memoryChanges: memoryChanges(report.memoryChanges)
  }
}

/**
 * The weekly entries in page order: this week's live report first, then the
 * finished weeks newest first. A live report for a week that is already
 * finished is dropped (the finished one is the final word).
 */
export function weeklyEntries(current, persisted) {
  const finished = list(persisted)
    .map(buildWeeklyReport)
    .filter(Boolean)
    .sort((left, right) => right.endDay.localeCompare(left.endDay) || right.window.localeCompare(left.window))
  const live = current ? buildWeeklyReport(current) : null
  const fresh = live && !finished.some((entry) => entry.window === live.window)
  return fresh ? [live, ...finished] : finished
}
