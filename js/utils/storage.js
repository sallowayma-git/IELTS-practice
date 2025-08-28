/**
 * 本地存储工具类
 * 提供统一的数据存储和检索接口
 */
class StorageManager {
    constructor() {
        this.prefix = 'exam_system_';
        this.version = '1.0.0';
        this.initializeStorage();
    }

    /**
     * 初始化存储系统
     */
    initializeStorage() {
        try {
            // 检查localStorage可用性
            const testKey = this.prefix + 'test';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);
            
            // 初始化版本信息
            const currentVersion = this.get('system_version');
            if (!currentVersion || currentVersion !== this.version) {
                this.handleVersionUpgrade(currentVersion);
            }
        } catch (error) {
            console.warn('LocalStorage not available, falling back to memory storage');
            this.fallbackStorage = new Map();
        }
    }

    /**
     * 处理版本升级
     */
    handleVersionUpgrade(oldVersion) {
        console.log(`Upgrading storage from ${oldVersion || 'unknown'} to ${this.version}`);
        
        // 在这里处理数据迁移逻辑
        if (!oldVersion) {
            // 首次安装，初始化默认数据
            this.initializeDefaultData();
        }
        
        this.set('system_version', this.version);
    }

    /**
     * 初始化默认数据
     */
    initializeDefaultData() {
        const defaultData = {
            user_stats: {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                lastPracticeDate: null,
                achievements: []
            },
            settings: {
                theme: 'light',
                notifications: true,
                autoSave: true,
                reminderTime: '19:00'
            },
            exam_index: null,
            practice_records: [],
            learning_goals: []
        };

        Object.entries(defaultData).forEach(([key, value]) => {
            if (!this.get(key)) {
                this.set(key, value);
            }
        });
    }

    /**
     * 生成完整的存储键名
     */
    getKey(key) {
        return this.prefix + key;
    }

    /**
     * 存储数据
     */
    set(key, value) {
        try {
            const serializedValue = JSON.stringify({
                data: value,
                timestamp: Date.now(),
                version: this.version
            });

            if (this.fallbackStorage) {
                this.fallbackStorage.set(this.getKey(key), serializedValue);
            } else {
                localStorage.setItem(this.getKey(key), serializedValue);
            }
            return true;
        } catch (error) {
            console.error('Storage set error:', error);
            return false;
        }
    }

    /**
     * 获取数据
     */
    get(key, defaultValue = null) {
        try {
            let serializedValue;
            
            if (this.fallbackStorage) {
                serializedValue = this.fallbackStorage.get(this.getKey(key));
            } else {
                serializedValue = localStorage.getItem(this.getKey(key));
            }

            if (!serializedValue) {
                return defaultValue;
            }

            const parsed = JSON.parse(serializedValue);
            return parsed.data;
        } catch (error) {
            console.error('Storage get error:', error);
            return defaultValue;
        }
    }

    /**
     * 删除数据
     */
    remove(key) {
        try {
            if (this.fallbackStorage) {
                this.fallbackStorage.delete(this.getKey(key));
            } else {
                localStorage.removeItem(this.getKey(key));
            }
            return true;
        } catch (error) {
            console.error('Storage remove error:', error);
            return false;
        }
    }

    /**
     * 清空所有数据
     */
    clear() {
        try {
            if (this.fallbackStorage) {
                this.fallbackStorage.clear();
            } else {
                // 只清除本应用的数据
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith(this.prefix)) {
                        localStorage.removeItem(key);
                    }
                });
            }
            this.initializeDefaultData();
            return true;
        } catch (error) {
            console.error('Storage clear error:', error);
            return false;
        }
    }

    /**
     * 获取存储使用情况
     */
    getStorageInfo() {
        try {
            if (this.fallbackStorage) {
                return {
                    type: 'memory',
                    used: this.fallbackStorage.size,
                    available: Infinity
                };
            }

            let used = 0;
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
                if (key.startsWith(this.prefix)) {
                    used += localStorage.getItem(key).length;
                }
            });

            return {
                type: 'localStorage',
                used: used,
                available: 5 * 1024 * 1024 - used // 假设5MB限制
            };
        } catch (error) {
            console.error('Storage info error:', error);
            return null;
        }
    }

    /**
     * 导出数据
     */
    exportData() {
        try {
            const data = {};
            
            if (this.fallbackStorage) {
                this.fallbackStorage.forEach((value, key) => {
                    if (key.startsWith(this.prefix)) {
                        const cleanKey = key.replace(this.prefix, '');
                        data[cleanKey] = JSON.parse(value);
                    }
                });
            } else {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith(this.prefix)) {
                        const cleanKey = key.replace(this.prefix, '');
                        data[cleanKey] = JSON.parse(localStorage.getItem(key));
                    }
                });
            }

            return {
                version: this.version,
                exportDate: new Date().toISOString(),
                data: data
            };
        } catch (error) {
            console.error('Export data error:', error);
            return null;
        }
    }

    /**
     * 导入数据
     */
    importData(importedData) {
        try {
            if (!importedData || !importedData.data) {
                throw new Error('Invalid import data format');
            }

            // 备份当前数据
            const backup = this.exportData();
            
            try {
                // 清空现有数据
                this.clear();
                
                // 导入新数据
                Object.entries(importedData.data).forEach(([key, value]) => {
                    this.set(key, value.data);
                });

                return { success: true, message: 'Data imported successfully' };
            } catch (importError) {
                // 恢复备份
                console.error('Import failed, restoring backup:', importError);
                this.clear();
                Object.entries(backup.data).forEach(([key, value]) => {
                    this.set(key, value.data);
                });
                throw importError;
            }
        } catch (error) {
            console.error('Import data error:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * 数据验证
     */
    validateData(key, data) {
        const validators = {
            practice_records: (records) => {
                return Array.isArray(records) && records.every(record => 
                    record.id && record.examId && record.startTime && record.endTime
                );
            },
            user_stats: (stats) => {
                return stats && typeof stats.totalPractices === 'number';
            },
            exam_index: (index) => {
                return !index || (Array.isArray(index) && index.every(exam => 
                    exam.id && exam.title && exam.category
                ));
            }
        };

        const validator = validators[key];
        return validator ? validator(data) : true;
    }
}

// 创建全局存储实例
window.storage = new StorageManager();