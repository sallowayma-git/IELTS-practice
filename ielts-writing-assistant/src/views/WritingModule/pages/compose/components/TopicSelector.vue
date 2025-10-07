<template>
  <el-card class="topic-selector" shadow="never" data-test="topic-selector">
    <template #header>
      <div class="topic-selector__header">
        <div class="topic-selector__title">
          <el-tag
            v-if="topicTypeLabel"
            :type="taskType === 'task1' ? 'info' : 'success'"
            size="small"
            data-test="topic-type-tag"
          >
            {{ topicTypeLabel }}
          </el-tag>
          <span class="topic-selector__headline" data-test="topic-headline">{{ topic?.title || '正在加载题目…' }}</span>
        </div>
        <el-button
          type="text"
          @click="$emit('change-topic')"
          :loading="Boolean(loading)"
          data-test="change-topic-button"
        >
          换一题
        </el-button>
      </div>
    </template>

    <TopicFilter v-model="filters" :task-type="taskType" data-test="topic-filter" />

    <div v-if="loading" class="topic-selector__loading">
      <el-skeleton animated :rows="3" />
    </div>
    <TopicItem v-else-if="topic" :topic="topic" data-test="topic-item" />
    <el-empty v-else description="暂无题目" />
  </el-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import TopicFilter from './TopicFilter.vue'
import TopicItem from './TopicItem.vue'

const props = defineProps({
  topic: {
    type: Object,
    default: () => null
  },
  taskType: {
    type: String,
    required: true
  },
  loading: {
    type: [Boolean, Object],
    default: false
  }
})

defineEmits(['change-topic'])

const filters = ref({
  category: 'all',
  difficulty: [1, 5]
})

const topicTypeLabel = computed(() => {
  if (props.taskType === 'task1') {
    return 'Task 1 - 图表描述'
  }
  if (props.taskType === 'task2') {
    return 'Task 2 - 议论文'
  }
  return ''
})

watch(filters, (value) => {
  // 预留筛选事件，后续可与题库 API 对接
  console.debug('topic filter changed', value)
})
</script>

<style scoped>
.topic-selector {
  border-radius: 16px;
}

.topic-selector__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.topic-selector__title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.topic-selector__headline {
  font-weight: 600;
  color: #303133;
}

.topic-selector__loading {
  padding: 12px 0;
}
</style>
