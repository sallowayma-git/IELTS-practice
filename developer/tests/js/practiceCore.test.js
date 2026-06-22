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

async function testProtocolRejectsOversizedJson() {
    let oversizedParsed = false;
    const windowStub = {
        console
    };
    const sandbox = {
        window: windowStub,
        console,
        Date,
        Math,
        JSON: {
            parse(value) {
                if (String(value).length > 2 * 1024 * 1024) {
                    oversizedParsed = true;
                }
                return JSON.parse(value);
            },
            stringify(value) {
                return JSON.stringify(value);
            }
        }
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    const PracticeCore = sandbox.window.PracticeCore;
    const oversizedEnvelope = '{"type":"practice_complete","data":"' + 'x'.repeat(2 * 1024 * 1024 + 1) + '"}';

    assert.equal(PracticeCore.protocol.normalizeMessage(oversizedEnvelope), null);
    assert.equal(oversizedParsed, false, 'oversized practice message JSON should be rejected before JSON.parse');

    const practiceCoreSource = fs.readFileSync(path.join(repoRoot, 'js/core/practiceCore.js'), 'utf8');
    assert(
        practiceCoreSource.includes('MAX_PRACTICE_MESSAGE_JSON_LENGTH = 2 * 1024 * 1024') &&
        practiceCoreSource.includes('value.length > MAX_PRACTICE_MESSAGE_JSON_LENGTH'),
        'PracticeCore must size-check string message payloads before parsing JSON'
    );

    recordResult('PracticeCore rejects oversized JSON envelopes before parse', true, {
        maxBytes: 2 * 1024 * 1024
    });
}

async function testCompletionIngestion(PracticeCore) {
    const highlights = [{ id: 'hl-1', scope: 'left', text: 'highlight' }];
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
            highlights,
            scrollY: 360,
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
    assert.deepStrictEqual(JSON.parse(JSON.stringify(record.highlights)), highlights, '单题记录应保留回顾高亮');
    assert.strictEqual(record.scrollY, 360, '单题记录应保留滚动位置');
    recordResult('PracticeCore 完成负载入站', true, { id: record.id, metadata: record.metadata });
}

async function testAnswerComparisonKeepsListeningCandidates(PracticeCore) {
    const comparison = PracticeCore.contracts.normalizeAnswerComparison({
        q12: {
            userAnswer: { value: 'acommodation' },
            correctAnswer: 'accommodation / lodging',
            acceptedAnswers: ['accommodation', { text: 'lodging' }, 'ACCOMMODATION'],
            canonicalAnswer: { label: 'accommodation' },
            isCorrect: false
        }
    });
    const q12 = JSON.parse(JSON.stringify(comparison.q12));

    assert.deepStrictEqual(q12, {
        questionId: 'q12',
        userAnswer: 'acommodation',
        correctAnswer: 'accommodation / lodging',
        isCorrect: false,
        acceptedAnswers: ['accommodation', 'lodging'],
        canonicalAnswer: 'accommodation'
    });
    recordResult('PracticeCore 答案比较保留听力候选答案', true, q12);
}

async function testClonePlainObjectGuardsUntrustedPayloads(PracticeCore) {
    const polluted = JSON.parse('{"safe":"ok","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"prototype":{"polluted":true}}}');
    polluted.nested.text = 'x'.repeat(5000);

    const clone = PracticeCore.contracts.clonePlainObject(polluted);

    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(clone, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(clone, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(clone.nested, 'prototype'), false);
    assert.strictEqual(clone.nested.text.length, 4000);

    const cyclic = { id: 'cycle' };
    cyclic.self = cyclic;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(PracticeCore.contracts.clonePlainObject(cyclic))), { id: 'cycle' });

    const arrayClone = PracticeCore.contracts.clonePlainObject(Array.from({ length: 1100 }, (_, index) => index));
    assert.strictEqual(arrayClone.length, 1000);

    recordResult('PracticeCore clone guards untrusted payloads', true, {
        textLength: clone.nested.text.length,
        arrayLength: arrayClone.length
    });
}

async function testCompletionIngestionStripsPollutionKeys(PracticeCore) {
    const pollutedScoreInfo = JSON.parse('{"correct":1,"total":1,"constructor":{"prototype":{"polluted":true}}}');
    const pollutedRealData = JSON.parse('{"__proto__":{"polluted":true},"answerComparison":{"q1":{"userAnswer":"A","correctAnswer":"A","isCorrect":true,"prototype":{"polluted":true}}}}');

    const record = PracticeCore.ingestor.fromCompletion({
        type: 'practice_complete',
        data: {
            examId: 'reading-pollution-guard',
            sessionId: 'session-pollution-guard',
            title: 'Pollution Guard',
            answers: { q1: 'A' },
            correctAnswers: { q1: 'A' },
            scoreInfo: pollutedScoreInfo,
            realData: pollutedRealData,
            metadata: JSON.parse('{"type":"reading","__proto__":{"polluted":true}}')
        }
    }, {
        metadata: JSON.parse('{"category":"P1","constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}')
    });

    assert(record, 'pollution guard record should be created');
    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.scoreInfo, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.realData, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.metadata, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.metadata, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.metadata, 'prototype'), false);
    assert.strictEqual(record.metadata.category, 'P1');
    assert.strictEqual(record.realData.polluted, undefined);

    recordResult('PracticeCore completion ingestion strips pollution keys', true, {
        recordId: record.id,
        scoreInfoKeys: Object.keys(record.scoreInfo)
    });
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
        await testProtocolRejectsOversizedJson();
        await testCompletionIngestion(PracticeCore);
        await testAnswerComparisonKeepsListeningCandidates(PracticeCore);
        await testClonePlainObjectGuardsUntrustedPayloads(PracticeCore);
        await testCompletionIngestionStripsPollutionKeys(PracticeCore);
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
