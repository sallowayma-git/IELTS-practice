(function(global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');

    const mixin = {
        initializeSuiteMode() {
            if (this._suiteModeReady) {
                return;
            }

            this._suiteModeReady = true;
            this.currentSuiteSession = null;
            this.suiteExamMap = new Map();
            this.multiSuiteSessionsMap = new Map(); // 新增：存储多套题会话
            if (typeof this._clearSuiteHandshakes === 'function') {
                this._clearSuiteHandshakes();
            }
        },

        async startSuitePractice() {
            const suiteWindowName = 'ielts-suite-mode-tab';

            try {
                if (!this._suiteModeReady) {
                    this.initializeSuiteMode();
                }

                if (this.currentSuiteSession && this.currentSuiteSession.status === 'active') {
                    window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                    return;
                }

                if (typeof this.openExam !== 'function') {
                    window.showMessage && window.showMessage('当前版本暂不支持套题练习自动打开题目。', 'error');
                    return;
                }

                const examIndex = await this._fetchSuiteExamIndex();
                if (!examIndex.length) {
                    window.showMessage && window.showMessage('题库为空，无法开启套题练习。', 'warning');
                    return;
                }

                const normalizedIndex = examIndex
                    .map(item => {
                        if (!item || typeof item !== 'object') {
                            return null;
                        }
                        const normalizedType = (item.type || 'reading').toLowerCase();
                        const normalizedCategory = typeof item.category === 'string'
                            ? item.category.trim().toUpperCase()
                            : '';
                        if (normalizedType !== 'reading') {
                            return null;
                        }
                        return {
                            ...item,
                            type: 'reading',
                            category: normalizedCategory
                        };
                    })
                    .filter(Boolean);

                const categories = ['P1', 'P2', 'P3'];
                const sequence = [];
                for (const category of categories) {
                    const pool = normalizedIndex.filter(item => item.category === category);
                    if (!pool.length) {
                        window.showMessage && window.showMessage(`题库缺少 ${category} 阅读题目，无法开启套题练习。`, 'warning');
                        return;
                    }
                    const picked = pool[Math.floor(Math.random() * pool.length)];
                    sequence.push({ examId: picked.id, exam: picked });
                }

                this._clearSuiteHandshakes();

                const suiteSessionId = this._generateSuiteSessionId();
                const session = {
                    id: suiteSessionId,
                    status: 'initializing',
                    startTime: Date.now(),
                    sequence,
                    currentIndex: 0,
                    results: [],
                    windowRef: null,
                    windowName: suiteWindowName
                };

                this.currentSuiteSession = session;
                this._registerSuiteSequence(session);

                const firstEntry = sequence[0];
                window.showMessage && window.showMessage('套题练习已启动，正在打开第一篇。', 'info');

                let examWindow = null;
                try {
                    examWindow = await this.openExam(firstEntry.examId, {
                        target: 'tab',
                        windowName: suiteWindowName,
                        suiteSessionId: suiteSessionId,
                        sequenceIndex: 0
                    });
                } catch (openError) {
                    console.error('[SuitePractice] 打开首篇失败:', openError);
                    examWindow = null;
                }

                if (!examWindow || examWindow.closed) {
                    throw new Error('first_exam_window_unavailable');
                }

                session.windowRef = examWindow;
                this._ensureSuiteWindowGuard(session, session.windowRef);
                session.status = 'active';
                session.activeExamId = firstEntry.examId;
                this._focusSuiteWindow(session.windowRef);
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                if (this.currentSuiteSession) {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            }
        },

        async handleSuitePracticeComplete(examId, data) {
            // 首先检查是否为多套题模式（通过suiteId字段判断）
            if (data && data.suiteId) {
                return await this.handleMultiSuitePracticeComplete(examId, data);
            }

            if (!this.currentSuiteSession || !this.suiteExamMap || !this.suiteExamMap.has(examId)) {
                return false;
            }

            const session = this.currentSuiteSession;
            if (session.status !== 'active' || this.suiteExamMap.get(examId) !== session.id) {
                return false;
            }

            const sequenceEntry = session.sequence.find(item => item.examId === examId);
            if (!sequenceEntry) {
                await this._abortSuiteSession(session, { reason: 'missing_sequence' });
                return false;
            }

            const alreadyRecorded = session.results.some(entry => entry.examId === examId);
            if (alreadyRecorded) {
                return true;
            }

            const normalized = this._normalizeSuiteResult(sequenceEntry.exam, data);
            session.results.push(normalized);
            session.lastUpdate = Date.now();
            this.updateExamStatus && this.updateExamStatus(examId, 'completed');

            const currentIndex = session.sequence.findIndex(item => item.examId === examId);
            session.currentIndex = currentIndex + 1;

            if (typeof this.cleanupExamSession === 'function') {
                try {
                    await this.cleanupExamSession(examId);
                } catch (cleanupError) {
                    console.warn('[SuitePractice] 清理上一篇会话失败:', cleanupError);
                }
            }

            const hasNext = session.currentIndex < session.sequence.length;
            if (!hasNext) {
                await this.finalizeSuiteRecord(session);
                return true;
            }

            if (typeof this.openExam !== 'function') {
                window.showMessage && window.showMessage('无法继续套题练习，系统将恢复为普通模式。', 'warning');
                await this._abortSuiteSession(session, { reason: 'missing_open_exam', skipExamId: examId });
                return false;
            }

            const nextEntry = session.sequence[session.currentIndex];
            session.activeExamId = nextEntry.examId;
            const windowName = session.windowName || 'ielts-suite-mode-tab';
            const reuseWindow = session.windowRef && !session.windowRef.closed ? session.windowRef : null;
            let openError = null;

            const attemptOpen = async (candidateWindow = null) => {
                const options = {
                    target: 'tab',
                    windowName,
                    suiteSessionId: session.id,
                    sequenceIndex: session.currentIndex
                };

                if (candidateWindow && !candidateWindow.closed) {
                    options.reuseWindow = candidateWindow;
                }

                try {
                    const opened = await this.openExam(nextEntry.examId, options);
                    if (opened && !opened.closed) {
                        return opened;
                    }
                } catch (error) {
                    openError = error;
                    console.warn('[SuitePractice] 套题下一篇打开失败:', error);
                }

                return null;
            };

            let nextWindow = null;

            if (reuseWindow) {
                nextWindow = await attemptOpen(reuseWindow);
            }

            if ((!nextWindow || nextWindow.closed) && windowName) {
                const fallbackWindow = typeof this._reacquireSuiteWindow === 'function'
                    ? this._reacquireSuiteWindow(windowName, session)
                    : this._openNamedSuiteWindow(windowName, session);
                if (fallbackWindow && !fallbackWindow.closed) {
                    nextWindow = await attemptOpen(fallbackWindow);
                }
            }

            if (!nextWindow || nextWindow.closed) {
                if (openError) {
                    console.warn('[SuitePractice] 套题无法打开下一篇:', openError);
                }
                window.showMessage && window.showMessage('无法继续套题练习，系统将恢复为普通模式。', 'warning');
                await this._abortSuiteSession(session, { reason: 'open_next_failed', skipExamId: examId });
                return false;
            }

            session.windowRef = nextWindow;
            this._ensureSuiteWindowGuard(session, session.windowRef);
            this._focusSuiteWindow(session.windowRef);

            window.showMessage && window.showMessage(`已完成 ${sequenceEntry.exam.title}，继续下一篇 ${nextEntry.exam.title}。`, 'success');
            return true;
        },

        /**
         * 处理多套题练习完成（用于100 P1/P4等包含多套题的HTML页面）
         * @param {string} examId - 考试ID（可能包含套题后缀）
         * @param {object} suiteData - 套题数据
         * @returns {boolean} 是否成功处理
         */
        async handleMultiSuitePracticeComplete(examId, suiteData) {
            if (!suiteData || !suiteData.suiteId) {
                console.warn('[MultiSuite] 缺少suiteId，无法处理多套题完成');
                return false;
            }

            console.log('[MultiSuite] 处理套题完成:', examId, '套题ID:', suiteData.suiteId);

            // 获取或创建多套题会话
            const session = this.getOrCreateMultiSuiteSession(examId);

            // 检查是否已经记录过这个套题
            const alreadyRecorded = session.suiteResults.some(
                result => result.suiteId === suiteData.suiteId
            );

            if (alreadyRecorded) {
                console.warn('[MultiSuite] 套题已记录，跳过:', suiteData.suiteId);
                return true;
            }

            // 添加套题结果到会话
            const suiteResult = {
                suiteId: suiteData.suiteId,
                examId: examId,
                answers: suiteData.answers || {},
                correctAnswers: suiteData.correctAnswers || {},
                answerComparison: suiteData.answerComparison || {},
                scoreInfo: suiteData.scoreInfo || { correct: 0, total: 0, accuracy: 0, percentage: 0 },
                spellingErrors: suiteData.spellingErrors || [],
                timestamp: Date.now(),
                duration: suiteData.duration || 0,
                metadata: {
                    sessionId: suiteData.sessionId,
                    completedAt: new Date().toISOString()
                }
            };

            session.suiteResults.push(suiteResult);
            session.lastUpdate = Date.now();

            console.log('[MultiSuite] 已添加套题结果:', suiteData.suiteId, 
                `当前进度: ${session.suiteResults.length} 套题`);

            // 如果这是第一个套题，尝试从数据中确定预期套题数量
            if (session.suiteResults.length === 1 && !session.expectedSuiteCount) {
                session.expectedSuiteCount = this._detectExpectedSuiteCount(examId, suiteData);
                console.log('[MultiSuite] 检测到预期套题数量:', session.expectedSuiteCount);
            }

            // 检查是否所有套题都已完成
            if (this.isMultiSuiteComplete(session)) {
                console.log('[MultiSuite] 所有套题已完成，开始聚合记录');
                await this.finalizeMultiSuiteRecord(session);
                return true;
            }

            // 还有套题未完成，保存当前进度
            console.log('[MultiSuite] 等待更多套题完成...', 
                `已完成: ${session.suiteResults.length}/${session.expectedSuiteCount || '?'}`);

            return true;
        },

        /**
         * 检测预期的套题数量
         * @param {string} examId - 考试ID
         * @param {object} suiteData - 套题数据
         * @returns {number} 预期套题数量
         */
        _detectExpectedSuiteCount(examId, suiteData) {
            // 尝试从suiteData中获取总套题数
            if (suiteData.totalSuites && Number.isFinite(suiteData.totalSuites)) {
                return suiteData.totalSuites;
            }

            // 尝试从metadata中获取
            if (suiteData.metadata && suiteData.metadata.totalSuites) {
                const count = Number(suiteData.metadata.totalSuites);
                if (Number.isFinite(count) && count > 0) {
                    return count;
                }
            }

            // 根据examId推断（100 P1/P4 通常包含10套题）
            const lowerExamId = (examId || '').toLowerCase();
            if (lowerExamId.includes('100') && (lowerExamId.includes('p1') || lowerExamId.includes('p4'))) {
                return 10; // 默认10套题
            }

            // 默认返回1（单套题）
            return 1;
        },

        /**
         * 完成并聚合多套题记录
         * @param {object} session - 多套题会话
         */
        async finalizeMultiSuiteRecord(session) {
            if (!session || !Array.isArray(session.suiteResults) || session.suiteResults.length === 0) {
                console.warn('[MultiSuite] 无效的会话或无结果，跳过聚合');
                return;
            }

            session.status = 'finalizing';
            console.log('[MultiSuite] 开始聚合多套题记录:', session.id);

            try {
                const completionTime = Date.now();
                const startTime = session.startTime || completionTime;

                // 聚合分数
                const aggregatedScores = this.aggregateScores(session.suiteResults);

                // 聚合答案
                const aggregatedAnswers = this.aggregateAnswers(session.suiteResults);

                // 聚合答案比较
                const aggregatedComparison = this.aggregateAnswerComparisons(session.suiteResults);

                // 聚合拼写错误
                const aggregatedSpellingErrors = this.aggregateSpellingErrors(session.suiteResults);

                // 计算总时长
                const totalDuration = session.suiteResults.reduce(
                    (sum, result) => sum + (result.duration || 0), 
                    0
                );

                // 生成记录标题
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const source = session.metadata?.source || 'listening';
                const sourceLabel = source.toUpperCase();
                const displayTitle = `${dateLabel} ${sourceLabel} 多套题练习`;

                // 构建聚合记录
                const record = {
                    id: session.id,
                    examId: session.baseExamId,
                    title: displayTitle,
                    type: 'listening',
                    multiSuite: true,
                    date: new Date(completionTime).toISOString(),
                    startTime: new Date(startTime).toISOString(),
                    endTime: new Date(completionTime).toISOString(),
                    duration: totalDuration,
                    
                    // 聚合的分数信息
                    scoreInfo: aggregatedScores,
                    totalQuestions: aggregatedScores.total,
                    correctAnswers: aggregatedScores.correct,
                    accuracy: aggregatedScores.accuracy,
                    percentage: aggregatedScores.percentage,
                    
                    // 聚合的答案数据
                    answers: aggregatedAnswers,
                    answerComparison: aggregatedComparison,
                    
                    // 套题详情
                    suiteEntries: session.suiteResults.map(result => ({
                        suiteId: result.suiteId,
                        examId: result.examId,
                        scoreInfo: result.scoreInfo,
                        answers: result.answers,
                        answerComparison: result.answerComparison,
                        spellingErrors: result.spellingErrors || [],
                        duration: result.duration || 0,
                        timestamp: result.timestamp
                    })),
                    
                    // 拼写错误汇总
                    spellingErrors: aggregatedSpellingErrors,
                    
                    // 元数据
                    metadata: {
                        examTitle: displayTitle,
                        category: sourceLabel,
                        source: source,
                        frequency: 'multi-suite',
                        suiteCount: session.suiteResults.length,
                        expectedSuiteCount: session.expectedSuiteCount,
                        sessionId: session.id,
                        startedAt: new Date(startTime).toISOString(),
                        completedAt: new Date(completionTime).toISOString()
                    },
                    
                    realData: {
                        isRealData: true,
                        source: 'multi_suite_mode',
                        duration: totalDuration,
                        correct: aggregatedScores.correct,
                        total: aggregatedScores.total,
                        accuracy: aggregatedScores.accuracy,
                        percentage: aggregatedScores.percentage,
                        suiteCount: session.suiteResults.length
                    }
                };

                // 保存聚合记录
                await this._saveSuitePracticeRecord(record);

                // 保存拼写错误到词表
                if (aggregatedSpellingErrors.length > 0 && window.spellingErrorCollector) {
                    try {
                        await window.spellingErrorCollector.saveErrors(aggregatedSpellingErrors);
                        console.log('[MultiSuite] 已保存拼写错误到词表:', aggregatedSpellingErrors.length);
                    } catch (error) {
                        console.warn('[MultiSuite] 保存拼写错误失败:', error);
                    }
                }

                // 更新状态
                await this._updatePracticeRecordsState();
                this.refreshOverviewData && this.refreshOverviewData();

                // 清理会话
                this.multiSuiteSessionsMap.delete(session.baseExamId);
                session.status = 'completed';

                window.showMessage && window.showMessage(
                    `多套题练习已完成！共完成 ${session.suiteResults.length} 套题，记录已保存。`, 
                    'success'
                );

                console.log('[MultiSuite] 聚合记录已保存:', record.id);

            } catch (error) {
                console.error('[MultiSuite] 聚合记录失败:', error);
                session.status = 'error';
                window.showMessage && window.showMessage('保存多套题记录失败，请稍后重试。', 'error');
            }
        },

        /**
         * 聚合多套题的分数
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的分数信息
         */
        aggregateScores(suiteResults) {
            if (!Array.isArray(suiteResults) || suiteResults.length === 0) {
                return { correct: 0, total: 0, accuracy: 0, percentage: 0 };
            }

            let totalCorrect = 0;
            let totalQuestions = 0;

            suiteResults.forEach(result => {
                const scoreInfo = result.scoreInfo || {};
                totalCorrect += Number(scoreInfo.correct) || 0;
                totalQuestions += Number(scoreInfo.total) || 0;
            });

            const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
            const percentage = Math.round(accuracy * 100);

            return {
                correct: totalCorrect,
                total: totalQuestions,
                accuracy: accuracy,
                percentage: percentage,
                source: 'multi_suite_aggregated'
            };
        },

        /**
         * 聚合多套题的答案
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的答案对象
         */
        aggregateAnswers(suiteResults) {
            const aggregated = {};

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const suiteId = result.suiteId || 'unknown';
                const answers = result.answers || {};

                Object.entries(answers).forEach(([questionId, answer]) => {
                    // 使用 "套题ID::问题ID" 格式
                    const key = `${suiteId}::${questionId}`;
                    aggregated[key] = answer;
                });
            });

            return aggregated;
        },

        /**
         * 聚合多套题的答案比较
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的答案比较对象
         */
        aggregateAnswerComparisons(suiteResults) {
            const aggregated = {};

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const suiteId = result.suiteId || 'unknown';
                const comparison = result.answerComparison || {};

                Object.entries(comparison).forEach(([questionId, comparisonData]) => {
                    // 使用 "套题ID::问题ID" 格式
                    const key = `${suiteId}::${questionId}`;
                    aggregated[key] = comparisonData;
                });
            });

            return aggregated;
        },

        /**
         * 聚合多套题的拼写错误
         * @param {Array} suiteResults - 套题结果数组
         * @returns {Array} 聚合的拼写错误数组
         */
        aggregateSpellingErrors(suiteResults) {
            const aggregated = [];
            const errorMap = new Map(); // 用于去重和合并相同单词的错误

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const errors = result.spellingErrors || [];
                
                errors.forEach(error => {
                    if (!error || !error.word) {
                        return;
                    }

                    const key = error.word.toLowerCase();

                    if (errorMap.has(key)) {
                        // 更新已存在的错误记录
                        const existing = errorMap.get(key);
                        existing.errorCount = (existing.errorCount || 1) + 1;
                        existing.timestamp = Math.max(existing.timestamp || 0, error.timestamp || 0);
                        
                        // 保留最新的用户输入
                        if (error.timestamp > (existing.timestamp || 0)) {
                            existing.userInput = error.userInput;
                        }
                    } else {
                        // 添加新的错误记录
                        errorMap.set(key, {
                            word: error.word,
                            userInput: error.userInput,
                            questionId: error.questionId,
                            suiteId: error.suiteId || result.suiteId,
                            examId: error.examId || result.examId,
                            timestamp: error.timestamp || Date.now(),
                            errorCount: error.errorCount || 1,
                            source: error.source || this._detectMultiSuiteSource(result.examId)
                        });
                    }
                });
            });

            // 转换为数组
            errorMap.forEach(error => aggregated.push(error));

            return aggregated;
        },

        async finalizeSuiteRecord(session) {
            if (!session || !session.results || !session.results.length) {
                await this._teardownSuiteSession(session);
                return;
            }

            session.status = 'finalizing';

            try {
                const completionTime = Date.now();
                const suiteEntries = session.results.map(entry => ({
                    examId: entry.examId,
                    title: entry.title,
                    category: entry.category,
                    duration: entry.duration,
                    scoreInfo: entry.scoreInfo,
                    answers: entry.answers,
                    answerComparison: entry.answerComparison,
                    rawData: entry.rawData || {}
                }));

                const entryDurations = session.results.map(entry => Number.isFinite(entry.duration) ? entry.duration : 0);
                const summedDuration = entryDurations.reduce((sum, value) => sum + value, 0);
                const startTimestamp = session.startTime || completionTime;
                const elapsedMs = Math.max(0, completionTime - startTimestamp);
                const elapsedSeconds = Math.max(0, Math.round(elapsedMs / 1000));
                const totalDuration = elapsedSeconds > 0 ? Math.max(summedDuration, elapsedSeconds) : summedDuration;
                const totalCorrect = session.results.reduce((sum, entry) => sum + entry.scoreInfo.correct, 0);
                const totalQuestions = session.results.reduce((sum, entry) => sum + entry.scoreInfo.total, 0);
                const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) : 0;
                const percentage = Math.round(accuracy * 100);

                const aggregatedAnswers = {};
                const aggregatedComparison = {};
                session.results.forEach(entry => {
                    const prefix = entry.examId ? `${entry.examId}::` : '';
                    const answersSource = entry.answers && typeof entry.answers === 'object'
                        ? entry.answers
                        : Array.isArray(entry.answers)
                            ? entry.answers.reduce((map, item) => {
                                if (item && item.questionId) {
                                    map[item.questionId] = item.answer || item.userAnswer || '';
                                }
                                return map;
                            }, {})
                            : {};
                    Object.keys(answersSource || {}).forEach(questionId => {
                        aggregatedAnswers[`${prefix}${questionId}`] = answersSource[questionId];
                    });

                    const comparisonSource = entry.answerComparison && typeof entry.answerComparison === 'object'
                        ? entry.answerComparison
                        : {};
                    Object.keys(comparisonSource).forEach(questionId => {
                        aggregatedComparison[`${prefix}${questionId}`] = comparisonSource[questionId];
                    });
                });

                const startTime = startTimestamp;
                const startTimeIso = new Date(startTime).toISOString();
                const endTimeIso = new Date(completionTime).toISOString();
                const suiteSequence = await this._resolveSuiteSequenceNumber(startTime);
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const displayTitle = `${dateLabel}套题练习${suiteSequence}`;

                const record = {
                    id: session.id,
                    examId: `suite-${session.id}`,
                    title: displayTitle,
                    type: 'reading',
                    suiteMode: true,
                    date: endTimeIso,
                    startTime: startTimeIso,
                    endTime: endTimeIso,
                    duration: totalDuration,
                    totalQuestions,
                    correctAnswers: totalCorrect,
                    accuracy,
                    percentage,
                    scoreInfo: { correct: totalCorrect, total: totalQuestions, accuracy, percentage },
                    answers: aggregatedAnswers,
                    answerComparison: aggregatedComparison,
                    suiteEntries,
                    frequency: 'suite',
                    metadata: {
                        examTitle: displayTitle,
                        category: '套题练习',
                        frequency: 'suite',
                        suiteSequence,
                        suiteDisplayDate: dateLabel,
                        suiteSessionId: session.id,
                        suiteEntries,
                        startedAt: startTimeIso,
                        completedAt: endTimeIso
                    },
                    realData: {
                        isRealData: true,
                        source: 'suite_mode',
                        duration: totalDuration,
                        correct: totalCorrect,
                        total: totalQuestions,
                        accuracy,
                        percentage,
                        suiteEntries
                    },
                    sessionId: session.id
                };

                await this._saveSuitePracticeRecord(record);
                await this._updatePracticeRecordsState();
                this.refreshOverviewData && this.refreshOverviewData();
                window.showMessage && window.showMessage('套题练习已完成，记录已保存。', 'success');
                session.status = 'completed';
            } catch (error) {
                console.error('[SuitePractice] 保存套题记录失败:', error);
                window.showMessage && window.showMessage('保存套题记录失败，系统将尝试恢复为普通模式。', 'error');
                await this._savePartialSuiteAsIndividual(session);
                session.status = 'error';
            } finally {
                await this._teardownSuiteSession(session);
            }
        },

        async _fetchSuiteExamIndex() {
            let list = this.getState ? this.getState('exam.index') : null;
            if (!Array.isArray(list) || !list.length) {
                try {
                    const activeKey = await storage.get('active_exam_index_key', 'exam_index');
                    list = await storage.get(activeKey, []);
                    if (!Array.isArray(list) || !list.length) {
                        list = await storage.get('exam_index', []);
                    }
                } catch (error) {
                    console.warn('[SuitePractice] 读取题库失败，使用默认题库。', error);
                    list = await storage.get('exam_index', []);
                }
            }

            return Array.isArray(list) ? list.filter(Boolean) : [];
        },

        _generateSuiteSessionId() {
            return `suite_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
        },

        _registerSuiteSequence(session) {
            if (!this.suiteExamMap) {
                this.suiteExamMap = new Map();
            }

            session.sequence.forEach(item => {
                this.suiteExamMap.set(item.examId, session.id);
            });
        },

        _resolveSuiteSessionId(examId, windowInfo = {}) {
            if (windowInfo && windowInfo.suiteSessionId) {
                return windowInfo.suiteSessionId;
            }

            if (this.suiteExamMap && this.suiteExamMap.has(examId)) {
                return this.suiteExamMap.get(examId);
            }

            if (this.currentSuiteSession && this.currentSuiteSession.activeExamId === examId) {
                return this.currentSuiteSession.id;
            }

            return null;
        },

        _normalizeSuiteResult(exam, rawData) {
            const toNumber = (value, fallback = 0) => {
                if (value == null) {
                    return fallback;
                }
                const normalized = typeof value === 'string' && value.trim() !== ''
                    ? Number(value.trim())
                    : Number(value);
                return Number.isFinite(normalized) ? normalized : fallback;
            };

            const score = rawData && rawData.scoreInfo ? rawData.scoreInfo : {};
            const answers = rawData && rawData.answers ? rawData.answers : {};
            const comparison = rawData && rawData.answerComparison
                ? rawData.answerComparison
                : (score && score.details ? score.details : {});

            const correct = toNumber(score.correct, 0);
            const total = toNumber(score.total, Object.keys(answers).length);

            const normalizedAccuracy = Number.isFinite(score.accuracy)
                ? score.accuracy
                : toNumber(score.accuracy, Number.NaN);
            const accuracy = Number.isFinite(normalizedAccuracy)
                ? normalizedAccuracy
                : (total > 0 ? correct / total : 0);

            const normalizedPercentage = Number.isFinite(score.percentage)
                ? score.percentage
                : toNumber(score.percentage, accuracy * 100);
            const percentageBase = Number.isFinite(normalizedPercentage)
                ? normalizedPercentage
                : (accuracy * 100);
            const percentage = Math.round(percentageBase);
            const duration = toNumber(rawData?.duration, 0);

            return {
                examId: exam.id,
                title: exam.title,
                category: exam.category,
                duration,
                scoreInfo: {
                    correct,
                    total,
                    accuracy,
                    percentage,
                    source: score && score.source ? score.source : 'suite_mode_aggregated'
                },
                answers,
                answerComparison: comparison,
                rawData: rawData || {}
            };
        },

        async _saveSuitePracticeRecord(record) {
            const recorderAvailable = this.components
                && this.components.practiceRecorder
                && typeof this.components.practiceRecorder.savePracticeRecord === 'function';

            if (recorderAvailable) {
                try {
                    await this.components.practiceRecorder.savePracticeRecord(record);
                    await this._cleanupSuiteEntryRecords(record).catch(error => {
                        console.warn('[SuitePractice] 清理套题子记录失败:', error);
                    });
                    return;
                } catch (error) {
                    console.warn('[SuitePractice] PracticeRecorder 保存套题记录失败，改用降级存储:', error);
                }
            }

            await this._saveSuitePracticeRecordFallback(record);
        },

        async _saveSuitePracticeRecordFallback(record) {
            let practiceRecords = await storage.get('practice_records', []);
            if (!Array.isArray(practiceRecords)) {
                practiceRecords = [];
            }

            practiceRecords.unshift(record);
            if (practiceRecords.length > MAX_LEGACY_PRACTICE_RECORDS) {
                practiceRecords.splice(MAX_LEGACY_PRACTICE_RECORDS);
            }

            await storage.set('practice_records', practiceRecords);
            await this._cleanupSuiteEntryRecords(record).catch(error => {
                console.warn('[SuitePractice] 清理套题子记录失败:', error);
            });
        },

        async _cleanupSuiteEntryRecords(record) {
            if (!record || !Array.isArray(record.suiteEntries) || record.suiteEntries.length === 0) {
                return;
            }

            let practiceRecords = await storage.get('practice_records', []);
            if (!Array.isArray(practiceRecords) || practiceRecords.length === 0) {
                return;
            }

            const entrySessionIds = new Set();
            const entryExamIds = new Set();
            const entryTimestamps = [];

            record.suiteEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                if (entry.examId) {
                    entryExamIds.add(entry.examId);
                }
                const raw = entry.rawData || {};
                if (raw.sessionId) {
                    entrySessionIds.add(raw.sessionId);
                }
                const ts = raw.completedAt || raw.endTime || raw.timestamp;
                if (ts) {
                    const parsed = new Date(ts).getTime();
                    if (Number.isFinite(parsed)) {
                        entryTimestamps.push(parsed);
                    }
                }
            });

            if (entrySessionIds.size === 0 && entryExamIds.size === 0) {
                return;
            }

            const referenceTime = (() => {
                if (entryTimestamps.length) {
                    const sum = entryTimestamps.reduce((acc, value) => acc + value, 0);
                    return sum / entryTimestamps.length;
                }
                const fallbackTs = new Date(record.endTime || record.date || record.createdAt || Date.now()).getTime();
                return Number.isFinite(fallbackTs) ? fallbackTs : Date.now();
            })();
            const tolerance = 10 * 60 * 1000; // 10分钟

            const isSuiteRecord = (rec) => {
                if (!rec || typeof rec !== 'object') {
                    return false;
                }
                if (rec.suiteMode) {
                    return true;
                }
                const freq = String(rec.frequency || '').toLowerCase();
                const metaFreq = String(rec.metadata && rec.metadata.frequency || '').toLowerCase();
                return freq === 'suite' || metaFreq === 'suite';
            };

            const before = practiceRecords.length;
            practiceRecords = practiceRecords.filter((rec) => {
                if (!rec || typeof rec !== 'object') {
                    return true;
                }
                if (rec.sessionId === record.sessionId) {
                    return true; // 保留聚合记录
                }
                const sessionMatch = rec.sessionId && entrySessionIds.has(rec.sessionId);
                if (sessionMatch) {
                    return false;
                }
                if (isSuiteRecord(rec)) {
                    return true;
                }
                const examMatch = rec.examId && entryExamIds.has(rec.examId);
                if (!examMatch) {
                    return true;
                }
                const recTime = new Date(rec.endTime || rec.date || rec.timestamp || rec.createdAt || Date.now()).getTime();
                if (!Number.isFinite(recTime)) {
                    return true;
                }
                const withinWindow = Math.abs(recTime - referenceTime) <= tolerance;
                return !withinWindow;
            });

            if (practiceRecords.length !== before) {
                await storage.set('practice_records', practiceRecords);
                console.log(`[SuitePractice] 已清理 ${before - practiceRecords.length} 条套题子记录`);
            }
        },

        async _updatePracticeRecordsState() {
            try {
                if (typeof window.syncPracticeRecords === 'function') {
                    window.syncPracticeRecords();
                } else if (window.storage) {
                    const latest = await window.storage.get('practice_records', []);
                    if (this.setState) {
                        this.setState('practice.records', Array.isArray(latest) ? latest : []);
                    }
                }
            } catch (error) {
                console.warn('[SuitePractice] 同步练习记录失败:', error);
            }

            try {
                if (typeof window.updatePracticeView === 'function') {
                    window.updatePracticeView();
                }
            } catch (error) {
                console.warn('[SuitePractice] 刷新练习视图失败:', error);
            }
        },

        _formatSuiteDateLabel(timestamp) {
            const date = new Date(timestamp);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${month}月${day}日`;
        },

        async _resolveSuiteSequenceNumber(timestamp) {
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) {
                return 1;
            }

            const targetYear = date.getFullYear();
            const targetMonth = date.getMonth();
            const targetDate = date.getDate();

            const normalizeList = list => (Array.isArray(list) ? list : []);

            const collectRecords = async () => {
                if (this.components && this.components.practiceRecorder && typeof this.components.practiceRecorder.getPracticeRecords === 'function') {
                    try {
                        const records = await this.components.practiceRecorder.getPracticeRecords();
                        return normalizeList(records);
                    } catch (error) {
                        console.warn('[SuitePractice] 读取PracticeRecorder记录失败，尝试使用存储降级:', error);
                    }
                }

                if (typeof storage?.get === 'function') {
                    try {
                        const fallbackRecords = await storage.get('practice_records', []);
                        return normalizeList(fallbackRecords);
                    } catch (error) {
                        console.warn('[SuitePractice] 读取practice_records失败:', error);
                    }
                }

                return [];
            };

            const existingRecords = await collectRecords();

            const isSuiteRecord = record => {
                if (!record) {
                    return false;
                }
                if (record.suiteMode === true) {
                    return true;
                }
                if (record.frequency === 'suite') {
                    return true;
                }
                if (record.metadata && record.metadata.frequency === 'suite') {
                    return true;
                }
                return false;
            };

            const resolveRecordDate = record => {
                const candidates = [
                    record.startTime,
                    record.metadata && record.metadata.startedAt,
                    record.date,
                    record.endTime,
                    record.metadata && record.metadata.completedAt
                ];

                for (const value of candidates) {
                    if (!value) {
                        continue;
                    }
                    const parsed = new Date(value);
                    if (!Number.isNaN(parsed.getTime())) {
                        return parsed;
                    }
                }

                return null;
            };

            let count = 0;
            for (const record of existingRecords) {
                if (!isSuiteRecord(record)) {
                    continue;
                }

                const recordDate = resolveRecordDate(record);
                if (!recordDate) {
                    continue;
                }

                if (
                    recordDate.getFullYear() === targetYear
                    && recordDate.getMonth() === targetMonth
                    && recordDate.getDate() === targetDate
                ) {
                    count += 1;
                }
            }

            return count + 1;
        },

        async _savePartialSuiteAsIndividual(session) {
            if (!session || !session.results || !session.results.length) {
                return;
            }

            for (const entry of session.results) {
                try {
                    await this.saveRealPracticeData(entry.examId, entry.rawData, { forceIndividualSave: true });
                    this.updateExamStatus && this.updateExamStatus(entry.examId, 'completed');
                } catch (error) {
                    console.error('[SuitePractice] 保存单篇记录失败:', error);
                }
            }

            await this._updatePracticeRecordsState();
            this.refreshOverviewData && this.refreshOverviewData();
        },

        _focusSuiteWindow(targetWindow) {
            if (!targetWindow || targetWindow.closed) {
                return;
            }

            try {
                if (typeof targetWindow.focus === 'function') {
                    targetWindow.focus();
                }
            } catch (_) {}
        },

        _safelyCloseWindow(targetWindow) {
            if (!targetWindow) {
                return;
            }

            if (typeof window !== 'undefined' && targetWindow === window) {
                return;
            }

            if (targetWindow.closed) {
                return;
            }

            try {
                targetWindow.close();
            } catch (error) {
                console.warn('[SuitePractice] 关闭套题窗口被拦截:', error);
            }
        },

        async _teardownSuiteSession(session) {
            if (!session) {
                return;
            }

            this._clearSuiteHandshakes();

            if (session.windowRef && !session.windowRef.closed && typeof session.windowRef.postMessage === 'function') {
                try {
                    session.windowRef.postMessage({
                        type: 'SUITE_FORCE_CLOSE',
                        data: {
                            suiteSessionId: session.id || null
                        }
                    }, '*');
                } catch (forceCloseError) {
                    console.warn('[SuitePractice] 无法通知套题窗口关闭:', forceCloseError);
                }
            }

            this._releaseSuiteWindowGuard(session.windowRef);
            this._safelyCloseWindow(session.windowRef);

            if (session.sequence && session.sequence.length) {
                const cleanupTasks = session.sequence.map(item => this.cleanupExamSession ? this.cleanupExamSession(item.examId) : Promise.resolve());
                await Promise.allSettled(cleanupTasks);
            }

            if (this.suiteExamMap) {
                session.sequence && session.sequence.forEach(item => this.suiteExamMap.delete(item.examId));
            }

            if (this.currentSuiteSession && this.currentSuiteSession.id === session.id) {
                this.currentSuiteSession = null;
            }

            session.windowRef = null;
            if (typeof this._clearSuiteHandshakes === 'function') {
                this._clearSuiteHandshakes();
            }
        },

        async _abortSuiteSession(session, options = {}) {
            if (!session) {
                return;
            }

            session.status = 'aborted';

            this._clearSuiteHandshakes();

            const skipExamId = options.skipExamId;
            if (session.results && session.results.length) {
                for (const entry of session.results) {
                    if (skipExamId && entry.examId === skipExamId) {
                        continue;
                    }
                    try {
                        await this.saveRealPracticeData(entry.examId, entry.rawData, { forceIndividualSave: true });
                        this.updateExamStatus && this.updateExamStatus(entry.examId, 'completed');
                    } catch (error) {
                        console.error('[SuitePractice] 套题中断时保存记录失败:', error);
                    }
                }
                await this._updatePracticeRecordsState();
                this.refreshOverviewData && this.refreshOverviewData();
            }

            await this._teardownSuiteSession(session);
        },

        _openNamedSuiteWindow(windowName, session = null) {
            const normalizedName = typeof windowName === 'string' && windowName.trim()
                ? windowName.trim()
                : 'ielts-suite-mode-tab';

            let reopened = null;
            try {
                reopened = window.open('about:blank', normalizedName);
            } catch (error) {
                console.warn('[SuitePractice] 无法重建套题标签:', error);
                reopened = null;
            }

            if (!reopened) {
                return null;
            }

            try {
                if (typeof reopened.focus === 'function') {
                    reopened.focus();
                }
            } catch (_) {}

            if (session) {
                this._ensureSuiteWindowGuard(session, reopened);
            }

            return reopened;
        },

        _reacquireSuiteWindow(windowName, session = null) {
            return this._openNamedSuiteWindow(windowName, session);
        },

        _ensureSuiteWindowGuard(session, targetWindow) {
            if (!session || !targetWindow || targetWindow.closed) {
                return;
            }

            if (isFileProtocol) {
                return;
            }

            try {
                const existingGuard = targetWindow.__IELTS_SUITE_PARENT_GUARD__;
                if (existingGuard && existingGuard.sessionId === session.id) {
                    return;
                }

                const guardInfo = {
                    sessionId: session.id,
                    installedAt: Date.now(),
                    nativeClose: typeof targetWindow.close === 'function'
                        ? targetWindow.close.bind(targetWindow)
                        : null,
                    nativeOpen: typeof targetWindow.open === 'function'
                        ? targetWindow.open.bind(targetWindow)
                        : null,
                    windowName: typeof targetWindow.name === 'string'
                        ? targetWindow.name.trim().toLowerCase()
                        : ''
                };

                const recordAttempt = (reason) => {
                    this._recordSuiteCloseAttempt(session, reason);
                };

                const isSelfTarget = (rawTarget) => {
                    if (rawTarget == null) {
                        return true;
                    }

                    const normalized = typeof rawTarget === 'string'
                        ? rawTarget.trim().toLowerCase()
                        : String(rawTarget).trim().toLowerCase();

                    if (!normalized) {
                        return true;
                    }

                    if (normalized === guardInfo.windowName && normalized) {
                        return true;
                    }

                    if (['_self', 'self', '_parent', 'parent', '_top', 'top', 'window', 'this'].includes(normalized)) {
                        return true;
                    }

                    return false;
                };

                const guardedClose = () => {
                    recordAttempt('script_request');
                    return undefined;
                };

                try { targetWindow.close = guardedClose; } catch (_) {}
                try {
                    if (targetWindow.self && targetWindow.self !== targetWindow) {
                        targetWindow.self.close = guardedClose;
                    }
                } catch (_) {}

                try {
                    if (targetWindow.top && targetWindow.top !== targetWindow) {
                        targetWindow.top.close = guardedClose;
                    }
                } catch (_) {}

                if (guardInfo.nativeOpen) {
                    const nativeOpen = guardInfo.nativeOpen;
                    targetWindow.open = (url = '', target = '', features = '') => {
                        if (isSelfTarget(target)) {
                            recordAttempt('self_target_open');
                            return targetWindow;
                        }
                        return nativeOpen(url, target, features);
                    };
                }

                targetWindow.__IELTS_SUITE_PARENT_GUARD__ = guardInfo;
            } catch (error) {
                console.warn('[SuitePractice] 安装套题窗口防护失败:', error);
            }
        },

        _releaseSuiteWindowGuard(targetWindow) {
            if (!targetWindow) {
                return;
            }

            let guardInfo = null;
            try {
                guardInfo = targetWindow.__IELTS_SUITE_PARENT_GUARD__;
            } catch (error) {
                const message = String(error && error.message ? error.message : error);
                if (!message || !message.toLowerCase().includes('cross-origin')) {
                    console.warn('[SuitePractice] 无法访问套题窗口守护信息:', error);
                } else {
                    console.debug('[SuitePractice] 套题窗口已跨域，跳过守护释放。');
                }
                guardInfo = null;
            }

            if (!guardInfo) {
                return;
            }

            try {
                if (guardInfo.nativeClose) {
                    targetWindow.close = guardInfo.nativeClose;
                } else {
                    delete targetWindow.close;
                }
            } catch (_) {}

            try {
                if (guardInfo.nativeOpen) {
                    targetWindow.open = guardInfo.nativeOpen;
                } else {
                    delete targetWindow.open;
                }
            } catch (_) {}

            try {
                delete targetWindow.__IELTS_SUITE_PARENT_GUARD__;
            } catch (_) {
                try {
                    targetWindow.__IELTS_SUITE_PARENT_GUARD__ = null;
                } catch (_) {}
            }
        },

        _recordSuiteCloseAttempt(session, reason) {
            if (!session) {
                return;
            }

            if (!Array.isArray(session.closeAttempts)) {
                session.closeAttempts = [];
            }

            session.closeAttempts.push({
                reason: reason || 'unknown',
                timestamp: Date.now()
            });
        },

        _clearSuiteHandshakes() {
            if (this._suiteHandshakeWaiters && typeof this._suiteHandshakeWaiters.clear === 'function') {
                try {
                    this._suiteHandshakeWaiters.clear();
                } catch (_) {}
            }
        },

        /**
         * 获取或创建多套题会话
         * @param {string} examId - 考试ID（基础ID，不含套题后缀）
         * @returns {object} 多套题会话对象
         */
        getOrCreateMultiSuiteSession(examId) {
            if (!this.multiSuiteSessionsMap) {
                this.multiSuiteSessionsMap = new Map();
            }

            // 提取基础examId（移除可能的套题后缀如 _set1, _suite1 等）
            const baseExamId = this._extractBaseExamId(examId);

            if (this.multiSuiteSessionsMap.has(baseExamId)) {
                return this.multiSuiteSessionsMap.get(baseExamId);
            }

            // 创建新的多套题会话
            const session = {
                id: this._generateMultiSuiteSessionId(baseExamId),
                baseExamId: baseExamId,
                status: 'active',
                startTime: Date.now(),
                suiteResults: [],
                expectedSuiteCount: null, // 将在第一次提交时确定
                metadata: {
                    source: this._detectMultiSuiteSource(baseExamId),
                    createdAt: new Date().toISOString()
                }
            };

            this.multiSuiteSessionsMap.set(baseExamId, session);
            console.log('[MultiSuite] 创建新会话:', session.id, '基础ID:', baseExamId);

            return session;
        },

        /**
         * 检查多套题是否全部完成
         * @param {object} session - 多套题会话对象
         * @returns {boolean} 是否所有套题都已完成
         */
        isMultiSuiteComplete(session) {
            if (!session || !Array.isArray(session.suiteResults)) {
                return false;
            }

            // 如果还没有确定预期套题数量，则未完成
            if (!session.expectedSuiteCount || session.expectedSuiteCount <= 0) {
                return false;
            }

            // 检查已完成的套题数量是否达到预期
            const completedCount = session.suiteResults.length;
            const isComplete = completedCount >= session.expectedSuiteCount;

            if (isComplete) {
                console.log('[MultiSuite] 会话完成:', session.id, 
                    `已完成 ${completedCount}/${session.expectedSuiteCount} 套题`);
            }

            return isComplete;
        },

        /**
         * 提取基础examId（移除套题后缀）
         * @param {string} examId - 完整的examId
         * @returns {string} 基础examId
         */
        _extractBaseExamId(examId) {
            if (!examId || typeof examId !== 'string') {
                return examId;
            }

            // 移除常见的套题后缀模式：_set1, _suite1, _s1, ::set1 等
            const patterns = [
                /_set\d+$/i,
                /_suite\d+$/i,
                /_s\d+$/i,
                /::set\d+$/i,
                /::suite\d+$/i,
                /-set\d+$/i,
                /-suite\d+$/i
            ];

            let baseId = examId;
            for (const pattern of patterns) {
                baseId = baseId.replace(pattern, '');
            }

            return baseId;
        },

        /**
         * 生成多套题会话ID
         * @param {string} baseExamId - 基础examId
         * @returns {string} 会话ID
         */
        _generateMultiSuiteSessionId(baseExamId) {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(16).slice(2, 8);
            const prefix = baseExamId ? `${baseExamId}_` : '';
            return `multi_${prefix}${timestamp}_${random}`;
        },

        /**
         * 检测多套题来源（P1/P4等）
         * @param {string} examId - 考试ID
         * @returns {string} 来源标识
         */
        _detectMultiSuiteSource(examId) {
            if (!examId || typeof examId !== 'string') {
                return 'unknown';
            }

            const lowerExamId = examId.toLowerCase();

            if (lowerExamId.includes('p1') || lowerExamId.includes('part1')) {
                return 'p1';
            }
            if (lowerExamId.includes('p4') || lowerExamId.includes('part4')) {
                return 'p4';
            }
            if (lowerExamId.includes('p2') || lowerExamId.includes('part2')) {
                return 'p2';
            }
            if (lowerExamId.includes('p3') || lowerExamId.includes('part3')) {
                return 'p3';
            }

            return 'listening';
        }
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.suitePractice = mixin;
})(typeof window !== 'undefined' ? window : globalThis);
