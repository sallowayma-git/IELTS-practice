(function initAppLogger(global) {
    if (!global) {
        return;
    }

    if (global.AppLogger) {
        return;
    }

    const nativeConsole = global.console = global.console || {};

    function bindConsoleMethod(method) {
        if (typeof nativeConsole[method] === 'function') {
            return nativeConsole[method].bind(nativeConsole);
        }
        return function noop() { };
    }

    class AppLogger {
        constructor(externalConfig = {}) {
            this.nativeMethods = {
                log: bindConsoleMethod('log'),
                info: bindConsoleMethod('info'),
                warn: bindConsoleMethod('warn'),
                error: bindConsoleMethod('error'),
                debug: bindConsoleMethod('debug')
            };
            this.methodMap = {
                error: 'error',
                warn: 'warn',
                info: 'log',
                debug: 'log',
                trace: 'log'
            };
            this.levelMap = {
                error: 0,
                warn: 1,
                info: 2,
                debug: 3,
                trace: 4
            };
            this.storageKey = 'exam_system_log_config';
            this.defaultLevel = 'info';
            this.defaultCategories = {
                Storage: 'error',
                DataConsistencyManager: 'error',
                PerformanceOptimizer: 'warn',
                System: 'info',
                PracticeRecorder: 'info',
                ScoreStorage: 'info'
            };
            this.suppressionNotices = new Set();

            // 新增：日志聚合和折叠功能
            this.logGroups = new Map(); // 用于存储分组日志
            this.collapsedLogs = new Map(); // 用于存储已折叠的日志
            this.groupThreshold = 2; // 折叠阈值：相同日志出现2次后折叠（更激进）
            this.maxGroupSize = 20; // 最大分组大小（增大）
            this.enableGrouping = true; // 启用日志分组

            // 新增：批量操作计数器
            this.batchCounters = new Map(); // 用于批量统计操作

            // 新增：重复日志抑制功能
            this.suppressionCounters = new Map(); // 重复日志计数器
            this.duplicateDetection = {
                enabled: true,
                timeWindow: 5000, // 5秒时间窗口
                minCount: 3 // 最少出现3次后开始抑制
            };

            // 新增：专门抑制配置
            this.categorySuppression = {
                DataConsistencyManager: {
                    enabled: true,
                    showErrorOnly: true, // 只显示错误级别
                    suppressLevels: ['info', 'warn', 'debug'], // 抑制所有非错误级别
                    suppressedPatterns: [
                        '开始数据补充',
                        '数据补充完成',
                        '数据验证结果',
                        '生成答案比较数据',
                        '从答案比较计算分数',
                        '开始修复数据不一致问题',
                        '数据修复完成',
                        '数据质量报告'
                    ],
                    // 新增：批量统计模式
                    batchMode: {
                        enabled: true,
                        batchSize: 100, // 每处理100条记录才输出一次统计
                        showProgress: false // 不显示进度信息
                    }
                },
                // 新增：Storage 模块的抑制配置
                Storage: {
                    enabled: true,
                    showErrorOnly: false, // 显示错误和警告
                    suppressLevels: ['debug', 'info', 'log'], // 抑制debug、info、log级别
                    suppressedPatterns: [
                        '开始设置键',
                        '数据大小',
                        '尝试使用 IndexedDB 存储',
                        'IndexedDB 存储成功'
                    ],
                    batchMode: {
                        enabled: true,
                        batchSize: 20, // 增加批量大小
                        showProgress: false
                    }
                },
                // 新增：PracticeRecorder 的抑制配置
                PracticeRecorder: {
                    enabled: true,
                    showErrorOnly: false,
                    suppressLevels: ['debug', 'info', 'log'], // 抑制debug、info、log级别
                    suppressedPatterns: [
                        '开始保存练习记录',
                        'ScoreStorage保存失败',
                        '等待',
                        '使用降级保存方法'
                    ],
                    batchMode: {
                        enabled: true,
                        batchSize: 10, // 增加批量大小
                        showProgress: false
                    }
                }
            };

            const initialConfig = this.mergeConfig(externalConfig);
            this.globalLevel = initialConfig.level;
            this.categoryLevels = initialConfig.categories;

            // 【紧急修复】立即强制设置 DataConsistencyManager 为 error 级别
            this.categoryLevels['DataConsistencyManager'] = 'error';

            this.overrideConsole();

            // 【调试信息】输出当前设置状态
            if (this.nativeMethods.log) {
                this.nativeMethods.log(`[Logger] DataConsistencyManager 级别已强制设置为: ${this.categoryLevels['DataConsistencyManager']}`);
                this.nativeMethods.log(`[Logger] Storage 级别已设置为: ${this.categoryLevels['Storage']}`);
            }
        }

        mergeConfig(externalConfig = {}) {
            let persisted = {};
            try {
                const stored = global.localStorage
                    ? global.localStorage.getItem(this.storageKey)
                    : null;
                if (stored) {
                    persisted = JSON.parse(stored);
                }
            } catch (_) { }

            const result = {
                level: this.validateLevel(externalConfig.level)
                    || this.validateLevel(persisted.level)
                    || this.defaultLevel,
                categories: Object.assign(
                    {},
                    this.defaultCategories,
                    persisted.categories || {},
                    externalConfig.categories || {}
                )
            };
            Object.keys(result.categories).forEach((key) => {
                const level = result.categories[key];
                result.categories[key] = this.validateLevel(level) || this.defaultLevel;
            });
            return result;
        }

        persistConfig() {
            try {
                if (global.localStorage) {
                    global.localStorage.setItem(this.storageKey, JSON.stringify({
                        level: this.globalLevel,
                        categories: this.categoryLevels
                    }));
                }
            } catch (_) { }
        }

        overrideConsole() {
            const levels = {
                log: 'info',
                info: 'info',
                warn: 'warn',
                error: 'error',
                debug: 'debug'
            };
            Object.keys(levels).forEach((methodName) => {
                const level = levels[methodName];
                const nativeMethod = this.nativeMethods[methodName] || this.nativeMethods.log;
                const self = this;
                global.console[methodName] = function proxyConsoleMethod(...args) {
                    if (!args.length) {
                        nativeMethod();
                        return;
                    }
                    const extracted = self.extractCategory(args);
                    if (!extracted) {
                        nativeMethod(...args);
                        return;
                    }
                    self.output(extracted.category, level, extracted.args);
                };
            });
        }

        extractCategory(args) {
            const firstArg = args[0];
            if (typeof firstArg !== 'string') {
                return null;
            }
            const trimmed = firstArg.trimStart();
            if (!trimmed.startsWith('[')) {
                return null;
            }
            const closingIndex = trimmed.indexOf(']');
            if (closingIndex === -1) {
                return null;
            }
            const category = trimmed.slice(1, closingIndex).trim();
            const rest = trimmed.slice(closingIndex + 1).trim();
            if (!category) {
                return null;
            }
            const nextArgs = rest ? [rest, ...args.slice(1)] : [...args.slice(1)];
            return { category, args: nextArgs };
        }

        levelValue(level) {
            return this.levelMap[level] ?? this.levelMap.info;
        }

        getCategoryLevel(category) {
            return this.categoryLevels[category] || this.globalLevel;
        }

        shouldLog(category, level) {
            // 【紧急修复】对 DataConsistencyManager 强制只允许 error 级别
            if (category === 'DataConsistencyManager') {
                if (level !== 'error') {
                    return false;
                }
            }
            return this.levelValue(level) <= this.levelValue(this.getCategoryLevel(category));
        }

        noteSuppression(category) {
            if (this.suppressionNotices.has(category)) {
                return;
            }
            this.suppressionNotices.add(category);
            const notifier = this.nativeMethods.log || function noop() { };
            notifier(
                `[Logger] ${category} 日志已折叠（当前级别: ${this.getCategoryLevel(category)}）。` +
                ` 执行 window.AppLogger.setCategoryLevel('${category}','info') 以查看详细输出。`
            );
        }

        // 新增：生成日志的唯一键用于分组
        generateLogKey(category, level, args) {
            const message = args.join(' ').trim();
            return `${category}_${level}_${message}`;
        }

        // 新增：获取日志消息的摘要
        getLogSummary(args, maxLength = 50) {
            const message = args.join(' ').trim();
            if (message.length <= maxLength) {
                return message;
            }
            return message.substring(0, maxLength - 3) + '...';
        }

        // 新增：输出折叠日志摘要
        outputCollapsedSummary(category, key, count, level, args) {
            const summary = this.getLogSummary(args);
            const method = this.methodMap[level] || 'log';
            const target = this.nativeMethods[method] || this.nativeMethods.log;

            const icon = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🔽';
            target(`${icon} 已折叠 ${count} 条 ${category} 日志: ${summary}`);

            // 添加展开提示
            if (this.nativeMethods.log) {
                this.nativeMethods.log(`   💡 执行 window.AppLogger.expandLogGroup('${key}') 查看详细内容`);
            }
        }

        // 新增：展开折叠的日志组
        expandLogGroup(key) {
            const group = this.logGroups.get(key);
            if (!group) {
                this.nativeMethods.warn(`[Logger] 未找到日志组: ${key}`);
                return;
            }

            const { category, level, logs, count } = group;
            const method = this.methodMap[level] || 'log';
            const target = this.nativeMethods[method] || this.nativeMethods.log;

            // 输出分隔线和组信息
            this.nativeMethods.log(`📋 展开 ${count} 条 ${category} 日志:`);

            // 输出所有折叠的日志
            logs.forEach(log => {
                target(`[${category}]`, ...log.args);
            });

            // 清理已展开的组
            this.logGroups.delete(key);
            this.collapsedLogs.delete(key);
        }

        // 新增：清理所有折叠的日志组
        clearAllCollapsed() {
            const count = this.collapsedLogs.size;
            this.logGroups.clear();
            this.collapsedLogs.clear();
            this.nativeMethods.log(`[Logger] 已清理 ${count} 个折叠的日志组`);
        }

        // 新增：获取分组统计信息
        getGroupStats() {
            const stats = {
                activeGroups: this.logGroups.size,
                collapsedGroups: this.collapsedLogs.size,
                suppressionCounters: this.suppressionCounters.size,
                batchCounters: this.batchCounters.size,
                categories: {}
            };

            // 统计各模块的分组情况
            this.logGroups.forEach((group, key) => {
                if (!stats.categories[group.category]) {
                    stats.categories[group.category] = { groups: 0, totalLogs: 0, suppressedLogs: 0 };
                }
                stats.categories[group.category].groups++;
                stats.categories[group.category].totalLogs += group.count;
            });

            // 统计批量处理的日志数量
            this.batchCounters.forEach((counter, key) => {
                const category = key.replace('_batch', '');
                if (!stats.categories[category]) {
                    stats.categories[category] = { groups: 0, totalLogs: 0, suppressedLogs: 0 };
                }
                stats.categories[category].suppressedLogs += counter.count;
            });

            return stats;
        }

        // 新增：检查专门抑制机制
        checkSpecializedSuppression(category, level, args) {
            const categorySuppression = this.categorySuppression[category];

            if (!categorySuppression || !categorySuppression.enabled) {
                return false;
            }

            const message = args.join(' ').trim();

            // 检查批量模式
            if (categorySuppression.batchMode && categorySuppression.batchMode.enabled) {
                return this.handleBatchMode(category, level, args, categorySuppression.batchMode);
            }

            // 检查是否匹配抑制模式
            if (categorySuppression.suppressedPatterns.some(pattern => message.includes(pattern))) {
                // 如果设置只显示错误，则立即抑制
                if (categorySuppression.showErrorOnly && level !== 'error') {
                    return true;
                }

                // 检查是否在抑制级别列表中
                if (categorySuppression.suppressLevels.includes(level)) {
                    return true;
                }
            }

            return false;
        }

        // 新增：处理批量模式
        handleBatchMode(category, level, args, batchConfig) {
            const message = args.join(' ').trim();
            const batchKey = `${category}_batch`;

            // 初始化批量计数器
            if (!this.batchCounters.has(batchKey)) {
                this.batchCounters.set(batchKey, {
                    count: 0,
                    suppressedPatterns: new Set(),
                    lastReport: Date.now()
                });
            }

            const counter = this.batchCounters.get(batchKey);
            counter.count++;

            // 【紧急修复】对于 DataConsistencyManager，直接抑制所有非错误级别的日志
            if (category === 'DataConsistencyManager') {
                if (level !== 'error') {
                    // 每100条记录输出一次统计
                    if (counter.count % 100 === 0) {
                        this.outputBatchStats(category, counter);
                    }
                    return true;
                }
                return false; // 错误级别允许输出
            }

            // 检查是否匹配抑制模式
            const isSuppressedPattern = this.categorySuppression[category].suppressedPatterns.some(pattern =>
                message.includes(pattern)
            );

            if (isSuppressedPattern) {
                counter.suppressedPatterns.add(message.split(' ').slice(0, 3).join(' ')); // 记录前3个词作为模式
            }

            // 如果只显示错误且当前不是错误级别，则抑制
            if (this.categorySuppression[category].showErrorOnly && level !== 'error') {
                return true;
            }

            // 检查是否在抑制级别列表中
            if (this.categorySuppression[category].suppressLevels.includes(level)) {
                // 达到批量大小时输出统计
                if (counter.count >= batchConfig.batchSize) {
                    this.outputBatchStats(category, counter);
                    counter.count = 0;
                    counter.suppressedPatterns.clear();
                    counter.lastReport = Date.now();
                }
                return true;
            }

            // 错误级别不受批量模式影响
            return false;
        }

        // 新增：输出批量统计
        outputBatchStats(category, counter) {
            const method = this.nativeMethods.log || function noop() { };
            const patterns = Array.from(counter.suppressedPatterns);
            let summary = '';
            if (patterns.length > 0) {
                summary = patterns.slice(0, 3).join(', ');
                if (patterns.length > 3) {
                    summary = summary + '...';
                }
            }

            if (category === 'DataConsistencyManager') {
                method(`📊 DataConsistencyManager 已处理 ${counter.count} 条数据补充操作`);
            } else {
                method(`📊 ${category} 批量处理完成: ${counter.count} 条操作${summary ? ' - ' + summary : ''}`);
            }
        }

        // 新增：检查重复日志
        checkDuplicateSuppression(category, level, args) {
            if (!this.duplicateDetection.enabled) {
                return false;
            }

            const key = this.generateLogKey(category, level, args);
            const now = Date.now();

            // 获取或创建计数器
            if (!this.suppressionCounters.has(key)) {
                this.suppressionCounters.set(key, {
                    count: 1,
                    firstSeen: now,
                    lastSeen: now
                });
                return false;
            }

            const counter = this.suppressionCounters.get(key);

            // 检查时间窗口
            if (now - counter.firstSeen > this.duplicateDetection.timeWindow) {
                // 重置计数器
                this.suppressionCounters.set(key, {
                    count: 1,
                    firstSeen: now,
                    lastSeen: now
                });
                return false;
            }

            // 增加计数器
            counter.count++;
            counter.lastSeen = now;

            // 如果达到最小抑制计数，则返回 true 进行抑制
            if (counter.count >= this.duplicateDetection.minCount) {
                // 如果是第一次达到阈值，输出抑制通知
                if (counter.count === this.duplicateDetection.minCount) {
                    this.outputDuplicateSuppression(category, counter.count, args);
                }
                return true;
            }

            return false;
        }

        // 新增：输出重复日志抑制通知
        outputDuplicateSuppression(category, count, args) {
            const summary = this.getLogSummary(args);
            const method = this.nativeMethods.log || function noop() { };
            method(`🗝️ 已抑制 ${count - 1} 条重复的 ${category} 日志: ${summary}`);
        }

        output(category, level, args) {
            // 【紧急修复】对 DataConsistencyManager 进行最严格的日志控制
            if (category === 'DataConsistencyManager') {
                const message = args.join(' ').trim();

                // 1. 对于非 error 级别，全部抑制
                if (level !== 'error') {
                    return; // 直接跳过，不输出任何非错误日志
                }

                // 2. 即使是错误级别，也检查是否包含冗余信息
                if (message.includes('开始数据补充') ||
                    message.includes('数据补充完成') ||
                    message.includes('数据验证结果') ||
                    message.includes('生成答案比较数据') ||
                    message.includes('从答案比较计算分数') ||
                    message.includes('开始修复数据不一致问题') ||
                    message.includes('数据修复完成') ||
                    message.includes('数据质量报告') ||
                    message.includes('补充') ||
                    message.includes('完成') ||
                    message.includes('检查') ||
                    message.includes('计算') ||
                    message.includes('生成') ||
                    message.includes('验证')) {
                    return; // 即使是错误级别，如果是这些模式也抑制
                }
            }

            // 【额外修复】直接检查消息内容，全局抑制 DataConsistencyManager 相关日志
            const fullMessage = args.join(' ').trim();
            if (fullMessage.includes('[DataConsistencyManager]')) {
                if (fullMessage.includes('开始数据补充') ||
                    fullMessage.includes('数据补充完成') ||
                    fullMessage.includes('数据验证结果') ||
                    fullMessage.includes('生成答案比较数据') ||
                    fullMessage.includes('从答案比较计算分数') ||
                    fullMessage.includes('开始修复数据不一致问题') ||
                    fullMessage.includes('数据修复完成') ||
                    fullMessage.includes('数据质量报告') ||
                    fullMessage.includes('补充') ||
                    fullMessage.includes('完成') ||
                    fullMessage.includes('检查') ||
                    fullMessage.includes('计算') ||
                    fullMessage.includes('生成') ||
                    fullMessage.includes('验证')) {
                    return; // 强制抑制所有 DataConsistencyManager 冗余日志
                }
            }

            // 首先检查专门抑制机制
            if (this.checkSpecializedSuppression(category, level, args)) {
                return;
            }

            // 【紧急修复】强制检查 shouldLog，跳过所有被限制的日志
            if (!this.shouldLog(category, level)) {
                return; // 直接返回，不调用 noteSuppression
            }

            // 检查重复日志抑制
            if (this.checkDuplicateSuppression(category, level, args)) {
                return;
            }

            // 如果启用了日志分组功能
            if (this.enableGrouping) {
                const key = this.generateLogKey(category, level, args);

                // 检查是否已经有这个日志的折叠组
                if (this.collapsedLogs.has(key)) {
                    const group = this.logGroups.get(key);
                    group.count++;

                    // 如果达到阈值，输出折叠摘要
                    if (group.count === this.groupThreshold) {
                        this.outputCollapsedSummary(category, key, group.count, level, args);
                    }

                    return;
                }

                // 新的日志，检查是否需要开始分组
                if (!this.logGroups.has(key)) {
                    this.logGroups.set(key, {
                        category,
                        level,
                        logs: [],
                        count: 0
                    });
                }

                const group = this.logGroups.get(key);
                group.logs.push({ args, timestamp: Date.now() });
                group.count++;

                // 如果达到阈值，创建折叠组
                if (group.count === this.groupThreshold) {
                    this.collapsedLogs.set(key, group);
                    this.outputCollapsedSummary(category, key, group.count, level, args);
                    return;
                }

                // 如果还没达到阈值，继续累积但不超过最大分组大小
                if (group.count < this.groupThreshold || group.count < this.maxGroupSize) {
                    // 不输出，等待更多相同日志
                    return;
                }

                // 如果超过了最大分组大小，清理并输出
                if (group.count >= this.maxGroupSize) {
                    this.outputCollapsedSummary(category, key, group.count, level, args);
                    this.collapsedLogs.set(key, group);
                    return;
                }
            }

            // 原始输出逻辑（当不启用分组或特殊情况）
            const method = this.methodMap[level] || 'log';
            const target = this.nativeMethods[method] || this.nativeMethods.log;
            target(`[${category}]`, ...args);
        }

        validateLevel(level) {
            if (!level) {
                return null;
            }
            return Object.prototype.hasOwnProperty.call(this.levelMap, level) ? level : null;
        }

        log(category, level, ...args) {
            this.output(category, level, args);
        }

        info(category, ...args) {
            this.log(category, 'info', ...args);
        }

        warn(category, ...args) {
            this.log(category, 'warn', ...args);
        }

        error(category, ...args) {
            this.log(category, 'error', ...args);
        }

        debug(category, ...args) {
            this.log(category, 'debug', ...args);
        }

        createScope(category) {
            return {
                info: (...args) => this.info(category, ...args),
                warn: (...args) => this.warn(category, ...args),
                error: (...args) => this.error(category, ...args),
                debug: (...args) => this.debug(category, ...args)
            };
        }

        setGlobalLevel(level) {
            const validated = this.validateLevel(level);
            if (!validated) {
                return;
            }
            this.globalLevel = validated;
            this.suppressionNotices.clear();
            this.persistConfig();
        }

        setCategoryLevel(category, level) {
            const validated = this.validateLevel(level);
            if (!validated) {
                return;
            }
            this.categoryLevels[category] = validated;
            this.suppressionNotices.delete(category);
            this.persistConfig();
        }

        configure(config = {}) {
            if (config.level) {
                this.setGlobalLevel(config.level);
            }
            if (config.categories && typeof config.categories === 'object') {
                Object.entries(config.categories).forEach(([category, level]) => {
                    this.setCategoryLevel(category, level);
                });
            }

            // 新增：配置分组功能
            if (config.enableGrouping !== undefined) {
                this.enableGrouping = config.enableGrouping;
            }
            if (config.groupThreshold !== undefined) {
                this.groupThreshold = config.groupThreshold;
            }
            if (config.maxGroupSize !== undefined) {
                this.maxGroupSize = config.maxGroupSize;
            }
        }

        resetConfig() {
            this.globalLevel = this.defaultLevel;
            this.categoryLevels = Object.assign({}, this.defaultCategories);
            this.suppressionNotices.clear();
            this.persistConfig();
        }

        getConfig() {
            return {
                level: this.globalLevel,
                categories: Object.assign({}, this.categoryLevels)
            };
        }

        // 新增：调试 DataConsistencyManager 设置
        debugDataConsistencyManagerSettings() {
            const config = this.getConfig();
            console.log('=== DataConsistencyManager 日志设置 ===');
            console.log(`当前级别: ${config.categories['DataConsistencyManager']}`);
            console.log(`是否启用专门抑制: ${this.categorySuppression['DataConsistencyManager']?.enabled}`);
            console.log(`只显示错误: ${this.categorySuppression['DataConsistencyManager']?.showErrorOnly}`);
            console.log('批量模式:', this.categorySuppression['DataConsistencyManager']?.batchMode);
            console.log('抑制模式:', this.categorySuppression['DataConsistencyManager']?.suppressedPatterns);
            console.log('分组统计:', this.getGroupStats());
        }

        // 新增：清理批量统计
        clearBatchStats() {
            const count = this.batchCounters.size;
            this.batchCounters.clear();
            this.nativeMethods.log(`[Logger] 已清理 ${count} 个批量统计计数器`);
        }

        // 新增：获取所有模块的配置
        getAllModuleConfigs() {
            const configs = {};
            Object.keys(this.categorySuppression).forEach(category => {
                const config = this.categorySuppression[category];
                configs[category] = {
                    enabled: config.enabled,
                    showErrorOnly: config.showErrorOnly,
                    suppressLevels: config.suppressLevels,
                    suppressedPatterns: config.suppressedPatterns.length,
                    batchMode: config.batchMode ? {
                        enabled: config.batchMode.enabled,
                        batchSize: config.batchMode.batchSize
                    } : null
                };
            });
            return configs;
        }
    }

    const logger = new AppLogger(global.__APP_LOG_CONFIG || {});
    global.AppLogger = logger;
})(typeof window !== 'undefined' ? window : undefined);