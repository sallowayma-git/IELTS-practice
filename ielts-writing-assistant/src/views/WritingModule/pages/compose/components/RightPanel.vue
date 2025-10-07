<template>
  <section class="right-panel" data-test="writing-right-panel">
    <el-card class="right-panel__card" shadow="never">
      <template #header>
        <div class="right-panel__header">
          <h3>题目展示</h3>
        </div>
      </template>
      <TopicDisplay :topic="topic" :loading="topicLoading" data-test="topic-display" />
    </el-card>
  </section>
</template>

<script setup>
import TopicDisplay from './TopicDisplay.vue'

defineProps({
  topic: {
    type: Object,
    default: () => null
  },
  taskType: {
    type: String,
    default: 'task2'
  },
  topicLoading: {
    type: [Boolean, Object],
    default: false
  }
})
</script>

<style scoped>
.right-panel {
  height: 100%;
}

.right-panel__card {
  height: 100%;
  border-radius: 16px;
}

.right-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
