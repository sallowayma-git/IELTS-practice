/**
 * IELTS系统代码规范 - Linus式简洁标准
 * 消除中文化注释，统一命名和代码风格
 */

/**
 * Linus式代码质量原则
 *
 * 1. 好品味 > 复杂设计
 *    - 消除特殊情况，而不是处理它们
 *    - 数据结构优于代码逻辑
 *    - 简单直接永远正确
 *
 * 2. Never break userspace
 *    - 向后兼容是铁律
 *    - API设计要谨慎
 *    - 破坏性改动 = Bug
 *
 * 3. 实用主义至上
 *    - 解决真实问题，不是理论问题
 *    - 性能优化基于测量，不是猜测
 *    - 简单可维护 > 理论完美
 */

/**
 * 命名规范
 */

// 函数命名：动词开头，驼峰命名，描述行为
const NAMING_CONVENTIONS = {
    // ✅ 好的命名
    goodFunctionNames: [
        'getUserData',           // 清晰的动词+名词
        'calculateScore',        // 明确的计算动作
        'renderList',           // 渲染动作
        'validateInput',        // 验证动作
        'cacheResults',         // 缓存动作
        'filterByType',         // 过滤动作
        'initComponents'        // 初始化动作
    ],

    // ❌ 垃圾命名
    badFunctionNames: [
        'data',                 // 名词，不是动词
        'handleClick',          // 太通用
        'process',              // 模糊不清
        'doStuff',             // 完全无意义
        'temp',                // 临时变量思维
        'helper',              // 辅助函数思维
        'func1',               // 数字后缀
        '处理数据'              // 中文命名
    ],

    // 变量命名：名词或形容词，驼峰命名
    goodVariableNames: [
        'userScore',            // 描述性名词
        'isLoading',            // 布尔值以is开头
        'examList',            // 集合以复数或List结尾
        'currentIndex',         // 索引清晰
        'hasPermission',        // 布尔值以has开头
        'maxAttempts'          // 极限值以max开头
    ],

    // 常量命名：全大写，下划线分隔
    goodConstantNames: [
        'MAX_RETRY_ATTEMPTS',    // 清晰的常量
        'DEFAULT_TIMEOUT',       // 默认值
        'API_BASE_URL',         // 配置常量
        'CACHE_SIZE_LIMIT'      // 限制常量
    ],

    // 类命名：PascalCase，描述实体
    goodClassNames: [
        'PerformanceMonitor',    // 监控器类
        'CacheManager',         // 管理器类
        'DOMBuilder',           // 构建器类
        'ValidationError'       // 错误类
    ]
};

/**
 * 注释规范
 */

// Linus式注释原则：
// 1. 解释"为什么"，不是"是什么"
// 2. 消除特殊情况，而不是注释它们
// 3. 好代码不需要注释，差代码注释也没用

const COMMENT_STANDARDS = {
    // ✅ 好的注释 - 解释设计决策
    goodComments: [
        // 使用事件委托而不是直接绑定，避免内存泄漏
        'DOM.delegate("click", ".item", handler)',

        // 缓存结果避免重复计算，数据量大时性能提升明显
        'const cached = this.cache.get(key)',

        // 强制使用DocumentFragment，避免多次DOM重排
        'DOM.replaceContent(container, fragment)',

        // 防抖处理，避免用户快速点击导致的重复请求
        'Performance.debounce("submit", handleSubmit, 1000)'
    ],

    // ❌ 垃圾注释 - 重复代码内容
    badComments: [
        // 定义变量
        'let count = 0;',

        // 返回结果
        'return result;',

        // 获取用户数据
        'function getUserData() {',

        // 如果存在则处理
        'if (element) { process(element); }'
    ],

    // ❌ 中文化注释 - 统一使用英文
    chineseComments: [
        '// 获取数据',
        '// 处理逻辑',
        '// 返回结果',
        '// 初始化组件',
        '// 检查条件'
    ]
};

/**
 * 代码结构规范
 */

const STRUCTURE_STANDARDS = {
    // 函数长度：不超过30行，理想情况<15行
    functionLength: {
        max: 30,
        ideal: 15,
        reason: '超过3层缩进就该重写'
    },

    // 函数复杂度：单一职责
    singleResponsibility: [
        '✅ 一个函数只做一件事',
        '✅ 参数不超过5个',
        '✅ 嵌套不超过3层',
        '✅ 圈复杂度<10'
    ],

    // 数据结构优先
    dataStructureFirst: [
        '✅ 先设计数据结构，再写逻辑',
        '✅ 用对象参数代替多个参数',
        '✅ 用配置对象代替硬编码',
        '✅ 用枚举代替魔法数字'
    ]
};

/**
 * 错误处理规范
 */

const ERROR_HANDLING_STANDARDS = {
    // ✅ 好的错误处理
    goodErrorHandling: [
        // 具体的错误类型
        'throw new ValidationError("Invalid input: email required")',

        // 有意义的错误消息
        'console.error("[CacheManager] Failed to save data:", error)',

        // 优雅降级
        'return defaultValue || null',

        // 错误边界处理
        'try { riskyOperation() } catch (error) { fallback() }'
    ],

    // ❌ 垃圾错误处理
    badErrorHandling: [
        // 吞掉所有错误
        'try { something() } catch (e) {}',

        // 无意义的错误消息
        'console.log("error")',

        // 重复的错误处理
        'if (!data) return null; // 数据为空返回null'
    ]
};

/**
 * 性能规范
 */

const PERFORMANCE_STANDARDS = {
    // DOM操作规范
    domOperations: [
        '✅ 使用事件委托，不是直接绑定',
        '✅ 使用DocumentFragment，不是多次appendChild',
        '✅ 批量样式更新，不是单独设置',
        '✅ 避免innerHTML，使用DOM构建器'
    ],

    // 内存管理规范
    memoryManagement: [
        '✅ 及时清理事件监听器',
        '✅ 清理定时器和引用',
        '✅ 使用WeakMap避免内存泄漏',
        '✅ 避免闭包中的循环引用'
    ],

    // 异步操作规范
    asyncOperations: [
        '✅ 使用防抖节流控制频率',
        '✅ 使用Promise处理异步',
        '✅ 避免回调地狱',
        '✅ 合理使用缓存'
    ]
};

/**
 * 代码审查检查清单
 */

const CODE_REVIEW_CHECKLIST = {
    // 必须回答的问题
    mandatoryQuestions: [
        '这个改动是否解决了真实问题？',
        '能否用更简单的方式实现？',
        '是否会破坏现有功能？',
        '数据结构是否正确？',
        '是否消除了特殊情况？'
    ],

    // 拒绝标准
    rejectCriteria: [
        '❌ 增加不必要的复杂性',
        '❌ 破坏现有功能',
        '❌ 引入全局状态',
        '❌ 创建循环依赖',
        '❌ 代码难以理解',
        '❌ 中文化注释',
        '❌ 魔法数字和硬编码'
    ],

    // 接受标准
    acceptCriteria: [
        '✅ 简单直接的数据结构',
        '✅ 清晰的职责分离',
        '✅ 消除特殊情况',
        '✅ 保持向后兼容',
        '✅ 代码自文档化',
        '✅ 性能可测量',
        '✅ 错误处理合理'
    ]
};

/**
 * 实用工具函数
 */

class CodeStandards {
    /**
     * 验证函数命名
     */
    static validateFunctionName(name) {
        const isCamelCase = /^[a-z][a-zA-Z0-9]*$/.test(name);
        const isVerb = /^[a-z]+(Action|Handler|Manager|Builder|Validator)?$/.test(name);
        return isCamelCase && isVerb;
    }

    /**
     * 验证变量命名
     */
    static validateVariableName(name) {
        const isCamelCase = /^[a-z][a-zA-Z0-9]*$/.test(name);
        const isNotVerb = !/^[a-z]+(Action|Handler|Manager|Builder|Validator)?$/.test(name);
        return isCamelCase && isNotVerb;
    }

    /**
     * 验证常量命名
     */
    static validateConstantName(name) {
        return /^[A-Z][A-Z0-9_]*$/.test(name);
    }

    /**
     * 检查函数复杂度
     */
    static checkFunctionComplexity(func) {
        const source = func.toString();
        const lines = source.split('\n').length;
        const nesting = (source.match(/if|for|while/g) || []).length;
        const cyclomaticComplexity = (source.match(/if|for|while|catch|\&\&|\|\|/g) || []).length + 1;

        return {
            lines,
            nesting,
            cyclomaticComplexity,
            isTooLong: lines > 30,
            isTooComplex: cyclomaticComplexity > 10,
            isTooNested: nesting > 3
        };
    }

    /**
     * 检查代码风格
     */
    static checkCodeStyle(code) {
        const issues = [];

        // 检查中文化注释
        if (/\/\/[\u4e00-\u9fa5]/.test(code)) {
            issues.push('发现中文化注释，请使用英文注释');
        }

        // 检查console.log
        if (/\bconsole\.log\b/.test(code)) {
            issues.push('发现console.log，生产环境请移除');
        }

        // 检查innerHTML
        if (/\.innerHTML\s*=/.test(code)) {
            issues.push('发现innerHTML赋值，请使用DOM构建器');
        }

        // 检查魔法数字
        if (/\b\d{2,}\b/.test(code) && !/\b(1000|60|24|365)\b/.test(code)) {
            issues.push('发现可能的魔法数字，请使用常量');
        }

        return issues;
    }
}

// 导出到全局
window.CodeStandards = CodeStandards;
window.NAMING_CONVENTIONS = NAMING_CONVENTIONS;
window.COMMENT_STANDARDS = COMMENT_STANDARDS;
window.STRUCTURE_STANDARDS = STRUCTURE_STANDARDS;
window.ERROR_HANDLING_STANDARDS = ERROR_HANDLING_STANDARDS;
window.PERFORMANCE_STANDARDS = PERFORMANCE_STANDARDS;
window.CODE_REVIEW_CHECKLIST = CODE_REVIEW_CHECKLIST;

console.log('[CodeStandards] 代码规范已加载，Linus式简洁标准生效');