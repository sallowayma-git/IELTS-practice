<template>
  <section class="card idictation-training" aria-labelledby="idictation-training-title">
    <header><h2 id="idictation-training-title">爱听写 · {{ title }}</h2><button class="btn btn-ghost" type="button" :disabled="busy" @click="close">关闭</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!prompt && busy" role="status">正在读取原站章节与练习进度…</p>
    <template v-if="prompt">
      <p class="section-meta">{{ modeNames[prompt.mode] }} · 已处理 {{ prompt.completed }} / {{ prompt.total }} · 待练 {{ prompt.remaining }} 次</p>
      <p v-if="feedback" role="status" class="feedback">{{ feedback.correct ? '正确' : '本次答错' }} · {{ feedback.word }}<br>{{ feedback.definition }}</p>
      <template v-if="feedback">
        <button class="btn btn-primary" type="button" :disabled="busy || failed" @click="next">{{ feedback.next.remaining ? '继续' : '查看本章状态' }}</button>
      </template>
      <template v-else-if="prompt.remaining">
        <p v-if="prompt.word" class="training-word heading-serif">{{ prompt.word }}</p>
        <p v-if="prompt.definition" class="training-definition">{{ prompt.definition }}</p>
        <div v-if="prompt.mode !== 3" class="actions">
          <button class="btn btn-secondary" type="button" :disabled="busy || audioBusy || failed || !prompt.hasAudio" @click="play(false)">{{ audioBusy ? '加载音频…' : '播放词音' }}</button>
          <button v-if="prompt.hasSentenceAudio" class="btn btn-secondary" type="button" :disabled="busy || audioBusy || failed" @click="play(true)">播放原句</button>
          <span v-if="!prompt.hasAudio" role="status">此音源暂不可用</span>
        </div>
        <form v-if="prompt.mode === 1 || prompt.mode === 3" @submit.prevent="submit(null)">
          <input ref="input" v-model="typed" class="input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="爱听写拼写" :disabled="busy || failed" />
          <button class="btn btn-primary" type="submit" :disabled="busy || audioBusy || failed">{{ busy ? '提交中…' : '确认' }}</button>
        </form>
        <div v-else class="choices" role="group" aria-label="选择释义">
          <p v-if="!prompt.options.length">原站没有提供此词选项。跳过会按原站规则记为正确。</p>
          <button v-for="(option,index) in prompt.options" :key="index" class="btn btn-secondary" type="button" :disabled="busy || audioBusy || failed" @click="submit(index)">{{ option.label }}</button>
          <button v-if="prompt.options.length" class="btn btn-ghost" type="button" :disabled="busy || audioBusy || failed" @click="submit(null)">不知道</button>
          <button v-else class="btn btn-secondary" type="button" :disabled="busy || audioBusy || failed" @click="submit(null,true)">跳过此词</button>
        </div>
      </template>
      <template v-else>
        <p v-if="!finished">本章词条已作答。完成本章后读取原站结果。</p>
        <button v-if="!finished" class="btn btn-primary" type="button" :disabled="busy || failed" @click="finish">完成本章并读取结果</button>
        <p v-if="finished" role="status">原站已确认章节完成{{ finished.accuracy != null ? ` · 原站正确率 ${finished.accuracy}` : '' }}</p>
      </template>
      <p class="section-meta">作答会保存到爱听写；本地复习计划独立保留。完成章节沿用原站流程，可能生成章节故事。</p>
    </template>
  </section>
</template>
<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { idictation } from '@/api/idictation.js'
const props=defineProps({bookId:{type:String,required:true},unitId:{type:String,required:true},title:{type:String,default:''},mode:{type:Number,required:true},resume:{type:Boolean,default:true}})
const emit=defineEmits(['close'])
const prompt=ref(null),typed=ref(''),busy=ref(false),audioBusy=ref(false),error=ref(''),feedback=ref(null),finished=ref(null),failed=ref(false),input=ref(null)
const modeNames={1:'听写',2:'听音选义',3:'默写',4:'看词选义'}
let alive=true
let closedSession=''
const message=e=>e?.message||String(e)
async function play(sentence){
  if(busy.value||audioBusy.value||failed.value)return
  audioBusy.value=true;error.value=''
  try{await idictation.trainingAudio(prompt.value.sessionId,prompt.value.promptId,sentence)}
  catch(e){if(alive)error.value=message(e)}finally{if(alive)audioBusy.value=false}
}
async function submit(choice,skipMissing=false){
  if(busy.value||audioBusy.value||failed.value||feedback.value)return
  busy.value=true;error.value=''
  try{const result=await idictation.trainingAnswer(prompt.value.sessionId,prompt.value.promptId,typed.value,choice,skipMissing);if(alive)feedback.value=result}
  catch(e){if(alive){failed.value=true;error.value=message(e)}}finally{if(alive)busy.value=false}
}
function next(){prompt.value=feedback.value.next;feedback.value=null;typed.value='';void nextTick(()=>input.value?.focus())}
async function finish(){
  if(busy.value||failed.value)return
  busy.value=true;error.value=''
  try{const result=await idictation.trainingFinish(prompt.value.sessionId,prompt.value.promptId);if(alive)finished.value=result}
  catch(e){if(alive){failed.value=true;error.value=message(e)}}finally{if(alive)busy.value=false}
}
async function close(){
  if(busy.value)return
  busy.value=true
  try{if(prompt.value){await idictation.trainingClose(prompt.value.sessionId);closedSession=prompt.value.sessionId}emit('close')}
  catch(e){error.value=message(e)}finally{busy.value=false}
}
onMounted(async()=>{
  busy.value=true
  try{
    const result=await idictation.trainingStart(props.bookId,props.unitId,props.mode,props.resume)
    if(!alive){await idictation.trainingClose(result.sessionId);return}
    prompt.value=result;await nextTick();input.value?.focus()
  }catch(e){if(alive)error.value=message(e)}finally{if(alive)busy.value=false}
})
onBeforeUnmount(()=>{alive=false;if(prompt.value&&closedSession!==prompt.value.sessionId)void idictation.trainingClose(prompt.value.sessionId).catch(()=>{})})
</script>
<style scoped>
.idictation-training{display:grid;gap:1rem;max-width:720px;width:100%;margin:auto;padding:1.5rem}.idictation-training header,.actions,form{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap}.idictation-training h2{margin:0}.training-word{font-size:2.2rem;text-align:center}.training-definition,.feedback{white-space:pre-wrap}.choices{display:grid;gap:.6rem}.choices button{white-space:normal;justify-content:flex-start;text-align:left}form input{flex:1;min-width:180px}
</style>
