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

// The learner's own active preferences (Notebook "你告诉我们的").
export async function listExplicitPreferences() {
  const response = await invokeCommand('memory_list_explicit_preferences', {})
  return unwrapCommandResponse(response, 'memory_list_explicit_preferences')
}

export async function deleteExplicitPreference(command) {
  const response = await invokeCommand('memory_delete_explicit_preference', { input: command })
  return unwrapCommandResponse(response, 'memory_delete_explicit_preference')
}

export async function archiveMemory(command) {
  const response = await invokeCommand('memory_archive', { input: command })
  return unwrapCommandResponse(response, 'memory_archive')
}

export async function forgetMemory(command) {
  const response = await invokeCommand('memory_forget', { input: command })
  return unwrapCommandResponse(response, 'memory_forget')
}

// --- M6 + M8 feedback ---

// Mirrors crates/ielts-domain/src/coach_feedback.rs `CoachFeedbackKind`
// (serde snake_case). Pinned by developer/tests/js/coachFeedbackContract.test.mjs.
export const COACH_FEEDBACK_KINDS = Object.freeze([
  'thumbs_up',
  'thumbs_down',
  'too_long',
  'too_short',
  'too_abstract',
  'need_example',
  'need_step_by_step',
  'incorrect',
  'not_relevant',
  'reask_same_question',
  'style_correction'
])

function requireText(value, field) {
  const text = String(value ?? '').trim()
  if (!text) {
    const error = new Error(`${field} is required`)
    error.code = 'coach_feedback.invalid_command'
    throw error
  }
  return text
}

/**
 * M6-05 coach_record_feedback. Command shape mirrors RecordCoachFeedbackCommand
 * (deny_unknown_fields): userId, coachMessageId, feedbackKind, payload?.
 * The backend is idempotent on (coachMessageId, feedbackKind) and keeps one
 * verdict (thumbs_up / thumbs_down / incorrect) per message: a different
 * verdict returns the one already stored.
 */
export async function recordCoachFeedback(coachMessageId, feedbackKind, payload = undefined) {
  if (!COACH_FEEDBACK_KINDS.includes(feedbackKind)) {
    const error = new Error(`unknown coach feedback kind: ${feedbackKind}`)
    error.code = 'coach_feedback.invalid_command'
    throw error
  }
  const command = {
    userId: 'local',
    coachMessageId: requireText(coachMessageId, 'coachMessageId'),
    feedbackKind
  }
  if (payload !== undefined && payload !== null) command.payload = payload
  const response = await invokeCommand('coach_record_feedback', { command })
  return unwrapCommandResponse(response, 'coach_record_feedback')
}

/**
 * M6-06 coach_record_reask_link. Command shape mirrors RecordReaskLinkCommand
 * (deny_unknown_fields): userId, parentAssistantMessageId, newUserMessageId.
 * Only for an explicit re-ask of the parent answer — a new question is not a re-ask.
 */
export async function recordCoachReaskLink(parentAssistantMessageId, newUserMessageId) {
  const command = {
    userId: 'local',
    parentAssistantMessageId: requireText(parentAssistantMessageId, 'parentAssistantMessageId'),
    newUserMessageId: requireText(newUserMessageId, 'newUserMessageId')
  }
  const response = await invokeCommand('coach_record_reask_link', { command })
  return unwrapCommandResponse(response, 'coach_record_reask_link')
}

/**
 * Durable feedback recorded in a coach thread (oldest first), used to restore
 * the one-verdict-per-answer lock when a past attempt is reopened.
 */
export async function listCoachFeedback(threadId) {
  const response = await invokeCommand('coach_list_feedback', {
    threadId: requireText(threadId, 'threadId')
  })
  const records = unwrapCommandResponse(response, 'coach_list_feedback')
  return Array.isArray(records) ? records : []
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

/** Finished weekly consolidations (read-only), newest first. */
export async function getWeeklyDigests(limit = 8) {
  const response = await invokeCommand('weekly_digest_list', { limit })
  return unwrapCommandResponse(response, 'weekly_digest_list')
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
  listExplicitPreferences,
  deleteExplicitPreference,
  archiveMemory,
  forgetMemory,
  recordCoachFeedback,
  recordCoachReaskLink,
  listCoachFeedback,
  recordMemoryFeedback,
  triggerDailyDream,
  getDailyJournal,
  getBackgroundJobStatus,
  getWeeklyDigests,
  archiveStaleMemories
}

export default memoryRepository
