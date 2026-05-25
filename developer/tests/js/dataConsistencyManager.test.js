#!/usr/bin/env node
'use strict';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const results = [];

function loadManager() {
    const windowStub = {};
    const sandbox = {
        window: windowStub,
        console: {
            log() {},
            warn() {},
            error() {},
            info() {},
            debug() {}
        },
        Date,
        JSON,
        Object,
        Array,
        String,
        Number,
        structuredClone
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const coreSource = fs.readFileSync(path.join(repoRoot, 'js/core/practiceCore.js'), 'utf8');
    vm.runInContext(coreSource, sandbox, { filename: 'js/core/practiceCore.js' });
    const source = fs.readFileSync(path.join(repoRoot, 'js/utils/dataConsistencyManager.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/utils/dataConsistencyManager.js' });
    return new windowStub.DataConsistencyManager();
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

async function testEnsureConsistencyDoesNotMutateCanonicalRecord() {
    const manager = loadManager();
    const canonical = {
        id: 'record-view-model',
        startTime: '2026-05-10T00:00:00.000Z',
        answers: { '1': ' true ' },
        correctAnswers: { '1': 'TRUE' },
        realData: {
            answers: { '1': ' true ' },
            scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
        }
    };
    const before = JSON.stringify(canonical);

    const projected = manager.ensureConsistency(canonical);
    assert.notStrictEqual(projected, canonical, 'ensureConsistency 应返回展示投影，不应返回原对象引用');
    assert.strictEqual(JSON.stringify(canonical), before, 'ensureConsistency 不应变异 canonical record');
    assert.strictEqual(canonical.realData.correctAnswers, undefined, 'ensureConsistency 不应写入原始 realData.correctAnswers');
    assert.strictEqual(projected.realData.correctAnswers.q1, 'TRUE', '展示投影应补齐 realData.correctAnswers');

    projected.realData.correctAnswers.q1 = 'MUTATED';
    assert.strictEqual(canonical.correctAnswers['1'], 'TRUE', '修改展示投影不应反向污染 canonical correctAnswers');
    assert.strictEqual(canonical.realData.correctAnswers, undefined, '修改展示投影不应反向污染 canonical realData');
    recordResult('ensureConsistency clones before enriching display data', true, {
        projectedAnswer: projected.realData.correctAnswers.q1
    });
}

async function testFixDataInconsistenciesDoesNotMutateInputList() {
    const manager = loadManager();
    const canonical = {
        id: 'record-batch-view-model',
        startTime: '2026-05-11T00:00:00.000Z',
        answers: { '1': 'FALSE' },
        correctAnswers: { '1': 'TRUE' },
        realData: { answers: { '1': 'FALSE' } }
    };
    const records = [canonical];
    const before = JSON.stringify(records);

    const projected = manager.fixDataInconsistencies(records);
    assert.notStrictEqual(projected, records, 'fixDataInconsistencies 应返回新数组');
    assert.notStrictEqual(projected[0], canonical, 'fixDataInconsistencies 应返回新记录对象');
    assert.strictEqual(JSON.stringify(records), before, 'fixDataInconsistencies 不应变异输入列表');
    assert.strictEqual(projected[0].realData.correctAnswers.q1, 'TRUE', '批量展示投影应补齐 realData.correctAnswers');
    recordResult('fixDataInconsistencies returns cloned display records', true, {
        projectedCount: projected.length
    });
}

async function testNumericCorrectAnswersRemainScoreCount() {
    const manager = loadManager();
    const canonical = {
        id: 'record-numeric-correct-count',
        startTime: '2026-05-12T00:00:00.000Z',
        answers: { '1': 'A', '2': 'B' },
        correctAnswers: 7,
        totalQuestions: 10,
        realData: {
            answers: { '1': 'A', '2': 'B' }
        }
    };

    const projected = manager.ensureConsistency(canonical);
    assert.strictEqual(projected.correctAnswers, 7, '数字型 correctAnswers 表示答对数量，不能被标准化成答案表');
    assert.strictEqual(projected.score, 7, '数字型 correctAnswers 应作为 score 兜底');
    assert.strictEqual(projected.totalQuestions, 10, '已有 totalQuestions 不应被 answers 数量覆盖');
    assert.strictEqual(projected.accuracy, 0.7, 'accuracy 应由答对数量和总题数推导');
    assert.strictEqual(Object.keys(projected.realData.correctAnswers).length, 0, '缺少正确答案表时不能伪造 realData.correctAnswers');
    assert.strictEqual(projected.answerComparison, undefined, '缺少正确答案表时不能生成空正确答案 comparison');
    assert.strictEqual(canonical.correctAnswers, 7, '展示投影不应污染 canonical correctAnswers');
    recordResult('numeric correctAnswers are treated as score count, not answer map', true, {
        score: projected.score,
        accuracy: projected.accuracy
    });
}

async function testCanonicalCorrectAnswerMapWins() {
    const manager = loadManager();
    const canonical = {
        id: 'record-canonical-correct-map',
        startTime: '2026-05-13T00:00:00.000Z',
        answers: { '1': 'A', '2': 'D' },
        correctAnswerMap: { '1': 'A', '2': 'D' },
        correctAnswers: { '1': 'B', '2': 'C' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false },
            q2: { userAnswer: 'D', correctAnswer: 'C', isCorrect: false }
        },
        realData: {
            correctAnswerMap: { '2': 'D' },
            correctAnswers: { '1': 'B', '2': 'C' }
        }
    };

    const map = manager.getCorrectAnswerMap(canonical);
    assert.strictEqual(map.q1, 'A', 'DataConsistencyManager 必须优先使用 canonical correctAnswerMap');
    assert.strictEqual(map.q2, 'D', 'legacy correctAnswers 不能覆盖 canonical correctAnswerMap');

    const projected = manager.enrichRecordData(canonical);
    assert.strictEqual(projected.realData.correctAnswers.q1, 'A', '展示投影 realData.correctAnswers 应镜像 canonical map');
    assert.strictEqual(projected.realData.correctAnswerMap.q2, 'D', '展示投影 realData.correctAnswerMap 应镜像 canonical map');
    assert.strictEqual(projected.answerComparison.q1.correctAnswer, 'B', '已有 answerComparison 不在此处静默改写');
    assert.strictEqual(canonical.realData.correctAnswers['1'], 'B', '展示投影不应污染原始 legacy correctAnswers');

    recordResult('canonical correctAnswerMap wins in DataConsistencyManager', true, {
        correctMap: map
    });
}

async function runAllTests() {
    const tests = [
        testEnsureConsistencyDoesNotMutateCanonicalRecord,
        testFixDataInconsistenciesDoesNotMutateInputList,
        testNumericCorrectAnswersRemainScoreCount,
        testCanonicalCorrectAnswerMapWins
    ];
    for (const testFn of tests) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name, false, { error: error.message, stack: error.stack });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(result => result.passed).length;
    const failedTests = totalTests - passedTests;
    const report = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: { totalTests, passedTests, failedTests },
        failedTests: results.filter(result => !result.passed)
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
}

(async function main() {
    await runAllTests();
    const report = printJsonReport();
    process.exit(report.status === 'pass' ? 0 : 1);
})();
