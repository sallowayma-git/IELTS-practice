// SettingsPanel.js - UI panel for system settings display
// Coordinates with SettingsActions, renders system info
// Inherits from BaseComponent, handles store integration

// BaseComponent 兜底处理 (Task 74)
if (!window.BaseComponent) {
    window.BaseComponent = class {
        constructor() { this.subscriptions = []; }
        attach() {}
        detach() { this.subscriptions.forEach(u => u()); }
        render() {}
        addSubscription(u) { this.subscriptions.push(u); }
        addEventListener() {}
        setupEventListeners() {}
        subscribeToStores() {}
        cleanupEventListeners() {}
        unsubscribeFromStores() {}
    };
    console.warn('[SettingsPanel] BaseComponent missing, using fallback');
}

// UI子组件兜底处理 (Task 81)
if (!window.SettingsActions) {
    window.SettingsActions = class {
        constructor(){}
        attach(){} detach(){}
        rebuildIndexes(){ console.warn('[SettingsActions Stub] rebuildIndexes not available in Safe Mode'); }
        restoreBackup(){ console.warn('[SettingsActions Stub] restoreBackup not available in Safe Mode'); }
        exportData(){ console.warn('[SettingsActions Stub] exportData not available in Safe Mode'); }
        importData(){ console.warn('[SettingsActions Stub] importData not available in Safe Mode'); }
        createManualBackup(){ console.warn('[SettingsActions Stub] createManualBackup not available in Safe Mode'); }
    };
}

class SettingsPanel extends BaseComponent {
    constructor(stores) {
        // Task 101: stores容错处理
        const safeStores = stores || window.App?.stores || {
            exams: { subscribe: () => () => {}, exams: [] },
            app: { subscribe: () => () => {}, addError: () => {} },
            records: { subscribe: () => () => {}, stats: {} }
        };

        // Task 91: 必须先调用super()
        super(safeStores, {
            container: document.getElementById('settings-view'),
            totalExams: document.getElementById('total-exams'),
            htmlExams: document.getElementById('html-exams'),
            pdfExams: document.getElementById('pdf-exams'),
            lastUpdate: document.getElementById('last-update')
        });

        this._failed = false; // Task 82: 错误状态标记
        this._subscriptions = []; // 订阅管理

        // Task 97: 设置视图名称
        this.setViewName('settings');

        try {
            this.actions = null;

            // Safe Mode 跳过昂贵设置 (Task 77)
            this.isSafeMode = window.__SAFE_MODE__ === true;
            if (this.isSafeMode) {
                if (window.__DEBUG__) console.debug('[SettingsPanel] Safe Mode: 跳过自动系统诊断和实时监控');
                this.autoDiagnosticsEnabled = false;
                this.realTimeMonitoringEnabled = false;
            } else {
                this.autoDiagnosticsEnabled = true;
                this.realTimeMonitoringEnabled = true;
            }

            this.checkRequiredElements();
            this.initActions();
        } catch (error) {
            this._failed = true;
            console.error('[SettingsPanel] UI bootstrap failed:', error);
            if (window.ErrorService) {
                window.ErrorService.showWarning('设置界面初始化失败: ' + error.message);
            }
            this.cleanupSubscriptions();
        }
    }

    // Task 82: 清理订阅，防止错误风暴
    cleanupSubscriptions() {
        this._subscriptions.forEach(unsubscribe => {
            try {
                unsubscribe();
            } catch (e) {
                if (window.__DEBUG__) console.debug('[SettingsPanel] Failed to cleanup subscription:', e);
            }
        });
        this._subscriptions = [];
    }

    checkRequiredElements() {
        const required = ['container'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[SettingsPanel] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        if (missing.includes('container')) {
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'settings-view';
            document.body.appendChild(this.elements.container);
        }
        // Create stat elements if missing
        ['totalExams', 'htmlExams', 'pdfExams', 'lastUpdate'].forEach(key => {
            if (!this.elements[key]) {
                this.elements[key] = document.createElement('span');
                this.elements[key].id = key;
                this.elements.container.appendChild(this.elements[key]);
            }
        });
    }

    initActions() {
        this.actions = new SettingsActions(this.stores);
    }

    attach(container) {
        super.attach(container);
        this.actions.attach(this.elements.container);
        this.createButtons();
        this.updateSystemInfo();
    }

    createButtons() {
        if (!this.elements.container) return;

        // 高级功能开关区域 (Task 71)
        const advancedSection = document.createElement('div');
        advancedSection.style.cssText = 'margin: 20px 0; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px;';

        const advancedTitle = document.createElement('h4');
        advancedTitle.textContent = '🔧 高级功能开关';
        advancedTitle.style.cssText = 'margin-bottom: 15px; color: #fff;';
        advancedSection.appendChild(advancedTitle);

        // IndexedDB 开关
        const indexeddbLabel = this.createToggleSwitch(
            'IndexedDB 存储',
            'indexeddb-enabled',
            false, // SAFE_MODE 下默认关闭
            (enabled) => this.toggleIndexedDB(enabled)
        );
        advancedSection.appendChild(indexeddbLabel);

        // 自动备份开关
        const autoBackupLabel = this.createToggleSwitch(
            '自动备份',
            'auto-backup-enabled',
            false, // SAFE_MODE 下默认关闭
            (enabled) => this.toggleAutoBackup(enabled)
        );
        advancedSection.appendChild(autoBackupLabel);

        // 性能诊断开关
        const performanceLabel = this.createToggleSwitch(
            '性能诊断',
            'performance-diagnostics',
            false, // SAFE_MODE 下默认关闭
            (enabled) => this.togglePerformanceDiagnostics(enabled)
        );
        advancedSection.appendChild(performanceLabel);

        // 调试模式开关 (Task 80)
        const debugLabel = this.createToggleSwitch(
            '调试模式',
            'debug-mode',
            window.__DEBUG__ || false,
            (enabled) => this.toggleDebugMode(enabled)
        );
        advancedSection.appendChild(debugLabel);

        // 虚拟滚动开关
        const virtualScrollLabel = this.createToggleSwitch(
            '虚拟滚动',
            'virtual-scrolling',
            false, // SAFE_MODE 下默认关闭
            (enabled) => this.toggleVirtualScrolling(enabled)
        );
        advancedSection.appendChild(virtualScrollLabel);

        this.elements.container.appendChild(advancedSection);

        // 原有按钮
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'margin-top: 20px;';

        // Rebuild Indexes button
        const rebuildBtn = document.createElement('button');
        rebuildBtn.id = 'rebuild-indexes';
        rebuildBtn.textContent = '重建索引';
        rebuildBtn.style.cssText = 'margin: 5px; padding: 8px 16px;';
        rebuildBtn.addEventListener('click', () => this.rebuildIndexes());
        buttonContainer.appendChild(rebuildBtn);

        // Restore Backup button
        const restoreBtn = document.createElement('button');
        restoreBtn.id = 'restore-backup';
        restoreBtn.textContent = '恢复备份';
        restoreBtn.style.cssText = 'margin: 5px; padding: 8px 16px;';
        restoreBtn.addEventListener('click', () => this.restoreBackup());
        buttonContainer.appendChild(restoreBtn);

        this.elements.container.appendChild(buttonContainer);
    }

    createToggleSwitch(labelText, id, defaultValue, onChange) {
        const container = document.createElement('div');
        container.style.cssText = 'margin: 10px 0; display: flex; align-items: center; justify-content: space-between;';

        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.cssText = 'color: #fff; font-weight: 500;';

        const switchContainer = document.createElement('div');
        switchContainer.style.cssText = 'display: flex; align-items: center;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.checked = defaultValue;
        checkbox.style.cssText = 'margin-right: 8px;';

        const status = document.createElement('span');
        status.textContent = defaultValue ? '开启' : '关闭';
        status.style.cssText = 'font-size: 0.9em; color: #aaa;';

        checkbox.addEventListener('change', (e) => {
            status.textContent = e.target.checked ? '开启' : '关闭';
            onChange(e.target.checked);

            // 保存设置到localStorage
            localStorage.setItem(`settings_${id}`, e.target.checked);
        });

        switchContainer.appendChild(checkbox);
        switchContainer.appendChild(status);

        container.appendChild(label);
        container.appendChild(switchContainer);

        // 从localStorage加载设置
        const savedValue = localStorage.getItem(`settings_${id}`);
        if (savedValue !== null) {
            checkbox.checked = savedValue === 'true';
            status.textContent = savedValue === 'true' ? '开启' : '关闭';
        }

        return container;
    }

    toggleIndexedDB(enabled) {
        // Task 103: Safe Mode下禁止中途切回IndexedDB
        if (window.__SAFE_MODE__ && enabled) {
            this.showMessage('Safe Mode下禁止启用IndexedDB以保持系统稳定', 'warning');
            // 确保IndexedDB保持禁用状态
            if (window.storage) {
                window.storage.useIndexedDB = false;
            }
            return;
        }

        console.log(`[Settings] IndexedDB ${enabled ? '启用' : '禁用'}`);
        if (window.storage) {
            window.storage.useIndexedDB = enabled;
            if (enabled) {
                this.showMessage('IndexedDB已启用，刷新页面生效', 'info');
            }
        }
    }

    toggleAutoBackup(enabled) {
        console.log(`[Settings] 自动备份 ${enabled ? '启用' : '禁用'}`);
        if (window.storage) {
            window.storage.useAutoBackup = enabled;
        }
        if (window.dim) {
            if (enabled) {
                window.dim.enableAutoBackup();
            } else {
                window.dim.disableAutoBackup();
            }
        }
    }

    togglePerformanceDiagnostics(enabled) {
        console.log(`[Settings] 性能诊断 ${enabled ? '启用' : '禁用'}`);
        if (enabled && window.App) {
            // 启动性能诊断
            window.App.debugReport();
        }
    }

    toggleVirtualScrolling(enabled) {
        console.log(`[Settings] 虚拟滚动 ${enabled ? '启用' : '禁用'}`);
        // 虚拟滚动功能的启用/禁用逻辑
        this.showMessage('虚拟滚动功能开发中', 'info');
    }

    toggleDebugMode(enabled) {
        console.log(`[Settings] 调试模式 ${enabled ? '启用' : '禁用'}`);
        window.__DEBUG__ = enabled;
        if (enabled) {
            this.showMessage('调试模式已启用，将显示详细日志', 'info');
        } else {
            this.showMessage('调试模式已禁用，仅显示关键信息', 'info');
        }
    }

    showMessage(message, type = 'info') {
        if (window.ErrorService) {
            window.ErrorService.showUser(message, type);
        } else {
            console.log(`[Settings] ${message}`);
        }
    }

    subscribeToStores() {
        this.addSubscription(this.stores.exams.subscribe(this.handleExamStoreChange.bind(this)));
        this.addSubscription(this.stores.app.subscribe(this.handleAppStoreChange.bind(this)));
    }

    handleExamStoreChange(event) {
        switch (event.type) {
            case 'exams_loaded':
                this.updateSystemInfo();
                break;
        }
    }

    handleAppStoreChange(event) {
        switch (event.type) {
            case 'view_changed':
                if (event.view === 'settings') {
                    this.updateSystemInfo();
                }
                break;
        }
    }

    updateSystemInfo() {
        try {
            const exams = this.stores.exams.exams || [];
            const htmlExams = exams.filter(exam => exam.hasHtml !== false);
            const pdfExams = exams.filter(exam => exam.hasPdf === true);

            if (this.elements.totalExams) {
                this.elements.totalExams.textContent = exams.length;
            }

            if (this.elements.htmlExams) {
                this.elements.htmlExams.textContent = htmlExams.length;
            }

            if (this.elements.pdfExams) {
                this.elements.pdfExams.textContent = pdfExams.length;
            }

            if (this.elements.lastUpdate) {
                this.elements.lastUpdate.textContent = new Date().toLocaleString('zh-CN');
            }

        } catch (error) {
            console.error('[SettingsPanel] Failed to update system info:', error);
        }
    }

    rebuildIndexes() {
        if (confirm('This will clear and rebuild indexes from data sources. Continue?')) {
            try {
                localStorage.removeItem('exams_index'); // Assume index key
                // Trigger reload from stores
                if (this.stores.exams.loadExams) {
                    this.stores.exams.loadExams();
                } else {
                    // Fallback: reload page to reinitialize
                    location.reload();
                }
                alert('Indexes rebuilt successfully.');
            } catch (error) {
                console.error('[SettingsPanel] Rebuild failed:', error);
                alert('Rebuild failed: ' + error.message);
            }
        }
    }

    restoreBackup() {
        if (confirm('This will restore from backup and overwrite current data. Continue?')) {
            try {
                const backup = localStorage.getItem('backup');
                if (backup) {
                    const data = JSON.parse(backup);
                    Object.keys(data).forEach(key => {
                        localStorage.setItem(key, data[key]);
                    });
                    alert('Backup restored successfully. Please refresh the page.');
                } else {
                    alert('No backup found.');
                }
            } catch (error) {
                console.error('[SettingsPanel] Restore failed:', error);
                alert('Restore failed: ' + error.message);
            }
        }
    }

    // Public API
    refresh() {
        this.updateSystemInfo();
    }

    // Global instance for compatibility
    static instance = null;
}

// Export only - App owns lifecycle
window.SettingsPanel = SettingsPanel;

console.log('[SettingsPanel] Class defined (instance will be created by App)');