#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
const windowStub = {};
const sandbox = {
    window: windowStub,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout() {},
    clearTimeout() {}
};
vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/views/legacyViewBundle.js' });

const records = [
    {
        examId: 'p1-a',
        type: 'reading',
        metadata: { category: 'P1' },
        duration: 120,
        totalQuestions: 4,
        correctAnswers: 3,
        questionTypePerformance: {
            true_false_not_given: { total: 2, correct: 2, timeSpent: 40 },
            short_answer: { total: 2, correct: 1 }
        }
    },
    {
        type: 'reading-suite',
        duration: 999,
        suiteEntrySummaries: [
            {
                examId: 'p2-a',
                type: 'reading',
                category: 'P2',
                duration: 180,
                totalQuestions: 3,
                correctAnswers: 1,
                questionTypePerformance: {
                    short_answer: { total: 3, correct: 1 }
                }
            }
        ]
    },
    {
        examId: 'listening-p1',
        type: 'listening',
        metadata: { category: 'P1' },
        duration: 600,
        totalQuestions: 10,
        correctAnswers: 10,
        questionTypePerformance: {
            general: { total: 10, correct: 10, timeSpent: 600 }
        }
    },
    {
        type: 'listening-suite',
        suiteEntrySummaries: [
            {
                examId: 'legacy-listening-child',
                category: 'P2',
                duration: 300,
                questionTypePerformance: {
                    general: { total: 5, correct: 5, timeSpent: 300 }
                }
            }
        ]
    }
];

const result = windowStub.PracticeStats.calculatePerformanceBreakdown(records, []);
assert.strictEqual(result.categories[0].attempts, 1);
assert.strictEqual(result.categories[0].accuracy, 0.75);
assert.strictEqual(result.categories[0].averageDuration, 120);
assert.strictEqual(result.categories[1].attempts, 1, '套题子项应归入自己的 P2 分项');
assert.strictEqual(result.categories[1].accuracy, 1 / 3);
assert.strictEqual(result.categories[2].attempts, 0);
assert.strictEqual(result.questionTypes.some((row) => row.type === 'other'), false, '听力题型不能混入阅读表现面板');

const tfng = result.questionTypes.find((row) => row.type === 'true-false-not-given');
const shortAnswer = result.questionTypes.find((row) => row.type === 'short-answer');
assert(tfng && shortAnswer, '题型别名应归一化后参与汇总');
assert.strictEqual(tfng.accuracy, 1);
assert.strictEqual(tfng.averageTime, 20, '显式题型计时应优先使用');
assert.strictEqual(shortAnswer.correct, 2);
assert.strictEqual(shortAnswer.total, 5);
assert.strictEqual(shortAnswer.duration, 260, '缺少逐题计时时应按剩余整场耗时折算');
assert.strictEqual(shortAnswer.estimatedTime, true);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'practice performance breakdown tests passed'
}, null, 2));
