<template>
  <div class="compose-page">
    <el-row :gutter="24" class="compose-grid">
      <el-col :lg="15" :md="24">
        <LeftPanel
          :topic="writingStore.currentTopic"
          :task-type="writingStore.taskType"
          :word-count="writingStore.wordCount"
          :formatted-time="writingStore.formattedTime"
          :content="writingStore.writingContent"
          :topic-loading="topicLoading"
          :is-submitting="writingStore.isSubmitting"
          :word-count-valid="writingStore.wordCountValid"
          @update:content="handleContentUpdate"
          @change-topic="handleChangeTopic"
          @submit="handleSubmit"
        />
      </el-col>
      <el-col :lg="9" :md="24">
        <RightPanel
          :topic="writingStore.currentTopic"
          :task-type="writingStore.taskType"
          :topic-loading="topicLoading"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import LeftPanel from './compose/components/LeftPanel.vue'
import RightPanel from './compose/components/RightPanel.vue'
import { useWritingStore } from '@/stores/writing'

const writingStore = useWritingStore()
const router = useRouter()
const topicLoading = inject('writingTopicLoading', ref(false))
const reloadTopic = inject('writingReloadTopic')

const handleContentUpdate = (value) => {
  writingStore.updateContent(value)
  if (!writingStore.isTimerRunning) {
    writingStore.startTimer()
  }
}

const handleChangeTopic = async () => {
  if (reloadTopic) {
    await reloadTopic()
  }
}

const handleSubmit = () => {
  if (!writingStore.currentTopic) {
    ElMessage.warning('请先选择题目')
    return
  }
  if (!writingStore.wordCountValid) {
    const minWords = writingStore.currentTopic?.min_words || 250
    ElMessage.warning(`字数不足，至少需要 ${minWords} 字`)
    return
  }
  writingStore.stopTimer()
  router.push({ name: 'WritingEvaluating' })
}

onMounted(() => {
  if (!writingStore.isTimerRunning) {
    writingStore.startTimer()
  }
})

onBeforeUnmount(() => {
  if (writingStore.isTimerRunning) {
    writingStore.stopTimer()
  }
})
</script>

<style scoped>
.compose-page {
  height: 100%;
  overflow: auto;
}

.compose-grid {
  height: 100%;
}

:deep(.el-col) {
  margin-bottom: 24px;
}
</style>
