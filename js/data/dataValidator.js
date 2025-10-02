/**
 * 数据验证和迁移系统
 * 提供数据完整性检查、自动修复和版本迁移功能
 */

/**
 * 数据验证器基类
 */
class DataValidator {
    constructor(name) {
        this.name = name;
        this.rules = new Map();
    }

    /**
     * 添加验证规则
     */
    addRule(field, rule) {
        if (!this.rules.has(field)) {
            this.rules.set(field, []);
        }
        this.rules.get(field).push(rule);
    }

    /**
     * 验证数据
     */
    validate(data) {
        const errors = [];
        const warnings = [];

        for (const [field, rules] of this.rules) {
            const value = data[field];

            for (const rule of rules) {
                try {
                    const result = rule.validate(value, data);
                    if (!result.valid) {
                        errors.push({
                            field: field,
                            message: result.message || `字段 ${field} 验证失败`,
                            value: value,
                            severity: result.severity || 'error'
                        });

                        if (result.severity === 'warning') {
                            warnings.push(errors[errors.length - 1]);
                            errors.pop();
                        }
                    }
                } catch (error) {
                    errors.push({
                        field: field,
                        message: `验证规则执行失败: ${error.message}`,
                        value: value,
                        severity: 'error'
                    });
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings,
            data: data
        };
    }

    /**
     * 批量验证
     */
    validateBatch(dataArray) {
        const results = [];
        let totalErrors = 0;
        let totalWarnings = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const result = this.validate(dataArray[i]);
            result.index = i;
            results.push(result);
            totalErrors += result.errors.length;
            totalWarnings += result.warnings.length;
        }

        return {
            results: results,
            totalItems: dataArray.length,
            validItems: results.filter(r => r.valid).length,
            totalErrors: totalErrors,
            totalWarnings: totalWarnings
        };
    }
}

/**
 * 验证规则工厂
 */
class ValidationRuleFactory {
    static required(message = '此字段为必填项') {
        return {
            validate: (value) => ({
                valid: value !== null && value !== undefined && value !== '',
                message: message
            })
        };
    }

    static type(type, message = null) {
        const typeNames = {
            string: '字符串',
            number: '数字',
            boolean: '布尔值',
            object: '对象',
            array: '数组'
        };

        return {
            validate: (value) => ({
                valid: typeof value === type,
                message: message || `必须是${typeNames[type] || type}`
            })
        };
    }

    static minLength(min, message = null) {
        return {
            validate: (value) => ({
                valid: !value || value.length >= min,
                message: message || `长度不能少于${min}个字符`
            })
        };
    }

    static maxLength(max, message = null) {
        return {
            validate: (value) => ({
                valid: !value || value.length <= max,
                message: message || `长度不能超过${max}个字符`
            })
        };
    }

    static pattern(regex, message = null) {
        return {
            validate: (value) => ({
                valid: !value || regex.test(value),
                message: message || '格式不正确'
            })
        };
    }

    static range(min, max, message = null) {
        return {
            validate: (value) => ({
                valid: value === null || value === undefined || (value >= min && value <= max),
                message: message || `必须在${min}到${max}之间`
            })
        };
    }

    static min(min, message = null) {
        return {
            validate: (value) => ({
                valid: value === null || value === undefined || value >= min,
                message: message || `不能小于${min}`
            })
        };
    }

    static date(message = null) {
        return {
            validate: (value) => ({
                valid: !value || !isNaN(new Date(value).getTime()),
                message: message || '必须是有效的日期格式'
            })
        };
    }

    static email(message = null) {
        return {
            validate: (value) => ({
                valid: !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
                message: message || '必须是有效的邮箱地址'
            })
        };
    }

    static oneOf(values, message = null) {
        return {
            validate: (value) => ({
                valid: !value || values.includes(value),
                message: message || `必须是以下值之一: ${values.join(', ')}`
            })
        };
    }

    static custom(validator, message = null) {
        return {
            validate: (value, data) => {
                const result = validator(value, data);
                return {
                    valid: result,
                    message: message || '自定义验证失败'
                };
            }
        };
    }
}

/**
 * 练习记录验证器
 */
class PracticeRecordValidator extends DataValidator {
    constructor() {
        super('practice_record');
        this._setupRules();
    }

    _setupRules() {
        // ID验证
        this.addRule('id', ValidationRuleFactory.required('练习记录ID不能为空'));
        this.addRule('id', ValidationRuleFactory.type('string'));
        this.addRule('id', ValidationRuleFactory.minLength(1));
        this.addRule('id', ValidationRuleFactory.pattern(/^practice_\d+_[a-z0-9]+$/, 'ID格式不正确'));

        // 考试ID验证
        this.addRule('examId', ValidationRuleFactory.required('考试ID不能为空'));
        this.addRule('examId', ValidationRuleFactory.type('string'));

        // 标题验证
        this.addRule('title', ValidationRuleFactory.required('考试标题不能为空'));
        this.addRule('title', ValidationRuleFactory.type('string'));
        this.addRule('title', ValidationRuleFactory.minLength(1));
        this.addRule('title', ValidationRuleFactory.maxLength(200));

        // 分类验证
        this.addRule('category', ValidationRuleFactory.required('考试分类不能为空'));
        this.addRule('category', ValidationRuleFactory.type('string'));
        this.addRule('category', ValidationRuleFactory.oneOf(['P1', 'P2', 'P3']));

        // 分数验证
        this.addRule('score', ValidationRuleFactory.type('number'));
        this.addRule('score', ValidationRuleFactory.min(0));
        this.addRule('score', ValidationRuleFactory.custom((value, data) => {
            if (value === undefined || data.totalQuestions === undefined) {
                return true;
            }
            return value <= data.totalQuestions;
        }, '分数不能超过总题数'));

        // 总题数验证
        this.addRule('totalQuestions', ValidationRuleFactory.type('number'));
        this.addRule('totalQuestions', ValidationRuleFactory.min(1));

        // 正确率验证
        this.addRule('accuracy', ValidationRuleFactory.type('number'));
        this.addRule('accuracy', ValidationRuleFactory.range(0, 100));

        // 百分比验证
        this.addRule('percentage', ValidationRuleFactory.type('number'));
        this.addRule('percentage', ValidationRuleFactory.range(0, 100));

        // 时长验证
        this.addRule('duration', ValidationRuleFactory.type('number'));
        this.addRule('duration', ValidationRuleFactory.min(0));

        // 日期验证
        this.addRule('date', ValidationRuleFactory.required('练习日期不能为空'));
        this.addRule('date', ValidationRuleFactory.type('string'));
        this.addRule('date', ValidationRuleFactory.date());

        // 开始时间验证
        this.addRule('startTime', ValidationRuleFactory.required('开始时间不能为空'));
        this.addRule('startTime', ValidationRuleFactory.type('string'));
        this.addRule('startTime', ValidationRuleFactory.date());

        // 结束时间验证
        this.addRule('endTime', ValidationRuleFactory.type('string'));
        this.addRule('endTime', ValidationRuleFactory.date());
        this.addRule('endTime', ValidationRuleFactory.custom((value, data) => {
            if (!value || !data.startTime) {
                return true;
            }
            return new Date(value) >= new Date(data.startTime);
        }, '结束时间不能早于开始时间'));

        // 数据源验证
        this.addRule('dataSource', ValidationRuleFactory.oneOf(['real', 'simulated'], '数据源必须是real或simulated'));

        // 会话ID验证
        this.addRule('sessionId', ValidationRuleFactory.type('string'));
    }
}

/**
 * 数据迁移管理器
 */
class DataMigrationManager {
    constructor() {
        this.migrations = new Map();
        this.currentVersion = '1.0.0';
    }

    /**
     * 注册迁移
     */
    registerMigration(fromVersion, toVersion, migration) {
        const key = `${fromVersion}->${toVersion}`;
        this.migrations.set(key, migration);
        console.log(`[DataMigration] 注册迁移: ${key}`);
    }

    /**
     * 执行迁移
     */
    async migrate(data, fromVersion, toVersion) {
        if (fromVersion === toVersion) {
            return { success: true, data, migrations: [] };
        }

        const path = this._findMigrationPath(fromVersion, toVersion);
        if (!path) {
            throw new Error(`无法找到从${fromVersion}到${toVersion}的迁移路径`);
        }

        let currentData = JSON.parse(JSON.stringify(data)); // 深拷贝
        const executedMigrations = [];

        for (const migration of path) {
            try {
                console.log(`[DataMigration] 执行迁移: ${migration.description}`);
                currentData = await migration.migrate(currentData);
                executedMigrations.push(migration.description);
            } catch (error) {
                console.error(`[DataMigration] 迁移失败: ${migration.description}`, error);
                throw new Error(`迁移失败: ${migration.description} - ${error.message}`);
            }
        }

        return {
            success: true,
            data: currentData,
            migrations: executedMigrations,
            fromVersion,
            toVersion
        };
    }

    /**
     * 查找迁移路径
     */
    _findMigrationPath(fromVersion, toVersion) {
        // 简单实现：直接查找
        const key = `${fromVersion}->${toVersion}`;
        if (this.migrations.has(key)) {
            return [this.migrations.get(key)];
        }

        // 如果没有直接路径，可以在这里实现更复杂的路径查找算法
        return null;
    }
}

/**
 * 数据修复器
 */
class DataRepairer {
    constructor() {
        this.repairStrategies = new Map();
        this._setupDefaultStrategies();
    }

    /**
     * 注册修复策略
     */
    registerStrategy(errorType, strategy) {
        this.repairStrategies.set(errorType, strategy);
    }

    /**
     * 修复数据
     */
    async repair(data, validationResults) {
        const repairedData = JSON.parse(JSON.stringify(data)); // 深拷贝
        const repairLog = [];

        for (const error of validationResults.errors) {
            const strategy = this.repairStrategies.get(error.severity);
            if (strategy) {
                try {
                    const result = await strategy.repair(repairedData, error);
                    if (result.repaired) {
                        repairLog.push({
                            field: error.field,
                            originalValue: error.value,
                            newValue: result.value,
                            action: result.action
                        });

                        if (result.value !== undefined) {
                            repairedData[error.field] = result.value;
                        }
                    }
                } catch (repairError) {
                    console.warn(`[DataRepairer] 修复失败: ${error.field}`, repairError);
                    repairLog.push({
                        field: error.field,
                        error: `修复失败: ${repairError.message}`
                    });
                }
            }
        }

        return {
            data: repairedData,
            repaired: repairLog.length > 0,
            repairLog: repairLog
        };
    }

    /**
     * 设置默认修复策略
     */
    _setupDefaultStrategies() {
        // 缺失字段的修复策略
        this.registerStrategy('missing_field', {
            repair: async (data, error) => {
                const defaultValue = this._getDefaultValue(error.field);
                if (defaultValue !== undefined) {
                    return {
                        repaired: true,
                        value: defaultValue,
                        action: `设置默认值: ${defaultValue}`
                    };
                }
                return { repaired: false };
            }
        });

        // 类型错误的修复策略
        this.registerStrategy('type_error', {
            repair: async (data, error) => {
                const convertedValue = this._convertType(error.field, error.value);
                if (convertedValue !== null) {
                    return {
                        repaired: true,
                        value: convertedValue,
                        action: `类型转换: ${typeof error.value} -> ${typeof convertedValue}`
                    };
                }
                return { repaired: false };
            }
        });
    }

    /**
     * 获取字段默认值
     */
    _getDefaultValue(field) {
        const defaults = {
            id: () => `practice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            title: '未知考试',
            category: 'P1',
            score: 0,
            totalQuestions: 1,
            accuracy: 0,
            percentage: 0,
            duration: 0,
            date: new Date().toISOString().split('T')[0],
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            dataSource: 'simulated',
            frequency: 'low'
        };

        const defaultValue = defaults[field];
        return defaultValue ? (typeof defaultValue === 'function' ? defaultValue() : defaultValue) : undefined;
    }

    /**
     * 类型转换
     */
    _convertType(field, value) {
        if (value === null || value === undefined) {
            return null;
        }

        const numberFields = ['score', 'totalQuestions', 'accuracy', 'percentage', 'duration'];
        const stringFields = ['id', 'title', 'category', 'date', 'startTime', 'endTime', 'dataSource'];

        if (numberFields.includes(field)) {
            const num = Number(value);
            return isNaN(num) ? null : num;
        }

        if (stringFields.includes(field)) {
            return String(value);
        }

        return null;
    }
}

// 创建全局实例
window.DataValidator = DataValidator;
window.ValidationRuleFactory = ValidationRuleFactory;
window.PracticeRecordValidator = PracticeRecordValidator;
window.DataMigrationManager = DataMigrationManager;
window.DataRepairer = DataRepairer;

// 创建默认实例
window.practiceRecordValidator = new PracticeRecordValidator();
window.dataMigrationManager = new DataMigrationManager();
window.dataRepairer = new DataRepairer();