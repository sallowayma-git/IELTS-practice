/**
 * 本地存储工具类
 * 提供统一的数据存储和检索接口
 */
class StorageManager {
    constructor() {
        this.prefix = 'exam_system_';
        this.version = '1.0.0';
        this.initializeStorage();
    }

    /**
     * 初始化存储系统
     */
    async initializeStorage() {
        try {
            // 检查localStorage可用性
            const testKey = this.prefix + 'test';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);

            // 初始化版本信息
            const currentVersion = await this.get('system_version');
            console.log(`[Storage] 当前版本: ${currentVersion}, 目标版本: ${this.version}`);

            if (!currentVersion) {
                // 首次安装
                console.log('[Storage] 首次安装，初始化默认数据');
                this.handleVersionUpgrade(null);
            } else if (currentVersion !== this.version) {
                // 版本升级
                console.log('[Storage] 版本升级，迁移数据');
                this.handleVersionUpgrade(currentVersion);
            } else {
                console.log('[Storage] 版本匹配，跳过初始化');
            }
        } catch (error) {
            console.warn('LocalStorage not available, falling back to IndexedDB storage');
            this.initializeIndexedDBStorage();
        }
    }

    /**
     * 初始化IndexedDB存储
     */
    async initializeIndexedDBStorage() {
        try {
            // 检查IndexedDB支持
            if (!window.indexedDB) {
                console.warn('IndexedDB not supported, falling back to memory storage');
                this.fallbackStorage = new Map();
                return;
            }

            this.dbName = 'ExamSystemDB';
            this.dbVersion = 1;

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                this.fallbackStorage = new Map();
            };

            request.onsuccess = (event) => {
                this.indexedDB = event.target.result;
                console.log('[Storage] IndexedDB initialized successfully');

                // 迁移localStorage数据到IndexedDB
                this.migrateFromLocalStorage();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 创建存储对象
                if (!db.objectStoreNames.contains('keyValueStore')) {
                    const store = db.createObjectStore('keyValueStore', { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };

        } catch (error) {
            console.error('Failed to initialize IndexedDB:', error);
            this.fallbackStorage = new Map();
        }
    }

    /**
     * 从localStorage迁移数据到IndexedDB
     */
    async migrateFromLocalStorage() {
        try {
            if (!this.indexedDB) return;

            const keys = Object.keys(localStorage);
            const migrationKeys = keys.filter(key => key.startsWith(this.prefix));

            if (migrationKeys.length === 0) return;

            console.log(`[Storage] 迁移 ${migrationKeys.length} 条数据到IndexedDB`);

            for (const key of migrationKeys) {
                try {
                    const value = localStorage.getItem(key);
                    if (value) {
                        await this.setToIndexedDB(key, value);
                        localStorage.removeItem(key);
                    }
                } catch (error) {
                    console.warn(`[Storage] 迁移数据失败: ${key}`, error);
                }
            }

            console.log('[Storage] 数据迁移完成');
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
    async handleVersionUpgrade(oldVersion) {
        console.log(`Upgrading storage from ${oldVersion || 'unknown'} to ${this.version}`);

        // 在这里处理数据迁移逻辑
        if (!oldVersion) {
            // 首次安装，初始化默认数据
            this.initializeDefaultData();
        }

        await this.set('system_version', this.version);
    }

    /**
     * 初始化默认数据
     */
    async initializeDefaultData() {
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
            const existingValue = await this.get(key);
            if (existingValue === null || existingValue === undefined) {
                console.log(`[Storage] 初始化默认数据: ${key}`);
                await this.set(key, value);
            } else {
                console.log(`[Storage] 保留现有数据: ${key} (${Array.isArray(existingValue) ? existingValue.length + ' 项' : typeof existingValue})`);
            }
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
            // 对于大型数据，使用压缩
            if (typeof data === 'object' && JSON.stringify(data).length > 1000) {
                // 使用简单的压缩策略：移除不必要的字段
                return this.compressObject(data);
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
    async set(key, value) {
        try {
            // 压缩数据以减少存储空间
            const compressedValue = this.compressData(value);

            const serializedValue = JSON.stringify({
                data: compressedValue,
                timestamp: Date.now(),
                version: this.version,
                compressed: compressedValue !== value // 标记是否被压缩
            });

            if (this.fallbackStorage) {
                this.fallbackStorage.set(this.getKey(key), serializedValue);
                return true;
            } else if (this.indexedDB) {
                // 使用IndexedDB存储
                try {
                    await this.setToIndexedDB(this.getKey(key), serializedValue);
                    return true;
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB存储失败，尝试localStorage:', indexedDBError);

                    // 降级到localStorage
                    if (!this.checkStorageQuota(serializedValue.length)) {
                        console.warn('[Storage] 存储空间不足，尝试清理旧数据');
                        this.cleanupOldData();

                        if (!this.checkStorageQuota(serializedValue.length)) {
                            console.error('[Storage] 存储空间仍然不足，无法保存数据');
                            this.handleStorageQuotaExceeded(key, value);
                            return false;
                        }
                    }

                    localStorage.setItem(this.getKey(key), serializedValue);
                    return true;
                }
            } else {
                // 使用localStorage存储
                if (!this.checkStorageQuota(serializedValue.length)) {
                    console.warn('[Storage] 存储空间不足，尝试清理旧数据');
                    this.cleanupOldData();

                    if (!this.checkStorageQuota(serializedValue.length)) {
                        console.error('[Storage] 存储空间仍然不足，无法保存数据');
                        this.handleStorageQuotaExceeded(key, value);
                        return false;
                    }
                }

                localStorage.setItem(this.getKey(key), serializedValue);
                return true;
            }
        } catch (error) {
            console.error('Storage set error:', error);
            this.handleStorageError(key, value, error);
            return false;
        }
    }

    /**
     * 获取数据
     */
    async get(key, defaultValue = null) {
        try {
            let serializedValue;

            if (this.fallbackStorage) {
                serializedValue = this.fallbackStorage.get(this.getKey(key));
            } else if (this.indexedDB) {
                // 尝试从IndexedDB获取
                try {
                    serializedValue = await this.getFromIndexedDB(this.getKey(key));
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB获取失败，尝试localStorage:', indexedDBError);
                    serializedValue = localStorage.getItem(this.getKey(key));
                }
            } else {
                serializedValue = localStorage.getItem(this.getKey(key));
            }

            if (!serializedValue) {
                return defaultValue;
            }

            const parsed = JSON.parse(serializedValue);
            return parsed.data;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    }

    /**
     * 删除数据
     */
    async remove(key) {
        try {
            if (this.fallbackStorage) {
                this.fallbackStorage.delete(this.getKey(key));
                return true;
            } else if (this.indexedDB) {
                // 尝试从IndexedDB删除
                try {
                    await this.removeFromIndexedDB(this.getKey(key));
                    return true;
                } catch (indexedDBError) {
                    console.warn('[Storage] IndexedDB删除失败，尝试localStorage:', indexedDBError);
                    localStorage.removeItem(this.getKey(key));
                    return true;
                }
            } else {
                localStorage.removeItem(this.getKey(key));
                return true;
            }
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    }

    /**
     * 清空所有数据
     */
    async clear() {
        try {
            // 清空内存存储
            if (this.fallbackStorage) {
                this.fallbackStorage.clear();
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
            const keys = Object.keys(localStorage);
            const appKeys = keys.filter(key => key.startsWith(this.prefix));
            appKeys.forEach(key => {
                localStorage.removeItem(key);
            });
            console.log(`[Storage] localStorage已清空 ${appKeys.length} 条数据`);

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
    async checkStorageQuota(dataSize) {
        try {
            if (this.fallbackStorage) {
                return true; // 内存存储没有配额限制
            }

            const storageInfo = await this.getStorageInfo();
            if (!storageInfo) return false;

            if (storageInfo.type === 'Hybrid' || storageInfo.type === 'IndexedDB') {
                // 混合存储或IndexedDB没有固定配额限制，但我们仍然检查数据大小
                const maxSize = 105 * 1024 * 1024; // 105MB限制 (localStorage 5MB + IndexedDB 100MB)
                return storageInfo.used + dataSize <= maxSize;
            }

            const currentUsage = storageInfo.used;
            const quota = 5 * 1024 * 1024; // 5MB
            const availableSpace = quota - currentUsage;

            // 预留20%的缓冲空间
            const bufferSpace = quota * 0.2;
            const safeAvailableSpace = availableSpace - bufferSpace;

            console.log(`[Storage] 当前使用: ${(currentUsage / 1024).toFixed(2)}KB, 可用空间: ${(safeAvailableSpace / 1024).toFixed(2)}KB, 需要空间: ${(dataSize / 1024).toFixed(2)}KB`);

            return safeAvailableSpace >= dataSize;
        } catch (error) {
            console.error('Storage quota check error:', error);
            return false;
        }
    }

    /**
     * 获取存储使用情况
     */
    async getStorageInfo() {
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
    async cleanupOldData() {
        try {
            console.log('[Storage] 开始清理旧数据...');

            const practiceRecords = await this.get('practice_records', []);
            if (practiceRecords.length > 0) {
                // 压缩练习记录数据，但保留所有记录
                const compressedRecords = practiceRecords.map(record => this.compressObject(record));
                await this.set('practice_records', compressedRecords);
                console.log(`[Storage] 已压缩练习记录数据，保留${practiceRecords.length}条记录`);
            }

            // 清理错误日志
            const errorLogs = await this.get('injection_errors', []);
            if (errorLogs.length > 20) {
                const logsToKeep = errorLogs.slice(-20); // 保留最近20条
                await this.set('injection_errors', logsToKeep);
                console.log(`[Storage] 已清理错误日志，从${errorLogs.length}条减少到${logsToKeep.length}条`);
            }

            const collectionErrors = await this.get('collection_errors', []);
            if (collectionErrors.length > 20) {
                const logsToKeep = collectionErrors.slice(-20);
                await this.set('collection_errors', logsToKeep);
                console.log(`[Storage] 已清理数据收集错误日志，从${collectionErrors.length}条减少到${logsToKeep.length}条`);
            }

            // 清理活动会话（保留最近的）
            const activeSessions = await this.get('active_sessions', []);
            const now = Date.now();
            const recentSessions = activeSessions.filter(session => {
                const sessionTime = new Date(session.startTime).getTime();
                const hoursDiff = (now - sessionTime) / (1000 * 60 * 60);
                return hoursDiff < 1; // 只保留1小时内的会话
            });

            if (recentSessions.length !== activeSessions.length) {
                await this.set('active_sessions', recentSessions);
                console.log(`[Storage] 已清理过期会话，从${activeSessions.length}个减少到${recentSessions.length}个`);
            }

        } catch (error) {
            console.error('[Storage] 清理旧数据失败:', error);
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
    async exportData() {
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
    async importData(importedData) {
        try {
            if (!importedData || !importedData.data) {
                throw new Error('Invalid import data format');
            }

            // 备份当前数据
            const backup = await this.exportData();

            try {
                // 清空现有数据
                await this.clear();

                // 导入新数据
                const importPromises = Object.entries(importedData.data).map(([key, value]) => {
                    return this.set(key, value.data);
                });

                await Promise.all(importPromises);

                return { success: true, message: 'Data imported successfully' };
            } catch (importError) {
                // 恢复备份
                console.error('Import failed, restoring backup:', importError);
                await this.clear();

                if (backup && backup.data) {
                    const restorePromises = Object.entries(backup.data).map(([key, value]) => {
                        return this.set(key, value.data);
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
    startStorageMonitoring() {
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
                        this.cleanupOldData();

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

        // 页面卸载时清理监控
        window.addEventListener('beforeunload', () => {
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
            }
        });
    }

}

// 创建全局存储实例
window.storage = new StorageManager();

// 启动存储监控
window.storage.startStorageMonitoring();