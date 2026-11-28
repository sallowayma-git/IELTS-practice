<template>
  <span class="reader-annotations">
    <button type="button" class="btn-text" :disabled="busy" :aria-pressed="highlighted"
      @click="update({ kind: 'highlight', enabled: !highlighted })">
      {{ highlighted ? '取消高亮' : '高亮' }}
    </button>
    <button v-if="!editing" type="button" class="btn-text" :disabled="busy" @click="edit">
      {{ note ? '编辑笔记' : '写笔记' }}
    </button>
    <span v-if="editing" class="reader-note-editor">
      <textarea v-model="text" aria-label="本句笔记" rows="3" maxlength="4096" :disabled="busy" />
      <span>
        <button type="button" class="btn-text" :disabled="busy || !text.trim()" @click="update({ kind: 'note', text })">保存笔记</button>
        <button type="button" class="btn-text" :disabled="busy" @click="editing = false">取消编辑</button>
        <button v-if="note" type="button" class="btn-text" :disabled="busy" @click="update({ kind: 'deleteNote' })">删除笔记</button>
      </span>
    </span>
    <span v-else-if="note" class="reader-note">{{ note.note }}</span>
    <span v-if="error" role="alert">{{ error }}</span>
    <span v-else-if="busy" role="status">正在保存…</span>
  </span>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

const props = defineProps({
  assetId: { type: String, required: true },
  sentenceId: { type: String, required: true },
  annotations: { type: Array, default: () => [] },
})
const emit = defineEmits(['update'])
const note = computed(() => props.annotations.find(row => row.kind === 'note'))
const highlighted = computed(() => props.annotations.some(row => row.kind === 'highlight'))
const text = ref(''), error = ref(''), editing = ref(false), busy = ref(false)
let alive = true

function edit() {
  text.value = note.value?.note || ''
  editing.value = true
  error.value = ''
}

async function update(action) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const rows = await idictation.readerAnnotation(props.assetId, props.sentenceId, action)
    if (alive) {
      emit('update', rows)
      if (action.kind !== 'highlight') editing.value = false
    }
  } catch (failure) {
    if (alive) error.value = failure?.message || String(failure)
  } finally {
    if (alive) busy.value = false
  }
}

onBeforeUnmount(() => { alive = false })
</script>

<style scoped>
.reader-annotations { margin-inline-start: .5rem; }
.reader-note-editor, .reader-note { display: grid; gap: .25rem; white-space: pre-wrap; }
.reader-note { color: var(--muted-ink); overflow-wrap: anywhere; }
.reader-note-editor textarea { color: inherit; background: transparent; padding: .35rem; }
</style>
