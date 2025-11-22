(function initLazyLoader(global) {
    'use strict';

    var manifest = Object.create(null);
    var scriptStatus = Object.create(null);
    var groupStatus = Object.create(null);

    function registerDefaultManifest() {
        manifest['exam-data'] = [
            'assets/scripts/complete-exam-data.js',
            'assets/scripts/listening-exam-data.js'
        ];

        manifest['practice-suite'] = [
            // 练习记录功能与存储相关，需按用户行为加载
            'js/utils/markdownExporter.js',
            'js/components/practiceRecordModal.js',
            'js/components/practiceHistoryEnhancer.js',
            'js/core/scoreStorage.js',
            'js/utils/answerSanitizer.js',
            'js/core/practiceRecorder.js',
            'js/core/legacyStateBridge.js',
            'js/utils/legacyStateAdapter.js',
            'js/services/GlobalStateService.js'
        ];

        manifest['browse-view'] = [
            // 浏览和主逻辑（先加载按钮/导出等动作，再加载主体 main）
            'js/app/examActions.js',
            'js/app/state-service.js',
            'js/app/browseController.js',
            'js/presentation/message-center.js',
            'js/runtime/legacy-state-adapter.js',
            'js/components/PDFHandler.js',
            'js/components/SystemDiagnostics.js',
            'js/components/PerformanceOptimizer.js',
            'js/components/DataIntegrityManager.js',
            'js/components/BrowseStateManager.js',
            'js/utils/dataConsistencyManager.js',
            'js/utils/answerComparisonUtils.js',
            'js/utils/BrowsePreferencesUtils.js',
            'js/main.js'
        ];

        manifest['more-tools'] = [
            // 更多工具与词汇模块
            'js/utils/vocabDataIO.js',
            'js/core/vocabScheduler.js',
            'js/core/vocabStore.js',
            'js/components/vocabDashboardCards.js',
            'js/components/vocabSessionView.js',
            'js/utils/dataBackupManager.js',
            'js/components/dataManagementPanel.js',
            'js/presentation/moreView.js',
            'js/presentation/miniGames.js'
        ];
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

    function sequentialLoad(files) {
        return files.reduce(function chain(promise, file) {
            return promise.then(function next() {
                return loadScript(file);
            });
        }, Promise.resolve());
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

        groupStatus[groupName] = sequentialLoad(manifest[groupName]).then(function onGroupLoaded() {
            groupStatus[groupName] = 'loaded';
        }).catch(function onGroupFailed(error) {
            console.error('[LazyLoader] 组加载失败:', groupName, error);
            groupStatus[groupName] = null;
            throw error;
        });

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
