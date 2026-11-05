import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

// The notes editor is a modal dialog. Its Tab trap must stay inside the dialog:
// the wrapper it sits in also holds the notes drawer, whose closed buttons are
// only slid off-screen (review finding on PR #264).

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
// The Windows runner checks sources out with CRLF; markup assertions use LF.
const readApp = (path) => readFileSync(new URL(`../../../apps/writing-vue/src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const compiled = ts.transpileModule(readApp('modules/practice-reading/useReadingUiPreferences.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function load() {
  const vue = { ref: (value) => ({ value }), watch: () => {}, nextTick: async () => {} }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name === 'vue') return vue
      if (name.endsWith('useTauriPreferences.js')) return { useTauriPreferences: () => ({ get: () => '', set: () => {} }) }
      if (name.endsWith('enrichment-repository.js')) return { upsertAnnotation: async () => ({}), listAnnotations: async () => ({ items: [] }), deleteAnnotation: async () => ({}) }
      return appRequire(name)
    },
    module, module.exports
  )
  return module.exports.useReadingUiPreferences({ assetSource: () => ({ id: 'P1' }) })
}

// A button-ish element that records focus; `document.activeElement` follows it.
function element(name) {
  const el = { name, hidden: false, focus() { globalThis.document.activeElement = el } }
  return el
}

// notesPanel = a wrapper holding [drawer buttons..., a role=dialog editor].
function scene() {
  const drawer = [element('drawer-new'), element('drawer-close'), element('drawer-row')]
  const editor = [element('editor-close'), element('editor-body')]
  const dialog = { querySelectorAll: () => editor }
  const wrapper = {
    querySelector: (selector) => (selector === '[role="dialog"]' ? dialog : null),
    querySelectorAll: () => [...drawer, ...editor]
  }
  return { drawer, editor, wrapper }
}

function tab(prefs, { shift = false } = {}) {
  let prevented = false
  prefs.handleNotesDialogKeydown({ key: 'Tab', shiftKey: shift, preventDefault: () => { prevented = true }, stopPropagation() {} })
  return prevented
}

test('Tab cycles inside the editor dialog and never reaches the drawer buttons', () => {
  const prefs = load()
  const { editor, wrapper } = scene()
  globalThis.document = { activeElement: null }
  prefs.notesPanel.value = wrapper
  prefs.notesPanelOpen.value = true

  editor[1].focus()
  assert.ok(tab(prefs))
  assert.equal(document.activeElement.name, 'editor-close', 'from the last control it wraps to the first, inside the dialog')
  assert.ok(tab(prefs))
  assert.equal(document.activeElement.name, 'editor-body')
  assert.ok(tab(prefs, { shift: true }))
  assert.equal(document.activeElement.name, 'editor-close')
  assert.ok(tab(prefs, { shift: true }))
  assert.equal(document.activeElement.name, 'editor-body', 'Shift+Tab wraps backwards inside the dialog')
})

test('focus that is already in the drawer is pulled back into the dialog', () => {
  const prefs = load()
  const { drawer, wrapper } = scene()
  globalThis.document = { activeElement: null }
  prefs.notesPanel.value = wrapper
  prefs.notesPanelOpen.value = true

  drawer[2].focus()
  assert.ok(tab(prefs))
  assert.equal(document.activeElement.name, 'editor-close')
})

test('with the editor closed the trap does nothing', () => {
  const prefs = load()
  const { drawer, wrapper } = scene()
  globalThis.document = { activeElement: null }
  prefs.notesPanel.value = wrapper
  prefs.notesPanelOpen.value = false
  drawer[0].focus()
  assert.equal(tab(prefs), false)
  assert.equal(document.activeElement.name, 'drawer-new')
})

test('the closed drawer keeps its buttons out of the Tab order, the open drawer does not', () => {
  const source = readApp('modules/reading-unified/components/UnifiedNotes.vue')
  // One computed decides it, and every drawer button uses it.
  assert.match(source, /const drawerTabindex = computed\(\(\) => \(props\.drawerOpen \? undefined : -1\)\)/)
  for (const cls of ['reading-note-outline-add', 'reading-note-close" type="button" aria-label="关闭笔记列表', 'reading-note-open']) {
    const at = source.indexOf(cls)
    assert.ok(at > 0, cls)
    const tag = source.slice(source.lastIndexOf('<button', at), source.indexOf('>', at))
    assert.ok(tag.includes(':tabindex="drawerTabindex"'), `${cls} follows the drawer state`)
  }
  // The editor's own close button is not part of the drawer.
  const editorClose = source.slice(source.indexOf('aria-label="关闭笔记"') - 80, source.indexOf('aria-label="关闭笔记"') + 80)
  assert.ok(!editorClose.includes('drawerTabindex'))
  // No inert/visibility/display: those would move the exam-freeze computed styles.
  const template = source.slice(0, source.indexOf('</template>'))
  assert.ok(!/[:\s]inert[\s=>]/.test(template) && !/:style="[^"]*(visibility|display)/.test(template.replace(/editorOpen \? editorStyle : \{ display: 'none' \}/, '')), 'the drawer is not inert / hidden by style')
})
