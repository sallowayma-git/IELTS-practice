/**
 * 缓存策略实现
 * 提供智能缓存管理，提升数据访问性能
 */

/**
 * 缓存策略枚举
 */
const CacheStrategy = {
    MEMORY_ONLY: 'memory_only',
    LRU: 'lru',
    TTL: 'ttl',
    WRITE_THROUGH: 'write_through',
    WRITE_BEHIND: 'write_behind'
};

/**
 * 缓存项
 */
class CacheItem {
    constructor(key, value, ttl = null) {
        this.key = key;
        this.value = value;
        this.createdAt = Date.now();
        this.ttl = ttl;
        this.accessCount = 0;
        this.lastAccessed = Date.now();
    }

    isExpired() {
        if (!this.ttl) return false;
        return Date.now() - this.createdAt > this.ttl;
    }

    touch() {
        this.accessCount++;
        this.lastAccessed = Date.now();
    }
}

/**
 * LRU缓存实现
 */
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (this.cache.has(key)) {
            const item = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, item);
            return item.value;
        }
        return null;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, accessTime: Date.now() });
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }
}

/**
 * TTL缓存实现
 */
class TTLCache {
    constructor(defaultTTL = 5 * 60 * 1000) { // 默认5分钟
        this.defaultTTL = defaultTTL;
        this.cache = new Map();
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // 每分钟清理一次
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (item.isExpired()) {
            this.cache.delete(key);
            return null;
        }

        item.touch();
        return item.value;
    }

    set(key, value, ttl = null) {
        const item = new CacheItem(key, value, ttl || this.defaultTTL);
        this.cache.set(key, item);
    }

    has(key) {
        const item = this.cache.get(key);
        if (!item) return false;

        if (item.isExpired()) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    size() {
        this.cleanup();
        return this.cache.size;
    }

    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (item.isExpired()) {
                this.cache.delete(key);
            }
        }
    }

    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

/**
 * 智能缓存管理器
 */
class SmartCacheManager {
    constructor(options = {}) {
        this.strategy = options.strategy || CacheStrategy.TTL;
        this.maxSize = options.maxSize || 100;
        this.defaultTTL = options.defaultTTL || 5 * 60 * 1000;
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            cleanups: 0
        };

        this.initCache();
        this.startPerformanceMonitoring();
    }

    initCache() {
        switch (this.strategy) {
            case CacheStrategy.LRU:
                this.cache = new LRUCache(this.maxSize);
                break;
            case CacheStrategy.TTL:
                this.cache = new TTLCache(this.defaultTTL);
                break;
            default:
                this.cache = new Map();
        }
    }

    get(key) {
        const startTime = performance.now();

        let value;
        if (this.cache instanceof LRUCache || this.cache instanceof TTLCache) {
            value = this.cache.get(key);
        } else {
            const item = this.cache.get(key);
            if (item && !item.isExpired()) {
                item.touch();
                value = item.value;
            } else if (item && item.isExpired()) {
                this.cache.delete(key);
                value = null;
            }
        }

        const endTime = performance.now();
        const accessTime = endTime - startTime;

        if (value !== null && value !== undefined) {
            this.stats.hits++;
            this.recordAccess(key, 'hit', accessTime);
        } else {
            this.stats.misses++;
            this.recordAccess(key, 'miss', accessTime);
        }

        return value;
    }

    set(key, value, ttl = null) {
        const startTime = performance.now();

        if (this.cache instanceof LRUCache) {
            this.cache.set(key, value);
        } else if (this.cache instanceof TTLCache) {
            this.cache.set(key, value, ttl);
        } else {
            const item = new CacheItem(key, value, ttl || this.defaultTTL);
            this.cache.set(key, item);
        }

        const endTime = performance.now();
        const accessTime = endTime - startTime;

        this.stats.sets++;
        this.recordAccess(key, 'set', accessTime);
    }

    has(key) {
        if (this.cache instanceof LRUCache || this.cache instanceof TTLCache) {
            return this.cache.has(key);
        } else {
            const item = this.cache.get(key);
            if (!item) return false;

            if (item.isExpired()) {
                this.cache.delete(key);
                return false;
            }

            return true;
        }
    }

    delete(key) {
        let deleted = false;

        if (this.cache instanceof LRUCache || this.cache instanceof TTLCache) {
            deleted = this.cache.delete(key);
        } else {
            deleted = this.cache.delete(key);
        }

        if (deleted) {
            this.stats.deletes++;
        }

        return deleted;
    }

    clear(pattern = null) {
        if (pattern) {
            if (this.cache instanceof Map) {
                for (const key of this.cache.keys()) {
                    if (key.includes(pattern)) {
                        this.cache.delete(key);
                    }
                }
            } else {
                // 对于LRUCache和TTLCache，需要重建缓存
                const newCache = this.cache instanceof LRUCache ?
                    new LRUCache(this.maxSize) : new TTLCache(this.defaultTTL);

                // 只保留不匹配pattern的项
                for (const [key, value] of this.cache.cache.entries()) {
                    if (!key.includes(pattern)) {
                        newCache.set(key, value);
                    }
                }
                this.cache = newCache;
            }
        } else {
            this.cache.clear();
        }
    }

    size() {
        if (this.cache instanceof LRUCache || this.cache instanceof TTLCache) {
            return this.cache.size();
        } else {
            return this.cache.size;
        }
    }

    getHitRate() {
        const total = this.stats.hits + this.stats.misses;
        return total > 0 ? (this.stats.hits / total) * 100 : 0;
    }

    getStats() {
        return {
            ...this.stats,
            hitRate: this.getHitRate(),
            size: this.size(),
            strategy: this.strategy
        };
    }

    recordAccess(key, type, accessTime) {
        if (!this.accessStats) {
            this.accessStats = new Map();
        }

        if (!this.accessStats.has(key)) {
            this.accessStats.set(key, {
                hits: 0,
                misses: 0,
                sets: 0,
                totalAccessTime: 0,
                averageAccessTime: 0
            });
        }

        const stats = this.accessStats.get(key);
        if (type === 'hit') stats.hits++;
        else if (type === 'miss') stats.misses++;
        else if (type === 'set') stats.sets++;

        stats.totalAccessTime += accessTime;
        const totalAccesses = stats.hits + stats.misses + stats.sets;
        stats.averageAccessTime = stats.totalAccessTime / totalAccesses;
    }

    startPerformanceMonitoring() {
        // 每30秒输出一次性能统计
        this.monitoringInterval = setInterval(() => {
            const stats = this.getStats();
            if (stats.hits + stats.misses > 0) {
                console.log(`[Cache] 命中率: ${stats.hitRate.toFixed(2)}%, 大小: ${stats.size}, 访问次数: ${stats.hits + stats.misses}`);
            }
        }, 30000);

        // 页面卸载时清理
        window.addEventListener('beforeunload', () => {
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
            }
            if (this.cache instanceof TTLCache) {
                this.cache.destroy();
            }
        });
    }

    // 获取热点数据
    getHotData(limit = 10) {
        if (!this.accessStats) return [];

        const sorted = Array.from(this.accessStats.entries())
            .sort((a, b) => b[1].hits - a[1].hits)
            .slice(0, limit);

        return sorted.map(([key, stats]) => ({
            key,
            hits: stats.hits,
            hitRate: (stats.hits / (stats.hits + stats.misses)) * 100,
            averageAccessTime: stats.averageAccessTime
        }));
    }

    // 预热缓存
    async warmup(dataLoader, keys) {
        console.log(`[Cache] 开始预热缓存，共${keys.length}个键`);

        const promises = keys.map(async (key) => {
            try {
                if (!this.has(key)) {
                    const data = await dataLoader(key);
                    this.set(key, data);
                }
            } catch (error) {
                console.warn(`[Cache] 预热失败: ${key}`, error);
            }
        });

        await Promise.all(promises);
        console.log(`[Cache] 预热完成`);
    }
}

/**
 * 缓存策略管理器
 */
class CacheStrategyManager {
    constructor() {
        this.managers = new Map();
        this.globalStats = {
            totalHits: 0,
            totalMisses: 0,
            totalSets: 0
        };
    }

    createManager(name, options = {}) {
        if (this.managers.has(name)) {
            console.warn(`[Cache] 缓存管理器 ${name} 已存在`);
            return this.managers.get(name);
        }

        const manager = new SmartCacheManager(options);
        this.managers.set(name, manager);

        // 监听统计信息
        const originalGetStats = manager.getStats.bind(manager);
        manager.getStats = () => {
            const stats = originalGetStats();
            this.updateGlobalStats(stats);
            return stats;
        };

        return manager;
    }

    getManager(name) {
        return this.managers.get(name);
    }

    deleteManager(name) {
        const manager = this.managers.get(name);
        if (manager) {
            if (manager.cache instanceof TTLCache) {
                manager.cache.destroy();
            }
            if (manager.monitoringInterval) {
                clearInterval(manager.monitoringInterval);
            }
            this.managers.delete(name);
            return true;
        }
        return false;
    }

    updateGlobalStats(stats) {
        this.globalStats.totalHits += stats.hits;
        this.globalStats.totalMisses += stats.misses;
        this.globalStats.totalSets += stats.sets;
    }

    getGlobalStats() {
        const globalHitRate = (this.globalStats.totalHits + this.globalStats.totalMisses) > 0 ?
            (this.globalStats.totalHits / (this.globalStats.totalHits + this.globalStats.totalMisses)) * 100 : 0;

        return {
            ...this.globalStats,
            globalHitRate,
            managerCount: this.managers.size
        };
    }

    clearAll(pattern = null) {
        for (const [name, manager] of this.managers) {
            manager.clear(pattern);
        }
    }

    getAllStats() {
        const stats = {
            global: this.getGlobalStats(),
            managers: {}
        };

        for (const [name, manager] of this.managers) {
            stats.managers[name] = manager.getStats();
        }

        return stats;
    }
}

// 创建全局缓存策略管理器
window.cacheStrategyManager = new CacheStrategyManager();

// 导出类和常量
window.CacheStrategy = CacheStrategy;
window.SmartCacheManager = SmartCacheManager;
window.CacheStrategyManager = CacheStrategyManager;
window.LRUCache = LRUCache;
window.TTLCache = TTLCache;