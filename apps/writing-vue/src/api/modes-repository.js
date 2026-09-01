/**
 * Suite / endless / memorize mode repository — Tauri only.
 */

import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'
import { endlessSubmitIdempotencyKey } from './mode-idempotency.js'

function newKey(prefix = 'mode') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function createSuite(payload) {
  const response = await invokeCommand('suite_create', {
    cmd: {
      flowMode: payload.flowMode || 'simulation',
      frequencyScope: payload.frequencyScope || 'all',
      seed: payload.seed || null,
      sequence: (payload.sequence || []).map((item) =>
        typeof item === 'string'
          ? { assetId: item }
          : {
              assetId: item.assetId || item.examId || item.id,
              title: item.title || null,
              category: item.category || null
            }
      ),
      timer: payload.timer || null,
      idempotencyKey: payload.idempotencyKey || newKey('suite-create')
    }
  })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'suite_create') }
}

export async function getSuite(suiteId) {
  const response = await invokeCommand('suite_get', { suiteId })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'suite_get') }
}

export async function submitSuitePassage(payload) {
  const response = await invokeCommand('suite_submit_passage', {
    cmd: {
      suiteId: payload.suiteId,
      assetId: payload.assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      durationMs: payload.durationMs ?? null,
      titleSnapshot: payload.titleSnapshot || null,
      timerSnapshot: payload.timerSnapshot || null,
      idempotencyKey: payload.idempotencyKey || newKey('suite-submit')
    }
  })
  return { source: 'tauri', result: unwrapCommandResponse(response, 'suite_submit_passage') }
}

export async function cancelSuite(suiteId) {
  const response = await invokeCommand('suite_cancel', { suiteId })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'suite_cancel') }
}

export async function createEndless(payload) {
  const response = await invokeCommand('endless_create', {
    cmd: {
      poolPolicy: payload.poolPolicy || null,
      seed: payload.seed || null,
      idempotencyKey: payload.idempotencyKey || newKey('endless-create')
    }
  })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'endless_create') }
}

export async function getEndless(sessionId) {
  const response = await invokeCommand('endless_get', { sessionId })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'endless_get') }
}

export async function advanceEndless(sessionId) {
  const response = await invokeCommand('endless_advance', {
    cmd: { sessionId }
  })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'endless_advance') }
}

export async function saveEndlessPassageDraft(payload) {
  const response = await invokeCommand('endless_save_passage_draft', {
    cmd: {
      sessionId: payload.sessionId,
      assetId: payload.assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      titleSnapshot: payload.titleSnapshot || null,
      timerSnapshot: payload.timerSnapshot || null,
      idempotencyKey: payload.idempotencyKey || `endless-draft-${payload.sessionId}-${payload.assetId}`
    }
  })
  return { source: 'tauri', result: unwrapCommandResponse(response, 'endless_save_passage_draft') }
}

export async function saveSuitePassageDraft(payload) {
  const response = await invokeCommand('suite_save_passage_draft', {
    cmd: {
      suiteId: payload.suiteId,
      assetId: payload.assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      titleSnapshot: payload.titleSnapshot || null,
      timerSnapshot: payload.timerSnapshot || null,
      idempotencyKey: payload.idempotencyKey || `suite-draft-${payload.suiteId}-${payload.assetId}`
    }
  })
  return { source: 'tauri', result: unwrapCommandResponse(response, 'suite_save_passage_draft') }
}

export async function cancelEndless(sessionId) {
  const response = await invokeCommand('endless_cancel', { sessionId })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'endless_cancel') }
}

export async function submitEndless(payload) {
  const sessionId = String(payload.sessionId || '').trim()
  const assetId = String(payload.assetId || '').trim()
  const response = await invokeCommand('endless_submit', {
    cmd: {
      sessionId,
      assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      durationMs: payload.durationMs ?? null,
      titleSnapshot: payload.titleSnapshot || null,
      timerSnapshot: payload.timerSnapshot || null,
      // A lost IPC response is a retry of this exact session passage, not a
      // new submission. The server owns replay; this key must survive reload.
      idempotencyKey: payload.idempotencyKey || endlessSubmitIdempotencyKey(sessionId, assetId)
    }
  })
  return { source: 'tauri', result: unwrapCommandResponse(response, 'endless_submit') }
}

export async function createMemorize(payload) {
  const response = await invokeCommand('memorize_create', {
    cmd: {
      assetId: payload.assetId,
      titleSnapshot: payload.titleSnapshot || null,
      idempotencyKey: payload.idempotencyKey || newKey('memorize')
    }
  })
  return { source: 'tauri', session: unwrapCommandResponse(response, 'memorize_create') }
}

export async function finishMemorize(attemptId) {
  const response = await invokeCommand('memorize_finish', { attemptId })
  return { source: 'tauri', attempt: unwrapCommandResponse(response, 'memorize_finish') }
}

export const modesRepository = {
  createSuite,
  getSuite,
  submitSuitePassage,
  saveSuitePassageDraft,
  cancelSuite,
  createEndless,
  getEndless,
  saveEndlessPassageDraft,
  cancelEndless,
  advanceEndless,
  submitEndless,
  createMemorize,
  finishMemorize,
  newKey,
  isTauriRuntime
}

export default modesRepository
