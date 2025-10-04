<template>
  <div class="grammar-highlight-panel">
    <el-card>
      <template #header>
        <div class="panel-header">
          <span class="panel-title">
            <el-icon><DocumentChecked /></el-icon>
            语法检查
          </span>
          <div class="panel-controls">
            <el-button
              size="small"
              @click="checkGrammar"
              :loading="checking"
              type="primary"
            >
              {{ checking ? '检查中...' : '检查语法' }}
            </el-button>
            <el-button
              size="small"
              @click="clearAnnotations"
              v-if="annotations.length > 0"
            >
              清除标注
            </el-button>
          </div>
        </div>
      </template>

      <!-- 语法统计 -->
      <div class="grammar-stats" v-if="grammarStats">
        <el-row :gutter="16">
          <el-col :span="6">
            <el-statistic title="语法评分" :value="grammarStats.score">
              <template #suffix>/100</template>
            </el-statistic>
          </el-col>
          <el-col :span="6">
            <el-statistic title="错误" :value="grammarStats.errors" value-style="color: #f56c6c" />
          </el-col>
          <el-col :span="6">
            <el-statistic title="警告" :value="grammarStats.warnings" value-style="color: #e6a23c" />
          </el-col>
          <el-col :span="6">
            <el-statistic title="建议" :value="grammarStats.suggestions" value-style="color: #67c23a" />
          </el-col>
        </el-row>
      </div>

      <!-- 错误列表 -->
      <div class="annotations-list" v-if="annotations.length > 0">
        <div class="filter-tabs">
          <el-radio-group v-model="activeFilter" size="small">
            <el-radio-button label="all">全部 ({{ annotations.length }})</el-radio-button>
            <el-radio-button label="error">错误 ({{ errorCount }})</el-radio-button>
            <el-radio-button label="warning">警告 ({{ warningCount }})</el-radio-button>
            <el-radio-button label="suggestion">建议 ({{ suggestionCount }})</el-radio-button>
          </el-radio-group>
        </div>

        <div class="annotation-items">
          <div
            v-for="annotation in filteredAnnotations"
            :key="annotation.id"
            class="annotation-item"
            :class="[
              `severity-${annotation.severity}`,
              { 'user-accepted': annotation.user_action === 'accepted' }
            ]"
            @click="highlightAnnotation(annotation)"
          >
            <div class="annotation-header">
              <el-tag
                :type="getTagType(annotation.severity)"
                size="small"
              >
                {{ getSeverityText(annotation.severity) }}
              </el-tag>
              <el-tag
                size="small"
                type="info"
              >
                {{ getCategoryText(annotation.category) }}
              </el-tag>
              <div class="annotation-actions">
                <el-button
                  size="small"
                  text
                  @click.stop="acceptAnnotation(annotation)"
                  v-if="annotation.user_action === 'pending'"
                  type="success"
                >
                  采纳
                </el-button>
                <el-button
                  size="small"
                  text
                  @click.stop="rejectAnnotation(annotation)"
                  v-if="annotation.user_action === 'pending'"
                  type="danger"
                >
                  忽略
                </el-button>
                <el-button
                  size="small"
                  text
                  @click.stop="locateInEditor(annotation)"
                >
                  定位
                </el-button>
              </div>
            </div>

            <div class="annotation-content">
              <div class="error-text">
                <strong>原文:</strong> "{{ annotation.error_text }}"
              </div>
              <div class="suggestion-text" v-if="annotation.suggested_text">
                <strong>建议:</strong> "{{ annotation.suggested_text }}"
              </div>
              <div class="error-message">
                {{ annotation.message }}
              </div>
            </div>

            <div class="annotation-footer" v-if="annotation.user_action !== 'pending'">
              <el-tag
                :type="annotation.user_action === 'accepted' ? 'success' : 'info'"
                size="small"
              >
                {{ annotation.user_action === 'accepted' ? '已采纳' : '已忽略' }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <el-empty
        v-else-if="!checking"
        description="暂无语法问题"
        :image-size="100"
      >
        <template #image>
          <el-icon size="100" color="#c0c4cc"><DocumentChecked /></el-icon>
        </template>
      </el-empty>

      <!-- 加载状态 -->
      <div v-else class="checking-state">
        <el-skeleton :rows="3" animated />
        <p style="text-align: center; margin-top: 16px; color: #909399;">
          正在进行语法分析...
        </p>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { DocumentChecked } from '@element-plus/icons-vue'
import axios from 'axios'

const props = defineProps({
  writingId: {
    type: String,
    required: true
  },
  assessmentResultId: {
    type: String,
    default: null
  },
  content: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['annotation-selected', 'annotation-updated'])

// 状态
const checking = ref(false)
const annotations = ref([])
const activeFilter = ref('all')
const grammarStats = ref(null)

// 计算属性
const filteredAnnotations = computed(() => {
  if (activeFilter.value === 'all') {
    return annotations.value
  }
  return annotations.value.filter(ann => ann.severity === activeFilter.value)
})

const errorCount = computed(() =>
  annotations.value.filter(ann => ann.severity === 'error').length
)

const warningCount = computed(() =>
  annotations.value.filter(ann => ann.severity === 'warning').length
)

const suggestionCount = computed(() =>
  annotations.value.filter(ann => ann.severity === 'suggestion').length
)

// 方法
const checkGrammar = async () => {
  if (!props.content.trim()) {
    ElMessage.warning('请先输入内容再进行语法检查')
    return
  }

  checking.value = true

  try {
    const response = await axios.post('/api/grammar/check', {
      text: props.content,
      options: {
        includeStyle: true,
        includeSpelling: true,
        includePunctuation: true,
        maxIssues: 50
      },
      writingId: props.writingId,
      assessmentResultId: props.assessmentResultId
    })

    if (response.data.success) {
      const data = response.data.data

      // 更新统计数据
      grammarStats.value = data.statistics
      grammarStats.value.score = data.score

      // 更新标注列表
      annotations.value = data.savedAnnotations.map(saved => ({
        ...saved,
        error_text: data.issues.find(issue => issue.id === saved.issueId)?.text || '',
        suggested_text: data.issues.find(issue => issue.id === saved.issueId)?.suggestion || '',
        category: data.issues.find(issue => issue.id === saved.issueId)?.category || saved.category,
        severity: data.issues.find(issue => issue.id === saved.issueId)?.severity || saved.severity,
        message: data.issues.find(issue => issue.id === saved.issueId)?.message || saved.message,
        user_action: saved.user_action || 'pending'
      }))

      ElMessage.success(`发现 ${annotations.value.length} 个语法问题`)
    }
  } catch (error) {
    console.error('语法检查失败:', error)
    ElMessage.error(error.response?.data?.message || '语法检查失败')
  } finally {
    checking.value = false
  }
}

const clearAnnotations = () => {
  annotations.value = []
  grammarStats.value = null
  ElMessage.success('已清除所有标注')
}

const highlightAnnotation = (annotation) => {
  emit('annotation-selected', annotation)
}

const locateInEditor = (annotation) => {
  emit('annotation-selected', annotation)
}

const acceptAnnotation = async (annotation) => {
  try {
    await axios.put(`/api/grammar/annotations/${annotation.id}`, {
      userAction: 'accepted',
      userNotes: '用户采纳了此建议'
    })

    // 更新本地状态
    const index = annotations.value.findIndex(ann => ann.id === annotation.id)
    if (index !== -1) {
      annotations.value[index].user_action = 'accepted'
    }

    emit('annotation-updated', annotation)
    ElMessage.success('已采纳建议')
  } catch (error) {
    console.error('采纳建议失败:', error)
    ElMessage.error('操作失败')
  }
}

const rejectAnnotation = async (annotation) => {
  try {
    await axios.put(`/api/grammar/annotations/${annotation.id}`, {
      userAction: 'ignored',
      userNotes: '用户忽略了此建议'
    })

    // 更新本地状态
    const index = annotations.value.findIndex(ann => ann.id === annotation.id)
    if (index !== -1) {
      annotations.value[index].user_action = 'ignored'
    }

    emit('annotation-updated', annotation)
    ElMessage.success('已忽略建议')
  } catch (error) {
    console.error('忽略建议失败:', error)
    ElMessage.error('操作失败')
  }
}

// 辅助方法
const getTagType = (severity) => {
  const typeMap = {
    'error': 'danger',
    'warning': 'warning',
    'suggestion': 'success'
  }
  return typeMap[severity] || 'info'
}

const getSeverityText = (severity) => {
  const textMap = {
    'error': '错误',
    'warning': '警告',
    'suggestion': '建议'
  }
  return textMap[severity] || '未知'
}

const getCategoryText = (category) => {
  const textMap = {
    'grammar': '语法',
    'vocabulary': '词汇',
    'structure': '结构',
    'punctuation': '标点',
    'style': '风格'
  }
  return textMap[category] || '其他'
}

// 监听内容变化，自动清除旧标注
watch(() => props.content, () => {
  if (annotations.value.length > 0) {
    clearAnnotations()
  }
})

// 如果有评估结果ID，加载已保存的标注
onMounted(async () => {
  if (props.assessmentResultId) {
    try {
      const response = await axios.get(`/api/grammar/annotations/${props.assessmentResultId}`)
      if (response.data.success) {
        annotations.value = response.data.data
      }
    } catch (error) {
      console.error('加载语法标注失败:', error)
    }
  }
})
</script>

<style scoped>
.grammar-highlight-panel {
  height: 100%;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
  font-size: 16px;
}

.panel-controls {
  display: flex;
  gap: 8px;
}

.grammar-stats {
  margin-bottom: 20px;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.filter-tabs {
  margin-bottom: 16px;
}

.annotation-items {
  max-height: 400px;
  overflow-y: auto;
}

.annotation-item {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.annotation-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.annotation-item.severity-error {
  border-left: 4px solid #f56c6c;
}

.annotation-item.severity-warning {
  border-left: 4px solid #e6a23c;
}

.annotation-item.severity-suggestion {
  border-left: 4px solid #67c23a;
}

.annotation-item.user-accepted {
  background: #f0f9ff;
  border-color: #409eff;
}

.annotation-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.annotation-actions {
  display: flex;
  gap: 4px;
}

.annotation-content {
  margin-bottom: 8px;
}

.error-text {
  font-weight: bold;
  color: #303133;
  margin-bottom: 4px;
}

.suggestion-text {
  color: #67c23a;
  margin-bottom: 4px;
}

.error-message {
  color: #606266;
  font-size: 14px;
  line-height: 1.5;
}

.annotation-footer {
  border-top: 1px solid #f0f0f0;
  padding-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.checking-state {
  padding: 20px;
}
</style>