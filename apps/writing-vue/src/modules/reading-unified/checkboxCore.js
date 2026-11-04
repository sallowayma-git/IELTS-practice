/**
 * Pure checkbox answer core for the unified reading page. Native exam markup
 * names checkbox groups in several shapes (q11, q9_10, q11-12-13, q12_40 where
 * q40 is a display number); these helpers map a group onto the logical
 * questions it owns and back. No DOM or Vue imports: exercised directly by
 * developer/tests/js/readingUnifiedCheckbox.test.mjs.
 */

// One logical id takes the full sorted array; a compound group spreads one
// value per member, in order.
export function planCheckboxAnswerWrites(expandedIds, checkedValues) {
  if (!expandedIds.length) return []
  if (expandedIds.length === 1) {
    return [{ questionId: expandedIds[0], value: checkedValues.slice() }]
  }
  return expandedIds.map((questionId, index) => ({
    questionId,
    value: checkedValues[index] || ''
  }))
}

// Union of every member answer: the boxes to tick for a native group.
export function collectCheckboxGroupTicks(groupIds, getRawAnswer) {
  return new Set(groupIds.flatMap((id) => {
    const raw = getRawAnswer(id)
    return Array.isArray(raw) ? raw : [raw]
  }).map((value) => String(value || '').trim()).filter(Boolean))
}

/**
 * Logical question ids a native input answers. Only the owning group's
 * questions qualify, so a display number that collides with another group's
 * logical id (q12_40 next to a real q40) never writes outside the group.
 *
 * @param {{ name: string, closest: Function }} input
 * @param {{ payload: object, expandQuestionSequence: Function, resolveAnswerAliases: Function, getInteraction: Function }} context
 */
export function resolveNativeQuestionIds(input, context) {
  const { payload, expandQuestionSequence, resolveAnswerAliases, getInteraction } = context
  const name = input.name
  const order = payload?.questionOrder || []
  const groupId = input.closest('[data-group-id]')?.dataset.groupId
  const group = (payload?.questionGroups || []).find((entry) => entry.groupId === groupId)
  const candidates = Array.isArray(group?.questionIds)
    ? order.filter((id) => group.questionIds.includes(id))
    : order
  const direct = expandQuestionSequence(name).filter((id) => candidates.includes(id))
  if (direct.length) return direct
  return candidates.filter((id) => getInteraction(id)?.name === name
    || resolveAnswerAliases(id, payload?.questionDisplayMap).includes(name))
}
