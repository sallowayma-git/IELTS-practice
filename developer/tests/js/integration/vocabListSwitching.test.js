#!/usr/bin/env node
/**
 * 集成测试：词表切换流程
 * 
 * 测试场景：
 * 1. 词表加载
 * 2. UI更新（模拟）
 * 3. 数据持久化
 * 4. 空词表处理
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
global.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    createElement: () => ({
        addEventListener: () => {},
        appendChild: () => {},
        setAttribute: () => {},
        classList: { add: () => {}, remove: () => {} },
        innerHTML: ''
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

// 加载SpellingErrorCollector
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
eval(fs.readFileSync(path.join(repoRoot, 'js/app/spellingErrorCollector.js'), 'utf8'));

// Mock VocabStore
class MockVocabStore {
    constructor() {
        this.activeList = null;
        this.collector = new window.SpellingErrorCollector();
    }
    
    async loadList(listId) {
        return await this.collector.loadVocabList(listId);
    }
    
    setActiveList(list) {
        this.activeList = list;
    }
    
    async getListWordCount(listId) {
        return await this.collector.getWordCount(listId);
    }
    
    refreshView() {
        // Mock UI refresh
    }
}

// Mock VocabListSwitcher
class MockVocabListSwitcher {
    constructor(vocabStore) {
        this.vocabStore = vocabStore;
        this.currentListId = 'master';
        this.listCounts = {};
    }
    
    async switchList(listId) {
        const list = await this.vocabStore.loadList(listId);
        
        if (!list) {
            throw new Error(`词表不存在: ${listId}`);
        }
        
        this.currentListId = listId;
        this.vocabStore.setActiveList(list);
        
        // 保存用户偏好
        await global.storage.set('vocab_active_list', listId);
        
        return true;
    }
    
    async updateListCounts() {
        const listIds = ['p1', 'p4', 'master', 'custom'];
        
        for (const listId of listIds) {
            const count = await this.vocabStore.getListWordCount(listId);
            this.listCounts[listId] = count;
        }
    }
    
    getCurrentListId() {
        return this.currentListId;
    }
    
    getListCount(listId) {
        return this.listCounts[listId] || 0;
    }
}

// 测试数据
const testData = {
    p1Errors: [
        {
            word: 'accommodation',
            userInput: 'accomodation',
            questionId: 'q1',
            suiteId: 'set1',
            examId: 'listening-p1-test-001',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p1'
        },
        {
            word: 'receive',
            userInput: 'recieve',
            questionId: 'q2',
            suiteId: 'set1',
            examId: 'listening-p1-test-001',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p1'
        }
    ],
    p4Errors: [
        {
            word: 'environment',
            userInput: 'enviroment',
            questionId: 'q1',
            suiteId: 'set1',
            examId: 'listening-p4-test-001',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p4'
        },
        {
            word: 'government',
            userInput: 'goverment',
            questionId: 'q2',
            suiteId: 'set1',
            examId: 'listening-p4-test-001',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p4'
        },
        {
            word: 'development',
            userInput: 'developement',
            questionId: 'q3',
            suiteId: 'set1',
            examId: 'listening-p4-test-001',
            timestamp: Date.now(),
            errorCount: 1,
            source: 'p4'
        }
    ]
};

// 测试套件
async function runTests() {
    const results = [];
    
    try {
        const collector = new window.SpellingErrorCollector();
        await collector.ensureInitialized();
        
        const vocabStore = new MockVocabStore();
        const switcher = new MockVocabListSwitcher(vocabStore);
        
        // 准备测试数据
        await collector.saveErrors(testData.p1Errors);
        await collector.saveErrors(testData.p4Errors);
        
        // 测试1: 词表加载
        console.log('测试1: 词表加载');
        const p1List = await vocabStore.loadList('p1');
        assert.ok(p1List, 'P1词表应该存在');
        assert.strictEqual(p1List.words.length, 2, 'P1词表应该有2个单词');
        
        const p4List = await vocabStore.loadList('p4');
        assert.ok(p4List, 'P4词表应该存在');
        assert.strictEqual(p4List.words.length, 3, 'P4词表应该有3个单词');
        
        results.push({ name: '词表加载', status: 'pass' });
        
        // 测试2: 词表切换
        console.log('测试2: 词表切换');
        await switcher.switchList('p1');
        assert.strictEqual(switcher.getCurrentListId(), 'p1', '当前词表应该是p1');
        assert.ok(vocabStore.activeList, '应该设置活动词表');
        assert.strictEqual(vocabStore.activeList.id, 'p1', '活动词表ID应该是p1');
        
        results.push({ name: '词表切换', status: 'pass' });
        
        // 测试3: 用户偏好保存
        console.log('测试3: 用户偏好保存');
        const savedPreference = await global.storage.get('vocab_active_list');
        assert.strictEqual(savedPreference, 'p1', '应该保存用户偏好');
        
        results.push({ name: '用户偏好保存', status: 'pass' });
        
        // 测试4: 切换到P4词表
        console.log('测试4: 切换到P4词表');
        await switcher.switchList('p4');
        assert.strictEqual(switcher.getCurrentListId(), 'p4', '当前词表应该是p4');
        assert.strictEqual(vocabStore.activeList.id, 'p4', '活动词表ID应该是p4');
        assert.strictEqual(vocabStore.activeList.words.length, 3, 'P4词表应该有3个单词');
        
        results.push({ name: '切换到P4词表', status: 'pass' });
        
        // 测试5: 切换到综合词表
        console.log('测试5: 切换到综合词表');
        await switcher.switchList('master');
        assert.strictEqual(switcher.getCurrentListId(), 'master', '当前词表应该是master');
        assert.ok(vocabStore.activeList.words.length >= 5, '综合词表应该包含所有单词');
        
        results.push({ name: '切换到综合词表', status: 'pass' });
        
        // 测试6: 词表计数更新
        console.log('测试6: 词表计数更新');
        await switcher.updateListCounts();
        
        assert.strictEqual(switcher.getListCount('p1'), 2, 'P1词表计数应该是2');
        assert.strictEqual(switcher.getListCount('p4'), 3, 'P4词表计数应该是3');
        assert.ok(switcher.getListCount('master') >= 5, '综合词表计数应该>=5');
        assert.strictEqual(switcher.getListCount('custom'), 0, '自定义词表计数应该是0');
        
        results.push({ name: '词表计数更新', status: 'pass' });
        
        // 测试7: 空词表处理
        console.log('测试7: 空词表处理');
        try {
            await switcher.switchList('custom');
            // 如果词表不存在，应该抛出错误
            // 但如果自动创建了空词表，也是可以的
            const customList = await vocabStore.loadList('custom');
            if (customList) {
                assert.strictEqual(customList.words.length, 0, '自定义词表应该为空');
            }
            results.push({ name: '空词表处理', status: 'pass' });
        } catch (error) {
            // 如果抛出错误，检查错误消息
            if (error.message.includes('词表不存在')) {
                results.push({ name: '空词表处理', status: 'pass' });
            } else {
                throw error;
            }
        }
        
        // 测试8: 切换到不存在的词表
        console.log('测试8: 切换到不存在的词表');
        try {
            await switcher.switchList('nonexistent');
            results.push({
                name: '切换到不存在的词表',
                status: 'fail',
                error: '应该抛出错误'
            });
        } catch (error) {
            assert.ok(error.message.includes('词表不存在'), '应该抛出词表不存在错误');
            results.push({ name: '切换到不存在的词表', status: 'pass' });
        }
        
        // 测试9: 词表数据完整性
        console.log('测试9: 词表数据完整性');
        await switcher.switchList('p1');
        const p1Data = vocabStore.activeList;
        
        assert.ok(p1Data.id, '词表应该有ID');
        assert.ok(p1Data.name, '词表应该有名称');
        assert.ok(p1Data.source, '词表应该有来源');
        assert.ok(Array.isArray(p1Data.words), '词表应该有单词数组');
        assert.ok(p1Data.createdAt, '词表应该有创建时间');
        assert.ok(p1Data.updatedAt, '词表应该有更新时间');
        assert.ok(p1Data.stats, '词表应该有统计信息');
        
        results.push({ name: '词表数据完整性', status: 'pass' });
        
        // 测试10: 词表单词数据完整性
        console.log('测试10: 词表单词数据完整性');
        const firstWord = p1Data.words[0];
        
        assert.ok(firstWord.word, '单词应该有word字段');
        assert.ok(firstWord.userInput, '单词应该有userInput字段');
        assert.ok(firstWord.questionId, '单词应该有questionId字段');
        assert.ok(firstWord.examId, '单词应该有examId字段');
        assert.ok(firstWord.timestamp, '单词应该有timestamp字段');
        assert.ok(firstWord.errorCount, '单词应该有errorCount字段');
        assert.ok(firstWord.source, '单词应该有source字段');
        
        results.push({ name: '词表单词数据完整性', status: 'pass' });
        
        // 测试11: 多次切换稳定性
        console.log('测试11: 多次切换稳定性');
        for (let i = 0; i < 5; i++) {
            await switcher.switchList('p1');
            await switcher.switchList('p4');
            await switcher.switchList('master');
        }
        
        assert.strictEqual(switcher.getCurrentListId(), 'master', '最终应该在master词表');
        const finalList = vocabStore.activeList;
        assert.ok(finalList, '应该有活动词表');
        assert.ok(finalList.words.length > 0, '词表应该有单词');
        
        results.push({ name: '多次切换稳定性', status: 'pass' });
        
        // 测试12: 词表统计信息更新
        console.log('测试12: 词表统计信息更新');
        await switcher.switchList('p1');
        const p1Stats = vocabStore.activeList.stats;
        
        assert.strictEqual(p1Stats.totalWords, 2, '总单词数应该是2');
        assert.ok(p1Stats.hasOwnProperty('masteredWords'), '应该有已掌握单词数');
        assert.ok(p1Stats.hasOwnProperty('reviewingWords'), '应该有复习中单词数');
        
        results.push({ name: '词表统计信息更新', status: 'pass' });
        
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
