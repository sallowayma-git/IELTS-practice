<template>
  <button class="btn btn-secondary" type="button" @click="open">爱听写选题</button>
  <dialog ref="dialog" class="writing-topic-picker" aria-labelledby="idictation-writing-title">
    <header>
      <h2 id="idictation-writing-title">爱听写写作</h2>
      <button class="btn btn-ghost" type="button" aria-label="关闭爱听写选题" @click="dialog.close()">×</button>
    </header>
    <p class="section-meta">选中的题目会加入本地题库，并在 Atlas 中打开写作。</p>
    <label>题源
      <select v-model="bank" class="input" :disabled="Boolean(busy)" @change="changeBank">
        <option value="academic">剑雅 A 类</option>
        <option value="jijing">机经</option>
        <option value="general">剑雅 G 类 · Task 2</option>
      </select>
    </label>
    <label v-if="bank === 'jijing'">任务
      <select v-model="task" class="input" :disabled="Boolean(busy)" @change="loadCatalog">
        <option value="task1">Task 1</option><option value="task2">Task 2</option>
      </select>
    </label>
    <label v-if="cards.length">
      {{ bank === 'academic' ? '套卷' : '题目' }}
      <select v-model="testId" class="input" :aria-label="bank === 'academic' ? '套卷' : '题目'" :disabled="Boolean(busy)" @change="error = ''">
        <option value="">请选择{{ bank === 'academic' ? '套卷' : '题目' }}</option>
        <option v-for="card in cards" :key="card.testId" :value="card.testId">{{ card.title }}</option>
      </select>
    </label>
    <div v-if="selected" class="writing-topic-picker__actions">
      <button v-if="bank === 'academic' || task === 'task1'" class="btn btn-secondary" type="button" :disabled="busy || !selected.hasTask1" @click="choose('task1')">写 Task 1</button>
      <button v-if="bank === 'academic' || task === 'task2'" class="btn btn-primary" type="button" :disabled="busy || !selected.hasTask2" @click="choose('task2')">写 Task 2</button>
    </div>
    <p v-if="busy" role="status">{{ busy }}</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!cards.length" role="status">当前来源没有可用的写作题目。</p>
    <button v-if="error && !cards.length && !busy" class="btn btn-secondary" type="button" @click="loadCatalog">重新加载目录</button>
  </dialog>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

const emit = defineEmits(['choose'])
const dialog = ref(null)
const cards = ref([])
const testId = ref('')
const bank = ref('academic'), task = ref('task2')
const error = ref('')
const busy = ref('')
const selected = computed(() => cards.value.find(card => card.testId === testId.value))
let alive = true

async function run(message, load, apply) {
  if (busy.value) return
  busy.value = message
  error.value = ''
  try {
    const result = await load()
    if (alive && dialog.value?.open) apply(result)
  } catch (failure) {
    if (alive && dialog.value?.open) error.value = failure?.message || String(failure)
  } finally {
    if (alive) busy.value = ''
  }
}

function loadCatalog() {
  cards.value = []
  testId.value = ''
  return run('正在加载写作目录…', () => idictation.writingCatalog(bank.value, task.value), rows => { cards.value = rows })
}

function changeBank() {
  if (bank.value === 'general') task.value = 'task2'
  return loadCatalog()
}

function open() {
  if (busy.value) return
  dialog.value.showModal()
  return loadCatalog()
}

function choose(taskType) {
  const suite = selected.value
  if (!suite) return
  return run('正在加入本地题库…', () => idictation.importWriting(suite.testId, taskType, bank.value), topicId => {
    dialog.value.close()
    emit('choose', { topicId, taskType })
  })
}

onBeforeUnmount(() => { alive = false })
</script>

<style scoped>
.writing-topic-picker {
  width: min(34rem, 90vw);
  margin: auto;
  padding: 1.25rem;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface);
  color: var(--anth-ink);
}
.writing-topic-picker::backdrop { background: var(--anth-scrim); }
.writing-topic-picker header,
.writing-topic-picker__actions { display: flex; align-items: center; gap: .75rem; }
.writing-topic-picker header { justify-content: space-between; }
.writing-topic-picker label { display: grid; gap: .4rem; margin-block: 1rem; }
</style>
