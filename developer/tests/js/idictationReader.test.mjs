import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const appRequire = createRequire(new URL('../../../apps/writing-vue/package.json', import.meta.url))
const ts = appRequire('typescript')
const vue = appRequire('vue')
const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

function moduleFrom(path, replacements) {
  const compiled = ts.transpileModule(read(path), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText
  const module = {exports:{}}
  new Function('require','module','exports',compiled)(name => replacements[name] || appRequire(name), module, module.exports)
  return module.exports
}

test('Reader catalog ignores responses arriving after disconnect and keeps pagination', async () => {
  let resolve
  const remote = {readerCatalog: () => new Promise(done => {resolve = done})}
  const lib = moduleFrom('plug/idictation/readerLibrary.js', {'vue':vue,'@/api/idictation.js':{idictation:remote}})
  const pending = lib.loadReaderCatalog()
  lib.resetReaderLibrary()
  resolve({items:[{id:'2'}],total:1,page:1,pageSize:24})
  await pending
  assert.equal(lib.readerRows.value.length, 0)
  assert.equal(lib.readerBusy.value, false)
  const next = lib.loadReaderCatalog(2)
  resolve({items:[{id:'20',part:2,test:1,book:21,track:'a'}],total:25,page:2,pageSize:24})
  await next
  assert.equal(lib.readerPage.value, 2)
  assert.equal(lib.readerCards.value[0].practiceKind, 'material')
  assert.equal(lib.readerCards.value[0].category, 'P2')
})

test('disabled material timer does not call IPC or submit a late exam tick', async () => {
  const pending=[]
  let submissions=0
  const {useReadingTimer} = moduleFrom('apps/writing-vue/src/modules/practice-reading/useReadingTimer.ts', {
    'vue':vue,
    '@/api/tauri-bridge.js':{invokeCommand: () => new Promise(resolve=>pending.push(resolve)),unwrapCommandResponse:value=>value}
  })
  globalThis.window={setInterval:()=>1,clearInterval:()=>{}}
  const enabled=vue.ref(false)
  const timer=useReadingTimer({enabled,onAutoSubmit:()=>submissions++})
  timer.startPracticeTimer()
  timer.toggleTimer()
  timer.stopPracticeTimer()
  assert.equal(pending.length,0)
  enabled.value=true
  timer.startPracticeTimer()
  assert.equal(pending.length,2)
  enabled.value=false
  pending[0](100);pending[1](true)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(timer.timerRunning.value,false)
  assert.equal(timer.elapsedSeconds.value,0)
  assert.equal(submissions,0)
})

test('material reading takes the early branch before exam initialization', async () => {
  const source=read('apps/writing-vue/src/views/PracticeReadingPage.vue')
  const start=source.indexOf('async function loadAsset()')
  const end=source.indexOf('\nwatch(',start)
  const fn=source.slice(start,end)
  const ref=value=>({value})
  let initialized=0
  const position = {blockKey:'p1',textOffset:8}
  const restored = []
  const unexpected=()=>{throw new Error('material reached exam side effect')}
  const noop=()=>{}
  const context={assetLoadGeneration:0,pageAlive:ref(true),examReady:ref(true),draftAutosaveTimer:null,tauriAttemptId:'old',
    props:{assetId:'idictation-material-test'},route:{params:{},query:{}},error:ref(''),submitError:ref(''),submission:ref(null),
    materialError:ref(''),locatedSentences:ref([]),suiteSession:ref(null),endlessNextAssetId:ref(''),materialMode:ref(true),
    readerProgressError:ref(''),readerProgressMessage:ref(''),readerState:ref({position}),
    nextTick:async()=>{},readingPassagePane:ref({restoreReadingPosition:value=>restored.push(value)}),
    detachHighlightDocumentListeners:noop,normalizeLegacyMemorizeQuery:()=>false,clearReadingAssetError:noop,
    clearSnapshotMessage:noop,resetAttemptReviewState:noop,resetAttemptMetadata:noop,resetReadingCoachState:noop,
    closeFloatingPanels:noop,resetHighlightUiStateFromComposable:noop,clearReadingNotesDraft:noop,clearEndlessTimer:noop,
    resetPracticeTimerClock:noop,loadReadingAsset:async()=>({payload:{practiceKind:'material'}}),
    initializeReadingAnswers:()=>initialized++,attachHighlightDocumentListeners:unexpected,loadReadingNotes:unexpected,
    ensureMemorizeSession:unexpected,hydrateOpenDraft:unexpected,startPracticeTimer:unexpected,
    isEndlessMode:ref(true),activeSuiteSessionId:ref('old-suite'),isMemorizeMode:ref(true),reconcileEndlessRoute:unexpected
  }
  // Execute the actual page function, with all exam side-effect entrances armed.
  const run=new Function('context',`with(context){${fn}; return loadAsset();}`)
  await run(context)
  assert.equal(initialized,1)
  assert.deepEqual(restored,[position])
  assert.equal(context.tauriAttemptId,'')
  assert.equal(context.examReady.value,false)
})

test('late memorize and endless responses cannot navigate over a new Reader', async () => {
  let resolve, active=true
  const navigation=[]
  const {useReadingModeFlow}=moduleFrom('apps/writing-vue/src/modules/practice-reading/useReadingModeFlow.ts', {
    'vue':vue,'@/api/tauri-bridge.js':{isTauriRuntime:()=>true},
    '@/api/modes-repository.js':{createMemorize:()=>new Promise(done=>resolve=done),getEndless:()=>new Promise(done=>resolve=done)},
    './readingModeFlowCore.js':{buildEndlessNextRoute:id=>({params:{assetId:id}})}
  })
  const asset=vue.ref({id:'old-exam'}), memorized=vue.ref('')
  const flow=useReadingModeFlow({assetSource:asset,activeMemorizeAttemptId:memorized,
    isMemorizeMode:()=>active,isEndlessMode:()=>active,activeSuiteSessionId:'',activeEndlessSessionId:'old-endless',
    router:{replace:target=>navigation.push(target)}})
  const pending=flow.ensureMemorizeSession(()=>active)
  active=false;asset.value={id:'idictation-material-new'}
  resolve({session:{attempt:{id:'old-attempt'}}})
  await pending
  assert.equal(memorized.value,'')
  assert.deepEqual(navigation,[])
  active=true;asset.value={id:'old-exam'}
  const endless=flow.reconcileEndlessRoute(()=>active)
  active=false;asset.value={id:'idictation-material-new'}
  resolve({session:{currentAssetId:'another-exam'}})
  assert.equal(await endless,false)
  assert.deepEqual(navigation,[])
})
