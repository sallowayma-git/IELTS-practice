#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createRepositoryHarness() {
    const practiceState = [];
    const metaState = new Map();

    return {
        repositories: {
            practice: {
                async list() {
                    return practiceState.map((record) => JSON.parse(JSON.stringify(record)));
                },
                async overwrite(records) {
                    practiceState.splice(0, practiceState.length, ...records.map((record) => JSON.parse(JSON.stringify(record))));
                    return true;
                }
            },
            meta: {
                async set(key, value) {
                    metaState.set(key, JSON.parse(JSON.stringify(value)));
                    return true;
                },
                async remove(key) {
                    metaState.delete(key);
                    return true;
                }
            }
        },
        practiceState,
        metaState
    };
}

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

async function testProtocolNormalization(PracticeCore) {
    const normalized = PracticeCore.protocol.normalizeMessage({
        type: 'practice_completed',
        data: { examId: 'reading-p1' },
        source: 'practice_page'
    });

    assert(normalized, '消息应被正确解析');
    assert.strictEqual(normalized.type, 'PRACTICE_COMPLETE', '消息类型应折叠为 PRACTICE_COMPLETE');
    assert.strictEqual(PracticeCore.protocol.normalizeMessageType('request_init'), 'REQUEST_INIT', 'REQUEST_INIT 别名应归一');
    recordResult('PracticeCore 协议归一化', true, normalized);
}

async function testCompletionIngestion(PracticeCore) {
    const record = PracticeCore.ingestor.fromCompletion({
        type: 'practice_complete',
        data: {
            examId: 'reading-p1',
            sessionId: 'session-reading-p1',
            title: 'Passage 1',
            duration: 1800,
            answers: { 1: 'A', 2: 'B' },
            correctAnswers: { 1: 'A', 2: 'C' },
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 },
            metadata: { category: 'P1', frequency: 'high', type: 'reading' }
        }
    }, {
        examId: 'reading-p1',
        metadata: { examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    }, {
        id: 'reading-p1',
        title: 'Passage 1',
        category: 'P1',
        frequency: 'high',
        type: 'reading'
    });

    assert(record, '完成负载应成功转换为记录');
    assert.strictEqual(record.examId, 'reading-p1');
    assert.strictEqual(record.type, 'reading');
    assert.strictEqual(record.totalQuestions, 2);
    assert.strictEqual(record.correctAnswers, 1);
    assert.strictEqual(record.answers.length, 2);
    assert.strictEqual(record.correctAnswerMap.q1, 'A');
    assert.strictEqual(record.metadata.category, 'P1');
    recordResult('PracticeCore 完成负载入站', true, { id: record.id, metadata: record.metadata });
}

async function testSingleAttemptAnalysisInputCanonicalization(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-analysis-canonical',
        examId: 'reading-analysis-canonical',
        sessionId: 'session-analysis-canonical',
        type: 'reading',
        startTime: '2026-03-09T10:00:00.000Z',
        endTime: '2026-03-09T10:30:00.000Z',
        score: 3,
        totalQuestions: 5,
        correctAnswers: 3,
        accuracy: 0.6,
        answers: { q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'E' },
        questionTypePerformance: {
            general: { total: 3, correct: 2, accuracy: 0.67 },
            matching: { total: 2, correct: 1, accuracy: 0.5 }
        },
        metadata: {
            examTitle: 'Canonical Analysis',
            category: 'P2',
            frequency: 'high',
            type: 'reading',
            dataQuality: { level: 'good', confidence: 0.8 }
        }
    });

    assert(standardized.singleAttemptAnalysisInput, '应持久化 singleAttemptAnalysisInput');
    assert(
        standardized.singleAttemptAnalysis && typeof standardized.singleAttemptAnalysis === 'object',
        '应持久化 singleAttemptAnalysis 结果对象'
    );
    assert.strictEqual(
        standardized.questionTypePerformance.general,
        undefined,
        'questionTypePerformance.general 必须被禁止'
    );
    assert.strictEqual(
        standardized.questionTypePerformance.unknown.total,
        3,
        'general 应迁移为 unknown.total'
    );
    assert.strictEqual(
        standardized.singleAttemptAnalysisInput.unknownQuestions,
        3,
        'singleAttemptAnalysisInput 应记录 unknownQuestions'
    );
    assert.strictEqual(
        standardized.singleAttemptAnalysisInput.missingKindRatio,
        0.6,
        'missingKindRatio 应按 unknown/total 计算'
    );
    assert(
        Math.abs(standardized.singleAttemptAnalysisInput.confidence - 0.32) < 1e-9,
        'unknown 置信度应使用 clamp(base*(1-missingKindRatio), 0.2, 0.6)'
    );

    recordResult('PracticeCore 单次分析输入唯一入口', true, {
        unknown: standardized.questionTypePerformance.unknown,
        input: standardized.singleAttemptAnalysisInput
    });
}

async function testUnknownConfidenceClampWithZeroTotal(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-analysis-zero-total',
        examId: 'reading-analysis-zero-total',
        sessionId: 'session-analysis-zero-total',
        type: 'reading',
        score: 0,
        totalQuestions: 0,
        correctAnswers: 0,
        accuracy: 0,
        questionTypePerformance: {
            unknown: { total: 2, correct: 0, accuracy: 0 }
        },
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.9 }
        }
    });

    assert.strictEqual(
        standardized.singleAttemptAnalysisInput.missingKindRatio,
        1,
        '当 totalQuestions=0 时 missingKindRatio 应固定为 1，避免虚高置信度'
    );
    assert(
        Math.abs(standardized.singleAttemptAnalysisInput.confidence - 0.2) < 1e-9,
        '当 totalQuestions=0 时置信度应被压到下限 0.2'
    );
}

async function testSingleAttemptAnalysisLlmPassThrough(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-analysis-llm',
        examId: 'reading-analysis-llm',
        sessionId: 'session-analysis-llm',
        type: 'reading',
        totalQuestions: 4,
        correctAnswers: 2,
        accuracy: 0.5,
        questionTypePerformance: {
            matching: { total: 4, correct: 2, accuracy: 0.5 }
        },
        singleAttemptAnalysisLlm: {
            contract_version: 'v1',
            diagnosis: [
                { code: 'd1', reason: '证据化诊断 1', evidence: ['accuracy 50%'] },
                { code: 'd2', reason: '证据化诊断 2', evidence: ['matching 2/4'] }
            ],
            nextActions: [
                { type: 'targeted_drill', target: 'matching', instruction: '先做 10 道匹配题。', evidence: ['matching weak'] },
                { type: 'time_management', target: 'overall', instruction: '先易后难完成全题。', evidence: ['unanswered risk'] }
            ],
            confidence: 0.78
        },
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        }
    });

    assert(standardized.singleAttemptAnalysisLlm, '应持久化 singleAttemptAnalysisLlm');
    assert(Array.isArray(standardized.singleAttemptAnalysisLlm.diagnosis), 'singleAttemptAnalysisLlm.diagnosis 应为数组');
    assert(Array.isArray(standardized.singleAttemptAnalysisLlm.nextActions), 'singleAttemptAnalysisLlm.nextActions 应为数组');
    assert.strictEqual(standardized.singleAttemptAnalysisLlm.diagnosis.length, 2, '应保留诊断条目');
    assert.strictEqual(standardized.singleAttemptAnalysisLlm.nextActions.length, 2, '应保留动作条目');
    assert(
        standardized.realData && standardized.realData.singleAttemptAnalysisLlm,
        'realData 应同步 singleAttemptAnalysisLlm'
    );
}

async function testSingleAttemptAnalysisEvidenceStructure(PracticeCore) {
    const analysis = PracticeCore.analysis.buildSingleAttemptAnalysis({
        totalQuestions: 10,
        correctAnswers: 5,
        accuracy: 0.5,
        durationSec: 600,
        dataQuality: { confidence: 0.8 },
        analysisSignals: {
            unansweredCount: 2,
            changedAnswerCount: 3
        },
        questionTypePerformance: {
            matching: { total: 5, correct: 2, accuracy: 0.4, confidence: 0.7 },
            single_choice: { total: 5, correct: 3, accuracy: 0.6, confidence: 0.75 }
        }
    });

    assert(analysis && typeof analysis === 'object', 'analysis 输出应为对象');
    assert(Array.isArray(analysis.diagnosis), 'analysis.diagnosis 应为数组');
    assert(Array.isArray(analysis.nextActions), 'analysis.nextActions 应为数组');
    assert(
        analysis.diagnosis.every((item) => item && typeof item === 'object' && typeof item.reason === 'string'),
        'diagnosis 条目应统一为对象结构并包含 reason'
    );
    assert(
        analysis.nextActions.every((item) => item && typeof item === 'object' && typeof item.instruction === 'string'),
        'nextActions 条目应统一为对象结构并包含 instruction'
    );
    const weakest = analysis.diagnosis.find((item) => item.code === 'weakest_question_kind');
    assert(weakest && weakest.evidence && weakest.evidence.kind === 'matching', 'weakest 诊断应包含题型证据');
}

async function testChangedAnswerCountUsesChangedQuestionCount(PracticeCore) {
    const input = PracticeCore.analysis.buildSingleAttemptAnalysisInput({
        id: 'record-analysis-changed-count',
        examId: 'reading-analysis-changed-count',
        sessionId: 'session-analysis-changed-count',
        type: 'reading',
        totalQuestions: 5,
        correctAnswers: 3,
        accuracy: 0.6,
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        },
        questionTypePerformance: {
            matching: { total: 5, correct: 3, accuracy: 0.6 }
        },
        questionTimelineLite: [
            { questionId: 'q1', firstAnsweredAt: Date.now() - 4000, lastAnsweredAt: Date.now() - 2000, changeCount: 2 },
            { questionId: 'q2', firstAnsweredAt: Date.now() - 3000, lastAnsweredAt: Date.now() - 1000, changeCount: 1 },
            { questionId: 'q3', firstAnsweredAt: Date.now() - 2000, lastAnsweredAt: Date.now() - 1000, changeCount: 0 }
        ]
    }, {
        totalQuestions: 5,
        correctAnswers: 3,
        accuracy: 0.6
    });

    assert.strictEqual(
        input.analysisSignals.changedAnswerCount,
        2,
        'changedAnswerCount 应按“发生改答的题目数”统计，而不是 changeCount 累加值'
    );
}

async function testInteractionDensityUsesPerMinuteScale(PracticeCore) {
    const input = PracticeCore.analysis.buildSingleAttemptAnalysisInput({
        id: 'record-analysis-interaction-density',
        examId: 'reading-analysis-interaction-density',
        sessionId: 'session-analysis-interaction-density',
        type: 'reading',
        totalQuestions: 10,
        correctAnswers: 7,
        accuracy: 0.7,
        duration: 120,
        interactions: Array.from({ length: 12 }, (_, index) => ({
            type: 'answer',
            questionId: `q${index + 1}`,
            value: 'A'
        })),
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        },
        questionTypePerformance: {
            single_choice: { total: 10, correct: 7, accuracy: 0.7 }
        }
    }, {
        totalQuestions: 10,
        correctAnswers: 7,
        accuracy: 0.7,
        durationSec: 120
    });

    assert.strictEqual(
        input.analysisSignals.interactionDensity,
        6,
        'interactionDensity 应按每分钟交互数计算（12次/2分钟=6）'
    );
}

async function testStoreWritePath(PracticeCore, practiceState, metaState) {
    const first = await PracticeCore.store.savePracticeRecord({
        id: 'record-reading-p1',
        examId: 'reading-p1',
        sessionId: 'session-reading-p1',
        title: 'Passage 1',
        type: 'reading',
        date: new Date().toISOString(),
        score: 1,
        totalQuestions: 2,
        correctAnswers: 1,
        accuracy: 0.5,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        metadata: { examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    }, { maxRecords: 1000 });

    const second = await PracticeCore.store.savePracticeRecord({
        id: 'record-reading-p1-retry',
        examId: 'reading-p1',
        sessionId: 'session-reading-p1',
        title: 'Passage 1 retry',
        type: 'reading',
        date: new Date().toISOString(),
        score: 2,
        totalQuestions: 2,
        correctAnswers: 2,
        accuracy: 1,
        answers: { q1: 'A', q2: 'C' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        metadata: { examTitle: 'Passage 1 retry', category: 'P1', frequency: 'high', type: 'reading' }
    }, { maxRecords: 1000 });

    assert(first, '第一次保存应成功');
    assert(second, '第二次保存应成功');
    assert.strictEqual(practiceState.length, 1, '相同 sessionId 的记录应只保留一条');
    assert.strictEqual(practiceState[0].id, 'record-reading-p1-retry', '应保留最新记录');

    await PracticeCore.store.routeStorageSet(null, 'user_stats', { totalPractices: 1 });
    assert.deepStrictEqual(metaState.get('user_stats'), { totalPractices: 1 }, 'user_stats 应走统一元数据写路径');

    recordResult('PracticeCore 统一写路径', true, {
        savedRecordId: practiceState[0].id,
        totalRecords: practiceState.length
    });
}

async function main() {
    const { repositories, practiceState, metaState } = createRepositoryHarness();

    const windowStub = {
        console,
        dataRepositories: repositories,
        practiceRecords: []
    };

    const sandbox = {
        window: windowStub,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    const PracticeCore = sandbox.window.PracticeCore;

    try {
        await testProtocolNormalization(PracticeCore);
        await testCompletionIngestion(PracticeCore);
        await testSingleAttemptAnalysisInputCanonicalization(PracticeCore);
        await testUnknownConfidenceClampWithZeroTotal(PracticeCore);
        await testSingleAttemptAnalysisLlmPassThrough(PracticeCore);
        await testSingleAttemptAnalysisEvidenceStructure(PracticeCore);
        await testChangedAnswerCountUsesChangedQuestionCount(PracticeCore);
        await testInteractionDensityUsesPerMinuteScale(PracticeCore);
        await testStoreWritePath(PracticeCore, practiceState, metaState);

        const summary = {
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        };
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        recordResult('PracticeCore 测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
