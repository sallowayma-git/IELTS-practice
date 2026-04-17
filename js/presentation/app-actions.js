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
        function getSuitePreferenceUtils() {
            return global.SuitePreferenceUtils || null;
        }

        function resolveSuitePreference(overrides) {
            var suitePreferenceUtils = getSuitePreferenceUtils();
            if (suitePreferenceUtils && typeof suitePreferenceUtils.resolveSuitePreference === 'function') {
                return suitePreferenceUtils.resolveSuitePreference(overrides || {});
            }
            var flowMode = String(overrides && overrides.flowMode || '').trim().toLowerCase();
            if (flowMode !== 'classic' && flowMode !== 'simulation' && flowMode !== 'stationary') {
                flowMode = 'classic';
            }
            var frequencyScope = String(overrides && overrides.frequencyScope || '').trim().toLowerCase();
            if (frequencyScope !== 'high' && frequencyScope !== 'high_medium' && frequencyScope !== 'all' && frequencyScope !== 'custom') {
                frequencyScope = 'all';
            }
            return {
                flowMode: flowMode,
                frequencyScope: frequencyScope,
                autoAdvanceAfterSubmit: flowMode !== 'stationary'
            };
        }

        function persistSuitePreference(partial) {
            var suitePreferenceUtils = getSuitePreferenceUtils();
            if (suitePreferenceUtils && typeof suitePreferenceUtils.persistSuitePreference === 'function') {
                return suitePreferenceUtils.persistSuitePreference(partial || {});
            }
            return resolveSuitePreference(partial || {});
        }

        function persistSuiteFlowMode(mode) {
            var persisted = persistSuitePreference({ flowMode: mode });
            return persisted.flowMode || 'classic';
        }

        function persistSuiteFrequencyScope(scope) {
            var persisted = persistSuitePreference({ frequencyScope: scope });
            return persisted.frequencyScope || 'all';
        }

        function promptSuiteModeSelection() {
            return new Promise(function resolveSelection(resolve) {
                var preselectedPreference = resolveSuitePreference();
                var preselected = preselectedPreference.flowMode || 'classic';
                var preselectedScope = preselectedPreference.frequencyScope || 'all';
                var search = '';
                try {
                    search = String(global.location && global.location.search || '').toLowerCase();
                } catch (_) {
                    search = '';
                }
                var isTestEnv = search.indexOf('test_env=1') !== -1
                    || search.indexOf('suite_test=1') !== -1
                    || search.indexOf('ci=1') !== -1;
                if (isTestEnv) {
                    resolve({
                        flowMode: preselected,
                        frequencyScope: preselectedScope
                    });
                    return;
                }
                if (!global.document || !global.document.body) {
                    resolve({
                        flowMode: preselected,
                        frequencyScope: preselectedScope
                    });
                    return;
                }
                var host = global.document.getElementById('suite-mode-selector-modal');
                if (host && host.parentNode) {
                    host.parentNode.removeChild(host);
                }
                host = global.document.createElement('div');
                host.id = 'suite-mode-selector-modal';
                host.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;z-index:9999;';
                host.innerHTML = [
                    '<div role="dialog" aria-modal="true" style="width:min(420px,92vw);background:var(--color-white, #fff);border:1px solid var(--color-gray-200, #e2e8f0);border-radius:16px;padding:24px;box-shadow:var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.1));font-family:var(--font-family-primary, sans-serif);">',
                    '<h3 style="margin:0 0 8px;font-size:20px;font-weight:700;color:var(--color-gray-900, #0f172a);letter-spacing:-0.02em;">选择套题流程</h3>',
                    '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:var(--color-gray-600, #475569);">本次会话将锁定所选流程，答题中不再切换。</p>',
                    '<div style="display:flex;flex-direction:column;gap:10px;">',
                    '<button type="button" data-suite-flow-mode="simulation" style="padding:14px 16px;border:2px solid transparent;border-radius:12px;background:var(--color-gray-50, #f8fafc);color:var(--color-gray-800, #1e293b);font-weight:600;cursor:pointer;text-align:left;transition:all 0.2s ease;display:flex;flex-direction:column;gap:4px;">',
                    '<span style="font-size:15px;">模拟模式</span>',
                    '<span style="font-size:12px;font-weight:400;color:var(--color-gray-500, #64748b);">贴近官方机考</span>',
                    '</button>',
                    '<button type="button" data-suite-flow-mode="classic" style="padding:14px 16px;border:2px solid transparent;border-radius:12px;background:var(--color-gray-50, #f8fafc);color:var(--color-gray-800, #1e293b);font-weight:600;cursor:pointer;text-align:left;transition:all 0.2s ease;display:flex;flex-direction:column;gap:4px;">',
                    '<span style="font-size:15px;">经典模式</span>',
                    '<span style="font-size:12px;font-weight:400;color:var(--color-gray-500, #64748b);">自动跳转</span>',
                    '</button>',
                    '<button type="button" data-suite-flow-mode="stationary" style="padding:14px 16px;border:2px solid transparent;border-radius:12px;background:var(--color-gray-50, #f8fafc);color:var(--color-gray-800, #1e293b);font-weight:600;cursor:pointer;text-align:left;transition:all 0.2s ease;display:flex;flex-direction:column;gap:4px;">',
                    '<span style="font-size:15px;">驻足模式</span>',
                    '<span style="font-size:12px;font-weight:400;color:var(--color-gray-500, #64748b);">提交后停留回看</span>',
                    '</button>',
                    '</div>',
                    '<div style="margin-top:20px;">',
                    '<label for="suite-frequency-scope" style="display:block;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--color-gray-700, #334155);">抽题范围</label>',
                    '<div style="position:relative;">',
                    '<select id="suite-frequency-scope" style="width:100%;appearance:none;background:var(--color-white, #fff);padding:12px 36px 12px 14px;border:1px solid var(--color-gray-300, #cbd5e1);border-radius:10px;font-size:14px;color:var(--color-gray-900, #0f172a);cursor:pointer;outline:none;transition:border-color 0.2s ease;box-shadow:0 1px 2px rgba(0,0,0,0.05);">',
                    '<option value="high_medium">高频 + 次高频</option>',
                    '<option value="high">仅高频</option>',
                    '<option value="all">全部频率（默认）</option>',
                    '<option value="custom">自选套题（P1/P2/P3）</option>',
                    '</select>',
                    '<div style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--color-gray-500, #64748b);">',
                    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                    '</div>',
                    '</div>',
                    '</div>',
                    '<div style="margin-top:24px;display:flex;justify-content:flex-end;gap:12px;">',
                    '<button type="button" data-suite-flow-cancel="1" style="padding:10px 16px;border:1px solid var(--color-gray-200, #e2e8f0);border-radius:8px;background:var(--color-white, #fff);color:var(--color-gray-600, #475569);font-weight:500;font-size:14px;cursor:pointer;transition:all 0.2s ease;">取消</button>',
                    '</div>',
                    '</div>'
                ].join('');
                var markSelected = function markSelected(mode) {
                    Array.prototype.slice.call(host.querySelectorAll('button[data-suite-flow-mode]')).forEach(function each(btn) {
                        var isSelected = btn.getAttribute('data-suite-flow-mode') === mode;
                        if (isSelected) {
                            btn.style.borderColor = 'var(--color-brand-primary, #667eea)';
                            btn.style.background = 'rgba(102, 126, 234, 0.08)';
                            btn.style.boxShadow = '0 0 0 1px var(--color-brand-primary, #667eea)';
                            btn.style.outline = 'none';
                        } else {
                            btn.style.borderColor = 'transparent';
                            btn.style.background = 'var(--color-gray-50, #f8fafc)';
                            btn.style.boxShadow = 'none';
                            btn.style.outline = 'none';
                        }
                    });
                };
                markSelected(preselected);
                var scopeSelect = host.querySelector('#suite-frequency-scope');
                if (scopeSelect) {
                    scopeSelect.value = preselectedScope;
                }
                host.addEventListener('click', function onClick(event) {
                    var target = event.target && event.target.closest ? event.target.closest('button') : null;
                    if (!target) return;
                    var mode = target.getAttribute('data-suite-flow-mode');
                    if (mode) {
                        var normalized = persistSuiteFlowMode(mode);
                        var selectedScope = scopeSelect && scopeSelect.value
                            ? persistSuiteFrequencyScope(scopeSelect.value)
                            : persistSuiteFrequencyScope(preselectedScope);
                        if (host.parentNode) host.parentNode.removeChild(host);
                        resolve({
                            flowMode: normalized,
                            frequencyScope: selectedScope
                        });
                        return;
                    }
                    if (target.hasAttribute('data-suite-flow-cancel')) {
                        if (host.parentNode) host.parentNode.removeChild(host);
                        resolve(null);
                    }
                });
                global.document.body.appendChild(host);
            });
        }

        var ensureSuiteReady = (global.AppEntry && typeof global.AppEntry.ensureSessionSuiteReady === 'function')
            ? global.AppEntry.ensureSessionSuiteReady()
            : ensurePracticeSuite();

        return Promise.resolve(ensureSuiteReady).then(function afterReady() {
            return promptSuiteModeSelection().then(function handleMode(selection) {
                if (!selection || !selection.flowMode) {
                    return undefined;
                }
                var appInstance = global.app;
                if (appInstance && typeof appInstance.startSuitePractice === 'function') {
                    try {
                        return appInstance.startSuitePractice({
                            flowMode: selection.flowMode,
                            frequencyScope: selection.frequencyScope
                        });
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
            });
        }).catch(function handleSuiteError(error) {
            console.error('[AppActions] 套题模块加载失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('套题模块加载失败，请稍后重试', 'error');
            }
            return undefined;
        });
    }

    function continueSuitePractice() {
        var ensureSuiteReady = (global.AppEntry && typeof global.AppEntry.ensureSessionSuiteReady === 'function')
            ? global.AppEntry.ensureSessionSuiteReady()
            : ensurePracticeSuite();

        return Promise.resolve(ensureSuiteReady).then(function afterReady() {
            var appInstance = global.app;
            if (appInstance && typeof appInstance.continueSuitePractice === 'function') {
                return appInstance.continueSuitePractice();
            }
            if (typeof global.showMessage === 'function') {
                global.showMessage('当前没有可继续的套题会话。', 'warning');
            }
            return false;
        }).catch(function handleSuiteError(error) {
            console.error('[AppActions] 套题继续失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('套题继续失败，请稍后重试', 'error');
            }
            return false;
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

    // ============================================================================
    // Phase 4: 无尽模式
    // ============================================================================

    var endlessState = null;
    var ENDLESS_WINDOW_NAME = 'ielts-endless-mode-tab';
    var ENDLESS_COUNTDOWN_SEC = 5;

    function stopEndlessPractice(opts) {
        if (!endlessState) return;
        var silent = opts && opts.silent;
        endlessState.active = false;
        if (endlessState.countdownTimer) {
            clearInterval(endlessState.countdownTimer);
            endlessState.countdownTimer = null;
        }
        if (endlessState.messageHandler) {
            window.removeEventListener('message', endlessState.messageHandler);
            endlessState.messageHandler = null;
        }
        endlessState = null;
        if (!silent && typeof global.showMessage === 'function') {
            global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\u5df2\u9000\u51fa', 'info');
        }
    }

    function pickRandomExam() {
        var getExamIndexState = global.getExamIndexState || function () {
            return Array.isArray(global.examIndex) ? global.examIndex : [];
        };
        var list = getExamIndexState().filter(function (e) {
            return e && e.hasHtml && e.type === 'reading';
        });
        if (!list.length) return null;
        return list[Math.floor(Math.random() * list.length)];
    }

    function openEndlessExam(exam, reuseWindow) {
        if (!exam) return null;
        var url = null;
        try {
            if (global.app && typeof global.app.buildExamUrl === 'function') {
                url = global.app.buildExamUrl(exam);
            } else if (typeof global.buildResourcePath === 'function') {
                url = global.buildResourcePath(exam, 'html');
            } else {
                var p = exam.path || '';
                if (!p.endsWith('/')) p += '/';
                url = p + exam.filename;
            }
            // resolve to absolute
            url = new URL(url, window.location.href).href;
        } catch (_) { }
        if (!url) return null;

        var win = null;
        if (reuseWindow && !reuseWindow.closed) {
            try {
                reuseWindow.location.href = url;
                reuseWindow.focus();
                win = reuseWindow;
            } catch (_) { }
        }
        if (!win) {
            try {
                win = window.open(url, ENDLESS_WINDOW_NAME);
                if (win) win.focus();
            } catch (_) { }
        }
        return win;
    }

    function scheduleEndlessNext(sourceWindow) {
        if (!endlessState || !endlessState.active) return;

        var countdown = ENDLESS_COUNTDOWN_SEC;

        // 通知练习页开始倒计时
        try {
            if (sourceWindow && !sourceWindow.closed) {
                sourceWindow.postMessage({
                    type: 'ENDLESS_COUNTDOWN',
                    data: { seconds: countdown }
                }, '*');
            }
        } catch (_) { }

        if (endlessState.countdownTimer) {
            clearInterval(endlessState.countdownTimer);
        }

        endlessState.countdownTimer = setInterval(function () {
            if (!endlessState || !endlessState.active) {
                clearInterval(endlessState && endlessState.countdownTimer);
                return;
            }
            if (sourceWindow && sourceWindow.closed) {
                stopEndlessPractice({ silent: true });
                return;
            }
            countdown -= 1;
            // 持续更新倒计时
            try {
                if (sourceWindow && !sourceWindow.closed) {
                    sourceWindow.postMessage({
                        type: 'ENDLESS_COUNTDOWN_TICK',
                        data: { seconds: countdown }
                    }, '*');
                }
            } catch (_) { }

            if (countdown <= 0) {
                clearInterval(endlessState.countdownTimer);
                endlessState.countdownTimer = null;

                if (!endlessState || !endlessState.active) return;

                var nextExam = pickRandomExam();
                if (!nextExam) {
                    if (typeof global.showMessage === 'function') {
                        global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\uff1a\u9898\u5e93\u4e3a\u7a7a', 'warning');
                    }
                    stopEndlessPractice({ silent: true });
                    return;
                }

                if (typeof global.showMessage === 'function') {
                    global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\uff1a\u8fdb\u5165\u4e0b\u4e00\u9898 ' + nextExam.title, 'info');
                }

                var reuseWin = (sourceWindow && !sourceWindow.closed) ? sourceWindow : null;
                var newWin = openEndlessExam(nextExam, reuseWin);
                if (newWin) {
                    endlessState.currentWindow = newWin;
                    // 注入数据采集脚本（延迟，等页面加载）
                    if (global.app && typeof global.app.injectDataCollectionScript === 'function') {
                        setTimeout(function () {
                            if (newWin && !newWin.closed) {
                                try { global.app.startPracticeSession && global.app.startPracticeSession(nextExam.id); } catch (_) { }
                                global.app.injectDataCollectionScript(newWin, nextExam.id, nextExam);
                                global.app.setupExamWindowManagement && global.app.setupExamWindowManagement(newWin, nextExam.id, nextExam, {});
                            }
                        }, 600);
                    } else if (typeof global.openExam === 'function') {
                        // fallback: 重新通过标准路径打开（会产生新窗口，但保证注入）
                        try { global.openExam(nextExam.id); } catch (_) { }
                    }
                }
            }
        }, 1000);
    }

    function startEndlessPractice() {
        // 如果已激活，不再走“父页按钮二次点击退出”的伪交互
        if (endlessState && endlessState.active) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\u8fdb\u884c\u4e2d\uff0c\u8bf7\u5728\u7ec3\u4e60\u9875\u70b9\u51fb\u9000\u51fa', 'info');
            }
            return;
        }

        var firstExam = pickRandomExam();
        if (!firstExam) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\uff1a\u9898\u5e93\u4e3a\u7a7a\uff0c\u8bf7\u5148\u52a0\u8f7d\u9898\u5e93', 'error');
            }
            return;
        }

        // 标记状态
        endlessState = {
            active: true,
            countdownTimer: null,
            currentWindow: null,
            messageHandler: null
        };

        // 监听 PRACTICE_COMPLETE 消息（无尽模式专用拦截）
        var handler = function (event) {
            if (!endlessState || !endlessState.active) return;
            var msg = event && event.data;
            if (!msg || typeof msg.type !== 'string') return;
            if (msg.type === 'ENDLESS_USER_EXIT') {
                stopEndlessPractice();
                return;
            }
            if (msg.type !== 'PRACTICE_COMPLETE') return;

            // 找到当前的练习窗口
            var srcWin = event.source || (endlessState.currentWindow && !endlessState.currentWindow.closed ? endlessState.currentWindow : null);
            scheduleEndlessNext(srcWin);
        };

        endlessState.messageHandler = handler;
        window.addEventListener('message', handler);

        // 打开第一题
        if (typeof global.showMessage === 'function') {
            global.showMessage('\u65e0\u5c3d\u6a21\u5f0f\u5df2\u542f\u52a8\uff0c\u6b63\u5728\u6253\u5f00\uff1a' + firstExam.title, 'info');
        }

        var win = null;
        // 优先用 app.openExam 保证注入
        if (global.app && typeof global.app.openExam === 'function') {
            try {
                Promise.resolve(global.app.openExam(firstExam.id, {
                    target: 'tab',
                    windowName: ENDLESS_WINDOW_NAME
                })).then(function (w) {
                    if (w && endlessState) endlessState.currentWindow = w;
                }).catch(function () { });
            } catch (_) { }
        } else {
            win = openEndlessExam(firstExam, null);
            if (win && endlessState) endlessState.currentWindow = win;
        }
    }

    global.AppActions = Object.assign({}, global.AppActions, {
        exportPracticeMarkdown: exportPracticeMarkdown,
        ensurePracticeSuite: ensurePracticeSuite,
        preloadPracticeSuite: triggerPrefetch,
        preloadBrowseView: triggerBrowsePrefetch,
        preloadMoreTools: triggerMorePrefetch,
        // Phase 3
        startSuitePractice: startSuitePractice,
        continueSuitePractice: continueSuitePractice,
        openExamWithFallback: openExamWithFallback,
        startRandomPractice: startRandomPractice,
        // Phase 4
        startEndlessPractice: startEndlessPractice,
        stopEndlessPractice: stopEndlessPractice
    });

    // 挂载到全局（向后兼容）
    global.startSuitePractice = startSuitePractice;
    global.continueSuitePractice = continueSuitePractice;
    global.openExamWithFallback = openExamWithFallback;
    global.startRandomPractice = startRandomPractice;
    global.startEndlessPractice = startEndlessPractice;
    global.stopEndlessPractice = stopEndlessPractice;

})(typeof window !== 'undefined' ? window : this);
