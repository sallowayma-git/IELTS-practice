<template>
  <div class="settings-page">
    <header class="settings-hero">
      <div class="settings-hero__copy">
        <span class="settings-eyebrow">Writing Control Center</span>
        <h1 class="heading-serif">写作设置</h1>
        <p>集中管理评测通道、提示词版本、模型参数和历史数据策略。</p>
      </div>
      <div class="settings-hero__metrics" aria-label="设置概览">
        <div class="settings-metric">
          <span>{{ currentTemperatureSummary }}</span>
          <small>当前温度</small>
        </div>
        <div class="settings-metric">
          <span>{{ enabledConfigCount }}/{{ totalConfigCount }}</span>
          <small>启用 API</small>
        </div>
        <div class="settings-metric">
          <span>{{ dataSettings.history_limit }}</span>
          <small>历史保留</small>
        </div>
      </div>
    </header>

    <div class="settings-layout">
      <aside class="settings-nav" aria-label="设置分区">
        <div class="settings-nav__head">
          <span>Settings</span>
          <strong>{{ activeTabMeta.label }}</strong>
        </div>
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          :class="['settings-nav__item', { 'is-active': activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <span class="settings-nav__icon" v-html="tab.icon"></span>
          <span>
            <strong>{{ tab.label }}</strong>
            <small>{{ tab.summary }}</small>
          </span>
        </button>
      </aside>

      <main class="settings-workspace">
        <div class="settings-workspace__head">
          <div>
            <span class="settings-eyebrow">{{ activeTabMeta.kicker }}</span>
            <h2>{{ activeTabMeta.title }}</h2>
            <p>{{ activeTabMeta.description }}</p>
          </div>
        </div>

      <!-- API 配置 -->
        <section v-if="activeTab === 'api'" class="settings-panel">
          <div class="settings-panel__head">
            <div>
              <h3>评测通道</h3>
              <p>至少保留一个启用配置；默认配置必须保持启用。</p>
            </div>
            <div class="settings-badges">
              <span class="settings-badge">{{ totalConfigCount }} 个配置</span>
              <span class="settings-badge settings-badge--success">{{ enabledConfigCount }} 个启用</span>
            </div>
          </div>
          <div v-if="sectionMessages.api.message" :class="['inline-message', `inline-message-${sectionMessages.api.type}`]">
            {{ sectionMessages.api.message }}
          </div>
          <div v-if="apiLoading" class="settings-loading">加载配置中...</div>
          <div v-else-if="!apiConfigs.length" class="settings-empty">暂无 API 配置。</div>
          <div v-else class="settings-list">
            <div v-for="item in apiConfigs" :key="item.id" class="settings-list__row">
              <div class="settings-list__main">
                <div class="settings-list__title">
                  <strong>{{ item.config_name }}</strong>
                  <span v-if="item.is_default" class="settings-badge settings-badge--accent">默认</span>
                  <span :class="['settings-badge', item.is_enabled ? 'settings-badge--success' : 'settings-badge--muted']">
                    {{ item.is_enabled ? '启用' : '禁用' }}
                  </span>
                </div>
                <div class="settings-list__meta">
                  <span>{{ item.provider }}</span>
                  <span>{{ item.default_model }}</span>
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn-text" type="button" @click="editConfig(item)">编辑</button>
                <button class="btn-text" type="button" @click="testConfig(item.id)" :disabled="testingConfigId === item.id">
                    {{ testingConfigId === item.id ? '测试中' : '测试' }}
                </button>
                <button
                    class="btn-text"
                    type="button"
                    :disabled="item.is_default || !item.is_enabled"
                    :title="item.is_default ? '当前已是默认配置' : (!item.is_enabled ? '禁用配置不能设为默认' : '')"
                    @click="setDefaultConfig(item.id)"
                  >
                    设默认
                </button>
                <button
                    class="btn-text"
                    type="button"
                    :disabled="isToggleBlocked(item)"
                    :title="getToggleBlockedReason(item)"
                    @click="toggleConfig(item.id)"
                  >
                    {{ item.is_enabled ? '禁用' : '启用' }}
                </button>
                <button
                    class="btn-text danger"
                    type="button"
                    :disabled="isDeleteBlocked(item)"
                    :title="getDeleteBlockedReason(item)"
                    @click="requestRemoveConfig(item.id)"
                  >
                    删除
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'api'" class="settings-panel settings-panel--split">
          <div class="settings-panel__head">
            <div>
              <h3>{{ apiForm.id ? '编辑配置' : '新建配置' }}</h3>
              <p>{{ apiForm.id ? 'API Key 留空时保持原值。' : '新建配置必须填写 API Key。' }}</p>
            </div>
          </div>
          <div class="settings-form-grid">
            <label class="field">
              <span>配置名称</span>
              <input v-model="apiForm.config_name" placeholder="例如 OpenAI 主通道" />
            </label>
            <label class="field">
              <span>供应商</span>
              <select v-model="apiForm.provider">
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label class="field field--wide">
              <span>Base URL</span>
              <input v-model="apiForm.base_url" placeholder="https://api.openai.com/v1" />
              <small>{{ isApiFormUrlLinked ? '跟随供应商默认地址' : '当前使用自定义地址' }}</small>
            </label>
            <label class="field">
              <span>默认模型</span>
              <input v-model="apiForm.default_model" placeholder="gpt-4o-mini" />
            </label>
            <label class="field">
              <span>API Key</span>
              <input v-model="apiForm.api_key" type="password" autocomplete="off" placeholder="编辑时留空表示不变" />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-brand" type="button" @click="saveApiConfig">保存配置</button>
            <button class="btn btn-warm-sand" type="button" @click="resetApiForm">重置</button>
          </div>
        </section>

      <!-- 提示词管理 -->
        <section v-if="activeTab === 'prompts'" class="settings-panel">
          <div class="settings-panel__head">
            <div>
              <h3>提示词版本</h3>
              <p>管理 Task 1 / Task 2 的评判提示词版本。</p>
            </div>
            <div class="settings-badges">
              <span class="settings-badge">{{ promptEntries.length }} 个版本</span>
              <span class="settings-badge settings-badge--success">{{ activePromptCount }} 个激活</span>
            </div>
          </div>
          <div v-if="sectionMessages.prompts.message" :class="['inline-message', `inline-message-${sectionMessages.prompts.type}`]">
            {{ sectionMessages.prompts.message }}
          </div>
          <div v-if="promptLoading" class="settings-loading">加载提示词中...</div>
          <div v-else-if="!promptEntries.length" class="settings-empty">暂无提示词版本。</div>
          <div v-else class="settings-list">
            <div v-for="item in promptEntries" :key="item.id" class="settings-list__row">
              <div class="settings-list__main">
                <div class="settings-list__title">
                  <strong>{{ item.task_type }}</strong>
                  <span :class="['settings-badge', item.is_active ? 'settings-badge--success' : 'settings-badge--muted']">
                    {{ item.is_active ? '激活' : '未激活' }}
                  </span>
                </div>
                <div class="settings-list__meta">
                  <span>ID {{ item.id }}</span>
                  <span>{{ item.version }}</span>
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn-text" type="button" @click="activatePrompt(item.id)">激活</button>
                <button class="btn-text danger" type="button" @click="requestDeletePrompt(item.id)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'prompts'" class="settings-panel">
          <div class="settings-panel__head">
            <div>
              <h3>导入/导出</h3>
              <p>支持完整 JSON 配置或版本数组。</p>
            </div>
          </div>
          <textarea
            v-model="importPromptJson"
            class="json-editor"
            rows="10"
            placeholder='粘贴 JSON（支持 {version,task1,task2} 或 [{task_type,...}]）'
          ></textarea>
          <div class="form-actions">
            <button class="btn btn-brand" type="button" @click="importPromptConfig">导入提示词</button>
            <button class="btn btn-warm-sand" type="button" @click="exportPromptConfig">导出当前激活</button>
          </div>
        </section>

      <!-- 模型参数 -->
        <section v-if="activeTab === 'model'" class="settings-panel settings-panel--model">
          <div class="settings-panel__head">
            <div>
              <h3>温度模式</h3>
              <p>温度值影响 AI 评分的严格程度和反馈详细度。</p>
            </div>
            <span class="settings-badge settings-badge--accent">{{ currentTemperatureSummary }}</span>
          </div>
          <div v-if="sectionMessages.model.message" :class="['inline-message', `inline-message-${sectionMessages.model.type}`]">
            {{ sectionMessages.model.message }}
          </div>
          
          <div class="temperature-modes">
            <button
              v-for="mode in temperatureModes" 
              :key="mode.value"
              :class="['mode-card', { active: modelSettings.temperature_mode === mode.value }]"
              type="button"
              @click="modelSettings.temperature_mode = mode.value"
            >
              <div class="mode-header">
                <span class="mode-icon" v-html="mode.icon"></span>
                <span>
                  <span class="mode-name">{{ mode.name }}</span>
                  <span class="mode-desc">{{ mode.desc }}</span>
                </span>
              </div>
              <div class="mode-temp">{{ getModeTemperatureLabel(mode) }}</div>
            </button>
          </div>

          <div v-if="modelSettings.temperature_mode === 'custom'" class="custom-temperature-panel">
            <div class="settings-panel__head settings-panel__head--compact">
              <div>
                <h4>自定义任务温度</h4>
                <p>范围 0.0-2.0，分别作用于 Task 1 和 Task 2。</p>
              </div>
            </div>
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
          </div>

          <div class="settings-savebar">
            <div>
              <strong>{{ currentMode?.name || '当前模式' }}</strong>
              <span>{{ currentMode?.desc || '保存后应用到后续评测。' }}</span>
            </div>
            <button class="btn btn-brand" type="button" @click="saveModelSettings" :disabled="modelSaving">
              {{ modelSaving ? '保存中...' : '保存设置' }}
            </button>
          </div>
        </section>

      <!-- 数据管理 -->
        <section v-if="activeTab === 'data'" class="settings-panel">
          <div class="settings-panel__head">
            <div>
              <h3>历史记录</h3>
              <p>控制本地历史记录自动清理上限。</p>
            </div>
            <span class="settings-badge">{{ dataSettings.history_limit }} 条</span>
          </div>
          <div v-if="sectionMessages.data.message" :class="['inline-message', `inline-message-${sectionMessages.data.type}`]">
            {{ sectionMessages.data.message }}
          </div>
          
          <div class="setting-control">
            <div class="setting-control__copy">
              <strong>自动保留最近记录数量</strong>
              <span>超过上限后，系统自动清理最早记录，避免历史数据无限增长。</span>
            </div>
            <label class="setting-control__input">
              <input
                type="number"
                v-model.number="dataSettings.history_limit"
                min="50"
                max="500"
                step="50"
              />
              <span>条</span>
            </label>
          </div>
          <div class="settings-savebar">
            <span>允许范围 50-500，按 50 递增。</span>
            <button class="btn btn-brand" type="button" @click="saveDataSettings" :disabled="dataSaving">
              {{ dataSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </section>

        <section v-if="activeTab === 'data'" class="settings-panel danger-zone">
          <div class="settings-panel__head">
            <div>
              <h3>危险操作</h3>
              <p>这些操作会影响本地历史数据。</p>
            </div>
          </div>
          <div class="danger-item">
            <div>
              <h4>清空所有历史记录</h4>
              <p class="hint">此操作将删除所有评分历史，且不可恢复</p>
            </div>
            <button class="btn btn-danger" type="button" @click="confirmClearHistory">
              <span class="btn-icon-inline" v-html="icons.trash"></span>
              清空历史
            </button>
          </div>
        </section>

      <!-- 关于 -->
        <section v-if="activeTab === 'about'" class="settings-panel about-section">
          <div class="about-identity">
            <div class="app-icon">
              <img
                class="app-icon__image"
                :src="appLogoSrc"
                alt="IELTS Practice Logo"
                loading="eager"
              />
            </div>
            <div>
              <h2 class="heading-serif">雅思写作 AI 评判</h2>
              <p class="version">Version 0.3.1</p>
            </div>
          </div>
          
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
              <li><span>已完成</span>AI 作文评分（Task 1 & Task 2）</li>
              <li><span>已完成</span>详细评分报告与反馈</li>
              <li><span>已完成</span>写作页题库选题（自由写作 / 题库模式）</li>
              <li><span>已完成</span>题目管理（CRUD + 批量导入）</li>
              <li><span>已完成</span>默认官方题库 seed（Task 2 全量 + Task 1 最小样本）</li>
              <li><span>已完成</span>历史记录管理（筛选 + 导出CSV）</li>
              <li><span>已完成</span>历史统计对比（雷达图 + 范围切换）</li>
              <li><span>已完成</span>草稿自动保存与恢复</li>
              <li><span>已完成</span>模型参数配置</li>
              <li><span>收口中</span>写作专属自动化报告 / 打包验收</li>
            </ul>
          </div>
        </section>
      </main>
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
        />

        <div class="dialog-actions">
          <button class="btn btn-warm-sand" type="button" @click="closeConfirmDialog">
            取消
          </button>
          <button 
            :class="['btn', confirmDialog.danger ? 'btn-danger' : 'btn-brand']"
            type="button"
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
  isProviderDefaultUrl,
  resolveProviderBaseUrlOnChange
} from '@/utils/provider-form.js'

const iconAttrs = 'width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'

const icons = {
  api: `<svg ${iconAttrs}><circle cx="7" cy="12" r="2.4"></circle><circle cx="17" cy="7" r="2.4"></circle><circle cx="17" cy="17" r="2.4"></circle><path d="M9.2 10.9 14.8 8"></path><path d="M9.2 13.1 14.8 16"></path></svg>`,
  prompts: `<svg ${iconAttrs}><path d="M7 5h10v14H7z"></path><path d="M10 9h4"></path><path d="M10 13h3"></path></svg>`,
  model: `<svg ${iconAttrs}><path d="M5 7h14"></path><path d="M5 12h14"></path><path d="M5 17h14"></path><circle cx="9" cy="7" r="1.8"></circle><circle cx="15" cy="12" r="1.8"></circle><circle cx="11" cy="17" r="1.8"></circle></svg>`,
  data: `<svg ${iconAttrs}><path d="M7 7h10v12H7z"></path><path d="M9 7V5h6v2"></path><path d="M10 12h4"></path></svg>`,
  about: `<svg ${iconAttrs}><circle cx="12" cy="12" r="8"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path></svg>`,
  precise: `<svg ${iconAttrs}><circle cx="12" cy="12" r="7"></circle><path d="M12 8v8"></path><path d="M8 12h8"></path></svg>`,
  balanced: `<svg ${iconAttrs}><path d="M5 8h14"></path><path d="M5 16h14"></path><circle cx="10" cy="8" r="2"></circle><circle cx="14" cy="16" r="2"></circle></svg>`,
  creative: `<svg ${iconAttrs}><path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z"></path><path d="M18 15l.7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7z"></path></svg>`,
  custom: `<svg ${iconAttrs}><path d="M5 8h14"></path><path d="M5 16h14"></path><circle cx="16" cy="8" r="2"></circle><circle cx="8" cy="16" r="2"></circle></svg>`,
  trash: `<svg ${iconAttrs}><path d="M6 7h12"></path><path d="M10 7V5h4v2"></path><path d="M8 10v8"></path><path d="M16 10v8"></path><path d="M9 19h6"></path></svg>`
}

const tabs = [
  {
    key: 'api',
    label: 'API 配置',
    summary: '供应商、模型、密钥',
    kicker: 'Provider',
    title: 'API 配置',
    description: '管理评测请求的供应商、默认模型和连接状态。',
    icon: icons.api
  },
  {
    key: 'prompts',
    label: '提示词管理',
    summary: '版本、激活、导入导出',
    kicker: 'Prompt',
    title: '提示词管理',
    description: '维护评判提示词版本，控制当前生效的评测标准。',
    icon: icons.prompts
  },
  {
    key: 'model',
    label: '模型参数',
    summary: '温度模式与任务差异',
    kicker: 'Model',
    title: '模型参数',
    description: '选择适合评测场景的温度策略，保存后作用于后续评分。',
    icon: icons.model
  },
  {
    key: 'data',
    label: '数据管理',
    summary: '历史上限与清理',
    kicker: 'Storage',
    title: '数据管理',
    description: '控制历史记录保留策略，并处理不可恢复的数据操作。',
    icon: icons.data
  },
  {
    key: 'about',
    label: '关于',
    summary: '版本、运行环境、能力',
    kicker: 'About',
    title: '关于写作模块',
    description: '查看当前版本、Electron 环境和写作模块能力范围。',
    icon: icons.about
  }
]
const appLogoSrc = '../../assets/images/herbal_green_flat_logo_1776094316057.png?v=20260414b'

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
    icon: icons.precise,
    task1: 0.3,
    task2: 0.3,
    desc: '适合客观评分，输出稳定一致'
  },
  {
    value: 'balanced',
    name: '平衡模式',
    icon: icons.balanced,
    task1: 0.5,
    task2: 0.5,
    desc: '推荐使用，兼顾准确性与详细度'
  },
  {
    value: 'creative',
    name: '创意模式',
    icon: icons.creative,
    task1: 0.8,
    task2: 0.8,
    desc: '详细反馈，适合学习分析'
  },
  {
    value: 'custom',
    name: '自定义模式',
    icon: icons.custom,
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

const activePromptCount = computed(() => (
  promptEntries.value.filter((item) => item.is_active).length
))

const activeTabMeta = computed(() => (
  tabs.find((tab) => tab.key === activeTab.value) || tabs[0]
))

const currentMode = computed(() => findTemperatureMode(modelSettings.value.temperature_mode))

const currentTemperatureSummary = computed(() => (
  `${resolveModeTemperature('task1')} / ${resolveModeTemperature('task2')}`
))

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
  max-width: 1400px;
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
  background: var(--bg-muted);
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
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.app-icon__image {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
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

.settings-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: rise-in 0.45s var(--ease-smooth);
}

.settings-page .page-header__copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-page .page-header__copy h1 {
  font-family: var(--font-family-display);
  font-size: 46px;
  line-height: 0.94;
  letter-spacing: 0;
}

.settings-page .page-header__copy p {
  max-width: 760px;
  color: var(--text-secondary);
  font-size: 15px;
}

.settings-page .tabs-container {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 20px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
}

.settings-page .tabs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-self: start;
  position: sticky;
  top: 108px;
  padding: 14px;
  border: 1px solid var(--lg-border-color);
  border-radius: var(--radius-lg);
  background: var(--lg-bg-elevated);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.settings-page .tabs-head {
  display: grid;
  gap: 2px;
  padding: 4px 6px 10px;
  border-bottom: 1px solid var(--lg-border-subtle);
  margin-bottom: 2px;
}

.settings-page .tabs-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.settings-page .tabs-head p {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-page .tab-content {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--lg-border-color);
  border-radius: var(--radius-lg);
  background: var(--lg-bg-elevated);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.settings-page .tab {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  color: var(--text-secondary);
  background: transparent;
}

.settings-page .tab-icon {
  font-size: 12px;
  color: var(--text-muted);
}

.settings-page .tab:hover {
  background: rgba(255, 255, 255, 0.42);
  border-color: var(--lg-border-color);
}

.settings-page .tab.active {
  color: var(--text-primary);
  border-bottom-color: transparent;
  border-color: var(--lg-border-color);
  background: rgba(255, 255, 255, 0.7);
  box-shadow: var(--lg-shadow-subtle);
}

.settings-page .section + .section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--line-1);
}

.settings-page .section h3 {
  font-family: var(--font-family-display);
  font-size: 28px;
  line-height: 0.96;
  letter-spacing: 0;
}

.settings-page .model-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.settings-page .preset-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--primary-color);
  background: rgba(201, 100, 66, 0.1);
  border: 1px solid rgba(201, 100, 66, 0.18);
}

.settings-page .form-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.settings-page .temperature-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.settings-page .mode-card {
  padding: 14px 16px;
  border: 1px solid var(--lg-border-color);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.56);
  cursor: pointer;
  box-shadow: var(--lg-shadow-subtle);
  backdrop-filter: blur(var(--lg-blur-sm)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-sm)) saturate(var(--lg-saturate));
  transition:
    border-color var(--duration-fast) ease,
    background-color var(--duration-fast) ease,
    transform var(--duration-fast) ease;
}

.settings-page .mode-card:hover {
  transform: translateY(-1px);
  border-color: rgba(201, 100, 66, 0.28);
}

.settings-page .mode-card.active {
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(201, 100, 66, 0.36);
  box-shadow: var(--lg-shadow-elevated);
}

.settings-page .config-table,
.settings-page .json-editor,
.settings-page .about-info,
.settings-page .about-features,
.settings-page .custom-temperature-panel,
.settings-page .danger-zone {
  border-radius: var(--radius-md);
}

.settings-page .danger-zone {
  border-color: rgba(181, 51, 51, 0.22);
  background: rgba(255, 240, 238, 0.6);
}

.settings-page .about-section {
  max-width: none;
  text-align: left;
}

.settings-page .about-section h2 {
  font-family: var(--font-family-display);
  font-size: 36px;
  line-height: 0.96;
  letter-spacing: 0;
}

@media (max-width: 960px) {
  .settings-page .tabs-container {
    grid-template-columns: 1fr;
  }

  .settings-page .tabs {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
  }
}

@media (max-width: 720px) {
  .settings-page .temperature-modes {
    grid-template-columns: 1fr;
  }

  .settings-page .form-actions {
    flex-direction: column;
    align-items: stretch;
  }
}

/* Settings workbench refresh */
.settings-page {
  max-width: 1320px;
  padding: 12px 8px 48px;
  gap: 18px;
}

.settings-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.42)),
    linear-gradient(90deg, rgba(201, 100, 66, 0.08), rgba(83, 120, 93, 0.08));
  box-shadow: 0 18px 42px -24px rgba(20, 20, 19, 0.26);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-hero__copy {
  display: grid;
  gap: 8px;
}

.settings-eyebrow {
  color: var(--primary-color);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-hero h1 {
  font-size: 44px;
  line-height: 1;
  letter-spacing: 0;
}

.settings-hero p,
.settings-workspace__head p,
.settings-panel__head p,
.field small,
.settings-savebar span,
.setting-control__copy span {
  color: var(--text-secondary);
}

.settings-hero p {
  max-width: 620px;
  font-size: 0.98rem;
}

.settings-hero__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(92px, 1fr));
  gap: 10px;
  min-width: min(420px, 100%);
}

.settings-metric {
  min-height: 76px;
  display: grid;
  align-content: center;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.64);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.56);
}

.settings-metric span {
  color: var(--text-primary);
  font-size: 1.22rem;
  font-weight: 800;
  line-height: 1.1;
}

.settings-metric small {
  color: var(--text-muted);
  font-size: 0.76rem;
}

.settings-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.settings-nav {
  position: sticky;
  top: 92px;
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 14px 36px -28px rgba(20, 20, 19, 0.34);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-nav__head {
  display: grid;
  gap: 2px;
  padding: 6px 8px 12px;
  border-bottom: 1px solid rgba(77, 76, 72, 0.1);
  margin-bottom: 4px;
}

.settings-nav__head span {
  color: var(--text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-nav__head strong {
  color: var(--text-primary);
  font-size: 1rem;
}

.settings-nav__item {
  width: 100%;
  min-height: 58px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  color: var(--text-secondary);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-smooth),
    border-color var(--duration-fast) var(--ease-smooth),
    transform var(--duration-fast) var(--ease-smooth);
}

.settings-nav__item:hover {
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.72);
  background: rgba(255, 255, 255, 0.48);
}

.settings-nav__item.is-active {
  color: var(--text-primary);
  border-color: rgba(201, 100, 66, 0.24);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 8px 18px -14px rgba(201, 100, 66, 0.54);
}

.settings-nav__item strong,
.settings-nav__item small {
  display: block;
  min-width: 0;
}

.settings-nav__item strong {
  font-size: 0.94rem;
  line-height: 1.2;
}

.settings-nav__item small {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.25;
}

.settings-nav__icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 10px;
  font-size: 18px;
  color: var(--primary-color);
  background: rgba(255, 255, 255, 0.58);
  border: 1px solid rgba(201, 100, 66, 0.12);
}

.settings-nav__icon :deep(svg),
.settings-page .mode-icon :deep(svg),
.settings-page .btn-icon-inline :deep(svg) {
  width: 1em;
  height: 1em;
  display: block;
  flex: 0 0 auto;
}

.settings-workspace {
  min-width: 0;
  display: grid;
  gap: 14px;
}

.settings-workspace__head,
.settings-panel {
  border: 1px solid rgba(255, 255, 255, 0.64);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 18px 42px -30px rgba(20, 20, 19, 0.3);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-workspace__head {
  padding: 22px 24px;
}

.settings-workspace__head h2 {
  margin-top: 4px;
  font-size: 30px;
  line-height: 1.1;
  letter-spacing: 0;
}

.settings-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.settings-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.settings-panel__head--compact {
  margin-bottom: 4px;
}

.settings-panel__head h3,
.settings-panel__head h4 {
  margin: 0;
  font-size: 1.28rem;
  line-height: 1.2;
  letter-spacing: 0;
}

.settings-badges,
.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 4px 9px;
  border: 1px solid rgba(77, 76, 72, 0.1);
  border-radius: 999px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.54);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.settings-badge--accent {
  color: var(--primary-color);
  border-color: rgba(201, 100, 66, 0.22);
  background: rgba(201, 100, 66, 0.1);
}

.settings-badge--success {
  color: var(--success-color);
  border-color: rgba(83, 120, 93, 0.2);
  background: rgba(83, 120, 93, 0.1);
}

.settings-badge--muted {
  color: var(--text-muted);
  background: rgba(232, 230, 220, 0.5);
}

.settings-list {
  display: grid;
  gap: 8px;
}

.settings-list__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  min-height: 72px;
  padding: 12px 14px;
  border: 1px solid rgba(77, 76, 72, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.48);
}

.settings-list__main {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.settings-list__title,
.settings-list__meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.settings-list__title strong {
  color: var(--text-primary);
  font-size: 0.98rem;
}

.settings-list__meta {
  color: var(--text-muted);
  font-size: 0.84rem;
}

.settings-actions {
  justify-content: flex-end;
}

.settings-page .btn-text {
  min-height: 30px;
  padding: 4px 8px;
  border-radius: 8px;
  transition:
    color var(--duration-fast) var(--ease-smooth),
    background var(--duration-fast) var(--ease-smooth);
}

.settings-page .btn-text:hover:not(:disabled) {
  background: rgba(201, 100, 66, 0.09);
}

.settings-page .btn-text:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.settings-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field,
.custom-temperature-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.field--wide {
  grid-column: 1 / -1;
}

.field span,
.custom-temperature-field span {
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 700;
}

.settings-page input,
.settings-page select,
.settings-page textarea {
  min-height: 44px;
  border-color: rgba(77, 76, 72, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.72);
}

.settings-page .dialog .input {
  margin: 14px 0 0;
}

.json-editor {
  min-height: 260px;
  font-family: var(--font-family-mono);
  line-height: 1.55;
}

.settings-page .form-actions {
  margin-top: 0;
}

.settings-page .temperature-modes {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.settings-page .mode-card {
  min-height: 140px;
  display: grid;
  align-content: space-between;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(77, 76, 72, 0.1);
  border-radius: 14px;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.52);
  text-align: left;
}

.settings-page .mode-card.active {
  border-color: rgba(201, 100, 66, 0.38);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.58)),
    rgba(201, 100, 66, 0.08);
}

.settings-page .mode-header {
  justify-content: flex-start;
  gap: 12px;
  margin: 0;
}

.settings-page .mode-icon {
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 12px;
  font-size: 20px;
  color: var(--primary-color);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(201, 100, 66, 0.12);
}

.mode-name,
.mode-desc {
  display: block;
}

.settings-page .mode-name {
  font-size: 0.98rem;
}

.settings-page .mode-desc {
  margin-top: 3px;
  line-height: 1.35;
}

.settings-page .mode-temp {
  margin: 0;
  color: var(--primary-color);
  font-family: var(--font-family-mono);
  font-size: 0.86rem;
}

.custom-temperature-panel {
  padding: 16px;
  border: 1px solid rgba(77, 76, 72, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.44);
}

.custom-temperature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.settings-savebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid rgba(77, 76, 72, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
}

.settings-savebar > div {
  display: grid;
  gap: 2px;
}

.settings-savebar strong {
  color: var(--text-primary);
}

.setting-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 18px;
  align-items: center;
  padding: 16px;
  border: 1px solid rgba(77, 76, 72, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.48);
}

.setting-control__copy {
  display: grid;
  gap: 4px;
}

.setting-control__copy strong {
  color: var(--text-primary);
}

.setting-control__input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.setting-control__input span {
  color: var(--text-secondary);
  font-weight: 700;
}

.settings-page .danger-zone {
  border-color: rgba(181, 51, 51, 0.22);
  background: rgba(255, 247, 245, 0.72);
}

.danger-zone .settings-panel__head h3,
.settings-page .btn-text.danger {
  color: var(--danger-color);
}

.settings-page .danger-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px;
  border: 1px solid rgba(181, 51, 51, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.52);
}

.settings-page .danger-item h4 {
  margin: 0 0 2px;
}

.settings-page .btn-danger {
  gap: 8px;
  white-space: nowrap;
}

.settings-page .btn-icon-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-size: 15px;
}

.about-section {
  max-width: none;
  text-align: left;
}

.about-identity {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-icon {
  margin: 0;
}

.app-icon__image {
  width: 72px;
  height: 72px;
  border-radius: 16px;
}

.about-section h2 {
  margin: 0;
  font-size: 32px;
  line-height: 1.08;
  letter-spacing: 0;
}

.version {
  margin: 4px 0 0;
}

.about-info,
.about-features {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid rgba(77, 76, 72, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.46);
}

.info-row {
  gap: 16px;
}

.info-row .value {
  max-width: 70%;
  overflow-wrap: anywhere;
  text-align: right;
  font-family: var(--font-family-mono);
}

.about-features li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
}

.about-features li span {
  display: inline-flex;
  justify-content: center;
  min-height: 24px;
  padding: 3px 7px;
  border-radius: 999px;
  color: var(--success-color);
  background: rgba(83, 120, 93, 0.1);
  font-size: 0.72rem;
  font-weight: 800;
}

.settings-loading,
.settings-empty {
  padding: 22px;
  border: 1px dashed rgba(77, 76, 72, 0.16);
  border-radius: 12px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.34);
}

@media (max-width: 1080px) {
  .settings-hero {
    grid-template-columns: 1fr;
  }

  .settings-hero__metrics {
    width: 100%;
  }

  .settings-layout {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    position: static;
    grid-template-columns: repeat(5, minmax(120px, 1fr));
    overflow-x: auto;
  }

  .settings-nav__head {
    display: none;
  }
}

@media (max-width: 760px) {
  .settings-page {
    padding: 4px 0 32px;
  }

  .settings-hero,
  .settings-workspace__head,
  .settings-panel {
    padding: 16px;
    border-radius: 14px;
  }

  .settings-hero h1 {
    font-size: 34px;
  }

  .settings-hero__metrics,
  .settings-page .temperature-modes,
  .settings-form-grid,
  .custom-temperature-grid,
  .setting-control {
    grid-template-columns: 1fr;
  }

  .settings-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    overflow-x: visible;
  }

  .settings-panel__head,
  .settings-list__row,
  .settings-savebar,
  .settings-page .danger-item {
    align-items: stretch;
    flex-direction: column;
    grid-template-columns: 1fr;
  }

  .settings-actions,
  .settings-savebar,
  .settings-page .form-actions {
    justify-content: flex-start;
  }

  .settings-page .btn,
  .settings-actions .btn-text {
    width: 100%;
  }

  .about-identity,
  .info-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .info-row .value {
    max-width: 100%;
    text-align: left;
  }
}
</style>
