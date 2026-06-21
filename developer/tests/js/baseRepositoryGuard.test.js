#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadRepositories() {
    const context = {
        console,
        structuredClone,
        window: { ExamData: {} }
    };
    vm.createContext(context);
    for (const file of [
        'js/data/repositories/baseRepository.js',
        'js/data/repositories/settingsRepository.js',
        'js/data/repositories/backupRepository.js',
        'js/data/repositories/practiceRepository.js'
    ]) {
        vm.runInContext(read(file), context, { filename: file });
    }
    return context.window.ExamData;
}

function createDataSource(seed = {}) {
    const data = new Map(Object.entries(seed));
    return {
        data,
        async read(key, defaultValue) {
            return data.has(key) ? data.get(key) : defaultValue;
        },
        async write(key, value) {
            data.set(key, value);
            return true;
        },
        async remove(key) {
            data.delete(key);
            return true;
        },
        async runTransaction(handler) {
            const tx = {
                async get(key, defaultValue) {
                    return data.has(key) ? data.get(key) : defaultValue;
                },
                set(key, value) {
                    data.set(key, value);
                },
                remove(key) {
                    data.delete(key);
                }
            };
            return handler(tx);
        }
    };
}

function pollutedPayload() {
    return JSON.parse(`{
        "safe": "keep",
        "__proto__": { "pollutedRepository": true },
        "nested": {
            "ok": 1,
            "constructor": { "prototype": { "pollutedRepository": true } }
        },
        "items": [
            {
                "id": "item-1",
                "prototype": { "pollutedRepository": true }
            }
        ]
    }`);
}

function assertClean(value, label) {
    assert.equal(Object.prototype.pollutedRepository, undefined, `${label}: Object.prototype must not be polluted`);
    assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), false, `${label}: top-level __proto__ should be removed`);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'constructor'), false, `${label}: top-level constructor should be removed`);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'prototype'), false, `${label}: top-level prototype should be removed`);
    if (value.nested) {
        assert.equal(Object.prototype.hasOwnProperty.call(value.nested, 'constructor'), false, `${label}: nested constructor should be removed`);
        assert.equal(value.nested.ok, 1, `${label}: safe nested fields should remain`);
    }
    if (Array.isArray(value.items) && value.items[0]) {
        assert.equal(Object.prototype.hasOwnProperty.call(value.items[0], 'prototype'), false, `${label}: array item prototype should be removed`);
        assert.equal(value.items[0].id, 'item-1', `${label}: safe array fields should remain`);
    }
}

const ExamData = loadRepositories();

const cloned = ExamData.cloneValue(pollutedPayload());
assertClean(cloned, 'cloneValue');

const settingsDataSource = createDataSource();
const settingsRepo = new ExamData.SettingsRepository(settingsDataSource);
await settingsRepo.saveAll(pollutedPayload());
assertClean(settingsDataSource.data.get('user_settings'), 'settings saveAll');

const mergedReturn = await settingsRepo.merge(JSON.parse(`{
    "other": "value",
    "__proto__": { "pollutedRepository": true },
    "nestedPatch": {
        "constructor": { "prototype": { "pollutedRepository": true } },
        "safe": true
    }
}`));
assert.equal(Object.prototype.hasOwnProperty.call(mergedReturn, '__proto__'), false, 'settings merge return should remove top-level __proto__');
assert.equal(Object.prototype.hasOwnProperty.call(mergedReturn.nestedPatch, 'constructor'), false, 'settings merge return should remove nested constructor');
const mergedSettings = settingsDataSource.data.get('user_settings');
assert.equal(Object.prototype.hasOwnProperty.call(mergedSettings, '__proto__'), false, 'settings merge should remove top-level __proto__');
assert.equal(Object.prototype.hasOwnProperty.call(mergedSettings.nestedPatch, 'constructor'), false, 'settings merge should remove nested constructor');
assert.equal(mergedSettings.nestedPatch.safe, true, 'settings merge should keep safe nested fields');

settingsDataSource.data.set('user_settings', pollutedPayload());
const readSettings = await settingsRepo.getAll();
assertClean(readSettings, 'settings read');

const backupDataSource = createDataSource();
const backupRepo = new ExamData.BackupRepository(backupDataSource);
const addedBackup = await backupRepo.add({
    id: 'backup-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    constructor: { prototype: { pollutedRepository: true } },
    data: pollutedPayload()
});
assert.equal(Object.prototype.hasOwnProperty.call(addedBackup, 'constructor'), false, 'backup add return should remove top-level constructor');
assertClean(addedBackup.data, 'backup add return');
const savedBackup = backupDataSource.data.get('manual_backups')[0];
assert.equal(Object.prototype.hasOwnProperty.call(savedBackup, 'constructor'), false, 'backup add should not persist top-level constructor');
assertClean(savedBackup.data, 'backup add');

const practiceDataSource = createDataSource({
    practice_records: [{
        id: 'secret-practice-record-id',
        type: 'reading',
        score: 'not-a-number',
        date: '2026-01-01T00:00:00.000Z'
    }]
});
const practiceRepo = new ExamData.PracticeRepository(practiceDataSource);
const consistencyReport = await practiceRepo.runConsistencyCheck();
assert.equal(consistencyReport.valid, false, 'invalid practice records should fail consistency check');
assert.ok(consistencyReport.errors.some((error) => error.includes('record #1')), 'practice consistency errors should use record position');
assert.equal(
    consistencyReport.errors.some((error) => error.includes('secret-practice-record-id')),
    false,
    'practice consistency errors should not expose record ids'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'base repository pollution guard tests passed'
}, null, 2));
