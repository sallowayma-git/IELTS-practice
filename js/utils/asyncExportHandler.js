/**
 * 异步导出处理器
 * 负责处理导出操作而不阻塞UI
 */
class AsyncExportHandler {
    constructor() {
        this.isExporting = false;
        this.progressElement = null;
        this.abortController = null;
    }

    /**
     * 带进度的异步导出
     */
    async exportWithProgress(data, format = 'markdown', options = {}) {
        if (this.isExporting) {
            throw new Error('导出正在进行中，请稍候');
        }

        this.isExporting = true;
        this.abortController = new AbortController();

        try {
            this.showProgressIndicator();
            
            // 根据格式选择导出方法
            let result;
            switch (format.toLowerCase()) {
                case 'markdown':
                    result = await this.exportMarkdown(data, options);
                    break;
                case 'json':
                    result = await this.exportJSON(data, options);
                    break;
                case 'csv':
                    result = await this.exportCSV(data, options);
                    break;
                default:
                    throw new Error(`不支持的导出格式: ${format}`);
            }

            this.updateProgress('导出完成', 100);
            await this.sleep(500); // 让用户看到完成状态
            
            return result;

        } catch (error) {
            this.handleExportError(error);
            throw error;
        } finally {
            this.hideProgressIndicator();
            this.isExporting = false;
            this.abortController = null;
        }
    }

    /**
     * 导出Markdown格式
     */
    async exportMarkdown(records, options = {}) {
        this.updateProgress('准备导出数据...', 10);
        
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('没有可导出的数据');
        }

        let markdown = '# IELTS 练习记录导出\n\n';
        markdown += `导出时间: ${new Date().toLocaleString()}\n`;
        markdown += `记录总数: ${records.length}\n\n`;

        this.updateProgress('生成统计信息...', 20);
        await this.sleep(50);

        // 生成统计信息
        const stats = this.calculateStats(records);
        markdown += '## 统计概览\n\n';
        markdown += `- 总练习次数: ${stats.totalPractices}\n`;
        markdown += `- 平均正确率: ${stats.averageAccuracy}%\n`;
        markdown += `- 总学习时长: ${stats.totalDuration}分钟\n`;
        markdown += `- 最高正确率: ${stats.maxAccuracy}%\n`;
        markdown += `- 最低正确率: ${stats.minAccuracy}%\n\n`;

        this.updateProgress('生成详细记录...', 40);
        await this.sleep(50);

        // 生成详细记录
        markdown += '## 详细记录\n\n';
        
        const batchSize = 10; // 每批处理10条记录
        for (let i = 0; i < records.length; i += batchSize) {
            if (this.abortController.signal.aborted) {
                throw new Error('导出已取消');
            }

            const batch = records.slice(i, i + batchSize);
            const batchMarkdown = await this.processBatch(batch, i);
            markdown += batchMarkdown;

            const progress = 40 + (i / records.length) * 50;
            this.updateProgress(`处理记录 ${i + 1}-${Math.min(i + batchSize, records.length)}...`, progress);
            
            // 让出控制权，避免阻塞UI
            await this.sleep(10);
        }

        this.updateProgress('生成文件...', 95);
        await this.sleep(50);

        // 下载文件
        const filename = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.md`;
        this.downloadFile(markdown, filename, 'text/markdown');

        return {
            success: true,
            filename,
            recordCount: records.length,
            fileSize: new Blob([markdown]).size
        };
    }

    /**
     * 处理记录批次
     */
    async processBatch(records, startIndex) {
        let markdown = '';
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const recordNumber = startIndex + i + 1;
            
            markdown += `### ${recordNumber}. ${record.title || record.examId}\n\n`;
            markdown += `- **练习时间**: ${new Date(record.startTime).toLocaleString()}\n`;
            markdown += `- **分类**: ${record.category || '未分类'}\n`;
            markdown += `- **正确率**: ${Math.round((record.accuracy || 0) * 100)}%\n`;
            markdown += `- **用时**: ${Math.round((record.duration || 0) / 60)}分钟\n`;
            
            if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
                markdown += '\n**答题详情**:\n\n';
                markdown += '| 题号 | 你的答案 | 正确答案 | 结果 |\n';
                markdown += '|------|----------|----------|------|\n';
                
                Object.entries(record.answerComparison).forEach(([questionId, comparison]) => {
                    const userAnswer = comparison.userAnswer || 'N/A';
                    const correctAnswer = comparison.correctAnswer || 'N/A';
                    const result = comparison.isCorrect ? '✅' : '❌';
                    markdown += `| ${questionId} | ${userAnswer} | ${correctAnswer} | ${result} |\n`;
                });
            }
            
            markdown += '\n---\n\n';
        }
        
        return markdown;
    }

    /**
     * 导出JSON格式
     */
    async exportJSON(records, options = {}) {
        this.updateProgress('准备JSON数据...', 20);
        await this.sleep(50);

        const exportData = {
            exportTime: new Date().toISOString(),
            version: '1.0',
            recordCount: records.length,
            records: records
        };

        this.updateProgress('生成JSON文件...', 80);
        await this.sleep(50);

        const jsonString = JSON.stringify(exportData, null, 2);
        const filename = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.json`;
        
        this.downloadFile(jsonString, filename, 'application/json');

        return {
            success: true,
            filename,
            recordCount: records.length,
            fileSize: new Blob([jsonString]).size
        };
    }

    /**
     * 导出CSV格式
     */
    async exportCSV(records, options = {}) {
        this.updateProgress('准备CSV数据...', 20);
        await this.sleep(50);

        const headers = ['序号', '标题', '分类', '练习时间', '正确率', '用时(分钟)', '总题数', '正确题数'];
        let csv = headers.join(',') + '\n';

        this.updateProgress('生成CSV内容...', 40);
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const row = [
                i + 1,
                `"${(record.title || record.examId || '').replace(/"/g, '""')}"`,
                `"${(record.category || '').replace(/"/g, '""')}"`,
                `"${new Date(record.startTime).toLocaleString()}"`,
                `${Math.round((record.accuracy || 0) * 100)}%`,
                Math.round((record.duration || 0) / 60),
                record.totalQuestions || 0,
                record.score || 0
            ];
            csv += row.join(',') + '\n';

            if (i % 50 === 0) {
                const progress = 40 + (i / records.length) * 40;
                this.updateProgress(`处理记录 ${i + 1}/${records.length}...`, progress);
                await this.sleep(10);
            }
        }

        this.updateProgress('生成CSV文件...', 90);
        await this.sleep(50);

        const filename = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.csv`;
        this.downloadFile(csv, filename, 'text/csv');

        return {
            success: true,
            filename,
            recordCount: records.length,
            fileSize: new Blob([csv]).size
        };
    }

    /**
     * 计算统计信息
     */
    calculateStats(records) {
        if (records.length === 0) {
            return {
                totalPractices: 0,
                averageAccuracy: 0,
                totalDuration: 0,
                maxAccuracy: 0,
                minAccuracy: 0
            };
        }

        const accuracies = records.map(r => (r.accuracy || 0) * 100);
        const durations = records.map(r => (r.duration || 0) / 60);

        return {
            totalPractices: records.length,
            averageAccuracy: Math.round(accuracies.reduce((a, b) => a + b, 0) / records.length),
            totalDuration: Math.round(durations.reduce((a, b) => a + b, 0)),
            maxAccuracy: Math.round(Math.max(...accuracies)),
            minAccuracy: Math.round(Math.min(...accuracies))
        };
    }

    /**
     * 显示进度指示器
     */
    showProgressIndicator() {
        // 移除现有的进度指示器
        this.hideProgressIndicator();

        // 创建进度指示器
        this.progressElement = document.createElement('div');
        this.progressElement.id = 'export-progress-indicator';
        this.progressElement.innerHTML = `
            <div style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                font-family: Arial, sans-serif;
            ">
                <div style="
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    text-align: center;
                    min-width: 300px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
                ">
                    <div style="margin-bottom: 20px; font-size: 18px; font-weight: bold;">
                        正在导出数据...
                    </div>
                    <div style="
                        width: 100%;
                        height: 20px;
                        background: #f0f0f0;
                        border-radius: 10px;
                        overflow: hidden;
                        margin-bottom: 15px;
                    ">
                        <div id="export-progress-bar" style="
                            height: 100%;
                            background: linear-gradient(90deg, #4CAF50, #45a049);
                            width: 0%;
                            transition: width 0.3s ease;
                        "></div>
                    </div>
                    <div id="export-progress-text" style="
                        color: #666;
                        font-size: 14px;
                    ">
                        准备中...
                    </div>
                    <button onclick="window.asyncExportHandler?.cancelExport()" style="
                        margin-top: 15px;
                        padding: 8px 16px;
                        background: #f44336;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    ">
                        取消导出
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.progressElement);
        
        // 设置全局引用以便取消按钮使用
        window.asyncExportHandler = this;
    }

    /**
     * 更新进度
     */
    updateProgress(text, percentage) {
        if (!this.progressElement) return;

        const progressBar = this.progressElement.querySelector('#export-progress-bar');
        const progressText = this.progressElement.querySelector('#export-progress-text');

        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
        }

        if (progressText) {
            progressText.textContent = text;
        }
    }

    /**
     * 隐藏进度指示器
     */
    hideProgressIndicator() {
        if (this.progressElement) {
            this.progressElement.remove();
            this.progressElement = null;
        }
        
        // 清理全局引用
        if (window.asyncExportHandler === this) {
            delete window.asyncExportHandler;
        }
    }

    /**
     * 取消导出
     */
    cancelExport() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.hideProgressIndicator();
        this.isExporting = false;
    }

    /**
     * 处理导出错误
     */
    handleExportError(error) {
        console.error('[AsyncExportHandler] 导出失败:', error);
        
        // 显示错误信息
        if (this.progressElement) {
            const progressText = this.progressElement.querySelector('#export-progress-text');
            if (progressText) {
                progressText.textContent = `导出失败: ${error.message}`;
                progressText.style.color = '#f44336';
            }
        }
        
        // 3秒后自动隐藏
        setTimeout(() => {
            this.hideProgressIndicator();
        }, 3000);
    }

    /**
     * 下载文件
     */
    downloadFile(content, filename, mimeType) {
        try {
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // 清理URL对象
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            
        } catch (error) {
            console.error('[AsyncExportHandler] 文件下载失败:', error);
            throw new Error('文件下载失败，请检查浏览器设置');
        }
    }

    /**
     * 异步睡眠
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 确保全局可用
window.AsyncExportHandler = AsyncExportHandler;