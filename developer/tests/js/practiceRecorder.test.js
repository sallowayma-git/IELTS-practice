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

function createPrototypeRecorder(PracticeRecorder) {
    const recorder = Object.create(PracticeRecorder.prototype);
    recorder.scoreStorage = null;
    recorder.practiceTypeCache = new Map();
    recorder.lookupExamIndexEntry = () => null;
    recorder.generateRecordId = () => 'record-generated';
    return recorder;
}

async function testCanonicalCorrectAnswerMapWins(PracticeRecorder) {
    const recorder = createPrototypeRecorder(PracticeRecorder);
    const record = {
        id: 'record-canonical-correct-map',
        examId: 'reading-canonical',
        sessionId: 'session-canonical',
        title: 'Canonical correct map',
        type: 'reading',
        date: '2026-05-10T00:00:00.000Z',
        startTime: '2026-05-10T00:00:00.000Z',
        endTime: '2026-05-10T00:10:00.000Z',
        duration: 600,
        score: 2,
        totalQuestions: 2,
        correctAnswers: { q1: 'B', q2: 'C' },
        correctAnswersCount: 2,
        accuracy: 1,
        answers: { q1: 'A', q2: 'D' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        realData: {
            correctAnswerMap: { q2: 'D', q3: 'E' },
            correctAnswers: { q1: 'B', q2: 'C', q3: 'F' },
            answers: { q1: 'A', q2: 'D', q3: 'E' }
        },
        scoreInfo: {
            correct: 2,
            details: {
                q1: { userAnswer: 'A', correctAnswer: 'B' },
                q3: { userAnswer: 'E', correctAnswer: 'G' }
            }
        },
        metadata: { examTitle: 'Canonical', category: 'P1', frequency: 'high', type: 'reading' }
    };

    const storageReady = recorder.prepareRecordForStorage(record);
    assert.strictEqual(storageReady.correctAnswerMap.q1, 'A', 'canonical correctAnswerMap 应压过对象型 correctAnswers');
    assert.strictEqual(storageReady.correctAnswerMap.q2, 'D', 'realData legacy 不应覆盖顶层 canonical');
    assert.strictEqual(storageReady.correctAnswerMap.q3, 'E', 'realData.correctAnswerMap 应先于 legacy correctAnswers 补缺');
    assert.strictEqual(storageReady.realData.correctAnswers.q1, 'A', 'realData.correctAnswers 应镜像 canonical map');
    assert.strictEqual(storageReady.realData.correctAnswerMap.q3, 'E', 'realData.correctAnswerMap 应镜像 canonical map');

    const standardized = recorder.normalizeRecordForPracticeRecordApi(record);
    assert.strictEqual(standardized.correctAnswers, 2, '对象型 correctAnswers 不能污染数字答对数');
    assert.strictEqual(standardized.correctAnswerMap.q1, 'A', '重试标准化也必须 canonical 优先');
    assert.strictEqual(standardized.correctAnswerMap.q3, 'E', '重试标准化应保留 realData canonical 补缺');
    assert.strictEqual(standardized.realData.correctAnswers.q1, 'A', '重试标准化 realData.correctAnswers 应镜像 canonical');
    assert.strictEqual(standardized.realData.correctAnswerMap.q2, 'D', '重试标准化 realData.correctAnswerMap 应存在');
    recordResult('PracticeRecorder 正确答案表 canonical 优先', { correctAnswerMap: standardized.correctAnswerMap });
}

async function testCompletionPayloadCanonicalCorrectAnswerMapWins(PracticeRecorder) {
    const recorder = createPrototypeRecorder(PracticeRecorder);
    const shaped = recorder.normalizePracticeCompletePayload({
        examId: 'reading-completion-canonical',
        sessionId: 'session-completion-canonical',
        answers: { q1: 'A', q2: 'D' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        correctAnswersCount: 2,
        scoreInfo: {
            correct: 2,
            total: 2,
            details: {
                q1: { userAnswer: 'A', correctAnswer: 'B' }
            }
        },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        }
    });

    assert(shaped, 'completion payload 应能标准化');
    assert.strictEqual(shaped.results.correctAnswers, 2, 'completion 数字 correctAnswers 应来自 count 字段');
    assert.strictEqual(shaped.results.correctAnswerMap.q1, 'A', 'completion canonical map 应压过 legacy map');
    assert.strictEqual(shaped.results.correctAnswerMap.q2, 'D', 'completion canonical map 应保留 q2');
    assert.strictEqual(shaped.results.realData.correctAnswers.q1, 'A', 'completion realData.correctAnswers 应镜像 canonical');
    assert.strictEqual(shaped.results.realData.correctAnswerMap.q2, 'D', 'completion realData.correctAnswerMap 应镜像 canonical');
    recordResult('completion payload 正确答案表 canonical 优先', { correctAnswerMap: shaped.results.correctAnswerMap });
}

async function testRetrySaveUsesPracticeRecordApi(PracticeRecorder, windowStub) {
    const savedRecords = [];
    const tempRecords = [];
    const saveOptions = [];
    const recorder = Object.create(PracticeRecorder.prototype);

    recorder.scoreStorage = null;
    recorder.practiceTypeCache = new Map();
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
        throw new Error('retrySaveWithStandardizedRecord should let PracticeRecordAPI own stats');
    };
    windowStub.PracticeRecordAPI = {
        async saveRecord(record, options = {}) {
            savedRecords.unshift(JSON.parse(JSON.stringify(record)));
            saveOptions.push(JSON.parse(JSON.stringify(options)));
            return record;
        }
    };

    const saved = await recorder.retrySaveWithStandardizedRecord({
        id: 'record-api-retry',
        examId: 'reading-p1',
        sessionId: 'session-api-retry',
        title: 'Retry should use PracticeRecordAPI',
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

    assert.strictEqual(saved.id, 'record-api-retry', '标准化重试保存应返回已保存记录');
    assert.strictEqual(savedRecords.length, 1, '主记录应通过 PracticeRecordAPI 落库');
    assert.strictEqual(saveOptions[0].updateStats, true, '标准化重试保存应让统一 API 负责统计更新');
    assert.strictEqual(tempRecords.length, 0, 'API 保存成功不应写入临时恢复队列');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(savedRecords[0], 'savedBy'), false, '标准化重试不应写入 fallback 标记');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(savedRecords[0], 'fallbackReason'), false, '标准化重试不应写入 fallback 原因');
    recordResult('标准化重试保存走统一 PracticeRecordAPI', { savedRecordId: saved.id });
}

async function testPrimarySaveUsesPracticeRecordApi(PracticeRecorder, windowStub) {
    const savedRecords = [];
    const saveOptions = [];
    const recorder = Object.create(PracticeRecorder.prototype);

    recorder.scoreStorage = {};
    Object.defineProperties(recorder.scoreStorage, {
        currentVersion: {
            get() {
                throw new Error('savePracticeRecord must not read ScoreStorage.currentVersion');
            }
        },
        maxRecords: {
            get() {
                throw new Error('savePracticeRecord must not read ScoreStorage.maxRecords');
            }
        },
        savePracticeRecord: {
            value: async () => {
                throw new Error('savePracticeRecord must not call ScoreStorage directly');
            }
        }
    });
    recorder.practiceTypeCache = new Map();
    recorder.wait = async () => {};
    recorder.isCriticalError = PracticeRecorder.prototype.isCriticalError;
    recorder.prepareRecordForStorage = PracticeRecorder.prototype.prepareRecordForStorage;
    recorder.restoreRecordAnswerState = PracticeRecorder.prototype.restoreRecordAnswerState;
    recorder.buildRecordLogSummary = PracticeRecorder.prototype.buildRecordLogSummary;
    recorder.inferExamId = PracticeRecorder.prototype.inferExamId;
    recorder.lookupExamIndexEntry = () => null;
    recorder.normalizePracticeType = PracticeRecorder.prototype.normalizePracticeType;
    recorder.normalizeAnswerMap = PracticeRecorder.prototype.normalizeAnswerMap;
    recorder.normalizeAnswerComparison = PracticeRecorder.prototype.normalizeAnswerComparison;
    recorder.convertAnswerArrayToMap = PracticeRecorder.prototype.convertAnswerArrayToMap;
    recorder.extractCorrectAnswerMap = PracticeRecorder.prototype.extractCorrectAnswerMap;
    recorder.buildAnswerDetails = PracticeRecorder.prototype.buildAnswerDetails;
    recorder.saveToTemporaryStorage = async () => {
        throw new Error('API primary save success should not write temp queue');
    };

    windowStub.PracticeRecordAPI = {
        async saveRecord(record, options = {}) {
            savedRecords.unshift(JSON.parse(JSON.stringify(record)));
            saveOptions.push(JSON.parse(JSON.stringify(options)));
            return Object.assign({}, record, { savedBy: 'api-primary' });
        },
        async getById(recordId) {
            return savedRecords.find((record) => record.id === recordId || record.sessionId === recordId) || null;
        }
    };

    const saved = await recorder.savePracticeRecord({
        id: 'record-api-primary',
        examId: 'reading-p2',
        sessionId: 'session-api-primary',
        title: 'Primary should use PracticeRecordAPI',
        type: 'reading',
        date: '2026-05-08T00:00:00.000Z',
        startTime: '2026-05-08T00:00:00.000Z',
        endTime: '2026-05-08T00:12:00.000Z',
        duration: 720,
        score: 2,
        totalQuestions: 3,
        correctAnswers: 2,
        accuracy: 2 / 3,
        answers: { q1: 'A', q2: 'B', q3: 'C' },
        correctAnswerMap: { q1: 'A', q2: 'B', q3: 'D' },
        metadata: { examTitle: 'Passage 2', category: 'P2', frequency: 'medium', type: 'reading' }
    });

    assert.strictEqual(saved.id, 'record-api-primary', '正常保存应返回 API 保存记录');
    assert.strictEqual(saved.savedBy, 'api-primary', '正常保存应使用 PracticeRecordAPI 返回值');
    assert.strictEqual(savedRecords.length, 1, '正常保存应通过 PracticeRecordAPI 落库');
    assert.strictEqual(saveOptions[0].updateStats, true, '正常保存应让统一 API 负责统计更新');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saveOptions[0], 'currentVersion'), false, '正常保存不应从 ScoreStorage 透传版本');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(saveOptions[0], 'maxRecords'), false, '正常保存不应从 ScoreStorage 透传容量');
    recordResult('正常保存走统一 PracticeRecordAPI', { savedRecordId: saved.id });
}

async function testLegacyDataMethodsUseUnifiedAdapters(PracticeRecorder, windowStub) {
    const recorder = Object.create(PracticeRecorder.prototype);
    const calls = [];
    const records = [
        {
            id: 'record-export-a',
            examId: 'reading-export-a',
            sessionId: 'session-export-a',
            title: 'Export Passage',
            type: 'reading',
            date: '2026-05-09T00:00:00.000Z',
            startTime: '2026-05-09T00:00:00.000Z',
            endTime: '2026-05-09T00:05:00.000Z',
            duration: 300,
            score: 1,
            totalQuestions: 2,
            correctAnswers: 1,
            accuracy: 0.5,
            metadata: { category: 'P1', frequency: 'high', examTitle: 'Export Passage' }
        }
    ];
    const stats = {
        totalPractices: 1,
        totalTimeSpent: 300,
        averageScore: 0.5,
        categoryStats: {},
        questionTypeStats: {},
        streakDays: 1,
        practiceDays: ['2026-05-09'],
        lastPracticeDate: '2026-05-09',
        achievements: []
    };

    recorder.scoreStorage = {
        async savePracticeRecord() {
            throw new Error('legacy data methods must not save through ScoreStorage');
        },
        async getUserStats() {
            throw new Error('getUserStats must use PracticeRecordAPI.readStats');
        },
        exportData() {
            throw new Error('exportData must use PracticeRecordAPI');
        },
        importData() {
            throw new Error('importData must use DataBackupManager');
        },
        createBackup() {
            throw new Error('createBackup must use DataBackupManager');
        },
        restoreBackup() {
            throw new Error('restoreBackup must use DataBackupManager');
        }
    };

    windowStub.PracticeRecordAPI = {
        async list() {
            calls.push({ method: 'list' });
            return JSON.parse(JSON.stringify(records));
        },
        async readStats(options = {}) {
            calls.push({ method: 'readStats', fallback: options.fallback });
            return JSON.parse(JSON.stringify(stats));
        },
        getDefaultStats() {
            return {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                practiceDays: [],
                lastPracticeDate: null,
                achievements: []
            };
        }
    };
    windowStub.DataBackupManager = class FakeDataBackupManager {
        importPracticeData(data, options = {}) {
            calls.push({ method: 'importPracticeData', data, options });
            return { imported: true, options };
        }

        createBackup(backupName, type) {
            calls.push({ method: 'createBackup', backupName, type });
            return 'backup-created';
        }

        restoreBackup(backupId) {
            calls.push({ method: 'restoreBackup', backupId });
            return { restored: backupId };
        }
    };

    const loadedStats = await recorder.getUserStats();
    assert.deepStrictEqual(loadedStats, stats, 'getUserStats 应通过 PracticeRecordAPI.readStats');

    const exported = JSON.parse(await recorder.exportData('json'));
    assert.strictEqual(exported.version, '1.0.0', 'JSON 导出应使用稳定导出版本');
    assert.deepStrictEqual(exported.practiceRecords, records, 'JSON 导出应通过 PracticeRecordAPI.list');
    assert.deepStrictEqual(exported.userStats, stats, 'JSON 导出应通过 PracticeRecordAPI.readStats');

    const csv = await recorder.exportData('csv');
    assert(csv.includes('record-export-a'), 'CSV 导出应序列化 PracticeRecordAPI 记录');

    const importResult = await recorder.importData({ practice_records: records }, { merge: false });
    assert.strictEqual(importResult.imported, true, 'importData 应委托 DataBackupManager');
    assert.strictEqual(importResult.options.mergeMode, 'replace', 'merge=false 应转换为 replace mergeMode');

    const backupId = recorder.createBackup('legacy-backup');
    assert.strictEqual(backupId, 'backup-created', 'createBackup 应委托 DataBackupManager');
    const restored = recorder.restoreBackup('backup-created');
    assert.deepStrictEqual(restored, { restored: 'backup-created' }, 'restoreBackup 应委托 DataBackupManager');
    assert(calls.some((call) => call.method === 'createBackup' && call.type === 'practice_recorder'), 'createBackup 应标记 practice_recorder 来源');
    recordResult('公开数据方法走统一适配器', { calls: calls.map((call) => call.method) });
}

async function main() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const windowStub = {
        console: quietConsole,
        dataRepositories: {}
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
    loadScript('js/core/practiceCore.js', context);
    loadScript('js/core/practiceRecorder.js', context);
    const PracticeRecorder = sandbox.window.PracticeRecorder;

    try {
        await testCanonicalCorrectAnswerMapWins(PracticeRecorder);
        await testCompletionPayloadCanonicalCorrectAnswerMapWins(PracticeRecorder);
        await testPrimarySaveUsesPracticeRecordApi(PracticeRecorder, windowStub);
        await testRetrySaveUsesPracticeRecordApi(PracticeRecorder, windowStub);
        await testLegacyDataMethodsUseUnifiedAdapters(PracticeRecorder, windowStub);
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
