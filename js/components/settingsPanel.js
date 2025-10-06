/**
 * 设置面板组件
 * 提供统一的设置界面，包括主题、无障碍、快捷键等设置
 */
class SettingsPanel {
    constructor() {
        this.isVisible = false;
        this.settings = this.loadSettings();

        // 全局引用，供事件委托使用
        window.settingsPanel = this;

        this.init();
    }
    
    async init() {
        this.settings = await this.loadSettings();
        this.createSettingsButton();
        this.setupEventListeners();
    }
    
    /**
     * 加载设置
     */
    async loadSettings() {
        const themeSettings = await window.storage?.get('theme_settings', {});
        return {
            theme: await window.storage?.get('current_theme', 'light'),
            fontSize: themeSettings.fontSize || 'normal',
            reduceMotion: themeSettings.reduceMotion || false,
            highContrast: themeSettings.highContrast || false,
            autoTheme: themeSettings.autoTheme || true,
            keyboardShortcuts: await window.storage?.get('keyboard_shortcuts_enabled', true),
            soundEffects: await window.storage?.get('sound_effects_enabled', false),
            autoSave: await window.storage?.get('auto_save_enabled', true),
            notifications: await window.storage?.get('notifications_enabled', true)
        };
    }
    
    /**
     * 保存设置
     */
    async saveSettings() {
        if (window.storage) {
            await window.storage.set('keyboard_shortcuts_enabled', this.settings.keyboardShortcuts);
            await window.storage.set('sound_effects_enabled', this.settings.soundEffects);
            await window.storage.set('auto_save_enabled', this.settings.autoSave);
            await window.storage.set('notifications_enabled', this.settings.notifications);
        }
    }
    
    /**
     * 创建设置按钮
     */
    createSettingsButton() {
        const settingsButton = document.createElement('button');
        settingsButton.className = 'settings-button';
        settingsButton.innerHTML = '⚙️';
        settingsButton.title = '系统设置 (Ctrl+Shift+S)';
        settingsButton.setAttribute('aria-label', '打开系统设置');
        
        // 设置按钮点击已通过事件委托处理
        
        // 添加到页面
        document.body.appendChild(settingsButton);
        
        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .settings-button {
                position: fixed;
                bottom: 140px;
                right: 20px;
                width: 45px;
                height: 45px;
                border-radius: 50%;
                background: var(--accent-color);
                color: white;
                border: none;
                font-size: 18px;
                cursor: pointer;
                box-shadow: var(--shadow-md);
                z-index: 998;
                transition: all 0.3s ease;
            }
            
            .settings-button:hover {
                background: var(--primary-color);
                transform: scale(1.1);
            }
            
            .settings-button:focus {
                outline: 2px solid var(--primary-color);
                outline-offset: 2px;
            }
            
            @media (max-width: 768px) {
                .settings-button {
                    bottom: 125px;
                    right: 15px;
                    width: 40px;
                    height: 40px;
                    font-size: 16px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 设置按钮点击
            window.DOM.delegate('click', '.settings-button', function(e) {
                window.settingsPanel.show();
            });

            // 模态框事件
            window.DOM.delegate('click', '.modal-close', function(e) {
                window.settingsPanel.hide();
            });

            window.DOM.delegate('click', '.settings-overlay', function(e) {
                if (e.target === this) {
                    window.settingsPanel.hide();
                }
            });

            // 标签切换
            window.DOM.delegate('click', '.settings-tab', function(e) {
                window.settingsPanel.switchTab(this.dataset.tab);
            });

            // 键盘快捷键（必须使用document.addEventListener，因为DOM.delegate不支持document作为selector）
            document.addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                    e.preventDefault();
                    window.settingsPanel.toggle();
                }

                if (e.key === 'Escape' && window.settingsPanel.isVisible) {
                    window.settingsPanel.hide();
                }
            });

            // 设置项变化事件
            window.DOM.delegate('change', '#theme-select', function(e) {
                window.settingsPanel.updateSetting('theme', this.value);
            });

            window.DOM.delegate('change', '#auto-theme-toggle', function(e) {
                window.settingsPanel.updateSetting('autoTheme', this.checked);
            });

            window.DOM.delegate('change', '#font-size-select', function(e) {
                window.settingsPanel.updateSetting('fontSize', this.value);
            });

            window.DOM.delegate('change', '#high-contrast-toggle', function(e) {
                window.settingsPanel.updateSetting('highContrast', this.checked);
            });

            window.DOM.delegate('change', '#reduce-motion-toggle', function(e) {
                window.settingsPanel.updateSetting('reduceMotion', this.checked);
            });

            window.DOM.delegate('change', '#keyboard-shortcuts-toggle', function(e) {
                window.settingsPanel.updateSetting('keyboardShortcuts', this.checked);
            });

            window.DOM.delegate('click', '#view-shortcuts-btn', function(e) {
                window.settingsPanel.showKeyboardShortcuts();
            });

            // 声音设置
            window.DOM.delegate('change', '#sound-effects-toggle', function(e) {
                window.settingsPanel.updateSetting('soundEffects', this.checked);
            });

            window.DOM.delegate('change', '#notifications-toggle', function(e) {
                window.settingsPanel.updateSetting('notifications', this.checked);
            });

            window.DOM.delegate('change', '#auto-save-toggle', function(e) {
                window.settingsPanel.updateSetting('autoSave', this.checked);
            });

            // 数据管理按钮
            window.DOM.delegate('click', '#data-management-btn', function(e) {
                window.settingsPanel.openDataManagement();
            });

            window.DOM.delegate('click', '#library-loader-btn', function(e) {
                window.settingsPanel.openLibraryLoader();
            });

            window.DOM.delegate('click', '#system-maintenance-btn', function(e) {
                window.settingsPanel.openSystemMaintenance();
            });

            window.DOM.delegate('click', '#clear-data-btn', function(e) {
                window.settingsPanel.clearAllData();
            });

            window.DOM.delegate('click', '#reset-tutorials-btn', function(e) {
                window.settingsPanel.resetTutorials();
            });

            window.DOM.delegate('click', '#show-tutorials-btn', function(e) {
                window.settingsPanel.showTutorials();
            });

            // 关于页面按钮
            window.DOM.delegate('click', '#reset-settings-btn', function(e) {
                window.settingsPanel.resetSettings();
            });

            window.DOM.delegate('click', '#export-settings-btn', function(e) {
                window.settingsPanel.exportSettings();
            });

            window.DOM.delegate('click', '#save-settings-btn', async function(e) {
                await window.settingsPanel.saveSettings();
                window.settingsPanel.showMessage('设置已保存', 'success');
            });

            console.log('[SettingsPanel] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                    e.preventDefault();
                    this.toggle();
                }

                if (e.key === 'Escape' && this.isVisible) {
                    this.hide();
                }
            });
        }
    }
    
    /**
     * 显示设置面板
     */
    show() {
        if (this.isVisible) return;
        
        this.createSettingsModal();
        this.isVisible = true;
        
        // 聚焦到设置模态框
        setTimeout(() => {
            const modal = document.querySelector('.settings-modal');
            if (modal) {
                modal.focus();
            }
        }, 100);
    }
    
    /**
     * 隐藏设置面板
     */
    hide() {
        const overlay = document.querySelector('.settings-overlay');
        if (overlay) {
            overlay.remove();
        }
        this.isVisible = false;
    }
    
    /**
     * 切换设置面板显示状态
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    /**
     * 创建设置模态框
     */
    createSettingsModal() {
        const overlay = document.createElement('div');
        overlay.className = 'settings-overlay modal-overlay show';
        
        const modal = document.createElement('div');
        modal.className = 'settings-modal modal';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'settings-title');
        
        modal.innerHTML = `
            <div class="modal-header">
                <h2 id="settings-title">系统设置</h2>
                <button class="modal-close" aria-label="关闭设置">×</button>
            </div>
            <div class="modal-body">
                ${this.createSettingsContent()}
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline reset-settings">重置为默认</button>
                <button class="btn btn-secondary export-settings">导出设置</button>
                <button class="btn btn-primary save-settings">保存设置</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // 设置事件监听器
        this.setupModalEvents(overlay, modal);
    }
    
    /**
     * 创建设置内容
     */
    createSettingsContent() {
        return `
            <div class="settings-tabs">
                <button class="settings-tab active" data-tab="appearance">外观设置</button>
                <button class="settings-tab" data-tab="accessibility">无障碍</button>
                <button class="settings-tab" data-tab="interaction">交互设置</button>
                <button class="settings-tab" data-tab="advanced">高级设置</button>
            </div>
            
            <div class="settings-content">
                <div class="settings-tab-content active" id="appearance-settings">
                    <div class="settings-section">
                        <h4>主题设置</h4>
                        <div class="settings-item">
                            <label>主题选择</label>
                            <select id="theme-select" class="settings-select">
                                <option value="light" ${this.settings.theme === 'light' ? 'selected' : ''}>浅色主题</option>
                                <option value="dark" ${this.settings.theme === 'dark' ? 'selected' : ''}>深色主题</option>
                                <option value="highContrast" ${this.settings.theme === 'highContrast' ? 'selected' : ''}>高对比度</option>
                            </select>
                        </div>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="auto-theme" ${this.settings.autoTheme ? 'checked' : ''}>
                                <span>自动跟随系统主题</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>字体设置</h4>
                        <div class="settings-item">
                            <label>字体大小</label>
                            <select id="font-size-select" class="settings-select">
                                <option value="small" ${this.settings.fontSize === 'small' ? 'selected' : ''}>小</option>
                                <option value="normal" ${this.settings.fontSize === 'normal' ? 'selected' : ''}>正常</option>
                                <option value="large" ${this.settings.fontSize === 'large' ? 'selected' : ''}>大</option>
                                <option value="extra-large" ${this.settings.fontSize === 'extra-large' ? 'selected' : ''}>特大</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="settings-tab-content" id="accessibility-settings">
                    <div class="settings-section">
                        <h4>视觉辅助</h4>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="high-contrast" ${this.settings.highContrast ? 'checked' : ''}>
                                <span>高对比度模式</span>
                            </label>
                            <p class="settings-description">提供更清晰的视觉对比，适合视力较弱的用户</p>
                        </div>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="reduce-motion" ${this.settings.reduceMotion ? 'checked' : ''}>
                                <span>减少动画效果</span>
                            </label>
                            <p class="settings-description">减少页面动画，适合对动画敏感的用户</p>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>键盘导航</h4>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="keyboard-navigation" checked>
                                <span>启用键盘导航增强</span>
                            </label>
                            <p class="settings-description">增强焦点指示器和键盘导航体验</p>
                        </div>
                    </div>
                </div>
                
                <div class="settings-tab-content" id="interaction-settings">
                    <div class="settings-section">
                        <h4>快捷键设置</h4>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="keyboard-shortcuts" ${this.settings.keyboardShortcuts ? 'checked' : ''}>
                                <span>启用键盘快捷键</span>
                            </label>
                            <p class="settings-description">使用 Ctrl+H 查看所有可用快捷键</p>
                        </div>
                        <div class="settings-item">
                            <button class="btn btn-outline" id="view-shortcuts">查看快捷键列表</button>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>反馈设置</h4>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="sound-effects" ${this.settings.soundEffects ? 'checked' : ''}>
                                <span>启用音效反馈</span>
                            </label>
                        </div>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="notifications" ${this.settings.notifications ? 'checked' : ''}>
                                <span>启用通知提醒</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="settings-tab-content" id="advanced-settings">
                    <div class="settings-section">
                        <h4>数据设置</h4>
                        <div class="settings-item">
                            <label class="settings-checkbox">
                                <input type="checkbox" id="auto-save" ${this.settings.autoSave ? 'checked' : ''}>
                                <span>自动保存进度</span>
                            </label>
                        </div>
                        <div class="settings-item">
                            <button class="btn btn-primary" id="data-management">数据管理</button>
                            <p class="settings-description">导入导出、备份恢复练习数据</p>
                        </div>
                        <div class="settings-item">
                            <button class="btn" id="library-loader">加载题库</button>
                            <p class="settings-description">阅读/听力题库全量重载与增量更新</p>
                        </div>
                        <div class="settings-item">
                            <button class="btn btn-secondary" id="system-maintenance">系统维护</button>
                            <p class="settings-description">系统诊断、性能监控和维护工具</p>
                        </div>
                        <div class="settings-item">
                            <button class="btn btn-outline" id="clear-data">清除所有数据</button>
                            <p class="settings-description">这将删除所有练习记录和设置</p>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>教程设置</h4>
                        <div class="settings-item">
                            <button class="btn btn-outline" id="reset-tutorials">重置教程进度</button>
                            <p class="settings-description">重新显示所有教程</p>
                        </div>
                        <div class="settings-item">
                            <button class="btn btn-outline" id="show-tutorials">选择教程</button>
                        </div>
                    </div>
                    
                    <div class="settings-section">
                        <h4>系统信息</h4>
                        <div class="settings-item">
                            <div class="system-info">
                                <p><strong>浏览器：</strong> ${navigator.userAgent.split(' ')[0]}</p>
                                <p><strong>版本：</strong> 1.0.0</p>
                                <p><strong>存储使用：</strong> <span id="storage-usage">计算中...</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * 设置模态框事件监听器
     */
    setupModalEvents(overlay, modal) {
        // 模态框事件已通过事件委托处理

        // 设置项事件已通过事件委托处理

        // 计算存储使用量
        this.calculateStorageUsage();
    }
    
    /**
     * 切换标签
     */
    switchTab(tabName) {
        // 更新标签状态
        const tabs = document.querySelectorAll('.settings-tab');
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        
        // 更新内容显示
        const contents = document.querySelectorAll('.settings-tab-content');
        contents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-settings`);
        });
    }
    
    /**
     * 设置设置项事件监听器
     */
    setupSettingsEvents(modal) {
        // 主题选择
        const themeSelect = modal.querySelector('#theme-select');
        if (themeSelect) {
            themeSelect.addEventListener('change', (e) => {
                if (window.app?.themeManager) {
                    window.app.themeManager.setTheme(e.target.value);
                }
            });
        }
        
        // 自动主题
        const autoThemeToggle = modal.querySelector('#auto-theme');
        if (autoThemeToggle) {
            autoThemeToggle.addEventListener('change', (e) => {
                if (window.app?.themeManager) {
                    window.app.themeManager.toggleAutoTheme();
                }
            });
        }
        
        // 字体大小
        const fontSizeSelect = modal.querySelector('#font-size-select');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                if (window.app?.themeManager) {
                    window.app.themeManager.setFontSize(e.target.value);
                }
            });
        }
        
        // 高对比度
        const highContrastToggle = modal.querySelector('#high-contrast');
        if (highContrastToggle) {
            highContrastToggle.addEventListener('change', (e) => {
                if (window.app?.themeManager) {
                    window.app.themeManager.toggleHighContrast();
                }
            });
        }
        
        // 减少动画
        const reduceMotionToggle = modal.querySelector('#reduce-motion');
        if (reduceMotionToggle) {
            reduceMotionToggle.addEventListener('change', (e) => {
                if (window.app?.themeManager) {
                    window.app.themeManager.toggleReduceMotion();
                }
            });
        }
        
        // 键盘快捷键
        const keyboardShortcutsToggle = modal.querySelector('#keyboard-shortcuts');
        if (keyboardShortcutsToggle) {
            keyboardShortcutsToggle.addEventListener('change', (e) => {
                this.settings.keyboardShortcuts = e.target.checked;
                if (window.app?.keyboardShortcuts) {
                    if (e.target.checked) {
                        window.app.keyboardShortcuts.enable();
                    } else {
                        window.app.keyboardShortcuts.disable();
                    }
                }
            });
        }
        
        // 查看快捷键
        const viewShortcutsBtn = modal.querySelector('#view-shortcuts');
        if (viewShortcutsBtn) {
            viewShortcutsBtn.addEventListener('click', () => {
                if (window.app?.keyboardShortcuts) {
                    window.app.keyboardShortcuts.showShortcutsModal();
                }
            });
        }
        
        // 其他设置
        const soundEffectsToggle = modal.querySelector('#sound-effects');
        if (soundEffectsToggle) {
            soundEffectsToggle.addEventListener('change', (e) => {
                this.settings.soundEffects = e.target.checked;
            });
        }
        
        const notificationsToggle = modal.querySelector('#notifications');
        if (notificationsToggle) {
            notificationsToggle.addEventListener('change', (e) => {
                this.settings.notifications = e.target.checked;
            });
        }
        
        const autoSaveToggle = modal.querySelector('#auto-save');
        if (autoSaveToggle) {
            autoSaveToggle.addEventListener('change', (e) => {
                this.settings.autoSave = e.target.checked;
            });
        }
        
        // 数据管理
        const dataManagementBtn = modal.querySelector('#data-management');
        if (dataManagementBtn) {
            dataManagementBtn.addEventListener('click', () => {
                this.hide();
                if (window.dataManagementPanel) {
                    window.dataManagementPanel.show();
                }
            });
        }

        this.calculateStorageUsage();  // Call the async method

        // 加载题库
        const libraryLoaderBtn = modal.querySelector('#library-loader');
        if (libraryLoaderBtn) {
            libraryLoaderBtn.addEventListener('click', () => {
                this.hide();
                if (window.showLibraryLoaderModal) {
                    window.showLibraryLoaderModal();
                } else if (window.showMessage) {
                    window.showMessage('加载题库功能尚未初始化', 'warning');
                }
            });
        }
        
        // 系统维护
        const systemMaintenanceBtn = modal.querySelector('#system-maintenance');
        if (systemMaintenanceBtn) {
            systemMaintenanceBtn.addEventListener('click', () => {
                this.hide();
                if (window.systemMaintenancePanel) {
                    window.systemMaintenancePanel.show();
                }
            });
        }
        
        // 清除数据
        const clearDataBtn = modal.querySelector('#clear-data');
        if (clearDataBtn) {
            clearDataBtn.addEventListener('click', () => {
                this.confirmClearData();
            });
        }
        
        // 重置教程
        const resetTutorialsBtn = modal.querySelector('#reset-tutorials');
        if (resetTutorialsBtn) {
            resetTutorialsBtn.addEventListener('click', () => {
                if (window.app?.tutorialSystem) {
                    window.app.tutorialSystem.resetTutorialProgress();
                }
            });
        }
        
        // 显示教程
        const showTutorialsBtn = modal.querySelector('#show-tutorials');
        if (showTutorialsBtn) {
            showTutorialsBtn.addEventListener('click', () => {
                if (window.app?.tutorialSystem) {
                    this.hide();
                    window.app.tutorialSystem.showTutorialSelector();
                }
            });
        }
        
        // 底部按钮
        const resetBtn = modal.querySelector('.reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetToDefaults();
            });
        }
        
        const exportBtn = modal.querySelector('.export-settings');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportSettings();
            });
        }
        
        const saveBtn = modal.querySelector('.save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                await this.saveSettings();
                this.hide();
                if (window.showMessage) {
                    window.showMessage('设置已保存', 'success');
                }
            });
        }
    }
    
    /**
     * 计算存储使用量
     */
    calculateStorageUsage() {
        setTimeout(() => {
            const usageElement = document.querySelector('#storage-usage');
            if (usageElement) {
                try {
                    let totalSize = 0;
                    for (let key in localStorage) {
                        if (localStorage.hasOwnProperty(key)) {
                            totalSize += localStorage[key].length;
                        }
                    }
                    
                    const sizeInKB = (totalSize / 1024).toFixed(2);
                    usageElement.textContent = `${sizeInKB} KB`;
                } catch (error) {
                    usageElement.textContent = '无法计算';
                }
            }
        }, 100);
    }
    
    /**
     * 确认清除数据
     */
    async confirmClearData() {
        const confirmed = confirm('确定要清除所有数据吗？这个操作无法撤销。');
        if (confirmed) {
            try {
                if (window.storage && typeof window.storage.clear === 'function') {
                    await window.storage.clear();
                } else {
                    localStorage.clear();
                }
                if (window.showMessage) {
                    window.showMessage('所有数据已清除', 'info');
                }
                // 刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } catch (error) {
                if (window.showMessage) {
                    window.showMessage('清除数据失败', 'error');
                }
            }
        }
    }
    
    /**
     * 重置为默认设置
     */
    resetToDefaults() {
        const confirmed = confirm('确定要重置所有设置为默认值吗？');
        if (confirmed) {
            // 重置主题管理器
            if (window.app?.themeManager) {
                window.app.themeManager.resetToDefaults();
            }
            
            // 重置其他设置
            this.settings = {
                theme: 'light',
                fontSize: 'normal',
                reduceMotion: false,
                highContrast: false,
                autoTheme: true,
                keyboardShortcuts: true,
                soundEffects: false,
                autoSave: true,
                notifications: true
            };
            
            this.saveSettings();
            this.hide();
            
            if (window.showMessage) {
                window.showMessage('设置已重置为默认值', 'info');
            }
        }
    }
    
    /**
     * 计算存储使用量
     */
    async calculateStorageUsage() {
        setTimeout(async () => {
            const usageElement = document.querySelector('#storage-usage');
            if (usageElement) {
                try {
                    let totalSize = 0;
                    if (window.storage && typeof window.storage.keys === 'function') {
                        const keys = await window.storage.keys();
                        for (const key of keys) {
                            const value = await window.storage.get(key);
                            totalSize += JSON.stringify(value).length;
                        }
                    } else {
                        // Fallback to localStorage
                        for (let i = 0; i < localStorage.length; i++) {
                            const key = localStorage.key(i);
                            if (key) {
                                totalSize += localStorage.getItem(key).length;
                            }
                        }
                    }
                    
                    const sizeInKB = (totalSize / 1024).toFixed(2);
                    usageElement.textContent = `${sizeInKB} KB`;
                } catch (error) {
                    usageElement.textContent = '无法计算';
                }
            }
        }, 100);
    }
    /**
     * 导出设置
     */
    async exportSettings() {
        const allSettings = {
            theme: await window.storage?.get('current_theme'),
            themeSettings: await window.storage?.get('theme_settings'),
            appSettings: this.settings,
            exportDate: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(allSettings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json; charset=utf-8' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `exam-system-settings-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        if (window.showMessage) {
            window.showMessage('设置已导出', 'success');
        }
    }
}
