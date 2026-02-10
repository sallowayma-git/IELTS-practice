const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 日志级别
 */
const LogLevel = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

/**
 * 日志级别优先级 (数值越小优先级越高)
 */
const LogLevelPriority = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

/**
 * 统一日志管理器
 * 
 * 功能:
 * - 分级日志 (error/warn/info/debug)
 * - 文件滚动 (按天 + 大小限制 50MB)
 * - sessionId 关联 trace
 * - 控制台输出 (开发环境)
 */
class Logger {
    constructor() {
        this.currentLevel = process.env.NODE_ENV === 'development'
            ? LogLevel.DEBUG
            : LogLevel.INFO;

        this.maxFileSize = 50 * 1024 * 1024; // 50MB
        this.logsDir = null;
        this.currentLogFile = null;
        this.currentDate = null;

        this._initializeLogsDirectory();
    }

    /**
     * 初始化日志目录
     */
    _initializeLogsDirectory() {
        try {
            // app.getPath 只能在 app ready 后调用
            // 如果 app 未 ready，延迟初始化
            // 注意：app.isReady 是方法调用，需确保 app 模块已加载
            if (typeof app !== 'undefined' && app.isReady && !app.isReady()) {
                app.once('ready', () => this._initializeLogsDirectory());
                return;
            }

            // 如果 app 不可用（非 Electron 环境），使用临时目录
            if (typeof app === 'undefined' || !app.isReady || !app.isReady()) {
                this.logsDir = path.join(process.cwd(), 'logs');
                if (!fs.existsSync(this.logsDir)) {
                    fs.mkdirSync(this.logsDir, { recursive: true });
                }
                this._updateLogFile();
                return;
            }

            this.logsDir = path.join(app.getPath('userData'), 'logs');

            if (!fs.existsSync(this.logsDir)) {
                fs.mkdirSync(this.logsDir, { recursive: true });
            }

            this._updateLogFile();
        } catch (error) {
            console.error('Failed to initialize logs directory:', error);
        }
    }

    /**
     * 更新当前日志文件
     */
    _updateLogFile() {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        if (this.currentDate !== today) {
            this.currentDate = today;
            this.currentLogFile = path.join(this.logsDir, `app-${today}.log`);
        }

        // 检查文件大小，超过限制则轮转
        if (fs.existsSync(this.currentLogFile)) {
            const stats = fs.statSync(this.currentLogFile);
            if (stats.size > this.maxFileSize) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedFile = path.join(
                    this.logsDir,
                    `app-${today}-${timestamp}.log`
                );
                fs.renameSync(this.currentLogFile, rotatedFile);
            }
        }
    }

    /**
     * 格式化日志消息
     */
    _formatMessage(level, message, sessionId = null, meta = null) {
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const sessionPart = sessionId ? ` [${sessionId}]` : '';
        const metaPart = meta ? ` ${JSON.stringify(meta)}` : '';

        return `[${timestamp}] [${level}]${sessionPart} ${message}${metaPart}`;
    }

    /**
     * 写入日志
     */
    _write(level, message, sessionId = null, meta = null) {
        // 检查日志级别
        if (LogLevelPriority[level] > LogLevelPriority[this.currentLevel]) {
            return; // 忽略低优先级日志
        }

        const formattedMessage = this._formatMessage(level, message, sessionId, meta);

        // 控制台输出
        if (process.env.NODE_ENV === 'development') {
            const consoleMethod = level === LogLevel.ERROR ? 'error'
                : level === LogLevel.WARN ? 'warn'
                    : 'log';
            console[consoleMethod](formattedMessage);
        }

        // 文件输出
        if (this.currentLogFile) {
            try {
                this._updateLogFile(); // 检查是否需要轮转
                fs.appendFileSync(this.currentLogFile, formattedMessage + '\n', 'utf-8');
            } catch (error) {
                console.error('Failed to write log file:', error);
            }
        }
    }

    /**
     * 错误日志
     */
    error(message, error = null, sessionId = null) {
        const meta = error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
        } : null;

        this._write(LogLevel.ERROR, message, sessionId, meta);
    }

    /**
     * 警告日志
     */
    warn(message, sessionId = null, meta = null) {
        this._write(LogLevel.WARN, message, sessionId, meta);
    }

    /**
     * 信息日志
     */
    info(message, sessionId = null, meta = null) {
        this._write(LogLevel.INFO, message, sessionId, meta);
    }

    /**
     * 调试日志
     */
    debug(message, sessionId = null, meta = null) {
        this._write(LogLevel.DEBUG, message, sessionId, meta);
    }

    /**
     * 设置日志级别
     */
    setLevel(level) {
        if (LogLevelPriority[level] !== undefined) {
            this.currentLevel = level;
            this.info(`Log level set to: ${level}`);
        }
    }

    /**
     * 获取日志目录路径
     */
    getLogsDirectory() {
        return this.logsDir;
    }
}

// 导出单例
const logger = new Logger();
module.exports = logger;
