/**
 * 统一数据访问层 - Repository模式实现
 * 提供抽象的数据访问接口，统一数据操作逻辑
 */

/**
 * 基础Repository接口
 */
class BaseRepository {
    constructor(storageManager, validator = null) {
        this.storage = storageManager;
        this.validator = validator;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
    }

    /**
     * 生成缓存键
     */
    getCacheKey(key, params = {}) {
        const paramStr = JSON.stringify(params);
        return `${key}:${paramStr}`;
    }

    /**
     * 获取缓存数据
     */
    getCachedData(cacheKey) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(cacheKey);
        return null;
    }

    /**
     * 设置缓存数据
     */
    setCachedData(cacheKey, data) {
        this.cache.set(cacheKey, {
            data: data,
            timestamp: Date.now()
        });
    }

    /**
     * 清除缓存
     */
    clearCache(pattern = null) {
        if (pattern) {
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }

    /**
     * 验证数据
     */
    validate(data) {
        if (!this.validator) {
            return { valid: true, errors: [] };
        }
        return this.validator.validate(data);
    }

    /**
     * 抽象方法 - 获取数据
     */
    async get(id, options = {}) {
        throw new Error('get method must be implemented');
    }

    /**
     * 抽象方法 - 保存数据
     */
    async save(data) {
        throw new Error('save method must be implemented');
    }

    /**
     * 抽象方法 - 删除数据
     */
    async delete(id) {
        throw new Error('delete method must be implemented');
    }

    /**
     * 抽象方法 - 查询数据
     */
    async query(criteria, options = {}) {
        throw new Error('query method must be implemented');
    }
}

/**
 * 练习记录Repository
 */
class PracticeRecordRepository extends BaseRepository {
    constructor(storageManager) {
        super(storageManager, new PracticeRecordValidator());
        this.storageKey = 'practice_records';
    }

    async get(id, options = {}) {
        const cacheKey = this.getCacheKey('practice_record', { id, options });

        // 检查缓存
        const cached = this.getCachedData(cacheKey);
        if (cached && !options.skipCache) {
            return cached;
        }

        try {
            const records = await this.storage.get(this.storageKey, []);
            const record = records.find(r => r.id === id);

            if (record) {
                this.setCachedData(cacheKey, record);
                return record;
            }

            return null;
        } catch (error) {
            console.error(`Failed to get practice record ${id}:`, error);
            throw new Error(`练习记录获取失败: ${error.message}`);
        }
    }

    async getAll(options = {}) {
        const cacheKey = this.getCacheKey('practice_records_all', options);

        // 检查缓存
        const cached = this.getCachedData(cacheKey);
        if (cached && !options.skipCache) {
            return cached;
        }

        try {
            let records = await this.storage.get(this.storageKey, []);

            // 应用过滤条件
            if (options.category && options.category !== 'all') {
                records = records.filter(r => r.category === options.category);
            }

            if (options.dataSource) {
                records = records.filter(r => r.dataSource === options.dataSource);
            }

            if (options.dateFrom) {
                const fromDate = new Date(options.dateFrom);
                records = records.filter(r => new Date(r.date) >= fromDate);
            }

            if (options.dateTo) {
                const toDate = new Date(options.dateTo);
                records = records.filter(r => new Date(r.date) <= toDate);
            }

            // 排序
            const sortBy = options.sortBy || 'date';
            const sortOrder = options.sortOrder || 'desc';
            records.sort((a, b) => {
                const aVal = a[sortBy];
                const bVal = b[sortBy];
                const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                return sortOrder === 'desc' ? -comparison : comparison;
            });

            // 分页
            if (options.limit) {
                const offset = options.offset || 0;
                records = records.slice(offset, offset + options.limit);
            }

            this.setCachedData(cacheKey, records);
            return records;
        } catch (error) {
            console.error('Failed to get practice records:', error);
            throw new Error(`练习记录列表获取失败: ${error.message}`);
        }
    }

    async save(data) {
        try {
            // 数据验证
            const validation = this.validate(data);
            if (!validation.valid) {
                throw new Error(`数据验证失败: ${validation.errors.join(', ')}`);
            }

            const records = await this.storage.get(this.storageKey, []);

            // 添加时间戳
            data.timestamp = Date.now();

            // 检查是否为更新操作
            const existingIndex = records.findIndex(r => r.id === data.id);
            if (existingIndex >= 0) {
                records[existingIndex] = data;
            } else {
                // 新增记录
                if (!data.id) {
                    data.id = this.generateId();
                }
                records.unshift(data);
            }

            await this.storage.set(this.storageKey, records);

            // 清除相关缓存
            this.clearCache('practice_records');

            return data;
        } catch (error) {
            console.error('Failed to save practice record:', error);
            throw new Error(`练习记录保存失败: ${error.message}`);
        }
    }

    async delete(id) {
        try {
            const records = await this.storage.get(this.storageKey, []);
            const index = records.findIndex(r => r.id === id);

            if (index >= 0) {
                records.splice(index, 1);
                await this.storage.set(this.storageKey, records);

                // 清除相关缓存
                this.clearCache('practice_records');

                return true;
            }

            return false;
        } catch (error) {
            console.error(`Failed to delete practice record ${id}:`, error);
            throw new Error(`练习记录删除失败: ${error.message}`);
        }
    }

    async query(criteria, options = {}) {
        return this.getAll({ ...options, ...criteria });
    }

    async getStatistics() {
        const cacheKey = 'practice_records_statistics';

        // 检查缓存
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const records = await this.getAll();

            const stats = {
                totalRecords: records.length,
                categoryStats: {},
                averageScore: 0,
                totalDuration: 0,
                recentRecords: records.filter(r => {
                    const recordDate = new Date(r.date);
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return recordDate >= weekAgo;
                }).length
            };

            let totalScore = 0;

            records.forEach(record => {
                // 分类统计
                if (!stats.categoryStats[record.category]) {
                    stats.categoryStats[record.category] = {
                        count: 0,
                        totalScore: 0,
                        averageScore: 0
                    };
                }

                stats.categoryStats[record.category].count++;
                stats.categoryStats[record.category].totalScore += record.score || 0;

                // 总体统计
                totalScore += record.score || 0;
                stats.totalDuration += record.duration || 0;
            });

            // 计算平均分
            if (records.length > 0) {
                stats.averageScore = totalScore / records.length;

                // 计算各分类平均分
                Object.keys(stats.categoryStats).forEach(category => {
                    const categoryStat = stats.categoryStats[category];
                    categoryStat.averageScore = categoryStat.totalScore / categoryStat.count;
                });
            }

            this.setCachedData(cacheKey, stats);
            return stats;
        } catch (error) {
            console.error('Failed to get practice records statistics:', error);
            throw new Error(`统计信息获取失败: ${error.message}`);
        }
    }

    generateId() {
        return `practice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * 考试索引Repository
 */
class ExamIndexRepository extends BaseRepository {
    constructor(storageManager) {
        super(storageManager, new ExamIndexValidator());
        this.storageKey = 'exam_index';
    }

    async get(id, options = {}) {
        try {
            const examIndex = await this.storage.get(this.storageKey, []);
            return examIndex.find(exam => exam.id === id) || null;
        } catch (error) {
            console.error(`Failed to get exam ${id}:`, error);
            throw new Error(`考试信息获取失败: ${error.message}`);
        }
    }

    async getAll(options = {}) {
        try {
            let examIndex = await this.storage.get(this.storageKey, []);

            // 应用过滤条件
            if (options.category && options.category !== 'all') {
                examIndex = examIndex.filter(exam => exam.category === options.category);
            }

            if (options.frequency) {
                examIndex = examIndex.filter(exam => exam.frequency === options.frequency);
            }

            if (options.search) {
                const searchTerm = options.search.toLowerCase();
                examIndex = examIndex.filter(exam =>
                    exam.title.toLowerCase().includes(searchTerm) ||
                    exam.id.toLowerCase().includes(searchTerm)
                );
            }

            return examIndex;
        } catch (error) {
            console.error('Failed to get exam index:', error);
            throw new Error(`考试索引获取失败: ${error.message}`);
        }
    }

    async save(data) {
        try {
            const validation = this.validate(data);
            if (!validation.valid) {
                throw new Error(`数据验证失败: ${validation.errors.join(', ')}`);
            }

            const examIndex = await this.storage.get(this.storageKey, []);
            const existingIndex = examIndex.findIndex(exam => exam.id === data.id);

            if (existingIndex >= 0) {
                examIndex[existingIndex] = data;
            } else {
                examIndex.push(data);
            }

            await this.storage.set(this.storageKey, examIndex);
            return data;
        } catch (error) {
            console.error('Failed to save exam index:', error);
            throw new Error(`考试索引保存失败: ${error.message}`);
        }
    }

    async delete(id) {
        try {
            const examIndex = await this.storage.get(this.storageKey, []);
            const index = examIndex.findIndex(exam => exam.id === id);

            if (index >= 0) {
                examIndex.splice(index, 1);
                await this.storage.set(this.storageKey, examIndex);
                return true;
            }

            return false;
        } catch (error) {
            console.error(`Failed to delete exam ${id}:`, error);
            throw new Error(`考试删除失败: ${error.message}`);
        }
    }

    async query(criteria, options = {}) {
        return this.getAll({ ...options, ...criteria });
    }

    async getCategories() {
        const cacheKey = 'exam_categories';

        // 检查缓存
        const cached = this.getCachedData(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const examIndex = await this.getAll();
            const categories = [...new Set(examIndex.map(exam => exam.category))];

            this.setCachedData(cacheKey, categories);
            return categories;
        } catch (error) {
            console.error('Failed to get exam categories:', error);
            throw new Error(`考试分类获取失败: ${error.message}`);
        }
    }
}

/**
 * 用户设置Repository
 */
class UserSettingsRepository extends BaseRepository {
    constructor(storageManager) {
        super(storageManager);
        this.storageKey = 'user_settings';
    }

    async get(key, defaultValue = null) {
        try {
            const settings = await this.storage.get(this.storageKey, {});
            return settings[key] !== undefined ? settings[key] : defaultValue;
        } catch (error) {
            console.error(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    }

    async getAll() {
        try {
            return await this.storage.get(this.storageKey, {});
        } catch (error) {
            console.error('Failed to get user settings:', error);
            return {};
        }
    }

    async save(key, value) {
        try {
            const settings = await this.getAll();
            settings[key] = value;
            await this.storage.set(this.storageKey, settings);
            return true;
        } catch (error) {
            console.error(`Failed to save setting ${key}:`, error);
            throw new Error(`设置保存失败: ${error.message}`);
        }
    }

    async delete(key) {
        try {
            const settings = await this.getAll();
            delete settings[key];
            await this.storage.set(this.storageKey, settings);
            return true;
        } catch (error) {
            console.error(`Failed to delete setting ${key}:`, error);
            return false;
        }
    }

    async query(criteria, options = {}) {
        const settings = await this.getAll();
        const result = {};

        for (const [key, value] of Object.entries(settings)) {
            if (criteria.key ? key.includes(criteria.key) : true) {
                result[key] = value;
            }
        }

        return result;
    }
}

/**
 * 数据验证器基类
 */
class DataValidator {
    validate(data) {
        return { valid: true, errors: [] };
    }
}

/**
 * 练习记录验证器
 */
class PracticeRecordValidator extends DataValidator {
    validate(data) {
        const errors = [];

        if (!data.id) {
            errors.push('练习记录ID不能为空');
        }

        if (!data.examId) {
            errors.push('考试ID不能为空');
        }

        if (!data.title) {
            errors.push('考试标题不能为空');
        }

        if (!data.category) {
            errors.push('考试分类不能为空');
        }

        if (data.score !== undefined && (typeof data.score !== 'number' || data.score < 0)) {
            errors.push('分数必须是非负数');
        }

        if (data.totalQuestions !== undefined && (typeof data.totalQuestions !== 'number' || data.totalQuestions <= 0)) {
            errors.push('总题数必须是正数');
        }

        if (data.accuracy !== undefined && (typeof data.accuracy !== 'number' || data.accuracy < 0 || data.accuracy > 100)) {
            errors.push('正确率必须在0-100之间');
        }

        if (!data.date) {
            errors.push('练习日期不能为空');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

/**
 * 考试索引验证器
 */
class ExamIndexValidator extends DataValidator {
    validate(data) {
        const errors = [];

        if (!data.id) {
            errors.push('考试ID不能为空');
        }

        if (!data.title) {
            errors.push('考试标题不能为空');
        }

        if (!data.category) {
            errors.push('考试分类不能为空');
        }

        if (!['P1', 'P2', 'P3'].includes(data.category)) {
            errors.push('考试分类必须是P1、P2或P3');
        }

        if (!data.frequency || !['high', 'low'].includes(data.frequency)) {
            errors.push('考试频率必须是high或low');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

/**
 * Repository工厂
 */
class RepositoryFactory {
    constructor(storageManager) {
        this.storageManager = storageManager;
        this.repositories = new Map();
    }

    getPracticeRecordRepository() {
        if (!this.repositories.has('practiceRecord')) {
            this.repositories.set('practiceRecord', new PracticeRecordRepository(this.storageManager));
        }
        return this.repositories.get('practiceRecord');
    }

    getExamIndexRepository() {
        if (!this.repositories.has('examIndex')) {
            this.repositories.set('examIndex', new ExamIndexRepository(this.storageManager));
        }
        return this.repositories.get('examIndex');
    }

    getUserSettingsRepository() {
        if (!this.repositories.has('userSettings')) {
            this.repositories.set('userSettings', new UserSettingsRepository(this.storageManager));
        }
        return this.repositories.get('userSettings');
    }

    clearAllCaches() {
        for (const repository of this.repositories.values()) {
            repository.clearCache();
        }
    }
}

// 导出到全局
window.RepositoryFactory = RepositoryFactory;
window.BaseRepository = BaseRepository;
window.PracticeRecordRepository = PracticeRecordRepository;
window.ExamIndexRepository = ExamIndexRepository;
window.UserSettingsRepository = UserSettingsRepository;