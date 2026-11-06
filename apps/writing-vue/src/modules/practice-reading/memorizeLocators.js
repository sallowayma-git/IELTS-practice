/**
 * Memorize-mode study layer: wraps the first passage match of each answer
 * token in .memorize-locator-highlight so the answer evidence is visible.
 */
import { normalizeComparableText } from './readingHighlightCore.js'

export function applyMemorizeLocatorHighlights(questionId, answerText, getTextNodes) {
  const root = document.getElementById('left')
  if (!root) return
  const tokens = String(answerText || '')
    .split(/[;,/|]/)
    .map((entry) => entry.replace(/^\s*[A-Z]\.\s*/, '').trim())
    .filter((entry) => entry.length >= 3)
    .slice(0, 3)
  tokens.forEach((token) => {
    wrapTextMatches(root, token, getTextNodes, {
      className: 'memorize-locator-highlight',
      attrs: {
        'data-memorize-question-id': questionId
      },
      limit: 1,
      skipSelector: '.hl, .memorize-locator-highlight'
    })
  })
}

export function clearMemorizeLocatorHighlights() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('.memorize-locator-highlight').forEach((node) => {
    const parent = node.parentNode
    if (!parent) return
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node)
    }
    parent.removeChild(node)
    parent.normalize()
  })
}

function wrapTextMatches(root, needle, getTextNodes, options = {}) {
  const text = normalizeComparableText(needle)
  if (!root || text.length < 3) {
    return []
  }
  const matches = []
  const className = options.className || 'hl'
  const attrs = options.attrs || {}
  const limit = Math.max(1, Number(options.limit) || 20)
  const skipSelector = options.skipSelector || '.hl'
  const nodes = getTextNodes(root)
  for (let index = 0; index < nodes.length && matches.length < limit; index += 1) {
    let current = nodes[index]
    if (current.parentElement?.closest?.(skipSelector)) {
      continue
    }
    while (current && matches.length < limit) {
      const source = current.nodeValue || ''
      const hit = source.toLowerCase().indexOf(text.toLowerCase())
      if (hit < 0) break
      const matchedNode = current.splitText(hit)
      const remainder = matchedNode.splitText(text.length)
      const span = document.createElement('span')
      span.className = className
      Object.entries(attrs).forEach(([key, value]) => {
        if (value != null) {
          span.setAttribute(key, String(value))
        }
      })
      matchedNode.parentNode.insertBefore(span, matchedNode)
      span.appendChild(matchedNode)
      matches.push(span)
      current = remainder
    }
  }
  return matches
}
