<template>
  <section class="card vocab-session" aria-labelledby="vocab-session-title">
    <header class="vocab-session__header">
      <div class="vocab-session__heading">
        <h2 id="vocab-session-title">复习会话</h2>
        <span v-if="stage !== 'complete'" class="section-meta">本批剩余 {{ batchRemaining }}</span>
      </div>
      <button class="btn btn-ghost btn-sm" type="button" @click="close">关闭</button>
    </header>

    <p v-if="notice" class="inline-message inline-message-info" role="status" aria-live="polite">{{ notice }}</p>

    <p v-if="saveError" class="inline-message inline-message-error vocab-session__save-error" role="alert">
      <span>{{ saveError }}</span>
      <button class="btn btn-secondary btn-sm" type="button" @click="retrySave">重试保存</button>
    </p>

    <template v-if="stage === 'recall' && current">
      <div class="vocab-session__word">
        <p class="vocab-session__term heading-serif">{{ current.term }}</p>
        <p v-if="current.phonetic || current.partOfSpeech" class="vocab-session__meta">
          <span v-if="current.phonetic">{{ current.phonetic }}</span>
          <span v-if="current.partOfSpeech">{{ current.partOfSpeech }}</span>
        </p>
      </div>
      <div class="vocab-session__ratings" role="group" aria-label="回忆评分">
        <button
          v-for="rating in RATINGS"
          :key="rating.value"
          class="btn btn-secondary"
          type="button"
          @click="rate(rating.value)"
        >{{ rating.label }}</button>
      </div>
      <div class="vocab-session__footer">
        <button class="btn btn-ghost" type="button" @click="skipCurrent">跳过</button>
      </div>
    </template>

    <template v-else-if="stage === 'spelling' && current">
      <div class="vocab-session__prompt">
        <p class="vocab-session__definition">{{ current.definition || '根据释义拼写单词' }}</p>
        <p v-if="current.example" class="vocab-session__example">{{ current.example }}</p>
      </div>
      <form class="vocab-session__form" @submit.prevent="submit">
        <input
          ref="inputEl"
          v-model="typed"
          class="input vocab-session__input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="拼写单词"
          placeholder="拼写这个单词"
        />
        <button class="btn btn-primary btn-lg" type="submit">确认</button>
      </form>
      <p v-if="spellingMisses > 0" class="inline-message inline-message-warning" role="status">
        拼写不对，再试一次（还剩 {{ remainingTries }} 次）
      </p>
      <div class="vocab-session__footer">
        <button class="btn btn-ghost" type="button" @click="skipCurrent">跳过</button>
      </div>
    </template>

    <div v-else class="vocab-session__complete">
      <h3>本批复习完成</h3>
      <p class="vocab-session__complete-count">共复习 {{ reviewedCount }} 个单词</p>
      <div class="vocab-session__stats">
        <span class="tag tag-danger">错误 {{ stats.wrong }}</span>
        <span class="tag tag-warning">模糊 {{ stats.hard }}</span>
        <span class="tag tag-success">正确 {{ stats.good }}</span>
        <span class="tag tag-accent">很熟 {{ stats.easy }}</span>
      </div>
      <p v-if="saved > 0" class="section-meta">已保存 {{ saved }} 条复习记录</p>
      <button class="btn btn-primary" type="button" @click="finish">完成</button>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { reviewVocab } from '@/api/enrichment-repository.js'
import { GRADE, createSession, rateRecall, skip, submitSpelling } from '../vocabSessionCore.js'

const props = defineProps({
  items: { type: Array, required: true },
  batchSize: { type: Number, default: undefined }
})

const emit = defineEmits(['close', 'updated', 'finished'])

const RATINGS = [
  { value: 'wrong', label: '不认识' },
  { value: 'hard', label: '模糊' },
  { value: 'good', label: '认识' },
  { value: 'easy', label: '很熟' }
]
const GRADE_LABELS = { wrong: '错误', hard: '模糊', good: '正确', easy: '很熟' }

const session = ref(createSession(props.items, { now: Date.now(), batchSize: props.batchSize }))
const typed = ref('')
const notice = ref('')
const saveError = ref('')
const saved = ref(0)
const pendingSaves = ref([])
const inputEl = ref(null)
const saving = new Set()
let closed = false

const stage = computed(() => session.value.stage)
const current = computed(() => session.value.current)
const stats = computed(() => session.value.stats)
const spellingMisses = computed(() => session.value.spellingMisses)
const remainingTries = computed(() => Math.max(0, 3 - spellingMisses.value))
const batchRemaining = computed(() => session.value.batch.length)
const reviewedCount = computed(() => {
  const value = session.value.stats
  return value.wrong + value.hard + value.good + value.easy
})

function focusInput() {
  nextTick(() => inputEl.value?.focus())
}

function commit(next) {
  const previousResult = session.value.lastResult
  session.value = next
  const finalized = next.lastResult && next.lastResult !== previousResult
  if (finalized) handleFinalized(next.lastResult)
  return finalized
}

function rate(value) {
  if (session.value.stage !== 'recall') return
  notice.value = ''
  commit(rateRecall(session.value, value))
  typed.value = ''
  focusInput()
}

function submit() {
  if (session.value.stage !== 'spelling') return
  const finalized = commit(submitSpelling(session.value, typed.value))
  typed.value = ''
  if (!finalized) focusInput()
}

function skipCurrent() {
  commit(skip(session.value))
  typed.value = ''
}

function handleFinalized(result) {
  notice.value = `已记录：${GRADE_LABELS[result.grade] ?? '错误'}`
  if (!result.needsReview) return
  if (!pendingSaves.value.some((pending) => pending.id === result.id)) {
    pendingSaves.value = pendingSaves.value.concat(result)
  }
  void drainSaves()
}

async function drainSaves() {
  for (const result of pendingSaves.value.slice()) {
    if (saving.has(result.id)) continue
    saving.add(result.id)
    try {
      const { item } = await reviewVocab(result.id, GRADE[result.grade])
      if (!closed) {
        pendingSaves.value = pendingSaves.value.filter((pending) => pending.id !== result.id)
        if (pendingSaves.value.length === 0) saveError.value = ''
        if (item) {
          saved.value += 1
          emit('updated', item)
        }
      }
    } catch (err) {
      if (!closed) {
        console.error('保存复习记录失败:', err)
        saveError.value = '复习记录保存失败，请稍后重试'
      }
    } finally {
      saving.delete(result.id)
    }
  }
}

function retrySave() {
  saveError.value = ''
  void drainSaves()
}

function close() {
  closed = true
  emit('close')
}

function finish() {
  emit('finished')
  close()
}

onBeforeUnmount(() => {
  closed = true
})
</script>

<style scoped>
.vocab-session.card {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-5);
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: var(--anth-space-6);
}
.vocab-session__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-3);
  padding-bottom: var(--anth-space-3);
  border-bottom: 1px solid var(--anth-rule);
}
.vocab-session__heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--anth-space-2) var(--anth-space-3);
  min-width: 0;
}
.vocab-session__heading h2,
.vocab-session__definition,
.vocab-session__complete h3 {
  margin: 0;
  font-size: var(--anth-text-h2-size);
  line-height: var(--anth-text-h2-line);
}
.vocab-session__word,
.vocab-session__prompt {
  display: grid;
  gap: var(--anth-space-2);
  text-align: center;
}
.vocab-session__word { padding: var(--anth-space-6) 0; }
.vocab-session__prompt { padding: var(--anth-space-5) 0; }
.vocab-session__term {
  margin: 0;
  font-family: var(--anth-font-serif);
  font-size: clamp(32px, 5vw, 56px);
  font-weight: var(--anth-weight-semibold);
  line-height: 1.15;
  letter-spacing: var(--anth-tracking-tight);
  overflow-wrap: anywhere;
}
.vocab-session__meta,
.vocab-session__example {
  margin: 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-body-size);
  line-height: var(--anth-text-body-line);
  overflow-wrap: anywhere;
}
.vocab-session__meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--anth-space-2);
}
.vocab-session__example { font-style: italic; }
.vocab-session__definition {
  font-family: var(--anth-font-serif);
  overflow-wrap: anywhere;
}
.vocab-session__ratings {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--anth-space-2);
}
.vocab-session__ratings .btn { width: 100%; }
.vocab-session__form {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--anth-space-2);
}
.vocab-session__form .vocab-session__input {
  flex: 1 1 220px;
  height: 52px;
  padding: 0 var(--anth-space-4);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-h2-size);
}
.vocab-session__save-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--anth-space-3);
}
.vocab-session__footer {
  display: flex;
  justify-content: center;
}
.vocab-session__complete {
  display: grid;
  justify-items: center;
  gap: var(--anth-space-3);
  padding: var(--anth-space-6) 0;
  text-align: center;
}
.vocab-session__complete-count {
  margin: 0;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}
.vocab-session__stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--anth-space-2);
}
@media (max-width: 520px) {
  .vocab-session.card { padding: var(--anth-space-5) var(--anth-space-4); }
  .vocab-session__word { padding: var(--anth-space-5) 0; }
  .vocab-session__ratings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
