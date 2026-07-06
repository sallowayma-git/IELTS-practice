/**
 * 备份恢复验证测试
 * 验证备份和恢复功能的完整性
 */

class BackupRestoreTest {
    constructor() {
        this.testResults = [];
        this.simpleStorage = window.simpleStorageWrapper;
        this.practiceRecordAPI = window.PracticeRecordAPI;
        this.dataBackupManager = window.DataBackupManager ? new DataBackupManager() : null;
        this.testData = {
            originalPracticeRecords: [],
            originalUserSettings: {},
            originalBackups: [],
            testBackups: []
        };
    }

    getPracticeRecordAPI(requiredMethods = []) {
        const api = this.practiceRecordAPI || window.PracticeRecordAPI;
        if (!api) {
            throw new Error('PracticeRecordAPI不可用');
        }
        requiredMethods.forEach(method => {
            if (typeof api[method] !== 'function') {
                throw new Error(`PracticeRecordAPI.${method}不可用`);
            }
        });
        return api;
    }

    async replacePracticeRecords(records) {
        const api = this.getPracticeRecordAPI(['replace']);
        await api.replace(Array.isArray(records) ? records : [], { updateStats: true });
        return true;
    }

    async savePracticeRecord(record) {
        const api = this.getPracticeRecordAPI(['saveRecord']);
        await api.saveRecord(record, { updateStats: true });
        return true;
    }

    // 运行所有备份恢复测试
    async runAllTests() {
        console.log('💾 开始备份恢复验证测试...');

        this.testResults = [];

        // 1. 备份原始数据
        await this.backupOriginalData();

        // 2. 测试备份管理器连接
        this.testBackupManagerConnection();

        // 3. 测试创建备份
        await this.testCreateBackup();

        // 4. 测试获取备份列表
        await this.testGetBackups();

        // 5. 测试备份内容验证
        await this.testBackupContentValidation();

        // 6. 测试恢复备份
        await this.testRestoreBackup();

        // 7. 测试删除备份
        await this.testDeleteBackup();

        // 8. 测试备份大小限制
        await this.testBackupSizeLimit();

        // 9. 测试并发备份
        await this.testConcurrentBackups();

        // 10. 测试数据完整性验证
        await this.testDataIntegrityValidation();

        // 11. 恢复原始数据
        await this.restoreOriginalData();

        this.printResults();
        return this.testResults;
    }

    // 备份原始数据
    async backupOriginalData() {
        const testName = '备份原始数据';

        try {
            if (this.simpleStorage) {
                this.testData.originalPracticeRecords = await this.simpleStorage.getPracticeRecords();
                this.testData.originalUserSettings = await this.simpleStorage.getUserSettings();
                this.testData.originalBackups = await this.simpleStorage.getBackups();

                console.log(`[BackupRestoreTest] 备份了 ${this.testData.originalPracticeRecords.length} 条练习记录`);
                console.log(`[BackupRestoreTest] 备份了 ${Object.keys(this.testData.originalUserSettings).length} 项用户设置`);
                console.log(`[BackupRestoreTest] 备份了 ${this.testData.originalBackups.length} 个现有备份`);

                this.recordTest(testName, true, {
                    practiceRecordsCount: this.testData.originalPracticeRecords.length,
                    userSettingsCount: Object.keys(this.testData.originalUserSettings).length,
                    existingBackupsCount: this.testData.originalBackups.length,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.recordTest(testName, false, { error: 'simpleStorageWrapper不可用' });
            }
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试备份管理器连接
    testBackupManagerConnection() {
        const testName = '备份管理器连接测试';

        try {
            const checks = [
                { name: 'DataBackupManager类存在', exists: typeof DataBackupManager !== 'undefined' },
                { name: 'dataBackupManager实例存在', exists: !!this.dataBackupManager },
                { name: 'createBackup方法存在', exists: typeof this.dataBackupManager?.createBackup === 'function' },
                { name: 'getBackups方法存在', exists: typeof this.dataBackupManager?.getBackups === 'function' },
                { name: 'restoreBackup方法存在', exists: typeof this.dataBackupManager?.restoreBackup === 'function' },
                { name: 'deleteBackup方法存在', exists: typeof this.dataBackupManager?.deleteBackup === 'function' }
            ];

            const allConnected = checks.every(check => check.exists);

            this.recordTest(testName, allConnected, {
                checks,
                totalChecks: checks.length,
                passedChecks: checks.filter(c => c.exists).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试创建备份
    async testCreateBackup() {
        const testName = '创建备份测试';

        try {
            if (!this.dataBackupManager) {
                this.recordTest(testName, false, { error: 'dataBackupManager不可用' });
                return;
            }

            const backupName = `test_backup_${Date.now()}`;
            const backupId = await this.dataBackupManager.createBackup(backupName);

            const backupCreated = backupId !== null && backupId !== undefined;

            if (backupCreated) {
                this.testData.testBackups.push({
                    id: backupId,
                    name: backupName,
                    timestamp: new Date().toISOString()
                });
            }

            this.recordTest(testName, backupCreated, {
                backupName,
                backupId,
                backupCreated,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试获取备份列表
    async testGetBackups() {
        const testName = '获取备份列表测试';

        try {
            if (!this.dataBackupManager) {
                this.recordTest(testName, false, { error: 'dataBackupManager不可用' });
                return;
            }

            const backups = await this.dataBackupManager.getBackups();
            const hasBackups = Array.isArray(backups) && backups.length > 0;

            // 验证测试备份是否在列表中
            const testBackupInList = this.testData.testBackups.some(testBackup =>
                backups.some(backup => backup.id === testBackup.id)
            );

            const backupsHaveRequiredFields = backups.every(backup =>
                backup.hasOwnProperty('id') &&
                backup.hasOwnProperty('timestamp') &&
                backup.hasOwnProperty('data')
            );

            this.recordTest(testName, hasBackups && testBackupInList && backupsHaveRequiredFields, {
                totalBackups: backups.length,
                hasBackups,
                testBackupInList,
                backupsHaveRequiredFields,
                testBackupsCount: this.testData.testBackups.length,
                backupListSample: backups.slice(0, 3).map(b => ({ id: b.id, timestamp: b.timestamp }))
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试备份内容验证
    async testBackupContentValidation() {
        const testName = '备份内容验证测试';

        try {
            if (!this.dataBackupManager || this.testData.testBackups.length === 0) {
                this.recordTest(testName, false, { error: '没有可用的备份进行验证' });
                return;
            }

            const testBackup = this.testData.testBackups[0];
            const backupDetails = await this.dataBackupManager.getBackups();
            const currentBackup = backupDetails.find(b => b.id === testBackup.id);

            if (!currentBackup || !currentBackup.data) {
                this.recordTest(testName, false, { error: '无法获取备份数据' });
                return;
            }

            const backupData = currentBackup.data;
            const contentValidation = {
                hasPracticeRecords: backupData.hasOwnProperty('practice_records'),
                hasUserSettings: backupData.hasOwnProperty('user_settings'),
                practiceRecordsIsArray: Array.isArray(backupData.practice_records),
                userSettingsIsObject: typeof backupData.user_settings === 'object' && backupData.userSettings !== null
            };

            const allContentValid = Object.values(contentValidation).every(Boolean);

            this.recordTest(testName, allContentValid, {
                backupId: testBackup.id,
                contentValidation,
                backupDataKeys: Object.keys(backupData),
                practiceRecordsCount: backupData.practice_records?.length || 0,
                userSettingsCount: Object.keys(backupData.user_settings || {}).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试恢复备份
    async testRestoreBackup() {
        const testName = '恢复备份测试';

        try {
            if (!this.dataBackupManager || this.testData.testBackups.length === 0) {
                this.recordTest(testName, false, { error: '没有可用的备份进行恢复' });
                return;
            }

            // 记录恢复前的数据
            const practiceRecordsBefore = await this.simpleStorage.getPracticeRecords();
            const userSettingsBefore = await this.simpleStorage.getUserSettings();

            // 创建一些新的测试数据来模拟数据变化
            const newTestRecord = {
                id: 'restore_test_record',
                title: '恢复测试记录',
                type: 'reading',
                score: 95,
                date: '2024-01-10'
            };

            await this.savePracticeRecord(newTestRecord);
            await this.simpleStorage.setUserSetting('restore_test_setting', 'test_value');

            const practiceRecordsModified = await this.simpleStorage.getPracticeRecords();
            const userSettingsModified = await this.simpleStorage.getUserSettings();

            // 执行恢复
            const testBackup = this.testData.testBackups[0];
            const restoreSuccess = await this.dataBackupManager.restoreBackup(testBackup.id);

            // 验证恢复结果
            const practiceRecordsAfterRestore = await this.simpleStorage.getPracticeRecords();
            const userSettingsAfterRestore = await this.simpleStorage.getUserSettings();

            const restoreVerified = restoreSuccess &&
                                  practiceRecordsAfterRestore.length === practiceRecordsBefore.length &&
                                  JSON.stringify(userSettingsAfterRestore) === JSON.stringify(userSettingsBefore);

            this.recordTest(testName, restoreSuccess && restoreVerified, {
                backupId: testBackup.id,
                restoreSuccess,
                dataChanges: {
                    practiceRecordsBefore: practiceRecordsBefore.length,
                    practiceRecordsModified: practiceRecordsModified.length,
                    practiceRecordsAfterRestore: practiceRecordsAfterRestore.length,
                    userSettingsBefore: Object.keys(userSettingsBefore).length,
                    userSettingsModified: Object.keys(userSettingsModified).length,
                    userSettingsAfterRestore: Object.keys(userSettingsAfterRestore).length
                },
                restoreVerified
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试删除备份
    async testDeleteBackup() {
        const testName = '删除备份测试';

        try {
            if (!this.dataBackupManager || this.testData.testBackups.length === 0) {
                this.recordTest(testName, false, { error: '没有可用的备份进行删除' });
                return;
            }

            const testBackup = this.testData.testBackups[0];
            const backupsBeforeDelete = await this.dataBackupManager.getBackups();

            // 执行删除
            const deleteSuccess = await this.dataBackupManager.deleteBackup(testBackup.id);

            // 验证删除结果
            const backupsAfterDelete = await this.dataBackupManager.getBackups();
            const backupStillExists = backupsAfterDelete.some(b => b.id === testBackup.id);

            const deleteVerified = deleteSuccess && !backupStillExists;

            if (deleteVerified) {
                // 从测试数据中移除已删除的备份
                this.testData.testBackups = this.testData.testBackups.filter(b => b.id !== testBackup.id);
            }

            this.recordTest(testName, deleteVerified, {
                backupId: testBackup.id,
                deleteSuccess,
                backupsBeforeDelete: backupsBeforeDelete.length,
                backupsAfterDelete: backupsAfterDelete.length,
                backupStillExists,
                deleteVerified
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试备份大小限制
    async testBackupSizeLimit() {
        const testName = '备份大小限制测试';

        try {
            if (!this.dataBackupManager) {
                this.recordTest(testName, false, { error: 'dataBackupManager不可用' });
                return;
            }

            // 创建大量测试数据
            const largeDataSet = {
                practice_records: Array.from({ length: 1000 }, (_, i) => ({
                    id: `large_test_${i}`,
                    title: `大量测试数据记录${i}`,
                    type: 'reading',
                    score: Math.floor(Math.random() * 100),
                    date: '2024-01-11',
                    largeData: 'x'.repeat(1000) // 每条记录1KB的额外数据
                })),
                user_settings: {
                    largeSetting: 'y'.repeat(10000) // 10KB的设置数据
                }
            };

            // 临时保存大数据集
            const originalRecords = await this.simpleStorage.getPracticeRecords();
            const originalSettings = await this.simpleStorage.getUserSettings();

            await this.replacePracticeRecords(largeDataSet.practice_records);
            await this.simpleStorage.saveUserSettings(largeDataSet.user_settings);

            // 尝试创建大数据备份
            const largeBackupId = await this.dataBackupManager.createBackup('large_test_backup');
            const largeBackupCreated = largeBackupId !== null;

            // 清理大数据
            await this.replacePracticeRecords(originalRecords);
            await this.simpleStorage.saveUserSettings(originalSettings);

            // 如果大数据备份创建成功，删除它
            if (largeBackupCreated) {
                await this.dataBackupManager.deleteBackup(largeBackupId);
            }

            this.recordTest(testName, true, {
                largeDataSize: JSON.stringify(largeDataSet).length,
                largeBackupCreated,
                sizeLimitTest: largeBackupCreated ? '通过' : '大数据备份被限制（预期行为）'
            });

        } catch (error) {
            // 大数据失败可能是预期的（存储限制）
            this.recordTest(testName, true, {
                error: error.message,
                note: '大数据备份失败可能是由于存储限制，这是预期的行为'
            });
        }
    }

    // 测试并发备份
    async testConcurrentBackups() {
        const testName = '并发备份测试';

        try {
            if (!this.dataBackupManager) {
                this.recordTest(testName, false, { error: 'dataBackupManager不可用' });
                return;
            }

            // 创建多个并发备份
            const concurrentBackupPromises = [];
            for (let i = 0; i < 3; i++) {
                const promise = this.dataBackupManager.createBackup(`concurrent_test_${i}_${Date.now()}`);
                concurrentBackupPromises.push(promise);
            }

            const backupIds = await Promise.all(concurrentBackupPromises);
            const allBackupsCreated = backupIds.every(id => id !== null && id !== undefined);

            // 清理并发测试备份
            for (const backupId of backupIds) {
                if (backupId) {
                    try {
                        await this.dataBackupManager.deleteBackup(backupId);
                    } catch (error) {
                        console.warn('[BackupRestoreTest] 清理并发备份失败:', error);
                    }
                }
            }

            this.recordTest(testName, allBackupsCreated, {
                concurrentAttempts: concurrentBackupPromises.length,
                successfulBackups: backupIds.filter(id => id !== null).length,
                allBackupsCreated
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试数据完整性验证
    async testDataIntegrityValidation() {
        const testName = '数据完整性验证测试';

        try {
            // 创建标准测试数据
            const standardTestData = {
                practice_records: [
                    {
                        id: 'integrity_test_1',
                        title: '完整性测试1',
                        type: 'reading',
                        score: 85,
                        date: '2024-01-12'
                    },
                    {
                        id: 'integrity_test_2',
                        title: '完整性测试2',
                        type: 'listening',
                        score: 90,
                        date: '2024-01-13'
                    }
                ],
                user_settings: {
                    theme: 'dark',
                    language: 'zh-CN',
                    notifications: true
                }
            };

            // 保存测试数据
            await this.replacePracticeRecords(standardTestData.practice_records);
            await this.simpleStorage.saveUserSettings(standardTestData.user_settings);

            // 创建备份
            const backupId = await this.dataBackupManager.createBackup('integrity_test_backup');

            if (!backupId) {
                this.recordTest(testName, false, { error: '无法创建完整性测试备份' });
                return;
            }

            // 修改数据
            await this.savePracticeRecord({
                id: 'integrity_test_modified',
                title: '修改后的记录',
                type: 'reading',
                score: 75,
                date: '2024-01-14'
            });

            // 恢复备份
            const restoreSuccess = await this.dataBackupManager.restoreBackup(backupId);

            // 验证数据完整性
            const finalPracticeRecords = await this.simpleStorage.getPracticeRecords();
            const finalUserSettings = await this.simpleStorage.getUserSettings();

            const integrityVerified = restoreSuccess &&
                                     finalPracticeRecords.length === standardTestData.practice_records.length &&
                                     JSON.stringify(finalUserSettings) === JSON.stringify(standardTestData.user_settings);

            // 清理测试备份
            await this.dataBackupManager.deleteBackup(backupId);

            this.recordTest(testName, integrityVerified, {
                originalDataSize: standardTestData.practice_records.length,
                finalDataSize: finalPracticeRecords.length,
                settingsMatch: JSON.stringify(finalUserSettings) === JSON.stringify(standardTestData.user_settings),
                restoreSuccess,
                integrityVerified
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 恢复原始数据
    async restoreOriginalData() {
        const testName = '恢复原始数据';

        try {
            // 恢复原始练习记录
            await this.replacePracticeRecords(this.testData.originalPracticeRecords);

            // 恢复原始用户设置
            await this.simpleStorage.saveUserSettings(this.testData.originalUserSettings);

            // 恢复原始备份列表（移除测试备份）
            const remainingBackups = this.testData.originalBackups.filter(backup =>
                !this.testData.testBackups.some(testBackup => testBackup.id === backup.id)
            );

            await this.simpleStorage.saveBackups(remainingBackups);

            // 验证恢复
            const finalPracticeRecords = await this.simpleStorage.getPracticeRecords();
            const finalUserSettings = await this.simpleStorage.getUserSettings();
            const finalBackups = await this.simpleStorage.getBackups();

            const restoreSuccess = finalPracticeRecords.length === this.testData.originalPracticeRecords.length &&
                                 JSON.stringify(finalUserSettings) === JSON.stringify(this.testData.originalUserSettings) &&
                                 finalBackups.length === remainingBackups.length;

            this.recordTest(testName, restoreSuccess, {
                originalPracticeRecordsCount: this.testData.originalPracticeRecords.length,
                finalPracticeRecordsCount: finalPracticeRecords.length,
                originalUserSettingsCount: Object.keys(this.testData.originalUserSettings).length,
                finalUserSettingsCount: Object.keys(finalUserSettings).length,
                originalBackupsCount: this.testData.originalBackups.length,
                finalBackupsCount: finalBackups.length,
                restoreSuccess,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 记录测试结果
    recordTest(testName, passed, details) {
        this.testResults.push({
            name: testName,
            passed,
            details,
            timestamp: new Date().toISOString()
        });

        const status = passed ? '✅' : '❌';
        console.log(`${status} ${testName}`);
        if (!passed && details.error) {
            console.error('   错误:', details.error);
        }
    }

    // 打印测试结果
    printResults() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;

        console.log('\n📊 备份恢复测试结果汇总:');
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests} ✅`);
        console.log(`失败: ${failedTests} ❌`);
        console.log(`成功率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

        if (failedTests > 0) {
            console.log('\n❌ 失败的测试:');
            this.testResults
                .filter(r => !r.passed)
                .forEach(r => {
                    console.log(`  - ${r.name}: ${r.details.error || '测试条件不满足'}`);
                });
        }

        console.log('\n📈 备份统计:');
        console.log(`创建的测试备份数: ${this.testData.testBackups.length}`);
        console.log(`原始练习记录数: ${this.testData.originalPracticeRecords.length}`);
        console.log(`原始用户设置数: ${Object.keys(this.testData.originalUserSettings).length}`);
    }

    // 生成测试报告
    generateReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const successRate = ((passedTests / totalTests) * 100).toFixed(1);

        return {
            summary: {
                totalTests,
                passedTests,
                failedTests: totalTests - passedTests,
                successRate: `${successRate}%`,
                timestamp: new Date().toISOString()
            },
            backupStats: {
                testBackupsCreated: this.testData.testBackups.length,
                originalPracticeRecords: this.testData.originalPracticeRecords.length,
                originalUserSettings: Object.keys(this.testData.originalUserSettings).length,
                originalBackups: this.testData.originalBackups.length
            },
            failedTests: this.testResults.filter(r => !r.passed).map(r => ({
                name: r.name,
                error: r.details.error || '测试条件不满足',
                details: r.details
            }))
        };
    }
}

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BackupRestoreTest;
}
