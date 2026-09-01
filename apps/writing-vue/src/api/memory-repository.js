import { invokeCommand, unwrapCommandResponse } from './tauri-bridge.js'

/**
 * Memory Center repository — Tauri command bridge.
 *
 * Mirrors learner-repository.js: invoke + unwrapCommandResponse.
 * No special cases, no per-command branching. Each export is one capability
 * already registered in src-tauri/src/lib.rs invoke_handler.
 */

// --- M3 memory-core-v1 ---

export async function getMemoryContextPreview(query = {}) {
  const response = await invokeCommand('memory_context_preview', { input: query })
  return unwrapCommandResponse(response, 'memory_context_preview')
}

// M9/18.3 product-host catalog read: governable memory items with governance
// metadata + evidence ids. The console reads this instead of the
// compiler-scoped context preview.
export async function getMemoryCatalog(query = {}) {
  const response = await invokeCommand('memory_catalog_list', {
    input: {
      includeArchived: query?.includeArchived ?? false,
      limit: query?.limit ?? 100
    }
  })
  return unwrapCommandResponse(response, 'memory_catalog_list')
}

export async function promoteMemoryCandidate(command) {
  const response = await invokeCommand('memory_promote_candidate', { input: command })
  return unwrapCommandResponse(response, 'memory_promote_candidate')
}

export async function putExplicitPreference(command) {
  const response = await invokeCommand('memory_put_explicit_preference', { input: command })
  return unwrapCommandResponse(response, 'memory_put_explicit_preference')
}

export async function forgetMemory(command) {
  const response = await invokeCommand('memory_forget', { input: command })
  return unwrapCommandResponse(response, 'memory_forget')
}

// --- M6 + M8 feedback ---

export async function recordCoachFeedback(memoryId, feedbackKind) {
  // M6 coach_record_feedback keys on coach_message_id + user_id + feedback_kind.
  // In the Memory Center we treat a memory_id as the coach-message anchor when
  // one exists; caller may override via the second-arg options object.
  const command = {
    userId: 'local',
    coachMessageId: memoryId,
    feedbackKind
  }
  const response = await invokeCommand('coach_record_feedback', { command })
  return unwrapCommandResponse(response, 'coach_record_feedback')
}

export async function recordMemoryFeedback(memoryId, feedbackKind) {
  const response = await invokeCommand('memory_record_feedback', {
    memoryId,
    feedbackKind
  })
  return unwrapCommandResponse(response, 'memory_record_feedback')
}

// --- M7 journal / dream ---

export async function triggerDailyDream(query) {
  const response = await invokeCommand('dream_run_daily', { query })
  return unwrapCommandResponse(response, 'dream_run_daily')
}

// Round-3 audit (A3): `triggerWeeklyDream` was removed. The `dream_run_weekly`
// Tauri command is no longer registered, because weekly consolidation writes
// active memory and supersedes supports — the webview must never be the source
// of those patterns. Weekly consolidation now runs host-internally, driven by
// the Python sidecar over the host-gated reverse RPC.

export async function getDailyJournal(query) {
  const response = await invokeCommand('journal_get_daily', { query })
  return unwrapCommandResponse(response, 'journal_get_daily')
}

export async function getBackgroundJobStatus() {
  const response = await invokeCommand('background_job_status', {})
  return unwrapCommandResponse(response, 'background_job_status')
}

// --- M8 consolidation ---

export async function archiveStaleMemories() {
  const response = await invokeCommand('consolidation_archive_stale', {})
  return unwrapCommandResponse(response, 'consolidation_archive_stale')
}

export const memoryRepository = {
  getMemoryContextPreview,
  promoteMemoryCandidate,
  putExplicitPreference,
  forgetMemory,
  recordCoachFeedback,
  recordMemoryFeedback,
  triggerDailyDream,
  getDailyJournal,
  getBackgroundJobStatus,
  archiveStaleMemories
}

export default memoryRepository
