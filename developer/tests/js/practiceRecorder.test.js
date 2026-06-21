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

const results = [];

function recordResult(name, detail) {
    results.push({ name, detail, timestamp: new Date().toISOString() });
}

async function testManualStatsFailureDoesNotBreakFallbackSave(PracticeRecorder) {
    const savedRecords = [];
    const tempRecords = [];
    const recorder = Object.create(PracticeRecorder.prototype);

    recorder.scoreStorage = null;
    recorder.practiceTypeCache = new Map();
    recorder.practiceRepo = {
        async list() {
            return savedRecords.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async overwrite(records) {
            savedRecords.splice(0, savedRecords.length, ...records.map((record) => JSON.parse(JSON.stringify(record))));
            return true;
        }
    };
    recorder.metaRepo = {
        async get(key, fallback) {
            if (key === 'temp_practice_records') {
                return tempRecords.map((record) => JSON.parse(JSON.stringify(record)));
            }
            return fallback;
        },
        async set(key, value) {
            if (key === 'temp_practice_records') {
                tempRecords.splice(0, tempRecords.length, ...value.map((record) => JSON.parse(JSON.stringify(record))));
            }
            return true;
        }
    };
    recorder.updateUserStats = async () => {
        throw new Error('simulated stats write failure');
    };

    const saved = await recorder.fallbackSavePracticeRecord({
        id: 'record-stat-failure',
        examId: 'reading-p1',
        sessionId: 'session-stat-failure',
        title: 'Stats failure should not break save',
        type: 'reading',
        date: '2026-05-07T00:00:00.000Z',
        startTime: '2026-05-07T00:00:00.000Z',
        endTime: '2026-05-07T00:10:00.000Z',
        duration: 600,
        score: 1,
        totalQuestions: 2,
        correctAnswers: 1,
        accuracy: 0.5,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        metadata: { examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    });

    assert.strictEqual(saved.id, 'record-stat-failure', '降级保存应返回已保存记录');
    assert.strictEqual(savedRecords.length, 1, '主记录应成功落库');
    assert.strictEqual(tempRecords.length, 0, '统计失败不应写入临时恢复队列');
    recordResult('统计失败不反杀降级保存', { savedRecordId: saved.id });
}

async function testFallbackAnswerComparisonKeepsListeningCandidates(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    const comparison = recorder.normalizeAnswerComparison({
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
    recordResult('降级答案比较保留听力候选答案', q12);
}

async function testNormalizeCompletionPayloadKeepsHighlights(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    recorder.normalizeAnswerComparison = (value) => value || {};
    recorder.normalizeAnswerMap = (value) => value || {};
    recorder.buildAnswerDetails = () => ({});
    recorder.convertAnswerMapToArray = () => [];

    const payload = recorder.normalizePracticeCompletePayload({
        examId: 'reading-p1',
        sessionId: 'session-reading-p1',
        duration: 1200,
        answers: { q1: 'A' },
        correctAnswers: { q1: 'A' },
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 },
        highlights: [{ id: 'hl-1', text: 'highlight' }],
        scrollY: 240,
        metadata: { examTitle: 'Passage 1', category: 'P1', type: 'reading' }
    });

    assert(payload, '完成负载应可归一化');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payload.results.highlights)), [{ id: 'hl-1', text: 'highlight' }], '结果层应保留高亮');
    assert.strictEqual(payload.results.scrollY, 240, '结果层应保留滚动位置');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(payload.results.realData.highlights)), [{ id: 'hl-1', text: 'highlight' }], 'realData 应保留高亮');
    recordResult('完成负载保留高亮回灌字段', { highlights: payload.results.highlights, scrollY: payload.results.scrollY });
}

async function testNormalizeCompletionPayloadStripsPollutionKeys(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    recorder.normalizeAnswerComparison = (value) => value || {};
    recorder.normalizeAnswerMap = (value) => value || {};
    recorder.buildAnswerDetails = () => ({});
    recorder.convertAnswerMapToArray = () => [];

    const payload = recorder.normalizePracticeCompletePayload({
        examId: 'reading-pollution-guard',
        sessionId: 'session-pollution-guard',
        duration: 1200,
        answers: { q1: 'A' },
        correctAnswers: { q1: 'A' },
        scoreInfo: JSON.parse('{"correct":1,"total":1,"constructor":{"prototype":{"polluted":true}}}'),
        metadata: JSON.parse('{"examTitle":"Guard","type":"reading","__proto__":{"polluted":true}}'),
        realData: JSON.parse('{"__proto__":{"polluted":true},"questionTypeMap":{"prototype":{"polluted":true}},"highlights":[{"id":"hl-1","text":"highlight"}]}')
    });

    assert(payload, 'pollution guard completion payload should normalize');
    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.results.metadata, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.results.realData, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.results.realData.scoreInfo, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(payload.results.realData.questionTypeMap, 'prototype'), false);
    assert.strictEqual(payload.results.realData.polluted, undefined);

    recordResult('PracticeRecorder normalizes completion payload without pollution keys', {
        metadataKeys: Object.keys(payload.results.metadata),
        realDataKeys: Object.keys(payload.results.realData)
    });
}

async function testFallbackStandardizeStripsPollutionKeys(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    recorder.practiceTypeCache = new Map();
    recorder.generateRecordId = () => 'record-pollution-guard';
    recorder.normalizePracticeType = () => 'reading';
    recorder.inferPracticeType = () => 'reading';
    recorder.inferExamId = (record) => record.examId || record.metadata?.examId || null;
    recorder.normalizeAnswerMap = (value) => value || {};
    recorder.buildAnswerDetails = () => ({});
    recorder.normalizeAnswerComparison = (value) => value || {};
    recorder.convertAnswerMapToArray = () => [];
    recorder.deriveCorrectMapFromDetails = () => ({});

    const record = recorder.standardizeRecordForFallback({
        id: 'record-pollution-guard',
        examId: 'reading-pollution-guard',
        sessionId: 'session-pollution-guard',
        title: 'Fallback Pollution Guard',
        date: '2026-05-07T00:00:00.000Z',
        startTime: '2026-05-07T00:00:00.000Z',
        endTime: '2026-05-07T00:10:00.000Z',
        duration: 600,
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        accuracy: 1,
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        scoreInfo: JSON.parse('{"details":{},"constructor":{"prototype":{"polluted":true}}}'),
        metadata: JSON.parse('{"examTitle":"Guard","type":"reading","__proto__":{"polluted":true}}'),
        realData: JSON.parse('{"__proto__":{"polluted":true},"scoreInfo":{"constructor":{"prototype":{"polluted":true}}}}')
    });

    assert(record, 'fallback record should standardize');
    assert.strictEqual(Object.prototype.polluted, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.metadata, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.realData, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.scoreInfo, 'constructor'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(record.realData.scoreInfo, 'constructor'), false);

    recordResult('PracticeRecorder fallback standardize strips pollution keys', {
        recordId: record.id,
        metadataKeys: Object.keys(record.metadata)
    });
}

async function testRejectedCompletionPayloadStoresOnlySummary(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    let storedValue = null;
    recorder.metaRepo = {
        async get() {
            return [];
        },
        async set(key, value) {
            assert.strictEqual(key, 'rejected_completion_payloads');
            storedValue = JSON.parse(JSON.stringify(value));
            return true;
        }
    };

    await recorder.recordRejectedCompletionPayload(
        {
            examId: 'reading-private-exam',
            sessionId: 'session-private-id',
            originalExamId: 'original-private-exam',
            suiteSessionId: 'suite-private-id',
            metadata: { examTitle: 'Private Exam Title' },
            results: { metadata: { anotherTitle: 'Nested Private Title' } }
        },
        {
            reason: 'missing_active_session',
            resolvedExamId: 'resolved-private-exam',
            candidateExamIds: ['candidate-a', 'candidate-b']
        }
    );

    assert(Array.isArray(storedValue), 'rejected payload audit entry should be stored');
    assert.strictEqual(storedValue.length, 1);
    assert.deepStrictEqual(storedValue[0].context, {
        reason: 'missing_active_session',
        hasResolvedExam: true,
        candidateExamCount: 2
    });
    assert.deepStrictEqual(storedValue[0].payload, {
        type: 'object',
        keyCount: 6,
        hasExamId: true,
        hasSessionId: true,
        hasMetadata: true
    });
    const serialized = JSON.stringify(storedValue);
    assert(!serialized.includes('reading-private-exam'), 'rejected payload audit must not store exam ids');
    assert(!serialized.includes('session-private-id'), 'rejected payload audit must not store session ids');
    assert(!serialized.includes('Private Exam Title'), 'rejected payload audit must not store metadata content');
    assert(!serialized.includes('candidate-a'), 'rejected payload audit must not store candidate exam ids');

    recordResult('Rejected completion payload audit stores only summaries', {
        payload: storedValue[0].payload,
        context: storedValue[0].context
    });
}

async function main() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const windowStub = {
        console: quietConsole,
        dataRepositories: {},
        PracticeCore: null
    };
    const sandbox = {
        window: windowStub,
        console: quietConsole,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        ScoreStorage: function ScoreStorage() {}
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceRecorder.js', context);
    const PracticeRecorder = sandbox.window.PracticeRecorder;

    try {
        await testManualStatsFailureDoesNotBreakFallbackSave(PracticeRecorder);
        await testFallbackAnswerComparisonKeepsListeningCandidates(PracticeRecorder);
        await testNormalizeCompletionPayloadKeepsHighlights(PracticeRecorder);
        await testNormalizeCompletionPayloadStripsPollutionKeys(PracticeRecorder);
        await testFallbackStandardizeStripsPollutionKeys(PracticeRecorder);
        await testRejectedCompletionPayloadStoresOnlySummary(PracticeRecorder);
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
