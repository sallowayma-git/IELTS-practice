import type { PracticeAssetV2, AttemptRecord } from '@/types/generated/domain'

/**
 * Wire shape of `reading_list_assets` (Rust `AssetIndexEntry`, not the full
 * `PracticeAssetV2`): library-card metadata only, no payload.
 */
export interface ReadingAssetIndexEntry {
  id: string
  title: string
  category?: string | null
  difficulty?: string | null
  frequency?: string | null
  fingerprint: string
  schemaVersion: number
  contentRef?: string | null
  payloadRef?: string | null
  activity: string
  pdfOnly: boolean
  /** Stable tag keys (single_choice, multi_choice, judgement, completion,
   * heading_match, paragraph_match, matching), canonically ordered and
   * deduplicated. Empty for a pdf-only or not-yet-classified asset. */
  questionKinds: string[]
}

export interface ReadingListResult { source: 'tauri'; items: ReadingAssetIndexEntry[] }
export interface ReadingPayload { [key: string]: unknown }
export interface ReadingAssetEnvelope { asset: PracticeAssetV2 | null; payload: ReadingPayload | null }
export interface ReadingDraftInput {
  attemptId: string; assetId: string; answers?: Record<string, unknown>; markedQuestions?: string[]
  questionTimeline?: Array<{ questionId: string; changeCount?: number; visitCount?: number; elapsedMs?: number; answeredAt?: string | null }>
  assetRevision?: number | null; assetFingerprint?: string | null
  titleSnapshot?: string | null; idempotencyKey?: string
}
export function newKey(prefix?: string): string
export function listReadingAssets(): Promise<ReadingListResult>
export function getReadingAssetPayload(assetId: string): Promise<ReadingAssetEnvelope>
export function getReadingPdfDataUrl(assetId: string): Promise<string>
export function normalizeReadingAssetEnvelope(value: unknown): ReadingAssetEnvelope
export function saveReadingDraft(payload: ReadingDraftInput): Promise<{ source: 'tauri'; attempt: AttemptRecord }>
export function getOpenReadingDraft(assetId: string): Promise<{ source: 'tauri'; attempt: AttemptRecord | null }>
export function patchReadingAnswer(attemptId: string, questionId: string, answer: unknown, marked?: boolean): Promise<boolean>
export function submitReadingAttempt(payload: ReadingDraftInput & { durationMs?: number | null }): Promise<{ source: 'tauri'; result: unknown }>
export const readingRepository: {
  listReadingAssets: typeof listReadingAssets
  getReadingAssetPayload: typeof getReadingAssetPayload
  getReadingPdfDataUrl: typeof getReadingPdfDataUrl
  normalizeReadingAssetEnvelope: typeof normalizeReadingAssetEnvelope
  saveReadingDraft: typeof saveReadingDraft
  getOpenReadingDraft: typeof getOpenReadingDraft
  patchReadingAnswer: typeof patchReadingAnswer
  submitReadingAttempt: typeof submitReadingAttempt
  newKey: typeof newKey
}
export function isTauriRuntime(): boolean
