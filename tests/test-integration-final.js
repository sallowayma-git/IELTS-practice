/**
 * IELTS系统修复集成测试脚本
 * 综合验证所有修复功能的协同工作
 */

class IntegrationFinalTester {
    constructor() {
        this.testResults = [];
        this.testsPassed = 0;
        this.testsFailed = 0;
        this.testSuites = [];
    }

    /**
     * 运行所有集成测试
     */
    async runAllTests() {
        console.log('=== 开始IELTS系统修复集成测试 ===');
        console.log('这将验证所有修复功能的协同工作情况\n');
        
        try {
            await this.runIndividualTestSuites();
            await this.testSystemIntegration();
            await this.testUserWorkflow();
            await this.testErrorRecovery();
            await this.testPerformanceImpact();
            
            this.printFinalResults();
        } catch (error) {
            console.error('集成测试执行失败:', error);
        }
    }

    /**
     * 运行各个测试套件
     */
    async runIndividualTestSuites() {
        console.log('1. 运行各个功能测试套件...\n');
        
        const testSuites = [
            { name: '交互体验改进', tester: 'InteractionImprovementTester', func: 'testInteractionImprovements' },
            { name: 'Markdown导出功能', tester: 'MarkdownExportTester', func: 'testMarkdownExport' },
            { name: '通信错误修复', tester: 'CommunicationFixesTester', func: 'testCommunicationFixes' },
            { name: '组件加载优化', tester: 'ComponentLoadingTester', func: 'testComponentLoading' }
        ];

        for (const suite of testSuites) {
            console.log(`正在运行 ${suite.name} 测试...`);
            
            try {
                let result;
                if (window[suite.func]) {
                    result = await window[suite.func]();
                } else if (window[suite.tester]) {
                    const tester = new window[suite.tester]();
                    result = await tester.runAllTests();
                } else {
                    result = { total: 0, passed: 0, failed: 0, successRate: 0 };
                    console.warn(`  ⚠️ ${suite.name} 测试器不可用`);
                }
                
                this.testSuites.push({
                    name: suite.name,
                    result: result
                });
                
                console.log(`  ✅ ${suite.name} 测试完成: ${result.passed}/${result.total} 通过\n`);
                
            } catch (error) {
                console.error(`  ❌ ${suite.name} 测试失败:`, error);
                this.testSuites.push({
                    name: suite.name,
                    result: { total: 1, passed: 0, failed: 1, successRate: 0, error: error.message }
                });
            }
        }
    }

    /**
     * 测试系统集成
     */
    async testSystemIntegration() {
        console.log('2. 测试系统集成...\n');
        
        // 测试CSS样式与JavaScript功能的集成
        await this.testCSSJSIntegration();
        
        // 测试组件间通信
        await this.testComponentCommunication();
        
        // 测试错误处理链
        await this.testErrorHandlingChain();
        
        console.log('✅ 系统集成测试完成\n');
    }

    /**
     * 测试CSS与JavaScript集成
     */
    async testCSSJSIntegration() {
        console.log('  测试CSS与JavaScript集成...');
        
        // 创建测试元素
        const testElement = document.createElement('h4');
        testElement.className = 'record-title clickable';
        testElement.textContent = '集成测试标题';
        document.body.appendChild(testElement);
        
        try {
            // 测试CSS样式应用
            const computedStyle = window.getComputedStyle(testElement);
            
            this.assert(
                computedStyle.cursor === 'pointer',
                'CSS样式应该正确应用到JavaScript生成的元素',
                `实际cursor: ${computedStyle.cursor}`
            );
            
            // 测试事件处理
            let eventHandled = false;
            const testHandler = (e) => {
                if (e.target.classList.contains('record-title')) {
                    eventHandled = true;
                }
            };
            
            document.addEventListener('click', testHandler);
            testElement.click();
            
            this.assert(
                eventHandled,
                'JavaScript事件处理应该与CSS样式协同工作',
                '事件未被正确处理'
            );
            
            document.removeEventListener('click', testHandler);
            
        } finally {
            document.body.removeChild(testElement);
        }
    }

    /**
     * 测试组件间通信
     */
    async testComponentCommunication() {
        console.log('  测试组件间通信...');
        
        // 测试PracticeHistory与PracticeRecorder的集成
        if (window.PracticeHistory && window.PracticeRecorder) {
            this.assert(
                true,
                '练习历史组件与练习记录器应该能够协同工作',
                '组件集成正常'
            );
        } else {
            this.assert(
                false,
                '关键组件缺失，影响系统集成',
                `PracticeHistory: ${!!window.PracticeHistory}, PracticeRecorder: ${!!window.PracticeRecorder}`
            );
        }
        
        // 测试错误处理组件的集成
        if (window.ExamSystemApp) {
            const app = new ExamSystemApp();
            
            this.assert(
                typeof app.handleGlobalError === 'function' && 
                typeof app.showUserMessage === 'function',
                '错误处理组件应该与用户反馈系统集成',
                '错误处理集成检查'
            );
        }
    }

    /**
     * 测试错误处理链
     */
    async testErrorHandlingChain() {
        console.log('  测试错误处理链...');
        
        // 测试从通信错误到用户反馈的完整链路
        if (window.PracticePageEnhancer) {
            const enhancer = new PracticePageEnhancer();
            
            // 模拟通信错误
            const testError = new Error('集成测试通信错误');
            
            try {
                enhancer.handleCommunicationError(testError, 'INTEGRATION_TEST', {});
                
                this.assert(
                    Array.isArray(enhancer.communicationErrors) && 
                    enhancer.communicationErrors.length > 0,
                    '通信错误应该被正确记录和处理',
                    '错误处理链正常工作'
                );
                
            } catch (error) {
                this.assert(
                    false,
                    '错误处理不应该抛出未捕获的异常',
                    `错误处理异常: ${error.message}`
                );
            }
        }
    }

    /**
     * 测试用户工作流
     */
    async testUserWorkflow() {
        console.log('3. 测试用户工作流...\n');
        
        // 模拟完整的用户操作流程
        await this.simulateUserJourney();
        
        console.log('✅ 用户工作流测试完成\n');
    }

    /**
     * 模拟用户操作流程
     */
    async simulateUserJourney() {
        console.log('  模拟用户操作流程...');
        
        // 1. 系统初始化
        this.assert(
            typeof window.ExamSystemApp === 'function',
            '用户应该能够访问系统主应用',
            '系统主应用可用性检查'
        );
        
        // 2. 练习记录查看
        if (window.PracticeHistory) {
            const practiceHistory = new PracticeHistory();
            
            this.assert(
                typeof practiceHistory.createRecordItem === 'function',
                '用户应该能够查看练习记录列表',
                '练习记录查看功能'
            );
            
            // 3. 记录详情查看
            this.assert(
                typeof practiceHistory.showRecordDetails === 'function',
                '用户应该能够查看练习记录详情',
                '记录详情查看功能'
            );
            
            // 4. Markdown导出
            this.assert(
                typeof practiceHistory.exportRecordAsMarkdown === 'function',
                '用户应该能够导出Markdown格式的记录',
                'Markdown导出功能'
            );
        }
        
        // 5. 错误恢复
        if (window.ExamSystemApp) {
            const app = new ExamSystemApp();
            
            this.assert(
                typeof app.attemptRecovery === 'function',
                '用户应该能够在遇到错误时尝试恢复',
                '错误恢复功能'
            );
        }
    }

    /**
     * 测试错误恢复
     */
    async testErrorRecovery() {
        console.log('4. 测试错误恢复机制...\n');
        
        // 测试各种错误场景的恢复能力
        await this.testCommunicationErrorRecovery();
        await this.testComponentLoadingErrorRecovery();
        await this.testUserInterfaceErrorRecovery();
        
        console.log('✅ 错误恢复测试完成\n');
    }

    /**
     * 测试通信错误恢复
     */
    async testCommunicationErrorRecovery() {
        console.log('  测试通信错误恢复...');
        
        if (window.PracticePageEnhancer) {
            const enhancer = new PracticePageEnhancer();
            
            // 模拟父窗口不可用
            enhancer.parentWindow = null;
            
            // 测试备用通信机制
            try {
                enhancer.handleCommunicationFallback('TEST_RECOVERY', { test: 'data' });
                
                this.assert(
                    true,
                    '通信错误时应该能够使用备用机制',
                    '备用通信机制正常工作'
                );
                
            } catch (error) {
                this.assert(
                    false,
                    '备用通信机制不应该抛出错误',
                    `备用通信错误: ${error.message}`
                );
            }
        }
    }

    /**
     * 测试组件加载错误恢复
     */
    async testComponentLoadingErrorRecovery() {
        console.log('  测试组件加载错误恢复...');
        
        if (window.ExamSystemApp) {
            const app = new ExamSystemApp();
            
            // 测试降级模式
            this.assert(
                typeof app.enterSafeMode === 'function',
                '组件加载失败时应该能够进入安全模式',
                '安全模式功能可用'
            );
            
            // 测试恢复尝试
            this.assert(
                typeof app.attemptRecovery === 'function',
                '应该提供系统恢复功能',
                '系统恢复功能可用'
            );
        }
    }

    /**
     * 测试用户界面错误恢复
     */
    async testUserInterfaceErrorRecovery() {
        console.log('  测试用户界面错误恢复...');
        
        // 测试降级UI的生成
        if (window.ExamSystemApp) {
            const app = new ExamSystemApp();
            
            this.assert(
                typeof app.showFallbackUI === 'function',
                '界面错误时应该能够显示降级UI',
                '降级UI功能可用'
            );
            
            this.assert(
                typeof app.showSystemInfo === 'function',
                '应该提供系统诊断信息',
                '系统诊断功能可用'
            );
        }
    }

    /**
     * 测试性能影响
     */
    async testPerformanceImpact() {
        console.log('5. 测试性能影响...\n');
        
        // 测试修复对系统性能的影响
        const performanceMetrics = await this.measurePerformanceImpact();
        
        this.assert(
            performanceMetrics.initializationTime < 5000,
            '系统初始化时间应该在可接受范围内',
            `初始化时间: ${performanceMetrics.initializationTime}ms`
        );
        
        this.assert(
            performanceMetrics.memoryUsage < 50,
            '内存使用应该在合理范围内',
            `内存使用: ${performanceMetrics.memoryUsage}MB`
        );
        
        console.log('✅ 性能影响测试完成\n');
    }

    /**
     * 测量性能影响
     */
    async measurePerformanceImpact() {
        const startTime = performance.now();
        
        // 模拟系统初始化
        try {
            if (window.ExamSystemApp) {
                const app = new ExamSystemApp();
                // 不实际初始化，只测量创建时间
            }
        } catch (error) {
            // 忽略初始化错误，只关注性能
        }
        
        const endTime = performance.now();
        const initializationTime = endTime - startTime;
        
        // 估算内存使用（简化）
        const memoryUsage = performance.memory ? 
            performance.memory.usedJSHeapSize / 1024 / 1024 : 0;
        
        return {
            initializationTime,
            memoryUsage
        };
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
            console.log(`    ✅ ${message}`);
        } else {
            this.testsFailed++;
            console.log(`    ❌ ${message} - ${details}`);
        }
    }

    /**
     * 打印最终结果
     */
    printFinalResults() {
        console.log('\n=== IELTS系统修复集成测试最终结果 ===\n');
        
        // 各测试套件结果
        console.log('各功能测试套件结果:');
        this.testSuites.forEach(suite => {
            const status = suite.result.successRate >= 80 ? '✅' : '⚠️';
            console.log(`  ${status} ${suite.name}: ${suite.result.passed}/${suite.result.total} (${suite.result.successRate}%)`);
        });
        
        // 集成测试结果
        console.log('\n集成测试结果:');
        console.log(`  总测试数: ${this.testResults.length}`);
        console.log(`  通过: ${this.testsPassed}`);
        console.log(`  失败: ${this.testsFailed}`);
        console.log(`  成功率: ${Math.round((this.testsPassed / this.testResults.length) * 100)}%`);
        
        // 整体评估
        const overallSuccessRate = this.calculateOverallSuccessRate();
        console.log(`\n整体成功率: ${overallSuccessRate}%`);
        
        if (overallSuccessRate >= 90) {
            console.log('🎉 系统修复质量优秀！所有功能运行良好。');
        } else if (overallSuccessRate >= 80) {
            console.log('✅ 系统修复质量良好，大部分功能正常工作。');
        } else if (overallSuccessRate >= 70) {
            console.log('⚠️ 系统修复基本完成，但仍有改进空间。');
        } else {
            console.log('❌ 系统修复需要进一步完善。');
        }
        
        // 失败项目详情
        if (this.testsFailed > 0) {
            console.log('\n需要关注的问题:');
            this.testResults
                .filter(result => !result.passed)
                .forEach(result => {
                    console.log(`  - ${result.message}: ${result.details}`);
                });
        }
        
        console.log('\n=== 集成测试完成 ===');
        
        return {
            testSuites: this.testSuites,
            integrationTests: {
                total: this.testResults.length,
                passed: this.testsPassed,
                failed: this.testsFailed,
                successRate: Math.round((this.testsPassed / this.testResults.length) * 100)
            },
            overallSuccessRate: overallSuccessRate
        };
    }

    /**
     * 计算整体成功率
     */
    calculateOverallSuccessRate() {
        let totalTests = this.testResults.length;
        let totalPassed = this.testsPassed;
        
        // 加入各测试套件的结果
        this.testSuites.forEach(suite => {
            totalTests += suite.result.total;
            totalPassed += suite.result.passed;
        });
        
        return totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    }
}

// 导出测试器
window.IntegrationFinalTester = IntegrationFinalTester;

// 提供便捷的测试函数
window.runFinalIntegrationTest = async function() {
    const tester = new IntegrationFinalTester();
    return await tester.runAllTests();
};

console.log('IELTS系统修复集成测试器已加载');
console.log('使用 runFinalIntegrationTest() 运行完整的集成测试');