import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')

// Real id helpers from the shipping module (same transpile trick as
// readingExplanationExport.test.mjs) so the tests expand names exactly like
// the page does.
const idsSource = fs.readFileSync(
  path.join(root, 'apps/writing-vue/src/modules/practice-reading/readingQuestionIds.ts'),
  'utf8'
)
const idsModule = { exports: {} }
const idsCompiled = ts.transpileModule(idsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
new Function('exports', idsCompiled)(idsModule.exports)
const { expandQuestionSequence } = idsModule.exports

// The pure checkbox core lives inside ReadingUnifiedPage.vue between slice
// markers and is evaluated here directly (the page script is plain JS).
const pagePath = path.join(root, 'apps/writing-vue/src/views/ReadingUnifiedPage.vue')
const page = fs.readFileSync(pagePath, 'utf8')
const coreStart = page.indexOf('// --- unified checkbox core')
const coreEnd = page.indexOf('// --- end unified checkbox core')
assert.ok(coreStart >= 0 && coreEnd > coreStart, 'unified checkbox core must stay extractable from ReadingUnifiedPage.vue')
const { planCheckboxAnswerWrites, collectCheckboxGroupTicks } = new Function(`
${page.slice(coreStart, coreEnd)}
return { planCheckboxAnswerWrites, collectCheckboxGroupTicks }
`)()

function checkboxBox(name, value) {
  return { name, value, checked: false, disabled: false }
}

// Harness mirroring the page wiring end to end: collectCheckboxGroup writes
// answers through planCheckboxAnswerWrites + setAnswer (what gets SUBMITTED),
// syncNativeCheckboxGroups ticks boxes through collectCheckboxGroupTicks.
function createHarness(boxDefinitions) {
  const boxes = boxDefinitions.map(([name, value]) => checkboxBox(name, value))
  const answers = new Map()
  const store = {
    setAnswer(questionId, value) { answers.set(questionId, value) },
    getRawAnswer(questionId) {
      const value = answers.get(questionId)
      return value === undefined ? '' : value
    },
    raw: answers,
    // initializeAnswers semantics: every slot reset to ''.
    resetAll(questionIds) { questionIds.forEach((id) => answers.set(id, '')) }
  }
  return {
    boxes,
    store,
    collect(name) {
      const checkedValues = boxes
        .filter((box) => box.name === name && box.checked)
        .map((box) => String(box.value || '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, 'en'))
      planCheckboxAnswerWrites(expandQuestionSequence(name), checkedValues)
        .forEach((write) => store.setAnswer(write.questionId, write.value))
    },
    sync(questionId, { readOnly = false } = {}) {
      const groups = new Map()
      boxes.forEach((box) => {
        const members = groups.get(box.name) || []
        members.push(box)
        groups.set(box.name, members)
      })
      groups.forEach((members, name) => {
        const memberIds = expandQuestionSequence(name)
        if (!memberIds.includes(questionId)) return
        const ticks = collectCheckboxGroupTicks(memberIds, store.getRawAnswer)
        members.forEach((box) => {
          box.checked = ticks.has(String(box.value || '').trim())
          box.disabled = readOnly
        })
      })
    },
    checkedValues(name) {
      return boxes.filter((box) => box.name === name && box.checked).map((box) => box.value)
    }
  }
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

// R1: single-id groups (p1-medium-57 name="q11", answerKey q11 = ["C","E","G"])
// must store the FULL sorted array — not just the first checked value.
{
  const harness = createHarness(LETTERS.map((letter) => ['q11', letter]))
  ;['C', 'E', 'G'].forEach((letter) => {
    harness.boxes.find((box) => box.value === letter).checked = true
  })
  harness.collect('q11')
  assert.deepEqual(harness.store.raw.get('q11'), ['C', 'E', 'G'],
    'single-id checkbox group submits the full sorted answer array')
}

// R1: nothing checked submits an empty array (not the scalar '').
{
  const harness = createHarness(LETTERS.map((letter) => ['q11', letter]))
  harness.collect('q11')
  assert.deepEqual(harness.store.raw.get('q11'), [],
    'unchecked single-id group submits an empty array')
}

// R1 (no regression): compound groups keep today's scalar distribution —
// draft-style name="q9_10" with A and C checked lands on q9/q10.
{
  const harness = createHarness(['A', 'B', 'C', 'D', 'E'].map((letter) => ['q9_10', letter]))
  ;['A', 'C'].forEach((letter) => {
    harness.boxes.find((box) => box.value === letter).checked = true
  })
  harness.collect('q9_10')
  assert.equal(harness.store.raw.get('q9'), 'A')
  assert.equal(harness.store.raw.get('q10'), 'C')
}

// R1 (no regression): dash-range names ("q11-12-13") distribute scalars too.
{
  const harness = createHarness(['A', 'B', 'C', 'D'].map((letter) => ['q11-12-13', letter]))
  ;['B', 'D'].forEach((letter) => {
    harness.boxes.find((box) => box.value === letter).checked = true
  })
  harness.collect('q11-12-13')
  assert.deepEqual(
    ['q11', 'q12', 'q13'].map((id) => harness.store.raw.get(id)),
    ['B', 'D', '']
  )
}

// R2: draft restore {q9:"A", q10:"C"} must tick A and C under the compound
// native name q9_10 when syncing either member question.
{
  const harness = createHarness(['A', 'B', 'C', 'D', 'E'].map((letter) => ['q9_10', letter]))
  harness.store.setAnswer('q9', 'A')
  harness.store.setAnswer('q10', 'C')
  harness.sync('q9')
  assert.deepEqual(harness.checkedValues('q9_10'), ['A', 'C'],
    'compound group ticks from the union of member answers')
  harness.sync('q10')
  assert.deepEqual(harness.checkedValues('q9_10'), ['A', 'C'])
}

// R2: Reset (initializeAnswers clears every slot to '') unticks everything.
{
  const harness = createHarness(['A', 'B', 'C', 'D', 'E'].map((letter) => ['q9_10', letter]))
  harness.store.setAnswer('q9', 'A')
  harness.store.setAnswer('q10', 'C')
  harness.sync('q9')
  harness.store.resetAll(['q9', 'q10'])
  harness.sync('q9')
  harness.sync('q10')
  assert.deepEqual(harness.checkedValues('q9_10'), [],
    'reset answers must untick the whole compound group')
}

// R2: array answers restored into a single-id group tick every member value.
{
  const harness = createHarness(LETTERS.map((letter) => ['q11', letter]))
  harness.store.setAnswer('q11', ['C', 'E', 'G'])
  harness.sync('q11')
  assert.deepEqual(harness.checkedValues('q11'), ['C', 'E', 'G'])
}

// R2: read-only sync disables the boxes; unrelated groups stay untouched.
{
  const harness = createHarness([
    ...['A', 'B', 'C'].map((letter) => ['q9_10', letter]),
    ...LETTERS.map((letter) => ['q1', letter])
  ])
  harness.store.setAnswer('q9', 'A')
  harness.sync('q9', { readOnly: true })
  const q9Group = harness.boxes.filter((box) => box.name === 'q9_10')
  assert.ok(q9Group.every((box) => box.disabled), 'review mode disables the synced group')
  const q1Group = harness.boxes.filter((box) => box.name === 'q1')
  assert.ok(q1Group.every((box) => !box.disabled && !box.checked),
    'syncing one question must not touch unrelated groups')
}

// Round trip: user ticks -> submitted answer map -> DOM wiped -> resync.
// The reviewer's contract: the SUBMITTED answers and the visible ticks agree.
{
  const harness = createHarness([
    ...LETTERS.map((letter) => ['q11', letter]),
    ...['A', 'B', 'C', 'D', 'E'].map((letter) => ['q9_10', letter])
  ])
  ;['C', 'E', 'G'].forEach((letter) => {
    harness.boxes.find((box) => box.name === 'q11' && box.value === letter).checked = true
  })
  harness.boxes.find((box) => box.name === 'q9_10' && box.value === 'A').checked = true
  harness.collect('q11')
  harness.collect('q9_10')
  assert.deepEqual(harness.store.raw.get('q11'), ['C', 'E', 'G'])
  assert.equal(harness.store.raw.get('q9'), 'A')
  harness.boxes.forEach((box) => { box.checked = false })
  ;['q9', 'q10', 'q11'].forEach((questionId) => harness.sync(questionId))
  assert.deepEqual(harness.checkedValues('q11'), ['C', 'E', 'G'])
  assert.deepEqual(harness.checkedValues('q9_10'), ['A'])
}

// Page wiring guards: the extracted core must actually be what the page uses,
// and the sibling review fixes (R5/R7/R8) must stay in place.
{
  const syncBody = page.slice(page.indexOf('function syncNativeControl'), page.indexOf('function scheduleDraftAutosave'))
  assert.ok(syncBody.includes('syncNativeCheckboxGroups(questionId)'),
    'syncNativeControl must route checkboxes through syncNativeCheckboxGroups')
  assert.ok(!syncBody.includes('checkbox"][name='),
    'syncNativeControl must not query checkboxes through per-alias names')
  const collectBody = page.slice(page.indexOf('function collectCheckboxGroup'), page.indexOf('function syncNativeCheckboxGroups'))
  assert.ok(collectBody.includes('planCheckboxAnswerWrites(expandQuestionSequence(name), checkedValues)'),
    'collectCheckboxGroup must write answers through planCheckboxAnswerWrites')

  // R5: drag mutations autosave via onMutate, hydration excluded.
  assert.ok(page.includes('if (!hydratingAnswers.value) scheduleDraftAutosave()'),
    'onMutate must autosave outside hydration')
  assert.ok(page.includes('hydratingAnswers.value = true'),
    'loadAsset must mark the hydration window')

  // R7: every passage note is rendered, not just passageNotes[blockIndex].
  assert.ok(page.includes('v-for="(note, noteIndex) in passageNotes"'),
    'passage notes must render as their own list')
  assert.ok(!page.includes('passageNotes[index]'),
    'passage notes must not be indexed by passage block')

  // R8: the timer click binding resolves.
  assert.ok(page.includes('@click="toggleTimer"'))
  assert.ok(!page.includes('toggleTimer: togglePracticeTimer'),
    'toggleTimer must be bound without the dead rename')
}

console.log('reading unified checkbox answers: ok')
