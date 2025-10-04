<template>
  <div id="app">
    <!-- 离线横幅 -->
    <OfflineBanner
      :isOffline="isOffline"
      @retry="handleRetryConnection"
      @dismiss="handleBannerDismiss"
    />

    <!-- 网络状态指示器 -->
    <NetworkStatus ref="networkStatusRef" />

    <!-- 主应用内容 -->
    <router-view />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import OfflineBanner from '@/components/OfflineBanner.vue'
import NetworkStatus from '@/components/NetworkStatus.vue'
import networkManager from '@/services/networkManager'
import offlineManager from '@/services/offlineManager'

// 状态管理
const isOffline = ref(!navigator.onLine)
const networkStatusRef = ref()

// 网络状态监听
const handleOnline = () => {
  isOffline.value = false
  console.log('网络连接已恢复')
}

const handleOffline = () => {
  isOffline.value = true
  console.log('网络连接已断开')
}

// 处理重连请求
const handleRetryConnection = () => {
  networkManager.detectNetworkQuality()
}

// 处理横幅关闭
const handleBannerDismiss = () => {
  console.log('用户已关闭离线横幅')
}

// 全局错误处理
const handleGlobalError = (event) => {
  console.error('全局错误:', event.error)

  // 如果是网络错误，添加到日志
  if (event.error?.message?.includes('network') || event.error?.message?.includes('fetch')) {
    networkManager.emit('networkError', {
      error: event.error.message,
      url: window.location.href,
      timestamp: new Date().toISOString()
    })
  }
}

// 未处理的Promise拒绝
const handleUnhandledRejection = (event) => {
  console.error('未处理的Promise拒绝:', event.reason)

  // 如果是网络相关的拒绝，记录到离线管理器
  if (event.reason?.message?.includes('network') || event.reason?.message?.includes('fetch')) {
    offlineManager.addToSyncQueue({
      type: 'error',
      data: {
        error: event.reason.message,
        url: window.location.href,
        timestamp: new Date().toISOString()
      }
    })
  }
}

// 生命周期
onMounted(() => {
  // 添加网络状态监听器
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // 添加全局错误处理
  window.addEventListener('error', handleGlobalError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)

  // 初始化网络管理器
  networkManager.initializeNetworkConfig()

  // 检测初始网络状态
  isOffline.value = !navigator.onLine

  console.log('应用已初始化，网络状态:', navigator.onLine ? '在线' : '离线')
})

onUnmounted(() => {
  // 清理事件监听器
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  window.removeEventListener('error', handleGlobalError)
  window.removeEventListener('unhandledrejection', handleUnhandledRejection)
})
</script>

<style>
#app {
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  height: 100vh;
  overflow: hidden;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: #f5f7fa;
}
</style>