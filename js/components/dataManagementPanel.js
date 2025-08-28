/**
 * 数据管理面板组件
 * 提供数据导入导出、备份恢复的用户界面
 */
class DataManagementPanel {
    constructor(container) {
        this.container = container;
        this.backupManager = new DataBackupManager();
        this.isVisible = false;
        
        this.initialize();
    }

    /**
     * 初始化组件
     */
    initialize() {
        this.createPanelStructure();
        this.bindEvents();
        this.loadDataStats();
        
        console.log('DataManagementPanel initialized');
    }

    /**
     * 创建面板结构
     */
    createPanelStructure() {
        this.container.innerHTML = `
            <div class="data-management-panel">
                <div class="panel-header">
                    <h3><i class="fas fa-database"></i> 数据管理</h3>
                    <button class="close-btn" data-action="close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div class="panel-content">
                    <!-- 数据统计 -->
                    <div class="stats-section">
                        <h4>数据统计</h4>
                        <div class="stats-grid">
                            <div class="stat-item">
                                <span class="stat-label">练习记录</span>
                                <span class="stat-value" id="recordCount">-</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">总练习时间</span>
                                <span class="stat-value" id="totalTime">-</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">平均分数</span>
                                <span class="stat-value" id="avgScore">-</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">存储使用</span>
                                <span class="stat-value" id="storageUsage">-</span>
                            </div>
                        </div>
                    </div>

                    <!-- 数据导出 -->
                    <div class="export-section">
                        <h4>数据导出</h4>
                        <div class="export-options">
                            <div class="option-group">
                                <label>导出格式:</label>
                                <select id="exportFormat">
                                    <option value="json">JSON格式</option>
                                    <option value="csv">CSV格式</option>
                                </select>
                            </div>
                            
                            <div class="option-group">
                                <label>
                                    <input type="checkbox" id="includeStats" checked>
                                    包含用户统计
                                </label>
                            </div>
                            
                            <div class="option-group">
                                <label>
                                    <input type="checkbox" id="includeBackups">
                                    包含备份数据
                                </label>
                            </div>

                            <div class="date-range-group">
                                <label>时间范围 (可选):</label>
                                <div class="date-inputs">
                                    <input type="date" id="exportStartDate" placeholder="开始日期">
                                    <input type="date" id="exportEndDate" placeholder="结束日期">
                                </div>
                            </div>

                            <button class="export-btn" data-action="export">
                                <i class="fas fa-download"></i> 导出数据
                            </button>
                        </div>
                    </div>

                    <!-- 数据导入 -->
                    <div class="import-section">
                        <h4>数据导入</h4>
                        <div class="import-options">
                            <div class="file-input-group">
                                <input type="file" id="importFile" accept=".json,.csv" style="display: none;">
                                <button class="file-select-btn" data-action="selectFile">
                                    <i class="fas fa-file-upload"></i> 选择文件
                                </button>
                                <span class="file-name" id="selectedFileName">未选择文件</span>
                            </div>

                            <div class="option-group">
                                <label>导入模式:</label>
                                <select id="importMode">
                                    <option value="merge">合并 (保留现有数据)</option>
                                    <option value="replace">替换 (清空现有数据)</option>
                                    <option value="skip">跳过 (仅导入新数据)</option>
                                </select>
                            </div>

                            <div class="option-group">
                                <label>
                                    <input type="checkbox" id="createBackupBeforeImport" checked>
                                    导入前创建备份
                                </label>
                            </div>

                            <button class="import-btn" data-action="import" disabled>
                                <i class="fas fa-upload"></i> 导入数据
                            </button>
                        </div>
                    </div>

                    <!-- 数据清理 -->
                    <div class="cleanup-section">
                        <h4>数据清理</h4>
                        <div class="cleanup-options">
                            <div class="warning-box">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>数据清理操作不可逆，请谨慎操作！</span>
                            </div>

                            <div class="cleanup-checkboxes">
                                <label>
                                    <input type="checkbox" id="clearRecords">
                                    清理练习记录
                                </label>
                                <label>
                                    <input type="checkbox" id="clearStats">
                                    清理用户统计
                                </label>
                                <label>
                                    <input type="checkbox" id="clearBackups">
                                    清理备份数据
                                </label>
                                <label>
                                    <input type="checkbox" id="clearSettings">
                                    清理系统设置
                                </label>
                            </div>

                            <div class="option-group">
                                <label>
                                    <input type="checkbox" id="createBackupBeforeClean" checked>
                                    清理前创建备份
                                </label>
                            </div>

                            <button class="cleanup-btn danger" data-action="cleanup">
                                <i class="fas fa-trash-alt"></i> 执行清理
                            </button>
                        </div>
                    </div>

                    <!-- 操作历史 -->
                    <div class="history-section">
                        <h4>操作历史</h4>
                        <div class="history-tabs">
                            <button class="tab-btn active" data-tab="export">导出历史</button>
                            <button class="tab-btn" data-tab="import">导入历史</button>
                        </div>
                        
                        <div class="history-content">
                            <div class="history-list" id="exportHistory"></div>
                            <div class="history-list" id="importHistory" style="display: none;"></div>
                        </div>
                    </div>
                </div>

                <!-- 进度指示器 -->
                <div class="progress-overlay" id="progressOverlay" style="display: none;">
                    <div class="progress-content">
                        <div class="spinner"></div>
                        <div class="progress-text" id="progressText">处理中...</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        const panel = this.container.querySelector('.data-management-panel');

        // 关闭按钮
        panel.querySelector('[data-action="close"]').addEventListener('click', () => {
            this.hide();
        });

        // 导出按钮
        panel.querySelector('[data-action="export"]').addEventListener('click', () => {
            this.handleExport();
        });

        // 文件选择
        panel.querySelector('[data-action="selectFile"]').addEventListener('click', () => {
            panel.querySelector('#importFile').click();
        });

        panel.querySelector('#importFile').addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        // 导入按钮
        panel.querySelector('[data-action="import"]').addEventListener('click', () => {
            this.handleImport();
        });

        // 清理按钮
        panel.querySelector('[data-action="cleanup"]').addEventListener('click', () => {
            this.handleCleanup();
        });

        // 历史标签切换
        panel.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchHistoryTab(e.target.dataset.tab);
            });
        });

        // 清理选项变化监听
        panel.querySelectorAll('.cleanup-checkboxes input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateCleanupButton();
            });
        });
    }

    /**
     * 显示面板
     */
    show() {
        this.container.style.display = 'block';
        this.isVisible = true;
        this.loadDataStats();
        this.loadHistory();
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
            const stats = this.backupManager.getDataStats();
            
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

            const exportResult = this.backupManager.exportPracticeRecords(options);
            
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
        const file = event.target.files[0];
        const fileNameSpan = document.getElementById('selectedFileName');
        const importBtn = document.querySelector('[data-action="import"]');

        if (file) {
            fileNameSpan.textContent = file.name;
            importBtn.disabled = false;
        } else {
            fileNameSpan.textContent = '未选择文件';
            importBtn.disabled = true;
        }
    }

    /**
     * 处理数据导入
     */
    async handleImport() {
        try {
            const fileInput = document.getElementById('importFile');
            const file = fileInput.files[0];
            
            if (!file) {
                this.showMessage('请先选择要导入的文件', 'warning');
                return;
            }

            this.showProgress('读取文件...');

            const fileContent = await this.readFile(file);
            
            this.updateProgress('验证数据格式...');

            const importMode = document.getElementById('importMode').value;
            const createBackup = document.getElementById('createBackupBeforeImport').checked;

            const options = {
                mergeMode: importMode,
                createBackup: createBackup,
                validateData: true
            };

            this.updateProgress('导入数据...');

            const result = await this.backupManager.importPracticeData(fileContent, options);

            this.hideProgress();

            if (result.success) {
                this.showMessage(
                    `导入成功！导入 ${result.importedCount} 条记录，跳过 ${result.skippedCount} 条重复记录。`,
                    'success'
                );
                this.loadDataStats();
                this.loadHistory();
                
                // 清空文件选择
                fileInput.value = '';
                document.getElementById('selectedFileName').textContent = '未选择文件';
                document.querySelector('[data-action="import"]').disabled = true;
            }

        } catch (error) {
            this.hideProgress();
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
    loadHistory() {
        this.loadExportHistory();
        this.loadImportHistory();
    }

    /**
     * 加载导出历史
     */
    loadExportHistory() {
        const exportHistory = this.backupManager.getExportHistory();
        const container = document.getElementById('exportHistory');

        if (exportHistory.length === 0) {
            container.innerHTML = '<div class="no-history">暂无导出记录</div>';
            return;
        }

        container.innerHTML = exportHistory.map(item => `
            <div class="history-item">
                <div class="history-info">
                    <div class="history-title">
                        <i class="fas fa-download"></i>
                        ${item.format?.toUpperCase() || 'JSON'} 导出
                    </div>
                    <div class="history-details">
                        <span>记录数: ${item.recordCount || 0}</span>
                        <span>时间: ${this.formatDateTime(item.timestamp)}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    /**
     * 加载导入历史
     */
    loadImportHistory() {
        const importHistory = this.backupManager.getImportHistory();
        const container = document.getElementById('importHistory');

        if (importHistory.length === 0) {
            container.innerHTML = '<div class="no-history">暂无导入记录</div>';
            return;
        }

        container.innerHTML = importHistory.map(item => `
            <div class="history-item ${item.success ? 'success' : 'error'}">
                <div class="history-info">
                    <div class="history-title">
                        <i class="fas fa-${item.success ? 'upload' : 'exclamation-triangle'}"></i>
                        ${item.success ? '导入成功' : '导入失败'}
                    </div>
                    <div class="history-details">
                        ${item.success ? 
                            `<span>记录数: ${item.recordCount || 0}</span>` :
                            `<span>错误: ${item.error}</span>`
                        }
                        <span>时间: ${this.formatDateTime(item.timestamp)}</span>
                    </div>
                </div>
            </div>
        `).join('');
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
        const messageEl = document.createElement('div');
        messageEl.className = `message-toast ${type}`;
        messageEl.innerHTML = `
            <i class="fas fa-${this.getMessageIcon(type)}"></i>
            <span>${message}</span>
        `;

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
        const blob = new Blob([content], { type: mimeType });
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