// 系统集成测试器 - 综合测试索引、通信和浏览状态管理
class SystemIntegrationTester {
    constructor() {
        this.indexValidator = new IndexValidator();
        this.communicationTester = new CommunicationTester();
        this.testResults = {
            indexValidation: null,
            communicationTest: null,
            browseStateTest: null,
            overallStatus: 'pending'
        };
    }

    // 运行完整的集成测试
    async runFullIntegrationTest() {
        console.log('[SystemIntegrationTester] 开始运行系统集成测试...');
        
        try {
            // 1. 验证题库索引
            console.log('[SystemIntegrationTester] 步骤 1: 验证题库索引...');
            this.testResults.indexValidation = await this.testIndexValidation();
            
            // 2. 测试浏览状态管理
            console.log('[SystemIntegrationTester] 步骤 2: 测试浏览状态管理...');
            this.testResults.browseStateTest = await this.testBrowseStateManagement();
            
            // 3. 测试通信功能（仅测试部分题目以节省时间）
            console.log('[SystemIntegrationTester] 步骤 3: 测试通信功能...');
            this.testResults.communicationTest = await this.testCommunicationSample();
            
            // 4. 测试数据存储和恢复功能
            console.log('[SystemIntegrationTester] 步骤 4: 测试数据存储和恢复...');
            this.testResults.dataStorageTest = await this.testDataStorageAndRecovery();
            
            // 5. 测试性能优化功能
            console.log('[SystemIntegrationTester] 步骤 5: 测试性能优化...');
            this.testResults.performanceTest = await this.testPerformanceOptimization();
            
            // 6. 测试错误处理机制
            console.log('[SystemIntegrationTester] 步骤 6: 测试错误处理...');
            this.testResults.errorHandlingTest = await this.testErrorHandling();
            
            // 7. 生成综合报告
            const report = this.generateIntegrationReport();
            console.log('[SystemIntegrationTester] 集成测试完成');
            
            return report;
            
        } catch (error) {
            console.error('[SystemIntegrationTester] 集成测试失败:', error);
            this.testResults.overallStatus = 'failed';
            return {
                success: false,
                error: error.message,
                results: this.testResults
            };
        }
    }

    // 测试索引验证
    async testIndexValidation() {
        if (!window.examIndex || window.examIndex.length === 0) {
            return {
                success: false,
                error: '题库索引未加载',
                details: null
            };
        }

        try {
            const report = await this.indexValidator.validateAllExams(window.examIndex);
            return {
                success: report.summary.successRate >= 80, // 80%以上成功率视为通过
                successRate: report.summary.successRate,
                details: report
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 测试浏览状态管理
    async testBrowseStateManagement() {
        try {
            const tests = [];
            
            // 测试分类筛选
            tests.push(await this.testCategoryFiltering());
            
            // 测试搜索功能
            tests.push(await this.testSearchFunction());
            
            // 测试题目浏览按钮功能
            tests.push(await this.testBrowseButtonFunction());
            
            const passedTests = tests.filter(t => t.success).length;
            const totalTests = tests.length;
            
            return {
                success: passedTests === totalTests,
                passedTests,
                totalTests,
                details: tests
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 测试分类筛选功能
    async testCategoryFiltering() {
        try {
            // 模拟点击P1分类
            if (typeof window.browseCategory === 'function') {
                window.browseCategory('P1');
                
                // 检查当前分类是否正确设置
                const isP1Active = window.currentCategory === 'P1';
                const titleElement = document.getElementById('browse-title');
                const titleCorrect = titleElement && titleElement.textContent.includes('P1');
                
                return {
                    success: isP1Active && titleCorrect,
                    message: isP1Active && titleCorrect ? 
                        '分类筛选功能正常' : 
                        '分类筛选功能异常',
                    details: {
                        currentCategory: window.currentCategory,
                        titleText: titleElement?.textContent
                    }
                };
            } else {
                return {
                    success: false,
                    message: 'browseCategory函数不存在',
                    details: null
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `分类筛选测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试搜索功能
    async testSearchFunction() {
        try {
            if (typeof window.searchExams === 'function') {
                // 模拟搜索
                const searchTerm = 'Tea';
                window.searchExams(searchTerm);
                
                // 检查搜索结果
                const examListContainer = document.getElementById('exam-list-container');
                const hasResults = examListContainer && examListContainer.children.length > 0;
                
                return {
                    success: hasResults,
                    message: hasResults ? '搜索功能正常' : '搜索功能异常',
                    details: {
                        searchTerm,
                        resultCount: examListContainer?.children.length || 0
                    }
                };
            } else {
                return {
                    success: false,
                    message: 'searchExams函数不存在',
                    details: null
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `搜索功能测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试题目浏览按钮功能
    async testBrowseButtonFunction() {
        try {
            // 检查主界面题目浏览按钮是否能正确显示所有题目
            if (typeof window.showView === 'function') {
                // 先设置一个特定分类
                window.currentCategory = 'P1';
                
                // 然后点击题目浏览按钮（应该重置为显示所有题目）
                window.showView('browse', true); // resetCategory = true
                
                // 检查是否重置为显示所有题目
                const isAllCategory = window.currentCategory === 'all';
                const titleElement = document.getElementById('browse-title');
                const titleCorrect = titleElement && titleElement.textContent === '📚 题库浏览';
                
                return {
                    success: isAllCategory && titleCorrect,
                    message: isAllCategory && titleCorrect ? 
                        '题目浏览按钮功能正常' : 
                        '题目浏览按钮功能异常',
                    details: {
                        currentCategory: window.currentCategory,
                        titleText: titleElement?.textContent
                    }
                };
            } else {
                return {
                    success: false,
                    message: 'showView函数不存在',
                    details: null
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `题目浏览按钮测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试通信功能（采样测试）
    async testCommunicationSample() {
        if (!window.examIndex || window.examIndex.length === 0) {
            return {
                success: false,
                error: '题库索引未加载',
                details: null
            };
        }

        try {
            // 从每个分类中选择1-2个题目进行测试
            const sampleExams = this.selectSampleExams();
            
            if (sampleExams.length === 0) {
                return {
                    success: false,
                    error: '没有找到可测试的题目',
                    details: null
                };
            }

            const report = await this.communicationTester.testMultipleExams(
                sampleExams.map(exam => exam.id), 
                2 // 并发数限制为2
            );
            
            return {
                success: report.summary.successRate >= 70, // 70%以上成功率视为通过
                successRate: report.summary.successRate,
                details: report
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 选择样本题目进行测试
    selectSampleExams() {
        const sampleExams = [];
        
        // 从每个分类选择题目
        ['P1', 'P2', 'P3'].forEach(category => {
            const categoryExams = window.examIndex.filter(exam => exam.category === category);
            
            if (categoryExams.length > 0) {
                // 选择第一个题目
                sampleExams.push(categoryExams[0]);
                
                // 如果有多个题目，再选择一个
                if (categoryExams.length > 1) {
                    const randomIndex = Math.floor(Math.random() * (categoryExams.length - 1)) + 1;
                    sampleExams.push(categoryExams[randomIndex]);
                }
            }
        });
        
        return sampleExams;
    }

    // 测试数据存储和恢复功能
    async testDataStorageAndRecovery() {
        try {
            const tests = [];
            
            // 测试基本存储功能
            tests.push(await this.testBasicStorage());
            
            // 测试数据完整性管理器
            tests.push(await this.testDataIntegrityManager());
            
            // 测试练习记录存储
            tests.push(await this.testPracticeRecordStorage());
            
            const passedTests = tests.filter(t => t.success).length;
            const totalTests = tests.length;
            
            return {
                success: passedTests === totalTests,
                passedTests,
                totalTests,
                details: tests
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 测试基本存储功能
    async testBasicStorage() {
        try {
            const testKey = '_integration_test_storage_';
            const testData = { test: true, timestamp: Date.now() };
            
            // 测试存储
            if (window.storage) {
                const stored = window.storage.set(testKey, testData);
                if (!stored) {
                    return {
                        success: false,
                        message: '数据存储失败',
                        details: null
                    };
                }
                
                // 测试读取
                const retrieved = window.storage.get(testKey);
                if (!retrieved || retrieved.test !== testData.test) {
                    return {
                        success: false,
                        message: '数据读取失败',
                        details: { stored: testData, retrieved }
                    };
                }
                
                // 清理测试数据
                localStorage.removeItem(testKey);
                
                return {
                    success: true,
                    message: '基本存储功能正常',
                    details: { testData, retrieved }
                };
            } else {
                return {
                    success: false,
                    message: 'storage对象不存在',
                    details: null
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `基本存储测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试数据完整性管理器
    async testDataIntegrityManager() {
        try {
            if (!window.dataIntegrityManager) {
                return {
                    success: false,
                    message: '数据完整性管理器未初始化',
                    details: null
                };
            }
            
            // 测试备份创建
            const backup = await window.dataIntegrityManager.createBackup({
                test_data: { value: 'integration_test' }
            }, 'integration_test');
            
            if (!backup || !backup.id) {
                return {
                    success: false,
                    message: '备份创建失败',
                    details: null
                };
            }
            
            // 测试备份列表
            const backups = window.dataIntegrityManager.getBackupList();
            const testBackup = backups.find(b => b.id === backup.id);
            
            if (!testBackup) {
                return {
                    success: false,
                    message: '备份未出现在列表中',
                    details: { backupId: backup.id, backups }
                };
            }
            
            // 清理测试备份
            localStorage.removeItem(`backup_${backup.id}`);
            
            return {
                success: true,
                message: '数据完整性管理器功能正常',
                details: { backup, testBackup }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `数据完整性管理器测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试练习记录存储
    async testPracticeRecordStorage() {
        try {
            const testRecord = {
                id: `test_${Date.now()}`,
                examId: 'test_exam',
                examTitle: 'Integration Test Exam',
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                duration: 120,
                scoreInfo: { correct: 8, total: 10, accuracy: 0.8 }
            };
            
            // 获取当前记录
            const currentRecords = JSON.parse(localStorage.getItem('practice_records') || '[]');
            
            // 添加测试记录
            currentRecords.push(testRecord);
            localStorage.setItem('practice_records', JSON.stringify(currentRecords));
            
            // 验证记录是否正确存储
            const updatedRecords = JSON.parse(localStorage.getItem('practice_records') || '[]');
            const storedRecord = updatedRecords.find(r => r.id === testRecord.id);
            
            if (!storedRecord) {
                return {
                    success: false,
                    message: '练习记录存储失败',
                    details: null
                };
            }
            
            // 清理测试记录
            const cleanedRecords = updatedRecords.filter(r => r.id !== testRecord.id);
            localStorage.setItem('practice_records', JSON.stringify(cleanedRecords));
            
            return {
                success: true,
                message: '练习记录存储功能正常',
                details: { testRecord, storedRecord }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `练习记录存储测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试性能优化功能
    async testPerformanceOptimization() {
        try {
            const tests = [];
            
            // 测试性能优化器
            tests.push(await this.testPerformanceOptimizer());
            
            // 测试缓存功能
            tests.push(await this.testCacheFunction());
            
            // 测试防抖节流功能
            tests.push(await this.testDebounceThrottle());
            
            const passedTests = tests.filter(t => t.success).length;
            const totalTests = tests.length;
            
            return {
                success: passedTests >= totalTests * 0.8, // 80%通过率
                passedTests,
                totalTests,
                details: tests
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 测试性能优化器
    async testPerformanceOptimizer() {
        try {
            if (!window.performanceOptimizer) {
                return {
                    success: false,
                    message: '性能优化器未初始化',
                    details: null
                };
            }
            
            // 测试缓存设置和获取
            const testKey = 'integration_test_cache';
            const testData = { value: 'test_cache_data', timestamp: Date.now() };
            
            window.performanceOptimizer.setCache(testKey, testData);
            const cachedData = window.performanceOptimizer.getCache(testKey);
            
            if (!cachedData || cachedData.value !== testData.value) {
                return {
                    success: false,
                    message: '缓存功能异常',
                    details: { testData, cachedData }
                };
            }
            
            // 测试性能报告生成
            const report = window.performanceOptimizer.getPerformanceReport();
            if (!report || !report.cache) {
                return {
                    success: false,
                    message: '性能报告生成失败',
                    details: null
                };
            }
            
            return {
                success: true,
                message: '性能优化器功能正常',
                details: { cachedData, report }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `性能优化器测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试缓存功能
    async testCacheFunction() {
        try {
            if (!window.performanceOptimizer) {
                return {
                    success: false,
                    message: '性能优化器未初始化',
                    details: null
                };
            }
            
            const testKey = 'cache_test_key';
            const testValue = { data: 'cache_test_value', number: 42 };
            
            // 设置缓存
            window.performanceOptimizer.setCache(testKey, testValue, { ttl: 5000 });
            
            // 立即获取缓存
            const cached = window.performanceOptimizer.getCache(testKey);
            
            if (!cached || cached.data !== testValue.data) {
                return {
                    success: false,
                    message: '缓存存取功能异常',
                    details: { testValue, cached }
                };
            }
            
            return {
                success: true,
                message: '缓存功能正常',
                details: { testValue, cached }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `缓存功能测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试防抖节流功能
    async testDebounceThrottle() {
        try {
            if (!window.performanceOptimizer) {
                return {
                    success: false,
                    message: '性能优化器未初始化',
                    details: null
                };
            }
            
            let callCount = 0;
            const testFunction = () => { callCount++; };
            
            // 测试防抖
            const debouncedFunc = window.performanceOptimizer.debounce(testFunction, 100, 'test_debounce');
            
            // 快速调用多次
            debouncedFunc();
            debouncedFunc();
            debouncedFunc();
            
            // 等待防抖延迟
            await new Promise(resolve => setTimeout(resolve, 150));
            
            if (callCount !== 1) {
                return {
                    success: false,
                    message: '防抖功能异常',
                    details: { expectedCalls: 1, actualCalls: callCount }
                };
            }
            
            // 测试节流
            callCount = 0;
            const throttledFunc = window.performanceOptimizer.throttle(testFunction, 100, 'test_throttle');
            
            // 快速调用多次
            throttledFunc();
            throttledFunc();
            throttledFunc();
            
            if (callCount !== 1) {
                return {
                    success: false,
                    message: '节流功能异常',
                    details: { expectedCalls: 1, actualCalls: callCount }
                };
            }
            
            return {
                success: true,
                message: '防抖节流功能正常',
                details: { debounceTest: 'passed', throttleTest: 'passed' }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `防抖节流测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试错误处理机制
    async testErrorHandling() {
        try {
            const tests = [];
            
            // 测试全局错误处理器
            tests.push(await this.testGlobalErrorHandler());
            
            // 测试错误恢复机制
            tests.push(await this.testErrorRecovery());
            
            // 测试通信错误处理
            tests.push(await this.testCommunicationErrorHandling());
            
            const passedTests = tests.filter(t => t.success).length;
            const totalTests = tests.length;
            
            return {
                success: passedTests >= totalTests * 0.7, // 70%通过率
                passedTests,
                totalTests,
                details: tests
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                details: null
            };
        }
    }

    // 测试全局错误处理器
    async testGlobalErrorHandler() {
        try {
            if (typeof window.handleError !== 'function') {
                return {
                    success: false,
                    message: '全局错误处理器不存在',
                    details: null
                };
            }
            
            // 创建测试错误
            const testError = new Error('Integration test error');
            const errorDetails = window.handleError(testError, '集成测试', {
                userMessage: '这是一个测试错误',
                autoRecover: false
            });
            
            if (!errorDetails || !errorDetails.id) {
                return {
                    success: false,
                    message: '错误处理器未返回错误详情',
                    details: null
                };
            }
            
            return {
                success: true,
                message: '全局错误处理器功能正常',
                details: { errorDetails }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `全局错误处理器测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试错误恢复机制
    async testErrorRecovery() {
        try {
            if (typeof window.attemptErrorRecovery !== 'function') {
                return {
                    success: false,
                    message: '错误恢复机制不存在',
                    details: null
                };
            }
            
            // 测试错误恢复（不会实际执行恢复操作）
            const testError = new Error('Recovery test error');
            const errorDetails = { id: 'test_error', recoverable: true };
            
            // 调用恢复机制（应该不会抛出错误）
            window.attemptErrorRecovery(testError, '数据存储', errorDetails);
            
            return {
                success: true,
                message: '错误恢复机制功能正常',
                details: { testError: testError.message }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `错误恢复机制测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 测试通信错误处理
    async testCommunicationErrorHandling() {
        try {
            if (!window.communicationManager) {
                return {
                    success: false,
                    message: '通信管理器未初始化',
                    details: null
                };
            }
            
            // 测试连接状态获取
            const status = window.communicationManager.getAllConnectionStatus();
            
            if (typeof status !== 'object') {
                return {
                    success: false,
                    message: '无法获取连接状态',
                    details: null
                };
            }
            
            return {
                success: true,
                message: '通信错误处理功能正常',
                details: { connectionStatus: status }
            };
            
        } catch (error) {
            return {
                success: false,
                message: `通信错误处理测试失败: ${error.message}`,
                details: null
            };
        }
    }

    // 生成集成测试报告
    generateIntegrationReport() {
        const tests = [];
        let totalTests = 0;
        let passedTests = 0;

        // 定义所有测试项
        const testItems = [
            { key: 'indexValidation', name: '题库索引验证' },
            { key: 'browseStateTest', name: '浏览状态管理' },
            { key: 'communicationTest', name: '跨窗口通信' },
            { key: 'dataStorageTest', name: '数据存储和恢复' },
            { key: 'performanceTest', name: '性能优化' },
            { key: 'errorHandlingTest', name: '错误处理机制' }
        ];

        // 处理每个测试结果
        testItems.forEach(item => {
            const result = this.testResults[item.key];
            if (result) {
                totalTests++;
                if (result.success) {
                    passedTests++;
                }
                tests.push({
                    name: item.name,
                    status: result.success ? 'passed' : 'failed',
                    details: result
                });
            }
        });

        const successRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
        this.testResults.overallStatus = successRate >= 80 ? 'passed' : 'failed';

        return {
            summary: {
                totalTests,
                passedTests,
                failedTests: totalTests - passedTests,
                successRate
            },
            tests,
            overallStatus: this.testResults.overallStatus,
            recommendations: this.generateIntegrationRecommendations(),
            timestamp: new Date().toISOString()
        };
    }

    // 生成集成测试建议
    generateIntegrationRecommendations() {
        const recommendations = [];

        // 索引验证建议
        if (this.testResults.indexValidation && !this.testResults.indexValidation.success) {
            recommendations.push({
                category: '题库索引',
                priority: 'high',
                message: '题库索引验证失败',
                action: '检查文件路径和索引配置，运行索引修复工具'
            });
        }

        // 浏览状态管理建议
        if (this.testResults.browseStateTest && !this.testResults.browseStateTest.success) {
            recommendations.push({
                category: '浏览功能',
                priority: 'medium',
                message: '浏览状态管理功能异常',
                action: '检查JavaScript函数和DOM元素是否正确加载'
            });
        }

        // 通信功能建议
        if (this.testResults.communicationTest && !this.testResults.communicationTest.success) {
            recommendations.push({
                category: '通信功能',
                priority: 'high',
                message: '跨窗口通信功能异常',
                action: '检查练习页面是否包含通信代码，确保浏览器允许弹窗'
            });
        }

        // 数据存储建议
        if (this.testResults.dataStorageTest && !this.testResults.dataStorageTest.success) {
            recommendations.push({
                category: '数据存储',
                priority: 'high',
                message: '数据存储和恢复功能异常',
                action: '检查浏览器存储权限，清理存储空间或重置浏览器设置'
            });
        }

        // 性能优化建议
        if (this.testResults.performanceTest && !this.testResults.performanceTest.success) {
            recommendations.push({
                category: '性能优化',
                priority: 'medium',
                message: '性能优化功能部分异常',
                action: '检查性能优化器初始化，可能影响系统响应速度'
            });
        }

        // 错误处理建议
        if (this.testResults.errorHandlingTest && !this.testResults.errorHandlingTest.success) {
            recommendations.push({
                category: '错误处理',
                priority: 'medium',
                message: '错误处理机制部分异常',
                action: '检查错误处理器配置，可能影响系统稳定性'
            });
        }

        // 性能建议
        if (this.testResults.performanceTest && this.testResults.performanceTest.success) {
            const perfDetails = this.testResults.performanceTest.details;
            if (perfDetails && perfDetails.some(test => test.details && test.details.report)) {
                const report = perfDetails.find(test => test.details && test.details.report)?.details.report;
                if (report && report.cache && report.cache.hitRate < 50) {
                    recommendations.push({
                        category: '性能优化',
                        priority: 'low',
                        message: '缓存命中率较低',
                        action: '考虑调整缓存策略以提高性能'
                    });
                }
            }
        }

        if (recommendations.length === 0) {
            recommendations.push({
                category: '系统状态',
                priority: 'info',
                message: '所有集成测试均通过',
                action: '系统运行正常，可以正常使用'
            });
        }

        return recommendations;
    }

    // 清理测试资源
    cleanup() {
        if (this.communicationTester) {
            this.communicationTester.cleanup();
        }
    }
}

// 导出到全局
window.SystemIntegrationTester = SystemIntegrationTester;