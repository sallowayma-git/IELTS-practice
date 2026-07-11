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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHarness() {
    const records = [{
        id: 'existing-1',
        examId: 'reading-p1',
        title: 'Existing',
        startTime: '2026-05-20T10:00:00.000Z',
        endTime: '2026-05-20T10:10:00.000Z',
        duration: 600,
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1
    }];
    const meta = new Map();
    meta.set('exam_index', [{ id: 'exam-A', title: 'A' }]);
    meta.set('storage_version', '0.6.2-form');
    let userStats = { totalPractices: 1, totalTimeSpent: 600 };
    const calls = [];

    const storage = {
        async get(key, fallback = null) {
            calls.push({ type: 'storage.get', key });
            return meta.has(key) ? clone(meta.get(key)) : clone(fallback);
        },
        async set(key, value) {
            calls.push({ type: 'storage.set', key, value: clone(value) });
            meta.set(key, clone(value));
            return true;
        }
    };

    const quietConsole = {
        log() {}, warn() {}, error() {}, info() {}, debug() {}
    };

    const sandboxWindow = {
        console: quietConsole,
        PracticeRecordAPI: {
            async list() {
                calls.push({ type: 'api.list' });
                return clone(records);
            },
            async restoreRecords(nextRecords, options = {}) {
                calls.push({ type: 'api.restoreRecords', options: clone(options) });
                records.splice(0, records.length, ...(Array.isArray(nextRecords) ? clone(nextRecords) : []));
                if (options && options.stats && typeof options.stats === 'object') {
                    userStats = clone(options.stats);
                }
                return { restoredCount: records.length, statsRestored: Boolean(options && options.stats) };
            },
            async readStats() {
                calls.push({ type: 'api.readStats' });
                return clone(userStats);
            },
            async resetStats(stats = null) {
                calls.push({ type: 'api.resetStats' });
                userStats = stats ? clone(stats) : {};
                return clone(userStats);
            }
        }
    };

    const sandbox = {
        window: sandboxWindow,
        storage,
        console: quietConsole,
        setInterval: () => 0,
        clearInterval: () => {},
        setTimeout,
        clearTimeout,
        Date,
        Math,
        JSON
    };
    sandboxWindow.storage = storage;
    sandbox.globalThis = sandboxWindow;
    const context = vm.createContext(sandbox);
    loadScript('js/core/backupAPI.js', context);

    return {
        BackupAPI: sandboxWindow.BackupAPI,
        records,
        calls,
        meta,
        getUserStats: () => clone(userStats),
        setUserStats: (next) => { userStats = clone(next); }
    };
}

async function testCreateCapturesDualSchemaAndExamIndex() {
    const harness = createHarness();
    const backupId = await harness.BackupAPI.create({ type: 'manual' });
    assert(backupId, 'create 应返回 backup id');

    const backups = harness.meta.get('manual_backups');
    assert.strictEqual(backups.length, 1);
    assert.strictEqual(backups[0].type, 'manual');
    const data = backups[0].data;
    assert.ok(Array.isArray(data.practice_records), '应写 practice_records');
    assert.ok(Array.isArray(data.practiceRecords), '应写 practiceRecords 双 schema');
    assert.ok(data.user_stats && data.userStats, '应写 user_stats 双 schema');
    assert.ok(Array.isArray(data.exam_index) && data.exam_index[0].id === 'exam-A', '应抓 exam_index');
    assert.strictEqual(data.storage_version, '0.6.2-form');
    assert(harness.calls.some(c => c.type === 'api.list'), 'create 应经 PracticeRecordAPI.list');
    assert(harness.calls.some(c => c.type === 'api.readStats'), 'create 应经 PracticeRecordAPI.readStats');
}

async function testRestoreRestoresRecordsStatsAndExamIndex() {
    const harness = createHarness();
    const backupId = await harness.BackupAPI.create({ type: 'pre_import' });

    harness.records.splice(0, harness.records.length, {
        id: 'mutated',
        examId: 'x',
        startTime: '2026-05-21T00:00:00.000Z',
        duration: 1
    });
    harness.setUserStats({ totalPractices: 99 });
    harness.meta.set('exam_index', [{ id: 'exam-B', title: 'B' }]);

    await harness.BackupAPI.restore(backupId);

    assert.deepStrictEqual(harness.records.map(r => r.id), ['existing-1']);
    assert.strictEqual(harness.getUserStats().totalPractices, 1);
    assert.strictEqual(harness.meta.get('exam_index')[0].id, 'exam-A');
    assert(harness.calls.some(c => c.type === 'api.restoreRecords'), 'restore 应走 PracticeRecordAPI.restoreRecords');
}

async function testPruneKeepsNewestFirst() {
    const harness = createHarness();
    await harness.BackupAPI.create({ id: 'b1', type: 'manual' });
    await harness.BackupAPI.create({ id: 'b2', type: 'manual' });
    await harness.BackupAPI.create({ id: 'b3', type: 'manual' });
    await harness.BackupAPI.prune(2);
    const backups = harness.meta.get('manual_backups');
    assert.strictEqual(backups.length, 2);
    assert.strictEqual(backups[0].id, 'b3', '最新应在头部');
    assert.strictEqual(backups[1].id, 'b2');
}

async function testScoreStorageStyleCreateViaApi() {
    const harness = createHarness();
    const id = await harness.BackupAPI.create({
        id: 'score_backup_1',
        type: 'score_storage',
        data: {
            practiceRecords: [{ id: 'r1', examId: 'e1' }],
            userStats: { totalPractices: 3 },
            storageVersion: '1.0.0'
        }
    });
    assert.strictEqual(id, 'score_backup_1');
    const backup = await harness.BackupAPI.getById(id);
    assert.ok(Array.isArray(backup.data.practice_records));
    assert.ok(backup.data.user_stats);
    assert.strictEqual(backup.data.storage_version, '1.0.0');
}

async function main() {
    try {
        await testCreateCapturesDualSchemaAndExamIndex();
        await testRestoreRestoresRecordsStatsAndExamIndex();
        await testPruneKeepsNewestFirst();
        await testScoreStorageStyleCreateViaApi();
        process.stdout.write(JSON.stringify({
            status: 'pass',
            detail: 'BackupAPI 统一 capture/create/restore/prune；双 schema + exam_index'
        }));
    } catch (error) {
        process.stdout.write(JSON.stringify({
            status: 'fail',
            detail: error && error.stack ? error.stack : String(error)
        }));
        process.exit(1);
    }
}

main();
