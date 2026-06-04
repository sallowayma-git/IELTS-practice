import type { ServiceBundle } from '../../../types/api.js'
import { createHttpError } from '../../shared/http.js'
import {
  assertPracticeActivity,
  type PracticeHistorySummary,
  type ReadingPracticePayload,
  type ReadingPracticeSubmission
} from '../contracts.js'
import { PracticeHistoryStore } from '../practice-history.js'
import {
  canonicalArchivePayloadWithoutLegacyRecords,
  collectLegacyPracticeRecords,
  LegacyReadingHistoryAdapter,
  mergeReadingImportResults
} from './LegacyReadingHistoryAdapter.js'

export interface ListHistoryOptions {
  activity?: string | null
  page?: number
  limit?: number
}

export class PracticeHistoryFacade {
  private readonly historyStore: PracticeHistoryStore
  private readonly legacyReadingAdapter: LegacyReadingHistoryAdapter

  constructor(
    services: ServiceBundle,
    options: {
      getReadingPayload: (assetId: string) => Promise<ReadingPracticePayload>
    }
  ) {
    this.historyStore = new PracticeHistoryStore(services.db)
    this.legacyReadingAdapter = new LegacyReadingHistoryAdapter({
      getReadingPayload: options.getReadingPayload,
      saveReadingSubmission: (submission) => this.saveReadingSubmission(submission)
    })
  }

  saveReadingSubmission(submission: ReadingPracticeSubmission): PracticeHistorySummary {
    return this.historyStore.saveReadingSubmission(submission)
  }

  getReadingSubmission(sessionId: string): ReadingPracticeSubmission | null {
    return this.historyStore.getReadingSubmission(sessionId)
  }

  getBySession(activity: string, sessionId: string) {
    return this.historyStore.getBySession(assertPracticeActivity(activity), sessionId)
  }

  attachReadingCoachFailure(sessionId: string, error: unknown, payload: Record<string, unknown>) {
    return this.historyStore.attachReadingCoachFailure(sessionId, error, payload)
  }

  attachReadingCoachResult(sessionId: string, result: unknown, payload: Record<string, unknown>) {
    return this.historyStore.attachReadingCoachResult(sessionId, result, payload)
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
    const legacyResult = await this.legacyReadingAdapter.importRecords(collectLegacyPracticeRecords(payload))
    return mergeReadingImportResults(canonicalResult, legacyResult)
  }
}
