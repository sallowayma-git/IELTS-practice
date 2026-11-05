<template>
  <!-- Notes drawer (highlight notes, click to locate) and the free-text note
       editor, mirroring #reading-note-drawer / #reading-note-editor. -->
  <aside id="reading-note-drawer" :class="{ open: drawerOpen }" :aria-hidden="drawerOpen ? 'false' : 'true'">
    <div class="reading-note-drawer-head">
      <div class="reading-note-drawer-title">
        <h3>Notes</h3>
        <button class="reading-note-outline-add" type="button" title="New note" :tabindex="drawerTabindex" @click="$emit('open-editor')">+</button>
      </div>
      <button class="reading-note-close" type="button" aria-label="关闭笔记列表" :tabindex="drawerTabindex" @click="$emit('close-drawer')">×</button>
    </div>
    <div class="reading-note-list">
      <div v-if="!entries.length" class="reading-note-empty">No notes yet.</div>
      <div v-for="(note, index) in entries" :key="note.id || note.text + index" class="reading-note-row">
        <button class="reading-note-open" type="button" :title="note.text" :tabindex="drawerTabindex" @click="$emit('locate', note)">{{ note.text }}</button>
      </div>
    </div>
  </aside>

  <section
    id="reading-note-editor"
    role="dialog"
    aria-modal="true"
    aria-labelledby="reading-note-editor-title"
    :aria-hidden="editorOpen ? 'false' : 'true'"
    :style="editorOpen ? editorStyle : { display: 'none' }"
  >
    <div class="reading-note-editor-head">
      <h3 id="reading-note-editor-title">Note</h3>
      <button class="reading-note-close" type="button" aria-label="关闭笔记" @click="$emit('close-editor')">×</button>
    </div>
    <div class="reading-note-editor-body">
      <textarea
        ref="textarea"
        class="reading-note-body"
        placeholder="Write your note"
        aria-label="Note body"
        :value="text"
        @input="$emit('update:text', $event.target.value)"
      ></textarea>
      <p v-if="error" class="settings-hint" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  drawerOpen: { type: Boolean, default: false },
  editorOpen: { type: Boolean, default: false },
  entries: { type: Array, default: () => [] },
  text: { type: String, default: '' },
  error: { type: String, default: '' }
})

defineEmits(['open-editor', 'close-editor', 'close-drawer', 'locate', 'update:text'])

// The opensource editor is a fixed, draggable dialog; centred here.
const editorStyle = { display: 'flex', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
const textarea = ref(null)
// A closed drawer is only slid off-screen (its computed style is part of the exam
// freeze, so it is not display:none / inert): keep its buttons out of Tab order.
const drawerTabindex = computed(() => (props.drawerOpen ? undefined : -1))

watch(() => props.editorOpen, async (open) => {
  if (!open) return
  await nextTick()
  textarea.value?.focus()
})
</script>
