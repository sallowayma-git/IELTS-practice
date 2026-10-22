/**
 * Notebook doodle pools. Each pool is a map of name -> inner markup of a
 * 64x64 viewBox SVG (stroke currentColor). Rendered through Doodle.vue, which
 * applies the crayon wobble. Icons feed small marks (daily cards, empty
 * state); objects feed big art (weekly shelf cards, detail-sheet header).
 */
import { ICONS } from './art/icons.js'
import { OBJECTS } from './art/objects.js'

export const ICON_NAMES = Object.keys(ICONS)
export const OBJECT_NAMES = Object.keys(OBJECTS)

function hashText(seed) {
  const text = String(seed || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

/** Deterministic pick so a card's art never flickers on re-render. */
function pickFrom(names, seed) {
  return names[hashText(seed) % names.length]
}

export function pickIcon(seed) {
  return pickFrom(ICON_NAMES, seed)
}

export function pickObject(seed) {
  return pickFrom(OBJECT_NAMES, seed)
}

export function doodleMarkup(name) {
  return ICONS[name] || OBJECTS[name] || ICONS['open-book']
}
