/**
 * Memory Center repository — Tauri command bridge types.
 *
 * Mirrors learner-repository.d.ts conventions. All payloads are plain
 * JSON-serializable values; responses come back through the Rust
 * CommandResponse envelope and are unwrapped by tauri-bridge. Memory types
 * mirror crates/ielts-domain serde shapes (camelCase) but are declared inline
 * because the memory-core-v1 types are not part of generated/domain.ts.
 */

export type MemoryFeedbackKind =
  | 'accurate'
  | 'inaccurate'
  | 'partially_accurate'
  | 'outdated'
  | 'not_about_me'
  | 'acknowledged'

/** Mirrors crates/ielts-domain/src/coach_feedback.rs `CoachFeedbackKind` (snake_case). */
export type CoachFeedbackKind =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'too_long'
  | 'too_short'
  | 'too_abstract'
  | 'need_example'
  | 'need_step_by_step'
  | 'incorrect'
  | 'not_relevant'
  | 'reask_same_question'
  | 'style_correction'

export const COACH_FEEDBACK_KINDS: readonly CoachFeedbackKind[]

/** RecordCoachFeedbackCommand (camelCase, deny_unknown_fields). */
export interface RecordCoachFeedbackCommand {
  userId: string
  coachMessageId: string
  feedbackKind: CoachFeedbackKind
  payload?: unknown
}

export interface CoachFeedbackRecord {
  id: string
  userId: string
  coachMessageId: string
  feedbackKind: CoachFeedbackKind
  payload: unknown | null
  createdAt: string
}

/** RecordReaskLinkCommand (camelCase, deny_unknown_fields). */
export interface RecordReaskLinkCommand {
  userId: string
  parentAssistantMessageId: string
  newUserMessageId: string
}

export interface CoachReaskLinkRecord {
  parentAssistantMessageId: string
  newUserMessageId: string
  feedbackKind: CoachFeedbackKind
  createdAt: string
}

export type MemorySourceClass =
  | 'user_explicit'
  | 'observed'
  | 'inferred'
  | 'predicted'
  | 'consolidated'
  | 'system_policy'

export type MemoryStatus =
  | 'candidate'
  | 'pending_review'
  | 'active'
  | 'superseded'
  | 'archived'
  | 'quarantined'
  | 'rejected'
  | 'deleted'

export type MemoryContextSource =
  | 'current_instruction'
  | 'explicit_preference'
  | 'active_memory'
  | 'inferred_candidate'
  | 'predicted_hypothesis'

export interface MemoryContextEntry {
  priority: number
  source: MemoryContextSource
  id?: string | null
  key: string
  value: unknown
  pendingVerification: boolean
}

export interface MemoryContextPreview {
  userId: string
  activity: string
  entries: MemoryContextEntry[]
  truncated: boolean
}

export interface MemoryContextQuery {
  activity: string
  currentInstruction?: string | null
  limit?: number
}

export interface PromoteMemoryCandidateCommand {
  candidateId: string
  expectedCandidateVersion: number
  reason: string
}

export interface PutExplicitPreferenceCommand {
  preferenceKey: string
  scope?: string
  /** A short string (<= 60 chars), boolean or number; `user_note.*` keys take a string. */
  value: string | boolean | number
}

/** Mirrors ielts_domain::ExplicitPreference. */
export interface ExplicitPreference {
  userId: string
  preferenceKey: string
  scope: string
  value: unknown
  status: string
  source: 'user' | 'import' | 'product_default'
  updatedAt: string
}

export interface DeleteExplicitPreferenceCommand {
  preferenceKey: string
  scope?: string
}

export interface ForgetMemoryCommand {
  memoryId: string
  expectedVersion: number
  reason: string
}

export interface ArchiveMemoryCommand extends ForgetMemoryCommand {}

export interface DailyDreamQuery {
  userId?: string
  day: string
}

export interface DailyJournalQuery {
  userId: string
  journalDate: string
}

export interface MemoryContextPreviewResult extends MemoryContextPreview {}

export function getMemoryContextPreview(query?: MemoryContextQuery): Promise<MemoryContextPreviewResult>
export function promoteMemoryCandidate(command: PromoteMemoryCandidateCommand): Promise<unknown>
export function putExplicitPreference(command: PutExplicitPreferenceCommand): Promise<ExplicitPreference>
export function listExplicitPreferences(): Promise<ExplicitPreference[]>
export function deleteExplicitPreference(command: DeleteExplicitPreferenceCommand): Promise<boolean>
export function forgetMemory(command: ForgetMemoryCommand): Promise<unknown>
export function archiveMemory(command: ArchiveMemoryCommand): Promise<unknown>
export function recordCoachFeedback(coachMessageId: string, feedbackKind: CoachFeedbackKind, payload?: unknown): Promise<CoachFeedbackRecord>
export function recordCoachReaskLink(parentAssistantMessageId: string, newUserMessageId: string): Promise<CoachReaskLinkRecord>
export function listCoachFeedback(threadId: string): Promise<CoachFeedbackRecord[]>
export function recordMemoryFeedback(memoryId: string, feedbackKind: MemoryFeedbackKind): Promise<unknown>
export function triggerDailyDream(query: DailyDreamQuery): Promise<unknown>
export function getDailyJournal(query: DailyJournalQuery): Promise<unknown>
export function getBackgroundJobStatus(): Promise<unknown[]>
export function getWeeklyHistory(limit?: number): Promise<Array<{runId: string; window: string; start: string; end: string; digest: Record<string, unknown>}>>
export function archiveStaleMemories(): Promise<unknown>

export const memoryRepository: {
  getMemoryContextPreview: typeof getMemoryContextPreview
  promoteMemoryCandidate: typeof promoteMemoryCandidate
  putExplicitPreference: typeof putExplicitPreference
  listExplicitPreferences: typeof listExplicitPreferences
  deleteExplicitPreference: typeof deleteExplicitPreference
  forgetMemory: typeof forgetMemory
  archiveMemory: typeof archiveMemory
  recordCoachFeedback: typeof recordCoachFeedback
  recordCoachReaskLink: typeof recordCoachReaskLink
  listCoachFeedback: typeof listCoachFeedback
  recordMemoryFeedback: typeof recordMemoryFeedback
  triggerDailyDream: typeof triggerDailyDream
  getDailyJournal: typeof getDailyJournal
  getBackgroundJobStatus: typeof getBackgroundJobStatus
  getWeeklyHistory: typeof getWeeklyHistory
  archiveStaleMemories: typeof archiveStaleMemories
}

export default memoryRepository
