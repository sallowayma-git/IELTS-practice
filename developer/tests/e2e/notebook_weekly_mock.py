"""Weekly report v2 fixtures for the notebook e2e scripts.

`WEEKLY_MOCK` defines `window.__weeklyReports(scenario)` -> `{ current, list }`,
the payloads of `weekly_report_current` and `weekly_report_list`. Reports follow
crates/ielts-domain/src/weekly_report.rs (camelCase) and every block's data
follows the block contract (p3 block spec): rates are 2dp fractions, days are
local "YYYY-MM-DD", priority bands / probes / skill keys are backend values.

Scenarios:
    live_final        this week live (no narrative) + two finished weeks (final)
    final_no_ai       one finished week, no model configured
    narrative_failed  one finished week whose narrative failed
    empty             nothing practised: current null, list empty

Window instants are written for UTC+8 local midnights; the scripts that check
date labels open their pages with timezone_id="Asia/Shanghai".
"""

WEEKLY_MOCK = r"""
(() => {
  const review = (assetId, sessionId) => ({ name: 'PracticeReadingReview', params: { assetId, sessionId } });
  const days = (first, count) => Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(first + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));

  const volume = (perDay, previous) => {
    const sum = (key) => perDay.reduce((total, day) => total + day[key], 0);
    return { id: 'volume', kind: 'volume', memoryIds: [], examples: [], data: {
      readingAttempts: sum('reading'), writingEssays: sum('writing'),
      activeDays: perDay.filter((day) => day.reading + day.writing > 0).length,
      minutes: sum('reading') * 21, perDay, previous } };
  };
  const accuracy = (perDay, previous) => {
    const correct = perDay.reduce((total, day) => total + day.correct, 0);
    const answered = perDay.reduce((total, day) => total + day.answered, 0);
    return { id: 'accuracy', kind: 'accuracy', memoryIds: [], data: {
      correct, answered, blank: 2, total: answered + 2, rate: Math.round(correct / answered * 100) / 100, perDay, previous },
      examples: [{ label: '「The Life of Bees」', detail: '正确 9/13', link: review('p2-mid-07', 'attempt-41-2') }] };
  };
  const perDayAccuracy = (dayList, pairs) => dayList.map((day, i) => {
    const [correct, answered] = pairs[i] || [0, 0];
    return { day, correct, answered, rate: answered ? Math.round(correct / answered * 100) / 100 : null };
  });

  const questionTypes = { id: 'question_types', kind: 'question_types', memoryIds: ['mem-tfng'], data: { types: [
      { qtype: 'tfng', label: '判断题', wrong: 7, answered: 18, rate: 0.61, passages: 3 },
      { qtype: 'matching_headings', label: '段落大意配对', wrong: 4, answered: 14, rate: 0.71, passages: 2 },
      { qtype: 'summary_completion', label: '摘要填空', wrong: 1, answered: 10, rate: 0.9, passages: 1 } ] },
    examples: [
      { label: '「The Life of Bees」q5', detail: '判断题', link: review('p2-mid-07', 'attempt-41-2') },
      { label: '「Urban Heat Islands」q9', detail: '判断题', link: review('p3-high-02', 'attempt-41-4') } ] };
  const repeatedMisses = { id: 'repeated_misses', kind: 'repeated_misses', memoryIds: ['mem-tfng'], data: {
      acrossPassages: [{ qtype: 'tfng', label: '判断题', passages: 3, wrong: 7 },
                       { qtype: 'matching_headings', label: '段落大意配对', passages: 2, wrong: 4 }],
      sameQuestion: [{ assetId: 'p2-mid-07', title: 'The Life of Bees', question: 'q5', attempts: 2 }] },
    examples: [
      { label: '「Urban Heat Islands」q9', detail: '判断题', link: review('p3-high-02', 'attempt-41-4') },
      { label: '「The Life of Bees」q5', detail: '做了 2 次都错', link: review('p2-mid-07', 'attempt-41-5') } ] };
  const redoProgress = { id: 'redo_progress', kind: 'redo_progress', memoryIds: [], data: {
      redos: 2, fixed: 3, stillWrong: 1, newlyWrong: 1, items: [
        { assetId: 'p2-mid-07', title: 'The Life of Bees', day: '2026-10-09', fixed: ['q5', 'q9'], stillWrong: ['q11'], newlyWrong: ['q3'] },
        { assetId: 'p1-low-03', title: 'Coffee Origins', day: '2026-10-07', fixed: ['q2'], stillWrong: [], newlyWrong: [] } ] },
    examples: [{ label: '「The Life of Bees」', detail: '仍错 q11', link: review('p2-mid-07', 'attempt-41-5') }] };
  const writingBands = { id: 'writing_bands', kind: 'writing_bands', memoryIds: ['mem-coherence'], data: {
      essays: [
        { day: '2026-10-06', taskType: 'Task 2', band: 6, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 5.5 },
                                                                   { criterion: 'lexical', label: '词汇资源', score: 6 }] },
        { day: '2026-10-10', taskType: 'Task 1', band: 6.5, lowest: [{ criterion: 'coherence', label: '连贯与衔接', score: 6 },
                                                                     { criterion: 'grammar', label: '语法', score: 6 }] } ],
      average: 6.3, best: 6.5, weakest: { criterion: 'coherence', label: '连贯与衔接', timesLowest: 2 },
      previous: { essays: 1, average: 6 } },
    examples: [
      { label: 'Task 1 6.5', link: { name: 'Result', params: { sessionId: 'writing-41-2' } } },
      { label: 'Task 2 6', link: { name: 'Result', params: { sessionId: 'writing-41-1' } } } ] };
  const coachSignals = { id: 'coach_signals', kind: 'coach_signals', memoryIds: [], data: {
      feedback: [{ kind: 'too_long', label: '太长', count: 2 }, { kind: 'need_example', label: '需要例子', count: 1 }],
      reasks: 1, attempts: 2 },
    examples: [{ label: '「The Life of Bees」', detail: '3 条反馈', link: review('p2-mid-07', 'attempt-41-2') }] };
  const nextWeekPlan = { id: 'next_week_plan', kind: 'next_week_plan', memoryIds: [], data: {
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
      { label: '写作 · 连贯与衔接', link: { name: 'Compose' } } ] };

  const W41_DAYS = days('2026-10-05', 7);
  const finished41 = (state, narrated) => {
    const blocks = [
      volume(W41_DAYS.map((day, i) => ({ day, reading: [2, 1, 0, 1, 2, 0, 0][i], writing: [0, 1, 0, 0, 0, 1, 0][i] })),
             { readingAttempts: 4, writingEssays: 1, activeDays: 4, minutes: 84 }),
      accuracy(perDayAccuracy(W41_DAYS, [[20, 26], [9, 13], [0, 0], [10, 13], [19, 26]]), { correct: 30, answered: 52, rate: 0.58 }),
      questionTypes, repeatedMisses, redoProgress, writingBands, coachSignals, nextWeekPlan ];
    const sentences = { volume: '这一周读了 6 篇，写了 2 篇，比上周多练了 2 天。',
      question_types: '判断题错了 7 题，分散在 3 篇文章里。', next_week_plan: '下周先用 15 分钟做判断题的对比练习。' };
    return { schemaVersion: 2, window: '2026-W41', windowStart: '2026-10-04T15:59:59Z', windowEnd: '2026-10-11T12:00:00Z',
      state, generatedAt: '2026-10-11T12:00:00Z',
      title: narrated ? '判断题在三篇文章里反复出错' : '这一周读了 6 篇，写了 2 篇',
      blocks: blocks.map((block) => narrated && sentences[block.id] ? { ...block, narrative: sentences[block.id] } : block),
      memoryChanges: narrated ? [
        { action: 'REINFORCE', memoryId: 'mem-tfng', statement: '判断题中，你常把“未提及”误判为“错误”。' },
        { action: 'ADD', memoryId: 'mem-coherence', statement: '写作里，段落之间常常缺少衔接。' } ] : [] };
  };
  const W40_DAYS = days('2026-09-28', 7);
  const finished40 = { schemaVersion: 2, window: '2026-W40', windowStart: '2026-09-27T15:59:59Z', windowEnd: '2026-10-04T12:00:00Z',
    state: 'final', generatedAt: '2026-10-04T12:00:00Z', title: '节奏稳定的一周', memoryChanges: [],
    blocks: [
      { ...volume(W40_DAYS.map((day, i) => ({ day, reading: [1, 0, 1, 0, 2, 0, 0][i], writing: [0, 0, 0, 1, 0, 0, 0][i] })), null),
        narrative: '这一周读了 4 篇，写了 1 篇。' },
      accuracy(perDayAccuracy(W40_DAYS, [[8, 13], [0, 0], [7, 13], [0, 0], [15, 26]]), null) ] };
  const live42 = (() => {
    const dayList = days('2026-10-12', 2);
    return { schemaVersion: 2, window: '2026-W42', windowStart: '2026-10-11T15:59:59Z', windowEnd: '2026-10-13T04:00:00Z',
      state: 'live', generatedAt: '2026-10-13T04:00:00Z', title: '这一周读了 2 篇', memoryChanges: [],
      blocks: [
        volume(dayList.map((day, i) => ({ day, reading: [1, 1][i], writing: 0 })),
               { readingAttempts: 6, writingEssays: 2, activeDays: 5, minutes: 126 }),
        accuracy(perDayAccuracy(dayList, [[10, 13], [11, 13]]), { correct: 58, answered: 78, rate: 0.74 }) ] };
  })();

  const SCENARIOS = {
    live_final: () => ({ current: live42, list: [finished41('final', true), finished40] }),
    final_no_ai: () => ({ current: null, list: [finished41('final_no_ai', false)] }),
    narrative_failed: () => ({ current: null, list: [finished41('narrative_failed', false)] }),
  };
  window.__weeklyReports = (scenario) => (SCENARIOS[scenario] || (() => ({ current: null, list: [] })))();
})();
"""
