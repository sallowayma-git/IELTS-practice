/**
 * 数据访问层集成
 * 统一数据访问接口，集成Repository模式和缓存策略
 */

/**
 * 数据访问层主类
 */
class DataAccessLayer {
    constructor() {
        this.storageManager = null;
        this.repositoryFactory = null;
        this.cacheManager = null;
        this.isInitialized = false;
        this.initializationPromise = null;
    }

    /**
     * 初始化数据访问层
     */
    async initialize() {
        if (this.isInitialized) {
            return this.initializationPromise;
        }

        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this._doInitialize();
        return this.initializationPromise;
    }

    async _doInitialize() {
        try {
            console.log('[DataAccessLayer] 开始初始化数据访问层...');

            // 等待存储管理器就绪
            if (!window.storage) {
                throw new Error('存储管理器未就绪');
            }

            // 确保存储管理器初始化完成
            if (window.storage.initializeStorage) {
                await window.storage.initializeStorage();
            }

            this.storageManager = window.storage;

            // 初始化缓存策略管理器
            this.cacheManager = window.cacheStrategyManager;

            // 创建Repository工厂
            this.repositoryFactory = new window.RepositoryFactory(this.storageManager);

            // 初始化特定缓存管理器
            this._initializeCacheManagers();

            // 预热关键缓存
            await this._warmupCriticalCache();

            this.isInitialized = true;
            console.log('[DataAccessLayer] 数据访问层初始化完成');

            return true;
        } catch (error) {
            console.error('[DataAccessLayer] 初始化失败:', error);
            throw error;
        }
    }

    /**
     * 初始化缓存管理器
     */
    _initializeCacheManagers() {
        // 练习记录缓存管理器
        this.cacheManager.createManager('practiceRecords', {
            strategy: window.CacheStrategy.TTL,
            maxSize: 50,
            defaultTTL: 10 * 60 * 1000 // 10分钟
        });

        // 考试索引缓存管理器
        this.cacheManager.createManager('examIndex', {
            strategy: window.CacheStrategy.LRU,
            maxSize: 200,
            defaultTTL: 30 * 60 * 1000 // 30分钟
        });

        // 统计数据缓存管理器
        this.cacheManager.createManager('statistics', {
            strategy: window.CacheStrategy.TTL,
            maxSize: 20,
            defaultTTL: 5 * 60 * 1000 // 5分钟
        });

        // 用户设置缓存管理器
        this.cacheManager.createManager('userSettings', {
            strategy: window.CacheStrategy.LRU,
            maxSize: 100,
            defaultTTL: 60 * 60 * 1000 // 1小时
        });

        console.log('[DataAccessLayer] 缓存管理器初始化完成');
    }

    /**
     * 预热关键缓存
     */
    async _warmupCriticalCache() {
        try {
            console.log('[DataAccessLayer] 开始预热缓存...');

            const practiceRepo = this.repositoryFactory.getPracticeRecordRepository();
            const examRepo = this.repositoryFactory.getExamIndexRepository();

            // 预热分类数据
            await Promise.all([
                examRepo.getCategories(),
                practiceRepo.getStatistics()
            ]);

            console.log('[DataAccessLayer] 缓存预热完成');
        } catch (error) {
            console.warn('[DataAccessLayer] 缓存预热失败:', error);
        }
    }

    /**
     * 获取练习记录Repository
     */
    getPracticeRecordRepository() {
        this._ensureInitialized();
        return this.repositoryFactory.getPracticeRecordRepository();
    }

    /**
     * 获取考试索引Repository
     */
    getExamIndexRepository() {
        this._ensureInitialized();
        return this.repositoryFactory.getExamIndexRepository();
    }

    /**
     * 获取用户设置Repository
     */
    getUserSettingsRepository() {
        this._ensureInitialized();
        return this.repositoryFactory.getUserSettingsRepository();
    }

    /**
     * 获取缓存管理器
     */
    getCacheManager(name) {
        this._ensureInitialized();
        return this.cacheManager.getManager(name);
    }

    /**
     * 确保已初始化
     */
    _ensureInitialized() {
        if (!this.isInitialized) {
            throw new Error('数据访问层未初始化，请先调用 initialize()');
        }
    }

    /**
     * 批量数据操作
     */
    async batchOperation(operations) {
        this._ensureInitialized();
        const results = [];

        for (const operation of operations) {
            try {
                const result = await this._executeOperation(operation);
                results.push({ success: true, result, operation });
            } catch (error) {
                results.push({ success: false, error: error.message, operation });
            }
        }

        return results;
    }

    /**
     * 执行单个操作
     */
    async _executeOperation(operation) {
        const { type, repository, data, options } = operation;
        let repo;

        switch (repository) {
            case 'practiceRecord':
                repo = this.getPracticeRecordRepository();
                break;
            case 'examIndex':
                repo = this.getExamIndexRepository();
                break;
            case 'userSettings':
                repo = this.getUserSettingsRepository();
                break;
            default:
                throw new Error(`未知的Repository: ${repository}`);
        }

        switch (type) {
            case 'get':
                return repo.get(data.id, options);
            case 'getAll':
                return repo.getAll(options);
            case 'save':
                return repo.save(data);
            case 'delete':
                return repo.delete(data.id);
            case 'query':
                return repo.query(data, options);
            default:
                throw new Error(`未知的操作类型: ${type}`);
        }
    }

    /**
     * 事务操作
     */
    async transaction(operations) {
        this._ensureInitialized();

        // 开始事务前备份数据
        const backups = new Map();

        try {
            // 备份相关数据
            for (const operation of operations) {
                if (operation.type === 'save' || operation.type === 'delete') {
                    const repo = this._getRepository(operation.repository);
                    const backup = await repo.get(operation.data.id);
                    backups.set(`${operation.repository}:${operation.data.id}`, backup);
                }
            }

            // 执行操作
            const results = await this.batchOperation(operations);

            // 检查是否所有操作都成功
            const hasFailures = results.some(result => !result.success);
            if (hasFailures) {
                throw new Error('事务中存在失败操作，开始回滚');
            }

            return results;
        } catch (error) {
            console.warn('[DataAccessLayer] 事务失败，开始回滚:', error);

            // 回滚操作
            for (const [key, backup] of backups) {
                try {
                    const [repositoryType, id] = key.split(':');
                    const repo = this._getRepository(repositoryType);

                    if (backup) {
                        await repo.save(backup);
                    } else {
                        await repo.delete(id);
                    }
                } catch (rollbackError) {
                    console.error(`[DataAccessLayer] 回滚失败: ${key}`, rollbackError);
                }
            }

            throw error;
        }
    }

    /**
     * 获取Repository实例
     */
    _getRepository(repositoryType) {
        switch (repositoryType) {
            case 'practiceRecord':
                return this.getPracticeRecordRepository();
            case 'examIndex':
                return this.getExamIndexRepository();
            case 'userSettings':
                return this.getUserSettingsRepository();
            default:
                throw new Error(`未知的Repository类型: ${repositoryType}`);
        }
    }

    /**
     * 数据同步
     */
    async syncData() {
        this._ensureInitialized();

        try {
            console.log('[DataAccessLayer] 开始数据同步...');

            // 清除所有缓存
            this.cacheManager.clearAll();

            // 重新预热缓存
            await this._warmupCriticalCache();

            console.log('[DataAccessLayer] 数据同步完成');
            return true;
        } catch (error) {
            console.error('[DataAccessLayer] 数据同步失败:', error);
            throw error;
        }
    }

    /**
     * 获取性能统计
     */
    getPerformanceStats() {
        if (!this.isInitialized) {
            return { initialized: false };
        }

        const cacheStats = this.cacheManager.getAllStats();
        const storageInfo = this.storageManager ? this.storageManager.getStorageInfo() : null;

        return {
            initialized: this.isInitialized,
            cache: cacheStats,
            storage: storageInfo,
            repositories: {
                practiceRecord: !!this.repositoryFactory.repositories.get('practiceRecord'),
                examIndex: !!this.repositoryFactory.repositories.get('examIndex'),
                userSettings: !!this.repositoryFactory.repositories.get('userSettings')
            }
        };
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.cacheManager) {
            // 清理所有缓存管理器
            const managers = Array.from(this.cacheManager.managers.keys());
            for (const managerName of managers) {
                this.cacheManager.deleteManager(managerName);
            }
        }

        this.storageManager = null;
        this.repositoryFactory = null;
        this.cacheManager = null;
        this.isInitialized = false;
        this.initializationPromise = null;

        console.log('[DataAccessLayer] 资源清理完成');
    }
}

/**
 * 全局数据访问层实例
 */
window.dataAccessLayer = new DataAccessLayer();

/**
 * 兼容性包装器 - 保持向后兼容
 */
class LegacyStorageWrapper {
    constructor() {
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        await window.dataAccessLayer.initialize();
        this.initialized = true;
    }

    async get(key, defaultValue = null) {
        await this.initialize();
        return window.storage.get(key, defaultValue);
    }

    async set(key, value) {
        await this.initialize();
        return window.storage.set(key, value);
    }

    async remove(key) {
        await this.initialize();
        return window.storage.remove(key);
    }

    async clear() {
        await this.initialize();
        return window.storage.clear();
    }
}

// 创建兼容性包装器
window.legacyStorage = new LegacyStorageWrapper();

// 导出类
window.DataAccessLayer = DataAccessLayer;
window.LegacyStorageWrapper = LegacyStorageWrapper;