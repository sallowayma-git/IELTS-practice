import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../../../plug/idictation/article-audio.js',import.meta.url),'utf8')
function harness(){
  let now=1000,id=0
  const timers=new Map(),timeouts=new Map(),media=[],window={}
  class Audio{constructor(){this.paused=true;this.currentTime=0;this.duration=200;media.push(this)}
    pause(){this.paused=true;this.onpause?.()}
    play(){this.paused=false;this.onplaying?.();return Promise.resolve()}
    load(){queueMicrotask(()=>this.onloadedmetadata?.())}}
  const context=vm.createContext({window,Audio,Date:{now:()=>now},Number,
    setInterval:fn=>{timers.set(++id,fn);return id},clearInterval:id=>timers.delete(id),
    setTimeout:fn=>{timeouts.set(++id,fn);return id},clearTimeout:id=>timeouts.delete(id)})
  const start=vm.runInContext(`${source};startArticleAudio`,context)
  return {window,media,timers,start,tick:()=>[...timers.values()].forEach(fn=>fn()),advance:ms=>now+=ms}
}
const input={sessionId:'s',mediaId:'m',url:'https://itx-jingting.oss-cn-beijing.aliyuncs.com/a.mp3',start:117.526,end:119.753,rate:1}
test('track range uses original offsets, ends at boundary, clip plays entire media',async()=>{
  const h=harness(),controller=new AbortController(),slot={}
  const result=await h.start(input,controller.signal,slot)
  assert.equal(result.currentTime,117.526);assert.equal(result.playing,true)
  h.media[0].currentTime=119.75;h.tick();assert.equal(h.media[0].paused,true)
  assert.equal(h.window.__atlasArticleAudio.snapshot().ended,true)
  const clip=await h.start({...input,mediaId:'clip',start:0,end:null},controller.signal,{})
  assert.equal(clip.currentTime,0);h.media[1].currentTime=150;h.tick();assert.equal(h.media[1].paused,false)
  h.media[1].pause()
  assert.equal(h.window.__atlasArticleAudio.snapshot().ended,false)
  h.media[1].onended()
  assert.equal(h.window.__atlasArticleAudio.snapshot().ended,true)
})
test('lost host receipt stops successful Audio; confirmed host handoff preserves it',async()=>{
  for(const accepted of [false,true]){
    const h=harness(),controller=new AbortController(),slot={}
    await h.start(input,controller.signal,slot);slot.keepAudio=accepted;controller.abort()
    assert.equal(h.media[0].paused,!accepted)
  }
})
test('replacing media stops old Audio and resumed playback keeps current position',async()=>{
  const h=harness(),controller=new AbortController()
  await h.start(input,controller.signal,{keepAudio:true});h.media[0].currentTime=118
  const resumed=await h.start({...input,resume:true},controller.signal,{keepAudio:true})
  assert.equal(h.media[0].src,'');assert.equal(resumed.currentTime,118)
  const next=await h.start({...input,mediaId:'next',start:0,end:null},controller.signal,{keepAudio:true})
  assert.equal(h.media[1].src,'');assert.equal(next.currentTime,0)
})
test('loss of host polling pauses without sending a remote request',async()=>{
  const h=harness();await h.start(input,new AbortController().signal,{keepAudio:true})
  h.advance(8100);h.tick();assert.equal(h.media[0].paused,true);assert.equal(h.timers.size,0)
})
test('cancel before metadata rejects and cannot start later',async()=>{
  const h=harness(),controller=new AbortController();const pending=h.start(input,controller.signal,{})
  controller.abort();await assert.rejects(pending);assert.equal(h.media[0].paused,true);assert.equal(h.media[0].src,'')
})
test('resume after failed load starts at the track sentence instead of zero',async()=>{
  const h=harness(),controller=new AbortController();const pending=h.start(input,controller.signal,{})
  controller.abort();await assert.rejects(pending)
  assert.equal(h.window.__atlasArticleAudio.snapshot(),null)
  const result=await h.start({...input,resume:true},new AbortController().signal,{keepAudio:true})
  assert.equal(result.currentTime,input.start)
})
