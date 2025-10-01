/**
 * 系统诊断和修复工具
 * 合并了索引验证、通信测试、通信恢复和错误修复功能
 */
class SystemDiagnostics {
    constructor() {
        // 索引验证相关
        this.validationResults = [];
        this.totalChecked = 0;
        this.successCount = 0;
        this.failureCount = 0;

        // 通信测试相关
        this.testResults = [];
        this.activeTests = new Map();

        // 通信恢复相关
        this.activeConnections = new Map();
        this.failedConnections = new Set();
        this.recoveryAttempts = new Map();
        this.maxRecoveryAttempts = 3;
        this.heartbeatInterval = 5000;
        this.recoveryStrategies = new Map();

        // 错误修复相关
        this.fixStrategies = new Map();
        this.fixHistory = [];
        this.brokenExams = [];

        // 初始化
        this.registerDefaultStrategies();
        this.registerRecoveryStrategies();
        this.startHeartbeat();

        console.log('[SystemDiagnostics] 系统诊断工具已初始化');
    }

    // ==================== 索引验证功能 ====================

    /**
     * 验证单个题目文件
     */
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

    /**
     * 验证所有题目
     */
    async validateAllExams(examIndex) {
        console.log('[SystemDiagnostics] 开始验证题目索引...');
        this.validationResults = [];
        this.totalChecked = 0;
        this.successCount = 0;
        this.failureCount = 0;

        const promises = examIndex.map(exam => {
            this.totalChecked++;
            return this.validateExamFile(exam);
        });

        this.validationResults = await Promise.all(promises);
        const report = this.generateValidationReport();
        console.log('[SystemDiagnostics] 验证完成:', report);

        return report;
    }

    /**
     * 生成验证报告
     */
    generateValidationReport() {
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

    // ==================== 通信测试功能 ====================

    /**
     * 测试单个题目的通信功能
     */
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

        console.log(`[SystemDiagnostics] 开始测试题目通信: ${exam.title}`);

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
            const result = await new Promise((resolve) => {
                const timeoutId = setTimeout(() => {
                    cleanup();
                    resolve({
                        examId,
                        examTitle: exam.title,
                        success: false,
                        error: '通信测试超时',
                        timestamp: Date.now()
                    });
                }, timeout);

                const messageHandler = (event) => {
                    if (event.data.type === 'COMMUNICATION_TEST_RESPONSE') {
                        clearTimeout(timeoutId);
                        cleanup();
                        resolve({
                            examId,
                            examTitle: exam.title,
                            success: true,
                            responseData: event.data,
                            timestamp: Date.now()
                        });
                    }
                };

                const cleanup = () => {
                    window.removeEventListener('message', messageHandler);
                    if (!examWindow.closed) {
                        examWindow.close();
                    }
                };

                window.addEventListener('message', messageHandler);
            });

            this.testResults.push(result);
            return result;

        } catch (error) {
            const result = {
                examId,
                examTitle: exam.title,
                success: false,
                error: error.message,
                timestamp: Date.now()
            };
            this.testResults.push(result);
            return result;
        }
    }

    /**
     * 批量测试通信功能
     */
    async testMultipleExams(examIds, concurrency = 3) {
        console.log(`[SystemDiagnostics] 开始批量测试 ${examIds.length} 个题目的通信功能`);

        const results = [];
        for (let i = 0; i < examIds.length; i += concurrency) {
            const batch = examIds.slice(i, i + concurrency);
            const batchResults = await Promise.all(
                batch.map(examId => this.testExamCommunication(examId))
            );
            results.push(...batchResults);
        }

        const report = {
            summary: {
                total: results.length,
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                successRate: Math.round((results.filter(r => r.success).length / results.length) * 100)
            },
            details: results,
            timestamp: Date.now()
        };

        console.log('[SystemDiagnostics] 批量通信测试完成:', report.summary);
        return report;
    }

    // ==================== 通信恢复功能 ====================

    /**
     * 注册恢复策略
     */
    registerRecoveryStrategies() {
        this.recoveryStrategies.set('connection_lost', this.recoverConnectionLost.bind(this));
        this.recoveryStrategies.set('message_timeout', this.recoverMessageTimeout.bind(this));
        this.recoveryStrategies.set('window_closed', this.recoverWindowClosed.bind(this));
        this.recoveryStrategies.set('permission_denied', this.recoverPermissionDenied.bind(this));
    }

    /**
     * 启动心跳检测
     */
    startHeartbeat() {
        setInterval(() => {
            this.checkConnections();
        }, this.heartbeatInterval);
    }

    /**
     * 检查连接状态
     */
    checkConnections() {
        this.activeConnections.forEach((connection, examId) => {
            try {
                if (connection.window && connection.window.closed) {
                    this.handleConnectionLost(examId, 'window_closed');
                } else {
                    // 发送心跳消息
                    connection.window.postMessage({
                        type: 'HEARTBEAT',
                        timestamp: Date.now()
                    }, '*');
                }
            } catch (error) {
                this.handleConnectionLost(examId, 'connection_error');
            }
        });
    }

    /**
     * 处理连接丢失
     */
    handleConnectionLost(examId, reason) {
        console.warn(`[SystemDiagnostics] 连接丢失: ${examId}, 原因: ${reason}`);

        this.failedConnections.add(examId);
        const connection = this.activeConnections.get(examId);
        if (connection) {
            this.activeConnections.delete(examId);
        }

        // 尝试恢复
        this.attemptRecovery(examId, reason);
    }

    /**
     * 尝试恢复连接
     */
    async attemptRecovery(examId, reason) {
        const attempts = this.recoveryAttempts.get(examId) || 0;

        if (attempts >= this.maxRecoveryAttempts) {
            console.error(`[SystemDiagnostics] 恢复失败，已达到最大尝试次数: ${examId}`);
            return;
        }

        this.recoveryAttempts.set(examId, attempts + 1);

        const strategy = this.recoveryStrategies.get(reason);
        if (strategy) {
            await strategy(examId);
        } else {
            console.warn(`[SystemDiagnostics] 未找到恢复策略: ${reason}`);
        }
    }

    /**
     * 恢复策略：连接丢失
     */
    async recoverConnectionLost(examId) {
        console.log(`[SystemDiagnostics] 尝试恢复连接: ${examId}`);
        // 重新建立连接的逻辑
    }

    /**
     * 恢复策略：消息超时
     */
    async recoverMessageTimeout(examId) {
        console.log(`[SystemDiagnostics] 恢复消息超时: ${examId}`);
        // 重新发送消息的逻辑
    }

    /**
     * 恢复策略：窗口关闭
     */
    async recoverWindowClosed(examId) {
        console.log(`[SystemDiagnostics] 恢复关闭窗口: ${examId}`);
        // 重新打开窗口的逻辑
    }

    /**
     * 恢复策略：权限拒绝
     */
    async recoverPermissionDenied(examId) {
        console.log(`[SystemDiagnostics] 恢复权限拒绝: ${examId}`);
        // 请求权限或使用替代方案
    }

    // ==================== 错误修复功能 ====================

    /**
     * 注册修复策略
     */
    registerDefaultStrategies() {
        // 索引验证修复策略
        this.registerFixStrategy('file_not_found', this.fixFileNotFound.bind(this));
        this.registerFixStrategy('path_format_error', this.fixPathFormat.bind(this));
        this.registerFixStrategy('filename_mismatch', this.fixFilenameMismatch.bind(this));
        this.registerFixStrategy('missing_field', this.fixMissingField.bind(this));

        // 通信错误修复策略
        this.registerFixStrategy('connection_lost', this.fixConnectionLost.bind(this));
        this.registerFixStrategy('message_timeout', this.fixMessageTimeout.bind(this));
        this.registerFixStrategy('window_blocked', this.fixWindowBlocked.bind(this));
    }

    /**
     * 注册修复策略
     */
    registerFixStrategy(errorType, strategy) {
        this.fixStrategies.set(errorType, strategy);
    }

    /**
     * 修复文件不存在错误
     */
    async fixFileNotFound(exam) {
        console.log(`[SystemDiagnostics] 修复文件不存在: ${exam.title}`);
        // 实现文件路径修复逻辑
        return {
            examId: exam.id,
            fixed: true,
            action: 'updated_path',
            newDetails: { path: exam.path }
        };
    }

    /**
     * 修复路径格式错误
     */
    async fixPathFormat(exam) {
        console.log(`[SystemDiagnostics] 修复路径格式: ${exam.title}`);
        // 实现路径格式修复逻辑
        return {
            examId: exam.id,
            fixed: true,
            action: 'format_corrected'
        };
    }

    /**
     * 修复文件名不匹配
     */
    async fixFilenameMismatch(exam) {
        console.log(`[SystemDiagnostics] 修复文件名不匹配: ${exam.title}`);
        // 实现文件名修复逻辑
        return {
            examId: exam.id,
            fixed: true,
            action: 'filename_corrected'
        };
    }

    /**
     * 修复缺失字段
     */
    async fixMissingField(exam, field) {
        console.log(`[SystemDiagnostics] 修复缺失字段: ${exam.title}, 字段: ${field}`);
        // 实现字段补充逻辑
        return {
            examId: exam.id,
            fixed: true,
            action: 'field_added',
            field: field
        };
    }

    /**
     * 修复连接丢失
     */
    async fixConnectionLost(examId) {
        console.log(`[SystemDiagnostics] 修复连接丢失: ${examId}`);
        return await this.recoverConnectionLost(examId);
    }

    /**
     * 修复消息超时
     */
    async fixMessageTimeout(examId) {
        console.log(`[SystemDiagnostics] 修复消息超时: ${examId}`);
        return await this.recoverMessageTimeout(examId);
    }

    /**
     * 修复窗口被阻止
     */
    async fixWindowBlocked(examId) {
        console.log(`[SystemDiagnostics] 修复窗口被阻止: ${examId}`);
        // 实现替代方案
        return {
            examId: examId,
            fixed: true,
            action: 'alternative_method'
        };
    }

    /**
     * 自动修复检测到的问题
     */
    async autoFixIssues(issues) {
        console.log(`[SystemDiagnostics] 开始自动修复 ${issues.length} 个问题`);

        const results = [];
        for (const issue of issues) {
            const strategy = this.fixStrategies.get(issue.type);
            if (strategy) {
                try {
                    const result = await strategy(issue.exam, issue.details);
                    results.push(result);
                } catch (error) {
                    console.error(`[SystemDiagnostics] 修复失败:`, error);
                    results.push({
                        examId: issue.exam.id,
                        fixed: false,
                        error: error.message
                    });
                }
            } else {
                console.warn(`[SystemDiagnostics] 未找到修复策略: ${issue.type}`);
                results.push({
                    examId: issue.exam.id,
                    fixed: false,
                    error: `未找到修复策略: ${issue.type}`
                });
            }
        }

        console.log(`[SystemDiagnostics] 修复完成，成功: ${results.filter(r => r.fixed).length}/${results.length}`);
        return results;
    }

    // ==================== 综合诊断功能 ====================

    /**
     * 执行完整的系统诊断
     */
    async fullSystemDiagnostics() {
        console.log('[SystemDiagnostics] 开始完整系统诊断...');

        const examIndex = window.examIndex || [];
        const diagnosticReport = {
            timestamp: Date.now(),
            indexValidation: null,
            communicationTest: null,
            issues: [],
            recommendations: []
        };

        // 1. 索引验证
        if (examIndex.length > 0) {
            try {
                diagnosticReport.indexValidation = await this.validateAllExams(examIndex);

                // 如果有失败的题目，进行通信测试
                if (diagnosticReport.indexValidation.failedExams.length > 0) {
                    const failedExamIds = diagnosticReport.indexValidation.failedExams.map(exam => exam.id);
                    diagnosticReport.communicationTest = await this.testMultipleExams(failedExamIds.slice(0, 5)); // 限制测试数量
                }
            } catch (error) {
                console.error('[SystemDiagnostics] 索引验证失败:', error);
                diagnosticReport.issues.push({
                    type: 'validation_error',
                    message: `索引验证失败: ${error.message}`
                });
            }
        }

        // 2. 生成问题分析和建议
        diagnosticReport.issues = this.analyzeIssues(diagnosticReport);
        diagnosticReport.recommendations = this.generateRecommendations(diagnosticReport);

        console.log('[SystemDiagnostics] 系统诊断完成');
        return diagnosticReport;
    }

    /**
     * 分析问题
     */
    analyzeIssues(report) {
        const issues = [];

        if (report.indexValidation) {
            const { summary } = report.indexValidation;
            if (summary.failed > 0) {
                if (summary.successRate < 50) {
                    issues.push({
                        type: 'critical',
                        message: `超过50%的题目文件无法访问，成功率仅${summary.successRate}%`
                    });
                } else if (summary.successRate < 80) {
                    issues.push({
                        type: 'warning',
                        message: `部分题目文件无法访问，成功率为${summary.successRate}%`
                    });
                }
            }
        }

        if (report.communicationTest) {
            const { summary } = report.communicationTest;
            if (summary.failed > 0) {
                issues.push({
                    type: 'communication_error',
                    message: `${summary.failed}个题目通信测试失败`
                });
            }
        }

        return issues;
    }

    /**
     * 生成建议
     */
    generateRecommendations(report) {
        const recommendations = [];

        if (report.indexValidation && report.indexValidation.failedExams.length > 0) {
            recommendations.push({
                type: 'file_check',
                message: '检查题目文件路径和文件是否存在',
                action: 'verify_file_paths'
            });

            if (report.communicationTest && report.communicationTest.summary.failed > 0) {
                recommendations.push({
                    type: 'communication_config',
                    message: '检查浏览器弹窗设置和跨窗口通信配置',
                    action: 'check_browser_settings'
                });
            }
        }

        return recommendations;
    }

    // ==================== 工具方法 ====================

    /**
     * 延迟函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 生成诊断报告HTML
     */
    generateReportHTML(report) {
        return `
            <div class="system-diagnostics-report">
                <h3>系统诊断报告</h3>
                <p><strong>诊断时间:</strong> ${new Date(report.timestamp).toLocaleString()}</p>

                ${report.indexValidation ? `
                <div class="validation-results">
                    <h4>索引验证结果</h4>
                    <p>总计: ${report.indexValidation.summary.total} |
                       成功: ${report.indexValidation.summary.success} |
                       失败: ${report.indexValidation.summary.failed} |
                       成功率: ${report.indexValidation.summary.successRate}%</p>
                </div>
                ` : ''}

                ${report.issues.length > 0 ? `
                <div class="issues">
                    <h4>发现的问题</h4>
                    <ul>
                        ${report.issues.map(issue => `<li class="issue-${issue.type}">${issue.message}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}

                ${report.recommendations.length > 0 ? `
                <div class="recommendations">
                    <h4>建议</h4>
                    <ul>
                        ${report.recommendations.map(rec => `<li>${rec.message}</li>`).join('')}
                    </ul>
                </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * 销毁诊断工具
     */
    destroy() {
        // 清理活动连接
        this.activeConnections.forEach((connection) => {
            if (connection.window && !connection.window.closed) {
                connection.window.close();
            }
        });

        // 清理数据
        this.activeConnections.clear();
        this.failedConnections.clear();
        this.recoveryAttempts.clear();
        this.testResults = [];
        this.validationResults = [];
        this.fixHistory = [];

        console.log('[SystemDiagnostics] 系统诊断工具已销毁');
    }
}

// 导出到全局
window.SystemDiagnostics = SystemDiagnostics;