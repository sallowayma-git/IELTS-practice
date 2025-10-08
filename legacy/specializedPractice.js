/**
 * 专项练习组件
 * 处理高频/次高频专项练习模式，包括进度跟踪和成就系统
 */
class SpecializedPractice {
    constructor() {
        this.currentMode = null; // 'high-frequency', 'low-frequency', 'question-type'
        this.currentCategory = null;
        this.practiceSession = null;
        this.achievements = new Map();
        this.initialize();
    }

    /**
     * 初始化专项练习组件
     */
    initialize() {
        console.log('SpecializedPractice component initialized');
        this.loadAchievements();
        this.setupEventListeners();
        this.createSpecializedPracticeUI();
    }

    /**
     * 加载成就数据
     */
    loadAchievements() {
        const savedAchievements = storage.get('practice_achievements', {});
        this.achievements = new Map(Object.entries(savedAchievements));
    }

    /**
     * 保存成就数据
     */
    saveAchievements() {
        const achievementsObj = Object.fromEntries(this.achievements);
        storage.set('practice_achievements', achievementsObj);
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        document.addEventListener('click', (e) => {
            // 专项练习模式选择
            const modeBtn = e.target.closest('[data-practice-mode]');
            if (modeBtn) {
                const mode = modeBtn.dataset.practiceMode;
                const category = modeBtn.dataset.category;
                this.startSpecializedPractice(mode, category);
            }

            // 成就查看
            const achievementBtn = e.target.closest('.achievement-item');
            if (achievementBtn) {
                const achievementId = achievementBtn.dataset.achievementId;
                this.showAchievementDetails(achievementId);
            }
        });

        // 监听练习完成事件
        document.addEventListener('practiceSessionCompleted', (event) => {
            const { examId, practiceRecord } = event.detail;
            this.handlePracticeCompletion(examId, practiceRecord);
        });
    }

    /**
     * 创建专项练习UI
     */
    createSpecializedPracticeUI() {
        // 在总览页面添加专项练习入口
        this.addSpecializedPracticeSection();
        
        // 创建专项练习页面
        this.createSpecializedPracticePage();
    }

    /**
     * 在总览页面添加专项练习区域
     */
    addSpecializedPracticeSection() {
        const overviewView = document.getElementById('overview-view');
        if (!overviewView) return;

        // 检查是否已存在
        if (overviewView.querySelector('.specialized-practice-section')) return;

        const specializedSection = document.createElement('div');
        specializedSection.className = 'specialized-practice-section';
        specializedSection.innerHTML = `
            <div class="section-header">
                <h2>专项训练</h2>
                <p>针对性练习，快速提升薄弱环节</p>
            </div>
            <div class="specialized-modes">
                <div class="practice-mode-card" data-practice-mode="high-frequency">
                    <div class="mode-icon">🔥</div>
                    <h3>高频专项</h3>
                    <p>重点练习高频考点</p>
                    <div class="mode-stats">
                        <span class="stat-item">
                            <span class="stat-value" id="high-freq-progress">0</span>
                            <span class="stat-label">% 完成</span>
                        </span>
                    </div>
                </div>
                <div class="practice-mode-card" data-practice-mode="low-frequency">
                    <div class="mode-icon">⭐</div>
                    <h3>次高频专项</h3>
                    <p>巩固次高频知识点</p>
                    <div class="mode-stats">
                        <span class="stat-item">
                            <span class="stat-value" id="low-freq-progress">0</span>
                            <span class="stat-label">% 完成</span>
                        </span>
                    </div>
                </div>
                <div class="practice-mode-card" data-practice-mode="question-type">
                    <div class="mode-icon">📝</div>
                    <h3>题型专项</h3>
                    <p>按题型分类练习</p>
                    <div class="mode-stats">
                        <span class="stat-item">
                            <span class="stat-value" id="question-type-progress">0</span>
                            <span class="stat-label">% 完成</span>
                        </span>
                    </div>
                </div>
            </div>
            <div class="achievements-preview">
                <h3>最近成就</h3>
                <div class="achievements-list" id="recent-achievements">
                    <!-- 成就列表将在这里动态生成 -->
                </div>
                <button class="btn btn-outline view-all-achievements">查看全部成就</button>
            </div>
        `;

        // 插入到分类网格之前
        const categoryGrid = overviewView.querySelector('.category-grid');
        if (categoryGrid) {
            overviewView.insertBefore(specializedSection, categoryGrid);
        } else {
            overviewView.appendChild(specializedSection);
        }

        // 更新进度统计
        this.updateSpecializedProgress();
        this.updateRecentAchievements();
    }

    /**
     * 创建专项练习页面
     */
    createSpecializedPracticePage() {
        const mainContent = document.querySelector('.main-content .container');
        if (!mainContent) return;

        // 检查是否已存在
        if (document.getElementById('specialized-practice-view')) return;

        const specializedView = document.createElement('section');
        specializedView.id = 'specialized-practice-view';
        specializedView.className = 'view';
        specializedView.innerHTML = `
            <div class="specialized-practice-header">
                <button class="btn btn-back" id="back-to-overview-from-specialized">← 返回总览</button>
                <h2 id="specialized-practice-title">专项练习</h2>
                <div class="practice-controls">
                    <select id="category-selector" class="practice-selector">
                        <option value="all">全部分类</option>
                        <option value="P1">P1 题库</option>
                        <option value="P2">P2 题库</option>
                        <option value="P3">P3 题库</option>
                    </select>
                    <select id="difficulty-selector" class="practice-selector">
                        <option value="all">全部难度</option>
                        <option value="easy">简单</option>
                        <option value="medium">中等</option>
                        <option value="hard">困难</option>
                    </select>
                </div>
            </div>
            
            <div class="specialized-practice-content">
                <div class="practice-progress-overview">
                    <div class="progress-card">
                        <h3>当前进度</h3>
                        <div class="progress-circle" id="current-mode-progress">
                            <div class="progress-value">0%</div>
                        </div>
                        <div class="progress-details">
                            <div class="detail-item">
                                <span class="detail-label">已完成</span>
                                <span class="detail-value" id="completed-count">0</span>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">总题数</span>
                                <span class="detail-value" id="total-count">0</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="streak-card">
                        <h3>连续练习</h3>
                        <div class="streak-counter">
                            <span class="streak-number" id="current-streak">0</span>
                            <span class="streak-label">天</span>
                        </div>
                        <div class="streak-goal">
                            <span>目标: 7天</span>
                        </div>
                    </div>
                </div>
                
                <div class="practice-exam-list" id="specialized-exam-list">
                    <!-- 专项练习题目列表 -->
                </div>
                
                <div class="practice-achievements-section">
                    <h3>专项成就</h3>
                    <div class="achievements-grid" id="specialized-achievements">
                        <!-- 成就网格 -->
                    </div>
                </div>
            </div>
        `;

        mainContent.appendChild(specializedView);

        // 设置返回按钮事件
        const backBtn = specializedView.querySelector('#back-to-overview-from-specialized');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (window.app && typeof window.app.navigateToView === 'function') {
                    window.app.navigateToView('overview');
                }
            });
        }

        // 设置筛选器事件
        const categorySelector = specializedView.querySelector('#category-selector');
        const difficultySelector = specializedView.querySelector('#difficulty-selector');

        if (categorySelector) {
            categorySelector.addEventListener('change', () => {
                this.updateSpecializedExamList();
            });
        }

        if (difficultySelector) {
            difficultySelector.addEventListener('change', () => {
                this.updateSpecializedExamList();
            });
        }
    }

    /**
     * 开始专项练习
     */
    startSpecializedPractice(mode, category = null) {
        this.currentMode = mode;
        this.currentCategory = category;

        // 导航到专项练习页面
        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView('specialized-practice');
        }

        // 更新页面标题和内容
        this.updateSpecializedPracticeView();
    }

    /**
     * 更新专项练习视图
     */
    updateSpecializedPracticeView() {
        const titleElement = document.getElementById('specialized-practice-title');
        if (titleElement) {
            const modeNames = {
                'high-frequency': '高频专项练习',
                'low-frequency': '次高频专项练习',
                'question-type': '题型专项练习'
            };
            titleElement.textContent = modeNames[this.currentMode] || '专项练习';
        }

        // 更新进度显示
        this.updateCurrentModeProgress();
        
        // 更新题目列表
        this.updateSpecializedExamList();
        
        // 更新成就显示
        this.updateSpecializedAchievements();
        
        // 更新连续练习统计
        this.updateStreakCounter();
    }

    /**
     * 更新当前模式进度
     */
    updateCurrentModeProgress() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        let filteredExams = this.getFilteredExams(examIndex);
        const completedExamIds = new Set(practiceRecords.map(r => r.examId));
        const completedCount = filteredExams.filter(exam => completedExamIds.has(exam.id)).length;
        const totalCount = filteredExams.length;
        const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

        // 更新进度圆环
        const progressCircle = document.getElementById('current-mode-progress');
        if (progressCircle) {
            const progressValue = progressCircle.querySelector('.progress-value');
            if (progressValue) {
                progressValue.textContent = `${progressPercentage}%`;
            }
            
            // 更新圆环样式
            progressCircle.style.setProperty('--progress', `${progressPercentage}%`);
        }

        // 更新详细数据
        const completedCountElement = document.getElementById('completed-count');
        const totalCountElement = document.getElementById('total-count');
        
        if (completedCountElement) completedCountElement.textContent = completedCount;
        if (totalCountElement) totalCountElement.textContent = totalCount;
    }

    /**
     * 获取筛选后的题目
     */
    getFilteredExams(examIndex) {
        let filtered = [...examIndex];

        // 按模式筛选
        switch (this.currentMode) {
            case 'high-frequency':
                filtered = filtered.filter(exam => exam.frequency === 'high');
                break;
            case 'low-frequency':
                filtered = filtered.filter(exam => exam.frequency === 'low');
                break;
            case 'question-type':
                // 题型模式不需要频率筛选
                break;
        }

        // 按分类筛选
        const categorySelector = document.getElementById('category-selector');
        if (categorySelector && categorySelector.value !== 'all') {
            filtered = filtered.filter(exam => exam.category === categorySelector.value);
        }

        // 按难度筛选
        const difficultySelector = document.getElementById('difficulty-selector');
        if (difficultySelector && difficultySelector.value !== 'all') {
            filtered = filtered.filter(exam => exam.difficulty === difficultySelector.value);
        }

        return filtered;
    }

    /**
     * 更新专项练习题目列表
     */
    updateSpecializedExamList() {
        const examListContainer = document.getElementById('specialized-exam-list');
        if (!examListContainer) return;

        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        const filteredExams = this.getFilteredExams(examIndex);

        if (filteredExams.length === 0) {
            examListContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📚</div>
                    <div class="empty-state-title">暂无题目</div>
                    <div class="empty-state-description">当前筛选条件下没有找到题目</div>
                </div>
            `;
            return;
        }

        // 按完成状态排序，未完成的在前
        const completedExamIds = new Set(practiceRecords.map(r => r.examId));
        const sortedExams = filteredExams.sort((a, b) => {
            const aCompleted = completedExamIds.has(a.id);
            const bCompleted = completedExamIds.has(b.id);
            
            if (aCompleted === bCompleted) {
                return a.title.localeCompare(b.title);
            }
            return aCompleted ? 1 : -1;
        });

        examListContainer.innerHTML = `
            <div class="specialized-exam-grid">
                ${sortedExams.map(exam => this.createSpecializedExamCard(exam, practiceRecords)).join('')}
            </div>
        `;
    }

    /**
     * 创建专项练习题目卡片
     */
    createSpecializedExamCard(exam, practiceRecords) {
        const examRecords = practiceRecords.filter(r => r.examId === exam.id);
        const isCompleted = examRecords.length > 0;
        const bestScore = isCompleted ? Math.max(...examRecords.map(r => r.accuracy || 0)) : 0;
        const practiceCount = examRecords.length;

        return `
            <div class="specialized-exam-card ${isCompleted ? 'completed' : ''}" data-exam-id="${exam.id}">
                <div class="exam-card-header">
                    <div class="exam-status-badge ${isCompleted ? 'completed' : 'pending'}">
                        ${isCompleted ? '✓' : '○'}
                    </div>
                    <h4 class="exam-title">${exam.title}</h4>
                    <div class="exam-meta">
                        <span class="exam-tag">${exam.category}</span>
                        <span class="exam-tag frequency-${exam.frequency}">
                            ${exam.frequency === 'high' ? '高频' : '次高频'}
                        </span>
                        ${exam.difficulty ? `<span class="exam-tag difficulty-${exam.difficulty}">${exam.difficulty}</span>` : ''}
                    </div>
                </div>
                <div class="exam-card-body">
                    <div class="exam-stats-row">
                        <div class="stat-item">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${practiceCount}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">最佳成绩</span>
                            <span class="stat-value">${Math.round(bestScore * 100)}%</span>
                        </div>
                    </div>
                    ${exam.questionTypes && exam.questionTypes.length > 0 ? `
                        <div class="question-types-preview">
                            ${exam.questionTypes.slice(0, 2).map(type => `
                                <span class="question-type-tag">${this.formatQuestionType(type)}</span>
                            `).join('')}
                            ${exam.questionTypes.length > 2 ? `<span class="more-types">+${exam.questionTypes.length - 2}</span>` : ''}
                        </div>
                    ` : ''}
                    <div class="exam-actions">
                        <button class="btn btn-primary btn-sm" data-exam-action="practice" data-exam-id="${exam.id}">
                            ${isCompleted ? '再次练习' : '开始练习'}
                        </button>
                        <button class="btn btn-outline btn-sm" data-exam-action="preview" data-exam-id="${exam.id}">
                            预览
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 格式化题型名称
     */
    formatQuestionType(type) {
        const typeMap = {
            'heading-matching': '标题匹配',
            'true-false-not-given': '判断题',
            'yes-no-not-given': '是非题',
            'multiple-choice': '选择题',
            'matching-information': '信息匹配',
            'matching-people-ideas': '人物观点匹配',
            'summary-completion': '摘要填空',
            'sentence-completion': '句子填空',
            'short-answer': '简答题',
            'diagram-labelling': '图表标注',
            'flow-chart': '流程图',
            'table-completion': '表格填空'
        };
        return typeMap[type] || type;
    }

    /**
     * 更新专项练习进度统计
     */
    updateSpecializedProgress() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        const completedExamIds = new Set(practiceRecords.map(r => r.examId));

        // 高频进度
        const highFreqExams = examIndex.filter(exam => exam.frequency === 'high');
        const highFreqCompleted = highFreqExams.filter(exam => completedExamIds.has(exam.id)).length;
        const highFreqProgress = highFreqExams.length > 0 ? Math.round((highFreqCompleted / highFreqExams.length) * 100) : 0;

        // 次高频进度
        const lowFreqExams = examIndex.filter(exam => exam.frequency === 'low');
        const lowFreqCompleted = lowFreqExams.filter(exam => completedExamIds.has(exam.id)).length;
        const lowFreqProgress = lowFreqExams.length > 0 ? Math.round((lowFreqCompleted / lowFreqExams.length) * 100) : 0;

        // 题型进度（所有题目）
        const allExams = examIndex;
        const allCompleted = allExams.filter(exam => completedExamIds.has(exam.id)).length;
        const questionTypeProgress = allExams.length > 0 ? Math.round((allCompleted / allExams.length) * 100) : 0;

        // 更新UI
        const highFreqElement = document.getElementById('high-freq-progress');
        const lowFreqElement = document.getElementById('low-freq-progress');
        const questionTypeElement = document.getElementById('question-type-progress');

        if (highFreqElement) highFreqElement.textContent = highFreqProgress;
        if (lowFreqElement) lowFreqElement.textContent = lowFreqProgress;
        if (questionTypeElement) questionTypeElement.textContent = questionTypeProgress;
    }

    /**
     * 更新连续练习统计
     */
    updateStreakCounter() {
        const practiceRecords = storage.get('practice_records', []);
        const streak = this.calculatePracticeStreak(practiceRecords);

        const streakElement = document.getElementById('current-streak');
        if (streakElement) {
            streakElement.textContent = streak;
        }
    }

    /**
     * 计算连续练习天数
     */
    calculatePracticeStreak(practiceRecords) {
        if (practiceRecords.length === 0) return 0;

        // 按日期分组
        const practicesByDate = new Map();
        practiceRecords.forEach(record => {
            const date = new Date(record.startTime).toDateString();
            if (!practicesByDate.has(date)) {
                practicesByDate.set(date, []);
            }
            practicesByDate.get(date).push(record);
        });

        // 获取有练习的日期，按时间排序
        const practiceDates = Array.from(practicesByDate.keys())
            .map(dateStr => new Date(dateStr))
            .sort((a, b) => b - a); // 降序排列

        if (practiceDates.length === 0) return 0;

        // 计算连续天数
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < practiceDates.length; i++) {
            const practiceDate = new Date(practiceDates[i]);
            practiceDate.setHours(0, 0, 0, 0);
            
            const expectedDate = new Date(today);
            expectedDate.setDate(today.getDate() - streak);
            
            if (practiceDate.getTime() === expectedDate.getTime()) {
                streak++;
            } else {
                break;
            }
        }

        return streak;
    }

    /**
     * 处理练习完成
     */
    handlePracticeCompletion(examId, practiceRecord) {
        // 检查并解锁成就
        this.checkAndUnlockAchievements(examId, practiceRecord);
        
        // 更新进度显示
        this.updateSpecializedProgress();
        this.updateCurrentModeProgress();
        this.updateStreakCounter();
    }

    /**
     * 检查并解锁成就
     */
    checkAndUnlockAchievements(examId, practiceRecord) {
        const examIndex = storage.get('exam_index', []);
        const exam = examIndex.find(e => e.id === examId);
        if (!exam) return;

        const practiceRecords = storage.get('practice_records', []);
        const allUserRecords = practiceRecords.filter(r => r.examId === examId);
        
        // 定义成就规则
        const achievementRules = [
            {
                id: 'first_high_freq',
                name: '高频初体验',
                description: '完成第一个高频题目',
                icon: '🔥',
                condition: () => exam.frequency === 'high' && allUserRecords.length === 1
            },
            {
                id: 'first_low_freq',
                name: '次高频探索者',
                description: '完成第一个次高频题目',
                icon: '⭐',
                condition: () => exam.frequency === 'low' && allUserRecords.length === 1
            },
            {
                id: 'perfect_score',
                name: '完美表现',
                description: '获得100%正确率',
                icon: '💯',
                condition: () => practiceRecord.accuracy >= 1.0
            },
            {
                id: 'high_freq_master',
                name: '高频大师',
                description: '完成所有高频题目',
                icon: '👑',
                condition: () => {
                    const highFreqExams = examIndex.filter(e => e.frequency === 'high');
                    const completedHighFreq = new Set(practiceRecords.filter(r => {
                        const recordExam = examIndex.find(e => e.id === r.examId);
                        return recordExam && recordExam.frequency === 'high';
                    }).map(r => r.examId));
                    return highFreqExams.every(e => completedHighFreq.has(e.id));
                }
            },
            {
                id: 'streak_7_days',
                name: '七日连击',
                description: '连续练习7天',
                icon: '🔥',
                condition: () => this.calculatePracticeStreak(practiceRecords) >= 7
            }
        ];

        // 检查每个成就
        achievementRules.forEach(rule => {
            if (!this.achievements.has(rule.id) && rule.condition()) {
                this.unlockAchievement(rule);
            }
        });
    }

    /**
     * 解锁成就
     */
    unlockAchievement(achievement) {
        const achievementData = {
            ...achievement,
            unlockedAt: new Date().toISOString(),
            isNew: true
        };
        
        this.achievements.set(achievement.id, achievementData);
        this.saveAchievements();
        
        // 显示成就通知
        this.showAchievementNotification(achievementData);
        
        // 更新UI
        this.updateRecentAchievements();
        this.updateSpecializedAchievements();
    }

    /**
     * 显示成就通知
     */
    showAchievementNotification(achievement) {
        const notification = document.createElement('div');
        notification.className = 'achievement-notification show';
        notification.innerHTML = `
            <div class="achievement-notification-content">
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-info">
                    <div class="achievement-title">成就解锁！</div>
                    <div class="achievement-name">${achievement.name}</div>
                    <div class="achievement-desc">${achievement.description}</div>
                </div>
            </div>
        `;

        document.body.appendChild(notification);

        // 自动移除
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 4000);
    }

    /**
     * 更新最近成就显示
     */
    updateRecentAchievements() {
        const recentAchievementsContainer = document.getElementById('recent-achievements');
        if (!recentAchievementsContainer) return;

        const recentAchievements = Array.from(this.achievements.values())
            .sort((a, b) => new Date(b.unlockedAt) - new Date(a.unlockedAt))
            .slice(0, 3);

        if (recentAchievements.length === 0) {
            recentAchievementsContainer.innerHTML = `
                <div class="no-achievements">
                    <span>暂无成就，开始练习解锁吧！</span>
                </div>
            `;
            return;
        }

        recentAchievementsContainer.innerHTML = recentAchievements.map(achievement => `
            <div class="achievement-item ${achievement.isNew ? 'new' : ''}" data-achievement-id="${achievement.id}">
                <div class="achievement-icon">${achievement.icon}</div>
                <div class="achievement-info">
                    <div class="achievement-name">${achievement.name}</div>
                    <div class="achievement-desc">${achievement.description}</div>
                </div>
            </div>
        `).join('');
    }

    /**
     * 更新专项成就显示
     */
    updateSpecializedAchievements() {
        const achievementsContainer = document.getElementById('specialized-achievements');
        if (!achievementsContainer) return;

        const allAchievements = Array.from(this.achievements.values());
        
        achievementsContainer.innerHTML = `
            <div class="achievements-grid-content">
                ${allAchievements.map(achievement => `
                    <div class="achievement-card ${achievement.isNew ? 'new' : ''}" data-achievement-id="${achievement.id}">
                        <div class="achievement-icon-large">${achievement.icon}</div>
                        <div class="achievement-name">${achievement.name}</div>
                        <div class="achievement-desc">${achievement.description}</div>
                        <div class="achievement-date">${Utils.formatRelativeTime(achievement.unlockedAt)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 显示成就详情
     */
    showAchievementDetails(achievementId) {
        const achievement = this.achievements.get(achievementId);
        if (!achievement) return;

        const detailsContent = `
            <div class="achievement-details-modal">
                <div class="achievement-details-header">
                    <div class="achievement-icon-xl">${achievement.icon}</div>
                    <h3>${achievement.name}</h3>
                    <button class="close-modal" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="achievement-details-body">
                    <p class="achievement-description">${achievement.description}</p>
                    <div class="achievement-meta">
                        <div class="meta-item">
                            <span class="meta-label">解锁时间：</span>
                            <span class="meta-value">${new Date(achievement.unlockedAt).toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.showModal(detailsContent);
    }

    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;
        
        document.body.appendChild(modalOverlay);
        
        // 点击背景关闭
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                modalOverlay.remove();
            }
        });
    }

    /**
     * 销毁组件
     */
    destroy() {
        // 清理事件监听器
        // 这里可以添加具体的清理逻辑
    }
}

// 确保组件在全局可用
window.SpecializedPractice = SpecializedPractice;