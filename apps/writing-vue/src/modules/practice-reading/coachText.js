/**
 * Coach answers are plain text with the occasional fenced block, `code` span
 * or **bold** run. This splits them into render-ready pieces (no HTML string
 * ever exists, so nothing the model writes can inject markup). Lists and line
 * breaks stay as text; the bubble keeps them with white-space: pre-wrap.
 *
 * Streaming-safe: an unterminated fence is a code block that has not ended yet.
 */

const FENCE = /^```[^\n]*$/
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/

const CACHE_LIMIT = 200
const cache = new Map()

function inlineParts(line) {
  return line.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('`')) return { kind: 'code', text: part.slice(1, -1) }
    if (part.startsWith('**')) return { kind: 'strong', text: part.slice(2, -2) }
    return { kind: 'text', text: part }
  })
}

function closeText(blocks, lines) {
  // Blank lines hugging a code block are spacing the block already provides.
  const body = lines.join('\n').replace(/^\n+|\n+$/g, '')
  lines.length = 0
  if (body.trim()) blocks.push({ type: 'text', parts: inlineParts(body) })
}

function parse(content) {
  const blocks = []
  const text = []
  const code = []
  let inCode = false
  for (const line of String(content || '').split('\n')) {
    if (!FENCE.test(line.trim())) {
      ;(inCode ? code : text).push(line)
      continue
    }
    if (inCode) blocks.push({ type: 'code', text: code.join('\n') })
    else closeText(blocks, text)
    code.length = 0
    inCode = !inCode
  }
  if (inCode) blocks.push({ type: 'code', text: code.join('\n') })
  closeText(blocks, text)
  return blocks
}

export function parseCoachText(content) {
  const key = String(content || '')
  const hit = cache.get(key)
  if (hit) return hit
  const blocks = parse(key)
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value)
  cache.set(key, blocks)
  return blocks
}
