<template>
  <div class="question-bank-panel">
    <el-card class="stats-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <h3>题库概览</h3>
            <p class="card-subtitle">导入、统计与最近更新</p>
          </div>
          <div class="card-actions">
            <el-button :icon="Refresh" circle :loading="loading" @click="refresh" />
            <el-button type="primary" :icon="FolderAdd" @click="triggerUpload" :loading="uploading">
              导入题库
            </el-button>
          </div>
        </div>
      </template>

      <el-descriptions :column="2" border size="small" class="stats-table">
        <el-descriptions-item label="题目总数">
          <strong>{{ stats.total }}</strong>
        </el-descriptions-item>
        <el-descriptions-item label="最近更新">
          {{ stats.lastUpdated ? formatDate(stats.lastUpdated) : '暂无数据' }}
        </el-descriptions-item>
        <el-descriptions-item label="Task 1 题目">
          {{ stats.byType['Task 1'] || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="Task 2 题目">
          {{ stats.byType['Task 2'] || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="简单题">
          {{ stats.byDifficulty.easy || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="中等题">
          {{ stats.byDifficulty.medium || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="困难题">
          {{ stats.byDifficulty.hard || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="最近导入结果" v-if="importSummary">
          新增 {{ importSummary.inserted }}，更新 {{ importSummary.updated }}，跳过 {{ importSummary.skipped }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card class="list-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <h3>最新题目</h3>
            <p class="card-subtitle">显示最近导入的 15 道题目</p>
          </div>
        </div>
      </template>

      <el-table :data="topics" v-loading="loading" size="small">
        <el-table-column type="index" label="#" width="50" />
        <el-table-column prop="title" label="题目" min-width="220" />
        <el-table-column prop="type" label="类型" width="90" />
        <el-table-column prop="difficulty" label="难度" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="difficultyTag(row.difficulty)">
              {{ difficultyText(row.difficulty) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="min_words" label="最低字数" width="100" />
        <el-table-column prop="time_limit" label="建议用时 (秒)" width="140" />
      </el-table>
    </el-card>

    <input
      ref="fileInput"
      type="file"
      accept=".csv"
      class="hidden-input"
      @change="handleFileChange"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderAdd, Refresh } from '@element-plus/icons-vue'

const stats = ref({
  total: 0,
  byType: {},
  byDifficulty: {},
  lastUpdated: null
})
const topics = ref([])
const loading = ref(false)
const uploading = ref(false)
const fileInput = ref(null)
const importSummary = ref(null)

const fetchStats = async () => {
  const response = await fetch('/api/writing/topics/statistics')
  if (!response.ok) throw new Error('获取题库统计失败')
  const data = await response.json()
  if (!data.success) throw new Error(data.message || '获取题库统计失败')
  const payload = data.data || {}
  stats.value = {
    total: payload.total || 0,
    byType: arrayToMap(payload.byType, 'type', 'count'),
    byDifficulty: arrayToMap(payload.byDifficulty, 'difficulty', 'count'),
    lastUpdated: payload.lastUpdated || null
  }
}

const fetchTopics = async () => {
  const response = await fetch('/api/writing/topics?limit=15')
  if (!response.ok) throw new Error('获取题目失败')
  const data = await response.json()
  if (!data.success) throw new Error(data.message || '获取题目失败')
  topics.value = data.data || []
}

const refresh = async () => {
  loading.value = true
  try {
    await Promise.all([fetchStats(), fetchTopics()])
  } catch (error) {
    console.error(error)
    ElMessage.error(error.message || '刷新失败')
  } finally {
    loading.value = false
  }
}

const triggerUpload = () => {
  fileInput.value?.click()
}

const handleFileChange = async (event) => {
  const [file] = event.target.files || []
  if (!file) return

  try {
    const text = await readFileAsText(file)
    await importCsv(text)
  } catch (error) {
    console.error(error)
    ElMessage.error(error.message || '导入题库失败')
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}

const importCsv = async (csvText) => {
  uploading.value = true
  const response = await fetch('/api/writing/topics/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: csvText })
  })

  if (!response.ok) throw new Error('导入题库失败')
  const data = await response.json()
  if (!data.success) throw new Error(data.message || '导入题库失败')

  importSummary.value = data.data
  ElMessage.success(data.message || '题库导入成功')
  await refresh()
}

const readFileAsText = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file)
  })
}

const difficultyTag = (value) => {
  switch ((value || '').toLowerCase()) {
    case 'easy':
      return 'success'
    case 'hard':
      return 'danger'
    default:
      return 'info'
  }
}

const difficultyText = (value) => {
  switch ((value || '').toLowerCase()) {
    case 'easy':
      return '简单'
    case 'hard':
      return '困难'
    case 'medium':
      return '中等'
    default:
      return value || '未知'
  }
}

const formatDate = (value) => {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN')
}

const arrayToMap = (arr = [], keyField, valueField) => {
  if (!Array.isArray(arr)) return {}
  return arr.reduce((acc, item) => {
    const key = item?.[keyField]
    if (key) {
      acc[key] = item?.[valueField] ?? 0
    }
    return acc
  }, {})
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.question-bank-panel {
  display: grid;
  gap: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 18px;
  color: #303133;
}

.card-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.stats-card {
  border-radius: 16px;
}

.stats-table {
  margin-top: 8px;
}

.list-card {
  border-radius: 16px;
}

.hidden-input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}
</style>
