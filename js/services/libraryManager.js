(function (global) {
    'use strict';

    function getResourceCore() {
        return global.ResourceCore || null;
    }

    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
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

        async saveLibraryConfiguration(name, key, examCount) {
            try {
                let configs = await global.storage.get('exam_index_configurations', []);
                if (!Array.isArray(configs)) {
                    configs = [];
                }
                const entry = { name, key, examCount, timestamp: Date.now() };
                const existingIndex = configs.findIndex((item) => item && item.key === key);
                if (existingIndex >= 0) {
                    configs[existingIndex] = entry;
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
    };

    global.switchLibraryConfig = switchLibraryConfig;
    global.loadLibrary = loadLibrary;
})(typeof window !== 'undefined' ? window : globalThis);
