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
