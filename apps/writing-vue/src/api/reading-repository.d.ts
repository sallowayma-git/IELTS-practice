import type { PracticeAssetV2, AttemptRecord } from '@/types/generated/domain'

export interface ReadingListResult { source: 'tauri'; items: PracticeAssetV2[] }
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
