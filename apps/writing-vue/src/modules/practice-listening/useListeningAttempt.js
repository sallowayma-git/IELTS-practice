/**
 * Listening attempt surface: draft persistence, idempotent submit and the
 * review mapping used by the practice page.
 *
 * The wire shapes are owned by Rust:
 *   listening_save_draft       -> AttemptRecord
 *   listening_get_open_draft   -> AttemptRecord | null
 *   listening_submit_attempt   -> ListeningSubmitResult
 *   get_history_detail         -> HistoryDetailResponse (existing command)
 *
 * Review reads through `get_history_detail`; no listening-specific history IPC
 * command exists, and this module is the only place that maps that detail into
 * the small shape ListeningReviewPanel renders.
 */

import {
  getOpenListeningDraft as listeningGetOpenDraft,
  listeningRepository,
  saveListeningDraft as listeningSaveDraft,
  submitListeningAttempt as listeningSubmitAttempt
} from '@/api/listening-repository.js'
import { getHistoryDetail } from '@/api/history-repository.js'
import { normalizeQuestionId } from '@/modules/practice-reading/readingQuestionIds'

function text(value) {
  return String(value ?? '').trim()
}

function answerRows(attempt) {
  return Array.isArray(attempt?.answers) ? attempt.answers : []
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** A draft is only this asset's when both ids agree. */
export function isDraftForAsset(attempt, assetId) {
  if (!attempt?.id) return false
  const draftAssetId = text(attempt.assetId ?? attempt.asset_id)
  return Boolean(draftAssetId) && draftAssetId === text(assetId)
}

/** Map ListeningSubmitResult onto the score + answer rows the page shows. */
export function mapListeningSubmitResult(result, extras = {}) {
  const attempt = result?.attempt || {}
  const scoreValue = toNumber(result?.scoreValue ?? attempt.scoreValue, 0)
  const correctCount = toNumber(result?.correctCount ?? attempt.correctCount, 0)
  const questionCount = toNumber(result?.questionCount ?? attempt.questionCount, 0)
  return {
    attemptId: text(attempt.id) || text(extras.attemptId) || null,
    assetId: text(attempt.assetId) || text(extras.assetId) || null,
    scoreValue,
    correctCount,
    questionCount,
    percentage: questionCount > 0 ? Math.round((correctCount / questionCount) * 1000) / 10 : 0,
    durationMs: toNumber(attempt.durationMs ?? extras.durationMs, 0),
    idempotentReplay: Boolean(result?.idempotentReplay),
    recoveredDraftId: text(result?.recoveredDraftId) || null,
    rows: answerRows(attempt).map(normalizeAnswerRow).filter(Boolean)
  }
}

function normalizeAnswerRow(entry) {
  const questionId = normalizeQuestionId(entry?.questionId ?? entry?.question_id)
  if (!questionId) return null
  return {
    questionId,
    userAnswer: entry?.answer ?? null,
    isCorrect: entry?.isCorrect ?? entry?.is_correct ?? null,
    weight: toNumber(entry?.weight, 1) || 1,
    questionKind: entry?.questionKind ?? entry?.question_kind ?? null,
    marked: Boolean(entry?.marked)
  }
}

/**
 * Map `get_history_detail` onto the review view model. The answer key is NOT
 * in the history record; the page fills correct answers from the asset payload.
 */
export function mapHistoryDetailToListeningReview(detail) {
  const attempt = detail?.attempt
  if (!attempt) {
    throw new Error('未找到这条听力记录')
  }
  const activity = text(attempt.activity).toLowerCase()
  if (activity && activity !== 'listening') {
    throw new Error('这条记录不是听力练习')
  }
  const rows = answerRows(attempt).map(normalizeAnswerRow).filter(Boolean)
  const answers = {}
  rows.forEach((row) => {
    answers[row.questionId] = row.userAnswer
  })
  const correctCount = toNumber(attempt.correctCount ?? detail?.summary?.correctCount, 0)
  const questionCount = toNumber(attempt.questionCount, 0)
  return {
    attemptId: text(attempt.id),
    assetId: text(attempt.assetId) || text(detail?.summary?.assetId) || null,
    title: text(attempt.titleSnapshot) || text(detail?.summary?.title) || null,
    submittedAt: text(attempt.submittedAt) || text(attempt.completedAt) || null,
    durationMs: toNumber(attempt.durationMs, 0),
    scoreValue: attempt.scoreValue == null ? null : toNumber(attempt.scoreValue, 0),
    correctCount,
    questionCount,
    percentage: questionCount > 0 ? Math.round((correctCount / questionCount) * 1000) / 10 : null,
    answers,
    rows
  }
}

function explanationText(entry) {
  if (typeof entry === 'string') return text(entry)
  if (entry && typeof entry === 'object') {
    return text(entry.text ?? entry.explanation ?? entry.note)
  }
  return ''
}

/**
 * `reviewExplanations` is open-ended pack content. Accept the shapes a pack can
 * plausibly ship: a questionId -> text map, a questionExplanations section list
 * (the reading shape), or a flat item list. Unknown shapes simply yield {}.
 */
export function buildListeningExplanationMap(value) {
  const map = {}
  const add = (questionId, entry) => {
    const id = normalizeQuestionId(questionId)
    const explanation = explanationText(entry)
    if (id && explanation) map[id] = explanation
  }
  const addItem = (item) => {
    if (!item || typeof item !== 'object') return
    add(item.questionId ?? item.question_id ?? item.id ?? item.questionNumber, item)
  }
  if (Array.isArray(value)) {
    value.forEach(addItem)
    return map
  }
  if (!value || typeof value !== 'object') return map
  if (Array.isArray(value.questionExplanations)) {
    value.questionExplanations.forEach((section) => {
      if (Array.isArray(section?.items)) section.items.forEach(addItem)
    })
  }
  if (Array.isArray(value.items)) value.items.forEach(addItem)
  Object.entries(value).forEach(([key, entry]) => {
    if (['questionExplanations', 'passageNotes', 'items'].includes(key)) return
    add(key, entry)
  })
  return map
}

export function useListeningAttempt() {
  function newAttemptId() {
    return listeningRepository.newKey('listen')
  }

  function newIdempotencyKey(prefix = 'draft') {
    return listeningRepository.newKey(prefix)
  }

  async function persistDraft(input) {
    const { attempt } = await listeningSaveDraft(input)
    return attempt || null
  }

  async function fetchOpenDraft(assetId) {
    const { attempt } = await listeningGetOpenDraft(assetId)
    return attempt || null
  }

  async function submit(input) {
    const { result } = await listeningSubmitAttempt(input)
    return {
      raw: result,
      submission: mapListeningSubmitResult(result, input)
    }
  }

  async function fetchReviewDetail(attemptId) {
    const { detail } = await getHistoryDetail(attemptId)
    return detail
  }

  return {
    newAttemptId,
    newIdempotencyKey,
    persistDraft,
    fetchOpenDraft,
    submit,
    fetchReviewDetail
  }
}

export default useListeningAttempt
