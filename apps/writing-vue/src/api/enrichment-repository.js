/**
 * Annotations / dictionary / vocab / coach repository — Tauri only.
 */

import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'

export async function upsertAnnotation(cmd) {
  const response = await invokeCommand('annotation_upsert', { cmd })
  return { source: 'tauri', annotation: unwrapCommandResponse(response, 'annotation_upsert') }
}

export async function listAnnotations(assetId, attemptId = null) {
  const response = await invokeCommand('annotation_list', { assetId, attemptId })
  return { source: 'tauri', items: unwrapCommandResponse(response, 'annotation_list') || [] }
}

export async function deleteAnnotation(id, assetId, attemptId = null) {
  const response = await invokeCommand('annotation_delete', { id, assetId, attemptId })
  return !!unwrapCommandResponse(response, 'annotation_delete')
}

export async function revalidateAnnotations(assetId, attemptId, scope, document) {
  const response = await invokeCommand('annotation_revalidate', { assetId, attemptId, scope, document })
  return { source: 'tauri', items: unwrapCommandResponse(response, 'annotation_revalidate') || [] }
}

export async function lookupDictionary(term) {
  const response = await invokeCommand('dictionary_lookup', { term })
  return { source: 'tauri', entry: unwrapCommandResponse(response, 'dictionary_lookup') }
}

export async function upsertVocab(cmd) {
  const response = await invokeCommand('vocab_upsert', { cmd })
  return { source: 'tauri', item: unwrapCommandResponse(response, 'vocab_upsert') }
}

export async function listVocab(limit = 100, offset = 0) {
  const response = await invokeCommand('vocab_list', { limit, offset })
  return { source: 'tauri', items: unwrapCommandResponse(response, 'vocab_list') || [] }
}

export async function reviewVocab(itemId, grade) {
  const response = await invokeCommand('vocab_review', { cmd: { itemId, grade } })
  return { source: 'tauri', item: unwrapCommandResponse(response, 'vocab_review') }
}

export async function ensureCoachThread(cmd) {
  const response = await invokeCommand('coach_ensure_thread', { cmd })
  return { source: 'tauri', thread: unwrapCommandResponse(response, 'coach_ensure_thread') }
}

export async function listCoachMessages(threadId, afterSequence = 0, limit = 100) {
  const response = await invokeCommand('coach_list_messages', {
    threadId,
    afterSequence,
    limit
  })
  return { source: 'tauri', items: unwrapCommandResponse(response, 'coach_list_messages') || [] }
}

export const enrichmentRepository = {
  upsertAnnotation,
  listAnnotations,
  deleteAnnotation,
  revalidateAnnotations,
  lookupDictionary,
  upsertVocab,
  listVocab,
  reviewVocab,
  ensureCoachThread,
  listCoachMessages,
  isTauriRuntime
}

export default enrichmentRepository
