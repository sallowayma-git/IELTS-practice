// Product-window Audio only. URLs are selected by Rust from authorized material.
// Control calls use this state locally; polling does not call a remote API.
function startArticleAudio(input, signal, slot) {
  const old=window.__atlasArticleAudio
  const resume=input.resume && old?.sessionId===input.sessionId && old.mediaId===input.mediaId
    && !old.disposed && !old.error && old.audio.currentTime>=old.start
    && old.audio.currentTime<(old.end??old.audio.duration)-0.02
  const start=resume?old.audio.currentTime:input.start
  old?.dispose()
  const audio=new Audio()
  const state={audio,sessionId:input.sessionId,mediaId:input.mediaId,start:input.start,end:input.end,
    buffering:true,error:'',lease:Date.now(),timer:null,disposed:false,
    dispose(){this.disposed=true;clearInterval(this.timer);audio.pause();audio.src=''},
    pause(){audio.pause();this.buffering=false;clearInterval(this.timer)},
    snapshot(){if(this.disposed)return null;this.lease=Date.now();return {mediaId:this.mediaId,currentTime:audio.currentTime||0,
      duration:Number.isFinite(audio.duration)?audio.duration:0,playing:!audio.paused,buffering:this.buffering,
      rate:audio.playbackRate,error:this.error,start:this.start,end:this.end}}
  }
  window.__atlasArticleAudio=state
  const stop=()=>{if(!slot.keepAudio)state.dispose()}
  signal.addEventListener('abort',stop,{once:true})
  audio.onwaiting=()=>{state.buffering=true}
  audio.onplaying=()=>{state.buffering=false;clearInterval(state.timer);state.timer=setInterval(()=>{
    if(Date.now()-state.lease>8000){state.pause();return}
    if(state.end!=null&&audio.currentTime>=state.end-0.01)state.pause()
  },40)}
  audio.onpause=()=>{state.buffering=false;clearInterval(state.timer)}
  audio.onended=()=>{state.buffering=false;clearInterval(state.timer)}
  audio.onerror=()=>{state.error='原站音频加载失败';state.pause()}
  return new Promise((resolve,reject)=>{
    let done=false
    const timeout=setTimeout(()=>finish({atlasCode:'audio'}),15000)
    audio.onerror=()=>{state.error='原站音频加载失败';state.pause();finish({atlasCode:'audio'})}
    function finish(error){
      if(done)return;done=true;clearTimeout(timeout);audio.onloadedmetadata=null
      if(error){state.dispose();reject(error)}else{state.lease=Date.now();resolve(state.snapshot())}
    }
    signal.addEventListener('abort',()=>finish({atlasCode:'cancelled'}),{once:true})
    audio.onloadedmetadata=async()=>{
      if(done||state.disposed)return
      if(!Number.isFinite(audio.duration)||start>=audio.duration){finish({atlasCode:'audio'});return}
      try{audio.currentTime=start;audio.playbackRate=input.rate;await audio.play();
        if(state.disposed||signal.aborted){finish({atlasCode:'cancelled'});return}finish()
      }catch(error){finish(error)}
    }
    audio.src=input.url
    audio.load()
    if(signal.aborted||window.__atlasArticleStoppedSession===input.sessionId||window.__atlasArticlePausedSession===input.sessionId)finish({atlasCode:'cancelled'})
  })
}
