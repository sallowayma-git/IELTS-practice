/**
 * SpellingErrorCollector - 拼写错误收集组件
 * 
 * 功能：
 * 1. 检测听力填空题中的单词拼写错误
 * 2. 收集错误单词并存储到词表
 * 3. 管理多个词表（P1、P4、综合）
 * 4. 支持错误次数统计和去重
 * 
 * 数据结构：
 * - SpellingError: 单个拼写错误记录
 * - VocabularyList: 词表结构
 */

(function() {
    'use strict';

    /**
     * 拼写错误记录数据结构
     * @typedef {Object} SpellingError
     * @property {string} word - 正确单词
     * @property {string} userInput - 用户输入的错误拼写
     * @property {string} questionId - 题目ID
     * @property {string} suiteId - 套题ID（可选）
     * @property {string} examId - 考试ID
     * @property {number} timestamp - 错误发生时间戳
     * @property {number} errorCount - 错误次数
     * @property {string} source - 来源标识 ('p1' | 'p4' | 'other')
     * @property {Object} [metadata] - 额外元数据
     * @property {string} [metadata.context] - 上下文信息
     * @property {string} [metadata.difficulty] - 难度级别
     */

    /**
     * 词表数据结构
     * @typedef {Object} VocabularyList
     * @property {string} id - 词表唯一标识
     * @property {string} name - 词表名称
     * @property {string} source - 来源标识 ('p1' | 'p4' | 'all' | 'user')
     * @property {SpellingError[]} words - 单词列表
     * @property {number} createdAt - 创建时间戳
     * @property {number} updatedAt - 最后更新时间戳
     * @property {Object} stats - 统计信息
     * @property {number} stats.totalWords - 总单词数
     * @property {number} stats.masteredWords - 已掌握单词数
     * @property {number} stats.reviewingWords - 复习中单词数
     */

    /**
     * SpellingErrorCollector 类
     */
    class SpellingErrorCollector {
        constructor() {
            console.log('[SpellingErrorCollector] 初始化拼写错误收集器');
            
            // 错误缓存，用于临时存储检测到的错误
            this.errorCache = new Map();
            
            // 词表存储键配置
            this.storageKeys = {
                p1: 'vocab_list_p1_errors',
                p4: 'vocab_list_p4_errors',
                master: 'vocab_list_master_errors',
                custom: 'vocab_list_custom'
            };
            
            // 初始化完成标志
            this.initialized = false;
            
            // 执行初始化
            this.init();
        }

        /**
         * 初始化方法
         */
        async init() {
            try {
                // 等待存储系统就绪
                if (window.storage && window.storage.ready) {
                    await window.storage.ready;
                }
                
                // 设置命名空间
                if (window.storage && typeof window.storage.setNamespace === 'function') {
                    window.storage.setNamespace('exam_system');
                    console.log('[SpellingErrorCollector] 存储命名空间已设置');
                }
                
                this.initialized = true;
                console.log('[SpellingErrorCollector] 初始化完成');
            } catch (error) {
                console.error('[SpellingErrorCollector] 初始化失败:', error);
                this.initialized = false;
            }
        }

        /**
         * 确保初始化完成
         * @returns {Promise<void>}
         */
        async ensureInitialized() {
            if (this.initialized) {
                return;
            }
            
            // 等待初始化完成
            let attempts = 0;
            while (!this.initialized && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (!this.initialized) {
                throw new Error('SpellingErrorCollector 初始化超时');
            }
        }

        /**
         * 从examId中检测来源（p1或p4）
         * @param {string} examId - 考试ID
         * @returns {string} 来源标识 ('p1' | 'p4' | 'other')
         */
        detectSource(examId) {
            if (!examId || typeof examId !== 'string') {
                return 'other';
            }
            
            const lowerExamId = examId.toLowerCase();
            
            // 检测P1
            if (lowerExamId.includes('p1') || lowerExamId.includes('part1') || lowerExamId.includes('part-1')) {
                return 'p1';
            }
            
            // 检测P4
            if (lowerExamId.includes('p4') || lowerExamId.includes('part4') || lowerExamId.includes('part-4')) {
                return 'p4';
            }
            
            // 检测路径中的P1/P4
            if (lowerExamId.includes('100 p1') || lowerExamId.includes('100p1')) {
                return 'p1';
            }
            
            if (lowerExamId.includes('100 p4') || lowerExamId.includes('100p4')) {
                return 'p4';
            }
            
            return 'other';
        }

        /**
         * 创建空词表
         * @param {string} listId - 词表ID
         * @param {string} source - 来源标识
         * @returns {VocabularyList} 新创建的词表对象
         */
        createEmptyList(listId, source) {
            const names = {
                p1: 'P1 拼写错误词表',
                p4: 'P4 拼写错误词表',
                master: '综合拼写错误词表',
                custom: '自定义词表'
            };
            
            return {
                id: listId,
                name: names[source] || '词表',
                source: source,
                words: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                stats: {
                    totalWords: 0,
                    masteredWords: 0,
                    reviewingWords: 0
                }
            };
        }

        /**
         * 加载词表
         * @param {string} listId - 词表ID
         * @returns {Promise<VocabularyList|null>} 词表对象或null
         */
        async loadVocabList(listId) {
            try {
                await this.ensureInitialized();
                
                const storageKey = this.storageKeys[listId] || listId;
                
                if (!window.storage) {
                    console.warn('[SpellingErrorCollector] 存储系统不可用');
                    return null;
                }
                
                const list = await window.storage.get(storageKey);
                
                if (list && typeof list === 'object') {
                    console.log(`[SpellingErrorCollector] 加载词表成功: ${listId}, 单词数: ${list.words?.length || 0}`);
                    return list;
                }
                
                console.log(`[SpellingErrorCollector] 词表不存在: ${listId}`);
                return null;
            } catch (error) {
                console.error(`[SpellingErrorCollector] 加载词表失败: ${listId}`, error);
                return null;
            }
        }

        /**
         * 保存词表
         * @param {VocabularyList} vocabList - 词表对象
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveVocabList(vocabList) {
            try {
                await this.ensureInitialized();
                
                if (!vocabList || !vocabList.id) {
                    console.error('[SpellingErrorCollector] 无效的词表对象');
                    return false;
                }
                
                // 更新统计信息
                vocabList.stats = vocabList.stats || {};
                vocabList.stats.totalWords = vocabList.words.length;
                vocabList.updatedAt = Date.now();
                
                const storageKey = this.storageKeys[vocabList.id] || vocabList.id;
                
                if (!window.storage) {
                    console.warn('[SpellingErrorCollector] 存储系统不可用');
                    return false;
                }
                
                await window.storage.set(storageKey, vocabList);
                console.log(`[SpellingErrorCollector] 保存词表成功: ${vocabList.id}, 单词数: ${vocabList.words.length}`);
                
                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 保存词表失败:', error);
                return false;
            }
        }

        /**
         * 获取词表单词数量
         * @param {string} listId - 词表ID
         * @returns {Promise<number>} 单词数量
         */
        async getWordCount(listId) {
            try {
                const list = await this.loadVocabList(listId);
                return list ? list.words.length : 0;
            } catch (error) {
                console.error(`[SpellingErrorCollector] 获取词表单词数失败: ${listId}`, error);
                return 0;
            }
        }

        /**
         * 检测答案比较中的拼写错误
         * @param {Object} answerComparison - 答案比较对象，格式: { questionId: { userAnswer, correctAnswer, isCorrect } }
         * @param {string} suiteId - 套题ID（可选）
         * @param {string} examId - 考试ID
         * @returns {SpellingError[]} 检测到的拼写错误数组
         */
        detectErrors(answerComparison, suiteId, examId) {
            console.log('[SpellingErrorCollector] 开始检测拼写错误');
            
            if (!answerComparison || typeof answerComparison !== 'object') {
                console.warn('[SpellingErrorCollector] 无效的答案比较对象');
                return [];
            }
            
            const errors = [];
            const source = this.detectSource(examId);
            
            // 遍历所有答案比较
            for (const [questionId, comparison] of Object.entries(answerComparison)) {
                // 跳过正确答案
                if (comparison.isCorrect) {
                    continue;
                }
                
                // 判断是否为拼写错误
                if (this.isSpellingError(comparison)) {
                    const error = {
                        word: comparison.correctAnswer,
                        userInput: comparison.userAnswer,
                        questionId: questionId,
                        suiteId: suiteId || null,
                        examId: examId,
                        timestamp: Date.now(),
                        errorCount: 1,
                        source: source,
                        metadata: {}
                    };
                    
                    errors.push(error);
                    console.log(`[SpellingErrorCollector] 检测到拼写错误: ${questionId} - "${comparison.userAnswer}" → "${comparison.correctAnswer}"`);
                }
            }
            
            console.log(`[SpellingErrorCollector] 检测完成，共发现 ${errors.length} 个拼写错误`);
            return errors;
        }

        /**
         * 判断答案比较是否为拼写错误
         * @param {Object} comparison - 答案比较对象 { userAnswer, correctAnswer, isCorrect }
         * @returns {boolean} 如果是拼写错误返回true
         */
        isSpellingError(comparison) {
            if (!comparison || comparison.isCorrect) {
                return false;
            }
            
            const { userAnswer, correctAnswer } = comparison;
            
            // 检查答案是否存在
            if (!userAnswer || !correctAnswer) {
                return false;
            }
            
            // 检查正确答案是否为单词
            if (!this.isWord(correctAnswer)) {
                return false;
            }
            
            // 检查用户答案是否为单词（允许拼写错误）
            if (!this.isWord(userAnswer)) {
                return false;
            }
            
            // 检查拼写相似度
            return this.isSimilarSpelling(userAnswer, correctAnswer);
        }

        /**
         * 判断文本是否为单词
         * 排除数字、长短语、特殊符号等
         * @param {string} text - 要检查的文本
         * @returns {boolean} 如果是单词返回true
         */
        isWord(text) {
            // 空值检查
            if (!text || typeof text !== 'string') {
                return false;
            }
            
            const trimmed = text.trim();
            
            // 空字符串
            if (!trimmed) {
                return false;
            }
            
            // 排除纯数字
            if (/^\d+$/.test(trimmed)) {
                return false;
            }
            
            // 排除日期格式 (如 "2023-01-01", "01/01/2023")
            if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(trimmed)) {
                return false;
            }
            
            // 排除时间格式 (如 "10:30", "10:30:45")
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
                return false;
            }
            
            // 排除长短语（超过3个单词）
            const words = trimmed.split(/\s+/);
            if (words.length > 3) {
                return false;
            }
            
            // 排除包含特殊符号的文本（但允许连字符和撇号）
            if (/[^a-zA-Z\s'-]/.test(trimmed)) {
                return false;
            }
            
            // 排除过短的文本（少于2个字符）
            if (trimmed.length < 2) {
                return false;
            }
            
            // 排除过长的文本（超过50个字符，可能是句子）
            if (trimmed.length > 50) {
                return false;
            }
            
            // 必须包含至少一个字母
            if (!/[a-zA-Z]/.test(trimmed)) {
                return false;
            }
            
            // 通过所有检查，认为是单词
            return true;
        }

        /**
         * 检查拼写相似度
         * 使用编辑距离算法判断两个单词是否拼写相似
         * @param {string} input - 用户输入
         * @param {string} correct - 正确答案
         * @returns {boolean} 如果拼写相似返回true
         */
        isSimilarSpelling(input, correct) {
            if (!input || !correct) {
                return false;
            }
            
            // 标准化：转小写并去除首尾空格
            const normalize = (s) => s.toLowerCase().trim();
            const inputNorm = normalize(input);
            const correctNorm = normalize(correct);
            
            // 完全相同（仅大小写不同）- 也算拼写错误，需要收集
            if (inputNorm === correctNorm) {
                return true;
            }
            
            // 处理常见的相邻字符互换（如 recieve ↔ receive）
            if (inputNorm.length === correctNorm.length) {
                const diffIndices = [];
                for (let i = 0; i < inputNorm.length; i++) {
                    if (inputNorm[i] !== correctNorm[i]) {
                        diffIndices.push(i);
                        if (diffIndices.length > 2) {
                            break;
                        }
                    }
                }

                if (diffIndices.length === 2) {
                    const [i, j] = diffIndices;
                    const isTransposed = inputNorm[i] === correctNorm[j]
                        && inputNorm[j] === correctNorm[i];
                    if (isTransposed) {
                        console.log(`[SpellingErrorCollector] 检测到相邻字符置换: "${input}" ↔ "${correct}"`);
                        return true;
                    }
                }
            }

            // 计算编辑距离
            const distance = this.levenshteinDistance(inputNorm, correctNorm);
            
            // 计算相似度阈值
            const maxLen = Math.max(inputNorm.length, correctNorm.length);
            
            // 避免除以零
            if (maxLen === 0) {
                return false;
            }
            
            // 计算相似度百分比
            const similarity = 1 - (distance / maxLen);
            
            // 相似度阈值：80% (即编辑距离不超过20%)
            const threshold = 0.8;
            
            const isSimilar = similarity >= threshold;
            
            if (isSimilar) {
                console.log(`[SpellingErrorCollector] 拼写相似: "${input}" vs "${correct}", 相似度: ${(similarity * 100).toFixed(1)}%`);
            }
            
            return isSimilar;
        }

        /**
         * 计算两个字符串的Levenshtein编辑距离
         * 编辑距离表示将一个字符串转换为另一个字符串所需的最少单字符编辑操作次数
         * 操作包括：插入、删除、替换
         * 
         * @param {string} a - 第一个字符串
         * @param {string} b - 第二个字符串
         * @returns {number} 编辑距离
         */
        levenshteinDistance(a, b) {
            // 边界情况
            if (!a) return b ? b.length : 0;
            if (!b) return a.length;
            
            const aLen = a.length;
            const bLen = b.length;
            
            // 创建距离矩阵
            // matrix[i][j] 表示 a[0..i-1] 转换为 b[0..j-1] 的编辑距离
            const matrix = [];
            
            // 初始化第一列（从空字符串到b的前缀）
            for (let i = 0; i <= bLen; i++) {
                matrix[i] = [i];
            }
            
            // 初始化第一行（从空字符串到a的前缀）
            for (let j = 0; j <= aLen; j++) {
                matrix[0][j] = j;
            }
            
            // 填充矩阵
            for (let i = 1; i <= bLen; i++) {
                for (let j = 1; j <= aLen; j++) {
                    // 如果字符相同，不需要操作
                    if (b.charAt(i - 1) === a.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        // 取三种操作的最小值
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1, // 替换
                            matrix[i][j - 1] + 1,     // 插入
                            matrix[i - 1][j] + 1      // 删除
                        );
                    }
                }
            }
            
            // 返回右下角的值，即完整字符串的编辑距离
            return matrix[bLen][aLen];
        }

        /**
         * 保存拼写错误到词表
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveErrors(errors) {
            console.log('[SpellingErrorCollector] 开始保存拼写错误');
            
            if (!errors || !Array.isArray(errors) || errors.length === 0) {
                console.log('[SpellingErrorCollector] 没有错误需要保存');
                return true;
            }
            
            try {
                await this.ensureInitialized();
                
                // 按来源分组错误
                const errorsBySource = this.groupErrorsBySource(errors);
                
                // 保存到各个来源的词表
                for (const [source, sourceErrors] of Object.entries(errorsBySource)) {
                    await this.saveErrorsToList(source, sourceErrors);
                }
                
                // 同步到综合词表
                await this.syncToMasterList(errors);
                
                console.log(`[SpellingErrorCollector] 保存完成，共保存 ${errors.length} 个错误`);
                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 保存错误失败:', error);
                return false;
            }
        }

        /**
         * 按来源分组错误
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Object} 分组后的错误对象 { source: errors[] }
         */
        groupErrorsBySource(errors) {
            const grouped = {};
            
            for (const error of errors) {
                const source = error.source || 'other';
                if (!grouped[source]) {
                    grouped[source] = [];
                }
                grouped[source].push(error);
            }
            
            return grouped;
        }

        /**
         * 保存错误到指定来源的词表
         * @param {string} source - 来源标识 ('p1' | 'p4' | 'other')
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveErrorsToList(source, errors) {
            if (!errors || errors.length === 0) {
                return true;
            }
            
            const listId = source; // 'p1' 或 'p4'
            
            // 加载现有词表
            let vocabList = await this.loadVocabList(listId);
            
            // 如果词表不存在，创建新词表
            if (!vocabList) {
                vocabList = this.createEmptyList(listId, source);
                console.log(`[SpellingErrorCollector] 创建新词表: ${listId}`);
            }
            
            // 合并错误到词表
            this.mergeErrorsToList(vocabList, errors);
            
            // 保存词表
            return await this.saveVocabList(vocabList);
        }

        /**
         * 合并错误到词表
         * 处理重复单词，更新错误次数
         * @param {VocabularyList} vocabList - 词表对象
         * @param {SpellingError[]} errors - 错误数组
         */
        mergeErrorsToList(vocabList, errors) {
            for (const error of errors) {
                // 标准化单词（小写）
                const normalizedWord = error.word.toLowerCase().trim();
                
                // 查找是否已存在该单词
                const existingIndex = vocabList.words.findIndex(w => 
                    w.word.toLowerCase().trim() === normalizedWord
                );
                
                if (existingIndex !== -1) {
                    // 单词已存在，更新错误次数和最新信息
                    const existing = vocabList.words[existingIndex];
                    existing.errorCount = (existing.errorCount || 1) + 1;
                    existing.timestamp = error.timestamp;
                    existing.userInput = error.userInput; // 更新为最新的错误拼写
                    existing.questionId = error.questionId; // 更新为最新的题目ID
                    existing.examId = error.examId; // 更新为最新的考试ID
                    
                    // 如果有suiteId，也更新
                    if (error.suiteId) {
                        existing.suiteId = error.suiteId;
                    }
                    
                    console.log(`[SpellingErrorCollector] 更新已存在单词: ${error.word}, 错误次数: ${existing.errorCount}`);
                } else {
                    // 新单词，添加到词表
                    vocabList.words.push({
                        ...error,
                        errorCount: 1
                    });
                    
                    console.log(`[SpellingErrorCollector] 添加新单词: ${error.word}`);
                }
            }
        }

        /**
         * 同步错误到综合词表
         * 综合词表包含所有来源的错误
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 同步是否成功
         */
        async syncToMasterList(errors) {
            if (!errors || errors.length === 0) {
                return true;
            }
            
            console.log('[SpellingErrorCollector] 同步到综合词表');
            
            const listId = 'master';
            
            // 加载综合词表
            let masterList = await this.loadVocabList(listId);
            
            // 如果不存在，创建新词表
            if (!masterList) {
                masterList = this.createEmptyList(listId, 'all');
                console.log('[SpellingErrorCollector] 创建综合词表');
            }
            
            // 合并所有错误
            this.mergeErrorsToList(masterList, errors);
            
            // 保存综合词表
            return await this.saveVocabList(masterList);
        }

        /**
         * 从词表中移除单词
         * @param {string} listId - 词表ID
         * @param {string} word - 要移除的单词
         * @returns {Promise<boolean>} 移除是否成功
         */
        async removeWord(listId, word) {
            try {
                const vocabList = await this.loadVocabList(listId);
                
                if (!vocabList) {
                    console.warn(`[SpellingErrorCollector] 词表不存在: ${listId}`);
                    return false;
                }
                
                const normalizedWord = word.toLowerCase().trim();
                const originalLength = vocabList.words.length;
                
                // 过滤掉要移除的单词
                vocabList.words = vocabList.words.filter(w => 
                    w.word.toLowerCase().trim() !== normalizedWord
                );
                
                if (vocabList.words.length < originalLength) {
                    await this.saveVocabList(vocabList);
                    console.log(`[SpellingErrorCollector] 从词表 ${listId} 移除单词: ${word}`);
                    return true;
                } else {
                    console.log(`[SpellingErrorCollector] 词表 ${listId} 中未找到单词: ${word}`);
                    return false;
                }
            } catch (error) {
                console.error('[SpellingErrorCollector] 移除单词失败:', error);
                return false;
            }
        }

        /**
         * 清空词表
         * @param {string} listId - 词表ID
         * @returns {Promise<boolean>} 清空是否成功
         */
        async clearList(listId) {
            try {
                const vocabList = await this.loadVocabList(listId);
                
                if (!vocabList) {
                    console.warn(`[SpellingErrorCollector] 词表不存在: ${listId}`);
                    return false;
                }
                
                vocabList.words = [];
                vocabList.updatedAt = Date.now();
                
                await this.saveVocabList(vocabList);
                console.log(`[SpellingErrorCollector] 清空词表: ${listId}`);
                
                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 清空词表失败:', error);
                return false;
            }
        }
    }

    // 导出到全局
    window.SpellingErrorCollector = SpellingErrorCollector;
    
    // 创建全局实例
    if (!window.spellingErrorCollector) {
        window.spellingErrorCollector = new SpellingErrorCollector();
        console.log('[SpellingErrorCollector] 全局实例已创建');
    }

})();
