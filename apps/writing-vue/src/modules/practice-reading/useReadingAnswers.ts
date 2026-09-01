import { computed, reactive, unref, type MaybeRefOrGetter } from 'vue'

export type ReadingAnswerValue = string | string[]

interface ReadingPayload {
  questionOrder?: string[]
  answerKey?: Record<string, unknown>
}

interface AnswerMutationOptions {
  track?: boolean
  syncNative?: boolean
}

interface ReadingAnswersOptions {
  payloadSource?: MaybeRefOrGetter<ReadingPayload | null | undefined>
  readOnlySource?: MaybeRefOrGetter<boolean | undefined>
  onTrack?: (questionId: string, previousFingerprint: string, nextFingerprint: string) => void
  onSyncNative?: (questionId: string) => void
  onMutate?: (questionId: string, value: ReadingAnswerValue, metadata: {
    changed: boolean
    previousFingerprint: string
    nextFingerprint: string
    options: AnswerMutationOptions
  }) => void
}

interface InitializeAnswerOptions { prefillAnswerKey?: boolean }

function resolvePayload(source?: MaybeRefOrGetter<ReadingPayload | null | undefined>) {
  if (typeof source === 'function') {
    return source()
  }
  return unref(source)
}

function getQuestionOrder(readingPayload?: ReadingPayload | null): string[] {
  return Array.isArray(readingPayload?.questionOrder) ? readingPayload.questionOrder : []
}

export function cloneAnswerValue(value: unknown): ReadingAnswerValue {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean)
  }
  if (value == null) {
    return ''
  }
  return String(value).trim()
}

export function getAnswerFingerprint(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean).sort().join('|')
  }
  return String(value || '').trim()
}

export function useReadingAnswers(options: ReadingAnswersOptions = {}) {
  const answers = reactive<Record<string, ReadingAnswerValue>>({})
  const readingPayload = computed(() => resolvePayload(options.payloadSource))
  const questionOrder = computed(() => getQuestionOrder(readingPayload.value))
  const answeredCount = computed(() => questionOrder.value.filter((questionId) => hasAnswer(questionId)).length)

  function clearAnswers() {
    Object.keys(answers).forEach((key) => {
      delete answers[key]
    })
  }

  function initializeAnswers(payload = readingPayload.value, initOptions: InitializeAnswerOptions = {}) {
    clearAnswers()
    const order = getQuestionOrder(payload)
    order.forEach((questionId) => {
      answers[questionId] = ''
    })
    const answerKey = payload?.answerKey
    if (initOptions.prefillAnswerKey && answerKey) {
      order.forEach((questionId) => {
        answers[questionId] = cloneAnswerValue(answerKey[questionId])
      })
    }
  }

  function hasQuestion(questionId: string) {
    return questionOrder.value.includes(questionId)
  }

  function getAnswerValue(questionId: string) {
    const value = getRawAnswer(questionId)
    return Array.isArray(value) ? value.join(', ') : String(value || '')
  }

  function hasAnswer(questionId: string) {
    const value = getRawAnswer(questionId)
    return Array.isArray(value) ? value.length > 0 : String(value || '').trim().length > 0
  }

  function isOptionSelected(questionId: string, optionValue: unknown) {
    const value = getRawAnswer(questionId)
    const normalizedOption = String(optionValue || '').trim()
    return Array.isArray(value)
      ? value.includes(normalizedOption)
      : String(value || '').trim() === normalizedOption
  }

  function getRawAnswer(questionId: string): ReadingAnswerValue {
    return cloneAnswerValue(answers[String(questionId || '').trim()])
  }

  function assignAnswer(questionId: string, value: unknown, assignOptions: AnswerMutationOptions = {}) {
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

  function setAnswer(questionId: string, value: unknown, setOptions: AnswerMutationOptions = {}) {
    if (unref(options.readOnlySource)) {
      return false
    }
    return assignAnswer(questionId, value, { ...setOptions, track: true })
  }

  function toggleAnswerOption(questionId: string, optionValue: unknown, checked: boolean, toggleOptions: AnswerMutationOptions = {}) {
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
