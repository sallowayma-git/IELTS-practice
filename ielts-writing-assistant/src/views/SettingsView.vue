<template>
  <div class="settings-container">
    <el-container>
      <el-header class="settings-header">
        <div class="header-left">
          <el-button @click="goBack" :icon="ArrowLeft">返回</el-button>
          <h2>系统设置</h2>
        </div>
      </el-header>

      <el-main class="settings-main">
        <el-row :gutter="20">
          <!-- 左侧菜单 -->
          <el-col :span="6">
            <el-card class="menu-card">
              <el-menu
                :default-active="activeMenu"
                @select="handleMenuSelect"
                class="settings-menu"
              >
                <el-menu-item index="general">
                  <el-icon><Setting /></el-icon>
                  <span>常规设置</span>
                </el-menu-item>
                <el-menu-item index="ai">
                  <el-icon><Magic /></el-icon>
                  <span>AI配置</span>
                </el-menu-item>
                <el-menu-item index="writing">
                  <el-icon><EditPen /></el-icon>
                  <span>写作设置</span>
                </el-menu-item>
                <el-menu-item index="data">
                  <el-icon><Database /></el-icon>
                  <span>数据管理</span>
                </el-menu-item>
                <el-menu-item index="about">
                  <el-icon><InfoFilled /></el-icon>
                  <span>关于</span>
                </el-menu-item>
              </el-menu>
            </el-card>
          </el-col>

          <!-- 右侧内容 -->
          <el-col :span="18">
            <!-- 常规设置 -->
            <div v-show="activeMenu === 'general'" class="setting-content">
              <el-card>
                <template #header>
                  <span>常规设置</span>
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
              <el-card>
                <template #header>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span>AI配置</span>
                    <el-button type="primary" @click="showAIConfigDialog = true">
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
              <el-card>
                <template #header>
                  <span>写作设置</span>
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
              <el-space direction="vertical" style="width: 100%;">
                <el-card>
                  <template #header>
                    <span>数据管理</span>
                  </template>
                  <el-space direction="vertical" style="width: 100%;">
                    <el-button @click="exportData" :icon="Download">导出数据</el-button>
                    <el-button @click="importData" :icon="Upload">导入数据</el-button>
                    <el-button @click="backupData" :icon="FolderOpened">备份数据</el-button>
                    <el-button @click="clearCache" :icon="Delete">清除缓存</el-button>
                    <el-button type="danger" @click="resetData" :icon="Warning">重置所有数据</el-button>
                  </el-space>
                </el-card>

                <el-card>
                  <template #header>
                    <span>存储信息</span>
                  </template>
                  <el-descriptions :column="1" border>
                    <el-descriptions-item label="数据库大小">{{ storageInfo.dbSize }}</el-descriptions-item>
                    <el-descriptions-item label="练习记录数">{{ storageInfo.recordCount }}</el-descriptions-item>
                    <el-descriptions-item label="缓存大小">{{ storageInfo.cacheSize }}</el-descriptions-item>
                    <el-descriptions-item label="最后备份">{{ storageInfo.lastBackup }}</el-descriptions-item>
                  </el-descriptions>
                </el-card>
              </el-space>
            </div>

            <!-- 关于 -->
            <div v-show="activeMenu === 'about'" class="setting-content">
              <el-card>
                <template #header>
                  <span>关于应用</span>
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
          </el-col>
        </el-row>
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
  ArrowLeft, Setting, Magic, EditPen, Database, InfoFilled,
  Download, Upload, FolderOpened, Delete, Warning
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AIConfigDialog from '@/components/AIConfigDialog.vue'

const router = useRouter()

const activeMenu = ref('general')
const showAIConfigDialog = ref(false)
const testingConnection = ref(false)

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

onMounted(() => {
  loadSettings()
})
</script>

<style scoped>
.settings-container {
  height: 100vh;
  background: #f5f7fa;
}

.settings-header {
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

.settings-main {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.menu-card {
  height: fit-content;
}

.settings-menu {
  border-right: none;
}

.setting-content {
  height: fit-content;
}

.about-content {
  line-height: 1.6;
}

.app-info h3 {
  color: #2c3e50;
  margin-bottom: 1rem;
}

.app-info p {
  color: #606266;
  margin: 0.5rem 0;
}

.tech-info h4 {
  color: #2c3e50;
  margin-bottom: 1rem;
}

.links h4 {
  color: #2c3e50;
  margin-bottom: 1rem;
}
</style>