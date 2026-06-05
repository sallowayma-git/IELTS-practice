import { computed, ref, unref, watch } from 'vue'
import {
  emitPracticeTimerStateChange,
  installPracticeTimerBridge,
  removePracticeTimerBridge
} from '../legacy/legacyBridge'

export function formatClock(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const rest = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function normalizeSuiteTimerState(value) {
  if (!value || typeof value !== 'object') {
    return null
  }
  const anchorMs = Number(value.anchorMs ?? value.effectiveStartTimeMs)
  if (!Number.isFinite(anchorMs) || anchorMs <= 0) {
    return null
  }
  const mode = String(value.mode || '').trim().toLowerCase() === 'countdown' ? 'countdown' : 'elapsed'
  const limitSeconds = value.limitSeconds == null ? null : Number(value.limitSeconds)
  const pausedOffsetMs = value.pausedOffsetMs == null ? null : Number(value.pausedOffsetMs)
  const pausedAtMs = value.pausedAtMs == null ? null : Number(value.pausedAtMs)
  return {
    source: 'suite',
    anchorMs: Math.floor(anchorMs),
    effectiveStartTimeMs: Math.floor(anchorMs),
    mode,
    limitSeconds: Number.isFinite(limitSeconds) && limitSeconds >= 0 ? Math.floor(limitSeconds) : null,
    pausedOffsetMs: Number.isFinite(pausedOffsetMs) && pausedOffsetMs >= 0 ? Math.floor(pausedOffsetMs) : 0,
    pausedAtMs: Number.isFinite(pausedAtMs) && pausedAtMs > 0 ? Math.floor(pausedAtMs) : null,
    running: value.running !== false
  }
}

export function useReadingTimer(options = {}) {
  const elapsedSeconds = ref(0)
  const timerRunning = ref(false)
  const startedAt = ref('')
  let practiceTimer = null
  let practiceTimerBridgeOwner = null

  const activeSuiteSessionId = computed(() => String(unref(options.activeSuiteSessionId) || '').trim())
  const reviewMode = computed(() => Boolean(unref(options.reviewMode)))
  const suiteTimerState = computed(() => {
    const source = typeof options.suiteTimerSource === 'function'
      ? options.suiteTimerSource()
      : unref(options.suiteTimerSource)
    return normalizeSuiteTimerState(source)
  })
  const timerDisplaySeconds = computed(() => {
    const timer = suiteTimerState.value
    if (timer?.mode === 'countdown' && Number.isFinite(Number(timer.limitSeconds))) {
      return Math.max(0, Math.floor(Number(timer.limitSeconds)) - Math.max(0, Math.round(Number(elapsedSeconds.value) || 0)))
    }
    return Math.max(0, Math.round(Number(elapsedSeconds.value) || 0))
  })
  const formattedTimer = computed(() => formatClock(timerDisplaySeconds.value))

  function resolveSuiteElapsedSeconds(referenceMs = Date.now()) {
    const timer = suiteTimerState.value
    if (!activeSuiteSessionId.value || !timer) {
      return null
    }
    let elapsedMs = Math.max(0, referenceMs - timer.anchorMs - timer.pausedOffsetMs)
    if (!timer.running && timer.pausedAtMs && referenceMs > timer.pausedAtMs) {
      elapsedMs = Math.max(0, elapsedMs - (referenceMs - timer.pausedAtMs))
    }
    return Math.max(0, Math.floor(elapsedMs / 1000))
  }

  function applySuiteTimerState() {
    const timer = suiteTimerState.value
    if (!activeSuiteSessionId.value || !timer) {
      return
    }
    startedAt.value = new Date(timer.anchorMs).toISOString()
    elapsedSeconds.value = resolveSuiteElapsedSeconds(Date.now()) ?? elapsedSeconds.value
  }

  function resolveTimerAnchorMs() {
    const suiteTimer = suiteTimerState.value
    if (activeSuiteSessionId.value && suiteTimer?.anchorMs) {
      return suiteTimer.anchorMs
    }
    const parsed = Date.parse(startedAt.value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : Date.now()
  }

  function getPracticeTimerSnapshot() {
    const nowMs = Date.now()
    const durationSeconds = Math.max(0, Math.round(Number(elapsedSeconds.value) || 0))
    const effectiveStartTimeMs = Math.max(0, resolveTimerAnchorMs())
    const elapsedMs = durationSeconds * 1000
    const effectiveEndTimeMs = Math.max(effectiveStartTimeMs, effectiveStartTimeMs + elapsedMs)
    const pausedOffsetMs = Math.max(0, nowMs - effectiveStartTimeMs - elapsedMs)
    const running = Boolean(timerRunning.value && !reviewMode.value)
    const suiteTimer = activeSuiteSessionId.value ? suiteTimerState.value : null
    return {
      running,
      elapsedSeconds: durationSeconds,
      durationSeconds,
      displaySeconds: timerDisplaySeconds.value,
      effectiveStartTimeMs,
      effectiveEndTimeMs,
      anchorMs: effectiveStartTimeMs,
      mode: suiteTimer?.mode || 'elapsed',
      limitSeconds: suiteTimer?.limitSeconds ?? null,
      source: activeSuiteSessionId.value ? 'suite' : 'local',
      actualEndTimeMs: nowMs,
      pausedAtMs: running ? null : nowMs,
      pausedOffsetMs
    }
  }

  function resolvePracticeTiming(minDurationSeconds = 0, timerSnapshot = null) {
    const snapshot = timerSnapshot && typeof timerSnapshot === 'object'
      ? timerSnapshot
      : getPracticeTimerSnapshot()
    const startTimeMsRaw = Number(snapshot.effectiveStartTimeMs)
    const durationRaw = Number(snapshot.durationSeconds ?? snapshot.elapsedSeconds ?? elapsedSeconds.value)
    const actualEndTimeMsRaw = Number(snapshot.actualEndTimeMs)
    const effectiveEndTimeMsRaw = Number(snapshot.effectiveEndTimeMs)
    const startTimeMs = Number.isFinite(startTimeMsRaw) && startTimeMsRaw > 0
      ? Math.floor(startTimeMsRaw)
      : resolveTimerAnchorMs()
    const duration = Math.max(minDurationSeconds, Math.round(Number.isFinite(durationRaw) ? durationRaw : 0))
    const endTimeMs = Number.isFinite(actualEndTimeMsRaw) && actualEndTimeMsRaw > 0
      ? Math.floor(actualEndTimeMsRaw)
      : Date.now()
    const effectiveEndTimeMs = Number.isFinite(effectiveEndTimeMsRaw) && effectiveEndTimeMsRaw > 0
      ? Math.max(startTimeMs, startTimeMs + duration * 1000, Math.floor(effectiveEndTimeMsRaw))
      : Math.max(startTimeMs, startTimeMs + duration * 1000)
    return {
      duration,
      startTimeMs,
      endTimeMs,
      effectiveEndTimeMs
    }
  }

  function notifyPracticeTimerStateChange() {
    if (!practiceTimerBridgeOwner) {
      return
    }
    emitPracticeTimerStateChange(getPracticeTimerSnapshot)
  }

  function installTimerBridge() {
    practiceTimerBridgeOwner = installPracticeTimerBridge({
      getSnapshot: getPracticeTimerSnapshot,
      pause: () => stopPracticeTimer(),
      resume: () => {
        if (!reviewMode.value) {
          startPracticeTimer()
        }
      },
      setRunning: (nextRunning) => {
        if (nextRunning === false) {
          stopPracticeTimer()
        } else if (!reviewMode.value) {
          startPracticeTimer()
        }
      }
    })
  }

  function removeTimerBridge() {
    if (!practiceTimerBridgeOwner) {
      return
    }
    removePracticeTimerBridge(practiceTimerBridgeOwner)
    practiceTimerBridgeOwner = null
  }

  function startPracticeTimer() {
    stopPracticeTimer()
    timerRunning.value = true
    practiceTimer = window.setInterval(() => {
      elapsedSeconds.value += 1
    }, 1000)
    notifyPracticeTimerStateChange()
  }

  function stopPracticeTimer() {
    if (practiceTimer) {
      window.clearInterval(practiceTimer)
      practiceTimer = null
    }
    timerRunning.value = false
    notifyPracticeTimerStateChange()
  }

  function toggleTimer() {
    if (reviewMode.value) {
      return
    }
    if (timerRunning.value) {
      stopPracticeTimer()
    } else {
      startPracticeTimer()
    }
  }

  function resetPracticeTimerClock(startedAtIso = new Date().toISOString()) {
    stopPracticeTimer()
    elapsedSeconds.value = 0
    timerRunning.value = false
    startedAt.value = startedAtIso
    notifyPracticeTimerStateChange()
  }

  function setPracticeTimerElapsedSeconds(seconds) {
    elapsedSeconds.value = Math.max(0, Number(seconds) || 0)
    notifyPracticeTimerStateChange()
  }

  watch(() => [
    elapsedSeconds.value,
    timerRunning.value,
    startedAt.value,
    activeSuiteSessionId.value,
    suiteTimerState.value?.mode,
    suiteTimerState.value?.limitSeconds
  ], () => {
    notifyPracticeTimerStateChange()
  })

  return {
    elapsedSeconds,
    timerRunning,
    startedAt,
    suiteTimerState,
    timerDisplaySeconds,
    formattedTimer,
    applySuiteTimerState,
    getPracticeTimerSnapshot,
    resolvePracticeTiming,
    installPracticeTimerBridge: installTimerBridge,
    removePracticeTimerBridge: removeTimerBridge,
    startPracticeTimer,
    stopPracticeTimer,
    toggleTimer,
    resetPracticeTimerClock,
    setPracticeTimerElapsedSeconds
  }
}
