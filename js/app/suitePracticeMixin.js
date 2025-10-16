(function(global) {
    const mixin = {
        initializeSuiteMode() {
            if (this._suiteModeReady) {
                return;
            }

            this._suiteModeReady = true;
            this.currentSuiteSession = null;
            this.suiteExamMap = new Map();
        },

        async startSuitePractice() {
            try {
                if (!this._suiteModeReady) {
                    this.initializeSuiteMode();
                }

                if (this.currentSuiteSession && this.currentSuiteSession.status === 'active') {
                    window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                    return;
                }

                const examIndex = await this._fetchSuiteExamIndex();
                if (!examIndex.length) {
                    window.showMessage && window.showMessage('题库为空，无法开启套题练习。', 'warning');
                    return;
                }

                const categories = ['P1', 'P2', 'P3'];
                const sequence = [];
                for (const category of categories) {
                    const pool = examIndex.filter(item => item && item.category === category);
                    if (!pool.length) {
                        window.showMessage && window.showMessage(`题库缺少 ${category} 分类题目，无法开启套题练习。`, 'warning');
                        return;
                    }
                    const picked = pool[Math.floor(Math.random() * pool.length)];
                    sequence.push({ examId: picked.id, exam: picked });
                }

                const suiteSessionId = this._generateSuiteSessionId();
                const session = {
                    id: suiteSessionId,
                    status: 'active',
                    startTime: Date.now(),
                    sequence,
                    currentIndex: 0,
                    results: [],
                    windowRef: null
                };

                this.currentSuiteSession = session;
                this._registerSuiteSequence(session);

                const firstExamId = sequence[0].examId;
                window.showMessage && window.showMessage('套题练习已启动，正在打开第一篇。', 'info');

                const examWindow = await this.openExam(firstExamId, {
                    target: 'tab',
                    suiteSessionId,
                    reuseWindow: null
                });

                if (!examWindow) {
                    throw new Error('first_exam_window_unavailable');
                }

                session.windowRef = examWindow || null;
                session.activeExamId = firstExamId;
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                if (this.currentSuiteSession) {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            }
        },

        async handleSuitePracticeComplete(examId, data) {
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

            const hasNext = session.currentIndex < session.sequence.length;
            if (!hasNext) {
                await this.finalizeSuiteRecord(session);
                return true;
            }

            const nextEntry = session.sequence[session.currentIndex];
            session.activeExamId = nextEntry.examId;
            const reuseWindow = session.windowRef && !session.windowRef.closed ? session.windowRef : null;

            try {
                const nextWindow = await this.openExam(nextEntry.examId, {
                    target: 'tab',
                    reuseWindow,
                    suiteSessionId: session.id
                });

                if (!nextWindow) {
                    throw new Error('next_exam_window_unavailable');
                }

                session.windowRef = nextWindow || null;
                window.showMessage && window.showMessage(`已完成 ${sequenceEntry.exam.title}，继续下一篇 ${nextEntry.exam.title}。`, 'success');
                return true;
            } catch (error) {
                console.error('[SuitePractice] 打开下一篇失败:', error);
                window.showMessage && window.showMessage('无法继续套题练习，系统将恢复为普通模式。', 'warning');
                await this._abortSuiteSession(session, { reason: 'open_next_failed', skipExamId: examId });
                return false;
            }
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
                    answerComparison: entry.answerComparison
                }));

                const totalDuration = session.results.reduce((sum, entry) => sum + entry.duration, 0);
                const totalCorrect = session.results.reduce((sum, entry) => sum + entry.scoreInfo.correct, 0);
                const totalQuestions = session.results.reduce((sum, entry) => sum + entry.scoreInfo.total, 0);
                const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) : 0;
                const percentage = Math.round(accuracy * 100);

                const aggregatedAnswers = {};
                const aggregatedComparison = {};
                session.results.forEach(entry => {
                    aggregatedAnswers[entry.examId] = entry.answers;
                    aggregatedComparison[entry.examId] = entry.answerComparison;
                });

                const startTimeIso = new Date(session.startTime || completionTime).toISOString();
                const endTimeIso = new Date(completionTime).toISOString();
                const timeLabel = this._formatSuiteTimeLabel(completionTime);

                const record = {
                    id: session.id,
                    examId: `suite-${session.id}`,
                    title: `${timeLabel} 套题练习`,
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
                        examTitle: `${timeLabel} 套题练习`,
                        category: '套题练习',
                        frequency: 'suite',
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

        _normalizeSuiteResult(exam, rawData) {
            const score = rawData && rawData.scoreInfo ? rawData.scoreInfo : {};
            const answers = rawData && rawData.answers ? rawData.answers : {};
            const comparison = rawData && rawData.answerComparison
                ? rawData.answerComparison
                : (score && score.details ? score.details : {});

            const correct = Number.isFinite(score.correct) ? Number(score.correct) : 0;
            const total = Number.isFinite(score.total) ? Number(score.total) : Object.keys(answers).length;
            const accuracy = Number.isFinite(score.accuracy) ? score.accuracy : (total > 0 ? correct / total : 0);
            const percentage = Number.isFinite(score.percentage)
                ? Math.round(score.percentage)
                : Math.round(accuracy * 100);
            const duration = Number.isFinite(rawData?.duration) ? Number(rawData.duration) : 0;

            return {
                examId: exam.id,
                title: exam.title,
                category: exam.category,
                duration,
                scoreInfo: {
                    correct,
                    total,
                    accuracy,
                    percentage
                },
                answers,
                answerComparison: comparison,
                rawData: rawData || {}
            };
        },

        async _saveSuitePracticeRecord(record) {
            if (this.components && this.components.practiceRecorder && typeof this.components.practiceRecorder.savePracticeRecord === 'function') {
                await this.components.practiceRecorder.savePracticeRecord(record);
                return;
            }

            let practiceRecords = await storage.get('practice_records', []);
            if (!Array.isArray(practiceRecords)) {
                practiceRecords = [];
            }

            practiceRecords.unshift(record);
            if (practiceRecords.length > 100) {
                practiceRecords.splice(100);
            }

            await storage.set('practice_records', practiceRecords);
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

        _formatSuiteTimeLabel(timestamp) {
            const date = new Date(timestamp);
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        },

        async _savePartialSuiteAsIndividual(session) {
            if (!session || !session.results || !session.results.length) {
                return;
            }

            for (const entry of session.results) {
                try {
                    await this.saveRealPracticeData(entry.examId, entry.rawData);
                    this.updateExamStatus && this.updateExamStatus(entry.examId, 'completed');
                } catch (error) {
                    console.error('[SuitePractice] 保存单篇记录失败:', error);
                }
            }

            await this._updatePracticeRecordsState();
            this.refreshOverviewData && this.refreshOverviewData();
        },

        async _teardownSuiteSession(session) {
            if (!session) {
                return;
            }

            if (session.windowRef && (typeof window === 'undefined' || session.windowRef !== window) && !session.windowRef.closed) {
                try {
                    session.windowRef.close();
                } catch (error) {
                    console.warn('[SuitePractice] 关闭套题窗口被拦截:', error);
                }
            }

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
        },

        async _abortSuiteSession(session, options = {}) {
            if (!session) {
                return;
            }

            session.status = 'aborted';

            const skipExamId = options.skipExamId;
            if (session.results && session.results.length) {
                for (const entry of session.results) {
                    if (skipExamId && entry.examId === skipExamId) {
                        continue;
                    }
                    try {
                        await this.saveRealPracticeData(entry.examId, entry.rawData);
                        this.updateExamStatus && this.updateExamStatus(entry.examId, 'completed');
                    } catch (error) {
                        console.error('[SuitePractice] 套题中断时保存记录失败:', error);
                    }
                }
                await this._updatePracticeRecordsState();
                this.refreshOverviewData && this.refreshOverviewData();
            }

            await this._teardownSuiteSession(session);
        }
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.suitePractice = mixin;
})(typeof window !== 'undefined' ? window : globalThis);
