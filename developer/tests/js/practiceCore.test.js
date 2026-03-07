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
