import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../../../plug/idictation/useArticlePlayback.js',import.meta.url),'utf8').replace(/^import[^\n]+\r?\n/gm,'').replace('export function','function')
function harness(api){let unmount,timer,hidden;const document={hidden:false,addEventListener:(_,fn)=>hidden=fn,removeEventListener:()=>{}}
  const playback=new Function('ref','onBeforeUnmount','idictation','setTimeout','clearTimeout','document',`${source};return useArticlePlayback()`)(value=>({value}),fn=>unmount=fn,api,fn=>{timer=fn;return 1},()=>{timer=null},document)
  return {...playback,unmount:()=>unmount(),poll:()=>timer?.(),hide:()=>{document.hidden=true;hidden()}}
}
test('late play completion cannot restore a closed playback session',async()=>{
  let release;const calls=[]
  const h=harness({articleAudio:async(id,action)=>{calls.push([id,action]);if(action==='play')return new Promise(resolve=>release=resolve)}})
  await h.attach('a');const playing=h.play('m');await h.close();release({playing:true,mediaId:'m'});await playing
  assert.equal(h.state.value,null);assert.equal(h.busy.value,false);assert.deepEqual(calls,[['a','play'],['a','close']])
})
test('old poll cannot overwrite a newer media control result',async()=>{
  let release
  const h=harness({articleAudio:async(_id,action,media)=>{if(action==='state')return new Promise(resolve=>release=resolve);return {mediaId:media,playing:true}}})
  await h.attach('a');await h.play('first');const polling=h.poll();await h.play('second');release({mediaId:'first'});await polling
  assert.equal(h.state.value.mediaId,'second')
})
test('unmount closes its session and hidden document pauses source playback',async()=>{
  const calls=[];const h=harness({articleAudio:async(id,action)=>{calls.push([id,action]);return {playing:true}}})
  await h.attach('a');await h.play('m');h.hide();h.unmount();await Promise.resolve()
  assert.deepEqual(calls,[['a','play'],['a','pause'],['a','close']])
})
test('hidden view discards late play response and does not renew playback lease',async()=>{
  let release;const h=harness({articleAudio:async(_id,action)=>action==='play'?new Promise(resolve=>release=resolve):null})
  await h.attach('a');const pending=h.play('m');h.hide();release({playing:true,mediaId:'m'});await pending
  assert.equal(h.state.value,null);assert.equal(h.poll(),undefined);assert.equal(h.busy.value,false)
})
