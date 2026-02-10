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

      <!-- API 配置 -->
      <div v-if="activeTab === 'api'" class="tab-content">
        <div class="section">
          <h3>API 配置列表</h3>
          <div v-if="apiLoading" class="hint">加载中...</div>
          <table v-else class="config-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>供应商</th>
                <th>模型</th>
                <th>优先级</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in apiConfigs" :key="item.id">
                <td>{{ item.config_name }} <span v-if="item.is_default">（默认）</span></td>
                <td>{{ item.provider }}</td>
                <td>{{ item.default_model }}</td>
                <td>{{ item.priority || 100 }}</td>
                <td>{{ item.is_enabled ? '启用' : '禁用' }}</td>
                <td class="table-actions">
                  <button class="btn-text" @click="editConfig(item)">编辑</button>
                  <button class="btn-text" @click="testConfig(item.id)" :disabled="testingConfigId === item.id">
                    {{ testingConfigId === item.id ? '测试中' : '测试' }}
                  </button>
                  <button class="btn-text" @click="setDefaultConfig(item.id)">设默认</button>
                  <button class="btn-text" @click="toggleConfig(item.id)">
                    {{ item.is_enabled ? '禁用' : '启用' }}
                  </button>
                  <button class="btn-text danger" @click="removeConfig(item.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h3>{{ apiForm.id ? '编辑配置' : '新建配置' }}</h3>
          <div class="form-grid">
            <input v-model="apiForm.config_name" placeholder="配置名称" />
            <select v-model="apiForm.provider">
              <option value="openai">openai</option>
              <option value="openrouter">openrouter</option>
              <option value="deepseek">deepseek</option>
            </select>
            <input v-model="apiForm.base_url" placeholder="Base URL" />
            <input v-model="apiForm.default_model" placeholder="默认模型" />
            <input v-model.number="apiForm.priority" type="number" min="1" placeholder="优先级" />
            <input v-model.number="apiForm.max_retries" type="number" min="0" max="5" placeholder="重试次数" />
            <input v-model="apiForm.api_key" placeholder="API Key（编辑时留空=不变）" />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" @click="saveApiConfig">保存配置</button>
            <button class="btn btn-secondary" @click="resetApiForm">重置</button>
          </div>
        </div>
      </div>

      <!-- 提示词管理 -->
      <div v-if="activeTab === 'prompts'" class="tab-content">
        <div class="section">
          <h3>提示词版本</h3>
          <div v-if="promptLoading" class="hint">加载中...</div>
          <table v-else class="config-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Task</th>
                <th>版本</th>
                <th>激活</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in promptEntries" :key="item.id">
                <td>{{ item.id }}</td>
                <td>{{ item.task_type }}</td>
                <td>{{ item.version }}</td>
                <td>{{ item.is_active ? '是' : '否' }}</td>
                <td class="table-actions">
                  <button class="btn-text" @click="activatePrompt(item.id)">激活</button>
                  <button class="btn-text danger" @click="deletePrompt(item.id)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h3>导入/导出</h3>
          <textarea
            v-model="importPromptJson"
            class="json-editor"
            rows="10"
            placeholder='粘贴 JSON（支持 {version,task1,task2} 或 [{task_type,...}]）'
          ></textarea>
          <div class="form-actions">
            <button class="btn btn-primary" @click="importPromptConfig">导入提示词</button>
            <button class="btn btn-secondary" @click="exportPromptConfig">导出当前激活</button>
          </div>
        </div>
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
import { settings, essays, configs, prompts } from '@/api/client.js'

const tabs = [
  { key: 'api', label: 'API配置' },
  { key: 'prompts', label: '提示词管理' },
  { key: 'model', label: '模型参数' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' }
]

const activeTab = ref('model')
const saving = ref(false)
const apiLoading = ref(false)
const promptLoading = ref(false)

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

const apiConfigs = ref([])
const testingConfigId = ref(null)
const apiForm = ref({
  id: null,
  config_name: '',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  default_model: 'gpt-4o-mini',
  priority: 100,
  max_retries: 2
})

const promptEntries = ref([])
const importPromptJson = ref('')

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

async function loadApiConfigs() {
  apiLoading.value = true
  try {
    apiConfigs.value = await configs.list()
  } catch (error) {
    console.error('加载 API 配置失败:', error)
    alert('加载 API 配置失败: ' + error.message)
  } finally {
    apiLoading.value = false
  }
}

function resetApiForm() {
  apiForm.value = {
    id: null,
    config_name: '',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    default_model: 'gpt-4o-mini',
    priority: 100,
    max_retries: 2
  }
}

function editConfig(item) {
  apiForm.value = {
    id: item.id,
    config_name: item.config_name,
    provider: item.provider,
    base_url: item.base_url,
    api_key: '',
    default_model: item.default_model,
    priority: item.priority || 100,
    max_retries: item.max_retries ?? 2
  }
}

async function saveApiConfig() {
  try {
    if (!apiForm.value.config_name || !apiForm.value.base_url || !apiForm.value.default_model) {
      alert('请填写完整配置字段')
      return
    }

    const payload = {
      config_name: apiForm.value.config_name,
      provider: apiForm.value.provider,
      base_url: apiForm.value.base_url,
      default_model: apiForm.value.default_model,
      priority: apiForm.value.priority,
      max_retries: apiForm.value.max_retries
    }
    if (apiForm.value.api_key) {
      payload.api_key = apiForm.value.api_key
    }

    if (apiForm.value.id) {
      await configs.update(apiForm.value.id, payload)
    } else {
      if (!payload.api_key) {
        alert('新建配置必须填写 API Key')
        return
      }
      await configs.create(payload)
    }

    resetApiForm()
    await loadApiConfigs()
  } catch (error) {
    console.error('保存 API 配置失败:', error)
    alert('保存 API 配置失败: ' + error.message)
  }
}

async function removeConfig(id) {
  if (!confirm('确定删除该配置？')) return
  try {
    await configs.delete(id)
    await loadApiConfigs()
  } catch (error) {
    console.error('删除 API 配置失败:', error)
    alert('删除 API 配置失败: ' + error.message)
  }
}

async function setDefaultConfig(id) {
  try {
    await configs.setDefault(id)
    await loadApiConfigs()
  } catch (error) {
    console.error('设为默认失败:', error)
    alert('设为默认失败: ' + error.message)
  }
}

async function toggleConfig(id) {
  try {
    await configs.toggleEnabled(id)
    await loadApiConfigs()
  } catch (error) {
    console.error('切换启用状态失败:', error)
    alert('切换状态失败: ' + error.message)
  }
}

async function testConfig(id) {
  testingConfigId.value = id
  try {
    const result = await configs.test(id)
    alert(`连接成功，延迟 ${result.latency}ms`)
  } catch (error) {
    alert('连接失败: ' + error.message)
  } finally {
    testingConfigId.value = null
  }
}

async function loadPromptList() {
  promptLoading.value = true
  try {
    promptEntries.value = await prompts.listAll()
  } catch (error) {
    console.error('加载提示词失败:', error)
    alert('加载提示词失败: ' + error.message)
  } finally {
    promptLoading.value = false
  }
}

async function activatePrompt(id) {
  try {
    await prompts.activate(id)
    await loadPromptList()
  } catch (error) {
    alert('激活失败: ' + error.message)
  }
}

async function deletePrompt(id) {
  if (!confirm('确定删除该提示词版本？')) return
  try {
    await prompts.delete(id)
    await loadPromptList()
  } catch (error) {
    alert('删除失败: ' + error.message)
  }
}

async function exportPromptConfig() {
  try {
    const data = await prompts.exportActive()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ielts-prompts-export.json'
    a.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    alert('导出失败: ' + error.message)
  }
}

async function importPromptConfig() {
  try {
    const parsed = JSON.parse(importPromptJson.value)
    await prompts.import(parsed)
    importPromptJson.value = ''
    await loadPromptList()
    alert('提示词导入成功')
  } catch (error) {
    alert('导入失败: ' + error.message)
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
  loadApiConfigs()
  loadPromptList()
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

.config-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}

.config-table th,
.config-table td {
  border-bottom: 1px solid var(--border-color);
  padding: 10px 8px;
  text-align: left;
  font-size: 13px;
}

.table-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-text.danger {
  color: #c62828;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.form-grid input,
.form-grid select,
.json-editor {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.json-editor {
  font-family: ui-monospace, Menlo, Monaco, monospace;
}

.form-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
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
