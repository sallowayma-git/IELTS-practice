<template>
  <div class="writing-layout">
    <TopBar
      :task-type="writingStore.taskType"
      :provider="writingStore.aiProvider"
      :model="writingStore.aiModel"
      :provider-options="providerOptions"
      :model-options="availableModels"
      @update:task-type="handleTaskTypeChange"
      @update:provider="handleProviderChange"
      @update:model="handleModelChange"
      @open-settings="openSettings"
    />
    <main class="writing-layout__content">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import TopBar from './components/TopBar.vue'
import { useWritingStore } from '@/stores/writing'

const router = useRouter()
const writingStore = useWritingStore()

const providerOptions = [
  { value: 'openai', label: 'OpenAI', desc: 'GPT 系列模型' },
  { value: 'openrouter', label: 'OpenRouter', desc: '多模型聚合' },
  { value: 'deepseek', label: 'DeepSeek', desc: '国产模型' },
  { value: 'gemini', label: 'Gemini', desc: 'Google 模型' }
]

const modelMap = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini', desc: '高效推理' },
    { value: 'gpt-4o', label: 'GPT-4o', desc: '旗舰表现' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', desc: '经济实惠' }
  ],
  openrouter: [
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', desc: '高质量输出' },
    { value: 'anthropic/claude-3-opus', label: 'Claude 3 Opus', desc: '深入推理' },
    { value: 'google/gemini-pro', label: 'Gemini Pro', desc: 'Google 官方' }
  ],
  deepseek: [
    { value: 'deepseek-chat', label: 'DeepSeek Chat', desc: '中文优化' },
    { value: 'deepseek-coder', label: 'DeepSeek Coder', desc: '编程友好' }
  ],
  gemini: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', desc: '旗舰性能' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', desc: '高速响应' }
  ]
}

const topicLoading = ref(false)

const loadTopic = async (type) => {
  topicLoading.value = true
  try {
    await writingStore.getRandomTopic(type)
  } catch (error) {
    ElMessage.warning('题目加载失败，已加载示例题目')
  } finally {
    topicLoading.value = false
  }
}

const availableModels = computed(() => {
  return modelMap[writingStore.aiProvider] || []
})

provide('writingTopicLoading', topicLoading)
provide('writingReloadTopic', async () => {
  await loadTopic(writingStore.taskType)
})

const handleTaskTypeChange = async (value) => {
  topicLoading.value = true
  try {
    await writingStore.setTaskType(value)
  } catch (error) {
    ElMessage.error('切换题目类型失败')
  } finally {
    topicLoading.value = false
  }
}

const handleProviderChange = (value) => {
  writingStore.setAiProvider(value)
  const models = modelMap[value] || []
  if (models.length > 0) {
    writingStore.setAiModel(models[0].value)
  } else {
    writingStore.setAiModel('')
  }
}

const handleModelChange = (value) => {
  writingStore.setAiModel(value)
}

const openSettings = () => {
  router.push({ name: 'Settings' })
}

watch(
  () => writingStore.aiProvider,
  (next) => {
    const models = modelMap[next] || []
    if (!models.some(item => item.value === writingStore.aiModel) && models.length > 0) {
      writingStore.setAiModel(models[0].value)
    }
  },
  { immediate: true }
)

onMounted(async () => {
  if (!writingStore.currentTopic) {
    await loadTopic(writingStore.taskType)
  }
  writingStore.loadDraft()
})
</script>

<style scoped>
.writing-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f5f7fa;
}

.writing-layout__content {
  flex: 1;
  overflow: hidden;
  padding: 24px;
}
</style>
