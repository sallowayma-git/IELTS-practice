/**
 * Display preferences for the unified reading page — mirrors the opensource
 * page's Options panel state (font size 4 steps, light/dark background,
 * annotation visibility, question-nav visibility). Persisted via the shared
 * Tauri preferences store under runified_* keys; deliberately separate from
 * the frozen PracticeReadingPage preference set.
 */
import { computed, ref, watch } from 'vue'
import { useTauriPreferences } from '@/composables/useTauriPreferences.js'

const FONT_KEY = 'runified_font_size'
const DARK_KEY = 'runified_dark_mode'
const ANNOTATIONS_KEY = 'runified_annotations'
const NAV_KEY = 'runified_question_nav'

export const unifiedFontSizes = ['small', 'normal', 'large', 'xlarge']

function isFontSize(value) {
  return unifiedFontSizes.includes(value)
}

function parseAnnotations(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  return {
    locators: value.locators !== false,
    notes: value.notes !== false,
    highlights: value.highlights !== false
  }
}

export function useUnifiedDisplay() {
  const preferences = useTauriPreferences()
  const fontSize = ref('normal')
  const darkMode = ref(false)
  const annotations = ref({ locators: true, notes: true, highlights: true })
  const questionNavCollapsed = ref(false)
  let hydrated = false

  const rootClassList = computed(() => ({
    'dark-mode': darkMode.value,
    [`font-${fontSize.value}`]: true,
    'hide-reading-locators': !annotations.value.locators,
    'hide-reading-notes': !annotations.value.notes,
    'hide-reading-highlights': !annotations.value.highlights,
    'reading-question-nav-collapsed': questionNavCollapsed.value
  }))

  async function initializeDisplayPreferences() {
    await preferences.hydrateStrict()
    const storedFont = preferences.get(FONT_KEY, '')
    if (isFontSize(storedFont)) fontSize.value = storedFont
    darkMode.value = preferences.get(DARK_KEY, 'false') === 'true'
    annotations.value = parseAnnotations(preferences.get(ANNOTATIONS_KEY, null)) || annotations.value
    questionNavCollapsed.value = preferences.get(NAV_KEY, 'false') === 'true'
    hydrated = true
  }

  watch(fontSize, (value) => {
    if (hydrated) void preferences.setDurable(FONT_KEY, value)
  })
  watch(darkMode, (value) => {
    if (hydrated) void preferences.setDurable(DARK_KEY, String(value))
  })
  watch(annotations, (value) => {
    if (hydrated) void preferences.setDurable(ANNOTATIONS_KEY, JSON.stringify(value))
  }, { deep: true })
  watch(questionNavCollapsed, (value) => {
    if (hydrated) void preferences.setDurable(NAV_KEY, String(value))
  })

  function selectFontSize(value) {
    if (isFontSize(value)) fontSize.value = value
  }

  function toggleAnnotation(key) {
    if (!(key in annotations.value)) return
    annotations.value = { ...annotations.value, [key]: !annotations.value[key] }
  }

  return {
    fontSize,
    darkMode,
    annotations,
    questionNavCollapsed,
    rootClassList,
    initializeDisplayPreferences,
    selectFontSize,
    toggleAnnotation,
    setDarkMode: (value) => { darkMode.value = Boolean(value) },
    setQuestionNavCollapsed: (value) => { questionNavCollapsed.value = Boolean(value) }
  }
}
