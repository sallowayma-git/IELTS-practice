<template>
  <el-dialog
    v-model="visible"
    title="导出数据"
    width="600px"
    :before-close="handleClose"
  >
    <div class="export-content">
      <!-- 导出格式选择 -->
      <div class="export-section">
        <h4>选择导出格式</h4>
        <el-radio-group v-model="exportFormat" class="format-options">
          <el-radio value="csv">
            <div class="format-option">
              <div class="format-header">
                <span class="format-name">CSV格式</span>
                <el-tag size="small" type="info">推荐</el-tag>
              </div>
              <div class="format-desc">适合Excel分析，包含核心评分数据</div>
            </div>
          </el-radio>
          <el-radio value="json">
            <div class="format-option">
              <div class="format-header">
                <span class="format-name">JSON格式</span>
                <el-tag size="small" type="success">完整</el-tag>
              </div>
              <div class="format-desc">完整数据备份，包含详细反馈和语法标注</div>
            </div>
          </el-radio>
        </el-radio-group>
      </div>

      <!-- 导出选项 -->
      <div class="export-section">
        <h4>导出选项</h4>
        <el-checkbox-group v-model="exportOptions">
          <el-checkbox value="includeAnnotations" v-if="exportFormat === 'json'">
            包含语法标注
          </el-checkbox>
          <el-checkbox value="respectFilters">
            仅导出当前筛选结果
            <div class="checkbox-desc">导出历史页面中已应用筛选条件的记录</div>
          </el-checkbox>
        </el-checkbox-group>
      </div>

      <!-- 筛选条件预览 -->
      <div class="export-section" v-if="currentFilters && exportOptions.includes('respectFilters')">
        <h4>当前筛选条件</h4>
        <div class="filters-preview">
          <el-tag
            v-if="currentFilters.type"
            type="primary"
            class="filter-tag"
          >
            题目类型: {{ getFilterText(currentFilters.type) }}
          </el-tag>
          <el-tag
            v-if="currentFilters.scoreRange"
            type="success"
            class="filter-tag"
          >
            分数范围: {{ getFilterText(currentFilters.scoreRange) }}
          </el-tag>
          <el-tag
            v-if="currentFilters.dateRange && currentFilters.dateRange.length === 2"
            type="warning"
            class="filter-tag"
          >
            日期: {{ formatDateRange(currentFilters.dateRange) }}
          </el-tag>
          <el-tag
            v-if="currentFilters.keyword"
            type="info"
            class="filter-tag"
          >
            关键词: {{ currentFilters.keyword }}
          </el-tag>
          <span v-if="!hasActiveFilters" class="no-filters">无筛选条件</span>
        </div>
      </div>

      <!-- 预计导出数量 -->
      <div class="export-section">
        <h4>导出预览</h4>
        <div class="export-preview">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-statistic
                title="预计导出记录数"
                :value="estimatedCount"
                :loading="calculating"
              />
            </el-col>
            <el-col :span="12">
              <el-statistic
                title="文件大小预估"
                :value="estimatedSize"
                suffix="KB"
                :loading="calculating"
              />
            </el-col>
          </el-row>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="primary"
          @click="handleExport"
          :loading="exporting"
          :disabled="estimatedCount === 0"
        >
          {{ exporting ? '导出中...' : '开始导出' }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  currentFilters: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'export-completed'])

// 状态
const visible = ref(false)
const exportFormat = ref('csv')
const exportOptions = ref(['respectFilters'])
const exporting = ref(false)
const calculating = ref(false)
const estimatedCount = ref(0)
const estimatedSize = ref(0)

// 计算属性
const hasActiveFilters = computed(() => {
  if (!props.currentFilters) return false
  return Object.values(props.currentFilters).some(value =>
    value && (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '')
  )
})

// 监听visible变化
watch(() => props.modelValue, (val) => {
  visible.value = val
  if (val) {
    calculateExportEstimate()
  }
})

watch(visible, (val) => {
  emit('update:modelValue', val)
})

// 监听导出格式和选项变化
watch([exportFormat, exportOptions, () => props.currentFilters], () => {
  calculateExportEstimate()
})

// 方法
const handleClose = () => {
  visible.value = false
}

const calculateExportEstimate = async () => {
  if (!props.currentFilters) {
    estimatedCount.value = 0
    estimatedSize.value = 0
    return
  }

  calculating.value = true

  try {
    const requestBody = {
      userId: 'default_user',
      filters: exportOptions.value.includes('respectFilters') ? props.currentFilters : {}
    }

    // 调用API获取导出数据的估算
    const response = await fetch('/api/export/estimate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        estimatedCount.value = data.data.count

        // 估算文件大小
        const baseSize = exportFormat.value === 'csv' ? 0.5 : 2.0 // KB per record
        const annotationsSize = exportOptions.value.includes('includeAnnotations') ? 0.3 : 0
        estimatedSize.value = Math.round(estimatedCount.value * (baseSize + annotationsSize))
      }
    } else {
      // 如果API不可用，使用默认估算
      estimatedCount.value = 0
      estimatedSize.value = 0
    }
  } catch (error) {
    console.error('获取导出估算失败:', error)
    // 使用默认值
    estimatedCount.value = 0
    estimatedSize.value = 0
  } finally {
    calculating.value = false
  }
}

const handleExport = async () => {
  if (estimatedCount.value === 0) {
    ElMessage.warning('没有符合条件的数据可导出')
    return
  }

  exporting.value = true

  try {
    const requestBody = {
      userId: 'default_user',
      filters: exportOptions.value.includes('respectFilters') ? props.currentFilters : {},
      includeAnnotations: exportOptions.value.includes('includeAnnotations')
    }

    let endpoint, filename, mimeType

    if (exportFormat.value === 'csv') {
      endpoint = '/api/export/csv'
      filename = generateFilename('csv')
      mimeType = 'text/csv'
    } else {
      endpoint = '/api/export/json'
      filename = generateFilename('json')
      mimeType = 'application/json'
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || '导出失败')
    }

    // 处理CSV下载（直接返回文件）
    if (exportFormat.value === 'csv') {
      const blob = await response.blob()
      downloadFile(blob, filename, mimeType)
      ElMessage.success(`CSV文件导出成功: ${filename}`)
    } else {
      // 处理JSON下载（包含在响应中）
      const data = await response.json()
      if (data.success) {
        const jsonString = JSON.stringify(data.data, null, 2)
        const blob = new Blob([jsonString], { type: mimeType })
        downloadFile(blob, filename, mimeType)
        ElMessage.success(`JSON文件导出成功: ${filename}`)
      } else {
        throw new Error(data.message || '导出失败')
      }
    }

    emit('export-completed', {
      format: exportFormat.value,
      count: estimatedCount.value,
      filename: filename
    })

    handleClose()

  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error(`导出失败: ${error.message}`)
  } finally {
    exporting.value = false
  }
}

const downloadFile = (blob, filename, mimeType) => {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

const generateFilename = (format) => {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  return `ielts-history-${today}.${format}`
}

const getFilterText = (value) => {
  const filterTexts = {
    'task1': 'Task 1',
    'task2': 'Task 2',
    'below6': '6.0分以下',
    '6to6.5': '6.0-6.5分',
    'above7': '7.0分以上'
  }
  return filterTexts[value] || value
}

const formatDateRange = (dateRange) => {
  if (!dateRange || dateRange.length !== 2) return ''
  const start = new Date(dateRange[0]).toLocaleDateString('zh-CN')
  const end = new Date(dateRange[1]).toLocaleDateString('zh-CN')
  return `${start} ~ ${end}`
}
</script>

<style scoped>
.export-content {
  max-height: 60vh;
  overflow-y: auto;
}

.export-section {
  margin-bottom: 24px;
}

.export-section h4 {
  margin: 0 0 12px 0;
  color: #303133;
  font-weight: 500;
}

.format-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.format-option {
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 12px;
  transition: border-color 0.3s;
}

.format-option:hover {
  border-color: #409eff;
}

.format-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.format-name {
  font-weight: 500;
  color: #303133;
}

.format-desc {
  font-size: 13px;
  color: #909399;
}

.el-checkbox {
  margin-bottom: 12px;
  width: 100%;
}

.checkbox-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

.filters-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-tag {
  margin: 0;
}

.no-filters {
  color: #909399;
  font-style: italic;
}

.export-preview {
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>