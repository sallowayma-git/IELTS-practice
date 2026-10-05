export interface AttemptComparison {
  assetId: string
  attempts: AttemptTimelinePoint[]
  questionTransitions: QuestionTransition[]
  repeatFamiliarityWarning: boolean
  minimumGapHours: number
  evidenceVersion: number
}

export interface AttemptTimelinePoint {
  attemptId: string
  ordinal: number
  completedAt: string
  gapHours?: number | null
  scoreValue?: number | null
  correctCount?: number | null
  questionCount?: number | null
  durationMs: number
  changeCount: number
  visitCount: number
}

export interface QuestionTransition {
  questionId: string
  attemptId: string
  previousAttemptId?: string | null
  state: string
  firstTryCorrect?: boolean | null
  changeCount: number
  elapsedMs: number
}

export interface AgentAttemptReviewOutcome {
  runId: string
  content: string
  rounds: number
  toolCalls: number
  [key: string]: unknown
}

export function compareAttemptsForAsset(input: {
  assetId: string
  limit?: number
  minimumGapHours?: number
}): Promise<AttemptComparison>
export function runAttemptReview(input: {
  attemptId: string
  configId?: string | null
}): Promise<AgentAttemptReviewOutcome>
export function getAgentRun(runId: string): Promise<Record<string, unknown> | null>

export interface MemoryEvidenceResult {
  items: Array<{
    id: string
    source: string
    original: string
    events: Array<{
      id: string
      source: string
      location: string
      original: string
      route: { name: string; params: Record<string, string> } | null
    }>
  }>
  warnings: string[]
  truncated: boolean
}
export interface ObservationEvidenceRecord {
  id: string
  userId: string
  observationType: string
  observedAt: string
  scopeKey: string
  valueText: string | null
  payload: unknown
  evidence: Array<{ eventId: string; evidenceRole: string; ordinal: number }>
}
export interface LearningEventEvidenceRecord {
  id: string
  userId: string
  eventType: string
  occurredAt: string
  sourceKind: string
  sourceId: string | null
  activity: string | null
  assetId: string | null
  attemptId: string | null
  questionId: string | null
  payload: unknown
}
export function getObservationsByIds(ids: string[]): Promise<{
  observations: ObservationEvidenceRecord[]; missingIds: string[]; freshness: string
}>
export function getEventsEvidenceByIds(ids: string[]): Promise<{
  events: LearningEventEvidenceRecord[]; missingIds: string[]
}>
export function getMemoryEvidence(observationIds: string[], userId?: string): Promise<MemoryEvidenceResult>

export const learningRepository: {
  compareAttemptsForAsset: typeof compareAttemptsForAsset
  runAttemptReview: typeof runAttemptReview
  getAgentRun: typeof getAgentRun
  getObservationsByIds: typeof getObservationsByIds
  getEventsEvidenceByIds: typeof getEventsEvidenceByIds
  getMemoryEvidence: typeof getMemoryEvidence
}

export default learningRepository
