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
        return function noop() {};
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
                Storage: 'warn',
                DataConsistencyManager: 'warn',
                PerformanceOptimizer: 'warn',
                System: 'info',
                PracticeRecorder: 'info',
                ScoreStorage: 'info'
            };
            this.suppressionNotices = new Set();
            const initialConfig = this.mergeConfig(externalConfig);
            this.globalLevel = initialConfig.level;
            this.categoryLevels = initialConfig.categories;
            this.overrideConsole();
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
            } catch (_) {}

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
            } catch (_) {}
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
            return this.levelValue(level) <= this.levelValue(this.getCategoryLevel(category));
        }

        noteSuppression(category) {
            if (this.suppressionNotices.has(category)) {
                return;
            }
            this.suppressionNotices.add(category);
            const notifier = this.nativeMethods.log || function noop() {};
            notifier(
                `[Logger] ${category} 日志已折叠（当前级别: ${this.getCategoryLevel(category)}）。` +
                ` 执行 window.AppLogger.setCategoryLevel('${category}','info') 以查看详细输出。`
            );
        }

        output(category, level, args) {
            if (!this.shouldLog(category, level)) {
                this.noteSuppression(category);
                return;
            }
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
    }

    const logger = new AppLogger(global.__APP_LOG_CONFIG || {});
    global.AppLogger = logger;
})(typeof window !== 'undefined' ? window : undefined);
