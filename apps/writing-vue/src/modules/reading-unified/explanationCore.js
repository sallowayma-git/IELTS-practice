/**
 * Explanation view-model helpers for the unified reading page.
 *
 * The bundled explanations (ReadingExplanationV1: passageNotes + questionExplanations)
 * map 1:1 onto what opensource's unified page renders; this module adapts them to the
 * per-group card layout. Pure functions — no Vue imports.
 */

function normalizeQuestionId(value) {
  return String(value || '').trim().replace(/^q/i, 'q').toLowerCase()
}

export function normalizeExplanationSections(sections) {
  if (!Array.isArray(sections)) return []
  return sections
    .map((section, index) => {
      const items = (Array.isArray(section?.items) ? section.items : [])
        .map((item) => {
          const questionNumber = Number(
            String(item?.questionNumber ?? item?.questionId ?? '').match(/\d+/)?.[0]
          )
          const text = String(item?.text || '').trim()
          if (!Number.isFinite(questionNumber) || !text) return null
          return {
            questionNumber,
            questionId: normalizeQuestionId(item?.questionId || `q${questionNumber}`),
            text
          }
        })
        .filter(Boolean)
      const text = String(section?.text || '').trim()
      if (!items.length && !text) return null
      const start = Number(section?.questionRange?.start)
      const end = Number(section?.questionRange?.end)
      return {
        sectionTitle: String(section?.sectionTitle || `题目讲解 ${index + 1}`).trim(),
        mode: String(section?.mode || '').trim(),
        questionRange: Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null,
        text,
        items
      }
    })
    .filter(Boolean)
}

function questionOfficialNumber(questionId, displayMap) {
  const displayNumber = Number(String(displayMap?.[questionId] || '').match(/\d+/)?.[0])
  if (Number.isFinite(displayNumber)) return displayNumber
  const internalNumber = Number(String(normalizeQuestionId(questionId) || '').replace(/^q/, ''))
  return Number.isFinite(internalNumber) ? internalNumber : null
}

function sectionOverlapsNumbers(section, numbers) {
  if (!numbers.length) return false
  const itemNumbers = new Set(section.items.map((item) => item.questionNumber))
  if (numbers.some((value) => itemNumbers.has(value))) return true
  const range = section.questionRange
  if (!range) return false
  return numbers.some((value) => value >= range.start && value <= range.end)
}

const SPLIT_KINDS = new Set([
  'single_choice',
  'multi_choice',
  'true_false_not_given',
  'yes_no_not_given'
])

/** Sections whose questions fall inside this group, split per-question like the original. */
export function sectionsForGroup(sections, group, displayMap) {
  const numbers = (Array.isArray(group?.questionIds) ? group.questionIds : [])
    .map((questionId) => questionOfficialNumber(questionId, displayMap))
    .filter((value) => Number.isFinite(value))
  if (!numbers.length) return []
  const splitMode = SPLIT_KINDS.has(String(group?.kind || ''))
  return sections
    .filter((section) => sectionOverlapsNumbers(section, numbers))
    .map((section) => {
      const matchedItems = section.items.filter((item) => numbers.includes(item.questionNumber))
      const groupMode = section.mode === 'group' || (!splitMode && section.text)
      return {
        ...section,
        text: groupMode || (!matchedItems.length && section.text) ? section.text : '',
        items: groupMode ? [] : matchedItems
      }
    })
    .filter((section) => section.text || section.items.length)
}

/** Result rows ordered like the original renderResults (numeric question label). */
export function buildResultRows(answerComparison, questionOrder, displayMap) {
  const rows = []
  const seen = new Set()
  for (const questionId of Array.isArray(questionOrder) ? questionOrder : []) {
    const entry = answerComparison?.[questionId]
    if (entry) seen.add(questionId)
    rows.push({ questionId, entry: entry || null })
  }
  for (const [questionId, entry] of Object.entries(answerComparison || {})) {
    if (!seen.has(questionId)) rows.push({ questionId, entry })
  }
  return rows.map(({ questionId, entry }) => {
    const label = String(displayMap?.[questionId] || String(questionId).replace(/^q/i, ''))
    const partial = Number(entry?.partialCorrectCount) || 0
    const weight = Number(entry?.weight) || 1
    const correctnessKnown = entry?.isCorrect === true || entry?.isCorrect === false
    const isPartial = entry?.isCorrect === false && partial > 0 && weight > 1
    return {
      questionId,
      label,
      userAnswer: entry?.userAnswer == null ? '' : formatAnswerValue(entry.userAnswer),
      correctAnswer: entry?.correctAnswer == null ? '' : formatAnswerValue(entry.correctAnswer),
      status: entry?.isCorrect === true
        ? '✓'
        : (isPartial ? `${partial}/${weight}` : (correctnessKnown ? '✗' : '—')),
      statusClass: entry?.isCorrect === true
        ? 'result-correct'
        : (isPartial ? 'result-partial' : (correctnessKnown ? 'result-incorrect' : 'result-unknown'))
    }
  })
}

function formatAnswerValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(', ')
  }
  return String(value ?? '').trim()
}
