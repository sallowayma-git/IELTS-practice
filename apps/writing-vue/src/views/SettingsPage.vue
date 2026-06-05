<template>
  <div id="settings-view" class="settings-page view hero-panel hero-section active" data-writing-settings>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">⚙️ 系统设置</h2>
    </div>

    <div class="hero-settings-group" aria-label="设置主面板">
      <section class="hero-panel hero-section system-management-panel">
        <h3 class="heading-serif">🔧 系统管理</h3>
        <p class="hero-panel__muted">系统工具和设置选项</p>
        <div class="hero-settings-actions">
          <button class="btn btn-warning hero-btn hero-btn--warn" id="clear-cache-btn" type="button" @click="clearAppCache">
            🗑️ 清除缓存
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="load-library-btn" type="button" @click="openWritingTopicLibrary">
            📂 加载题库
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="theme-switcher-btn-entry" type="button" @click="switchBackgroundTheme">
            🎨 主题切换
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="show-onboarding-btn" type="button" @click="startOnboardingTour">
            🎯 显示引导
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="library-config-btn" type="button" data-action="library-config" @click="openWritingLibraryConfig">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-emoji-icon" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14"></line>
              <line x1="4" y1="10" x2="4" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12" y2="3"></line>
              <line x1="20" y1="21" x2="20" y2="16"></line>
              <line x1="20" y1="12" x2="20" y2="3"></line>
              <line x1="1" y1="14" x2="7" y2="14"></line>
              <line x1="9" y1="8" x2="15" y2="8"></line>
              <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
            题库配置切换
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="force-refresh-btn" type="button" data-action="force-refresh" @click="refreshWritingLibrary">
            🔄 强制刷新题库
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="check-updates-btn" type="button" data-update-action="open-modal" @click="openUpdateManager">
            🔍 检查更新
          </button>
        </div>
      </section>

      <section class="hero-panel hero-section data-management-panel">
        <h3 class="heading-serif">💾 数据管理</h3>
        <p class="hero-panel__muted">数据备份、导入导出和完整性检查</p>
        <div class="hero-settings-actions">
          <button class="btn hero-btn data-mgmt-btn" id="create-backup-btn" type="button" @click="createSettingsBackup">
            💾 创建备份
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="backup-list-btn" type="button" @click="showSettingsBackupList">
            📋 备份列表
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="export-data-btn" type="button" @click="exportSettingsData">
            📤 导出数据
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="import-data-btn" type="button" @click="triggerSettingsImport">
            📥 导入数据
          </button>
          <input ref="settingsImportInput" class="settings-file-input" type="file" accept="application/json,.json" @change="handleSettingsImport" />
        </div>
      </section>

      <section class="hero-panel hero-section system-info-panel">
        <h3 class="heading-serif">📊 系统信息</h3>
        <div class="hero-surface settings-system-info system-info-surface">
          <div class="settings-system-info__status system-info-status">题库状态: {{ topicLibraryStatus }}</div>
          <div>总题目数: <span id="total-exams">{{ topicLibraryStats.total }}</span></div>
          <div>Task 1: <span id="html-exams">{{ topicLibraryStats.task1 }}</span></div>
          <div>Task 2: <span id="pdf-exams">{{ topicLibraryStats.task2 }}</span></div>
          <div>最近更新: <span id="last-update">{{ topicLibraryStats.lastUpdate }}</span></div>
          <div>Electron版本: <span>{{ electronVersion }}</span></div>
          <div>Node版本: <span>{{ nodeVersion }}</span></div>
          <div>数据目录: <span>{{ userDataPath || '加载中...' }}</span></div>
        </div>
        <div class="settings-credit">
          <a href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT" target="_blank" rel="noopener noreferrer" class="inline-hover-link">问题反馈</a>
          <a href="https://github.com/sallowayma-git" target="_blank" rel="noopener noreferrer">Salloway呈现</a>
        </div>
      </section>
    </div>

    <div v-if="globalMessage.message" :class="['inline-message', `inline-message-${globalMessage.type}`]">
      {{ globalMessage.message }}
    </div>

    <div
      v-if="settingsDetailOpen"
      class="settings-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-label="写作设置明细"
      @click.self="hideSettingsDetail"
    >
      <section class="settings-detail-panel hero-panel hero-section">
        <div class="settings-detail-head">
          <div>
            <p class="settings-detail-eyebrow">{{ activeTabMeta.kicker }}</p>
            <h3 class="heading-serif">{{ activeTabMeta.title }}</h3>
            <p>{{ activeTabMeta.description }}</p>
          </div>
          <button class="settings-detail-close" type="button" aria-label="关闭写作设置" @click="hideSettingsDetail">×</button>
        </div>

        <div class="settings-tabs" role="tablist" aria-label="写作设置分类">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            :class="['settings-tab', { active: activeTab === tab.key }]"
            @click="activeTab = tab.key"
          >
            <span class="settings-tab__icon" v-html="tab.icon"></span>
            {{ tab.label }}
          </button>
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

        <section v-if="activeTab === 'data' && settingsBackupListOpen" class="settings-panel" data-writing-settings-backup-list>
          <div class="settings-panel__head">
            <div>
              <h3>设置备份列表</h3>
              <p>最近 10 个写作设置备份保存在本机，可恢复、下载或删除。</p>
            </div>
            <span class="settings-badge">{{ settingsBackups.length }} 个备份</span>
          </div>
          <div v-if="!settingsBackups.length" class="settings-empty">暂无设置备份。</div>
          <div v-else class="settings-list">
            <div v-for="backup in settingsBackups" :key="backup.id" class="settings-list__row">
              <div class="settings-list__main">
                <div class="settings-list__title">
                  <strong>{{ backup.id }}</strong>
                  <span class="settings-badge settings-badge--muted">{{ formatSettingsBackupDate(backup) }}</span>
                </div>
                <div class="settings-list__meta">
                  <span>{{ backup.apiConfigCount }} 个 API 配置</span>
                  <span>{{ backup.promptCount }} 个提示词版本</span>
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn-text" type="button" @click="restoreSettingsBackup(backup)">恢复</button>
                <button class="btn-text" type="button" @click="downloadSettingsBackup(backup)">下载</button>
                <button class="btn-text danger" type="button" @click="deleteSettingsBackup(backup.id)">删除</button>
              </div>
            </div>
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
      </section>
    </div>

    <div
      id="theme-switcher-modal"
      class="theme-modal"
      :class="{ show: themeSwitcherOpen }"
      @click.self="hideThemeSwitcher"
    >
      <div class="theme-modal-content">
        <div class="theme-modal-header">
          <h3 class="heading-serif">🎨 主题切换</h3>
          <button
            class="theme-modal-close"
            type="button"
            data-index-action="hide-theme-switcher"
            aria-label="关闭"
            @click="hideThemeSwitcher"
          >
            ×
          </button>
        </div>
        <div class="theme-modal-body">
          <div class="theme-options-viewport" role="presentation">
            <div class="theme-options-glass">
              <div
                v-for="theme in backgroundThemes"
                :key="theme.value"
                class="theme-card"
              >
                <div :class="['theme-card-bg', theme.previewClass]"></div>
                <div class="theme-card-glass-layer">
                  <div class="theme-card-header">
                    <h4 class="theme-card-title">{{ theme.title }}</h4>
                    <div class="theme-card-subtitle">
                      <span>{{ theme.subtitle }}</span>
                    </div>
                  </div>
                  <div class="theme-card-footer">
                    <span class="theme-card-tag">{{ theme.tag }}</span>
                    <button
                      class="theme-card-btn"
                      type="button"
                      data-index-action="switch-bg-theme"
                      :data-action-value="theme.value"
                      @click="applyBackgroundTheme(theme.value)"
                    >
                      应用
                    </button>
                  </div>
                </div>
              </div>
            </div>
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
import { useRouter } from 'vue-router'
import { settings, essays, configs, prompts, topics } from '@/api/client.js'
import {
  openLegacyUpdateManager,
  startLegacyOnboardingTour,
  switchLegacyBackgroundTheme
} from '@/modules/legacy/legacyBridge'
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

const router = useRouter()
const WRITING_SETTINGS_BACKUP_STORAGE_KEY = 'ielts_writing_settings_backups_v1'
const MAX_SETTINGS_BACKUPS = 10
const activeTab = ref('model')
const settingsDetailOpen = ref(false)
const modelSaving = ref(false)
const dataSaving = ref(false)
const apiLoading = ref(false)
const promptLoading = ref(false)
const settingsImportInput = ref(null)
const settingsBackupListOpen = ref(false)
const settingsBackups = ref([])
const themeSwitcherOpen = ref(false)
const topicLibraryStats = ref({
  total: '加载中...',
  task1: '加载中...',
  task2: '加载中...',
  lastUpdate: '加载中...'
})
const globalMessage = reactive({ type: 'info', message: '' })
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

const backgroundThemes = [
  {
    value: 'misty-mountain',
    title: '晨雾群山',
    subtitle: '⛰️ Misty Mountain',
    tag: '动态',
    previewClass: 'theme-bg-misty'
  },
  {
    value: 'teal-ocean',
    title: '深海孤航',
    subtitle: '⛵ Teal Ocean',
    tag: '动态',
    previewClass: 'theme-bg-ocean'
  },
  {
    value: 'floral-bloom',
    title: '落日雾花',
    subtitle: '🌸 Floral Bloom',
    tag: '静态',
    previewClass: 'theme-bg-floral'
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

const topicLibraryStatus = computed(() => {
  if (topicLibraryStats.value.total === '未连接') return '写作题库统计待同步'
  if (topicLibraryStats.value.total === '加载中...') return '正在同步写作题库统计'
  return '已加载写作题库索引'
})

function normalizeTopicLibraryStats(payload) {
  const byTypeRows = Array.isArray(payload?.byType) ? payload.byType : []
  const byType = byTypeRows.reduce((acc, row) => {
    const key = String(row?.type || '').trim().toLowerCase()
    const count = Number(row?.count)
    if (key && Number.isFinite(count)) {
      acc[key] = count
    }
    return acc
  }, {})
  return {
    total: Number.isFinite(Number(payload?.total)) ? Number(payload.total) : 0,
    task1: Number.isFinite(Number(byType.task1)) ? Number(byType.task1) : 0,
    task2: Number.isFinite(Number(byType.task2)) ? Number(byType.task2) : 0,
    lastUpdate: new Date().toLocaleString()
  }
}

async function loadTopicLibraryStats() {
  try {
    topicLibraryStats.value = normalizeTopicLibraryStats(await topics.getStatistics())
  } catch (error) {
    console.error('加载写作题库统计失败:', error)
    topicLibraryStats.value = {
      total: '未连接',
      task1: '未连接',
      task2: '未连接',
      lastUpdate: '等待本地服务'
    }
  }
}

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
    } else if (kind === 'restore-settings-backup') {
      const normalized = normalizeSettingsBackupEntry(payload?.backup)
      if (!normalized) {
        throw new Error('备份数据无效')
      }
      const result = await applySettingsImportPayload(normalized.archive)
      await loadApiConfigs()
      setGlobalMessage('success', `备份已恢复：${result.settingsCount} 项设置，${result.promptCount} 个提示词版本。`)
    }
    closeConfirmDialog()
  } catch (error) {
    console.error('确认操作失败:', error)
    closeConfirmDialog()
    const errorLabel = kind === 'delete-api-config'
      ? '删除 API 配置失败'
      : kind === 'delete-prompt'
        ? '删除提示词失败'
        : kind === 'restore-settings-backup'
          ? '恢复备份失败'
          : '清空失败'
    setSectionMessage(section, 'error', `${errorLabel}: ${error.message}`)
  }
}

function setGlobalMessage(type, message) {
  globalMessage.type = type
  globalMessage.message = String(message || '').trim()
}

function handleSettingsKeydown(event) {
  if (event?.key !== 'Escape') return
  if (themeSwitcherOpen.value) {
    hideThemeSwitcher()
  } else if (settingsDetailOpen.value) {
    hideSettingsDetail()
  }
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function clearAppCache() {
  const removablePrefixes = [
    'evaluation_',
    'writing_draft_',
    'practice_reading_answers_',
    'practice_reading_submission_'
  ]
  let removed = 0
  ;[window.sessionStorage, window.localStorage].forEach((store) => {
    if (!store) return
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index) || ''
      if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
        store.removeItem(key)
        removed += 1
      }
    }
  })
  setGlobalMessage('success', `缓存已清除：${removed} 项。`)
}

function switchBackgroundTheme() {
  themeSwitcherOpen.value = true
}

function hideThemeSwitcher() {
  themeSwitcherOpen.value = false
}

function applyBackgroundTheme(themeName) {
  const nextTheme = backgroundThemes.some((theme) => theme.value === themeName)
    ? themeName
    : 'misty-mountain'
  if (!switchLegacyBackgroundTheme(nextTheme)) {
    try {
      localStorage.setItem('three_bg_theme', nextTheme)
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('shui-bg-theme-change', { detail: { theme: nextTheme } }))
  }
  themeSwitcherOpen.value = false
  const label = backgroundThemes.find((theme) => theme.value === nextTheme)?.title || nextTheme
  setGlobalMessage('success', `主题已切换：${label}`)
}

async function startOnboardingTour(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await startLegacyOnboardingTour()
  } catch (error) {
    console.error('打开引导流程失败:', error)
    setGlobalMessage('error', error?.message ? `引导打开失败：${error.message}` : '引导打开失败，请稍后重试。')
  }
}

async function openUpdateManager(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  try {
    await openLegacyUpdateManager()
  } catch (error) {
    console.error('打开更新管理失败:', error)
    setGlobalMessage('error', error?.message ? `更新检查打开失败：${error.message}` : '更新检查打开失败，请稍后重试。')
  }
}

function openWritingTopicLibrary() {
  router.push({ name: 'TopicManage' })
}

function openSettingsDetail(tabKey = activeTab.value) {
  if (tabs.some((tab) => tab.key === tabKey)) {
    activeTab.value = tabKey
  }
  settingsDetailOpen.value = true
}

function hideSettingsDetail() {
  settingsDetailOpen.value = false
}

function openWritingLibraryConfig() {
  openSettingsDetail('prompts')
  setGlobalMessage('success', '已切换到写作提示词与题库相关配置。')
}

function refreshWritingLibrary() {
  try {
    sessionStorage.removeItem('writing_topics_cache')
    sessionStorage.removeItem('topic_bank_cache')
    sessionStorage.removeItem('compose_topics_cache')
  } catch (_) {}
  loadTopicLibraryStats()
  setGlobalMessage('success', '写作题库缓存已刷新；进入写作题库时会重新拉取。')
}

function normalizeSettingsBackupEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const archive = entry.archive && typeof entry.archive === 'object' ? entry.archive : null
  if (!archive) return null
  const createdAt = String(entry.createdAt || archive.exportedAt || '').trim() || new Date().toISOString()
  const id = String(entry.id || `writing-settings-${createdAt}`).trim()
  return {
    id,
    createdAt,
    archive,
    apiConfigCount: Number.isFinite(Number(entry.apiConfigCount))
      ? Number(entry.apiConfigCount)
      : Array.isArray(archive.apiConfigs)
        ? archive.apiConfigs.length
        : 0,
    promptCount: Number.isFinite(Number(entry.promptCount))
      ? Number(entry.promptCount)
      : Array.isArray(archive.prompts)
        ? archive.prompts.length
        : 0
  }
}

function readSettingsBackups() {
  try {
    const raw = window.localStorage?.getItem(WRITING_SETTINGS_BACKUP_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => normalizeSettingsBackupEntry(entry))
      .filter(Boolean)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, MAX_SETTINGS_BACKUPS)
  } catch (error) {
    console.warn('读取写作设置备份失败:', error)
    return []
  }
}

function persistSettingsBackups(backups) {
  const normalized = Array.isArray(backups)
    ? backups.map((entry) => normalizeSettingsBackupEntry(entry)).filter(Boolean)
    : []
  const nextBackups = normalized
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_SETTINGS_BACKUPS)
  settingsBackups.value = nextBackups
  try {
    window.localStorage?.setItem(WRITING_SETTINGS_BACKUP_STORAGE_KEY, JSON.stringify(nextBackups))
  } catch (error) {
    console.warn('保存写作设置备份索引失败:', error)
    setGlobalMessage('error', '备份已生成，但本机备份索引保存失败: ' + error.message)
  }
  return nextBackups
}

function formatSettingsBackupDate(backup) {
  const timestamp = new Date(backup?.createdAt || backup?.archive?.exportedAt || '')
  if (Number.isNaN(timestamp.getTime())) return '时间未知'
  return timestamp.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

async function collectSettingsExportPayload() {
  const allSettings = await settings.getAll()
  return {
    exportedAt: new Date().toISOString(),
    version: '0.3.1',
    settings: allSettings,
    apiConfigs: apiConfigs.value.map((item) => ({
      id: item.id,
      config_name: item.config_name,
      provider: item.provider,
      base_url: item.base_url,
      default_model: item.default_model,
      is_default: Boolean(item.is_default),
      is_enabled: Boolean(item.is_enabled)
    })),
    prompts: promptEntries.value
  }
}

async function applySettingsImportPayload(payload) {
  const importedSettings = payload?.settings && typeof payload.settings === 'object'
    ? payload.settings
    : payload
  const allowedKeys = ['temperature_mode', 'temperature_task1', 'temperature_task2', 'history_limit']
  const updates = {}
  allowedKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(importedSettings || {}, key)) {
      updates[key] = importedSettings[key]
    }
  })

  const promptPayload = Array.isArray(payload?.prompts)
    ? payload.prompts
    : null
  if (!Object.keys(updates).length && !promptPayload?.length) {
    throw new Error('文件不包含可导入的写作设置或提示词')
  }

  if (Object.keys(updates).length) {
    await settings.update(updates)
    await loadSettings()
  }
  if (promptPayload?.length) {
    await prompts.import(promptPayload)
    await loadPromptList()
  }

  return {
    settingsCount: Object.keys(updates).length,
    promptCount: promptPayload?.length || 0
  }
}

async function createSettingsBackup() {
  try {
    const archive = await collectSettingsExportPayload()
    const backup = normalizeSettingsBackupEntry({
      id: `writing-settings-${Date.now()}`,
      createdAt: archive.exportedAt || new Date().toISOString(),
      archive
    })
    persistSettingsBackups([backup, ...readSettingsBackups()])
    settingsBackupListOpen.value = true
    openSettingsDetail('data')
    downloadJsonFile(`ielts-writing-settings-backup-${Date.now()}.json`, archive)
    setGlobalMessage('success', '设置备份已创建并保存到本机列表。')
  } catch (error) {
    setGlobalMessage('error', '创建备份失败: ' + error.message)
  }
}

function showSettingsBackupList() {
  openSettingsDetail('data')
  settingsBackups.value = readSettingsBackups()
  settingsBackupListOpen.value = true
}

function downloadSettingsBackup(backup) {
  const normalized = normalizeSettingsBackupEntry(backup)
  if (!normalized) {
    setGlobalMessage('error', '备份数据无效，无法下载。')
    return
  }
  const safeId = normalized.id.replace(/[^a-zA-Z0-9._-]+/g, '-')
  downloadJsonFile(`${safeId}.json`, normalized.archive)
}

function restoreSettingsBackup(backup) {
  const normalized = normalizeSettingsBackupEntry(backup)
  if (!normalized) {
    setGlobalMessage('error', '备份数据无效，无法恢复。')
    return
  }
  openConfirmDialog({
    kind: 'restore-settings-backup',
    section: 'data',
    title: '恢复设置备份',
    message: `恢复备份 ${formatSettingsBackupDate(normalized)}？当前写作设置和提示词版本会被导入记录覆盖。`,
    confirmLabel: '确认恢复',
    danger: false,
    payload: { backup: normalized }
  })
}

function deleteSettingsBackup(id) {
  const normalizedId = String(id || '').trim()
  if (!normalizedId) return
  persistSettingsBackups(readSettingsBackups().filter((backup) => backup.id !== normalizedId))
  setGlobalMessage('success', '设置备份已删除。')
}

async function exportSettingsData() {
  try {
    downloadJsonFile('ielts-writing-settings-export.json', await collectSettingsExportPayload())
    setGlobalMessage('success', '设置数据已导出。')
  } catch (error) {
    setGlobalMessage('error', '导出数据失败: ' + error.message)
  }
}

function triggerSettingsImport() {
  settingsImportInput.value?.click()
}

async function handleSettingsImport(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  try {
    const raw = await file.text()
    const parsed = JSON.parse(raw)
    const result = await applySettingsImportPayload(parsed)
    setGlobalMessage('success', `设置数据已导入：${result.settingsCount} 项设置，${result.promptCount} 个提示词版本。`)
  } catch (error) {
    setGlobalMessage('error', '导入数据失败: ' + error.message)
  } finally {
    if (event?.target) {
      event.target.value = ''
    }
  }
}

// 初始化
onMounted(() => {
  loadSettings()
  getUserDataPath()
  loadTopicLibraryStats()
  loadApiConfigs()
  loadPromptList()
  settingsBackups.value = readSettingsBackups()
  document.addEventListener('keydown', handleSettingsKeydown)
})

onBeforeUnmount(() => {
  apiRequestGate.invalidate()
  promptRequestGate.invalidate()
  settingsRequestGate.invalidate()
  document.removeEventListener('keydown', handleSettingsKeydown)
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

/* Open-source settings shell parity */
.settings-page#settings-view {
  --shui-panel-bg: rgba(255, 255, 255, 0.58);
  --shui-panel-border: rgba(255, 255, 255, 0.7);
  --shui-panel-shadow: 0 24px 70px rgba(31, 41, 55, 0.12);
  --shui-surface-bg: rgba(255, 255, 255, 0.46);
  --shui-surface-border: rgba(255, 255, 255, 0.58);
  --shui-radius-xl: 28px;
  --shui-radius-lg: 20px;
  --shui-radius-md: 16px;
  --shui-blur: 32px;
  --bauhaus-text-main: #0f172a;
  --bauhaus-text-muted: #64748b;
  --bauhaus-accent-red: #dc2626;
  --bauhaus-accent-blue: #2563eb;
  --bauhaus-accent-dark: #334155;
  max-width: 1320px;
  margin: 20px auto 0;
  padding: clamp(28px, 4vw, 48px);
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-xl);
  background: var(--shui-panel-bg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur));
  -webkit-backdrop-filter: blur(var(--shui-blur));
  color: var(--bauhaus-text-main);
  animation: rise-in 0.45s var(--ease-smooth);
}

.settings-page#settings-view *,
.settings-page#settings-view *::before,
.settings-page#settings-view *::after {
  letter-spacing: 0;
}

.settings-page#settings-view > .hero-panel__header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.settings-page#settings-view > .hero-panel__header .hero-panel__title {
  margin: 0;
  color: var(--bauhaus-text-main);
  font-size: 1.45rem;
  font-weight: 600;
}

.settings-page#settings-view .hero-settings-group {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.settings-page#settings-view .hero-settings-group > .hero-panel {
  position: relative;
  overflow: hidden;
  min-height: 0;
  padding: 32px;
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-lg);
  background: var(--shui-panel-bg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  transition:
    transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
    box-shadow 0.3s ease,
    border-color 0.3s ease;
}

.settings-page#settings-view .hero-settings-group > .hero-panel:hover {
  transform: translateY(-4px);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow:
    0 30px 60px rgba(0, 0, 0, 0.12),
    inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}

.settings-page#settings-view .hero-settings-group > .hero-panel::before,
.settings-page#settings-view .settings-detail-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.settings-page#settings-view .hero-settings-group > .hero-panel > *,
.settings-page#settings-view .settings-detail-panel > * {
  position: relative;
  z-index: 1;
}

.settings-page#settings-view h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 0.5rem;
  color: var(--bauhaus-text-main);
  font-size: 1.25rem;
  font-weight: 700;
}

.settings-page#settings-view .hero-panel__muted {
  margin: 0 0 24px;
  color: var(--bauhaus-text-muted);
  font-size: 0.9rem;
}

.settings-page#settings-view .hero-settings-actions {
  display: flex;
  flex-flow: row wrap;
  gap: 10px;
  margin-top: 8px;
}

.settings-page#settings-view .hero-settings-actions .btn {
  flex: 1 1 calc(50% - 5px);
  min-width: 124px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
}

.settings-page#settings-view .btn {
  position: relative;
  z-index: 1;
  overflow: hidden;
  padding: 9px 14px;
  border: none;
  border-radius: 999px;
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.settings-page#settings-view .btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), transparent);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.settings-page#settings-view .btn:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15);
}

.settings-page#settings-view .btn:hover::after {
  opacity: 1;
}

.settings-page#settings-view #clear-cache-btn {
  color: var(--bauhaus-accent-red);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(220, 38, 38, 0.2);
}

.settings-page#settings-view #clear-cache-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-red);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(220, 38, 38, 0.3);
}

.settings-page#settings-view #load-library-btn,
.settings-page#settings-view #library-config-btn,
.settings-page#settings-view #force-refresh-btn,
.settings-page#settings-view #theme-switcher-btn-entry,
.settings-page#settings-view #show-onboarding-btn,
.settings-page#settings-view #check-updates-btn {
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.settings-page#settings-view #load-library-btn:hover,
.settings-page#settings-view #library-config-btn:hover,
.settings-page#settings-view #force-refresh-btn:hover,
.settings-page#settings-view #theme-switcher-btn-entry:hover,
.settings-page#settings-view #show-onboarding-btn:hover,
.settings-page#settings-view #check-updates-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-blue);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(37, 99, 235, 0.3);
}

.settings-page#settings-view .data-mgmt-btn {
  color: var(--bauhaus-accent-dark);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(15, 23, 42, 0.15);
}

.settings-page#settings-view .data-mgmt-btn:hover {
  color: #fff;
  background: var(--bauhaus-accent-dark);
  border-color: transparent;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.25);
}

.settings-page#settings-view .settings-system-info,
.settings-page#settings-view .system-info-surface {
  display: grid;
  gap: 6px;
  margin-top: 15px;
  padding: 18px;
  border: 1px solid var(--shui-surface-border);
  border-radius: var(--shui-radius-md);
  background: var(--shui-surface-bg);
  color: var(--bauhaus-text-main);
  font-weight: 700;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.settings-page#settings-view .settings-system-info__status,
.settings-page#settings-view .system-info-status {
  color: #10b981;
}

.settings-page#settings-view .settings-credit {
  display: grid;
  gap: 12px;
  margin-top: 30px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  text-align: center;
}

.settings-page#settings-view .settings-credit a {
  color: gray;
  font-size: 0.9em;
  font-weight: 700;
  text-decoration: none;
  transition: opacity 0.2s ease, color 0.2s ease;
}

.settings-page#settings-view .settings-credit .inline-hover-link {
  color: #ff1c1c;
}

.settings-page#settings-view .settings-credit a:hover {
  opacity: 0.72;
}

.settings-page#settings-view .settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.settings-page#settings-view .theme-modal {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.65);
  opacity: 0;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: opacity 0.3s ease;
}

.settings-page#settings-view .theme-modal.show {
  display: flex;
  opacity: 1;
}

.settings-page#settings-view .theme-modal-content {
  width: min(900px, 92vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  transform: scale(0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.settings-page#settings-view .theme-modal.show .theme-modal-content {
  transform: scale(1);
}

.settings-page#settings-view .theme-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 32px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.settings-page#settings-view .theme-modal-header h3 {
  margin: 0;
  color: var(--bauhaus-text-main);
  font-size: 1.75rem;
  font-weight: 800;
}

.settings-page#settings-view .theme-modal-close {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.06);
  color: #64748b;
  cursor: pointer;
  font-size: 20px;
  transition:
    transform 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.settings-page#settings-view .theme-modal-close:hover {
  color: #0f172a;
  background: rgba(15, 23, 42, 0.12);
  transform: rotate(90deg);
}

.settings-page#settings-view .theme-modal-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-page#settings-view .theme-options-viewport {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

.settings-page#settings-view .theme-options-glass {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 24px;
}

.settings-page#settings-view .theme-card {
  min-height: 260px;
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.48);
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.16);
  isolation: isolate;
}

.settings-page#settings-view .theme-card-bg {
  position: absolute;
  inset: 0;
  z-index: -2;
}

.settings-page#settings-view .theme-bg-misty {
  background:
    linear-gradient(160deg, rgba(14, 165, 233, 0.38), rgba(148, 163, 184, 0.22)),
    radial-gradient(circle at 24% 28%, rgba(255, 255, 255, 0.72), transparent 38%),
    linear-gradient(135deg, #dbeafe 0%, #e0f2fe 44%, #94a3b8 100%);
}

.settings-page#settings-view .theme-bg-ocean {
  background:
    linear-gradient(150deg, rgba(15, 118, 110, 0.72), rgba(8, 47, 73, 0.82)),
    radial-gradient(circle at 70% 30%, rgba(153, 246, 228, 0.42), transparent 36%),
    linear-gradient(135deg, #0f766e 0%, #155e75 100%);
}

.settings-page#settings-view .theme-bg-floral {
  background:
    linear-gradient(145deg, rgba(251, 207, 232, 0.76), rgba(254, 240, 138, 0.48)),
    radial-gradient(circle at 30% 30%, rgba(244, 114, 182, 0.44), transparent 34%),
    linear-gradient(135deg, #fdf2f8 0%, #fed7aa 100%);
}

.settings-page#settings-view .theme-card-glass-layer {
  height: 100%;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.08));
  color: #0f172a;
  backdrop-filter: blur(8px) saturate(140%);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
}

.settings-page#settings-view .theme-card-title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
}

.settings-page#settings-view .theme-card-subtitle {
  margin-top: 6px;
  color: rgba(15, 23, 42, 0.7);
  font-size: 0.9rem;
  font-weight: 700;
}

.settings-page#settings-view .theme-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.settings-page#settings-view .theme-card-tag {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  border-radius: 999px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.42);
  color: rgba(15, 23, 42, 0.76);
  font-size: 0.78rem;
  font-weight: 800;
}

.settings-page#settings-view .theme-card-btn {
  min-width: 76px;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.82);
  color: #fff;
  cursor: pointer;
  font-weight: 800;
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.22);
  transition:
    transform 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.settings-page#settings-view .theme-card-btn:hover {
  background: rgba(15, 23, 42, 0.94);
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.26);
  transform: translateY(-2px);
}

.settings-page#settings-view .settings-detail-modal {
  position: fixed;
  inset: 0;
  z-index: 1900;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.52);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.settings-page#settings-view .settings-detail-panel {
  position: relative;
  width: min(1120px, 94vw);
  max-height: 88vh;
  display: grid;
  gap: 16px;
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--shui-panel-border);
  border-radius: var(--shui-radius-lg);
  background: var(--shui-panel-bg);
  box-shadow: var(--shui-panel-shadow);
  backdrop-filter: blur(var(--shui-blur)) saturate(150%);
  -webkit-backdrop-filter: blur(var(--shui-blur)) saturate(150%);
}

.settings-page#settings-view .settings-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.42);
}

.settings-page#settings-view .settings-detail-head h3 {
  margin-bottom: 4px;
}

.settings-page#settings-view .settings-detail-head p {
  margin: 0;
  color: var(--bauhaus-text-muted);
}

.settings-page#settings-view .settings-detail-eyebrow {
  margin: 0 0 4px;
  color: var(--bauhaus-accent-blue);
  font-size: 0.76rem;
  font-weight: 800;
  text-transform: uppercase;
}

.settings-page#settings-view .settings-detail-close {
  width: 36px;
  height: 36px;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: #64748b;
  background: rgba(15, 23, 42, 0.06);
  cursor: pointer;
  font-size: 20px;
  transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.settings-page#settings-view .settings-detail-close:hover {
  color: #0f172a;
  background: rgba(15, 23, 42, 0.12);
  transform: rotate(90deg);
}

.settings-page#settings-view .settings-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.42);
}

.settings-page#settings-view .settings-tab {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 999px;
  color: var(--bauhaus-text-main);
  background: rgba(255, 255, 255, 0.52);
  cursor: pointer;
}

.settings-page#settings-view .settings-tab:hover,
.settings-page#settings-view .settings-tab.active {
  color: #fff;
  border-color: transparent;
  background: var(--bauhaus-accent-blue);
}

.settings-page#settings-view .settings-tab__icon {
  display: inline-flex;
  font-size: 15px;
}

@media (max-width: 1080px) {
  .settings-page#settings-view .hero-settings-group {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .settings-page#settings-view {
    padding: 20px;
  }

  .settings-page#settings-view > .hero-panel__header {
    align-items: stretch;
    flex-direction: column;
  }

  .settings-page#settings-view .hero-settings-actions .btn,
  .settings-page#settings-view .settings-tabs,
  .settings-page#settings-view .settings-tab {
    width: 100%;
  }
}
</style>
