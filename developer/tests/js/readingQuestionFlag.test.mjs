import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// Question flags ("mark for review") in the unified reading nav.
//   1. useMarkedQuestions: toggle / normalize / de-duplicate / read-only /
//      autosave only on user toggles (hydration and reset never save).
//   2. UnifiedPracticeNav + QuestionFlag: the real SFCs are compiled and
//      mounted on a tiny in-memory renderer (no DOM library needed), then
//      driven with the same mouse/focus events the browser sends.
//   3. The page wiring and host-extras.css, checked as source.

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const Vue = appRequire('vue')
const { parse, compileScript } = appRequire('@vue/compiler-sfc')
const { transformSync } = appRequire('esbuild')

// The Windows runner checks sources out with CRLF; every assertion below is written with LF.
const readRepo = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const readApp = (path) => readRepo(`apps/writing-vue/src/${path}`)

const ids = { exports: {} }
new Function('exports', ts.transpileModule(readApp('modules/practice-reading/readingQuestionIds.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText)(ids.exports)
const { normalizeQuestionId } = ids.exports

const { useMarkedQuestions } = await import(
  new URL('../../../apps/writing-vue/src/modules/reading-unified/composables/useMarkedQuestions.js', import.meta.url).href
)

// ---- 1. state ---------------------------------------------------------------

function marks({ readOnly = false } = {}) {
  const saves = []
  const state = useMarkedQuestions({
    normalizeId: normalizeQuestionId,
    isReadOnly: () => readOnly,
    onUserChange: (id) => saves.push(id)
  })
  return { ...state, saves, setReadOnly: (value) => { readOnly = value } }
}

test('toggling marks then unmarks, and every user toggle asks for a draft save', () => {
  const m = marks()
  m.toggleMarkedQuestion('q3')
  assert.deepEqual(m.markedQuestions.value, ['q3'])
  assert.equal(m.isMarkedQuestion('q3'), true)
  m.toggleMarkedQuestion('q3')
  assert.deepEqual(m.markedQuestions.value, [])
  assert.equal(m.isMarkedQuestion('q3'), false)
  assert.deepEqual(m.saves, ['q3', 'q3'])
})

test('question ids are normalized: "3", "Q3" and " q03 " are the same question', () => {
  const m = marks()
  m.toggleMarkedQuestion('3')
  assert.deepEqual(m.markedQuestions.value, ['q3'])
  assert.equal(m.isMarkedQuestion('Q3'), true)
  assert.equal(m.isMarkedQuestion(' q03 '), true)
  m.toggleMarkedQuestion('Q3')
  assert.deepEqual(m.markedQuestions.value, [])
})

test('toggling never produces duplicates and ignores empty ids', () => {
  const m = marks()
  m.toggleMarkedQuestion('q1')
  m.toggleMarkedQuestion('q2')
  m.toggleMarkedQuestion('1')
  m.toggleMarkedQuestion('')
  m.toggleMarkedQuestion(null)
  assert.deepEqual(m.markedQuestions.value, ['q2'])
  assert.deepEqual(m.saves, ['q1', 'q2', 'q1'], 'an ignored id must not trigger a save')
})

test('read-only (review, replay, memorize) refuses toggles and saves nothing', () => {
  const m = marks({ readOnly: true })
  m.restoreMarkedQuestions(['q4'])
  m.toggleMarkedQuestion('q4')
  m.toggleMarkedQuestion('q5')
  assert.deepEqual(m.markedQuestions.value, ['q4'])
  assert.deepEqual(m.saves, [])
  m.setReadOnly(false)
  m.toggleMarkedQuestion('q5')
  assert.deepEqual(m.markedQuestions.value, ['q4', 'q5'])
})

test('hydration from a draft or a submission normalizes, de-duplicates and never saves', () => {
  const m = marks()
  m.restoreMarkedQuestions(['q2', '2', 'Q2', 'q7', '', null, 'q7'])
  assert.deepEqual(m.markedQuestions.value, ['q2', 'q7'])
  m.restoreMarkedQuestions(undefined)
  assert.deepEqual(m.markedQuestions.value, [])
  m.restoreMarkedQuestions(['q9'])
  m.clearMarkedQuestions()
  assert.deepEqual(m.markedQuestions.value, [])
  assert.deepEqual(m.saves, [], 'restore/clear are not user edits')
})

// ---- 2. components ----------------------------------------------------------

class Node {
  constructor(tag) { this.tag = tag; this.props = {}; this.children = []; this.parent = null; this.text = '' }
  contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false }
}

const renderer = Vue.createRenderer({
  patchProp(el, key, _prev, next) { if (next == null) delete el.props[key]; else el.props[key] = next },
  createElement: (tag) => new Node(tag),
  createText: (text) => Object.assign(new Node('#text'), { text }),
  createComment: (text) => Object.assign(new Node('#comment'), { text }),
  setText: (node, text) => { node.text = text },
  setElementText: (el, text) => { el.children = text ? [Object.assign(new Node('#text'), { text, parent: el })] : [] },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    const at = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(at < 0 ? parent.children.length : at, 0, child)
    child.parent = parent
  },
  remove(child) {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
})

function loadSfc(path, modules = {}) {
  const { descriptor } = parse(readApp(path), { filename: path })
  const script = compileScript(descriptor, {
    id: path,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } }
  })
  const { code } = transformSync(script.content, { format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  const load = (name) => (name === 'vue' ? Vue : modules[name])
  new Function('require', 'module', 'exports', code)(load, mod, mod.exports)
  return mod.exports.default
}

const QuestionFlag = loadSfc('modules/reading-unified/components/QuestionFlag.vue')
const Nav = loadSfc('modules/reading-unified/components/UnifiedPracticeNav.vue', { './QuestionFlag.vue': { __esModule: true, default: QuestionFlag } })

const walk = (node, visit) => { visit(node); node.children.forEach((child) => walk(child, visit)) }
const find = (root, predicate) => { const hits = []; walk(root, (node) => predicate(node) && hits.push(node)); return hits }
const hasClass = (node, name) => String(node.props.class || '').split(/\s+/).includes(name)
const flags = (root) => find(root, (node) => 'data-question-flag' in node.props)
const column = (root, id) => find(root, (node) => hasClass(node, 'q-column') && node.props['data-question-id'] === id)[0]
const chipOf = (col) => col.children.find((node) => hasClass(node, 'q-item'))
const fire = (node, event, payload = {}) => {
  const handlers = [].concat(node.props[event] || [])
  assert.ok(handlers.length, `${node.tag} has no ${event} handler`)
  const evt = { target: { matches: () => true }, currentTarget: node, relatedTarget: null, ...payload }
  handlers.flat().forEach((handler) => handler(evt))
}

function mountNav(overrides = {}) {
  const state = reactiveProps({
    questionOrder: ['q1', 'q2', 'q3'],
    displayMap: { q1: '1', q2: '2', q3: '3' },
    category: 'P1',
    hasAnswer: () => false,
    isMarked: () => false,
    ...overrides
  })
  const emitted = []
  const root = new Node('root')
  const app = renderer.createApp({
    render: () => Vue.h(Nav, { ...state.props, onToggleMarkedQuestion: (id) => emitted.push(id) })
  })
  app.mount(root)
  return { root, emitted, set: state.set }
}

function reactiveProps(initial) {
  const props = Vue.reactive({ ...initial })
  return { props, set: (patch) => Object.assign(props, patch) }
}

test('idle nav: no flag in the DOM, no flag-only classes, nothing marked', async () => {
  const { root } = mountNav()
  await Vue.nextTick()
  assert.equal(flags(root).length, 0)
  assert.equal(find(root, (node) => hasClass(node, 'has-flag')).length, 0)
  assert.equal(find(root, (node) => hasClass(node, 'is-marked')).length, 0)
  const columns = find(root, (node) => hasClass(node, 'q-column'))
  assert.equal(columns.length, 3)
  columns.forEach((col) => assert.equal(col.children.filter((node) => node.tag !== '#comment').length, 2, 'bar segment + number only'))
})

test('hover mounts the flag right after the number, inside the same hover box, and leaving removes it', async () => {
  const { root } = mountNav()
  const col = column(root, 'q2')
  fire(col, 'onMouseenter')
  await Vue.nextTick()
  const [flag] = flags(root)
  assert.ok(flag, 'flag mounted on hover')
  assert.equal(flag.tag, 'button')
  assert.equal(flag.props.type, 'button')
  assert.equal(flag.parent, col, 'the flag is inside the column that owns the hover handlers')
  assert.equal(col.children[col.children.indexOf(chipOf(col)) + 1], flag, 'DOM order: number, then flag (Tab reaches it next)')
  assert.ok(hasClass(col, 'has-flag'))
  assert.equal(flags(root).length, 1, 'only the hovered number has one')
  fire(col, 'onMouseleave')
  await Vue.nextTick()
  assert.equal(flags(root).length, 0)
  assert.equal(find(root, (node) => hasClass(node, 'has-flag')).length, 0)
})

test('a late mouseleave from the previous number does not close the new hover', async () => {
  const { root } = mountNav()
  fire(column(root, 'q1'), 'onMouseenter')
  fire(column(root, 'q2'), 'onMouseenter')
  fire(column(root, 'q1'), 'onMouseleave')
  await Vue.nextTick()
  assert.deepEqual(flags(root).map((node) => node.parent.props['data-question-id']), ['q2'])
})

test('keyboard focus mounts the flag; mouse focus does not; focus moving onto the flag keeps it', async () => {
  const { root } = mountNav()
  const col = column(root, 'q1')
  fire(col, 'onFocusin', { target: { matches: () => false } })
  await Vue.nextTick()
  assert.equal(flags(root).length, 0, 'clicking a number must not pin its flag')
  fire(col, 'onFocusin')
  await Vue.nextTick()
  assert.equal(flags(root).length, 1)
  fire(col, 'onFocusout', { relatedTarget: flags(root)[0] })
  await Vue.nextTick()
  assert.equal(flags(root).length, 1, 'chip -> flag stays inside the focus box')
  fire(col, 'onFocusout', { relatedTarget: chipOf(column(root, 'q2')) })
  await Vue.nextTick()
  assert.equal(flags(root).length, 0, 'focus leaving the column unmounts it')
})

test('flag semantics: toggle button with aria-pressed and a numbered label, click emits the question id', async () => {
  const { root, emitted } = mountNav({ displayMap: { q1: '1', q2: '14', q3: '3' } })
  fire(column(root, 'q2'), 'onMouseenter')
  await Vue.nextTick()
  const [flag] = flags(root)
  assert.equal(flag.props['aria-pressed'], 'false')
  assert.equal(flag.props['aria-label'], '标记第 14 题', 'uses the page display number, not the q-id')
  assert.equal(flag.props.title, '标记第 14 题')
  assert.ok(!hasClass(flag, 'is-marked'))
  fire(flag, 'onClick')
  assert.deepEqual(emitted, ['q2'])
})

test('marked: the flag is permanent (no hover), red-state class, labelled as an undo, number framed', async () => {
  const { root, emitted } = mountNav({ isMarked: (id) => id === 'q3' })
  await Vue.nextTick()
  const [flag] = flags(root)
  assert.equal(flags(root).length, 1)
  assert.equal(flag.parent, column(root, 'q3'))
  assert.equal(flag.props['aria-pressed'], 'true')
  assert.equal(flag.props['aria-label'], '取消标记第 3 题')
  assert.ok(hasClass(flag, 'is-marked'))
  assert.ok(hasClass(chipOf(column(root, 'q3')), 'is-marked'))
  assert.ok(!hasClass(chipOf(column(root, 'q1')), 'is-marked'))
  fire(flag, 'onClick')
  assert.deepEqual(emitted, ['q3'])
})

test('toggling keeps the flag mounted (focus is not lost) and follows the new marked state', async () => {
  let marked = []
  const { root, set } = mountNav({ isMarked: (id) => marked.includes(id) })
  fire(column(root, 'q1'), 'onMouseenter')
  await Vue.nextTick()
  const before = flags(root)[0]
  marked = ['q1']
  set({ isMarked: (id) => marked.includes(id) })
  await Vue.nextTick()
  assert.equal(flags(root)[0], before, 'same element: the browser keeps focus on it')
  assert.equal(before.props['aria-pressed'], 'true')
  marked = []
  set({ isMarked: (id) => marked.includes(id) })
  await Vue.nextTick()
  assert.equal(flags(root)[0], before)
  assert.equal(before.props['aria-pressed'], 'false')
})

test('read-only: no hover or focus entry, a marked flag is an inert labelled image', async () => {
  const { root, emitted } = mountNav({ flagsReadOnly: true, isMarked: (id) => id === 'q2' })
  fire(column(root, 'q1'), 'onMouseenter')
  fire(column(root, 'q3'), 'onFocusin')
  await Vue.nextTick()
  const [flag] = flags(root)
  assert.equal(flags(root).length, 1, 'only the marked one')
  assert.equal(flag.tag, 'span')
  assert.equal(flag.props.role, 'img')
  assert.equal(flag.props['aria-label'], '第 2 题已标记')
  assert.equal(flag.props.type, undefined)
  assert.equal(flag.props['aria-pressed'], undefined)
  assert.ok(hasClass(flag, 'is-static') && hasClass(flag, 'is-marked'))
  fire(flag, 'onClick')
  assert.deepEqual(emitted, [], 'nothing to toggle in review')
})

test('component contract: props and events', () => {
  const nav = readApp('modules/reading-unified/components/UnifiedPracticeNav.vue')
  assert.match(nav, /isMarked: \{ type: Function, default: \(\) => false \}/)
  assert.match(nav, /flagsReadOnly: \{ type: Boolean, default: false \}/)
  assert.match(nav, /defineEmits\(\[[^\]]*'toggle-marked-question'\]\)/)
  for (const event of ['@mouseenter', '@mouseleave', '@focusin', '@focusout']) {
    assert.ok(nav.includes(event), `${event} drives the flag`)
  }
  assert.match(nav, /<QuestionFlag\n\s+v-if="showFlag\(question\)"/)
})

// ---- 3. page wiring ----------------------------------------------------------

test('the page owns marks through useMarkedQuestions and wires them to the nav and the autosave', () => {
  const page = readApp('views/PracticeReadingPage.vue')
  assert.match(page, /onUserChange: \(\) => scheduleDraftAutosave\(\)/, 'a toggle uses the same autosave as answers')
  assert.match(page, /isReadOnly: \(\) => readOnlyMode\.value/)
  assert.match(page, /:is-marked="isMarkedQuestion"/)
  assert.match(page, /:flags-read-only="readOnlyMode"/)
  assert.match(page, /@toggle-marked-question="toggleMarkedQuestion"/)
  assert.doesNotMatch(page, /markedQuestions\.value\s*=[^=]/, 'all writes go through restore / clear / toggle')
  assert.match(page, /if \(marked\.length\) restoreMarkedQuestions\(marked\)/, 'draft hydration')
  assert.match(page, /restoreMarkedQuestions\(loadedSubmission\?\.markedQuestions\)/, 'submission hydration')
  assert.match(page, /clearMarkedQuestions\(\)/, 'reset')
  const saves = (page.match(/markedQuestions: markedQuestions\.value\.slice\(\)/g) || []).length
  assert.ok(saves >= 3, 'suite, endless and single drafts all carry the marks')
  assert.match(page, /markedQuestions,\n/, 'the submit path still receives the list')
})

// ---- 4. styles ---------------------------------------------------------------

const css = readApp('modules/practice-reading/styles/host-extras.css')
const flagCss = css.slice(css.indexOf('/* ---- question flags'))

function rules(source) {
  const bare = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    props: Object.fromEntries(body.split(';').map((line) => line.split(/:(.+)/).map((part) => part?.trim())).filter(([key]) => key))
  }))
}

test('flag styles live in the host stylesheet, never in the generated skin', () => {
  assert.ok(flagCss.startsWith('/* ---- question flags'))
  assert.ok(!readApp('modules/reading-unified/styles/unified.css').includes('q-flag'))
})

test('every flag rule is scoped under .runified', () => {
  const selectors = rules(flagCss).filter(({ selector }) => !/^(from|to)$/.test(selector) && !selector.startsWith('@'))
  assert.ok(selectors.length > 8)
  for (const { selector } of selectors) {
    for (const part of selector.split(',').map((entry) => entry.trim())) {
      assert.ok(part.startsWith('.runified'), `unscoped selector: ${part}`)
    }
  }
})

test('light and dark carry their own red token; the flag is drawn from tokens', () => {
  const all = rules(flagCss)
  const light = all.find(({ selector }) => selector === '.runified')
  const dark = all.find(({ selector }) => selector === '.runified.dark-mode')
  assert.ok(light?.props['--runified-flag'] && light.props['--runified-flag-bg'])
  assert.ok(dark?.props['--runified-flag'] && dark.props['--runified-flag-bg'])
  assert.notEqual(light.props['--runified-flag'], dark.props['--runified-flag'])
  const marked = all.find(({ selector }) => selector.includes('.q-flag.is-marked') && selector.includes(':hover'))
  assert.equal(marked.props.color, 'var(--runified-flag)')
  assert.match(all.find(({ selector }) => selector === '.runified .q-flag').props.color, /^var\(--/)
})

test('no rule resizes a number chip or its column; the only layout rule is net-zero', () => {
  const geometry = /^(width|height|min-width|min-height|max-width|max-height|padding.*|margin.*|border(-width)?|border-(top|right|bottom|left)(-width)?|display|flex.*|gap|inset|top|right|bottom|left|line-height|font-size)$/
  const touched = rules(flagCss).filter(({ selector }) => /\.q-item|\.q-column|\.part-nav-questions/.test(selector))
  assert.ok(touched.length >= 3)
  for (const { selector, props } of touched) {
    if (selector.includes('.part-nav-questions')) {
      // Scroll-container clip widening: padding and margin cancel exactly.
      assert.equal(props['padding-block'], props['margin-block'].replace('-', ''))
      assert.ok(props['margin-block'].startsWith('-'))
      assert.deepEqual(Object.keys(props).sort(), ['margin-block', 'padding-block'])
      continue
    }
    const bad = Object.keys(props).filter((key) => geometry.test(key))
    assert.deepEqual(bad, [], `${selector} must not change size or layout`)
  }
  assert.equal(rules(flagCss).find(({ selector }) => selector === '.runified .q-column.has-flag').props.position, 'relative')
})

test('the flag is an overlay with a fixed size and no touch-floor leak', () => {
  const flag = rules(flagCss).find(({ selector }) => selector === '.runified .q-flag').props
  assert.equal(flag.position, 'absolute')
  assert.equal(flag['min-width'], '0')
  assert.equal(flag['min-height'], '0')
  for (const { props } of rules(flagCss)) {
    for (const value of Object.values(props)) {
      assert.ok(!/44px|a11y-min-target|touch-target/.test(value), `touch floor leaked: ${value}`)
    }
  }
})

test('reduced motion turns the entrance off', () => {
  const block = flagCss.slice(flagCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(block, /\.runified \.q-flag \{\s*animation: none;/)
})
