// 索引验证器 - 检查题目文件是否存在并可正常访问
class IndexValidator {
    constructor() {
        this.validationResults = [];
        this.totalChecked = 0;
        this.successCount = 0;
        this.failureCount = 0;
    }

    // 验证单个题目文件
    async validateExamFile(exam) {
        const fullPath = exam.path + exam.filename;
        
        try {
            const response = await fetch(fullPath, { method: 'HEAD' });
            
            if (response.ok) {
                this.successCount++;
                return {
                    id: exam.id,
                    title: exam.title,
                    path: fullPath,
                    status: 'success',
                    message: '文件存在且可访问'
                };
            } else {
                this.failureCount++;
                return {
                    id: exam.id,
                    title: exam.title,
                    path: fullPath,
                    status: 'error',
                    message: `HTTP ${response.status}: 文件不存在或无法访问`
                };
            }
        } catch (error) {
            this.failureCount++;
            return {
                id: exam.id,
                title: exam.title,
                path: fullPath,
                status: 'error',
                message: `网络错误: ${error.message}`
            };
        }
    }

    // 验证所有题目
    async validateAllExams(examIndex) {
        console.log('[IndexValidator] 开始验证题目索引...');
        this.validationResults = [];
        this.totalChecked = 0;
        this.successCount = 0;
        this.failureCount = 0;

        const promises = examIndex.map(exam => {
            this.totalChecked++;
            return this.validateExamFile(exam);
        });

        this.validationResults = await Promise.all(promises);

        const report = this.generateReport();
        console.log('[IndexValidator] 验证完成:', report);
        
        return report;
    }

    // 生成验证报告
    generateReport() {
        const failedExams = this.validationResults.filter(result => result.status === 'error');
        
        return {
            summary: {
                total: this.totalChecked,
                success: this.successCount,
                failed: this.failureCount,
                successRate: Math.round((this.successCount / this.totalChecked) * 100)
            },
            failedExams: failedExams,
            allResults: this.validationResults
        };
    }

    // 修复索引问题的建议
    generateFixSuggestions(report) {
        const suggestions = [];

        report.failedExams.forEach(exam => {
            if (exam.message.includes('404')) {
                suggestions.push({
                    examId: exam.id,
                    title: exam.title,
                    issue: '文件不存在',
                    suggestion: `检查文件路径: ${exam.path}`,
                    action: 'verify_file_path'
                });
            } else if (exam.message.includes('网络错误')) {
                suggestions.push({
                    examId: exam.id,
                    title: exam.title,
                    issue: '网络访问问题',
                    suggestion: '检查本地服务器是否正常运行',
                    action: 'check_server'
                });
            }
        });

        return suggestions;
    }

    // 显示验证结果
    displayResults(report) {
        console.log('\n=== 题目索引验证报告 ===');
        console.log(`总计: ${report.summary.total} 个题目`);
        console.log(`成功: ${report.summary.success} 个 (${report.summary.successRate}%)`);
        console.log(`失败: ${report.summary.failed} 个`);

        if (report.failedExams.length > 0) {
            console.log('\n失败的题目:');
            report.failedExams.forEach((exam, index) => {
                console.log(`${index + 1}. ${exam.title}`);
                console.log(`   路径: ${exam.path}`);
                console.log(`   错误: ${exam.message}`);
                console.log('');
            });

            const suggestions = this.generateFixSuggestions(report);
            if (suggestions.length > 0) {
                console.log('\n修复建议:');
                suggestions.forEach((suggestion, index) => {
                    console.log(`${index + 1}. ${suggestion.title}`);
                    console.log(`   问题: ${suggestion.issue}`);
                    console.log(`   建议: ${suggestion.suggestion}`);
                    console.log('');
                });
            }
        }

        return report;
    }

    // 测试题目页面的通信功能
    async testCommunication(examId) {
        const exam = window.examIndex?.find(e => e.id === examId);
        if (!exam) {
            return {
                success: false,
                message: '题目不存在'
            };
        }

        try {
            const fullPath = exam.path + exam.filename;
            
            // 打开题目页面
            const examWindow = window.open(fullPath, `test_${examId}`, 
                'width=800,height=600,scrollbars=yes,resizable=yes');

            if (!examWindow) {
                return {
                    success: false,
                    message: '无法打开题目窗口，请检查弹窗设置'
                };
            }

            // 等待页面加载
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 发送测试消息
            const testMessage = {
                type: 'COMMUNICATION_TEST',
                data: {
                    testId: Date.now(),
                    examId: examId,
                    timestamp: Date.now()
                }
            };

            examWindow.postMessage(testMessage, '*');

            // 等待响应
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    examWindow.close();
                    resolve({
                        success: false,
                        message: '通信测试超时，页面可能不支持跨窗口通信'
                    });
                }, 5000);

                const messageHandler = (event) => {
                    if (event.data.type === 'COMMUNICATION_TEST_RESPONSE') {
                        clearTimeout(timeout);
                        window.removeEventListener('message', messageHandler);
                        examWindow.close();
                        resolve({
                            success: true,
                            message: '通信测试成功',
                            responseData: event.data
                        });
                    }
                };

                window.addEventListener('message', messageHandler);
            });

        } catch (error) {
            return {
                success: false,
                message: `通信测试失败: ${error.message}`
            };
        }
    }
}

// 导出到全局
window.IndexValidator = IndexValidator;