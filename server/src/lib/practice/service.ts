import type { ServiceBundle } from '../../types/api.js'
import { isPersistentReviewCoachRequest } from '../reading/router.js'
import { ReadingAssistantService } from '../reading/service.js'
import { createHttpError, normalizePagination, paginate } from '../shared/http.js'
import { WritingEvaluationService } from '../writing/service.js'
import {
  assertPracticeActivity,
  type PracticeActivity,
  type PracticeAsset,
  type PracticeHistoryImportResult,
  type PracticeHistorySummary,
  type PracticeMigrationStatus,
  type PracticeSessionCreateRequest,
  type PracticeSessionCreateResponse,
  type PracticeSessionState,
  type ReadingPracticeSubmission,
  type ReadingSuiteCreateRequest,
  type ReadingSuiteSession,
  type ReadingSuiteSubmitResponse
} from './contracts.js'
import { getPracticeMigrationStatus } from './migration-status.js'
import { PracticeHistoryStore } from './practice-history.js'
import { clearReadingAssetCaches, loadReadingManifest, loadReadingPracticePayload } from './reading-assets.js'
import { ReadingSuiteSessionStore } from './reading-suite-store.js'
import {
  createReadingSuiteSession,
  submitReadingSuitePassage as submitReadingSuitePassageAttempt
} from './reading-suite-sessions.js'
import { createReadingPracticeSubmission } from './reading-sessions.js'

interface ListAssetOptions {
  activity?: string | null
  page?: number
  limit?: number
  refresh?: boolean
}

interface ListHistoryOptions {
  activity?: string | null
  page?: number
  limit?: number
}

interface PracticeCoachOptions {
  requirePersistedReviewSession?: boolean
}

function normalizeCoachTranscriptHistory(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Record<string, unknown>
      const role = String(item.role || '').trim().toLowerCase() === 'assistant' ? 'assistant' : 'user'
      const content = typeof item.content === 'string'
        ? item.content.trim()
        : ''
      if (!content) return null
      return { role, content }
    })
    .filter((entry): entry is { role: 'user' | 'assistant'; content: string } => Boolean(entry))
    .slice(-8)
}

function hasCoachHistory(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => (
    entry
    && typeof entry === 'object'
    && typeof (entry as Record<string, unknown>).content === 'string'
    && Boolean(String((entry as Record<string, unknown>).content || '').trim())
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function shouldExposeSingleAttemptLlm(result: unknown, requestPayload: Record<string, unknown>) {
  if (isRecord(result) && isRecord(result.singleAttemptAnalysisLlm)) {
    return true
  }
  if (isPersistentReviewCoachRequest(requestPayload)) {
    return true
  }
  if (!isRecord(result)) {
    return false
  }
  return isRecord(result.reviewOverall)
    || (Array.isArray(result.reviewQuestionAnalyses) && result.reviewQuestionAnalyses.length > 0)
}

function isPersistentReadingCoachRequest(payload: Record<string, unknown>): boolean {
  return isPersistentReviewCoachRequest(payload)
}

function extractPlainText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
      return extractPlainText(JSON.parse(trimmed))
    } catch {
      return trimmed
    }
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const node = value as Record<string, unknown>
  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }
  if (Array.isArray(node.content)) {
    return node.content.map((item) => extractPlainText(item)).join('')
  }
  return ''
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value)
    if (normalized) return normalized
  }
  return ''
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readRecordField(source: unknown, fieldName: string): unknown {
  return isRecord(source) ? source[fieldName] : undefined
}

function readNestedRecord(source: unknown, fieldName: string): Record<string, unknown> {
  const value = readRecordField(source, fieldName)
  return isRecord(value) ? value : {}
}

function normalizeLegacyRecordKey(record: Record<string, unknown>): string {
  const realData = readNestedRecord(record, 'realData')
  return firstNonEmptyString(
    record.sessionId,
    realData.sessionId,
    record.id,
    record.examId,
    record.assetId
  )
}

function isCanonicalReadingSubmission(value: unknown): value is ReadingPracticeSubmission {
  if (!isRecord(value)) return false
  return value.activity === 'reading'
    && value.status === 'submitted'
    && Boolean(normalizeNonEmptyString(value.sessionId))
    && isRecord(value.scoreInfo)
    && isRecord(value.answerComparison)
}

function hasAnswerLikePayload(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0
}

function isLegacyPracticeRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || isCanonicalReadingSubmission(value)) {
    return false
  }
  const metadata = readNestedRecord(value, 'metadata')
  const realData = readNestedRecord(value, 'realData')
  const resultSnapshot = readNestedRecord(value, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  const activity = firstNonEmptyString(
    value.activity,
    value.type,
    value.examType,
    metadata.activity,
    metadata.type,
    realData.activity,
    realData.type
  ).toLowerCase()
  const examId = firstNonEmptyString(
    value.examId,
    value.assetId,
    value.dataKey,
    metadata.examId,
    metadata.assetId,
    metadata.dataKey,
    realData.examId,
    realData.assetId,
    realData.dataKey
  )
  const answers = firstDefined(
    value.answers,
    realData.answers,
    resultSnapshot.answers,
    resultRealData.answers
  )
  const scoreInfo = firstDefined(
    value.scoreInfo,
    realData.scoreInfo,
    resultSnapshot.scoreInfo,
    resultRealData.scoreInfo
  )
  const looksReading = !activity
    || activity === 'reading'
    || activity === 'practice_complete'
    || activity === 'practice'
    || activity === 'practice_record'
    || activity === 'ielts_reading'
  return Boolean(examId && looksReading && (hasAnswerLikePayload(answers) || isRecord(scoreInfo)))
}

function collectArchiveEntries(payload: unknown): unknown[] {
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

function canonicalArchivePayloadWithoutLegacyRecords(payload: unknown): unknown {
  const entries = collectArchiveEntries(payload)
  if (!entries.length) return payload
  return {
    submissions: entries.filter((entry) => !isLegacyPracticeRecord(entry))
  }
}

function collectLegacyPracticeRecords(payload: unknown): Record<string, unknown>[] {
  const candidates: unknown[] = []
  const append = (value: unknown) => {
    asArray(value).forEach((entry) => candidates.push(entry))
  }

  if (Array.isArray(payload)) {
    append(payload)
  }
  if (isRecord(payload)) {
    const data = readNestedRecord(payload, 'data')
    const examSystem = readNestedRecord(payload, 'exam_system_practice_records')
    const dataExamSystem = readNestedRecord(data, 'exam_system_practice_records')
    append(payload.records)
    append(payload.practice_records)
    append(payload.mymelodypracticerecords)
    append(payload.my_melody_practice_records)
    append(data.practice_records)
    append(data.mymelodypracticerecords)
    append(data.my_melody_practice_records)
    append(examSystem.data)
    append(dataExamSystem.data)
  }

  const seen = new Set<string>()
  const output: Record<string, unknown>[] = []
  candidates.forEach((entry, index) => {
    if (!isLegacyPracticeRecord(entry)) return
    const key = normalizeLegacyRecordKey(entry) || `index:${index}`
    if (seen.has(key)) return
    seen.add(key)
    output.push(entry)
  })
  return output
}

function normalizeCoachTranscript(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .map((entry): Record<string, unknown> | null => {
      if (!isRecord(entry)) return null
      const content = firstNonEmptyString(entry.content, entry.text, entry.message, entry.answer)
      if (!content) return null
      const role = String(entry.role || '').trim().toLowerCase() === 'assistant'
        ? 'assistant'
        : 'user'
      return {
        ...entry,
        role,
        content
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
}

function normalizeLegacyExamId(record: Record<string, unknown>): string {
  const metadata = readNestedRecord(record, 'metadata')
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultMetadata = readNestedRecord(resultSnapshot, 'metadata')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return firstNonEmptyString(
    record.examId,
    record.assetId,
    record.dataKey,
    metadata.examId,
    metadata.assetId,
    metadata.dataKey,
    resultSnapshot.examId,
    resultSnapshot.assetId,
    resultMetadata.examId,
    resultMetadata.assetId,
    resultMetadata.dataKey,
    realData.examId,
    realData.assetId,
    realData.dataKey,
    resultRealData.examId,
    resultRealData.assetId,
    resultRealData.dataKey
  )
}

function buildLegacyReadingAttempt(record: Record<string, unknown>): Record<string, unknown> {
  const metadata = readNestedRecord(record, 'metadata')
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultMetadata = readNestedRecord(resultSnapshot, 'metadata')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  const singleAttemptInput = readNestedRecord(record, 'singleAttemptAnalysisInput')
  const realSingleAttemptInput = readNestedRecord(realData, 'singleAttemptAnalysisInput')
  const interactions = asArray(firstDefined(record.interactions, realData.interactions, resultSnapshot.interactions, resultRealData.interactions))

  return {
    answers: firstDefined(record.answers, realData.answers, resultSnapshot.answers, resultRealData.answers, {}),
    markedQuestions: firstDefined(
      record.markedQuestions,
      metadata.markedQuestions,
      resultSnapshot.markedQuestions,
      resultMetadata.markedQuestions,
      realData.markedQuestions,
      resultRealData.markedQuestions,
      []
    ),
    highlights: firstDefined(
      record.highlights,
      metadata.highlights,
      resultSnapshot.highlights,
      resultMetadata.highlights,
      realData.highlights,
      resultRealData.highlights,
      []
    ),
    questionTimelineLite: firstDefined(
      record.questionTimelineLite,
      record.questionTimeline,
      singleAttemptInput.questionTimelineLite,
      resultSnapshot.questionTimelineLite,
      resultRealData.questionTimelineLite,
      realData.questionTimelineLite,
      realSingleAttemptInput.questionTimelineLite,
      []
    ),
    interactionCount: firstDefined(
      record.interactionCount,
      record.interactionsCount,
      realData.interactionCount,
      realData.interactionsCount,
      resultSnapshot.interactionCount,
      resultRealData.interactionCount,
      interactions.length || undefined
    ),
    duration: firstDefined(
      record.duration,
      record.durationSec,
      record.elapsed,
      record.elapsedSeconds,
      realData.duration,
      realData.durationSec,
      resultSnapshot.duration,
      resultRealData.duration
    ),
    startTime: firstDefined(
      record.startTime,
      record.startedAt,
      realData.startTime,
      realData.startedAt,
      resultSnapshot.startTime,
      resultRealData.startTime
    ),
    endTime: firstDefined(
      record.endTime,
      record.completedAt,
      record.submittedAt,
      record.updatedAt,
      realData.endTime,
      realData.completedAt,
      resultSnapshot.endTime,
      resultSnapshot.completedAt,
      resultRealData.endTime
    ),
    timerSnapshot: firstDefined(
      record.timerSnapshot,
      metadata.timerSnapshot,
      realData.timerSnapshot,
      resultSnapshot.timerSnapshot,
      resultMetadata.timerSnapshot,
      resultRealData.timerSnapshot
    ),
    effectiveEndTime: firstDefined(
      record.effectiveEndTime,
      metadata.effectiveEndTime,
      realData.effectiveEndTime,
      resultSnapshot.effectiveEndTime,
      resultMetadata.effectiveEndTime,
      resultRealData.effectiveEndTime
    ),
    effectiveEndTimeMs: firstDefined(
      record.effectiveEndTimeMs,
      metadata.effectiveEndTimeMs,
      realData.effectiveEndTimeMs,
      resultSnapshot.effectiveEndTimeMs,
      resultMetadata.effectiveEndTimeMs,
      resultRealData.effectiveEndTimeMs
    ),
    scrollY: firstDefined(
      record.scrollY,
      metadata.scrollY,
      realData.scrollY,
      resultSnapshot.scrollY,
      resultMetadata.scrollY,
      resultRealData.scrollY
    ),
    singleAttemptAnalysisLlm: firstDefined(
      record.singleAttemptAnalysisLlm,
      realData.singleAttemptAnalysisLlm,
      resultSnapshot.singleAttemptAnalysisLlm,
      resultRealData.singleAttemptAnalysisLlm
    )
  }
}

function getLegacyCoachSnapshot(record: Record<string, unknown>): unknown {
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return firstDefined(
    record.readingCoachSnapshot,
    record.coachSnapshot,
    realData.readingCoachSnapshot,
    realData.coachSnapshot,
    resultSnapshot.readingCoachSnapshot,
    resultRealData.readingCoachSnapshot
  ) ?? null
}

function getLegacyCoachTranscript(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const realData = readNestedRecord(record, 'realData')
  const resultSnapshot = readNestedRecord(record, 'resultSnapshot')
  const resultRealData = readNestedRecord(resultSnapshot, 'realData')
  return normalizeCoachTranscript(firstDefined(
    record.readingCoachTranscript,
    record.coachTranscript,
    realData.readingCoachTranscript,
    realData.coachTranscript,
    resultSnapshot.readingCoachTranscript,
    resultRealData.readingCoachTranscript
  ))
}

function mergeReadingImportResults(
  canonical: PracticeHistoryImportResult,
  legacy: {
    records: PracticeHistorySummary[]
    errors: PracticeHistoryImportResult['errors']
    skippedCount: number
    totalCount: number
  }
): PracticeHistoryImportResult {
  return {
    activity: 'reading',
    importedCount: canonical.importedCount + legacy.records.length,
    skippedCount: canonical.skippedCount + legacy.skippedCount,
    totalCount: canonical.totalCount + legacy.totalCount,
    records: [
      ...canonical.records,
      ...legacy.records
    ],
    errors: [
      ...canonical.errors,
      ...legacy.errors.map((error) => ({
        ...error,
        index: canonical.totalCount + error.index
      }))
    ]
  }
}

export class PracticeService {
  private readonly services: ServiceBundle
  private readonly writingEvaluationService: WritingEvaluationService
  private readonly readingAssistantService: ReadingAssistantService
  private readonly historyStore: PracticeHistoryStore
  private readonly readingSuiteStore: ReadingSuiteSessionStore

  constructor(services: ServiceBundle) {
    this.services = services
    this.writingEvaluationService = new WritingEvaluationService(services)
    this.readingAssistantService = new ReadingAssistantService(services)
    this.historyStore = new PracticeHistoryStore(services.db)
    this.readingSuiteStore = new ReadingSuiteSessionStore(services.db)
  }

  getMigrationStatus(): PracticeMigrationStatus {
    return getPracticeMigrationStatus()
  }

  async listAssets(options: ListAssetOptions = {}) {
    const activity = options.activity ? assertPracticeActivity(options.activity) : null
    const { page, limit } = normalizePagination(options.page, options.limit)
    if (options.refresh && (!activity || activity === 'reading')) {
      clearReadingAssetCaches()
    }

    if (activity === 'reading') {
      return paginate(this.listReadingAssets(), page, limit)
    }

    if (activity === 'writing') {
      return this.listWritingAssets(page, limit)
    }

    const readingAssets = this.listReadingAssets()
    const writingAssets = await this.listWritingAssets(1, limit)
    return paginate([
      ...readingAssets,
      ...writingAssets.data
    ], page, limit)
  }

  async getAsset(activity: string, assetId: string, options: { refresh?: boolean } = {}) {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedAssetId = String(assetId || '').trim()
    if (!normalizedAssetId) {
      throw createHttpError('invalid_asset_id', 'Missing practice asset id')
    }

    if (normalizedActivity === 'reading') {
      if (options.refresh) {
        clearReadingAssetCaches()
      }
      const manifestEntry = this.loadReadingManifest()[normalizedAssetId]
      if (!manifestEntry) {
        throw createHttpError('practice_asset_not_found', `Reading asset not found: ${normalizedAssetId}`, 404)
      }
      return {
        ...this.toReadingAsset(normalizedAssetId, manifestEntry),
        payload: loadReadingPracticePayload(normalizedAssetId, manifestEntry)
      }
    }

    const topic = await this.services.topicService.getById(Number(normalizedAssetId))
    if (!topic) {
      throw createHttpError('practice_asset_not_found', `Writing asset not found: ${normalizedAssetId}`, 404)
    }
    return this.toWritingAsset(topic)
  }

  async createSession(payload: PracticeSessionCreateRequest): Promise<PracticeSessionCreateResponse> {
    const activity = assertPracticeActivity(payload?.activity)
    if (activity === 'reading') {
      const assetId = String(payload.assetId || '').trim()
      if (!assetId) {
        throw createHttpError('invalid_practice_attempt', 'Missing reading practice asset id')
      }
      const manifestEntry = this.loadReadingManifest()[assetId]
      if (!manifestEntry) {
        throw createHttpError('practice_asset_not_found', `Reading asset not found: ${assetId}`, 404)
      }
      const readingPayload = loadReadingPracticePayload(assetId, manifestEntry)
      const attempt = payload.attempt && typeof payload.attempt === 'object' ? payload.attempt : {}
      const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
      const submission = createReadingPracticeSubmission(readingPayload, attempt as Record<string, unknown>, settings as Record<string, unknown>)
      const historyRecord = this.historyStore.saveReadingSubmission(submission)
      return {
        sessionId: submission.sessionId,
        activity,
        status: 'submitted',
        legacy: {
          provider: 'practice_reading',
          sessionId: submission.sessionId
        },
        submission,
        historyRecord
      }
    }

    const attempt = payload.attempt && typeof payload.attempt === 'object' ? payload.attempt : {}
    const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
    const result = await this.writingEvaluationService.create({
      task_type: this.normalizeWritingTaskType(attempt.task_type || attempt.taskType),
      topic_id: this.normalizeOptionalPositiveNumber(payload.assetId ?? attempt.topic_id ?? attempt.topicId),
      topic_text: typeof attempt.topic_text === 'string'
        ? attempt.topic_text
        : (typeof attempt.topicText === 'string' ? attempt.topicText : null),
      content: this.requireString(attempt.content, 'content'),
      word_count: this.normalizeOptionalNonNegativeNumber(attempt.word_count ?? attempt.wordCount),
      config_id: this.normalizeOptionalPositiveNumber(settings.config_id ?? settings.configId),
      api_config_id: this.normalizeOptionalPositiveNumber(settings.api_config_id ?? settings.apiConfigId),
      prompt_version: typeof settings.prompt_version === 'string'
        ? settings.prompt_version
        : (typeof settings.promptVersion === 'string' ? settings.promptVersion : null)
    })

    return {
      sessionId: String(result.sessionId || ''),
      activity,
      status: 'active',
      legacy: {
        provider: 'writing_evaluation',
        sessionId: String(result.sessionId || '')
      }
    }
  }

  async getSessionState(activity: string, sessionId: string): Promise<PracticeSessionState> {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) {
      throw createHttpError('invalid_session_id', 'Missing practice session id')
    }
    if (normalizedActivity === 'reading') {
      const submission = this.historyStore.getReadingSubmission(normalizedSessionId)
      if (!submission) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
      const historyRecord = this.historyStore.getBySession('reading', normalizedSessionId)
      return {
        sessionId: normalizedSessionId,
        activity: normalizedActivity,
        status: 'submitted',
        active: false,
        events: [],
        lastSequence: 0,
        submission,
        legacy: submission.legacy
      }
    }

    const legacy = await this.writingEvaluationService.getSessionState(normalizedSessionId)
    return {
      sessionId: normalizedSessionId,
      activity: normalizedActivity,
      status: legacy?.status || (legacy?.active ? 'active' : 'completed'),
      active: Boolean(legacy?.active),
      lastSequence: Number(legacy?.lastSequence || 0),
      events: Array.isArray(legacy?.events) ? legacy.events : [],
      legacy
    }
  }

  subscribeSession(activity: string, sessionId: string, handler: (event: Record<string, unknown>) => void) {
    const normalizedActivity = assertPracticeActivity(activity)
    if (normalizedActivity !== 'writing') {
      return () => {}
    }
    return this.writingEvaluationService.subscribe(sessionId, handler)
  }

  async cancelSession(activity: string, sessionId: string) {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) {
      throw createHttpError('invalid_session_id', 'Missing practice session id')
    }
    if (normalizedActivity === 'reading') {
      const submission = this.historyStore.getReadingSubmission(normalizedSessionId)
      if (!submission) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
      throw createHttpError('practice_session_not_cancellable', 'Submitted reading sessions are persisted history records and cannot be cancelled', 409)
    }
    return this.writingEvaluationService.cancel(normalizedSessionId)
  }

  async createReadingSuite(request: ReadingSuiteCreateRequest = {}): Promise<ReadingSuiteSession> {
    const session = createReadingSuiteSession(this.loadReadingManifest(), request)
    return this.readingSuiteStore.save(session)
  }

  async getReadingSuite(sessionId: string): Promise<ReadingSuiteSession> {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) {
      throw createHttpError('invalid_suite_session_id', 'Missing reading suite session id')
    }
    const session = this.readingSuiteStore.get(normalizedSessionId)
    if (!session) {
      throw createHttpError('reading_suite_not_found', `Reading suite session not found: ${normalizedSessionId}`, 404)
    }
    return session
  }

  async submitReadingSuitePassage(
    suiteSessionId: string,
    assetId: string,
    attempt: Record<string, unknown> = {},
    settings: Record<string, unknown> = {}
  ): Promise<ReadingSuiteSubmitResponse> {
    const normalizedSuiteSessionId = String(suiteSessionId || '').trim()
    const normalizedAssetId = String(assetId || '').trim()
    if (!normalizedSuiteSessionId) {
      throw createHttpError('invalid_suite_session_id', 'Missing reading suite session id')
    }
    if (!normalizedAssetId) {
      throw createHttpError('invalid_practice_attempt', 'Missing reading suite passage asset id')
    }

    const session = this.readingSuiteStore.get(normalizedSuiteSessionId)
    if (!session) {
      throw createHttpError('reading_suite_not_found', `Reading suite session not found: ${normalizedSuiteSessionId}`, 404)
    }
    const manifestEntry = this.loadReadingManifest()[normalizedAssetId]
    if (!manifestEntry) {
      throw createHttpError('practice_asset_not_found', `Reading asset not found: ${normalizedAssetId}`, 404)
    }
    const readingPayload = loadReadingPracticePayload(normalizedAssetId, manifestEntry)
    const result = submitReadingSuitePassageAttempt(session, readingPayload, attempt, settings)
    const historyRecord = this.historyStore.saveReadingSubmission(result.submission)
    const suiteSession = this.readingSuiteStore.save(result.suiteSession)
    return {
      sessionId: suiteSession.sessionId,
      activity: 'reading',
      status: suiteSession.status,
      suiteSession,
      submission: result.submission,
      historyRecord
    }
  }

  async listHistory(options: ListHistoryOptions = {}) {
    const activity = options.activity ? assertPracticeActivity(options.activity) : null
    return this.historyStore.list({
      activity,
      page: options.page,
      limit: options.limit
    })
  }

  async getHistoryRecord(activity: string, recordId: string) {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedRecordId = String(recordId || '').trim()
    if (!normalizedRecordId) {
      throw createHttpError('invalid_history_record_id', 'Missing practice history record id')
    }
    const record = this.historyStore.getById(normalizedActivity, normalizedRecordId)
      || this.historyStore.getBySession(normalizedActivity, normalizedRecordId)
    if (!record) {
      throw createHttpError('practice_history_not_found', `Practice history record not found: ${normalizedRecordId}`, 404)
    }
    return record
  }

  async deleteHistoryRecord(activity: string, recordId: string) {
    const normalizedActivity = assertPracticeActivity(activity)
    const normalizedRecordId = String(recordId || '').trim()
    if (!normalizedRecordId) {
      throw createHttpError('invalid_history_record_id', 'Missing practice history record id')
    }
    const result = this.historyStore.delete(normalizedActivity, normalizedRecordId)
    if (!result.deleted) {
      throw createHttpError('practice_history_not_found', `Practice history record not found: ${normalizedRecordId}`, 404)
    }
    return result
  }

  async clearHistory(options: ListHistoryOptions = {}) {
    const activity = options.activity ? assertPracticeActivity(options.activity) : null
    return this.historyStore.clear(activity)
  }

  async exportHistoryArchive(options: ListHistoryOptions = {}) {
    const activity = options.activity ? assertPracticeActivity(options.activity) : 'reading'
    if (activity !== 'reading') {
      throw createHttpError('practice_history_archive_not_supported', 'Only reading history archive export is supported', 501)
    }
    return this.historyStore.exportArchive(activity)
  }

  async importHistoryArchive(activity: string, payload: unknown) {
    const normalizedActivity = assertPracticeActivity(activity)
    if (normalizedActivity !== 'reading') {
      throw createHttpError('practice_history_archive_not_supported', 'Only reading history archive import is supported', 501)
    }
    const canonicalResult = this.historyStore.importReadingArchive(canonicalArchivePayloadWithoutLegacyRecords(payload))
    const legacyResult = this.importLegacyReadingRecords(collectLegacyPracticeRecords(payload))
    return mergeReadingImportResults(canonicalResult, legacyResult)
  }

  async coach(
    activity: string,
    payload: Record<string, unknown>,
    onEvent?: (event: Record<string, unknown>) => void,
    sessionId?: string | null,
    options: PracticeCoachOptions = {}
  ) {
    const normalizedActivity = assertPracticeActivity(activity)
    if (normalizedActivity !== 'reading') {
      throw createHttpError('practice_coach_not_implemented', 'Only reading coach is available in the Slice 0 facade yet', 501)
    }
    const normalizedSessionId = String(sessionId || '').trim()
    const requirePersistedReviewSession = options.requirePersistedReviewSession !== false
    const coachPayload = this.withReadingSessionContext(payload, normalizedSessionId, { requirePersistedReviewSession }) as any
    let result
    try {
      result = await this.readingAssistantService.query(coachPayload, onEvent)
    } catch (error) {
      if (normalizedSessionId) {
        this.historyStore.attachReadingCoachFailure(normalizedSessionId, error, coachPayload)
      }
      throw error
    }
    if (normalizedSessionId) {
      const updatedRecord = this.historyStore.attachReadingCoachResult(normalizedSessionId, result, coachPayload)
      if (!updatedRecord && requirePersistedReviewSession && isPersistentReadingCoachRequest(coachPayload)) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
      const singleAttemptAnalysisLlm = updatedRecord?.submission?.singleAttemptAnalysisLlm
      if (singleAttemptAnalysisLlm && result && typeof result === 'object' && shouldExposeSingleAttemptLlm(result, coachPayload)) {
        return {
          ...result,
          singleAttemptAnalysisLlm
        }
      }
    }
    return result
  }

  private withReadingSessionContext(
    payload: Record<string, unknown>,
    sessionId?: string | null,
    options: PracticeCoachOptions = {}
  ) {
    const normalizedSessionId = String(sessionId || '').trim()
    if (!normalizedSessionId) {
      return payload
    }
    const submission = this.historyStore.getReadingSubmission(normalizedSessionId)
    if (!submission) {
      if (options.requirePersistedReviewSession !== false && isPersistentReadingCoachRequest(payload)) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
      return payload
    }
    const payloadAttemptContext = payload.attemptContext && typeof payload.attemptContext === 'object'
      ? payload.attemptContext as Record<string, unknown>
      : {}
    return {
      ...payload,
      sessionId: typeof payload.sessionId === 'string' && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : normalizedSessionId,
      examId: submission.examId,
      history: hasCoachHistory(payload.history)
        ? payload.history
        : normalizeCoachTranscriptHistory(submission.readingCoachTranscript),
      attemptContext: {
        ...payloadAttemptContext,
        submitted: true,
        score: submission.coachContext.score,
        wrongQuestions: submission.coachContext.wrongQuestions,
        selectedAnswers: submission.coachContext.selectedAnswers,
        analysisSignals: submission.analysisSignals || submission.analysisArtifacts?.analysisSignals || payloadAttemptContext.analysisSignals || null,
        markedQuestions: Array.isArray(submission.markedQuestions) ? submission.markedQuestions : payloadAttemptContext.markedQuestions,
        questionTimelineLite: Array.isArray(submission.questionTimelineLite) ? submission.questionTimelineLite : payloadAttemptContext.questionTimelineLite,
        questionTypePerformance: submission.questionTypePerformance || payloadAttemptContext.questionTypePerformance || {}
      }
    }
  }

  private listReadingAssets(): PracticeAsset[] {
    const manifest = this.loadReadingManifest()
    return Object.entries(manifest)
      .map(([id, entry]) => this.toReadingAsset(id, entry))
      .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  }

  private async listWritingAssets(page: number, limit: number) {
    const result = await this.services.topicService.list({}, { page, limit })
    const data = Array.isArray(result?.data)
      ? result.data.map((topic: Record<string, unknown>) => this.toWritingAsset(topic))
      : []
    return {
      data,
      total: Number(result?.total || data.length),
      page: Number(result?.page || page),
      limit: Number(result?.limit || limit)
    }
  }

  private toReadingAsset(id: string, entry: Record<string, unknown>): PracticeAsset {
    const script = typeof entry.script === 'string' && entry.script.trim() ? entry.script.trim() : null
    const dataKey = typeof entry.dataKey === 'string' && entry.dataKey.trim() ? entry.dataKey.trim() : null
    const examId = String(entry.examId || id)
    return {
      id: examId,
      activity: 'reading',
      title: String(entry.title || entry.examId || id),
      source: 'reading_exam',
      category: typeof entry.category === 'string' ? entry.category : null,
      payloadRef: script ? (dataKey || examId) : null,
      metadata: {
        dataKey: script ? (dataKey || examId) : null,
        script,
        frequency: entry.frequency || null,
        pdfFilename: entry.pdfFilename || null,
        legacyPath: entry.legacyPath || null,
        legacyFilename: entry.legacyFilename || null,
        shuiPdf: entry.shuiPdf || null
      }
    }
  }

  private toWritingAsset(topic: Record<string, unknown>): PracticeAsset {
    const id = String(topic.id || '')
    const title = extractPlainText(topic.title_json) || `Writing topic ${id}`
    return {
      id,
      activity: 'writing',
      title,
      source: 'writing_topic',
      category: typeof topic.category === 'string' ? topic.category : null,
      difficulty: topic.difficulty as number | string | null,
      payloadRef: id,
      metadata: {
        taskType: topic.type || null,
        imagePath: topic.image_path || null,
        isOfficial: Boolean(topic.is_official)
      }
    }
  }

  private loadReadingManifest(): Record<string, Record<string, unknown>> {
    return loadReadingManifest()
  }

  private importLegacyReadingRecords(records: Record<string, unknown>[]) {
    const importedRecords: PracticeHistorySummary[] = []
    const errors: PracticeHistoryImportResult['errors'] = []
    let skippedCount = 0

    records.forEach((record, index) => {
      try {
        const submission = this.toReadingSubmissionFromLegacyRecord(record)
        importedRecords.push(this.historyStore.saveReadingSubmission(submission))
      } catch (error) {
        skippedCount += 1
        errors.push({
          index,
          reason: error instanceof Error ? error.message : 'legacy_record_import_failed'
        })
      }
    })

    return {
      records: importedRecords,
      errors,
      skippedCount,
      totalCount: records.length
    }
  }

  private toReadingSubmissionFromLegacyRecord(record: Record<string, unknown>): ReadingPracticeSubmission {
    const assetId = normalizeLegacyExamId(record)
    if (!assetId) {
      throw new Error('legacy_record_missing_exam_id')
    }

    const resolved = this.resolveReadingManifestEntry(assetId)
    if (!resolved) {
      throw new Error(`legacy_reading_asset_not_found:${assetId}`)
    }

    const readingPayload = loadReadingPracticePayload(resolved.assetId, resolved.entry)
    const attempt = buildLegacyReadingAttempt(record)
    const settings: Record<string, unknown> = {
      sessionId: firstNonEmptyString(record.sessionId, readRecordField(record.realData, 'sessionId'), record.id)
    }
    const submission = createReadingPracticeSubmission(readingPayload, attempt, settings)
    const legacyMetadata: Record<string, unknown> = {
      ...(submission.metadata || {}),
      importSource: 'legacy_practice_records',
      legacyPracticeRecordId: firstNonEmptyString(record.id),
      legacyExamId: assetId,
      legacyRecordType: firstNonEmptyString(record.type, record.activity),
      renderMode: 'legacy-reading'
    }
    const readingCoachSnapshot = getLegacyCoachSnapshot(record)
    const readingCoachTranscript = getLegacyCoachTranscript(record)
    const singleAttemptAnalysisLlm = attempt.singleAttemptAnalysisLlm ?? null

    const normalizedSubmission: ReadingPracticeSubmission = {
      ...submission,
      metadata: legacyMetadata,
      readingCoachSnapshot,
      readingCoachTranscript,
      singleAttemptAnalysisLlm,
      legacy: {
        ...submission.legacy,
        renderMode: 'vue-reading'
      }
    }
    return normalizedSubmission
  }

  private resolveReadingManifestEntry(assetId: string): { assetId: string; entry: Record<string, unknown> } | null {
    const manifest = this.loadReadingManifest()
    const direct = manifest[assetId]
    if (direct) {
      return { assetId, entry: direct }
    }
    const match = Object.entries(manifest).find(([key, entry]) => (
      key === assetId
      || String(entry.examId || '').trim() === assetId
      || String(entry.dataKey || '').trim() === assetId
      || String(entry.legacyFilename || '').trim() === assetId
    ))
    return match ? { assetId: match[0], entry: match[1] } : null
  }

  private normalizeWritingTaskType(value: unknown): 'task1' | 'task2' {
    const normalized = String(value || 'task2').trim().toLowerCase()
    return normalized === 'task1' ? 'task1' : 'task2'
  }

  private normalizeOptionalPositiveNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const numeric = Number(value)
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null
  }

  private normalizeOptionalNonNegativeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null
  }

  private requireString(value: unknown, fieldName: string): string {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized) {
      throw createHttpError('invalid_practice_attempt', `Missing practice attempt field: ${fieldName}`)
    }
    return normalized
  }
}
