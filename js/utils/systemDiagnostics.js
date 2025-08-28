/**
 * 系统诊断和维护工具
 * 负责题库完整性检查、性能监控和错误日志收集分析
 */
class SystemDiagnostics {
    constructor() {
        this.diagnosticResults = [];
        this.performanceMetrics = [];
        this.errorLogs = [];
        this.maintenanceTasks = [];
        
        this.initialize();
    }

    /**
     * 初始化诊断系统
     */
    initialize() {
        console.log('SystemDiagnostics initialized');
        
        // 设置错误监听
        this.setupErrorLogging();
        
        // 设置性能监控
        this.setupPerformanceMonitoring();
        
        // 加载历史数据
        this.loadHistoricalData();
        
        // 设置定期诊断
        this.setupPeriodicDiagnostics();
    }

    /**
     * 题库完整性检查
     */
    async checkExamIntegrity() {
        const results = {
            timestamp: new Date().toISOString(),
            type: 'exam_integrity',
            status: 'running',
            issues: [],
            warnings: [],
            summary: {}
        };

        try {
            console.log('Starting exam integrity check...');

            // 检查题库索引
            const indexCheck = await this.checkExamIndex();
            results.issues.push(...indexCheck.issues);
            results.warnings.push(...indexCheck.warnings);

            // 检查文件完整性
            const fileCheck = await this.checkExamFiles();
            results.issues.push(...fileCheck.issues);
            results.warnings.push(...fileCheck.warnings);

            // 检查数据一致性
            const dataCheck = await this.checkDataConsistency();
            results.issues.push(...dataCheck.issues);
            results.warnings.push(...dataCheck.warnings);

            // 检查存储完整性
            const storageCheck = await this.checkStorageIntegrity();
            results.issues.push(...storageCheck.issues);
            results.warnings.push(...storageCheck.warnings);

            // 生成摘要
            results.summary = {
                totalExams: indexCheck.totalExams || 0,
                validExams: indexCheck.validExams || 0,
                missingFiles: fileCheck.missingFiles || 0,
                corruptedFiles: fileCheck.corruptedFiles || 0,
                dataInconsistencies: dataCheck.inconsistencies || 0,
                storageIssues: storageCheck.issues.length || 0
            };

            results.status = results.issues.length > 0 ? 'failed' : 'passed';
            
            console.log('Exam integrity check completed:', results.status);

        } catch (error) {
            results.status = 'error';
            results.issues.push({
                type: 'system_error',
                severity: 'critical',
                message: `诊断过程出错: ${error.message}`,
                timestamp: new Date().toISOString()
            });
        }

        this.diagnosticResults.push(results);
        this.saveDiagnosticResults();
        
        return results;
    }

    /**
     * 检查题库索引
     */
    async checkExamIndex() {
        const issues = [];
        const warnings = [];
        let totalExams = 0;
        let validExams = 0;

        try {
            // 获取题库索引
            const examIndex = storage.get('exam_index', []);
            totalExams = examIndex.length;

            if (examIndex.length === 0) {
                issues.push({
                    type: 'missing_index',
                    severity: 'critical',
                    message: '题库索引为空或不存在',
                    suggestion: '请重新扫描题库'
                });
                return { issues, warnings, totalExams, validExams };
            }

            // 验证每个题目条目
            examIndex.forEach((exam, index) => {
                const examIssues = this.validateExamEntry(exam, index);
                
                if (examIssues.length === 0) {
                    validExams++;
                } else {
                    issues.push(...examIssues);
                }
            });

            // 检查重复ID
            const ids = examIndex.map(exam => exam.id).filter(Boolean);
            const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
            
            if (duplicateIds.length > 0) {
                issues.push({
                    type: 'duplicate_ids',
                    severity: 'high',
                    message: `发现重复的题目ID: ${duplicateIds.join(', ')}`,
                    suggestion: '重新生成题库索引以修复重复ID'
                });
            }

        } catch (error) {
            issues.push({
                type: 'index_error',
                severity: 'critical',
                message: `题库索引检查失败: ${error.message}`
            });
        }

        return { issues, warnings, totalExams, validExams };
    }

    /**
     * 验证题目条目
     */
    validateExamEntry(exam, index) {
        const issues = [];
        const requiredFields = ['id', 'title', 'category', 'path', 'filename'];

        // 检查必需字段
        requiredFields.forEach(field => {
            if (!exam[field]) {
                issues.push({
                    type: 'missing_field',
                    severity: 'high',
                    message: `题目 ${index + 1} 缺少必需字段: ${field}`,
                    examId: exam.id || `index_${index}`
                });
            }
        });

        // 检查路径格式
        if (exam.path && !exam.path.includes('/')) {
            issues.push({
                type: 'invalid_path',
                severity: 'medium',
                message: `题目 ${exam.title || index + 1} 路径格式可能不正确: ${exam.path}`,
                examId: exam.id
            });
        }

        // 检查分类有效性
        const validCategories = ['P1', 'P2', 'P3'];
        if (exam.category && !validCategories.includes(exam.category)) {
            issues.push({
                type: 'invalid_category',
                severity: 'medium',
                message: `题目 ${exam.title || index + 1} 分类无效: ${exam.category}`,
                examId: exam.id
            });
        }

        return issues;
    }

    /**
     * 检查题目文件
     */
    async checkExamFiles() {
        const issues = [];
        const warnings = [];
        let missingFiles = 0;
        let corruptedFiles = 0;

        try {
            const examIndex = storage.get('exam_index', []);
            
            // 模拟文件检查（在实际环境中需要实际的文件系统访问）
            for (const exam of examIndex) {
                if (!exam.path || !exam.filename) continue;

                const fullPath = `${exam.path}/${exam.filename}`;
                
                // 这里应该检查实际文件是否存在
                // 由于浏览器环境限制，我们只能检查路径格式
                if (!this.isValidFilePath(fullPath)) {
                    issues.push({
                        type: 'invalid_file_path',
                        severity: 'high',
                        message: `题目文件路径格式无效: ${fullPath}`,
                        examId: exam.id,
                        suggestion: '检查文件路径格式是否正确'
                    });
                    missingFiles++;
                }
            }

        } catch (error) {
            issues.push({
                type: 'file_check_error',
                severity: 'critical',
                message: `文件检查失败: ${error.message}`
            });
        }

        return { issues, warnings, missingFiles, corruptedFiles };
    }

    /**
     * 检查数据一致性
     */
    async checkDataConsistency() {
        const issues = [];
        const warnings = [];
        let inconsistencies = 0;

        try {
            // 检查练习记录与题库索引的一致性
            const practiceRecords = storage.get('practice_records', []);
            const examIndex = storage.get('exam_index', []);
            const examIds = new Set(examIndex.map(exam => exam.id));

            // 检查练习记录中的题目ID是否存在于索引中
            practiceRecords.forEach((record, index) => {
                if (record.examId && !examIds.has(record.examId)) {
                    issues.push({
                        type: 'orphaned_record',
                        severity: 'medium',
                        message: `练习记录 ${record.id || index + 1} 引用了不存在的题目: ${record.examId}`,
                        suggestion: '清理无效的练习记录或重新扫描题库'
                    });
                    inconsistencies++;
                }
            });

            // 检查用户统计数据一致性
            const userStats = storage.get('user_stats', {});
            if (userStats.totalPractices !== practiceRecords.length) {
                warnings.push({
                    type: 'stats_mismatch',
                    severity: 'low',
                    message: `用户统计中的练习次数 (${userStats.totalPractices}) 与实际记录数 (${practiceRecords.length}) 不匹配`,
                    suggestion: '重新计算用户统计数据'
                });
            }

            // 检查分类统计一致性
            if (userStats.categoryStats) {
                Object.entries(userStats.categoryStats).forEach(([category, stats]) => {
                    const categoryRecords = practiceRecords.filter(r => 
                        r.metadata && r.metadata.category === category
                    );
                    
                    if (stats.practices !== categoryRecords.length) {
                        warnings.push({
                            type: 'category_stats_mismatch',
                            severity: 'low',
                            message: `分类 ${category} 统计数据不一致`,
                            suggestion: '重新计算分类统计数据'
                        });
                    }
                });
            }

        } catch (error) {
            issues.push({
                type: 'consistency_check_error',
                severity: 'critical',
                message: `数据一致性检查失败: ${error.message}`
            });
        }

        return { issues, warnings, inconsistencies };
    }

    /**
     * 检查存储完整性
     */
    async checkStorageIntegrity() {
        const issues = [];
        const warnings = [];

        try {
            // 检查存储可用性
            const storageInfo = storage.getStorageInfo();
            
            if (!storageInfo) {
                issues.push({
                    type: 'storage_unavailable',
                    severity: 'critical',
                    message: '无法获取存储信息',
                    suggestion: '检查浏览器存储设置'
                });
                return { issues, warnings };
            }

            // 检查存储空间
            if (storageInfo.type === 'localStorage') {
                const usagePercent = (storageInfo.used / (5 * 1024 * 1024)) * 100;
                
                if (usagePercent > 90) {
                    issues.push({
                        type: 'storage_full',
                        severity: 'high',
                        message: `存储空间使用率过高: ${usagePercent.toFixed(1)}%`,
                        suggestion: '清理旧数据或导出数据后重置'
                    });
                } else if (usagePercent > 75) {
                    warnings.push({
                        type: 'storage_warning',
                        severity: 'medium',
                        message: `存储空间使用率较高: ${usagePercent.toFixed(1)}%`,
                        suggestion: '考虑清理不必要的数据'
                    });
                }
            }

            // 检查关键数据完整性
            const criticalKeys = ['exam_index', 'practice_records', 'user_stats'];
            criticalKeys.forEach(key => {
                try {
                    const data = storage.get(key);
                    if (data === null) {
                        warnings.push({
                            type: 'missing_data',
                            severity: 'medium',
                            message: `关键数据缺失: ${key}`,
                            suggestion: '重新初始化或导入数据'
                        });
                    }
                } catch (error) {
                    issues.push({
                        type: 'data_corruption',
                        severity: 'high',
                        message: `数据读取失败: ${key} - ${error.message}`,
                        suggestion: '数据可能已损坏，考虑从备份恢复'
                    });
                }
            });

        } catch (error) {
            issues.push({
                type: 'storage_check_error',
                severity: 'critical',
                message: `存储检查失败: ${error.message}`
            });
        }

        return { issues, warnings };
    }

    /**
     * 性能监控
     */
    startPerformanceMonitoring() {
        const metrics = {
            timestamp: new Date().toISOString(),
            type: 'performance',
            data: {}
        };

        try {
            // 内存使用情况
            if (performance.memory) {
                metrics.data.memory = {
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                    limit: performance.memory.jsHeapSizeLimit
                };
            }

            // 页面加载性能
            if (performance.timing) {
                const timing = performance.timing;
                metrics.data.pageLoad = {
                    domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
                    loadComplete: timing.loadEventEnd - timing.navigationStart,
                    domReady: timing.domComplete - timing.navigationStart
                };
            }

            // 存储操作性能
            metrics.data.storage = this.measureStoragePerformance();

            // 题库操作性能
            metrics.data.examOperations = this.measureExamOperationPerformance();

            this.performanceMetrics.push(metrics);
            this.savePerformanceMetrics();

        } catch (error) {
            console.error('Performance monitoring failed:', error);
        }

        return metrics;
    }

    /**
     * 测量存储性能
     */
    measureStoragePerformance() {
        const testData = { test: 'performance_test', timestamp: Date.now() };
        const iterations = 100;
        
        // 写入性能测试
        const writeStart = performance.now();
        for (let i = 0; i < iterations; i++) {
            storage.set(`perf_test_${i}`, testData);
        }
        const writeTime = performance.now() - writeStart;

        // 读取性能测试
        const readStart = performance.now();
        for (let i = 0; i < iterations; i++) {
            storage.get(`perf_test_${i}`);
        }
        const readTime = performance.now() - readStart;

        // 清理测试数据
        for (let i = 0; i < iterations; i++) {
            storage.remove(`perf_test_${i}`);
        }

        return {
            writeTime: writeTime / iterations,
            readTime: readTime / iterations,
            totalOperations: iterations * 2
        };
    }

    /**
     * 测量题库操作性能
     */
    measureExamOperationPerformance() {
        const examIndex = storage.get('exam_index', []);
        
        if (examIndex.length === 0) {
            return { message: 'No exam data available for performance testing' };
        }

        // 搜索性能测试
        const searchStart = performance.now();
        const searchResults = examIndex.filter(exam => 
            exam.category === 'P1' && exam.frequency === 'high'
        );
        const searchTime = performance.now() - searchStart;

        // 数据处理性能测试
        const processStart = performance.now();
        const processedData = examIndex.map(exam => ({
            id: exam.id,
            title: exam.title,
            category: exam.category,
            displayName: `${exam.category} - ${exam.title}`
        }));
        const processTime = performance.now() - processStart;

        return {
            searchTime,
            processTime,
            examCount: examIndex.length,
            searchResults: searchResults.length
        };
    }

    /**
     * 错误日志收集
     */
    setupErrorLogging() {
        // 全局错误监听
        window.addEventListener('error', (event) => {
            this.logError({
                type: 'javascript_error',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error ? event.error.stack : null,
                timestamp: new Date().toISOString()
            });
        });

        // Promise 拒绝监听
        window.addEventListener('unhandledrejection', (event) => {
            this.logError({
                type: 'unhandled_promise_rejection',
                message: event.reason ? event.reason.toString() : 'Unknown promise rejection',
                stack: event.reason ? event.reason.stack : null,
                timestamp: new Date().toISOString()
            });
        });

        // 自定义错误日志方法
        window.logSystemError = (error, context = '') => {
            this.logError({
                type: 'system_error',
                message: error.message || error.toString(),
                context: context,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        };
    }

    /**
     * 记录错误
     */
    logError(errorInfo) {
        this.errorLogs.push(errorInfo);
        
        // 保持最近1000条错误日志
        if (this.errorLogs.length > 1000) {
            this.errorLogs.splice(0, this.errorLogs.length - 1000);
        }

        this.saveErrorLogs();
        console.error('System error logged:', errorInfo);
    }

    /**
     * 分析错误模式
     */
    analyzeErrorPatterns() {
        const analysis = {
            timestamp: new Date().toISOString(),
            totalErrors: this.errorLogs.length,
            errorTypes: {},
            frequentErrors: [],
            recentTrends: {},
            recommendations: []
        };

        try {
            // 按类型分组错误
            this.errorLogs.forEach(error => {
                const type = error.type || 'unknown';
                if (!analysis.errorTypes[type]) {
                    analysis.errorTypes[type] = 0;
                }
                analysis.errorTypes[type]++;
            });

            // 找出最频繁的错误
            const sortedTypes = Object.entries(analysis.errorTypes)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5);

            analysis.frequentErrors = sortedTypes.map(([type, count]) => ({
                type,
                count,
                percentage: (count / this.errorLogs.length * 100).toFixed(1)
            }));

            // 分析最近24小时的错误趋势
            const last24Hours = Date.now() - (24 * 60 * 60 * 1000);
            const recentErrors = this.errorLogs.filter(error => 
                new Date(error.timestamp).getTime() > last24Hours
            );

            analysis.recentTrends = {
                count: recentErrors.length,
                rate: (recentErrors.length / 24).toFixed(2) + ' errors/hour'
            };

            // 生成建议
            if (analysis.errorTypes.javascript_error > 10) {
                analysis.recommendations.push('检测到大量JavaScript错误，建议检查代码质量');
            }

            if (analysis.errorTypes.storage_error > 5) {
                analysis.recommendations.push('存储相关错误较多，建议检查浏览器存储设置');
            }

            if (recentErrors.length > 50) {
                analysis.recommendations.push('最近错误频率较高，建议进行系统维护');
            }

        } catch (error) {
            console.error('Error pattern analysis failed:', error);
        }

        return analysis;
    }

    /**
     * 生成优化建议
     */
    generateOptimizationRecommendations() {
        const recommendations = [];

        try {
            // 基于性能指标生成建议
            const latestMetrics = this.performanceMetrics[this.performanceMetrics.length - 1];
            
            if (latestMetrics && latestMetrics.data) {
                // 内存使用建议
                if (latestMetrics.data.memory) {
                    const memoryUsage = latestMetrics.data.memory.used / latestMetrics.data.memory.total;
                    if (memoryUsage > 0.8) {
                        recommendations.push({
                            type: 'memory',
                            priority: 'high',
                            title: '内存使用率过高',
                            description: '当前内存使用率超过80%，可能影响系统性能',
                            suggestions: [
                                '清理不必要的缓存数据',
                                '减少同时打开的题目窗口',
                                '重启浏览器释放内存'
                            ]
                        });
                    }
                }

                // 存储性能建议
                if (latestMetrics.data.storage) {
                    if (latestMetrics.data.storage.writeTime > 10) {
                        recommendations.push({
                            type: 'storage',
                            priority: 'medium',
                            title: '存储写入性能较慢',
                            description: '数据写入操作耗时较长，可能影响用户体验',
                            suggestions: [
                                '清理过期的练习记录',
                                '压缩存储数据',
                                '考虑使用数据导出功能备份数据'
                            ]
                        });
                    }
                }
            }

            // 基于诊断结果生成建议
            const latestDiagnostic = this.diagnosticResults[this.diagnosticResults.length - 1];
            if (latestDiagnostic && latestDiagnostic.issues.length > 0) {
                const criticalIssues = latestDiagnostic.issues.filter(issue => 
                    issue.severity === 'critical'
                );

                if (criticalIssues.length > 0) {
                    recommendations.push({
                        type: 'integrity',
                        priority: 'critical',
                        title: '发现严重的系统问题',
                        description: `检测到 ${criticalIssues.length} 个严重问题需要立即处理`,
                        suggestions: [
                            '运行完整的系统诊断',
                            '备份当前数据',
                            '考虑重新初始化系统'
                        ]
                    });
                }
            }

            // 基于错误日志生成建议
            const errorAnalysis = this.analyzeErrorPatterns();
            if (errorAnalysis.recentTrends.count > 20) {
                recommendations.push({
                    type: 'stability',
                    priority: 'high',
                    title: '系统稳定性问题',
                    description: '最近24小时内错误频率较高',
                    suggestions: [
                        '检查浏览器兼容性',
                        '清理浏览器缓存',
                        '更新到最新版本'
                    ]
                });
            }

        } catch (error) {
            console.error('Failed to generate optimization recommendations:', error);
        }

        return recommendations;
    }

    /**
     * 执行系统维护
     */
    async performMaintenance(tasks = []) {
        const maintenanceResult = {
            timestamp: new Date().toISOString(),
            requestedTasks: tasks,
            completedTasks: [],
            failedTasks: [],
            summary: {}
        };

        try {
            for (const task of tasks) {
                try {
                    await this.executeMaintenanceTask(task);
                    maintenanceResult.completedTasks.push(task);
                } catch (error) {
                    maintenanceResult.failedTasks.push({
                        task,
                        error: error.message
                    });
                }
            }

            // 生成维护摘要
            maintenanceResult.summary = {
                total: tasks.length,
                completed: maintenanceResult.completedTasks.length,
                failed: maintenanceResult.failedTasks.length,
                success: maintenanceResult.failedTasks.length === 0
            };

        } catch (error) {
            console.error('Maintenance execution failed:', error);
        }

        this.maintenanceTasks.push(maintenanceResult);
        this.saveMaintenanceHistory();

        return maintenanceResult;
    }

    /**
     * 执行单个维护任务
     */
    async executeMaintenanceTask(task) {
        switch (task) {
            case 'cleanup_expired_data':
                await this.cleanupExpiredData();
                break;
            case 'rebuild_index':
                await this.rebuildExamIndex();
                break;
            case 'recalculate_stats':
                await this.recalculateUserStats();
                break;
            case 'compress_data':
                await this.compressStorageData();
                break;
            case 'clear_error_logs':
                this.clearErrorLogs();
                break;
            default:
                throw new Error(`Unknown maintenance task: ${task}`);
        }
    }

    /**
     * 清理过期数据
     */
    async cleanupExpiredData() {
        // 清理过期的练习记录（超过1年）
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        const records = storage.get('practice_records', []);
        const validRecords = records.filter(record => 
            new Date(record.startTime) > oneYearAgo
        );
        
        if (validRecords.length !== records.length) {
            storage.set('practice_records', validRecords);
            console.log(`Cleaned up ${records.length - validRecords.length} expired records`);
        }
    }

    /**
     * 重建题库索引
     */
    async rebuildExamIndex() {
        // 这里应该重新扫描题库文件
        // 由于浏览器环境限制，我们只能重置索引
        console.log('Rebuilding exam index...');
        // 实际实现需要调用 ExamScanner
        if (window.examScanner) {
            await window.examScanner.scanExams();
        }
    }

    /**
     * 重新计算用户统计
     */
    async recalculateUserStats() {
        if (window.practiceRecorder && window.practiceRecorder.scoreStorage) {
            window.practiceRecorder.scoreStorage.recalculateUserStats();
        }
    }

    /**
     * 压缩存储数据
     */
    async compressStorageData() {
        // 移除不必要的字段，压缩数据结构
        const records = storage.get('practice_records', []);
        const compressedRecords = records.map(record => {
            // 移除冗余字段，保留核心数据
            return {
                id: record.id,
                examId: record.examId,
                startTime: record.startTime,
                endTime: record.endTime,
                duration: record.duration,
                score: record.score,
                accuracy: record.accuracy,
                metadata: {
                    category: record.metadata?.category,
                    frequency: record.metadata?.frequency
                }
            };
        });
        
        storage.set('practice_records', compressedRecords);
        console.log('Storage data compressed');
    }

    /**
     * 清理错误日志
     */
    clearErrorLogs() {
        this.errorLogs = [];
        this.saveErrorLogs();
        console.log('Error logs cleared');
    }

    /**
     * 验证文件路径
     */
    isValidFilePath(path) {
        // 基本的路径格式验证
        return path && 
               typeof path === 'string' && 
               path.length > 0 && 
               !path.includes('..') && 
               (path.endsWith('.html') || path.endsWith('.htm'));
    }

    /**
     * 设置定期诊断
     */
    setupPeriodicDiagnostics() {
        // 每小时进行一次性能监控
        setInterval(() => {
            this.startPerformanceMonitoring();
        }, 60 * 60 * 1000);

        // 每天进行一次完整性检查
        setInterval(() => {
            this.checkExamIntegrity();
        }, 24 * 60 * 60 * 1000);
    }

    /**
     * 保存诊断结果
     */
    saveDiagnosticResults() {
        // 保持最近50次诊断结果
        if (this.diagnosticResults.length > 50) {
            this.diagnosticResults.splice(0, this.diagnosticResults.length - 50);
        }
        storage.set('diagnostic_results', this.diagnosticResults);
    }

    /**
     * 保存性能指标
     */
    savePerformanceMetrics() {
        // 保持最近100次性能指标
        if (this.performanceMetrics.length > 100) {
            this.performanceMetrics.splice(0, this.performanceMetrics.length - 100);
        }
        storage.set('performance_metrics', this.performanceMetrics);
    }

    /**
     * 保存错误日志
     */
    saveErrorLogs() {
        storage.set('error_logs', this.errorLogs);
    }

    /**
     * 保存维护历史
     */
    saveMaintenanceHistory() {
        // 保持最近20次维护记录
        if (this.maintenanceTasks.length > 20) {
            this.maintenanceTasks.splice(0, this.maintenanceTasks.length - 20);
        }
        storage.set('maintenance_history', this.maintenanceTasks);
    }

    /**
     * 加载历史数据
     */
    loadHistoricalData() {
        this.diagnosticResults = storage.get('diagnostic_results', []);
        this.performanceMetrics = storage.get('performance_metrics', []);
        this.errorLogs = storage.get('error_logs', []);
        this.maintenanceTasks = storage.get('maintenance_history', []);
    }

    /**
     * 获取系统健康状态
     */
    getSystemHealth() {
        const latestDiagnostic = this.diagnosticResults[this.diagnosticResults.length - 1];
        const latestPerformance = this.performanceMetrics[this.performanceMetrics.length - 1];
        const errorAnalysis = this.analyzeErrorPatterns();

        let healthScore = 100;
        const issues = [];

        // 基于诊断结果计算健康分数
        if (latestDiagnostic) {
            const criticalIssues = latestDiagnostic.issues.filter(i => i.severity === 'critical').length;
            const highIssues = latestDiagnostic.issues.filter(i => i.severity === 'high').length;
            
            healthScore -= criticalIssues * 20;
            healthScore -= highIssues * 10;
            
            if (criticalIssues > 0) {
                issues.push(`${criticalIssues} 个严重问题`);
            }
            if (highIssues > 0) {
                issues.push(`${highIssues} 个高优先级问题`);
            }
        }

        // 基于错误频率计算
        if (errorAnalysis.recentTrends.count > 20) {
            healthScore -= 15;
            issues.push('错误频率较高');
        }

        // 基于性能指标计算
        if (latestPerformance && latestPerformance.data.memory) {
            const memoryUsage = latestPerformance.data.memory.used / latestPerformance.data.memory.total;
            if (memoryUsage > 0.9) {
                healthScore -= 10;
                issues.push('内存使用率过高');
            }
        }

        healthScore = Math.max(0, healthScore);

        return {
            score: healthScore,
            status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical',
            issues: issues,
            lastCheck: latestDiagnostic ? latestDiagnostic.timestamp : null,
            recommendations: this.generateOptimizationRecommendations()
        };
    }
}

// 确保全局可用
window.SystemDiagnostics = SystemDiagnostics;