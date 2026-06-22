#!/usr/bin/env node
import assert from 'assert';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { webcrypto } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const require = createRequire(import.meta.url);

const previousWindow = global.window;
global.window = {
    crypto: webcrypto,
    StorageProviderRegistry: null,
    dataRepositories: null
};

try {
    const { DataIntegrityManager } = require(path.join(repoRoot, 'js/components/DataIntegrityManager.js'));

    const manager = new DataIntegrityManager({ maxImportSourceBytes: 32 });
    const smallPayload = JSON.stringify({ ok: true });
    const largePayload = JSON.stringify({ data: 'x'.repeat(64) });

    assert.deepEqual(await manager._resolveImportSource(smallPayload), { ok: true });
    await assert.rejects(
        () => manager._resolveImportSource(largePayload),
        /Import string is too large/
    );

    const smallBlob = new Blob([smallPayload], { type: 'application/json' });
    assert.deepEqual(await manager._resolveImportSource(smallBlob), { ok: true });

    const largeBlob = new Blob([largePayload], { type: 'application/json' });
    await assert.rejects(
        () => manager._resolveImportSource(largeBlob),
        /Import blob is too large/
    );

    const smallBuffer = new TextEncoder().encode(smallPayload).buffer;
    assert.deepEqual(await manager._resolveImportSource(smallBuffer), { ok: true });

    const largeBuffer = new TextEncoder().encode(largePayload).buffer;
    await assert.rejects(
        () => manager._resolveImportSource(largeBuffer),
        /Import arrayBuffer is too large/
    );

    const guardManager = new DataIntegrityManager();
    const normalizedPayload = await guardManager._normalizeImportPayload(JSON.stringify({
        data: {
            practice_records: [{ id: 'record-1', title: 'Safe import' }],
            system_settings: { theme: 'light' }
        },
        version: 'test-version'
    }));
    assert.equal(normalizedPayload.practice_records.length, 1);
    assert.equal(normalizedPayload.system_settings.theme, 'light');
    assert.equal(normalizedPayload.version, 'test-version');

    assert.deepEqual(guardManager._prepareSystemSettings({
        theme: 'Dark',
        language: 'zh-CN',
        autoSave: false,
        notifications: true
    }), {
        theme: 'dark',
        language: 'zh-CN',
        autoSave: false,
        notifications: true
    });
    assert.deepEqual(guardManager._prepareSystemSettings({
        theme: 'dark<script>',
        language: 'x'.repeat(200),
        autoSave: 'true',
        notifications: { enabled: true }
    }), {});

    await assert.rejects(
        () => guardManager._normalizeImportPayload('{"data":{"practice_records":[{"id":"polluted","payload":{"__proto__":{"admin":true}}}]}}'),
        /unsafe key/
    );

    const publicImportReadManager = new DataIntegrityManager();
    publicImportReadManager.repositories = {};
    await assert.rejects(
        () => publicImportReadManager.importData('{"data":{"practice_records":[{"id":"polluted","payload":{"__proto__":{"admin":true}}}]}}'),
        (error) => {
            assert.equal(error.message, 'Import file format is invalid or unsupported.');
            assert(!error.message.includes('__proto__'));
            assert(!error.message.includes('payload'));
            return true;
        }
    );

    const publicImportSaveManager = new DataIntegrityManager();
    publicImportSaveManager.createBackup = async () => ({ id: 'backup-before-sensitive-failure' });
    publicImportSaveManager.repositories = {
        async transaction() {
            throw new Error('db failed: SECRET_TOKEN_12345 <script>alert(1)</script>');
        }
    };
    await assert.rejects(
        () => publicImportSaveManager.importData(JSON.stringify({
            data: {
                practice_records: [{
                    id: 'record-save-error',
                    title: 'Safe import'
                }]
            }
        })),
        (error) => {
            assert.equal(error.message, 'Import failed while saving data.');
            assert(!error.message.includes('SECRET_TOKEN_12345'));
            assert(!error.message.includes('<script>'));
            return true;
        }
    );

    await assert.rejects(
        () => guardManager._normalizeImportPayload({
            data: {
                practice_records: Array.from({ length: 5001 }, (_, index) => ({ id: `record-${index}` }))
            }
        }),
        /too many practice records/
    );

    const deepSettings = {};
    let cursor = deepSettings;
    for (let index = 0; index < 45; index += 1) {
        cursor.next = {};
        cursor = cursor.next;
    }
    await assert.rejects(
        () => guardManager._normalizeImportPayload({
            data: {
                system_settings: deepSettings
            }
        }),
        /too deep/
    );

    const longText = 'x'.repeat(10000);
    const prepared = guardManager._preparePracticeRecords([JSON.parse(JSON.stringify({
        id: longText,
        sessionId: longText,
        examId: longText,
        title: longText,
        type: longText,
        extraField: longText,
        realData: {
            note: longText,
            list: Array.from({ length: 260 }, (_, index) => `item-${index}`),
            constructor: {
                prototype: {
                    polluted: true
                }
            }
        }
    }))]);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].id.length, 512);
    assert.equal(prepared[0].sessionId.length, 512);
    assert.equal(prepared[0].examId.length, 512);
    assert.equal(prepared[0].title.length, 500);
    assert.equal(prepared[0].type.length, 64);
    assert.equal(prepared[0].extraField.length, 4000);
    assert.equal(prepared[0].realData.note.length, 4000);
    assert.equal(prepared[0].realData.list.length, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(prepared[0], 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(prepared[0].realData, 'constructor'), false);
    assert.equal(Object.prototype.polluted, undefined);

    const unicodePrepared = guardManager._preparePracticeRecords([{
        id: `${'i'.repeat(511)}\uD83D\uDE00tail`,
        sessionId: `${'s'.repeat(511)}\uD83D\uDE00tail`,
        examId: `${'e'.repeat(511)}\uD83D\uDE00tail`,
        title: `${'t'.repeat(499)}\uD83D\uDE00tail`,
        type: `${'p'.repeat(63)}\uD83D\uDE00tail`,
        extraField: `${'x'.repeat(3999)}\uD83D\uDE00tail`,
        realData: {
            note: `${'n'.repeat(3999)}\uD83D\uDE00tail`
        }
    }]);
    assert.equal(unicodePrepared.length, 1);
    assert.equal(unicodePrepared[0].id, 'i'.repeat(511));
    assert.equal(unicodePrepared[0].sessionId, 's'.repeat(511));
    assert.equal(unicodePrepared[0].examId, 'e'.repeat(511));
    assert.equal(unicodePrepared[0].title, 't'.repeat(499));
    assert.equal(unicodePrepared[0].type, 'p'.repeat(63));
    assert.equal(unicodePrepared[0].extraField, 'x'.repeat(3999));
    assert.equal(unicodePrepared[0].realData.note, 'n'.repeat(3999));
    assert.equal(/[\uD800-\uDFFF]/.test([
        unicodePrepared[0].id,
        unicodePrepared[0].sessionId,
        unicodePrepared[0].examId,
        unicodePrepared[0].title,
        unicodePrepared[0].type,
        unicodePrepared[0].extraField,
        unicodePrepared[0].realData.note
    ].join('')), false);

    const numericPrepared = guardManager._preparePracticeRecords([{
        id: 'numeric-record',
        date: 1e100,
        startTime: '999999999999999999999999',
        endTime: '1000000000000000000000000',
        duration: Number.MAX_VALUE,
        score: 999999,
        totalQuestions: 50,
        correctAnswers: 999999,
        accuracy: Number.MAX_VALUE,
        realData: {
            duration: Number.MAX_VALUE,
            percentage: 999999
        }
    }]);
    assert.equal(numericPrepared.length, 1);
    assert.match(numericPrepared[0].date, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(numericPrepared[0].startTime, numericPrepared[0].date);
    assert.equal(numericPrepared[0].endTime, numericPrepared[0].startTime);
    assert.equal(numericPrepared[0].duration, 365 * 24 * 60 * 60);
    assert.equal(numericPrepared[0].score, 100);
    assert.equal(numericPrepared[0].totalQuestions, 50);
    assert.equal(numericPrepared[0].correctAnswers, 50);
    assert.equal(numericPrepared[0].accuracy, 100);

    const exportManager = new DataIntegrityManager();
    let storedBackup = null;
    exportManager.repositories = {
        backups: {
            async add(backup) {
                storedBackup = backup;
            }
        }
    };
    const unsafeExportData = {
        practice_records: [{
            id: 'export-record',
            note: 'x'.repeat(20050),
            big: 10n
        }]
    };
    unsafeExportData.self = unsafeExportData;
    unsafeExportData.practice_records[0].loop = unsafeExportData;
    Object.defineProperty(unsafeExportData, '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true
    });
    unsafeExportData.constructor = { unsafe: true };

    const createdBackup = await exportManager.createBackup(unsafeExportData, 'manual');
    assert.equal(createdBackup, storedBackup);
    assert.equal(storedBackup.data.self, '[Circular]');
    assert.equal(storedBackup.data.practice_records[0].loop, '[Circular]');
    assert.equal(storedBackup.data.practice_records[0].big, '10');
    assert.equal(storedBackup.data.practice_records[0].note.length, 20003);
    assert.equal(typeof storedBackup.size, 'number');
    assert.equal(Object.prototype.hasOwnProperty.call(storedBackup.data, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(storedBackup.data, 'constructor'), false);
    assert.equal(Object.prototype.polluted, undefined);

    const restoreManager = new DataIntegrityManager();
    restoreManager.repositories = {
        backups: {
            async getById(id) {
                assert.equal(id, 'backup-safe');
                return {
                    id,
                    data: {
                        practice_records: [{
                            id: 'record-safe',
                            title: 'Restored record',
                            startTime: '2026-01-01T00:00:00.000Z',
                            extraField: 'kept for compatibility'
                        }],
                        system_settings: {
                            theme: 'dark',
                            language: 'zh-CN',
                            autoSave: 'yes',
                            notifications: { enabled: true },
                            unsafeSetting: '<script>alert(1)</script>'
                        }
                    }
                };
            }
        },
        async transaction(_stores, callback) {
            return callback({
                practice: {
                    async overwrite(records) {
                        restoreManager.restoredRecords = records;
                    }
                },
                settings: {
                    async getAll() {
                        return { theme: 'light', language: 'en', autoSave: true, notifications: false };
                    },
                    async saveAll(settings) {
                        restoreManager.restoredSettings = settings;
                    }
                }
            }, {});
        }
    };
    await restoreManager.restoreBackup('backup-safe');
    assert.equal(restoreManager.restoredRecords.length, 1);
    assert.equal(restoreManager.restoredRecords[0].id, 'record-safe');
    assert.equal(restoreManager.restoredSettings.theme, 'dark');
    assert.equal(restoreManager.restoredSettings.language, 'zh-CN');
    assert.equal(restoreManager.restoredSettings.autoSave, true);
    assert.equal(restoreManager.restoredSettings.notifications, false);
    assert.equal(Object.prototype.hasOwnProperty.call(restoreManager.restoredSettings, 'unsafeSetting'), false);

    const maliciousRestoreManager = new DataIntegrityManager();
    maliciousRestoreManager.repositories = {
        backups: {
            async getById() {
                return JSON.parse('{"id":"backup-bad","data":{"practice_records":[{"id":"bad","payload":{"__proto__":{"polluted":true}}}]}}');
            }
        },
        async transaction() {
            throw new Error('restore transaction must not run for unsafe backups');
        }
    };
    await assert.rejects(
        () => maliciousRestoreManager.restoreBackup('backup-bad'),
        /unsafe key/
    );
    assert.equal(Object.prototype.polluted, undefined);

    console.log(JSON.stringify({
        status: 'pass',
        detail: 'data integrity manager import guard tests passed'
    }, null, 2));
} finally {
    if (previousWindow === undefined) {
        delete global.window;
    } else {
        global.window = previousWindow;
    }
}
