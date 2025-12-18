#!/usr/bin/env node
/**
 * 集成测试：拼写错误收集流程
 * 
 * 测试场景：
 * 1. 错误检测
 * 2. 词表保存
 * 3. 词表同步
 * 4. 综合词表更新
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
eval(fs.readFileSync(path.join(repoRoot, 'js/app/spellingErrorCollector.js'), 'utf8'));

// 测试数据
const testData = {
    answerComparison: {
        q1: {
            userAnswer: 'accomodation',
            correctAnswer: 'accommodation',
            isCorrect: false
        },
        q2: {
            userAnswer: 'library',
            correctAnswer: 'library',
            isCorrect: true
        },
        q3: {
            userAnswer: 'recieve',
            correctAnswer: 'receive',
            isCorrect: false
        },
        q4: {
            userAnswer: '123',
            correctAnswer: '456',
            isCorrect: false
        },
        q5: {
            userAnswer: 'completely different phrase',
            correctAnswer: 'another phrase',
            isCorrect: false
        }
    },
    suiteId: 'set1',
    examId: 'listening-p1-test-001'
};

// 测试套件
async function runTests() {
    const results = [];
    
    try {
        const collector = new window.SpellingErrorCollector();
        await collector.ensureInitialized();
        
        // 测试1: 错误检测
        console.log('测试1: 错误检测');
        const errors = collector.detectErrors(
            testData.answerComparison,
            testData.suiteId,
            testData.examId
        );
        
        assert.ok(Array.isArray(errors), '应该返回数组');
        assert.strictEqual(errors.length, 2, '应该检测到2个拼写错误（排除数字和短语）');
        
        const errorWords = errors.map(e => e.word);
        assert.ok(errorWords.includes('accommodation'), '应该包含accommodation');
        assert.ok(errorWords.includes('receive'), '应该包含receive');
        
        results.push({ name: '错误检测', status: 'pass' });
        
        // 测试2: 单词过滤
        console.log('测试2: 单词过滤');
        assert.strictEqual(collector.isWord('accommodation'), true, 'accommodation应该是单词');
        assert.strictEqual(collector.isWord('123'), false, '123不应该是单词');
        assert.strictEqual(collector.isWord('a long phrase with many words'), false, '长短语不应该是单词');
        assert.strictEqual(collector.isWord(''), false, '空字符串不应该是单词');
        
        results.push({ name: '单词过滤', status: 'pass' });
        
        // 测试3: 拼写相似度检测
        console.log('测试3: 拼写相似度检测');
        assert.strictEqual(
            collector.isSimilarSpelling('accomodation', 'accommodation'),
            true,
            'accomodation和accommodation应该相似'
        );
        assert.strictEqual(
            collector.isSimilarSpelling('recieve', 'receive'),
            true,
            'recieve和receive应该相似'
        );
        assert.strictEqual(
            collector.isSimilarSpelling('cat', 'dog'),
            false,
            'cat和dog不应该相似'
        );
        assert.strictEqual(
            collector.isSimilarSpelling('Library', 'library'),
            true,
            '大小写不同应该相似'
        );
        
        results.push({ name: '拼写相似度检测', status: 'pass' });
        
        // 测试4: 编辑距离计算
        console.log('测试4: 编辑距离计算');
        assert.strictEqual(collector.levenshteinDistance('cat', 'cat'), 0, '相同字符串距离应该是0');
        assert.strictEqual(collector.levenshteinDistance('cat', 'bat'), 1, '替换一个字符距离应该是1');
        assert.strictEqual(collector.levenshteinDistance('cat', 'cats'), 1, '插入一个字符距离应该是1');
        assert.strictEqual(collector.levenshteinDistance('cats', 'cat'), 1, '删除一个字符距离应该是1');
        
        results.push({ name: '编辑距离计算', status: 'pass' });
        
        // 测试5: 词表保存
        console.log('测试5: 词表保存');
        await collector.saveErrors(errors);
        
        const p1List = await collector.loadVocabList('p1');
        assert.ok(p1List, 'P1词表应该存在');
        assert.strictEqual(p1List.words.length, 2, 'P1词表应该有2个单词');
        
        results.push({ name: '词表保存', status: 'pass' });
        
        // 测试6: 重复单词处理
        console.log('测试6: 重复单词处理');
        const duplicateErrors = [
            {
                word: 'accommodation',
                userInput: 'acommodation',
                questionId: 'q10',
                suiteId: 'set2',
                examId: testData.examId,
                timestamp: Date.now(),
                errorCount: 1,
                source: 'p1'
            }
        ];
        
        await collector.saveErrors(duplicateErrors);
        
        const updatedP1List = await collector.loadVocabList('p1');
        assert.strictEqual(updatedP1List.words.length, 2, 'P1词表应该仍然有2个单词（去重）');
        
        const accommodationError = updatedP1List.words.find(
            w => w.word.toLowerCase() === 'accommodation'
        );
        assert.ok(accommodationError, '应该找到accommodation错误');
        assert.strictEqual(accommodationError.errorCount, 2, '错误次数应该是2');
        
        results.push({ name: '重复单词处理', status: 'pass' });
        
        // 测试7: 综合词表同步
        console.log('测试7: 综合词表同步');
        const masterList = await collector.loadVocabList('master');
        assert.ok(masterList, '综合词表应该存在');
        assert.ok(masterList.words.length >= 2, '综合词表应该包含所有错误');
        
        results.push({ name: '综合词表同步', status: 'pass' });
        
        // 测试8: 来源检测
        console.log('测试8: 来源检测');
        assert.strictEqual(collector.detectSource('listening-p1-test'), 'p1', '应该检测到p1');
        assert.strictEqual(collector.detectSource('listening-p4-test'), 'p4', '应该检测到p4');
        assert.strictEqual(collector.detectSource('100 P1/test'), 'p1', '应该从路径检测到p1');
        assert.strictEqual(collector.detectSource('100 P4/test'), 'p4', '应该从路径检测到p4');
        assert.strictEqual(collector.detectSource('other-test'), 'other', '应该返回other');
        
        results.push({ name: '来源检测', status: 'pass' });
        
        // 测试9: 词表计数
        console.log('测试9: 词表计数');
        const p1Count = await collector.getWordCount('p1');
        assert.strictEqual(p1Count, 2, 'P1词表应该有2个单词');
        
        results.push({ name: '词表计数', status: 'pass' });
        
        // 测试10: 移除单词
        console.log('测试10: 移除单词');
        await collector.removeWord('p1', 'receive');
        
        const afterRemove = await collector.loadVocabList('p1');
        assert.strictEqual(afterRemove.words.length, 1, 'P1词表应该剩1个单词');
        
        const remainingWords = afterRemove.words.map(w => w.word.toLowerCase());
        assert.ok(!remainingWords.includes('receive'), '不应该包含receive');
        assert.ok(remainingWords.includes('accommodation'), '应该仍包含accommodation');
        
        results.push({ name: '移除单词', status: 'pass' });
        
        // 测试11: 清空词表
        console.log('测试11: 清空词表');
        await collector.clearList('p1');
        
        const clearedList = await collector.loadVocabList('p1');
        assert.strictEqual(clearedList.words.length, 0, 'P1词表应该为空');
        
        results.push({ name: '清空词表', status: 'pass' });
        
        // 测试12: P4词表独立性
        console.log('测试12: P4词表独立性');
        const p4Errors = [
            {
                word: 'environment',
                userInput: 'enviroment',
                questionId: 'q1',
                suiteId: 'set1',
                examId: 'listening-p4-test-001',
                timestamp: Date.now(),
                errorCount: 1,
                source: 'p4'
            }
        ];
        
        await collector.saveErrors(p4Errors);
        
        const p4List = await collector.loadVocabList('p4');
        assert.ok(p4List, 'P4词表应该存在');
        assert.strictEqual(p4List.words.length, 1, 'P4词表应该有1个单词');
        assert.strictEqual(p4List.words[0].word, 'environment', 'P4词表应该包含environment');
        
        // P1词表应该仍然为空
        const p1ListAfter = await collector.loadVocabList('p1');
        assert.strictEqual(p1ListAfter.words.length, 0, 'P1词表应该仍然为空');
        
        results.push({ name: 'P4词表独立性', status: 'pass' });
        
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
