import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import {createHash} from 'node:crypto'

const source = await readFile(new URL('../../../plug/idictation/product-bridge.js', import.meta.url), 'utf8')
const expectedHash='51d0c314236baeb59da92c76d2f551b92a7420d15894440e3a24e7d3992823eb'
const guard=await readFile(new URL('../../../src-tauri/src/app/prototype-guard.js',import.meta.url),'utf8')

test('prototype guard preserves local protection and product library compatibility',()=>{
  for(const [label,origin,frozen] of [
    ['main','http://tauri.localhost',true],
    ['main','http://127.0.0.1:5173',true],
    ['main','https://www.idictation.cn',true],
    ['idictation-product','https://www.idictation.cn',false],
    ['idictation-product','https://other.invalid',true]
  ]){
    const context=vm.createContext({window:{__TAURI_INTERNALS__:{metadata:{currentWebview:{label}}}},location:{origin}})
    vm.runInContext(guard,context)
    assert.equal(vm.runInContext('Object.isFrozen(Object.prototype)',context),frozen)
    // The source tinycolor class installs a toString on its child prototype.
    const assignment='"use strict"; function Color(){}; Color.prototype.toString=function(){return "color"};'
    if(frozen)assert.throws(()=>vm.runInContext(assignment,context),/read only/)
    else assert.doesNotThrow(()=>vm.runInContext(assignment,context))
  }
})

async function run({operation='account',value={},input={},origin='https://www.idictation.cn',loaded=true,entry='index-119a4b05.js',postExport='c$',hash=expectedHash,cancelBeforeFetch=false,owner='7',exports={},audioCancel=false,audioPending=false}={}) {
  const calls=[]
  const window={};window.top=window
  const media=[]
  class AudioMock {constructor(){media.push(this)}pause(){this.paused=true}play(){if(audioCancel)queueMicrotask(()=>window.__atlasVocabularyAudioRequest.cancel());return audioPending?new Promise(()=>{}):Promise.resolve()}}
  const context=vm.createContext({window,AbortController,Audio:AudioMock,location:{origin},document:{querySelectorAll:()=>loaded?[{src:'https://www.idictation.cn/assets/'+entry}]:[]},
    crypto:{subtle:{digest:async()=>Buffer.from(hash,'hex')}},
    fetch:async()=>{calls.push('module');if(cancelBeforeFetch){window.resultSlot.cancel();delete window.resultSlot}return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}}})
  const module=new vm.SyntheticModule([postExport,...Object.keys(exports)],function(){this.setExport(postExport,async request=>{calls.push(request);return (operation.startsWith('training')||operation==='readingSubmit')&&request.url.endsWith('/login/msg')?{id:owner}:value});for(const [key,fn] of Object.entries(exports))this.setExport(key,fn)},{context})
  await module.link(()=>{});await module.evaluate()
  const script=new vm.Script(`${source};startIdictationRead('resultSlot',${JSON.stringify(operation)},${JSON.stringify(input)});`,{
    importModuleDynamically:async()=>module
  })
  const started=script.runInContext(context)
  for(let i=0;started && !window.resultSlot?.ready && i<100;i++)await new Promise(resolve=>setImmediate(resolve))
  return {started,calls,media,window,result:window.resultSlot?.result && JSON.parse(JSON.stringify(window.resultSlot.result))}
}

test('account projection never exposes credentials or account configuration',async()=>{
  const {result,calls}=await run({value:{id:7,password:'do-not-return',session_id:'do-not-return',phone_number:'do-not-return',config:{private:'do-not-return'},member:{status:'未开通'},review_auth:false}})
  assert.deepEqual(result,{ok:true,value:{id:7,memberStatus:'未开通',enterpriseAllowed:false}})
  assert.equal(calls[1].url,'/api/study/customer/v1/login/msg')
})
test('wrong origin, unloaded entry, and unsupported operation never request data',async()=>{
  for(const [options,status] of [[{origin:'https://other.invalid'},false],[{loaded:false},'loading'],[{operation:'pay'},false],[{entry:'index-unknown.js'},'version']]){
    const result=await run(options);assert.equal(result.started,status);assert.deepEqual(result.calls,[])
  }
})

test('the current pinned product build uses its own POST export',async()=>{
  const {result,calls}=await run({entry:'index-64364bef.js',postExport:'d7',
    hash:'234e3d8511764006795aa50f2bc7dd712f940b40438030ebf2289f2a6b73425d',value:{id:7}})
  assert.equal(result.value.id,7)
  assert.equal(calls[1].url,'/api/study/customer/v1/login/msg')
})

test('Academic reading uses only its original catalog, detail and submission routes', async () => {
  const catalog = await run({ operation:'readingCatalog', value:{ books:[{name:'剑雅21',children:[
    {name:'Test 1',reading:{test_id:2101,practice_result:{answer:'private'}}}
  ]}] } })
  assert.deepEqual(catalog.result.value, [{id:2101,title:'剑雅21 Test 1'}])
  assert.equal(catalog.calls[1].url, '/api/study/zhenti/v1/combined/jianya/list')
  const detail = await run({operation:'readingExam',input:{testId:'2101'},value:{test_id:2101,parts:[],
    practice_result_shoudong:{id:4,action:'手动提交',answer:[],ai_review:'omit'}}})
  assert.equal(detail.calls[1].url,'/api/study/yuedu-zhenti/v1/jianya/test/show/2101')
  assert.equal(detail.result.value.practice_result_shoudong.ai_review,undefined)
  const invalid = await run({operation:'readingExam',input:{testId:'2101?other=1'}})
  assert.equal(invalid.calls.length,1)
  const body = {key:9,answer:[],jianya_test_id:'2101',action:'手动提交'}
  const response = await run({operation:'readingSubmit',input:{expectedOwner:'7',request:body},value:[]})
  assert.equal(response.calls.at(-1).url,'/api/study/yuedu-zhenti/v1/submit')
  assert.deepEqual(JSON.parse(JSON.stringify(response.calls.at(-1).data)),body)
  const wrongOwner = await run({operation:'readingSubmit',owner:'8',input:{expectedOwner:'7',request:body}})
  assert.equal(wrongOwner.result.error,'account')
  assert.equal(wrongOwner.calls.length,2)
})
test('changed module content is rejected before calling product API',async()=>{
  const {result,calls}=await run({hash:'0'.repeat(64)})
  assert.deepEqual(result,{ok:false,error:'version'});assert.deepEqual(calls,['module'])
})
test('cancelled slot cannot make a late business request',async()=>{
  const {calls,result}=await run({cancelBeforeFetch:true})
  assert.deepEqual(calls,['module']);assert.equal(result,undefined)
})
test('word projection excludes source account and remote practice session',async()=>{
  const {result}=await run({operation:'words',value:{total:1,last_key:'private-round',existing_id:[1],data:[{id:1,g_id:2,c_id:3,word:'major',translate:'主要的',user_id:7,lexicon_id:0,'phonetic-m':'https://media.invalid/private'}]}})
  assert.deepEqual(result,{ok:true,value:{total:1,data:[{id:1,g_id:2,c_id:3,word:'major',translate:'主要的'}]}})
})

test('Reader transfer excludes private annotations, progress and user identity',async()=>{
  const {result,calls}=await run({operation:'readerDocument',value:{
    document:{id:2,user_id:999},version:{id:245,document_id:2},
    blocks:[{id:1,text:'Hello',payload:{private:'omit'},sentences:[{id:9,translation:'你好',user_id:999,bookmarked:true}]}],
    media:[],annotations:[{note:'private'}],progress:{lock_version:9},user_id:999
  }})
  assert.equal(calls[1].url,'/api/study/reader/v1/documents/show')
  assert.deepEqual(result,{ok:true,value:{document:{id:2},version:{id:245,document_id:2},blocks:[{id:1,text:'Hello',sentences:[{id:9,translation:'你好'}]}],media:[]}})
})
test('article material transfer keeps canonical identity without user learning state',async()=>{
  const {result}=await run({operation:'articleDocument',value:{total:1,sentence_mode:'short',canonical_g_id:1,canonical_c_id:2,last_key:'private',
    data:[{id:3,g_id:4,c_id:5,content:'Hello',translate:'你好',error_article:'private answer',is_collection:1,article_content_collect:{note:'private'},phonetic:'https://audio-1-cdn.idictation.cn/a.mp3'}]}})
  assert.deepEqual(result,{ok:true,value:{total:1,sentence_mode:'short',canonical_g_id:1,canonical_c_id:2,
    data:[{id:3,g_id:4,c_id:5,content:'Hello',translate:'你好',phonetic:'https://audio-1-cdn.idictation.cn/a.mp3'}]}})
})

const normalize={aP:(value,collapse)=>value.replace(/[^\w\s'\"]/g,' ').replace(/\s+/g,collapse?'':' ').trim(),aQ:value=>value}
const answerInput={word:{word:'ice cream',various_words:['gelato'],spelling_combinations:[]},typed:'ICE  CREAM',dictionary:{},ignoreCase:true,expectedOwner:'7',cycle:true,hasFuture:false,request:{key:'123',lexicon_id:55,mode:3,sence:1}}
test('training calls original normalizers and submits exact source body once',async()=>{
  const {calls,result}=await run({operation:'trainingAnswer',input:answerInput,exports:normalize,value:''})
  assert.deepEqual(result,{ok:true,value:{correct:true}})
  const request=calls.at(-1)
  assert.equal(request.url,'/api/study/lexicon/v1/practice/result')
  assert.deepEqual(JSON.parse(JSON.stringify(request.data)),{key:'123',lexicon_id:55,mode:3,sence:1,type:'success',if_learned:1})
  const failed=await run({operation:'trainingAnswer',input:{...answerInput,typed:'wrong',choiceCorrect:false,hasFuture:true},exports:normalize,value:''})
  assert.deepEqual(JSON.parse(JSON.stringify(failed.calls.at(-1).data)),{key:'123',lexicon_id:55,mode:3,sence:1,type:'fail',error_word:'',if_learned:0})
})
test('changed account blocks training writes after module preparation',async()=>{
  for(const operation of ['trainingAnswer','trainingFinish']){
    const {calls,result}=await run({operation,input:answerInput,owner:'8',exports:normalize})
    assert.deepEqual(result,{ok:false,error:'account'})
    assert.equal(calls.filter(v=>typeof v==='object').length,1)
    assert.ok(calls.at(-1).url.endsWith('/login/msg'))
  }
})
test('source Audio survives cleanup only after the host accepts its receipt',async()=>{
  const input={url:'https://lbxl-audio.oss-cn-beijing.aliyuncs.com/example.mp3',speed:1.2,sessionId:'training-1'}
  const cancelled=await run({operation:'trainingAudio',input,audioCancel:true,audioPending:true})
  assert.equal(cancelled.result.ok,false)
  assert.equal(cancelled.media[0].paused,true)
  assert.equal(cancelled.media[0].src,'')
  const playing=await run({operation:'trainingAudio',input})
  assert.deepEqual(playing.result,{ok:true,value:{playing:true}})
  playing.window.resultSlot.keepAudio=true
  playing.window.resultSlot.cancel()
  assert.equal(playing.media[0].paused,undefined)
  assert.equal(playing.media[0].atlasSessionId,'training-1')
  const lostReceipt=await run({operation:'trainingAudio',input})
  assert.equal(lostReceipt.window.resultSlot.ready,true)
  lostReceipt.window.resultSlot.cancel()
  assert.equal(lostReceipt.media[0].paused,true)
  assert.equal(lostReceipt.media[0].src,'')
})

test('captured official normalizers preserve numeric, accent and variant grading',async t=>{
  let bundle
  try{bundle=await readFile(new URL('../e2e/reports/idictation-research/index-119a4b05.js',import.meta.url))}
  catch(error){if(error.code==='ENOENT'){t.skip('optional hashed public-client capture unavailable');return}throw error}
  assert.equal(createHash('sha256').update(bundle).digest('hex'),expectedHash)
  const text=bundle.toString('utf8'),start=text.indexOf('function yY('),end=text.indexOf('function wY(',start)
  assert.ok(start>0&&end>start)
  const official=new Function(`${text.slice(start,end)};return {aP:yY,aQ:bY}`)()
  for(const [word,typed,variants,combinations,expected] of [
    ['ice cream','ICECREAM',[],[],true],['Straße','strasse',[],[],true],
    ['one','1',[],[],true],['colour','color',['color'],[],true],
    ['colour','color',['color'],['only-one'],true],
    ['colour','color',['color'],['couleur','hue'],false],
    ['major','mayor',[],[],false],['word','',[],[],false]
  ]){
    const input={...answerInput,word:{word,various_words:variants,spelling_combinations:combinations},typed,dictionary:{'1':'one'}}
    const {result}=await run({operation:'trainingAnswer',input,exports:official,value:''})
    assert.deepEqual(result,{ok:true,value:{correct:expected}},`${word}/${typed}`)
  }
})
