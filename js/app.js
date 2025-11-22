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
    const startApp = () => {
        try {
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
