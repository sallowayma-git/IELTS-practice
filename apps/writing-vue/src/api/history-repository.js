/**
 * Unified history repository — Tauri SQLite v2 only.
 */

import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'
import { normalizeHistoryViewModel } from '@/api/history-view-model.js'

/** Matches backend UI hard-cap on list_history. */
const LIST_HISTORY_UI_MAX = 200

/**
 * @param {object} query
 */
export async function listHistory(query = {}) {
  const response = await invokeCommand('list_history', {
    query: {
      activity: query.activity || null,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      search: query.search || null,
      startDate: query.startDate || null,
      endDate: query.endDate || null,
      minScore: query.minScore ?? null,
      maxScore: query.maxScore ?? null,
      scoreScale: query.scoreScale ?? query.score_scale ?? null,
      taskType: query.taskType ?? query.task_type ?? null
    }
  })
  const page = unwrapCommandResponse(response, 'list_history')
  return {
    source: 'tauri',
    items: (page?.items || []).map(normalizeHistoryViewModel),
    total: Number(page?.total || 0),
    limit: Number(page?.limit || query.limit || 20),
    offset: Number(page?.offset || query.offset || 0),
    nextCursor: page?.nextCursor || null
  }
}

/**
 * Page through list_history until exhausted (or maxItems).
 * list_history hard-caps each page at 200, so bulk clear/export clients must page.
 * @param {object} query
 * @param {{ maxItems?: number }} [options]
 */
export async function listHistoryAll(query = {}, options = {}) {
  const maxItems = Number(options.maxItems || 50_000)
  const pageLimit = Math.min(LIST_HISTORY_UI_MAX, Math.max(1, Number(query.limit || LIST_HISTORY_UI_MAX)))
  const items = []
  let offset = 0
  let total = Infinity

  while (items.length < maxItems && offset < total) {
    const page = await listHistory({
      ...query,
      limit: pageLimit,
      offset
    })
    total = Number(page.total || 0)
    const batch = page.items || []
    if (batch.length === 0) break
    items.push(...batch)
    offset += batch.length
    if (items.length >= total) break
  }

  if (items.length > maxItems) {
    items.length = maxItems
  }

  return {
    source: 'tauri',
    items,
    total: Number.isFinite(total) ? total : items.length,
    limit: items.length,
    offset: 0,
    nextCursor: null
  }
}

export async function getHistoryDetail(attemptId) {
  const response = await invokeCommand('get_history_detail', { attemptId })
  return {
    source: 'tauri',
    detail: unwrapCommandResponse(response, 'get_history_detail')
  }
}

export async function getWritingHistoryStatistics(range = 'all') {
  const response = await invokeCommand('history_writing_statistics', {
    query: { range: String(range || 'all') }
  })
  return {
    source: 'tauri',
    statistics: unwrapCommandResponse(response, 'history_writing_statistics')
  }
}

export async function exportHistory(format = 'csv', query = {}) {
  const response = await invokeCommand('export_history', {
    cmd: {
      format,
      query: {
        activity: query.activity || null,
        limit: query.limit ?? 10000,
        offset: 0,
        search: query.search || null,
        startDate: query.startDate || null,
        endDate: query.endDate || null,
        minScore: query.minScore ?? null,
        maxScore: query.maxScore ?? null,
        scoreScale: query.scoreScale ?? query.score_scale ?? null,
        taskType: query.taskType ?? query.task_type ?? null
      }
    }
  })
  return {
    source: 'tauri',
    result: unwrapCommandResponse(response, 'export_history')
  }
}

export async function deleteHistoryAttempt(attemptId) {
  const response = await invokeCommand('delete_history_attempt', { attemptId })
  return unwrapCommandResponse(response, 'delete_history_attempt')
}

export async function deleteHistoryAttempts(attemptIds) {
  const response = await invokeCommand('delete_history_attempts', {
    cmd: { attemptIds: Array.isArray(attemptIds) ? attemptIds : [] }
  })
  return Number(unwrapCommandResponse(response, 'delete_history_attempts') || 0)
}

export async function clearHistory(activity = null) {
  const response = await invokeCommand('clear_history', {
    cmd: { activity: activity || null }
  })
  return Number(unwrapCommandResponse(response, 'clear_history') || 0)
}

/**
 * Map history detail (AttemptRecord) → reading page submission shape.
 * Correct answers may be absent after field contraction; correctness flags remain.
 */
export function mapHistoryDetailToSubmission(detail) {
  const attempt = detail?.attempt
  if (!attempt) return null
  const activity = String(attempt.activity || detail?.summary?.activity || '').toLowerCase()
  if (activity && activity !== 'reading') return null

  const answers = {}
  const answerComparison = {}
  const markedQuestions = []
  for (const entry of attempt.answers || []) {
    const questionId = String(entry.questionId || entry.question_id || '').trim()
    if (!questionId) continue
    answers[questionId] = entry.answer
    answerComparison[questionId] = {
      questionId,
      userAnswer: entry.answer,
      correctAnswer: entry.correctAnswer ?? entry.correct_answer ?? null,
      isCorrect: entry.isCorrect ?? entry.is_correct ?? null,
      weight: entry.weight ?? 1,
      matchMode: 'single',
      questionKind: entry.questionKind ?? entry.question_kind ?? null
    }
    if (entry.marked) markedQuestions.push(questionId)
  }

  const accuracy = attempt.scoreValue ?? attempt.score_value ?? null
  const durationMs = attempt.durationMs ?? attempt.duration_ms ?? 0
  const correctCount = attempt.correctCount ?? attempt.correct_count ?? 0
  const questionCount = attempt.questionCount ?? attempt.question_count ?? 0
  const percentage = accuracy != null ? Math.round(Number(accuracy) * 1000) / 10 : 0
  const assetId = attempt.assetId || attempt.asset_id || detail?.summary?.assetId || null
  const highlights = normalizeAnnotations(
    Array.isArray(attempt.annotations) ? attempt.annotations : []
  )
  return {
    sessionId: attempt.id,
    attemptId: attempt.id,
    assetId,
    examId: assetId,
    activity: 'reading',
    status: attempt.status || 'completed',
    answers,
    answerComparison,
    markedQuestions,
    score: accuracy,
    correctCount,
    questionCount,
    percentage,
    scoreInfo: { correct: Number(correctCount) || 0, totalQuestions: Number(questionCount) || 0, percentage },
    durationMs,
    duration: Math.round(Number(durationMs || 0) / 1000),
    submittedAt: attempt.submittedAt || attempt.submitted_at || attempt.completedAt || attempt.completed_at || null,
    title: attempt.titleSnapshot || attempt.title_snapshot || detail?.summary?.title || null,
    highlights,
    source: 'tauri-history'
  }
}

function normalizeAnnotations(items) {
  return (items || []).map((item) => {
    const anchor = item?.anchor || {}
    return {
      id: item.id,
      scope: item.scope || 'passage',
      text: anchor.text || item.text || '',
      kind: item.kind || 'highlight',
      questionId: item.questionId || item.question_id || null,
      startOffset: anchor.startOffset ?? anchor.start_offset ?? item.startOffset ?? null,
      endOffset: anchor.endOffset ?? anchor.end_offset ?? item.endOffset ?? null,
      before: anchor.before || item.before || '',
      after: anchor.after || item.after || '',
      occurrence: anchor.occurrence ?? item.occurrence ?? 0,
      createdAt: item.createdAt || item.created_at || null,
      noteText: item.noteText || item.note_text || null
    }
  }).filter((entry) => entry.text)
}

export const historyRepository = {
  listHistory,
  listHistoryAll,
  getHistoryDetail,
  getWritingHistoryStatistics,
  exportHistory,
  deleteHistoryAttempt,
  deleteHistoryAttempts,
  clearHistory,
  mapHistoryDetailToSubmission,
  isTauriRuntime
}

export default historyRepository
