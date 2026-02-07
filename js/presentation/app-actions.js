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
            global.AppLazyLoader.ensureGroup('browse-runtime').catch(function swallow(error) {
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

    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        attachPrefetchTriggers();
    } else {
        document.addEventListener('DOMContentLoaded', attachPrefetchTriggers);
    }

    // ============================================================================
    // Phase 3: 套题/随机练习/导出功能
    // ============================================================================

    function startSuitePractice() {
        var ensureSuiteReady = (global.AppEntry && typeof global.AppEntry.ensureSessionSuiteReady === 'function')
            ? global.AppEntry.ensureSessionSuiteReady()
            : ensurePracticeSuite();

        return Promise.resolve(ensureSuiteReady).then(function afterReady() {
            var appInstance = global.app;
            if (appInstance && typeof appInstance.startSuitePractice === 'function') {
                try {
                    return appInstance.startSuitePractice();
                } catch (error) {
                    console.error('[AppActions] 套题模式启动失败', error);
                    if (typeof global.showMessage === 'function') {
                        global.showMessage('套题模式启动失败，请稍后重试', 'error');
                    }
                    return undefined;
                }
            }

            var fallbackNotice = '套题模式尚未初始化，请完成加载后再试。';
            if (typeof global.showMessage === 'function') {
                global.showMessage(fallbackNotice, 'warning');
            } else if (typeof alert === 'function') {
                alert(fallbackNotice);
            }
            return undefined;
        }).catch(function handleSuiteError(error) {
            console.error('[AppActions] 套题模块加载失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('套题模块加载失败，请稍后重试', 'error');
            }
            return undefined;
        });
    }

    function openExamWithFallback(exam, delay) {
        var actualDelay = typeof delay === 'number' ? delay : 600;
        
        if (!exam) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('未找到可用题目', 'error');
            }
            return;
        }

        var launch = function () {
            try {
                if (exam.hasHtml && typeof global.openExam === 'function') {
                    global.openExam(exam.id);
                } else if (typeof global.viewPDF === 'function') {
                    global.viewPDF(exam.id);
                } else {
                    console.warn('[AppActions] openExam/viewPDF 未定义');
                }
            } catch (error) {
                console.error('[AppActions] 启动题目失败:', error);
                if (typeof global.showMessage === 'function') {
                    global.showMessage('无法打开题目，请检查题库路径', 'error');
                }
            }
        };

        if (actualDelay > 0) {
            setTimeout(launch, actualDelay);
        } else {
            launch();
        }
    }

    function startRandomPractice(category, type, filterMode, path) {
        var getExamIndexState = global.getExamIndexState || function () {
            return Array.isArray(global.examIndex) ? global.examIndex : [];
        };
        
        var list = getExamIndexState();
        var normalizedType = (!type || type === 'all') ? null : type;
        var normalizedPath = (typeof path === 'string' && path.trim()) ? path.trim() : null;

        var pool = Array.from(list);
        
        if (normalizedType) {
            pool = pool.filter(function (exam) { return exam.type === normalizedType; });
        }

        if (category && category !== 'all') {
            var filteredByCategory = pool.filter(function (exam) { return exam.category === category; });
            if (filteredByCategory.length > 0 || !normalizedPath) {
                pool = filteredByCategory;
            }
        }

        if (normalizedPath) {
            pool = pool.filter(function (exam) {
                return typeof exam?.path === 'string' && exam.path.includes(normalizedPath);
            });
        } else if (filterMode && global.BROWSE_MODES && global.BROWSE_MODES[filterMode]) {
            var modeConfig = global.BROWSE_MODES[filterMode];
            if (modeConfig?.basePath) {
                pool = pool.filter(function (exam) {
                    return typeof exam?.path === 'string' && exam.path.includes(modeConfig.basePath);
                });
            }
        }

        if (pool.length === 0) {
            if (typeof global.showMessage === 'function') {
                var typeLabel = normalizedType === 'listening'
                    ? '听力'
                    : (normalizedType === 'reading' ? '阅读' : '题库');
                global.showMessage(category + ' ' + typeLabel + ' 分类暂无可用题目', 'error');
            }
            return;
        }

        var randomExam = pool[Math.floor(Math.random() * pool.length)];
        if (typeof global.showMessage === 'function') {
            global.showMessage('随机选择: ' + randomExam.title, 'info');
        }

        openExamWithFallback(randomExam);
    }

    global.AppActions = Object.assign({}, global.AppActions, {
        exportPracticeMarkdown: exportPracticeMarkdown,
        ensurePracticeSuite: ensurePracticeSuite,
        preloadPracticeSuite: triggerPrefetch,
        preloadBrowseView: triggerBrowsePrefetch,
        preloadMoreTools: triggerMorePrefetch,
        // Phase 3
        startSuitePractice: startSuitePractice,
        openExamWithFallback: openExamWithFallback,
        startRandomPractice: startRandomPractice
    });

    // 挂载到全局（向后兼容）
    global.startSuitePractice = startSuitePractice;
    global.openExamWithFallback = openExamWithFallback;
    global.startRandomPractice = startRandomPractice;

})(typeof window !== 'undefined' ? window : this);
