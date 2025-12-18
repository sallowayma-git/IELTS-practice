/**
 * 数据加载优化器
 * 实现懒加载、缓存和性能优化
 */
(function(window) {
    'use strict';

    // 缓存配置
    const CACHE_CONFIG = {
        MAX_SIZE: 50, // 最大缓存项数
        TTL: 5 * 60 * 1000, // 缓存有效期 5分钟
        PRELOAD_THRESHOLD: 3 // 预加载阈值（滚动到第N项时预加载）
    };

    // 缓存存储
    const cache = new Map();
    const cacheTimestamps = new Map();
    const loadingPromises = new Map();

    /**
     * 检查缓存是否有效
     */
    function isCacheValid(key) {
        if (!cache.has(key)) return false;
        
        const timestamp = cacheTimestamps.get(key);
        if (!timestamp) return false;
        
        return (Date.now() - timestamp) < CACHE_CONFIG.TTL;
    }

    /**
     * 设置缓存
     */
    function setCache(key, value) {
        // 如果缓存已满，删除最旧的项
        if (cache.size >= CACHE_CONFIG.MAX_SIZE) {
            const oldestKey = Array.from(cacheTimestamps.entries())
                .sort((a, b) => a[1] - b[1])[0][0];
            cache.delete(oldestKey);
            cacheTimestamps.delete(oldestKey);
        }
        
        cache.set(key, value);
        cacheTimestamps.set(key, Date.now());
    }

    /**
     * 获取缓存
     */
    function getCache(key) {
        if (isCacheValid(key)) {
            return cache.get(key);
        }
        
        // 清理过期缓存
        cache.delete(key);
        cacheTimestamps.delete(key);
        return null;
    }

    /**
     * 清除所有缓存
     */
    function clearCache() {
        cache.clear();
        cacheTimestamps.clear();
        loadingPromises.clear();
    }

    /**
     * 懒加载词表数据
     * @param {string} listId - 词表ID
     * @param {boolean} forceReload - 强制重新加载
     * @returns {Promise<Object>} 词表数据
     */
    async function lazyLoadVocabList(listId, forceReload = false) {
        const cacheKey = `vocab_list_${listId}`;
        
        // 检查缓存
        if (!forceReload) {
            const cached = getCache(cacheKey);
            if (cached) {
                console.log(`[DataLoadOptimizer] 从缓存加载词表: ${listId}`);
                return cached;
            }
        }
        
        // 检查是否正在加载
        if (loadingPromises.has(cacheKey)) {
            console.log(`[DataLoadOptimizer] 等待现有加载: ${listId}`);
            return loadingPromises.get(cacheKey);
        }
        
        // 开始加载
        console.log(`[DataLoadOptimizer] 开始加载词表: ${listId}`);
        const loadPromise = (async () => {
            try {
                const vocabStore = window.VocabStore;
                if (!vocabStore || typeof vocabStore.loadList !== 'function') {
                    throw new Error('VocabStore 不可用');
                }
                
                const listData = await vocabStore.loadList(listId);
                
                // 缓存结果
                if (listData) {
                    setCache(cacheKey, listData);
                }
                
                return listData;
            } finally {
                loadingPromises.delete(cacheKey);
            }
        })();
        
        loadingPromises.set(cacheKey, loadPromise);
        return loadPromise;
    }

    /**
     * 批量预加载词表
     * @param {Array<string>} listIds - 词表ID数组
     */
    async function preloadVocabLists(listIds) {
        if (!Array.isArray(listIds) || listIds.length === 0) {
            return;
        }
        
        console.log(`[DataLoadOptimizer] 预加载 ${listIds.length} 个词表`);
        
        // 并行加载，但不阻塞
        const promises = listIds.map(listId => 
            lazyLoadVocabList(listId).catch(err => {
                console.warn(`[DataLoadOptimizer] 预加载失败: ${listId}`, err);
                return null;
            })
        );
        
        // 不等待完成，让它们在后台加载
        Promise.all(promises).then(() => {
            console.log(`[DataLoadOptimizer] 预加载完成`);
        });
    }

    /**
     * 懒加载练习记录（分页）
     * @param {number} page - 页码（从0开始）
     * @param {number} pageSize - 每页大小
     * @returns {Promise<Array>} 练习记录数组
     */
    async function lazyLoadPracticeRecords(page = 0, pageSize = 20) {
        const cacheKey = `practice_records_${page}_${pageSize}`;
        
        // 检查缓存
        const cached = getCache(cacheKey);
        if (cached) {
            console.log(`[DataLoadOptimizer] 从缓存加载练习记录: 第${page}页`);
            return cached;
        }
        
        console.log(`[DataLoadOptimizer] 加载练习记录: 第${page}页`);
        
        try {
            const storage = window.storage;
            if (!storage) {
                throw new Error('Storage 不可用');
            }
            
            // 获取所有记录
            const allRecords = await storage.get('practice_records', []);
            
            // 分页
            const start = page * pageSize;
            const end = start + pageSize;
            const pageRecords = allRecords.slice(start, end);
            
            // 缓存结果
            setCache(cacheKey, pageRecords);
            
            return pageRecords;
        } catch (error) {
            console.error('[DataLoadOptimizer] 加载练习记录失败:', error);
            return [];
        }
    }

    /**
     * 获取词表单词数（优化版）
     * @param {string} listId - 词表ID
     * @returns {Promise<number>} 单词数量
     */
    async function getVocabListCount(listId) {
        const cacheKey = `vocab_count_${listId}`;
        
        // 检查缓存
        const cached = getCache(cacheKey);
        if (cached !== null && cached !== undefined) {
            return cached;
        }
        
        try {
            const vocabStore = window.VocabStore;
            if (!vocabStore || typeof vocabStore.getListWordCount !== 'function') {
                return 0;
            }
            
            const count = await vocabStore.getListWordCount(listId);
            
            // 缓存结果（单词数变化不频繁，可以缓存更久）
            setCache(cacheKey, count);
            
            return count;
        } catch (error) {
            console.error('[DataLoadOptimizer] 获取词表单词数失败:', error);
            return 0;
        }
    }

    /**
     * 批量获取词表单词数
     * @param {Array<string>} listIds - 词表ID数组
     * @returns {Promise<Object>} { listId: count }
     */
    async function batchGetVocabListCounts(listIds) {
        if (!Array.isArray(listIds) || listIds.length === 0) {
            return {};
        }
        
        console.log(`[DataLoadOptimizer] 批量获取 ${listIds.length} 个词表单词数`);
        
        const results = {};
        const promises = listIds.map(async (listId) => {
            const count = await getVocabListCount(listId);
            results[listId] = count;
        });
        
        await Promise.all(promises);
        return results;
    }

    /**
     * 清理过期缓存
     */
    function cleanupExpiredCache() {
        const now = Date.now();
        const expiredKeys = [];
        
        cacheTimestamps.forEach((timestamp, key) => {
            if (now - timestamp >= CACHE_CONFIG.TTL) {
                expiredKeys.push(key);
            }
        });
        
        expiredKeys.forEach(key => {
            cache.delete(key);
            cacheTimestamps.delete(key);
        });
        
        if (expiredKeys.length > 0) {
            console.log(`[DataLoadOptimizer] 清理了 ${expiredKeys.length} 个过期缓存`);
        }
    }

    /**
     * 获取缓存统计信息
     */
    function getCacheStats() {
        return {
            size: cache.size,
            maxSize: CACHE_CONFIG.MAX_SIZE,
            ttl: CACHE_CONFIG.TTL,
            keys: Array.from(cache.keys())
        };
    }

    // 定期清理过期缓存（每分钟）
    setInterval(cleanupExpiredCache, 60 * 1000);

    // 导出API
    const api = {
        lazyLoadVocabList,
        preloadVocabLists,
        lazyLoadPracticeRecords,
        getVocabListCount,
        batchGetVocabListCounts,
        clearCache,
        getCacheStats,
        
        // 配置
        get config() {
            return { ...CACHE_CONFIG };
        },
        
        setConfig(newConfig) {
            Object.assign(CACHE_CONFIG, newConfig);
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.DataLoadOptimizer = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
