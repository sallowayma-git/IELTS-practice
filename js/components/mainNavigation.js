/**
 * 主导航组件
 * 处理应用的主要导航功能和分类卡片展示
 */
class MainNavigation {
    constructor() {
        this.currentView = 'overview';
        this.categoryStats = {};
        this.searchQuery = '';
        this.initialize();
    }

    /**
     * 初始化导航组件
     */
    initialize() {
        console.log('MainNavigation component initialized');
        this.setupEventListeners();
        this.loadCategoryStats();
        this.renderCategoryCards();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 分类卡片点击事件
        document.addEventListener('click', (e) => {
            const categoryCard = e.target.closest('.category-card');
            if (categoryCard) {
                const category = categoryCard.dataset.category;
                this.handleCategoryClick(category, e);
            }

            // 快速访问按钮
            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                e.preventDefault();
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                const category = actionBtn.dataset.category;
                this.handleCategoryAction(action, category);
            }
        });

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case '1':
                        e.preventDefault();
                        this.handleCategoryAction('browse', 'P1');
                        break;
                    case '2':
                        e.preventDefault();
                        this.handleCategoryAction('browse', 'P2');
                        break;
                    case '3':
                        e.preventDefault();
                        this.handleCategoryAction('browse', 'P3');
                        break;
                }
            }
        });
    }

    /**
     * 加载分类统计数据
     */
    loadCategoryStats() {
        const examIndex = storage.get('exam_index', []);
        const practiceRecords = storage.get('practice_records', []);
        
        // 计算每个分类的统计信息
        const categories = ['P1', 'P2', 'P3'];
        
        categories.forEach(category => {
            const categoryExams = examIndex.filter(exam => exam.category === category);
            const categoryRecords = practiceRecords.filter(record => {
                const exam = examIndex.find(e => e.id === record.examId);
                return exam && exam.category === category;
            });
            
            const completedExamIds = new Set(categoryRecords.map(r => r.examId));
            const completed = completedExamIds.size;
            const total = categoryExams.length;
            const progress = total > 0 ? (completed / total) * 100 : 0;
            
            // 计算平均正确率
            const avgAccuracy = categoryRecords.length > 0 
                ? categoryRecords.reduce((sum, record) => sum + (record.accuracy || 0), 0) / categoryRecords.length
                : 0;
            
            // 计算高频和次高频分布
            const highFreq = categoryExams.filter(e => e.frequency === 'high').length;
            const lowFreq = categoryExams.filter(e => e.frequency === 'low').length;
            
            // 计算最近练习时间
            const recentRecords = categoryRecords
                .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
            const lastPractice = recentRecords.length > 0 ? recentRecords[0].startTime : null;
            
            this.categoryStats[category] = {
                total,
                completed,
                progress,
                avgAccuracy: Math.round(avgAccuracy * 100),
                highFreq,
                lowFreq,
                lastPractice,
                totalPractices: categoryRecords.length,
                totalTimeSpent: categoryRecords.reduce((sum, r) => sum + (r.duration || 0), 0)
            };
        });
    }

    /**
     * 渲染分类卡片
     */
    renderCategoryCards() {
        const categoryGrid = document.querySelector('.category-grid');
        if (!categoryGrid) return;

        const categories = [
            { id: 'P1', name: 'P1 题库', subtitle: '(12+8)', description: '阅读理解基础题型', icon: '📖' },
            { id: 'P2', name: 'P2 题库', subtitle: '(14+2)', description: '阅读理解进阶题型', icon: '📚' },
            { id: 'P3', name: 'P3 题库', subtitle: '(20+6)', description: '阅读理解高级题型', icon: '🎓' }
        ];

        categoryGrid.innerHTML = categories.map(category => 
            this.createCategoryCard(category)
        ).join('');

        // 更新统计信息
        this.updateCategoryProgress();
    }

    /**
     * 创建分类卡片HTML
     */
    createCategoryCard(category) {
        const stats = this.categoryStats[category.id] || {
            total: 0, completed: 0, progress: 0, avgAccuracy: 0,
            highFreq: 0, lowFreq: 0, totalPractices: 0
        };

        const lastPracticeText = stats.lastPractice 
            ? Utils.formatRelativeTime(stats.lastPractice)
            : '从未练习';

        return `
            <div class="category-card" data-category="${category.id}">
                <div class="category-header">
                    <div class="category-icon">${category.icon}</div>
                    <div class="category-title-group">
                        <h2>${category.name} ${category.subtitle}</h2>
                        <span class="category-badge">${category.description}</span>
                    </div>
                    <div class="category-status">
                        <span class="status-indicator ${stats.progress === 100 ? 'completed' : stats.progress > 0 ? 'in-progress' : 'not-started'}"></span>
                    </div>
                </div>
                
                <div class="category-stats">
                    <div class="progress-section">
                        <div class="progress-bar">
                            <div class="progress-fill" data-progress="${stats.progress}" style="width: ${stats.progress}%"></div>
                        </div>
                        <div class="progress-info">
                            <span class="progress-text">${stats.completed}/${stats.total} 已完成</span>
                            <span class="progress-percentage">${Math.round(stats.progress)}%</span>
                        </div>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-label">高频题目</span>
                            <span class="stat-value">${stats.highFreq}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">次高频题目</span>
                            <span class="stat-value">${stats.lowFreq}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">平均正确率</span>
                            <span class="stat-value">${stats.avgAccuracy}%</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">练习次数</span>
                            <span class="stat-value">${stats.totalPractices}</span>
                        </div>
                    </div>
                    
                    <div class="last-practice">
                        <span class="last-practice-label">最近练习：</span>
                        <span class="last-practice-time">${lastPracticeText}</span>
                    </div>
                </div>
                
                <div class="category-actions">
                    <button class="btn btn-primary" data-action="browse" data-category="${category.id}">
                        <span class="btn-icon">👁️</span>
                        浏览题目
                    </button>
                    <button class="btn btn-secondary" data-action="practice" data-category="${category.id}">
                        <span class="btn-icon">✏️</span>
                        开始练习
                    </button>
                    <button class="btn btn-outline" data-action="stats" data-category="${category.id}">
                        <span class="btn-icon">📊</span>
                        查看统计
                    </button>
                </div>
                
                <div class="category-quick-actions">
                    <button class="quick-btn" data-action="browse" data-category="${category.id}" data-frequency="high" title="浏览高频题目">
                        高频 (${stats.highFreq})
                    </button>
                    <button class="quick-btn" data-action="browse" data-category="${category.id}" data-frequency="low" title="浏览次高频题目">
                        次高频 (${stats.lowFreq})
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * 更新分类进度
     */
    updateCategoryProgress() {
        Object.keys(this.categoryStats).forEach(category => {
            const stats = this.categoryStats[category];
            
            // 更新进度条
            const progressBar = document.querySelector(`[data-category="${category}"] .progress-fill`);
            if (progressBar) {
                progressBar.style.width = `${stats.progress}%`;
                progressBar.dataset.progress = stats.progress;
            }
            
            // 更新进度文本
            const progressText = document.querySelector(`[data-category="${category}"] .progress-text`);
            if (progressText) {
                progressText.textContent = `${stats.completed}/${stats.total} 已完成`;
            }
            
            // 更新百分比
            const progressPercentage = document.querySelector(`[data-category="${category}"] .progress-percentage`);
            if (progressPercentage) {
                progressPercentage.textContent = `${Math.round(stats.progress)}%`;
            }
        });
    }













    /**
     * 处理分类点击
     */
    handleCategoryClick(category, event) {
        // 如果点击的是按钮，不处理卡片点击
        if (event.target.closest('button')) {
            return;
        }

        // 默认行为：浏览该分类
        this.handleCategoryAction('browse', category);
    }

    /**
     * 处理分类操作
     */
    handleCategoryAction(action, category, frequency = null) {
        switch (action) {
            case 'browse':
                this.browseCategory(category, frequency);
                break;
            case 'practice':
                this.startCategoryPractice(category);
                break;
            case 'stats':
                this.showCategoryStats(category);
                break;
        }
    }

    /**
     * 浏览分类
     */
    browseCategory(category, frequency = null) {
        if (window.App && window.App.components.examBrowser) {
            window.App.components.examBrowser.showCategory(category, frequency);
            window.App.navigateToView('browse');
            
            // 更新浏览页面标题
            const browseTitle = document.getElementById('browse-title');
            if (browseTitle) {
                let title = `${category} 题库浏览`;
                if (frequency) {
                    title += ` - ${frequency === 'high' ? '高频' : '次高频'}题目`;
                }
                browseTitle.textContent = title;
            }
        }
    }

    /**
     * 开始分类练习
     */
    startCategoryPractice(category) {
        // 获取该分类的题目
        const examIndex = storage.get('exam_index', []);
        const categoryExams = examIndex.filter(exam => exam.category === category);
        
        if (categoryExams.length === 0) {
            window.App.showUserMessage(`${category} 分类暂无可用题目`, 'warning');
            return;
        }

        // 随机选择一个题目
        const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
        
        if (window.App && typeof window.App.openExam === 'function') {
            window.App.openExam(randomExam.id);
        } else {
            window.App.showUserMessage(`开始练习: ${randomExam.title}`, 'info');
        }
    }

    /**
     * 显示分类统计
     */
    showCategoryStats(category) {
        const stats = this.categoryStats[category];
        if (!stats) return;

        const modalContent = `
            <div class="stats-modal">
                <h3>${category} 题库统计</h3>
                <div class="stats-details">
                    <div class="stat-row">
                        <span class="stat-label">总题目数：</span>
                        <span class="stat-value">${stats.total}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">已完成：</span>
                        <span class="stat-value">${stats.completed}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">完成率：</span>
                        <span class="stat-value">${Math.round(stats.progress)}%</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">平均正确率：</span>
                        <span class="stat-value">${stats.avgAccuracy}%</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">总练习次数：</span>
                        <span class="stat-value">${stats.totalPractices}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">总用时：</span>
                        <span class="stat-value">${Utils.formatDuration(stats.totalTimeSpent)}</span>
                    </div>
                </div>
            </div>
        `;

        // 这里可以显示模态框或导航到统计页面
        window.App.showUserMessage(modalContent, 'info');
    }

    /**
     * 更新导航状态
     */
    updateActiveView(viewName) {
        this.currentView = viewName;
        
        // 更新导航按钮状态
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        const activeNavBtn = document.querySelector(`[data-view="${viewName}"]`);
        if (activeNavBtn) {
            activeNavBtn.classList.add('active');
        }
    }

    /**
     * 刷新组件数据
     */
    refresh() {
        this.loadCategoryStats();
        this.updateCategoryProgress();
    }

    /**
     * 销毁组件
     */
    destroy() {
        // 清理事件监听器
    }
}

// 导出到全局对象
window.MainNavigation = MainNavigation;