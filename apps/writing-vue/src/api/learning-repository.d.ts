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

export const learningRepository: {
  compareAttemptsForAsset: typeof compareAttemptsForAsset
  runAttemptReview: typeof runAttemptReview
  getAgentRun: typeof getAgentRun
}

export default learningRepository
