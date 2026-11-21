import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const { computed, ref } = require('vue')
const ts = require('typescript')
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const script = path => read(path).split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')

test('catalog cards preserve and deduplicate secondary source names', () => {
  const source = read('plug/jiufen/library.js').replace(/^import .*$/gm, '').replace(/export /g, '')
  const state = new Function('computed', 'ref', 'jiufen', `${source}; return { rows, remoteCards }`)(computed, ref, {})
  state.rows.value = [
    { id: 'r1', channel: 'reading', parts: ['P1'], hotlist: [{part:'P1',rank:3}], albums: [{ title: 'Z家阅读11月高频' }, { title: '阅读精选' }, { title: '阅读精选' }] },
    { id: 'l1', channel: 'listening', parts: ['P4'] }
  ]
  assert.deepEqual(state.remoteCards('reading').value[0].sourceTags, ['Z家阅读11月高频', '阅读精选'])
  assert.deepEqual(state.remoteCards('listening').value[0].sourceTags, [])
  assert.deepEqual(state.remoteCards('reading').value[0].hotlist, [{part:'P1',rank:3}])
  assert.deepEqual(state.remoteCards('listening').value[0].hotlist, [])
})

test('catalog partial refresh keeps cards and exposes retry feedback with legacy cache compatibility', async () => {
  const source = read('plug/jiufen/library.js').replace(/^import .*$/gm, '').replace(/export /g, '')
  const row = {id:'r1',channel:'reading',parts:['P1']}
  const api = {restore:async()=>true, library:async refresh=>refresh ? {items:[row],warning:'热榜同步未完成'} : [row]}
  const state = new Function('computed','ref','jiufen', `${source}; return {rows,libraryError,syncLibrary,resetLibrary,remoteCards}`)(computed,ref,api)
  await state.syncLibrary()
  assert.equal(state.remoteCards('reading').value.length,1)
  assert.equal(state.libraryError.value,'热榜同步未完成')
  api.library = async () => ({items:[{...row,hotlist:[{part:'P1',rank:2}]}],warning:null})
  await state.syncLibrary()
  assert.equal(state.libraryError.value,'')
  assert.equal(state.rows.value[0].hotlist.length,1)
  state.resetLibrary()
  assert.deepEqual(state.rows.value,[])
})

test('shared question navigation supports all four listening Parts and keeps reading defaults', () => {
  const source = script('apps/writing-vue/src/modules/reading-unified/components/UnifiedPracticeNav.vue')
  const props = {
    questionOrder: ['q1', 'q2'], displayMap: { q1: '31', q2: '32' }, category: 'P4',
    hasAnswer: id => id === 'q1', isMarked: () => false, reviewMode: false,
    sections: [1, 2, 3, 4].map(section => ({ section, questionIds: section === 4 ? ['q1', 'q2'] : [] }))
  }
  const evaluate = props => new Function('defineProps', 'defineEmits', 'computed', 'ref', `${source}; return { partSections, activePartKey }`)(() => props, () => {}, computed, ref)
  const result = evaluate(props)
  assert.equal(result.activePartKey.value, 'p4')
  assert.equal(result.partSections.value.length, 4)
  assert.deepEqual(result.partSections.value[3].questions.map(q => q.label), ['31', '32'])
  assert.equal(result.partSections.value[3].answeredCount, 1)
  assert.equal(result.partSections.value[0].total, 0)
  const review = evaluate({ ...props, reviewMode: true, answerComparison: {
    q1: { isCorrect: false }, q2: { isCorrect: false }
  } })
  assert.equal(review.partSections.value[3].answeredCount, 1, 'graded blanks are still unanswered')
  const reading = evaluate({ ...props, category: 'P2', sections: null })
  assert.equal(reading.partSections.value.length, 3)
  assert.equal(reading.partSections.value[0].total, 13)
  assert.equal(reading.partSections.value[1].placeholder, false)
})

test('listening hotlist filter composes with source, Part and frequency', async () => {
  const source = read('apps/writing-vue/src/views/ListeningLibraryPage.vue')
    .split('<script setup>')[1].split('</script>')[0]
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
  const remote = ref([
    {id:'hot',title:'Online',provider:'jiufen',parts:['P1','P4'],category:'P1 / P4',frequency:'high',hotlist:[{part:'P4',rank:5}]},
    {id:'plain',title:'Online high',provider:'jiufen',parts:['P4'],category:'P4',frequency:'high'}
  ])
  const deps = { computed,ref,onMounted:()=>{},useRouter:()=>({}),useRoute:()=>({}),remoteCards:()=>remote,articleCards:ref([]) }
  const state = new Function(...Object.keys(deps), `${source}; return {assets,hotlistOnly,sourceFilter,partFilter,frequencyFilter,filteredAssets}`)(...Object.values(deps))
  state.assets.value = [{id:'local',title:'Local',category:'P4',frequency:'high'}]
  const ids = () => state.filteredAssets.value.map(item => item.id)
  state.hotlistOnly.value = true
  assert.deepEqual(ids(), ['hot'])
  state.partFilter.value = 'P1'
  assert.deepEqual(ids(), [])
  state.partFilter.value = 'P4'
  state.frequencyFilter.value = 'high'
  assert.deepEqual(ids(), ['hot'])
  state.frequencyFilter.value = 'low'
  assert.deepEqual(ids(), [])
  state.frequencyFilter.value = 'high'
  state.sourceFilter.value = 'local'
  assert.deepEqual(ids(), [])
  state.hotlistOnly.value = false
  assert.deepEqual(ids(), ['local'])
})

test('matching selects restore saved answers and become read-only in review', () => {
  const ids = { exports: {} }
  const compiled = ts.transpileModule(read('apps/writing-vue/src/modules/practice-reading/readingQuestionIds.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText
  new Function('exports', compiled)(ids.exports)
  const source = read('apps/writing-vue/src/modules/reading-unified/composables/useNativeAnswerControls.js')
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]/g, '').replace(/export /g, '')
  const select = { value: '', disabled: false, setAttribute() {} }
  const document = { querySelectorAll: selector => selector.includes('select[name="q1"]') ? [select] : [] }
  const dependencies = { ...ids.exports, document }
  const create = new Function(...Object.keys(dependencies), `${source}; return useNativeAnswerControls`)(...Object.values(dependencies))
  let readOnly = false
  const controls = create({ payloadSource: () => ({ questionDisplayMap: { q1: '31' } }),
    readOnlySource: () => readOnly, getInteraction: () => null, getRawAnswer: () => 'B',
    getAnswerEntries: () => [['q1', 'B']], setAnswer: () => {}, isDragDropControl: () => false, syncDropzoneControl: () => {} })
  controls.syncDomAnswers()
  assert.equal(select.value, 'B')
  assert.equal(select.disabled, false)
  readOnly = true
  controls.syncDomAnswers()
  assert.equal(select.disabled, true)
})
