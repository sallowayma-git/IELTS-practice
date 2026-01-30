const TopicsDAO = require('../db/dao/topics.dao');
const logger = require('../utils/logger');

/**
 * Topic Service
 * 题目管理业务逻辑层
 */
class TopicService {
    constructor(db) {
        this.dao = new TopicsDAO(db);
    }

    /**
     * 获取题目列表
     */
    async list(filters, pagination) {
        try {
            return this.dao.list(filters, pagination);
        } catch (error) {
            logger.error('TopicService.list failed', error);
            throw error;
        }
    }

    /**
     * 获取单个题目
     */
    async getById(id) {
        try {
            return this.dao.getById(id);
        } catch (error) {
            logger.error(`TopicService.getById failed (id: ${id})`, error);
            throw error;
        }
    }

    /**
     * 创建题目（带验证）
     */
    async create(topicData) {
        try {
            // 验证必填字段
            this._validateTopic(topicData);

            // 验证分类值
            this._validateCategory(topicData.type, topicData.category);

            return this.dao.create(topicData);
        } catch (error) {
            logger.error('TopicService.create failed', error);
            throw error;
        }
    }

    /**
     * 更新题目（带验证）
     */
    async update(id, updates) {
        try {
            // 如果更新了类型和分类，需要验证
            if (updates.type && updates.category) {
                this._validateCategory(updates.type, updates.category);
            }

            return this.dao.update(id, updates);
        } catch (error) {
            logger.error(`TopicService.update failed (id: ${id})`, error);
            throw error;
        }
    }

    /**
     * 删除题目
     */
    async delete(id) {
        try {
            return this.dao.delete(id);
        } catch (error) {
            logger.error(`TopicService.delete failed (id: ${id})`, error);
            throw error;
        }
    }

    /**
     * 批量导入题目（带验证和错误报告）
     */
    async batchImport(topics) {
        try {
            if (!Array.isArray(topics) || topics.length === 0) {
                throw new Error('Invalid topics array');
            }

            // 预验证所有题目
            for (let i = 0; i < topics.length; i++) {
                const topic = topics[i];
                try {
                    this._validateTopic(topic);
                    this._validateCategory(topic.type, topic.category);
                } catch (error) {
                    // 记录验证错误但继续处理
                    logger.warn(`Topic validation failed at index ${i}:`, error.message);
                }
            }

            return this.dao.batchImport(topics);
        } catch (error) {
            logger.error('TopicService.batchImport failed', error);
            throw error;
        }
    }

    /**
     * 增加使用次数
     */
    async incrementUsageCount(id) {
        try {
            return this.dao.incrementUsageCount(id);
        } catch (error) {
            logger.error(`TopicService.incrementUsageCount failed (id: ${id})`, error);
            // 不抛出错误，这是非关键操作
        }
    }

    /**
     * 获取统计信息
     */
    async getStatistics() {
        try {
            return this.dao.getStatistics();
        } catch (error) {
            logger.error('TopicService.getStatistics failed', error);
            throw error;
        }
    }

    /**
     * 验证题目数据
     * @private
     */
    _validateTopic(topic) {
        if (!topic.type || !['task1', 'task2'].includes(topic.type)) {
            throw new Error('Invalid type: must be task1 or task2');
        }

        if (!topic.category) {
            throw new Error('Category is required');
        }

        if (!topic.title_json) {
            throw new Error('Title JSON is required');
        }

        // 验证 difficulty 范围
        if (topic.difficulty !== undefined && topic.difficulty !== null) {
            const diff = parseInt(topic.difficulty);
            if (isNaN(diff) || diff < 1 || diff > 5) {
                throw new Error('Difficulty must be between 1 and 5');
            }
        }

        // 验证 title_json 格式（简单检查是否为有效JSON）
        try {
            if (typeof topic.title_json === 'string') {
                JSON.parse(topic.title_json);
            }
        } catch {
            throw new Error('Invalid title_json format');
        }
    }

    /**
     * 验证分类值
     * @private
     */
    _validateCategory(type, category) {
        const validCategories = {
            task1: ['bar_chart', 'pie_chart', 'line_chart', 'flow_chart', 'map', 'table', 'process', 'mixed'],
            task2: ['education', 'technology', 'society', 'environment', 'health', 'culture', 'government', 'economy']
        };

        if (!validCategories[type]) {
            throw new Error(`Invalid type: ${type}`);
        }

        if (!validCategories[type].includes(category)) {
            throw new Error(`Invalid category ${category} for type ${type}`);
        }
    }
}

module.exports = TopicService;
