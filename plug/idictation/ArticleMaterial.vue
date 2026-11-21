<template>
  <div class="runified listening-exam article-material" data-idictation-material>
    <UnifiedExamHeader :title="title" subtitle="爱听写 · 精听材料" :show-timer="false" instruction="逐句播放与翻译">
      <template #heading><h1 class="listening-exam__title">{{ title }}</h1></template>
      <template #controls><router-link class="listening-exam__back" :to="{name:'ListeningLibrary'}">返回听力题库</router-link></template>
    </UnifiedExamHeader>
    <main class="listening-exam__workspace">
      <p v-if="loading" role="status">正在读取精听材料…</p>
      <section v-else-if="loadError" class="listening-state" role="alert"><p>{{ loadError }}</p><button type="button" class="btn btn-secondary" @click="load">重试</button></section>
      <template v-else-if="payload">
        <section class="listening-audio" aria-label="精听播放控制">
          <button class="listening-audio__play" type="button" :disabled="busy||!state" :aria-label="state?.playing?'暂停录音':'继续播放'" @click="toggle">{{ state?.playing?'Ⅱ':'▶' }}</button>
          <span class="listening-audio__time">{{ formatTime(state?.currentTime) }} / {{ formatTime(state?.duration) }}</span>
          <input class="listening-audio__seek" type="range" :min="state?.start||0" :max="state?.end||state?.duration||1" step="0.1" :value="state?.currentTime||0" :disabled="busy||!state?.duration" aria-label="精听播放进度" @change="seek($event.target.value)">
          <label>速度 <select class="select" :value="rate" :disabled="busy" aria-label="精听速度" @change="changeRate($event.target.value)"><option v-for="speed in [.6,.8,1,1.2,1.5,2]" :key="speed" :value="speed">{{ speed }}×</option></select></label>
          <label class="listening-transcript__toggle"><input v-model="showTranslation" type="checkbox">逐句翻译</label>
          <p v-if="busy||state?.buffering" role="status">正在加载原站音频…</p>
          <p v-if="error||state?.error" role="alert">{{ error||state.error }}</p>
        </section>
        <section id="left" class="listening-exam__pane listening-transcript" data-study-transcript aria-label="精听原文">
          <div class="listening-exam__pane-body" tabindex="0">
            <p class="article-material__notice">{{ sentences.length }} 句 · 点击句子旁的播放按钮开始。播放不提交听写成绩。</p>
            <div v-for="(sentence,index) in sentences" :key="sentence.id" :data-study-sentence="sentence.id" class="listening-transcript__sentence" :class="{'is-playing':state?.playing&&state.mediaId===sentence.audio?.mediaId}">
              <button class="listening-transcript__play" type="button" :disabled="busy||!sentence.audio" :aria-label="`播放第 ${index+1} 句`" @click="play(sentence.audio.mediaId)"><span aria-hidden="true">▶</span>{{ index+1 }}</button>
              <div class="listening-transcript__text"><span>{{ sentence.text }}</span><p v-if="showTranslation&&sentence.translation" class="listening-transcript__translation">{{ sentence.translation }}</p></div>
            </div>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
<script setup>
import '@/modules/reading-unified/styles/unified.css'
import '@/modules/practice-reading/styles/host-extras.css'
import {computed,ref,onMounted,onBeforeUnmount} from 'vue'
import UnifiedExamHeader from '@/modules/reading-unified/components/UnifiedExamHeader.vue'
import {idictation} from '@/api/idictation.js'
import {useArticlePlayback} from './useArticlePlayback.js'
const props=defineProps({assetId:{type:String,required:true}})
const payload=ref(null),loading=ref(true),loadError=ref(''),showTranslation=ref(false)
const {state,error,busy,rate,attach,close,play,toggle,seek,changeRate}=useArticlePlayback()
const title=computed(()=>payload.value?.meta?.title||'爱听写精听')
const sentences=computed(()=>payload.value?.studyMaterial?.parts?.flatMap(part=>part.paragraphs.flatMap(p=>p.sentences))||[])
let alive=true,generation=0
const formatTime=value=>{const n=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
async function load(){const current=++generation;loading.value=true;loadError.value='';await close()
  try{const result=await idictation.articlePayload(props.assetId)
    if(!alive||current!==generation){await idictation.articleAudio(result.sessionId,'close');return}
    if(result.payload?.practiceKind!=='material'||result.payload?.materialKind!=='article'){
      await idictation.articleAudio(result.sessionId,'close');throw new Error('精听材料类型不匹配')
    }
    payload.value=result.payload;await attach(result.sessionId)
  }catch(e){if(alive&&current===generation)loadError.value=e?.message||String(e)}finally{if(alive&&current===generation)loading.value=false}
}
onMounted(load);onBeforeUnmount(()=>{alive=false;generation++})
</script>
<style src="../../apps/writing-vue/src/modules/practice-listening/styles/listening.css"></style>
<style scoped>.article-material{grid-template-rows:var(--header-height) auto minmax(0,1fr)!important}.article-material__notice{color:var(--muted-ink);margin-bottom:1rem}.listening-transcript__play:disabled{opacity:.4}.listening-audio select{padding:.2rem}.listening-transcript__text{white-space:pre-wrap}</style>
