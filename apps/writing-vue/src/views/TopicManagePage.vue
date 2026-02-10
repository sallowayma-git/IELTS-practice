<template>
  <div class="topic-manage-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h2 class="page-title">
          <span class="icon">📚</span> 
          题目管理
          <span class="count-badge" v-if="total > 0">{{ total }}</span>
        </h2>
        <p class="page-subtitle">管理所有的写作题目，支持 Task 1 图表与 Task 2 话题</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary glass-btn" @click="showImportDialog = true">
          <span class="icon">📥</span> 批量导入
        </button>
        <button class="btn btn-primary" @click="openEditor()">
          <span class="icon">➕</span> 添加题目
        </button>
      </div>
    </div>

    <!-- 筛选工具栏 (Glass Toolbar) -->
    <div class="filter-toolbar card">
      <div class="filter-group">
        <div class="filter-item">
          <span class="filter-icon">🎯</span>
          <select v-model="filters.type" class="glass-select">
            <option value="">全部类型</option>
            <option value="task1">Task 1 (小作文)</option>
            <option value="task2">Task 2 (大作文)</option>
          </select>
        </div>

        <div class="filter-item">
          <span class="filter-icon">🏷️</span>
          <select v-model="filters.category" class="glass-select">
            <option value="">全部分类</option>
            <optgroup v-if="!filters.type || filters.type === 'task1'" label="Task 1">
              <option value="bar_chart">柱状图</option>
              <option value="pie_chart">饼图</option>
              <option value="line_chart">折线图</option>
              <option value="flow_chart">流程图</option>
              <option value="map">地图</option>
              <option value="table">表格</option>
              <option value="process">过程</option>
              <option value="mixed">混合图</option>
            </optgroup>
            <optgroup v-if="!filters.type || filters.type === 'task2'" label="Task 2">
              <option value="education">教育</option>
              <option value="technology">科技</option>
              <option value="society">社会</option>
              <option value="environment">环境</option>
              <option value="health">健康</option>
              <option value="culture">文化</option>
              <option value="government">政府</option>
              <option value="economy">经济</option>
            </optgroup>
          </select>
        </div>

        <div class="filter-item">
          <span class="filter-icon">⭐</span>
          <select v-model.number="filters.difficulty" class="glass-select">
            <option :value="0">全部难度</option>
            <option :value="1">⭐ 入门</option>
            <option :value="2">⭐⭐ 基础</option>
            <option :value="3">⭐⭐⭐ 进阶</option>
            <option :value="4">⭐⭐⭐⭐ 挑战</option>
            <option :value="5">⭐⭐⭐⭐⭐ 专家</option>
          </select>
        </div>
      </div>
      
      <button v-if="hasActiveFilters" class="btn-text" @click="resetFilters">
        ✕ 重置筛选
      </button>
    </div>

    <!-- 题目列表 (Grid Layout) -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>正在加载题库...</p>
    </div>
    
    <div v-else-if="topics.length === 0" class="empty-state card">
      <div class="empty-icon">📝</div>
      <h3>暂无题目数据</h3>
      <p>当前筛选条件下没有找到题目，尝试调整筛选或添加新题目</p>
      <button class="btn btn-primary" @click="openEditor()">
        创建第一道题目
      </button>
    </div>

    <div v-else class="topic-grid">
      <div v-for="topic in topics" :key="topic.id" class="topic-card card">
        <!-- 卡片头部 -->
        <div class="card-header">
          <div class="badges">
            <span :class="['badge', topic.type]">
              {{ topic.type === 'task1' ? 'Task 1' : 'Task 2' }}
            </span>
            <span class="category-badge">{{ getCategoryLabel(topic.category) }}</span>
          </div>
          <div class="difficulty">
            {{ '⭐'.repeat(topic.difficulty || 0) }}
          </div>
        </div>

        <!-- 图片预览 (仅 Task 1) -->
        <div v-if="topic.image_url && topic.type === 'task1'" class="topic-image">
          <img :src="topic.image_url" loading="lazy" :alt="topic.category" />
        </div>

        <!-- 题目内容 -->
        <div class="topic-body">
          <div class="topic-title" v-html="renderTitle(topic.title_json)"></div>
        </div>

        <!-- 卡片底部 -->
        <div class="card-footer">
          <span class="usage-info">
            🔥 使用 {{ topic.usage_count || 0 }} 次
          </span>
          <div class="actions">
            <button class="action-btn edit" @click="openEditor(topic)" title="编辑">
              ✏️
            </button>
            <button 
              class="action-btn delete" 
              @click="deleteTopic(topic)" 
              :title="topic.is_official ? '官方题目不可删除' : '删除'"
              :disabled="topic.is_official"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页控件 -->
    <div v-if="total > pagination.limit" class="pagination-glass">
      <button 
        class="page-btn"
        :disabled="pagination.page === 1"
        @click="pagination.page--"
      >
        ← 上一页
      </button>
      <span class="page-info">
        <span class="current">{{ pagination.page }}</span> 
        <span class="sep">/</span> 
        <span class="total">{{ totalPages }}</span>
      </span>
      <button 
        class="page-btn"
        :disabled="pagination.page >= totalPages"
        @click="pagination.page++"
      >
        下一页 →
      </button>
    </div>

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="dialog-overlay" @click.self="closeEditor">
      <!-- (弹窗内容保持原有结构，样式由 main.css 控制) -->
      <div class="dialog card editor-dialog">
        <h3>{{ editingTopic ? '✏️ 编辑题目' : '✨ 添加新题目' }}</h3>
        
        <div class="form-scroll-area">
          <div class="form-group">
            <label>任务类型</label>
            <div class="radio-cards">
              <label class="radio-card" :class="{ active: editorForm.type === 'task1' }">
                <input type="radio" v-model="editorForm.type" value="task1" />
                <span class="radio-icon">📊</span>
                <span class="radio-label">Task 1 (小作文)</span>
              </label>
              <label class="radio-card" :class="{ active: editorForm.type === 'task2' }">
                <input type="radio" v-model="editorForm.type" value="task2" />
                <span class="radio-icon">📝</span>
                <span class="radio-label">Task 2 (大作文)</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group half">
              <label>题目分类</label>
              <select v-model="editorForm.category" required class="select">
                <option value="">请选择分类...</option>
                <optgroup v-if="editorForm.type === 'task1'" label="Task 1 类型">
                  <option value="bar_chart">柱状图</option>
                  <option value="pie_chart">饼图</option>
                  <option value="line_chart">折线图</option>
                  <option value="flow_chart">流程图</option>
                  <option value="map">地图</option>
                  <option value="table">表格</option>
                  <option value="process">过程</option>
                  <option value="mixed">混合图</option>
                </optgroup>
                <optgroup v-if="editorForm.type === 'task2'" label="Task 2 话题">
                  <option value="education">教育</option>
                  <option value="technology">科技</option>
                  <option value="society">社会</option>
                  <option value="environment">环境</option>
                  <option value="health">健康</option>
                  <option value="culture">文化</option>
                  <option value="government">政府</option>
                  <option value="economy">经济</option>
                </optgroup>
              </select>
            </div>

            <div class="form-group half">
              <label>难度等级</label>
              <div class="star-rating">
                <span 
                  v-for="star in 5" 
                  :key="star"
                  class="star"
                  :class="{ active: star <= editorForm.difficulty }"
                  @click="editorForm.difficulty = star"
                >⭐</span>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>题目描述</label>
            <textarea 
              v-model="editorForm.title"
              rows="6"
              placeholder="请输入完整的题目描述..."
              class="textarea"
            ></textarea>
          </div>

          <div v-if="editorForm.type === 'task1'" class="form-group">
            <label>题目图片</label>
            <div class="image-uploader" @click="triggerFileInput" :class="{ 'has-image': editorForm.imagePreview }">
              <div v-if="editorForm.imagePreview" class="preview-container">
                <img :src="editorForm.imagePreview" />
                <button class="remove-btn" @click.stop="removeImage">✕</button>
              </div>
              <div v-else class="upload-placeholder">
                <span class="upload-icon">📷</span>
                <p>点击上传图片 (PNG/JPG)</p>
              </div>
            </div>
            <input 
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              @change="handleFileSelect"
              hidden
            />
          </div>
        </div>

        <div v-if="editorError" class="error-banner">
          ⚠️ {{ editorError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="closeEditor">取消</button>
          <button class="btn btn-primary" @click="saveTopic" :disabled="!isEditorValid">
            {{ editingTopic ? '保存修改' : '立即创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 批量导入弹窗 (保持逻辑，简化样式引用) -->
    <div v-if="showImportDialog" class="dialog-overlay" @click.self="showImportDialog = false">
      <div class="dialog card">
        <h3>📥 批量导入题目</h3>
        <p class="dialog-hint">请上传符合格式要求的 JSON 文件</p>
        
        <div class="file-drop-zone">
          <input 
            type="file"
            accept=".json"
            @change="handleImportFile"
            ref="importFileInput"
          />
          <p>点击选择文件</p>
        </div>

        <div v-if="importPreview" class="import-preview">
          ✅ 即将导入 <strong>{{ importPreview.length }}</strong> 道题目
        </div>

        <div v-if="importError" class="error-banner">
          {{ importError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="showImportDialog = false">取消</button>
          <button class="btn btn-primary" @click="confirmImport" :disabled="!importPreview">
            确认导入
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { topics as topicsApi, upload } from '@/api/client.js'

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
const topicsList = ref([])
const total = ref(0)
const pagination = ref({ page: 1, limit: 12 })
const filters = ref({
  type: '',
  category: '',
  difficulty: 0
})

// 编辑器
const showEditor = ref(false)
const editingTopic = ref(null)
const editorForm = ref({
  type: 'task1',
  category: '',
  difficulty: 3,
  title: '',
  imageFile: null,
  imagePreview: null
})
const editorError = ref('')
const fileInput = ref(null)

// 导入
const showImportDialog = ref(false)
const importPreview = ref(null)
const importError = ref('')
const importFileInput = ref(null)

// 计算属性
const topics = computed(() => topicsList.value)
const totalPages = computed(() => Math.ceil(total.value / pagination.value.limit))

const isEditorValid = computed(() => {
  return editorForm.value.type && 
         editorForm.value.category && 
         editorForm.value.difficulty > 0 && 
         editorForm.value.title.trim().length > 0
})

// 加载题目列表
async function loadTopics() {
  loading.value = true
  try {
    const activeFilters = {}
    if (filters.value.type) activeFilters.type = filters.value.type
    if (filters.value.category) activeFilters.category = filters.value.category
    if (filters.value.difficulty > 0) activeFilters.difficulty = filters.value.difficulty

    const result = await topicsApi.list(activeFilters, pagination.value)
    
    // 批量加载图片 URL（同步化）
    const topicsWithUrls = await Promise.all(
      result.data.map(async (topic) => {
        if (topic.image_path) {
          try {
            topic.image_url = await upload.getImagePath(topic.image_path)
          } catch {
            topic.image_url = null
          }
        } else {
          topic.image_url = null
        }
        return topic
      })
    )
    
    topicsList.value = topicsWithUrls
    total.value = result.total
  } catch (error) {
    console.error('加载题目失败:', error)
    alert('加载题目失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 防抖版本的 loadTopics
const debouncedLoadTopics = debounce(loadTopics, 300)

// 重置筛选
function resetFilters() {
  filters.value = { type: '', category: '', difficulty: 0 }
  pagination.value.page = 1
}

// 打开编辑器
function openEditor(topic = null) {
  editingTopic.value = topic
  if (topic) {
    editorForm.value = {
      type: topic.type,
      category: topic.category,
      difficulty: topic.difficulty,
      title: extractTextFromTiptap(topic.title_json),
      imageFile: null,
      imagePreview: topic.image_url || null
    }
  } else {
    editorForm.value = {
      type: 'task1',
      category: '',
      difficulty: 3,
      title: '',
      imageFile: null,
      imagePreview: null
    }
  }
  showEditor.value = true
  editorError.value = ''
}

function closeEditor() {
  showEditor.value = false
  editingTopic.value = null
}

// 保存题目
async function saveTopic() {
  if (!isEditorValid.value) return

  try {
    // 上传图片（如果有）
    let imagePath = editingTopic.value?.image_path || null
    if (editorForm.value.imageFile) {
      const imageData = await readFileAsArrayBuffer(editorForm.value.imageFile)
      const uploadResult = await upload.uploadImage({
        name: editorForm.value.imageFile.name,
        data: new Uint8Array(imageData),
        type: editorForm.value.imageFile.type
      })
      imagePath = uploadResult.image_path
    }

    // 构建题目数据
    const topicData = {
      type: editorForm.value.type,
      category: editorForm.value.category,
      difficulty: editorForm.value.difficulty,
      title_json: JSON.stringify({
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: editorForm.value.title }]
        }]
      }),
      image_path: imagePath
    }

    if (editingTopic.value) {
      await topicsApi.update(editingTopic.value.id, topicData)
    } else {
      await topicsApi.create(topicData)
    }

    closeEditor()
    await loadTopics()
  } catch (error) {
    console.error('保存题目失败:', error)
    editorError.value = error.message
  }
}

// 删除题目
async function deleteTopic(topic) {
  if (topic.is_official) {
    alert('官方题目不允许删除')
    return
  }

  if (!confirm(`确定删除该题目？关联的历史记录不会被删除。`)) {
    return
  }

  try {
    await topicsApi.delete(topic.id)
    await loadTopics()
  } catch (error) {
    console.error('删除题目失败:', error)
    alert('删除失败: ' + error.message)
  }
}

// 文件选择
function triggerFileInput() {
  fileInput.value?.click()
}

async function handleFileSelect(event) {
  const file = event.target.files[0]
  if (!file) return

  // 验证文件大小
  if (file.size > 5 * 1024 * 1024) {
    alert('图片大小不能超过 5MB')
    return
  }

  // 清理旧的预览 URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }

  editorForm.value.imageFile = file
  editorForm.value.imagePreview = URL.createObjectURL(file)
}

function removeImage() {
  // 清理 URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }
  
  editorForm.value.imageFile = null
  editorForm.value.imagePreview = null
  if (fileInput.value) fileInput.value.value = ''
}

// 批量导入
async function handleImportFile(event) {
  const file = event.target.files[0]
  if (!file) return

  // 限制文件大小（5MB）
  if (file.size > 5 * 1024 * 1024) {
    importError.value = '文件过大，请上传小于 5MB 的文件'
    importPreview.value = null
    return
  }

  try {
    const text = await file.text()
    const data = JSON.parse(text)
    
    if (!Array.isArray(data)) {
      throw new Error('JSON 格式错误：应为数组')
    }

    // 限制条数（最多 500 条）
    if (data.length > 500) {
      throw new Error(`题目数量过多（${data.length} 条），单次最多导入 500 条`)
    }

    importPreview.value = data
    importError.value = ''
  } catch (error) {
    importError.value = '文件解析失败: ' + error.message
    importPreview.value = null
  }
}

async function confirmImport() {
  if (!importPreview.value) return

  try {
    const result = await topicsApi.batchImport(importPreview.value)
    alert(`成功导入 ${result.success} 道题目${result.failed > 0 ? `，失败 ${result.failed} 道` : ''}`)
    showImportDialog.value = false
    importPreview.value = null
    await loadTopics()
  } catch (error) {
    importError.value = '导入失败: ' + error.message
  }
}

// 工具函数
function getCategoryLabel(category) {
  const labels = {
    bar_chart: '柱状图', pie_chart: '饼图', line_chart: '折线图',
    flow_chart: '流程图', map: '地图', table: '表格', process: '过程', mixed: '混合图',
    education: '教育', technology: '科技', society: '社会', environment: '环境',
    health: '健康', culture: '文化', government: '政府', economy: '经济'
  }
  return labels[category] || category
}

function renderTitle(titleJson) {
  try {
    const parsed = typeof titleJson === 'string' ? JSON.parse(titleJson) : titleJson
    return extractTextFromTiptap(parsed)
  } catch {
    return titleJson
  }
}

// 简化的 Tiptap JSON 文本提取（仅用于预览，不保留完整格式）
function extractTextFromTiptap(json) {
  if (typeof json === 'string') {
    try {
      json = JSON.parse(json)
    } catch {
      return json
    }
  }
  
  if (json.type === 'text') return json.text || ''
  if (json.content && Array.isArray(json.content)) {
    return json.content.map(extractTextFromTiptap).join('')
  }
  return ''
}



function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

// 监听筛选和分页变化（防抖）
watch(filters, () => {
  pagination.value.page = 1 // 重置到第一页
  debouncedLoadTopics()
}, { deep: true })

watch(() => pagination.value.page, () => {
  loadTopics() // 分页立即加载
})

// 初始化
onMounted(() => {
  loadTopics()
})

// 清理
onBeforeUnmount(() => {
  // 清理可能残留的 blob URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }
})
</script>

<style scoped>
/* 页面容器 */
.topic-manage-page {
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 头部区域 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
}

.page-title {
  font-size: 2rem;
  font-weight: 800;
  color: #fff; /* 在深色背景上使用白色 */
  text-shadow: 0 2px 4px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.page-subtitle {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
}

.count-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.9rem;
  vertical-align: middle;
}

.header-actions {
  display: flex;
  gap: 16px;
}

.glass-btn {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.glass-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
}

/* 筛选工具栏 (HeroUI Capsular Style) */
.filter-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  margin-bottom: 32px;
  background: rgba(255, 255, 255, 0.65) !important; /* 更通透的背景 */
  border-radius: 999px !important; /* 胶囊形全圆角 */
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 10px 30px -10px rgba(0,0,0,0.1); /* 浮起感 */
  backdrop-filter: blur(24px) saturate(120%);
  max-width: fit-content;
  min-width: 800px;
  margin-left: auto;
  margin-right: auto;
}

.filter-group {
  display: flex;
  gap: 12px;
}

.filter-item {
  position: relative;
  display: flex;
  align-items: center;
}

.filter-icon {
  display: none; /* HeroUI 风格通常隐藏图标，追求简洁 */
}

.glass-select {
  appearance: none;
  padding: 8px 36px 8px 16px;
  border: 1px solid transparent; /* 移除默认边框 */
  border-radius: 999px; /* 内部也是胶囊形 */
  background: rgba(255, 255, 255, 0.5) url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E") no-repeat right 12px center;
  background-size: 10px;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  min-width: 140px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.03);
}

.glass-select:hover {
  background-color: rgba(255, 255, 255, 0.85);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.glass-select:focus {
  background-color: white;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25);
  outline: none;
}

.btn-text {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.9rem;
  transition: all 0.2s;
}

.btn-text:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger-color);
}

/* 题目 Grid */
.topic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 24px;
  margin-bottom: 40px;
}

.topic-card {
  display: flex;
  flex-direction: column;
  padding: 0; /* 重置 padding，由内部元素控制 */
  overflow: hidden;
  height: 100%;
}

.card-header {
  padding: 20px 20px 12px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 12px;
  text-transform: uppercase;
}

.badge.task1 { background: #e0f2fe; color: #0284c7; }
.badge.task2 { background: #f3e8ff; color: #9333ea; }

.category-badge {
  font-size: 0.75rem;
  color: var(--text-muted);
  background: rgba(0,0,0,0.03);
  padding: 4px 8px;
  border-radius: 6px;
}

.difficulty {
  color: #fbbf24;
  font-size: 0.9rem;
  letter-spacing: 2px;
}

.topic-image {
  height: 160px;
  overflow: hidden;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}

.topic-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s;
}

.topic-card:hover .topic-image img {
  transform: scale(1.05);
}

.topic-body {
  padding: 16px 20px;
  flex: 1;
}

.topic-title {
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  padding: 16px 20px;
  border-top: 1px solid rgba(0,0,0,0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(250, 250, 250, 0.5);
}

.usage-info {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  background: white;
  border: 1px solid rgba(0,0,0,0.1);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.action-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.action-btn.edit:hover { background: #eff6ff; border-color: #3b82f6; }
.action-btn.delete:hover { background: #fef2f2; border-color: #ef4444; }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 分页控件 */
.pagination-glass {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  padding: 24px;
}

.page-btn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  color: white;
  font-size: 1rem;
  font-weight: 500;
}

/* 编辑器特定样式 */
.editor-dialog {
  display: flex;
  flex-direction: column;
}

.form-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
  margin: -4px -8px -4px 0; /* 调整滚动条间距 */
}

.radio-cards {
  display: flex;
  gap: 16px;
}

.radio-card {
  flex: 1;
  border: 2px solid transparent;
  background: rgba(0,0,0,0.03);
  padding: 16px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.radio-card input { position: absolute; opacity: 0; }

.radio-card.active {
  background: #eff6ff;
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.radio-icon { font-size: 1.5rem; }
.radio-label { font-weight: 600; font-size: 0.95rem; }

.form-row {
  display: flex;
  gap: 20px;
}

.form-group.half { flex: 1; }

.star-rating {
  display: flex;
  gap: 4px;
  font-size: 1.5rem;
  cursor: pointer;
}

.star {
  opacity: 0.3;
  transition: transform 0.2s;
}
.star:hover { transform: scale(1.2); }
.star.active { opacity: 1; }

.image-uploader {
  border: 2px dashed #ddd;
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #fafafa;
}

.image-uploader:hover {
  border-color: var(--primary-color);
  background: #f0f4ff;
}

.upload-icon { font-size: 2rem; display: block; margin-bottom: 8px; }

.preview-container {
  position: relative;
  display: inline-block;
}

.preview-container img {
  max-height: 200px;
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.remove-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.error-banner {
  background: #fef2f2;
  color: #ef4444;
  padding: 12px;
  border-radius: 8px;
  margin-top: 16px;
  border: 1px solid #fecaca;
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-drop-zone {
  border: 2px dashed #cbd5e1;
  padding: 40px;
  text-align: center;
  border-radius: 12px;
  background: #f8fafc;
  cursor: pointer;
  position: relative;
  margin-bottom: 16px;
}
.file-drop-zone input {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0;
  cursor: pointer;
}

.import-preview {
  background: #f0fdf4;
  color: #15803d;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  margin-bottom: 16px;
  border: 1px solid #bbf7d0;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 60px;
  background: rgba(255,255,255,0.5);
  border-radius: 16px;
  color: white;
}
.empty-icon { font-size: 3rem; margin-bottom: 16px; }

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
