import { reactive, ref, type Ref } from 'vue'
import { upsertAnnotation, listAnnotations, revalidateAnnotations, deleteAnnotation, lookupDictionary, upsertVocab } from '@/api/enrichment-repository.js'
import type { AnnotationRecord } from '@/api/enrichment-repository.js'
import { isTauriRuntime } from '@/api/tauri-bridge.js'
import { normalizeQuestionId } from './readingQuestionIds'
import {
  collectHighlightAnnotationIds,
  escapeRegExp,
  findSequentialTextMatch,
  normalizeComparableText,
  normalizeDictionaryLookupResult,
  normalizeHighlightSnapshot as normalizeHighlightSnapshotCore,
  resolveSupersededAnnotationCleanup
} from './readingHighlightCore.js'

export interface HighlightRecord {
  id?: string
  scope?: string
  text?: string
  excerpt?: string
  kind?: string
  questionId?: string | null
  startOffset?: number | null
  endOffset?: number | null
  start?: number | null
  end?: number | null
  before?: string | null
  after?: string | null
  occurrence?: number | null
  createdAt?: string
  noteText?: string | null
  contentFingerprint?: string | null
  mismatch?: unknown
  node?: HTMLElement | null
  [key: string]: unknown
}

export interface NormalizedHighlight {
  id: string | null
  scope: 'passage' | 'questions' | 'unknown'
  text: string
  kind: 'note' | 'highlight'
  questionId: string | null
  startOffset: number | null
  endOffset: number | null
  before: string
  after: string
  occurrence: number
  createdAt: string
  mismatch?: string | null
}

export interface DictionaryEntry {
  term?: string
  meaning?: string
  definition?: string
  example?: string
  phonetic?: string
  partOfSpeech?: string
  [key: string]: unknown
}

export interface ReadingHighlightControllerOptions {
  assetIdSource?: () => string | null | undefined
  reviewModeSource?: () => boolean | undefined
  getAttemptId?: () => string
  ensureAttemptId?: () => string
  onAttemptEnsured?: () => void
  onInteraction?: () => void
  notesText?: Ref<string>
  toggleNotesPanel?: () => void
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
    parts: [] as Array<{ term: string; meta: string; meaning: string; definition: string } | string>,
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

function resolveQuestionId(raw: unknown): string {
  return normalizeQuestionId(raw) || String(raw || '').trim()
}

export function useReadingHighlights(options: ReadingHighlightControllerOptions = {}) {
  const selectionToolbarVisible = ref(false)
  const selectionToolbarStyle = reactive({ top: '0px', left: '0px' })
  const keepSelectionToolbar = ref(false)
  const highlightSnapshot = ref<NormalizedHighlight[]>([])
  const highlightRestoreWarning = ref('')
  const dictionaryBubble = createDictionaryBubbleState()

  let lastSelectionRange: Range | null = null
  let currentHighlightNode: HTMLElement | null = null
  let highlightPersistGeneration = 0
  let listenersAttached = false

  function assetId() {
    return String(options.assetIdSource?.() || '').trim()
  }

  function reviewMode() {
    return Boolean(options.reviewModeSource?.())
  }

  function attemptId() {
    return String(options.getAttemptId?.() || '').trim()
  }

  function ensureAttempt() {
    if (typeof options.ensureAttemptId === 'function') {
      return String(options.ensureAttemptId() || '').trim()
    }
    return attemptId()
  }

  function trackInteraction() {
    options.onInteraction?.()
  }

  function appendNoteText(text: string) {
    if (!options.notesText) return
    const value = normalizeComparableText(text)
    if (!value) return
    options.notesText.value += `${options.notesText.value ? '\n\n' : ''}> ${value}\n`
  }

  async function persistHighlightToStore(
    targetAssetId: string | null | undefined,
    entry: HighlightRecord | null | undefined,
    targetAttemptId: string | null = null
  ) {
    if (!isTauriRuntime() || !targetAssetId || !targetAttemptId || !entry?.text) return null
    try {
      const { annotation } = await upsertAnnotation({
        id: entry.id || null,
        attemptId: targetAttemptId,
        assetId: targetAssetId,
        scope: entry.scope || 'passage',
        questionId: entry.questionId || null,
        kind: entry.kind || 'highlight',
        noteText: entry.noteText || null,
        anchor: {
          text: entry.text,
          before: entry.before || null,
          after: entry.after || null,
          occurrence: entry.occurrence || 0,
          startOffset: entry.startOffset ?? null,
          endOffset: entry.endOffset ?? null,
          contentFingerprint: entry.contentFingerprint || null
        }
      }) as { annotation?: { id?: string } }
      return annotation
    } catch (err) {
      console.warn('persist highlight failed', err)
      return null
    }
  }

  async function deleteHighlightFromStore(
    id: string | null | undefined,
    targetAssetId: string | null | undefined = assetId(),
    targetAttemptId: string | null = attemptId() || null
  ) {
    if (!isTauriRuntime() || !id || !targetAssetId || !targetAttemptId) return false
    try {
      return await deleteAnnotation(id, targetAssetId, targetAttemptId)
    } catch (err) {
      console.warn('delete highlight failed', err)
      return false
    }
  }

  function normalizeHighlightSnapshot(value: unknown): NormalizedHighlight[] {
    return normalizeHighlightSnapshotCore(value, {
      normalizeQuestionId: resolveQuestionId
    }) as NormalizedHighlight[]
  }

  async function loadPersistedHighlights(
    targetAssetId: string | null | undefined,
    targetAttemptId: string | null = null,
    documentText: string | null = null
  ) {
    // Highlights belong to an attempt. Never turn an absent attempt into an
    // asset-wide query, because that mixes highlights from unrelated attempts.
    if (!isTauriRuntime() || !targetAssetId || !targetAttemptId) return [] as NormalizedHighlight[]
    try {
      const { items } = documentText
        ? await revalidateAnnotations(targetAssetId, targetAttemptId, 'passage', documentText)
        : await listAnnotations(targetAssetId, targetAttemptId)
      return normalizeHighlightSnapshot(
        (items || []).filter((item) => item.kind === 'highlight').map((item: AnnotationRecord) => ({
          scope: item.scope,
          text: item.anchor?.text,
          kind: item.kind,
          questionId: item.questionId,
          startOffset: item.anchor?.startOffset,
          endOffset: item.anchor?.endOffset,
          before: item.anchor?.before,
          after: item.anchor?.after,
          occurrence: item.anchor?.occurrence,
          createdAt: item.createdAt,
          noteText: item.noteText,
          mismatch: item.mismatch || null,
          id: item.id
        }))
      )
    } catch (err) {
      console.warn('load highlights failed', err)
      return [] as NormalizedHighlight[]
    }
  }

  async function lookupTermInDictionary(term: string) {
    if (!isTauriRuntime()) return null
    try {
      const { entry } = await lookupDictionary(term) as { entry?: DictionaryEntry | null }
      return entry || null
    } catch (err) {
      console.warn('dictionary lookup failed', err)
      return null
    }
  }

  async function saveTermToVocab(
    entry: DictionaryEntry | null | undefined,
    targetAssetId: string | null = null,
    targetAttemptId: string | null = null
  ) {
    if (!isTauriRuntime() || !entry?.term) return null
    try {
      const { item } = await upsertVocab({
        term: entry.term,
        definition: entry.definition || entry.meaning || null,
        phonetic: entry.phonetic || null,
        partOfSpeech: entry.partOfSpeech || null,
        example: entry.example || null,
        sourceAssetId: targetAssetId,
        sourceAttemptId: targetAttemptId,
        tags: ['reading']
      }) as { item?: unknown }
      return item
    } catch (err) {
      console.warn('save vocab failed', err)
      return null
    }
  }

  function getHighlightRoots(): Record<string, HTMLElement | null> {
    if (typeof document === 'undefined') {
      return {}
    }
    return {
      passage: document.getElementById('left'),
      questions: document.getElementById('question-groups')
    }
  }

  function isInsideExplanationNode(node: Node | null | undefined) {
    const element = node?.nodeType === Node.TEXT_NODE
      ? (node as Text).parentElement
      : (node as Element | null | undefined)
    return Boolean(element?.closest?.('.reading-explanation-card, .reading-group-explanation, .reading-question-explanation, .reading-question-explanation-list'))
  }

  function getTextNodes(root: HTMLElement | null | undefined) {
    const nodes: Text[] = []
    if (!root || typeof document === 'undefined') {
      return nodes
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || isInsideExplanationNode(node)) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      }
    })
    let node = walker.nextNode()
    while (node) {
      nodes.push(node as Text)
      node = walker.nextNode()
    }
    return nodes
  }

  function getText(root: HTMLElement | null | undefined) {
    return getTextNodes(root).map((node) => node.textContent || '').join('')
  }

  function unwrapHighlights(root: HTMLElement | null | undefined) {
    if (!root) return
    root.querySelectorAll('.hl, .memorize-locator-highlight').forEach((highlight) => {
      if (isInsideExplanationNode(highlight)) return
      const parent = highlight.parentNode
      if (!parent) return
      while (highlight.firstChild) {
        parent.insertBefore(highlight.firstChild, highlight)
      }
      parent.removeChild(highlight)
      parent.normalize()
    })
  }

  function resolveRangeFromOffsets(root: HTMLElement, start: number, end: number) {
    const nodes = getTextNodes(root)
    let offset = 0
    let startNode: Text | null = null
    let endNode: Text | null = null
    let startOffset = 0
    let endOffset = 0
    nodes.some((node) => {
      const text = node.textContent || ''
      const nextOffset = offset + text.length
      if (!startNode && start >= offset && start <= nextOffset) {
        startNode = node
        startOffset = Math.max(0, start - offset)
      }
      if (!endNode && end >= offset && end <= nextOffset) {
        endNode = node
        endOffset = Math.max(0, end - offset)
      }
      offset = nextOffset
      return Boolean(startNode && endNode)
    })
    if (!startNode || !endNode) {
      return null
    }
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }

  function applyHighlightKind(node: HTMLElement, kind = 'highlight') {
    node.classList.add('hl')
    node.classList.add('review-dictionary-highlight')
    node.dataset.hlType = kind === 'note' ? 'note' : 'highlight'
    node.setAttribute('tabindex', '0')
    node.setAttribute('role', 'button')
    node.setAttribute('aria-label', `查看释义：${normalizeComparableText(node.textContent)}`)
  }

  function resolveHighlightQuestionId(node: Element | null | undefined) {
    const element = node?.closest?.('[data-answer-question-id], [data-review-question-id], [data-question], [data-question-id], [name]') as HTMLElement | null
    return resolveQuestionId(
      element?.dataset?.answerQuestionId
      || element?.dataset?.reviewQuestionId
      || element?.dataset?.question
      || element?.dataset?.questionId
      || element?.getAttribute?.('name')
    ) || null
  }

  function applyHighlightRecord(root: HTMLElement, record: NormalizedHighlight | HighlightRecord) {
    const fullText = getText(root)
    if (!fullText || !record?.text) {
      return false
    }
    const candidates: Array<{ start: number; end: number }> = []
    const start = Number(record.startOffset)
    const end = Number(record.endOffset)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      candidates.push({ start, end })
    }
    let cursor = 0
    let hit = -1
    for (let index = 0; index <= (Number(record.occurrence) || 0); index += 1) {
      hit = fullText.indexOf(String(record.text), cursor)
      if (hit < 0) break
      cursor = hit + String(record.text).length
    }
    if (hit >= 0) {
      candidates.push({ start: hit, end: hit + String(record.text).length })
    }
    const normalizedNeedle = normalizeComparableText(record.text)
    if (normalizedNeedle && hit < 0) {
      const pattern = new RegExp(normalizedNeedle.split(/\s+/).map(escapeRegExp).join('\\s+'), 'g')
      const matched = pattern.exec(fullText)
      if (matched) {
        candidates.push({ start: matched.index, end: matched.index + matched[0].length })
      }
    }
    for (const candidate of candidates) {
      const range = resolveRangeFromOffsets(root, candidate.start, candidate.end)
      if (!range || range.collapsed) continue
      const span = document.createElement('span')
      applyHighlightKind(span, record.kind === 'note' ? 'note' : 'highlight')
      span.dataset.createdAt = record.createdAt || new Date().toISOString()
      if (record.id) span.dataset.annotationId = String(record.id)
      try {
        range.surroundContents(span)
        return true
      } catch (_) {
        // fall through to next candidate
      }
    }
    return false
  }

  async function persistHighlightSnapshotToStore(
    records: HighlightRecord[],
    previousIds: Set<string> | null = null,
    generation = highlightPersistGeneration
  ) {
    const currentAssetId = assetId()
    if (!isTauriRuntime() || !currentAssetId || reviewMode()) return
    let currentAttemptId = attemptId()
    if (!currentAttemptId) {
      currentAttemptId = ensureAttempt()
      options.onAttemptEnsured?.()
    }
    if (!currentAttemptId) return
    const list = Array.isArray(records) ? records : []
    const keepIds = collectHighlightAnnotationIds(list)
    const knownIds = previousIds instanceof Set
      ? previousIds
      : collectHighlightAnnotationIds(highlightSnapshot.value)
    // Always apply set-diff deletes for this snapshot generation so a superseded
    // persist still removes ids that dropped out before a later snapshot ran.
    for (const id of knownIds) {
      if (!keepIds.has(id)) {
        await deleteHighlightFromStore(id, currentAssetId, currentAttemptId)
      }
    }
    if (generation !== highlightPersistGeneration) return
    for (const entry of list) {
      // Skip nodes already unwrapped (e.g. rapid remove while upsert is in flight).
      if (entry?.node && entry.node.isConnected === false) {
        continue
      }
      const previousId = entry.id ? String(entry.id) : null
      const annotation = await persistHighlightToStore(currentAssetId, entry, currentAttemptId || null)
      const id = annotation?.id ? String(annotation.id) : null
      const generationCurrent = generation === highlightPersistGeneration
      const nodeConnected = !entry.node || entry.node.isConnected
      const cleanupId = resolveSupersededAnnotationCleanup({
        previousId,
        persistedId: id,
        generationCurrent,
        nodeConnected
      })
      if (cleanupId) {
        await deleteHighlightFromStore(cleanupId, currentAssetId, currentAttemptId)
      }
      if (!generationCurrent) return
      if (!nodeConnected) continue
      if (id) {
        entry.id = id
        if (entry.node?.isConnected) {
          entry.node.dataset.annotationId = id
        }
      }
    }
    if (generation !== highlightPersistGeneration) return
    highlightSnapshot.value = list
      .filter((entry) => !entry?.node || entry.node.isConnected)
      .map(({ node: _node, ...rest }) => rest as NormalizedHighlight)
  }

  function snapshotHighlights() {
    const roots = getHighlightRoots()
    const records: HighlightRecord[] = []
    Object.entries(roots).forEach(([scope, root]) => {
      if (!root) return
      const fullText = getText(root)
      const cursorByText = new Map<string, number>()
      const seenByText = new Map<string, number>()
      root.querySelectorAll('.hl').forEach((node) => {
        if (isInsideExplanationNode(node)) return
        const text = normalizeComparableText(node.textContent)
        if (!text) return
        const key = `${scope}::${text}`
        const occurrence = seenByText.get(key) || 0
        seenByText.set(key, occurrence + 1)
        const match = findSequentialTextMatch(fullText, text, cursorByText.get(key) || 0)
        if (!match) return
        cursorByText.set(key, match.nextCursor)
        const hit = match.start
        const endOffset = match.end
        const element = node as HTMLElement
        const annotationId = element.dataset.annotationId ? String(element.dataset.annotationId) : null
        records.push({
          id: annotationId || undefined,
          scope,
          text,
          kind: element.dataset.hlType === 'note' ? 'note' : 'highlight',
          questionId: resolveHighlightQuestionId(element),
          startOffset: hit,
          endOffset,
          before: fullText.slice(Math.max(0, hit - 20), hit),
          after: fullText.slice(endOffset, endOffset + 20),
          occurrence,
          createdAt: element.dataset.createdAt || new Date().toISOString(),
          node: element
        })
      })
    })
    const previousIds = collectHighlightAnnotationIds(highlightSnapshot.value)
    highlightSnapshot.value = records.map(({ node: _node, ...rest }) => rest as NormalizedHighlight)
    const persistGeneration = ++highlightPersistGeneration
    void persistHighlightSnapshotToStore(records, previousIds, persistGeneration)
    return highlightSnapshot.value
  }

  function restoreHighlightsFromRecords(records: unknown[] = []) {
    const roots = getHighlightRoots()
    Object.values(roots).forEach((root) => unwrapHighlights(root))
    normalizeHighlightSnapshot(records).forEach((record) => {
      const root = roots[record.scope]
      if (root) {
        applyHighlightRecord(root, record)
      }
    })
  }

  function closeSelectionToolbar() {
    selectionToolbarVisible.value = false
    keepSelectionToolbar.value = false
    lastSelectionRange = null
    currentHighlightNode = null
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
    currentHighlightNode = null
  }

  function positionSelectionToolbar(rect: DOMRect) {
    const top = window.scrollY + rect.top - 44
    const left = window.scrollX + rect.left + (rect.width / 2) - 110
    selectionToolbarStyle.top = `${Math.max(8, Math.round(top > 0 ? top : window.scrollY + rect.bottom + 8))}px`
    selectionToolbarStyle.left = `${Math.max(8, Math.round(left))}px`
    selectionToolbarVisible.value = true
  }

  function handleSelectionChange() {
    window.setTimeout(() => {
      if (keepSelectionToolbar.value) return
      const selection = window.getSelection?.()
      if (!selection || !selection.rangeCount || selection.isCollapsed) {
        if (!currentHighlightNode) {
          selectionToolbarVisible.value = false
        }
        return
      }
      const range = selection.getRangeAt(0)
      const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer as Element | null
      const roots = Object.values(getHighlightRoots()).filter(Boolean) as HTMLElement[]
      const insideRoot = roots.some((root) => root.contains(container))
      const highlightNode = container?.closest?.('.hl') as HTMLElement | null
      if (!insideRoot && !highlightNode) {
        closeSelectionToolbar()
        return
      }
      lastSelectionRange = range.cloneRange()
      currentHighlightNode = highlightNode
      positionSelectionToolbar(range.getBoundingClientRect())
    }, 10)
  }

  function applySelectionHighlight(kind = 'highlight') {
    if (!lastSelectionRange || lastSelectionRange.collapsed || currentHighlightNode) {
      return
    }
    const span = document.createElement('span')
    applyHighlightKind(span, kind)
    span.dataset.createdAt = new Date().toISOString()
    try {
      lastSelectionRange.surroundContents(span)
    } catch (_) {
      return
    }
    window.getSelection?.()?.removeAllRanges()
    snapshotHighlights()
    trackInteraction()
    closeSelectionToolbar()
  }

  function applySelectionNote() {
    if (currentHighlightNode) {
      applyHighlightKind(currentHighlightNode, 'note')
      appendNoteText(currentHighlightNode.textContent || '')
      snapshotHighlights()
      trackInteraction()
      closeSelectionToolbar()
      options.toggleNotesPanel?.()
      return
    }
    const selectedText = normalizeComparableText(lastSelectionRange?.toString?.())
    applySelectionHighlight('note')
    if (selectedText) {
      appendNoteText(selectedText)
      options.toggleNotesPanel?.()
    }
  }

  function removeSelectionHighlight() {
    let target = currentHighlightNode
    if (!target && lastSelectionRange) {
      const ancestor = lastSelectionRange.commonAncestorContainer
      target = ((ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor as Element)?.closest?.('.hl') || null) as HTMLElement | null
    }
    if (target?.parentNode) {
      const annotationId = target.dataset?.annotationId
        ? String(target.dataset.annotationId)
        : null
      const parent = target.parentNode
      while (target.firstChild) {
        parent.insertBefore(target.firstChild, target)
      }
      parent.removeChild(target)
      parent.normalize()
      if (annotationId) {
        void deleteHighlightFromStore(annotationId)
      }
      snapshotHighlights()
      trackInteraction()
    }
    window.getSelection?.()?.removeAllRanges()
    closeSelectionToolbar()
  }

  async function openDictionaryBubble(highlight: HTMLElement | null | undefined) {
    const term = normalizeComparableText(highlight?.textContent)
    if (!term || !highlight) return
    const rect = highlight.getBoundingClientRect()
    dictionaryBubble.term = term
    dictionaryBubble.meaning = '正在加载本地词典...'
    dictionaryBubble.definition = ''
    dictionaryBubble.example = ''
    dictionaryBubble.meta = '本地词典'
    dictionaryBubble.sourceLine = ''
    dictionaryBubble.parts = []
    dictionaryBubble.phonetic = ''
    dictionaryBubble.partOfSpeech = ''
    dictionaryBubble.sourceLabel = ''
    dictionaryBubble.license = ''
    dictionaryBubble.found = false
    dictionaryBubble.saved = false
    dictionaryBubble.left = Math.max(12, Math.round(Math.min(rect.left, window.innerWidth - 360)))
    dictionaryBubble.top = Math.max(12, Math.round(rect.bottom + 8))
    dictionaryBubble.visible = true
    currentHighlightNode = highlight
    const lookup = await lookupTermInDictionary(term)
    if (currentHighlightNode !== highlight || !dictionaryBubble.visible) {
      return
    }
    applyDictionaryLookupToBubble(lookup, term)
  }

  function applyDictionaryLookupToBubble(lookup: DictionaryEntry | null | undefined, fallbackTerm: string) {
    const normalized = normalizeDictionaryLookupResult(lookup, fallbackTerm)
    dictionaryBubble.term = normalized.term || normalizeComparableText(fallbackTerm)
    dictionaryBubble.meaning = normalized.meaning || (normalized.parts.length ? '' : normalized.definition)
    dictionaryBubble.definition = normalized.parts.length ? '' : normalized.definition
    dictionaryBubble.example = normalized.example
    dictionaryBubble.meta = normalized.meta || (normalized.found ? normalized.sourceLabel : '本地词典')
    dictionaryBubble.sourceLine = normalized.sourceLine
    dictionaryBubble.parts = normalized.parts
    dictionaryBubble.phonetic = normalized.phonetic
    dictionaryBubble.partOfSpeech = normalized.partOfSpeech
    dictionaryBubble.sourceLabel = normalized.sourceLabel
    dictionaryBubble.license = normalized.license
    dictionaryBubble.found = normalized.found
  }

  async function saveDictionaryBubbleWord() {
    const word = normalizeComparableText(dictionaryBubble.term)
    if (!word) return
    const item = await saveTermToVocab({
      term: word,
      meaning: dictionaryBubble.meaning || dictionaryBubble.definition || '待补充释义',
      definition: dictionaryBubble.definition || dictionaryBubble.meaning || '待补充释义',
      example: dictionaryBubble.example || '',
      phonetic: dictionaryBubble.phonetic || undefined,
      partOfSpeech: dictionaryBubble.partOfSpeech || undefined
    }, assetId() || null, attemptId() || null)
    dictionaryBubble.saved = Boolean(item)
  }

  function handleDocumentClick(event: Event) {
    const target = event.target as Element | null
    const highlight = target?.closest?.('.hl') as HTMLElement | null
    if (highlight && Object.values(getHighlightRoots()).some((root) => root?.contains(highlight))) {
      void openDictionaryBubble(highlight)
      return
    }
    if (target?.closest?.('#selbar, #review-highlight-dictionary-bubble, #settings-panel, #notes-panel, #settings-btn, #note-btn')) {
      return
    }
    if (!keepSelectionToolbar.value) {
      selectionToolbarVisible.value = false
    }
    closeDictionaryBubble()
  }

  function attachHighlightDocumentListeners() {
    if (listenersAttached || typeof document === 'undefined') return
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('click', handleDocumentClick, true)
    listenersAttached = true
  }

  function detachHighlightDocumentListeners() {
    if (!listenersAttached || typeof document === 'undefined') return
    document.removeEventListener('selectionchange', handleSelectionChange)
    document.removeEventListener('click', handleDocumentClick, true)
    listenersAttached = false
  }

  function bumpHighlightPersistGeneration() {
    highlightPersistGeneration += 1
  }

  function resetHighlightUiState() {
    highlightSnapshot.value = []
    highlightRestoreWarning.value = ''
    bumpHighlightPersistGeneration()
    closeSelectionToolbar()
    closeDictionaryBubble()
  }

  async function hydrateHighlightsFromStore(
    targetAssetId: string | null | undefined,
    targetAttemptId: string | null = null,
    documentText: string | null = null
  ) {
    if (!isTauriRuntime() || !targetAssetId) {
      highlightRestoreWarning.value = ''
      return [] as NormalizedHighlight[]
    }
    const loaded = await loadPersistedHighlights(targetAssetId, targetAttemptId, documentText || null)
    const valid = loaded.filter((entry) => !entry.mismatch)
    const mismatchCount = loaded.length - valid.length
    highlightRestoreWarning.value = mismatchCount
      ? `${mismatchCount} 条高亮因原文变化无法准确恢复，已停止自动定位。`
      : ''
    if (valid.length || loaded.length) {
      highlightSnapshot.value = valid
    }
    return highlightSnapshot.value
  }

  return {
    selectionToolbarVisible,
    selectionToolbarStyle,
    keepSelectionToolbar,
    highlightSnapshot,
    highlightRestoreWarning,
    dictionaryBubble,
    persistHighlightToStore,
    deleteHighlightFromStore,
    loadPersistedHighlights,
    lookupTermInDictionary,
    saveTermToVocab,
    normalizeHighlightSnapshot,
    closeSelectionToolbar,
    closeDictionaryBubble,
    resetHighlightUiState,
    snapshotHighlights,
    restoreHighlightsFromRecords,
    applySelectionHighlight,
    applySelectionNote,
    removeSelectionHighlight,
    saveDictionaryBubbleWord,
    attachHighlightDocumentListeners,
    detachHighlightDocumentListeners,
    bumpHighlightPersistGeneration,
    hydrateHighlightsFromStore,
    unwrapHighlights,
    getHighlightRoots,
    getTextNodes
  }
}
