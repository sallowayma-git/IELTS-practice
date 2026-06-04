export const PRACTICE_ACTIVITIES = ['reading', 'writing'] as const
export const PRACTICE_SESSION_STATUSES = [
  'draft',
  'active',
  'submitted',
  'reviewing',
  'completed',
  'cancelled',
  'failed'
] as const
export const READING_COACH_ENABLED_SETTING_KEY = 'practice.readingCoach.enabled'

export type PracticeActivity = typeof PRACTICE_ACTIVITIES[number]
export type PracticeSessionStatus = typeof PRACTICE_SESSION_STATUSES[number]

export interface PracticeAsset {
  id: string
  activity: PracticeActivity
  title: string
  source: 'reading_exam' | 'writing_topic' | 'freeform'
  category?: string | null
  difficulty?: string | number | null
  payloadRef?: string | null
  metadata?: Record<string, unknown>
  payload?: ReadingPracticePayload | null
}

export interface ReadingLibraryStatus {
  source: 'builtin' | 'nas-sqlite' | 'nas-js'
  ready: boolean
  assetCount: number
  htmlCount?: number
  pdfCount?: number
  version?: string | null
  lastLoadedAt?: string | null
  error?: string | null
}

export interface ReadingAssetProvider {
  listAssets(): Promise<PracticeAsset[]> | PracticeAsset[]
  getAsset(assetId: string): Promise<PracticeAsset> | PracticeAsset
  getStatus(): Promise<ReadingLibraryStatus> | ReadingLibraryStatus
  refresh?(): Promise<ReadingLibraryStatus> | ReadingLibraryStatus
}

export interface ReadingPracticeMeta {
  title: string
  category?: string | null
  frequency?: string | null
  pdfFilename?: string | null
  legacyPath?: string | null
  legacyFilename?: string | null
  questionIntroHtml?: string | null
}

export interface ReadingPassageBlock {
  blockId: string
  kind: 'html'
  html: string
}

export interface ReadingQuestionGroup {
  groupId: string
  kind: string
  questionIds: string[]
  bodyHtml: string
  leadHtml?: string | null
  allowOptionReuse?: boolean
}

export interface ReadingInteractionOption {
  value: string
  label: string
}

export interface ReadingQuestionInteraction {
  questionId: string
  displayLabel: string
  control: 'radio' | 'checkbox' | 'text' | 'select' | 'dragdrop'
  source: 'native_input' | 'dropzone' | 'fallback'
  name?: string | null
  options?: ReadingInteractionOption[]
  allowOptionReuse?: boolean
}

export interface ReadingOfficialPassageNote {
  label: string
  text: string
}

export interface ReadingOfficialQuestionExplanationItem {
  questionNumber: number
  questionId?: string | null
  text: string
}

export interface ReadingOfficialQuestionRange {
  start: number
  end: number
}

export interface ReadingOfficialQuestionExplanationSection {
  sectionTitle: string
  mode?: string | null
  questionRange?: ReadingOfficialQuestionRange | null
  text?: string | null
  items: ReadingOfficialQuestionExplanationItem[]
}

export interface ReadingOfficialReviewExplanations {
  schemaVersion: string
  examId: string
  meta: Record<string, string | null>
  passageNotes: ReadingOfficialPassageNote[]
  questionExplanations: ReadingOfficialQuestionExplanationSection[]
}

export interface ReadingPracticePayload {
  schemaVersion: string
  examId: string
  meta: ReadingPracticeMeta
  passage: {
    blocks: ReadingPassageBlock[]
  }
  questionGroups: ReadingQuestionGroup[]
  answerKey: Record<string, unknown>
  questionOrder: string[]
  questionDisplayMap: Record<string, string>
  questionCount: number
  sourceRefs?: Record<string, unknown>
  audit?: Record<string, unknown>
  interactionModel: Record<string, ReadingQuestionInteraction>
  reviewExplanations?: ReadingOfficialReviewExplanations | null
}

export interface PracticeSessionCreateRequest {
  activity: PracticeActivity
  assetId?: string | number | null
  attempt?: Record<string, unknown>
  settings?: Record<string, unknown>
}

export type ReadingPracticeAnswerValue = string | string[]
export type ReadingPracticeAnswers = Record<string, ReadingPracticeAnswerValue>

export interface ReadingAnswerComparisonEntry {
  questionId: string
  displayLabel: string
  userAnswer: ReadingPracticeAnswerValue
  correctAnswer: unknown
  normalizedUserAnswer: string[]
  normalizedCorrectAnswer: string[]
  isCorrect: boolean | null
  weight: number
  control?: ReadingQuestionInteraction['control']
  source?: ReadingQuestionInteraction['source']
  questionKind?: string
  matchMode: 'single' | 'set' | 'alternatives'
}

export interface ReadingPracticeScoreInfo {
  correct: number
  total: number
  totalQuestions: number
  accuracy: number
  percentage: number
  duration: number
  source: 'practice_reading_session'
}

export interface ReadingPracticeQuestionTypePerformance {
  total: number
  correct: number
  accuracy: number
  questionIds: string[]
  kind: string
  confidence?: number
}

export interface ReadingPracticeCoachContext {
  submitted: true
  score: number
  wrongQuestions: string[]
  selectedAnswers: Record<string, string>
}

export interface ReadingPracticeHighlightRecord {
  scope: 'passage' | 'questions' | 'unknown'
  text: string
  kind?: 'highlight' | 'note'
  questionId?: string | null
  startOffset?: number | null
  endOffset?: number | null
  before?: string | null
  after?: string | null
  occurrence?: number | null
  createdAt?: string | null
}

export interface ReadingPracticeQuestionTimelineEntry {
  questionId: string
  displayLabel: string
  firstAnsweredAt: string | null
  lastAnsweredAt: string | null
  changeCount: number
  visitCount?: number
  elapsedMs?: number
  durationMs?: number
}

export interface ReadingPracticeAnalysisSignals {
  questionCount: number
  unansweredCount: number
  changedAnswerCount: number
  interactionDensity: number
  markedQuestionCount: number
  highlightCount: number
}

export interface ReadingPracticeSingleAttemptAnalysisInput {
  version: string
  generatedAt: string
  examId: string
  sessionId: string
  type: 'reading'
  category: string | null
  totalQuestions: number
  correctAnswers: number
  accuracy: number
  durationSec: number
  dataQuality: {
    confidence: number
    source: 'practice_reading_session'
  }
  analysisSignals: ReadingPracticeAnalysisSignals
  questionTimelineLite: ReadingPracticeQuestionTimelineEntry[]
  questionTypePerformance: Record<string, ReadingPracticeQuestionTypePerformance>
  unknownQuestions: number
  missingKindRatio: number
  confidence: number
  markedQuestions: string[]
  highlights: ReadingPracticeHighlightRecord[]
}

export interface ReadingPracticeSingleAttemptAnalysis {
  summary: {
    accuracy: number
    durationSec: number
    unansweredRate: number
    changedAnswerRate: number
  }
  radar: {
    byQuestionKind: ReadingPracticeQuestionTypePerformance[]
    byPassageCategory: Array<{
      category: string
      total: number
      correct: number
      accuracy: number
      confidence: number
    }>
  }
  diagnosis: Array<{
    type: string
    severity: 'low' | 'medium' | 'high'
    message: string
    evidence: Record<string, unknown>
  }>
  nextActions: Array<{
    type: string
    target: string
    instruction: string
    evidence: Record<string, unknown>
  }>
  confidence: number
}

export interface ReadingPracticeAnalysisArtifacts {
  highlights: ReadingPracticeHighlightRecord[]
  markedQuestions: string[]
  analysisSignals: ReadingPracticeAnalysisSignals
  questionTimelineLite: ReadingPracticeQuestionTimelineEntry[]
  singleAttemptAnalysisInput: ReadingPracticeSingleAttemptAnalysisInput
  singleAttemptAnalysis: ReadingPracticeSingleAttemptAnalysis
  singleAttemptAnalysisLlm: unknown | null
}

export interface ReadingPracticeSubmission {
  sessionId: string
  activity: 'reading'
  status: 'submitted'
  assetId: string
  examId: string
  submittedAt: string
  startTime?: string | null
  endTime: string
  duration: number
  readOnly: true
  answers: ReadingPracticeAnswers
  correctAnswers: Record<string, unknown>
  answerComparison: Record<string, ReadingAnswerComparisonEntry>
  scoreInfo: ReadingPracticeScoreInfo
  questionTypePerformance: Record<string, ReadingPracticeQuestionTypePerformance>
  highlights: ReadingPracticeHighlightRecord[]
  markedQuestions: string[]
  analysisSignals: ReadingPracticeAnalysisSignals
  questionTimelineLite: ReadingPracticeQuestionTimelineEntry[]
  singleAttemptAnalysisInput: ReadingPracticeSingleAttemptAnalysisInput
  singleAttemptAnalysis: ReadingPracticeSingleAttemptAnalysis
  singleAttemptAnalysisLlm: unknown | null
  analysisArtifacts?: ReadingPracticeAnalysisArtifacts
  readingCoachSnapshot: unknown | null
  readingCoachTranscript: Array<Record<string, unknown>>
  coachContext: ReadingPracticeCoachContext
  metadata: Record<string, unknown>
  legacy: {
    eventType: 'PRACTICE_COMPLETE'
    renderMode: 'vue-reading'
    practiceMode: 'single' | 'suite'
  }
}

export type ReadingSuiteFlowMode = 'classic' | 'simulation' | 'stationary'
export type ReadingSuiteFrequencyScope = 'high' | 'high_medium' | 'all' | 'custom'
export type ReadingSuitePassageStatus = 'pending' | 'active' | 'submitted'
export type ReadingSuiteSessionStatus = 'active' | 'completed' | 'cancelled'
export type ReadingSuiteTimerMode = 'elapsed' | 'countdown'

export interface ReadingSuiteTimerState {
  source: 'suite'
  anchorMs: number
  effectiveStartTimeMs: number
  mode: ReadingSuiteTimerMode
  limitSeconds: number | null
  pausedOffsetMs: number
  pausedAtMs: number | null
  running: boolean
}

export interface ReadingSuitePassageEntry {
  index: number
  assetId: string
  examId: string
  title: string
  category: string
  status: ReadingSuitePassageStatus
  sessionId?: string | null
  submittedAt?: string | null
  scoreInfo?: ReadingPracticeScoreInfo | null
}

export interface ReadingSuiteAggregate {
  submittedPassages: number
  totalPassages: number
  correct: number
  totalQuestions: number
  accuracy: number
  percentage: number
  duration: number
}

export interface ReadingSuiteSession {
  sessionId: string
  activity: 'reading'
  practiceMode: 'suite'
  status: ReadingSuiteSessionStatus
  flowMode: ReadingSuiteFlowMode
  frequencyScope: ReadingSuiteFrequencyScope
  timer: ReadingSuiteTimerState
  currentIndex: number
  totalPassages: number
  sequence: ReadingSuitePassageEntry[]
  aggregate: ReadingSuiteAggregate
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface ReadingSuiteCreateRequest {
  flowMode?: ReadingSuiteFlowMode
  frequencyScope?: ReadingSuiteFrequencyScope
  seed?: string | null
  timer?: Partial<ReadingSuiteTimerState> | null
  sequence?: Array<string | { assetId?: string | null; examId?: string | null; id?: string | null }> | null
}

export interface ReadingSuiteSubmitResponse {
  sessionId: string
  activity: 'reading'
  status: ReadingSuiteSessionStatus
  suiteSession: ReadingSuiteSession
  submission: ReadingPracticeSubmission
  historyRecord?: PracticeHistorySummary
}

export interface PracticeHistorySummary {
  id: string
  activity: PracticeActivity
  sessionId: string
  assetId?: string | null
  examId?: string | null
  title: string
  status: 'completed' | 'submitted'
  submittedAt: string
  startTime?: string | null
  endTime: string
  duration: number
  score: number
  totalQuestions: number
  correctAnswers: number
  accuracy: number
  metadata: Record<string, unknown>
}

export interface PracticeHistoryRecord extends PracticeHistorySummary {
  submission?: ReadingPracticeSubmission | null
}

export interface PracticeHistoryArchive {
  schemaVersion: string
  activity: 'reading'
  exportedAt: string
  count: number
  submissions: ReadingPracticeSubmission[]
}

export interface PracticeHistoryImportResult {
  activity: 'reading'
  importedCount: number
  skippedCount: number
  totalCount: number
  records: PracticeHistorySummary[]
  errors: Array<{
    index: number
    reason: string
  }>
}

export type PracticeMigrationRenderer = 'vue' | 'legacy'
export type PracticeMigrationSupport = 'primary' | 'fallback' | 'blocked'

export interface PracticeMigrationCapability {
  id: string
  label: string
  domain: string
  renderer: PracticeMigrationRenderer
  support: PracticeMigrationSupport
  routePattern: string
  apiSurface: string[]
  verifiedBy: string[]
  legacyFallbackSurface?: string[]
  fallbackReason?: string
  deletionGate: string
}

export interface PracticeMigrationStatus {
  schemaVersion: string
  defaultRenderer: PracticeMigrationRenderer
  legacyFallbackEnabled: boolean
  legacyDeletionAllowed: boolean
  legacyProductEntrypointVisible: boolean
  legacyReadingFallbackEnabled: boolean
  normalVueReadingUsesLegacy: boolean
  electronEntrypoints: {
    primary: string
    fallback: string | null
    fallbackIpc: string | null
    bootRecovery?: string | null
    diagnosticFallbackIpc?: string | null
    practiceRouteIpc: string
  }
  capabilities: PracticeMigrationCapability[]
  deletionCriteria: string[]
}

export interface PracticeSessionCreateResponse {
  sessionId: string
  activity: PracticeActivity
  status: PracticeSessionStatus
  legacy?: {
    provider: 'writing_evaluation' | 'practice_reading' | 'practice_reading_suite' | 'reading_legacy'
    sessionId?: string
  }
  submission?: ReadingPracticeSubmission
  historyRecord?: PracticeHistorySummary
}

export interface PracticeSessionState {
  sessionId: string
  activity: PracticeActivity
  status: PracticeSessionStatus | string
  active?: boolean
  events?: Array<Record<string, unknown>>
  lastSequence?: number
  legacy?: Record<string, unknown>
  submission?: ReadingPracticeSubmission
}

export function normalizeReadingCoachEnabled(value: unknown, fallback = true): boolean {
  if (value === null || value === undefined || value === '') {
    return fallback
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      return fallback
    }
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
      return false
    }
  }
  return fallback
}

export function isPracticeActivity(value: unknown): value is PracticeActivity {
  return PRACTICE_ACTIVITIES.includes(String(value || '') as PracticeActivity)
}

export function assertPracticeActivity(value: unknown): PracticeActivity {
  const normalized = String(value || '').trim().toLowerCase()
  if (!isPracticeActivity(normalized)) {
    const error = new Error('Unsupported practice activity')
    ;(error as Error & { code?: string; statusCode?: number }).code = 'invalid_practice_activity'
    ;(error as Error & { code?: string; statusCode?: number }).statusCode = 400
    throw error
  }
  return normalized as PracticeActivity
}

export function normalizePracticeSessionStatus(value: unknown, fallback: PracticeSessionStatus = 'active'): PracticeSessionStatus {
  const normalized = String(value || '').trim().toLowerCase()
  return PRACTICE_SESSION_STATUSES.includes(normalized as PracticeSessionStatus)
    ? normalized as PracticeSessionStatus
    : fallback
}
