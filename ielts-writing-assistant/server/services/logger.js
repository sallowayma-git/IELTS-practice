/**
 * 日志服务
 */
class Logger {
  constructor() {
    this.levels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    }

    this.currentLevel = process.env.NODE_ENV === 'development'
      ? this.levels.DEBUG
      : this.levels.INFO

    this.logToDatabase = true
  }

  /**
   * 记录错误日志
   */
  async error(message, error = null, context = {}) {
    await this.log('ERROR', message, error, context)
  }

  /**
   * 记录警告日志
   */
  async warn(message, context = {}) {
    await this.log('WARN', message, null, context)
  }

  /**
   * 记录信息日志
   */
  async info(message, context = {}) {
    await this.log('INFO', message, null, context)
  }

  /**
   * 记录调试日志
   */
  async debug(message, context = {}) {
    await this.log('DEBUG', message, null, context)
  }

  /**
   * 通用日志记录方法
   */
  async log(level, message, error = null, context = {}) {
    const timestamp = new Date().toISOString()
    const logEntry = {
      timestamp,
      level,
      message,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : null,
      context: {
        ...context,
        userAgent: context.userAgent,
        ip: context.ip,
        userId: context.userId,
        requestId: context.requestId
      }
    }

    // 控制台输出
    this.consoleLog(level, logEntry)

    // 数据库记录
    if (this.logToDatabase && this.shouldLogToDatabase(level)) {
      await this.logToDatabaseEntry(logEntry)
    }
  }

  /**
   * 控制台输出
   */
  consoleLog(level, entry) {
    if (this.levels[level] > this.currentLevel) return

    const { timestamp, message, error, context } = entry
    const logString = `[${timestamp}] ${level}: ${message}`

    switch (level) {
      case 'ERROR':
        console.error(logString, error || '', context)
        break
      case 'WARN':
        console.warn(logString, context)
        break
      case 'INFO':
        console.info(logString, context)
        break
      case 'DEBUG':
        console.debug(logString, context)
        break
    }
  }

  /**
   * 是否应该记录到数据库
   */
  shouldLogToDatabase(level) {
    return this.levels[level] <= this.levels.WARN
  }

  /**
   * 记录到数据库
   */
  async logToDatabaseEntry(entry) {
    // 这里需要在有数据库连接时调用
    // 暂时跳过，后续会在服务中集成
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    this.currentLevel = this.levels[level.toUpperCase()]
  }

  /**
   * 启用/禁用数据库日志
   */
  setLogToDatabase(enabled) {
    this.logToDatabase = enabled
  }

  /**
   * 格式化错误信息
   */
  formatError(error, context = {}) {
    return {
      message: error.message,
      stack: error.stack,
      code: error.code,
      status: error.status,
      context
    }
  }
}

// 创建全局日志实例
const logger = new Logger()

module.exports = logger