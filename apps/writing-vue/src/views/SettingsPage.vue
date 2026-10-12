<template>
  <div id="settings-view" class="settings-page view active" data-writing-settings>
    <header class="page-header has-rule">
      <p class="page-header-kicker">写作 · 偏好与数据</p>
      <h1>设置</h1>
      <p class="page-header-desc">配置评测通道与提示词，管理本机备份、历史保留与应用信息。</p>
    </header>

    <div v-if="globalMessage.message" :class="['inline-message', `inline-message-${globalMessage.type}`]">
      {{ globalMessage.message }}
    </div>

    <div class="settings-layout">
      <nav class="tabs is-vertical settings-rail" aria-label="设置分区">
        <button class="tab" type="button" @click="jumpToSection('settings-ai')">AI 与评测</button>
        <button class="tab" type="button" @click="jumpToSection('settings-backup')">本机数据备份</button>
        <button class="tab" type="button" @click="jumpToSection('settings-system')">系统与外观</button>
        <button class="tab" type="button" @click="jumpToSection('settings-info')">系统信息</button>
      </nav>

      <div class="settings-sections">
        <section id="settings-ai" class="card settings-card ai-settings-panel" aria-labelledby="settings-ai-title">
          <div class="panel-header">
            <div class="settings-card__head">
              <h2 id="settings-ai-title">AI 与评测</h2>
              <p class="field-help">配置模型、提示词与温度。API Key 保存在系统密钥环，不会进入普通备份。</p>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>评测通道</strong>
              <span>供应商、默认模型与 API Key</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" type="button" data-settings-open="api" @click="openSettingsDetail('api')">API 配置</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>提示词版本</strong>
              <span>Task 1 / Task 2 的评判提示词</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" type="button" data-settings-open="prompts" @click="openSettingsDetail('prompts')">提示词</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>温度与模型参数</strong>
              <span>影响评分严格程度与反馈详细度</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" type="button" data-settings-open="model" @click="openSettingsDetail('model')">模型参数</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>版本与运行环境</strong>
              <span>应用版本、宿主与数据路径</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" type="button" data-settings-open="about" @click="openSettingsDetail('about')">关于</button>
            </div>
          </div>
          <div class="settings-stats">
            <div class="stat">
              <span class="stat-label">已启用配置</span>
              <span class="stat-value">{{ enabledConfigCount }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">全部配置</span>
              <span class="stat-value">{{ totalConfigCount }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">提示词版本</span>
              <span class="stat-value">{{ promptEntries.length }}</span>
            </div>
          </div>
        </section>

        <section id="settings-backup" class="card settings-card data-management-panel" aria-labelledby="settings-backup-title">
          <div class="panel-header">
            <div class="settings-card__head">
              <h2 id="settings-backup-title">本机数据备份</h2>
              <p class="field-help">完整备份由 Rust 写入应用 backups 目录，包含练习记录与设置元数据；不含明文 API Key。</p>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>备份全部数据</strong>
              <span>生成一份可恢复的完整快照</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary data-mgmt-btn" id="create-backup-btn" type="button" :disabled="backupBusy" @click="createFullAppBackup">
                {{ backupBusy ? '处理中…' : '备份全部数据' }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>从备份恢复</strong>
              <span>替换当前全部数据，恢复前会先保存快照</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary data-mgmt-btn" id="restore-backup-btn" type="button" :disabled="backupBusy" @click="restoreFullAppBackup">
                从备份恢复…
              </button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>备份文件</strong>
              <span>查看 backups 目录中的完整备份</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary data-mgmt-btn" id="backup-list-btn" type="button" :disabled="backupBusy" @click="showNativeBackupList">
                备份列表
              </button>
            </div>
          </div>
          <div v-if="lastBackupPath" class="inline-message inline-message-success" role="status">
            <div>最近完整备份已写入</div>
            <code class="settings-path" :title="lastBackupPath">{{ lastBackupPath }}</code>
          </div>
          <div v-if="backupsPath" class="setting-row">
            <div class="setting-row__copy">
              <strong>备份目录</strong>
              <span>应用 backups 目录</span>
            </div>
            <code class="settings-path" :title="backupsPath">{{ backupsPath }}</code>
          </div>
        </section>

        <section id="settings-system" class="card settings-card system-management-panel" aria-labelledby="settings-system-title">
          <div class="panel-header">
            <div class="settings-card__head">
              <h2 id="settings-system-title">系统与外观</h2>
              <p class="field-help">写作题库入口、新手引导与原生更新工具。</p>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>写作题库</strong>
              <span>浏览题库并开始练习</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" id="load-library-btn" type="button" @click="openWritingTopicLibrary">打开写作题库</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>新手引导</strong>
              <span>重新查看快速引导</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" id="show-onboarding-btn" type="button" @click="startOnboardingTour">显示引导</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>提示词设置</strong>
              <span>题库页使用的提示词与生成参数</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" id="library-config-btn" type="button" data-action="library-config" @click="openWritingLibraryConfig">提示词设置</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>应用更新</strong>
              <span>检查原生更新通道</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" id="check-updates-btn" type="button" data-update-action="open-modal" @click="openUpdateManager">检查更新</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>历史保留上限</strong>
              <span>自动保留最近终态记录的数量</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-secondary" type="button" @click="openSettingsDetail('data')">历史保留上限</button>
            </div>
          </div>
        </section>

        <section id="settings-info" class="card settings-card system-info-panel" aria-labelledby="settings-info-title">
          <div class="panel-header">
            <div class="settings-card__head">
              <h2 id="settings-info-title">系统信息</h2>
              <p class="field-help system-info-status">{{ topicLibraryStatus }}</p>
            </div>
          </div>
          <div class="settings-stats">
            <div class="stat">
              <span class="stat-label">题目总数</span>
              <span id="total-exams" class="stat-value">{{ topicLibraryStats.total }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Task 1</span>
              <span id="html-exams" class="stat-value">{{ topicLibraryStats.task1 }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Task 2</span>
              <span id="pdf-exams" class="stat-value">{{ topicLibraryStats.task2 }}</span>
            </div>
          </div>
          <p class="field-help">最近更新：<span id="last-update">{{ topicLibraryStats.lastUpdate }}</span></p>
          <details class="settings-technical-details">
            <summary>技术详情</summary>
            <dl class="settings-info-list">
              <div class="info-row"><dt class="label">桌面宿主</dt><dd class="value">{{ hostName }}</dd></div>
              <div class="info-row"><dt class="label">Tauri 版本</dt><dd class="value">{{ tauriVersion }}</dd></div>
              <div class="info-row"><dt class="label">数据目录</dt><dd class="value settings-path" :title="userDataPath || pathsLoadingLabel">{{ userDataPath || pathsLoadingLabel }}</dd></div>
              <div class="info-row"><dt class="label">备份目录</dt><dd class="value settings-path" :title="backupsPath || ''">{{ backupsPath || (pathsResolved ? '未获取' : '加载中...') }}</dd></div>
            </dl>
          </details>
          <div class="settings-credit">
            <a href="https://docs.qq.com/doc/DSXZhWUtqeVN0d1ZT" target="_blank" rel="noopener noreferrer" class="btn btn-link btn-sm inline-hover-link">问题反馈</a>
            <a href="https://github.com/sallowayma-git" target="_blank" rel="noopener noreferrer" class="btn btn-link btn-sm">Salloway呈现</a>
          </div>
        </section>
      </div>
    </div>

    <div
      v-if="settingsDetailOpen"
      class="settings-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-label="写作设置明细"
      @click.self="hideSettingsDetail"
    >
      <section class="dialog dialog-lg settings-detail-panel">
        <div class="settings-detail-chrome">
          <header class="settings-detail-head">
            <div class="settings-detail-head__copy">
              <h3>{{ activeTabMeta.title }}</h3>
              <p class="field-help">{{ activeTabMeta.description }}</p>
            </div>
            <button class="btn btn-icon settings-detail-close" type="button" aria-label="关闭写作设置" @click="hideSettingsDetail">×</button>
          </header>

          <nav class="tabs settings-tabs" aria-label="写作设置分类">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              :class="['tab settings-tab', { active: activeTab === tab.key }]"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>
        </div>

        <!-- API 配置 -->
        <section v-if="activeTab === 'api'" class="settings-panel">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>评测通道</h3>
              <p>默认配置必须启用且本机可读取 API Key。完整备份只恢复引用：同一设备且本机凭据记录仍在时可复用，换设备必须重新填写 Key。</p>
            </div>
            <div class="settings-badges">
              <span class="tag tag-neutral">{{ totalConfigCount }} 个配置</span>
              <span class="tag tag-success">{{ enabledConfigCount }} 个启用</span>
            </div>
          </div>
          <div v-if="sectionMessages.api.message" :class="['inline-message', `inline-message-${sectionMessages.api.type}`]">
            {{ sectionMessages.api.message }}
          </div>
          <div v-if="apiLoading" class="settings-loading">加载配置中...</div>
          <div v-else-if="!apiConfigs.length" class="settings-empty">暂无 API 配置。</div>
          <div v-else class="list settings-list">
            <div v-for="item in apiConfigs" :key="item.id" class="list-row settings-list__row">
              <div class="list-row-main">
                <div class="settings-list__title">
                  <strong>{{ item.config_name }}</strong>
                  <span v-if="item.is_default" class="tag tag-accent">默认</span>
                  <span :class="['tag', item.is_enabled ? 'tag-success' : 'tag-neutral']">
                    {{ item.is_enabled ? '启用' : '禁用' }}
                  </span>
                  <span v-if="!item.has_secret" class="tag tag-neutral">需重新填写 Key</span>
                </div>
                <div class="list-row-meta">
                  <span>{{ item.provider }}</span>
                  <span>{{ item.default_model }}</span>
                </div>
              </div>
              <div class="list-row-trail">
                <button class="btn btn-ghost btn-sm" type="button" @click="editConfig(item)">编辑</button>
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="testingConfigId === item.id || !item.has_secret"
                  :title="item.has_secret ? '' : '此设备没有该配置的 API Key，请先编辑并重新填写'"
                  @click="testConfig(item.id)"
                >
                  {{ testingConfigId === item.id ? '测试中' : '测试' }}
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="item.is_default || !item.is_enabled || !item.has_secret"
                  :title="item.is_default ? '当前已是默认配置' : (!item.is_enabled ? '禁用配置不能设为默认' : (!item.has_secret ? '请先在此设备重新填写 API Key' : ''))"
                  @click="setDefaultConfig(item.id)"
                >
                  设默认
                </button>
                <button
                  class="btn btn-ghost btn-sm"
                  type="button"
                  :disabled="isToggleBlocked(item)"
                  :title="getToggleBlockedReason(item)"
                  @click="toggleConfig(item.id)"
                >
                  {{ item.is_enabled ? '禁用' : '启用' }}
                </button>
                <button
                  class="btn btn-danger-ghost btn-sm"
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

        <section v-if="activeTab === 'api'" class="settings-panel">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>{{ apiForm.id ? '编辑配置' : '新建配置' }}</h3>
              <p>{{ apiForm.id ? (editingConfigNeedsKey ? '该配置来自备份，但此设备无法读取 API Key；请重新填写后保存。' : 'API Key 留空时保持原值。') : '新建配置必须填写 API Key。' }}</p>
            </div>
          </div>
          <div class="settings-form-grid">
            <label class="field">
              <span class="field-label">配置名称</span>
              <input class="input" v-model="apiForm.config_name" placeholder="例如 OpenAI 主通道" />
            </label>
            <label class="field">
              <span class="field-label">供应商</span>
              <select class="select" v-model="apiForm.provider">
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </label>
            <label class="field field--wide">
              <span class="field-label">Base URL</span>
              <input class="input" v-model="apiForm.base_url" placeholder="https://api.openai.com/v1" />
              <small class="field-help">{{ isApiFormUrlLinked ? '跟随供应商默认地址' : '当前使用自定义地址' }}</small>
            </label>
            <label class="field">
              <span class="field-label">默认模型</span>
              <input class="input" v-model="apiForm.default_model" placeholder="gpt-4o-mini" />
            </label>
            <label class="field">
              <span class="field-label">API Key</span>
              <input class="input" v-model="apiForm.api_key" type="password" autocomplete="off" placeholder="编辑时留空表示不变" />
            </label>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" @click="saveApiConfig">保存配置</button>
            <button class="btn btn-secondary btn-warm-sand" type="button" @click="resetApiForm">重置</button>
          </div>
        </section>

        <!-- 提示词管理 -->
        <section v-if="activeTab === 'prompts'" class="settings-panel">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>提示词版本</h3>
              <p>管理 Task 1 / Task 2 的评判提示词版本。</p>
            </div>
            <div class="settings-badges">
              <span class="tag tag-neutral">{{ promptEntries.length }} 个版本</span>
              <span class="tag tag-success">{{ activePromptCount }} 个激活</span>
            </div>
          </div>
          <div v-if="sectionMessages.prompts.message" :class="['inline-message', `inline-message-${sectionMessages.prompts.type}`]">
            {{ sectionMessages.prompts.message }}
          </div>
          <div v-if="promptLoading" class="settings-loading">加载提示词中...</div>
          <div v-else-if="!promptEntries.length" class="settings-empty">暂无提示词版本。</div>
          <div v-else class="list settings-list">
            <div v-for="item in promptEntries" :key="item.id" class="list-row settings-list__row">
              <div class="list-row-main">
                <div class="settings-list__title">
                  <strong>{{ item.task_type }}</strong>
                  <span :class="['tag', item.is_active ? 'tag-success' : 'tag-neutral']">
                    {{ item.is_active ? '激活' : '未激活' }}
                  </span>
                </div>
                <div class="list-row-meta">
                  <span>ID {{ item.id }}</span>
                  <span>{{ item.version }}</span>
                </div>
              </div>
              <div class="list-row-trail">
                <button class="btn btn-ghost btn-sm" type="button" @click="activatePrompt(item.id)">激活</button>
                <button class="btn btn-danger-ghost btn-sm" type="button" @click="requestDeletePrompt(item.id)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'prompts'" class="settings-panel">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>导入/导出</h3>
              <p>支持完整 JSON 配置或版本数组。</p>
            </div>
          </div>
          <textarea
            v-model="importPromptJson"
            class="textarea json-editor"
            rows="10"
            placeholder='粘贴 JSON（支持 {version,task1,task2} 或 [{task_type,...}]）'
          ></textarea>
          <div class="form-actions">
            <button class="btn btn-primary" type="button" @click="importPromptConfig">导入提示词</button>
            <button class="btn btn-secondary" type="button" @click="exportPromptConfig">导出当前激活</button>
          </div>
        </section>

        <!-- 模型参数 -->
        <section v-if="activeTab === 'model'" class="settings-panel settings-panel--model">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>温度模式</h3>
              <p>温度值影响 AI 评分的严格程度和反馈详细度。</p>
            </div>
            <span class="tag tag-accent">{{ currentTemperatureSummary }}</span>
          </div>
          <div v-if="sectionMessages.model.message" :class="['inline-message', `inline-message-${sectionMessages.model.type}`]">
            {{ sectionMessages.model.message }}
          </div>

          <div class="list temperature-modes">
            <button
              v-for="mode in temperatureModes"
              :key="mode.value"
              :class="['list-row mode-card', { active: modelSettings.temperature_mode === mode.value, 'is-selected': modelSettings.temperature_mode === mode.value }]"
              type="button"
              @click="modelSettings.temperature_mode = mode.value"
            >
              <span class="mode-copy">
                <span class="mode-name">{{ mode.name }}</span>
                <span class="mode-desc">{{ mode.desc }}</span>
              </span>
              <span class="mode-temp">{{ getModeTemperatureLabel(mode) }}</span>
            </button>
          </div>

          <div v-if="modelSettings.temperature_mode === 'custom'" class="custom-temperature-panel">
            <div class="panel-header settings-panel__head">
              <div>
                <h4>自定义任务温度</h4>
                <p>范围 0.0-2.0，分别作用于 Task 1 和 Task 2。</p>
              </div>
            </div>
            <div class="custom-temperature-grid">
              <label class="field">
                <span class="field-label">Task 1</span>
                <input
                  class="input"
                  v-model.number="modelSettings.temperature_task1"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                />
              </label>
              <label class="field">
                <span class="field-label">Task 2</span>
                <input
                  class="input"
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
            <button class="btn btn-primary" type="button" @click="saveModelSettings" :disabled="modelSaving">
              {{ modelSaving ? '保存中...' : '保存设置' }}
            </button>
          </div>
        </section>

        <!-- 数据管理 -->
        <section v-if="activeTab === 'data'" class="settings-panel">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>历史记录</h3>
              <p>由本机 SQLite 在写入终态练习时执行的历史保留策略；草稿、进行中和评测中的记录不会被清理。</p>
            </div>
            <span class="tag tag-neutral">{{ historyRetentionLabel }}</span>
          </div>
          <div v-if="sectionMessages.data.message" :class="['inline-message', `inline-message-${sectionMessages.data.type}`]">
            {{ sectionMessages.data.message }}
          </div>

          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>自动保留最近记录数量</strong>
              <span>仅终态记录（完成、取消、失败或中断）会按完成时间裁剪；不限时不自动清理。</span>
            </div>
            <div class="setting-row__control">
              <label class="check-label">
                <input v-model="dataSettings.unlimited" type="checkbox" />
                <span>不限</span>
              </label>
              <label v-if="!dataSettings.unlimited" class="check-label">
                <input
                  class="input settings-number"
                  type="number"
                  v-model.number="dataSettings.max_terminal_attempts"
                  min="50"
                  max="500"
                  step="50"
                />
                <span>条</span>
              </label>
            </div>
          </div>
          <div class="settings-savebar">
            <span>{{ dataSettings.unlimited ? '不限：不自动清理历史。' : '允许范围 50-500，按 50 递增。' }}</span>
            <button class="btn btn-primary" type="button" @click="saveDataSettings" :disabled="dataSaving">
              {{ dataSaving ? '保存中...' : '保存' }}
            </button>
          </div>
        </section>

        <section v-if="activeTab === 'data' && settingsBackupListOpen" class="settings-panel" data-writing-settings-backup-list>
          <div class="panel-header settings-panel__head">
            <div>
              <h3>应用备份文件</h3>
              <p>来自 backups 目录的完整备份。恢复会替换当前全部数据，不是合并写入；恢复前会先保存当前数据的快照。密钥引用仅为元数据，不含明文 API Key。</p>
            </div>
            <span class="tag tag-neutral">{{ nativeBackups.length }} 个文件</span>
          </div>
          <div v-if="!nativeBackups.length" class="settings-empty">暂无完整备份文件。可先点「备份全部数据」。</div>
          <div v-else class="list settings-list">
            <div v-for="backup in nativeBackups" :key="backup.grantId" class="list-row settings-list__row">
              <div class="list-row-main">
                <div class="settings-list__title">
                  <strong>{{ backup.name }}</strong>
                  <span class="tag tag-neutral">{{ formatNativeBackupDate(backup) }}</span>
                </div>
                <div class="list-row-meta">
                  <span>{{ formatBytes(backup.sizeBytes || backup.size_bytes || 0) }}</span>
                  <span class="settings-path" :title="backup.displayPath">{{ backup.displayPath }}</span>
                </div>
              </div>
              <div class="list-row-trail">
                <button class="btn btn-ghost btn-sm" type="button" :disabled="backupBusy" @click="restoreNativeBackupFile(backup)">恢复</button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="activeTab === 'data'" class="settings-panel danger-zone">
          <div class="panel-header settings-panel__head">
            <div>
              <h3>危险操作</h3>
              <p>这些操作会影响本地历史数据。</p>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__copy">
              <strong>清空所有历史记录</strong>
              <span>此操作将删除所有评分历史，且不可恢复</span>
            </div>
            <div class="setting-row__control">
              <button class="btn btn-danger" type="button" @click="confirmClearHistory">清空历史</button>
            </div>
          </div>
        </section>

        <!-- 关于 -->
        <section v-if="activeTab === 'about'" class="settings-panel about-section">
          <div class="about-identity">
            <h2 class="heading-serif">IELTS Atlas</h2>
            <p class="version">版本 {{ appVersion }}</p>
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
              <span class="value settings-path" :title="userDataPath || pathsLoadingLabel">{{ userDataPath || pathsLoadingLabel }}</span>
            </div>
            <div v-if="backupsPath || pathsResolved" class="info-row">
              <span class="label">备份目录</span>
              <span class="value settings-path" :title="backupsPath || ''">{{ backupsPath || '未获取' }}</span>
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
      <div class="dialog dialog-sm onboarding-dialog">
        <p class="settings-detail-eyebrow">快速引导 {{ onboardingStep + 1 }} / {{ onboardingSteps.length }}</p>
        <h3>{{ onboardingSteps[onboardingStep].title }}</h3>
        <p>{{ onboardingSteps[onboardingStep].body }}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" type="button" :disabled="onboardingStep === 0" @click="onboardingStep -= 1">上一步</button>
          <button class="btn btn-primary" type="button" @click="advanceOnboarding">
            {{ onboardingStep === onboardingSteps.length - 1 ? '完成' : '下一步' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="updateDialogOpen" class="dialog-overlay" role="dialog" aria-modal="true" @click.self="closeUpdateDialog">
      <div class="dialog dialog-sm">
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
          <button class="btn btn-secondary btn-warm-sand" type="button" :disabled="updateInstalling || updateRestarting" @click="closeUpdateDialog">关闭</button>
          <button class="btn btn-primary" type="button" :disabled="updateChecking || updateInstalling || updateRestarting" @click="checkUpdates">
            {{ updateChecking ? '检查中...' : '重新检查' }}
          </button>
          <button
            v-if="updateStatus.updateAvailable && !updateStatus.requiresRestart"
            class="btn btn-primary"
            type="button"
            :disabled="updateChecking || updateInstalling"
            @click="installAvailableUpdate"
          >
            {{ updateInstalling ? '安装中...' : '下载并安装' }}
          </button>
          <button
            v-if="updateStatus.requiresRestart"
            class="btn btn-primary"
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
      <div class="dialog dialog-sm">
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
          <button class="btn btn-secondary" type="button" @click="closeConfirmDialog">
            取消
          </button>
          <button
            :class="['btn', confirmDialog.danger ? 'btn-danger' : 'btn-primary']"
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
      title: '恢复完整备份（替换当前数据）',
      message: [
        `文件：${displayPath}`,
        '恢复会用备份替换本机当前的全部数据，不是合并写入。',
        `当前 → 备份：${describeRestoreDelta(report)}`,
        secretRefs > 0 ? `密钥引用元数据 ${secretRefs} 条。` : '',
        '恢复前会先把当前数据保存为 backups 目录下的 pre-restore 快照。不会恢复明文 API Key / 系统密钥环内容。',
        warnings.length ? `\n${warnings.join('\n')}` : ''
      ].join('\n'),
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

/** "练习 3 → 5，作文 …" from the dry run's per-class counts. */
function describeRestoreDelta(report) {
  const delta = report?.delta
  if (!delta) return '（无法读取当前数据统计）'
  const rows = [
    ['练习', 'attempts'],
    ['作文评分', 'essays'],
    ['教练消息', 'coachMessages'],
    ['记忆', 'memories']
  ]
  return rows
    .map(([label, key]) => `${label} ${delta.current?.[key] ?? 0} → ${delta.incoming?.[key] ?? 0}`)
    .join('；')
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
    `完整备份已替换当前数据：练习 ${report.attemptImported ?? report.attempt_imported ?? 0} · 设置 ${report.settingsImported ?? report.settings_imported ?? 0}（未恢复明文 API Key）${unavailableConfigs ? `；${unavailableConfigs} 个 AI 配置需重新填写 Key 后才能评测` : ''}`
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

// Rail links: scroll the settings card into view. Hash routing means no href anchors.
function jumpToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<style scoped>
/* Settings: page header, section rail, ruled cards. Tabs live in one detail dialog.
 * Shared pieces come from the design system; this block only lays out settings rows. */
.settings-page { min-width: 0; }

.settings-layout {
  display: grid;
  grid-template-columns: calc(var(--anth-sidebar-w) * 0.75) minmax(0, 1fr);
  gap: var(--anth-space-7);
  align-items: start;
  min-width: 0;
}

.settings-page .settings-rail.tabs.is-vertical { position: sticky; top: var(--anth-space-6); }

.settings-sections { display: grid; gap: var(--anth-space-5); min-width: 0; }
.settings-card__head { display: grid; gap: var(--anth-space-1); min-width: 0; }
.settings-card__head h2 { margin: 0; }

/* One setting per row: copy left, control right, hairline between rows. */
.setting-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-3) var(--anth-space-5);
  padding: var(--anth-space-3) 0;
}

.setting-row + .setting-row { border-top: 1px solid var(--anth-rule); }
.setting-row__copy { display: grid; flex: 1 1 240px; gap: 2px; min-width: 0; }
.setting-row__copy strong { color: var(--anth-ink); font-weight: var(--anth-weight-medium); }
.setting-row__copy span { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }

.setting-row__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--anth-space-2);
  min-width: 0;
  max-width: 100%;
}

/* Long paths: mono, one line, ellipsis; the full value sits in the title tooltip. */
.settings-path {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-mono);
  font-size: var(--anth-text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-row > .settings-path,
.info-row .settings-path { flex: 1 1 260px; }

.settings-stats {
  display: flex;
  flex-wrap: wrap;
  padding-top: var(--anth-space-3);
  border-top: 1px solid var(--anth-rule);
}

.settings-badges { display: flex; flex-wrap: wrap; gap: var(--anth-space-2); }
.settings-credit { display: flex; flex-wrap: wrap; gap: var(--anth-space-3); margin-top: var(--anth-space-2); }
.settings-technical-details summary { color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); cursor: pointer; }

.info-row {
  display: grid;
  grid-template-columns: 9em minmax(0, 1fr);
  gap: var(--anth-space-3);
  padding: var(--anth-space-2) 0;
  border-bottom: 1px solid var(--anth-rule);
  font-size: var(--anth-text-small-size);
}

.info-row:last-child { border-bottom: 0; }
.info-row .label { color: var(--anth-ink-muted); }
.info-row .value { min-width: 0; margin: 0; overflow-wrap: anywhere; }

/* Detail dialog: design-system overlay and dialog with a sticky head and tabs.
 * The z-index stays under the overlay token so a confirm dialog opened inside it
 * stacks above (settings_modal_visual_check.py asserts that order). */
/* Own overlay, not .dialog-overlay: the page-level overlay selectors must match only confirm/update/onboarding. */
.settings-page .settings-detail-modal {
  position: fixed;
  inset: 0;
  z-index: var(--anth-z-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--anth-space-5);
  background: var(--anth-scrim);
}
/* The sticky chrome and tab body own the padding; the dialog surface comes from dialog.css. */
.settings-page .settings-detail-panel {
  padding: 0;
}

.settings-detail-chrome {
  position: sticky;
  top: 0;
  z-index: var(--anth-z-raised);
  padding: var(--anth-space-5) var(--anth-space-6) 0;
  background: var(--anth-surface-raised);
}

.settings-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--anth-space-4); }
.settings-detail-head h3 { margin: 0; }
.settings-page .settings-tabs { margin-top: var(--anth-space-4); overflow-x: auto; scrollbar-width: none; }

.settings-page .settings-panel {
  display: grid;
  gap: var(--anth-space-4);
  min-width: 0;
  padding: var(--anth-space-5) var(--anth-space-6);
  background: var(--anth-surface-raised);
}

.settings-page .settings-panel + .settings-panel { border-top: 1px solid var(--anth-rule); }
.settings-page .settings-panel__head { flex-wrap: wrap; margin-bottom: 0; }
.settings-page .settings-panel__head :is(h3, h4) { margin: 0; }

.settings-page .settings-panel__head p {
  max-width: 64ch;
  margin: var(--anth-space-1) 0 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.settings-loading,
.settings-empty { padding: var(--anth-space-4) 0; color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }

/* Design-system list row: copy column, then the action trail. */
.settings-page .settings-list__row { grid-template-columns: minmax(0, 1fr) auto; }
.settings-list__title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--anth-space-1) var(--anth-space-2); }

.settings-form-grid,
.custom-temperature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--anth-space-4) var(--anth-space-5);
}

.settings-page .field--wide { grid-column: 1 / -1; }

.settings-page .json-editor {
  min-height: 180px;
  font-family: var(--anth-font-mono);
  font-size: var(--anth-text-xs);
  line-height: 1.6;
}

.form-actions { display: flex; flex-wrap: wrap; gap: var(--anth-space-2); }

/* Temperature modes: a selectable list; the chosen row takes the selected wash. */
.settings-page .mode-card {
  grid-template-columns: minmax(0, 1fr) auto;
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--anth-rule);
  color: var(--anth-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* Rows and blocks inside a detail tab sit on an opaque surface, never on transparency.
 * The selected mode card keeps the canonical .is-selected wash from list.css. */
.settings-page .settings-list__row,
.settings-page .custom-temperature-panel,
.settings-page .about-info,
.settings-page .about-features,
.settings-page .mode-card:not(.is-selected) {
  background: var(--anth-surface-raised);
}

.mode-copy { display: grid; gap: 2px; min-width: 0; }
.mode-name { font-weight: var(--anth-weight-medium); }
.mode-desc,
.mode-temp { color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); }
.mode-temp { font-variant-numeric: tabular-nums; }
.custom-temperature-panel { display: grid; gap: var(--anth-space-4); }

.settings-savebar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-3);
  padding-top: var(--anth-space-3);
  border-top: 1px solid var(--anth-rule);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.settings-savebar > div { display: grid; gap: 2px; }
.check-label { display: inline-flex; align-items: center; gap: var(--anth-space-2); color: var(--anth-ink-soft); font-size: var(--anth-text-small-size); }
.settings-page .settings-number { width: 96px; }

/* Destructive zone inside the data tab: danger-tinted border, danger heading. */
.settings-page .danger-zone {
  margin: var(--anth-space-2) var(--anth-space-6) var(--anth-space-6);
  padding: var(--anth-space-4) var(--anth-space-5);
  border: 1px solid var(--anth-danger-border);
  border-radius: var(--anth-radius-md);
}

.settings-page .danger-zone h3 { color: var(--anth-danger); }

/* About */
.about-identity h2 { margin: 0; }
.version { margin: 2px 0 0; color: var(--anth-ink-muted); font-size: var(--anth-text-small-size); font-variant-numeric: tabular-nums; }
.about-info { display: grid; border-top: 1.5px solid var(--anth-rule-heavy); border-bottom: 1.5px solid var(--anth-rule-heavy); }
.about-features h3 { margin: 0 0 var(--anth-space-2); }

.about-features ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--anth-text-small-size);
}

.about-features li span { display: inline-block; min-width: 3em; margin-right: var(--anth-space-3); color: var(--anth-ink-muted); }

.settings-page .update-progress {
  width: 100%;
  height: 4px;
  margin: var(--anth-space-2) 0;
  accent-color: var(--anth-accent);
}

@media (max-width: 900px) {
  .settings-layout { grid-template-columns: minmax(0, 1fr); gap: var(--anth-space-4); }

  .settings-page .settings-rail.tabs.is-vertical {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--anth-rule);
  }
}

@media (max-width: 640px) {
  .settings-form-grid,
  .custom-temperature-grid { grid-template-columns: minmax(0, 1fr); }
  .info-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
</style>
