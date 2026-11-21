import {ref,onBeforeUnmount} from 'vue'
import {idictation} from '@/api/idictation.js'
export function useArticlePlayback(){
  const state=ref(null),error=ref(''),busy=ref(false),rate=ref(1)
  let session='',generation=0,timer=null,alive=true
  const message=e=>e?.message||String(e)
  function schedule(current){clearTimeout(timer);if(alive&&session&&current===generation)timer=setTimeout(()=>poll(current),350)}
  async function poll(current){
    try{const result=await idictation.articleAudio(session,'state');if(alive&&current===generation){state.value=result;schedule(current)}}
    catch(e){if(alive&&current===generation){error.value=message(e);state.value=null}}
  }
  async function close(){const old=session;generation++;session='';clearTimeout(timer);state.value=null;busy.value=false
    if(old)await idictation.articleAudio(old,'close').catch(()=>{})
  }
  async function attach(id){await close();if(!alive){await idictation.articleAudio(id,'close').catch(()=>{});return}session=id;error.value=''}
  async function control(action,mediaId=null,value=null){
    if(!session||busy.value)return
    const current=++generation;busy.value=true;error.value='';clearTimeout(timer)
    try{const result=await idictation.articleAudio(session,action,mediaId,value);if(alive&&current===generation)state.value=result}
    catch(e){if(alive&&current===generation){error.value=message(e);state.value=null}}
    finally{if(alive&&current===generation){busy.value=false;schedule(current)}}
  }
  const play=mediaId=>control('play',mediaId,rate.value)
  const toggle=()=>state.value?.playing?control('pause'):control('resume',state.value?.mediaId,rate.value)
  const seek=value=>control('seek',null,Number(value))
  const changeRate=value=>{rate.value=Number(value);if(state.value)return control('rate',null,rate.value)}
  function hidden(){if(document.hidden&&session){
    const current=++generation;clearTimeout(timer);busy.value=false
    if(state.value)state.value={...state.value,playing:false}
    void idictation.articleAudio(session,'pause').then(result=>{if(alive&&current===generation)state.value=result}).catch(()=>{})
  }}
  document.addEventListener('visibilitychange',hidden)
  onBeforeUnmount(()=>{alive=false;document.removeEventListener('visibilitychange',hidden);void close()})
  return {state,error,busy,rate,attach,close,play,toggle,seek,changeRate}
}
