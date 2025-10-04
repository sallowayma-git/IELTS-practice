const logger = require('../services/logger')

/**
 * 全局错误处理中间件
 */
class ErrorHandler {
  constructor() {
    this.defaultError = {
      success: false,
      message: '服务器内部错误',
      code: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date().toISOString()
    }
  }

  /**
   * 处理异步错误
   */
  handleAsync(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next)
    }
  }

  /**
   * 错误处理中间件
   */
  middleware() {
    return (err, req, res, next) => {
      // 如果是Promise rejection但没有被捕获，包装成Error对象
      if (err instanceof Error === false && err.stack) {
        err = new Error(err)
      }

      // 异步记录错误日志
      this.logError(err, req).catch(logError => {
        console.error('记录错误日志失败:', logError)
      })

      // 构建错误响应
      const errorResponse = this.buildErrorResponse(err, req)

      // 发送响应
      res.status(errorResponse.status).json(errorResponse.body)
    }
  }

  /**
   * 记录错误日志
   */
  async logError(err, req) {
    try {
      await logger.error('请求处理错误', err, {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        params: req.params,
        query: req.query,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      })
    } catch (logError) {
      console.error('记录错误日志失败:', logError)
    }
  }

  /**
   * 构建错误响应
   */
  buildErrorResponse(err, req) {
    let status = 500
    let body = { ...this.defaultError }

    // 根据错误类型设置状态码和消息
    if (err.name === 'ValidationError') {
      status = 400
      body = {
        success: false,
        message: '请求参数验证失败',
        code: 'VALIDATION_ERROR',
        details: err.message,
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'UnauthorizedError') {
      status = 401
      body = {
        success: false,
        message: '未授权访问',
        code: 'UNAUTHORIZED',
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'ForbiddenError') {
      status = 403
      body = {
        success: false,
        message: '禁止访问',
        code: 'FORBIDDEN',
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'NotFoundError') {
      status = 404
      body = {
        success: false,
        message: '资源不存在',
        code: 'NOT_FOUND',
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'ConflictError') {
      status = 409
      body = {
        success: false,
        message: '资源冲突',
        code: 'CONFLICT',
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'RateLimitError') {
      status = 429
      body = {
        success: false,
        message: '请求过于频繁',
        code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'AIError') {
      status = 502
      body = {
        success: false,
        message: 'AI服务暂时不可用',
        code: 'AI_SERVICE_ERROR',
        details: err.message,
        timestamp: new Date().toISOString()
      }
    } else if (err.name === 'DatabaseError') {
      status = 503
      body = {
        success: false,
        message: '数据库服务暂时不可用',
        code: 'DATABASE_ERROR',
        timestamp: new Date().toISOString()
      }
    } else if (err.status) {
      status = err.status
      body = {
        success: false,
        message: err.message || '请求失败',
        code: this.getErrorCodeFromStatus(status),
        timestamp: new Date().toISOString()
      }
    }

    // 开发环境下包含错误堆栈
    if (process.env.NODE_ENV === 'development') {
      body.stack = err.stack
      body.originalError = err
    }

    return { status, body }
  }

  /**
   * 根据状态码获取错误代码
   */
  getErrorCodeFromStatus(status) {
    const statusMap = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT'
    }

    return statusMap[status] || 'UNKNOWN_ERROR'
  }

  /**
   * 创建自定义错误
   */
  static createError(message, name = 'AppError', status = 500) {
    const error = new Error(message)
    error.name = name
    error.status = status
    return error
  }

  /**
   * 创建验证错误
   */
  static createValidationError(message) {
    return this.createError(message, 'ValidationError', 400)
  }

  /**
   * 创建未授权错误
   */
  static createUnauthorizedError(message = '未授权访问') {
    return this.createError(message, 'UnauthorizedError', 401)
  }

  /**
   * 创建禁止访问错误
   */
  static createForbiddenError(message = '禁止访问') {
    return this.createError(message, 'ForbiddenError', 403)
  }

  /**
   * 创建资源不存在错误
   */
  static createNotFoundError(message = '资源不存在') {
    return this.createError(message, 'NotFoundError', 404)
  }

  /**
   * 创建冲突错误
   */
  static createConflictError(message = '资源冲突') {
    return this.createError(message, 'ConflictError', 409)
  }

  /**
   * 创建速率限制错误
   */
  static createRateLimitError(message = '请求过于频繁') {
    return this.createError(message, 'RateLimitError', 429)
  }

  /**
   * 创建AI服务错误
   */
  static createAIError(message = 'AI服务错误') {
    return this.createError(message, 'AIError', 502)
  }

  /**
   * 创建数据库错误
   */
  static createDatabaseError(message = '数据库错误') {
    return this.createError(message, 'DatabaseError', 503)
  }
}

// 创建错误处理器实例
const errorHandler = new ErrorHandler()

module.exports = errorHandler