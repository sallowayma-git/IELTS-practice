(function (global) {
    'use strict';

    function getResourceCore() {
        return global.ResourceCore || null;
    }

    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
    }

    function normalizeSlashPath(value) {
        return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    }

    function hasProtocolPath(value) {
        return /^(?:[a-z]+:)?\/\//i.test(String(value || '')) || /^[A-Za-z]:\\/.test(String(value || ''));
    }

    function countIndexTypes(index) {
        const counts = { total: 0, reading: 0, listening: 0 };
        (Array.isArray(index) ? index : []).forEach((exam) => {
            if (!exam || typeof exam !== 'object') {
                return;
            }
            counts.total += 1;
            if (exam.type === 'reading') {
                counts.reading += 1;
            } else if (exam.type === 'listening') {
                counts.listening += 1;
            }
        });
        return counts;
    }

    function hasListeningEntries(index) {
        return (Array.isArray(index) ? index : []).some((exam) => {
            return exam && exam.type === 'listening';
        });
    }

    function hasBuiltInListeningManifest() {
        const manifest = global.__LISTENING_EXAM_MANIFEST__;
        return !!(
            manifest
            && typeof manifest === 'object'
            && Object.keys(manifest).length > 0
        );
    }

    function isBuiltInListeningLibraryAvailable() {
        if (global.__defaultListeningLibraryAvailable === true) {
            return true;
        }
        if (global.__defaultListeningLibraryAvailable === false) {
            return false;
        }
        return hasBuiltInListeningManifest()
            && Array.isArray(global.listeningExamIndex)
            && global.listeningExamIndex.length > 0;
    }

    function getActiveExamIndexSnapshot() {
        try {
            if (typeof global.getExamIndexState === 'function') {
                return global.getExamIndexState();
            }
        } catch (_) { }
        return Array.isArray(global.examIndex) ? global.examIndex : [];
    }

    function hasActiveListeningLibrary(index) {
        return hasListeningEntries(Array.isArray(index) ? index : getActiveExamIndexSnapshot());
    }

    function refreshListeningAvailabilityUI(index) {
        if (typeof global.refreshListeningAvailabilityUI === 'function') {
            try {
                global.refreshListeningAvailabilityUI(Array.isArray(index) ? index : getActiveExamIndexSnapshot());
                return;
            } catch (error) {
                console.warn('[LibraryManager] 刷新听力入口状态失败:', error);
            }
        }
        const listeningAvailable = hasActiveListeningLibrary(index);
        try {
            const container = global.document && global.document.getElementById('type-filter-buttons');
            const listeningButtons = container
                ? container.querySelectorAll('[data-filter-type="listening"], [data-filter-id="listening"]')
                : [];
            Array.prototype.forEach.call(listeningButtons, (button) => {
                button.hidden = !listeningAvailable;
                button.setAttribute('aria-hidden', listeningAvailable ? 'false' : 'true');
                if (!listeningAvailable) {
                    button.classList.remove('active');
                    button.setAttribute('aria-pressed', 'false');
                }
            });
        } catch (_) { }
    }

    class LibraryManager {
        constructor(options = {}) {
            this.options = options || {};
        }

        get resourceCore() {
            return getResourceCore();
        }

        get RAW_DEFAULT_PATH_MAP() {
            return this.resourceCore ? this.resourceCore.RAW_DEFAULT_PATH_MAP : null;
        }

        get DEFAULT_PATH_MAP() {
            return this.resourceCore ? this.resourceCore.DEFAULT_PATH_MAP : null;
        }

        normalizePathRoot(value) {
            return this.resourceCore && typeof this.resourceCore.normalizePathRoot === 'function'
                ? this.resourceCore.normalizePathRoot(value)
                : '';
        }

        mergeRootWithFallback(root, fallbackRoot) {
            return this.resourceCore && typeof this.resourceCore.mergeRootWithFallback === 'function'
                ? this.resourceCore.mergeRootWithFallback(root, fallbackRoot)
                : '';
        }

        buildOverridePathMap(metadata, fallback) {
            return this.resourceCore && typeof this.resourceCore.buildOverridePathMap === 'function'
                ? this.resourceCore.buildOverridePathMap(metadata, fallback)
                : (fallback || null);
        }

        getPathMap() {
            return this.resourceCore && typeof this.resourceCore.getPathMap === 'function'
                ? this.resourceCore.getPathMap()
                : null;
        }

        async loadPathMapForConfiguration(key) {
            return this.resourceCore && typeof this.resourceCore.loadPathMapForConfiguration === 'function'
                ? this.resourceCore.loadPathMapForConfiguration(key)
                : null;
        }

        async savePathMapForConfiguration(key, examIndex, options = {}) {
            return this.resourceCore && typeof this.resourceCore.savePathMapForConfiguration === 'function'
                ? this.resourceCore.savePathMapForConfiguration(key, examIndex, options)
                : null;
        }

        async deletePathMapForConfiguration(key) {
            return this.resourceCore && typeof this.resourceCore.deletePathMapForConfiguration === 'function'
                ? this.resourceCore.deletePathMapForConfiguration(key)
                : false;
        }

        setActivePathMap(map) {
            return this.resourceCore && typeof this.resourceCore.setActivePathMap === 'function'
                ? this.resourceCore.setActivePathMap(map)
                : (map || null);
        }

        async getActiveLibraryConfigurationKey() {
            return global.storage.get('active_exam_index_key', 'exam_index');
        }

        async setActiveLibraryConfiguration(key) {
            try {
                await global.storage.set('active_exam_index_key', key);
            } catch (error) {
                console.error('[LibraryManager] 设置活动题库配置失败:', error);
            }
        }

        async getLibraryConfigurations() {
            return global.storage.get('exam_index_configurations', []);
        }

        async saveLibraryConfiguration(name, key, examCount, metadata = {}) {
            try {
                let configs = await global.storage.get('exam_index_configurations', []);
                if (!Array.isArray(configs)) {
                    configs = [];
                }
                const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
                const entry = Object.assign({}, safeMetadata, { name, key, examCount, timestamp: Date.now() });
                const existingIndex = configs.findIndex((item) => item && item.key === key);
                if (existingIndex >= 0) {
                    configs[existingIndex] = Object.assign({}, configs[existingIndex], entry);
                } else {
                    configs.push(entry);
                }
                await global.storage.set('exam_index_configurations', configs);
            } catch (error) {
                console.error('[LibraryManager] 保存题库配置失败:', error);
            }
        }

        resolveScriptPathRoot(type) {
            const defaultRoot = type === 'reading'
                ? '睡着过项目组/2. 所有文章(11.20)[192篇]/'
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
                }
                if (type === 'listening') {
                    const rootMeta = global.listeningExamIndex && global.listeningExamIndex.pathRoot;
                    if (typeof rootMeta === 'string' && rootMeta.trim()) {
                        return rootMeta.trim();
                    }
                    const completeRoot = global.completeExamIndex && global.completeExamIndex.pathRoot;
                    if (completeRoot && typeof completeRoot === 'object' && typeof completeRoot.listening === 'string') {
                        return completeRoot.listening.trim();
                    }
                }
            } catch (_) { }
            return defaultRoot;
        }

        defaultPathRoot(type) {
            return type === 'reading'
                ? '睡着过项目组/2. 所有文章(11.20)[192篇]/'
                : 'ListeningPractice/';
        }

        absolutizeDefaultExamPath(exam) {
            if (!exam || typeof exam !== 'object') {
                return exam;
            }
            const next = Object.assign({}, exam);
            const type = next.type === 'reading' ? 'reading' : (next.type === 'listening' ? 'listening' : '');
            const path = normalizeSlashPath(next.path || '');
            if (!type || !path || hasProtocolPath(path) || next.sourceKind === 'file-picker') {
                return next;
            }

            const root = normalizeSlashPath(this.defaultPathRoot(type)).replace(/\/+$/, '');
            if (root && !path.toLowerCase().startsWith((root + '/').toLowerCase())) {
                if (type === 'listening' && /^P[1-4]\//i.test(path)) {
                    next.path = root + '/' + path;
                }
            }
            return next;
        }

        normalizeIndexForCustomConfig(index) {
            return Array.isArray(index)
                ? index.map((exam) => this.absolutizeDefaultExamPath(exam))
                : [];
        }

        finishLibraryLoading(startTime) {
            const loadTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() - startTime : 0;
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('题库装载完成', 75);
            }
            try { global.updateOverview && global.updateOverview(); } catch (_) { }
            refreshListeningAvailabilityUI();
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
            const activeConfigKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : 'exam_index';
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
                await this.savePathMapForConfiguration(activeConfigKey, updatedIndex, { setActive: true });
                this.finishLibraryLoading(startTime);
                return updatedIndex;
            }

            if (!isDefaultConfig) {
                const normalized = Array.isArray(cachedData) ? cachedData : [];
                if (global.setExamIndexState) {
                    global.setExamIndexState(normalized);
                }
                if (!normalized.length && typeof global.showMessage === 'function') {
                    global.showMessage('当前题库配置没有数据，请重新导入或切换至默认题库。', 'warning');
                }
                this.finishLibraryLoading(startTime);
                return normalized;
            }

            try {
                if (global.ensureExamDataScripts) {
                    try {
                        await global.ensureExamDataScripts();
                    } catch (loadError) {
                        console.warn('[LibraryManager] 默认题库脚本部分加载失败，继续解析已可用数据:', loadError);
                    }
                }
                if (typeof global.reportBootStage === 'function') {
                    global.reportBootStage('解析题库数据', 55);
                }

                const readingExams = Array.isArray(global.completeExamIndex)
                    ? global.completeExamIndex.map((exam) => Object.assign({}, exam, { type: 'reading' }))
                    : [];
                const listeningExams = this.resolveDefaultTypeIndex('listening');

                if (!readingExams.length && !listeningExams.length) {
                    if (global.setExamIndexState) {
                        global.setExamIndexState([]);
                    }
                    console.warn('[LibraryManager] 未检测到默认题库脚本中的题源数据');
                    this.finishLibraryLoading(startTime);
                    return [];
                }

                const combined = cloneArray(readingExams).concat(listeningExams);
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

                const overrideMap = this.buildOverridePathMap(metadata, this.DEFAULT_PATH_MAP);

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
                if (global.setExamIndexState) {
                    global.setExamIndexState([]);
                }
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
                const updated = configs.map((entry) => {
                    if (!entry) {
                        return entry;
                    }
                    if (typeof entry === 'string') {
                        if (entry.trim() === key) {
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
                    if (entry.key === key) {
                        mutated = true;
                        return Object.assign({}, entry, {
                            examCount,
                            timestamp: now
                        });
                    }
                    return entry;
                });
                if (mutated) {
                    await global.storage.set('exam_index_configurations', updated);
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

        resolveDefaultTypeIndex(type) {
            if (type === 'reading' && Array.isArray(global.completeExamIndex)) {
                return this.normalizeIndexForCustomConfig(
                    global.completeExamIndex.map((exam) => Object.assign({}, exam, { type: 'reading' }))
                );
            }
            if (
                type === 'listening'
                && isBuiltInListeningLibraryAvailable()
                && Array.isArray(global.listeningExamIndex)
            ) {
                return this.normalizeIndexForCustomConfig(
                    global.listeningExamIndex.map((exam) => Object.assign({}, exam, { type: 'listening' }))
                );
            }
            return [];
        }

        async resolveBaseLibraryIndex(activeKey) {
            let currentIndex = [];
            const key = typeof activeKey === 'string' && activeKey.trim() ? activeKey.trim() : 'exam_index';
            try {
                currentIndex = await this.fetchLibraryDataset(key);
            } catch (_) {
                currentIndex = [];
            }
            if (!Array.isArray(currentIndex) || currentIndex.length === 0) {
                try {
                    currentIndex = global.getExamIndexState ? global.getExamIndexState() : [];
                } catch (_) {
                    currentIndex = [];
                }
            }
            if ((!Array.isArray(currentIndex) || currentIndex.length === 0) && key === 'exam_index') {
                const reading = this.resolveDefaultTypeIndex('reading');
                const listening = this.resolveDefaultTypeIndex('listening');
                currentIndex = reading.concat(listening);
            }
            return this.normalizeIndexForCustomConfig(currentIndex);
        }

        async buildImportBaseIndex(activeKey, type, mode) {
            const base = await this.resolveBaseLibraryIndex(activeKey);
            const otherType = type === 'reading' ? 'listening' : 'reading';
            let next = base.slice();

            if (!next.some((exam) => exam && exam.type === otherType)) {
                next = next.concat(this.resolveDefaultTypeIndex(otherType));
            }

            if (mode === 'incremental' && !next.some((exam) => exam && exam.type === type)) {
                next = next.concat(this.resolveDefaultTypeIndex(type));
            }

            return this.normalizeIndexForCustomConfig(next);
        }

        async buildUniqueImportedConfigKey(prefix = 'exam_index') {
            let configs = [];
            try {
                configs = await this.getLibraryConfigurations();
            } catch (_) {
                configs = [];
            }
            const used = new Set((Array.isArray(configs) ? configs : []).map((config) => {
                if (typeof config === 'string') {
                    return config.trim();
                }
                return config && typeof config.key === 'string' ? config.key.trim() : '';
            }).filter(Boolean));
            const now = Date.now();
            for (let index = 0; index < 100; index += 1) {
                const key = index === 0 ? `${prefix}_${now}` : `${prefix}_${now}_${index}`;
                if (used.has(key)) {
                    continue;
                }
                try {
                    const stored = global.storage && typeof global.storage.get === 'function'
                        ? await global.storage.get(key)
                        : null;
                    if (!stored) {
                        return key;
                    }
                } catch (_) {
                    return key;
                }
            }
            return `${prefix}_${now}_${Math.random().toString(36).slice(2, 8)}`;
        }

        buildImportedConfigName(type, mode, label) {
            const typeLabel = type === 'reading' ? '阅读' : '听力';
            const modeLabel = mode === 'incremental' ? '增量' : '全量';
            const suffix = label && String(label).trim()
                ? ` · ${String(label).trim()}`
                : '';
            return `${typeLabel}${modeLabel}${suffix}-${new Date().toLocaleString()}`;
        }

        mergeLibraryEntries(currentIndex, additions, type, mode) {
            const discovery = global.LibraryDiscovery;
            if (discovery && typeof discovery.mergeExamIndexes === 'function') {
                return discovery.mergeExamIndexes(currentIndex, additions, { type, mode });
            }
            const base = Array.isArray(currentIndex) ? currentIndex.slice() : [];
            const incoming = Array.isArray(additions) ? additions.slice() : [];
            const targetBase = mode === 'full'
                ? base.filter((exam) => !exam || exam.type !== type)
                : base;
            const keys = new Map();
            const makeKey = (exam) => String(
                (exam && (exam.importKey || exam.sourcePath || [exam.type, exam.path, exam.filename, exam.title].join('|'))) || ''
            ).toLowerCase();
            targetBase.forEach((exam, index) => {
                const key = makeKey(exam);
                if (key) {
                    keys.set(key, index);
                }
            });
            let added = 0;
            let updated = 0;
            incoming.forEach((exam) => {
                const key = makeKey(exam);
                if (key && keys.has(key)) {
                    targetBase[keys.get(key)] = exam;
                    updated += 1;
                    return;
                }
                if (key) {
                    keys.set(key, targetBase.length);
                }
                targetBase.push(exam);
                added += 1;
            });
            return { index: targetBase, added, updated, skipped: Math.max(0, incoming.length - added - updated) };
        }

        async createImportedLibraryConfiguration(options = {}) {
            const type = options.type === 'reading' ? 'reading' : (options.type === 'listening' ? 'listening' : '');
            const mode = options.mode === 'incremental' ? 'incremental' : 'full';
            const additions = Array.isArray(options.additions) ? options.additions.slice() : [];
            if (!type) {
                throw new Error('未知的题库类型');
            }
            if (!additions.length) {
                throw new Error('没有可导入的题源');
            }

            const activeKey = await this.getActiveLibraryConfigurationKey();
            const baseIndex = await this.buildImportBaseIndex(activeKey, type, mode);
            const mergeResult = this.mergeLibraryEntries(baseIndex, additions, type, mode);
            const newIndex = this.normalizeIndexForCustomConfig(mergeResult.index);
            if (typeof global.assignExamSequenceNumbers === 'function') {
                try { global.assignExamSequenceNumbers(newIndex); } catch (_) { }
            }

            const key = options.key || await this.buildUniqueImportedConfigKey('exam_index');
            const name = options.name || this.buildImportedConfigName(type, mode, options.label);
            const counts = countIndexTypes(newIndex);
            const sourceReport = options.discoveryResult && options.discoveryResult.report
                ? options.discoveryResult.report
                : null;
            const metadata = {
                counts,
                sourceType: 'file-picker',
                lastImport: {
                    type,
                    mode,
                    accepted: additions.length,
                    rejected: sourceReport ? Number(sourceReport.rejected) || 0 : 0,
                    createdFrom: activeKey || 'exam_index',
                    label: options.label || '',
                    timestamp: Date.now()
                }
            };

            await global.storage.set(key, newIndex);
            const pathFallback = await this.loadPathMapForConfiguration(activeKey || 'exam_index');
            const pathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                ? this.resourceCore.derivePathMapFromIndex(newIndex, pathFallback || this.DEFAULT_PATH_MAP)
                : (pathFallback || null);
            await this.savePathMapForConfiguration(key, newIndex, {
                overrideMap: pathMap,
                setActive: options.activate !== false
            });
            await this.saveLibraryConfiguration(name, key, newIndex.length, metadata);

            let applied = true;
            if (options.activate !== false) {
                applied = await this.applyLibraryConfiguration(key, newIndex, { skipConfigRefresh: false });
            }

            return {
                key,
                name,
                index: newIndex,
                counts,
                merge: {
                    added: Number(mergeResult.added) || 0,
                    updated: Number(mergeResult.updated) || 0,
                    skipped: Number(mergeResult.skipped) || 0
                },
                activeKey,
                applied
            };
        }

        async applyLibraryConfiguration(key, dataset, options = {}) {
            const exams = Array.isArray(dataset) ? dataset.slice() : await this.fetchLibraryDataset(key);
            if (!Array.isArray(exams) || exams.length === 0) {
                if (typeof global.showMessage === 'function') {
                    global.showMessage('目标题库没有题目，请先加载数据', 'warning');
                }
                return false;
            }

            const currentPathMap = await this.loadPathMapForConfiguration(key);
            const pathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                ? this.resourceCore.derivePathMapFromIndex(exams, currentPathMap || this.DEFAULT_PATH_MAP)
                : (currentPathMap || null);
            this.setActivePathMap(pathMap);

            if (global.setExamIndexState) {
                global.setExamIndexState(exams);
            }
            refreshListeningAvailabilityUI(exams);
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
                global.dispatchEvent(new CustomEvent('examIndexLoaded', { detail: { key } }));
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

        async deleteLibraryConfiguration(key) {
            const configKey = typeof key === 'string' ? key.trim() : '';
            if (!configKey) {
                return { deleted: false, reason: 'invalid-key' };
            }
            if (configKey === 'exam_index') {
                return { deleted: false, reason: 'default-config' };
            }

            const activeKey = await this.getActiveLibraryConfigurationKey();
            if (activeKey === configKey) {
                return { deleted: false, reason: 'active-config' };
            }

            let configs = await this.getLibraryConfigurations();
            configs = Array.isArray(configs) ? configs : [];
            let found = false;
            const nextConfigs = [];

            configs.forEach((config) => {
                if (!config) {
                    return;
                }
                if (typeof config === 'string') {
                    const itemKey = config.trim();
                    if (!itemKey) {
                        return;
                    }
                    if (itemKey === configKey) {
                        found = true;
                        return;
                    }
                    nextConfigs.push(config);
                    return;
                }

                const itemKey = typeof config.key === 'string' ? config.key.trim() : '';
                if (!itemKey) {
                    return;
                }
                if (itemKey === configKey) {
                    found = true;
                    return;
                }
                nextConfigs.push(config);
            });

            if (!found) {
                return { deleted: false, reason: 'not-found' };
            }

            if (!global.storage || typeof global.storage.remove !== 'function') {
                return { deleted: false, reason: 'storage-remove-unavailable' };
            }
            await global.storage.remove(configKey);
            await this.deletePathMapForConfiguration(configKey);
            await global.storage.set('exam_index_configurations', nextConfigs);

            return {
                deleted: true,
                key: configKey,
                remaining: nextConfigs.length
            };
        }

        async loadLibrary(keyOrForceReload) {
            if (keyOrForceReload === 'default' || keyOrForceReload === 'exam_index') {
                return this.loadActiveLibrary(true);
            }
            if (typeof keyOrForceReload === 'string' && keyOrForceReload) {
                return this.applyLibraryConfiguration(keyOrForceReload);
            }
            return this.loadActiveLibrary(!!keyOrForceReload);
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
        const nextKey = key || await manager.getActiveLibraryConfigurationKey() || 'exam_index';
        return manager.applyLibraryConfiguration(nextKey);
    }

    async function loadLibrary(keyOrForceReload) {
        return getInstance().loadLibrary(keyOrForceReload);
    }

    global.LibraryManager = {
        getInstance,
        switchLibraryConfig,
        loadLibrary,
        get RAW_DEFAULT_PATH_MAP() {
            const manager = getInstance();
            return manager.RAW_DEFAULT_PATH_MAP;
        },
        get DEFAULT_PATH_MAP() {
            const manager = getInstance();
            return manager.DEFAULT_PATH_MAP;
        },
        normalizePathRoot(value) {
            return getInstance().normalizePathRoot(value);
        },
        mergeRootWithFallback(root, fallbackRoot) {
            return getInstance().mergeRootWithFallback(root, fallbackRoot);
        },
        buildOverridePathMap(metadata, fallback) {
            return getInstance().buildOverridePathMap(metadata, fallback);
        },
        hasListeningEntries(index) {
            return hasListeningEntries(index);
        },
        hasActiveListeningLibrary(index) {
            return hasActiveListeningLibrary(index);
        },
        isBuiltInListeningLibraryAvailable() {
            return isBuiltInListeningLibraryAvailable();
        },
        createImportedLibraryConfiguration(options) {
            return getInstance().createImportedLibraryConfiguration(options);
        },
        deleteLibraryConfiguration(key) {
            return getInstance().deleteLibraryConfiguration(key);
        },
    };

    global.hasActiveListeningLibrary = hasActiveListeningLibrary;
    global.isBuiltInListeningLibraryAvailable = isBuiltInListeningLibraryAvailable;
    global.switchLibraryConfig = switchLibraryConfig;
    global.loadLibrary = loadLibrary;
})(typeof window !== 'undefined' ? window : globalThis);
