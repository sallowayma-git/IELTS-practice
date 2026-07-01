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

function loadModal() {
    const windowStub = {
        AnswerComparisonUtils: {
            getNormalizedEntries(record) {
                return Array.isArray(record && record.__entries)
                    ? record.__entries.map(entry => ({ ...entry }))
                    : [];
            },
            summariseEntries(entries) {
                const list = Array.isArray(entries) ? entries : [];
                return {
                    total: list.length,
                    correct: list.filter(entry => entry.isCorrect === true).length,
                    incorrect: list.filter(entry => entry.isCorrect === false).length,
                    unanswered: list.filter(entry => !entry.hasUserAnswer).length
                };
            }
        },
        DataConsistencyManager: class DataConsistencyManager {
            ensureConsistency(record) {
                return {
                    ...record,
                    id: `${record.id}-display`,
                    correctAnswers: {},
                    realData: {
                        ...(record.realData || {}),
                        displayOnly: true
                    }
                };
            }
        }
    };
    const sandbox = {
        window: windowStub,
        document: {
            body: { insertAdjacentHTML() {} },
            addEventListener() {},
            removeEventListener() {},
            getElementById() { return null; }
        },
        console: {
            log() {},
            warn() {},
            error() {},
            info() {},
            debug() {}
        },
        setTimeout,
        Blob: function Blob() {},
        URL: { createObjectURL() { return ''; }, revokeObjectURL() {} }
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/components/practiceRecordModal.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/components/practiceRecordModal.js' });
    return windowStub.practiceRecordModal;
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

async function testSuiteEntriesDoNotCollapseAcrossPassages() {
    const modal = loadModal();
    const record = {
        id: 'suite-record',
        suiteEntries: [
            {
                examId: 'reading-p1',
                __entries: [
                    {
                        canonicalKey: 'q1',
                        displayNumber: '1',
                        correctAnswer: 'A',
                        userAnswer: 'A',
                        isCorrect: true,
                        hasUserAnswer: true
                    }
                ]
            },
            {
                examId: 'reading-p2',
                __entries: [
                    {
                        canonicalKey: 'q1',
                        displayNumber: '1',
                        correctAnswer: 'A',
                        userAnswer: 'A',
                        isCorrect: true,
                        hasUserAnswer: true
                    }
                ]
            }
        ]
    };

    const entries = modal.collectAllEntries(record);
    assert.strictEqual(entries.length, 2, '不同 passage 的 q1=A 不能被跨篇去重');
    assert.notStrictEqual(entries[0].sourceEntryKey, entries[1].sourceEntryKey, '分篇来源 key 必须稳定区分');
    recordResult('suite entries preserve duplicate question numbers across passages', true, {
        count: entries.length,
        sourceKeys: entries.map(entry => entry.sourceEntryKey)
    });
}

async function testDuplicateRowsStillCollapseInsideSamePassage() {
    const modal = loadModal();
    const record = {
        id: 'suite-record',
        suiteEntries: [
            {
                examId: 'reading-p1',
                __entries: [
                    {
                        canonicalKey: 'q1',
                        displayNumber: '1',
                        correctAnswer: 'A',
                        userAnswer: 'A',
                        isCorrect: true,
                        hasUserAnswer: true
                    },
                    {
                        canonicalKey: 'q1',
                        displayNumber: '1',
                        correctAnswer: 'A',
                        userAnswer: 'A',
                        isCorrect: true,
                        hasUserAnswer: true
                    }
                ]
            }
        ]
    };

    const entries = modal.collectAllEntries(record);
    assert.strictEqual(entries.length, 1, '同一 passage 内的完全重复答案条目仍应去重');
    recordResult('suite entries dedupe only within same passage source', true, { count: entries.length });
}

async function testReplayKeepsCanonicalRecordSnapshot() {
    const modal = loadModal();
    const record = {
        id: 'canonical-record',
        correctAnswers: 7,
        totalQuestions: 10,
        realData: {
            answers: { q1: 'A' }
        }
    };

    modal.show(record);
    assert.notStrictEqual(modal.currentRecord, record, '回放记录应是 canonical 快照，不应持有原对象引用');
    assert.strictEqual(modal.currentRecord.id, 'canonical-record', '回放记录不能使用显示投影改写后的 id');
    assert.strictEqual(modal.currentRecord.correctAnswers, 7, '回放记录不能使用显示投影改写后的 correctAnswers');
    assert.strictEqual(modal.currentRecord.realData.displayOnly, undefined, '显示投影字段不能进入回放 payload');

    modal.currentRecord.realData.answers.q1 = 'MUTATED';
    assert.strictEqual(record.realData.answers.q1, 'A', '修改回放快照不应污染 canonical 输入');
    recordResult('modal replay uses canonical snapshot instead of display projection', true, {
        replayId: modal.currentRecord.id
    });
}

async function testNumericCorrectAnswersAreNotAnswerMaps() {
    const modal = loadModal();
    const legacyAnswers = modal.getLegacyCorrectAnswers({
        id: 'numeric-correct',
        correctAnswers: 7,
        realData: {
            answers: { q1: 'A' }
        }
    });
    assert.strictEqual(Object.keys(legacyAnswers).length, 0, '数字型 correctAnswers 表示答对数量，不能当正确答案表');

    const merged = modal.mergeComparisonWithCorrections({
        id: 'numeric-correct',
        correctAnswers: 7,
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: '', isCorrect: false }
        },
        realData: {
            correctAnswers: 7
        }
    });
    assert.strictEqual(merged.q1.correctAnswer, '', '数字型 correctAnswers 不能被 mergeComparison 当答案来源补入');
    recordResult('numeric correctAnswers are ignored by modal answer-map helpers', true, {
        legacyAnswerKeys: Object.keys(legacyAnswers),
        mergedCorrectAnswer: merged.q1.correctAnswer
    });
}

async function testCanonicalCorrectAnswerMapWinsInModalHelpers() {
    const modal = loadModal();
    const legacyAnswers = modal.getLegacyCorrectAnswers({
        id: 'conflicting-correct-map',
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        }
    });

    assert.strictEqual(legacyAnswers.q1, 'A', '详情页正确答案表必须优先使用 canonical correctAnswerMap');
    assert.strictEqual(legacyAnswers.q2, 'D', '详情页不能让 legacy correctAnswers 覆盖 canonical correctAnswerMap');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(legacyAnswers, 'q3'), false, '详情页不能从 legacy correctAnswers 补出 canonical 缺失题目');

    const merged = modal.mergeComparisonWithCorrections({
        id: 'conflicting-correct-map',
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C', q3: 'E' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: '', isCorrect: false },
            q2: { userAnswer: 'B', correctAnswer: '', isCorrect: false },
            q3: { userAnswer: 'E', correctAnswer: 'E', isCorrect: true }
        },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C', q3: 'E' },
            scoreInfo: {
                details: {
                    q3: { correctAnswer: 'E' }
                }
            }
        }
    });
    assert.strictEqual(merged.q1.correctAnswer, 'A', 'mergeComparisonWithCorrections 应用 canonical q1');
    assert.strictEqual(merged.q2.correctAnswer, 'D', 'mergeComparisonWithCorrections 应用 canonical q2');
    assert.strictEqual(merged.q3.correctAnswer, '', 'mergeComparisonWithCorrections 不能从 comparison/details/legacy correctAnswers 反推 q3');
    assert.strictEqual(merged.q3.isCorrect, null, '缺 canonical correctAnswerMap 时详情页不能判定正误');

    recordResult('modal helpers prefer canonical correctAnswerMap over legacy correctAnswers', true, {
        legacyAnswers,
        merged: {
            q1: merged.q1.correctAnswer,
            q2: merged.q2.correctAnswer,
            q3: merged.q3.correctAnswer
        }
    });
}

async function runAllTests() {
    const tests = [
        testSuiteEntriesDoNotCollapseAcrossPassages,
        testDuplicateRowsStillCollapseInsideSamePassage,
        testReplayKeepsCanonicalRecordSnapshot,
        testNumericCorrectAnswersAreNotAnswerMaps,
        testCanonicalCorrectAnswerMapWinsInModalHelpers
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
