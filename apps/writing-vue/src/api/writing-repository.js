/**
 * Writing evaluation client — Tauri persisted state machine only.
 */

import { Channel } from '@tauri-apps/api/core'
import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'
import { requireWritingAttemptMode } from '@/api/writing-mode.js'

export function newIdempotencyKey(prefix = 'w') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function saveDraft(payload) {
  const taskType = String(payload.taskType ?? payload.task_type ?? '').trim().toLowerCase()
  if (taskType !== 'task1' && taskType !== 'task2') {
    throw new TypeError('writing task type must be task1 or task2')
  }
  const cmd = {
    attemptId: payload.attemptId,
    activity: 'writing',
    mode: requireWritingAttemptMode(payload.mode),
    assetId: payload.assetId || null,
    contentText: payload.contentText || '',
    promptSnapshot: payload.promptSnapshot || null,
    taskType,
    idempotencyKey: payload.idempotencyKey || newIdempotencyKey('draft')
  }
  const response = await invokeCommand('writing_save_draft', { cmd })
  return { source: 'tauri', draft: unwrapCommandResponse(response, 'writing_save_draft') }
}

export async function getDraft(attemptId) {
  const response = await invokeCommand('writing_get_draft', { attemptId })
  return { source: 'tauri', draft: unwrapCommandResponse(response, 'writing_get_draft') }
}

export async function cloneWritingDraft(sourceAttemptId, idempotencyKey) {
  const response = await invokeCommand('writing_clone_draft', {
    cmd: {
      sourceAttemptId,
      idempotencyKey: idempotencyKey || newIdempotencyKey('clone')
    }
  })
  return {
    source: 'tauri',
    draft: unwrapCommandResponse(response, 'writing_clone_draft')
  }
}

export async function submitAttempt(attemptId, idempotencyKey) {
  const response = await invokeCommand('writing_submit_attempt', {
    cmd: {
      attemptId,
      idempotencyKey: idempotencyKey || newIdempotencyKey('submit')
    }
  })
  return { source: 'tauri', attempt: unwrapCommandResponse(response, 'writing_submit_attempt') }
}

export async function startEvaluation(payload) {
  const onEvent = new Channel()
  onEvent.onmessage = (event) => {
    if (typeof payload.onEvent === 'function') payload.onEvent(event)
  }
  const response = await invokeCommand('writing_start_evaluation', {
    cmd: {
      attemptId: payload.attemptId,
      idempotencyKey: payload.idempotencyKey || newIdempotencyKey('eval'),
      taskType: payload.taskType || null,
      retryOf: payload.retryOf || null
    },
    onEvent
  })
  return {
    source: 'tauri',
    handle: unwrapCommandResponse(response, 'writing_start_evaluation')
  }
}

export async function listEvaluationEvents(evaluationId, afterSequence = 0) {
  const response = await invokeCommand('writing_list_evaluation_events', {
    evaluationId,
    afterSequence
  })
  return unwrapCommandResponse(response, 'writing_list_evaluation_events') || []
}

export async function cancelEvaluation(evaluationId) {
  const response = await invokeCommand('writing_cancel_evaluation', { evaluationId })
  return !!unwrapCommandResponse(response, 'writing_cancel_evaluation')
}

export async function getEvaluationForAttempt(attemptId) {
  const response = await invokeCommand('writing_get_evaluation', { attemptId })
  return {
    source: 'tauri',
    evaluation: unwrapCommandResponse(response, 'writing_get_evaluation')
  }
}

export const writingRepository = {
  saveDraft,
  getDraft,
  cloneWritingDraft,
  submitAttempt,
  startEvaluation,
  listEvaluationEvents,
  cancelEvaluation,
  getEvaluationForAttempt,
  newIdempotencyKey,
  isTauriRuntime
}

export default writingRepository
