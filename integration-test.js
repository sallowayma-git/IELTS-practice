/**
 * 集成测试文件
 * 测试所有修复功能的完整性和性能
 */

class IntegrationTester {
    constructor() {
        this.testResults = {
            total: 0,
            passed: 0,
            failed: 0,
            errors: []
        };
        this.startTime = performance.now();
    }

    /**
     * 运行所有集成测试
     */
    async runAllTests() {
        console.log('🧪 开始集成测试...');
        
        try {
            // DOM结构测试
            await this.testDOMStructure();
            
            // 组件初始化测试
            await this.testComponentInitialization();
            
            // 事件系统测试
            await this.testEventSystem();
            
            // 状态管理测试
            await this.testStateManagement();
            
            // 性能优化测试
            await this.testPerformanceOptimization();
            
            // 错误恢复测试
            await this.testErrorRecovery();
            
            // 数据完整性测试
            await this.testDataIntegrity();
            
            // 最终报告
            this.generateReport();
            
        } catch (error) {
            console.error('❌ 集成测试执行失败:', error);
            this.addError('Integration Test Execution', error);
        }
    }

    /**
     * 测试DOM结构
     */
    async testDOMStructure() {
        console.log('📋 测试DOM结构...');
        
        // 测试browse-view结构
        this.test('browse-view存在', () => {
            return document.getElementById('browse-view') !== null;
        });
        
        this.test('browse-controls存在', () => {
            return document.querySelector('.browse-controls') !== null;
        });
        
        this.test('exam-list-container存在', () => {
            return document.getElementById('exam-list-container') !== null;
        });
        
        this.test('exam-list存在', () => {
            return document.getElementById('exam-list') !== null;
        });
        
        this.test('筛选器元素存在', () => {
            const frequencyFilter = document.getElementById('frequency-filter');
            const statusFilter = document.getElementById('status-filter');
            const difficultyFilter = document.getElementById('difficulty-filter');
            return frequencyFilter && statusFilter && difficultyFilter;
        });
        
        this.test('搜索框存在', () => {
            return document.getElementById('exam-search-input') !== null;
        });
        
        this.test('视图控制按钮存在', () => {
            return document.querySelector('.view-controls') !== null;
        });
        
        this.test('状态显示区域存在', () => {
            return document.querySelector('.browse-stats') !== null;
        });
    }

    /**
     * 测试组件初始化
     */
    async testComponentInitialization() {
        console.log('🔧 测试组件初始化...');
        
        this.test('ExamBrowser类存在', () => {
            return typeof window.ExamBrowser === 'function';
        });
        
        this.test('EventManager类存在', () => {
            return typeof window.EventManager === 'function';
        });
        
        this.test('BrowseStateManager类存在', () => {
            return typeof window.BrowseStateManager === 'function';
        });
        
        this.test('PerformanceOptimizer类存在', () => {
            return typeof window.PerformanceOptimizer === 'function';
        });
        
        this.test('ExamBrowserRecovery类存在', () => {
            return typeof window.ExamBrowserRecovery === 'function';
        });
        
        this.test('VirtualScroller类存在', () => {
            return typeof window.VirtualScroller === 'function';
        });
        
        // 测试实例化
        this.test('examBrowser实例存在', () => {
            return window.examBrowserInstance || 
                   (window.app && window.app.components && window.app.components.examBrowser);
        });
        
        this.test('eventManager实例存在', () => {
            return window.eventManager !== undefined;
        });
        
        this.test('performanceOptimizer实例存在', () => {
            return window.performanceOptimizer !== undefined;
        });
        
        this.test('examBrowserRecovery实例存在', () => {
            return window.examBrowserRecovery !== undefined;
        });
    }

    /**
     * 测试事件系统
     */
    async testEventSystem() {
        console.log('🎯 测试事件系统...');
        
        this.test('EventManager已初始化', () => {
            return window.eventManager && window.eventManager.initialized;
        });
        
        this.test('EventManager有addEventListener方法', () => {
            return window.eventManager && 
                   typeof window.eventManager.addEventListener === 'function';
        });
        
        this.test('EventManager有removeEventListener方法', () => {
            return window.eventManager && 
                   typeof window.eventManager.removeEventListener === 'function';
        });
        
        this.test('防抖函数可用', () => {
            return window.eventManager && 
                   typeof window.eventManager.debounce === 'function';
        });
        
        this.test('节流函数可用', () => {
            return window.eventManager && 
                   typeof window.eventManager.throttle === 'function';
        });
        
        // 测试事件绑定
        this.test('搜索框事件已绑定', () => {
            const searchInput = document.getElementById('exam-search-input');
            return searchInput && searchInput.getAttribute('data-listener-set') !== null;
        });
    }

    /**
     * 测试状态管理
     */
    async testStateManagement() {
        console.log('💾 测试状态管理...');
        
        this.test('BrowseStateManager实例存在', () => {
            return window.browseStateManager !== undefined;
        });
        
        this.test('状态持久化功能可用', () => {
            return window.browseStateManager && 
                   typeof window.browseStateManager.setState === 'function';
        });
        
        this.test('状态获取功能可用', () => {
            return window.browseStateManager && 
                   typeof window.browseStateManager.getState === 'function';
        });
        
        this.test('订阅者模式可用', () => {
            return window.browseStateManager && 
                   typeof window.browseStateManager.subscribe === 'function';
        });
        
        // 测试状态存取
        this.test('状态存取功能正常', () => {
            if (!window.browseStateManager) return false;
            
            try {
                const testState = { test: Date.now() };
                window.browseStateManager.setState(testState);
                const retrievedState = window.browseStateManager.getState();
                return retrievedState.test === testState.test;
            } catch (error) {
                this.addError('State Management Test', error);
                return false;
            }
        });
    }

    /**
     * 测试性能优化
     */
    async testPerformanceOptimization() {
        console.log('⚡ 测试性能优化...');
        
        this.test('PerformanceOptimizer实例存在', () => {
            return window.performanceOptimizer !== undefined;
        });
        
        this.test('VirtualScroller可用', () => {
            return typeof window.VirtualScroller === 'function';
        });
        
        this.test('缓存功能可用', () => {
            return window.performanceOptimizer && 
                   typeof window.performanceOptimizer.setCache === 'function' &&
                   typeof window.performanceOptimizer.getCache === 'function';
        });
        
        this.test('批量处理功能可用', () => {
            return window.performanceOptimizer && 
                   typeof window.performanceOptimizer.batchProcess === 'function';
        });
        
        // 测试缓存功能
        this.test('缓存存取功能正常', () => {
            if (!window.performanceOptimizer) return false;
            
            try {
                const testKey = 'test_cache_' + Date.now();
                const testValue = { data: 'test_data' };
                
                window.performanceOptimizer.setCache(testKey, testValue);
                const cachedValue = window.performanceOptimizer.getCache(testKey);
                
                return cachedValue && cachedValue.data === testValue.data;
            } catch (error) {
                this.addError('Cache Test', error);
                return false;
            }
        });
        
        // 测试虚拟滚动创建
        this.test('虚拟滚动器可创建', () => {
            if (!window.performanceOptimizer || !window.VirtualScroller) return false;
            
            try {
                const testContainer = document.createElement('div');
                testContainer.style.height = '200px';
                
                const testItems = Array.from({ length: 10 }, (_, i) => ({ id: i, title: `Test ${i}` }));
                const renderer = (item) => {
                    const div = document.createElement('div');
                    div.textContent = item.title;
                    return div;
                };
                
                const scroller = window.performanceOptimizer.createVirtualScroller(
                    testContainer, testItems, renderer, { itemHeight: 50 }
                );
                
                const success = scroller !== null;
                
                // 清理测试对象
                if (scroller && typeof scroller.destroy === 'function') {
                    scroller.destroy();
                }
                
                return success;
            } catch (error) {
                this.addError('Virtual Scroller Test', error);
                return false;
            }
        });
    }

    /**
     * 测试错误恢复
     */
    async testErrorRecovery() {
        console.log('🛡️ 测试错误恢复...');
        
        this.test('ExamBrowserRecovery实例存在', () => {
            return window.examBrowserRecovery !== undefined;
        });
        
        this.test('错误处理方法可用', () => {
            return window.examBrowserRecovery && 
                   typeof window.examBrowserRecovery.handleError === 'function';
        });
        
        this.test('健康检查功能可用', () => {
            return window.examBrowserRecovery && 
                   typeof window.examBrowserRecovery.performHealthCheck === 'function';
        });
        
        this.test('错误统计功能可用', () => {
            return window.examBrowserRecovery && 
                   typeof window.examBrowserRecovery.getErrorStats === 'function';
        });
        
        this.test('全局错误处理器存在', () => {
            return typeof window.handleError === 'function';
        });
        
        // 测试健康检查
        this.test('健康检查执行正常', () => {
            if (!window.examBrowserRecovery) return false;
            
            try {
                window.examBrowserRecovery.performHealthCheck();
                return true;
            } catch (error) {
                this.addError('Health Check Test', error);
                return false;
            }
        });
    }

    /**
     * 测试数据完整性
     */
    async testDataIntegrity() {
        console.log('📊 测试数据完整性...');
        
        this.test('题库数据已加载', () => {
            return window.examIndex && Array.isArray(window.examIndex) && window.examIndex.length > 0;
        });
        
        this.test('题库数据格式正确', () => {
            if (!window.examIndex || window.examIndex.length === 0) return false;
            
            const sample = window.examIndex[0];
            return sample && 
                   typeof sample.id === 'string' &&
                   typeof sample.title === 'string' &&
                   typeof sample.category === 'string';
        });
        
        this.test('LocalStorage功能正常', () => {
            try {
                const testKey = 'integration_test_' + Date.now();
                const testValue = 'test_value';
                
                localStorage.setItem(testKey, testValue);
                const retrieved = localStorage.getItem(testKey);
                localStorage.removeItem(testKey);
                
                return retrieved === testValue;
            } catch (error) {
                this.addError('LocalStorage Test', error);
                return false;
            }
        });
        
        this.test('storage工具函数可用', () => {
            return window.storage && 
                   typeof window.storage.get === 'function' &&
                   typeof window.storage.set === 'function';
        });
    }

    /**
     * 执行单个测试
     */
    test(description, testFn) {
        this.testResults.total++;
        
        try {
            const result = testFn();
            if (result) {
                this.testResults.passed++;
                console.log(`✅ ${description}`);
            } else {
                this.testResults.failed++;
                console.log(`❌ ${description}`);
                this.testResults.errors.push({
                    test: description,
                    error: 'Test returned false',
                    type: 'assertion_failure'
                });
            }
        } catch (error) {
            this.testResults.failed++;
            console.error(`💥 ${description}:`, error);
            this.addError(description, error);
        }
    }

    /**
     * 添加错误
     */
    addError(test, error) {
        this.testResults.errors.push({
            test,
            error: error.message || String(error),
            stack: error.stack,
            type: 'exception'
        });
    }

    /**
     * 生成测试报告
     */
    generateReport() {
        const endTime = performance.now();
        const duration = Math.round(endTime - this.startTime);
        
        console.log('\n📋 集成测试报告');
        console.log('================');
        console.log(`总测试数: ${this.testResults.total}`);
        console.log(`通过: ${this.testResults.passed}`);
        console.log(`失败: ${this.testResults.failed}`);
        console.log(`成功率: ${Math.round((this.testResults.passed / this.testResults.total) * 100)}%`);
        console.log(`执行时间: ${duration}ms`);
        
        if (this.testResults.errors.length > 0) {
            console.log('\n❌ 错误详情:');
            this.testResults.errors.forEach((error, index) => {
                console.log(`${index + 1}. ${error.test}: ${error.error}`);
            });
        }
        
        // 显示用户消息
        const successRate = Math.round((this.testResults.passed / this.testResults.total) * 100);
        if (successRate >= 90) {
            window.showMessage(`集成测试完成！成功率: ${successRate}% (${duration}ms)`, 'success');
        } else if (successRate >= 70) {
            window.showMessage(`集成测试完成，存在一些问题。成功率: ${successRate}%`, 'warning');
        } else {
            window.showMessage(`集成测试失败！成功率仅 ${successRate}%，请检查错误`, 'error');
        }
        
        // 返回测试结果
        return {
            ...this.testResults,
            successRate,
            duration
        };
    }
}

// 导出到全局
window.IntegrationTester = IntegrationTester;

// 提供便捷的测试函数
window.runIntegrationTest = async function() {
    const tester = new IntegrationTester();
    return await tester.runAllTests();
};

console.log('📋 集成测试模块已加载');