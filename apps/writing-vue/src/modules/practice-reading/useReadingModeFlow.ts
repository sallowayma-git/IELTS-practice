import { nextTick, unref, type MaybeRefOrGetter, type Ref } from 'vue'
import type { Router } from 'vue-router'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import {
  cancelEndless as tauriCancelEndless,
  createMemorize as tauriCreateMemorize,
  finishMemorize as tauriFinishMemorize,
  getEndless as tauriGetEndless,
  submitEndless as tauriSubmitEndless,
  submitSuitePassage as tauriSubmitSuitePassage
} from '@/api/modes-repository.js'
import {
  buildEndlessNextRoute,
  buildSuiteReviewNavigationTarget,
  findNextActiveSuitePassage,
  mapTauriSubmissionToUi
} from './readingModeFlowCore.js'

const ENDLESS_COUNTDOWN_SEC = 5

function resolveSource<T>(source: MaybeRefOrGetter<T> | undefined): T | undefined {
  if (typeof source === 'function') {
    return (source as () => T)()
  }
  return unref(source)
}

export interface ReadingModeFlowOptions {
  router: Router
  routeQuerySource?: MaybeRefOrGetter<Record<string, unknown> | undefined>
  assetSource: MaybeRefOrGetter<any>
  submission: Ref<any>
  suiteSession: Ref<any>
  submitting: Ref<boolean>
  leaving: Ref<boolean>
  submitError: Ref<string>
  snapshotMessage: Ref<string>
  endlessCountdown: Ref<number>
  endlessNextAssetId: Ref<string>
  activeMemorizeAttemptId: Ref<string>
  activeSuiteSessionId: MaybeRefOrGetter<string>
  activeEndlessSessionId: MaybeRefOrGetter<string>
  isEndlessMode: MaybeRefOrGetter<boolean>
  isMemorizeMode: MaybeRefOrGetter<boolean>
  reviewMode: MaybeRefOrGetter<boolean>
  canSubmit: MaybeRefOrGetter<boolean>
  canRecycleSubmittedAttempt: MaybeRefOrGetter<boolean>
  readingCoachEnabled: MaybeRefOrGetter<boolean>
  suiteAutoAdvance: MaybeRefOrGetter<boolean>
  suiteSequence: MaybeRefOrGetter<any[]>
  currentSuitePassageIndex: MaybeRefOrGetter<number>
  returnRoute: MaybeRefOrGetter<any>
  getAttemptId: () => string
  setAttemptId: (id: string) => void
  newAttemptId: () => string
  submitSingleAttempt: (input: Record<string, unknown>) => Promise<{ submission: any }>
  snapshotAnswerMap: () => Record<string, unknown>
  markedQuestions: MaybeRefOrGetter<string[]>
  interactionCount: MaybeRefOrGetter<number>
  snapshotHighlights: () => unknown[]
  highlightSnapshot: MaybeRefOrGetter<unknown[]>
  buildQuestionTimelineLite: () => any[]
  buildPersistedQuestionTimeline: (timeline?: any[]) => any[]
  getPracticeTimerSnapshot: () => unknown
  resolvePracticeTiming: (factor: number, timerSnapshot: unknown) => {
    startTimeMs: number
    endTimeMs: number
    effectiveEndTimeMs: number
    duration: number
  }
  getCurrentScrollY: () => number
  flushActiveQuestionVisit: () => void
  stopPracticeTimer: () => void
  startPracticeTimer: () => void
  setPracticeTimerElapsedSeconds: (seconds: number) => void
  assignAnswer: (questionId: string, value: unknown) => void
  syncDomAnswers: () => void
  setReadOnlyDomControls: (readonly: boolean) => void
  restoreHighlightsFromRecords: (records?: unknown[]) => void
  setReadingCoachOpen: (open: boolean) => void
  runAutomaticReviewCoach: (options: { expectedSessionId?: string }) => Promise<unknown>
  resetAnswers?: () => void
  recycleSubmittedAttempt?: () => void | Promise<void>
}

export function useReadingModeFlow(options: ReadingModeFlowOptions) {
  let endlessTimer: number | null = null
  let memorizeFinishRequested = false

  function asset() {
    return resolveSource(options.assetSource)
  }

  function activeSuiteSessionId() {
    return String(resolveSource(options.activeSuiteSessionId) || '').trim()
  }

  function activeEndlessSessionId() {
    return String(resolveSource(options.activeEndlessSessionId) || '').trim()
  }

  function isEndlessMode() {
    return Boolean(resolveSource(options.isEndlessMode))
  }

  function isMemorizeMode() {
    return Boolean(resolveSource(options.isMemorizeMode))
  }

  function reviewMode() {
    return Boolean(resolveSource(options.reviewMode))
  }

  function canSubmit() {
    return Boolean(resolveSource(options.canSubmit))
  }

  function clearEndlessTimer() {
    if (endlessTimer != null) {
      window.clearInterval(endlessTimer)
      endlessTimer = null
    }
    options.endlessCountdown.value = 0
  }

  function goToNextEndlessAsset() {
    if (options.leaving.value) return
    const route = buildEndlessNextRoute(options.endlessNextAssetId.value, activeEndlessSessionId())
    if (!route) return
    clearEndlessTimer()
    options.router.push(route)
  }

  async function handleLeave() {
    if (options.leaving.value) return false
    options.leaving.value = true
    try {
      if (isEndlessMode()) {
        // Stop the local timer first: it must not route to the next asset while
        // Rust is still deciding whether the authoritative session was cancelled.
        clearEndlessTimer()
        const sessionId = activeEndlessSessionId()
        if (sessionId && isTauriRuntime()) {
          try {
            await tauriCancelEndless(sessionId)
          } catch (error) {
            console.warn('cancel endless session failed', error)
            options.submitError.value = '无尽模式退出失败，当前练习仍保留；请重试。'
            return false
          }
        }
        options.endlessNextAssetId.value = ''
      }

      if (isMemorizeMode()) {
        const finished = await finishActiveMemorizeSession()
        if (!finished) {
          options.submitError.value = '背题模式退出失败，当前学习仍保留；请重试。'
          return false
        }
      }

      await options.router.push(resolveSource(options.returnRoute))
      return true
    } catch (error) {
      console.error('leave reading mode failed', error)
      options.submitError.value = '退出阅读失败，请重试。'
      return false
    } finally {
      options.leaving.value = false
    }
  }

  async function stopEndlessMode() {
    return handleLeave()
  }

  async function reconcileEndlessRoute() {
    if (!isEndlessMode() || activeSuiteSessionId() || !isTauriRuntime()) {
      return true
    }
    const sessionId = activeEndlessSessionId()
    const currentAssetId = String(asset()?.id || '').trim()
    if (!sessionId || !currentAssetId) {
      options.submitError.value = '无尽模式会话或题目缺失，无法继续。'
      return false
    }
    const { session } = await tauriGetEndless(sessionId)
    const authoritativeAssetId = String(session?.currentAssetId || '').trim()
    if (!authoritativeAssetId) {
      await stopEndlessMode()
      return false
    }
    if (authoritativeAssetId === currentAssetId) {
      return true
    }
    const route = buildEndlessNextRoute(authoritativeAssetId, sessionId)
    if (!route) {
      options.submitError.value = '无尽模式下一题无效，无法继续。'
      return false
    }
    await options.router.replace(route)
    return false
  }

  async function scheduleEndlessNext(preferredNextId: string | null = null) {
    if (!isEndlessMode() || activeSuiteSessionId()) {
      return
    }
    try {
      let nextId = String(preferredNextId || '').trim()
      if (!nextId && activeEndlessSessionId() && isTauriRuntime()) {
        try {
          const { session } = await tauriGetEndless(activeEndlessSessionId())
          nextId = String(session?.currentAssetId || '').trim()
        } catch (err) {
          console.warn('load endless session failed', err)
        }
      }
      if (!nextId) {
        const stopped = await stopEndlessMode()
        if (stopped) {
          options.submitError.value = '无尽模式：题库已刷完或为空，已退出。'
        }
        return
      }
      options.endlessNextAssetId.value = nextId
      clearEndlessTimer()
      options.endlessCountdown.value = ENDLESS_COUNTDOWN_SEC
      endlessTimer = window.setInterval(() => {
        options.endlessCountdown.value -= 1
        if (options.endlessCountdown.value <= 0) {
          goToNextEndlessAsset()
        }
      }, 1000)
    } catch (error: any) {
      console.error('无尽模式续题失败:', error)
      options.submitError.value = error?.message
        ? `无尽模式续题失败：${error.message}`
        : '无尽模式续题失败，请返回总览重试'
    }
  }

  function findNextSuitePassage() {
    return findNextActiveSuitePassage(
      resolveSource(options.suiteSession)?.sequence,
      asset()?.id
    )
  }

  function findSuiteReviewNavigationTarget(direction: 'prev' | 'next') {
    return buildSuiteReviewNavigationTarget({
      direction,
      currentIndex: Number(resolveSource(options.currentSuitePassageIndex) || 0),
      sequence: resolveSource(options.suiteSequence) || [],
      suiteSessionId: activeSuiteSessionId()
    })
  }

  function navigateSuiteReview(direction: 'prev' | 'next') {
    const target = findSuiteReviewNavigationTarget(direction)
    if (target) {
      options.router.push(target)
    }
  }

  function maybeAdvanceSuitePassage() {
    if (!activeSuiteSessionId() || !resolveSource(options.suiteAutoAdvance)) {
      return
    }
    const nextPassage = findNextSuitePassage()
    if (!nextPassage?.assetId) {
      return
    }
    options.router.push({
      name: 'PracticeReading',
      params: { assetId: nextPassage.assetId },
      query: { suiteSessionId: activeSuiteSessionId() }
    })
  }

  function snapshotSubmission() {
    // Submission truth lives in SQLite via reading session APIs; no Web Storage mirror.
  }

  function clearSubmissionSnapshot() {
    // No-op: sessionStorage submission cache removed.
  }

  async function submitAnswers() {
    if (!canSubmit()) {
      return
    }
    options.submitting.value = true
    options.submitError.value = ''
    options.snapshotMessage.value = ''
    options.flushActiveQuestionVisit()
    options.stopPracticeTimer()
    try {
      const currentAsset = asset()
      const timerSnapshot = options.getPracticeTimerSnapshot()
      const timing = options.resolvePracticeTiming(1, timerSnapshot)
      const endTime = new Date(timing.endTimeMs).toISOString()
      const effectiveEndTime = new Date(timing.effectiveEndTimeMs).toISOString()
      const durationSec = timing.duration
      const answers = options.snapshotAnswerMap()
      const markedQuestions = [...(resolveSource(options.markedQuestions) || [])]
      const questionTimelineLite = options.buildQuestionTimelineLite()
      const attempt = {
        answers,
        markedQuestions,
        highlights: options.snapshotHighlights(),
        questionTimelineLite,
        interactionCount: Number(resolveSource(options.interactionCount) || 0),
        startTime: new Date(timing.startTimeMs).toISOString(),
        endTime,
        durationSec,
        timerSnapshot,
        effectiveEndTime,
        effectiveEndTimeMs: timing.effectiveEndTimeMs,
        scrollY: options.getCurrentScrollY()
      }
      let result: any = null
      if (isTauriRuntime() && activeSuiteSessionId()) {
        const suiteResult = await tauriSubmitSuitePassage({
          suiteId: activeSuiteSessionId(),
          assetId: currentAsset.id,
          assetRevision: currentAsset.schemaVersion ?? null,
          assetFingerprint: currentAsset.fingerprint || null,
          answers: attempt.answers,
          markedQuestions: attempt.markedQuestions,
          questionTimeline: options.buildPersistedQuestionTimeline(attempt.questionTimelineLite),
          durationMs: Math.round((durationSec || 0) * 1000),
          titleSnapshot: currentAsset.title || currentAsset.name || null,
          timerSnapshot: attempt.timerSnapshot || null
        })
        const rawSub = suiteResult.result && suiteResult.result.submission
        result = {
          submission: mapTauriSubmissionToUi(rawSub, {
            assetId: currentAsset.id,
            answers: attempt.answers,
            markedQuestions: attempt.markedQuestions,
            durationSec,
            source: 'tauri'
          }),
          suiteSession: (suiteResult.result && suiteResult.result.suiteSession) || null
        }
      } else if (isTauriRuntime() && isEndlessMode() && activeEndlessSessionId()) {
        const endlessResult = await tauriSubmitEndless({
          sessionId: activeEndlessSessionId(),
          assetId: currentAsset.id,
          assetRevision: currentAsset.schemaVersion ?? null,
          assetFingerprint: currentAsset.fingerprint || null,
          answers: attempt.answers,
          markedQuestions: attempt.markedQuestions,
          questionTimeline: options.buildPersistedQuestionTimeline(attempt.questionTimelineLite),
          durationMs: Math.round((durationSec || 0) * 1000),
          titleSnapshot: currentAsset.title || currentAsset.name || null,
          timerSnapshot: attempt.timerSnapshot || null
        })
        const rawSub = endlessResult.result && endlessResult.result.submission
        const nextId = endlessResult.result?.nextAssetId
          || endlessResult.result?.session?.currentAssetId
          || null
        result = {
          submission: mapTauriSubmissionToUi(rawSub, {
            assetId: currentAsset.id,
            answers: attempt.answers,
            markedQuestions: attempt.markedQuestions,
            durationSec,
            source: 'tauri-endless'
          }),
          endlessSession: endlessResult.result?.session || null,
          nextEndlessAssetId: nextId
        }
      } else if (isTauriRuntime()) {
        let attemptId = options.getAttemptId()
        if (!attemptId) {
          attemptId = options.newAttemptId()
          options.setAttemptId(attemptId)
        }
        const tauriResult = await options.submitSingleAttempt({
          attemptId,
          assetId: currentAsset.id,
          assetRevision: currentAsset.schemaVersion ?? null,
          assetFingerprint: currentAsset.fingerprint || null,
          answers: attempt.answers,
          markedQuestions: attempt.markedQuestions,
          questionTimeline: options.buildPersistedQuestionTimeline(attempt.questionTimelineLite),
          durationMs: Math.round((durationSec || 0) * 1000),
          titleSnapshot: currentAsset.title || currentAsset.name || null
        })
        result = { submission: tauriResult.submission }
      } else {
        throw new Error('reading submission requires the Tauri runtime')
      }
      options.submission.value = result?.submission || null
      options.setReadingCoachOpen(Boolean(options.submission.value && resolveSource(options.readingCoachEnabled)))
      options.suiteSession.value = result?.suiteSession || options.suiteSession.value
      if (options.submission.value?.answers) {
        Object.entries(options.submission.value.answers).forEach(([questionId, value]) => {
          options.assignAnswer(questionId, value)
        })
      }
      await nextTick()
      options.syncDomAnswers()
      options.setReadOnlyDomControls(true)
      options.restoreHighlightsFromRecords(
        options.submission.value?.highlights
        || options.submission.value?.analysisArtifacts?.highlights
        || resolveSource(options.highlightSnapshot)
        || []
      )
      options.setPracticeTimerElapsedSeconds(Math.max(durationSec, Number(options.submission.value?.duration || 0)))
      snapshotSubmission()
      if (resolveSource(options.readingCoachEnabled)) {
        await options.runAutomaticReviewCoach({ expectedSessionId: options.submission.value?.sessionId })
      }
      maybeAdvanceSuitePassage()
      await scheduleEndlessNext(result?.nextEndlessAssetId || null)
    } catch (submitFailure: any) {
      console.error('提交阅读练习失败:', submitFailure)
      options.submitError.value = submitFailure?.message
        ? `阅读提交失败：${submitFailure.message}`
        : '阅读提交失败，请稍后重试'
      if (!reviewMode()) {
        options.startPracticeTimer()
      }
    } finally {
      options.submitting.value = false
    }
  }

  async function ensureMemorizeSession() {
    const currentAsset = asset()
    if (!isMemorizeMode() || options.activeMemorizeAttemptId.value || !currentAsset?.id || !isTauriRuntime()) {
      return
    }
    const { session } = await tauriCreateMemorize({
      assetId: String(currentAsset.id),
      titleSnapshot: currentAsset.title || null
    })
    const attemptId = String(session?.attempt?.id || '').trim()
    if (!attemptId) throw new Error('memorize session missing attempt id')
    options.activeMemorizeAttemptId.value = attemptId
    const querySource = resolveSource(options.routeQuerySource) || {}
    await options.router.replace({
      name: 'PracticeReading',
      params: { assetId: currentAsset.id },
      query: {
        ...querySource,
        mode: 'memorize',
        practiceMode: 'memorize',
        memorizeAttemptId: attemptId
      }
    })
  }

  async function finishActiveMemorizeSession() {
    const attemptId = options.activeMemorizeAttemptId.value
    if (!attemptId || !isTauriRuntime()) return true
    if (memorizeFinishRequested) return false
    memorizeFinishRequested = true
    try {
      await tauriFinishMemorize(attemptId)
      return true
    } catch (error) {
      memorizeFinishRequested = false
      console.warn('finish memorize session failed', error)
      return false
    }
  }

  async function handleResetButton() {
    if (isMemorizeMode()) {
      const finished = await finishActiveMemorizeSession()
      if (!finished) {
        options.submitError.value = '背题模式退出失败，当前学习仍保留；请重试。'
        return
      }
      options.router.push({
        name: 'PracticeReading',
        params: { assetId: asset()?.id },
        query: activeSuiteSessionId() ? { suiteSessionId: activeSuiteSessionId() } : {}
      })
      return
    }
    if (resolveSource(options.canRecycleSubmittedAttempt)) {
      await options.recycleSubmittedAttempt?.()
      return
    }
    options.resetAnswers?.()
    options.restoreHighlightsFromRecords(resolveSource(options.highlightSnapshot) || [])
  }

  async function handlePrimaryButton() {
    if (isMemorizeMode()) {
      await handleLeave()
      return
    }
    await submitAnswers()
  }

  return {
    clearEndlessTimer,
    scheduleEndlessNext,
    findNextSuitePassage,
    findSuiteReviewNavigationTarget,
    navigateSuiteReview,
    maybeAdvanceSuitePassage,
    goToNextEndlessAsset,
    stopEndlessMode,
    handleLeave,
    reconcileEndlessRoute,
    snapshotSubmission,
    clearSubmissionSnapshot,
    submitAnswers,
    ensureMemorizeSession,
    finishActiveMemorizeSession,
    handleResetButton,
    handlePrimaryButton
  }
}

export default useReadingModeFlow
