const { v4: uuidv4 } = require('uuid');
const { EventEmitter } = require('events');
const ConfigService = require('./config.service');
const PromptService = require('./prompt.service');
const EssayService = require('./essay.service');
const TopicService = require('./topic.service');
const SettingsService = require('./settings.service');
const ProviderOrchestratorService = require('./provider-orchestrator.service');
const {
    buildFallbackReviewEvaluation,
    buildReviewResponseFormat,
    buildReviewStageExample,
    buildScoringResponseFormat,
    buildScoringStageExample,
    decorateEvaluationForStorage,
    mergeStageResults,
    validateEvaluation,
    validateReviewStage,
    validateScoringStage
} = require('./evaluation-contract');
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
        this.topicService = new TopicService(db);
        this.settingsService = new SettingsService(db);
        this.providerOrchestrator = new ProviderOrchestratorService(this.configService);
        this.eventBus = new EventEmitter();

        // 会话管理: sessionId -> { controller, timeout }
        this.sessions = new Map();
        this.sessionEventCache = new Map();
        this.maxCachedEventsPerSession = 80;
        this.sessionCacheTtlMs = 15 * 60 * 1000;
        this.sessionProgress = new Map();

        // 超时时间（提升至 240 秒，覆盖两阶段长链路与慢模型）
        this.SESSION_TIMEOUT = 240 * 1000;
    }

    /**
     * 启动评测会话
     */
    async start({ task_type, topic_id, topic_text, content, word_count, config_id, prompt_version }) {
        const sessionId = uuidv4();

        try {
            this._resetSessionEventCache(sessionId);
            const topicContext = await this._resolveTopicContext({
                task_type,
                topic_id,
                topic_text
            });

            logger.info(`Starting evaluation session`, sessionId, {
                task_type,
                topic_id: topicContext.topicId,
                topic_source: topicContext.source,
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
                topic_id: topicContext.topicId,
                topic_text: topicContext.text,
                topic_source: topicContext.source,
                content,
                word_count
            });
            this._recordSessionStart(sessionId, task_type, topicContext.topicId || null);

            // 6. 异步执行评测 (不阻塞返回)
            this._executeEvaluation(sessionId, {
                prompt,
                compiledPrompt,
                task_type,
                topicContext,
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
            session.controller.abort('user_cancelled');
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

    async getSessionState(sessionId) {
        const cache = this.sessionEventCache.get(sessionId) || { seq: 0, events: [], updatedAt: Date.now() };
        const session = this.sessions.get(sessionId);
        this._pruneSessionEventCache();
        return {
            sessionId,
            active: this.sessions.has(sessionId),
            status: session ? 'running' : 'idle',
            lastSequence: cache.seq || 0,
            events: Array.isArray(cache.events) ? cache.events : []
        };
    }

    /**
     * 执行评测 (异步)
     */
    async _executeEvaluation(sessionId, {
        prompt,
        compiledPrompt,
        task_type,
        topicContext,
        content,
        word_count,
        controller
    }) {
        try {
            this._emitProgress(sessionId, 'starting', 0, '正在准备评测...');
            this._emitLog(sessionId, 'system', '评测任务已创建，正在准备题目和提示词。');
            const stagePrompt = compiledPrompt || prompt;
            const session = this.sessions.get(sessionId);

            this._emitStage(sessionId, {
                name: 'scoring',
                status: 'started',
                message: '正在进行评分分析...'
            });
            this._emitProgress(sessionId, 'stage_scoring_start', 10, '正在执行第一阶段评分...');
            this._emitLog(sessionId, 'scoring', '第一阶段开始：正在生成四维评分与任务诊断。');

            const scoringStage = await this._executeScoringStage(sessionId, {
                prompt: stagePrompt,
                task_type,
                topicContext,
                content,
                word_count,
                controller
            });

            this._emitScore(sessionId, {
                total_score: scoringStage.evaluation.total_score,
                task_achievement: scoringStage.evaluation.task_achievement,
                coherence_cohesion: scoringStage.evaluation.coherence_cohesion,
                lexical_resource: scoringStage.evaluation.lexical_resource,
                grammatical_range: scoringStage.evaluation.grammatical_range
            });
            this._emitAnalysis(sessionId, {
                total_score: scoringStage.evaluation.total_score,
                task_analysis: scoringStage.evaluation.task_analysis || null,
                band_rationale: scoringStage.evaluation.band_rationale || null,
                improvement_plan: scoringStage.evaluation.improvement_plan || null,
                input_context: scoringStage.evaluation.input_context || null
            });
            this._emitStage(sessionId, {
                name: 'scoring',
                status: 'completed',
                message: '第一阶段评分完成'
            });
            this._emitLog(sessionId, 'scoring', '第一阶段完成，分数与评分分析已生成。');

            this._emitStage(sessionId, {
                name: 'review',
                status: 'started',
                message: '正在生成段落与句级详解...'
            });
            this._emitProgress(sessionId, 'stage_review_start', 55, '正在执行第二阶段详解...');
            this._emitLog(sessionId, 'review', '第二阶段开始：正在生成段落与句级详解。');

            let reviewStage;
            let reviewStageDegraded = false;
            let reviewStageError = null;
            try {
                reviewStage = await this._executeReviewStage(sessionId, {
                    prompt: stagePrompt,
                    task_type,
                    topicContext,
                    content,
                    word_count,
                    scoringEvaluation: scoringStage.evaluation,
                    controller
                });
            } catch (error) {
                if (this._shouldFailSessionForReviewError(error)) {
                    throw error;
                }
                reviewStageDegraded = true;
                reviewStageError = error;
                const degradedContext = error?.stageContext || {};
                logger.warn('Review stage failed, degrade to scoring-only result', sessionId, {
                    message: error.message
                });
                this._emitLog(sessionId, 'review', `第二阶段失败：${error.message}`);
                this._emitStage(sessionId, {
                    name: 'review',
                    status: 'degraded',
                    message: '第二阶段详解失败，已回退为评分结果'
                });
                reviewStage = {
                    usedConfig: degradedContext.usedConfig || null,
                    providerPath: Array.isArray(degradedContext.providerPath) ? degradedContext.providerPath : [],
                    evaluation: buildFallbackReviewEvaluation(scoringStage.evaluation, error)
                };
            }

            const evaluation = mergeStageResults({
                scoringEvaluation: scoringStage.evaluation,
                reviewEvaluation: reviewStage.evaluation,
                reviewMeta: {
                    degraded: reviewStageDegraded,
                    error_message: reviewStageError?.message || ''
                }
            });

            validateEvaluation(evaluation);

            const reviewBlocks = this._normalizeReviewBlocks(evaluation);
            const sentenceItems = Array.isArray(evaluation.sentences) ? evaluation.sentences : [];
            const deliveryMilestones = Math.max(
                1,
                reviewBlocks.length + sentenceItems.length + (evaluation.overall_feedback ? 1 : 0) + 1
            );
            let deliveredCount = 0;
            const emitDeliveryProgress = (step, message, logMessage = '') => {
                deliveredCount += 1;
                const percent = 84 + Math.floor((deliveredCount / deliveryMilestones) * 13);
                this._emitProgress(sessionId, step, percent, message);
                if (logMessage) {
                    this._emitLog(sessionId, 'review', logMessage);
                }
            };

            this._emitProgress(sessionId, 'stage_review_delivery_start', 84, '第二阶段详解已生成，正在分发结果...');

            if (reviewBlocks.length > 0) {
                for (let index = 0; index < reviewBlocks.length; index++) {
                    const partialBlocks = reviewBlocks.slice(0, index + 1);
                    this._emitReview(sessionId, {
                        paragraph_reviews: partialBlocks,
                        review_blocks: partialBlocks,
                        review_degraded: evaluation.review_degraded === true
                    });
                    emitDeliveryProgress(
                        'stage_review_block_delivered',
                        `第二阶段段落详解 ${index + 1}/${reviewBlocks.length}`,
                        `第二阶段段落详解已输出 ${index + 1}/${reviewBlocks.length}。`
                    );
                }
            }

            this._emitReview(sessionId, {
                paragraph_reviews: reviewBlocks.length > 0 ? reviewBlocks : (evaluation.paragraph_reviews || null),
                review_blocks: reviewBlocks.length > 0 ? reviewBlocks : (evaluation.review_blocks || null),
                improvement_plan: evaluation.improvement_plan || null,
                rewrite_suggestions: evaluation.rewrite_suggestions || null,
                review_degraded: evaluation.review_degraded === true
            });
            emitDeliveryProgress('stage_review_payload_ready', '第二阶段详解结构已输出', '第二阶段详解结构输出完成。');

            for (let index = 0; index < sentenceItems.length; index++) {
                this._emitSentence(sessionId, sentenceItems[index]);
                emitDeliveryProgress(
                    'stage_review_sentence_delivered',
                    `第二阶段句级诊断 ${index + 1}/${sentenceItems.length}`,
                    `第二阶段句级诊断已输出 ${index + 1}/${sentenceItems.length}。`
                );
            }

            if (evaluation.overall_feedback) {
                this._emitFeedback(sessionId, evaluation.overall_feedback);
                emitDeliveryProgress('stage_review_feedback_ready', '第二阶段整体评语已输出', '第二阶段整体评语已生成。');
            }

            this._emitProgress(sessionId, 'sending_results', 98, '正在保存与发送最终结果...');

            if (!reviewStageDegraded) {
                this._emitStage(sessionId, {
                    name: 'review',
                    status: 'completed',
                    message: '第二阶段详解完成'
                });
                this._emitLog(sessionId, 'review', '第二阶段完成，段落与句级详解已生成。');
            }

            const mergedProviderPath = [
                ...(scoringStage.providerPath || []).map((item) => ({ ...item, stage: 'scoring' })),
                ...(reviewStage.providerPath || []).map((item) => ({ ...item, stage: 'review' }))
            ];

            const essayId = await this._persistEvaluation(sessionId, {
                config: reviewStage.usedConfig || scoringStage.usedConfig,
                task_type: prompt.task_type,
                content,
                word_count,
                evaluation
            });

            this._emitComplete(sessionId, {
                essay_id: essayId,
                provider_path: mergedProviderPath,
                review_degraded: evaluation.review_degraded === true,
                review_status: evaluation.review_status || null
            });
            this._emitLog(sessionId, 'system', '评测完成，正在跳转结果页。');
            this._recordSessionFinish(sessionId, {
                status: 'completed',
                providerPath: mergedProviderPath,
                errorCode: reviewStageDegraded ? 'review_degraded' : null,
                errorMessage: reviewStageDegraded ? (reviewStageError?.message || 'review stage degraded') : null,
                durationMs: Date.now() - (session?.startTime || Date.now())
            });

            logger.info(`Evaluation completed successfully`, sessionId, {
                duration: Date.now() - this.sessions.get(sessionId)?.startTime
            });

            // 清理会话
            this._cleanupSession(sessionId);

        } catch (error) {
            const session = this.sessions.get(sessionId);
            if (this._isAbortLikeError(error)) {
                if (!session) {
                    logger.info('Evaluation cancelled by user or timeout cleanup already finished', sessionId);
                } else {
                    const errorCode = this._isTimeoutLikeError(error) ? 'timeout' : 'unknown_error';
                    const errorMessage = this._isTimeoutLikeError(error)
                        ? this._buildTimeoutMessage()
                        : (error.message || '评测请求已取消');
                    logger.warn('Evaluation aborted unexpectedly', sessionId, {
                        errorCode,
                        message: error.message
                    });
                    this._emitError(sessionId, errorCode, errorMessage);
                    this._recordSessionFinish(sessionId, {
                        status: 'failed',
                        errorCode,
                        errorMessage,
                        durationMs: Date.now() - (session.startTime || Date.now())
                    });
                }
            } else {
                logger.error('Evaluation execution failed', error, sessionId);

                const errorCode = this._getErrorCode(error);
                this._emitError(sessionId, errorCode, error.message);
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

    async _executeScoringStage(sessionId, {
        prompt,
        task_type,
        topicContext,
        content,
        word_count,
        controller
    }) {
        const messages = this._buildScoringMessages({
            prompt,
            task_type,
            topicContext,
            content,
            word_count
        });

        const stageResult = await this._runStageCompletion(sessionId, {
            stageName: 'scoring',
            messages,
            task_type,
            controller,
            responseFormat: buildScoringResponseFormat(task_type),
            streamPercent: 35,
            streamProgressStart: 28,
            streamProgressEnd: 35,
            streamMessage: '第一阶段正在接收评分...'
        });

        this._emitProgress(sessionId, 'stage_scoring_parsing', 45, '正在解析第一阶段评分...');
        const parsed = this._parseEvaluation(stageResult.accumulatedContent, 'scoring');
        const evaluation = validateScoringStage(parsed, task_type);

        return {
            usedConfig: stageResult.usedConfig,
            providerPath: stageResult.providerPath,
            evaluation
        };
    }

    async _executeReviewStage(sessionId, {
        prompt,
        task_type,
        topicContext,
        content,
        word_count,
        scoringEvaluation,
        controller
    }) {
        const messages = this._buildReviewMessages({
            prompt,
            task_type,
            topicContext,
            content,
            word_count,
            scoringEvaluation
        });

        const stageResult = await this._runStageCompletion(sessionId, {
            stageName: 'review',
            messages,
            task_type,
            controller,
            responseFormat: buildReviewResponseFormat(),
            streamPercent: 72,
            streamProgressStart: 60,
            streamProgressEnd: 74,
            streamMessage: '第二阶段正在接收详解...'
        });

        try {
            this._emitProgress(sessionId, 'stage_review_parsing', 76, '正在解析第二阶段详解...');
            const parsed = this._parseEvaluation(stageResult.accumulatedContent, 'review');
            const evaluation = validateReviewStage(parsed);

            return {
                usedConfig: stageResult.usedConfig,
                providerPath: stageResult.providerPath,
                evaluation
            };
        } catch (error) {
            this._emitLog(sessionId, 'review', `第二阶段输出校验失败，正在尝试自动修复：${error.message}`);
            this._emitProgress(sessionId, 'stage_review_repair', 79, '第二阶段输出异常，正在自动修复...');

            try {
                const repairedStage = await this._repairReviewStage(sessionId, {
                    prompt,
                    task_type,
                    topicContext,
                    content,
                    word_count,
                    scoringEvaluation,
                    rawContent: stageResult.accumulatedContent,
                    controller
                });

                this._emitProgress(sessionId, 'stage_review_repair_parsing', 82, '修复结果已生成，正在重新校验...');
                const repairedEvaluation = validateReviewStage(repairedStage.evaluation);
                this._emitLog(sessionId, 'review', '第二阶段输出修复成功。');

                return {
                    usedConfig: repairedStage.usedConfig || stageResult.usedConfig,
                    providerPath: [
                        ...(stageResult.providerPath || []),
                        ...(repairedStage.providerPath || [])
                    ],
                    evaluation: repairedEvaluation
                };
            } catch (repairError) {
                repairError.stageContext = {
                    stage: 'review',
                    usedConfig: repairError?.stageContext?.usedConfig || stageResult.usedConfig,
                    providerPath: repairError?.stageContext?.providerPath || stageResult.providerPath
                };
                throw repairError;
            }
        }
    }

    async _repairReviewStage(sessionId, {
        prompt,
        task_type,
        topicContext,
        content,
        word_count,
        scoringEvaluation,
        rawContent,
        controller
    }) {
        const systemMessage = {
            role: 'system',
            content: [
                prompt.system_prompt,
                '你现在只做 JSON 修复，不做新的评分。',
                '请把给定的第二阶段详解输出修复为一个严格合法的 JSON 对象。',
                '- 顶层必须包含 review_blocks、sentences、overall_feedback、improvement_plan、rewrite_suggestions。',
                '- review_blocks 每项固定字段是 paragraph_index、comment、analysis、feedback。',
                '- sentences[].errors[].range.unit 必须是 utf16。',
                '- 不允许输出 markdown 代码块或解释文本。',
                `JSON 示例:\n${JSON.stringify(buildReviewStageExample(), null, 2)}`
            ].join('\n\n')
        };
        const userMessage = {
            role: 'user',
            content: [
                '请把下面这份第二阶段输出修复为合法 JSON。',
                '如果某个字段缺失，请补空数组或合理字符串，不要省略字段。',
                '',
                '第一阶段评分摘要：',
                JSON.stringify({
                    total_score: scoringEvaluation.total_score,
                    task_achievement: scoringEvaluation.task_achievement,
                    coherence_cohesion: scoringEvaluation.coherence_cohesion,
                    lexical_resource: scoringEvaluation.lexical_resource,
                    grammatical_range: scoringEvaluation.grammatical_range
                }, null, 2),
                '',
                '原始评测输入：',
                JSON.stringify(this._buildEvaluationPacket({
                    stage: 'review_repair',
                    task_type,
                    topicContext,
                    content,
                    word_count
                }), null, 2),
                '',
                '待修复输出：',
                rawContent
            ].join('\n')
        };

        const stageResult = await this._runStageCompletion(sessionId, {
            stageName: 'review_repair',
            messages: [systemMessage, userMessage],
            task_type,
            controller,
            responseFormat: buildReviewResponseFormat(),
            streamPercent: 80,
            streamProgressStart: 80,
            streamProgressEnd: 81,
            streamMessage: '正在自动修复第二阶段输出...'
        });

        try {
            const parsed = this._parseEvaluation(stageResult.accumulatedContent, 'review repair');
            return {
                usedConfig: stageResult.usedConfig,
                providerPath: stageResult.providerPath,
                evaluation: parsed
            };
        } catch (error) {
            error.stageContext = {
                stage: 'review',
                usedConfig: stageResult.usedConfig,
                providerPath: stageResult.providerPath
            };
            throw error;
        }
    }

    async _runStageCompletion(sessionId, {
        stageName,
        messages,
        task_type,
        controller,
        responseFormat,
        streamPercent,
        streamProgressStart = null,
        streamProgressEnd = null,
        streamMessage
    }) {
        let accumulatedContent = '';
        let hasFirstChunk = false;
        let streamedChars = 0;
        let emittedStreamPercent = Number.isFinite(Number(streamPercent)) ? Number(streamPercent) : 0;
        const temperature = await this._getTemperature(task_type);
        const session = this.sessions.get(sessionId);
        const waitingFloor = Math.max(10, streamPercent - 20);
        const waitingCeiling = Math.max(waitingFloor, streamPercent - 4);
        let waitingPercent = waitingFloor;
        let waitTicker = null;

        this._emitProgress(sessionId, `stage_${stageName}_calling_llm`, Math.max(10, streamPercent - 15), `正在连接 ${stageName} 阶段模型...`);
        this._emitLog(sessionId, stageName, `${stageName} 阶段已发出请求，正在等待模型首个响应片段。`);

        waitTicker = setInterval(() => {
            if (hasFirstChunk) {
                return;
            }
            waitingPercent = Math.min(waitingCeiling, waitingPercent + 1);
            this._emitProgress(
                sessionId,
                `stage_${stageName}_waiting_first_chunk`,
                waitingPercent,
                `模型已连接，正在等待 ${stageName} 阶段首个响应片段...`
            );
        }, 1200);

        try {
            const { usedConfig, providerPath } = await this.providerOrchestrator.streamCompletion({
                preferredConfigId: session?.config_id || null,
                messages,
                temperature,
                max_tokens: stageName === 'review' || stageName === 'review_repair' ? 4096 : 4096,
                signal: controller.signal,
                response_format: responseFormat,
                allow_json_object_fallback: true,
                allow_raw_fallback: stageName === 'scoring',
                onProviderEvent: (providerEvent) => {
                    this._emitLog(sessionId, stageName, this._formatProviderLog(stageName, providerEvent));
                },
                onChunk: (chunk) => {
                    accumulatedContent += chunk;
                    if (!hasFirstChunk) {
                        hasFirstChunk = true;
                        this._emitLog(sessionId, stageName, `${stageName} 阶段已收到首个响应片段。`);
                    }
                    streamedChars += String(chunk || '').length;
                    const resolvedStart = Number.isFinite(Number(streamProgressStart))
                        ? Number(streamProgressStart)
                        : streamPercent;
                    const resolvedEnd = Number.isFinite(Number(streamProgressEnd))
                        ? Number(streamProgressEnd)
                        : streamPercent;
                    const clampedStart = Math.min(resolvedStart, resolvedEnd);
                    const clampedEnd = Math.max(resolvedStart, resolvedEnd);
                    const range = Math.max(0, clampedEnd - clampedStart);
                    const dynamicStep = range > 0
                        ? Math.min(range, Math.floor(streamedChars / 140))
                        : 0;
                    const nextPercent = Math.max(
                        emittedStreamPercent,
                        Math.min(clampedEnd, clampedStart + dynamicStep)
                    );
                    emittedStreamPercent = nextPercent;
                    this._emitProgress(sessionId, `stage_${stageName}_streaming`, nextPercent, streamMessage);
                }
            });

            return {
                usedConfig,
                providerPath,
                accumulatedContent
            };
        } finally {
            if (waitTicker) {
                clearInterval(waitTicker);
            }
        }
    }

    _buildScoringMessages({ prompt, task_type, topicContext, content, word_count }) {
        const evaluationPacket = this._buildEvaluationPacket({
            stage: 'scoring',
            task_type,
            topicContext,
            content,
            word_count
        });
        const systemMessage = {
            role: 'system',
            content: [
                prompt.system_prompt,
                prompt.scoring_criteria,
                '你正在执行固定评测链路的第一阶段（scoring）。',
                '输出要求:',
                '- 只输出一个 JSON 对象，不要输出 markdown code block。',
                '- 顶层必须包含 total_score、task_achievement、coherence_cohesion、lexical_resource、grammatical_range。',
                '- 顶层还应包含 task_analysis、band_rationale、input_context（含题目理解、任务覆盖、立场和主要短板）。',
                '- improvement_plan 可以输出，但必须是简短字符串数组。',
                '- 不要输出 sentences 和 overall_feedback，第二阶段会处理详解。',
                `JSON 示例:\n${JSON.stringify(buildScoringStageExample(task_type), null, 2)}`
            ].join('\n\n')
        };

        const userMessage = {
            role: 'user',
            content: [
                '请只执行第一阶段评分：',
                '1. 识别题目类型、题目要求、立场与必须覆盖的任务点。',
                '2. 审查文章结构、段落组织、论点展开和覆盖度。',
                '3. 按 IELTS 四项标准分别打分，并给出 band-level 理由。',
                '4. 形成结构化 task_analysis 与 band_rationale。',
                '',
                '评测输入如下：',
                JSON.stringify(evaluationPacket, null, 2)
            ].join('\n')
        };

        return [systemMessage, userMessage];
    }

    _buildReviewMessages({ prompt, task_type, topicContext, content, word_count, scoringEvaluation }) {
        const evaluationPacket = this._buildEvaluationPacket({
            stage: 'review',
            task_type,
            topicContext,
            content,
            word_count
        });

        const scoringSummary = {
            total_score: scoringEvaluation.total_score,
            task_achievement: scoringEvaluation.task_achievement,
            coherence_cohesion: scoringEvaluation.coherence_cohesion,
            lexical_resource: scoringEvaluation.lexical_resource,
            grammatical_range: scoringEvaluation.grammatical_range,
            task_analysis: scoringEvaluation.task_analysis || null,
            band_rationale: scoringEvaluation.band_rationale || null,
            input_context: scoringEvaluation.input_context || null
        };

        const systemMessage = {
            role: 'system',
            content: [
                prompt.system_prompt,
                prompt.scoring_criteria,
                '你正在执行固定评测链路的第二阶段（review）。',
                '输出要求:',
                '- 只输出一个 JSON 对象，不要输出 markdown code block。',
                '- review_blocks 最多输出 4 条，只保留最影响分数的段落问题。',
                '- sentences 最多输出 6 条，只保留高价值、高影响的问题句，不要覆盖每一句。',
                '- 顶层必须包含 sentences（数组）和 overall_feedback（字符串）。',
                '- 顶层必须包含 review_blocks，且每项字段固定为 paragraph_index、comment、analysis、feedback。',
                '- 顶层应包含 improvement_plan、rewrite_suggestions。',
                '- 如果输出段落级详解，统一使用 paragraph_index、comment、analysis、feedback 字段，不要自造字段名。',
                '- 所有文案保持短而硬，避免长篇解释；优先输出能直接驱动改写的诊断。',
                '- 不要重算总分，不要修改第一阶段分数。'
            ].join('\n\n')
        };

        const userMessage = {
            role: 'user',
            content: [
                '请只执行第二阶段详解：',
                '1. 结合第一阶段评分结论，输出段落级与句级诊断。',
                '2. 句子问题保持少而精，优先影响分数的关键错误。',
                '3. review_blocks 只挑 2-4 个最关键段落；sentences 只挑 3-6 个最关键句子。',
                '4. 输出可执行的 improvement_plan。',
                `4. 输出格式参考:\n${JSON.stringify(buildReviewStageExample(), null, 2)}`,
                '',
                '第一阶段评分结论：',
                JSON.stringify(scoringSummary, null, 2),
                '',
                '评测输入如下：',
                JSON.stringify(evaluationPacket, null, 2)
            ].join('\n')
        };

        return [systemMessage, userMessage];
    }

    async _resolveTopicContext({ task_type, topic_id, topic_text }) {
        if (topic_id !== null && topic_id !== undefined) {
            const topic = await this.topicService.getById(topic_id);
            if (!topic) {
                throw new Error(`题目不存在: ${topic_id}`);
            }

            if (topic.type && topic.type !== task_type) {
                logger.warn('Topic type mismatch for evaluation session', null, {
                    expected: task_type,
                    actual: topic.type,
                    topic_id
                });
                const error = new Error(
                    `题型不匹配：当前评测为 ${task_type}，但题库题目 ${topic_id} 属于 ${topic.type}`
                );
                error.code = 'validation_error';
                throw error;
            }

            const extractedText = this._extractTextFromTiptap(topic.title_json).trim();
            if (!extractedText) {
                throw new Error(`题目内容为空: ${topic_id}`);
            }

            return {
                topicId: topic.id,
                source: 'topic_bank',
                text: extractedText
            };
        }

        const normalizedTopicText = typeof topic_text === 'string' ? topic_text.trim() : '';
        if (!normalizedTopicText) {
            throw new Error('缺少写作题目，请选择题库题目或输入自定义题目');
        }

        return {
            topicId: null,
            source: 'custom_input',
            text: normalizedTopicText
        };
    }

    _buildEvaluationPacket({ stage, task_type, topicContext, content, word_count }) {
        const isTask1 = task_type === 'task1';
        const target = isTask1
            ? { minimum: 150, recommended: '150-180' }
            : { minimum: 250, recommended: '250-280' };
        const outputContract = stage === 'review'
            ? {
                required_feedback_fields: [
                    'review_blocks',
                    'sentences',
                    'overall_feedback',
                    'improvement_plan',
                    'rewrite_suggestions'
                ],
                sentence_error_range_unit: 'utf16'
            }
            : {
                required_score_fields: [
                    'total_score',
                    'task_achievement',
                    'coherence_cohesion',
                    'lexical_resource',
                    'grammatical_range'
                ],
                required_analysis_fields: [
                    'task_analysis',
                    'band_rationale',
                    'improvement_plan',
                    'input_context'
                ]
            };

        return {
            evaluation_mode: 'ielts-writing-longchain-v1',
            stage,
            task_type,
            rubric_focus: isTask1 ? 'Task Achievement' : 'Task Response',
            topic_source: topicContext.source,
            topic_text: topicContext.text,
            word_count,
            recommended_word_count: target.recommended,
            minimum_word_count: target.minimum,
            essay_text: content,
            output_contract: outputContract
        };
    }

    _normalizeReviewBlocks(evaluation) {
        if (Array.isArray(evaluation?.review_blocks) && evaluation.review_blocks.length > 0) {
            return evaluation.review_blocks;
        }
        if (Array.isArray(evaluation?.paragraph_reviews) && evaluation.paragraph_reviews.length > 0) {
            return evaluation.paragraph_reviews;
        }
        return [];
    }

    _buildTimeoutMessage() {
        const seconds = Math.round(this.SESSION_TIMEOUT / 1000);
        return `评测超时 (${seconds}s),请重试`;
    }

    _extractTextFromTiptap(json) {
        if (typeof json === 'string') {
            try {
                return this._extractTextFromTiptap(JSON.parse(json));
            } catch {
                return json;
            }
        }

        if (!json || typeof json !== 'object') {
            return '';
        }

        if (json.type === 'text') {
            return json.text || '';
        }

        if (Array.isArray(json.content)) {
            return json.content.map((node) => this._extractTextFromTiptap(node)).join('');
        }

        return '';
    }

    /**
     * 解析评测结果
     */
    _parseEvaluation(rawContent, stageName) {
        try {
            const jsonStr = this._extractJsonObject(rawContent);

            return JSON.parse(jsonStr);
        } catch (error) {
            logger.error('Failed to parse evaluation JSON', error, null, {
                rawContent: rawContent.substring(0, 500) // 只记录前 500 字符
            });

            const parseError = new Error(`${stageName} 阶段响应解析失败: ${error.message}`);
            parseError.code = 'parse_error';
            throw parseError;
        }
    }

    _extractJsonObject(rawContent) {
        let jsonStr = rawContent.trim();

        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
        } else if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```\s*/g, '').trim();
        }

        if (jsonStr.startsWith('{') && jsonStr.endsWith('}')) {
            return jsonStr;
        }

        const start = jsonStr.indexOf('{');
        if (start === -1) {
            return jsonStr;
        }

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < jsonStr.length; i++) {
            const ch = jsonStr[i];

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    escaped = true;
                    continue;
                }
                if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
                continue;
            }

            if (ch === '{') {
                depth += 1;
                continue;
            }

            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return jsonStr.slice(start, i + 1);
                }
            }
        }

        return jsonStr;
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
        if (this._isTimeoutLikeError(error)) {
            return 'timeout';
        }
        if (
            error.message.includes('network')
            || error.message.includes('Network')
            || error.message.includes('网络')
        ) {
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
            session.controller.abort('session_timeout');
            this._emitError(sessionId, 'timeout', this._buildTimeoutMessage());
            this._recordSessionFinish(sessionId, {
                status: 'failed',
                errorCode: 'timeout',
                errorMessage: this._buildTimeoutMessage(),
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
        this.sessionProgress.delete(sessionId);
        this._pruneSessionEventCache();
    }

    /**
     * 发送进度事件
     */
    _emitProgress(sessionId, step, percent, message) {
        const lastPercent = Number(this.sessionProgress.get(sessionId) || 0);
        const targetPercentRaw = Number(percent);
        const targetPercent = Number.isFinite(targetPercentRaw)
            ? Math.max(0, Math.min(100, Math.round(targetPercentRaw)))
            : lastPercent;
        const safePercent = Math.max(lastPercent, targetPercent);
        this.sessionProgress.set(sessionId, safePercent);
        this._emitEvent(sessionId, {
            type: 'progress',
            data: { step, percent: safePercent, message }
        });
    }

    _emitStage(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'stage',
            data
        });
    }

    _emitAnalysis(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'analysis',
            data
        });
    }

    _emitReview(sessionId, data) {
        this._emitEvent(sessionId, {
            type: 'review',
            data
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

    _emitLog(sessionId, stage, message, detail = null) {
        if (!message) {
            return;
        }
        this._emitEvent(sessionId, {
            type: 'log',
            data: {
                stage,
                message,
                detail
            }
        });
    }

    /**
     * 保存评分结果到 essays 表
     */
    async _persistEvaluation(sessionId, { config, task_type, content, word_count, evaluation }) {
        const session = this.sessions.get(sessionId);
        const topicId = session?.topic_id || null;
        const storedEvaluation = decorateEvaluationForStorage(evaluation, session);

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
            evaluation_json: JSON.stringify(storedEvaluation)
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
        const sequence = this._cacheSessionEvent(sessionId, eventData);
        const payload = {
            sessionId,
            sequence,
            ...eventData
        };

        this.eventBus.emit(`session:${sessionId}`, payload);

        if (!this.webContents || typeof this.webContents.send !== 'function') {
            logger.warn('webContents not available, cannot emit event');
            return;
        }

        this.webContents.send('evaluate:event', payload);
    }

    _resetSessionEventCache(sessionId) {
        this.sessionProgress.set(sessionId, 0);
        this.sessionEventCache.set(sessionId, {
            seq: 0,
            updatedAt: Date.now(),
            events: []
        });
        this._pruneSessionEventCache();
    }

    _cacheSessionEvent(sessionId, eventData) {
        const cache = this.sessionEventCache.get(sessionId) || {
            seq: 0,
            updatedAt: Date.now(),
            events: []
        };
        cache.seq += 1;
        cache.updatedAt = Date.now();
        cache.events.push({
            sessionId,
            sequence: cache.seq,
            ...eventData
        });
        if (cache.events.length > this.maxCachedEventsPerSession) {
            cache.events = cache.events.slice(-this.maxCachedEventsPerSession);
        }
        this.sessionEventCache.set(sessionId, cache);
        return cache.seq;
    }

    _pruneSessionEventCache() {
        const now = Date.now();
        for (const [sessionId, cache] of this.sessionEventCache.entries()) {
            if ((cache?.updatedAt || 0) + this.sessionCacheTtlMs < now) {
                this.sessionEventCache.delete(sessionId);
            }
        }
    }

    _formatProviderLog(stageName, providerEvent) {
        if (!providerEvent || typeof providerEvent !== 'object') {
            return '';
        }

        const providerLabel = `${providerEvent.provider || 'unknown'}/${providerEvent.model || 'unknown'}`;
        if (providerEvent.type === 'candidate_start') {
            return `${stageName} 阶段连接 ${providerLabel}...`;
        }
        if (providerEvent.type === 'candidate_retry') {
            return `${stageName} 阶段重试 ${providerLabel}（第 ${providerEvent.attempt} 次）...`;
        }
        if (providerEvent.type === 'candidate_skip') {
            return `${stageName} 阶段跳过 ${providerLabel}：冷却中`;
        }
        if (providerEvent.type === 'candidate_success') {
            return `${stageName} 阶段已接入 ${providerLabel}`;
        }
        if (providerEvent.type === 'candidate_failed') {
            return `${stageName} 阶段 ${providerLabel} 失败：${providerEvent.message || providerEvent.error_code || 'unknown_error'}`;
        }
        return '';
    }

    _isAbortLikeError(error) {
        if (!error) {
            return false;
        }
        const code = String(error.code || '').toLowerCase();
        const name = String(error.name || '').toLowerCase();
        const message = String(error.message || '').toLowerCase();
        return (
            code === 'request_cancelled'
            || code === 'cancelled'
            || name === 'aborterror'
            || message.includes('用户已取消')
            || message.includes('请求已取消')
            || message.includes('已取消')
            || message.includes('aborted')
            || message.includes('abort')
        );
    }

    _isTimeoutLikeError(error) {
        if (String(error?.code || '').toLowerCase() === 'timeout') {
            return true;
        }
        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('timeout')
            || message.includes('timed out')
            || message.includes('请求超时已取消')
            || message.includes('超时')
        );
    }

    _shouldFailSessionForReviewError(error) {
        return this._isAbortLikeError(error) || this._isTimeoutLikeError(error);
    }
}

module.exports = EvaluateService;
