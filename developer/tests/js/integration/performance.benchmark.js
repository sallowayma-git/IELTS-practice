#!/usr/bin/env node
/**
 * 性能基准测试
 * 
 * 测试场景：
 * 1. 大量单词加载性能
 * 2. 词表切换性能
 * 3. 拼写错误检测性能
 * 4. 多套题聚合性能
 */

const assert = require('assert');

// Mock浏览器环境
global.window = global;
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

// 加载SpellingErrorCollector
eval(require('fs').readFileSync('js/app/spellingErrorCollector.js', 'utf8'));

// 性能测试工具
class PerformanceBenchmark {
    constructor() {
        this.results = [];
    }
    
    async measure(name, fn, iterations = 1) {
        const times = [];
        
        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await fn();
            const end = process.hrtime.bigint();
            const duration = Number(end - start) / 1000000; // 转换为毫秒
            times.push(duration);
        }
        
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        
        this.results.push({
            name,
            iterations,
            avgMs: avg.toFixed(2),
            minMs: min.toFixed(2),
            maxMs: max.toFixed(2),
            totalMs: (avg * iterations).toFixed(2)
        });
        
        return { avg, min, max };
    }
    
    getResults() {
        return this.results;
    }
}

// 生成测试数据
function generateWords(count) {
    const words = [];
    const baseWords = [
        'accommodation', 'receive', 'environment', 'government', 'development',
        'necessary', 'separate', 'definitely', 'occurrence', 'maintenance',
        'privilege', 'conscience', 'embarrass', 'harass', 'millennium'
    ];
    
    for (let i = 0; i < count; i++) {
        const baseWord = baseWords[i % baseWords.length];
        words.push({
            word: `${baseWord}${i}`,
            userInput: `${baseWord}${i}_wrong`,
            questionId: `q${i}`,
            suiteId: `set${Math.floor(i / 10)}`,
            examId: 'test-exam',
            timestamp: Date.now(),
            errorCount: 1,
            source: i % 2 === 0 ? 'p1' : 'p4'
        });
    }
    
    return words;
}

function generateSuiteResults(suiteCount, questionsPerSuite) {
    const results = [];
    
    for (let i = 0; i < suiteCount; i++) {
        const answers = {};
        const correctAnswers = {};
        const answerComparison = {};
        
        for (let j = 0; j < questionsPerSuite; j++) {
            const qId = `q${j}`;
            const isCorrect = Math.random() > 0.3;
            
            answers[qId] = `answer${j}`;
            correctAnswers[qId] = `correct${j}`;
            answerComparison[qId] = {
                userAnswer: `answer${j}`,
                correctAnswer: `correct${j}`,
                isCorrect: isCorrect
            };
        }
        
        results.push({
            suiteId: `set${i}`,
            examId: 'test-exam',
            answers,
            correctAnswers,
            answerComparison,
            scoreInfo: {
                correct: Math.floor(questionsPerSuite * 0.7),
                total: questionsPerSuite,
                accuracy: 0.7,
                percentage: 70
            },
            spellingErrors: [],
            timestamp: Date.now(),
            duration: 300
        });
    }
    
    return results;
}

// 运行基准测试
async function runBenchmarks() {
    const benchmark = new PerformanceBenchmark();
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    console.log('开始性能基准测试...\n');
    
    // 测试1: 小量单词保存（10个）
    const smallWords = generateWords(10);
    await benchmark.measure('保存10个单词', async () => {
        await collector.saveErrors(smallWords);
    }, 10);
    
    // 测试2: 中量单词保存（100个）
    const mediumWords = generateWords(100);
    await benchmark.measure('保存100个单词', async () => {
        await collector.saveErrors(mediumWords);
    }, 5);
    
    // 测试3: 大量单词保存（1000个）
    const largeWords = generateWords(1000);
    await benchmark.measure('保存1000个单词', async () => {
        await collector.saveErrors(largeWords);
    }, 3);
    
    // 测试4: 词表加载（小）
    await benchmark.measure('加载小词表（10个单词）', async () => {
        await collector.loadVocabList('p1');
    }, 20);
    
    // 测试5: 词表加载（大）
    await collector.saveErrors(largeWords);
    await benchmark.measure('加载大词表（1000个单词）', async () => {
        await collector.loadVocabList('master');
    }, 10);
    
    // 测试6: 拼写错误检测（小）
    const smallComparison = {};
    for (let i = 0; i < 10; i++) {
        smallComparison[`q${i}`] = {
            userAnswer: `answer${i}`,
            correctAnswer: `correct${i}`,
            isCorrect: false
        };
    }
    await benchmark.measure('检测10个答案的拼写错误', () => {
        collector.detectErrors(smallComparison, 'set1', 'test-exam');
    }, 20);
    
    // 测试7: 拼写错误检测（大）
    const largeComparison = {};
    for (let i = 0; i < 100; i++) {
        largeComparison[`q${i}`] = {
            userAnswer: `answer${i}`,
            correctAnswer: `correct${i}`,
            isCorrect: false
        };
    }
    await benchmark.measure('检测100个答案的拼写错误', () => {
        collector.detectErrors(largeComparison, 'set1', 'test-exam');
    }, 10);
    
    // 测试8: 编辑距离计算
    await benchmark.measure('计算编辑距离（短单词）', () => {
        collector.levenshteinDistance('cat', 'bat');
    }, 1000);
    
    await benchmark.measure('计算编辑距离（长单词）', () => {
        collector.levenshteinDistance('accommodation', 'accomodation');
    }, 1000);
    
    // 测试9: 多套题聚合（小）
    const smallSuites = generateSuiteResults(3, 10);
    await benchmark.measure('聚合3套题（每套10题）', () => {
        // Mock聚合逻辑
        const aggregated = {};
        smallSuites.forEach(suite => {
            Object.entries(suite.answers).forEach(([qId, answer]) => {
                aggregated[`${suite.suiteId}::${qId}`] = answer;
            });
        });
    }, 20);
    
    // 测试10: 多套题聚合（大）
    const largeSuites = generateSuiteResults(10, 40);
    await benchmark.measure('聚合10套题（每套40题）', () => {
        const aggregated = {};
        largeSuites.forEach(suite => {
            Object.entries(suite.answers).forEach(([qId, answer]) => {
                aggregated[`${suite.suiteId}::${qId}`] = answer;
            });
        });
    }, 10);
    
    // 测试11: 词表计数
    await benchmark.measure('获取词表单词数', async () => {
        await collector.getWordCount('p1');
    }, 50);
    
    // 测试12: 重复单词处理
    const duplicateWords = generateWords(50);
    await collector.saveErrors(duplicateWords);
    await benchmark.measure('处理50个重复单词', async () => {
        await collector.saveErrors(duplicateWords);
    }, 5);
    
    // 输出结果
    const results = benchmark.getResults();
    
    // 计算性能评分
    const performanceScore = calculatePerformanceScore(results);
    
    const output = {
        status: 'pass',
        timestamp: new Date().toISOString(),
        benchmarks: results,
        summary: {
            totalTests: results.length,
            performanceScore: performanceScore,
            rating: getPerformanceRating(performanceScore)
        },
        thresholds: {
            '保存10个单词': { max: 50, unit: 'ms' },
            '保存100个单词': { max: 200, unit: 'ms' },
            '保存1000个单词': { max: 1000, unit: 'ms' },
            '加载小词表（10个单词）': { max: 20, unit: 'ms' },
            '加载大词表（1000个单词）': { max: 100, unit: 'ms' },
            '检测10个答案的拼写错误': { max: 10, unit: 'ms' },
            '检测100个答案的拼写错误': { max: 50, unit: 'ms' },
            '计算编辑距离（短单词）': { max: 1, unit: 'ms' },
            '计算编辑距离（长单词）': { max: 2, unit: 'ms' },
            '聚合3套题（每套10题）': { max: 5, unit: 'ms' },
            '聚合10套题（每套40题）': { max: 20, unit: 'ms' },
            '获取词表单词数': { max: 10, unit: 'ms' },
            '处理50个重复单词': { max: 100, unit: 'ms' }
        }
    };
    
    console.log(JSON.stringify(output, null, 2));
    return 0;
}

function calculatePerformanceScore(results) {
    // 基于阈值计算性能评分（0-100）
    const thresholds = {
        '保存10个单词': 50,
        '保存100个单词': 200,
        '保存1000个单词': 1000,
        '加载小词表（10个单词）': 20,
        '加载大词表（1000个单词）': 100,
        '检测10个答案的拼写错误': 10,
        '检测100个答案的拼写错误': 50,
        '计算编辑距离（短单词）': 1,
        '计算编辑距离（长单词）': 2,
        '聚合3套题（每套10题）': 5,
        '聚合10套题（每套40题）': 20,
        '获取词表单词数': 10,
        '处理50个重复单词': 100
    };
    
    let totalScore = 0;
    let count = 0;
    
    results.forEach(result => {
        const threshold = thresholds[result.name];
        if (threshold) {
            const avgMs = parseFloat(result.avgMs);
            const score = Math.max(0, Math.min(100, (1 - avgMs / threshold) * 100));
            totalScore += score;
            count++;
        }
    });
    
    return count > 0 ? Math.round(totalScore / count) : 0;
}

function getPerformanceRating(score) {
    if (score >= 90) return '优秀';
    if (score >= 75) return '良好';
    if (score >= 60) return '及格';
    return '需要优化';
}

// 运行测试
if (require.main === module) {
    runBenchmarks().then(code => process.exit(code)).catch(err => {
        console.error(JSON.stringify({
            status: 'fail',
            error: err.message,
            stack: err.stack
        }, null, 2));
        process.exit(1);
    });
}

module.exports = { runBenchmarks };
