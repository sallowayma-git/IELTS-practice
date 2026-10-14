import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BLOCK_HEADINGS,
  STATE_LINES,
  buildBlock,
  buildWeeklyReport,
  weeklyEntries
} from '../../../apps/writing-vue/src/modules/notebook/weekly.js'

// Window instants are read as the viewer's local days; pin the zone so the
// expected dates hold wherever the suite runs.
process.env.TZ = 'Asia/Shanghai'

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
const review = (assetId, sessionId) => ({ name: 'PracticeReadingReview', params: { assetId, sessionId } })

// A WeeklyReport as crates/ielts-domain/src/weekly_report.rs serialises it,
// with block data shaped exactly as the block spec says.
function report(overrides = {}) {
  return {
    schemaVersion: 2,
    window: '2026-W41',
    windowStart: '2026-10-04T15:59:59Z',
    windowEnd: '2026-10-11T15:00:00Z',
    state: 'final',
    generatedAt: '2026-10-11T15:00:00Z',
    title: '判断题在三篇文章里反复出错',
    blocks: [
      {
        id: 'volume', kind: 'volume', memoryIds: [], examples: [],
        narrative: '这一周读了 6 篇，写了 2 篇。',
        data: {
          readingAttempts: 6, writingEssays: 2, activeDays: 5, minutes: 128,
          perDay: DAYS.map((day, index) => ({ day, reading: [2, 1, 0, 1, 2, 0, 0][index], writing: [0, 1, 0, 0, 0, 1, 0][index] })),
          previous: { readingAttempts: 4, writingEssays: 1, activeDays: 3, minutes: 90 }
        }
      },
      {
        id: 'accuracy', kind: 'accuracy', memoryIds: [],
        data: {
          correct: 58, answered: 78, blank: 2, total: 80, rate: 0.74,
          perDay: DAYS.map((day, index) => [
            { day, correct: 20, answered: 26, rate: 0.77 }, { day, correct: 9, answered: 13, rate: 0.69 },
            { day, correct: 0, answered: 0, rate: null }, { day, correct: 10, answered: 13, rate: 0.77 },
            { day, correct: 19, answered: 26, rate: 0.73 }, { day, correct: 0, answered: 0, rate: null },
            { day, correct: 0, answered: 0, rate: null }
          ][index]),
          previous: { correct: 30, answered: 52, rate: 0.58 }
        },
        examples: [{ label: '「The Life of Bees」', detail: '正确 9/13', link: review('p2-mid-07', 'attempt-12') }]
      },
      {
        id: 'question_types', kind: 'question_types', memoryIds: ['mem-tfng'],
        data: { types: [
          { qtype: 'tfng', label: '判断题', wrong: 7, answered: 18, rate: 0.61, passages: 3 },
          { qtype: 'matching_headings', label: '段落大意配对', wrong: 4, answered: 14, rate: 0.71, passages: 2 }
        ] },
        examples: [{ label: '「The Life of Bees」q5', detail: '判断题', link: review('p2-mid-07', 'attempt-12') }]
      },
      {
        id: 'repeated_misses', kind: 'repeated_misses', memoryIds: ['mem-tfng'],
        data: {
          acrossPassages: [{ qtype: 'tfng', label: '判断题', passages: 3, wrong: 7 }],
          sameQuestion: [{ assetId: 'p2-mid-07', title: 'The Life of Bees', question: 'q5', attempts: 2 }]
        },
        examples: []
      },
      {
        id: 'redo_progress', kind: 'redo_progress', memoryIds: [],
        data: {
          redos: 2, fixed: 3, stillWrong: 1, newlyWrong: 1,
          items: [{ assetId: 'p2-mid-07', title: 'The Life of Bees', day: '2026-10-09', fixed: ['q5', 'q9'], stillWrong: ['q11'], newlyWrong: ['q3'] }]
        },
        examples: [{ label: '「The Life of Bees」', link: review('p2-mid-07', 'attempt-15') }]
      },
      {
        id: 'writing_bands', kind: 'writing_bands', memoryIds: [],
        data: {
          essays: [
            { day: '2026-10-06', taskType: 'Task 2', band: 6, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 5.5 }] },
            { day: '2026-10-10', taskType: 'Task 1', band: 6.5, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 6 }] }
          ],
          average: 6.3, best: 6.5,
          weakest: { criterion: 'coherence', label: '连贯与衔接', timesLowest: 2 },
          previous: null
        },
        examples: [{ label: 'Task 1 6.5', link: { name: 'Result', params: { sessionId: 'writing-41' } } }]
      },
      {
        id: 'coach_signals', kind: 'coach_signals', memoryIds: [],
        data: { feedback: [{ kind: 'too_long', label: '太长', count: 2 }, { kind: 'thumbs_up', label: '有帮助', count: 1 }], reasks: 1, attempts: 2 },
        examples: []
      },
      {
        id: 'next_week_plan', kind: 'next_week_plan', memoryIds: [],
        data: {
          items: [
            { skillKey: 'reading.tfng', label: '判断题', priorityBand: 'urgent', probe: 'contrastive_pair', probeLabel: '对比练习易混题', reasons: ['recent_errors'], minutes: 15 },
            { skillKey: 'writing.coherence', label: '写作 · 连贯与衔接', priorityBand: 'high', probe: 'writing_rewrite', probeLabel: '改写一段作文', reasons: ['low_mastery_estimate'], minutes: 15 }
          ],
          totalMinutes: 30
        },
        examples: [
          { label: '判断题', link: { name: 'PracticeLibrary' } },
          { label: '写作 · 连贯与衔接', link: { name: 'Compose' } }
        ]
      }
    ],
    memoryChanges: [
      { action: 'REINFORCE', memoryId: 'mem-tfng', statement: '判断题中，你常把“未提及”误判为“错误”。' },
      { action: 'NOOP', memoryId: 'mem-pref', statement: '你更喜欢先看例句。' }
    ],
    ...overrides
  }
}

function numbersIn(text) {
  return [...String(text).matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
}

function numbersInValue(value, out = new Set()) {
  if (typeof value === 'number') {
    out.add(value)
    if (value > 0 && value < 1) out.add(Math.round(value * 100))
  } else if (typeof value === 'string') {
    numbersIn(value).forEach((number) => out.add(number))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => numbersInValue(item, out))
  }
  return out
}

test('a finished week reads as one entry: title, local date range, blocks in host order', () => {
  const entry = buildWeeklyReport(report())
  assert.equal(entry.title, '判断题在三篇文章里反复出错')
  // The start instant is exclusive: one second before local midnight opens the 5th.
  assert.equal(entry.startDay, '2026-10-05')
  assert.equal(entry.endDay, '2026-10-11')
  assert.equal(entry.dateLabel, '2026年10月5日 – 10月11日')
  assert.equal(entry.stateLine, null)
  assert.deepEqual(entry.blocks.map((block) => block.kind), [
    'volume', 'accuracy', 'question_types', 'repeated_misses', 'redo_progress', 'writing_bands', 'coach_signals', 'next_week_plan'
  ])
  assert.deepEqual(entry.blocks.map((block) => block.heading), Object.values(BLOCK_HEADINGS))
  assert.equal(entry.blocks[0].lead, '这一周读了 6 篇，写了 2 篇。')
  assert.equal(entry.blocks[1].lead, '')
})

test('every number the page writes is a number the block data carries', () => {
  for (const block of report().blocks) {
    const view = buildBlock(block)
    const shown = [
      ...view.stats.flatMap((item) => [item.value, item.delta]),
      ...view.rows.map((row) => row.text),
      ...view.tags.map((tag) => tag.text),
      ...(view.plan ? view.plan.items.map((item) => item.minutes).concat(view.plan.totalMinutes) : []),
      view.chart?.ariaLabel || ''
    ]
    const allowed = numbersInValue(block.data)
    // Dates in chart labels ("10月5日", "10/5") come from the data's days.
    DAYS.forEach((day) => day.split('-').forEach((part) => allowed.add(Number(part))))
    for (const number of shown.flatMap(numbersIn)) {
      assert.ok(allowed.has(number), `${block.kind}: ${number} is not in its data (${shown.join(' | ')})`)
    }
  }
})

test('volume and accuracy: stats with last week, per-day charts with gaps for days without questions', () => {
  const [volume, accuracy] = buildWeeklyReport(report()).blocks
  assert.deepEqual(volume.stats.map((item) => [item.label, item.value, item.delta]), [
    ['阅读', '6 篇', '上周 4 篇'], ['写作', '2 篇', '上周 1 篇'], ['练习天数', '5 天', '上周 3 天'], ['阅读用时', '128 分钟', '上周 90 分钟']
  ])
  assert.equal(volume.chart.kind, 'dayBars')
  assert.equal(volume.chart.days.length, 7)
  assert.deepEqual(volume.chart.days[1].values, [1, 1])
  assert.equal(volume.chart.max, 2)
  assert.deepEqual(volume.chart.days.map((day) => day.tick.weekday), ['一', '二', '三', '四', '五', '六', '日'])
  assert.ok(volume.chart.ariaLabel.includes('10月6日 阅读 1 篇，写作 1 篇'), volume.chart.ariaLabel)

  assert.deepEqual(accuracy.stats.map((item) => [item.label, item.value, item.delta]), [
    ['正确率', '74%', '上周 58%'], ['答对', '58 / 78', '上周 30 / 52'], ['空着', '2 题', '共 80 题']
  ])
  assert.equal(accuracy.chart.max, 1)
  assert.deepEqual(accuracy.chart.days.map((day) => day.gap), [false, false, true, false, false, true, true])
  assert.deepEqual(accuracy.chart.days[2].values, [])
  assert.ok(accuracy.chart.ariaLabel.includes('10月7日 没有做题'))
  assert.deepEqual(accuracy.examples, [{
    key: '0:「The Life of Bees」', label: '「The Life of Bees」', detail: '正确 9/13', link: review('p2-mid-07', 'attempt-12')
  }])
})

test('question types, repeats, redo, writing and coach blocks keep the host order and labels', () => {
  const blocks = Object.fromEntries(buildWeeklyReport(report()).blocks.map((block) => [block.kind, block]))
  const types = blocks.question_types.chart
  assert.equal(types.kind, 'hBars')
  assert.equal(types.max, 18)
  assert.deepEqual(types.rows.map((row) => [row.label, row.part, row.total, row.text]), [
    ['判断题', 7, 18, '错 7 / 18'], ['段落大意配对', 4, 14, '错 4 / 14']
  ])
  assert.deepEqual(blocks.repeated_misses.rows.map((row) => row.text), [
    '判断题：在 3 篇文章里错了 7 题', '「The Life of Bees」q5：做了 2 次都错'
  ])
  const redo = blocks.redo_progress
  assert.deepEqual(redo.chart.segments.map((segment) => [segment.label, segment.value]), [['改对', 3], ['仍错', 1], ['新错', 1]])
  assert.equal(redo.rows[0].text, '「The Life of Bees」10/9　改对 q5、q9　仍错 q11　新错 q3')
  const writing = blocks.writing_bands
  assert.deepEqual(writing.chart.points.map((point) => [point.label, point.value]), [['10/6', 6], ['10/10', 6.5]])
  assert.deepEqual(writing.stats.map((item) => item.value), ['6.3', '6.5', '2 篇'])
  assert.equal(writing.stats[0].delta, '', 'no previous essays: no comparison')
  assert.equal(writing.rows[0].text, '最常落在最低两项里的是连贯与衔接（2 次）')
  assert.deepEqual(blocks.coach_signals.tags.map((tag) => tag.text), ['太长 × 2', '有帮助 × 1'])
})

test('the plan is the 下一步练习 list: label, probe, minutes, each item linked to where to practise', () => {
  const plan = buildWeeklyReport(report()).blocks.at(-1)
  assert.equal(plan.heading, '下一步练习')
  assert.deepEqual(plan.examples, [], 'plan links live on the items')
  assert.deepEqual(plan.plan, {
    totalMinutes: 30,
    items: [
      { key: 'reading.tfng', label: '判断题', probeLabel: '对比练习易混题', minutes: 15, link: { name: 'PracticeLibrary', params: {} } },
      { key: 'writing.coherence', label: '写作 · 连贯与衔接', probeLabel: '改写一段作文', minutes: 15, link: { name: 'Compose', params: {} } }
    ]
  })
})

test('state lines: live and the two degraded finals say so; final says nothing', () => {
  assert.equal(buildWeeklyReport(report({ state: 'live' })).stateLine.text, '本周进行中，周末会整理成完整周记')
  const noAi = buildWeeklyReport(report({ state: 'final_no_ai' })).stateLine
  assert.deepEqual(noAi, STATE_LINES.final_no_ai)
  assert.equal(noAi.settings, true)
  assert.equal(buildWeeklyReport(report({ state: 'narrative_failed' })).stateLine.text,
    'AI 总结这次没写成，会自动重试；下面的数据已经是这一周的最终结果')
  assert.equal(buildWeeklyReport(report({ state: 'final' })).stateLine, null)
})

test('memory changes are labelled sentences; a no-op or unknown action is not shown', () => {
  assert.deepEqual(buildWeeklyReport(report()).memoryChanges, [
    { key: 'REINFORCE:mem-tfng', action: '更确定了', statement: '判断题中，你常把“未提及”误判为“错误”' }
  ])
  assert.deepEqual(buildWeeklyReport(report({ memoryChanges: undefined })).memoryChanges, [])
})

test('entries: the live week first, then finished weeks newest first; empty or unreadable reports are dropped', () => {
  const week = (window, start, end, state = 'final') => report({ window, windowStart: start, windowEnd: end, state })
  const w40 = week('2026-W40', '2026-09-27T15:59:59Z', '2026-10-04T15:00:00Z')
  const w41 = week('2026-W41', '2026-10-04T15:59:59Z', '2026-10-11T15:00:00Z')
  const live = week('2026-W42', '2026-10-11T15:59:59Z', '2026-10-13T04:00:00Z', 'live')
  assert.deepEqual(weeklyEntries(live, [w40, w41]).map((entry) => entry.key), ['live:2026-W42', 'week:2026-W41', 'week:2026-W40'])
  assert.deepEqual(weeklyEntries(null, [w41]).map((entry) => entry.key), ['week:2026-W41'])
  assert.deepEqual(weeklyEntries({ ...w41, state: 'live' }, [w41]).map((entry) => entry.key), ['week:2026-W41'])
  assert.deepEqual(weeklyEntries(null, null), [])
  assert.equal(buildWeeklyReport(report({ blocks: [] })), null)
  assert.equal(buildWeeklyReport(report({ window: '' })), null)
  assert.equal(buildWeeklyReport(report({ windowStart: 'garbage' })), null)
  assert.equal(buildWeeklyReport(null), null)
  // A kind this page does not know yet is skipped, the rest still shows.
  const future = buildWeeklyReport(report({ blocks: [{ id: 'x', kind: 'listening', data: {} }, report().blocks[0]] }))
  assert.deepEqual(future.blocks.map((block) => block.kind), ['volume'])
  // A window spanning New Year repeats the year.
  assert.equal(buildWeeklyReport(week('2026-W53', '2026-12-27T15:59:59Z', '2027-01-03T15:00:00Z')).dateLabel, '2026年12月28日 – 2027年1月3日')
})
