(function(global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;

    const mixin = {
        initializeSuiteMode() {
            if (this._suiteModeReady) {
                return;
            }

            this._suiteModeReady = true;
            this.currentSuiteSession = null;
            this.suiteExamMap = new Map();
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
                    aggregatedAnswers[entry.examId] = entry.answers;
                    aggregatedComparison[entry.examId] = entry.answerComparison;
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
            if (this.components && this.components.practiceRecorder && typeof this.components.practiceRecorder.savePracticeRecord === 'function') {
                await this.components.practiceRecorder.savePracticeRecord(record);
                return;
            }

            let practiceRecords = await storage.get('practice_records', []);
            if (!Array.isArray(practiceRecords)) {
                practiceRecords = [];
            }

            practiceRecords.unshift(record);
            if (practiceRecords.length > MAX_LEGACY_PRACTICE_RECORDS) {
                practiceRecords.splice(MAX_LEGACY_PRACTICE_RECORDS);
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
                    await this.saveRealPracticeData(entry.examId, entry.rawData);
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
        }
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.suitePractice = mixin;
})(typeof window !== 'undefined' ? window : globalThis);
