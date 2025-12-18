/**
 * 本地存储工具类
 * 提供统一的数据存储和检索接口
 */
class StorageManager {
    constructor() {
        this.prefix = 'exam_system_';
        this.version = '1.0.0';
        this.localStorageAvailable = false;
        this.sessionStorageAvailable = false;
        this.useSessionStorageFallback = false;
        this.backendPreferenceKey = this.prefix + 'storage_backend';
        this.indexedDBBlocked = false;
        this.persistentKeys = new Set([
            'practice_records',
            'user_stats',
            'manual_backups',
            'backup_settings',
            'export_history',
            'import_history',
            'exam_index',
            'exam_index_configurations',
            'active_exam_index_key',
            'settings',
            'learning_goals'
        ]);
        this.ready = this.initializeStorage().catch(error => {
            console.error('[Storage] 初始化失败:', error);
            throw error;
        });
    }

    async waitForInitialization(skipReady = false) {
        if (!skipReady) {
            await this.ready;
        }
    }

    /**
     * 初始化存储系统
     */
    checkStorageAvailability(getter) {
        try {
            const store = getter();
            if (!store || typeof store.setItem !== 'function') {
                return false;
            }
            const testKey = this.prefix + 'storage_test_' + Math.random().toString(36).slice(2);
            store.setItem(testKey, '1');
            store.removeItem(testKey);
            return true;
        } catch (_) {
            return false;
        }
    }

    getStoredBackendPreference() {
        try {
            if (this.sessionStorageAvailable && sessionStorage.getItem(this.backendPreferenceKey)) {
                return sessionStorage.getItem(this.backendPreferenceKey);
            }
        } catch (_) { /* ignore */ }
        try {
            if (this.localStorageAvailable && localStorage.getItem(this.backendPreferenceKey)) {
                return localStorage.getItem(this.backendPreferenceKey);
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    setBackendPreference(mode) {
        try {
            if (mode === 'session' && this.sessionStorageAvailable) {
                sessionStorage.setItem(this.backendPreferenceKey, 'session');
                return;
            }
            if (mode === 'local' && this.localStorageAvailable) {
                localStorage.setItem(this.backendPreferenceKey, 'local');
                return;
            }
        } catch (_) { /* ignore */ }
    }

    clearBackendPreference() {
        try { if (this.sessionStorageAvailable) { sessionStorage.removeItem(this.backendPreferenceKey); } } catch (_) {}
        try { if (this.localStorageAvailable) { localStorage.removeItem(this.backendPreferenceKey); } } catch (_) {}
    }

    async initializeStorage() {
        console.log('[Storage] 开始初始化存储系统');
        try {
            this.localStorageAvailable = this.checkStorageAvailability(() => localStorage);
            this.sessionStorageAvailable = this.checkStorageAvailability(() => sessionStorage);
            if (this.localStorageAvailable) {
                console.log('[Storage] localStorage 可用，将使用 localStorage 作为主要存储');
                this.setBackendPreference('local');
            } else {
                console.warn('[Storage] localStorage 不可用');
            }
            if (this.sessionStorageAvailable) {
                console.log('[Storage] sessionStorage 可用，可作为退路');
            } else {
                console.warn('[Storage] sessionStorage 不可用');
            }

            const storedPreference = this.getStoredBackendPreference();
            if (storedPreference === 'session') {
                this.useSessionStorageFallback = true;
            }
            if (!this.localStorageAvailable && this.sessionStorageAvailable) {
                this.useSessionStorageFallback = true;
            }

            // 强制初始化 IndexedDB 以实现 Hybrid 模式，并在版本检查前确保 DB ready
            console.log('[Storage] 强制初始化 IndexedDB 以实现 Hybrid 模式');
            await this.initializeIndexedDBStorage();

            // 初始化版本信息
            const currentVersion = await this.get('system_version', null, { skipReady: true });
            console.log(`[Storage] 当前版本: ${currentVersion}, 目标版本: ${this.version}`);

            if (!currentVersion) {
                // 首次安装
                console.log('[Storage] 首次安装，初始化默认数据');
                await this.handleVersionUpgrade(null, { skipReady: true });
            } else if (currentVersion !== this.version) {
                // 版本升级
                console.log('[Storage] 版本升级，迁移数据');
                await this.handleVersionUpgrade(currentVersion, { skipReady: true });
            } else {
                console.log('[Storage] 版本匹配，跳过初始化');
            }

            // 添加恢复逻辑
            if ((await this.get('practice_records', null, { skipReady: true }) || []).length === 0 && !(await this.get('data_restored', null, { skipReady: true }))) {
                await this.restoreFromBackup({ skipReady: true });
                await this.set('data_restored', true, { skipReady: true });
            }

        } catch (error) {
            console.warn('[Storage] 初始化基本存储能力失败，尝试继续:', error);
            await this.initializeIndexedDBStorage();
        }
    }

    /**
     * 初始化IndexedDB存储
     */
    initializeIndexedDBStorage() {
        console.log('[Storage] 开始初始化 IndexedDB');
        if (this.indexedDBBlocked) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            try {
                // 检查IndexedDB支持
                if (!window.indexedDB) {
                    this.indexedDBBlocked = true;
                    if (this.localStorageAvailable || this.sessionStorageAvailable) {
                        console.warn('[Storage] IndexedDB 不支持，将使用现有本地/会话存储');
                        this.indexedDB = null;
                        resolve();
                        return;
                    }
                    console.warn('[Storage] IndexedDB 不支持且无本地存储，fallback 到内存存储');
                    this.fallbackStorage = new Map();
                    resolve();
                    return;
                }

                this.dbName = 'ExamSystemDB';
                this.dbVersion = 1;

                console.log(`[Storage] 打开 IndexedDB 数据库: ${this.dbName}, 版本: ${this.dbVersion}`);
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = (event) => {
                    console.error('[Storage] IndexedDB 打开失败:', event.target.error);
                    this.indexedDBBlocked = true;
                    if (this.localStorageAvailable || this.sessionStorageAvailable) {
                        console.warn('[Storage] 使用 local/sessionStorage 作为回退存储');
                        this.indexedDB = null;
                        resolve();
                        return;
                    }
                    this.fallbackStorage = new Map();
                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    console.log('[Storage] IndexedDB 升级事件触发，旧版本:', event.oldVersion, '新版本:', event.newVersion);
                    const db = event.target.result;

                    // 创建存储对象
                    if (!db.objectStoreNames.contains('keyValueStore')) {
                        console.log('[Storage] 创建 objectStore: keyValueStore');
                        const store = db.createObjectStore('keyValueStore', { keyPath: 'key' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                        console.log('[Storage] objectStore 创建成功');
                    } else {
                        console.log('[Storage] objectStore 已存在，跳过创建');
                    }
                };

                request.onsuccess = (event) => {
                    this.indexedDB = event.target.result;
                    this.indexedDBBlocked = false;
                    console.log('[Storage] IndexedDB 初始化成功，数据库:', this.indexedDB.name, '版本:', this.indexedDB.version);

                    // 迁移localStorage数据到IndexedDB
                    console.log('[Storage] 开始从 localStorage 迁移数据');
                    Promise.resolve()
                        .then(() => this.migrateFromLocalStorage())
                        .then(() => resolve())
                        .catch((migrationError) => {
                            console.warn('[Storage] 迁移过程中出现问题，但继续初始化:', migrationError);
                            resolve();
                        });
                };

            } catch (error) {
                console.error('[Storage] IndexedDB 初始化失败:', error);
                this.indexedDBBlocked = true;
                if (this.localStorageAvailable || this.sessionStorageAvailable) {
                    console.warn('[Storage] IndexedDB 初始化失败，将使用 local/sessionStorage');
                    this.indexedDB = null;
                    resolve();
                    return;
                }
                this.fallbackStorage = new Map();
                resolve();
            }
        });
    }

    /**
     * 确保 IndexedDB 已 ready
     */
    async ensureIndexedDBReady() {
        if (this.indexedDBBlocked) {
            return;
        }
        if (!this.indexedDB) {
            try {
                await this.initializeIndexedDBStorage();
            } catch (err) {
                this.indexedDBBlocked = true;
            }
        }
    }

    async tryPromoteToIndexedDB(serializedValue, key) {
        try {
            if (!this.indexedDB) {
                await this.initializeIndexedDBStorage();
            }
            if (this.indexedDB) {
                await this.setToIndexedDB(this.getKey(key), serializedValue);
                this.useSessionStorageFallback = false;
                this.setBackendPreference('local');
                this.dispatchStorageSync(key);
                return true;
            }
        } catch (e) {
            console.warn('[Storage] 提升到 IndexedDB 失败，继续使用退路:', e);
        }
        return false;
    }

    /**
     * 从localStorage迁移数据到IndexedDB
     */
    async migrateFromLocalStorage() {
        console.log('[Storage] 开始数据迁移');
        try {
            if (!this.indexedDB) {
                console.warn('[Storage] IndexedDB 不可用，跳过迁移');
                return;
            }

            const keys = Object.keys(localStorage);
            const migrationKeys = keys.filter(key => key.startsWith(this.prefix));
            console.log(`[Storage] 发现 ${migrationKeys.length} 条需要迁移的键`);

            if (migrationKeys.length === 0) {
                console.log('[Storage] 无数据需要迁移');
                return;
            }

            let migratedCount = 0;
            let failedCount = 0;

            for (const key of migrationKeys) {
                try {
                    const value = localStorage.getItem(key);
                    if (value) {
                        await this.setToIndexedDB(key, value);
                        localStorage.removeItem(key);
                        migratedCount++;
                        console.log(`[Storage] 成功迁移键: ${key}`);
                    }
                } catch (error) {
                    console.warn(`[Storage] 迁移数据失败: ${key}`, error);
                    failedCount++;
                }
            }

            console.log(`[Storage] 数据迁移完成: ${migratedCount} 成功, ${failedCount} 失败`);
        } catch (error) {
            console.error('[Storage] 数据迁移失败:', error);
        }
    }

    /**
     * 存储到IndexedDB
     */
    setToIndexedDB(key, value) {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error('IndexedDB not available'));
                return;
            }

            const transaction = this.indexedDB.transaction(['keyValueStore'], 'readwrite');
            const store = transaction.objectStore('keyValueStore');

            const data = {
                key: key,
                value: value,
                timestamp: Date.now()
            };

            const request = store.put(data);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 从IndexedDB获取数据
     */
    getFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error('IndexedDB not available'));
                return;
            }

            const transaction = this.indexedDB.transaction(['keyValueStore'], 'readonly');
            const store = transaction.objectStore('keyValueStore');
            const request = store.get(key);

            request.onsuccess = () => {
                if (request.result) {
                    resolve(request.result.value);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 从IndexedDB删除数据
     */
    removeFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error('IndexedDB not available'));
                return;
            }

            const transaction = this.indexedDB.transaction(['keyValueStore'], 'readwrite');
            const store = transaction.objectStore('keyValueStore');
            const request = store.delete(key);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 处理版本升级
     */
    async handleVersionUpgrade(oldVersion, options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        console.log(`Upgrading storage from ${oldVersion || 'unknown'} to ${this.version}`);

        // 在这里处理数据迁移逻辑
        if (!oldVersion) {
            // 首次安装，初始化默认数据
            await this.initializeDefaultData({ skipReady });
        }

        await this.set('system_version', this.version, { skipReady });

        // 执行遗留数据迁移（只运行一次）
        if (!await this.get('migration_completed', null, { skipReady })) {
            console.log('[Storage] 检测到未完成迁移，开始执行...');
            await this.migrateLegacyData({ skipReady });
        } else {
            console.log('[Storage] 迁移已完成，跳过');
        }
    }

    /**
     * 初始化默认数据
     */
    async initializeDefaultData(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        const defaultData = {
            user_stats: {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                lastPracticeDate: null,
                achievements: []
            },
            settings: {
                theme: 'light',
                notifications: true,
                autoSave: true,
                reminderTime: '19:00'
            },
            exam_index: null,
            practice_records: [],
            learning_goals: []
        };

        for (const [key, value] of Object.entries(defaultData)) {
            const existingValue = await this.get(key, null, { skipReady });
            if (existingValue === null || existingValue === undefined) {
                console.log(`[Storage] 初始化默认数据: ${key}`);
                await this.set(key, value, { skipReady });
            } else {
                console.log(`[Storage] 保留现有数据: ${key} (${Array.isArray(existingValue) ? existingValue.length + ' 项' : typeof existingValue})`);
            }
        }
    }

    /**
     * 设置存储命名空间
     */
    setNamespace(namespace) {
        if (typeof namespace === 'string' && namespace.trim()) {
            this.prefix = namespace.trim() + '_';
            console.log('[Storage] 命名空间已设置为:', this.prefix);
        } else {
            console.warn('[Storage] 无效的命名空间:', namespace);
        }
    }

    /**
     * 生成完整的存储键名
     */
    getKey(key) {
        return this.prefix + key;
    }

    /**
     * 压缩数据
     */
    compressData(data) {
        try {
            // 切记：不要压缩数组，避免把列表写坏
            if (Array.isArray(data)) {
                return data;
            }
            // 仅对体积较大的“对象记录”压缩
            if (data && typeof data === 'object') {
                const len = JSON.stringify(data).length;
                if (len > 1000) {
                    return this.compressObject(data);
                }
            }
            return data;
        } catch (error) {
            console.warn('[Storage] 数据压缩失败，使用原始数据:', error);
            return data;
        }
    }

    /**
     * 压缩对象数据
     */
    compressObject(obj) {
        // 只保留核心字段：用户答案、正确答案、正误、得分、正确率、答题时长、答题时间
        const coreFields = [
            'id', 'examId', 'title', 'category', 'frequency',
            'score', 'totalQuestions', 'accuracy', 'percentage', 'duration',
            'startTime', 'endTime', 'date', 'sessionId', 'timestamp',
            'dataSource', 'realData'
        ];

        const compressed = {};

        // 只保留核心字段
        coreFields.forEach(field => {
            if (obj.hasOwnProperty(field)) {
                compressed[field] = obj[field];
            }
        });

        // 压缩realData，只保留核心内容
        if (obj.realData) {
            compressed.realData = this.compressRealData(obj.realData);
        }

        return compressed;
    }

    /**
     * 合并记录数组，避免重复
     * 基于 id 去重，保留 timestamp 最新的
     */
    mergeRecords(current, legacy) {
        if (!Array.isArray(current)) current = [];
        if (!Array.isArray(legacy)) return current;

        const mergedMap = new Map();
        [...current, ...legacy].forEach(record => {
            if (record && record.id) {
                const existing = mergedMap.get(record.id);
                if (!existing || (record.timestamp > existing.timestamp)) {
                    mergedMap.set(record.id, record);
                }
            } else if (record && record.timestamp) {
                // 如果无 id，使用 timestamp 过滤
                mergedMap.set(record.timestamp, record);
            }
        });

        return Array.from(mergedMap.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    /**
     * 压缩realData数据
     */
    compressRealData(realData) {
        const compressed = {
            score: realData.score,
            totalQuestions: realData.totalQuestions,
            accuracy: realData.accuracy,
            percentage: realData.percentage,
            duration: realData.duration,
            answers: realData.answers || {},
            correctAnswers: realData.correctAnswers || {},
            isRealData: realData.isRealData,
            source: realData.source
        };

        // 压缩答案历史，只保留每个题目的最后一次答案
        if (realData.answerHistory) {
            const latestAnswers = {};
            Object.entries(realData.answerHistory).forEach(([questionId, history]) => {
                if (Array.isArray(history) && history.length > 0) {
                    latestAnswers[questionId] = history[history.length - 1];
                }
            });
            compressed.answerHistory = latestAnswers;
        }

        // 压缩交互记录，只保留最近50次
        if (realData.interactions && Array.isArray(realData.interactions)) {
            compressed.interactions = realData.interactions.slice(-50);
        }

        // 压缩详细的题目比较信息
        if (realData.answerComparison) {
            const simplifiedComparison = {};
            Object.entries(realData.answerComparison).forEach(([questionId, comparison]) => {
                simplifiedComparison[questionId] = {
                    userAnswer: comparison.userAnswer || '',
                    correctAnswer: comparison.correctAnswer || '',
                    isCorrect: comparison.isCorrect || false
                };
            });
            compressed.answerComparison = simplifiedComparison;
        }

        return compressed;
    }

    /**
     * 存储数据
     */
    async set(key, value, options = {}) {
        const { skipReady = false, skipScoreStorageRedirect = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            // practice_records 重定向到统一 ScoreStorage，避免产生双写
            if (key === 'practice_records' && !skipScoreStorageRedirect && !this._scoreStorageRedirecting) {
                const scoreStorage = window.app?.components?.practiceRecorder?.scoreStorage || window.scoreStorage;
                const storageKeys = scoreStorage?.storageKeys;
                const targetKey = (storageKeys && storageKeys.practiceRecords) || 'practice_records';
                if (scoreStorage && typeof scoreStorage.storage?.set === 'function') {
                    try {
                        this._scoreStorageRedirecting = true;
                        await scoreStorage.storage.set(targetKey, value);
                        this.dispatchStorageSync(key);
                        console.warn('[Storage] practice_records 已重定向至 ScoreStorage');
                        return true;
                    } catch (redirectError) {
                        console.warn('[Storage] 重定向到 ScoreStorage 失败，继续使用本地后端:', redirectError);
                    } finally {
                        this._scoreStorageRedirecting = false;
                    }
                } else {
                    console.warn('[Storage] practice_records 已废弃，且未检测到 ScoreStorage，将使用本地后端写入');
                }
            }

            await this.ensureIndexedDBReady();
            console.log(`[Storage] 开始设置键: ${key}`);
            // 压缩数据以减少存储空间
            const compressedValue = this.compressData(value);

            const serializedValue = JSON.stringify({
                data: compressedValue,
                timestamp: Date.now(),
                version: this.version,
                compressed: compressedValue !== value // 标记是否被压缩
            });

            const dataSize = serializedValue.length;
            console.log(`[Storage] 数据大小: ${dataSize} 字节`);

            if (this.fallbackStorage) {
                console.log('[Storage] 使用内存存储 (fallback)');
                this.fallbackStorage.set(this.getKey(key), serializedValue);
                this.dispatchStorageSync(key);
                return true;
            }

            const isPersistentKey = this.persistentKeys.has(key);
            let indexedSuccess = false;
            let localSuccess = false;

            // 1) IndexedDB 写入（主路径）
            if (this.indexedDB && !this.indexedDBBlocked) {
                try {
                    await this.setToIndexedDB(this.getKey(key), serializedValue);
                    indexedSuccess = true;
                    this.setBackendPreference('local');
                    try { console.log(`[Storage] set(${key}) => indexeddb (${dataSize} bytes)`); } catch (_) {}
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB存储失败，准备使用其他后端:', indexedDBError);
                }
            }

            // 2) localStorage 镜像/后备
            if (this.localStorageAvailable) {
                const quotaCheck = await this.checkStorageQuota(serializedValue.length, { skipReady });
                if (!quotaCheck) {
                    console.warn('[Storage] 存储空间不足，尝试清理旧数据');
                    await this.cleanupOldData({ skipReady });
                }
                try {
                    localStorage.setItem(this.getKey(key), serializedValue);
                    localSuccess = true;
                    this.setBackendPreference('local');
                    try { console.log(`[Storage] set(${key}) => localStorage (${dataSize} bytes)`); } catch (_) {}
                } catch (lsError) {
                    console.warn('[Storage] localStorage 存储失败:', lsError);
                }
            }

            // 对持久键，至少需要 IndexedDB 或 localStorage 成功
            if (isPersistentKey) {
                if (indexedSuccess || localSuccess) {
                    // 尽量确保双写
                    if (indexedSuccess && !localSuccess && this.localStorageAvailable) {
                        try { localStorage.setItem(this.getKey(key), serializedValue); } catch (_) {}
                    }
                    if (localSuccess && !indexedSuccess && this.indexedDB && !this.indexedDBBlocked) {
                        try { await this.setToIndexedDB(this.getKey(key), serializedValue); indexedSuccess = true; } catch (_) {}
                    }
                    this.dispatchStorageSync(key);
                    return true;
                }

                // 持久键写不下，显式报错，不再静默掉到易失存储
                throw new Error('No persistent storage backend available for key: ' + key);
            }

            // 非持久键：再尝试 sessionStorage
            if (!indexedSuccess && !localSuccess && this.sessionStorageAvailable) {
                try {
                    sessionStorage.setItem(this.getKey(key), serializedValue);
                    this.useSessionStorageFallback = true;
                    this.setBackendPreference('session');
                    this.dispatchStorageSync(key);
                    return true;
                } catch (ssError) {
                    console.warn('[Storage] sessionStorage 存储失败:', ssError);
                }
            }

            if (indexedSuccess || localSuccess) {
                this.dispatchStorageSync(key);
                return true;
            }

            // 兜底：仍然保证当前会话可用
            this.fallbackStorage = this.fallbackStorage || new Map();
            this.fallbackStorage.set(this.getKey(key), serializedValue);
            this.dispatchStorageSync(key);
            return true;
        } catch (error) {
            console.error('[Storage] set 操作错误:', error);
            this.handleStorageError(key, value, error);
            return false;
        }
    }

    /**
     * 向数组追加新项
     * @param {string} key - 存储键名
     * @param {*} value - 要追加的项
     * @returns {Promise<boolean>} 成功返回 true，失败返回 false
     */
    async append(key, value, options = {}) {
        const { skipReady = false, skipScoreStorageRedirect = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            // practice_records 重定向到统一 ScoreStorage，避免产生双写
            if (key === 'practice_records' && !skipScoreStorageRedirect && !this._scoreStorageRedirecting) {
                const scoreStorage = window.app?.components?.practiceRecorder?.scoreStorage || window.scoreStorage;
                const storageKeys = scoreStorage?.storageKeys;
                const targetKey = (storageKeys && storageKeys.practiceRecords) || 'practice_records';
                if (scoreStorage && typeof scoreStorage.storage?.get === 'function' && typeof scoreStorage.storage?.set === 'function') {
                    try {
                        this._scoreStorageRedirecting = true;
                        const existingRecords = await scoreStorage.storage.get(targetKey, []);
                        const normalized = Array.isArray(existingRecords) ? existingRecords : [];
                        normalized.push(value);
                        await scoreStorage.storage.set(targetKey, normalized);
                        this.dispatchStorageSync(key);
                        console.warn('[Storage] practice_records append 已重定向至 ScoreStorage');
                        return true;
                    } catch (redirectError) {
                        console.warn('[Storage] 重定向到 ScoreStorage append 失败，继续使用本地后端:', redirectError);
                    } finally {
                        this._scoreStorageRedirecting = false;
                    }
                } else {
                    console.warn('[Storage] practice_records 已废弃，且未检测到 ScoreStorage，将使用本地后端写入');
                }
            }

            await this.ensureIndexedDBReady();
            let existing = await this.get(key, null, { skipReady }) || [];
            if (!Array.isArray(existing)) {
                console.warn(`[Storage] Key ${key} 不是数组，创建新数组`);
                existing = [];
            }

            const newArray = [...existing, value];

            // 估计序列化后的大小
            const estimatedSize = JSON.stringify({
                data: newArray,
                timestamp: Date.now(),
                version: this.version,
                compressed: false
            }).length;

            let quotaOk = await this.checkStorageQuota(estimatedSize, { skipReady });
            if (!quotaOk) {
                console.warn('[Storage] 存储空间不足，尝试清理旧数据');
                await this.cleanupOldData({ skipReady });
                quotaOk = await this.checkStorageQuota(estimatedSize, { skipReady });
                if (!quotaOk) {
                    console.error('[Storage] 存储空间仍然不足，无法追加数据');
                    this.handleStorageQuotaExceeded(key, newArray);
                    return false;
                }
            }

            const success = await this.set(key, newArray, { skipReady });
            return success;
        } catch (error) {
            console.error('[Storage] Append error:', error);
            this.handleStorageError(key, value, error);
            return false;
        }
    }

    async get(key, defaultValue = null, options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            await this.ensureIndexedDBReady();
            let serializedValue;
            let source = null;

            if (this.fallbackStorage) {
                serializedValue = this.fallbackStorage.get(this.getKey(key));
                if (serializedValue) source = 'memory';
            }

            // 优先 IndexedDB
            if (!serializedValue && this.indexedDB && !this.indexedDBBlocked) {
                try {
                    serializedValue = await this.getFromIndexedDB(this.getKey(key));
                    if (serializedValue) source = 'indexeddb';
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB获取失败，尝试其他存储:', indexedDBError);
                }
            } else if (!serializedValue) {
                // 尝试初始化一次再读
                try {
                    await this.initializeIndexedDBStorage();
                    if (this.indexedDB) {
                        serializedValue = await this.getFromIndexedDB(this.getKey(key));
                        if (serializedValue) source = 'indexeddb';
                    }
                } catch (_) { /* ignore */ }
            }

            // 再尝试 localStorage
            if (!serializedValue && this.localStorageAvailable) {
                serializedValue = localStorage.getItem(this.getKey(key));
                if (serializedValue) source = 'localStorage';
            }

            // 再尝试 sessionStorage（仅非关键键）
            if (!serializedValue && this.sessionStorageAvailable && !this.persistentKeys.has(key)) {
                serializedValue = sessionStorage.getItem(this.getKey(key));
                if (serializedValue) source = 'sessionStorage';
            }

            if (!serializedValue) {
                return defaultValue;
            }

            const parsed = JSON.parse(serializedValue);
            try {
                console.log(`[Storage] get(${key}) => ${source || 'unknown'} (${Array.isArray(parsed?.data) ? parsed.data.length + ' items' : typeof parsed?.data})`);
            } catch (_) { /* ignore log errors */ }
            return parsed.data;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    }

    /**
     * 删除数据
     */
    async remove(key, options = {}) {
        const { skipReady = false, skipScoreStorageRedirect = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            await this.ensureIndexedDBReady();
            if (this.fallbackStorage) {
                this.fallbackStorage.delete(this.getKey(key));
                return true;
            }

            if (this.indexedDB) {
                try {
                    await this.removeFromIndexedDB(this.getKey(key));
                    return true;
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB删除失败，尝试其他存储:', indexedDBError);
                }
            }

            if (this.localStorageAvailable) {
                localStorage.removeItem(this.getKey(key));
                return true;
            }
            if (this.sessionStorageAvailable) {
                sessionStorage.removeItem(this.getKey(key));
                return true;
            }
            return false;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    }

    /**
     * 清空所有数据
     */
    async clear(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            await this.ensureIndexedDBReady();
            // 清空内存存储
            if (this.fallbackStorage) {
                this.fallbackStorage.clear();
            }
            if (this.useSessionStorageFallback || this.sessionStorageAvailable) {
                try {
                    const sessionKeys = Object.keys(sessionStorage).filter(key => key.startsWith(this.prefix));
                    sessionKeys.forEach(key => sessionStorage.removeItem(key));
                    if (sessionKeys.length > 0) {
                        console.log(`[Storage] sessionStorage已清空 ${sessionKeys.length} 条数据`);
                    }
                } catch (sessionErr) {
                    console.warn('[Storage] sessionStorage 清空失败:', sessionErr);
                }
            }

            // 清空IndexedDB中的所有数据
            if (this.indexedDB) {
                try {
                    const transaction = this.indexedDB.transaction(['keyValueStore'], 'readwrite');
                    const store = transaction.objectStore('keyValueStore');
                    const request = store.clear();

                    await new Promise((resolve, reject) => {
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    });
                    console.log('[Storage] IndexedDB数据已清空');
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB清空失败:', indexedDBError);
                }
            }

            // 清空localStorage
            if (this.localStorageAvailable) {
                const keys = Object.keys(localStorage);
                const appKeys = keys.filter(key => key.startsWith(this.prefix));
                appKeys.forEach(key => {
                    localStorage.removeItem(key);
                });
                console.log(`[Storage] localStorage已清空 ${appKeys.length} 条数据`);
            }
            this.clearBackendPreference();

            await this.initializeDefaultData();
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }

    /**
     * 检查存储配额是否充足
     */
    async checkStorageQuota(dataSize, options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            console.log(`[Storage] 检查存储配额，需要空间: ${dataSize} 字节`);
            if (this.fallbackStorage) {
                console.log('[Storage] 内存存储，无配额限制');
                return true; // 内存存储没有配额限制
            }

            const storageInfo = await this.getStorageInfo({ skipReady });
            if (!storageInfo) {
                console.warn('[Storage] 无法获取存储信息，拒绝操作');
                return false;
            }

            console.log(`[Storage] 当前存储类型: ${storageInfo.type}, 已用: ${storageInfo.used} 字节`);

            if (storageInfo.type === 'Hybrid' || storageInfo.type === 'IndexedDB') {
                // 混合存储或IndexedDB没有固定配额限制，但我们仍然检查数据大小
                const maxSize = 105 * 1024 * 1024; // 105MB限制 (localStorage 5MB + IndexedDB 100MB)
                const hasSpace = storageInfo.used + dataSize <= maxSize;
                console.log(`[Storage] Hybrid/IndexedDB 检查: 已用 ${storageInfo.used}, 需要 ${dataSize}, 最大 ${maxSize}, 结果: ${hasSpace}`);
                return hasSpace;
            }

            const currentUsage = storageInfo.used;
            const quota = 5 * 1024 * 1024; // 5MB
            const availableSpace = quota - currentUsage;

            // 预留20%的缓冲空间
            const bufferSpace = quota * 0.2;
            const safeAvailableSpace = availableSpace - bufferSpace;

            console.log(`[Storage] localStorage 检查: 当前使用 ${(currentUsage / 1024).toFixed(2)}KB, 总配额 ${quota / 1024}KB, 可用 ${(availableSpace / 1024).toFixed(2)}KB, 安全可用 ${(safeAvailableSpace / 1024).toFixed(2)}KB, 需要 ${(dataSize / 1024).toFixed(2)}KB`);

            const hasSpace = safeAvailableSpace >= dataSize;
            if (!hasSpace) {
                console.warn('[Storage] localStorage 空间不足');
            }
            return hasSpace;
        } catch (error) {
            console.error('[Storage] 配额检查错误:', error);
            return false;
        }
    }

    /**
     * 获取存储使用情况
     */
    async getStorageInfo(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            if (this.fallbackStorage) {
                return {
                    type: 'memory',
                    used: this.fallbackStorage.size,
                    available: Infinity
                };
            }

            if (this.indexedDB) {
                try {
                    // 获取所有存储的使用情况
                    const localStorageUsed = this.getLocalStorageUsage();
                    const indexedDBUsed = await this.getIndexedDBUsage();
                    const totalUsed = localStorageUsed + indexedDBUsed;

                    return {
                        type: 'Hybrid',
                        used: totalUsed,
                        available: Infinity, // 混合存储没有固定配额
                        breakdown: {
                            localStorage: localStorageUsed,
                            indexedDB: indexedDBUsed
                        }
                    };
                } catch (error) {
                    console.warn('[Storage] 获取混合存储使用情况失败:', error);
                    // 降级到localStorage
                }
            }

            let used = 0;
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith(this.prefix)) {
                    used += localStorage.getItem(key).length;
                }
            });

            return {
                type: 'localStorage',
                used: used,
                available: 5 * 1024 * 1024 - used // 假设5MB限制
            };
        } catch (error) {
            console.error('Storage info error:', error);
            return null;
        }
    }

    /**
     * 获取localStorage使用情况
     */
    getLocalStorageUsage() {
        try {
            let used = 0;
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith(this.prefix)) {
                    used += localStorage.getItem(key).length;
                }
            });
            return used;
        } catch (error) {
            console.error('Get localStorage usage error:', error);
            return 0;
        }
    }

    /**
     * 获取IndexedDB使用情况
     */
    getIndexedDBUsage() {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error('IndexedDB not available'));
                return;
            }

            const transaction = this.indexedDB.transaction(['keyValueStore'], 'readonly');
            const store = transaction.objectStore('keyValueStore');
            const request = store.getAll();

            request.onsuccess = () => {
                const items = request.result;
                let totalSize = 0;

                items.forEach(item => {
                    if (item.key.startsWith(this.prefix) && item.value) {
                        totalSize += item.value.length;
                    }
                });

                resolve(totalSize);
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清理旧数据
     */
    async cleanupOldData(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            console.log('[Storage] 开始清理旧数据...');

            const practiceRecords = await this.get('practice_records', [], { skipReady });
            if (practiceRecords.length > 0) {
                // 压缩练习记录数据，但保留所有记录
                const compressedRecords = practiceRecords.map(record => this.compressObject(record));
                await this.set('practice_records', compressedRecords, { skipReady });
                console.log(`[Storage] 已压缩练习记录数据，保留${practiceRecords.length}条记录`);
            }

            // 清理错误日志
            const errorLogs = await this.get('injection_errors', [], { skipReady });
            if (errorLogs.length > 20) {
                const logsToKeep = errorLogs.slice(-20); // 保留最近20条
                await this.set('injection_errors', logsToKeep, { skipReady });
                console.log(`[Storage] 已清理错误日志，从${errorLogs.length}条减少到${logsToKeep.length}条`);
            }

            const collectionErrors = await this.get('collection_errors', [], { skipReady });
            if (collectionErrors.length > 20) {
                const logsToKeep = collectionErrors.slice(-20);
                await this.set('collection_errors', logsToKeep, { skipReady });
                console.log(`[Storage] 已清理数据收集错误日志，从${collectionErrors.length}条减少到${logsToKeep.length}条`);
            }

            // 清理活动会话（保留最近的）
            const activeSessions = await this.get('active_sessions', [], { skipReady });
            const now = Date.now();
            const recentSessions = activeSessions.filter(session => {
                const sessionTime = new Date(session.startTime).getTime();
                const hoursDiff = (now - sessionTime) / (1000 * 60 * 60);
                return hoursDiff < 1; // 只保留1小时内的会话
            });

            if (recentSessions.length !== activeSessions.length) {
                await this.set('active_sessions', recentSessions, { skipReady });
                console.log(`[Storage] 已清理过期会话，从${activeSessions.length}个减少到${recentSessions.length}个`);
            }

        } catch (error) {
            console.error('[Storage] 清理旧数据失败:', error);
        }
    }

    /**
     * 迁移遗留数据到新命名空间
     * 只运行一次
     */
    async migrateLegacyData(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        console.log('[Storage] 开始迁移遗留数据');
        try {
            const legacyKeys = Object.keys(localStorage).filter(k =>
                k === 'practice_records' ||
                k === 'user_progress' ||
                k === 'scores' ||
                k.startsWith('old_prefix_')
            );

            if (legacyKeys.length === 0) {
                console.log('[Storage] 无遗留数据需要迁移');
                await this.set('migration_completed', true, { skipReady });
            } else {
                let migratedCount = 0;
                for (const oldKey of legacyKeys) {
                    try {
                        const legacyDataStr = localStorage.getItem(oldKey);
                        if (!legacyDataStr) continue;

                        let legacyData;
                        try {
                            legacyData = JSON.parse(legacyDataStr);
                        } catch (parseError) {
                            console.warn(`[Storage] 解析遗留数据失败: ${oldKey}`, parseError);
                            continue;
                        }

                        if (!Array.isArray(legacyData)) {
                            console.warn(`[Storage] 遗留数据非数组，跳过: ${oldKey}`);
                            continue;
                        }

                        if (legacyData.length === 0) {
                            console.log('[Storage] 旧数据为空，跳过迁移');
                            continue;
                        }

                        // 对应新键（去除 old_prefix_ 如果存在）
                        let newKey = oldKey.replace(/^old_prefix_/, '');
                        const current = await this.get(newKey, [], { skipReady });

                        // 对于关键键额外检查
                        const criticalKeys = ['practice_records'];
                        if (criticalKeys.includes(newKey) && legacyData.length === 0 && current.length > 0) {
                            console.log('[Storage] 发现空旧数据但新数据存在，跳过以避免覆盖');
                            continue;
                        }

                        const merged = this.mergeRecords(current, legacyData);
                        await this.set(newKey, merged, { skipReady });

                        // 删除旧键
                        localStorage.removeItem(oldKey);
                        migratedCount++;
                        console.log(`[Storage] 成功迁移并合并数据: ${oldKey} -> ${newKey} (${legacyData.length} 项)`);
                    } catch (migrateError) {
                        console.error(`[Storage] 迁移失败: ${oldKey}`, migrateError);
                    }
                }

                console.log(`[Storage] 数据迁移完成: ${migratedCount} 个键成功迁移`);
                await this.set('migration_completed', true, { skipReady });
            }

            // 迁移 MyMelody 遗留键（IndexedDB 中的旧键）
            if (!await this.get('my_melody_migration_completed', null, { skipReady })) {
                console.log('[Storage] 检查 MyMelody 遗留键迁移...');
                const oldMyMelodyKey = this.getKey('practice_records'); // 'exam_system_practice_records'
                try {
                    const legacyMyMelodyData = await this.getFromIndexedDB(oldMyMelodyKey);
                    if (legacyMyMelodyData) {
                        let legacyData;
                        try {
                            const parsed = JSON.parse(legacyMyMelodyData);
                            legacyData = parsed.data || parsed;
                        } catch (parseError) {
                            console.warn('[Storage] 解析 MyMelody 遗留数据失败', parseError);
                            await this.set('my_melody_migration_completed', true, { skipReady });
                            return;
                        }

                        if (!Array.isArray(legacyData)) {
                            console.warn('[Storage] MyMelody 遗留数据非数组，跳过');
                            await this.set('my_melody_migration_completed', true, { skipReady });
                            return;
                        }

                        if (legacyData.length === 0) {
                            console.log('[Storage] MyMelody 旧数据为空，跳过迁移');
                            await this.set('my_melody_migration_completed', true, { skipReady });
                            return;
                        }

                        const currentPracticeRecords = await this.get('practice_records', [], { skipReady });
                        const merged = this.mergeRecords(currentPracticeRecords, legacyData);
                        await this.set('practice_records', merged, { skipReady });

                        // 删除旧键
                        await this.removeFromIndexedDB(oldMyMelodyKey);
                        console.log(`[Storage] 成功迁移 MyMelody 数据: ${legacyData.length} 项合并到 practice_records`);
                    } else {
                        console.log('[Storage] 无 MyMelody 遗留数据需要迁移');
                    }
                    await this.set('my_melody_migration_completed', true, { skipReady });
                } catch (migrateError) {
                    console.error('[Storage] MyMelody 迁移失败:', migrateError);
                    await this.set('my_melody_migration_completed', true, { skipReady }); // 避免无限重试
                }
            } else {
                console.log('[Storage] MyMelody 迁移已完成，跳过');
            }

        } catch (error) {
            console.error('[Storage] 迁移遗留数据失败:', error);
            // 即使失败也设置标志，避免无限重试
            await this.set('migration_completed', true, { skipReady });
            await this.set('my_melody_migration_completed', true, { skipReady });
        }
    }

    /**
     * 从备份文件恢复数据
     */
    async restoreFromBackup(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        console.log('[Storage] 开始从备份恢复数据');

        const backupPath = 'assets/data/backup-practice-records.json';
        const isFileProtocol = typeof window !== 'undefined'
            && window.location
            && window.location.protocol === 'file:';

        // Chromium 下 fetch(file://...) 会直接抛错；备份属于可选项，跳过即可。
        if (isFileProtocol) {
            console.info('[Storage] file:// 环境跳过内置备份恢复');
            return false;
        }

        try {
            const response = await fetch(backupPath);
            if (!response.ok) {
                return false;
            }
            const backupData = await response.json();
            if (!backupData || !Array.isArray(backupData.practice_records)) {
                console.warn('[Storage] 备份数据格式无效');
                return false;
            }
            // 恢复 practice_records
            await this.set('practice_records', backupData.practice_records, { skipReady });
            console.log('[Storage] 从备份恢复 practice_records 成功');
            return true;
        } catch (error) {
            console.warn('[Storage] 备份恢复失败，已跳过:', error);
            return false;
        }
    }

    /**
     * 处理存储配额超限
     */
    handleStorageQuotaExceeded(key, value) {
        console.error('[Storage] 存储配额超限，无法保存数据:', key);

        // 显示用户警告
        if (window.showMessage) {
            window.showMessage('存储空间不足，系统已自动清理旧数据，请稍后重试', 'warning');
        }

        // 触发存储不足事件
        document.dispatchEvent(new CustomEvent('storageQuotaExceeded', {
            detail: { key, value, storageInfo: this.getStorageInfo() }
        }));
    }

    /**
     * 处理存储错误
     */
    handleStorageError(key, value, error) {
        console.error('[Storage] 存储错误:', error);

        // 如果是配额错误，尝试切换到备用存储
        if (error.name === 'QuotaExceededError') {
            this.handleStorageQuotaExceeded(key, value);
        } else {
            // 其他错误
            if (window.showMessage) {
                window.showMessage('数据保存失败，请检查浏览器设置', 'error');
            }

            // 触发存储错误事件
            document.dispatchEvent(new CustomEvent('storageError', {
                detail: { key, value, error }
            }));
        }
    }

    /**
     * 导出数据
     */
    async exportData(options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            const data = {};

            // 1. 导出内存存储数据
            if (this.fallbackStorage) {
                this.fallbackStorage.forEach((value, key) => {
                    if (key.startsWith(this.prefix)) {
                        const cleanKey = key.replace(this.prefix, '');
                        data[cleanKey] = JSON.parse(value);
                    }
                });
                console.log(`[Storage] 已导出内存存储数据 ${this.fallbackStorage.size} 条`);
            }

            // 2. 导出IndexedDB数据
            if (this.indexedDB) {
                try {
                    const items = await this.getAllFromIndexedDB();
                    const indexedDBData = {};
                    items.forEach(item => {
                        if (item.key.startsWith(this.prefix)) {
                            const cleanKey = item.key.replace(this.prefix, '');
                            indexedDBData[cleanKey] = JSON.parse(item.value);
                        }
                    });
                    // 合并IndexedDB数据
                    Object.assign(data, indexedDBData);
                    console.log(`[Storage] 已导出IndexedDB数据 ${Object.keys(indexedDBData).length} 条`);
                } catch (error) {
                    console.warn('[Storage] IndexedDB导出失败:', error);
                }
            }

            // 3. 导出localStorage数据
            const localStorageKeys = Object.keys(localStorage);
            const appKeys = localStorageKeys.filter(key => key.startsWith(this.prefix));
            appKeys.forEach(key => {
                const cleanKey = key.replace(this.prefix, '');
                try {
                    const value = localStorage.getItem(key);
                    if (value) {
                        data[cleanKey] = JSON.parse(value);
                    }
                } catch (error) {
                    console.warn(`[Storage] 解析localStorage数据失败: ${cleanKey}`, error);
                }
            });
            console.log(`[Storage] 已导出localStorage数据 ${appKeys.length} 条`);

            console.log(`[Storage] 数据导出完成，总计 ${Object.keys(data).length} 条记录`);

            return {
                version: this.version,
                exportDate: new Date().toISOString(),
                data: data,
                storageInfo: {
                    totalRecords: Object.keys(data).length,
                    sources: {
                        memory: this.fallbackStorage ? this.fallbackStorage.size : 0,
                        indexedDB: this.indexedDB ? Object.keys(data).length - (this.fallbackStorage ? this.fallbackStorage.size : 0) - appKeys.length : 0,
                        localStorage: appKeys.length
                    }
                }
            };
        } catch (error) {
            console.error('Export data error:', error);
            return null;
        }
    }

    /**
     * 从IndexedDB获取所有数据
     */
    getAllFromIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!this.indexedDB) {
                reject(new Error('IndexedDB not available'));
                return;
            }

            const transaction = this.indexedDB.transaction(['keyValueStore'], 'readonly');
            const store = transaction.objectStore('keyValueStore');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 导入数据
     */
    async importData(importedData, options = {}) {
        const { skipReady = false } = options;
        await this.waitForInitialization(skipReady);
        try {
            if (!importedData || !importedData.data) {
                throw new Error('Invalid import data format');
            }

            // 备份当前数据
            const backup = await this.exportData({ skipReady });

            try {
                // 清空现有数据
                await this.clear({ skipReady });

                // 导入新数据
                const importPromises = Object.entries(importedData.data).map(([key, value]) => {
                    return this.set(key, value.data, { skipReady });
                });

                await Promise.all(importPromises);

                return { success: true, message: 'Data imported successfully' };
            } catch (importError) {
                // 恢复备份
                console.error('Import failed, restoring backup:', importError);
                await this.clear({ skipReady });

                if (backup && backup.data) {
                    const restorePromises = Object.entries(backup.data).map(([key, value]) => {
                        return this.set(key, value.data, { skipReady });
                    });
                    await Promise.all(restorePromises);
                }

                throw importError;
            }
        } catch (error) {
            console.error('Import data error:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * 数据验证
     */
    validateData(key, data) {
        const validators = {
            practice_records: (records) => {
                return Array.isArray(records) && records.every(record => 
                    record.id && record.examId && record.startTime && record.endTime
                );
            },
            user_stats: (stats) => {
                return stats && typeof stats.totalPractices === 'number';
            },
            exam_index: (index) => {
                return !index || (Array.isArray(index) && index.every(exam => 
                    exam.id && exam.title && exam.category
                ));
            }
        };

        const validator = validators[key];
        return validator ? validator(data) : true;
    }

    /**
     * 启动存储监控
     */
    async startStorageMonitoring() {
        await this.waitForInitialization();
        console.log('[Storage] 启动存储监控...');

        // 定期检查存储使用情况
        this.monitoringInterval = setInterval(async () => {
            try {
                const storageInfo = await this.getStorageInfo();
                if (storageInfo) {
                    const usagePercent = storageInfo.type === 'localStorage'
                        ? (storageInfo.used / (5 * 1024 * 1024)) * 100
                        : (storageInfo.used / (105 * 1024 * 1024)) * 100;

                    const maxSize = storageInfo.type === 'localStorage' ? '5MB' :
                                   storageInfo.type === 'Hybrid' ? '105MB' : '100MB';
                    console.log(`[Storage] 使用率: ${usagePercent.toFixed(2)}% (${(storageInfo.used / 1024).toFixed(2)}KB / ${maxSize})`);

                    // 显示详细的存储分布
                    if (storageInfo.breakdown) {
                        console.log(`[Storage] 存储分布: localStorage ${(storageInfo.breakdown.localStorage / 1024).toFixed(2)}KB, IndexedDB ${(storageInfo.breakdown.indexedDB / 1024).toFixed(2)}KB`);
                    }

                    // 当使用率超过80%时，自动清理
                    if (usagePercent > 80) {
                        console.warn('[Storage] 存储使用率过高，自动清理旧数据');
                        await this.cleanupOldData();

                        // 清理后再次检查
                        const newStorageInfo = await this.getStorageInfo();
                        if (newStorageInfo) {
                            const newUsagePercent = newStorageInfo.type === 'localStorage'
                                ? (newStorageInfo.used / (5 * 1024 * 1024)) * 100
                                : (newStorageInfo.used / (105 * 1024 * 1024)) * 100;

                            console.log(`[Storage] 清理后使用率: ${newUsagePercent.toFixed(2)}%`);

                            // 如果仍然超过90%，显示警告
                            if (newUsagePercent > 90) {
                                if (window.showMessage) {
                                    window.showMessage('存储空间即将不足，建议导出数据备份', 'warning');
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('[Storage] 存储监控错误:', error);
            }
        }, 300000); // 每5分钟检查一次

        // 页面卸载时清理监控 - 全局事件必须使用原生 addEventListener
        window.addEventListener('beforeunload', () => {
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
            }
        });
    }

    // ==================== 词表存储专用方法 ====================

    /**
     * 词表存储键常量
     */
    getVocabStorageKeys() {
        return {
            P1_ERRORS: 'vocab_list_p1_errors',
            P4_ERRORS: 'vocab_list_p4_errors',
            MASTER_ERRORS: 'vocab_list_master_errors',
            CUSTOM: 'vocab_list_custom',
            ACTIVE_LIST: 'vocab_active_list'
        };
    }

    /**
     * 验证词表数据结构
     */
    validateVocabList(vocabList) {
        if (!vocabList || typeof vocabList !== 'object') {
            return { valid: false, error: '词表数据无效' };
        }

        const requiredFields = ['id', 'name', 'source', 'words', 'createdAt', 'updatedAt'];
        for (const field of requiredFields) {
            if (!(field in vocabList)) {
                return { valid: false, error: `缺少必需字段: ${field}` };
            }
        }

        if (!Array.isArray(vocabList.words)) {
            return { valid: false, error: 'words 字段必须是数组' };
        }

        // 验证每个单词条目
        for (const word of vocabList.words) {
            if (!word.word || typeof word.word !== 'string') {
                return { valid: false, error: '单词条目缺少有效的 word 字段' };
            }
            if (!word.timestamp || typeof word.timestamp !== 'number') {
                return { valid: false, error: '单词条目缺少有效的 timestamp 字段' };
            }
        }

        return { valid: true };
    }

    /**
     * 清理词表数据
     * 移除重复单词，保留最新的记录
     */
    cleanVocabList(vocabList) {
        if (!vocabList || !Array.isArray(vocabList.words)) {
            return vocabList;
        }

        const wordMap = new Map();
        
        // 按时间戳排序，保留最新的
        vocabList.words.forEach(word => {
            const key = word.word.toLowerCase().trim();
            const existing = wordMap.get(key);
            
            if (!existing || word.timestamp > existing.timestamp) {
                wordMap.set(key, word);
            }
        });

        vocabList.words = Array.from(wordMap.values());
        vocabList.updatedAt = Date.now();

        return vocabList;
    }

    /**
     * 保存词表数据
     */
    async saveVocabList(vocabList, options = {}) {
        const { skipReady = false } = options;
        
        try {
            // 验证数据
            const validation = this.validateVocabList(vocabList);
            if (!validation.valid) {
                console.error('[Storage] 词表数据验证失败:', validation.error);
                return false;
            }

            // 清理数据
            const cleanedList = this.cleanVocabList(vocabList);

            // 确定存储键
            const keys = this.getVocabStorageKeys();
            let storageKey;

            switch (cleanedList.source) {
                case 'p1':
                    storageKey = keys.P1_ERRORS;
                    break;
                case 'p4':
                    storageKey = keys.P4_ERRORS;
                    break;
                case 'all':
                    storageKey = keys.MASTER_ERRORS;
                    break;
                case 'user':
                    storageKey = keys.CUSTOM;
                    break;
                default:
                    storageKey = cleanedList.id;
            }

            console.log(`[Storage] 保存词表: ${storageKey}, 单词数: ${cleanedList.words.length}`);

            // 保存到存储
            const success = await this.set(storageKey, cleanedList, { skipReady });

            if (success) {
                console.log(`[Storage] 词表保存成功: ${storageKey}`);
            }

            return success;
        } catch (error) {
            console.error('[Storage] 保存词表失败:', error);
            return false;
        }
    }

    /**
     * 加载词表数据
     */
    async loadVocabList(listId, options = {}) {
        const { skipReady = false } = options;
        
        try {
            const keys = this.getVocabStorageKeys();
            let storageKey;

            // 根据 listId 确定存储键
            if (listId === 'spelling-errors-p1') {
                storageKey = keys.P1_ERRORS;
            } else if (listId === 'spelling-errors-p4') {
                storageKey = keys.P4_ERRORS;
            } else if (listId === 'spelling-errors-master') {
                storageKey = keys.MASTER_ERRORS;
            } else if (listId === 'custom') {
                storageKey = keys.CUSTOM;
            } else {
                storageKey = listId;
            }

            console.log(`[Storage] 加载词表: ${storageKey}`);

            const vocabList = await this.get(storageKey, null, { skipReady });

            if (!vocabList) {
                console.log(`[Storage] 词表不存在: ${storageKey}`);
                return null;
            }

            // 验证加载的数据
            const validation = this.validateVocabList(vocabList);
            if (!validation.valid) {
                console.error('[Storage] 加载的词表数据无效:', validation.error);
                return null;
            }

            console.log(`[Storage] 词表加载成功: ${storageKey}, 单词数: ${vocabList.words.length}`);
            return vocabList;
        } catch (error) {
            console.error('[Storage] 加载词表失败:', error);
            return null;
        }
    }

    /**
     * 获取词表单词数量
     */
    async getVocabListWordCount(listId, options = {}) {
        const { skipReady = false } = options;
        
        try {
            const vocabList = await this.loadVocabList(listId, { skipReady });
            return vocabList ? vocabList.words.length : 0;
        } catch (error) {
            console.error('[Storage] 获取词表单词数量失败:', error);
            return 0;
        }
    }

    /**
     * 添加单词到词表
     */
    async addWordToVocabList(listId, word, options = {}) {
        const { skipReady = false } = options;
        
        try {
            let vocabList = await this.loadVocabList(listId, { skipReady });

            if (!vocabList) {
                // 创建新词表
                vocabList = {
                    id: listId,
                    name: this.getVocabListName(listId),
                    source: this.getVocabListSource(listId),
                    words: [],
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
            }

            // 检查单词是否已存在
            const existingIndex = vocabList.words.findIndex(w => 
                w.word.toLowerCase() === word.word.toLowerCase()
            );

            if (existingIndex >= 0) {
                // 更新现有单词
                vocabList.words[existingIndex] = {
                    ...vocabList.words[existingIndex],
                    ...word,
                    errorCount: (vocabList.words[existingIndex].errorCount || 0) + 1,
                    timestamp: Date.now()
                };
            } else {
                // 添加新单词
                vocabList.words.push({
                    ...word,
                    errorCount: word.errorCount || 1,
                    timestamp: word.timestamp || Date.now()
                });
            }

            vocabList.updatedAt = Date.now();

            return await this.saveVocabList(vocabList, { skipReady });
        } catch (error) {
            console.error('[Storage] 添加单词到词表失败:', error);
            return false;
        }
    }

    /**
     * 从词表中移除单词
     */
    async removeWordFromVocabList(listId, word, options = {}) {
        const { skipReady = false } = options;
        
        try {
            const vocabList = await this.loadVocabList(listId, { skipReady });

            if (!vocabList) {
                return false;
            }

            const normalizedWord = word.toLowerCase().trim();
            vocabList.words = vocabList.words.filter(w => 
                w.word.toLowerCase().trim() !== normalizedWord
            );

            vocabList.updatedAt = Date.now();

            return await this.saveVocabList(vocabList, { skipReady });
        } catch (error) {
            console.error('[Storage] 从词表移除单词失败:', error);
            return false;
        }
    }

    /**
     * 获取词表名称
     */
    getVocabListName(listId) {
        const names = {
            'spelling-errors-p1': 'P1 拼写错误',
            'spelling-errors-p4': 'P4 拼写错误',
            'spelling-errors-master': '综合错误词表',
            'custom': '自定义词表'
        };
        return names[listId] || listId;
    }

    /**
     * 获取词表来源
     */
    getVocabListSource(listId) {
        if (listId.includes('p1')) return 'p1';
        if (listId.includes('p4')) return 'p4';
        if (listId.includes('master')) return 'all';
        return 'user';
    }

    /**
     * 获取所有词表的元数据
     */
    async getAllVocabListsMetadata(options = {}) {
        const { skipReady = false } = options;
        
        const keys = this.getVocabStorageKeys();
        const listIds = [
            'spelling-errors-p1',
            'spelling-errors-p4',
            'spelling-errors-master',
            'custom'
        ];

        const metadata = [];

        for (const listId of listIds) {
            const count = await this.getVocabListWordCount(listId, { skipReady });
            metadata.push({
                id: listId,
                name: this.getVocabListName(listId),
                source: this.getVocabListSource(listId),
                wordCount: count
            });
        }

        return metadata;
    }

    // ==================== 数据同步逻辑 ====================

    /**
     * 同步词表数据（跨会话）
     * 处理数据冲突，使用最新时间戳
     */
    async syncVocabList(listId, newData, options = {}) {
        const { skipReady = false } = options;
        
        try {
            console.log(`[Storage] 开始同步词表: ${listId}`);

            // 加载现有数据
            const existingList = await this.loadVocabList(listId, { skipReady });

            if (!existingList) {
                // 没有现有数据，直接保存新数据
                console.log(`[Storage] 无现有数据，直接保存新词表`);
                return await this.saveVocabList(newData, { skipReady });
            }

            // 合并数据，解决冲突
            const mergedList = this.mergeVocabLists(existingList, newData);

            console.log(`[Storage] 词表合并完成，单词数: ${mergedList.words.length}`);

            // 保存合并后的数据
            return await this.saveVocabList(mergedList, { skipReady });
        } catch (error) {
            console.error('[Storage] 同步词表失败:', error);
            return false;
        }
    }

    /**
     * 合并两个词表，解决冲突
     * 使用最新时间戳的数据
     */
    mergeVocabLists(existing, incoming) {
        // 使用最新的元数据
        const merged = {
            id: existing.id,
            name: existing.name,
            source: existing.source,
            words: [],
            createdAt: existing.createdAt,
            updatedAt: Math.max(existing.updatedAt, incoming.updatedAt)
        };

        // 创建单词映射
        const wordMap = new Map();

        // 先添加现有单词
        existing.words.forEach(word => {
            const key = word.word.toLowerCase().trim();
            wordMap.set(key, word);
        });

        // 合并新单词，使用最新时间戳
        incoming.words.forEach(word => {
            const key = word.word.toLowerCase().trim();
            const existingWord = wordMap.get(key);

            if (!existingWord || word.timestamp > existingWord.timestamp) {
                // 新单词或更新的单词
                wordMap.set(key, {
                    ...existingWord,
                    ...word,
                    errorCount: (existingWord?.errorCount || 0) + (word.errorCount || 1)
                });
            }
        });

        merged.words = Array.from(wordMap.values());

        return merged;
    }

    /**
     * 批量同步所有词表
     */
    async syncAllVocabLists(options = {}) {
        const { skipReady = false } = options;
        
        try {
            console.log('[Storage] 开始批量同步所有词表');

            const listIds = [
                'spelling-errors-p1',
                'spelling-errors-p4',
                'spelling-errors-master',
                'custom'
            ];

            const results = [];

            for (const listId of listIds) {
                const list = await this.loadVocabList(listId, { skipReady });
                if (list) {
                    const success = await this.syncVocabList(listId, list, { skipReady });
                    results.push({ listId, success });
                }
            }

            console.log('[Storage] 批量同步完成:', results);
            return results;
        } catch (error) {
            console.error('[Storage] 批量同步失败:', error);
            return [];
        }
    }

    /**
     * 确保数据持久化（页面关闭前）
     */
    async ensureDataPersisted(options = {}) {
        const { skipReady = false } = options;
        
        try {
            console.log('[Storage] 确保数据持久化');

            // 强制刷新所有待写入的数据
            if (this.indexedDB) {
                // IndexedDB 事务会自动提交，无需额外操作
                console.log('[Storage] IndexedDB 数据已自动持久化');
            }

            // 同步所有词表
            await this.syncAllVocabLists({ skipReady });

            console.log('[Storage] 数据持久化完成');
            return true;
        } catch (error) {
            console.error('[Storage] 数据持久化失败:', error);
            return false;
        }
    }

    /**
     * 监听页面卸载事件，确保数据持久化
     */
    setupBeforeUnloadHandler() {
        // 使用 beforeunload 事件确保数据保存
        window.addEventListener('beforeunload', async (event) => {
            try {
                console.log('[Storage] 页面即将关闭，确保数据持久化');
                
                // 同步保存所有待写入的数据
                await this.ensureDataPersisted({ skipReady: true });
                
                console.log('[Storage] 数据持久化完成');
            } catch (error) {
                console.error('[Storage] beforeunload 数据持久化失败:', error);
            }
        });

        console.log('[Storage] beforeunload 处理器已设置');
    }

    /**
     * 检测数据冲突
     */
    detectVocabListConflict(list1, list2) {
        if (!list1 || !list2) return false;

        // 检查是否有相同单词但不同内容
        const conflicts = [];

        const map1 = new Map(list1.words.map(w => [w.word.toLowerCase(), w]));
        const map2 = new Map(list2.words.map(w => [w.word.toLowerCase(), w]));

        for (const [word, data1] of map1) {
            const data2 = map2.get(word);
            if (data2 && data1.timestamp !== data2.timestamp) {
                conflicts.push({
                    word,
                    data1,
                    data2,
                    resolution: data1.timestamp > data2.timestamp ? 'use_list1' : 'use_list2'
                });
            }
        }

        return conflicts.length > 0 ? conflicts : false;
    }

    /**
     * 解决词表冲突
     */
    resolveVocabListConflict(list1, list2, strategy = 'latest') {
        if (strategy === 'latest') {
            return this.mergeVocabLists(list1, list2);
        } else if (strategy === 'keep_list1') {
            return list1;
        } else if (strategy === 'keep_list2') {
            return list2;
        }

        return this.mergeVocabLists(list1, list2);
    }

    // ==================== 降级存储方案 ====================

    /**
     * 检测 IndexedDB 可用性
     */
    isIndexedDBAvailable() {
        try {
            // 检查浏览器是否支持 IndexedDB
            if (!window.indexedDB) {
                console.log('[Storage] IndexedDB 不支持');
                return false;
            }

            // 检查是否已成功初始化
            if (this.indexedDB) {
                console.log('[Storage] IndexedDB 可用');
                return true;
            }

            console.log('[Storage] IndexedDB 未初始化');
            return false;
        } catch (error) {
            console.error('[Storage] IndexedDB 可用性检测失败:', error);
            return false;
        }
    }

    /**
     * 检测 localStorage 可用性
     */
    isLocalStorageAvailable() {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            console.log('[Storage] localStorage 可用');
            return true;
        } catch (error) {
            console.error('[Storage] localStorage 不可用:', error);
            return false;
        }
    }

    /**
     * 获取当前存储类型
     */
    getCurrentStorageType() {
        if (this.fallbackStorage) {
            return 'memory';
        } else if (this.indexedDB) {
            return 'indexedDB';
        } else if (this.isLocalStorageAvailable()) {
            return 'localStorage';
        }
        return 'none';
    }

    /**
     * 处理存储空间不足
     */
    async handleStorageQuotaExceeded(key, value) {
        console.warn('[Storage] 存储空间不足，尝试清理');

        try {
            // 1. 清理旧数据
            await this.cleanupOldData({ skipReady: true });

            // 2. 再次尝试保存
            const retrySuccess = await this.set(key, value, { skipReady: true });
            if (retrySuccess) {
                console.log('[Storage] 清理后保存成功');
                return true;
            }

            // 3. 如果仍然失败，尝试降级存储
            console.warn('[Storage] 清理后仍然失败，尝试降级存储');
            
            const storageType = this.getCurrentStorageType();
            
            if (storageType === 'indexedDB') {
                // 降级到 localStorage
                console.log('[Storage] 从 IndexedDB 降级到 localStorage');
                try {
                    const serializedValue = JSON.stringify({
                        data: value,
                        timestamp: Date.now(),
                        version: this.version
                    });
                    localStorage.setItem(this.getKey(key), serializedValue);
                    console.log('[Storage] localStorage 保存成功');
                    return true;
                } catch (localStorageError) {
                    console.error('[Storage] localStorage 保存失败:', localStorageError);
                }
            }

            // 4. 最后降级到内存存储
            console.warn('[Storage] 降级到内存存储');
            if (!this.fallbackStorage) {
                this.fallbackStorage = new Map();
            }
            const serializedValue = JSON.stringify({
                data: value,
                timestamp: Date.now(),
                version: this.version
            });
            this.fallbackStorage.set(this.getKey(key), serializedValue);
            
            // 提示用户
            if (window.showMessage) {
                window.showMessage('存储空间不足，数据已保存到临时存储，请导出备份', 'warning');
            }

            return true;
        } catch (error) {
            console.error('[Storage] 处理存储空间不足失败:', error);
            
            // 最终失败，提示用户
            if (window.showMessage) {
                window.showMessage('存储空间严重不足，无法保存数据，请清理旧数据', 'error');
            }
            
            return false;
        }
    }

    /**
     * 词表专用降级保存
     */
    async saveVocabListWithFallback(vocabList, options = {}) {
        const { skipReady = false } = options;
        
        try {
            // 首先尝试正常保存
            const success = await this.saveVocabList(vocabList, { skipReady });
            
            if (success) {
                return true;
            }

            // 如果失败，尝试降级保存
            console.warn('[Storage] 词表保存失败，尝试降级保存');

            // 压缩词表数据
            const compressedList = this.compressVocabList(vocabList);

            // 再次尝试保存压缩后的数据
            const compressedSuccess = await this.saveVocabList(compressedList, { skipReady });

            if (compressedSuccess) {
                console.log('[Storage] 压缩后保存成功');
                return true;
            }

            // 如果仍然失败，使用降级存储
            return await this.handleStorageQuotaExceeded(
                this.getVocabStorageKey(vocabList.id),
                compressedList
            );
        } catch (error) {
            console.error('[Storage] 词表降级保存失败:', error);
            return false;
        }
    }

    /**
     * 压缩词表数据
     */
    compressVocabList(vocabList) {
        return {
            id: vocabList.id,
            name: vocabList.name,
            source: vocabList.source,
            words: vocabList.words.map(word => ({
                word: word.word,
                userInput: word.userInput,
                timestamp: word.timestamp,
                errorCount: word.errorCount
                // 移除其他非必要字段
            })),
            createdAt: vocabList.createdAt,
            updatedAt: vocabList.updatedAt
        };
    }

    /**
     * 获取词表存储键
     */
    getVocabStorageKey(listId) {
        const keys = this.getVocabStorageKeys();
        
        if (listId === 'spelling-errors-p1') return keys.P1_ERRORS;
        if (listId === 'spelling-errors-p4') return keys.P4_ERRORS;
        if (listId === 'spelling-errors-master') return keys.MASTER_ERRORS;
        if (listId === 'custom') return keys.CUSTOM;
        
        return listId;
    }

    /**
     * 检查存储健康状态
     */
    async checkStorageHealth(options = {}) {
        const { skipReady = false } = options;
        
        try {
            const health = {
                indexedDB: this.isIndexedDBAvailable(),
                localStorage: this.isLocalStorageAvailable(),
                currentType: this.getCurrentStorageType(),
                quotaStatus: 'unknown'
            };

            // 检查配额状态
            const storageInfo = await this.getStorageInfo({ skipReady });
            if (storageInfo) {
                const usagePercent = storageInfo.type === 'localStorage'
                    ? (storageInfo.used / (5 * 1024 * 1024)) * 100
                    : (storageInfo.used / (105 * 1024 * 1024)) * 100;

                if (usagePercent < 70) {
                    health.quotaStatus = 'healthy';
                } else if (usagePercent < 90) {
                    health.quotaStatus = 'warning';
                } else {
                    health.quotaStatus = 'critical';
                }

                health.usagePercent = usagePercent;
                health.used = storageInfo.used;
            }

            console.log('[Storage] 存储健康状态:', health);
            return health;
        } catch (error) {
            console.error('[Storage] 检查存储健康状态失败:', error);
            return {
                indexedDB: false,
                localStorage: false,
                currentType: 'none',
                quotaStatus: 'error'
            };
        }
    }

    // ==================== 数据导出功能 ====================

    /**
     * 导出练习记录
     */
    async exportPracticeRecords(options = {}) {
        const { skipReady = false, format = 'json' } = options;
        
        try {
            console.log('[Storage] 开始导出练习记录');

            // 加载练习记录
            const records = await this.get('practice_records', [], { skipReady });

            const exportData = {
                type: 'practice_records',
                version: this.version,
                exportDate: new Date().toISOString(),
                recordCount: records.length,
                records: records
            };

            console.log(`[Storage] 练习记录导出完成，共 ${records.length} 条`);

            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            }

            return exportData;
        } catch (error) {
            console.error('[Storage] 导出练习记录失败:', error);
            return null;
        }
    }

    /**
     * 导出词表数据
     */
    async exportVocabLists(options = {}) {
        const { skipReady = false, format = 'json', listIds = null } = options;
        
        try {
            console.log('[Storage] 开始导出词表数据');

            const vocabLists = [];
            const targetListIds = listIds || [
                'spelling-errors-p1',
                'spelling-errors-p4',
                'spelling-errors-master',
                'custom'
            ];

            for (const listId of targetListIds) {
                const list = await this.loadVocabList(listId, { skipReady });
                if (list && list.words.length > 0) {
                    vocabLists.push(list);
                }
            }

            const exportData = {
                type: 'vocabulary_lists',
                version: this.version,
                exportDate: new Date().toISOString(),
                listCount: vocabLists.length,
                totalWords: vocabLists.reduce((sum, list) => sum + list.words.length, 0),
                lists: vocabLists
            };

            console.log(`[Storage] 词表导出完成，共 ${vocabLists.length} 个词表，${exportData.totalWords} 个单词`);

            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            }

            return exportData;
        } catch (error) {
            console.error('[Storage] 导出词表数据失败:', error);
            return null;
        }
    }

    /**
     * 导出单个词表
     */
    async exportSingleVocabList(listId, options = {}) {
        const { skipReady = false, format = 'json' } = options;
        
        try {
            console.log(`[Storage] 开始导出词表: ${listId}`);

            const list = await this.loadVocabList(listId, { skipReady });

            if (!list) {
                console.warn(`[Storage] 词表不存在: ${listId}`);
                return null;
            }

            const exportData = {
                type: 'vocabulary_list',
                version: this.version,
                exportDate: new Date().toISOString(),
                list: list
            };

            console.log(`[Storage] 词表导出完成: ${listId}, ${list.words.length} 个单词`);

            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            }

            return exportData;
        } catch (error) {
            console.error('[Storage] 导出词表失败:', error);
            return null;
        }
    }

    /**
     * 导出完整数据（包括练习记录和词表）
     */
    async exportCompleteData(options = {}) {
        const { skipReady = false, format = 'json' } = options;
        
        try {
            console.log('[Storage] 开始导出完整数据');

            // 导出所有数据
            const allData = await this.exportData({ skipReady });

            // 导出练习记录
            const practiceRecords = await this.exportPracticeRecords({ 
                skipReady, 
                format: 'object' 
            });

            // 导出词表
            const vocabLists = await this.exportVocabLists({ 
                skipReady, 
                format: 'object' 
            });

            const exportData = {
                type: 'complete_export',
                version: this.version,
                exportDate: new Date().toISOString(),
                summary: {
                    totalRecords: allData?.storageInfo?.totalRecords || 0,
                    practiceRecords: practiceRecords?.recordCount || 0,
                    vocabLists: vocabLists?.listCount || 0,
                    totalWords: vocabLists?.totalWords || 0
                },
                data: {
                    all: allData,
                    practiceRecords: practiceRecords,
                    vocabLists: vocabLists
                }
            };

            console.log('[Storage] 完整数据导出完成');

            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            }

            return exportData;
        } catch (error) {
            console.error('[Storage] 导出完整数据失败:', error);
            return null;
        }
    }

    /**
     * 下载导出数据为文件
     */
    downloadExportData(data, filename = null) {
        try {
            if (!data) {
                console.error('[Storage] 无数据可导出');
                return false;
            }

            // 确保数据是字符串格式
            const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

            // 创建 Blob
            const blob = new Blob([jsonString], { type: 'application/json' });

            // 生成文件名
            const defaultFilename = `ielts-practice-export-${new Date().toISOString().split('T')[0]}.json`;
            const finalFilename = filename || defaultFilename;

            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = finalFilename;

            // 触发下载
            document.body.appendChild(link);
            link.click();

            // 清理
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            console.log(`[Storage] 数据已下载: ${finalFilename}`);
            return true;
        } catch (error) {
            console.error('[Storage] 下载导出数据失败:', error);
            return false;
        }
    }

    /**
     * 导出并下载练习记录
     */
    async exportAndDownloadPracticeRecords(filename = null) {
        try {
            const data = await this.exportPracticeRecords({ format: 'json' });
            if (data) {
                const defaultFilename = `practice-records-${new Date().toISOString().split('T')[0]}.json`;
                return this.downloadExportData(data, filename || defaultFilename);
            }
            return false;
        } catch (error) {
            console.error('[Storage] 导出并下载练习记录失败:', error);
            return false;
        }
    }

    /**
     * 导出并下载词表数据
     */
    async exportAndDownloadVocabLists(filename = null) {
        try {
            const data = await this.exportVocabLists({ format: 'json' });
            if (data) {
                const defaultFilename = `vocab-lists-${new Date().toISOString().split('T')[0]}.json`;
                return this.downloadExportData(data, filename || defaultFilename);
            }
            return false;
        } catch (error) {
            console.error('[Storage] 导出并下载词表数据失败:', error);
            return false;
        }
    }

    /**
     * 导出并下载完整数据
     */
    async exportAndDownloadCompleteData(filename = null) {
        try {
            const data = await this.exportCompleteData({ format: 'json' });
            if (data) {
                const defaultFilename = `complete-data-${new Date().toISOString().split('T')[0]}.json`;
                return this.downloadExportData(data, filename || defaultFilename);
            }
            return false;
        } catch (error) {
            console.error('[Storage] 导出并下载完整数据失败:', error);
            return false;
        }
    }

    /**
     * 导入词表数据
     */
    async importVocabLists(importData, options = {}) {
        const { skipReady = false, merge = true } = options;
        
        try {
            console.log('[Storage] 开始导入词表数据');

            if (!importData || !importData.lists) {
                console.error('[Storage] 导入数据格式无效');
                return false;
            }

            let successCount = 0;
            let failCount = 0;

            for (const list of importData.lists) {
                try {
                    if (merge) {
                        // 合并模式：与现有数据合并
                        const success = await this.syncVocabList(list.id, list, { skipReady });
                        if (success) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    } else {
                        // 覆盖模式：直接保存
                        const success = await this.saveVocabList(list, { skipReady });
                        if (success) {
                            successCount++;
                        } else {
                            failCount++;
                        }
                    }
                } catch (error) {
                    console.error(`[Storage] 导入词表失败: ${list.id}`, error);
                    failCount++;
                }
            }

            console.log(`[Storage] 词表导入完成: ${successCount} 成功, ${failCount} 失败`);
            return { successCount, failCount };
        } catch (error) {
            console.error('[Storage] 导入词表数据失败:', error);
            return false;
        }
    }
}

const STORAGE_SYNC_IGNORED_KEYS = new Set([
    'namespace_test',
    'namespace_test_practice',
    'namespace_test_enhancer'
]);

StorageManager.prototype.dispatchStorageSync = function(key) {
    try {
        const normalizedKey = typeof key === 'string' ? key.replace(this.prefix, '') : key;
        if (normalizedKey && STORAGE_SYNC_IGNORED_KEYS.has(normalizedKey)) {
            return;
        }
    } catch (_) {
        // ignore errors resolving key
    }
    window.dispatchEvent(new CustomEvent('storage-sync', { detail: { key } }));
};

// 创建全局存储实例
const storageManager = new StorageManager();
window.storage = storageManager;

// 启动存储监控和数据同步
storageManager.ready
    .then(() => {
        storageManager.startStorageMonitoring();
        storageManager.setupBeforeUnloadHandler();
    })
    .catch(error => {
        console.error('[Storage] 存储初始化失败，监控未启动:', error);
    });
