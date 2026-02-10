const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const ConfigService = require('./config.service');
const PromptService = require('./prompt.service');
const EssayService = require('./essay.service');
const SettingsService = require('./settings.service');
const ProviderOrchestratorService = require('./provider-orchestrator.service');
const logger = require('../utils/logger');

/**
 * 评测服务
 * 
 * 负责:
 * - 管理评测会话 (sessionId)
 * - 调用 LLM 流式 API
 * - 解析并发送流式事件
 * - 超时和取消控制
 */
class EvaluateService {
    constructor(db, webContents) {
        this.db = db;
        this.webContents = webContents;
        this.configService = new ConfigService(db);
        this.promptService = new PromptService(db);
        this.essayService = new EssayService(db);
        this.settingsService = new SettingsService(db);
        this.providerOrchestrator = new ProviderOrchestratorService(this.configService);
        this.eventBus = new EventEmitter();

        // 会话管理: sessionId -> { controller, timeout }
        this.sessions = new Map();

        // 超时时间 (120 秒)
        this.SESSION_TIMEOUT = 120 * 1000;
    }

    /**
     * 启动评测会话
     */
    async start({ task_type, topic_id, content, word_count, config_id, prompt_version }) {
        const sessionId = uuidv4();

        try {
            logger.info(`Starting evaluation session`, sessionId, {
                task_type,
                topic_id,
                word_count,
                config_id
            });

            // 1. 获取提示词并按语言编译
            const prompt = await this.promptService.getActive(task_type);
            const language = await this.settingsService.get('language').catch(() => 'zh-CN');
            const compiledPrompt = this.promptService.compilePrompt(prompt, { language });

            // 3. 创建 AbortController
            const controller = new AbortController();

            // 4. 设置超时
            const timeoutId = setTimeout(() => {
                this._handleTimeout(sessionId);
            }, this.SESSION_TIMEOUT);

            // 5. 保存会话
            this.sessions.set(sessionId, {
                controller,
                timeoutId,
                startTime: Date.now(),
                task_type,
                config_id: config_id || null,
                prompt_version: prompt_version || prompt.version,
                language,
                topic_id: topic_id || null,
                content,
                word_count
            });
            this._recordSessionStart(sessionId, task_type, topic_id || null);

            // 6. 异步执行评测 (不阻塞返回)
            this._executeEvaluation(sessionId, {
                prompt,
                compiledPrompt,
                content,
                word_count,
                controller
            }).catch(error => {
                // 错误在 _executeEvaluation 内部已处理
                logger.error('Evaluation execution error', error, sessionId);
            });

            return { sessionId };

        } catch (error) {
            logger.error('Failed to start evaluation', error, sessionId);
            this._emitError(sessionId, 'start_failed', error.message);
            throw error;
        }
    }

    /**
     * 取消评测会话
     */
    async cancel(sessionId) {
        try {
            const session = this.sessions.get(sessionId);

            if (!session) {
                logger.warn(`Session not found: ${sessionId}`);
                return { ok: false, message: '会话不存在或已结束' };
            }

            logger.info(`Cancelling evaluation session`, sessionId);

            // 触发 AbortController
            session.controller.abort();
            this._recordSessionFinish(sessionId, {
                status: 'cancelled',
                durationMs: Date.now() - (session.startTime || Date.now())
            });

            // 清理资源
            this._cleanupSession(sessionId);

            return { ok: true };

        } catch (error) {
            logger.error('Failed to cancel evaluation', error, sessionId);
            throw error;
        }
    }

    /**
     * 执行评测 (异步)
     */
    async _executeEvaluation(sessionId, { prompt, compiledPrompt, content, word_count, controller }) {
        try {
            // 0. 发送进度: 开始
            this._emitProgress(sessionId, 'starting', 0, '正在准备评测...');

            // 1. 构建 messages
            const messages = this._buildMessages(compiledPrompt || prompt, content, word_count);

            // 2. 发送进度: 调用 LLM
            this._emitProgress(sessionId, 'calling_llm', 10, '正在连接 LLM...');

            // 3. 供应商编排（主备切换+重试）
            let accumulatedContent = '';
            const temperature = await this._getTemperature(prompt.task_type);
            const session = this.sessions.get(sessionId);

            const { usedConfig, providerPath } = await this.providerOrchestrator.streamCompletion({
                preferredConfigId: session?.config_id || null,
                messages,
                temperature,
                max_tokens: 4096,
                signal: controller.signal,
                onChunk: (chunk) => {
                    accumulatedContent += chunk;
                    this._emitProgress(sessionId, 'streaming', 50, '正在接收评分结果...');
                }
            });

            // 5. 解析完整响应
            this._emitProgress(sessionId, 'parsing', 80, '正在解析评分结果...');

            const evaluation = this._parseEvaluation(accumulatedContent);

            // 6. 验证 schema
            this._validateEvaluation(evaluation);

            // 7. 发送结果
            this._emitProgress(sessionId, 'sending_results', 90, '正在发送结果...');

            // 发送 score
            this._emitScore(sessionId, {
                total_score: evaluation.total_score,
                task_achievement: evaluation.task_achievement,
                coherence_cohesion: evaluation.coherence_cohesion,
                lexical_resource: evaluation.lexical_resource,
                grammatical_range: evaluation.grammatical_range
            });

            // 发送 sentences
            for (const sentence of evaluation.sentences || []) {
                this._emitSentence(sessionId, sentence);
            }

            // 发送 feedback
            if (evaluation.overall_feedback) {
                this._emitFeedback(sessionId, evaluation.overall_feedback);
            }

            // 8. 持久化结果
            const essayId = await this._persistEvaluation(sessionId, {
                config: usedConfig,
                task_type: prompt.task_type,
                content,
                word_count,
                evaluation
            });

            // 9. 完成
            this._emitComplete(sessionId, {
                essay_id: essayId,
                provider_path: providerPath
            });
            this._recordSessionFinish(sessionId, {
                status: 'completed',
                providerPath,
                durationMs: Date.now() - (session?.startTime || Date.now())
            });

            logger.info(`Evaluation completed successfully`, sessionId, {
                duration: Date.now() - this.sessions.get(sessionId)?.startTime
            });

            // 清理会话
            this._cleanupSession(sessionId);

        } catch (error) {
            if (error.name === 'AbortError' || error.message.includes('已取消')) {
                logger.info('Evaluation cancelled by user', sessionId);
                // 不发送错误事件,已经在 cancel 中处理
            } else {
                logger.error('Evaluation execution failed', error, sessionId);

                const errorCode = this._getErrorCode(error);
                this._emitError(sessionId, errorCode, error.message);
                const session = this.sessions.get(sessionId);
                this._recordSessionFinish(sessionId, {
                    status: 'failed',
                    errorCode,
                    errorMessage: error.message,
                    durationMs: Date.now() - (session?.startTime || Date.now())
                });
            }

            // 清理会话
            this._cleanupSession(sessionId);
        }
    }

    /**
     * 构建 LLM messages
     */
    _buildMessages(prompt, content, word_count) {
        const systemMessage = {
            role: 'system',
            content: `${prompt.system_prompt}\n\n${prompt.scoring_criteria}\n\n请严格按照以下 JSON 格式输出:\n${prompt.output_format_example}`
        };

        const userMessage = {
            role: 'user',
            content: `请评分以下作文 (字数: ${word_count}):\n\n${content}`
        };

        return [systemMessage, userMessage];
    }

    /**
     * 解析评测结果
     */
    _parseEvaluation(rawContent) {
        try {
            // 尝试提取 JSON (可能包含在 markdown code block 中)
            let jsonStr = rawContent.trim();

            // 移除可能的 markdown 代码块
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?$/g, '').trim();
            } else if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.replace(/```\n?/g, '').trim();
            }

            const evaluation = JSON.parse(jsonStr);

            return evaluation;
        } catch (error) {
            logger.error('Failed to parse evaluation JSON', error, null, {
                rawContent: rawContent.substring(0, 500) // 只记录前 500 字符
            });

            // 降级处理: 保存 raw 内容
            return {
                total_score: null,
                task_achievement: null,
                coherence_cohesion: null,
                lexical_resource: null,
                grammatical_range: null,
                sentences: [],
                overall_feedback: `解析失败,原始响应:\n${rawContent}`,
                _raw: rawContent,
                _parse_error: error.message
            };
        }
    }

    /**
     * 验证评测结果 schema
     * 
     * 【硬校验】校验失败直接抛出错误,避免 UI 端堆积容错分支
     * 
     * @throws {Error} 如果 schema 不符合预期
     */
    _validateEvaluation(evaluation) {
        const errors = [];

        // 1. 检查解析错误标记
        if (evaluation._parse_error) {
            const error = new Error(`LLM 响应解析失败: ${evaluation._parse_error}`);
            error.code = 'parse_error';
            throw error;
        }

        // 2. 检查必填分数字段
        const requiredScoreFields = [
            'total_score',
            'task_achievement',
            'coherence_cohesion',
            'lexical_resource',
            'grammatical_range'
        ];

        for (const field of requiredScoreFields) {
            if (evaluation[field] === null || evaluation[field] === undefined) {
                errors.push(`缺少必填字段: ${field}`);
            } else if (typeof evaluation[field] !== 'number') {
                errors.push(`字段 ${field} 必须是数字,实际是 ${typeof evaluation[field]}`);
            } else if (evaluation[field] < 0 || evaluation[field] > 9) {
                errors.push(`字段 ${field} 分数超出范围 [0,9],实际值: ${evaluation[field]}`);
            }
        }

        // 3. 检查 sentences 数组
        if (!Array.isArray(evaluation.sentences)) {
            errors.push('sentences 必须是数组');
        } else {
            // 校验每个 sentence 的结构
            for (let i = 0; i < evaluation.sentences.length; i++) {
                const sentence = evaluation.sentences[i];
                if (typeof sentence.index !== 'number') {
                    errors.push(`sentences[${i}].index 必须是数字`);
                }
                if (typeof sentence.original !== 'string') {
                    errors.push(`sentences[${i}].original 必须是字符串`);
                }
                // 校验 errors 内的 range 格式
                if (Array.isArray(sentence.errors)) {
                    for (let j = 0; j < sentence.errors.length; j++) {
                        const err = sentence.errors[j];
                        if (err.range) {
                            if (err.range.unit !== 'utf16') {
                                errors.push(`sentences[${i}].errors[${j}].range.unit 必须是 'utf16'`);
                            }
                            if (typeof err.range.start !== 'number' || typeof err.range.end !== 'number') {
                                errors.push(`sentences[${i}].errors[${j}].range.start/end 必须是数字`);
                            }
                        }
                    }
                }
            }
        }

        // 4. 如果有错误,抛出合并的错误信息
        if (errors.length > 0) {
            const errorMessage = `评测结果验证失败:\n- ${errors.join('\n- ')}`;
            logger.error('Evaluation validation failed', null, null, { errors });

            const error = new Error(errorMessage);
            error.code = 'validation_error';
            throw error;
        }
    }

    /**
     * 获取 temperature 参数
     */
    async _getTemperature(task_type) {
        try {
            return await this.settingsService.getTemperature(task_type);
        } catch (error) {
            logger.warn('Failed to get temperature from settings, using fallback', null, {
                task_type,
                error: error.message
            });
            return task_type === 'task1' ? 0.3 : 0.5;
        }
    }

    /**
     * 获取错误码
     */
    _getErrorCode(error) {
        if (error.code === 'parse_error' || error.code === 'validation_error') {
            return 'invalid_response_format';
        }
        if (error.message.includes('API Key') || error.message.includes('Unauthorized')) {
            return 'invalid_api_key';
        }
        if (error.message.includes('quota') || error.message.includes('Quota')) {
            return 'insufficient_quota';
        }
        if (error.message.includes('Not Found') || error.message.includes('模型不存在')) {
            return 'model_not_found';
        }
        if (error.message.includes('timeout')) {
            return 'timeout';
        }
        if (error.message.includes('network') || error.message.includes('Network')) {
            return 'network_error';
        }
        if (error.message.includes('rate limit')) {
            return 'rate_limit_exceeded';
        }
        if (error.message.includes('Server Error') || error.message.includes('5xx')) {
            return 'server_error';
        }
        return 'unknown_error';
    }

    /**
     * 处理超时
     */
    _handleTimeout(sessionId) {
        logger.error(`Evaluation timeout`, null, sessionId);

        const session = this.sessions.get(sessionId);
        if (session) {
            session.controller.abort();
            this._emitError(sessionId, 'timeout', '评测超时 (120s),请重试');
            this._recordSessionFinish(sessionId, {
                status: 'failed',
                errorCode: 'timeout',
                errorMessage: '评测超时 (120s),请重试',
                durationMs: Date.now() - (session.startTime || Date.now())
            });
            this._cleanupSession(sessionId);
        }
    }

    /**
     * 清理会话资源
     */
    _cleanupSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            clearTimeout(session.timeoutId);
            this.sessions.delete(sessionId);
            logger.debug(`Session cleaned up: ${sessionId}`);
        }
    }

    /**
     * 发送进度事件
     */
    _emitProgress(sessionId, step, percent, message) {
        this._emitEvent(sessionId, {
            type: 'progress',
            data: { step, percent, message }
        });
    }

    /**
     * 发送分数事件
     */
    _emitScore(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'score',
            data
        });
    }

    /**
     * 发送句子事件
     */
    _emitSentence(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'sentence',
            data
        });
    }

    /**
     * 发送反馈事件
     */
    _emitFeedback(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'feedback',
            data
        });
    }

    /**
     * 发送完成事件
     */
    _emitComplete(sessionId, data = {}) {
        this._emitEvent(sessionId, {
            type: 'complete',
            data
        });
    }

    /**
     * 发送错误事件
     */
    _emitError(sessionId, code, message, detail = null) {
        this._emitEvent(sessionId, {
            type: 'error',
            data: { code, message, detail }
        });
    }

    /**
     * 保存评分结果到 essays 表
     */
    async _persistEvaluation(sessionId, { config, task_type, content, word_count, evaluation }) {
        const session = this.sessions.get(sessionId);
        const topicId = session?.topic_id || null;

        const essayId = await this.essayService.create({
            topic_id: topicId,
            task_type,
            content,
            word_count,
            llm_provider: config.provider,
            model_name: config.default_model,
            total_score: evaluation.total_score,
            task_achievement: evaluation.task_achievement,
            coherence_cohesion: evaluation.coherence_cohesion,
            lexical_resource: evaluation.lexical_resource,
            grammatical_range: evaluation.grammatical_range,
            evaluation_json: JSON.stringify(evaluation)
        });

        logger.info('Evaluation persisted', sessionId, { essayId });
        return essayId;
    }

    _recordSessionStart(sessionId, taskType, topicId) {
        try {
            this.db.prepare(`
                INSERT INTO evaluation_sessions (session_id, task_type, topic_id, status)
                VALUES (?, ?, ?, 'running')
            `).run(sessionId, taskType, topicId);
        } catch (error) {
            logger.warn('Failed to record evaluation session start', sessionId, { error: error.message });
        }
    }

    _recordSessionFinish(sessionId, {
        status,
        providerPath = null,
        errorCode = null,
        errorMessage = null,
        durationMs = null
    }) {
        try {
            this.db.prepare(`
                UPDATE evaluation_sessions
                SET status = ?,
                    provider_path_json = ?,
                    error_code = ?,
                    error_message = ?,
                    duration_ms = ?,
                    completed_at = CURRENT_TIMESTAMP
                WHERE session_id = ?
            `).run(
                status,
                providerPath ? JSON.stringify(providerPath) : null,
                errorCode,
                errorMessage,
                durationMs,
                sessionId
            );
        } catch (error) {
            logger.warn('Failed to record evaluation session finish', sessionId, { error: error.message });
        }
    }

    /**
     * 订阅指定会话事件（用于 HTTP SSE）
     */
    subscribeSession(sessionId, handler) {
        const eventName = `session:${sessionId}`;
        this.eventBus.on(eventName, handler);
        return () => this.eventBus.off(eventName, handler);
    }

    /**
     * 发送事件到渲染进程
     */
    _emitEvent(sessionId, eventData) {
        const payload = {
            sessionId,
            ...eventData
        };

        this.eventBus.emit(`session:${sessionId}`, payload);

        if (!this.webContents) {
            logger.warn('webContents not available, cannot emit event');
            return;
        }

        this.webContents.send('evaluate:event', payload);
    }
}

module.exports = EvaluateService;
