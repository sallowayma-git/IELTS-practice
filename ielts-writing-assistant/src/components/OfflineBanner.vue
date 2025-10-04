<template>
  <div class="offline-banner" v-if="showBanner" :class="bannerType">
    <div class="banner-content">
      <div class="banner-icon">
        <el-icon><component :is="bannerIcon" /></el-icon>
      </div>
      <div class="banner-text">
        <h4>{{ bannerTitle }}</h4>
        <p>{{ bannerMessage }}</p>
      </div>
      <div class="banner-actions">
        <el-button v-if="isOffline" @click="retryConnection" :loading="retrying" size="small">
          重试连接
        </el-button>
        <el-button @click="dismissBanner" size="small" text>
          知道了
        </el-button>
      </div>
    </div>

    <!-- 离线功能说明 -->
    <div class="offline-features" v-if="isOffline && showFeatures">
      <h5>离线可用功能</h5>
      <ul>
        <li v-for="feature in offlineFeatures" :key="feature.name">
          <el-icon><Check /></el-icon>
          <span>{{ feature.name }}: {{ feature.description }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Warning, Info, Loading, Check } from '@element-plus/icons-vue'

const props = defineProps({
  isOffline: {
    type: Boolean,
    default: false
  },
  autoShow: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['retry', 'dismiss'])

// 状态管理
const showBanner = ref(false)
const showFeatures = ref(false)
const retrying = ref(false)
const dismissed = ref(false)

// 离线功能列表
const offlineFeatures = ref([
  {
    name: '写作练习',
    description: '可以继续写作，数据会自动保存'
  },
  {
    name: '查看历史',
    description: '可以查看之前的写作记录'
  },
  {
    name: '本地设置',
    description: '可以修改应用设置'
  },
  {
    name: '草稿管理',
    description: '可以管理本地草稿'
  }
])

// 计算属性
const bannerType = computed(() => {
  if (props.isOffline) return 'offline'
  if (retrying.value) return 'retrying'
  return 'online'
})

const bannerTitle = computed(() => {
  if (props.isOffline) return '网络连接已断开'
  if (retrying.value) return '正在重连...'
  return '网络连接已恢复'
})

const bannerMessage = computed(() => {
  if (props.isOffline) {
    return '应用已切换到离线模式，部分功能可能受限。您可以继续使用基本功能，数据将在联网后自动同步。'
  }
  if (retrying.value) {
    return '正在尝试重新连接到服务器...'
  }
  return '网络连接已恢复正常，离线数据将自动同步。'
})

const bannerIcon = computed(() => {
  if (props.isOffline) return Warning
  if (retrying.value) return Loading
  return Info
})

// 生命周期
onMounted(() => {
  // 检查是否应该显示横幅
  if (props.autoShow && !wasDismissedRecently()) {
    if (props.isOffline) {
      showBanner.value = true
      showFeatures.value = true
    }
  }

  // 监听网络状态变化
  window.addEventListener('online', handleNetworkChange)
  window.addEventListener('offline', handleNetworkChange)
})

onUnmounted(() => {
  window.removeEventListener('online', handleNetworkChange)
  window.removeEventListener('offline', handleNetworkChange)
})

// 方法
const handleNetworkChange = () => {
  if (props.isOffline && !wasDismissedRecently()) {
    showBanner.value = true
    showFeatures.value = true
  } else if (!props.isOffline) {
    showBanner.value = true
    showFeatures.value = false

    // 3秒后自动隐藏在线横幅
    setTimeout(() => {
      if (!props.isOffline) {
        showBanner.value = false
      }
    }, 3000)
  }
}

const retryConnection = async () => {
  retrying.value = true
  emit('retry')

  try {
    // 模拟连接测试
    await testConnection()

    ElMessage.success('网络连接已恢复')
    showBanner.value = false

  } catch (error) {
    ElMessage.error('连接失败，请稍后重试')

    // 5秒后停止重试
    setTimeout(() => {
      retrying.value = false
    }, 5000)
  }
}

const testConnection = async () => {
  const response = await fetch('/api/health', {
    method: 'HEAD',
    timeout: 5000
  })

  if (!response.ok) {
    throw new Error('连接测试失败')
  }
}

const dismissBanner = () => {
  showBanner.value = false
  dismissed.value = true

  // 记录用户操作时间
  localStorage.setItem('offlineBannerDismissed', new Date().toISOString())

  emit('dismiss')
}

const wasDismissedRecently = () => {
  if (!dismissed.value) return false

  try {
    const lastDismissed = localStorage.getItem('offlineBannerDismissed')
    if (!lastDismissed) return false

    const dismissedTime = new Date(lastDismissed)
    const now = new Date()
    const hoursDiff = (now - dismissedTime) / (1000 * 60 * 60)

    // 如果在24小时内被忽略过，则不再自动显示
    return hoursDiff < 24
  } catch (error) {
    return false
  }
}

// 暴露方法
defineExpose({
  show: () => {
    showBanner.value = true
  },
  hide: () => {
    showBanner.value = false
  },
  toggleFeatures: () => {
    showFeatures.value = !showFeatures.value
  }
})
</script>

<style scoped>
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  animation: slideDown 0.3s ease-out;
}

.offline-banner.offline {
  background: linear-gradient(135deg, #F56C6C 0%, #E6A23C 100%);
  color: white;
}

.offline-banner.online {
  background: linear-gradient(135deg, #67C23A 0%, #409EFF 100%);
  color: white;
}

.offline-banner.retrying {
  background: linear-gradient(135deg, #E6A23C 0%, #F56C6C 100%);
  color: white;
}

.banner-content {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  gap: 15px;
}

.banner-icon {
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
}

.banner-text {
  flex: 1;
}

.banner-text h4 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
}

.banner-text p {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
  opacity: 0.9;
}

.banner-actions {
  display: flex;
  gap: 8px;
}

.offline-features {
  background: rgba(255, 255, 255, 0.1);
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.offline-features h5 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  opacity: 0.9;
}

.offline-features ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.offline-features li {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
}

.offline-features li:last-child {
  margin-bottom: 0;
}

.offline-features .el-icon {
  font-size: 16px;
  color: #67C23A;
}

@keyframes slideDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .banner-content {
    flex-direction: column;
    text-align: center;
    gap: 12px;
  }

  .banner-actions {
    justify-content: center;
  }

  .offline-features {
    padding: 12px 16px;
  }

  .banner-text h4 {
    font-size: 15px;
  }

  .banner-text p {
    font-size: 13px;
  }
}

/* 按钮样式覆盖 */
.offline-banner .el-button {
  border-color: rgba(255, 255, 255, 0.3);
  color: white;
}

.offline-banner .el-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.5);
}

.offline-banner .el-button--text {
  border-color: transparent;
  opacity: 0.8;
}

.offline-banner .el-button--text:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}
</style>