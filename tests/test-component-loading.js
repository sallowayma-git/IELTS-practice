/**
 * 组件加载优化测试脚本
 * 用于验证app.js中的组件加载优化功能
 */

class ComponentLoadingTester {
    constructor() {
        this.testResults = [];
        this.testsPassed = 0;
        this.testsFailed = 0;
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        console.log('=== 开始组件加载优化测试 ===');
        
        try {
            await this.testWaitForComponents();
            await this.testProgressiveLoading();
            await this.testErrorHandling();
            await this.testDegradedMode();
            
            this.printTestResults();
        } catch (error) {
            console.error('测试执行失败:', error);
        }
    }

    /**
     * 测试waitForComponents方法
     */
    async testWaitForComponents() {
        console.log('\n1. 测试waitForComponents方法...');
        
        // 检查ExamSystemApp是否存在
        this.assert(
            typeof window.ExamSystemApp === 'function',
            'ExamSystemApp类应该存在',
            'ExamSystemApp类未找到'
        );
        
        if (!window.ExamSystemApp) {
            return;
        }
        
        const app = new ExamSystemApp();
        
        // 测试waitForComponents方法是否存在
        this.assert(
            typeof app.waitForComponents === 'function',
            'waitForComponents方法应该存在',
            'waitForComponents方法未找到'
        );
        
        // 测试已存在组件的加载
        const existingComponents = ['Object', 'Array', 'String']; // 使用内置对象作为测试
        
        try {
            const startTime = Date.now();
            const result = await app.waitForComponents(existingComponents, 1000);
            const elapsed = Date.now() - startTime;
            
            this.assert(
                result === true,
                '已存在组件应该立即返回true',
                `实际返回: ${result}`
            );
            
            this.assert(
                elapsed < 500,
                '已存在组件加载应该很快完成',
                `实际耗时: ${elapsed}ms`
            );
            
        } catch (error) {
            this.assert(
                false,
                '已存在组件加载不应该抛出错误',
                `错误: ${error.message}`
            );
        }
        
        // 测试不存在组件的超时处理
        const nonExistentComponents = ['NonExistentComponent123'];
        
        try {
            const startTime = Date.now();
            await app.waitForComponents(nonExistentComponents, 500);
            
            this.assert(
                false,
                '不存在的组件应该抛出超时错误',
                '未抛出预期的超时错误'
            );
            
        } catch (error) {
            const elapsed = Date.now() - startTime;
            
            this.assert(
                error.message.includes('组件加载超时'),
                '应该抛出组件加载超时错误',
                `实际错误: ${error.message}`
            );
            
            this.assert(
                elapsed >= 400 && elapsed <= 700,
                '超时时间应该接近设定值',
                `实际超时时间: ${elapsed}ms`
            );
            
            this.assert(
                error.message.includes('NonExistentComponent123'),
                '错误信息应该包含缺失的组件名',
                `错误信息: ${error.message}`
            );
        }
        
        console.log('✅ waitForComponents方法测试完成');
    }

    /**
     * 测试渐进式加载
     */
    async testProgressiveLoading() {
        console.log('\n2. 测试渐进式加载...');
        
        if (!window.ExamSystemApp) {
            console.log('⚠️ 跳过渐进式加载测试（ExamSystemApp不可用）');
            return;
        }
        
        const app = new ExamSystemApp();
        
        // 测试核心组件初始化方法
        this.assert(
            typeof app.initializeCoreComponents === 'function',
            'initializeCoreComponents方法应该存在',
            'initializeCoreComponents方法未找到'
        );
        
        // 测试可选组件初始化方法
        this.assert(
            typeof app.initializeOptionalComponents === 'function',
            'initializeOptionalComponents方法应该存在',
            'initializeOptionalComponents方法未找到'
        );
        
        // 测试可用组件初始化方法
        this.assert(
            typeof app.initializeAvailableOptionalComponents === 'function',
            'initializeAvailableOptionalComponents方法应该存在',
            'initializeAvailableOptionalComponents方法未找到'
        );
        
        // 模拟组件加载状态
        const originalExamBrowser = window.ExamBrowser;
        const originalPracticeRecorder = window.PracticeRecorder;
        
        // 临时移除组件以测试降级行为
        window.ExamBrowser = undefined;
        window.PracticeRecorder = undefined;
        
        try {
            // 测试核心组件缺失时的处理
            try {
                await app.initializeCoreComponents();
                this.assert(
                    false,
                    '核心组件缺失时应该抛出错误',
                    '未抛出预期错误'
                );
            } catch (error) {
                this.assert(
                    error.message.includes('ExamBrowser'),
                    '应该报告ExamBrowser组件缺失',
                    `实际错误: ${error.message}`
                );
            }
            
        } finally {
            // 恢复原始组件
            window.ExamBrowser = originalExamBrowser;
            window.PracticeRecorder = originalPracticeRecorder;
        }
        
        console.log('✅ 渐进式加载测试完成');
    }

    /**
     * 测试错误处理
     */
    async testErrorHandling() {
        console.log('\n3. 测试错误处理...');
        
        if (!window.ExamSystemApp) {
            console.log('⚠️ 跳过错误处理测试（ExamSystemApp不可用）');
            return;
        }
        
        const app = new ExamSystemApp();
        
        // 测试错误处理方法
        this.assert(
            typeof app.handleInitializationError === 'function',
            'handleInitializationError方法应该存在',
            'handleInitializationError方法未找到'
        );
        
        this.assert(
            typeof app.setupGlobalErrorHandling === 'function',
            'setupGlobalErrorHandling方法应该存在',
            'setupGlobalErrorHandling方法未找到'
        );
        
        this.assert(
            typeof app.handleGlobalError === 'function',
            'handleGlobalError方法应该存在',
            'handleGlobalError方法未找到'
        );
        
        // 测试全局错误处理设置
        const originalAddEventListener = window.addEventListener;
        let unhandledRejectionListenerAdded = false;
        let errorListenerAdded = false;
        
        window.addEventListener = (type, listener, options) => {
            if (type === 'unhandledrejection') {
                unhandledRejectionListenerAdded = true;
            } else if (type === 'error') {
                errorListenerAdded = true;
            }
            return originalAddEventListener.call(window, type, listener, options);
        };
        
        try {
            app.setupGlobalErrorHandling();
            
            this.assert(
                unhandledRejectionListenerAdded,
                '应该添加unhandledrejection事件监听器',
                '未添加unhandledrejection监听器'
            );
            
            this.assert(
                errorListenerAdded,
                '应该添加error事件监听器',
                '未添加error监听器'
            );
            
        } finally {
            window.addEventListener = originalAddEventListener;
        }
        
        // 测试错误记录
        const testError = new Error('测试错误');
        app.handleGlobalError(testError, '测试上下文');
        
        this.assert(
            Array.isArray(app.globalErrors),
            '应该创建全局错误记录数组',
            '未创建全局错误记录数组'
        );
        
        this.assert(
            app.globalErrors.length > 0,
            '应该记录错误信息',
            '未记录错误信息'
        );
        
        console.log('✅ 错误处理测试完成');
    }

    /**
     * 测试降级模式
     */
    async testDegradedMode() {
        console.log('\n4. 测试降级模式...');
        
        if (!window.ExamSystemApp) {
            console.log('⚠️ 跳过降级模式测试（ExamSystemApp不可用）');
            return;
        }
        
        const app = new ExamSystemApp();
        
        // 测试降级UI方法
        this.assert(
            typeof app.showFallbackUI === 'function',
            'showFallbackUI方法应该存在',
            'showFallbackUI方法未找到'
        );
        
        this.assert(
            typeof app.attemptRecovery === 'function',
            'attemptRecovery方法应该存在',
            'attemptRecovery方法未找到'
        );
        
        this.assert(
            typeof app.enterSafeMode === 'function',
            'enterSafeMode方法应该存在',
            'enterSafeMode方法未找到'
        );
        
        this.assert(
            typeof app.showSystemInfo === 'function',
            'showSystemInfo方法应该存在',
            'showSystemInfo方法未找到'
        );
        
        // 测试用户消息显示
        this.assert(
            typeof app.showUserMessage === 'function',
            'showUserMessage方法应该存在',
            'showUserMessage方法未找到'
        );
        
        this.assert(
            typeof app.updateLoadingMessage === 'function',
            'updateLoadingMessage方法应该存在',
            'updateLoadingMessage方法未找到'
        );
        
        // 测试降级UI生成
        const originalGetElementById = document.getElementById;
        let fallbackUIGenerated = false;
        
        document.getElementById = (id) => {
            if (id === 'app') {
                return {
                    innerHTML: '',
                    set innerHTML(value) {
                        if (value.includes('fallback-ui')) {
                            fallbackUIGenerated = true;
                        }
                    }
                };
            }
            return originalGetElementById.call(document, id);
        };
        
        try {
            app.showFallbackUI(true);
            
            this.assert(
                fallbackUIGenerated,
                '应该生成降级UI',
                '未生成降级UI'
            );
            
        } finally {
            document.getElementById = originalGetElementById;
        }
        
        console.log('✅ 降级模式测试完成');
    }

    /**
     * 断言方法
     */
    assert(condition, message, details = '') {
        const result = {
            passed: condition,
            message: message,
            details: details,
            timestamp: new Date().toISOString()
        };
        
        this.testResults.push(result);
        
        if (condition) {
            this.testsPassed++;
            console.log(`  ✅ ${message}`);
        } else {
            this.testsFailed++;
            console.log(`  ❌ ${message} - ${details}`);
        }
    }

    /**
     * 打印测试结果
     */
    printTestResults() {
        console.log('\n=== 组件加载优化测试结果 ===');
        console.log(`总测试数: ${this.testResults.length}`);
        console.log(`通过: ${this.testsPassed}`);
        console.log(`失败: ${this.testsFailed}`);
        console.log(`成功率: ${Math.round((this.testsPassed / this.testResults.length) * 100)}%`);
        
        if (this.testsFailed > 0) {
            console.log('\n失败的测试:');
            this.testResults
                .filter(result => !result.passed)
                .forEach(result => {
                    console.log(`  - ${result.message}: ${result.details}`);
                });
        }
        
        console.log('\n=== 测试完成 ===');
        
        return {
            total: this.testResults.length,
            passed: this.testsPassed,
            failed: this.testsFailed,
            successRate: Math.round((this.testsPassed / this.testResults.length) * 100)
        };
    }
}

// 导出测试器
window.ComponentLoadingTester = ComponentLoadingTester;

// 提供便捷的测试函数
window.testComponentLoading = async function() {
    const tester = new ComponentLoadingTester();
    return await tester.runAllTests();
};

console.log('组件加载优化测试器已加载');
console.log('使用 testComponentLoading() 运行测试');