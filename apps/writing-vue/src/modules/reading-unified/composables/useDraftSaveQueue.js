import { ref } from 'vue'

export function useDraftSaveQueue(write, delay = 800) {
  const error = ref('')
  const saving = ref(false)
  let version = 0
  let saved = 0
  let generation = 0
  let timer
  let inFlight

  function clearTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  function flush() {
    clearTimer()
    if (inFlight) return inFlight
    if (saved === version) return Promise.resolve(true)
    saving.value = true
    inFlight = Promise.resolve().then(async () => {
      while (saved !== version) {
        const target = version
        const current = generation
        try {
          await write()
        } catch (failure) {
          if (current !== generation) continue
          error.value = failure?.message || String(failure) || '请稍后重试'
          return false
        }
        if (current === generation) {
          saved = target
          error.value = ''
        }
      }
      return true
    }).finally(() => {
      inFlight = undefined
      saving.value = false
      if (saved !== version && !error.value && timer == null) timer = setTimeout(flush, delay)
    })
    return inFlight
  }

  function schedule() {
    version++
    // Keep a deadline even when playback sends position updates continuously.
    if (timer == null && !inFlight) timer = setTimeout(flush, delay)
  }

  function save() {
    version++
    return flush()
  }

  function reset() {
    clearTimer()
    generation++
    saved = version
    error.value = ''
  }

  return { error, saving, schedule, save, flush, reset }
}
