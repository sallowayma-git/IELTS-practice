<template>
  <div class="evaluating-page" data-test="evaluating-page">
    <el-card class="evaluating-card" shadow="never">
      <div class="evaluating-card__header">
        <h2>正在评估您的作文</h2>
        <p class="evaluating-card__subtitle">AI 正在根据 IELTS 四项评分标准生成详细反馈…</p>
      </div>
      <el-progress :percentage="progress" :stroke-width="14" status="active" data-test="evaluation-progress" />
      <ul class="evaluating-steps" data-test="evaluation-steps">
        <li :class="{ active: currentStep >= 1 }">提交作文</li>
        <li :class="{ active: currentStep >= 2 }">调用语言模型</li>
        <li :class="{ active: currentStep >= 3 }">生成评分报告</li>
      </ul>
      <div class="evaluating-actions">
        <el-button @click="cancelEvaluation" :disabled="isCompleting" data-test="cancel-evaluation-button">取消评估</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useWritingStore } from '@/stores/writing'
import { useAssessmentStore } from '@/stores/assessment'

const router = useRouter()
const writingStore = useWritingStore()
const assessmentStore = useAssessmentStore()

const progress = ref(5)
const currentStep = ref(1)
const isCompleting = ref(false)
let timer = null

const bootstrapProgress = () => {
  timer = setInterval(() => {
    if (progress.value < 90) {
      progress.value += Math.random() * 5
    }
  }, 600)
}

const finalize = () => {
  isCompleting.value = true
  progress.value = 100
  currentStep.value = 3
}

const startEvaluation = async () => {
  try {
    currentStep.value = 1
    bootstrapProgress()
    currentStep.value = 2
    const { result, writingId } = await writingStore.submitWriting({
      taskType: writingStore.taskType,
      aiProvider: writingStore.aiProvider,
      aiModel: writingStore.aiModel
    })
    finalize()
    assessmentStore.setCurrentAssessment(result, {
      writingId,
      content: writingStore.writingContent,
      topicTitle: writingStore.currentTopic?.title,
      metadata: result.metadata || {},
      wordCount: writingStore.wordCount
    })
    router.replace({ name: 'WritingResult' })
  } catch (error) {
    ElMessage.error(error?.message || '评分失败，请稍后重试')
    router.replace({ name: 'WritingCompose' })
  } finally {
    clearInterval(timer)
  }
}

const cancelEvaluation = () => {
  clearInterval(timer)
  router.replace({ name: 'WritingCompose' })
}

onMounted(() => {
  if (!writingStore.writingContent) {
    router.replace({ name: 'WritingCompose' })
    return
  }
  startEvaluation()
})

onBeforeUnmount(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.evaluating-page {
  min-height: calc(100vh - 160px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.evaluating-card {
  width: 640px;
  padding: 32px;
  border-radius: 18px;
}

.evaluating-card__header {
  margin-bottom: 24px;
}

.evaluating-card__subtitle {
  margin: 8px 0 0;
  color: #606266;
  font-size: 14px;
}

.evaluating-steps {
  list-style: none;
  display: flex;
  justify-content: space-between;
  padding: 0;
  margin: 24px 0 0;
  color: #909399;
  font-size: 13px;
}

.evaluating-steps li.active {
  color: #409eff;
  font-weight: 600;
}

.evaluating-actions {
  margin-top: 32px;
  display: flex;
  justify-content: flex-end;
}
</style>
