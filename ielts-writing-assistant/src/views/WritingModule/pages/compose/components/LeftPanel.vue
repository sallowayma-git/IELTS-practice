<template>
  <section class="left-panel" data-test="writing-left-panel">
    <TopicSelector
      :topic="topic"
      :task-type="taskType"
      :loading="topicLoading"
      @change-topic="$emit('change-topic')"
    />

    <el-card class="left-panel__editor-card" shadow="never">
      <template #header>
        <div class="left-panel__editor-header">
          <h3>作文编辑器</h3>
          <WordCounter
            :word-count="wordCount"
            :formatted-time="formattedTime"
            :min-words="topic?.min_words"
            data-test="word-counter"
          />
        </div>
      </template>
      <EssayEditor :model-value="content" :task-type="taskType" @update:model-value="$emit('update:content', $event)" />
    </el-card>

    <div class="left-panel__actions">
      <SubmitButton
        :disabled="!wordCountValid"
        :loading="isSubmitting"
        @click="$emit('submit')"
        data-test="submit-essay-button"
      >
        提交评分
      </SubmitButton>
    </div>
  </section>
</template>

<script setup>
import TopicSelector from './TopicSelector.vue'
import EssayEditor from './EssayEditor.vue'
import WordCounter from './WordCounter.vue'
import SubmitButton from './SubmitButton.vue'

defineProps({
  topic: {
    type: Object,
    default: () => null
  },
  taskType: {
    type: String,
    required: true
  },
  wordCount: {
    type: Number,
    default: 0
  },
  formattedTime: {
    type: String,
    default: '00:00'
  },
  content: {
    type: String,
    default: ''
  },
  topicLoading: {
    type: [Boolean, Object],
    default: false
  },
  isSubmitting: {
    type: Boolean,
    default: false
  },
  wordCountValid: {
    type: Boolean,
    default: false
  }
})

defineEmits(['update:content', 'change-topic', 'submit'])
</script>

<style scoped>
.left-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.left-panel__editor-card {
  background: #ffffff;
  border-radius: 16px;
}

.left-panel__editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.left-panel__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
