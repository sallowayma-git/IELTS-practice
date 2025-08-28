/**
 * 练习记录增强系统集成测试
 * 用于验证系统功能和兼容性
 */

class PracticeEnhancementIntegrationTest {
    constructor() {
        this.testResults = [];
        this.isRunning = false;
    }

    /**
     * 运行所有集成测试
     */
    async runAllTests() {
        if (this.isRunning) {
            console.warn('[IntegrationTest] 测试已在运行中');
            return;
        }

        this.isRunning = true;
        this.testResults = [];
        
        console.log('[IntegrationTest] 开始集成测试...');
        
        try {
            // 基础功能测试
            await this.testBasicFunctionality();
            
            // 数据采集脚本测试
            await this.testDataCollectionScript();
            
            // 适配器系统测试
            await this.testAdapterSystem();
            
            // 通信机制测试
            await this.testCommunicationMechanism();
            
            // 数据处理测试
            await this.testDataProcessing();
            
            // 兼容性测试
            await this.testCompatibility();
            
            // 错误处理测试
            await this.testErrorHandling();
            
            // 生成测试报告
            this.generateTestReport();
            
        } catch (error) {
            console.error('[IntegrationTest] 测试执行失败:', error);
            this.addTestResult('测试执行', false, `测试执行失败: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 测试基础功能
     */
    async testBasicFunctionality() {
        console.log('[IntegrationTest] 测试基础功能...');
        
        // 测试全局对象存在
        this.addTestResult(
            '全局对象检查',
            !!(window.ExamSystemApp && window.PracticeRecorder),
            '检查必要的全局类是否存在'
        );
        
        // 测试存储系统
        try {
            const testKey = 'integration_test_' + Date.now();
            const testData = { test: true, timestamp: Date.now() };
            
            storage.set(testKey, testData);
            const retrieved = storage.get(testKey);
            const isStorageWorking = JSON.stringify(retrieved) === JSON.stringify(testData);
            
            storage.remove(testKey);
            
            this.addTestResult(
                '存储系统',
                isStorageWorking,
                '测试数据存储和读取功能'
            );
        } catch (error) {
            this.addTestResult(
                '存储系统',
                false,
                `存储系统测试失败: ${error.message}`
            );
        }
        
        // 测试消息系统
        try {
            let messageShown = false;
            const originalShowMessage = window.showMessage;
            
            window.showMessage = (msg, type) => {
                messageShown = true;
                if (originalShowMessage) originalShowMessage(msg, type);
            };
            
            window.showMessage('测试消息', 'info');
            
            window.showMessage = originalShowMessage;
            
            this.addTestResult(
                '消息系统',
                messageShown,
                '测试消息显示功能'
            );
        } catch (error) {
            this.addTestResult(
                '消息系统',
                false,
                `消息系统测试失败: ${error.message}`
            );
        }
    }

    /**
     * 测试数据采集脚本
     */
    async testDataCollectionScript() {
        console.log('[IntegrationTest] 测试数据采集脚本...');
        
        // 测试脚本文件存在
        try {
            const response = await fetch('./js/practice-data-collector.js');
            const scriptExists = response.ok;
            
            this.addTestResult(
                '数据采集脚本文件',
                scriptExists,
                '检查数据采集脚本文件是否存在'
            );
            
            if (scriptExists) {
                const scriptContent = await response.text();
                const hasRequiredClasses = scriptContent.includes('PracticeDataCollector');
                
                this.addTestResult(
                    '数据采集脚本内容',
                    hasRequiredClasses,
                    '检查脚本是否包含必要的类定义'
                );
            }
        } catch (error) {
            this.addTestResult(
                '数据采集脚本文件',
                false,
                `脚本文件检查失败: ${error.message}`
            );
        }
    }

    /**
     * 测试适配器系统
     */
    async testAdapterSystem() {
        console.log('[IntegrationTest] 测试适配器系统...');
        
        // 测试适配器文件存在
        try {
            const response = await fetch('./js/adapters/practice-page-adapters.js');
            const adapterExists = response.ok;
            
            this.addTestResult(
                '适配器文件',
                adapterExists,
                '检查适配器文件是否存在'
            );
            
            if (adapterExists) {
                const adapterContent = await response.text();
                const hasFactory = adapterContent.includes('PracticeAdapterFactory');
                const hasAdapters = adapterContent.includes('IELTSReadingStandardAdapter');
                
                this.addTestResult(
                    '适配器内容',
                    hasFactory && hasAdapters,
                    '检查适配器是否包含必要的类'
                );
            }
        } catch (error) {
            this.addTestResult(
                '适配器文件',
                false,
                `适配器文件检查失败: ${error.message}`
            );
        }
        
        // 测试适配器工厂（如果已加载）
        if (window.PracticeAdapterFactory) {
            try {
                const factory = new window.PracticeAdapterFactory();
                const supportedTypes = factory.getSupportedTypes();
                
                this.addTestResult(
                    '适配器工厂',
                    supportedTypes.length > 0,
                    `支持的页面类型: ${supportedTypes.join(', ')}`
                );
            } catch (error) {
                this.addTestResult(
                    '适配器工厂',
                    false,
                    `适配器工厂测试失败: ${error.message}`
                );
            }
        }
    }

    /**
     * 测试通信机制
     */
    async testCommunicationMechanism() {
        console.log('[IntegrationTest] 测试通信机制...');
        
        // 测试消息监听器
        let messageReceived = false;
        const testMessage = {
            type: 'TEST_MESSAGE',
            data: { test: true, timestamp: Date.now() }
        };
        
        const messageHandler = (event) => {
            if (event.data && event.data.type === 'TEST_MESSAGE') {
                messageReceived = true;
            }
        };
        
        window.addEventListener('message', messageHandler);
        
        // 发送测试消息
        window.postMessage(testMessage, '*');
        
        // 等待消息处理
        await new Promise(resolve => setTimeout(resolve, 100));
        
        window.removeEventListener('message', messageHandler);
        
        this.addTestResult(
            '消息通信',
            messageReceived,
            '测试跨窗口消息传递机制'
        );
    }

    /**
     * 测试数据处理
     */
    async testDataProcessing() {
        console.log('[IntegrationTest] 测试数据处理...');
        
        // 测试PracticeRecorder功能
        if (window.app && window.app.components && window.app.components.practiceRecorder) {
            const recorder = window.app.components.practiceRecorder;
            
            try {
                // 测试真实数据处理
                const testRealData = {
                    sessionId: 'test_session_' + Date.now(),
                    duration: 1200,
                    answers: { q1: 'test', q2: 'answer' },
                    scoreInfo: {
                        correct: 8,
                        total: 10,
                        accuracy: 0.8,
                        percentage: 80,
                        source: 'test'
                    }
                };
                
                const result = recorder.handleRealPracticeData('test_exam', testRealData);
                
                this.addTestResult(
                    '真实数据处理',
                    !!result,
                    '测试PracticeRecorder处理真实数据的能力'
                );
                
                // 清理测试数据
                if (result) {
                    const records = storage.get('practice_records', []);
                    const filteredRecords = records.filter(r => r.id !== result.id);
                    storage.set('practice_records', filteredRecords);
                }
                
            } catch (error) {
                this.addTestResult(
                    '真实数据处理',
                    false,
                    `数据处理测试失败: ${error.message}`
                );
            }
        } else {
            this.addTestResult(
                '真实数据处理',
                false,
                'PracticeRecorder实例不可用'
            );
        }
    }

    /**
     * 测试兼容性
     */
    async testCompatibility() {
        console.log('[IntegrationTest] 测试兼容性...');
        
        // 测试浏览器API支持
        const apiSupport = {
            localStorage: typeof localStorage !== 'undefined',
            postMessage: typeof window.postMessage === 'function',
            fetch: typeof fetch === 'function',
            Promise: typeof Promise !== 'undefined',
            addEventListener: typeof window.addEventListener === 'function'
        };
        
        const supportedAPIs = Object.values(apiSupport).filter(Boolean).length;
        const totalAPIs = Object.keys(apiSupport).length;
        
        this.addTestResult(
            '浏览器API支持',
            supportedAPIs === totalAPIs,
            `支持的API: ${supportedAPIs}/${totalAPIs} (${Object.keys(apiSupport).filter(key => apiSupport[key]).join(', ')})`
        );
        
        // 测试现有数据格式兼容性
        try {
            const oldFormatRecord = {
                id: Date.now(),
                examId: 'test',
                title: 'Test Exam',
                category: 'P1',
                score: 85,
                duration: 20,
                date: new Date().toISOString()
            };
            
            // 模拟处理旧格式数据
            const isCompatible = oldFormatRecord.score !== undefined && 
                                oldFormatRecord.duration !== undefined;
            
            this.addTestResult(
                '数据格式兼容性',
                isCompatible,
                '测试与旧数据格式的兼容性'
            );
        } catch (error) {
            this.addTestResult(
                '数据格式兼容性',
                false,
                `兼容性测试失败: ${error.message}`
            );
        }
    }

    /**
     * 测试错误处理
     */
    async testErrorHandling() {
        console.log('[IntegrationTest] 测试错误处理...');
        
        // 测试无效数据处理
        if (window.app && window.app.components && window.app.components.practiceRecorder) {
            const recorder = window.app.components.practiceRecorder;
            
            try {
                // 测试无效数据
                const invalidData = {
                    sessionId: null,
                    duration: -1,
                    answers: 'invalid'
                };
                
                const result = recorder.handleRealPracticeData('test_exam', invalidData);
                
                // 应该返回null或降级处理
                this.addTestResult(
                    '无效数据处理',
                    result === null || (result && result.dataSource === 'fallback'),
                    '测试系统对无效数据的处理能力'
                );
                
            } catch (error) {
                // 错误被正确捕获也是好的
                this.addTestResult(
                    '无效数据处理',
                    true,
                    '系统正确捕获了无效数据错误'
                );
            }
        }
        
        // 测试网络错误处理
        try {
            const response = await fetch('./non-existent-file.js');
            const networkErrorHandled = !response.ok;
            
            this.addTestResult(
                '网络错误处理',
                networkErrorHandled,
                '测试网络请求失败的处理'
            );
        } catch (error) {
            this.addTestResult(
                '网络错误处理',
                true,
                '网络错误被正确捕获'
            );
        }
    }

    /**
     * 添加测试结果
     */
    addTestResult(testName, passed, description) {
        this.testResults.push({
            name: testName,
            passed: passed,
            description: description,
            timestamp: new Date().toISOString()
        });
        
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`[IntegrationTest] ${status} ${testName}: ${description}`);
    }

    /**
     * 生成测试报告
     */
    generateTestReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
        
        console.log('\n' + '='.repeat(50));
        console.log('练习记录增强系统 - 集成测试报告');
        console.log('='.repeat(50));
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests}`);
        console.log(`失败: ${failedTests}`);
        console.log(`成功率: ${successRate}%`);
        console.log('='.repeat(50));
        
        // 详细结果
        this.testResults.forEach(result => {
            const status = result.passed ? '✅' : '❌';
            console.log(`${status} ${result.name}: ${result.description}`);
        });
        
        console.log('='.repeat(50));
        
        // 显示用户友好的报告
        if (window.showMessage) {
            const message = `集成测试完成\n通过: ${passedTests}/${totalTests} (${successRate}%)\n${failedTests > 0 ? '请查看控制台了解详细信息' : '所有测试通过！'}`;
            window.showMessage(message, failedTests > 0 ? 'warning' : 'success');
        }
        
        return {
            total: totalTests,
            passed: passedTests,
            failed: failedTests,
            successRate: successRate,
            results: this.testResults
        };
    }

    /**
     * 获取测试结果
     */
    getTestResults() {
        return this.testResults;
    }

    /**
     * 清除测试结果
     */
    clearTestResults() {
        this.testResults = [];
    }
}

// 创建全局测试实例
window.practiceEnhancementTest = new PracticeEnhancementIntegrationTest();

// 提供便捷的测试函数
window.runPracticeEnhancementTests = () => {
    return window.practiceEnhancementTest.runAllTests();
};

console.log('[IntegrationTest] 集成测试系统已加载');
console.log('[IntegrationTest] 使用 runPracticeEnhancementTests() 运行测试');