/**
 * HP Practice页面桥接插件
 * 负责Practice页面的数据通信、事件处理和系统集成
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    if (typeof hpCore === 'undefined') {
        console.error('[HP Practice Bridge] hpCore未定义');
        return;
    }

    const hpPracticeBridge = {
        // 插件状态
        isInitialized: false,
        eventListeners: new Map(),
        activeExams: new Map(),
        practiceSessions: new Map(),

        /**
         * 初始化插件
         */
        init() {
            if (this.isInitialized) {
                console.log('[HP Practice Bridge] 插件已初始化，跳过重复初始化');
                return;
            }

            console.log('[HP Practice Bridge] 开始初始化Practice页面桥接插件');

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
                this._setupPracticeEventHandlers();
                this._setupDataSynchronization();
                this._setupErrorHandling();
                this.isInitialized = true;
                console.log('[HP Practice Bridge] 插件初始化完成');
            } catch (error) {
                console.error('[HP Practice Bridge] 初始化失败:', error);
            }
        },

        /**
         * 设置事件监听器
         */
        _setupEventListeners() {
            // 监听页面导航事件
            hpCore.on('pageChanged', (page) => {
                if (page === 'practice' || page === 'browse') {
                    this._onPracticePageActivated();
                }
            });

            // 监听练习开始事件
            hpCore.on('examStarted', (examId) => {
                this._onExamStarted(examId);
            });

            // 监听练习完成事件
            hpCore.on('examCompleted', (data) => {
                this._onExamCompleted(data);
            });

            // 监听数据更新事件
            hpCore.on('dataUpdated', (data) => {
                this._onDataUpdated(data);
            });

            // 监听搜索事件
            hpCore.on('searchChanged', (searchTerm) => {
                this._onSearchChanged(searchTerm);
            });

            // 监听过滤器变化事件
            hpCore.on('filterChanged', (filter) => {
                this._onFilterChanged(filter);
            });

            // 设置全局事件监听器
            this._setupGlobalEventListeners();
        },

        /**
         * 设置全局事件监听器
         */
        _setupGlobalEventListeners() {
            // 监听窗口消息事件（跨窗口通信）
            window.addEventListener('message', (event) => {
                this._handleWindowMessage(event);
            });

            // 监听页面可见性变化
            document.addEventListener('visibilitychange', () => {
                this._onVisibilityChanged();
            });

            // 监听页面卸载事件
            window.addEventListener('beforeunload', () => {
                this._onBeforeUnload();
            });

            // 监听键盘快捷键
            document.addEventListener('keydown', (e) => {
                this._handleKeyboardShortcuts(e);
            });
        },

        /**
         * 设置练习事件处理器
         */
        _setupPracticeEventHandlers() {
            // 监听练习窗口的创建
            hpCore.on('practiceWindowCreated', (window, examId) => {
                this._onPracticeWindowCreated(window, examId);
            });

            // 监听练习窗口的关闭
            hpCore.on('practiceWindowClosed', (examId) => {
                this._onPracticeWindowClosed(examId);
            });

            // 监听练习进度更新
            hpCore.on('practiceProgress', (data) => {
                this._onPracticeProgress(data);
            });
        },

        /**
         * 设置数据同步
         */
        _setupDataSynchronization() {
            // 定期同步数据
            this._startDataSync();

            // 监听存储变化
            this._setupStorageListeners();
        },

        /**
         * 设置错误处理
         */
        _setupErrorHandling() {
            // 全局错误处理
            window.addEventListener('error', (e) => {
                this._handleError('JavaScript Error', e.error, e.filename, e.lineno);
            });

            // Promise错误处理
            window.addEventListener('unhandledrejection', (e) => {
                this._handleError('Unhandled Promise Rejection', e.reason);
            });
        },

        /**
         * Practice页面激活时的处理
         */
        _onPracticePageActivated() {
            console.log('[HP Practice Bridge] Practice页面已激活');

            // 更新页面数据
            this._refreshPageData();

            // 检查是否有进行中的练习
            this._checkActiveSessions();

            // 更新UI状态
            this._updateUIState();
        },

        /**
         * 练习开始时的处理
         */
        _onExamStarted(examId) {
            console.log('[HP Practice Bridge] 练习开始:', examId);

            const exam = hpCore.getExamById(examId);
            if (!exam) {
                console.warn('[HP Practice Bridge] 找不到考试数据:', examId);
                return;
            }

            // 创建练习会话
            const session = this._createPracticeSession(examId, exam);

            // 更新UI状态
            this._updateExamStatus(examId, 'in-progress');

            // 显示开始通知
            this._showPracticeNotification('练习已开始', 'info', exam.title);
        },

        /**
         * 练习完成时的处理
         */
        _onExamCompleted(data) {
            console.log('[HP Practice Bridge] 练习完成:', data);

            const { examId, score, duration, answers } = data;

            // 更新练习记录
            this._updatePracticeRecord(examId, score, duration, answers);

            // 更新UI状态
            this._updateExamStatus(examId, 'completed');

            // 显示完成通知
            const exam = hpCore.getExamById(examId);
            this._showPracticeNotification(
                '练习完成',
                'success',
                `${exam?.title || '题目'} - 得分: ${score}%`
            );

            // 触发数据更新事件
            hpCore.emit('practiceCompleted', data);
        },

        /**
         * 数据更新时的处理
         */
        _onDataUpdated(data) {
            console.log('[HP Practice Bridge] 数据已更新');

            // 刷新页面数据
            this._refreshPageData();

            // 更新统计信息
            this._updateStatistics();

            // 检查数据一致性
            this._validateDataConsistency();
        },

        /**
         * 搜索变化时的处理
         */
        _onSearchChanged(searchTerm) {
            console.log('[HP Practice Bridge] 搜索条件变化:', searchTerm);

            // 更新搜索状态
            this._updateSearchState(searchTerm);

            // 触发搜索事件
            this._emitSearchEvent(searchTerm);
        },

        /**
         * 过滤器变化时的处理
         */
        _onFilterChanged(filter) {
            console.log('[HP Practice Bridge] 过滤器变化:', filter);

            // 更新过滤器状态
            this._updateFilterState(filter);

            // 触发过滤器事件
            this._emitFilterEvent(filter);
        },

        /**
         * 处理窗口消息
         */
        _handleWindowMessage(event) {
            const { type, data } = event.data;

            switch (type) {
                case 'INIT_SESSION':
                    this._handleInitSession(event, data);
                    break;
                case 'SESSION_READY':
                    this._handleSessionReady(event, data);
                    break;
                case 'PRACTICE_COMPLETE':
                    this._handlePracticeComplete(event, data);
                    break;
                case 'PRACTICE_PROGRESS':
                    this._handlePracticeProgress(data);
                    break;
                case 'PRACTICE_ERROR':
                    this._handlePracticeError(data);
                    break;
            }
        },

        /**
         * 处理初始化会话消息
         */
        _handleInitSession(event, data) {
            console.log('[HP Practice Bridge] 收到初始化会话消息:', data);

            // 向练习窗口发送初始化数据
            const exam = hpCore.getExamById(data.examId);
            if (exam) {
                event.source.postMessage({
                    type: 'SESSION_DATA',
                    data: {
                        examId: data.examId,
                        examData: exam,
                        sessionId: data.sessionId
                    }
                }, event.origin);
            }
        },

        /**
         * 处理会话准备就绪消息
         */
        _handleSessionReady(event, data) {
            console.log('[HP Practice Bridge] 会话准备就绪:', data);

            // 更新会话状态
            this.practiceSessions.set(data.sessionId, {
                examId: data.examId,
                status: 'ready',
                startTime: new Date()
            });

            // 触发会话准备事件
            hpCore.emit('sessionReady', data);
        },

        /**
         * 处理练习完成消息
         */
        _handlePracticeComplete(event, data) {
            console.log('[HP Practice Bridge] 收到练习完成消息:', data);

            // 处理练习结果
            this._onExamCompleted(data);

            // 关闭练习窗口
            if (event.source && event.source.close) {
                setTimeout(() => {
                    event.source.close();
                }, 1000); // 延迟1秒关闭，给用户时间查看结果
            }
        },

        /**
         * 处理练习进度消息
         */
        _handlePracticeProgress(data) {
            console.log('[HP Practice Bridge] 练习进度更新:', data);

            // 更新进度状态
            this._updatePracticeProgress(data);

            // 触发进度更新事件
            hpCore.emit('practiceProgress', data);
        },

        /**
         * 处理练习错误消息
         */
        _handlePracticeError(data) {
            console.error('[HP Practice Bridge] 练习错误:', data);

            // 显示错误通知
            this._showPracticeNotification('练习出错', 'error', data.message);

            // 触发错误事件
            hpCore.emit('practiceError', data);
        },

        /**
         * 页面可见性变化时的处理
         */
        _onVisibilityChanged() {
            if (document.hidden) {
                // 页面隐藏时暂停一些操作
                this._pauseActiveSessions();
            } else {
                // 页面显示时恢复操作
                this._resumeActiveSessions();
            }
        },

        /**
         * 页面卸载前的处理
         */
        _onBeforeUnload() {
            // 保存当前状态
            this._saveCurrentState();

            // 清理资源
            this._cleanup();
        },

        /**
         * 处理键盘快捷键
         */
        _handleKeyboardShortcuts(e) {
            // Ctrl/Cmd + F: 聚焦搜索框
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                const searchBox = document.getElementById('searchBox') ||
                                 document.querySelector('.search-box') ||
                                 document.querySelector('input[placeholder*="搜索"]');
                if (searchBox) {
                    searchBox.focus();
                    searchBox.select();
                }
            }

            // Escape: 清除搜索
            if (e.key === 'Escape') {
                const searchBox = document.getElementById('searchBox') ||
                                 document.querySelector('.search-box') ||
                                 document.querySelector('input[placeholder*="搜索"]');
                if (searchBox && searchBox === document.activeElement) {
                    searchBox.value = '';
                    this._onSearchChanged('');
                }
            }
        },

        /**
         * 创建练习会话
         */
        _createPracticeSession(examId, exam) {
            const sessionId = `session_${examId}_${Date.now()}`;
            const session = {
                id: sessionId,
                examId: examId,
                examTitle: exam.title,
                startTime: new Date(),
                status: 'active',
                progress: 0
            };

            this.practiceSessions.set(sessionId, session);
            this.activeExams.set(examId, session);

            console.log('[HP Practice Bridge] 创建练习会话:', sessionId);
            return session;
        },

        /**
         * 更新练习记录
         */
        _updatePracticeRecord(examId, score, duration, answers) {
            const exam = hpCore.getExamById(examId);
            if (!exam) return;

            const record = {
                id: `record_${examId}_${Date.now()}`,
                examId: examId,
                title: exam.title,
                type: exam.type,
                category: exam.category,
                score: score,
                duration: duration,
                date: new Date().toISOString(),
                answers: answers || {},
                dataSource: 'hp-practice'
            };

            // 添加到练习记录
            const records = hpCore.getRecords();
            records.push(record);

            // 保存记录
            hpCore.saveRecords(records);

            console.log('[HP Practice Bridge] 练习记录已保存:', record.id);
        },

        /**
         * 更新考试状态
         */
        _updateExamStatus(examId, status) {
            const examCard = document.querySelector(`[data-exam-id="${examId}"]`);
            if (examCard) {
                examCard.classList.remove('status-active', 'status-completed', 'status-available');
                examCard.classList.add(`status-${status}`);
            }

            // 更新活动考试映射
            if (status === 'completed') {
                this.activeExams.delete(examId);
            }
        },

        /**
         * 更新练习进度
         */
        _updatePracticeProgress(data) {
            const { sessionId, progress, currentQuestion } = data;

            const session = this.practiceSessions.get(sessionId);
            if (session) {
                session.progress = progress;
                session.currentQuestion = currentQuestion;
                session.lastUpdate = new Date();

                // 更新UI进度显示
                this._updateProgressUI(sessionId, progress);
            }
        },

        /**
         * 更新进度UI
         */
        _updateProgressUI(sessionId, progress) {
            const progressBar = document.querySelector(`[data-session-id="${sessionId}"] .progress-bar`);
            const progressText = document.querySelector(`[data-session-id="${sessionId}"] .progress-text`);

            if (progressBar) {
                progressBar.style.width = `${progress}%`;
            }

            if (progressText) {
                progressText.textContent = `${Math.round(progress)}%`;
            }
        },

        /**
         * 刷新页面数据
         */
        _refreshPageData() {
            // 刷新考试列表
            const examIndex = hpCore.getExamIndex();
            if (examIndex && examIndex.length > 0) {
                hpCore.emit('dataUpdated', { examIndex });
            }

            // 刷新练习记录
            const records = hpCore.getRecords();
            if (records && records.length > 0) {
                hpCore.emit('recordsUpdated', { records });
            }
        },

        /**
         * 检查活动会话
         */
        _checkActiveSessions() {
            // 检查是否有进行中的练习会话
            const now = new Date();
            const timeout = 30 * 60 * 1000; // 30分钟超时

            for (const [sessionId, session] of this.practiceSessions) {
                if (session.status === 'active' &&
                    (now - session.startTime) > timeout) {
                    // 会话超时，标记为中断
                    session.status = 'interrupted';
                    this._onSessionInterrupted(sessionId, session);
                }
            }
        },

        /**
         * 会话中断处理
         */
        _onSessionInterrupted(sessionId, session) {
            console.log('[HP Practice Bridge] 练习会话中断:', sessionId);

            // 更新UI状态
            this._updateExamStatus(session.examId, 'available');

            // 显示通知
            this._showPracticeNotification(
                '练习会话已中断',
                'warning',
                '长时间未活动，练习会话已自动结束'
            );
        },

        /**
         * 更新UI状态
         */
        _updateUIState() {
            // 更新统计信息
            this._updateStatistics();

            // 更新活动会话指示器
            this._updateActiveSessionIndicator();

            // 更新练习状态
            this._updatePracticeStatus();
        },

        /**
         * 更新统计信息
         */
        _updateStatistics() {
            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            // 更新总题目数
            const totalExamsEl = document.getElementById('totalExams');
            if (totalExamsEl && examIndex) {
                totalExamsEl.textContent = examIndex.length;
            }

            // 更新完成数量
            const completedEl = document.getElementById('completedCount');
            if (completedEl && records) {
                completedEl.textContent = records.length;
            }

            // 更新平均分数
            const avgScoreEl = document.getElementById('avgScore');
            if (avgScoreEl && records && records.length > 0) {
                const avgScore = Math.round(
                    records.reduce((sum, record) => sum + (record.score || 0), 0) / records.length
                );
                avgScoreEl.textContent = avgScore + '%';
            }

            // 更新学习天数
            const studyDaysEl = document.getElementById('studyDays');
            if (studyDaysEl && records && records.length > 0) {
                const uniqueDays = new Set(
                    records.map(record => new Date(record.date).toDateString())
                ).size;
                studyDaysEl.textContent = uniqueDays;
            }
        },

        /**
         * 更新活动会话指示器
         */
        _updateActiveSessionIndicator() {
            const activeCount = this.activeExams.size;
            const indicator = document.getElementById('activeSessionIndicator');

            if (indicator) {
                indicator.textContent = activeCount;
                indicator.style.display = activeCount > 0 ? 'inline-block' : 'none';
            }
        },

        /**
         * 更新练习状态
         */
        _updatePracticeStatus() {
            // 更新每个考试的状态
            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            if (examIndex) {
                examIndex.forEach(exam => {
                    const isCompleted = records.some(record =>
                        record.examId === exam.id || record.title === exam.title
                    );

                    const isActive = this.activeExams.has(exam.id);

                    let status = 'available';
                    if (isActive) status = 'in-progress';
                    else if (isCompleted) status = 'completed';

                    this._updateExamStatus(exam.id, status);
                });
            }
        },

        /**
         * 更新搜索状态
         */
        _updateSearchState(searchTerm) {
            // 更新搜索框显示
            const searchBox = document.getElementById('searchBox') ||
                             document.querySelector('.search-box') ||
                             document.querySelector('input[placeholder*="搜索"]');

            if (searchBox && searchBox.value !== searchTerm) {
                searchBox.value = searchTerm;
            }

            // 更新搜索结果计数
            this._updateSearchResultsCount();
        },

        /**
         * 更新搜索结果计数
         */
        _updateSearchResultsCount() {
            const resultsCountEl = document.getElementById('searchResultsCount');
            if (resultsCountEl && hpPracticeRender) {
                const count = hpPracticeRender.filteredExams.length;
                resultsCountEl.textContent = count;
                resultsCountEl.style.display = count > 0 ? 'inline-block' : 'none';
            }
        },

        /**
         * 更新过滤器状态
         */
        _updateFilterState(filter) {
            // 更新过滤器UI
            const typeFilter = document.getElementById('typeFilter');
            const categoryFilter = document.getElementById('categoryFilter');

            if (typeFilter && filter.type) {
                typeFilter.value = filter.type;
            }

            if (categoryFilter && filter.category) {
                categoryFilter.value = filter.category;
            }
        },

        /**
         * 触发搜索事件
         */
        _emitSearchEvent(searchTerm) {
            // 触发自定义事件
            const event = new CustomEvent('hp:searchChanged', {
                detail: { searchTerm }
            });
            document.dispatchEvent(event);
        },

        /**
         * 触发过滤器事件
         */
        _emitFilterEvent(filter) {
            // 触发自定义事件
            const event = new CustomEvent('hp:filterChanged', {
                detail: { filter }
            });
            document.dispatchEvent(event);
        },

        /**
         * 显示练习通知
         */
        _showPracticeNotification(title, type, message) {
            // 使用hpCore的通知系统
            if (hpCore && typeof hpCore.showNotification === 'function') {
                hpCore.showNotification(`${title}: ${message}`, type);
            } else {
                // 降级到console
                console.log(`[HP Practice Bridge] ${title}: ${message}`);
            }
        },

        /**
         * 开始数据同步
         */
        _startDataSync() {
            // 定期同步数据到存储
            setInterval(() => {
                this._syncDataToStorage();
            }, 30000); // 每30秒同步一次
        },

        /**
         * 同步数据到存储
         */
        _syncDataToStorage() {
            try {
                const examIndex = hpCore.getExamIndex();
                const records = hpCore.getRecords();

                if (examIndex) {
                    hpCore.saveExamIndex(examIndex);
                }

                if (records) {
                    hpCore.saveRecords(records);
                }

                console.log('[HP Practice Bridge] 数据已同步到存储');
            } catch (error) {
                console.error('[HP Practice Bridge] 数据同步失败:', error);
            }
        },

        /**
         * 设置存储监听器
         */
        _setupStorageListeners() {
            // 监听localStorage变化
            window.addEventListener('storage', (e) => {
                if (e.key === 'exam_system_practice_records' ||
                    e.key === 'exam_system_exam_index') {
                    console.log('[HP Practice Bridge] 检测到存储变化，刷新数据');
                    this._refreshPageData();
                }
            });
        },

        /**
         * 暂停活动会话
         */
        _pauseActiveSessions() {
            console.log('[HP Practice Bridge] 暂停活动会话');
            // 实现会话暂停逻辑
        },

        /**
         * 恢复活动会话
         */
        _resumeActiveSessions() {
            console.log('[HP Practice Bridge] 恢复活动会话');
            // 实现会话恢复逻辑
        },

        /**
         * 保存当前状态
         */
        _saveCurrentState() {
            try {
                const state = {
                    activeExams: Array.from(this.activeExams.entries()),
                    practiceSessions: Array.from(this.practiceSessions.entries()),
                    timestamp: new Date().toISOString()
                };

                sessionStorage.setItem('hpPracticeState', JSON.stringify(state));
                console.log('[HP Practice Bridge] 状态已保存');
            } catch (error) {
                console.error('[HP Practice Bridge] 保存状态失败:', error);
            }
        },

        /**
         * 清理资源
         */
        _cleanup() {
            // 清理事件监听器
            this.eventListeners.forEach((listener, event) => {
                document.removeEventListener(event, listener);
            });
            this.eventListeners.clear();

            // 清理会话数据
            this.activeExams.clear();
            this.practiceSessions.clear();

            console.log('[HP Practice Bridge] 资源已清理');
        },

        /**
         * 处理错误
         */
        _handleError(type, error, filename, lineno) {
            const errorInfo = {
                type: type,
                message: error?.message || error || 'Unknown error',
                stack: error?.stack || '',
                filename: filename || 'unknown',
                lineno: lineno || 0,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            console.error('[HP Practice Bridge] 错误:', errorInfo);

            // 发送错误报告
            this._reportError(errorInfo);
        },

        /**
         * 报告错误
         */
        _reportError(errorInfo) {
            // 这里可以实现错误报告逻辑，比如发送到服务器
            console.log('[HP Practice Bridge] 错误报告:', errorInfo);
        },

        /**
         * 验证数据一致性
         */
        _validateDataConsistency() {
            try {
                const examIndex = hpCore.getExamIndex();
                const records = hpCore.getRecords();

                let issues = [];

                // 检查记录中的examId是否存在于examIndex中
                if (records && records.length > 0) {
                    records.forEach(record => {
                        const examExists = examIndex.some(exam =>
                            exam.id === record.examId || exam.title === record.title
                        );

                        if (!examExists) {
                            issues.push(`练习记录引用了不存在的题目: ${record.examId || record.title}`);
                        }
                    });
                }

                if (issues.length > 0) {
                    console.warn('[HP Practice Bridge] 数据一致性问题:', issues);
                } else {
                    console.log('[HP Practice Bridge] 数据一致性检查通过');
                }
            } catch (error) {
                console.error('[HP Practice Bridge] 数据一致性检查失败:', error);
            }
        },

        /**
         * 获取插件状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                activeExamsCount: this.activeExams.size,
                practiceSessionsCount: this.practiceSessions.size,
                eventListenersCount: this.eventListeners.size
            };
        }
    };

    // 导出到全局
    window.hpPracticeBridge = hpPracticeBridge;

    // 自动初始化
    hpCore.ready(() => {
        console.log('[HP Practice Bridge] hpCore已就绪，开始初始化');
        hpPracticeBridge.init();
    });

    console.log('[HP Practice Bridge] Practice页面桥接插件已加载');

})();