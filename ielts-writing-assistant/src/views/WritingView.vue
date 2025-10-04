<template>
  <div class="writing-container">
    <el-container>
      <el-header class="writing-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>写作练习</h2>
        </div>
        <div class="header-right">
          <el-button type="primary" @click="submitWriting" :loading="submitting">
            提交评测
          </el-button>
        </div>
      </el-header>

      <el-main class="writing-main">
        <div class="topic-section">
          <el-card>
            <template #header>
              <div class="card-header">
                <span>写作题目</span>
                <el-button type="text" @click="changeTopic">换一题</el-button>
              </div>
            </template>
            <div class="topic-content">
              <h3>{{ currentTopic.title }}</h3>
              <p class="topic-type">{{ currentTopic.type }}</p>
              <div class="topic-description" v-html="currentTopic.content"></div>
            </div>
          </el-card>
        </div>

        <div class="writing-section">
          <el-card>
            <template #header>
              <div class="card-header">
                <span>写作区域</span>
                <div class="word-count">
                  字数: {{ wordCount }} / {{ currentTopic.minWords }}+
                </div>
              </div>
            </template>
            <div class="editor-container">
              <div ref="editorRef" class="editor"></div>
            </div>
          </el-card>
        </div>

        <div class="tools-section">
          <el-row :gutter="20">
            <el-col :span="6">
              <el-button @click="saveDraft" :icon="Download">保存草稿</el-button>
            </el-col>
            <el-col :span="6">
              <el-button @click="clearContent" :icon="Delete">清空内容</el-button>
            </el-col>
            <el-col :span="6">
              <el-button @click="showTimer" :icon="Timer">
                {{ timerDisplay }}
              </el-button>
            </el-col>
            <el-col :span="6">
              <el-button @click="showTips" :icon="QuestionFilled">写作提示</el-button>
            </el-col>
          </el-row>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Delete, Timer, QuestionFilled } from '@element-plus/icons-vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { ElMessage } from 'element-plus'

const router = useRouter()

const submitting = ref(false)
const wordCount = ref(0)
const timerSeconds = ref(0)
const timerInterval = ref(null)
const editorRef = ref(null)

const currentTopic = ref({
  id: 1,
  title: '环境问题',
  type: 'Task 2 - 议论文',
  content: `
    <p><strong>题目：</strong></p>
    <p>Environmental problems are too big for individual countries and individual people to address. In other words, we have reached the stage where the only way to protect the environment is at an international level.</p>
    <p><strong>To what extent do you agree or disagree with this statement?</strong></p>
    <p><strong>要求：</strong>至少250词</p>
  `,
  minWords: 250,
  timeLimit: 40 * 60 // 40分钟
})

const timerDisplay = computed(() => {
  const minutes = Math.floor(timerSeconds.value / 60)
  const seconds = timerSeconds.value % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
})

const editor = useEditor({
  content: '',
  extensions: [StarterKit],
  onUpdate: ({ editor }) => {
    const text = editor.getText()
    wordCount.value = text.length
  }
})

const goBack = () => {
  router.push('/')
}

const changeTopic = () => {
  // TODO: 实现换题功能
  ElMessage.info('换题功能开发中...')
}

const submitWriting = async () => {
  if (wordCount.value < currentTopic.value.minWords) {
    ElMessage.warning(`字数不足，最少需要${currentTopic.value.minWords}词`)
    return
  }

  submitting.value = true

  try {
    // TODO: 提交作文到后端进行AI评判
    const content = editor.value?.getHTML() || ''

    // 模拟提交过程
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 跳转到评估结果页面
    router.push(`/assessment/${Date.now()}`)
  } catch (error) {
    ElMessage.error('提交失败，请重试')
  } finally {
    submitting.value = false
  }
}

const saveDraft = () => {
  const content = editor.value?.getHTML() || ''
  // TODO: 保存草稿到本地存储
  localStorage.setItem('writing-draft', content)
  ElMessage.success('草稿已保存')
}

const clearContent = () => {
  editor.value?.commands.clearContent()
  wordCount.value = 0
}

const showTimer = () => {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
    ElMessage.info('计时器已停止')
  } else {
    timerInterval.value = setInterval(() => {
      timerSeconds.value++
    }, 1000)
    ElMessage.info('计时器已启动')
  }
}

const showTips = () => {
  ElMessage.info('写作提示功能开发中...')
}

const loadDraft = () => {
  const draft = localStorage.getItem('writing-draft')
  if (draft && editor.value) {
    editor.value.commands.setContent(draft)
    const text = editor.value.getText()
    wordCount.value = text.length
  }
}

onMounted(() => {
  loadDraft()
})
</script>

<style scoped>
.writing-container {
  height: 100vh;
  background: #f5f7fa;
}

.writing-header {
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-left h2 {
  margin: 0;
  color: #2c3e50;
}

.writing-main {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.topic-section {
  margin-bottom: 2rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topic-content h3 {
  color: #2c3e50;
  margin-bottom: 0.5rem;
}

.topic-type {
  color: #409EFF;
  font-weight: 600;
  margin-bottom: 1rem;
}

.topic-description {
  line-height: 1.6;
  color: #606266;
}

.writing-section {
  margin-bottom: 2rem;
}

.word-count {
  color: #909399;
  font-size: 0.9rem;
}

.editor-container {
  min-height: 400px;
}

.editor {
  min-height: 400px;
  padding: 1rem;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: white;
}

.editor:focus {
  outline: none;
  border-color: #409EFF;
}

.tools-section {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}
</style>