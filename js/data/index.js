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

    async function bootstrap() {
        if (!window.persistentStore) {
            console.warn('[data/index] StorageManager 未就绪，延迟初始化数据仓库');
            setTimeout(bootstrap, 100);
            return;
        }

        if (window.dataRepositories) {
            return;
        }

        const localDataSource = new ExamData.StorageDataSource(window.persistentStore);
        let dataSource = localDataSource;
        let remoteApiClient = null;
        let remoteAuthState = { available: false, authenticated: false, user: null };
        let remoteAuthGateEnabled = false;

        if (ExamData.RemoteApiClient && ExamData.RemotePracticeDataSource) {
            remoteApiClient = new ExamData.RemoteApiClient();
            if (ExamData.setRemoteAuthGate) {
                ExamData.setRemoteAuthGate(true);
                remoteAuthGateEnabled = true;
            }
            try {
                remoteAuthState = await remoteApiClient.getAuthState();
                if (remoteAuthState.available) {
                    dataSource = new ExamData.RemotePracticeDataSource(localDataSource, remoteApiClient);
                    window.remoteApiClient = remoteApiClient;
                }
            } catch (error) {
                console.warn('[data/index] 远端 API 检测失败，继续使用本地存储:', error);
                remoteAuthState = { available: false, authenticated: false, user: null };
                remoteApiClient = null;
                dataSource = localDataSource;
                if (remoteAuthGateEnabled && ExamData.setRemoteAuthGate) {
                    ExamData.setRemoteAuthGate(false);
                    remoteAuthGateEnabled = false;
                }
            }
        }

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

        if (remoteApiClient && remoteAuthState.available && ExamData.createRemoteAuthController) {
            const authController = ExamData.createRemoteAuthController({
                apiClient: remoteApiClient,
                localDataSource
            });
            window.remoteAuthController = authController;
            if (remoteAuthState.authenticated) {
                authController.handleAuthenticated(remoteAuthState.user).catch((error) => {
                    console.warn('[data/index] 登录后导入本地记录失败:', error);
                });
            } else {
                authController.show();
            }
        } else if (remoteAuthGateEnabled && ExamData.setRemoteAuthGate) {
            ExamData.setRemoteAuthGate(false);
        }

        console.log('[data/index] 数据仓库初始化完成');
    }

    bootstrap();
})(window);
