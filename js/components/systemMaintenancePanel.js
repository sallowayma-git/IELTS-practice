/**
 * 系统维护面板组件
 * 提供系统诊断、性能监控和维护工具的用户界面
 */
class SystemMaintenancePanel {
    constructor(container) {
        this.container = container;
        this.diagnostics = new SystemDiagnostics();
        this.isVisible = false;
        this.activeTab = 'health';

        // 全局引用，供事件委托使用
        window.systemMaintenancePanel = this;

        this.initialize();
    }

    /**
     * 初始化组件
     */
    initialize() {
        this.createPanelStructure();
        this.bindEvents();
        this.loadSystemHealth();
        
        console.log('SystemMaintenancePanel initialized');
    }

    /**
     * 创建面板结构
     */
    createPanelStructure() {
        this.container.innerHTML = `
            <div class="system-maintenance-panel">
                <div class="panel-header">
                    <h3><i class="fas fa-tools"></i> 系统维护</h3>
                    <button class="close-btn" data-action="close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div class="panel-tabs">
                    <button class="tab-btn active" data-tab="health">系统健康</button>
                    <button class="tab-btn" data-tab="diagnostics">完整性检查</button>
                    <button class="tab-btn" data-tab="performance">性能监控</button>
                    <button class="tab-btn" data-tab="errors">错误日志</button>
                    <button class="tab-btn" data-tab="maintenance">系统维护</button>
                </div>

                <div class="panel-content">
                    <!-- 系统健康标签页 -->
                    <div class="tab-content active" id="healthTab">
                        <div class="health-overview">
                            <div class="health-score-card">
                                <div class="score-circle" id="healthScore">
                                    <span class="score-value">--</span>
                                    <span class="score-label">健康分数</span>
                                </div>
                                <div class="health-status" id="healthStatus">
                                    <span class="status-text">检查中...</span>
                                </div>
                            </div>
                            
                            <div class="health-details">
                                <div class="detail-item">
                                    <span class="detail-label">最后检查时间</span>
                                    <span class="detail-value" id="lastCheckTime">-</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">发现问题</span>
                                    <span class="detail-value" id="issueCount">-</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">系统状态</span>
                                    <span class="detail-value" id="systemStatus">-</span>
                                </div>
                            </div>
                        </div>

                        <div class="recommendations-section">
                            <h4>优化建议</h4>
                            <div class="recommendations-list" id="recommendationsList">
                                <div class="no-recommendations">暂无建议</div>
                            </div>
                        </div>

                        <div class="quick-actions">
                            <h4>快速操作</h4>
                            <div class="action-buttons">
                                <button class="action-btn" data-action="runDiagnostics">
                                    <i class="fas fa-search"></i> 运行诊断
                                </button>
                                <button class="action-btn" data-action="performMaintenance">
                                    <i class="fas fa-wrench"></i> 执行维护
                                </button>
                                <button class="action-btn" data-action="clearCache">
                                    <i class="fas fa-broom"></i> 清理缓存
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 完整性检查标签页 -->
                    <div class="tab-content" id="diagnosticsTab">
                        <div class="diagnostics-controls">
                            <button class="primary-btn" data-action="startIntegrityCheck">
                                <i class="fas fa-play"></i> 开始完整性检查
                            </button>
                            <button class="secondary-btn" data-action="viewDiagnosticHistory">
                                <i class="fas fa-history"></i> 查看历史
                            </button>
                        </div>

                        <div class="diagnostics-results" id="diagnosticsResults">
                            <div class="no-results">点击上方按钮开始诊断</div>
                        </div>
                    </div>

                    <!-- 性能监控标签页 -->
                    <div class="tab-content" id="performanceTab">
                        <div class="performance-controls">
                            <button class="primary-btn" data-action="startPerformanceTest">
                                <i class="fas fa-tachometer-alt"></i> 开始性能测试
                            </button>
                            <button class="secondary-btn" data-action="viewPerformanceHistory">
                                <i class="fas fa-chart-line"></i> 查看历史数据
                            </button>
                        </div>

                        <div class="performance-metrics" id="performanceMetrics">
                            <div class="metrics-grid">
                                <div class="metric-card">
                                    <div class="metric-title">内存使用</div>
                                    <div class="metric-value" id="memoryUsage">-</div>
                                </div>
                                <div class="metric-card">
                                    <div class="metric-title">存储性能</div>
                                    <div class="metric-value" id="storagePerf">-</div>
                                </div>
                                <div class="metric-card">
                                    <div class="metric-title">页面加载</div>
                                    <div class="metric-value" id="pageLoadTime">-</div>
                                </div>
                                <div class="metric-card">
                                    <div class="metric-title">题库操作</div>
                                    <div class="metric-value" id="examOpPerf">-</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 错误日志标签页 -->
                    <div class="tab-content" id="errorsTab">
                        <div class="errors-controls">
                            <button class="primary-btn" data-action="analyzeErrors">
                                <i class="fas fa-chart-pie"></i> 分析错误模式
                            </button>
                            <button class="secondary-btn" data-action="exportErrorLogs">
                                <i class="fas fa-download"></i> 导出日志
                            </button>
                            <button class="danger-btn" data-action="clearErrorLogs">
                                <i class="fas fa-trash"></i> 清空日志
                            </button>
                        </div>

                        <div class="error-analysis" id="errorAnalysis">
                            <div class="analysis-summary">
                                <div class="summary-item">
                                    <span class="summary-label">总错误数</span>
                                    <span class="summary-value" id="totalErrors">-</span>
                                </div>
                                <div class="summary-item">
                                    <span class="summary-label">24小时内</span>
                                    <span class="summary-value" id="recentErrors">-</span>
                                </div>
                                <div class="summary-item">
                                    <span class="summary-label">错误率</span>
                                    <span class="summary-value" id="errorRate">-</span>
                                </div>
                            </div>
                        </div>

                        <div class="error-logs" id="errorLogs">
                            <div class="no-errors">暂无错误日志</div>
                        </div>
                    </div>

                    <!-- 系统维护标签页 -->
                    <div class="tab-content" id="maintenanceTab">
                        <div class="maintenance-tasks">
                            <h4>维护任务</h4>
                            <div class="task-list">
                                <label class="task-item">
                                    <input type="checkbox" value="cleanup_expired_data">
                                    <span class="task-name">清理过期数据</span>
                                    <span class="task-desc">删除超过1年的练习记录</span>
                                </label>
                                <label class="task-item">
                                    <input type="checkbox" value="rebuild_index">
                                    <span class="task-name">重建题库索引</span>
                                    <span class="task-desc">重新扫描并索引所有题目</span>
                                </label>
                                <label class="task-item">
                                    <input type="checkbox" value="recalculate_stats">
                                    <span class="task-name">重新计算统计</span>
                                    <span class="task-desc">重新计算用户统计数据</span>
                                </label>
                                <label class="task-item">
                                    <input type="checkbox" value="compress_data">
                                    <span class="task-name">压缩存储数据</span>
                                    <span class="task-desc">优化数据结构，减少存储空间</span>
                                </label>
                                <label class="task-item">
                                    <input type="checkbox" value="clear_error_logs">
                                    <span class="task-name">清理错误日志</span>
                                    <span class="task-desc">清空所有错误日志记录</span>
                                </label>
                            </div>

                            <div class="maintenance-controls">
                                <button class="primary-btn" data-action="executeMaintenance">
                                    <i class="fas fa-cog"></i> 执行选中任务
                                </button>
                                <button class="secondary-btn" data-action="viewMaintenanceHistory">
                                    <i class="fas fa-history"></i> 维护历史
                                </button>
                            </div>
                        </div>

                        <div class="maintenance-results" id="maintenanceResults">
                            <div class="no-results">选择维护任务并点击执行</div>
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
        const panel = this.container.querySelector('.system-maintenance-panel');

        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 关闭按钮
            window.DOM.delegate('click', '[data-action="close"]', function(e) {
                window.systemMaintenancePanel.hide();
            });

            // 标签切换
            window.DOM.delegate('click', '.tab-btn', function(e) {
                const tabBtn = this.closest('.tab-btn');
                if (tabBtn) {
                    window.systemMaintenancePanel.switchTab(tabBtn.dataset.tab);
                }
            });

            // 系统健康操作
            window.DOM.delegate('click', '[data-action="runDiagnostics"]', function(e) {
                window.systemMaintenancePanel.runDiagnostics();
            });

            window.DOM.delegate('click', '[data-action="performMaintenance"]', function(e) {
                window.systemMaintenancePanel.performQuickMaintenance();
            });

            window.DOM.delegate('click', '[data-action="clearCache"]', function(e) {
                window.systemMaintenancePanel.clearCache();
            });

            // 完整性检查操作
            window.DOM.delegate('click', '[data-action="startIntegrityCheck"]', function(e) {
                window.systemMaintenancePanel.startIntegrityCheck();
            });

            // 性能监控操作
            window.DOM.delegate('click', '[data-action="startPerformanceTest"]', function(e) {
                window.systemMaintenancePanel.startPerformanceTest();
            });

            // 错误日志操作
            window.DOM.delegate('click', '[data-action="analyzeErrors"]', function(e) {
                window.systemMaintenancePanel.analyzeErrors();
            });

            window.DOM.delegate('click', '[data-action="clearErrorLogs"]', function(e) {
                window.systemMaintenancePanel.clearErrorLogs();
            });

            // 维护任务操作
            window.DOM.delegate('click', '[data-action="executeMaintenance"]', function(e) {
                window.systemMaintenancePanel.executeMaintenance();
            });

            console.log('[SystemMaintenancePanel] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            panel.querySelector('[data-action="close"]')?.addEventListener('click', () => {
                this.hide();
            });

            panel.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const tabBtn = e.target.closest('.tab-btn');
                    if (tabBtn) {
                        this.switchTab(tabBtn.dataset.tab);
                    }
                });
            });

            panel.querySelector('[data-action="runDiagnostics"]')?.addEventListener('click', () => {
                this.runDiagnostics();
            });

            panel.querySelector('[data-action="performMaintenance"]')?.addEventListener('click', () => {
                this.performQuickMaintenance();
            });

            panel.querySelector('[data-action="clearCache"]')?.addEventListener('click', () => {
                this.clearCache();
            });

            panel.querySelector('[data-action="startIntegrityCheck"]')?.addEventListener('click', () => {
                this.startIntegrityCheck();
            });

            panel.querySelector('[data-action="startPerformanceTest"]')?.addEventListener('click', () => {
                this.startPerformanceTest();
            });

            panel.querySelector('[data-action="analyzeErrors"]')?.addEventListener('click', () => {
                this.analyzeErrors();
            });

            panel.querySelector('[data-action="clearErrorLogs"]')?.addEventListener('click', () => {
                this.clearErrorLogs();
            });

            panel.querySelector('[data-action="executeMaintenance"]')?.addEventListener('click', () => {
                this.executeMaintenance();
            });
        }
    }

    /**
     * 显示面板
     */
    show() {
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(this.container, { display: 'block' });
        } else {
            this.container.style.display = 'block';
        }
        this.isVisible = true;
        this.loadSystemHealth();
    }

    /**
     * 隐藏面板
     */
    hide() {
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(this.container, { display: 'none' });
        } else {
            this.container.style.display = 'none';
        }
        this.isVisible = false;
    }

    /**
     * 切换标签
     */
    switchTab(tabName) {
        // 更新标签按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // 显示对应内容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}Tab`);
        });

        this.activeTab = tabName;

        // 加载对应标签的数据
        switch (tabName) {
            case 'health':
                this.loadSystemHealth();
                break;
            case 'performance':
                this.loadPerformanceMetrics();
                break;
            case 'errors':
                this.loadErrorAnalysis();
                break;
        }
    }

    /**
     * 加载系统健康状态
     */
    async loadSystemHealth() {
        try {
            const health = this.diagnostics.getSystemHealth();
            
            // 更新健康分数
            const scoreElement = document.getElementById('healthScore');
            const scoreValue = scoreElement.querySelector('.score-value');
            scoreValue.textContent = health.score;
            
            // 设置分数颜色
            scoreElement.className = `score-circle ${this.getHealthClass(health.score)}`;
            
            // 更新状态
            const statusElement = document.getElementById('healthStatus');
            statusElement.innerHTML = `
                <span class="status-text ${health.status}">${this.getStatusText(health.status)}</span>
            `;

            // 更新详细信息
            document.getElementById('lastCheckTime').textContent = 
                health.lastCheck ? this.formatDateTime(health.lastCheck) : '从未检查';
            document.getElementById('issueCount').textContent = health.issues.length;
            document.getElementById('systemStatus').textContent = this.getStatusText(health.status);

            // 更新建议
            this.updateRecommendations(health.recommendations);

        } catch (error) {
            console.error('Failed to load system health:', error);
            this.showMessage('加载系统健康状态失败', 'error');
        }
    }

    /**
     * 更新优化建议
     */
    updateRecommendations(recommendations) {
        const container = document.getElementById('recommendationsList');
        
        if (!recommendations || recommendations.length === 0) {
            container.innerHTML = '<div class="no-recommendations">系统运行良好，暂无优化建议</div>';
            return;
        }

        container.innerHTML = recommendations.map(rec => `
            <div class="recommendation-item ${rec.priority}">
                <div class="rec-header">
                    <i class="fas fa-${this.getRecommendationIcon(rec.type)}"></i>
                    <span class="rec-title">${rec.title}</span>
                    <span class="rec-priority">${this.getPriorityText(rec.priority)}</span>
                </div>
                <div class="rec-description">${rec.description}</div>
                <div class="rec-suggestions">
                    ${rec.suggestions.map(s => `<div class="suggestion">• ${s}</div>`).join('')}
                </div>
            </div>
        `).join('');
    }

    /**
     * 运行诊断
     */
    async runDiagnostics() {
        try {
            this.showProgress('运行系统诊断...');
            
            const result = await this.diagnostics.checkExamIntegrity();
            
            this.hideProgress();
            this.showMessage('诊断完成', 'success');
            this.loadSystemHealth();
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`诊断失败: ${error.message}`, 'error');
        }
    }

    /**
     * 执行快速维护
     */
    async performQuickMaintenance() {
        try {
            this.showProgress('执行快速维护...');
            
            const tasks = ['cleanup_expired_data', 'recalculate_stats'];
            const result = await this.diagnostics.performMaintenance(tasks);
            
            this.hideProgress();
            
            if (result.summary.success) {
                this.showMessage('快速维护完成', 'success');
            } else {
                this.showMessage(`维护完成，但有 ${result.summary.failed} 个任务失败`, 'warning');
            }
            
            this.loadSystemHealth();
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`维护失败: ${error.message}`, 'error');
        }
    }

    /**
     * 清理缓存
     */
    async clearCache() {
        if (!confirm('确定要清理缓存吗？这将清除临时数据但保留重要信息。')) {
            return;
        }

        try {
            this.showProgress('清理缓存...');
            
            // 清理临时数据
            const tempKeys = ['temp_data', 'cache_data', 'session_cache'];
            tempKeys.forEach(key => {
                storage.remove(key);
            });
            
            this.hideProgress();
            this.showMessage('缓存清理完成', 'success');
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`缓存清理失败: ${error.message}`, 'error');
        }
    }

    /**
     * 开始完整性检查
     */
    async startIntegrityCheck() {
        try {
            this.showProgress('检查题库完整性...');
            
            const result = await this.diagnostics.checkExamIntegrity();
            
            this.hideProgress();
            this.displayDiagnosticResults(result);
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`完整性检查失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示诊断结果
     */
    displayDiagnosticResults(result) {
        const container = document.getElementById('diagnosticsResults');
        
        const statusClass = result.status === 'passed' ? 'success' : 
                           result.status === 'failed' ? 'error' : 'warning';
        
        container.innerHTML = `
            <div class="diagnostic-result ${statusClass}">
                <div class="result-header">
                    <i class="fas fa-${result.status === 'passed' ? 'check-circle' : 'exclamation-triangle'}"></i>
                    <span class="result-title">完整性检查${result.status === 'passed' ? '通过' : '发现问题'}</span>
                    <span class="result-time">${this.formatDateTime(result.timestamp)}</span>
                </div>
                
                <div class="result-summary">
                    <div class="summary-grid">
                        <div class="summary-item">
                            <span class="label">总题目数</span>
                            <span class="value">${result.summary.totalExams || 0}</span>
                        </div>
                        <div class="summary-item">
                            <span class="label">有效题目</span>
                            <span class="value">${result.summary.validExams || 0}</span>
                        </div>
                        <div class="summary-item">
                            <span class="label">发现问题</span>
                            <span class="value">${result.issues.length}</span>
                        </div>
                        <div class="summary-item">
                            <span class="label">警告</span>
                            <span class="value">${result.warnings.length}</span>
                        </div>
                    </div>
                </div>

                ${result.issues.length > 0 ? `
                    <div class="issues-section">
                        <h5>发现的问题</h5>
                        <div class="issues-list">
                            ${result.issues.map(issue => `
                                <div class="issue-item ${issue.severity}">
                                    <div class="issue-header">
                                        <span class="issue-type">${issue.type}</span>
                                        <span class="issue-severity">${this.getSeverityText(issue.severity)}</span>
                                    </div>
                                    <div class="issue-message">${issue.message}</div>
                                    ${issue.suggestion ? `<div class="issue-suggestion">建议: ${issue.suggestion}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                ${result.warnings.length > 0 ? `
                    <div class="warnings-section">
                        <h5>警告信息</h5>
                        <div class="warnings-list">
                            ${result.warnings.map(warning => `
                                <div class="warning-item">
                                    <div class="warning-message">${warning.message}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * 开始性能测试
     */
    async startPerformanceTest() {
        try {
            this.showProgress('运行性能测试...');
            
            const metrics = this.diagnostics.startPerformanceMonitoring();
            
            this.hideProgress();
            this.displayPerformanceMetrics(metrics);
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`性能测试失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示性能指标
     */
    displayPerformanceMetrics(metrics) {
        if (!metrics.data) return;

        // 内存使用
        if (metrics.data.memory) {
            const memUsage = (metrics.data.memory.used / 1024 / 1024).toFixed(1);
            const memTotal = (metrics.data.memory.total / 1024 / 1024).toFixed(1);
            document.getElementById('memoryUsage').textContent = `${memUsage}MB / ${memTotal}MB`;
        }

        // 存储性能
        if (metrics.data.storage) {
            const avgTime = ((metrics.data.storage.writeTime + metrics.data.storage.readTime) / 2).toFixed(2);
            document.getElementById('storagePerf').textContent = `${avgTime}ms`;
        }

        // 页面加载时间
        if (metrics.data.pageLoad) {
            const loadTime = (metrics.data.pageLoad.loadComplete / 1000).toFixed(2);
            document.getElementById('pageLoadTime').textContent = `${loadTime}s`;
        }

        // 题库操作性能
        if (metrics.data.examOperations) {
            const searchTime = metrics.data.examOperations.searchTime.toFixed(2);
            document.getElementById('examOpPerf').textContent = `${searchTime}ms`;
        }
    }

    /**
     * 加载性能指标
     */
    loadPerformanceMetrics() {
        // 显示最新的性能指标
        const latestMetrics = this.diagnostics.performanceMetrics[this.diagnostics.performanceMetrics.length - 1];
        if (latestMetrics) {
            this.displayPerformanceMetrics(latestMetrics);
        }
    }

    /**
     * 分析错误
     */
    async analyzeErrors() {
        try {
            this.showProgress('分析错误模式...');
            
            const analysis = this.diagnostics.analyzeErrorPatterns();
            
            this.hideProgress();
            this.displayErrorAnalysis(analysis);
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`错误分析失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示错误分析
     */
    displayErrorAnalysis(analysis) {
        // 更新摘要
        document.getElementById('totalErrors').textContent = analysis.totalErrors;
        document.getElementById('recentErrors').textContent = analysis.recentTrends.count;
        document.getElementById('errorRate').textContent = analysis.recentTrends.rate;

        // 显示错误列表
        const container = document.getElementById('errorLogs');
        
        if (analysis.totalErrors === 0) {
            container.innerHTML = '<div class="no-errors">暂无错误日志</div>';
            return;
        }

        container.innerHTML = `
            <div class="error-patterns">
                <h5>错误类型分布</h5>
                <div class="pattern-list">
                    ${analysis.frequentErrors.map(error => `
                        <div class="pattern-item">
                            <span class="pattern-type">${error.type}</span>
                            <span class="pattern-count">${error.count} 次</span>
                            <span class="pattern-percent">${error.percentage}%</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    /**
     * 加载错误分析
     */
    loadErrorAnalysis() {
        const analysis = this.diagnostics.analyzeErrorPatterns();
        this.displayErrorAnalysis(analysis);
    }

    /**
     * 清理错误日志
     */
    async clearErrorLogs() {
        if (!confirm('确定要清空所有错误日志吗？此操作不可撤销。')) {
            return;
        }

        try {
            this.diagnostics.clearErrorLogs();
            this.showMessage('错误日志已清空', 'success');
            this.loadErrorAnalysis();
            
        } catch (error) {
            this.showMessage(`清理失败: ${error.message}`, 'error');
        }
    }

    /**
     * 执行维护任务
     */
    async executeMaintenance() {
        const checkboxes = document.querySelectorAll('.task-list input[type="checkbox"]:checked');
        const selectedTasks = Array.from(checkboxes).map(cb => cb.value);

        if (selectedTasks.length === 0) {
            this.showMessage('请选择要执行的维护任务', 'warning');
            return;
        }

        const taskNames = selectedTasks.map(task => {
            const checkbox = document.querySelector(`input[value="${task}"]`);
            return checkbox.parentElement.querySelector('.task-name').textContent;
        });

        if (!confirm(`确定要执行以下维护任务吗？\n\n${taskNames.join('\n')}\n\n某些操作可能不可撤销。`)) {
            return;
        }

        try {
            this.showProgress('执行维护任务...');
            
            const result = await this.diagnostics.performMaintenance(selectedTasks);
            
            this.hideProgress();
            this.displayMaintenanceResults(result);
            
            // 清空选择
            checkboxes.forEach(cb => cb.checked = false);
            
        } catch (error) {
            this.hideProgress();
            this.showMessage(`维护执行失败: ${error.message}`, 'error');
        }
    }

    /**
     * 显示维护结果
     */
    displayMaintenanceResults(result) {
        const container = document.getElementById('maintenanceResults');
        
        const statusClass = result.summary.success ? 'success' : 'warning';
        
        container.innerHTML = `
            <div class="maintenance-result ${statusClass}">
                <div class="result-header">
                    <i class="fas fa-${result.summary.success ? 'check-circle' : 'exclamation-triangle'}"></i>
                    <span class="result-title">维护任务${result.summary.success ? '完成' : '部分完成'}</span>
                    <span class="result-time">${this.formatDateTime(result.timestamp)}</span>
                </div>
                
                <div class="result-summary">
                    <div class="summary-item">
                        <span class="label">总任务数</span>
                        <span class="value">${result.summary.total}</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">成功完成</span>
                        <span class="value">${result.summary.completed}</span>
                    </div>
                    <div class="summary-item">
                        <span class="label">执行失败</span>
                        <span class="value">${result.summary.failed}</span>
                    </div>
                </div>

                ${result.completedTasks.length > 0 ? `
                    <div class="completed-tasks">
                        <h5>已完成任务</h5>
                        <ul>
                            ${result.completedTasks.map(task => `<li>${task}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}

                ${result.failedTasks.length > 0 ? `
                    <div class="failed-tasks">
                        <h5>失败任务</h5>
                        <ul>
                            ${result.failedTasks.map(item => `
                                <li>${item.task}: ${item.error}</li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * 显示进度
     */
    showProgress(text) {
        const overlay = document.getElementById('progressOverlay');
        const progressText = document.getElementById('progressText');

        progressText.textContent = text;
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(overlay, { display: 'flex' });
        } else {
            overlay.style.display = 'flex';
        }
    }

    /**
     * 隐藏进度
     */
    hideProgress() {
        const overlay = document.getElementById('progressOverlay');
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(overlay, { display: 'none' });
        } else {
            overlay.style.display = 'none';
        }
    }

    /**
     * 显示消息
     */
    showMessage(message, type = 'info') {
        const messageEl = document.createElement('div');
        messageEl.className = `message-toast ${type}`;
        messageEl.innerHTML = `
            <i class="fas fa-${this.getMessageIcon(type)}"></i>
            <span>${message}</span>
        `;

        document.body.appendChild(messageEl);

        setTimeout(() => {
            messageEl.remove();
        }, 5000);
    }

    /**
     * 获取健康状态类名
     */
    getHealthClass(score) {
        if (score >= 80) return 'healthy';
        if (score >= 60) return 'warning';
        return 'critical';
    }

    /**
     * 获取状态文本
     */
    getStatusText(status) {
        const statusMap = {
            healthy: '健康',
            warning: '警告',
            critical: '严重'
        };
        return statusMap[status] || status;
    }

    /**
     * 获取优先级文本
     */
    getPriorityText(priority) {
        const priorityMap = {
            critical: '严重',
            high: '高',
            medium: '中',
            low: '低'
        };
        return priorityMap[priority] || priority;
    }

    /**
     * 获取严重程度文本
     */
    getSeverityText(severity) {
        const severityMap = {
            critical: '严重',
            high: '高',
            medium: '中',
            low: '低'
        };
        return severityMap[severity] || severity;
    }

    /**
     * 获取建议图标
     */
    getRecommendationIcon(type) {
        const iconMap = {
            memory: 'memory',
            storage: 'hdd',
            integrity: 'shield-alt',
            stability: 'heartbeat',
            performance: 'tachometer-alt'
        };
        return iconMap[type] || 'info-circle';
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
window.SystemMaintenancePanel = SystemMaintenancePanel;