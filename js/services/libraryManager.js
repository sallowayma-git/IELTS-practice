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
            this._libraryIntentGeneration = 0;
            this._libraryCommitIntentGeneration = 0;
            this._libraryCommitTail = Promise.resolve();
            this._libraryCommitPendingCount = 0;
            this._activeLibraryPreparationCounts = new Map();
            this._exclusiveLibraryMutationGeneration = 0;
            this._lastDurablyActivatedLibraryState = null;
        }

        beginLibraryIntent() {
            this._libraryIntentGeneration += 1;
            return this._libraryIntentGeneration;
        }

        canPrepareLibraryIntent(generation) {
            return Number.isInteger(generation)
                && generation > 0
                && generation === this._libraryIntentGeneration
                && generation >= this._libraryCommitIntentGeneration;
        }

        claimLibraryCommitIntent(generation) {
            if (!this.canPrepareLibraryIntent(generation)) return false;
            if (
                this._exclusiveLibraryMutationGeneration > 0
                && this._exclusiveLibraryMutationGeneration !== generation
            ) return false;
            this._libraryCommitIntentGeneration = generation;
            return true;
        }

        reserveLibraryCommitIntent(generation) {
            if (!this.canPrepareLibraryIntent(generation)) return false;
            if (
                this._exclusiveLibraryMutationGeneration > 0
                && this._exclusiveLibraryMutationGeneration !== generation
            ) {
                // A destructive mutation already owns the serialized commit slot.
                // Keep the newer intent eligible so it can queue behind that
                // mutation, but do not supersede the active owner mid-cleanup.
                return true;
            }
            return this.claimLibraryCommitIntent(generation);
        }

        isLibraryIntentCurrent(generation) {
            return generation === this._libraryCommitIntentGeneration;
        }

        rememberDurablyActivatedLibraryState(key, dataset) {
            const normalizedKey = typeof key === 'string' && key.trim() ? key.trim() : null;
            if (!normalizedKey || !Array.isArray(dataset) || dataset.length === 0) return;
            this._lastDurablyActivatedLibraryState = {
                key: normalizedKey,
                dataset: cloneArray(dataset)
            };
        }

        clearDurablyActivatedLibraryState(key) {
            const normalizedKey = typeof key === 'string' && key.trim() ? key.trim() : null;
            if (
                normalizedKey === null
                || this._lastDurablyActivatedLibraryState?.key === normalizedKey
            ) {
                this._lastDurablyActivatedLibraryState = null;
            }
        }

        beginActiveLibraryPreparation(generation) {
            const pending = this._activeLibraryPreparationCounts.get(generation) || 0;
            this._activeLibraryPreparationCounts.set(generation, pending + 1);
        }

        finishActiveLibraryPreparation(generation) {
            const pending = this._activeLibraryPreparationCounts.get(generation) || 0;
            if (pending <= 1) {
                this._activeLibraryPreparationCounts.delete(generation);
                return;
            }
            this._activeLibraryPreparationCounts.set(generation, pending - 1);
        }

        hasUncommittedActiveLibraryPreparation() {
            for (const [generation, pending] of this._activeLibraryPreparationCounts.entries()) {
                if (pending > 0 && generation !== this._libraryCommitIntentGeneration) {
                    return true;
                }
            }
            return false;
        }

        async runSerializedLibraryMutation(mutation) {
            const previousCommit = this._libraryCommitTail;
            let releaseCommit;
            this._libraryCommitTail = new Promise((resolve) => {
                releaseCommit = resolve;
            });
            this._libraryCommitPendingCount += 1;
            await previousCommit;
            try {
                return await mutation();
            } finally {
                this._libraryCommitPendingCount = Math.max(0, this._libraryCommitPendingCount - 1);
                releaseCommit();
            }
        }

        async runLibraryCommitForIntent(generation, commit) {
            return this.runSerializedLibraryMutation(async () => {
                if (
                    !this.isLibraryIntentCurrent(generation)
                    && !this.claimLibraryCommitIntent(generation)
                ) return false;
                if (!this.isLibraryIntentCurrent(generation)) return false;
                return commit();
            });
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
            if (!Array.isArray(index)) {
                return [];
            }

            const generatedReadingPdfAvailability = new Map();
            this.getDefaultReadingIndex().forEach((exam) => {
                if (
                    exam
                    && exam.sourceKind === 'generated-reading'
                    && typeof exam.id === 'string'
                    && exam.id
                ) {
                    generatedReadingPdfAvailability.set(exam.id, exam.hasPdf === true);
                }
            });

            return index.map((exam) => {
                const normalized = this.absolutizeDefaultExamPath(exam);
                if (!normalized || typeof normalized !== 'object') {
                    return normalized;
                }

                if (
                    normalized.sourceKind === 'file-picker'
                    && !Object.prototype.hasOwnProperty.call(normalized, 'hasPdf')
                ) {
                    normalized.hasPdf = typeof normalized.pdfFilename === 'string'
                        && normalized.pdfFilename.trim().length > 0;
                }

                if (
                    normalized.sourceKind === 'generated-reading'
                    && typeof normalized.id === 'string'
                    && generatedReadingPdfAvailability.has(normalized.id)
                ) {
                    normalized.hasPdf = generatedReadingPdfAvailability.get(normalized.id);
                }

                return normalized;
            });
        }

        async normalizeIndexForCustomConfigReady(index) {
            const rows = Array.isArray(index) ? index : [];
            const needsCanonicalReadingManifest = rows.some((exam) => {
                return exam && exam.sourceKind === 'generated-reading';
            });
            if (needsCanonicalReadingManifest && typeof global.ensureExamDataScripts === 'function') {
                await global.ensureExamDataScripts();
            }
            return this.normalizeIndexForCustomConfig(rows);
        }

        finishLibraryLoading(startTime, index, intentGeneration) {
            const isCurrent = () => intentGeneration === undefined
                || this.isLibraryIntentCurrent(intentGeneration);
            if (!isCurrent()) return 0;
            const loadTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() - startTime : 0;
            if (typeof global.reportBootStage === 'function') {
                try { global.reportBootStage('题库装载完成', 75); } catch (_) { }
            }
            if (!isCurrent()) return loadTime;
            try { global.updateOverview && global.updateOverview(index); } catch (_) { }
            if (!isCurrent()) return loadTime;
            try { refreshListeningAvailabilityUI(index); } catch (_) { }
            if (!isCurrent()) return loadTime;
            try {
                global.dispatchEvent(new CustomEvent('examIndexLoaded', { detail: { index: cloneArray(index) } }));
            } catch (_) { }
            if (!isCurrent()) return loadTime;
            if (typeof global.startPracticeRecordsSyncInBackground === 'function') {
                try {
                    global.startPracticeRecordsSyncInBackground('library-loaded', { forceRender: true });
                } catch (_) { }
            }
            return loadTime;
        }

        async resolveDefaultIndex() {
            await global.AppData.ready;
            if (global.ensureExamDataScripts) {
                try { await global.ensureExamDataScripts(); } catch (_) { }
            }
            return this.normalizeIndexForCustomConfig(
                this.getDefaultReadingIndex().concat(this.resolveDefaultTypeIndex('listening'))
            ).map((exam) => ({ ...exam, libraryConfigurationId: null }));
        }

        async resolveIndexForConfiguration(configurationId) {
            await global.AppData.ready;
            const id = typeof configurationId === 'string' && configurationId.trim()
                ? configurationId.trim()
                : null;
            if (id === null) return this.resolveDefaultIndex();
            return (await this.normalizeIndexForCustomConfigReady(await global.AppData.library.getIndex(id)))
                .map((exam) => ({ ...exam, libraryConfigurationId: id }));
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
            return this.loadActiveLibraryForIntent(forceReload, this.beginLibraryIntent());
        }

        async loadActiveLibraryForIntent(forceReload, intentGeneration) {
            this.beginActiveLibraryPreparation(intentGeneration);
            try {
                return await this.prepareActiveLibraryForIntent(forceReload, intentGeneration);
            } finally {
                this.finishActiveLibraryPreparation(intentGeneration);
            }
        }

        async prepareActiveLibraryForIntent(forceReload, intentGeneration) {
            const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (typeof global.reportBootStage === 'function') {
                global.reportBootStage('加载题库索引', 35);
            }
            if (!this.canPrepareLibraryIntent(intentGeneration)) return [];

            const priorCommit = this._libraryCommitTail;
            await priorCommit;
            if (!this.canPrepareLibraryIntent(intentGeneration)) return [];

            let rawKey;
            try {
                rawKey = await this.getActiveLibraryConfigurationKey();
            } catch (error) {
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                console.warn('[LibraryManager] 读取活动题库失败:', error);
                return [];
            }
            if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
            const activeConfigKey = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
            const isDefaultConfig = activeConfigKey === null;

            let cachedData = null;
            try {
                if (!isDefaultConfig) {
                    cachedData = await global.AppData.library.getIndex(activeConfigKey);
                }
            } catch (error) {
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                console.warn('[LibraryManager] 读取题库缓存失败:', error);
                return [];
            }
            if (!this.canPrepareLibraryIntent(intentGeneration)) return [];

            if (!isDefaultConfig && Array.isArray(cachedData) && cachedData.length > 0) {
                let updatedIndex;
                let currentPathMap;
                try {
                    updatedIndex = (await this.normalizeIndexForCustomConfigReady(cachedData))
                        .map((exam) => ({ ...exam, libraryConfigurationId: activeConfigKey }));
                    if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                    currentPathMap = await this.loadPathMapForConfiguration(activeConfigKey);
                } catch (error) {
                    if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                    console.error('[LibraryManager] 准备活动题库失败:', error);
                    return [];
                }
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                if (typeof global.assignExamSequenceNumbers === 'function') global.assignExamSequenceNumbers(updatedIndex);
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                const preparedPathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                    ? this.resourceCore.derivePathMapFromIndex(
                        updatedIndex,
                        currentPathMap || this.DEFAULT_PATH_MAP
                    )
                    : currentPathMap;
                if (!this.reserveLibraryCommitIntent(intentGeneration)) return [];

                try {
                    const loaded = await this.runLibraryCommitForIntent(intentGeneration, async () => {
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        const pathMap = await this.savePathMapForConfiguration(activeConfigKey, updatedIndex, {
                            overrideMap: preparedPathMap,
                            setActive: false
                        });
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        this.setActivePathMap(pathMap || preparedPathMap);
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        this.finishLibraryLoading(startTime, updatedIndex, intentGeneration);
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        this.rememberDurablyActivatedLibraryState(activeConfigKey, updatedIndex);
                        return updatedIndex;
                    });
                    return Array.isArray(loaded) ? loaded : [];
                } catch (error) {
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    console.error('[LibraryManager] 提交活动题库加载失败:', error);
                    return [];
                }
            }

            const shouldWarnAboutEmptyCustom = !isDefaultConfig;
            let defaultCommitClaimed = false;
            if (!isDefaultConfig) {
                // Continue through the built-in manifest path.  Returning the empty
                // custom index here used to dispatch examIndexLoaded([]) and left an
                // otherwise valid generated Reading manifest invisible.
            }

            try {
                if (global.ensureExamDataScripts) {
                    try {
                        await global.ensureExamDataScripts();
                    } catch (loadError) {
                        if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                        console.warn('[LibraryManager] 默认题库脚本部分加载失败，继续解析已可用数据:', loadError);
                    }
                }
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];

                const readingExams = this.getDefaultReadingIndex();
                const listeningExams = this.resolveDefaultTypeIndex('listening');

                if (!readingExams.length && !listeningExams.length) {
                    console.warn('[LibraryManager] 未检测到默认题库脚本中的题源数据');
                    return [];
                }

                const combined = cloneArray(readingExams).concat(listeningExams)
                    .map((exam) => ({ ...exam, libraryConfigurationId: null }));
                if (typeof global.assignExamSequenceNumbers === 'function') {
                    global.assignExamSequenceNumbers(combined);
                }
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
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
                const overrideMap = this.buildOverridePathMap(metadata, this.DEFAULT_PATH_MAP);
                if (!this.canPrepareLibraryIntent(intentGeneration)) return [];
                if (!this.reserveLibraryCommitIntent(intentGeneration)) return [];
                defaultCommitClaimed = true;

                const loaded = await this.runLibraryCommitForIntent(intentGeneration, async () => {
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    if (shouldWarnAboutEmptyCustom) {
                        await this.setActiveLibraryConfiguration(null);
                        this.clearDurablyActivatedLibraryState();
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        if (typeof global.showMessage === 'function') {
                            global.showMessage('当前题库配置没有数据，已自动切换至默认题库。', 'warning');
                        }
                    }
                    if (typeof global.reportBootStage === 'function') {
                        global.reportBootStage('解析题库数据', 55);
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    try { global.examIndexMetadata = metadata; } catch (_) { }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    this.setActivePathMap(overrideMap);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    this.clearDurablyActivatedLibraryState();
                    this.finishLibraryLoading(startTime, updatedIndex, intentGeneration);
                    return this.isLibraryIntentCurrent(intentGeneration) ? updatedIndex : [];
                });
                return Array.isArray(loaded) ? loaded : [];
            } catch (error) {
                const stillOwnsIntent = defaultCommitClaimed
                    ? this.isLibraryIntentCurrent(intentGeneration)
                    : this.canPrepareLibraryIntent(intentGeneration);
                if (!stillOwnsIntent) return [];
                if (defaultCommitClaimed) {
                    try {
                        await this.reconcileActiveLibraryAfterFailedCommit(intentGeneration);
                    } catch (recoveryError) {
                        console.warn('[LibraryManager] 失败加载后的活动题库恢复失败', recoveryError);
                    }
                }
                console.error('[LibraryManager] 加载默认题库失败:', error);
                if (typeof global.showMessage === 'function') {
                    global.showMessage('题库刷新失败: ' + (error && error.message ? error.message : error), 'error');
                }
                return [];
            }
        }

        async loadDefaultLibraryForIntent(intentGeneration, options = {}) {
            const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const canContinuePreparing = () => options.intentAlreadyClaimed === true
                ? this.isLibraryIntentCurrent(intentGeneration)
                : this.canPrepareLibraryIntent(intentGeneration);
            let defaultIndex;
            try {
                defaultIndex = await this.resolveDefaultIndex();
            } catch (error) {
                if (!canContinuePreparing()) return [];
                console.error('[LibraryManager] 准备默认题库失败:', error);
                return [];
            }
            if (!canContinuePreparing() || defaultIndex.length === 0) return [];
            if (typeof global.assignExamSequenceNumbers === 'function') {
                global.assignExamSequenceNumbers(defaultIndex);
            }
            if (!canContinuePreparing()) return [];

            const readingExams = defaultIndex.filter((exam) => exam && exam.type === 'reading');
            const listeningExams = defaultIndex.filter((exam) => exam && exam.type === 'listening');
            const metadata = {
                source: 'default-script',
                generatedAt: Date.now(),
                counts: {
                    total: defaultIndex.length,
                    reading: readingExams.length,
                    listening: listeningExams.length
                },
                pathRoot: {
                    reading: this.resolveScriptPathRoot('reading'),
                    listening: this.resolveScriptPathRoot('listening')
                }
            };
            const overrideMap = this.buildOverridePathMap(metadata, this.DEFAULT_PATH_MAP);
            if (
                options.intentAlreadyClaimed !== true
                && !this.reserveLibraryCommitIntent(intentGeneration)
            ) return [];

            try {
                const loaded = await this.runLibraryCommitForIntent(intentGeneration, async () => {
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    await this.setActiveLibraryConfiguration(null);
                    this.clearDurablyActivatedLibraryState();
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    try { global.examIndexMetadata = metadata; } catch (_) { }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    this.setActivePathMap(overrideMap);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                    if (options.asConfigurationSwitch === true) {
                        refreshListeningAvailabilityUI(defaultIndex);
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        if (typeof global.setBrowseFilterState === 'function') {
                            global.setBrowseFilterState('all', 'all');
                        }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        if (typeof global.setFilteredExamsState === 'function') {
                            global.setFilteredExamsState([]);
                        }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        try { global.updateSystemInfo && global.updateSystemInfo(defaultIndex); } catch (_) { }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        try { global.updateOverview && global.updateOverview(defaultIndex); } catch (_) { }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        try { global.loadExamList && global.loadExamList(defaultIndex); } catch (_) { }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        try {
                            global.dispatchEvent(new CustomEvent('examIndexLoaded', {
                                detail: { key: null, index: cloneArray(defaultIndex) }
                            }));
                        } catch (error) {
                            console.warn('[LibraryManager] 题库切换事件派发失败', error);
                        }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        if (typeof global.startPracticeRecordsSyncInBackground === 'function') {
                            global.startPracticeRecordsSyncInBackground('library-loaded', { forceRender: true });
                        }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return [];
                        if (!options.skipConfigRefresh) {
                            this.scheduleLibraryConfigRefresh(null, intentGeneration);
                        }
                    } else {
                        this.finishLibraryLoading(startTime, defaultIndex, intentGeneration);
                    }
                    return this.isLibraryIntentCurrent(intentGeneration) ? defaultIndex : [];
                });
                return Array.isArray(loaded) ? loaded : [];
            } catch (error) {
                if (
                    options.recoverOnCommitFailure !== false
                    && this.isLibraryIntentCurrent(intentGeneration)
                ) {
                    try {
                        await this.reconcileActiveLibraryAfterFailedCommit(intentGeneration);
                    } catch (recoveryError) {
                        console.warn('[LibraryManager] 默认题库提交失败后的恢复失败', recoveryError);
                    }
                }
                console.error('[LibraryManager] 激活默认题库失败:', error);
                return [];
            }
        }

        async updateLibraryConfigurationMetadata(key, examCount, intentGeneration) {
            if (!key) {
                return true;
            }
            try {
                let configs = await this.getLibraryConfigurations();
                if (intentGeneration !== undefined && !this.isLibraryIntentCurrent(intentGeneration)) return false;
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
                    if (target) {
                        if (intentGeneration !== undefined && !this.isLibraryIntentCurrent(intentGeneration)) return false;
                        await global.AppData.library.updateConfiguration(target);
                        if (intentGeneration !== undefined && !this.isLibraryIntentCurrent(intentGeneration)) return false;
                    }
                }
                return true;
            } catch (error) {
                if (intentGeneration !== undefined && !this.isLibraryIntentCurrent(intentGeneration)) return false;
                console.warn('[LibraryManager] 无法刷新题库配置元数据', error);
                return false;
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
            return this.normalizeIndexForCustomConfigReady(currentIndex);
        }

        async buildImportBaseIndex(activeKey, type, mode) {
            const base = await this.resolveBaseLibraryIndex(activeKey);
            const otherType = type === 'reading' ? 'listening' : 'reading';
            let next = base.slice();

            const needsDefaultReading = !next.some((exam) => exam && exam.type === 'reading')
                && (otherType === 'reading' || (mode === 'incremental' && type === 'reading'));
            if (needsDefaultReading && typeof global.ensureExamDataScripts === 'function') {
                await global.ensureExamDataScripts();
            }

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

            const shouldActivate = options.activate !== false;
            const intentGeneration = shouldActivate ? this.beginLibraryIntent() : undefined;
            let activationEligible = shouldActivate;
            const refreshActivationEligibility = () => {
                if (
                    activationEligible
                    && !this.canPrepareLibraryIntent(intentGeneration)
                ) {
                    activationEligible = false;
                }
                return activationEligible;
            };

            const activeKey = await this.getActiveLibraryConfigurationKey();
            refreshActivationEligibility();
            const baseIndex = await this.buildImportBaseIndex(activeKey, type, mode);
            refreshActivationEligibility();
            const mergeResult = this.mergeLibraryEntries(baseIndex, additions, type, mode);
            const newIndex = this.normalizeIndexForCustomConfig(mergeResult.index);
            if (typeof global.assignExamSequenceNumbers === 'function') {
                try { global.assignExamSequenceNumbers(newIndex); } catch (_) { }
            }

            const key = options.key || await this.buildUniqueImportedConfigKey('library_import');
            refreshActivationEligibility();
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

            await global.AppData.library.import({
                id: key,
                configuration: Object.assign({}, metadata, { id: key, key, name, examCount: newIndex.length, timestamp: Date.now() }),
                index: newIndex,
                operationId: options.operationId
            });
            refreshActivationEligibility();

            let applied = true;
            if (shouldActivate) {
                applied = activationEligible
                    ? await this.applyLibraryConfigurationForIntent(
                        key,
                        newIndex,
                        { skipConfigRefresh: false },
                        intentGeneration
                    )
                    : false;
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

        async switchLibraryConfig(key) {
            const shouldResumeActivePreparation = this.hasUncommittedActiveLibraryPreparation();
            const intentGeneration = this.beginLibraryIntent();
            const nextKey = typeof key === 'string' && key.trim() ? key.trim() : null;
            let activeKey = null;
            let activeReadSucceeded = false;
            try {
                activeKey = await this.getActiveLibraryConfigurationKey();
                activeReadSucceeded = true;
                if (!this.canPrepareLibraryIntent(intentGeneration)) return false;
            } catch (error) {
                if (!this.canPrepareLibraryIntent(intentGeneration)) return false;
                console.warn('[LibraryConfig] 无法读取当前题库配置', error);
            }

            if (
                activeReadSucceeded
                && activeKey === nextKey
                && this._libraryCommitPendingCount === 0
            ) {
                if (shouldResumeActivePreparation) {
                    await this.loadActiveLibraryForIntent(true, intentGeneration);
                }
                if (this.canPrepareLibraryIntent(intentGeneration) && typeof global.showMessage === 'function') {
                    global.showMessage('当前题库已激活', 'info');
                }
                return false;
            }

            if (nextKey === null) {
                if (typeof global.showMessage === 'function') {
                    global.showMessage('正在切换题库配置...', 'info');
                }
                const loaded = await this.loadDefaultLibraryForIntent(intentGeneration, {
                    asConfigurationSwitch: true,
                    skipConfigRefresh: false
                });
                const applied = Array.isArray(loaded) && loaded.length > 0;
                if (applied && this.isLibraryIntentCurrent(intentGeneration) && typeof global.showMessage === 'function') {
                    global.showMessage('题库配置已切换', 'success');
                }
                return applied;
            }

            const dataset = await this.fetchLibraryDataset(nextKey);
            if (!this.canPrepareLibraryIntent(intentGeneration)) return false;
            if (!Array.isArray(dataset) || dataset.length === 0) {
                if (shouldResumeActivePreparation) {
                    await this.loadActiveLibraryForIntent(true, intentGeneration);
                }
                if (this.canPrepareLibraryIntent(intentGeneration) && typeof global.showMessage === 'function') {
                    global.showMessage('目标题库没有题目，请先加载该题库数据', 'warning');
                }
                return false;
            }

            if (typeof global.showMessage === 'function') {
                global.showMessage('正在切换题库配置...', 'info');
            }
            const applied = await this.applyLibraryConfigurationForIntent(
                nextKey,
                dataset,
                { skipConfigRefresh: false, requireStoredConfiguration: true },
                intentGeneration
            );
            if (applied && this.isLibraryIntentCurrent(intentGeneration) && typeof global.showMessage === 'function') {
                global.showMessage('题库配置已切换', 'success');
            }
            return applied;
        }

        scheduleLibraryConfigRefresh(key, intentGeneration) {
            if (typeof global.renderLibraryConfigList !== 'function') return;
            setTimeout(async () => {
                if (!this.isLibraryIntentCurrent(intentGeneration)) return;
                try {
                    await global.renderLibraryConfigList({
                        allowDelete: true,
                        activeKey: key,
                        isCurrent: () => this.isLibraryIntentCurrent(intentGeneration)
                    });
                } catch (error) {
                    console.warn('[LibraryManager] 重渲染题库配置列表失败', error);
                }
            }, 0);
        }

        async applyLibraryConfiguration(key, dataset, options = {}) {
            return this.applyLibraryConfigurationForIntent(
                key,
                dataset,
                options,
                this.beginLibraryIntent()
            );
        }

        async reconcileActiveLibraryAfterFailedCommit(intentGeneration, preparedState = {}) {
            if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
            let activeKey = null;
            try {
                activeKey = await this.getActiveLibraryConfigurationKey();
            } catch (error) {
                console.warn('[LibraryManager] 无法读取失败提交后的活动题库', error);
                return false;
            }
            if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
            const normalizedActiveKey = typeof activeKey === 'string' && activeKey.trim()
                ? activeKey.trim()
                : null;
            if (normalizedActiveKey === null) {
                return this.loadDefaultLibraryForIntent(intentGeneration, {
                    asConfigurationSwitch: true,
                    skipConfigRefresh: false,
                    intentAlreadyClaimed: true,
                    recoverOnCommitFailure: false
                });
            }
            const preparedKey = typeof preparedState.key === 'string' && preparedState.key.trim()
                ? preparedState.key.trim()
                : null;
            const hasMatchingPreparedDataset = preparedKey === normalizedActiveKey
                && Array.isArray(preparedState.dataset)
                && preparedState.dataset.length > 0;
            const durablePreparedState = this._lastDurablyActivatedLibraryState || {};
            const hasMatchingDurablePreparedDataset = durablePreparedState.key === normalizedActiveKey
                && Array.isArray(durablePreparedState.dataset)
                && durablePreparedState.dataset.length > 0;
            let dataset;
            if (
                hasMatchingPreparedDataset
                && preparedState.activationCompleted === true
            ) {
                dataset = cloneArray(preparedState.dataset);
            } else if (hasMatchingDurablePreparedDataset) {
                dataset = cloneArray(durablePreparedState.dataset);
            } else {
                try {
                    dataset = await this.fetchLibraryDataset(normalizedActiveKey);
                } catch (error) {
                    console.warn('[LibraryManager] 无法读取失败提交前的活动题库数据', error);
                    return false;
                }
            }
            if (
                !this.isLibraryIntentCurrent(intentGeneration)
                || !Array.isArray(dataset)
                || dataset.length === 0
            ) return false;
            return this.applyLibraryConfigurationForIntent(
                normalizedActiveKey,
                dataset,
                {
                    skipConfigRefresh: false,
                    intentAlreadyClaimed: true,
                    recoverOnCommitFailure: false
                },
                intentGeneration
            );
        }

        async applyLibraryConfigurationForIntent(key, dataset, options = {}, intentGeneration) {
            const canContinuePreparing = () => options.intentAlreadyClaimed === true
                ? this.isLibraryIntentCurrent(intentGeneration)
                : this.canPrepareLibraryIntent(intentGeneration);
            const configurationId = typeof key === 'string' && key.trim() ? key.trim() : null;
            let rawExams = dataset;
            if (!Array.isArray(rawExams)) {
                rawExams = await this.fetchLibraryDataset(key);
                if (!canContinuePreparing()) return false;
            }
            const exams = (await this.normalizeIndexForCustomConfigReady(rawExams))
                .map((exam) => ({ ...exam, libraryConfigurationId: configurationId }));
            if (!canContinuePreparing()) return false;
            if (!Array.isArray(exams) || exams.length === 0) {
                if (typeof global.showMessage === 'function') {
                    global.showMessage('目标题库没有题目，请先加载数据', 'warning');
                }
                return false;
            }

            const currentPathMap = await this.loadPathMapForConfiguration(key);
            if (!canContinuePreparing()) return false;
            const pathMap = this.resourceCore && typeof this.resourceCore.derivePathMapFromIndex === 'function'
                ? this.resourceCore.derivePathMapFromIndex(exams, currentPathMap || this.DEFAULT_PATH_MAP)
                : (currentPathMap || null);
            if (
                options.intentAlreadyClaimed !== true
                && !this.reserveLibraryCommitIntent(intentGeneration)
            ) return false;

            let activationCompleted = false;
            try {
                return await this.runLibraryCommitForIntent(intentGeneration, async () => {
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    if (options.requireStoredConfiguration === true) {
                        let configurations;
                        let storedDataset;
                        try {
                            configurations = await this.getLibraryConfigurations();
                            if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                            storedDataset = await this.fetchLibraryDataset(configurationId);
                        } catch (error) {
                            if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                            console.warn('[LibraryManager] 无法重新验证目标题库配置', error);
                            return false;
                        }
                        if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                        const configurationExists = (Array.isArray(configurations) ? configurations : []).some((config) => {
                            if (typeof config === 'string') return config.trim() === configurationId;
                            if (!config || typeof config !== 'object') return false;
                            const storedKey = typeof config.key === 'string' && config.key.trim()
                                ? config.key.trim()
                                : (typeof config.id === 'string' ? config.id.trim() : '');
                            return storedKey === configurationId;
                        });
                        if (!configurationExists || !Array.isArray(storedDataset) || storedDataset.length === 0) {
                            return false;
                        }
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    await this.setActiveLibraryConfiguration(key);
                    activationCompleted = true;
                    this.rememberDurablyActivatedLibraryState(configurationId, exams);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    await this.updateLibraryConfigurationMetadata(key, exams.length, intentGeneration);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    const savedPathMap = await this.savePathMapForConfiguration(key, exams, {
                        overrideMap: pathMap,
                        setActive: false
                    });
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;

                    this.setActivePathMap(savedPathMap || pathMap);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    refreshListeningAvailabilityUI(exams);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    if (typeof global.setBrowseFilterState === 'function') {
                        global.setBrowseFilterState('all', 'all');
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    if (typeof global.setFilteredExamsState === 'function') {
                        global.setFilteredExamsState([]);
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;

                    try { global.updateSystemInfo && global.updateSystemInfo(exams); } catch (_) { }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    try { global.updateOverview && global.updateOverview(exams); } catch (_) { }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    try { global.loadExamList && global.loadExamList(exams); } catch (_) { }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;

                    try {
                        global.dispatchEvent(new CustomEvent('examIndexLoaded', { detail: { key, index: cloneArray(exams) } }));
                    } catch (error) {
                        console.warn('[LibraryManager] 题库切换事件派发失败', error);
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;
                    if (typeof global.startPracticeRecordsSyncInBackground === 'function') {
                        global.startPracticeRecordsSyncInBackground('library-loaded', { forceRender: true });
                    }
                    if (!this.isLibraryIntentCurrent(intentGeneration)) return false;

                    if (!options.skipConfigRefresh) {
                        this.scheduleLibraryConfigRefresh(key, intentGeneration);
                    }

                    return true;
                });
            } catch (error) {
                if (
                    options.recoverOnCommitFailure !== false
                    && this.isLibraryIntentCurrent(intentGeneration)
                ) {
                    try {
                        await this.reconcileActiveLibraryAfterFailedCommit(intentGeneration, {
                            key: configurationId,
                            dataset: exams,
                            activationCompleted
                        });
                    } catch (recoveryError) {
                        console.warn('[LibraryManager] 失败提交后的活动题库恢复失败', recoveryError);
                    }
                }
                throw error;
            }
        }

        async deleteLibraryConfiguration(key) {
            const configKey = typeof key === 'string' ? key.trim() : '';
            if (!configKey) {
                return { deleted: false, reason: 'invalid-key' };
            }
            const intentGeneration = this.beginLibraryIntent();
            const result = await this.runSerializedLibraryMutation(async () => {
                if (!this.canPrepareLibraryIntent(intentGeneration)) {
                    return { deleted: false, reason: 'superseded' };
                }

                const activeKey = await this.getActiveLibraryConfigurationKey();
                if (!this.canPrepareLibraryIntent(intentGeneration)) {
                    return { deleted: false, reason: 'superseded' };
                }
                if (activeKey === configKey) {
                    return { deleted: false, reason: 'active-config' };
                }

                let configs = await this.getLibraryConfigurations();
                if (!this.canPrepareLibraryIntent(intentGeneration)) {
                    return { deleted: false, reason: 'superseded' };
                }
                configs = Array.isArray(configs) ? configs : [];
                let found = false;
                const nextConfigs = [];

                configs.forEach((config) => {
                    if (!config) return;
                    if (typeof config === 'string') {
                        const itemKey = config.trim();
                        if (!itemKey) return;
                        if (itemKey === configKey) {
                            found = true;
                            return;
                        }
                        nextConfigs.push(config);
                        return;
                    }

                    const itemKey = typeof config.key === 'string' && config.key.trim()
                        ? config.key.trim()
                        : (typeof config.id === 'string' ? config.id.trim() : '');
                    if (!itemKey) return;
                    if (itemKey === configKey) {
                        found = true;
                        return;
                    }
                    nextConfigs.push(config);
                });

                if (!found) {
                    return { deleted: false, reason: 'not-found' };
                }
                if (!this.claimLibraryCommitIntent(intentGeneration)) {
                    return { deleted: false, reason: 'superseded' };
                }

                this._exclusiveLibraryMutationGeneration = intentGeneration;
                try {
                    if (!this.isLibraryIntentCurrent(intentGeneration)) {
                        return { deleted: false, reason: 'superseded' };
                    }
                    await global.AppData.library.remove(configKey);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) {
                        return { deleted: false, reason: 'superseded' };
                    }
                    await this.deletePathMapForConfiguration(configKey);
                    if (!this.isLibraryIntentCurrent(intentGeneration)) {
                        return { deleted: false, reason: 'superseded' };
                    }
                    this.clearDurablyActivatedLibraryState(configKey);

                    return {
                        deleted: true,
                        key: configKey,
                        remaining: nextConfigs.length
                    };
                } finally {
                    if (this._exclusiveLibraryMutationGeneration === intentGeneration) {
                        this._exclusiveLibraryMutationGeneration = 0;
                    }
                }
            });
            return result && typeof result === 'object'
                ? result
                : { deleted: false, reason: 'superseded' };
        }

        async loadLibrary(keyOrForceReload) {
            const appliesNamedConfiguration = typeof keyOrForceReload === 'string'
                && keyOrForceReload !== 'default'
                && keyOrForceReload.length > 0;
            const intentGeneration = this.beginLibraryIntent();
            if (keyOrForceReload === 'default' || keyOrForceReload === null) {
                return this.loadDefaultLibraryForIntent(intentGeneration);
            }
            if (appliesNamedConfiguration) {
                return this.applyLibraryConfigurationForIntent(keyOrForceReload, undefined, {}, intentGeneration);
            }
            return this.loadActiveLibraryForIntent(!!keyOrForceReload, intentGeneration);
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
        return manager.switchLibraryConfig(nextKey);
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
