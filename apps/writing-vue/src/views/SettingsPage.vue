<template>
  <div id="settings-view" class="settings-page view active" data-writing-settings>
    <div class="hero-panel__header">
      <h2 class="hero-panel__title heading-serif">系统设置</h2>
    </div>

    <div class="hero-settings-group" aria-label="设置主面板">
      <section class="hero-panel hero-section ai-settings-panel">
        <h3 class="heading-serif">AI 与评测</h3>
        <p class="hero-panel__muted">配置模型、提示词与温度。API Key 保存在系统密钥环，不会进入普通备份。</p>
        <div class="hero-settings-actions">
          <button class="btn btn-brand hero-btn" type="button" data-settings-open="api" @click="openSettingsDetail('api')">
            API 配置
          </button>
          <button class="btn hero-btn" type="button" data-settings-open="prompts" @click="openSettingsDetail('prompts')">
            提示词
          </button>
          <button class="btn hero-btn" type="button" data-settings-open="model" @click="openSettingsDetail('model')">
            模型参数
          </button>
          <button class="btn hero-btn" type="button" data-settings-open="about" @click="openSettingsDetail('about')">
            关于
          </button>
        </div>
        <div class="settings-stat-row">
          <span class="settings-badge">{{ enabledConfigCount }} 个已启用</span>
          <span class="settings-badge settings-badge--muted">共 {{ totalConfigCount }} 个配置</span>
          <span class="settings-badge settings-badge--muted">{{ promptEntries.length }} 个提示词版本</span>
        </div>
      </section>

      <section class="hero-panel hero-section data-management-panel">
        <h3 class="heading-serif">本机数据备份</h3>
        <p class="hero-panel__muted">
          完整备份由 Rust 写入应用 backups 目录，包含练习记录与设置元数据；不含明文 API Key。
        </p>
        <div class="hero-settings-actions">
          <button class="btn btn-brand hero-btn data-mgmt-btn" id="create-backup-btn" type="button" :disabled="backupBusy" @click="createFullAppBackup">
            {{ backupBusy ? '处理中…' : '备份全部数据' }}
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="restore-backup-btn" type="button" :disabled="backupBusy" @click="restoreFullAppBackup">
            从备份恢复…
          </button>
          <button class="btn hero-btn data-mgmt-btn" id="backup-list-btn" type="button" :disabled="backupBusy" @click="showNativeBackupList">
            备份列表
          </button>
        </div>
        <div v-if="lastBackupPath" class="settings-backup-result hero-surface" role="status">
          <div class="settings-backup-result__label">最近完整备份已写入</div>
          <div class="settings-backup-result__path settings-path-clip">{{ lastBackupPath }}</div>
          <p v-if="backupsPath" class="settings-backup-result__hint hero-panel__muted">备份目录：{{ backupsPath }}</p>
        </div>
        <p v-else-if="backupsPath" class="hero-panel__muted settings-backup-path">备份目录：{{ backupsPath }}</p>
      </section>

      <section class="hero-panel hero-section system-management-panel">
        <h3 class="heading-serif">系统与外观</h3>
        <p class="hero-panel__muted">统一 Liquid Glass 视觉、写作题库入口、引导与原生更新工具。</p>
        <div class="hero-settings-actions">
          <button class="btn btn-warning hero-btn hero-btn--warn" id="load-library-btn" type="button" @click="openWritingTopicLibrary">
            打开写作题库
          </button>
          <p class="visual-system-note" role="status">Liquid Glass 视觉已统一</p>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="show-onboarding-btn" type="button" @click="startOnboardingTour">
            显示引导
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="library-config-btn" type="button" data-action="library-config" @click="openWritingLibraryConfig">
            提示词设置
          </button>
          <button class="btn btn-warning hero-btn hero-btn--warn" id="check-updates-btn" type="button" data-update-action="open-modal" @click="openUpdateManager">
            检查更新
          </button>
          <button class="btn hero-btn" type="button" @click="openSettingsDetail('data')">
            历史保留上限
          </button>
        </div>
      </section>

      <section class="hero-panel hero-section system-info-panel">
        <h3 class="heading-serif">系统信息</h3>
        <div class="hero-surface settings-system-info system-info-surface">
          <div class="settings-system-info__status system-info-status">{{ topicLibraryStatus }}</div>
          <div class="settings-system-metrics">
            <div><span>题目总数</span><strong id="total-exams">{{ topicLibraryStats.total }}</strong></div>
            <div><span>Task 1</span><strong id="html-exams">{{ topicLibraryStats.task1 }}</strong></div>
            <div><span>Task 2</span><strong id="pdf-exams">{{ topicLibraryStats.task2 }}</strong></div>
          </div>
          <p class="hero-panel__muted">最近更新：<span id="last-update">{{ topicLibraryStats.lastUpdate }}</span></p>
          <details class="settings-technical-details">
            <summary>技术详情</summary>
            <dl>
              <div><dt>桌面宿主</dt><dd>{{ hostName }}</dd></div>
              <div><dt>Tauri 版本</dt><dd>{{ tauriVersion }}</dd></div>
              <div><dt>数据目录</dt><dd class="settings-path-clip">{{ userDataPath || pathsLoadingLabel }}</dd></div>
              <div><dt>备份目录</dt><dd class="settings-path-clip">{{ backupsPath || (pathsResolved ? '未获取' : '加载中...') }}</dd></div>
            </dl>
          </details>
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
              <p>默认配置必须启用且本机可读取 API Key。完整备份只恢复引用：同一设备且本机凭据记录仍在时可复用，换设备必须重新填写 Key。</p>
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
                  <span v-if="!item.has_secret" class="settings-badge settings-badge--muted">需重新填写 Key</span>
                </div>
                <div class="settings-list__meta">
                  <span>{{ item.provider }}</span>
                  <span>{{ item.default_model }}</span>
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn-text" type="button" @click="editConfig(item)">编辑</button>
                <button
                  class="btn-text"
                  type="button"
                  :disabled="testingConfigId === item.id || !item.has_secret"
                  :title="item.has_secret ? '' : '此设备没有该配置的 API Key，请先编辑并重新填写'"
                  @click="testConfig(item.id)"
                >
                    {{ testingConfigId === item.id ? '测试中' : '测试' }}
                </button>
                <button
                    class="btn-text"
                    type="button"
                    :disabled="item.is_default || !item.is_enabled || !item.has_secret"
                    :title="item.is_default ? '当前已是默认配置' : (!item.is_enabled ? '禁用配置不能设为默认' : (!item.has_secret ? '请先在此设备重新填写 API Key' : ''))"
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
              <p>{{ apiForm.id ? (editingConfigNeedsKey ? '该配置来自备份，但此设备无法读取 API Key；请重新填写后保存。' : 'API Key 留空时保持原值。') : '新建配置必须填写 API Key。' }}</p>
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
              <p>由本机 SQLite 在写入终态练习时执行的历史保留策略；草稿、进行中和评测中的记录不会被清理。</p>
            </div>
            <span class="settings-badge">{{ historyRetentionLabel }}</span>
          </div>
          <div v-if="sectionMessages.data.message" :class="['inline-message', `inline-message-${sectionMessages.data.type}`]">
            {{ sectionMessages.data.message }}
          </div>
          
          <div class="setting-control">
              <div class="setting-control__copy">
                <strong>自动保留最近记录数量</strong>
                <span>仅终态记录（完成、取消、失败或中断）会按完成时间裁剪；不限时不自动清理。</span>
              </div>
            <label class="setting-control__input">
              <input v-model="dataSettings.unlimited" type="checkbox" />
              <span>不限</span>
            </label>
            <label v-if="!dataSettings.unlimited" class="setting-control__input">
              <input
                type="number"
                v-model.number="dataSettings.max_terminal_attempts"
                min="50"
                max="500"
                step="50"
              />
              <span>条</span>
            </label>
          </div>
          <div class="settings-savebar">
            <span>{{ dataSettings.unlimited ? '不限：不自动清理历史。' : '允许范围 50-500，按 50 递增。' }}</span>
            <button class="btn btn-brand" type="button" @click="saveDataSettings" :disabled="dataSaving">
              {{ dataSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </section>

        <section v-if="activeTab === 'data' && settingsBackupListOpen" class="settings-panel" data-writing-settings-backup-list>
          <div class="settings-panel__head">
            <div>
              <h3>应用备份文件</h3>
              <p>来自 backups 目录的完整备份。恢复为合并写入；密钥引用仅为元数据，不含明文 API Key。</p>
            </div>
            <span class="settings-badge">{{ nativeBackups.length }} 个文件</span>
          </div>
          <div v-if="!nativeBackups.length" class="settings-empty">暂无完整备份文件。可先点「备份全部数据」。</div>
          <div v-else class="settings-list">
            <div v-for="backup in nativeBackups" :key="backup.grantId" class="settings-list__row">
              <div class="settings-list__main">
                <div class="settings-list__title">
                  <strong>{{ backup.name }}</strong>
                  <span class="settings-badge settings-badge--muted">{{ formatNativeBackupDate(backup) }}</span>
                </div>
                <div class="settings-list__meta">
                  <span>{{ formatBytes(backup.sizeBytes || backup.size_bytes || 0) }}</span>
                  <span class="settings-path-clip">{{ backup.displayPath }}</span>
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn-text" type="button" :disabled="backupBusy" @click="restoreNativeBackupFile(backup)">恢复</button>
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
              <svg
                class="app-icon__image"
                viewBox="0 0 72 72"
                role="img"
                aria-label="IELTS Practice"
              >
                <rect x="4" y="4" width="64" height="64" rx="18" fill="var(--atlas-accent)" />
                <path d="M22 20h8v32h-8zM35 52l10-32h7l10 32h-8l-2-7H43l-2 7zm10-14h5l-2.5-9z" fill="var(--anth-accent-contrast)" />
              </svg>
            </div>
            <div>
              <h2 class="heading-serif">IELTS Practice</h2>
              <p class="version">版本 {{ appVersion }}</p>
            </div>
          </div>
          
          <div class="about-info">
            <div class="info-row">
              <span class="label">应用形态</span>
              <span class="value">Tauri 2 原生桌面客户端</span>
            </div>
            <div class="info-row">
              <span class="label">业务与数据内核</span>
              <span class="value">Rust + SQLite</span>
            </div>
            <div class="info-row">
              <span class="label">桌面宿主</span>
              <span class="value">{{ hostName }}</span>
            </div>
            <div class="info-row">
              <span class="label">Tauri版本</span>
              <span class="value">{{ tauriVersion }}</span>
            </div>
            <div class="info-row">
              <span class="label">数据目录</span>
              <span class="value">{{ userDataPath || pathsLoadingLabel }}</span>
            </div>
            <div v-if="backupsPath || pathsResolved" class="info-row">
              <span class="label">备份目录</span>
              <span class="value">{{ backupsPath || '未获取' }}</span>
            </div>
          </div>

          <div class="about-features">
            <h3>产品能力</h3>
            <ul>
              <li><span>写作</span>题库与自由写作、草稿恢复、AI 评测</li>
              <li><span>阅读</span>套题、无尽模式、作答与复盘</li>
              <li><span>数据</span>Rust/SQLite 统一保存练习、设置与历史</li>
              <li><span>安全</span>API Key 存于系统密钥环，不进入普通备份</li>
              <li><span>备份</span>原生完整备份、校验和文件恢复</li>
              <li><span>更新</span>发布配置可启用 Tauri 原生更新检查</li>
            </ul>
          </div>
        </section>
      </section>
    </div>

    <div v-if="onboardingOpen" class="dialog-overlay" role="dialog" aria-modal="true" @click.self="onboardingOpen = false">
      <div class="dialog card onboarding-dialog">
        <p class="settings-detail-eyebrow">快速引导 {{ onboardingStep + 1 }} / {{ onboardingSteps.length }}</p>
        <h3>{{ onboardingSteps[onboardingStep].title }}</h3>
        <p>{{ onboardingSteps[onboardingStep].body }}</p>
        <div class="dialog-actions">
          <button class="btn btn-warm-sand" type="button" :disabled="onboardingStep === 0" @click="onboardingStep -= 1">上一步</button>
          <button class="btn btn-brand" type="button" @click="advanceOnboarding">
            {{ onboardingStep === onboardingSteps.length - 1 ? '完成' : '下一步' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="updateDialogOpen" class="dialog-overlay" role="dialog" aria-modal="true" @click.self="closeUpdateDialog">
      <div class="dialog card">
        <h3>应用更新</h3>
        <p aria-live="polite">{{ updateStatus.message }}</p>
        <p>当前版本：{{ updateStatus.currentVersion || appVersion }}</p>
        <p v-if="updateStatus.latestVersion">最新版本：{{ updateStatus.latestVersion }}</p>
        <p v-if="updateStatus.body">{{ updateStatus.body }}</p>
        <progress
          v-if="updateInstalling"
          class="update-progress"
          :value="updateProgressPercent ?? undefined"
          :max="updateProgressPercent == null ? undefined : 100"
          aria-label="更新下载进度"
        />
        <p v-if="updateInstalling && updateProgressPercent != null">{{ updateProgressPercent }}%</p>
        <div class="dialog-actions">
          <button class="btn btn-warm-sand" type="button" :disabled="updateInstalling || updateRestarting" @click="closeUpdateDialog">关闭</button>
          <button class="btn btn-brand" type="button" :disabled="updateChecking || updateInstalling || updateRestarting" @click="checkUpdates">
            {{ updateChecking ? '检查中...' : '重新检查' }}
          </button>
          <button
            v-if="updateStatus.updateAvailable && !updateStatus.requiresRestart"
            class="btn btn-brand"
            type="button"
            :disabled="updateChecking || updateInstalling"
            @click="installAvailableUpdate"
          >
            {{ updateInstalling ? '安装中...' : '下载并安装' }}
          </button>
          <button
            v-if="updateStatus.requiresRestart"
            class="btn btn-brand"
            type="button"
            :disabled="updateRestarting"
            @click="restartAfterUpdate"
          >
            {{ updateRestarting ? '正在重启...' : '重启完成更新' }}
          </button>
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
import { Channel } from '@tauri-apps/api/core'
import { settings, essays, configs, prompts, topics } from '@/api/client.js'
import {
  getHistoryRetentionPolicy,
  setHistoryRetentionPolicy,
  createBackup,
  listBackups,
  pickBackupImportPath,
  importBackupPath
} from '@/api/settings-repository.js'
import { invokeCommand } from '@/api/tauri-bridge.js'
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
    summary: '历史上限与原生备份',
    kicker: 'Storage',
    title: '数据管理',
    description: '控制历史记录保留策略，并通过 Rust 管理完整应用备份。',
    icon: icons.data
  },
  {
    key: 'about',
    label: '关于',
    summary: '版本、运行环境、能力',
    kicker: '关于',
    title: '关于产品',
    description: '查看 Tauri 桌面客户端、Rust 数据内核和本机数据路径。',
    icon: icons.about
  }
]

const router = useRouter()
const activeTab = ref('model')
const settingsDetailOpen = ref(false)
const modelSaving = ref(false)
const dataSaving = ref(false)
const apiLoading = ref(false)
const promptLoading = ref(false)
const settingsBackupListOpen = ref(false)
const onboardingOpen = ref(false)
const onboardingStep = ref(0)
const updateDialogOpen = ref(false)
const updateChecking = ref(false)
const updateInstalling = ref(false)
const updateRestarting = ref(false)
const updateProgress = reactive({ downloadedBytes: 0, contentLength: null, stage: 'idle' })
const updateProgressPercent = computed(() => {
  if (!updateProgress.contentLength) return null
  return Math.min(100, Math.round((updateProgress.downloadedBytes / updateProgress.contentLength) * 100))
})
const updateStatus = reactive({
  configured: false,
  updateAvailable: false,
  installed: false,
  requiresRestart: false,
  currentVersion: '',
  latestVersion: null,
  body: null,
  stage: 'idle',
  message: '尚未检查更新。'
})
const onboardingSteps = [
  { title: '选择练习', body: '从阅读或写作题库开始练习，进度统一保存在本机 SQLite。' },
  { title: '配置 AI', body: '在 API 配置中添加供应商密钥；密钥由系统安全存储保管。' },
  { title: '查看结果', body: '提交后在历史记录中查看评分、反馈和练习恢复状态。' }
]
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

// 设置数据
const modelSettings = ref({
  temperature_mode: 'balanced',
  temperature_task1: 0.3,
  temperature_task2: 0.5
})

const dataSettings = ref({
  max_terminal_attempts: 100,
  unlimited: false
})
const persistedHistoryRetention = ref(null)

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

// 关于页面数据（Tauri host）
const hostName = ref('Tauri')
const tauriVersion = ref('N/A')
const appVersion = ref('N/A')
const userDataPath = ref('')
const backupsPath = ref('')
const pathsResolved = ref(false)
const backupBusy = ref(false)
const lastBackupPath = ref('')
const nativeBackups = ref([])
const pathsLoadingLabel = computed(() => (pathsResolved.value ? '未获取' : '加载中...'))

async function loadTauriAboutInfo() {
  try {
    const info = await invokeCommand('get_app_info')
    hostName.value = info?.host || 'tauri'
    tauriVersion.value = info?.tauriVersion || info?.tauri_version || 'N/A'
    appVersion.value = info?.version || 'N/A'
    const paths = await invokeCommand('get_app_data_paths')
    userDataPath.value = paths?.appData || paths?.app_data || ''
    backupsPath.value = paths?.backups || ''
  } catch (error) {
    hostName.value = 'tauri'
    tauriVersion.value = 'N/A'
    userDataPath.value = '无法获取（需 Tauri 运行时）'
    backupsPath.value = ''
  } finally {
    pathsResolved.value = true
  }
}

async function getUserDataPath() {
  await loadTauriAboutInfo()
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

// Returns false only when the reload actually failed. A superseded request is
// not a failure — a newer load is already in flight and owns the state.
//
// Callers that just performed a mutation MUST gate their success message on
// this. It swallows its own error by design (it sets the section message
// itself), so an unconditional 'saved' after it painted a green banner over a
// red one and left the user looking at a stale or empty list.
async function loadApiConfigs() {
  const requestId = apiRequestGate.begin()
  apiLoading.value = true
  clearSectionMessage('api')
  try {
    const nextConfigs = await configs.list()
    if (!apiRequestGate.isCurrent(requestId)) return true
    apiConfigs.value = nextConfigs
    return true
  } catch (error) {
    if (!apiRequestGate.isCurrent(requestId)) return true
    console.error('加载 API 配置失败:', error)
    setSectionMessage('api', 'error', '加载 API 配置失败: ' + error.message)
    return false
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

const editingConfigNeedsKey = computed(() => {
  const id = apiForm.value.id
  if (!id) return false
  return apiConfigs.value.find((item) => item.id === id)?.has_secret === false
})

const activePromptCount = computed(() => (
  promptEntries.value.filter((item) => item.is_active).length
))

const historyRetentionLabel = computed(() => {
  const policy = persistedHistoryRetention.value
  if (!policy) return '未读取'
  return policy.maxTerminalAttempts == null
    ? '不限'
    : `${policy.maxTerminalAttempts} 条`
})

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
      if (editingConfigNeedsKey.value && !payload.api_key) {
        setSectionMessage('api', 'error', '该配置在此设备没有可用 API Key，请重新填写后保存')
        return
      }
      await configs.update(apiForm.value.id, payload)
    } else {
      if (!payload.api_key) {
        setSectionMessage('api', 'error', '新建配置必须填写 API Key')
        return
      }
      await configs.create(payload)
    }

    resetApiForm()
    if (await loadApiConfigs()) {
      setSectionMessage('api', 'success', 'API 配置已保存')
    } else {
      setSectionMessage('api', 'error', '配置已写入，但重新读取列表失败，请刷新后确认')
    }
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
    if (await loadApiConfigs()) {
      setSectionMessage('api', 'success', '默认配置已更新')
    } else {
      setSectionMessage('api', 'error', '默认配置已更新，但重新读取列表失败，请刷新后确认')
    }
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
    if (await loadApiConfigs()) {
      setSectionMessage('api', 'success', target.is_enabled ? '配置已禁用' : '配置已启用')
    } else {
      setSectionMessage('api', 'error', '状态已切换，但重新读取列表失败，请刷新后确认')
    }
  } catch (error) {
    console.error('切换启用状态失败:', error)
    setSectionMessage('api', 'error', '切换状态失败: ' + error.message)
  }
}

async function testConfig(id) {
  const target = apiConfigs.value.find((item) => item.id === id)
  if (!target) {
    setSectionMessage('api', 'error', '要测试的 API 配置不存在')
    return
  }
  if (!target.has_secret) {
    editConfig(target)
    setSectionMessage('api', 'error', '该配置在此设备没有可用 API Key，请重新填写后再测试')
    return
  }
  testingConfigId.value = id
  clearSectionMessage('api')
  try {
    const result = await configs.test(id)
    setSectionMessage('api', 'success', `连接成功，延迟 ${result.latencyMs ?? result.latency_ms ?? 0}ms`)
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
  } catch (error) {
    if (!settingsRequestGate.isCurrent(requestId)) return
    console.error('加载设置失败:', error)
    setSectionMessage('model', 'error', '加载设置失败: ' + error.message)
  }
  await loadHistoryRetentionPolicy()
}

function normalizeHistoryRetentionPolicy(policy) {
  const hasCamel = Object.prototype.hasOwnProperty.call(policy || {}, 'maxTerminalAttempts')
  const hasSnake = Object.prototype.hasOwnProperty.call(policy || {}, 'max_terminal_attempts')
  if (!hasCamel && !hasSnake) {
    throw new Error('历史保留策略响应缺少 maxTerminalAttempts')
  }
  const raw = hasCamel ? policy.maxTerminalAttempts : policy.max_terminal_attempts
  if (raw === null || raw === undefined) return null
  const value = Number(raw)
  if (!Number.isInteger(value)) {
    throw new Error('历史保留策略返回了无效上限')
  }
  return value
}

function applyHistoryRetentionPolicy(policy) {
  const maxTerminalAttempts = normalizeHistoryRetentionPolicy(policy)
  persistedHistoryRetention.value = { maxTerminalAttempts }
  dataSettings.value = {
    max_terminal_attempts: maxTerminalAttempts ?? 100,
    unlimited: maxTerminalAttempts === null
  }
}

async function loadHistoryRetentionPolicy() {
  try {
    const policy = await getHistoryRetentionPolicy()
    applyHistoryRetentionPolicy(policy)
  } catch (error) {
    persistedHistoryRetention.value = null
    setSectionMessage('data', 'error', '历史保留策略加载失败: ' + error.message)
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
  const unlimited = dataSettings.value.unlimited === true
  const limit = unlimited ? null : Number(dataSettings.value.max_terminal_attempts)
  if (!unlimited && (!Number.isInteger(limit) || limit < 50 || limit > 500 || limit % 50 !== 0)) {
    setSectionMessage('data', 'error', '记录保留数量必须是 50-500 之间、且按 50 递增的整数')
    return
  }

  dataSaving.value = true
  clearSectionMessage('data')
  try {
    const result = await setHistoryRetentionPolicy(limit)
    applyHistoryRetentionPolicy(result.policy)
    const pruned = Number(result.prunedAttemptCount ?? result.pruned_attempt_count ?? 0)
    const actualLimit = persistedHistoryRetention.value?.maxTerminalAttempts ?? null
    const policyLabel = actualLimit === null
      ? '已改为不限，不会自动清理历史'
      : `已保留最近 ${actualLimit} 条终态记录`
    setSectionMessage('data', 'success', pruned > 0 ? `${policyLabel}；已清理 ${pruned} 条旧记录` : policyLabel)
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
    title: '清空所有历史记录',
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
    } else if (kind === 'restore-full-backup') {
      const grantId = String(payload?.grantId || '').trim()
      if (!grantId) throw new Error('缺少备份文件授权')
      await applyFullBackupRestore(grantId)
    }
    closeConfirmDialog()
  } catch (error) {
    console.error('确认操作失败:', error)
    closeConfirmDialog()
    const errorLabel = kind === 'delete-api-config'
      ? '删除 API 配置失败'
      : kind === 'delete-prompt'
        ? '删除提示词失败'
        : kind === 'restore-full-backup'
          ? '恢复完整备份失败'
          : '清空失败'
    setSectionMessage(section, 'error', `${errorLabel}: ${error.message}`)
  }
}

function setGlobalMessage(type, message) {
  globalMessage.type = type
  globalMessage.message = String(message || '').trim()
}

function handleSettingsKeydown(event) {
  if (event?.key === 'Escape' && settingsDetailOpen.value) hideSettingsDetail()
}

async function startOnboardingTour(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  onboardingStep.value = 0
  onboardingOpen.value = true
}

function advanceOnboarding() {
  if (onboardingStep.value < onboardingSteps.length - 1) {
    onboardingStep.value += 1
    return
  }
  onboardingOpen.value = false
}

async function openUpdateManager(event) {
  event?.preventDefault?.()
  event?.stopImmediatePropagation?.()
  updateDialogOpen.value = true
  await checkUpdates()
}

async function checkUpdates() {
  updateChecking.value = true
  try {
    Object.assign(updateStatus, await invokeCommand('check_for_updates'))
  } catch (error) {
    updateStatus.message = `更新检查失败：${error?.message || error}`
  } finally {
    updateChecking.value = false
  }
}

function closeUpdateDialog() {
  if (updateInstalling.value || updateRestarting.value) return
  updateDialogOpen.value = false
}

async function installAvailableUpdate() {
  updateInstalling.value = true
  updateProgress.downloadedBytes = 0
  updateProgress.contentLength = null
  updateProgress.stage = 'checking'
  const onEvent = new Channel()
  onEvent.onmessage = (event) => {
    updateProgress.downloadedBytes = Number(event?.downloadedBytes || 0)
    updateProgress.contentLength = event?.contentLength == null ? null : Number(event.contentLength)
    updateProgress.stage = String(event?.stage || 'downloading')
    if (event?.message) updateStatus.message = event.message
  }
  try {
    Object.assign(updateStatus, await invokeCommand('install_update', { onEvent }))
  } catch (error) {
    updateStatus.stage = 'failed'
    updateStatus.message = `更新安装失败，当前版本保持不变：${error?.message || error}`
  } finally {
    updateInstalling.value = false
  }
}

async function restartAfterUpdate() {
  updateRestarting.value = true
  try {
    await invokeCommand('restart_after_update')
  } catch (error) {
    updateStatus.message = `重启失败：${error?.message || error}`
    updateRestarting.value = false
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

async function createFullAppBackup() {
  if (backupBusy.value) return
  backupBusy.value = true
  try {
    if (!backupsPath.value) {
      await loadTauriAboutInfo()
    }
    const { manifest, path } = await createBackup(appVersion.value || '0.1.0')
    const createdPath = String(path || '').trim()
    lastBackupPath.value = createdPath
    await refreshNativeBackupList()
    const attempts = manifest?.attemptCount ?? manifest?.attempt_count ?? 0
    const settingsCount = manifest?.settingsCount ?? manifest?.settings_count ?? 0
    setGlobalMessage(
      'success',
      createdPath
        ? `完整备份已创建（不含明文 API Key）。路径：${createdPath}（练习 ${attempts} 条 · 设置 ${settingsCount} 项）`
        : `完整备份已创建（不含明文 API Key）：练习 ${attempts} 条 · 设置 ${settingsCount} 项`
    )
  } catch (error) {
    setGlobalMessage('error', '完整备份失败: ' + (error?.message || error))
  } finally {
    backupBusy.value = false
  }
}

async function refreshNativeBackupList() {
  try {
    const { items } = await listBackups()
    nativeBackups.value = Array.isArray(items) ? items : []
  } catch (error) {
    console.warn('list backups failed', error)
    nativeBackups.value = []
  }
}

async function showNativeBackupList() {
  await refreshNativeBackupList()
  settingsBackupListOpen.value = true
  openSettingsDetail('data')
}

async function restoreFullAppBackup() {
  if (backupBusy.value) return
  backupBusy.value = true
  try {
    const grant = await pickBackupImportPath()
    if (!grant) {
      setGlobalMessage('info', '已取消选择备份文件。')
      return
    }
    await previewAndConfirmRestore(grant)
  } catch (error) {
    setGlobalMessage('error', '选择备份失败: ' + (error?.message || error))
  } finally {
    backupBusy.value = false
  }
}

async function restoreNativeBackupFile(backup) {
  const grantId = String(backup?.grantId || '').trim()
  if (!grantId) return
  await previewAndConfirmRestore({
    grantId,
    displayPath: String(backup?.displayPath || backup?.name || '应用备份')
  })
}

async function previewAndConfirmRestore(grant) {
  const grantId = String(grant?.grantId || '').trim()
  const displayPath = String(grant?.displayPath || '已授权备份文件')
  if (!grantId) throw new Error('缺少备份文件授权')
  backupBusy.value = true
  try {
    const { report } = await importBackupPath(grantId, true)
    if (!report?.ok && (report?.errors || []).length) {
      throw new Error((report.errors || []).join('; ') || '备份校验失败')
    }
    const secretRefs = report?.secretRefsImported ?? report?.secret_refs_imported ?? 0
    const warnings = Array.isArray(report?.warnings) ? report.warnings.filter(Boolean) : []
    openConfirmDialog({
      kind: 'restore-full-backup',
      section: 'data',
      title: '恢复完整备份',
      message: [
        `文件：${displayPath}`,
        `预检通过，将合并写入练习 ${report?.attemptImported ?? report?.attempt_imported ?? 0} 条、`,
        `设置 ${report?.settingsImported ?? report?.settings_imported ?? 0} 项`,
        secretRefs > 0 ? `、密钥引用元数据 ${secretRefs} 条` : '',
        '。不会恢复明文 API Key / 系统密钥环内容；已有同 id 记录会被覆盖。',
        warnings.length ? `\n${warnings.join('\n')}` : ''
      ].join(''),
      confirmLabel: '确认恢复',
      danger: true,
      payload: { grantId }
    })
  } catch (error) {
    setGlobalMessage('error', '备份预检失败: ' + (error?.message || error))
  } finally {
    backupBusy.value = false
  }
}

async function applyFullBackupRestore(grantId) {
  const { report } = await importBackupPath(grantId, false)
  if (!report?.ok) {
    throw new Error((report?.errors || []).join('; ') || '恢复失败')
  }
  await loadSettings()
  await loadApiConfigs()
  await loadPromptList()
  await refreshNativeBackupList()
  const unavailableConfigs = apiConfigs.value.filter((item) => !item.has_secret).length
  setGlobalMessage(
    'success',
    `完整备份已恢复：练习 ${report.attemptImported ?? report.attempt_imported ?? 0} · 设置 ${report.settingsImported ?? report.settings_imported ?? 0}（未恢复明文 API Key）${unavailableConfigs ? `；${unavailableConfigs} 个 AI 配置需重新填写 Key 后才能评测` : ''}`
  )
}

function formatNativeBackupDate(backup) {
  const value = backup?.modifiedAt || backup?.modified_at || ''
  if (!value) return '未知时间'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatBytes(n) {
  const num = Number(n) || 0
  if (num < 1024) return `${num} B`
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / (1024 * 1024)).toFixed(1)} MB`
}

// 初始化
onMounted(async () => {
  loadSettings()
  getUserDataPath()
  loadTopicLibraryStats()
  loadApiConfigs()
  loadPromptList()
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
  font-size: var(--anth-text-2xl);
  color: var(--atlas-ink);
}

/* 标签页 */
.tabs-container {
  padding: 0;
  overflow: hidden;
}

.tabs {
  display: flex;
  border-bottom: 2px solid var(--border-color);
  background: var(--atlas-glass-elevated);
}

.tab {
  flex: 1;
  padding: 16px;
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  font-size: var(--anth-text-base);
  font-weight: 500;
  color: var(--atlas-ink-soft);
  cursor: pointer;
  transition: all 0.2s;
}

.tab:hover {
  background: color-mix(in srgb, var(--atlas-ink) 2%, transparent);
}

.tab.active {
  color: var(--atlas-accent);
  border-bottom-color: var(--atlas-accent);
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
  font-size: var(--anth-text-sm);
}

.table-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-text:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-text.danger {
  color: var(--atlas-danger);
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
  font-size: var(--anth-text-sm);
}

.json-editor {
  font-family: var(--font-mono);
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
  font-size: var(--anth-text-lg);
  color: var(--atlas-ink);
  margin-bottom: 12px;
}

.hint {
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-faint);
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
  border-color: var(--atlas-accent);
  background: var(--atlas-glass-pressed);
}

.mode-card.active {
  border-color: var(--atlas-accent);
  background: var(--atlas-accent-soft);
}

.mode-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}

.mode-icon {
  font-size: var(--anth-text-xl);
}

.mode-name {
  font-size: var(--anth-text-md);
  font-weight: 600;
  color: var(--atlas-ink);
}

.mode-temp {
  font-size: var(--anth-text-sm);
  color: var(--atlas-accent);
  font-weight: 600;
  margin-bottom: 8px;
}

.mode-desc {
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-soft);
}

.custom-temperature-panel {
  margin: 0 0 20px;
  padding: 16px;
  background: var(--atlas-glass-elevated);
  border-radius: var(--border-radius);
}

.custom-temperature-panel h4 {
  font-size: var(--anth-text-base);
  color: var(--atlas-ink);
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
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-soft);
}

.custom-temperature-field input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: var(--anth-text-sm);
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
  background: var(--atlas-glass-elevated);
  border-radius: var(--border-radius);
}

.param-card h4 {
  font-size: var(--anth-text-base);
  color: var(--atlas-ink);
  margin-bottom: 8px;
}

.param-card p {
  margin: 4px 0;
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-soft);
}

/* 数据管理 */
.setting-item {
  margin-bottom: 24px;
}

.setting-item label {
  display: block;
  font-weight: 500;
  color: var(--atlas-ink);
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
  font-size: var(--anth-text-sm);
}

.input-suffix {
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-soft);
}

/* 危险区域 */
.danger-zone {
  border: 2px solid var(--atlas-danger);
  padding: 20px;
  border-radius: var(--border-radius);
  background: color-mix(in srgb, var(--atlas-danger) 2%, transparent);
}

.danger-zone h3 {
  color: var(--atlas-danger);
}

.danger-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.danger-item h4 {
  font-size: var(--anth-text-base);
  color: var(--atlas-ink);
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
  box-shadow: 0 8px 24px color-mix(in srgb, var(--atlas-ink) 18%, transparent);
}

.about-section h2 {
  font-size: var(--anth-text-xl);
  color: var(--atlas-ink);
  margin-bottom: 8px;
}

.version {
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-faint);
  margin-bottom: 32px;
}

.about-info {
  text-align: left;
  background: var(--atlas-glass-elevated);
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
  color: var(--atlas-ink-soft);
}

.info-row .value {
  color: var(--atlas-ink);
  font-family: var(--font-mono);
  font-size: var(--anth-text-sm);
}

.about-features {
  text-align: left;
  background: var(--atlas-glass-elevated);
  padding: 20px;
  border-radius: var(--border-radius);
}

.about-features h3 {
  font-size: var(--anth-text-md);
  color: var(--atlas-ink);
  margin-bottom: 12px;
}

.about-features ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.about-features li {
  padding: 8px 0;
  font-size: var(--anth-text-sm);
  color: var(--atlas-ink-soft);
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
  font-size: var(--anth-text-3xl);
  line-height: 0.94;
  letter-spacing: 0;
}

.settings-page .page-header__copy p {
  max-width: 760px;
  color: var(--atlas-ink-soft);
  font-size: var(--anth-text-base);
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
  font-size: var(--anth-text-md);
  font-weight: 700;
  color: var(--atlas-ink);
}

.settings-page .tabs-head p {
  margin: 0;
  font-size: var(--anth-text-xs);
  color: var(--atlas-ink-faint);
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
  color: var(--atlas-ink-soft);
  background: transparent;
}

.settings-page .tab-icon {
  font-size: var(--anth-text-xs);
  color: var(--atlas-ink-faint);
}

.settings-page .tab:hover {
  background: color-mix(in srgb, var(--atlas-glass) 42%, transparent);
  border-color: var(--lg-border-color);
}

.settings-page .tab.active {
  color: var(--atlas-ink);
  border-bottom-color: transparent;
  border-color: var(--lg-border-color);
  background: color-mix(in srgb, var(--atlas-glass) 7%, transparent);
  box-shadow: var(--lg-shadow-subtle);
}

.settings-page .section + .section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--line-1);
}

.settings-page .section h3 {
  font-family: var(--font-family-display);
  font-size: var(--anth-text-2xl);
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
  font-size: var(--anth-text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-accent);
  background: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  background: color-mix(in srgb, var(--atlas-glass) 56%, transparent);
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
  border-color: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
}

.settings-page .mode-card.active {
  background: color-mix(in srgb, var(--atlas-glass) 74%, transparent);
  border-color: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  border-color: color-mix(in srgb, var(--atlas-danger) 16%, transparent);
  background: var(--atlas-library-danger);
}

.settings-page .about-section {
  max-width: none;
  text-align: left;
}

.settings-page .about-section h2 {
  font-family: var(--font-family-display);
  font-size: var(--anth-text-3xl);
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
  border: 1px solid color-mix(in srgb, var(--atlas-glass) 62%, transparent);
  border-radius: 18px;
  background:
    var(--atlas-sheen);
  box-shadow: 0 18px 42px -24px color-mix(in srgb, var(--atlas-ink) 26%, transparent);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-hero__copy {
  display: grid;
  gap: 8px;
}

.settings-eyebrow {
  color: var(--atlas-accent);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-hero h1 {
  font-size: var(--anth-text-3xl);
  line-height: 1;
  letter-spacing: 0;
}

.settings-hero p,
.settings-workspace__head p,
.settings-panel__head p,
.field small,
.settings-savebar span,
.setting-control__copy span {
  color: var(--atlas-ink-soft);
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
  border: 1px solid color-mix(in srgb, var(--atlas-glass) 64%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--atlas-glass) 56%, transparent);
}

.settings-metric span {
  color: var(--atlas-ink);
  font-size: 1.22rem;
  font-weight: 800;
  line-height: 1.1;
}

.settings-metric small {
  color: var(--atlas-ink-faint);
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
  border: 1px solid color-mix(in srgb, var(--atlas-glass) 62%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--atlas-glass) 58%, transparent);
  box-shadow: 0 14px 36px -28px color-mix(in srgb, var(--atlas-ink) 34%, transparent);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-nav__head {
  display: grid;
  gap: 2px;
  padding: 6px 8px 12px;
  border-bottom: 1px solid var(--atlas-line);
  margin-bottom: 4px;
}

.settings-nav__head span {
  color: var(--atlas-ink-faint);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.settings-nav__head strong {
  color: var(--atlas-ink);
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
  color: var(--atlas-ink-soft);
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
  border-color: color-mix(in srgb, var(--atlas-glass) 72%, transparent);
  background: color-mix(in srgb, var(--atlas-glass) 48%, transparent);
}

.settings-nav__item.is-active {
  color: var(--atlas-ink);
  border-color: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
  background: color-mix(in srgb, var(--atlas-glass) 78%, transparent);
  box-shadow: 0 8px 18px -14px color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  color: var(--atlas-ink-faint);
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
  font-size: var(--anth-text-lg);
  color: var(--atlas-accent);
  background: color-mix(in srgb, var(--atlas-glass) 58%, transparent);
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  border: 1px solid color-mix(in srgb, var(--atlas-glass) 64%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--atlas-glass) 62%, transparent);
  box-shadow: 0 18px 42px -30px color-mix(in srgb, var(--atlas-ink) 30%, transparent);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
}

.settings-workspace__head {
  padding: 22px 24px;
}

.settings-workspace__head h2 {
  margin-top: 4px;
  font-size: var(--anth-text-2xl);
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
  border: 1px solid var(--atlas-line);
  border-radius: 999px;
  color: var(--atlas-ink-soft);
  background: color-mix(in srgb, var(--atlas-glass) 54%, transparent);
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
}

.settings-badge--accent {
  color: var(--atlas-accent);
  border-color: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
  background: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
}

.settings-badge--success {
  color: var(--atlas-success);
  border-color: color-mix(in srgb, var(--atlas-success) 12%, transparent);
  background: color-mix(in srgb, var(--atlas-success) 12%, transparent);
}

.settings-badge--muted {
  color: var(--atlas-ink-faint);
  background: var(--atlas-glass-pressed);
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
  border: 1px solid var(--atlas-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--atlas-glass) 48%, transparent);
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
  color: var(--atlas-ink);
  font-size: 0.98rem;
}

.settings-list__meta {
  color: var(--atlas-ink-faint);
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
  background: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  color: var(--atlas-ink-soft);
  font-size: 0.82rem;
  font-weight: 700;
}

.settings-page input,
.settings-page select,
.settings-page textarea {
  min-height: 44px;
  border-color: var(--atlas-line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--atlas-glass) 72%, transparent);
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
  border: 1px solid var(--atlas-line);
  border-radius: 14px;
  color: var(--atlas-ink);
  background: color-mix(in srgb, var(--atlas-glass) 52%, transparent);
  text-align: left;
}

.settings-page .mode-card.active {
  border-color: color-mix(in srgb, var(--atlas-accent) 16%, transparent);
  background:
    var(--atlas-sheen);
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
  font-size: var(--anth-text-lg);
  color: var(--atlas-accent);
  background: color-mix(in srgb, var(--atlas-glass) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 16%, transparent);
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
  color: var(--atlas-accent);
  font-family: var(--font-family-mono);
  font-size: 0.86rem;
}

.custom-temperature-panel {
  padding: 16px;
  border: 1px solid var(--atlas-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--atlas-glass) 44%, transparent);
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
  border: 1px solid var(--atlas-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--atlas-glass) 5%, transparent);
}

.settings-savebar > div {
  display: grid;
  gap: 2px;
}

.settings-savebar strong {
  color: var(--atlas-ink);
}

.setting-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 18px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--atlas-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--atlas-glass) 48%, transparent);
}

.setting-control__copy {
  display: grid;
  gap: 4px;
}

.setting-control__copy strong {
  color: var(--atlas-ink);
}

.setting-control__input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.setting-control__input span {
  color: var(--atlas-ink-soft);
  font-weight: 700;
}

.settings-page .danger-zone {
  border-color: color-mix(in srgb, var(--atlas-danger) 16%, transparent);
  background: var(--atlas-library-danger);
}

.danger-zone .settings-panel__head h3,
.settings-page .btn-text.danger {
  color: var(--atlas-danger);
}

.settings-page .danger-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--atlas-danger) 16%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--atlas-glass) 52%, transparent);
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
  font-size: var(--anth-text-base);
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
  font-size: var(--anth-text-3xl);
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
  border: 1px solid var(--atlas-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--atlas-glass) 46%, transparent);
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
  color: var(--atlas-success);
  background: color-mix(in srgb, var(--atlas-success) 12%, transparent);
  font-size: 0.72rem;
  font-weight: 800;
}

.settings-loading,
.settings-empty {
  padding: 22px;
  border: 1px dashed var(--atlas-line);
  border-radius: 12px;
  color: var(--atlas-ink-soft);
  background: color-mix(in srgb, var(--atlas-glass) 34%, transparent);
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
    font-size: var(--anth-text-3xl);
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

.settings-stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.settings-backup-path,
.settings-path-clip {
  margin-top: 10px;
  font-size: var(--anth-text-xs);
  word-break: break-all;
  opacity: 0.78;
}

.settings-backup-result {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 18%, transparent);
  background: color-mix(in srgb, var(--lg-bg-elevated) 88%, transparent);
  box-shadow: var(--lg-shadow-subtle);
}

.settings-backup-result__label {
  font-size: var(--anth-text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--atlas-ink-soft);
  margin-bottom: 6px;
}

.settings-backup-result__path {
  margin-top: 0;
  font-family: var(--font-mono);
  font-size: var(--anth-text-xs);
  line-height: 1.45;
  color: var(--atlas-ink);
  opacity: 0.92;
}

.settings-backup-result__hint {
  margin: 8px 0 0;
  font-size: var(--anth-text-xs);
}

.settings-system-info .settings-path-clip {
  margin-top: 0;
  display: inline;
  opacity: 0.9;
}

.ai-settings-panel {
  border: 1px solid color-mix(in srgb, var(--atlas-accent) 22%, transparent);
}

/* Settings overview density: the overview is a dashboard, not four empty hero cards. */
.settings-page > .hero-panel__header {
  padding: 8px 4px 2px;
}

.settings-page > .hero-panel__header .hero-panel__title {
  margin: 0;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  line-height: 1.1;
}

.settings-page > .hero-settings-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.settings-page > .hero-settings-group > .hero-panel {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 18px 20px;
}

.settings-page > .hero-settings-group > .hero-panel h3 {
  margin: 0;
  font-size: 1.12rem;
  line-height: 1.2;
}

.settings-page > .hero-settings-group > .hero-panel > .hero-panel__muted {
  margin: 0;
  max-width: 72ch;
  line-height: 1.45;
}

.settings-page .hero-settings-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.settings-page .hero-settings-actions .hero-btn {
  min-height: 36px;
  padding: 7px 12px;
}

.settings-page .visual-system-note {
  min-height: 30px;
  padding: 0 10px;
  font-size: 0.74rem;
}

.settings-page .settings-stat-row {
  margin-top: 1px;
  gap: 6px;
}

.settings-page .settings-system-info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 16px;
  margin: 0;
  padding: 12px 14px;
  font-size: 0.82rem;
  line-height: 1.35;
}

.settings-page .settings-system-info > :first-child {
  grid-column: 1 / -1;
}

.settings-page .settings-system-info > div {
  min-width: 0;
}

.settings-page .settings-system-info .settings-path-clip {
  display: inline-block;
  max-width: 100%;
  vertical-align: bottom;
}

.settings-page .settings-credit {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 0;
  font-size: 0.78rem;
}

@media (max-width: 760px) {
  .settings-page > .hero-settings-group {
    grid-template-columns: 1fr;
  }

  .settings-page .settings-system-info {
    grid-template-columns: 1fr;
  }

  .settings-page .settings-system-info > :first-child {
    grid-column: auto;
  }
}
</style>
