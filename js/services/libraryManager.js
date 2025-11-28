(function (global) {
    'use strict';

    const RAW_DEFAULT_PATH_MAP = {
        reading: {
            root: '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/',
            exceptions: {}
        },
        listening: {
            root: 'ListeningPractice/',
            exceptions: {}
        }
    };

    function clonePathMap(map, fallback = RAW_DEFAULT_PATH_MAP) {
        const source = map && typeof map === 'object' ? map : fallback;
        const cloneCategory = (category) => {
            const segment = source[category] && typeof source[category] === 'object' ? source[category] : {};
            return {
                root: typeof segment.root === 'string' ? segment.root : '',
                exceptions: segment.exceptions && typeof segment.exceptions === 'object'
                    ? Object.assign({}, segment.exceptions)
                    : {}
            };
        };
        return {
            reading: cloneCategory('reading'),
            listening: cloneCategory('listening')
        };
    }

    function normalizePathRoot(value) {
        if (!value) {
            return '';
        }
        let root = String(value).replace(/\\/g, '/');
        root = root.replace(/\/+$/, '') + '/';
        if (root.startsWith('./')) {
            root = root.slice(2);
        }
        return root;
    }

    function mergeRootWithFallback(root, fallbackRoot) {
        const normalizedPrimary = normalizePathRoot(root || '');
        if (normalizedPrimary) {
            return normalizedPrimary;
        }
        return normalizePathRoot(fallbackRoot || '');
    }

    function buildOverridePathMap(metadata, fallback = RAW_DEFAULT_PATH_MAP) {
        const base = clonePathMap(fallback);
        if (!metadata || typeof metadata !== 'object') {
            return base;
        }

        const rootMeta = metadata.pathRoot;
        if (rootMeta && typeof rootMeta === 'object') {
            if (rootMeta.reading) {
                base.reading.root = normalizePathRoot(rootMeta.reading);
            }
            if (rootMeta.listening) {
                base.listening.root = normalizePathRoot(rootMeta.listening);
            }
        }

        return base;
    }

    const DEFAULT_PATH_MAP = buildOverridePathMap(
        typeof global !== 'undefined' ? global.examIndexMetadata : null,
        RAW_DEFAULT_PATH_MAP
    );
    const PATH_MAP_STORAGE_PREFIX = 'exam_path_map__';

    function normalizePathMap(map, fallback = DEFAULT_PATH_MAP) {
        const base = clonePathMap(fallback);
        const incoming = clonePathMap(map);
        if (incoming.reading.root) {
            base.reading.root = normalizePathRoot(incoming.reading.root);
        }
        if (incoming.listening.root) {
            base.listening.root = normalizePathRoot(incoming.listening.root);
        }
        if (Object.keys(incoming.reading.exceptions).length) {
            base.reading.exceptions = incoming.reading.exceptions;
        }
        if (Object.keys(incoming.listening.exceptions).length) {
            base.listening.exceptions = incoming.listening.exceptions;
        }
        return base;
    }

    function computeCommonRoot(paths) {
        if (!paths || !paths.length) {
            return '';
        }
        const segmentsList = paths.map((rawPath) => {
            if (typeof rawPath !== 'string') {
                return [];
            }
            const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '');
            return normalized ? normalized.split('/') : [];
        }).filter((segments) => segments.length);

        if (!segmentsList.length) {
            return '';
        }

        let prefix = segmentsList[0].slice();
        for (let i = 1; i < segmentsList.length; i += 1) {
            const segments = segmentsList[i];
            let j = 0;
            while (j < prefix.length && j < segments.length && prefix[j] === segments[j]) {
                j += 1;
            }
            if (j === 0) {
                return '';
            }
            prefix = prefix.slice(0, j);
        }

        return prefix.length ? prefix.join('/') + '/' : '';
    }

    function derivePathMapFromIndex(exams, fallbackMap = DEFAULT_PATH_MAP) {
        const fallback = normalizePathMap(fallbackMap);
        const result = clonePathMap(fallback);

        if (!Array.isArray(exams)) {
            return result;
        }

        const pathsByType = { reading: [], listening: [] };

        exams.forEach((exam) => {
            if (!exam || typeof exam.path !== 'string' || !exam.type) {
                return;
            }
            const normalized = exam.path.replace(/\\/g, '/');
            if (exam.type === 'reading') {
                pathsByType.reading.push(normalized);
            } else if (exam.type === 'listening') {
                pathsByType.listening.push(normalized);
            }
        });

        const readingRoot = computeCommonRoot(pathsByType.reading);
        if (pathsByType.reading.length && readingRoot) {
            result.reading.root = normalizePathRoot(readingRoot);
        }

        const listeningRoot = computeCommonRoot(pathsByType.listening);
        if (pathsByType.listening.length && listeningRoot) {
            result.listening.root = normalizePathRoot(listeningRoot);
        }

        return result;
    }

    function getPathMapStorageKey(key) {
        return PATH_MAP_STORAGE_PREFIX + key;
    }

    function setActivePathMap(map) {
        const normalized = normalizePathMap(map);
        try { global.__activeLibraryPathMap = normalized; } catch (_) { }
        try { global.pathMap = normalized; } catch (_) { }
        return normalized;
    }

    class LibraryManager {
        constructor(options = {}) {
            this.options = options;
            this.defaultPathMap = DEFAULT_PATH_MAP;
        }

        async getActiveLibraryConfigurationKey() {
            return await global.storage.get('active_exam_index_key', 'exam_index');
        }

        async setActiveLibraryConfiguration(key) {
            try {
                await global.storage.set('active_exam_index_key', key);
            } catch (e) {
                console.error('[LibraryManager] 设置活动题库配置失败:', e);
            }
        }

        async getLibraryConfigurations() {
            return await global.storage.get('exam_index_configurations', []);
        }

        async saveLibraryConfiguration(name, key, examCount) {
            try {
                const configs = await global.storage.get('exam_index_configurations', []);
                const newEntry = { name, key, examCount, timestamp: Date.now() };
                const idx = configs.findIndex(c => c.key === key);
                if (idx >= 0) {
                    configs[idx] = newEntry;
                } else {
                    configs.push(newEntry);
                }
                await global.storage.set('exam_index_configurations', configs);
            } catch (e) {
                console.error('[LibraryManager] 保存题库配置失败:', e);
            }
        }

        async loadPathMapForConfiguration(key) {
            if (!key) {
                return clonePathMap(this.defaultPathMap);
            }
            try {
                const stored = await global.storage.get(getPathMapStorageKey(key));
                if (stored && typeof stored === 'object') {
                    return normalizePathMap(stored, this.defaultPathMap);
                }
            } catch (error) {
                console.warn('[LibraryManager] 读取路径映射失败:', error);
            }
            return clonePathMap(this.defaultPathMap);
        }

        async savePathMapForConfiguration(key, examIndex, options = {}) {
            if (!key || !Array.isArray(examIndex)) {
                return null;
            }
            const fallback = options.fallbackMap || this.defaultPathMap;
            const overrideMap = options.overrideMap;
            const derived = overrideMap ? normalizePathMap(overrideMap, fallback) : derivePathMapFromIndex(examIndex, fallback);
            try {
                await global.storage.set(getPathMapStorageKey(key), derived);
            } catch (error) {
                console.warn('[LibraryManager] 写入路径映射失败:', error);
            }
            if (options.setActive) {
                setActivePathMap(derived);
            }
            return derived;
        }

        resolveScriptPathRoot(type) {
            const defaultRoot = type === 'reading'
                ? '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/'
                : 'ListeningPractice/';
            try {
                if (type === 'reading') {
                    const rootMeta = global.completeExamIndex && global.completeExamIndex.pathRoot;
                    if (typeof rootMeta === 'string' && rootMeta.trim()) {
                        return rootMeta.trim();
                    }
                    if (rootMeta && typeof rootMeta === 'object' && typeof rootMeta.reading === 'string') {
                        return rootMeta.reading.trim();
                    }
                } else if (type === 'listening') {
                    const listeningRoot = global.listeningExamIndex && global.listeningExamIndex.pathRoot;
                    if (typeof listeningRoot === 'string' && listeningRoot.trim()) {
                        return listeningRoot.trim();
                    }
                    const completeRoot = global.completeExamIndex && global.completeExamIndex.pathRoot;
                    if (completeRoot && typeof completeRoot === 'object' && typeof completeRoot.listening === 'string') {
                        return completeRoot.listening.trim();
                    }
                }
            } catch (_) { }
            return defaultRoot;
        }

        finishLibraryLoading(startTime) {
            const loadTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() - startTime : 0;
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('题库装载完成', 75);
            }
            try { global.updateOverview && global.updateOverview(); } catch (_) { }
            try { global.refreshBrowseProgressFromRecords && global.refreshBrowseProgressFromRecords(); } catch (_) { }
            try {
                global.dispatchEvent(new CustomEvent('examIndexLoaded'));
            } catch (_) { }
            return loadTime;
        }

        async loadActiveLibrary(forceReload = false) {
            const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('加载题库索引', 35);
            }
            const rawKey = await this.getActiveLibraryConfigurationKey();
            const activeConfigKey = typeof rawKey === 'string' && rawKey.trim()
                ? rawKey.trim()
                : 'exam_index';
            const isDefaultConfig = activeConfigKey === 'exam_index';

            let cachedData = null;
            try {
                if (!isDefaultConfig) {
                    cachedData = await global.storage.get(activeConfigKey);
                } else {
                    await global.storage.set('active_exam_index_key', 'exam_index');
                }
            } catch (error) {
                console.warn('[LibraryManager] 读取题库缓存失败:', error);
            }

            if (!forceReload && !isDefaultConfig && Array.isArray(cachedData) && cachedData.length > 0) {
                const updatedIndex = global.setExamIndexState ? global.setExamIndexState(cachedData) : cachedData;
                try {
                    await this.savePathMapForConfiguration(activeConfigKey, updatedIndex, { setActive: true });
                } catch (error) {
                    console.warn('[LibraryManager] 应用路径映射失败:', error);
                }
                this.finishLibraryLoading(startTime);
                return updatedIndex;
            }

            if (!isDefaultConfig) {
                const normalized = Array.isArray(cachedData) ? cachedData : [];
                if (global.setExamIndexState) global.setExamIndexState(normalized);
                if (!normalized.length) {
                    console.warn('[LibraryManager] 当前题库配置中没有找到可用数据');
                    if (typeof global.showMessage === 'function') {
                        global.showMessage('当前题库配置没有数据，请重新导入或切换至默认题库。', 'warning');
                    }
                }
                this.finishLibraryLoading(startTime);
                return normalized;
            }

            try {
                if (global.ensureExamDataScripts) {
                    await global.ensureExamDataScripts();
                }
                if (typeof global.reportBootStage === 'function') {
                    global.reportBootStage('解析题库数据', 55);
                }
                const readingExams = Array.isArray(global.completeExamIndex)
                    ? global.completeExamIndex.map((exam) => Object.assign({}, exam, { type: 'reading' }))
                    : [];
                const listeningExams = Array.isArray(global.listeningExamIndex)
                    ? global.listeningExamIndex.map((exam) => Object.assign({}, exam, { type: 'listening' }))
                    : [];

                if (!readingExams.length && !listeningExams.length) {
                    if (global.setExamIndexState) global.setExamIndexState([]);
                    console.warn('[LibraryManager] 未检测到默认题库脚本中的题源数据');
                    this.finishLibraryLoading(startTime);
                    return [];
                }

                const combined = [...readingExams, ...listeningExams];
                if (typeof global.assignExamSequenceNumbers === 'function') {
                    global.assignExamSequenceNumbers(combined);
                }
                const updatedIndex = global.setExamIndexState ? global.setExamIndexState(combined) : combined;

                const metadata = {
                    source: 'default-script',
                    generatedAt: Date.now(),
                    counts: {
                        total: combined.length,
                        reading: readingExams.length,
                        listening: listeningExams.length
                    },
                    pathRoot: {
                        reading: this.resolveScriptPathRoot('reading'),
                        listening: this.resolveScriptPathRoot('listening')
                    }
                };
                try { global.examIndexMetadata = metadata; } catch (_) { }

                const overrideMap = {
                    reading: {
                        root: metadata.pathRoot.reading,
                        exceptions: {}
                    },
                    listening: {
                        root: metadata.pathRoot.listening,
                        exceptions: {}
                    }
                };

                await global.storage.set('exam_index', updatedIndex);
                await this.saveLibraryConfiguration('默认题库', 'exam_index', updatedIndex.length);
                await this.setActiveLibraryConfiguration('exam_index');
                await this.savePathMapForConfiguration('exam_index', updatedIndex, { setActive: true, overrideMap });

                this.finishLibraryLoading(startTime);
                return updatedIndex;
            } catch (error) {
                console.error('[LibraryManager] 加载默认题库失败:', error);
                if (typeof global.showMessage === 'function') {
                    global.showMessage('题库刷新失败: ' + (error && error.message ? error.message : error), 'error');
                }
                if (global.setExamIndexState) global.setExamIndexState([]);
                this.finishLibraryLoading(startTime);
                return [];
            }
        }

        async updateLibraryConfigurationMetadata(key, examCount) {
            if (!key) {
                return;
            }
            try {
                let configs = await this.getLibraryConfigurations();
                if (!Array.isArray(configs)) {
                    configs = [];
                }
                const now = Date.now();
                let mutated = false;

                const updatedConfigs = configs.map((entry) => {
                    if (!entry) {
                        return entry;
                    }
                    if (typeof entry === 'string') {
                        const trimmed = entry.trim();
                        if (trimmed === key) {
                            mutated = true;
                            return {
                                name: key === 'exam_index' ? '默认题库' : key,
                                key,
                                examCount,
                                timestamp: now
                            };
                        }
                        return entry;
                    }
                    if (entry && entry.key === key) {
                        const next = Object.assign({}, entry);
                        if (Number(next.examCount) !== examCount) {
                            next.examCount = examCount;
                        }
                        next.timestamp = now;
                        mutated = true;
                        return next;
                    }
                    return entry;
                });

                if (mutated) {
                    await global.storage.set('exam_index_configurations', updatedConfigs);
                }
            } catch (error) {
                console.warn('[LibraryManager] 无法刷新题库配置元数据', error);
            }
        }

        async fetchLibraryDataset(key) {
            if (!key) {
                return [];
            }
            try {
                const dataset = await global.storage.get(key);
                return Array.isArray(dataset) ? dataset : [];
            } catch (error) {
                console.warn('[LibraryManager] 无法读取题库数据:', key, error);
                return [];
            }
        }

        async applyLibraryConfiguration(key, dataset, options = {}) {
            const exams = Array.isArray(dataset) ? dataset.slice() : await this.fetchLibraryDataset(key);
            if (!Array.isArray(exams) || exams.length === 0) {
                if (typeof global.showMessage === 'function') {
                    global.showMessage('目标题库没有题目，请先加载数据', 'warning');
                }
                return false;
            }

            let pathMap = await this.loadPathMapForConfiguration(key);
            pathMap = derivePathMapFromIndex(exams, pathMap);
            setActivePathMap(pathMap);

            if (global.setExamIndexState) global.setExamIndexState(exams);
            if (typeof global.setBrowseFilterState === 'function') {
                global.setBrowseFilterState('all', 'all');
            }
            if (typeof global.setFilteredExamsState === 'function') {
                global.setFilteredExamsState([]);
            }

            try {
                await this.setActiveLibraryConfiguration(key);
            } catch (error) {
                console.warn('[LibraryManager] 无法写入当前题库配置:', error);
            }

            await this.updateLibraryConfigurationMetadata(key, exams.length);
            await this.savePathMapForConfiguration(key, exams, {
                overrideMap: pathMap,
                setActive: true
            });

            try { global.updateSystemInfo && global.updateSystemInfo(); } catch (_) { }
            try { global.updateOverview && global.updateOverview(); } catch (_) { }
            try { global.loadExamList && global.loadExamList(); } catch (_) { }

            try {
                global.dispatchEvent(new CustomEvent('examIndexLoaded', {
                    detail: { key }
                }));
            } catch (error) {
                console.warn('[LibraryManager] 题库切换事件派发失败', error);
            }

            if (!options.skipConfigRefresh && typeof global.renderLibraryConfigList === 'function') {
                setTimeout(() => {
                    try {
                        global.renderLibraryConfigList({
                            allowDelete: true,
                            activeKey: key
                        });
                    } catch (error) {
                        console.warn('[LibraryManager] 重渲染题库配置列表失败', error);
                    }
                }, 0);
            }

            return true;
        }
    }

    let singleton = null;
    function getInstance(options) {
        if (!singleton) {
            singleton = new LibraryManager(options);
        }
        return singleton;
    }

    async function switchLibraryConfig(key) {
        const manager = getInstance();
        // 如果没有传入 key，尝试获取当前激活的 key
        if (!key) {
            key = await manager.getActiveLibraryConfigurationKey();
        }
        // 如果仍然没有 key，默认为 exam_index
        if (!key) {
            key = 'exam_index';
        }

        // 确认对话框逻辑（如果需要）
        // 这里简化为直接切换，因为 UI 层通常会处理确认

        return await manager.applyLibraryConfiguration(key);
    }

    async function loadLibrary(key) {
        const manager = getInstance();
        if (key === 'default' || key === 'exam_index') {
            // 重新加载默认题库
            return await manager.loadActiveLibrary(true);
        }
        // 加载指定题库
        return await manager.applyLibraryConfiguration(key);
    }

    global.LibraryManager = {
        getInstance,
        derivePathMapFromIndex,
        normalizePathRoot,
        mergeRootWithFallback,
        buildOverridePathMap,
        RAW_DEFAULT_PATH_MAP,
        DEFAULT_PATH_MAP,
        switchLibraryConfig,
        loadLibrary
    };

    // 导出全局快捷函数
    global.switchLibraryConfig = switchLibraryConfig;
    global.loadLibrary = loadLibrary;

})(typeof window !== 'undefined' ? window : globalThis);
