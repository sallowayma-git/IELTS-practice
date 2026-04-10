#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);
const ReadingAnalysisService = require(path.join(repoRoot, 'electron/services/reading-analysis.service.js'));

function buildPayload() {
    return {
        singleAttemptAnalysisInput: {
            dataQuality: { confidence: 0.8 },
            analysisSignals: { unansweredCount: 1 }
        },
        singleAttemptAnalysis: {
            summary: {
                accuracy: 0.62,
                durationSec: 900,
                unansweredRate: 0.1,
                changedAnswerRate: 0.2
            },
            radar: {
                byQuestionKind: [
                    { kind: 'matching', total: 10, correct: 6, accuracy: 0.6, confidence: 0.8 }
                ],
                byPassageCategory: []
            },
            diagnosis: [
                {
                    code: 'stage1_diag_1',
                    reason: '结构化分析结论1',
                    evidence: ['accuracy: 0.62']
                }
            ],
            nextActions: [
                {
                    type: 'practice_kind',
                    target: 'matching',
                    instruction: '按题型补练',
                    evidence: ['matching accuracy: 0.6']
                }
            ]
        }
    };
}

async function testParseErrorShouldDegradeInsteadOfThrow() {
    const service = new ReadingAnalysisService({
        getDefaultModelForTask() {
            return null;
        }
    });
    service.providerOrchestrator = {
        async streamCompletion(options = {}) {
            if (typeof options.onChunk === 'function') {
                options.onChunk('{"diagnosis":[{"code":"d1","reason":"截断');
            }
            return {
                usedConfig: { id: 1, provider: 'openai', default_model: 'gpt-test' },
                providerPath: ['openai/gpt-test']
            };
        }
    };

    const result = await service.generateSingleAttemptAnalysis(buildPayload());
    assert.strictEqual(result.model_trace.degraded, true, '解析失败应触发降级返回');
    assert.strictEqual(result.model_trace.degraded_reason, 'parse_error', '解析失败应标记 parse_error');
    assert.ok(Array.isArray(result.diagnosis) && result.diagnosis.length > 0, '降级结果应包含 diagnosis');
    assert.ok(Array.isArray(result.nextActions) && result.nextActions.length > 0, '降级结果应包含 nextActions');
}

async function testProviderErrorShouldDegradeInsteadOfThrow() {
    const service = new ReadingAnalysisService({
        getDefaultModelForTask() {
            return null;
        }
    });
    service.providerOrchestrator = {
        async streamCompletion() {
            const error = new Error('provider unavailable');
            error.code = 'provider_unavailable';
            throw error;
        }
    };

    const result = await service.generateSingleAttemptAnalysis(buildPayload());
    assert.strictEqual(result.model_trace.degraded, true, 'Provider 失败应触发降级返回');
    assert.strictEqual(result.model_trace.degraded_reason, 'provider_unavailable', 'Provider 失败应写入降级原因');
    assert.ok(Array.isArray(result.diagnosis) && result.diagnosis.length > 0, '降级结果应包含 diagnosis');
    assert.ok(Array.isArray(result.nextActions) && result.nextActions.length > 0, '降级结果应包含 nextActions');
}

async function testInvalidPayloadShouldStillThrow() {
    const service = new ReadingAnalysisService({
        getDefaultModelForTask() {
            return null;
        }
    });
    let thrown = null;
    try {
        await service.generateSingleAttemptAnalysis({});
    } catch (error) {
        thrown = error;
    }
    assert.ok(thrown, '入参缺失时应抛错');
    assert.strictEqual(thrown.code, 'invalid_payload', '入参缺失错误码应保持 invalid_payload');
}

async function main() {
    try {
        await testParseErrorShouldDegradeInsteadOfThrow();
        await testProviderErrorShouldDegradeInsteadOfThrow();
        await testInvalidPayloadShouldStillThrow();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'ReadingAnalysisService 已覆盖 parse/provider 失败降级与 invalid_payload 抛错契约'
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
