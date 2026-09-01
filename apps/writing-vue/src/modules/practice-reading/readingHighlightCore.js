/**
 * DOM-free highlight / dictionary helpers.
 * Keep pure so Node tests can lock snapshot shape without a browser.
 */

export function normalizeComparableText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeHighlightSnapshot(value, options = {}) {
  const normalizeQuestionId = typeof options.normalizeQuestionId === 'function'
    ? options.normalizeQuestionId
    : (raw) => String(raw || '').trim()

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
      const annotationId = entry.id ?? entry.annotationId
      return {
        id: annotationId ? String(annotationId) : null,
        scope: scope === 'passage' || scope === 'questions' ? scope : 'unknown',
        text,
        kind: entry.kind === 'note' ? 'note' : 'highlight',
        questionId: normalizeQuestionId(entry.questionId) || null,
        startOffset: Number.isFinite(startOffset) ? startOffset : null,
        endOffset: Number.isFinite(endOffset) ? endOffset : null,
        before: normalizeComparableText(entry.before),
        after: normalizeComparableText(entry.after),
        occurrence: Number.isFinite(Number(entry.occurrence)) ? Math.max(0, Number(entry.occurrence)) : 0,
        createdAt: entry.createdAt || new Date().toISOString(),
        mismatch: entry.mismatch ? String(entry.mismatch) : null
      }
    })
    .filter(Boolean)
}

export function collectHighlightAnnotationIds(entries) {
  return new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const raw = entry?.id
          || entry?.annotationId
          || entry?.node?.dataset?.annotationId
        return raw ? String(raw) : ''
      })
      .filter(Boolean)
  )
}

export function findSequentialTextMatch(fullText, needle, cursor = 0) {
  const haystack = String(fullText || '')
  const text = String(needle || '')
  if (!text) return null
  const start = haystack.indexOf(text, Math.max(0, Number(cursor) || 0))
  if (start < 0) return null
  const end = start + text.length
  return { start, end, nextCursor: end }
}

export function resolveSupersededAnnotationCleanup({
  previousId,
  persistedId,
  generationCurrent,
  nodeConnected
} = {}) {
  if (previousId || !persistedId) return null
  return generationCurrent && nodeConnected !== false ? null : String(persistedId)
}

export function formatDictionaryLookupMeaning(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  if (Array.isArray(result.parts) && result.parts.length) {
    return result.parts
      .map((part) => {
        const label = normalizeComparableText(part.term || part.lemma || part.requested)
        const meaning = normalizeComparableText(part.zh || part.meaning || part.en || part.definition)
        return [label, meaning].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .join('；')
  }
  return normalizeComparableText(result.zh || result.meaning || result.en || result.definition || result.example)
}

export function formatDictionaryLookupMeta(result) {
  if (!result || typeof result !== 'object') {
    return ''
  }
  return [
    result.phonetic ? `/${normalizeComparableText(result.phonetic)}/` : '',
    normalizeComparableText(result.pos || result.partOfSpeech),
    normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  ].filter(Boolean).join(' · ')
}

export function normalizeDictionaryLookupPart(part) {
  if (!part || typeof part !== 'object') {
    return null
  }
  const term = normalizeComparableText(part.term || part.lemma || part.requested)
  const meaning = normalizeComparableText(part.zh || part.meaning)
  const definition = normalizeComparableText(part.en || part.definition)
  if (!term && !meaning && !definition) {
    return null
  }
  return {
    term: term || '高亮词',
    meta: formatDictionaryLookupMeta(part),
    meaning,
    definition
  }
}

export function normalizeDictionaryLookupResult(result, fallbackTerm) {
  if (!result || typeof result !== 'object') {
    return {
      found: false,
      term: normalizeComparableText(fallbackTerm),
      meaning: '',
      definition: '',
      example: '',
      meta: '本地词典',
      sourceLine: '',
      parts: [],
      phonetic: '',
      partOfSpeech: '',
      sourceLabel: '本地词典',
      license: ''
    }
  }
  const parts = Array.isArray(result.parts)
    ? result.parts.map(normalizeDictionaryLookupPart).filter(Boolean)
    : []
  const sourceLabel = normalizeComparableText(result.sourceLabel || (result.source === 'ecdict' ? 'ECDICT' : '本地词典'))
  const license = normalizeComparableText(result.license)
  return {
    found: Boolean(result.found),
    term: normalizeComparableText(result.term || result.lemma || result.requested || fallbackTerm),
    meaning: normalizeComparableText(result.zh || result.meaning),
    definition: normalizeComparableText(result.en || result.definition),
    example: normalizeComparableText(result.example),
    meta: parts.length ? '' : formatDictionaryLookupMeta({ ...result, sourceLabel }),
    sourceLine: sourceLabel ? [sourceLabel, license].filter(Boolean).join(' · ') : '',
    parts,
    phonetic: normalizeComparableText(result.phonetic),
    partOfSpeech: normalizeComparableText(result.pos || result.partOfSpeech),
    sourceLabel,
    license
  }
}

export default {
  normalizeComparableText,
  escapeRegExp,
  normalizeHighlightSnapshot,
  collectHighlightAnnotationIds,
  findSequentialTextMatch,
  resolveSupersededAnnotationCleanup,
  formatDictionaryLookupMeaning,
  formatDictionaryLookupMeta,
  normalizeDictionaryLookupPart,
  normalizeDictionaryLookupResult
}
