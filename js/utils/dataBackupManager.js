/**
 * 数据备份和恢复管理器
 * 提供完整的数据导入导出、备份恢复和数据清理功能
 */
class DataBackupManager {
    constructor() {
        this.storageKeys = {
            backupSettings: 'backup_settings',
            exportHistory: 'export_history',
            importHistory: 'import_history'
        };
        
        this.supportedFormats = ['json', 'csv'];
        this.maxBackupHistory = 20;
        this.maxExportHistory = 50;
        
        this.initialize();
    }

    /**
     * 初始化备份管理器
     */
    initialize() {
        console.log('DataBackupManager initialized');
        
        // 初始化设置
        this.initializeSettings();
        
        // 设置定期清理
        this.setupPeriodicCleanup();
    }

    /**
     * 初始化备份设置
     */
    initializeSettings() {
        const defaultSettings = {
            autoBackup: true,
            backupInterval: 24, // 小时
            maxBackups: 10,
            compressionEnabled: false,
            encryptionEnabled: false,
            lastAutoBackup: null
        };
        
        const settings = storage.get(this.storageKeys.backupSettings, defaultSettings);
        storage.set(this.storageKeys.backupSettings, settings);
    }

    /**
     * 导出练习记录数据
     */
    exportPracticeRecords(options = {}) {
        try {
            const {
                format = 'json',
                includeStats = true,
                includeBackups = false,
                dateRange = null,
                categories = null,
                compression = false
            } = options;

            // 验证格式
            if (!this.supportedFormats.includes(format.toLowerCase())) {
                throw new Error(`Unsupported export format: ${format}`);
            }

            // 获取练习记录
            let practiceRecords = [];
            if (window.practiceRecorder) {
                practiceRecords = window.practiceRecorder.getPracticeRecords();
            } else {
                practiceRecords = storage.get('practice_records', []);
            }

            // 应用筛选条件
            if (dateRange) {
                practiceRecords = this.filterByDateRange(practiceRecords, dateRange);
            }

            if (categories && categories.length > 0) {
                practiceRecords = practiceRecords.filter(record => 
                    categories.includes(record.metadata?.category)
                );
            }

            // 构建导出数据
            const exportData = {
                exportInfo: {
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    format: format,
                    recordCount: practiceRecords.length,
                    options: options
                },
                practiceRecords: practiceRecords
            };

            // 包含用户统计
            if (includeStats) {
                if (window.practiceRecorder) {
                    exportData.userStats = window.practiceRecorder.getUserStats();
                } else {
                    exportData.userStats = storage.get('user_stats', {});
                }
            }

            // 包含备份数据
            if (includeBackups && window.practiceRecorder) {
                exportData.backups = window.practiceRecorder.getBackups();
            }

            // 记录导出历史
            this.recordExportHistory(exportData.exportInfo);

            // 根据格式返回数据
            switch (format.toLowerCase()) {
                case 'json':
                    return this.exportAsJSON(exportData, compression);
                case 'csv':
                    return this.exportAsCSV(exportData);
                default:
                    throw new Error(`Format ${format} not implemented`);
            }

        } catch (error) {
            console.error('Export failed:', error);
            throw new Error(`导出失败: ${error.message}`);
        }
    }

    /**
     * 导出为JSON格式
     */
    exportAsJSON(data, compression = false) {
        const jsonString = JSON.stringify(data, null, compression ? 0 : 2);
        
        return {
            data: jsonString,
            filename: `practice_records_${this.getTimestamp()}.json`,
            mimeType: 'application/json',
            size: jsonString.length
        };
    }

    /**
     * 导出为CSV格式
     */
    exportAsCSV(data) {
        const records = data.practiceRecords;
        
        if (records.length === 0) {
            return {
                data: '',
                filename: `practice_records_${this.getTimestamp()}.csv`,
                mimeType: 'text/csv',
                size: 0
            };
        }

        // CSV头部
        const headers = [
            '记录ID', '考试ID', '开始时间', '结束时间', '用时(分钟)', 
            '状态', '得分', '总题数', '正确数', '准确率(%)', 
            '分类', '频率', '题目标题', '创建时间'
        ];

        // 转换记录为CSV行
        const rows = records.map(record => [
            record.id || '',
            record.examId || '',
            record.startTime || '',
            record.endTime || '',
            record.duration ? Math.round(record.duration / 60) : 0,
            record.status || '',
            record.score || 0,
            record.totalQuestions || 0,
            record.correctAnswers || 0,
            record.accuracy ? Math.round(record.accuracy * 100) : 0,
            record.metadata?.category || '',
            record.metadata?.frequency || '',
            record.metadata?.examTitle || '',
            record.createdAt || ''
        ]);

        // 生成CSV内容
        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        return {
            data: csvContent,
            filename: `practice_records_${this.getTimestamp()}.csv`,
            mimeType: 'text/csv',
            size: csvContent.length
        };
    }

    /**
     * 导入练习数据
     */
    importPracticeData(importData, options = {}) {
        try {
            const {
                mergeMode = 'merge', // 'merge' | 'replace' | 'skip'
                validateData = true,
                createBackup = true,
                preserveIds = true
            } = options;

            // 创建导入前备份
            let backupId = null;
            if (createBackup) {
                backupId = this.createPreImportBackup();
            }

            // 解析导入数据
            const parsedData = this.parseImportData(importData);
            
            // 验证数据
            if (validateData) {
                this.validateImportData(parsedData);
            }

            // 执行导入
            const result = this.executeImport(parsedData, {
                mergeMode,
                preserveIds,
                backupId
            });

            // 记录导入历史
            this.recordImportHistory({
                timestamp: new Date().toISOString(),
                recordCount: result.importedCount,
                mergeMode: mergeMode,
                backupId: backupId,
                success: true
            });

            return result;

        } catch (error) {
            console.error('Import failed:', error);
            
            // 记录失败的导入历史
            this.recordImportHistory({
                timestamp: new Date().toISOString(),
                error: error.message,
                success: false
            });

            throw new Error(`导入失败: ${error.message}`);
        }
    }

    /**
     * 解析导入数据
     */
    parseImportData(importData) {
        if (typeof importData === 'string') {
            try {
                return JSON.parse(importData);
            } catch (error) {
                throw new Error('无效的JSON格式');
            }
        }
        
        if (typeof importData === 'object' && importData !== null) {
            return importData;
        }
        
        throw new Error('不支持的数据格式');
    }

    /**
     * 验证导入数据
     */
    validateImportData(data) {
        // 检查基本结构
        if (!data.practiceRecords || !Array.isArray(data.practiceRecords)) {
            throw new Error('缺少练习记录数据或格式错误');
        }

        // 验证记录格式
        const requiredFields = ['id', 'examId', 'startTime', 'endTime'];
        
        for (let i = 0; i < data.practiceRecords.length; i++) {
            const record = data.practiceRecords[i];
            
            for (const field of requiredFields) {
                if (!record[field]) {
                    throw new Error(`记录 ${i + 1} 缺少必需字段: ${field}`);
                }
            }

            // 验证时间格式
            if (new Date(record.startTime).toString() === 'Invalid Date') {
                throw new Error(`记录 ${i + 1} 开始时间格式无效`);
            }

            if (new Date(record.endTime).toString() === 'Invalid Date') {
                throw new Error(`记录 ${i + 1} 结束时间格式无效`);
            }
        }
    }

    /**
     * 执行导入操作
     */
    executeImport(data, options) {
        const { mergeMode, preserveIds, backupId } = options;
        
        try {
            let importedCount = 0;
            let skippedCount = 0;
            let updatedCount = 0;

            if (window.practiceRecorder && window.practiceRecorder.scoreStorage) {
                // 使用ScoreStorage的导入功能
                const importOptions = {
                    merge: mergeMode === 'merge',
                    preserveIds: preserveIds
                };
                
                window.practiceRecorder.scoreStorage.importData(data, importOptions);
                importedCount = data.practiceRecords.length;
                
            } else {
                // 直接操作storage的降级处理
                const existingRecords = storage.get('practice_records', []);
                
                if (mergeMode === 'replace') {
                    // 替换模式
                    storage.set('practice_records', data.practiceRecords);
                    importedCount = data.practiceRecords.length;
                    
                } else if (mergeMode === 'merge') {
                    // 合并模式
                    const existingIds = new Set(existingRecords.map(r => r.id));
                    const newRecords = [];
                    
                    data.practiceRecords.forEach(record => {
                        if (!existingIds.has(record.id)) {
                            newRecords.push(record);
                            importedCount++;
                        } else {
                            skippedCount++;
                        }
                    });
                    
                    storage.set('practice_records', [...existingRecords, ...newRecords]);
                    
                } else if (mergeMode === 'skip') {
                    // 跳过模式 - 只导入不存在的记录
                    const existingIds = new Set(existingRecords.map(r => r.id));
                    const newRecords = data.practiceRecords.filter(record => {
                        if (!existingIds.has(record.id)) {
                            importedCount++;
                            return true;
                        } else {
                            skippedCount++;
                            return false;
                        }
                    });
                    
                    storage.set('practice_records', [...existingRecords, ...newRecords]);
                }

                // 导入用户统计（如果存在）
                if (data.userStats && mergeMode === 'replace') {
                    storage.set('user_stats', data.userStats);
                }
            }

            return {
                success: true,
                importedCount,
                skippedCount,
                updatedCount,
                backupId
            };

        } catch (error) {
            // 如果导入失败，尝试恢复备份
            if (backupId) {
                try {
                    this.restoreBackup(backupId);
                    console.log('Backup restored after import failure');
                } catch (restoreError) {
                    console.error('Failed to restore backup:', restoreError);
                }
            }
            
            throw error;
        }
    }

    /**
     * 创建导入前备份
     */
    createPreImportBackup() {
        try {
            if (window.practiceRecorder) {
                return window.practiceRecorder.createBackup('pre_import_backup');
            } else {
                // 降级处理：手动创建备份
                const backupData = {
                    id: `pre_import_${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    data: {
                        practice_records: storage.get('practice_records', []),
                        user_stats: storage.get('user_stats', {}),
                        exam_index: storage.get('exam_index', [])
                    }
                };
                
                const backups = storage.get('manual_backups', []);
                backups.push(backupData);
                
                // 保持最近10个备份
                if (backups.length > 10) {
                    backups.splice(0, backups.length - 10);
                }
                
                storage.set('manual_backups', backups);
                return backupData.id;
            }
        } catch (error) {
            console.error('Failed to create pre-import backup:', error);
            return null;
        }
    }

    /**
     * 数据清理和重置选项
     */
    clearData(options = {}) {
        const {
            clearPracticeRecords = false,
            clearUserStats = false,
            clearBackups = false,
            clearSettings = false,
            createBackup = true
        } = options;

        try {
            // 创建清理前备份
            let backupId = null;
            if (createBackup) {
                backupId = this.createPreImportBackup();
            }

            const clearedItems = [];

            // 清理练习记录
            if (clearPracticeRecords) {
                storage.remove('practice_records');
                clearedItems.push('练习记录');
            }

            // 清理用户统计
            if (clearUserStats) {
                storage.remove('user_stats');
                clearedItems.push('用户统计');
            }

            // 清理备份数据
            if (clearBackups) {
                storage.remove('backup_data');
                storage.remove('manual_backups');
                clearedItems.push('备份数据');
            }

            // 清理设置
            if (clearSettings) {
                storage.remove('settings');
                storage.remove(this.storageKeys.backupSettings);
                clearedItems.push('系统设置');
            }

            // 重新初始化默认数据
            if (clearPracticeRecords || clearUserStats) {
                storage.initializeDefaultData();
            }

            console.log('Data cleared:', clearedItems);

            return {
                success: true,
                clearedItems,
                backupId
            };

        } catch (error) {
            console.error('Data clearing failed:', error);
            throw new Error(`数据清理失败: ${error.message}`);
        }
    }

    /**
     * 按日期范围筛选记录
     */
    filterByDateRange(records, dateRange) {
        const { startDate, endDate } = dateRange;
        
        return records.filter(record => {
            const recordDate = new Date(record.startTime);
            
            if (startDate && recordDate < new Date(startDate)) {
                return false;
            }
            
            if (endDate && recordDate > new Date(endDate)) {
                return false;
            }
            
            return true;
        });
    }

    /**
     * 记录导出历史
     */
    recordExportHistory(exportInfo) {
        const history = storage.get(this.storageKeys.exportHistory, []);
        
        history.push({
            ...exportInfo,
            id: `export_${Date.now()}`
        });

        // 保持最近的导出记录
        if (history.length > this.maxExportHistory) {
            history.splice(0, history.length - this.maxExportHistory);
        }

        storage.set(this.storageKeys.exportHistory, history);
    }

    /**
     * 记录导入历史
     */
    recordImportHistory(importInfo) {
        const history = storage.get(this.storageKeys.importHistory, []);
        
        history.push({
            ...importInfo,
            id: `import_${Date.now()}`
        });

        // 保持最近的导入记录
        if (history.length > this.maxExportHistory) {
            history.splice(0, history.length - this.maxExportHistory);
        }

        storage.set(this.storageKeys.importHistory, history);
    }

    /**
     * 获取导出历史
     */
    getExportHistory() {
        return storage.get(this.storageKeys.exportHistory, [])
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * 获取导入历史
     */
    getImportHistory() {
        return storage.get(this.storageKeys.importHistory, [])
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * 恢复备份
     */
    restoreBackup(backupId) {
        try {
            if (window.practiceRecorder) {
                return window.practiceRecorder.restoreBackup(backupId);
            } else {
                // 降级处理：从手动备份恢复
                const backups = storage.get('manual_backups', []);
                const backup = backups.find(b => b.id === backupId);
                
                if (!backup) {
                    throw new Error(`备份不存在: ${backupId}`);
                }
                
                // 恢复数据
                Object.entries(backup.data).forEach(([key, value]) => {
                    storage.set(key, value);
                });
                
                return true;
            }
        } catch (error) {
            console.error('Backup restore failed:', error);
            throw new Error(`备份恢复失败: ${error.message}`);
        }
    }

    /**
     * 获取时间戳字符串
     */
    getTimestamp() {
        return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    /**
     * 设置定期清理
     */
    setupPeriodicCleanup() {
        // 每天清理一次过期数据
        setInterval(() => {
            this.cleanupExpiredData();
        }, 24 * 60 * 60 * 1000);
    }

    /**
     * 清理过期数据
     */
    cleanupExpiredData() {
        try {
            // 清理过期的导出历史
            const exportHistory = storage.get(this.storageKeys.exportHistory, []);
            const validExports = exportHistory.filter(item => {
                const age = Date.now() - new Date(item.timestamp).getTime();
                return age < (30 * 24 * 60 * 60 * 1000); // 保留30天
            });
            
            if (validExports.length !== exportHistory.length) {
                storage.set(this.storageKeys.exportHistory, validExports);
            }

            // 清理过期的导入历史
            const importHistory = storage.get(this.storageKeys.importHistory, []);
            const validImports = importHistory.filter(item => {
                const age = Date.now() - new Date(item.timestamp).getTime();
                return age < (30 * 24 * 60 * 60 * 1000); // 保留30天
            });
            
            if (validImports.length !== importHistory.length) {
                storage.set(this.storageKeys.importHistory, validImports);
            }

            console.log('Expired data cleaned up');
            
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    /**
     * 获取数据统计信息
     */
    getDataStats() {
        try {
            const practiceRecords = storage.get('practice_records', []);
            const userStats = storage.get('user_stats', {});
            const exportHistory = this.getExportHistory();
            const importHistory = this.getImportHistory();

            return {
                practiceRecords: {
                    count: practiceRecords.length,
                    oldestRecord: practiceRecords.length > 0 ? practiceRecords[0]?.startTime : null,
                    newestRecord: practiceRecords.length > 0 ? practiceRecords[practiceRecords.length - 1]?.startTime : null
                },
                userStats: {
                    totalPractices: userStats.totalPractices || 0,
                    totalTimeSpent: userStats.totalTimeSpent || 0,
                    averageScore: userStats.averageScore || 0
                },
                exportHistory: {
                    count: exportHistory.length,
                    lastExport: exportHistory.length > 0 ? exportHistory[0].timestamp : null
                },
                importHistory: {
                    count: importHistory.length,
                    lastImport: importHistory.length > 0 ? importHistory[0].timestamp : null
                },
                storage: storage.getStorageInfo()
            };
        } catch (error) {
            console.error('Failed to get data stats:', error);
            return null;
        }
    }
}

// 确保全局可用
window.DataBackupManager = DataBackupManager;