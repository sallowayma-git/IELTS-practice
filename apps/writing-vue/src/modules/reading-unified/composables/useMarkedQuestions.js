/**
 * Marked ("flagged") questions of the unified reading page: one list of
 * normalized, unique question ids with a single owner. The only way a user
 * changes it is `toggleMarkedQuestion`, which reports through `onUserChange`
 * (the page wires that to its draft autosave). Hydration and reset use
 * `restoreMarkedQuestions` / `clearMarkedQuestions`, which never report, so
 * loading a draft or a submission cannot write one back.
 *
 * The question-id normalizer is injected (the page owns it) so this file has
 * no alias imports and runs under plain node in the static tests.
 */
import { ref } from 'vue'

export function useMarkedQuestions({ normalizeId, isReadOnly = () => false, onUserChange = () => {} }) {
  const markedQuestions = ref([])

  function uniqueIds(ids) {
    const seen = new Set()
    for (const entry of ids) {
      const id = normalizeId(entry)
      if (id) seen.add(id)
    }
    return [...seen]
  }

  function isMarkedQuestion(questionId) {
    const id = normalizeId(questionId)
    return Boolean(id && markedQuestions.value.includes(id))
  }

  function toggleMarkedQuestion(questionId) {
    if (isReadOnly()) return
    const id = normalizeId(questionId)
    if (!id) return
    markedQuestions.value = isMarkedQuestion(id)
      ? markedQuestions.value.filter((entry) => entry !== id)
      : [...markedQuestions.value, id]
    onUserChange(id)
  }

  function restoreMarkedQuestions(ids) {
    markedQuestions.value = Array.isArray(ids) ? uniqueIds(ids) : []
  }

  function clearMarkedQuestions() {
    markedQuestions.value = []
  }

  return {
    markedQuestions,
    isMarkedQuestion,
    toggleMarkedQuestion,
    restoreMarkedQuestions,
    clearMarkedQuestions
  }
}
