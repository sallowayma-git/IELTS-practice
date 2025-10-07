<template>
  <div class="essay-editor" v-bind="$attrs">
    <EditorToolbar v-if="editor" :editor="editor" />
    <div class="essay-editor__content">
      <EditorContent :editor="editor" />
    </div>
  </div>
</template>

<script setup>
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import EditorToolbar from './EditorToolbar.vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  taskType: {
    type: String,
    default: 'task2'
  }
})

const emit = defineEmits(['update:modelValue'])

const editor = ref(null)

onMounted(() => {
  editor.value = new Editor({
    content: props.modelValue,
    extensions: [StarterKit, Underline, Highlight],
    editorProps: {
      attributes: {
        class: 'essay-editor__input',
        spellcheck: 'false',
        'data-test': 'essay-editor-input'
      }
    },
    onUpdate({ editor }) {
      emit('update:modelValue', editor.getHTML())
    }
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value) return
    if (value !== editor.value.getHTML()) {
      editor.value.commands.setContent(value || '', false)
    }
  }
)

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<style scoped>
.essay-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.essay-editor__content {
  border: 1px solid #dcdfe6;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  min-height: 320px;
}

:deep(.essay-editor__input) {
  min-height: 320px;
  padding: 20px;
  font-size: 16px;
  line-height: 1.7;
  outline: none;
}

:deep(.essay-editor__input p) {
  margin: 0;
}
</style>
