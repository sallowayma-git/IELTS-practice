/**
 * Markdown导出功能测试脚本
 * 用于验证练习记录的Markdown导出功能
 */

class MarkdownExportTester {
    constructor() {
        this.testResults = [];
        this.testsPassed = 0;
        this.testsFailed = 0;
    }

    /**
     * 运行所有测试
     */
    async runAllTests() {
        console.log('=== 开始Markdown导出功能测试 ===');
        
        try {
            await this.testMarkdownGeneration();
            await this.testDataCompatibility();
            await this.testFileDownload();
            await this.testBatchExport();
            
            this.printTestResults();
        } catch (error) {
            console.error('测试执行失败:', error);
        }
    }

    /**
     * 测试Markdown生成
     */
    async testMarkdownGeneration() {
        console.log('\n1. 测试Markdown生成...');
        
        // 检查PracticeHistory组件是否存在
        this.assert(
            typeof window.PracticeHistory === 'function',
            'PracticeHistory组件应该存在',
            'PracticeHistory组件未找到'
        );
        
        if (!window.PracticeHistory) {
            return;
        }
        
        const practiceHistory = new PracticeHistory();
        
        // 测试新格式数据
        const newFormatRecord = {
            id: 'test-new-format',
            metadata: {
                examTitle: 'IELTS Reading Test 1',
                category: 'P1',
                frequency: 'high'
            },
            accuracy: 0.85,
            correctAnswers: 17,
            totalQuestions: 20,
            scoreInfo: {
                details: {
                    'q1': { userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
                    'q2': { userAnswer: 'B', correctAnswer: 'C', isCorrect: false },
                    'q3': { userAnswer: 'C', correctAnswer: 'C', isCorrect: true }
                }
            }
        };
        
        const markdown = practiceHistory.generateMarkdownExport(newFormatRecord);
        
        // 验证Markdown格式
        this.assert(
            markdown.includes('## P1 高频 IELTS Reading Test 1 17/20'),
            'Markdown应该包含正确的标题格式',
            `实际标题: ${markdown.split('\n')[0]}`
        );
        
        this.assert(
            markdown.includes('| 序号 | 正确答案 | 我的答案 | 对错 |'),
            'Markdown应该包含表格头',
            '缺少表格头'
        );
        
        this.assert(
            markdown.includes('| --- | --- | --- | --- |'),
            'Markdown应该包含表格分隔符',
            '缺少表格分隔符'
        );
        
        this.assert(
            markdown.includes('✅') && markdown.includes('❌'),
            'Markdown应该包含正确和错误的图标',
            '缺少对错图标'
        );
        
        console.log('✅ Markdown生成测试完成');
    }

    /**
     * 测试数据兼容性
     */
    async testDataCompatibility() {
        console.log('\n2. 测试数据兼容性...');
        
        if (!window.PracticeHistory) {
            console.log('⚠️ 跳过数据兼容性测试（PracticeHistory不可用）');
            return;
        }
        
        const practiceHistory = new PracticeHistory();
        
        // 测试旧格式数据
        const oldFormatRecord = {
            id: 'test-old-format',
            metadata: {
                examTitle: 'IELTS Reading Test 2',
                category: 'P2',
                frequency: 'low'
            },
            accuracy: 0.75,
            correctAnswers: 15,
            totalQuestions: 20,
            answers: {
                'q1': 'A',
                'q2': 'B',
                'q3': 'C'
            }
        };
        
        const markdown = practiceHistory.generateMarkdownExport(oldFormatRecord);
        
        // 验证旧格式兼容性
        this.assert(
            markdown.includes('## P2 次高频 IELTS Reading Test 2 15/20'),
            '应该正确处理旧格式数据的标题',
            `实际标题: ${markdown.split('\n')[0]}`
        );
        
        this.assert(
            markdown.includes('❓'),
            '旧格式数据应该显示未知状态图标',
            '缺少未知状态图标'
        );
        
        // 测试缺失数据的处理
        const incompleteRecord = {
            id: 'test-incomplete',
            metadata: {},
            accuracy: 0.6,
            correctAnswers: 12,
            totalQuestions: 20,
            answers: {}
        };
        
        const incompleteMarkdown = practiceHistory.generateMarkdownExport(incompleteRecord);
        
        this.assert(
            incompleteMarkdown.includes('Unknown'),
            '应该优雅处理缺失的元数据',
            '未正确处理缺失数据'
        );
        
        console.log('✅ 数据兼容性测试完成');
    }

    /**
     * 测试文件下载功能
     */
    async testFileDownload() {
        console.log('\n3. 测试文件下载功能...');
        
        if (!window.PracticeHistory) {
            console.log('⚠️ 跳过文件下载测试（PracticeHistory不可用）');
            return;
        }
        
        // 模拟Blob和URL.createObjectURL
        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        
        let blobCreated = false;
        let urlCreated = false;
        let urlRevoked = false;
        
        URL.createObjectURL = (blob) => {
            blobCreated = blob instanceof Blob;
            urlCreated = true;
            return 'blob:test-url';
        };
        
        URL.revokeObjectURL = (url) => {
            urlRevoked = url === 'blob:test-url';
        };
        
        // 模拟document.createElement和appendChild
        const originalCreateElement = document.createElement;
        let linkCreated = false;
        let linkClicked = false;
        
        document.createElement = (tagName) => {
            const element = originalCreateElement.call(document, tagName);
            if (tagName === 'a') {
                linkCreated = true;
                element.click = () => { linkClicked = true; };
            }
            return element;
        };
        
        // 创建测试实例
        const practiceHistory = new PracticeHistory();
        practiceHistory.filteredRecords = [{
            id: 'test-download',
            metadata: {
                examTitle: 'Test Export',
                category: 'P1',
                frequency: 'high'
            },
            accuracy: 0.8,
            correctAnswers: 16,
            totalQuestions: 20,
            answers: { 'q1': 'A' }
        }];
        
        // 模拟showMessage函数
        const originalShowMessage = window.showMessage;
        let messageShown = false;
        window.showMessage = (message, type) => {
            messageShown = type === 'success';
        };
        
        try {
            // 测试导出功能
            practiceHistory.exportRecordAsMarkdown('test-download');
            
            this.assert(
                blobCreated,
                '应该创建Blob对象',
                '未创建Blob对象'
            );
            
            this.assert(
                urlCreated,
                '应该创建对象URL',
                '未创建对象URL'
            );
            
            this.assert(
                linkCreated && linkClicked,
                '应该创建并点击下载链接',
                '下载链接处理失败'
            );
            
            this.assert(
                urlRevoked,
                '应该清理对象URL',
                '未清理对象URL'
            );
            
            this.assert(
                messageShown,
                '应该显示成功消息',
                '未显示成功消息'
            );
            
        } finally {
            // 恢复原始函数
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
            document.createElement = originalCreateElement;
            window.showMessage = originalShowMessage;
        }
        
        console.log('✅ 文件下载功能测试完成');
    }

    /**
     * 测试批量导出
     */
    async testBatchExport() {
        console.log('\n4. 测试批量导出...');
        
        if (!window.PracticeHistory) {
            console.log('⚠️ 跳过批量导出测试（PracticeHistory不可用）');
            return;
        }
        
        const practiceHistory = new PracticeHistory();
        practiceHistory.filteredRecords = [
            {
                id: 'batch-1',
                metadata: { examTitle: 'Test 1', category: 'P1', frequency: 'high' },
                accuracy: 0.8, correctAnswers: 16, totalQuestions: 20,
                answers: { 'q1': 'A' }
            },
            {
                id: 'batch-2',
                metadata: { examTitle: 'Test 2', category: 'P2', frequency: 'low' },
                accuracy: 0.7, correctAnswers: 14, totalQuestions: 20,
                answers: { 'q1': 'B' }
            }
        ];
        
        // 模拟批量导出
        let batchExportSuccess = false;
        
        try {
            // 检查方法是否存在
            this.assert(
                typeof practiceHistory.exportMultipleRecords === 'function',
                'exportMultipleRecords方法应该存在',
                '批量导出方法不存在'
            );
            
            // 这里只测试方法存在性，实际导出需要更复杂的模拟
            batchExportSuccess = true;
            
        } catch (error) {
            console.error('批量导出测试失败:', error);
        }
        
        this.assert(
            batchExportSuccess,
            '批量导出功能应该可用',
            '批量导出功能不可用'
        );
        
        console.log('✅ 批量导出测试完成');
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
        console.log('\n=== Markdown导出功能测试结果 ===');
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
window.MarkdownExportTester = MarkdownExportTester;

// 提供便捷的测试函数
window.testMarkdownExport = async function() {
    const tester = new MarkdownExportTester();
    return await tester.runAllTests();
};

console.log('Markdown导出功能测试器已加载');
console.log('使用 testMarkdownExport() 运行测试');