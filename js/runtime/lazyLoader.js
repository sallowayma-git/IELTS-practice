(function initLazyLoader(global) {
    'use strict';

    var manifest = Object.create(null);
    var scriptStatus = Object.create(null);
    var groupStatus = Object.create(null);
    var dependencies = Object.create(null);
    var providedScripts = new Set();

    function registerDefaultManifest() {
        manifest['exam-data'] = [
            'assets/scripts/complete-exam-data.js'
        ];

        manifest['state-core'] = [
            // Provided by js/bundles/core-foundation.bundle.js.
        ];

        manifest['practice-suite'] = [
            'js/bundles/practice.bundle.js'
        ];

        manifest['browse-runtime'] = [
            'js/bundles/browse.bundle.js'
        ];

        // 向后兼容旧组名
        manifest['browse-view'] = manifest['browse-runtime'].slice();

        manifest['session-suite'] = [
            'js/bundles/session.bundle.js'
        ];

        manifest['more-tools'] = [
            'js/bundles/more.bundle.js'
        ];

        manifest['theme-tools'] = [
            'js/bundles/theme.bundle.js'
        ];

        manifest['settings-tools'] = [
            'js/bundles/settings.bundle.js'
        ];

        manifest['diagnostics-tools'] = [
            'js/bundles/diagnostics.bundle.js'
        ];

        dependencies['state-core'] = [];
        dependencies['exam-data'] = [];
        dependencies['practice-suite'] = ['state-core'];
        dependencies['browse-runtime'] = ['state-core'];
        dependencies['browse-view'] = ['state-core'];
        dependencies['session-suite'] = ['browse-runtime', 'practice-suite'];
        dependencies['settings-tools'] = ['state-core'];
        dependencies['more-tools'] = ['state-core', 'settings-tools'];
        dependencies['theme-tools'] = [];
        dependencies['diagnostics-tools'] = ['state-core', 'settings-tools'];
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

    function markProvided(files) {
        if (!Array.isArray(files)) {
            return;
        }
        files.forEach(function mark(file) {
            if (!file) {
                return;
            }
            var normalized = normalizeScriptUrl(file);
            providedScripts.add(normalized);
            scriptStatus[file] = 'loaded';
            if (normalized) {
                scriptStatus[normalized] = 'loaded';
            }
        });
    }

    function isProvided(url) {
        var normalized = normalizeScriptUrl(url);
        return providedScripts.has(normalized) || scriptStatus[url] === 'loaded' || scriptStatus[normalized] === 'loaded';
    }

    function loadScript(url) {
        if (!url) {
            return Promise.resolve();
        }
        if (isProvided(url)) {
            scriptStatus[url] = 'loaded';
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

        if ((groupName === 'browse-runtime' || groupName === 'browse-view') && list.indexOf('js/bundles/browse.bundle.js') === -1) {
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
    global.AppLazyLoader.markProvided = markProvided;
    global.AppLazyLoader.getStatus = getStatus;
})(typeof window !== 'undefined' ? window : this);
