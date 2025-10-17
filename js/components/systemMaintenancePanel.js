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

        this.domTools = this.resolveDomTools();

        // 全局引用，供事件委托使用
        window.systemMaintenancePanel = this;

        this.initialize();
    }

    resolveDomTools() {
        if (typeof window !== 'undefined' && window.DOM && window.DOM.builder) {
            return {
                create: window.DOM.create,
                fragment: (items, factory) => window.DOM.builder.createFragment(items, factory),
                replace: (container, content) => window.DOM.replaceContent(container, content)
            };
        }

        if (typeof window !== 'undefined' && window.DOMBuilder && typeof window.DOMBuilder.create === 'function') {
            const builder = window.DOMBuilder;
            return {
                create: (tag, attrs, children) => builder.create(tag, attrs, children),
                fragment: (items, factory) => builder.createFragment(items, factory),
                replace: (container, content) => builder.replaceContent(container, content)
            };
        }

        return this.createFallbackDomTools();
    }

    createFallbackDomTools() {
        const panel = this;
        return {
            create(tag, attributes = {}, children = []) {
                const element = document.createElement(tag);

                Object.entries(attributes).forEach(([key, value]) => {
                    if (value == null) {
                        return;
                    }
                    if (key === 'className') {
                        element.className = value;
                        return;
                    }
                    if (key === 'dataset' && typeof value === 'object') {
                        Object.entries(value).forEach(([dataKey, dataValue]) => {
                            if (dataValue != null) {
                                element.dataset[dataKey] = String(dataValue);
                            }
                        });
                        return;
                    }
                    if (key === 'style' && typeof value === 'object') {
                        Object.assign(element.style, value);
                        return;
                    }
                    element.setAttribute(key, value);
                });

                panel.normalizeChildren(children).forEach((child) => element.appendChild(child));
                return element;
            },

            fragment(items, factory) {
                const fragment = document.createDocumentFragment();
                (items || []).forEach((item) => {
                    const element = factory(item);
                    if (element) {
                        fragment.appendChild(element);
                    }
                });
                return fragment;
            },

            replace(container, content) {
                while (container.firstChild) {
                    container.removeChild(container.firstChild);
                }

                const append = (value) => {
                    panel.normalizeChildren(value).forEach((node) => container.appendChild(node));
                };

                if (typeof content === 'function') {
                    append(content());
                } else {
                    append(content);
                }
            }
        };
    }

    normalizeChildren(children) {
        const list = Array.isArray(children) ? children : [children];
        const nodes = [];

        list.forEach((child) => {
            if (child == null) {
                return;
            }
            if (typeof child === 'string') {
                nodes.push(document.createTextNode(child));
                return;
            }
            if (child instanceof Node) {
                nodes.push(child);
            }
        });

        return nodes;
    }

    replaceChildren(container, children) {
        if (!container) {
            return;
        }

        const replacer = () => this.normalizeChildren(children);

        if (this.domTools && typeof this.domTools.replace === 'function') {
            this.domTools.replace(container, replacer);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        replacer().forEach((node) => container.appendChild(node));
    }

    createIcon(iconClass) {
        return this.domTools.create('i', { className: iconClass });
    }

    buildIconText(iconClass, text) {
        const nodes = [];
        if (iconClass) {
            nodes.push(this.createIcon(iconClass));
        }
        if (text != null && text !== '') {
            const value = String(text);
            nodes.push(document.createTextNode(iconClass ? ` ${value}` : value));
        }
        return nodes;
    }

    createActionButton(className, action, iconClass, text) {
        return this.domTools.create('button', {
            className,
            dataset: { action }
        }, this.buildIconText(iconClass, text));
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
        const panel = this.domTools.create('div', { className: 'system-maintenance-panel' }, [
            this.buildHeader(),
            this.buildTabs(),
            this.buildPanelContent(),
            this.buildProgressOverlay()
        ]);

        this.replaceChildren(this.container, panel);
    }

    buildHeader() {
        return this.domTools.create('div', { className: 'panel-header' }, [
            this.domTools.create('h3', {}, this.buildIconText('fas fa-tools', '系统维护')),
            this.domTools.create('button', {
                className: 'close-btn',
                dataset: { action: 'close' }
            }, [this.createIcon('fas fa-times')])
        ]);
    }

    buildTabs() {
        const tabs = [
            { key: 'health', label: '系统健康', active: true },
            { key: 'diagnostics', label: '完整性检查' },
            { key: 'performance', label: '性能监控' },
            { key: 'errors', label: '错误日志' },
            { key: 'maintenance', label: '系统维护' }
        ];

        return this.domTools.create('div', { className: 'panel-tabs' },
            tabs.map((tab) => this.domTools.create('button', {
                className: `tab-btn${tab.active ? ' active' : ''}`,
                dataset: { tab: tab.key }
            }, [tab.label]))
        );
    }

    buildPanelContent() {
        return this.domTools.create('div', { className: 'panel-content' }, [
            this.buildHealthTab(),
            this.buildDiagnosticsTab(),
            this.buildPerformanceTab(),
            this.buildErrorsTab(),
            this.buildMaintenanceTab()
        ]);
    }

    buildHealthTab() {
        return this.domTools.create('div', { className: 'tab-content active', id: 'healthTab' }, [
            this.buildHealthOverview(),
            this.buildRecommendationsSection(),
            this.buildQuickActionsSection()
        ]);
    }

    buildHealthOverview() {
        return this.domTools.create('div', { className: 'health-overview' }, [
            this.domTools.create('div', { className: 'health-score-card' }, [
                this.domTools.create('div', { className: 'score-circle', id: 'healthScore' }, [
                    this.domTools.create('span', { className: 'score-value' }, ['--']),
                    this.domTools.create('span', { className: 'score-label' }, ['健康分数'])
                ]),
                this.domTools.create('div', { className: 'health-status', id: 'healthStatus' }, [
                    this.domTools.create('span', { className: 'status-text' }, ['检查中...'])
                ])
            ]),
            this.domTools.create('div', { className: 'health-details' }, [
                this.createDetailItem('最后检查时间', 'lastCheckTime'),
                this.createDetailItem('发现问题', 'issueCount'),
                this.createDetailItem('系统状态', 'systemStatus')
            ])
        ]);
    }

    createDetailItem(label, valueId) {
        return this.domTools.create('div', { className: 'detail-item' }, [
            this.domTools.create('span', { className: 'detail-label' }, [label]),
            this.domTools.create('span', { className: 'detail-value', id: valueId }, ['-'])
        ]);
    }

    buildRecommendationsSection() {
        return this.domTools.create('div', { className: 'recommendations-section' }, [
            this.domTools.create('h4', {}, ['优化建议']),
            this.domTools.create('div', { className: 'recommendations-list', id: 'recommendationsList' }, [
                this.domTools.create('div', { className: 'no-recommendations' }, ['暂无建议'])
            ])
        ]);
    }

    buildQuickActionsSection() {
        const actions = [
            { action: 'runDiagnostics', icon: 'fas fa-search', text: '运行诊断' },
            { action: 'performMaintenance', icon: 'fas fa-wrench', text: '执行维护' },
            { action: 'clearCache', icon: 'fas fa-broom', text: '清理缓存' }
        ];

        return this.domTools.create('div', { className: 'quick-actions' }, [
            this.domTools.create('h4', {}, ['快速操作']),
            this.domTools.create('div', { className: 'action-buttons' },
                actions.map((action) => this.createActionButton('action-btn', action.action, action.icon, action.text))
            )
        ]);
    }

    buildDiagnosticsTab() {
        return this.domTools.create('div', { className: 'tab-content', id: 'diagnosticsTab' }, [
            this.domTools.create('div', { className: 'diagnostics-controls' }, [
                this.createActionButton('primary-btn', 'startIntegrityCheck', 'fas fa-play', '开始完整性检查'),
                this.createActionButton('secondary-btn', 'viewDiagnosticHistory', 'fas fa-history', '查看历史')
            ]),
            this.domTools.create('div', { className: 'diagnostics-results', id: 'diagnosticsResults' }, [
                this.domTools.create('div', { className: 'no-results' }, ['点击上方按钮开始诊断'])
            ])
        ]);
    }

    buildPerformanceTab() {
        return this.domTools.create('div', { className: 'tab-content', id: 'performanceTab' }, [
            this.domTools.create('div', { className: 'performance-controls' }, [
                this.createActionButton('primary-btn', 'startPerformanceTest', 'fas fa-tachometer-alt', '开始性能测试'),
                this.createActionButton('secondary-btn', 'viewPerformanceHistory', 'fas fa-chart-line', '查看历史数据')
            ]),
            this.domTools.create('div', { className: 'performance-metrics', id: 'performanceMetrics' }, [
                this.domTools.create('div', { className: 'metrics-grid' }, [
                    this.createMetricCard('内存使用', 'memoryUsage'),
                    this.createMetricCard('存储性能', 'storagePerf'),
                    this.createMetricCard('页面加载', 'pageLoadTime'),
                    this.createMetricCard('题库操作', 'examOpPerf')
                ])
            ])
        ]);
    }

    createMetricCard(title, valueId) {
        return this.domTools.create('div', { className: 'metric-card' }, [
            this.domTools.create('div', { className: 'metric-title' }, [title]),
            this.domTools.create('div', { className: 'metric-value', id: valueId }, ['-'])
        ]);
    }

    buildErrorsTab() {
        return this.domTools.create('div', { className: 'tab-content', id: 'errorsTab' }, [
            this.domTools.create('div', { className: 'errors-controls' }, [
                this.createActionButton('primary-btn', 'analyzeErrors', 'fas fa-chart-pie', '分析错误模式'),
                this.createActionButton('secondary-btn', 'exportErrorLogs', 'fas fa-download', '导出日志'),
                this.createActionButton('danger-btn', 'clearErrorLogs', 'fas fa-trash', '清空日志')
            ]),
            this.domTools.create('div', { className: 'error-analysis', id: 'errorAnalysis' }, [
                this.domTools.create('div', { className: 'analysis-summary' }, [
                    this.createSummaryItem('总错误数', 'totalErrors'),
                    this.createSummaryItem('24小时内', 'recentErrors'),
                    this.createSummaryItem('错误率', 'errorRate')
                ])
            ]),
            this.domTools.create('div', { className: 'error-logs', id: 'errorLogs' }, [
                this.domTools.create('div', { className: 'no-errors' }, ['暂无错误日志'])
            ])
        ]);
    }

    createSummaryItem(label, valueId) {
        return this.domTools.create('div', { className: 'summary-item' }, [
            this.domTools.create('span', { className: 'summary-label' }, [label]),
            this.domTools.create('span', { className: 'summary-value', id: valueId }, ['-'])
        ]);
    }

    buildMaintenanceTab() {
        return this.domTools.create('div', { className: 'tab-content', id: 'maintenanceTab' }, [
            this.domTools.create('div', { className: 'maintenance-tasks' }, [
                this.domTools.create('h4', {}, ['维护任务']),
                this.buildTaskList(),
                this.domTools.create('div', { className: 'maintenance-controls' }, [
                    this.createActionButton('primary-btn', 'executeMaintenance', 'fas fa-cog', '执行选中任务'),
                    this.createActionButton('secondary-btn', 'viewMaintenanceHistory', 'fas fa-history', '维护历史')
                ])
            ]),
            this.domTools.create('div', { className: 'maintenance-results', id: 'maintenanceResults' }, [
                this.domTools.create('div', { className: 'no-results' }, ['选择维护任务并点击执行'])
            ])
        ]);
    }

    buildTaskList() {
        const tasks = [
            { value: 'cleanup_expired_data', name: '清理过期数据', desc: '删除超过1年的练习记录' },
            { value: 'rebuild_index', name: '重建题库索引', desc: '重新扫描并索引所有题目' },
            { value: 'recalculate_stats', name: '重新计算统计', desc: '重新计算用户统计数据' },
            { value: 'compress_data', name: '压缩存储数据', desc: '优化数据结构，减少存储空间' },
            { value: 'clear_error_logs', name: '清理错误日志', desc: '清空所有错误日志记录' }
        ];

        return this.domTools.create('div', { className: 'task-list' },
            tasks.map((task) => this.domTools.create('label', { className: 'task-item' }, [
                this.domTools.create('input', { type: 'checkbox', value: task.value }),
                this.domTools.create('span', { className: 'task-name' }, [task.name]),
                this.domTools.create('span', { className: 'task-desc' }, [task.desc])
            ]))
        );
    }

    buildProgressOverlay() {
        return this.domTools.create('div', {
            className: 'progress-overlay',
            id: 'progressOverlay',
            style: { display: 'none' }
        }, [
            this.domTools.create('div', { className: 'progress-content' }, [
                this.domTools.create('div', { className: 'spinner' }),
                this.domTools.create('div', { className: 'progress-text', id: 'progressText' }, ['处理中...'])
            ])
        ]);
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
            this.replaceChildren(statusElement, this.domTools.create('span', {
                className: `status-text ${health.status}`
            }, [this.getStatusText(health.status)]));

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

        if (!container) {
            return;
        }

        if (!recommendations || recommendations.length === 0) {
            this.replaceChildren(container, this.domTools.create('div', {
                className: 'no-recommendations'
            }, ['系统运行良好，暂无优化建议']));
            return;
        }

        const items = recommendations.map((rec) => {
            const priority = rec && rec.priority ? rec.priority : 'low';
            const suggestions = Array.isArray(rec && rec.suggestions) ? rec.suggestions : [];

            return this.domTools.create('div', {
                className: `recommendation-item ${priority}`
            }, [
                this.domTools.create('div', { className: 'rec-header' }, [
                    this.createIcon(`fas fa-${this.getRecommendationIcon(rec && rec.type)}`),
                    this.domTools.create('span', { className: 'rec-title' }, [rec && rec.title ? rec.title : '未命名建议']),
                    this.domTools.create('span', { className: 'rec-priority' }, [this.getPriorityText(priority)])
                ]),
                this.domTools.create('div', { className: 'rec-description' }, [rec && rec.description ? rec.description : '']),
                this.domTools.create('div', { className: 'rec-suggestions' },
                    suggestions.map((suggestion) => this.domTools.create('div', { className: 'suggestion' }, [`• ${suggestion}`]))
                )
            ]);
        });

        this.replaceChildren(container, items);
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

        if (!container) {
            return;
        }

        const statusClass = result.status === 'passed' ? 'success'
            : result.status === 'failed' ? 'error' : 'warning';

        const header = this.domTools.create('div', { className: 'result-header' }, [
            this.createIcon(`fas fa-${result.status === 'passed' ? 'check-circle' : 'exclamation-triangle'}`),
            this.domTools.create('span', { className: 'result-title' }, [
                `完整性检查${result.status === 'passed' ? '通过' : '发现问题'}`
            ]),
            this.domTools.create('span', { className: 'result-time' }, [
                this.formatDateTime(result.timestamp)
            ])
        ]);

        const summaryItems = [
            { label: '总题目数', value: result.summary.totalExams || 0 },
            { label: '有效题目', value: result.summary.validExams || 0 },
            { label: '发现问题', value: (result.issues || []).length },
            { label: '警告', value: (result.warnings || []).length }
        ];

        const summary = this.domTools.create('div', { className: 'result-summary' }, [
            this.domTools.create('div', { className: 'summary-grid' },
                summaryItems.map((item) => this.domTools.create('div', { className: 'summary-item' }, [
                    this.domTools.create('span', { className: 'label' }, [item.label]),
                    this.domTools.create('span', { className: 'value' }, [String(item.value)])
                ]))
            )
        ]);

        const sections = [header, summary];

        if (Array.isArray(result.issues) && result.issues.length > 0) {
            const issueItems = result.issues.map((issue) => {
                const nodes = [
                    this.domTools.create('div', { className: 'issue-header' }, [
                        this.domTools.create('span', { className: 'issue-type' }, [issue.type || '未知问题']),
                        this.domTools.create('span', { className: 'issue-severity' }, [
                            this.getSeverityText(issue.severity)
                        ])
                    ]),
                    this.domTools.create('div', { className: 'issue-message' }, [issue.message || ''])
                ];

                if (issue.suggestion) {
                    nodes.push(this.domTools.create('div', { className: 'issue-suggestion' }, [
                        `建议: ${issue.suggestion}`
                    ]));
                }

                return this.domTools.create('div', {
                    className: `issue-item ${issue.severity || 'low'}`
                }, nodes);
            });

            sections.push(this.domTools.create('div', { className: 'issues-section' }, [
                this.domTools.create('h5', {}, ['发现的问题']),
                this.domTools.create('div', { className: 'issues-list' }, issueItems)
            ]));
        }

        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            const warningItems = result.warnings.map((warning) => this.domTools.create('div', {
                className: 'warning-item'
            }, [
                this.domTools.create('div', { className: 'warning-message' }, [warning.message || ''])
            ]));

            sections.push(this.domTools.create('div', { className: 'warnings-section' }, [
                this.domTools.create('h5', {}, ['警告信息']),
                this.domTools.create('div', { className: 'warnings-list' }, warningItems)
            ]));
        }

        const resultNode = this.domTools.create('div', {
            className: `diagnostic-result ${statusClass}`
        }, sections);

        this.replaceChildren(container, resultNode);
    }

    /**
     * 开始性能测试
     */
    async startPerformanceTest() {
        try {
            this.showProgress('运行性能测试...');

            const metrics = await this.diagnostics.startPerformanceMonitoring();

            this.hideProgress();
            if (metrics) {
                this.displayPerformanceMetrics(metrics);
            } else {
                this.showMessage('未获取到性能指标数据', 'warning');
            }

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

        if (!container) {
            return;
        }

        if (analysis.totalErrors === 0) {
            this.replaceChildren(container, this.domTools.create('div', {
                className: 'no-errors'
            }, ['暂无错误日志']));
            return;
        }

        const patterns = (analysis.frequentErrors || []).map((error) => this.domTools.create('div', {
            className: 'pattern-item'
        }, [
            this.domTools.create('span', { className: 'pattern-type' }, [error.type || '未知类型']),
            this.domTools.create('span', { className: 'pattern-count' }, [`${error.count || 0} 次`]),
            this.domTools.create('span', { className: 'pattern-percent' }, [`${error.percentage || 0}%`])
        ]));

        const content = this.domTools.create('div', { className: 'error-patterns' }, [
            this.domTools.create('h5', {}, ['错误类型分布']),
            this.domTools.create('div', { className: 'pattern-list' }, patterns)
        ]);

        this.replaceChildren(container, content);
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

        if (!container) {
            return;
        }

        const statusClass = result.summary.success ? 'success' : 'warning';

        const header = this.domTools.create('div', { className: 'result-header' }, [
            this.createIcon(`fas fa-${result.summary.success ? 'check-circle' : 'exclamation-triangle'}`),
            this.domTools.create('span', { className: 'result-title' }, [
                `维护任务${result.summary.success ? '完成' : '部分完成'}`
            ]),
            this.domTools.create('span', { className: 'result-time' }, [
                this.formatDateTime(result.timestamp)
            ])
        ]);

        const summaryItems = [
            { label: '总任务数', value: result.summary.total },
            { label: '成功完成', value: result.summary.completed },
            { label: '执行失败', value: result.summary.failed }
        ];

        const summary = this.domTools.create('div', { className: 'result-summary' },
            summaryItems.map((item) => this.domTools.create('div', { className: 'summary-item' }, [
                this.domTools.create('span', { className: 'label' }, [item.label]),
                this.domTools.create('span', { className: 'value' }, [String(item.value)])
            ]))
        );

        const sections = [header, summary];

        if (Array.isArray(result.completedTasks) && result.completedTasks.length > 0) {
            sections.push(this.domTools.create('div', { className: 'completed-tasks' }, [
                this.domTools.create('h5', {}, ['已完成任务']),
                this.domTools.create('ul', {}, result.completedTasks.map((task) =>
                    this.domTools.create('li', {}, [task])
                ))
            ]));
        }

        if (Array.isArray(result.failedTasks) && result.failedTasks.length > 0) {
            sections.push(this.domTools.create('div', { className: 'failed-tasks' }, [
                this.domTools.create('h5', {}, ['失败任务']),
                this.domTools.create('ul', {}, result.failedTasks.map((item) =>
                    this.domTools.create('li', {}, [`${item.task}: ${item.error}`])
                ))
            ]));
        }

        const resultNode = this.domTools.create('div', {
            className: `maintenance-result ${statusClass}`
        }, sections);

        this.replaceChildren(container, resultNode);
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
        const messageEl = this.domTools.create('div', {
            className: `message-toast ${type}`
        }, this.buildIconText(`fas fa-${this.getMessageIcon(type)}`, message));

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