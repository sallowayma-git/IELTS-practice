#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const source = fs.readFileSync(path.join(repoRoot, 'js/utils/dataBackupManager.js'), 'utf8');

function createContext() {
    const store = new Map();
    const storage = {
        async get(key, fallback) { return store.has(key) ? store.get(key) : fallback; },
        async set(key, value) { store.set(key, value); }
    };
    const context = {
        console,
        setInterval() { return 1; },
        clearInterval() {},
        URL,
        window: {
            crypto: webcrypto,
            location: {
                href: 'http://127.0.0.1:3000/index.html',
                origin: 'http://127.0.0.1:3000'
            }
        },
        storage,
        fetchCalls: []
    };
    context.fetch = async (url, options) => {
        context.fetchCalls.push({ url, options });
        return {
            ok: true,
            headers: {
                get(name) {
                    return String(name).toLowerCase() === 'content-length' ? '22' : null;
                }
            },
            async text() {
                return '{"practiceRecords":[]}';
            }
        };
    };
    context.window.storage = storage;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'js/utils/dataBackupManager.js' });
    return context;
}

const context = createContext();
const manager = new context.window.DataBackupManager();

await assert.rejects(
    () => manager.importPracticeData(null, { createBackup: false }),
    (error) => {
        assert.equal(error.message, 'Failed to read import source.');
        assert.deepEqual(error.cause, { name: 'Error' });
        return true;
    }
);

await assert.rejects(
    () => manager.importPracticeData(undefined, { createBackup: false }),
    (error) => {
        assert.equal(error.message, 'Failed to read import source.');
        assert.deepEqual(error.cause, { name: 'Error' });
        return true;
    }
);

await assert.rejects(
    () => manager.parseImportSource('https://example.com/records.json', { allowFetch: true }),
    /invalid or untrusted/
);
assert.equal(context.fetchCalls.length, 0);

const payload = await manager.parseImportSource('/records.json', { allowFetch: true });
assert.deepEqual(payload, { practiceRecords: [] });
assert.equal(context.fetchCalls.length, 1);
assert.equal(context.fetchCalls[0].url, 'http://127.0.0.1:3000/records.json');
assert.deepEqual(context.fetchCalls[0].options, {
    credentials: 'same-origin',
    cache: 'no-store'
});

await assert.rejects(
    () => manager.parseImportSource('http://127.0.0.1:3001/records.json', { allowFetch: true }),
    /invalid or untrusted/
);
assert.equal(context.fetchCalls.length, 1);

await context.storage.set('backup_settings', JSON.parse(`{
    "autoBackup": false,
    "backupInterval": 0,
    "maxBackups": 1000,
    "compressionEnabled": true,
    "encryptionEnabled": "yes",
    "lastAutoBackup": "2026-01-01T00:00:00.000Z",
    "__proto__": { "pollutedSettings": true },
    "constructor": { "prototype": { "pollutedSettings": true } }
}`));
await manager.initializeSettings();
const normalizedSettings = await context.storage.get('backup_settings', {});
assert.deepEqual(normalizedSettings, {
    autoBackup: false,
    backupInterval: 24,
    maxBackups: 100,
    compressionEnabled: true,
    encryptionEnabled: false,
    lastAutoBackup: '2026-01-01T00:00:00.000Z'
});
assert.equal(Object.prototype.hasOwnProperty.call(normalizedSettings, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(normalizedSettings, 'constructor'), false);
assert.equal(Object.prototype.pollutedSettings, undefined);

const sampleRecord = {
    id: 'record-1',
    examId: 'reading-1',
    status: 'completed',
    startTime: '2026-01-01T00:00:00.000Z'
};
const normalized = manager.normalizeImportPayload({ practiceRecords: [sampleRecord] });
assert.equal(normalized.practiceRecords.length, 1);
assert.equal(normalized.sources.length, 1);

const pollutedPayload = JSON.parse(`{
    "practiceRecords": [{
        "id": "polluted-record",
        "examId": "reading-1",
        "status": "completed",
        "startTime": "2026-01-01T00:00:00.000Z",
        "__proto__": { "polluted": true },
        "constructor": { "prototype": { "polluted": true } },
        "metadata": {
            "title": "Safe title",
            "__proto__": { "nestedPolluted": true },
            "prototype": { "nestedPolluted": true }
        },
        "realData": {
            "duration": 60,
            "__proto__": { "nestedPolluted": true }
        }
    }],
    "userStats": {
        "totalPractice": 1,
        "__proto__": { "statsPolluted": true },
        "constructor": { "prototype": { "statsPolluted": true } }
    }
}`);
const safeImport = manager.normalizeImportPayload(pollutedPayload);
assert.equal(Object.prototype.polluted, undefined);
assert.equal(Object.prototype.nestedPolluted, undefined);
assert.equal(Object.prototype.statsPolluted, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(safeImport.practiceRecords[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(safeImport.practiceRecords[0], 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(safeImport.practiceRecords[0].metadata, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(safeImport.practiceRecords[0].metadata, 'prototype'), false);
assert.equal(Object.prototype.hasOwnProperty.call(safeImport.practiceRecords[0].realData, '__proto__'), false);

await context.storage.set('practice_records', []);
const legacyRecordsPayload = JSON.parse(`{
    "records": [{
        "id": "legacy-record",
        "examId": "reading-legacy",
        "title": "Legacy import",
        "status": "completed",
        "startTime": "2026-01-01T00:00:00.000Z",
        "__proto__": { "pollutedFallback": true },
        "constructor": { "prototype": { "pollutedFallback": true } },
        "metadata": {
            "category": "reading",
            "__proto__": { "pollutedFallback": true },
            "constructor": { "prototype": { "pollutedFallback": true } }
        },
        "realData": {
            "duration": 90,
            "prototype": { "pollutedFallback": true }
        }
    }]
}`);
const legacyImportResult = await manager.importPracticeData(legacyRecordsPayload, {
    createBackup: false,
    mergeMode: 'replace'
});
assert.equal(legacyImportResult.importedCount, 1);
const legacyStoredRecords = await context.storage.get('practice_records', []);
assert.equal(legacyStoredRecords.length, 1);
assert.equal(legacyStoredRecords[0].id, 'legacy-record');
assert.equal(legacyStoredRecords[0].examId, 'reading-legacy');
assert.equal(legacyStoredRecords[0].metadata.category, 'reading');
assert.equal(legacyStoredRecords[0].realData.duration, 90);
assert.equal(Object.prototype.hasOwnProperty.call(legacyStoredRecords[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(legacyStoredRecords[0], 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(legacyStoredRecords[0].metadata, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(legacyStoredRecords[0].metadata, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(legacyStoredRecords[0].realData, 'prototype'), false);
assert.equal(Object.prototype.pollutedFallback, undefined);

await assert.rejects(
    () => manager.importPracticeData({
        records: Array.from({ length: 5001 }, (_, index) => ({
            id: `legacy-${index}`,
            examId: `reading-${index}`,
            status: 'completed',
            startTime: '2026-01-01T00:00:00.000Z'
        }))
    }, { createBackup: false }),
    /too many practice records/
);

const nestedUnsafePayload = JSON.parse(`{
    "practiceRecords": [{
        "id": "${'x'.repeat(700)}",
        "examId": "${'reading-long-'.repeat(80)}",
        "title": "${'Long title '.repeat(80)}",
        "status": "${'completed-'.repeat(20)}",
        "metadata": {
            "notes": "${'metadata note '.repeat(600)}",
            "safe": {
                "constructor": { "prototype": { "polluted": true } },
                "child": { "prototype": { "polluted": true } }
            }
        },
        "realData": {
            "items": ${JSON.stringify(Array.from({ length: 700 }, (_, index) => index))},
            "nested": {
                "level1": {
                    "level2": {
                        "level3": {
                            "constructor": { "prototype": { "polluted": true } }
                        }
                    }
                }
            }
        }
    }]
}`);
const boundedImport = manager.normalizeImportPayload(nestedUnsafePayload);
const boundedRecord = boundedImport.practiceRecords[0];
assert.equal(Object.prototype.polluted, undefined);
assert.equal(boundedRecord.id.length, 512);
assert.equal(boundedRecord.examId.length, 512);
assert.equal(boundedRecord.title.length, 500);
assert.equal(boundedRecord.status.length, 64);
assert.equal(boundedRecord.metadata.notes.length, 5000);
assert.equal(boundedRecord.realData.items.length, 500);
assert.equal(Object.prototype.hasOwnProperty.call(boundedRecord.metadata.safe, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(boundedRecord.metadata.safe.child, 'prototype'), false);
assert.equal(Object.prototype.hasOwnProperty.call(boundedRecord.realData.nested.level1.level2.level3, 'constructor'), false);

const circularRecord = {
    id: 'export-record',
    examId: 'reading-export',
    title: 'IELTS Listening Practice - Part 1: Exported title',
    status: 'completed',
    score: Infinity,
    password: 'secret-password',
    accessToken: 'secret-access-token',
    metadata: JSON.parse(`{
        "safe": "yes",
        "category": "reading",
        "csrfToken": "secret-csrf-token",
        "__proto__": { "pollutedExport": true },
        "constructor": { "prototype": { "pollutedExport": true } }
    }`),
    realData: {
        count: 123n,
        totpSecret: 'secret-totp-value',
        recoveryCodes: ['secret-recovery-code'],
        nested: {
            ok: true,
            accessToken: 'secret-nested-token'
        }
    }
};
circularRecord.realData.self = circularRecord.realData;
const circularStats = {
    totalPractice: 1,
    largest: 123n,
    nested: {}
};
circularStats.nested.self = circularStats.nested;
const circularBackup = {
    id: 'backup-circular',
    data: {}
};
circularBackup.data.self = circularBackup.data;
context.window.practiceRecorder = {
    getPracticeRecords() {
        return [circularRecord];
    },
    getUserStats() {
        return circularStats;
    },
    getBackups() {
        return [circularBackup];
    }
};
const exportResult = await manager.exportPracticeRecords({
    includeStats: true,
    includeBackups: true,
    categories: ['reading']
});
const exportedPayload = JSON.parse(exportResult.data);
assert.equal(exportedPayload.practiceRecords.length, 1);
assert.equal(exportedPayload.practiceRecords[0].title, 'Exported title');
assert.equal(exportedPayload.practiceRecords[0].score, undefined);
assert.equal(exportedPayload.practiceRecords[0].password, undefined);
assert.equal(exportedPayload.practiceRecords[0].accessToken, undefined);
assert.equal(exportedPayload.practiceRecords[0].metadata.safe, 'yes');
assert.equal(exportedPayload.practiceRecords[0].metadata.csrfToken, undefined);
assert.equal(exportedPayload.practiceRecords[0].realData.count, undefined);
assert.equal(exportedPayload.practiceRecords[0].realData.totpSecret, undefined);
assert.equal(exportedPayload.practiceRecords[0].realData.recoveryCodes, undefined);
assert.equal(exportedPayload.practiceRecords[0].realData.nested.accessToken, undefined);
assert.equal(exportedPayload.practiceRecords[0].realData.self, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(exportedPayload.practiceRecords[0].metadata, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(exportedPayload.practiceRecords[0].metadata, 'constructor'), false);
assert.equal(exportedPayload.userStats.totalPractice, 1);
assert.equal(exportedPayload.userStats.largest, undefined);
assert.equal(exportedPayload.userStats.nested.self, undefined);
assert.equal(exportedPayload.backups.length, 1);
assert.equal(exportedPayload.backups[0].data.self, undefined);
assert(!JSON.stringify(exportedPayload).includes('secret-'));
assert.equal(Object.prototype.pollutedExport, undefined);
delete context.window.practiceRecorder;

const wideRecord = {
    id: 'wide-record',
    examId: 'reading-wide',
    status: 'completed',
    startTime: '2026-01-01T00:00:00.000Z',
    ...Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`extra_${index}`, `value-${index}`]))
};
const wideStats = {
    totalPractice: 3,
    totalTimeSpent: 120,
    nestedStats: {
        values: Array.from({ length: 700 }, (_, index) => index)
    },
    ...Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`stats_key_${index}`, `value-${index}`]))
};
const wideImport = manager.normalizeImportPayload({
    practiceRecords: [wideRecord],
    userStats: wideStats
});
const normalizedWideRecord = wideImport.practiceRecords[0];
assert.equal(normalizedWideRecord.extra_999, undefined);
assert(Object.keys(normalizedWideRecord).length <= 210);
assert.equal(wideImport.userStats.totalPractice, 3);
assert.equal(wideImport.userStats.practiceRecords, undefined);
assert.equal(wideImport.userStats.userStats, undefined);
assert.equal(wideImport.userStats.statsKey999, undefined);
assert.equal(wideImport.userStats.nestedStats.values.length, 500);
assert(Object.keys(wideImport.userStats).length <= 200);

await manager.mergeUserStats(wideStats, 'replace');
const storedStats = await context.storage.get('user_stats', {});
assert.equal(storedStats.stats_key_999, undefined);
assert(Object.keys(storedStats).length <= 200);

assert.equal(manager.normalizeDateValue(Number.MAX_VALUE), null);
assert.equal(manager.normalizeDateValue(String(Number.MAX_VALUE)), null);

const currentHistoryTimestamp = new Date().toISOString();
const expiredHistoryTimestamp = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();
const unsafeHistoryEntry = JSON.parse(`{
    "id": "unsafe-history",
    "timestamp": "${currentHistoryTimestamp}",
    "success": true,
    "error": "${'x'.repeat(1200)}",
    "__proto__": { "pollutedHistory": true },
    "constructor": { "prototype": { "pollutedHistory": true } },
    "details": {
        "format": "json",
        "prototype": { "pollutedHistory": true }
    }
}`);
await context.storage.set('export_history', { not: 'an array' });
assert.deepEqual(await manager.getExportHistory(), []);
await manager.recordExportHistory({
    timestamp: currentHistoryTimestamp,
    format: 'json',
    note: 'n'.repeat(1200),
    details: unsafeHistoryEntry
});
const exportHistory = await manager.getExportHistory();
assert.equal(exportHistory.length, 1);
assert.equal(exportHistory[0].note.length, 1000);
assert.equal(Object.prototype.hasOwnProperty.call(exportHistory[0], 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(exportHistory[0].details, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(exportHistory[0].details.details, 'prototype'), false);
assert.equal(Object.prototype.pollutedHistory, undefined);

await context.storage.set('import_history', [
    unsafeHistoryEntry,
    { id: 'bad-date', timestamp: 'not-a-date', success: true },
    { id: 'huge-date', timestamp: String(Number.MAX_VALUE), success: true },
    'not an object'
]);
await manager.recordImportHistory({
    timestamp: currentHistoryTimestamp,
    success: false,
    error: 'e'.repeat(1200),
    sources: [{
        path: 'practice_records',
        count: 1,
        constructor: { prototype: { pollutedHistory: true } }
    }]
});
const importHistory = await manager.getImportHistory();
assert.equal(importHistory.length, 2);
assert(importHistory.every(entry => entry.timestamp === currentHistoryTimestamp));
const unsafeImportHistory = importHistory.find(entry => entry.id === 'unsafe-history');
const failedImportHistory = importHistory.find(entry => entry.success === false);
assert.equal(unsafeImportHistory.error.length, 1000);
assert.equal(failedImportHistory.error.length, 1000);
assert.equal(Object.prototype.hasOwnProperty.call(failedImportHistory.sources[0], 'constructor'), false);
assert.equal(Object.prototype.pollutedHistory, undefined);

const failingHistoryContext = createContext();
const failingHistoryManager = new failingHistoryContext.window.DataBackupManager();
const originalFailingSet = failingHistoryContext.storage.set.bind(failingHistoryContext.storage);
failingHistoryContext.storage.set = async (key, value) => {
    if (key === 'practice_records') {
        throw new Error('merge failed: SECRET_TOKEN_12345 <script>alert(1)</script>');
    }
    return originalFailingSet(key, value);
};
await assert.rejects(
    () => failingHistoryManager.importPracticeData({
        practiceRecords: [{
            id: 'record-sensitive-error',
            examId: 'reading-sensitive-error',
            startTime: '2026-01-01T00:00:00.000Z'
        }]
    }, { createBackup: false }),
    /SECRET_TOKEN_12345/
);
const sanitizedFailureHistory = await failingHistoryContext.storage.get('import_history', []);
assert.equal(sanitizedFailureHistory.length, 1);
assert.equal(sanitizedFailureHistory[0].error, 'Import failed while saving records.');
assert(!JSON.stringify(sanitizedFailureHistory).includes('SECRET_TOKEN_12345'));
assert(!JSON.stringify(sanitizedFailureHistory).includes('<script>'));

await context.storage.set('export_history', [
    { id: 'old-export', timestamp: expiredHistoryTimestamp },
    { id: 'fresh-export', timestamp: currentHistoryTimestamp }
]);
await context.storage.set('import_history', { corrupted: true });
await manager.cleanupExpiredData();
assert.deepEqual((await context.storage.get('export_history', [])).map(entry => entry.id), ['fresh-export']);
assert.deepEqual(await manager.getImportHistory(), []);

await context.storage.set('practice_records', [{ id: 'current', examId: 'reading-current' }]);
await context.storage.set('user_stats', { totalPractice: 99 });
await context.storage.set('exam_index', [{ id: 'current-index' }]);
await context.storage.set('manual_backups', [JSON.parse(`{
    "id": "backup-safe",
    "data": {
        "practice_records": [{
            "id": "restored",
            "examId": "reading-restored",
            "title": "Restored record",
            "__proto__": { "pollutedRestore": true },
            "metadata": {
                "constructor": { "prototype": { "pollutedRestore": true } }
            }
        }],
        "user_stats": {
            "totalPractice": 3,
            "constructor": { "prototype": { "pollutedRestore": true } }
        },
        "exam_index": [{
            "id": "reading-restored",
            "title": "Restored index",
            "__proto__": { "pollutedRestore": true }
        }]
    }
}`)]);
const restored = await manager.restoreBackup('backup-safe');
assert.equal(restored.success, true);
assert.equal(restored.restored.practiceRecords, 1);
assert.equal(restored.restored.userStats, 1);
assert.equal(restored.restored.examIndex, 1);
const restoredRecords = await context.storage.get('practice_records', []);
const restoredStats = await context.storage.get('user_stats', {});
const restoredIndex = await context.storage.get('exam_index', []);
assert.equal(restoredRecords[0].id, 'restored');
assert.equal(Object.prototype.hasOwnProperty.call(restoredRecords[0].metadata, 'constructor'), false);
assert.deepEqual(restoredStats, { totalPractice: 3 });
assert.equal(restoredIndex[0].id, 'reading-restored');
assert.equal(Object.prototype.pollutedRestore, undefined);

await context.storage.set('manual_backups', [{
    id: 'backup-score-storage',
    data: {
        practiceRecords: [{
            id: 'score-restored',
            examId: 'reading-score-storage',
            title: 'ScoreStorage backup'
        }],
        userStats: {
            totalPractices: 4
        },
        examIndex: [{
            id: 'score-index',
            title: 'Score index'
        }],
        storageVersion: '2.0.0'
    }
}]);
const scoreStyleRestore = await manager.restoreBackup('backup-score-storage');
assert.equal(scoreStyleRestore.success, true);
assert.deepEqual(scoreStyleRestore.restored, {
    practiceRecords: 1,
    userStats: 1,
    examIndex: 1,
    storageVersion: true
});
assert.equal((await context.storage.get('practice_records', []))[0].id, 'score-restored');
assert.deepEqual(await context.storage.get('user_stats', {}), { totalPractices: 4 });
assert.equal((await context.storage.get('exam_index', []))[0].id, 'score-index');
assert.equal(await context.storage.get('storage_version'), '2.0.0');

const tooDeep = {};
let cursor = tooDeep;
for (let index = 0; index < 42; index += 1) {
    cursor.child = {};
    cursor = cursor.child;
}
await assert.rejects(
    () => manager.importPracticeData(tooDeep, { createBackup: false }),
    /too deeply nested/
);

await assert.rejects(
    () => manager.importPracticeData({
        practiceRecords: Array.from({ length: 5001 }, (_, index) => ({
            id: `record-${index}`,
            examId: `reading-${index}`,
            status: 'completed',
            startTime: '2026-01-01T00:00:00.000Z'
        }))
    }, { createBackup: false }),
    /too many practice records/
);

assert(
    source.includes('function dataBackupDebugLog') &&
    source.includes('window.__IELTS_DEBUG_IMPORTS__ === true') &&
    !source.includes("console.log('[DataBackupManager] importPracticeData called") &&
    !source.includes("console.log('[DataBackupManager] Normalized records:") &&
    !source.includes('Skipped record: missing fields') &&
    !source.includes("console.log('[DataBackupManager] ScoreStorage import finished"),
    'data backup manager must gate import diagnostics behind an explicit debug flag'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'data backup manager import fetch guard tests passed'
}, null, 2));
