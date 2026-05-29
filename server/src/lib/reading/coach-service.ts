// @ts-nocheck
const fs = require('fs');
const path = require('path');

const { ProviderOrchestratorService } = require('../shared/provider-orchestrator.js');
const {
    parseReadingExamDataSource,
    parseReadingExplanationDataSource
} = require('../shared/reading-generated-data.js');
const {
    setBoundedCacheEntry,
    touchCacheEntry
} = require('../shared/cache.js');
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
const {
    READING_ROUTES,
    READING_CONTEXT_ROUTES,
    READING_INTENTS,
    READING_CHUNK_TYPE,
    buildReadingCoachResult,
    buildReadingTimings
} = require('./contracts.js');
const logger = require('../../../../electron/utils/logger.js');

const QUERY_CACHE_TTL_MS = 5 * 60 * 1000;
const EXAM_BUNDLE_CACHE_LIMIT = 12;
const QUERY_CACHE_LIMIT = 64;
const REQUEST_TIMEOUT_MS = 45000;

const ROUTES = READING_ROUTES;
const CONTEXT_ROUTES = READING_CONTEXT_ROUTES;
const INTENTS = READING_INTENTS;
const CHUNK_TYPE = READING_CHUNK_TYPE;

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

function normalizeQuestionNumberList(values = []) {
    return uniqueList(
        (Array.isArray(values) ? values : [])
            .map((item) => String(item || '').trim().replace(/^q/i, ''))
            .filter(Boolean)
    );
}

function normalizeParagraphLabelList(values = []) {
    return uniqueList(
        (Array.isArray(values) ? values : [])
            .map((item) => String(item || '').trim().replace(/^paragraph\s*/i, '').toUpperCase())
            .filter(Boolean)
    );
}

function normalizeAnalysisSignals(value = {}) {
    if (!isObject(value)) {
        return null;
    }
    const output = {};
    [
        'questionCount',
        'unansweredCount',
        'changedAnswerCount',
        'markedQuestionCount',
        'highlightCount',
        'interactionDensity'
    ].forEach((key) => {
        const numeric = Number(value[key]);
        if (Number.isFinite(numeric)) {
            output[key] = numeric;
        }
    });
    return Object.keys(output).length ? output : null;
}

function normalizeQuestionTimelineLite(values = []) {
    return (Array.isArray(values) ? values : [])
        .map((item) => {
            if (!isObject(item)) return null;
            const questionId = String(item.questionId || '').trim();
            const displayLabel = String(item.displayLabel || questionId || '').trim().replace(/^q/i, '');
            const changeCount = Math.max(0, Number(item.changeCount) || 0);
            const visitCount = Math.max(0, Number(item.visitCount) || 0);
            const elapsedMs = Math.max(0, Number(item.elapsedMs ?? item.durationMs) || 0);
            if (!questionId && !displayLabel && !changeCount && !visitCount && !elapsedMs) return null;
            return {
                questionId,
                displayLabel,
                changeCount,
                visitCount,
                elapsedMs,
                durationMs: elapsedMs
            };
        })
        .filter(Boolean)
        .slice(0, 40);
}

function normalizeQuestionTypePerformance(value = {}) {
    if (!isObject(value)) {
        return {};
    }
    return Object.entries(value).reduce((accumulator, [kind, entry]) => {
        if (!isObject(entry)) {
            return accumulator;
        }
        const normalizedKind = String(entry.kind || kind || '').trim();
        if (!normalizedKind) {
            return accumulator;
        }
        accumulator[normalizedKind] = {
            total: Number.isFinite(Number(entry.total)) ? Number(entry.total) : 0,
            correct: Number.isFinite(Number(entry.correct)) ? Number(entry.correct) : 0,
            accuracy: Number.isFinite(Number(entry.accuracy)) ? Number(entry.accuracy) : 0
        };
        return accumulator;
    }, {});
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

    getCacheStats() {
        this._pruneExpiredQueryCache();
        return {
            examBundleEntries: this.examBundleCache.size,
            examBundleLimit: EXAM_BUNDLE_CACHE_LIMIT,
            examIds: Array.from(this.examBundleCache.keys()),
            queryEntries: this.queryCache.size,
            queryLimit: QUERY_CACHE_LIMIT
        };
    }

    clearCaches() {
        this.examBundleCache.clear();
        this.queryCache.clear();
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
            const cachedContextDiagnostics = Object.assign({}, cached.contextDiagnostics || {}, { cacheHit: true });
            return Object.assign({}, cached, {
                cacheHit: true,
                generatedAt: nowIso(),
                contextDiagnostics: cachedContextDiagnostics,
                retrievalDiagnostics: Object.assign({}, cached.retrievalDiagnostics || cachedContextDiagnostics, { cacheHit: true }),
                timings: buildReadingTimings({ startedAt, retrievalMs: 0, cacheHit: true })
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

            const parsed = this._normalizeModelResponse(rawContent, contextRoute);
            const citations = this._buildCitations(retrieval.finalChunks);
            const answerText = composeReadingCoachAnswer(parsed.answerSections, parsed.answer);

            const result = buildReadingCoachResult({
                generatedAt: nowIso(),
                routeDecision,
                contextRoute,
                intent,
                answer: answerText,
                parsed,
                retrieval,
                citations,
                usedConfig,
                providerPath,
                startedAt,
                retrievalMs
            });

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
        const rawSelectedContext = isObject(source.selectedContext) ? source.selectedContext : {};
        const selectedText = String(source.selectedText || rawSelectedContext.text || '').trim();
        const selectedScope = String(rawSelectedContext.scope || source.selectedScope || '').trim().toLowerCase();
        const selectedContextQuestionNumbers = normalizeQuestionNumberList(rawSelectedContext.questionNumbers);
        const selectedContextParagraphLabels = normalizeParagraphLabelList(rawSelectedContext.paragraphLabels);
        const selectedContext = selectedText || selectedScope || selectedContextQuestionNumbers.length || selectedContextParagraphLabels.length
            ? {
                text: selectedText,
                scope: selectedScope === 'question' ? 'question' : (selectedScope === 'passage' ? 'passage' : ''),
                questionNumbers: selectedContextQuestionNumbers,
                paragraphLabels: selectedContextParagraphLabels
            }
            : null;
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
                ...(Array.isArray(source.questionNumbers) ? source.questionNumbers : []),
                ...selectedContextQuestionNumbers
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
            sessionId: String(source.sessionId || source.session_id || '').trim(),
            mode: String(source.mode || '').trim().toLowerCase(),
            query,
            locale: String(source.locale || 'zh').trim().toLowerCase() === 'en' ? 'en' : 'zh',
            surface: String(source.surface || '').trim().toLowerCase(),
            action: String(source.action || 'chat').trim().toLowerCase(),
            promptKind: String(source.promptKind || '').trim().toLowerCase(),
            selectedText,
            selectedScope,
            selectedContext,
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
                    : {},
                analysisSignals: normalizeAnalysisSignals(attemptContext.analysisSignals),
                markedQuestions: Array.isArray(attemptContext.markedQuestions)
                    ? attemptContext.markedQuestions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40)
                    : [],
                questionTimelineLite: normalizeQuestionTimelineLite(attemptContext.questionTimelineLite),
                questionTypePerformance: normalizeQuestionTypePerformance(attemptContext.questionTypePerformance)
            },
            apiConfigId: source.api_config_id || source.config_id || source.apiConfigId || null
        };
    }

    _buildCacheKey(payload) {
        return JSON.stringify({
            examId: payload.examId,
            sessionId: payload.sessionId,
            mode: payload.mode,
            query: payload.query,
            locale: payload.locale,
            surface: payload.surface,
            action: payload.action,
            promptKind: payload.promptKind,
            selectedText: payload.selectedText,
            selectedContext: payload.selectedContext,
            focusQuestionNumbers: payload.focusQuestionNumbers,
            submitted: payload.attemptContext.submitted,
            score: payload.attemptContext.score,
            wrongQuestions: payload.attemptContext.wrongQuestions,
            selectedAnswers: payload.attemptContext.selectedAnswers,
            analysisSignals: payload.attemptContext.analysisSignals,
            markedQuestions: payload.attemptContext.markedQuestions,
            questionTimelineLite: payload.attemptContext.questionTimelineLite,
            questionTypePerformance: payload.attemptContext.questionTypePerformance,
            history: payload.history
        });
    }

    _getCache(key) {
        const entry = touchCacheEntry(this.queryCache, key);
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
        this._pruneExpiredQueryCache();
        setBoundedCacheEntry(this.queryCache, key, {
            value,
            expiresAt: Date.now() + QUERY_CACHE_TTL_MS
        }, QUERY_CACHE_LIMIT);
    }

    _pruneExpiredQueryCache() {
        const now = Date.now();
        for (const [key, entry] of this.queryCache.entries()) {
            if (!entry || entry.expiresAt <= now) {
                this.queryCache.delete(key);
            }
        }
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
        const cached = touchCacheEntry(this.examBundleCache, examId);
        if (cached) {
            return cached;
        }

        const examPath = path.resolve(this.examsDir, `${examId}.js`);
        if (!fs.existsSync(examPath)) {
            const error = new Error(`阅读题数据缺失：${examId}`);
            error.code = 'exam_data_missing';
            throw error;
        }

        const examDataset = this._parseExamFile(examPath, examId);
        const explanationPath = path.resolve(this.explanationsDir, `${examId}.js`);
        const explanationDataset = fs.existsSync(explanationPath)
            ? this._parseExplanationFile(explanationPath, examId)
            : null;

        const chunks = this._buildChunks(examId, examDataset, explanationDataset);
        const bundle = {
            examId,
            examDataset,
            explanationDataset,
            chunks
        };

        setBoundedCacheEntry(this.examBundleCache, examId, bundle, EXAM_BUNDLE_CACHE_LIMIT);
        return bundle;
    }

    _parseExamFile(filePath, examId) {
        const source = fs.readFileSync(filePath, 'utf8');
        const parsed = parseReadingExamDataSource(source);
        if (parsed.key && parsed.key !== examId) {
            const error = new Error(`阅读题数据 key 不匹配：${path.basename(filePath)}`);
            error.code = 'exam_data_key_mismatch';
            throw error;
        }
        if (!isObject(parsed.payload)) {
            const error = new Error(`读取阅读题数据失败：${path.basename(filePath)}`);
            error.code = 'exam_data_parse_failed';
            throw error;
        }
        return parsed.payload;
    }

    _parseExplanationFile(filePath, examId) {
        const source = fs.readFileSync(filePath, 'utf8');
        const parsed = parseReadingExplanationDataSource(source);
        if (parsed.key && parsed.key !== examId) {
            const error = new Error(`阅读解析数据 key 不匹配：${path.basename(filePath)}`);
            error.code = 'explanation_data_key_mismatch';
            throw error;
        }
        if (!isObject(parsed.payload)) {
            const error = new Error(`读取阅读解析数据失败：${path.basename(filePath)}`);
            error.code = 'explanation_data_parse_failed';
            throw error;
        }
        return parsed.payload;
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

    _normalizeModelResponse(rawContent, contextRoute) {
        return normalizeReadingCoachModelResponse(rawContent, logger, {
            requireReviewSchema: contextRoute === CONTEXT_ROUTES.REVIEW
        });
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
