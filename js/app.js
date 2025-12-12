/**
 * 主应用程序
 * 负责应用的初始化和整体协调
 */

class ExamSystemApp {
    constructor() {
        this.currentView = 'overview';
        this.components = {};
        this.isInitialized = false;

        // 统一状态管理 - 替代全局变量
        this.state = {
            // 考试相关状态
            exam: {
                index: [],
                currentCategory: 'all',
                currentExamType: 'all',
                filteredExams: [],
                configurations: {},
                activeConfigKey: 'exam_index'
            },

            // 练习相关状态
            practice: {
                records: [],
                selectedRecords: new Set(),
                bulkDeleteMode: false,
                dataCollector: null
            },

            // UI状态
            ui: {
                browseFilter: { category: 'all', type: 'all' },
                pendingBrowseFilter: null,
                legacyBrowseType: 'all',
                currentVirtualScroller: null,
                loading: false,
                loadingMessage: ''
            },

            // 组件实例
            components: {
                dataIntegrityManager: null,
                pdfHandler: null,
                browseStateManager: null,
                practiceListScroller: null
            },

            // 系统状态
            system: {
                processedSessions: new Set(),
                fallbackExamSessions: new Map(),
                failedScripts: new Set()
            }
        };

        // 绑定方法上下文
        this.handleResize = this.handleResize.bind(this);
    }

}

(function(global) {
    function applyMixins() {
        const mixins = global.ExamSystemAppMixins || {};
        Object.assign(ExamSystemApp.prototype,
            mixins.state || {},
            mixins.bootstrap || {},
            mixins.lifecycle || {},
            mixins.navigation || {},
            mixins.examSession || {},
            mixins.suitePractice || {},
            mixins.fallback || {});
    }

    applyMixins();

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.__applyToApp = applyMixins;
})(typeof window !== "undefined" ? window : globalThis);


// 新增修复3E：在js/app.js的DOMContentLoaded初始化中去除顶层await
// 应用启动
document.addEventListener('DOMContentLoaded', () => {
    const ensureExamSessionMixinLoaded = () => new Promise((resolve) => {
        if (window.ExamSystemAppMixins && window.ExamSystemAppMixins.examSession) {
            resolve(true);
            return;
        }

        const installFallback = () => {
            const ensureAbsoluteUrl = (rawUrl) => {
                if (!rawUrl) return rawUrl;
                try {
                    if (typeof rawUrl === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawUrl)) {
                        return rawUrl;
                    }
                    if (typeof window !== 'undefined' && window.location) {
                        return new URL(rawUrl, window.location.href).href;
                    }
                    return new URL(rawUrl, 'http://localhost/').href;
                } catch (_) {
                    return rawUrl;
                }
            };

            const buildPlaceholder = (exam = {}, options = {}) => {
                const params = new URLSearchParams();
                if (exam.id) params.set('examId', exam.id);
                if (exam.title) params.set('title', exam.title);
                if (exam.category) params.set('category', exam.category);
                if (options.suiteSessionId) params.set('suiteSessionId', options.suiteSessionId);
                if (Number.isFinite(options.sequenceIndex)) params.set('index', String(options.sequenceIndex));
                const query = params.toString();
                return ensureAbsoluteUrl(query ? `templates/exam-placeholder.html?${query}` : 'templates/exam-placeholder.html');
            };

            window.ExamSystemAppMixins = window.ExamSystemAppMixins || {};
            window.ExamSystemAppMixins.examSession = {
                startSessionMonitoring() {},
                _ensureAbsoluteUrl: ensureAbsoluteUrl,
                _buildExamPlaceholderUrl: buildPlaceholder,
                _shouldUsePlaceholderPage() {
                    try {
                        if (window.EnvironmentDetector && typeof window.EnvironmentDetector.isInTestEnvironment === 'function') {
                            return window.EnvironmentDetector.isInTestEnvironment();
                        }
                    } catch (_) {}
                    return false;
                },
                _guardExamWindowContent(examWindow, exam = null, options = {}) {
                    if (!examWindow || examWindow.closed) return examWindow;
                    const placeholderUrl = buildPlaceholder(exam || {}, options || {});
                    try {
                        if (examWindow.location && typeof examWindow.location.replace === 'function') {
                            examWindow.location.replace(placeholderUrl);
                        } else {
                            examWindow.location.href = placeholderUrl;
                        }
                    } catch (_) {}
                    return examWindow;
                },
                async openExam(examId, options = {}) {
                    const placeholderUrl = buildPlaceholder({ id: examId }, options || {});
                    const targetName = options && options.target === 'tab'
                        ? (options.windowName || 'ielts-suite-mode-tab')
                        : '_blank';
                    let win = null;
                    try { win = window.open(placeholderUrl, targetName); } catch (_) {}
                    if (!win) {
                        try { window.location.href = placeholderUrl; return window; } catch (_) {}
                    }
                    return win;
                }
            };
        };

        try {
            const script = document.createElement('script');
            script.src = 'js/app/examSessionMixin.js';
            script.async = false;
            script.onload = () => {
                if (!window.ExamSystemAppMixins || !window.ExamSystemAppMixins.examSession) {
                    installFallback();
                }
                resolve(true);
            };
            script.onerror = () => {
                installFallback();
                resolve(false);
            };
            (document.head || document.body || document.documentElement).appendChild(script);
        } catch (error) {
            console.warn('[App] 无法动态加载 examSessionMixin:', error);
            installFallback();
            resolve(false);
        }
    });

    const startApp = async () => {
        try {
            await ensureExamSessionMixinLoaded();
            const mixinGlue = window.ExamSystemAppMixins && window.ExamSystemAppMixins.__applyToApp;
            if (typeof mixinGlue === 'function') {
                mixinGlue();
            }
            (function(){ try { window.app = new ExamSystemApp(); window.app.initialize(); } catch(e) { console.error('[App] 初始化失败:', e); } })();
        } catch (error) {
            console.error('Failed to start application:', error);
            if (window.handleError) {
                window.handleError(error, 'Application Startup');
            } else {
                // Fallback: non-blocking user message if error handler is unavailable
                try {
                    const container = document.getElementById('message-container');
                    if (container) {
                        const msg = document.createElement('div');
                        msg.className = 'message error';
                        msg.textContent = '系统启动失败，请检查控制台日志。';
                        container.appendChild(msg);
                    }
                } catch (_) {
                    // no-op
                }
            }
        }
    };

    const awaitBrowse = window.AppEntry && typeof window.AppEntry.browseReady === 'function'
        ? window.AppEntry.browseReady()
        : null;

    if (awaitBrowse && typeof awaitBrowse.then === 'function') {
        awaitBrowse.then(() => startApp()).catch(() => startApp());
    } else {
        startApp();
    }
});

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
    if (window.app) {
        window.app.destroy();
    }
});
