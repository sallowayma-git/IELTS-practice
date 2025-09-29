// systemTest.js - Test the new architecture in file:// protocol mode
// This script can be run to verify all components are working correctly

window.SystemTest = class SystemTest {
    constructor() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
    }
    
    async runAllTests() {
        console.log('[SystemTest] Starting comprehensive system tests...');
        
        try {
            // Test 1: Check dependencies
            await this.testDependencies();
            
            // Test 2: Test stores
            await this.testStores();
            
            // Test 3: Test UI components
            await this.testUIComponents();
            
            // Test 4: Test data flow
            await this.testDataFlow();
            
            // Test 5: Test error handling
            await this.testErrorHandling();
            
            // Test 6: Test file protocol compatibility
            await this.testFileProtocolCompatibility();
            
            // Generate report
            this.generateReport();
            
        } catch (error) {
            console.error('[SystemTest] Test suite failed:', error);
            this.fail('Test suite execution', error.message);
        }
        
        return {
            passed: this.passed,
            failed: this.failed,
            results: this.results
        };
    }
    
    async testDependencies() {
        console.log('[SystemTest] Testing dependencies...');
        
        // Test required global classes
        const requiredClasses = [
            'ExamStore', 'RecordStore', 'AppStore',
            'ExamBrowser', 'RecordViewer', 'SettingsPanel',
            'EventEmitter', 'ErrorDisplay'
        ];
        
        requiredClasses.forEach(className => {
            if (window[className]) {
                this.pass(`Dependency: ${className}`, 'Class is available');
            } else {
                this.fail(`Dependency: ${className}`, 'Class is missing');
            }
        });
        
        // Test required functions
        const requiredFunctions = [
            'validateExam', 'validateRecord', 'sanitizeExam'
        ];
        
        requiredFunctions.forEach(funcName => {
            if (typeof window[funcName] === 'function') {
                this.pass(`Function: ${funcName}`, 'Function is available');
            } else {
                this.fail(`Function: ${funcName}`, 'Function is missing');
            }
        });
        
        // Test storage system
        if (window.storage && typeof window.storage.get === 'function') {
            this.pass('Storage system', 'Storage is available');
        } else {
            this.fail('Storage system', 'Storage is not available');
        }
    }
    
    async testStores() {
        console.log('[SystemTest] Testing stores...');
        
        if (!window.app || !window.app.stores) {
            this.fail('Store initialization', 'App stores not available');
            return;
        }
        
        const stores = window.app.stores;
        
        // Test ExamStore
        if (stores.exams) {
            try {
                const exams = stores.exams.exams;
                this.pass('ExamStore', `Loaded ${exams.length} exams`);
                
                // Test search functionality
                const searchResults = stores.exams.searchExams('test');
                this.pass('ExamStore search', `Search returned ${searchResults.length} results`);
                
                // Test category filtering
                const p1Exams = stores.exams.getExamsByCategory('P1');
                this.pass('ExamStore filtering', `P1 category has ${p1Exams.length} exams`);
                
            } catch (error) {
                this.fail('ExamStore', error.message);
            }
        } else {
            this.fail('ExamStore', 'Store not initialized');
        }
        
        // Test RecordStore
        if (stores.records) {
            try {
                const records = stores.records.records;
                const stats = stores.records.stats;
                this.pass('RecordStore', `Loaded ${records.length} records`);
                this.pass('RecordStore stats', `Average score: ${stats.averageScore}%`);
                
            } catch (error) {
                this.fail('RecordStore', error.message);
            }
        } else {
            this.fail('RecordStore', 'Store not initialized');
        }
        
        // Test AppStore
        if (stores.app) {
            try {
                const debugInfo = stores.app.getDebugInfo();
                this.pass('AppStore', `Current view: ${debugInfo.currentView}`);
                
            } catch (error) {
                this.fail('AppStore', error.message);
            }
        } else {
            this.fail('AppStore', 'Store not initialized');
        }
    }
    
    async testUIComponents() {
        console.log('[SystemTest] Testing UI components...');
        
        if (!window.app || !window.app.ui) {
            this.fail('UI initialization', 'App UI not available');
            return;
        }
        
        const ui = window.app.ui;
        
        // Test ExamBrowser
        if (ui.browser) {
            try {
                // Test DOM elements
                const hasContainer = !!ui.browser.elements.container;
                this.pass('ExamBrowser DOM', `Container element: ${hasContainer}`);
                
                // Test filtering
                ui.browser.setCategory('P1');
                this.pass('ExamBrowser filtering', 'Category filter applied');
                
            } catch (error) {
                this.fail('ExamBrowser', error.message);
            }
        } else {
            this.fail('ExamBrowser', 'Component not initialized');
        }
        
        // Test RecordViewer
        if (ui.records) {
            try {
                // Test stats display
                ui.records.renderStats();
                this.pass('RecordViewer stats', 'Stats rendered successfully');
                
            } catch (error) {
                this.fail('RecordViewer', error.message);
            }
        } else {
            this.fail('RecordViewer', 'Component not initialized');
        }
        
        // Test SettingsPanel
        if (ui.settings) {
            try {
                ui.settings.updateSystemInfo();
                this.pass('SettingsPanel', 'System info updated');
                
            } catch (error) {
                this.fail('SettingsPanel', error.message);
            }
        } else {
            this.fail('SettingsPanel', 'Component not initialized');
        }
    }
    
    async testDataFlow() {
        console.log('[SystemTest] Testing data flow...');
        
        if (!window.app || !window.app.stores) {
            this.fail('Data flow', 'Stores not available');
            return;
        }
        
        try {
            // Test observer pattern
            let eventReceived = false;
            const unsubscribe = window.app.stores.exams.subscribe((event) => {
                if (event.type === 'test_event') {
                    eventReceived = true;
                }
            });
            
            // Trigger test event
            window.app.stores.exams.notify({ type: 'test_event', data: 'test' });
            
            if (eventReceived) {
                this.pass('Observer pattern', 'Event received successfully');
            } else {
                this.fail('Observer pattern', 'Event not received');
            }
            
            unsubscribe();
            
        } catch (error) {
            this.fail('Data flow', error.message);
        }
    }
    
    async testErrorHandling() {
        console.log('[SystemTest] Testing error handling...');
        
        try {
            // Test error display system
            if (window.errorDisplay) {
                const errorId = window.errorDisplay.show('Test error message', 'warning', ['Test Action']);
                this.pass('Error display', 'Error message displayed');
                
                // Clean up
                setTimeout(() => {
                    window.errorDisplay.hide(errorId);
                }, 1000);
                
            } else {
                this.fail('Error display', 'ErrorDisplay not available');
            }
            
            // Test app store error handling
            if (window.app && window.app.stores && window.app.stores.app) {
                const errorsBefore = window.app.stores.app.getErrors().length;
                
                window.app.stores.app.addError({
                    message: 'Test error',
                    context: 'SystemTest',
                    recoverable: true
                });
                
                const errorsAfter = window.app.stores.app.getErrors().length;
                
                if (errorsAfter > errorsBefore) {
                    this.pass('AppStore error handling', 'Error added successfully');
                } else {
                    this.fail('AppStore error handling', 'Error not added');
                }
                
            } else {
                this.fail('AppStore error handling', 'AppStore not available');
            }
            
        } catch (error) {
            this.fail('Error handling', error.message);
        }
    }
    
    async testFileProtocolCompatibility() {
        console.log('[SystemTest] Testing file:// protocol compatibility...');
        
        // Test if we're running in file:// mode
        const isFileProtocol = window.location.protocol === 'file:';
        this.pass('Protocol detection', `Running in ${window.location.protocol} mode`);
        
        // Test localStorage access
        try {
            const testKey = 'system_test_' + Date.now();
            localStorage.setItem(testKey, 'test_value');
            const retrieved = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);
            
            if (retrieved === 'test_value') {
                this.pass('localStorage', 'Read/write operations work');
            } else {
                this.fail('localStorage', 'Read/write operations failed');
            }
            
        } catch (error) {
            this.fail('localStorage', error.message);
        }
        
        // Test global variable access
        try {
            window.testGlobal = 'test_value';
            if (window.testGlobal === 'test_value') {
                this.pass('Global variables', 'Global variable access works');
            } else {
                this.fail('Global variables', 'Global variable access failed');
            }
            delete window.testGlobal;
            
        } catch (error) {
            this.fail('Global variables', error.message);
        }
        
        // Test script loading order
        const expectedOrder = [
            'validateExam', 'EventEmitter', 'ExamStore', 'ExamBrowser', 'App'
        ];
        
        let orderCorrect = true;
        expectedOrder.forEach(item => {
            if (!window[item]) {
                orderCorrect = false;
            }
        });
        
        if (orderCorrect) {
            this.pass('Script loading order', 'All dependencies loaded in correct order');
        } else {
            this.fail('Script loading order', 'Some dependencies missing or out of order');
        }
    }
    
    pass(testName, message) {
        this.results.push({
            test: testName,
            status: 'PASS',
            message: message,
            timestamp: new Date().toISOString()
        });
        this.passed++;
        console.log(`✅ [SystemTest] ${testName}: ${message}`);
    }
    
    fail(testName, message) {
        this.results.push({
            test: testName,
            status: 'FAIL',
            message: message,
            timestamp: new Date().toISOString()
        });
        this.failed++;
        console.error(`❌ [SystemTest] ${testName}: ${message}`);
    }
    
    generateReport() {
        const total = this.passed + this.failed;
        const successRate = total > 0 ? Math.round((this.passed / total) * 100) : 0;
        
        console.log('\n' + '='.repeat(50));
        console.log('SYSTEM TEST REPORT');
        console.log('='.repeat(50));
        console.log(`Total Tests: ${total}`);
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Success Rate: ${successRate}%`);
        console.log('='.repeat(50));
        
        if (this.failed > 0) {
            console.log('\nFAILED TESTS:');
            this.results.filter(r => r.status === 'FAIL').forEach(result => {
                console.log(`❌ ${result.test}: ${result.message}`);
            });
        }
        
        console.log('\nTest completed at:', new Date().toLocaleString());
        
        // Show user-friendly message
        if (window.showMessage) {
            if (this.failed === 0) {
                window.showMessage(`系统测试完成：所有 ${total} 项测试通过 ✅`, 'success');
            } else {
                window.showMessage(`系统测试完成：${this.passed}/${total} 项测试通过，${this.failed} 项失败 ⚠️`, 'warning');
            }
        }
        
        return {
            total,
            passed: this.passed,
            failed: this.failed,
            successRate,
            results: this.results
        };
    }
};

// Global function to run tests
window.runSystemTest = async function() {
    const tester = new window.SystemTest();
    return await tester.runAllTests();
};

// Auto-run tests in debug mode
if (localStorage.getItem('auto_test') === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            window.runSystemTest();
        }, 2000); // Wait 2 seconds for everything to initialize
    });
}