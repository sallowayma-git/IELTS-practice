import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const { computed, ref } = appRequire('vue')
const ts = appRequire('typescript')
const exporter = path.join(root, 'developer/tests/tools/reading-json/export_generated_reading_dataset.node.js')
const shippingPack = path.join(root, 'assets/resource-pack/reading')
const generatedPack = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-explanation-export-'))
after(() => {
  assert.equal(path.dirname(generatedPack), path.resolve(os.tmpdir()))
  fs.rmSync(generatedPack, { recursive: true, force: true })
})
execFileSync(process.execPath, [exporter, '--output-dir', generatedPack], { cwd: root })

const readJson = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'))
const manifest = readJson(path.join(generatedPack, 'manifest.json'))
const examId = 'p1-low-61'
const entry = manifest.entries.find((item) => item.examId === examId)
const shipped = readJson(path.join(shippingPack, entry.file))
const sourceContext = vm.createContext({
  __READING_EXPLANATION_DATA__: { register(id, payload) { this[id] = payload } }
})
const explanationRoot = path.join(root, 'assets/generated/reading-explanations')
vm.runInContext(fs.readFileSync(path.join(explanationRoot, 'manifest.js'), 'utf8'), sourceContext)

test('resource export includes registered explanations and hashes the complete payload', () => {
  assert.equal(manifest.assetCount, manifest.entries.length)
  for (const item of manifest.entries) {
    const raw = fs.readFileSync(path.join(generatedPack, item.file))
    assert.equal(createHash('sha256').update(raw).digest('hex'), item.sha256, item.examId)
    const explanationEntry = sourceContext.__READING_EXPLANATION_MANIFEST__[item.examId]
    const payload = JSON.parse(raw)
    if (!explanationEntry) {
      assert.equal(payload.reviewExplanations, undefined, item.examId)
      continue
    }
    const sourcePath = path.resolve(root, 'assets/generated/reading-exams', explanationEntry.script)
    vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), sourceContext)
    const expected = JSON.parse(JSON.stringify(sourceContext.__READING_EXPLANATION_DATA__[explanationEntry.dataKey]))
    assert.deepEqual(payload.reviewExplanations, expected, item.examId)
  }
})

test('shipped carnivorous-plants payload and manifest match a fresh export byte for byte', () => {
  assert.deepEqual(
    fs.readFileSync(path.join(shippingPack, entry.file)),
    fs.readFileSync(path.join(generatedPack, entry.file))
  )
  const shippingManifest = readJson(path.join(shippingPack, 'manifest.json'))
  assert.deepEqual(shippingManifest.entries.find((item) => item.examId === examId), entry)
})

function reviewGetters(payloadValue) {
  const page = fs.readFileSync(path.join(root, 'apps/writing-vue/src/views/PracticeReadingPage.vue'), 'utf8')
  const getters = page.slice(page.indexOf('const officialReviewExplanations ='), page.indexOf('const suiteSequence ='))
  const normalizers = page.slice(page.indexOf('function normalizeOfficialQuestionExplanationSection('), page.indexOf('function getQuestionOfficialNumber('))
  assert.ok(getters && normalizers, 'Atlas review getters and normalizers must be present')
  const idsSource = fs.readFileSync(path.join(root, 'apps/writing-vue/src/modules/practice-reading/readingQuestionIds.ts'), 'utf8')
  const idsModule = { exports: {} }
  const compiled = ts.transpileModule(idsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('exports', compiled)(idsModule.exports)
  const reviewMode = ref(false)
  const getValues = new Function('computed', 'reviewMode', 'payload', 'normalizeQuestionId', `
    ${normalizers}
    ${getters}
    return { officialPassageNotes, officialQuestionExplanationSections }
  `)
  return { reviewMode, ...getValues(computed, reviewMode, ref(payloadValue), idsModule.exports.normalizeQuestionId) }
}

test('Atlas review receives paragraphs A-I and Q1-Q13 with Q6 displayed as 6', () => {
  const review = reviewGetters(shipped)
  assert.deepEqual(review.officialPassageNotes.value, [])
  assert.deepEqual(review.officialQuestionExplanationSections.value, [])
  review.reviewMode.value = true
  assert.deepEqual(review.officialPassageNotes.value.map((note) => note.label),
    Array.from('ABCDEFGHI', (label) => `Paragraph ${label}`))
  const items = review.officialQuestionExplanationSections.value.flatMap((section) => section.items)
  assert.deepEqual(items.map((item) => item.questionId), shipped.questionOrder)
  assert.deepEqual(items.map((item) => item.questionNumber), Array.from({ length: 13 }, (_, index) => index + 1))
  assert.equal(items.find((item) => item.questionId === 'q6').questionNumber, 6)
  for (const item of items) {
    assert.equal(item.text.match(/答案：([^\n]+)/)?.[1].trim(), shipped.answerKey[item.questionId])
  }
  review.reviewMode.value = false
  assert.deepEqual(review.officialPassageNotes.value, [])
  assert.deepEqual(review.officialQuestionExplanationSections.value, [])
})

test('Atlas still accepts reading payloads without official explanations', () => {
  const { reviewExplanations, ...withoutExplanations } = shipped
  const review = reviewGetters(withoutExplanations)
  review.reviewMode.value = true
  assert.deepEqual(review.officialPassageNotes.value, [])
  assert.deepEqual(review.officialQuestionExplanationSections.value, [])
})
