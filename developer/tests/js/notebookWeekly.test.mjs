import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BLOCK_HEADINGS,
  STATE_LINES,
  buildBlock,
  buildWeeklyReport,
  weeklyEntries,
  weeklyFactLabel,
  weeklyFactValue,
  weeklyMonth,
  weeklyMonthSlots,
  weeklySequence,
  weeklyTarget,
  weeklyText,
  weeklyTokens
} from '../../../apps/writing-vue/src/modules/notebook/weekly.js'

// Window instants are read as the viewer's local days; pin the zone so the
// expected dates hold wherever the suite runs.
process.env.TZ = 'Asia/Shanghai'

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
const review = (assetId, sessionId) => ({ name: 'PracticeReadingReview', params: { assetId, sessionId } })

// A v3 WeeklyReport as crates/ielts-domain/src/weekly_report.rs serialises it:
// typed blocks, the projected fact map, and the model's validated narrative.
// `displayTitle` deliberately differs from what the volume block would derive.
function report(overrides = {}) {
  return {
    schemaVersion: 3,
    window: '2026-W41',
    windowStart: '2026-10-04T15:59:59Z',
    windowEnd: '2026-10-11T15:00:00Z',
    state: 'final',
    generatedAt: '2026-10-11T15:00:00Z',
    displayTitle: '判断词要读慢一点',
    blocks: [
      {
        id: 'volume', kind: 'volume', memoryIds: [], examples: [],
        // A v3 block never carries a sentence; if one leaks in, it is ignored.
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
    facts: {
      'volume.reading': { value: 6, label: '本周阅读篇数', format: 'number', source: 'volume', provenance: {} },
      'volume.writing': { value: 2, label: '本周作文篇数', format: 'number', source: 'volume', provenance: {} },
      'volume.total': { value: 8, label: '本周练习总数', format: 'number', source: 'volume', provenance: {} },
      'volume.days': { value: 5, label: '本周练习天数', format: 'number', source: 'volume', provenance: {} },
      'volume.minutes': { value: 128, label: '本周阅读时长', format: 'minutes', source: 'volume', provenance: {} },
      'accuracy.rate': {
        value: 0.74, label: '本周正确率', format: 'percent', source: 'accuracy',
        provenance: { assetId: 'p2-mid-07', assetIds: ['p2-mid-07'], memoryIds: ['mem-tfng'] }
      },
      'qtype.tfng.wrong': {
        value: 7, label: '「判断题」错题数', format: 'number', source: 'question_types',
        provenance: { assetIds: ['p1', 'p2'] }
      },
      'writing.average': { value: 6.3, label: '本周作文平均分', format: 'band', source: 'writing_bands', provenance: {} }
    },
    narrative: {
      title: '判断词要读慢一点',
      body: [
        '这一周你读了 {{f:volume.reading}} 篇阅读，正确率 {{f:accuracy.rate}}。',
        '把慢下来的地方记下来，下一周再试。'
      ],
      changes: [{ text: '正确率到了 {{f:accuracy.rate}}，比上周稳。' }],
      nextSteps: [
        { text: '把错的 {{f:qtype.tfng.wrong}} 道判断题重做一遍。', target: { type: 'kind', key: 'tfng' } },
        { text: '再写 {{f:volume.writing}} 篇作文。', target: { type: 'writing', key: 'task2' } }
      ],
      strengths: [{ text: '「The Life of Bees」读得不错。', target: { type: 'asset', key: 'p2-mid-07' } }],
      weaknesses: [{ text: '阅读用时 {{f:volume.minutes}}，偏长。' }],
      askUser: { key: 'soul.targetBand', question: '下次考试想考几分？' },
      validation: { final: { droppedSentences: 0, needsRepair: false, violations: [] } }
    },
    profileEdits: [],
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

test('a finished week shows displayTitle verbatim, the local date range and the host data blocks', () => {
  const entry = buildWeeklyReport(report())
  assert.equal(entry.title, '判断词要读慢一点')
  assert.notEqual(entry.title, '这一周读了 6 篇，写了 2 篇', 'the page never derives a title from blocks')
  assert.equal(buildWeeklyReport(report({ displayTitle: '' })).title, '', 'an absent title is not filled in')
  assert.equal(buildWeeklyReport(report({ displayTitle: '  判断词要读慢一点  ' })).title, '  判断词要读慢一点  ', 'the host title is not rewritten')
  // The start instant is exclusive: one second before local midnight opens the 5th.
  assert.equal(entry.startDay, '2026-10-05')
  assert.equal(entry.endDay, '2026-10-11')
  assert.equal(entry.dateLabel, '2026年10月5日 – 10月11日')
  assert.equal(entry.stateLine, null)
  assert.deepEqual(entry.blocks.map((block) => block.kind), [
    'volume', 'accuracy', 'question_types', 'repeated_misses', 'redo_progress', 'writing_bands', 'coach_signals', 'next_week_plan'
  ])
  assert.deepEqual(entry.blocks.map((block) => block.heading), Object.values(BLOCK_HEADINGS))
  for (const block of entry.blocks) {
    assert.equal(block.lead, '', `${block.kind}: a v3 block carries no sentence of its own`)
  }
})

test('a final narrative is the only prose: paragraphs, groups, routes, ask and points', () => {
  const entry = buildWeeklyReport(report())

  assert.deepEqual(entry.paragraphs, [
    '这一周你读了 {{f:volume.reading}} 篇阅读，正确率 {{f:accuracy.rate}}。',
    '把慢下来的地方记下来，下一周再试。'
  ])
  assert.deepEqual(entry.body, [
    '这一周你读了 6 篇阅读，正确率 74%。',
    '把慢下来的地方记下来，下一周再试。'
  ])
  assert.equal(entry.firstSentence, '这一周你读了 6 篇阅读，正确率 74%')

  assert.deepEqual(entry.groups.map((group) => [group.key, group.title]), [
    ['changes', '变化'], ['nextSteps', '下一步'], ['strengths', '优势'], ['weaknesses', '劣势']
  ])
  const groups = Object.fromEntries(entry.groups.map((group) => [group.key, group]))
  assert.equal(groups.changes.items[0].text, '正确率到了 {{f:accuracy.rate}}，比上周稳。')
  assert.equal(groups.changes.items[0].route, null)
  assert.deepEqual(groups.nextSteps.items.map((item) => item.route), [
    { path: '/', query: { view: 'browse', kind: 'judgement' } },
    { path: '/writing', query: { taskType: 'task2' } }
  ])
  assert.equal(groups.strengths.items[0].route, '/reading/p2-mid-07')
  assert.equal(groups.weaknesses.items[0].route, null)

  assert.deepEqual(entry.points, [
    '正确率到了 74%，比上周稳。',
    '把错的 7 道判断题重做一遍。'
  ], 'the card points are cited narrative lines, never new sentences')
  assert.deepEqual(entry.askUser, { key: 'soul.targetBand', question: '下次考试想考几分？' })
  assert.equal(entry.practiceCount, 8, 'the host projects the total; the page does not add blocks up')

  // A narrative without blocks is still a readable week; blocks without either
  // prose or a known kind are not.
  const narrativeOnly = buildWeeklyReport(report({ blocks: [] }))
  assert.equal(narrativeOnly.blocks.length, 0)
  assert.equal(narrativeOnly.body.length, 2)
  assert.equal(narrativeOnly.title, '判断词要读慢一点')
})

test('live, final_no_ai and narrative_failed render data only, even with a stored narrative', () => {
  for (const state of ['live', 'final_no_ai', 'narrative_failed']) {
    const entry = buildWeeklyReport(report({ state }))
    assert.equal(entry.title, '判断词要读慢一点', `${state}: the host title still shows`)
    assert.deepEqual(entry.paragraphs, [], `${state}: no narrative paragraphs`)
    assert.deepEqual(entry.body, [], `${state}: no rendered prose`)
    assert.deepEqual(entry.groups, [], `${state}: no actionable prose`)
    assert.equal(entry.askUser, null, `${state}: no question`)
    assert.deepEqual(entry.points, [], `${state}: no points invented`)
    assert.equal(entry.firstSentence, '', `${state}: no excerpt`)
    assert.equal(entry.blocks.length, 8, `${state}: the data blocks still show`)
    assert.deepEqual(entry.stateLine, STATE_LINES[state])
  }
  for (const block of buildWeeklyReport(report({ state: 'live' })).blocks) {
    assert.equal(block.lead, '', 'a live block carries no sentence either')
  }

  // A final without a usable body is data-only too; it has no state line.
  const bodyless = buildWeeklyReport(report({ narrative: { ...report().narrative, body: ['   '] } }))
  assert.deepEqual(bodyless.body, [])
  assert.deepEqual(bodyless.groups, [])
  assert.equal(bodyless.askUser, null)
  assert.equal(bodyless.stateLine, null)
  assert.equal(bodyless.blocks.length, 8)

  // State lines are exactly the approved copy.
  assert.equal(STATE_LINES.live.settings, false)
  assert.equal(STATE_LINES.final_no_ai.settings, true)
  assert.equal(STATE_LINES.narrative_failed.settings, false)
})

test('facts are written in the host format; a missing or unknown fact adds nothing', () => {
  assert.equal(weeklyFactValue({ value: 0.74, format: 'percent' }), '74%')
  assert.equal(weeklyFactValue({ value: 0.745, format: 'percent' }), '75%')
  assert.equal(weeklyFactValue({ value: 128, format: 'minutes' }), '128 分钟')
  assert.equal(weeklyFactValue({ value: 6.5, format: 'band' }), '6.5')
  assert.equal(weeklyFactValue({ value: 7, format: 'band' }), '7')
  assert.equal(weeklyFactValue({ value: 6, format: 'number' }), '6')
  assert.equal(weeklyFactValue({ value: '一篇' }), '一篇')
  assert.equal(weeklyFactValue({ value: null, format: 'number' }), '')
  assert.equal(weeklyFactValue({ value: undefined, format: 'percent' }), '')
  assert.equal(weeklyFactValue(undefined), '')

  const facts = report().facts
  assert.equal(
    weeklyText('读了 {{f:volume.reading}} 篇，正确率 {{f:accuracy.rate}}，用时 {{f:volume.minutes}}，均分 {{f:writing.average}}。', facts),
    '读了 6 篇，正确率 74%，用时 128 分钟，均分 6.3。'
  )
  assert.equal(weeklyText('没有 {{f:missing}} 这个引用', facts), '没有  这个引用')
  assert.equal(weeklyText('{{q:volume.reading}}', facts), '6', 'quote references read the same fact map')

  const tokens = weeklyTokens('读了 {{f:volume.reading}} 篇，正确率 {{f:accuracy.rate}}。', facts)
  assert.deepEqual(tokens[1], {
    tag: 'ref',
    text: '6',
    id: 'volume.reading',
    source: 'volume',
    label: '本周阅读篇数',
    provenance: {}
  })
  assert.deepEqual(tokens[3], {
    tag: 'ref',
    text: '74%',
    id: 'accuracy.rate',
    source: 'accuracy',
    label: '本周正确率',
    provenance: { assetId: 'p2-mid-07', assetIds: ['p2-mid-07'], memoryIds: ['mem-tfng'] }
  })
  const missing = weeklyTokens('缺 {{f:missing}} 字', {})[1]
  assert.deepEqual(missing, { tag: 'span', text: '' })

  assert.deepEqual(weeklyTokens('**很准** *慢一点* `tfng`', {}), [
    { tag: 'strong', inner: '很准', text: '很准' },
    { tag: 'span', text: ' ' },
    { tag: 'em', inner: '慢一点', text: '慢一点' },
    { tag: 'span', text: ' ' },
    { tag: 'code', inner: 'tfng', text: 'tfng' }
  ])
  // No HTML is interpreted; markup stays escaped text.
  assert.equal(weeklyText('<b>不是粗体</b>', {}), '<b>不是粗体</b>')
  assert.deepEqual(weeklyTokens('<b>x</b>', {}), [{ tag: 'span', text: '<b>x</b>' }])

  assert.equal(weeklyFactLabel(facts['volume.reading']), '本周阅读篇数')
  assert.equal(weeklyFactLabel({ source: 'accuracy' }), '阅读正确率')
  assert.equal(weeklyFactLabel({ source: 'soul' }), '个人情况')
  assert.equal(weeklyFactLabel({ source: 'unknown/thing' }), '练习记录')
  assert.equal(weeklyFactLabel({ source: 'accuracy', provenance: { label: '第 3 篇文章' } }), '第 3 篇文章')
})

test('narrative targets open the same routes the rest of the app uses', () => {
  assert.equal(weeklyTarget({ type: 'asset', key: 'p2-mid-07' }), '/reading/p2-mid-07')
  assert.deepEqual(weeklyTarget({ type: 'kind', key: 'tfng' }), { path: '/', query: { view: 'browse', kind: 'judgement' } })
  assert.deepEqual(weeklyTarget({ type: 'kind', key: 'matching_information' }), { path: '/', query: { view: 'browse', kind: 'paragraph_match' } })
  assert.deepEqual(weeklyTarget({ type: 'kind', key: 'summary_completion' }), { path: '/', query: { view: 'browse', kind: 'completion' } })
  assert.deepEqual(weeklyTarget({ type: 'writing', key: 'task1' }), { path: '/writing', query: { taskType: 'task1' } })
  assert.equal(weeklyTarget({ type: 'writing', key: 'task3' }), null)
  assert.equal(weeklyTarget({ type: 'asset', key: 'a/b' }), null)
  assert.equal(weeklyTarget({ type: 'page', key: 'x' }), null)
  assert.equal(weeklyTarget(null), null)
})

test('every number the page writes is a number the block data carries', () => {
  for (const block of report().blocks) {
    const view = buildBlock(block, { legacy: false })
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
  assert.ok(!('examples' in accuracy), 'the source list is not part of the rendered block')
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
  assert.ok(!('examples' in plan), 'plan links live on the items')
  assert.deepEqual(plan.plan, {
    totalMinutes: 30,
    items: [
      { key: 'reading.tfng', label: '判断题', probeLabel: '对比练习易混题', minutes: 15, link: { name: 'PracticeLibrary', params: {} } },
      { key: 'writing.coherence', label: '写作 · 连贯与衔接', probeLabel: '改写一段作文', minutes: 15, link: { name: 'Compose', params: {} } }
    ]
  })
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
  assert.equal(buildWeeklyReport(report({ blocks: [], narrative: null })), null)
  assert.equal(buildWeeklyReport(report({ window: '' })), null)
  assert.equal(buildWeeklyReport(report({ windowStart: 'garbage' })), null)
  assert.equal(buildWeeklyReport(null), null)
  // A kind this page does not know yet is skipped, the rest still shows.
  const future = buildWeeklyReport(report({ blocks: [{ id: 'x', kind: 'listening', data: {} }, report().blocks[0]] }))
  assert.deepEqual(future.blocks.map((block) => block.kind), ['volume'])
  // A window spanning New Year repeats the year.
  assert.equal(buildWeeklyReport(week('2026-W53', '2026-12-27T15:59:59Z', '2027-01-03T15:00:00Z')).dateLabel, '2026年12月28日 – 2027年1月3日')
})

test('legacy blocks-only reports keep their stored title and per-block sentence, read-only', () => {
  const legacy = buildWeeklyReport(report({
    schemaVersion: 2,
    displayTitle: undefined,
    title: '旧周记：正确率上来了',
    facts: undefined,
    narrative: undefined,
    practiceCount: 9,
    blocks: [{
      id: 'accuracy', kind: 'accuracy', memoryIds: [],
      narrative: '正确率比上周高。',
      data: { correct: 58, answered: 78, blank: 2, total: 80, rate: 0.74, perDay: [], previous: null },
      examples: []
    }]
  }))
  assert.equal(legacy.title, '旧周记：正确率上来了')
  assert.equal(legacy.blocks[0].lead, '正确率比上周高。')
  assert.equal(legacy.firstSentence, '正确率比上周高。')
  assert.deepEqual(legacy.paragraphs, [])
  assert.deepEqual(legacy.groups, [])
  assert.equal(legacy.askUser, null)
  assert.deepEqual(legacy.points, [])
  assert.equal(legacy.practiceCount, 9, 'a v2 report stored its practice count')

  const untitled = buildWeeklyReport(report({
    schemaVersion: 1, displayTitle: undefined, title: '', narrative: undefined, facts: undefined
  }))
  assert.equal(untitled.title, '这一周')

  // buildBlock keeps the legacy sentence only when asked to.
  const block = { id: 'volume', kind: 'volume', narrative: '旧句子。', data: {} }
  assert.equal(buildBlock(block).lead, '旧句子。')
  assert.equal(buildBlock(block, { legacy: false }).lead, '')
})

test('weeklySequence numbers weeks globally by start, newest first, independent of the month shown', () => {
  const weeks = [
    { window: '2026-W41', startDay: '2026-10-05', endDay: '2026-10-11' },
    { window: '2026-W39', startDay: '2026-09-21', endDay: '2026-09-27' },
    { window: '2026-W40', startDay: '2026-09-28', endDay: '2026-10-04' }
  ]
  assert.deepEqual(weeklySequence(weeks).map((week) => [week.window, week.sequence]), [
    ['2026-W41', 3], ['2026-W40', 2], ['2026-W39', 1]
  ])
  // The sequence does not depend on which month the shelf is showing.
  const september = weeks.filter((week) => weeklyMonth(week) === '2026-09')
  assert.deepEqual(september.map((week) => week.window), ['2026-W39'])
  assert.deepEqual(weeklySequence(weeks).map((week) => week.sequence), [3, 2, 1])
  assert.deepEqual(weeklySequence([]), [])
  assert.equal(weeklyMonth({ window: '2026-W40', startDay: '2026-09-28' }), '2026-10')
})

test('weeklyMonthSlots lists every Thursday of the month, with empty slots between reports', () => {
  const weeks = [
    { window: '2026-W41', startDay: '2026-10-05', endDay: '2026-10-11' },
    { window: '2026-W40', startDay: '2026-09-28', endDay: '2026-10-04' }
  ]
  const slots = weeklyMonthSlots(weeks, '2026-10')
  assert.deepEqual(slots.map((slot) => slot.day), [
    '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'
  ])
  assert.deepEqual(slots.map((slot) => slot.week?.window || null), [
    '2026-W40', '2026-W41', null, null, null
  ])
  assert.deepEqual(weeklyMonthSlots(weeks, '2026-09').map((slot) => slot.day), [
    '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'
  ])
  assert.ok(weeklyMonthSlots(weeks, '2026-09').every((slot) => slot.week === null))
  assert.deepEqual(weeklyMonthSlots(weeks, '2026-13'), [])
  assert.deepEqual(weeklyMonthSlots(weeks, '2026-9'), [])
  assert.deepEqual(weeklyMonthSlots(weeks, ''), [])
})
