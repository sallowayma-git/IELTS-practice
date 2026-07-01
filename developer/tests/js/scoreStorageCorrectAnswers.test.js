#!/usr/bin/env node
'use strict';

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const results = [];

function loadScoreStorageHarness() {
    const windowStub = {
        AnswerMatchCore: {
            compareAnswers(userAnswer, correctAnswer) {
                return String(userAnswer || '').trim().toLowerCase() === String(correctAnswer || '').trim().toLowerCase();
            }
        }
    };
    const sandbox = {
        window: windowStub,
        console: {
            log() {},
            warn() {},
            error() {},
            info() {},
            debug() {}
        },
        Date,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/scoreStorage.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/core/scoreStorage.js' });

    const scoreStorage = Object.create(windowStub.ScoreStorage.prototype);
    scoreStorage.currentVersion = 'test-version';
    scoreStorage.maxRecords = 1000;
    scoreStorage.windowStub = windowStub;
    return scoreStorage;
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function createConflictRecord() {
    return {
        id: 'score-storage-correct-map',
        examId: 'reading-score-storage',
        type: 'reading',
        answers: { q1: 'A', q2: 'D', q3: 'E' },
        correctAnswerMap: { q1: 'A' },
        correctAnswers: { q1: 'B', q2: 'C', q3: 'F' },
        totalQuestions: 3,
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q3: 'E' }
        },
        startTime: '2026-05-24T10:00:00.000Z',
        endTime: '2026-05-24T10:05:00.000Z'
    };
}

async function testFallbackStandardizeRecordCanonicalCorrectMapWins() {
    const scoreStorage = loadScoreStorageHarness();
    const standardized = scoreStorage.standardizeRecord(createConflictRecord());

    assert.strictEqual(standardized.correctAnswers, 2, '对象型 correctAnswers 不能污染 standardizeRecord 数字答对数');
    assert.strictEqual(standardized.score, 2, 'score 应从 canonical 正确答案表和用户答案推导');
    assert.strictEqual(standardized.correctAnswerMap.q1, 'A', 'standardizeRecord 应优先使用 canonical correctAnswerMap');
    assert.strictEqual(standardized.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应先于 legacy correctAnswers 补缺');
    assert.strictEqual(standardized.correctAnswerMap.q3, 'F', 'legacy correctAnswers 只能作为缺失题目的补缺来源');
    assert.strictEqual(standardized.realData.correctAnswers.q1, 'A', 'realData.correctAnswers 应镜像 canonical map');
    assert.strictEqual(standardized.realData.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应镜像 canonical map');

    recordResult('ScoreStorage fallback standardizeRecord canonical correctAnswerMap wins', true, {
        correctAnswerMap: standardized.correctAnswerMap,
        correctAnswers: standardized.correctAnswers
    });
}

async function testNormalizeLegacyRecordCanonicalCorrectMapWins() {
    const scoreStorage = loadScoreStorageHarness();
    const normalized = scoreStorage.normalizeLegacyRecord(createConflictRecord());

    assert.strictEqual(normalized.correctAnswers, 2, 'legacy normalize 不能保留对象型 correctAnswers 到数字字段');
    assert.strictEqual(normalized.correctAnswerMap.q1, 'A', 'legacy normalize 应优先使用 canonical correctAnswerMap');
    assert.strictEqual(normalized.correctAnswerMap.q2, 'D', 'legacy normalize 应使用 realData.correctAnswerMap 补缺');
    assert.strictEqual(normalized.realData.correctAnswers.q1, 'A', 'legacy realData.correctAnswers 应镜像 canonical map');

    recordResult('ScoreStorage normalizeLegacyRecord canonical correctAnswerMap wins', true, {
        correctAnswerMap: normalized.correctAnswerMap,
        correctAnswers: normalized.correctAnswers
    });
}

async function testNormalizeRecordFieldsCanonicalCorrectMapWins() {
    const scoreStorage = loadScoreStorageHarness();
    const normalized = scoreStorage.normalizeRecordFields(createConflictRecord());

    assert.strictEqual(normalized.correctAnswers, 2, 'normalizeRecordFields 不能保留对象型 correctAnswers 到数字字段');
    assert.strictEqual(normalized.correctAnswerMap.q1, 'A', 'normalizeRecordFields 应优先使用 canonical correctAnswerMap');
    assert.strictEqual(normalized.correctAnswerMap.q2, 'D', 'normalizeRecordFields 应使用 realData.correctAnswerMap 补缺');
    assert.strictEqual(normalized.realData.correctAnswers.q1, 'A', 'normalizeRecordFields realData.correctAnswers 应镜像 canonical map');
    assert.strictEqual(normalized.realData.correctAnswerMap.q2, 'D', 'normalizeRecordFields realData.correctAnswerMap 应镜像 canonical map');

    recordResult('ScoreStorage normalizeRecordFields canonical correctAnswerMap wins', true, {
        correctAnswerMap: normalized.correctAnswerMap,
        correctAnswers: normalized.correctAnswers
    });
}

async function testStorageAdapterRecordsAndStatsReadsUsePracticeRecordApiAndRejectWrites() {
    const scoreStorage = loadScoreStorageHarness();
    const calls = [];
    const records = [{ id: 'api-record-a', examId: 'reading-api-a' }];
    const stats = { totalPractices: 1 };

    scoreStorage.repositories = {
        practice: {
            async list() {
                throw new Error('ScoreStorage storage adapter must not raw-list practice records');
            },
            async overwrite() {
                throw new Error('ScoreStorage storage adapter must not raw-overwrite practice records');
            },
            async clear() {
                throw new Error('ScoreStorage storage adapter must not raw-clear practice records');
            }
        },
        meta: {
            async get(key, fallback = null) {
                if (key === 'user_stats') {
                    throw new Error('ScoreStorage storage adapter must not raw-read user_stats');
                }
                calls.push({ type: 'meta.get', key });
                return fallback;
            },
            async set(key, value) {
                if (key === 'user_stats') {
                    throw new Error('ScoreStorage storage adapter must not raw-write user_stats');
                }
                calls.push({ type: 'meta.set', key, value });
                return true;
            },
            async remove(key) {
                if (key === 'user_stats') {
                    throw new Error('ScoreStorage storage adapter must not raw-remove user_stats');
                }
                calls.push({ type: 'meta.remove', key });
                return true;
            }
        },
        backups: {
            async list() {
                calls.push({ type: 'backups.list' });
                return [];
            },
            async saveAll(value) {
                calls.push({ type: 'backups.saveAll', value });
                return true;
            },
            async clear() {
                calls.push({ type: 'backups.clear' });
                return true;
            }
        }
    };

    scoreStorage.storageKeys = {
        practiceRecords: 'practice_records',
        userStats: 'user_stats',
        storageVersion: 'storage_version',
        backupData: 'manual_backups'
    };

    const apiRecords = records.map(record => Object.assign({}, record));
    scoreStorage.windowStub.PracticeRecordAPI = {
        async list() {
            calls.push({ type: 'api.list' });
            return apiRecords.map(record => Object.assign({}, record));
        },
        async replace(nextRecords, options = {}) {
            calls.push({ type: 'api.replace', records: nextRecords.map(record => Object.assign({}, record)), options });
            throw new Error('ScoreStorage adapter must not call PracticeRecordAPI.replace');
        },
        async clear(options = {}) {
            calls.push({ type: 'api.clear', options });
            throw new Error('ScoreStorage adapter must not call PracticeRecordAPI.clear');
        },
        async readStats(options = {}) {
            calls.push({ type: 'api.readStats', fallback: options.fallback });
            return Object.assign({}, stats);
        },
        async writeStats(nextStats) {
            calls.push({ type: 'api.writeStats', stats: Object.assign({}, nextStats) });
            throw new Error('ScoreStorage adapter must not call PracticeRecordAPI.writeStats');
        },
        async resetStats(nextStats = null) {
            calls.push({ type: 'api.resetStats', stats: nextStats });
            throw new Error('ScoreStorage adapter must not call PracticeRecordAPI.resetStats');
        }
    };

    const adapter = scoreStorage.createStorageAdapter();
    const listed = await adapter.get('practice_records', []);
    assert.strictEqual(listed.length, 1, 'adapter.get(practice_records) 应委托 PracticeRecordAPI.list');

    await assert.rejects(
        () => adapter.set('practice_records', [{ id: 'api-record-b', examId: 'reading-api-b' }]),
        /ScoreStorage\.storage\.set\(practice_records\) is disabled/,
        'adapter.set(practice_records) 必须禁用'
    );
    assert.strictEqual(apiRecords[0].id, 'api-record-a', 'adapter.set(practice_records) 不能改 canonical records');

    await assert.rejects(
        () => adapter.remove('practice_records'),
        /ScoreStorage\.storage\.remove\(practice_records\) is disabled/,
        'adapter.remove(practice_records) 必须禁用'
    );
    assert.strictEqual(apiRecords.length, 1, 'adapter.remove(practice_records) 不能清空 canonical records');

    const readStats = await adapter.get('user_stats', { totalPractices: 0 });
    assert.strictEqual(readStats.totalPractices, 1, 'adapter.get(user_stats) 应委托 PracticeRecordAPI.readStats');

    await assert.rejects(
        () => adapter.set('user_stats', { totalPractices: 3 }),
        /ScoreStorage\.storage\.set\(user_stats\) is disabled/,
        'adapter.set(user_stats) 必须禁用'
    );
    assert.strictEqual(stats.totalPractices, 1, 'adapter.set(user_stats) 不能改 canonical stats');

    await assert.rejects(
        () => adapter.remove('user_stats'),
        /ScoreStorage\.storage\.remove\(user_stats\) is disabled/,
        'adapter.remove(user_stats) 必须禁用'
    );
    assert.strictEqual(stats.totalPractices, 1, 'adapter.remove(user_stats) 不能重置 canonical stats');

    assert(!calls.some(call => call.type === 'api.replace'), 'adapter.set(practice_records) 不应调用 PracticeRecordAPI.replace');
    assert(!calls.some(call => call.type === 'api.clear'), 'adapter.remove(practice_records) 不应调用 PracticeRecordAPI.clear');
    assert(!calls.some(call => call.type === 'api.writeStats'), 'adapter.set(user_stats) 不应调用 PracticeRecordAPI.writeStats');
    assert(!calls.some(call => call.type === 'api.resetStats'), 'adapter.remove(user_stats) 不应调用 PracticeRecordAPI.resetStats');
    assert(!calls.some(call => call.type.startsWith('meta.') && call.key === 'user_stats'), 'adapter 不应直接读写 raw user_stats');
    recordResult('ScoreStorage storage adapter records/stats reads use PracticeRecordAPI and writes fail-fast', true, {
        calls: calls.map(call => call.type)
    });
}

async function runAllTests() {
    const tests = [
        testFallbackStandardizeRecordCanonicalCorrectMapWins,
        testNormalizeLegacyRecordCanonicalCorrectMapWins,
        testNormalizeRecordFieldsCanonicalCorrectMapWins,
        testStorageAdapterRecordsAndStatsReadsUsePracticeRecordApiAndRejectWrites
    ];
    for (const testFn of tests) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name, false, { error: error.message, stack: error.stack });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(result => result.passed).length;
    const failedTests = totalTests - passedTests;
    const report = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: { totalTests, passedTests, failedTests },
        failedTests: results.filter(result => !result.passed)
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
}

(async function main() {
    await runAllTests();
    const report = printJsonReport();
    process.exit(report.status === 'pass' ? 0 : 1);
})();
