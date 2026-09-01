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

export type CoachFeedbackKind = 'satisfaction' | 'learning'

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
  value: unknown
}

export interface ForgetMemoryCommand {
  memoryId: string
  expectedVersion: number
  reason: string
}

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
export function putExplicitPreference(command: PutExplicitPreferenceCommand): Promise<unknown>
export function forgetMemory(command: ForgetMemoryCommand): Promise<unknown>
export function recordCoachFeedback(memoryId: string, feedbackKind: CoachFeedbackKind): Promise<unknown>
export function recordMemoryFeedback(memoryId: string, feedbackKind: MemoryFeedbackKind): Promise<unknown>
export function triggerDailyDream(query: DailyDreamQuery): Promise<unknown>
export function getDailyJournal(query: DailyJournalQuery): Promise<unknown>
export function getBackgroundJobStatus(): Promise<unknown[]>
export function archiveStaleMemories(): Promise<unknown>

export const memoryRepository: {
  getMemoryContextPreview: typeof getMemoryContextPreview
  promoteMemoryCandidate: typeof promoteMemoryCandidate
  putExplicitPreference: typeof putExplicitPreference
  forgetMemory: typeof forgetMemory
  recordCoachFeedback: typeof recordCoachFeedback
  recordMemoryFeedback: typeof recordMemoryFeedback
  triggerDailyDream: typeof triggerDailyDream
  getDailyJournal: typeof getDailyJournal
  getBackgroundJobStatus: typeof getBackgroundJobStatus
  archiveStaleMemories: typeof archiveStaleMemories
}

export default memoryRepository
