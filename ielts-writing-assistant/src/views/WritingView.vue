<template>
  <div class="writing-container">
    <el-container>
      <el-header class="writing-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>写作练习</h2>
        </div>
        <div class="header-right">
          <el-button @click="saveDraft" :icon="Download">保存草稿</el-button>
          <el-button @click="clearContent" :icon="Delete">清空内容</el-button>
          <el-button @click="showTimer" :icon="Timer">
            {{ formattedTime }}
          </el-button>
          <el-button @click="submitWritingStream" :loading="submitting">
            AI流式评测
          </el-button>
          <el-button type="primary" @click="submitWriting" :loading="submitting">
            提交评测
          </el-button>
        </div>
      </el-header>

      <el-main class="writing-main">
        <!-- 显示评估结果 -->
        <AssessmentResult
          v-if="showResult"
          :assessment="assessmentResult"
          @reassess="reassess"
          @writeNew="writeNewEssay"
        />

        <!-- 写作界面 -->
        <div v-else class="writing-interface">
          <!-- 左侧写作区域 (60%) -->
          <el-aside class="writing-area" width="60%">
            <!-- 题目显示 -->
            <el-card class="topic-card" v-if="currentTopic">
              <template #header>
                <div class="topic-header">
                  <span>{{ currentTopic.title }}</span>
                  <el-button type="text" @click="changeTopic">换一题</el-button>
                </div>
              </template>
              <div class="topic-content">
                <div class="topic-type">类型: {{ currentTopic.type }}</div>
                <div class="topic-description" v-html="currentTopic.content"></div>
                <div class="topic-requirements">
                  <el-tag v-if="currentTopic.min_words" type="info">
                    最少字数: {{ currentTopic.min_words }}+
                  </el-tag>
                  <el-tag v-if="currentTopic.time_limit" type="warning">
                    建议时间: {{ currentTopic.time_limit }} 分钟
                  </el-tag>
                </div>
              </div>
            </el-card>

            <!-- 写作编辑器 -->
            <el-card class="editor-card">
              <template #header>
                <div class="editor-header">
                  <span>写作区域</span>
                  <div class="editor-info">
                    <span class="word-count">字数: {{ wordCount }}</span>
                    <span class="time-elapsed">用时: {{ formattedTime }}</span>
                  </div>
                </div>
              </template>

              <div class="editor-container">
                <editor-content :editor="editor" class="editor" />
              </div>

              <!-- AI进度显示 -->
              <div v-if="showAIProgress" class="ai-progress">
                <el-progress
                  :percentage="progressPercentage"
                  :status="progressStatus"
                  :stroke-width="20"
                />
                <div class="progress-text">{{ progressText }}</div>
              </div>
            </el-card>
          </el-aside>

          <!-- 右侧工具区域 (40%) -->
          <el-aside class="tools-area" width="40%">
            <!-- 写作提示 -->
            <el-card class="tips-card">
              <template #header>
                <span>写作提示</span>
                <el-button type="text" @click="toggleTips">
                  {{ showTips ? '隐藏' : '显示' }}
                </el-button>
              </template>

              <div v-if="showTips" class="tips-content">
                <div class="tip-item">
                  <h4>结构建议</h4>
                  <ul>
                    <li>引言段：明确表达观点</li>
                    <li>主体段：每段一个中心思想</li>
                    <li>结论段：总结观点并升华</li>
                  </ul>
                </div>
                <div class="tip-item">
                  <h4>词汇提升</h4>
                  <ul>
                    <li>使用同义词替换简单词汇</li>
                    <li>适当使用学术词汇</li>
                    <li>避免重复用词</li>
                  </ul>
                </div>
                <div class="tip-item">
                  <h4>语法要点</h4>
                  <ul>
                    <li>注意主谓一致</li>
                    <li>使用复合句</li>
                    <li>避免语法错误</li>
                  </ul>
                </div>
              </div>
            </el-card>

            <!-- 字数统计 -->
            <el-card class="stats-card">
              <template #header>
                <span>统计信息</span>
              </template>

              <div class="stats-grid">
                <div class="stat-item">
                  <div class="stat-value">{{ wordCount }}</div>
                  <div class="stat-label">当前字数</div>
                </div>
                <div class="stat-item">
                  <div class="stat-value">{{ currentTopic?.min_words || 250 }}</div>
                  <div class="stat-label">目标字数</div>
                </div>
                <div class="stat-item">
                  <div class="stat-value">{{ wordCount >= (currentTopic?.min_words || 250) ? '✓' : '✗' }}</div>
                  <div class="stat-label">字数达标</div>
                </div>
                <div class="stat-item">
                  <div class="stat-value">{{ formattedTime }}</div>
                  <div class="stat-label">用时</div>
                </div>
              </div>

              <div class="progress-bar">
                <el-progress
                  :percentage="wordCountPercentage"
                  :stroke-width="10"
                  :show-text="false"
                />
                <span class="progress-text">{{ wordCountPercentage }}% 完成</span>
              </div>
            </el-card>

            <!-- 写作工具 -->
            <el-card class="tools-card">
              <template #header>
                <span>写作工具</span>
              </template>

              <div class="tools-grid">
                <el-button @click="insertTemplate('introduction')" size="small">
                  插入引言模板
                </el-button>
                <el-button @click="insertTemplate('body')" size="small">
                  插入主体模板
                </el-button>
                <el-button @click="insertTemplate('conclusion')" size="small">
                  插入结论模板
                </el-button>
                <el-button @click="insertTransition()" size="small">
                  插入过渡词
                </el-button>
              </div>
            </el-card>

            <!-- 草稿历史 -->
            <el-card class="drafts-card">
              <template #header>
                <span>草稿历史</span>
                <el-button type="text" @click="loadDrafts">
                  刷新
                </el-button>
              </template>

              <div class="drafts-list">
                <div
                  v-for="draft in drafts"
                  :key="draft.id"
                  class="draft-item"
                  @click="loadDraft(draft)"
                >
                  <div class="draft-title">
                    {{ draft.title || '无标题草稿' }}
                  </div>
                  <div class="draft-info">
                    <span>{{ draft.wordCount }} 字</span>
                    <span>{{ formatTime(draft.createdAt) }}</span>
                  </div>
                </div>
                <div v-if="drafts.length === 0" class="no-drafts">
                  暂无草稿
                </div>
              </div>
            </el-card>
          </el-aside>
        </div>
      </el-main>
    </el-container>

    <!-- AI配置对话框 -->
    <AIConfigDialog
      v-model="showAIConfig"
      @success="handleAIConfigSuccess"
    />

    <!-- 模板选择对话框 -->
    <el-dialog v-model="showTemplateDialog" title="选择模板" width="500px">
      <div class="template-options">
        <el-radio-group v-model="selectedTemplate" direction="vertical">
          <el-radio label="introduction">引言段模板</el-radio>
          <el-radio label="body">主体段模板</el-radio>
          <el-radio label="conclusion">结论段模板</el-radio>
        </el-radio-group>
      </div>

      <template #footer>
        <el-button @click="showTemplateDialog = false">取消</el-button>
        <el-button type="primary" @click="insertSelectedTemplate">插入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Delete, Timer } from '@element-plus/icons-vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Text from '@tiptap/extension-text'
import AssessmentResult from '@/components/AssessmentResult.vue'

const router = useRouter()

// 编辑器配置
const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    Underline,
    Text,
  ],
  editorProps: {
    attributes: {
      class: 'prose prose-sm sm:prose lg:prose-xl mx-auto focus:outline-none',
    },
  },
})

// 状态管理
const currentTopic = ref(null)
const submitting = ref(false)
const showResult = ref(false)
const assessmentResult = ref(null)
const showAIProgress = ref(false)
const progressPercentage = ref(0)
const progressText = ref('')
const progressStatus = ref('success')
const showAIConfig = ref(false)
const showTips = ref(true)
const showTemplateDialog = ref(false)
const selectedTemplate = ref('')
const drafts = ref([])

// 计时器
const startTime = ref(null)
const elapsedTime = ref(0)
const timer = ref(null)

// 计算属性
const wordCount = computed(() => {
  if (!editor.value) return 0
  return editor.value.getText().length
})

const wordCountPercentage = computed(() => {
  const target = currentTopic.value?.min_words || 250
  return Math.min(Math.round((wordCount.value / target) * 100), 100)
})

const formattedTime = computed(() => {
  const minutes = Math.floor(elapsedTime.value / 60)
  const seconds = elapsedTime.value % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
})

// 生命周期
onMounted(() => {
  loadTopic()
  startTimer()
  loadDrafts()
})

onUnmounted(() => {
  stopTimer()
  if (editor.value) {
    editor.value.destroy()
  }
})

// 加载题目
const loadTopic = async () => {
  try {
    const response = await fetch('/api/writing/topics/random')
    const data = await response.json()
    if (data.success) {
      currentTopic.value = data.data
    }
  } catch (error) {
    console.error('加载题目失败:', error)
  }
}

// 换题
const changeTopic = () => {
  loadTopic()
  if (editor.value) {
    editor.value.commands.clearContent()
  }
}

// 计时器功能
const startTimer = () => {
  startTime.value = Date.now()
  timer.value = setInterval(() => {
    elapsedTime.value = Math.floor((Date.now() - startTime.value) / 1000)
  }, 1000)
}

const stopTimer = () => {
  if (timer.value) {
    clearInterval(timer.value)
    timer.value = null
  }
}

const showTimer = () => {
  // 可以在这里添加计时器相关的逻辑
}

// 提交评测
const submitWriting = async () => {
  if (!currentTopic.value || !editor.value) return

  const content = editor.value.getText()
  if (wordCount.value < (currentTopic.value.min_words || 250)) {
    ElMessage.warning('字数不足，请继续写作')
    return
  }

  submitting.value = true
  stopTimer()

  try {
    const response = await fetch('/api/assessment/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicId: currentTopic.value.id,
        content,
        wordCount: wordCount.value,
        timeSpent: elapsedTime.value,
      }),
    })

    const data = await response.json()
    if (data.success) {
      showResult.value = true
      assessmentResult.value = data.data
    } else {
      ElMessage.error('提交失败: ' + data.message)
    }
  } catch (error) {
    console.error('提交失败:', error)
    ElMessage.error('提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// 流式提交
const submitWritingStream = async () => {
  if (!currentTopic.value || !editor.value) return

  const content = editor.value.getText()
  if (wordCount.value < (currentTopic.value.min_words || 250)) {
    ElMessage.warning('字数不足，请继续写作')
    return
  }

  submitting.value = true
  showAIProgress.value = true
  progressPercentage.value = 0
  progressText.value = '开始AI评估...'
  progressStatus.value = 'success'
  stopTimer()

  try {
    const eventSource = new EventSource('/api/assessment/stream')

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)

      switch (data.type) {
        case 'progress':
          progressPercentage.value = data.progress
          progressText.value = data.message
          break
        case 'complete':
          progressPercentage.value = 100
          progressText.value = '评估完成！'
          showResult.value = true
          assessmentResult.value = data.content
          eventSource.close()
          break
        case 'error':
          progressStatus.value = 'exception'
          progressText.value = '评估失败: ' + data.message
          eventSource.close()
          break
      }
    }

    // 发送流式请求
    await fetch('/api/assessment/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicId: currentTopic.value.id,
        content,
        wordCount: wordCount.value,
        timeSpent: elapsedTime.value,
      }),
    })

  } catch (error) {
    console.error('流式提交失败:', error)
    progressStatus.value = 'exception'
    progressText.value = '连接失败，请重试'
  } finally {
    submitting.value = false
    showAIProgress.value = false
  }
}

// 重新评分
const reassess = () => {
  showResult.value = false
  submitWriting()
}

// 写新作文
const writeNewEssay = () => {
  showResult.value = false
  changeTopic()
  startTimer()
}

// 保存草稿
const saveDraft = async () => {
  if (!editor.value) return

  const content = editor.value.getText()
  if (!content.trim()) {
    ElMessage.warning('内容为空，无需保存')
    return
  }

  try {
    const response = await fetch('/api/writing/drafts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: currentTopic.value?.title || '未命名草稿',
        content,
        wordCount: wordCount.value,
        topicId: currentTopic.value?.id,
      }),
    })

    const data = await response.json()
    if (data.success) {
      ElMessage.success('草稿保存成功')
      loadDrafts()
    }
  } catch (error) {
    console.error('保存草稿失败:', error)
    ElMessage.error('保存草稿失败')
  }
}

// 加载草稿
const loadDrafts = async () => {
  try {
    const response = await fetch('/api/writing/drafts')
    const data = await response.json()
    if (data.success) {
      drafts.value = data.data
    }
  } catch (error) {
    console.error('加载草稿失败:', error)
  }
}

const loadDraft = (draft) => {
  if (editor.value && draft.content) {
    editor.value.commands.setContent(draft.content)
    ElMessage.success('草稿加载成功')
  }
}

// 清空内容
const clearContent = () => {
  if (editor.value) {
    editor.value.commands.clearContent()
    ElMessage.success('内容已清空')
  }
}

// 返回
const goBack = () => {
  router.push('/')
}

// 其他功能
const toggleTips = () => {
  showTips.value = !showTips.value
}

const insertTemplate = (type) => {
  selectedTemplate.value = type
  showTemplateDialog.value = true
}

const insertTransition = () => {
  if (!editor.value) return

  const transitions = [
    'Therefore, ', 'However, ', 'Moreover, ', 'Furthermore, ',
    'In addition, ', 'On the other hand, ', 'Nevertheless, ', 'In contrast, '
  ]

  const transition = transitions[Math.floor(Math.random() * transitions.length)]
  editor.value.chain().focus().insertContent(transition).run()
}

const insertSelectedTemplate = () => {
  if (!editor.value) return

  const templates = {
    introduction: `I completely agree/disagree with the statement that... In this essay, I will explain my reasons and provide relevant examples to support my view.`,
    body: `Firstly, ... For example, ... This clearly shows that... Secondly, ... Moreover, ...`,
    conclusion: `In conclusion, ... Overall, I believe that the evidence strongly supports my view that...`
  }

  const template = templates[selectedTemplate.value]
  editor.value.chain().focus().insertContent(template).run()

  showTemplateDialog.value = false
}

const handleAIConfigSuccess = () => {
  ElMessage.success('AI配置已更新')
}
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
  padding: 0 20px;
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

.header-right {
  display: flex;
  gap: 10px;
}

.writing-main {
  padding: 20px;
  height: calc(100vh - 60px);
}

.writing-interface {
  display: flex;
  gap: 20px;
  height: 100%;
}

.writing-area {
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}

.topic-card {
  background: white;
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topic-content {
  margin-top: 15px;
}

.topic-type {
  font-size: 14px;
  color: #606266;
  margin-bottom: 10px;
}

.topic-requirements {
  margin-top: 15px;
}

.topic-requirements .el-tag {
  margin-right: 8px;
}

.editor-card {
  flex: 1;
  background: white;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-info {
  display: flex;
  gap: 20px;
  font-size: 14px;
  color: #606266;
}

.editor-container {
  height: 400px;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}

.editor {
  height: 100%;
  padding: 20px;
}

.ai-progress {
  margin-top: 20px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
}

.progress-text {
  text-align: center;
  margin-top: 10px;
  color: #606266;
}

.tools-area {
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
}

.tips-card,
.stats-card,
.tools-card,
.drafts-card {
  background: white;
}

.tips-content {
  margin-top: 15px;
}

.tip-item {
  margin-bottom: 20px;
}

.tip-item h4 {
  color: #303133;
  margin-bottom: 10px;
  font-size: 14px;
}

.tip-item ul {
  margin: 0;
  padding-left: 20px;
}

.tip-item li {
  margin-bottom: 5px;
  font-size: 13px;
  color: #606266;
  line-height: 1.4;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
  margin-bottom: 20px;
}

.stat-item {
  text-align: center;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #409EFF;
  margin-bottom: 5px;
}

.stat-label {
  font-size: 12px;
  color: #606266;
}

.progress-bar {
  margin-top: 10px;
}

.progress-text {
  text-align: center;
  font-size: 12px;
  color: #606266;
  margin-top: 5px;
}

.tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.drafts-list {
  max-height: 200px;
  overflow-y: auto;
}

.draft-item {
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.draft-item:hover {
  border-color: #409EFF;
  background: #f0f9ff;
}

.draft-title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 5px;
}

.draft-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #909399;
}

.no-drafts {
  text-align: center;
  color: #909399;
  padding: 20px;
}

.template-options {
  margin-bottom: 20px;
}

@media (max-width: 768px) {
  .writing-interface {
    flex-direction: column;
  }

  .writing-area,
  .tools-area {
    width: 100% !important;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .tools-grid {
    grid-template-columns: 1fr;
  }
}
</style>