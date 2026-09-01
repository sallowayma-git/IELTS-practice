/**
 * Pure question-id helpers shared by reading practice surfaces.
 * Keep this free of Vue/DOM so typecheck and unit callers stay cheap.
 */

export function normalizeQuestionId(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  const direct = raw.match(/^q(\d+)$/)
  if (direct) return `q${Number(direct[1])}`
  const numeric = raw.match(/^(\d+)$/)
  return numeric ? `q${Number(numeric[1])}` : raw
}

export function expandQuestionSequence(rawValue: unknown): string[] {
  const value = String(rawValue || '').trim().toLowerCase()
  const numbers = (value.match(/\d+/g) || []).map((entry) => Number(entry))
  if ((value.includes('-') || value.includes('–')) && numbers.length === 2 && numbers[1] >= numbers[0]) {
    const ids: string[] = []
    for (let current = numbers[0]; current <= numbers[1]; current += 1) {
      ids.push(`q${current}`)
    }
    return ids
  }
  if ((value.includes('_') || value.includes('-') || value.includes('–')) && numbers.length >= 2) {
    return numbers.map((entry) => `q${entry}`)
  }
  const normalized = normalizeQuestionId(value)
  return normalized ? [normalized] : []
}

export function escapeCss(value: unknown): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(String(value))
  }
  return String(value).replace(/["\\]/g, '\\$&')
}

export function resolveAnswerAliases(
  questionId: unknown,
  questionDisplayMap: Record<string, unknown> | null | undefined = null
): string[] {
  const normalized = normalizeQuestionId(questionId)
  if (!normalized) return []
  const numeric = normalized.replace(/^q/i, '')
  const displayLabel = String(questionDisplayMap?.[normalized] || '').trim()
  return Array.from(new Set([
    normalized,
    numeric,
    `question${numeric}`,
    displayLabel,
    displayLabel ? `q${displayLabel}` : ''
  ].filter(Boolean)))
}
