<template>
  <section class="listening-exam__pane listening-transcript" aria-label="精听听写">
    <div class="listening-exam__pane-body dictation">
      <div v-if="mode === 'cloze'" class="dictation-controls">
        <label>挖空类别
          <select v-model="category" class="select">
            <option v-for="item in categories" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
      </div>
      <p v-if="!available.length" role="status">当前章节没有可用于听写的录音。</p>
      <template v-else-if="sentence">
        <div class="dictation-controls">
          <button class="btn btn-secondary" type="button" :disabled="audioBusy || index === 0" @click="index--">上一句</button>
          <label>句子
            <select v-model.number="index" class="select" :disabled="audioBusy">
              <option v-for="(item, position) in available" :key="item.id" :value="position">
                {{ item.index + 1 }} / {{ sentences.length }}
              </option>
            </select>
          </label>
          <button class="btn btn-secondary" type="button" :disabled="audioBusy || index + 1 === available.length" @click="index++">下一句</button>
          <button class="btn btn-secondary" type="button" :disabled="audioBusy" @click="$emit('play', sentence.audio.mediaId)">播放本句</button>
        </div>
        <p v-if="preparing" role="status">正在生成挖空题…</p>
        <form v-else class="dictation" @submit.prevent="check">
          <p v-if="mode === 'cloze' && !segments.length && !prepareError" role="status">本句暂无所选类别的挖空，可练习整句。</p>
          <p v-if="prepareError" role="alert">{{ prepareError }}</p>
          <div v-if="segments.length" class="dictation-blanks">
            <template v-for="segment in segments" :key="segment.key">
              <input v-if="segment.blank" class="input dictation-blank" :value="draft.blanks[segment.id] || ''"
                autocomplete="off" spellcheck="false" maxlength="120" :disabled="checking || saving"
                :aria-label="'填空 ' + segment.number" @input="editBlank(segment.id, $event.target.value)">
              <span v-else>{{ segment.text }}</span>
            </template>
          </div>
          <label v-else>听写内容
            <textarea v-model="draft.answer" class="input" rows="3" maxlength="4096" :disabled="checking || saving"
              spellcheck="false" @input="draft.score = null" />
          </label>
          <div class="dictation-controls">
            <button class="btn btn-primary" type="submit" :disabled="checking || saving || !hasInput">{{ checking ? '正在核对…' : '核对答案' }}</button>
            <button v-if="saved && draft.score !== null && hasInput && !matchesSaved" class="btn btn-secondary" type="button"
              :disabled="saving" @click="save">{{ saving ? '正在保存…' : '保存到爱听写' }}</button>
            <span v-if="savedState" role="status">{{ matchesSaved ? '当前作答已保存至爱听写' : '本句有原站听写记录' }}</span>
          </div>
          <p v-if="checkError" role="alert">{{ checkError }}</p>
          <div v-if="draft.score !== null" class="dictation-result" role="status">
            <strong>匹配度 {{ Math.round(draft.score * 100) }}%</strong>
            <p>{{ sentence.text }}</p>
            <p v-if="sentence.translation" class="listening-transcript__translation">{{ sentence.translation }}</p>
          </div>
        </form>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { idictation } from '@/api/idictation.js'

const props = defineProps({
  mode: { type: String, required: true },
  sessionId: { type: String, required: true },
  sentences: { type: Array, required: true },
  audioBusy: Boolean,
  saved: { type: Object, default: null },
})
const emit = defineEmits(['play', 'change-sentence', 'saved'])
const categories = [
  { id: 'answer_expression', label: '答案表达' },
  { id: 'logic_signal', label: '转折、否定、纠正' },
  { id: 'question_paraphrase', label: '题干对应表达' },
  { id: 'key_constraint', label: '关键限定信息' },
]
const available = computed(() => props.sentences.filter(item => item.audio))
const firstIncomplete = () => available.value.findIndex(item => !props.saved?.states[item.id])
const resumeIndex = props.saved?.resumeId ? available.value.findIndex(item => item.id === props.saved.resumeId) : -1
const index = ref(resumeIndex >= 0 ? resumeIndex : Math.max(0, firstIncomplete())), category = ref(categories[0].id)
const sentence = computed(() => available.value[index.value])
const preparing = ref(false), checking = ref(false)
const saving = ref(false)
const prepareError = ref(''), checkError = ref('')
const emptyDraft = () => ({ segments: [], prepared: false, answer: '', blanks: {}, score: null })
const drafts = new Map()
const draft = ref(emptyDraft())
const segments = computed(() => draft.value.segments)
const currentAnswer = computed(() => segments.value.length
  ? segments.value.map(segment => segment.blank ? (draft.value.blanks[segment.id] || '').trim() : segment.text).join('')
  : draft.value.answer)
const savedState = computed(() => props.saved?.states[sentence.value?.id])
const matchesSaved = computed(() => Boolean(savedState.value?.answer) && currentAnswer.value === savedState.value.answer)
const hasInput = computed(() => segments.value.length
  ? segments.value.some(segment => segment.blank && draft.value.blanks[segment.id]?.trim())
  : Boolean(draft.value.answer.trim()))
let generation = 0
let alive = true
const describe = error => error?.message || String(error)

async function selectDraft() {
  const current = ++generation
  preparing.value = false
  checking.value = false
  saving.value = false
  prepareError.value = ''
  checkError.value = ''
  if (!sentence.value) return
  const key = JSON.stringify([sentence.value.id, props.mode, props.mode === 'cloze' ? category.value : null])
  if (!drafts.has(key)) {
    const initial = emptyDraft()
    if (props.mode === 'sentence' && savedState.value) {
      initial.answer = savedState.value.answer
      initial.score = savedState.value.accuracy ?? null
    }
    drafts.set(key, reactive(initial))
  }
  const entry = drafts.get(key)
  draft.value = entry
  if (props.mode !== 'cloze' || entry.prepared) return
  preparing.value = true
  try {
    const result = await idictation.articleDictation(props.sessionId, sentence.value.id,
      { kind: 'prepare', categories: [category.value] })
    if (current !== generation) return
    let number = 0
    entry.segments = result.map((segment, key) => ({
      ...segment, key, number: segment.blank ? ++number : undefined,
    }))
    entry.prepared = true
  } catch (error) {
    if (current === generation) prepareError.value = describe(error)
  } finally {
    if (current === generation) preparing.value = false
  }
}

function editBlank(id, value) {
  draft.value.blanks[id] = value
  draft.value.score = null
}

async function check() {
  if (!sentence.value || checking.value || saving.value || !hasInput.value) return
  const current = generation
  const entry = draft.value
  const answer = currentAnswer.value
  checking.value = true
  checkError.value = ''
  try {
    const result = await idictation.articleDictation(props.sessionId, sentence.value.id, { kind: 'check', answer })
    if (current === generation) entry.score = Number(result)
  } catch (error) {
    if (current === generation) checkError.value = describe(error)
  } finally {
    if (current === generation) checking.value = false
  }
}

async function save() {
  if (!props.saved || !sentence.value || saving.value || checking.value || draft.value.score === null || matchesSaved.value) return
  const current = generation
  const id = sentence.value.id
  saving.value = true
  checkError.value = ''
  try {
    const result = await idictation.articleDictation(props.sessionId, id, { kind: 'save', answer: currentAnswer.value })
    if (current === generation) draft.value.score = result.accuracy
    if (alive) emit('saved', id, result)
  } catch (error) {
    if (current === generation) checkError.value = describe(error)
  } finally {
    if (current === generation) saving.value = false
  }
}

watch([() => sentence.value?.id, () => props.mode, category], selectDraft, { immediate: true })
watch(index, () => emit('change-sentence'))
onBeforeUnmount(() => { alive = false; generation++ })
</script>

<style scoped>
.dictation { display: grid; gap: var(--anth-space-4); align-content: start; }
.dictation label textarea { margin-top: var(--anth-space-2); resize: vertical; }
.dictation-controls { display: flex; align-items: center; flex-wrap: wrap; gap: var(--anth-space-3); }
.dictation-controls select { margin-inline-start: var(--anth-space-2); }
.dictation-blanks { white-space: pre-wrap; line-height: 2.6; }
.dictation-blank { display: inline-block; width: 8rem; margin-inline: .15rem; }
.dictation-result { white-space: pre-wrap; }
.dictation-result p { margin-top: var(--anth-space-2); }
</style>
