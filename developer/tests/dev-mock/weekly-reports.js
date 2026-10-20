// Dev-only synthetic weekly reports (schema v3). They never enter production.
// The notebook e2e mock (developer/tests/e2e/notebook_weekly_mock.py) injects
// this same source into the page, so the browser fixture and the dev mock
// cannot drift apart.
//
// Shape: crates/ielts-domain/src/weekly_report.rs (camelCase wire); every fact
// id, label, format and source is what crates/ielts-db/src/weekly_report/project.rs
// projects from the blocks below.

const review = (assetId, sessionId) => ({ name: 'PracticeReadingReview', params: { assetId, sessionId } })
const days = (first, count) => Array.from({ length: count }, (_, i) =>
  new Date(Date.parse(first + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))

const TFNG_ASSETS = ['p2-mid-07', 'p3-high-02', 'p1-low-03']
const MATCHING_ASSETS = ['p2-mid-07', 'p3-high-02']
const SUMMARY_ASSETS = ['p2-mid-07']

const volumeBlock = (perDay, previous) => {
  const sum = (key) => perDay.reduce((total, day) => total + day[key], 0)
  return { id: 'volume', kind: 'volume', memoryIds: [], examples: [], data: {
    readingAttempts: sum('reading'), writingEssays: sum('writing'),
    activeDays: perDay.filter((day) => day.reading + day.writing > 0).length,
    minutes: sum('reading') * 21, perDay, previous } }
}

const accuracyBlock = (perDay, previous) => {
  const correct = perDay.reduce((total, day) => total + day.correct, 0)
  const answered = perDay.reduce((total, day) => total + day.answered, 0)
  return { id: 'accuracy', kind: 'accuracy', memoryIds: [], data: {
    correct, answered, blank: 2, total: answered + 2, rate: Math.round(correct / answered * 100) / 100, perDay, previous },
    examples: [{ label: '「The Life of Bees」', detail: '正确 9/13', link: review('p2-mid-07', 'attempt-41-2') }] }
}

const perDayAccuracy = (dayList, pairs) => dayList.map((day, i) => {
  const [correct, answered] = pairs[i] || [0, 0]
  return { day, correct, answered, rate: answered ? Math.round(correct / answered * 100) / 100 : null }
})

const questionTypesBlock = () => ({
  id: 'question_types', kind: 'question_types', memoryIds: ['mem-tfng'], data: { types: [
    { qtype: 'tfng', label: '判断题', wrong: 7, answered: 18, rate: 0.61, passages: 3, assetIds: TFNG_ASSETS },
    { qtype: 'matching_headings', label: '段落大意配对', wrong: 4, answered: 14, rate: 0.71, passages: 2, assetIds: MATCHING_ASSETS },
    { qtype: 'summary_completion', label: '摘要填空', wrong: 1, answered: 10, rate: 0.9, passages: 1, assetIds: SUMMARY_ASSETS } ] },
  examples: [
    { label: '「The Life of Bees」q5', detail: '判断题', link: review('p2-mid-07', 'attempt-41-2') },
    { label: '「Urban Heat Islands」q9', detail: '判断题', link: review('p3-high-02', 'attempt-41-4') } ] })

const repeatedMissesBlock = () => ({
  id: 'repeated_misses', kind: 'repeated_misses', memoryIds: ['mem-tfng'], data: {
    acrossPassages: [
      { qtype: 'tfng', label: '判断题', passages: 3, wrong: 7, assetIds: TFNG_ASSETS },
      { qtype: 'matching_headings', label: '段落大意配对', passages: 2, wrong: 4, assetIds: MATCHING_ASSETS } ],
    sameQuestion: [{ assetId: 'p2-mid-07', title: 'The Life of Bees', question: 'q5', attempts: 2 }] },
  examples: [
    { label: '「Urban Heat Islands」q9', detail: '判断题', link: review('p3-high-02', 'attempt-41-4') },
    { label: '「The Life of Bees」q5', detail: '做了 2 次都错', link: review('p2-mid-07', 'attempt-41-5') } ] })

const redoProgressBlock = () => ({
  id: 'redo_progress', kind: 'redo_progress', memoryIds: [], data: {
    redos: 2, fixed: 3, stillWrong: 1, newlyWrong: 1, items: [
      { assetId: 'p2-mid-07', title: 'The Life of Bees', day: '2026-10-09', fixed: ['q5', 'q9'], stillWrong: ['q11'], newlyWrong: ['q3'] },
      { assetId: 'p1-low-03', title: 'Coffee Origins', day: '2026-10-07', fixed: ['q2'], stillWrong: [], newlyWrong: [] } ] },
  examples: [{ label: '「The Life of Bees」', detail: '仍错 q11', link: review('p2-mid-07', 'attempt-41-5') }] })

const writingBandsBlock = () => ({
  id: 'writing_bands', kind: 'writing_bands', memoryIds: ['mem-coherence'], data: {
    essays: [
      { day: '2026-10-06', taskType: 'Task 2', band: 6, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 5.5 },
                                                                 { criterion: 'lexical', label: '词汇资源', score: 6 }] },
      { day: '2026-10-10', taskType: 'Task 1', band: 6.5, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 6 },
                                                                   { criterion: 'grammar', label: '语法', score: 6 }] } ],
    average: 6.3, best: 6.5, weakest: { criterion: 'coherence', label: '连贯与衔接', timesLowest: 2 },
    previous: { essays: 1, average: 6 } },
  examples: [
    { label: 'Task 1 6.5', link: { name: 'Result', params: { sessionId: 'writing-41-2' } } },
    { label: 'Task 2 6', link: { name: 'Result', params: { sessionId: 'writing-41-1' } } } ] })

const coachSignalsBlock = () => ({
  id: 'coach_signals', kind: 'coach_signals', memoryIds: [], data: {
    feedback: [{ kind: 'too_long', label: '太长', count: 2 }, { kind: 'need_example', label: '需要例子', count: 1 }],
    reasks: 1, attempts: 2 },
  examples: [{ label: '「The Life of Bees」', detail: '3 条反馈', link: review('p2-mid-07', 'attempt-41-2') }] })

const nextWeekPlanBlock = () => ({
  id: 'next_week_plan', kind: 'next_week_plan', memoryIds: [], data: {
    items: [
      { skillKey: 'reading.tfng', label: '判断题', priorityBand: 'urgent', probe: 'contrastive_pair',
        probeLabel: '对比练习易混题', reasons: ['recent_errors', 'low_mastery_estimate'], minutes: 15 },
      { skillKey: 'reading.matching_headings', label: '段落大意配对', priorityBand: 'high', probe: 'novel_item',
        probeLabel: '换一篇新文章练同类题', reasons: ['needs_new_asset_transfer'], minutes: 15 },
      { skillKey: 'writing.coherence', label: '写作 · 连贯与衔接', priorityBand: 'moderate', probe: 'writing_rewrite',
        probeLabel: '改写一段作文', reasons: ['review_due'], minutes: 15 } ],
    totalMinutes: 45 },
  examples: [
    { label: '判断题', link: { name: 'PracticeLibrary' } },
    { label: '段落大意配对', link: { name: 'PracticeLibrary' } },
    { label: '写作 · 连贯与衔接', link: { name: 'Compose' } } ] })

const fact = (value, label, format, source, provenance = {}) => ({ value, label, format, source, provenance })

// W41 — every fact project.rs projects from the eight blocks above (no exam
// date in the mock, so no exam.days).
const W41_FACTS = {
  'volume.reading': fact(6, '本周阅读篇数', 'number', 'volume'),
  'volume.writing': fact(2, '本周作文篇数', 'number', 'volume'),
  'volume.total': fact(8, '本周练习总数', 'number', 'volume'),
  'volume.days': fact(5, '本周练习天数', 'number', 'volume'),
  'volume.minutes': fact(126, '本周阅读时长', 'minutes', 'volume'),
  'volume.previous.reading': fact(4, '上周阅读篇数', 'number', 'volume'),
  'volume.previous.writing': fact(1, '上周作文篇数', 'number', 'volume'),
  'accuracy.correct': fact(58, '本周答对题数', 'number', 'accuracy'),
  'accuracy.answered': fact(78, '本周作答题数', 'number', 'accuracy'),
  'accuracy.blank': fact(2, '本周未作答题数', 'number', 'accuracy'),
  'accuracy.total': fact(80, '本周阅读总题数', 'number', 'accuracy'),
  'accuracy.rate': fact(0.74, '本周正确率', 'percent', 'accuracy'),
  'accuracy.previous.correct': fact(30, '上周答对题数', 'number', 'accuracy'),
  'accuracy.previous.answered': fact(52, '上周作答题数', 'number', 'accuracy'),
  'qtype.tfng.wrong': fact(7, '「判断题」错题数', 'number', 'question_types', { assetIds: TFNG_ASSETS }),
  'qtype.tfng.answered': fact(18, '「判断题」作答题数', 'number', 'question_types', { assetIds: TFNG_ASSETS }),
  'qtype.tfng.rate': fact(0.61, '「判断题」正确率', 'percent', 'question_types', { assetIds: TFNG_ASSETS }),
  'qtype.tfng.passages': fact(3, '「判断题」失分题集数', 'number', 'question_types', { assetIds: TFNG_ASSETS }),
  'qtype.matching_headings.wrong': fact(4, '「段落大意配对」错题数', 'number', 'question_types', { assetIds: MATCHING_ASSETS }),
  'qtype.matching_headings.answered': fact(14, '「段落大意配对」作答题数', 'number', 'question_types', { assetIds: MATCHING_ASSETS }),
  'qtype.matching_headings.rate': fact(0.71, '「段落大意配对」正确率', 'percent', 'question_types', { assetIds: MATCHING_ASSETS }),
  'qtype.matching_headings.passages': fact(2, '「段落大意配对」失分题集数', 'number', 'question_types', { assetIds: MATCHING_ASSETS }),
  'repeated.tfng.passages': fact(3, '「判断题」连续失分题集数', 'number', 'repeated_misses', { assetIds: TFNG_ASSETS }),
  'repeated.tfng.wrong': fact(7, '「判断题」跨题集错题数', 'number', 'repeated_misses', { assetIds: TFNG_ASSETS }),
  'repeated.matching_headings.passages': fact(2, '「段落大意配对」连续失分题集数', 'number', 'repeated_misses', { assetIds: MATCHING_ASSETS }),
  'repeated.matching_headings.wrong': fact(4, '「段落大意配对」跨题集错题数', 'number', 'repeated_misses', { assetIds: MATCHING_ASSETS }),
  'repeated.same.attempts': fact(2, '同一道题最多的作答次数', 'number', 'repeated_misses', { assetId: 'p2-mid-07' }),
  'redo.count': fact(2, '本周重做篇数', 'number', 'redo_progress'),
  'redo.fixed': fact(3, '本周改对题数', 'number', 'redo_progress'),
  'redo.stillWrong': fact(1, '本周仍错题数', 'number', 'redo_progress'),
  'redo.newlyWrong': fact(1, '本周新错题数', 'number', 'redo_progress'),
  'writing.count': fact(2, '本周作文篇数', 'number', 'writing_bands'),
  'writing.essay1.band': fact(6.5, '最近一篇作文总分', 'band', 'writing_bands'),
  'writing.essay1.coherence': fact(6, '最近一篇作文连贯与衔接', 'band', 'writing_bands'),
  'writing.essay1.grammar': fact(6, '最近一篇作文语法', 'band', 'writing_bands'),
  'writing.essay2.band': fact(6, '上一篇作文总分', 'band', 'writing_bands'),
  'writing.essay2.coherence': fact(5.5, '上一篇作文连贯与衔接', 'band', 'writing_bands'),
  'writing.essay2.lexical': fact(6, '上一篇作文词汇资源', 'band', 'writing_bands'),
  'writing.average': fact(6.3, '本周作文平均分', 'band', 'writing_bands'),
  'writing.weakest.times': fact(2, '「连贯与衔接」偏低的次数', 'number', 'writing_bands'),
  'writing.previous.count': fact(1, '上周作文篇数', 'number', 'writing_bands'),
  'writing.previous.average': fact(6, '上周作文平均分', 'band', 'writing_bands'),
  'coach.too_long.count': fact(2, '教练反馈「太长」次数', 'number', 'coach_signals'),
  'coach.need_example.count': fact(1, '教练反馈「需要例子」次数', 'number', 'coach_signals'),
  'coach.reasks': fact(1, '本周教练重问次数', 'number', 'coach_signals'),
  'coach.attempts': fact(2, '本周使用教练的练习数', 'number', 'coach_signals'),
  'plan.totalMinutes': fact(45, '本周计划总时长', 'minutes', 'next_week_plan'),
  'plan.item1.minutes': fact(15, '计划第 1 项时长', 'minutes', 'next_week_plan'),
  'plan.item2.minutes': fact(15, '计划第 2 项时长', 'minutes', 'next_week_plan'),
}

const W40_FACTS = {
  'volume.reading': fact(4, '本周阅读篇数', 'number', 'volume'),
  'volume.writing': fact(1, '本周作文篇数', 'number', 'volume'),
  'volume.total': fact(5, '本周练习总数', 'number', 'volume'),
  'volume.days': fact(4, '本周练习天数', 'number', 'volume'),
  'volume.minutes': fact(84, '本周阅读时长', 'minutes', 'volume'),
  'accuracy.correct': fact(30, '本周答对题数', 'number', 'accuracy'),
  'accuracy.answered': fact(52, '本周作答题数', 'number', 'accuracy'),
  'accuracy.blank': fact(2, '本周未作答题数', 'number', 'accuracy'),
  'accuracy.total': fact(54, '本周阅读总题数', 'number', 'accuracy'),
  'accuracy.rate': fact(0.58, '本周正确率', 'percent', 'accuracy'),
}

const W42_FACTS = {
  'volume.reading': fact(2, '本周阅读篇数', 'number', 'volume'),
  'volume.writing': fact(0, '本周作文篇数', 'number', 'volume'),
  'volume.total': fact(2, '本周练习总数', 'number', 'volume'),
  'volume.days': fact(2, '本周练习天数', 'number', 'volume'),
  'volume.minutes': fact(42, '本周阅读时长', 'minutes', 'volume'),
  'volume.previous.reading': fact(6, '上周阅读篇数', 'number', 'volume'),
  'volume.previous.writing': fact(2, '上周作文篇数', 'number', 'volume'),
  'accuracy.correct': fact(21, '本周答对题数', 'number', 'accuracy'),
  'accuracy.answered': fact(26, '本周作答题数', 'number', 'accuracy'),
  'accuracy.blank': fact(2, '本周未作答题数', 'number', 'accuracy'),
  'accuracy.total': fact(28, '本周阅读总题数', 'number', 'accuracy'),
  'accuracy.rate': fact(0.81, '本周正确率', 'percent', 'accuracy'),
  'accuracy.previous.correct': fact(58, '上周答对题数', 'number', 'accuracy'),
  'accuracy.previous.answered': fact(78, '上周作答题数', 'number', 'accuracy'),
}

const W41_NARRATIVE = {
  title: '把判断题读慢一点',
  body: [
    '这一周读了 {{f:volume.reading}} 篇，写了 {{f:volume.writing}} 篇。',
    '判断题错了 {{f:qtype.tfng.wrong}} 题，分散在 {{f:repeated.tfng.passages}} 篇文章里。'
  ],
  changes: [{ text: '把判断题的错题集中记下来，下一周先看这一页。' }],
  nextSteps: [{ text: '下周先用 {{f:plan.item1.minutes}}做判断题的对比练习。', target: { type: 'kind', key: 'reading.tfng' } }],
  strengths: [{ text: '作文平均分到了 {{f:writing.average}}，比上周稳。' }],
  weaknesses: [{ text: '段落大意配对还会反复失分，先练定位。' }],
  askUser: null,
  validation: { final: { droppedSentences: 0, needsRepair: false, violations: [] } }
}

const W41_MEMORY_CHANGES = [
  { action: 'REINFORCE', memoryId: 'mem-tfng', statement: '判断题中，你常把“未提及”误判为“错误”。' },
  { action: 'ADD', memoryId: 'mem-coherence', statement: '写作里，段落之间常常缺少衔接。' }
]

const W40_NARRATIVE = {
  title: '节奏稳定的一周',
  body: [
    '这一周读了 {{f:volume.reading}} 篇，写了 {{f:volume.writing}} 篇。',
    '正确率是 {{f:accuracy.rate}}，节奏比上周稳。'
  ],
  changes: [],
  nextSteps: [],
  strengths: [],
  weaknesses: [],
  askUser: null,
  validation: { final: { droppedSentences: 0, needsRepair: false, violations: [] } }
}

const W41_DAYS = days('2026-10-05', 7)
const W40_DAYS = days('2026-09-28', 7)
const W42_DAYS = days('2026-10-12', 2)

const finished41 = (state, narrative) => ({
  schemaVersion: 3,
  window: '2026-W41',
  windowStart: '2026-10-04T15:59:59Z',
  windowEnd: '2026-10-11T12:00:00Z',
  state,
  generatedAt: '2026-10-11T12:00:00Z',
  displayTitle: narrative ? narrative.title : '这一周读了 6 篇，写了 2 篇',
  blocks: [
    volumeBlock(W41_DAYS.map((day, i) => ({ day, reading: [2, 1, 0, 1, 2, 0, 0][i], writing: [0, 1, 0, 0, 0, 1, 0][i] })),
                { readingAttempts: 4, writingEssays: 1, activeDays: 4, minutes: 84 }),
    accuracyBlock(perDayAccuracy(W41_DAYS, [[20, 26], [9, 13], [0, 0], [10, 13], [19, 26]]),
                  { correct: 30, answered: 52, rate: 0.58 }),
    questionTypesBlock(), repeatedMissesBlock(), redoProgressBlock(),
    writingBandsBlock(), coachSignalsBlock(), nextWeekPlanBlock()
  ],
  facts: W41_FACTS,
  narrative,
  profileEdits: [],
  memoryChanges: narrative ? W41_MEMORY_CHANGES : []
})

const finished40 = () => ({
  schemaVersion: 3,
  window: '2026-W40',
  windowStart: '2026-09-27T15:59:59Z',
  windowEnd: '2026-10-04T12:00:00Z',
  state: 'final',
  generatedAt: '2026-10-04T12:00:00Z',
  displayTitle: '节奏稳定的一周',
  blocks: [
    volumeBlock(W40_DAYS.map((day, i) => ({ day, reading: [1, 0, 1, 0, 2, 0, 0][i], writing: [0, 0, 0, 1, 0, 0, 0][i] })), null),
    accuracyBlock(perDayAccuracy(W40_DAYS, [[8, 13], [0, 0], [7, 13], [0, 0], [15, 26]]), null)
  ],
  facts: W40_FACTS,
  narrative: W40_NARRATIVE,
  profileEdits: [],
  memoryChanges: []
})

const live42 = () => ({
  schemaVersion: 3,
  window: '2026-W42',
  windowStart: '2026-10-11T15:59:59Z',
  windowEnd: '2026-10-13T04:00:00Z',
  state: 'live',
  generatedAt: '2026-10-13T04:00:00Z',
  displayTitle: '这一周读了 2 篇',
  blocks: [
    volumeBlock(W42_DAYS.map((day, i) => ({ day, reading: [1, 1][i], writing: 0 })),
                { readingAttempts: 6, writingEssays: 2, activeDays: 5, minutes: 126 }),
    accuracyBlock(perDayAccuracy(W42_DAYS, [[10, 13], [11, 13]]), { correct: 58, answered: 78, rate: 0.74 })
  ],
  facts: W42_FACTS,
  narrative: null,
  profileEdits: [],
  memoryChanges: []
})

const SCENARIOS = {
  live_final: () => ({ current: live42(), list: [finished41('final', W41_NARRATIVE), finished40()] }),
  final_no_ai: () => ({ current: null, list: [finished41('final_no_ai', null)] }),
  narrative_failed: () => ({ current: null, list: [finished41('narrative_failed', null)] }),
  empty: () => ({ current: null, list: [] })
}

export function weeklyReports(scenario = 'live_final') {
  return (SCENARIOS[scenario] || SCENARIOS.empty)()
}
