// Display labels for learner-model skill keys and reason codes.
// Keys mirror what the engine emits: `writing.{criterion}` (teaching_strategy.rs)
// and the reading skill catalog seeded in crates/ielts-db/migrations.

const READING_KIND_LABELS = {
  classification: '分类题',
  diagram_completion: '图示填空',
  flow_chart_completion: '流程图填空',
  matching: '配对题',
  matching_features: '特征配对',
  matching_headings: '段落大意配对',
  matching_information: '段落信息配对',
  matching_sentence_endings: '句尾配对',
  multi_choice: '多选题',
  notes_completion: '笔记填空',
  sentence_completion: '句子填空',
  short_answer: '简答题',
  single_choice: '单选题',
  summary_completion: '摘要填空',
  table_completion: '表格填空',
  tfng: '判断题',
  yng: '是非题'
}

const SUB_SKILL_LABELS = {
  'tfng.false_vs_not_given': '错误与未提及',
  'tfng.proposition_boundary': '命题边界',
  'tfng.quantifier_check': '量词核对',
  'tfng.subject_scope': '主语范围',
  'matching_headings.distractor_keyword_overlap': '干扰项关键词重叠',
  'matching_headings.evidence_completeness': '证据完整度',
  'matching_headings.global_main_idea': '全文大意',
  'matching_headings.paragraph_scope_control': '段落范围控制',
  'multi_choice.distractor_elimination': '干扰项排除',
  'multi_choice.evidence_completeness': '证据完整度'
}

const WRITING_CRITERION_LABELS = {
  overall: '总体',
  taskResponse: '任务回应',
  coherence: '连贯与衔接',
  lexical: '词汇资源',
  grammar: '语法'
}

const REASON_LABELS = {
  insufficient_evidence: '证据不足，暂不排优先级',
  low_mastery_estimate: '掌握度偏低',
  high_uncertainty: '证据不确定',
  recent_errors: '近期连续出错',
  needs_new_asset_transfer: '需要新材料验证',
  review_due: '到期复习',
  stability_check: '稳定性检查'
}

const PARENT_PREFIX = { reading: '阅读', writing: '写作' }

// Unknown suffixes never reach the screen as snake_case or dotted paths.
function humanise(text) {
  return String(text || '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readingLabel(kind) {
  return READING_KIND_LABELS[kind] || humanise(kind)
}

export function formatSkillKey(skillKey) {
  const key = String(skillKey || '').trim()
  if (!key) return '相关技能'
  if (key.startsWith('writing.')) {
    const criterion = key.slice('writing.'.length)
    return WRITING_CRITERION_LABELS[criterion]
      ? `写作 · ${WRITING_CRITERION_LABELS[criterion]}`
      : `写作 · ${humanise(criterion)}`
  }
  if (!key.startsWith('reading.')) return humanise(key)
  const rest = key.slice('reading.'.length)
  if (SUB_SKILL_LABELS[rest]) {
    const [kind] = rest.split('.')
    return `阅读 · ${readingLabel(kind)} · ${SUB_SKILL_LABELS[rest]}`
  }
  const [kind, ...suffix] = rest.split('.')
  if (READING_KIND_LABELS[kind]) {
    return suffix.length
      ? `阅读 · ${READING_KIND_LABELS[kind]} · ${humanise(suffix.join(' '))}`
      : `阅读 · ${READING_KIND_LABELS[kind]}`
  }
  return `${PARENT_PREFIX.reading} · ${humanise(rest)}`
}

export function formatReasonCode(code) {
  return REASON_LABELS[code] || humanise(code)
}

export function formatReasonCodes(codes) {
  return (codes || []).map(formatReasonCode).join(' · ')
}
