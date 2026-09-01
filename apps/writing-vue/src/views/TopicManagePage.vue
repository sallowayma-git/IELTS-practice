<template>
  <div class="topic-manage-page">
    <div class="page-header">
      <div class="header-content">
        <span class="topic-eyebrow">Question bank</span>
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
      <input v-model.trim="searchKeyword" type="text" class="search-input-glass" placeholder="Find a topic or keyword..." />
      <span class="search-note">Search</span>
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
        ✕ 重置筛选
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
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
      </div>
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
            <button class="action-btn edit" @click="openEditor(topic)" title="编辑">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button 
              class="action-btn delete" 
              @click="deleteTopic(topic)" 
              :title="topic.is_official ? '官方题目不可删除' : '删除'"
              :disabled="topic.is_official"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
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
        <h3 class="heading-serif">{{ editingTopic ? '编辑题目' : '添加新题目' }}</h3>
        
        <div class="form-scroll-area">
          <div class="form-group">
            <label>任务类型</label>
            <div class="radio-cards">
              <label class="radio-card" :class="{ active: editorForm.type === 'task1' }">
                <input type="radio" v-model="editorForm.type" value="task1" />
                <span class="radio-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg></span>
                <span class="radio-label">Task 1 (小作文)</span>
              </label>
              <label class="radio-card" :class="{ active: editorForm.type === 'task2' }">
                <input type="radio" v-model="editorForm.type" value="task2" />
                <span class="radio-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></span>
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
                <span class="upload-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg></span>
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
          ⚠️ {{ editorError }}
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
          ✅ 即将导入 <strong>{{ importPreview.length }}</strong> 道题目
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
.topic-manage-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--atlas-ink);
  animation: topic-manage-enter var(--lg-duration-normal) var(--lg-easing-spring) both;
}

@keyframes topic-manage-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin: 8px 0 2px;
}

.header-content,
.header-actions {
  display: flex;
}

.header-content {
  flex-direction: column;
  gap: 8px;
}

.header-actions {
  flex-wrap: wrap;
  gap: 10px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--atlas-ink);
  font-family: var(--font-family-display);
  font-size: clamp(2.2rem, 5vw, 3.6rem);
  line-height: 1;
  letter-spacing: -0.04em;
}

.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  margin-left: 10px;
  padding: 4px 10px;
  border: 1px solid var(--atlas-accent-ring);
  border-radius: 999px;
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
  font-size: 0.875rem;
}

.search-glass,
.filter-toolbar,
.pagination-glass {
  border: 1px solid var(--atlas-rim);
  background: var(--lg-bg-elevated);
  box-shadow: var(--lg-shadow-subtle);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.search-glass {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
}

.search-input-glass {
  min-width: 0;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--atlas-ink);
}

.search-input-glass::placeholder,
.search-note {
  color: var(--atlas-ink-faint);
}

.search-note {
  flex: 0 0 auto;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.filter-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border-radius: var(--atlas-radius-md);
}

.filter-group {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.filter-item {
  min-width: 138px;
}

.glass-select {
  width: 100%;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid var(--atlas-line);
  border-radius: 999px;
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
  cursor: pointer;
  transition:
    border-color var(--lg-duration-fast) var(--lg-easing-spring),
    background var(--lg-duration-fast) var(--lg-easing-spring);
}

.glass-select:hover {
  border-color: var(--atlas-accent-ring);
  background: var(--lg-bg-elevated);
}

.glass-select:focus-visible {
  border-color: var(--atlas-accent);
}

.inline-message,
.error-banner,
.import-preview {
  border-radius: var(--atlas-radius-sm);
  font-size: 0.8125rem;
}

.inline-message {
  max-width: 800px;
  margin: 0 auto 16px;
  padding: 10px 12px;
}

.inline-message-success,
.import-preview {
  border: 1px solid var(--atlas-accent-ring);
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
}

.inline-message-error,
.error-banner {
  border: 1px solid var(--atlas-danger);
  background: var(--color-error-bg);
  color: var(--atlas-danger);
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
}

.topic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
}

.topic-card {
  display: flex;
  flex-direction: column;
  min-height: 340px;
  overflow: hidden;
  border: 1px solid var(--atlas-rim);
  border-radius: var(--atlas-radius-lg);
  background: var(--lg-bg-elevated);
  box-shadow: var(--lg-shadow-subtle);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  transition:
    transform var(--lg-duration-fast) var(--lg-easing-spring),
    box-shadow var(--lg-duration-fast) var(--lg-easing-spring);
}

.topic-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--lg-shadow-elevated);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
}

.badges,
.actions {
  display: flex;
  flex-wrap: wrap;
}

.badges {
  gap: 6px;
}

.badge,
.category-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--atlas-line);
  border-radius: 999px;
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink-soft);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.badge {
  text-transform: uppercase;
}

.badge.task1 {
  border-color: var(--atlas-accent-ring);
  background: var(--atlas-glass-pressed);
  color: var(--atlas-accent-alt);
}

.badge.task2 {
  border-color: var(--atlas-accent-ring);
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
}

.category-badge {
  font-weight: 600;
  letter-spacing: normal;
  text-transform: none;
}

.difficulty {
  color: var(--atlas-warning);
  font-size: 0.8125rem;
  letter-spacing: 1px;
}

.topic-image {
  width: 100%;
  height: 160px;
  overflow: hidden;
  border-top: 1px solid var(--atlas-line);
  border-bottom: 1px solid var(--atlas-line);
}

.topic-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--lg-duration-normal) var(--lg-easing-spring);
}

.topic-card:hover .topic-image img {
  transform: scale(1.04);
}

.topic-body {
  flex: 1;
  padding: 14px 16px;
}

.topic-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--atlas-ink);
  font-size: 0.9375rem;
  line-height: 1.7;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--atlas-line);
}

.usage-info,
.page-info {
  color: var(--atlas-ink-soft);
  font-size: 0.75rem;
}

.actions {
  gap: 6px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--atlas-rim);
  border-radius: 50%;
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
  cursor: pointer;
  transition:
    transform var(--lg-duration-fast) var(--lg-easing-spring),
    border-color var(--lg-duration-fast) var(--lg-easing-spring),
    background var(--lg-duration-fast) var(--lg-easing-spring),
    color var(--lg-duration-fast) var(--lg-easing-spring);
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--lg-bg-elevated);
}

.action-btn.edit:hover:not(:disabled) {
  border-color: var(--atlas-accent-ring);
  color: var(--atlas-accent-alt);
}

.action-btn.delete:hover:not(:disabled) {
  border-color: var(--atlas-danger);
  background: var(--color-error-bg);
  color: var(--atlas-danger);
}

.action-btn:disabled,
.page-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.loading-state,
.empty-state {
  padding: 40px 20px;
  border: 1px solid var(--atlas-rim);
  border-radius: var(--atlas-radius-lg);
  background: var(--lg-bg-elevated);
  color: var(--atlas-ink-soft);
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--atlas-accent);
  font-size: 3rem;
}

.spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 16px;
  border: 4px solid var(--atlas-line);
  border-top-color: var(--atlas-accent);
  border-radius: 50%;
  animation: topic-manage-spin 1s linear infinite;
}

@keyframes topic-manage-spin {
  to {
    transform: rotate(360deg);
  }
}

.pagination-glass {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: var(--atlas-radius-md);
}

.page-btn {
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--atlas-rim);
  border-radius: 999px;
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
  cursor: pointer;
}

.editor-dialog {
  display: flex;
  flex-direction: column;
  max-width: min(720px, calc(100vw - 48px));
  max-height: min(76vh, 720px);
}

.form-scroll-area {
  flex: 1;
  max-height: min(66vh, 620px);
  overflow-y: auto;
  padding-right: 8px;
  margin: -4px -8px -4px 0;
}

.form-group > label {
  display: block;
  margin-bottom: 8px;
  color: var(--atlas-ink-soft);
  font-size: 0.8125rem;
  font-weight: 700;
}

.form-row,
.radio-cards {
  display: flex;
  gap: 16px;
}

.form-row {
  align-items: flex-start;
}

.form-group.half {
  flex: 1;
  min-width: 0;
}

.radio-card {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--atlas-line);
  border-radius: var(--atlas-radius-sm);
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
  cursor: pointer;
  transition:
    border-color var(--lg-duration-fast) var(--lg-easing-spring),
    background var(--lg-duration-fast) var(--lg-easing-spring),
    transform var(--lg-duration-fast) var(--lg-easing-spring);
}

.radio-card:hover {
  border-color: var(--atlas-accent-ring);
  background: var(--lg-bg-elevated);
}

.radio-card:focus-within {
  outline: 3px solid var(--atlas-accent-ring);
  outline-offset: 2px;
}

.radio-card.active {
  border-color: var(--atlas-accent);
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
}

.radio-card input {
  position: absolute;
  opacity: 0;
}

.radio-icon {
  font-size: 1.5rem;
}

.radio-label {
  font-size: 0.9375rem;
  font-weight: 600;
}

.star-rating {
  display: flex;
  gap: 4px;
}

.star {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--atlas-line);
  border-radius: var(--lg-radius-sm);
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink-soft);
  cursor: pointer;
  opacity: 0.35;
  transition: transform var(--lg-duration-fast) var(--lg-easing-spring);
}

.star:hover {
  transform: scale(1.15);
}

.star.active {
  opacity: 1;
  border-color: var(--atlas-accent);
  background: var(--atlas-accent-soft);
  color: var(--atlas-accent-strong);
}

.textarea,
.select {
  width: 100%;
  border-color: var(--atlas-line);
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink);
}

.textarea {
  min-height: 132px;
  resize: vertical;
}

.image-uploader,
.file-drop-zone {
  position: relative;
  display: block;
  border: 1px dashed var(--atlas-accent-ring);
  border-radius: var(--atlas-radius-sm);
  background: var(--lg-bg-interactive);
  color: var(--atlas-ink-soft);
  cursor: pointer;
  transition:
    border-color var(--lg-duration-fast) var(--lg-easing-spring),
    background var(--lg-duration-fast) var(--lg-easing-spring);
}

.image-uploader {
  padding: 20px;
  text-align: center;
}

.file-drop-zone {
  margin-bottom: 16px;
  padding: 40px;
  text-align: center;
}

.image-uploader:hover:not(.is-disabled),
.image-uploader:focus-within,
.file-drop-zone:hover {
  border-color: var(--atlas-accent);
  background: var(--lg-bg-elevated);
}

.image-uploader:focus-within {
  outline: 3px solid var(--atlas-accent-ring);
  outline-offset: 3px;
}

.image-uploader.is-disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.file-drop-zone input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.upload-icon {
  display: block;
  margin-bottom: 8px;
  color: var(--atlas-accent);
  font-size: 2rem;
}

.form-hint,
.dialog-hint {
  color: var(--atlas-ink-soft);
  font-size: 0.85rem;
  line-height: 1.4;
}

.form-hint {
  margin: 8px 0 0;
}

.preview-container {
  position: relative;
  display: inline-block;
}

.preview-container img {
  max-height: 200px;
  border-radius: var(--atlas-radius-sm);
}

.remove-btn {
  position: absolute;
  top: -10px;
  right: -10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--atlas-rim);
  border-radius: 50%;
  background: var(--lg-bg-elevated);
  color: var(--atlas-danger);
  cursor: pointer;
}

.import-preview {
  margin-bottom: 16px;
  padding: 12px;
  text-align: center;
}

@media (max-width: 900px) {
  .page-header,
  .filter-toolbar,
  .pagination-glass,
  .form-row,
  .radio-cards {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions .btn {
    flex: 1;
  }

  .search-glass {
    align-items: flex-start;
    flex-direction: column;
    border-radius: var(--atlas-radius-md);
  }

  .filter-item {
    min-width: 0;
  }

  .card-footer {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topic-manage-page,
  .spinner {
    animation: none;
  }

  .topic-card,
  .topic-image img,
  .action-btn,
  .glass-select,
  .radio-card,
  .image-uploader,
  .file-drop-zone,
  .star {
    transition: none;
  }
}
</style>
