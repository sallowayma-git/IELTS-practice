/**
 * Listening attempt repository — Tauri only.
 *
 * Same conventions as reading-repository.js: literal command names, camelCase
 * invoke arguments and the `{ source: 'tauri', ... }` result envelope. The
 * listening view ships in a later stage; these wrappers are the only place
 * that may name the listening commands.
 */

import { jiufen, isJiufenAsset } from '@/api/jiufen.js'
import { idictation, isIdictationListeningPreview } from '@/api/idictation.js'
import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'

export function newKey(prefix = 'l') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Bare array of index entries (id, title, category, questionKinds, ...). */
export async function listListeningAssets() {
  const response = await invokeCommand('listening_list_assets')
  const items = unwrapCommandResponse(response, 'listening_list_assets')
  return { source: 'tauri', items: Array.isArray(items) ? items : [] }
}

export async function getListeningAssetPayload(assetId) {
  const normalizedAssetId = String(assetId || '').trim()
  if (!normalizedAssetId) {
    const error = new Error('listening_get_asset_payload: assetId is required')
    error.code = 'listening.asset_id_required'
    throw error
  }
  if (isJiufenAsset(normalizedAssetId)) return (await jiufen.payload(normalizedAssetId)).payload
  if (isIdictationListeningPreview(normalizedAssetId)) return idictation.listeningPayload(normalizedAssetId)

  const response = await invokeCommand('listening_get_asset_payload', {
    assetId: normalizedAssetId
  })
  return unwrapCommandResponse(response, 'listening_get_asset_payload')
}

/** Audio never crosses IPC as a path; Rust resolves it inside the pack root. */
export async function getListeningAudioDataUrl(assetId) {
  const normalizedAssetId = String(assetId || '').trim()
  if (!normalizedAssetId) {
    const error = new Error('listening_get_audio_data_url: assetId is required')
    error.code = 'listening.asset_id_required'
    throw error
  }
  const response = await invokeCommand('listening_get_audio_data_url', {
    assetId: normalizedAssetId
  })
  return unwrapCommandResponse(response, 'listening_get_audio_data_url')
}

export async function saveListeningDraft(payload) {
  if (isIdictationListeningPreview(payload.assetId)) throw new Error('此试卷仅支持临时作答')
  const response = await invokeCommand('listening_save_draft', {
    resumePosition: payload.resumePosition || null,
    cmd: {
      attemptId: payload.attemptId,
      assetId: payload.assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      titleSnapshot: payload.titleSnapshot || null,
      timerSnapshot: payload.timerSnapshot || null,
      idempotencyKey: payload.idempotencyKey || newKey('draft')
    }
  })
  return { source: 'tauri', attempt: unwrapCommandResponse(response, 'listening_save_draft') }
}

export async function getOpenListeningDraft(assetId) {
  if (isIdictationListeningPreview(assetId)) return { source: 'tauri', attempt: null }
  const response = await invokeCommand('listening_get_open_draft', {
    assetId: String(assetId || '').trim()
  })
  return {
    source: 'tauri',
    attempt: unwrapCommandResponse(response, 'listening_get_open_draft') || null
  }
}

export async function submitListeningAttempt(payload) {
  if (isIdictationListeningPreview(payload.assetId)) throw new Error('此试卷尚不支持官方交卷')
  if (isJiufenAsset(payload.assetId)) {
    return { source: 'tauri', result: await jiufen.submit('listening', payload) }
  }
  const response = await invokeCommand('listening_submit_attempt', {
    cmd: {
      attemptId: payload.attemptId,
      assetId: payload.assetId,
      assetRevision: payload.assetRevision ?? null,
      assetFingerprint: payload.assetFingerprint || null,
      answers: payload.answers || {},
      markedQuestions: payload.markedQuestions || [],
      questionTimeline: payload.questionTimeline || [],
      durationMs: payload.durationMs ?? null,
      titleSnapshot: payload.titleSnapshot || null,
      idempotencyKey: payload.idempotencyKey || newKey('submit')
    }
  })
  return {
    source: 'tauri',
    result: unwrapCommandResponse(response, 'listening_submit_attempt')
  }
}

export const listeningRepository = {
  listListeningAssets,
  getListeningAssetPayload,
  getListeningAudioDataUrl,
  saveListeningDraft,
  getOpenListeningDraft,
  submitListeningAttempt,
  newKey,
  isTauriRuntime
}

export default listeningRepository
