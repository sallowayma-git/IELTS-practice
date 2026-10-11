#!/usr/bin/env node
// Contract for learner-model display labels: every key the engine emits gets a
// Chinese label, and no rendered label leaks `_` or `.` from a raw identifier.

import assert from 'node:assert/strict'
import {
  formatReasonCodes,
  formatSkillKey
} from '../../../apps/writing-vue/src/modules/learner/labels.js'

const READING_KEYS = [
  'reading.classification', 'reading.diagram_completion', 'reading.flow_chart_completion',
  'reading.matching_headings', 'reading.multi_choice', 'reading.notes_completion',
  'reading.sentence_completion', 'reading.short_answer', 'reading.single_choice',
  'reading.summary_completion', 'reading.table_completion', 'reading.tfng', 'reading.yng',
  'reading.tfng.false_vs_not_given', 'reading.tfng.proposition_boundary',
  'reading.tfng.quantifier_check', 'reading.tfng.subject_scope',
  'reading.matching_headings.distractor_keyword_overlap',
  'reading.matching_headings.evidence_completeness',
  'reading.matching_headings.global_main_idea',
  'reading.matching_headings.paragraph_scope_control',
  'reading.multi_choice.distractor_elimination',
  'reading.multi_choice.evidence_completeness'
]

const WRITING_KEYS = {
  'writing.overall': '写作 · 总体',
  'writing.taskResponse': '写作 · 任务回应',
  'writing.coherence': '写作 · 连贯与衔接',
  'writing.lexical': '写作 · 词汇资源',
  'writing.grammar': '写作 · 语法'
}

const REASON_CODES = [
  'low_mastery_estimate', 'high_uncertainty', 'recent_errors',
  'needs_new_asset_transfer', 'review_due', 'stability_check'
]

const noRawIdentifier = (label) => {
  assert.ok(!/[_.]/.test(label), `label leaks raw identifier: ${label}`)
}

for (const key of READING_KEYS) {
  const label = formatSkillKey(key)
  noRawIdentifier(label)
  assert.match(label, /^阅读 · /, `${key} should carry the reading prefix`)
}

for (const [key, expected] of Object.entries(WRITING_KEYS)) {
  assert.equal(formatSkillKey(key), expected)
}

assert.equal(formatSkillKey('reading.tfng.false_vs_not_given'), '阅读 · 判断题 · 错误与未提及')

// Known parent, unknown sub-skill: parent label survives, suffix is humanised.
assert.equal(formatSkillKey('reading.tfng.new_probe_kind'), '阅读 · 判断题 · new probe kind')
// Unknown writing criterion and totally unknown keys: humanised, never raw.
assert.equal(formatSkillKey('writing.new_criterion'), '写作 · new criterion')
noRawIdentifier(formatSkillKey('vocabulary.collocation'))
noRawIdentifier(formatSkillKey('some_unknown.thing_here'))
assert.equal(formatSkillKey(''), '相关技能')

for (const code of REASON_CODES) {
  noRawIdentifier(formatReasonCodes([code]))
}
assert.equal(formatReasonCodes(['review_due', 'recent_errors']), '到期复习 · 近期连续出错')

console.log('learnerSkillLabels: all assertions passed')
