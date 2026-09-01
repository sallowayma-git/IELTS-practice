import { computed, ref, unref, watch } from 'vue'
import { invokeCommand, unwrapCommandResponse } from '@/api/tauri-bridge.js'

type TimerMode = 'elapsed' | 'countdown'

type TimerState = {
  source: 'local' | 'single' | 'suite' | 'endless'
  anchorMs: number
  effectiveStartTimeMs: number
  mode: TimerMode
  limitSeconds: number | null
  pausedOffsetMs: number
  pausedAtMs: number | null
  running: boolean
}

type ReadingTimerOptions = {
  activeSuiteSessionId?: unknown
  reviewMode?: unknown
  suiteTimerSource?: unknown | (() => unknown)
  onAutoSubmit?: () => void | Promise<void>
}

export function formatClock(seconds: unknown) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function normalizeSuiteTimerState(value: unknown): TimerState | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const anchorMs = Number(input.anchorMs ?? input.effectiveStartTimeMs)
  if (!Number.isFinite(anchorMs) || anchorMs <= 0) return null
  const parsedLimitSeconds = input.limitSeconds == null ? Number.NaN : Number(input.limitSeconds)
  const parsedPausedOffsetMs = input.pausedOffsetMs == null ? 0 : Number(input.pausedOffsetMs)
  const parsedPausedAtMs = input.pausedAtMs == null ? Number.NaN : Number(input.pausedAtMs)
  return {
    source: ['local', 'single', 'suite', 'endless'].includes(String(input.source))
      ? String(input.source) as TimerState['source']
      : 'suite',
    anchorMs: Math.floor(anchorMs),
    effectiveStartTimeMs: Math.floor(anchorMs),
    mode: String(input.mode).toLowerCase() === 'countdown' ? 'countdown' : 'elapsed',
    limitSeconds: Number.isFinite(parsedLimitSeconds) && parsedLimitSeconds >= 0
      ? Math.floor(parsedLimitSeconds)
      : null,
    pausedOffsetMs: Number.isFinite(parsedPausedOffsetMs) && parsedPausedOffsetMs >= 0
      ? Math.floor(parsedPausedOffsetMs)
      : 0,
    pausedAtMs: Number.isFinite(parsedPausedAtMs) && parsedPausedAtMs > 0
      ? Math.floor(parsedPausedAtMs)
      : null,
    running: input.running !== false
  }
}

async function measureTimer(timer: TimerState, nowMs: number) {
  const response = await invokeCommand<number>('timer_elapsed_seconds', { timer, nowMs })
  return Number(unwrapCommandResponse(response, 'timer_elapsed_seconds')) || 0
}

async function shouldAutoSubmit(timer: TimerState, nowMs: number) {
  const response = await invokeCommand<boolean>('timer_should_auto_submit', { timer, nowMs })
  return Boolean(unwrapCommandResponse(response, 'timer_should_auto_submit'))
}

export function useReadingTimer(options: ReadingTimerOptions = {}) {
  const elapsedSeconds = ref(0)
  const timerRunning = ref(false)
  const startedAt = ref('')
  const runtimeTimer = ref<TimerState | null>(null)
  let practiceTimer: number | null = null
  let tickPending = false
  let autoSubmitTriggered = false

  const activeSuiteSessionId = computed(() => String(unref(options.activeSuiteSessionId) || '').trim())
  const reviewMode = computed(() => Boolean(unref(options.reviewMode)))
  const suiteTimerState = computed(() => {
    const source = typeof options.suiteTimerSource === 'function'
      ? options.suiteTimerSource()
      : unref(options.suiteTimerSource)
    return normalizeSuiteTimerState(source)
  })
  const timerDisplaySeconds = computed(() => {
    const timer = runtimeTimer.value ?? suiteTimerState.value
    if (timer?.mode === 'countdown' && timer.limitSeconds != null) {
      return Math.max(0, timer.limitSeconds - Math.max(0, Math.floor(elapsedSeconds.value)))
    }
    return Math.max(0, Math.floor(elapsedSeconds.value))
  })
  const formattedTimer = computed(() => formatClock(timerDisplaySeconds.value))

  function createLocalTimer(anchorMs = Date.now()): TimerState {
    return {
      source: 'local', anchorMs, effectiveStartTimeMs: anchorMs, mode: 'elapsed',
      limitSeconds: null, pausedOffsetMs: 0, pausedAtMs: anchorMs, running: false
    }
  }

  function applySuiteTimerState() {
    const timer = suiteTimerState.value
    if (!activeSuiteSessionId.value || !timer) return
    applyPracticeTimerState(timer)
  }

  function applyPracticeTimerState(value: unknown) {
    const timer = normalizeSuiteTimerState(value)
    if (!timer) return false
    runtimeTimer.value = { ...timer }
    startedAt.value = new Date(timer.anchorMs).toISOString()
    timerRunning.value = timer.running && !reviewMode.value
    void refreshFromRust()
    return true
  }

  function resolveTimerAnchorMs() {
    const parsed = Date.parse(startedAt.value)
    return runtimeTimer.value?.anchorMs || (Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now())
  }

  function getPracticeTimerSnapshot() {
    const nowMs = Date.now()
    const timer = runtimeTimer.value ?? createLocalTimer(resolveTimerAnchorMs())
    const durationSeconds = Math.max(0, Math.floor(elapsedSeconds.value))
    return {
      ...timer,
      running: Boolean(timerRunning.value && !reviewMode.value),
      elapsedSeconds: durationSeconds,
      durationSeconds,
      displaySeconds: timerDisplaySeconds.value,
      effectiveEndTimeMs: Math.max(timer.anchorMs, timer.anchorMs + durationSeconds * 1000),
      actualEndTimeMs: nowMs,
      pausedAtMs: timerRunning.value ? null : (timer.pausedAtMs ?? nowMs)
    }
  }

  function resolvePracticeTiming(minDurationSeconds = 0, timerSnapshot: Record<string, unknown> | null = null) {
    const snapshot = timerSnapshot ?? getPracticeTimerSnapshot()
    const startTimeMs = Math.max(1, Number(snapshot.effectiveStartTimeMs) || resolveTimerAnchorMs())
    const duration = Math.max(minDurationSeconds, Math.floor(Number(snapshot.durationSeconds) || 0))
    const endTimeMs = Math.max(startTimeMs, Number(snapshot.actualEndTimeMs) || Date.now())
    const effectiveEndTimeMs = Math.max(startTimeMs + duration * 1000, Number(snapshot.effectiveEndTimeMs) || 0)
    return { duration, startTimeMs, endTimeMs, effectiveEndTimeMs }
  }

  async function refreshFromRust() {
    const timer = runtimeTimer.value
    if (!timer || tickPending) return
    tickPending = true
    try {
      const nowMs = Date.now()
      const [elapsed, expired] = await Promise.all([
        measureTimer(timer, nowMs),
        shouldAutoSubmit(timer, nowMs)
      ])
      elapsedSeconds.value = elapsed
      if (expired && !autoSubmitTriggered && !reviewMode.value) {
        autoSubmitTriggered = true
        stopPracticeTimer()
        await options.onAutoSubmit?.()
      }
    } finally {
      tickPending = false
    }
  }

  function startPracticeTimer() {
    if (reviewMode.value) return
    if (practiceTimer != null) window.clearInterval(practiceTimer)
    const nowMs = Date.now()
    const timer = runtimeTimer.value ?? createLocalTimer(resolveTimerAnchorMs())
    if (!timer.running) {
      if (timer.pausedAtMs && nowMs > timer.pausedAtMs) timer.pausedOffsetMs += nowMs - timer.pausedAtMs
      timer.pausedAtMs = null
      timer.running = true
    }
    runtimeTimer.value = { ...timer }
    timerRunning.value = true
    void refreshFromRust()
    practiceTimer = window.setInterval(() => void refreshFromRust(), 1000)
  }

  function stopPracticeTimer() {
    if (practiceTimer != null) window.clearInterval(practiceTimer)
    practiceTimer = null
    const timer = runtimeTimer.value
    if (timer?.running) runtimeTimer.value = { ...timer, running: false, pausedAtMs: Date.now() }
    timerRunning.value = false
    void refreshFromRust()
  }

  function toggleTimer() {
    if (reviewMode.value) return
    timerRunning.value ? stopPracticeTimer() : startPracticeTimer()
  }

  function resetPracticeTimerClock(startedAtIso = new Date().toISOString()) {
    if (practiceTimer != null) window.clearInterval(practiceTimer)
    practiceTimer = null
    const anchorMs = Date.parse(startedAtIso) || Date.now()
    runtimeTimer.value = createLocalTimer(anchorMs)
    elapsedSeconds.value = 0
    timerRunning.value = false
    startedAt.value = new Date(anchorMs).toISOString()
    autoSubmitTriggered = false
  }

  function setPracticeTimerElapsedSeconds(seconds: unknown) {
    const elapsed = Math.max(0, Number(seconds) || 0)
    const nowMs = Date.now()
    const timer = runtimeTimer.value ?? createLocalTimer(nowMs - elapsed * 1000)
    timer.anchorMs = nowMs - elapsed * 1000 - timer.pausedOffsetMs
    timer.effectiveStartTimeMs = timer.anchorMs
    runtimeTimer.value = { ...timer }
    elapsedSeconds.value = elapsed
  }

  watch(reviewMode, (isReview) => { if (isReview) stopPracticeTimer() })

  return {
    elapsedSeconds, timerRunning, startedAt, suiteTimerState, timerDisplaySeconds, formattedTimer,
    applySuiteTimerState, applyPracticeTimerState, getPracticeTimerSnapshot, resolvePracticeTiming, startPracticeTimer,
    stopPracticeTimer, toggleTimer, resetPracticeTimerClock, setPracticeTimerElapsedSeconds
  }
}
