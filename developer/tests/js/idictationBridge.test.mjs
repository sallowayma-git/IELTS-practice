import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import {createHash} from 'node:crypto'

const source = await readFile(new URL('../../../plug/idictation/product-bridge.js', import.meta.url), 'utf8')
const expectedHash='51d0c314236baeb59da92c76d2f551b92a7420d15894440e3a24e7d3992823eb'
const currentVersion={entry:'index-dab1aca2.js',postExport:'d7',
  hash:'7fb63b819e74ca9b6857cd7ba40a7f4eb442ff46fb64244309c9538869b2d8b6'}
const synonymPath='/assets/index-cdf3ce3c.js'
const synonymExpectedHash='c43458722a5f8ab46d9dd9f10526cb45fee075a2a7dcee87798c0d097bed946f'
const clozePath='/assets/setting.vue_vue_type_script_setup_true_lang-3d4d67c2.js'
const clozeHash='3014ffc74657bb97e578c42f681d269cc0015cd9f87358e30638f91c7c96c50f'
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

async function run({operation='account',value={},input={},origin='https://www.idictation.cn',pathname='/main/book',postError=null,loaded=true,entry='index-119a4b05.js',postExport='c$',hash=expectedHash,synonymHash=synonymExpectedHash,cancelBeforeFetch=false,owner='7',exports={},cloze, audioCancel=false,audioPending=false}={}) {
  const calls=[]
  const window={};window.top=window
  const media=[]
  class AudioMock {constructor(){media.push(this)}pause(){this.paused=true}play(){if(audioCancel)queueMicrotask(()=>window.__atlasVocabularyAudioRequest.cancel());return audioPending?new Promise(()=>{}):Promise.resolve()}}
  const context=vm.createContext({window,AbortController,Audio:AudioMock,URL,atob,btoa,location:{origin,pathname},document:{
    querySelectorAll:()=>loaded?[{src:'https://www.idictation.cn/assets/'+entry}]:[],
    // Bridge route tests use plain-text prompts. HTML presentation is exercised in browser QA.
    createElement:()=>({set innerHTML(value){this.content={textContent:value,querySelectorAll:()=>[]}}})
  },
    crypto:{subtle:{digest:async(_,bytes)=>Buffer.from([hash,synonymHash,clozeHash][bytes.byteLength],'hex')}},
    fetch:async url=>{const asset=url.endsWith(clozePath)?2:url.endsWith(synonymPath)?1:0;calls.push(['module','synonym module','cloze module'][asset]);if(cancelBeforeFetch){window.resultSlot.cancel();delete window.resultSlot}return {ok:true,arrayBuffer:async()=>new ArrayBuffer(asset)}}})
  const module=new vm.SyntheticModule([postExport,...Object.keys(exports)],function(){this.setExport(postExport,async request=>{calls.push(request);if(postError)throw postError;return (operation.startsWith('training')||['readingSubmit','articleMark','articleCollect','articleDictationSave','readerBookmark','readerProgress','readerCompletion','readerAnnotationSave','readerAnnotationDelete'].includes(operation))&&request.url.endsWith('/login/msg')?{id:owner}:value});for(const [key,fn] of Object.entries(exports))this.setExport(key,fn)},{context})
  await module.link(()=>{});await module.evaluate()
  const routes={l:['book/list',null],a:['chapter/list','book_id'],g:['chapter/detail','chapter_id']}
  const synonymModule=new vm.SyntheticModule(Object.keys(routes),function(){
    for(const [name,[path,field]] of Object.entries(routes)) this.setExport(name,async (id, signal)=>{
      calls.push({url:'/api/study/synonym/v1/'+path,data:field?{[field]:id}:{},signal,inputId:id})
      if(postError)throw postError
      return value
    })
  },{context})
  await synonymModule.link(()=>{});await synonymModule.evaluate()
  const clozeModule=new vm.SyntheticModule(['c'],function(){this.setExport('c',cloze)},{context})
  await clozeModule.link(()=>{});await clozeModule.evaluate()
  const script=new vm.Script(`${source};startIdictationRead('resultSlot',${JSON.stringify(operation)},${JSON.stringify(input)});`,{
    importModuleDynamically:async url=>url.endsWith(clozePath)?clozeModule:url.endsWith(synonymPath)?synonymModule:module
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
test('current product grades whole sentences and prepares cloze without a business POST', async t => {
  const path = name => new URL('../e2e/reports/idictation-research/'+name, import.meta.url)
  let entry, settings
  try {
    entry = await readFile(path(currentVersion.entry))
    settings = await readFile(path(clozePath.split('/').at(-1)))
  } catch (error) {
    if (error.code === 'ENOENT') return t.skip('optional public bundles unavailable')
    throw error
  }
  assert.equal(createHash('sha256').update(entry).digest('hex'), currentVersion.hash)
  assert.equal(createHash('sha256').update(settings).digest('hex'), clozeHash)
  const main = entry.toString('utf8'), helper = settings.toString('utf8')
  const score = new Function(main.slice(main.indexOf('const Fw="idictdecimaldot"'),main.indexOf('function qV('))+';return kY')()
  const cloze = new Function(helper.slice(helper.indexOf('function xt('),helper.indexOf('function wt('))+';return xt')()
  const reference = "We can't stay."
  for (const [answer, expected] of [["We can not stay!",'1.00'],['We can stay.','0.67']]) {
    const result = await run({...currentVersion, operation:'articleSentenceScore', input:{reference, answer}, exports:{gO:score}})
    assert.equal(result.result.value, expected)
    assert.deepEqual(result.calls,['module'])
  }
  const sentence = {content:reference,cloze_details:{source_content:reference,schema_version:1,tokenizer_version:1,
    tokens:[{index:1,start:3,end:8,kind:'word',text:"can't"}],
    candidates:[{start_token:1,end_token:1,exact:"can't",types:['logic_signal']}]}}
  const result = await run({...currentVersion, operation:'articleCloze', input:{sentence,categories:['logic_signal']}, cloze})
  assert.deepEqual(result.result.value,[{text:'We '},{text:"can't",blank:true,id:'1'},{text:' stay.'}])
  assert.deepEqual(result.calls,['module','cloze module'])
})
test('speaking reads the two native directories and preserves access flags without account history', async () => {
  for (const part of [1, 2]) {
    const row = {id:901,oral_materials_id:17,part_type:part,mkt_oral_materials_title:'Activities',
      mkt_oral_materials_lock:0,is_offline:0,practice_results:[{id:'private'}]}
    const {result,calls} = await run({operation:'speakingPart'+part,value:{
      list:[row],non_mainland_list:[],practiced_list:[row]
    }})
    assert.equal(calls[1].url,'/api/study/kouyu-zhenti/v1/part'+part+'/list')
    assert.equal(JSON.stringify(calls[1].data),'{}')
    assert.deepEqual(result.value[0],[{id:17,title:'Activities',part,locked:0,offline:0}])
    assert.doesNotMatch(JSON.stringify(result),/private/)
  }
})
test('speaking topic keeps cue card and follow-ups with the original material ID', async () => {
  const question = (id, title) => ({topic_issues_id:id,oral_materials_id:17,mkt_topic_issues_title:title,
    problem_prompt:'When?',practice_results:[{id:'private'}],
    answer_ideas:{question_audio_url:'https://audio-1-cdn.idictation.cn/question.mp3',
      ideas:[{title_en:'Activities',points:[{en:'Go cycling'}],band_6_0:{en:'A sample.'}}]}})
  const value = {topic:{id:901,oral_materials_id:17,part_type:2,mkt_oral_materials_title:'Activities',
    mkt_oral_materials_lock:0,is_offline:0,detail_text:JSON.stringify({
      tIssuesPart2:[question(7,'Describe an activity.')],mktTopicIssuesList:[question(8,'Why?')]
    })}}
  const {result,calls} = await run({operation:'speakingTopic',input:{topicId:'17'},value})
  assert.equal(calls[1].url,'/api/study/kouyu-zhenti/v1/show/17')
  assert.equal(JSON.stringify(calls[1].data),'{}')
  assert.deepEqual(result.value.questions.map(row=>row.part),[2,3])
  assert.equal(result.value.questions[0].ideas[0].samples[0].en,'A sample.')
  assert.doesNotMatch(JSON.stringify(result),/private/)
  const invalid = await run({operation:'speakingTopic',input:{topicId:'17/submit'},value})
  assert.equal(invalid.calls.length,1)
  assert.equal(invalid.result.ok,false)
})
test('login expiry is distinguished from network or product version failures',async()=>{
  for(const [options,error] of [
    [{postError:{status:401}},'expired'],
    [{pathname:'/login',postError:{status:1}},'expired'],
    [{postError:{status:503}},'request'],
    [{pathname:'/login',hash:'0'.repeat(64)},'version']
  ]){
    const {result}=await run(options)
    assert.deepEqual(result,{ok:false,error})
  }
})
test('wrong origin, unloaded entry, and unsupported operation never request data',async()=>{
  for(const [options,status] of [[{origin:'https://other.invalid'},false],[{loaded:false},'loading'],[{operation:'pay'},false],[{entry:'index-unknown.js'},'version']]){
    const result=await run(options);assert.equal(result.started,status);assert.deepEqual(result.calls,[])
  }
})

test('the current pinned product build uses its own POST export',async()=>{
  const {result,calls}=await run({...currentVersion,value:{id:7}})
  assert.equal(result.value.id,7)
  assert.equal(calls[1].url,'/api/study/customer/v1/login/msg')
})

test('supplemental writing uses the selected bank and avoids refetching inline prompts', async () => {
  const list = await run({operation:'writingJijingTask2',input:{type:0,content_category:''},
    value:{list:[{paper_id:8,test_id:18,name:'Essay',content_is_preview:true,content:'Preview'}]}})
  assert.equal(list.calls.at(-1).url,'/api/study/xiezuo-jijing/v1/dazuowen/list')
  assert.deepEqual(list.result.value,[{paperId:8,testId:18,title:'Essay',inline:null}])
  const input={bank:'general',task:'task2',paperId:8,testId:18,inline:null}
  const paper = {test_id:'18',dazuowen:{paper_id:'8',content:'An essay prompt.'}}
  for (const value of [paper,{values:paper}]) {
    const detail = await run({operation:'writingExtraPrompt',input,value})
    assert.equal(detail.calls.at(-1).url,'/api/study/xiezuo-g-zhenti/v1/test/show/18')
    assert.deepEqual(detail.result.value,{prompt:'An essay prompt.',image:null})
  }
  for (const value of [{...paper,test_id:19},{...paper,dazuowen:{...paper.dazuowen,paper_id:9}}]) {
    const invalid = await run({operation:'writingExtraPrompt',input,value:{values:value}})
    assert.deepEqual(invalid.result,{ok:false,error:'request'})
  }
  const inline = await run({operation:'writingExtraPrompt',input:{...input,inline:{content:'Inline prompt.',image:''}}})
  assert.deepEqual(inline.calls,['module'])
  assert.equal(inline.result.value.prompt,'Inline prompt.')
  const tree = await run({operation:'writingGeneralTask2',input:{content_category:''},value:{books:[{
    children:[{test_id:'18',children:[{id:'8',title:'Essay',detail_raw_payload:JSON.stringify({content:'Full prompt.'})}]}]
  }]}})
  assert.equal(tree.calls.at(-1).url,'/api/study/xiezuo-g-zhenti/v1/dazuowen/list')
  assert.deepEqual(tree.result.value,[{paperId:8,testId:18,title:'Essay',inline:{content:'Full prompt.',image:''}}])
  const chart = await run({operation:'writingExtraPrompt',input:{...input,bank:'jijing',task:'task1',
    inline:{content:'Describe this chart.',image:'data:image/png;base64,iVBORw0KGgo='}}})
  assert.equal(chart.result.value.image,'data:image/png;base64,iVBORw0KGgo=')
})

test('Jijing listening keeps the native catalog, detail route and part media', async () => {
  const catalog = await run({operation:'listeningJijingCatalog',value:{tests:[
    {name:'Mixed entry',listening:{test_id:18,name:'Listening title',parts:[{paper_id:8,practice_result:'private'}]}},
    {name:'Reading only',listening:null}
  ]}})
  assert.equal(catalog.calls.at(-1).url,'/api/study/zhenti/v1/combined/jijing/list')
  assert.deepEqual(catalog.result.value,[{id:18,title:'Listening title',parts:[{paper_id:8}]}])
  const detail = await run({operation:'listeningJijingExam',input:{testId:'18'},value:{parts:[{
    paper_id:8,file_url:'https://audio-1-cdn.idictation.cn/part.mp3',content:[],
    question_number:[0],question:[{type:5,group_id:41,list:[{id:22,number:1}]}]
  }]}})
  assert.equal(detail.calls.at(-1).url,'/api/study/zhenti/v1/jj/test/show/18')
  assert.deepEqual(detail.result.value.parts[0].question_number,[1])
  assert.equal(detail.result.value.parts[0].file_url,'https://audio-1-cdn.idictation.cn/part.mp3')
  const part = await run({operation:'listeningJijingPart',input:{testId:'8'},value:{
    paper_id:8,title:'Part 3',content:[],question:[{type:5,group_id:41,list:[{id:22,number:21}]}]
  }})
  assert.equal(part.calls.at(-1).url,'/api/study/zhenti/v1/jj/part/show/8')
  assert.deepEqual(part.result.value.question_number,[21])
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

test('Academic listening sends the native read routes and projects track without remote result data', async () => {
  const catalog = await run({operation:'listeningCatalog',value:{books:[{name:'剑雅21',children:[
    {name:'Test 1',reading:{test_id:41},listening:{test_id:2101,practice_result:'private'}}
  ]}]}})
  assert.equal(catalog.calls.at(-1).url,'/api/study/zhenti/v1/combined/jianya/list')
  assert.deepEqual(catalog.result.value,[{id:2101,title:'剑雅21 Test 1'}])
  const exam = await run({operation:'listeningExam',input:{testId:'2101'},value:{
    test_id:2101,practice_result:{answer:'private'},parts:[{
      paper_id:22,full_audio:'entire.mp3',file_url:'part.mp3',content:[
        {en_text:'Test sentence',start_time:123,end_time:124,ai_analysis:'private'}
      ],question:[{type:5,list:[{id:2,display_answer:'one',ai_analyze:'private'}]}]
    }]
  }})
  assert.equal(exam.calls.at(-1).url,'/api/study/zhenti/v1/test/show/2101')
  assert.deepEqual(JSON.parse(JSON.stringify(exam.calls.at(-1).data)),{})
  assert.equal(exam.result.value.parts[0].full_audio,'entire.mp3')
  assert.doesNotMatch(JSON.stringify(exam.result.value),/private|part\.mp3/)
  const malformed = await run({operation:'listeningExam',input:{testId:'2101?other=1'}})
  assert.deepEqual(malformed.calls,['module'])
})

test('Academic writing selects one granted task and never imports an unknown chart URL', async () => {
  const list = await run({operation:'writingCatalog',value:{books:[{book_id:21,name:'剑雅21',children:[
    {name:'Test 1',writing:{test_id:2101,xiaozuowen:{paper_id:11},dazuowen:{paper_id:12}}}
  ]}]}})
  assert.equal(list.calls.at(-1).url,'/api/study/zhenti/v1/combined/jianya/list')
  assert.deepEqual(list.result.value,[{id:2101,bookId:21,title:'剑雅21 Test 1',task1:11,task2:12}])
  const value={test_id:2101,book_id:21,xiaozuowen:{paper_id:11,content:'Chart question',img_url:'https://example.test/chart.png'},
    dazuowen:{paper_id:12,content:'Essay question',img_url:'',answer:'Private',score_url:'Private'}}
  const args={operation:'writingExam',input:{testId:'2101',task:'task2',bookId:21,paperId:12},value}
  const essay=await run(args)
  assert.equal(essay.calls.at(-1).url,'/api/study/xiezuo-zhenti/v1/test/show/2101')
  assert.deepEqual(JSON.parse(JSON.stringify(essay.calls.at(-1).data)),{})
  assert.deepEqual(essay.result,{ok:true,value:{testId:2101,bookId:21,paperId:12,prompt:'Essay question',image:null}})
  const chart=await run({...args,input:{...args.input,task:'task1',paperId:11}})
  assert.deepEqual(chart.result,{ok:false,error:'writingImage'})
  assert.equal(chart.calls.length,2)
  const embedded = await run({...args,input:{...args.input,task:'task1',paperId:11},value:{
    ...value,xiaozuowen:{...value.xiaozuowen,img_url:'data:image/png;base64,iVBORw0KGgo='}
  }})
  assert.equal(embedded.result.value.image,'data:image/png;base64,iVBORw0KGgo=')
  const wrong=await run({...args,input:{...args.input,paperId:13}})
  assert.deepEqual(wrong.result,{ok:false,error:'request'})
})

test('synonym reads use original product operations and return only study fields', async () => {
  const cases = [
    ['synonymBooks', 'book/list', {}, [
      {id:1,name:'同义替换',pair_count:5,version:9,user_id:'private'}
    ], [{id:1,name:'同义替换',pair_count:5}]],
    ['synonymChapters', 'chapter/list', {book_id:1}, {
      book:{id:1,user_id:'private'},categories:[{id:3,name:'类别',chapters:[
        {id:36,category_id:3,name:'章节',pair_count:5,group_progress:['private']}
      ]}]
    }, {book:{id:1},categories:[{id:3,name:'类别',chapters:[{id:36,category_id:3,name:'章节',pair_count:5}]}]}],
    ['synonymChapter', 'chapter/detail', {chapter_id:36}, {
      book:{id:1},category:{id:3},chapter:{id:36},groups:[{
        id:4,chapter_id:36,version:5,pair_count:1,progress:{latest_run:'private'},pairs:[
          {id:9,group_id:4,is_delete:0,left_text:'major',right_text:'significant',meaning_zh:'重要的',
            sources:[{editor_url:'private'}],right_audio:{uk:'private'}}
        ]
      }]
    }, {book:{id:1},category:{id:3},chapter:{id:36},groups:[{
      id:4,chapter_id:36,version:5,pair_count:1,pairs:[
        {id:9,group_id:4,is_delete:0,left_text:'major',right_text:'significant',meaning_zh:'重要的'}
      ]
    }]}]
  ]
  for (const [operation, path, input, value, expected] of cases) {
    const {calls, result} = await run({...currentVersion,operation,input,value})
    assert.deepEqual(calls.slice(0,2), ['module','synonym module'])
    assert.equal(calls.length, 3)
    assert.equal(calls[2].url, '/api/study/synonym/v1/' + path)
    assert.deepEqual(JSON.parse(JSON.stringify(calls[2].data)), input)
    assert.deepEqual(result, {ok:true,value:expected})
  }
  const changed=await run({...currentVersion,operation:'synonymBooks',synonymHash:'0'.repeat(64)})
  assert.deepEqual(changed.result,{ok:false,error:'version'})
  assert.deepEqual(changed.calls,['module','synonym module'])
  const invalid=await run({...currentVersion,operation:'synonymChapter',input:{chapter_id:9007199254740992}})
  assert.deepEqual(invalid.result,{ok:false,error:'request'})
  assert.deepEqual(invalid.calls,['module'])
})
test('cancelled slot cannot make a late business request',async()=>{
  const {calls,result}=await run({cancelBeforeFetch:true})
  assert.deepEqual(calls,['module']);assert.equal(result,undefined)
})
test('word projection excludes source account and remote practice session',async()=>{
  const {result}=await run({operation:'words',value:{total:1,last_key:'private-round',existing_id:[1],data:[{id:1,g_id:2,c_id:3,word:'major',translate:'主要的',user_id:7,lexicon_id:0,'phonetic-m':'https://media.invalid/private'}]}})
  assert.deepEqual(result,{ok:true,value:{total:1,data:[{id:1,g_id:2,c_id:3,word:'major',translate:'主要的'}]}})
})

test('wrong-word import projects only local review fields under the observed source request',async()=>{
  const input={error_dates:[],recently:false,c_ids:[],g_ids:[],error_nums:[],page:1,pagesize:200}
  const {result,calls}=await run({operation:'mistakeWords',input,value:{
    current_page:1,last_page:1,per_page:200,total:1,
    data:[{id:52,user_id:'7',is_delete:0,error_word:'wrong-typed',lexicon:{
      id:11,word:'resilient',translate:'有韧性的',phonetic_transcription:'x','phonetic-m':'private-url'
    }}],error_practice_draft:{key:'private'}
  }})
  assert.equal(calls.at(-1).url,'/api/study/lexicon/v1/error/list')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).data)),input)
  assert.deepEqual(result,{ok:true,value:{current_page:1,last_page:1,per_page:200,total:1,data:[
    {id:52,user_id:'7',is_delete:0,lexicon:{id:11,word:'resilient',translate:'有韧性的',phonetic_transcription:'x'}}
  ]}})
})

test('article collections preserve only playback data and use the original list request',async()=>{
  const input={collect_date:[],error_tags:[],jingting_choices:[],page:1,pagesize:50}
  const {calls,result}=await run({operation:'articleCollections',input,value:{
    current_page:1,per_page:50,last_page:1,total:1,next_page_url:'private',
    data:[{id:72,user_id:'7',notes:'private',article_content:{
      id:11,content:'Sentence',translate:'句子',phonetic:'audio',start_time:'1000',end_time:'2000',
      grammar_analysis:'private'
    }}]
  }})
  assert.equal(calls.at(-1).url,'/api/study/article/v2/collect/list')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).data)),input)
  assert.doesNotMatch(JSON.stringify(result),/private/)
  assert.equal(result.value.data[0].article_content.end_time,'2000')
})

test('Reader transfer excludes private annotations, progress and user identity',async()=>{
  const {result,calls}=await run({operation:'readerDocument',value:{
    document:{id:2,user_id:999},version:{id:245,document_id:2},
    blocks:[{id:1,text:'Hello',payload:{private:'omit'},sentences:[{id:9,translation:'你好',user_id:999,bookmarked:true}]}],
    media:[],annotations:[{note:'private'}],progress:{lock_version:9},user_id:999
  }})
  assert.equal(calls[1].url,'/api/study/reader/v1/documents/show')
  assert.deepEqual(result,{ok:true,value:{document:{id:2},version:{id:245,document_id:2},blocks:[{id:1,text:'Hello',sentences:[{id:9,translation:'你好'}]}],media:[],bookmarked:[],sentenceAnnotations:[],progress:{lock_version:9},completedAt:null}})
})

test('Reader writes one anchored annotation using the native version and lock fields', async () => {
  const anchor={block_key:'p1',start:0,end:6,quote:'Hello.'}
  const request={document_id:2,version_id:245,client_key:'draft',kind:'note',quote:'Hello.',
    anchor_segments:[anchor],note:'A note',lock_version:0,sentence_ids:[9]}
  const saved=await run({operation:'readerAnnotationSave',input:{request,expectedOwner:'7'},value:{
    id:4,client_key:'draft',kind:'note',note:'A note',lock_version:1,anchor_segments:[anchor],user_id:'hidden'
  }})
  assert.equal(saved.calls.at(-1).url,'/api/study/reader/v1/annotations/save')
  assert.deepEqual(JSON.parse(JSON.stringify(saved.calls.at(-1).data)),request)
  assert.equal(saved.result.value.user_id,undefined)
  const removed=await run({operation:'readerAnnotationDelete',input:{request:{id:4,lock_version:1},expectedOwner:'7'}})
  assert.equal(removed.calls.at(-1).url,'/api/study/reader/v1/annotations/delete')
  assert.deepEqual(removed.result,{ok:true,value:true})
})

test('Reader saves a versioned position and marks completion through native contracts', async () => {
  const position={document_id:2,block_key:'p1',text_offset:31,lock_version:4}
  const saved=await run({operation:'readerProgress',input:{...position,expectedOwner:'7'},
    value:{lock_version:5,user_id:'private'}})
  assert.equal(saved.calls.at(-1).url,'/api/study/reader/v1/progress/save')
  assert.deepEqual(JSON.parse(JSON.stringify(saved.calls.at(-1).data)),position)
  assert.deepEqual(saved.result,{ok:true,value:{lock_version:5}})
  const complete=await run({operation:'readerCompletion',input:{document_id:2,expectedOwner:'7'},
    value:{document_id:2,completed:true,completed_at:'2026-11-27T12:00:00Z'}})
  assert.equal(complete.calls.at(-1).url,'/api/study/reader/v1/progress/completion/set')
  assert.deepEqual(JSON.parse(JSON.stringify(complete.calls.at(-1).data)),{document_id:2,completed:true})
  assert.equal(complete.result.value.completed,true)
})

test('Reader bookmarks match exact sentence anchors and use the native set receipt',async()=>{
  const {result}=await run({operation:'readerDocument',value:{
    document:{id:2},version:{id:245,document_id:2},
    blocks:[{id:1,block_key:'p1',text:'😀 Hello. Goodbye.',sentences:[
      {id:9,start_offset:3,end_offset:9},{id:10,start_offset:10,end_offset:18}]}],
    media:[],annotations:[
      {kind:'bookmark',anchor_segments:[{block_key:'p1',start:3,end:9,quote:'Hello.'}],note:'private'},
      {kind:'bookmark',anchor_segments:[{block_key:'p1',start:10,end:18,quote:'Changed.'}]}
    ]
  }})
  assert.deepEqual(result.value.bookmarked,[9])
  assert.doesNotMatch(JSON.stringify(result),/private/)
  const input={document_id:2,version_id:245,sentence_id:9,collected:true,expectedOwner:'7'}
  const added=await run({operation:'readerBookmark',input,value:{collected:true,annotation:{id:8,kind:'bookmark',note:'private'}}})
  assert.equal(added.calls.at(-1).url,'/api/study/reader/v1/sentences/bookmarks/set')
  assert.deepEqual(JSON.parse(JSON.stringify(added.calls.at(-1).data)),{document_id:2,version_id:245,sentence_id:9,collected:true})
  assert.deepEqual(added.result,{ok:true,value:true})
  const unknown=await run({operation:'readerBookmark',input,value:{collected:true,annotation:{id:8,kind:'note'}}})
  assert.equal(unknown.result.ok,false)
  const removed=await run({operation:'readerBookmark',input:{...input,collected:false},value:{collected:false}})
  assert.deepEqual(removed.result,{ok:true,value:false})
})
test('Reader collection reads the original page without exporting private annotation content',async()=>{
  const input={subject:'reading',kind:'all',page:1,page_size:20}
  const {calls,result}=await run({operation:'readerCollections',input,value:{
    page:1,total:1,page_size:20,items:[{available:true,user_id:'private',annotations:[{text:'private'}],
      document:{id:2,title:'Article',subject:'reading',private:true},
      sentence:{id:7,document_version_id:245,text:'A sentence.',translation:'一句话',private:true}
    }]
  }})
  assert.equal(calls.at(-1).url,'/api/study/reader/v1/sentences/collections/list')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).data)),input)
  assert.doesNotMatch(JSON.stringify(result),/private/)
  assert.equal(result.value.items[0].sentence.document_version_id,245)
})
test('article material transfer keeps canonical identity and only the marking fields',async()=>{
  const {result}=await run({operation:'articleDocument',value:{total:1,sentence_mode:'short',canonical_g_id:1,canonical_c_id:2,last_key:'42',
    data:[{id:3,g_id:4,c_id:5,content:'Hello',translate:'你好',error_article:'private answer',is_collection:1,article_content_collect:{note:'private'},phonetic:'https://audio-1-cdn.idictation.cn/a.mp3'}]}})
  assert.deepEqual(result,{ok:true,value:{total:1,sentence_mode:'short',canonical_g_id:1,canonical_c_id:2,last_key:'42',
    data:[{id:3,g_id:4,c_id:5,content:'Hello',translate:'你好',phonetic:'https://audio-1-cdn.idictation.cn/a.mp3',markCompleted:null,collected:true}]}})
})
test('article dictation restores only submitted answers and saves with the native score', async () => {
  const restored = await run({operation:'articleDocument',value:{existing_id:[11,12],data:[
    {id:11,error_article:'Previous answer'},
    {id:12,error_article:'Unsubmitted answer',practice_state:{status:'pending'}},
    {id:13,error_article:'No record'}
  ]}})
  assert.deepEqual(restored.result.value.data.map(row=>row.dictation),[{answer:'Previous answer',accuracy:null},undefined,undefined])
  const input = {articleId:11,expectedOwner:'7',key:'42',reference:'The answer.',answer:'The answers.'}
  const save = await run({...currentVersion,operation:'articleDictationSave',input,exports:{gO:()=> '0.50'}})
  assert.equal(save.calls.at(-1).url,'/api/study/article/v1/practice/result')
  assert.deepEqual(JSON.parse(JSON.stringify(save.calls.at(-1).data)),{
    key:'42',article_id:11,type:'fail',error_word:'The answers.'
  })
  assert.deepEqual(save.result,{ok:true,value:'0.50'})
})

test('article mark and automatic collection use separate native calls and verify owner', async()=>{
  const input={articleId:17,choice:2,key:'123',expectedOwner:'7'}
  const mark=await run({...currentVersion,operation:'articleMark',input,value:{private:'ignored'}})
  assert.equal(mark.calls.at(-1).url,'api/study/article/v1/practice/biaoji/result')
  assert.deepEqual(JSON.parse(JSON.stringify(mark.calls.at(-1).data)),{article_id:17,choice:2,key:'123'})
  assert.deepEqual(mark.result,{ok:true,value:true})
  const collect=await run({...currentVersion,operation:'articleCollect',input})
  assert.equal(collect.calls.at(-1).url,'/api/study/article/v1/collect/add/17')
  assert.equal(collect.calls.at(-1).data,undefined)
  const changed=await run({...currentVersion,operation:'articleCollect',input,owner:'8'})
  assert.deepEqual(changed.result,{ok:false,error:'account'})
  assert.equal(changed.calls.length,2)
})

const normalize={aP:(value,collapse)=>value.replace(/[^\w\s'\"]/g,' ').replace(/\s+/g,collapse?'':' ').trim(),aQ:value=>value}

test('new product pin selects the changed vocabulary exports in the right order',async()=>{
  const exports={aO:value=>value.toLowerCase(),aP:value=>value==='1'?'ONE':value}
  const input={...answerInput,typed:'1',word:{word:'one',various_words:[],spelling_combinations:[]}}
  const {result}=await run({...currentVersion,operation:'trainingAnswer',input,exports,value:''})
  assert.deepEqual(result,{ok:true,value:{correct:true}})
})
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
