<template>
  <div class="result-page" v-if="assessment" data-test="result-page">
    <el-page-header @back="returnToCompose" content="评分结果" data-test="result-back-header" />
    <el-row :gutter="24" class="result-grid">
      <el-col :lg="14" :md="24">
        <el-card class="result-card" shadow="never">
          <template #header>
            <div class="result-card__header">
              <h3>作文原文</h3>
              <el-tag type="info" data-test="result-topic-title">{{ assessment.topicTitle || currentTopicTitle }}</el-tag>
            </div>
          </template>
          <div class="essay-content" v-html="assessment.content || writingStore.writingContent" data-test="result-essay-content"></div>
        </el-card>
      </el-col>
      <el-col :lg="10" :md="24">
        <el-card class="result-card" shadow="never">
          <template #header>
            <div class="result-card__header">
              <h3>评分摘要</h3>
            </div>
          </template>
          <div class="score-summary">
            <div class="score-summary__total">
              <span class="score-summary__label">总分</span>
              <span class="score-summary__value" data-test="overall-score">{{ (assessment.totalScore || 6.5).toFixed(1) }}</span>
            </div>
            <el-divider />
            <ul class="score-summary__list" data-test="subscore-list">
              <li data-test="subscore-task-achievement">
                <span>Task Achievement / Response</span>
                <strong>{{ formatScore(assessment.taskAchievement) }}</strong>
              </li>
              <li data-test="subscore-coherence">
                <span>Coherence & Cohesion</span>
                <strong>{{ formatScore(assessment.coherence) }}</strong>
              </li>
              <li data-test="subscore-lexical">
                <span>Lexical Resource</span>
                <strong>{{ formatScore(assessment.lexicalResource) }}</strong>
              </li>
              <li data-test="subscore-grammar">
                <span>Grammatical Range & Accuracy</span>
                <strong>{{ formatScore(assessment.grammar) }}</strong>
              </li>
            </ul>
          </div>
        </el-card>
        <el-card class="result-card" shadow="never" style="margin-top: 24px;">
          <template #header>
            <div class="result-card__header">
              <h3>整体反馈</h3>
            </div>
          </template>
          <p class="feedback-text" data-test="overall-feedback">{{ assessment.overallFeedback || '暂无整体反馈，请稍后重试。' }}</p>
          <div v-if="structuredSuggestions.length" class="suggestions" data-test="suggestions">
            <h4>改进建议</h4>
            <el-timeline>
              <el-timeline-item
                v-for="(item, index) in structuredSuggestions"
                :key="index"
                :timestamp="item.category || '建议'"
                data-test="suggestion-item"
              >
                {{ item.text }}
              </el-timeline-item>
            </el-timeline>
          </div>
          <div class="result-actions">
            <el-button type="primary" @click="startNewEssay" data-test="action-new-essay">写新作文</el-button>
            <el-button @click="viewHistory" data-test="action-view-history">查看历史记录</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
  <el-empty v-else description="暂无评分数据" data-test="result-empty">
    <el-button type="primary" @click="returnToCompose" data-test="result-return-button">返回写作</el-button>
  </el-empty>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAssessmentStore } from '@/stores/assessment'
import { useWritingStore } from '@/stores/writing'

const router = useRouter()
const route = useRoute()
const assessmentStore = useAssessmentStore()
const writingStore = useWritingStore()

const assessment = computed(() => assessmentStore.currentAssessment)
const currentTopicTitle = computed(() => writingStore.currentTopic?.title || '')

const structuredSuggestions = computed(() => {
  const raw = assessment.value?.suggestions || assessment.value?.improvements
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map(item => (typeof item === 'string' ? { text: item } : item))
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(item => (typeof item === 'string' ? { text: item } : item))
      }
    } catch (error) {
      return raw.split(/\n+/).map(text => ({ text }))
    }
  }
  return []
})

const loadAssessment = async () => {
  if (assessment.value) return
  const assessmentId = route.params.id
  if (assessmentId) {
    try {
      await assessmentStore.getAssessmentById(assessmentId)
    } catch (error) {
      ElMessage.error('无法加载评估结果，返回写作页面')
      router.replace({ name: 'WritingCompose' })
    }
  } else {
    router.replace({ name: 'WritingCompose' })
  }
}

const formatScore = (value) => {
  if (value === undefined || value === null) return '—'
  return Number(value).toFixed(1)
}

const startNewEssay = async () => {
  writingStore.resetWriting()
  await writingStore.getRandomTopic(writingStore.taskType)
  router.replace({ name: 'WritingCompose' })
}

const returnToCompose = () => {
  router.replace({ name: 'WritingCompose' })
}

const viewHistory = () => {
  router.push({ name: 'History' })
}

onMounted(() => {
  loadAssessment()
})
</script>

<style scoped>
.result-page {
  padding-bottom: 32px;
}

.result-grid {
  margin-top: 16px;
}

.result-card {
  border-radius: 16px;
}

.result-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.essay-content {
  line-height: 1.8;
  font-size: 15px;
  color: #303133;
  white-space: pre-wrap;
}

.score-summary__total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 12px;
}

.score-summary__label {
  font-size: 14px;
  color: #606266;
}

.score-summary__value {
  font-size: 36px;
  font-weight: 700;
  color: #409eff;
}

.score-summary__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.score-summary__list li {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: #303133;
}

.feedback-text {
  color: #303133;
  line-height: 1.8;
}

.suggestions {
  margin-top: 16px;
}

.result-actions {
  margin-top: 24px;
  display: flex;
  gap: 12px;
}
</style>
