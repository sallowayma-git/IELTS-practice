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
    const UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const MAX_CATEGORY_CONFIG_ENTRIES = 80;
    const MAX_CATEGORY_NAME_LENGTH = 80;
    const MAX_LOG_ARG_DEPTH = 6;
    const MAX_LOG_ARRAY_ITEMS = 50;
    const MAX_LOG_OBJECT_KEYS = 80;
    const MAX_LOG_STRING_LENGTH = 1000;
    const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
    const SENSITIVE_LOG_KEYS = new Set([
        'access_token',
        'answer',
        'answercomparison',
        'answers',
        'authorization',
        'correctanswer',
        'correctanswers',
        'csrftoken',
        'examid',
        'interactions',
        'newpassword',
        'oldpassword',
        'password',
        'payload',
        'realdata',
        'recordid',
        'recoverycode',
        'recoverycodes',
        'raw',
        'secret',
        'session',
        'sessionid',
        'sid',
        'suiteid',
        'suitesessionid',
        'token',
        'totp',
        'useranswer',
        'userinput'
    ]);

    function isPlainRecord(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }

    function normalizeLogLevel(level, fallback = '') {
        if (typeof level !== 'string') {
            return fallback;
        }
        const normalized = level.trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(LOG_LEVELS, normalized)
            ? normalized
            : fallback;
    }

    function normalizeCategoryName(category) {
        if (typeof category !== 'string') {
            return '';
        }
        const normalized = category.trim();
        if (!normalized || normalized.length > MAX_CATEGORY_NAME_LENGTH) {
            return '';
        }
        if (UNSAFE_CONFIG_KEYS.has(normalized) || CONTROL_CHAR_PATTERN.test(normalized)) {
            return '';
        }
        return normalized;
    }

    function normalizeCategoryLevels(categories) {
        if (!isPlainRecord(categories)) {
            return {};
        }

        const normalized = {};
        for (const [rawCategory, rawLevel] of Object.entries(categories).slice(0, MAX_CATEGORY_CONFIG_ENTRIES)) {
            const category = normalizeCategoryName(rawCategory);
            const level = normalizeLogLevel(rawLevel);
            if (category && level) {
                normalized[category] = level;
            }
        }
        return normalized;
    }

    function normalizeLogKey(key) {
        return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    }

    function isSensitiveLogKey(key) {
        const normalized = normalizeLogKey(key);
        if (!normalized) {
            return false;
        }
        return SENSITIVE_LOG_KEYS.has(normalized)
            || normalized.endsWith('token')
            || normalized.endsWith('secret')
            || normalized.endsWith('password')
            || normalized.endsWith('sessionid')
            || normalized.endsWith('recordid');
    }

    function sanitizeLogString(value) {
        let text = String(value);
        text = text.replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, '[local-path]');
        text = text.replace(/\\\\[^\\/\s"'<>]+\\[^\s"'<>]+/g, '[local-path]');
        text = text.replace(/[a-z2-7]{16,56}\.onion\b/gi, '[onion-host]');
        text = text.replace(
            /([?&](?:access_token|code|csrf|csrfToken|password|secret|session|sessionId|sid|token)=)[^&#\s]+/gi,
            '$1[redacted]'
        );
        text = text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[redacted-auth]');
        if (text.length > MAX_LOG_STRING_LENGTH) {
            return `${text.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated]`;
        }
        return text;
    }

    function sanitizeLogArg(value, depth = 0, seen = new WeakSet()) {
        if (value == null) {
            return value;
        }
        if (typeof value === 'string') {
            return sanitizeLogString(value);
        }
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
            return value;
        }
        if (typeof value === 'symbol' || typeof value === 'function') {
            return `[${typeof value}]`;
        }
        if (depth > MAX_LOG_ARG_DEPTH) {
            return '[MaxDepth]';
        }
        if (typeof value !== 'object') {
            return sanitizeLogString(value);
        }
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);
        if (value instanceof Error) {
            return {
                name: sanitizeLogString(value.name || 'Error'),
                message: sanitizeLogString(value.message || ''),
                stack: value.stack ? sanitizeLogString(value.stack) : undefined
            };
        }
        if (Array.isArray(value)) {
            const output = value
                .slice(0, MAX_LOG_ARRAY_ITEMS)
                .map((item) => sanitizeLogArg(item, depth + 1, seen));
            if (value.length > MAX_LOG_ARRAY_ITEMS) {
                output.push(`[${value.length - MAX_LOG_ARRAY_ITEMS} more items]`);
            }
            return output;
        }
        if (!isPlainRecord(value)) {
            return sanitizeLogString(Object.prototype.toString.call(value));
        }
        const output = {};
        const entries = Object.entries(value).slice(0, MAX_LOG_OBJECT_KEYS);
        for (const [key, item] of entries) {
            if (UNSAFE_CONFIG_KEYS.has(key)) {
                continue;
            }
            output[key] = isSensitiveLogKey(key)
                ? '[redacted]'
                : sanitizeLogArg(item, depth + 1, seen);
        }
        const totalKeys = Object.keys(value).length;
        if (totalKeys > MAX_LOG_OBJECT_KEYS) {
            output.__truncatedKeys = totalKeys - MAX_LOG_OBJECT_KEYS;
        }
        return output;
    }

    function sanitizeLogArgs(args) {
        return Array.isArray(args) ? args.map((arg) => sanitizeLogArg(arg)) : [];
    }

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
                    const parsed = JSON.parse(stored);
                    storedConfig = isPlainRecord(parsed) ? parsed : {};
                }
            } catch (e) {
                // Ignore storage errors
            }

            const safeExternalConfig = isPlainRecord(externalConfig) ? externalConfig : {};
            const storedLevel = normalizeLogLevel(storedConfig.level, DEFAULT_CONFIG.level);
            const externalLevel = normalizeLogLevel(safeExternalConfig.level, storedLevel);

            return {
                level: externalLevel,
                categories: {
                    ...DEFAULT_CONFIG.categories,
                    ...normalizeCategoryLevels(storedConfig.categories),
                    ...normalizeCategoryLevels(safeExternalConfig.categories)
                }
            };
        }

        /**
         * Save current configuration to localStorage
         */
        saveConfig() {
            try {
                this.config = {
                    level: normalizeLogLevel(this.config.level, DEFAULT_CONFIG.level),
                    categories: {
                        ...DEFAULT_CONFIG.categories,
                        ...normalizeCategoryLevels(this.config.categories)
                    }
                };
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
            const prefix = `[${timestamp}] [${sanitizeLogString(category)}]`;
            const safeArgs = sanitizeLogArgs(args);

            // Map our levels to console methods
            const consoleMethod = this.nativeConsole[level] || this.nativeConsole.log;

            // Use native console to print sanitized values while preserving useful object structure.
            consoleMethod.call(global.console, prefix, ...safeArgs);
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
            const normalized = normalizeLogLevel(level);
            if (normalized) {
                this.config.level = normalized;
                this.saveConfig();
                this.internalLog('info', `Global log level set to: ${normalized}`);
            } else {
                this.internalLog('warn', `Invalid log level: ${level}`);
            }
        }

        /**
         * Update category specific log level
         */
        setCategoryLevel(category, level) {
            const normalizedCategory = normalizeCategoryName(category);
            const normalizedLevel = normalizeLogLevel(level);
            if (normalizedCategory && normalizedLevel) {
                this.config.categories[normalizedCategory] = normalizedLevel;
                this.saveConfig();
                this.internalLog('info', `Category '${normalizedCategory}' log level set to: ${normalizedLevel}`);
            } else {
                this.internalLog('warn', `Invalid category or log level: ${category}=${level}`);
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
