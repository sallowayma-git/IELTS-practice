<template>
  <main class="workspace speaking-workspace">
    <section class="speaking-page scroll-region" aria-labelledby="speaking-title">
      <header class="page-header">
        <div class="page-header-top">
          <h1 id="speaking-title" class="heading-serif">爱听写口语题库</h1>
          <router-link class="btn btn-secondary" :to="{ name: 'PracticeLibrary', query: { view: 'more' } }">返回题库</router-link>
        </div>
      </header>
      <div v-if="topic" class="speaking-topic">
        <div class="speaking-toolbar">
          <h2 class="heading-serif">{{ topic.title }}</h2>
          <button class="btn btn-secondary" type="button" @click="backToTopics">返回话题列表</button>
        </div>
        <p v-if="audioError || state?.error" role="alert">{{ audioError || state.error }}</p>
        <article v-for="question in topic.questions" :key="question.id" class="card speaking-question">
          <div class="speaking-toolbar">
            <span class="section-meta">Part {{ question.part }}</span>
            <button v-if="question.mediaId" class="btn btn-secondary" type="button" :disabled="busy" @click="playQuestion(question.mediaId)">
              {{ state?.mediaId === question.mediaId && state.playing ? '暂停题目录音' : '播放题目录音' }}
            </button>
          </div>
          <h3>{{ question.title }}</h3>
          <ul v-if="question.cues.length">
            <li v-for="(cue, index) in question.cues" :key="index">{{ cue }}</li>
          </ul>
          <details v-if="question.ideas.length">
            <summary>示例思路</summary>
            <div v-for="(idea, index) in question.ideas" :key="index" class="speaking-idea">
              <h4>{{ [idea.title.en, idea.title.zh].filter(Boolean).join(' · ') }}</h4>
              <ul v-if="idea.points.length">
                <li v-for="(point, number) in idea.points" :key="number">{{ [point.en, point.zh].filter(Boolean).join(' · ') }}</li>
              </ul>
              <template v-for="(sample, number) in idea.samples" :key="number">
                <p v-if="sample.en || sample.zh"><strong>{{ number === 0 ? '6 分示例' : '7 分示例' }}</strong><br>{{ [sample.en, sample.zh].filter(Boolean).join('\n') }}</p>
              </template>
            </div>
          </details>
        </article>
      </div>
      <template v-else>
        <div class="speaking-toolbar">
          <label>题目分组
            <select v-model.number="selection" class="input" :disabled="loading" @change="load">
              <option :value="1">Part 1</option>
              <option :value="2">Part 2 / 3</option>
            </select>
          </label>
          <label>题库范围
            <select v-model.number="group" class="input" :disabled="loading">
              <option :value="0">中国大陆</option>
              <option :value="1">非中国大陆</option>
              <option :value="2">原站已练话题</option>
            </select>
          </label>
          <label>搜索话题 <input v-model.trim="keyword" class="input" type="search"></label>
        </div>
        <p v-if="loading" role="status">{{ opening ? '正在打开原站话题…' : '正在加载原站口语目录…' }}</p>
        <div v-else-if="catalogError" role="alert">
          <p>{{ catalogError }}</p>
          <button class="btn btn-secondary" type="button" @click="load">重新加载</button>
        </div>
        <template v-else>
          <p v-if="topicError" role="alert">{{ topicError }}</p>
          <p v-if="!cards.length" role="status">当前范围没有匹配的话题。</p>
          <ul v-else class="speaking-list">
            <li v-for="card in cards" :key="card.id" class="card speaking-toolbar">
              <strong>{{ card.title }}</strong>
              <button class="btn btn-secondary" type="button" :disabled="!card.available" @click="open(card.id)">
                {{ card.available ? '查看题目' : '原站暂不可用' }}
              </button>
            </li>
          </ul>
        </template>
      </template>
    </section>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { idictation } from '@/api/idictation.js'
import { useArticlePlayback } from './useArticlePlayback.js'

const selection = ref(1), group = ref(0), keyword = ref('')
const groups = ref([]), topic = ref(null)
const loading = ref(true), opening = ref(false), catalogError = ref(''), topicError = ref('')
const { attach, close, play, toggle, state, busy, error: audioError } = useArticlePlayback()
const cards = computed(() => (groups.value[group.value] || [])
  .filter(card => card.title.toLowerCase().includes(keyword.value.toLowerCase())))
let alive = true
const message = error => error?.message || String(error)

async function load() {
  loading.value = true
  catalogError.value = ''
  topicError.value = ''
  groups.value = []
  try {
    const result = await idictation.speakingCatalog(selection.value)
    if (alive) groups.value = result
  } catch (error) {
    if (alive) catalogError.value = message(error)
  } finally {
    if (alive) loading.value = false
  }
}

async function open(id) {
  if (loading.value) return
  opening.value = true
  loading.value = true
  topicError.value = ''
  try {
    const result = await idictation.openSpeaking(id)
    await attach(result.sessionId)
    if (alive) topic.value = result
  } catch (error) {
    if (alive) topicError.value = message(error)
  } finally {
    if (alive) {
      opening.value = false
      loading.value = false
    }
  }
}

function playQuestion(mediaId) {
  if (state.value?.mediaId === mediaId && !state.value.ended && !state.value.error) return toggle()
  return play(mediaId)
}

function backToTopics() {
  topic.value = null
  void close()
}

onMounted(load)
onBeforeUnmount(() => { alive = false })
</script>

<style scoped>
.speaking-workspace { grid-template-rows: minmax(0, 1fr); }
.speaking-page, .speaking-topic { display: grid; gap: var(--anth-space-4); align-content: start; }
.speaking-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--anth-space-3); }
.speaking-toolbar h2 { margin: 0; }
.speaking-toolbar label { display: grid; gap: var(--anth-space-2); flex: 1 1 10rem; }
.speaking-list { display: grid; gap: var(--anth-space-2); padding: 0; margin: 0; list-style: none; }
.speaking-list li, .speaking-question { padding: var(--anth-space-4); }
.speaking-question h3, .speaking-question li, .speaking-idea p { white-space: pre-line; overflow-wrap: anywhere; }
.speaking-idea { margin-top: var(--anth-space-3); }
</style>
