/**
 * Post-submit feedback inside the question area, mirroring the opensource
 * applyResultsToQuestionArea: chosen options turn green/red and dropzones get
 * correct/wrong. Calling it with an empty comparison clears every mark.
 */
import {
  escapeCss,
  normalizeQuestionId,
  resolveAnswerAliases
} from '@/modules/practice-reading/readingQuestionIds'

const MARKED_SELECTOR = [
  '.option-correct', '.option-wrong',
  '.drop-target-summary.correct', '.drop-target-summary.wrong',
  '.paragraph-dropzone.correct', '.paragraph-dropzone.wrong',
  '.match-dropzone.correct', '.match-dropzone.wrong',
  '[data-result-filled="true"]'
].join(', ')
const CHOICE_SELECTOR = '#question-groups input[type="radio"][name], #question-groups input[type="checkbox"][name]'

// Mirrors the bundle's canonicalizeAnswerToken: punctuation and boolean
// foldings, single letters uppercased, everything else case-preserved.
export function canonicalToken(value) {
  const cleaned = String(value ?? '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'`()[\]{}<>.,;:!?]+|[\s"'`()[\]{}<>.,;:!?]+$/g, '')
  if (!cleaned) return ''
  const lowered = cleaned.toLowerCase()
  if (['true', 't', 'yes', 'y'].includes(lowered)) return 'true'
  if (['false', 'f', 'no', 'n'].includes(lowered)) return 'false'
  if (['ng', 'notgiven', 'not-given'].includes(lowered)) return 'not given'
  if (/^[a-z]$/i.test(cleaned)) return cleaned.toUpperCase()
  const leadingOption = cleaned.match(/^([A-Za-z])[.)]\s+/)
  if (leadingOption && cleaned.length > 2) return leadingOption[1].toUpperCase()
  return cleaned
}

function tokens(value) {
  return (Array.isArray(value) ? value : [value]).map(canonicalToken).filter(Boolean)
}

function clearMarks() {
  document.querySelectorAll(MARKED_SELECTOR).forEach((node) => {
    node.classList.remove('correct', 'wrong', 'option-correct', 'option-wrong')
    if (node.dataset?.resultFilled === 'true') {
      node.classList.remove('dropzone-filled')
      delete node.dataset.resultFilled
    }
  })
}

function markChoiceGroups(entries, choiceInputsFor) {
  const groups = new Map()
  entries.forEach((entry) => {
    const inputs = choiceInputsFor(normalizeQuestionId(entry?.questionId))
    const correct = tokens(entry?.correctAnswer)
    if (!inputs.length || !correct.length) return
    const key = inputs[0].name
    if (!groups.has(key)) groups.set(key, { inputs, correct: new Set(), chosen: new Set() })
    const group = groups.get(key)
    correct.forEach((value) => group.correct.add(value))
    tokens(entry?.userAnswer).forEach((value) => group.chosen.add(value))
  })
  groups.forEach((group) => {
    group.inputs.forEach((input) => {
      const target = input.closest('label') || input.parentElement
      const value = canonicalToken(input.value)
      if (!target || !value) return
      if (group.correct.has(value)) target.classList.add('option-correct')
      else if (input.checked || group.chosen.has(value)) target.classList.add('option-wrong')
    })
  })
}

function markDropzone(entry, displayMap) {
  const questionId = normalizeQuestionId(entry?.questionId)
  for (const alias of resolveAnswerAliases(questionId, displayMap)) {
    const escaped = escapeCss(alias)
    const dropzone = document.querySelector(
      `.drop-target-summary[data-question="${escaped}"], .paragraph-dropzone[data-question="${escaped}"], .match-dropzone[data-question="${escaped}"]`
    )
    if (!dropzone) continue
    dropzone.classList.add(entry.isCorrect ? 'correct' : 'wrong')
    if (!dropzone.classList.contains('dropzone-filled')) {
      dropzone.classList.add('dropzone-filled')
      dropzone.dataset.resultFilled = 'true'
    }
    return
  }
}

/**
 * @param {object|null} comparison submission.answerComparison
 * @param {object|null} displayMap payload.questionDisplayMap
 * @param {(input: HTMLInputElement) => string[]} resolveNativeQuestionIds
 */
export function applyResultsToQuestionArea(comparison, displayMap, resolveNativeQuestionIds) {
  if (typeof document === 'undefined') return
  clearMarks()
  const entries = Object.values(comparison || {})
  const choiceInputs = Array.from(document.querySelectorAll(CHOICE_SELECTOR))
  const choiceInputsFor = (questionId) => choiceInputs
    .filter((input) => resolveNativeQuestionIds(input).includes(questionId))
  markChoiceGroups(entries, choiceInputsFor)
  entries.forEach((entry) => {
    if (choiceInputsFor(normalizeQuestionId(entry?.questionId)).length) return
    if (entry?.isCorrect !== true && entry?.isCorrect !== false) return
    markDropzone(entry, displayMap || null)
  })
}
