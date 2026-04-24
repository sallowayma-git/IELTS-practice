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
    const promptJoined = Array.isArray(capturedMessages)
        ? capturedMessages.map((item) => String(item?.content || '')).join('\n')
        : '';
    assert.ok(promptJoined.includes('JSON 字段必须为：answer, answerSections, followUps, confidence, missingContext'), '提示词应包含结构化约束');
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
                        { type: 'evidence', text: '原文段落已经注入，不要只盯解析。' }
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

async function main() {
    try {
        await testCoachQuerySuccessWithGroundedRetrieval();
        await testCoachReviewPromptCarriesMistakeContext();
        await testCoachQueryInvalidPayloadThrows();
        await testCoachProviderFailureShouldThrow();
        await testCoachRouteUnrelatedChat();
        await testCoachLockedUntilSubmit();
        await testTableCompletionQuestionExtraction();
        await testDisplayQuestionNumbersStayAlignedWithReviewRetrieval();
        await testGroupedQuestionExtractionDoesNotLeakNeighborQuestions();
        await testReviewRetrievalInjectsOriginalPassageChunks();
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
