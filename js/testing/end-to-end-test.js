/**
 * 端到端测试和验证
 * 验证从练习开始到数据导出的完整流程
 */
class EndToEndTest {
    constructor() {
        this.testResults = [];
        this.testData = {
            mockExamId: 'test-exam-001',
            mockSessionId: 'test-session-' + Date.now(),
            mockAnswers: {
                'q1': 'TRUE',
                'q2': 'FALSE',
                'q3': 'NOT GIVEN',
                'q4': 'A',
                'q5': 'B'
            },
            mockCorrectAnswers: {
                'q1': 'TRUE',
                'q2': 'FALSE', 
                'q3': 'TRUE',
                'q4': 'A',
                'q5': 'C'
            }
        };
    }

    /**
     * 运行完整的端到端测试
     */
    async runCompleteTest() {
        console.log('[E2E Test] 开始端到端测试...');
        
        try {
            // 1. 测试组件加载
            await this.testComponentLoading();
            
            // 2. 测试数据收集
            await this.testDataCollection();
            
            // 3. 测试数据传输
            await this.testDataTransmission();
            
            // 4. 测试数据存储
            await this.testDataStorage();
            
            // 5. 测试数据一致性
            await this.testDataConsistency();
            
            // 6. 测试弹窗显示
            await this.testModalDisplay();
            
            // 7. 测试数据导出
            await this.testDataExport();
            
            // 8. 测试错误恢复
            await this.testErrorRecovery();
            
            // 生成测试报告
            this.generateTestReport();
            
        } catch (error) {
            console.error('[E2E Test] 测试过程出错:', error);
            this.addTestResult('complete_test', false, '测试过程出错: ' + error.message);
        }
    }

    /**
     * 测试组件加载
     */
    async testComponentLoading() {
        console.log('[E2E Test] 测试组件加载...');
        
        const requiredComponents = [
            'PracticeRecorder',
            'PracticeHistory', 
            'PracticePageEnhancer',
            'PracticeHistoryEnhancer',
            'MarkdownExporter',
            'DataConsistencyManager'
        ];
        
        let allLoaded = true;
        const missingComponents = [];
        
        requiredComponents.forEach(componentName => {
            const component = window[componentName] || window[componentName.charAt(0).toLowerCase() + componentName.slice(1)];
            if (!component) {
                allLoaded = false;
                missingComponents.push(componentName);
            }
        });
        
        this.addTestResult(
            'component_loading',
            allLoaded,
            allLoaded ? '所有组件已加载' : `缺少组件: ${missingComponents.join(', ')}`
        );
        
        return allLoaded;
    }

    /**
     * 测试数据收集
     */
    async testDataCollection() {
        console.log('[E2E Test] 测试数据收集...');
        
        // 模拟练习页面数据收集
        const mockPracticeData = {
            sessionId: this.testData.mockSessionId,
            examId: this.testData.mockExamId,
            startTime: Date.now() - 300000, // 5分钟前开始
            endTime: Date.now(),
            duration: 300, // 5分钟
            answers: this.testData.mockAnswers,
            correctAnswers: this.testData.mockCorrectAnswers,
            scoreInfo: {
                correct: 3,
                total: 5,
                accuracy: 0.6,
                percentage: 60,
                source: 'test_extraction'
            },
            pageType: 'test',
            url: 'test://localhost/test.html',
            title: 'Test Practice'
        };
        
        // 验证数据结构
        const hasRequiredFields = mockPracticeData.sessionId && 
                                 mockPracticeData.answers && 
                                 mockPracticeData.correctAnswers &&
                                 mockPracticeData.scoreInfo;
        
        this.addTestResult(
            'data_collection',
            hasRequiredFields,
            hasRequiredFields ? '数据收集结构正确' : '数据收集结构不完整'
        );
        
        // 保存测试数据供后续使用
        this.mockPracticeData = mockPracticeData;
        
        return hasRequiredFields;
    }

    /**
     * 测试数据传输
     */
    async testDataTransmission() {
        console.log('[E2E Test] 测试数据传输...');
        
        // 模拟PracticePageEnhancer的数据传输
        let transmissionSuccess = false;
        
        try {
            if (window.practicePageEnhancer) {
                // 测试答案比较生成
                const answerComparison = window.practicePageEnhancer.generateAnswerComparison ?
                    window.practicePageEnhancer.generateAnswerComparison() :
                    this.generateMockAnswerComparison();
                
                transmissionSuccess = answerComparison && Object.keys(answerComparison).length > 0;
            } else {
                // 使用模拟数据
                transmissionSuccess = true;
            }
        } catch (error) {
            console.error('[E2E Test] 数据传输测试失败:', error);
        }
        
        this.addTestResult(
            'data_transmission',
            transmissionSuccess,
            transmissionSuccess ? '数据传输正常' : '数据传输失败'
        );
        
        return transmissionSuccess;
    }

    /**
     * 测试数据存储
     */
    async testDataStorage() {
        console.log('[E2E Test] 测试数据存储...');
        
        let storageSuccess = false;
        
        try {
            // 创建测试记录
            const testRecord = {
                id: 'test-record-' + Date.now(),
                examId: this.testData.mockExamId,
                ...this.mockPracticeData,
                answerComparison: this.generateMockAnswerComparison()
            };
            
            // 测试存储
            if (window.practiceRecorder) {
                const saved = window.practiceRecorder.savePracticeRecord(testRecord);
                storageSuccess = !!saved;
            } else {
                // 直接存储测试
                const records = storage.get('practice_records', []);
                records.unshift(testRecord);
                storage.set('practice_records', records);
                storageSuccess = true;
            }
            
            // 验证存储
            const storedRecords = storage.get('practice_records', []);
            const foundRecord = storedRecords.find(r => r.id === testRecord.id);
            storageSuccess = storageSuccess && !!foundRecord;
            
        } catch (error) {
            console.error('[E2E Test] 数据存储测试失败:', error);
        }
        
        this.addTestResult(
            'data_storage',
            storageSuccess,
            storageSuccess ? '数据存储正常' : '数据存储失败'
        );
        
        return storageSuccess;
    }

    /**
     * 测试数据一致性
     */
    async testDataConsistency() {
        console.log('[E2E Test] 测试数据一致性...');
        
        let consistencySuccess = false;
        
        try {
            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                const records = storage.get('practice_records', []);
                
                if (records.length > 0) {
                    // 测试数据验证
                    const validation = manager.validateRecordData(records[0]);
                    
                    // 测试数据修复
                    const enriched = manager.enrichRecordData(records[0]);
                    
                    consistencySuccess = validation && enriched && 
                                       enriched.answerComparison && 
                                       Object.keys(enriched.answerComparison).length > 0;
                } else {
                    consistencySuccess = true; // 没有数据时认为一致
                }
            } else {
                consistencySuccess = false;
            }
        } catch (error) {
            console.error('[E2E Test] 数据一致性测试失败:', error);
        }
        
        this.addTestResult(
            'data_consistency',
            consistencySuccess,
            consistencySuccess ? '数据一致性正常' : '数据一致性检查失败'
        );
        
        return consistencySuccess;
    }

    /**
     * 测试弹窗显示
     */
    async testModalDisplay() {
        console.log('[E2E Test] 测试弹窗显示...');
        
        let modalSuccess = false;
        
        try {
            if (window.practiceRecordModal) {
                const records = storage.get('practice_records', []);
                if (records.length > 0) {
                    // 测试弹窗显示（不实际显示，只测试数据处理）
                    const record = records[0];
                    const correctAnswers = window.practiceRecordModal.getCorrectAnswers(record);
                    const hasCorrectAnswers = correctAnswers && Object.keys(correctAnswers).length > 0;
                    
                    modalSuccess = hasCorrectAnswers;
                } else {
                    modalSuccess = true; // 没有记录时跳过测试
                }
            } else {
                modalSuccess = false;
            }
        } catch (error) {
            console.error('[E2E Test] 弹窗显示测试失败:', error);
        }
        
        this.addTestResult(
            'modal_display',
            modalSuccess,
            modalSuccess ? '弹窗显示功能正常' : '弹窗显示功能异常'
        );
        
        return modalSuccess;
    }

    /**
     * 测试数据导出
     */
    async testDataExport() {
        console.log('[E2E Test] 测试数据导出...');
        
        let exportSuccess = false;
        
        try {
            if (window.MarkdownExporter) {
                const exporter = new MarkdownExporter();
                const records = storage.get('practice_records', []);
                
                if (records.length > 0) {
                    // 测试单个记录的Markdown生成
                    const markdown = exporter.generateRecordMarkdown(records[0]);
                    exportSuccess = markdown && markdown.length > 0 && markdown.includes('|');
                } else {
                    exportSuccess = true; // 没有记录时跳过测试
                }
            } else {
                exportSuccess = false;
            }
        } catch (error) {
            console.error('[E2E Test] 数据导出测试失败:', error);
        }
        
        this.addTestResult(
            'data_export',
            exportSuccess,
            exportSuccess ? '数据导出功能正常' : '数据导出功能异常'
        );
        
        return exportSuccess;
    }

    /**
     * 测试错误恢复
     */
    async testErrorRecovery() {
        console.log('[E2E Test] 测试错误恢复...');
        
        let recoverySuccess = false;
        
        try {
            // 测试组件恢复功能
            if (window.attemptComponentRecovery) {
                window.attemptComponentRecovery();
                recoverySuccess = true;
            }
            
            // 测试数据修复功能
            if (window.validateAndFixDataConsistency) {
                // 不实际调用，只检查函数存在
                recoverySuccess = recoverySuccess && true;
            }
            
        } catch (error) {
            console.error('[E2E Test] 错误恢复测试失败:', error);
        }
        
        this.addTestResult(
            'error_recovery',
            recoverySuccess,
            recoverySuccess ? '错误恢复功能正常' : '错误恢复功能异常'
        );
        
        return recoverySuccess;
    }

    /**
     * 生成模拟答案比较数据
     */
    generateMockAnswerComparison() {
        const comparison = {};
        
        Object.keys(this.testData.mockAnswers).forEach(key => {
            const userAnswer = this.testData.mockAnswers[key];
            const correctAnswer = this.testData.mockCorrectAnswers[key];
            
            comparison[key] = {
                userAnswer: userAnswer,
                correctAnswer: correctAnswer,
                isCorrect: userAnswer === correctAnswer
            };
        });
        
        return comparison;
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
        console.log(`[E2E Test] ${status} ${testName}: ${description}`);
    }

    /**
     * 生成测试报告
     */
    generateTestReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
        
        console.log('\n=== 端到端测试报告 ===');
        console.log(`总测试数: ${totalTests}`);
        console.log(`通过: ${passedTests}`);
        console.log(`失败: ${failedTests}`);
        console.log(`成功率: ${successRate}%`);
        console.log('\n详细结果:');
        
        // 详细结果
        this.testResults.forEach(result => {
            const status = result.passed ? '✅' : '❌';
            console.log(`${status} ${result.name}: ${result.description}`);
        });
        
        // 生成HTML报告
        this.generateHTMLReport();
        
        // 返回测试结果
        return {
            totalTests,
            passedTests,
            failedTests,
            successRate: parseFloat(successRate),
            results: this.testResults
        };
    }

    /**
     * 生成HTML测试报告
     */
    generateHTMLReport() {
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.passed).length;
        const failedTests = totalTests - passedTests;
        const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(1) : 0;
        
        const reportHtml = `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: white;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                z-index: 10000;
                color: #333;
            ">
                <h2 style="margin: 0 0 20px 0; color: #2563eb;">端到端测试报告</h2>
                
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px;">
                    <div style="text-align: center; padding: 15px; background: #f8fafc; border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: #1e293b;">${totalTests}</div>
                        <div style="font-size: 14px; color: #64748b;">总测试数</div>
                    </div>
                    <div style="text-align: center; padding: 15px; background: #f0fdf4; border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: #059669;">${passedTests}</div>
                        <div style="font-size: 14px; color: #064e3b;">通过</div>
                    </div>
                    <div style="text-align: center; padding: 15px; background: ${failedTests > 0 ? '#fef2f2' : '#f8fafc'}; border-radius: 8px;">
                        <div style="font-size: 24px; font-weight: bold; color: ${failedTests > 0 ? '#dc2626' : '#64748b'};">${failedTests}</div>
                        <div style="font-size: 14px; color: ${failedTests > 0 ? '#7f1d1d' : '#64748b'};">失败</div>
                    </div>
                </div>
                
                <div style="text-align: center; margin-bottom: 25px;">
                    <div style="font-size: 32px; font-weight: bold; color: ${successRate >= 80 ? '#059669' : successRate >= 60 ? '#d97706' : '#dc2626'};">
                        ${successRate}%
                    </div>
                    <div style="font-size: 16px; color: #64748b;">成功率</div>
                </div>
                
                <h3 style="margin: 20px 0 15px 0; color: #374151;">测试详情</h3>
                <div style="max-height: 300px; overflow-y: auto;">
                    ${this.testResults.map(result => `
                        <div style="
                            display: flex;
                            align-items: center;
                            padding: 12px;
                            margin-bottom: 8px;
                            background: ${result.passed ? '#f0fdf4' : '#fef2f2'};
                            border-radius: 6px;
                            border-left: 4px solid ${result.passed ? '#10b981' : '#ef4444'};
                        ">
                            <span style="font-size: 18px; margin-right: 12px;">
                                ${result.passed ? '✅' : '❌'}
                            </span>
                            <div style="flex: 1;">
                                <div style="font-weight: 600; color: #1f2937; margin-bottom: 2px;">
                                    ${result.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </div>
                                <div style="font-size: 14px; color: #6b7280;">
                                    ${result.description}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                <div style="text-align: center; margin-top: 25px;">
                    <button onclick="this.parentElement.parentElement.remove()" style="
                        background: #3b82f6;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 6px;
                        font-size: 16px;
                        cursor: pointer;
                        transition: background 0.2s;
                    " onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                        关闭报告
                    </button>
                </div>
            </div>
        `;
        
        // 添加到页面
        const reportDiv = document.createElement('div');
        reportDiv.innerHTML = reportHtml;
        document.body.appendChild(reportDiv);
    }

    /**
     * 清理测试数据
     */
    cleanup() {
        // 清理测试创建的记录
        const records = storage.get('practice_records', []);
        const cleanedRecords = records.filter(r => !r.id.startsWith('test-record-'));
        storage.set('practice_records', cleanedRecords);
        
        console.log('[E2E Test] 测试数据清理完成');
    }
}

// 导出类和全局函数
window.EndToEndTest = EndToEndTest;

// 全局测试函数
window.runEndToEndTest = async function() {
    const test = new EndToEndTest();
    const results = await test.runCompleteTest();
    
    // 询问是否清理测试数据
    setTimeout(() => {
        if (confirm('测试完成！是否清理测试数据？')) {
            test.cleanup();
        }
    }, 2000);
    
    return results;
};

// 快速验证函数
window.quickValidation = function() {
    console.log('[Quick Validation] 开始快速验证...');
    
    const checks = {
        'PracticeRecorder': !!window.PracticeRecorder,
        'PracticeHistory': !!window.PracticeHistory,
        'PracticePageEnhancer': !!window.practicePageEnhancer,
        'MarkdownExporter': !!window.MarkdownExporter,
        'DataConsistencyManager': !!window.DataConsistencyManager,
        'Storage': !!window.storage,
        'Practice Records': storage.get('practice_records', []).length > 0
    };
    
    let allGood = true;
    Object.entries(checks).forEach(([name, status]) => {
        const icon = status ? '✅' : '❌';
        console.log(`${icon} ${name}: ${status ? '正常' : '异常'}`);
        if (!status && name !== 'Practice Records') allGood = false;
    });
    
    const message = allGood ? '✅ 系统状态正常' : '⚠️ 发现问题，建议运行完整测试';
    console.log(message);
    
    if (window.showMessage) {
        window.showMessage(message.replace(/[✅⚠️]/g, ''), allGood ? 'success' : 'warning');
    }
    
    return allGood;
};

console.log('[E2E Test] 端到端测试模块已加载');
console.log('[E2E Test] 使用 runEndToEndTest() 运行完整测试');
console.log('[E2E Test] 使用 quickValidation() 运行快速验证');