import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../../../plug/idictation/VocabularyTraining.vue',import.meta.url),'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import[^\n]+\r?\n/gm,'')
function component(api){
  let mount,unmount
  const emitted=[]
  const deps={idictation:api,ref:value=>({value}),nextTick:async callback=>callback?.(),
    onMounted:fn=>mount=fn,onBeforeUnmount:fn=>unmount=fn,
    defineProps:()=>({bookId:'book',unitId:'unit',mode:2,resume:true}),defineEmits:()=>event=>emitted.push(event)}
  const state=new Function(...Object.keys(deps),`${source};return {prompt,busy,audioBusy,failed,error,feedback,finished,submit,play,finish,close,next}`)(...Object.values(deps))
  return {...state,mount,unmount,emitted}
}
const prompt={sessionId:'s1',promptId:'p1',mode:2,remaining:1,total:1,completed:0,options:[{label:'主要的'}],hasAudio:true}
test('a lost write response locks answering without automatic retry',async()=>{
  let calls=0
  const c=component({trainingStart:async()=>prompt,trainingAnswer:async()=>{calls++;throw new Error('receipt missing')},trainingClose:async()=>{}})
  await c.mount()
  await c.submit(0)
  await c.submit(0)
  assert.equal(calls,1);assert.equal(c.failed.value,true);assert.equal(c.prompt.value.promptId,'p1')
  await c.close();assert.deepEqual(c.emitted,['close'])
})
test('close is available while source audio is waiting',async()=>{
  let release,closed=0
  const c=component({trainingStart:async()=>prompt,trainingAudio:()=>new Promise(resolve=>release=resolve),trainingClose:async()=>{closed++;release()}})
  await c.mount();const playing=c.play(false)
  assert.equal(c.audioBusy.value,true);assert.equal(c.busy.value,false)
  await c.close();await playing
  c.unmount()
  assert.equal(closed,1);assert.deepEqual(c.emitted,['close'])
})
test('late start response after leaving is closed instead of rendered',async()=>{
  let release,closed=''
  const c=component({trainingStart:()=>new Promise(resolve=>release=resolve),trainingClose:async id=>closed=id})
  const started=c.mount();c.unmount();release(prompt);await started
  assert.equal(c.prompt.value,null);assert.equal(closed,'s1')
})
test('answer feedback does not invoke completion until explicit finish',async()=>{
  let finishes=0
  const c=component({trainingStart:async()=>prompt,trainingAnswer:async()=>({correct:true,word:'major',definition:'主要',next:{...prompt,promptId:'p2',remaining:0,completed:1}}),trainingFinish:async()=>{finishes++;return {accuracy:100}}})
  await c.mount();await c.submit(0);assert.equal(finishes,0)
  c.next();assert.equal(c.prompt.value.remaining,0)
  await c.finish();assert.equal(finishes,1);assert.equal(c.finished.value.accuracy,100)
})
