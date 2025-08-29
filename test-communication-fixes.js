/**
 * 通信错误修复测试脚本
 * 用于验证practice-page-enhancer.js中的通信错误修复
 */

class CommunicationFixesTester {
    constructor() {
        this.testResults = [];
        this.testsPassed = 0;
        this.testsFailed = 0;
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        console.log('=== 开始通信错误修复测试 ===');
        
        try {
            await this.testParentWindowDetection();
            await this.testFallbackCommunication();
            await this.testErrorRecovery();
            await this.testUserFriendlyErrors();
            
            this.printTestResults();
        } catch (error) {
            console.error('测试执行失败:', error);
        }
    }

    /**
     * 测试父窗口检测
     */
    async testParentWindowDetection() {
        console.log('\n1. 测试父窗口检测...');
        
        // 检查PracticePageEnhancer是否存在
        this.assert(
            typeof window.PracticePageEnhancer === 'function',
            'PracticePageEnhancer类应该存在',
            'PracticePageEnhancer类未找到'
        );
        
        if (!window.PracticePageEnhancer) {
            return;
        }
        
        // 创建测试实例
        const enhancer = new PracticePageEnhancer();
        
        // 测试isParentWindowAvailable方法
        this.assert(
            typeof enhancer.isParentWindowAvailable === 'function',
            'isParentWindowAvailable方法应该存在',
            'isParentWindowAvailable方法未找到'
        );
        
        // 测试无父窗口情况
        enhancer.parentWindow = null;
        const noParentResult = enhancer.isParentWindowAvailable();
        
        this.assert(
            noParentResult === false,
            '无父窗口时应该返回false',
            `实际返回: ${noParentResult}`
        );
        
        // 测试已关闭父窗口情况
        enhancer.parentWindow = { closed: true };
        const closedParentResult = enhancer.isParentWindowAvailable();
        
        this.assert(
            closedParentResult === false,
            '已关闭父窗口时应该返回false',
            `实际返回: ${closedParentResult}`
        );
        
        // 测试有效父窗口情况
        enhancer.parentWindow = { 
            closed: false,
            postMessage: () => {},
            location: { href: 'test' }
        };
        const validParentResult = enhancer.isParentWindowAvailable();
        
        this.assert(
            validParentResult === true,
            '有效父窗口时应该返回true',
            `实际返回: ${validParentResult}`
        );
        
        console.log('✅ 父窗口检测测试完成');
    }

    /**
     * 测试备用通信机制
     */
    async testFallbackCommunication() {
        console.log('\n2. 测试备用通信机制...');
        
        if (!window.PracticePageEnhancer) {
            console.log('⚠️ 跳过备用通信测试（PracticePageEnhancer不可用）');
            return;
        }
        
        const enhancer = new PracticePageEnhancer();
        enhancer.sessionId = 'test-session-123';
        
        // 测试handleCommunicationFallback方法
        this.assert(
            typeof enhancer.handleCommunicationFallback === 'function',
            'handleCommunicationFallback方法应该存在',
            'handleCommunicationFallback方法未找到'
        );
        
        // 模拟localStorage
        const originalSetItem = localStorage.setItem;
        const originalGetItem = localStorage.getItem;
        const originalRemoveItem = localStorage.removeItem;
        
        let storedData = null;
        let storageKey = null;
        
        localStorage.setItem = (key, value) => {
            storageKey = key;
            storedData = value;
        };
        
        localStorage.getItem = (key) => {
            return key === storageKey ? storedData : null;
        };
        
        localStorage.removeItem = (key) => {
            if (key === storageKey) {
                storedData = null;
                storageKey = null;
            }
        };
        
        // 模拟事件分发
        let eventDispatched = false;
        const originalDispatchEvent = window.dispatchEvent;
        window.dispatchEvent = (event) => {
            if (event.type === 'storage') {
                eventDispatched = true;
            }
            return true;
        };
        
        try {
            // 测试备用通信
            enhancer.handleCommunicationFallback('TEST_MESSAGE', { test: 'data' });
            
            this.assert(
                storedData !== null,
                '应该将数据存储到localStorage',
                '未存储数据到localStorage'
            );
            
            this.assert(
                storageKey && storageKey.includes('test-session-123'),
                '存储键应该包含会话ID',
                `实际存储键: ${storageKey}`
            );
            
            if (storedData) {
                const parsedData = JSON.parse(storedData);
                this.assert(
                    parsedData.type === 'TEST_MESSAGE',
                    '存储的数据应该包含正确的消息类型',
                    `实际类型: ${parsedData.type}`
                );
            }
            
            this.assert(
                eventDispatched,
                '应该触发storage事件',
                '未触发storage事件'
            );
            
        } finally {
            // 恢复原始函数
            localStorage.setItem = originalSetItem;
            localStorage.getItem = originalGetItem;
            localStorage.removeItem = originalRemoveItem;
            window.dispatchEvent = originalDispatchEvent;
        }
        
        console.log('✅ 备用通信机制测试完成');
    }

    /**
     * 测试错误恢复机制
     */
    async testErrorRecovery() {
        console.log('\n3. 测试错误恢复机制...');
        
        if (!window.PracticePageEnhancer) {
            console.log('⚠️ 跳过错误恢复测试（PracticePageEnhancer不可用）');
            return;
        }
        
        const enhancer = new PracticePageEnhancer();
        
        // 测试handleCommunicationError方法
        this.assert(
            typeof enhancer.handleCommunicationError === 'function',
            'handleCommunicationError方法应该存在',
            'handleCommunicationError方法未找到'
        );
        
        // 测试错误记录
        const testError = new Error('测试通信错误');
        enhancer.handleCommunicationError(testError, 'TEST_TYPE', { test: 'data' });
        
        this.assert(
            Array.isArray(enhancer.communicationErrors),
            '应该创建错误记录数组',
            '未创建错误记录数组'
        );
        
        this.assert(
            enhancer.communicationErrors.length > 0,
            '应该记录错误信息',
            '未记录错误信息'
        );
        
        // 测试重试计数
        this.assert(
            typeof enhancer.retryCount === 'number',
            '应该初始化重试计数',
            '未初始化重试计数'
        );
        
        // 测试降级模式
        this.assert(
            typeof enhancer.enterDegradedMode === 'function',
            'enterDegradedMode方法应该存在',
            'enterDegradedMode方法未找到'
        );
        
        console.log('✅ 错误恢复机制测试完成');
    }

    /**
     * 测试用户友好错误提示
     */
    async testUserFriendlyErrors() {
        console.log('\n4. 测试用户友好错误提示...');
        
        if (!window.PracticePageEnhancer) {
            console.log('⚠️ 跳过用户友好错误测试（PracticePageEnhancer不可用）');
            return;
        }
        
        const enhancer = new PracticePageEnhancer();
        
        // 测试showUserFriendlyError方法
        this.assert(
            typeof enhancer.showUserFriendlyError === 'function',
            'showUserFriendlyError方法应该存在',
            'showUserFriendlyError方法未找到'
        );
        
        // 模拟DOM操作
        const originalCreateElement = document.createElement;
        const originalAppendChild = document.body.appendChild;
        
        let noticeCreated = false;
        let noticeAppended = false;
        
        document.createElement = (tagName) => {
            const element = originalCreateElement.call(document, tagName);
            if (tagName === 'div') {
                noticeCreated = true;
            }
            return element;
        };
        
        document.body.appendChild = (element) => {
            if (element.id === 'communication-notice') {
                noticeAppended = true;
            }
            return element;
        };
        
        try {
            // 测试用户友好错误提示
            enhancer.showUserFriendlyError();
            
            this.assert(
                noticeCreated,
                '应该创建通知元素',
                '未创建通知元素'
            );
            
            this.assert(
                noticeAppended,
                '应该将通知添加到页面',
                '未将通知添加到页面'
            );
            
        } finally {
            // 恢复原始函数
            document.createElement = originalCreateElement;
            document.body.appendChild = originalAppendChild;
        }
        
        console.log('✅ 用户友好错误提示测试完成');
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
        console.log('\n=== 通信错误修复测试结果 ===');
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
window.CommunicationFixesTester = CommunicationFixesTester;

// 提供便捷的测试函数
window.testCommunicationFixes = async function() {
    const tester = new CommunicationFixesTester();
    return await tester.runAllTests();
};

console.log('通信错误修复测试器已加载');
console.log('使用 testCommunicationFixes() 运行测试');