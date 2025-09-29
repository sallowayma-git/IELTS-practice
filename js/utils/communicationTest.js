// communicationTest.js - Test cross-window communication and data persistence
// Tests postMessage communication and localStorage persistence

window.CommunicationTest = class CommunicationTest {
    constructor() {
        this.testWindows = new Map();
        this.messageHandlers = new Map();
        this.results = [];
    }
    
    async runCommunicationTests() {
        console.log('[CommunicationTest] Starting cross-window communication tests...');
        
        try {
            // Test 1: localStorage persistence
            await this.testLocalStoragePersistence();
            
            // Test 2: postMessage communication
            await this.testPostMessageCommunication();
            
            // Test 3: Data synchronization
            await this.testDataSynchronization();
            
            // Test 4: Window management
            await this.testWindowManagement();
            
            this.generateReport();
            
        } catch (error) {
            console.error('[CommunicationTest] Communication test suite failed:', error);
        }
        
        return this.results;
    }
    
    async testLocalStoragePersistence() {
        console.log('[CommunicationTest] Testing localStorage persistence...');
        
        try {
            // Test basic persistence
            const testData = {
                timestamp: Date.now(),
                testArray: [1, 2, 3],
                testObject: { key: 'value' },
                testString: 'test string'
            };
            
            // Save data
            localStorage.setItem('communication_test_data', JSON.stringify(testData));
            
            // Retrieve data
            const retrieved = JSON.parse(localStorage.getItem('communication_test_data'));
            
            if (JSON.stringify(retrieved) === JSON.stringify(testData)) {
                this.pass('localStorage persistence', 'Complex data saved and retrieved correctly');
            } else {
                this.fail('localStorage persistence', 'Data corruption detected');
            }
            
            // Test with existing storage system
            if (window.storage) {
                await window.storage.set('test_key', testData);
                const storageRetrieved = await window.storage.get('test_key');
                
                if (JSON.stringify(storageRetrieved) === JSON.stringify(testData)) {
                    this.pass('Storage system persistence', 'Storage system works correctly');
                } else {
                    this.fail('Storage system persistence', 'Storage system data corruption');
                }
                
                await window.storage.remove('test_key');
            }
            
            // Clean up
            localStorage.removeItem('communication_test_data');
            
        } catch (error) {
            this.fail('localStorage persistence', error.message);
        }
    }
    
    async testPostMessageCommunication() {
        console.log('[CommunicationTest] Testing postMessage communication...');
        
        try {
            // Create a test window (using about:blank to avoid file access issues)
            const testWindow = window.open('about:blank', 'communication_test', 'width=400,height=300');
            
            if (!testWindow) {
                this.fail('postMessage communication', 'Failed to open test window (popup blocked?)');
                return;
            }
            
            this.testWindows.set('communication_test', testWindow);
            
            // Setup message listener
            let messageReceived = false;
            const messageHandler = (event) => {
                if (event.data && event.data.type === 'communication_test_response') {
                    messageReceived = true;
                    this.pass('postMessage communication', 'Message received from child window');
                }
            };
            
            window.addEventListener('message', messageHandler);
            this.messageHandlers.set('communication_test', messageHandler);
            
            // Setup the test window content
            testWindow.document.write(`
                <html>
                <head><title>Communication Test</title></head>
                <body>
                    <h3>Communication Test Window</h3>
                    <p>This window tests postMessage communication.</p>
                    <script>
                        // Listen for messages from parent
                        window.addEventListener('message', function(event) {
                            if (event.data && event.data.type === 'communication_test') {
                                console.log('Test window received message:', event.data);
                                
                                // Send response back to parent
                                event.source.postMessage({
                                    type: 'communication_test_response',
                                    originalData: event.data,
                                    timestamp: Date.now()
                                }, '*');
                            }
                        });
                        
                        // Notify parent that window is ready
                        window.addEventListener('load', function() {
                            window.opener.postMessage({
                                type: 'test_window_ready'
                            }, '*');
                        });
                    </script>
                </body>
                </html>
            `);
            testWindow.document.close();
            
            // Wait for window to be ready
            await new Promise((resolve) => {
                const readyHandler = (event) => {
                    if (event.data && event.data.type === 'test_window_ready') {
                        window.removeEventListener('message', readyHandler);
                        resolve();
                    }
                };
                window.addEventListener('message', readyHandler);
            });
            
            // Send test message
            testWindow.postMessage({
                type: 'communication_test',
                data: 'Hello from parent window',
                timestamp: Date.now()
            }, '*');
            
            // Wait for response
            await new Promise((resolve) => {
                setTimeout(() => {
                    if (messageReceived) {
                        this.pass('postMessage bidirectional', 'Bidirectional communication successful');
                    } else {
                        this.fail('postMessage bidirectional', 'No response received from child window');
                    }
                    resolve();
                }, 2000);
            });
            
        } catch (error) {
            this.fail('postMessage communication', error.message);
        }
    }
    
    async testDataSynchronization() {
        console.log('[CommunicationTest] Testing data synchronization...');
        
        try {
            // Test exam record synchronization
            if (window.app && window.app.stores && window.app.stores.records) {
                const recordStore = window.app.stores.records;
                const initialRecordCount = recordStore.records.length;
                
                // Create a test record
                const testRecord = {
                    examId: 'test_exam_' + Date.now(),
                    score: { percentage: 85, correct: 17, total: 20 },
                    duration: 1200,
                    answers: { q1: 'A', q2: 'B' },
                    dataSource: 'test'
                };
                
                // Save record
                await recordStore.saveRecord(testRecord);
                
                // Verify record was saved
                const newRecordCount = recordStore.records.length;
                if (newRecordCount > initialRecordCount) {
                    this.pass('Data synchronization', 'Record saved successfully');
                    
                    // Test data persistence across page reload simulation
                    const savedRecords = await window.storage.get('practice_records', []);
                    const testRecordExists = savedRecords.some(r => r.examId === testRecord.examId);
                    
                    if (testRecordExists) {
                        this.pass('Data persistence', 'Record persisted to storage');
                    } else {
                        this.fail('Data persistence', 'Record not found in storage');
                    }
                    
                    // Clean up test record
                    const testRecordId = recordStore.records.find(r => r.examId === testRecord.examId)?.id;
                    if (testRecordId) {
                        await recordStore.deleteRecord(testRecordId);
                    }
                    
                } else {
                    this.fail('Data synchronization', 'Record not saved');
                }
                
            } else {
                this.fail('Data synchronization', 'RecordStore not available');
            }
            
        } catch (error) {
            this.fail('Data synchronization', error.message);
        }
    }
    
    async testWindowManagement() {
        console.log('[CommunicationTest] Testing window management...');
        
        try {
            // Test window creation and management
            if (window.app && window.app.ui && window.app.ui.browser) {
                // Test exam window opening (simulation)
                const examBrowser = window.app.ui.browser;
                
                // Check if exam opening functions exist
                if (typeof examBrowser.handleExamStart === 'function') {
                    this.pass('Window management', 'Exam opening function available');
                } else {
                    this.fail('Window management', 'Exam opening function not available');
                }
                
                // Test window messenger creation
                if (window.createWindowMessenger) {
                    const testWindow = { postMessage: () => {}, closed: false };
                    const messenger = window.createWindowMessenger(testWindow);
                    
                    if (messenger && typeof messenger.send === 'function') {
                        this.pass('Window messenger', 'Window messenger created successfully');
                    } else {
                        this.fail('Window messenger', 'Window messenger creation failed');
                    }
                } else {
                    this.fail('Window messenger', 'createWindowMessenger function not available');
                }
                
            } else {
                this.fail('Window management', 'ExamBrowser not available');
            }
            
        } catch (error) {
            this.fail('Window management', error.message);
        }
    }
    
    pass(testName, message) {
        this.results.push({
            test: testName,
            status: 'PASS',
            message: message,
            timestamp: new Date().toISOString()
        });
        console.log(`✅ [CommunicationTest] ${testName}: ${message}`);
    }
    
    fail(testName, message) {
        this.results.push({
            test: testName,
            status: 'FAIL',
            message: message,
            timestamp: new Date().toISOString()
        });
        console.error(`❌ [CommunicationTest] ${testName}: ${message}`);
    }
    
    generateReport() {
        const passed = this.results.filter(r => r.status === 'PASS').length;
        const failed = this.results.filter(r => r.status === 'FAIL').length;
        const total = passed + failed;
        
        console.log('\n' + '='.repeat(50));
        console.log('COMMUNICATION TEST REPORT');
        console.log('='.repeat(50));
        console.log(`Total Tests: ${total}`);
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);
        console.log('='.repeat(50));
        
        if (failed > 0) {
            console.log('\nFAILED TESTS:');
            this.results.filter(r => r.status === 'FAIL').forEach(result => {
                console.log(`❌ ${result.test}: ${result.message}`);
            });
        }
        
        // Clean up test windows
        this.cleanup();
        
        return { total, passed, failed, results: this.results };
    }
    
    cleanup() {
        // Close test windows
        this.testWindows.forEach((testWindow, name) => {
            if (testWindow && !testWindow.closed) {
                testWindow.close();
            }
        });
        this.testWindows.clear();
        
        // Remove message handlers
        this.messageHandlers.forEach((handler, name) => {
            window.removeEventListener('message', handler);
        });
        this.messageHandlers.clear();
        
        console.log('[CommunicationTest] Cleanup completed');
    }
};

// Global function to run communication tests
window.runCommunicationTest = async function() {
    const tester = new window.CommunicationTest();
    return await tester.runCommunicationTests();
};

// Test localStorage availability immediately
(function testLocalStorageAvailability() {
    try {
        const testKey = 'ls_test_' + Date.now();
        localStorage.setItem(testKey, 'test');
        const retrieved = localStorage.getItem(testKey);
        localStorage.removeItem(testKey);
        
        if (retrieved === 'test') {
            console.log('✅ [CommunicationTest] localStorage is available and working');
        } else {
            console.error('❌ [CommunicationTest] localStorage test failed');
        }
    } catch (error) {
        console.error('❌ [CommunicationTest] localStorage not available:', error.message);
    }
})();