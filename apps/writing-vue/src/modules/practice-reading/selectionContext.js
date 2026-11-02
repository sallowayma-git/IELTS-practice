/**
 * Coach context from the current text selection: the selected text, whether
 * it sits in the passage or the questions, and the question numbers and
 * paragraph labels it touches.
 */
import { normalizeQuestionId } from './readingQuestionIds'

export function readSelectedContext(getDisplayLabel) {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return null
  }
  const selection = window.getSelection()
  const text = selection && typeof selection.toString === 'function'
    ? String(selection.toString() || '').trim()
    : ''
  if (!text) {
    return null
  }
  const element = resolveSelectionElement(selection)
  const questionNumbers = collectSelectedQuestionNumbers(element, getDisplayLabel)
  const paragraphLabels = collectSelectedParagraphLabels(element)
  const scope = element?.closest?.('.question-panel, .question-group, [data-answer-question-id], [data-review-question-id]')
    ? 'question'
    : 'passage'
  return {
    text: text.slice(0, 500),
    scope,
    questionNumbers,
    paragraphLabels
  }
}

function resolveSelectionElement(selection) {
  const nodes = [selection?.anchorNode, selection?.focusNode].filter(Boolean)
  for (const node of nodes) {
    const element = node.nodeType === 3 ? node.parentElement : node
    if (element && typeof element.closest === 'function') {
      return element
    }
  }
  return null
}

function normalizeSelectedQuestionNumber(value, getDisplayLabel) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const exactNumber = raw.match(/^\d+$/)
  const qNumber = raw.match(/\bq(\d+)\b/i) || raw.match(/^q(\d+)/i)
  const numeric = exactNumber?.[0] || qNumber?.[1] || ''
  if (!numeric) return ''
  const questionId = normalizeQuestionId(`q${Number(numeric)}`)
  return String(getDisplayLabel(questionId) || numeric).replace(/^q/i, '').trim()
}

function collectSelectedQuestionNumbers(element, getDisplayLabel) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const candidates = []
  const direct = element.closest('[data-answer-question-id], [data-review-question-id], [data-question-ids], [data-question], [data-question-id], [name], [id]')
  if (direct?.dataset?.questionIds) {
    candidates.push(...String(direct.dataset.questionIds).split(','))
  }
  if (direct?.dataset?.answerQuestionId) {
    candidates.push(direct.dataset.answerQuestionId)
  }
  if (direct?.dataset?.reviewQuestionId) {
    candidates.push(direct.dataset.reviewQuestionId)
  }
  if (direct?.dataset?.question) {
    candidates.push(direct.dataset.question)
  }
  if (direct?.dataset?.questionId) {
    candidates.push(direct.dataset.questionId)
  }
  const name = direct?.getAttribute?.('name')
  if (name) candidates.push(name)
  if (direct?.id) candidates.push(direct.id)

  const group = element.closest('[data-question-ids]')
  if (group?.dataset?.questionIds) {
    candidates.push(...String(group.dataset.questionIds).split(','))
  }
  return Array.from(new Set(candidates.map((value) => normalizeSelectedQuestionNumber(value, getDisplayLabel)).filter(Boolean)))
}

function collectSelectedParagraphLabels(element) {
  if (!element || typeof element.closest !== 'function') {
    return []
  }
  const labels = []
  const paragraph = element.closest('[data-paragraph], [data-paragraph-label], .passage-block, .paragraph-wrapper')
  if (paragraph?.dataset?.paragraph) {
    labels.push(paragraph.dataset.paragraph)
  }
  if (paragraph?.dataset?.paragraphLabel) {
    labels.push(paragraph.dataset.paragraphLabel)
  }
  const text = String(paragraph?.textContent || element.textContent || '').trim()
  const match = text.match(/^(?:paragraph\s*)?([A-H])\b/i)
  if (match?.[1]) {
    labels.push(match[1])
  }
  return Array.from(new Set(labels.map((item) => String(item || '').replace(/^paragraph\s*/i, '').trim().toUpperCase()).filter(Boolean)))
}
