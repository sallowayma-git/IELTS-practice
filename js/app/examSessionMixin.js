(function (global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');
    const PRACTICE_ENHANCER_SCRIPT_PATH = './js/practice-page-enhancer.js';
    const ANSWER_MATCH_CORE_SCRIPT_PATH = './js/utils/answerMatchCore.js';
    const SUITE_BACK_GUARD_SCRIPT_PATH = './js/utils/suiteBackGuard.js';
    const PRACTICE_ENHANCER_BUILD_ID = '20250105';

    async function getActiveExamIndexSnapshot() {
        const stateGetters = [
            () => (typeof global.getExamIndexState === 'function') ? global.getExamIndexState() : null,
            () => (typeof getExamIndexState === 'function') ? getExamIndexState : null
        ];

        for (const getterFactory of stateGetters) {
            try {
                const getter = getterFactory();
                if (typeof getter === 'function') {
                    const state = getter();
                    if (Array.isArray(state) && state.length) {
                        return state.slice();
                    }
                }
            } catch (_) { }
        }

        let activeKey = 'exam_index';
        try {
            if (typeof global.getActiveLibraryConfigurationKey === 'function') {
                const resolved = await global.getActiveLibraryConfigurationKey();
                if (resolved && typeof resolved === 'string' && resolved.trim()) {
                    activeKey = resolved.trim();
                }
            } else {
                const storedKey = await storage.get('active_exam_index_key', 'exam_index');
                if (storedKey && typeof storedKey === 'string' && storedKey.trim()) {
                    activeKey = storedKey.trim();
                }
            }
        } catch (_) {
            try {
                const storedKey = await storage.get('active_exam_index_key', 'exam_index');
                if (storedKey && typeof storedKey === 'string' && storedKey.trim()) {
                    activeKey = storedKey.trim();
                }
            } catch (_) { }
        }

        let dataset = await storage.get(activeKey, []) || [];
        if ((!Array.isArray(dataset) || dataset.length === 0) && activeKey !== 'exam_index') {
            dataset = await storage.get('exam_index', []) || [];
        }
        if (!Array.isArray(dataset) || dataset.length === 0) {
            if (Array.isArray(global.examIndex) && global.examIndex.length) {
                dataset = global.examIndex.slice();
            } else if (Array.isArray(global.completeExamIndex) && global.completeExamIndex.length) {
                dataset = global.completeExamIndex.slice();
            }
        }
        return Array.isArray(dataset) ? dataset : [];
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

        const fallbacks = [
            Array.isArray(global.examIndex) ? global.examIndex : null,
            Array.isArray(global.completeExamIndex) ? global.completeExamIndex : null,
            Array.isArray(global.listeningExamIndex) ? global.listeningExamIndex : null
        ];
        for (const fallback of fallbacks) {
            if (!Array.isArray(fallback)) continue;
            const found = fallback.find(entry => entry && entry.id === examId);
            if (found) {
                return found;
            }
        }

        return null;
    }

    const mixin = {
        /**
          * 打开指定题目进行练习
          */
        async openExam(examId, options = {}) {
            const examIndex = await getActiveExamIndexSnapshot();
            const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            const exam = list.find(e => e.id === examId);
            const reviewMode = Boolean(options && options.reviewMode);

            if (!exam) {
                window.showMessage('题目不存在', 'error');
                return;
            }

            try {
                const readingLaunch = typeof this.resolveReadingLaunchDescriptor === 'function'
                    ? this.resolveReadingLaunchDescriptor(exam)
                    : null;

                if (readingLaunch && readingLaunch.mode === 'pdf_manual' && readingLaunch.pdfUrl) {
                    return this._openPdfWindow(exam, readingLaunch.pdfUrl, options);
                }

                // 若无HTML，直接打开PDF
                if (!readingLaunch && exam.hasHtml === false) {
                    const pdfUrl = (typeof window.buildResourcePath === 'function')
                        ? window.buildResourcePath(exam, 'pdf')
                        : ((exam.path || '').replace(/\\/g, '/').replace(/\/+\//g, '/') + (exam.pdfFilename || ''));
                    const resolvedPdfUrl = this._ensureAbsoluteUrl(pdfUrl);
                    return this._openPdfWindow(exam, resolvedPdfUrl, options);
                }

                const guardOptions = { ...options, examId };
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
                let examWindow = this.openExamWindow(examUrl, exam, guardOptions);

                try {
                    const guardedWindow = this._guardExamWindowContent(examWindow, exam, guardOptions);
                    if (guardedWindow) {
                        examWindow = guardedWindow;
                    }
                } catch (guardError) {
                    console.warn('[App] 题目窗口占位页守护失败:', guardError);
                }

                // 再进行会话记录与脚本注入
                if (!reviewMode) {
                    await this.startPracticeSession(examId);
                }
                this.injectDataCollectionScript(examWindow, examId, exam);
                this.setupExamWindowManagement(examWindow, examId, exam, options);

                if (options && options.suiteSessionId) {
                    const sessionInfo = this.ensureExamWindowSession(examId, examWindow);
                    sessionInfo.suiteSessionId = options.suiteSessionId;
                    if (options.suiteFlowMode) {
                        sessionInfo.suiteFlowMode = options.suiteFlowMode;
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
                }

                if (reviewMode && typeof this._bindReviewWindowRef === 'function') {
                    this._bindReviewWindowRef(options.reviewSessionId, examWindow);
                }

                window.showMessage(
                    reviewMode ? `正在打开历史回顾: ${exam.title}` : `正在打开题目: ${exam.title}`,
                    'info'
                );

                return examWindow;

            } catch (error) {
                console.error('Failed to open exam:', error);
                window.showMessage('打开题目失败，请重试', 'error');
            }
        },

        _openPdfWindow(exam, resolvedPdfUrl, options = {}) {
            let pdfWin = null;

            if (options.reuseWindow && !options.reuseWindow.closed) {
                try {
                    options.reuseWindow.location.href = resolvedPdfUrl;
                    options.reuseWindow.focus();
                    pdfWin = options.reuseWindow;
                } catch (reuseError) {
                    console.warn('[App] 无法复用已打开的标签，尝试重新打开:', reuseError);
                }
            }

            if (!pdfWin) {
                if (options.target === 'tab') {
                    try {
                        pdfWin = window.open(resolvedPdfUrl, '_blank');
                    } catch (_) { }
                } else {
                    try {
                        pdfWin = window.open(resolvedPdfUrl, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                    } catch (_) { }
                }
            }

            if (!pdfWin) {
                try {
                    window.location.href = resolvedPdfUrl;
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
            const finalUrl = this._ensureAbsoluteUrl(examUrl);
            if (reuseWindow && !reuseWindow.closed) {
                try {
                    reuseWindow.location.href = finalUrl;
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
                    tabWindow = window.open(finalUrl, requestedName);
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
                examWindow = window.open(
                    finalUrl,
                    `exam_${exam.id}`,
                    windowFeatures
                );
            } catch (_) { }

            // 弹窗被拦截时，降级为当前窗口打开，确保用户可进入练习页
            if (!examWindow) {
                try {
                    window.location.href = finalUrl;
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
                    return examWindow;
                }
                examWindow.location.href = placeholderUrl;
                return examWindow;
            } catch (navigationError) {
                console.warn('[App] 题目窗口导航占位页失败，尝试重新打开:', navigationError);
                try {
                    const windowName = (options && options.windowName)
                        ? String(options.windowName)
                        : (examWindow.name || '_blank');
                    const reopened = window.open(placeholderUrl, windowName);
                    if (reopened) {
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
        injectDataCollectionScript(examWindow, examId, exam = null) {
            if (this._isUnifiedReadingExam(exam)) {
                return;
            }

            const ensureScriptUrl = () => {
                const resolved = this._ensureAbsoluteUrl(PRACTICE_ENHANCER_SCRIPT_PATH);
                if (!resolved) {
                    return PRACTICE_ENHANCER_SCRIPT_PATH;
                }
                if (!PRACTICE_ENHANCER_BUILD_ID) {
                    return resolved;
                }
                return resolved.includes('?')
                    ? `${resolved}&v=${PRACTICE_ENHANCER_BUILD_ID}`
                    : `${resolved}?v=${PRACTICE_ENHANCER_BUILD_ID}`;
            };
            const ensureCoreScriptUrl = () => {
                const resolved = this._ensureAbsoluteUrl(ANSWER_MATCH_CORE_SCRIPT_PATH);
                return resolved || ANSWER_MATCH_CORE_SCRIPT_PATH;
            };
            const ensureBackGuardScriptUrl = () => {
                const resolved = this._ensureAbsoluteUrl(SUITE_BACK_GUARD_SCRIPT_PATH);
                return resolved || SUITE_BACK_GUARD_SCRIPT_PATH;
            };

            const injectScript = () => {
                try {
                    if (!examWindow || examWindow.closed) {
                        console.warn('[DataInjection] 目标窗口已关闭');
                        return;
                    }

                    if (examWindow.practicePageEnhancer && typeof examWindow.practicePageEnhancer.initialize === 'function') {
                        this.initializePracticeSession(examWindow, examId);
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

                    // 套题占位页自带消息协议与按钮，不需要再注入增强器（避免重复发送 PRACTICE_COMPLETE）
                    try {
                        if (doc.getElementById('complete-exam-btn') && doc.getElementById('force-ready-btn')) {
                            return;
                        }
                    } catch (_) { }

                    const host = doc.head || doc.body;
                    const existingEnhancerScript = host.querySelector('script[data-practice-enhancer="true"]');
                    if (existingEnhancerScript) {
                        return;
                    }
                    let enhancerInjected = false;
                    const appendEnhancer = () => {
                        if (enhancerInjected || (examWindow.practicePageEnhancer && typeof examWindow.practicePageEnhancer.initialize === 'function')) {
                            return;
                        }
                        enhancerInjected = true;
                        const scriptEl = doc.createElement('script');
                        scriptEl.type = 'text/javascript';
                        scriptEl.defer = true;
                        scriptEl.dataset.practiceEnhancer = 'true';
                        scriptEl.src = ensureScriptUrl();

                        scriptEl.onload = () => {
                            setTimeout(() => {
                                try {
                                    this.initializePracticeSession(examWindow, examId);
                                } catch (sessionError) {
                                    console.warn('[DataInjection] 初始化练习会话失败:', sessionError);
                                }
                            }, 80);
                        };

                        scriptEl.onerror = (loadError) => {
                            console.warn('[DataInjection] 加载增强器失败，回退到内联脚本:', loadError);
                            scriptEl.remove();
                            this.injectInlineScript(examWindow, examId);
                        };

                        host.appendChild(scriptEl);
                    };

                    const waitForDependencyReady = (isReady, timeoutMs = 4500) => (
                        new Promise((resolve) => {
                            if (isReady()) {
                                resolve(true);
                                return;
                            }
                            const startedAt = Date.now();
                            const poll = () => {
                                if (isReady()) {
                                    resolve(true);
                                    return;
                                }
                                if ((Date.now() - startedAt) >= timeoutMs) {
                                    resolve(false);
                                    return;
                                }
                                setTimeout(poll, 40);
                            };
                            poll();
                        })
                    );

                    const ensureDependencyScript = ({
                        selector,
                        dataKey,
                        scriptUrl,
                        isReady,
                        timeoutMs = 4500
                    }) => {
                        if (isReady()) {
                            return Promise.resolve(true);
                        }
                        const existingScript = host.querySelector(selector);
                        if (!existingScript) {
                            const scriptEl = doc.createElement('script');
                            scriptEl.type = 'text/javascript';
                            scriptEl.defer = true;
                            scriptEl.dataset[dataKey] = 'true';
                            scriptEl.src = scriptUrl;
                            host.appendChild(scriptEl);
                        }
                        return waitForDependencyReady(isReady, timeoutMs);
                    };

                    const isAnswerMatchReady = () => {
                        return !!(
                            examWindow.AnswerMatchCore
                            && typeof examWindow.AnswerMatchCore.compareAnswers === 'function'
                        );
                    };

                    const isBackGuardReady = () => (
                        typeof examWindow.createSuiteBackGuard === 'function'
                        || (
                            examWindow.SuiteBackGuard
                            && typeof examWindow.SuiteBackGuard.create === 'function'
                        )
                    );

                    Promise.all([
                        ensureDependencyScript({
                            selector: 'script[data-answer-match-core="true"]',
                            dataKey: 'answerMatchCore',
                            scriptUrl: ensureCoreScriptUrl(),
                            isReady: isAnswerMatchReady,
                            timeoutMs: 4500
                        }),
                        ensureDependencyScript({
                            selector: 'script[data-suite-back-guard="true"]',
                            dataKey: 'suiteBackGuard',
                            scriptUrl: ensureBackGuardScriptUrl(),
                            isReady: isBackGuardReady,
                            timeoutMs: 2500
                        })
                    ]).finally(() => {
                        appendEnhancer();
                    });
                } catch (error) {
                    console.error('[DataInjection] 注入增强器脚本时出错:', error);
                    this.injectInlineScript(examWindow, examId);
                }
            };

            const checkAndInject = () => {
                try {
                    if (!examWindow || examWindow.closed) {
                        return;
                    }

                    const doc = examWindow.document;
                    if (doc && (doc.readyState === 'interactive' || doc.readyState === 'complete')) {
                        injectScript();
                    } else {
                        setTimeout(checkAndInject, 200);
                    }
                } catch (error) {
                    console.warn('[DataInjection] 检测题目页面就绪状态失败:', error);
                }
            };

            setTimeout(checkAndInject, 300);
        },

        /**
         * 内联脚本注入（备用方案）
         */
        injectInlineScript(examWindow, examId) {
            try {
                if (!examWindow || !examWindow.document || !examWindow.document.head) {
                    throw new Error('inline_target_unavailable');
                }

                const sessionToken = `${examId}_${Date.now()}`;
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
                            suite: {
                                active: false,
                                sessionId: null,
                                guarded: false,
                                nativeClose: typeof window.close === 'function' ? window.close.bind(window) : null,
                                nativeOpen: typeof window.open === 'function' ? window.open.bind(window) : null
                            }
                        };

                        function sendMessage(type, data) {
                            if (!parentWindow || typeof parentWindow.postMessage !== 'function') {
                                return;
                            }
                            try {
                                parentWindow.postMessage({ type: type, data: data || {} }, '*');
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
                                state.sessionId = initData.sessionId;
                            }
                            if (initData.examId) {
                                state.examId = initData.examId;
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
                                handleInitSession(message);
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
                                    source: 'inline_collector'
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

                examWindow.document.head.appendChild(inlineScript);

                setTimeout(() => {
                    this.initializePracticeSession(examWindow, examId);
                }, 300);

            } catch (error) {
                console.error('[DataInjection] 内联脚本注入失败:', error);
                this.handleInjectionError(examId, error);
            }
        },

        /**
         * 初始化练习会话
         */
        initializePracticeSession(examWindow, examId) {
            try {
                const now = Date.now();

                let existingInfo = null;
                if (this.examWindows && this.examWindows.has(examId)) {
                    existingInfo = this.examWindows.get(examId) || null;
                }

                let suiteSessionId = existingInfo && existingInfo.suiteSessionId
                    ? existingInfo.suiteSessionId
                    : null;

                if (!suiteSessionId && this.currentSuiteSession) {
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

                const windowInfo = this.ensureExamWindowSession(examId, examWindow);
                if (suiteSessionId && !windowInfo.suiteSessionId) {
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
                examWindow.postMessage({
                    type: 'INIT_SESSION',
                    data: initPayload
                }, '*');

                // 存储会话信息
                if (!this.examWindows) {
                    this.examWindows = new Map();
                }

                if (existingInfo) {
                    existingInfo.sessionId = initPayload.sessionId;
                    existingInfo.initTime = now;
                    existingInfo.status = 'initialized';
                    if (suiteSessionId && !existingInfo.suiteSessionId) {
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

            } catch (error) {
                console.error('[DataInjection] 会话初始化失败:', error);
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

            // 保存错误日志到本地存储
            const errorLogs = await storage.get('injection_errors', []);
            errorLogs.push(errorInfo);
            if (errorLogs.length > 50) {
                errorLogs.splice(0, errorLogs.length - 50); // 保留最近50条错误
            }
            await storage.set('injection_errors', errorLogs);

            // 不显示错误给用户，静默处理
            console.warn('[DataInjection] 将使用模拟数据模式');
        },

        /**
         * 设置题目窗口管理
         */
        setupExamWindowManagement(examWindow, examId, exam = null, options = {}) {
            if (!examWindow) {
                console.warn('[App] 缺少题目窗口引用，无法完成窗口管理');
                return;
            }

            try {
                const guardedWindow = this._guardExamWindowContent(examWindow, exam, { ...options, examId });
                if (guardedWindow) {
                    examWindow = guardedWindow;
                }
            } catch (guardError) {
                console.warn('[App] 守护题目窗口内容失败:', guardError);
            }

            // 存储窗口引用
            if (!this.examWindows) {
                this.examWindows = new Map();
            }

            this.examWindows.set(examId, {
                window: examWindow,
                startTime: Date.now(),
                status: 'active',
                expectedSessionId: null,
                origin: (typeof window !== 'undefined' && window.location) ? window.location.origin : '',
                suiteSessionId: (options && options.suiteSessionId) ? options.suiteSessionId : null,
                suiteFlowMode: (options && options.suiteFlowMode) ? String(options.suiteFlowMode) : null,
                suiteSequenceIndex: Number.isInteger(options && options.sequenceIndex) ? options.sequenceIndex : null,
                suiteSequenceTotal: Number.isInteger(options && options.sequenceTotal) ? options.sequenceTotal : null,
                reviewMode: Boolean(options && options.reviewMode),
                reviewSessionId: options && options.reviewSessionId ? String(options.reviewSessionId) : null,
                reviewEntryIndex: Number.isInteger(options && options.reviewEntryIndex) ? options.reviewEntryIndex : 0,
                readOnly: options && Object.prototype.hasOwnProperty.call(options, 'readOnly')
                    ? Boolean(options.readOnly)
                    : Boolean(options && options.reviewMode)
            });

            // 监听窗口关闭事件
            let checkClosed = null;
            try {
                checkClosed = setInterval(() => {
                    try {
                        if (examWindow.closed) {
                            clearInterval(checkClosed);
                            this.handleExamWindowClosed(examId);
                        }
                    } catch (monitorError) {
                        clearInterval(checkClosed);
                        console.warn('[App] 无法检测题目窗口状态:', monitorError);
                    }
                }, 1000);
            } catch (error) {
                console.warn('[App] 启动窗口关闭监控失败:', error);
            }

            // 设置窗口通信
            try {
                this.setupExamWindowCommunication(examWindow, examId, exam, options);
            } catch (error) {
                console.warn('[App] 初始化题目窗口通信失败:', error);
            }

            // 启动与练习页的会话握手（file:// 下更可靠）
            try {
                this.startExamHandshake(examWindow, examId);
            } catch (e) {
                console.warn('[App] 启动握手失败:', e);
            }

            const emitInitEnvelope = () => {
                const windowInfo = this.ensureExamWindowSession(examId, examWindow);
                const initPayload = this._buildExamInitPayload(examId, windowInfo);
                try {
                    examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                    examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
                } catch (postError) {
                    console.warn('[App] 跨源初始化题目窗口失败:', postError);
                }
            };

            if (!isFileProtocol) {
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
        },

        /**
         * 设置题目窗口通信
         */
        setupExamWindowCommunication(examWindow, examId, exam = null, options = {}) {
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
                    'ERROR_OCCURRED',
                    'REQUEST_INIT',
                    'SUITE_CLOSE_ATTEMPT',
                    'REVIEW_NAVIGATE',
                    'SUITE_CONFIG_UPDATE',
                    'SIMULATION_DRAFT_SYNC',
                    'SIMULATION_NAVIGATE',
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
                // 取得当前题目窗口引用（可能在 handshake 期间被更新）
                const storedInfo = (this.examWindows && this.examWindows.get(examId)) || {};
                const expectedWindow = storedInfo.window || examWindow;
                const sourceWindow = event ? (event.source || null) : null;

                // 缺少来源窗口直接拒绝
                if (!sourceWindow || !expectedWindow) {
                    return;
                }

                // 校验来源域，允许 file:// (origin 为 null) 与同源页面
                if (event.origin && event.origin !== 'null') {
                    const allowedOrigin = window.location && window.location.origin;
                    if (allowedOrigin && event.origin !== allowedOrigin) {
                        return;
                    }
                }

                const normalized = normalizeMessage(event.data);
                if (!normalized) {
                    return;
                }

                const windowInfo = this.ensureExamWindowSession(examId, expectedWindow);
                if (windowInfo && sourceWindow !== expectedWindow) {
                    windowInfo.window = sourceWindow;
                }
                const expectedSessionId = windowInfo.expectedSessionId || '';

                // 放宽消息源过滤，兼容 inline_collector 与 practice_page
                const src = normalized.sourceTag || '';
                const allowedSources = new Set(['practice_page', 'inline_collector', 'suite_placeholder']);
                if (src && !allowedSources.has(src)) {
                    return; // 非预期来源的消息忽略
                }

                const { type, data } = normalized;
                const expectedExamId = String(examId);
                const payloadExamId = data && data.examId != null ? String(data.examId) : '';
                const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                    ? data.suiteSessionId.trim()
                    : '';
                const activeSuiteSessionId = this.currentSuiteSession && this.currentSuiteSession.id
                    ? String(this.currentSuiteSession.id)
                    : '';
                const isExamInActiveSuite = Boolean(
                    this.currentSuiteSession
                    && Array.isArray(this.currentSuiteSession.sequence)
                    && this.currentSuiteSession.sequence.some(item => item && String(item.examId) === expectedExamId)
                );
                const sourceMatched = isLikelySameWindowContext(sourceWindow, expectedWindow);
                const allowSuiteSourceFallback = Boolean(
                    !sourceMatched
                    && payloadExamId
                    && payloadExamId === expectedExamId
                    && (
                        (payloadSuiteSessionId && activeSuiteSessionId && payloadSuiteSessionId === activeSuiteSessionId)
                        || isExamInActiveSuite
                    )
                );
                if (!sourceMatched && !allowSuiteSourceFallback) {
                    return;
                }
                const isSuiteFlowPayload = Boolean(
                    (type === 'PRACTICE_COMPLETE'
                        || type === 'SIMULATION_NAVIGATE'
                        || type === 'SIMULATION_SUBMIT'
                        || type === 'SESSION_READY')
                    && payloadSuiteSessionId
                    && activeSuiteSessionId
                    && payloadSuiteSessionId === activeSuiteSessionId
                    && payloadExamId
                    && payloadExamId === expectedExamId
                );
                const payloadSessionId = data && typeof data.sessionId === 'string'
                    ? data.sessionId.trim()
                    : '';

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
                        if (!allowSuiteSessionMismatch) {
                            return;
                        }
                        data.sessionId = expectedSessionId;
                    } else {
                        windowInfo.sessionId = payloadSessionId;
                        if (!windowInfo.expectedSessionId) {
                            windowInfo.expectedSessionId = payloadSessionId;
                        }
                    }
                } else if (type === 'PRACTICE_COMPLETE') {
                    if (!expectedSessionId) {
                        return;
                    }
                    data.sessionId = expectedSessionId;
                }

                if (payloadExamId && payloadExamId !== expectedExamId) {
                    const allowedLegacy = payloadExamId === 'session';
                    if (!allowedLegacy) {
                        return;
                    }
                }

                data.examId = examId;
                if (!data.sessionId && expectedSessionId) {
                    data.sessionId = expectedSessionId;
                }

                windowInfo.origin = event.origin;
                windowInfo.lastMessageAt = Date.now();
                windowInfo.lastMessageType = type;
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
                        this.handleSessionReady(examId, data);
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
                        if (windowInfo && windowInfo.reviewMode) {
                            console.info('[ReviewReplay] 回顾模式忽略 PRACTICE_COMPLETE:', examId);
                            break;
                        }
                        if (data && data.suiteSessionId && windowInfo) {
                            windowInfo.suiteSessionId = data.suiteSessionId;
                            this.examWindows && this.examWindows.set(examId, windowInfo);
                        }
                        await this.handlePracticeComplete(examId, data, sourceWindow || expectedWindow);
                        break;
                    case 'ERROR_OCCURRED':
                        this.handleDataCollectionError(examId, data);
                        break;
                    case 'REQUEST_INIT':
                        sendInitEnvelope(sourceWindow || examWindow);
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
                        try {
                            if (window.localStorage) {
                                window.localStorage.setItem('suite_auto_advance_after_submit', String(autoAdvance));
                            }
                        } catch (_) {
                            // ignore storage write failures
                        }
                        break;
                    }
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
                        if (this.currentSuiteSession && data && data.draft) {
                            this.currentSuiteSession.draftsByExam[examId] = data.draft;
                            if (typeof this._mirrorSessionToStorage === 'function') {
                                this._mirrorSessionToStorage(this.currentSuiteSession);
                            }
                        }
                        break;
                    case 'SIMULATION_NAVIGATE':
                        if (typeof this._handleSimulationNavigate === 'function') {
                            await this._handleSimulationNavigate(examId, data, sourceWindow || expectedWindow);
                        }
                        break;
                    case 'SIMULATION_SUBMIT':
                        if (windowInfo && windowInfo.reviewMode) {
                            break;
                        }
                        await this.handlePracticeComplete(examId, data, sourceWindow || expectedWindow);
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

            // 向题目窗口发送初始化消息（兼容 0.2 增强器监听的 INIT_SESSION）
            const sendInitEnvelope = (targetWindow) => {
                try {
                    const windowInfo = this.ensureExamWindowSession(examId, targetWindow);
                    const initPayload = this._buildExamInitPayload(examId, windowInfo);
                    targetWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                    targetWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
                } catch (initError) {
                    console.warn('[App] 发送初始化消息失败:', initError);
                }
            };

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

            let initAttached = tryAttachInitHandler(examWindow);

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
        },

        /**
         * 与练习页建立握手（重复发送 INIT_SESSION，直到收到 SESSION_READY）
         */
        startExamHandshake(examWindow, examId) {
            if (!this._handshakeTimers) this._handshakeTimers = new Map();

            // 避免重复握手
            if (this._handshakeTimers.has(examId)) return;

            const windowInfo = this.ensureExamWindowSession(examId, examWindow);
            const initPayload = this._buildExamInitPayload(examId, windowInfo);

            let attempts = 0;
            const maxAttempts = 30; // ~9s
            const tick = () => {
                if (examWindow && !examWindow.closed) {
                    try {
                        // 直接发送两种事件名，确保增强器任何实现都能收到
                        if (attempts === 0) {
                        }
                        examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
                        examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
                    } catch (_) { /* 忽略 */ }
                }
                attempts++;
                if (attempts >= maxAttempts) {
                    clearInterval(timer);
                    this._handshakeTimers.delete(examId);
                    console.warn('[App] 握手超时，练习页可能未加载增强器');
                }
            };
            const timer = setInterval(tick, 300);
            this._handshakeTimers.set(examId, timer);
            // 立即发送一次
            tick();
        },

        /**
         * 创建降级记录器
         */
        createFallbackRecorder() {
            return {
                handleRealPracticeData: async (examId, realData) => {
                    try {
                        // 获取题目信息
                        const exam = await findExamDefinition(examId);

                        if (!exam) {
                            console.error('[FallbackRecorder] 无法找到题目信息:', examId);
                            return null;
                        }

                        // 创建练习记录
                        const practiceRecord = this.createSimplePracticeRecord(exam, realData);

                        if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.savePracticeRecord === 'function') {
                            await window.PracticeCore.store.savePracticeRecord(practiceRecord);
                        } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.addPracticeRecord === 'function') {
                            await window.simpleStorageWrapper.addPracticeRecord(practiceRecord);
                        } else {
                            // 直接保存到localStorage
                            const records = await storage.get('practice_records', []);
                            records.unshift(practiceRecord);
                            const practiceKey = ['practice', 'records'].join('_');
                            await storage.set(practiceKey, records);
                        }

                        // 检查成就
                        if (window.AchievementManager) {
                            window.AchievementManager.check(practiceRecord).catch(console.warn);
                        }

                        return practiceRecord;
                    } catch (error) {
                        console.error('[FallbackRecorder] 保存失败:', error);
                        return null;
                    }
                },

                startSession: (examId) => {
                    // 简单的会话管理
                    return {
                        examId: examId,
                        startTime: new Date().toISOString(),
                        sessionId: this.generateSessionId(examId),
                        status: 'started'
                    };
                },

                getPracticeRecords: async (filters = {}) => {
                    try {
                        const records = await storage.get('practice_records', []);

                        if (Object.keys(filters).length === 0) {
                            return records;
                        }

                        return records.filter(record => {
                            if (filters.examId && record.examId !== filters.examId) return false;
                            if (filters.category && record.category !== filters.category) return false;
                            if (filters.startDate && new Date(record.startTime) < new Date(filters.startDate)) return false;
                            if (filters.endDate && new Date(record.startTime) > new Date(filters.endDate)) return false;
                            if (filters.minAccuracy && record.accuracy < filters.minAccuracy) return false;
                            if (filters.maxAccuracy && record.accuracy > filters.maxAccuracy) return false;

                            return true;
                        });
                    } catch (error) {
                        console.error('[FallbackRecorder] 获取记录失败:', error);
                        return [];
                    }
                }
            };
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

                // 详细数据
                realData: {
                    sessionId: realData.sessionId,
                    answers: realData.answers || {},
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

        _hydrateReplayCorrectAnswersFromDetails(detailSource, correctAnswers, comparison, targetExamId = '', allowUnprefixed = true) {
            if (!this._isReplayObject(detailSource)) {
                return;
            }
            const normalizedTarget = targetExamId ? String(targetExamId).trim().toLowerCase() : '';
            Object.entries(detailSource).forEach(([rawKey, rawDetail]) => {
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
                const detail = this._isReplayObject(rawDetail) ? rawDetail : {};
                const userAnswer = detail.userAnswer != null ? detail.userAnswer : '';
                const correctAnswer = detail.correctAnswer != null ? detail.correctAnswer : '';
                if (!Object.prototype.hasOwnProperty.call(correctAnswers, split.questionKey) && correctAnswer !== '') {
                    correctAnswers[split.questionKey] = this._cloneReviewData(correctAnswer);
                }
                if (!comparison[split.questionKey]) {
                    comparison[split.questionKey] = {
                        questionId: split.questionKey,
                        userAnswer: this._cloneReviewData(userAnswer),
                        correctAnswer: this._cloneReviewData(correctAnswer),
                        isCorrect: typeof detail.isCorrect === 'boolean' ? detail.isCorrect : null
                    };
                } else if (comparison[split.questionKey].correctAnswer == null || comparison[split.questionKey].correctAnswer === '') {
                    comparison[split.questionKey].correctAnswer = this._cloneReviewData(correctAnswer);
                }
            });
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
                const correctAnswer = Object.prototype.hasOwnProperty.call(existing, 'correctAnswer')
                    ? existing.correctAnswer
                    : (Object.prototype.hasOwnProperty.call(correctAnswers, questionId) ? correctAnswers[questionId] : '');
                let isCorrect = typeof existing.isCorrect === 'boolean' ? existing.isCorrect : null;
                if (isCorrect === null && userAnswer != null && correctAnswer != null && String(correctAnswer).trim()) {
                    isCorrect = String(userAnswer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
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

        _deriveReplayScoreInfo(sourceScoreInfo, comparison) {
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
            const finalTotal = Number.isFinite(resolvedTotal) && resolvedTotal >= 0 ? resolvedTotal : stats.total;
            const finalCorrect = Number.isFinite(resolvedCorrect) && resolvedCorrect >= 0 ? resolvedCorrect : stats.correct;
            const derivedAccuracy = finalTotal > 0 ? finalCorrect / finalTotal : 0;
            const resolvedAccuracy = Number(scoreInfo.accuracy);
            const finalAccuracy = Number.isFinite(resolvedAccuracy) ? resolvedAccuracy : derivedAccuracy;
            const resolvedPercentage = Number(scoreInfo.percentage);
            const finalPercentage = Number.isFinite(resolvedPercentage)
                ? resolvedPercentage
                : Math.round(finalAccuracy * 100);

            scoreInfo.correct = finalCorrect;
            scoreInfo.total = finalTotal;
            scoreInfo.totalQuestions = finalTotal;
            scoreInfo.accuracy = finalAccuracy;
            scoreInfo.percentage = finalPercentage;
            return scoreInfo;
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
            const recordCorrectSource = this._isReplayObject(record.correctAnswerMap)
                ? record.correctAnswerMap
                : (this._isReplayObject(record.correctAnswers)
                    ? record.correctAnswers
                    : (this._isReplayObject(record.realData?.correctAnswers) ? record.realData.correctAnswers : {}));
            const recordDetailSource = record.scoreInfo?.details
                || record.realData?.scoreInfo?.details
                || null;

            const builtEntries = [];
            baseEntries.forEach((rawEntry, index) => {
                const entry = this._isReplayObject(rawEntry) ? rawEntry : {};
                const entryMetadata = this._isReplayObject(entry.metadata) ? entry.metadata : {};
                const entryExamId = entry.examId
                    || entryMetadata.examId
                    || this._deriveReplayExamIdFromSources(entry.answers, entry.answerComparison, recordAnswersSource, recordComparisonSource)
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

                let correctAnswers = this._normalizeReplayAnswerMap(
                    this._isReplayObject(entry.correctAnswerMap)
                        ? entry.correctAnswerMap
                        : (this._isReplayObject(entry.correctAnswers)
                            ? entry.correctAnswers
                            : (this._isReplayObject(entry.realData?.correctAnswers) ? entry.realData.correctAnswers : {})),
                    entryExamId,
                    true
                );
                if (Object.keys(correctAnswers).length === 0) {
                    correctAnswers = this._normalizeReplayAnswerMap(recordCorrectSource, entryExamId, allowUnprefixed);
                }

                const detailSource = entry.scoreInfo?.details
                    || entry.realData?.scoreInfo?.details
                    || recordDetailSource;
                this._hydrateReplayCorrectAnswersFromDetails(
                    detailSource,
                    correctAnswers,
                    comparison,
                    entryExamId,
                    allowUnprefixed
                );

                comparison = this._finalizeReplayComparison(answers, correctAnswers, comparison);
                const scoreInfo = this._deriveReplayScoreInfo(entry.scoreInfo || entry.realData?.scoreInfo || record.scoreInfo || record.realData?.scoreInfo, comparison);
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
                    correctAnswers,
                    answerComparison: comparison,
                    scoreInfo,
                    allQuestionIds: [],
                    startTime: entry.startTime || record.startTime || record.date || null,
                    endTime: entry.endTime || record.endTime || record.date || null,
                    duration: Number(entry.duration ?? record.duration) || 0,
                    markedQuestions: Array.isArray(entry.markedQuestions)
                        ? entry.markedQuestions.slice()
                        : (Array.isArray(entryMetadata.markedQuestions)
                            ? entryMetadata.markedQuestions.slice()
                            : (Array.isArray(recordMetadata.markedQuestions) ? recordMetadata.markedQuestions.slice() : [])),
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

        _buildReviewSession(record) {
            const entries = this._buildReviewReplayEntriesFromRecord(record);
            const validEntries = entries.filter((entry) => entry && entry.examId);
            if (validEntries.length === 0) {
                return null;
            }
            return {
                sessionId: `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                entries: validEntries,
                currentIndex: 0,
                windowRef: null,
                readOnly: true
            };
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
                reviewEntryIndex: safeIndex,
                readOnly: session.readOnly !== false,
                entry: this._cloneReviewData(entry)
            };
            const contextPayload = this._buildReviewContextPayload(session, safeIndex);
            try {
                targetWindow.postMessage({ type: 'REPLAY_PRACTICE_RECORD', data: replayPayload }, '*');
                targetWindow.postMessage({ type: 'REVIEW_CONTEXT', data: contextPayload }, '*');
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

            await this.openExam(nextEntry.examId, {
                reviewMode: true,
                readOnly: true,
                reviewSessionId: sessionId,
                reviewEntryIndex: nextIndex,
                reuseWindow: session.windowRef || null
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

            const openedWindow = await this.openExam(firstEntry.examId, {
                reviewMode: true,
                readOnly: true,
                reviewSessionId: session.sessionId,
                reviewEntryIndex: 0
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
            const suiteSessionId = typeof this._resolveSuiteSessionId === 'function'
                ? this._resolveSuiteSessionId(examId, info)
                : (info.suiteSessionId || null);
            const timerContext = typeof this._resolveSuiteTimerContext === 'function'
                ? this._resolveSuiteTimerContext({}, info)
                : {
                    suiteTimerAnchorMs: info.suiteTimerAnchorMs || info.globalTimerAnchorMs || null,
                    suiteTimerMode: info.suiteTimerMode || null,
                    suiteTimerLimitSeconds: info.suiteTimerLimitSeconds || null
                };
            const payload = {
                examId: examId,
                parentOrigin: window.location.origin,
                sessionId: info.expectedSessionId,
                suiteSessionId: suiteSessionId || null,
                suiteFlowMode: info.suiteFlowMode || null,
                suiteTimerAnchorMs: timerContext.suiteTimerAnchorMs || null,
                globalTimerAnchorMs: timerContext.globalTimerAnchorMs || null,
                suiteTimerMode: timerContext.suiteTimerMode || null,
                suiteTimerLimitSeconds: timerContext.suiteTimerLimitSeconds != null ? timerContext.suiteTimerLimitSeconds : null,
                suiteSequenceIndex: Number.isInteger(info.suiteSequenceIndex) ? info.suiteSequenceIndex : null,
                suiteSequenceTotal: Number.isInteger(info.suiteSequenceTotal) ? info.suiteSequenceTotal : null,
                reviewMode: Boolean(info.reviewMode),
                reviewSessionId: info.reviewSessionId ? String(info.reviewSessionId) : null,
                reviewEntryIndex: Number.isInteger(info.reviewEntryIndex) ? info.reviewEntryIndex : 0,
                readOnly: Object.prototype.hasOwnProperty.call(info, 'readOnly')
                    ? Boolean(info.readOnly)
                    : Boolean(info.reviewMode)
            };
            if (extras && typeof extras === 'object') {
                Object.assign(payload, extras);
            }
            return payload;
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
                    origin: (typeof window !== 'undefined' && window.location) ? window.location.origin : '',
                    suiteTimerAnchorMs: null,
                    globalTimerAnchorMs: null,
                    suiteTimerMode: null,
                    suiteTimerLimitSeconds: null,
                    suiteFlowMode: null,
                    suiteSequenceIndex: null,
                    suiteSequenceTotal: null,
                    reviewMode: false,
                    reviewSessionId: null,
                    reviewEntryIndex: 0,
                    readOnly: false
                });
            }

            const windowInfo = this.examWindows.get(examId);

            if (examWindow && (!windowInfo.window || windowInfo.window.closed || windowInfo.window !== examWindow)) {
                windowInfo.window = examWindow;
            }

            if (!windowInfo.expectedSessionId) {
                windowInfo.expectedSessionId = this.generateSessionId(examId);
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
         * 开始练习会话
         */
        async startPracticeSession(examId) {
            const exam = await findExamDefinition(examId);
            if (!exam) {
                console.error('Exam not found:', examId);
                window.showMessage && window.showMessage('题目索引未加载，请重试或重新导入题库。', 'error');
                return;
            }

            try {
                // 优先使用新的练习页面管理器
                if (window.practicePageManager) {
                    const sessionId = await window.practicePageManager.startPracticeSession(examId, exam);

                    // 更新题目状态
                    this.updateExamStatus(examId, 'in-progress');
                    return sessionId;
                }

                // 使用练习记录器开始会话
                if (this.components.practiceRecorder) {
                    let sessionData;
                    if (typeof this.components.practiceRecorder.startPracticeSession === 'function') {
                        sessionData = this.components.practiceRecorder.startPracticeSession(examId, exam);
                    } else if (typeof this.components.practiceRecorder.startSession === 'function') {
                        sessionData = this.components.practiceRecorder.startSession(examId, exam);
                    } else {
                        console.warn('[App] PracticeRecorder没有可用的启动方法');
                        sessionData = null;
                    }
                } else {
                    // 降级处理
                    const sessionData = {
                        examId: examId,
                        startTime: new Date().toISOString(),
                        status: 'started',
                        sessionId: this.generateSessionId(examId)
                    };

                    const activeSessions = await storage.get('active_sessions', []);
                    activeSessions.push(sessionData);
                    await storage.set('active_sessions', activeSessions);
                }

                // 更新题目状态
                this.updateExamStatus(examId, 'in-progress');

            } catch (error) {
                console.error('[App] 启动练习会话失败:', error);

                // 最终降级方案
                this.startPracticeSessionFallback(examId, exam);
            }
        },

        /**
         * 降级启动练习会话
         */
        async startPracticeSessionFallback(examId, exam) {

            const sessionData = {
                examId: examId,
                startTime: new Date().toISOString(),
                status: 'started',
                sessionId: this.generateSessionId(examId)
            };

            const activeSessions = await storage.get('active_sessions', []);
            activeSessions.push(sessionData);
            await storage.set('active_sessions', activeSessions);

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
        handleSessionReady(examId, data) {
            const payload = data && typeof data === 'object' ? data : {};

            // 更新会话状态
            let windowInfo = null;
            if (this.examWindows && this.examWindows.has(examId)) {
                windowInfo = this.examWindows.get(examId);
            } else {
                windowInfo = this.ensureExamWindowSession(examId);
            }

            if (windowInfo) {
                windowInfo.dataCollectorReady = true;
                if (payload.pageType) {
                    windowInfo.pageType = payload.pageType;
                }
                if (payload.sessionId && windowInfo.expectedSessionId !== payload.sessionId) {
                    windowInfo.expectedSessionId = payload.sessionId;
                }
                if (payload.suiteSessionId && !windowInfo.suiteSessionId) {
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
                if (payload.url) {
                    windowInfo.latestUrl = payload.url;
                }
                this.examWindows && this.examWindows.set(examId, windowInfo);
            }

            if (this.suiteExamMap && this.suiteExamMap.has(examId) && typeof this._handleSuiteSessionReady === 'function') {
                try {
                    this._handleSuiteSessionReady(examId);
                } catch (suiteReadyError) {
                    console.warn('[SuitePractice] 标记套题页面就绪失败:', suiteReadyError);
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
                            suiteSessionId: payload.suiteSessionId || null
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

        /**
         * 处理练习完成（真实数据）
         */
        async handlePracticeComplete(examId, data, sourceWindow = null) {
            if (data && !data.sessionId) {
                data.sessionId = `${examId}_${Date.now()}`;
            }

            // 仅在P1/P4听力填空场景尝试补齐 spellingErrors（错词抓取）
            try {
                const collector = window.spellingErrorCollector;
                const hasExisting = Array.isArray(data?.spellingErrors) && data.spellingErrors.length > 0;
                const comparison = data?.answerComparison || data?.realData?.answerComparison || null;

                if (!hasExisting && collector && typeof collector.detectErrors === 'function' && comparison && typeof comparison === 'object') {
                    const examIdForDetect = data?.examId || examId;
                    const source = typeof collector.detectSource === 'function'
                        ? collector.detectSource(examIdForDetect)
                        : 'other';

                    if (source === 'p1' || source === 'p4') {
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

            let suiteHandlerDeclined = false;
            const payloadSuiteSessionId = (
                data
                && typeof data === 'object'
                && typeof data.suiteSessionId === 'string'
            ) ? data.suiteSessionId.trim() : '';
            const hasMappedSuiteExam = Boolean(this.suiteExamMap && this.suiteExamMap.has(examId));
            const hasActiveSuiteSession = Boolean(
                this.currentSuiteSession
                && this.currentSuiteSession.status === 'active'
                && (!payloadSuiteSessionId || this.currentSuiteSession.id === payloadSuiteSessionId)
            );
            const shouldDelegateToSuiteHandler = Boolean(
                data
                && typeof data === 'object'
                && typeof data.suiteId === 'string'
                && data.suiteId.trim()
            ) || hasMappedSuiteExam || Boolean(payloadSuiteSessionId) || hasActiveSuiteSession;

            if (shouldDelegateToSuiteHandler && typeof this.handleSuitePracticeComplete === 'function') {
                try {
                    const handled = await this.handleSuitePracticeComplete(examId, data, sourceWindow);
                    if (handled) {
                        return;
                    }
                    suiteHandlerDeclined = true;
                } catch (suiteError) {
                    console.error('[SuitePractice] 处理套题结果失败，回退至普通流程:', suiteError);
                    window.showMessage && window.showMessage('套题模式出现异常，记录将以单篇形式保存。', 'warning');
                    suiteHandlerDeclined = true;
                }
            }

            const recorderAvailable = this.components
                && this.components.practiceRecorder
                && typeof this.components.practiceRecorder.savePracticeRecord === 'function';

            try {
                if (recorderAvailable) {
                    try {
                        const normalizedData = suiteHandlerDeclined
                            ? Object.assign({}, data, {
                                allowStandaloneSave: true,
                                metadata: Object.assign({}, data?.metadata || {}, { allowStandaloneSave: true, suiteFallback: true })
                            })
                            : data;
                        await this.components.practiceRecorder.savePracticeRecord(normalizedData);
                    } catch (recErr) {
                        console.warn('[DataCollection] PracticeRecorder 保存失败，改用降级存储:', recErr);
                        await this.saveRealPracticeData(examId, data, { savingAsFallback: true });
                    }
                } else {
                    // 直接保存真实数据（采用旧版本的简单方式）
                    await this.saveRealPracticeData(examId, data, { savingAsFallback: true });
                }

                // 刷新内存中的练习记录，确保无需手动刷新即可看到
                try {
                    if (typeof window.syncPracticeRecords === 'function') {
                        window.syncPracticeRecords();
                    } else if (window.storage) {
                        const latest = await window.storage.get('practice_records', []);
                        this.setState('practice.records', Array.isArray(latest) ? latest : []);
                    }
                } catch (syncErr) {
                    console.warn('[DataCollection] 刷新练习记录失败（UI可能需要手动刷新）:', syncErr);
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
                this.showRealCompletionNotification(examId, data);

                // 检查成就
                if (window.AchievementManager) {
                    window.AchievementManager.check(data?.realData).catch(console.warn);
                }

                // 刷新练习记录显示
                if (typeof updatePracticeView === 'function') {
                    updatePracticeView();
                }

            } catch (error) {
                console.error('[DataCollection] 处理练习完成数据失败:', error);
                // 即使出错也要显示通知
                window.showMessage('练习已完成，但数据保存可能有问题', 'warning');
            } finally {
                // 清理会话
                this.cleanupExamSession(examId);
            }
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

            const errorLogs = await storage.get('collection_errors', []);
            errorLogs.push(errorInfo);
            if (errorLogs.length > 50) {
                errorLogs.splice(0, errorLogs.length - 50);
            }
            await storage.set('collection_errors', errorLogs);

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
         * 保存真实练习数据（采用旧版本的简单直接方式）
         */
        async saveRealPracticeData(examId, realData, options = {}) {
            try {
                const normalizeKey = (rawKey) => {
                    if (rawKey == null) return null;
                    const s = String(rawKey).trim();
                    if (!s) return null;
                    const range = s.match(/^q?(\d+)\s*-\s*(\d+)$/i);
                    if (range) return `q${range[1]}-${range[2]}`;
                    if (/^q\d+$/i.test(s)) return s.toLowerCase();
                    if (/^\d+$/.test(s)) return `q${s}`;
                    return s;
                };

                const normalizeValue = (value) => {
                    if (value == null) return '';
                    if (typeof value === 'boolean') {
                        return value ? 'True' : 'False';
                    }
                    if (Array.isArray(value)) {
                        const tokens = value
                            .map(v => String(v).trim())
                            .filter(Boolean)
                            .map(v => v.toUpperCase());
                        return Array.from(new Set(tokens)).sort().join(', ');
                    }
                    if (typeof value === 'object') {
                        if (value.answer != null) return normalizeValue(value.answer);
                        if (value.value != null) return normalizeValue(value.value);
                        try {
                            const json = JSON.stringify(value);
                            return json === '{}' || json === '[]' ? '' : json;
                        } catch (_) {
                            return '';
                        }
                    }
                    return String(value).trim();
                };

                const normalizeAnswerMap = (raw) => {
                    const map = {};
                    if (!raw) return map;
                    if (Array.isArray(raw)) {
                        raw.forEach((entry, idx) => {
                            if (!entry) return;
                            const k = normalizeKey(entry.questionId || `q${idx + 1}`);
                            const v = normalizeValue(entry.answer ?? entry.userAnswer ?? entry.value ?? entry);
                            if (k) map[k] = v;
                        });
                        return map;
                    }
                    Object.entries(raw).forEach(([rk, rv]) => {
                        const k = normalizeKey(rk);
                        const v = normalizeValue(rv && typeof rv === 'object' && 'answer' in rv ? rv.answer : rv);
                        if (k) map[k] = v;
                    });
                    return map;
                };

                const normalizedAnswers = normalizeAnswerMap(realData?.answers);
                const normalizedCorrectMap = normalizeAnswerMap(realData?.correctAnswers);

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
                    console.error('[DataCollection] 无法找到题目信息:', examId);
                    return;
                }

                // 构造练习记录（与旧版本完全相同的格式）
                const practiceRecord = {
                    id: Date.now(),
                    examId: examId,
                    title: exam.title,
                    category: exam.category,
                    frequency: exam.frequency,

                    // 真实数据
                    realData: {
                        score: realData.scoreInfo?.correct || 0,
                        totalQuestions: realData.scoreInfo?.total || 0,
                        accuracy: realData.scoreInfo?.accuracy || 0,
                        percentage: realData.scoreInfo?.percentage || 0,
                        duration: realData.duration,
                        answers: normalizedAnswers,
                        correctAnswers: normalizedCorrectMap,
                        answerHistory: realData.answerHistory,
                        interactions: realData.interactions,
                        isRealData: true,
                        source: realData.scoreInfo?.source || 'unknown'
                    },

                    // 数据来源标识
                    dataSource: 'real',

                    date: new Date().toISOString(),
                    sessionId: realData.sessionId,
                    timestamp: Date.now()
                };

                // 兼容旧视图字段（便于总览系统统计与详情展示）
                try {
                    const sInfo = realData && realData.scoreInfo ? realData.scoreInfo : {};
                    const correct = typeof sInfo?.correct === 'number' ? sInfo.correct : 0;
                    const total = typeof sInfo?.total === 'number' ? sInfo.total : (practiceRecord.realData?.totalQuestions || Object.keys(realData.answers || {}).length || 0);
                    const acc = typeof sInfo?.accuracy === 'number' ? sInfo.accuracy : (total > 0 ? correct / total : 0);
                    const pct = typeof sInfo?.percentage === 'number' ? sInfo.percentage : Math.round(acc * 100);

                    practiceRecord.score = correct;
                    practiceRecord.correctAnswers = correct; // 兼容练习记录视图所需字段
                    practiceRecord.totalQuestions = total;
                    practiceRecord.accuracy = acc;
                    practiceRecord.percentage = pct;
                    practiceRecord.answers = normalizedAnswers;
                    practiceRecord.startTime = new Date((realData.startTime ?? (Date.now() - (realData.duration || 0) * 1000))).toISOString();
                    practiceRecord.endTime = new Date((realData.endTime ?? Date.now())).toISOString();

                    // 填充详情，便于在练习记录详情中显示正确答案
                    const comp = realData && realData.answerComparison ? realData.answerComparison : {};
                    const details = {};
                    Object.entries(comp).forEach(([qid, obj]) => {
                        details[qid] = {
                            userAnswer: obj && obj.userAnswer != null ? obj.userAnswer : '',
                            correctAnswer: obj && obj.correctAnswer != null ? obj.correctAnswer : '',
                            isCorrect: !!(obj && obj.isCorrect)
                        };
                    });
                    // 将详情放入 realData.scoreInfo，便于历史详情与Markdown导出读取
                    if (!practiceRecord.realData) practiceRecord.realData = {};
                    practiceRecord.realData.scoreInfo = {
                        correct: correct,
                        total: total,
                        accuracy: acc,
                        percentage: pct,
                        details: details
                    };

                    // 同时保留顶层一致性（仅用于展示，不作为详情读取来源）
                    practiceRecord.scoreInfo = {
                        correct: correct,
                        total: total,
                        accuracy: acc,
                        percentage: pct,
                        details: details
                    };

                    // 将比较结构提升到顶层，便于兼容读取
                    practiceRecord.answerComparison = comp;
                } catch (compatErr) {
                    console.warn('[DataCollection] 兼容字段填充失败:', compatErr);
                }

                // 直接保存到localStorage（与旧版本完全相同的方式）
                let practiceRecords = await storage.get('practice_records', []);
                if (!Array.isArray(practiceRecords)) {
                    // 迁移修复：历史上可能被错误压缩为对象，这里强制纠正为数组
                    practiceRecords = [];
                }

                practiceRecords.unshift(practiceRecord);

                // 限制记录数量
                if (practiceRecords.length > MAX_LEGACY_PRACTICE_RECORDS) {
                    practiceRecords.splice(MAX_LEGACY_PRACTICE_RECORDS);
                }

                let saveResult = null;
                if (window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.savePracticeRecord === 'function') {
                    saveResult = await window.PracticeCore.store.savePracticeRecord(practiceRecord);
                } else if (window.simpleStorageWrapper && typeof window.simpleStorageWrapper.addPracticeRecord === 'function') {
                    saveResult = await window.simpleStorageWrapper.addPracticeRecord(practiceRecord);
                } else {
                    const practiceKey = ['practice', 'records'].join('_');
                    saveResult = await storage.set(practiceKey, practiceRecords);
                }

                // 立即验证保存是否成功
                const verifyRecords = window.PracticeCore && window.PracticeCore.store && typeof window.PracticeCore.store.listPracticeRecords === 'function'
                    ? await window.PracticeCore.store.listPracticeRecords()
                    : await storage.get('practice_records', []);
                const savedRecord = Array.isArray(verifyRecords)
                    ? verifyRecords.find(r => r.id === practiceRecord.id)
                    : undefined;

                if (savedRecord) {
                } else {
                    console.error('[DataCollection] ✗ 保存验证失败，记录未找到');
                }

            } catch (error) {
                console.error('[DataCollection] 保存真实数据失败:', error);
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
                const duration = Math.round(realData.duration / 60); // 转换为分钟

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
                const duration = Math.round(realData.duration / 60);
                window.showMessage(`练习完成！\n${exam.title}\n用时: ${duration} 分钟`, 'success');
            }
        },

        /**
         * 处理题目窗口关闭
         */
        handleExamWindowClosed(examId) {

            if (this.suiteExamMap && this.suiteExamMap.has(examId) && this.currentSuiteSession && this.currentSuiteSession.status === 'active' && this.suiteExamMap.get(examId) === this.currentSuiteSession.id) {
                window.showMessage && window.showMessage('套题练习窗口已关闭，套题模式将被中断并回退到普通模式。', 'warning');
                if (typeof this._abortSuiteSession === 'function') {
                    this._abortSuiteSession(this.currentSuiteSession, {}).catch(error => {
                        console.error('[SuitePractice] 中断套题失败:', error);
                    });
                }
            }

            // 更新题目状态
            this.updateExamStatus(examId, 'interrupted');

            // 清理会话
            this.cleanupExamSession(examId);
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
        async cleanupExamSession(examId) {
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
            const activeSessions = await storage.get('active_sessions', []);
            const updatedSessions = activeSessions.filter(session => session.examId !== examId);
            await storage.set('active_sessions', updatedSessions);
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
            const activeSessions = await storage.get('active_sessions', []);
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
            const activeSessions = await storage.get('active_sessions', []);

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
