// @ts-nocheck
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { ProviderOrchestratorService } = require('../shared/provider-orchestrator.ts');
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

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
    return String(value == null ? '' : value)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
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
    const text = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
        .trim();
    if (!text) {
        return [];
    }
    return uniqueList(
        text
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2 && !SEARCH_STOPWORDS.has(token))
    );
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

function clampConfidence(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'medium';
}

function budgetFinalChunks(contextRoute, sortedChunks, budget) {
    const normalizedBudget = Math.max(1, Number(budget) || 8);
    if (contextRoute === CONTEXT_ROUTES.SIMILAR) {
        return sortedChunks.slice(0, normalizedBudget);
    }

    const passageChunks = sortedChunks.filter((chunk) => chunk.chunkType === CHUNK_TYPE.PASSAGE);
    const nonPassageChunks = sortedChunks.filter((chunk) => chunk.chunkType !== CHUNK_TYPE.PASSAGE);
    if (!passageChunks.length) {
        return sortedChunks.slice(0, normalizedBudget);
    }

    const minPassageBudget = Math.max(1, Math.floor(normalizedBudget / 3));
    const actualPassageBudget = Math.min(minPassageBudget, passageChunks.length);
    const actualQuestionBudget = Math.max(0, normalizedBudget - actualPassageBudget);

    const merged = [];
    const seen = new Set();
    [...passageChunks.slice(0, actualPassageBudget), ...nonPassageChunks.slice(0, actualQuestionBudget)].forEach((chunk) => {
        const key = String(chunk && chunk.id ? chunk.id : '');
        if (!key || seen.has(key)) {
            return;
        }
        seen.add(key);
        merged.push(chunk);
    });
    return merged.slice(0, normalizedBudget);
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
                response_format: this._buildCoachResponseFormat()
            });

            usedConfig = streamResult?.usedConfig || null;
            providerPath = Array.isArray(streamResult?.providerPath) ? streamResult.providerPath : [];

            const parsed = this._normalizeModelResponse(rawContent);
            const citations = this._buildCitations(retrieval.finalChunks);
            const answerText = this._composeAnswer(parsed.answerSections, parsed.answer);

            const result = {
                coachVersion: 'v2',
                generatedAt: nowIso(),
                route: routeDecision.route,
                routeReason: routeDecision.reason,
                contextRoute,
                intent,
                answer: answerText,
                answerSections: parsed.answerSections,
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
        const query = payload.query;
        if (!query) {
            return { route: ROUTES.PAGE_GROUNDED, reason: 'empty_query' };
        }

        const normalized = query.trim();
        if (SOCIAL_PATTERNS.some((pattern) => pattern.test(normalized))) {
            return { route: ROUTES.UNRELATED_CHAT, reason: 'social_pattern' };
        }
        if (WEATHER_TIME_PATTERNS.some((pattern) => pattern.test(normalized))) {
            return { route: ROUTES.UNRELATED_CHAT, reason: 'real_world_query' };
        }

        const hasIeltsSignals = IELTS_GENERAL_PATTERNS.every((pattern, index) => {
            if (index === 0) {
                return true;
            }
            return pattern.test(normalized);
        }) || (IELTS_GENERAL_PATTERNS[0].test(normalized) && IELTS_GENERAL_PATTERNS[2].test(normalized));

        const hasPageGroundedSignals = PAGE_GROUNDED_HINTS.some((pattern) => pattern.test(normalized))
            || payload.selectedText
            || payload.focusQuestionNumbers.length > 0
            || payload.attemptContext.submitted;

        if (hasIeltsSignals && !hasPageGroundedSignals) {
            return { route: ROUTES.IELTS_GENERAL, reason: 'ielts_general_pattern' };
        }

        return { route: ROUTES.PAGE_GROUNDED, reason: hasPageGroundedSignals ? 'page_signal' : 'default_page_grounded' };
    }

    _classifyIntent(payload, route) {
        const query = payload.query;

        if (payload.action && ['translate', 'explain_selection', 'find_paraphrases', 'find_antonyms', 'extract_keywords', 'locate_evidence'].includes(payload.action) && payload.selectedText) {
            return {
                kind: INTENTS.SELECTION_TOOL_REQUEST,
                confidence: 0.96,
                questionNumbers: payload.focusQuestionNumbers.slice(),
                paragraphLabels: []
            };
        }

        if (payload.action && ['analyze_mistake', 'review_set', 'recommend_drills'].includes(payload.action)) {
            return {
                kind: INTENTS.REVIEW_COACH_REQUEST,
                confidence: 0.92,
                questionNumbers: payload.focusQuestionNumbers.slice(),
                paragraphLabels: []
            };
        }

        if (payload.promptKind === 'followup') {
            return {
                kind: INTENTS.FOLLOWUP_REQUEST,
                confidence: 0.8,
                questionNumbers: payload.focusQuestionNumbers.slice(),
                paragraphLabels: []
            };
        }

        if (route === ROUTES.UNRELATED_CHAT) {
            const social = SOCIAL_PATTERNS.some((pattern) => pattern.test(query || ''));
            return {
                kind: social ? INTENTS.SOCIAL_OR_SMALLTALK : INTENTS.GENERAL_CHAT,
                confidence: 0.88,
                questionNumbers: [],
                paragraphLabels: []
            };
        }

        const extracted = this._extractQuestionRefs(query);
        const questionNumbers = uniqueList([...payload.focusQuestionNumbers, ...extracted.questionNumbers]);
        const paragraphLabels = extracted.paragraphLabels;

        if (WHOLE_SET_PATTERNS.some((pattern) => pattern.test(query))) {
            return { kind: INTENTS.WHOLE_SET_OR_REVIEW, confidence: 0.88, questionNumbers, paragraphLabels };
        }

        if (payload.attemptContext.submitted && (payload.attemptContext.wrongQuestions.length > 0 || /错题|复盘|review|mistake/i.test(query))) {
            return { kind: INTENTS.WHOLE_SET_OR_REVIEW, confidence: 0.82, questionNumbers, paragraphLabels };
        }

        if (questionNumbers.length || paragraphLabels.length) {
            return { kind: INTENTS.GROUNDED_QUESTION, confidence: 0.9, questionNumbers, paragraphLabels };
        }

        if (!query || query.length < 4) {
            return { kind: INTENTS.CLARIFY, confidence: 0.5, questionNumbers: [], paragraphLabels: [] };
        }

        if (route === ROUTES.IELTS_GENERAL) {
            return { kind: INTENTS.GENERAL_CHAT, confidence: 0.72, questionNumbers: [], paragraphLabels: [] };
        }

        return { kind: INTENTS.GROUNDED_QUESTION, confidence: 0.7, questionNumbers, paragraphLabels };
    }

    _resolveContextRoute(payload, intent) {
        if (payload.action === 'recommend_drills' || /相似|类似|同类题|similar\s+(practice|question|passage)/i.test(payload.query)) {
            return CONTEXT_ROUTES.SIMILAR;
        }
        switch (intent.kind) {
        case INTENTS.SELECTION_TOOL_REQUEST:
            return CONTEXT_ROUTES.SELECTION;
        case INTENTS.REVIEW_COACH_REQUEST:
        case INTENTS.WHOLE_SET_OR_REVIEW:
            return CONTEXT_ROUTES.REVIEW;
        case INTENTS.FOLLOWUP_REQUEST:
            return CONTEXT_ROUTES.FOLLOWUP;
        case INTENTS.CLARIFY:
            return CONTEXT_ROUTES.CLARIFY;
        default:
            return CONTEXT_ROUTES.TUTOR;
        }
    }

    _extractQuestionRefs(query) {
        const normalized = String(query || '');
        const questionNumbers = [];
        const paragraphLabels = [];
        if (!normalized) {
            return { questionNumbers, paragraphLabels };
        }

        const matcher = new RegExp(QUESTION_REF_PATTERN_GLOBAL.source, QUESTION_REF_PATTERN_GLOBAL.flags);
        let match = matcher.exec(normalized);
        while (match) {
            const qNum = match[1] || match[2] || match[3];
            const pLabel = match[4] || match[5];
            if (qNum) {
                questionNumbers.push(String(qNum));
            }
            if (pLabel) {
                paragraphLabels.push(String(pLabel).toUpperCase());
            }
            match = matcher.exec(normalized);
        }

        return {
            questionNumbers: uniqueList(questionNumbers),
            paragraphLabels: uniqueList(paragraphLabels)
        };
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
        const allChunks = bundle.chunks;
        const queryTokens = tokenize(`${payload.query || ''} ${payload.selectedText || ''}`);
        const focusQuestionNumbers = uniqueList([
            ...(intent.questionNumbers || []),
            ...(contextRoute === CONTEXT_ROUTES.REVIEW ? payload.attemptContext.wrongQuestions : [])
        ]);
        const focusParagraphLabels = uniqueList(intent.paragraphLabels || []);

        const chunkScores = allChunks.map((chunk) => {
            const score = this._scoreChunk(chunk, {
                queryTokens,
                focusQuestionNumbers,
                focusParagraphLabels,
                contextRoute,
                intent,
                selectedText: payload.selectedText
            });
            return { chunk, score };
        });

        chunkScores.sort((a, b) => b.score - a.score);
        const sortedChunks = chunkScores.map((item) => item.chunk);

        const deterministic = [];
        const seen = new Set();
        const pushChunk = (chunk) => {
            if (!chunk || !chunk.id || seen.has(chunk.id)) {
                return;
            }
            seen.add(chunk.id);
            deterministic.push(chunk);
        };

        if (focusQuestionNumbers.length > 0) {
            sortedChunks.forEach((chunk) => {
                if (chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum))) {
                    pushChunk(chunk);
                }
            });
        }
        if (focusParagraphLabels.length > 0) {
            sortedChunks.forEach((chunk) => {
                if (chunk.paragraphLabels.some((label) => focusParagraphLabels.includes(label))) {
                    pushChunk(chunk);
                }
            });
        }

        sortedChunks.slice(0, 24).forEach(pushChunk);

        const budget = this._resolveContextBudget(contextRoute);
        const finalChunks = budgetFinalChunks(contextRoute, deterministic, budget);

        const usedQuestionNumbers = uniqueList(
            finalChunks.flatMap((chunk) => Array.isArray(chunk.questionNumbers) ? chunk.questionNumbers : [])
        );
        const usedParagraphLabels = uniqueList(
            finalChunks.flatMap((chunk) => Array.isArray(chunk.paragraphLabels) ? chunk.paragraphLabels : [])
        );

        const missingContext = [];
        if (focusQuestionNumbers.length > 0) {
            const missingQuestions = focusQuestionNumbers.filter((qNum) => !usedQuestionNumbers.includes(qNum));
            if (missingQuestions.length) {
                missingContext.push(`缺少题号上下文：Q${missingQuestions.join(', Q')}`);
            }
        }
        if (focusParagraphLabels.length > 0) {
            const missingParagraphs = focusParagraphLabels.filter((label) => !usedParagraphLabels.includes(label));
            if (missingParagraphs.length) {
                missingContext.push(`缺少段落上下文：Paragraph ${missingParagraphs.join(', ')}`);
            }
        }
        if (!finalChunks.length) {
            missingContext.push('当前请求未检索到可用证据片段');
        }

        return {
            sortedChunks,
            finalChunks,
            missingContext,
            focusQuestionNumbers,
            focusParagraphLabels,
            usedQuestionNumbers,
            usedParagraphLabels,
            reviewTargets: this._buildReviewTargets(bundle, payload, focusQuestionNumbers)
        };
    }

    _buildReviewTargets(bundle, payload, focusQuestionNumbers = []) {
        const bundleChunks = Array.isArray(bundle?.chunks) ? bundle.chunks : [];
        const selectedAnswers = isObject(payload?.attemptContext?.selectedAnswers)
            ? payload.attemptContext.selectedAnswers
            : {};
        const fallbackQuestions = Array.isArray(payload?.attemptContext?.wrongQuestions)
            ? payload.attemptContext.wrongQuestions
            : [];
        const targetQuestionNumbers = uniqueList([
            ...(focusQuestionNumbers || []),
            ...fallbackQuestions
        ]).slice(0, 8);

        if (!targetQuestionNumbers.length) {
            return [];
        }

        return targetQuestionNumbers.map((questionNumber) => {
            const questionChunk = bundleChunks.find((chunk) => chunk.chunkType === CHUNK_TYPE.QUESTION && chunk.questionNumbers.includes(questionNumber));
            const answerKeyChunk = bundleChunks.find((chunk) => chunk.chunkType === CHUNK_TYPE.ANSWER_KEY && chunk.questionNumbers.includes(questionNumber));
            const explanationChunk = bundleChunks.find((chunk) => chunk.chunkType === CHUNK_TYPE.EXPLANATION && chunk.questionNumbers.includes(questionNumber));
            const questionStem = String(questionChunk?.content || '').trim().slice(0, 520);
            const selectedAnswer = formatAnswerValue(selectedAnswers[questionNumber]) || '未记录';
            const correctAnswerMatch = String(answerKeyChunk?.content || '').match(/正确答案[:：]\s*(.+)$/);
            const correctAnswer = String(correctAnswerMatch?.[1] || '').trim() || '未知';
            const officialExplanation = String(explanationChunk?.content || '').trim().slice(0, 900);
            return {
                questionNumber,
                questionStem,
                selectedAnswer,
                correctAnswer,
                officialExplanation
            };
        });
    }

    _scoreChunk(chunk, factors) {
        const queryTokens = factors.queryTokens || [];
        const focusQuestionNumbers = factors.focusQuestionNumbers || [];
        const focusParagraphLabels = factors.focusParagraphLabels || [];
        const contextRoute = factors.contextRoute;

        let score = 0;
        const contentTokens = tokenize(chunk.content || '');
        const tokenSet = new Set(contentTokens);

        queryTokens.forEach((token) => {
            if (tokenSet.has(token)) {
                score += 1.2;
            }
        });

        if (factors.selectedText && chunk.content.includes(factors.selectedText.slice(0, 30))) {
            score += 2;
        }

        if (focusQuestionNumbers.length > 0 && chunk.questionNumbers.some((qNum) => focusQuestionNumbers.includes(qNum))) {
            score += 8;
        }

        if (focusParagraphLabels.length > 0 && chunk.paragraphLabels.some((label) => focusParagraphLabels.includes(label))) {
            score += 6;
        }

        if (chunk.chunkType === CHUNK_TYPE.QUESTION) {
            score += 2.2;
        } else if (chunk.chunkType === CHUNK_TYPE.PASSAGE) {
            score += 1.6;
        } else if (chunk.chunkType === CHUNK_TYPE.EXPLANATION) {
            score += contextRoute === CONTEXT_ROUTES.REVIEW ? 2.4 : 0.8;
        } else if (chunk.chunkType === CHUNK_TYPE.ANSWER_KEY) {
            score += contextRoute === CONTEXT_ROUTES.REVIEW ? 1.8 : -0.8;
        }

        if (contextRoute === CONTEXT_ROUTES.SELECTION && chunk.chunkType === CHUNK_TYPE.PASSAGE) {
            score += 1.4;
        }

        return score;
    }

    _resolveContextBudget(contextRoute) {
        switch (contextRoute) {
        case CONTEXT_ROUTES.SELECTION:
            return 8;
        case CONTEXT_ROUTES.REVIEW:
            return 16;
        case CONTEXT_ROUTES.FOLLOWUP:
            return 10;
        case CONTEXT_ROUTES.CLARIFY:
            return 8;
        case CONTEXT_ROUTES.SIMILAR:
            return 10;
        default:
            return 12;
        }
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
        const chunks = [];
        const questionOrder = Array.isArray(examDataset.questionOrder) ? examDataset.questionOrder : [];
        const questionDisplayMap = isObject(examDataset.questionDisplayMap) ? examDataset.questionDisplayMap : {};

        const passageHtml = Array.isArray(examDataset.passage?.blocks)
            ? examDataset.passage.blocks.map((block) => String(block?.bodyHtml || block?.html || '')).join('\n')
            : '';

        const paragraphChunks = this._extractPassageParagraphChunks(examId, passageHtml);
        paragraphChunks.forEach((chunk) => chunks.push(chunk));

        const questionGroups = Array.isArray(examDataset.questionGroups) ? examDataset.questionGroups : [];
        questionOrder.forEach((questionId) => {
            const chunk = this._buildQuestionChunk({
                examId,
                questionId,
                questionGroups,
                questionDisplayMap,
                explanationDataset
            });
            if (chunk) {
                chunks.push(chunk);
            }
        });

        const answerKey = isObject(examDataset.answerKey) ? examDataset.answerKey : {};
        Object.entries(answerKey).forEach(([questionId, answer]) => {
            const normalizedQuestion = String(questionId || '').trim().replace(/^q/i, '');
            if (!normalizedQuestion) {
                return;
            }
            chunks.push({
                id: `${examId}::answer_key::q${normalizedQuestion}`,
                chunkType: CHUNK_TYPE.ANSWER_KEY,
                questionNumbers: [normalizedQuestion],
                paragraphLabels: [],
                content: `Q${normalizedQuestion} 正确答案：${String(answer || '').trim()}`
            });
        });

        if (explanationDataset && Array.isArray(explanationDataset.questionExplanations)) {
            explanationDataset.questionExplanations.forEach((section, sectionIndex) => {
                const sectionItems = Array.isArray(section?.items) ? section.items : [];
                sectionItems.forEach((item, itemIndex) => {
                    const questionId = String(item?.questionId || '').trim();
                    const questionNumber = String(item?.questionNumber || '').trim() || questionId.replace(/^q/i, '');
                    const text = cleanText(item?.text || section?.text || '');
                    if (!text) {
                        return;
                    }
                    chunks.push({
                        id: `${examId}::answer_explanation::${sectionIndex + 1}_${itemIndex + 1}`,
                        chunkType: CHUNK_TYPE.EXPLANATION,
                        questionNumbers: questionNumber ? [questionNumber.replace(/^q/i, '')] : [],
                        paragraphLabels: this._extractParagraphLabels(text),
                        content: text.slice(0, 1600)
                    });
                });
            });
        }

        return chunks;
    }

    _extractPassageParagraphChunks(examId, passageHtml) {
        const chunks = [];
        if (!passageHtml) {
            return chunks;
        }
        const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        let match = paragraphPattern.exec(passageHtml);
        let index = 0;
        while (match) {
            index += 1;
            const rawParagraph = String(match[0] || '');
            const text = cleanText(rawParagraph);
            if (!text) {
                match = paragraphPattern.exec(passageHtml);
                continue;
            }
            const labelMatch = rawParagraph.match(/<strong>\s*([A-H])\s*<\/strong>/i);
            const label = labelMatch && labelMatch[1] ? String(labelMatch[1]).toUpperCase() : '';
            chunks.push({
                id: `${examId}::passage_paragraph::${label || `p${index}`}`,
                chunkType: CHUNK_TYPE.PASSAGE,
                questionNumbers: [],
                paragraphLabels: label ? [label] : [],
                content: text
            });
            match = paragraphPattern.exec(passageHtml);
        }

        if (chunks.length === 0) {
            const fallbackPassage = cleanText(passageHtml).slice(0, 5600);
            if (fallbackPassage) {
                chunks.push({
                    id: `${examId}::passage_paragraph::fallback`,
                    chunkType: CHUNK_TYPE.PASSAGE,
                    questionNumbers: [],
                    paragraphLabels: [],
                    content: fallbackPassage
                });
            }
        }
        return chunks;
    }

    _buildQuestionChunk({ examId, questionId, questionGroups, questionDisplayMap, explanationDataset }) {
        const normalizedQuestionId = String(questionId || '').trim();
        if (!normalizedQuestionId) {
            return null;
        }
        const normalizedQuestion = normalizedQuestionId.replace(/^q/i, '');
        let content = '';
        let questionKind = '';

        for (let index = 0; index < questionGroups.length; index += 1) {
            const group = questionGroups[index];
            const questionIds = Array.isArray(group?.questionIds) ? group.questionIds : [];
            if (!questionIds.includes(normalizedQuestionId)) {
                continue;
            }
            questionKind = String(group?.kind || '').trim();
            const html = String(group?.bodyHtml || '');
            content = this._extractQuestionTextFromGroupHtml({
                html,
                questionId: normalizedQuestionId,
                questionDisplayLabel: questionDisplayMap[normalizedQuestionId]
            });
            if (content) {
                break;
            }
        }

        if (!content && explanationDataset && Array.isArray(explanationDataset.questionExplanations)) {
            const explanationItem = explanationDataset.questionExplanations
                .flatMap((section) => Array.isArray(section?.items) ? section.items : [])
                .find((item) => String(item?.questionId || '').trim() === normalizedQuestionId);
            if (explanationItem) {
                const text = cleanText(explanationItem.text || '');
                content = text.split('解析：')[0].slice(0, 320);
            }
        }

        if (!content) {
            content = `Q${normalizedQuestion}（题干未解析）`;
        }

        return {
            id: `${examId}::question_item::q${normalizedQuestion}`,
            chunkType: CHUNK_TYPE.QUESTION,
            questionNumbers: [normalizedQuestion],
            paragraphLabels: this._extractParagraphLabels(content),
            content: `Q${normalizedQuestion}${questionKind ? ` (${questionKind})` : ''}: ${content}`
        };
    }

    _extractGroupInstructionText(html) {
        const normalizedHtml = String(html || '');
        if (!normalizedHtml) {
            return '';
        }
        const lines = [];
        const headingMatch = normalizedHtml.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
        if (headingMatch && headingMatch[1]) {
            const heading = cleanText(headingMatch[1]);
            if (heading) {
                lines.push(heading);
            }
        }
        const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        let match = paragraphPattern.exec(normalizedHtml);
        while (match && lines.length < 4) {
            const text = cleanText(match[1] || '');
            if (text) {
                lines.push(text);
            }
            match = paragraphPattern.exec(normalizedHtml);
        }
        return uniqueList(lines).join(' | ');
    }

    _sliceHtmlContainerAroundIndex(html, index, tagName, maxLength = 2200) {
        const source = String(html || '');
        const normalizedTag = String(tagName || '').trim().toLowerCase();
        if (!source || !normalizedTag || !Number.isFinite(index) || index < 0) {
            return '';
        }
        const lower = source.toLowerCase();
        const openTag = `<${normalizedTag}`;
        const closeTag = `</${normalizedTag}>`;
        const start = lower.lastIndexOf(openTag, index);
        if (start < 0) {
            return '';
        }
        const closeStart = lower.indexOf(closeTag, index);
        if (closeStart < 0) {
            return '';
        }
        const end = closeStart + closeTag.length;
        if (end <= start || end - start > maxLength) {
            return '';
        }
        return source.slice(start, end);
    }

    _extractQuestionOptions(html, questionId) {
        const normalizedHtml = String(html || '');
        const normalizedQuestionId = String(questionId || '').trim();
        if (!normalizedHtml || !normalizedQuestionId) {
            return '';
        }
        const escapedQuestionId = normalizedQuestionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const options = [];
        const labelPattern = new RegExp(`<label[^>]*>[\\s\\S]{0,280}?name=["']${escapedQuestionId}["'][\\s\\S]{0,280}?<\\/label>`, 'ig');
        let labelMatch = labelPattern.exec(normalizedHtml);
        while (labelMatch) {
            const text = cleanText(labelMatch[0]);
            if (text) {
                options.push(text.replace(/\s+/g, ' ').trim());
            }
            labelMatch = labelPattern.exec(normalizedHtml);
        }
        if (options.length) {
            return `可选项：${uniqueList(options).slice(0, 8).join(' / ')}`;
        }

        const rowPattern = new RegExp(`<tr[^>]*>[\\s\\S]{0,1600}?name=["']${escapedQuestionId}["'][\\s\\S]{0,1600}?<\\/tr>`, 'i');
        const rowMatch = normalizedHtml.match(rowPattern);
        if (!rowMatch) {
            return '';
        }
        const letters = Array.from(normalizedHtml.matchAll(/<th[^>]*>\s*([A-Z])\s*<\/th>/gi))
            .map((item) => String(item[1] || '').trim().toUpperCase())
            .filter(Boolean);
        if (letters.length >= 2) {
            return `可选项：${uniqueList(letters).join(' / ')}`;
        }
        return '';
    }

    _extractQuestionTextFromGroupHtml({ html, questionId, questionDisplayLabel } = {}) {
        const normalizedHtml = String(html || '');
        const normalizedQuestionId = String(questionId || '').trim();
        if (!normalizedHtml || !normalizedQuestionId) {
            return '';
        }

        const escapedQuestionId = normalizedQuestionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const snippets = [];
        const pushSnippet = (snippet) => {
            const text = cleanText(snippet || '');
            if (!text) {
                return;
            }
            snippets.push(text.replace(/\s+/g, ' ').trim());
        };

        const anchorPattern = new RegExp(`id=["']${escapedQuestionId}-anchor["'][\\s\\S]{0,1200}?<p[^>]*>([\\s\\S]*?)<\\/p>`, 'i');
        const anchorMatch = normalizedHtml.match(anchorPattern);
        if (anchorMatch && anchorMatch[1]) {
            pushSnippet(anchorMatch[1]);
        }

        const markerPatterns = [
            new RegExp(`name=["']${escapedQuestionId}["']`, 'ig'),
            new RegExp(`data-question=["']${escapedQuestionId}["']`, 'ig'),
            new RegExp(`id=["']${escapedQuestionId}-anchor["']`, 'ig')
        ];
        const containerTags = ['tr', 'li', 'p', 'div'];
        markerPatterns.forEach((marker) => {
            let markerMatch = marker.exec(normalizedHtml);
            while (markerMatch) {
                const markerIndex = Number(markerMatch.index);
                containerTags.forEach((tagName) => {
                    const segment = this._sliceHtmlContainerAroundIndex(normalizedHtml, markerIndex, tagName);
                    if (segment) {
                        pushSnippet(segment);
                    }
                });
                markerMatch = marker.exec(normalizedHtml);
            }
        });

        const displayLabel = String(questionDisplayLabel || '').trim().replace(/[^0-9]/g, '');
        if (displayLabel) {
            const displayPattern = new RegExp(`<strong>\\s*${displayLabel}\\s*<\\/strong>[\\s\\S]{0,420}?<\\/p>`, 'ig');
            let displayMatch = displayPattern.exec(normalizedHtml);
            while (displayMatch) {
                pushSnippet(displayMatch[0]);
                displayMatch = displayPattern.exec(normalizedHtml);
            }
        }

        const normalizedQuestionNumber = normalizedQuestionId.replace(/^q/i, '');
        const dedupedSnippets = uniqueList(snippets).filter((text) => text.length >= 6);
        let bestSnippet = '';
        let bestScore = -Infinity;
        dedupedSnippets.forEach((text) => {
            let score = Math.min(8, text.length / 48);
            if (displayLabel && new RegExp(`\\b${displayLabel}\\b`).test(text)) {
                score += 3;
            }
            if (normalizedQuestionNumber && new RegExp(`\\b${normalizedQuestionNumber}\\b`).test(text)) {
                score += 2;
            }
            if (/which|what|how|why|是否|哪|完成|匹配|包含|同义|正确|错误/i.test(text)) {
                score += 2;
            }
            if (/q\d+/i.test(text)) {
                score -= 1.5;
            }
            if (score > bestScore) {
                bestScore = score;
                bestSnippet = text;
            }
        });

        const groupInstruction = this._extractGroupInstructionText(normalizedHtml);
        const optionsHint = this._extractQuestionOptions(normalizedHtml, normalizedQuestionId);
        const combined = uniqueList([groupInstruction, bestSnippet, optionsHint].filter(Boolean)).join(' | ');
        if (combined) {
            return combined.slice(0, 1000);
        }

        return '';
    }

    _extractParagraphLabels(text) {
        const labels = [];
        const pattern = /paragraph\s*([A-H])|段落\s*([A-H])/ig;
        let match = pattern.exec(String(text || ''));
        while (match) {
            const label = String(match[1] || match[2] || '').toUpperCase();
            if (label) {
                labels.push(label);
            }
            match = pattern.exec(String(text || ''));
        }
        return uniqueList(labels);
    }

    _buildPrompt({ payload, routeDecision, intent, contextRoute, retrieval }) {
        const locale = payload.locale === 'en' ? 'en' : 'zh';

        const responseLanguageInstruction = locale === 'en'
            ? 'Respond in English.'
            : '请使用简体中文回答。';

        const routeInstruction = routeDecision.route === ROUTES.PAGE_GROUNDED
            ? [
                '你是 IELTS 阅读教练，必须优先基于给定上下文回答。',
                '当用户仍在做题（submitted=false）时，不要直接泄露最终答案选项；给定位路径和排除逻辑。',
                '当用户已提交（submitted=true）或明确请求复盘时，可以给出明确结论并解释错因。',
                '如果上下文不足，要在 missingContext 列出缺口。',
                contextRoute === CONTEXT_ROUTES.REVIEW
                    ? '复盘时必须逐题对照题干、用户答案、标准答案、官方解析或证据，再总结用户可能的易错点；禁止脱离材料泛泛而谈。'
                    : ''
            ].join('\n')
            : [
                '你是 IELTS 学习教练。',
                '对于非页面问题，给出简洁、可执行建议。',
                '避免泛泛鸡汤，尽量结构化。'
            ].join('\n');

        const styleInstruction = [
            '输出必须是 JSON 对象，禁止 markdown 代码块。',
            'JSON 字段必须为：answer, answerSections, followUps, confidence, missingContext。',
            'answerSections 的 type 只允许 direct_answer/reasoning/evidence/next_step。',
            'followUps 返回 2-3 条，且每条不超过 24 个汉字（英文不超过 80 chars）。',
            'confidence 只能是 high/medium/low。'
        ].join('\n');

        const contextChunks = retrieval.finalChunks.map((chunk, index) => {
            const questionNumbers = chunk.questionNumbers.length ? `Q${chunk.questionNumbers.join(',Q')}` : 'n/a';
            const paragraphLabels = chunk.paragraphLabels.length ? chunk.paragraphLabels.join(',') : 'n/a';
            return [
                `[Context ${index + 1}]`,
                `chunkType: ${chunk.chunkType}`,
                `questionNumbers: ${questionNumbers}`,
                `paragraphLabels: ${paragraphLabels}`,
                chunk.content
            ].join('\n');
        }).join('\n\n');

        const selectedAnswersText = Object.keys(payload.attemptContext.selectedAnswers || {}).length
            ? Object.entries(payload.attemptContext.selectedAnswers)
                .map(([questionNumber, answer]) => `Q${questionNumber}=${answer}`)
                .join(' | ')
            : 'none';

        const reviewTargetsText = Array.isArray(retrieval.reviewTargets) && retrieval.reviewTargets.length
            ? retrieval.reviewTargets.map((item, index) => [
                `[Review ${index + 1}]`,
                `questionNumber: Q${item.questionNumber}`,
                `questionStem: ${item.questionStem || 'none'}`,
                `userAnswer: ${item.selectedAnswer || '未记录'}`,
                `correctAnswer: ${item.correctAnswer || '未知'}`,
                `officialExplanation: ${item.officialExplanation || 'none'}`
            ].join('\n')).join('\n\n')
            : 'none';

        const userPayload = [
            `examId: ${payload.examId}`,
            `route: ${routeDecision.route}`,
            `contextRoute: ${contextRoute}`,
            `intent: ${intent.kind}`,
            `submitted: ${payload.attemptContext.submitted ? 'yes' : 'no'}`,
            `score: ${payload.attemptContext.score == null ? 'unknown' : payload.attemptContext.score}`,
            `wrongQuestions: ${payload.attemptContext.wrongQuestions.length ? payload.attemptContext.wrongQuestions.join(',') : 'none'}`,
            `selectedAnswers: ${selectedAnswersText}`,
            `focusQuestionNumbers: ${retrieval.focusQuestionNumbers.length ? retrieval.focusQuestionNumbers.join(',') : 'none'}`,
            `focusParagraphLabels: ${retrieval.focusParagraphLabels.length ? retrieval.focusParagraphLabels.join(',') : 'none'}`,
            `selectedText: ${payload.selectedText || 'none'}`,
            `history: ${payload.history.length ? payload.history.map((item) => `${item.role}: ${item.content}`).join(' | ') : 'none'}`,
            `userQuery: ${payload.query || '请给我当前题目的学习指导'}`,
            `missingContextHints: ${retrieval.missingContext.length ? retrieval.missingContext.join('；') : 'none'}`,
            'reviewTargets:',
            reviewTargetsText,
            'contextChunks:',
            contextChunks || 'none'
        ].join('\n\n');

        return [
            {
                role: 'system',
                content: [routeInstruction, responseLanguageInstruction, styleInstruction].join('\n\n')
            },
            {
                role: 'user',
                content: userPayload
            }
        ];
    }

    _buildCoachResponseFormat() {
        return {
            type: 'json_schema',
            json_schema: {
                name: 'reading_coach_v2_response',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        answer: { type: 'string' },
                        answerSections: {
                            type: 'array',
                            minItems: 1,
                            maxItems: 4,
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    type: {
                                        type: 'string',
                                        enum: ['direct_answer', 'reasoning', 'evidence', 'next_step']
                                    },
                                    text: { type: 'string' }
                                },
                                required: ['type', 'text']
                            }
                        },
                        followUps: {
                            type: 'array',
                            minItems: 0,
                            maxItems: 3,
                            items: { type: 'string' }
                        },
                        confidence: {
                            type: 'string',
                            enum: ['high', 'medium', 'low']
                        },
                        missingContext: {
                            type: 'array',
                            minItems: 0,
                            maxItems: 6,
                            items: { type: 'string' }
                        }
                    },
                    required: ['answer', 'answerSections', 'followUps', 'confidence', 'missingContext']
                }
            }
        };
    }

    _normalizeModelResponse(rawContent) {
        const parsed = this._parseJsonObject(rawContent);
        if (!isObject(parsed)) {
            const error = new Error('阅读教练响应解析失败');
            error.code = 'coach_parse_failed';
            throw error;
        }

        const sections = Array.isArray(parsed.answerSections)
            ? parsed.answerSections
                .map((item) => {
                    if (!isObject(item)) return null;
                    const type = String(item.type || '').trim();
                    if (!['direct_answer', 'reasoning', 'evidence', 'next_step'].includes(type)) {
                        return null;
                    }
                    const text = String(item.text || '').trim();
                    if (!text) {
                        return null;
                    }
                    return { type, text };
                })
                .filter(Boolean)
                .slice(0, 4)
            : [];

        const answer = String(parsed.answer || '').trim();
        const fallbackSections = sections.length
            ? sections
            : (answer
                ? [{ type: 'direct_answer', text: answer }]
                : []);

        if (!fallbackSections.length) {
            const error = new Error('阅读教练响应缺少有效 answerSections');
            error.code = 'coach_parse_failed';
            throw error;
        }

        const followUps = uniqueList(
            (Array.isArray(parsed.followUps) ? parsed.followUps : [])
                .map((item) => String(item || '').trim())
                .filter(Boolean)
        ).slice(0, 3);

        const defaultFollowUps = ['再给我一步提示', '这题证据在哪里', '我下一步该练什么'];

        return {
            answer,
            answerSections: fallbackSections,
            followUps: followUps.length ? followUps : defaultFollowUps,
            confidence: clampConfidence(parsed.confidence),
            missingContext: uniqueList(
                (Array.isArray(parsed.missingContext) ? parsed.missingContext : [])
                    .map((item) => String(item || '').trim())
                    .filter(Boolean)
            ).slice(0, 6)
        };
    }

    _parseJsonObject(rawContent) {
        if (typeof rawContent !== 'string' || !rawContent.trim()) {
            const error = new Error('阅读教练返回为空');
            error.code = 'empty_response';
            throw error;
        }

        let jsonText = rawContent.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```\s*/g, '').replace(/```\s*$/g, '').trim();
        }

        const direct = this._tryParseJson(jsonText);
        if (direct) {
            return direct;
        }

        const start = jsonText.indexOf('{');
        if (start < 0) {
            return null;
        }

        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < jsonText.length; index += 1) {
            const ch = jsonText[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
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
                    const candidate = jsonText.slice(start, index + 1);
                    const parsed = this._tryParseJson(candidate);
                    if (parsed) {
                        return parsed;
                    }
                }
            }
        }

        logger.warn('Reading coach response parse failed', null, {
            rawContentPreview: String(rawContent).slice(0, 400)
        });

        return null;
    }

    _tryParseJson(value) {
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }

    _composeAnswer(answerSections, fallbackAnswer) {
        if (Array.isArray(answerSections) && answerSections.length) {
            return answerSections.map((item) => item.text).join('\n\n').trim();
        }
        return String(fallbackAnswer || '').trim();
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
