<template>
  <div class="settings-page">
    <div class="page-header">
      <h1>⚙️ 系统设置</h1>
    </div>

    <!-- 标签页 -->
    <div class="tabs-container card">
      <div class="tabs">
        <button 
          v-for="tab in tabs" 
          :key="tab.key"
          :class="['tab', { active: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 模型参数 -->
      <div v-if="activeTab === 'model'" class="tab-content">
        <div class="section">
          <h3>温度模式选择</h3>
          <p class="hint">温度值影响 AI 评分的严格程度和反馈详细度</p>
          
          <div class="temperature-modes">
            <div 
              v-for="mode in temperatureModes" 
              :key="mode.value"
              :class="['mode-card', { active: modelSettings.temperature_mode === mode.value }]"
              @click="modelSettings.temperature_mode = mode.value"
            >
              <div class="mode-header">
                <span class="mode-icon">{{ mode.icon }}</span>
                <span class="mode-name">{{ mode.name }}</span>
              </div>
              <div class="mode-temp">Temperature: {{ mode.temp }}</div>
              <div class="mode-desc">{{ mode.desc }}</div>
            </div>
          </div>

          <button class="btn btn-primary" @click="saveModelSettings" :disabled="saving">
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </div>

        <div class="section">
          <h3>任务参数说明</h3>
          <div class="param-info">
            <div class="param-card">
              <h4>📊 Task 1 参数</h4>
              <p><strong>当前温度:</strong> {{ task1Temperature }}</p>
              <p class="hint">Task 1 注重数据准确性和客观描述，建议使用较低温度</p>
            </div>
            <div class="param-card">
              <h4>📝 Task 2 参数</h4>
              <p><strong>当前温度:</strong> {{ task2Temperature }}</p>
              <p class="hint">Task 2 需要平衡客观评分和创意反馈，建议使用中等温度</p>
            </div>
          </div>
          <div class="param-card">
            <h4>📏 Max Tokens (通用)</h4>
            <p><strong>固定值:</strong> 4096</p>
            <p class="hint">Max Tokens 已固定为 4096，确保完整返回评分结果</p>
          </div>
        </div>
      </div>

      <!-- 数据管理 -->
      <div v-if="activeTab === 'data'" class="tab-content">
        <div class="section">
          <h3>历史记录管理</h3>
          
          <div class="setting-item">
            <label>自动保留最近记录数量</label>
            <div class="input-group">
              <input 
                type="number"
                v-model.number="dataSettings.history_limit"
                min="50"
                max="500"
                step="50"
              />
              <span class="input-suffix">条</span>
            </div>
            <p class="hint">超过此数量时，将自动删除最早的记录（当前暂未实现自动清理逻辑）</p>
            <button class="btn btn-primary" @click="saveDataSettings" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>

        <div class="section danger-zone">
          <h3>⚠️ 危险操作</h3>
          <div class="danger-item">
            <div>
              <h4>清空所有历史记录</h4>
              <p class="hint">此操作将删除所有评分历史，且不可恢复</p>
            </div>
            <button class="btn btn-danger" @click="confirmClearHistory">
              🗑️ 清空历史
            </button>
          </div>
        </div>
      </div>

      <!-- 关于 -->
      <div v-if="activeTab === 'about'" class="tab-content">
        <div class="about-section">
          <div class="app-icon">✍️</div>
          <h2>雅思写作 AI 评判</h2>
          <p class="version">Version 0.3.1</p>
          
          <div class="about-info">
            <div class="info-row">
              <span class="label">开发阶段</span>
              <span class="value">Phase 04 - 数据与功能完善</span>
            </div>
            <div class="info-row">
              <span class="label">Electron版本</span>
              <span class="value">{{ electronVersion }}</span>
            </div>
            <div class="info-row">
              <span class="label">Node版本</span>
              <span class="value">{{ nodeVersion }}</span>
            </div>
            <div class="info-row">
              <span class="label">数据目录</span>
              <span class="value">{{ userDataPath || '加载中...' }}</span>
            </div>
          </div>

          <div class="about-features">
            <h3>当前已实现功能</h3>
            <ul>
              <li>✅ AI 作文评分（Task 1 & Task 2）</li>
              <li>✅ 详细评分报告与反馈</li>
              <li>✅ 题目管理（CRUD + 批量导入）</li>
              <li>✅ 历史记录管理（筛选 + 导出CSV）</li>
              <li>✅ 模型参数配置</li>
              <li>🚧 草稿自动保存（待集成）</li>
              <li>🚧 分数对比分析（待实现）</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 清空历史确认弹窗 -->
    <div v-if="showClearConfirm" class="dialog-overlay" @click.self="showClearConfirm = false">
      <div class="dialog card">
        <h3>⚠️ 清空所有历史记录</h3>
        <p>此操作将删除所有历史记录，且不可恢复。</p>
        <p>请输入 <strong>&quot;确认删除&quot;</strong> 以继续。</p>
        
        <input 
          type="text"
          v-model="clearConfirmInput"
          placeholder="请输入 &quot;确认删除&quot;"
          class="input"
          style="width: 100%; margin: 12px 0;"
        />

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="showClearConfirm = false">
            取消
          </button>
          <button 
            class="btn btn-danger" 
            @click="executeClearHistory"
            :disabled="clearConfirmInput !== '确认删除'"
          >
            确认清空
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { settings, essays } from '@/api/client.js'

const tabs = [
  { key: 'model', label: '模型参数' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' }
]

const activeTab = ref('model')
const saving = ref(false)

// 温度模式配置
const temperatureModes = [
  {
    value: 'precise',
    name: '精确模式',
    icon: '🎯',
    temp: 0.3,
    desc: '适合客观评分，输出稳定一致'
  },
  {
    value: 'balanced',
    name: '平衡模式',
    icon: '⚖️',
    temp: 0.5,
    desc: '推荐使用，兼顾准确性与详细度'
  },
  {
    value: 'creative',
    name: '创意模式',
    icon: '💡',
    temp: 0.8,
    desc: '详细反馈，适合学习分析'
  }
]

// 设置数据
const modelSettings = ref({
  temperature_mode: 'balanced'
})

const dataSettings = ref({
  history_limit: 100
})

// 清空历史确认
const showClearConfirm = ref(false)
const clearConfirmInput = ref('')

// 关于页面数据
const electronVersion = ref('N/A')
const nodeVersion = ref('N/A')
const userDataPath = ref('')

// 获取版本信息（通过preload安全暴露）
if (window.electronAPI && window.electronAPI.getVersions) {
  const versions = window.electronAPI.getVersions()
  electronVersion.value = versions.electron
  nodeVersion.value = versions.node
}

// 获取用户数据路径
async function getUserDataPath() {
  if (window.electronAPI && window.electronAPI.getUserDataPath) {
    try {
      userDataPath.value = await window.electronAPI.getUserDataPath()
    } catch (error) {
      userDataPath.value = '无法获取'
    }
  } else {
    userDataPath.value = '仅在 Electron 中可用'
  }
}

const task1Temperature = computed(() => {
  const mode = temperatureModes.find(m => m.value === modelSettings.value.temperature_mode)
  return mode ? mode.temp : 0.5
})

const task2Temperature = computed(() => {
  const mode = temperatureModes.find(m => m.value === modelSettings.value.temperature_mode)
  return mode ? mode.temp : 0.5
})

// 加载设置
async function loadSettings() {
  try {
    const allSettings = await settings.getAll()
    
    if (allSettings.temperature_mode) {
      modelSettings.value.temperature_mode = allSettings.temperature_mode
    }
    if (allSettings.history_limit) {
      dataSettings.value.history_limit = allSettings.history_limit
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

// 保存模型设置
async function saveModelSettings() {
  saving.value = true
  try {
    await settings.update({
      temperature_mode: modelSettings.value.temperature_mode
    })
    alert('模型设置已保存')
  } catch (error) {
    console.error('保存失败:', error)
    alert('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

// 保存数据设置
async function saveDataSettings() {
  // 验证范围
  if (dataSettings.value.history_limit < 50 || dataSettings.value.history_limit > 500) {
    alert('记录保留数量必须在 50-500 之间')
    return
  }

  saving.value = true
  try {
    await settings.update({
      history_limit: dataSettings.value.history_limit
    })
    alert('数据设置已保存')
  } catch (error) {
    console.error('保存失败:', error)
    alert('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

// 清空历史记录
function confirmClearHistory() {
  clearConfirmInput.value = ''
  showClearConfirm.value = true
}

async function executeClearHistory() {
  if (clearConfirmInput.value !== '确认删除') return

  try {
    await essays.deleteAll()
    showClearConfirm.value = false
    alert('已清空所有历史记录')
  } catch (error) {
    console.error('清空失败:', error)
    alert('清空失败: ' + error.message)
  }
}

// 初始化
onMounted(() => {
  loadSettings()
  getUserDataPath()
})
</script>

<style scoped>
.settings-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 28px;
  color: var(--text-primary);
}

/* 标签页 */
.tabs-container {
  padding: 0;
  overflow: hidden;
}

.tabs {
  display: flex;
  border-bottom: 2px solid var(--border-color);
  background: var(--bg-light);
}

.tab {
  flex: 1;
  padding: 16px;
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  background: rgba(0, 0, 0, 0.02);
}

.tab.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
  background: white;
}

.tab-content {
  padding: 24px;
}

/* 通用区块 */
.section {
  margin-bottom: 32px;
}

.section h3 {
  font-size: 18px;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.hint {
  font-size: 14px;
  color: var(--text-muted);
  margin: 8px 0;
}

/* 温度模式选择 */
.temperature-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 20px 0;
}

.mode-card {
  padding: 20px;
  border: 2px solid var(--border-color);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.mode-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
}

.mode-card.active {
  border-color: var(--primary-color);
  background: rgba(102, 126, 234, 0.05);
}

.mode-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}

.mode-icon {
  font-size: 24px;
}

.mode-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.mode-temp {
  font-size: 14px;
  color: var(--primary-color);
  font-weight: 600;
  margin-bottom: 8px;
}

.mode-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

/* 参数说明 */
.param-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.param-card {
  padding: 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.param-card h4 {
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.param-card p {
  margin: 4px 0;
  font-size: 14px;
  color: var(--text-secondary);
}

/* 数据管理 */
.setting-item {
  margin-bottom: 24px;
}

.setting-item label {
  display: block;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.input-group input[type="number"] {
  width: 150px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  font-size: 14px;
}

.input-suffix {
  font-size: 14px;
  color: var(--text-secondary);
}

/* 危险区域 */
.danger-zone {
  border: 2px solid #F44336;
  padding: 20px;
  border-radius: var(--border-radius);
  background: rgba(244, 67, 54, 0.02);
}

.danger-zone h3 {
  color: #F44336;
}

.danger-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.danger-item h4 {
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: 4px;
}

/* 关于页面 */
.about-section {
  text-align: center;
  max-width: 600px;
  margin: 0 auto;
}

.app-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.about-section h2 {
  font-size: 24px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.version {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 32px;
}

.about-info {
  text-align: left;
  background: var(--bg-light);
  padding: 20px;
  border-radius: var(--border-radius);
  margin-bottom: 24px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.info-row:last-child {
  border-bottom: none;
}

.info-row .label {
  font-weight: 500;
  color: var(--text-secondary);
}

.info-row .value {
  color: var(--text-primary);
  font-family: monospace;
  font-size: 13px;
}

.about-features {
  text-align: left;
  background: var(--bg-light);
  padding: 20px;
  border-radius: var(--border-radius);
}

.about-features h3 {
  font-size: 16px;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.about-features ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.about-features li {
  padding: 8px 0;
  font-size: 14px;
  color: var(--text-secondary);
}
</style>
