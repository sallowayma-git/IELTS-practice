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
        <nav v-if="collection" class="listening-audio" aria-label="精听收藏分页">
          <button class="btn btn-secondary" type="button" :disabled="changingPage || collection.page <= 1" @click="changePage(collection.page - 1)">上一页</button>
          <span>第 {{ collection.page }} / {{ collection.pages }} 页 · {{ collection.total }} 条收藏</span>
          <button class="btn btn-secondary" type="button" :disabled="changingPage || collection.page >= collection.pages" @click="changePage(collection.page + 1)">下一页</button>
          <p v-if="pageError" role="alert">{{ pageError }}</p>
        </nav>
        <section class="listening-audio" aria-label="精听播放控制">
          <button class="listening-audio__play" type="button" :disabled="busy||!state" :aria-label="state?.playing?'暂停录音':'继续播放'" @click="toggleCurrent">{{ state?.playing?'Ⅱ':'▶' }}</button>
          <span class="listening-audio__time">{{ formatTime(state?.currentTime) }} / {{ formatTime(state?.duration) }}</span>
          <input class="listening-audio__seek" type="range" :min="state?.start||0" :max="state?.end||state?.duration||1" step="0.1" :value="state?.currentTime||0" :disabled="busy||!state?.duration" aria-label="精听播放进度" @change="seek($event.target.value)">
          <label>速度 <select class="select" :value="rate" :disabled="busy" aria-label="精听速度" @change="changeRate($event.target.value)"><option v-for="speed in [.6,.8,1,1.2,1.5,2]" :key="speed" :value="speed">{{ speed }}×</option></select></label>
          <label v-if="!collection">练习模式
            <select v-model="mode" class="select" aria-label="精听练习模式" :disabled="busy || Boolean(markingSentence)" @change="changeMode">
              <option value="transcript">浏览原文</option>
              <option value="continuous">连续播放</option>
              <option value="sentence">整句听写</option>
              <option value="cloze">挖空听写</option>
              <option v-if="payload.articleMarking" value="mark">标记精听</option>
            </select>
          </label>
          <label v-if="mode === 'transcript' || mode === 'continuous'" class="listening-transcript__toggle"><input v-model="showTranslation" type="checkbox">逐句翻译</label>
          <template v-if="mode === 'continuous'">
            <label>播放轮数
              <select v-model.number="repetitions" class="select" :disabled="Boolean(sequence)">
                <option :value="1">1 轮</option><option :value="2">2 轮</option><option :value="3">3 轮</option><option :value="0">循环</option>
              </select>
            </label>
            <button v-if="sequence" class="btn btn-secondary" type="button" :disabled="busy" @click="stopSequence">结束连续播放</button>
            <p v-else-if="sequenceFinished" role="status">连续播放已结束。</p>
          </template>
          <p v-if="busy||state?.buffering" role="status">正在加载原站音频…</p>
          <p v-if="error||state?.error" role="alert">{{ error||state.error }}</p>
        </section>
        <ArticleDictation v-if="(mode === 'sentence' || mode === 'cloze') && playbackId" :mode="mode" :sentences="sentences"
          :session-id="playbackId" :audio-busy="busy" :saved="savedDictation"
          @play="play" @change-sentence="pausePlaying" @saved="(id, result) => savedDictation.states[id] = result" />
        <section v-else id="left" class="listening-exam__pane listening-transcript" data-study-transcript :aria-label="mode === 'mark' ? '标记精听' : '精听原文'">
          <div class="listening-exam__pane-body" tabindex="0">
            <p v-if="collection && !sentences.length" class="article-material__notice" role="status">
              {{ collection.total ? '本页没有可用的收藏句。' : '原站尚无精听收藏。' }}
            </p>
            <p v-else class="article-material__notice">{{ sentences.length }} 句 · {{ mode === 'continuous' ? '选择一句，开始连续播放。' : '点击句子旁的播放按钮开始。' }}</p>
            <p v-if="collection?.unavailable" class="article-material__notice">本页有 {{ collection.unavailable }} 条收藏的原文已不可用。</p>
            <div v-for="(sentence,index) in sentences" :key="sentence.id" :data-study-sentence="sentence.id" class="listening-transcript__sentence" :class="{'is-playing':state?.playing&&state.mediaId===sentence.audio?.mediaId}">
              <button class="listening-transcript__play" type="button" :disabled="busy||!sentence.audio" :aria-label="`播放第 ${index+1} 句`" @click="playSentence(sentence.audio.mediaId)"><span aria-hidden="true">▶</span>{{ index+1 }}</button>
              <div class="listening-transcript__text">
                <template v-if="mode === 'mark'">
                  <div class="article-mark-controls" role="group" :aria-label="`第 ${index + 1} 句的听懂程度`">
                    <button v-for="(label, choiceIndex) in markLabels" :key="label" class="btn btn-secondary"
                      type="button" :disabled="!sentence.audio || busy || Boolean(markingSentence)"
                      :aria-pressed="markStates[sentence.id]?.choice === choiceIndex + 1"
                      @click="mark(sentence.id, choiceIndex + 1)">{{ label }}</button>
                    <span v-if="markingSentence === sentence.id" role="status">正在保存…</span>
                    <span v-else-if="markStates[sentence.id]?.collected">已收藏</span>
                  </div>
                  <p v-if="markError?.id === sentence.id" role="alert">{{ markError.message }}</p>
                  <template v-if="markStates[sentence.id]?.choice">
                    <span>{{ sentence.text }}</span>
                    <p v-if="sentence.translation" class="listening-transcript__translation">{{ sentence.translation }}</p>
                  </template>
                </template>
                <template v-else>
                  <span>{{ sentence.text }}</span>
                  <p v-if="showTranslation&&sentence.translation" class="listening-transcript__translation">{{ sentence.translation }}</p>
                </template>
              </div>
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
import {computed,ref,watch,onMounted,onBeforeUnmount} from 'vue'
import { useRouter } from 'vue-router'
import UnifiedExamHeader from '@/modules/reading-unified/components/UnifiedExamHeader.vue'
import {idictation} from '@/api/idictation.js'
import {useArticlePlayback} from './useArticlePlayback.js'
import ArticleDictation from './ArticleDictation.vue'
const props=defineProps({assetId:{type:String,required:true}})
const router = useRouter()
const payload=ref(null),loading=ref(true),loadError=ref(''),showTranslation=ref(false)
const mode = ref('transcript'), playbackId = ref('')
const repetitions = ref(1), sequence = ref(null), sequenceFinished = ref(false)
const markLabels = ['听懂', '模糊', '茫然']
const markStates = ref({}), markingSentence = ref(''), markError = ref(null)
const savedDictation = ref(null)
const changingPage = ref(false)
const pageError = ref('')
const collection = computed(() => payload.value?.collectionPage)
const {state,error,busy,rate,attach,close,play,toggle,seek,changeRate}=useArticlePlayback()
const pausePlaying = () => { if (state.value?.playing) void toggle() }
const title=computed(()=>payload.value?.meta?.title||'爱听写精听')
const sentences=computed(()=>payload.value?.studyMaterial?.parts?.flatMap(part=>part.paragraphs.flatMap(p=>p.sentences))||[])
const mediaIds = computed(() => sentences.value.flatMap(row => row.audio ? [row.audio.mediaId] : []))

function playSentence(mediaId) {
  if (mode.value === 'continuous') {
    sequence.value = { mediaId, rounds: 0 }
    sequenceFinished.value = false
  }
  return play(mediaId)
}

function toggleCurrent() {
  if (mode.value === 'continuous' && !sequence.value && state.value?.ended) {
    return playSentence(state.value.mediaId)
  }
  return toggle()
}

function stopSequence() {
  sequence.value = null
  pausePlaying()
}

function changeMode() {
  stopSequence()
  sequenceFinished.value = false
}

watch([() => state.value?.mediaId, () => state.value?.ended, () => state.value?.error, error, busy],
  ([mediaId, ended, mediaError, playError, loadingAudio]) => {
    const current = sequence.value
    if (!current || loadingAudio) return
    if (mediaError || playError) { sequence.value = null; return }
    if (!ended || mediaId !== current.mediaId) return
    const next = mediaIds.value[mediaIds.value.indexOf(mediaId) + 1]
    const rounds = current.rounds + (next ? 0 : 1)
    if (!next && repetitions.value !== 0 && rounds >= repetitions.value) {
      sequence.value = null
      sequenceFinished.value = true
      return
    }
    const nextId = next || mediaIds.value[0]
    sequence.value = { mediaId: nextId, rounds }
    void play(nextId)
  })

function onVisibilityChange() {
  if (document.hidden) sequence.value = null
}
let alive=true,generation=0
const formatTime=value=>{const n=Math.max(0,Math.floor(Number(value)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
async function load(){const current=++generation;loading.value=true;loadError.value='';await close()
  try{const result=await idictation.articlePayload(props.assetId)
    if(!alive||current!==generation){await idictation.articleAudio(result.sessionId,'close');return}
    if(result.payload?.practiceKind!=='material'||result.payload?.materialKind!=='article'){
      await idictation.articleAudio(result.sessionId,'close');throw new Error('精听材料类型不匹配')
    }
    await attach(result.sessionId)
    if(alive&&current===generation){
      payload.value=result.payload;playbackId.value=result.sessionId
      markStates.value = result.payload.articleMarking?.states || {}
      savedDictation.value = result.payload.articleDictation || null
    }
  }catch(e){if(alive&&current===generation)loadError.value=e?.message||String(e)}finally{if(alive&&current===generation)loading.value=false}
}
async function mark(id, choice) {
  if (markingSentence.value || !playbackId.value) return
  markingSentence.value = id
  markError.value = null
  try {
    const result = await idictation.articleMark(playbackId.value, id, choice)
    if (alive) markStates.value[id] = result
  } catch (error) {
    if (alive) markError.value = { id, message: error?.message || String(error) }
  } finally {
    if (alive) markingSentence.value = ''
  }
}
async function changePage(page) {
  if (changingPage.value) return
  changingPage.value = true
  pageError.value = ''
  try {
    const assetId = await idictation.articleCollections(page)
    if (alive) await router.replace({ name: 'PracticeListening', params: { assetId } })
  } catch (failure) {
    if (alive) pageError.value = failure?.message || String(failure)
  } finally {
    if (alive) changingPage.value = false
  }
}
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  void load()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  alive = false
  generation++
})
</script>
<style src="../../apps/writing-vue/src/modules/practice-listening/styles/listening.css"></style>
<style scoped>.article-material{grid-template-rows:var(--header-height) auto minmax(0,1fr)!important}.article-material__notice{color:var(--muted-ink);margin-bottom:1rem}.listening-transcript__play:disabled{opacity:.4}.listening-audio select{padding:.2rem}.listening-transcript__text{white-space:pre-wrap}</style>
<style scoped>
.article-mark-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; }
.article-mark-controls button { padding: .3rem .65rem; border: 1px solid currentColor; border-radius: .25rem; }
.article-mark-controls button[aria-pressed="true"] { font-weight: 700; text-decoration: underline; }
</style>
