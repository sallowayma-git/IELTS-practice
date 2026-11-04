/**
 * Opt-in coach transcripts for the dev mock. By default coach_list_messages is
 * empty, so the controlled exam-freeze pages never show a coach answer or a
 * preference card. A page opts in with `?mockCoach=<scenario>` (read by
 * tauri-mock.js), which makes the reading coach panel open on a canned thread:
 *
 *   plain      one answer carrying a strategyId (the small "讲法" tag), no card
 *   card       one answer with a pending preference card
 *   cards      two answers with pending cards; only the newer one keeps its buttons
 *   confirmed  the card was confirmed before (hydrates as "已记住")
 *   dismissed  the card was dismissed before (hydrates as nothing)
 *
 * Confirm/dismiss go through the mock's own memoryCards table, so a decision
 * made on the page survives the panel being re-hydrated. Two sentinel texts
 * provoke the refusals the screenshots need: 【重复】 -> memory_card.rejected,
 * 【失败】 -> memory_card.persistence_failed.
 */

export const COACH_SCENARIOS = ['plain', 'card', 'cards', 'confirmed', 'dismissed']

const FIRST = {
  question: '判断题我总是分不清 NOT GIVEN，之后请先给我例子再讲证据。',
  answer: '先看一个例子：原文只说“多数学生”，题干写“所有学生”，范围变大了，所以是 FALSE；如果原文完全没提学生，才是 NOT GIVEN。\n\n**定位口诀**：先找关键词，再比范围。',
  strategyId: 'example_first_v1',
  card: { noteIndex: 0, text: '判断题上先给例子再讲证据', skillKey: 'reading.tfng' },
}

const SECOND = {
  question: '这个长句我读不顺，能拆一下吗？',
  answer: '分三步：\n1. 先找主句主干。\n2. 再把 which 引导的从句放到一边。\n3. 最后看修饰成分补了什么信息。',
  strategyId: 'step_by_step_v1',
  card: { noteIndex: 0, text: '长难句先拆主干再看修饰', skillKey: 'reading.matching_headings' },
}

function exchange(index, turn, threadId, { cardState, withCard }) {
  const at = `2026-10-20T09:0${index}:00Z`
  const base = 2 * index
  const note = { kind: 'difficulty', text: turn.card.text, skillKey: turn.card.skillKey }
  const payload = { strategyId: turn.strategyId, followUps: [], teachingNotes: [note] }
  if (withCard) payload.memoryCard = turn.card
  const state = withCard ? cardState(`mock-coach-a${index + 1}`, turn.card.noteIndex) : undefined
  if (state) payload.memoryCardState = state
  return [
    { id: `mock-coach-u${index + 1}`, threadId, role: 'user', content: turn.question, status: 'completed', sequence: base + 1, createdAt: at },
    { id: `mock-coach-a${index + 1}`, threadId, role: 'assistant', content: turn.answer, structuredPayload: payload, status: 'completed', sequence: base + 2, createdAt: at },
  ]
}

/** Messages after `afterSequence`, in the shape coach_list_messages returns. */
export function coachScenarioMessages(scenario, threadId, afterSequence, cardState) {
  if (!COACH_SCENARIOS.includes(scenario)) return []
  const withCard = scenario !== 'plain'
  const turns = scenario === 'cards' ? [FIRST, SECOND] : [FIRST]
  const settled = scenario === 'confirmed' || scenario === 'dismissed'
  const lookup = settled ? () => (scenario === 'confirmed' ? 'confirmed' : 'dismissed') : cardState
  return turns
    .flatMap((turn, index) => exchange(index, turn, threadId, { cardState: lookup, withCard }))
    .filter((message) => message.sequence > Number(afterSequence || 0))
}
