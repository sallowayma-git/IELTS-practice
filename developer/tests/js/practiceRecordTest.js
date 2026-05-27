/**
 * Practice记录增删测试
 * 验证练习记录管理功能的完整性
 */

class PracticeRecordTest {
    constructor() {
        this.testResults = [];
        this.testRecords = [];
        this.originalRecords = [];
        this.simpleStorage = window.simpleStorageWrapper;
        this.practiceRecordAPI = window.PracticeRecordAPI;
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

    async listPracticeRecords() {
        const api = this.getPracticeRecordAPI(['list']);
        return await api.list();
    }

    async getPracticeRecordById(id) {
        const api = this.getPracticeRecordAPI(['getById']);
        return await api.getById(id);
    }

    async savePracticeRecord(record) {
        const api = this.getPracticeRecordAPI(['saveRecord']);
        await api.saveRecord(record, { updateStats: true });
        return true;
    }

    async replacePracticeRecords(records) {
        const api = this.getPracticeRecordAPI(['replace']);
        await api.replace(Array.isArray(records) ? records : [], { updateStats: true });
        return true;
    }

    async deletePracticeRecord(id) {
        const api = this.getPracticeRecordAPI(['deleteById']);
        const result = await api.deleteById(id, { updateStats: true });
        return Boolean(result && result.deleted);
    }

    async deletePracticeRecords(ids) {
        const api = this.getPracticeRecordAPI(['deleteMany']);
        const result = await api.deleteMany(ids, { updateStats: true });
        return Number(result && result.deletedCount) || 0;
    }

    // 运行所有Practice记录测试
    async runAllTests() {
        console.log('📝 开始Practice记录增删测试...');

        this.testResults = [];

        // 1. 备份原始数据
        await this.backupOriginalData();

        // 2. 测试存储连接
        this.testStorageConnection();

        // 3. 测试创建记录
        await this.testCreateRecord();

        // 4. 测试获取记录
        await this.testGetRecords();

        // 5. 测试更新记录
        await this.testUpdateRecord();

        // 6. 测试删除记录
        await this.testDeleteRecord();

        // 7. 测试批量操作
        await this.testBatchOperations();

        // 8. 测试数据验证
        await this.testDataValidation();

        // 9. 测试边界情况
        await this.testEdgeCases();

        // 10. 恢复原始数据
        await this.restoreOriginalData();

        this.printResults();
        return this.testResults;
    }

    // 备份原始数据
    async backupOriginalData() {
        const testName = '备份原始数据';

        try {
            if (this.practiceRecordAPI) {
                this.originalRecords = await this.listPracticeRecords();
                console.log(`[PracticeRecordTest] 备份了 ${this.originalRecords.length} 条原始记录`);
                this.recordTest(testName, true, {
                    backupCount: this.originalRecords.length,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.recordTest(testName, false, { error: 'PracticeRecordAPI不可用' });
            }
        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试存储连接
    testStorageConnection() {
        const testName = '存储连接测试';

        try {
            const checks = [
                { name: 'simpleStorageWrapper只读兼容存在', exists: !!this.simpleStorage },
                { name: 'getPracticeRecords只读方法存在', exists: typeof this.simpleStorage?.getPracticeRecords === 'function' },
                { name: 'PracticeRecordAPI存在', exists: !!this.practiceRecordAPI },
                { name: 'PracticeRecordAPI.saveRecord方法存在', exists: typeof this.practiceRecordAPI?.saveRecord === 'function' },
                { name: 'PracticeRecordAPI.deleteById方法存在', exists: typeof this.practiceRecordAPI?.deleteById === 'function' }
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

    // 测试创建记录
    async testCreateRecord() {
        const testName = '创建记录测试';

        try {
            const newRecords = [
                {
                    id: 'test_record_1',
                    title: '雅思阅读测试1',
                    type: 'reading',
                    score: 85,
                    totalQuestions: 40,
                    correctAnswers: 34,
                    date: '2024-01-01',
                    timeSpent: 1800, // 30分钟
                    difficulty: 'medium'
                },
                {
                    id: 'test_record_2',
                    title: '雅思听力测试1',
                    type: 'listening',
                    score: 92,
                    totalQuestions: 40,
                    correctAnswers: 37,
                    date: '2024-01-02',
                    timeSpent: 1500, // 25分钟
                    difficulty: 'hard'
                },
                {
                    id: 'test_record_3',
                    title: '雅思阅读测试2',
                    type: 'reading',
                    score: 78,
                    totalQuestions: 40,
                    correctAnswers: 31,
                    date: '2024-01-03',
                    timeSpent: 2000, // 33分钟
                    difficulty: 'easy'
                }
            ];

            const createResults = [];

            for (const record of newRecords) {
                try {
                    const success = await this.savePracticeRecord(record);
                    createResults.push({
                        recordId: record.id,
                        success,
                        record: record
                    });

                    if (success) {
                        this.testRecords.push(record);
                    }
                } catch (error) {
                    createResults.push({
                        recordId: record.id,
                        success: false,
                        error: error.message
                    });
                }
            }

            const allCreated = createResults.every(r => r.success);

            this.recordTest(testName, allCreated, {
                createResults,
                totalRecords: newRecords.length,
                successfulCreates: createResults.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试获取记录
    async testGetRecords() {
        const testName = '获取记录测试';

        try {
            // 获取所有记录
            const allRecords = await this.listPracticeRecords();

            // 验证测试记录是否被正确保存
            const foundTestRecords = this.testRecords.filter(testRecord =>
                allRecords.some(savedRecord => savedRecord.id === testRecord.id)
            );

            // 测试单个记录获取
            const singleRecordResults = [];
            for (const testRecord of this.testRecords) {
                try {
                    const foundRecord = await this.getPracticeRecordById(testRecord.id);
                    singleRecordResults.push({
                        recordId: testRecord.id,
                        success: foundRecord !== null && foundRecord.id === testRecord.id
                    });
                } catch (error) {
                    singleRecordResults.push({
                        recordId: testRecord.id,
                        success: false,
                        error: error.message
                    });
                }
            }

            const allFound = foundTestRecords.length === this.testRecords.length;
            const allSinglesFound = singleRecordResults.every(r => r.success);

            this.recordTest(testName, allFound && allSinglesFound, {
                totalRecordsInStorage: allRecords.length,
                testRecordsCreated: this.testRecords.length,
                foundTestRecords: foundTestRecords.length,
                singleRecordResults,
                getAllSuccess: allFound,
                getByIdSuccess: allSinglesFound
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试更新记录
    async testUpdateRecord() {
        const testName = '更新记录测试';

        try {
            if (this.testRecords.length === 0) {
                this.recordTest(testName, false, { error: '没有测试记录可供更新' });
                return;
            }

            const updateRecord = this.testRecords[0];
            const originalScore = updateRecord.score;

            // 更新数据
            const updates = {
                score: 90,
                timeSpent: 1600,
                notes: '更新后的笔记'
            };

            const updateSuccess = await this.savePracticeRecord({ ...updateRecord, ...updates });

            // 验证更新
            const updatedRecord = await this.getPracticeRecordById(updateRecord.id);
            const updateVerified = updatedRecord !== null &&
                                 updatedRecord.score === updates.score &&
                                 updatedRecord.timeSpent === updates.timeSpent &&
                                 updatedRecord.notes === updates.notes;

            // 恢复原始数据（用于其他测试）
            if (updateSuccess) {
                await this.savePracticeRecord({ ...updatedRecord, score: originalScore });
            }

            this.recordTest(testName, updateSuccess && updateVerified, {
                recordId: updateRecord.id,
                originalScore,
                updates,
                updateSuccess,
                updateVerified,
                updatedScore: updatedRecord?.score
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试删除记录
    async testDeleteRecord() {
        const testName = '删除记录测试';

        try {
            if (this.testRecords.length < 2) {
                this.recordTest(testName, false, { error: '测试记录不足，无法进行删除测试' });
                return;
            }

            const recordToDelete = this.testRecords.pop(); // 删除最后一个测试记录
            const recordsBeforeDelete = (await this.listPracticeRecords()).length;

            // 执行删除
            const deleteSuccess = await this.deletePracticeRecord(recordToDelete.id);

            // 验证删除
            const recordsAfterDelete = (await this.listPracticeRecords()).length;
            const deleteVerified = recordsAfterDelete === recordsBeforeDelete - 1;

            // 确认记录确实被删除
            const deletedRecordExists = (await this.getPracticeRecordById(recordToDelete.id)) !== null;

            const fullyDeleted = deleteSuccess && deleteVerified && !deletedRecordExists;

            this.recordTest(testName, fullyDeleted, {
                deletedRecordId: recordToDelete.id,
                recordsBeforeDelete,
                recordsAfterDelete,
                deleteSuccess,
                deleteVerified,
                recordStillExists: deletedRecordExists
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试批量操作
    async testBatchOperations() {
        const testName = '批量操作测试';

        try {
            // 创建更多测试记录用于批量操作
            const batchRecords = [
                {
                    id: 'batch_test_1',
                    title: '批量测试1',
                    type: 'reading',
                    score: 75,
                    date: '2024-01-04'
                },
                {
                    id: 'batch_test_2',
                    title: '批量测试2',
                    type: 'listening',
                    score: 88,
                    date: '2024-01-05'
                }
            ];

            // 批量添加
            let batchAddSuccess = true;
            const addedIds = [];
            for (const record of batchRecords) {
                const success = await this.savePracticeRecord(record);
                if (success) {
                    addedIds.push(record.id);
                } else {
                    batchAddSuccess = false;
                }
            }

            // 批量删除
            const recordsBeforeBatchDelete = (await this.listPracticeRecords()).length;
            const deletedCount = await this.deletePracticeRecords(addedIds);
            const batchDeleteSuccess = deletedCount === addedIds.length;
            const recordsAfterBatchDelete = (await this.listPracticeRecords()).length;

            const batchDeleteVerified = recordsAfterBatchDelete === recordsBeforeBatchDelete - addedIds.length;

            this.recordTest(testName, batchAddSuccess && batchDeleteSuccess && batchDeleteVerified, {
                batchRecordsCount: batchRecords.length,
                batchAddSuccess,
                addedIds: addedIds.length,
                batchDeleteSuccess,
                recordsBeforeBatchDelete,
                recordsAfterBatchDelete,
                batchDeleteVerified
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试数据验证
    async testDataValidation() {
        const testName = '数据验证测试';

        try {
            const validationResults = [];

            // 测试有效记录
            const validRecord = {
                id: 'validation_test_valid',
                title: '有效记录测试',
                type: 'reading',
                score: 85,
                date: '2024-01-06'
            };

            const validValidation = this.simpleStorage.validatePracticeRecord(validRecord);
            validationResults.push({
                type: 'valid_record',
                success: validValidation.isValid,
                details: validValidation
            });

            // 测试无效记录（缺少必需字段）
            const invalidRecords = [
                {
                    // 缺少id
                    title: '无效记录测试1',
                    type: 'reading',
                    score: 85,
                    date: '2024-01-06'
                },
                {
                    id: 'invalid_test_2',
                    // 缺少type
                    title: '无效记录测试2',
                    score: 85,
                    date: '2024-01-06'
                },
                {
                    id: 'invalid_test_3',
                    title: '无效记录测试3',
                    type: 'reading',
                    // 缺少score
                    date: '2024-01-06'
                },
                {
                    id: 'invalid_test_4',
                    title: '无效记录测试4',
                    type: 'reading',
                    score: 85
                    // 缺少date
                }
            ];

            invalidRecords.forEach((record, index) => {
                const validation = this.simpleStorage.validatePracticeRecord(record);
                validationResults.push({
                    type: `invalid_record_${index + 1}`,
                    success: !validation.isValid, // 应该验证失败
                    details: validation
                });
            });

            const allValidationsCorrect = validationResults.every(r => r.success);

            this.recordTest(testName, allValidationsCorrect, {
                validationResults,
                totalValidations: validationResults.length,
                correctValidations: validationResults.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 测试边界情况
    async testEdgeCases() {
        const testName = '边界情况测试';

        try {
            const edgeCaseResults = [];

            // 测试空记录
            const emptyRecord = { id: 'empty_test', title: '', type: '', score: 0, date: '' };
            const emptyValidation = this.simpleStorage.validatePracticeRecord(emptyRecord);
            edgeCaseResults.push({
                case: 'empty_record',
                success: !emptyValidation.isValid,
                details: emptyValidation
            });

            // 测试极值分数
            const extremeScoreRecord = {
                id: 'extreme_score_test',
                title: '极值分数测试',
                type: 'reading',
                score: 150, // 超过100
                date: '2024-01-07'
            };
            const extremeScoreValidation = this.simpleStorage.validatePracticeRecord(extremeScoreRecord);
            edgeCaseResults.push({
                case: 'extreme_score',
                success: extremeScoreValidation.isValid, // 结构有效，值是否合理由业务逻辑处理
                details: extremeScoreValidation
            });

            // 测试特殊字符
            const specialCharRecord = {
                id: 'special_char_test',
                title: '特殊字符测试 🚀',
                type: 'reading',
                score: 85,
                date: '2024-01-08'
            };
            const specialCharValidation = this.simpleStorage.validatePracticeRecord(specialCharRecord);
            edgeCaseResults.push({
                case: 'special_characters',
                success: specialCharValidation.isValid,
                details: specialCharValidation
            });

            // 测试超长标题
            const longTitleRecord = {
                id: 'long_title_test',
                title: '这是一个非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题测试',
                type: 'reading',
                score: 85,
                date: '2024-01-09'
            };
            const longTitleValidation = this.simpleStorage.validatePracticeRecord(longTitleRecord);
            edgeCaseResults.push({
                case: 'long_title',
                success: longTitleValidation.isValid,
                details: longTitleValidation
            });

            const allEdgeCasesPassed = edgeCaseResults.every(r => r.success);

            this.recordTest(testName, allEdgeCasesPassed, {
                edgeCaseResults,
                totalEdgeCases: edgeCaseResults.length,
                passedEdgeCases: edgeCaseResults.filter(r => r.success).length
            });

        } catch (error) {
            this.recordTest(testName, false, { error: error.message });
        }
    }

    // 恢复原始数据
    async restoreOriginalData() {
        const testName = '恢复原始数据';

        try {
            // 清理所有测试记录
            await this.replacePracticeRecords(this.originalRecords);

            // 验证恢复
            const finalRecords = await this.listPracticeRecords();
            const expectedCount = this.originalRecords.length;
            const restoreSuccess = finalRecords.length === expectedCount;

            this.recordTest(testName, restoreSuccess, {
                originalCount: this.originalRecords.length,
                finalCount: finalRecords.length,
                expectedCount,
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

        console.log('\n📊 Practice记录测试结果汇总:');
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

        console.log('\n📈 操作统计:');
        console.log(`测试创建记录数: ${this.testRecords.length}`);
        console.log(`原始记录备份数: ${this.originalRecords.length}`);
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
            operationStats: {
                testRecordsCreated: this.testRecords.length,
                originalRecordsBackedUp: this.originalRecords.length
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
    module.exports = PracticeRecordTest;
}
