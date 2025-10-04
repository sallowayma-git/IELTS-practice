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

const router = useRouter()
const route = useRoute()

const loading = ref(true)
const assessmentResult = ref(null)

const scorePercentage = computed(() => {
  if (!assessmentResult.value) return 0
  return (assessmentResult.value.overallScore / 9) * 100
})

const scoreColor = computed(() => {
  if (!assessmentResult.value) return '#409EFF'
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

const loadAssessmentResult = async () => {
  loading.value = true

  try {
    const assessmentId = route.params.id

    // TODO: 从后端加载评测结果
    // 模拟数据
    await new Promise(resolve => setTimeout(resolve, 2000))

    assessmentResult.value = {
      id: assessmentId,
      overallScore: 6.5,
      level: '合格水平',
      description: '文章结构清晰，论点基本明确，但在语法准确性和词汇使用方面还有提升空间。',
      criteria: [
        {
          name: '任务回应',
          score: 7.0,
          feedback: '很好地回应了题目要求，观点明确'
        },
        {
          name: '连贯与衔接',
          score: 6.5,
          feedback: '文章结构基本合理，衔接词使用得当'
        },
        {
          name: '词汇资源',
          score: 6.0,
          feedback: '词汇量适中，但可以更丰富多样'
        },
        {
          name: '语法准确性',
          score: 6.5,
          feedback: '语法基本正确，存在少量错误'
        }
      ],
      detailedFeedback: [
        {
          title: '优点',
          items: [
            '文章结构清晰，段落划分合理',
            '论点明确，有适当的论证',
            '使用了多种句式结构',
            '词汇使用较为准确'
          ]
        },
        {
          title: '需要改进',
          items: [
            '部分句子存在语法错误',
            '词汇使用可以更加丰富',
            '部分论证不够深入',
            '可以增加更多的例证'
          ]
        }
      ],
      originalContent: '<p>这里显示用户的原文内容...</p>',
      suggestions: [
        {
          title: '语法改进',
          content: '建议重点复习时态和主谓一致',
          type: 'warning',
          icon: 'Warning',
          action: '查看语法练习'
        },
        {
          title: '词汇提升',
          content: '多使用学术词汇和同义词替换',
          type: 'primary',
          icon: 'Star',
          action: '查看词汇推荐'
        }
      ]
    }
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