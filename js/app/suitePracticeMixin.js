(function(global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');

    function getSuitePreferenceUtils() {
        return global.SuitePreferenceUtils || null;
    }

    function resolveSuitePreferenceForMixin(options = {}) {
        const suitePreferenceUtils = getSuitePreferenceUtils();
        if (suitePreferenceUtils && typeof suitePreferenceUtils.resolveSuitePreference === 'function') {
            return suitePreferenceUtils.resolveSuitePreference(options);
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
            this.multiSuiteSessionsMap = new Map(); // 鏂板锛氬瓨鍌ㄥ濂楅浼氳瘽
            if (typeof this._clearSuiteHandshakes === 'function') {
                this._clearSuiteHandshakes();
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

                if (this.currentSuiteSession && this.currentSuiteSession.status === 'active') {
                    window.showMessage && window.showMessage('濂楅缁冧範姝ｅ湪杩涜涓紝璇峰厛瀹屾垚褰撳墠濂楅銆?', 'warning');
                    return;
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
                    window.showMessage && window.showMessage('褰撳墠鐗堟湰鏆備笉鏀寔濂楅缁冧範鑷姩鎵撳紑棰樼洰銆?', 'error');
                    return;
                }

                const examIndex = await this._fetchSuiteExamIndex();
                if (!examIndex.length) {
                    window.showMessage && window.showMessage('棰樺簱涓虹┖锛屾棤娉曞紑鍚棰樼粌涔犮€?', 'warning');
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

                const categories = ['P1', 'P2', 'P3'];
                const sequence = [];
                for (const category of categories) {
                    const pool = frequencyFilteredIndex.filter(item => item.category === category);
                    if (!pool.length) {
                        const scopeLabel = frequencyScope === 'high'
                            ? '浠呴珮棰?'
                            : (frequencyScope === 'high_medium' ? '楂橀+娆￠珮棰?' : '鍏ㄩ儴棰戠巼');
                        window.showMessage && window.showMessage('当前抽题范围（' + scopeLabel + '）缺少 ' + category + ' 阅读题目，无法开启套题练习。', 'warning');
                        return;
                    }
                    const picked = pool[Math.floor(Math.random() * pool.length)];
                    sequence.push({ examId: picked.id, exam: picked });
                }

                const started = await this._launchSuiteSessionFromSequence(sequence, {
                    flowMode,
                    frequencyScope,
                    suiteWindowName,
                    launchLabel: flowMode === 'stationary'
                        ? '椹昏冻妯″紡'
                        : (flowMode === 'simulation' ? '妯℃嫙妯″紡' : '缁忓吀妯″紡')
                });
                if (!started && this.currentSuiteSession) {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            } catch (error) {
                console.error('[SuitePractice] 鍚姩澶辫触:', error);
                window.showMessage && window.showMessage('濂楅缁冧範鍚姩澶辫触锛岃绋嶅悗閲嶈瘯銆?', 'error');
                if (this.currentSuiteSession) {
                    await this._abortSuiteSession(this.currentSuiteSession, { reason: 'startup_failed' });
                }
            }
        },
        async handleSuitePracticeComplete(examId, data, sourceWindow = null) {
            // First check whether this is multi-suite mode (detected via suiteId).
            if (data && data.suiteId) {
                return await this.handleMultiSuitePracticeComplete(examId, data);
            }

            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') {
                return false;
            }

            const payloadSuiteSessionId = (data && typeof data.suiteSessionId === 'string')
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
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
                console.warn('[SuitePractice] 蹇界暐闈炲綋鍓嶆椿鍔ㄧ瘒绔犵殑鎻愪氦锛岄槻姝㈤敊绡囩粨绠?', {
                    activeExamId,
                    submittedExamId: examId,
                    sessionId: session.id
                });
                return true;
            }

            const normalized = this._normalizeSuiteResult(sequenceEntry.exam, data);
            this._upsertSuiteResult(session, examId, normalized);
            session.lastUpdate = Date.now();
            this.updateExamStatus && this.updateExamStatus(examId, 'completed');

            // Save draft snapshot for this passage
            session.draftsByExam[examId] = {
                answers: data.answers || {},
                highlights: data.highlights || [],
                scrollY: data.scrollY || 0
            };
            if (Number.isFinite(Number(data && data.duration))) {
                session.elapsedByExam[examId] = Math.max(0, Number(data.duration));
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
                return true;
            }

            session.currentIndex = currentIndex + 1;
            session.pendingAdvance = null;
            this._mirrorSessionToStorage(session);

            // Last passage 鈫?finalize the entire simulation
            if (session.currentIndex >= session.sequence.length) {
                await this.finalizeSuiteRecord(session);
                return true;
            }

            // Not last 鈫?advance to next passage
            if (typeof this.cleanupExamSession === 'function') {
                try {
                    await this.cleanupExamSession(examId);
                } catch (cleanupError) {
                    console.warn('[SuitePractice] 娓呯悊涓婁竴绡囦細璇濆け璐?', cleanupError);
                }
            }

            return this._advanceSuiteToNext(session, sequenceEntry.exam.title, examId);
        },

        async continueSuitePractice() {
            // Legacy stub 鈥?simulation mode auto-advances, but kept for backward compat
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') {
                return false;
            }
            if (!(session.currentIndex < session.sequence.length)) {
                return false;
            }
            return this._advanceSuiteToNext(session, 'previous section', null);
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

        _buildSuiteReplayEntry(session, examId) {
            if (!session || !Array.isArray(session.results)) {
                return null;
            }
            const result = session.results.find(item => item && item.examId === examId);
            if (!result) {
                return null;
            }

            const answerComparison = result.answerComparison && typeof result.answerComparison === 'object'
                ? result.answerComparison
                : {};
            const answers = result.answers && typeof result.answers === 'object'
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

            return {
                examId: result.examId,
                title: result.title,
                answers: filteredAnswers,
                answerComparison: filteredComparison,
                scoreInfo: result.scoreInfo || {},
                markedQuestions: Array.isArray(result.markedQuestions) ? result.markedQuestions.slice() : []
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
                canNext: sequenceIndex < session.sequence.length - 1 || allowFinalizeFromNav,
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
                const shouldReplay = contextPayload.viewMode === 'review';
                if (shouldReplay && replayEntry) {
                    resolvedWindow.postMessage({
                        type: 'REPLAY_PRACTICE_RECORD',
                        data: {
                            suiteSessionId: session.id,
                            readOnly: true,
                            markedQuestions: Array.isArray(replayEntry.markedQuestions) ? replayEntry.markedQuestions : [],
                            entry: replayEntry
                        }
                    }, '*');
                }
                resolvedWindow.postMessage({ type: 'REVIEW_CONTEXT', data: contextPayload }, '*');
                return true;
            } catch (error) {
                console.warn('[SuitePractice] 鍙戦€佸棰樺洖鐪嬩笂涓嬫枃澶辫触:', error);
                return false;
            }
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
            const requestedFinalizeOnNext = Boolean(
                direction === 'next'
                && currentIndex === session.sequence.length - 1
                && data
                && data.finalizeOnNext === true
                && hasCurrentResult
            );
            if (requestedFinalizeOnNext) {
                session.pendingAdvance = null;
                await this.finalizeSuiteRecord(session);
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
                    await this.finalizeSuiteRecord(session);
                    return true;
                }
                return true;
            }

            const targetEntry = session.sequence[targetIndex];
            if (!targetEntry || !targetEntry.examId) {
                return false;
            }

            let targetWindow = sourceWindow && !sourceWindow.closed ? sourceWindow : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);

            if (targetEntry.examId !== examId || !targetWindow) {
                targetWindow = await this.openExam(targetEntry.examId, {
                    target: 'tab',
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    sequenceIndex: targetIndex,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: targetWindow || undefined
                });
            }

            if (!targetWindow || targetWindow.closed) {
                return false;
            }

            session.windowRef = targetWindow;
            session.activeExamId = targetEntry.examId;
            this._focusSuiteWindow(targetWindow);
            await this._sendSuiteReviewState(session, targetEntry.examId, targetWindow);
            return true;
        },

        async _advanceSuiteToNext(session, completedTitle, skipExamIdForAbort) {
            if (typeof this.openExam !== 'function') {
                window.showMessage && window.showMessage('Unable to continue suite practice. Falling back to normal mode.', 'warning');
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
                    sequenceIndex: session.currentIndex,
                    sequenceTotal: session.sequence.length
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
                    console.warn('[SuitePractice] 濂楅涓嬩竴绡囨墦寮€澶辫触:', error);
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
                    console.warn('[SuitePractice] 濂楅鏃犳硶鎵撳紑涓嬩竴绡?', openError);
                }
                window.showMessage && window.showMessage('Unable to continue suite practice. Falling back to normal mode.', 'warning');
                await this._abortSuiteSession(session, { reason: 'open_next_failed', skipExamId: skipExamIdForAbort || null });
                return false;
            }

            session.windowRef = nextWindow;
            this._ensureSuiteWindowGuard(session, session.windowRef);
            this._focusSuiteWindow(session.windowRef);
            this._mirrorSessionToStorage(session);
            this._sendSimulationContext(session, nextEntry.examId, session.windowRef);
            window.showMessage && window.showMessage('Completed ' + (completedTitle || 'previous section') + ', continuing to ' + nextEntry.exam.title + '.', 'success');
            return true;
        },

        _mirrorSessionToStorage(session) {
            if (!session) return;
            try {
                const snapshot = {
                    id: session.id,
                    sequence: session.sequence,
                    currentIndex: session.currentIndex,
                    draftsByExam: session.draftsByExam || {},
                    elapsedByExam: session.elapsedByExam || {},
                    globalTimerAnchorMs: session.globalTimerAnchorMs,
                    flowMode: session.flowMode || 'simulation',
                    autoAdvanceAfterSubmit: typeof session.autoAdvanceAfterSubmit === 'boolean'
                        ? session.autoAdvanceAfterSubmit
                        : true,
                    results: (session.results || []).map(r => ({
                        examId: r.examId, title: r.title, category: r.category,
                        duration: r.duration, scoreInfo: r.scoreInfo,
                        answers: r.answers, answerComparison: r.answerComparison
                    })),
                    startTime: session.startTime,
                    activeExamId: session.activeExamId
                };
                if (global.sessionStorage) {
                    global.sessionStorage.setItem('ielts_sim_session', JSON.stringify(snapshot));
                }
            } catch (_) { /* file:// may not support */ }
        },

        _restoreSessionFromStorage() {
            try {
                if (!global.sessionStorage) return null;
                const raw = global.sessionStorage.getItem('ielts_sim_session');
                if (!raw) return null;
                const snapshot = JSON.parse(raw);
                if (!snapshot || !snapshot.id || !Array.isArray(snapshot.sequence)) return null;
                return snapshot;
            } catch (_) { return null; }
        },

        _clearSessionStorage() {
            try {
                if (global.sessionStorage) {
                    global.sessionStorage.removeItem('ielts_sim_session');
                }
            } catch (_) { /* ignore */ }
        },

        _sendSimulationContext(session, examId, targetWindow) {
            if (!session || !examId || !targetWindow || targetWindow.closed) return false;
            if (session.flowMode !== 'simulation') return false;
            const idx = session.sequence.findIndex(e => e && e.examId === examId);
            if (idx < 0) return false;
            const draft = session.draftsByExam && session.draftsByExam[examId] || null;
            const elapsed = Number.isFinite(Number(session.elapsedByExam && session.elapsedByExam[examId]))
                ? Math.max(0, Number(session.elapsedByExam[examId]))
                : 0;
            const payload = {
                type: 'SIMULATION_CONTEXT',
                data: {
                    suiteSessionId: session.id,
                    flowMode: session.flowMode || 'simulation',
                    examId,
                    currentIndex: idx,
                    total: session.sequence.length,
                    isLast: idx === session.sequence.length - 1,
                    canPrev: idx > 0,
                    canNext: idx < session.sequence.length - 1,
                    draft,
                    elapsed,
                    globalTimerAnchorMs: session.globalTimerAnchorMs
                }
            };
            try {
                targetWindow.postMessage(payload, '*');
                return true;
            } catch (e) {
                console.warn('[SuitePractice] 鍙戦€佹ā鎷熶笂涓嬫枃澶辫触:', e);
                return false;
            }
        },

        async _handleSimulationNavigate(examId, data, sourceWindow) {
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') return false;
            if (session.flowMode !== 'simulation') return false;
            if (session.simulationNavigateLocked === true) return false;
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
            session.simulationNavigateLocked = true;
            try {

                // Save current draft before switching
                if (data && data.draft) {
                    session.draftsByExam[normalizedExamId] = data.draft;
                }
                if (data && typeof data.elapsed === 'number') {
                    session.elapsedByExam[normalizedExamId] = data.elapsed;
                }
                const currentEntry = session.sequence.find(e => e && e.examId === normalizedExamId);
                if (currentEntry && data && data.resultSnapshot) {
                    const snapshot = {
                        ...data.resultSnapshot,
                        duration: Number.isFinite(Number(data.elapsed)) ? Number(data.elapsed) : data.resultSnapshot.duration
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
                    target: 'tab',
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    sequenceIndex: targetIdx,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: sourceWindow && !sourceWindow.closed ? sourceWindow : undefined
                });

                if (!targetWindow || targetWindow.closed) return false;

                session.windowRef = targetWindow;
                this._mirrorSessionToStorage(session);
                this._sendSimulationContext(session, targetEntry.examId, targetWindow);
                this._focusSuiteWindow(targetWindow);
                return true;
            } finally {
                session.simulationNavigateLocked = false;
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
            if (session.flowMode !== 'simulation') {
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
            if (!pageType.includes('unified-reading')) {
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
            const windowExamId = resolveWindowExamId(targetWindow);
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
            return this._sendSimulationContext(session, examId, targetWindow);
        },

        /**
         * 澶勭悊澶氬棰樼粌涔犲畬鎴愶紙鐢ㄤ簬100 P1/P4绛夊寘鍚濂楅鐨凥TML椤甸潰锛?
         * @param {string} examId - 鑰冭瘯ID锛堝彲鑳藉寘鍚棰樺悗缂€锛?
         * @param {object} suiteData - 濂楅鏁版嵁
         * @returns {boolean} 鏄惁鎴愬姛澶勭悊
         */
        async handleMultiSuitePracticeComplete(examId, suiteData) {
            if (!suiteData || !suiteData.suiteId) {
                console.warn('[MultiSuite] 缂哄皯suiteId锛屾棤娉曞鐞嗗濂楅瀹屾垚');
                return false;
            }

            console.log('[MultiSuite] 澶勭悊濂楅瀹屾垚:', examId, '濂楅ID:', suiteData.suiteId);

            // 鑾峰彇鎴栧垱寤哄濂楅浼氳瘽
            const session = this.getOrCreateMultiSuiteSession(examId);

            // 妫€鏌ユ槸鍚﹀凡缁忚褰曡繃杩欎釜濂楅
            const alreadyRecorded = session.suiteResults.some(
                result => result.suiteId === suiteData.suiteId
            );

            if (alreadyRecorded) {
                console.warn('[MultiSuite] 濂楅宸茶褰曪紝璺宠繃:', suiteData.suiteId);
                return true;
            }

            // 娣诲姞濂楅缁撴灉鍒颁細璇?
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

            // 濡傛灉杩欐槸绗竴涓棰橈紝灏濊瘯浠庢暟鎹腑纭畾棰勬湡濂楅鏁伴噺
            if (session.suiteResults.length === 1 && !session.expectedSuiteCount) {
                session.expectedSuiteCount = this._detectExpectedSuiteCount(examId, suiteData);
                console.log('[MultiSuite] 妫€娴嬪埌棰勬湡濂楅鏁伴噺:', session.expectedSuiteCount);
            }

            // 妫€鏌ユ槸鍚︽墍鏈夊棰橀兘宸插畬鎴?
            if (this.isMultiSuiteComplete(session)) {
                console.log('[MultiSuite] all suite entries completed, finalizing consolidated record.');
                await this.finalizeMultiSuiteRecord(session);
                return true;
            }

            // 杩樻湁濂楅鏈畬鎴愶紝淇濆瓨褰撳墠杩涘害
            console.log('[MultiSuite] waiting for more suite entries... completed ' + session.suiteResults.length + '/' + (session.expectedSuiteCount || '?'));


            return true;
        },

        /**
         * 妫€娴嬮鏈熺殑濂楅鏁伴噺
         * @param {string} examId - 鑰冭瘯ID
         * @param {object} suiteData - 濂楅鏁版嵁
         * @returns {number} 棰勬湡濂楅鏁伴噺
         */
        _detectExpectedSuiteCount(examId, suiteData) {
            // 灏濊瘯浠巗uiteData涓幏鍙栨€诲棰樻暟
            if (suiteData.totalSuites && Number.isFinite(suiteData.totalSuites)) {
                return suiteData.totalSuites;
            }

            // 灏濊瘯浠巑etadata涓幏鍙?
            if (suiteData.metadata && suiteData.metadata.totalSuites) {
                const count = Number(suiteData.metadata.totalSuites);
                if (Number.isFinite(count) && count > 0) {
                    return count;
                }
            }

            // 鏍规嵁examId鎺ㄦ柇锛?00 P1/P4 閫氬父鍖呭惈10濂楅锛?
            const lowerExamId = (examId || '').toLowerCase();
            if (lowerExamId.includes('100') && (lowerExamId.includes('p1') || lowerExamId.includes('p4'))) {
                return 10; // 榛樿10濂楅
            }

            // 榛樿杩斿洖1锛堝崟濂楅锛?
            return 1;
        },

        /**
         * 瀹屾垚骞惰仛鍚堝濂楅璁板綍
         * @param {object} session - 澶氬棰樹細璇?
         */
        async finalizeMultiSuiteRecord(session) {
            if (!session || !Array.isArray(session.suiteResults) || session.suiteResults.length === 0) {
                console.warn('[MultiSuite] 鏃犳晥鐨勪細璇濇垨鏃犵粨鏋滐紝璺宠繃鑱氬悎');
                return;
            }

            session.status = 'finalizing';
            console.log('[MultiSuite] 寮€濮嬭仛鍚堝濂楅璁板綍:', session.id);

            try {
                const completionTime = Date.now();
                const startTime = session.startTime || completionTime;

                // 鑱氬悎鍒嗘暟
                const aggregatedScores = this.aggregateScores(session.suiteResults);

                // 鑱氬悎绛旀
                const aggregatedAnswers = this.aggregateAnswers(session.suiteResults);

                // 鑱氬悎绛旀姣旇緝
                const aggregatedComparison = this.aggregateAnswerComparisons(session.suiteResults);

                // 鑱氬悎鎷煎啓閿欒
                const aggregatedSpellingErrors = this.aggregateSpellingErrors(session.suiteResults);

                // 璁＄畻鎬绘椂闀?
                const totalDuration = session.suiteResults.reduce(
                    (sum, result) => sum + (result.duration || 0), 
                    0
                );

                // 鐢熸垚璁板綍鏍囬
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const source = session.metadata?.source || 'listening';
                const sourceLabel = source.toUpperCase();
                const displayTitle = dateLabel + ' ' + sourceLabel + ' multi-suite practice';

                // 鏋勫缓鑱氬悎璁板綍
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
                    
                    // 鑱氬悎鐨勫垎鏁颁俊鎭?
                    scoreInfo: aggregatedScores,
                    totalQuestions: aggregatedScores.total,
                    correctAnswers: aggregatedScores.correct,
                    accuracy: aggregatedScores.accuracy,
                    percentage: aggregatedScores.percentage,
                    
                    // 鑱氬悎鐨勭瓟妗堟暟鎹?
                    answers: aggregatedAnswers,
                    answerComparison: aggregatedComparison,
                    
                    // 濂楅璇︽儏
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
                    
                    // 鎷煎啓閿欒姹囨€?
                    spellingErrors: aggregatedSpellingErrors,
                    
                    // 鍏冩暟鎹?
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

                // 淇濆瓨鑱氬悎璁板綍
                await this._saveSuitePracticeRecord(record);

                // 淇濆瓨鎷煎啓閿欒鍒拌瘝琛?
                if (aggregatedSpellingErrors.length > 0 && window.spellingErrorCollector) {
                    try {
                        await window.spellingErrorCollector.saveErrors(aggregatedSpellingErrors);
                        console.log('[MultiSuite] 宸蹭繚瀛樻嫾鍐欓敊璇埌璇嶈〃:', aggregatedSpellingErrors.length);
                    } catch (error) {
                        console.warn('[MultiSuite] 淇濆瓨鎷煎啓閿欒澶辫触:', error);
                    }
                }

                // 鏇存柊鐘舵€?
                await this._updatePracticeRecordsState();
                this.refreshOverviewData && this.refreshOverviewData();

                // 娓呯悊浼氳瘽
                this.multiSuiteSessionsMap.delete(session.baseExamId);
                session.status = 'completed';

                window.showMessage && window.showMessage('Multi-suite practice completed. Saved ' + session.suiteResults.length + ' suite records.', 'success');




                console.log('[MultiSuite] consolidated record saved:', record.id);

            } catch (error) {
                console.error('[MultiSuite] 鑱氬悎璁板綍澶辫触:', error);
                session.status = 'error';
                window.showMessage && window.showMessage('Failed to save multi-suite record. Please try again later.', 'error');
            }
        },

        /**
         * 鑱氬悎澶氬棰樼殑鍒嗘暟
         * @param {Array} suiteResults - 濂楅缁撴灉鏁扮粍
         * @returns {object} 鑱氬悎鐨勫垎鏁颁俊鎭?
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
         * 鑱氬悎澶氬棰樼殑绛旀
         * @param {Array} suiteResults - 濂楅缁撴灉鏁扮粍
         * @returns {object} 鑱氬悎鐨勭瓟妗堝璞?
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
         * 鑱氬悎澶氬棰樼殑绛旀姣旇緝
         * @param {Array} suiteResults - 濂楅缁撴灉鏁扮粍
         * @returns {object} 鑱氬悎鐨勭瓟妗堟瘮杈冨璞?
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
         * 鑱氬悎澶氬棰樼殑鎷煎啓閿欒
         * @param {Array} suiteResults - 濂楅缁撴灉鏁扮粍
         * @returns {Array} 鑱氬悎鐨勬嫾鍐欓敊璇暟缁?
         */
        aggregateSpellingErrors(suiteResults) {
            const aggregated = [];
            const errorMap = new Map(); // 鐢ㄤ簬鍘婚噸鍜屽悎骞剁浉鍚屽崟璇嶇殑閿欒

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
                        // 鏇存柊宸插瓨鍦ㄧ殑閿欒璁板綍
                        const existing = errorMap.get(key);
                        existing.errorCount = (existing.errorCount || 1) + 1;
                        existing.timestamp = Math.max(existing.timestamp || 0, error.timestamp || 0);
                        
                        // 淇濈暀鏈€鏂扮殑鐢ㄦ埛杈撳叆
                        if (error.timestamp > (existing.timestamp || 0)) {
                            existing.userInput = error.userInput;
                        }
                    } else {
                        // 娣诲姞鏂扮殑閿欒璁板綍
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

            // 杞崲涓烘暟缁?
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
                    markedQuestions: Array.isArray(entry.markedQuestions) ? entry.markedQuestions.slice() : [],
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
                const displayTitle = dateLabel + ' suite practice ' + suiteSequence;

                const record = {
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
                        category: '濂楅缁冧範',
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
                window.showMessage && window.showMessage('Suite practice completed. Record saved.', 'success');
                session.status = 'completed';
            } catch (error) {
                console.error('[SuitePractice] 淇濆瓨濂楅璁板綍澶辫触:', error);
                window.showMessage && window.showMessage('Failed to save suite record. The system will try to restore normal mode.', 'error');
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
                    console.warn('[SuitePractice] Failed to load exam index, falling back to the default bank.', error);
                    list = await storage.get('exam_index', []);
                }
            }

            return Array.isArray(list) ? list.filter(Boolean) : [];
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
                    window.showMessage && window.showMessage('Current exam library is missing ' + category + ' reading questions. Unable to start custom selection.', 'warning');
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
                    ? '椹昏冻妯″紡'
                    : (flowMode === 'simulation' ? '妯℃嫙妯″紡' : '缁忓吀妯″紡')
            );

            try {
                if (this.currentSuiteSession && this.currentSuiteSession.status === 'active') {
                    window.showMessage && window.showMessage('濂楅缁冧範姝ｅ湪杩涜涓紝璇峰厛瀹屾垚褰撳墠濂楅銆?', 'warning');
                    return false;
                }

                if (typeof this.openExam !== 'function') {
                    window.showMessage && window.showMessage('褰撳墠鐗堟湰鏆備笉鏀寔濂楅缁冧範鑷姩鎵撳紑棰樼洰銆?', 'error');
                    return false;
                }

                const normalizedSequence = Array.isArray(sequence)
                    ? sequence.filter(item => item && item.examId && item.exam)
                    : [];
                if (!normalizedSequence.length) {
                    window.showMessage && window.showMessage('鏈壘鍒板彲鐢ㄧ殑濂楅棰樼洰銆?', 'warning');
                    return false;
                }

                this._clearSuiteHandshakes();

                const suiteSessionId = this._generateSuiteSessionId();
                const lockedAutoAdvance = flowMode === 'stationary'
                    ? false
                    : true;
                const session = {
                    id: suiteSessionId,
                    status: 'initializing',
                    startTime: Date.now(),
                    sequence: normalizedSequence,
                    currentIndex: 0,
                    results: [],
                    draftsByExam: {},
                    elapsedByExam: {},
                    globalTimerAnchorMs: Date.now(),
                    flowMode,
                    frequencyScope,
                    autoAdvanceAfterSubmit: lockedAutoAdvance,
                    windowRef: null,
                    windowName: suiteWindowName
                };

                this.currentSuiteSession = session;
                this._registerSuiteSequence(session);

                const firstEntry = normalizedSequence[0];
                window.showMessage && window.showMessage(launchLabel + ' 已启动，正在打开第一篇。', 'info');

                let examWindow = null;
                try {
                    examWindow = await this.openExam(firstEntry.examId, {
                        target: 'tab',
                        windowName: suiteWindowName,
                        suiteSessionId,
                        suiteFlowMode: flowMode,
                        sequenceIndex: 0,
                        sequenceTotal: normalizedSequence.length
                    });
                } catch (openError) {
                    console.error('[SuitePractice] 鎵撳紑棣栫瘒澶辫触:', openError);
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
                return true;
            } catch (error) {
                console.error('[SuitePractice] 鍚姩澶辫触:', error);
                window.showMessage && window.showMessage('濂楅缁冧範鍚姩澶辫触锛岃绋嶅悗閲嶈瘯銆?', 'error');
                if (this.currentSuiteSession) {
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
                markedQuestions: Array.isArray(rawData?.metadata?.markedQuestions)
                    ? rawData.metadata.markedQuestions.slice()
                    : (Array.isArray(rawData?.markedQuestions) ? rawData.markedQuestions.slice() : []),
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
                        console.warn('[SuitePractice] 娓呯悊濂楅瀛愯褰曞け璐?', error);
                    });
                    return;
                } catch (error) {
                    console.warn('[SuitePractice] PracticeRecorder 淇濆瓨濂楅璁板綍澶辫触锛屾敼鐢ㄩ檷绾у瓨鍌?', error);
                }
            }

            await this._saveSuitePracticeRecordFallback(record);
        },

        async _saveSuitePracticeRecordFallback(record) {
            if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.savePracticeRecord === 'function') {
                await window.PracticeCore.store.savePracticeRecord(record);
            } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.addPracticeRecord === 'function') {
                await window.simpleStorageWrapper.addPracticeRecord(record);
            } else {
                let practiceRecords = await storage.get('practice_records', []);
                if (!Array.isArray(practiceRecords)) {
                    practiceRecords = [];
                }

                practiceRecords.unshift(record);
                if (practiceRecords.length > MAX_LEGACY_PRACTICE_RECORDS) {
                    practiceRecords.splice(MAX_LEGACY_PRACTICE_RECORDS);
                }

                const practiceKey = ['practice', 'records'].join('_');
                await storage.set(practiceKey, practiceRecords);
            }
            await this._cleanupSuiteEntryRecords(record).catch(error => {
                console.warn('[SuitePractice] 娓呯悊濂楅瀛愯褰曞け璐?', error);
            });
        },

        async _cleanupSuiteEntryRecords(record) {
            if (!record || !Array.isArray(record.suiteEntries) || record.suiteEntries.length === 0) {
                return;
            }

            let practiceRecords = window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.listPracticeRecords === 'function'
                ? await window.PracticeCore.store.listPracticeRecords()
                : await storage.get('practice_records', []);
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
            const tolerance = 10 * 60 * 1000; // 10鍒嗛挓

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
                    return true; // 淇濈暀鑱氬悎璁板綍
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
                if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.replacePracticeRecords === 'function') {
                    await window.PracticeCore.store.replacePracticeRecords(practiceRecords);
                } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.savePracticeRecords === 'function') {
                    await window.simpleStorageWrapper.savePracticeRecords(practiceRecords);
                } else {
                    const practiceKey = ['practice', 'records'].join('_');
                    await storage.set(practiceKey, practiceRecords);
                }
                console.log('[SuitePractice] cleared ' + (before - practiceRecords.length) + ' suite child records');
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
                console.warn('[SuitePractice] 鍚屾缁冧範璁板綍澶辫触:', error);
            }

            try {
                if (typeof window.updatePracticeView === 'function') {
                    window.updatePracticeView();
                }
            } catch (error) {
                console.warn('[SuitePractice] 鍒锋柊缁冧範瑙嗗浘澶辫触:', error);
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

            const normalizeList = list => (Array.isArray(list) ? list : []);

            const collectRecords = async () => {
                if (this.components && this.components.practiceRecorder && typeof this.components.practiceRecorder.getPracticeRecords === 'function') {
                    try {
                        const records = await this.components.practiceRecorder.getPracticeRecords();
                        return normalizeList(records);
                    } catch (error) {
                        console.warn('[SuitePractice] 璇诲彇PracticeRecorder璁板綍澶辫触锛屽皾璇曚娇鐢ㄥ瓨鍌ㄩ檷绾?', error);
                    }
                }

                if (typeof storage?.get === 'function') {
                    try {
                        const fallbackRecords = await storage.get('practice_records', []);
                        return normalizeList(fallbackRecords);
                    } catch (error) {
                        console.warn('[SuitePractice] 璇诲彇practice_records澶辫触:', error);
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
                    console.error('[SuitePractice] 淇濆瓨鍗曠瘒璁板綍澶辫触:', error);
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
                console.warn('[SuitePractice] 鍏抽棴濂楅绐楀彛琚嫤鎴?', error);
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
                    console.warn('[SuitePractice] 鏃犳硶閫氱煡濂楅绐楀彛鍏抽棴:', forceCloseError);
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
                        console.error('[SuitePractice] 濂楅涓柇鏃朵繚瀛樿褰曞け璐?', error);
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
                console.warn('[SuitePractice] 鏃犳硶閲嶅缓濂楅鏍囩:', error);
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
                console.warn('[SuitePractice] 瀹夎濂楅绐楀彛闃叉姢澶辫触:', error);
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
         * 鑾峰彇鎴栧垱寤哄濂楅浼氳瘽
         * @param {string} examId - 鑰冭瘯ID锛堝熀纭€ID锛屼笉鍚棰樺悗缂€锛?
         * @returns {object} 澶氬棰樹細璇濆璞?
         */
        getOrCreateMultiSuiteSession(examId) {
            if (!this.multiSuiteSessionsMap) {
                this.multiSuiteSessionsMap = new Map();
            }

            // 鎻愬彇鍩虹examId锛堢Щ闄ゅ彲鑳界殑濂楅鍚庣紑濡?_set1, _suite1 绛夛級
            const baseExamId = this._extractBaseExamId(examId);

            if (this.multiSuiteSessionsMap.has(baseExamId)) {
                return this.multiSuiteSessionsMap.get(baseExamId);
            }

            // 鍒涘缓鏂扮殑澶氬棰樹細璇?
            const session = {
                id: this._generateMultiSuiteSessionId(baseExamId),
                baseExamId: baseExamId,
                status: 'active',
                startTime: Date.now(),
                suiteResults: [],
                expectedSuiteCount: null, // 灏嗗湪绗竴娆℃彁浜ゆ椂纭畾
                metadata: {
                    source: this._detectMultiSuiteSource(baseExamId),
                    createdAt: new Date().toISOString()
                }
            };

            this.multiSuiteSessionsMap.set(baseExamId, session);
            console.log('[MultiSuite] 鍒涘缓鏂颁細璇?', session.id, '鍩虹ID:', baseExamId);

            return session;
        },

        /**
         * 妫€鏌ュ濂楅鏄惁鍏ㄩ儴瀹屾垚
         * @param {object} session - 澶氬棰樹細璇濆璞?
         * @returns {boolean} 鏄惁鎵€鏈夊棰橀兘宸插畬鎴?
         */
        isMultiSuiteComplete(session) {
            if (!session || !Array.isArray(session.suiteResults)) {
                return false;
            }

            // 濡傛灉杩樻病鏈夌‘瀹氶鏈熷棰樻暟閲忥紝鍒欐湭瀹屾垚
            if (!session.expectedSuiteCount || session.expectedSuiteCount <= 0) {
                return false;
            }

            // 妫€鏌ュ凡瀹屾垚鐨勫棰樻暟閲忔槸鍚﹁揪鍒伴鏈?
            const completedCount = session.suiteResults.length;
            const isComplete = completedCount >= session.expectedSuiteCount;

            if (isComplete) {

                console.log('[MultiSuite] session completed:', session.id, 'completed ' + completedCount + '/' + session.expectedSuiteCount + ' suite(s)');
            }

            return isComplete;
        },

        /**
         * 鎻愬彇鍩虹examId锛堢Щ闄ゅ棰樺悗缂€锛?
         * @param {string} examId - 瀹屾暣鐨別xamId
         * @returns {string} 鍩虹examId
         */
        _extractBaseExamId(examId) {
            if (!examId || typeof examId !== 'string') {
                return examId;
            }

            // 绉婚櫎甯歌鐨勫棰樺悗缂€妯″紡锛歘set1, _suite1, _s1, ::set1 绛?
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
         * 鐢熸垚澶氬棰樹細璇滻D
         * @param {string} baseExamId - 鍩虹examId
         * @returns {string} 浼氳瘽ID
         */
        _generateMultiSuiteSessionId(baseExamId) {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(16).slice(2, 8);
            const prefix = baseExamId ? baseExamId + '_' : '';
            return 'multi_' + prefix + timestamp + '_' + random;
        },

        /**
         * 妫€娴嬪濂楅鏉ユ簮锛圥1/P4绛夛級
         * @param {string} examId - 鑰冭瘯ID
         * @returns {string} 鏉ユ簮鏍囪瘑
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






