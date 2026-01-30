<template>
  <div class="topic-manage-page">
    <div class="page-header">
      <h1>📚 题目管理</h1>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="showImportDialog = true">
          📥 批量导入
        </button>
        <button class="btn btn-primary" @click="openEditor()">
          ➕ 添加题目
        </button>
      </div>
    </div>

    <!-- 筛选面板 -->
    <div class="filter-panel card">
      <div class="filter-row">
        <div class="filter-item">
          <label>任务类型</label>
          <select v-model="filters.type">
            <option value="">全部</option>
            <option value="task1">Task 1</option>
            <option value="task2">Task 2</option>
          </select>
        </div>

        <div class="filter-item">
          <label>分类</label>
          <select v-model="filters.category">
            <option value="">全部</option>
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
          <label>难度</label>
          <select v-model.number="filters.difficulty">
            <option :value="0">全部</option>
            <option :value="1">⭐</option>
            <option :value="2">⭐⭐</option>
            <option :value="3">⭐⭐⭐</option>
            <option :value="4">⭐⭐⭐⭐</option>
            <option :value="5">⭐⭐⭐⭐⭐</option>
          </select>
        </div>

        <button class="btn btn-secondary" @click="resetFilters">重置筛选</button>
      </div>
    </div>

    <!-- 题目列表 -->
    <div v-if="loading" class="loading">加载中...</div>
    
    <div v-else-if="topics.length === 0" class="empty-state card">
      <p>📝 暂无题目，点击右上角"添加题目"开始创建</p>
    </div>

    <div v-else class="topic-grid">
      <div v-for="topic in topics" :key="topic.id" class="topic-card card">
        <div class="topic-header">
          <span :class="['topic-type-badge', topic.type]">
            {{ topic.type === 'task1' ? 'Task 1' : 'Task 2' }}
          </span>
          <span class="topic-difficulty">
            {{ '⭐'.repeat(topic.difficulty || 0) }}
          </span>
        </div>

        <div v-if="topic.image_url && topic.type === 'task1'" class="topic-image">
          <img :src="topic.image_url" :alt="topic.category" />
        </div>

        <div class="topic-content">
          <div class="topic-category">{{ getCategoryLabel(topic.category) }}</div>
          <div class="topic-title" v-html="renderTitle(topic.title_json)"></div>
        </div>

        <div class="topic-footer">
          <span class="usage-count">使用 {{ topic.usage_count || 0 }} 次</span>
          <div class="topic-actions">
            <button class="btn-icon" @click="openEditor(topic)" title="编辑">✏️</button>
            <button 
              class="btn-icon" 
              @click="deleteTopic(topic)" 
              :title="topic.is_official ? '官方题目不可删除' : '删除'"
              :disabled="topic.is_official"
              :style="{ opacity: topic.is_official ? 0.3 : 1 }"
            >
              🗑️
            </button>
          </div>
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

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="dialog-overlay" @click.self="closeEditor">
      <div class="dialog card editor-dialog">
        <h3>{{ editingTopic ? '编辑题目' : '添加题目' }}</h3>
        
        <div class="form-group">
          <label>任务类型 *</label>
          <div class="radio-group">
            <label>
              <input type="radio" v-model="editorForm.type" value="task1" />
              Task 1
            </label>
            <label>
              <input type="radio" v-model="editorForm.type" value="task2" />
              Task 2
            </label>
          </div>
        </div>

        <div class="form-group">
          <label>分类 *</label>
          <select v-model="editorForm.category" required>
            <option value="">请选择分类</option>
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

        <div class="form-group">
          <label>难度 *</label>
          <div class="star-selector">
            <span 
              v-for="star in 5" 
              :key="star"
              class="star"
              :class="{ active: star <= editorForm.difficulty }"
              @click="editorForm.difficulty = star"
            >
              ⭐
            </span>
          </div>
        </div>

        <div class="form-group">
          <label>题目内容 *</label>
          <textarea 
            v-model="editorForm.title"
            rows="6"
            placeholder="输入题目描述..."
            class="textarea"
          ></textarea>
        </div>

        <div v-if="editorForm.type === 'task1'" class="form-group">
          <label>图片上传（可选）</label>
          <div class="upload-area">
            <div v-if="editorForm.imagePreview" class="image-preview">
              <img :src="editorForm.imagePreview" alt="预览" />
              <button class="btn-remove" @click="removeImage">✕</button>
            </div>
            <div v-else class="upload-placeholder" @click="triggerFileInput">
              <p>📷 点击上传图片</p>
              <p class="upload-hint">支持 PNG/JPG，最大 5MB</p>
            </div>
            <input 
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              @change="handleFileSelect"
              style="display: none"
            />
          </div>
        </div>

        <div v-if="editorError" class="error-message">
          ⚠️ {{ editorError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="closeEditor">取消</button>
          <button class="btn btn-primary" @click="saveTopic" :disabled="!isEditorValid">
            {{ editingTopic ? '保存' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 批量导入弹窗 -->
    <div v-if="showImportDialog" class="dialog-overlay" @click.self="showImportDialog = false">
      <div class="dialog card">
        <h3>批量导入题目</h3>
        <p class="hint">请选择 JSON 文件（格式参考文档）</p>
        
        <input 
          type="file"
          accept=".json"
          @change="handleImportFile"
          ref="importFileInput"
        />

        <div v-if="importPreview" class="import-preview">
          <p>📊 将导入 {{ importPreview.length }} 道题目</p>
        </div>

        <div v-if="importError" class="error-message">
          {{ importError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="showImportDialog = false">取消</button>
          <button 
            class="btn btn-primary" 
            @click="confirmImport"
            :disabled="!importPreview"
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { topics, upload } from '@/api/client.js'

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

    const result = await topics.list(activeFilters, pagination.value)
    
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
      imagePreview: topic.image_path ? getImageUrl(topic.image_path) : null
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
      await topics.update(editingTopic.value.id, topicData)
    } else {
      await topics.create(topicData)
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
    await topics.delete(topic.id)
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
    const result = await topics.batchImport(importPreview.value)
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
.topic-manage-page {
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

.filter-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
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

.filter-item select {
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
}

/* 题目网格 */
.topic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.topic-card {
  padding: 16px;
  transition: transform 0.2s, box-shadow 0.2s;
}

.topic-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.topic-type-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.topic-type-badge.task1 {
  background: #E3F2FD;
  color: #1976D2;
}

.topic-type-badge.task2 {
  background: #F3E5F5;
  color: #7B1FA2;
}

.topic-difficulty {
  font-size: 14px;
}

.topic-image {
  margin-bottom: 12px;
  border-radius: var(--border-radius);
  overflow: hidden;
  aspect-ratio: 16/9;
  background: var(--bg-light);
}

.topic-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.topic-content {
  margin-bottom: 12px;
}

.topic-category {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.topic-title {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.5;
  max-height: 3.6em;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.topic-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.usage-count {
  font-size: 12px;
  color: var(--text-muted);
}

.topic-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  padding: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.btn-icon:hover:not(:disabled) {
  opacity: 1;
}

.btn-icon:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
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

/* 编辑器弹窗 */
.editor-dialog {
  max-width: 600px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-primary);
}

.radio-group {
  display: flex;
  gap: 20px;
}

.radio-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.star-selector {
  display: flex;
  gap: 8px;
  font-size: 24px;
}

.star {
  cursor: pointer;
  opacity: 0.3;
  transition: opacity 0.2s;
}

.star.active {
  opacity: 1;
}

.star:hover {
  opacity: 0.7;
}

/* 图片上传 */
.upload-area {
  border: 2px dashed var(--border-color);
  border-radius: var(--border-radius);
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s;
}

.upload-area:hover {
  border-color: var(--primary-color);
}

.upload-placeholder p {
  margin: 8px 0;
  color: var(--text-secondary);
}

.upload-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.image-preview {
  position: relative;
  max-width: 300px;
  margin: 0 auto;
}

.image-preview img {
  width: 100%;
  border-radius: var(--border-radius);
}

.btn-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.import-preview {
  padding: 12px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
  margin: 12px 0;
}

.hint {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 12px 0;
}
</style>
