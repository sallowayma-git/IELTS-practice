<template>
  <div class="word-counter" v-bind="$attrs">
    <span data-test="word-count">字数：<strong data-test="word-count-value">{{ wordCount }}</strong></span>
    <el-divider direction="vertical" />
    <span data-test="elapsed-time">用时：<strong data-test="elapsed-time-value">{{ formattedTime }}</strong></span>
    <el-divider v-if="minWords" direction="vertical" />
    <span v-if="minWords" data-test="min-word-requirement">最低要求：{{ minWords }} 字</span>
  </div>
</template>

<script setup>
defineProps({
  wordCount: {
    type: Number,
    default: 0
  },
  formattedTime: {
    type: String,
    default: '00:00'
  },
  minWords: {
    type: Number,
    default: null
  }
})
</script>

<style scoped>
.word-counter {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #606266;
  font-size: 14px;
}

.word-counter strong {
  color: #303133;
}

:deep(.el-divider) {
  margin: 0;
}
</style>
