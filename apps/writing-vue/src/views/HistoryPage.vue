<template>
  <div class="history-page">
    <div class="page-header">
      <h1>📋 历史记录</h1>
      <div class="header-actions">
        <button 
          class="btn btn-secondary" 
          @click="exportCSV"
          :disabled="loading || total === 0"
        >
          📤 导出CSV ({{ total }}条)
        </button>
        <button 
          class="btn btn-danger" 
          @click="confirmDeleteAll"
          :disabled="loading || total === 0"
        >
          🗑️ 清空所有
        </button>
      </div>
    </div>

    <!-- 筛选面板 -->
    <div class="filter-panel card">
      <div class="filter-row">
        <div class="filter-item">
          <label>任务类型</label>
          <select v-model="filters.task_type">
            <option value="">全部</option>
            <option value="task1">Task 1</option>
            <option value="task2">Task 2</option>
          </select>
        </div>

        <div class="filter-item">
          <label>日期范围</label>
          <div class="date-range">
            <input 
              type="date" 
              v-model="filters.start_date"
              :max="filters.end_date || today"
            />
            <span>至</span>
            <input 
              type="date" 
              v-model="filters.end_date"
              :min="filters.start_date"
              :max="today"
            />
          </div>
        </div>

        <div class="filter-item">
          <label>分数范围</label>
          <div class="score-range">
            <input 
              type="number" 
              v-model.number="filters.min_score"
              min="0"
              max="9"
              step="0.5"
              placeholder="最低分"
            />
            <span>至</span>
            <input 
              type="number" 
              v-model.number="filters.max_score"
              min="0"
              max="9"
              step="0.5"
              placeholder="最高分"
            />
          </div>
        </div>

        <button class="btn btn-secondary" @click="resetFilters">重置筛选</button>
      </div>

      <div class="search-row">
        <input 
          type="text"
          v-model="filters.search"
          placeholder="🔍 搜索功能待后端支持..."
          class="search-input"
          disabled
          title="搜索功能需要后端 LIKE 查询支持，当前暂不可用"
        />
      </div>
    </div>

    <!-- 统计分析区域 -->
    <div v-if="total > 0" class="statistics-section card">
      <div class="section-header">
        <h2>📊 历史统计与对比</h2>
        <div class="range-selector">
          <label>对比范围：</label>
          <select v-model="statisticsRange" @change="loadStatistics">
            <option value="all">全部历史</option>
            <option value="recent10">最近10次</option>
            <option value="thisMonth">本月</option>
            <option value="task1">Task 1专项</option>
            <option value="task2">Task 2专项</option>
          </select>
        </div>
      </div>

      <div v-if="statistics" class="statistics-content">
        <div class="stat-grid">
          <!-- 雷达图 -->
          <div class="stat-chart">
            <h3>四项评分对比</h3>
            <RadarChart 
              v-if="statistics.count > 0"
              :currentScores="statistics.latest"
              :averageScores="statistics.average"
              :taskType="statistics.latest_task_type"
            />
            <div v-else class="empty-chart">
              <p>暂无可对比的数据</p>
            </div>
          </div>

          <!-- 对比表格 -->
          <div class="stat-comparison">
            <h3>详细对比数据</h3>
            <table v-if="statistics.count > 0" class="comparison-table">
              <thead>
                <tr>
                  <th>评分项</th>
                  <th>最新</th>
                  <th>平均</th>
                  <th>差值</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{{ statistics.latest_task_type === 'task1' ? 'Task Achievement' : 'Task Response' }}</td>
                  <td>{{ statistics.latest.tr_ta }}</td>
                  <td>{{ statistics.average.tr_ta }}</td>
                  <td :class="getDifferenceClass(statistics.latest.tr_ta - statistics.average.tr_ta)">
                    {{ formatDifference(statistics.latest.tr_ta - statistics.average.tr_ta) }}
                  </td>
                </tr>
                <tr>
                  <td>Coherence & Cohesion</td>
                  <td>{{ statistics.latest.cc }}</td>
                  <td>{{ statistics.average.cc }}</td>
                  <td :class="getDifferenceClass(statistics.latest.cc - statistics.average.cc)">
                    {{ formatDifference(statistics.latest.cc - statistics.average.cc) }}
                  </td>
                </tr>
                <tr>
                  <td>Lexical Resource</td>
                  <td>{{ statistics.latest.lr }}</td>
                  <td>{{ statistics.average.lr }}</td>
                  <td :class="getDifferenceClass(statistics.latest.lr - statistics.average.lr)">
                    {{ formatDifference(statistics.latest.lr - statistics.average.lr) }}
                  </td>
                </tr>
                <tr>
                  <td>Grammatical Range</td>
                  <td>{{ statistics.latest.gra }}</td>
                  <td>{{ statistics.average.gra }}</td>
                  <td :class="getDifferenceClass(statistics.latest.gra - statistics.average.gra)">
                    {{ formatDifference(statistics.latest.gra - statistics.average.gra) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-comparison">
              <p>{{ getRangeDescription() }}下暂无数据</p>
            </div>
            
            <div v-if="statistics.count > 0" class="stat-summary">
              <p><strong>统计范围：</strong>{{ getRangeDescription() }}</p>
              <p><strong>记录数量：</strong>{{ statistics.count }} 次</p>
              <p><strong>最新提交：</strong>{{ formatDate(statistics.latest_date) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="loadingStatistics" class="loading">加载统计数据中...</div>
      <div v-else class="statistics-empty">
        <p>暂无统计数据</p>
      </div>
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectedIds.length > 0" class="batch-actions card">
      <span class="selection-count">已选择 {{ selectedIds.length }} 条记录</span>
      <button class="btn btn-danger btn-sm" @click="confirmBatchDelete">
        🗑️ 删除选中
      </button>
      <button class="btn btn-secondary btn-sm" @click="clearSelection">
        取消选择
      </button>
    </div>

    <!-- 列表区域 -->
    <div v-if="loading" class="loading">加载中...</div>
    
    <div v-else-if="error" class="error-state card">
      <p>⚠️ {{ error }}</p>
      <button class="btn btn-primary" @click="loadEssays">重试</button>
    </div>

    <div v-else-if="essays.length === 0 && !hasActiveFilters" class="empty-state card">
      <p>📝 暂无历史记录，提交作文后查看评分历史</p>
    </div>

    <div v-else-if="essays.length === 0 && hasActiveFilters" class="empty-state card">
      <p>🔍 当前筛选条件无结果，请调整筛选条件</p>
      <button class="btn btn-secondary" @click="resetFilters">重置筛选</button>
    </div>

    <div v-else class="essay-list">
      <div v-for="essay in essays" :key="essay.id" class="essay-item card">
        <div class="essay-checkbox">
          <input 
            type="checkbox"
            :checked="selectedIds.includes(essay.id)"
            @change="toggleSelection(essay.id)"
          />
        </div>

        <div class="essay-content" @click="viewDetail(essay.id)">
          <div class="essay-header">
            <span :class="['task-badge', essay.task_type]">
              {{ essay.task_type === 'task1' ? 'Task 1' : 'Task 2' }}
            </span>
            <span class="essay-date">{{ formatDate(essay.submitted_at) }}</span>
          </div>

          <div class="essay-title">
            {{ getTopicTitle(essay.topic_title) }}
          </div>

          <div class="essay-stats">
            <span class="stat-item">📝 {{ essay.word_count }} 词</span>
            <span :class="['stat-item', 'score', getScoreClass(essay.total_score)]">
              ⭐ {{ essay.total_score }}
            </span>
          </div>
        </div>

        <div class="essay-actions">
          <button class="btn-icon" @click.stop="viewDetail(essay.id)" title="查看详情">
            👁️
          </button>
          <button class="btn-icon" @click.stop="confirmDelete(essay.id)" title="删除">
            🗑️
          </button>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > pagination.limit" class="pagination">
      <button 
        class="btn btn-secondary"
        :disabled="pagination.page === 1"
        @click="pagination.page--"
      >
        上一页
      </button>
      <span class="page-info">
        第 {{ pagination.page }} / {{ totalPages }} 页（共 {{ total }} 条）
      </span>
      <button 
        class="btn btn-secondary"
        :disabled="pagination.page >= totalPages"
        @click="pagination.page++"
      >
        下一页
      </button>
    </div>

    <!-- 详情弹窗 -->
    <div v-if="detailModalEssay" class="dialog-overlay" @click.self="closeDetail">
      <div class="dialog card detail-modal">
        <div class="modal-header">
          <h3>📋 评分详情（只读）</h3>
          <button class="btn-icon" @click="closeDetail">✕</button>
        </div>
        
        <div v-if="loadingDetail" class="loading">加载中...</div>
        
        <div v-else-if="detailData" class="detail-content">
          <!-- 复用 ResultPage 风格的展示 -->
          <div class="detail-grid">
            <!-- 左侧：作文内容 -->
            <div class="detail-left">
              <div class="section-header">📝 作文内容</div>
              <div class="essay-text">{{ detailData.content }}</div>
              
              <div class="section-header" style="margin-top: 20px;">ℹ️ 基本信息</div>
              <div class="info-grid">
                <div class="info-item">
                  <span class="info-label">任务类型</span>
                  <span>{{ detailData.task_type === 'task1' ? 'Task 1' : 'Task 2' }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">字数</span>
                  <span>{{ detailData.word_count }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">提交时间</span>
                  <span>{{ formatDate(detailData.submitted_at) }}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">模型</span>
                  <span>{{ detailData.model_name }}</span>
                </div>
              </div>
            </div>

            <!-- 右侧：评分详情 -->
            <div class="detail-right">
              <div class="total-score">
                <div class="score-value">{{ detailData.total_score }}</div>
                <div class="score-label">总分</div>
              </div>

              <div class="score-breakdown">
                <div class="score-item">
                  <span class="score-name">Task Achievement</span>
                  <span class="score-value">{{ detailData.task_achievement }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Coherence & Cohesion</span>
                  <span class="score-value">{{ detailData.coherence_cohesion }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Lexical Resource</span>
                  <span class="score-value">{{ detailData.lexical_resource }}</span>
                </div>
                <div class="score-item">
                  <span class="score-name">Grammatical Range</span>
                  <span class="score-value">{{ detailData.grammatical_range }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="showDeleteConfirm" class="dialog-overlay" @click.self="showDeleteConfirm = false">
      <div class="dialog card">
        <h3>⚠️ {{ deleteConfirmTitle }}</h3>
        <p>{{ deleteConfirmMessage }}</p>
        
        <!-- 清空所有需要输入确认 -->
        <div v-if="deleteMode === 'all'">
          <input 
            type="text"
            v-model="deleteConfirmInput"
            placeholder="请输入 &quot;确认删除&quot; 以继续"
            class="input"
            style="width: 100%; margin: 12px 0;"
          />
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="showDeleteConfirm = false">
            取消
          </button>
          <button 
            class="btn btn-danger" 
            @click="executeDelete"
            :disabled="deleteMode === 'all' && deleteConfirmInput !== '确认删除'"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {ref, computed, onMounted, watch } from 'vue'
import { essays as essaysApi } from '@/api/client.js'
import RadarChart from '@/components/RadarChart.vue'

// Debounce 工具函数
function debounce(fn, delay) {
  let timeoutId = null
  return function(...args) {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

// 状态
const loading = ref(false)
const error = ref('')
const essaysList = ref([])
const total = ref(0)
const pagination = ref({ page: 1, limit: 20 })
const today = new Date().toISOString().split('T')[0]

// Statistics state
const loadingStatistics = ref(false)
const statistics = ref(null)
const statisticsRange = ref('all')

// 筛选条件（严格按照后端契约）
const filters = ref({
  task_type: '',
  start_date: '',  // ISO 字符串
  end_date: '',    // ISO 字符串
  min_score: null, // 数字 0.5步长
  max_score: null, // 数字 0.5步长
  search: ''       // 后端 LIKE 查询
})

// 批量选择
const selectedIds = ref([])

// 详情弹窗
const detailModalEssay = ref(null)
const detailData = ref(null)
const loadingDetail = ref(false)

// 删除确认
const showDeleteConfirm = ref(false)
const deleteMode = ref('') // 'single' | 'batch' | 'all'
const deleteTarget = ref(null)
const deleteConfirmInput = ref('')

// 计算属性
const essays = computed(() => essaysList.value)
const totalPages = computed(() => Math.ceil(total.value / pagination.value.limit))
const hasActiveFilters = computed(() => {
  return filters.value.task_type || 
         filters.value.start_date || 
         filters.value.end_date ||
         filters.value.min_score !== null ||
         filters.value.max_score !== null ||
         filters.value.search
})

const deleteConfirmTitle = computed(() => {
  if (deleteMode.value === 'all') return '清空所有历史记录'
  if (deleteMode.value === 'batch') return `删除 ${selectedIds.value.length} 条记录`
  return '删除记录'
})

const deleteConfirmMessage = computed(() => {
  if (deleteMode.value === 'all') {
    return '此操作将删除所有历史记录，且不可恢复。请输入"确认删除"以继续。'
  }
  if (deleteMode.value === 'batch') {
    return `确定删除选中的 ${selectedIds.value.length} 条记录？此操作不可恢复。`
  }
  return '确定删除该记录？此操作不可恢复。'
})

// 加载列表
async function loadEssays() {
  loading.value = true
  error.value = ''
  
  // 日期范围校验
  if (filters.value.start_date && filters.value.end_date) {
    if (filters.value.start_date > filters.value.end_date) {
      error.value = '开始日期不能晚于结束日期'
      loading.value = false
      return
    }
  }
  
  // 分数范围校验
  if (filters.value.min_score !== null && filters.value.max_score !== null) {
    if (filters.value.min_score > filters.value.max_score) {
      error.value = '最低分不能高于最高分'
      loading.value = false
      return
    }
  }
  
  try {
    // 构建后端契约的筛选参数
    const apiFilters = {}
    
    if (filters.value.task_type) {
      apiFilters.task_type = filters.value.task_type
    }
    if (filters.value.start_date) {
      apiFilters.start_date = filters.value.start_date
    }
    if (filters.value.end_date) {
      apiFilters.end_date = filters.value.end_date
    }
    if (filters.value.min_score !== null && filters.value.min_score !== '') {
      apiFilters.min_score = filters.value.min_score
    }
    if (filters.value.max_score !== null && filters.value.max_score !== '') {
      apiFilters.max_score = filters.value.max_score
    }
    // search 暂不传递（后端 DAO 未实现 LIKE 查询）
    
    const result = await essaysApi.list(apiFilters, pagination.value)
    essaysList.value = result.data
    total.value = result.total
  } catch (err) {
    console.error('加载历史记录失败:', err)
    error.value = err.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

// 防抖版本
const debouncedLoadEssays = debounce(loadEssays, 300)

// 重置筛选
function resetFilters() {
  filters.value = {
    task_type: '',
    start_date: '',
    end_date: '',
    min_score: null,
    max_score: null,
    search: ''
  }
  pagination.value.page = 1
}

// 批量选择
function toggleSelection(id) {
  const index = selectedIds.value.indexOf(id)
  if (index > -1) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

function clearSelection() {
  selectedIds.value = []
}

// 查看详情
async function viewDetail(id) {
  detailModalEssay.value = id
  loadingDetail.value = true
  
  try {
    detailData.value = await essaysApi.getById(id)
  } catch (err) {
    console.error('加载详情失败:', err)
    alert('加载详情失败: ' + err.message)
    closeDetail()
  } finally {
    loadingDetail.value = false
  }
}

function closeDetail() {
  detailModalEssay.value = null
  detailData.value = null
}

// 删除操作
function confirmDelete(id) {
  deleteMode.value = 'single'
  deleteTarget.value = id
  showDeleteConfirm.value = true
}

function confirmBatchDelete() {
  if (selectedIds.value.length === 0) return
  deleteMode.value = 'batch'
  showDeleteConfirm.value = true
}

function confirmDeleteAll() {
  deleteMode.value = 'all'
  deleteConfirmInput.value = ''
  showDeleteConfirm.value = true
}

async function executeDelete() {
  try {
    if (deleteMode.value === 'single') {
      await essaysApi.delete(deleteTarget.value)
    } else if (deleteMode.value === 'batch') {
      await essaysApi.batchDelete(selectedIds.value)
      selectedIds.value = []
    } else if (deleteMode.value === 'all') {
      await essaysApi.deleteAll()
    }
    
    showDeleteConfirm.value = false
    await loadEssays()
  } catch (err) {
    console.error('删除失败:', err)
    alert('删除失败: ' + err.message)
  }
}

// 导出CSV
async function exportCSV() {
  try {
    // 构建筛选参数（导出"当前筛选结果全量"，非"当前页"）
    const apiFilters = {}
    if (filters.value.task_type) apiFilters.task_type = filters.value.task_type
    if (filters.value.start_date) apiFilters.start_date = filters.value.start_date
    if (filters.value.end_date) apiFilters.end_date = filters.value.end_date
    if (filters.value.min_score !== null && filters.value.min_score !== '') {
      apiFilters.min_score = filters.value.min_score
    }
    if (filters.value.max_score !== null && filters.value.max_score !== '') {
      apiFilters.max_score = filters.value.max_score
    }
    
    const csvContent = await essaysApi.exportCSV(apiFilters)
    
    // 生成带筛选范围的文件名
    const dateStr = new Date().toISOString().split('T')[0]
    const filterSuffix = []
    if (filters.value.task_type) filterSuffix.push(filters.value.task_type)
    if (filters.value.start_date || filters.value.end_date) filterSuffix.push('date-filtered')
    if (filters.value.min_score !== null || filters.value.max_score !== null) filterSuffix.push('score-filtered')
    const filename = `ielts-history-${dateStr}${filterSuffix.length > 0 ? '-' + filterSuffix.join('-') : ''}.csv`
    
    // 下载CSV文件
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('导出CSV失败:', err)
    alert('导出失败: ' + err.message)
  }
}

// 工具函数
function formatDate(dateStr) {
  if (!dateStr) return ''
  return dateStr.replace('T', ' ').substring(0, 16)
}

function getTopicTitle(titleJson) {
  if (!titleJson) return '自由写作'
  
  try {
    const parsed = JSON.parse(titleJson)
    return extractTextFromTiptap(parsed).substring(0, 50) || '自由写作'
  } catch {
    return titleJson.substring(0, 50)
  }
}

function extractTextFromTiptap(json) {
  if (typeof json === 'string') return json
  if (json.type === 'text') return json.text || ''
  if (json.content && Array.isArray(json.content)) {
    return json.content.map(extractTextFromTiptap).join('')
  }
  return ''
}

function getScoreClass(score) {
  if (score >= 7) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}

// Statistics functions
async function loadStatistics() {
  if (total.value === 0) return
  
  loadingStatistics.value = true
  
  try {
    // Determine range and taskType based on selector
    let range = statisticsRange.value
    let taskType = null
    
    // Map frontend range to backend protocol
    if (range === 'task1' || range === 'task2') {
      range = statisticsRange.value  // 'task1' or 'task2' for backend
    } else if (range === 'thisMonth') {
      range = 'monthly'  // Backend expects 'monthly'
    }
    // 'all' and 'recent10' pass through
    
    const result = await essaysApi.getStatistics(range, taskType)
    
    if (result && result.count > 0) {
      // STRICT PROTOCOL: Use only tr_ta field (no fallback)
      statistics.value = {
        count: result.count,
        latest: {
          tr_ta: parseFloat(result.latest.tr_ta || 0),  // PROTOCOL: Always tr_ta
          cc: parseFloat(result.latest.cc || 0),
          lr: parseFloat(result.latest.lr || 0),
          gra: parseFloat(result.latest.gra || 0)
        },
        average: {
          tr_ta: parseFloat(result.average.avg_tr_ta || 0),  // PROTOCOL: Always avg_tr_ta
          cc: parseFloat(result.average.avg_cc || 0),
          lr: parseFloat(result.average.avg_lr || 0),
          gra: parseFloat(result.average.avg_gra || 0)
        },
        latest_task_type: result.latest.task_type || 'task2',
        latest_date: result.latest.submitted_at
      }
    } else {
      statistics.value = { count: 0 }
    }
  } catch (err) {
    console.error('加载统计数据失败:', err)
    statistics.value = null
  } finally {
    loadingStatistics.value = false
  }
}

function formatDifference(diff) {
  if (diff > 0) return `+${diff.toFixed(1)}`
  if (diff < 0) return diff.toFixed(1)
  return '0.0'
}

function getDifferenceClass(diff) {
  if (diff > 0) return 'positive'
  if (diff < 0) return 'negative'
  return 'neutral'
}

function getRangeDescription() {
  const descriptions = {
    all: '全部历史',
    recent10: '最近10次',
    thisMonth: '本月',
    task1: 'Task 1专项',
    task2: 'Task 2专项'
  }
  return descriptions[statisticsRange.value] || '全部历史'
}

// 监听筛选和分页变化
watch(filters, () => {
  pagination.value.page = 1
  debouncedLoadEssays()
}, { deep: true })

watch(() => pagination.value.page, () => {
  loadEssays()
})

// 初始化
onMounted(() => {
  loadEssays()
  // Load statistics after essays are loaded
  setTimeout(() => loadStatistics(), 500)
})
</script>

<style scoped>
.history-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 28px;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 筛选面板 */
.filter-panel {
  margin-bottom: 20px;
  padding: 16px;
}

/* 统计分析区域 */
.statistics-section {
  margin-bottom: 20px;
  padding: 24px;
}

.statistics-section .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.statistics-section h2 {
  font-size: 20px;
  color: var(--text-primary);
  margin: 0;
}

.range-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-selector label {
  font-size: 14px;
  color: var(--text-secondary);
}

.range-selector select {
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 1000px) {
  .stat-grid {
    grid-template-columns: 1fr;
  }
}

.stat-chart,
.stat-comparison {
  padding: 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.stat-chart h3,
.stat-comparison h3 {
  font-size: 16px;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.empty-chart,
.empty-comparison,
.statistics-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.comparison-table th,
.comparison-table td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.comparison-table th {
  background: var(--bg-light);
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 13px;
}

.comparison-table td {
  font-size: 14px;
  color: var(--text-primary);
}

.comparison-table td.positive {
  color: #4CAF50;
  font-weight: 600;
}

.comparison-table td.negative {
  color: #F44336;
  font-weight: 600;
}

.comparison-table td.neutral {
  color: var(--text-muted);
}

.stat-summary {
  padding: 16px;
  background: white;
  border-radius: var(--border-radius);
  border: 1px solid var(--border-color);
}

.stat-summary p {
  margin: 8px 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.stat-summary strong {
  color: var(--text-primary);
}

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.filter-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-item label {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
}

.filter-item select,
.filter-item input[type="date"],
.filter-item input[type="number"] {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
}

.date-range,
.score-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-range input,
.score-range input {
  flex: 1;
}

.search-row {
  margin-top: 12px;
}

.search-input {
  width: 100%;
  padding: 10px 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
}

.search-input:disabled {
  background: var(--bg-light);
  color: var(--text-muted);
  cursor: not-allowed;
  opacity: 0.6;
}

/* 批量操作栏 */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 20px;
  background: #FFF3CD;
  border-color: #FFECB5;
}

.selection-count {
  flex: 1;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

/* 列表 */
.essay-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.essay-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  transition: box-shadow 0.2s;
}

.essay-item:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.essay-checkbox {
  flex-shrink: 0;
}

.essay-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.essay-content {
  flex: 1;
  cursor: pointer;
}

.essay-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.task-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.task-badge.task1 {
  background: #E3F2FD;
  color: #1976D2;
}

.task-badge.task2 {
  background: #F3E5F5;
  color: #7B1FA2;
}

.essay-date {
  font-size: 13px;
  color: var(--text-muted);
}

.essay-title {
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: 8px;
  line-height: 1.4;
}

.essay-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

.stat-item {
  color: var(--text-secondary);
}

.stat-item.score {
  font-weight: 600;
}

.stat-item.score.high {
  color: #4CAF50;
}

.stat-item.score.medium {
  color: #FF9800;
}

.stat-item.score.low {
  color: #F44336;
}

.essay-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* 空状态 */
.empty-state,
.error-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-state button,
.error-state button {
  margin-top: 16px;
}

.loading {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

/* 分页 */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
}

.page-info {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 详情弹窗 */
.detail-modal {
  max-width: 1200px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.detail-left,
.detail-right {
  min-height: 400px;
}

.section-header {
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
  font-size: 16px;
}

.essay-text {
  background: var(--bg-light);
  padding: 16px;
  border-radius: var(--border-radius);
  line-height: 1.8;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 12px;
  color: var(--text-muted);
}

.total-score {
  text-align: center;
  padding: 32px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: var(--border-radius);
  margin-bottom: 20px;
}

.total-score .score-value {
  font-size: 48px;
  font-weight: 700;
  margin-bottom: 8px;
}

.total-score .score-label {
  font-size: 16px;
  opacity: 0.9;
}

.score-breakdown {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.score-item .score-name {
  font-size: 14px;
  color: var(--text-secondary);
}

.score-item .score-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--primary-color);
}
</style>
