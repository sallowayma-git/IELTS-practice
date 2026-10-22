/**
 * Turns clean hand-drawn SVG markup into crayon-rough markup using rough.js.
 *
 * Each supported primitive (path/circle/ellipse/rect/line/polyline) is
 * redrawn as a rough.js "sketchy" path: sharp-angled, irregular, double
 * stroked. Filled shapes get a fill in their own colour: a scribbled zigzag
 * for 'crayon', a flat solid fill with a thin outline for 'soft'.
 * Everything is deterministic per `seed` and memoised.
 */
import rough from 'roughjs'

let generatorInstance
function generator() {
  if (!generatorInstance) generatorInstance = rough.generator()
  return generatorInstance
}

function hashSeed(text) {
  let h = 0
  const s = String(text || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h || 1
}

function darken(hex, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const channel = (shift) => Math.max(0, Math.round(((n >> shift) & 0xff) * (1 - amount)))
  const value = (channel(16) << 16) | (channel(8) << 8) | channel(0)
  return `#${value.toString(16).padStart(6, '0')}`
}

function num(el, attr, fallback = 0) {
  const v = parseFloat(el.getAttribute(attr))
  return Number.isNaN(v) ? fallback : v
}

function readPoints(el) {
  const raw = (el.getAttribute('points') || '').trim()
  const nums = raw.split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n))
  const points = []
  for (let i = 0; i < nums.length - 1; i += 2) points.push([nums[i], nums[i + 1]])
  return points
}

const COMMON_OPTIONS = { preserveVertices: false, curveFitting: 0.9 }

/**
 * Intensity presets. 'crayon' is the notebook's waxy default; 'soft' is the
 * near-flat look used by mascots (lighter wobble, solid fills, thin edge).
 */
const PRESETS = {
  crayon: {
    base: { roughness: 1.4, bowing: 1, disableMultiStroke: false, curveStepCount: 9 },
    line: {},
    fill: { fillStyle: 'zigzag', hachureGap: 1.8, fillWeight: 2.4, edgeShift: 0.25 }
  },
  soft: {
    base: { roughness: 0.5, bowing: 0.3, disableMultiStroke: true, curveStepCount: 14 },
    line: { roughness: 0.4 },
    fill: { fillStyle: 'solid', edgeShift: 0.2, edgeWidth: 1.2 }
  }
}

function presetFor(intensity) {
  return PRESETS[intensity] || PRESETS.crayon
}

/** Build a rough.js drawable for one SVG primitive element. */
function drawableFor(el, options) {
  const g = generator()
  const tag = el.tagName.toLowerCase()
  if (tag === 'path') return g.path(el.getAttribute('d') || '', options)
  if (tag === 'circle') return g.circle(num(el, 'cx'), num(el, 'cy'), num(el, 'r', 1) * 2, options)
  if (tag === 'ellipse') return g.ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'rx') * 2, num(el, 'ry') * 2, options)
  if (tag === 'rect') return g.rectangle(num(el, 'x'), num(el, 'y'), num(el, 'width'), num(el, 'height'), options)
  if (tag === 'line') return g.line(num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2'), options)
  if (tag === 'polyline') return g.linearPath(readPoints(el), options)
  return null
}

/** Serialise a rough drawable's path segments into `<path>` markup. */
function pathsMarkup(drawable) {
  return generator().toPaths(drawable).map((p) => {
    const fill = p.fill ? ` fill="${p.fill}"` : ' fill="none"'
    return `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}"${fill} stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')
}

function isSmallDot(el) {
  return el.tagName.toLowerCase() === 'circle' && num(el, 'r', 0) < 3
}

/** Options for a filled element: edge in a darker shade of the fill. */
function fillOptions(base, color, seed, fill) {
  const { edgeShift, edgeWidth, ...fillStyle } = fill
  return {
    ...base,
    ...fillStyle,
    stroke: darken(color, edgeShift),
    strokeWidth: edgeWidth ?? base.strokeWidth,
    fill: color,
    hachureAngle: (seed % 180) - 90
  }
}

/** Rough.js options for one element, tuned by the preset. */
function optionsFor(el, seed, preset) {
  const strokeWidth = (parseFloat(el.getAttribute('stroke-width')) || 3) * 0.85
  const fillAttr = el.getAttribute('fill')
  const strokeAttr = el.getAttribute('stroke')
  const base = { ...COMMON_OPTIONS, ...preset.base, seed, strokeWidth }
  if (fillAttr && fillAttr !== 'none') return fillOptions(base, fillAttr, seed, preset.fill)
  return {
    ...base,
    ...preset.line,
    stroke: strokeAttr === 'none' ? 'none' : (strokeAttr || 'currentColor'),
    fill: 'none'
  }
}

/** Outline for a tiny dot: a rough ring in the dot's own colour. */
function dotOutline(el, seed, preset) {
  return pathsMarkup(drawableFor(el, {
    ...COMMON_OPTIONS,
    ...preset.base,
    seed,
    strokeWidth: 1.4,
    stroke: el.getAttribute('fill') || 'currentColor',
    fill: 'none'
  }))
}

/** Convert one element (recursing into `<g>`) into crayon markup. */
function convert(el, ctx, index) {
  const tag = el.tagName.toLowerCase()
  if (tag === 'g') {
    const inner = Array.from(el.children).map((child, i) => convert(child, ctx, index * 16 + i)).join('')
    const transform = el.getAttribute('transform')
    return `<g${transform ? ` transform="${transform}"` : ''}>${inner}</g>`
  }
  const seed = (hashSeed(ctx.seed) + index * 97) % 2147483647 || 1
  if (isSmallDot(el)) return el.outerHTML + dotOutline(el, seed, ctx.preset)
  const drawable = drawableFor(el, optionsFor(el, seed, ctx.preset))
  return drawable ? pathsMarkup(drawable) : el.outerHTML
}

const cache = new Map()

/**
 * crayonize(markup, { seed, mode, intensity }) -> new SVG inner markup, roughened.
 * `markup` is the inner content of a 64x64 viewBox SVG (paths/circles/etc).
 * `intensity`: 'crayon' (default, waxy) or 'soft' (near-flat, mascots).
 */
export function crayonize(markup, { seed = '', mode = 'stroke', intensity = 'crayon' } = {}) {
  if (typeof DOMParser === 'undefined') return markup
  const key = `${intensity}|${mode}|${seed}|${hashSeed(markup)}`
  if (cache.has(key)) return cache.get(key)

  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${markup}</svg>`,
    'image/svg+xml'
  )
  if (doc.querySelector('parsererror')) return markup

  const ctx = { seed, preset: presetFor(intensity) }
  const out = Array.from(doc.documentElement.children)
    .map((el, i) => convert(el, ctx, i))
    .join('')
  cache.set(key, out)
  return out
}
