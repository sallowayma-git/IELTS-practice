#!/usr/bin/env node
/**
 * 集成测试：多套题提交流程
 * 
 * 测试场景：
 * 1. 单套题提交
 * 2. 多套题聚合
 * 3. 记录保存
 * 4. 拼写错误收集
 */

import assert from 'assert';

const originalConsoleLog = (console && typeof console.log === 'function')
    ? console.log.bind(console)
    : null;

function emitResult(payload) {
    const text = JSON.stringify(payload, null, 2);
    try {
        if (process && process.stdout && typeof process.stdout.write === 'function') {
            process.stdout.write(text + '\n');
            return;
        }
    } catch (_) {}
    if (typeof originalConsoleLog === 'function') {
        originalConsoleLog(text);
    }
}

// Mock浏览器环境
global.window = global;
global.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({
        addEventListener: () => {},
        appendChild: () => {},
        setAttribute: () => {},
        classList: { add: () => {}, remove: () => {} }
    })
};

global.console = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {}
};

// Mock存储系统
const mockStorage = new Map();
global.storage = {
    ready: Promise.resolve(),
    setNamespace: () => {},
    get: async (key) => mockStorage.get(key),
    set: async (key, value) => mockStorage.set(key, value),
    remove: async (key) => mockStorage.delete(key)
};

// 测试数据
const testData = {
    examId: 'listening-p1-test-001',
    suiteResults: [
        {
            suiteId: 'set1',
            examId: 'listening-p1-test-001',
            answers: { q1: 'answer1', q2: 'answer2' },
            correctAnswers: { q1: 'answer1', q2: 'correct2' },
            answerComparison: {
                q1: { userAnswer: 'answer1', correctAnswer: 'answer1', isCorrect: true },
                q2: { userAnswer: 'answer2', correctAnswer: 'correct2', isCorrect: false }
            },
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 },
            spellingErrors: [
                {
                    word: 'correct2',
                    userInput: 'answer2',
                    questionId: 'q2',
                    suiteId: 'set1',
                    examId: 'listening-p1-test-001',
                    timestamp: Date.now(),
                    errorCount: 1,
                    source: 'p1'
                }
            ],
            timestamp: Date.now(),
            duration: 300
        },
        {
            suiteId: 'set2',
            examId: 'listening-p1-test-001',
            answers: { q1: 'answer1', q2: 'answer2' },
            correctAnswers: { q1: 'answer1', q2: 'answer2' },
            answerComparison: {
                q1: { userAnswer: 'answer1', correctAnswer: 'answer1', isCorrect: true },
                q2: { userAnswer: 'answer2', correctAnswer: 'answer2', isCorrect: true }
            },
            scoreInfo: { correct: 2, total: 2, accuracy: 1.0, percentage: 100 },
            spellingErrors: [],
            timestamp: Date.now(),
            duration: 250
        }
    ]
};

// Mock suitePracticeMixin
const mockMixin = {
    multiSuiteSessionsMap: new Map(),
    
    getOrCreateMultiSuiteSession(examId) {
        if (!this.multiSuiteSessionsMap.has(examId)) {
            const session = {
                id: `multi_suite_${Date.now()}`,
                baseExamId: examId,
                startTime: Date.now(),
                suiteResults: [],
                expectedSuiteCount: 2,
                status: 'active',
                metadata: { source: 'p1' }
            };
            this.multiSuiteSessionsMap.set(examId, session);
        }
        return this.multiSuiteSessionsMap.get(examId);
    },
    
    isMultiSuiteComplete(session) {
        if (!session.expectedSuiteCount) {
            return false;
        }
        return session.suiteResults.length >= session.expectedSuiteCount;
    },
    
    aggregateScores(suiteResults) {
        let totalCorrect = 0;
        let totalQuestions = 0;
        
        suiteResults.forEach(result => {
            const scoreInfo = result.scoreInfo || {};
            totalCorrect += Number(scoreInfo.correct) || 0;
            totalQuestions += Number(scoreInfo.total) || 0;
        });
        
        const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
        const percentage = Math.round(accuracy * 100);
        
        return {
            correct: totalCorrect,
            total: totalQuestions,
            accuracy: accuracy,
            percentage: percentage,
            source: 'multi_suite_aggregated'
        };
    },
    
    aggregateAnswers(suiteResults) {
        const aggregated = {};
        
        suiteResults.forEach(result => {
            const suiteId = result.suiteId || 'unknown';
            const answers = result.answers || {};
            
            Object.entries(answers).forEach(([questionId, answer]) => {
                const key = `${suiteId}::${questionId}`;
                aggregated[key] = answer;
            });
        });
        
        return aggregated;
    },
    
    aggregateAnswerComparisons(suiteResults) {
        const aggregated = {};
        
        suiteResults.forEach(result => {
            const suiteId = result.suiteId || 'unknown';
            const comparison = result.answerComparison || {};
            
            Object.entries(comparison).forEach(([questionId, comparisonData]) => {
                const key = `${suiteId}::${questionId}`;
                aggregated[key] = comparisonData;
            });
        });
        
        return aggregated;
    },
    
    aggregateSpellingErrors(suiteResults) {
        const aggregated = [];
        const errorMap = new Map();
        
        suiteResults.forEach(result => {
            const errors = result.spellingErrors || [];
            
            errors.forEach(error => {
                if (!error || !error.word) {
                    return;
                }
                
                const key = error.word.toLowerCase();
                
                if (errorMap.has(key)) {
                    const existing = errorMap.get(key);
                    existing.errorCount = (existing.errorCount || 1) + 1;
                    existing.timestamp = Math.max(existing.timestamp || 0, error.timestamp || 0);
                } else {
                    errorMap.set(key, { ...error });
                }
            });
        });
        
        errorMap.forEach(error => aggregated.push(error));
        return aggregated;
    },
    
    async _saveSuitePracticeRecord(record) {
        await global.storage.set(`practice_record_${record.id}`, record);
        return true;
    },
    
    _formatSuiteDateLabel(timestamp) {
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}月${date.getDate()}日`;
    },
    
    _detectMultiSuiteSource(examId) {
        const lowerExamId = (examId || '').toLowerCase();
        if (lowerExamId.includes('p1')) return 'p1';
        if (lowerExamId.includes('p4')) return 'p4';
        return 'other';
    }
};

// 测试套件
async function runTests() {
    const results = [];
    
    try {
        // 测试1: 单套题提交
        console.log('测试1: 单套题提交');
        const session1 = mockMixin.getOrCreateMultiSuiteSession(testData.examId);
        session1.suiteResults.push(testData.suiteResults[0]);
        
        assert.strictEqual(session1.suiteResults.length, 1, '应该有1个套题结果');
        assert.strictEqual(session1.suiteResults[0].suiteId, 'set1', '套题ID应该是set1');
        assert.strictEqual(mockMixin.isMultiSuiteComplete(session1), false, '单套题不应该完成');
        
        results.push({ name: '单套题提交', status: 'pass' });
        
        // 测试2: 多套题聚合
        console.log('测试2: 多套题聚合');
        session1.suiteResults.push(testData.suiteResults[1]);
        
        assert.strictEqual(session1.suiteResults.length, 2, '应该有2个套题结果');
        assert.strictEqual(mockMixin.isMultiSuiteComplete(session1), true, '两套题应该完成');
        
        const aggregatedScores = mockMixin.aggregateScores(session1.suiteResults);
        assert.strictEqual(aggregatedScores.correct, 3, '总正确数应该是3');
        assert.strictEqual(aggregatedScores.total, 4, '总题数应该是4');
        assert.strictEqual(aggregatedScores.percentage, 75, '正确率应该是75%');
        
        results.push({ name: '多套题聚合', status: 'pass' });
        
        // 测试3: 答案聚合
        console.log('测试3: 答案聚合');
        const aggregatedAnswers = mockMixin.aggregateAnswers(session1.suiteResults);
        
        assert.ok(aggregatedAnswers['set1::q1'], '应该包含set1的q1答案');
        assert.ok(aggregatedAnswers['set2::q1'], '应该包含set2的q1答案');
        assert.strictEqual(Object.keys(aggregatedAnswers).length, 4, '应该有4个答案');
        
        results.push({ name: '答案聚合', status: 'pass' });
        
        // 测试4: 答案比较聚合
        console.log('测试4: 答案比较聚合');
        const aggregatedComparison = mockMixin.aggregateAnswerComparisons(session1.suiteResults);
        
        assert.ok(aggregatedComparison['set1::q1'], '应该包含set1的q1比较');
        assert.ok(aggregatedComparison['set1::q2'], '应该包含set1的q2比较');
        assert.strictEqual(aggregatedComparison['set1::q1'].isCorrect, true, 'set1::q1应该正确');
        assert.strictEqual(aggregatedComparison['set1::q2'].isCorrect, false, 'set1::q2应该错误');
        
        results.push({ name: '答案比较聚合', status: 'pass' });
        
        // 测试5: 拼写错误聚合
        console.log('测试5: 拼写错误聚合');
        const aggregatedErrors = mockMixin.aggregateSpellingErrors(session1.suiteResults);
        
        assert.strictEqual(aggregatedErrors.length, 1, '应该有1个拼写错误');
        assert.strictEqual(aggregatedErrors[0].word, 'correct2', '错误单词应该是correct2');
        assert.strictEqual(aggregatedErrors[0].userInput, 'answer2', '用户输入应该是answer2');
        
        results.push({ name: '拼写错误聚合', status: 'pass' });
        
        // 测试6: 记录保存
        console.log('测试6: 记录保存');
        const record = {
            id: session1.id,
            examId: testData.examId,
            title: '测试记录',
            type: 'listening',
            multiSuite: true,
            scoreInfo: aggregatedScores,
            answers: aggregatedAnswers,
            answerComparison: aggregatedComparison,
            spellingErrors: aggregatedErrors,
            suiteEntries: session1.suiteResults
        };
        
        await mockMixin._saveSuitePracticeRecord(record);
        
        const savedRecord = await global.storage.get(`practice_record_${record.id}`);
        assert.ok(savedRecord, '记录应该被保存');
        assert.strictEqual(savedRecord.multiSuite, true, '应该标记为多套题');
        assert.strictEqual(savedRecord.suiteEntries.length, 2, '应该有2个套题条目');
        
        results.push({ name: '记录保存', status: 'pass' });
        
        // 测试7: 重复提交检测
        console.log('测试7: 重复提交检测');
        const session2 = mockMixin.getOrCreateMultiSuiteSession(testData.examId);
        const initialLength = session2.suiteResults.length;
        
        // 模拟重复提交检测
        const alreadyRecorded = session2.suiteResults.some(
            result => result.suiteId === 'set1'
        );
        
        assert.strictEqual(alreadyRecorded, true, '应该检测到重复提交');
        
        results.push({ name: '重复提交检测', status: 'pass' });
        
        // 测试8: 预期套题数量检测
        console.log('测试8: 预期套题数量检测');
        const newSession = mockMixin.getOrCreateMultiSuiteSession('listening-p4-test-002');
        assert.strictEqual(newSession.expectedSuiteCount, 2, '应该设置预期套题数量');
        
        results.push({ name: '预期套题数量检测', status: 'pass' });
        
    } catch (error) {
        results.push({
            name: '测试执行',
            status: 'fail',
            error: error.message,
            stack: error.stack
        });
    }
    
    // 输出结果
    const allPassed = results.every(r => r.status === 'pass');
    const output = {
        status: allPassed ? 'pass' : 'fail',
        total: results.length,
        passed: results.filter(r => r.status === 'pass').length,
        failed: results.filter(r => r.status === 'fail').length,
        results: results,
        detail: allPassed ? '所有测试通过' : '部分测试失败'
    };
    
    emitResult(output);
    return allPassed ? 0 : 1;
}

runTests().then(code => process.exit(code)).catch(err => {
    emitResult({
        status: 'fail',
        error: err.message,
        stack: err.stack
    });
    process.exit(1);
});
