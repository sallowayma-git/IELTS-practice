/**
 * Two-way binding between the answer store and the native exam controls
 * rendered from v-html (text inputs, radios, checkbox groups, dropzones).
 * DOM -> store: handleQuestionInput on input/change. Store -> DOM:
 * syncDomAnswers after hydration, reset and every re-render.
 */
import {
  escapeCss,
  expandQuestionSequence,
  normalizeQuestionId,
  resolveAnswerAliases
} from '@/modules/practice-reading/readingQuestionIds'
import {
  collectCheckboxGroupTicks,
  planCheckboxAnswerWrites,
  resolveNativeQuestionIds as resolveNativeIds
} from '../checkboxCore.js'

const CHECKBOX_SELECTOR = '#question-groups input[type="checkbox"][name]'

export function useNativeAnswerControls(options) {
  const {
    payloadSource,
    readOnlySource,
    getInteraction,
    getRawAnswer,
    getAnswerEntries,
    setAnswer,
    isDragDropControl,
    syncDropzoneControl,
    onAnswerInput = () => {}
  } = options

  function resolveNativeQuestionIds(input) {
    return resolveNativeIds(input, {
      payload: payloadSource(),
      expandQuestionSequence,
      resolveAnswerAliases,
      getInteraction
    })
  }

  function setReadOnly(control) {
    const readOnly = readOnlySource()
    control.disabled = readOnly
    control.tabIndex = readOnly ? -1 : 0
    control.setAttribute('aria-disabled', readOnly ? 'true' : 'false')
  }

  function collectCheckboxGroup(input) {
    const questionIds = resolveNativeQuestionIds(input)
    if (!questionIds.length) return []
    const checkedValues = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${escapeCss(input.name)}"]`))
      .filter((box) => box.checked)
      .map((box) => String(box.value || '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, 'en'))
    planCheckboxAnswerWrites(questionIds, checkedValues).forEach((write) => {
      setAnswer(write.questionId, write.value)
    })
    return questionIds
  }

  function handleQuestionInput(event) {
    if (readOnlySource()) return
    const target = event.target
    if (!target?.name) return
    if (target.type === 'checkbox') {
      onAnswerInput(collectCheckboxGroup(target))
      return
    }
    const questionId = normalizeQuestionId(target.name)
    if (!questionId) return
    if (target.type === 'radio' && !target.checked) return
    setAnswer(questionId, target.value)
    onAnswerInput([questionId])
  }

  // Radios and text share the per-alias names; checkbox groups are restored
  // once per native name in syncDomAnswers because a compound name is absent
  // from any single question's alias list.
  function syncNativeControl(questionId, explicitValue = getRawAnswer(questionId)) {
    if (typeof document === 'undefined') return
    const interaction = getInteraction(questionId)
    // Bundled payloads carry no interactionModel: questions whose native
    // markup has dropzones route to the dropzone sync.
    if (interaction?.control === 'dragdrop' || (!interaction?.control && isDragDropControl(questionId))) {
      syncDropzoneControl(questionId, explicitValue)
      return
    }
    const names = new Set(resolveAnswerAliases(questionId, payloadSource()?.questionDisplayMap || null))
    if (interaction?.name) names.add(interaction.name)
    const expected = String(explicitValue || '').trim()
    names.forEach((name) => {
      const escaped = escapeCss(name)
      document.querySelectorAll(`input[type="radio"][name="${escaped}"]`).forEach((input) => {
        input.checked = String(input.value || '').trim() === expected
        setReadOnly(input)
      })
      document.querySelectorAll(`input[type="text"][name="${escaped}"], textarea[name="${escaped}"]`).forEach((input) => {
        input.value = String(explicitValue || '')
        setReadOnly(input)
      })
    })
  }

  function syncDomAnswers() {
    if (typeof document === 'undefined') return
    getAnswerEntries().forEach(([questionId, value]) => syncNativeControl(questionId, value))
    const ticksByName = new Map()
    document.querySelectorAll(CHECKBOX_SELECTOR).forEach((input) => {
      if (!ticksByName.has(input.name)) {
        ticksByName.set(input.name, collectCheckboxGroupTicks(resolveNativeQuestionIds(input), getRawAnswer))
      }
      input.checked = ticksByName.get(input.name).has(String(input.value || '').trim())
      setReadOnly(input)
    })
  }

  return {
    handleQuestionInput,
    syncDomAnswers,
    syncNativeControl,
    resolveNativeQuestionIds
  }
}
