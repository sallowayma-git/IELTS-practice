/**
 * HP Welcome页面UI增强插件
 * 负责Welcome页面的UI交互和数据展示
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    if (typeof hpCore === 'undefined') {
        console.error('[HP Welcome UI] hpCore未定义');
        return;
    }

    const hpWelcomeUI = {
        // 插件状态
        isInitialized: false,
        currentStats: {
            totalExams: 0,
            completedCount: 0,
            avgScore: 0,
            studyDays: 0
        },

        /**
         * 初始化插件
         */
        init() {
            if (this.isInitialized) {
                console.log('[HP Welcome UI] 插件已初始化，跳过重复初始化');
                return;
            }

            console.log('[HP Welcome UI] 开始初始化Welcome页面UI增强插件');

            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this._initAfterDOM());
            } else {
                this._initAfterDOM();
            }
        },

        /**
         * DOM加载完成后初始化
         */
        _initAfterDOM() {
            try {
                this._setupEventListeners();
                this._enhanceUI();
                this._loadInitialData();
                this.isInitialized = true;
                console.log('[HP Welcome UI] 插件初始化完成');
            } catch (error) {
                console.error('[HP Welcome UI] 初始化失败:', error);
            }
        },

        /**
         * 设置事件监听器
         */
        _setupEventListeners() {
            // 监听数据更新事件
            hpCore.on('dataUpdated', (data) => {
                console.log('[HP Welcome UI] 收到数据更新事件');
                this._updateStats(data);
            });

            // 监听练习完成事件
            hpCore.on('practiceCompleted', (record) => {
                console.log('[HP Welcome UI] 收到练习完成事件');
                this._updateStats();
            });

            // 快速开始按钮事件
            this._setupQuickStartButtons();
        },

        /**
         * 设置快速开始按钮
         */
        _setupQuickStartButtons() {
            // 随机练习按钮
            const randomBtn = document.querySelector('[onclick*="startRandomPractice"]');
            if (randomBtn) {
                randomBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._startRandomPractice();
                });
            }

            // 浏览题库按钮
            const browseBtn = document.querySelector('[onclick*="goToBrowse"]');
            if (browseBtn) {
                browseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._goToBrowse();
                });
            }

            // 查看进度按钮
            const progressBtn = document.querySelector('[onclick*="viewProgress"]');
            if (progressBtn) {
                progressBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this._viewProgress();
                });
            }
        },

        /**
         * 增强UI元素
         */
        _enhanceUI() {
            // 增强统计卡片
            this._enhanceStatCards();

            // 增强快速开始区域
            this._enhanceQuickStartSection();

            // 增强最近练习区域
            this._enhanceRecentPracticeSection();
        },

        /**
         * 增强统计卡片
         */
        _enhanceStatCards() {
            const statCards = document.querySelectorAll('.stat-card, .stats-grid .stat-card');

            statCards.forEach((card, index) => {
                // 添加点击效果
                card.style.cursor = 'pointer';
                card.addEventListener('click', () => {
                    this._handleStatCardClick(index);
                });

                // 添加加载动画
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';

                setTimeout(() => {
                    card.style.transition = 'all 0.5s ease';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, index * 100);
            });
        },

        /**
         * 增强快速开始区域
         */
        _enhanceQuickStartSection() {
            const quickStartSection = document.querySelector('.settings-section:has(h3:contains("快速开始"))') ||
                                     document.querySelector('.settings-section');

            if (quickStartSection) {
                // 添加标题图标
                const title = quickStartSection.querySelector('h3');
                if (title && !title.querySelector('.icon')) {
                    title.innerHTML = '<span class="icon">🚀</span> ' + title.textContent;
                }

                // 增强按钮样式
                const buttons = quickStartSection.querySelectorAll('.btn');
                buttons.forEach((btn, index) => {
                    btn.classList.add('enhanced-btn');
                    btn.style.animationDelay = `${index * 0.1}s`;
                });
            }
        },

        /**
         * 增强最近练习区域
         */
        _enhanceRecentPracticeSection() {
            const recentSection = document.querySelector('#recentPractice')?.parentElement;

            if (recentSection) {
                // 添加标题图标
                const title = recentSection.querySelector('h3');
                if (title && !title.querySelector('.icon')) {
                    title.innerHTML = '<span class="icon">📈</span> ' + title.textContent;
                }

                // 添加"查看全部"按钮
                if (!recentSection.querySelector('.view-all-btn')) {
                    const viewAllBtn = document.createElement('button');
                    viewAllBtn.className = 'btn btn-secondary view-all-btn';
                    viewAllBtn.textContent = '📋 查看全部记录';
                    viewAllBtn.onclick = () => this._viewAllRecords();

                    title?.parentElement?.appendChild(viewAllBtn);
                }
            }
        },

        /**
         * 加载初始数据
         */
        _loadInitialData() {
            // 获取当前数据
            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            this._updateStats({
                examIndex: examIndex,
                practiceRecords: records
            });
        },

        /**
         * 更新统计数据
         */
        _updateStats(data) {
            const examIndex = data?.examIndex || hpCore.getExamIndex();
            const records = data?.practiceRecords || hpCore.getRecords();

            // 计算统计数据
            const totalExams = examIndex?.length || 0;
            const completedCount = records?.length || 0;

            // 计算平均分数
            const avgScore = completedCount > 0
                ? Math.round(records.reduce((sum, record) => sum + (record.score || 0), 0) / completedCount)
                : 0;

            // 计算学习天数
            const uniqueDays = new Set(
                records?.map(record => new Date(record.date).toDateString()) || []
            ).size;

            // 更新当前统计
            this.currentStats = {
                totalExams,
                completedCount,
                avgScore,
                studyDays: uniqueDays
            };

            // 更新UI显示
            this._updateStatsDisplay();
        },

        /**
         * 更新统计显示
         */
        _updateStatsDisplay() {
            // 更新统计卡片
            const totalExamsEl = document.getElementById('totalExams') || document.getElementById('total-exams-count');
            const completedEl = document.getElementById('completedCount') || document.getElementById('completed-count');
            const avgScoreEl = document.getElementById('avgScore') || document.getElementById('average-score');
            const studyDaysEl = document.getElementById('studyDays') || document.getElementById('study-days');

            if (totalExamsEl) totalExamsEl.textContent = this.currentStats.totalExams;
            if (completedEl) completedEl.textContent = this.currentStats.completedCount;
            if (avgScoreEl) avgScoreEl.textContent = this.currentStats.avgScore + '%';
            if (studyDaysEl) studyDaysEl.textContent = this.currentStats.studyDays;

            // 添加数字动画效果
            this._animateNumbers();
        },

        /**
         * 数字动画效果
         */
        _animateNumbers() {
            const elements = [
                { el: document.getElementById('totalExams'), value: this.currentStats.totalExams },
                { el: document.getElementById('completedCount'), value: this.currentStats.completedCount },
                { el: document.getElementById('avgScore'), value: this.currentStats.avgScore },
                { el: document.getElementById('studyDays'), value: this.currentStats.studyDays }
            ];

            elements.forEach(({ el, value }) => {
                if (el && !isNaN(value)) {
                    this._animateNumber(el, value);
                }
            });
        },

        /**
         * 单个数字动画
         */
        _animateNumber(element, targetValue, duration = 1000) {
            const startValue = parseInt(element.textContent) || 0;
            const startTime = performance.now();

            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // 使用缓动函数
                const easeOut = 1 - Math.pow(1 - progress, 3);
                const currentValue = Math.round(startValue + (targetValue - startValue) * easeOut);

                // 处理百分比
                const isPercentage = element.id === 'avgScore' || element.id === 'average-score';
                element.textContent = isPercentage ? currentValue + '%' : currentValue;

                if (progress < 1) {
                    requestAnimationFrame(animate);
                }
            };

            requestAnimationFrame(animate);
        },

        /**
         * 处理统计卡片点击
         */
        _handleStatCardClick(index) {
            switch (index) {
                case 0: // 总题目数
                    this._goToBrowse();
                    break;
                case 1: // 已完成
                    this._viewProgress();
                    break;
                case 2: // 平均分数
                    this._showScoreAnalysis();
                    break;
                case 3: // 学习天数
                    this._showStudyStreak();
                    break;
            }
        },

        /**
         * 开始随机练习
         */
        _startRandomPractice() {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex || examIndex.length === 0) {
                hpCore.showMessage('题库为空，请先加载题库', 'warning');
                return;
            }

            const randomExam = examIndex[Math.floor(Math.random() * examIndex.length)];
            hpCore.startExam(randomExam.id);
        },

        /**
         * 跳转到浏览页面
         */
        _goToBrowse() {
            // 触发页面切换事件
            hpCore.emit('navigate', { page: 'browse' });

            // 如果有全局页面切换函数
            if (typeof switchToBrowse === 'function') {
                switchToBrowse();
            } else if (typeof showView === 'function') {
                showView('browse');
            }
        },

        /**
         * 查看进度
         */
        _viewProgress() {
            // 触发页面切换事件
            hpCore.emit('navigate', { page: 'practice' });

            // 如果有全局页面切换函数
            if (typeof switchToPractice === 'function') {
                switchToPractice();
            } else if (typeof showView === 'function') {
                showView('practice');
            }
        },

        /**
         * 查看全部记录
         */
        _viewAllRecords() {
            this._viewProgress();
        },

        /**
         * 显示分数分析
         */
        _showScoreAnalysis() {
            const records = hpCore.getRecords();
            if (!records || records.length === 0) {
                hpCore.showMessage('还没有练习记录', 'info');
                return;
            }

            const avgScore = this.currentStats.avgScore;
            const maxScore = Math.max(...records.map(r => r.score || 0));
            const minScore = Math.min(...records.map(r => r.score || 0));

            const message = `📊 分数分析：
平均分数: ${avgScore}%
最高分数: ${maxScore}%
最低分数: ${minScore}%
总练习次数: ${records.length}`;

            hpCore.showMessage(message, 'info', 5000);
        },

        /**
         * 显示学习连续天数
         */
        _showStudyStreak() {
            const records = hpCore.getRecords();
            if (!records || records.length === 0) {
                hpCore.showMessage('还没有练习记录', 'info');
                return;
            }

            const message = `🎯 学习统计：
学习天数: ${this.currentStats.studyDays}天
总练习次数: ${records.length}次
平均每天练习: ${Math.round(records.length / Math.max(this.currentStats.studyDays, 1))}次`;

            hpCore.showMessage(message, 'info', 5000);
        },

        /**
         * 获取插件状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                currentStats: this.currentStats,
                hasData: this.currentStats.totalExams > 0
            };
        }
    };

    // 导出到全局
    window.hpWelcomeUI = hpWelcomeUI;

    // 自动初始化
    hpCore.ready(() => {
        console.log('[HP Welcome UI] hpCore已就绪，开始初始化');
        hpWelcomeUI.init();
    });

    console.log('[HP Welcome UI] Welcome页面UI增强插件已加载');

})();
