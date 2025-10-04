<template>
  <div class="question-bank-manager">
    <!-- 题库状态面板 -->
    <el-card class="status-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <h3>题库状态</h3>
          <el-button
            @click="refreshStatus"
            :loading="statusLoading"
            :icon="Refresh"
            circle
            size="small"
          />
        </div>
      </template>

      <div class="status-content">
        <div class="status-overview">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-statistic
                title="总题目数"
                :value="statistics.totalQuestions"
                :value-style="{ color: '#409EFF' }"
              />
            </el-col>
            <el-col :span="6">
              <el-statistic
                title="题目分类"
                :value="Object.keys(statistics.categories).length"
                :value-style="{ color: '#67C23A' }"
              />
            </el-col>
            <el-col :span="6">
              <el-statistic
                title="标签数量"
                :value="Object.keys(statistics.tags).length"
                :value-style="{ color: '#E6A23C' }"
              />
            </el-col>
            <el-col :span="6">
              <el-statistic
                title="最后更新"
                :value="formatDate(statistics.lastUpdated)"
                :value-style="{ color: '#909399' }"
              />
            </el-col>
          </el-row>
        </div>

        <div class="status-actions">
          <el-button-group>
            <el-button
              @click="showImportDialog"
              :icon="FolderAdd"
              type="primary"
            >
              导入题库
            </el-button>
            <el-button
              @click="refreshIndex"
              :loading="refreshLoading"
              :icon="Refresh"
            >
              刷新索引
            </el-button>
            <el-button
              @click="createBackup"
              :icon="Download"
            >
              创建备份
            </el-button>
            <el-button
              @click="validateIntegrity"
              :loading="validateLoading"
              :icon="CircleCheck"
            >
              验证完整性
            </el-button>
          </el-button-group>
        </div>
      </div>
    </el-card>

    <!-- 题目浏览面板 -->
    <el-card class="browser-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <h3>题目浏览</h3>
          <div class="search-controls">
            <el-input
              v-model="searchQuery"
              placeholder="搜索题目..."
              :prefix-icon="Search"
              clearable
              @input="handleSearch"
              style="width: 250px; margin-right: 10px;"
            />
            <el-select
              v-model="selectedCategory"
              placeholder="选择分类"
              clearable
              @change="handleCategoryChange"
              style="width: 150px; margin-right: 10px;"
            >
              <el-option
                v-for="category in categories"
                :key="category.value"
                :label="category.label"
                :value="category.value"
              />
            </el-select>
            <el-select
              v-model="selectedDifficulty"
              placeholder="选择难度"
              clearable
              @change="handleDifficultyChange"
              style="width: 120px;"
            >
              <el-option label="简单" value="easy" />
              <el-option label="中等" value="medium" />
              <el-option label="困难" value="hard" />
            </el-select>
          </div>
        </div>
      </template>

      <div class="questions-content">
        <!-- 题目列表 -->
        <div class="questions-list">
          <el-empty v-if="questions.length === 0 && !loading" description="暂无题目" />

          <div
            v-for="question in questions"
            :key="question.id"
            class="question-item"
            @click="selectQuestion(question)"
          >
            <div class="question-header">
              <h4 class="question-title">{{ question.title }}</h4>
              <div class="question-meta">
                <el-tag :type="getDifficultyTagType(question.difficulty)" size="small">
                  {{ getDifficultyText(question.difficulty) }}
                </el-tag>
                <el-tag type="info" size="small">{{ getCategoryText(question.category) }}</el-tag>
                <span class="word-count">{{ question.wordCount }}字</span>
              </div>
            </div>
            <div class="question-content">
              {{ question.content.substring(0, 150) }}{{ question.content.length > 150 ? '...' : '' }}
            </div>
            <div class="question-footer">
              <div class="tags" v-if="question.tags.length > 0">
                <el-tag
                  v-for="tag in question.tags.slice(0, 3)"
                  :key="tag"
                  size="small"
                  effect="plain"
                >
                  {{ tag }}
                </el-tag>
                <span v-if="question.tags.length > 3" class="more-tags">+{{ question.tags.length - 3 }}</span>
              </div>
              <span class="date">{{ formatDate(question.indexedAt) }}</span>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pagination-wrapper" v-if="total > 0">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handlePageChange"
          />
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="loading-container">
          <el-skeleton :rows="5" animated />
        </div>
      </div>
    </el-card>

    <!-- 题目详情对话框 -->
    <el-dialog
      v-model="showDetailDialog"
      title="题目详情"
      width="60%"
      destroy-on-close
    >
      <div v-if="selectedQuestion" class="question-detail">
        <div class="detail-header">
          <h3>{{ selectedQuestion.title }}</h3>
          <div class="detail-meta">
            <el-tag :type="getDifficultyTagType(selectedQuestion.difficulty)">
              {{ getDifficultyText(selectedQuestion.difficulty) }}
            </el-tag>
            <el-tag type="info">{{ getCategoryText(selectedQuestion.category) }}</el-tag>
            <span class="word-count">{{ selectedQuestion.wordCount }}字</span>
          </div>
        </div>

        <div class="detail-content">
          <h4>题目内容</h4>
          <div class="content-text">{{ selectedQuestion.content }}</div>
        </div>

        <div class="detail-tags" v-if="selectedQuestion.tags.length > 0">
          <h4>标签</h4>
          <div class="tags-list">
            <el-tag
              v-for="tag in selectedQuestion.tags"
              :key="tag"
              class="tag-item"
            >
              {{ tag }}
            </el-tag>
          </div>
        </div>

        <div class="detail-info">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="题目ID">
              <code>{{ selectedQuestion.id }}</code>
            </el-descriptions-item>
            <el-descriptions-item label="来源文件">
              {{ selectedQuestion.sourceFile }}
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">
              {{ formatDate(selectedQuestion.createdAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="索引时间">
              {{ formatDate(selectedQuestion.indexedAt) }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </div>
    </el-dialog>

    <!-- 导入对话框 -->
    <el-dialog
      v-model="showImportDialog"
      title="导入题库"
      width="50%"
      destroy-on-close
    >
      <div class="import-content">
        <el-alert
          title="导入说明"
          type="info"
          :closable="false"
          style="margin-bottom: 20px;"
        >
          <p>请选择包含题库文件的目录。系统将自动扫描并导入以下格式的文件：</p>
          <ul>
            <li>JSON (.json)</li>
            <li>文本 (.txt)</li>
            <li>Markdown (.md)</li>
            <li>CSV (.csv)</li>
          </ul>
          <p>建议按类别组织文件，如 writing/、listening/、reading/ 等。</p>
        </el-alert>

        <div class="import-actions">
          <el-button
            @click="selectDirectory"
            :icon="Folder"
            type="primary"
            :loading="importing"
          >
            选择题库目录
          </el-button>
        </div>

        <div v-if="selectedDirectory" class="selected-directory">
          <p><strong>选择的目录：</strong>{{ selectedDirectory }}</p>
        </div>
      </div>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button
          @click="startImport"
          type="primary"
          :disabled="!selectedDirectory || importing"
          :loading="importing"
        >
          开始导入
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入进度对话框 -->
    <el-dialog
      v-model="showProgressDialog"
      title="导入进度"
      width="50%"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="progress-content">
        <el-progress
          :percentage="importProgress.progress"
          :status="importProgress.status === 'completed' ? 'success' : importProgress.status === 'failed' ? 'exception' : ''"
        />

        <div class="progress-info">
          <p><strong>当前文件：</strong>{{ importProgress.currentFile || '准备中...' }}</p>
          <p><strong>已处理：</strong>{{ importProgress.processedFiles }} / {{ importProgress.totalFiles }}</p>
          <p><strong>已导入：</strong>{{ importProgress.importedQuestions }} 道题目</p>
          <p><strong>已跳过：</strong>{{ importProgress.skippedQuestions }} 道题目</p>
        </div>

        <div v-if="importProgress.errors.length > 0" class="progress-errors">
          <el-alert
            title="发现错误"
            type="warning"
            :closable="false"
          >
            <ul>
              <li v-for="error in importProgress.errors.slice(0, 3)" :key="error.file">
                {{ error.file }}: {{ error.error }}
              </li>
              <li v-if="importProgress.errors.length > 3">
                ... 还有 {{ importProgress.errors.length - 3 }} 个错误
              </li>
            </ul>
          </el-alert>
        </div>
      </div>

      <template #footer>
        <el-button
          @click="showProgressDialog = false"
          :disabled="importing"
        >
          {{ importProgress.status === 'completed' ? '完成' : '取消' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Refresh, FolderAdd, Download, CircleCheck, Folder, Search
} from '@element-plus/icons-vue'

// 响应式数据
const loading = ref(false)
const statusLoading = ref(false)
const refreshLoading = ref(false)
const validateLoading = ref(false)
const importing = ref(false)

const statistics = reactive({
  totalQuestions: 0,
  categories: {},
  tags: {},
  lastUpdated: null
})

const questions = ref([])
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(50)

const searchQuery = ref('')
const selectedCategory = ref('')
const selectedDifficulty = ref('')

const categories = ref([
  { value: 'writing-task1', label: '写作任务1' },
  { value: 'writing-task2', label: '写作任务2' },
  { value: 'listening', label: '听力' },
  { value: 'reading', label: '阅读' },
  { value: 'vocabulary', label: '词汇' }
])

// 对话框状态
const showDetailDialog = ref(false)
const showImportDialog = ref(false)
const showProgressDialog = ref(false)
const selectedQuestion = ref(null)
const selectedDirectory = ref('')
const importProgress = reactive({
  id: null,
  status: '',
  progress: 0,
  totalFiles: 0,
  processedFiles: 0,
  currentFile: '',
  importedQuestions: 0,
  skippedQuestions: 0,
  errors: []
})

// 生命周期
onMounted(async () => {
  await initializeQuestionBank()
  setupEventListeners()
  await loadStatistics()
  await loadQuestions()
})

onUnmounted(() => {
  removeEventListeners()
})

// 方法
async function initializeQuestionBank() {
  try {
    await window.electronAPI.questionBank.initialize()
    console.log('✅ 题库管理器初始化成功')
  } catch (error) {
    console.error('❌ 题库管理器初始化失败:', error)
    ElMessage.error('题库管理器初始化失败')
  }
}

async function loadStatistics() {
  try {
    const stats = await window.electronAPI.questionBank.getStatistics()
    Object.assign(statistics, stats)
  } catch (error) {
    console.error('加载统计信息失败:', error)
  }
}

async function loadQuestions() {
  if (!window.electronAPI) return

  loading.value = true
  try {
    const options = {
      limit: pageSize.value,
      offset: (currentPage.value - 1) * pageSize.value
    }

    if (searchQuery.value) {
      options.search = searchQuery.value
    }

    if (selectedCategory.value) {
      options.category = selectedCategory.value
    }

    if (selectedDifficulty.value) {
      options.difficulty = selectedDifficulty.value
    }

    const result = await window.electronAPI.questionBank.getQuestions(options)
    questions.value = result.questions
    total.value = result.total
  } catch (error) {
    console.error('加载题目失败:', error)
    ElMessage.error('加载题目失败')
  } finally {
    loading.value = false
  }
}

async function refreshStatus() {
  statusLoading.value = true
  try {
    await loadStatistics()
    ElMessage.success('状态刷新成功')
  } catch (error) {
    ElMessage.error('状态刷新失败')
  } finally {
    statusLoading.value = false
  }
}

async function refreshIndex() {
  refreshLoading.value = true
  try {
    const result = await window.electronAPI.questionBank.refreshIndex()
    if (result.success) {
      await loadStatistics()
      await loadQuestions()
      ElMessage.success('索引刷新成功')
    } else {
      ElMessage.error(`索引刷新失败: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error('索引刷新失败')
  } finally {
    refreshLoading.value = false
  }
}

async function createBackup() {
  try {
    const result = await window.electronAPI.questionBank.createBackup()
    if (result.success) {
      ElMessage.success('备份创建成功')
    } else {
      ElMessage.error(`备份创建失败: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error('备份创建失败')
  }
}

async function validateIntegrity() {
  validateLoading.value = true
  try {
    const result = await window.electronAPI.questionBank.validateIntegrity()
    if (result.valid) {
      ElMessage.success('题库完整性验证通过')
    } else {
      ElMessage.error(`完整性验证失败: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error('完整性验证失败')
  } finally {
    validateLoading.value = false
  }
}

function showImportDialog() {
  selectedDirectory.value = ''
  showImportDialog.value = true
}

async function selectDirectory() {
  try {
    const result = await window.electronAPI.questionBank.selectDirectory()
    if (!result.canceled) {
      selectedDirectory.value = result.selectedPath
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}

async function startImport() {
  if (!selectedDirectory.value) {
    ElMessage.warning('请先选择题库目录')
    return
  }

  importing.value = true
  showImportDialog.value = false
  showProgressDialog.value = true

  try {
    const result = await window.electronAPI.questionBank.import(selectedDirectory.value)
    if (result.success) {
      Object.assign(importProgress, result.result)

      if (importProgress.status === 'completed') {
        ElMessage.success(`题库导入成功！共导入 ${importProgress.importedQuestions} 道题目`)
        await loadStatistics()
        await loadQuestions()
      }
    } else {
      ElMessage.error(`题库导入失败: ${result.error}`)
    }
  } catch (error) {
    ElMessage.error('题库导入失败')
  } finally {
    importing.value = false
  }
}

function handleSearch() {
  currentPage.value = 1
  loadQuestions()
}

function handleCategoryChange() {
  currentPage.value = 1
  loadQuestions()
}

function handleDifficultyChange() {
  currentPage.value = 1
  loadQuestions()
}

function handlePageChange() {
  loadQuestions()
}

function handleSizeChange() {
  currentPage.value = 1
  loadQuestions()
}

function selectQuestion(question) {
  selectedQuestion.value = question
  showDetailDialog.value = true
}

// 事件监听器
let eventListeners = []

function setupEventListeners() {
  const events = [
    'import-started',
    'import-progress',
    'import-completed',
    'import-failed'
  ]

  for (const event of events) {
    const listener = (data) => {
      if (event === 'import-progress') {
        Object.assign(importProgress, data)
      }
    }

    window.electronAPI.questionBank.on(event, listener)
    eventListeners.push({ event, listener })
  }
}

function removeEventListeners() {
  for (const { event, listener } of eventListeners) {
    window.electronAPI.questionBank.off(event, listener)
  }
  eventListeners = []
}

// 工具方法
function formatDate(dateString) {
  if (!dateString) return '未知'
  return new Date(dateString).toLocaleDateString()
}

function getDifficultyTagType(difficulty) {
  const types = {
    easy: 'success',
    medium: 'warning',
    hard: 'danger'
  }
  return types[difficulty] || 'info'
}

function getDifficultyText(difficulty) {
  const texts = {
    easy: '简单',
    medium: '中等',
    hard: '困难'
  }
  return texts[difficulty] || '未知'
}

function getCategoryText(category) {
  const texts = {
    'writing-task1': '写作任务1',
    'writing-task2': '写作任务2',
    'listening': '听力',
    'reading': '阅读',
    'vocabulary': '词汇'
  }
  return texts[category] || category
}
</script>

<style scoped>
.question-bank-manager {
  padding: 20px;
  background: #f5f7fa;
  min-height: 100vh;
}

.status-card,
.browser-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  color: #303133;
}

.status-content {
  padding: 10px 0;
}

.status-overview {
  margin-bottom: 20px;
}

.status-actions {
  display: flex;
  justify-content: center;
}

.questions-content {
  min-height: 400px;
}

.question-item {
  background: white;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.question-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
  transform: translateY(-1px);
}

.question-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.question-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}

.question-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.word-count {
  font-size: 12px;
  color: #909399;
}

.question-content {
  color: #606266;
  line-height: 1.6;
  margin-bottom: 12px;
}

.question-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #909399;
}

.tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.more-tags {
  color: #909399;
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.loading-container {
  padding: 20px;
}

.question-detail {
  padding: 10px 0;
}

.detail-header {
  margin-bottom: 20px;
}

.detail-header h3 {
  margin: 0 0 10px 0;
  color: #303133;
}

.detail-meta {
  display: flex;
  gap: 8px;
}

.detail-content h4 {
  margin: 20px 0 10px 0;
  color: #303133;
}

.content-text {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.8;
  white-space: pre-wrap;
}

.detail-tags h4 {
  margin: 20px 0 10px 0;
  color: #303133;
}

.tags-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tag-item {
  margin: 0;
}

.detail-info {
  margin-top: 20px;
}

.import-content {
  padding: 10px 0;
}

.import-actions {
  display: flex;
  justify-content: center;
  margin: 20px 0;
}

.selected-directory {
  margin-top: 20px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.progress-content {
  padding: 10px 0;
}

.progress-info {
  margin-top: 20px;
}

.progress-info p {
  margin: 8px 0;
}

.progress-errors {
  margin-top: 20px;
}

.search-controls {
  display: flex;
  align-items: center;
}
</style>