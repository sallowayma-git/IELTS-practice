// 通信测试器 - 测试总览系统与练习页面的跨窗口通信
class CommunicationTester {
    constructor() {
        this.testResults = [];
        this.activeTests = new Map();
    }

    // 测试单个题目的通信功能
    async testExamCommunication(examId, timeout = 10000) {
        const exam = window.examIndex?.find(e => e.id === examId);
        if (!exam) {
            return {
                examId,
                success: false,
                error: '题目不存在于索引中',
                timestamp: Date.now()
            };
        }

        console.log(`[CommunicationTester] 开始测试题目通信: ${exam.title}`);

        try {
            const fullPath = exam.path + exam.filename;
            
            // 打开题目页面
            const examWindow = window.open(fullPath, `comm_test_${examId}`, 
                'width=1000,height=700,scrollbars=yes,resizable=yes');

            if (!examWindow) {
                return {
                    examId,
                    examTitle: exam.title,
                    success: false,
                    error: '无法打开题目窗口，请检查弹窗设置',
                    timestamp: Date.now()
                };
            }

            // 等待页面加载
            await this.sleep(3000);

            // 检查窗口是否仍然打开
            if (examWindow.closed) {
                return {
                    examId,
                    examTitle: exam.title,
                    success: false,
                    error: '题目窗口意外关闭',
                    timestamp: Date.now()
                };
            }

            // 发送初始化消息
            const initMessage = {
                type: 'INIT_SESSION',
                data: {
                    sessionId: `test_${examId}_${Date.now()}`,
                    examId: examId,
                    examTitle: exam.title,
                    examCategory: exam.category,
                    parentOrigin: window.location.origin,
                    timestamp: Date.now(),
                    isTest: true
                }
            };

            examWindow.postMessage(initMessage, '*');
            console.log(`[CommunicationTester] 发送初始化消息:`, initMessage);

            // 等待响应
            const result = await this.waitForResponse(examWindow, examId, timeout);
            
            // 关闭测试窗口
            if (!examWindow.closed) {
                examWindow.close();
            }

            return {
                examId,
                examTitle: exam.title,
                ...result,
                timestamp: Date.now()
            };

        } catch (error) {
            console.error(`[CommunicationTester] 测试失败:`, error);
            return {
                examId,
                examTitle: exam.title,
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }

    // 等待页面响应
    waitForResponse(examWindow, examId, timeout) {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                this.activeTests.delete(examId);
                resolve({
                    success: false,
                    error: `通信测试超时 (${timeout}ms)，页面可能不支持跨窗口通信`
                });
            }, timeout);

            const messageHandler = (event) => {
                // 检查消息来源
                if (event.source !== examWindow) {
                    return;
                }

                console.log(`[CommunicationTester] 收到消息:`, event.data);

                // 处理不同类型的响应
                if (event.data.type === 'SESSION_INITIALIZED') {
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    this.activeTests.delete(examId);
                    
                    resolve({
                        success: true,
                        message: '通信测试成功 - 会话已初始化',
                        responseData: event.data
                    });
                } else if (event.data.type === 'PRACTICE_COMPLETED') {
                    // 如果收到练习完成消息，说明通信正常
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    this.activeTests.delete(examId);
                    
                    resolve({
                        success: true,
                        message: '通信测试成功 - 收到练习数据',
                        responseData: event.data
                    });
                } else if (event.data.type === 'ERROR') {
                    clearTimeout(timeoutId);
                    window.removeEventListener('message', messageHandler);
                    this.activeTests.delete(examId);
                    
                    resolve({
                        success: false,
                        error: `页面报告错误: ${event.data.message}`,
                        responseData: event.data
                    });
                }
            };

            window.addEventListener('message', messageHandler);
            this.activeTests.set(examId, { messageHandler, timeoutId });
        });
    }

    // 批量测试多个题目
    async testMultipleExams(examIds, concurrency = 3) {
        console.log(`[CommunicationTester] 开始批量测试 ${examIds.length} 个题目`);
        
        const results = [];
        
        // 分批处理，避免同时打开太多窗口
        for (let i = 0; i < examIds.length; i += concurrency) {
            const batch = examIds.slice(i, i + concurrency);
            const batchPromises = batch.map(examId => this.testExamCommunication(examId));
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // 批次间稍作延迟
            if (i + concurrency < examIds.length) {
                await this.sleep(2000);
            }
        }

        this.testResults = results;
        return this.generateTestReport();
    }

    // 测试所有题目
    async testAllExams() {
        if (!window.examIndex || window.examIndex.length === 0) {
            throw new Error('题库索引未加载');
        }

        const examIds = window.examIndex.map(exam => exam.id);
        return await this.testMultipleExams(examIds);
    }

    // 生成测试报告
    generateTestReport() {
        const total = this.testResults.length;
        const successful = this.testResults.filter(r => r.success).length;
        const failed = this.testResults.filter(r => !r.success).length;
        
        const report = {
            summary: {
                total,
                successful,
                failed,
                successRate: Math.round((successful / total) * 100)
            },
            results: this.testResults,
            failedTests: this.testResults.filter(r => !r.success),
            recommendations: this.generateRecommendations()
        };

        console.log('[CommunicationTester] 测试报告:', report);
        return report;
    }

    // 生成修复建议
    generateRecommendations() {
        const recommendations = [];
        const failedTests = this.testResults.filter(r => !r.success);

        if (failedTests.length === 0) {
            recommendations.push({
                type: 'success',
                message: '所有题目通信测试均通过，系统运行正常'
            });
            return recommendations;
        }

        // 分析失败原因
        const popupBlocked = failedTests.filter(r => r.error?.includes('弹窗')).length;
        const timeout = failedTests.filter(r => r.error?.includes('超时')).length;
        const fileNotFound = failedTests.filter(r => r.error?.includes('404')).length;

        if (popupBlocked > 0) {
            recommendations.push({
                type: 'warning',
                message: `${popupBlocked} 个题目因弹窗被阻止而测试失败`,
                action: '请在浏览器设置中允许此网站的弹窗'
            });
        }

        if (timeout > 0) {
            recommendations.push({
                type: 'error',
                message: `${timeout} 个题目通信超时`,
                action: '检查题目页面是否包含必要的通信代码'
            });
        }

        if (fileNotFound > 0) {
            recommendations.push({
                type: 'error',
                message: `${fileNotFound} 个题目文件不存在`,
                action: '检查文件路径和索引配置'
            });
        }

        return recommendations;
    }

    // 显示测试结果
    displayResults() {
        const report = this.generateTestReport();
        
        console.log('\n=== 通信测试报告 ===');
        console.log(`总计: ${report.summary.total} 个题目`);
        console.log(`成功: ${report.summary.successful} 个 (${report.summary.successRate}%)`);
        console.log(`失败: ${report.summary.failed} 个`);

        if (report.failedTests.length > 0) {
            console.log('\n失败的题目:');
            report.failedTests.forEach((test, index) => {
                console.log(`${index + 1}. ${test.examTitle || test.examId}`);
                console.log(`   错误: ${test.error}`);
                console.log('');
            });
        }

        if (report.recommendations.length > 0) {
            console.log('\n建议:');
            report.recommendations.forEach((rec, index) => {
                console.log(`${index + 1}. ${rec.message}`);
                if (rec.action) {
                    console.log(`   操作: ${rec.action}`);
                }
                console.log('');
            });
        }

        return report;
    }

    // 工具函数
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 清理活动测试
    cleanup() {
        this.activeTests.forEach((test, examId) => {
            if (test.timeoutId) {
                clearTimeout(test.timeoutId);
            }
            if (test.messageHandler) {
                window.removeEventListener('message', test.messageHandler);
            }
        });
        this.activeTests.clear();
    }
}

// 导出到全局
window.CommunicationTester = CommunicationTester;