<template>
  <div class="topic-manage-page workspace has-rail">
    <header class="page-header topic-header">
      <div class="page-header-top">
        <div class="topic-header__copy">
          <p class="page-header-kicker">WRITING · 写作题库</p>
          <h1>写作题库</h1>
        </div>
        <div class="page-header-actions header-actions">
          <button class="btn btn-secondary btn-warm-sand" type="button" @click="showImportDialog = true">
            批量导入
          </button>
          <button class="btn btn-primary btn-brand" type="button" @click="openEditor()">
            新建题目
          </button>
        </div>
      </div>
      <p class="page-header-desc">按任务类型、分类与难度整理写作题目。删除题目不会影响已有的历史记录。</p>
    </header>

    <!-- 筛选栏 -->
    <aside class="topic-rail" aria-label="题目筛选">
      <div class="field">
        <label class="field-label" for="topic-search">搜索</label>
        <input
          id="topic-search"
          v-model.trim="searchKeyword"
          type="text"
          class="input"
          placeholder="搜索题目或关键词…"
          aria-label="搜索题目"
        />
      </div>

      <div class="field">
        <label class="field-label" for="topic-filter-type">任务类型</label>
        <select id="topic-filter-type" v-model="filters.type" class="select">
          <option value="">全部类型</option>
          <option value="task1">Task 1 (小作文)</option>
          <option value="task2">Task 2 (大作文)</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="topic-filter-category">题目分类</label>
        <select id="topic-filter-category" v-model="filters.category" class="select">
          <option value="">全部分类</option>
          <optgroup v-for="group in filterCategoryGroups" :key="group.type" :label="group.label">
            <option v-for="option in group.options" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </optgroup>
        </select>
      </div>

      <div class="field">
        <label class="field-label" for="topic-filter-difficulty">难度</label>
        <select id="topic-filter-difficulty" v-model.number="filters.difficulty" class="select">
          <option :value="0">全部难度</option>
          <option :value="1">1 · 入门</option>
          <option :value="2">2 · 基础</option>
          <option :value="3">3 · 进阶</option>
          <option :value="4">4 · 挑战</option>
          <option :value="5">5 · 专家</option>
        </select>
      </div>

      <button v-if="hasActiveFilters" class="btn btn-ghost btn-sm topic-rail__reset" type="button" @click="resetFilters">
        重置筛选
      </button>
    </aside>

    <section class="topic-main">
      <div class="toolbar is-sticky">
        <div class="topic-toolbar-row">
          <span class="section-meta">共 <span class="t-num">{{ displayCount }}</span> 道题目</span>
          <nav v-if="total > pagination.limit" class="topic-pager" aria-label="分页">
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="pagination.page === 1"
              @click="pagination.page--"
            >
              ← 上一页
            </button>
            <span class="topic-pager__info t-num">
              <span class="current">{{ pagination.page }}</span>
              <span class="sep">/</span>
              <span class="total">{{ totalPages }}</span>
            </span>
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              :disabled="pagination.page >= totalPages"
              @click="pagination.page++"
            >
              下一页 →
            </button>
          </nav>
        </div>
        <div v-if="pageMessage.message" :class="['inline-message', `inline-message-${pageMessage.type}`]">
          {{ pageMessage.message }}
        </div>
      </div>

      <div class="scroll-region">
        <div v-if="loading" class="empty-state" role="status">
          <span class="topic-spinner" aria-hidden="true"></span>
          <p class="empty-state-desc">正在加载题库...</p>
        </div>

        <div v-else-if="filteredTopics.length === 0" class="empty-state">
          <h3>暂无题目数据</h3>
          <p class="empty-state-desc">当前筛选条件下没有找到题目，尝试调整筛选或新建题目。</p>
          <button class="btn btn-primary btn-brand empty-state-action" type="button" @click="openEditor()">
            创建第一道题目
          </button>
        </div>

        <div v-else class="list topic-grid">
          <div
            v-for="topic in filteredTopics"
            :key="topic.id"
            class="topic-card list-row"
            :class="{ 'has-thumb': topic.image_url && topic.type === 'task1' }"
          >
            <div v-if="topic.image_url && topic.type === 'task1'" class="topic-thumb">
              <img :src="topic.image_url" loading="lazy" :alt="topic.category" />
            </div>

            <div class="list-row-main topic-body">
              <div class="topic-tags">
                <span :class="['tag', topic.type === 'task2' ? 'tag-info' : 'tag-accent']">
                  {{ topic.type === 'task1' ? 'Task 1' : 'Task 2' }}
                </span>
                <span class="tag tag-neutral">{{ getCategoryLabel(topic.category) }}</span>
                <span class="tag tag-neutral t-num">难度 {{ topic.difficulty || 0 }}/5</span>
              </div>
              <div class="topic-title" v-html="renderTitle(topic.title_json)"></div>
              <div class="list-row-meta">
                <span>使用 {{ topic.usage_count || 0 }} 次</span>
                <span v-if="topic.is_official">官方题目</span>
              </div>
            </div>

            <div class="list-row-trail">
              <button class="btn btn-ghost btn-sm edit" type="button" title="编辑" @click="openEditor(topic)">编辑</button>
              <button
                class="btn btn-danger-ghost btn-sm delete"
                type="button"
                :title="topic.is_official ? '官方题目不可删除' : '删除'"
                :disabled="topic.is_official"
                @click="deleteTopic(topic)"
              >删除</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="dialog-overlay" @click.self="closeEditor">
      <div class="dialog dialog-lg editor-dialog" role="dialog" aria-modal="true" aria-labelledby="topic-editor-title">
        <header class="dialog-header">
          <h3 id="topic-editor-title">{{ editingTopic ? '编辑题目' : '添加新题目' }}</h3>
        </header>

        <div class="dialog-body">
          <div class="topic-form">
            <div class="field">
              <span class="field-label" id="topic-editor-type-label">任务类型</span>
              <div class="segmented" role="radiogroup" aria-labelledby="topic-editor-type-label">
                <label class="segmented-item" :class="{ active: editorForm.type === 'task1' }">
                  <input type="radio" v-model="editorForm.type" value="task1" />
                  <span>Task 1 (小作文)</span>
                </label>
                <label class="segmented-item" :class="{ active: editorForm.type === 'task2' }">
                  <input type="radio" v-model="editorForm.type" value="task2" />
                  <span>Task 2 (大作文)</span>
                </label>
              </div>
            </div>

            <div class="topic-form__row">
              <div class="field">
                <label class="field-label" for="topic-editor-category">题目分类</label>
                <select id="topic-editor-category" v-model="editorForm.category" required class="select">
                  <option value="">请选择分类...</option>
                  <optgroup v-for="group in editorCategoryGroups" :key="group.type" :label="group.label">
                    <option v-for="option in group.options" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </optgroup>
                </select>
              </div>

              <div class="field">
                <span class="field-label" id="topic-editor-difficulty-label">难度等级</span>
                <div class="topic-stars" role="group" aria-labelledby="topic-editor-difficulty-label">
                  <button
                    v-for="star in 5"
                    :key="star"
                    type="button"
                    class="topic-star"
                    :class="{ active: star <= editorForm.difficulty }"
                    @click="editorForm.difficulty = star"
                    :aria-label="`设置难度 ${star} / 5`"
                  >{{ star }}</button>
                </div>
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="topic-editor-title">题目描述</label>
              <textarea
                id="topic-editor-title"
                v-model="editorForm.title"
                rows="6"
                placeholder="请输入完整的题目描述..."
                class="textarea"
              ></textarea>
            </div>

            <div v-if="editorForm.type === 'task1'" class="field">
              <span class="field-label" id="topic-editor-image-label">题目图片</span>
              <div
                class="image-uploader"
                role="button"
                tabindex="0"
                aria-labelledby="topic-editor-image-label"
                :class="{ 'has-image': editorForm.imagePreview }"
                @click="triggerFileInput"
                @keydown.enter.space.prevent="triggerFileInput"
              >
                <div v-if="editorForm.imagePreview" class="preview-container">
                  <img :src="editorForm.imagePreview" alt="题目图片预览" />
                  <button class="btn btn-secondary btn-sm btn-icon remove-btn" type="button" aria-label="移除图片" @click.stop="removeImage">✕</button>
                </div>
                <p v-else>点击上传图片（PNG / JPG / WebP，最大 5MB）</p>
              </div>
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                @change="handleFileSelect"
                hidden
              />
            </div>

            <div v-if="editorError" class="inline-message inline-message-error" role="alert">
              {{ editorError }}
            </div>
          </div>
        </div>

        <footer class="dialog-footer dialog-actions">
          <button class="btn btn-secondary btn-warm-sand" type="button" @click="closeEditor">取消</button>
          <button class="btn btn-primary btn-brand" type="button" @click="saveTopic" :disabled="!isEditorValid">
            {{ editingTopic ? '保存修改' : '立即创建' }}
          </button>
        </footer>
      </div>
    </div>

    <!-- 批量导入弹窗 -->
    <div v-if="showImportDialog" class="dialog-overlay" @click.self="closeImportDialog">
      <div class="dialog dialog-lg" role="dialog" aria-modal="true" aria-labelledby="topic-import-title">
        <header class="dialog-header">
          <h3 id="topic-import-title">批量导入题目</h3>
        </header>

        <div class="dialog-body">
          <div class="topic-form">
            <p class="topic-hint">请上传符合格式要求的 JSON 文件</p>

            <div class="topic-drop">
              <input
                type="file"
                accept=".json"
                @change="handleImportFile"
                ref="importFileInput"
                aria-label="选择 JSON 文件"
              />
              <p>点击选择文件</p>
            </div>

            <div v-if="importPreview" class="topic-hint">
              即将导入 <strong>{{ importPreview.length }}</strong> 道题目
            </div>

            <div v-if="importError" class="inline-message inline-message-error" role="alert">
              {{ importError }}
            </div>
          </div>
        </div>

        <footer class="dialog-footer dialog-actions">
          <button class="btn btn-secondary btn-warm-sand" type="button" @click="closeImportDialog">取消</button>
          <button class="btn btn-primary btn-brand" type="button" @click="confirmImport" :disabled="!importPreview">
            确认导入
          </button>
        </footer>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="deleteDialog.visible" class="dialog-overlay" @click.self="closeDeleteDialog">
      <div class="dialog dialog-sm" role="alertdialog" aria-modal="true" aria-labelledby="topic-delete-title">
        <header class="dialog-header">
          <h3 id="topic-delete-title">删除题目</h3>
        </header>
        <div class="dialog-body">
          <div class="topic-form">
            <p class="topic-hint">确定删除该题目？关联的历史记录不会被删除。</p>
          </div>
        </div>
        <footer class="dialog-footer dialog-actions">
          <button class="btn btn-secondary btn-warm-sand" type="button" @click="closeDeleteDialog">取消</button>
          <button class="btn btn-danger" type="button" @click="confirmDeleteTopic">确认删除</button>
        </footer>
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
/* Workspace layout only; look and frame come from styles/design-system/components. */
.topic-header.page-header { grid-column: 1 / -1; padding-top: 0; margin-bottom: var(--anth-space-4); }
.topic-header__copy { display: grid; gap: var(--anth-space-1); }

.topic-rail {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-4);
  min-width: 0;
  padding: var(--anth-space-3) var(--anth-space-5) var(--anth-space-5) 0;
  border-right: 1px solid var(--anth-rule);
}

.topic-rail__reset { align-self: flex-start; }

.topic-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  padding-left: var(--anth-space-6);
}

.topic-main .scroll-region { padding: var(--anth-space-4) 0 var(--anth-space-6); }

.topic-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--anth-space-3);
  min-height: 28px;
}

.topic-pager { display: inline-flex; align-items: center; gap: var(--anth-space-2); }
.topic-pager__info { min-width: 4ch; text-align: center; }

/* Row: [thumbnail, task 1 only] [body] [actions]. */
.topic-card.list-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  padding: var(--anth-space-4);
}

.topic-card.list-row.has-thumb { grid-template-columns: 6rem minmax(0, 1fr) auto; }

.topic-thumb img {
  display: block;
  width: 100%;
  max-height: 96px;
  object-fit: contain;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-xs);
  background: var(--anth-surface-sunken);
}

.topic-body { display: grid; gap: var(--anth-space-2); min-width: 0; }
.topic-tags { display: flex; flex-wrap: wrap; gap: var(--anth-space-1); }

/* Prompt text is prose: serif body-lg, two lines at most. */
.topic-title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.topic-title :deep(p) { margin: 0; }

/* Editor and import bodies. */
.topic-form { display: grid; gap: var(--anth-space-5); padding: var(--anth-space-2) 0 var(--anth-space-5); }
.topic-form__row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--anth-space-4); }
.topic-form__row > .field { min-width: 0; }

/* Difficulty stars: token-only squares, clay when set. */
.topic-stars { display: flex; gap: var(--anth-space-1); }

.topic-star {
  width: var(--anth-space-8);
  height: var(--anth-space-8);
  padding: 0;
  border: 1px solid var(--anth-rule-strong);
  border-radius: var(--anth-radius-sm);
  background: var(--anth-surface-raised);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background-color var(--anth-duration-fast) var(--anth-ease), border-color var(--anth-duration-fast) var(--anth-ease);
}

.topic-star:hover { border-color: var(--anth-rule-hover-strong); color: var(--anth-ink); }
.topic-star.active { border-color: var(--anth-accent); background: var(--anth-accent-soft); color: var(--anth-accent-ink); }
.topic-star:focus-visible { outline: none; box-shadow: var(--anth-focus-ring); }

.image-uploader {
  display: grid;
  place-items: center;
  min-height: calc(var(--anth-space-8) * 4);
  padding: var(--anth-space-4);
  border: 1px dashed var(--anth-rule-strong);
  border-radius: var(--anth-radius-md);
  background: var(--anth-surface-sunken);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  text-align: center;
  cursor: pointer;
}

.image-uploader:hover { border-color: var(--anth-rule-hover-strong); }
.image-uploader:focus-visible { outline: none; box-shadow: var(--anth-focus-ring); }
.image-uploader p { margin: 0; }
.preview-container { position: relative; width: 100%; }

.preview-container img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin: 0 auto;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-xs);
}

.remove-btn { position: absolute; top: var(--anth-space-2); right: var(--anth-space-2); }

.topic-hint { margin: 0; color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }

.topic-drop {
  display: grid;
  justify-items: center;
  gap: var(--anth-space-2);
  padding: var(--anth-space-5);
  border: 1px dashed var(--anth-rule-strong);
  border-radius: var(--anth-radius-md);
  background: var(--anth-surface-sunken);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  text-align: center;
}

.topic-drop p { margin: 0; }

.topic-spinner {
  width: var(--anth-space-4);
  height: var(--anth-space-4);
  border: 2px solid var(--anth-rule-strong);
  border-top-color: var(--anth-accent);
  border-radius: 50%;
  animation: topic-spin 0.9s linear infinite;
}

@keyframes topic-spin { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { .topic-spinner { animation: none; } }

/* Narrow: rail stacks above the list; the page scrolls as a whole. */
@media (max-width: 900px) {
  .topic-manage-page.workspace { height: auto; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; }
  .topic-rail { padding: 0 0 var(--anth-space-5); border-right: 0; border-bottom: 1px solid var(--anth-rule); }
  .topic-main { padding-left: 0; }
  .topic-main .scroll-region { overflow: visible; }
}

@media (max-width: 600px) {
  .topic-form__row { grid-template-columns: minmax(0, 1fr); }
}
</style>
