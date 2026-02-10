const logger = require('../../utils/logger');

/**
 * Essays DAO
 * 作文记录/历史数据访问层
 */
class EssaysDAO {
    constructor(db) {
        this.db = db;
    }

    /**
     * 获取作文列表（支持筛选和分页）
     * @param {Object} filters - { task_type, start_date, end_date, min_score, max_score, topic_id, search }
     * @param {Object} pagination - { page, limit }
     * @returns {Object} - { data, total, page, limit }
     */
    list(filters = {}, pagination = { page: 1, limit: 20 }) {
        try {
            const conditions = [];
            const params = [];

            // 构建筛选条件
            if (filters.task_type) {
                conditions.push('e.task_type = ?');
                params.push(filters.task_type);
            }
            if (filters.start_date) {
                conditions.push('e.submitted_at >= ?');
                params.push(filters.start_date);
            }
            if (filters.end_date) {
                conditions.push('e.submitted_at <= ?');
                params.push(filters.end_date);
            }
            if (filters.min_score !== undefined && filters.min_score !== null) {
                conditions.push('e.total_score >= ?');
                params.push(filters.min_score);
            }
            if (filters.max_score !== undefined && filters.max_score !== null) {
                conditions.push('e.total_score <= ?');
                params.push(filters.max_score);
            }
            if (filters.topic_id) {
                conditions.push('e.topic_id = ?');
                params.push(filters.topic_id);
            }
            if (filters.search && String(filters.search).trim().length > 0) {
                const keyword = `%${String(filters.search).trim()}%`;
                conditions.push('(t.title_json LIKE ? OR e.content LIKE ?)');
                params.push(keyword, keyword);
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

            // 计算总数
            const countSql = `
                SELECT COUNT(*) as total 
                FROM essays e
                LEFT JOIN topics t ON e.topic_id = t.id
                ${whereClause}
            `;
            const { total } = this.db.prepare(countSql).get(...params);

            // 分页查询（包含题目标题）
            const offset = (pagination.page - 1) * pagination.limit;
            const listSql = `
                SELECT 
                    e.*,
                    t.title_json as topic_title
                FROM essays e
                LEFT JOIN topics t ON e.topic_id = t.id
                ${whereClause}
                ORDER BY e.submitted_at DESC
                LIMIT ? OFFSET ?
            `;
            const essays = this.db.prepare(listSql).all(...params, pagination.limit, offset);

            return {
                data: essays,
                total,
                page: pagination.page,
                limit: pagination.limit
            };
        } catch (error) {
            logger.error('Failed to list essays', error);
            throw error;
        }
    }

    /**
     * 根据 ID 获取作文详情
     */
    getById(id) {
        try {
            const essay = this.db.prepare(`
                SELECT 
                    e.*,
                    t.title_json as topic_title,
                    t.type as topic_type,
                    t.category as topic_category
                FROM essays e
                LEFT JOIN topics t ON e.topic_id = t.id
                WHERE e.id = ?
            `).get(id);

            return essay || null;
        } catch (error) {
            logger.error(`Failed to get essay by id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 创建作文记录
     */
    create({
        topic_id,
        task_type,
        content,
        word_count,
        llm_provider,
        model_name,
        total_score,
        task_achievement,
        coherence_cohesion,
        lexical_resource,
        grammatical_range,
        evaluation_json
    }) {
        try {
            const result = this.db.prepare(`
                INSERT INTO essays (
                    topic_id, task_type, content, word_count,
                    llm_provider, model_name,
                    total_score, task_achievement, coherence_cohesion,
                    lexical_resource, grammatical_range,
                    evaluation_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                topic_id || null,
                task_type,
                content,
                word_count,
                llm_provider,
                model_name,
                total_score,
                task_achievement,
                coherence_cohesion,
                lexical_resource,
                grammatical_range,
                evaluation_json
            );

            logger.info(`Created essay record (id: ${result.lastInsertRowid})`);
            return result.lastInsertRowid;
        } catch (error) {
            logger.error('Failed to create essay', error);
            throw error;
        }
    }

    /**
     * 删除单个作文记录
     */
    delete(id) {
        try {
            const result = this.db.prepare('DELETE FROM essays WHERE id = ?').run(id);

            if (result.changes === 0) {
                throw new Error(`Essay with id ${id} not found`);
            }

            logger.info(`Deleted essay id: ${id}`);
            return true;
        } catch (error) {
            logger.error(`Failed to delete essay id: ${id}`, error);
            throw error;
        }
    }

    /**
     * 批量删除作文记录
     * @param {Array} ids - 作文ID数组
     */
    batchDelete(ids) {
        try {
            if (!Array.isArray(ids) || ids.length === 0) {
                throw new Error('Invalid ids array');
            }

            const placeholders = ids.map(() => '?').join(',');
            const sql = `DELETE FROM essays WHERE id IN (${placeholders})`;
            const result = this.db.prepare(sql).run(...ids);

            logger.info(`Batch deleted ${result.changes} essays`);
            return result.changes;
        } catch (error) {
            logger.error('Failed to batch delete essays', error);
            throw error;
        }
    }

    /**
     * 清空所有历史记录
     */
    deleteAll() {
        try {
            const result = this.db.prepare('DELETE FROM essays').run();
            logger.info(`Deleted all essays: ${result.changes} records`);
            return result.changes;
        } catch (error) {
            logger.error('Failed to delete all essays', error);
            throw error;
        }
    }

    /**
     * 获取统计数据
     * @param {string} range - 'all' | 'recent10' | 'monthly' | 'task1' | 'task2'
     * @param {string} taskType - 'task1' | 'task2' | null
     * @returns {Object} - { average_total_score, average_task_achievement, ..., count }
     */
    getStatistics(range = 'all', taskType = null) {
        try {
            const conditions = [];
            const params = [];

            // 任务类型筛选
            if (taskType) {
                conditions.push('task_type = ?');
                params.push(taskType);
            }

            // 范围筛选
            switch (range) {
                case 'recent10':
                    // 最近10条记录
                    break; // 在后面用 LIMIT 处理
                case 'monthly':
                    // 本月数据
                    conditions.push("submitted_at >= date('now', 'start of month')");
                    break;
                case 'task1':
                    conditions.push("task_type = 'task1'");
                    break;
                case 'task2':
                    conditions.push("task_type = 'task2'");
                    break;
                case 'all':
                default:
                    // 所有数据
                    break;
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

            let limitClause = '';
            if (range === 'recent10') {
                limitClause = 'LIMIT 10';
            }

            const sql = `
                SELECT 
                    AVG(total_score) as average_total_score,
                    AVG(task_achievement) as average_task_achievement,
                    AVG(coherence_cohesion) as average_coherence_cohesion,
                    AVG(lexical_resource) as average_lexical_resource,
                    AVG(grammatical_range) as average_grammatical_range,
                    COUNT(*) as count
                FROM (
                    SELECT * FROM essays
                    ${whereClause}
                    ORDER BY submitted_at DESC
                    ${limitClause}
                )
            `;

            const stats = this.db.prepare(sql).get(...params);

            // 格式化结果，保留2位小数
            return {
                average_total_score: stats.average_total_score ? parseFloat(stats.average_total_score.toFixed(2)) : 0,
                average_task_achievement: stats.average_task_achievement ? parseFloat(stats.average_task_achievement.toFixed(2)) : 0,
                average_coherence_cohesion: stats.average_coherence_cohesion ? parseFloat(stats.average_coherence_cohesion.toFixed(2)) : 0,
                average_lexical_resource: stats.average_lexical_resource ? parseFloat(stats.average_lexical_resource.toFixed(2)) : 0,
                average_grammatical_range: stats.average_grammatical_range ? parseFloat(stats.average_grammatical_range.toFixed(2)) : 0,
                count: stats.count || 0
            };
        } catch (error) {
            logger.error('Failed to get essay statistics', error);
            throw error;
        }
    }

    /**
     * 导出为 CSV 格式（返回数据数组，由 Service 层处理格式化）
     * @param {Object} filters - 筛选条件
     * @returns {Array} - CSV数据数组
     */
    exportData(filters = {}) {
        try {
            const conditions = [];
            const params = [];

            if (filters.task_type) {
                conditions.push('e.task_type = ?');
                params.push(filters.task_type);
            }
            if (filters.start_date) {
                conditions.push('e.submitted_at >= ?');
                params.push(filters.start_date);
            }
            if (filters.end_date) {
                conditions.push('e.submitted_at <= ?');
                params.push(filters.end_date);
            }
            if (filters.search && String(filters.search).trim().length > 0) {
                const keyword = `%${String(filters.search).trim()}%`;
                conditions.push('(t.title_json LIKE ? OR e.content LIKE ?)');
                params.push(keyword, keyword);
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

            const sql = `
                SELECT 
                    e.submitted_at,
                    e.task_type,
                    t.title_json as topic_title,
                    e.word_count,
                    e.total_score,
                    e.task_achievement,
                    e.coherence_cohesion,
                    e.lexical_resource,
                    e.grammatical_range,
                    e.model_name
                FROM essays e
                LEFT JOIN topics t ON e.topic_id = t.id
                ${whereClause}
                ORDER BY e.submitted_at DESC
            `;

            const data = this.db.prepare(sql).all(...params);
            logger.info(`Exported ${data.length} essays`);
            return data;
        } catch (error) {
            logger.error('Failed to export essays', error);
            throw error;
        }
    }

    /**
     * 根据历史记录限制自动清理旧记录
     * @param {number} limit - 保留数量
     */
    cleanupOldRecords(limit) {
        try {
            if (!limit || limit <= 0) {
                return 0;
            }

            // 获取当前记录总数
            const { total } = this.db.prepare('SELECT COUNT(*) as total FROM essays').get();

            if (total <= limit) {
                return 0;
            }

            // 删除超出限制的最早记录
            const deleteCount = total - limit;
            const sql = `
                DELETE FROM essays 
                WHERE id IN (
                    SELECT id FROM essays 
                    ORDER BY submitted_at ASC 
                    LIMIT ?
                )
            `;

            const result = this.db.prepare(sql).run(deleteCount);
            logger.info(`Cleaned up ${result.changes} old essay records`);
            return result.changes;
        } catch (error) {
            logger.error('Failed to cleanup old essays', error);
            throw error;
        }
    }
}

module.exports = EssaysDAO;
