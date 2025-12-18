#!/usr/bin/env node
/**
 * SpellingErrorCollector 单元测试
 * 
 * 测试拼写错误收集器的核心功能：
 * 1. 拼写错误检测逻辑
 * 2. 编辑距离计算
 * 3. 单词过滤规则
 * 4. 词表保存和合并
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 模拟浏览器环境
// ============================================================================

global.window = {
    storage: null,
    spellingErrorCollector: null
};

// 保留原始console用于测试输出
const originalConsole = console;

global.console = {
    log: (...args) => originalConsole.log(...args),
    warn: () => {},
    error: (...args) => originalConsole.error(...args),
    info: () => {}
};

// 模拟存储系统
class MockStorage {
    constructor() {
        this.data = new Map();
        this.ready = Promise.resolve();
    }

    async get(key) {
        return this.data.get(key) || null;
    }

    async set(key, value) {
        this.data.set(key, value);
        return true;
    }

    setNamespace() {}
}

global.window.storage = new MockStorage();

// ============================================================================
// 加载 SpellingErrorCollector
// ============================================================================

const collectorPath = path.join(__dirname, '../../../js/app/spellingErrorCollector.js');
const collectorCode = fs.readFileSync(collectorPath, 'utf-8');

// 执行代码
eval(collectorCode);

// ============================================================================
// 测试套件
// ============================================================================

/**
 * 测试：编辑距离计算
 */
function testLevenshteinDistance() {
    console.log('测试: Levenshtein 编辑距离计算');
    
    const collector = new window.SpellingErrorCollector();
    
    // 完全相同
    assert.strictEqual(collector.levenshteinDistance('hello', 'hello'), 0, '相同字符串距离应为0');
    
    // 单字符替换
    assert.strictEqual(collector.levenshteinDistance('hello', 'hallo'), 1, '单字符替换距离应为1');
    
    // 单字符插入
    assert.strictEqual(collector.levenshteinDistance('hello', 'helllo'), 1, '单字符插入距离应为1');
    
    // 单字符删除
    assert.strictEqual(collector.levenshteinDistance('hello', 'helo'), 1, '单字符删除距离应为1');
    
    // 多字符差异
    assert.strictEqual(collector.levenshteinDistance('kitten', 'sitting'), 3, 'kitten->sitting距离应为3');
    
    // 空字符串
    assert.strictEqual(collector.levenshteinDistance('', 'hello'), 5, '空字符串到hello距离应为5');
    assert.strictEqual(collector.levenshteinDistance('hello', ''), 5, 'hello到空字符串距离应为5');
    
    // 常见拼写错误
    assert.strictEqual(collector.levenshteinDistance('accommodation', 'accomodation'), 1, 'accommodation拼写错误');
    assert.strictEqual(collector.levenshteinDistance('restaurant', 'resturant'), 1, 'restaurant拼写错误');
    assert.strictEqual(collector.levenshteinDistance('environment', 'enviroment'), 1, 'environment拼写错误');
    
    console.log('  ✓ 编辑距离计算正确');
}

/**
 * 测试：单词过滤规则
 */
function testIsWord() {
    console.log('测试: 单词过滤规则');
    
    const collector = new window.SpellingErrorCollector();
    
    // 有效单词
    assert.strictEqual(collector.isWord('hello'), true, 'hello应该是单词');
    assert.strictEqual(collector.isWord('accommodation'), true, 'accommodation应该是单词');
    assert.strictEqual(collector.isWord('well-known'), true, '带连字符的单词应该有效');
    assert.strictEqual(collector.isWord("it's"), true, '带撇号的单词应该有效');
    assert.strictEqual(collector.isWord('New York'), true, '两个单词的短语应该有效');
    
    // 无效输入
    assert.strictEqual(collector.isWord(''), false, '空字符串不是单词');
    assert.strictEqual(collector.isWord(null), false, 'null不是单词');
    assert.strictEqual(collector.isWord(undefined), false, 'undefined不是单词');
    assert.strictEqual(collector.isWord('   '), false, '空白字符不是单词');
    
    // 数字
    assert.strictEqual(collector.isWord('123'), false, '纯数字不是单词');
    assert.strictEqual(collector.isWord('2023'), false, '年份不是单词');
    
    // 日期和时间
    assert.strictEqual(collector.isWord('2023-01-01'), false, '日期不是单词');
    assert.strictEqual(collector.isWord('01/01/2023'), false, '日期格式不是单词');
    assert.strictEqual(collector.isWord('10:30'), false, '时间不是单词');
    assert.strictEqual(collector.isWord('10:30:45'), false, '时间格式不是单词');
    
    // 长短语
    assert.strictEqual(collector.isWord('this is a long phrase'), false, '超过3个单词的短语不应该有效');
    
    // 特殊符号
    assert.strictEqual(collector.isWord('hello@world'), false, '包含@符号不是单词');
    assert.strictEqual(collector.isWord('test#123'), false, '包含#符号不是单词');
    assert.strictEqual(collector.isWord('$100'), false, '包含$符号不是单词');
    
    // 长度限制
    assert.strictEqual(collector.isWord('a'), false, '单字符不是单词');
    assert.strictEqual(collector.isWord('a'.repeat(51)), false, '超过50字符不是单词');
    
    console.log('  ✓ 单词过滤规则正确');
}

/**
 * 测试：拼写相似度检测
 */
function testIsSimilarSpelling() {
    console.log('测试: 拼写相似度检测');
    
    const collector = new window.SpellingErrorCollector();
    
    // 完全相同（仅大小写不同）
    assert.strictEqual(collector.isSimilarSpelling('Hello', 'hello'), true, '大小写不同应该相似');
    assert.strictEqual(collector.isSimilarSpelling('HELLO', 'hello'), true, '全大写应该相似');
    
    // 拼写错误（相似度 >= 80%）
    assert.strictEqual(collector.isSimilarSpelling('accomodation', 'accommodation'), true, 'accommodation拼写错误应该相似');
    assert.strictEqual(collector.isSimilarSpelling('resturant', 'restaurant'), true, 'restaurant拼写错误应该相似');
    assert.strictEqual(collector.isSimilarSpelling('enviroment', 'environment'), true, 'environment拼写错误应该相似');
    assert.strictEqual(collector.isSimilarSpelling('occured', 'occurred'), true, 'occurred拼写错误应该相似');
    
    // 完全不同的单词
    assert.strictEqual(collector.isSimilarSpelling('hello', 'world'), false, '完全不同的单词不应该相似');
    assert.strictEqual(collector.isSimilarSpelling('cat', 'dog'), false, '不相关的单词不应该相似');
    
    // 空值处理
    assert.strictEqual(collector.isSimilarSpelling('', 'hello'), false, '空字符串不应该相似');
    assert.strictEqual(collector.isSimilarSpelling('hello', ''), false, '空字符串不应该相似');
    assert.strictEqual(collector.isSimilarSpelling(null, 'hello'), false, 'null不应该相似');
    
    console.log('  ✓ 拼写相似度检测正确');
}

/**
 * 测试：拼写错误判断
 */
function testIsSpellingError() {
    console.log('测试: 拼写错误判断');
    
    const collector = new window.SpellingErrorCollector();
    
    // 有效的拼写错误
    const validError = {
        userAnswer: 'accomodation',
        correctAnswer: 'accommodation',
        isCorrect: false
    };
    assert.strictEqual(collector.isSpellingError(validError), true, '应该识别为拼写错误');
    
    // 正确答案
    const correctAnswer = {
        userAnswer: 'accommodation',
        correctAnswer: 'accommodation',
        isCorrect: true
    };
    assert.strictEqual(collector.isSpellingError(correctAnswer), false, '正确答案不应该是拼写错误');
    
    // 非单词答案（数字）
    const numberAnswer = {
        userAnswer: '123',
        correctAnswer: '456',
        isCorrect: false
    };
    assert.strictEqual(collector.isSpellingError(numberAnswer), false, '数字不应该是拼写错误');
    
    // 完全不同的单词
    const differentWords = {
        userAnswer: 'hello',
        correctAnswer: 'world',
        isCorrect: false
    };
    assert.strictEqual(collector.isSpellingError(differentWords), false, '完全不同的单词不应该是拼写错误');
    
    // 空答案
    const emptyAnswer = {
        userAnswer: '',
        correctAnswer: 'hello',
        isCorrect: false
    };
    assert.strictEqual(collector.isSpellingError(emptyAnswer), false, '空答案不应该是拼写错误');
    
    console.log('  ✓ 拼写错误判断正确');
}

/**
 * 测试：来源检测
 */
function testDetectSource() {
    console.log('测试: 来源检测');
    
    const collector = new window.SpellingErrorCollector();
    
    // P1 检测
    assert.strictEqual(collector.detectSource('ListeningPractice/100 P1/test'), 'p1', '应该检测为P1');
    assert.strictEqual(collector.detectSource('100p1-test'), 'p1', '应该检测为P1');
    assert.strictEqual(collector.detectSource('part1-exam'), 'p1', '应该检测为P1');
    assert.strictEqual(collector.detectSource('PART-1'), 'p1', '应该检测为P1');
    
    // P4 检测
    assert.strictEqual(collector.detectSource('ListeningPractice/100 P4/test'), 'p4', '应该检测为P4');
    assert.strictEqual(collector.detectSource('100p4-test'), 'p4', '应该检测为P4');
    assert.strictEqual(collector.detectSource('part4-exam'), 'p4', '应该检测为P4');
    assert.strictEqual(collector.detectSource('PART-4'), 'p4', '应该检测为P4');
    
    // 其他
    assert.strictEqual(collector.detectSource('reading-test'), 'other', '应该检测为other');
    assert.strictEqual(collector.detectSource(''), 'other', '空字符串应该检测为other');
    assert.strictEqual(collector.detectSource(null), 'other', 'null应该检测为other');
    
    console.log('  ✓ 来源检测正确');
}

/**
 * 测试：错误检测
 */
async function testDetectErrors() {
    console.log('测试: 错误检测');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    const answerComparison = {
        'q1': {
            userAnswer: 'accomodation',
            correctAnswer: 'accommodation',
            isCorrect: false
        },
        'q2': {
            userAnswer: 'restaurant',
            correctAnswer: 'restaurant',
            isCorrect: true
        },
        'q3': {
            userAnswer: 'enviroment',
            correctAnswer: 'environment',
            isCorrect: false
        },
        'q4': {
            userAnswer: '123',
            correctAnswer: '456',
            isCorrect: false
        },
        'q5': {
            userAnswer: 'hello',
            correctAnswer: 'world',
            isCorrect: false
        }
    };
    
    const errors = collector.detectErrors(answerComparison, 'set1', 'ListeningPractice/100 P1/test');
    
    // 应该检测到2个拼写错误（q1和q3）
    assert.strictEqual(errors.length, 2, '应该检测到2个拼写错误');
    
    // 验证第一个错误
    const error1 = errors.find(e => e.questionId === 'q1');
    assert(error1, '应该包含q1的错误');
    assert.strictEqual(error1.word, 'accommodation', '正确单词应该是accommodation');
    assert.strictEqual(error1.userInput, 'accomodation', '用户输入应该是accomodation');
    assert.strictEqual(error1.source, 'p1', '来源应该是p1');
    assert.strictEqual(error1.suiteId, 'set1', '套题ID应该是set1');
    
    // 验证第二个错误
    const error2 = errors.find(e => e.questionId === 'q3');
    assert(error2, '应该包含q3的错误');
    assert.strictEqual(error2.word, 'environment', '正确单词应该是environment');
    assert.strictEqual(error2.userInput, 'enviroment', '用户输入应该是enviroment');
    
    console.log('  ✓ 错误检测正确');
}

/**
 * 测试：词表保存和加载
 */
async function testVocabListSaveAndLoad() {
    console.log('测试: 词表保存和加载');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    // 创建测试词表
    const testList = {
        id: 'p1',
        name: 'P1 拼写错误词表',
        source: 'p1',
        words: [
            {
                word: 'accommodation',
                userInput: 'accomodation',
                questionId: 'q1',
                timestamp: Date.now(),
                errorCount: 1,
                source: 'p1'
            }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stats: {
            totalWords: 1,
            masteredWords: 0,
            reviewingWords: 0
        }
    };
    
    // 保存词表
    const saveSuccess = await collector.saveVocabList(testList);
    assert.strictEqual(saveSuccess, true, '词表保存应该成功');
    
    // 加载词表
    const loadedList = await collector.loadVocabList('p1');
    assert(loadedList, '应该能加载词表');
    assert.strictEqual(loadedList.id, 'p1', '词表ID应该正确');
    assert.strictEqual(loadedList.words.length, 1, '应该有1个单词');
    assert.strictEqual(loadedList.words[0].word, 'accommodation', '单词应该正确');
    
    console.log('  ✓ 词表保存和加载正确');
}

/**
 * 测试：错误合并到词表
 */
async function testMergeErrorsToList() {
    console.log('测试: 错误合并到词表');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    // 创建空词表
    const vocabList = collector.createEmptyList('p1', 'p1');
    
    // 第一次添加错误
    const errors1 = [
        {
            word: 'accommodation',
            userInput: 'accomodation',
            questionId: 'q1',
            timestamp: 1000,
            errorCount: 1,
            source: 'p1'
        },
        {
            word: 'restaurant',
            userInput: 'resturant',
            questionId: 'q2',
            timestamp: 2000,
            errorCount: 1,
            source: 'p1'
        }
    ];
    
    collector.mergeErrorsToList(vocabList, errors1);
    assert.strictEqual(vocabList.words.length, 2, '应该有2个单词');
    
    // 第二次添加错误（包含重复单词）
    const errors2 = [
        {
            word: 'accommodation',
            userInput: 'acomodation',
            questionId: 'q3',
            timestamp: 3000,
            errorCount: 1,
            source: 'p1'
        },
        {
            word: 'environment',
            userInput: 'enviroment',
            questionId: 'q4',
            timestamp: 4000,
            errorCount: 1,
            source: 'p1'
        }
    ];
    
    collector.mergeErrorsToList(vocabList, errors2);
    assert.strictEqual(vocabList.words.length, 3, '应该有3个单词（accommodation重复）');
    
    // 验证重复单词的错误次数
    const accommodation = vocabList.words.find(w => w.word.toLowerCase() === 'accommodation');
    assert(accommodation, '应该找到accommodation');
    assert.strictEqual(accommodation.errorCount, 2, 'accommodation错误次数应该是2');
    assert.strictEqual(accommodation.userInput, 'acomodation', '应该更新为最新的错误拼写');
    assert.strictEqual(accommodation.timestamp, 3000, '应该更新为最新的时间戳');
    
    console.log('  ✓ 错误合并到词表正确');
}

/**
 * 测试：保存错误到词表
 */
async function testSaveErrors() {
    console.log('测试: 保存错误到词表');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    const errors = [
        {
            word: 'accommodation',
            userInput: 'accomodation',
            questionId: 'q1',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p1'
        },
        {
            word: 'university',
            userInput: 'univercity',
            questionId: 'q2',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p4'
        }
    ];
    
    const success = await collector.saveErrors(errors);
    assert.strictEqual(success, true, '保存错误应该成功');
    
    // 验证P1词表
    const p1List = await collector.loadVocabList('p1');
    assert(p1List, 'P1词表应该存在');
    assert(p1List.words.some(w => w.word === 'accommodation'), 'P1词表应该包含accommodation');
    
    // 验证P4词表
    const p4List = await collector.loadVocabList('p4');
    assert(p4List, 'P4词表应该存在');
    assert(p4List.words.some(w => w.word === 'university'), 'P4词表应该包含university');
    
    // 验证综合词表
    const masterList = await collector.loadVocabList('master');
    assert(masterList, '综合词表应该存在');
    assert(masterList.words.some(w => w.word === 'accommodation'), '综合词表应该包含accommodation');
    assert(masterList.words.some(w => w.word === 'university'), '综合词表应该包含university');
    
    console.log('  ✓ 保存错误到词表正确');
}

/**
 * 测试：移除单词
 */
async function testRemoveWord() {
    console.log('测试: 移除单词');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    // 先添加一些单词
    const testList = {
        id: 'p1',
        name: 'P1 拼写错误词表',
        source: 'p1',
        words: [
            { word: 'accommodation', userInput: 'accomodation', errorCount: 1 },
            { word: 'restaurant', userInput: 'resturant', errorCount: 1 }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    await collector.saveVocabList(testList);
    
    // 移除单词
    const removeSuccess = await collector.removeWord('p1', 'accommodation');
    assert.strictEqual(removeSuccess, true, '移除单词应该成功');
    
    // 验证单词已移除
    const updatedList = await collector.loadVocabList('p1');
    assert.strictEqual(updatedList.words.length, 1, '应该只剩1个单词');
    assert.strictEqual(updatedList.words[0].word, 'restaurant', '剩余单词应该是restaurant');
    
    // 尝试移除不存在的单词
    const removeFail = await collector.removeWord('p1', 'nonexistent');
    assert.strictEqual(removeFail, false, '移除不存在的单词应该返回false');
    
    console.log('  ✓ 移除单词正确');
}

/**
 * 测试：清空词表
 */
async function testClearList() {
    console.log('测试: 清空词表');
    
    const collector = new window.SpellingErrorCollector();
    await collector.ensureInitialized();
    
    // 先添加一些单词
    const testList = {
        id: 'p1',
        name: 'P1 拼写错误词表',
        source: 'p1',
        words: [
            { word: 'accommodation', userInput: 'accomodation', errorCount: 1 },
            { word: 'restaurant', userInput: 'resturant', errorCount: 1 }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    await collector.saveVocabList(testList);
    
    // 清空词表
    const clearSuccess = await collector.clearList('p1');
    assert.strictEqual(clearSuccess, true, '清空词表应该成功');
    
    // 验证词表已清空
    const clearedList = await collector.loadVocabList('p1');
    assert.strictEqual(clearedList.words.length, 0, '词表应该为空');
    
    console.log('  ✓ 清空词表正确');
}

// ============================================================================
// 运行所有测试
// ============================================================================

async function runTests() {
    console.log('\n=== SpellingErrorCollector 单元测试 ===\n');
    
    try {
        // 同步测试
        testLevenshteinDistance();
        testIsWord();
        testIsSimilarSpelling();
        testIsSpellingError();
        testDetectSource();
        
        // 异步测试
        await testDetectErrors();
        await testVocabListSaveAndLoad();
        await testMergeErrorsToList();
        await testSaveErrors();
        await testRemoveWord();
        await testClearList();
        
        console.log('\n✅ 所有测试通过\n');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

runTests();
