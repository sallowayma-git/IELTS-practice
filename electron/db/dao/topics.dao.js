const logger = require('../../utils/logger');

/**
 * Topics DAO
 * 题目库数据访问层
 */
class TopicsDAO {
    constructor(db) {
        this.db = db;
    }

    /**
     * 获取题目列表（支持筛选和分页）
     * @param {Object} filters - { type, category, difficulty, is_official }
     * @param {Object} pagination - { page, limit }
     * @returns {Array} 题目列表
     */
    list(filters = {}, pagination = { page: 1, limit: 20 }) {
        try {
            const conditions = [];
            const params = [];

            // 构建筛选条件
            if (filters.type) {
                conditions.push('type = ?');
                params.push(filters.type);
            }
            if (filters.category) {
                conditions.push('category = ?');
                params.push(filters.category);
            }
            if (filters.difficulty !== undefined && filters.difficulty !== null) {
                conditions.push('difficulty = ?');
                params.push(filters.difficulty);
            }
            if (filters.is_official !== undefined) {
                conditions.push('is_official = ?');
                params.push(filters.is_official ? 1 : 0);
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

            // 计算总数
            const countSql = `SELECT COUNT(*) as total FROM topics ${whereClause}`;
            const { total } = this.db.prepare(countSql).get(...params);

            // 分页查询
            const offset = (pagination.page - 1) * pagination.limit;
            const listSql = `
                SELECT * FROM topics 
                ${whereClause}
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            `;
            const topics = this.db.prepare(listSql).all(...params, pagination.limit, offset);

            return {
                data: topics,
                total,
                page: pagination.page,
                limit: pagination.limit
            };
        } catch (error) {
            logger.error('Failed to list topics', error);
            throw error;
        }
    }

    /**
     * 根据 ID 获取题目
     */
    getById(id) {
        try {
            const topic = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
            return topic || null;
        } catch (error) {
            logger.error(`Failed to get topic by id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 创建新题目
     */
    create({ type, category, difficulty, title_json, image_path, is_official = 0 }) {
        try {
            const result = this.db.prepare(`
                INSERT INTO topics 
                    (type, category, difficulty, title_json, image_path, is_official)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(type, category, difficulty, title_json, image_path, is_official ? 1 : 0);

            logger.info(`Created topic (id: ${result.lastInsertRowid})`);
            return result.lastInsertRowid;
        } catch (error) {
            logger.error('Failed to create topic', error);
            throw error;
        }
    }

    /**
     * 更新题目
     */
    update(id, updates) {
        try {
            const allowedFields = [
                'type', 'category', 'difficulty',
                'title_json', 'image_path', 'is_official'
            ];

            const setClauses = [];
            const values = [];

            for (const [key, value] of Object.entries(updates)) {
                if (allowedFields.includes(key)) {
                    setClauses.push(`${key} = ?`);
                    values.push(key === 'is_official' ? (value ? 1 : 0) : value);
                }
            }

            if (setClauses.length === 0) {
                throw new Error('No valid fields to update');
            }

            // 添加 updated_at
            setClauses.push('updated_at = CURRENT_TIMESTAMP');
            values.push(id);

            const sql = `
                UPDATE topics 
                SET ${setClauses.join(', ')}
                WHERE id = ?
            `;

            const result = this.db.prepare(sql).run(...values);

            if (result.changes === 0) {
                throw new Error(`Topic with id ${id} not found`);
            }

            logger.info(`Updated topic id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to update topic id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 删除题目
     */
    delete(id) {
        try {
            const result = this.db.prepare('DELETE FROM topics WHERE id = ?').run(id);

            if (result.changes === 0) {
                throw new Error(`Topic with id ${id} not found`);
            }

            logger.info(`Deleted topic id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to delete topic id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 增加题目使用次数
     */
    incrementUsageCount(id) {
        try {
            this.db.prepare(`
                UPDATE topics 
                SET usage_count = usage_count + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(id);

            logger.debug(`Incremented usage count for topic id: ${id}`);
        } catch (error) {
            logger.error(`Failed to increment usage count for topic id: ${id}`, error);
            // 不抛出错误，这是非关键操作
        }
    }

    /**
     * 批量导入题目
     * @param {Array} topics - 题目数组
     * @returns {Object} - { success: number, failed: number, errors: Array }
     */
    batchImport(topics) {
        try {
            const results = {
                success: 0,
                failed: 0,
                errors: []
            };

            const insertStmt = this.db.prepare(`
                INSERT INTO topics 
                    (type, category, difficulty, title_json, image_path, is_official)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            const batchInsert = this.db.transaction((topicsArray) => {
                for (let i = 0; i < topicsArray.length; i++) {
                    const topic = topicsArray[i];
                    try {
                        // 验证必填字段
                        if (!topic.type || !topic.category || !topic.title_json) {
                            throw new Error('Missing required fields: type, category, or title_json');
                        }

                        insertStmt.run(
                            topic.type,
                            topic.category,
                            topic.difficulty || null,
                            topic.title_json,
                            topic.image_path || null,
                            topic.is_official ? 1 : 0
                        );

                        results.success++;
                    } catch (error) {
                        results.failed++;
                        results.errors.push({
                            index: i,
                            topic: topic,
                            error: error.message
                        });
                    }
                }
            });

            batchInsert(topics);

            logger.info(`Batch import completed: ${results.success} success, ${results.failed} failed`);
            return results;
        } catch (error) {
            logger.error('Failed to batch import topics', error);
            throw error;
        }
    }

    /**
     * 获取题目统计信息
     * @returns {Object} - { total, byType, byCategory }
     */
    getStatistics() {
        try {
            const total = this.db.prepare('SELECT COUNT(*) as count FROM topics').get().count;

            const byType = this.db.prepare(`
                SELECT type, COUNT(*) as count 
                FROM topics 
                GROUP BY type
            `).all();

            const byCategory = this.db.prepare(`
                SELECT category, COUNT(*) as count 
                FROM topics 
                GROUP BY category
                ORDER BY count DESC
                LIMIT 10
            `).all();

            return {
                total,
                byType,
                byCategory
            };
        } catch (error) {
            logger.error('Failed to get topic statistics', error);
            throw error;
        }
    }
}

module.exports = TopicsDAO;
