/**
 * Honest Error Handler - 诚实的错误处理系统
 *
 * 替代原有的 try/catch(_){} 模式，确保错误能被正确记录和处理
 * 遵循 fail-fast 原则，不隐藏任何错误
 */

window.ErrorHandler = class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
    this.observers = [];
    this.globalHandlers = {};

    console.log('[ErrorHandler] 初始化诚实错误处理器');
  }

  /**
   * 初始化错误处理器
   */
  initialize() {
    this.setupGlobalHandlers();
    this.setupUncaughtRejectionHandler();
    this.setupConsoleOverrides();

    console.log('[ErrorHandler] ✅ 错误处理器初始化完成');
  }

  /**
   * 设置全局错误处理器
   */
  setupGlobalHandlers() {
    // 处理未捕获的JavaScript错误
    window.addEventListener('error', (event) => {
      this.handleError(event.error, {
        type: 'uncaught_error',
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });
    });

    // 处理未处理的Promise拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: 'unhandled_promise_rejection',
        promise: event.promise
      });
    });
  }

  /**
   * 设置未捕获拒绝处理器
   */
  setupUncaughtRejectionHandler() {
    if (typeof process !== 'undefined' && process.on) {
      process.on('unhandledRejection', (reason, promise) => {
        this.handleError(reason, {
          type: 'node_unhandled_rejection',
          promise
        });
      });
    }
  }

  /**
   * 重写console.error以确保所有错误都被记录
   */
  setupConsoleOverrides() {
    const originalError = console.error;
    const self = this;

    console.error = function(...args) {
      // 调用原始方法
      originalError.apply(console, args);

      // 同时记录到我们的错误系统
      const error = new Error(args.join(' '));
      self.handleError(error, {
        type: 'console_error',
        arguments: args
      });
    };
  }

  /**
   * 主要的错误处理方法
   */
  handleError(error, context = {}) {
    // 确保error是一个Error对象
    const errorObj = this.normalizeError(error);

    // 创建错误记录
    const errorRecord = {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      error: errorObj,
      context,
      userAgent: navigator.userAgent,
      url: window.location.href,
      // 添加应用状态
      appState: this.getAppState()
    };

    // 记录错误
    this.logError(errorRecord);

    // 通知观察者
    this.notifyObservers(errorRecord);

    // 根据错误严重性决定是否显示给用户
    if (this.shouldShowToUser(errorRecord)) {
      this.showToUser(errorRecord);
    }

    // 对于严重错误，考虑是否需要恢复应用状态
    if (this.isCriticalError(errorRecord)) {
      this.handleCriticalError(errorRecord);
    }

    return errorRecord;
  }

  /**
   * 规范化错误对象
   */
  normalizeError(error) {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    if (error && typeof error === 'object') {
      // 尝试从对象中提取错误信息
      const message = error.message || error.error || JSON.stringify(error);
      const normalizedError = new Error(message);

      // 保留原始对象的属性
      Object.keys(error).forEach(key => {
        normalizedError[key] = error[key];
      });

      return normalizedError;
    }

    // 未知类型的错误
    return new Error(`Unknown error type: ${typeof error}`);
  }

  /**
   * 记录错误到日志
   */
  logError(errorRecord) {
    this.errorLog.push(errorRecord);

    // 限制日志大小
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // 持久化到存储
    this.persistErrorLog();

    // 输出到控制台（详细版本）
    console.group(`🚨 [${errorRecord.id}] ${errorRecord.error.message}`);
    console.error('Error:', errorRecord.error);
    console.log('Context:', errorRecord.context);
    console.log('Timestamp:', errorRecord.timestamp);
    console.log('URL:', errorRecord.url);
    console.groupEnd();
  }

  /**
   * 持久化错误日志
   */
  async persistErrorLog() {
    try {
      if (window.storage) {
        await window.storage.set('error_log', {
          errors: this.errorLog,
          lastUpdated: new Date().toISOString()
        });
      } else {
        // 降级到localStorage
        localStorage.setItem('error_log', JSON.stringify({
          errors: this.errorLog,
          lastUpdated: new Date().toISOString()
        }));
      }
    } catch (e) {
      // 如果持久化失败，至少保证内存中有记录
      console.warn('[ErrorHandler] 无法持久化错误日志:', e);
    }
  }

  /**
   * 通知所有观察者
   */
  notifyObservers(errorRecord) {
    this.observers.forEach(observer => {
      try {
        observer(errorRecord);
      } catch (e) {
        console.error('[ErrorHandler] 观察者通知失败:', e);
      }
    });
  }

  /**
   * 判断错误是否需要显示给用户
   */
  shouldShowToUser(errorRecord) {
    // 网络错误、权限错误等通常需要显示给用户
    const criticalErrorTypes = [
      'network_error',
      'permission_denied',
      'storage_quota_exceeded',
      'authentication_failed'
    ];

    return criticalErrorTypes.includes(errorRecord.context.type) ||
           errorRecord.context.userFacing ||
           this.isCriticalError(errorRecord);
  }

  /**
   * 显示错误给用户
   */
  showToUser(errorRecord) {
    let message = '操作失败，请稍后重试';
    let type = 'error';

    // 根据错误类型提供更友好的消息
    switch (errorRecord.context.type) {
      case 'network_error':
        message = '网络连接失败，请检查网络设置';
        type = 'warning';
        break;
      case 'storage_quota_exceeded':
        message = '存储空间不足，请清理后重试';
        type = 'warning';
        break;
      case 'permission_denied':
        message = '权限不足，请检查浏览器设置';
        type = 'warning';
        break;
      default:
        if (errorRecord.error.message.includes('Failed to fetch')) {
          message = '网络请求失败，请检查网络连接';
          type = 'warning';
        }
    }

    // 使用全局消息系统显示
    if (window.showMessage) {
      window.showMessage(message, type, 5000);
    } else {
      alert(message);
    }
  }

  /**
   * 判断是否为严重错误
   */
  isCriticalError(errorRecord) {
    const criticalPatterns = [
      /storage.*quota/i,
      /memory.*leak/i,
      /script.*error/i,
      /security/i,
      /permission/i,
      /network/i
    ];

    return criticalPatterns.some(pattern =>
      pattern.test(errorRecord.error.message) ||
      pattern.test(JSON.stringify(errorRecord.context))
    );
  }

  /**
   * 处理严重错误
   */
  handleCriticalError(errorRecord) {
    console.warn('[ErrorHandler] 检测到严重错误:', errorRecord);

    // 可以在这里实现自动恢复逻辑
    // 例如：重置应用状态、清除缓存、重新初始化等

    // 暂时只记录日志
    this.markAsCritical(errorRecord);
  }

  /**
   * 标记错误为严重
   */
  markAsCritical(errorRecord) {
    errorRecord.critical = true;
    console.error('🚨🚨 严重错误 🚨🚨:', errorRecord);
  }

  /**
   * 生成错误ID
   */
  generateErrorId() {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取应用状态
   */
  getAppState() {
    return {
      stores: window.app ? Object.keys(window.app.stores) : [],
      components: window.app ? Object.keys(window.app.components) : [],
      currentView: window.app?.stores?.appStore?.getCurrentView() || 'unknown',
      memory: performance.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + 'MB',
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + 'MB'
      } : 'N/A'
    };
  }

  /**
   * 添加错误观察者
   */
  subscribe(observer) {
    if (typeof observer === 'function') {
      this.observers.push(observer);
    }
  }

  /**
   * 移除错误观察者
   */
  unsubscribe(observer) {
    const index = this.observers.indexOf(observer);
    if (index > -1) {
      this.observers.splice(index, 1);
    }
  }

  /**
   * 获取错误日志
   */
  getErrorLog() {
    return [...this.errorLog];
  }

  /**
   * 获取错误统计
   */
  getErrorStats() {
    const stats = {
      total: this.errorLog.length,
      critical: this.errorLog.filter(e => e.critical).length,
      byType: {},
      byHour: {}
    };

    this.errorLog.forEach(record => {
      // 按类型统计
      const type = record.context.type || 'unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      // 按小时统计
      const hour = new Date(record.timestamp).getHours();
      stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
    });

    return stats;
  }

  /**
   * 清除错误日志
   */
  clearErrorLog() {
    this.errorLog = [];
    if (window.storage) {
      window.storage.remove('error_log');
    } else {
      localStorage.removeItem('error_log');
    }
    console.log('[ErrorHandler] 错误日志已清除');
  }

  /**
   * 导出错误日志
   */
  exportErrorLog() {
    const exportData = {
      log: this.errorLog,
      stats: this.getErrorStats(),
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-log-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};

// 创建全局错误处理器实例
window.errorHandler = window.errorHandler || new window.ErrorHandler();

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
  window.errorHandler.initialize();
});

// 提供全局的诚实错误处理函数
window.handleError = function(error, context = {}) {
  return window.errorHandler.handleError(error, context);
};

// 提供安全的异步包装器，替代 try/catch(_)
window.safely = async function(fn, context = {}) {
  try {
    return await fn();
  } catch (error) {
    window.errorHandler.handleError(error, context);
    // 重新抛出错误以便调用者可以处理
    throw error;
  }
};

// 提供安全的同步包装器
window.safelySync = function(fn, context = {}) {
  try {
    return fn();
  } catch (error) {
    window.errorHandler.handleError(error, context);
    // 重新抛出错误以便调用者可以处理
    throw error;
  }
};

console.log('[ErrorHandler] ✅ 诚实错误处理系统已加载');