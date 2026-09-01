export interface AnnotationAnchor {
  text: string
  before?: string | null
  after?: string | null
  occurrence?: number
  startOffset?: number | null
  endOffset?: number | null
  contentFingerprint?: string | null
}

export interface AnnotationRecord {
  id: string
  attemptId?: string | null
  assetId: string
  scope: string
  questionId?: string | null
  kind: string
  anchor: AnnotationAnchor
  noteText?: string | null
  createdAt: string
  updatedAt: string
  mismatch?: string | null
}

export interface CoachMessageRecord {
  id: string
  threadId: string
  role: string
  content: string
  structuredPayload?: Record<string, unknown> | null
  status: string
  createdAt: string
  sequence: number
}

export function upsertAnnotation(cmd: Record<string, unknown>): Promise<{ annotation: AnnotationRecord }>
export function listAnnotations(
  assetId: string,
  attemptId?: string | null
): Promise<{ items: AnnotationRecord[] }>
export function deleteAnnotation(
  id: string,
  assetId: string,
  attemptId?: string | null
): Promise<unknown>
export function revalidateAnnotations(
  assetId: string,
  attemptId: string | null,
  scope: string,
  document: string
): Promise<{ items: AnnotationRecord[] }>
export function lookupDictionary(term: string): Promise<{ entry?: Record<string, unknown> | null }>
export function upsertVocab(cmd: Record<string, unknown>): Promise<{ item?: unknown }>
export function listVocab(limit?: number, offset?: number): Promise<unknown>
export function reviewVocab(itemId: string, grade: unknown): Promise<unknown>
export function ensureCoachThread(cmd: Record<string, unknown>): Promise<unknown>
export function listCoachMessages(
  threadId: string,
  afterSequence?: number,
  limit?: number
): Promise<{ items: CoachMessageRecord[] }>

export const enrichmentRepository: Record<string, unknown>
export default enrichmentRepository
