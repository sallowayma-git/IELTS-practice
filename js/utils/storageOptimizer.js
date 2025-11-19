/**
 * 存储性能优化工具
 * 定期清理、压缩和索引优化
 */
(function(window) {
    'use strict';

    const CLEANUP_CONFIG = {
        MAX_RECORDS: 100, // 最大记录数
        MAX_AGE_DAYS: 90, // 最大保留天数
        CLEANUP_INTERVAL: 24 * 60 * 60 * 1000, // 清理间隔（24小时）
        COMPRESSION_THRESHOLD: 1024 * 10 // 压缩阈值（10KB）
    };

    let cleanupTimer = null;

    /**
     * 清理过期数据
     * @param {Object} storage - 存储管理器
     * @returns {Promise<Object>} 清理统计
     */
    async function cleanupExpiredData(storage) {
        if (!storage) {
            throw new Error('Storage 不可用');
        }

        console.log('[StorageOptimizer] 开始清理过期数据');
        const stats = {
            recordsCleaned: 0,
            bytesFreed: 0,
            errors: []
        };

        try {
            // 清理练习记录
            const records = await storage.get('practice_records', []);
            if (Array.isArray(records) && records.length > 0) {
                const now = Date.now();
                const maxAge = CLEANUP_CONFIG.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

                // 按时间排序，保留最新的记录
                const sortedRecords = records.sort((a, b) => {
                    const timeA = a.timestamp || a.endTime || 0;
                    const timeB = b.timestamp || b.endTime || 0;
                    return timeB - timeA;
                });

                // 保留最新的MAX_RECORDS条记录
                let keptRecords = sortedRecords.slice(0, CLEANUP_CONFIG.MAX_RECORDS);

                // 过滤掉过期记录
                keptRecords = keptRecords.filter(record => {
                    const recordTime = record.timestamp || record.endTime || 0;
                    return (now - recordTime) < maxAge;
                });

                const removedCount = records.length - keptRecords.length;
                if (removedCount > 0) {
                    const oldSize = JSON.stringify(records).length;
                    const newSize = JSON.stringify(keptRecords).length;

                    await storage.set('practice_records', keptRecords);

                    stats.recordsCleaned += removedCount;
                    stats.bytesFreed += (oldSize - newSize);

                    console.log(`[StorageOptimizer] 清理了 ${removedCount} 条练习记录，释放 ${(stats.bytesFreed / 1024).toFixed(2)}KB`);
                }
            }

            // 清理词表中的重复单词
            const vocabLists = ['vocab_list_p1_errors', 'vocab_list_p4_errors', 'vocab_list_master_errors'];
            for (const listKey of vocabLists) {
                const listData = await storage.get(listKey, null);
                if (listData && listData.words && Array.isArray(listData.words)) {
                    const originalCount = listData.words.length;
                    
                    // 去重（基于word字段）
                    const uniqueWords = [];
                    const seenWords = new Set();
                    
                    listData.words.forEach(wordEntry => {
                        const word = wordEntry.word;
                        if (word && !seenWords.has(word)) {
                            seenWords.add(word);
                            uniqueWords.push(wordEntry);
                        }
                    });

                    if (uniqueWords.length < originalCount) {
                        listData.words = uniqueWords;
                        await storage.set(listKey, listData);
                        
                        const removedDuplicates = originalCount - uniqueWords.length;
                        console.log(`[StorageOptimizer] ${listKey}: 移除了 ${removedDuplicates} 个重复单词`);
                        stats.recordsCleaned += removedDuplicates;
                    }
                }
            }

        } catch (error) {
            console.error('[StorageOptimizer] 清理失败:', error);
            stats.errors.push(error.message);
        }

        console.log('[StorageOptimizer] 清理完成:', stats);
        return stats;
    }

    /**
     * 压缩大型数据
     * @param {Object} storage - 存储管理器
     * @returns {Promise<Object>} 压缩统计
     */
    async function compressLargeData(storage) {
        if (!storage) {
            throw new Error('Storage 不可用');
        }

        console.log('[StorageOptimizer] 开始压缩大型数据');
        const stats = {
            itemsCompressed: 0,
            bytesFreed: 0,
            errors: []
        };

        try {
            // 压缩练习记录
            const records = await storage.get('practice_records', []);
            if (Array.isArray(records) && records.length > 0) {
                let compressed = false;
                const compressedRecords = records.map(record => {
                    const recordSize = JSON.stringify(record).length;
                    
                    if (recordSize > CLEANUP_CONFIG.COMPRESSION_THRESHOLD) {
                        compressed = true;
                        return compressRecord(record);
                    }
                    
                    return record;
                });

                if (compressed) {
                    const oldSize = JSON.stringify(records).length;
                    const newSize = JSON.stringify(compressedRecords).length;
                    
                    await storage.set('practice_records', compressedRecords);
                    
                    stats.itemsCompressed = records.length;
                    stats.bytesFreed = oldSize - newSize;
                    
                    console.log(`[StorageOptimizer] 压缩了 ${stats.itemsCompressed} 条记录，释放 ${(stats.bytesFreed / 1024).toFixed(2)}KB`);
                }
            }

        } catch (error) {
            console.error('[StorageOptimizer] 压缩失败:', error);
            stats.errors.push(error.message);
        }

        return stats;
    }

    /**
     * 压缩单条记录
     * @param {Object} record - 记录对象
     * @returns {Object} 压缩后的记录
     */
    function compressRecord(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }

        const compressed = {
            id: record.id,
            examId: record.examId,
            title: record.title,
            category: record.category,
            score: record.score,
            totalQuestions: record.totalQuestions,
            accuracy: record.accuracy,
            duration: record.duration,
            timestamp: record.timestamp || record.endTime,
            dataSource: record.dataSource
        };

        // 压缩realData
        if (record.realData) {
            compressed.realData = {
                score: record.realData.score,
                totalQuestions: record.realData.totalQuestions,
                accuracy: record.realData.accuracy,
                isRealData: true
            };

            // 只保留答案的正误，不保留详细内容
            if (record.realData.answerComparison) {
                compressed.realData.results = {};
                Object.entries(record.realData.answerComparison).forEach(([qId, comp]) => {
                    compressed.realData.results[qId] = comp.isCorrect ? 1 : 0;
                });
            }
        }

        return compressed;
    }

    /**
     * 优化索引
     * @param {Object} storage - 存储管理器
     * @returns {Promise<Object>} 优化统计
     */
    async function optimizeIndexes(storage) {
        if (!storage) {
            throw new Error('Storage 不可用');
        }

        console.log('[StorageOptimizer] 开始优化索引');
        const stats = {
            indexesCreated: 0,
            errors: []
        };

        try {
            // 为练习记录创建索引
            const records = await storage.get('practice_records', []);
            if (Array.isArray(records) && records.length > 0) {
                // 创建按examId的索引
                const examIdIndex = {};
                records.forEach((record, index) => {
                    const examId = record.examId;
                    if (examId) {
                        if (!examIdIndex[examId]) {
                            examIdIndex[examId] = [];
                        }
                        examIdIndex[examId].push(index);
                    }
                });

                await storage.set('practice_records_index_examId', examIdIndex);
                stats.indexesCreated++;

                // 创建按category的索引
                const categoryIndex = {};
                records.forEach((record, index) => {
                    const category = record.category;
                    if (category) {
                        if (!categoryIndex[category]) {
                            categoryIndex[category] = [];
                        }
                        categoryIndex[category].push(index);
                    }
                });

                await storage.set('practice_records_index_category', categoryIndex);
                stats.indexesCreated++;

                console.log(`[StorageOptimizer] 创建了 ${stats.indexesCreated} 个索引`);
            }

        } catch (error) {
            console.error('[StorageOptimizer] 索引优化失败:', error);
            stats.errors.push(error.message);
        }

        return stats;
    }

    /**
     * 获取存储统计信息
     * @param {Object} storage - 存储管理器
     * @returns {Promise<Object>} 统计信息
     */
    async function getStorageStats(storage) {
        if (!storage) {
            throw new Error('Storage 不可用');
        }

        const stats = {
            practiceRecords: 0,
            vocabLists: {},
            totalSize: 0,
            lastCleanup: null
        };

        try {
            // 练习记录统计
            const records = await storage.get('practice_records', []);
            stats.practiceRecords = Array.isArray(records) ? records.length : 0;
            stats.totalSize += JSON.stringify(records).length;

            // 词表统计
            const vocabLists = ['vocab_list_p1_errors', 'vocab_list_p4_errors', 'vocab_list_master_errors'];
            for (const listKey of vocabLists) {
                const listData = await storage.get(listKey, null);
                if (listData && listData.words) {
                    stats.vocabLists[listKey] = listData.words.length;
                    stats.totalSize += JSON.stringify(listData).length;
                }
            }

            // 最后清理时间
            stats.lastCleanup = await storage.get('last_cleanup_time', null);

        } catch (error) {
            console.error('[StorageOptimizer] 获取统计信息失败:', error);
        }

        return stats;
    }

    /**
     * 执行完整优化
     * @param {Object} storage - 存储管理器
     * @returns {Promise<Object>} 优化统计
     */
    async function performFullOptimization(storage) {
        if (!storage) {
            throw new Error('Storage 不可用');
        }

        console.log('[StorageOptimizer] 开始完整优化');
        const startTime = Date.now();

        const results = {
            cleanup: null,
            compression: null,
            indexing: null,
            duration: 0
        };

        try {
            // 1. 清理过期数据
            results.cleanup = await cleanupExpiredData(storage);

            // 2. 压缩大型数据
            results.compression = await compressLargeData(storage);

            // 3. 优化索引
            results.indexing = await optimizeIndexes(storage);

            // 记录最后优化时间
            await storage.set('last_cleanup_time', Date.now());

            results.duration = Date.now() - startTime;
            console.log(`[StorageOptimizer] 完整优化完成，耗时 ${results.duration}ms`);

        } catch (error) {
            console.error('[StorageOptimizer] 完整优化失败:', error);
            throw error;
        }

        return results;
    }

    /**
     * 启动自动清理
     * @param {Object} storage - 存储管理器
     */
    function startAutoCleanup(storage) {
        if (cleanupTimer) {
            console.warn('[StorageOptimizer] 自动清理已启动');
            return;
        }

        console.log('[StorageOptimizer] 启动自动清理');

        // 立即执行一次
        performFullOptimization(storage).catch(error => {
            console.error('[StorageOptimizer] 初始优化失败:', error);
        });

        // 定期执行
        cleanupTimer = setInterval(() => {
            performFullOptimization(storage).catch(error => {
                console.error('[StorageOptimizer] 定期优化失败:', error);
            });
        }, CLEANUP_CONFIG.CLEANUP_INTERVAL);
    }

    /**
     * 停止自动清理
     */
    function stopAutoCleanup() {
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
            console.log('[StorageOptimizer] 停止自动清理');
        }
    }

    // 导出API
    const api = {
        cleanupExpiredData,
        compressLargeData,
        optimizeIndexes,
        getStorageStats,
        performFullOptimization,
        startAutoCleanup,
        stopAutoCleanup,
        
        // 配置
        get config() {
            return { ...CLEANUP_CONFIG };
        },
        
        setConfig(newConfig) {
            Object.assign(CLEANUP_CONFIG, newConfig);
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.StorageOptimizer = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
