(function(global) {
    const MAX_LEGACY_PRACTICE_RECORDS = 1000;
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');

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
            } catch (_) {}
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
            } catch (_) {}
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

            if (!exam) {
                window.showMessage('题目不存在', 'error');
                return;
            }

            try {
                // 若无HTML，直接打开PDF
                if (exam.hasHtml === false) {
                    const pdfUrl = (typeof window.buildResourcePath === 'function')
                        ? window.buildResourcePath(exam, 'pdf')
                        : ((exam.path || '').replace(/\\/g,'/').replace(/\/+\//g,'/') + (exam.pdfFilename || '') );
                    const resolvedPdfUrl = this._ensureAbsoluteUrl(pdfUrl);
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
                            } catch (_) {}
                        } else {
                            try {
                                pdfWin = window.open(resolvedPdfUrl, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
                            } catch (_) {}
                        }
                    }

                    if (!pdfWin) {
                        try {
                            window.location.href = resolvedPdfUrl;
                            return window;
                        } catch (e) {
                            throw new Error('无法打开PDF窗口，请检查弹窗设置');
                        }
                    }

                    window.showMessage(`正在打开PDF: ${exam.title}`, 'info');
                    return pdfWin;
                }

                // 先构造URL并立即打开窗口（保持用户手势，避免被浏览器拦截）
                const examUrl = this.buildExamUrl(exam);
                const guardOptions = { ...options, examId };
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
                await this.startPracticeSession(examId);
                this.injectDataCollectionScript(examWindow, examId);
                this.setupExamWindowManagement(examWindow, examId, exam, options);

                if (options && options.suiteSessionId) {
                    const sessionInfo = this.ensureExamWindowSession(examId, examWindow);
                    sessionInfo.suiteSessionId = options.suiteSessionId;
                    this.examWindows && this.examWindows.set(examId, sessionInfo);
                }

                window.showMessage(`正在打开题目: ${exam.title}`, 'info');

                return examWindow;

            } catch (error) {
                console.error('Failed to open exam:', error);
                window.showMessage('打开题目失败，请重试', 'error');
            }
        },

        /**
         * 构造题目URL
         */
        buildExamUrl(exam) {
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
                } catch (_) {}

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
            } catch (_) {}

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

            const isTestMode = this._shouldUsePlaceholderPage();
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
        injectDataCollectionScript(examWindow, examId) {

            // 新增修复3E：修复await语法错误 - 将内部injectScript改为async
            const injectScript = async () => {
                try {
                    // 检查窗口是否仍然存在
                    if (examWindow.closed) {
                        console.warn('[DataInjection] 窗口已关闭');
                        return;
                    }

                    // 尝试访问文档，处理跨域情况
                    let doc;
                    try {
                        doc = examWindow.document;
                        if (!doc) {
                            console.warn('[DataInjection] 无法访问窗口文档');
                            return;
                        }
                    } catch (e) {
                        console.warn('[DataInjection] 跨域限制，无法注入脚本');
                        // 对于跨域情况，只能等待页面主动通信
                        return;
                    }

                    // 检查是否已经注入过脚本
                    if (examWindow.practiceDataCollector) {
                        this.initializePracticeSession(examWindow, examId);
                        return;
                    }


                    // 加载练习页面增强脚本
                    const enhancerScript = await fetch('./js/practice-page-enhancer.js').then(r => r.text());

                    // 注入练习页面增强脚本
                    const enhancerScriptEl = doc.createElement('script');
                    enhancerScriptEl.type = 'text/javascript';
                    enhancerScriptEl.textContent = enhancerScript;
                    doc.head.appendChild(enhancerScriptEl);


                    // 等待脚本初始化完成后发送会话信息
                    setTimeout(() => {
                        this.initializePracticeSession(examWindow, examId);
                    }, 1500); // 增加等待时间确保脚本完全初始化

                } catch (error) {
                    console.error('[DataInjection] 脚本注入失败:', error);
                    // 降级到内联脚本注入
                    this.injectInlineScript(examWindow, examId);
                }
            };

            // 更可靠的页面加载检测
            const checkAndInject = async () => {
                try {
                    if (examWindow.closed) return;

                    const doc = examWindow.document;
                    if (doc && (doc.readyState === 'complete' || doc.readyState === 'interactive')) {
                        await injectScript();
                    } else {
                        // 继续等待
                        setTimeout(checkAndInject, 200);
                    }
                } catch (e) {
                    // 跨域情况，无法注入脚本
                }
            };

            // 开始检测，给页面一些加载时间
            setTimeout(checkAndInject, 500);
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
                const sessionId = `${examId}_${Date.now()}`;
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

                const initPayload = {
                    sessionId: sessionId,
                    examId: examId,
                    parentOrigin: window.location.origin,
                    timestamp: now,
                    suiteSessionId: suiteSessionId || null
                };

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
                    existingInfo.sessionId = sessionId;
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
                    this.examWindows.set(examId, {
                        window: examWindow,
                        sessionId: sessionId,
                        initTime: now,
                        status: 'initialized',
                        suiteSessionId: suiteSessionId || null
                    });
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
                suiteSessionId: (options && options.suiteSessionId) ? options.suiteSessionId : null
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
                const suiteSessionId = typeof this._resolveSuiteSessionId === 'function'
                    ? this._resolveSuiteSessionId(examId, windowInfo)
                    : null;
                const initPayload = {
                    examId: examId,
                    parentOrigin: window.location.origin,
                    sessionId: windowInfo.expectedSessionId,
                    suiteSessionId: suiteSessionId
                };
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
            this.updateExamStatus(examId, 'in-progress');
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

                const typeAliases = {
                    'practice_complete': 'PRACTICE_COMPLETE',
                    'practice_completed': 'PRACTICE_COMPLETE',
                    'PracticeComplete': 'PRACTICE_COMPLETE',
                    'SESSION_COMPLETE': 'PRACTICE_COMPLETE',
                    'session_complete': 'PRACTICE_COMPLETE',
                    'session_completed': 'PRACTICE_COMPLETE',
                    'SESSION_READY': 'SESSION_READY',
                    'session_ready': 'SESSION_READY',
                    'EXAM_COMPLETED': 'exam_completed',
                    'EXAM_PROGRESS': 'exam_progress',
                    'EXAM_ERROR': 'exam_error',
                    'progress_update': 'PROGRESS_UPDATE',
                    'SESSION_PROGRESS': 'PROGRESS_UPDATE',
                    'session_progress': 'PROGRESS_UPDATE',
                    'practice_progress': 'PROGRESS_UPDATE',
                    'SESSION_ERROR': 'ERROR_OCCURRED',
                    'session_error': 'ERROR_OCCURRED',
                    'practice_error': 'ERROR_OCCURRED',
                    'REQUEST_INIT': 'REQUEST_INIT',
                    'request_init': 'REQUEST_INIT',
                    'REQUEST_SESSION_INIT': 'REQUEST_INIT'
                };

                const allowedTypes = new Set([
                    'exam_completed',
                    'exam_progress',
                    'exam_error',
                    'SESSION_READY',
                    'PROGRESS_UPDATE',
                    'PRACTICE_COMPLETE',
                    'ERROR_OCCURRED',
                    'REQUEST_INIT'
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
                    const normalized = rawType.trim();
                    if (!normalized) return '';
                    return typeAliases[normalized] || normalized;
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

            const messageHandler = async (event) => {
                // 取得当前题目窗口引用（可能在 handshake 期间被更新）
                const storedInfo = (this.examWindows && this.examWindows.get(examId)) || {};
                const expectedWindow = storedInfo.window || examWindow;

                // 窗口来源不匹配直接拒绝，阻止其它 tab 注入消息
                if (!event.source || !expectedWindow || event.source !== expectedWindow) {
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
                const expectedSessionId = windowInfo.expectedSessionId || '';

                // 放宽消息源过滤，兼容 inline_collector 与 practice_page
                const src = normalized.sourceTag || '';
                const allowedSources = new Set(['practice_page', 'inline_collector', 'suite_placeholder']);
                if (src && !allowedSources.has(src)) {
                    return; // 非预期来源的消息忽略
                }

                const { type, data } = normalized;
                const payloadSessionId = data && typeof data.sessionId === 'string'
                    ? data.sessionId.trim()
                    : '';

                if (payloadSessionId) {
                    if (expectedSessionId && payloadSessionId !== expectedSessionId) {
                        return;
                    }
                    windowInfo.sessionId = payloadSessionId;
                    if (!windowInfo.expectedSessionId) {
                        windowInfo.expectedSessionId = payloadSessionId;
                    }
                } else if (type === 'PRACTICE_COMPLETE') {
                    if (!expectedSessionId) {
                        return;
                    }
                    data.sessionId = expectedSessionId;
                }

                const expectedExamId = String(examId);
                const payloadExamId = data && data.examId != null ? String(data.examId) : '';
                if (payloadExamId && payloadExamId !== expectedExamId) {
                    const derivedExamId = (payloadSessionId || expectedSessionId || '').split('_')[0];
                    const allowedLegacy = payloadExamId === 'session';
                    if (derivedExamId !== expectedExamId && !allowedLegacy) {
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
                        break;
                    case 'PROGRESS_UPDATE':
                        this.handleProgressUpdate(examId, data);
                        break;
                    case 'PRACTICE_COMPLETE':
                        if (data && data.suiteSessionId && windowInfo) {
                            windowInfo.suiteSessionId = data.suiteSessionId;
                            this.examWindows && this.examWindows.set(examId, windowInfo);
                        }
                        await this.handlePracticeComplete(examId, data);
                        break;
                    case 'ERROR_OCCURRED':
                        this.handleDataCollectionError(examId, data);
                        break;
                    case 'REQUEST_INIT':
                        sendInitEnvelope(event.source || examWindow);
                        break;
                    case 'SUITE_CLOSE_ATTEMPT':
                        console.warn('[SuitePractice] 练习页尝试关闭套题窗口:', data);
                        break;
                    default:
                }
            };

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
                    const suiteSessionId = typeof this._resolveSuiteSessionId === 'function'
                        ? this._resolveSuiteSessionId(examId, windowInfo)
                        : null;
                    const initPayload = {
                        examId: examId,
                        parentOrigin: window.location.origin,
                        sessionId: windowInfo.expectedSessionId,
                        suiteSessionId: suiteSessionId
                    };
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
            const suiteSessionId = typeof this._resolveSuiteSessionId === 'function'
                ? this._resolveSuiteSessionId(examId, windowInfo)
                : null;
            const initPayload = {
                examId,
                parentOrigin: window.location.origin,
                sessionId: windowInfo.expectedSessionId,
                suiteSessionId
            };

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

                        // 直接保存到localStorage
                        const records = await storage.get('practice_records', []);
                        records.unshift(practiceRecord);


                        await storage.set('practice_records', records);

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
                    origin: (typeof window !== 'undefined' && window.location) ? window.location.origin : ''
                });
            }

            const windowInfo = this.examWindows.get(examId);

            if (examWindow && (!windowInfo.window || windowInfo.window.closed || windowInfo.window !== examWindow)) {
                windowInfo.window = examWindow;
            }

            if (!windowInfo.expectedSessionId) {
                windowInfo.expectedSessionId = this.generateSessionId(examId);
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

            if (this.components
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
            } catch (_) {}

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
        async handlePracticeComplete(examId, data) {
            if (data && !data.sessionId) {
                data.sessionId = `${examId}_${Date.now()}`;
            }

            if (this.suiteExamMap && this.suiteExamMap.has(examId) && typeof this.handleSuitePracticeComplete === 'function') {
                try {
                    const handled = await this.handleSuitePracticeComplete(examId, data);
                    if (handled) {
                        return;
                    }
                } catch (suiteError) {
                    console.error('[SuitePractice] 处理套题结果失败，回退至普通流程:', suiteError);
                    window.showMessage && window.showMessage('套题模式出现异常，记录将以单篇形式保存。', 'warning');
                }
            }

            const recorderAvailable = this.components
                && this.components.practiceRecorder
                && typeof this.components.practiceRecorder.savePracticeRecord === 'function';

            try {
                if (recorderAvailable) {
                    try {
                        await this.components.practiceRecorder.savePracticeRecord(examId, data);
                    } catch (recErr) {
                        console.warn('[DataCollection] PracticeRecorder 保存失败，改用降级存储:', recErr);
                        await this.saveRealPracticeData(examId, data);
                    }
                } else {
                    // 直接保存真实数据（采用旧版本的简单方式）
                    await this.saveRealPracticeData(examId, data);
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

                // 更新UI状态
                this.updateExamStatus(examId, 'completed');

                // 显示完成通知（使用真实数据）
                this.showRealCompletionNotification(examId, data);

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

                const saveResult = await storage.set('practice_records', practiceRecords);

                // 立即验证保存是否成功
                const verifyRecords = await storage.get('practice_records', []);
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
                    this._abortSuiteSession(this.currentSuiteSession, { skipExamId: examId }).catch(error => {
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
