<template>
  <div class="assessment-result-container">
    <el-container>
      <!-- 左侧面板 - 作文展示 -->
      <el-main class="left-panel" style="width: 60%; padding: 0;">
        <div class="essay-header">
          <el-radio-group v-model="viewMode" size="large">
            <el-radio-button label="original">原文视图</el-radio-button>
            <el-radio-button label="annotated">标注视图</el-radio-button>
          </el-radio-group>
        </div>

        <!-- 原文视图 -->
        <div v-if="viewMode === 'original'" class="original-content">
          <div class="essay-text">{{ assessment.content }}</div>
        </div>

        <!-- 标注视图 -->
        <div v-if="viewMode === 'annotated'" class="annotated-content">
          <!-- 批量控制栏 -->
          <div class="batch-controls">
            <el-button @click="expandAll" :icon="Plus">全部展开</el-button>
            <el-button @click="collapseAll" :icon="Minus">全部折叠</el-button>
          </div>

          <!-- 句子块列表 -->
          <div class="sentence-blocks">
            <div
              v-for="(sentence, index) in annotatedSentences"
              :key="index"
              class="sentence-block"
              :id="`sentence-${index}`"
            >
              <div class="sentence-index">[^{{ index + 1 }}]</div>
              <div class="sentence-text">
                <span
                  v-for="(word, wordIndex) in sentence.words"
                  :key="wordIndex"
                  :class="getWordClass(word)"
                  :title="word.error ? word.error.shortReason : ''"
                >
                  {{ word.text }}
                </span>
              </div>

              <!-- 错误详情折叠面板 -->
              <div class="error-details">
                <el-collapse v-model="sentence.expanded">
                  <el-collapse-item>
                    <template #title>
                      <span v-if="sentence.errors.length > 0">
                        发现 {{ sentence.errors.length }} 个错误
                      </span>
                      <span v-else>无错误</span>
                    </template>

                    <div class="error-list">
                      <div
                        v-for="(error, errorIndex) in sentence.errors"
                        :key="errorIndex"
                        class="error-item"
                      >
                        <div class="error-header">
                          <el-tag :type="getErrorTagType(error.type)">
                            <el-icon><Warning /></el-icon>
                            {{ error.type }}
                          </el-tag>
                        </div>
                        <div class="error-content">
                          <p><strong>错误原因：</strong>{{ error.reason }}</p>
                          <p><strong>修正建议：</strong>建议修改为：{{ error.correction }}</p>
                          <p><strong>修正后：</strong>{{ error.correctedSentence }}</p>
                        </div>
                      </div>
                    </div>
                  </el-collapse-item>
                </el-collapse>
              </div>
            </div>
          </div>
        </div>
      </el-main>

      <!-- 右侧面板 - 评分详情 -->
      <el-aside class="right-panel" style="width: 40%; background: #f5f7fa; padding: 20px;">
        <!-- 总分显示 -->
        <div class="total-score">
          <div class="score-value">{{ assessment.totalScore }}</div>
          <div class="score-label">总分 Overall Band Score</div>
          <div class="score-time">{{ assessment.createdAt }}</div>
        </div>

        <!-- 雷达图 -->
        <el-card class="radar-card">
          <template #header>
            <span>评分雷达图</span>
          </template>
          <div ref="radarChart" class="radar-chart"></div>
        </el-card>

        <!-- 分项评分 -->
        <div class="scoring-details">
          <div class="scoring-item">
            <div class="scoring-header">
              <span class="scoring-name">Task Achievement/Response</span>
              <span class="scoring-score">{{ assessment.taskAchievement }}</span>
            </div>
            <div class="scoring-desc">
              任务完成度：评估是否完整回答了题目要求，观点是否清晰明确
            </div>
          </div>

          <div class="scoring-item">
            <div class="scoring-header">
              <span class="scoring-name">Coherence and Cohesion</span>
              <span class="scoring-score">{{ assessment.coherence }}</span>
            </div>
            <div class="scoring-desc">
              连贯性与衔接：评估文章结构、段落组织、过渡词使用的合理性
            </div>
          </div>

          <div class="scoring-item">
            <div class="scoring-header">
              <span class="scoring-name">Lexical Resource</span>
              <span class="scoring-score">{{ assessment.lexicalResource }}</span>
            </div>
            <div class="scoring-desc">
              词汇资源：评估词汇使用准确性、多样性和高级词汇的运用
            </div>
          </div>

          <div class="scoring-item">
            <div class="scoring-header">
              <span class="scoring-name">Grammatical Range and Accuracy</span>
              <span class="scoring-score">{{ assessment.grammar }}</span>
            </div>
            <div class="scoring-desc">
              语法范围与准确性：评估语法结构复杂度、句子多样性和语法准确性
            </div>
          </div>
        </div>

        <!-- 整体改进建议 -->
        <el-card class="feedback-card">
          <template #header>
            <span>整体改进建议 Overall Feedback</span>
          </template>
          <div class="feedback-content">{{ assessment.overallFeedback }}</div>
        </el-card>

        <!-- 历史对比 -->
        <el-card class="history-card">
          <template #header>
            <span>历史平均对比</span>
          </template>
          <div class="comparison-controls">
            <el-select v-model="comparisonRange" placeholder="选择对比范围">
              <el-option label="全部历史" value="all" />
              <el-option label="最近10次" value="recent10" />
              <el-option label="本月" value="month" />
              <el-option label="Task 1专项" value="task1" />
              <el-option label="Task 2专项" value="task2" />
            </el-select>
          </div>
          <div class="comparison-data" v-if="comparisonData">
            <table class="comparison-table">
              <thead>
                <tr>
                  <th>评分项</th>
                  <th>当前</th>
                  <th>历史平均</th>
                  <th>差值</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in comparisonData" :key="item.name">
                  <td>{{ item.name }}</td>
                  <td>{{ item.current }}</td>
                  <td>{{ item.average }}</td>
                  <td :class="getDiffClass(item.diff)">
                    {{ item.diff > 0 ? '+' : '' }}{{ item.diff }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="no-comparison-data">
            暂无历史数据对比
          </div>
        </el-card>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <el-button @click="reassess" :icon="Refresh">重新评分</el-button>
          <el-button type="primary" @click="writeNewEssay" :icon="Edit">写新作文</el-button>
        </div>
      </el-aside>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning, Plus, Minus, Refresh, Edit } from '@element-plus/icons-vue'
import * as echarts from 'echarts'

const props = defineProps({
  assessment: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['reassess', 'writeNew'])

const viewMode = ref('annotated')
const comparisonRange = ref('all')
const radarChart = ref(null)

// 模拟标注数据
const annotatedSentences = computed(() => {
  const sentences = props.assessment.content.split(/[.!?]+/)
  return sentences.map((sentence, index) => {
    const words = sentence.trim().split(' ').map(word => ({
      text: word,
      error: Math.random() > 0.7 ? {
        type: ['语法错误', '拼写错误', '用词不当', '句式问题'][Math.floor(Math.random() * 4)],
        shortReason: '错误的语法结构',
        reason: '这个句子存在语法错误，需要修正结构',
        correction: '正确表达方式',
        correctedSentence: '修正后的完整句子'
      } : null
    }))

    const errors = words.filter(w => w.error)

    return {
      words,
      errors,
      expanded: index < 3 ? ['1'] : []
    }
  })
})

const comparisonData = ref(null)

onMounted(() => {
  initRadarChart()
  loadComparisonData()
})

const initRadarChart = () => {
  if (!radarChart.value) return

  const chart = echarts.init(radarChart.value)
  const option = {
    radar: {
      indicator: [
        { name: '任务完成', max: 9 },
        { name: '连贯衔接', max: 9 },
        { name: '词汇资源', max: 9 },
        { name: '语法准确', max: 9 }
      ],
      axisName: {
        color: '#666'
      }
    },
    series: [
      {
        name: '当前作文',
        type: 'radar',
        data: [
          props.assessment.taskAchievement || 6.5,
          props.assessment.coherence || 6.0,
          props.assessment.lexicalResource || 6.5,
          props.assessment.grammar || 6.0
        ],
        itemStyle: {
          color: '#409EFF'
        }
      },
      {
        name: '历史平均',
        type: 'radar',
        data: [6.2, 5.8, 6.3, 5.9],
        lineStyle: {
          type: 'dashed'
        },
        itemStyle: {
          color: '#909399'
        }
      }
    ],
    legend: {
      data: ['当前作文', '历史平均']
    }
  }

  chart.setOption(option)
}

const loadComparisonData = () => {
  // 模拟历史对比数据
  comparisonData.value = [
    { name: '任务完成', current: 7.0, average: 6.2, diff: 0.8 },
    { name: '连贯衔接', current: 6.5, average: 5.8, diff: 0.7 },
    { name: '词汇资源', current: 6.8, average: 6.3, diff: 0.5 },
    { name: '语法准确', current: 6.5, average: 5.9, diff: 0.6 }
  ]
}

const getWordClass = (word) => {
  if (!word.error) return ''

  const typeColors = {
    '语法错误': 'error-grammar',
    '拼写错误': 'error-spelling',
    '用词不当': 'error-vocabulary',
    '句式问题': 'error-structure'
  }

  return typeColors[word.error.type] || 'error-default'
}

const getErrorTagType = (type) => {
  const typeMap = {
    '语法错误': 'danger',
    '拼写错误': 'warning',
    '用词不当': 'primary',
    '句式问题': 'info'
  }
  return typeMap[type] || 'info'
}

const getDiffClass = (diff) => {
  return diff > 0 ? 'positive-diff' : 'negative-diff'
}

const expandAll = () => {
  annotatedSentences.value.forEach(sentence => {
    sentence.expanded = ['1']
  })
}

const collapseAll = () => {
  annotatedSentences.value.forEach(sentence => {
    sentence.expanded = []
  })
}

const reassess = () => {
  emit('reassess')
}

const writeNewEssay = () => {
  emit('writeNew')
}
</script>

<style scoped>
.assessment-result-container {
  height: 100vh;
  background: #fff;
}

.left-panel {
  border-right: 1px solid #e4e7ed;
  overflow-y: auto;
}

.essay-header {
  padding: 20px;
  border-bottom: 1px solid #e4e7ed;
  background: #fafafa;
}

.original-content {
  padding: 20px;
}

.essay-text {
  font-size: 16px;
  line-height: 1.8;
  color: #303133;
  white-space: pre-wrap;
}

.annotated-content {
  padding: 20px;
}

.batch-controls {
  padding: 15px 20px;
  background: #f8f9fa;
  border-bottom: 1px solid #e4e7ed;
  margin-bottom: 20px;
}

.sentence-blocks {
  space-y: 20px;
}

.sentence-block {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
}

.sentence-index {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}

.sentence-text {
  font-size: 16px;
  line-height: 1.8;
  margin-bottom: 10px;
}

.error-grammar {
  color: #F56C6C;
  background: rgba(245, 108, 108, 0.1);
  border-radius: 2px;
  padding: 1px 2px;
  cursor: pointer;
}

.error-spelling {
  color: #E6A23C;
  background: rgba(230, 162, 60, 0.1);
  border-radius: 2px;
  padding: 1px 2px;
  cursor: pointer;
}

.error-vocabulary {
  color: #409EFF;
  background: rgba(64, 158, 255, 0.1);
  border-radius: 2px;
  padding: 1px 2px;
  cursor: pointer;
}

.error-structure {
  color: #9C27B0;
  background: rgba(156, 39, 176, 0.1);
  border-radius: 2px;
  padding: 1px 2px;
  cursor: pointer;
}

.error-details {
  margin-top: 10px;
}

.error-list {
  space-y: 10px;
}

.error-item {
  padding: 10px;
  background: #f8f9fa;
  border-radius: 6px;
  margin-bottom: 10px;
}

.error-header {
  margin-bottom: 8px;
}

.error-content p {
  margin: 5px 0;
  font-size: 14px;
  line-height: 1.5;
}

.right-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}

.total-score {
  text-align: center;
  padding: 30px 20px;
  background: linear-gradient(135deg, #409EFF 0%, #36D1DC 100%);
  color: white;
  border-radius: 12px;
}

.score-value {
  font-size: 48px;
  font-weight: bold;
  line-height: 1;
  margin-bottom: 8px;
}

.score-label {
  font-size: 16px;
  margin-bottom: 8px;
}

.score-time {
  font-size: 14px;
  opacity: 0.8;
}

.radar-card,
.feedback-card,
.history-card {
  margin-bottom: 20px;
}

.radar-chart {
  height: 300px;
}

.scoring-details {
  background: white;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.scoring-item {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #f0f0f0;
}

.scoring-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.scoring-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.scoring-name {
  font-weight: 600;
  color: #303133;
}

.scoring-score {
  font-size: 20px;
  font-weight: bold;
  color: #409EFF;
}

.scoring-desc {
  font-size: 14px;
  color: #606266;
  line-height: 1.5;
}

.feedback-content {
  font-size: 14px;
  line-height: 1.6;
  color: #303133;
}

.comparison-controls {
  margin-bottom: 15px;
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
}

.comparison-table th,
.comparison-table td {
  padding: 8px;
  text-align: center;
  border: 1px solid #e4e7ed;
}

.comparison-table th {
  background: #f5f7fa;
  font-weight: 600;
}

.positive-diff {
  color: #67C23A;
  font-weight: bold;
}

.negative-diff {
  color: #F56C6C;
  font-weight: bold;
}

.no-comparison-data {
  text-align: center;
  color: #909399;
  padding: 20px;
}

.action-buttons {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 20px;
}

@media (max-width: 768px) {
  .assessment-result-container .el-container {
    flex-direction: column;
  }

  .left-panel,
  .right-panel {
    width: 100% !important;
  }
}
</style>