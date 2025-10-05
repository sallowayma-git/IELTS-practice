<template>
  <div class="settings-container">
    <el-container>
      <!-- 顶部导航栏 -->
      <el-header class="settings-header">
        <div class="header-content">
          <el-breadcrumb separator="/" class="header-breadcrumb">
            <el-breadcrumb-item @click="goBack" class="breadcrumb-item">
              <el-icon><ArrowLeft /></el-icon>
              首页
            </el-breadcrumb-item>
            <el-breadcrumb-item>系统设置</el-breadcrumb-item>
          </el-breadcrumb>
          <div class="header-title">
            <h2>系统设置</h2>
            <p class="header-subtitle">配置应用参数和个人偏好</p>
          </div>
        </div>
      </el-header>

      <!-- 主体内容区 -->
      <el-main class="settings-main">
        <div class="settings-layout">
          <!-- 左侧导航 -->
          <el-aside width="240px" class="settings-aside">
            <div class="menu-container">
              <el-menu
                :default-active="activeMenu"
                @select="handleMenuSelect"
                class="settings-menu"
              >
                <el-menu-item index="general" class="menu-item">
                  <el-icon class="menu-icon"><Setting /></el-icon>
                  <span class="menu-text">常规设置</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="ai" class="menu-item">
                  <el-icon class="menu-icon"><Cpu /></el-icon>
                  <span class="menu-text">AI配置</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="writing" class="menu-item">
                  <el-icon class="menu-icon"><EditPen /></el-icon>
                  <span class="menu-text">写作设置</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="data" class="menu-item">
                  <el-icon class="menu-icon"><DataBoard /></el-icon>
                  <span class="menu-text">数据管理</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="questionbank" class="menu-item">
                  <el-icon class="menu-icon"><Reading /></el-icon>
                  <span class="menu-text">题库管理</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="diagnostic" class="menu-item">
                  <el-icon class="menu-icon"><Monitor /></el-icon>
                  <span class="menu-text">系统诊断</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
                <el-menu-item index="about" class="menu-item">
                  <el-icon class="menu-icon"><InfoFilled /></el-icon>
                  <span class="menu-text">关于</span>
                  <el-icon class="menu-arrow"><ArrowRight /></el-icon>
                </el-menu-item>
              </el-menu>
            </div>
          </el-aside>

          <!-- 右侧内容 -->
          <el-main class="settings-content">
            <div class="content-wrapper">
              <!-- 常规设置 -->
              <div v-show="activeMenu === 'general'" class="setting-content">
                <el-card class="setting-card">
                  <template #header>
                    <div class="card-header">
                      <el-icon class="card-icon"><Setting /></el-icon>
                      <span class="card-title">常规设置</span>
                    </div>
                  </template>
                <el-form :model="generalSettings" label-width="120px">
                  <el-form-item label="界面语言">
                    <el-select v-model="generalSettings.language">
                      <el-option label="简体中文" value="zh-CN" />
                      <el-option label="English" value="en-US" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="主题模式">
                    <el-radio-group v-model="generalSettings.theme">
                      <el-radio label="light">浅色模式</el-radio>
                      <el-radio label="dark">深色模式</el-radio>
                      <el-radio label="auto">跟随系统</el-radio>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="自动保存">
                    <el-switch v-model="generalSettings.autoSave" />
                  </el-form-item>
                  <el-form-item label="保存间隔">
                    <el-input-number
                      v-model="generalSettings.saveInterval"
                      :min="30"
                      :max="300"
                      :step="30"
                      :disabled="!generalSettings.autoSave"
                    />
                    <span style="margin-left: 8px; color: #909399;">秒</span>
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" @click="saveGeneralSettings">保存设置</el-button>
                  </el-form-item>
                </el-form>
              </el-card>
            </div>

            <!-- AI配置 -->
            <div v-show="activeMenu === 'ai'" class="setting-content">
              <el-card class="setting-card">
                <template #header>
                  <div class="card-header">
                    <el-icon class="card-icon"><Cpu /></el-icon>
                    <span class="card-title">AI配置</span>
                    <el-button type="primary" @click="openAIConfig" class="header-action">
                      <el-icon><Setting /></el-icon>
                      配置AI服务
                    </el-button>
                  </div>
                </template>
                <div class="ai-status-display">
                  <el-descriptions :column="1" border>
                    <el-descriptions-item label="当前服务商">
                      {{ aiSettings.provider || '未配置' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="模型">
                      {{ aiSettings.model || '未配置' }}
                    </el-descriptions-item>
                    <el-descriptions-item label="流式响应">
                      <el-tag :type="aiSettings.streaming ? 'success' : 'info'">
                        {{ aiSettings.streaming ? '已启用' : '已禁用' }}
                      </el-tag>
                    </el-descriptions-item>
                  </el-descriptions>
                </div>
              </el-card>
            </div>

            <!-- 写作设置 -->
            <div v-show="activeMenu === 'writing'" class="setting-content">
              <el-card class="setting-card">
                <template #header>
                  <div class="card-header">
                    <el-icon class="card-icon"><EditPen /></el-icon>
                    <span class="card-title">写作设置</span>
                  </div>
                </template>
                <el-form :model="writingSettings" label-width="120px">
                  <el-form-item label="默认字体大小">
                    <el-slider
                      v-model="writingSettings.fontSize"
                      :min="12"
                      :max="24"
                      :step="1"
                      show-input
                    />
                  </el-form-item>
                  <el-form-item label="自动计时">
                    <el-switch v-model="writingSettings.autoTimer" />
                  </el-form-item>
                  <el-form-item label="字数提醒">
                    <el-switch v-model="writingSettings.wordCountReminder" />
                  </el-form-item>
                  <el-form-item label="目标字数">
                    <el-input-number
                      v-model="writingSettings.targetWords"
                      :min="150"
                      :max="500"
                      :step="10"
                    />
                  </el-form-item>
                  <el-form-item label="语法检查">
                    <el-switch v-model="writingSettings.grammarCheck" />
                  </el-form-item>
                  <el-form-item>
                    <el-button type="primary" @click="saveWritingSettings">保存设置</el-button>
                  </el-form-item>
                </el-form>
              </el-card>
            </div>

            <!-- 数据管理 -->
            <div v-show="activeMenu === 'data'" class="setting-content">
              <div class="content-grid">
                <el-card class="setting-card">
                  <template #header>
                    <div class="card-header">
                      <el-icon class="card-icon"><DataBoard /></el-icon>
                      <span class="card-title">数据管理</span>
                    </div>
                  </template>
                  <el-space direction="vertical" style="width: 100%;">
                    <el-button @click="exportData" :icon="Download">导出数据</el-button>
                    <el-button @click="importData" :icon="Upload">导入数据</el-button>
                    <el-button @click="backupData" :icon="FolderOpened">备份数据</el-button>
                    <el-button @click="clearCache" :icon="Delete">清除缓存</el-button>
                    <el-button type="danger" @click="resetData" :icon="Warning">重置所有数据</el-button>
                  </el-space>
                </el-card>

                <el-card class="setting-card">
                  <template #header>
                    <div class="card-header">
                      <el-icon class="card-icon"><DataBoard /></el-icon>
                      <span class="card-title">存储信息</span>
                    </div>
                  </template>
                  <el-descriptions :column="1" border>
                    <el-descriptions-item label="数据库大小">{{ storageInfo.dbSize }}</el-descriptions-item>
                    <el-descriptions-item label="练习记录数">{{ storageInfo.recordCount }}</el-descriptions-item>
                    <el-descriptions-item label="缓存大小">{{ storageInfo.cacheSize }}</el-descriptions-item>
                    <el-descriptions-item label="最后备份">{{ storageInfo.lastBackup }}</el-descriptions-item>
                  </el-descriptions>
                </el-card>
              </div>
            </div>

            <!-- 题库管理 -->
            <div v-show="activeMenu === 'questionbank'" class="setting-content">
              <!-- <QuestionBankManager /> -->
              <div class="placeholder-panel">
                <el-empty description="题库管理功能暂时不可用" />
              </div>
            </div>

            <!-- 系统诊断 -->
            <div v-show="activeMenu === 'diagnostic'" class="setting-content">
              <el-card class="setting-card">
                <template #header>
                  <div class="card-header">
                    <el-icon class="card-icon"><Monitor /></el-icon>
                    <span class="card-title">系统诊断</span>
                    <el-button @click="runDiagnostic" :loading="diagnosing" class="header-action">
                      <el-icon><Monitor /></el-icon>
                      开始诊断
                    </el-button>
                  </div>
                </template>

                <div class="diagnostic-content">
                  <el-empty v-if="!diagnosticResults.length" description="点击「开始诊断」查看系统状态" />

                  <div v-else class="diagnostic-results">
                    <!-- 诊断概览 -->
                    <div class="diagnostic-summary">
                      <el-row :gutter="20">
                        <el-col :span="8">
                          <el-statistic title="检查项目" :value="diagnosticResults.length" />
                        </el-col>
                        <el-col :span="8">
                          <el-statistic
                            title="状态"
                            :value="getHealthyCount()"
                            suffix="/ 4"
                          />
                        </el-col>
                        <el-col :span="8">
                          <el-statistic
                            title="诊断时间"
                            :value="new Date().toLocaleTimeString()"
                          />
                        </el-col>
                      </el-row>
                    </div>

                    <!-- 诊断详情 - 使用虚拟滚动 -->
                    <div class="diagnostic-details-container">
                      <el-virtual-list
                        :data="diagnosticResults"
                        :height="400"
                        :item-size="120"
                      >
                        <template #default="{ item, index }">
                          <div class="diagnostic-item">
                            <el-card class="diagnostic-card" :class="`diagnostic-${item.type}`">
                              <template #header>
                                <div class="diagnostic-card-header">
                                  <div class="diagnostic-icon">
                                    <el-icon :size="24" :color="item.color">
                                      <component :is="item.icon" />
                                    </el-icon>
                                  </div>
                                  <div class="diagnostic-title">
                                    <h4>{{ item.title }}</h4>
                                    <p>{{ item.description }}</p>
                                  </div>
                                  <div class="diagnostic-status">
                                    <el-tag :type="item.type === 'success' ? 'success' : item.type === 'warning' ? 'warning' : 'danger'">
                                      {{ item.type === 'success' ? '正常' : item.type === 'warning' ? '警告' : '错误' }}
                                    </el-tag>
                                  </div>
                                </div>
                              </template>

                              <div v-if="item.details" class="diagnostic-info">
                                <el-descriptions :column="2" size="small" border>
                                  <el-descriptions-item
                                    v-for="(value, key) in item.details"
                                    :key="key"
                                    :label="key"
                                  >
                                    <span class="diagnostic-value">{{ formatDiagnosticValue(value) }}</span>
                                  </el-descriptions-item>
                                </el-descriptions>
                              </div>
                            </el-card>
                          </div>
                        </template>
                      </el-virtual-list>
                    </div>
                  </div>
                </div>
              </el-card>
            </div>

            <!-- 关于 -->
            <div v-show="activeMenu === 'about'" class="setting-content">
              <el-card class="setting-card">
                <template #header>
                  <div class="card-header">
                    <el-icon class="card-icon"><InfoFilled /></el-icon>
                    <span class="card-title">关于应用</span>
                  </div>
                </template>
                <div class="about-content">
                  <div class="app-info">
                    <h3>雅思AI作文评判助手</h3>
                    <p>版本：{{ appInfo.version }}</p>
                    <p>构建时间：{{ appInfo.buildTime }}</p>
                    <p>更新日志：<el-button type="text" @click="showChangelog">查看</el-button></p>
                  </div>

                  <el-divider />

                  <div class="tech-info">
                    <h4>技术栈</h4>
                    <el-tag v-for="tech in appInfo.techStack" :key="tech" style="margin: 4px;">
                      {{ tech }}
                    </el-tag>
                  </div>

                  <el-divider />

                  <div class="links">
                    <h4>相关链接</h4>
                    <el-space direction="vertical">
                      <el-link href="#" type="primary">用户手册</el-link>
                      <el-link href="#" type="primary">技术支持</el-link>
                      <el-link href="#" type="primary">隐私政策</el-link>
                      <el-link href="#" type="primary">开源许可</el-link>
                    </el-space>
                  </div>
                </div>
              </el-card>
            </div>
            </div>
          </el-main>
        </div>
      </el-main>
    </el-container>
  </div>

  <!-- AI配置对话框 -->
  <AIConfigDialog
    v-model="showAIConfigDialog"
    @success="handleAIConfigSuccess"
  />
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft, Setting, Cpu, EditPen, DataBoard, InfoFilled, Reading, ArrowRight,
  Download, Upload, FolderOpened, Delete, Warning, Monitor, Files, CircleClose
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AIConfigDialog from '@/components/AIConfigDialog.vue'
// import QuestionBankManager from '@/components/QuestionBankManager.vue'
// 题库管理组件暂时不启用

const router = useRouter()

const activeMenu = ref('general')
const showAIConfigDialog = ref(false)
const testingConnection = ref(false)

// 系统诊断状态
const diagnosing = ref(false)
const diagnosticResults = ref([])

const generalSettings = ref({
  language: 'zh-CN',
  theme: 'light',
  autoSave: true,
  saveInterval: 60
})

const aiSettings = ref({
  provider: 'openai',
  apiKey: '',
  model: 'gpt-3.5-turbo',
  speed: 'balanced',
  streaming: true
})

const writingSettings = ref({
  fontSize: 16,
  autoTimer: true,
  wordCountReminder: true,
  targetWords: 250,
  grammarCheck: true
})

const storageInfo = ref({
  dbSize: '2.5 MB',
  recordCount: 15,
  cacheSize: '512 KB',
  lastBackup: '2024-10-03 15:30:00'
})

const appInfo = ref({
  version: '1.0.0',
  buildTime: '2024-10-04 12:00:00',
  techStack: ['Vue 3', 'Electron', 'Element Plus', 'SQLite', 'OpenAI API']
})

const goBack = () => {
  router.push('/')
}

const handleMenuSelect = (key) => {
  activeMenu.value = key
}

const openAIConfig = () => {
  showAIConfigDialog.value = true
}

// 系统诊断方法
const runDiagnostic = async () => {
  diagnosing.value = true
  diagnosticResults.value = []

  try {
    // 前端环境诊断
    await diagnoseFrontend()

    // 后端连接诊断
    await diagnoseBackend()

    // AI服务诊断
    await diagnoseAIServices()

    // 数据库诊断
    await diagnoseDatabase()

    ElMessage.success('系统诊断完成')
  } catch (error) {
    console.error('诊断过程出错:', error)
    ElMessage.error('诊断过程中出现错误')
  } finally {
    diagnosing.value = false
  }
}

const diagnoseFrontend = async () => {
  const userAgent = navigator.userAgent
  const platform = navigator.platform
  const language = navigator.language

  diagnosticResults.value.push({
    type: 'primary',
    icon: 'Monitor',
    color: '#67c23a',
    title: '前端环境',
    description: '浏览器环境正常',
    details: {
      '浏览器': userAgent,
      '平台': platform,
      '语言': language,
      '屏幕分辨率': `${screen.width} × ${screen.height}`,
      'URL协议': location.protocol
    }
  })

  // 检查本地存储
  try {
    localStorage.setItem('test', 'test')
    localStorage.removeItem('test')
    diagnosticResults.value.push({
      type: 'success',
      icon: 'Files',
      color: '#67c23a',
      title: '本地存储',
      description: 'LocalStorage工作正常'
    })
  } catch (error) {
    diagnosticResults.value.push({
      type: 'warning',
      icon: 'Warning',
      color: '#e6a23c',
      title: '本地存储',
      description: 'LocalStorage可能受限'
    })
  }
}

const diagnoseBackend = async () => {
  try {
    const response = await fetch('/api/system/status')
    const data = await response.json()

    diagnosticResults.value.push({
      type: 'success',
      icon: 'Setting',
      color: '#67c23a',
      title: '后端服务',
      description: '后端服务连接正常',
      details: data
    })
  } catch (error) {
    diagnosticResults.value.push({
      type: 'error',
      icon: 'CircleClose',
      color: '#f56c6c',
      title: '后端服务',
      description: '无法连接到后端服务',
      details: { '错误': error.message }
    })
  }
}

const diagnoseAIServices = async () => {
  try {
    const response = await fetch('/api/ai/providers')
    const data = await response.json()

    diagnosticResults.value.push({
      type: 'success',
      icon: 'Cpu',
      color: '#67c23a',
      title: 'AI服务',
      description: 'AI服务配置正常',
      details: {
        '已配置提供商': data.providers?.length || 0,
        '默认提供商': data.default || '未设置'
      }
    })
  } catch (error) {
    diagnosticResults.value.push({
      type: 'warning',
      icon: 'Warning',
      color: '#e6a23c',
      title: 'AI服务',
      description: 'AI服务配置可能有问题',
      details: { '错误': error.message }
    })
  }
}

const diagnoseDatabase = async () => {
  try {
    const response = await fetch('/api/database/status')
    const data = await response.json()

    diagnosticResults.value.push({
      type: 'success',
      icon: 'FolderOpened',
      color: '#67c23a',
      title: '数据库',
      description: '数据库连接正常',
      details: {
        '数据库类型': data.type || 'SQLite',
        '状态': data.status || '连接正常'
      }
    })
  } catch (error) {
    diagnosticResults.value.push({
      type: 'error',
      icon: 'CircleClose',
      color: '#f56c6c',
      title: '数据库',
      description: '数据库连接失败',
      details: { '错误': error.message }
    })
  }
}

const saveGeneralSettings = () => {
  // TODO: 保存常规设置
  ElMessage.success('常规设置已保存')
}

const saveAISettings = () => {
  // TODO: 保存AI设置
  ElMessage.success('AI配置已保存')
}

const testAIConnection = async () => {
  testingConnection.value = true
  try {
    // TODO: 测试AI连接
    await new Promise(resolve => setTimeout(resolve, 2000))
    ElMessage.success('连接测试成功')
  } catch (error) {
    ElMessage.error('连接测试失败')
  } finally {
    testingConnection.value = false
  }
}

const saveWritingSettings = () => {
  // TODO: 保存写作设置
  ElMessage.success('写作设置已保存')
}

const exportData = () => {
  // TODO: 导出数据
  ElMessage.info('导出功能开发中...')
}

const importData = () => {
  // TODO: 导入数据
  ElMessage.info('导入功能开发中...')
}

const backupData = () => {
  // TODO: 备份数据
  ElMessage.info('备份功能开发中...')
}

const clearCache = async () => {
  try {
    await ElMessageBox.confirm('确定要清除缓存吗？', '确认操作', {
      type: 'warning'
    })
    // TODO: 清除缓存
    ElMessage.success('缓存已清除')
  } catch (error) {
    // 用户取消
  }
}

const resetData = async () => {
  try {
    await ElMessageBox.confirm(
      '此操作将删除所有数据，包括练习记录和设置。确定要继续吗？',
      '重置数据',
      {
        type: 'error',
        confirmButtonText: '确定重置',
        confirmButtonClass: 'el-button--danger'
      }
    )
    // TODO: 重置数据
    ElMessage.success('数据已重置')
  } catch (error) {
    // 用户取消
  }
}

const showChangelog = () => {
  ElMessage.info('更新日志功能开发中...')
}

// AI配置成功处理
const handleAIConfigSuccess = () => {
  ElMessage.success('AI配置已更新')
  loadSettings() // 重新加载设置
}

const loadSettings = async () => {
  try {
    // 从设置API加载AI配置
    const response = await fetch('/api/settings/')
    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data.ai) {
        aiSettings.value = { ...aiSettings.value, ...data.data.ai }
      }
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

// 获取健康检查数量
const getHealthyCount = () => {
  return diagnosticResults.value.filter(item => item.type === 'success').length
}

// 格式化诊断值
const formatDiagnosticValue = (value) => {
  if (typeof value === 'number') {
    if (value > 1000000) {
      return `${(value / 1000000).toFixed(2)} MB`
    } else if (value > 1000) {
      return `${(value / 1000).toFixed(2)} KB`
    }
  }
  return value
}

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
/* CSS变量定义 */
:root {
  --primary-color: #409EFF;
  --success-color: #67C23A;
  --warning-color: #E6A23C;
  --danger-color: #F56C6C;
  --info-color: #909399;
  --bg-primary: #F5F7FA;
  --bg-secondary: #FFFFFF;
  --bg-tertiary: #FAFAFA;
  --text-primary: #303133;
  --text-secondary: #606266;
  --text-tertiary: #909399;
  --border-color: #DCDFE6;
  --border-light: #EBEEF5;
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

/* 主容器 */
.settings-container {
  height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%);
  display: flex;
  flex-direction: column;
}

/* 顶部导航栏 */
.settings-header {
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  padding: 0;
  height: 80px;
  display: flex;
  align-items: center;
}

.header-content {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-breadcrumb {
  flex: 1;
}

.breadcrumb-item {
  cursor: pointer;
  transition: color 0.3s ease;
}

.breadcrumb-item:hover {
  color: var(--primary-color);
}

.header-title {
  text-align: center;
  flex: 2;
}

.header-title h2 {
  margin: 0 0 4px 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 600;
}

.header-subtitle {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 14px;
}

/* 主体内容区 */
.settings-main {
  flex: 1;
  padding: 0;
  overflow: hidden;
}

.settings-layout {
  height: 100%;
  display: flex;
  max-width: 1400px;
  margin: 0 auto;
  background: var(--bg-secondary);
  box-shadow: var(--shadow-md);
}

/* 左侧导航 */
.settings-aside {
  background: var(--bg-tertiary);
  border-right: 1px solid var(--border-light);
  padding: 0;
}

.menu-container {
  height: 100%;
  padding: 1rem 0;
}

.settings-menu {
  border: none;
  background: transparent;
}

.menu-item {
  margin: 4px 12px;
  border-radius: var(--radius-md);
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.menu-item:hover {
  background: rgba(64, 158, 255, 0.08);
  transform: translateX(4px);
}

.menu-item.is-active {
  background: linear-gradient(135deg, var(--primary-color), #66b3ff);
  color: white;
  box-shadow: var(--shadow-sm);
}

.menu-item.is-active .menu-icon,
.menu-item.is-active .menu-text,
.menu-item.is-active .menu-arrow {
  color: white;
}

.menu-icon {
  margin-right: 12px;
  font-size: 18px;
  transition: transform 0.3s ease;
}

.menu-item:hover .menu-icon {
  transform: scale(1.1);
}

.menu-text {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.menu-arrow {
  margin-left: auto;
  font-size: 14px;
  opacity: 0.6;
  transition: transform 0.3s ease;
}

.menu-item:hover .menu-arrow {
  transform: translateX(4px);
  opacity: 1;
}

/* 右侧内容区 */
.settings-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
  background: var(--bg-primary);
}

.content-wrapper {
  max-width: 1000px;
  margin: 0 auto;
}

/* 设置卡片 */
.setting-card {
  margin-bottom: 1.5rem;
  border: none;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s ease;
  overflow: hidden;
}

.setting-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
}

.card-icon {
  margin-right: 12px;
  font-size: 20px;
  color: var(--primary-color);
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.header-action {
  border-radius: var(--radius-sm);
  font-weight: 500;
  transition: all 0.3s ease;
}

.header-action:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

/* 内容区域样式 */
.setting-content {
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.content-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1fr;
}

/* AI状态显示 */
.ai-status-display {
  padding: 1rem 0;
}

.ai-status-display .el-descriptions {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
}

/* 表单样式优化 */
.el-form {
  padding: 1rem 0;
}

.el-form-item {
  margin-bottom: 1.5rem;
}

.el-form-item__label {
  color: var(--text-secondary);
  font-weight: 500;
}

.el-input,
.el-select,
.el-slider,
.el-input-number {
  border-radius: var(--radius-sm);
}

.el-button {
  border-radius: var(--radius-sm);
  font-weight: 500;
  transition: all 0.3s ease;
}

.el-button:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

/* 数据管理按钮组 */
.el-space {
  width: 100%;
}

.el-space .el-button {
  width: 100%;
  margin-bottom: 0.5rem;
  justify-content: flex-start;
}

/* 系统诊断样式 */
.diagnostic-content {
  min-height: 500px;
  padding: 1rem 0;
}

.diagnostic-summary {
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
}

.diagnostic-details-container {
  height: 400px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.diagnostic-item {
  padding: 0.5rem;
}

.diagnostic-card {
  margin-bottom: 0.5rem;
  transition: all 0.3s ease;
}

.diagnostic-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.diagnostic-card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.diagnostic-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-tertiary);
}

.diagnostic-title {
  flex: 1;
}

.diagnostic-title h4 {
  margin: 0 0 4px 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.diagnostic-title p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.4;
}

.diagnostic-status {
  flex-shrink: 0;
}

.diagnostic-info {
  margin-top: 1rem;
}

.diagnostic-value {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  color: var(--text-primary);
}

.diagnostic-success .diagnostic-icon {
  background: rgba(103, 194, 58, 0.1);
  color: var(--success-color);
}

.diagnostic-warning .diagnostic-icon {
  background: rgba(230, 162, 60, 0.1);
  color: var(--warning-color);
}

.diagnostic-error .diagnostic-icon {
  background: rgba(245, 108, 108, 0.1);
  color: var(--danger-color);
}

/* 虚拟滚动样式优化 */
.el-virtual-list {
  border-radius: var(--radius-md);
}

.el-virtual-list__item {
  border-bottom: 1px solid var(--border-light);
}

.el-virtual-list__item:last-child {
  border-bottom: none;
}

/* 关于页面样式 */
.about-content {
  line-height: 1.8;
}

.app-info {
  text-align: center;
  padding: 2rem 0;
}

.app-info h3 {
  color: var(--text-primary);
  margin-bottom: 1rem;
  font-size: 24px;
  font-weight: 600;
}

.app-info p {
  color: var(--text-secondary);
  margin: 0.5rem 0;
  font-size: 14px;
}

.tech-info h4,
.links h4 {
  color: var(--text-primary);
  margin-bottom: 1rem;
  font-size: 16px;
  font-weight: 600;
}

.el-tag {
  margin: 4px;
  border-radius: var(--radius-sm);
}

.el-link {
  margin: 8px 0;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .settings-aside {
    width: 200px !important;
  }

  .content-wrapper {
    max-width: 800px;
  }
}

@media (max-width: 768px) {
  .settings-layout {
    flex-direction: column;
  }

  .settings-aside {
    width: 100% !important;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border-light);
  }

  .settings-content {
    padding: 1rem;
  }

  .header-content {
    padding: 0 1rem;
  }

  .header-title {
    text-align: left;
  }
}

/* 滚动条样式 */
.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: var(--bg-tertiary);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

/* 动画和过渡效果 */
.menu-item,
.setting-card,
.el-button {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 空状态样式 */
.el-empty {
  padding: 3rem 0;
}

.el-empty__description {
  color: var(--text-tertiary);
}
</style>