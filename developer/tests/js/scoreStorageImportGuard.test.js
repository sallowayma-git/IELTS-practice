#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const source = fs.readFileSync(path.join(repoRoot, 'js/core/scoreStorage.js'), 'utf8');

const context = {
    console: {
        log() {},
        warn() {},
        error() {},
        info() {}
    },
    TextEncoder,
    window: {}
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/core/scoreStorage.js' });

const { ScoreStorage } = context.window;

function createScoreStorageHarness({ maxRecords = 2, existingRecords = [], manualBackups = [] } = {}) {
    const stored = {
        practice_records: existingRecords.slice(),
        user_stats: {},
        manual_backups: manualBackups.slice()
    };
    const scoreStorage = Object.create(ScoreStorage.prototype);
    scoreStorage.maxRecords = maxRecords;
    scoreStorage.storageKeys = {
        practiceRecords: 'practice_records',
        userStats: 'user_stats',
        storageVersion: 'storage_version',
        backupData: 'manual_backups'
    };
    scoreStorage.storage = {
        async get(key, fallback) {
            return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : fallback;
        },
        async set(key, value) {
            stored[key] = Array.isArray(value) ? value.slice() : value;
            return true;
        }
    };
    scoreStorage.ensureReady = async () => {};
    scoreStorage.createBackup = async () => {};
    scoreStorage.recalculateUserStats = async () => {};
    scoreStorage.standardizeRecord = (record) => record;
    return scoreStorage;
}

await assert.rejects(
    () => createScoreStorageHarness().importData({
        practiceRecords: [
            { id: 'r1' },
            { id: 'r2' },
            { id: 'r3' }
        ]
    }),
    /too many practice records/
);

await assert.rejects(
    () => createScoreStorageHarness().importData('{"practiceRecords":[]}' + ' '.repeat(10 * 1024 * 1024)),
    /Import string is too large/
);

const maliciousImport = createScoreStorageHarness({
    existingRecords: [{ id: 'existing-safe', examId: 'reading-existing' }]
});
await assert.rejects(
    () => maliciousImport.importData(JSON.parse(`{
        "practiceRecords": [{
            "id": "bad-import",
            "examId": "reading-bad",
            "metadata": {
                "__proto__": { "pollutedScoreImport": true }
            }
        }],
        "userStats": {
            "constructor": { "prototype": { "pollutedScoreImport": true } }
        }
    }`)),
    /unsafe key/
);
assert.deepEqual(
    await maliciousImport.storage.get('practice_records', []),
    [{ id: 'existing-safe', examId: 'reading-existing' }]
);
assert.equal(Object.prototype.pollutedScoreImport, undefined);

await assert.rejects(
    () => createScoreStorageHarness({
        existingRecords: [
            { id: 'existing-1' },
            { id: 'existing-2' }
        ]
    }).importData({
        practiceRecords: [{ id: 'new-1' }]
    }, { merge: true }),
    /exceed maximum stored practice records/
);

const duplicateMerge = createScoreStorageHarness({
    existingRecords: [
        { id: 'existing-1', score: 1 },
        { id: 'existing-2', score: 2 }
    ]
});
await duplicateMerge.importData({
    practiceRecords: [{ id: 'existing-1', score: 3 }]
}, { merge: true });
const merged = await duplicateMerge.storage.get('practice_records', []);
assert.equal(merged.length, 2);
assert.equal(merged.find((record) => record.id === 'existing-1').score, 3);

const maliciousBackupRestore = createScoreStorageHarness({
    existingRecords: [{ id: 'existing', examId: 'reading-existing' }],
    manualBackups: [
        JSON.parse(`{
            "id": "backup-bad",
            "type": "score_storage",
            "data": {
                "practiceRecords": [{
                    "id": "bad",
                    "payload": {
                        "__proto__": { "polluted": true }
                    }
                }],
                "userStats": { "totalPractices": 1 }
            }
        }`)
    ]
});
await assert.rejects(
    () => maliciousBackupRestore.restoreBackup('backup-bad'),
    /unsafe key/
);
assert.deepEqual(
    await maliciousBackupRestore.storage.get('practice_records', []),
    [{ id: 'existing', examId: 'reading-existing' }]
);
assert.equal(Object.prototype.polluted, undefined);

const oversizedBackupRestore = createScoreStorageHarness({
    maxRecords: 2,
    existingRecords: [{ id: 'existing', examId: 'reading-existing' }],
    manualBackups: [{
        id: 'backup-large',
        type: 'score_storage',
        data: {
            practiceRecords: [
                { id: 'record-1' },
                { id: 'record-2' },
                { id: 'record-3' }
            ],
            userStats: { totalPractices: 3 }
        }
    }]
});
await assert.rejects(
    () => oversizedBackupRestore.restoreBackup('backup-large'),
    /too many practice records/
);
assert.deepEqual(
    await oversizedBackupRestore.storage.get('practice_records', []),
    [{ id: 'existing', examId: 'reading-existing' }]
);

const normalizedBackupRestore = createScoreStorageHarness({
    maxRecords: 5,
    manualBackups: [{
        id: 'backup-normalize',
        type: 'score_storage',
        data: {
            practiceRecords: [
                { id: 'restore-raw', examId: 'reading-raw', title: 'Raw restore' },
                { id: 'restore-bad', examId: 'reading-bad' }
            ],
            userStats: {
                totalPractices: 2,
                nested: {
                    note: 'x'.repeat(5000)
                }
            }
        }
    }]
});
normalizedBackupRestore.standardizeRecord = (record) => {
    if (record.id === 'restore-bad') {
        throw new Error('bad backup record');
    }
    return {
        ...record,
        restoredNormalized: true
    };
};
await normalizedBackupRestore.restoreBackup('backup-normalize');
const normalizedRestored = await normalizedBackupRestore.storage.get('practice_records', []);
const normalizedStats = await normalizedBackupRestore.storage.get('user_stats', {});
assert.deepEqual(normalizedRestored, [{
    id: 'restore-raw',
    examId: 'reading-raw',
    title: 'Raw restore',
    restoredNormalized: true
}]);
assert.equal(normalizedStats.totalPractices, 2);
assert.equal(normalizedStats.nested.note.length, 4000);

const fallbackScoreStorage = Object.create(ScoreStorage.prototype);
fallbackScoreStorage.currentVersion = '1.0.0';
fallbackScoreStorage.generateRecordId = () => 'score-record-pollution-guard';

const clonedRecord = fallbackScoreStorage.clonePlainObject(JSON.parse(`{
    "safe": "ok",
    "__proto__": { "pollutedScoreClone": true },
    "constructor": { "prototype": { "pollutedScoreClone": true } },
    "nested": {
        "prototype": { "pollutedScoreClone": true },
        "text": "${'x'.repeat(5000)}"
    }
}`));
assert.equal(Object.prototype.pollutedScoreClone, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(clonedRecord, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(clonedRecord, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(clonedRecord.nested, 'prototype'), false);
assert.equal(clonedRecord.nested.text.length, 4000);

const cyclicScoreRecord = { id: 'cycle' };
cyclicScoreRecord.self = cyclicScoreRecord;
assert.deepEqual(
    JSON.parse(JSON.stringify(fallbackScoreStorage.clonePlainObject(cyclicScoreRecord))),
    { id: 'cycle' }
);
assert.equal(
    fallbackScoreStorage.clonePlainObject(Array.from({ length: 1100 }, (_, index) => index)).length,
    1000
);

const standardizedFallbackRecord = fallbackScoreStorage.standardizeRecord({
    id: 'score-pollution-guard',
    examId: 'reading-score-pollution',
    sessionId: 'session-score-pollution',
    title: 'Score Pollution Guard',
    date: '2026-05-07T00:00:00.000Z',
    startTime: '2026-05-07T00:00:00.000Z',
    endTime: '2026-05-07T00:10:00.000Z',
    duration: 600,
    score: 1,
    totalQuestions: 1,
    correctAnswers: 1,
    accuracy: 1,
    answers: [{ questionId: 'q1', answer: 'A', correctAnswer: 'A', correct: true }],
    correctAnswerMap: { q1: 'A' },
    scoreInfo: JSON.parse('{"details":{},"constructor":{"prototype":{"pollutedScoreRecord":true}}}'),
    metadata: JSON.parse('{"examTitle":"Guard","type":"reading","__proto__":{"pollutedScoreRecord":true}}'),
    realData: JSON.parse('{"__proto__":{"pollutedScoreRecord":true},"scoreInfo":{"constructor":{"prototype":{"pollutedScoreRecord":true}}}}')
});
assert.equal(Object.prototype.pollutedScoreRecord, undefined);
assert.equal(Object.prototype.hasOwnProperty.call(standardizedFallbackRecord.metadata, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(standardizedFallbackRecord.realData, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(standardizedFallbackRecord.scoreInfo, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(standardizedFallbackRecord.realData.scoreInfo, 'constructor'), false);

const csvOutput = fallbackScoreStorage.convertToCSV([
    { id: 'legacy-record-without-metadata', examId: 'reading-legacy' },
    {
        id: '=HYPERLINK("https://attacker.example")',
        examId: 'reading-formula',
        accuracy: 0.5,
        metadata: {
            category: '+formula',
            frequency: '-formula',
            examTitle: '@formula'
        }
    }
]);
assert(!csvOutput.includes('NaN%'), 'CSV export must not emit NaN% for legacy records without accuracy');
assert(csvOutput.includes('"legacy-record-without-metadata"'), 'CSV export should include legacy records without metadata');
assert(csvOutput.includes('"\'=HYPERLINK(""https://attacker.example"")"'), 'CSV export must neutralize formula-like ids');
assert(csvOutput.includes("\"'+formula\""), 'CSV export must neutralize formula-like metadata values');
assert(csvOutput.includes('"\'-formula"'), 'CSV export must neutralize negative formula-like metadata values');
assert(csvOutput.includes('"\'@formula"'), 'CSV export must neutralize at-sign formula-like metadata values');

const legacyFilterStorage = createScoreStorageHarness({
    existingRecords: [{ id: 'legacy-filter-record', examId: 'reading-legacy-filter' }]
});
const filteredLegacyRecords = await legacyFilterStorage.getPracticeRecords({ category: 'reading' });
assert(Array.isArray(filteredLegacyRecords), 'category filtering must tolerate legacy records without metadata');
assert.doesNotThrow(
    () => fallbackScoreStorage.checkAchievements(fallbackScoreStorage.getDefaultUserStats(), { accuracy: 1 }),
    'achievement checks must tolerate practice records without metadata'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'score storage import guard tests passed'
}, null, 2));
