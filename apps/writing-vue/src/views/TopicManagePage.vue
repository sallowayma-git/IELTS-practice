<template>
  <div class="topic-manage-page">
    <div class="page-header">
      <div class="header-content">
        <h2 class="page-title heading-serif">写作题库 <span class="count-badge" v-if="displayCount > 0">{{ displayCount }}</span></h2>
      </div>
      <div class="header-actions">
        <button class="btn btn-warm-sand" @click="showImportDialog = true">
          批量导入
        </button>
        <button class="btn btn-brand" @click="openEditor()">
          添加题目
        </button>
      </div>
    </div>

    <div class="search-glass">
      <input v-model.trim="searchKeyword" type="text" class="search-input-glass" placeholder="搜索题目或关键词…" aria-label="搜索题目" />
    </div>

    <!-- 筛选工具栏 -->
    <div class="filter-toolbar card">
      <div class="filter-group">
        <div class="filter-item">
          <select v-model="filters.type" class="glass-select">
            <option value="">全部类型</option>
            <option value="task1">Task 1 (小作文)</option>
            <option value="task2">Task 2 (大作文)</option>
          </select>
        </div>

        <div class="filter-item">
          <select v-model="filters.category" class="glass-select">
            <option value="">全部分类</option>
            <optgroup v-for="group in filterCategoryGroups" :key="group.type" :label="group.label">
              <option v-for="option in group.options" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </optgroup>
          </select>
        </div>

        <div class="filter-item">
          <select v-model.number="filters.difficulty" class="glass-select">
            <option :value="0">全部难度</option>
            <option :value="1">1 · 入门</option>
            <option :value="2">2 · 基础</option>
            <option :value="3">3 · 进阶</option>
            <option :value="4">4 · 挑战</option>
            <option :value="5">5 · 专家</option>
          </select>
        </div>
      </div>
      
      <button v-if="hasActiveFilters" class="btn-text" @click="resetFilters">
        重置筛选
      </button>
    </div>

    <div v-if="pageMessage.message" :class="['inline-message', `inline-message-${pageMessage.type}`]">
      {{ pageMessage.message }}
    </div>

    <!-- 题目列表 (Grid Layout) -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>正在加载题库...</p>
    </div>
    
    <div v-else-if="filteredTopics.length === 0" class="empty-state card card-whisper">
      <h3>暂无题目数据</h3>
      <p>当前筛选条件下没有找到题目，尝试调整筛选或添加新题目</p>
      <button class="btn btn-brand" @click="openEditor()">
        创建第一道题目
      </button>
    </div>

    <div v-else class="topic-grid">
      <div v-for="topic in filteredTopics" :key="topic.id" class="topic-card card">
        <!-- 卡片头部 -->
        <div class="card-header">
          <div class="badges">
            <span :class="['badge', topic.type]">
              {{ topic.type === 'task1' ? 'Task 1' : 'Task 2' }}
            </span>
            <span class="category-badge">{{ getCategoryLabel(topic.category) }}</span>
          </div>
          <div class="difficulty">
            难度 {{ topic.difficulty || 0 }}/5
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
            使用 {{ topic.usage_count || 0 }} 次
          </span>
          <div class="actions">
            <button class="action-btn edit" @click="openEditor(topic)" title="编辑">编辑</button>
            <button 
              class="action-btn delete" 
              @click="deleteTopic(topic)" 
              :title="topic.is_official ? '官方题目不可删除' : '删除'"
              :disabled="topic.is_official"
            >删除</button>
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
        <h3 class="heading-serif">{{ editingTopic ? '编辑题目' : '添加新题目' }}</h3>
        
        <div class="form-scroll-area">
          <div class="form-group">
            <label>任务类型</label>
            <div class="radio-cards">
              <label class="radio-card" :class="{ active: editorForm.type === 'task1' }">
                <input type="radio" v-model="editorForm.type" value="task1" />
                <span class="radio-label">Task 1 (小作文)</span>
              </label>
              <label class="radio-card" :class="{ active: editorForm.type === 'task2' }">
                <input type="radio" v-model="editorForm.type" value="task2" />
                <span class="radio-label">Task 2 (大作文)</span>
              </label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group half">
              <label>题目分类</label>
              <select v-model="editorForm.category" required class="select">
                <option value="">请选择分类...</option>
                <optgroup v-for="group in editorCategoryGroups" :key="group.type" :label="group.label">
                  <option v-for="option in group.options" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </optgroup>
              </select>
            </div>

            <div class="form-group half">
              <label>难度等级</label>
              <div class="star-rating">
                <button
                  v-for="star in 5" 
                  :key="star"
                  type="button"
                  class="star"
                  :class="{ active: star <= editorForm.difficulty }"
                  @click="editorForm.difficulty = star"
                  :aria-label="`设置难度 ${star} / 5`"
                >{{ star }}</button>
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
            <div
              class="image-uploader"
              role="button"
              tabindex="0"
              :class="{ 'has-image': editorForm.imagePreview }"
              @click="triggerFileInput"
              @keydown.enter.space.prevent="triggerFileInput"
            >
              <div v-if="editorForm.imagePreview" class="preview-container">
                <img :src="editorForm.imagePreview" />
                <button class="remove-btn" @click.stop="removeImage">✕</button>
              </div>
              <div v-else class="upload-placeholder">
                                <p>点击上传图片（PNG / JPG / WebP，最大 5MB）</p>
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
          {{ editorError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-warm-sand" @click="closeEditor">取消</button>
          <button class="btn btn-brand" @click="saveTopic" :disabled="!isEditorValid">
            {{ editingTopic ? '保存修改' : '立即创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 批量导入弹窗 (保持逻辑，简化样式引用) -->
    <div v-if="showImportDialog" class="dialog-overlay" @click.self="closeImportDialog">
      <div class="dialog card">
        <h3 class="heading-serif">批量导入题目</h3>
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
          即将导入 <strong>{{ importPreview.length }}</strong> 道题目
        </div>

        <div v-if="importError" class="error-banner">
          {{ importError }}
        </div>

        <div class="dialog-actions">
          <button class="btn btn-warm-sand" @click="closeImportDialog">取消</button>
          <button class="btn btn-brand" @click="confirmImport" :disabled="!importPreview">
            确认导入
          </button>
        </div>
      </div>
    </div>

    <div v-if="deleteDialog.visible" class="dialog-overlay" @click.self="closeDeleteDialog">
      <div class="dialog card">
        <h3>删除题目</h3>
        <p>确定删除该题目？关联的历史记录不会被删除。</p>
        <div class="dialog-actions">
          <button class="btn btn-warm-sand" @click="closeDeleteDialog">取消</button>
          <button class="btn btn-danger" @click="confirmDeleteTopic">确认删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import { topics as topicsApi } from '@/api/client.js'
import { debounce } from '@/utils/debounce.js'
import { createRequestGate } from '@/utils/request-gate.js'
import { renderTopicTitle, extractTextFromTiptap } from '@/utils/tiptap-text.js'
import { getWritingCategoryLabel, getWritingCategoryOptions } from '@/utils/writing-categories.js'

// 状态
const loading = ref(false)
const topicsList = ref([])
const total = ref(0)
const pageMessage = ref({ type: 'info', message: '' })
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
  imagePreview: null,
  imageRemoved: false
})
const editorError = ref('')
const fileInput = ref(null)

// 导入
const showImportDialog = ref(false)
const importPreview = ref(null)
const importError = ref('')
const importFileInput = ref(null)
const topicsRequestGate = createRequestGate()
const searchKeyword = ref('')
const deleteDialog = ref({
  visible: false,
  topicId: null
})
const getCategoryLabel = getWritingCategoryLabel
const renderTitle = renderTopicTitle
const FILTER_GROUP_LABELS = Object.freeze({
  task1: 'Task 1',
  task2: 'Task 2'
})
const EDITOR_GROUP_LABELS = Object.freeze({
  task1: 'Task 1 类型',
  task2: 'Task 2 话题'
})

// 计算属性
// Search/filter/pagination are SQLite queries. Filtering only the current Vue
// page was both incomplete and a second topic-bank implementation.
const filteredTopics = computed(() => topicsList.value)
const displayCount = computed(() => total.value)
const totalPages = computed(() => Math.ceil(total.value / pagination.value.limit))
const hasActiveFilters = computed(() => (
  Boolean(filters.value.type)
  || Boolean(filters.value.category)
  || Number(filters.value.difficulty || 0) > 0
))
const filterCategoryGroups = computed(() => {
  const types = filters.value.type ? [filters.value.type] : ['task1', 'task2']
  return types.map((type) => ({
    type,
    label: FILTER_GROUP_LABELS[type] || type,
    options: getWritingCategoryOptions(type)
  }))
})
const editorCategoryGroups = computed(() => {
  const type = editorForm.value.type
  if (!type) return []
  return [{
    type,
    label: EDITOR_GROUP_LABELS[type] || type,
    options: getWritingCategoryOptions(type)
  }]
})

const isEditorValid = computed(() => {
  return editorForm.value.type && 
         editorForm.value.category && 
         editorForm.value.difficulty > 0 && 
         editorForm.value.title.trim().length > 0
})

// 加载题目列表
async function loadTopics() {
  const requestId = topicsRequestGate.begin()
  loading.value = true
  pageMessage.value = { type: 'info', message: '' }
  try {
    const activeFilters = {}
    if (filters.value.type) activeFilters.type = filters.value.type
    if (filters.value.category) activeFilters.category = filters.value.category
    if (filters.value.difficulty > 0) activeFilters.difficulty = filters.value.difficulty
    if (searchKeyword.value) activeFilters.search = searchKeyword.value

    const result = await topicsApi.list(activeFilters, pagination.value)
    if (!topicsRequestGate.isCurrent(requestId)) return
    if (!Array.isArray(result?.data)) {
      throw new Error('题库返回格式无效')
    }
    const rawTopics = result.data
    
    const topicsWithUrls = rawTopics.map((topic) => ({
      ...topic,
      image_url: safeTopicImageUrl(topic.image_url || topic.image_path)
    }))
    if (!topicsRequestGate.isCurrent(requestId)) return
    
    topicsList.value = topicsWithUrls
    total.value = Number.isFinite(Number(result?.total)) ? Number(result.total) : topicsWithUrls.length
  } catch (error) {
    if (!topicsRequestGate.isCurrent(requestId)) return
    console.error('加载题目失败:', error)
    topicsList.value = []
    total.value = 0
    pageMessage.value = {
      type: 'error',
      message: `加载题目失败：${error.message}`
    }
  } finally {
    if (topicsRequestGate.isCurrent(requestId)) {
      loading.value = false
    }
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
      imagePreview: safeTopicImageUrl(topic.image_url || topic.image_path),
      imageRemoved: false
    }
  } else {
    editorForm.value = {
      type: 'task1',
      category: '',
      difficulty: 3,
      title: '',
      imageFile: null,
      imagePreview: null,
      imageRemoved: false
    }
  }
  showEditor.value = true
  editorError.value = ''
}

function closeEditor() {
  showEditor.value = false
  editingTopic.value = null
  editorError.value = ''
}

// 保存题目
async function saveTopic() {
  if (!isEditorValid.value) return
  const isEditing = Boolean(editingTopic.value)

  try {
    let imagePath = editorForm.value.imageRemoved ? null : (editingTopic.value?.image_path || null)
    if (editorForm.value.imageFile) {
      imagePath = await readFileAsDataUrl(editorForm.value.imageFile)
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
    pageMessage.value = { type: 'success', message: isEditing ? '题目已更新' : '题目已创建' }
  } catch (error) {
    console.error('保存题目失败:', error)
    editorError.value = error.message
  }
}

// 删除题目
async function deleteTopic(topic) {
  if (topic.is_official) {
    pageMessage.value = { type: 'error', message: '官方题目不允许删除' }
    return
  }
  deleteDialog.value = {
    visible: true,
    topicId: topic.id
  }
}

function closeDeleteDialog() {
  deleteDialog.value = {
    visible: false,
    topicId: null
  }
}

async function confirmDeleteTopic() {
  const topicId = deleteDialog.value.topicId
  if (!topicId) {
    closeDeleteDialog()
    return
  }

  try {
    await topicsApi.delete(topicId)
    await loadTopics()
    pageMessage.value = { type: 'success', message: '题目已删除' }
  } catch (error) {
    console.error('删除题目失败:', error)
    pageMessage.value = { type: 'error', message: `删除失败：${error.message}` }
  } finally {
    closeDeleteDialog()
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
    editorError.value = '图片大小不能超过 5MB'
    return
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(file.type || '').toLowerCase())) {
    editorError.value = '仅支持 PNG、JPG 或 WebP 图片'
    return
  }

  // 清理旧的预览 URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }

  editorForm.value.imageFile = file
  editorForm.value.imagePreview = URL.createObjectURL(file)
  editorForm.value.imageRemoved = false
}

function removeImage() {
  // 清理 URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }
  
  editorForm.value.imageFile = null
  editorForm.value.imagePreview = null
  editorForm.value.imageRemoved = true
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
    
    const topics = Array.isArray(data) ? data : data?.topics
    if (!Array.isArray(topics)) {
      throw new Error('JSON 格式错误：应为题目数组或 { topics: [...] }')
    }

    // 限制条数（最多 500 条）
    if (topics.length > 500) {
      throw new Error(`题目数量过多（${topics.length} 条），单次最多导入 500 条`)
    }

    importPreview.value = topics
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
    pageMessage.value = {
      type: 'success',
      message: `成功导入 ${result.success} 道题目${result.failed > 0 ? `，失败 ${result.failed} 道` : ''}`
    }
    closeImportDialog()
    await loadTopics()
  } catch (error) {
    importError.value = '导入失败: ' + error.message
  }
}

function closeImportDialog() {
  showImportDialog.value = false
  importPreview.value = null
  importError.value = ''
  if (importFileInput.value) {
    importFileInput.value.value = ''
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function safeTopicImageUrl(value) {
  const image = String(value || '').trim()
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(image) ? image : null
}

// 监听筛选和分页变化（防抖）
watch(filters, () => {
  pagination.value.page = 1 // 重置到第一页
  debouncedLoadTopics()
}, { deep: true })

watch(searchKeyword, () => {
  pagination.value.page = 1
  debouncedLoadTopics()
})

watch(() => pagination.value.page, () => {
  loadTopics() // 分页立即加载
})

// 初始化
onMounted(() => {
  loadTopics()
})

// 清理
onBeforeUnmount(() => {
  topicsRequestGate.invalidate()
  // 清理可能残留的 blob URL
  if (editorForm.value.imagePreview && editorForm.value.imagePreview.startsWith('blob:')) {
    URL.revokeObjectURL(editorForm.value.imagePreview)
  }
})
</script>

<style scoped>
/* Topic bank: an index of prompts, one ruled entry each. */
.topic-manage-page {
  display: grid;
  gap: 24px;
  min-width: 0;
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 8px;
}

.page-title {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin: 0;
  font-size: clamp(1.75rem, 3vw, 2.125rem);
}

.count-badge {
  color: var(--anth-ink-faint);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-md);
  font-weight: var(--anth-weight-normal);
  font-variant-numeric: lining-nums tabular-nums;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.search-glass .search-input-glass {
  width: 100%;
  min-height: 42px;
}

.filter-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
}

.filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-item .glass-select {
  min-width: 160px;
  min-height: 38px;
}

.loading-state,
.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 48px 20px;
  border-top: 1px solid var(--anth-rule);
  border-bottom: 1px solid var(--anth-rule);
  text-align: center;
}

.empty-state h3 {
  margin: 0;
  font-size: var(--anth-text-lg);
}

.empty-state p,
.loading-state p {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--anth-rule);
  border-top-color: var(--anth-ink);
  border-radius: 50%; /* sanctioned: a progress glyph */
  animation: topic-spin 0.9s linear infinite;
}

@keyframes topic-spin {
  to { transform: rotate(1turn); }
}

.topic-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-top: 1.5px solid var(--anth-rule-heavy);
  border-bottom: 1.5px solid var(--anth-rule-heavy);
}

.topic-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--anth-rule);
}

.topic-card:last-child {
  border-bottom: 0;
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  grid-column: 1 / -1;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--anth-ink-soft);
}

.badge::before {
  content: "";
  width: 7px;
  height: 7px;
  background: var(--anth-info);
}

.badge.task2::before {
  background: var(--anth-accent);
}

.difficulty {
  font-variant-numeric: lining-nums tabular-nums;
}

.topic-image {
  grid-column: 1 / -1;
  max-width: 360px;
}

.topic-image img {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border: 1px solid var(--anth-rule);
}

.topic-body {
  min-width: 0;
}

.topic-title {
  max-width: var(--anth-measure);
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  line-height: var(--anth-leading-relaxed);
  overflow-wrap: anywhere;
}

.card-footer {
  display: grid;
  align-content: start;
  justify-items: end;
  gap: 6px;
}

.usage-info {
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-xs);
  font-variant-numeric: lining-nums tabular-nums;
}

.actions {
  display: flex;
  gap: 14px;
}

.action-btn {
  min-height: 32px;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
  text-decoration: underline;
  text-decoration-color: var(--anth-border-strong);
  text-underline-offset: 3px;
  cursor: pointer;
}

.action-btn:hover:not(:disabled) {
  color: var(--anth-ink);
}

.action-btn.delete:hover:not(:disabled) {
  color: var(--anth-danger);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-glass {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.page-info {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
  font-variant-numeric: lining-nums tabular-nums;
}

.page-info .sep {
  margin: 0 4px;
  color: var(--anth-ink-faint);
}

/* Editor dialog */
.editor-dialog {
  max-width: min(680px, calc(100vw - 32px));
}

.form-scroll-area {
  display: grid;
  gap: 18px;
  margin-top: 16px;
}

.form-group {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.form-group > label {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.radio-cards {
  display: flex;
  gap: 24px;
}

.radio-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
  cursor: pointer;
}

.radio-card.active {
  color: var(--anth-ink-strong);
}

.star-rating {
  display: flex;
  gap: 6px;
}

.star {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  border: 1px solid var(--anth-border-strong);
  border-radius: var(--anth-radius-sm);
  background: transparent;
  color: var(--anth-ink-soft);
  font-variant-numeric: lining-nums tabular-nums;
  cursor: pointer;
}

.star.active {
  border-color: var(--anth-ink);
  background: var(--anth-ink);
  color: var(--anth-canvas);
}

.textarea,
.select {
  width: 100%;
}

.image-uploader {
  display: grid;
  place-items: center;
  min-height: 120px;
  padding: 16px;
  border: 1px dashed var(--anth-border-strong);
  background: var(--anth-surface-sunken);
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
  cursor: pointer;
}

.image-uploader:focus-visible {
  outline: 2px solid var(--anth-accent);
  outline-offset: 2px;
}

.image-uploader p {
  margin: 0;
}

.preview-container {
  position: relative;
}

.preview-container img {
  display: block;
  max-height: 220px;
}

.remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--anth-ink);
  background: var(--anth-canvas);
  cursor: pointer;
}

.error-banner {
  margin-top: 12px;
  padding-left: 12px;
  border-left: 2px solid var(--anth-danger);
  color: var(--anth-danger);
  font-size: var(--anth-text-sm);
}

.dialog-hint {
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-sm);
}

.file-drop-zone {
  display: grid;
  gap: 8px;
  padding: 20px;
  border: 1px dashed var(--anth-border-strong);
  background: var(--anth-surface-sunken);
  text-align: center;
}

.file-drop-zone p {
  margin: 0;
  color: var(--anth-ink-faint);
  font-size: var(--anth-text-sm);
}

.import-preview {
  margin-top: 12px;
  font-size: var(--anth-text-sm);
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }

  .topic-card {
    grid-template-columns: 1fr;
  }

  .card-footer {
    grid-auto-flow: column;
    justify-content: space-between;
    align-items: center;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .filter-item,
  .filter-item .glass-select {
    width: 100%;
  }

  .filter-group {
    width: 100%;
  }
}
</style>
