(function(window) {
    // SuperMemo SM-2 算法常量
    const SM2_CONSTANTS = Object.freeze({
        MIN_EASE_FACTOR: 1.3,
        MAX_EASE_FACTOR: 3.0,
        INITIAL_INTERVAL_DAYS: 1,
        SECOND_INTERVAL_DAYS: 6,
        MAX_INTRA_CYCLES: 12
    });

    // 三档起始难度因子
    const INITIAL_EASE_FACTORS = Object.freeze({
        easy: 2.8,    // 简单：高起始难度因子，间隔长
        good: 2.5,    // 一般：标准起始难度因子
        hard: 1.8     // 困难：低起始难度因子，间隔短，需要更多复习
    });

    // 轮内循环的EF调整
    const INTRA_EF_ADJUSTMENTS = Object.freeze({
        easy: 0.15,   // 简单：提升难度因子
        good: 0.05,   // 一般：小幅提升
        hard: -0.10   // 困难：降低难度因子
    });

    // 质量评分映射（简化为 3 档）
    const QUALITY_RATINGS = Object.freeze({
        wrong: 0,      // 完全错误
        hard: 3,       // 正确但很困难
        good: 4,       // 正确但有犹豫
        easy: 5        // 完美回忆（秒答）
    });

    // 向后兼容：旧的 Leitner 箱号
    const MAX_BOX = 5;
    const MIN_BOX = 1;

    function toDate(input, fallback = new Date()) {
        if (!input) {
            return new Date(fallback);
        }
        if (input instanceof Date) {
            return new Date(input.getTime());
        }
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) {
            return new Date(fallback);
        }
        return parsed;
    }

    /**
     * SM-2 算法：计算难度因子
     * @param {number} oldEF - 旧难度因子
     * @param {number} quality - 质量评分 (0-5)
     * @returns {number} 新难度因子 (1.3-2.5)
     */
    function calculateEaseFactor(oldEF, quality) {
        const q = Math.max(0, Math.min(5, Number(quality) || 0));
        const ef = oldEF || SM2_CONSTANTS.DEFAULT_EASE_FACTOR;
        
        // SM-2 公式：EF' = EF + (0.1 - (5 - q) × (0.08 + (5 - q) × 0.02))
        const newEF = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        
        // 限制在 [1.3, 2.5] 范围内
        return Math.max(
            SM2_CONSTANTS.MIN_EASE_FACTOR,
            Math.min(SM2_CONSTANTS.MAX_EASE_FACTOR, newEF)
        );
    }

    /**
     * SM-2 算法：计算下次复习间隔（天）
     * @param {number} repetitions - 连续正确次数
     * @param {number} oldInterval - 旧间隔（天）
     * @param {number} easeFactor - 难度因子
     * @returns {number} 新间隔（天）
     */
    function calculateInterval(repetitions, oldInterval, easeFactor) {
        const reps = Number(repetitions) || 0;
        const interval = Number(oldInterval) || 0;
        const ef = easeFactor || SM2_CONSTANTS.DEFAULT_EASE_FACTOR;

        if (reps === 0) {
            return SM2_CONSTANTS.INITIAL_INTERVAL_DAYS;
        }
        if (reps === 1) {
            return SM2_CONSTANTS.SECOND_INTERVAL_DAYS;
        }
        // reps >= 2: 间隔 = 上次间隔 × 难度因子
        return Math.round(interval * ef);
    }

    /**
     * 计算下次复习时间
     * @param {number} intervalDays - 间隔天数
     * @param {Date|string} referenceTime - 基准时间
     * @returns {Date} 下次复习时间
     */
    function calculateNextReview(intervalDays, referenceTime) {
        const base = toDate(referenceTime, new Date());
        const days = Math.max(0, Number(intervalDays) || 0);
        const next = new Date(base.getTime());
        next.setDate(next.getDate() + days);
        return next;
    }

    /**
     * 归一化词条数据
     * @param {Object} word - 词条对象
     * @returns {Object} 归一化后的词条
     */
    function normalizeWord(word) {
        if (!word || typeof word !== 'object') {
            return null;
        }

        // SM-2 字段
        const easeFactor = typeof word.easeFactor === 'number' 
            ? word.easeFactor 
            : null; // 新词没有EF，将根据首次判断设置
        
        const interval = typeof word.interval === 'number' 
            ? word.interval 
            : SM2_CONSTANTS.INITIAL_INTERVAL_DAYS;
        
        const repetitions = typeof word.repetitions === 'number' 
            ? word.repetitions 
            : 0;

        // 轮内循环状态
        const intraCycles = typeof word.intraCycles === 'number'
            ? word.intraCycles
            : 0;

        return {
            ...word,
            easeFactor,
            interval,
            repetitions,
            intraCycles
        };
    }

    /**
     * 设置新词的起始难度因子
     * @param {Object} word - 词条对象
     * @param {string} initialQuality - 首次认识质量 ('easy'|'good'|'hard')
     * @returns {Object} 更新后的词条
     */
    function setInitialEaseFactor(word, initialQuality) {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return word;
        }

        const initialEF = INITIAL_EASE_FACTORS[initialQuality] || INITIAL_EASE_FACTORS.good;
        
        return {
            ...normalized,
            easeFactor: initialEF,
            intraCycles: initialQuality === 'easy' ? 0 : 1 // easy不进入轮内循环
        };
    }

    /**
     * 轮内循环调整难度因子
     * @param {Object} word - 词条对象
     * @param {string} quality - 质量评分 ('easy'|'good'|'hard')
     * @returns {Object} 更新后的词条
     */
    function adjustIntraCycleEF(word, quality) {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return word;
        }

        const adjustment = INTRA_EF_ADJUSTMENTS[quality] || 0;
        const newEF = Math.max(
            SM2_CONSTANTS.MIN_EASE_FACTOR,
            Math.min(SM2_CONSTANTS.MAX_EASE_FACTOR, normalized.easeFactor + adjustment)
        );

        const newCycles = normalized.intraCycles + 1;

        return {
            ...normalized,
            easeFactor: newEF,
            intraCycles: newCycles
        };
    }

    /**
     * SM-2 算法：根据回忆质量更新词条
     * @param {Object} word - 词条对象
     * @param {string} quality - 质量评分 ('wrong'|'hard'|'good'|'easy')
     * @param {Date|string} referenceTime - 基准时间
     * @returns {Object} 更新后的词条
     */
    function scheduleAfterResult(word, quality, referenceTime = new Date()) {
        const normalized = normalizeWord(word);
        if (!normalized) {
            return word;
        }

        // 如果是新词（没有EF），设置起始难度因子
        if (normalized.easeFactor === null) {
            return setInitialEaseFactor(normalized, quality);
        }

        const q = QUALITY_RATINGS[quality] !== undefined 
            ? QUALITY_RATINGS[quality] 
            : (quality === true || quality === 'correct' ? QUALITY_RATINGS.good : QUALITY_RATINGS.wrong);

        const reviewedAt = toDate(referenceTime, new Date()).toISOString();

        // 质量评分 < 3 视为失败，重置进度
        if (q < 3) {
            return {
                ...normalized,
                easeFactor: Math.max(
                    SM2_CONSTANTS.MIN_EASE_FACTOR,
                    normalized.easeFactor - 0.2
                ),
                interval: SM2_CONSTANTS.INITIAL_INTERVAL_DAYS,
                repetitions: 0,
                intraCycles: 1, // 重新进入轮内循环
                correctCount: 0,
                lastReviewed: reviewedAt,
                nextReview: calculateNextReview(SM2_CONSTANTS.INITIAL_INTERVAL_DAYS, reviewedAt).toISOString()
            };
        }

        // 质量评分 >= 3，更新难度因子和间隔
        const newEF = calculateEaseFactor(normalized.easeFactor, q);
        const newReps = normalized.repetitions + 1;
        const newInterval = calculateInterval(newReps, normalized.interval, newEF);
        const nextReviewDate = calculateNextReview(newInterval, reviewedAt);

        return {
            ...normalized,
            easeFactor: newEF,
            interval: newInterval,
            repetitions: newReps,
            intraCycles: 0, // 完成学习，退出轮内循环
            correctCount: (normalized.correctCount || 0) + 1,
            lastReviewed: reviewedAt,
            nextReview: nextReviewDate.toISOString()
        };
    }

    /**
     * 向后兼容：旧的 promote 函数（已废弃）
     * @deprecated 使用 scheduleAfterResult(word, 'good') 替代
     */
    function promote(word) {
        return scheduleAfterResult(word, 'good');
    }

    /**
     * 向后兼容：旧的 demote 函数（已废弃）
     * @deprecated 使用 scheduleAfterResult(word, 'wrong') 替代
     */
    function demote(word) {
        return scheduleAfterResult(word, 'wrong');
    }

    function pickDailyTask(allWords, limit = 100, options = {}) {
        const words = Array.isArray(allWords) ? allWords.slice() : [];
        const reviewLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 100;
        const newLimit = typeof options.newLimit === 'number' && options.newLimit >= 0 ? Math.floor(options.newLimit) : 20;
        const now = toDate(options.now, new Date());

        const dueWords = [];
        const newWords = [];

        words.forEach((word) => {
            if (!word) {
                return;
            }
            const nextReview = word.nextReview ? new Date(word.nextReview) : null;
            const lastReviewed = word.lastReviewed ? new Date(word.lastReviewed) : null;
            if (nextReview && !Number.isNaN(nextReview.getTime()) && nextReview <= now) {
                dueWords.push(word);
                return;
            }
            if (!lastReviewed || Number.isNaN(lastReviewed.getTime())) {
                newWords.push(word);
            }
        });

        const sortByDue = (a, b) => {
            const nextA = a.nextReview ? new Date(a.nextReview).getTime() : 0;
            const nextB = b.nextReview ? new Date(b.nextReview).getTime() : 0;
            if (Number.isNaN(nextA) && Number.isNaN(nextB)) {
                return (Number(a.correctCount) || 0) - (Number(b.correctCount) || 0);
            }
            if (Number.isNaN(nextA)) {
                return -1;
            }
            if (Number.isNaN(nextB)) {
                return 1;
            }
            if (nextA === nextB) {
                return (Number(a.correctCount) || 0) - (Number(b.correctCount) || 0);
            }
            return nextA - nextB;
        };

        dueWords.sort(sortByDue);

        const tasks = dueWords.slice(0, reviewLimit);
        if (tasks.length < reviewLimit && newLimit > 0) {
            const remaining = Math.min(newLimit, reviewLimit - tasks.length);
            const sortedNew = newWords.sort((a, b) => {
                const freqA = typeof a.freq === 'number' ? a.freq : 0;
                const freqB = typeof b.freq === 'number' ? b.freq : 0;
                if (freqA === freqB) {
                    return (a.word || '').localeCompare(b.word || '');
                }
                return freqB - freqA;
            });
            for (let i = 0; i < sortedNew.length && tasks.length < reviewLimit && i < remaining; i += 1) {
                tasks.push(sortedNew[i]);
            }
        }

        return tasks;
    }

    const api = Object.freeze({
        // SM-2 算法核心
        SM2_CONSTANTS,
        QUALITY_RATINGS,
        INITIAL_EASE_FACTORS,
        INTRA_EF_ADJUSTMENTS,
        calculateEaseFactor,
        calculateInterval,
        calculateNextReview,
        scheduleAfterResult,
        normalizeWord,
        setInitialEaseFactor,
        adjustIntraCycleEF,
        
        // 任务生成
        pickDailyTask,
        
        // 向后兼容（已废弃）
        promote,
        demote,
        MAX_BOX,
        MIN_BOX
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabScheduler = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
