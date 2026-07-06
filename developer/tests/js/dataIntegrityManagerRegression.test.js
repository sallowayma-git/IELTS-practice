import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadManagerModule() {
    const source = fs.readFileSync(path.join(repoRoot, 'js/components/DataIntegrityManager.js'), 'utf8');
    const sandbox = {
        console,
        window: {},
        module: { exports: {} },
        exports: {},
        setInterval,
        clearInterval,
        Blob
    };
    sandbox.globalThis = sandbox;
    vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/components/DataIntegrityManager.js' });
    return sandbox.module.exports;
}

function createRepositories(options = {}) {
    const {
        initialPractice = [],
        initialSettings = {},
        backupsById = new Map(),
        failSettingsSaveOnce = false
    } = options;

    const state = {
        practice: initialPractice.map((record) => ({ ...record })),
        settings: { ...initialSettings }
    };
    let failNextSettingsSave = failSettingsSaveOnce;
    const createdBackups = [];

    const repositories = {
        practice: {
            async list() {
                return state.practice.map((record) => ({ ...record }));
            },
            async overwrite(records) {
                state.practice = Array.isArray(records) ? records.map((record) => ({ ...record })) : [];
                return true;
            }
        },
        settings: {
            async getAll() {
                return { ...state.settings };
            },
            async saveAll(settings) {
                if (failNextSettingsSave) {
                    failNextSettingsSave = false;
                    throw new Error('settings_save_failed');
                }
                state.settings = { ...settings };
                return true;
            }
        },
        backups: {
            async getById(id) {
                return backupsById.get(id) || null;
            },
            async add(backup) {
                createdBackups.push(backup);
                backupsById.set(backup.id, backup);
                return backup;
            },
            async list() {
                return Array.from(backupsById.values());
            },
            async prune() {
                return true;
            }
        },
        async transaction(_names, handler) {
            return handler({ practice: repositories.practice, settings: repositories.settings }, {});
        }
    };

    return { repositories, state, createdBackups };
}

async function testRestoreBackupDoesNotWipePracticeRecordsForSettingsOnlyBackup() {
    const { DataIntegrityManager } = loadManagerModule();
    const settingsOnlyBackup = {
        id: 'backup-settings-only',
        data: {
            system_settings: {
                language: 'zh-CN'
            }
        }
    };
    const { repositories, state } = createRepositories({
        initialPractice: [{ id: 'record-1', type: 'practice', score: 1, date: '2026-01-01T00:00:00.000Z' }],
        initialSettings: { theme: 'dark' },
        backupsById: new Map([[settingsOnlyBackup.id, settingsOnlyBackup]])
    });

    const manager = new DataIntegrityManager({ registry: { onProvidersReady() { return () => {}; } } });
    manager.repositories = repositories;
    manager.isInitialized = true;
    manager.startAutoBackup = () => {};

    await manager.restoreBackup(settingsOnlyBackup.id);

    assert.deepStrictEqual(
        state.practice.map((record) => record.id),
        ['record-1'],
        'settings-only backup restore 不应清空现有 practice records'
    );
    assert.deepStrictEqual(
        state.settings,
        { theme: 'dark', language: 'zh-CN' },
        'settings-only backup restore 应合并设置而不是覆盖空 practice 数据'
    );
}

async function testImportDataRestoresPreImportBackupAfterPartialFailure() {
    const { DataIntegrityManager } = loadManagerModule();
    const { repositories, state, createdBackups } = createRepositories({
        initialPractice: [{ id: 'record-old', type: 'practice', score: 2, date: '2026-01-01T00:00:00.000Z' }],
        initialSettings: { theme: 'dark' },
        failSettingsSaveOnce: true
    });

    const manager = new DataIntegrityManager({ registry: { onProvidersReady() { return () => {}; } } });
    manager.repositories = repositories;
    manager.isInitialized = true;
    manager.startAutoBackup = () => {};

    let failed = false;
    try {
        await manager.importData({
            data: {
                practice_records: [
                    { id: 'record-new', examId: 'reading-p1', title: 'Imported', type: 'practice', score: 3, totalQuestions: 3, correctAnswers: 3, date: '2026-02-01T00:00:00.000Z', startTime: '2026-02-01T00:00:00.000Z', endTime: '2026-02-01T00:05:00.000Z', duration: 300 }
                ],
                system_settings: {
                    language: 'fr-FR'
                }
            }
        });
    } catch (error) {
        failed = true;
        assert.match(String(error.message || error), /settings_save_failed/, '导入失败应保留原始错误');
    }

    assert.strictEqual(failed, true, 'settings 保存失败时 importData 应抛错');
    assert.ok(createdBackups.length >= 1, '导入前应创建 pre_import 备份');
    assert.deepStrictEqual(
        state.practice.map((record) => record.id),
        ['record-old'],
        '导入部分失败后应恢复原有 practice records，不能停在半导入状态'
    );
    assert.deepStrictEqual(
        {
            theme: state.settings.theme,
            language: state.settings.language,
            autoSave: state.settings.autoSave,
            notifications: state.settings.notifications
        },
        {
            theme: 'dark',
            language: undefined,
            autoSave: undefined,
            notifications: undefined
        },
        '导入部分失败后应恢复原有 settings'
    );
}

async function testRestoreBackupRollsBackWhenSettingsSaveFailsAfterPracticeOverwrite() {
    const { DataIntegrityManager } = loadManagerModule();
    const restoreTargetBackup = {
        id: 'backup-restore-target',
        data: {
            practice_records: [{ id: 'record-new', type: 'practice', score: 5, date: '2026-02-01T00:00:00.000Z' }],
            system_settings: { language: 'ja-JP' }
        }
    };
    const { repositories, state } = createRepositories({
        initialPractice: [{ id: 'record-old', type: 'practice', score: 2, date: '2026-01-01T00:00:00.000Z' }],
        initialSettings: { theme: 'dark' },
        backupsById: new Map([[restoreTargetBackup.id, restoreTargetBackup]]),
        failSettingsSaveOnce: true
    });

    const manager = new DataIntegrityManager({ registry: { onProvidersReady() { return () => {}; } } });
    manager.repositories = repositories;
    manager.isInitialized = true;
    manager.startAutoBackup = () => {};

    let failed = false;
    try {
        await manager.restoreBackup(restoreTargetBackup.id);
    } catch (error) {
        failed = true;
        assert.match(String(error.message || error), /settings_save_failed/, 'restoreBackup 应暴露原始 settings 写入错误');
    }

    assert.strictEqual(failed, true, 'restoreBackup 在 settings 保存失败时应抛错');
    assert.deepStrictEqual(
        state.practice.map((record) => record.id),
        ['record-old'],
        'restoreBackup 部分失败后应回滚 practice records'
    );
    assert.deepStrictEqual(
        {
            theme: state.settings.theme,
            language: state.settings.language,
            autoSave: state.settings.autoSave,
            notifications: state.settings.notifications
        },
        {
            theme: 'dark',
            language: undefined,
            autoSave: undefined,
            notifications: undefined
        },
        'restoreBackup 部分失败后应回滚 settings'
    );
}

async function main() {
    try {
        await testRestoreBackupDoesNotWipePracticeRecordsForSettingsOnlyBackup();
        await testImportDataRestoresPreImportBackupAfterPartialFailure();
        await testRestoreBackupRollsBackWhenSettingsSaveFailsAfterPracticeOverwrite();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'data integrity manager backup/rollback regressions covered'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
