import { onMounted, ref } from 'vue'
import { listSettings, upsertSetting } from '@/api/settings-repository.js'

// Small synchronous cache over the async SQLite settings repository. Callers can
// keep their existing setup-time defaults while the persisted values hydrate.
const cache = new Map()
let hydrated = false
let hydrationPromise

function ensureHydrated() {
  if (hydrated) return
  if (!hydrationPromise) {
    hydrationPromise = listSettings('frontend-preferences')
      .then(({ items }) => {
        for (const item of items || []) {
          if (item?.key) cache.set(item.key, item.value)
        }
        hydrated = true
      })
      .catch((error) => {
        hydrationPromise = undefined
        throw error
      })
  }
  return hydrationPromise
}

async function hydrate() {
  try {
    await ensureHydrated()
  } catch {
    // Ordinary controls may keep their setup defaults. Data migrations use
    // hydrateStrict so they never mistake a failed read for an empty database.
  }
}

async function hydrateStrict() {
  await ensureHydrated()
}

export function useTauriPreferences() {
  const ready = ref(hydrated)

  onMounted(async () => {
    await hydrate()
    ready.value = true
  })

  function get(key, fallback = '') {
    return cache.has(key) ? cache.get(key) : fallback
  }

  function set(key, value) {
    const hadPrevious = cache.has(key)
    const previous = cache.get(key)
    cache.set(key, value)
    void upsertSetting('frontend-preferences', key, value).catch(() => {
      if (hadPrevious) cache.set(key, previous)
      else cache.delete(key)
    })
  }

  async function setDurable(key, value) {
    await upsertSetting('frontend-preferences', key, value)
    cache.set(key, value)
  }

  return { ready, get, set, setDurable, hydrate, hydrateStrict }
}

export default useTauriPreferences
