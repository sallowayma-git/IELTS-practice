<template>
  <section class="vocabulary-state" aria-label="爱听写随身听">
    <div class="walkman-row walkman-heading">
      <h2 class="heading-serif">{{ title }} · 随身听</h2>
      <button class="btn btn-secondary" type="button" @click="$emit('close')">返回词书</button>
    </div>
    <p v-if="loading" role="status">正在读取原站词音…</p>
    <template v-else-if="loadError">
      <p role="alert">{{ loadError }}</p>
      <button class="btn btn-secondary" type="button" @click="load">重试</button>
    </template>
    <template v-else>
      <div class="walkman-row">
        <label>发音
          <select v-model="accent" class="input" :disabled="running || busy" @change="index = 0">
            <option value="american">美音</option><option value="british">英音</option>
          </select>
        </label>
        <label>速度
          <select class="input" :value="rate" :disabled="running || busy" @change="changeRate($event.target.value)">
            <option v-for="speed in [.6,.8,1,1.2,1.5,2]" :key="speed" :value="speed">{{ speed }}×</option>
          </select>
        </label>
        <label>词间隔
          <select v-model.number="gap" class="input" :disabled="running || busy">
            <option v-for="seconds in [0,1,3,5]" :key="seconds" :value="seconds">{{ seconds }} 秒</option>
          </select>
        </label>
      </div>
      <p v-if="!available.length" role="status">本章暂无可播放的{{ accent === 'american' ? '美音' : '英音' }}词条。</p>
      <template v-else>
        <div v-if="word" class="walkman-word" role="status">
          <span class="section-meta">{{ index + 1 }} / {{ available.length }}</span>
          <strong class="heading-serif">{{ word.term }}</strong>
          <span v-if="word.definition">{{ word.definition }}</span>
        </div>
        <p v-if="available.length < words.length" class="section-meta">有 {{ words.length - available.length }} 个词条缺少当前发音。</p>
        <div class="walkman-row">
          <button class="btn btn-secondary" type="button" :disabled="busy || index === 0" @click="move(-1)">上一词</button>
          <button class="btn btn-primary" type="button" :disabled="busy" @click="running ? pause() : start()">{{ running ? '暂停' : '播放' }}</button>
          <button class="btn btn-secondary" type="button" :disabled="busy || index + 1 >= available.length" @click="move(1)">下一词</button>
        </div>
      </template>
      <p v-if="error || state?.error" role="alert">{{ error || state.error }}</p>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { idictation } from '@/api/idictation.js'
import { useArticlePlayback } from './useArticlePlayback.js'

const props = defineProps({ bookId: String, unitId: String, title: String })
defineEmits(['close'])
const { attach, play, toggle, state, error, busy, rate, changeRate } = useArticlePlayback()
const loading = ref(true), loadError = ref(''), words = ref([])
const accent = ref('american'), gap = ref(1), index = ref(0), running = ref(false)
const available = computed(() => words.value.filter(word => word[accent.value]))
const word = computed(() => available.value[index.value])
let alive = true, timer, generation = 0

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await idictation.walkmanOpen(props.bookId, props.unitId)
    await attach(result.sessionId)
    if (alive) words.value = result.words
  } catch (failure) {
    if (alive) loadError.value = failure?.message || String(failure)
  } finally {
    if (alive) loading.value = false
  }
}

function stopQueue() {
  running.value = false
  generation++
  clearTimeout(timer)
}

async function start() {
  if (!word.value || document.hidden) return
  const current = ++generation
  running.value = true
  const mediaId = word.value[accent.value]
  if (state.value?.mediaId === mediaId && !state.value.ended && !state.value.error) await toggle()
  else await play(mediaId)
  if (current === generation && !state.value?.playing && !state.value?.ended) stopQueue()
}

async function pause() {
  stopQueue()
  if (state.value?.playing) await toggle()
}

async function move(delta) {
  await pause()
  if (!alive) return
  index.value += delta
}

watch([() => state.value?.mediaId, () => state.value?.ended, () => state.value?.error, error], ([mediaId, ended, failure, requestError]) => {
  if (failure || requestError) { stopQueue(); return }
  if (!running.value || !ended || mediaId !== word.value?.[accent.value]) return
  if (index.value + 1 >= available.value.length) { stopQueue(); return }
  const current = generation
  timer = setTimeout(() => {
    if (current !== generation || document.hidden || !alive) return
    index.value++
    void start()
  }, gap.value * 1000)
})

function onVisibilityChange() {
  if (document.hidden) stopQueue()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  void load()
})
onBeforeUnmount(() => {
  alive = false
  stopQueue()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.vocabulary-state {
  display: grid;
  gap: var(--anth-space-4);
}

.walkman-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--anth-space-3);
}

.walkman-heading {
  justify-content: space-between;
}

.walkman-heading h2 {
  margin: 0;
}

.walkman-row label,
.walkman-word {
  display: grid;
  gap: var(--anth-space-2);
}

.walkman-row select {
  width: auto;
  min-width: 7rem;
}

.walkman-word strong {
  font-size: 1.65rem;
  overflow-wrap: anywhere;
}
</style>
