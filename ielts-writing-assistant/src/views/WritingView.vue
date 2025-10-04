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
            <div class="topic-content" v-if="currentTopic">
              <h3>{{ currentTopic.title }}</h3>
              <p class="topic-type">{{ currentTopic.type }}</p>
              <div class="topic-description" v-html="currentTopic.content"></div>
            </div>
            <div v-else class="topic-loading">
              <el-skeleton :rows="3" animated />
            </div>
          </el-card>
        </div>

        <div class="writing-section">
          <el-card>
            <template #header>
              <div class="card-header">
                <span>写作区域</span>
                <div class="word-count">
                  字数: {{ wordCount }} / {{ currentTopic?.min_words || 250 }}+
                </div>
              </div>
            </template>
            <div class="editor-container">
              <editor-content :editor="editor" class="editor" />
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
                {{ formattedTime }}
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
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Delete, Timer, QuestionFilled } from '@element-plus/icons-vue'
import { useEditor } from '@tiptap/vue-3'
import { EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { ElMessage } from 'element-plus'
import { useWritingStore } from '@/stores/writing'
import { useAssessmentStore } from '@/stores/assessment'
import { storeToRefs } from 'pinia'

const router = useRouter()
const writingStore = useWritingStore()
const assessmentStore = useAssessmentStore()

// 从store获取响应式状态
const {
  isSubmitting: submitting,
  wordCount,
  timerSeconds,
  currentTopic,
  formattedTime,
  wordCountValid,
  writingContent,
  isTimerRunning
} = storeToRefs(writingStore)

// 监听编辑器内容变化
const handleEditorUpdate = ({ editor }) => {
  const content = editor.getHTML()
  writingStore.updateContent(content)
}

// Tiptap编辑器
const editor = useEditor({
  content: '',
  extensions: [StarterKit],
  onUpdate: handleEditorUpdate
})

const goBack = () => {
  router.push('/')
}

const changeTopic = async () => {
  try {
    await writingStore.getRandomTopic()
    ElMessage.success('题目已更换')
  } catch (error) {
    ElMessage.error('换题失败')
  }
}

const submitWriting = async () => {
  if (!wordCountValid.value) {
    ElMessage.warning(`字数不足，最少需要${currentTopic.value?.min_words || 250}词`)
    return
  }

  try {
    const result = await writingStore.submitWriting()

    // 跳转到评估结果页面
    router.push(`/assessment/${result.id}`)
  } catch (error) {
    ElMessage.error(error.message || '提交失败，请重试')
  }
}

const saveDraft = async () => {
  try {
    await writingStore.saveDraft()
    ElMessage.success('草稿已保存')
  } catch (error) {
    ElMessage.error('保存草稿失败')
  }
}

const clearContent = () => {
  // 先清空编辑器
  if (editor.value) {
    editor.value.commands.clearContent()
  }
  // 再重置store状态
  writingStore.resetWriting()
}

const showTimer = () => {
  if (isTimerRunning.value) {
    writingStore.stopTimer()
    ElMessage.info('计时器已停止')
  } else {
    writingStore.startTimer()
    ElMessage.info('计时器已启动')
  }
}

const showTips = () => {
  ElMessage.info('写作提示功能开发中...')
}

// 监听writingContent变化，同步到编辑器
watch(writingContent, (newContent) => {
  if (editor.value && newContent !== editor.value.getHTML()) {
    editor.value.commands.setContent(newContent)
  }
})

// 监听currentTopic变化，换题时清空编辑器
watch(currentTopic, (newTopic, oldTopic) => {
  if (newTopic && oldTopic && newTopic.id !== oldTopic.id && editor.value) {
    // 换题时清空编辑器内容
    editor.value.commands.clearContent()
  }
})

onMounted(async () => {
  // 加载草稿
  await writingStore.loadDraft()

  // 如果没有题目，获取一个随机题目
  if (!currentTopic.value) {
    try {
      await writingStore.getRandomTopic()
    } catch (error) {
      console.error('获取题目失败:', error)
    }
  }

  // 如果有草稿内容，设置到编辑器
  if (writingContent.value && editor.value) {
    editor.value.commands.setContent(writingContent.value)
  }
})

// 组件卸载时清理
onUnmounted(() => {
  writingStore.cleanup()
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

.topic-loading {
  padding: 1rem;
}
</style>