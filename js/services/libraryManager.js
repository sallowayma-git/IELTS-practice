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

    function hasActiveListeningLibrary(index) {
        return hasListeningEntries(index);
    }

    function refreshListeningAvailabilityUI(index) {
        if (typeof global.refreshListeningAvailabilityUI === 'function') {
            try {
                global.refreshListeningAvailabilityUI(Array.isArray(index) ? index : []);
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
            return global.AppData.library.getActive();
        }

        async setActiveLibraryConfiguration(key) {
            return global.AppData.library.activate(typeof key === 'string' && key.trim() ? key.trim() : null);
        }

        async getLibraryConfigurations() {
            const configurations = await global.AppData.library.listConfigurations();
            return [{ name: '默认题库', key: '', id: null, builtIn: true, sourceType: 'built-in-manifest' }]
                .concat(Array.isArray(configurations) ? configurations : []);
        }

        async saveLibraryConfiguration(name, key, examCount, metadata = {}) {
            try {
                if (!key) return;
                const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
                await global.AppData.library.updateConfiguration(Object.assign({}, safeMetadata, {
                    id: key, key, name, examCount, timestamp: Date.now()
                }));
            } catch (error) {
                console.error('[LibraryManager] 保存题库配置失败:', error);
            }
        }

        getDefaultReadingIndex() {
            if (typeof global.getReadingExamIndex === 'function') {
                try {
                    const index = global.getReadingExamIndex();
                    if (Array.isArray(index)) {
                        return index.map((exam) => Object.assign({}, exam, { type: 'reading' }));
                    }
                } catch (error) {
                    console.warn('[LibraryManager] 读取阅读题库 manifest 失败:', error);
                }
            }
            if (Array.isArray(global.__READING_EXAM_INDEX__)) {
                return global.__READING_EXAM_INDEX__.map((exam) => Object.assign({}, exam, { type: 'reading' }));
            }
            return [];
        }

        getReadingPathRoot() {
            if (global.__READING_EXAM_PATH_ROOT__ && typeof global.__READING_EXAM_PATH_ROOT__ === 'object') {
                return global.__READING_EXAM_PATH_ROOT__;
            }
            if (typeof global.getReadingExamIndex === 'function' && global.getReadingExamIndex.pathRoot) {
                return global.getReadingExamIndex.pathRoot;
            }
            if (Array.isArray(global.__READING_EXAM_INDEX__) && global.__READING_EXAM_INDEX__.pathRoot) {
                return global.__READING_EXAM_INDEX__.pathRoot;
            }
            return null;
        }

        resolveScriptPathRoot(type) {
            const defaultRoot = type === 'reading'
                ? '睡着过项目组/2. 所有文章(11.20)[192篇]/'
                : 'ListeningPractice/';
            try {
                if (type === 'reading') {
                    const rootMeta = this.getReadingPathRoot();
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
                    const completeRoot = this.getReadingPathRoot();
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

        finishLibraryLoading(startTime, index) {
            const loadTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() - startTime : 0;
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('题库装载完成', 75);
            }
            try { global.updateOverview && global.updateOverview(index); } catch (_) { }
            refreshListeningAvailabilityUI(index);
            if (typeof global.startPracticeRecordsSyncInBackground === 'function') {
                global.startPracticeRecordsSyncInBackground('library-loaded', { forceRender: true });
            }
            try {
                global.dispatchEvent(new CustomEvent('examIndexLoaded', { detail: { index: cloneArray(index) } }));
            } catch (_) { }
            return loadTime;
        }

        async resolveDefaultIndex() {
            await global.AppData.ready;
            if (global.ensureExamDataScripts) {
                try { await global.ensureExamDataScripts(); } catch (_) { }
            }
            return this.normalizeIndexForCustomConfig(
                this.getDefaultReadingIndex().concat(this.resolveDefaultTypeIndex('listening'))
            );
        }

        async resolveIndexForConfiguration(configurationId) {
            await global.AppData.ready;
            const id = typeof configurationId === 'string' && configurationId.trim()
                ? configurationId.trim()
                : null;
            if (id === null) return this.resolveDefaultIndex();
            return this.normalizeIndexForCustomConfig(await global.AppData.library.getIndex(id));
        }

        getRecordLibraryProvenance(record) {
            const metadata = record && record.metadata && typeof record.metadata === 'object'
                ? record.metadata
                : {};
            if (Object.prototype.hasOwnProperty.call(metadata, 'libraryConfigurationId')) {
                const value = metadata.libraryConfigurationId;
                return { known: true, configurationId: typeof value === 'string' && value.trim() ? value.trim() : null };
            }
            if (record && Object.prototype.hasOwnProperty.call(record, 'libraryConfigurationId')) {
                const value = record.libraryConfigurationId;
                return { known: true, configurationId: typeof value === 'string' && value.trim() ? value.trim() : null };
            }
            return { known: false, configurationId: null };
        }

        async resolveIndexForRecord(record) {
            const provenance = this.getRecordLibraryProvenance(record);
            // 记录带明确题库来源时严格按来源解析——多题库场景下这能防止同一 examId
            // 被解析到别的库里的错误题目。
            if (provenance.known) {
                return this.resolveIndexForConfiguration(provenance.configurationId);
            }
            // 来源未知（几乎都是 v1 迁移来的旧记录：迁移时无法唯一确定来源就不会补
            // libraryConfigurationId）。条件降级：只有当用户没有任何自定义题库时，
            // examId 只可能对应默认库里的唯一题目，回退到当前活动题库解析是安全的
            // （即 v1 一贯行为，修复旧记录回顾/详情/导出全部失败）。一旦存在自定义
            // 题库，同一 examId 可能在多个库指向不同题目，无来源就无法安全判定，
            // 保守返回空索引，由调用方按“题目不可用”提示，绝不静默解析到错题。
            let customConfigCount = 0;
            try {
                const configurations = await global.AppData.library.listConfigurations();
                customConfigCount = Array.isArray(configurations) ? configurations.length : 0;
            } catch (_) {
                // 读配置失败时按保守处理，不回退。
                return [];
            }
            if (customConfigCount === 0) {
                return this.resolveActiveIndex();
            }
            return [];
        }

        async resolveExamForRecord(record) {
            if (!record || typeof record !== 'object') return null;
            const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
            const candidateIds = [record.examId, metadata.examId]
                .filter((value) => value !== null && value !== undefined && String(value).trim())
                .map((value) => String(value));
            if (!candidateIds.length) return null;
            const index = await this.resolveIndexForRecord(record);
            return index.find((exam) => exam && candidateIds.includes(String(exam.id))) || null;
        }

        async resolveActiveIndex() {
            await global.AppData.ready;
            const activeId = await global.AppData.library.getActive();
            return this.resolveIndexForConfiguration(activeId);
        }

        async loadActiveLibrary(forceReload = false) {
            const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('加载题库索引', 35);
            }

            const rawKey = await this.getActiveLibraryConfigurationKey();
            const activeConfigKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
            const isDefaultConfig = activeConfigKey === null;

            let cachedData = null;
            try {
                if (!isDefaultConfig) {
                    cachedData = await global.AppData.library.getIndex(activeConfigKey);
                } else {
                    await global.AppData.library.activate(null);
                }
            } catch (error) {
                console.warn('[LibraryManager] 读取题库缓存失败:', error);
            }

            if (!isDefaultConfig && Array.isArray(cachedData) && cachedData.length > 0) {
                const updatedIndex = this.normalizeIndexForCustomConfig(cachedData);
                if (typeof global.assignExamSequenceNumbers === 'function') global.assignExamSequenceNumbers(updatedIndex);
                await this.savePathMapForConfiguration(activeConfigKey, updatedIndex, { setActive: true });
                this.finishLibraryLoading(startTime, updatedIndex);
                return updatedIndex;
            }

            if (!isDefaultConfig) {
                const normalized = Array.isArray(cachedData) ? cachedData : [];
                if (!normalized.length && typeof global.showMessage === 'function') {
                    global.showMessage('当前题库配置没有数据，已自动切换至默认题库。', 'warning');
                }
                // Continue through the built-in manifest path.  Returning the empty
                // custom index here used to dispatch examIndexLoaded([]) and left an
                // otherwise valid generated Reading manifest invisible.
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

                const readingExams = this.getDefaultReadingIndex();
                const listeningExams = this.resolveDefaultTypeIndex('listening');

                if (!readingExams.length && !listeningExams.length) {
                    console.warn('[LibraryManager] 未检测到默认题库脚本中的题源数据');
                    this.finishLibraryLoading(startTime, []);
                    return [];
                }

                const combined = cloneArray(readingExams).concat(listeningExams);
                if (typeof global.assignExamSequenceNumbers === 'function') {
                    global.assignExamSequenceNumbers(combined);
                }
                const updatedIndex = combined;

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

                if (isDefaultConfig) {
                    await this.setActiveLibraryConfiguration(null);
                }
                this.setActivePathMap(overrideMap);

                this.finishLibraryLoading(startTime, updatedIndex);
                return updatedIndex;
            } catch (error) {
                console.error('[LibraryManager] 加载默认题库失败:', error);
                if (typeof global.showMessage === 'function') {
                    global.showMessage('题库刷新失败: ' + (error && error.message ? error.message : error), 'error');
                }
                this.finishLibraryLoading(startTime, []);
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
                                name: key,
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
                    const target = updated.find((entry) => entry && entry.key === key);
                    if (target) await global.AppData.library.updateConfiguration(target);
                }
            } catch (error) {
                console.warn('[LibraryManager] 无法刷新题库配置元数据', error);
            }
        }

        async fetchLibraryDataset(key) {
            try {
                const dataset = !key
                    ? this.resolveDefaultTypeIndex('reading').concat(this.resolveDefaultTypeIndex('listening'))
                    : await global.AppData.library.getIndex(key);
                return Array.isArray(dataset) ? dataset : [];
            } catch (error) {
                console.warn('[LibraryManager] 无法读取题库数据:', key, error);
                return [];
            }
        }

        resolveDefaultTypeIndex(type) {
            if (type === 'reading') {
                return this.normalizeIndexForCustomConfig(this.getDefaultReadingIndex());
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
            const key = typeof activeKey === 'string' && activeKey.trim() ? activeKey.trim() : null;
            try {
                currentIndex = await this.fetchLibraryDataset(key);
            } catch (_) {
                currentIndex = [];
            }
            if ((!Array.isArray(currentIndex) || currentIndex.length === 0) && key === null) {
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

        async buildUniqueImportedConfigKey(prefix = 'library_import') {
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
                const stored = await global.AppData.library.getIndex(key);
                if (!stored.length) return key;
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

            const key = options.key || await this.buildUniqueImportedConfigKey('library_import');
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
                    createdFrom: activeKey || null,
                    label: options.label || '',
                    timestamp: Date.now()
                }
            };

            const pathFallback = await this.loadPathMapForConfiguration(activeKey);
            const pathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                ? this.resourceCore.derivePathMapFromIndex(newIndex, pathFallback || this.DEFAULT_PATH_MAP)
                : (pathFallback || null);
            await global.AppData.library.import({
                id: key,
                configuration: Object.assign({}, metadata, { id: key, key, name, examCount: newIndex.length, timestamp: Date.now() }),
                index: newIndex,
                operationId: options.operationId
            });
            if (options.activate !== false) this.setActivePathMap(pathMap);

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

            await this.setActiveLibraryConfiguration(key);
            const currentPathMap = await this.loadPathMapForConfiguration(key);
            const pathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                ? this.resourceCore.derivePathMapFromIndex(exams, currentPathMap || this.DEFAULT_PATH_MAP)
                : (currentPathMap || null);
            this.setActivePathMap(pathMap);

            refreshListeningAvailabilityUI(exams);
            if (typeof global.setBrowseFilterState === 'function') {
                global.setBrowseFilterState('all', 'all');
            }
            if (typeof global.setFilteredExamsState === 'function') {
                global.setFilteredExamsState([]);
            }

            await this.updateLibraryConfigurationMetadata(key, exams.length);
            await this.savePathMapForConfiguration(key, exams, {
                overrideMap: pathMap,
                setActive: true
            });

            try { global.updateSystemInfo && global.updateSystemInfo(exams); } catch (_) { }
            try { global.updateOverview && global.updateOverview(exams); } catch (_) { }
            try { global.loadExamList && global.loadExamList(exams); } catch (_) { }

            try {
                global.dispatchEvent(new CustomEvent('examIndexLoaded', { detail: { key, index: cloneArray(exams) } }));
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

            await global.AppData.library.remove(configKey);
            await this.deletePathMapForConfiguration(configKey);

            return {
                deleted: true,
                key: configKey,
                remaining: nextConfigs.length
            };
        }

        async loadLibrary(keyOrForceReload) {
            if (keyOrForceReload === 'default' || keyOrForceReload === null) {
                await this.setActiveLibraryConfiguration(null);
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
        const nextKey = typeof key === 'string' && key.trim() ? key.trim() : null;
        return manager.applyLibraryConfiguration(nextKey);
    }

    async function loadLibrary(keyOrForceReload) {
        return getInstance().loadLibrary(keyOrForceReload);
    }

    async function resolveActiveLibraryIndex() {
        return getInstance().resolveActiveIndex();
    }

    async function resolveLibraryIndexForPracticeRecord(record) {
        return getInstance().resolveIndexForRecord(record);
    }

    async function resolveExamForPracticeRecord(record) {
        return getInstance().resolveExamForRecord(record);
    }

    global.LibraryManager = {
        getInstance,
        switchLibraryConfig,
        loadLibrary,
        resolveActiveIndex: resolveActiveLibraryIndex,
        resolveIndexForRecord: resolveLibraryIndexForPracticeRecord,
        resolveExamForRecord: resolveExamForPracticeRecord,
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
    global.resolveActiveLibraryIndex = resolveActiveLibraryIndex;
    global.resolveLibraryIndexForPracticeRecord = resolveLibraryIndexForPracticeRecord;
    global.resolveExamForPracticeRecord = resolveExamForPracticeRecord;
})(typeof window !== 'undefined' ? window : globalThis);
