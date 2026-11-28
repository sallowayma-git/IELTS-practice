import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { useDraftSaveQueue } from '../../../apps/writing-vue/src/modules/reading-unified/composables/useDraftSaveQueue.js'
import { createListeningDraftClock, readListeningDraftPosition } from '../../../apps/writing-vue/src/modules/practice-listening/listeningDraftState.js'
import { mergeListeningStudyMaterial } from '../../../apps/writing-vue/src/modules/practice-listening/listeningStudyMaterial.js'

const require = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const { computed, ref } = require('vue')
const ts = require('typescript')
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
const script = path => read(path).split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')

test('failed autosave keeps the draft dirty and a manual retry writes the latest answers', async () => {
  let answer = 'A'
  let writes = 0
  const persisted = []
  const queue = useDraftSaveQueue(async () => {
    if (++writes === 1) throw new Error('disk temporarily unavailable')
    persisted.push(answer)
  }, 0)
  queue.schedule()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.match(queue.error.value, /disk temporarily unavailable/)
  answer = 'C'
  assert.equal(await queue.flush(), true)
  assert.equal(queue.error.value, '')
  assert.deepEqual(persisted, ['C'])
})

test('the leave flush waits for an in-flight save and any edits made before it completes', async () => {
  let answer = 'A'
  const gates = []
  const writes = []
  const queue = useDraftSaveQueue(() => {
    writes.push(answer)
    return new Promise(resolve => gates.push(resolve))
  })
  const first = queue.save()
  await Promise.resolve()
  answer = 'B'
  queue.schedule()
  let left = false
  const leaving = queue.flush().then(result => { left = result })
  assert.deepEqual(writes, ['A'])
  gates.shift()()
  await Promise.resolve()
  assert.deepEqual(writes, ['A', 'B'])
  assert.equal(left, false)
  gates.shift()()
  await Promise.all([first, leaving])
  assert.equal(left, true)
})

test('listening restores its saved Part, question and position and excludes closed time', () => {
  const groups = [{section:1,questionIds:['q1']},{section:4,questionIds:['q5','q6']}]
  assert.deepEqual(readListeningDraftPosition({part:4,questionId:'q6',audioPositionMs:8420},groups),
    {section:4,questionId:'q6',audioSeconds:8.42})
  assert.equal(readListeningDraftPosition({part:5,questionId:'q6',audioPositionMs:8420},groups),null)
  assert.equal(readListeningDraftPosition({part:4,questionId:'q1',audioPositionMs:-1},groups).questionId,'q5')
  let mono = 100
  let now = 1_700_000_000_000
  const clock = createListeningDraftClock(() => mono, () => now)
  clock.start()
  mono += 1200
  clock.pause()
  const saved = clock.snapshot()
  assert.equal(saved.running, false)
  assert.equal(saved.pausedAtMs - saved.anchorMs, 1200)
  now += 86_400_000
  mono = 10
  const restored = createListeningDraftClock(() => mono, () => now)
  restored.restore(1200)
  mono += 500
  assert.equal(restored.elapsed(),1200)
  restored.start()
  mono += 300
  assert.equal(restored.elapsed(),1500)
})

test('listening seeks to the saved time only once the current recording has metadata, without play', () => {
  const source = read('apps/writing-vue/src/modules/practice-listening/components/ListeningAudioBar.vue')
  const readDuration = source.slice(source.indexOf('function readDuration('),source.indexOf('function pauseAtCurrentPosition('))
  const calls = []
  const player = {duration:12,readyState:0,currentTime:0,paused:false,
    pause(){this.paused=true},play(){assert.fail('draft restore must never autoplay')}}
  const seek = new Function('props','audio','mediaDuration','currentTime','emit', `${readDuration};return readDuration`)(
    {resumeSeconds:19},{value:player},ref(0),ref(0),(...args)=>calls.push(args))
  seek({target:player})
  assert.deepEqual(calls,[])
  player.readyState = 1
  seek({target:{}})
  assert.deepEqual(calls,[])
  seek({target:player})
  assert.equal(player.paused,true)
  assert.equal(player.currentTime,12)
  assert.deepEqual(calls,[['position-restored',12]])
})

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
  const listeningExamCards = ref([{id:'academic',title:'剑雅21 Test 1',provider:'idictation-exam',parts:['P1','P2','P3','P4']}])
  const deps = { computed,ref,onMounted:()=>{},useRouter:()=>({}),useRoute:()=>({}),remoteCards:()=>remote,articleCards:ref([]),listeningExamCards }
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
  state.hotlistOnly.value = true
  state.sourceFilter.value = 'idictation-exam'
  assert.deepEqual(ids(), ['academic'], 'hidden ninefen filters must not remove the Academic suite')
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

function readingReviewHarness() {
  const source = read('apps/writing-vue/src/views/PracticeReadingPage.vue')
  const functionSource = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
  const local = { assetId:'jiufen-native-fixture', attemptId:'completed-attempt', duration:61,
    answers:{q1:'A',q2:''}, answerComparison:{q1:{isCorrect:false,correctAnswer:null}} }
  const answers = {}
  const noop = () => {}
  const context = { ref, computed, assetLoadGeneration:0, pageAlive:ref(true), examReady:ref(false),
    draftQueue:{reset:noop},tauriAttemptId:'',props:{assetId:local.assetId,sessionId:local.attemptId},route:{params:{},query:{}},
    asset:ref({id:local.assetId}),payload:ref({}),submission:ref(null),error:ref(''),submitError:ref(''),
    materialError:ref(''),reviewLoadError:ref(''),reviewLoading:ref(false),localRecord:ref(null),localRecordLoading:ref(false),locatedSentences:ref([]),
    readerProgressError:ref(''),readerProgressMessage:ref(''),suiteSession:ref(null),endlessNextAssetId:ref(''),
    materialMode:ref(false),isEndlessMode:ref(false),isMemorizeMode:ref(false),activeSuiteSessionId:ref(''),
    activeEndlessSessionId:ref(''),loading:ref(false),submitting:ref(false),leaving:ref(false),
    readingPassagePane:ref(null),highlightSnapshot:ref([]),RESTORED_ANNOTATION_KINDS:[],
    normalizeLegacyMemorizeQuery:()=>false,isTauriRuntime:()=>true,nextTick:async()=>{},getTextNodes:()=>[],
    loadReadingAsset:async()=>({payload:context.payload.value}),
    loadLocalCompletedDetail:async()=>({attempt:{id:local.attemptId,assetId:local.assetId,status:'completed',correctCount:1,answers:[{questionId:'q1',answer:'A'}]}}),
    mapHistoryDetailToSubmission:()=>local,
    jiufen:{review:async()=>{throw new Error('injected remote timeout')}},isJiufenAsset:()=>true,isIdictationReading:()=>false,
    hydrateHighlightsFromStore:async()=>[],normalizeHighlightSnapshotState:value=>value,
    assignAnswer:(id,value)=>{answers[id]=value},timerStarts:0,readonlyCalls:[],
    startPracticeTimer:()=>{context.timerStarts++},setReadOnlyDomControls:value=>context.readonlyCalls.push(value),
    console:{error:noop,warn:noop},watch:noop }
  for (const name of ['detachHighlightDocumentListeners','clearReadingAssetError','clearSnapshotMessage','resetAttemptReviewState',
    'resetAttemptMetadata','resetReadingCoachState','closeFloatingPanels','resetHighlightUiStateFromComposable','clearReadingNotesDraft',
    'clearEndlessTimer','resetPracticeTimerClock','attachHighlightDocumentListeners','initializeReadingAnswers','loadReadingNotes',
    'ensureMemorizeSession','syncDomAnswers','restoreHighlightsFromRecords','applyMemorizeStudyLayer','setPracticeTimerElapsedSeconds',
    'hydrateReadingCoachFromSubmission','restoreSubmittedMetadata','restoreSubmittedViewport']) context[name]=noop
  const mode = functionSource('const replaySessionId = computed(', '\nconst {\n  answeredCount,')
  const canSubmit = functionSource('const canSubmit = computed(', '\nconst canSnapshot =')
  const code = [mode,canSubmit,functionSource('async function loadAsset()', '\nwatch('),
    functionSource('async function loadSubmittedSession(', '\nasync function hydrateOpenDraft('),
    functionSource('function fillCorrectAnswersFromPayload(', '\nasync function loadReadingCoachPreference(')]
  // Extract only the helper declaration, not any unrelated functions between it and the next anchor.
  const fillStart = source.indexOf('function fillCorrectAnswersFromPayload(')
  const fillEnd = source.indexOf('\n}\n',fillStart)+2
  code[4]=source.slice(fillStart,fillEnd)
  const functions = new Function('context', `with(context){${code.join('\n')}; return {loadAsset,retryProviderReview,loadProviderReview,reviewMode,readOnlyMode,canSubmit};}`)(context)
  return {context,local,answers,...functions}
}

test('reading history stays read-only, restores answers and retries remote review without starting a draft', async () => {
  const h=readingReviewHarness()
  assert.equal(h.reviewMode.value,true,'the route is read-only before any remote response')
  await h.loadAsset()
  assert.equal(h.readOnlyMode.value,true)
  assert.equal(h.canSubmit.value,false)
  assert.equal(h.context.timerStarts,0)
  assert.deepEqual(h.answers,{q1:'A',q2:''})
  assert.equal(h.context.submission.value.duration,61)
  assert.match(h.context.reviewLoadError.value,/injected remote timeout/)
  assert.ok(h.context.readonlyCalls.includes(true))
  h.context.jiufen.review=async()=>({answerKey:{q1:'B'},reviewExplanations:{items:['explanation']}})
  await h.retryProviderReview()
  assert.equal(h.context.reviewLoadError.value,'')
  assert.equal(h.context.reviewLoading.value,false)
  assert.equal(h.context.submission.value.answerComparison.q1.correctAnswer,'B')
  assert.equal(h.canSubmit.value,false)
  assert.equal(h.context.timerStarts,0)
})

test('missing local review fails visibly without enabling edit or submit', async () => {
  const h=readingReviewHarness()
  h.context.loadLocalCompletedDetail=async()=>{throw new Error('未找到与当前题目匹配的已提交记录')}
  await h.loadAsset()
  assert.match(h.context.error.value,/未找到/)
  assert.equal(h.readOnlyMode.value,true)
  assert.equal(h.canSubmit.value,false)
  assert.equal(h.context.timerStarts,0)
})

test('cold reading replay exposes local answers before the asset request resolves and keeps them offline', async () => {
  const h = readingReviewHarness()
  let gate
  let assetStarted
  const entered = new Promise(resolve => { assetStarted = resolve })
  h.context.asset.value = null
  h.context.payload.value = null
  h.context.loadReadingAsset = () => new Promise((_, reject) => { gate = reject; assetStarted() })
  const opening = h.loadAsset()
  await entered
  assert.equal(h.context.localRecord.value.answers[0].answer, 'A')
  assert.equal(h.canSubmit.value, false)
  gate(new Error('offline'))
  await opening
  assert.match(h.context.error.value, /已保留本地作答.*offline/)
  assert.equal(h.context.localRecord.value.correctCount, 1)
  assert.equal(h.context.timerStarts, 0)
})

test('opening an old reading draft preserves the old answers if the source version changed', async () => {
  const h = readingReviewHarness()
  const { context: c, local } = h
  c.props.sessionId = ''
  c.route.query.resume = '1'
  const draft = { id:'old-draft', assetId:local.assetId, status:'draft', answers:[{questionId:'q1',answer:'C'}] }
  c.getOpenReadingDraft = async id => {
    assert.equal(id, draft.assetId)
    return { attempt:draft, timer:null }
  }
  c.loadReadingAsset = async id => {
    assert.equal(id, draft.assetId)
    throw new Error('官方题面已更新')
  }
  await h.loadAsset()
  assert.deepEqual(c.localRecord.value, draft)
  assert.match(c.error.value, /官方题面已更新/)
  assert.equal(h.canSubmit.value, false)
  assert.equal(c.timerStarts, 0)
})

test('cold listening replay retains local results through asset failure and official review retry', async () => {
  const source = read('apps/writing-vue/src/views/ListeningExamPage.vue')
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end))
  const attempt = { id:'attempt', assetId:'jiufen-native-listening', status:'completed', correctCount:3,
    answers:[{questionId:'q1',answer:'A'}] }
  const noop = () => {}
  const c = {
    props:{ assetId:attempt.assetId, attemptId:attempt.id }, route:{query:{}},
    loading:ref(false),error:ref(''),assetError:ref(''),submitError:ref(''),review:ref(null),localRecord:ref(null),
    reviewError:ref(''),reviewLoading:ref(false),draftRestored:ref(false),submitted:ref(false),
    materialError:ref(''),materialLoading:ref(false),mergeListeningStudyMaterial,
    draftQueue:{reset:noop},draftClock:{restore:noop},pendingAudioPosition:ref(null),audioTime:ref(0),audioCheckpoint:0,
    timeline:{reset:noop},isPreview:ref(false),reviewMode:ref(true),payload:ref(null),isJiufenAsset:()=>true,
    loadLocalCompletedDetail:async()=>({attempt}),loadListeningAsset:async()=>{throw new Error('offline')},
    initializeAnswers:noop,activeSection:ref(1),activeQuestionId:ref(''),firstPresentSection:()=>1,
    sectionFirstQuestion:()=> 'q1',loadPracticeAudio:noop,loadStudyMaterial:noop,console:{warn:noop,error:noop},
    nextTick:async()=>{},syncDomAnswers:noop,assignAnswer:noop,
    mapHistoryDetailToListeningReview:({attempt})=>({...attempt,rows:[],answers:{q1:attempt.answers[0].answer}}),
    coachSubmission:ref(null),hydrateReadingCoachFromSubmission:noop,
    listeningAttempt:{fetchReviewDetail:async()=>({attempt})},
    jiufen:{review:async()=>{throw new Error('review timeout')}}
  }
  const page = new Function('c', `with(c){${section('async function loadReview(', 'async function submitAnswers(')}
    ${section('async function initialize()', 'onMounted(initialize)')}; return {initialize,loadReview}}`)(c)
  await page.initialize()
  assert.equal(c.localRecord.value.correctCount, 3)
  assert.match(c.error.value, /已保留本地作答.*offline/)
  c.loadListeningAsset = async () => { c.payload.value = {} }
  await page.initialize()
  assert.equal(c.review.value.correctCount, 3)
  assert.equal(c.review.value.answers.q1, 'A')
  assert.match(c.reviewError.value, /review timeout/)
  c.jiufen.review = async () => ({answerKey:{q1:'B'}})
  await page.loadReview()
  assert.equal(c.reviewError.value, '')
  assert.equal(c.payload.value.answerKey.q1, 'B')
  assert.equal(c.review.value.answers.q1, 'A')
})

test('partial listening material keeps the transcript and received analyses while retrying missing items', async () => {
  const source = read('apps/writing-vue/src/views/ListeningExamPage.vue')
  const start = source.indexOf('const missingMaterial = computed(')
  const end = source.indexOf('\nfunction isPlaying(', start)
  const original = {id:'p1-s0',text:'Original'}
  const translated = {...original,translation:'译文'}
  const parts = sentence => [{id:'p1',section:1,paragraphs:[{id:'p1-p0',sentences:[sentence]}]}]
  const oldAnalysis = {analyses:[{text:'Available analysis'}],sentenceIds:['p1-s0']}
  const newAnalysis = {analyses:[{text:'Recovered analysis'}],sentenceIds:[]}
  const partial = {parts:parts(original),questions:{q1:oldAnalysis},missing:{translationParts:[1],analysisQuestions:['q2']}}
  const complete = {parts:parts(translated),questions:{q1:oldAnalysis,q2:newAnalysis},missing:{translationParts:[],analysisQuestions:[]}}
  const calls = []
  const c = {
    computed,props:{assetId:'jiufen-native-test',attemptId:'attempt'},reviewMode:ref(true),
    payload:ref({studyMaterial:{parts:parts(original),questions:{}}}),materialError:ref(''),materialLoading:ref(false),
    isJiufenAsset:()=>true,mergeListeningStudyMaterial,
    jiufen:{studyMaterial:async (...args) => { calls.push(args); return partial }}
  }
  const page = new Function('c', `with(c){${source.slice(start,end)};return {loadStudyMaterial,missingMaterial}}`)(c)
  await page.loadStudyMaterial()
  assert.match(page.missingMaterial.value,/1 个 Part 的译文、1 题的解析/)
  assert.equal(c.payload.value.studyMaterial.parts[0].paragraphs[0].sentences[0].text,'Original')
  assert.equal(c.payload.value.studyMaterial.questions.q1.analyses[0].text,'Available analysis')
  c.jiufen.studyMaterial = async (...args) => { calls.push(args); throw new Error('retry offline') }
  await page.loadStudyMaterial(true)
  assert.equal(c.materialError.value,'retry offline')
  assert.equal(c.payload.value.studyMaterial.questions.q1.analyses[0].text,'Available analysis')
  c.jiufen.studyMaterial = async (...args) => { calls.push(args); return complete }
  await page.loadStudyMaterial(true)
  assert.equal(c.materialError.value,'')
  assert.equal(page.missingMaterial.value,'')
  assert.equal(c.payload.value.studyMaterial.questions.q2.analyses[0].text,'Recovered analysis')
  assert.deepEqual(calls.map(args=>args[3]),[false,true,true])
  const late = mergeListeningStudyMaterial(c.payload.value.studyMaterial, partial)
  assert.equal(late.parts[0].paragraphs[0].sentences[0].translation,'译文')
  assert.equal(late.questions.q2.analyses[0].text,'Recovered analysis')
  assert.deepEqual(late.missing,{translationParts:[],analysisQuestions:[]})
})

test('late remote review cannot overwrite a new page or its retry state', async () => {
  const h=readingReviewHarness()
  await h.loadAsset()
  let resolve
  h.context.jiufen.review=()=>new Promise(done=>{resolve=done})
  const pending=h.retryProviderReview()
  h.context.assetLoadGeneration++
  h.context.payload.value={newPage:true}
  h.context.submission.value=null
  h.context.reviewLoading.value=false
  h.context.reviewLoadError.value='new page state'
  resolve({answerKey:{q1:'B'}})
  await pending
  assert.deepEqual(h.context.payload.value,{newPage:true})
  assert.equal(h.context.reviewLoadError.value,'new page state')
  assert.equal(h.context.reviewLoading.value,false)
})

test('recovered submission shows the frozen completion time instead of retry waiting time', () => {
  const source=read('apps/writing-vue/src/modules/practice-reading/useReadingModeFlow.ts')
  const start=source.indexOf('      const completedDuration =')
  const end=source.indexOf('\n      snapshotSubmission()',start)
  const actual=source.slice(start,end)
  const displayed=[]
  const options={submission:ref({duration:61}),setPracticeTimerElapsedSeconds:value=>displayed.push(value)}
  new Function('options','durationSec',actual)(options,3600)
  options.submission.value.duration=0
  new Function('options','durationSec',actual)(options,3600)
  assert.deepEqual(displayed,[61,0])
})

test('provider submission mapping uses retained flags and timeline along with official answers', () => {
  const source=read('apps/writing-vue/src/modules/practice-reading/useReadingAttempt.ts')
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
  const exports={}
  new Function('exports','require',compiled)(exports,()=>({READING_ACTIVITY:'reading'}))
  const mapped=exports.mapSubmitResultToSubmission({review:{},recoveredDraftId:'new-draft',
    attempt:{id:'original',durationMs:61000,answers:[{questionId:'q1',marked:true,elapsedMs:321,visitCount:2,changeCount:1}]},
    comparisons:[{questionId:'q1',userAnswer:'A'}]},
    {answers:{q1:'C'},markedQuestions:['q2'],questionTimeline:[{questionId:'q1',elapsedMs:999}]})
  assert.deepEqual(mapped.answers,{q1:'A'})
  assert.deepEqual(mapped.markedQuestions,['q1'])
  assert.equal(mapped.questionTimelineLite[0].elapsedMs,321)
  assert.equal(mapped.recoveredDraftId,'new-draft')
  assert.equal(exports.mapSubmitResultToSubmission({attempt:{durationMs:0}}, {durationMs:9999}).duration,0)
})
