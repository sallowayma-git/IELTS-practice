<template>
  <el-dialog
    v-model="visible"
    title="AI评估进度"
    width="500px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <div class="progress-content">
      <!-- 当前阶段 -->
      <div class="current-stage">
        <h4>{{ currentStage.title }}</h4>
        <p>{{ currentStage.message }}</p>
      </div>

      <!-- 进度条 -->
      <div class="progress-bar">
        <el-progress
          :percentage="progress * 100"
          :status="progressStatus"
          :stroke-width="8"
          :format="formatProgress"
        />
      </div>

      <!-- 详细信息 -->
      <div class="details" v-if="details.length > 0">
        <h4>评估详情</h4>
        <el-timeline>
          <el-timeline-item
            v-for="(item, index) in details"
            :key="index"
            :type="item.type"
            :icon="item.icon"
            :timestamp="item.timestamp"
          >
            {{ item.content }}
          </el-timeline-item>
        </el-timeline>
      </div>

      <!-- 评估结果预览 -->
      <div class="preview" v-if="previewResult">
        <h4>评估结果预览</h4>
        <div class="score-preview">
          <div class="overall-score">
            <el-progress
              type="circle"
              :percentage="(previewResult.overall_score / 9) * 100"
              :color="getScoreColor(previewResult.overall_score)"
              :width="80"
            >
              <template #default="{ percentage }">
                <span class="score-number">{{ previewResult.overall_score }}</span>
              </template>
            </el-progress>
            <div class="score-info">
              <div class="level">{{ previewResult.level }}</div>
              <div class="description">{{ previewResult.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button
          v-if="canCancel"
          @click="cancelAssessment"
          :disabled="isCompleted"
        >
          取消评估
        </el-button>
        <el-button
          v-if="isCompleted"
          type="primary"
          @click="viewResult"
        >
          查看完整结果
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'cancel', 'complete'])

const router = useRouter()

const visible = ref(false)
const progress = ref(0)
const isCompleted = ref(false)
const canCancel = ref(true)
const eventSource = ref(null)

const currentStage = ref({
  title: '正在准备评估...',
  message: 'AI正在分析您的作文'
})

const details = ref([])
const previewResult = ref(null)

const progressStatus = computed(() => {
  if (isCompleted.value) return 'success'
  if (progress.value >= 0.8) return 'warning'
  return 'info'
})

// 监听visible变化
watch(() => props.modelValue, (val) => {
  visible.value = val
})

// 监听visible变化
watch(visible, (val) => {
  emit('update:modelValue', val)
  if (!val) {
    cleanup()
  }
})

const formatProgress = (percentage) => {
  return `${Math.round(percentage)}%`
}

const getScoreColor = (score) => {
  if (score >= 7) return '#67C23A'
  if (score >= 6) return '#E6A23C'
  return '#F56C6C'
}

const addDetail = (content, type = 'primary') => {
  const icons = {
    primary: 'Clock',
    success: 'Check',
    warning: 'Warning',
    info: 'Info'
  }

  details.value.push({
    content,
    type,
    icon: icons[type],
    timestamp: new Date().toLocaleTimeString()
  })
}

const updateStage = (stage) => {
  currentStage.value = stage
  addDetail(stage.message, 'primary')
}

const updateProgress = (progressData) => {
  if (progressData.progress !== undefined) {
    progress.value = progressData.progress
  }

  if (progressData.stage) {
    updateStage({
      title: progressData.stage,
      message: progressData.message || '正在处理...'
    })
  }

  if (progressData.content && progressData.type === 'complete') {
    handleComplete(progressData.content)
  }

  if (progressData.type === 'error') {
    handleError(progressData.message || '评估失败')
  }
}

const handleComplete = (result) => {
  isCompleted.value = true
  canCancel.value = false
  progress.value = 1
  previewResult.value = result

  updateStage({
    title: '评估完成！',
    message: 'AI评估已完成，点击查看详细结果'
  })

  addDetail('评估完成', 'success')
  emit('complete', result)
}

const handleError = (errorMessage) => {
  isCompleted.value = true
  canCancel.value = false

  updateStage({
    title: '评估失败',
    message: errorMessage
  })

  addDetail(`评估失败: ${errorMessage}`, 'error')
  ElMessage.error(errorMessage)
}

const cancelAssessment = () => {
  if (eventSource.value) {
    eventSource.value.close()
  }
  emit('cancel')
  visible.value = false
}

const viewResult = () => {
  if (previewResult.value) {
    router.push(`/assessment/${previewResult.value.id}`)
    visible.value = false
  }
}

const cleanup = () => {
  if (eventSource.value) {
    eventSource.value.close()
    eventSource.value = null
  }

  // 重置状态
  progress.value = 0
  isCompleted.value = false
  canCancel.value = true
  details.value = []
  previewResult.value = null
  currentStage.value = {
    title: '正在准备评估...',
    message: 'AI正在分析您的作文'
  }
}

// 暴露方法给父组件
defineExpose({
  updateProgress,
  cleanup
})
</script>

<style scoped>
.progress-content {
  padding: 20px 0;
}

.current-stage {
  text-align: center;
  margin-bottom: 20px;
}

.current-stage h4 {
  margin: 0 0 8px 0;
  color: #2c3e50;
}

.current-stage p {
  margin: 0;
  color: #7f8c8d;
}

.progress-bar {
  margin: 20px 0;
}

.details {
  margin: 20px 0;
  max-height: 200px;
  overflow-y: auto;
}

.details h4 {
  margin: 0 0 12px 0;
  color: #2c3e50;
}

.preview {
  margin: 20px 0;
  padding: 16px;
  background: #f8f9fa;
  border-radius: 8px;
}

.preview h4 {
  margin: 0 0 12px 0;
  color: #2c3e50;
}

.score-preview {
  display: flex;
  align-items: center;
  gap: 16px;
}

.overall-score {
  display: flex;
  align-items: center;
  gap: 16px;
}

.score-number {
  font-size: 1.5rem;
  font-weight: bold;
  color: #2c3e50;
}

.score-info {
  flex: 1;
}

.level {
  font-size: 1.1rem;
  font-weight: 600;
  color: #409EFF;
  margin-bottom: 4px;
}

.description {
  font-size: 0.9rem;
  color: #7f8c8d;
  line-height: 1.4;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>