/**
 * Generated-by-hand Phase 1 TypeScript bindings mirroring crates/ielts-domain DTOs.
 * Source of truth is the Rust serde types. Do not invent legacy aliases here.
 *
 * Regenerate guidance: keep field names in camelCase matching serde rename_all.
 */

export type Activity = 'reading' | 'writing';

export type AttemptMode =
  | 'single'
  | 'suite'
  | 'endless'
  | 'memorize'
  | 'freeform'
  | 'bank';

export type AttemptStatus =
  | 'draft'
  | 'active'
  | 'submitted'
  | 'reviewing'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted';

export type EvaluationStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'degraded'
  | 'failed'
  | 'interrupted';

export type EvaluationStage =
  | 'preparing'
  | 'scoring'
  | 'reviewing'
  | 'finalizing';

export type SuiteStatus = 'active' | 'completed' | 'cancelled' | 'interrupted';

export type ScoreScale = 'ratio' | 'band9';

export type AssetSourceKind = 'builtin' | 'imported' | 'freeform';

export type WritingTaskType = 'task1' | 'task2';

export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  context?: unknown;
  causeId?: string;
}

export interface WritingScoreV4 {
  overall: number;
  taskResponse: number;
  coherence: number;
  lexical: number;
  grammar: number;
}

export interface WritingDiagnosisV4 {
  task?: unknown;
  rationale?: unknown;
}

export interface ParagraphFeedback {
  paragraphIndex: number;
  summary?: string;
  issues: string[];
}

export interface SentenceFeedback {
  sentence: string;
  correction?: string;
  kind?: string;
}

export interface WritingFeedbackV4 {
  overall?: string;
  plan: string[];
  paragraphs: ParagraphFeedback[];
  sentences: SentenceFeedback[];
  rewrites: string[];
}

export interface EvaluationDegradation {
  stage: EvaluationStage;
  reason: string;
  missing: string[];
}

/** Canonical evaluation result. Never write legacy aliases into this shape. */
export interface WritingEvaluationV4 {
  schemaVersion: 4 | number;
  id: string;
  status: EvaluationStatus;
  stage: EvaluationStage;
  taskType?: WritingTaskType;
  score?: WritingScoreV4;
  diagnosis?: WritingDiagnosisV4;
  feedback?: WritingFeedbackV4;
  degradation?: EvaluationDegradation;
  error?: ErrorEnvelope;
}

export interface PracticeAssetV2 {
  schemaVersion: 2 | number;
  id: string;
  activity: Activity;
  sourceKind: AssetSourceKind;
  sourceKey?: string;
  title: string;
  category?: string;
  difficulty?: string;
  frequency?: string;
  contentRef?: string;
  fingerprint: string;
  pdfOnly?: boolean;
  metadata?: unknown;
}

export interface AttemptAnswer {
  questionId: string;
  answer: unknown;
  isCorrect?: boolean | null;
  weight: number;
  questionKind?: string;
  changeCount: number;
  visitCount: number;
  elapsedMs: number;
  marked: boolean;
  answeredAt?: string;
}

export interface AttemptAnnotationDto {
  id: string;
  attemptId?: string;
  assetId: string;
  scope: string;
  questionId?: string;
  kind: string;
  anchor: unknown;
  noteText?: string;
}

export interface AttemptRecord {
  schemaVersion: number;
  id: string;
  activity: Activity;
  assetId?: string;
  mode: AttemptMode;
  suiteId?: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt?: string;
  completedAt?: string;
  durationMs: number;
  scoreValue?: number;
  scoreScale?: ScoreScale;
  correctCount?: number;
  questionCount?: number;
  titleSnapshot?: string;
  promptSnapshot?: string;
  contentText?: string;
  taskType?: WritingTaskType;
  answers: AttemptAnswer[];
  annotations: AttemptAnnotationDto[];
}

export interface CommandResponse<T> {
  ok: boolean;
  data?: T;
  error?: ErrorEnvelope;
}

export interface HistoryListItemVm {
  id: string;
  activity: Activity;
  title: string;
  status: AttemptStatus;
  mode: AttemptMode;
  submittedAt?: string | null;
  durationMs: number;
  scoreValue?: number | null;
  scoreScale?: ScoreScale | null;
  scoreLabel: string;
  scoreDisplay: string;
  assetId?: string | null;
  sessionId?: string | null;
  suiteId?: string | null;
  taskType?: WritingTaskType | null;
}

export interface WritingResultVm {
  attemptId: string;
  title: string;
  taskType?: string | null;
  status: EvaluationStatus;
  score?: WritingScoreV4 | null;
  overallFeedback?: string | null;
  plan: string[];
  paragraphCount: number;
  sentenceCount: number;
  degraded: boolean;
  degradationReason?: string | null;
  errorMessage?: string | null;
}

/** Compile-time guard helpers for new business code. */
export const LEGACY_EVALUATION_ALIAS_KEYS = [
  'total_score',
  'task_achievement',
  'coherence_cohesion',
  'lexical_resource',
  'grammatical_range',
  'scorecard',
  'overall_feedback',
  'review_blocks',
  'paragraph_reviews',
  'task_analysis',
  'band_rationale',
  'review_degraded',
  'improvement_plan',
  'sentence_errors',
] as const;

export function assertNoLegacyEvaluationAliases(payload: Record<string, unknown>): void {
  for (const key of LEGACY_EVALUATION_ALIAS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`legacy evaluation alias "${key}" is forbidden in new writes`);
    }
  }
}

/** Phase 4 — unified history / settings / backup */

export interface ListHistoryQuery {
  activity?: Activity | null
  limit?: number
  offset?: number
  cursor?: string | null
  search?: string | null
  startDate?: string | null
  endDate?: string | null
  minScore?: number | null
  maxScore?: number | null
  scoreScale?: ScoreScale | null
  taskType?: WritingTaskType | null
}

export interface HistoryListItemVm {
  id: string
  activity: Activity
  title: string
  status: AttemptStatus
  mode: AttemptMode
  submittedAt?: string | null
  durationMs: number
  scoreValue?: number | null
  scoreScale?: ScoreScale | null
  scoreLabel: string
  scoreDisplay: string
  assetId?: string | null
  sessionId?: string | null
  suiteId?: string | null
  taskType?: WritingTaskType | null
}

export interface ListHistoryPage {
  items: HistoryListItemVm[]
  total: number
  limit: number
  offset: number
  nextCursor?: string | null
}

export interface HistoryDetailResponse {
  summary: HistoryListItemVm
  attempt: AttemptRecord
  evaluation?: WritingEvaluationV4 | null
}

export type HistoryExportFormat = 'csv' | 'markdown' | 'json'

export interface ExportHistoryResult {
  format: HistoryExportFormat
  body: string
  recordCount: number
}

export interface SettingEntry {
  namespace: string
  key: string
  value: unknown
  updatedAt: string
}

export interface SecretRef {
  name: string
  refId: string
  updatedAt: string
}

export interface BackupManifest {
  schemaVersion: number
  createdAt: string
  appVersion: string
  includesSecrets: boolean
  attemptCount: number
  settingsCount: number
  secretRefCount: number
  checksumSha256: string
}

export interface ImportBackupReport {
  dryRun: boolean
  ok: boolean
  attemptImported: number
  settingsImported: number
  secretRefsImported: number
  errors: string[]
  warnings: string[]
}

export interface CommandResponse<T> {
  ok: boolean
  data?: T
  error?: ErrorEnvelope
}

/** Phase 5 — writing evaluation */

export interface SaveDraftCommand {
  attemptId: string
  activity: Activity
  mode: AttemptMode
  assetId?: string | null
  contentText?: string | null
  promptSnapshot?: string | null
  taskType?: WritingTaskType | null
  idempotencyKey: string
}

export interface SubmitAttemptCommand {
  attemptId: string
  idempotencyKey: string
}

export interface StartEvaluationCommand {
  attemptId: string
  idempotencyKey: string
  taskType?: string | null
  retryOf?: string | null
}

export interface EvaluationEvent {
  evaluationId: string
  sequence: number
  revision: number
  eventType: string
  stage?: EvaluationStage | null
  payload: unknown
  createdAt: string
}

