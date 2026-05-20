#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

function ensureServerBundle() {
    execFileSync('npm', ['run', 'build:server'], {
        cwd: repoRoot,
        stdio: 'inherit'
    });
}

ensureServerBundle();

const ReadingCoachService = require(path.join(repoRoot, 'electron/services/reading-coach.service.js'));
const {
    classifyReadingRoute,
    classifyReadingIntent,
    resolveReadingContextRoute
} = require(path.join(repoRoot, 'server/dist/lib/reading/router.js'));
const {
    buildReadingCoachPrompt,
    buildCoachResponseFormat,
    normalizeReadingCoachModelResponse
} = require(path.join(repoRoot, 'server/dist/lib/reading/prompt.js'));
const {
    READING_ROUTES,
    READING_CONTEXT_ROUTES,
    READING_INTENTS,
    READING_CHUNK_TYPE,
    resolveReadingResponseKind,
    buildReadingRetrievalDiagnostics
} = require(path.join(repoRoot, 'server/dist/lib/reading/contracts.js'));

const ROUTES = READING_ROUTES;
const CONTEXT_ROUTES = READING_CONTEXT_ROUTES;
const INTENTS = READING_INTENTS;
const CHUNK_TYPE = READING_CHUNK_TYPE;
const ROUTER_FIXTURES = Object.freeze({
    socialPatterns: [/^(你好|您好|hi|hello|hey|thanks|thank\s*you|bye|再见|在吗|谢谢)[\s,.!?，。！？]*$/i],
    weatherTimePatterns: [/天气|下雨|气温|几点|日期|星期|what\s+time|what\s+day|weather/i],
    ieltsGeneralPatterns: [/雅思|ielts/i, /阅读|reading/i, /技巧|方法|策略|提高|how\s+to|tips?/i],
    pageGroundedHints: [/这篇|这道题|question\s*\d+|\bq\d+\b|段落\s*[a-h]|证据|定位|题干/i],
    wholeSetPatterns: [/整组|整篇|全文|这组题|全部题目|所有题|一起讲|整体思路|总览|复盘|错题|review\s+all|whole\s+set|all\s+questions|my\s+mistakes/i],
    questionRefPatternGlobal: /(?:第\s*(\d+)\s*题)|(?:question\s*(\d+))|(?:\bq(\d+)\b)|(?:paragraph\s*([a-h]))|(?:段落\s*([a-h]))/ig
});

async function testCoachQuerySuccessWithGroundedRetrieval() {
    const service = new ReadingCoachService({});
    let capturedMessages = null;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            capturedMessages = options.messages;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '先锁定题干关键词，再回原文找同义替换。',
                    answerSections: [
                        { type: 'direct_answer', text: '先锁定题干关键词，再回原文找同义替换。' },
                        { type: 'evidence', text: '优先找题干名词在段落中的改写表达。' }
                    ],
                    followUps: ['这题证据在哪段', '我下一步练什么'],
                    confidence: 'high',
                    missingContext: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const result = await service.query({
        examId: 'p1-high-01',
        query: '这道题怎么定位证据？',
        action: 'chat',
        surface: 'chat_widget',
        promptKind: 'freeform',
        focusQuestionNumbers: ['1'],
        attemptContext: { submitted: true }
    });

    assert.strictEqual(result.coachVersion, 'v2', '应返回 v2 版本');
    assert.strictEqual(result.route, 'page_grounded', '题内提问应命中 page_grounded');
    assert.strictEqual(result.intent.kind, 'grounded_question', '应识别为 grounded_question');
    assert.ok(Array.isArray(result.citations) && result.citations.length > 0, '应返回检索引用');
    assert.ok(Array.isArray(result.followUps) && result.followUps.length > 0, '应返回 followUps');
    assert.strictEqual(result.responseKind, resolveReadingResponseKind(result.route, result.intent), 'responseKind 必须由契约模块统一解析');
    assert.deepStrictEqual(result.contextDiagnostics, result.retrievalDiagnostics, '旧 contextDiagnostics 和新 retrievalDiagnostics 必须保持兼容一致');
    assert.ok(result.retrievalDiagnostics.finalChunkTypeCounts.passage_paragraph >= 1, '诊断必须按 chunkType 暴露检索构成');
    assert.deepStrictEqual(result.retrievalDiagnostics.focusQuestionNumbers, ['1'], '诊断必须保留聚焦题号');
    assert.strictEqual(result.timings.cache_hit, false, '首次响应不应标记缓存命中');
    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('JSON 字段必须为：answer, answerSections, followUps, confidence, missingContext'), '提示词应包含结构化约束');
}

async function testReadingContractsBuildStableDiagnostics() {
    const diagnostics = buildReadingRetrievalDiagnostics({
        route: ROUTES.PAGE_GROUNDED,
        contextRoute: CONTEXT_ROUTES.TUTOR,
        intent: { kind: INTENTS.GROUNDED_QUESTION },
        retrieval: {
            finalChunks: [
                { chunkType: CHUNK_TYPE.PASSAGE, questionNumbers: [], paragraphLabels: ['A'] },
                { chunkType: CHUNK_TYPE.QUESTION, questionNumbers: ['1'], paragraphLabels: [] },
                { chunkType: CHUNK_TYPE.PASSAGE, questionNumbers: [], paragraphLabels: ['B'] }
            ],
            sortedChunks: [
                { chunkType: CHUNK_TYPE.PASSAGE },
                { chunkType: CHUNK_TYPE.QUESTION },
                { chunkType: CHUNK_TYPE.ANSWER_KEY }
            ],
            focusQuestionNumbers: ['1', '1'],
            focusParagraphLabels: ['A'],
            usedQuestionNumbers: ['1'],
            usedParagraphLabels: ['A', 'B'],
            missingContext: ['缺少题号上下文：Q2'],
            reviewTargets: []
        }
    });

    assert.strictEqual(resolveReadingResponseKind(ROUTES.PAGE_GROUNDED, { kind: INTENTS.GROUNDED_QUESTION }), 'grounded', '页面题内问题必须映射为 grounded 响应');
    assert.strictEqual(resolveReadingResponseKind(ROUTES.UNRELATED_CHAT, { kind: INTENTS.SOCIAL_OR_SMALLTALK }), 'social', '社交问候必须映射为 social 响应');
    assert.strictEqual(resolveReadingResponseKind(ROUTES.PAGE_GROUNDED, { kind: INTENTS.WHOLE_SET_OR_REVIEW }), 'review', '整组复盘必须映射为 review 响应');
    assert.strictEqual(diagnostics.chunkCount, 3, '诊断必须记录最终 chunk 数');
    assert.strictEqual(diagnostics.deterministicChunkCount, 3, '诊断必须记录排序候选数');
    assert.deepStrictEqual(diagnostics.finalChunkTypeCounts, {
        passage_paragraph: 2,
        question_item: 1
    }, '诊断必须稳定统计最终 chunk 类型');
    assert.deepStrictEqual(diagnostics.focusQuestionNumbers, ['1'], '诊断必须去重聚焦题号');
    assert.deepStrictEqual(diagnostics.usedParagraphLabels, ['A', 'B'], '诊断必须保留已使用段落');
    assert.deepStrictEqual(diagnostics.missingContext, ['缺少题号上下文：Q2'], '诊断必须保留上下文缺口');
    assert.strictEqual(diagnostics.cacheHit, false, '默认诊断不应标记缓存命中');
}

async function testCoachCacheHitKeepsDiagnosticsContract() {
    const service = new ReadingCoachService({});
    let calls = 0;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            calls += 1;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '缓存测试回答。',
                    answerSections: [{ type: 'direct_answer', text: '缓存测试回答。' }],
                    followUps: ['继续问这题'],
                    confidence: 'medium',
                    missingContext: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const payload = {
        examId: 'p1-high-01',
        query: '这道题怎么定位证据？',
        action: 'chat',
        surface: 'chat_widget',
        promptKind: 'freeform',
        focusQuestionNumbers: ['1'],
        attemptContext: { submitted: true }
    };
    const first = await service.query(payload);
    const second = await service.query(payload);

    assert.strictEqual(calls, 1, '第二次相同查询必须命中缓存而不是再次请求模型');
    assert.strictEqual(first.retrievalDiagnostics.cacheHit, false, '首次响应诊断不应命中缓存');
    assert.strictEqual(second.cacheHit, true, '缓存响应必须设置顶层 cacheHit');
    assert.strictEqual(second.timings.cache_hit, true, '缓存响应 timings 必须设置 cache_hit');
    assert.strictEqual(second.contextDiagnostics.cacheHit, true, '缓存响应旧诊断字段必须设置 cacheHit');
    assert.strictEqual(second.retrievalDiagnostics.cacheHit, true, '缓存响应新诊断字段必须设置 cacheHit');
    assert.deepStrictEqual(second.retrievalDiagnostics.focusQuestionNumbers, first.retrievalDiagnostics.focusQuestionNumbers, '缓存响应不得丢失聚焦题号诊断');
    assert.deepStrictEqual(second.contextDiagnostics.finalChunkTypeCounts, first.contextDiagnostics.finalChunkTypeCounts, '缓存响应不得丢失 chunk 类型统计');
}

async function testCoachReviewPromptCarriesMistakeContext() {
    const service = new ReadingCoachService({});
    let capturedMessages = null;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            capturedMessages = options.messages;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '你把题干条件看窄了，导致选项判断偏了。',
                    answerSections: [
                        { type: 'direct_answer', text: '你把题干条件看窄了，导致选项判断偏了。' },
                        { type: 'reasoning', text: '先对照题干和你自己的答案，再回原文看限制条件。' }
                    ],
                    followUps: ['这题证据在哪段', '我下次怎么排除'],
                    confidence: 'high',
                    missingContext: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const result = await service.query({
        examId: 'p1-high-01',
        query: '请复盘我的错题',
        action: 'review_set',
        promptKind: 'preset',
        attemptContext: {
            submitted: true,
            wrongQuestions: ['1'],
            selectedAnswers: { 1: 'A' }
        }
    });

    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('selectedAnswers: Q1=A'), '复盘提示词应包含用户作答');
    assert.ok(promptJoined.includes('[Review 1]'), '复盘提示词应包含结构化错题块');
    assert.ok(promptJoined.includes('correctAnswer:'), '复盘提示词应包含标准答案');
    assert.deepStrictEqual(result.contextDiagnostics.focusQuestionNumbers, ['1'], '复盘检索应优先聚焦错题题号');
}

async function testCoachQueryInvalidPayloadThrows() {
    const service = new ReadingCoachService({});
    let thrown = null;
    try {
        await service.query({ query: 'test' });
    } catch (error) {
        thrown = error;
    }
    assert.ok(thrown, '缺少 examId 应抛错');
    assert.strictEqual(thrown.code, 'invalid_payload', '错误码应为 invalid_payload');
}

async function testCoachProviderFailureShouldThrow() {
    const service = new ReadingCoachService({});
    service.providerOrchestrator = {
        async streamCompletion() {
            const error = new Error('provider unavailable');
            error.code = 'provider_unavailable';
            throw error;
        }
    };

    let thrown = null;
    try {
        await service.query({
            examId: 'p1-high-01',
            query: '帮我解释这题',
            action: 'chat',
            attemptContext: { submitted: true }
        });
    } catch (error) {
        thrown = error;
    }

    assert.ok(thrown, 'provider 失败应抛错');
    assert.strictEqual(thrown.code, 'provider_unavailable', '应透传 provider 错误码');
}

async function testCoachRouteUnrelatedChat() {
    const service = new ReadingCoachService({});
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '你好，我可以帮你做阅读题定位和复盘。',
                    answerSections: [{ type: 'direct_answer', text: '你好，我可以帮你做阅读题定位和复盘。' }],
                    followUps: ['现在开始做哪题'],
                    confidence: 'high',
                    missingContext: []
                }));
            }
            return { usedConfig: null, providerPath: [] };
        }
    };

    const result = await service.query({
        examId: 'p1-high-01',
        query: '你好',
        action: 'chat',
        attemptContext: { submitted: true }
    });

    assert.strictEqual(result.route, 'unrelated_chat', '问候语应命中 unrelated_chat');
    assert.strictEqual(result.responseKind, 'social', '问候语响应类型应为 social');
}

async function testCoachLockedUntilSubmit() {
    const service = new ReadingCoachService({});
    let thrown = null;
    try {
        await service.query({
            examId: 'p1-high-01',
            query: '给我提示',
            action: 'chat',
            attemptContext: { submitted: false }
        });
    } catch (error) {
        thrown = error;
    }
    assert.ok(thrown, '未提交状态应被拒绝');
    assert.strictEqual(thrown.code, 'coach_locked_until_submit', '未提交状态错误码应为 coach_locked_until_submit');
}

async function testTableCompletionQuestionExtraction() {
    const service = new ReadingCoachService({});
    const bundle = await service._loadExamBundle('p2-low-06');
    const q14Chunk = bundle.chunks.find((chunk) => chunk.chunkType === 'question_item' && Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.includes('14'));
    assert.ok(q14Chunk, '应构建显示题号 Q14 的题干 chunk');
    assert.ok(!String(q14Chunk.content || '').includes('题干未解析'), '表格题题干不应回退到“题干未解析”');
    assert.ok(/natural process that appears simpler than it actually is/i.test(q14Chunk.content), '应提取表格题实际题干文案');
    const passageG = bundle.chunks.find((chunk) => chunk.chunkType === 'passage_paragraph' && Array.isArray(chunk.paragraphLabels) && chunk.paragraphLabels.includes('G'));
    assert.ok(passageG, '应抽取到 G 段原文 chunk');
    assert.ok(/Photosynthesis/i.test(passageG.content), 'G 段内容应包含 Photosynthesis 证据');
}

async function testDisplayQuestionNumbersStayAlignedWithReviewRetrieval() {
    const service = new ReadingCoachService({});
    const bundle = await service._loadExamBundle('p3-high-32');
    const q27Chunk = bundle.chunks.find((chunk) => chunk.chunkType === 'question_item' && Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.includes('27'));
    const q27AnswerKey = bundle.chunks.find((chunk) => chunk.chunkType === 'answer_key' && Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.includes('27'));
    assert.ok(q27Chunk, 'question chunk 应使用显示题号 27，而不是内部 q1');
    assert.ok(q27AnswerKey, 'answer key chunk 应使用显示题号 27，而不是内部 q1');
    assert.ok(String(q27Chunk.content || '').includes('Q27'), 'question chunk 文案应与显示题号对齐');
}

async function testGroupedQuestionExtractionDoesNotLeakNeighborQuestions() {
    const service = new ReadingCoachService({});

    const p3Bundle = await service._loadExamBundle('p3-high-32');
    const q28Chunk = p3Bundle.chunks.find((chunk) => chunk.chunkType === 'question_item' && Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.includes('28'));
    assert.ok(q28Chunk, '应构建 Q28 题干 chunk');
    assert.ok(/When describing the way computer-generated imagery changes actors' appearance/i.test(q28Chunk.content), 'Q28 应包含自己的题干');
    assert.ok(!/main point in the first paragraph/i.test(q28Chunk.content), 'Q28 不应泄漏 Q27 首题题干');

    const p1Bundle = await service._loadExamBundle('p1-high-05');
    const q2Chunk = p1Bundle.chunks.find((chunk) => chunk.chunkType === 'question_item' && Array.isArray(chunk.questionNumbers) && chunk.questionNumbers.includes('2'));
    assert.ok(q2Chunk, '应构建 Q2 题干 chunk');
    assert.ok(/Mansfield won a prize for a story/i.test(q2Chunk.content), 'Q2 应包含自己的判断题题干');
    assert.ok(!/exactly the same as her original name/i.test(q2Chunk.content), 'Q2 不应泄漏 Q1 首题题干');
    assert.ok(!/How Pearl Button Was Kidnapped/i.test(q2Chunk.content), 'Q2 不应泄漏 Q3 邻题题干');
}

async function testReadingKernelModulesKeepContracts() {
    const routePayload = {
        query: '请复盘我的错题',
        selectedText: '',
        focusQuestionNumbers: [],
        attemptContext: {
            submitted: true,
            wrongQuestions: ['27'],
            selectedAnswers: { 27: 'A' }
        }
    };
    const route = classifyReadingRoute(routePayload, {
        routes: ROUTES,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        weatherTimePatterns: ROUTER_FIXTURES.weatherTimePatterns,
        ieltsGeneralPatterns: ROUTER_FIXTURES.ieltsGeneralPatterns,
        pageGroundedHints: ROUTER_FIXTURES.pageGroundedHints
    });
    assert.strictEqual(route.route, ROUTES.PAGE_GROUNDED, '错题复盘必须进入页面上下文路由');

    const intent = classifyReadingIntent(routePayload, route.route, {
        routes: ROUTES,
        intents: INTENTS,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        wholeSetPatterns: ROUTER_FIXTURES.wholeSetPatterns,
        questionRefPatternGlobal: ROUTER_FIXTURES.questionRefPatternGlobal
    });
    assert.strictEqual(intent.kind, INTENTS.WHOLE_SET_OR_REVIEW, '显式复盘文案应识别为整组复盘');
    assert.strictEqual(resolveReadingContextRoute(routePayload, intent, {
        contextRoutes: CONTEXT_ROUTES,
        intents: INTENTS
    }), CONTEXT_ROUTES.REVIEW, '错题复盘必须使用 review contextRoute');

    const messages = buildReadingCoachPrompt({
        payload: {
            ...routePayload,
            examId: 'p3-high-32',
            locale: 'zh',
            score: null,
            history: [],
            selectedText: ''
        },
        routeDecision: route,
        intent,
        contextRoute: CONTEXT_ROUTES.REVIEW,
        retrieval: {
            focusQuestionNumbers: ['27'],
            focusParagraphLabels: [],
            missingContext: [],
            reviewTargets: [{
                questionNumber: '27',
                questionStem: 'Q27 What is the writer main point?',
                selectedAnswer: 'A',
                correctAnswer: 'D',
                officialExplanation: '定位第一段。'
            }],
            finalChunks: [{
                chunkType: CHUNK_TYPE.PASSAGE,
                questionNumbers: ['27'],
                paragraphLabels: ['A'],
                content: 'Original paragraph evidence.'
            }]
        },
        routes: ROUTES,
        contextRoutes: CONTEXT_ROUTES,
        chunkType: CHUNK_TYPE
    });
    const joined = messages.map((item) => item.content).join('\n');
    assert.ok(joined.includes('[Attempt Context]'), 'prompt 模块必须显式发送 attempt context 区块');
    assert.ok(joined.includes('[Retrieval Summary]'), 'prompt 模块必须显式发送 retrieval summary 区块');
    assert.ok(joined.includes('[Review Targets]'), 'prompt 模块必须保留 reviewTargets 区块');
    assert.ok(joined.includes('source: original_reading_passage_text'), 'prompt 模块必须标注原文来源');
    assert.ok(joined.includes('整组易错模式归纳优先于逐题流水账'), 'review prompt 必须优先要求整组易错模式归纳');
    assert.ok(joined.includes('reviewOverall'), 'review prompt 必须要求总评模块');
    assert.ok(joined.includes('reviewQuestionAnalyses'), 'review prompt 必须要求逐题错因推理');
    assert.ok(joined.includes('目标不是讲题，而是帮助用户看见自己为什么会那样想'), 'review prompt 必须定位为错因洞察而不是题目讲解');
    assert.ok(joined.includes('不得大段复制'), 'review prompt 必须禁止搬运原文或官方解析');

    const reviewFormat = buildCoachResponseFormat({
        contextRoute: CONTEXT_ROUTES.REVIEW,
        contextRoutes: CONTEXT_ROUTES
    });
    const required = reviewFormat.json_schema.schema.required;
    assert.ok(required.includes('reviewOverall'), 'review schema 必须强制总评模块');
    assert.ok(required.includes('reviewQuestionAnalyses'), 'review schema 必须强制逐题分析模块');
    const sectionTypeEnum = reviewFormat.json_schema.schema.properties.answerSections.items.properties.type.enum;
    assert.ok(!sectionTypeEnum.includes('evidence'), 'review schema 不应允许 evidence 段作为主输出');

    const parsed = normalizeReadingCoachModelResponse('```json\n{"answer":"ok","answerSections":[{"type":"direct_answer","text":"ok"}],"followUps":[],"confidence":"high","missingContext":[]}\n```');
    assert.strictEqual(parsed.confidence, 'high', 'response normalizer 应解析 fenced JSON');
    assert.ok(parsed.followUps.length > 0, 'response normalizer 应补默认 followUps');

    const parsedReview = normalizeReadingCoachModelResponse(JSON.stringify({
        answer: '整体看，你容易把局部词匹配当成答案依据。',
        answerSections: [{ type: 'direct_answer', text: '先诊断：局部匹配压过了题干限定。' }],
        followUps: [],
        confidence: 'high',
        missingContext: ['Q28 缺少原文证据与官方解析，只能给结构性诊断。'],
        reviewOverall: {
            primaryWeakness: '你容易把局部词匹配当成答案依据，忽略题干限制条件。',
            patternSummary: '错题集中体现为定位后没有二次核对选项逻辑。',
            teachingPlan: '先圈题干限定，再找同义替换，最后逐项排除。'
        },
        reviewQuestionAnalyses: [{
            questionNumber: 'Q27',
            likelyMistake: '把首段态度判断成事实细节。',
            whyUserChoseWrong: 'A 可能含有原文局部词，所以看起来相关。',
            whyCorrectAnswerWorks: 'D 覆盖作者主旨和转折后的重点。',
            whyWrongAnswerFails: 'A 只对应局部信息，不能回答 main point。',
            nextRule: '主旨题先找段落功能，不先抓单词。'
        }]
    }));
    assert.strictEqual(parsedReview.reviewOverall.primaryWeakness, '你容易把局部词匹配当成答案依据，忽略题干限制条件。', 'normalizer 应保留 reviewOverall');
    assert.strictEqual(parsedReview.reviewQuestionAnalyses[0].questionNumber, '27', 'normalizer 应规范化 Q 前缀题号');
    assert.ok(parsedReview.missingContext[0].includes('缺少原文证据与官方解析'), 'normalizer 应保留证据不足披露');
}

async function testSubmittedSingleQuestionQuestionStaysGrounded() {
    const routePayload = {
        query: '第 27 题为什么我选 A 错了？证据在哪一段？',
        action: 'chat',
        promptKind: 'freeform',
        selectedText: '',
        focusQuestionNumbers: ['27'],
        attemptContext: {
            submitted: true,
            wrongQuestions: ['27'],
            selectedAnswers: { 27: 'A' }
        }
    };
    const route = classifyReadingRoute(routePayload, {
        routes: ROUTES,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        weatherTimePatterns: ROUTER_FIXTURES.weatherTimePatterns,
        ieltsGeneralPatterns: ROUTER_FIXTURES.ieltsGeneralPatterns,
        pageGroundedHints: ROUTER_FIXTURES.pageGroundedHints
    });
    const intent = classifyReadingIntent(routePayload, route.route, {
        routes: ROUTES,
        intents: INTENTS,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        wholeSetPatterns: ROUTER_FIXTURES.wholeSetPatterns,
        questionRefPatternGlobal: ROUTER_FIXTURES.questionRefPatternGlobal
    });
    const contextRoute = resolveReadingContextRoute(routePayload, intent, {
        contextRoutes: CONTEXT_ROUTES,
        intents: INTENTS
    });

    assert.strictEqual(route.route, ROUTES.PAGE_GROUNDED, '单题错因问题必须进入页面上下文路由');
    assert.strictEqual(intent.kind, INTENTS.GROUNDED_QUESTION, '单题错因问题不应被打到整组复盘');
    assert.strictEqual(contextRoute, CONTEXT_ROUTES.TUTOR, '单题错因问题必须走 grounded tutor');
}

async function testAnalyzeMistakeActionWithSpecificQuestionStaysGrounded() {
    const routePayload = {
        query: '帮我分析第 5 题为什么错了',
        action: 'analyze_mistake',
        promptKind: 'preset',
        selectedText: '',
        focusQuestionNumbers: ['5'],
        attemptContext: {
            submitted: true,
            wrongQuestions: ['5'],
            selectedAnswers: { 5: 'C' }
        }
    };
    const route = classifyReadingRoute(routePayload, {
        routes: ROUTES,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        weatherTimePatterns: ROUTER_FIXTURES.weatherTimePatterns,
        ieltsGeneralPatterns: ROUTER_FIXTURES.ieltsGeneralPatterns,
        pageGroundedHints: ROUTER_FIXTURES.pageGroundedHints
    });
    const intent = classifyReadingIntent(routePayload, route.route, {
        routes: ROUTES,
        intents: INTENTS,
        socialPatterns: ROUTER_FIXTURES.socialPatterns,
        wholeSetPatterns: ROUTER_FIXTURES.wholeSetPatterns,
        questionRefPatternGlobal: ROUTER_FIXTURES.questionRefPatternGlobal
    });

    assert.strictEqual(intent.kind, INTENTS.GROUNDED_QUESTION, '特定题号的 analyze_mistake 不应落入整组 review');
    assert.strictEqual(resolveReadingContextRoute(routePayload, intent, {
        contextRoutes: CONTEXT_ROUTES,
        intents: INTENTS
    }), CONTEXT_ROUTES.TUTOR, '特定题号的 analyze_mistake 必须走 tutor');
}

async function testReviewRetrievalInjectsOriginalPassageChunks() {
    const service = new ReadingCoachService({});
    let capturedMessages = null;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            capturedMessages = options.messages;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '你先看第一段主旨，再对照原文里的 Oscar 和 CGI 转折。',
                    answerSections: [
                        { type: 'direct_answer', text: '你先看第一段主旨，再对照原文里的 Oscar 和 CGI 转折。' },
                        { type: 'reasoning', text: '原文段落已经注入，不要只盯解析。' }
                    ],
                    followUps: ['这题证据在哪段', '我下次怎么排除'],
                    confidence: 'high',
                    missingContext: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const result = await service.query({
        examId: 'p3-high-32',
        query: '请复盘我的错题',
        action: 'review_set',
        promptKind: 'preset',
        attemptContext: {
            submitted: true,
            wrongQuestions: ['27', '28', '29', '30'],
            selectedAnswers: { 27: 'A', 28: 'B', 29: 'C', 30: 'D' }
        }
    });

    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('source: original_reading_passage_text'), 'review prompt 必须显式标记原文 passage chunk');
    assert.ok(/chunkType: passage_paragraph/.test(promptJoined), 'review prompt 必须带 passage_paragraph');
    assert.ok(/Q27/.test(promptJoined), 'review prompt 必须围绕显示题号 27 构造');
    assert.ok(Array.isArray(result.citations) && result.citations.some((item) => item.chunkType === 'passage_paragraph'), 'review 响应引用里必须保留原文 chunk');
}

async function testReviewFallsBackToWholePassageWhenAttemptContextIsThin() {
    const service = new ReadingCoachService({});
    let capturedMessages = null;
    let capturedResponseFormat = null;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            capturedMessages = options.messages;
            capturedResponseFormat = options.response_format;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '先看整组错题模式，再逐题回到题干和答案。',
                    answerSections: [
                        { type: 'direct_answer', text: '先看整组错题模式，再逐题回到题干和答案。' }
                    ],
                    followUps: ['继续看 Q1', '给我训练建议'],
                    confidence: 'medium',
                    missingContext: [],
                    reviewOverall: {
                        primaryWeakness: '需要先补齐作答记录，再判断长期易错点。',
                        patternSummary: '题干、答案和原文已经进入上下文，可做结构性复盘。',
                        teachingPlan: '按题型分组核对定位和排除逻辑。'
                    },
                    reviewQuestionAnalyses: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const result = await service.query({
        examId: 'p1-low-67',
        query: '请复盘我本次错题，按优先级给出训练建议',
        action: 'review_set',
        promptKind: 'preset',
        attemptContext: {
            submitted: true,
            wrongQuestions: [],
            selectedAnswers: {}
        }
    });

    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('[Review 13]'), '薄 attempt context 下 review prompt 仍必须覆盖整篇 Q1-Q13');
    assert.ok(promptJoined.includes('Q1 正确答案') || promptJoined.includes('correctAnswer: F'), 'review prompt 必须提供标准答案');
    assert.ok(promptJoined.includes('source: original_reading_passage_text'), 'review prompt 必须提供原文 chunk');
    assert.ok(result.contextDiagnostics.focusQuestionNumbers.includes('1'), 'review fallback 必须把整套题号作为检索焦点');
    assert.ok(capturedResponseFormat.json_schema.schema.properties.reviewQuestionAnalyses.maxItems >= 13, 'review schema 必须允许单篇 passage 的逐题分析容量');
}

async function testReviewMapsInternalQuestionIdsToDisplayQuestionNumbers() {
    const service = new ReadingCoachService({});
    let capturedMessages = null;
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            capturedMessages = options.messages;
            if (typeof options.onChunk === 'function') {
                options.onChunk(JSON.stringify({
                    answer: '内部题号已映射到显示题号。',
                    answerSections: [
                        { type: 'direct_answer', text: '内部题号已映射到显示题号。' }
                    ],
                    followUps: [],
                    confidence: 'high',
                    missingContext: [],
                    reviewOverall: {
                        primaryWeakness: '先确认题号映射，再分析错因。',
                        patternSummary: 'q1/q2 已对应到 Q27/Q28。',
                        teachingPlan: '按显示题号复盘。'
                    },
                    reviewQuestionAnalyses: []
                }));
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: [{ provider: 'openai', model: 'gpt-test', status: 'success' }]
            };
        }
    };

    const result = await service.query({
        examId: 'p3-high-04',
        query: '请复盘我的错题',
        action: 'review_set',
        promptKind: 'preset',
        attemptContext: {
            submitted: true,
            wrongQuestions: ['1', '2'],
            selectedAnswers: {
                1: 'E',
                2: 'false'
            }
        }
    });

    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('questionNumber: Q27'), '内部 q1/1 必须映射为显示题号 Q27');
    assert.ok(promptJoined.includes('questionNumber: Q28'), '内部 q2/2 必须映射为显示题号 Q28');
    assert.ok(promptJoined.includes('correctAnswer: K'), 'Q27 必须带正确答案 K');
    assert.ok(promptJoined.includes('correctAnswer: H'), 'Q28 必须带正确答案 H');
    assert.ok(promptJoined.includes('half-yawns'), 'Q27 题干/选项上下文必须进入 prompt');
    assert.ok(promptJoined.includes('sneeze'), 'Q28 题干/选项上下文必须进入 prompt');
    assert.ok(!promptJoined.includes('questionNumber: Q1'), 'P3 显示题号不应退化为内部 Q1');
    assert.deepStrictEqual(result.contextDiagnostics.focusQuestionNumbers.slice(0, 2), ['27', '28'], '检索焦点必须使用显示题号');
}

async function testAllGeneratedReadingQuestionChunksAreResolvable() {
    const service = new ReadingCoachService({});
    const examDir = path.join(repoRoot, 'assets', 'generated', 'reading-exams');
    const examIds = fs.readdirSync(examDir)
        .filter((fileName) => fileName.endsWith('.js') && fileName !== 'manifest.js')
        .map((fileName) => fileName.replace(/\.js$/, ''))
        .sort();
    let questionChunkCount = 0;
    const unresolved = [];
    const shiftedSamples = [];

    for (const examId of examIds) {
        const bundle = await service._loadExamBundle(examId);
        const displayMap = bundle.examDataset?.questionDisplayMap || {};
        const hasDisplayShift = Object.entries(displayMap).some(([questionId, displayValue]) => (
            String(questionId || '').replace(/^q/i, '') !== String(displayValue || '').replace(/^q/i, '')
        ));
        if (hasDisplayShift && shiftedSamples.length < 6) {
            shiftedSamples.push(examId);
        }
        const questionChunks = bundle.chunks.filter((chunk) => chunk.chunkType === CHUNK_TYPE.QUESTION);
        questionChunkCount += questionChunks.length;
        questionChunks.forEach((chunk) => {
            if (/题干未解析/.test(String(chunk.content || ''))) {
                unresolved.push({
                    examId,
                    questionNumbers: chunk.questionNumbers,
                    content: chunk.content
                });
            }
        });
    }

    assert.ok(examIds.length >= 200, '全量题库审计必须覆盖生成题库');
    assert.ok(questionChunkCount >= 2900, '全量题库审计必须覆盖所有 question chunk');
    assert.ok(shiftedSamples.length > 0, '审计必须覆盖内部题号与显示题号偏移的题库');
    assert.deepStrictEqual(unresolved, [], '所有生成题库 question chunk 都必须能解析题干');
}

async function main() {
    try {
        await testCoachQuerySuccessWithGroundedRetrieval();
        await testReadingContractsBuildStableDiagnostics();
        await testCoachCacheHitKeepsDiagnosticsContract();
        await testCoachReviewPromptCarriesMistakeContext();
        await testCoachQueryInvalidPayloadThrows();
        await testCoachProviderFailureShouldThrow();
        await testCoachRouteUnrelatedChat();
        await testCoachLockedUntilSubmit();
        await testTableCompletionQuestionExtraction();
        await testDisplayQuestionNumbersStayAlignedWithReviewRetrieval();
        await testGroupedQuestionExtractionDoesNotLeakNeighborQuestions();
        await testReadingKernelModulesKeepContracts();
        await testSubmittedSingleQuestionQuestionStaysGrounded();
        await testAnalyzeMistakeActionWithSpecificQuestionStaysGrounded();
        await testReviewRetrievalInjectsOriginalPassageChunks();
        await testReviewFallsBackToWholePassageWhenAttemptContextIsThin();
        await testReviewMapsInternalQuestionIdsToDisplayQuestionNumbers();
        await testAllGeneratedReadingQuestionChunksAreResolvable();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'ReadingCoachService 已覆盖路由、检索、题干提取与提交态门禁'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error && error.stack ? error.stack : String(error)
        }, null, 2));
        process.exit(1);
    }
}

main();
