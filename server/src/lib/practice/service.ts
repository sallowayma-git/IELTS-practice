import type { ServiceBundle } from '../../types/api.js'
import { createHttpError } from '../shared/http.js'
import { WritingEvaluationService } from '../writing/service.js'
import {
  assertPracticeActivity,
  type PracticeMigrationStatus,
  type PracticeSessionCreateRequest,
  type PracticeSessionCreateResponse,
  type PracticeSessionState,
  type ReadingAssetProvider,
  type ReadingSuiteCreateRequest,
  type ReadingSuiteSession,
  type ReadingSuiteSubmitResponse
} from './contracts.js'
import { PracticeAssetFacade, type ListAssetOptions } from './assets/PracticeAssetFacade.js'
import { ReadingCoachFacade, type PracticeCoachOptions } from './coach/ReadingCoachFacade.js'
import { PracticeHistoryFacade, type ListHistoryOptions } from './history/PracticeHistoryFacade.js'
import { getPracticeMigrationStatus } from './migration-status.js'
import { createReadingPracticeSubmission } from './reading-sessions.js'
import { ReadingSuiteFacade } from './suite/ReadingSuiteFacade.js'

interface PracticeServiceOptions {
  readingAssetProvider?: ReadingAssetProvider
}

export class PracticeService {
  readonly assets: PracticeAssetFacade
  readonly history: PracticeHistoryFacade
  readonly suite: ReadingSuiteFacade
  readonly coachFacade: ReadingCoachFacade

  private readonly writingEvaluationService: WritingEvaluationService

  constructor(services: ServiceBundle, options: PracticeServiceOptions = {}) {
    this.assets = new PracticeAssetFacade(services, options.readingAssetProvider)
    this.history = new PracticeHistoryFacade(services, {
      getReadingPayload: (assetId) => this.assets.getReadingPayload(assetId)
    })
    this.suite = new ReadingSuiteFacade(services, this.assets, this.history)
    this.coachFacade = new ReadingCoachFacade(services, this.history)
    this.writingEvaluationService = new WritingEvaluationService(services)
  }

  getMigrationStatus(): PracticeMigrationStatus {
    return getPracticeMigrationStatus()
  }

  async listAssets(options: ListAssetOptions = {}) {
    return this.assets.listAssets(options)
  }

  async getAsset(activity: string, assetId: string, options: { refresh?: boolean } = {}) {
    return this.assets.getAsset(activity, assetId, options)
  }

  async createSession(payload: PracticeSessionCreateRequest): Promise<PracticeSessionCreateResponse> {
    const activity = assertPracticeActivity(payload?.activity)
    if (activity === 'reading') {
      const assetId = String(payload.assetId || '').trim()
      if (!assetId) {
        throw createHttpError('invalid_practice_attempt', 'Missing reading practice asset id')
      }
      const readingPayload = await this.assets.getReadingPayload(assetId)
      const attempt = payload.attempt && typeof payload.attempt === 'object' ? payload.attempt : {}
      const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
      const submission = createReadingPracticeSubmission(readingPayload, attempt as Record<string, unknown>, settings as Record<string, unknown>)
      const historyRecord = this.history.saveReadingSubmission(submission)
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
      const submission = this.history.getReadingSubmission(normalizedSessionId)
      if (!submission) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
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
      const submission = this.history.getReadingSubmission(normalizedSessionId)
      if (!submission) {
        throw createHttpError('practice_session_not_found', `Reading session not found: ${normalizedSessionId}`, 404)
      }
      throw createHttpError('practice_session_not_cancellable', 'Submitted reading sessions are persisted history records and cannot be cancelled', 409)
    }
    return this.writingEvaluationService.cancel(normalizedSessionId)
  }

  async createReadingSuite(request: ReadingSuiteCreateRequest = {}): Promise<ReadingSuiteSession> {
    return this.suite.createReadingSuite(request)
  }

  async getReadingSuite(sessionId: string): Promise<ReadingSuiteSession> {
    return this.suite.getReadingSuite(sessionId)
  }

  async submitReadingSuitePassage(
    suiteSessionId: string,
    assetId: string,
    attempt: Record<string, unknown> = {},
    settings: Record<string, unknown> = {}
  ): Promise<ReadingSuiteSubmitResponse> {
    return this.suite.submitReadingSuitePassage(suiteSessionId, assetId, attempt, settings)
  }

  async listHistory(options: ListHistoryOptions = {}) {
    return this.history.listHistory(options)
  }

  async getHistoryRecord(activity: string, recordId: string) {
    return this.history.getHistoryRecord(activity, recordId)
  }

  async deleteHistoryRecord(activity: string, recordId: string) {
    return this.history.deleteHistoryRecord(activity, recordId)
  }

  async clearHistory(options: ListHistoryOptions = {}) {
    return this.history.clearHistory(options)
  }

  async exportHistoryArchive(options: ListHistoryOptions = {}) {
    return this.history.exportHistoryArchive(options)
  }

  async importHistoryArchive(activity: string, payload: unknown) {
    return this.history.importHistoryArchive(activity, payload)
  }

  async coach(
    activity: string,
    payload: Record<string, unknown>,
    onEvent?: (event: Record<string, unknown>) => void,
    sessionId?: string | null,
    options: PracticeCoachOptions = {}
  ) {
    return this.coachFacade.coach(activity, payload, onEvent, sessionId, options)
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
