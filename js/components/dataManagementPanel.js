/**
 * 数据管理面板组件
 * 提供数据导入导出、备份恢复的用户界面
 */
function createElement(tagName, options = {}) {
    const el = document.createElement(tagName);
    if (options.className) {
        el.className = options.className;
    }
    if (typeof options.text === 'string') {
        el.textContent = options.text;
    }
    if (options.attrs) {
        Object.keys(options.attrs).forEach((key) => {
            el.setAttribute(key, options.attrs[key]);
        });
    }
    if (options.dataset) {
        Object.keys(options.dataset).forEach((key) => {
            el.dataset[key] = options.dataset[key];
        });
    }
    return el;
}

class DataManagementPanel {
    constructor(container) {
        this.container = container;
        this.backupManager = new DataBackupManager();
        this.isVisible = false;
        this.selectedFileContent = null;
        this.pendingImportMode = null;
        
        this.initialize();
    }

    /**
     * 初始化组件
     */
    async initialize() {
        this.createPanelStructure();
        this.bindEvents();
        this.loadDataStats();
        await this.loadHistory();
        
        console.log('DataManagementPanel initialized');
    }

    /**
     * 创建面板结构
     */
    createPanelStructure() {
        const panel = createElement('div', { className: 'data-management-panel' });
        panel.appendChild(this.createHeader());
        panel.appendChild(this.createContent());
        panel.appendChild(this.createProgressOverlay());
        this.container.replaceChildren(panel);
    }

    createHeader() {
        const header = createElement('div', { className: 'panel-header' });
        const title = createElement('h3');
        const icon = createElement('i', { className: 'fas fa-database' });
        title.appendChild(icon);
        title.appendChild(document.createTextNode(' 数据管理'));

        const closeBtn = createElement('button', {
            className: 'close-btn',
            attrs: { 'data-action': 'close', type: 'button' }
        });
        closeBtn.appendChild(createElement('i', { className: 'fas fa-times' }));

        header.appendChild(title);
        header.appendChild(closeBtn);
        return header;
    }

    createContent() {
        const content = createElement('div', { className: 'panel-content' });
        content.append(
            this.createStatsSection(),
            this.createExportSection(),
            this.createImportSection(),
            this.createCleanupSection(),
            this.createHistorySection()
        );
        return content;
    }

    createStatsSection() {
        const section = createElement('div', { className: 'stats-section' });
        section.appendChild(createElement('h4', { text: '数据统计' }));

        const grid = createElement('div', { className: 'stats-grid' });
        const stats = [
            { label: '练习记录', id: 'recordCount' },
            { label: '总练习时间', id: 'totalTime' },
            { label: '平均分数', id: 'avgScore' },
            { label: '存储使用', id: 'storageUsage' }
        ];

        stats.forEach(({ label, id }) => {
            const item = createElement('div', { className: 'stat-item' });
            item.appendChild(createElement('span', { className: 'stat-label', text: label }));
            const value = createElement('span', { className: 'stat-value', text: '-' });
            value.id = id;
            item.appendChild(value);
            grid.appendChild(item);
        });

        section.appendChild(grid);
        return section;
    }

    createExportSection() {
        const section = createElement('div', { className: 'export-section' });
        section.appendChild(createElement('h4', { text: '数据导出' }));

        const options = createElement('div', { className: 'export-options' });

        options.appendChild(this.createSelectGroup('导出格式:', 'exportFormat', [
            { value: 'json', text: 'JSON格式' },
            { value: 'csv', text: 'CSV格式' }
        ]));

        options.appendChild(this.createCheckboxGroup({
            id: 'includeStats',
            label: '包含用户统计',
            checked: true
        }));

        options.appendChild(this.createCheckboxGroup({
            id: 'includeBackups',
            label: '包含备份数据'
        }));

        const dateRange = createElement('div', { className: 'date-range-group' });
        dateRange.appendChild(createElement('label', { text: '时间范围 (可选):' }));
        const dateInputs = createElement('div', { className: 'date-inputs' });
        dateInputs.appendChild(createElement('input', {
            attrs: { type: 'date', id: 'exportStartDate', placeholder: '开始日期' }
        }));
        dateInputs.appendChild(createElement('input', {
            attrs: { type: 'date', id: 'exportEndDate', placeholder: '结束日期' }
        }));
        dateRange.appendChild(dateInputs);
        options.appendChild(dateRange);

        const exportButton = createElement('button', {
            className: 'export-btn',
            attrs: { 'data-action': 'export', type: 'button' }
        });
        exportButton.appendChild(createElement('i', { className: 'fas fa-download' }));
        exportButton.appendChild(document.createTextNode(' 导出数据'));
        options.appendChild(exportButton);

        section.appendChild(options);
        return section;
    }

    createImportSection() {
        const section = createElement('div', { className: 'import-section' });
        section.appendChild(createElement('h4', { text: '数据导入' }));

        const options = createElement('div', { className: 'import-options' });
        const fileGroup = createElement('div', { className: 'file-input-group' });

        const fileInput = createElement('input', {
            attrs: {
                type: 'file',
                id: 'importFile',
                accept: '.json,.csv'
            }
        });
        fileInput.style.display = 'none';

        const fileButton = createElement('button', {
            className: 'file-select-btn',
            attrs: { 'data-action': 'selectFile', type: 'button' }
        });
        fileButton.appendChild(createElement('i', { className: 'fas fa-file-upload' }));
        fileButton.appendChild(document.createTextNode(' 选择文件'));

        const fileName = createElement('span', {
            className: 'file-name',
            text: '未选择文件'
        });
        fileName.id = 'selectedFileName';

        fileGroup.append(fileInput, fileButton, fileName);
        options.appendChild(fileGroup);

        options.appendChild(this.createSelectGroup('导入模式:', 'importMode', [
            { value: 'merge', text: '合并 (保留现有数据)' },
            { value: 'replace', text: '替换 (清空现有数据)' },
            { value: 'skip', text: '跳过 (仅导入新数据)' }
        ]));

        options.appendChild(this.createCheckboxGroup({
            id: 'createBackupBeforeImport',
            label: '导入前创建备份',
            checked: true
        }));

        const importButton = createElement('button', {
            className: 'import-btn',
            attrs: { 'data-action': 'import', type: 'button', disabled: 'disabled' }
        });
        importButton.appendChild(createElement('i', { className: 'fas fa-upload' }));
        importButton.appendChild(document.createTextNode(' 导入数据'));
        options.appendChild(importButton);

        section.appendChild(options);
        return section;
    }

    createCleanupSection() {
        const section = createElement('div', { className: 'cleanup-section' });
        section.appendChild(createElement('h4', { text: '数据清理' }));

        const options = createElement('div', { className: 'cleanup-options' });
        const warning = createElement('div', { className: 'warning-box' });
        warning.appendChild(createElement('i', { className: 'fas fa-exclamation-triangle' }));
        warning.appendChild(document.createTextNode(' 数据清理操作不可逆，请谨慎操作！'));
        options.appendChild(warning);

        const checkboxContainer = createElement('div', { className: 'cleanup-checkboxes' });
        [
            { id: 'clearRecords', label: '清理练习记录' },
            { id: 'clearStats', label: '清理用户统计' },
            { id: 'clearBackups', label: '清理备份数据' },
            { id: 'clearSettings', label: '清理系统设置' }
        ].forEach(({ id, label }) => {
            const wrapper = createElement('label');
            const checkbox = createElement('input', {
                attrs: { type: 'checkbox', id },
                className: 'cleanup-checkbox'
            });
            wrapper.appendChild(checkbox);
            wrapper.appendChild(document.createTextNode(` ${label}`));
            checkboxContainer.appendChild(wrapper);
        });
        options.appendChild(checkboxContainer);

        options.appendChild(this.createCheckboxGroup({
            id: 'createBackupBeforeClean',
            label: '清理前创建备份',
            checked: true
        }));

        const cleanupButton = createElement('button', {
            className: 'cleanup-btn danger',
            attrs: { 'data-action': 'cleanup', type: 'button' }
        });
        cleanupButton.appendChild(createElement('i', { className: 'fas fa-trash-alt' }));
        cleanupButton.appendChild(document.createTextNode(' 执行清理'));
        options.appendChild(cleanupButton);

        section.appendChild(options);
        return section;
    }

    createHistorySection() {
        const section = createElement('div', { className: 'history-section' });
        section.appendChild(createElement('h4', { text: '操作历史' }));

        const tabs = createElement('div', { className: 'history-tabs' });
        const exportTab = createElement('button', {
            className: 'tab-btn active',
            dataset: { tab: 'export' },
            attrs: { type: 'button' }
        });
        exportTab.textContent = '导出历史';
        const importTab = createElement('button', {
            className: 'tab-btn',
            dataset: { tab: 'import' },
            attrs: { type: 'button' }
        });
        importTab.textContent = '导入历史';
        tabs.append(exportTab, importTab);

        const content = createElement('div', { className: 'history-content' });
        const exportList = createElement('div', { className: 'history-list' });
        exportList.id = 'exportHistory';
        const importList = createElement('div', { className: 'history-list' });
        importList.id = 'importHistory';
        importList.style.display = 'none';
        content.append(exportList, importList);

        section.append(tabs, content);
        return section;
    }

    createProgressOverlay() {
        const overlay = createElement('div', {
            className: 'progress-overlay',
            attrs: { id: 'progressOverlay' }
        });
        overlay.style.display = 'none';

        const wrapper = createElement('div', { className: 'progress-content' });
        wrapper.appendChild(createElement('div', { className: 'spinner' }));
        const text = createElement('div', {
            className: 'progress-text',
            text: '处理中...'
        });
        text.id = 'progressText';
        wrapper.appendChild(text);
        overlay.appendChild(wrapper);
        return overlay;
    }

    createSelectGroup(labelText, selectId, options) {
        const group = createElement('div', { className: 'option-group' });
        const label = createElement('label', { text: labelText });
        const select = createElement('select', { attrs: { id: selectId } });
        options.forEach(({ value, text }) => {
            const option = createElement('option', { text });
            option.value = value;
            select.appendChild(option);
        });
        group.append(label, select);
        return group;
    }

    createCheckboxGroup({ id, label, checked }) {
        const group = createElement('div', { className: 'option-group' });
        const wrapper = createElement('label');
        const input = createElement('input', {
            attrs: { type: 'checkbox', id }
        });
        if (checked) {
            input.checked = true;
        }
        wrapper.appendChild(input);
        wrapper.appendChild(document.createTextNode(` ${label}`));
        group.appendChild(wrapper);
        return group;
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        const panel = this.container.querySelector('.data-management-panel');

        // 使用统一的事件委托处理所有按钮
        panel.addEventListener('click', (e) => {
            const button = e.target.closest('[data-action]');
            if (!button) return;

            const action = button.dataset.action;

            switch (action) {
                case 'close':
                    this.hide();
                    break;
                case 'export':
                    this.handleExport();
                    break;
                case 'selectFile':
                    panel.querySelector('#importFile').click();
                    break;
                case 'import':
                    this.showImportModeModal();
                    break;
                case 'cleanup':
                    this.handleCleanup();
                    break;
            }
        });

        // 文件选择change事件仍然需要单独绑定
        panel.querySelector('#importFile').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });
        console.log('[DataManagementPanel] 使用统一事件委托处理按钮');

        // 历史标签切换 - 使用事件委托
        panel.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn');
            if (tabBtn) {
                this.switchHistoryTab(tabBtn.dataset.tab);
            }
        });

        // 清理选项变化监听
        panel.addEventListener('change', (e) => {
            if (e.target.classList && e.target.classList.contains('cleanup-checkbox') && e.target.type === 'checkbox') {
                this.updateCleanupButton();
            }
        });

        this.updateCleanupButton();

        // 直接把设置页的“导入数据”按钮也绑到本面板，绕过全局 importData 覆盖混乱
        const settingsImportBtn = document.getElementById('import-data-btn');
        if (settingsImportBtn) {
            settingsImportBtn.addEventListener('click', (event) => {
                event.preventDefault();
                this.show();
                this.showImportModeModal();
            });
        }
    }

    showImportModeModal() {
        this.pendingImportMode = null;
        if (!this.importModeModal) {
            const overlay = createElement('div', { className: 'import-mode-overlay' });
            Object.assign(overlay.style, {
                position: 'fixed',
                inset: '0',
                background: 'rgba(15,23,42,0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                boxSizing: 'border-box',
                zIndex: '9999'
            });

            const modal = createElement('div', { className: 'import-mode-modal' });
            Object.assign(modal.style, {
                position: 'relative'
            });

            const closeBtn = createElement('button', { className: 'close-btn', text: '×' });
            closeBtn.addEventListener('click', () => this.hideImportModeModal());
            modal.appendChild(closeBtn);

            const title = createElement('h4', { text: '选择导入模式' });
            title.style.marginTop = '0';
            modal.appendChild(title);

            const desc = createElement('p', { text: '先确定导入策略，再选择文件并点击“导入数据”。' });
            modal.appendChild(desc);

            const options = createElement('div', { className: 'import-mode-options' });
            const defs = [
                {
                    mode: 'merge',
                    icon: '➕',
                    title: '增量导入',
                    description: '保留现有记录，仅合并新增或较新记录。'
                },
                {
                    mode: 'replace',
                    icon: '⚠️',
                    title: '覆盖导入',
                    description: '彻底替换现有记录，谨慎操作。'
                }
            ];
            defs.forEach((def) => {
                const card = createElement('div', { className: 'import-mode-option' });
                const icon = createElement('div', { className: 'mode-icon', text: def.icon });
                const titleEl = createElement('h5', { text: def.title });
                const text = createElement('p', { text: def.description });
                const button = createElement('button', { className: 'mode-select-btn', text: '选择' });
                button.addEventListener('click', () => {
                    this.pendingImportMode = def.mode;
                    const select = document.getElementById('importMode');
                    if (select) {
                        select.value = def.mode;
                    }
                    this.hideImportModeModal();
                    this.showMessage(`已选择“${def.title}”，请继续选择文件并点击导入。`, 'info');
                });
                card.append(icon, titleEl, text, button);
                options.appendChild(card);
            });
            modal.appendChild(options);

            const actions = createElement('div', { className: 'import-mode-actions' });
            const cancelBtn = createElement('button', { className: 'btn-cancel', text: '关闭' });
            cancelBtn.addEventListener('click', () => this.hideImportModeModal());
            actions.append(cancelBtn);
            modal.appendChild(actions);

            overlay.appendChild(modal);
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.hideImportModeModal();
                }
            });

            document.body.appendChild(overlay);
            this.importModeModal = overlay;
        }

        this.importModeModal.style.display = 'flex';
    }

    hideImportModeModal() {
        if (this.importModeModal) {
            this.importModeModal.style.display = 'none';
        }
    }

    /**
     * 显示面板
     */
    async show() {
        this.container.style.display = 'block';
        this.isVisible = true;
        await this.loadDataStats();
        await this.loadHistory();
    }

    /**
     * 隐藏面板
     */
    hide() {
        this.container.style.display = 'none';
        this.isVisible = false;
    }

    /**
     * 加载数据统计
     */
    async loadDataStats() {
        try {
            const stats = await this.backupManager.getDataStats();
            
            if (stats) {
                document.getElementById('recordCount').textContent = stats.practiceRecords.count;
                document.getElementById('totalTime').textContent = this.formatTime(stats.userStats.totalTimeSpent);
                document.getElementById('avgScore').textContent = Math.round(stats.userStats.averageScore * 100) + '%';
                
                if (stats.storage) {
                    const usageKB = Math.round(stats.storage.used / 1024);
                    document.getElementById('storageUsage').textContent = `${usageKB} KB`;
                }
            }
        } catch (error) {
            console.error('Failed to load data stats:', error);
        }
    }

    /**
     * 处理数据导出
     */
    async handleExport() {
        try {
            this.showProgress('准备导出数据...');

            const format = document.getElementById('exportFormat').value;
            const includeStats = document.getElementById('includeStats').checked;
            const includeBackups = document.getElementById('includeBackups').checked;
            
            const startDate = document.getElementById('exportStartDate').value;
            const endDate = document.getElementById('exportEndDate').value;
            
            const options = {
                format,
                includeStats,
                includeBackups
            };

            if (startDate || endDate) {
                options.dateRange = { startDate, endDate };
            }

            const exportResult = await this.backupManager.exportPracticeRecords(options);
            
            // 下载文件
            this.downloadFile(exportResult.data, exportResult.filename, exportResult.mimeType);
            
            this.hideProgress();
            this.showMessage('数据导出成功！', 'success');
            this.loadHistory();

        } catch (error) {
            this.hideProgress();
            this.showMessage(`导出失败: ${error.message}`, 'error');
        }
    }

    /**
     * 处理文件选择
     */
    handleFileSelect(event) {
        console.log('[DataManagementPanel] handleFileSelect called');
        const file = event.target.files[0];
        const fileNameSpan = document.getElementById('selectedFileName');
        const importBtn = document.querySelector('[data-action="import"]');

        if (file) {
            fileNameSpan.textContent = file.name;
            importBtn.disabled = false;
            
            // 异步读取文件内容
            this.readFile(file).then(content => {
                this.selectedFileContent = content;
                console.log('[DataManagementPanel] File content loaded');
            }).catch(error => {
                console.error('[DataManagementPanel] Failed to read file:', error);
                this.showMessage('文件读取失败', 'error');
            });
        } else {
            fileNameSpan.textContent = '未选择文件';
            importBtn.disabled = true;
            this.selectedFileContent = null;
        }
    }

    /**
     * 处理数据导入
     */
    async handleImport(selectedMode = null) {
        console.log('[DataManagementPanel] handleImport called');
        try {
            let fileContent;
            const fileInput = document.getElementById('importFile');
            const file = fileInput.files[0];

            if (this.selectedFileContent) {
                console.log('[DataManagementPanel] using cached file content');
                fileContent = this.selectedFileContent;
            } else if (file) {
                // 添加文件大小检查
                if (file.size > 5 * 1024 * 1024) {
                    this.showMessage('文件过大 (>5MB)，请分批导入或使用小文件测试。');
                    return;
                }
                this.showProgress('读取文件...');
                // 直接使用FileReader添加详细日志
                fileContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = (e) => {
                        console.error('[DataManagementPanel] File read error:', e);
                        reject(new Error('文件读取失败'));
                    };
                    reader.onload = (e) => {
                        console.log('[DataManagementPanel] File loaded, size:', file.size);
                        try {
                            const data = JSON.parse(e.target.result);
                            console.log('[DataManagementPanel] JSON parsed, type:', Array.isArray(data) ? 'array' : typeof data, 'length:', data.length || data.practiceRecords?.length || data.practice_records?.length || data.data?.practice_records?.length);
                            resolve(data);
                        } catch (err) {
                            console.error('[DataManagementPanel] JSON parse error:', err);
                            reject(err);
                        }
                    };
                    reader.readAsText(file);
                });
            } else {
                this.showMessage('请先选择要导入的文件', 'warning');
                return;
            }

            this.updateProgress('验证数据格式...');

            const modeSelect = document.getElementById('importMode');
            const resolvedMode = selectedMode || this.pendingImportMode || (modeSelect ? modeSelect.value : null);
            if (!resolvedMode) {
                this.hideProgress();
                this.showMessage('请先选择导入模式（点击导入数据按钮）。', 'warning');
                return;
            }

            const createBackup = document.getElementById('createBackupBeforeImport').checked;

            const options = {
                mergeMode: resolvedMode,
                createBackup: createBackup,
                validateData: true
            };

            this.updateProgress('导入数据...');

            const result = await this.backupManager.importPracticeData(fileContent, options);
            console.log('[DataManagementPanel] importPracticeData returned:', result);

            this.hideProgress();

            if (result.success) {
                console.log('[DataManagementPanel] Import successful');
                console.log(
                    'Import completed: importedCount=',
                    result.importedCount,
                    'total=',
                    result.recordCount || result.finalCount || result.importedCount || 0
                );
                this.showMessage(
                    `导入成功！导入 ${result.importedCount || result.recordCount || 0} 条记录，跳过 ${result.skippedCount || 0} 条重复记录。`,
                    'success'
                );
                this.loadDataStats();
                this.loadHistory();
                
                // 清空文件选择
                fileInput.value = '';
                document.getElementById('selectedFileName').textContent = '未选择文件';
                document.querySelector('[data-action="import"]').disabled = true;
                this.selectedFileContent = null;
                this.pendingImportMode = null;
            }

        } catch (error) {
            this.hideProgress();
            console.error('[DataManagementPanel] Import failed:', error);
            this.showMessage(`导入失败: ${error.message}`, 'error');
        }
    }

    /**
     * 处理数据清理
     */
    async handleCleanup() {
        const clearRecords = document.getElementById('clearRecords').checked;
        const clearStats = document.getElementById('clearStats').checked;
        const clearBackups = document.getElementById('clearBackups').checked;
        const clearSettings = document.getElementById('clearSettings').checked;
        const createBackup = document.getElementById('createBackupBeforeClean').checked;

        if (!clearRecords && !clearStats && !clearBackups && !clearSettings) {
            this.showMessage('请选择要清理的数据类型', 'warning');
            return;
        }

        // 确认对话框
        const confirmMessage = `确定要清理以下数据吗？\n${
            [
                clearRecords && '• 练习记录',
                clearStats && '• 用户统计',
                clearBackups && '• 备份数据',
                clearSettings && '• 系统设置'
            ].filter(Boolean).join('\n')
        }\n\n此操作不可撤销！`;

        if (!confirm(confirmMessage)) {
            return;
        }

        try {
            this.showProgress('清理数据...');

            const options = {
                clearPracticeRecords: clearRecords,
                clearUserStats: clearStats,
                clearBackups: clearBackups,
                clearSettings: clearSettings,
                createBackup: createBackup
            };

            const result = await this.backupManager.clearData(options);

            this.hideProgress();

            if (result.success) {
                this.showMessage(
                    `数据清理完成！已清理: ${result.clearedItems.join(', ')}`,
                    'success'
                );
                this.loadDataStats();
                this.loadHistory();
                
                // 重置清理选项
                document.querySelectorAll('.cleanup-checkboxes input[type="checkbox"]').forEach(cb => {
                    cb.checked = false;
                });
                this.updateCleanupButton();
            }

        } catch (error) {
            this.hideProgress();
            this.showMessage(`清理失败: ${error.message}`, 'error');
        }
    }

    /**
     * 切换历史标签
     */
    switchHistoryTab(tab) {
        // 更新标签状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // 显示对应内容
        document.getElementById('exportHistory').style.display = tab === 'export' ? 'block' : 'none';
        document.getElementById('importHistory').style.display = tab === 'import' ? 'block' : 'none';
    }

    /**
     * 加载操作历史
     */
    async loadHistory() {
        await Promise.all([
            this.loadExportHistory(),
            this.loadImportHistory()
        ]);
    }

    /**
     * 加载导出历史
     */
    async loadExportHistory() {
        const container = document.getElementById('exportHistory');
        if (!container) {
            return;
        }

        try {
            const exportHistory = await this.backupManager.getExportHistory();
            const historyItems = Array.isArray(exportHistory) ? exportHistory : [];

            if (!historyItems.length) {
                this.renderNoHistory(container, '暂无导出记录');
                return;
            }

            const fragment = document.createDocumentFragment();
            historyItems.forEach((item) => {
                fragment.appendChild(this.createHistoryItem({
                    icon: 'fas fa-download',
                    title: `${item.format?.toUpperCase() || 'JSON'} 导出`,
                    details: [
                        `记录数: ${item.recordCount ?? 0}`,
                        `时间: ${this.formatDateTime(item.timestamp)}`
                    ]
                }));
            });

            container.replaceChildren(fragment);
        } catch (error) {
            console.error('[DataManagementPanel] Failed to load export history:', error);
            this.renderNoHistory(container, '导出历史加载失败');
        }
    }

    /**
     * 加载导入历史
     */
    async loadImportHistory() {
        const container = document.getElementById('importHistory');
        if (!container) {
            return;
        }

        try {
            const importHistory = await this.backupManager.getImportHistory();
            const historyItems = Array.isArray(importHistory) ? importHistory : [];

            if (!historyItems.length) {
                this.renderNoHistory(container, '暂无导入记录');
                return;
            }

            const fragment = document.createDocumentFragment();
            historyItems.forEach((item) => {
                fragment.appendChild(this.createHistoryItem({
                    icon: 'fas fa-upload',
                    title: '导入操作',
                    details: [
                        `新增记录: ${item.recordCount ?? item.importedCount ?? 0}`,
                        `合并模式: ${item.mergeMode || 'merge'}`,
                        `时间: ${this.formatDateTime(item.timestamp)}`
                    ]
                }));
            });

            container.replaceChildren(fragment);
        } catch (error) {
            console.error('[DataManagementPanel] Failed to load import history:', error);
            this.renderNoHistory(container, '导入历史加载失败');
        }
    }

    renderNoHistory(container, message) {
        const empty = createElement('div', { className: 'no-history', text: message });
        container.replaceChildren(empty);
    }

    createHistoryItem({ icon, title, details }) {
        const item = createElement('div', { className: 'history-item' });
        const info = createElement('div', { className: 'history-info' });
        const titleEl = createElement('div', { className: 'history-title' });
        titleEl.appendChild(createElement('i', { className: icon }));
        titleEl.appendChild(document.createTextNode(` ${title}`));

        const detailsEl = createElement('div', { className: 'history-details' });
        details.forEach((detail) => {
            detailsEl.appendChild(createElement('span', { text: detail }));
        });

        info.append(titleEl, detailsEl);
        item.appendChild(info);
        return item;
    }

    /**
     * 更新清理按钮状态
     */
    updateCleanupButton() {
        const checkboxes = document.querySelectorAll('.cleanup-checkboxes input[type="checkbox"]');
        const cleanupBtn = document.querySelector('[data-action="cleanup"]');
        
        const hasSelection = Array.from(checkboxes).some(cb => cb.checked);
        cleanupBtn.disabled = !hasSelection;
    }

    /**
     * 显示进度
     */
    showProgress(text) {
        const overlay = document.getElementById('progressOverlay');
        const progressText = document.getElementById('progressText');
        
        progressText.textContent = text;
        overlay.style.display = 'flex';
    }

    /**
     * 更新进度文本
     */
    updateProgress(text) {
        const progressText = document.getElementById('progressText');
        progressText.textContent = text;
    }

    /**
     * 隐藏进度
     */
    hideProgress() {
        const overlay = document.getElementById('progressOverlay');
        overlay.style.display = 'none';
    }

    /**
     * 显示消息
     */
    showMessage(message, type = 'info') {
        // 创建消息元素
        const messageEl = createElement('div', { className: `message-toast ${type}` });
        const icon = createElement('i', { className: `fas fa-${this.getMessageIcon(type)}` });
        const text = createElement('span', { text: message });
        messageEl.append(icon, text);

        // 添加到页面
        document.body.appendChild(messageEl);

        // 自动移除
        setTimeout(() => {
            messageEl.remove();
        }, 5000);
    }

    /**
     * 获取消息图标
     */
    getMessageIcon(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }

    /**
     * 读取文件内容
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                resolve(e.target.result);
            };
            
            reader.onerror = () => {
                reject(new Error('文件读取失败'));
            };
            
            reader.readAsText(file);
        });
    }

    /**
     * 下载文件
     */
    downloadFile(content, filename, mimeType) {
        // 对于文本类型的内容，添加UTF-8编码支持
        const isTextType = mimeType.includes('text/') ||
                          mimeType.includes('application/json') ||
                          mimeType.includes('application/javascript') ||
                          mimeType.includes('application/xml');

        const blobOptions = isTextType ? { type: mimeType + '; charset=utf-8' } : { type: mimeType };
        const blob = new Blob([content], blobOptions);
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
    }

    /**
     * 格式化时间
     */
    formatTime(seconds) {
        if (!seconds) return '0分钟';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}小时${minutes}分钟`;
        } else {
            return `${minutes}分钟`;
        }
    }

    /**
     * 格式化日期时间
     */
    formatDateTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// 确保全局可用
window.DataManagementPanel = DataManagementPanel;
