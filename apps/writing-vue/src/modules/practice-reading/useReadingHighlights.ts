import { reactive, ref } from 'vue'

function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function createDictionaryBubbleState() {
  return reactive({
    visible: false,
    term: '',
    meaning: '',
    definition: '',
    example: '',
    meta: '',
    sourceLine: '',
    parts: [],
    phonetic: '',
    partOfSpeech: '',
    sourceLabel: '',
    license: '',
    found: false,
    saved: false,
    left: 0,
    top: 0
  })
}

export function useReadingHighlights() {
  const selectionToolbarVisible = ref(false)
  const selectionToolbarStyle = reactive({ top: '0px', left: '0px' })
  const keepSelectionToolbar = ref(false)
  const highlightSnapshot = ref([])
  const dictionaryBubble = createDictionaryBubbleState()

  function normalizeHighlightSnapshot(value) {
    if (!Array.isArray(value)) {
      return []
    }
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const text = normalizeComparableText(entry.text || entry.excerpt)
        if (!text) return null
        const scope = String(entry.scope || '').trim().toLowerCase()
        const startOffset = Number(entry.startOffset ?? entry.start)
        const endOffset = Number(entry.endOffset ?? entry.end)
        return {
          scope: scope === 'passage' || scope === 'questions' ? scope : 'unknown',
          text,
          kind: entry.kind === 'note' ? 'note' : 'highlight',
          questionId: entry.questionId ? String(entry.questionId).trim() : null,
          startOffset: Number.isFinite(startOffset) ? startOffset : null,
          endOffset: Number.isFinite(endOffset) ? endOffset : null,
          before: normalizeComparableText(entry.before),
          after: normalizeComparableText(entry.after),
          occurrence: Number.isFinite(Number(entry.occurrence)) ? Math.max(0, Number(entry.occurrence)) : 0,
          createdAt: entry.createdAt || new Date().toISOString()
        }
      })
      .filter(Boolean)
  }

  function closeSelectionToolbar() {
    selectionToolbarVisible.value = false
    keepSelectionToolbar.value = false
  }

  function closeDictionaryBubble() {
    dictionaryBubble.visible = false
    dictionaryBubble.term = ''
    dictionaryBubble.meaning = ''
    dictionaryBubble.definition = ''
    dictionaryBubble.example = ''
    dictionaryBubble.meta = ''
    dictionaryBubble.sourceLine = ''
    dictionaryBubble.parts = []
    dictionaryBubble.phonetic = ''
    dictionaryBubble.partOfSpeech = ''
    dictionaryBubble.sourceLabel = ''
    dictionaryBubble.license = ''
    dictionaryBubble.found = false
    dictionaryBubble.saved = false
  }

  function resetHighlightUiState() {
    highlightSnapshot.value = []
    closeSelectionToolbar()
    closeDictionaryBubble()
  }

  return {
    selectionToolbarVisible,
    selectionToolbarStyle,
    keepSelectionToolbar,
    highlightSnapshot,
    dictionaryBubble,
    normalizeHighlightSnapshot,
    closeSelectionToolbar,
    closeDictionaryBubble,
    resetHighlightUiState
  }
}
