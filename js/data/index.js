(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    function createDefaultUserStats() {
        const now = new Date().toISOString();
        return {
            totalPractices: 0,
            totalTimeSpent: 0,
            averageScore: 0,
            categoryStats: {},
            questionTypeStats: {},
            streakDays: 0,
            lastPracticeDate: null,
            achievements: [],
            createdAt: now,
            updatedAt: now
        };
    }

    function bootstrap() {
        if (!window.storage) {
            console.warn('[data/index] StorageManager 未就绪，延迟初始化数据仓库');
            setTimeout(bootstrap, 100);
            return;
        }

        if (window.dataRepositories) {
            return;
        }

        const dataSource = new ExamData.StorageDataSource(window.storage);
        const registry = new ExamData.DataRepositoryRegistry(dataSource);

        const practiceRepo = new ExamData.PracticeRepository(dataSource, { maxRecords: 1000 });
        const settingsRepo = new ExamData.SettingsRepository(dataSource);
        const backupRepo = new ExamData.BackupRepository(dataSource, { maxBackups: 20 });
        const metaRepo = new ExamData.MetaRepository(dataSource, {
            user_stats: {
                defaultValue: createDefaultUserStats,
                validators: [
                    (value) => (value && typeof value === 'object' && !Array.isArray(value)) || 'user_stats 必须为对象'
                ]
            },
            storage_version: {
                defaultValue: () => null,
                validators: [
                    (value) => value === null || typeof value === 'string' || 'storage_version 必须是字符串或 null'
                ],
                cloneOnRead: false
            },
            data_restored: {
                defaultValue: () => false,
                validators: [
                    (value) => typeof value === 'boolean' || 'data_restored 必须是布尔值'
                ],
                cloneOnRead: false
            },
            active_sessions: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'active_sessions 必须为数组'
                ]
            },
            temp_practice_records: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'temp_practice_records 必须为数组'
                ]
            },
            interrupted_records: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'interrupted_records 必须为数组'
                ]
            },
            exam_index: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'exam_index 必须为数组'
                ]
            }
        });

        registry.register('practice', practiceRepo);
        registry.register('settings', settingsRepo);
        registry.register('backups', backupRepo);
        registry.register('meta', metaRepo);

        const api = {
            get practice() { return practiceRepo; },
            get settings() { return settingsRepo; },
            get backups() { return backupRepo; },
            get meta() { return metaRepo; },
            transaction(names, handler) {
                return registry.transaction(names, handler);
            },
            runConsistencyChecks(names) {
                return registry.runConsistencyChecks(names);
            }
        };

        const registryApi = window.StorageProviderRegistry;
        if (registryApi && typeof registryApi.registerStorageProviders === 'function') {
            registryApi.registerStorageProviders({
                repositories: api,
                storageManager: window.storage || null
            });
        } else {
            window.dataRepositories = api;
        }

        ExamData.registry = registry;
        ExamData.createDefaultUserStats = createDefaultUserStats;
        console.log('[data/index] 数据仓库初始化完成');
    }

    bootstrap();
})(window);
