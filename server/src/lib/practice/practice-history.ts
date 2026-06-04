import type {
  PracticeActivity,
  PracticeHistoryArchive,
  PracticeHistoryImportResult,
  PracticeHistoryRecord,
  PracticeHistorySummary,
  ReadingPracticeAnalysisArtifacts,
  ReadingPracticeSubmission
} from './contracts.js'
import { normalizePagination } from '../shared/http.js'
import { isPersistentReviewCoachRequest } from '../reading/router.js'
import { safeJsonParse, safeJsonStringify } from '../shared/json.js'
import { isSqliteLike, type SqliteDatabaseLike } from '../shared/sqlite.js'

type AnyRecord = Record<string, unknown>

interface ListHistoryOptions {
  activity?: PracticeActivity | null
  page?: number
  limit?: number
}

const PRACTICE_HISTORY_COLUMNS: Array<[string, string]> = [
  ['id', 'TEXT'],
  ['activity', "TEXT NOT NULL DEFAULT 'reading'"],
  ['session_id', "TEXT NOT NULL DEFAULT ''"],
  ['asset_id', 'TEXT'],
  ['exam_id', 'TEXT'],
  ['title', "TEXT NOT NULL DEFAULT ''"],
  ['status', "TEXT NOT NULL DEFAULT 'completed'"],
  ['score', 'REAL NOT NULL DEFAULT 0'],
  ['total_questions', 'INTEGER NOT NULL DEFAULT 0'],
  ['correct_answers', 'REAL NOT NULL DEFAULT 0'],
  ['accuracy', 'REAL NOT NULL DEFAULT 0'],
  ['duration', 'INTEGER NOT NULL DEFAULT 0'],
  ['submitted_at', "TEXT NOT NULL DEFAULT ''"],
  ['started_at', 'TEXT'],
  ['ended_at', "TEXT NOT NULL DEFAULT ''"],
  ['metadata_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['submission_json', 'TEXT'],
  ['created_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP'],
  ['updated_at', 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP']
]

const IELTS_READING_REVIEW_QUESTION_LIMIT = 40

function normalizeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeReviewText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
}

function normalizeReviewQuestionAnalyses(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!isRecord(item)) return null
      const normalized: AnyRecord = {
        questionNumber: normalizeReviewText(item.questionNumber ?? item.questionId).replace(/^q/i, ''),
        likelyMistake: normalizeReviewText(item.likelyMistake),
        whyUserChoseWrong: normalizeReviewText(item.whyUserChoseWrong),
        whyCorrectAnswerWorks: normalizeReviewText(item.whyCorrectAnswerWorks),
        whyWrongAnswerFails: normalizeReviewText(item.whyWrongAnswerFails),
        nextRule: normalizeReviewText(item.nextRule)
      }
      Object.keys(normalized).forEach((key) => {
        if (!normalized[key]) {
          delete normalized[key]
        }
      })
      return Object.keys(normalized).length ? normalized : null
    })
    .filter((item): item is AnyRecord => Boolean(item))
    .slice(0, IELTS_READING_REVIEW_QUESTION_LIMIT)
}

function isReadingPracticeSubmission(value: unknown): value is ReadingPracticeSubmission {
  if (!isRecord(value)) return false
  return value.activity === 'reading'
    && value.status === 'submitted'
    && Boolean(normalizeNonEmptyString(value.sessionId))
    && Boolean(normalizeNonEmptyString(value.assetId || value.examId))
    && isRecord(value.scoreInfo)
    && isRecord(value.answerComparison)
}

function collectArchiveSubmissions(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.submissions)) return payload.submissions
  if (Array.isArray(payload.records)) {
    return payload.records.map((entry) => (
      isRecord(entry) && Object.prototype.hasOwnProperty.call(entry, 'submission')
        ? entry.submission
        : entry
    ))
  }
  if (isRecord(payload.submission)) return [payload.submission]
  return []
}

function normalizeCoachConfidenceToRate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value))
  }
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'high') return 0.86
  if (normalized === 'low') return 0.42
  return 0.66
}

function buildCoachEvidence(source: string, fields: AnyRecord = {}): AnyRecord {
  const evidence: AnyRecord = { source }
  Object.entries(fields).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      const normalized = value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
      if (normalized.length) {
        evidence[key] = normalized
      }
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      evidence[key] = value
      return
    }
    const normalized = String(value || '').trim()
    if (normalized) {
      evidence[key] = normalized
    }
  })
  return evidence
}

function buildCoachFailureSnapshot(error: unknown): AnyRecord {
  const source = isRecord(error) ? error : {}
  const message = error instanceof Error
    ? error.message
    : String(source.message || error || '').trim()
  const code = String(source.code || source.error || '').trim()
  const statusCode = normalizeNumber(source.statusCode || source.status, 0)
  return {
    error: true,
    code: code || 'practice_coach_failed',
    message: message || '阅读教练请求失败',
    ...(statusCode ? { statusCode } : {})
  }
}

function buildSingleAttemptLlmFromCoachResponse(response: unknown) {
  const source = isRecord(response) ? response : {}
  const reviewOverall = isRecord(source.reviewOverall) ? source.reviewOverall : null
  const reviewQuestionAnalyses = Array.isArray(source.reviewQuestionAnalyses)
    ? source.reviewQuestionAnalyses
    : []
  const normalizedReviewQuestionAnalyses = normalizeReviewQuestionAnalyses(reviewQuestionAnalyses)
  const sections = Array.isArray(source.answerSections) ? source.answerSections : []
  const diagnosis: Array<Record<string, unknown>> = []
  const nextActions: Array<Record<string, unknown>> = []

  if (reviewOverall) {
    const primaryWeakness = String(reviewOverall.primaryWeakness || '').trim()
    const patternSummary = String(reviewOverall.patternSummary || '').trim()
    const teachingPlan = String(reviewOverall.teachingPlan || '').trim()
    if (primaryWeakness) {
      diagnosis.push({
        code: 'coach_review_primary_weakness',
        reason: primaryWeakness,
        evidence: buildCoachEvidence('reading_coach_review_overall', {
          field: 'primaryWeakness',
          patternSummary,
          confidence: source.confidence
        })
      })
    }
    if (patternSummary) {
      diagnosis.push({
        code: 'coach_review_pattern',
        reason: patternSummary,
        evidence: buildCoachEvidence('reading_coach_review_overall', {
          field: 'patternSummary',
          primaryWeakness,
          confidence: source.confidence
        })
      })
    }
    if (teachingPlan) {
      nextActions.push({
        type: 'coach_review_thinking_plan',
        target: 'reading',
        instruction: teachingPlan,
        evidence: buildCoachEvidence('reading_coach_review_overall', {
          field: 'teachingPlan',
          primaryWeakness,
          patternSummary
        })
      })
    }
  }

  normalizedReviewQuestionAnalyses.slice(0, 3).forEach((item, index) => {
    const questionNumber = String(item.questionNumber || '').trim()
    const likelyMistake = String(item.likelyMistake || '').trim()
    const whyUserChoseWrong = String(item.whyUserChoseWrong || '').trim()
    const whyCorrectAnswerWorks = String(item.whyCorrectAnswerWorks || '').trim()
    const whyWrongAnswerFails = String(item.whyWrongAnswerFails || '').trim()
    const nextRule = String(item.nextRule || '').trim()
    const reasonParts = [likelyMistake, whyUserChoseWrong].filter(Boolean)
    if (reasonParts.length) {
      diagnosis.push({
        code: `coach_review_q${questionNumber || index + 1}`,
        reason: `${questionNumber ? `Q${questionNumber}：` : ''}${reasonParts.join('；')}`,
        evidence: buildCoachEvidence('reading_coach_question_analysis', {
          questionNumber,
          likelyMistake,
          whyCorrectAnswerWorks,
          whyWrongAnswerFails
        })
      })
    }
    if (nextRule) {
      nextActions.push({
        type: 'coach_review_next_rule',
        target: questionNumber ? `Q${questionNumber}` : 'reading',
        instruction: nextRule,
        evidence: buildCoachEvidence('reading_coach_question_analysis', {
          questionNumber,
          likelyMistake,
          whyUserChoseWrong
        })
      })
    }
  })

  sections.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const type = String(entry.type || '').trim().toLowerCase()
    const text = String(entry.text || '').trim()
    if (!text) return
    if (type === 'next_step') {
      nextActions.push({
        type: 'coach_next_step',
        target: 'reading',
        instruction: text,
        evidence: buildCoachEvidence('reading_coach_answer_section', {
          sectionIndex: index + 1,
          sectionType: type
        })
      })
      return
    }
    if (diagnosis.length < 4 && type !== 'evidence') {
      diagnosis.push({
        code: `coach_diag_${index + 1}`,
        reason: text,
        evidence: buildCoachEvidence('reading_coach_answer_section', {
          sectionIndex: index + 1,
          sectionType: type
        })
      })
    }
  })

  if (!diagnosis.length) {
    const fallback = String(source.answer || '').trim()
    if (fallback) {
      diagnosis.push({
        code: 'coach_diag_fallback',
        reason: fallback,
        evidence: buildCoachEvidence('reading_coach_answer', {
          confidence: source.confidence
        })
      })
    }
  }

  if (!nextActions.length && Array.isArray(source.followUps)) {
    source.followUps
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .forEach((text, index) => {
        nextActions.push({
          type: 'coach_followup',
          target: 'reading',
          instruction: text,
          evidence: buildCoachEvidence('reading_coach_followup', {
            followUpIndex: index + 1
          })
        })
      })
  }

  return {
    diagnosis: diagnosis.slice(0, 4),
    nextActions: nextActions.slice(0, 3),
    reviewQuestionAnalyses: normalizedReviewQuestionAnalyses,
    confidence: normalizeCoachConfidenceToRate(source.confidence),
    model_trace: {
      source: 'reading_coach_v2',
      degraded: false
    }
  }
}

function shouldAttachSingleAttemptLlm(result: unknown, requestPayload: AnyRecord = {}): boolean {
  if (isPersistentReviewCoachRequest(requestPayload)) {
    return true
  }
  if (!isRecord(result)) {
    return false
  }
  return isRecord(result.reviewOverall)
    || (Array.isArray(result.reviewQuestionAnalyses) && result.reviewQuestionAnalyses.length > 0)
}

function resolveSingleAttemptLlmPatch(result: unknown, requestPayload: AnyRecord = {}) {
  if (isRecord(result) && isRecord(result.singleAttemptAnalysisLlm)) {
    return result.singleAttemptAnalysisLlm
  }
  return shouldAttachSingleAttemptLlm(result, requestPayload)
    ? buildSingleAttemptLlmFromCoachResponse(result)
    : null
}

function buildReadingAnalysisArtifacts(submission: ReadingPracticeSubmission): ReadingPracticeAnalysisArtifacts {
  return {
    ...(isRecord(submission.analysisArtifacts) ? submission.analysisArtifacts : {}),
    highlights: submission.highlights,
    markedQuestions: submission.markedQuestions,
    analysisSignals: submission.analysisSignals,
    questionTimelineLite: submission.questionTimelineLite,
    singleAttemptAnalysisInput: submission.singleAttemptAnalysisInput,
    singleAttemptAnalysis: submission.singleAttemptAnalysis,
    singleAttemptAnalysisLlm: submission.singleAttemptAnalysisLlm
  }
}

function withReadingAnalysisArtifacts(submission: ReadingPracticeSubmission): ReadingPracticeSubmission {
  return {
    ...submission,
    analysisArtifacts: buildReadingAnalysisArtifacts(submission)
  }
}

function canonicalizeReadingHistoryRecord(record: PracticeHistoryRecord): PracticeHistoryRecord {
  if (record.activity !== 'reading' || !record.submission) {
    return record
  }
  return {
    ...record,
    submission: withReadingAnalysisArtifacts(record.submission)
  }
}

export function buildReadingHistoryRecord(submission: ReadingPracticeSubmission): PracticeHistoryRecord {
  const id = `reading-${submission.sessionId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
  const metadata: AnyRecord = {
    ...(submission.metadata || {}),
    questionTypePerformance: submission.questionTypePerformance || {},
    historyRecordId: id
  }
  const canonicalSubmission: ReadingPracticeSubmission = {
    ...withReadingAnalysisArtifacts(submission),
    metadata
  }
  return {
    id,
    activity: 'reading',
    sessionId: submission.sessionId,
    assetId: submission.assetId,
    examId: submission.examId,
    title: String(metadata.examTitle || metadata.title || submission.examId || '阅读练习'),
    status: 'completed',
    submittedAt: submission.submittedAt,
    startTime: submission.startTime || null,
    endTime: submission.endTime,
    duration: submission.duration,
    score: submission.scoreInfo.correct,
    totalQuestions: submission.scoreInfo.totalQuestions,
    correctAnswers: submission.scoreInfo.correct,
    accuracy: submission.scoreInfo.accuracy,
    metadata,
    submission: canonicalSubmission
  }
}

export function summarizeHistoryRecord(record: PracticeHistoryRecord): PracticeHistorySummary {
  const { submission: _submission, ...summary } = record
  return summary
}

export class PracticeHistoryStore {
  private readonly db: SqliteDatabaseLike | null
  private readonly memoryRecords = new Map<string, PracticeHistoryRecord>()

  constructor(db: unknown) {
    this.db = isSqliteLike(db) ? db : null
    if (this.db) {
      this.ensureSchema()
    }
  }

  saveReadingSubmission(submission: ReadingPracticeSubmission): PracticeHistorySummary {
    const record = buildReadingHistoryRecord(submission)
    this.upsert(record)
    return summarizeHistoryRecord(record)
  }

  list(options: ListHistoryOptions = {}) {
    const { page, limit } = normalizePagination(options.page, options.limit)
    if (this.db) {
      return this.listFromSqlite(options.activity || null, page, limit)
    }
    const all = Array.from(this.memoryRecords.values())
      .filter((record) => !options.activity || record.activity === options.activity)
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
    const offset = (page - 1) * limit
    return {
      data: all.slice(offset, offset + limit).map((record) => summarizeHistoryRecord(record)),
      total: all.length,
      page,
      limit
    }
  }

  getById(activity: PracticeActivity, recordId: string): PracticeHistoryRecord | null {
    const normalizedId = String(recordId || '').trim()
    if (!normalizedId) return null
    const record = this.db
      ? this.readOne('WHERE id = ? AND activity = ?', [normalizedId, activity])
      : this.memoryRecords.get(normalizedId) || null
    return record && record.activity === activity ? record : null
  }

  getBySession(activity: PracticeActivity, sessionId: string): PracticeHistoryRecord | null {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) return null
    if (this.db) {
      return this.readOne('WHERE session_id = ? AND activity = ?', [normalizedSessionId, activity])
    }
    return Array.from(this.memoryRecords.values()).find((record) => (
      record.activity === activity && record.sessionId === normalizedSessionId
    )) || null
  }

  getReadingSubmission(sessionId: string): ReadingPracticeSubmission | null {
    const record = this.getBySession('reading', sessionId)
    return record?.submission || null
  }

  exportArchive(activity: PracticeActivity = 'reading'): PracticeHistoryArchive {
    if (activity !== 'reading') {
      return {
        schemaVersion: 'practice-history-archive.v1',
        activity: 'reading',
        exportedAt: new Date().toISOString(),
        count: 0,
        submissions: []
      }
    }

    const submissions = this.listReadingSubmissions()
    return {
      schemaVersion: 'practice-history-archive.v1',
      activity: 'reading',
      exportedAt: new Date().toISOString(),
      count: submissions.length,
      submissions
    }
  }

  importReadingArchive(payload: unknown): PracticeHistoryImportResult {
    const source = collectArchiveSubmissions(payload)
    const records: PracticeHistorySummary[] = []
    const errors: PracticeHistoryImportResult['errors'] = []
    let skippedCount = 0

    source.forEach((entry, index) => {
      if (!isReadingPracticeSubmission(entry)) {
        errors.push({ index, reason: 'invalid_reading_submission' })
        skippedCount += 1
        return
      }

      try {
        const normalizedSubmission: ReadingPracticeSubmission = {
          ...entry,
          activity: 'reading',
          status: 'submitted',
          readOnly: true,
          assetId: normalizeNonEmptyString(entry.assetId || entry.examId),
          examId: normalizeNonEmptyString(entry.examId || entry.assetId),
          metadata: isRecord(entry.metadata) ? entry.metadata : {},
          readingCoachTranscript: Array.isArray(entry.readingCoachTranscript)
            ? entry.readingCoachTranscript
            : [],
          readingCoachSnapshot: entry.readingCoachSnapshot ?? null
        }
        records.push(this.saveReadingSubmission(normalizedSubmission))
      } catch (error) {
        errors.push({
          index,
          reason: error instanceof Error ? error.message : 'import_failed'
        })
        skippedCount += 1
      }
    })

    return {
      activity: 'reading',
      importedCount: records.length,
      skippedCount,
      totalCount: source.length,
      records,
      errors
    }
  }

  delete(activity: PracticeActivity, recordId: string): { deleted: boolean; id: string } {
    const normalizedId = String(recordId || '').trim()
    if (!normalizedId) return { deleted: false, id: normalizedId }
    const record = this.getById(activity, normalizedId) || this.getBySession(activity, normalizedId)
    if (!record) return { deleted: false, id: normalizedId }

    if (!this.db) {
      const deleted = this.memoryRecords.delete(record.id)
      return { deleted, id: record.id }
    }

    const result = this.db.prepare('DELETE FROM practice_history_records WHERE id = ? AND activity = ?').run(record.id, activity)
    return { deleted: Boolean(result?.changes), id: record.id }
  }

  clear(activity?: PracticeActivity | null): { deletedCount: number; activity: PracticeActivity | null } {
    const normalizedActivity = activity || null
    if (!this.db) {
      let deletedCount = 0
      Array.from(this.memoryRecords.values()).forEach((record) => {
        if (!normalizedActivity || record.activity === normalizedActivity) {
          if (this.memoryRecords.delete(record.id)) {
            deletedCount += 1
          }
        }
      })
      return { deletedCount, activity: normalizedActivity }
    }

    const result = normalizedActivity
      ? this.db.prepare('DELETE FROM practice_history_records WHERE activity = ?').run(normalizedActivity)
      : this.db.prepare('DELETE FROM practice_history_records').run()
    return { deletedCount: Math.max(0, Number(result?.changes || 0)), activity: normalizedActivity }
  }

  attachReadingCoachResult(sessionId: string, result: unknown, requestPayload: AnyRecord = {}): PracticeHistoryRecord | null {
    const record = this.getBySession('reading', sessionId)
    if (!record?.submission) return null

    const now = new Date().toISOString()
    const transcript = Array.isArray(record.submission.readingCoachTranscript)
      ? record.submission.readingCoachTranscript.slice()
      : []
    const query = String(requestPayload.query || '').trim()
    if (query) {
      transcript.push({
        role: 'user',
        content: query,
        createdAt: now,
        surface: requestPayload.surface || null,
        action: requestPayload.action || null
      })
    }
    const snapshot = result && typeof result === 'object' ? result : { value: result }
    const answer = typeof (result as AnyRecord)?.answer === 'string'
      ? String((result as AnyRecord).answer)
      : (typeof (result as AnyRecord)?.message === 'string' ? String((result as AnyRecord).message) : '')
    transcript.push({
      role: 'assistant',
      content: answer,
      createdAt: now,
      snapshot
    })
    const singleAttemptAnalysisLlm = resolveSingleAttemptLlmPatch(result, requestPayload)

    const updatedSubmission: ReadingPracticeSubmission = {
      ...record.submission,
      readingCoachSnapshot: snapshot,
      readingCoachTranscript: transcript
    }
    if (singleAttemptAnalysisLlm) {
      updatedSubmission.singleAttemptAnalysisLlm = singleAttemptAnalysisLlm
      updatedSubmission.analysisArtifacts = buildReadingAnalysisArtifacts(updatedSubmission)
    }

    const updated = {
      ...record,
      submission: updatedSubmission
    }
    this.upsert(updated)
    return updated
  }

  attachReadingCoachFailure(sessionId: string, error: unknown, requestPayload: AnyRecord = {}): PracticeHistoryRecord | null {
    const record = this.getBySession('reading', sessionId)
    if (!record?.submission) return null

    const now = new Date().toISOString()
    const transcript = Array.isArray(record.submission.readingCoachTranscript)
      ? record.submission.readingCoachTranscript.slice()
      : []
    const query = String(requestPayload.query || '').trim()
    if (query) {
      transcript.push({
        role: 'user',
        content: query,
        createdAt: now,
        surface: requestPayload.surface || null,
        action: requestPayload.action || null
      })
    }
    const snapshot = buildCoachFailureSnapshot(error)
    transcript.push({
      role: 'assistant',
      content: `阅读教练请求失败：${snapshot.message}`,
      createdAt: now,
      isError: true,
      snapshot
    })

    const updated = {
      ...record,
      submission: {
        ...record.submission,
        readingCoachSnapshot: snapshot,
        readingCoachTranscript: transcript
      }
    }
    this.upsert(updated)
    return updated
  }

  private ensureSchema() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS practice_history_records (
        id TEXT PRIMARY KEY,
        activity TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        asset_id TEXT,
        exam_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        total_questions INTEGER NOT NULL DEFAULT 0,
        correct_answers REAL NOT NULL DEFAULT 0,
        accuracy REAL NOT NULL DEFAULT 0,
        duration INTEGER NOT NULL DEFAULT 0,
        submitted_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        submission_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    this.ensureCanonicalColumns()
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_practice_history_activity_submitted_at
        ON practice_history_records(activity, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_practice_history_session
        ON practice_history_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_practice_history_exam
        ON practice_history_records(exam_id);
    `)
  }

  private ensureCanonicalColumns() {
    if (!this.db) return
    const columns = this.getPracticeHistoryColumns()
    if (!columns) return
    PRACTICE_HISTORY_COLUMNS.forEach(([name, definition]) => {
      if (columns.has(name)) return
      this.db?.exec(`ALTER TABLE practice_history_records ADD COLUMN ${name} ${definition};`)
    })
  }

  private getPracticeHistoryColumns(): Set<string> | null {
    if (!this.db) return null
    try {
      const rows = this.db.prepare('PRAGMA table_info(practice_history_records)').all()
      if (!Array.isArray(rows)) return null
      return new Set(rows.map((row: AnyRecord) => String(row.name || '')).filter(Boolean))
    } catch {
      return null
    }
  }

  private upsert(record: PracticeHistoryRecord) {
    const canonicalRecord = canonicalizeReadingHistoryRecord(record)
    if (!this.db) {
      this.memoryRecords.set(canonicalRecord.id, canonicalRecord)
      return
    }

    this.db.prepare(`
      INSERT INTO practice_history_records (
        id, activity, session_id, asset_id, exam_id, title, status,
        score, total_questions, correct_answers, accuracy, duration,
        submitted_at, started_at, ended_at, metadata_json, submission_json,
        created_at, updated_at
      ) VALUES (
        @id, @activity, @sessionId, @assetId, @examId, @title, @status,
        @score, @totalQuestions, @correctAnswers, @accuracy, @duration,
        @submittedAt, @startTime, @endTime, @metadataJson, @submissionJson,
        @submittedAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        activity = excluded.activity,
        session_id = excluded.session_id,
        asset_id = excluded.asset_id,
        exam_id = excluded.exam_id,
        title = excluded.title,
        status = excluded.status,
        score = excluded.score,
        total_questions = excluded.total_questions,
        correct_answers = excluded.correct_answers,
        accuracy = excluded.accuracy,
        duration = excluded.duration,
        submitted_at = excluded.submitted_at,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        metadata_json = excluded.metadata_json,
        submission_json = excluded.submission_json,
        updated_at = excluded.updated_at
    `).run({
      id: canonicalRecord.id,
      activity: canonicalRecord.activity,
      sessionId: canonicalRecord.sessionId,
      assetId: canonicalRecord.assetId || null,
      examId: canonicalRecord.examId || null,
      title: canonicalRecord.title,
      status: canonicalRecord.status,
      score: normalizeNumber(canonicalRecord.score),
      totalQuestions: Math.round(normalizeNumber(canonicalRecord.totalQuestions)),
      correctAnswers: normalizeNumber(canonicalRecord.correctAnswers),
      accuracy: normalizeNumber(canonicalRecord.accuracy),
      duration: Math.round(normalizeNumber(canonicalRecord.duration)),
      submittedAt: canonicalRecord.submittedAt,
      startTime: canonicalRecord.startTime || null,
      endTime: canonicalRecord.endTime,
      metadataJson: safeJsonStringify(canonicalRecord.metadata),
      submissionJson: safeJsonStringify(canonicalRecord.submission || null),
      updatedAt: new Date().toISOString()
    })
  }

  private listFromSqlite(activity: PracticeActivity | null, page: number, limit: number) {
    if (!this.db) {
      return { data: [], total: 0, page, limit }
    }
    const whereClause = activity ? 'WHERE activity = ?' : ''
    const params = activity ? [activity] : []
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM practice_history_records ${whereClause}`).get(...params)
    const rows = this.db.prepare(`
      SELECT
        id,
        activity,
        session_id,
        asset_id,
        exam_id,
        title,
        status,
        score,
        total_questions,
        correct_answers,
        accuracy,
        duration,
        submitted_at,
        started_at,
        ended_at,
        metadata_json
      FROM practice_history_records
      ${whereClause}
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, (page - 1) * limit)
    return {
      data: rows.map((row: AnyRecord) => this.rowToSummary(row)).filter(Boolean),
      total: Math.max(0, Number(totalRow?.total || 0)),
      page,
      limit
    }
  }

  private listReadingSubmissions(): ReadingPracticeSubmission[] {
    if (!this.db) {
      return Array.from(this.memoryRecords.values())
        .filter((record) => record.activity === 'reading' && record.submission)
        .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
        .map((record) => record.submission as ReadingPracticeSubmission)
    }

    const rows = this.db.prepare(`
      SELECT * FROM practice_history_records
      WHERE activity = ?
      ORDER BY submitted_at DESC
    `).all('reading')
    return rows
      .map((row: AnyRecord) => this.rowToRecord(row).submission)
      .filter((submission: ReadingPracticeSubmission | null | undefined): submission is ReadingPracticeSubmission => Boolean(submission))
  }

  private readOne(whereClause: string, params: unknown[]): PracticeHistoryRecord | null {
    if (!this.db) return null
    const row = this.db.prepare(`
      SELECT * FROM practice_history_records
      ${whereClause}
      LIMIT 1
    `).get(...params)
    return row ? this.rowToRecord(row) : null
  }

  private rowToRecord(row: AnyRecord): PracticeHistoryRecord {
    const summary = this.rowToSummary(row)
    const submission = safeJsonParse<ReadingPracticeSubmission | null>(row.submission_json, null)
    return {
      ...summary,
      submission
    }
  }

  private rowToSummary(row: AnyRecord): PracticeHistorySummary {
    const metadata = safeJsonParse<AnyRecord>(row.metadata_json, {})
    return {
      id: String(row.id || ''),
      activity: String(row.activity || 'reading') as PracticeActivity,
      sessionId: String(row.session_id || ''),
      assetId: row.asset_id == null ? null : String(row.asset_id),
      examId: row.exam_id == null ? null : String(row.exam_id),
      title: String(row.title || metadata?.title || metadata?.examTitle || ''),
      status: String(row.status || 'completed') as 'completed' | 'submitted',
      submittedAt: String(row.submitted_at || ''),
      startTime: row.started_at == null ? null : String(row.started_at),
      endTime: String(row.ended_at || row.submitted_at || ''),
      duration: normalizeNumber(row.duration),
      score: normalizeNumber(row.score),
      totalQuestions: normalizeNumber(row.total_questions),
      correctAnswers: normalizeNumber(row.correct_answers),
      accuracy: normalizeNumber(row.accuracy),
      metadata
    }
  }
}
