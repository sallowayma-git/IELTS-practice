<template>
  <div class="topic-item" v-bind="$attrs">
    <p class="topic-item__category" data-test="topic-category">话题分类：{{ categoryLabel }}</p>
    <p class="topic-item__content" data-test="topic-content">{{ topic.content }}</p>
    <div class="topic-item__meta">
      <el-tag type="info" data-test="topic-min-words">最低字数 {{ topic.min_words || 250 }}</el-tag>
      <el-tag type="warning" data-test="topic-time-limit">建议时间 {{ topic.time_limit || 40 }} 分钟</el-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  topic: {
    type: Object,
    required: true
  }
})

const categoryLabel = computed(() => {
  const categoryMap = {
    education: '教育',
    technology: '科技',
    society: '社会',
    environment: '环境',
    health: '健康',
    government: '政府',
    bar_chart: '柱状图',
    line_chart: '折线图',
    pie_chart: '饼图',
    table: '数据表格',
    process: '流程图',
    map: '地图'
  }
  return categoryMap[props.topic.category] || '综合'
})
</script>

<style scoped>
.topic-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  color: #303133;
}

.topic-item__content {
  white-space: pre-wrap;
  line-height: 1.7;
}

.topic-item__meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
