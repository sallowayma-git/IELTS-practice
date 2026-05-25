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

    function createDefaultVocabConfig() {
        return {
            dailyNew: 20,
            reviewLimit: 100,
            masteryCount: 4,
            theme: 'auto',
            notify: true
        };
    }

    function createMetaFacade(metaRepo) {
        function assertAllowedKey(key) {
            if (key === 'user_stats') {
                throw new Error('user_stats must go through PracticeRecordAPI');
            }
        }

        return Object.freeze({
            async get(key, defaultValue, options = {}) {
                assertAllowedKey(key);
                return await metaRepo.get(key, defaultValue, options);
            },
            async set(key, value, options = {}) {
                assertAllowedKey(key);
                return await metaRepo.set(key, value, options);
            },
            async remove(key, options = {}) {
                assertAllowedKey(key);
                return await metaRepo.remove(key, options);
            },
            async runConsistencyCheck(keys) {
                const targetKeys = Array.isArray(keys)
                    ? keys.filter((key) => key !== 'user_stats')
                    : undefined;
                return await metaRepo.runConsistencyCheck(targetKeys);
            }
        });
    }

    function bootstrap() {
        if (!window.persistentStore) {
            console.warn('[data/index] StorageManager 未就绪，延迟初始化数据仓库');
            setTimeout(bootstrap, 100);
            return;
        }

        if (window.dataRepositories) {
            return;
        }

        if (!window.PracticeCore || typeof window.PracticeCore.__installInternalRepositories !== 'function') {
            console.warn('[data/index] PracticeCore internal installer 未就绪，延迟初始化数据仓库');
            setTimeout(bootstrap, 100);
            return;
        }

        let createInternalOptions = null;
        if (typeof window.__installStorageInternalAccess === 'function') {
            window.__installStorageInternalAccess((factory) => {
                createInternalOptions = typeof factory === 'function' ? factory : null;
                return true;
            });
        }
        if (!createInternalOptions) {
            console.warn('[data/index] Storage internal access 未就绪，延迟初始化数据仓库');
            setTimeout(bootstrap, 100);
            return;
        }

        const dataSource = new ExamData.StorageDataSource(window.persistentStore, {
            createInternalOptions
        });
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
            },
            vocab_words: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'vocab_words 必须为数组'
                ]
            },
            vocab_user_config: {
                defaultValue: createDefaultVocabConfig,
                validators: [
                    (value) => (value && typeof value === 'object' && !Array.isArray(value)) || 'vocab_user_config 必须为对象'
                ]
            },
            vocab_review_queue: {
                defaultValue: () => [],
                validators: [
                    (value) => Array.isArray(value) || 'vocab_review_queue 必须为数组'
                ]
            },
            vocab_list_reading_highlights: {
                defaultValue: () => [],
                validators: [
                    (value) => (
                        Array.isArray(value)
                        || (value && typeof value === 'object' && Array.isArray(value.words))
                    ) || 'vocab_list_reading_highlights 必须为数组或词表对象'
                ]
            },
            legacy_practice_records_migrated: {
                defaultValue: () => false,
                validators: [
                    (value) => typeof value === 'boolean' || 'legacy_practice_records_migrated 必须为布尔值'
                ],
                cloneOnRead: false
            }
        });

        registry.register('practice', practiceRepo);
        registry.register('settings', settingsRepo);
        registry.register('backups', backupRepo);
        registry.register('meta', metaRepo);

        const internalApi = {
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
        window.PracticeCore.__installInternalRepositories(internalApi);
        const metaFacade = createMetaFacade(metaRepo);
        const api = {
            get settings() { return settingsRepo; },
            get backups() { return backupRepo; },
            get meta() { return metaFacade; },
            transaction(names, handler) {
                const targetNames = Array.isArray(names) ? names : [];
                if (targetNames.includes('practice')) {
                    throw new Error('practice_records transactions must go through PracticeRecordAPI');
                }
                return registry.transaction(names, handler);
            },
            runConsistencyChecks(names) {
                const targetNames = Array.isArray(names)
                    ? names.filter((name) => name !== 'practice')
                    : undefined;
                return registry.runConsistencyChecks(targetNames);
            }
        };
        const registryApi = window.StorageProviderRegistry;
        if (registryApi && typeof registryApi.registerStorageProviders === 'function') {
            registryApi.registerStorageProviders({
                repositories: api,
                storageManager: window.storage || null,
                persistentStore: window.persistentStore || null,
                preferenceStore: window.preferenceStore || null
            });
        } else {
            window.dataRepositories = api;
        }

        ExamData.registry = registry;
        ExamData.createDefaultUserStats = createDefaultUserStats;
        ExamData.createDefaultVocabConfig = createDefaultVocabConfig;
        console.log('[data/index] 数据仓库初始化完成');
    }

    bootstrap();
})(window);
