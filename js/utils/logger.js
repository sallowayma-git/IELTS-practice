(function initAppLogger(global) {
    if (!global) {
        return;
    }

    // Prevent double initialization
    if (global.AppLogger) {
        return;
    }

    const STORAGE_KEY = 'exam_system_log_config_v2';

    // Default configuration
    const DEFAULT_CONFIG = {
        level: 'info',
        categories: {
            'Storage': 'error',
            'DataConsistencyManager': 'warn', // Reduced noise
            'PerformanceOptimizer': 'warn',
            'System': 'info',
            'PracticeRecorder': 'info',
            'ScoreStorage': 'info'
        }
    };

    // Log levels with numeric values for comparison
    const LOG_LEVELS = {
        error: 0,
        warn: 1,
        info: 2,
        debug: 3,
        trace: 4
    };

    class AppLogger {
        constructor(config = {}) {
            this.nativeConsole = { ...global.console }; // Backup native methods
            this.config = this.loadConfig(config);

            // Bind methods to ensure 'this' context
            this.log = this.log.bind(this);
            this.info = this.info.bind(this);
            this.warn = this.warn.bind(this);
            this.error = this.error.bind(this);
            this.debug = this.debug.bind(this);

            this.overrideConsole();

            // Output initialization message
            this.internalLog('info', 'Logger initialized', {
                level: this.config.level,
                categories: this.config.categories
            });
        }

        /**
         * Load configuration from localStorage or use defaults
         */
        loadConfig(externalConfig) {
            let storedConfig = {};
            try {
                const stored = global.localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    storedConfig = JSON.parse(stored);
                }
            } catch (e) {
                // Ignore storage errors
            }

            return {
                level: externalConfig.level || storedConfig.level || DEFAULT_CONFIG.level,
                categories: {
                    ...DEFAULT_CONFIG.categories,
                    ...(storedConfig.categories || {}),
                    ...(externalConfig.categories || {})
                }
            };
        }

        /**
         * Save current configuration to localStorage
         */
        saveConfig() {
            try {
                global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    level: this.config.level,
                    categories: this.config.categories
                }));
            } catch (e) {
                // Ignore storage errors
            }
        }

        /**
         * Override global console methods to route through our logger
         * This allows capturing logs from libraries or code using console.log directly
         */
        overrideConsole() {
            const methods = ['log', 'info', 'warn', 'error', 'debug'];

            methods.forEach(method => {
                // We only override if the native console has this method
                if (this.nativeConsole[method]) {
                    global.console[method] = (...args) => {
                        // Try to extract category from "[Category] message" format
                        const categoryInfo = this.extractCategory(args);

                        if (categoryInfo) {
                            const level = method === 'log' ? 'info' : method;
                            this.output(categoryInfo.category, level, categoryInfo.args);
                        } else {
                            // It's a raw console log, pass through to native
                            this.nativeConsole[method].apply(global.console, args);
                        }
                    };
                }
            });
        }

        /**
         * Extract category from arguments if the first argument is "[Category]"
         */
        extractCategory(args) {
            if (args.length > 0 && typeof args[0] === 'string') {
                const match = args[0].match(/^\[(.*?)\]\s*(.*)$/);

                if (match) {
                    const category = match[1];
                    const restOfMessage = match[2];

                    const newArgs = [...args];

                    if (restOfMessage && restOfMessage.length > 0) {
                        newArgs[0] = restOfMessage;
                    } else {
                        newArgs.shift();
                    }

                    return {
                        category: category,
                        args: newArgs
                    };
                }
            }
            return null;
        }

        /**
         * Check if a log should be output based on levels
         */
        shouldLog(category, level) {
            const msgLevelVal = LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.info;

            let configLevel = this.config.categories[category];

            if (!configLevel) {
                configLevel = this.config.level;
            }

            const configLevelVal = LOG_LEVELS[configLevel] !== undefined ? LOG_LEVELS[configLevel] : LOG_LEVELS.info;

            return msgLevelVal <= configLevelVal;
        }

        /**
         * Core output method
         */
        output(category, level, args) {
            if (!this.shouldLog(category, level)) {
                return;
            }

            const timestamp = new Date().toLocaleTimeString();
            const prefix = `[${timestamp}] [${category}]`;

            // Map our levels to console methods
            const consoleMethod = this.nativeConsole[level] || this.nativeConsole.log;

            // Use native console to print, preserving object inspection capabilities
            consoleMethod.call(global.console, prefix, ...args);
        }

        /**
         * Internal helper to log without routing through the override logic again
         */
        internalLog(level, message, data) {
            const consoleMethod = this.nativeConsole[level] || this.nativeConsole.log;
            if (data) {
                consoleMethod.call(global.console, `[Logger] ${message}`, data);
            } else {
                consoleMethod.call(global.console, `[Logger] ${message}`);
            }
        }

        // --- Public API ---

        log(category, level, ...args) {
            this.output(category, level, args);
        }

        info(category, ...args) {
            this.output(category, 'info', args);
        }

        warn(category, ...args) {
            this.output(category, 'warn', args);
        }

        error(category, ...args) {
            this.output(category, 'error', args);
        }

        debug(category, ...args) {
            this.output(category, 'debug', args);
        }

        /**
         * Create a scoped logger for a specific category
         */
        createScope(category) {
            return {
                info: (...args) => this.info(category, ...args),
                warn: (...args) => this.warn(category, ...args),
                error: (...args) => this.error(category, ...args),
                debug: (...args) => this.debug(category, ...args),
                log: (level, ...args) => this.log(category, level, ...args)
            };
        }

        /**
         * Update global log level
         */
        setGlobalLevel(level) {
            if (LOG_LEVELS[level] !== undefined) {
                this.config.level = level;
                this.saveConfig();
                this.internalLog('info', `Global log level set to: ${level}`);
            } else {
                this.internalLog('warn', `Invalid log level: ${level}`);
            }
        }

        /**
         * Update category specific log level
         */
        setCategoryLevel(category, level) {
            if (LOG_LEVELS[level] !== undefined) {
                this.config.categories[category] = level;
                this.saveConfig();
                this.internalLog('info', `Category '${category}' log level set to: ${level}`);
            } else {
                this.internalLog('warn', `Invalid log level: ${level}`);
            }
        }

        /**
         * Get current configuration
         */
        getConfig() {
            return JSON.parse(JSON.stringify(this.config));
        }

        /**
         * Reset configuration to defaults
         */
        resetConfig() {
            this.config = {
                level: DEFAULT_CONFIG.level,
                categories: { ...DEFAULT_CONFIG.categories }
            };
            this.saveConfig();
            this.internalLog('info', 'Configuration reset to defaults');
        }
    }

    // Initialize and expose
    global.AppLogger = new AppLogger(global.__APP_LOG_CONFIG || {});

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
