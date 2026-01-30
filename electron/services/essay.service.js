const EssaysDAO = require('../db/dao/essays.dao');
const SettingsDAO = require('../db/dao/settings.dao');
const logger = require('../utils/logger');

/**
 * Essay Service
 * 作文记录/历史管理业务逻辑层
 */
class EssayService {
    constructor(db) {
        this.dao = new EssaysDAO(db);
        this.settingsDAO = new SettingsDAO(db);
    }

    /**
     * 获取作文列表
     */
    async list(filters, pagination) {
        try {
            return this.dao.list(filters, pagination);
        } catch (error) {
            logger.error('EssayService.list failed', error);
            throw error;
        }
    }

    /**
     * 获取作文详情
     */
    async getById(id) {
        try {
            return this.dao.getById(id);
        } catch (error) {
            logger.error(`EssayService.getById failed (id: ${id})`, error);
            throw error;
        }
    }

    /**
     * 创建作文记录（自动触发使用次数增加和历史清理）
     */
    async create(essayData) {
        try {
            // 验证数据
            this._validateEssay(essayData);

            // 创建记录
            const id = this.dao.create(essayData);

            // TODO: 增加题目使用次数 (需要 TopicService 实例)
            // if (essayData.topic_id) {
            //     await this.topicService.incrementUsageCount(essayData.topic_id);
            // }

            // 检查是否需要清理旧记录
            await this._autoCleanup();

            return id;
        } catch (error) {
            logger.error('EssayService.create failed', error);
            throw error;
        }
    }

    /**
     * 删除作文
     */
    async delete(id) {
        try {
            return this.dao.delete(id);
        } catch (error) {
            logger.error(`EssayService.delete failed (id: ${id})`, error);
            throw error;
        }
    }

    /**
     * 批量删除
     */
    async batchDelete(ids) {
        try {
            return this.dao.batchDelete(ids);
        } catch (error) {
            logger.error('EssayService.batchDelete failed', error);
            throw error;
        }
    }

    /**
     * 清空所有历史
     */
    async deleteAll() {
        try {
            return this.dao.deleteAll();
        } catch (error) {
            logger.error('EssayService.deleteAll failed', error);
            throw error;
        }
    }

    /**
     * Get statistics with strict protocol contract
     * PROTOCOL (LOCKED):
     * Returns: {
     *   count: number,
     *   latest: { task_type, tr_ta, cc, lr, gra, submitted_at },
     *   average: { avg_tr_ta, avg_cc, avg_lr, avg_gra }
     * }
     * Field naming: ALWAYS tr_ta (never task_response/task_achievement split)
     */
    async getStatistics(range = 'all', taskType = null) {
        try {
            const stats = this.dao.getStatistics(range, taskType);

            if (stats.count === 0) {
                return { count: 0 };
            }

            // Build WHERE clause for latest essay
            const conditions = [];
            const params = [];

            if (range === 'task1') {
                conditions.push("task_type = 'task1'");
            } else if (range === 'task2') {
                conditions.push("task_type = 'task2'");
            } else if (taskType) {
                conditions.push('task_type = ?');
                params.push(taskType);
            }

            if (range === 'monthly') {
                conditions.push("submitted_at >= date('now', 'start of month')");
            }

            const whereClause = conditions.length > 0
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            const limitClause = range === 'recent10' ? 'LIMIT 1 OFFSET 0' : 'LIMIT 1';

            const latest = this.dao.db.prepare(`
                SELECT * FROM essays 
                ${whereClause}
                ORDER BY submitted_at DESC 
                ${limitClause}
            `).get(...params);

            if (!latest) {
                return { count: 0 };
            }

            // Return with LOCKED protocol
            return {
                count: stats.count,
                latest: {
                    task_type: latest.task_type,
                    tr_ta: latest.task_achievement,  // PROTOCOL: Always tr_ta, DB stores as task_achievement
                    cc: latest.coherence_cohesion,
                    lr: latest.lexical_resource,
                    gra: latest.grammatical_range,
                    submitted_at: latest.submitted_at
                },
                average: {
                    avg_tr_ta: stats.average_task_achievement,  // PROTOCOL: Always avg_tr_ta
                    avg_cc: stats.average_coherence_cohesion,
                    avg_lr: stats.average_lexical_resource,
                    avg_gra: stats.average_grammatical_range
                }
            };
        } catch (error) {
            logger.error('EssayService.getStatistics failed', error);
            throw error;
        }
    }

    /**
     * 导出为 CSV
     * @param {Object} filters - 筛选条件
     * @returns {string} - CSV 格式字符串
     */
    async exportCSV(filters = {}) {
        try {
            const data = this.dao.exportData(filters);

            // 生成 CSV 内容
            const headers = [
                '提交时间',
                '题目类型',
                '题目标题',
                '字数',
                '总分',
                'Task Achievement',
                'Coherence & Cohesion',
                'Lexical Resource',
                'Grammatical Range',
                '模型名称'
            ];

            const rows = data.map(row => {
                // 解析题目标题 JSON（仅取前50字符）
                let titleText = '自由写作';
                if (row.topic_title) {
                    try {
                        const titleObj = JSON.parse(row.topic_title);
                        // 简单提取文本内容
                        titleText = this._extractTextFromTiptap(titleObj).substring(0, 50);
                    } catch {
                        titleText = row.topic_title.substring(0, 50);
                    }
                }

                return [
                    row.submitted_at,
                    row.task_type === 'task1' ? 'Task 1' : 'Task 2',
                    `"${titleText}"`, // 使用引号包裹防止逗号
                    row.word_count,
                    row.total_score,
                    row.task_achievement,
                    row.coherence_cohesion,
                    row.lexical_resource,
                    row.grammatical_range,
                    row.model_name
                ].join(',');
            });

            const csv = [headers.join(','), ...rows].join('\n');
            logger.info('Exported CSV with ' + data.length + ' records');
            return csv;
        } catch (error) {
            logger.error('EssayService.exportCSV failed', error);
            throw error;
        }
    }

    /**
     * 自动清理旧记录（根据 history_limit 设置）
     * @private
     */
    async _autoCleanup() {
        try {
            const historyLimit = this.settingsDAO.get('history_limit');
            if (historyLimit && typeof historyLimit === 'number' && historyLimit > 0) {
                this.dao.cleanupOldRecords(historyLimit);
            }
        } catch (error) {
            logger.warn('Auto cleanup failed', error);
            // 不抛出错误，这是非关键操作
        }
    }

    /**
     * 验证作文数据
     * @private
     */
    _validateEssay(essay) {
        if (!essay.task_type || !['task1', 'task2'].includes(essay.task_type)) {
            throw new Error('Invalid task_type: must be task1 or task2');
        }

        if (!essay.content || essay.content.trim().length === 0) {
            throw new Error('Content is required');
        }

        if (!essay.word_count || essay.word_count <= 0) {
            throw new Error('Invalid word_count');
        }

        if (!essay.llm_provider || !essay.model_name) {
            throw new Error('LLM provider and model name are required');
        }

        if (!essay.evaluation_json) {
            throw new Error('Evaluation JSON is required');
        }

        // 验证分数范围
        const scores = [
            essay.total_score,
            essay.task_achievement,
            essay.coherence_cohesion,
            essay.lexical_resource,
            essay.grammatical_range
        ];

        for (const score of scores) {
            if (score !== null && score !== undefined) {
                if (score < 0 || score > 9) {
                    throw new Error('Scores must be between 0 and 9');
                }
            }
        }
    }

    /**
     * 从 Tiptap JSON 提取纯文本
     * @private
     */
    _extractTextFromTiptap(json) {
        if (typeof json === 'string') {
            return json;
        }

        if (json.type === 'text') {
            return json.text || '';
        }

        if (json.content && Array.isArray(json.content)) {
            return json.content.map(node => this._extractTextFromTiptap(node)).join('');
        }

        return '';
    }
}

module.exports = EssayService;
