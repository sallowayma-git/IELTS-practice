<template>
  <div class="topic-display" v-bind="$attrs">
    <div v-if="loading" class="topic-display__loading" data-test="topic-loading">
      <el-skeleton animated :rows="4" />
    </div>
    <template v-else-if="topic">
      <TopicTitle :title="resolvedTitle" data-test="topic-display-title" />
      <p class="topic-display__description" data-test="topic-display-content">{{ topic.content }}</p>
      <TopicImage v-if="topic.image_path" :src="topic.image_path" data-test="topic-display-image" />
    </template>
    <el-empty v-else description="请选择题目" data-test="topic-display-empty" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import TopicTitle from './TopicTitle.vue'
import TopicImage from './TopicImage.vue'

const props = defineProps({
  topic: {
    type: Object,
    default: () => null
  },
  loading: {
    type: [Boolean, Object],
    default: false
  }
})

const extractText = (node) => {
  if (!node) return ''
  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }
  if (typeof node === 'object' && node !== null) {
    if (node.type === 'text') {
      return node.text || ''
    }
    if (node.content) {
      return extractText(node.content)
    }
  }
  return ''
}

const resolvedTitle = computed(() => {
  if (!props.topic) return ''
  if (props.topic.title) return props.topic.title
  if (props.topic.title_json) {
    try {
      const json = JSON.parse(props.topic.title_json)
      const text = extractText(json.content)
      return text || '未命名题目'
    } catch (error) {
      console.warn('无法解析题目标题', error)
    }
  }
  return '未命名题目'
})
</script>

<style scoped>
.topic-display {
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 14px;
  color: #303133;
}

.topic-display__description {
  line-height: 1.7;
}

.topic-display__loading {
  padding: 8px 0;
}
</style>
