import { ref, unref, type MaybeRefOrGetter } from 'vue'
import {
  escapeCss,
  expandQuestionSequence,
  normalizeQuestionId,
  resolveAnswerAliases
} from './readingQuestionIds'
import { createDragSelectionController } from './readingDragSelectionCore.js'

export type ReadingAnswerValue = string | string[]

export interface ReadingInteractionOption {
  value?: string
  label?: string
  [key: string]: unknown
}

export interface ReadingInteraction {
  control?: string
  name?: string
  options?: ReadingInteractionOption[]
  allowOptionReuse?: boolean
  [key: string]: unknown
}

export interface ReadingQuestionGroup {
  groupId?: string
  questionIds?: string[]
  allowOptionReuse?: boolean
  [key: string]: unknown
}

export interface ReadingInteractionPayload {
  interactionModel?: Record<string, ReadingInteraction>
  questionDisplayMap?: Record<string, string>
  answerKey?: Record<string, unknown>
  questionGroups?: ReadingQuestionGroup[]
  questionOrder?: string[]
  [key: string]: unknown
}

export interface DragPayload {
  value: string
  label: string
  sourceQuestionId: string
  groupId?: string
}

interface AssignAnswerOptions {
  track?: boolean
  syncNative?: boolean
  sourceQuestionId?: string
  [key: string]: unknown
}

const DROPZONE_ELEMENT_SELECTOR = '.paragraph-dropzone, .match-dropzone, .drop-target-summary, .dropzone'

interface ReadingInteractionsOptions {
  payloadSource?: MaybeRefOrGetter<ReadingInteractionPayload | null | undefined>
  readOnlyModeSource?: MaybeRefOrGetter<boolean | undefined>
  getAnswerValue: (questionId: string) => string
  getRawAnswer: (questionId: string) => ReadingAnswerValue
  assignAnswer: (questionId: string, value: ReadingAnswerValue, options?: AssignAnswerOptions) => void
  recordQuestionVisit?: (questionId: string) => void
}

function resolveSource<T>(source: MaybeRefOrGetter<T> | undefined): T | undefined {
  if (typeof source === 'function') {
    return (source as () => T)()
  }
  return unref(source)
}

export function useReadingInteractions(options: ReadingInteractionsOptions) {
  const currentDragPayload = ref<DragPayload | null>(null)
  const selectedDragOption = ref<DragPayload | null>(null)
  const dragInteractionStatus = ref('')
  const selectionController = createDragSelectionController({
    isReadOnly: () => readOnlyMode(),
    onStatus: (message: string) => { dragInteractionStatus.value = message },
    onChange: (payload: DragPayload | null) => {
      selectedDragOption.value = payload
      syncDragSelectionDomState()
    }
  })

  function payload() {
    return resolveSource(options.payloadSource) || null
  }

  function readOnlyMode() {
    return Boolean(resolveSource(options.readOnlyModeSource))
  }

  function getInteraction(questionId: string): ReadingInteraction | null {
    return payload()?.interactionModel?.[questionId] || null
  }

  function getDisplayLabel(questionId: string): string {
    return payload()?.questionDisplayMap?.[questionId] || String(questionId).replace(/^q/i, '')
  }

  function isChoiceControl(questionId: string): boolean {
    const interaction = getInteraction(questionId)
    return ['radio', 'checkbox', 'select'].includes(String(interaction?.control || ''))
  }

  // Dragdrop gate results are static per payload (dropzone markup does not
  // change while answers move), and the fallback does DOM lookups — memoize
  // so hot answer-sync paths pay the query cost once per question.
  let dropzoneGateCache = new Map<string, boolean>()
  let dropzoneGateCachePayload: unknown = null

  function isDragDropControl(questionId: string): boolean {
    const interaction = getInteraction(questionId)
    if (interaction?.control) {
      return interaction.control === 'dragdrop'
    }
    // Bundled payloads ship no interactionModel, and the opensource engine this
    // page mirrors has none either: the native dropzone markup (data-question /
    // data-target attributes) is the source of truth for dragdrop questions.
    const source = payload()
    if (dropzoneGateCachePayload !== source) {
      dropzoneGateCache = new Map()
      dropzoneGateCachePayload = source
    }
    const cached = dropzoneGateCache.get(questionId)
    if (cached !== undefined) {
      return cached
    }
    const result = findNativeDropzonesByQuestionId(questionId).length > 0
    // A false probe before the question DOM is mounted would poison the cache
    // for the whole session — only cache once [data-question] markup exists.
    if (!result && typeof document !== 'undefined' && !document.querySelector('[data-question]')) {
      return false
    }
    dropzoneGateCache.set(questionId, result)
    return result
  }

  function getOptions(questionId: string): ReadingInteractionOption[] {
    const interaction = getInteraction(questionId)
    return Array.isArray(interaction?.options) ? interaction.options : []
  }

  function isMultiValueCheckbox(questionId: string): boolean {
    const interaction = getInteraction(questionId)
    const correctAnswer = payload()?.answerKey?.[questionId]
    return interaction?.control === 'checkbox' && Array.isArray(correctAnswer)
  }

  function getDragDropGroup(questionId: string): ReadingQuestionGroup | null {
    return payload()?.questionGroups?.find((group) => (
      Array.isArray(group.questionIds) && group.questionIds.includes(questionId)
    )) || null
  }

  function getDragDropGroupQuestionIds(questionId: string): string[] {
    const group = getDragDropGroup(questionId)
    return Array.isArray(group?.questionIds) ? group.questionIds : [questionId]
  }

  function allowsDragOptionReuse(questionId: string): boolean {
    const interaction = getInteraction(questionId)
    if (typeof interaction?.allowOptionReuse === 'boolean') {
      return interaction.allowOptionReuse
    }
    const group = getDragDropGroup(questionId)
    if (typeof group?.allowOptionReuse === 'boolean') {
      return group.allowOptionReuse
    }
    return nativeGroupAllowsClone(questionId)
  }

  // Native groups can express reuse without normalized metadata: their pool
  // cards carry data-clone="true" (e.g. p2-high-201 "may be used more than
  // once", where q7 and q8 both need C). Derive from the question's rendered
  // group container so option consumption and duplicate-use validation agree.
  function nativeGroupAllowsClone(questionId: string): boolean {
    if (typeof document === 'undefined') return false
    const dropzone = findNativeDropzonesByQuestionId(questionId)[0]
    const container = dropzone?.closest('[data-group-id]')
    return Boolean(container?.querySelector('[data-clone="true"]'))
  }

  function getSelectedOption(questionId: string): ReadingInteractionOption | null {
    const value = options.getAnswerValue(questionId)
    return getOptions(questionId).find((option) => String(option.value || '').trim() === value) || null
  }

  function getSelectedOptionLabel(questionId: string): string {
    const option = getSelectedOption(questionId)
    return option?.label || options.getAnswerValue(questionId) || '未作答'
  }

  function findQuestionUsingDragOption(questionId: string, optionValue: unknown): string {
    const normalizedOption = String(optionValue || '').trim()
    if (!normalizedOption || allowsDragOptionReuse(questionId)) {
      return ''
    }
    return getDragDropGroupQuestionIds(questionId).find((candidateId) => (
      candidateId !== questionId && String(options.getRawAnswer(candidateId) || '').trim() === normalizedOption
    )) || ''
  }

  function isDragOptionUnavailable(questionId: string, optionValue: unknown): boolean {
    return Boolean(findQuestionUsingDragOption(questionId, optionValue))
  }

  function setDragDropAnswer(questionId: string, value: unknown, assignOptions: AssignAnswerOptions = {}) {
    if (readOnlyMode()) {
      return
    }
    const normalizedValue = String(value || '').trim()
    const sourceQuestionId = normalizeQuestionId(assignOptions.sourceQuestionId)
    options.recordQuestionVisit?.(questionId)
    if (!normalizedValue) {
      options.assignAnswer(questionId, '', { ...assignOptions, track: true })
      return
    }

    const currentValue = options.getAnswerValue(questionId)
    if (sourceQuestionId && sourceQuestionId !== questionId && isDragDropControl(sourceQuestionId)) {
      options.assignAnswer(questionId, normalizedValue, { syncNative: true, track: true })
      options.assignAnswer(sourceQuestionId, currentValue, { syncNative: true, track: true })
      return
    }

    if (findQuestionUsingDragOption(questionId, normalizedValue)) {
      return
    }
    options.assignAnswer(questionId, normalizedValue, { ...assignOptions, track: true })
  }

  function clearDragDropAnswer(questionId: string) {
    if (readOnlyMode()) {
      return
    }
    options.assignAnswer(questionId, '', { syncNative: true, track: true })
    syncDropzoneControl(questionId, '')
    dragInteractionStatus.value = `已清除第 ${getDisplayLabel(questionId)} 题答案。`
  }

  function dropOnAnswerSlot(questionId: string, event: DragEvent) {
    if (readOnlyMode()) {
      return
    }
    const dragPayload = getDragPayloadFromEvent(event)
    if (!dragPayload?.value || !belongsToQuestionGroup(dragPayload, questionId)) {
      return
    }
    setDragDropAnswer(questionId, dragPayload.value, {
      sourceQuestionId: dragPayload.sourceQuestionId,
      syncNative: true
    })
  }

  function handleWorkspaceClick(event: MouseEvent) {
    if (readOnlyMode()) return
    const target = event.target as Element | null
    const clearTarget = target?.closest?.('[data-dropzone-clear]') as HTMLElement | null
    if (clearTarget) {
      const questionId = normalizeQuestionId(clearTarget.dataset?.sourceQuestionId)
      if (questionId) clearDragDropAnswer(questionId)
      return
    }
    const dropzone = getNativeDropzoneElement(target)
    if (dropzone) {
      placeSelectedDragOption(resolveDropzoneQuestionId(dropzone))
      return
    }
    const source = getDragOptionElement(target)
    const dragPayload = buildDragPayloadFromElement(source)
    if (dragPayload) selectionController.select(dragPayload)
  }

  function handleWorkspaceKeydown(event: KeyboardEvent) {
    if (readOnlyMode()) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
    const handled = selectionController.activateKey(event.key, () => {
      const dropzone = getNativeDropzoneElement(target)
      if (dropzone) {
        placeSelectedDragOption(resolveDropzoneQuestionId(dropzone))
        return
      }
      const source = getDragOptionElement(target)
      const dragPayload = buildDragPayloadFromElement(source)
      if (dragPayload) selectionController.select(dragPayload)
    })
    if (handled) event.preventDefault()
  }

  function placeSelectedDragOption(questionId: string) {
    if (!questionId || !isDragDropControl(questionId)) return false
    return selectionController.place(questionId, (_target: string, selected: DragPayload) => {
      if (!belongsToQuestionGroup(selected, questionId)) return false
      const usedBy = findQuestionUsingDragOption(questionId, selected.value)
      if (usedBy) {
        dragInteractionStatus.value = `该选项已用于第 ${getDisplayLabel(usedBy)} 题。`
        return false
      }
      setDragDropAnswer(questionId, selected.value, {
        sourceQuestionId: selected.sourceQuestionId,
        syncNative: true
      })
      syncDropzoneControl(questionId)
      return true
    })
  }

  function handleDragStart(event: DragEvent) {
    if (readOnlyMode()) {
      event.preventDefault()
      return
    }
    const target = event.target as Element | null
    const source = target?.closest?.('[data-drag-value], [data-answer-value], .drag-item, .draggable-word, .card') as HTMLElement | null
    const dragPayload = buildDragPayloadFromElement(source)
    if (!dragPayload?.value) {
      event.preventDefault()
      return
    }
    currentDragPayload.value = dragPayload
    source?.classList?.add('dragging')
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragPayload))
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copyMove'
    }
  }

  function handleDragEnd(event: DragEvent) {
    const target = event.target as Element | null
    target?.closest?.('.dragging')?.classList?.remove('dragging')
    clearDragHoverState()
    currentDragPayload.value = null
  }

  function handleDragOver(event: DragEvent) {
    if (readOnlyMode()) {
      return
    }
    const dropzone = getNativeDropzoneElement(event.target)
    const pool = getDragPoolElement(event.target)
    if (!dropzone && !pool) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = pool ? 'move' : 'copy'
    }
    ;(dropzone || pool)?.classList.add('drag-over')
  }

  function handleDragLeave(event: DragEvent) {
    const target = getNativeDropzoneElement(event.target) || getDragPoolElement(event.target)
    const related = event.relatedTarget as Node | null
    if (target && related && target.contains(related)) {
      return
    }
    target?.classList?.remove('drag-over')
  }

  function handleDrop(event: DragEvent) {
    if (readOnlyMode()) {
      return
    }
    const dragPayload = getDragPayloadFromEvent(event)
    if (!dragPayload?.value && !dragPayload?.sourceQuestionId) {
      return
    }

    const dropzone = getNativeDropzoneElement(event.target)
    if (dropzone) {
      const questionId = resolveDropzoneQuestionId(dropzone)
      if (!questionId || !isDragDropControl(questionId) || !dragPayload?.value
        || !belongsToQuestionGroup(dragPayload, questionId)) {
        return
      }
      event.preventDefault()
      dropzone.classList.remove('drag-over')
      setDragDropAnswer(questionId, dragPayload.value, {
        sourceQuestionId: dragPayload.sourceQuestionId,
        syncNative: true
      })
      return
    }

    const pool = getDragPoolElement(event.target)
    if (pool && dragPayload?.sourceQuestionId) {
      event.preventDefault()
      pool.classList.remove('drag-over')
      clearDragDropAnswer(dragPayload.sourceQuestionId)
    }
  }

  function getDragPayloadFromEvent(event: DragEvent | null | undefined): DragPayload | null {
    const raw = event?.dataTransfer?.getData('text/plain')
    const parsed = parseDragPayload(raw)
    return parsed?.value || parsed?.sourceQuestionId ? parsed : currentDragPayload.value
  }

  function parseDragPayload(rawValue: unknown): DragPayload | null {
    if (!rawValue) {
      return null
    }
    try {
      const parsed = JSON.parse(String(rawValue))
      if (!parsed || typeof parsed !== 'object') {
        return null
      }
      return {
        value: String((parsed as DragPayload).value || '').trim(),
        label: String((parsed as DragPayload).label || (parsed as DragPayload).value || '').trim(),
        sourceQuestionId: normalizeQuestionId((parsed as DragPayload).sourceQuestionId),
        groupId: String((parsed as DragPayload).groupId || '')
      }
    } catch (_) {
      const fallback = String(rawValue || '').trim()
      return fallback ? { value: fallback, label: fallback, sourceQuestionId: '' } : null
    }
  }

  function buildDragPayloadFromElement(element: HTMLElement | null | undefined): DragPayload | null {
    if (!element) {
      return null
    }
    const dataset = element.dataset || {}
    const sourceDropzone = getNativeDropzoneElement(element)
    const sourceQuestionId = normalizeQuestionId(dataset.sourceQuestionId)
      || (sourceDropzone ? resolveDropzoneQuestionId(sourceDropzone) : '')
    const value = String(
      dataset.dragValue
      || dataset.answerValue
      || dataset.heading
      || dataset.option
      || dataset.word
      || dataset.key
      || dataset.value
      || element.getAttribute?.('value')
      || inferDragValueFromLabel(element.textContent)
      || ''
    ).trim()
    const label = String(
      dataset.dragLabel
      || dataset.answerLabel
      || dataset.word
      || element.textContent
      || value
    ).trim()
    const groupId = element.closest<HTMLElement>('[data-group-id]')?.dataset.groupId
      || (sourceQuestionId ? getDragDropGroup(sourceQuestionId)?.groupId : '')
    return value ? { value, label: label || value, sourceQuestionId, groupId } : null
  }

  function belongsToQuestionGroup(selected: DragPayload, questionId: string): boolean {
    return !selected.groupId || selected.groupId === getDragDropGroup(questionId)?.groupId
  }

  function inferDragValueFromLabel(label: unknown): string {
    const text = String(label || '').trim()
    if (!text) {
      return ''
    }
    const leading = text.match(/^([A-Za-z])(?:[.)])?\s+/)
    if (leading) {
      return leading[1].toUpperCase()
    }
    const roman = text.match(/^([ivxlcdm]+)(?:[.)])?\s+/i)
    return roman ? roman[1].toLowerCase() : text
  }

  function getNativeDropzoneElement(target: EventTarget | null | undefined): HTMLElement | null {
    const element = target as Element | null
    return element?.closest?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary') as HTMLElement | null
  }

  function getDragPoolElement(target: EventTarget | null | undefined): HTMLElement | null {
    const element = target as Element | null
    return element?.closest?.(
      '.headings-pool, .options-pool, .cardpool, .option-pool, .pool-items, #word-options, .dragdrop-options'
    ) as HTMLElement | null
  }

  function getDragOptionElement(target: EventTarget | null | undefined): HTMLElement | null {
    const element = target as Element | null
    return element?.closest?.(
      '[data-drag-value], [data-answer-value], .drag-item, .draggable-word, .card'
    ) as HTMLElement | null
  }

  function resolveDropzoneQuestionId(dropzone: HTMLElement | null | undefined): string {
    if (!dropzone) {
      return ''
    }
    const dataset = dropzone.dataset || {}
    const direct = normalizeQuestionId(
      dataset.sourceQuestionId || dataset.question || dataset.questionId || dataset.target
    )
    if (direct) {
      return direct
    }
    const anchor = dropzone.closest?.('[id$="-anchor"]')
    const match = String(anchor?.id || '').match(/q\d+/i)
    return match ? normalizeQuestionId(match[0]) : ''
  }

  function clearDragHoverState() {
    if (typeof document === 'undefined') return
    document.querySelectorAll('.drag-over, .dragging').forEach((element) => {
      element.classList.remove('drag-over', 'dragging')
    })
  }

  function aliasesFor(questionId: string): string[] {
    return resolveAnswerAliases(questionId, payload()?.questionDisplayMap || null)
  }

  function findNativeDropzonesByQuestionId(questionId: string): HTMLElement[] {
    if (typeof document === 'undefined') return []
    const matches: HTMLElement[] = []
    const seen = new Set<Element>()
    const aliases = aliasesFor(questionId)
    for (const alias of aliases) {
      const escaped = escapeCss(alias)
      const selector = [
        `.paragraph-dropzone[data-question="${escaped}"]`,
        `.paragraph-dropzone[data-question-id="${escaped}"]`,
        `.paragraph-dropzone[data-target="${escaped}"]`,
        `.match-dropzone[data-question="${escaped}"]`,
        `.match-dropzone[data-question-id="${escaped}"]`,
        `.match-dropzone[data-target="${escaped}"]`,
        `.drop-target-summary[data-question="${escaped}"]`,
        `.drop-target-summary[data-question-id="${escaped}"]`,
        `.dropzone[data-question="${escaped}"]`,
        `.dropzone[data-question-id="${escaped}"]`,
        `.dropzone[data-target="${escaped}"]`,
        `#${escaped}-dropzone`,
        `#${escaped}-target`
      ].join(', ')
      document.querySelectorAll(selector).forEach((direct) => {
        if (!seen.has(direct)) {
          seen.add(direct)
          matches.push(direct as HTMLElement)
        }
      })
      const anchor = document.getElementById(`${alias}-anchor`)
      const anchored = anchor?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
        || anchor?.parentElement?.querySelector?.('.paragraph-dropzone, .match-dropzone, .drop-target-summary')
      if (anchored && !seen.has(anchored)) {
        seen.add(anchored)
        matches.push(anchored as HTMLElement)
      }
    }
    return matches
  }

  function ensureDropzoneHolder(dropzone: HTMLElement | null | undefined): HTMLElement | null {
    if (!dropzone) {
      return null
    }
    if (dropzone.classList.contains('drop-target-summary')) {
      return dropzone
    }
    let holder = dropzone.querySelector('.dropped-items') as HTMLElement | null
    if (!holder) {
      holder = document.createElement('div')
      holder.className = 'dropped-items'
      dropzone.appendChild(holder)
    }
    return holder
  }

  function clearDropzoneInlineStyle(dropzone: HTMLElement | null | undefined) {
    if (!dropzone) {
      return
    }
    if (dropzone.classList?.contains('drop-target-summary')) {
      dropzone.style.removeProperty('--reading-dropzone-bg')
      dropzone.style.removeProperty('--reading-dropzone-border')
      dropzone.style.backgroundColor = ''
      dropzone.style.borderColor = ''
      dropzone.querySelectorAll?.('.drag-item, .dragdrop-chip').forEach((chip) => {
        const element = chip as HTMLElement
        element.style.backgroundColor = ''
        element.style.borderColor = ''
        element.style.color = ''
      })
      return
    }
    dropzone.style.removeProperty('--reading-dropzone-bg')
    dropzone.style.removeProperty('--reading-dropzone-border')
    dropzone.style.backgroundColor = ''
    dropzone.style.borderColor = ''
    dropzone.querySelectorAll?.('.drag-item, .dragdrop-chip').forEach((chip) => {
      const element = chip as HTMLElement
      element.style.backgroundColor = ''
      element.style.borderColor = ''
      element.style.color = ''
    })
  }

  function syncDropzoneVisualStyles() {
    if (typeof document === 'undefined') {
      return
    }
    document.querySelectorAll(
      '.paragraph-dropzone, .match-dropzone, .drop-target-summary, [data-vue-dropzone="true"]'
    ).forEach((dropzone) => {
      clearDropzoneInlineStyle(dropzone as HTMLElement)
    })
    syncDragSelectionDomState()
  }

  function syncDragSelectionDomState() {
    if (typeof document === 'undefined') return
    const selected = selectionController.getSelected()
    const readOnly = readOnlyMode()
    document.querySelectorAll(
      '[data-drag-value], [data-answer-value], .drag-item, .draggable-word, .card'
    ).forEach((node) => {
      const element = node as HTMLElement
      if (element.dataset.dropzoneClear === 'true') return
      const payload = buildDragPayloadFromElement(element)
      const active = Boolean(
        selected && payload
        && selected.value === payload.value
        && selected.sourceQuestionId === payload.sourceQuestionId
        && selected.groupId === payload.groupId
      )
      if (!['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
        element.tabIndex = readOnly ? -1 : 0
        element.setAttribute('role', 'button')
      } else if ('disabled' in element) {
        ;(element as HTMLButtonElement).disabled = readOnly
      }
      element.setAttribute('aria-pressed', active ? 'true' : 'false')
      element.setAttribute('aria-disabled', readOnly ? 'true' : 'false')
      element.classList.toggle('drag-option-selected', active)
    })
    document.querySelectorAll(
      '.paragraph-dropzone, .match-dropzone, .drop-target-summary'
    ).forEach((node) => {
      const dropzone = node as HTMLElement
      const questionId = resolveDropzoneQuestionId(dropzone)
      if (!questionId || !isDragDropControl(questionId)) return
      dropzone.tabIndex = readOnly ? -1 : 0
      dropzone.setAttribute('role', 'button')
      dropzone.setAttribute('aria-disabled', readOnly ? 'true' : 'false')
      dropzone.setAttribute(
        'aria-label',
        `第 ${getDisplayLabel(questionId)} 题目标，当前${getSelectedOptionLabel(questionId)}`
      )
    })
  }

  function isInsideDropzoneElement(element: Element | null | undefined): boolean {
    return Boolean(element?.closest?.(DROPZONE_ELEMENT_SELECTOR))
  }

  // Pool selectors overlap dropzone markup ([data-answer-value], .drag-item),
  // so dropzones and their chips must never count as pool items.
  function isPoolDropzoneCandidate(element: Element | null | undefined): boolean {
    return Boolean(element?.hasAttribute?.('data-question')) || isInsideDropzoneElement(element)
  }

  // Label lookup is group-scoped: the same value ("A") can label different
  // options in sibling groups, so a document-global query returns the wrong one.
  function nativeDragOptionLabel(value: string, scopeRoot: ParentNode | null = null): string {
    if (typeof document === 'undefined' || !value) {
      return ''
    }
    const escaped = escapeCss(value)
    const selector = [
      `[data-drag-value="${escaped}"]`,
      `[data-answer-value="${escaped}"]`,
      `[data-heading="${escaped}"]`,
      `[data-option="${escaped}"]`,
      `[data-word="${escaped}"]`,
      `[data-value="${escaped}"]`
    ].join(', ')
    const root = scopeRoot || document
    const source = Array.from(root.querySelectorAll(selector)).find(
      (element) => !isInsideDropzoneElement(element)
    )
    return String(source?.textContent || '').trim()
  }

  function findQuestionGroupByElement(element: Element | null | undefined): ReadingQuestionGroup | null {
    const container = element?.closest?.('[data-group-id]') as HTMLElement | null
    const groupId = String(container?.dataset?.groupId || '').trim()
    if (!groupId) {
      return null
    }
    return payload()?.questionGroups?.find(
      (group) => String(group.groupId || '').trim() === groupId
    ) || null
  }

  // Consumption is group-scoped: a pool value is consumed only when one of its
  // own group's questions holds it, and never when the group allows reuse.
  // When the owning group cannot be resolved, fail open (stay interactive).
  function isDragOptionConsumedByGroup(group: ReadingQuestionGroup | null, value: string): boolean {
    if (!group) {
      return false
    }
    const normalized = String(value || '').trim()
    if (!normalized) {
      return false
    }
    return (Array.isArray(group.questionIds) ? group.questionIds : []).some((questionId) => {
      if (allowsDragOptionReuse(questionId)) return false
      const current = options.getRawAnswer(questionId)
      return Array.isArray(current)
        ? current.includes(normalized)
        : String(current || '').trim() === normalized
    })
  }

  function syncDropzoneControl(questionId: string, explicitValue: ReadingAnswerValue = options.getRawAnswer(questionId)) {
    const dropzones = findNativeDropzonesByQuestionId(questionId)
    if (!dropzones.length) {
      return
    }
    const value = String(Array.isArray(explicitValue) ? explicitValue[0] || '' : explicitValue || '').trim()
    const option = getOptions(questionId).find((entry) => String(entry.value || '').trim() === value)
    const readOnly = readOnlyMode()
    dropzones.forEach((dropzone) => {
      // Resolve the label inside the dropzone's own group so sibling groups'
      // pools (same letters, different labels) cannot shadow it. Fall back to
      // the global lookup only when no group container exists (old markup).
      const groupScope = dropzone.closest('[data-group-id]')
      const label = option?.label
        || (groupScope ? nativeDragOptionLabel(value, groupScope) : nativeDragOptionLabel(value))
        || value
      dropzone.dataset.answerValue = value
      dropzone.dataset.answerLabel = label
      dropzone.dataset.sourceQuestionId = questionId
      dropzone.setAttribute('data-vue-dropzone', 'true')
      dropzone.classList.toggle('dropzone-filled', Boolean(value))
      dropzone.classList.toggle('dropzone-empty', !value)
      dropzone.setAttribute('aria-disabled', readOnly ? 'true' : 'false')
      dropzone.tabIndex = readOnly ? -1 : 0
      dropzone.setAttribute('role', 'button')
      dropzone.setAttribute('aria-label', `第 ${getDisplayLabel(questionId)} 题目标，当前${label || '未作答'}`)
      clearDropzoneInlineStyle(dropzone)

      const holder = ensureDropzoneHolder(dropzone)
      if (!holder) {
        return
      }
      holder.innerHTML = ''
      if (!value) {
        return
      }

      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'drag-item dragdrop-chip dragdrop-chip-assigned'
      chip.textContent = label
      chip.dataset.answerValue = value
      chip.dataset.answerLabel = label
      chip.dataset.sourceQuestionId = questionId
      chip.dataset.dropzoneClear = 'true'
      chip.draggable = !readOnly
      chip.disabled = readOnly
      holder.appendChild(chip)
    })
  }

  function syncPoolConsumedState() {
    if (typeof document === 'undefined') return
    document.querySelectorAll(
      '[data-drag-value], [data-answer-value], [data-heading], .drag-item, .draggable-word, .card'
    ).forEach((node) => {
      const element = node as HTMLElement
      if (element.dataset.dropzoneClear === 'true') return
      const dragPayload = buildDragPayloadFromElement(element)
      const used = !isPoolDropzoneCandidate(element) && Boolean(
        dragPayload?.value
        && isDragOptionConsumedByGroup(findQuestionGroupByElement(element), dragPayload.value)
      )
      element.classList.toggle('option-consumed', used)
    })
  }

  function setReadOnlyDomControls(readOnly: boolean, syncNativeControl?: (questionId: string) => void) {
    if (typeof document === 'undefined') {
      return
    }
    if (readOnly) {
      selectionController.clear()
    }
    document.querySelectorAll('.question-panel input, .question-panel textarea, .question-panel select').forEach((control) => {
      const element = control as HTMLInputElement
      element.disabled = Boolean(readOnly)
      element.tabIndex = readOnly ? -1 : 0
      element.setAttribute('aria-disabled', readOnly ? 'true' : 'false')
    })
    payload()?.questionOrder?.forEach((questionId) => {
      if (isDragDropControl(questionId)) {
        if (syncNativeControl) {
          syncNativeControl(questionId)
        } else {
          syncDropzoneControl(questionId)
        }
      }
    })
  }

  return {
    currentDragPayload,
    selectedDragOption,
    dragInteractionStatus,
    getInteraction,
    getDisplayLabel,
    isChoiceControl,
    isDragDropControl,
    getOptions,
    isMultiValueCheckbox,
    getDragDropGroup,
    getDragDropGroupQuestionIds,
    allowsDragOptionReuse,
    getSelectedOption,
    getSelectedOptionLabel,
    findQuestionUsingDragOption,
    isDragOptionUnavailable,
    setDragDropAnswer,
    clearDragDropAnswer,
    dropOnAnswerSlot,
    handleWorkspaceClick,
    handleWorkspaceKeydown,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getDragPayloadFromEvent,
    parseDragPayload,
    buildDragPayloadFromElement,
    getNativeDropzoneElement,
    getDragPoolElement,
    resolveDropzoneQuestionId,
    clearDragHoverState,
    findNativeDropzonesByQuestionId,
    ensureDropzoneHolder,
    clearDropzoneInlineStyle,
    syncDropzoneVisualStyles,
    syncDropzoneControl,
    syncPoolConsumedState,
    setReadOnlyDomControls,
    aliasesFor,
    expandQuestionSequence,
    normalizeQuestionId,
    escapeCss
  }
}
