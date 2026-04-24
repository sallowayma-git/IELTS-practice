// @ts-nocheck
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { ProviderOrchestratorService } = require('../shared/provider-orchestrator.js');
const {
    buildReadingCoachPrompt,
    buildCoachResponseFormat,
    normalizeReadingCoachModelResponse,
    composeReadingCoachAnswer
} = require('./prompt.js');
const {
    createTokenizer,
    buildReadingRetrievalContext
} = require('./retrieval.js');
const {
    classifyReadingRoute,
    classifyReadingIntent,
    resolveReadingContextRoute
} = require('./router.js');
const {
    buildReadingChunks
} = require('./chunks.js');
const logger = require('../../../../electron/utils/logger.js');

const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 45000;

const ROUTES = Object.freeze({
    UNRELATED_CHAT: 'unrelated_chat',
    IELTS_GENERAL: 'ielts_general',
    PAGE_GROUNDED: 'page_grounded'
});

const CONTEXT_ROUTES = Object.freeze({
    TUTOR: 'tutor',
    SELECTION: 'selection',
    REVIEW: 'review',
    FOLLOWUP: 'followup',
    CLARIFY: 'clarify',
    SIMILAR: 'similar'
});

const INTENTS = Object.freeze({
    GROUNDED_QUESTION: 'grounded_question',
    WHOLE_SET_OR_REVIEW: 'whole_set_or_review',
    FOLLOWUP_REQUEST: 'followup_request',
    SOCIAL_OR_SMALLTALK: 'social_or_smalltalk',
    GENERAL_CHAT: 'general_chat',
    SELECTION_TOOL_REQUEST: 'selection_tool_request',
    REVIEW_COACH_REQUEST: 'review_coach_request',
    CLARIFY: 'clarify'
});

const CHUNK_TYPE = Object.freeze({
    PASSAGE: 'passage_paragraph',
    QUESTION: 'question_item',
    ANSWER_KEY: 'answer_key',
    EXPLANATION: 'answer_explanation'
});

const SOCIAL_PATTERNS = [
    /^(你好|您好|hi|hello|hey|thanks|thank\s*you|bye|再见|在吗|谢谢)[\s,.!?，。！？]*$/i,
    /^(你是谁|你能做什么|what\s+can\s+you\s+do|who\s+are\s+you)[\s?.!]*$/i
];

const WEATHER_TIME_PATTERNS = [
    /天气|下雨|气温|几点|日期|星期|what\s+time|what\s+day|weather/i
];

const WHOLE_SET_PATTERNS = [
    /整组|整篇|全文|这组题|全部题目|所有题|一起讲|整体思路|总览|复盘|错题|review\s+all|whole\s+set|all\s+questions|my\s+mistakes/i
];

const IELTS_GENERAL_PATTERNS = [
    /雅思|ielts/i,
    /阅读|听力|写作|口语|reading|listening|writing|speaking/i,
    /技巧|方法|策略|提高|备考|词汇|同义替换|how\s+to|tips?|strategy|improve|vocabulary|paraphrase/i
];

const PAGE_GROUNDED_HINTS = [
    /这篇|这道题|这题|本段|paragraph\s*[a-h]|question\s*\d+|\bq\d+\b|段落\s*[a-h]|证据|定位|题干/i
];

const QUESTION_REF_PATTERN_GLOBAL = /(?:第\s*(\d+)\s*题)|(?:question\s*(\d+))|(?:\bq(\d+)\b)|(?:paragraph\s*([a-h]))|(?:段落\s*([a-h]))/ig;

const SEARCH_STOPWORDS = new Set([
    'about', 'above', 'after', 'again', 'against', 'among', 'because', 'before', 'being', 'below', 'between',
    'could', 'does', 'doing', 'from', 'have', 'into', 'more', 'most', 'only', 'other', 'same', 'should',
    'than', 'that', 'their', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'using', 'very',
    'what', 'when', 'where', 'which', 'while', 'with', 'would', 'your', 'answer', 'answers', 'question',
    'questions', 'paragraph', 'section', 'shared', 'instructions', 'prompt', 'true', 'false', 'given',
    'option', 'options', 'passage', 'review', 'hint', 'explain',
    '怎么', '如何', '这个', '那个', '我们', '你们', '他们', '是否', '可以', '需要', '还是', '以及', '然后', '因为', '所以',
    '阅读', '题目', '题干', '答案', '解析', '段落', '问题', '一下', '一下子', '帮我'
]);

const QUICK_ACTIONS = Object.freeze([
    { id: 'hint', label: '给我提示' },
    { id: 'explain', label: '解释这题' },
    { id: 'review', label: '复盘错题' },
    { id: 'similar', label: '推荐同类题' }
]);
const PASSAGE_CONTEXT_FALLBACK_LIMIT = 3;

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueList(list = []) {
    const seen = new Set();
    const output = [];
    list.forEach((item) => {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            return;
        }
        seen.add(value);
        output.push(value);
    });
    return output;
}

function tokenize(value) {
    return createTokenizer(SEARCH_STOPWORDS)(value);
}

function nowIso() {
    return new Date().toISOString();
}

function formatAnswerValue(value) {
    if (Array.isArray(value)) {
        return uniqueList(value.map((item) => String(item || '').trim()).filter(Boolean)).join(' / ');
    }
    return String(value || '').trim();
}

class ReadingCoachService {
    constructor(configService) {
        this.providerOrchestrator = new ProviderOrchestratorService(configService);
        this.examBundleCache = new Map();
        this.queryCache = new Map();
        this.assetsBaseDir = path.resolve(__dirname, '../../../../assets/generated');
        this.examsDir = path.resolve(this.assetsBaseDir, 'reading-exams');
        this.explanationsDir = path.resolve(this.assetsBaseDir, 'reading-explanations');
    }

    async query(payload = {}, options = {}) {
        const startedAt = Date.now();
        const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        const emit = (type, data = {}) => {
            if (!onEvent) return;
            try {
                onEvent({ type, data, ts: Date.now() });
            } catch (_) {
                // ignore event callback errors
            }
        };

        const normalized = this._normalizePayload(payload);
        if (!normalized.attemptContext.submitted) {
            const error = new Error('当前仍在做题阶段，提交后才能使用 AI 教练');
            error.code = 'coach_locked_until_submit';
            throw error;
        }
        const cacheKey = this._buildCacheKey(normalized);
        const cached = this._getCache(cacheKey);
        if (cached) {
            emit('cache_hit', { route: cached.route, intent: cached.intent?.kind || '' });
            return Object.assign({}, cached, {
                cacheHit: true,
                generatedAt: nowIso(),
                timings: Object.assign({}, cached.timings || {}, {
                    total_ms: Date.now() - startedAt,
                    cache_hit: true
                })
            });
        }

        const routeDecision = this._classifyRoute(normalized);
        const intent = this._classifyIntent(normalized, routeDecision.route);
        const contextRoute = this._resolveContextRoute(normalized, intent);
        emit('route', {
            route: routeDecision.route,
            reason: routeDecision.reason,
            intent: intent.kind,
            contextRoute
        });

        const retrievalStartedAt = Date.now();
        const retrieval = await this._collectContext(normalized, routeDecision.route, contextRoute, intent);
        const retrievalMs = Date.now() - retrievalStartedAt;
        emit('retrieval', {
            chunkCount: retrieval.finalChunks.length,
            missingContext: retrieval.missingContext,
            focusQuestionNumbers: retrieval.focusQuestionNumbers,
            focusParagraphLabels: retrieval.focusParagraphLabels
        });

        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort('timeout'), REQUEST_TIMEOUT_MS);

        let rawContent = '';
        let usedConfig = null;
        let providerPath = [];

        try {
            emit('generation_start', {
                route: routeDecision.route,
                contextRoute,
                intent: intent.kind
            });

            const prompt = this._buildPrompt({
                payload: normalized,
                routeDecision,
                intent,
                contextRoute,
                retrieval
            });

            const streamResult = await this.providerOrchestrator.streamCompletion({
                preferredConfigId: normalized.apiConfigId,
                messages: prompt,
                temperature: 0.2,
                max_tokens: 1200,
                signal: timeoutController.signal,
                onChunk: (chunk) => {
                    if (typeof chunk === 'string' && chunk) {
                        rawContent += chunk;
                        emit('model_delta', { delta: chunk });
                    }
                },
                response_format: this._buildCoachResponseFormat(contextRoute)
            });

            usedConfig = streamResult?.usedConfig || null;
            providerPath = Array.isArray(streamResult?.providerPath) ? streamResult.providerPath : [];

            const parsed = this._normalizeModelResponse(rawContent);
            const citations = this._buildCitations(retrieval.finalChunks);
            const answerText = composeReadingCoachAnswer(parsed.answerSections, parsed.answer);

            const result = {
                coachVersion: 'v2',
                generatedAt: nowIso(),
                route: routeDecision.route,
                routeReason: routeDecision.reason,
                contextRoute,
                intent,
                answer: answerText,
                answerSections: parsed.answerSections,
                reviewOverall: parsed.reviewOverall,
                reviewQuestionAnalyses: parsed.reviewQuestionAnalyses,
                followUps: parsed.followUps,
                confidence: parsed.confidence,
                missingContext: uniqueList([...(retrieval.missingContext || []), ...(parsed.missingContext || [])]).slice(0, 6),
                citations,
                usedQuestionNumbers: retrieval.usedQuestionNumbers,
                usedParagraphLabels: retrieval.usedParagraphLabels,
                quickActions: QUICK_ACTIONS.slice(),
                responseKind: this._resolveResponseKind(routeDecision.route, intent),
                contextDiagnostics: {
                    chunkCount: retrieval.finalChunks.length,
                    deterministicChunkCount: retrieval.sortedChunks.length,
                    focusQuestionNumbers: retrieval.focusQuestionNumbers,
                    focusParagraphLabels: retrieval.focusParagraphLabels
                },
                model_trace: {
                    config_id: usedConfig?.id || null,
                    provider: usedConfig?.provider || null,
                    model: usedConfig?.default_model || null,
                    provider_path: providerPath,
                    latency_ms: Date.now() - startedAt
                },
                timings: {
                    total_ms: Date.now() - startedAt,
                    retrieval_ms: retrievalMs,
                    generation_ms: Math.max(0, Date.now() - startedAt - retrievalMs),
                    cache_hit: false
                }
            };

            this._setCache(cacheKey, result);
            emit('generation_complete', {
                answerLength: result.answer.length,
                followUps: result.followUps.length,
                confidence: result.confidence
            });
            return result;
        } catch (error) {
            const wrapped = this._normalizeError(error);
            emit('generation_error', {
                code: wrapped.code,
                message: wrapped.message
            });
            throw wrapped;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    _normalizePayload(payload = {}) {
        const source = isObject(payload) ? payload : {};
        const query = String(source.query || source.userQuery || '').trim();
        const selectedContext = isObject(source.selectedContext) ? source.selectedContext : {};
        const selectedText = String(source.selectedText || selectedContext.text || '').trim();
        const history = Array.isArray(source.history)
            ? source.history
                .map((item) => {
                    if (!isObject(item)) return null;
                    const role = String(item.role || '').trim().toLowerCase() === 'assistant' ? 'assistant' : 'user';
                    const content = String(item.content || '').trim();
                    if (!content) return null;
                    return { role, content: content.slice(0, 1000) };
                })
                .filter(Boolean)
                .slice(-8)
            : [];

        const attemptContext = isObject(source.attemptContext)
            ? source.attemptContext
            : (isObject(source.practiceContext) ? source.practiceContext : {});

        const focusQuestionNumbers = uniqueList(
            [
                ...(Array.isArray(source.focusQuestionNumbers) ? source.focusQuestionNumbers : []),
                ...(Array.isArray(source.questionNumbers) ? source.questionNumbers : [])
            ]
                .map((item) => String(item || '').trim().replace(/^q/i, ''))
                .filter(Boolean)
        );

        const examId = String(source.examId || source.questionId || '').trim();
        if (!examId) {
            const error = new Error('缺少 examId，无法执行阅读教练查询');
            error.code = 'invalid_payload';
            throw error;
        }

        return {
            examId,
            query,
            locale: String(source.locale || 'zh').trim().toLowerCase() === 'en' ? 'en' : 'zh',
            surface: String(source.surface || '').trim().toLowerCase(),
            action: String(source.action || 'chat').trim().toLowerCase(),
            promptKind: String(source.promptKind || '').trim().toLowerCase(),
            selectedText,
            selectedScope: String(selectedContext.scope || source.selectedScope || '').trim().toLowerCase(),
            focusQuestionNumbers,
            history,
            attemptContext: {
                submitted: Boolean(attemptContext.submitted),
                score: Number.isFinite(Number(attemptContext.score)) ? Number(attemptContext.score) : null,
                wrongQuestions: Array.isArray(attemptContext.wrongQuestions)
                    ? attemptContext.wrongQuestions.map((item) => String(item || '').trim()).filter(Boolean)
                    : [],
                selectedAnswers: isObject(attemptContext.selectedAnswers)
                    ? Object.entries(attemptContext.selectedAnswers).reduce((accumulator, [questionId, value]) => {
                        const normalizedQuestion = String(questionId || '').trim().replace(/^q/i, '');
                        const answerText = formatAnswerValue(value);
                        if (!normalizedQuestion || !answerText) {
                            return accumulator;
                        }
                        accumulator[normalizedQuestion] = answerText;
                        return accumulator;
                    }, {})
                    : {}
            },
            apiConfigId: source.api_config_id || source.config_id || source.apiConfigId || null
        };
    }

    _buildCacheKey(payload) {
        return JSON.stringify({
            examId: payload.examId,
            query: payload.query,
            locale: payload.locale,
            surface: payload.surface,
            action: payload.action,
            promptKind: payload.promptKind,
            selectedText: payload.selectedText,
            focusQuestionNumbers: payload.focusQuestionNumbers,
            submitted: payload.attemptContext.submitted,
            score: payload.attemptContext.score,
            wrongQuestions: payload.attemptContext.wrongQuestions,
            selectedAnswers: payload.attemptContext.selectedAnswers,
            history: payload.history
        });
    }

    _getCache(key) {
        const entry = this.queryCache.get(key);
        if (!entry) {
            return null;
        }
        if (entry.expiresAt <= Date.now()) {
            this.queryCache.delete(key);
            return null;
        }
        return entry.value;
    }

    _setCache(key, value) {
        this.queryCache.set(key, {
            value,
            expiresAt: Date.now() + QUERY_CACHE_TTL_MS
        });
    }

    _classifyRoute(payload) {
        return classifyReadingRoute(payload, {
            routes: ROUTES,
            socialPatterns: SOCIAL_PATTERNS,
            weatherTimePatterns: WEATHER_TIME_PATTERNS,
            ieltsGeneralPatterns: IELTS_GENERAL_PATTERNS,
            pageGroundedHints: PAGE_GROUNDED_HINTS
        });
    }

    _classifyIntent(payload, route) {
        return classifyReadingIntent(payload, route, {
            routes: ROUTES,
            intents: INTENTS,
            socialPatterns: SOCIAL_PATTERNS,
            wholeSetPatterns: WHOLE_SET_PATTERNS,
            questionRefPatternGlobal: QUESTION_REF_PATTERN_GLOBAL
        });
    }

    _resolveContextRoute(payload, intent) {
        return resolveReadingContextRoute(payload, intent, {
            contextRoutes: CONTEXT_ROUTES,
            intents: INTENTS
        });
    }

    async _collectContext(payload, route, contextRoute, intent) {
        if (route !== ROUTES.PAGE_GROUNDED) {
            return {
                finalChunks: [],
                sortedChunks: [],
                missingContext: [],
                focusQuestionNumbers: intent.questionNumbers || [],
                focusParagraphLabels: intent.paragraphLabels || [],
                usedQuestionNumbers: [],
                usedParagraphLabels: []
            };
        }

        const bundle = await this._loadExamBundle(payload.examId);
        return buildReadingRetrievalContext({
            bundle,
            payload,
            contextRoute,
            intent,
            contextRoutes: CONTEXT_ROUTES,
            chunkType: CHUNK_TYPE,
            tokenize,
            passageFallbackLimit: PASSAGE_CONTEXT_FALLBACK_LIMIT
        });
    }

    async _loadExamBundle(examId) {
        if (this.examBundleCache.has(examId)) {
            return this.examBundleCache.get(examId);
        }

        const examPath = path.resolve(this.examsDir, `${examId}.js`);
        if (!fs.existsSync(examPath)) {
            const error = new Error(`阅读题数据缺失：${examId}`);
            error.code = 'exam_data_missing';
            throw error;
        }

        const examDataset = this._evaluateExamFile(examPath);
        const explanationPath = path.resolve(this.explanationsDir, `${examId}.js`);
        const explanationDataset = fs.existsSync(explanationPath)
            ? this._evaluateExplanationFile(explanationPath)
            : null;

        const chunks = this._buildChunks(examId, examDataset, explanationDataset);
        const bundle = {
            examId,
            examDataset,
            explanationDataset,
            chunks
        };

        this.examBundleCache.set(examId, bundle);
        return bundle;
    }

    _evaluateExamFile(filePath) {
        const source = fs.readFileSync(filePath, 'utf8');
        let captured = null;
        const host = {
            __READING_EXAM_DATA__: {
                register: (_key, payload) => {
                    captured = payload;
                }
            }
        };
        const sandbox = {
            window: host,
            globalThis: host,
            global: host,
            console
        };
        vm.runInNewContext(source, sandbox, {
            filename: filePath,
            timeout: 3000
        });
        if (!isObject(captured)) {
            const error = new Error(`读取阅读题数据失败：${path.basename(filePath)}`);
            error.code = 'exam_data_parse_failed';
            throw error;
        }
        return captured;
    }

    _evaluateExplanationFile(filePath) {
        const source = fs.readFileSync(filePath, 'utf8');
        let captured = null;
        const host = {
            __READING_EXPLANATION_DATA__: {
                register: (_key, payload) => {
                    captured = payload;
                }
            }
        };
        const sandbox = {
            window: host,
            globalThis: host,
            global: host,
            console
        };
        vm.runInNewContext(source, sandbox, {
            filename: filePath,
            timeout: 3000
        });
        return isObject(captured) ? captured : null;
    }

    _buildChunks(examId, examDataset, explanationDataset) {
        return buildReadingChunks(examId, examDataset, explanationDataset, CHUNK_TYPE);
    }

    _buildPrompt({ payload, routeDecision, intent, contextRoute, retrieval }) {
        return buildReadingCoachPrompt({
            payload,
            routeDecision,
            intent,
            contextRoute,
            retrieval,
            routes: ROUTES,
            contextRoutes: CONTEXT_ROUTES,
            chunkType: CHUNK_TYPE
        });
    }

    _buildCoachResponseFormat(contextRoute) {
        return buildCoachResponseFormat({
            contextRoute,
            contextRoutes: CONTEXT_ROUTES
        });
    }

    _normalizeModelResponse(rawContent) {
        return normalizeReadingCoachModelResponse(rawContent, logger);
    }

    _buildCitations(chunks = []) {
        return chunks.slice(0, 10).map((chunk) => ({
            id: chunk.id,
            chunkType: chunk.chunkType,
            questionNumbers: chunk.questionNumbers,
            paragraphLabels: chunk.paragraphLabels,
            excerpt: String(chunk.content || '').slice(0, 220)
        }));
    }

    _resolveResponseKind(route, intent) {
        if (route === ROUTES.UNRELATED_CHAT) {
            return intent.kind === INTENTS.SOCIAL_OR_SMALLTALK ? 'social' : 'chat';
        }
        if (intent.kind === INTENTS.SELECTION_TOOL_REQUEST) {
            return 'tool_result';
        }
        if (intent.kind === INTENTS.REVIEW_COACH_REQUEST || intent.kind === INTENTS.WHOLE_SET_OR_REVIEW) {
            return 'review';
        }
        if (intent.kind === INTENTS.CLARIFY) {
            return 'clarify';
        }
        return route === ROUTES.PAGE_GROUNDED ? 'grounded' : 'chat';
    }

    _normalizeError(error) {
        if (error && typeof error === 'object' && error.code) {
            return error;
        }

        const wrapped = error instanceof Error ? error : new Error(String(error || 'reading_coach_failed'));
        if (!wrapped.code) {
            const message = String(wrapped.message || '').toLowerCase();
            if (message.includes('timeout')) {
                wrapped.code = 'timeout';
            } else if (message.includes('network')) {
                wrapped.code = 'network_error';
            } else {
                wrapped.code = 'reading_coach_failed';
            }
        }
        return wrapped;
    }
}

module.exports = ReadingCoachService;
