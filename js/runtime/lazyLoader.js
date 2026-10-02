(function initLazyLoader(global) {
    'use strict';

    var manifest = Object.create(null);
    var scriptStatus = Object.create(null);
    var groupStatus = Object.create(null);
    var dependencies = Object.create(null);
    var providedScripts = new Set();
    var normalizedUrls = Object.create(null);
    var preloadedScripts = new Set();
    var READING_EXAM_MANIFEST_SCRIPT = 'assets/generated/reading-exams/manifest.js';
    var LISTENING_EXAM_MANIFEST_SCRIPT = 'assets/generated/listening-exams/manifest.js';
    var LISTENING_EXAM_INDEX_SCRIPT = 'assets/generated/listening-exams/listening-index.compat.js';
    var optionalListeningExamDataPromise = null;
    var assetVersion = resolveAssetVersion();

    function resolveAssetVersion() {
        try {
            var params = new URLSearchParams(global.location && global.location.search ? global.location.search : '');
            return String(params.get('v') || '').trim();
        } catch (_) {
            return '';
        }
    }

    function versionScriptUrl(url) {
        if (!url || !assetVersion) {
            return url;
        }
        try {
            var resolved = new URL(url, document.baseURI);
            if (resolved.origin !== global.location.origin) {
                return url;
            }
            resolved.searchParams.set('v', assetVersion);
            return resolved.href;
        } catch (_) {
            return url;
        }
    }

    function registerDefaultManifest() {
        manifest['exam-data'] = [
            READING_EXAM_MANIFEST_SCRIPT
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

        manifest['settings-tools'] = [];
        manifest['reading-tools'] = ['js/bundles/reading-tools.bundle.js'];
        manifest['reading-library'] = ['js/bundles/reading-library.bundle.js'];
        manifest['vocabulary-tools'] = ['js/bundles/vocabulary.bundle.js'];

        manifest['diagnostics-tools'] = [
            'js/bundles/diagnostics.bundle.js'
        ];

        dependencies['state-core'] = [];
        dependencies['exam-data'] = [];
        dependencies['practice-suite'] = ['state-core'];
        // Browsing is also the entry point for starting a practice session.
        // Keep the real recorder ready before a user can open an exam; the
        // bootstrap fallback cannot own the full submit/persist round trip.
        dependencies['browse-runtime'] = ['state-core', 'practice-suite'];
        dependencies['browse-view'] = ['state-core', 'practice-suite'];
        dependencies['session-suite'] = ['browse-runtime', 'practice-suite'];
        dependencies['settings-tools'] = ['state-core'];
        dependencies['reading-tools'] = ['state-core'];
        dependencies['reading-library'] = ['state-core'];
        dependencies['vocabulary-tools'] = ['state-core'];
        dependencies['more-tools'] = ['state-core'];
        dependencies['theme-tools'] = [];
        dependencies['diagnostics-tools'] = ['state-core'];
    }

    function setBuiltInListeningAvailability(available, reason) {
        try {
            global.__defaultListeningLibraryAvailable = available === true;
            global.__defaultListeningLibraryAvailabilityReason = reason || (available ? 'available' : 'unavailable');
        } catch (_) { }
    }

    function normalizeScriptUrl(url) {
        if (!url) {
            return '';
        }
        if (normalizedUrls[url]) {
            return normalizedUrls[url];
        }
        try {
            return normalizedUrls[url] = new URL(versionScriptUrl(url), document.baseURI).href;
        } catch (_) {
            return String(url);
        }
    }

    function preloadGroup(groupName) {
        var visited = new Set();
        var count = 0;
        // Local packages need script injection, not network resource hints.
        // Preloads only fetch bytes; dependency execution remains sequential.
        if (!global.location || !/^https?:$/.test(global.location.protocol || '')) {
            return count;
        }
        function visit(name) {
            if (visited.has(name) || !manifest[name]) return;
            visited.add(name);
            (dependencies[name] || []).forEach(visit);
            manifest[name].forEach(function preload(url) {
                var normalized = normalizeScriptUrl(url);
                if (!normalized || isProvided(url) || preloadedScripts.has(normalized)) return;
                try {
                    var link = document.createElement('link');
                    // Unsupported engines retain the normal script-loading path.
                    if (!link.relList || typeof link.relList.supports !== 'function'
                        || !link.relList.supports('preload')) return;
                    link.rel = 'preload';
                    link.as = 'script';
                    link.href = normalized;
                    preloadedScripts.add(normalized);
                    try { document.head.appendChild(link); } catch (error) {
                        preloadedScripts.delete(normalized);
                        throw error;
                    }
                    count += 1;
                } catch (_) { }
            });
        }
        visit(groupName);
        return count;
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

    function loadScript(url, options) {
        if (!url) {
            return Promise.resolve();
        }
        if (isProvided(url)) {
            scriptStatus[url] = 'loaded';
            return Promise.resolve();
        }
        var normalized = normalizeScriptUrl(url);
        var status = scriptStatus[normalized] || scriptStatus[url];
        if (status && status.then) {
            return status;
        }

        var requestUrl = versionScriptUrl(url);
        var existing = findExistingScriptTag(requestUrl);
        if (existing) {
            scriptStatus[url] = 'loaded';
            scriptStatus[normalized] = 'loaded';
            return Promise.resolve();
        }

        var scriptNode;
        var pending = new Promise(function inject(resolve, reject) {
            var script = document.createElement('script');
            scriptNode = script;
            var settled = false;
            var timer = null;
            var diagnostics = global.AppDiagnostics;
            // Declare before setting src or inserting the element: capture listeners run first.
            try {
                if (diagnostics) diagnostics.declareResource(script, { url: url, optional: !!(options && options.optional) });
            } catch (_) { }
            script.src = requestUrl;
            script.async = true;
            script.onload = function handleLoad() {
                if (settled) return;
                settled = true;
                try { global.clearTimeout?.(timer); } catch (_) { }
                scriptStatus[url] = 'loaded';
                scriptStatus[normalized] = 'loaded';
                resolve();
            };
            script.onerror = function handleError(error) {
                if (settled) return;
                settled = true;
                try { global.clearTimeout?.(timer); } catch (_) { }
                scriptStatus[url] = null;
                scriptStatus[normalized] = null;
                var failure = new Error('加载脚本失败: ' + url);
                try {
                    if (diagnostics) failure = diagnostics.resourceFailure(script, failure) || failure;
                } catch (_) { }
                try {
                    if (script.parentNode) {
                        script.parentNode.removeChild(script);
                    }
                } catch (_) { }
                try {
                    global.AppOperationDiagnostics?.failure({ code: 'RESOURCE_LOAD_FAILED', module: 'main',
                        action: 'load-resource', error: failure, operation: 'not-committed',
                        resource: { url: url, optional: !!(options && options.optional) } });
                } catch (_) { }
                reject(failure);
            };
            try { timer = global.setTimeout?.(function () { script.onerror(); }, 15000); } catch (_) { }
        });
        scriptStatus[url] = pending;
        scriptStatus[normalized] = pending;
        // Publish the in-flight request before insertion: a synchronous DOM
        // failure must clear it so the next request can retry.
        try { document.head.appendChild(scriptNode); } catch (error) {
            if (scriptNode && scriptNode.onerror) scriptNode.onerror(error);
        }
        return pending;
    }

    function loadOptionalScript(url, label) {
        return loadScript(url, { optional: true }).then(function onOptionalLoaded() {
            return true;
        }).catch(function onOptionalFailed(error) {
            scriptStatus[url] = null;
            try {
                console.warn('[LazyLoader] 可选脚本未加载，已跳过:', label || url, error && error.message ? error.message : error);
            } catch (_) { }
            return false;
        });
    }

    function hasListeningManifest() {
        var manifestObject = global.__LISTENING_EXAM_MANIFEST__;
        return !!(
            manifestObject
            && typeof manifestObject === 'object'
            && Object.keys(manifestObject).length > 0
        );
    }

    function ensureOptionalListeningExamData() {
        if (optionalListeningExamDataPromise) {
            return optionalListeningExamDataPromise;
        }
        setBuiltInListeningAvailability(false, 'pending-manifest');
        optionalListeningExamDataPromise = loadOptionalScript(LISTENING_EXAM_MANIFEST_SCRIPT, 'listening manifest')
            .then(function afterManifestLoaded(loaded) {
                if (!loaded || !hasListeningManifest()) {
                    setBuiltInListeningAvailability(false, loaded ? 'manifest-empty' : 'manifest-missing');
                    return undefined;
                }
                return loadOptionalScript(LISTENING_EXAM_INDEX_SCRIPT, 'listening index')
                    .then(function afterListeningIndexLoaded(indexLoaded) {
                        var available = !!(
                            indexLoaded
                            && Array.isArray(global.listeningExamIndex)
                            && global.listeningExamIndex.length > 0
                        );
                        setBuiltInListeningAvailability(available, available ? 'available' : 'index-missing');
                        return undefined;
                    });
            });
        return optionalListeningExamDataPromise;
    }

    function loadBatch(batch) {
        if (!Array.isArray(batch) || batch.length === 0) {
            return Promise.resolve();
        }
        if (batch.length === 1) {
            return loadScript(batch[0]);
        }
        return Promise.all(batch.map(function (url) { return loadScript(url); })).then(function () {
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

        if (groupName === 'exam-data') {
            return sequentialLoad(list).then(ensureOptionalListeningExamData);
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
            return groupName === 'exam-data'
                ? ensureOptionalListeningExamData()
                : Promise.resolve();
        }
        if (groupStatus[groupName] && groupStatus[groupName].then) {
            return groupStatus[groupName];
        }

        var required = dependencies[groupName] || [];
        preloadGroup(groupName);
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
    global.AppLazyLoader.preloadGroup = preloadGroup;
    global.AppLazyLoader.registerGroup = registerGroup;
    global.AppLazyLoader.markProvided = markProvided;
    global.AppLazyLoader.getStatus = getStatus;
})(typeof window !== 'undefined' ? window : this);
