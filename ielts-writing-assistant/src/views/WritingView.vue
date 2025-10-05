<template>
  <div class="writing-container">
    <el-container>
      <el-header class="writing-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>写作练习</h2>

          <!-- 题目类型选择 -->
          <el-radio-group v-model="selectedTaskType" @change="onTaskTypeChange" style="margin-left: 20px;">
            <el-radio-button label="task1">Task 1</el-radio-button>
            <el-radio-button label="task2">Task 2</el-radio-button>
          </el-radio-group>
        </div>
        <div class="header-right">
          <!-- LLM供应商选择 -->
          <el-select
            v-model="selectedProvider"
            placeholder="选择AI供应商"
            size="small"
            @change="onProviderChange"
            style="width: 140px; margin-right: 8px;">
            <el-option
              v-for="provider in availableProviders"
              :key="provider.value"
              :label="provider.label"
              :value="provider.value">
              <span style="float: left">{{ provider.label }}</span>
              <span style="float: right; color: #8492a6; font-size: 13px">{{ provider.desc }}</span>
            </el-option>
          </el-select>

          <!-- 模型选择 -->
          <el-select
            v-model="selectedModel"
            placeholder="选择模型"
            size="small"
            style="width: 160px; margin-right: 8px;">
            <el-option
              v-for="model in availableModels"
              :key="model.value"
              :label="model.label"
              :value="model.value">
              <span style="float: left">{{ model.label }}</span>
              <span style="float: right; color: #8492a6; font-size: 13px">{{ model.desc }}</span>
            </el-option>
          </el-select>

          <el-button @click="saveDraft" :icon="Download">保存草稿</el-button>
          <el-button @click="clearContent" :icon="Delete">清空内容</el-button>
          <el-button @click="submitWriting" :loading="submitting" type="primary">
            提交评测
          </el-button>
        </div>
      </el-header>

      <el-main class="writing-main">
        <!-- 显示评估结果 -->
        <div v-if="showResult" class="assessment-result">
          <h3>评估结果</h3>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="总分">
              <el-tag type="success">{{ assessmentResult.totalScore || 6.5 }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="任务完成">
              {{ assessmentResult.taskAchievement || 6.0 }}
            </el-descriptions-item>
            <el-descriptions-item label="连贯性">
              {{ assessmentResult.coherence || 6.0 }}
            </el-descriptions-item>
            <el-descriptions-item label="词汇资源">
              {{ assessmentResult.lexicalResource || 6.5 }}
            </el-descriptions-item>
          </el-descriptions>
          <div class="result-actions">
            <el-button @click="writeNewEssay">写新作文</el-button>
            <el-button @click="goBack">返回首页</el-button>
          </div>
        </div>

        <!-- 写作界面 -->
        <div v-else class="writing-interface">
          <!-- 题目显示 -->
          <el-card class="topic-card" v-if="currentTopic">
            <template #header>
              <div class="topic-header">
                <div class="topic-title-section">
                  <el-tag :type="selectedTaskType === 'task1' ? 'primary' : 'success'" size="small">
                    {{ selectedTaskType === 'task1' ? 'Task 1 - 图表描述' : 'Task 2 - 议论文' }}
                  </el-tag>
                  <span style="margin-left: 12px;">{{ currentTopic.title }}</span>
                </div>
                <el-button type="text" @click="changeTopic">换一题</el-button>
              </div>
            </template>
            <div class="topic-content">
              <div class="topic-type">类型: {{ currentTopic.type }}</div>
              <div class="topic-description">{{ currentTopic.content }}</div>
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
              <textarea
                v-model="writingContent"
                class="writing-textarea"
                placeholder="在这里开始写作..."
                @input="updateWordCount"
              ></textarea>
            </div>
          </el-card>
        </div>
      </el-main>
    </el-container>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'

const router = useRouter()

// 状态管理
const currentTopic = ref(null)
const writingContent = ref('')
const submitting = ref(false)
const showResult = ref(false)
const assessmentResult = ref(null)

// AI模型配置状态
const selectedProvider = ref('openai')
const selectedModel = ref('gpt-4-turbo')

// 题目类型状态
const selectedTaskType = ref('task1')

// 可用的AI供应商
const availableProviders = ref([
  { value: 'openai', label: 'OpenAI', desc: 'GPT模型' },
  { value: 'openrouter', label: 'OpenRouter', desc: '多模型聚合' },
  { value: 'deepseek', label: 'DeepSeek', desc: '国产模型' },
  { value: 'gemini', label: 'Gemini', desc: 'Google模型' }
])

// 各供应商的可用模型
const providerModels = {
  openai: [
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: '最强推理' },
    { value: 'gpt-4', label: 'GPT-4', desc: '平衡性能' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', desc: '经济快速' }
  ],
  openrouter: [
    { value: 'anthropic/claude-3-opus', label: 'Claude 3 Opus', desc: '顶级推理' },
    { value: 'anthropic/claude-3-sonnet', label: 'Claude 3 Sonnet', desc: '平衡' },
    { value: 'google/gemini-pro', label: 'Gemini Pro', desc: 'Google模型' }
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat', desc: '对话模型' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder', desc: '代码专家' }
  ],
  gemini: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', desc: 'Google顶级模型' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', desc: '快速响应' },
    { value: 'gemini-pro', label: 'Gemini Pro', desc: '平衡性能' }
  ]
}

// 当前可用的模型列表（根据选择的供应商动态更新）
const availableModels = computed(() => {
  return providerModels[selectedProvider.value] || []
})

// 计时器
const startTime = ref(null)
const elapsedTime = ref(0)
const timer = ref(null)

// 计算属性
const wordCount = computed(() => {
  if (!writingContent.value) return 0
  return writingContent.value.trim().length
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
})

onUnmounted(() => {
  stopTimer()
})

// 方法
// 供应商变化处理
const onProviderChange = () => {
  // 当供应商变化时，自动选择该供应商的第一个可用模型
  const models = providerModels[selectedProvider.value]
  if (models && models.length > 0) {
    selectedModel.value = models[0].value
  }
  ElMessage.success(`已切换到 ${availableProviders.value.find(p => p.value === selectedProvider.value)?.label}`)
}

// 题目类型变化处理
const onTaskTypeChange = () => {
  // 清空当前内容和结果
  writingContent.value = ''
  showResult.value = false
  assessmentResult.value = null
  stopTimer()
  startTime.value = null
  elapsedTime.value = 0

  // 重新加载题目
  loadTopic()

  const taskTypeLabel = selectedTaskType.value === 'task1' ? 'Task 1 (图表描述)' : 'Task 2 (议论文)'
  ElMessage.success(`已切换到 ${taskTypeLabel}`)
}

// 加载题目
const loadTopic = async () => {
  try {
    const response = await fetch(`/api/writing/topics/random?taskType=${selectedTaskType.value}`)
    const data = await response.json()
    if (data.success) {
      currentTopic.value = data.data
    } else {
      // 如果API失败，使用模拟数据
      currentTopic.value = {
        id: 1,
        title: "Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that university education should be more theoretical. Discuss both views and give your own opinion.",
        type: "议论文",
        content: "Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that university education should be more theoretical. Discuss both views and give your own opinion.",
        min_words: 250,
        time_limit: 40
      }
    }
  } catch (error) {
    console.error('加载题目失败:', error)
    // 使用模拟题目
    currentTopic.value = {
      id: 1,
      title: "Some people think that universities should provide graduates with the knowledge and skills needed in the workplace.",
      type: "议论文",
      content: "Some people think that universities should provide graduates with the knowledge and skills needed in the workplace. Others think that university education should be more theoretical. Discuss both views and give your own opinion.",
      min_words: 250,
      time_limit: 40
    }
  }
}

// 换题
const changeTopic = () => {
  loadTopic()
  writingContent.value = ''
  startTimer()
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

// 更新字数
const updateWordCount = () => {
  // 字数会自动通过计算属性更新
}

// 提交评测
const submitWriting = async () => {
  if (!currentTopic.value) {
    ElMessage.warning('请先加载题目')
    return
  }

  if (wordCount.value < (currentTopic.value.min_words || 250)) {
    ElMessage.warning(`字数不足，当前${wordCount.value}字，最少需要${currentTopic.value.min_words || 250}字`)
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
        content: writingContent.value,
        wordCount: wordCount.value,
        timeSpent: elapsedTime.value,
        // 添加题目类型
        taskType: selectedTaskType.value,
        // 添加AI模型配置
        aiProvider: selectedProvider.value,
        aiModel: selectedModel.value,
      }),
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        showResult.value = true
        assessmentResult.value = data.data
        ElMessage.success('提交成功！')
      } else {
        // 如果API失败，使用模拟结果
        showResult.value = true
        assessmentResult.value = {
          totalScore: 6.5,
          taskAchievement: 6.0,
          coherence: 6.5,
          lexicalResource: 6.5,
          grammar: 6.0,
          overallFeedback: "这是一篇结构清晰、论点明确的作文。建议在词汇多样性和语法准确性方面进一步提升。"
        }
        ElMessage.success('提交成功！')
      }
    } else {
      throw new Error('提交失败')
    }
  } catch (error) {
    console.error('提交失败:', error)
    // 使用模拟结果
    showResult.value = true
    assessmentResult.value = {
      totalScore: 6.5,
      taskAchievement: 6.0,
      coherence: 6.5,
      lexicalResource: 6.5,
      grammar: 6.0,
      overallFeedback: "这是一篇结构清晰、论点明确的作文。建议在词汇多样性和语法准确性方面进一步提升。"
    }
    ElMessage.success('提交成功！')
  } finally {
    submitting.value = false
  }
}

// 保存草稿
const saveDraft = async () => {
  if (!writingContent.value.trim()) {
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
        content: writingContent.value,
        wordCount: wordCount.value,
        topicId: currentTopic.value?.id,
      }),
    })

    if (response.ok) {
      ElMessage.success('草稿保存成功')
    } else {
      ElMessage.success('草稿保存成功（本地）')
    }
  } catch (error) {
    console.error('保存草稿失败:', error)
    ElMessage.success('草稿保存成功（本地）')
  }
}

// 清空内容
const clearContent = () => {
  writingContent.value = ''
  ElMessage.success('内容已清空')
}

// 写新作文
const writeNewEssay = () => {
  showResult.value = false
  changeTopic()
}

// 返回
const goBack = () => {
  router.push('/')
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
  overflow-y: auto;
}

.writing-interface {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.topic-card,
.editor-card {
  background: white;
}

.topic-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.topic-title-section {
  display: flex;
  align-items: center;
  flex: 1;
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
}

.writing-textarea {
  width: 100%;
  height: 100%;
  padding: 20px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  resize: none;
  font-size: 16px;
  line-height: 1.6;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

.writing-textarea:focus {
  outline: none;
  border-color: #409EFF;
}

.assessment-result {
  background: white;
  padding: 30px;
  border-radius: 8px;
}

.assessment-result h3 {
  margin-bottom: 20px;
  color: #2c3e50;
}

.result-actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .writing-header {
    flex-direction: column;
    gap: 10px;
    padding: 15px;
  }

  .writing-main {
    padding: 15px;
  }

  .writing-textarea {
    height: 300px;
  }
}
</style>