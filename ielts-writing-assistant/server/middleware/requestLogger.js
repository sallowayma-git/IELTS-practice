const logger = require('../services/logger')
const { v4: uuidv4 } = require('uuid')

/**
 * 请求日志中间件
 */
function requestLogger() {
  return (req, res, next) => {
    // 生成请求ID
    const requestId = uuidv4()
    req.requestId = requestId

    // 记录请求开始时间
    const startTime = Date.now()

    // 提取客户端信息
    const clientInfo = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer')
    }

    // 记录请求开始
    logger.info(`请求开始: ${req.method} ${req.url}`, {
      requestId,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      client: clientInfo
    })

    // 监听响应结束事件
    res.on('finish', async () => {
      const duration = Date.now() - startTime
      const logLevel = res.statusCode >= 400 ? 'ERROR' : 'INFO'

      await logger.log(logLevel, `请求完成: ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`, null, {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        client: clientInfo,
        responseSize: res.get('Content-Length')
      })
    })

    next()
  }
}

module.exports = requestLogger