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
          <p class="hint">
            护栏规则：系统至少保留一个启用配置，默认配置必须是启用状态。
          </p>
          <div v-if="sectionMessages.api.message" :class="['inline-message', `inline-message-${sectionMessages.api.type}`]">
            {{ sectionMessages.api.message }}
          </div>
          <div v-if="apiLoading" class="hint">加载中...</div>
          <table v-else class="config-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>供应商</th>
                <th>模型</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in apiConfigs" :key="item.id">
                <td>{{ item.config_name }} <span v-if="item.is_default">（默认）</span></td>
                <td>{{ item.provider }}</td>
                <td>{{ item.default_model }}</td>
                <td>{{ item.is_enabled ? '启用' : '禁用' }}</td>
                <td class="table-actions">
                  <button class="btn-text" @click="editConfig(item)">编辑</button>
                  <button class="btn-text" @click="testConfig(item.id)" :disabled="testingConfigId === item.id">
                    {{ testingConfigId === item.id ? '测试中' : '测试' }}
                  </button>
                  <button
                    class="btn-text"
                    :disabled="item.is_default || !item.is_enabled"
                    :title="item.is_default ? '当前已是默认配置' : (!item.is_enabled ? '禁用配置不能设为默认' : '')"
                    @click="setDefaultConfig(item.id)"
                  >
                    设默认
                  </button>
                  <button
                    class="btn-text"
                    :disabled="isToggleBlocked(item)"
                    :title="getToggleBlockedReason(item)"
                    @click="toggleConfig(item.id)"
                  >
                    {{ item.is_enabled ? '禁用' : '启用' }}
                  </button>
                  <button
                    class="btn-text danger"
                    :disabled="isDeleteBlocked(item)"
                    :title="getDeleteBlockedReason(item)"
                    @click="requestRemoveConfig(item.id)"
                  >
                    删除
                  </button>
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
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="deepseek">DeepSeek</option>
            </select>
            <input v-model="apiForm.base_url" placeholder="Base URL" />
            <input v-model="apiForm.default_model" placeholder="默认模型" />
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
          <div v-if="sectionMessages.prompts.message" :class="['inline-message', `inline-message-${sectionMessages.prompts.type}`]">
            {{ sectionMessages.prompts.message }}
          </div>
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
                  <button class="btn-text danger" @click="requestDeletePrompt(item.id)">删除</button>
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
          <div v-if="sectionMessages.model.message" :class="['inline-message', `inline-message-${sectionMessages.model.type}`]">
            {{ sectionMessages.model.message }}
          </div>
          
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
              <div class="mode-temp">{{ getModeTemperatureLabel(mode) }}</div>
              <div class="mode-desc">{{ mode.desc }}</div>
            </div>
          </div>

          <div v-if="modelSettings.temperature_mode === 'custom'" class="custom-temperature-panel">
            <h4>自定义任务温度</h4>
            <div class="custom-temperature-grid">
              <label class="custom-temperature-field">
                <span>Task 1</span>
                <input
                  v-model.number="modelSettings.temperature_task1"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                />
              </label>
              <label class="custom-temperature-field">
                <span>Task 2</span>
                <input
                  v-model.number="modelSettings.temperature_task2"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                />
              </label>
            </div>
            <p class="hint">自定义模式允许分别设置 Task 1 / Task 2，范围 0.0-2.0。</p>
          </div>

          <button class="btn btn-primary" @click="saveModelSettings" :disabled="modelSaving">
            {{ modelSaving ? '保存中...' : '保存设置' }}
          </button>
        </div>

      </div>

      <!-- 数据管理 -->
      <div v-if="activeTab === 'data'" class="tab-content">
        <div class="section">
          <h3>历史记录管理</h3>
          <div v-if="sectionMessages.data.message" :class="['inline-message', `inline-message-${sectionMessages.data.type}`]">
            {{ sectionMessages.data.message }}
          </div>
          
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
            <p class="hint">超过此数量时，系统会自动清理最早记录，避免历史数据无限增长</p>
            <button class="btn btn-primary" @click="saveDataSettings" :disabled="dataSaving">
              {{ dataSaving ? '保存中...' : '保存' }}
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
              <span class="value">Phase 05 - 收口与交付准备</span>
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
              <li>✅ 写作页题库选题（自由写作 / 题库模式）</li>
              <li>✅ 题目管理（CRUD + 批量导入）</li>
              <li>✅ 默认官方题库 seed（Task 2 全量 + Task 1 最小样本）</li>
              <li>✅ 历史记录管理（筛选 + 导出CSV）</li>
              <li>✅ 历史统计对比（雷达图 + 范围切换）</li>
              <li>✅ 草稿自动保存与恢复</li>
              <li>✅ 模型参数配置</li>
              <li>🟡 发布前收尾（写作专属自动化报告 / 打包验收）</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- 通用确认弹窗 -->
    <div v-if="confirmDialog.visible" class="dialog-overlay" @click.self="closeConfirmDialog">
      <div class="dialog card">
        <h3>{{ confirmDialog.title }}</h3>
        <p>{{ confirmDialog.message }}</p>
        <p v-if="confirmDialog.keyword">请输入 <strong>&quot;{{ confirmDialog.keyword }}&quot;</strong> 以继续。</p>
        
        <input
          v-if="confirmDialog.keyword"
          type="text"
          v-model="confirmDialog.input"
          :placeholder="'请输入 ' + confirmDialog.keyword"
          class="input"
          style="width: 100%; margin: 12px 0;"
        />

        <div class="dialog-actions">
          <button class="btn btn-secondary" @click="closeConfirmDialog">
            取消
          </button>
          <button 
            :class="['btn', confirmDialog.danger ? 'btn-danger' : 'btn-primary']"
            @click="executeConfirmAction"
            :disabled="!confirmDialogReady"
          >
            {{ confirmDialog.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { settings, essays, configs, prompts } from '@/api/client.js'
import { createRequestGate } from '@/utils/request-gate.js'
import {
  getProviderDefaultBaseUrl,
  isProviderDefaultUrl,
  resolveProviderBaseUrlOnChange
} from '@/utils/provider-form.js'

const tabs = [
  { key: 'api', label: 'API配置' },
  { key: 'prompts', label: '提示词管理' },
  { key: 'model', label: '模型参数' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' }
]

const activeTab = ref('model')
const modelSaving = ref(false)
const dataSaving = ref(false)
const apiLoading = ref(false)
const promptLoading = ref(false)
const sectionMessages = reactive({
  api: { type: 'info', message: '' },
  prompts: { type: 'info', message: '' },
  model: { type: 'info', message: '' },
  data: { type: 'info', message: '' }
})

// 温度模式配置
const temperatureModes = [
  {
    value: 'precise',
    name: '精确模式',
    icon: '🎯',
    task1: 0.3,
    task2: 0.3,
    desc: '适合客观评分，输出稳定一致'
  },
  {
    value: 'balanced',
    name: '平衡模式',
    icon: '⚖️',
    task1: 0.5,
    task2: 0.5,
    desc: '推荐使用，兼顾准确性与详细度'
  },
  {
    value: 'creative',
    name: '创意模式',
    icon: '💡',
    task1: 0.8,
    task2: 0.8,
    desc: '详细反馈，适合学习分析'
  },
  {
    value: 'custom',
    name: '自定义模式',
    icon: '🛠️',
    task1: null,
    task2: null,
    desc: '兼容旧设置并允许分别配置两个任务'
  }
]

// 设置数据
const modelSettings = ref({
  temperature_mode: 'balanced',
  temperature_task1: 0.3,
  temperature_task2: 0.5
})

const dataSettings = ref({
  history_limit: 100
})

const apiConfigs = ref([])
const testingConfigId = ref(null)
const isApiFormUrlLinked = ref(true)
const isApplyingProviderDefault = ref(false)
const apiForm = ref({
  id: null,
  config_name: '',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  api_key: '',
  default_model: 'gpt-4o-mini'
})

const promptEntries = ref([])
const importPromptJson = ref('')
const confirmDialog = reactive({
  visible: false,
  kind: '',
  section: 'data',
  title: '',
  message: '',
  keyword: '',
  input: '',
  confirmLabel: '确认',
  danger: true,
  payload: null
})
const apiRequestGate = createRequestGate()
const promptRequestGate = createRequestGate()
const settingsRequestGate = createRequestGate()

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

function setSectionMessage(section, type, message) {
  if (!sectionMessages[section]) return
  sectionMessages[section].type = type
  sectionMessages[section].message = String(message || '').trim()
}

function clearSectionMessage(section) {
  setSectionMessage(section, 'info', '')
}

function normalizeTemperatureValue(value, fallback = 0.5) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function findTemperatureMode(modeValue) {
  return temperatureModes.find((mode) => mode.value === modeValue) || null
}

function resolveModeTemperature(taskKey) {
  const mode = findTemperatureMode(modelSettings.value.temperature_mode)
  if (!mode) return 0.5
  if (mode.value === 'custom') {
    return normalizeTemperatureValue(modelSettings.value[`temperature_${taskKey}`])
  }
  return mode[taskKey] ?? 0.5
}

function getModeTemperatureLabel(mode) {
  if (mode.value === 'custom') {
    return `Task 1 ${resolveModeTemperature('task1')} / Task 2 ${resolveModeTemperature('task2')}`
  }
  return `Task 1 ${mode.task1} / Task 2 ${mode.task2}`
}

const confirmDialogReady = computed(() => (
  !confirmDialog.keyword || confirmDialog.input === confirmDialog.keyword
))

function closeConfirmDialog() {
  confirmDialog.visible = false
  confirmDialog.kind = ''
  confirmDialog.section = 'data'
  confirmDialog.title = ''
  confirmDialog.message = ''
  confirmDialog.keyword = ''
  confirmDialog.input = ''
  confirmDialog.confirmLabel = '确认'
  confirmDialog.danger = true
  confirmDialog.payload = null
}

function openConfirmDialog(options) {
  confirmDialog.visible = true
  confirmDialog.kind = options.kind
  confirmDialog.section = options.section || 'data'
  confirmDialog.title = options.title
  confirmDialog.message = options.message
  confirmDialog.keyword = options.keyword || ''
  confirmDialog.input = ''
  confirmDialog.confirmLabel = options.confirmLabel || '确认'
  confirmDialog.danger = options.danger !== false
  confirmDialog.payload = options.payload ?? null
}

async function loadApiConfigs() {
  const requestId = apiRequestGate.begin()
  apiLoading.value = true
  clearSectionMessage('api')
  try {
    const nextConfigs = await configs.list()
    if (!apiRequestGate.isCurrent(requestId)) return
    apiConfigs.value = nextConfigs
  } catch (error) {
    if (!apiRequestGate.isCurrent(requestId)) return
    console.error('加载 API 配置失败:', error)
    setSectionMessage('api', 'error', '加载 API 配置失败: ' + error.message)
  } finally {
    if (apiRequestGate.isCurrent(requestId)) {
      apiLoading.value = false
    }
  }
}

const enabledConfigCount = computed(() => (
  apiConfigs.value.filter((item) => item.is_enabled).length
))

const totalConfigCount = computed(() => apiConfigs.value.length)

function isToggleBlocked(item) {
  return Boolean(item.is_enabled && enabledConfigCount.value <= 1)
}

function getToggleBlockedReason(item) {
  if (isToggleBlocked(item)) {
    return '至少保留一个启用配置，不能禁用唯一启用项'
  }
  return ''
}

function isDeleteBlocked(item) {
  if (totalConfigCount.value <= 1) return true
  if (item.is_enabled && enabledConfigCount.value <= 1) return true
  return false
}

function getDeleteBlockedReason(item) {
  if (totalConfigCount.value <= 1) {
    return '至少保留一个可用配置，不能删除最后一个配置'
  }
  if (item.is_enabled && enabledConfigCount.value <= 1) {
    return '至少保留一个启用配置，不能删除唯一启用项'
  }
  return ''
}

function resetApiForm() {
  apiForm.value = {
    id: null,
    config_name: '',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    default_model: 'gpt-4o-mini'
  }
  isApiFormUrlLinked.value = true
}

function editConfig(item) {
  apiForm.value = {
    id: item.id,
    config_name: item.config_name,
    provider: item.provider,
    base_url: item.base_url,
    api_key: '',
    default_model: item.default_model
  }
  isApiFormUrlLinked.value = isProviderDefaultUrl(item.provider, item.base_url)
}

async function saveApiConfig() {
  try {
    if (!apiForm.value.config_name || !apiForm.value.base_url || !apiForm.value.default_model) {
      setSectionMessage('api', 'error', '请填写完整配置字段')
      return
    }

    const payload = {
      config_name: apiForm.value.config_name,
      provider: apiForm.value.provider,
      base_url: apiForm.value.base_url,
      default_model: apiForm.value.default_model
    }
    if (apiForm.value.api_key) {
      payload.api_key = apiForm.value.api_key
    }

    if (apiForm.value.id) {
      await configs.update(apiForm.value.id, payload)
    } else {
      if (!payload.api_key) {
        setSectionMessage('api', 'error', '新建配置必须填写 API Key')
        return
      }
      await configs.create(payload)
    }

    resetApiForm()
    await loadApiConfigs()
    setSectionMessage('api', 'success', 'API 配置已保存')
  } catch (error) {
    console.error('保存 API 配置失败:', error)
    setSectionMessage('api', 'error', '保存 API 配置失败: ' + error.message)
  }
}

function applyProviderBaseUrl(provider) {
  const defaultUrl = resolveProviderBaseUrlOnChange({
    provider,
    currentBaseUrl: apiForm.value.base_url,
    isLinked: true
  })
  if (!defaultUrl) return
  isApplyingProviderDefault.value = true
  apiForm.value.base_url = defaultUrl
  isApplyingProviderDefault.value = false
}

function requestRemoveConfig(id) {
  const target = apiConfigs.value.find((item) => item.id === id)
  if (!target) return

  if (isDeleteBlocked(target)) {
    setSectionMessage('api', 'error', getDeleteBlockedReason(target))
    return
  }

  openConfirmDialog({
    kind: 'delete-api-config',
    section: 'api',
    title: '删除 API 配置',
    message: `确定删除配置“${target.config_name}”吗？`,
    confirmLabel: '确认删除',
    payload: { id }
  })
}

async function setDefaultConfig(id) {
  try {
    await configs.setDefault(id)
    await loadApiConfigs()
    setSectionMessage('api', 'success', '默认配置已更新')
  } catch (error) {
    console.error('设为默认失败:', error)
    setSectionMessage('api', 'error', '设为默认失败: ' + error.message)
  }
}

async function toggleConfig(id) {
  const target = apiConfigs.value.find((item) => item.id === id)
  if (!target) return

  if (isToggleBlocked(target)) {
    setSectionMessage('api', 'error', getToggleBlockedReason(target))
    return
  }

  try {
    await configs.toggleEnabled(id)
    await loadApiConfigs()
    setSectionMessage('api', 'success', target.is_enabled ? '配置已禁用' : '配置已启用')
  } catch (error) {
    console.error('切换启用状态失败:', error)
    setSectionMessage('api', 'error', '切换状态失败: ' + error.message)
  }
}

async function testConfig(id) {
  testingConfigId.value = id
  clearSectionMessage('api')
  try {
    const result = await configs.test(id)
    setSectionMessage('api', 'success', `连接成功，延迟 ${result.latency}ms`)
  } catch (error) {
    setSectionMessage('api', 'error', '连接失败: ' + error.message)
  } finally {
    testingConfigId.value = null
  }
}

async function loadPromptList() {
  const requestId = promptRequestGate.begin()
  promptLoading.value = true
  clearSectionMessage('prompts')
  try {
    const nextPromptEntries = await prompts.listAll()
    if (!promptRequestGate.isCurrent(requestId)) return
    promptEntries.value = nextPromptEntries
  } catch (error) {
    if (!promptRequestGate.isCurrent(requestId)) return
    console.error('加载提示词失败:', error)
    setSectionMessage('prompts', 'error', '加载提示词失败: ' + error.message)
  } finally {
    if (promptRequestGate.isCurrent(requestId)) {
      promptLoading.value = false
    }
  }
}

async function activatePrompt(id) {
  try {
    await prompts.activate(id)
    await loadPromptList()
    setSectionMessage('prompts', 'success', '提示词版本已激活')
  } catch (error) {
    setSectionMessage('prompts', 'error', '激活失败: ' + error.message)
  }
}

function requestDeletePrompt(id) {
  const target = promptEntries.value.find((item) => item.id === id)
  if (!target) return

  openConfirmDialog({
    kind: 'delete-prompt',
    section: 'prompts',
    title: '删除提示词版本',
    message: `确定删除 ${target.task_type} / ${target.version} 吗？`,
    confirmLabel: '确认删除',
    payload: { id }
  })
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
    setSectionMessage('prompts', 'error', '导出失败: ' + error.message)
  }
}

async function importPromptConfig() {
  try {
    const parsed = JSON.parse(importPromptJson.value)
    await prompts.import(parsed)
    importPromptJson.value = ''
    await loadPromptList()
    setSectionMessage('prompts', 'success', '提示词导入成功')
  } catch (error) {
    setSectionMessage('prompts', 'error', '导入失败: ' + error.message)
  }
}

const task1Temperature = computed(() => {
  return resolveModeTemperature('task1')
})

const task2Temperature = computed(() => {
  return resolveModeTemperature('task2')
})

// 加载设置
async function loadSettings() {
  const requestId = settingsRequestGate.begin()
  try {
    const allSettings = await settings.getAll()
    if (!settingsRequestGate.isCurrent(requestId)) return
    
    if (allSettings.temperature_mode) {
      modelSettings.value.temperature_mode = allSettings.temperature_mode
    }
    if (allSettings.temperature_task1 !== undefined && allSettings.temperature_task1 !== null) {
      modelSettings.value.temperature_task1 = normalizeTemperatureValue(allSettings.temperature_task1, 0.3)
    }
    if (allSettings.temperature_task2 !== undefined && allSettings.temperature_task2 !== null) {
      modelSettings.value.temperature_task2 = normalizeTemperatureValue(allSettings.temperature_task2, 0.5)
    }
    if (allSettings.history_limit) {
      dataSettings.value.history_limit = allSettings.history_limit
    }
  } catch (error) {
    if (!settingsRequestGate.isCurrent(requestId)) return
    console.error('加载设置失败:', error)
    setSectionMessage('model', 'error', '加载设置失败: ' + error.message)
    setSectionMessage('data', 'error', '加载设置失败: ' + error.message)
  }
}

// 保存模型设置
async function saveModelSettings() {
  modelSaving.value = true
  clearSectionMessage('model')
  try {
    const updates = {
      temperature_mode: modelSettings.value.temperature_mode
    }

    if (modelSettings.value.temperature_mode === 'custom') {
      const task1 = normalizeTemperatureValue(modelSettings.value.temperature_task1, NaN)
      const task2 = normalizeTemperatureValue(modelSettings.value.temperature_task2, NaN)
      if (!Number.isFinite(task1) || task1 < 0 || task1 > 2 || !Number.isFinite(task2) || task2 < 0 || task2 > 2) {
        setSectionMessage('model', 'error', '自定义温度必须在 0.0-2.0 之间')
        return
      }
      updates.temperature_task1 = task1
      updates.temperature_task2 = task2
      modelSettings.value.temperature_task1 = task1
      modelSettings.value.temperature_task2 = task2
    }

    await settings.update(updates)
    setSectionMessage('model', 'success', modelSettings.value.temperature_mode === 'custom' ? '自定义温度已保存' : '模型设置已保存')
  } catch (error) {
    console.error('保存失败:', error)
    setSectionMessage('model', 'error', '保存失败: ' + error.message)
  } finally {
    modelSaving.value = false
  }
}

// 保存数据设置
async function saveDataSettings() {
  // 验证范围
  if (dataSettings.value.history_limit < 50 || dataSettings.value.history_limit > 500) {
    setSectionMessage('data', 'error', '记录保留数量必须在 50-500 之间')
    return
  }

  dataSaving.value = true
  clearSectionMessage('data')
  try {
    await settings.update({
      history_limit: dataSettings.value.history_limit
    })
    setSectionMessage('data', 'success', '数据设置已保存')
  } catch (error) {
    console.error('保存失败:', error)
    setSectionMessage('data', 'error', '保存失败: ' + error.message)
  } finally {
    dataSaving.value = false
  }
}

watch(() => apiForm.value.provider, (nextProvider, prevProvider) => {
  if (!nextProvider || nextProvider === prevProvider) return
  if (!isApiFormUrlLinked.value) return
  applyProviderBaseUrl(nextProvider)
})

watch(() => apiForm.value.base_url, (nextBaseUrl) => {
  if (isApplyingProviderDefault.value) return
  isApiFormUrlLinked.value = isProviderDefaultUrl(apiForm.value.provider, nextBaseUrl)
})

// 清空历史记录
function confirmClearHistory() {
  openConfirmDialog({
    kind: 'clear-history',
    section: 'data',
    title: '⚠️ 清空所有历史记录',
    message: '此操作将删除所有历史记录，且不可恢复。',
    keyword: '确认删除',
    confirmLabel: '确认清空',
    payload: null
  })
}

async function executeConfirmAction() {
  if (!confirmDialogReady.value) return

  const { kind, payload, section } = confirmDialog
  try {
    if (kind === 'delete-api-config') {
      await configs.delete(payload.id)
      await loadApiConfigs()
      setSectionMessage('api', 'success', '配置删除成功')
    } else if (kind === 'delete-prompt') {
      await prompts.delete(payload.id)
      await loadPromptList()
      setSectionMessage('prompts', 'success', '提示词版本已删除')
    } else if (kind === 'clear-history') {
      await essays.deleteAll()
      setSectionMessage('data', 'success', '已清空所有历史记录')
    }
    closeConfirmDialog()
  } catch (error) {
    console.error('确认操作失败:', error)
    closeConfirmDialog()
    const errorLabel = kind === 'delete-api-config'
      ? '删除 API 配置失败'
      : kind === 'delete-prompt'
        ? '删除提示词失败'
        : '清空失败'
    setSectionMessage(section, 'error', `${errorLabel}: ${error.message}`)
  }
}

// 初始化
onMounted(() => {
  loadSettings()
  getUserDataPath()
  loadApiConfigs()
  loadPromptList()
})

onBeforeUnmount(() => {
  apiRequestGate.invalidate()
  promptRequestGate.invalidate()
  settingsRequestGate.invalidate()
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

.inline-message {
  margin: 10px 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.inline-message-error {
  background: #ffebee;
  color: #b71c1c;
  border: 1px solid #ffcdd2;
}

.inline-message-success {
  background: #e8f5e9;
  color: #1b5e20;
  border: 1px solid #c8e6c9;
}

.btn-text:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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

.custom-temperature-panel {
  margin: 0 0 20px;
  padding: 16px;
  background: var(--bg-light);
  border-radius: var(--border-radius);
}

.custom-temperature-panel h4 {
  font-size: 15px;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.custom-temperature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.custom-temperature-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.custom-temperature-field input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
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
