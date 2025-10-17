/**
 * IELTS系统类型检查工具 - JSDoc实现
 * 无需构建工具，IDE自动支持类型检查
 */

/**
 * JSDoc类型定义模板
 * 使用VS Code + JSDoc可获得完整的类型支持
 */

/**
 * @typedef {Object} ExamItem 题目数据结构
 * @property {string} id - 题目ID
 * @property {string} type - 题目类型: reading|listening
 * @property {string} category - 题目分类: P1|P2|P3|P4
 * @property {string} title - 题目标题
 * @property {string} content - 题目内容
 * @property {Object} options - 选项对象
 * @property {string} answer - 正确答案
 * @property {string} explanation - 解释说明
 * @property {number} difficulty - 难度等级 1-5
 * @property {Date} createdAt - 创建时间
 * @property {Date} updatedAt - 更新时间
 */

/**
 * @typedef {Object} PracticeRecord 练习记录数据结构
 * @property {string} id - 记录ID
 * @property {string} examId - 题目ID
 * @property {string} userAnswer - 用户答案
 * @property {boolean} isCorrect - 是否正确
 * @property {number} score - 得分
 * @property {number} timeSpent - 耗时(秒)
 * @property {Date} startTime - 开始时间
 * @property {Date} endTime - 结束时间
 * @property {Object} metadata - 元数据
 */

/**
 * @typedef {Object} UserSettings 用户设置数据结构
 * @property {Object} preferences - 用户偏好
 * @property {string} preferences.theme - 主题: light|dark
 * @property {string} preferences.language - 语言: zh-CN|en-US
 * @property {Object} practice - 练习设置
 * @property {number} practice.dailyGoal - 每日目标
 * @property {boolean} practice.showTimer - 显示计时器
 * @property {boolean} practice.showScore - 显示分数
 * @property {Object} ui - UI设置
 * @property {boolean} ui.showHints - 显示提示
 * @property {boolean} ui.autoSave - 自动保存
 */

/**
 * @typedef {Object} PerformanceStats 性能统计数据结构
 * @property {Object} cache - 缓存统计
 * @property {number} cache.size - 缓存大小
 * @property {number} cache.hitRate - 命中率
 * @property {Object} render - 渲染统计
 * @property {number} render.count - 渲染次数
 * @property {number} render.averageTime - 平均渲染时间
 * @property {Object} memory - 内存统计
 * @property {number} memory.used - 已使用内存
 * @property {number} memory.limit - 内存限制
 */

/**
 * 类型检查工具类
 */
class TypeChecker {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.typeDefinitions = new Map();
        this.setupTypeDefinitions();
    }

    /**
     * 设置基础类型定义
     */
    setupTypeDefinitions() {
        // 基础类型验证器
        this.typeDefinitions.set('string', (value) => typeof value === 'string');
        this.typeDefinitions.set('number', (value) => typeof value === 'number' && !isNaN(value));
        this.typeDefinitions.set('boolean', (value) => typeof value === 'boolean');
        this.typeDefinitions.set('object', (value) => typeof value === 'object' && value !== null);
        this.typeDefinitions.set('array', (value) => Array.isArray(value));
        this.typeDefinitions.set('function', (value) => typeof value === 'function');
        this.typeDefinitions.set('date', (value) => value instanceof Date);
        this.typeDefinitions.set('element', (value) => value instanceof Element);

        // 自定义类型验证器
        this.typeDefinitions.set('ExamItem', this.validateExamItem.bind(this));
        this.typeDefinitions.set('PracticeRecord', this.validatePracticeRecord.bind(this));
        this.typeDefinitions.set('UserSettings', this.validateUserSettings.bind(this));
    }

    /**
     * 验证ExamItem类型
     * @param {any} value 要验证的值
     * @returns {boolean} 是否为有效的ExamItem
     */
    validateExamItem(value) {
        if (!value || typeof value !== 'object') return false;

        const requiredFields = ['id', 'type', 'category', 'title', 'content'];
        for (const field of requiredFields) {
            if (typeof value[field] !== 'string') return false;
        }

        if (!['reading', 'listening'].includes(value.type)) return false;
        if (!['P1', 'P2', 'P3', 'P4'].includes(value.category)) return false;
        if (typeof value.difficulty !== 'number' || value.difficulty < 1 || value.difficulty > 5) return false;

        return true;
    }

    /**
     * 验证PracticeRecord类型
     * @param {any} value 要验证的值
     * @returns {boolean} 是否为有效的PracticeRecord
     */
    validatePracticeRecord(value) {
        if (!value || typeof value !== 'object') return false;

        const requiredFields = ['id', 'examId', 'userAnswer', 'isCorrect', 'score', 'timeSpent'];
        for (const field of requiredFields) {
            if (field === 'isCorrect') {
                if (typeof value[field] !== 'boolean') return false;
            } else if (field === 'score' || field === 'timeSpent') {
                if (typeof value[field] !== 'number' || value[field] < 0) return false;
            } else {
                if (typeof value[field] !== 'string') return false;
            }
        }

        if (!(value.startTime instanceof Date) || !(value.endTime instanceof Date)) return false;
        if (value.endTime < value.startTime) return false;

        return true;
    }

    /**
     * 验证UserSettings类型
     * @param {any} value 要验证的值
     * @returns {boolean} 是否为有效的UserSettings
     */
    validateUserSettings(value) {
        if (!value || typeof value !== 'object') return false;

        // 验证preferences
        if (!value.preferences || typeof value.preferences !== 'object') return false;
        if (!['light', 'dark'].includes(value.preferences.theme)) return false;
        if (!['zh-CN', 'en-US'].includes(value.preferences.language)) return false;

        // 验证practice设置
        if (!value.practice || typeof value.practice !== 'object') return false;
        if (typeof value.practice.dailyGoal !== 'number' || value.practice.dailyGoal <= 0) return false;

        return true;
    }

    /**
     * 验证单个值的类型
     * @param {any} value 要验证的值
     * @param {string} expectedType 期望的类型
     * @param {string} context 上下文信息
     * @returns {boolean} 验证是否通过
     */
    validateType(value, expectedType, context = '') {
        const validator = this.typeDefinitions.get(expectedType);
        if (!validator) {
            this.warnings.push(`Unknown type: ${expectedType} at ${context}`);
            return true; // 未知类型不报错
        }

        const isValid = validator(value);
        if (!isValid) {
            const actualType = Array.isArray(value) ? 'array' :
                            value instanceof Date ? 'date' :
                            value instanceof Element ? 'element' :
                            typeof value;
            this.errors.push(`Type mismatch at ${context}: expected ${expectedType}, got ${actualType}`);
        }

        return isValid;
    }

    /**
     * 验证函数参数
     * @param {function} func 要验证的函数
     * @param {Array} args 实际参数
     * @param {Array} expectedTypes 期望的类型数组
     */
    validateFunctionArguments(func, args, expectedTypes) {
        const funcName = func.name || 'anonymous';

        for (let i = 0; i < Math.min(args.length, expectedTypes.length); i++) {
            this.validateType(args[i], expectedTypes[i], `${funcName} argument ${i + 1}`);
        }

        if (args.length < expectedTypes.length) {
            this.warnings.push(`Function ${funcName} missing ${expectedTypes.length - args.length} arguments`);
        }
    }

    /**
     * 验证对象属性类型
     * @param {Object} obj 要验证的对象
     * @param {Object} schema 类型模式
     * @param {string} context 上下文
     */
    validateObjectSchema(obj, schema, context = 'object') {
        if (!obj || typeof obj !== 'object') {
            this.errors.push(`Expected object at ${context}, got ${typeof obj}`);
            return false;
        }

        let isValid = true;

        for (const [key, expectedType] of Object.entries(schema)) {
            if (!(key in obj)) {
                this.warnings.push(`Missing required property '${key}' at ${context}`);
                isValid = false;
                continue;
            }

            if (!this.validateType(obj[key], expectedType, `${context}.${key}`)) {
                isValid = false;
            }
        }

        return isValid;
    }

    /**
     * 检查函数返回值类型
     * @param {function} func 要检查的函数
     * @param {any} returnValue 返回值
     * @param {string} expectedType 期望的返回类型
     */
    validateReturnValue(func, returnValue, expectedType) {
        const funcName = func.name || 'anonymous';
        this.validateType(returnValue, expectedType, `${funcName} return value`);
    }

    /**
     * 运行时类型检查装饰器
     * @param {Object} schema 类型模式
     */
    runtimeTypeCheck(schema) {
        return (target, propertyName, descriptor) => {
            const method = descriptor.value;

            descriptor.value = function(...args) {
                // 检查参数类型
                if (schema.args) {
                    for (let i = 0; i < schema.args.length; i++) {
                        const expectedType = schema.args[i];
                        if (i < args.length) {
                            if (!window.typeChecker.validateType(args[i], expectedType, `${target.constructor.name}.${propertyName} arg ${i}`)) {
                                throw new TypeError(`Argument ${i} type mismatch`);
                            }
                        }
                    }
                }

                // 调用原方法
                const result = method.apply(this, args);

                // 检查返回值类型
                if (schema.returns) {
                    if (!window.typeChecker.validateType(result, schema.returns, `${target.constructor.name}.${propertyName} return`)) {
                        throw new TypeError(`Return value type mismatch`);
                    }
                }

                return result;
            };
        };
    }

    /**
     * 获取验证报告
     */
    getReport() {
        return {
            errors: [...this.errors],
            warnings: [...this.warnings],
            isValid: this.errors.length === 0,
            timestamp: Date.now()
        };
    }

    /**
     * 清理错误和警告
     */
    clear() {
        this.errors = [];
        this.warnings = [];
    }
}

/**
 * JSDoc类型注释生成器
 */
class JSDocGenerator {
    /**
     * 生成函数类型注释
     * @param {string} functionName 函数名
     * @param {Array} parameters 参数数组
     * @param {string} returnType 返回类型
     * @param {string} description 描述
     */
    static generateFunctionDoc(functionName, parameters, returnType, description = '') {
        let doc = `/**\n`;

        if (description) {
            doc += ` * ${description}\n`;
        }

        parameters.forEach((param, index) => {
            const { name, type, description: paramDesc } = param;
            doc += ` * @param {${type}} ${name}`;
            if (paramDesc) doc += ` - ${paramDesc}`;
            doc += `\n`;
        });

        if (returnType && returnType !== 'void') {
            doc += ` * @returns {${returnType}} 返回值\n`;
        }

        doc += ` */`;
        return doc;
    }

    /**
     * 生成类类型注释
     * @param {string} className 类名
     * @param {Array} properties 属性数组
     * @param {Array} methods 方法数组
     * @param {string} description 描述
     */
    static generateClassDoc(className, properties, methods, description = '') {
        let doc = `/**\n`;

        if (description) {
            doc += ` * ${description}\n`;
        }

        properties.forEach(prop => {
            const { name, type, description: propDesc } = prop;
            doc += ` * @property {${type}} ${name}`;
            if (propDesc) doc += ` - ${propDesc}`;
            doc += `\n`;
        });

        methods.forEach(method => {
            const { name, parameters, returnType, description: methodDesc } = method;
            doc += ` * @method {${returnType}} ${name}`;
            if (methodDesc) doc += ` - ${methodDesc}`;
            doc += `\n`;
        });

        doc += ` */`;
        return doc;
    }
}

// 导出到全局
window.TypeChecker = TypeChecker;
window.JSDocGenerator = JSDocGenerator;

// 创建全局实例
window.typeChecker = new TypeChecker();

console.log('[TypeChecker] JSDoc类型检查工具已加载');