function safeParseJsonString(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function extractTextFromTiptap(content) {
  const normalized = safeParseJsonString(content)

  if (normalized == null) return ''
  if (typeof normalized === 'string') return normalized
  if (Array.isArray(normalized)) {
    return normalized.map((item) => extractTextFromTiptap(item)).join('')
  }
  if (normalized.type === 'text') return normalized.text || ''
  if (Array.isArray(normalized.content)) {
    return normalized.content.map((item) => extractTextFromTiptap(item)).join('')
  }
  return ''
}

export function renderTopicTitle(titleJson) {
  return extractTextFromTiptap(titleJson)
}

export function getTopicTitlePreview(titleJson, { fallback = '自由写作', maxLength = 50 } = {}) {
  if (!titleJson) return fallback

  const text = extractTextFromTiptap(titleJson)
  if (text) return text.substring(0, maxLength)

  if (typeof titleJson === 'string') {
    return titleJson.substring(0, maxLength) || fallback
  }
  return fallback
}

