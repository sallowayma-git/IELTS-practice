/**
 * Chinese labels for the listening surface.
 *
 * The kind vocabulary is fixed by crates/ielts-db::listening::question_kinds
 * (the thirteen seeded suffixes), so labels live in canonical order here and
 * the library never depends on the order a pack happens to list its groups in.
 */

export const LISTENING_KIND_LABELS = Object.freeze({
  form_completion: '表单填空',
  notes_completion: '笔记填空',
  table_completion: '表格填空',
  flow_chart_completion: '流程图填空',
  summary_completion: '摘要填空',
  sentence_completion: '句子填空',
  single_choice: '单选',
  multi_choice: '多选',
  matching: '配对',
  map_labelling: '地图标注',
  plan_labelling: '平面图标注',
  diagram_completion: '示意图填空',
  short_answer: '简答'
})

const DIFFICULTY_LABELS = Object.freeze({
  easy: '简单',
  medium: '中等',
  hard: '困难'
})

const FREQUENCY_LABELS = Object.freeze({
  high: '高频',
  medium: '中频',
  low: '低频'
})

export function listeningKindLabel(kind) {
  const key = String(kind || '').trim()
  return LISTENING_KIND_LABELS[key] || key || '题目'
}

/** Stable kind tags for an asset index entry (canonical order, unknowns dropped). */
export function listeningKindTags(asset) {
  const kinds = Array.isArray(asset?.questionKinds) ? asset.questionKinds : []
  return Object.keys(LISTENING_KIND_LABELS)
    .filter((key) => kinds.includes(key))
    .map((key) => ({ key, label: LISTENING_KIND_LABELS[key] }))
}

export function difficultyLabel(value) {
  const key = String(value || '').trim().toLowerCase()
  return DIFFICULTY_LABELS[key] || key || ''
}

export function frequencyLabel(value) {
  const key = String(value || '').trim().toLowerCase()
  return FREQUENCY_LABELS[key] || key || ''
}

export function sectionLabel(section) {
  const number = Number(section)
  return Number.isFinite(number) && number > 0 ? `第 ${number} 节` : '题目'
}

export function formatAnswerValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(' / ')
  }
  return String(value ?? '').trim()
}
