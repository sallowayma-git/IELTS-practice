import type { ServiceBundle } from '../../../types/api.js'
import { createHttpError } from '../../shared/http.js'
import type {
  ReadingSuiteCreateRequest,
  ReadingSuiteSession,
  ReadingSuiteSubmitResponse
} from '../contracts.js'
import { ReadingSuiteSessionStore } from '../reading-suite-store.js'
import {
  createReadingSuiteSession,
  submitReadingSuitePassage as submitReadingSuitePassageAttempt
} from '../reading-suite-sessions.js'
import type { PracticeAssetFacade } from '../assets/PracticeAssetFacade.js'
import type { PracticeHistoryFacade } from '../history/PracticeHistoryFacade.js'

export class ReadingSuiteFacade {
  private readonly assets: PracticeAssetFacade
  private readonly history: PracticeHistoryFacade
  private readonly readingSuiteStore: ReadingSuiteSessionStore

  constructor(
    services: ServiceBundle,
    assets: PracticeAssetFacade,
    history: PracticeHistoryFacade
  ) {
    this.assets = assets
    this.history = history
    this.readingSuiteStore = new ReadingSuiteSessionStore(services.db)
  }

  async createReadingSuite(request: ReadingSuiteCreateRequest = {}): Promise<ReadingSuiteSession> {
    const session = createReadingSuiteSession(await this.assets.listReadingAssets(), request)
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
    const readingPayload = await this.assets.getReadingPayload(normalizedAssetId)
    const result = submitReadingSuitePassageAttempt(session, readingPayload, attempt, settings)
    const historyRecord = this.history.saveReadingSubmission(result.submission)
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
}
