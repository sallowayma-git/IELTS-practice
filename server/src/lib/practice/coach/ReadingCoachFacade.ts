import type { ServiceBundle } from '../../../types/api.js'
import { isPersistentReviewCoachRequest } from '../../reading/router.js'
import { ReadingAssistantService } from '../../reading/service.js'
import { createHttpError } from '../../shared/http.js'
import {
  assertPracticeActivity,
  normalizeReadingCoachEnabled,
  READING_COACH_ENABLED_SETTING_KEY
} from '../contracts.js'
import type { PracticeHistoryFacade } from '../history/PracticeHistoryFacade.js'

export interface PracticeCoachOptions {
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

export class ReadingCoachFacade {
  private readonly readingAssistantService: ReadingAssistantService
  private readonly history: PracticeHistoryFacade
  private readonly settingsService: ServiceBundle['settingsService']

  constructor(services: ServiceBundle, history: PracticeHistoryFacade) {
    this.readingAssistantService = new ReadingAssistantService(services)
    this.history = history
    this.settingsService = services.settingsService
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
    await this.assertReadingCoachEnabled()
    const normalizedSessionId = String(sessionId || '').trim()
    const requirePersistedReviewSession = options.requirePersistedReviewSession !== false
    const coachPayload = this.withReadingSessionContext(payload, normalizedSessionId, { requirePersistedReviewSession }) as any
    let result
    try {
      result = await this.readingAssistantService.query(coachPayload, onEvent)
    } catch (error) {
      if (normalizedSessionId) {
        this.history.attachReadingCoachFailure(normalizedSessionId, error, coachPayload)
      }
      throw error
    }
    if (normalizedSessionId) {
      const updatedRecord = this.history.attachReadingCoachResult(normalizedSessionId, result, coachPayload)
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

  private async assertReadingCoachEnabled() {
    if (await this.isReadingCoachEnabled()) {
      return
    }
    throw createHttpError('practice_coach_disabled', 'Reading AI Coach is disabled by settings', 403, {
      settingKey: READING_COACH_ENABLED_SETTING_KEY,
      enabled: false
    })
  }

  private async isReadingCoachEnabled(): Promise<boolean> {
    if (!this.settingsService || typeof this.settingsService.get !== 'function') {
      return true
    }
    try {
      const value = await this.settingsService.get(READING_COACH_ENABLED_SETTING_KEY)
      return normalizeReadingCoachEnabled(value, true)
    } catch {
      return true
    }
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
    const submission = this.history.getReadingSubmission(normalizedSessionId)
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
}
