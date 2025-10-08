<template>
  <div class="assessment-container">
    <el-container>
      <el-header class="assessment-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>AI评测结果</h2>
        </div>
        <div class="header-right">
          <el-button @click="exportResult" :icon="Download">导出报告</el-button>
        </div>
      </el-header>

      <el-main class="assessment-main" v-loading="loading">
        <div v-if="assessmentResult" class="result-content">
          <!-- 总体评分 -->
          <el-card class="score-card">
            <div class="overall-score">
              <div class="score-circle">
                <el-progress type="circle" :percentage="scorePercentage" :color="scoreColor" :width="120">
                  <template #default="{ percentage }">
                    <span class="score-number">{{ assessmentResult.overallScore }}</span>
                  </template>
                </el-progress>
              </div>
              <div class="score-details">
                <h3>总分: {{ assessmentResult.overallScore }}/9.0</h3>
                <p class="score-level">{{ assessmentResult.level }}</p>
                <p class="score-description">{{ assessmentResult.description }}</p>
              </div>
            </div>
          </el-card>

          <!-- 分项评分 -->
          <el-row :gutter="20" class="criteria-scores">
            <el-col :span="6" v-for="criteria in assessmentResult.criteria" :key="criteria.name">
              <el-card class="criteria-card">
                <div class="criteria-content">
                  <h4>{{ criteria.name }}</h4>
                  <div class="criteria-score">{{ criteria.score }}/9.0</div>
                  <el-progress :percentage="(criteria.score / 9) * 100" :color="getCriteriaColor(criteria.score)" :show-text="false" />
                  <p class="criteria-feedback">{{ criteria.feedback }}</p>
                </div>
              </el-card>
            </el-col>
          </el-row>

          <!-- 详细反馈 -->
          <el-card class="feedback-card">
            <template #header>
              <span>详细反馈</span>
            </template>
            <div class="feedback-content">
              <div class="feedback-section" v-for="section in assessmentResult.detailedFeedback" :key="section.title">
                <h4>{{ section.title }}</h4>
                <ul>
                  <li v-for="item in section.items" :key="item">{{ item }}</li>
                </ul>
              </div>
            </div>
          </el-card>

          <!-- 语法错误标注 (Phase 2) -->
          <el-card class="grammar-annotations-card" v-if="assessmentResult.id">
            <template #header>
              <span>语法错误标注</span>
            </template>
            <GrammarHighlightPanel
              :writing-id="assessmentResult.writingId"
              :assessment-result-id="assessmentResult.id"
              :content="assessmentResult.originalContent"
              @annotation-selected="handleAnnotationSelected"
              @annotation-updated="handleAnnotationUpdated"
            />
          </el-card>

          <!-- 原文展示 -->
          <el-card class="original-content-card">
            <template #header>
              <span>原文内容</span>
            </template>
            <div class="original-content" v-html="assessmentResult.originalContent"></div>
          </el-card>

          <!-- 改进建议 -->
          <el-card class="suggestions-card">
            <template #header>
              <span>改进建议</span>
            </template>
            <div class="suggestions-content">
              <el-timeline>
                <el-timeline-item
                  v-for="(suggestion, index) in assessmentResult.suggestions"
                  :key="index"
                  :type="suggestion.type"
                  :icon="suggestion.icon"
                >
                  <h4>{{ suggestion.title }}</h4>
                  <p>{{ suggestion.content }}</p>
                  <el-button v-if="suggestion.action" type="text" @click="handleSuggestion(suggestion)">
                    {{ suggestion.action }}
                  </el-button>
                </el-timeline-item>
              </el-timeline>
            </div>
          </el-card>
        </div>

        <div v-else-if="!loading" class="no-result">
          <el-empty description="暂无评测结果">
            <el-button type="primary" @click="goToWriting">开始新的写作</el-button>
          </el-empty>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ArrowLeft, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import GrammarHighlightPanel from '@/components/GrammarHighlightPanel.vue'
import { useAssessmentStore } from '@/stores/assessment'

const router = useRouter()
const route = useRoute()
const assessmentStore = useAssessmentStore()

const loading = ref(true)
const assessmentResult = computed(() => assessmentStore.currentAssessment)

const scorePercentage = computed(() => {
  if (!assessmentResult.value?.overallScore) return 0
  return (assessmentResult.value.overallScore / 9) * 100
})

const scoreColor = computed(() => {
  if (!assessmentResult.value?.overallScore) return '#409EFF'
  const score = assessmentResult.value.overallScore
  if (score >= 7) return '#67C23A'
  if (score >= 6) return '#E6A23C'
  return '#F56C6C'
})

const goBack = () => {
  router.push('/writing')
}

const goToWriting = () => {
  router.push('/writing')
}

const getCriteriaColor = (score) => {
  if (score >= 7) return '#67C23A'
  if (score >= 6) return '#E6A23C'
  return '#F56C6C'
}

const exportResult = () => {
  // TODO: 实现导出功能
  ElMessage.info('导出功能开发中...')
}

const handleSuggestion = (suggestion) => {
  // TODO: 处理建议操作
  ElMessage.info(`${suggestion.action}功能开发中...`)
}

// 语法标注处理函数 (Phase 2)
const handleAnnotationSelected = (annotation) => {
  // 高亮原文中的对应部分
  ElMessage.info(`定位到语法问题: ${annotation.message}`)
  // TODO: 实现原文高亮功能
}

const handleAnnotationUpdated = (annotation) => {
  ElMessage.success(`语法建议已${annotation.user_action === 'accepted' ? '采纳' : '忽略'}`)
}

const loadAssessmentResult = async () => {
  loading.value = true

  try {
    const assessmentId = route.params.id
    if (!assessmentId) {
      throw new Error('缺少评估ID')
    }

    await assessmentStore.getAssessmentById(assessmentId, { includeContent: true })
  } catch (error) {
    ElMessage.error('加载评测结果失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAssessmentResult()
})
</script>

<style scoped>
.assessment-container {
  height: 100vh;
  background: #f5f7fa;
}

.assessment-header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-left h2 {
  margin: 0;
  color: #2c3e50;
}

.assessment-main {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.result-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.score-card {
  background: white;
}

.overall-score {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.score-number {
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
}

.score-details h3 {
  margin: 0 0 0.5rem 0;
  color: #2c3e50;
}

.score-level {
  color: #409EFF;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.score-description {
  color: #606266;
  margin: 0;
}

.criteria-scores {
  margin: 1.5rem 0;
}

.criteria-card {
  text-align: center;
}

.criteria-content h4 {
  color: #2c3e50;
  margin-bottom: 0.5rem;
}

.criteria-score {
  font-size: 1.2rem;
  font-weight: bold;
  color: #409EFF;
  margin-bottom: 0.5rem;
}

.criteria-feedback {
  font-size: 0.9rem;
  color: #909399;
  margin-top: 0.5rem;
}

.feedback-section {
  margin-bottom: 1.5rem;
}

.feedback-section h4 {
  color: #2c3e50;
  margin-bottom: 0.5rem;
}

.feedback-section ul {
  padding-left: 1.5rem;
}

.feedback-section li {
  color: #606266;
  line-height: 1.6;
  margin-bottom: 0.25rem;
}

.original-content {
  line-height: 1.8;
  color: #2c3e50;
  background: #fafafa;
  padding: 1rem;
  border-radius: 4px;
}

.suggestions-content h4 {
  color: #2c3e50;
  margin-bottom: 0.5rem;
}

.suggestions-content p {
  color: #606266;
  margin-bottom: 0.5rem;
}

.no-result {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50vh;
}
</style>