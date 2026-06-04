import { computed, reactive, unref } from 'vue'

function resolvePayload(source) {
  if (typeof source === 'function') {
    return source()
  }
  return unref(source)
}

function getQuestionOrder(readingPayload) {
  return Array.isArray(readingPayload?.questionOrder) ? readingPayload.questionOrder : []
}

export function cloneAnswerValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean)
  }
  if (value == null) {
    return ''
  }
  return String(value).trim()
}

export function getAnswerFingerprint(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).sort().join('|')
  }
  return String(value || '').trim()
}

export function useReadingAnswers(options = {}) {
  const answers = reactive({})
  const readingPayload = computed(() => resolvePayload(options.payloadSource))
  const questionOrder = computed(() => getQuestionOrder(readingPayload.value))
  const answeredCount = computed(() => questionOrder.value.filter((questionId) => hasAnswer(questionId)).length)

  function clearAnswers() {
    Object.keys(answers).forEach((key) => {
      delete answers[key]
    })
  }

  function initializeAnswers(payload = readingPayload.value, initOptions = {}) {
    clearAnswers()
    const order = getQuestionOrder(payload)
    order.forEach((questionId) => {
      answers[questionId] = ''
    })
    if (initOptions.prefillAnswerKey && payload?.answerKey && typeof payload.answerKey === 'object') {
      order.forEach((questionId) => {
        answers[questionId] = cloneAnswerValue(payload.answerKey[questionId])
      })
    }
  }

  function hasQuestion(questionId) {
    return questionOrder.value.includes(questionId)
  }

  function getAnswerValue(questionId) {
    const value = getRawAnswer(questionId)
    return Array.isArray(value) ? value.join(', ') : String(value || '')
  }

  function hasAnswer(questionId) {
    const value = getRawAnswer(questionId)
    return Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0
  }

  function isOptionSelected(questionId, optionValue) {
    const value = getRawAnswer(questionId)
    const normalizedOption = String(optionValue || '').trim()
    return Array.isArray(value)
      ? value.includes(normalizedOption)
      : String(value || '').trim() === normalizedOption
  }

  function getRawAnswer(questionId) {
    return cloneAnswerValue(answers[String(questionId || '').trim()])
  }

  function assignAnswer(questionId, value, assignOptions = {}) {
    const normalizedQuestionId = String(questionId || '').trim()
    if (!normalizedQuestionId || !hasQuestion(normalizedQuestionId)) {
      return false
    }
    const previousFingerprint = getAnswerFingerprint(answers[normalizedQuestionId])
    answers[normalizedQuestionId] = cloneAnswerValue(value)
    const nextFingerprint = getAnswerFingerprint(answers[normalizedQuestionId])
    if (assignOptions.track && typeof options.onTrack === 'function') {
      options.onTrack(normalizedQuestionId, previousFingerprint, nextFingerprint)
    }
    if (assignOptions.syncNative && typeof options.onSyncNative === 'function') {
      options.onSyncNative(normalizedQuestionId)
    }
    if (typeof options.onMutate === 'function') {
      options.onMutate(normalizedQuestionId, answers[normalizedQuestionId], {
        changed: previousFingerprint !== nextFingerprint,
        previousFingerprint,
        nextFingerprint,
        options: assignOptions
      })
    }
    return true
  }

  function setAnswer(questionId, value, setOptions = {}) {
    if (unref(options.readOnlySource)) {
      return false
    }
    return assignAnswer(questionId, value, { ...setOptions, track: true })
  }

  function toggleAnswerOption(questionId, optionValue, checked, toggleOptions = {}) {
    if (unref(options.readOnlySource)) {
      return false
    }
    const normalizedQuestionId = String(questionId || '').trim()
    const normalizedOption = String(optionValue || '').trim()
    const current = Array.isArray(answers[normalizedQuestionId])
      ? answers[normalizedQuestionId].slice()
      : String(answers[normalizedQuestionId] || '').split(',').map((entry) => entry.trim()).filter(Boolean)
    const next = checked
      ? Array.from(new Set([...current, normalizedOption])).sort((left, right) => left.localeCompare(right, 'en'))
      : current.filter((entry) => entry !== normalizedOption)
    return assignAnswer(normalizedQuestionId, next, { ...toggleOptions, track: true })
  }

  function snapshotAnswers() {
    return Object.fromEntries(Object.entries(answers))
  }

  function getAnswerEntries() {
    return Object.entries(snapshotAnswers())
  }

  return {
    questionOrder,
    answeredCount,
    initializeAnswers,
    clearAnswers,
    assignAnswer,
    setAnswer,
    toggleAnswerOption,
    getAnswerValue,
    getRawAnswer,
    getAnswerEntries,
    hasAnswer,
    isOptionSelected,
    snapshotAnswers,
    cloneAnswerValue,
    getAnswerFingerprint
  }
}
