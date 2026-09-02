(function (global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');
    const PRACTICE_ENHANCER_SCRIPT_PATH = './js/bundles/practice-page-enhancer.bundle.js';
    const LISTENING_RECORD_BRIDGE_SCRIPT_PATH = './js/bundles/listening-record-bridge.bundle.js';
    const PRACTICE_ENHANCER_BUILD_ID = '20250105';

    function getAssetVersion() {
        try {
            const params = new URLSearchParams(global.location?.search || '');
            return String(params.get('v') || '').trim();
        } catch (_) {
            return '';
        }
    }

    async function getActiveExamIndexSnapshot() {
        if (typeof global.resolveActiveLibraryIndex !== 'function') {
            throw new Error('LibraryManager.resolveActiveIndex is unavailable');
        }
        const dataset = await global.resolveActiveLibraryIndex();
        return Array.isArray(dataset) ? dataset.slice() : [];
    }

    async function findExamDefinition(examId) {
        if (!examId) {
            return null;
        }
        const list = await getActiveExamIndexSnapshot();
        const match = list.find(entry => entry && entry.id === examId);
        if (match) {
            return match;
        }

        return null;
    }

    const mixin = {
        _isReadingLibraryExam(exam) {
            if (!exam || typeof exam !== 'object') {
                return false;
            }

            const examType = typeof exam.type === 'string'
                ? exam.type.trim().toLowerCase()
                : '';
            if (examType === 'listening') {
                return false;
            }

            const examId = typeof exam.id === 'string'
                ? exam.id.trim().toLowerCase()
                : '';
            if (examId.startsWith('listening-')) {
                return false;
            }

            return true;
        },

        _isListeningLibraryExam(exam) {
            if (!exam || typeof exam !== 'object') {
                return false;
            }
            const examType = typeof exam.type === 'string'
                ? exam.type.trim().toLowerCase()
                : '';
            if (examType === 'listening') {
                return true;
            }
            const examId = typeof exam.id === 'string'
                ? exam.id.trim().toLowerCase()
                : '';
            if (examId.startsWith('listening-')) {
                return true;
            }
            const path = typeof exam.path === 'string'
                ? exam.path.replace(/\\/g, '/').toLowerCase()
                : '';
            return path.includes('listeningpractice/') || /^p[1-4]\//.test(path);
        },

        _normalizeCompletionQuestionKey(rawKey, fallbackIndex = 0) {
            const raw = String(rawKey ?? '').replace(/\s+/g, ' ').trim();
            const fallback = `q${Number(fallbackIndex) + 1}`;
            if (!raw) {
                return fallback;
            }
            const cleaned = raw.replace(/^questions?\s*/i, '').replace(/^q\s*/i, '');
            const match = cleaned.match(/(\d{1,3})(?:\s*[-–—_]\s*(\d{1,3}))?/);
            if (match) {
                return match[2] ? `q${match[1]}-${match[2]}` : `q${match[1]}`;
            }
            return /^q/i.test(cleaned) ? cleaned.replace(/^Q/, 'q') : `q${cleaned}`;
        },

        _normalizeCompletionAnswerValue(value) {
            if (value === null || value === undefined) {
                return '';
            }
            if (Array.isArray(value)) {
                return value.map((item) => this._normalizeCompletionAnswerValue(item)).filter(Boolean).join(', ');
            }
            return String(value).replace(/\s+/g, ' ').trim();
        },

        _normalizeCompletionAcceptedAnswers(value) {
            const values = Array.isArray(value) ? value : [];
            const normalized = [];
            values.forEach((item) => {
                const text = this._normalizeCompletionAnswerValue(item);
                if (!text) {
                    return;
                }
                if (!normalized.some(existing => existing.toLowerCase() === text.toLowerCase())) {
                    normalized.push(text);
                }
            });
            return normalized;
        },

        _buildCompletionComparisonFromDetails(details) {
            if (!details || typeof details !== 'object') {
                return {};
            }

            const entries = Array.isArray(details)
                ? details.map((detail, index) => [index, detail])
                : Object.entries(details);
            const comparison = {};

            entries.forEach(([rawKey, detail], index) => {
                if (!detail || typeof detail !== 'object') {
                    return;
                }
                const questionId = this._normalizeCompletionQuestionKey(
                    detail.questionId ?? detail.question ?? detail.id ?? rawKey,
                    index
                );
                const userAnswer = this._normalizeCompletionAnswerValue(
                    detail.userAnswer ?? detail.user ?? detail.answer ?? detail.value
                );
                const correctAnswer = this._normalizeCompletionAnswerValue(
                    detail.correctAnswer ?? detail.correct ?? detail.expected ?? detail.answerKey
                );
                if (!userAnswer && !correctAnswer) {
                    return;
                }
                const acceptedAnswers = this._normalizeCompletionAcceptedAnswers(detail.acceptedAnswers);
                const canonicalAnswer = this._normalizeCompletionAnswerValue(detail.canonicalAnswer)
                    || acceptedAnswers[0]
                    || correctAnswer;
                comparison[questionId] = {
                    questionId,
                    userAnswer,
                    correctAnswer,
                    acceptedAnswers: acceptedAnswers.length ? acceptedAnswers : undefined,
                    canonicalAnswer,
                    isCorrect: typeof detail.isCorrect === 'boolean' ? detail.isCorrect : null
                };
            });

            return comparison;
        },

        _resolveCompletionAnswerComparison(data) {
            if (!data || typeof data !== 'object') {
                return null;
            }

            const direct = data.answerComparison || data.realData?.answerComparison;
            if (direct && typeof direct === 'object' && Object.keys(direct).length > 0) {
                return direct;
            }

            const detailSources = [
                data.answerDetails,
                data.details,
                data.scoreInfo?.details,
                data.realData?.scoreInfo?.details
            ];
            for (const details of detailSources) {
                const comparison = this._buildCompletionComparisonFromDetails(details);
                if (Object.keys(comparison).length > 0) {
                    data.answerComparison = comparison;
                    if (data.realData && typeof data.realData === 'object') {
                        data.realData.answerComparison = comparison;
                    }
                    return comparison;
                }
            }

            return null;
        },

        _getUnifiedReadingManifestEntry(exam) {
            if (!this._isReadingLibraryExam(exam) || !exam.id) {
                return null;
            }
            const manifest = (typeof window !== 'undefined' && window.__READING_EXAM_MANIFEST__)
                ? window.__READING_EXAM_MANIFEST__
                : null;
            const manifestEntry = manifest && exam.id ? manifest[exam.id] : null;
            if (!manifestEntry || !manifestEntry.script || !(manifestEntry.dataKey || manifestEntry.examId)) {
                return null;
            }
            return manifestEntry;
        },

        _isUnifiedReadingExam(exam) {
            return !!this._getUnifiedReadingManifestEntry(exam);
        },

        _buildUnifiedReadingUrl(exam, options = {}) {
            const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
            if (!manifestEntry) {
                return '';
            }
            const params = new URLSearchParams();
            if (exam && exam.id) {
                params.set('examId', String(exam.id));
            }
            const resolvedDataKey = manifestEntry.dataKey || manifestEntry.examId || exam?.id;
            if (resolvedDataKey) {
                params.set('dataKey', String(resolvedDataKey));
            }
            const practiceMode = options && typeof options.practiceMode === 'string'
                ? options.practiceMode.trim().toLowerCase()
                : '';
            if (practiceMode === 'memorize') {
                params.set('practiceMode', 'memorize');
                params.set('mode', 'memorize');
            }
            const assetVersion = getAssetVersion();
            if (assetVersion) {
                params.set('v', assetVersion);
            }
            const query = params.toString();
            const url = query
                ? `assets/generated/reading-exams/reading-practice-unified.html?${query}`
                : 'assets/generated/reading-exams/reading-practice-unified.html';
            return typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(url)
                : url;
        },

        _buildUnifiedListeningUrl(exam) {
            if (!this._isListeningLibraryExam(exam) || !exam || !exam.id) {
                return '';
            }
            const currentProtocol = (typeof window !== 'undefined' && window.location && window.location.protocol)
                ? String(window.location.protocol).toLowerCase()
                : '';
            if (currentProtocol !== 'http:' && currentProtocol !== 'https:') {
                return '';
            }
            const sourceUrl = (typeof window.buildResourcePath === 'function')
                ? window.buildResourcePath(exam, 'html')
                : ((exam.path || '').replace(/\\/g, '/').replace(/\/+\//g, '/') + (exam.filename || ''));
            const resolvedSourceUrl = typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(sourceUrl)
                : sourceUrl;
            if (!resolvedSourceUrl) {
                return '';
            }
            const params = new URLSearchParams();
            params.set('examId', String(exam.id));
            params.set('sourceUrl', resolvedSourceUrl);
            const assetVersion = getAssetVersion();
            if (assetVersion) {
                params.set('v', assetVersion);
            }
            const url = `assets/generated/listening-exams/listening-practice-unified.html?${params.toString()}`;
            return typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(url)
                : url;
        },

        _buildReadingPdfUrl(exam) {
            if (!this._isReadingLibraryExam(exam) || !exam || !exam.pdfFilename) {
                return '';
            }

            const pdfUrl = (typeof window.buildResourcePath === 'function')
                ? window.buildResourcePath(exam, 'pdf')
                : ((exam.path || '').replace(/\\/g, '/').replace(/\/+\//g, '/') + (exam.pdfFilename || ''));

            return typeof this._ensureAbsoluteUrl === 'function'
                ? this._ensureAbsoluteUrl(pdfUrl)
                : pdfUrl;
        },

        resolveReadingLaunchDescriptor(exam, options = {}) {
            if (!this._isReadingLibraryExam(exam)) {
                return null;
            }

            const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
            if (manifestEntry) {
                return {
                    mode: 'unified_html',
                    examId: exam.id,
                    dataKey: manifestEntry.dataKey || manifestEntry.examId || exam.id,
                    manifestEntry,
                    url: this._buildUnifiedReadingUrl(exam, options)
                };
            }

            const pdfUrl = this._buildReadingPdfUrl(exam);
            if (!pdfUrl) {
                return null;
            }

            return {
                mode: 'pdf_manual',
                examId: exam.id,
                pdfUrl,
                reviewReason: 'manual_mapping_needed'
            };
        },

        _beginExamOpenGeneration(examId, options = {}) {
            if (!this._examOpenGenerations) this._examOpenGenerations = new Map();
            if (!this._examOpenWindowGenerations) this._examOpenWindowGenerations = new WeakMap();
            this._examOpenGenerationSequence = Math.max(0, Number(this._examOpenGenerationSequence) || 0) + 1;

            const normalizedExamId = String(examId || '').trim();
            const targetNames = [`exam_${normalizedExamId}`, `pdf_${normalizedExamId}`];
            if (typeof options.windowName === 'string') {
                targetNames.push(options.windowName.trim());
            }
            const names = Object.freeze(Array.from(new Set(targetNames.filter(name => name && !name.startsWith('_')))));
            const generation = Object.freeze({
                examId: normalizedExamId,
                sequence: this._examOpenGenerationSequence,
                targetNames: names,
                hasReuseWindow: Boolean(options.reuseWindow)
            });
            this._examOpenGenerations.set(`exam:${normalizedExamId}`, generation);
            names.forEach(name => this._examOpenGenerations.set(`target:${name}`, generation));
            if (options.reuseWindow) {
                this._examOpenWindowGenerations.set(options.reuseWindow, generation);
            }
            return generation;
        },

        _isExamOpenGenerationCurrent(generation, targetWindow = null) {
            if (!generation || !this._examOpenGenerations
                || this._examOpenGenerations.get(`exam:${generation.examId}`) !== generation) {
                return false;
            }
            if (generation.targetNames.some(name => this._examOpenGenerations.get(`target:${name}`) !== generation)) {
                return false;
            }
            if (generation.hasReuseWindow) {
                if (!targetWindow || !this._examOpenWindowGenerations
                    || this._examOpenWindowGenerations.get(targetWindow) !== generation) {
                    return false;
                }
            }
            return true;
        },

        _recordExamWindowNavigation(targetWindow) {
            if (!targetWindow || (typeof targetWindow !== 'object' && typeof targetWindow !== 'function')) {
                return 0;
            }
            if (!this._examWindowNavigationEpochs) this._examWindowNavigationEpochs = new WeakMap();
            const epoch = Math.max(0, Number(this._examWindowNavigationEpochs.get(targetWindow)) || 0) + 1;
            this._examWindowNavigationEpochs.set(targetWindow, epoch);
            return epoch;
        },

        _isExamWindowNavigationCurrent(targetWindow, epoch) {
            return Boolean(targetWindow && epoch && this._examWindowNavigationEpochs
                && this._examWindowNavigationEpochs.get(targetWindow) === epoch);
        },

        _captureExamSessionRegistration(examId, windowInfo = null) {
            const info = windowInfo || (this.examWindows && this.examWindows.get(examId)) || null;
            if (!info || !info.window || !Number.isInteger(info.registrationId)) return null;
            return Object.freeze({
                examId: String(examId || ''),
                window: info.window,
                windowInfo: info,
                registrationId: info.registrationId,
                sessionGeneration: Number(info.sessionGeneration) || 0,
                navigationEpoch: Number(info.navigationEpoch) || 0,
                suiteSessionId: Object.prototype.hasOwnProperty.call(info, 'suiteSessionId')
                    ? (info.suiteSessionId || null)
                    : undefined
            });
        },

        _isExamSessionRegistrationCurrent(examId, registration) {
            const current = this.examWindows && this.examWindows.get(examId);
            return Boolean(
                registration
                && current
                && current === registration.windowInfo
                && current.window === registration.window
                && current.registrationId === registration.registrationId
                && Number(current.sessionGeneration || 0) === Number(registration.sessionGeneration || 0)
            );
        },

        _installExamNavigationRegistration(examId, examWindow, exam, options, generation) {
            if (!examWindow || !this._isExamOpenGenerationCurrent(generation, options.reuseWindow || null)) {
                return null;
            }
            if (!this.examWindows) this.examWindows = new Map();
            const previous = this.examWindows.get(examId) || null;
            if (previous && previous.closeMonitor) {
                try { clearInterval(previous.closeMonitor); } catch (_) {}
            }
            if (this.messageHandlers && this.messageHandlers.has(examId)) {
                try { window.removeEventListener('message', this.messageHandlers.get(examId)); } catch (_) {}
                this.messageHandlers.delete(examId);
            }
            if (this._handshakeTimers && this._handshakeTimers.has(examId)) {
                try { clearInterval(this._handshakeTimers.get(examId)); } catch (_) {}
                this._handshakeTimers.delete(examId);
            }

            const endpoint = this._resolveExamMessageEndpoint(options.expectedUrl || (exam ? this.buildExamUrl(exam) : ''));
            this._examRegistrationSequence = Math.max(0, Number(this._examRegistrationSequence) || 0) + 1;
            const windowInfo = {
                window: examWindow,
                startTime: Date.now(),
                status: 'opening',
                expectedSessionId: this.generateSessionId(examId),
                windowSessionToken: null,
                windowSessionTokenSessionId: null,
                expectedUrl: endpoint.expectedUrl,
                expectedOrigin: endpoint.expectedOrigin,
                allowOpaqueOrigin: endpoint.allowOpaqueOrigin,
                observedOrigin: '',
                suiteSessionId: options.suiteSessionId || null,
                suiteFlowMode: options.suiteFlowMode ? String(options.suiteFlowMode) : null,
                reviewMode: Boolean(options.reviewMode),
                reviewSessionId: options.reviewSessionId ? String(options.reviewSessionId) : null,
                reviewEntryIndex: Number.isInteger(options.reviewEntryIndex) ? options.reviewEntryIndex : 0,
                practiceMode: typeof options.practiceMode === 'string' ? options.practiceMode.trim().toLowerCase() : null,
                readOnly: Object.prototype.hasOwnProperty.call(options, 'readOnly')
                    ? Boolean(options.readOnly)
                    : Boolean(options.reviewMode),
                sessionGeneration: Math.max(0, Number(previous && previous.sessionGeneration) || 0) + 1,
                registrationId: this._examRegistrationSequence,
                navigationEpoch: Number(options.navigationEpoch) || 0,
                launchProvisional: true,
                closeMonitor: null
            };
            this._refreshExamWindowToken(examId, windowInfo);
            this.examWindows.set(examId, windowInfo);
            return this._captureExamSessionRegistration(examId, windowInfo);
        },

        async _abortExamOpen(examId, registration) {
            if (!this._isExamSessionRegistrationCurrent(examId, registration)) return false;
            const targetWindow = registration.window;
            const navigationEpoch = registration.navigationEpoch;
            await this.cleanupExamSession(examId, { expectedRegistration: registration });
            const reassigned = Boolean(this.examWindows && Array.from(this.examWindows.values())
                .some(info => info && info.window === targetWindow));
            if (!reassigned && targetWindow !== window
                && this._isExamWindowNavigationCurrent(targetWindow, navigationEpoch)) {
                try {
                    if (!targetWindow.closed && typeof targetWindow.close === 'function') targetWindow.close();
                } catch (_) {}
            }
            return true;
        },

        /**
          * 打开指定题目进行练习
          */
        async openExam(examId, options = {}) {
            const openGeneration = this._beginExamOpenGeneration(examId, options);
            const reviewMode = Boolean(options && options.reviewMode);
            let examWindow = null;
            let launchRegistration = null;
            let exam = options && options.examDefinition && typeof options.examDefinition === 'object'
                ? options.examDefinition
                : null;
            if (!exam) {
                if (options && options.requireRecordProvenance) {
                    throw new Error('历史记录的题库来源不可用');
                }
                const examIndex = await getActiveExamIndexSnapshot();
                if (!this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow || null)) return null;
                const list = Array.isArray(examIndex) ? examIndex : [];
                exam = list.find(e => e.id === examId);
            }
            const practiceMode = options && typeof options.practiceMode === 'string'
                ? options.practiceMode.trim().toLowerCase()
                : '';
            const memorizeMode = practiceMode === 'memorize';

            if (!exam) {
                window.showMessage('题目不存在', 'error');
                return;
            }

            if (!this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow || null)) return null;

            try {
                const readingLaunch = typeof this.resolveReadingLaunchDescriptor === 'function'
                    ? this.resolveReadingLaunchDescriptor(exam, options)
                    : null;

                if (readingLaunch && readingLaunch.mode === 'pdf_manual' && readingLaunch.pdfUrl) {
                    return this._openPdfWindow(exam, readingLaunch.pdfUrl, { ...options, openGeneration });
                }

                // 若无HTML，直接打开PDF
                if (!readingLaunch && exam.hasHtml === false) {
                    const pdfUrl = (typeof window.buildResourcePath === 'function')
                        ? window.buildResourcePath(exam, 'pdf')
                        : ((exam.path || '').replace(/\\/g, '/').replace(/\/+\//g, '/') + (exam.pdfFilename || ''));
                    const resolvedPdfUrl = this._ensureAbsoluteUrl(pdfUrl);
                    return this._openPdfWindow(exam, resolvedPdfUrl, { ...options, openGeneration });
                }

                const guardOptions = { ...options, examId, openGeneration };
                // 测试环境的套题练习统一使用占位页，避免因题目资源差异导致 E2E 不稳定
                let examUrl = (readingLaunch && readingLaunch.mode === 'unified_html' && readingLaunch.url)
                    ? readingLaunch.url
                    : this.buildExamUrl(exam);
                if (guardOptions.suiteSessionId && this._shouldUsePlaceholderPage()) {
                    const placeholderUrl = this._buildExamPlaceholderUrl(exam, guardOptions);
                    if (placeholderUrl) {
                        examUrl = placeholderUrl;
                    }
                }
                if (guardOptions.suiteSessionId && readingLaunch && readingLaunch.mode === 'unified_html') {
                    examUrl = this._appendSuiteContextToExamUrl(examUrl, guardOptions);
                }
                if (guardOptions.endlessMode) {
                    examUrl = this._appendEndlessContextToExamUrl(examUrl);
                }
                if (!this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow || null)) return null;
                examWindow = this.openExamWindow(examUrl, exam, guardOptions);
                if (!examWindow || !this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow || null)) return null;
                launchRegistration = this._installExamNavigationRegistration(examId, examWindow, exam, {
                    ...guardOptions,
                    expectedUrl: this._ensureAbsoluteUrl(examUrl)
                }, openGeneration);
                if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;

                try {
                    const guardedWindow = this._guardExamWindowContent(examWindow, exam, guardOptions);
                    if (guardedWindow) {
                        examWindow = guardedWindow;
                        if (!guardOptions.navigationEpoch) {
                            guardOptions.navigationEpoch = this._recordExamWindowNavigation(examWindow);
                        }
                        launchRegistration = this._installExamNavigationRegistration(examId, examWindow, exam, {
                            ...guardOptions,
                            expectedUrl: this._ensureAbsoluteUrl(examUrl)
                        }, openGeneration);
                    }
                } catch (guardError) {
                    console.warn('[App] 题目窗口占位页守护失败:', guardError);
                }
                if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                if (guardOptions.reuseWindow && examWindow && !examWindow.closed && typeof this._cleanupReusedWindowSessions === 'function') {
                    await this._cleanupReusedWindowSessions(examWindow, examId, launchRegistration);
                    if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                }

                // 在启动窗口前捕获激活的题库配置 ID，确保后续练习记录 metadata 来源
                // 一律按"启动时"的题库写入，避免用户在考试过程中切换题库导致提交时来源不一致。
                if (!reviewMode) {
                    try {
                        await this._captureLaunchLibraryConfigurationId(examId, {
                            commitGuard: () => this._isExamSessionRegistrationCurrent(examId, launchRegistration)
                        });
                    } catch (captureError) {
                        console.warn('[App] 捕获启动题库配置 ID 失败:', captureError);
                    }
                    if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                }

                // Register the window first so the host expectedSessionId exists, then start the
                // recorder with that same id.  Starting the recorder before window setup used
                // to mint a second session id that never matched INIT/COMPLETE.
                launchRegistration = this.setupExamWindowManagement(examWindow, examId, exam, {
                    ...options,
                    expectedRegistration: launchRegistration,
                    navigationEpoch: guardOptions.navigationEpoch,
                    skipContentGuard: true,
                    deferInitialHandshake: !reviewMode && !memorizeMode,
                    expectedUrl: this._ensureAbsoluteUrl(examUrl)
                });
                if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                if (!reviewMode && !memorizeMode) {
                    const startResult = await this.startPracticeSession(examId, {
                        examDefinition: exam,
                        expectedRegistration: launchRegistration
                    });
                    if (!startResult || startResult.owned !== true
                        || !this._isExamSessionRegistrationCurrent(examId, startResult.registration)) {
                        await this._abortExamOpen(examId, launchRegistration);
                        return null;
                    }
                    launchRegistration = startResult.registration;
                    this.restartExamHandshake(examWindow, examId, launchRegistration);
                }

                if (options && options.suiteSessionId) {
                    if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                    const sessionInfo = launchRegistration.windowInfo;
                    sessionInfo.suiteSessionId = options.suiteSessionId;
                    if (options.suiteFlowMode) {
                        sessionInfo.suiteFlowMode = options.suiteFlowMode;
                    }
                    if (typeof this._buildSuiteSequencePayload === 'function' && this.currentSuiteSession) {
                        const suiteSequence = this._buildSuiteSequencePayload(this.currentSuiteSession);
                        if (suiteSequence.length) {
                            sessionInfo.suiteSequence = suiteSequence;
                        }
                    }
                    const timerContext = this._resolveSuiteTimerContext(options, sessionInfo);
                    if (timerContext.suiteTimerAnchorMs != null) {
                        sessionInfo.suiteTimerAnchorMs = timerContext.suiteTimerAnchorMs;
                        sessionInfo.globalTimerAnchorMs = timerContext.globalTimerAnchorMs;
                    }
                    if (timerContext.suiteTimerMode) {
                        sessionInfo.suiteTimerMode = timerContext.suiteTimerMode;
                    }
                    if (timerContext.suiteTimerLimitSeconds != null) {
                        sessionInfo.suiteTimerLimitSeconds = timerContext.suiteTimerLimitSeconds;
                    }
                    if (Number.isInteger(options.sequenceIndex)) {
                        sessionInfo.suiteSequenceIndex = options.sequenceIndex;
                    }
                    if (Number.isInteger(options.sequenceTotal)) {
                        sessionInfo.suiteSequenceTotal = options.sequenceTotal;
                    }
                    this.examWindows && this.examWindows.set(examId, sessionInfo);
                    launchRegistration = this._captureExamSessionRegistration(examId, sessionInfo);
                }

                if (!this._isExamSessionRegistrationCurrent(examId, launchRegistration)) return null;
                this.injectDataCollectionScript(examWindow, examId, exam, { expectedRegistration: launchRegistration });

                if (reviewMode && typeof this._bindReviewWindowRef === 'function') {
                    this._bindReviewWindowRef(options.reviewSessionId, examWindow);
                }

                window.showMessage(
                    reviewMode ? `正在打开历史回顾: ${exam.title}` : (memorizeMode ? `正在打开阅读背题: ${exam.title}` : `正在打开题目: ${exam.title}`),
                    'info'
                );

                return options.returnLaunchContext === true
                    ? Object.freeze({ window: examWindow, registration: launchRegistration })
                    : examWindow;

            } catch (error) {
                console.error('Failed to open exam:', error);
                window.showMessage('打开题目失败，请重试', 'error');
                if (launchRegistration) await this._abortExamOpen(examId, launchRegistration);
                return null;
            }
        },

        _openPdfWindow(exam, resolvedPdfUrl, options = {}) {
            let pdfWin = null;
            const openGeneration = options.openGeneration || null;

            if (options.reuseWindow && !options.reuseWindow.closed) {
                try {
                    if (openGeneration && !this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow)) {
                        return null;
                    }
                    options.reuseWindow.location.href = resolvedPdfUrl;
                    options.navigationEpoch = this._recordExamWindowNavigation(options.reuseWindow);
                    options.reuseWindow.focus();
                    pdfWin = options.reuseWindow;
                } catch (reuseError) {
                    console.warn('[App] 无法复用已打开的标签，尝试重新打开:', reuseError);
                }
            }

            if (!pdfWin) {
                if (openGeneration && !this._isExamOpenGenerationCurrent(openGeneration, options.reuseWindow || null)) return null;
                if (options.target === 'tab') {
                    try {
                        pdfWin = window.open(resolvedPdfUrl, '_blank');
                    } catch (_) { }
                } else {
                    try {
                        pdfWin = window.open(resolvedPdfUrl, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                    } catch (_) { }
                }
                if (pdfWin) options.navigationEpoch = this._recordExamWindowNavigation(pdfWin);
            }

            if (!pdfWin) {
                try {
                    window.location.href = resolvedPdfUrl;
                    options.navigationEpoch = this._recordExamWindowNavigation(window);
                    return window;
                } catch (error) {
                    throw new Error('无法打开PDF窗口，请检查弹窗设置');
                }
            }

            window.showMessage(`正在打开PDF: ${exam.title}`, 'info');
            return pdfWin;
        },

        /**
         * 构造题目URL
         */
        buildExamUrl(exam) {
            const readingLaunch = typeof this.resolveReadingLaunchDescriptor === 'function'
                ? this.resolveReadingLaunchDescriptor(exam)
                : null;
            if (readingLaunch && readingLaunch.mode === 'unified_html' && readingLaunch.url) {
                return readingLaunch.url;
            }
            if (readingLaunch && readingLaunch.mode === 'pdf_manual' && readingLaunch.pdfUrl) {
                return readingLaunch.pdfUrl;
            }

            // 使用全局的路径构建器以确保阅读/听力路径正确
            const listeningLaunchUrl = this._buildUnifiedListeningUrl(exam);
            if (listeningLaunchUrl) {
                return listeningLaunchUrl;
            }

            if (typeof window.buildResourcePath === 'function') {
                return window.buildResourcePath(exam, 'html');
            }

            // 回退：基于exam对象构造完整的文件路径（可能不含根前缀）
            let examPath = exam.path || '';
            if (!examPath.endsWith('/')) {
                examPath += '/';
            }
            return examPath + exam.filename;
        },

        /**
         * 在新窗口中打开题目
         */
        openExamWindow(examUrl, exam, options = {}) {
            const reuseWindow = options.reuseWindow;
            const openGeneration = options.openGeneration || null;
            const finalUrl = this._ensureAbsoluteUrl(examUrl);
            if (reuseWindow && !reuseWindow.closed) {
                try {
                    if (openGeneration && !this._isExamOpenGenerationCurrent(openGeneration, reuseWindow)) {
                        return null;
                    }
                    reuseWindow.location.href = finalUrl;
                    options.navigationEpoch = this._recordExamWindowNavigation(reuseWindow);
                    reuseWindow.focus();
                    return reuseWindow;
                } catch (error) {
                    console.warn('[App] 复用窗口失败，尝试重新打开:', error);
                }
            }

            if (options.target === 'tab') {
                let tabWindow = null;
                const requestedName = typeof options.windowName === 'string' && options.windowName.trim()
                    ? options.windowName.trim()
                    : '_blank';
                try {
                    if (openGeneration && !this._isExamOpenGenerationCurrent(openGeneration, reuseWindow || null)) return null;
                    tabWindow = window.open(finalUrl, requestedName);
                    if (tabWindow) options.navigationEpoch = this._recordExamWindowNavigation(tabWindow);
                    if (tabWindow && typeof tabWindow.focus === 'function') {
                        tabWindow.focus();
                    }
                } catch (_) { }

                if (tabWindow) {
                    return tabWindow;
                }
            }

            // 计算窗口尺寸和位置
            const windowFeatures = this.calculateWindowFeatures();

            // 打开新窗口
            let examWindow = null;
            try {
                if (openGeneration && !this._isExamOpenGenerationCurrent(openGeneration, reuseWindow || null)) return null;
                examWindow = window.open(
                    finalUrl,
                    `exam_${exam.id}`,
                    windowFeatures
                );
                if (examWindow) options.navigationEpoch = this._recordExamWindowNavigation(examWindow);
            } catch (_) { }

            // 弹窗被拦截时，降级为当前窗口打开，确保用户可进入练习页
            if (!examWindow) {
                try {
                    window.location.href = finalUrl;
                    options.navigationEpoch = this._recordExamWindowNavigation(window);
                    return window; // 以当前窗口作为返回引用
                } catch (e) {
                    throw new Error('无法打开题目页面，请检查弹窗/文件路径设置');
                }
            }

            return examWindow;
        },

        _ensureAbsoluteUrl(rawUrl) {
            if (!rawUrl) {
                return rawUrl;
            }

            try {
                if (typeof rawUrl === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
                    return rawUrl;
                }

                if (typeof window !== 'undefined' && window.location) {
                    return new URL(rawUrl, window.location.href).href;
                }

                return new URL(rawUrl, 'http://localhost/').href;
            } catch (error) {
                console.warn('[App] 无法解析题目URL为绝对路径:', error, rawUrl);
                return rawUrl;
            }
        },

        _resolveExamMessageEndpoint(rawUrl) {
            const href = this._ensureAbsoluteUrl(rawUrl);
            if (!href) {
                return { expectedUrl: '', expectedOrigin: '', allowOpaqueOrigin: false };
            }
            try {
                const parsed = new URL(href, window.location.href);
                // Chromium reports URL.origin as "file://" while postMessage events
                // between file pages use the opaque origin "null".
                if (parsed.protocol === 'file:') {
                    return {
                        expectedUrl: parsed.href,
                        expectedOrigin: 'null',
                        allowOpaqueOrigin: true
                    };
                }
                if (parsed.origin && parsed.origin !== 'null') {
                    return {
                        expectedUrl: parsed.href,
                        expectedOrigin: parsed.origin,
                        allowOpaqueOrigin: false
                    };
                }
            } catch (_) {
                // An unparseable launch URL must never degrade to wildcard messaging.
            }
            return { expectedUrl: '', expectedOrigin: '', allowOpaqueOrigin: false };
        },

        _reportExamMessageRejected(examId, type, reason, event = null) {
            if (!this._examMessageRejectionCounts) this._examMessageRejectionCounts = new Map();
            const key = `${String(reason || 'unknown')}:${String(type || 'unknown')}`;
            const count = Number(this._examMessageRejectionCounts.get(key) || 0) + 1;
            this._examMessageRejectionCounts.set(key, count);
            const incomingOrigin = event && typeof event.origin === 'string' ? event.origin : '';
            const originClass = incomingOrigin === 'null'
                ? 'opaque'
                : (incomingOrigin && window.location && incomingOrigin === window.location.origin ? 'same-origin' : (incomingOrigin ? 'cross-origin' : 'missing'));
            const detail = {
                reason: String(reason || 'unknown'),
                messageType: String(type || 'unknown'),
                examId: String(examId || ''),
                originClass,
                count
            };
            if (count === 1 || count % 10 === 0) {
                console.debug('[ExamMessage] rejected', detail);
            }
            try {
                window.dispatchEvent(new CustomEvent('ielts-atlas:message-rejected', { detail }));
            } catch (_) {
                // Telemetry must never affect the security decision.
            }
            return false;
        },

        // examWindows 以 examId 建键，但套题模拟模式下多篇复用同一个子窗口，
        // 只有首篇会拿到真实注册。若回包时直接用消息里的 examId 兜底建注册，
        // ensureExamWindowSession 会新铸一个子页面并不持有的 windowSessionToken，
        // 回包随即被子页面的信任校验静默丢弃。因此先解析“真正持有该窗口”的注册键，
        // 仅在没有任何注册持有该窗口时才沿用传入 examId（保持新窗口的既有行为）。
        _resolveExamWindowSessionKey(examId, targetWindow) {
            if (!targetWindow || !this.examWindows || typeof this.examWindows.forEach !== 'function') {
                return examId;
            }
            const exactInfo = typeof this.examWindows.get === 'function'
                ? this.examWindows.get(examId)
                : null;
            if (exactInfo && exactInfo.window === targetWindow) {
                return examId;
            }
            let ownerExamId = null;
            let ownerInfo = null;
            this.examWindows.forEach((info, registeredExamId) => {
                // 仅做引用比较，绝不读取可能跨域/已关闭的 WindowProxy 上的属性。
                if (!info || info.window !== targetWindow) {
                    return;
                }
                if (!ownerInfo
                    || (Number(info.registrationId) || 0) >= (Number(ownerInfo.registrationId) || 0)) {
                    ownerExamId = registeredExamId;
                    ownerInfo = info;
                }
            });
            return ownerInfo ? ownerExamId : examId;
        },

        _resolveExamWindowSessionForTarget(examId, targetWindow) {
            const resolvedExamId = this._resolveExamWindowSessionKey(examId, targetWindow);
            return {
                examId: resolvedExamId,
                windowInfo: this.ensureExamWindowSession(resolvedExamId, targetWindow)
            };
        },

        _postExamMessage(examId, targetWindow, type, data = {}) {
            if (!targetWindow || targetWindow.closed || typeof targetWindow.postMessage !== 'function') {
                return false;
            }
            const windowInfo = this._resolveExamWindowSessionForTarget(examId, targetWindow).windowInfo;
            const targetOrigin = windowInfo.expectedOrigin && windowInfo.expectedOrigin !== 'null'
                ? windowInfo.expectedOrigin
                : (windowInfo.allowOpaqueOrigin ? '*' : '');
            if (!targetOrigin) {
                console.warn('[App] 拒绝向未绑定可信 origin 的题目窗口发送消息:', type, examId);
                return false;
            }
            const payload = Object.assign({}, data || {}, {
                examId: data && data.examId != null ? data.examId : examId,
                windowSessionToken: windowInfo.windowSessionToken
            });
            targetWindow.postMessage({
                type,
                data: payload,
                source: 'exam_host',
                timestamp: Date.now()
            }, targetOrigin);
            return true;
        },

        _appendSuiteContextToExamUrl(rawUrl, options = {}) {
            if (!rawUrl) {
                return rawUrl;
            }
            try {
                const parsed = new URL(rawUrl, (window && window.location && window.location.href) ? window.location.href : undefined);
                const timerContext = typeof this._resolveSuiteTimerContext === 'function'
                    ? this._resolveSuiteTimerContext(options, null)
                    : {};
                const safeSet = (key, value) => {
                    if (value == null) {
                        return;
                    }
                    const normalized = String(value).trim();
                    if (!normalized) {
                        return;
                    }
                    parsed.searchParams.set(key, normalized);
                };
                safeSet('suiteSessionId', options.suiteSessionId);
                safeSet('suiteFlowMode', options.suiteFlowMode);
                safeSet('suiteTimerAnchorMs', timerContext.suiteTimerAnchorMs);
                safeSet('globalTimerAnchorMs', timerContext.globalTimerAnchorMs);
                safeSet('suiteTimerMode', timerContext.suiteTimerMode);
                safeSet('suiteTimerLimitSeconds', timerContext.suiteTimerLimitSeconds);
                if (Number.isInteger(options.sequenceIndex)) {
                    parsed.searchParams.set('suiteSequenceIndex', String(options.sequenceIndex));
                }
                if (Number.isInteger(options.sequenceTotal)) {
                    parsed.searchParams.set('suiteSequenceTotal', String(options.sequenceTotal));
                }
                return parsed.toString();
            } catch (_) {
                return rawUrl;
            }
        },

        _appendEndlessContextToExamUrl(rawUrl) {
            if (!rawUrl) {
                return rawUrl;
            }
            try {
                const parsed = new URL(rawUrl, (window && window.location && window.location.href) ? window.location.href : undefined);
                parsed.searchParams.set('endless', '1');
                return parsed.toString();
            } catch (_) {
                return rawUrl;
            }
        },

        _normalizeSuiteTimerAnchor(value) {
            if (value == null || value === '') {
                return null;
            }
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric > 0) {
                return Math.floor(numeric);
            }
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
            return null;
        },

        _normalizeSuiteTimerLimit(value) {
            if (value == null || value === '') {
                return null;
            }
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric >= 0) {
                return Math.floor(numeric);
            }
            return null;
        },

        _normalizeSuiteTimerMode(value) {
            const normalized = String(value || '').trim().toLowerCase();
            if (normalized === 'countdown' || normalized === 'elapsed') {
                return normalized;
            }
            return null;
        },

        _resolveSuiteTimerContext(options = {}, windowInfo = {}) {
            const pickFromSources = (sourcesList, keys, normalize) => {
                for (const source of sourcesList) {
                    for (const key of keys) {
                        const candidate = normalize(source && source[key]);
                        if (candidate != null) {
                            return candidate;
                        }
                    }
                }
                return null;
            };

            const extractSessionId = (value) => {
                if (value == null) {
                    return '';
                }
                const normalized = String(value).trim();
                return normalized;
            };

            const explicitSuiteSessionId = extractSessionId(options && options.suiteSessionId)
                || extractSessionId(windowInfo && windowInfo.suiteSessionId);
            const hasExplicitSuiteSession = !!explicitSuiteSessionId;
            const currentSessionCandidate = this.currentSuiteSession && typeof this.currentSuiteSession === 'object'
                ? this.currentSuiteSession
                : null;
            const currentSessionId = currentSessionCandidate
                ? (
                    extractSessionId(currentSessionCandidate.id)
                    || extractSessionId(currentSessionCandidate.sessionId)
                )
                : '';
            const currentSession = (
                hasExplicitSuiteSession
                && currentSessionCandidate
                && (!currentSessionId || currentSessionId === explicitSuiteSessionId)
            ) ? currentSessionCandidate : null;

            const explicitAnchorMs = pickFromSources(
                [options || {}, windowInfo || {}],
                ['suiteTimerAnchorMs', 'globalTimerAnchorMs', 'timerAnchorMs'],
                (value) => this._normalizeSuiteTimerAnchor(value)
            );
            const explicitMode = pickFromSources(
                [options || {}, windowInfo || {}],
                ['suiteTimerMode', 'timerMode'],
                (value) => this._normalizeSuiteTimerMode(value)
            );
            const explicitLimitSeconds = pickFromSources(
                [options || {}, windowInfo || {}],
                ['suiteTimerLimitSeconds', 'timerLimitSeconds'],
                (value) => this._normalizeSuiteTimerLimit(value)
            );

            if (
                !hasExplicitSuiteSession
                && explicitAnchorMs == null
                && explicitMode == null
                && explicitLimitSeconds == null
            ) {
                return {
                    suiteTimerAnchorMs: null,
                    globalTimerAnchorMs: null,
                    suiteTimerMode: null,
                    suiteTimerLimitSeconds: null
                };
            }

            const anchorSources = currentSession
                ? [options || {}, windowInfo || {}, currentSession]
                : [options || {}, windowInfo || {}];
            let anchorMs = pickFromSources(
                anchorSources,
                ['suiteTimerAnchorMs', 'globalTimerAnchorMs', 'timerAnchorMs'],
                (value) => this._normalizeSuiteTimerAnchor(value)
            );
            if (!anchorMs && currentSession) {
                anchorMs = pickFromSources(
                    [currentSession, options || {}, windowInfo || {}],
                    ['startTime', 'startedAt', 'createdAt'],
                    (value) => this._normalizeSuiteTimerAnchor(value)
                );
            }
            if (!anchorMs && currentSession && (currentSession.id || currentSession.sessionId || currentSession.status === 'active')) {
                anchorMs = Date.now();
            }

            const mode = pickFromSources(
                currentSession
                    ? [options || {}, windowInfo || {}, currentSession]
                    : [options || {}, windowInfo || {}],
                ['suiteTimerMode', 'timerMode'],
                (value) => this._normalizeSuiteTimerMode(value)
            );
            const limitSeconds = pickFromSources(
                currentSession
                    ? [options || {}, windowInfo || {}, currentSession]
                    : [options || {}, windowInfo || {}],
                ['suiteTimerLimitSeconds', 'timerLimitSeconds'],
                (value) => this._normalizeSuiteTimerLimit(value)
            );

            if (currentSession) {
                if (anchorMs && !currentSession.suiteTimerAnchorMs) {
                    currentSession.suiteTimerAnchorMs = anchorMs;
                }
                if (anchorMs && !currentSession.globalTimerAnchorMs) {
                    currentSession.globalTimerAnchorMs = anchorMs;
                }
                if (mode && !currentSession.suiteTimerMode) {
                    currentSession.suiteTimerMode = mode;
                }
                if (limitSeconds != null && !Number.isFinite(Number(currentSession.suiteTimerLimitSeconds))) {
                    currentSession.suiteTimerLimitSeconds = limitSeconds;
                }
            }

            return {
                suiteTimerAnchorMs: anchorMs,
                globalTimerAnchorMs: anchorMs,
                suiteTimerMode: mode,
                suiteTimerLimitSeconds: limitSeconds
            };
        },

        _guardExamWindowContent(examWindow, exam = null, options = {}) {
            if (!examWindow || examWindow.closed) {
                return examWindow;
            }
            // Separate file:// documents have opaque origins. Reading a child
            // window's location is forbidden even when both files are local,
            // and the launch URL has already been resolved by openExam().
            if (typeof window !== 'undefined'
                && window.location
                && window.location.protocol === 'file:') {
                return examWindow;
            }

            const resolveHref = (targetWindow) => {
                try {
                    return targetWindow.location && typeof targetWindow.location.href === 'string'
                        ? targetWindow.location.href
                        : '';
                } catch (error) {
                    const message = String(error && error.message ? error.message : error);
                    if (message && message.toLowerCase().includes('cross-origin')) {
                        console.debug('[App] 题目窗口跨域，使用占位页回退。');
                    } else {
                        console.warn('[App] 无法读取题目窗口地址，准备降级到占位页:', error);
                    }
                    return '';
                }
            };

            const currentHref = resolveHref(examWindow);
            const normalizedHref = (currentHref || '').toLowerCase();
            const retryOptions = options && typeof options === 'object' ? options : {};
            const retryCount = Number.isFinite(retryOptions.guardRetryCount) ? retryOptions.guardRetryCount : 0;
            const examId = retryOptions.examId;

            if (examId && this.examWindows && this.examWindows.has(examId)) {
                const windowInfo = this.examWindows.get(examId);
                if (windowInfo && windowInfo.dataCollectorReady) {
                    return examWindow;
                }
            }

            const isPlaceholder = normalizedHref.includes('templates/exam-placeholder.html');
            if (isPlaceholder) {
                return examWindow;
            }

            const isTestMode = this._shouldUsePlaceholderPage();
            const shouldForcePlaceholder = isTestMode && !!retryOptions.suiteSessionId;

            if (shouldForcePlaceholder) {
                const placeholderUrl = this._buildExamPlaceholderUrl(exam, retryOptions);
                if (placeholderUrl) {
                    try {
                        if (examWindow.location && typeof examWindow.location.replace === 'function') {
                            examWindow.location.replace(placeholderUrl);
                        } else {
                            examWindow.location.href = placeholderUrl;
                        }
                        retryOptions.navigationEpoch = this._recordExamWindowNavigation(examWindow);
                        return examWindow;
                    } catch (forceError) {
                        console.warn('[App] 套题模式强制跳转占位页失败，继续使用原窗口:', forceError);
                    }
                }
            }

            const shouldFallback = () => {
                if (!normalizedHref || normalizedHref === 'about:blank') {
                    if (retryCount < 4) {
                        const nextCount = retryCount + 1;
                        const delay = Math.min(1500, 250 * nextCount);
                        try {
                            setTimeout(() => {
                                try {
                                    this._guardExamWindowContent(examWindow, exam, {
                                        ...retryOptions,
                                        guardRetryCount: nextCount
                                    });
                                } catch (retryError) {
                                    console.warn('[App] 题目窗口占位页重试失败:', retryError);
                                }
                            }, delay);
                        } catch (timerError) {
                            console.warn('[App] 无法安排题目窗口占位页重试:', timerError);
                        }
                        return false;
                    }
                    return true;
                }
                if (normalizedHref.startsWith('chrome-error://')
                    || normalizedHref.startsWith('edge-error://')
                    || normalizedHref.startsWith('opera-error://')
                    || normalizedHref.startsWith('res://ieframe.dll')) {
                    return true;
                }
                return false;
            };

            if (!shouldFallback()) {
                return examWindow;
            }

            if (!isTestMode) {
                console.warn('[App] 非测试环境，跳过占位页重定向');
                return examWindow;
            }
            const placeholderUrl = this._buildExamPlaceholderUrl(exam, options);
            if (!placeholderUrl) {
                return examWindow;
            }

            try {
                if (examWindow.location && typeof examWindow.location.replace === 'function') {
                    examWindow.location.replace(placeholderUrl);
                    retryOptions.navigationEpoch = this._recordExamWindowNavigation(examWindow);
                    return examWindow;
                }
                examWindow.location.href = placeholderUrl;
                retryOptions.navigationEpoch = this._recordExamWindowNavigation(examWindow);
                return examWindow;
            } catch (navigationError) {
                console.warn('[App] 题目窗口导航占位页失败，尝试重新打开:', navigationError);
                try {
                    const windowName = (options && options.windowName)
                        ? String(options.windowName)
                        : (examWindow.name || '_blank');
                    const reopened = window.open(placeholderUrl, windowName);
                    if (reopened) {
                        retryOptions.navigationEpoch = this._recordExamWindowNavigation(reopened);
                        return reopened;
                    }
                } catch (openError) {
                    console.warn('[App] 重新打开占位窗口失败:', openError);
                }
            }

            return examWindow;
        },

        _buildExamPlaceholderUrl(exam = null, options = {}) {
            const basePath = 'templates/exam-placeholder.html';
            const params = new URLSearchParams();
            params.set('suite_test', '1');

            const safeSet = (key, value) => {
                if (value == null) {
                    return;
                }
                const stringValue = String(value).trim();
                if (stringValue) {
                    params.set(key, stringValue);
                }
            };

            if (exam && typeof exam === 'object') {
                safeSet('examId', exam.id);
                safeSet('title', exam.title);
                safeSet('category', exam.category);
            }

            if (options && typeof options === 'object') {
                safeSet('suiteSessionId', options.suiteSessionId);
                safeSet('suiteTimerAnchorMs', options.suiteTimerAnchorMs);
                safeSet('globalTimerAnchorMs', options.globalTimerAnchorMs);
                safeSet('suiteTimerMode', options.suiteTimerMode);
                safeSet('suiteTimerLimitSeconds', options.suiteTimerLimitSeconds);
                if (options.sequenceIndex != null && Number.isFinite(options.sequenceIndex)) {
                    params.set('index', String(options.sequenceIndex));
                }
            }

            const query = params.toString();
            const url = query ? `${basePath}?${query}` : basePath;
            return this._ensureAbsoluteUrl(url);
        },

        _shouldUsePlaceholderPage() {
            try {
                if (window.EnvironmentDetector && typeof window.EnvironmentDetector.isInTestEnvironment === 'function') {
                    return window.EnvironmentDetector.isInTestEnvironment();
                }
            } catch (error) {
                console.warn('[App] 无法访问 EnvironmentDetector:', error);
            }
            return false;
        },

        /**
         * 计算窗口特性
         */
        calculateWindowFeatures() {
            const screenWidth = window.screen.availWidth;
            const screenHeight = window.screen.availHeight;

            // 窗口尺寸（占屏幕的80%）
            const windowWidth = Math.floor(screenWidth * 0.8);
            const windowHeight = Math.floor(screenHeight * 0.8);

            // 窗口位置（居中）
            const windowLeft = Math.floor((screenWidth - windowWidth) / 2);
            const windowTop = Math.floor((screenHeight - windowHeight) / 2);

            return [
                `width=${windowWidth}`,
                `height=${windowHeight}`,
                `left=${windowLeft}`,
                `top=${windowTop}`,
                'scrollbars=yes',
                'resizable=yes',
                'status=yes',
                'toolbar=no',
                'menubar=no',
                'location=no'
            ].join(',');
        },

        /**
         * 注入数据采集脚本到练习页面
         */
        injectDataCollectionScript(examWindow, examId, exam = null, options = {}) {
            const expectedRegistration = options && options.expectedRegistration || null;
            const ownsRegistration = () => !expectedRegistration
                || this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
            if (!ownsRegistration()) {
                return false;
            }
            if (this._isUnifiedReadingExam(exam)) {
                return;
            }

            const isListeningExam = typeof this._isListeningLibraryExam === 'function'
                ? this._isListeningLibraryExam(exam)
                : false;
            const bridgeScriptPath = isListeningExam
                ? LISTENING_RECORD_BRIDGE_SCRIPT_PATH
                : PRACTICE_ENHANCER_SCRIPT_PATH;
            const bridgeDatasetKey = isListeningExam
                ? 'listeningRecordBridge'
                : 'practiceEnhancer';

            const ensureScriptUrl = () => {
                const resolved = this._ensureAbsoluteUrl(bridgeScriptPath);
                if (!resolved) {
                    return bridgeScriptPath;
                }
                if (!PRACTICE_ENHANCER_BUILD_ID) {
                    return resolved;
                }
                return resolved.includes('?')
                    ? `${resolved}&v=${PRACTICE_ENHANCER_BUILD_ID}`
                    : `${resolved}?v=${PRACTICE_ENHANCER_BUILD_ID}`;
            };
            const injectScript = () => {
                try {
                    if (!ownsRegistration()) {
                        return false;
                    }
                    if (!examWindow || examWindow.closed) {
                        console.warn('[DataInjection] 目标窗口已关闭');
                        return;
                    }

                    const bridgeReady = isListeningExam
                        ? (examWindow.__listeningBridgeGetState || examWindow.__listeningBridgeComplete)
                        : (examWindow.practicePageEnhancer && typeof examWindow.practicePageEnhancer.initialize === 'function');
                    if (bridgeReady) {
                        this.initializePracticeSession(examWindow, examId, expectedRegistration);
                        return;
                    }

                    let doc;
                    try {
                        doc = examWindow.document;
                    } catch (accessError) {
                        console.warn('[DataInjection] 无法访问题目页文档:', accessError);
                        return;
                    }

                    if (!doc || (!doc.head && !doc.body)) {
                        console.warn('[DataInjection] 题目页尚未准备好');
                        return;
                    }

                    if (isListeningExam && doc.documentElement
                        && doc.documentElement.dataset.listeningWrapper === 'true') {
                        return;
                    }

                    // 套题占位页自带消息协议与按钮，不需要再注入增强器（避免重复发送 PRACTICE_COMPLETE）
                    try {
                        if (doc.getElementById('complete-exam-btn') && doc.getElementById('force-ready-btn')) {
                            return;
                        }
                    } catch (_) { }

                    const host = doc.head || doc.body;
                    const bridgeDatasetAttr = `data-${bridgeDatasetKey.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`;
                    const existingSelector = `script[${bridgeDatasetAttr}], script[src*="${bridgeScriptPath.split('/').pop()}"]`;
                    const existingEnhancerScript = typeof doc.querySelector === 'function'
                        ? doc.querySelector(existingSelector)
                        : (host && typeof host.querySelector === 'function' ? host.querySelector(existingSelector) : null);
                    if (existingEnhancerScript) {
                        if (isListeningExam && (examWindow.__listeningBridgeGetState || examWindow.__listeningBridgeComplete)) {
                            this.initializePracticeSession(examWindow, examId, expectedRegistration);
                        }
                        return;
                    }
                    let enhancerInjected = false;
                    const appendEnhancer = () => {
                        if (!ownsRegistration()) {
                            return false;
                        }
                        const alreadyReady = isListeningExam
                            ? (examWindow.__listeningBridgeGetState || examWindow.__listeningBridgeComplete)
                            : (examWindow.practicePageEnhancer && typeof examWindow.practicePageEnhancer.initialize === 'function');
                        if (enhancerInjected || alreadyReady) {
                            return;
                        }
                        enhancerInjected = true;
                        const scriptEl = doc.createElement('script');
                        scriptEl.type = 'text/javascript';
                        scriptEl.defer = true;
                        scriptEl.dataset[bridgeDatasetKey] = 'true';
                        scriptEl.src = ensureScriptUrl();

                        scriptEl.onload = () => {
                            if (!ownsRegistration()) {
                                return;
                            }
                            setTimeout(() => {
                                if (!ownsRegistration()) {
                                    return;
                                }
                                try {
                                    this.initializePracticeSession(examWindow, examId, expectedRegistration);
                                } catch (sessionError) {
                                    console.warn('[DataInjection] 初始化练习会话失败:', sessionError);
                                }
                            }, 80);
                        };

                        scriptEl.onerror = (loadError) => {
                            if (!ownsRegistration()) {
                                return;
                            }
                            console.warn('[DataInjection] 加载增强器失败:', loadError);
                            scriptEl.remove();
                            if (!isListeningExam) {
                                this.injectInlineScript(examWindow, examId, expectedRegistration);
                            }
                        };

                        if (!ownsRegistration()) {
                            return false;
                        }
                        host.appendChild(scriptEl);
                        return true;
                    };

                    return appendEnhancer();
                } catch (error) {
                    if (!ownsRegistration()) {
                        return false;
                    }
                    console.error('[DataInjection] 注入增强器脚本时出错:', error);
                    if (!isListeningExam) {
                        this.injectInlineScript(examWindow, examId, expectedRegistration);
                    }
                }
            };

            const checkAndInject = () => {
                try {
                    if (!ownsRegistration()) {
                        return;
                    }
                    if (!examWindow || examWindow.closed) {
                        return;
                    }

                    const doc = examWindow.document;
                    if (doc && (doc.readyState === 'interactive' || doc.readyState === 'complete')) {
                        injectScript();
                    } else if (ownsRegistration()) {
                        setTimeout(checkAndInject, 200);
                    }
                } catch (error) {
                    console.warn('[DataInjection] 检测题目页面就绪状态失败:', error);
                }
            };

            if (ownsRegistration()) {
                setTimeout(checkAndInject, 300);
            }
        },

        /**
         * 内联脚本注入（备用方案）
         */
        injectInlineScript(examWindow, examId, expectedRegistration = null) {
            const ownsRegistration = () => !expectedRegistration
                || this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
            try {
                if (!ownsRegistration()) {
                    return false;
                }
                if (!examWindow || !examWindow.document || !examWindow.document.head) {
                    throw new Error('inline_target_unavailable');
                }

                const sessionToken = `${examId}_${Date.now()}`;
                // 备用方案注入时同步读取 host 端启动时捕获的题库配置 ID，确保 enhancer 也能拿到来源。
                const launchLibraryConfigurationId = this._readLaunchLibraryConfigurationId(examId);
                const inlineScript = examWindow.document.createElement('script');
                inlineScript.type = 'text/javascript';
                inlineScript.textContent = `
                    (function() {
                        if (window.__IELTS_INLINE_ENHANCER__) {
                            return;
                        }
                        window.__IELTS_INLINE_ENHANCER__ = true;

                        var parentWindow = window.opener || window.parent || null;
                        var state = {
                            sessionId: ${JSON.stringify(sessionToken)},
                            examId: ${JSON.stringify(examId)},
                            startTime: Date.now(),
                            answers: {},
                            // 启动时 host 端捕获的题库配置 ID；每条 INIT_SESSION 还会再次以
                            // initData.libraryConfigurationId 同步更新，确保即使延迟加载也能拿到正确来源。
                            libraryConfigurationId: ${JSON.stringify(launchLibraryConfigurationId || null)},
                            expectedParentOrigin: (function() {
                                try {
                                    if (!document.referrer) return '';
                                    var parsed = new URL(document.referrer, window.location.href);
                                    // Chromium: file URL.origin is "file://", postMessage event.origin is "null".
                                    if (parsed.protocol === 'file:') return '';
                                    if (!parsed.origin || parsed.origin === 'null' || parsed.origin === 'file://') return '';
                                    return parsed.origin;
                                } catch (_) {
                                    return '';
                                }
                            })(),
                             parentOrigin: '',
                             parentOriginIsOpaque: false,
                             windowSessionToken: '',
                             submissionId: '',
                             suite: {
                                active: false,
                                sessionId: null,
                                guarded: false,
                                nativeClose: typeof window.close === 'function' ? window.close.bind(window) : null,
                                nativeOpen: typeof window.open === 'function' ? window.open.bind(window) : null
                            }
                        };

                        function createSubmissionId() {
                            try {
                                if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                                    return 'inline-submit-' + window.crypto.randomUUID();
                                }
                            } catch (_) {}
                            return 'inline-submit-' + (state.sessionId || state.examId || 'session') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
                        }

                        function sendMessage(type, data) {
                            if (!parentWindow || typeof parentWindow.postMessage !== 'function') {
                                return;
                            }
                            try {
                                var targetOrigin = state.parentOrigin && state.parentOrigin !== 'null'
                                    ? state.parentOrigin
                                    : (state.expectedParentOrigin || (window.location.protocol === 'file:' ? '*' : ''));
                                if (!targetOrigin) return;
                                var payload = Object.assign({}, data || {});
                                if (type === 'PRACTICE_COMPLETE' || type === 'PRACTICE_RESULT') {
                                    if (!state.submissionId) {
                                        state.submissionId = payload.submissionId || createSubmissionId();
                                    }
                                    payload.sessionId = payload.sessionId || state.sessionId || null;
                                    payload.submissionId = payload.submissionId || state.submissionId;
                                }
                                parentWindow.postMessage({
                                    type: type,
                                    data: Object.assign(payload, {
                                        windowSessionToken: state.windowSessionToken || null
                                    }),
                                    source: 'inline_collector',
                                    timestamp: Date.now()
                                }, targetOrigin);
                            } catch (error) {
                                console.warn('[InlineEnhancer] 无法发送消息:', error);
                            }
                        }

                        function notifySuiteCloseAttempt(reason) {
                            if (!state.suite.active) {
                                return;
                            }
                            sendMessage('SUITE_CLOSE_ATTEMPT', {
                                examId: state.examId,
                                suiteSessionId: state.suite.sessionId,
                                reason: reason || 'unknown',
                                timestamp: Date.now()
                            });
                        }

                        function installSuiteGuards() {
                            if (state.suite.guarded) {
                                return;
                            }
                            state.suite.guarded = true;

                            if (!state.suite.nativeClose && typeof window.close === 'function') {
                                state.suite.nativeClose = window.close.bind(window);
                            }

                            var windowName = typeof window.name === 'string'
                                ? window.name.trim().toLowerCase()
                                : '';

                            var isSelfTarget = function(rawTarget) {
                                if (rawTarget == null) {
                                    return true;
                                }

                                var normalized = typeof rawTarget === 'string'
                                    ? rawTarget.trim().toLowerCase()
                                    : String(rawTarget).trim().toLowerCase();

                                if (!normalized) {
                                    return true;
                                }

                                if (windowName && normalized === windowName) {
                                    return true;
                                }

                                if (normalized === '_self' || normalized === 'self'
                                    || normalized === '_parent' || normalized === 'parent'
                                    || normalized === '_top' || normalized === 'top'
                                    || normalized === 'window' || normalized === 'this') {
                                    return true;
                                }

                                return false;
                            };

                            var guardedClose = function() {
                                notifySuiteCloseAttempt('script_request');
                                return undefined;
                            };

                            try { window.close = guardedClose; } catch (_) {}
                            try { window.self.close = guardedClose; } catch (_) {}
                            try { window.top.close = guardedClose; } catch (_) {}

                            if (!state.suite.nativeOpen && typeof window.open === 'function') {
                                state.suite.nativeOpen = window.open.bind(window);
                            }

                            if (state.suite.nativeOpen) {
                                window.open = function(url, target, features) {
                                    if (isSelfTarget(target)) {
                                        notifySuiteCloseAttempt('self_target_open');
                                        return window;
                                    }
                                    return state.suite.nativeOpen.call(window, url, target, features);
                                };
                            }
                        }

                        function teardownSuiteGuards() {
                            if (!state.suite.guarded) {
                                return;
                            }
                            state.suite.guarded = false;

                            if (state.suite.nativeClose) {
                                try {
                                    var originalClose = state.suite.nativeClose;
                                    window.close = originalClose;
                                    window.self.close = originalClose;
                                    window.top.close = originalClose;
                                } catch (_) {}
                            }

                            if (state.suite.nativeOpen) {
                                try { window.open = state.suite.nativeOpen; } catch (_) {}
                            }
                        }

                        function handleSuiteNavigate(data) {
                            if (!data || !data.url) {
                                return;
                            }
                            try {
                                window.location.href = data.url;
                            } catch (error) {
                                console.warn('[InlineEnhancer] 套题导航失败:', error);
                            }
                        }

                        function handleInitSession(message) {
                            var initData = message && message.data ? message.data : {};
                            if (initData.sessionId) {
                                if (state.sessionId && String(state.sessionId) !== String(initData.sessionId)) {
                                    state.submissionId = '';
                                }
                                state.sessionId = initData.sessionId;
                            }
                            if (initData.examId) {
                                state.examId = initData.examId;
                            }
                            // host 启动时捕获并随 INIT_SESSION 携带的题库配置 ID；这里同步更新 state，
                            // 在 enhancer 回传完成结果时一并透传，避免后续提交再读当前激活题库。
                            if (typeof initData.libraryConfigurationId !== 'undefined'
                                && initData.libraryConfigurationId !== null
                                && initData.libraryConfigurationId !== '') {
                                state.libraryConfigurationId = initData.libraryConfigurationId;
                            }
                            if (initData.suiteSessionId) {
                                state.suite.active = true;
                                state.suite.sessionId = initData.suiteSessionId;
                                installSuiteGuards();
                            }

                            sendMessage('SESSION_READY', {
                                sessionId: state.sessionId,
                                examId: state.examId,
                                url: window.location.href,
                                title: document.title || ''
                            });
                        }

                        window.addEventListener('message', function(event) {
                            var message = event && event.data ? event.data : null;
                            if (!message || typeof message.type !== 'string') {
                                return;
                            }

                            if (message.type === 'INIT_SESSION') {
                                var initData = message.data || {};
                                var incomingOrigin = event && typeof event.origin === 'string' ? event.origin : '';
                                var declaredOrigin = typeof initData.parentOrigin === 'string' ? initData.parentOrigin : '';
                                var incomingToken = typeof initData.windowSessionToken === 'string'
                                    ? initData.windowSessionToken.trim()
                                    : '';
                                if (!event || event.source !== parentWindow || message.source !== 'exam_host' || !incomingToken) return;
                                var expectedParentOrigin = state.expectedParentOrigin
                                    && state.expectedParentOrigin !== 'file://'
                                    && String(state.expectedParentOrigin).indexOf('file:') !== 0
                                    ? state.expectedParentOrigin
                                    : '';
                                if (expectedParentOrigin) {
                                    if (incomingOrigin !== expectedParentOrigin || declaredOrigin !== expectedParentOrigin) return;
                                    state.parentOrigin = expectedParentOrigin;
                                    state.parentOriginIsOpaque = false;
                                } else if (window.location.protocol === 'file:') {
                                    var trustedFileOrigin = (incomingOrigin === 'null' || incomingOrigin === 'file://')
                                        && (declaredOrigin === 'null' || declaredOrigin === '' || declaredOrigin === 'file://');
                                    if (!trustedFileOrigin) return;
                                    state.parentOrigin = 'null';
                                    state.parentOriginIsOpaque = true;
                                } else {
                                    var trustedWebOrigin = !!incomingOrigin
                                        && incomingOrigin !== 'null'
                                        && incomingOrigin !== 'file://'
                                        && declaredOrigin === incomingOrigin;
                                    if (!trustedWebOrigin) return;
                                    state.parentOrigin = incomingOrigin;
                                    state.parentOriginIsOpaque = false;
                                }
                                state.windowSessionToken = incomingToken;
                                handleInitSession(message);
                                return;
                            }

                            var messageData = message.data || {};
                            var messageToken = typeof messageData.windowSessionToken === 'string'
                                ? messageData.windowSessionToken.trim()
                                : '';
                            var messageOrigin = event && typeof event.origin === 'string' ? event.origin : '';
                            var originMatches = state.parentOriginIsOpaque
                                ? (messageOrigin === 'null' || messageOrigin === 'file://')
                                : Boolean(state.parentOrigin && messageOrigin === state.parentOrigin);
                            if (!event || event.source !== parentWindow || message.source !== 'exam_host'
                                || !originMatches || !state.windowSessionToken || messageToken !== state.windowSessionToken) {
                                return;
                            }

                            if (!state.suite.active) {
                                return;
                            }

                            if (message.type === 'SUITE_NAVIGATE') {
                                handleSuiteNavigate(message.data || {});
                            } else if (message.type === 'SUITE_FORCE_CLOSE') {
                                teardownSuiteGuards();
                                if (state.suite.nativeClose) {
                                    state.suite.nativeClose.call(window);
                                }
                            }
                        });

                        var collector = {
                            get sessionId() { return state.sessionId; },
                            get examId() { return state.examId; },
                            get answers() { return state.answers; },
                            startTime: state.startTime,
                            initialize: function() {
                                this.setupBasicListeners();
                                this.setupSubmitListeners();
                            },
                            setupBasicListeners: function() {
                                document.addEventListener('change', function(event) {
                                    var target = event && event.target ? event.target : null;
                                    if (!target || !target.name) {
                                        return;
                                    }
                                    var tag = (target.tagName || '').toUpperCase();
                                    if (target.type === 'radio' || target.type === 'text' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                                        state.answers[target.name] = target.value;
                                    }
                                }, true);
                            },
                            setupSubmitListeners: function() {
                                var buttons = Array.prototype.slice.call(document.querySelectorAll('button, input[type="submit"]'));
                                if (!buttons.length) {
                                    var legacy = document.querySelector('button[onclick*="grade"]');
                                    if (legacy) {
                                        buttons.push(legacy);
                                    }
                                }

                                buttons.forEach(function(btn) {
                                    if (!btn || typeof btn.addEventListener !== 'function') {
                                        return;
                                    }
                                    btn.addEventListener('click', function() {
                                        setTimeout(function() {
                                            collector.sendResults();
                                        }, 200);
                                    }, false);
                                });
                            },
                            sendResults: function() {
                                sendMessage('PRACTICE_COMPLETE', {
                                    sessionId: state.sessionId,
                                    examId: state.examId,
                                    duration: Math.round((Date.now() - state.startTime) / 1000),
                                    answers: state.answers,
                                    source: 'inline_collector',
                                    // 透传启动时捕获的题库配置 ID，便于 host 端 completeAttempt 写入 metadata 来源。
                                    libraryConfigurationId: state.libraryConfigurationId || null
                                });
                            }
                        };

                        window.practiceDataCollector = collector;

                        if (document.readyState === 'loading') {
                            document.addEventListener('DOMContentLoaded', function() {
                                collector.initialize();
                            });
                        } else {
                            collector.initialize();
                        }
                    })();
                `;

                if (!ownsRegistration()) {
                    return false;
                }
                examWindow.document.head.appendChild(inlineScript);

                setTimeout(() => {
                    if (!ownsRegistration()) {
                        return;
                    }
                    this.initializePracticeSession(examWindow, examId, expectedRegistration);
                }, 300);

            } catch (error) {
                if (!ownsRegistration()) {
                    return false;
                }
                console.error('[DataInjection] 内联脚本注入失败:', error);
                this.handleInjectionError(examId, error);
            }
            return true;
        },

        /**
         * 初始化练习会话
         */
        initializePracticeSession(examWindow, examId, expectedRegistration = null) {
            try {
                if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                    return false;
                }
                const now = Date.now();

                let existingInfo = expectedRegistration ? expectedRegistration.windowInfo : null;
                if (!existingInfo && this.examWindows && this.examWindows.has(examId)) {
                    existingInfo = this.examWindows.get(examId) || null;
                }

                const hasExplicitSuiteBinding = Boolean(
                    existingInfo && Object.prototype.hasOwnProperty.call(existingInfo, 'suiteSessionId')
                );
                let suiteSessionId = hasExplicitSuiteBinding ? (existingInfo.suiteSessionId || null) : null;

                if (!hasExplicitSuiteBinding && !suiteSessionId && this.currentSuiteSession) {
                    const activeMatch = this.currentSuiteSession.activeExamId === examId;
                    const sequenceIndex = Number.isInteger(this.currentSuiteSession.currentIndex)
                        ? this.currentSuiteSession.currentIndex
                        : 0;
                    const sequenceMatch = Array.isArray(this.currentSuiteSession.sequence)
                        && this.currentSuiteSession.sequence.length > sequenceIndex
                        && this.currentSuiteSession.sequence[sequenceIndex]
                        && this.currentSuiteSession.sequence[sequenceIndex].examId === examId;

                    if (activeMatch || sequenceMatch) {
                        suiteSessionId = this.currentSuiteSession.id;
                    }
                }

                const windowInfo = expectedRegistration
                    ? expectedRegistration.windowInfo
                    : this.ensureExamWindowSession(examId, examWindow);
                if (suiteSessionId && !Object.prototype.hasOwnProperty.call(windowInfo, 'suiteSessionId')) {
                    windowInfo.suiteSessionId = suiteSessionId;
                }
                const timerContext = this._resolveSuiteTimerContext({}, windowInfo);
                if (timerContext.suiteTimerAnchorMs != null) {
                    windowInfo.suiteTimerAnchorMs = timerContext.suiteTimerAnchorMs;
                    windowInfo.globalTimerAnchorMs = timerContext.globalTimerAnchorMs;
                }
                if (timerContext.suiteTimerMode) {
                    windowInfo.suiteTimerMode = timerContext.suiteTimerMode;
                }
                if (timerContext.suiteTimerLimitSeconds != null) {
                    windowInfo.suiteTimerLimitSeconds = timerContext.suiteTimerLimitSeconds;
                }
                const initPayload = this._buildExamInitPayload(examId, windowInfo, { timestamp: now });

                // 发送会话初始化消息
                this._postExamMessage(examId, examWindow, 'INIT_SESSION', initPayload);

                // 存储会话信息
                if (!this.examWindows) {
                    this.examWindows = new Map();
                }

                if (existingInfo) {
                    existingInfo.sessionId = initPayload.sessionId;
                    existingInfo.initTime = now;
                    existingInfo.status = 'initialized';
                    if (suiteSessionId && !Object.prototype.hasOwnProperty.call(existingInfo, 'suiteSessionId')) {
                        existingInfo.suiteSessionId = suiteSessionId;
                    }
                    if (!existingInfo.window || existingInfo.window.closed) {
                        existingInfo.window = examWindow;
                    }
                    this.examWindows.set(examId, existingInfo);
                } else {
                    console.warn('[DataInjection] 未找到窗口信息，创建新的');
                    this.examWindows.set(examId, Object.assign({}, windowInfo, {
                        window: examWindow,
                        sessionId: initPayload.sessionId,
                        initTime: now,
                        status: 'initialized',
                        suiteSessionId: suiteSessionId || null
                    }));
                }

                return true;

            } catch (error) {
                console.error('[DataInjection] 会话初始化失败:', error);
                return false;
            }
        },

        /**
         * 处理注入错误
         */
        async handleInjectionError(examId, error) {
            console.error('[DataInjection] 注入错误:', error);

            // 记录错误信息
            const errorInfo = {
                examId: examId,
                error: error.message,
                timestamp: Date.now(),
                type: 'script_injection_error'
            };

            console.warn('[DataInjection] 诊断信息:', errorInfo);

            // 不显示错误给用户，静默处理
            console.warn('[DataInjection] 将使用模拟数据模式');
        },

        /**
         * 设置题目窗口管理
         */
        setupExamWindowManagement(examWindow, examId, exam = null, options = {}) {
            if (!examWindow) {
                console.warn('[App] 缺少题目窗口引用，无法完成窗口管理');
                return null;
            }

            const expectedRegistration = options && options.expectedRegistration || null;
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return null;
            }

            if (!(options && options.skipContentGuard)) {
                try {
                    const guardedWindow = this._guardExamWindowContent(examWindow, exam, { ...options, examId });
                    if (guardedWindow) {
                        examWindow = guardedWindow;
                    }
                } catch (guardError) {
                    console.warn('[App] 守护题目窗口内容失败:', guardError);
                }
            }

            // 存储窗口引用
            if (!this.examWindows) {
                this.examWindows = new Map();
            }

            const previousWindowInfo = this.examWindows.get(examId);
            if (previousWindowInfo && previousWindowInfo.closeMonitor) {
                try {
                    clearInterval(previousWindowInfo.closeMonitor);
                } catch (_) {}
            }

            const endpoint = this._resolveExamMessageEndpoint(
                options && options.expectedUrl
                    ? options.expectedUrl
                    : (exam ? this.buildExamUrl(exam) : '')
            );
            this._examRegistrationSequence = Math.max(0, Number(this._examRegistrationSequence) || 0) + 1;
            const windowInfo = {
                window: examWindow,
                startTime: Date.now(),
                status: 'active',
                expectedSessionId: expectedRegistration && expectedRegistration.windowInfo.expectedSessionId
                    ? String(expectedRegistration.windowInfo.expectedSessionId)
                    : null,
                windowSessionToken: expectedRegistration && expectedRegistration.windowInfo.windowSessionToken || null,
                windowSessionTokenSessionId: expectedRegistration && expectedRegistration.windowInfo.windowSessionTokenSessionId || null,
                expectedUrl: endpoint.expectedUrl,
                expectedOrigin: endpoint.expectedOrigin,
                allowOpaqueOrigin: endpoint.allowOpaqueOrigin,
                observedOrigin: '',
                suiteSessionId: (options && options.suiteSessionId) ? options.suiteSessionId : null,
                suiteFlowMode: (options && options.suiteFlowMode) ? String(options.suiteFlowMode) : null,
                suiteSequenceIndex: Number.isInteger(options && options.sequenceIndex) ? options.sequenceIndex : null,
                suiteSequenceTotal: Number.isInteger(options && options.sequenceTotal) ? options.sequenceTotal : null,
                reviewMode: Boolean(options && options.reviewMode),
                reviewSessionId: options && options.reviewSessionId ? String(options.reviewSessionId) : null,
                reviewEntryIndex: Number.isInteger(options && options.reviewEntryIndex) ? options.reviewEntryIndex : 0,
                practiceMode: options && typeof options.practiceMode === 'string'
                    ? options.practiceMode.trim().toLowerCase()
                    : null,
                readOnly: options && Object.prototype.hasOwnProperty.call(options, 'readOnly')
                    ? Boolean(options.readOnly)
                    : Boolean(options && options.reviewMode),
                // Async INIT/draft work must be tied to this exact registration.
                // Reusing an exam ID replaces the map entry even when the browser
                // keeps the same WindowProxy alive.
                sessionGeneration: expectedRegistration
                    ? expectedRegistration.sessionGeneration
                    : (previousWindowInfo && Number.isFinite(previousWindowInfo.sessionGeneration)
                        ? previousWindowInfo.sessionGeneration + 1
                        : 1),
                registrationId: this._examRegistrationSequence,
                navigationEpoch: Number(options && options.navigationEpoch)
                    || Number(expectedRegistration && expectedRegistration.navigationEpoch)
                    || 0,
                closeMonitor: null
            };
            this.examWindows.set(examId, windowInfo);
            this._refreshExamWindowToken(examId, windowInfo);
            const registration = this._captureExamSessionRegistration(examId, windowInfo);

            // 监听窗口关闭事件
            let checkClosed = null;
            try {
                checkClosed = setInterval(() => {
                    try {
                        if (examWindow.closed) {
                            clearInterval(checkClosed);
                            if (windowInfo.closeMonitor === checkClosed) {
                                windowInfo.closeMonitor = null;
                            }
                            this.handleExamWindowClosed(examId, examWindow, registration);
                        }
                    } catch (monitorError) {
                        clearInterval(checkClosed);
                        console.warn('[App] 无法检测题目窗口状态:', monitorError);
                    }
                }, 1000);
                windowInfo.closeMonitor = checkClosed;
            } catch (error) {
                console.warn('[App] 启动窗口关闭监控失败:', error);
            }

            // 设置窗口通信
            try {
                this.setupExamWindowCommunication(examWindow, examId, exam, {
                    ...options,
                    expectedRegistration: registration
                });
            } catch (error) {
                console.warn('[App] 初始化题目窗口通信失败:', error);
            }

            // 启动与练习页的会话握手（file:// 下更可靠）
            if (!(options && options.deferInitialHandshake)) {
                try {
                    this.startExamHandshake(examWindow, examId, registration);
                } catch (e) {
                    console.warn('[App] 启动握手失败:', e);
                }
            }

            const emitInitEnvelope = async () => {
                if (!this._isExamSessionRegistrationCurrent(examId, registration)) return;
                const windowInfo = registration.windowInfo;
                const generation = windowInfo && windowInfo.sessionGeneration;
                const expectedSessionId = windowInfo && windowInfo.expectedSessionId;
                // 让最早到达的 INIT 即携带 draft，避免无 draft 的 envelope 先被去重守卫登记，
                // 从而使后续携带 draft 的 INIT 被当作重复而丢弃、草稿无法恢复。
                if (
                    windowInfo
                    && !windowInfo.reviewMode
                    && !windowInfo.suiteSessionId
                    && String(windowInfo.practiceMode || '').toLowerCase() !== 'memorize'
                    && typeof this.getReadingDraftForExam === 'function'
                ) {
                    try {
                        const restoredDraft = await this.getReadingDraftForExam(examId, {
                            sessionId: windowInfo.expectedSessionId
                        });
                        if (restoredDraft) {
                            windowInfo.lastReadingDraft = restoredDraft;
                            this.examWindows && this.examWindows.set(examId, windowInfo);
                        }
                    } catch (_) {
                        // draft restore is best-effort
                    }
                }
                // The exam may have been reopened while draft restoration was
                // pending. Never let the old continuation post its session into
                // the replacement registration.
                const currentWindowInfo = this.examWindows && this.examWindows.get(examId);
                if (
                    !windowInfo
                    || !this._isExamSessionRegistrationCurrent(examId, registration)
                    || currentWindowInfo !== windowInfo
                    || windowInfo.window !== examWindow
                    || windowInfo.sessionGeneration !== generation
                    || windowInfo.expectedSessionId !== expectedSessionId
                ) {
                    return;
                }
                const initPayload = this._buildExamInitPayload(examId, windowInfo);
                try {
                    this._postExamMessage(examId, examWindow, 'INIT_SESSION', initPayload);
                    this._postExamMessage(examId, examWindow, 'init_exam_session', initPayload);
                } catch (postError) {
                    console.warn('[App] 跨源初始化题目窗口失败:', postError);
                }
            };

            if (options && options.deferInitialHandshake) {
                // startPracticeSession owns the first INIT for managed practice launches.
            } else if (!isFileProtocol) {
                try {
                    examWindow.addEventListener('load', emitInitEnvelope);
                } catch (error) {
                    console.warn('[App] 监听题目窗口 load 事件失败:', error);
                    emitInitEnvelope();
                }
            } else {
                emitInitEnvelope();
            }

            // 更新UI状态
            if (!(options && options.reviewMode)) {
                this.updateExamStatus(examId, 'in-progress');
            }
            return registration;
        },

        /**
         * 设置题目窗口通信
         */
        setupExamWindowCommunication(examWindow, examId, exam = null, options = {}) {
            let expectedRegistration = options && options.expectedRegistration || null;
            if (!expectedRegistration) {
                const fallbackWindowInfo = this.ensureExamWindowSession(examId, examWindow);
                if (!Object.prototype.hasOwnProperty.call(fallbackWindowInfo, 'suiteSessionId')) {
                    fallbackWindowInfo.suiteSessionId = options && options.suiteSessionId || null;
                }
                expectedRegistration = this._captureExamSessionRegistration(
                    examId,
                    fallbackWindowInfo
                );
            }
            const ownsRegistration = () => this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
            const parseJsonSafely = (value) => {
                if (typeof value !== 'string' || !value.trim()) return null;
                try {
                    return JSON.parse(value);
                } catch (_) {
                    return null;
                }
            };

            const isPlainObject = (value) => {
                return value && typeof value === 'object' && !Array.isArray(value);
            };

            const normalizeMessage = (rawEnvelope, depth = 0) => {
                if (depth > 2) return null;

                const practiceProtocol = window.PracticeCore && window.PracticeCore.protocol;
                if (practiceProtocol && typeof practiceProtocol.normalizeMessage === 'function') {
                    const normalizedByCore = practiceProtocol.normalizeMessage(rawEnvelope, depth);
                    if (normalizedByCore) {
                        return normalizedByCore;
                    }
                }

                const allowedTypes = new Set([
                    'exam_completed',
                    'exam_progress',
                    'exam_error',
                    'SESSION_READY',
                    'PROGRESS_UPDATE',
                    'PRACTICE_COMPLETE',
                    'PRACTICE_RESULT',
                    'ERROR_OCCURRED',
                    'REQUEST_INIT',
                    'PRACTICE_RESET_REQUEST',
                    'SUITE_CLOSE_ATTEMPT',
                    'REVIEW_NAVIGATE',
                    'SUITE_CONFIG_UPDATE',
                    'VOCAB_HIGHLIGHT_SAVE',
                    'SIMULATION_DRAFT_SYNC',
                    'READING_DRAFT_SYNC',
                    'READING_ANNOTATION_SYNC',
                    'PRACTICE_RECORD_SAVED',
                    'SIMULATION_NAVIGATE',
                    'SIMULATION_ACTIVE_EXAM_CHANGE',
                    'SIMULATION_SUBMIT'
                ]);

                const baseKeys = new Set(['type', 'messageType', 'action', 'event', 'data', 'payload', 'detail', 'args', 'source', 'message', 'messageData']);

                const coerceObject = (value) => {
                    if (isPlainObject(value)) return value;
                    if (typeof value === 'string') {
                        const parsed = parseJsonSafely(value);
                        return isPlainObject(parsed) ? parsed : null;
                    }
                    return null;
                };

                const pickType = (envelope) => {
                    const rawType = envelope.type || envelope.messageType || envelope.action || envelope.event;
                    if (typeof rawType !== 'string') return '';
                    return rawType.trim();
                };

                const pickData = (envelope) => {
                    const candidates = [envelope.data, envelope.payload, envelope.detail];
                    for (let i = 0; i < candidates.length; i++) {
                        const coerced = coerceObject(candidates[i]);
                        if (coerced) return coerced;
                    }

                    if (Array.isArray(envelope.args)) {
                        for (let i = 0; i < envelope.args.length; i++) {
                            const coerced = coerceObject(envelope.args[i]);
                            if (coerced) return coerced;
                        }
                    }

                    const fallback = {};
                    let hasFallback = false;
                    Object.keys(envelope || {}).forEach((key) => {
                        if (!baseKeys.has(key)) {
                            fallback[key] = envelope[key];
                            hasFallback = true;
                        }
                    });

                    return hasFallback ? fallback : null;
                };

                let envelope = rawEnvelope;
                if (typeof envelope === 'string') {
                    envelope = parseJsonSafely(envelope);
                }
                if (!isPlainObject(envelope)) return null;

                const type = pickType(envelope);
                if (!type) {
                    const nested = coerceObject(envelope.message) || coerceObject(envelope.messageData);
                    if (nested) {
                        return normalizeMessage(nested, depth + 1);
                    }
                    return null;
                }

                if (!allowedTypes.has(type)) {
                    return null;
                }

                const data = pickData(envelope) || {};
                if (!isPlainObject(data)) {
                    return null;
                }

                const sourceTag = typeof envelope.source === 'string'
                    ? envelope.source
                    : (typeof data.source === 'string' ? data.source : '');

                return { type, data, sourceTag };
            };

            const resolveWindowName = (targetWindow) => {
                if (!targetWindow) {
                    return '';
                }
                try {
                    const rawName = typeof targetWindow.name === 'string'
                        ? targetWindow.name
                        : '';
                    return rawName.trim();
                } catch (_) {
                    return '';
                }
            };

            const isLikelySameWindowContext = (sourceWindow, expectedWindow) => {
                if (!sourceWindow || !expectedWindow) {
                    return false;
                }
                if (sourceWindow === expectedWindow) {
                    return true;
                }
                const sourceName = resolveWindowName(sourceWindow);
                const expectedName = resolveWindowName(expectedWindow);
                if (sourceName && expectedName && sourceName === expectedName) {
                    return true;
                }
                try {
                    const sourceHref = sourceWindow.location && typeof sourceWindow.location.href === 'string'
                        ? sourceWindow.location.href
                        : '';
                    const expectedHref = expectedWindow.location && typeof expectedWindow.location.href === 'string'
                        ? expectedWindow.location.href
                        : '';
                    if (sourceHref && expectedHref && sourceHref === expectedHref && sourceHref !== 'about:blank') {
                        return true;
                    }
                } catch (_) {
                    // ignore cross-origin href checks
                }
                return false;
            };

            const messageHandler = async (event) => {
                if (!ownsRegistration()) {
                    this._reportExamMessageRejected(examId, '', 'stale-registration', event);
                    return;
                }
                const expectedWindow = expectedRegistration.window;
                const sourceWindow = event ? (event.source || null) : null;

                // 缺少来源窗口直接拒绝
                if (!sourceWindow || !expectedWindow) {
                    this._reportExamMessageRejected(examId, '', 'missing-window', event);
                    return;
                }

                const normalized = normalizeMessage(event.data);
                if (!normalized) {
                    this._reportExamMessageRejected(examId, '', 'invalid-envelope', event);
                    return;
                }

                const windowInfo = expectedRegistration.windowInfo;
                const expectedSessionId = windowInfo.expectedSessionId || '';
                // Most messages must still come from the exact exam window.  A small
                // suite/listening compatibility path below can prove an equivalent
                // source with the window token and full session scope; do not reject
                // before those constraints have been evaluated.
                const sourceMatched = sourceWindow === expectedWindow;
                const incomingOrigin = event && typeof event.origin === 'string' ? event.origin : '';
                if (windowInfo.expectedOrigin && windowInfo.expectedOrigin !== 'null') {
                    if (incomingOrigin !== windowInfo.expectedOrigin) {
                        this._reportExamMessageRejected(examId, normalized.type, 'origin-mismatch', event);
                        return;
                    }
                } else if (windowInfo.allowOpaqueOrigin) {
                    if (incomingOrigin !== 'null' && incomingOrigin !== 'file://') {
                        this._reportExamMessageRejected(examId, normalized.type, 'opaque-origin-mismatch', event);
                        return;
                    }
                } else {
                    this._reportExamMessageRejected(examId, normalized.type, 'origin-unbound', event);
                    return;
                }

                // 放宽消息源过滤，兼容 inline_collector 与 practice_page
                const src = normalized.sourceTag || '';
                const allowedSources = new Set(['practice_page', 'inline_collector', 'suite_placeholder', 'listening_record_bridge']);
                if (!src || !allowedSources.has(src)) {
                    this._reportExamMessageRejected(examId, normalized.type, 'source-tag-mismatch', event);
                    return; // 非预期来源的消息忽略
                }

                const type = normalized.type;
                const data = normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)
                    ? { ...normalized.data }
                    : {};
                const isPracticeResetRequest = type === 'PRACTICE_RESET_REQUEST';
                const expectedExamId = String(examId);
                const payloadExamId = data && data.examId != null ? String(data.examId) : '';
                const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                    ? data.suiteSessionId.trim()
                    : '';
                const payloadSessionId = data && typeof data.sessionId === 'string'
                    ? data.sessionId.trim()
                    : '';
                const payloadWindowSessionToken = data && typeof data.windowSessionToken === 'string'
                    ? data.windowSessionToken.trim()
                    : '';
                const activeSuiteSessionId = this.currentSuiteSession && this.currentSuiteSession.id
                    ? String(this.currentSuiteSession.id)
                    : '';
                const activeSuiteSequence = this.currentSuiteSession && Array.isArray(this.currentSuiteSession.sequence)
                    ? this.currentSuiteSession.sequence
                    : [];
                const isExamInActiveSuite = Boolean(
                    this.currentSuiteSession
                    && activeSuiteSequence.some(item => item && String(item.examId) === expectedExamId)
                );
                const isPayloadExamInActiveSuite = Boolean(
                    this.currentSuiteSession
                    && payloadExamId
                    && activeSuiteSequence.some(item => item && String(item.examId) === payloadExamId)
                );
                const simulationSuiteMessageTypes = new Set([
                    'SIMULATION_DRAFT_SYNC',
                    'SIMULATION_NAVIGATE',
                    'SIMULATION_ACTIVE_EXAM_CHANGE',
                    'SIMULATION_SUBMIT'
                ]);
                const isSimulationSuiteMessage = simulationSuiteMessageTypes.has(type);
                const suiteRoutableMessageTypes = new Set([
                    ...simulationSuiteMessageTypes,
                    'REVIEW_NAVIGATE',
                    'SESSION_READY'
                ]);
                const expectedWindowSessionToken = windowInfo && typeof windowInfo.windowSessionToken === 'string'
                    ? windowInfo.windowSessionToken.trim()
                    : '';
                const permitsPreInitWithoutToken = type === 'REQUEST_INIT'
                    || (type === 'SESSION_READY' && data.initialized !== true);
                if (!permitsPreInitWithoutToken && (
                    !expectedWindowSessionToken
                    || !payloadWindowSessionToken
                    || payloadWindowSessionToken !== expectedWindowSessionToken
                )) {
                    this._reportExamMessageRejected(examId, type, 'token-mismatch', event);
                    return;
                }
                const canRoutePayloadExamInActiveSuite = Boolean(
                    suiteRoutableMessageTypes.has(type)
                    && isPayloadExamInActiveSuite
                    && activeSuiteSessionId
                    && payloadSuiteSessionId
                    && payloadSuiteSessionId === activeSuiteSessionId
                );
                const isReadingAnnotationSync = type === 'READING_ANNOTATION_SYNC';
                const isReadingDraftSync = type === 'READING_DRAFT_SYNC';
                if (isReadingAnnotationSync) {
                    const expectedReviewSessionId = windowInfo && windowInfo.reviewSessionId
                        ? String(windowInfo.reviewSessionId)
                        : '';
                    const payloadReviewSessionId = data && data.reviewSessionId != null
                        ? String(data.reviewSessionId)
                        : '';
                    const payloadRecordId = data && data.recordId != null ? String(data.recordId) : '';
                    const hasStrictSessionBinding = Boolean(
                        expectedSessionId
                        && payloadSessionId
                        && payloadSessionId === expectedSessionId
                    );
                    const hasStrictWindowToken = Boolean(
                        expectedWindowSessionToken
                        && payloadWindowSessionToken
                        && payloadWindowSessionToken === expectedWindowSessionToken
                    );
                    const hasStrictReviewBinding = Boolean(
                        windowInfo
                        && windowInfo.reviewMode
                        && expectedReviewSessionId
                        && payloadReviewSessionId === expectedReviewSessionId
                    );
                    // 单篇阅读 final-submit 后，结果页以已存档 recordId 发送标注同步：
                    // 不在 review 回放态，但 windowInfo.submittedRecordId 必须与 payload
                    // recordId 严格匹配，并仍受 source/会话/窗口 token/题号约束。
                    const hasSubmittedRecordBinding = Boolean(
                        windowInfo
                        && !windowInfo.reviewMode
                        && windowInfo.submittedRecordId
                        && payloadRecordId
                        && payloadRecordId === String(windowInfo.submittedRecordId)
                    );
                    if (
                        !sourceMatched
                        || !hasStrictSessionBinding
                        || !hasStrictWindowToken
                        || (!hasStrictReviewBinding && !hasSubmittedRecordBinding)
                        || !payloadExamId
                        || payloadExamId !== expectedExamId
                    ) {
                        return;
                    }
                }
                if (isReadingDraftSync) {
                    const hasStrictSessionBinding = Boolean(
                        expectedSessionId
                        && payloadSessionId
                        && payloadSessionId === expectedSessionId
                    );
                    const hasStrictWindowToken = Boolean(
                        expectedWindowSessionToken
                        && payloadWindowSessionToken
                        && payloadWindowSessionToken === expectedWindowSessionToken
                    );
                    const isLivePracticeWindow = Boolean(
                        windowInfo
                        && !windowInfo.reviewMode
                        && String(windowInfo.practiceMode || '').toLowerCase() !== 'memorize'
                    );
                    if (
                        !sourceMatched
                        || !hasStrictSessionBinding
                        || !hasStrictWindowToken
                        || !isLivePracticeWindow
                        || !payloadExamId
                        || payloadExamId !== expectedExamId
                    ) {
                        return;
                    }
                }
                if (type === 'SIMULATION_DRAFT_SYNC' && isExamInActiveSuite) {
                    const incomingUpdatedAt = Number(data && (data.draftUpdatedAt
                        ?? (data.draft && data.draft.updatedAt)
                        ?? data.updatedAt));
                    const suiteWindowBound = Boolean(
                        windowInfo
                        && windowInfo.suiteSessionId
                        && String(windowInfo.suiteSessionId) === activeSuiteSessionId
                    );
                    const exactSuiteDraftBinding = Boolean(
                        sourceMatched
                        && suiteWindowBound
                        && payloadSuiteSessionId === activeSuiteSessionId
                        && isPayloadExamInActiveSuite
                        && expectedWindowSessionToken
                        && payloadWindowSessionToken === expectedWindowSessionToken
                        && Number.isFinite(incomingUpdatedAt)
                        && incomingUpdatedAt > 0
                        && this.currentSuiteSession
                        && ['active', 'initializing'].includes(this.currentSuiteSession.status)
                    );
                    if (!exactSuiteDraftBinding) {
                        this._reportExamMessageRejected(examId, type, 'suite-draft-binding-mismatch', event);
                        return;
                    }
                }
                const payloadWindowInfo = payloadExamId && payloadExamId !== expectedExamId && this.examWindows
                    ? this.examWindows.get(payloadExamId)
                    : null;
                const payloadWindowMatches = Boolean(
                    payloadWindowInfo
                    && payloadWindowInfo.window
                    && isLikelySameWindowContext(sourceWindow, payloadWindowInfo.window)
                );
                const payloadWindowSuiteId = payloadWindowInfo && typeof payloadWindowInfo.suiteSessionId === 'string'
                    ? payloadWindowInfo.suiteSessionId.trim()
                    : '';
                const payloadWindowToken = payloadWindowInfo && typeof payloadWindowInfo.windowSessionToken === 'string'
                    ? payloadWindowInfo.windowSessionToken.trim()
                    : '';
                const payloadTokenMatchesExpectedWindow = Boolean(
                    expectedWindowSessionToken
                    && payloadWindowSessionToken
                    && expectedWindowSessionToken === payloadWindowSessionToken
                );
                const payloadTokenMatchesPayloadWindow = Boolean(
                    payloadWindowToken
                    && payloadWindowSessionToken
                    && payloadWindowToken === payloadWindowSessionToken
                );
                if (
                    isPayloadExamInActiveSuite
                    && payloadWindowMatches
                    && payloadWindowSuiteId
                    && payloadSuiteSessionId
                    && payloadWindowSuiteId === payloadSuiteSessionId
                    && payloadTokenMatchesPayloadWindow
                ) {
                    return;
                }
                const isListeningBridgeSource = src === 'listening_record_bridge';
                const isListeningBridgeProtocolMessage = Boolean(
                    isListeningBridgeSource
                    && (
                        type === 'SESSION_READY'
                        || type === 'PRACTICE_COMPLETE'
                        || type === 'PRACTICE_RESULT'
                        || type === 'REQUEST_INIT'
                        || type === 'PROGRESS_UPDATE'
                    )
                );
                const allowSuiteSourceFallback = Boolean(
                    !sourceMatched
                    && payloadExamId
                    && payloadSessionId
                    && expectedSessionId
                    && payloadSessionId === expectedSessionId
                    && payloadTokenMatchesExpectedWindow
                    && (payloadExamId === expectedExamId || isPayloadExamInActiveSuite)
                    && payloadSuiteSessionId
                    && activeSuiteSessionId
                    && payloadSuiteSessionId === activeSuiteSessionId
                );
                const allowListeningSourceFallback = Boolean(
                    !sourceMatched
                    && isListeningBridgeProtocolMessage
                    && payloadTokenMatchesExpectedWindow
                    && payloadExamId
                    && payloadExamId === expectedExamId
                    && payloadSessionId
                    && expectedSessionId
                    && payloadSessionId === expectedSessionId
                    && (!payloadSuiteSessionId || !activeSuiteSessionId || payloadSuiteSessionId === activeSuiteSessionId)
                );
                if (!sourceMatched && !allowSuiteSourceFallback && !allowListeningSourceFallback) {
                    this._reportExamMessageRejected(examId, type, 'window-mismatch', event);
                    return;
                }
                if (windowInfo && sourceWindow && (sourceMatched || !expectedWindow || expectedWindow.closed)) {
                    windowInfo.window = sourceWindow;
                }
                const isSuiteFlowPayload = Boolean(
                    (type === 'PRACTICE_COMPLETE'
                        || type === 'PRACTICE_RESULT'
                        || type === 'REVIEW_NAVIGATE'
                        || type === 'SIMULATION_DRAFT_SYNC'
                        || type === 'SIMULATION_NAVIGATE'
                        || type === 'SIMULATION_ACTIVE_EXAM_CHANGE'
                        || type === 'SIMULATION_SUBMIT'
                        || type === 'SESSION_READY')
                    && payloadSuiteSessionId
                    && activeSuiteSessionId
                    && payloadSuiteSessionId === activeSuiteSessionId
                    && payloadExamId
                    && (payloadExamId === expectedExamId || isPayloadExamInActiveSuite)
                    && (
                        payloadExamId === expectedExamId
                            ? (sourceMatched || payloadTokenMatchesExpectedWindow || !expectedWindowSessionToken)
                            : (payloadTokenMatchesPayloadWindow || payloadWindowMatches || sourceMatched)
                    )
                );

                if (payloadSessionId) {
                    if (expectedSessionId && payloadSessionId !== expectedSessionId) {
                        const windowSuiteSessionId = windowInfo && typeof windowInfo.suiteSessionId === 'string'
                            ? windowInfo.suiteSessionId.trim()
                            : '';
                        const allowSuiteSessionMismatch = Boolean(
                            isSuiteFlowPayload
                            && (
                                (windowSuiteSessionId && windowSuiteSessionId === payloadSuiteSessionId)
                                || isExamInActiveSuite
                            )
                        );
                        const allowListeningSessionMismatch = Boolean(
                            isListeningBridgeProtocolMessage
                            && expectedSessionId
                            && (sourceMatched || allowListeningSourceFallback)
                        );
                        const allowResetSessionMismatch = Boolean(
                            isPracticeResetRequest
                            && expectedSessionId
                            && sourceMatched
                        );
                        if (!allowSuiteSessionMismatch && !allowListeningSessionMismatch && !allowResetSessionMismatch) {
                            return;
                        }
                        data.sessionId = expectedSessionId;
                    } else {
                        windowInfo.sessionId = payloadSessionId;
                        if (!windowInfo.expectedSessionId) {
                            windowInfo.expectedSessionId = payloadSessionId;
                        }
                    }
                } else if (type === 'PRACTICE_COMPLETE' || type === 'PRACTICE_RESULT') {
                    if (!expectedSessionId) {
                        return;
                    }
                    data.sessionId = expectedSessionId;
                }

                if (payloadExamId && payloadExamId !== expectedExamId) {
                    const allowedLegacy = payloadExamId === 'session';
                    const allowListeningExamMismatch = Boolean(
                        isListeningBridgeProtocolMessage
                        && (sourceMatched || allowListeningSourceFallback)
                    );
                    const allowSuiteExamMismatch = Boolean(isSuiteFlowPayload && isPayloadExamInActiveSuite);
                    if (!allowedLegacy && !allowListeningExamMismatch && !allowSuiteExamMismatch) {
                        return;
                    }
                }

                const routedExamId = canRoutePayloadExamInActiveSuite ? payloadExamId : examId;
                data.examId = routedExamId;
                if (!data.sessionId && expectedSessionId) {
                    data.sessionId = expectedSessionId;
                }
                if (
                    (type === 'PRACTICE_COMPLETE' || type === 'PRACTICE_RESULT')
                    && (
                        !String(data.submissionId || '').trim()
                        || !String(data.sessionId || '').trim()
                        || !String(payloadWindowSessionToken || '').trim()
                    )
                ) {
                    this._reportExamMessageRejected(examId, type, 'missing-submission-contract', event);
                    return;
                }

                windowInfo.observedOrigin = event.origin;
                windowInfo.lastMessageAt = Date.now();
                windowInfo.lastMessageType = type;
                if (payloadWindowSessionToken) {
                    windowInfo.lastWindowSessionToken = payloadWindowSessionToken;
                }
                this.examWindows.set(examId, windowInfo);

                switch (type) {
                    case 'exam_completed':
                        this.handleExamCompleted(examId, data);
                        break;
                    case 'exam_progress':
                        this.handleExamProgress(examId, data);
                        break;
                    case 'exam_error':
                        this.handleExamError(examId, data);
                        break;
                    // 新增：处理数据采集器的消息
                    case 'SESSION_READY':
                        this.handleSessionReady(examId, data, expectedRegistration);
                        if (typeof this._maybeRestoreSuiteReviewState === 'function') {
                            this._maybeRestoreSuiteReviewState(examId, sourceWindow || expectedWindow, windowInfo).catch((restoreError) => {
                                console.warn('[SuitePractice] 恢复回看态失败:', restoreError);
                            });
                        }
                        break;
                    case 'PROGRESS_UPDATE':
                        this.handleProgressUpdate(examId, data);
                        break;
                    case 'PRACTICE_COMPLETE':
                    case 'PRACTICE_RESULT':
                        if (windowInfo && windowInfo.reviewMode) {
                            console.info('[ReviewReplay] 回顾模式忽略 PRACTICE_COMPLETE:', examId);
                            break;
                        }
                        if (
                            (windowInfo && windowInfo.practiceMode === 'memorize')
                            || String(data?.practiceMode || data?.metadata?.practiceMode || '').toLowerCase() === 'memorize'
                        ) {
                            console.info('[ReadingMemorize] 背题模式结果仅在统一阅读页内展示，跳过练习记录:', examId);
                            break;
                        }
                        if (data && data.suiteSessionId && windowInfo
                            && !Object.prototype.hasOwnProperty.call(windowInfo, 'suiteSessionId')) {
                            windowInfo.suiteSessionId = data.suiteSessionId;
                            this.examWindows && this.examWindows.set(examId, windowInfo);
                        }
                        await this.handlePracticeComplete(examId, data, sourceWindow || expectedWindow, {
                            expectedRegistration
                        });
                        break;
                    case 'ERROR_OCCURRED':
                        this.handleDataCollectionError(examId, data);
                        break;
                    case 'REQUEST_INIT':
                        sendInitEnvelope(sourceWindow || examWindow);
                        break;
                    case 'PRACTICE_RESET_REQUEST':
                        await this.handlePracticeResetRequest(examId, data, sourceWindow || expectedWindow, expectedRegistration);
                        break;
                    case 'SUITE_CLOSE_ATTEMPT':
                        console.warn('[SuitePractice] 练习页尝试关闭套题窗口:', data);
                        break;
                    case 'SUITE_CONFIG_UPDATE': {
                        const autoAdvance = typeof data.autoAdvanceAfterSubmit === 'boolean'
                            ? data.autoAdvanceAfterSubmit
                            : true;
                        if (!window.practiceConfig || typeof window.practiceConfig !== 'object') {
                            window.practiceConfig = {};
                        }
                        if (!window.practiceConfig.suite || typeof window.practiceConfig.suite !== 'object') {
                            window.practiceConfig.suite = {};
                        }
                        window.practiceConfig.suite.autoAdvanceAfterSubmit = autoAdvance;
                        await window.AppData.preferences.patchSuite({ autoAdvanceAfterSubmit: autoAdvance });
                        break;
                    }
                    case 'VOCAB_HIGHLIGHT_SAVE':
                        if (!data || !String(data.requestId || '').trim()) {
                            this._reportExamMessageRejected(examId, type, 'missing-request-id', event);
                            break;
                        }
                        try {
                            const saved = typeof window.saveReadingHighlightVocab === 'function'
                                ? await window.saveReadingHighlightVocab(data)
                                : null;
                            this._announceVocabHighlightOutcome(
                                examId,
                                data,
                                sourceWindow || expectedWindow,
                                Boolean(saved),
                                saved ? '' : 'save_failed'
                            );
                        } catch (saveError) {
                            console.warn('[VocabStore] 阅读高亮生词保存异常:', saveError);
                            this._announceVocabHighlightOutcome(
                                examId,
                                data,
                                sourceWindow || expectedWindow,
                                false,
                                'save_failed'
                            );
                        }
                        break;
                    case 'REVIEW_NAVIGATE':
                        if (data && typeof this.handleSuiteReviewNavigate === 'function') {
                            const activeSuiteId = this.currentSuiteSession && this.currentSuiteSession.id
                                ? String(this.currentSuiteSession.id)
                                : '';
                            const windowSuiteId = windowInfo && windowInfo.suiteSessionId
                                ? String(windowInfo.suiteSessionId)
                                : '';
                            const isExplicitSuiteNavigate = data.suiteReviewMode === true;
                            const isActiveSuiteWindow = Boolean(windowSuiteId && activeSuiteId && windowSuiteId === activeSuiteId);
                            if (isExplicitSuiteNavigate || isActiveSuiteWindow) {
                                const payloadExamId = data.examId != null ? String(data.examId).trim() : '';
                                const hasPayloadExamInActiveSuite = Boolean(
                                    payloadExamId
                                    && this.currentSuiteSession
                                    && Array.isArray(this.currentSuiteSession.sequence)
                                    && this.currentSuiteSession.sequence.some(item => item && item.examId === payloadExamId)
                                );
                                const routedExamId = hasPayloadExamInActiveSuite ? payloadExamId : examId;
                                const handledSuiteReview = await this.handleSuiteReviewNavigate(routedExamId, data, sourceWindow || expectedWindow);
                                if (handledSuiteReview) {
                                    break;
                                }
                            }
                        }
                        await this.handleReviewReplayNavigate(examId, data, sourceWindow || expectedWindow);
                        break;
                    case 'SIMULATION_DRAFT_SYNC':
                        if (typeof this._handleSuiteDraftSync === 'function') {
                            await this._handleSuiteDraftSync(routedExamId, data, windowInfo, sourceWindow || expectedWindow);
                        }
                        break;
                    case 'READING_DRAFT_SYNC':
                        await this._queueReadingDraftSync(routedExamId, data, windowInfo);
                        break;
                    case 'READING_ANNOTATION_SYNC':
                        await this._queueReadingAnnotationSync(routedExamId, data, windowInfo);
                        break;
                    case 'SIMULATION_NAVIGATE':
                        if (typeof this._handleSimulationNavigate === 'function') {
                            await this._handleSimulationNavigate(routedExamId, data, sourceWindow || expectedWindow);
                        }
                        break;
                    case 'SIMULATION_ACTIVE_EXAM_CHANGE':
                        if (
                            this.currentSuiteSession
                            && isPayloadExamInActiveSuite
                            && (
                                !payloadSuiteSessionId
                                || !activeSuiteSessionId
                                || payloadSuiteSessionId === activeSuiteSessionId
                            )
                        ) {
                            const activeIndex = activeSuiteSequence.findIndex(item => item && String(item.examId) === routedExamId);
                            this.currentSuiteSession.activeExamId = routedExamId;
                            if (activeIndex >= 0) {
                                this.currentSuiteSession.currentIndex = activeIndex;
                            }
                            this.currentSuiteSession.lastUpdate = Date.now();
                            if (sourceWindow && !sourceWindow.closed) {
                                this.currentSuiteSession.windowRef = sourceWindow;
                            }
                            if (Number.isFinite(Number(data.elapsed))) {
                                if (typeof this._deriveSuiteExamElapsedSeconds === 'function') {
                                    this.currentSuiteSession.elapsedByExam[routedExamId] = this._deriveSuiteExamElapsedSeconds(
                                        this.currentSuiteSession,
                                        routedExamId,
                                        Number(data.elapsed)
                                    );
                                } else {
                                    this.currentSuiteSession.elapsedByExam[routedExamId] = Math.max(0, Number(data.elapsed));
                                }
                            }
                            if (typeof this._mirrorSessionToStorage === 'function') {
                                this._mirrorSessionToStorage(this.currentSuiteSession);
                            }
                        }
                        break;
                    case 'SIMULATION_SUBMIT':
                        if (windowInfo && windowInfo.reviewMode) {
                            break;
                        }
                        await this.handlePracticeComplete(routedExamId, data, sourceWindow || expectedWindow, {
                            expectedRegistration: routedExamId === examId ? expectedRegistration : null
                        });
                        break;
                    default:
                }
            };

            if (this.messageHandlers && this.messageHandlers.has(examId)) {
                try {
                    const previousHandler = this.messageHandlers.get(examId);
                    if (previousHandler) {
                        window.removeEventListener('message', previousHandler);
                    }
                } catch (_) {
                    // ignore stale listener cleanup errors
                }
                this.messageHandlers.delete(examId);
            }
            window.addEventListener('message', messageHandler);

            // 存储消息处理器以便清理
            if (!this.messageHandlers) {
                this.messageHandlers = new Map();
            }
            this.messageHandlers.set(examId, messageHandler);

            const sendInitEnvelope = (targetWindow) => this._sendExamInitEnvelope(
                examId,
                targetWindow,
                {},
                expectedRegistration
            );

            const tryAttachInitHandler = (targetWindow) => {
                if (!targetWindow || isFileProtocol) {
                    return false;
                }
                try {
                    if (typeof targetWindow.addEventListener === 'function') {
                        targetWindow.addEventListener('load', () => sendInitEnvelope(targetWindow));
                        return true;
                    }
                } catch (attachError) {
                    console.warn('[App] 监听题目窗口 load 事件失败:', attachError);
                }
                return false;
            };

            let initAttached = Boolean(options && options.deferInitialHandshake);

            if (!initAttached) {
                try {
                    const guardedWindow = this._guardExamWindowContent(examWindow, exam, options);
                    if (guardedWindow) {
                        examWindow = guardedWindow;
                        initAttached = tryAttachInitHandler(examWindow);
                    }
                } catch (guardError) {
                    console.warn('[App] 无法为题目窗口提供占位内容:', guardError);
                }
            }

            if (!initAttached) {
                sendInitEnvelope(examWindow);
            }
            return expectedRegistration;
        },

        /**
         * 与练习页建立握手（重复发送 INIT_SESSION，直到收到 SESSION_READY）
         */
        startExamHandshake(examWindow, examId, expectedRegistration = null) {
            if (!this._handshakeTimers) this._handshakeTimers = new Map();

            // 避免重复握手
            if (this._handshakeTimers.has(examId)) return;

            let attempts = 0;
            const maxAttempts = 30; // ~9s
            const tick = async () => {
                if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                    clearInterval(timer);
                    if (this._handshakeTimers.get(examId) === timer) this._handshakeTimers.delete(examId);
                    return;
                }
                if (examWindow && !examWindow.closed) {
                    try {
                        const windowInfo = expectedRegistration
                            ? expectedRegistration.windowInfo
                            : this.ensureExamWindowSession(examId, examWindow);
                        windowInfo.handshakeAttempts = attempts + 1;
                        windowInfo.lastHandshakeAt = Date.now();
                        this.examWindows && this.examWindows.set(examId, windowInfo);
                        await this._sendExamInitEnvelope(examId, examWindow, {}, expectedRegistration);
                    } catch (_) { /* 忽略 */ }
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    this._handshakeTimers.delete(examId);
                    console.warn('[App] 握手超时，练习页可能未加载增强器');
                }
            };
            const timer = setInterval(() => { tick(); }, 300);
            this._handshakeTimers.set(examId, timer);
            // 立即发送一次
            tick();
        },

        // ExamBrowser组件已移除，使用内置的题目列表功能

        /**
         * 格式化时长
         */
        formatDuration(seconds) {
            if (seconds < 60) {
                return `${seconds}秒`;
            } else if (seconds < 3600) {
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`;
            } else {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
            }
        },

        /**
         * 格式化日期
         */
        formatDate(dateString, format = 'YYYY-MM-DD HH:mm') {
            const date = new Date(dateString);
            if (format === 'HH:mm') {
                return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            }
            return date.toLocaleString('zh-CN');
        },

        /**
         * 检查是否为移动设备
         */
        isMobile() {
            return window.innerWidth <= 768;
        },

        /**
         * 创建简单的练习记录
         */
        createSimplePracticeRecord(exam, realData) {
            const now = new Date();
            const recordId = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // 提取分数信息
            const scoreInfo = realData.scoreInfo || {};
            const score = scoreInfo.correct || 0;
            const totalQuestions = scoreInfo.total || Object.keys(realData.answers || {}).length;
            const accuracy = scoreInfo.accuracy || (totalQuestions > 0 ? score / totalQuestions : 0);
            const answerComparison = realData.answerComparison && typeof realData.answerComparison === 'object'
                ? realData.answerComparison
                : {};
            const questionTypeMap = realData.questionTypeMap && typeof realData.questionTypeMap === 'object'
                ? realData.questionTypeMap
                : {};
            const questionTypePerformance = realData.questionTypePerformance && typeof realData.questionTypePerformance === 'object'
                ? realData.questionTypePerformance
                : {};

            return {
                id: recordId,
                examId: exam.id,
                title: exam.title,
                category: exam.category,
                frequency: exam.frequency,

                // 真实数据标识
                dataSource: 'real',
                isRealData: true,

                // 基本信息
                startTime: realData.startTime ? new Date(realData.startTime).toISOString() :
                    new Date(Date.now() - realData.duration * 1000).toISOString(),
                endTime: realData.endTime ? new Date(realData.endTime).toISOString() : now.toISOString(),
                date: now.toISOString(),

                // 成绩数据
                score: score,
                totalQuestions: totalQuestions,
                accuracy: accuracy,
                percentage: Math.round(accuracy * 100),
                duration: realData.duration, // 秒
                answerComparison,
                questionTypeMap,
                questionTypePerformance,

                // 详细数据
                realData: {
                    sessionId: realData.sessionId,
                    answers: realData.answers || {},
                    answerComparison,
                    questionTypeMap,
                    questionTypePerformance,
                    interactions: realData.interactions || [],
                    scoreInfo: scoreInfo,
                    pageType: realData.pageType,
                    url: realData.url,
                    source: scoreInfo.source || 'fallback_recorder'
                }
            };
        },

        /**
         * 生成会话ID
         */
        generateSessionId(examId) {
            const suffix = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const normalizedExamId = typeof examId === 'string'
                ? examId.trim().replace(/\s+/g, '-')
                : (examId != null ? String(examId).trim().replace(/\s+/g, '-') : '');

            if (normalizedExamId) {
                return `${normalizedExamId}_${suffix}`;
            }

            return `session_${suffix}`;
        },

        generateWindowSessionToken(examId) {
            const cryptoApi = global.crypto;
            if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
                throw new Error('Secure random generator is required for window session tokens');
            }
            const bytes = new Uint8Array(24);
            cryptoApi.getRandomValues(bytes);
            const suffix = Array.from(bytes)
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
            const normalizedExamId = typeof examId === 'string'
                ? examId.trim().replace(/\s+/g, '-')
                : (examId != null ? String(examId).trim().replace(/\s+/g, '-') : '');
            return normalizedExamId
                ? `win_${normalizedExamId}_${suffix}`
                : `win_${suffix}`;
        },

        _refreshExamWindowToken(examId, windowInfo = {}) {
            const info = windowInfo || {};
            const expectedSessionId = info.expectedSessionId
                ? String(info.expectedSessionId).trim()
                : '';
            const boundSessionId = info.windowSessionTokenSessionId
                ? String(info.windowSessionTokenSessionId).trim()
                : '';
            if (!info.windowSessionToken || !expectedSessionId || boundSessionId !== expectedSessionId) {
                info.windowSessionToken = this.generateWindowSessionToken(examId);
                info.windowSessionTokenSessionId = expectedSessionId || null;
            }
            return info.windowSessionToken;
        },

        _cloneReviewData(value) {
            if (value == null) {
                return value;
            }
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (_) {
                return value;
            }
        },

        _isReplayObject(value) {
            return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
        },

        _normalizeReplayQuestionKey(rawKey) {
            if (rawKey == null) {
                return '';
            }
            const key = String(rawKey).trim();
            if (!key) {
                return '';
            }
            if (/^q\d+$/i.test(key)) {
                return key.toLowerCase();
            }
            const numericOnly = key.match(/^\d+$/);
            if (numericOnly) {
                return `q${numericOnly[0]}`;
            }
            const ranged = key.match(/^q?(\d+\s*-\s*\d+)$/i);
            if (ranged) {
                return `q${ranged[1].replace(/\s+/g, '')}`;
            }
            const questionMatch = key.match(/^question[-_\s]*(\d+)$/i);
            if (questionMatch) {
                return `q${questionMatch[1]}`;
            }
            return key;
        },

        _splitReplayCompositeKey(rawKey) {
            if (rawKey == null) {
                return { examPrefix: '', questionKey: '' };
            }
            const key = String(rawKey).trim();
            if (!key) {
                return { examPrefix: '', questionKey: '' };
            }
            const sep = key.indexOf('::');
            if (sep === -1) {
                return {
                    examPrefix: '',
                    questionKey: this._normalizeReplayQuestionKey(key)
                };
            }
            const examPrefix = key.slice(0, sep).trim();
            const questionKey = this._normalizeReplayQuestionKey(key.slice(sep + 2));
            return { examPrefix, questionKey };
        },

        _normalizeReplayAnswerMap(rawMap, targetExamId = '', allowUnprefixed = true) {
            const normalized = {};
            if (!this._isReplayObject(rawMap)) {
                return normalized;
            }
            const normalizedTarget = targetExamId ? String(targetExamId).trim().toLowerCase() : '';
            Object.entries(rawMap).forEach(([rawKey, rawValue]) => {
                const split = this._splitReplayCompositeKey(rawKey);
                if (!split.questionKey) {
                    return;
                }
                const hasPrefix = !!split.examPrefix;
                if (hasPrefix) {
                    if (!normalizedTarget || split.examPrefix.toLowerCase() !== normalizedTarget) {
                        return;
                    }
                } else if (!allowUnprefixed) {
                    return;
                }
                normalized[split.questionKey] = this._cloneReviewData(rawValue);
            });
            return normalized;
        },

        _mergeReplayAnswerMapsFirstWins(target, targetExamId, allowUnprefixed) {
            const bucket = this._isReplayObject(target) ? target : {};
            const sources = Array.prototype.slice.call(arguments, 3);
            sources.forEach((source) => {
                const normalized = this._normalizeReplayAnswerMap(source, targetExamId, allowUnprefixed);
                Object.entries(normalized).forEach(([questionId, value]) => {
                    if (!Object.prototype.hasOwnProperty.call(bucket, questionId)) {
                        bucket[questionId] = this._cloneReviewData(value);
                    }
                });
            });
            return bucket;
        },

        _normalizeReplayComparison(rawComparison, targetExamId = '', allowUnprefixed = true) {
            const normalized = {};
            if (!this._isReplayObject(rawComparison)) {
                return normalized;
            }
            const normalizedTarget = targetExamId ? String(targetExamId).trim().toLowerCase() : '';
            Object.entries(rawComparison).forEach(([rawKey, rawValue]) => {
                const split = this._splitReplayCompositeKey(rawKey);
                if (!split.questionKey) {
                    return;
                }
                const hasPrefix = !!split.examPrefix;
                if (hasPrefix) {
                    if (!normalizedTarget || split.examPrefix.toLowerCase() !== normalizedTarget) {
                        return;
                    }
                } else if (!allowUnprefixed) {
                    return;
                }
                const entry = this._isReplayObject(rawValue) ? rawValue : { userAnswer: rawValue };
                normalized[split.questionKey] = {
                    questionId: split.questionKey,
                    userAnswer: this._cloneReviewData(entry.userAnswer),
                    correctAnswer: this._cloneReviewData(entry.correctAnswer),
                    isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
                };
            });
            return normalized;
        },

        _deriveReplayExamIdFromSources(...sources) {
            for (let i = 0; i < sources.length; i += 1) {
                const source = sources[i];
                if (!this._isReplayObject(source)) {
                    continue;
                }
                const keys = Object.keys(source);
                for (let j = 0; j < keys.length; j += 1) {
                    const split = this._splitReplayCompositeKey(keys[j]);
                    if (split.examPrefix) {
                        return split.examPrefix;
                    }
                }
            }
            return '';
        },

        _resolveReplayCorrectAnswerMap(source, options) {
            const entry = this._isReplayObject(source) ? source : {};
            const realData = this._isReplayObject(entry.realData) ? entry.realData : {};
            const rawData = this._isReplayObject(entry.rawData) ? entry.rawData : {};
            const rawRealData = this._isReplayObject(rawData.realData) ? rawData.realData : {};
            const config = this._isReplayObject(options) ? options : {};
            const targetExamId = String(
                config.examId
                || entry.examId
                || realData.examId
                || rawData.examId
                || rawRealData.examId
                || ''
            ).trim();
            const allowUnprefixed = config.allowUnprefixed !== false;
            // Suite entries persist answerComparison but historically dropped
            // correctAnswerMap, so derive from the comparison as a last resort.
            return this._mergeReplayAnswerMapsFirstWins({},
                targetExamId,
                allowUnprefixed,
                entry.correctAnswerMap,
                realData.correctAnswerMap,
                rawData.correctAnswerMap,
                rawRealData.correctAnswerMap,
                this._deriveCorrectAnswerMapFromComparison(entry.answerComparison),
                this._deriveCorrectAnswerMapFromComparison(realData.answerComparison),
                this._deriveCorrectAnswerMapFromComparison(rawData.answerComparison),
                this._deriveCorrectAnswerMapFromComparison(rawRealData.answerComparison)
            );
        },

        _deriveCorrectAnswerMapFromComparison(comparison) {
            if (!this._isReplayObject(comparison)) {
                return null;
            }
            const derived = {};
            Object.entries(comparison).forEach(([questionId, detail]) => {
                if (!this._isReplayObject(detail)) {
                    return;
                }
                const correctAnswer = detail.correctAnswer;
                // Only real answers: a blank or empty value must stay unknown so
                // the comparison degrades to isCorrect: null instead of guessing.
                if (correctAnswer == null) {
                    return;
                }
                if (typeof correctAnswer === 'string' && !correctAnswer.trim()) {
                    return;
                }
                if (Array.isArray(correctAnswer) && !correctAnswer.length) {
                    return;
                }
                derived[questionId] = correctAnswer;
            });
            return Object.keys(derived).length ? derived : null;
        },

        _finalizeReplayComparison(answers, correctAnswers, comparison) {
            const merged = this._isReplayObject(comparison) ? comparison : {};
            const keySet = new Set([
                ...Object.keys(answers || {}),
                ...Object.keys(correctAnswers || {}),
                ...Object.keys(merged || {})
            ]);
            keySet.forEach((questionId) => {
                if (!questionId) {
                    return;
                }
                const existing = merged[questionId] && this._isReplayObject(merged[questionId])
                    ? merged[questionId]
                    : {};
                const userAnswer = Object.prototype.hasOwnProperty.call(existing, 'userAnswer')
                    ? existing.userAnswer
                    : (Object.prototype.hasOwnProperty.call(answers, questionId) ? answers[questionId] : '');
                const hasCanonicalCorrectAnswer = Object.prototype.hasOwnProperty.call(correctAnswers, questionId);
                const correctAnswer = hasCanonicalCorrectAnswer ? correctAnswers[questionId] : '';
                let isCorrect = null;
                if (hasCanonicalCorrectAnswer && userAnswer != null && correctAnswer != null && String(correctAnswer).trim()) {
                    const matchCore = global.AnswerMatchCore;
                    if (matchCore && typeof matchCore.compareAnswers === 'function') {
                        isCorrect = matchCore.compareAnswers(userAnswer, correctAnswer);
                    } else {
                        isCorrect = String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
                    }
                }
                merged[questionId] = {
                    questionId,
                    userAnswer: this._cloneReviewData(userAnswer),
                    correctAnswer: this._cloneReviewData(correctAnswer),
                    isCorrect
                };
            });
            return merged;
        },

        _deriveReplayScoreInfo(sourceScoreInfo, comparison, preferDerived = false) {
            const scoreInfo = this._isReplayObject(sourceScoreInfo) ? this._cloneReviewData(sourceScoreInfo) : {};
            const stats = {
                total: 0,
                correct: 0
            };
            Object.values(comparison || {}).forEach((entry) => {
                if (!this._isReplayObject(entry)) {
                    return;
                }
                const hasContent = entry.userAnswer != null
                    || entry.correctAnswer != null
                    || typeof entry.isCorrect === 'boolean';
                if (!hasContent) {
                    return;
                }
                stats.total += 1;
                if (entry.isCorrect === true) {
                    stats.correct += 1;
                }
            });

            const resolvedTotal = Number(scoreInfo.total ?? scoreInfo.totalQuestions);
            const resolvedCorrect = Number(scoreInfo.correct ?? scoreInfo.score);
            const finalTotal = preferDerived || !Number.isFinite(resolvedTotal) || resolvedTotal < 0 ? stats.total : resolvedTotal;
            const finalCorrect = preferDerived || !Number.isFinite(resolvedCorrect) || resolvedCorrect < 0 ? stats.correct : resolvedCorrect;
            const derivedAccuracy = finalTotal > 0 ? finalCorrect / finalTotal : 0;
            const resolvedAccuracy = Number(scoreInfo.accuracy);
            const finalAccuracy = preferDerived || !Number.isFinite(resolvedAccuracy) ? derivedAccuracy : resolvedAccuracy;
            const resolvedPercentage = Number(scoreInfo.percentage);
            const finalPercentage = !preferDerived && Number.isFinite(resolvedPercentage)
                ? resolvedPercentage
                : Math.round(finalAccuracy * 100);

            scoreInfo.correct = finalCorrect;
            scoreInfo.total = finalTotal;
            scoreInfo.totalQuestions = finalTotal;
            scoreInfo.accuracy = finalAccuracy;
            scoreInfo.percentage = finalPercentage;
            return scoreInfo;
        },

        _hasCompleteReplayCorrectAnswerMap(correctAnswers, comparison, sourceScoreInfo = {}) {
            if (!this._isReplayObject(correctAnswers) || !this._isReplayObject(comparison)) {
                return false;
            }
            const correctKeys = Object.keys(correctAnswers);
            const comparisonKeys = Object.keys(comparison);
            if (correctKeys.length === 0 || comparisonKeys.length === 0) {
                return false;
            }
            const scoreInfo = this._isReplayObject(sourceScoreInfo) ? sourceScoreInfo : {};
            const scoreTotal = Number(scoreInfo.total ?? scoreInfo.totalQuestions);
            if (Number.isFinite(scoreTotal) && scoreTotal > comparisonKeys.length) {
                return false;
            }
            return comparisonKeys.every(key => Object.prototype.hasOwnProperty.call(correctAnswers, key));
        },

        _normalizeReplayNonNegativeNumber(value) {
            let candidate = value;
            if (typeof candidate === 'string') {
                candidate = candidate.trim();
                if (!candidate) return null;
            } else if (typeof candidate !== 'number') {
                return null;
            }
            const numeric = Number(candidate);
            return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
        },

        _resolveReplaySourceScoreInfo(entry, record, isSuiteEntry = false, allowSingleEntryParentFallback = false) {
            const scoreInfo = {};
            const scoreSourceGroups = [];
            const mergeScoreInfo = (source) => {
                if (!this._isReplayObject(source)) return;
                Object.assign(scoreInfo, this._cloneReviewData(source));
            };
            const collectScoreAliases = (source) => {
                if (!this._isReplayObject(source)) return;
                scoreSourceGroups.push({
                    root: source,
                    nested: this._isReplayObject(source.scoreInfo) ? source.scoreInfo : null
                });
            };
            const normalizeNonNegative = value => this._normalizeReplayNonNegativeNumber(value);
            const normalizeAccuracy = (value) => {
                const numeric = normalizeNonNegative(value);
                if (numeric === null || numeric > 100) return null;
                return numeric > 1 ? numeric / 100 : numeric;
            };
            const normalizePercentage = (value) => {
                const numeric = normalizeNonNegative(value);
                return numeric !== null && numeric <= 100 ? numeric : null;
            };
            const hasUsableScoreAlias = (source) => {
                if (!this._isReplayObject(source)) return false;
                return ['correct', 'correctAnswers', 'score', 'total', 'totalQuestions']
                    .some(key => normalizeNonNegative(source[key]) !== null)
                    || normalizeAccuracy(source.accuracy) !== null
                    || normalizePercentage(source.percentage) !== null;
            };
            const entryHasUsableScore = [
                entry.rawData,
                entry.rawData?.scoreInfo,
                entry.realData,
                entry.realData?.scoreInfo,
                entry,
                entry.scoreInfo
            ].some(hasUsableScoreAlias);
            const includeParentScore = !isSuiteEntry
                || (allowSingleEntryParentFallback && !entryHasUsableScore);
            const resolveFromAliasSource = (source, keys, normalize = normalizeNonNegative) => {
                if (!this._isReplayObject(source)) return null;
                for (const key of keys) {
                    const normalized = normalize(source[key]);
                    if (normalized === null) continue;
                    return normalized;
                }
                return null;
            };
            const resolvePreferredMetric = (keys, normalize) => {
                for (let sourceIndex = scoreSourceGroups.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
                    const { root, nested } = scoreSourceGroups[sourceIndex];
                    // AppData canonicalizes accuracy and percentage at the
                    // provenance root; nested scoreInfo remains its fallback.
                    const rootMetric = resolveFromAliasSource(root, keys, normalize);
                    if (rootMetric !== null) return rootMetric;
                    const nestedMetric = resolveFromAliasSource(nested, keys, normalize);
                    if (nestedMetric !== null) return nestedMetric;
                }
                return null;
            };
            const resolvePreferredCounter = ({ canonicalRootKey, nestedKeys, rootLegacyKeys }) => {
                for (let sourceIndex = scoreSourceGroups.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
                    const { root, nested } = scoreSourceGroups[sourceIndex];
                    const normalized = normalizeNonNegative(root[canonicalRootKey]);
                    if (normalized !== null) {
                        // AppData projects a missing canonical correct count as
                        // `correctAnswers: 0` while retaining a legacy positive
                        // `score` under scoreInfo. Only that generated root zero
                        // may yield to nested score provenance.
                        if (canonicalRootKey === 'correctAnswers' && normalized === 0) {
                            const hasCanonicalNestedCount = ['correct', 'correctAnswers'].some(
                                nestedKey => normalizeNonNegative(nested?.[nestedKey]) !== null
                            );
                            const copiedScore = normalizeNonNegative(nested?.score);
                            if (!hasCanonicalNestedCount && copiedScore !== null && copiedScore > 0) {
                                return resolveFromAliasSource(nested, nestedKeys) ?? copiedScore;
                            }
                        }
                        return normalized;
                    }

                    const nestedCounter = resolveFromAliasSource(nested, nestedKeys);
                    if (nestedCounter !== null) return nestedCounter;

                    const rootLegacyCounter = resolveFromAliasSource(root, rootLegacyKeys);
                    if (rootLegacyCounter !== null) return rootLegacyCounter;
                }
                return null;
            };

            if (includeParentScore) {
                mergeScoreInfo(record.rawData?.scoreInfo);
                mergeScoreInfo(record.realData?.scoreInfo);
                mergeScoreInfo(record.scoreInfo);
            }
            mergeScoreInfo(entry.rawData?.scoreInfo);
            mergeScoreInfo(entry.realData?.scoreInfo);
            mergeScoreInfo(entry.scoreInfo);

            // AppData's canonical/light records expose numeric score totals at
            // the entry root. Parent totals stay out of suite children except
            // for the structurally equivalent one-entry suite whose child has
            // no usable score of its own.
            if (includeParentScore) {
                collectScoreAliases(record.rawData);
                collectScoreAliases(record.realData);
                collectScoreAliases(record);
            }
            collectScoreAliases(entry.rawData);
            collectScoreAliases(entry.realData);
            collectScoreAliases(entry);

            // Resolve each provenance atomically so an authoritative value
            // cannot be replaced by a stale alias from a lower-priority source.
            delete scoreInfo.correct;
            delete scoreInfo.total;
            delete scoreInfo.totalQuestions;
            delete scoreInfo.accuracy;
            delete scoreInfo.percentage;
            const correct = resolvePreferredCounter({
                canonicalRootKey: 'correctAnswers',
                nestedKeys: ['correct', 'correctAnswers', 'score'],
                rootLegacyKeys: ['correct', 'score']
            });
            const total = resolvePreferredCounter({
                canonicalRootKey: 'totalQuestions',
                nestedKeys: ['total', 'totalQuestions'],
                rootLegacyKeys: ['total']
            });
            const accuracy = resolvePreferredMetric(['accuracy'], normalizeAccuracy);
            const percentage = resolvePreferredMetric(['percentage'], normalizePercentage);
            if (correct !== null) scoreInfo.correct = correct;
            if (total !== null) {
                scoreInfo.total = total;
                scoreInfo.totalQuestions = total;
            }
            if (accuracy !== null) scoreInfo.accuracy = accuracy;
            if (percentage !== null) scoreInfo.percentage = percentage;
            return scoreInfo;
        },

        _resolveReplayTimestampValue(...values) {
            for (const value of values) {
                if (value === null || value === undefined || value === '') continue;
                let timestampMs = null;
                if (typeof value === 'number' || /^[+-]?\d+(?:\.\d+)?$/.test(String(value).trim())) {
                    const numeric = Number(value);
                    if (Number.isFinite(numeric) && numeric > 0) {
                        timestampMs = numeric < 100000000000
                            ? Math.round(numeric * 1000)
                            : Math.round(numeric);
                    }
                } else {
                    const parsed = Date.parse(String(value));
                    if (Number.isFinite(parsed) && parsed > 0) {
                        timestampMs = parsed;
                    }
                }
                if (timestampMs !== null && Number.isFinite(new Date(timestampMs).getTime())) {
                    return value;
                }
            }
            return null;
        },

        _collectReplayDurationAliases(source) {
            if (!this._isReplayObject(source)) return [];
            return [
                source.duration,
                source.durationSeconds,
                source.duration_seconds,
                source.elapsedSeconds,
                source.elapsed_seconds,
                source.timeSpent,
                source.time_spent,
                source.scoreInfo?.duration,
                source.scoreInfo?.durationSeconds,
                source.scoreInfo?.duration_seconds,
                source.scoreInfo?.elapsedSeconds,
                source.scoreInfo?.elapsed_seconds,
                source.scoreInfo?.timeSpent,
                source.scoreInfo?.time_spent,
                source.realData?.duration,
                source.realData?.durationSeconds,
                source.realData?.duration_seconds,
                source.realData?.elapsedSeconds,
                source.realData?.elapsed_seconds,
                source.realData?.timeSpent,
                source.realData?.time_spent,
                source.realData?.scoreInfo?.duration,
                source.realData?.scoreInfo?.durationSeconds,
                source.realData?.scoreInfo?.duration_seconds,
                source.realData?.scoreInfo?.elapsedSeconds,
                source.realData?.scoreInfo?.elapsed_seconds,
                source.realData?.scoreInfo?.timeSpent,
                source.realData?.scoreInfo?.time_spent,
                source.rawData?.duration,
                source.rawData?.durationSeconds,
                source.rawData?.duration_seconds,
                source.rawData?.elapsedSeconds,
                source.rawData?.elapsed_seconds,
                source.rawData?.timeSpent,
                source.rawData?.time_spent,
                source.rawData?.scoreInfo?.duration,
                source.rawData?.scoreInfo?.durationSeconds,
                source.rawData?.scoreInfo?.duration_seconds,
                source.rawData?.scoreInfo?.elapsedSeconds,
                source.rawData?.scoreInfo?.elapsed_seconds,
                source.rawData?.scoreInfo?.timeSpent,
                source.rawData?.scoreInfo?.time_spent
            ];
        },

        _resolveReplayDurationValue(...groups) {
            const provenanceGroups = groups.every(Array.isArray) ? groups : [groups];
            for (const values of provenanceGroups) {
                // AppData promotes legacy aliases when a canonical duration is
                // missing, so field order can preserve an explicit root zero.
                for (const value of values) {
                    const numeric = this._normalizeReplayNonNegativeNumber(value);
                    if (numeric !== null) return numeric;
                }
            }
            return null;
        },

        _collectReplayQuestionIds(entry) {
            const keys = new Set();
            const collect = (source) => {
                if (!this._isReplayObject(source)) {
                    return;
                }
                Object.keys(source).forEach((key) => {
                    const normalized = this._normalizeReplayQuestionKey(key);
                    if (normalized) {
                        keys.add(normalized);
                    }
                });
            };
            collect(entry.answers);
            collect(entry.correctAnswerMap);
            collect(entry.correctAnswers);
            collect(entry.answerComparison);
            if (Array.isArray(entry.allQuestionIds)) {
                entry.allQuestionIds.forEach((key) => {
                    const normalized = this._normalizeReplayQuestionKey(key);
                    if (normalized) {
                        keys.add(normalized);
                    }
                });
            }
            return Array.from(keys).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        },

        _buildReviewReplayEntriesFromRecord(record) {
            if (!record || typeof record !== 'object') {
                return [];
            }
            const recordMetadata = this._isReplayObject(record.metadata) ? record.metadata : {};
            const hasSuiteEntries = Array.isArray(record.suiteEntries) && record.suiteEntries.length > 0;
            const baseEntries = hasSuiteEntries ? record.suiteEntries : [record];
            const isAggregated = baseEntries.length > 1;
            const recordAnswersSource = this._isReplayObject(record.answers) ? record.answers : (this._isReplayObject(record.realData?.answers) ? record.realData.answers : {});
            const recordComparisonSource = this._isReplayObject(record.answerComparison) ? record.answerComparison : (this._isReplayObject(record.realData?.answerComparison) ? record.realData.answerComparison : {});
            const recordCorrectSources = [
                record.correctAnswerMap,
                record.realData?.correctAnswerMap,
                record.rawData?.correctAnswerMap
            ];

            const builtEntries = [];
            baseEntries.forEach((rawEntry, index) => {
                const entry = this._isReplayObject(rawEntry) ? rawEntry : {};
                const entryMetadata = this._isReplayObject(entry.metadata) ? entry.metadata : {};
                const entryExamId = entry.examId
                    || entryMetadata.examId
                    || this._deriveReplayExamIdFromSources(
                        entry.answers,
                        entry.correctAnswerMap,
                        entry.realData?.correctAnswerMap,
                        entry.answerComparison,
                        recordAnswersSource,
                        recordComparisonSource,
                        ...recordCorrectSources
                    )
                    || (!isAggregated ? (record.examId || recordMetadata.examId) : '');
                const allowUnprefixed = !isAggregated;

                if (!entryExamId) {
                    return;
                }

                let answers = this._normalizeReplayAnswerMap(
                    this._isReplayObject(entry.answers) ? entry.answers : (this._isReplayObject(entry.realData?.answers) ? entry.realData.answers : {}),
                    entryExamId,
                    true
                );
                if (Object.keys(answers).length === 0) {
                    answers = this._normalizeReplayAnswerMap(recordAnswersSource, entryExamId, allowUnprefixed);
                }

                let comparison = this._normalizeReplayComparison(
                    this._isReplayObject(entry.answerComparison) ? entry.answerComparison : (this._isReplayObject(entry.realData?.answerComparison) ? entry.realData.answerComparison : {}),
                    entryExamId,
                    true
                );
                if (Object.keys(comparison).length === 0) {
                    comparison = this._normalizeReplayComparison(recordComparisonSource, entryExamId, allowUnprefixed);
                }

                const correctAnswers = this._resolveReplayCorrectAnswerMap(entry, {
                    examId: entryExamId,
                    allowUnprefixed: true
                });
                if (Object.keys(correctAnswers).length === 0) {
                    this._mergeReplayAnswerMapsFirstWins(
                        correctAnswers,
                        entryExamId,
                        allowUnprefixed,
                        ...recordCorrectSources
                    );
                }

                comparison = this._finalizeReplayComparison(answers, correctAnswers, comparison);
                const sourceScoreInfo = this._resolveReplaySourceScoreInfo(
                    entry,
                    record,
                    hasSuiteEntries,
                    hasSuiteEntries && baseEntries.length === 1
                );
                const scoreInfo = this._deriveReplayScoreInfo(
                    sourceScoreInfo,
                    comparison,
                    this._hasCompleteReplayCorrectAnswerMap(correctAnswers, comparison, sourceScoreInfo)
                );
                const highlights = Array.isArray(entry.highlights)
                    ? entry.highlights.slice()
                    : (Array.isArray(entry.rawData?.highlights)
                        ? entry.rawData.highlights.slice()
                        : (Array.isArray(entry.realData?.highlights)
                            ? entry.realData.highlights.slice()
                            : (Array.isArray(record.realData?.highlights) ? record.realData.highlights.slice() : [])));
                const noteText = typeof entry.noteText === 'string'
                    ? entry.noteText
                    : (typeof entry.rawData?.noteText === 'string'
                        ? entry.rawData.noteText
                        : (typeof entry.realData?.noteText === 'string'
                            ? entry.realData.noteText
                            : (typeof record.realData?.noteText === 'string' ? record.realData.noteText : '')));
                const notes = Array.isArray(entry.notes)
                    ? this._cloneReviewData(entry.notes)
                    : (Array.isArray(entry.rawData?.notes)
                        ? this._cloneReviewData(entry.rawData.notes)
                        : (Array.isArray(entry.realData?.notes)
                            ? this._cloneReviewData(entry.realData.notes)
                            : (Array.isArray(record.realData?.notes) ? this._cloneReviewData(record.realData.notes) : [])));
                const noteOutlines = Array.isArray(entry.noteOutlines)
                    ? this._cloneReviewData(entry.noteOutlines)
                    : (Array.isArray(entry.rawData?.noteOutlines)
                        ? this._cloneReviewData(entry.rawData.noteOutlines)
                        : (Array.isArray(entry.realData?.noteOutlines)
                            ? this._cloneReviewData(entry.realData.noteOutlines)
                            : (Array.isArray(record.realData?.noteOutlines) ? this._cloneReviewData(record.realData.noteOutlines) : [])));
                const scrollY = Number.isFinite(Number(entry.scrollY))
                    ? Number(entry.scrollY)
                    : (Number.isFinite(Number(entry.rawData?.scrollY))
                        ? Number(entry.rawData.scrollY)
                        : (Number.isFinite(Number(entry.realData?.scrollY))
                            ? Number(entry.realData.scrollY)
                            : (Number.isFinite(Number(record.realData?.scrollY)) ? Number(record.realData.scrollY) : 0)));
                const mergedMetadata = Object.assign({}, recordMetadata, entryMetadata, {
                    examId: entryExamId
                });
                const built = {
                    examId: String(entryExamId),
                    title: entry.title
                        || mergedMetadata.examTitle
                        || mergedMetadata.title
                        || record.title
                        || recordMetadata.examTitle
                        || `回顾题目 ${index + 1}`,
                    answers,
                    correctAnswerMap: correctAnswers,
                    correctAnswers,
                    answerComparison: comparison,
                    scoreInfo,
                    allQuestionIds: [],
                    startTime: entry.startTime
                        || entry.realData?.startTime
                        || entry.rawData?.startTime
                        || record.startTime
                        || record.realData?.startTime
                        || record.rawData?.startTime
                        || record.date
                        || null,
                    endTime: this._resolveReplayTimestampValue(
                        entry.endTime,
                        entry.completedAt,
                        entry.timestamp,
                        entry.date,
                        entry.realData?.endTime,
                        entry.realData?.completedAt,
                        entry.realData?.timestamp,
                        entry.realData?.date,
                        entry.rawData?.endTime,
                        entry.rawData?.completedAt,
                        entry.rawData?.timestamp,
                        entry.rawData?.date,
                        record.endTime,
                        record.completedAt,
                        record.timestamp,
                        record.date,
                        record.realData?.endTime,
                        record.realData?.completedAt,
                        record.realData?.timestamp,
                        record.realData?.date,
                        record.rawData?.endTime,
                        record.rawData?.completedAt,
                        record.rawData?.timestamp,
                        record.rawData?.date
                    ),
                    duration: this._resolveReplayDurationValue(
                        this._collectReplayDurationAliases(entry),
                        this._collectReplayDurationAliases(record)
                    ) ?? 0,
                    markedQuestions: Array.isArray(entry.markedQuestions)
                        ? entry.markedQuestions.slice()
                        : (Array.isArray(entryMetadata.markedQuestions)
                            ? entryMetadata.markedQuestions.slice()
                            : (Array.isArray(recordMetadata.markedQuestions) ? recordMetadata.markedQuestions.slice() : [])),
                    highlights,
                    noteText,
                    notes,
                    noteOutlines,
                    scrollY,
                    metadata: mergedMetadata
                };
                built.allQuestionIds = this._collectReplayQuestionIds(built);
                builtEntries.push(built);
            });
            return builtEntries;
        },

        _ensureReviewReplayStore() {
            if (!this.reviewReplaySessions) {
                this.reviewReplaySessions = new Map();
            }
            return this.reviewReplaySessions;
        },

        async _resolveReviewExamDefinition(entry) {
            if (!entry || typeof entry !== 'object' || !entry.examId) {
                throw new Error('历史记录缺少题目标识');
            }
            if (typeof window.resolveExamForPracticeRecord !== 'function') {
                throw new Error('历史记录题库解析器不可用');
            }
            const exam = await window.resolveExamForPracticeRecord(entry);
            if (exam) return exam;
            // resolveExamForPracticeRecord 在记录缺 provenance 时已回退到当前活动题库解析
            // （见 libraryManager.resolveIndexForRecord）。走到这里说明 examId 在可解析的题库中
            // 确实不存在——统一按“题目不可用”处理，不再因缺少 libraryConfigurationId 而拒绝回放，
            // 那会误伤所有 v1 迁移来、迁移时无法唯一判定来源的旧记录。
            throw new Error('该记录对应的题目在当前题库中不存在，可能题库已被删除或切换');
        },

        _buildReviewSession(record) {
            const entries = this._buildReviewReplayEntriesFromRecord(record);
            const validEntries = entries.filter((entry) => entry && entry.examId);
            if (validEntries.length === 0) {
                return null;
            }
            return {
                sessionId: `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                recordId: record && record.id != null ? String(record.id) : '',
                entries: validEntries,
                currentIndex: 0,
                windowRef: null,
                readOnly: true
            };
        },

        _cloneReadingDraftValue(value) {
            if (value == null) {
                return value;
            }
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (_) {
                if (Array.isArray(value)) {
                    return value.slice();
                }
                if (value && typeof value === 'object') {
                    return Object.assign({}, value);
                }
                return value;
            }
        },

        _readingDraftId(examId, libraryConfigurationId = null) {
            const normalizedExamId = String(examId || '').trim();
            const normalizedConfigurationId = libraryConfigurationId == null
                ? ''
                : String(libraryConfigurationId).trim();
            return normalizedConfigurationId
                ? `reading-draft:${normalizedExamId}:${normalizedConfigurationId}`
                : `reading-draft:${normalizedExamId}`;
        },

        _buildReadingDraftSnapshot(examId, data = {}, windowInfo = null) {
            const source = data && data.draft && typeof data.draft === 'object' && !Array.isArray(data.draft)
                ? data.draft
                : (data && typeof data === 'object' ? data : {});
            const answers = source.answers && typeof source.answers === 'object' && !Array.isArray(source.answers)
                ? this._cloneReadingDraftValue(source.answers)
                : {};
            const highlights = Array.isArray(source.highlights) ? this._cloneReadingDraftValue(source.highlights) : [];
            const notes = Array.isArray(source.notes) ? this._cloneReadingDraftValue(source.notes) : [];
            const noteOutlines = Array.isArray(source.noteOutlines) ? this._cloneReadingDraftValue(source.noteOutlines) : [];
            const markedQuestions = Array.isArray(source.markedQuestions)
                ? this._cloneReadingDraftValue(source.markedQuestions)
                : [];
            const noteText = typeof source.noteText === 'string' ? source.noteText : '';
            const scrollY = Number.isFinite(Number(source.scrollY)) ? Math.max(0, Number(source.scrollY)) : 0;
            const updatedAt = Number(data.draftUpdatedAt ?? source.updatedAt);
            const sessionId = data.sessionId != null
                ? String(data.sessionId)
                : (windowInfo && windowInfo.expectedSessionId ? String(windowInfo.expectedSessionId) : '');
            const libraryConfigurationId = this._readLaunchLibraryConfigurationId(examId, windowInfo);
            return {
                id: this._readingDraftId(examId, libraryConfigurationId),
                examId: String(examId),
                libraryConfigurationId: libraryConfigurationId == null ? null : String(libraryConfigurationId),
                sessionId,
                answers,
                highlights,
                notes,
                noteOutlines,
                markedQuestions,
                noteText,
                scrollY,
                updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
                status: 'in_progress',
                kind: 'reading_draft'
            };
        },

        async _readReadingDraftStore() {
            const drafts = await window.AppData.recovery.listDrafts();
            const store = {};
            (Array.isArray(drafts) ? drafts : []).forEach((draft) => {
                if (draft && draft.kind === 'reading_draft' && draft.examId) {
                    const id = draft.id || this._readingDraftId(draft.examId, draft.libraryConfigurationId);
                    store[String(id)] = draft;
                }
            });
            return store;
        },

        async _writeReadingDraftStore(store, changedDraft = null) {
            try {
                if (changedDraft) {
                    await window.AppData.recovery.saveDraft(changedDraft);
                }
                const drafts = await window.AppData.recovery.listDrafts();
                const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
                for (const draft of Array.isArray(drafts) ? drafts : []) {
                    const numericUpdatedAt = Number(draft && draft.updatedAt);
                    const draftUpdatedAt = Number.isFinite(numericUpdatedAt)
                        ? numericUpdatedAt
                        : Date.parse(draft && draft.updatedAt);
                    if (
                        draft
                        && draft.kind === 'reading_draft'
                        && draft.id !== changedDraft?.id
                        && (!Number.isFinite(draftUpdatedAt) || draftUpdatedAt < cutoff)
                    ) {
                        await window.AppData.recovery.discardDraft(draft.id);
                    }
                }
                return true;
            } catch (error) {
                console.warn('[ReadingDraftGateway] 写入草稿失败:', error);
                return false;
            }
        },

        async handleReadingDraftSync(examId, data = {}, windowInfo = null) {
            const info = windowInfo || (this.examWindows && this.examWindows.get(examId));
            if (!info || info.reviewMode) {
                return false;
            }
            if (windowInfo && this.examWindows && this.examWindows.get(examId) !== info) {
                return false;
            }
            if (String(info.practiceMode || '').toLowerCase() === 'memorize') {
                return false;
            }
            // 用“本窗口的 suite 绑定”判断是否套题草稿，而不是看全局 currentSuiteSession：
            // 否则当任意套题会话仍活跃时，普通独立阅读窗口（windowInfo.suiteSessionId 为空）
            // 的草稿也会被拒绝，关闭该窗口会丢失该题的在做答案/笔记。
            if (info.suiteSessionId) {
                return typeof this._handleSuiteDraftSync === 'function'
                    ? this._handleSuiteDraftSync(examId, data, info, info.window)
                    : false;
            }
            const expectedSessionId = info.expectedSessionId ? String(info.expectedSessionId) : '';
            const payloadSessionId = data && data.sessionId != null ? String(data.sessionId) : '';
            if (!expectedSessionId || !payloadSessionId || payloadSessionId !== expectedSessionId) {
                return false;
            }
            const draft = this._buildReadingDraftSnapshot(examId, data, info);
            if (!draft.sessionId) {
                return false;
            }
            const isCurrentRegistration = () => {
                const current = this.examWindows && this.examWindows.get(examId);
                return current === info
                    && (!current.window || !current.window.closed)
                    && (!Number.isInteger(data.windowSessionGeneration)
                        || !Number.isInteger(info.sessionGeneration)
                        || Number(data.windowSessionGeneration) === Number(info.sessionGeneration));
            };
            if (!isCurrentRegistration()) {
                return false;
            }
            // 必须在写队列里重新读取最新 store 再合并，否则并发不同 exam 的 write 会互相覆盖、
            // 后写者会丢掉前者的草稿（整个 map 是同一个存储 key，read-modify-write 非原子）。
            const store = await this._readReadingDraftStore();
            if (!isCurrentRegistration()) {
                return false;
            }
            const previous = store[String(draft.id)] || null;
            const previousNumericUpdatedAt = Number(previous && previous.updatedAt);
            const previousUpdatedAt = Number.isFinite(previousNumericUpdatedAt)
                ? previousNumericUpdatedAt
                : Date.parse(previous && previous.updatedAt);
            const nextNumericUpdatedAt = Number(draft.updatedAt);
            const nextUpdatedAt = Number.isFinite(nextNumericUpdatedAt)
                ? nextNumericUpdatedAt
                : Date.parse(draft.updatedAt);
            if (
                previous
                && previous.sessionId === draft.sessionId
                && Number.isFinite(previousUpdatedAt)
                && Number.isFinite(nextUpdatedAt)
                && nextUpdatedAt < previousUpdatedAt
            ) {
                return false;
            }
            store[String(draft.id)] = draft;
            if (!isCurrentRegistration()) {
                return false;
            }
            if (!await this._writeReadingDraftStore(store, draft)) {
                return false;
            }
            if (!isCurrentRegistration()) {
                return false;
            }
            info.lastReadingDraft = draft;
            info.lastReadingDraftAt = Date.now();
            if (this.examWindows) {
                this.examWindows.set(examId, info);
            }
            return true;
        },

        async _queueReadingDraftSync(examId, data = {}, windowInfo = null) {
            // 同一宿主窗口内保持事件顺序；跨标签并发由 AppData/kernel CAS 处理。
            if (!this._readingDraftStoreQueue || typeof this._readingDraftStoreQueue.then !== 'function') {
                this._readingDraftStoreQueue = Promise.resolve();
            }
            const queued = this._readingDraftStoreQueue
                .catch(() => undefined)
                .then(() => {
                    const currentWindowInfo = this.examWindows && this.examWindows.get(examId);
                    if (
                        windowInfo
                        && (
                            currentWindowInfo !== windowInfo
                            || currentWindowInfo.window !== windowInfo.window
                            || currentWindowInfo.sessionGeneration !== windowInfo.sessionGeneration
                        )
                    ) {
                        return false;
                    }
                    return this.handleReadingDraftSync(examId, data, windowInfo);
                });
            this._readingDraftStoreQueue = queued.catch(() => undefined).then(() => {
                if (this._readingDraftStoreQueue === queued) {
                    this._readingDraftStoreQueue = Promise.resolve();
                }
            });
            return queued;
        },

        async getReadingDraftForExam(examId, options = {}) {
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            if (!normalizedExamId) {
                return null;
            }
            const libraryConfigurationId = Object.prototype.hasOwnProperty.call(options, 'libraryConfigurationId')
                ? options.libraryConfigurationId
                : this._readLaunchLibraryConfigurationId(normalizedExamId, options.windowInfo);
            const store = await this._readReadingDraftStore();
            const draft = store[this._readingDraftId(normalizedExamId, libraryConfigurationId)] || null;
            if (!draft || typeof draft !== 'object') {
                return null;
            }
            // 仅用于“恢复未完成草稿”：跨开窗/重启时 expectedSessionId 会重新生成，
            // 旧 draft 的 sessionId 必然与之不同；读取不写入任何数据，无跨会话覆盖风险，
            // 因此这里不再用 sessionId 拦截，把旧草稿透传给调用方，由其在新 session 里继续答题。
            // 写/清路径仍保留严格校验，避免跨会话误覆盖或误删。
            const cloned = this._cloneReadingDraftValue(draft);
            const expectedSessionId = options.sessionId != null ? String(options.sessionId) : '';
            if (expectedSessionId && String(cloned.sessionId || '') !== expectedSessionId) {
                cloned.sessionId = expectedSessionId;
            }
            return cloned;
        },

        async clearReadingDraftForExam(examId, options = {}) {
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            if (!normalizedExamId) {
                return false;
            }
            const libraryConfigurationId = Object.prototype.hasOwnProperty.call(options, 'libraryConfigurationId')
                ? options.libraryConfigurationId
                : this._readLaunchLibraryConfigurationId(normalizedExamId, options.windowInfo);
            const run = async () => {
                const store = await this._readReadingDraftStore();
                const existing = store[this._readingDraftId(normalizedExamId, libraryConfigurationId)] || null;
                if (!existing) {
                    return false;
                }
                const expectedSessionId = options.sessionId != null ? String(options.sessionId) : '';
                // completion 路径用 acceptResumeSessionId=true 调用：若用户是在恢复的草稿上继续答题，
                // 存档里仍是恢复前的旧 sessionId，而完成事件带的是新 session id；
                // 这里已由完成事件本身做过严格的 message/session 校验，可直接删除该题草稿，
                // 避免已提交的答案在重开 SAME 题时被旧草稿复活。
                if (expectedSessionId && String(existing.sessionId || '') !== expectedSessionId && !options.acceptResumeSessionId) {
                    return false;
                }
                await window.AppData.recovery.discardDraft(existing.id);
                return true;
            };
            // 与当前窗口的 draft sync 顺序一致，物理并发控制仍由 kernel 负责。
            if (!this._readingDraftStoreQueue || typeof this._readingDraftStoreQueue.then !== 'function') {
                this._readingDraftStoreQueue = Promise.resolve();
            }
            const queued = this._readingDraftStoreQueue
                .catch(() => undefined)
                .then(run);
            this._readingDraftStoreQueue = queued.catch(() => undefined).then(() => {
                if (this._readingDraftStoreQueue === queued) {
                    this._readingDraftStoreQueue = Promise.resolve();
                }
            });
            return queued;
        },

        async _isPracticeCompletionPersisted(record) {
            const identityFields = ['id', 'examId', 'sessionId'];
            const completionTime = (value) => value && (
                value.endTime || value.completedAt || value.timestamp || value.date
            );
            if (!record || typeof record !== 'object'
                || identityFields.some((key) => record[key] == null || String(record[key]).trim() === '')
                || !completionTime(record)) {
                return false;
            }
            try {
                const persisted = await window.AppData.practice.get(String(record.id), { projection: 'light' });
                if (!persisted || typeof persisted !== 'object') {
                    return false;
                }
                return identityFields.every((key) => String(persisted[key] ?? '') === String(record[key]))
                    && String(completionTime(persisted) || '') === String(completionTime(record));
            } catch (error) {
                console.warn('[ReadingDraftGateway] 无法确认完成记录已落库，保留草稿:', error);
                return false;
            }
        },

        async handleReadingAnnotationSync(examId, data = {}, windowInfo = null) {
            const info = windowInfo || (this.examWindows && this.examWindows.get(examId));
            if (!info) {
                return false;
            }
            // 两条来源均可落库标注：①review 回放态，按 reviewSessionId 解析 recordId；
            // ②单篇阅读 final-submit 后的结果页，按 windowInfo.submittedRecordId 直连
            // 已存档的练习记录。两者都需要 payload.recordId 与解析出的 recordId 严格匹配。
            let recordId = '';
            if (info.reviewMode && info.reviewSessionId) {
                const reviewSessionId = String(info.reviewSessionId);
                const sessions = this._ensureReviewReplayStore();
                const reviewSession = sessions.get(reviewSessionId);
                if (!reviewSession || !reviewSession.recordId) {
                    return false;
                }
                recordId = String(reviewSession.recordId);
            } else if (info.submittedRecordId) {
                recordId = String(info.submittedRecordId);
            } else {
                return false;
            }
            if (data.recordId == null || String(data.recordId) !== recordId) {
                return false;
            }

            const source = data.annotations && typeof data.annotations === 'object' && !Array.isArray(data.annotations)
                ? data.annotations
                : data;
            const annotationPatch = {};
            ['highlights', 'notes', 'noteOutlines', 'markedQuestions'].forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(source, key) && Array.isArray(source[key])) {
                    annotationPatch[key] = this._cloneReviewData(source[key]);
                }
            });
            if (Object.prototype.hasOwnProperty.call(source, 'noteText') && typeof source.noteText === 'string') {
                annotationPatch.noteText = source.noteText;
            }
            if (Object.prototype.hasOwnProperty.call(source, 'scrollY')) {
                const scrollY = Number(source.scrollY);
                if (Number.isFinite(scrollY)) {
                    annotationPatch.scrollY = Math.max(0, scrollY);
                }
            }
            if (Object.keys(annotationPatch).length === 0) {
                return false;
            }

            const normalizedExamId = String(examId);
            await window.AppData.practice.updateAnnotations({
                recordId,
                examId: normalizedExamId,
                patch: annotationPatch,
                operationId: data.operationId || data.messageId || undefined
            });

            // 只有 review 回放分支需要同时更新内存中的 reviewSession.entries；
            // 单篇 submitted 直连已存档记录的分支不持有 reviewSession，跳过。
            if (info.reviewMode && info.reviewSessionId) {
                const reviewSessionId = String(info.reviewSessionId);
                const sessions = this._ensureReviewReplayStore();
                const reviewSession = sessions.get(reviewSessionId);
                if (reviewSession && Array.isArray(reviewSession.entries)) {
                    reviewSession.entries = reviewSession.entries.map((entry) => (
                        entry && String(entry.examId) === normalizedExamId
                            ? Object.assign({}, entry, annotationPatch)
                            : entry
                    ));
                    sessions.set(reviewSessionId, reviewSession);
                }
            }
            return true;
        },

        async _queueReadingAnnotationSync(examId, data = {}, windowInfo = null) {
            return this.handleReadingAnnotationSync(examId, data, windowInfo);
        },

        // 单篇阅读 final-submit 落库成功后，把已存档 recordId 写入 windowInfo 并
        // postMessage 回结果页，使结果页笔记改动能以 READING_ANNOTATION_SYNC
        // 持久化回该练习记录。套题流程不会走到这里（已在 handleSuitePracticeComplete 早退）。
        _announceSubmittedReadingRecord(examId, savedRecord, completionData, sourceWindow) {
            try {
                const recordId = savedRecord && savedRecord.id != null ? String(savedRecord.id).trim() : '';
                if (!recordId) {
                    return false;
                }
                const sessionId = completionData && completionData.sessionId != null
                    ? String(completionData.sessionId)
                    : '';
                const targetWindow = (sourceWindow && !sourceWindow.closed) ? sourceWindow : null;
                if (!targetWindow) {
                    return false;
                }
                const windowInfo = this.ensureExamWindowSession(examId, targetWindow);
                if (windowInfo) {
                    windowInfo.submittedRecordId = recordId;
                    windowInfo.window = targetWindow;
                    windowInfo.status = 'completed';
                    windowInfo.completedAt = windowInfo.completedAt || Date.now();
                    this.examWindows && this.examWindows.set(examId, windowInfo);
                }
                this._postExamMessage(examId, targetWindow, 'PRACTICE_RECORD_SAVED', {
                    examId,
                    recordId,
                    sessionId: sessionId || null
                });
                return true;
            } catch (_) {
                // annotation persistence hint is best-effort
                return false;
            }
        },

        _announcePracticeSubmitOutcome(examId, completionData, sourceWindow, succeeded, details = {}) {
            const submissionId = completionData && completionData.submissionId != null
                ? String(completionData.submissionId).trim()
                : '';
            const sessionId = completionData && completionData.sessionId != null
                ? String(completionData.sessionId).trim()
                : '';
            const targetWindow = sourceWindow && !sourceWindow.closed ? sourceWindow : null;
            if (!submissionId || !sessionId || !targetWindow) {
                return false;
            }
            try {
                const type = succeeded ? 'PRACTICE_SUBMIT_ACK' : 'PRACTICE_SUBMIT_FAILED';
                const payload = {
                    examId,
                    submissionId,
                    sessionId,
                    suiteSessionId: completionData && completionData.suiteSessionId
                        ? String(completionData.suiteSessionId)
                        : null,
                    errorCode: succeeded ? null : String(details.errorCode || 'save_failed')
                };
                const delivered = this._postExamMessage(examId, targetWindow, type, payload);
                if (succeeded) {
                    const resolvedSession = this._resolveExamWindowSessionForTarget(examId, targetWindow);
                    const windowInfo = resolvedSession.windowInfo;
                    const receiptKey = `${sessionId}:${submissionId}`;
                    const receipts = windowInfo.practiceSubmitReceipts && typeof windowInfo.practiceSubmitReceipts === 'object'
                        ? windowInfo.practiceSubmitReceipts
                        : {};
                    receipts[receiptKey] = Object.assign({}, payload, { examId, succeeded: true });
                    const keys = Object.keys(receipts);
                    keys.slice(0, Math.max(0, keys.length - 8)).forEach((key) => delete receipts[key]);
                    windowInfo.practiceSubmitReceipts = receipts;
                    this.examWindows && this.examWindows.set(resolvedSession.examId, windowInfo);
                }
                return delivered;
            } catch (error) {
                console.warn('[DataCollection] 提交结果回执发送失败:', error);
                return false;
            }
        },

        _announceVocabHighlightOutcome(examId, requestData, sourceWindow, succeeded, errorCode = '') {
            const requestId = requestData && requestData.requestId != null
                ? String(requestData.requestId).trim()
                : '';
            const sessionId = requestData && requestData.sessionId != null
                ? String(requestData.sessionId).trim()
                : '';
            const targetWindow = sourceWindow && !sourceWindow.closed ? sourceWindow : null;
            if (!requestId || !sessionId || !targetWindow) {
                return false;
            }
            return this._postExamMessage(
                examId,
                targetWindow,
                succeeded ? 'VOCAB_HIGHLIGHT_SAVE_ACK' : 'VOCAB_HIGHLIGHT_SAVE_FAILED',
                {
                    examId,
                    sessionId,
                    requestId,
                    errorCode: succeeded ? null : String(errorCode || 'save_failed')
                }
            );
        },

        _replayPracticeSubmitReceipt(examId, completionData, sourceWindow) {
            const submissionId = completionData && completionData.submissionId != null
                ? String(completionData.submissionId).trim()
                : '';
            const sessionId = completionData && completionData.sessionId != null
                ? String(completionData.sessionId).trim()
                : '';
            if (!submissionId || !sessionId || !sourceWindow || sourceWindow.closed) {
                return false;
            }
            // 回执重放只做查询：它在 handlePracticeComplete 最前面执行，若在此兜底
            // 新建以 examId 为键的空注册，随后的回包就会误认为该注册持有窗口。
            const resolvedExamId = this._resolveExamWindowSessionKey(examId, sourceWindow);
            const windowInfo = this.examWindows && this.examWindows.get(resolvedExamId);
            const receipt = windowInfo
                && windowInfo.practiceSubmitReceipts
                && windowInfo.practiceSubmitReceipts[`${sessionId}:${submissionId}`];
            if (!receipt || receipt.succeeded !== true) {
                return false;
            }
            this._announcePracticeSubmitOutcome(examId, completionData, sourceWindow, true);
            return true;
        },

        _scheduleSuiteSubmitTeardown(session) {
            if (!session || typeof this._teardownSuiteSession !== 'function') {
                return false;
            }
            // The receipt replay window intentionally keeps the completed suite alive for
            // 30 seconds.  Capture the registrations owned by that suite now: a user may
            // start a fresh standalone attempt for the same exam before the timer fires,
            // and teardown must never delete that replacement registration/handler.
            if (typeof this._captureSuiteTeardownRegistrations === 'function') {
                this._captureSuiteTeardownRegistrations(session);
            }
            if (session.submitReceiptTeardownTimer) {
                clearTimeout(session.submitReceiptTeardownTimer);
            }
            const timer = setTimeout(() => {
                session.submitReceiptTeardownTimer = null;
                this._teardownSuiteSession(session).catch((teardownError) => {
                    console.warn('[SuitePractice] 提交回执重放窗口结束后清理套题会话失败:', teardownError);
                });
            }, 30000);
            session.submitReceiptTeardownTimer = timer;
            if (timer && typeof timer.unref === 'function') {
                timer.unref();
            }
            return true;
        },

        _bindReviewWindowRef(reviewSessionId, windowRef) {
            if (!reviewSessionId || !windowRef || windowRef.closed) {
                return;
            }
            const store = this._ensureReviewReplayStore();
            const session = store.get(String(reviewSessionId));
            if (!session) {
                return;
            }
            session.windowRef = windowRef;
            store.set(String(reviewSessionId), session);
        },

        _buildReviewContextPayload(session, entryIndex) {
            const safeIndex = Number.isInteger(entryIndex) ? entryIndex : 0;
            const total = Array.isArray(session.entries) ? session.entries.length : 0;
            const current = session.entries[safeIndex] || {};
            return {
                reviewSessionId: session.sessionId,
                index: safeIndex + 1,
                currentIndex: safeIndex,
                total,
                canPrev: safeIndex > 0,
                canNext: safeIndex < total - 1,
                title: current.title || current.metadata?.examTitle || current.examId || '',
                examId: current.examId || '',
                readOnly: session.readOnly !== false
            };
        },

        _sendReviewReplayMessages(examId, targetWindow, session, entryIndex) {
            if (!targetWindow || targetWindow.closed || !session || !Array.isArray(session.entries)) {
                return false;
            }
            const safeIndex = Number.isInteger(entryIndex) ? entryIndex : 0;
            const entry = session.entries[safeIndex];
            if (!entry || !entry.examId) {
                return false;
            }
            const replayPayload = {
                reviewSessionId: session.sessionId,
                recordId: session.recordId || null,
                reviewEntryIndex: safeIndex,
                readOnly: session.readOnly !== false,
                entry: this._cloneReviewData(entry)
            };
            const contextPayload = this._buildReviewContextPayload(session, safeIndex);
            try {
                this._postExamMessage(examId, targetWindow, 'REPLAY_PRACTICE_RECORD', replayPayload);
                this._postExamMessage(examId, targetWindow, 'REVIEW_CONTEXT', contextPayload);
                return true;
            } catch (error) {
                console.warn('[ReviewReplay] 向题目页发送回放数据失败:', error);
                return false;
            }
        },

        _dispatchReviewReplayForExam(examId, targetWindow = null) {
            const windowInfo = this.examWindows && this.examWindows.get(examId);
            if (!windowInfo || !windowInfo.reviewMode || !windowInfo.reviewSessionId) {
                return false;
            }
            const store = this._ensureReviewReplayStore();
            const session = store.get(String(windowInfo.reviewSessionId));
            if (!session) {
                return false;
            }
            const index = Number.isInteger(windowInfo.reviewEntryIndex)
                ? windowInfo.reviewEntryIndex
                : (Number.isInteger(session.currentIndex) ? session.currentIndex : 0);
            const resolvedWindow = targetWindow || windowInfo.window || session.windowRef || null;
            const sent = this._sendReviewReplayMessages(examId, resolvedWindow, session, index);
            if (sent) {
                session.currentIndex = index;
                if (resolvedWindow && !resolvedWindow.closed) {
                    session.windowRef = resolvedWindow;
                }
                store.set(String(session.sessionId), session);
                windowInfo.reviewEntryIndex = index;
                if (resolvedWindow && !resolvedWindow.closed) {
                    windowInfo.window = resolvedWindow;
                }
                this.examWindows && this.examWindows.set(examId, windowInfo);
            }
            return sent;
        },

        async handleReviewReplayNavigate(examId, data = {}, sourceWindow = null) {
            const windowInfo = this.examWindows && this.examWindows.get(examId);
            if (!windowInfo || !windowInfo.reviewMode) {
                return;
            }
            const sessionId = data.reviewSessionId
                ? String(data.reviewSessionId)
                : (windowInfo.reviewSessionId ? String(windowInfo.reviewSessionId) : '');
            if (!sessionId) {
                return;
            }
            const store = this._ensureReviewReplayStore();
            const session = store.get(sessionId);
            if (!session || !Array.isArray(session.entries) || session.entries.length === 0) {
                return;
            }
            const direction = String(data.direction || data.action || '').toLowerCase();
            let nextIndex = Number.isInteger(session.currentIndex) ? session.currentIndex : 0;
            if (direction === 'next') {
                nextIndex += 1;
            } else if (direction === 'prev' || direction === 'previous') {
                nextIndex -= 1;
            } else if (Number.isInteger(data.targetIndex)) {
                nextIndex = data.targetIndex;
            } else {
                return;
            }

            if (nextIndex < 0) {
                nextIndex = 0;
            }
            if (nextIndex >= session.entries.length) {
                nextIndex = session.entries.length - 1;
            }

            const nextEntry = session.entries[nextIndex];
            if (!nextEntry || !nextEntry.examId) {
                return;
            }

            session.currentIndex = nextIndex;
            session.windowRef = sourceWindow || windowInfo.window || session.windowRef || null;
            store.set(sessionId, session);

            if (String(nextEntry.examId) === String(examId)) {
                windowInfo.reviewEntryIndex = nextIndex;
                this.examWindows && this.examWindows.set(examId, windowInfo);
                this._sendReviewReplayMessages(examId, session.windowRef, session, nextIndex);
                return;
            }

            try {
                await this.cleanupExamSession(examId);
            } catch (error) {
                console.warn('[ReviewReplay] 清理旧题目会话失败:', error);
            }

            const examDefinition = await this._resolveReviewExamDefinition(nextEntry);
            await this.openExam(nextEntry.examId, {
                reviewMode: true,
                readOnly: true,
                reviewSessionId: sessionId,
                reviewEntryIndex: nextIndex,
                reuseWindow: session.windowRef || null,
                examDefinition,
                requireRecordProvenance: true
            });
        },

        async openPracticeRecordReplay(record) {
            const session = this._buildReviewSession(record);
            if (!session) {
                throw new Error('该练习记录缺少可回放的题目映射');
            }
            const store = this._ensureReviewReplayStore();
            store.set(session.sessionId, session);

            const firstEntry = session.entries[0];
            if (!firstEntry || !firstEntry.examId) {
                store.delete(session.sessionId);
                throw new Error('无法解析首题题目标识');
            }

            const examDefinition = await this._resolveReviewExamDefinition(firstEntry);
            const openedWindow = await this.openExam(firstEntry.examId, {
                reviewMode: true,
                readOnly: true,
                reviewSessionId: session.sessionId,
                reviewEntryIndex: 0,
                examDefinition,
                requireRecordProvenance: true
            });
            if (!openedWindow) {
                store.delete(session.sessionId);
                throw new Error('无法打开回顾页面');
            }
            this._bindReviewWindowRef(session.sessionId, openedWindow);
            return session;
        },

        _buildExamInitPayload(examId, windowInfo = {}, extras = {}) {
            const info = windowInfo || {};
            if (!info.expectedSessionId) {
                info.expectedSessionId = this.generateSessionId(examId);
            }
            this._refreshExamWindowToken(examId, info);
            const suiteSessionId = Object.prototype.hasOwnProperty.call(info, 'suiteSessionId')
                ? (info.suiteSessionId || null)
                : (typeof this._resolveSuiteSessionId === 'function'
                    ? this._resolveSuiteSessionId(examId, info)
                    : null);
            const activeSuite = suiteSessionId
                && this.currentSuiteSession
                && String(this.currentSuiteSession.id || '') === String(suiteSessionId)
                ? this.currentSuiteSession
                : null;
            const autoAdvanceAfterSubmit = activeSuite && typeof activeSuite.autoAdvanceAfterSubmit === 'boolean'
                ? activeSuite.autoAdvanceAfterSubmit
                : (typeof info.autoAdvanceAfterSubmit === 'boolean' ? info.autoAdvanceAfterSubmit : null);
            const timerContext = typeof this._resolveSuiteTimerContext === 'function'
                ? this._resolveSuiteTimerContext({}, info)
                : {
                    suiteTimerAnchorMs: info.suiteTimerAnchorMs || info.globalTimerAnchorMs || null,
                    suiteTimerMode: info.suiteTimerMode || null,
                    suiteTimerLimitSeconds: info.suiteTimerLimitSeconds || null
                };
            const messageIssuedAtMs = Number.isFinite(Number(extras && (extras.messageIssuedAtMs ?? extras.timestamp)))
                ? Math.floor(Number(extras.messageIssuedAtMs ?? extras.timestamp))
                : Date.now();
            info.lastInitMessageAt = messageIssuedAtMs;
            // 启动时捕获的题库配置 ID：优先用 windowInfo 上预存值（启动时埋下），
            // 否则从 mixin 私有 Map 兜底读，确保随 INIT_SESSION 携带到考试窗口。
            const launchLibraryConfigurationId = Object.prototype.hasOwnProperty.call(info, 'libraryConfigurationId')
                ? info.libraryConfigurationId
                : this._readLaunchLibraryConfigurationId(examId);
            const payload = {
                examId: examId,
                parentOrigin: info.allowOpaqueOrigin ? 'null' : window.location.origin,
                sessionId: info.expectedSessionId,
                windowSessionToken: info.windowSessionToken || null,
                windowSessionGeneration: Number.isInteger(info.sessionGeneration) ? info.sessionGeneration : 0,
                messageIssuedAtMs,
                suiteSessionId: suiteSessionId || null,
                suiteFlowMode: info.suiteFlowMode || null,
                autoAdvanceAfterSubmit,
                suiteTimerAnchorMs: timerContext.suiteTimerAnchorMs || null,
                globalTimerAnchorMs: timerContext.globalTimerAnchorMs || null,
                suiteTimerMode: timerContext.suiteTimerMode || null,
                suiteTimerLimitSeconds: timerContext.suiteTimerLimitSeconds != null ? timerContext.suiteTimerLimitSeconds : null,
                suiteSequenceIndex: Number.isInteger(info.suiteSequenceIndex) ? info.suiteSequenceIndex : null,
                suiteSequenceTotal: Number.isInteger(info.suiteSequenceTotal) ? info.suiteSequenceTotal : null,
                suiteSequence: Array.isArray(info.suiteSequence)
                    ? info.suiteSequence
                    : (typeof this._buildSuiteSequencePayload === 'function' && this.currentSuiteSession
                        ? this._buildSuiteSequencePayload(this.currentSuiteSession)
                        : []),
                practiceMode: typeof info.practiceMode === 'string' && info.practiceMode.trim()
                    ? info.practiceMode.trim().toLowerCase()
                    : null,
                reviewMode: Boolean(info.reviewMode),
                reviewSessionId: info.reviewSessionId ? String(info.reviewSessionId) : null,
                reviewEntryIndex: Number.isInteger(info.reviewEntryIndex) ? info.reviewEntryIndex : 0,
                readOnly: Object.prototype.hasOwnProperty.call(info, 'readOnly')
                    ? Boolean(info.readOnly)
                    : Boolean(info.reviewMode),
                libraryConfigurationId: launchLibraryConfigurationId
            };
            if (
                !payload.reviewMode
                && !suiteSessionId
                && !payload.suiteFlowMode
                && info.lastReadingDraft
                && typeof info.lastReadingDraft === 'object'
                && String(info.lastReadingDraft.sessionId || '') === String(info.expectedSessionId || '')
            ) {
                payload.draft = this._cloneReadingDraftValue(info.lastReadingDraft);
            }
            if (extras && typeof extras === 'object') {
                Object.assign(payload, extras);
            }
            // extras 显式提供 libraryConfigurationId 时不被覆盖；若 extras 显式带
            // undefined/null（不应出现），保留启动捕获值以免丢失题库来源。
            if (extras && typeof extras === 'object'
                && Object.prototype.hasOwnProperty.call(extras, 'libraryConfigurationId')) {
                payload.libraryConfigurationId = extras.libraryConfigurationId;
            } else if (payload.libraryConfigurationId === undefined) {
                payload.libraryConfigurationId = launchLibraryConfigurationId;
            }
            return payload;
        },

        async _sendExamInitEnvelope(examId, targetWindow, extras = {}, expectedRegistration = null) {
            if (!targetWindow || targetWindow.closed) {
                return null;
            }
            try {
                if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                    return null;
                }
                const windowInfo = expectedRegistration
                    ? expectedRegistration.windowInfo
                    : this.ensureExamWindowSession(examId, targetWindow);
                if (
                    windowInfo
                    && !windowInfo.reviewMode
                    && !windowInfo.suiteSessionId
                    && String(windowInfo.practiceMode || '').toLowerCase() !== 'memorize'
                    && typeof this.getReadingDraftForExam === 'function'
                    && !(extras && Object.prototype.hasOwnProperty.call(extras, 'draft'))
                ) {
                    try {
                        const restoredDraft = await this.getReadingDraftForExam(examId, {
                            sessionId: windowInfo.expectedSessionId
                        });
                        if (restoredDraft) {
                            windowInfo.lastReadingDraft = restoredDraft;
                            this.examWindows && this.examWindows.set(examId, windowInfo);
                        }
                    } catch (_) {
                        // draft restore is best-effort
                    }
                }
                if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                    return null;
                }
                const initPayload = this._buildExamInitPayload(examId, windowInfo, extras);
                this._postExamMessage(examId, targetWindow, 'INIT_SESSION', initPayload);
                this._postExamMessage(examId, targetWindow, 'init_exam_session', initPayload);
                return initPayload;
            } catch (initError) {
                console.warn('[App] 发送初始化消息失败:', initError);
                return null;
            }
        },

        restartExamHandshake(examWindow, examId, expectedRegistration = null) {
            if (this._handshakeTimers && this._handshakeTimers.has(examId)) {
                try {
                    clearInterval(this._handshakeTimers.get(examId));
                } catch (_) {
                    // ignore stale timer cleanup
                }
                this._handshakeTimers.delete(examId);
            }
            this.startExamHandshake(examWindow, examId, expectedRegistration);
        },

        ensureExamWindowSession(examId, examWindow = null) {
            if (!this.examWindows) {
                this.examWindows = new Map();
            }

            if (!this.examWindows.has(examId)) {
                this.examWindows.set(examId, {
                    window: examWindow || null,
                    startTime: Date.now(),
                    status: 'active',
                    expectedSessionId: this.generateSessionId(examId),
                    windowSessionToken: null,
                    windowSessionTokenSessionId: null,
                    expectedUrl: '',
                    expectedOrigin: '',
                    allowOpaqueOrigin: false,
                    observedOrigin: '',
                    suiteTimerAnchorMs: null,
                    globalTimerAnchorMs: null,
                    suiteTimerMode: null,
                    suiteTimerLimitSeconds: null,
                    suiteFlowMode: null,
                    suiteSequenceIndex: null,
                    suiteSequenceTotal: null,
                    practiceMode: null,
                    reviewMode: false,
                    reviewSessionId: null,
                    reviewEntryIndex: 0,
                    readOnly: false,
                    sessionGeneration: 1,
                    submittedRecordId: ''
                });
            }

            const windowInfo = this.examWindows.get(examId);

            if (!Number.isInteger(windowInfo.registrationId)) {
                this._examRegistrationSequence = Math.max(0, Number(this._examRegistrationSequence) || 0) + 1;
                windowInfo.registrationId = this._examRegistrationSequence;
            }
            if (!Number.isInteger(windowInfo.sessionGeneration)) windowInfo.sessionGeneration = 1;
            if (!Number.isInteger(windowInfo.navigationEpoch)) windowInfo.navigationEpoch = 0;

            if (examWindow && (!windowInfo.window || windowInfo.window.closed || windowInfo.window !== examWindow)) {
                windowInfo.window = examWindow;
            }

            if (!windowInfo.expectedOrigin && examWindow) {
                try {
                    const currentHref = examWindow.location && typeof examWindow.location.href === 'string'
                        ? examWindow.location.href
                        : '';
                    const endpoint = this._resolveExamMessageEndpoint(currentHref);
                    const hostOrigin = window.location && window.location.origin;
                    const isTrustedSameOrigin = endpoint.expectedOrigin
                        && endpoint.expectedOrigin !== 'null'
                        && hostOrigin
                        && endpoint.expectedOrigin === hostOrigin;
                    const isTrustedLocalFile = endpoint.allowOpaqueOrigin && isFileProtocol;
                    if (isTrustedSameOrigin || isTrustedLocalFile) {
                        windowInfo.expectedUrl = endpoint.expectedUrl;
                        windowInfo.expectedOrigin = endpoint.expectedOrigin;
                        windowInfo.allowOpaqueOrigin = endpoint.allowOpaqueOrigin;
                    }
                } catch (_) {
                    // Cross-origin WindowProxy locations are intentionally not probed further.
                }
            }

            if (!windowInfo.expectedSessionId) {
                windowInfo.expectedSessionId = this.generateSessionId(examId);
            }
            this._refreshExamWindowToken(examId, windowInfo);
            if (typeof windowInfo.practiceMode !== 'string') {
                windowInfo.practiceMode = null;
            } else {
                windowInfo.practiceMode = windowInfo.practiceMode.trim().toLowerCase() || null;
            }
            if (typeof windowInfo.reviewMode !== 'boolean') {
                windowInfo.reviewMode = false;
            }
            if (!Number.isInteger(windowInfo.reviewEntryIndex)) {
                windowInfo.reviewEntryIndex = 0;
            }
            if (!Object.prototype.hasOwnProperty.call(windowInfo, 'readOnly')) {
                windowInfo.readOnly = Boolean(windowInfo.reviewMode);
            }

            this.examWindows.set(examId, windowInfo);
            return windowInfo;
        },

        /**
         * 在考试启动时捕获当前激活的题库配置 ID，写入 windowInfo 与 mixin 私有 Map，
         * 供后续 INIT_SESSION payload 以及 completeAttempt 路径使用，避免提交时再读取
         * 当前激活题库而拿到不一致的来源。
         * 该方法为 async：必要时调用方需 await。
         */
        async _captureLaunchLibraryConfigurationId(examId, options = {}) {
            if (!examId) return null;
            if (!this._launchLibraryConfigurationIds) {
                this._launchLibraryConfigurationIds = new Map();
            }
            let configurationId = null;
            try {
                if (window.AppData && window.AppData.library
                    && typeof window.AppData.library.getActive === 'function') {
                    configurationId = await window.AppData.library.getActive();
                }
            } catch (captureError) {
                console.warn('[ExamSession] 捕获启动题库配置 ID 失败:', captureError);
                configurationId = null;
            }
            const normalized = (configurationId === undefined || configurationId === null)
                ? null
                : configurationId;
            if (typeof options.commitGuard === 'function' && options.commitGuard() !== true) {
                return null;
            }
            this._launchLibraryConfigurationIds.set(String(examId), normalized);
            // 同步作用中 windowInfo：避免后续 _buildExamInitPayload 等同步路径漏读
            try {
                if (this.examWindows && this.examWindows.has(examId)) {
                    const windowInfo = this.examWindows.get(examId);
                    if (windowInfo && typeof windowInfo === 'object'
                        && !Object.prototype.hasOwnProperty.call(windowInfo, 'libraryConfigurationId')) {
                        windowInfo.libraryConfigurationId = normalized;
                    }
                }
            } catch (_) { /* 忽略：windowInfo 不存在不影响捕获 */ }
            return normalized;
        },

        /**
         * 同步读取指定 examId 启动时捕获的题库配置 ID；若无捕获返回 null。
         * 优先取实时注入（realData.metadata / payload 显式传入）的值，再回退到启动时捕获值。
         */
        _readLaunchLibraryConfigurationId(examId, ...fromSources) {
            for (const source of fromSources) {
                if (source !== undefined && source !== null && typeof source === 'object') {
                    const metadata = source.metadata;
                    const direct = Object.prototype.hasOwnProperty.call(source, 'libraryConfigurationId')
                        ? source.libraryConfigurationId
                        : (metadata && Object.prototype.hasOwnProperty.call(metadata, 'libraryConfigurationId'))
                            ? metadata.libraryConfigurationId
                            : undefined;
                    if (direct !== undefined && direct !== null) {
                        return direct;
                    }
                }
            }
            if (!this._launchLibraryConfigurationIds) {
                return null;
            }
            return this._launchLibraryConfigurationIds.get(String(examId)) || null;
        },

        /**
         * 清除指定 examId 启动时捕获的题库配置 ID（窗口关闭后调用）。
         */
        _discardLaunchLibraryConfigurationId(examId) {
            if (this._launchLibraryConfigurationIds && examId) {
                this._launchLibraryConfigurationIds.delete(String(examId));
            }
        },

        _syncRecorderSessionStarted(examId, windowInfo, metadata = {}) {
            const recorder = this.components && this.components.practiceRecorder;
            if (!recorder || typeof recorder.handleSessionStarted !== 'function') {
                return;
            }
            const sessionId = (windowInfo && windowInfo.expectedSessionId) || this.generateSessionId(examId);
            // 注入启动时捕获的题库配置 ID，确保 recorder 会话上携带来源。
            const mergedMetadata = Object.assign({}, metadata);
            if (!Object.prototype.hasOwnProperty.call(mergedMetadata, 'libraryConfigurationId')) {
                mergedMetadata.libraryConfigurationId =
                    this._readLaunchLibraryConfigurationId(examId, windowInfo, metadata);
            }
            try {
                recorder.handleSessionStarted({
                    examId,
                    sessionId,
                    metadata: mergedMetadata
                });
            } catch (recorderError) {
                console.warn('[PracticeRecorder] 重置后同步会话状态失败:', recorderError);
            }
        },

        async _removeActiveExamSessionMetadata(examId) {
            try {
                await this._discardActiveSessionsForExam(examId);
            } catch (error) {
                console.warn('[App] 清理活动会话元数据失败:', error);
            }
        },

        async _discardActiveSessionsForExam(examId, options = {}) {
            const activeSessions = await window.AppData.recovery.listActiveSessions();
            if (typeof options.commitGuard === 'function' && options.commitGuard() !== true) return 0;
            const expectedSessionId = String(options.expectedSessionId || '').trim();
            const matches = (Array.isArray(activeSessions) ? activeSessions : [])
                .filter((session) => session && session.examId === examId)
                .filter((session) => !expectedSessionId
                    || String(session.sessionId || '') === expectedSessionId
                    || String(session.id || '').endsWith(`:${expectedSessionId}`));
            for (const session of matches) {
                if (typeof options.commitGuard === 'function' && options.commitGuard() !== true) break;
                const entityId = session.id || session.sessionId || session.recordId;
                if (entityId) {
                    await window.AppData.recovery.discardActiveSession(entityId);
                }
            }
            return matches.length;
        },

        _isResetCapableUnifiedReadingCompletion(data, sourceWindow = null) {
            if (!sourceWindow || sourceWindow.closed) {
                return false;
            }
            const payload = data && typeof data === 'object' ? data : {};
            const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
            const suiteSessionId = payload.suiteSessionId || metadata.suiteSessionId || '';
            if (suiteSessionId) {
                return false;
            }
            const mode = String(payload.practiceMode || metadata.practiceMode || '').toLowerCase();
            if (mode === 'memorize' || mode === 'suite') {
                return false;
            }
            const renderMode = String(payload.renderMode || metadata.renderMode || '').toLowerCase();
            const pageType = String(payload.pageType || metadata.pageType || '').toLowerCase();
            return renderMode === 'unified-reading' || pageType === 'unified-reading';
        },

        async retainExamWindowAfterCompletion(examId, sourceWindow, data = {}, expectedRegistration = null) {
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return false;
            }
            const windowInfo = expectedRegistration
                ? expectedRegistration.windowInfo
                : this.ensureExamWindowSession(examId, sourceWindow);
            windowInfo.window = sourceWindow || windowInfo.window || null;
            windowInfo.status = 'completed';
            windowInfo.completedAt = Date.now();
            windowInfo.lastCompletedSessionId = data && data.sessionId ? String(data.sessionId) : windowInfo.expectedSessionId;
            windowInfo.practiceMode = null;
            windowInfo.reviewMode = false;
            windowInfo.readOnly = false;
            this.examWindows && this.examWindows.set(examId, windowInfo);
            await this._removeActiveExamSessionMetadata(examId);
            return !expectedRegistration || this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
        },

        async handlePracticeResetRequest(examId, data = {}, sourceWindow = null, expectedRegistration = null) {
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return false;
            }
            const targetWindow = (expectedRegistration && expectedRegistration.window) || sourceWindow
                || (this.examWindows && this.examWindows.has(examId) ? this.examWindows.get(examId).window : null);
            if (!targetWindow || targetWindow.closed) {
                window.showMessage && window.showMessage('题目窗口已关闭，无法重置测试', 'warning');
                return;
            }

            const payload = data && typeof data === 'object' ? data : {};
            const reason = String(payload.reason || '').trim().toLowerCase();
            const fromPracticeMode = String(payload.fromPracticeMode || payload.practiceMode || '').trim().toLowerCase();
            const windowInfo = expectedRegistration
                ? expectedRegistration.windowInfo
                : this.ensureExamWindowSession(examId, targetWindow);
            const shouldReopenAsNormal = reason === 'memorize-start-test'
                || fromPracticeMode === 'memorize'
                || windowInfo.practiceMode === 'memorize';

            if (shouldReopenAsNormal) {
                windowInfo.practiceMode = null;
                windowInfo.reviewMode = false;
                windowInfo.readOnly = false;
                windowInfo.status = 'active';
                windowInfo.submittedRecordId = '';
                this.examWindows && this.examWindows.set(examId, windowInfo);
                await this.openExam(examId, {
                    target: 'tab',
                    windowName: 'ielts-reading-practice',
                    reuseWindow: targetWindow
                });
                return;
            }

            windowInfo.window = targetWindow;
            windowInfo.status = 'active';
            windowInfo.startTime = Date.now();
            windowInfo.completedAt = null;
            windowInfo.sessionGeneration = Math.max(0, Number(windowInfo.sessionGeneration) || 0) + 1;
            windowInfo.expectedSessionId = this.generateSessionId(examId);
            this._refreshExamWindowToken(examId, windowInfo);
            windowInfo.sessionId = null;
            windowInfo.practiceMode = null;
            windowInfo.reviewMode = false;
            windowInfo.reviewSessionId = null;
            windowInfo.reviewEntryIndex = 0;
            windowInfo.readOnly = false;
            windowInfo.submittedRecordId = '';
            windowInfo.dataCollectorReady = false;
            windowInfo.lastResetAt = Date.now();
            windowInfo.lastResetReason = reason || 'reset';
            this.examWindows && this.examWindows.set(examId, windowInfo);

            let resetRegistration = this._captureExamSessionRegistration(examId, windowInfo);
            if (!this._isExamSessionRegistrationCurrent(examId, resetRegistration)) {
                return false;
            }
            resetRegistration = this.setupExamWindowCommunication(targetWindow, examId, null, {
                expectedRegistration: resetRegistration,
                deferInitialHandshake: true,
                skipContentGuard: true
            }) || resetRegistration;

            const startResult = await this.startPracticeSession(examId, {
                expectedRegistration: resetRegistration
            });
            if (!startResult || startResult.owned !== true
                || !this._isExamSessionRegistrationCurrent(examId, startResult.registration)) {
                return false;
            }
            resetRegistration = startResult.registration;
            this._syncRecorderSessionStarted(examId, windowInfo, {
                pageType: 'unified-reading',
                url: payload.normalUrl || payload.url || null,
                title: payload.title || null,
                resetReason: reason || 'reset'
            });

            await this._sendExamInitEnvelope(examId, targetWindow, {
                practiceMode: null,
                reviewMode: false,
                readOnly: false
            }, resetRegistration);
            if (!this._isExamSessionRegistrationCurrent(examId, resetRegistration)) {
                return false;
            }
            this.restartExamHandshake(targetWindow, examId, resetRegistration);
            this.updateExamStatus(examId, 'in-progress');
            return true;
        },

        /**
         * 开始练习会话
         */
        async startPracticeSession(examId, options = {}) {
            const expectedRegistration = options && options.expectedRegistration || null;
            const ownsRegistration = () => !expectedRegistration
                || this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
            const exam = options && options.examDefinition
                ? options.examDefinition
                : await findExamDefinition(examId);
            if (!ownsRegistration()) return { owned: false, sessionId: null, registration: expectedRegistration };
            if (!exam) {
                console.error('Exam not found:', examId);
                window.showMessage && window.showMessage('题目索引未加载，请重试或重新导入题库。', 'error');
                return expectedRegistration
                    ? { owned: false, sessionId: null, registration: expectedRegistration }
                    : undefined;
            }

            try {
                const windowInfo = expectedRegistration
                    ? expectedRegistration.windowInfo
                    : (this.examWindows && this.examWindows.get(examId));
                const hostSessionId = windowInfo && windowInfo.expectedSessionId
                    ? String(windowInfo.expectedSessionId)
                    : this.generateSessionId(examId);
                if (windowInfo && !windowInfo.expectedSessionId) {
                    windowInfo.expectedSessionId = hostSessionId;
                    this.examWindows.set(examId, windowInfo);
                }

                // 优先使用新的练习页面管理器
                if (window.practicePageManager) {
                    const sessionId = await window.practicePageManager.startPracticeSession(examId, exam);
                    if (!ownsRegistration()) return { owned: false, sessionId: null, registration: expectedRegistration };

                    // 更新题目状态
                    this.updateExamStatus(examId, 'in-progress');
                    return expectedRegistration
                        ? { owned: true, sessionId, registration: this._captureExamSessionRegistration(examId, windowInfo) }
                        : sessionId;
                }

                // 使用练习记录器开始会话
                if (this.components.practiceRecorder) {
                    // 把启动时捕获的题库配置 ID 透传给 recorder，确保会话 metadata 来源稳定。
                    const launchLibraryConfigurationId = this._readLaunchLibraryConfigurationId(examId);
                    const startPayload = Object.assign({}, exam, {
                        sessionId: hostSessionId,
                        libraryConfigurationId: launchLibraryConfigurationId
                    });
                    let sessionData;
                    if (typeof this.components.practiceRecorder.startPracticeSession === 'function') {
                        sessionData = this.components.practiceRecorder.startPracticeSession(
                            examId,
                            startPayload
                        );
                    } else if (typeof this.components.practiceRecorder.startSession === 'function') {
                        sessionData = this.components.practiceRecorder.startSession(
                            examId,
                            startPayload
                        );
                    } else {
                        console.warn('[App] PracticeRecorder没有可用的启动方法');
                        sessionData = null;
                    }
                    if (sessionData && sessionData.sessionId && windowInfo
                        && windowInfo.expectedSessionId !== sessionData.sessionId) {
                        // Keep host token/session aligned with whatever the recorder accepted.
                        windowInfo.expectedSessionId = String(sessionData.sessionId);
                        this._refreshExamWindowToken(examId, windowInfo);
                        this.examWindows.set(examId, windowInfo);
                    }
                } else {
                    // 降级处理
                    const sessionId = hostSessionId;
                    const sessionData = {
                        id: `active-session:${sessionId}`,
                        examId: examId,
                        startTime: new Date().toISOString(),
                        status: 'started',
                        sessionId
                    };

                    await window.AppData.recovery.saveActiveSession(sessionData);
                    if (!ownsRegistration()) return { owned: false, sessionId: null, registration: expectedRegistration };
                }

                // 更新题目状态
                this.updateExamStatus(examId, 'in-progress');
                if (expectedRegistration) {
                    return {
                        owned: ownsRegistration(),
                        sessionId: windowInfo && windowInfo.expectedSessionId || hostSessionId,
                        registration: this._captureExamSessionRegistration(examId, windowInfo)
                    };
                }

            } catch (error) {
                console.error('[App] 启动练习会话失败:', error);

                // 最终降级方案
                if (expectedRegistration) {
                    return { owned: false, sessionId: null, registration: expectedRegistration };
                }
                await this.startPracticeSessionFallback(examId, exam);
            }
        },

        /**
         * 降级启动练习会话
         */
        async startPracticeSessionFallback(examId, exam) {
            const sessionId = this.generateSessionId(examId);
            const sessionData = {
                id: `active-session:${sessionId}`,
                examId: examId,
                startTime: new Date().toISOString(),
                status: 'started',
                sessionId
            };

            await window.AppData.recovery.saveActiveSession(sessionData);

            // 更新题目状态
            this.updateExamStatus(examId, 'in-progress');

            // 尝试打开练习页面
            const practiceUrl = `templates/ielts-exam-template.html?examId=${examId}`;
            window.open(practiceUrl, `practice_${sessionData.sessionId}`, 'width=1200,height=800');
        },

        /**
         * 处理题目完成
         */
        handleExamCompleted(examId, resultData) {

            // 练习记录器会自动处理完成事件
            // 这里只需要更新UI状态
            this.updateExamStatus(examId, 'completed');

            // 显示完成通知
            this.showExamCompletionNotification(examId, resultData);

            // 清理会话
            this.cleanupExamSession(examId);
        },

        /**
         * 处理题目进度
         */
        handleExamProgress(examId, progressData) {

            // 更新进度显示
            this.updateExamProgress(examId, progressData);
        },

        /**
         * 处理题目错误
         */
        handleExamError(examId, errorData) {
            console.error('Exam error:', examId, errorData);

            window.showMessage(`题目出现错误: ${errorData.message || '未知错误'}`, 'error');

            // 清理会话
            this.cleanupExamSession(examId);
        },

        /**
         * 处理数据采集器会话就绪
         */
        handleSessionReady(examId, data, expectedRegistration = null) {
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return false;
            }
            const payload = data && typeof data === 'object' ? data : {};
            const isListeningBridgeReady = payload.source === 'listening_record_bridge'
                || payload.metadata?.source === 'listening_record_bridge'
                || payload.pageType === 'listening'
                || payload.type === 'listening';
            const isPreInitReady = (isListeningBridgeReady && payload.initialized === false) || (
                !String(payload.windowSessionToken || '').trim()
                && payload.pageType === 'suite-placeholder'
            );

            // 更新会话状态
            let windowInfo = null;
            if (expectedRegistration) {
                windowInfo = expectedRegistration.windowInfo;
            } else if (this.examWindows && this.examWindows.has(examId)) {
                windowInfo = this.examWindows.get(examId);
            } else {
                windowInfo = this.ensureExamWindowSession(examId);
            }

            if (windowInfo) {
                if (isListeningBridgeReady) {
                    windowInfo.listeningBridgeSeen = true;
                    windowInfo.listeningBridgeInitialized = !isPreInitReady;
                }
                if (!isPreInitReady) {
                    windowInfo.dataCollectorReady = true;
                }
                if (payload.pageType) {
                    windowInfo.pageType = payload.pageType;
                }
                if (!isPreInitReady && payload.sessionId && windowInfo.expectedSessionId !== payload.sessionId) {
                    windowInfo.expectedSessionId = payload.sessionId;
                }
                if (payload.suiteSessionId
                    && !Object.prototype.hasOwnProperty.call(windowInfo, 'suiteSessionId')) {
                    windowInfo.suiteSessionId = payload.suiteSessionId;
                }
                if (payload.suiteFlowMode && !windowInfo.suiteFlowMode) {
                    windowInfo.suiteFlowMode = payload.suiteFlowMode;
                }
                if (Number.isInteger(payload.suiteSequenceIndex)) {
                    windowInfo.suiteSequenceIndex = payload.suiteSequenceIndex;
                }
                if (Number.isInteger(payload.suiteSequenceTotal)) {
                    windowInfo.suiteSequenceTotal = payload.suiteSequenceTotal;
                }
                if (Array.isArray(payload.suiteSequence) && payload.suiteSequence.length) {
                    windowInfo.suiteSequence = payload.suiteSequence;
                }
                if (payload.url) {
                    windowInfo.latestUrl = payload.url;
                }
                this.examWindows && this.examWindows.set(examId, windowInfo);
            }

            if (isPreInitReady) {
                try {
                    const targetWindow = (windowInfo && windowInfo.window) || null;
                    if (targetWindow && typeof targetWindow.postMessage === 'function') {
                        const initPayload = this._buildExamInitPayload(examId, windowInfo || {});
                        this._postExamMessage(examId, targetWindow, 'INIT_SESSION', initPayload);
                        this._postExamMessage(examId, targetWindow, 'init_exam_session', initPayload);
                    }
                } catch (initError) {
                    console.warn('[App] 预初始化 ready 后补发 INIT_SESSION 失败:', initError);
                }
                return;
            }

            if (this.suiteExamMap && this.suiteExamMap.has(examId) && typeof this._handleSuiteSessionReady === 'function') {
                try {
                    this._handleSuiteSessionReady(examId);
                } catch (suiteReadyError) {
                    console.warn('[SuitePractice] 标记套题页面就绪失败:', suiteReadyError);
                }
            }

            // 手动回看模式的页面可能先以普通 P1/P2 页面类型上报 SESSION_READY，
            // 不应依赖 suiteExamMap/页面类型白名单才能补发回看上下文。
            const activeSuite = this.currentSuiteSession;
            const stationarySuiteExam = Boolean(
                activeSuite
                && activeSuite.status === 'active'
                && activeSuite.flowMode === 'stationary'
                && Array.isArray(activeSuite.sequence)
                && activeSuite.sequence.some(item => item && item.examId === examId)
            );
            if (stationarySuiteExam && typeof this._sendSuiteReviewState === 'function') {
                const targetWindow = windowInfo && windowInfo.window ? windowInfo.window : null;
                try {
                    this._sendSuiteReviewState(activeSuite, examId, targetWindow);
                } catch (suiteContextError) {
                    console.warn('[SuitePractice] 手动回看页面 ready 后补发上下文失败:', suiteContextError);
                }
            }

            if (!(windowInfo && windowInfo.reviewMode)
                && this.components
                && this.components.practiceRecorder
                && typeof this.components.practiceRecorder.handleSessionStarted === 'function') {
                const recorderSessionId = (windowInfo && windowInfo.expectedSessionId) || payload.sessionId || this.generateSessionId(examId);
                try {
                    this.components.practiceRecorder.handleSessionStarted({
                        examId,
                        sessionId: recorderSessionId,
                        metadata: {
                            pageType: payload.pageType || null,
                            url: payload.url || null,
                            title: payload.title || null,
                            suiteSessionId: Object.prototype.hasOwnProperty.call(windowInfo || {}, 'suiteSessionId')
                                ? (windowInfo.suiteSessionId || null)
                                : (payload.suiteSessionId || null),
                            // 此处是练习页 SESSION_READY 后同步会话状态的时刻，注入启动时捕获的题库配置 ID。
                            libraryConfigurationId: this._readLaunchLibraryConfigurationId(examId, payload, windowInfo)
                        }
                    });
                } catch (recorderError) {
                    console.warn('[PracticeRecorder] 无法同步会话状态:', recorderError);
                }
            }

            // 停止握手重试
            try {
                if (this._handshakeTimers && this._handshakeTimers.has(examId)) {
                    clearInterval(this._handshakeTimers.get(examId));
                    this._handshakeTimers.delete(examId);
                }
            } catch (_) { }

            if (windowInfo && windowInfo.reviewMode) {
                this._dispatchReviewReplayForExam(examId, windowInfo.window || null);
            }

            // 可以在这里发送额外的配置信息给数据采集器
            // 例如题目信息、特殊设置等
        },

        /**
         * 处理练习进度更新
         */
        handleProgressUpdate(examId, data) {

            // 更新UI中的进度显示
            this.updateRealTimeProgress(examId, data);

            // 保存进度到会话数据
            if (this.examWindows && this.examWindows.has(examId)) {
                const windowInfo = this.examWindows.get(examId);
                windowInfo.lastProgress = data;
                windowInfo.lastUpdate = Date.now();
                this.examWindows.set(examId, windowInfo);
            }
        },

        _isListeningBridgeCompletionPayload(data) {
            if (!data || typeof data !== 'object') {
                return false;
            }

            const signals = [
                data.type,
                data.practiceType,
                data.pageType,
                data.source,
                data.metadata?.type,
                data.metadata?.examType,
                data.metadata?.source,
                data.scoreInfo?.source,
                data.realData?.source,
                data.realData?.type,
                data.realData?.pageType
            ].filter(Boolean).join(' ').toLowerCase();

            return signals.includes('listening_record_bridge') || signals.includes('listening');
        },

        _ensureRecorderSessionForPracticeCompletion(examId, data, sourceWindow = null, defaults = {}) {
            const recorder = this.components && this.components.practiceRecorder;
            if (!recorder) {
                return;
            }

            const windowInfo = this.examWindows && this.examWindows.has(examId)
                ? this.examWindows.get(examId)
                : null;
            const sessionId = (data && data.sessionId)
                || (windowInfo && windowInfo.expectedSessionId)
                || this.generateSessionId(examId);

            if (data && !data.sessionId) {
                data.sessionId = sessionId;
            }
            if (windowInfo && !windowInfo.expectedSessionId) {
                windowInfo.expectedSessionId = sessionId;
                this.examWindows && this.examWindows.set(examId, windowInfo);
            }

            const hasActiveSession = Boolean(
                recorder.activeSessions
                && typeof recorder.activeSessions.has === 'function'
                && recorder.activeSessions.has(examId)
            );
            const pageType = defaults.pageType
                || data?.pageType
                || data?.metadata?.pageType
                || data?.metadata?.type
                || data?.type
                || 'practice';
            const practiceType = defaults.type
                || data?.type
                || data?.metadata?.type
                || data?.metadata?.examType
                || pageType;
            const source = defaults.source
                || data?.source
                || data?.metadata?.source
                || 'practice_page';

            if (!hasActiveSession && typeof recorder.startPracticeSession === 'function') {
                try {
                    recorder.startPracticeSession(examId, {
                        sessionId,
                        title: data?.title || data?.metadata?.examTitle || '',
                        category: data?.category || data?.pageType || data?.metadata?.category || '',
                        frequency: data?.frequency || data?.metadata?.frequency || '',
                        type: practiceType,
                        totalQuestions: data?.scoreInfo?.total || data?.totalQuestions || 0,
                        libraryConfigurationId: this._readLaunchLibraryConfigurationId(examId, data, windowInfo)
                    });
                } catch (startError) {
                    console.warn('[PracticeRecorder] 完成前补建会话失败:', startError);
                }
            }

            if (typeof recorder.handleSessionStarted === 'function') {
                try {
                    recorder.handleSessionStarted({
                        examId,
                        sessionId,
                        metadata: {
                            pageType,
                            type: practiceType,
                            examType: defaults.examType || practiceType,
                            url: data?.url || data?.metadata?.url || null,
                            title: data?.title || data?.metadata?.examTitle || null,
                            suiteSessionId: data?.suiteSessionId || data?.metadata?.suiteSessionId || null,
                            source,
                            libraryConfigurationId: this._readLaunchLibraryConfigurationId(examId, data, windowInfo)
                        }
                    });
                } catch (startedError) {
                    console.warn('[PracticeRecorder] 完成前同步会话状态失败:', startedError);
                }
            }
            return true;
        },

        _normalizeListeningSpellingErrors(examId, data) {
            if (!this._isListeningBridgeCompletionPayload(data) || !Array.isArray(data?.spellingErrors)) {
                return;
            }

            const resolvedExamId = data?.examId || examId;
            const collector = window.spellingErrorCollector;
            const detectedSource = collector && typeof collector.detectSource === 'function'
                ? collector.detectSource(resolvedExamId)
                : '';

            data.spellingErrors = data.spellingErrors.map((error) => {
                if (!error || typeof error !== 'object') {
                    return error;
                }
                const normalized = Object.assign({}, error, { examId: resolvedExamId });
                if (data?.suiteSessionId && !normalized.suiteId) {
                    normalized.suiteId = data.suiteSessionId;
                }
                if ((detectedSource === 'p1' || detectedSource === 'p4') && (!normalized.source || normalized.source === 'other')) {
                    normalized.source = detectedSource;
                }
                return normalized;
            });
        },

        /**
         * 处理练习完成（真实数据）
         */
        async handlePracticeComplete(examId, data, sourceWindow = null, options = {}) {
            const expectedRegistration = options && options.expectedRegistration || null;
            const ownsRegistration = () => !expectedRegistration
                || this._isExamSessionRegistrationCurrent(examId, expectedRegistration);
            if (!ownsRegistration()) return false;
            if (data && !data.sessionId) {
                data.sessionId = `${examId}_${Date.now()}`;
            }
            if (String(data?.practiceMode || data?.metadata?.practiceMode || '').toLowerCase() === 'memorize') {
                console.info('[ReadingMemorize] 背题模式完成事件不保存为正式练习记录:', examId);
                return;
            }
            if (this._replayPracticeSubmitReceipt(examId, data, sourceWindow)) {
                return true;
            }

            // 听力桥返回的填空答案直接按 answerComparison 检测，不能依赖题源目录名必须包含 P1/P4。
            try {
                const collector = window.spellingErrorCollector;
                const hasExisting = Array.isArray(data?.spellingErrors) && data.spellingErrors.length > 0;
                const comparison = typeof this._resolveCompletionAnswerComparison === 'function'
                    ? this._resolveCompletionAnswerComparison(data)
                    : (data?.answerComparison || data?.realData?.answerComparison || null);

                if (!hasExisting && collector && typeof collector.detectErrors === 'function' && comparison && typeof comparison === 'object') {
                    const examIdForDetect = data?.examId || examId;
                    const source = typeof collector.detectSource === 'function'
                        ? collector.detectSource(examIdForDetect)
                        : 'other';
                    const completionSignals = [
                        data?.type,
                        data?.practiceType,
                        data?.pageType,
                        data?.metadata?.type,
                        data?.metadata?.examType,
                        data?.metadata?.source,
                        data?.source,
                        data?.scoreInfo?.source,
                        data?.realData?.source
                    ].filter(Boolean).join(' ').toLowerCase();
                    const isListeningCompletion = completionSignals.includes('listening');

                    if (source === 'p1' || source === 'p4' || isListeningCompletion) {
                        const suiteId = data?.suiteId || null;
                        const detected = collector.detectErrors(comparison, suiteId, examIdForDetect);
                        if (Array.isArray(detected) && detected.length > 0) {
                            data.spellingErrors = detected;
                        } else if (!Array.isArray(data.spellingErrors)) {
                            data.spellingErrors = [];
                        }
                    }
                }
            } catch (error) {
                console.warn('[DataCollection] 拼写错误检测失败，已忽略:', error);
            }
            this._normalizeListeningSpellingErrors(examId, data);
            // Reading/placeholder completions need the same active-session rebind that
            // listening already performed: hot-upgraded PracticeRecorder instances otherwise
            // reject production saves when activeSessions was empty.
            this._ensureRecorderSessionForPracticeCompletion(examId, data, sourceWindow);

            let suiteHandlerDeclined = false;
            const payloadSuiteSessionId = (
                data
                && typeof data === 'object'
                && typeof data.suiteSessionId === 'string'
            ) ? data.suiteSessionId.trim() : '';
            const payloadSuiteId = (
                data
                && typeof data === 'object'
                && typeof data.suiteId === 'string'
            ) ? data.suiteId.trim() : '';
            const registeredWindowInfo = expectedRegistration && expectedRegistration.windowInfo
                ? expectedRegistration.windowInfo
                : (this.examWindows && this.examWindows.get(examId));
            const registrationOwnsSource = Boolean(
                registeredWindowInfo
                // A current expectedRegistration already passed the message handler's
                // source/token checks.  Direct callers without that proof still need an
                // exact source-window match before registration metadata can route them.
                && (expectedRegistration || !sourceWindow || registeredWindowInfo.window === sourceWindow)
            );
            const registeredSuiteSessionId = registrationOwnsSource
                && typeof registeredWindowInfo.suiteSessionId === 'string'
                ? registeredWindowInfo.suiteSessionId.trim()
                : '';
            const declaredPracticeMode = String(
                data?.practiceMode || data?.metadata?.practiceMode || ''
            ).trim().toLowerCase();
            const shouldDelegateToSuiteHandler = Boolean(
                payloadSuiteId
                || payloadSuiteSessionId
                || registeredSuiteSessionId
                || data?.suiteSubmission === true
                || declaredPracticeMode === 'suite'
            );

            if (shouldDelegateToSuiteHandler && typeof this.handleSuitePracticeComplete === 'function') {
                try {
                    const suiteOutcome = await this.handleSuitePracticeComplete(examId, data, sourceWindow);
                    if (!ownsRegistration()) return false;
                    const handled = suiteOutcome === true || Boolean(suiteOutcome && suiteOutcome.handled);
                    if (handled) {
                        const committed = !suiteOutcome || typeof suiteOutcome !== 'object' || suiteOutcome.committed !== false;
                        this._announcePracticeSubmitOutcome(examId, data, sourceWindow, committed, {
                            errorCode: suiteOutcome && suiteOutcome.errorCode
                        });
                        if (committed && suiteOutcome && suiteOutcome.teardownSession && typeof this._teardownSuiteSession === 'function') {
                            try {
                                this._scheduleSuiteSubmitTeardown(suiteOutcome.teardownSession);
                            } catch (teardownError) {
                                console.warn('[SuitePractice] 套题已提交，但延迟清理调度失败:', teardownError);
                            }
                        }
                        return committed;
                    }
                    suiteHandlerDeclined = true;
                } catch (suiteError) {
                    console.error('[SuitePractice] 处理套题结果失败，保留 v2 恢复快照:', suiteError);
                    window.showMessage && window.showMessage('套题模式出现异常，恢复快照已保留，请稍后重试。', 'error');
                    suiteHandlerDeclined = true;
                }
            }

            if (suiteHandlerDeclined && shouldDelegateToSuiteHandler) {
                return false;
            }
            if (shouldDelegateToSuiteHandler && typeof this.handleSuitePracticeComplete !== 'function') {
                return false;
            }

            const recorder = this.components && this.components.practiceRecorder;
            const completionData = data;
            // The generic completion rebind above already covers listening payloads.

            let completionCommitted = false;
            let completedViaFallback = false;
            try {
                let persistedRecord = null;
                if (recorder && typeof recorder.handleSessionCompleted === 'function') {
                    try {
                        persistedRecord = await recorder.handleSessionCompleted(completionData);
                    } catch (recErr) {
                        console.warn('[DataCollection] PracticeRecorder 完成事件处理失败，改用降级存储:', recErr);
                        persistedRecord = await this.saveRealPracticeData(examId, completionData, { savingAsFallback: true });
                        completedViaFallback = true;
                    }
                } else {
                    persistedRecord = await this.saveRealPracticeData(examId, completionData, { savingAsFallback: true });
                    completedViaFallback = true;
                }

                if (!persistedRecord || typeof persistedRecord !== 'object' || !String(persistedRecord.id || '').trim()) {
                    throw new Error('Practice completion returned without a committed record');
                }
                if (!ownsRegistration()) return false;

                let completionReadable = false;
                if (typeof this._isPracticeCompletionPersisted === 'function') {
                    try {
                        completionReadable = await this._isPracticeCompletionPersisted(persistedRecord);
                    } catch (verificationError) {
                        console.warn('[DataCollection] 练习记录提交后回读失败，不影响已提交结果:', verificationError);
                    }
                }
                if (!completionReadable) {
                    throw new Error('Practice completion could not be verified in canonical storage');
                }
                if (!ownsRegistration()) return false;
                completionCommitted = true;

                if (completedViaFallback && recorder && typeof recorder.endPracticeSession === 'function') {
                    recorder.endPracticeSession(examId);
                }

                // 单篇阅读 final-submit 落库成功后，把已存档 recordId 回传给结果页，
                // 使其可以在只读提交态编辑笔记并以 READING_ANNOTATION_SYNC 持久化回该记录。
                // 套题流程在上方的 handleSuitePracticeComplete 分支已 return，不会走到这里。
                this._announceSubmittedReadingRecord(examId, persistedRecord, completionData, sourceWindow);
                this._announcePracticeSubmitOutcome(examId, completionData, sourceWindow, true);

                if (typeof this.clearReadingDraftForExam === 'function') {
                    try {
                        await this.clearReadingDraftForExam(examId, {
                            sessionId: completionData && completionData.sessionId
                                ? String(completionData.sessionId)
                                : null,
                            // 完成事件已通过严格的 message/session 校验，删除该题草稿时
                            // 允许命中“恢复前的旧 session id”的存档，避免已提交答案被复活。
                            acceptResumeSessionId: true
                        });
                    } catch (_) {
                        // draft cleanup is best-effort
                    }
                }

                // 刷新内存中的练习记录，确保无需手动刷新即可看到
                // 注意：数据已落库，UI 同步失败不应传播为"保存失败"，否则会误导用户并可能诱发重复提交。
                try {
                    if (typeof window.syncPracticeRecords === 'function') {
                        await window.syncPracticeRecords({ forceRender: true });
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
                } catch (syncErr) {
                    console.error('[DataCollection] 刷新练习记录失败（数据已保存，不影响落库结果）:', syncErr);
                }

                // P1/P4：落库后同步保存错词到词表（multi-suite 在 finalizeMultiSuiteRecord 内处理）
                if (Array.isArray(data?.spellingErrors) && data.spellingErrors.length > 0
                    && window.spellingErrorCollector
                    && typeof window.spellingErrorCollector.saveErrors === 'function') {
                    try {
                        await window.spellingErrorCollector.saveErrors(data.spellingErrors);
                    } catch (saveError) {
                        console.warn('[DataCollection] 保存拼写错误词表失败（不影响主流程）:', saveError);
                    }
                }

                // 更新UI状态
                this.updateExamStatus(examId, 'completed');

                // 显示完成通知（使用真实数据）
                await this.showRealCompletionNotification(examId, data);

                // 检查成就（解锁判定由 achievements.progress projector 负责，这里只读取差异并提示）
                if (window.AchievementManager) {
                    window.AchievementManager.check().catch(console.warn);
                }

            } catch (error) {
                console.error('[DataCollection] 处理练习完成数据失败:', error);
                window.showMessage && window.showMessage('练习记录保存失败，请稍后重试', 'error');
                this._announcePracticeSubmitOutcome(examId, completionData, sourceWindow, false, {
                    errorCode: 'save_failed'
                });
            } finally {
                if (completionCommitted) {
                    try {
                        if (this._isResetCapableUnifiedReadingCompletion(completionData, sourceWindow)) {
                            await this.retainExamWindowAfterCompletion(
                                examId,
                                sourceWindow,
                                completionData,
                                expectedRegistration
                            );
                        } else {
                            await this.cleanupExamSession(examId, { expectedRegistration });
                        }
                    } catch (cleanupError) {
                        console.warn('[DataCollection] 练习已提交，但会话清理失败:', cleanupError);
                    }
                }
            }
            return completionCommitted;
        },

        /**
         * 处理数据采集错误
         */
        async handleDataCollectionError(examId, data) {
            console.error('[DataCollection] 数据采集错误:', examId, data);

            // 记录错误但不中断用户体验
            const errorInfo = {
                examId: examId,
                error: data,
                timestamp: Date.now(),
                type: 'data_collection_error'
            };

            console.warn('[DataCollection] 诊断信息:', errorInfo);

            // 标记该会话使用模拟数据
            if (this.examWindows && this.examWindows.has(examId)) {
                const windowInfo = this.examWindows.get(examId);
                windowInfo.useSimulatedData = true;
                this.examWindows.set(examId, windowInfo);
            }
        },

        /**
         * 更新实时进度显示
         */
        updateRealTimeProgress(examId, progressData) {
            // 在UI中显示实时进度
            const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
            examCards.forEach(card => {
                let progressInfo = card.querySelector('.real-progress-info');
                if (!progressInfo) {
                    progressInfo = document.createElement('div');
                    progressInfo.className = 'real-progress-info';
                    progressInfo.style.cssText = `
                        font-size: 12px;
                        color: #666;
                        margin-top: 5px;
                        padding: 3px 6px;
                        background: #f0f8ff;
                        border-radius: 3px;
                    `;
                    card.appendChild(progressInfo);
                }

                const { answeredQuestions, totalQuestions, elapsedTime } = progressData;
                const minutes = Math.floor(elapsedTime / 60);
                const seconds = elapsedTime % 60;

                progressInfo.textContent = `进度: ${answeredQuestions}/${totalQuestions} | 用时: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            });
        },

        /**
         * 保存真实练习数据
         */
        async saveRealPracticeData(examId, realData, options = {}) {
            try {
                const forceIndividualSave = Boolean(options && options.forceIndividualSave);
                const suiteSessionId = realData?.suiteSessionId
                    || realData?.metadata?.suiteSessionId
                    || realData?.scoreInfo?.suiteSessionId
                    || null;
                const normalizedPracticeMode = String(realData?.practiceMode || realData?.metadata?.practiceMode || '').toLowerCase();
                const normalizedFrequency = String(realData?.frequency || realData?.metadata?.frequency || '').toLowerCase();
                const hasSuiteMapping = Boolean(this.suiteExamMap && this.suiteExamMap.has(examId));
                const hasSuiteEntries = Array.isArray(realData?.suiteEntries) && realData.suiteEntries.length > 0;
                const aggregatePayload = hasSuiteEntries || Array.isArray(realData?.metadata?.suiteEntries);
                const isSuiteFlow = Boolean(
                    suiteSessionId
                    || realData?.suiteMode
                    || normalizedPracticeMode === 'suite'
                    || normalizedFrequency === 'suite'
                    || hasSuiteMapping
                );
                const savingAsFallback = Boolean(options && options.savingAsFallback);

                if (!savingAsFallback) {
                    if (isSuiteFlow && !aggregatePayload && !forceIndividualSave) {
                        console.log('[DataCollection] 套题模式结果由套题流程接管，跳过单篇降级保存:', {
                            examId,
                            suiteSessionId: suiteSessionId || null
                        });
                        return;
                    }
                }

                const exam = await findExamDefinition(examId);
                if (!exam) {
                    throw new Error(`无法找到题目信息: ${examId}`);
                }

                const metadata = Object.assign({}, realData?.metadata || {}, {
                    examId,
                    examTitle: exam.title || realData?.title || '',
                    category: exam.category || realData?.category || realData?.metadata?.category || 'unknown',
                    frequency: exam.frequency || realData?.frequency || realData?.metadata?.frequency || 'unknown',
                    type: exam.type || realData?.type || realData?.practiceType || null,
                    // 启动时捕获的题库配置 ID；优先取 realData.metadata 显式值，再回退到启动时
                    // 在 openExam 捕获的 mixin 私有 Map 值，最后显式随 metadata 写入为 null，
                    // 让记录来源稳定不受到提交时当前激活题库的影响。
                    libraryConfigurationId: this._readLaunchLibraryConfigurationId(examId, realData)
                });

                const payload = Object.assign({}, realData, {
                    examId: realData?.examId || examId,
                    derivedExamId: realData?.derivedExamId || examId,
                    title: realData?.title || exam.title || '',
                    category: realData?.category || metadata.category,
                    frequency: realData?.frequency || metadata.frequency,
                    metadata
                });

                const receipt = await window.AppData.practice.completeAttempt({
                    record: payload,
                    operationId: payload.operationId
                        || payload.messageId
                        || (payload.submissionId
                            ? `practice-complete:${String(payload.examId || examId)}:${String(payload.sessionId || 'session')}:${String(payload.submissionId)}`
                            : undefined)
                });

                console.log('[DataCollection] 练习完成数据已保存到 canonical store');
                return receipt.record;
            } catch (error) {
                console.error('[DataCollection] 保存真实数据失败:', error);
                throw error;
            }
        },

        /**
         * 显示真实完成通知
         */
        async showRealCompletionNotification(examId, realData) {
            const examIndex = await getActiveExamIndexSnapshot();
            const list = Array.isArray(examIndex) ? examIndex : [];
            const exam = list.find(e => e.id === examId);

            if (!exam) return;

            const scoreInfo = realData.scoreInfo;
            if (scoreInfo) {
                const accuracy = scoreInfo.percentage || Math.round((scoreInfo.accuracy || 0) * 100);
                const durationSeconds = Number(realData.duration);
                const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
                    ? Math.round(durationSeconds / 60)
                    : 0;

                let message = `练习完成！\n${exam.title}\n`;

                if (scoreInfo.correct !== undefined && scoreInfo.total !== undefined) {
                    message += `得分: ${scoreInfo.correct}/${scoreInfo.total} (${accuracy}%)\n`;
                } else {
                    message += `正确率: ${accuracy}%\n`;
                }

                message += `用时: ${duration} 分钟`;

                if (scoreInfo.source) {
                    message += `\n数据来源: ${scoreInfo.source === 'page_extraction' ? '页面提取' : '自动计算'}`;
                }

                window.showMessage(message, 'success');
            } else {
                // 没有分数信息的情况
                const durationSeconds = Number(realData.duration);
                const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
                    ? Math.round(durationSeconds / 60)
                    : 0;
                window.showMessage(`练习完成！\n${exam.title}\n用时: ${duration} 分钟`, 'success');
            }
        },

        /**
         * 处理题目窗口关闭
         */
        handleExamWindowClosed(examId, closedWindow = null, expectedRegistration = null) {
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return false;
            }
            const info = this.examWindows && this.examWindows.get(examId);
            const expectedWindow = info && info.window ? info.window : null;
            if (closedWindow && expectedWindow && closedWindow !== expectedWindow) {
                return false;
            }
            if (info && info.closeMonitor) {
                try { clearInterval(info.closeMonitor); } catch (_) {}
                info.closeMonitor = null;
            }

            const suite = this.currentSuiteSession;
            const isSuiteExam = Boolean(
                suite
                && this.suiteExamMap
                && this.suiteExamMap.get(examId) === suite.id
                && suite.status === 'active'
            );
            if (isSuiteExam) {
                if (String(suite.activeExamId || '') !== String(examId)) {
                    return false;
                }
                if (closedWindow && suite.windowRef && closedWindow !== suite.windowRef) {
                    return false;
                }
                suite.windowRef = null;
                suite.status = 'active';
                suite.lastUpdate = Date.now();
                const persisted = typeof this._mirrorSessionToStorage === 'function'
                    ? this._mirrorSessionToStorage(suite)
                    : false;
                if (persisted) {
                    window.showMessage && window.showMessage('套题练习窗口已关闭，当前进度已暂停并保留，可从套题模式继续。', 'warning');
                } else {
                    window.showMessage && window.showMessage('套题窗口已关闭，但恢复快照保存失败，请勿关闭主页面。', 'error');
                }
            }

            this.updateExamStatus(examId, 'interrupted');
            if (typeof this.cleanupExamSession === 'function') {
                this.cleanupExamSession(examId, { expectedRegistration });
            }
            return true;
        },

        /**
         * 更新题目状态
         */
        updateExamStatus(examId, status) {
            // 更新UI中的题目状态指示器
            const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
            examCards.forEach(card => {
                const statusIndicator = card.querySelector('.exam-status');
                if (statusIndicator) {
                    statusIndicator.className = `exam-status ${status}`;
                }
            });

            // 触发状态更新事件
            document.dispatchEvent(new CustomEvent('examStatusChanged', {
                detail: { examId, status }
            }));
        },

        /**
         * 更新题目进度
         */
        updateExamProgress(examId, progressData) {
            // 这里可以在UI中显示进度信息
            const progressPercentage = Math.round((progressData.completed / progressData.total) * 100);

            // 更新进度显示
            const examCards = document.querySelectorAll(`[data-exam-id="${examId}"]`);
            examCards.forEach(card => {
                let progressBar = card.querySelector('.exam-progress-bar');
                if (!progressBar) {
                    progressBar = document.createElement('div');
                    progressBar.className = 'exam-progress-bar';

                    const progressFillNode = document.createElement('div');
                    progressFillNode.className = 'progress-fill';
                    progressFillNode.style.width = '0%';

                    const progressTextNode = document.createElement('span');
                    progressTextNode.className = 'progress-text';
                    progressTextNode.textContent = '0%';

                    progressBar.appendChild(progressFillNode);
                    progressBar.appendChild(progressTextNode);
                    card.appendChild(progressBar);
                }

                const progressFill = progressBar.querySelector('.progress-fill');
                const progressText = progressBar.querySelector('.progress-text');

                if (progressFill) {
                    progressFill.style.width = `${progressPercentage}%`;
                }
                if (progressText) {
                    progressText.textContent = `${progressPercentage}%`;
                }
            });
        },

        /**
         * 显示题目完成通知
         */
        async showExamCompletionNotification(examId, resultData) {
            const examIndex = await getActiveExamIndexSnapshot();
            const exam = examIndex.find(e => e.id === examId);

            if (!exam) return;

            const accuracy = Math.round((resultData.accuracy || 0) * 100);
            const message = `题目完成！\n${exam.title}\n正确率: ${accuracy}%`;

            window.showMessage(message, 'success');

            // 可以显示更详细的结果模态框
            this.showDetailedResults(examId, resultData);
        },

        /**
         * 显示详细结果
         */
        async showDetailedResults(examId, resultData) {
            const examIndex = await getActiveExamIndexSnapshot();
            const exam = examIndex.find(e => e.id === examId);

            if (!exam) return;

            const accuracy = Math.round((resultData.accuracy || 0) * 100);
            const duration = this.formatDuration(resultData.duration || 0);

            const resultContent = `
                <div class="exam-result-modal">
                    <div class="result-header">
                        <h3>练习完成</h3>
                        <div class="result-score ${accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement'}">
                            ${accuracy}%
                        </div>
                    </div>
                    <div class="result-body">
                        <h4>${exam.title}</h4>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="stat-label">正确率</span>
                                <span class="stat-value">${accuracy}%</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">用时</span>
                                <span class="stat-value">${duration}</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">题目数</span>
                                <span class="stat-value">${resultData.totalQuestions || exam.totalQuestions || 0}</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">正确数</span>
                                <span class="stat-value">${resultData.correctAnswers || 0}</span>
                            </div>
                        </div>
                        <div class="result-actions">
                            <button class="btn btn-primary" onclick="window.app.openExam('${examId}')">
                                再次练习
                            </button>
                            <button class="btn btn-secondary" onclick="window.app.navigateToView('analysis')">
                                查看分析
                            </button>
                            <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 显示结果模态框
            // 模态框功能已移除(resultContent);
        },

        /**
         * 显示模态框
         */

        /**
         * 清理题目会话
         */
        async _cleanupReusedWindowSessions(targetWindow, keepExamId = null, keepRegistration = null) {
            if (!targetWindow || !this.examWindows || typeof this.cleanupExamSession !== 'function') {
                return [];
            }
            const normalizedKeepExamId = keepExamId != null ? String(keepExamId).trim() : '';
            const staleRegistrations = [];
            this.examWindows.forEach((windowInfo, candidateExamId) => {
                const normalizedCandidateExamId = candidateExamId != null ? String(candidateExamId).trim() : '';
                if (!normalizedCandidateExamId || (normalizedKeepExamId && normalizedCandidateExamId === normalizedKeepExamId)) {
                    return;
                }
                if (windowInfo && windowInfo.window === targetWindow) {
                    staleRegistrations.push({
                        examId: normalizedCandidateExamId,
                        registration: this._captureExamSessionRegistration(normalizedCandidateExamId, windowInfo)
                    });
                }
            });
            for (const stale of staleRegistrations) {
                try {
                    if (keepRegistration && !this._isExamSessionRegistrationCurrent(keepExamId, keepRegistration)) break;
                    await this.cleanupExamSession(stale.examId, { expectedRegistration: stale.registration });
                } catch (error) {
                    console.warn('[App] 清理复用窗口旧题目会话失败:', stale.examId, error);
                }
            }
            return staleRegistrations.map(item => item.examId);
        },

        async cleanupExamSession(examId, options = {}) {
            const expectedRegistration = options && options.expectedRegistration || null;
            if (expectedRegistration && !this._isExamSessionRegistrationCurrent(examId, expectedRegistration)) {
                return false;
            }
            const expectedSessionId = expectedRegistration && expectedRegistration.windowInfo.expectedSessionId
                ? String(expectedRegistration.windowInfo.expectedSessionId)
                : '';
            // 清理窗口引用
            if (this.examWindows && this.examWindows.has(examId)) {
                this.examWindows.delete(examId);
            }

            // 清理消息处理器
            if (this.messageHandlers && this.messageHandlers.has(examId)) {
                const handler = this.messageHandlers.get(examId);
                window.removeEventListener('message', handler);
                this.messageHandlers.delete(examId);
            }

            // 清理活动会话
            await this._discardActiveSessionsForExam(examId, {
                expectedSessionId,
                commitGuard: () => !(this.examWindows && this.examWindows.has(examId))
            });
            return true;
        },

        /**
         * 设置练习记录器事件监听
         */
        setupPracticeRecorderEvents() {
            if (this._practiceRecorderEventsBound) {
                return;
            }

            this._practiceRecorderEventsBound = true;

            // 监听练习完成事件
            document.addEventListener('practiceSessionCompleted', (event) => {
                const { examId, practiceRecord } = event.detail;

                // 更新UI
                this.updateExamStatus(examId, 'completed');
                this.refreshOverviewData();

                // 显示完成通知
                this.showPracticeCompletionNotification(examId, practiceRecord);
            });

            // 监听练习开始事件
            document.addEventListener('practiceSessionStarted', (event) => {
                const { examId } = event.detail;

                this.updateExamStatus(examId, 'in-progress');
            });

            // 监听练习进度事件
            document.addEventListener('practiceSessionProgress', (event) => {
                const { examId, progress } = event.detail;
                this.updateExamProgress(examId, progress);
            });

            // 监听练习错误事件
            document.addEventListener('practiceSessionError', (event) => {
                const { examId, error } = event.detail;
                console.error('Practice session error:', examId, error);

                this.updateExamStatus(examId, 'error');
                window.showMessage(`练习出现错误: ${error.message || '未知错误'}`, 'error');
            });

            // 监听练习结束事件
            document.addEventListener('practiceSessionEnded', (event) => {
                const { examId, reason } = event.detail;

                if (reason !== 'completed') {
                    this.updateExamStatus(examId, 'interrupted');
                }
            });
        },

        /**
         * 显示练习完成通知
         */
        async showPracticeCompletionNotification(examId, practiceRecord) {
            const examIndex = await getActiveExamIndexSnapshot();
            const exam = examIndex.find(e => e.id === examId);

            if (!exam) return;

            const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
            const duration = this.formatDuration(practiceRecord.duration || 0);

            // 显示简单通知
            const message = `练习完成！\n${exam.title}\n正确率: ${accuracy}% | 用时: ${duration}`;
            window.showMessage(message, 'success');

            // 显示详细结果模态框
            setTimeout(() => {
                this.showDetailedPracticeResults(examId, practiceRecord);
            }, 1000);
        },

        /**
         * 显示详细练习结果
         */
        async showDetailedPracticeResults(examId, practiceRecord) {
            const examIndex = await getActiveExamIndexSnapshot();
            const exam = examIndex.find(e => e.id === examId);

            if (!exam) return;

            const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
            const duration = this.formatDuration(practiceRecord.duration || 0);

            const resultContent = `
                <div class="practice-result-modal">
                    <div class="result-header">
                        <h3>练习完成</h3>
                        <div class="result-score ${accuracy >= 80 ? 'excellent' : accuracy >= 60 ? 'good' : 'needs-improvement'}">
                            ${accuracy}%
                        </div>
                    </div>
                    <div class="result-body">
                        <h4>${exam.title}</h4>
                        <div class="result-stats">
                            <div class="result-stat">
                                <span class="stat-label">正确率</span>
                                <span class="stat-value">${accuracy}%</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">用时</span>
                                <span class="stat-value">${duration}</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">题目数</span>
                                <span class="stat-value">${practiceRecord.totalQuestions || 0}</span>
                            </div>
                            <div class="result-stat">
                                <span class="stat-label">正确数</span>
                                <span class="stat-value">${practiceRecord.correctAnswers || 0}</span>
                            </div>
                        </div>
                        ${practiceRecord.questionTypePerformance && Object.keys(practiceRecord.questionTypePerformance).length > 0 ? `
                            <div class="question-type-performance">
                                <h5>题型表现</h5>
                                <div class="type-performance-list">
                                    ${Object.entries(practiceRecord.questionTypePerformance).map(([type, perf]) => `
                                        <div class="type-performance-item">
                                            <span class="type-name">${this.formatQuestionType(type)}</span>
                                            <span class="type-accuracy">${Math.round((perf.accuracy || 0) * 100)}%</span>
                                            <span class="type-count">(${perf.correct || 0}/${perf.total || 0})</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}
                        <div class="result-actions">
                            <button class="btn btn-primary" onclick="window.app.openExam('${examId}')">
                                再次练习
                            </button>
                            <button class="btn btn-secondary" onclick="window.app.navigateToView('practice')">
                                查看记录
                            </button>
                            <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 模态框功能已移除(resultContent);
        },

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
        },

        // createReturnNavigation 方法已删除

        /**
         * 显示活动会话指示器
         */

        /**
         * 显示活动会话详情
         */
        async showActiveSessionsDetails() {
            const activeSessions = await window.AppData.recovery.listActiveSessions();
            const examIndex = await getActiveExamIndexSnapshot();

            if (activeSessions.length === 0) {
                window.showMessage('当前没有活动的练习会话', 'info');
                return;
            }

            const sessionsContent = `
                <div class="active-sessions-modal">
                    <div class="sessions-header">
                        <h3>活动练习会话 (${activeSessions.length})</h3>
                        <button class="close-sessions" onclick="this.closest('.modal-overlay').remove()">×</button>
                    </div>
                    <div class="sessions-body">
                        ${activeSessions.map(session => {
                const exam = examIndex.find(e => e.id === session.examId);
                const duration = Date.now() - new Date(session.startTime).getTime();

                return `
                                <div class="session-item">
                                    <div class="session-info">
                                        <h4>${exam ? exam.title : '未知题目'}</h4>
                                        <div class="session-meta">
                                            <span>开始时间: ${this.formatDate(session.startTime, 'HH:mm')}</span>
                                            <span>已用时: ${this.formatDuration(Math.floor(duration / 1000))}</span>
                                        </div>
                                    </div>
                                    <div class="session-actions">
                                        <button class="btn btn-sm btn-primary" onclick="window.app.focusExamWindow('${session.examId}')">
                                            切换到窗口
                                        </button>
                                        <button class="btn btn-sm btn-secondary" onclick="window.app.closeExamSession('${session.examId}')">
                                            结束会话
                                        </button>
                                    </div>
                                </div>
                            `;
            }).join('')}
                    </div>
                    <div class="sessions-footer">
                        <button class="btn btn-outline" onclick="window.app.closeAllExamSessions()">
                            结束所有会话
                        </button>
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            关闭
                        </button>
                    </div>
                </div>
            `;

            // 模态框功能已移除(sessionsContent);
        },

        /**
         * 聚焦到题目窗口
         */
        focusExamWindow(examId) {
            if (this.examWindows && this.examWindows.has(examId)) {
                const windowData = this.examWindows.get(examId);
                if (windowData.window && !windowData.window.closed) {
                    windowData.window.focus();
                    window.showMessage('已切换到题目窗口', 'info');
                } else {
                    window.showMessage('题目窗口已关闭', 'warning');
                    this.cleanupExamSession(examId);
                }
            } else {
                window.showMessage('找不到题目窗口', 'error');
            }
        },

        /**
         * 关闭题目会话
         */
        closeExamSession(examId) {
            if (this.examWindows && this.examWindows.has(examId)) {
                const windowData = this.examWindows.get(examId);
                if (windowData.window && !windowData.window.closed) {
                    windowData.window.close();
                }
            }

            this.cleanupExamSession(examId);
            window.showMessage('会话已结束', 'info');
        },

        /**
         * 关闭所有题目会话
         */
        async closeAllExamSessions() {
            const activeSessions = await window.AppData.recovery.listActiveSessions();

            activeSessions.forEach(session => {
                this.closeExamSession(session.examId);
            });

            // 关闭模态框
            const modal = document.querySelector('.modal-overlay');
            if (modal) {
                modal.remove();
            }

            window.showMessage('所有会话已结束', 'info');
        },

        /**
         * 开始会话监控
         */
        startSessionMonitoring() {
            // 禁用活动会话监控，以避免误判窗口关闭状态
            if (this.sessionMonitorInterval) {
                clearInterval(this.sessionMonitorInterval);
                this.sessionMonitorInterval = null;
            }
            return;
            // 每30秒检查一次活动会话
            this.sessionMonitorInterval = setInterval(() => {
                this.cleanupClosedWindows();
            }, 30000);
        },

        /**
         * 清理已关闭的窗口
         */
        cleanupClosedWindows() {
            if (!this.examWindows) return;

            const closedExamIds = [];

            this.examWindows.forEach((windowData, examId) => {
                if (windowData.window.closed) {
                    closedExamIds.push(examId);
                }
            });

            closedExamIds.forEach(examId => {
                this.handleExamWindowClosed(examId);
            });
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.examSession = mixin;
})(typeof window !== "undefined" ? window : globalThis);
