(function(global) {
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');

    function getSuitePreferenceUtils() {
        return global.SuitePreferenceUtils || null;
    }

    function resolveSuitePreferenceForMixin(options = {}) {
        const suitePreferenceUtils = getSuitePreferenceUtils();
        if (suitePreferenceUtils && typeof suitePreferenceUtils.resolveSuitePreference === 'function') {
            return suitePreferenceUtils.ensurePracticeConfig().suite || {};
        }
        let flowMode = String(options && options.flowMode || '').trim().toLowerCase();
        if (!['classic', 'simulation', 'stationary'].includes(flowMode)) {
            flowMode = 'classic';
        }
        let frequencyScope = String(options && options.frequencyScope || '').trim().toLowerCase();
        if (!['high', 'high_medium', 'all', 'custom'].includes(frequencyScope)) {
            frequencyScope = 'all';
        }
        return {
            flowMode,
            frequencyScope,
            autoAdvanceAfterSubmit: flowMode !== 'stationary'
        };
    }

    function isFrequencyInScope(frequency, scope) {
        const suitePreferenceUtils = getSuitePreferenceUtils();
        if (suitePreferenceUtils && typeof suitePreferenceUtils.isFrequencyIncluded === 'function') {
            return suitePreferenceUtils.isFrequencyIncluded(frequency, scope);
        }
        const normalizedScope = ['high', 'high_medium', 'custom'].includes(scope) ? scope : 'all';
        const normalizedFrequency = String(frequency == null ? '' : frequency).trim().toLowerCase();
        if (!normalizedFrequency) {
            return true;
        }
        if (normalizedScope === 'high') {
            return ['high', '高频', 'ultra-high', '超高频', 'high frequency'].includes(normalizedFrequency);
        }
        if (normalizedScope === 'high_medium') {
            return ['high', 'medium', 'mid', '高频', '次高频', '中频', 'ultra-high', 'very-high', 'high frequency', 'medium frequency'].includes(normalizedFrequency);
        }
        return true;
    }

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

            const restored = this._restoreSessionFromStorage();
            if (restored) {
                this.currentSuiteSession = restored;
                this._registerSuiteSequence(restored);
                this._suiteResumeNoticeShown = false;
                this._notifySuiteResumeAvailable(restored);
            }
        },

        async startSuitePractice(options = {}) {
            const suiteWindowName = 'ielts-suite-mode-tab';

            try {
                if (!this._suiteModeReady) {
                    this.initializeSuiteMode();
                }
                const suitePreference = this._resolveSuitePreference(options);
                const flowMode = suitePreference.flowMode;
                const frequencyScope = suitePreference.frequencyScope;

                if (this.currentSuiteSession && ['active', 'initializing', 'finalizing'].includes(this.currentSuiteSession.status)) {
                    if (this.currentSuiteSession.status === 'finalizing') {
                        return this.resumeSuitePractice();
                    }
                    const activeWindow = this.currentSuiteSession.windowRef;
                    if (!activeWindow || activeWindow.closed || this.currentSuiteSession._restoredFromStorage === true) {
                        return this.resumeSuitePractice();
                    }
                    window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                    return false;
                }

                if (frequencyScope === 'custom') {
                    const enteredCustomMode = await this._startCustomSuiteSelection({
                        flowMode,
                        frequencyScope,
                        suiteWindowName
                    });
                    if (!enteredCustomMode && typeof global.loadExamList === 'function') {
                        try {
                            global.loadExamList();
                        } catch (_) {}
                    }
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

                const frequencyFilteredIndex = normalizedIndex.filter(item => (
                    this._isSuiteFrequencyIncluded(item && item.frequency, frequencyScope)
                ));
                const practicedExamIds = await this._collectPracticedReadingExamIds();

                const categories = ['P1', 'P2', 'P3'];
                const sequence = [];
                for (const category of categories) {
                    const pool = frequencyFilteredIndex.filter(item => item.category === category);
                    if (!pool.length) {
                        const scopeLabel = frequencyScope === 'high'
                            ? '仅高频'
                            : (frequencyScope === 'high_medium' ? '高频+次高频' : '全部频率');
                        window.showMessage && window.showMessage('当前抽题范围（' + scopeLabel + '）缺少 ' + category + ' 阅读题目，无法开启套题练习。', 'warning');
                        return;
                    }
                    const unpracticedPool = pool.filter(item => !practicedExamIds.has(String(item.id)));
                    const selectionPool = unpracticedPool.length ? unpracticedPool : pool;
                    if (!unpracticedPool.length) {
                        const scopeLabel = frequencyScope === 'high'
                            ? '仅高频'
                            : (frequencyScope === 'high_medium' ? '高频+次高频' : '全部频率');
                        window.showMessage && window.showMessage(
                            '当前抽题范围（' + scopeLabel + '）中的 ' + category + ' 已全部练习过，已自动放宽为允许重复抽题。',
                            'warning'
                        );
                    }
                    const picked = selectionPool[Math.floor(Math.random() * selectionPool.length)];
                    sequence.push({ examId: picked.id, exam: picked });
                }

                const started = await this._launchSuiteSessionFromSequence(sequence, {
                    flowMode,
                    frequencyScope,
                    suiteWindowName,
                    launchLabel: flowMode === 'stationary'
                        ? '驻足模式'
                        : (flowMode === 'simulation' ? '模拟模式' : '经典模式')
                });
                if (!started && this.currentSuiteSession && this.currentSuiteSession.status !== 'initializing') {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                if (this.currentSuiteSession && this.currentSuiteSession.status === 'initializing') {
                    this.currentSuiteSession.windowRef = null;
                    this.currentSuiteSession._restoredFromStorage = true;
                    this.currentSuiteSession.lastUpdate = Date.now();
                    this._mirrorSessionToStorage(this.currentSuiteSession);
                    window.showMessage && window.showMessage('首篇窗口未能打开，套题恢复快照已保留，可稍后重试。', 'warning');
                } else if (this.currentSuiteSession) {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            }
        },
        async handleSuitePracticeComplete(examId, data, sourceWindow = null) {
            const withSubmitOutcome = (handled, committed = handled, errorCode = '', extra = null) => (
                data && data.submissionId
                    ? Object.assign({
                        handled: Boolean(handled),
                        committed: Boolean(committed),
                        errorCode: errorCode || null
                    }, extra || {})
                    : Boolean(handled)
            );
            // First check whether this is multi-suite mode (detected via suiteId).
            if (data && data.suiteId) {
                const committed = await this.handleMultiSuitePracticeComplete(examId, data);
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed');
            }
            if (data && data.suiteSubmission === true && typeof this._handleInlineSimulationSuiteSubmit === 'function') {
                return await this._handleInlineSimulationSuiteSubmit(examId, data, sourceWindow);
            }

            const session = this.currentSuiteSession;
            if (!session) {
                return false;
            }

            const payloadSuiteSessionId = (data && typeof data.suiteSessionId === 'string')
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }
            if (session.status === 'finalizing') {
                session._finalizeSubmissionId = data && data.submissionId
                    ? String(data.submissionId)
                    : (session._finalizeSubmissionId || null);
                const committed = await this._finalizeSuiteRecordWithGate(session, {
                    deferTeardown: Boolean(
                        session._finalizeSubmissionId
                        && sourceWindow
                        && !sourceWindow.closed
                    )
                });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', data && data.submissionId ? {
                    teardownSession: committed ? session : null
                } : null);
            }
            if (session.status === 'completed') {
                return withSubmitOutcome(true, true, '', data && data.submissionId ? {
                    teardownSession: session
                } : null);
            }
            if (session.status !== 'active') {
                return withSubmitOutcome(true, false, 'suite_finalizing');
            }

            const mappingMissing = !this.suiteExamMap || !this.suiteExamMap.has(examId);
            if (mappingMissing && typeof this._registerSuiteSequence === 'function') {
                this._registerSuiteSequence(session);
            }

            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            const inActiveSequence = Array.isArray(session.sequence)
                ? session.sequence.some(item => item && item.examId === examId)
                : false;
            if ((mappedSessionId && mappedSessionId !== session.id) || (!mappedSessionId && !inActiveSequence)) {
                return false;
            }

            const sequenceEntry = session.sequence.find(item => item.examId === examId);
            if (!sequenceEntry) {
                await this._abortSuiteSession(session, { reason: 'missing_sequence' });
                return false;
            }

            const activeExamId = session.activeExamId ? String(session.activeExamId) : '';
            if (activeExamId && activeExamId !== String(examId)) {
                console.warn('[SuitePractice] 忽略非当前活动篇章的提交，防止错篇结算。', {
                    activeExamId,
                    submittedExamId: examId,
                    sessionId: session.id
                });
                return withSubmitOutcome(true, false, 'inactive_suite_exam');
            }

            const derivedDuration = this._deriveSuiteExamElapsedSeconds(session, examId, data && data.duration);
            const normalized = this._normalizeSuiteResult(sequenceEntry.exam, Object.assign({}, data, {
                duration: derivedDuration
            }));
            this._upsertSuiteResult(session, examId, normalized);
            this._syncSuiteTimerFromPayload(session, data);
            session.lastUpdate = Date.now();
            this.updateExamStatus && this.updateExamStatus(examId, 'completed');

            this._persistSuiteDraftSnapshot(session, examId, data);
            if (Number.isFinite(Number(data && data.duration))) {
                session.elapsedByExam[examId] = derivedDuration;
            }

            const currentIndex = session.sequence.findIndex(item => item.examId === examId);
            if (currentIndex < 0) {
                await this._abortSuiteSession(session, { reason: 'missing_sequence_index' });
                return false;
            }
            const shouldAutoAdvance = this._shouldAutoAdvanceAfterSubmit();
            if (!shouldAutoAdvance) {
                session.currentIndex = currentIndex;
                session.activeExamId = examId;
                session.pendingAdvance = {
                    completedExamId: examId,
                    finalReview: currentIndex >= session.sequence.length - 1,
                    updatedAt: Date.now()
                };
                this._mirrorSessionToStorage(session);
                const replayWindow = sourceWindow && !sourceWindow.closed
                    ? sourceWindow
                    : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
                if (replayWindow) {
                    await this._sendSuiteReviewState(session, examId, replayWindow);
                }
                return withSubmitOutcome(true, true);
            }

            session.currentIndex = currentIndex + 1;
            session.pendingAdvance = null;
            this._mirrorSessionToStorage(session);

            // Last passage -> finalize the entire simulation
            if (session.currentIndex >= session.sequence.length) {
                const deferTeardown = Boolean(data && data.submissionId && sourceWindow && !sourceWindow.closed);
                session._finalizeSubmissionId = data && data.submissionId ? String(data.submissionId) : null;
                const committed = await this._finalizeSuiteRecordWithGate(session, { deferTeardown });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', deferTeardown ? {
                    teardownSession: session
                } : null);
            }

            // Not last -> advance to next passage
            if (typeof this.cleanupExamSession === 'function') {
                try {
                    await this.cleanupExamSession(examId);
                } catch (cleanupError) {
                    console.warn('[SuitePractice] 清理上一篇会话失败:', cleanupError);
                }
            }

            const advanced = await this._advanceSuiteToNext(session, sequenceEntry.exam.title, examId);
            return withSubmitOutcome(advanced, advanced, advanced ? '' : 'suite_advance_failed');
        },

        async continueSuitePractice() {
            // Legacy stub - simulation mode auto-advances, but kept for backward compat
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') {
                return false;
            }
            if (!(session.currentIndex < session.sequence.length)) {
                return false;
            }
            return this._advanceSuiteToNext(session, 'previous section', null);
        },

        async resumeSuitePractice() {
            const session = this.currentSuiteSession;
            if (!session || !['active', 'initializing', 'finalizing'].includes(session.status)) {
                return false;
            }
            if (session._resumePromise && typeof session._resumePromise.then === 'function') {
                return session._resumePromise;
            }

            const resumePromise = (async () => {
                const sequence = Array.isArray(session.sequence) ? session.sequence : [];
                if (!sequence.length) {
                    this._discardStoredSuiteSession(session);
                    return false;
                }

                // A terminal snapshot is deliberately never clamped back to P3. The
                // aggregate record and operation id are replayed until v2 confirms it.
                if (session.status === 'finalizing' || session.currentIndex >= sequence.length) {
                    session.status = 'finalizing';
                    session.currentIndex = sequence.length;
                    session.activeExamId = null;
                    this._mirrorSessionToStorage(session);
                    return this._finalizeSuiteRecordWithGate(session, { fromRecovery: true });
                }
                if (typeof this.openExam !== 'function') return false;

                let currentExamIndex = null;
                if (session._restoredFromStorage === true && typeof this._fetchSuiteExamIndex === 'function') {
                    try {
                        currentExamIndex = await this._fetchSuiteExamIndex();
                    } catch (validationError) {
                        console.warn('[SuitePractice] 无法验证恢复目标，保留快照供稍后重试:', validationError);
                        window.showMessage && window.showMessage('暂时无法读取当前题库，未完成套题仍会保留。', 'warning');
                        return false;
                    }
                    if (Array.isArray(currentExamIndex)) {
                        const byId = new Map(currentExamIndex.map((entry) => {
                            const id = entry && (entry.id ?? entry.examId);
                            return id == null ? null : [String(id), entry];
                        }).filter(Boolean));
                        const targetId = String(sequence[session.currentIndex].examId);
                        const missingSequenceEntry = sequence.some((entry) => !byId.has(String(entry.examId)));
                        if (missingSequenceEntry || !byId.has(targetId)) {
                            this._discardStoredSuiteSession(session);
                            window.showMessage && window.showMessage('未完成套题与当前题库不一致，恢复数据已清除。', 'warning');
                            return false;
                        }
                        session.sequence = sequence.map((entry) => {
                            const indexed = byId.get(String(entry.examId));
                            return indexed
                                ? { ...entry, exam: indexed, title: entry.title || indexed.title, category: entry.category || indexed.category }
                                : entry;
                        });
                    }
                }

                const targetEntry = session.sequence[session.currentIndex];
                if (!targetEntry || !targetEntry.examId) return false;
                session.status = 'active';
                session.activeExamId = targetEntry.examId;
                session.windowRef = null;
                session.lastUpdate = Date.now();
                this._mirrorSessionToStorage(session);

                let examWindow = null;
                try {
                    examWindow = await this.openExam(targetEntry.examId, {
                        target: 'tab',
                        examDefinition: targetEntry.exam,
                        windowName: session.windowName || 'ielts-suite-mode-tab',
                        suiteSessionId: session.id,
                        suiteFlowMode: session.flowMode || 'simulation',
                        suiteTimerMode: session.suiteTimerMode || 'countdown',
                        suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds))
                            ? Number(session.suiteTimerLimitSeconds)
                            : 3600,
                        sequenceIndex: session.currentIndex,
                        sequenceTotal: session.sequence.length
                    });
                } catch (error) {
                    console.warn('[SuitePractice] 恢复套题窗口失败:', error);
                }
                if (!examWindow || examWindow.closed) {
                    session.windowRef = null;
                    session._restoredFromStorage = true;
                    this._mirrorSessionToStorage(session);
                    window.showMessage && window.showMessage('未能打开未完成套题，请检查弹窗权限后再次点击套题模式。', 'warning');
                    return false;
                }

                session.windowRef = examWindow;
                session._restoredFromStorage = false;
                this._ensureSuiteWindowGuard(session, examWindow);
                this._focusSuiteWindow(examWindow);
                this._mirrorSessionToStorage(session);
                if (session.flowMode === 'simulation') {
                    this._sendSimulationContext(session, targetEntry.examId, examWindow);
                } else if (session.pendingAdvance || (session.results || []).some((entry) => entry && entry.examId === targetEntry.examId)) {
                    await this._sendSuiteReviewState(session, targetEntry.examId, examWindow).catch((error) => {
                        console.warn('[SuitePractice] 恢复套题回看状态失败:', error);
                    });
                }
                window.showMessage && window.showMessage(`已恢复未完成套题：${targetEntry.exam?.title || targetEntry.examId}`, 'success');
                return true;
            })();
            session._resumePromise = resumePromise;
            try {
                return await resumePromise;
            } finally {
                if (session._resumePromise === resumePromise) delete session._resumePromise;
            }
        },

        async _handleInlineSimulationSuiteSubmit(examId, data, sourceWindow = null) {
            const withSubmitOutcome = (handled, committed = handled, errorCode = '', extra = null) => (
                data && data.submissionId
                    ? Object.assign({
                        handled: Boolean(handled),
                        committed: Boolean(committed),
                        errorCode: errorCode || null
                    }, extra || {})
                    : Boolean(handled)
            );
            const session = this.currentSuiteSession;
            if (!session || session.flowMode !== 'simulation') {
                return false;
            }
            const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }
            if (session.status === 'finalizing') {
                session._finalizeSubmissionId = data && data.submissionId
                    ? String(data.submissionId)
                    : (session._finalizeSubmissionId || null);
                const committed = await this._finalizeSuiteRecordWithGate(session, {
                    deferTeardown: Boolean(
                        session._finalizeSubmissionId
                        && sourceWindow
                        && !sourceWindow.closed
                    )
                });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', session._finalizeSubmissionId ? {
                    teardownSession: committed ? session : null
                } : null);
            }
            if (session.status === 'completed') {
                return withSubmitOutcome(true, true, '', data && data.submissionId ? {
                    teardownSession: session
                } : null);
            }
            if (session.status !== 'active') {
                return false;
            }
            const suiteEntries = Array.isArray(data && data.suiteEntries) ? data.suiteEntries : [];
            if (!suiteEntries.length) {
                return withSubmitOutcome(true, false, 'suite_entries_missing');
            }
            const entriesByExam = new Map();
            suiteEntries.forEach((entry) => {
                const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
                if (entryExamId) {
                    entriesByExam.set(entryExamId, entry);
                }
            });
            if (!entriesByExam.size) {
                return withSubmitOutcome(true, false, 'suite_entries_missing');
            }
            const hasEverySequenceEntry = Array.isArray(session.sequence)
                && session.sequence.length > 0
                && session.sequence.every((sequenceEntry) => {
                    const entryExamId = sequenceEntry && sequenceEntry.examId != null ? String(sequenceEntry.examId) : '';
                    return entryExamId && entriesByExam.has(entryExamId);
                });
            if (!hasEverySequenceEntry) {
                console.warn('[SuitePractice] inline simulation suite submit missing sequence entries:', {
                    sessionId: session.id,
                    expected: session.sequence.map(item => item && item.examId).filter(Boolean),
                    received: Array.from(entriesByExam.keys())
                });
                return withSubmitOutcome(true, false, 'suite_entries_incomplete');
            }

            session.results = [];
            session.sequence.forEach((sequenceEntry) => {
                if (!sequenceEntry || !sequenceEntry.examId) {
                    return;
                }
                const entryExamId = String(sequenceEntry.examId);
                const entryPayload = entriesByExam.get(entryExamId);
                if (!entryPayload) {
                    return;
                }
                const normalized = this._normalizeSuiteResult(sequenceEntry.exam, Object.assign({}, entryPayload, {
                    duration: Number.isFinite(Number(entryPayload.duration))
                        ? Number(entryPayload.duration)
                        : Number(data.duration || 0)
                }));
                this._upsertSuiteResult(session, entryExamId, normalized);
                this._persistSuiteDraftSnapshot(session, entryExamId, {
                    draft: {
                        answers: entryPayload.answers || {},
                        highlights: Array.isArray(entryPayload.highlights) ? entryPayload.highlights.slice() : [],
                        noteText: typeof entryPayload.noteText === 'string' ? entryPayload.noteText : '',
                        notes: Array.isArray(entryPayload.notes) ? entryPayload.notes.slice() : [],
                        noteOutlines: Array.isArray(entryPayload.noteOutlines) ? entryPayload.noteOutlines.slice() : [],
                        scrollY: Number.isFinite(Number(entryPayload.scrollY)) ? Number(entryPayload.scrollY) : 0,
                        markedQuestions: Array.isArray(entryPayload.markedQuestions) ? entryPayload.markedQuestions.slice() : []
                    },
                    draftUpdatedAt: Number.isFinite(Number(entryPayload.updatedAt))
                        ? Number(entryPayload.updatedAt)
                        : Date.now()
                });
                const entryDuration = Number(entryPayload.duration);
                if (Number.isFinite(entryDuration)) {
                    session.elapsedByExam[entryExamId] = Math.max(0, entryDuration);
                }
                this.updateExamStatus && this.updateExamStatus(entryExamId, 'completed');
            });

            this._syncSuiteTimerFromPayload(session, data);
            session.currentIndex = session.sequence.length;
            session.pendingAdvance = null;
            session.activeExamId = examId || session.sequence[session.sequence.length - 1]?.examId || session.activeExamId;
            session.lastUpdate = Date.now();
            if (sourceWindow && !sourceWindow.closed) {
                session.windowRef = sourceWindow;
            }
            this._mirrorSessionToStorage(session);
            const deferTeardown = Boolean(data && data.submissionId && sourceWindow && !sourceWindow.closed);
            session._finalizeSubmissionId = data && data.submissionId ? String(data.submissionId) : null;
            const committed = await this._finalizeSuiteRecordWithGate(session, { deferTeardown });
            return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', deferTeardown ? {
                teardownSession: session
            } : null);
        },

        _resolveSuitePreference(options = {}) {
            return resolveSuitePreferenceForMixin(options);
        },

        _resolveSuiteFlowMode(options = {}) {
            return this._resolveSuitePreference(options).flowMode;
        },

        _resolveSuiteFrequencyScope(options = {}) {
            return this._resolveSuitePreference(options).frequencyScope;
        },

        _isSuiteFrequencyIncluded(frequency, scope) {
            return isFrequencyInScope(frequency, scope);
        },

        _readSuiteAutoAdvancePreference() {
            return this._resolveSuitePreference().autoAdvanceAfterSubmit !== false;
        },

        _shouldAutoAdvanceAfterSubmit() {
            const activeSession = this.currentSuiteSession;
            if (activeSession && typeof activeSession.autoAdvanceAfterSubmit === 'boolean') {
                return activeSession.autoAdvanceAfterSubmit;
            }
            return this._readSuiteAutoAdvancePreference();
        },

        _hasMeaningfulSuiteAnswer(value) {
            if (Array.isArray(value)) {
                return value.some(item => this._hasMeaningfulSuiteAnswer(item));
            }
            if (value == null) {
                return false;
            }
            return String(value).trim() !== '';
        },

        _resolveSuiteEntryDraft(session, examId) {
            if (!session || !session.draftsByExam || !examId) {
                return null;
            }
            const draft = session.draftsByExam[examId];
            return draft && typeof draft === 'object' ? draft : null;
        },

        _hasSuiteDraftPayload(data = {}) {
            if (!data || typeof data !== 'object') {
                return false;
            }
            if (data.draft && typeof data.draft === 'object' && !Array.isArray(data.draft)) {
                return true;
            }
            return ['answers', 'highlights', 'noteText', 'notes', 'noteOutlines', 'scrollY', 'markedQuestions', 'draftUpdatedAt'].some((key) => (
                Object.prototype.hasOwnProperty.call(data, key)
            ));
        },

        _cloneSuiteDraftPlainObject(source) {
            if (!source || typeof source !== 'object' || Array.isArray(source)) {
                return {};
            }
            const SourceConstructor = typeof source.constructor === 'function'
                ? source.constructor
                : Object;
            try {
                return Object.assign(new SourceConstructor(), source);
            } catch (_) {
                return Object.assign({}, source);
            }
        },

        _buildSuiteDraftSnapshot(data = {}) {
            const draftSource = data && data.draft && typeof data.draft === 'object' && !Array.isArray(data.draft)
                ? data.draft
                : {};
            const answerSource = draftSource.answers && typeof draftSource.answers === 'object' && !Array.isArray(draftSource.answers)
                ? draftSource.answers
                : (data && data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : {});
            const highlightSource = Array.isArray(draftSource.highlights)
                ? draftSource.highlights
                : (Array.isArray(data && data.highlights) ? data.highlights : []);
            const noteTextSource = typeof draftSource.noteText === 'string'
                ? draftSource.noteText
                : (data && typeof data.noteText === 'string' ? data.noteText : '');
            const notesSource = Array.isArray(draftSource.notes)
                ? draftSource.notes
                : (Array.isArray(data && data.notes) ? data.notes : []);
            const noteOutlinesSource = Array.isArray(draftSource.noteOutlines)
                ? draftSource.noteOutlines
                : (Array.isArray(data && data.noteOutlines) ? data.noteOutlines : []);
            const scrollSource = Number.isFinite(Number(draftSource.scrollY))
                ? Number(draftSource.scrollY)
                : (Number.isFinite(Number(data && data.scrollY)) ? Number(data.scrollY) : 0);
            const markedQuestionsSource = Array.isArray(draftSource.markedQuestions)
                ? draftSource.markedQuestions
                : (Array.isArray(data && data.markedQuestions) ? data.markedQuestions : []);
            const updatedAt = Number(
                data && (data.draftUpdatedAt ?? draftSource.updatedAt ?? data.updatedAt)
            );
            return {
                answers: this._cloneSuiteDraftPlainObject(answerSource),
                highlights: highlightSource.slice(),
                noteText: noteTextSource,
                notes: this._cloneSuitePlainObject(notesSource),
                noteOutlines: this._cloneSuitePlainObject(noteOutlinesSource),
                scrollY: scrollSource,
                markedQuestions: markedQuestionsSource.slice(),
                updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
            };
        },

        _persistSuiteDraftSnapshot(session, examId, data = {}) {
            if (!session || !examId || !this._hasSuiteDraftPayload(data)) {
                return false;
            }
            if (!session.draftsByExam || typeof session.draftsByExam !== 'object') {
                session.draftsByExam = {};
            }
            const normalizedExamId = String(examId).trim();
            if (!normalizedExamId) {
                return false;
            }
            const nextDraft = this._buildSuiteDraftSnapshot(data);
            const previousDraft = session.draftsByExam[normalizedExamId] || null;
            const previousUpdatedAt = Number(previousDraft && previousDraft.updatedAt);
            const nextUpdatedAt = Number(nextDraft.updatedAt);
            const suppliedUpdatedAt = Number(data && (data.draftUpdatedAt
                ?? (data.draft && data.draft.updatedAt)
                ?? data.updatedAt));
            if (previousDraft && !Number.isFinite(suppliedUpdatedAt)) {
                return false;
            }
            if (
                previousDraft
                && Number.isFinite(previousUpdatedAt)
                && Number.isFinite(nextUpdatedAt)
                && nextUpdatedAt <= previousUpdatedAt
            ) {
                return false;
            }
            nextDraft.updatedAt = Number.isFinite(suppliedUpdatedAt) ? suppliedUpdatedAt : nextDraft.updatedAt;
            session.draftsByExam[normalizedExamId] = nextDraft;
            session.draftRevision = Math.max(0, Number(session.draftRevision) || 0) + 1;
            const previousUpdate = Number(session.lastUpdate);
            session.lastUpdate = Math.max(
                Number.isFinite(previousUpdate) ? previousUpdate : 0,
                Number.isFinite(suppliedUpdatedAt) ? suppliedUpdatedAt : Date.now(),
                Date.now()
            );
            return true;
        },

        _handleSuiteDraftSync(examId, data = {}, windowInfo = null, sourceWindow = null) {
            const session = this.currentSuiteSession;
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            const registeredWindowInfo = !this.examWindows
                || (typeof this.examWindows.values === 'function'
                    ? Array.from(this.examWindows.values()).includes(windowInfo)
                    : Object.values(this.examWindows).includes(windowInfo));
            const payloadSuiteId = data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
            const expectedSuiteId = windowInfo && windowInfo.suiteSessionId != null
                ? String(windowInfo.suiteSessionId).trim()
                : '';
            const incomingUpdatedAt = Number(data && (data.draftUpdatedAt
                ?? (data.draft && data.draft.updatedAt)
                ?? data.updatedAt));
            if (
                !session
                || !['active', 'initializing'].includes(session.status)
                || !normalizedExamId
                || !payloadSuiteId
                || payloadSuiteId !== String(session.id)
                || (expectedSuiteId && expectedSuiteId !== String(session.id))
                || !windowInfo
                || (this.examWindows && !registeredWindowInfo)
                || !windowInfo.window
                || windowInfo.window.closed
                || (sourceWindow && sourceWindow !== windowInfo.window)
                || (session.windowRef && session.windowRef.closed)
                || (session.flowMode !== 'simulation' && session.windowRef && session.windowRef !== windowInfo.window)
                || (session.flowMode !== 'simulation' && !session.windowRef && session.status !== 'initializing')
                || !Number.isFinite(incomingUpdatedAt)
                || incomingUpdatedAt <= 0
                || !Array.isArray(session.sequence)
                || !session.sequence.some((entry) => entry && String(entry.examId) === normalizedExamId)
                || !data.draft
                || typeof data.draft !== 'object'
            ) {
                return false;
            }
            if (!this._persistSuiteDraftSnapshot(session, normalizedExamId, data)) {
                return false;
            }
            if (Number.isFinite(Number(data.elapsed))) {
                session.elapsedByExam[normalizedExamId] = typeof this._deriveSuiteExamElapsedSeconds === 'function'
                    ? this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, Number(data.elapsed))
                    : Math.max(0, Number(data.elapsed));
            }
            this._syncSuiteTimerFromPayload(session, data);
            session.windowRef = windowInfo.window;
            const indexedEntry = Number.isInteger(session.currentIndex)
                ? session.sequence[session.currentIndex]
                : null;
            if (indexedEntry && String(indexedEntry.examId) === normalizedExamId) {
                session.activeExamId = normalizedExamId;
            }
            return this._mirrorSessionToStorage(session);
        },

        _buildSuiteSequencePayload(session) {
            const sequence = session && Array.isArray(session.sequence) ? session.sequence : [];
            return sequence
                .map((entry) => {
                    if (!entry || !entry.examId) {
                        return null;
                    }
                    const exam = entry.exam && typeof entry.exam === 'object' ? entry.exam : {};
                    let dataKey = entry.dataKey || exam.dataKey || '';
                    if (!dataKey && typeof this._getUnifiedReadingManifestEntry === 'function') {
                        const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
                        dataKey = manifestEntry && (manifestEntry.dataKey || manifestEntry.examId) || '';
                    }
                    return {
                        examId: String(entry.examId),
                        dataKey: dataKey ? String(dataKey) : String(entry.examId),
                        title: entry.title || exam.title || String(entry.examId),
                        category: entry.category || exam.category || ''
                    };
                })
                .filter(Boolean);
        },

        _cloneSuitePlainObject(value) {
            if (!value || typeof value !== 'object') {
                return value;
            }
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (_) {
                return Array.isArray(value) ? value.slice() : { ...value };
            }
        },

        _suiteComparableValue(value) {
            if (Array.isArray(value)) {
                return value.map((item) => this._suiteComparableValue(item));
            }
            if (value && typeof value === 'object') {
                return Object.keys(value).sort().reduce((result, key) => {
                    result[key] = this._suiteComparableValue(value[key]);
                    return result;
                }, {});
            }
            return value;
        },

        _suiteValuesEqual(left, right) {
            try {
                return JSON.stringify(this._suiteComparableValue(left))
                    === JSON.stringify(this._suiteComparableValue(right));
            } catch (_) {
                return false;
            }
        },

        _sanitizeSuiteRawData(rawData) {
            const cloned = this._cloneSuitePlainObject(rawData || {});
            if (!cloned || typeof cloned !== 'object') {
                return {};
            }
            delete cloned.highlights;
            delete cloned.scrollY;
            delete cloned.noteText;
            delete cloned.notes;
            delete cloned.noteOutlines;
            return cloned;
        },

        _buildSuiteEntryIndividualPayload(session, entry) {
            const rawData = this._sanitizeSuiteRawData(entry && entry.rawData);
            const draft = this._resolveSuiteEntryDraft(session, entry && entry.examId);
            const highlights = this._resolveSuiteEntryHighlights(entry, draft);
            if (highlights.length > 0) {
                rawData.highlights = highlights;
            }
            const scrollY = this._resolveSuiteEntryScrollY(entry, draft);
            if (Number.isFinite(Number(scrollY))) {
                rawData.scrollY = Number(scrollY);
            }
            const noteText = this._resolveSuiteEntryNoteText(entry, draft);
            if (noteText) {
                rawData.noteText = noteText;
            }
            const notes = this._resolveSuiteEntryNotes(entry, draft);
            if (notes.length > 0) {
                rawData.notes = notes;
            }
            const noteOutlines = this._resolveSuiteEntryNoteOutlines(entry, draft);
            if (noteOutlines.length > 0) {
                rawData.noteOutlines = noteOutlines;
            }
            return rawData;
        },

        _resolveSuiteEntryHighlights(entry, draft = null) {
            const sources = [
                draft && draft.highlights,
                entry && entry.highlights,
                entry && entry.rawData && entry.rawData.highlights
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已清空高亮），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 highlights: []
            // 被跳过而回落到旧 entry.rawData.highlights，复活已删除的高亮。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return source.slice();
                }
            }
            return [];
        },

        _resolveSuiteEntryScrollY(entry, draft = null) {
            if (draft && Array.isArray(draft.highlights) && draft.highlights.length > 0) {
                const normalized = Number(draft.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            if (entry && Array.isArray(entry.highlights) && entry.highlights.length > 0) {
                const normalized = Number(entry.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            if (entry && entry.rawData && Array.isArray(entry.rawData.highlights) && entry.rawData.highlights.length > 0) {
                const normalized = Number(entry.rawData.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            const sources = [
                draft && draft.scrollY,
                entry && entry.scrollY,
                entry && entry.rawData && entry.rawData.scrollY
            ];
            for (const source of sources) {
                const normalized = Number(source);
                if (Number.isFinite(normalized)) {
                    return normalized;
                }
            }
            return 0;
        },

        _resolveSuiteEntryNoteText(entry, draft = null) {
            const sources = [
                draft && draft.noteText,
                entry && entry.noteText,
                entry && entry.rawData && entry.rawData.noteText
            ];
            for (const source of sources) {
                if (typeof source === 'string' && source.trim()) {
                    return source;
                }
            }
            return '';
        },

        _resolveSuiteEntryNotes(entry, draft = null) {
            const sources = [
                draft && draft.notes,
                entry && entry.notes,
                entry && entry.rawData && entry.rawData.notes
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已删除最后一条结构笔记），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 notes: []
            // 被跳过而回落到旧 entry.rawData.notes，复活已删除的笔记。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return this._cloneSuitePlainObject(source);
                }
            }
            return [];
        },

        _resolveSuiteEntryNoteOutlines(entry, draft = null) {
            const sources = [
                draft && draft.noteOutlines,
                entry && entry.noteOutlines,
                entry && entry.rawData && entry.rawData.noteOutlines
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已删除最后一条笔记大纲），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 noteOutlines: []
            // 被跳过而回落到旧 entry.rawData.noteOutlines，复活已删除的大纲。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return this._cloneSuitePlainObject(source);
                }
            }
            return [];
        },

        _buildSuiteReplayEntry(session, examId) {
            if (!session || !Array.isArray(session.results)) {
                return null;
            }
            const result = session.results.find(item => item && item.examId === examId) || null;
            const draft = this._resolveSuiteEntryDraft(session, examId);
            const sequenceEntry = Array.isArray(session.sequence)
                ? session.sequence.find(item => item && item.examId === examId)
                : null;
            if (!result && !draft) {
                return null;
            }

            const answerComparison = result && result.answerComparison && typeof result.answerComparison === 'object'
                ? result.answerComparison
                : {};
            const answers = result && result.answers && typeof result.answers === 'object'
                ? result.answers
                : {};

            const filteredComparison = {};
            const filteredAnswers = {};

            Object.keys(answerComparison).forEach((questionId) => {
                const comparisonEntry = answerComparison[questionId];
                if (!comparisonEntry || typeof comparisonEntry !== 'object') {
                    return;
                }
                const userAnswer = Object.prototype.hasOwnProperty.call(comparisonEntry, 'userAnswer')
                    ? comparisonEntry.userAnswer
                    : answers[questionId];
                if (!this._hasMeaningfulSuiteAnswer(userAnswer)) {
                    return;
                }
                filteredComparison[questionId] = comparisonEntry;
                filteredAnswers[questionId] = userAnswer;
            });

            Object.keys(answers).forEach((questionId) => {
                if (Object.prototype.hasOwnProperty.call(filteredAnswers, questionId)) {
                    return;
                }
                const value = answers[questionId];
                if (!this._hasMeaningfulSuiteAnswer(value)) {
                    return;
                }
                filteredAnswers[questionId] = value;
            });

            if (draft && draft.answers && typeof draft.answers === 'object') {
                Object.keys(draft.answers).forEach((questionId) => {
                    if (Object.prototype.hasOwnProperty.call(filteredAnswers, questionId)) {
                        return;
                    }
                    const value = draft.answers[questionId];
                    if (!this._hasMeaningfulSuiteAnswer(value)) {
                        return;
                    }
                    filteredAnswers[questionId] = value;
                });
            }

            const highlights = this._resolveSuiteEntryHighlights(result, draft);
            const noteText = this._resolveSuiteEntryNoteText(result, draft);
            const notes = this._resolveSuiteEntryNotes(result, draft);
            const noteOutlines = this._resolveSuiteEntryNoteOutlines(result, draft);
            const scrollY = this._resolveSuiteEntryScrollY(result, draft);
            const markedQuestions = result && Array.isArray(result.markedQuestions)
                ? result.markedQuestions.slice()
                : (draft && Array.isArray(draft.markedQuestions) ? draft.markedQuestions.slice() : []);
            const hasReplayData = Boolean(
                Object.keys(filteredAnswers).length
                || Object.keys(filteredComparison).length
                || markedQuestions.length
                || highlights.length
                || noteText
                || notes.length
                || noteOutlines.length
                || (Number.isFinite(Number(scrollY)) && Number(scrollY) > 0)
            );
            if (!hasReplayData) {
                return null;
            }
            return {
                examId: (result && result.examId) || examId,
                title: (result && result.title) || (sequenceEntry && sequenceEntry.exam && sequenceEntry.exam.title) || examId,
                answers: filteredAnswers,
                answerComparison: filteredComparison,
                scoreInfo: (result && result.scoreInfo) || {},
                markedQuestions,
                highlights,
                noteText,
                notes,
                noteOutlines,
                scrollY
            };
        },

        _buildSuiteReviewContext(session, examId) {
            if (!session || !Array.isArray(session.sequence) || !session.sequence.length) {
                return null;
            }
            const sequenceIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (sequenceIndex < 0) {
                return null;
            }
            const sequenceEntry = session.sequence[sequenceIndex] || {};
            const hasResult = Array.isArray(session.results) && session.results.some(item => item && item.examId === examId);
            const viewMode = hasResult ? 'review' : 'answering';
            const isLast = sequenceIndex === session.sequence.length - 1;
            const pendingAdvance = session.pendingAdvance && typeof session.pendingAdvance === 'object'
                ? session.pendingAdvance
                : null;
            const allowFinalizeFromNav = Boolean(
                viewMode === 'review'
                && isLast
                && pendingAdvance
                && pendingAdvance.completedExamId === examId
                && pendingAdvance.finalReview === true
            );
            return {
                reviewSessionId: null,
                suiteSessionId: session.id,
                suiteReviewMode: true,
                showNav: true,
                viewMode,
                index: sequenceIndex + 1,
                currentIndex: sequenceIndex,
                total: session.sequence.length,
                canPrev: sequenceIndex > 0,
                canNext: viewMode === 'review' && (sequenceIndex < session.sequence.length - 1 || allowFinalizeFromNav),
                finalizeOnNext: allowFinalizeFromNav,
                title: (sequenceEntry.exam && sequenceEntry.exam.title) || sequenceEntry.examId || '',
                examId: examId,
                readOnly: viewMode === 'review'
            };
        },

        async _sendSuiteReviewState(session, examId, targetWindow = null) {
            if (!session || !examId) {
                return false;
            }
            const contextPayload = this._buildSuiteReviewContext(session, examId);
            if (!contextPayload) {
                return false;
            }
            const replayEntry = this._buildSuiteReplayEntry(session, examId);
            const resolvedWindow = targetWindow && !targetWindow.closed
                ? targetWindow
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            if (!resolvedWindow || resolvedWindow.closed) {
                return false;
            }
            try {
                if (replayEntry) {
                    this._postExamMessage(examId, resolvedWindow, 'REPLAY_PRACTICE_RECORD', {
                        suiteSessionId: session.id,
                        reviewEntryIndex: contextPayload.currentIndex,
                        readOnly: contextPayload.readOnly !== false,
                        markedQuestions: Array.isArray(replayEntry.markedQuestions) ? replayEntry.markedQuestions : [],
                        entry: replayEntry
                    });
                }
                this._postExamMessage(examId, resolvedWindow, 'REVIEW_CONTEXT', contextPayload);
                return true;
            } catch (error) {
                console.warn('[SuitePractice] 发送套题回看上下文失败:', error);
                return false;
            }
        },

        async _waitForSuiteWindowExamReady(session, examId, targetWindow = null, timeoutMs = 2500) {
            if (!session || !examId || !targetWindow || targetWindow.closed) {
                return false;
            }
            const expectedExamId = String(examId);
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
                if (targetWindow.closed) {
                    return false;
                }
                const windowExamId = this._readSuiteWindowExamId(targetWindow);
                if (windowExamId && windowExamId !== expectedExamId) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    continue;
                }
                const windowInfo = this.examWindows && this.examWindows.get(expectedExamId)
                    ? this.examWindows.get(expectedExamId)
                    : null;
                const readyMatches = Boolean(
                    windowInfo
                    && windowInfo.window
                    && !windowInfo.window.closed
                    && windowInfo.window === targetWindow
                    && windowInfo.lastMessageType === 'SESSION_READY'
                    && Number(windowInfo.lastMessageAt) >= startedAt
                    && (!windowInfo.suiteSessionId || windowInfo.suiteSessionId === session.id)
                    && (!windowInfo.windowSessionToken || !windowInfo.lastWindowSessionToken || windowInfo.windowSessionToken === windowInfo.lastWindowSessionToken)
                    && (!windowInfo.pageType || /unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(String(windowInfo.pageType)))
                );
                if (readyMatches) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return false;
        },

        _readSuiteWindowExamId(targetWindow = null) {
            try {
                if (!targetWindow || targetWindow.closed || !targetWindow.location) {
                    return '';
                }
                const href = typeof targetWindow.location.href === 'string' ? targetWindow.location.href : '';
                if (!href || href === 'about:blank') {
                    return '';
                }
                const parsed = new URL(href, (global && global.location && global.location.href) ? global.location.href : undefined);
                return String(parsed.searchParams.get('examId') || '').trim();
            } catch (_) {
                return '';
            }
        },

        _canFallbackSendSuiteContext(examId, targetWindow = null) {
            const expectedExamId = examId != null ? String(examId).trim() : '';
            if (!expectedExamId || !targetWindow || targetWindow.closed) {
                return false;
            }
            const windowExamId = this._readSuiteWindowExamId(targetWindow);
            if (!windowExamId || windowExamId !== expectedExamId) {
                return false;
            }
            const windowInfo = this.examWindows && this.examWindows.get(expectedExamId)
                ? this.examWindows.get(expectedExamId)
                : null;
            if (windowInfo && windowInfo.window && !windowInfo.window.closed && windowInfo.window !== targetWindow) {
                return false;
            }
            const pageType = windowInfo && typeof windowInfo.pageType === 'string'
                ? windowInfo.pageType.toLowerCase()
                : '';
            if (pageType && !/unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(pageType)) {
                return false;
            }
            return true;
        },

        async _maybeRestoreSuiteReviewState(examId, targetWindow = null, windowInfo = null) {
            if (!examId || this._shouldAutoAdvanceAfterSubmit()) {
                return false;
            }
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active' || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }

            const resolvedWindowInfo = (windowInfo && typeof windowInfo === 'object')
                ? windowInfo
                : (this.examWindows && this.examWindows.get(examId));
            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            const targetSessionId = resolvedWindowInfo && typeof resolvedWindowInfo.suiteSessionId === 'string'
                ? resolvedWindowInfo.suiteSessionId
                : '';
            if ((mappedSessionId && mappedSessionId !== session.id) || (targetSessionId && targetSessionId !== session.id)) {
                return false;
            }
            const inActiveSequence = session.sequence.some(item => item && item.examId === examId);
            if (!inActiveSequence) {
                return false;
            }

            const resolvedWindow = targetWindow && !targetWindow.closed
                ? targetWindow
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            if (!resolvedWindow || resolvedWindow.closed) {
                return false;
            }

            session.activeExamId = examId;
            const sessionIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (sessionIndex >= 0) {
                session.currentIndex = sessionIndex;
                this._mirrorSessionToStorage(session);
            }
            return this._sendSuiteReviewState(session, examId, resolvedWindow);
        },

        async handleSuiteReviewNavigate(examId, data = {}, sourceWindow = null) {
            if (this._shouldAutoAdvanceAfterSubmit()) {
                return false;
            }
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active' || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }

            const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }

            const currentIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (currentIndex < 0) {
                return false;
            }
            session.currentIndex = currentIndex;
            session.activeExamId = examId;
            this._persistSuiteDraftSnapshot(session, examId, data);
            if (Number.isFinite(Number(data && data.elapsed))) {
                session.elapsedByExam[examId] = this._deriveSuiteExamElapsedSeconds(session, examId, Number(data.elapsed));
            }
            this._syncSuiteTimerFromPayload(session, data);
            this._mirrorSessionToStorage(session);

            const direction = String(data.direction || '').trim().toLowerCase();
            let targetIndex = currentIndex;
            if (direction === 'next') {
                targetIndex += 1;
            } else if (direction === 'prev' || direction === 'previous') {
                targetIndex -= 1;
            } else {
                return false;
            }

            const hasCurrentResult = Array.isArray(session.results)
                ? session.results.some(item => item && item.examId === examId)
                : false;
            if (direction === 'next' && !hasCurrentResult) {
                return false;
            }
            const requestedFinalizeOnNext = Boolean(
                direction === 'next'
                && currentIndex === session.sequence.length - 1
                && data
                && data.finalizeOnNext === true
                && hasCurrentResult
            );
            if (requestedFinalizeOnNext) {
                session.pendingAdvance = null;
                await this._finalizeSuiteRecordWithGate(session);
                return true;
            }

            if (targetIndex < 0 || targetIndex >= session.sequence.length) {
                const canFinalize = Boolean(
                    direction === 'next'
                    && currentIndex === session.sequence.length - 1
                    && session.pendingAdvance
                    && session.pendingAdvance.completedExamId === examId
                    && session.pendingAdvance.finalReview === true
                );
                if (canFinalize) {
                    session.pendingAdvance = null;
                    await this._finalizeSuiteRecordWithGate(session);
                    return true;
                }
                return true;
            }

            const targetEntry = session.sequence[targetIndex];
            if (!targetEntry || !targetEntry.examId) {
                return false;
            }

            let targetWindow = sourceWindow && !sourceWindow.closed ? sourceWindow : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);

            const isCrossExamNavigation = targetEntry.examId !== examId;
            if (isCrossExamNavigation && typeof this.cleanupExamSession === 'function') {
                try {
                    await this.cleanupExamSession(examId);
                } catch (cleanupError) {
                    console.warn('[SuitePractice] review 跨篇切换清理旧会话失败:', cleanupError);
                }
            }
            if (isCrossExamNavigation || !targetWindow) {
                targetWindow = await this.openExam(targetEntry.examId, {
                    examDefinition: targetEntry.exam,
                    target: 'tab',
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: targetIndex,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: targetWindow || undefined
                });
            }

            if (!targetWindow || targetWindow.closed) {
                return false;
            }

            session.windowRef = targetWindow;
            session.currentIndex = targetIndex;
            session.activeExamId = targetEntry.examId;
            session.lastUpdate = Date.now();
            this._mirrorSessionToStorage(session);
            this._focusSuiteWindow(targetWindow);
            if (isCrossExamNavigation) {
                const ready = await this._waitForSuiteWindowExamReady(session, targetEntry.examId, targetWindow);
                if (!ready) {
                    if (!this._canFallbackSendSuiteContext(targetEntry.examId, targetWindow)) {
                        console.warn('[SuitePractice] 套题切换等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                        return true;
                    }
                    console.warn('[SuitePractice] 套题切换未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                }
            }
            if (session.flowMode === 'simulation') {
                session._contextSentExamId = targetEntry.examId;
                session._contextSentAt = Date.now();
                this._sendSimulationContext(session, targetEntry.examId, targetWindow);
            } else {
                await this._sendSuiteReviewState(session, targetEntry.examId, targetWindow);
            }
            return true;
        },

        async _advanceSuiteToNext(session, completedTitle, skipExamIdForAbort) {
            if (typeof this.openExam !== 'function') {
                window.showMessage && window.showMessage('无法继续套题练习，已回退到普通模式。', 'warning');
                await this._abortSuiteSession(session, { reason: 'missing_open_exam', skipExamId: skipExamIdForAbort || null });
                return false;
            }

            const nextEntry = session.sequence[session.currentIndex];
            if (!nextEntry || !nextEntry.examId) {
                await this._abortSuiteSession(session, { reason: 'missing_next_entry', skipExamId: skipExamIdForAbort || null });
                return false;
            }

            session.activeExamId = nextEntry.examId;
            const windowName = session.windowName || 'ielts-suite-mode-tab';
            const reuseWindow = session.windowRef && !session.windowRef.closed ? session.windowRef : null;
            let openError = null;

            const attemptOpen = async (candidateWindow = null) => {
                const options = {
                    target: 'tab',
                    windowName,
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: session.currentIndex,
                    sequenceTotal: session.sequence.length
                };

                if (candidateWindow && !candidateWindow.closed) {
                    options.reuseWindow = candidateWindow;
                }

                try {
                    const opened = await this.openExam(nextEntry.examId, {
                        ...options,
                        examDefinition: nextEntry.exam
                    });
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
                window.showMessage && window.showMessage('无法继续套题练习，已回退到普通模式。', 'warning');
                await this._abortSuiteSession(session, { reason: 'open_next_failed', skipExamId: skipExamIdForAbort || null });
                return false;
            }

            session.windowRef = nextWindow;
            this._ensureSuiteWindowGuard(session, session.windowRef);
            this._focusSuiteWindow(session.windowRef);
            this._mirrorSessionToStorage(session);
            const reusedNextWindow = Boolean(reuseWindow && nextWindow === reuseWindow);
            if (reusedNextWindow) {
                const ready = await this._waitForSuiteWindowExamReady(session, nextEntry.examId, session.windowRef);
                if (!ready) {
                    if (!this._canFallbackSendSuiteContext(nextEntry.examId, session.windowRef)) {
                        window.showMessage && window.showMessage('已完成' + (completedTitle || '上一篇') + '，正在继续：' + nextEntry.exam.title + '。', 'success');
                        console.warn('[SuitePractice] 自动切题等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                        return true;
                    }
                    console.warn('[SuitePractice] 自动切题未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                }
            }
            session._contextSentExamId = nextEntry.examId;
            session._contextSentAt = Date.now();
            this._sendSimulationContext(session, nextEntry.examId, session.windowRef);
            window.showMessage && window.showMessage('已完成' + (completedTitle || '上一篇') + '，正在继续：' + nextEntry.exam.title + '。', 'success');
            return true;
        },

        _mirrorSessionToStorage(session) {
            if (!session || !global.AppData?.recovery?.windowSession) return false;
            try {
                const now = Date.now();
                const previousUpdate = Number(session.lastUpdate);
                session.lastUpdate = Number.isFinite(previousUpdate)
                    ? Math.max(now, previousUpdate + 1)
                    : now;
                session.revision = Math.max(0, Number(session.revision) || 0) + 1;
                const snapshot = {
                    schema: 'suite-session-v2',
                    version: 2,
                    id: session.id,
                    status: session.status || 'active',
                    sequence: this._cloneSuitePlainObject(session.sequence || []),
                    suiteSequence: this._buildSuiteSequencePayload(session),
                    currentIndex: Number.isInteger(session.currentIndex) ? session.currentIndex : 0,
                    draftsByExam: this._cloneSuitePlainObject(session.draftsByExam || {}),
                    elapsedByExam: this._cloneSuitePlainObject(session.elapsedByExam || {}),
                    globalTimerAnchorMs: Number(session.globalTimerAnchorMs) || Number(session.startTime) || now,
                    suiteTimerAnchorMs: Number(session.suiteTimerAnchorMs) || Number(session.globalTimerAnchorMs) || Number(session.startTime) || now,
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds))
                        ? Number(session.suiteTimerLimitSeconds)
                        : 3600,
                    suiteTimerPausedOffsetMs: Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0),
                    suiteTimerPausedAtMs: Number.isFinite(Number(session.suiteTimerPausedAtMs)) ? Number(session.suiteTimerPausedAtMs) : null,
                    suiteTimerRunning: session.suiteTimerRunning !== false,
                    flowMode: session.flowMode || 'simulation',
                    frequencyScope: session.frequencyScope || 'all',
                    autoAdvanceAfterSubmit: typeof session.autoAdvanceAfterSubmit === 'boolean'
                        ? session.autoAdvanceAfterSubmit
                        : true,
                    results: (session.results || []).map(r => ({
                        examId: r.examId, title: r.title, category: r.category,
                        duration: r.duration, scoreInfo: r.scoreInfo,
                        answers: r.answers, answerComparison: r.answerComparison,
                        markedQuestions: Array.isArray(r.markedQuestions) ? r.markedQuestions.slice() : [],
                        rawData: this._sanitizeSuiteRawData(r.rawData)
                    })),
                    startTime: Number(session.startTime) || now,
                    activeExamId: session.activeExamId || null,
                    pendingAdvance: session.pendingAdvance && typeof session.pendingAdvance === 'object'
                        ? this._cloneSuitePlainObject(session.pendingAdvance)
                        : null,
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    lastUpdate: session.lastUpdate,
                    revision: session.revision,
                    draftRevision: Math.max(0, Number(session.draftRevision) || 0),
                    finalizeOperationId: session.finalizeOperationId || null,
                    finalizeRecord: session.finalizeRecord
                        ? this._cloneSuitePlainObject(session.finalizeRecord)
                        : null
                };
                return global.AppData.recovery.windowSession.save('simulation', snapshot) !== false;
            } catch (error) {
                console.warn('[SuitePractice] 套题恢复快照写入失败:', error);
                return false;
            }
        },

        _restoreSessionFromStorage() {
            try {
                const snapshot = global.AppData.recovery.windowSession.get('simulation');
                if (!snapshot || typeof snapshot !== 'object' || !snapshot.id) return null;
                if (snapshot.schema !== 'suite-session-v2' || Number(snapshot.version) !== 2) {
                    this._clearSessionStorage();
                    return null;
                }
                const statusValue = String(snapshot.status || 'active').trim().toLowerCase();
                if (!['initializing', 'active', 'finalizing'].includes(statusValue)) {
                    this._clearSessionStorage();
                    return null;
                }
                const rawSequence = Array.isArray(snapshot.sequence)
                    ? snapshot.sequence
                    : (Array.isArray(snapshot.suiteSequence) ? snapshot.suiteSequence : []);
                const sequence = rawSequence.map((entry) => {
                    if (!entry || typeof entry !== 'object') return null;
                    const exam = entry.exam && typeof entry.exam === 'object' ? entry.exam : entry;
                    const examId = String(entry.examId ?? exam.id ?? '').trim();
                    if (!examId) return null;
                    return {
                        ...this._cloneSuitePlainObject(entry),
                        examId,
                        exam: { ...this._cloneSuitePlainObject(exam), id: exam.id || examId }
                    };
                }).filter(Boolean);
                const sequenceIds = sequence.map((entry) => String(entry.examId));
                const flowMode = String(snapshot.flowMode || 'simulation').trim().toLowerCase();
                const timerMode = String(snapshot.suiteTimerMode || 'countdown').trim().toLowerCase();
                const timerLimit = Number(snapshot.suiteTimerLimitSeconds);
                if (
                    !sequence.length
                    || new Set(sequenceIds).size !== sequenceIds.length
                    || !['classic', 'simulation', 'stationary'].includes(flowMode)
                    || !['countdown', 'elapsed'].includes(timerMode)
                    || !Number.isFinite(timerLimit)
                    || timerLimit <= 0
                ) {
                    this._clearSessionStorage();
                    return null;
                }
                const rawIndex = Number(snapshot.currentIndex);
                if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex > sequence.length) {
                    this._clearSessionStorage();
                    return null;
                }
                const results = Array.isArray(snapshot.results)
                    ? this._cloneSuitePlainObject(snapshot.results)
                    : [];
                if (results.some((entry) => !this._isValidSuiteRecoveryResult(entry, sequenceIds))) {
                    this._clearSessionStorage();
                    return null;
                }
                const expectedOperationId = `practice-suite:${String(snapshot.id)}:finalize`;
                if (snapshot.finalizeOperationId && snapshot.finalizeOperationId !== expectedOperationId) {
                    this._clearSessionStorage();
                    return null;
                }
                if (snapshot.finalizeRecord) {
                    const finalizeRecord = snapshot.finalizeRecord;
                    if (!this._isValidSuiteFinalizeRecord({
                        id: snapshot.id,
                        sequence,
                        results
                    }, finalizeRecord)) {
                        this._clearSessionStorage();
                        return null;
                    }
                }
                const autoAdvance = snapshot.autoAdvanceAfterSubmit !== false;
                const activeId = snapshot.activeExamId != null ? String(snapshot.activeExamId).trim() : '';
                const activeIndex = activeId
                    ? sequence.findIndex((entry) => String(entry.examId) === activeId)
                    : -1;
                const resultIds = results
                    .map((entry) => entry && String(entry.examId || '').trim())
                    .filter(Boolean);
                const terminalSnapshot = statusValue === 'finalizing' || rawIndex === sequence.length;
                if (
                    new Set(resultIds).size !== resultIds.length
                    || resultIds.some((examId) => !sequenceIds.includes(examId))
                    || (terminalSnapshot && (
                        resultIds.length !== sequenceIds.length
                        || sequenceIds.some((examId) => !resultIds.includes(examId))
                    ))
                    || (statusValue !== 'finalizing' && activeId && activeIndex < 0)
                    || (terminalSnapshot && rawIndex !== sequence.length)
                ) {
                    this._clearSessionStorage();
                    return null;
                }
                if (
                    statusValue !== 'finalizing'
                    && activeIndex >= 0
                    && activeIndex !== rawIndex
                    && !(autoAdvance && rawIndex === activeIndex + 1 && results.some((entry) => entry && String(entry.examId) === activeId))
                ) {
                    this._clearSessionStorage();
                    return null;
                }
                let currentIndex = rawIndex;
                let status = statusValue;
                if (status === 'finalizing' || currentIndex === sequence.length) {
                    status = 'finalizing';
                    currentIndex = sequence.length;
                } else if (
                    autoAdvance
                    && activeIndex >= 0
                    && currentIndex === activeIndex
                    && results.some((entry) => entry && String(entry.examId) === activeId)
                    && currentIndex + 1 < sequence.length
                ) {
                    currentIndex += 1;
                }
                const activeExamId = status === 'finalizing'
                    ? null
                    : (sequence[currentIndex] && sequence[currentIndex].examId) || activeId || sequence[0].examId;
                const now = Date.now();
                return {
                    id: String(snapshot.id),
                    status,
                    startTime: Number(snapshot.startTime) || now,
                    sequence,
                    currentIndex,
                    results,
                    draftsByExam: snapshot.draftsByExam && typeof snapshot.draftsByExam === 'object'
                        ? this._cloneSuitePlainObject(snapshot.draftsByExam)
                        : {},
                    elapsedByExam: snapshot.elapsedByExam && typeof snapshot.elapsedByExam === 'object'
                        ? this._cloneSuitePlainObject(snapshot.elapsedByExam)
                        : {},
                    globalTimerAnchorMs: Number(snapshot.globalTimerAnchorMs) || Number(snapshot.startTime) || now,
                    suiteTimerAnchorMs: Number(snapshot.suiteTimerAnchorMs) || Number(snapshot.globalTimerAnchorMs) || Number(snapshot.startTime) || now,
                    suiteTimerMode: timerMode,
                    suiteTimerLimitSeconds: timerLimit,
                    suiteTimerPausedOffsetMs: Math.max(0, Number(snapshot.suiteTimerPausedOffsetMs) || 0),
                    suiteTimerPausedAtMs: Number.isFinite(Number(snapshot.suiteTimerPausedAtMs)) ? Number(snapshot.suiteTimerPausedAtMs) : null,
                    suiteTimerRunning: snapshot.suiteTimerRunning !== false,
                    flowMode,
                    frequencyScope: snapshot.frequencyScope || 'all',
                    autoAdvanceAfterSubmit: autoAdvance,
                    pendingAdvance: snapshot.pendingAdvance && typeof snapshot.pendingAdvance === 'object'
                        ? this._cloneSuitePlainObject(snapshot.pendingAdvance)
                        : null,
                    activeExamId,
                    windowRef: null,
                    windowName: snapshot.windowName || 'ielts-suite-mode-tab',
                    lastUpdate: Number.isFinite(Number(snapshot.lastUpdate)) ? Number(snapshot.lastUpdate) : now,
                    revision: Math.max(0, Number(snapshot.revision) || 0),
                    draftRevision: Math.max(0, Number(snapshot.draftRevision) || 0),
                    finalizeOperationId: snapshot.finalizeOperationId || (snapshot.finalizeRecord ? expectedOperationId : null),
                    finalizeRecord: snapshot.finalizeRecord && typeof snapshot.finalizeRecord === 'object'
                        ? this._cloneSuitePlainObject(snapshot.finalizeRecord)
                        : null,
                    _restoredFromStorage: true
                };
            } catch (error) {
                console.warn('[SuitePractice] 套题恢复快照读取失败:', error);
                this._clearSessionStorage();
                return null;
            }
        },

        _clearSessionStorage() {
            try {
                global.AppData.recovery.windowSession.discard('simulation');
            } catch (_) { /* ignore */ }
        },

        _discardStoredSuiteSession(session) {
            if (!session) return false;
            if (this.suiteExamMap && Array.isArray(session.sequence)) {
                session.sequence.forEach((entry) => {
                    if (entry && entry.examId != null) this.suiteExamMap.delete(String(entry.examId));
                });
            }
            if (this.currentSuiteSession === session) this.currentSuiteSession = null;
            this._clearSessionStorage();
            return true;
        },

        _notifySuiteResumeAvailable(session) {
            if (!session || this._suiteResumeNoticeShown) return;
            this._suiteResumeNoticeShown = true;
            const activeEntry = Array.isArray(session.sequence)
                ? session.sequence.find((entry) => entry && String(entry.examId) === String(session.activeExamId))
                : null;
            const title = activeEntry && activeEntry.exam && activeEntry.exam.title
                ? activeEntry.exam.title
                : (session.activeExamId || '当前篇章');
            window.showMessage && window.showMessage(`检测到未完成套题：${title}，再次点击“套题模式”即可继续。`, 'info');
        },

        _syncSuiteTimerFromPayload(session, data = {}) {
            if (!session || !data || typeof data !== 'object') return;
            const timerSnapshot = data.timerSnapshot && typeof data.timerSnapshot === 'object'
                ? data.timerSnapshot
                : null;
            const anchorMs = Number(
                (timerSnapshot && (timerSnapshot.anchorMs ?? timerSnapshot.effectiveStartTimeMs))
                ?? data.suiteTimerAnchorMs
                ?? data.globalTimerAnchorMs
            );
            const existingAnchorMs = Number(session.globalTimerAnchorMs);
            if ((!Number.isFinite(existingAnchorMs) || existingAnchorMs <= 0) && Number.isFinite(anchorMs) && anchorMs > 0) {
                session.globalTimerAnchorMs = Math.floor(anchorMs);
            }
            const pausedOffsetMs = Number(
                (timerSnapshot && timerSnapshot.pausedOffsetMs)
                ?? data.suiteTimerPausedOffsetMs
                ?? data.pausedOffsetMs
            );
            if (Number.isFinite(pausedOffsetMs) && pausedOffsetMs >= 0) {
                const existingOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
                session.suiteTimerPausedOffsetMs = Math.max(existingOffsetMs, Math.max(0, pausedOffsetMs));
            }
            const hasExplicitRunning = Boolean(
                (timerSnapshot && Object.prototype.hasOwnProperty.call(timerSnapshot, 'running'))
                || Object.prototype.hasOwnProperty.call(data, 'suiteTimerRunning')
            );
            const hasExplicitPausedAt = Boolean(
                (timerSnapshot && Object.prototype.hasOwnProperty.call(timerSnapshot, 'pausedAtMs'))
                || Object.prototype.hasOwnProperty.call(data, 'suiteTimerPausedAtMs')
                || Object.prototype.hasOwnProperty.call(data, 'pausedAtMs')
            );
            if (hasExplicitRunning || hasExplicitPausedAt) {
                const pausedAtMs = Number(
                    (timerSnapshot && timerSnapshot.pausedAtMs)
                    ?? data.suiteTimerPausedAtMs
                    ?? data.pausedAtMs
                );
                const running = hasExplicitRunning
                    ? (timerSnapshot ? timerSnapshot.running : data.suiteTimerRunning)
                    : !(Number.isFinite(pausedAtMs) && pausedAtMs > 0);
                session.suiteTimerRunning = running !== false;
                session.suiteTimerPausedAtMs = (
                    session.suiteTimerRunning === false
                    && Number.isFinite(pausedAtMs)
                    && pausedAtMs > 0
                ) ? Math.floor(pausedAtMs) : null;
            }
        },

        _computeSuiteElapsedSeconds(session, referenceNow = Date.now()) {
            if (!session || typeof session !== 'object') return 0;
            const anchorMs = Number(session.globalTimerAnchorMs) > 0
                ? Number(session.globalTimerAnchorMs)
                : Number(session.startTime) || Number(referenceNow) || Date.now();
            const pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
            const pausedAtMs = Number(session.suiteTimerPausedAtMs);
            const endMs = Number.isFinite(pausedAtMs) && pausedAtMs > 0
                ? pausedAtMs
                : (Number(referenceNow) || Date.now());
            return Math.max(0, Math.round((endMs - anchorMs - pausedOffsetMs) / 1000));
        },

        _deriveSuiteExamElapsedSeconds(session, examId, suiteElapsedSeconds, options = {}) {
            if (!session || !examId) {
                return 0;
            }
            const normalizedExamId = String(examId).trim();
            const totalElapsedSeconds = Number(suiteElapsedSeconds);
            const previousElapsedSeconds = Number(
                session.elapsedByExam && session.elapsedByExam[normalizedExamId]
            );
            if (!Number.isFinite(totalElapsedSeconds) || totalElapsedSeconds < 0) {
                return Number.isFinite(previousElapsedSeconds) && previousElapsedSeconds >= 0
                    ? Math.max(0, previousElapsedSeconds)
                    : 0;
            }
            let consumedByOtherExams = 0;
            const sequence = Array.isArray(session.sequence) ? session.sequence : [];
            sequence.forEach((entry) => {
                const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
                if (!entryExamId || entryExamId === normalizedExamId) {
                    return;
                }
                const value = Number(session.elapsedByExam && session.elapsedByExam[entryExamId]);
                if (Number.isFinite(value) && value > 0) {
                    consumedByOtherExams += Math.max(0, value);
                }
            });
            const derivedElapsedSeconds = Math.max(0, totalElapsedSeconds - consumedByOtherExams);
            if (options.allowDecrease === true) {
                return derivedElapsedSeconds;
            }
            if (Number.isFinite(previousElapsedSeconds) && previousElapsedSeconds > derivedElapsedSeconds) {
                return Math.max(0, previousElapsedSeconds);
            }
            return derivedElapsedSeconds;
        },

        _sendSimulationContext(session, examId, targetWindow) {
            if (!session || !examId || !targetWindow || targetWindow.closed) return false;
            if (session.flowMode !== 'simulation') return false;
            const idx = session.sequence.findIndex(e => e && e.examId === examId);
            if (idx < 0) return false;
            const windowInfo = typeof this.ensureExamWindowSession === 'function'
                ? this.ensureExamWindowSession(examId, targetWindow)
                : null;
            const messageIssuedAtMs = Date.now();
            const draft = session.draftsByExam && session.draftsByExam[examId] || null;
            const timerAnchorMs = Number(session.globalTimerAnchorMs) > 0
                ? Number(session.globalTimerAnchorMs)
                : Number(session.startTime) || Date.now();
            const elapsed = Number.isFinite(Number(session.elapsedByExam && session.elapsedByExam[examId]))
                ? Math.max(0, Number(session.elapsedByExam[examId]))
                : this._computeSuiteElapsedSeconds(session, Date.now());
            const pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
            const pausedAtMs = Number.isFinite(Number(session.suiteTimerPausedAtMs)) ? Number(session.suiteTimerPausedAtMs) : null;
            const suiteTimerRunning = session.suiteTimerRunning !== false;
            const payload = {
                    suiteSessionId: session.id,
                    flowMode: session.flowMode || 'simulation',
                    examId,
                    sessionId: windowInfo && windowInfo.expectedSessionId ? windowInfo.expectedSessionId : null,
                    windowSessionToken: windowInfo && windowInfo.windowSessionToken ? windowInfo.windowSessionToken : null,
                    windowSessionGeneration: windowInfo && Number.isInteger(windowInfo.sessionGeneration)
                        ? windowInfo.sessionGeneration
                        : 0,
                    messageIssuedAtMs,
                    suiteSequence: this._buildSuiteSequencePayload(session),
                    currentIndex: idx,
                    total: session.sequence.length,
                    isLast: idx === session.sequence.length - 1,
                    canPrev: idx > 0,
                    canNext: idx < session.sequence.length - 1,
                    draft,
                    elapsed,
                    globalTimerAnchorMs: timerAnchorMs,
                    suiteTimerAnchorMs: timerAnchorMs,
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    suiteTimerPausedOffsetMs: pausedOffsetMs,
                    suiteTimerPausedAtMs: pausedAtMs,
                    suiteTimerRunning,
                    timerSnapshot: {
                        anchorMs: timerAnchorMs,
                        effectiveStartTimeMs: timerAnchorMs,
                        pausedOffsetMs,
                        pausedAtMs,
                        running: suiteTimerRunning
                    }
            };
            try {
                this._postExamMessage(examId, targetWindow, 'SIMULATION_CONTEXT', payload);
                return true;
            } catch (e) {
                console.warn('[SuitePractice] 发送模拟上下文失败:', e);
                return false;
            }
        },

        async _handleSimulationNavigate(examId, data, sourceWindow) {
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') return false;
            if (session.flowMode !== 'simulation') return false;
            if (session.simulationNavigateLocked === true) {
                const inFlight = this._simulationNavigateInFlight;
                if (!inFlight || typeof inFlight.then !== 'function') return false;
                try {
                    await inFlight;
                } catch (_) {
                    // The queued request still gets its own validation and error path.
                }
                return this._handleSimulationNavigate(examId, data, sourceWindow);
            }
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            const activeExamId = session.activeExamId != null ? String(session.activeExamId).trim() : '';
            if (!normalizedExamId) return false;
            const currentIdx = session.sequence.findIndex(e => e && e.examId === normalizedExamId);
            if (currentIdx < 0) return false;
            // Self-heal when activeExamId drifts but the index still points to the current page.
            if (activeExamId && normalizedExamId !== activeExamId) {
                const allowSelfHeal = Number.isInteger(session.currentIndex) && session.currentIndex === currentIdx;
                if (!allowSelfHeal) {
                    return false;
                }
                session.activeExamId = normalizedExamId;
            }
            let releaseNavigation;
            const navigationInFlight = new Promise((resolve) => {
                releaseNavigation = resolve;
            });
            this._simulationNavigateInFlight = navigationInFlight;
            session.simulationNavigateLocked = true;
            try {

                this._persistSuiteDraftSnapshot(session, normalizedExamId, data);
                if (data && typeof data.elapsed === 'number') {
                    session.elapsedByExam[normalizedExamId] = this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, data.elapsed);
                }
                this._syncSuiteTimerFromPayload(session, data);
                const currentEntry = session.sequence.find(e => e && e.examId === normalizedExamId);
                if (currentEntry && data && data.resultSnapshot) {
                    const draftSnapshot = data.draft && typeof data.draft === 'object' ? data.draft : {};
                    const derivedSnapshotDuration = this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, data.elapsed);
                    const snapshot = {
                        ...data.resultSnapshot,
                        duration: Number.isFinite(Number(data.elapsed)) ? derivedSnapshotDuration : data.resultSnapshot.duration,
                        answers: data.resultSnapshot.answers || data.answers || draftSnapshot.answers || {},
                        highlights: Array.isArray(data.resultSnapshot.highlights)
                            ? data.resultSnapshot.highlights
                            : (Array.isArray(data.highlights)
                                ? data.highlights
                                : (Array.isArray(draftSnapshot.highlights) ? draftSnapshot.highlights : [])),
                        scrollY: Number.isFinite(Number(data.resultSnapshot.scrollY))
                            ? Number(data.resultSnapshot.scrollY)
                            : (Number.isFinite(Number(data.scrollY))
                                ? Number(data.scrollY)
                                : (Number.isFinite(Number(draftSnapshot.scrollY)) ? Number(draftSnapshot.scrollY) : 0))
                    };
                    const normalizedSnapshot = this._normalizeSuiteResult(currentEntry.exam, snapshot);
                    this._upsertSuiteResult(session, normalizedExamId, normalizedSnapshot);
                }

                const direction = String(data && data.direction || '').toLowerCase();
                if (direction !== 'next' && direction !== 'prev' && direction !== 'previous') return false;
                const targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
                if (targetIdx < 0 || targetIdx >= session.sequence.length) return false;

                const targetEntry = session.sequence[targetIdx];
                if (!targetEntry || !targetEntry.examId) return false;

                session.currentIndex = targetIdx;
                session.activeExamId = targetEntry.examId;

                const targetWindow = await this.openExam(targetEntry.examId, {
                    examDefinition: targetEntry.exam,
                    target: 'tab',
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: targetIdx,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: sourceWindow && !sourceWindow.closed ? sourceWindow : undefined
                });

                if (!targetWindow || targetWindow.closed) return false;

                session.windowRef = targetWindow;
                this._mirrorSessionToStorage(session);
                const reusedSourceWindow = Boolean(
                    sourceWindow
                    && !sourceWindow.closed
                    && sourceWindow === targetWindow
                    && targetEntry.examId !== normalizedExamId
                );
                if (reusedSourceWindow) {
                    const ready = await this._waitForSuiteWindowExamReady(session, targetEntry.examId, targetWindow);
                    if (!ready) {
                        if (!this._canFallbackSendSuiteContext(targetEntry.examId, targetWindow)) {
                            console.warn('[SuitePractice] 模拟模式切题等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                            this._focusSuiteWindow(targetWindow);
                            return true;
                        }
                        console.warn('[SuitePractice] 模拟模式切题未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                    }
                }
                session._contextSentExamId = targetEntry.examId;
                session._contextSentAt = Date.now();
                this._sendSimulationContext(session, targetEntry.examId, targetWindow);
                this._focusSuiteWindow(targetWindow);
                return true;
            } finally {
                session.simulationNavigateLocked = false;
                if (this._simulationNavigateInFlight === navigationInFlight) {
                    this._simulationNavigateInFlight = null;
                }
                releaseNavigation();
            }
        },

        _upsertSuiteResult(session, examId, normalizedResult) {
            if (!session || !Array.isArray(session.results) || !examId || !normalizedResult) {
                return;
            }
            const existingIndex = session.results.findIndex(entry => entry && entry.examId === examId);
            if (existingIndex >= 0) {
                session.results[existingIndex] = normalizedResult;
                return;
            }
            session.results.push(normalizedResult);
        },

        _handleSuiteSessionReady(examId) {
            const session = this.currentSuiteSession;
            if (!session || (session.status !== 'active' && session.status !== 'initializing') || !examId) {
                return false;
            }
            if (session.flowMode !== 'simulation' && session.flowMode !== 'stationary') {
                return false;
            }
            if (!Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }
            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            if (mappedSessionId && mappedSessionId !== session.id) {
                return false;
            }
            const idx = session.sequence.findIndex(item => item && item.examId === examId);
            if (idx < 0) {
                return false;
            }
            const windowInfo = this.examWindows && this.examWindows.get(examId)
                ? this.examWindows.get(examId)
                : null;
            const pageType = windowInfo && typeof windowInfo.pageType === 'string'
                ? windowInfo.pageType.toLowerCase()
                : '';
            if (pageType && !/unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(pageType)) {
                return false;
            }
            let targetWindow = session.windowRef && !session.windowRef.closed ? session.windowRef : null;
            if (windowInfo) {
                const info = windowInfo;
                if (info && info.window && !info.window.closed) {
                    targetWindow = info.window;
                }
            }
            if (!targetWindow || targetWindow.closed) {
                return false;
            }
            const resolveWindowExamId = (target) => {
                if (!target || target.closed) {
                    return '';
                }
                try {
                    const href = target.location && typeof target.location.href === 'string'
                        ? target.location.href
                        : '';
                    if (!href || href === 'about:blank') {
                        return '';
                    }
                    const parsed = new URL(href, (global && global.location && global.location.href) ? global.location.href : undefined);
                    const value = parsed.searchParams.get('examId');
                    return value ? String(value).trim() : '';
                } catch (_) {
                    return '';
                }
            };
            const windowExamId = this._readSuiteWindowExamId(targetWindow) || resolveWindowExamId(targetWindow);
            if (windowExamId && windowExamId !== String(examId)) {
                // Ignore late SESSION_READY events from previously active pages.
                return false;
            }
            const activeExamId = session.activeExamId ? String(session.activeExamId) : '';
            const indexAligned = Number.isInteger(session.currentIndex) && session.currentIndex === idx;
            if (activeExamId && activeExamId !== String(examId) && !indexAligned) {
                return false;
            }
            session.currentIndex = idx;
            session.activeExamId = examId;
            session.windowRef = targetWindow;
            this._mirrorSessionToStorage(session);
            if (session.flowMode === 'simulation' && session._contextSentExamId === examId
                && Number.isFinite(Number(session._contextSentAt))
                && Date.now() - session._contextSentAt < 3000) {
                return true;
            }
            if (session.flowMode === 'stationary') {
                return this._sendSuiteReviewState(session, examId, targetWindow);
            }
            return this._sendSimulationContext(session, examId, targetWindow);
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
                if (session.status !== 'completed' && this.isMultiSuiteComplete(session)) {
                    return await this.finalizeMultiSuiteRecord(session);
                }
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
                },
                rawData: (() => {
                    try {
                        return JSON.parse(JSON.stringify(suiteData));
                    } catch (_) {
                        return suiteData ? { ...suiteData } : null;
                    }
                })()
            };

            session.suiteResults.push(suiteResult);
            session.lastUpdate = Date.now();


            console.log('[MultiSuite] added suite result', suiteData.suiteId, 'current progress:', session.suiteResults.length + ' suite(s)');

            // 如果这是第一个套题，尝试从数据中确定预期套题数量
            if (session.suiteResults.length === 1 && !session.expectedSuiteCount) {
                session.expectedSuiteCount = this._detectExpectedSuiteCount(examId, suiteData);
                console.log('[MultiSuite] 检测到预期套题数量:', session.expectedSuiteCount);
            }

            // 检查是否所有套题都已完成
            if (this.isMultiSuiteComplete(session)) {
                console.log('[MultiSuite] all suite entries completed, finalizing consolidated record.');
                return await this.finalizeMultiSuiteRecord(session);
            }

            // 还有套题未完成，保存当前进度
            console.log('[MultiSuite] waiting for more suite entries... completed ' + session.suiteResults.length + '/' + (session.expectedSuiteCount || '?'));


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

            // 根据examId推断：100 P1/P4 通常包含10套题
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
                return false;
            }
            if (session._finalizePromise && typeof session._finalizePromise.then === 'function') {
                return session._finalizePromise;
            }
            const finalizePromise = this._finalizeMultiSuiteRecordInternal(session);
            session._finalizePromise = finalizePromise;
            try {
                return await finalizePromise;
            } finally {
                if (session._finalizePromise === finalizePromise) {
                    session._finalizePromise = null;
                }
            }
        },

        async _finalizeMultiSuiteRecordInternal(session) {
            if (!session || !Array.isArray(session.suiteResults) || session.suiteResults.length === 0) {
                console.warn('[MultiSuite] 无效的会话或无结果，跳过聚合');
                return false;
            }

            session.status = 'finalizing';
            console.log('[MultiSuite] 开始聚合多套题记录:', session.id);

            let record = null;
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
                const displayTitle = dateLabel + ' ' + sourceLabel + ' multi-suite practice';

                // 构建聚合记录
                record = {
                    id: session.id,
                    operationId: `practice-multisuite:${String(session.id)}:finalize`,
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
                        timestamp: result.timestamp,
                        rawData: result.rawData || null
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

                const operationId = `practice-multisuite:${String(session.id)}:finalize`;
                const frozenRecord = session.finalizeRecord
                    && session.finalizeOperationId === operationId
                    && typeof session.finalizeRecord === 'object'
                    ? this._cloneSuitePlainObject(session.finalizeRecord)
                    : record;
                frozenRecord.operationId = operationId;
                session.finalizeOperationId = operationId;
                session.finalizeRecord = this._cloneSuitePlainObject(frozenRecord);

                // v2 finalizeSuite is idempotent only when the record and operation
                // id remain byte-for-byte stable across retries.
                await this._saveSuitePracticeRecord(frozenRecord);
                record = frozenRecord;
                session.status = 'completed';
            } catch (error) {
                console.error('[MultiSuite] 聚合记录失败:', error);
                session.status = 'finalizing';
                try {
                    window.showMessage && window.showMessage('多套题记录保存失败，请稍后重试。', 'error');
                } catch (notificationError) {
                    console.warn('[MultiSuite] 显示聚合保存失败通知时出错:', notificationError);
                }
                return false;
            }

            // From here on the aggregate record is authoritative. Every remaining action is best-effort
            // and must not turn the committed submission into a NACK or another persistence attempt.
            const aggregatedSpellingErrors = Array.isArray(record.spellingErrors) ? record.spellingErrors : [];
            if (aggregatedSpellingErrors.length > 0 && window.spellingErrorCollector) {
                await this._runSuitePostCommitStep('保存多套题拼写错误', async () => {
                    await window.spellingErrorCollector.saveErrors(aggregatedSpellingErrors);
                    console.log('[MultiSuite] 已保存拼写错误到词表:', aggregatedSpellingErrors.length);
                });
            }
            await this._runSuitePostCommitStep('同步多套题练习记录', () => this._updatePracticeRecordsState());
            await this._runSuitePostCommitStep('刷新多套题总览', () => {
                this.refreshOverviewData && this.refreshOverviewData();
            });
            await this._runSuitePostCommitStep('清理多套题会话', () => {
                this.multiSuiteSessionsMap.delete(session.baseExamId);
            });
            await this._runSuitePostCommitStep('显示多套题完成通知', () => {
                window.showMessage && window.showMessage('多套题练习已完成，已保存 ' + session.suiteResults.length + ' 条套题记录。', 'success');
            });

            console.log('[MultiSuite] consolidated record saved:', record.id);
            return true;
        },

        async _runSuitePostCommitStep(label, callback) {
            try {
                await callback();
                return true;
            } catch (error) {
                console.warn(`[SuitePractice] ${label}失败（聚合记录已保存）:`, error);
                return false;
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
                    const normalizedQuestionId = questionId == null ? '' : String(questionId);
                    if (!normalizedQuestionId) {
                        return;
                    }

                    // Use "suiteId::questionId" format so prefixed child-page IDs still work.
                    const key = normalizedQuestionId.indexOf(suiteId + '::') === 0
                        ? normalizedQuestionId
                        : suiteId + '::' + normalizedQuestionId;
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
                    const normalizedQuestionId = questionId == null ? '' : String(questionId);
                    if (!normalizedQuestionId) {
                        return;
                    }

                    const key = normalizedQuestionId.indexOf(suiteId + '::') === 0
                        ? normalizedQuestionId
                        : suiteId + '::' + normalizedQuestionId;
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
                        const existingTimestamp = Number(existing.timestamp) || 0;
                        const incomingTimestamp = Number(error.timestamp) || 0;
                        existing.errorCount = (existing.errorCount || 1) + 1;

                        // 保留最新的用户输入
                        if (incomingTimestamp >= existingTimestamp) {
                            existing.userInput = error.userInput;
                            existing.questionId = error.questionId || existing.questionId;
                            existing.suiteId = error.suiteId || result.suiteId || existing.suiteId;
                            existing.examId = error.examId || result.examId || existing.examId;
                            existing.acceptedAnswers = Array.isArray(error.acceptedAnswers)
                                ? error.acceptedAnswers.slice()
                                : existing.acceptedAnswers;
                            existing.canonicalAnswer = error.canonicalAnswer || existing.canonicalAnswer;
                            existing.reasonCode = error.reasonCode || existing.reasonCode;
                            existing.confidence = typeof error.confidence === 'number' ? error.confidence : existing.confidence;
                            existing.tokenIndex = Number.isFinite(error.tokenIndex) ? error.tokenIndex : existing.tokenIndex;
                            existing.metadata = error.metadata || existing.metadata;
                        }
                        existing.timestamp = Math.max(existingTimestamp, incomingTimestamp);
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
                            source: error.source || this._detectMultiSuiteSource(result.examId),
                            acceptedAnswers: Array.isArray(error.acceptedAnswers) ? error.acceptedAnswers.slice() : undefined,
                            canonicalAnswer: error.canonicalAnswer,
                            reasonCode: error.reasonCode,
                            confidence: typeof error.confidence === 'number' ? error.confidence : undefined,
                            tokenIndex: Number.isFinite(error.tokenIndex) ? error.tokenIndex : undefined,
                            metadata: error.metadata
                        });
                    }
                });
            });

            // 转换为数组
            errorMap.forEach(error => aggregated.push(error));

            return aggregated;
        },

        async _finalizeSuiteRecordWithGate(session, options = {}) {
            if (!session) return false;
            if (session._finalizePromise && typeof session._finalizePromise.then === 'function') {
                return session._finalizePromise;
            }
            const finalizePromise = this.finalizeSuiteRecord(session, options);
            session._finalizePromise = finalizePromise;
            try {
                return await finalizePromise;
            } finally {
                if (session._finalizePromise === finalizePromise) {
                    session._finalizePromise = null;
                }
            }
        },

        async finalizeSuiteRecord(session, options = {}) {
            if (!session || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }

            const sequenceIds = session.sequence
                .map((entry) => entry && String(entry.examId || '').trim())
                .filter(Boolean);
            const results = Array.isArray(session.results) ? session.results : [];
            const resultIds = results
                .map((entry) => entry && String(entry.examId || '').trim())
                .filter(Boolean);
            const invalidResultIndex = results.findIndex((entry) => !this._isValidSuiteRecoveryResult(entry, sequenceIds));
            const invalidResultExamId = invalidResultIndex >= 0 && results[invalidResultIndex]
                ? String(results[invalidResultIndex].examId || '').trim()
                : '';
            const invalidSequenceIndex = invalidResultExamId ? sequenceIds.indexOf(invalidResultExamId) : -1;
            const missingResultIndex = session.sequence.findIndex((entry) => (
                entry && !resultIds.includes(String(entry.examId))
            ));
            const completeResults = Boolean(
                sequenceIds.length === session.sequence.length
                && resultIds.length === sequenceIds.length
                && new Set(resultIds).size === resultIds.length
                && invalidResultIndex < 0
                && sequenceIds.every((examId) => resultIds.includes(examId))
            );
            if (!completeResults) {
                const recoveryIndex = invalidSequenceIndex >= 0 ? invalidSequenceIndex : missingResultIndex;
                const safeIndex = recoveryIndex >= 0
                    ? recoveryIndex
                    : Math.min(Math.max(0, Number(session.currentIndex) || 0), session.sequence.length - 1);
                session.status = 'active';
                session.currentIndex = safeIndex;
                session.activeExamId = session.sequence[safeIndex] && session.sequence[safeIndex].examId || null;
                session.finalizeOperationId = null;
                session.finalizeRecord = null;
                session.lastUpdate = Date.now();
                this._mirrorSessionToStorage(session);
                window.showMessage && window.showMessage('套题结果不完整，请完成缺失篇章后再提交。', 'warning');
                return false;
            }

            session.status = 'finalizing';
            session.currentIndex = session.sequence.length;
            session.activeExamId = null;
            session.lastUpdate = Date.now();
            this._mirrorSessionToStorage(session);

            let committed = false;
            try {
                const completionTime = Date.now();
                const suiteEntries = session.results.map(entry => {
                    const draft = this._resolveSuiteEntryDraft(session, entry && entry.examId);
                    return {
                        examId: entry.examId,
                        title: entry.title,
                        category: entry.category,
                        duration: entry.duration,
                        scoreInfo: entry.scoreInfo,
                        answers: entry.answers,
                        answerComparison: entry.answerComparison,
                        markedQuestions: Array.isArray(entry.markedQuestions) ? entry.markedQuestions.slice() : [],
                        highlights: this._resolveSuiteEntryHighlights(entry, draft),
                        noteText: this._resolveSuiteEntryNoteText(entry, draft),
                        notes: this._resolveSuiteEntryNotes(entry, draft),
                        noteOutlines: this._resolveSuiteEntryNoteOutlines(entry, draft),
                        scrollY: this._resolveSuiteEntryScrollY(entry, draft),
                        rawData: this._sanitizeSuiteRawData(entry.rawData)
                    };
                });

                const timerAnchorMs = Number(session.globalTimerAnchorMs) > 0
                    ? Number(session.globalTimerAnchorMs)
                    : Number(session.startTime) || completionTime;
                const startTimestamp = timerAnchorMs;
                let pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
                const pausedAtMs = Number(session.suiteTimerPausedAtMs);
                if (Number.isFinite(pausedAtMs) && pausedAtMs > 0 && completionTime > pausedAtMs) {
                    pausedOffsetMs += (completionTime - pausedAtMs);
                }
                const elapsedMs = Math.max(0, completionTime - startTimestamp - pausedOffsetMs);
                const totalDuration = Math.max(0, Math.round(elapsedMs / 1000));
                const totalCorrect = session.results.reduce((sum, entry) => sum + entry.scoreInfo.correct, 0);
                const totalQuestions = session.results.reduce((sum, entry) => sum + entry.scoreInfo.total, 0);
                const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) : 0;
                const percentage = Math.round(accuracy * 100);

                const aggregatedAnswers = {};
                const aggregatedComparison = {};
                session.results.forEach(entry => {
                    const prefix = entry.examId ? entry.examId + '::' : '';
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
                        aggregatedAnswers[prefix + questionId] = answersSource[questionId];
                    });

                    const comparisonSource = entry.answerComparison && typeof entry.answerComparison === 'object'
                        ? entry.answerComparison
                        : {};
                    Object.keys(comparisonSource).forEach(questionId => {
                        aggregatedComparison[prefix + questionId] = comparisonSource[questionId];
                    });
                });

                const startTime = startTimestamp;
                const startTimeIso = new Date(startTime).toISOString();
                const endTimeIso = new Date(completionTime).toISOString();
                const suiteSequence = await this._resolveSuiteSequenceNumber(startTime);
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const displayTitle = dateLabel + '套题练习' + suiteSequence;

                const builtRecord = {
                    id: session.id,
                    examId: 'suite-' + session.id,
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
                        suiteEntryCount: suiteEntries.length,
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
                        suiteEntryCount: suiteEntries.length
                    },
                    sessionId: session.id
                };

                const expectedOperationId = `practice-suite:${String(session.id)}:finalize`;
                session.finalizeOperationId = expectedOperationId;
                const persistedRecord = session.finalizeRecord && this._isValidSuiteFinalizeRecord(session, session.finalizeRecord)
                    ? this._cloneSuitePlainObject(session.finalizeRecord)
                    : builtRecord;
                const record = persistedRecord;
                record.operationId = expectedOperationId;
                session.finalizeRecord = this._cloneSuitePlainObject(record);
                this._mirrorSessionToStorage(session);

                await this._saveSuitePracticeRecord(record);
                committed = true;
                session.status = 'completed';
            } catch (error) {
                console.error('[SuitePractice] 保存套题记录失败:', error);
                try {
                    window.showMessage && window.showMessage('套题记录保存失败，恢复快照已保留，请稍后重试。', 'error');
                } catch (notificationError) {
                    console.warn('[SuitePractice] 显示套题保存失败通知时出错:', notificationError);
                }
                session.status = 'finalizing';
                session.lastUpdate = Date.now();
                this._mirrorSessionToStorage(session);
            }

            if (committed) {
                await this._runSuitePostCommitStep('同步套题练习记录', () => this._updatePracticeRecordsState());
                await this._runSuitePostCommitStep('刷新套题总览', () => {
                    this.refreshOverviewData && this.refreshOverviewData();
                });
                await this._runSuitePostCommitStep('显示套题完成通知', () => {
                    window.showMessage && window.showMessage('套题练习已完成，记录已保存。', 'success');
                });
            }

            if (committed && !options.deferTeardown) {
                await this._runSuitePostCommitStep('清理套题会话窗口', () => this._teardownSuiteSession(session));
            }
            return committed;
        },

        async _fetchSuiteExamIndex() {
            const list = await window.resolveActiveLibraryIndex();
            return Array.isArray(list) ? list.filter(Boolean) : [];
        },

        async _listPracticeRecordsViaAPI() {
            const normalizeList = (list) => (Array.isArray(list) ? list : []);

            // Filtering needs suiteEntries and suite markers, but never highlights or notes.
            // The detail projection contains those fields without loading the annotation layer.
            return normalizeList(await window.AppData.practice.list({ projection: 'detail' }));
        },

        async _recalculatePracticeStatsFromRecords() {
            await window.AppData.practice.getStats();
            return true;
        },

        async _loadSuitePracticeRecordsForFiltering() {
            return this._listPracticeRecordsViaAPI();
        },

        _isSuitePracticeRecord(record) {
            if (!record || typeof record !== 'object') {
                return false;
            }
            if (record.suiteMode === true) {
                return true;
            }
            const freq = String(record.frequency || '').toLowerCase();
            const metaFreq = String(record.metadata && record.metadata.frequency || '').toLowerCase();
            return freq === 'suite' || metaFreq === 'suite';
        },

        _collectExamIdsFromPracticeRecord(record, collector) {
            if (!record || typeof record !== 'object' || !(collector instanceof Set)) {
                return;
            }

            const pushExamId = (value) => {
                const normalized = String(value == null ? '' : value).trim();
                if (normalized) {
                    collector.add(normalized);
                }
            };

            pushExamId(record.examId);

            const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : null;
            if (metadata) {
                pushExamId(metadata.examId);
            }

            const rawData = record.rawData && typeof record.rawData === 'object' ? record.rawData : null;
            if (rawData) {
                pushExamId(rawData.examId);
            }

            const suiteEntries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
            suiteEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                pushExamId(entry.examId);
                const entryRawData = entry.rawData && typeof entry.rawData === 'object' ? entry.rawData : null;
                if (entryRawData) {
                    pushExamId(entryRawData.examId);
                }
            });
        },

        async _collectPracticedReadingExamIds() {
            const records = await this._loadSuitePracticeRecordsForFiltering();
            const practicedExamIds = new Set();
            records.forEach((record) => this._collectExamIdsFromPracticeRecord(record, practicedExamIds));
            return practicedExamIds;
        },

        _getCustomSuiteDraftState() {
            if (typeof global.getCustomSuiteDraftState === 'function') {
                return global.getCustomSuiteDraftState();
            }
            if (global.appStateService && typeof global.appStateService.getCustomSuiteDraft === 'function') {
                return global.appStateService.getCustomSuiteDraft();
            }
            if (global.app && global.app.state && global.app.state.ui) {
                return global.app.state.ui.customSuiteDraft || null;
            }
            return global.customSuiteDraft || null;
        },

        _setCustomSuiteDraftState(draft) {
            if (typeof global.setCustomSuiteDraftState === 'function') {
                return global.setCustomSuiteDraftState(draft);
            }
            if (global.appStateService && typeof global.appStateService.setCustomSuiteDraft === 'function') {
                return global.appStateService.setCustomSuiteDraft(draft);
            }
            if (global.app && global.app.state && global.app.state.ui) {
                global.app.state.ui.customSuiteDraft = draft || null;
            }
            try {
                global.customSuiteDraft = draft || null;
            } catch (_) {}
            return draft || null;
        },

        _clearCustomSuiteDraftState() {
            return this._setCustomSuiteDraftState(null);
        },

        _getCustomSuiteCategories() {
            return ['P1', 'P2', 'P3'];
        },

        _buildCustomSuiteExamEntry(exam) {
            if (!exam || typeof exam !== 'object') {
                return null;
            }
            return {
                examId: String(exam.id == null ? '' : exam.id),
                title: typeof exam.title === 'string' ? exam.title : '',
                category: typeof exam.category === 'string' ? exam.category.trim().toUpperCase() : '',
                frequency: typeof exam.frequency === 'string' ? exam.frequency : '',
                type: typeof exam.type === 'string' ? exam.type : 'reading',
                hasHtml: !!exam.hasHtml
            };
        },

        _buildCustomSuiteSelectionDraft(flowMode, frequencyScope) {
            const categories = this._getCustomSuiteCategories();
            const now = Date.now();
            return {
                status: 'selecting',
                stageIndex: 0,
                categories,
                pickedByCategory: {},
                pickedOrder: [],
                flowMode: flowMode || 'classic',
                frequencyScope: frequencyScope || 'custom',
                createdAt: now,
                updatedAt: now
            };
        },

        async _startCustomSuiteSelection(options = {}) {
            const flowMode = options.flowMode || 'classic';
            const frequencyScope = options.frequencyScope || 'custom';
            const examIndex = await this._fetchSuiteExamIndex();
            if (!examIndex.length) {
                window.showMessage && window.showMessage('题库为空，无法启动自选流程。', 'warning');
                return false;
            }

            const normalizedIndex = examIndex
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return null;
                    }
                    const normalizedType = String(item.type || 'reading').toLowerCase();
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

            const categories = this._getCustomSuiteCategories();
            for (const category of categories) {
                const pool = normalizedIndex.filter(item => item.category === category);
                if (!pool.length) {
                    window.showMessage && window.showMessage('当前题库缺少 ' + category + ' 阅读题目，无法启动自选流程。', 'warning');
                    return false;
                }
            }

            this._setCustomSuiteDraftState(this._buildCustomSuiteSelectionDraft(flowMode, frequencyScope));

            if (typeof global.setBrowseTitle === 'function') {
                try {
                    global.setBrowseTitle('套题自选');
                } catch (_) {}
            }

            const firstCategory = categories[0];
            if (typeof global.browseCategory === 'function') {
                global.browseCategory(firstCategory, 'reading');
            } else if (typeof global.showView === 'function') {
                global.__pendingBrowseFilter = {
                    category: firstCategory,
                    type: 'reading',
                    filterMode: null,
                    path: null
                };
                global.showView('browse', false);
            }

            if (typeof global.loadExamList === 'function') {
                try {
                    global.loadExamList();
                } catch (_) {}
            }

            return true;
        },

        async _buildCustomSuiteSequenceFromDraft(draft) {
            const examIndex = await this._fetchSuiteExamIndex();
            const examMap = new Map(
                Array.isArray(examIndex)
                    ? examIndex
                        .filter(item => item && item.id != null)
                        .map(item => [String(item.id), item])
                    : []
            );

            const pickedOrder = draft && Array.isArray(draft.pickedOrder) ? draft.pickedOrder : [];
            return pickedOrder
                .map((entry) => {
                    if (!entry || !entry.examId) {
                        return null;
                    }
                    const exam = examMap.get(String(entry.examId));
                    if (!exam) {
                        return null;
                    }
                    return {
                        examId: exam.id,
                        exam
                    };
                })
                .filter(Boolean);
        },

        async confirmCustomSuiteSelection() {
            const draft = this._getCustomSuiteDraftState();
            if (!draft || draft.status !== 'ready') {
                window.showMessage && window.showMessage('当前尚未完成三篇自选，请继续选择后再确认。', 'warning');
                return false;
            }

            const sequence = await this._buildCustomSuiteSequenceFromDraft(draft);
            if (!sequence.length) {
                window.showMessage && window.showMessage('自选题目无法启动，请重新选择。', 'warning');
                return false;
            }

            const started = await this._launchSuiteSessionFromSequence(sequence, {
                flowMode: draft.flowMode || 'classic',
                frequencyScope: draft.frequencyScope || 'custom',
                suiteWindowName: 'ielts-suite-mode-tab',
                launchLabel: '自选套题'
            });

            if (started) {
                this._clearCustomSuiteDraftState();
            }

            return started;
        },

        async cancelCustomSuiteSelection() {
            this._clearCustomSuiteDraftState();
            if (typeof global.resetBrowseViewToAll === 'function') {
                try {
                    global.resetBrowseViewToAll();
                } catch (_) {}
            }
            return true;
        },

        async _launchSuiteSessionFromSequence(sequence, options = {}) {
            const suiteWindowName = options.suiteWindowName || 'ielts-suite-mode-tab';
            const flowMode = options.flowMode || 'simulation';
            const frequencyScope = options.frequencyScope || 'all';
            const launchLabel = options.launchLabel || (
                flowMode === 'stationary'
                    ? '驻足模式'
                    : (flowMode === 'simulation' ? '模拟模式' : '经典模式')
            );

            try {
                if (this.currentSuiteSession && this.currentSuiteSession.status === 'active') {
                    window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                    return false;
                }

                if (typeof this.openExam !== 'function') {
                    window.showMessage && window.showMessage('当前版本暂不支持套题练习自动打开题目。', 'error');
                    return false;
                }

                const normalizedSequence = Array.isArray(sequence)
                    ? sequence.filter(item => item && item.examId && item.exam)
                    : [];
                if (!normalizedSequence.length) {
                    window.showMessage && window.showMessage('未找到可用的套题题目。', 'warning');
                    return false;
                }

                this._clearSuiteHandshakes();

                const suiteSessionId = this._generateSuiteSessionId();
                const lockedAutoAdvance = flowMode === 'stationary'
                    ? false
                    : true;
                const timerAnchorMs = Date.now();
                const suiteTimerMode = 'countdown';
                const suiteTimerLimitSeconds = 3600;
                const session = {
                    id: suiteSessionId,
                    status: 'initializing',
                    startTime: timerAnchorMs,
                    sequence: normalizedSequence,
                    currentIndex: 0,
                    results: [],
                    draftsByExam: {},
                    elapsedByExam: {},
                    globalTimerAnchorMs: timerAnchorMs,
                    suiteTimerAnchorMs: timerAnchorMs,
                    suiteTimerMode,
                    suiteTimerLimitSeconds,
                    suiteTimerPausedOffsetMs: 0,
                    suiteTimerPausedAtMs: null,
                    suiteTimerRunning: true,
                    flowMode,
                    frequencyScope,
                    autoAdvanceAfterSubmit: lockedAutoAdvance,
                    windowRef: null,
                    windowName: suiteWindowName
                };

                this.currentSuiteSession = session;
                this._registerSuiteSequence(session);
                session.lastUpdate = Date.now();
                if (!this._mirrorSessionToStorage(session)) {
                    window.showMessage && window.showMessage('套题进度暂未能写入恢复存储，当前窗口仍可继续练习。', 'error');
                }

                const firstEntry = normalizedSequence[0];
                window.showMessage && window.showMessage(launchLabel + ' 已启动，正在打开第一篇。', 'info');

                let examWindow = null;
                try {
                    examWindow = await this.openExam(firstEntry.examId, {
                        examDefinition: firstEntry.exam,
                        target: 'tab',
                        windowName: suiteWindowName,
                        suiteSessionId,
                        suiteFlowMode: flowMode,
                        suiteTimerMode,
                        suiteTimerLimitSeconds,
                        sequenceIndex: 0,
                        sequenceTotal: normalizedSequence.length
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
                session.lastUpdate = Date.now();
                if (!this._mirrorSessionToStorage(session)) {
                    window.showMessage && window.showMessage('套题已打开，但恢复快照写入失败。', 'error');
                }
                this._focusSuiteWindow(session.windowRef);
                if (flowMode === 'simulation') {
                    this._sendSimulationContext(session, firstEntry.examId, session.windowRef);
                }
                return true;
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                if (this.currentSuiteSession && this.currentSuiteSession.status !== 'initializing') {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
                return false;
            }
        },
        _generateSuiteSessionId() {
            return 'suite_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 8);
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
            const correctAnswerMap = typeof this._resolveReplayCorrectAnswerMap === 'function'
                ? this._resolveReplayCorrectAnswerMap(rawData, { examId: exam && exam.id, comparison })
                : {};

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
                correctAnswerMap,
                answerComparison: comparison,
                markedQuestions: Array.isArray(rawData?.metadata?.markedQuestions)
                    ? rawData.metadata.markedQuestions.slice()
                    : (Array.isArray(rawData?.markedQuestions) ? rawData.markedQuestions.slice() : []),
                rawData: this._sanitizeSuiteRawData(rawData)
            };
        },

        _isValidSuiteScoreInfo(scoreInfo) {
            if (!scoreInfo || typeof scoreInfo !== 'object' || Array.isArray(scoreInfo)) return false;
            const correct = Number(scoreInfo.correct);
            const total = Number(scoreInfo.total);
            const accuracy = Number(scoreInfo.accuracy);
            const percentage = Number(scoreInfo.percentage);
            return Boolean(
                Number.isFinite(correct)
                && Number.isFinite(total)
                && Number.isFinite(accuracy)
                && Number.isFinite(percentage)
                && correct >= 0
                && total >= 0
                && correct <= total
                && accuracy >= 0
                && accuracy <= 1
                && percentage >= 0
                && percentage <= 100
            );
        },

        _isValidSuiteRecoveryResult(entry, sequenceIds = []) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const examId = String(entry.examId || '').trim();
            const duration = Number(entry.duration);
            return Boolean(
                examId
                && (!sequenceIds.length || sequenceIds.includes(examId))
                && Number.isFinite(duration)
                && duration >= 0
                && this._isValidSuiteScoreInfo(entry.scoreInfo)
                && entry.answers
                && typeof entry.answers === 'object'
                && entry.answerComparison
                && typeof entry.answerComparison === 'object'
            );
        },

        _isValidSuiteFinalizeEntry(entry, sequenceIds = []) {
            return Boolean(
                this._isValidSuiteRecoveryResult(entry, sequenceIds)
                && Array.isArray(entry.markedQuestions)
                && Array.isArray(entry.highlights)
                && typeof entry.noteText === 'string'
                && Array.isArray(entry.notes)
                && Array.isArray(entry.noteOutlines)
                && Number.isFinite(Number(entry.scrollY))
            );
        },

        _isValidSuiteFinalizeRecord(session, record) {
            if (!session || !record || typeof record !== 'object') return false;
            const sequenceIds = Array.isArray(session.sequence)
                ? session.sequence.map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean)
                : [];
            const recordEntries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
            const recordIds = recordEntries
                .map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean);
            const results = Array.isArray(session.results) ? session.results : [];
            const resultIds = results.map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean);
            const expectedAnswers = {};
            const expectedComparison = {};
            let expectedCorrect = 0;
            let expectedTotal = 0;
            results.forEach((entry) => {
                const examId = String(entry && entry.examId || '').trim();
                const prefix = examId ? `${examId}::` : '';
                expectedCorrect += Number(entry && entry.scoreInfo && entry.scoreInfo.correct) || 0;
                expectedTotal += Number(entry && entry.scoreInfo && entry.scoreInfo.total) || 0;
                Object.entries(entry && entry.answers && typeof entry.answers === 'object' ? entry.answers : {})
                    .forEach(([questionId, answer]) => {
                        expectedAnswers[prefix + questionId] = answer;
                    });
                Object.entries(entry && entry.answerComparison && typeof entry.answerComparison === 'object' ? entry.answerComparison : {})
                    .forEach(([questionId, comparison]) => {
                        expectedComparison[prefix + questionId] = comparison;
                    });
            });
            const expectedAccuracy = expectedTotal > 0 ? expectedCorrect / expectedTotal : 0;
            const expectedPercentage = Math.round(expectedAccuracy * 100);
            const scoreInfo = record.scoreInfo;
            const numericMatches = (left, right) => Number.isFinite(Number(left)) && Number(left) === Number(right);
            return Boolean(
                session.id
                && String(record.id || '') === String(session.id)
                && String(record.sessionId || '') === String(session.id)
                && sequenceIds.length > 0
                && record.examId === `suite-${String(session.id)}`
                && record.type === 'reading'
                && record.suiteMode === true
                && record.frequency === 'suite'
                && typeof record.title === 'string'
                && typeof record.date === 'string'
                && typeof record.startTime === 'string'
                && typeof record.endTime === 'string'
                && Number.isFinite(Number(record.duration))
                && Number(record.duration) >= 0
                && this._isValidSuiteScoreInfo(scoreInfo)
                && numericMatches(record.totalQuestions, expectedTotal)
                && numericMatches(record.correctAnswers, expectedCorrect)
                && numericMatches(scoreInfo.correct, expectedCorrect)
                && numericMatches(scoreInfo.total, expectedTotal)
                && Math.abs(Number(scoreInfo.accuracy) - expectedAccuracy) < 1e-9
                && Number(scoreInfo.percentage) === expectedPercentage
                && this._suiteValuesEqual(record.answers, expectedAnswers)
                && this._suiteValuesEqual(record.answerComparison, expectedComparison)
                && recordEntries.length === sequenceIds.length
                && recordIds.length === sequenceIds.length
                && new Set(recordIds).size === recordIds.length
                && recordIds.every((examId, index) => examId === sequenceIds[index])
                && resultIds.length === sequenceIds.length
                && new Set(resultIds).size === resultIds.length
                && resultIds.every((examId) => sequenceIds.includes(examId))
                && recordEntries.every((entry, index) => {
                    const result = results.find((candidate) => String(candidate && candidate.examId || '').trim() === sequenceIds[index]);
                    return this._isValidSuiteFinalizeEntry(entry, sequenceIds)
                        && result
                        && numericMatches(entry.duration, result.duration)
                        && this._suiteValuesEqual(entry.scoreInfo, result.scoreInfo)
                        && this._suiteValuesEqual(entry.answers, result.answers)
                        && this._suiteValuesEqual(entry.answerComparison, result.answerComparison);
                })
                && record.metadata
                && typeof record.metadata === 'object'
                && String(record.metadata.suiteSessionId || '') === String(session.id)
                && Number(record.metadata.suiteEntryCount) === sequenceIds.length
                && record.realData
                && typeof record.realData === 'object'
                && record.realData.source === 'suite_mode'
                && numericMatches(record.realData.correct, expectedCorrect)
                && numericMatches(record.realData.total, expectedTotal)
                && numericMatches(record.realData.duration, record.duration)
                && typeof record.operationId === 'string'
                && record.operationId === `practice-suite:${String(session.id)}:finalize`
            );
        },

        async _saveSuitePracticeRecord(record) {
            const childSessionIds = [];
            (Array.isArray(record && record.suiteEntries) ? record.suiteEntries : []).forEach((entry) => {
                const raw = entry && entry.rawData || {};
                const sessionId = raw.sessionId || (entry && (entry.sessionId || entry.suiteEntrySessionId));
                if (sessionId && String(sessionId) !== String(record.sessionId || '')) childSessionIds.push(String(sessionId));
            });
            const receipt = await window.AppData.practice.finalizeSuite({
                record,
                childSessionIds,
                operationId: record.operationId
            });
            if (!receipt || receipt.committed !== true) {
                const error = new Error('Suite aggregate commit was not confirmed');
                error.code = 'SUITE_COMMIT_NOT_CONFIRMED';
                throw error;
            }
            return receipt.record || record;
        },

        async _cleanupSuiteEntryRecords(record) {
            if (!record || !Array.isArray(record.suiteEntries) || record.suiteEntries.length === 0) {
                return;
            }

            const entrySessionIds = new Set();

            record.suiteEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const raw = entry.rawData || {};
                const sessionId = raw.sessionId || entry.sessionId || entry.suiteEntrySessionId || null;
                if (sessionId) {
                    entrySessionIds.add(String(sessionId));
                }
            });

            if (entrySessionIds.size === 0) {
                console.warn('[SuitePractice] 跳过套题子记录清理：suiteEntries 缺少 sessionId，不能用 examId/时间窗口猜测删除');
                return;
            }

            if (record.sessionId) {
                entrySessionIds.delete(String(record.sessionId));
            }
            if (entrySessionIds.size === 0) {
                return;
            }

            // Child cleanup is committed atomically by practice.finalizeSuite.
        },

        async _updatePracticeRecordsState() {
            try {
                if (typeof window.syncPracticeRecords === 'function') {
                    await window.syncPracticeRecords({ forceRender: true });
                    return;
                } else {
                    const [latest, index] = await Promise.all([
                        window.AppData.practice.list({ projection: 'light' }),
                        window.resolveActiveLibraryIndex()
                    ]);
                    if (typeof window.refreshBrowseProgressFromRecords === 'function') {
                        window.refreshBrowseProgressFromRecords(latest, index);
                    }
                    if (typeof window.updatePracticeView === 'function') {
                        window.updatePracticeView(latest, index);
                    }
                }
            } catch (error) {
                console.warn('[SuitePractice] 同步练习记录失败:', error);
            }
        },

        _formatSuiteDateLabel(timestamp) {
            const date = new Date(timestamp);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return month + '月' + day + '日';
        },

        async _resolveSuiteSequenceNumber(timestamp) {
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) {
                return 1;
            }

            const targetYear = date.getFullYear();
            const targetMonth = date.getMonth();
            const targetDate = date.getDate();

            const existingRecords = await this._listPracticeRecordsViaAPI();

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
                if (!this._isSuitePracticeRecord(record)) {
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

            if (session.submitReceiptTeardownTimer) {
                clearTimeout(session.submitReceiptTeardownTimer);
                session.submitReceiptTeardownTimer = null;
            }

            this._clearSuiteHandshakes();

            if (session.windowRef && !session.windowRef.closed && typeof session.windowRef.postMessage === 'function') {
                try {
                    const activeExamId = session.activeExamId
                        || (session.sequence && session.sequence[session.currentIndex || 0] && session.sequence[session.currentIndex || 0].examId)
                        || '';
                    this._postExamMessage(activeExamId, session.windowRef, 'SUITE_FORCE_CLOSE', {
                        suiteSessionId: session.id || null
                    });
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
            this._clearSessionStorage();
        },

        async _abortSuiteSession(session, options = {}) {
            if (!session) {
                return;
            }

            session.status = 'aborted';

            this._clearSuiteHandshakes();

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
                    console.warn('[SuitePractice] Unable to read suite window guard data:', error);
                } else {
                    console.debug('[SuitePractice] Suite window guard is cross-origin; skipping guard release.');
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

                console.log('[MultiSuite] session completed:', session.id, 'completed ' + completedCount + '/' + session.expectedSuiteCount + ' suite(s)');
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
            const prefix = baseExamId ? baseExamId + '_' : '';
            return 'multi_' + prefix + timestamp + '_' + random;
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
