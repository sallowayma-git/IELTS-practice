/**
 * 个性化推荐显示组件
 * 负责展示基于用户历史表现的个性化推荐
 */
class RecommendationDisplay {
    constructor() {
        this.recommendationEngine = null;
        this.currentRecommendations = null;
        this.refreshInterval = null;

        // 全局引用，供事件委托使用
        window.recommendationDisplay = this;

        this.ready = this.initialize();
    }

    /**
     * 初始化推荐显示组件
     */
    async initialize() {
        console.log('RecommendationDisplay component initialized');

        // 初始化推荐引擎
        if (window.RecommendationEngine) {
            this.recommendationEngine = new RecommendationEngine();
        }

        this.setupEventListeners();
        await this.loadRecommendations();

        // 定期刷新推荐
        await this.startAutoRefresh();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 推荐项点击事件
            window.DOM.delegate('click', '.recommendation-item', function(e) {
                const recommendationId = this.dataset.recommendationId;
                window.recommendationDisplay.handleRecommendationClick(recommendationId, e);
            });

            // 刷新推荐按钮
            window.DOM.delegate('click', '.refresh-recommendations', function(e) {
                e.preventDefault();
                window.recommendationDisplay.refreshRecommendations()
                    .catch(error => console.error('[RecommendationDisplay] 刷新推荐失败', error));
            });

            // 推荐设置按钮
            window.DOM.delegate('click', '.recommendation-settings', function(e) {
                e.preventDefault();
                window.recommendationDisplay.showRecommendationSettings();
            });

            console.log('[RecommendationDisplay] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            document.addEventListener('click', (e) => {
                const recommendationItem = e.target.closest('.recommendation-item');
                if (recommendationItem) {
                    const recommendationId = recommendationItem.dataset.recommendationId;
                    this.handleRecommendationClick(recommendationId, e);
                }

                const refreshBtn = e.target.closest('.refresh-recommendations');
                if (refreshBtn) {
                    e.preventDefault();
                    this.refreshRecommendations()
                        .catch(error => console.error('[RecommendationDisplay] 刷新推荐失败', error));
                }

                const settingsBtn = e.target.closest('.recommendation-settings');
                if (settingsBtn) {
                    e.preventDefault();
                    this.showRecommendationSettings();
                }
            });
        }

        // 自定义事件监听（这些事件不能用DOM.delegate处理）
        document.addEventListener('practiceSessionCompleted', () => {
            setTimeout(() => {
                window.recommendationDisplay.loadRecommendations();
            }, 1000);
        });
    }

    /**
     * 并行加载题库与练习记录
     */
    async fetchExamData() {
        const [examIndex = [], practiceRecords = []] = await Promise.all([
            storage.get('exam_index', []),
            storage.get('practice_records', [])
        ]);
        return { examIndex, practiceRecords };
    }

    /**
     * 加载个性化推荐
     */
    async loadRecommendations() {
        if (!this.recommendationEngine) {
            console.warn('RecommendationEngine not available');
            await this.showFallbackRecommendations();
            return;
        }

        try {
            this.showLoadingState();
            
            // 生成个性化推荐
            const userId = 'default-user'; // 可以从用户设置中获取
            const recommendations = this.recommendationEngine.generateRecommendations(userId, {
                maxRecommendations: 8
            });
            
            this.currentRecommendations = recommendations;
            this.renderRecommendations(recommendations);
            
        } catch (error) {
            console.error('Failed to load recommendations:', error);
            this.showErrorState();
        }
    }

    /**
     * 渲染推荐内容
     */
    renderRecommendations(recommendationData) {
        const container = this.getRecommendationContainer();
        if (!container) return;

        const { recommendations, strategy } = recommendationData;

        container.innerHTML = `
            <div class="recommendation-header">
                <div class="recommendation-title-group">
                    <h3>个性化推荐</h3>
                    <span class="recommendation-subtitle">基于您的学习表现定制</span>
                </div>
                <div class="recommendation-actions">
                    <button class="btn btn-sm btn-outline refresh-recommendations" title="刷新推荐">
                        <span class="btn-icon">🔄</span>
                    </button>
                    <button class="btn btn-sm btn-outline recommendation-settings" title="推荐设置">
                        <span class="btn-icon">⚙️</span>
                    </button>
                </div>
            </div>
            
            <div class="recommendation-strategy">
                <div class="strategy-info">
                    <span class="strategy-label">推荐策略:</span>
                    <span class="strategy-value">${this.getStrategyLabel(strategy.primaryFocus)}</span>
                </div>
                ${strategy.targetAreas.length > 0 ? `
                    <div class="target-areas">
                        <span class="areas-label">重点关注:</span>
                        <div class="areas-tags">
                            ${strategy.targetAreas.map(area => `
                                <span class="area-tag">${this.getAreaLabel(area)}</span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            
            <div class="recommendations-grid">
                ${recommendations.map(rec => this.createRecommendationCard(rec)).join('')}
            </div>
            
            ${strategy.learningPath.length > 0 ? `
                <div class="learning-path-section">
                    <h4>学习路径规划</h4>
                    <div class="learning-path">
                        ${strategy.learningPath.map(phase => this.createLearningPhaseCard(phase)).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="recommendation-footer">
                <div class="recommendation-meta">
                    <span class="update-time">更新时间: ${Utils.formatDateTime(recommendationData.timestamp)}</span>
                    <span class="recommendation-count">${recommendations.length} 个推荐</span>
                </div>
            </div>
        `;
    }

    /**
     * 创建推荐卡片
     */
    createRecommendationCard(recommendation) {
        const priorityClass = this.getPriorityClass(recommendation.priority);
        const difficultyLabel = this.getDifficultyLabel(recommendation.difficulty);
        
        return `
            <div class="recommendation-item ${priorityClass}" data-recommendation-id="${recommendation.id}">
                <div class="recommendation-card">
                    <div class="recommendation-header">
                        <div class="recommendation-type">
                            <span class="type-icon">${this.getTypeIcon(recommendation.type)}</span>
                            <span class="type-label">${this.getTypeLabel(recommendation.type)}</span>
                        </div>
                        <div class="recommendation-priority">
                            <span class="priority-indicator ${priorityClass}"></span>
                        </div>
                    </div>
                    
                    <div class="recommendation-content">
                        <h4 class="recommendation-title">${recommendation.title}</h4>
                        <p class="recommendation-description">${recommendation.description}</p>
                        
                        <div class="recommendation-details">
                            <div class="detail-item">
                                <span class="detail-label">分类:</span>
                                <span class="detail-value">${this.getCategoryLabel(recommendation.category)}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">难度:</span>
                                <span class="detail-value difficulty-${recommendation.difficulty}">${difficultyLabel}</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">预计用时:</span>
                                <span class="detail-value">${recommendation.estimatedTime} 分钟</span>
                            </div>
                        </div>
                        
                        ${recommendation.questionTypes && recommendation.questionTypes.length > 0 ? `
                            <div class="question-types">
                                <span class="types-label">题型:</span>
                                <div class="types-list">
                                    ${recommendation.questionTypes.map(type => `
                                        <span class="question-type-tag">${this.getQuestionTypeLabel(type)}</span>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        
                        <div class="recommendation-reasoning">
                            <span class="reasoning-icon">💡</span>
                            <span class="reasoning-text">${recommendation.reasoning}</span>
                        </div>
                    </div>
                    
                    <div class="recommendation-actions">
                        <button class="btn btn-primary start-practice" data-recommendation-id="${recommendation.id}">
                            <span class="btn-icon">▶️</span>
                            开始练习
                        </button>
                        <button class="btn btn-secondary view-details" data-recommendation-id="${recommendation.id}">
                            <span class="btn-icon">👁️</span>
                            查看详情
                        </button>
                    </div>
                    
                    <div class="recommendation-tags">
                        ${recommendation.tags.map(tag => `
                            <span class="recommendation-tag">${tag}</span>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 创建学习阶段卡片
     */
    createLearningPhaseCard(phase) {
        return `
            <div class="learning-phase-card">
                <div class="phase-header">
                    <h5 class="phase-title">${this.getPhaseLabel(phase.phase)}</h5>
                    <span class="phase-duration">${phase.duration}</span>
                </div>
                
                <div class="phase-goals">
                    <h6>目标:</h6>
                    <ul class="goals-list">
                        ${phase.goals.map(goal => `<li>${goal}</li>`).join('')}
                    </ul>
                </div>
                
                ${phase.recommendations && phase.recommendations.length > 0 ? `
                    <div class="phase-recommendations">
                        <h6>推荐练习:</h6>
                        <div class="phase-rec-list">
                            ${phase.recommendations.slice(0, 3).map(rec => `
                                <div class="phase-rec-item">
                                    <span class="rec-title">${rec.title}</span>
                                    <span class="rec-category">${this.getCategoryLabel(rec.category)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * 获取推荐容器
     */
    getRecommendationContainer() {
        let container = document.getElementById('recommendation-display');
        
        if (!container) {
            // 如果容器不存在，创建一个
            container = this.createRecommendationContainer();
        }
        
        return container;
    }

    /**
     * 创建推荐容器
     */
    createRecommendationContainer() {
        const overviewView = document.getElementById('overview-view');
        if (!overviewView) return null;

        const container = document.createElement('div');
        container.id = 'recommendation-display';
        container.className = 'recommendation-display';

        // 插入到合适的位置（在分类网格之后）
        const categoryGrid = overviewView.querySelector('.category-grid');
        if (categoryGrid) {
            categoryGrid.insertAdjacentElement('afterend', container);
        } else {
            overviewView.appendChild(container);
        }

        return container;
    }

    /**
     * 处理推荐项点击
     */
    handleRecommendationClick(recommendationId, event) {
        if (!this.currentRecommendations) return;

        const recommendation = this.currentRecommendations.recommendations.find(r => r.id === recommendationId);
        if (!recommendation) return;

        const target = event.target.closest('button');
        if (!target) return;

        if (target.classList.contains('start-practice')) {
            this.startRecommendedPractice(recommendation)
                .catch(error => console.error('[RecommendationDisplay] 启动推荐练习失败', error));
        } else if (target.classList.contains('view-details')) {
            this.showRecommendationDetails(recommendation);
        }
    }

    /**
     * 开始推荐的练习
     */
    async startRecommendedPractice(recommendation) {
        try {
            const { examIndex, practiceRecords } = await this.fetchExamData();
            let targetExams = [];

            // 根据推荐的分类和题型筛选题目
            if (recommendation.category === 'mixed') {
                targetExams = examIndex;
            } else {
                targetExams = examIndex.filter(exam => exam.category === recommendation.category);
            }

            // 根据题型进一步筛选
            if (recommendation.questionTypes && recommendation.questionTypes.length > 0) {
                targetExams = targetExams.filter(exam => {
                    return recommendation.questionTypes.some(type =>
                        exam.questionTypes && exam.questionTypes.includes(type)
                    );
                });
            }

            // 根据难度筛选
            if (recommendation.difficulty !== 'medium') {
                targetExams = targetExams.filter(exam => {
                    const examDifficulty = this.getExamDifficulty(exam);
                    return examDifficulty === recommendation.difficulty;
                });
            }

            if (targetExams.length === 0) {
                window.showMessage('暂无符合推荐条件的题目', 'warning');
                return;
            }

            // 选择最合适的题目
            const selectedExam = this.selectBestMatchingExam(targetExams, recommendation, practiceRecords);

            // 记录推荐使用
            await this.recordRecommendationUsage(recommendation.id, selectedExam.id);

            // 开始练习
            if (window.app && typeof window.app.openExam === 'function') {
                window.app.openExam(selectedExam.id);
            }

            window.showMessage(`开始推荐练习: ${selectedExam.title}`, 'info');
        } catch (error) {
            console.error('[RecommendationDisplay] 启动推荐练习失败', error);
            window.showMessage('无法开始推荐练习，请稍后重试', 'error');
        }
    }

    /**
     * 选择最匹配的题目
     */
    selectBestMatchingExam(exams, recommendation, practiceRecords) {
        const practiceHistory = new Set(practiceRecords.map(r => r.examId));

        // 优先选择未练习过的题目
        const unpracticedExams = exams.filter(exam => !practiceHistory.has(exam.id));
        
        if (unpracticedExams.length > 0) {
            // 从未练习的题目中随机选择
            return unpracticedExams[Math.floor(Math.random() * unpracticedExams.length)];
        }

        // 如果都练习过，选择表现最差的题目
        const examPerformance = exams.map(exam => {
            const examRecords = practiceRecords.filter(r => r.examId === exam.id);
            const avgAccuracy = examRecords.length > 0 
                ? examRecords.reduce((sum, r) => sum + (r.accuracy || 0), 0) / examRecords.length
                : 0;
            return { exam, avgAccuracy };
        });

        examPerformance.sort((a, b) => a.avgAccuracy - b.avgAccuracy);
        return examPerformance[0].exam;
    }

    /**
     * 获取题目难度
     */
    getExamDifficulty(exam) {
        // 基于分类判断难度
        if (exam.category === 'P1') return 'easy';
        if (exam.category === 'P3') return 'hard';
        return 'medium';
    }

    /**
     * 显示推荐详情
     */
    showRecommendationDetails(recommendation) {
        const detailContent = `
            <div class="recommendation-detail-modal">
                <div class="detail-header">
                    <h3>${recommendation.title}</h3>
                    <div class="detail-badges">
                        <span class="badge type-badge">${this.getTypeLabel(recommendation.type)}</span>
                        <span class="badge priority-badge ${this.getPriorityClass(recommendation.priority)}">
                            ${this.getPriorityLabel(recommendation.priority)}
                        </span>
                    </div>
                </div>
                
                <div class="detail-body">
                    <div class="detail-section">
                        <h4>推荐说明</h4>
                        <p>${recommendation.description}</p>
                        <div class="reasoning">
                            <strong>推荐理由:</strong> ${recommendation.reasoning}
                        </div>
                    </div>
                    
                    <div class="detail-section">
                        <h4>练习信息</h4>
                        <div class="info-grid">
                            <div class="info-item">
                                <span class="info-label">分类:</span>
                                <span class="info-value">${this.getCategoryLabel(recommendation.category)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">难度:</span>
                                <span class="info-value">${this.getDifficultyLabel(recommendation.difficulty)}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">预计用时:</span>
                                <span class="info-value">${recommendation.estimatedTime} 分钟</span>
                            </div>
                        </div>
                    </div>
                    
                    ${recommendation.questionTypes && recommendation.questionTypes.length > 0 ? `
                        <div class="detail-section">
                            <h4>涉及题型</h4>
                            <div class="question-types-detail">
                                ${recommendation.questionTypes.map(type => `
                                    <div class="question-type-item">
                                        <span class="type-name">${this.getQuestionTypeLabel(type)}</span>
                                        <span class="type-description">${this.getQuestionTypeDescription(type)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    <div class="detail-actions">
                        <button class="btn btn-primary" onclick="window.app.components.recommendationDisplay.startRecommendedPractice(${JSON.stringify(recommendation).replace(/"/g, '&quot;')})">
                            开始练习
                        </button>
                        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(detailContent);
    }

    /**
     * 记录推荐使用情况
     */
    async recordRecommendationUsage(recommendationId, examId) {
        const usageData = {
            recommendationId,
            examId,
            timestamp: new Date().toISOString(),
            userId: 'default-user'
        };

        const usageHistory = await storage.get('recommendation_usage', []);
        usageHistory.push(usageData);

        // 只保留最近100条记录
        if (usageHistory.length > 100) {
            usageHistory.splice(0, usageHistory.length - 100);
        }

        await storage.set('recommendation_usage', usageHistory);
    }

    /**
     * 刷新推荐
     */
    async refreshRecommendations() {
        try {
            await this.loadRecommendations();
            window.showMessage('推荐已刷新', 'info');
        } catch (error) {
            console.error('[RecommendationDisplay] 刷新推荐失败', error);
            window.showMessage('刷新推荐时出错，请稍后重试', 'error');
        }
    }

    /**
     * 显示推荐设置
     */
    showRecommendationSettings() {
        const settingsContent = `
            <div class="recommendation-settings-modal">
                <div class="settings-header">
                    <h3>推荐设置</h3>
                </div>
                
                <div class="settings-body">
                    <div class="setting-group">
                        <label class="setting-label">推荐数量</label>
                        <select class="setting-input" id="rec-count">
                            <option value="4">4个</option>
                            <option value="6">6个</option>
                            <option value="8" selected>8个</option>
                            <option value="10">10个</option>
                        </select>
                    </div>
                    
                    <div class="setting-group">
                        <label class="setting-label">自动刷新</label>
                        <label class="setting-checkbox">
                            <input type="checkbox" id="auto-refresh" checked>
                            <span class="checkmark"></span>
                            每次练习后自动更新推荐
                        </label>
                    </div>
                    
                    <div class="setting-group">
                        <label class="setting-label">推荐偏好</label>
                        <div class="preference-options">
                            <label class="preference-option">
                                <input type="radio" name="preference" value="balanced" checked>
                                <span>均衡发展</span>
                            </label>
                            <label class="preference-option">
                                <input type="radio" name="preference" value="weakness">
                                <span>重点补强</span>
                            </label>
                            <label class="preference-option">
                                <input type="radio" name="preference" value="challenge">
                                <span>挑战提升</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="settings-actions">
                    <button class="btn btn-primary" onclick="window.app.components.recommendationDisplay.saveSettings()">
                        保存设置
                    </button>
                    <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                        取消
                    </button>
                </div>
            </div>
        `;

        this.showModal(settingsContent);
    }

    /**
     * 保存设置
     */
    async saveSettings() {
        try {
            const recCount = document.getElementById('rec-count')?.value || '8';
            const autoRefreshCheckbox = document.getElementById('auto-refresh');
            const autoRefresh = autoRefreshCheckbox ? autoRefreshCheckbox.checked : true;
            const preference = document.querySelector('input[name="preference"]:checked')?.value || 'balanced';

            const settings = {
                maxRecommendations: parseInt(recCount, 10),
                autoRefresh,
                preference,
                lastUpdated: new Date().toISOString()
            };

            await storage.set('recommendation_settings', settings);

            // 关闭模态框
            document.querySelector('.modal-overlay')?.remove();

            // 重新加载推荐
            await this.loadRecommendations();

            // 更新自动刷新设置
            await this.startAutoRefresh();

            window.showMessage('设置已保存', 'success');
        } catch (error) {
            console.error('[RecommendationDisplay] 保存设置失败', error);
            window.showMessage('保存设置时出错，请稍后重试', 'error');
        }
    }

    /**
     * 显示加载状态
     */
    showLoadingState() {
        const container = this.getRecommendationContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="recommendation-loading">
                <div class="loading-spinner"></div>
                <div class="loading-text">正在生成个性化推荐...</div>
            </div>
        `;
    }

    /**
     * 显示错误状态
     */
    showErrorState() {
        const container = this.getRecommendationContainer();
        if (!container) return;

        container.innerHTML = `
            <div class="recommendation-error">
                <div class="error-icon">⚠️</div>
                <div class="error-text">推荐生成失败</div>
                <button class="btn btn-primary retry-btn" onclick="window.app.components.recommendationDisplay.loadRecommendations()">
                    重试
                </button>
            </div>
        `;
    }

    /**
     * 显示降级推荐
     */
    async showFallbackRecommendations() {
        const container = this.getRecommendationContainer();
        if (!container) return;

        const { examIndex, practiceRecords } = await this.fetchExamData();
        
        // 简单的降级推荐逻辑
        const unpracticedExams = examIndex.filter(exam => 
            !practiceRecords.some(record => record.examId === exam.id)
        );

        const fallbackRecommendations = unpracticedExams.slice(0, 4).map((exam, index) => ({
            id: `fallback_${exam.id}`,
            title: `练习 ${exam.title}`,
            description: '推荐您尝试这个新题目',
            category: exam.category,
            difficulty: 'medium',
            estimatedTime: exam.estimatedTime || 20,
            priority: 0.5,
            type: 'basic_practice',
            reasoning: '这是一个您还未练习过的题目',
            tags: ['新题目'],
            questionTypes: exam.questionTypes || []
        }));

        container.innerHTML = `
            <div class="recommendation-header">
                <h3>推荐练习</h3>
                <span class="recommendation-subtitle">为您推荐的练习题目</span>
            </div>
            <div class="recommendations-grid">
                ${fallbackRecommendations.map(rec => this.createRecommendationCard(rec)).join('')}
            </div>
        `;
    }

    /**
     * 开始自动刷新
     */
    async startAutoRefresh() {
        this.stopAutoRefresh();

        const settings = await storage.get('recommendation_settings', { autoRefresh: true });

        if (settings?.autoRefresh) {
            // 每30分钟自动刷新一次
            this.refreshInterval = setInterval(() => {
                this.loadRecommendations().catch(error => console.error('[RecommendationDisplay] 自动刷新失败', error));
            }, 30 * 60 * 1000);
        }
    }

    /**
     * 停止自动刷新
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;
        
        document.body.appendChild(modalOverlay);
        
        // 模态框事件已通过事件委托处理
    }

    // 辅助方法 - 获取各种标签和样式类
    getStrategyLabel(strategy) {
        const labels = {
            'weakness_improvement': '薄弱环节改进',
            'skill_advancement': '技能提升',
            'foundation_building': '基础建设',
            'balanced': '均衡发展'
        };
        return labels[strategy] || strategy;
    }

    getAreaLabel(area) {
        const labels = {
            'low_overall_accuracy': '整体准确率',
            'time_efficiency': '时间效率',
            'consistency': '稳定性',
            'P1': 'P1类别',
            'P2': 'P2类别',
            'P3': 'P3类别'
        };
        return labels[area] || area;
    }

    getPriorityClass(priority) {
        if (priority >= 0.8) return 'high-priority';
        if (priority >= 0.6) return 'medium-priority';
        return 'low-priority';
    }

    getPriorityLabel(priority) {
        if (priority >= 0.8) return '高优先级';
        if (priority >= 0.6) return '中优先级';
        return '低优先级';
    }

    getTypeIcon(type) {
        const icons = {
            'targeted_practice': '🎯',
            'skill_building': '🏗️',
            'challenging_practice': '💪',
            'basic_practice': '📚',
            'category_specific': '📂',
            'question_type_specific': '❓'
        };
        return icons[type] || '📝';
    }

    getTypeLabel(type) {
        const labels = {
            'targeted_practice': '针对性练习',
            'skill_building': '技能建设',
            'challenging_practice': '挑战练习',
            'basic_practice': '基础练习',
            'category_specific': '分类专项',
            'question_type_specific': '题型专项'
        };
        return labels[type] || type;
    }

    getCategoryLabel(category) {
        const labels = {
            'P1': 'P1题库',
            'P2': 'P2题库',
            'P3': 'P3题库',
            'mixed': '综合练习'
        };
        return labels[category] || category;
    }

    getDifficultyLabel(difficulty) {
        const labels = {
            'easy': '简单',
            'medium': '中等',
            'hard': '困难'
        };
        return labels[difficulty] || difficulty;
    }

    getQuestionTypeLabel(type) {
        const labels = {
            'heading-matching': '段落标题匹配',
            'country-matching': '信息匹配',
            'true-false-not-given': '判断题',
            'multiple-choice': '选择题',
            'gap-filling': '填空题',
            'summary-completion': '摘要填空'
        };
        return labels[type] || type;
    }

    getQuestionTypeDescription(type) {
        const descriptions = {
            'heading-matching': '将段落与相应的标题进行匹配',
            'country-matching': '将信息与相应的国家或地区进行匹配',
            'true-false-not-given': '判断陈述是否正确、错误或未提及',
            'multiple-choice': '从多个选项中选择正确答案',
            'gap-filling': '在文章空白处填入合适的词语',
            'summary-completion': '完成文章摘要的空白部分'
        };
        return descriptions[type] || '';
    }

    getPhaseLabel(phase) {
        const labels = {
            'short_term': '短期目标 (1-2周)',
            'medium_term': '中期目标 (3-4周)',
            'long_term': '长期目标 (2-3个月)'
        };
        return labels[phase] || phase;
    }

    /**
     * 刷新组件
     */
    refresh() {
        this.loadRecommendations();
    }

    /**
     * 销毁组件
     */
    destroy() {
        this.stopAutoRefresh();
    }
}

// 确保全局可用
window.RecommendationDisplay = RecommendationDisplay;