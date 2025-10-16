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
        settingsButton.textContent = '⚙️';
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

    getDomBuilder() {
        if (!this.domBuilder) {
            if (window.DOMBuilder && typeof window.DOMBuilder.create === 'function') {
                this.domBuilder = window.DOMBuilder;
            } else if (window.DOM && window.DOM.builder) {
                this.domBuilder = window.DOM.builder;
            } else {
                this.domBuilder = {
                    create: (tag, attributes = {}, children = []) => {
                        const element = document.createElement(tag);
                        Object.entries(attributes).forEach(([key, value]) => {
                            if (key === 'className') {
                                element.className = value;
                            } else if (key === 'dataset') {
                                Object.assign(element.dataset, value);
                            } else if (key === 'text') {
                                element.textContent = value;
                            } else {
                                element.setAttribute(key, value);
                            }
                        });
                        const childArray = Array.isArray(children) ? children : [children];
                        childArray.forEach(child => {
                            if (child == null) return;
                            if (typeof child === 'string') {
                                element.appendChild(document.createTextNode(child));
                            } else {
                                element.appendChild(child);
                            }
                        });
                        return element;
                    }
                };
            }
        }
        return this.domBuilder;
    }

    createSection(builder, title, items) {
        return builder.create('div', { className: 'settings-section' }, [
            builder.create('h4', {}, title),
            ...items
        ]);
    }

    createCheckboxItem(builder, { id, label, checked, description }) {
        const inputAttributes = { type: 'checkbox', id };
        if (checked) {
            inputAttributes.checked = 'checked';
        }
        const contents = [
            builder.create('label', { className: 'settings-checkbox' }, [
                builder.create('input', inputAttributes),
                builder.create('span', {}, label)
            ])
        ];
        if (description) {
            contents.push(builder.create('p', { className: 'settings-description' }, description));
        }
        return builder.create('div', { className: 'settings-item' }, contents);
    }

    createSelectItem(builder, { id, label, options, selected }) {
        const optionNodes = options.map(option => {
            const attrs = { value: option.value };
            if (option.value === selected) {
                attrs.selected = 'selected';
            }
            return builder.create('option', attrs, option.label);
        });
        return builder.create('div', { className: 'settings-item' }, [
            builder.create('label', {}, label),
            builder.create('select', { id, className: 'settings-select' }, optionNodes)
        ]);
    }

    createButtonItem(builder, { id, text, className, description }) {
        const button = builder.create('button', { id, className }, text);
        const contents = [button];
        if (description) {
            contents.push(builder.create('p', { className: 'settings-description' }, description));
        }
        return builder.create('div', { className: 'settings-item' }, contents);
    }

    buildTabs(builder) {
        const tabs = [
            { key: 'appearance', label: '外观设置', active: true },
            { key: 'accessibility', label: '无障碍' },
            { key: 'interaction', label: '交互设置' },
            { key: 'advanced', label: '高级设置' }
        ];
        const tabButtons = tabs.map(tab => builder.create('button', {
            className: `settings-tab${tab.active ? ' active' : ''}`,
            dataset: { tab: tab.key }
        }, tab.label));
        return builder.create('div', { className: 'settings-tabs' }, tabButtons);
    }

    buildAppearanceTab(builder) {
        const themeOptions = [
            { value: 'xiaodaidai', label: '小呆呆控制台' },
            { value: 'light', label: '浅色主题' },
            { value: 'dark', label: '深色主题' },
            { value: 'highContrast', label: '高对比度' }
        ];
        const fontOptions = [
            { value: 'small', label: '小' },
            { value: 'normal', label: '正常' },
            { value: 'large', label: '大' },
            { value: 'extra-large', label: '特大' }
        ];

        return builder.create('div', { className: 'settings-tab-content active', id: 'appearance-settings' }, [
            this.createSection(builder, '主题设置', [
                this.createSelectItem(builder, {
                    id: 'theme-select',
                    label: '主题选择',
                    options: themeOptions,
                    selected: this.settings.theme
                }),
                this.createCheckboxItem(builder, {
                    id: 'auto-theme-toggle',
                    label: '自动跟随系统主题',
                    checked: this.settings.autoTheme
                })
            ]),
            this.createSection(builder, '字体设置', [
                this.createSelectItem(builder, {
                    id: 'font-size-select',
                    label: '字体大小',
                    options: fontOptions,
                    selected: this.settings.fontSize
                })
            ])
        ]);
    }

    buildAccessibilityTab(builder) {
        return builder.create('div', { className: 'settings-tab-content', id: 'accessibility-settings' }, [
            this.createSection(builder, '视觉辅助', [
                this.createCheckboxItem(builder, {
                    id: 'high-contrast-toggle',
                    label: '高对比度模式',
                    checked: this.settings.highContrast,
                    description: '提供更清晰的视觉对比，适合视力较弱的用户'
                }),
                this.createCheckboxItem(builder, {
                    id: 'reduce-motion-toggle',
                    label: '减少动画效果',
                    checked: this.settings.reduceMotion,
                    description: '减少页面动画，适合对动画敏感的用户'
                })
            ]),
            this.createSection(builder, '键盘导航', [
                this.createCheckboxItem(builder, {
                    id: 'keyboard-navigation-toggle',
                    label: '启用键盘导航增强',
                    checked: true,
                    description: '增强焦点指示器和键盘导航体验'
                })
            ])
        ]);
    }

    buildInteractionTab(builder) {
        return builder.create('div', { className: 'settings-tab-content', id: 'interaction-settings' }, [
            this.createSection(builder, '快捷键设置', [
                this.createCheckboxItem(builder, {
                    id: 'keyboard-shortcuts-toggle',
                    label: '启用键盘快捷键',
                    checked: this.settings.keyboardShortcuts,
                    description: '使用 Ctrl+H 查看所有可用快捷键'
                }),
                this.createButtonItem(builder, {
                    id: 'view-shortcuts-btn',
                    text: '查看快捷键列表',
                    className: 'btn btn-outline'
                })
            ]),
            this.createSection(builder, '反馈设置', [
                this.createCheckboxItem(builder, {
                    id: 'sound-effects-toggle',
                    label: '启用音效反馈',
                    checked: this.settings.soundEffects
                }),
                this.createCheckboxItem(builder, {
                    id: 'notifications-toggle',
                    label: '启用通知提醒',
                    checked: this.settings.notifications
                })
            ])
        ]);
    }

    buildAdvancedTab(builder) {
        const systemInfo = builder.create('div', { className: 'system-info' }, [
            builder.create('p', {}, [
                builder.create('strong', {}, '浏览器：'),
                ` ${navigator.userAgent.split(' ')[0]}`
            ]),
            builder.create('p', {}, [
                builder.create('strong', {}, '版本：'),
                ' 1.0.0'
            ]),
            builder.create('p', {}, [
                builder.create('strong', {}, '存储使用：'),
                builder.create('span', { id: 'storage-usage' }, '计算中...')
            ])
        ]);

        return builder.create('div', { className: 'settings-tab-content', id: 'advanced-settings' }, [
            this.createSection(builder, '数据设置', [
                this.createCheckboxItem(builder, {
                    id: 'auto-save-toggle',
                    label: '自动保存进度',
                    checked: this.settings.autoSave
                }),
                this.createButtonItem(builder, {
                    id: 'data-management-btn',
                    text: '数据管理',
                    className: 'btn btn-primary',
                    description: '导入导出、备份恢复练习数据'
                }),
                this.createButtonItem(builder, {
                    id: 'library-loader-btn',
                    text: '加载题库',
                    className: 'btn',
                    description: '阅读/听力题库全量重载与增量更新'
                }),
                this.createButtonItem(builder, {
                    id: 'system-maintenance-btn',
                    text: '系统维护',
                    className: 'btn btn-secondary',
                    description: '系统诊断、性能监控和维护工具'
                }),
                this.createButtonItem(builder, {
                    id: 'clear-data-btn',
                    text: '清除所有数据',
                    className: 'btn btn-outline',
                    description: '这将删除所有练习记录和设置'
                })
            ]),
            this.createSection(builder, '教程设置', [
                this.createButtonItem(builder, {
                    id: 'reset-tutorials-btn',
                    text: '重置教程进度',
                    className: 'btn btn-outline',
                    description: '重新显示所有教程'
                }),
                this.createButtonItem(builder, {
                    id: 'show-tutorials-btn',
                    text: '选择教程',
                    className: 'btn btn-outline'
                })
            ]),
            this.createSection(builder, '系统信息', [
                builder.create('div', { className: 'settings-item' }, [systemInfo])
            ])
        ]);
    }
    
    /**
     * 创建设置模态框
     */
    createSettingsModal() {
        const builder = this.getDomBuilder();
        const overlay = builder.create('div', { className: 'settings-overlay modal-overlay show' });
        const modal = builder.create('div', {
            className: 'settings-modal modal',
            tabindex: '-1',
            role: 'dialog',
            'aria-labelledby': 'settings-title'
        });

        const header = builder.create('div', { className: 'modal-header' }, [
            builder.create('h2', { id: 'settings-title' }, '系统设置'),
            builder.create('button', { className: 'modal-close', 'aria-label': '关闭设置' }, '×')
        ]);

        const body = builder.create('div', { className: 'modal-body' }, this.createSettingsContent(builder));

        const footer = builder.create('div', { className: 'modal-footer' }, [
            builder.create('button', { className: 'btn btn-outline', id: 'reset-settings-btn' }, '重置为默认'),
            builder.create('button', { className: 'btn btn-secondary', id: 'export-settings-btn' }, '导出设置'),
            builder.create('button', { className: 'btn btn-primary', id: 'save-settings-btn' }, '保存设置')
        ]);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        this.setupModalEvents(overlay, modal);
    }

    /**
     * 创建设置内容
     */
    createSettingsContent(builder) {
        const tabs = this.buildTabs(builder);
        const content = builder.create('div', { className: 'settings-content' }, [
            this.buildAppearanceTab(builder),
            this.buildAccessibilityTab(builder),
            this.buildInteractionTab(builder),
            this.buildAdvancedTab(builder)
        ]);
        return [tabs, content];
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
        const settingsContainer = modal.querySelector('.modal-body'); // 假设所有设置项都在.modal-body内
        if (!settingsContainer) return;

        const handleChange = (e) => {
            const target = e.target;
            if (!target) return;

            const id = target.id;
            const themeManager = window.app?.themeManager;
            const keyboardShortcuts = window.app?.keyboardShortcuts;

            switch (id) {
                case 'theme-select':
                    themeManager?.setTheme(target.value);
                    break;
                case 'auto-theme-toggle':
                    themeManager?.toggleAutoTheme();
                    break;
                case 'font-size-select':
                    themeManager?.setFontSize(target.value);
                    break;
                case 'high-contrast-toggle':
                    themeManager?.toggleHighContrast();
                    break;
                case 'reduce-motion-toggle':
                    themeManager?.toggleReduceMotion();
                    break;
                case 'keyboard-shortcuts-toggle':
                    this.settings.keyboardShortcuts = target.checked;
                    if (keyboardShortcuts) {
                        target.checked ? keyboardShortcuts.enable() : keyboardShortcuts.disable();
                    }
                    break;
                case 'sound-effects-toggle':
                    this.settings.soundEffects = target.checked;
                    break;
                case 'notifications-toggle':
                    this.settings.notifications = target.checked;
                    break;
                case 'auto-save-toggle':
                    this.settings.autoSave = target.checked;
                    break;
            }
        };

        const handleClick = (e) => {
            const target = e.target;
            if (!target) return;

            const id = target.id;

            switch (id) {
                case 'view-shortcuts-btn':
                    window.app?.keyboardShortcuts?.showShortcutsModal();
                    break;
                case 'data-management-btn':
                    this.hide();
                    if (window.dataManagementPanel) {
                        window.dataManagementPanel.show();
                    }
                    break;
                case 'library-loader-btn':
                    this.hide();
                    if (window.showLibraryLoaderModal) {
                        window.showLibraryLoaderModal();
                    } else if (window.showMessage) {
                        window.showMessage('加载题库功能尚未初始化', 'warning');
                    }
                    break;
                case 'system-maintenance-btn':
                    this.hide();
                    if (window.systemMaintenancePanel) {
                        window.systemMaintenancePanel.show();
                    }
                    break;
                case 'clear-data-btn':
                    this.confirmClearData();
                    break;
                case 'reset-tutorials-btn':
                    if (window.app?.tutorialSystem) {
                        window.app.tutorialSystem.resetTutorialProgress();
                    }
                    break;
                case 'show-tutorials-btn':
                    if (window.app?.tutorialSystem) {
                        this.hide();
                        window.app.tutorialSystem.showTutorialSelector();
                    }
                    break;
                case 'reset-settings-btn':
                    this.resetToDefaults();
                    break;
                case 'export-settings-btn':
                    this.exportSettings();
                    break;
                case 'save-settings-btn':
                    (async () => {
                        await this.saveSettings();
                        this.hide();
                        if (window.showMessage) {
                            window.showMessage('设置已保存', 'success');
                        }
                    })();
                    break;
            }
        };

        // 使用统一的事件委托
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            window.DOM.delegate('change', '.modal-body', handleChange);
            window.DOM.delegate('click', '.modal-body', handleClick);
        } else {
            // Fallback: 仍然需要为每个元素添加监听器，但逻辑是集中的
            settingsContainer.addEventListener('change', handleChange);
            settingsContainer.addEventListener('click', handleClick);
        }

        this.calculateStorageUsage();
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
