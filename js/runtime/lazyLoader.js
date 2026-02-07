(function initLazyLoader(global) {
    'use strict';

    var manifest = Object.create(null);
    var scriptStatus = Object.create(null);
    var groupStatus = Object.create(null);
    var dependencies = Object.create(null);

    function registerDefaultManifest() {
        manifest['exam-data'] = [
            'assets/scripts/complete-exam-data.js',
            'assets/scripts/listening-exam-data.js'
        ];

        manifest['state-core'] = [
            'js/app/state-service.js',
            'js/services/GlobalStateService.js',
            'js/runtime/legacy-state-adapter.js',
            'js/services/libraryManager.js'
        ];

        manifest['practice-suite'] = [
            // 练习记录功能与存储相关，需按用户行为加载
            'js/app/spellingErrorCollector.js',
            'js/utils/markdownExporter.js',
            'js/components/practiceRecordModal.js',
            'js/components/practiceHistoryEnhancer.js',
            'js/core/scoreStorage.js',
            'js/utils/answerSanitizer.js',
            'js/core/practiceRecorder.js',
            'js/core/legacyStateBridge.js',
            'js/utils/legacyStateAdapter.js'
        ];

        manifest['browse-runtime'] = [
            // 浏览和主逻辑（main.js 保持组内最后加载）
            'js/views/legacyViewBundle.js',
            'js/app/examActions.js',
            // 单篇练习通信与会话能力属于 browse/practice 主流程
            'js/app/examSessionMixin.js',
            'js/app/browseController.js',
            'js/presentation/message-center.js',
            'js/components/PDFHandler.js',
            'js/components/SystemDiagnostics.js',
            'js/components/PerformanceOptimizer.js',
            'js/components/DataIntegrityManager.js',
            'js/components/BrowseStateManager.js',
            'js/utils/dataConsistencyManager.js',
            'js/utils/answerComparisonUtils.js',
            'js/utils/BrowsePreferencesUtils.js',
            'js/utils/performance.js',
            'js/utils/typeChecker.js',
            'js/utils/codeStandards.js',
            'js/main.js'
        ];

        // 向后兼容旧组名
        manifest['browse-view'] = manifest['browse-runtime'].slice();

        manifest['session-suite'] = [
            'js/app/suitePracticeMixin.js'
        ];

        manifest['more-tools'] = [
            // 更多工具与词汇模块
            'js/utils/vocabDataIO.js',
            'js/core/vocabScheduler.js',
            'js/core/vocabStore.js',
            'js/app/vocabListSwitcher.js',
            'js/components/vocabDashboardCards.js',
            'js/components/vocabSessionView.js',
            'js/utils/dataBackupManager.js',
            'js/presentation/moreView.js',
            'js/presentation/miniGames.js',
            'js/services/achievementManager.js'
        ];

        manifest['theme-tools'] = [
            'js/theme-switcher.js'
        ];

        dependencies['state-core'] = [];
        dependencies['exam-data'] = [];
        dependencies['practice-suite'] = ['state-core'];
        dependencies['browse-runtime'] = ['state-core'];
        dependencies['browse-view'] = ['state-core'];
        dependencies['session-suite'] = ['browse-runtime', 'practice-suite'];
        dependencies['more-tools'] = ['state-core'];
        dependencies['theme-tools'] = [];
    }

    function normalizeScriptUrl(url) {
        if (!url) {
            return '';
        }
        try {
            return new URL(url, document.baseURI).href;
        } catch (_) {
            return String(url);
        }
    }

    function findExistingScriptTag(url) {
        if (typeof document === 'undefined') {
            return null;
        }
        var target = normalizeScriptUrl(url);
        if (!target) {
            return null;
        }
        var scripts = document.querySelectorAll('script[src]');
        for (var i = 0; i < scripts.length; i += 1) {
            var node = scripts[i];
            var srcAttr = node.getAttribute('src');
            if (!srcAttr) {
                continue;
            }
            if (normalizeScriptUrl(srcAttr) === target || normalizeScriptUrl(node.src) === target) {
                return node;
            }
        }
        return null;
    }

    function loadScript(url) {
        if (!url) {
            return Promise.resolve();
        }
        if (scriptStatus[url] === 'loaded') {
            return Promise.resolve();
        }
        if (scriptStatus[url] && scriptStatus[url].then) {
            return scriptStatus[url];
        }

        var existing = findExistingScriptTag(url);
        if (existing) {
            scriptStatus[url] = 'loaded';
            return Promise.resolve();
        }

        scriptStatus[url] = new Promise(function inject(resolve, reject) {
            var script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = function handleLoad() {
                scriptStatus[url] = 'loaded';
                resolve();
            };
            script.onerror = function handleError(error) {
                scriptStatus[url] = null;
                reject(new Error('加载脚本失败: ' + url + ' => ' + (error?.message || error)));
            };
            document.head.appendChild(script);
        });

        return scriptStatus[url];
    }

    function loadBatch(batch) {
        if (!Array.isArray(batch) || batch.length === 0) {
            return Promise.resolve();
        }
        if (batch.length === 1) {
            return loadScript(batch[0]);
        }
        return Promise.all(batch.map(loadScript)).then(function () {
            return undefined;
        });
    }

    function loadByBatches(batches) {
        return batches.reduce(function chain(promise, batch) {
            return promise.then(function next() {
                return loadBatch(batch);
            });
        }, Promise.resolve());
    }

    function sequentialLoad(files) {
        return files.reduce(function chain(promise, file) {
            return promise.then(function next() {
                return loadScript(file);
            });
        }, Promise.resolve());
    }

    function loadGroup(groupName, files) {
        var list = Array.isArray(files) ? files.slice() : [];
        if (!list.length) {
            return Promise.resolve();
        }

        if (groupName === 'browse-runtime' || groupName === 'browse-view') {
            var mainIndex = list.indexOf('js/main.js');
            var withoutMain = mainIndex >= 0
                ? list.filter(function (file) { return file !== 'js/main.js'; })
                : list.slice();

            var batches = [
                ['js/views/legacyViewBundle.js'],
                ['js/app/examActions.js'],
                ['js/app/browseController.js'],
                ['js/presentation/message-center.js'],
                withoutMain.filter(function (file) {
                    return [
                        'js/views/legacyViewBundle.js',
                        'js/app/examActions.js',
                        'js/app/browseController.js',
                        'js/presentation/message-center.js',
                        'js/main.js'
                    ].indexOf(file) === -1;
                })
            ];
            if (mainIndex >= 0) {
                batches.push(['js/main.js']);
            }
            return loadByBatches(batches);
        }

        return sequentialLoad(list);
    }

    function mirrorAliasStatus(groupName, statusValue) {
        if (groupName === 'browse-runtime') {
            groupStatus['browse-view'] = statusValue;
        } else if (groupName === 'browse-view') {
            groupStatus['browse-runtime'] = statusValue;
        }
    }

    function refreshAppPrototypeIfNeeded(groupName) {
        var files = manifest[groupName] || [];
        var containsMixin = files.some(function (file) {
            return typeof file === 'string' && /Mixin\.js$/.test(file);
        });
        if (!containsMixin) {
            return;
        }
        try {
            if (global.ExamSystemAppMixins && typeof global.ExamSystemAppMixins.__applyToApp === 'function') {
                global.ExamSystemAppMixins.__applyToApp();
            }
        } catch (error) {
            console.warn('[LazyLoader] 重新挂载 mixins 失败:', groupName, error);
        }
    }

    function ensureGroup(groupName) {
        if (!groupName || !manifest[groupName]) {
            return Promise.resolve();
        }

        if (groupStatus[groupName] === 'loaded') {
            return Promise.resolve();
        }
        if (groupStatus[groupName] && groupStatus[groupName].then) {
            return groupStatus[groupName];
        }

        var required = dependencies[groupName] || [];
        groupStatus[groupName] = Promise.all(required.map(ensureGroup))
            .then(function () {
                return loadGroup(groupName, manifest[groupName]);
            })
            .then(function onGroupLoaded() {
                refreshAppPrototypeIfNeeded(groupName);
                groupStatus[groupName] = 'loaded';
                mirrorAliasStatus(groupName, 'loaded');
            }).catch(function onGroupFailed(error) {
                console.error('[LazyLoader] 组加载失败:', groupName, error);
                groupStatus[groupName] = null;
                mirrorAliasStatus(groupName, null);
                throw error;
            });
        mirrorAliasStatus(groupName, groupStatus[groupName]);

        return groupStatus[groupName];
    }

    function registerGroup(name, files) {
        if (!name || !Array.isArray(files)) {
            return;
        }
        manifest[name] = files.slice();
    }

    function getStatus(name) {
        if (!name) {
            return { manifest: Object.keys(manifest) };
        }
        return {
            loaded: groupStatus[name] === 'loaded',
            files: manifest[name] ? manifest[name].slice() : []
        };
    }

    registerDefaultManifest();

    global.AppLazyLoader = global.AppLazyLoader || {};
    global.AppLazyLoader.ensureGroup = ensureGroup;
    global.AppLazyLoader.registerGroup = registerGroup;
    global.AppLazyLoader.getStatus = getStatus;
})(typeof window !== 'undefined' ? window : this);
