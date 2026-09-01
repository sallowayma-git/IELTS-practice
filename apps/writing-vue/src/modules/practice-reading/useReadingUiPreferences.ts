import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useTauriPreferences } from '@/composables/useTauriPreferences.js'
import { upsertAnnotation, listAnnotations, deleteAnnotation } from '@/api/enrichment-repository.js'

const NOTES_STORAGE_PREFIX = 'practice_reading_notes_'
const SUITE_AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit'
const FONT_KEY = 'reading_font_size'
const LEGACY_THEME_KEY = 'reading_theme_mode'

export const readingFontSizeOptions = [
  { value: 'normal', label: 'A' },
  { value: 'large', label: 'A', style: { fontSize: '1.1rem' } },
  { value: 'xlarge', label: 'A', style: { fontSize: '1.25rem' } }
] as const

export type ReadingFontSize = (typeof readingFontSizeOptions)[number]['value']

type AssetLike = { id?: string | null } | null | undefined

type ReadingUiPreferencesOptions = {
  assetSource: () => AssetLike
}

function peekLocal(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function removeLocal(key: string) {
  try {
    window.localStorage?.removeItem(key)
  } catch {
    // A failed cleanup is safe: the canonical value already exists and a
    // later migration pass can retry removing the legacy source.
  }
}

function isFontSize(value: string | null | undefined): value is ReadingFontSize {
  return readingFontSizeOptions.some((option) => option.value === value)
}

/**
 * Reading chrome preferences — Tauri SQLite settings only.
 * One-shot migrates leftover localStorage keys into frontend-preferences.
 */
export function useReadingUiPreferences(options: ReadingUiPreferencesOptions) {
  const preferences = useTauriPreferences()
  const settingsPanelOpen = ref(false)
  const notesPanelOpen = ref(false)
  const settingsPanel = ref<HTMLElement | null>(null)
  const notesPanel = ref<HTMLElement | null>(null)
  const notesTextarea = ref<HTMLTextAreaElement | null>(null)
  const notesText = ref('')
  const notesError = ref('')
  const readingFontSize = ref<ReadingFontSize>('normal')
  const suiteAutoAdvance = ref(true)
  let suppressNotesPersist = false
  let notesLoadSequence = 0
  let notesPersistTimer: ReturnType<typeof setTimeout> | null = null
  let noteAnnotationId: string | null = null
  let floatingPanelReturnFocus: HTMLElement | null = null

  const readingPageClassList = computed(() => ({
    [`font-${readingFontSize.value}`]: true
  }))
  const readingPageStyle = computed(() => ({
    '--reading-font-scale': readingFontSize.value === 'xlarge'
      ? '1.18'
      : (readingFontSize.value === 'large' ? '1.08' : '1')
  }))

  function notesKey(assetId: string) {
    return `${NOTES_STORAGE_PREFIX}${assetId}`
  }

  async function migrateLocalIfMissing(key: string): Promise<string> {
    const current = preferences.get(key, '')
    if (current) return current
    const legacy = peekLocal(key)
    if (legacy != null && legacy !== '') {
      await preferences.setDurable(key, legacy)
      removeLocal(key)
      return legacy
    }
    return current
  }

  async function initializeReadingPreferences() {
    await preferences.hydrateStrict()
    const storedFont = await migrateLocalIfMissing(FONT_KEY)
    if (isFontSize(storedFont)) readingFontSize.value = storedFont
    removeLocal(LEGACY_THEME_KEY)
    const storedSuiteFlow = await migrateLocalIfMissing(SUITE_AUTO_ADVANCE_STORAGE_KEY)
    if (storedSuiteFlow === 'true' || storedSuiteFlow === 'false') {
      suiteAutoAdvance.value = storedSuiteFlow === 'true'
    }
  }

  function closeFloatingPanels(options: { restoreFocus?: boolean } = {}) {
    const shouldRestoreFocus = options.restoreFocus !== false
      && (settingsPanelOpen.value || notesPanelOpen.value)
    settingsPanelOpen.value = false
    notesPanelOpen.value = false
    if (shouldRestoreFocus) {
      void nextTick(() => {
        if (floatingPanelReturnFocus?.isConnected) floatingPanelReturnFocus.focus()
        floatingPanelReturnFocus = null
      })
    }
  }

  function rememberFloatingPanelReturnFocus() {
    if (typeof document !== 'undefined') {
      floatingPanelReturnFocus = document.activeElement as HTMLElement | null
    }
  }

  function focusFirstPanelControl(panel: HTMLElement | null) {
    const control = panel?.querySelector<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    control?.focus()
  }

  function toggleSettingsPanel() {
    if (settingsPanelOpen.value) {
      closeFloatingPanels()
      return
    }
    rememberFloatingPanelReturnFocus()
    closeFloatingPanels({ restoreFocus: false })
    settingsPanelOpen.value = true
    void nextTick(() => focusFirstPanelControl(settingsPanel.value))
  }

  function toggleNotesPanel() {
    if (notesPanelOpen.value) {
      closeFloatingPanels()
      return
    }
    rememberFloatingPanelReturnFocus()
    closeFloatingPanels({ restoreFocus: false })
    notesPanelOpen.value = true
    void nextTick(() => notesTextarea.value?.focus?.())
  }

  function handleFloatingPanelKeydown(event: KeyboardEvent, panel: HTMLElement | null) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeFloatingPanels()
      return
    }
    if (event.key !== 'Tab' || !panel) return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden)
    if (focusable.length < 2) return
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const targetIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1)
    event.preventDefault()
    focusable[targetIndex].focus()
  }

  function handleSettingsDialogKeydown(event: KeyboardEvent) {
    if (!settingsPanelOpen.value) return
    handleFloatingPanelKeydown(event, settingsPanel.value)
  }

  function handleNotesDialogKeydown(event: KeyboardEvent) {
    if (!notesPanelOpen.value) return
    handleFloatingPanelKeydown(event, notesPanel.value)
  }

  function selectReadingFont(value: string) {
    if (!isFontSize(value)) return
    readingFontSize.value = value
    preferences.set(FONT_KEY, value)
  }

  function setSuiteAutoAdvance(value: unknown) {
    suiteAutoAdvance.value = Boolean(value)
    preferences.set(SUITE_AUTO_ADVANCE_STORAGE_KEY, String(suiteAutoAdvance.value))
  }

  function loadReadingNotes() {
    const loadSequence = ++notesLoadSequence
    suppressNotesPersist = true
    notesError.value = ''
    const assetId = options.assetSource()?.id
    if (!assetId) {
      notesText.value = ''
      noteAnnotationId = null
      suppressNotesPersist = false
      return
    }
    const key = notesKey(String(assetId))
    const storedPreference = String(preferences.get(key, '') || '')
    const storedLocal = String(peekLocal(key) || '')
    const stored = storedPreference || storedLocal
    notesText.value = stored
    void (async () => {
      try {
        const existing = await listAnnotations(String(assetId), null)
        if (loadSequence !== notesLoadSequence) return
        const notes = (existing.items || []).filter((item: any) => (
          item.kind === 'note' && !item.attemptId
        ))
        const current = notes.at(-1) || null
        const currentText = String(current?.noteText || '').trim()
        const legacyText = String(stored || '').trim()
        const mergedText = currentText && legacyText && currentText !== legacyText
          ? `${currentText}\n\n${legacyText}`
          : (currentText || legacyText)
        noteAnnotationId = current?.id ? String(current.id) : null
        if (mergedText && mergedText !== currentText) {
          const result = await upsertAnnotation({
            id: noteAnnotationId,
            assetId: String(assetId),
            attemptId: null,
            scope: 'note',
            kind: 'note',
            noteText: mergedText,
            anchor: { text: 'reading-note', occurrence: 0 }
          })
          noteAnnotationId = result.annotation?.id || noteAnnotationId
        }
        if (loadSequence !== notesLoadSequence) return
        notesText.value = mergedText
        await preferences.setDurable(key, '')
        if (storedLocal) removeLocal(key)
      } catch (error) {
        if (loadSequence !== notesLoadSequence) return
        notesError.value = '阅读笔记加载失败，旧笔记尚未删除。'
        console.warn('load reading notes failed', error)
      } finally {
        if (loadSequence === notesLoadSequence) suppressNotesPersist = false
      }
    })()
  }

  function clearReadingNotesDraft() {
    notesLoadSequence += 1
    if (notesPersistTimer) clearTimeout(notesPersistTimer)
    suppressNotesPersist = true
    notesText.value = ''
    notesError.value = ''
    noteAnnotationId = null
    suppressNotesPersist = false
  }

  watch(notesText, (value) => {
    if (suppressNotesPersist) return
    const assetId = options.assetSource()?.id
    if (!assetId) return
    if (notesPersistTimer) clearTimeout(notesPersistTimer)
    notesPersistTimer = setTimeout(() => {
      void (async () => {
        try {
          notesError.value = ''
          const normalized = String(value || '').trim()
          if (!normalized) {
            if (noteAnnotationId) await deleteAnnotation(noteAnnotationId, String(assetId), null)
            noteAnnotationId = null
            return
          }
          const result = await upsertAnnotation({
            id: noteAnnotationId,
            assetId: String(assetId),
            attemptId: null,
            scope: 'note',
            kind: 'note',
            noteText: value,
            anchor: { text: 'reading-note', occurrence: 0 }
          })
          noteAnnotationId = result.annotation?.id || noteAnnotationId
        } catch (error) {
          notesError.value = '阅读笔记保存失败，请保留页面并重试。'
          console.warn('persist reading note failed', error)
        }
      })()
    }, 300)
  })

  return {
    settingsPanelOpen,
    notesPanelOpen,
    settingsPanel: settingsPanel as Ref<HTMLElement | null>,
    notesPanel: notesPanel as Ref<HTMLElement | null>,
    notesTextarea: notesTextarea as Ref<HTMLTextAreaElement | null>,
    notesText,
    notesError,
    readingFontSize,
    suiteAutoAdvance,
    readingPageClassList,
    readingPageStyle,
    initializeReadingPreferences,
    toggleSettingsPanel,
    toggleNotesPanel,
    handleSettingsDialogKeydown,
    handleNotesDialogKeydown,
    closeFloatingPanels,
    selectReadingFont,
    setSuiteAutoAdvance,
    loadReadingNotes,
    clearReadingNotesDraft
  }
}

export default useReadingUiPreferences
