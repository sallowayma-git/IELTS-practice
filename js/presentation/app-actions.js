(function initAppActions(global) {
    'use strict';

    var prefetchTriggered = false;
    var attachedPrefetchHandlers = false;
    var browsePrefetchTriggered = false;
    var morePrefetchTriggered = false;

    function ensurePracticeSuite() {
        if (!global.AppLazyLoader || typeof global.AppLazyLoader.ensureGroup !== 'function') {
            return Promise.resolve();
        }
        return global.AppLazyLoader.ensureGroup('practice-suite');
    }

    function exportPracticeMarkdown() {
        ensurePracticeSuite().then(function handleExportReady() {
            if (!global.markdownExporter || typeof global.markdownExporter.exportToMarkdown !== 'function') {
                if (typeof global.MarkdownExporter === 'function') {
                    try {
                        global.markdownExporter = new global.MarkdownExporter();
                    } catch (error) {
                        console.error('[AppActions] 初始化 MarkdownExporter 失败:', error);
                    }
                }
            }

            if (global.markdownExporter && typeof global.markdownExporter.exportToMarkdown === 'function') {
                global.markdownExporter.exportToMarkdown();
                return;
            }

            if (typeof global.showMessage === 'function') {
                global.showMessage('Markdown 导出模块未就绪', 'warning');
            }
        }).catch(function handleExportError(error) {
            console.error('[AppActions] 导出失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('导出失败，请稍后重试', 'error');
            }
        });
    }

    function triggerPrefetch() {
        if (prefetchTriggered) {
            return;
        }
        prefetchTriggered = true;
        ensurePracticeSuite().catch(function swallow(error) {
            console.warn('[AppActions] 练习模块预加载失败:', error);
        });
    }

    function triggerBrowsePrefetch() {
        if (browsePrefetchTriggered) {
            return;
        }
        browsePrefetchTriggered = true;
        if (global.AppLazyLoader && typeof global.AppLazyLoader.ensureGroup === 'function') {
            global.AppLazyLoader.ensureGroup('browse-view').catch(function swallow(error) {
                console.warn('[AppActions] 浏览模块预加载失败:', error);
            });
        }
    }

    function triggerMorePrefetch() {
        if (morePrefetchTriggered) {
            return;
        }
        morePrefetchTriggered = true;
        if (global.AppLazyLoader && typeof global.AppLazyLoader.ensureGroup === 'function') {
            global.AppLazyLoader.ensureGroup('more-tools').catch(function swallow(error) {
                console.warn('[AppActions] 更多工具预加载失败:', error);
            });
        }
    }

    function attachPrefetchTriggers() {
        if (attachedPrefetchHandlers) {
            return;
        }
        attachedPrefetchHandlers = true;

        var practiceButton = document.querySelector('.main-nav [data-view="practice"]');
        if (practiceButton) {
            ['pointerenter', 'focus'].forEach(function bind(eventName) {
                practiceButton.addEventListener(eventName, triggerPrefetch, { once: true });
            });
        }

        var browseButton = document.querySelector('.main-nav [data-view="browse"]');
        if (browseButton) {
            ['pointerenter', 'focus'].forEach(function bind(eventName) {
                browseButton.addEventListener(eventName, triggerBrowsePrefetch, { once: true });
            });
        }

        var moreButton = document.querySelector('.main-nav [data-view="more"]');
        if (moreButton) {
            ['pointerenter', 'focus'].forEach(function bind(eventName) {
                moreButton.addEventListener(eventName, triggerMorePrefetch, { once: true });
            });
        }

        if (typeof window !== 'undefined') {
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(triggerPrefetch, { timeout: 4500 });
            } else {
                setTimeout(triggerPrefetch, 3500);
            }
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        attachPrefetchTriggers();
    } else {
        document.addEventListener('DOMContentLoaded', attachPrefetchTriggers);
    }

    global.AppActions = Object.assign({}, global.AppActions, {
        exportPracticeMarkdown: exportPracticeMarkdown,
        ensurePracticeSuite: ensurePracticeSuite,
        preloadPracticeSuite: triggerPrefetch,
        preloadBrowseView: triggerBrowsePrefetch,
        preloadMoreTools: triggerMorePrefetch
    });
})(typeof window !== 'undefined' ? window : this);
