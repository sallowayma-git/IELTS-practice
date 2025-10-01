// 辅助工具函数集合
// 提供常用的工具方法和实用函数
// 已合并: events.js, validation.js, errorHandler.js, markdownExporter.js, keyboardShortcuts.js, helpSystem.js, touchHandler.js

// Debug flag for verbose logging (production default: false)
// Set window.__DEBUG__ = true in test pages to enable detailed logs
window.__DEBUG__ = window.__DEBUG__ || false;

/**
 * Debug logging helper that only logs when __DEBUG__ flag is true
 * @param {...any} args - Arguments to pass to console.log
 */
function debugLog(...args) {
    if (window.__DEBUG__) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * 防抖函数
 */
function debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(this, args);
    };
}

/**
 * 节流函数
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * 深度克隆对象
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const clonedObj = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                clonedObj[key] = deepClone(obj[key]);
            }
        }
        return clonedObj;
    }
}

/**
 * 格式化时间
 */
function formatTime(seconds) {
    if (seconds < 60) {
        return `${seconds}秒`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
    }
}

/**
 * 格式化持续时间（别名）
 */
function formatDuration(seconds) {
    return formatTime(seconds);
}

/**
 * 格式化日期
 */
function formatDate(date, format = 'YYYY-MM-DD') {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return format
        .replace('YYYY', year)
        .replace('MM', month)
        .replace('DD', day)
        .replace('HH', hours)
        .replace('mm', minutes)
        .replace('ss', seconds);
}

/**
 * 相对时间格式化
 */
function formatRelativeTime(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = now - target;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) return '刚刚';
    if (diffMinutes < 60) return `${diffMinutes}分钟前`;
    if (diffHours < 24) return `${diffHours}小时前`;
    if (diffDays < 7) return `${diffDays}天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}个月前`;
    return `${Math.floor(diffDays / 365)}年前`;
}

/**
 * 生成唯一ID
 */
function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return prefix + timestamp + random;
}

/**
 * 计算正确率百分比
 */
function calculateAccuracy(correct, total) {
    if (total === 0) return 0;
    return Math.round((correct / total) * 100);
}

/**
 * 格式化百分比
 */
function formatPercentage(value, decimals = 1) {
    return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * 安全的JSON解析
 */
function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str);
    } catch (error) {
        console.warn('JSON parse error:', error);
        return defaultValue;
    }
}

/**
 * 检查是否为移动设备
 */
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * 获取URL参数
 */
function getUrlParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

/**
 * 设置URL参数
 */
function setUrlParameter(name, value) {
    const url = new URL(window.location);
    url.searchParams.set(name, value);
    window.history.replaceState({}, '', url);
}

/**
 * 移除URL参数
 */
function removeUrlParameter(name) {
    const url = new URL(window.location);
    url.searchParams.delete(name);
    window.history.replaceState({}, '', url);
}

/**
 * 滚动到元素
 */
function scrollToElement(element, offset = 0) {
    const target = typeof element === 'string' ? document.querySelector(element) : element;
    if (target) {
        const targetPosition = target.offsetTop - offset;
        window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
        });
    }
}

/**
 * 复制文本到剪贴板
 */
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            // 降级方案
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const result = document.execCommand('copy');
            document.body.removeChild(textArea);
            return result;
        }
    } catch (error) {
        console.error('Copy to clipboard failed:', error);
        return false;
    }
}

/**
 * 下载文件
 */
function downloadFile(content, filename, contentType = 'application/octet-stream') {
    // 对于文本类型的内容，添加UTF-8编码支持
    const isTextType = contentType.includes('text/') ||
                      contentType.includes('application/json') ||
                      contentType.includes('application/javascript') ||
                      contentType.includes('application/xml');

    const blobOptions = isTextType ? { type: contentType + '; charset=utf-8' } : { type: contentType };
    const blob = new Blob([content], blobOptions);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * 读取文件内容
 */
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

/**
 * 验证邮箱格式
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// ===== Validation Functions from validation.js =====
// validation.js - Data validation functions for file:// protocol compatibility
// Pure functions for validating exam and record data integrity

// Exam validation functions
window.validateExam = function(exam) {
    if (!exam || typeof exam !== 'object') {
        throw new Error('Exam must be an object');
    }
    
    const required = ['id', 'title', 'category'];
    const missing = required.filter(field => !exam[field]);
    
    if (missing.length > 0) {
        throw new Error(`Exam validation failed. Missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate field types
    if (typeof exam.id !== 'string' || exam.id.trim() === '') {
        throw new Error('Exam id must be a non-empty string');
    }
    
    if (typeof exam.title !== 'string' || exam.title.trim() === '') {
        throw new Error('Exam title must be a non-empty string');
    }
    
    if (typeof exam.category !== 'string' || exam.category.trim() === '') {
        throw new Error('Exam category must be a non-empty string');
    }
    
    // Validate category values
    const validCategories = ['P1', 'P2', 'P3', 'P4'];
    if (!validCategories.includes(exam.category)) {
        throw new Error(`Invalid exam category: ${exam.category}. Must be one of: ${validCategories.join(', ')}`);
    }
    
    // Validate optional fields
    if (exam.type && typeof exam.type !== 'string') {
        throw new Error('Exam type must be a string');
    }
    
    if (exam.difficulty && !['easy', 'medium', 'hard'].includes(exam.difficulty)) {
        throw new Error('Exam difficulty must be: easy, medium, or hard');
    }
    
    if (exam.topics && !Array.isArray(exam.topics)) {
        throw new Error('Exam topics must be an array');
    }
    
    return true;
};

// Record validation functions
window.validateRecord = function(record) {
    if (!record || typeof record !== 'object') {
        throw new Error('Record must be an object');
    }
    
    const required = ['examId', 'score'];
    const missing = required.filter(field => !record[field]);
    
    if (missing.length > 0) {
        throw new Error(`Record validation failed. Missing required fields: ${missing.join(', ')}`);
    }
    
    // Validate examId
    if (typeof record.examId !== 'string' || record.examId.trim() === '') {
        throw new Error('Record examId must be a non-empty string');
    }
    
    // Validate score object
    if (!record.score || typeof record.score !== 'object') {
        throw new Error('Record score must be an object');
    }
    
    if (typeof record.score.percentage !== 'number') {
        throw new Error('Record score must include percentage as number');
    }
    
    if (record.score.percentage < 0 || record.score.percentage > 100) {
        throw new Error('Record score percentage must be between 0 and 100');
    }
    
    // Validate optional fields
    if (record.date && !isValidDate(record.date)) {
        throw new Error('Record date must be a valid ISO date string');
    }
    
    if (record.duration && (typeof record.duration !== 'number' || record.duration < 0)) {
        throw new Error('Record duration must be a non-negative number');
    }
    
    if (record.answers && typeof record.answers !== 'object') {
        throw new Error('Record answers must be an object');
    }
    
    return true;
};

// Statistics validation functions
window.validateStats = function(stats) {
    if (!stats || typeof stats !== 'object') {
        throw new Error('Stats must be an object');
    }
    
    const required = ['totalPracticed', 'averageScore', 'studyTime', 'streakDays'];
    const missing = required.filter(field => typeof stats[field] !== 'number');
    
    if (missing.length > 0) {
        throw new Error(`Stats validation failed. Missing or invalid numeric fields: ${missing.join(', ')}`);
    }
    
    // Validate ranges
    if (stats.totalPracticed < 0) {
        throw new Error('Stats totalPracticed must be non-negative');
    }
    
    if (stats.averageScore < 0 || stats.averageScore > 100) {
        throw new Error('Stats averageScore must be between 0 and 100');
    }
    
    if (stats.studyTime < 0) {
        throw new Error('Stats studyTime must be non-negative');
    }
    
    if (stats.streakDays < 0) {
        throw new Error('Stats streakDays must be non-negative');
    }
    
    return true;
};

// Data sanitization functions
window.sanitizeExam = function(exam) {
    if (!exam) return null;
    
    const sanitized = {
        id: String(exam.id || '').trim(),
        title: String(exam.title || '').trim(),
        category: String(exam.category || '').trim().toUpperCase(),
        type: String(exam.type || 'reading').trim().toLowerCase(),
        path: String(exam.path || '').trim(),
        filename: String(exam.filename || '').trim(),
        hasHtml: Boolean(exam.hasHtml),
        hasPdf: Boolean(exam.hasPdf),
        difficulty: String(exam.difficulty || 'medium').trim().toLowerCase(),
        topics: Array.isArray(exam.topics) ? exam.topics.map(t => String(t).trim()) : [],
        createdAt: exam.createdAt || new Date().toISOString()
    };
    
    // Remove empty strings
    Object.keys(sanitized).forEach(key => {
        if (sanitized[key] === '') {
            delete sanitized[key];
        }
    });
    
    return sanitized;
};

window.sanitizeRecord = function(record) {
    if (!record) return null;
    
    const sanitized = {
        id: record.id || 'record_' + Date.now(),
        examId: String(record.examId || '').trim(),
        date: record.date || new Date().toISOString(),
        duration: Number(record.duration) || 0,
        score: record.score ? {
            correct: Number(record.score.correct) || 0,
            total: Number(record.score.total) || 0,
            percentage: Number(record.score.percentage) || 0
        } : { correct: 0, total: 0, percentage: 0 },
        answers: record.answers || {},
        dataSource: String(record.dataSource || 'real').trim()
    };
    
    return sanitized;
};

// Migration helpers for old data formats
window.migrateExamData = function(oldExam) {
    if (!oldExam) return null;
    
    try {
        // Handle various old formats
        const migrated = {
            id: oldExam.id || oldExam.examId || 'exam_' + Date.now(),
            title: oldExam.title || oldExam.name || 'Untitled Exam',
            category: oldExam.category || oldExam.part || 'P1',
            type: oldExam.type || 'reading',
            path: oldExam.path || oldExam.folder || '',
            filename: oldExam.filename || oldExam.file || '',
            hasHtml: oldExam.hasHtml !== false,
            hasPdf: oldExam.hasPdf !== false,
            difficulty: oldExam.difficulty || 'medium',
            topics: oldExam.topics || oldExam.tags || [],
            createdAt: oldExam.createdAt || oldExam.created || new Date().toISOString()
        };
        
        return sanitizeExam(migrated);
    } catch (error) {
        console.warn('[Migration] Failed to migrate exam:', oldExam, error);
        return null;
    }
};

window.migrateRecordData = function(oldRecord) {
    if (!oldRecord) return null;
    
    try {
        // Handle various old formats
        const migrated = {
            id: oldRecord.id || 'record_' + Date.now(),
            examId: oldRecord.examId || oldRecord.exam_id || oldRecord.exam,
            date: oldRecord.date || oldRecord.timestamp || new Date().toISOString(),
            duration: oldRecord.duration || oldRecord.time || 0,
            score: oldRecord.score || {
                correct: oldRecord.correct || 0,
                total: oldRecord.total || 0,
                percentage: oldRecord.percentage || oldRecord.score_percentage || 0
            },
            answers: oldRecord.answers || oldRecord.responses || {},
            dataSource: oldRecord.dataSource || oldRecord.source || 'real'
        };
        
        return sanitizeRecord(migrated);
    } catch (error) {
        console.warn('[Migration] Failed to migrate record:', oldRecord, error);
        return null;
    }
};

// Utility functions
function isValidDate(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
}

// Batch validation functions
window.validateExamArray = function(exams) {
    if (!Array.isArray(exams)) {
        throw new Error('Exams must be an array');
    }
    
    const errors = [];
    const validExams = [];
    
    exams.forEach((exam, index) => {
        try {
            validateExam(exam);
            validExams.push(exam);
        } catch (error) {
            errors.push({ index, exam, error: error.message });
        }
    });
    
    return {
        valid: validExams,
        errors: errors,
        totalCount: exams.length,
        validCount: validExams.length,
        errorCount: errors.length
    };
};

window.validateRecordArray = function(records) {
    if (!Array.isArray(records)) {
        throw new Error('Records must be an array');
    }
    
    const errors = [];
    const validRecords = [];
    
    records.forEach((record, index) => {
        try {
            validateRecord(record);
            validRecords.push(record);
        } catch (error) {
            errors.push({ index, record, error: error.message });
        }
    });
    
    return {
        valid: validRecords,
        errors: errors,
        totalCount: records.length,
        validCount: validRecords.length,
        errorCount: errors.length
    };
};

// Schema validation for import/export
window.validateImportData = function(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Import data must be an object');
    }
    
    const result = {
        valid: true,
        errors: [],
        warnings: []
    };
    
    // Check version compatibility
    if (data.version && data.version !== '1.0') {
        result.warnings.push(`Unknown data version: ${data.version}. Attempting to import anyway.`);
    }
    
    // Validate exams if present
    if (data.exams) {
        try {
            const examValidation = validateExamArray(data.exams);
            if (examValidation.errorCount > 0) {
                result.errors.push(`${examValidation.errorCount} invalid exams found`);
                result.valid = false;
            }
        } catch (error) {
            result.errors.push(`Exam data validation failed: ${error.message}`);
            result.valid = false;
        }
    }
    
    // Validate records if present
    if (data.records) {
        try {
            const recordValidation = validateRecordArray(data.records);
            if (recordValidation.errorCount > 0) {
                result.errors.push(`${recordValidation.errorCount} invalid records found`);
                result.valid = false;
            }
        } catch (error) {
            result.errors.push(`Record data validation failed: ${error.message}`);
            result.valid = false;
        }
    }
    
    return result;
};

// ===== Event System from events.js =====
// events.js - Simple event system for file:// protocol compatibility
// Pure functions and classes for store notifications and UI updates

// Simple EventEmitter class for store-to-UI communication
// Guard against redefinition - canonical source is js/utils/events.js
if (!window.EventEmitter) {
    window.EventEmitter = class EventEmitter {
        constructor() {
            this.listeners = new Map();
        }

        // Subscribe to events
        on(eventType, callback) {
            if (typeof callback !== 'function') {
                throw new Error('Event callback must be a function');
            }

            if (!this.listeners.has(eventType)) {
                this.listeners.set(eventType, new Set());
            }

            this.listeners.get(eventType).add(callback);

            // Return unsubscribe function
            return () => this.off(eventType, callback);
        }

        // Unsubscribe from events
        off(eventType, callback) {
            if (this.listeners.has(eventType)) {
                this.listeners.get(eventType).delete(callback);

                // Clean up empty event types
                if (this.listeners.get(eventType).size === 0) {
                    this.listeners.delete(eventType);
                }
            }
        }

        // Emit events to all listeners
        emit(eventType, data = null) {
            if (this.listeners.has(eventType)) {
                const callbacks = this.listeners.get(eventType);

                callbacks.forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`[EventEmitter] Error in ${eventType} listener:`, error);
                    }
                });
            }
        }

        // Remove all listeners for an event type
        removeAllListeners(eventType) {
            if (eventType) {
                this.listeners.delete(eventType);
            } else {
                this.listeners.clear();
            }
        }

        // Get listener count for debugging
        listenerCount(eventType) {
            return this.listeners.has(eventType) ? this.listeners.get(eventType).size : 0;
        }

        // Get all event types for debugging
        eventTypes() {
            return Array.from(this.listeners.keys());
        }
    };
}

// Global event bus for cross-component communication
// Guard against redefinition - defer to events.js as canonical source
if (!window.globalEventBus) {
    window.globalEventBus = new window.EventEmitter();
    // No log here - let events.js handle canonical initialization log
}

// Utility functions for window context detection (Task 35)
window.isPracticeWindow = function() {
    // Multiple heuristics to detect if we're in a practice window
    return (
        window.name && window.name.startsWith('exam_') ||
        window.location.search.includes('mode=practice') ||
        window.location.pathname.includes('exam.html') ||
        // Check for practice page specific elements
        document.querySelector('.practice-container') !== null ||
        document.querySelector('#practice-container') !== null ||
        // Check for practice-related global variables
        window.practiceMode === true ||
        window.currentExamId !== undefined
    );
};

console.log('[Helpers] Practice window detection initialized, isPractice:', isPracticeWindow());

// Global event bus for cross-component communication

// Utility functions for common event patterns
window.createEventHandler = function(eventType, handler) {
    if (typeof handler !== 'function') {
        throw new Error('Event handler must be a function');
    }
    
    return function(data) {
        try {
            handler(data);
        } catch (error) {
            console.error(`[EventHandler] Error handling ${eventType}:`, error);
            
            // Emit error event for global error handling
            window.globalEventBus.emit('error', {
                type: 'event_handler_error',
                eventType: eventType,
                error: error,
                data: data
            });
        }
    };
};

// Debounced event handler for performance
window.createDebouncedHandler = function(handler, delay = 300) {
    let timeoutId = null;
    
    return function(data) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            try {
                handler(data);
            } catch (error) {
                console.error('[DebouncedHandler] Error:', error);
            }
        }, delay);
    };
};

// Throttled event handler for performance
window.createThrottledHandler = function(handler, delay = 100) {
    let lastCall = 0;
    
    return function(data) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            try {
                handler(data);
            } catch (error) {
                console.error('[ThrottledHandler] Error:', error);
            }
        }
    };
};

// Event aggregator for batching multiple events
window.EventAggregator = class EventAggregator {
    constructor(flushInterval = 100) {
        this.events = [];
        this.flushInterval = flushInterval;
        this.flushTimer = null;
        this.handlers = new Set();
    }
    
    add(event) {
        this.events.push({
            ...event,
            timestamp: Date.now()
        });
        
        this.scheduleFlush();
    }
    
    scheduleFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        
        this.flushTimer = setTimeout(() => {
            this.flush();
        }, this.flushInterval);
    }
    
    flush() {
        if (this.events.length === 0) return;
        
        const eventsToFlush = [...this.events];
        this.events = [];
        
        this.handlers.forEach(handler => {
            try {
                handler(eventsToFlush);
            } catch (error) {
                console.error('[EventAggregator] Handler error:', error);
            }
        });
    }
    
    subscribe(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
};

// Store event types for type safety and documentation
window.StoreEvents = {
    // ExamStore events
    EXAMS_LOADED: 'exams_loaded',
    EXAMS_UPDATED: 'exams_updated',
    CATEGORIES_UPDATED: 'categories_updated',
    EXAM_SEARCH: 'exam_search',
    
    // RecordStore events
    RECORDS_LOADED: 'records_loaded',
    RECORD_SAVED: 'record_saved',
    RECORD_DELETED: 'record_deleted',
    RECORDS_CLEARED: 'records_cleared',
    RECORDS_IMPORTED: 'records_imported',
    STATS_UPDATED: 'stats_updated',
    
    // AppStore events
    VIEW_CHANGED: 'view_changed',
    LOADING_CHANGED: 'loading_changed',
    ERROR_ADDED: 'error_added',
    ERROR_CLEARED: 'error_cleared',
    ERRORS_CLEARED: 'errors_cleared',
    INITIALIZATION_STEP: 'initialization_step',
    INITIALIZATION_COMPLETE: 'initialization_complete',
    STORE_OPERATION: 'store_operation',
    APP_RESET: 'app_reset'
};

// UI event types for user interactions
window.UIEvents = {
    // Navigation events
    NAVIGATE_TO: 'navigate_to',
    NAVIGATE_BACK: 'navigate_back',
    
    // Exam events
    EXAM_START: 'exam_start',
    EXAM_COMPLETE: 'exam_complete',
    EXAM_SEARCH: 'exam_search',
    EXAM_FILTER: 'exam_filter',
    
    // Record events
    RECORD_VIEW: 'record_view',
    RECORD_DELETE: 'record_delete',
    RECORD_EXPORT: 'record_export',
    
    // Settings events
    SETTINGS_OPEN: 'settings_open',
    SETTINGS_SAVE: 'settings_save',
    DATA_EXPORT: 'data_export',
    DATA_IMPORT: 'data_import',
    DATA_CLEAR: 'data_clear'
};

// Event validation helpers
window.validateEvent = function(event) {
    if (!event || typeof event !== 'object') {
        throw new Error('Event must be an object');
    }
    
    if (!event.type || typeof event.type !== 'string') {
        throw new Error('Event must have a type string');
    }
    
    return true;
};

// Event logging for debugging
window.EventLogger = class EventLogger {
    constructor(enabled = false) {
        this.enabled = enabled;
        this.logs = [];
        this.maxLogs = 1000;
    }
    
    log(event) {
        if (!this.enabled) return;
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            event: event,
            stack: new Error().stack
        };
        
        this.logs.push(logEntry);
        
        // Keep only recent logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        console.log('[EventLogger]', event.type, event);
    }
    
    getLogs(eventType = null) {
        if (eventType) {
            return this.logs.filter(log => log.event.type === eventType);
        }
        return [...this.logs];
    }
    
    clearLogs() {
        this.logs = [];
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
    }
};

// Global event logger instance
window.eventLogger = new window.EventLogger(false); // Disabled by default

// Helper function to enable event logging for debugging
window.enableEventLogging = function() {
    window.eventLogger.enable();
    console.log('[Events] Event logging enabled');
};

window.disableEventLogging = function() {
    window.eventLogger.disable();
    console.log('[Events] Event logging disabled');
};

// Cross-window communication helpers for exam windows
window.createWindowMessenger = function(targetWindow, origin = '*') {
    return {
        send: function(type, data) {
            if (!targetWindow || targetWindow.closed) {
                throw new Error('Target window is not available');
            }
            
            const message = {
                type: type,
                data: data,
                timestamp: Date.now(),
                source: 'ielts-main'
            };
            
            targetWindow.postMessage(message, origin);
        },
        
        listen: function(callback) {
            const handler = function(event) {
                // Basic security check
                if (event.data && event.data.source === 'ielts-exam') {
                    try {
                        callback(event.data);
                    } catch (error) {
                        console.error('[WindowMessenger] Message handler error:', error);
                    }
                }
            };
            
            window.addEventListener('message', handler);
            
            // Return cleanup function
            return () => window.removeEventListener('message', handler);
        }
    };
};

// Event bus for store coordination

// Helper to connect stores to the event bus
window.connectStoreToEventBus = function(store, storeName) {
    if (!store || !store.subscribe) {
        throw new Error('Store must have a subscribe method');
    }
    
    // Forward store events to global event bus
    store.subscribe(function(event) {
        const globalEvent = {
            ...event,
            source: storeName,
            timestamp: Date.now()
        };
        
        window.storeEventBus.emit(event.type, globalEvent);
        window.eventLogger.log(globalEvent);
    });
    
    console.log(`[Events] Connected ${storeName} to event bus`);
};

// ===== Error Handler from errorHandler.js =====
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

// ===== Markdown Exporter from markdownExporter.js =====
/**
 * Markdown 导出器
 * 用于将练习数据导出为 Markdown 格式
 */
class MarkdownExporter {
    // 合并 comparison 与其他来源以补全缺失 correctAnswer
    mergeComparisonWithCorrections(record) {
        const comparison = JSON.parse(JSON.stringify(record.answerComparison || {}));
        const sources = [
            record.correctAnswers || {},
            (record.realData && record.realData.correctAnswers) || {},
        ];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.realData.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            sources.push(Object.fromEntries(Object.entries(record.scoreInfo.details).map(([k,v]) => [k, v && v.correctAnswer])));
        }
        const getFromSources = (key) => {
            for (const src of sources) {
                if (src && src[key] != null && String(src[key]).trim() !== '') return src[key];
            }
            return null;
        };
        Object.keys(comparison).forEach(key => {
            const item = comparison[key] || {};
            if (item.correctAnswer == null || String(item.correctAnswer).trim() === '') {
                const fixed = getFromSources(key);
                if (fixed != null) item.correctAnswer = fixed;
            }
            if (item.userAnswer == null) item.userAnswer = '';
            if (item.correctAnswer == null) item.correctAnswer = '';
            comparison[key] = item;
        });
        // 映射 qa.. 到可能对应的数值区间 q14..q20
        const letterKeys = Object.keys(comparison).filter(k => /^q[a-z]$/i.test(k));
        if (letterKeys.length > 0) {
            let numericKeys = Object.keys(comparison).filter(k => /q\d+$/i.test(k));
            if (numericKeys.length === 0) {
                for (const src of sources) {
                    if (!src) continue;
                    numericKeys.push(...Object.keys(src).filter(k => /q\d+$/i.test(k)));
                }
                numericKeys = Array.from(new Set(numericKeys));
            }
            letterKeys.sort();
            numericKeys.sort((a,b) => (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0));
            if (numericKeys.length >= letterKeys.length) {
                let bestStart = 0, found = false;
                for (let i=0; i+letterKeys.length-1 < numericKeys.length; i++) {
                    const first = parseInt(numericKeys[i].replace(/\D/g,''));
                    const last = parseInt(numericKeys[i+letterKeys.length-1].replace(/\D/g,''));
                    if (!isNaN(first) && !isNaN(last) && (last - first + 1) === letterKeys.length) { bestStart = i; found = true; break; }
                }
                const slice = numericKeys.slice(found ? bestStart : 0, (found ? bestStart : 0) + letterKeys.length);
                for (let i=0; i<letterKeys.length; i++) {
                    const lk = letterKeys[i], nk = slice[i];
                    if (!nk) continue;
                    const item = comparison[lk] || {};
                    if (!item.correctAnswer || String(item.correctAnswer).trim() === '') {
                        const nkItem = comparison[nk];
                        let val = nkItem && nkItem.correctAnswer;
                        if (!val) val = getFromSources(nk);
                        if (val != null) item.correctAnswer = val;
                    }
                    if (item.userAnswer == null) item.userAnswer = '';
                    if (item.correctAnswer == null) item.correctAnswer = '';
                    comparison[lk] = item;
                }
            }
        }
        return comparison;
    }
    constructor() {
        this.storage = window.storage;
    }

    /**
     * 导出所有练习记录为 Markdown 格式
     */
    exportToMarkdown() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[MarkdownExporter] 开始导出过程');
                
                // 显示进度指示器
                this.showProgressIndicator();
                
                // 设置超时机制
                const timeout = setTimeout(() => {
                    this.hideProgressIndicator();
                    reject(new Error('导出超时，请尝试减少数据量'));
                }, 30000); // 30秒超时
                
                // 使用setTimeout避免阻塞UI
                setTimeout(() => {
                    try {
                        this.performExport()
                            .then(result => {
                                clearTimeout(timeout);
                                resolve(result);
                            })
                            .catch(error => {
                                clearTimeout(timeout);
                                this.hideProgressIndicator();
                                reject(error);
                            });
                    } catch (error) {
                        clearTimeout(timeout);
                        this.hideProgressIndicator();
                        reject(error);
                    }
                }, 100);
                
            } catch (error) {
                console.error('Markdown导出失败:', error);
                this.hideProgressIndicator();
                reject(error);
            }
        });
    }

    /**
     * 执行实际的导出操作
     */
    async performExport() {
        try {
            // 尝试从不同的数据源获取记录
            let practiceRecords = [];
            let examIndex = [];
            
            this.updateProgress('正在加载数据...');
            
            // 让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 首先尝试从storage获取（注意：storage.get 为异步）
            if (this.storage && typeof this.storage.get === 'function') {
                try {
                    const recs = await this.storage.get('practice_records', []);
                    const idx = await this.storage.get('exam_index', []);
                    practiceRecords = Array.isArray(recs) ? recs : [];
                    examIndex = Array.isArray(idx) ? idx : [];
                } catch (_) {
                    practiceRecords = [];
                    examIndex = [];
                }
            }
            
            // 如果storage中没有数据，尝试从全局变量获取
            if ((!Array.isArray(practiceRecords) || practiceRecords.length === 0) && window.practiceRecords) {
                practiceRecords = Array.isArray(window.practiceRecords) ? window.practiceRecords : [];
            }
            
            if ((!Array.isArray(examIndex) || examIndex.length === 0) && window.examIndex) {
                examIndex = Array.isArray(window.examIndex) ? window.examIndex : [];
            }
            
            if (practiceRecords.length === 0) {
                throw new Error('没有练习记录可导出');
            }

            console.log(`[MarkdownExporter] 找到 ${practiceRecords.length} 条记录`);
            
            // 限制记录数量避免卡死
            if (practiceRecords.length > 50) {
                console.warn('[MarkdownExporter] 记录数量过多，只导出最新50条');
                practiceRecords = practiceRecords.slice(0, 50);
            }

            this.updateProgress('正在处理数据...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 使用数据一致性管理器确保数据质量
            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                
                // 生成数据质量报告
                const qualityReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 数据质量报告:', qualityReport);
                
                // 修复数据不一致问题
                practiceRecords = await this.processRecordsInBatches(practiceRecords, manager);
                console.log('[MarkdownExporter] 数据一致性修复完成');
                
                // 验证修复结果
                const postFixReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 修复后质量报告:', postFixReport);
            }

            this.updateProgress('正在生成内容...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 按日期分组记录
            const recordsByDate = await this.groupRecordsByDateAsync(practiceRecords, examIndex);
            
            // 生成 Markdown 内容
            const markdownContent = await this.generateMarkdownContentAsync(recordsByDate);
            
            this.updateProgress('正在下载文件...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 下载文件
            this.downloadMarkdownFile(markdownContent);
            
            this.hideProgressIndicator();
            
            return markdownContent;
            
        } catch (error) {
            console.error('Markdown导出失败:', error);
            this.hideProgressIndicator();
            throw error;
        }
    }

    /**
     * 批量处理记录以避免阻塞
     */
    async processRecordsInBatches(practiceRecords, manager) {
        const batchSize = 10;
        const processedRecords = [];
        
        for (let i = 0; i < practiceRecords.length; i += batchSize) {
            const batch = practiceRecords.slice(i, i + batchSize);
            
            for (let j = 0; j < batch.length; j++) {
                const record = batch[j];
                try {
                    const processed = manager.ensureConsistency ? manager.ensureConsistency(record) : record;
                    processedRecords.push(processed);
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理记录失败:', error);
                    processedRecords.push(record); // 使用原始记录
                }
            }
            
            // 每处理一批就让出控制权
            if (i + batchSize < practiceRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
                this.updateProgress(`正在处理数据... (${Math.min(i + batchSize, practiceRecords.length)}/${practiceRecords.length})`);
            }
        }
        
        return processedRecords;
    }

    /**
     * 异步按日期分组记录
     */
    async groupRecordsByDateAsync(practiceRecords, examIndex) {
        const grouped = {};
        
        for (let i = 0; i < practiceRecords.length; i++) {
            const record = practiceRecords[i];
            
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
            
            // 每处理20条记录就让出控制权
            if (i % 20 === 19) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        return grouped;
    }

    /**
     * 按日期分组记录（同步版本，保持兼容性）
     */
    groupRecordsByDate(practiceRecords, examIndex) {
        const grouped = {};
        
        practiceRecords.forEach(record => {
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
        });
        
        return grouped;
    }

    /**
     * 异步生成 Markdown 内容
     */
    async generateMarkdownContentAsync(recordsByDate) {
        let markdown = '# 练习记录导出\n\n';
        markdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        
        // 限制处理的日期数量
        const maxDates = 10;
        const datesToProcess = sortedDates.slice(0, maxDates);
        
        if (sortedDates.length > maxDates) {
            console.warn(`[MarkdownExporter] 日期过多，只处理最新${maxDates}天的记录`);
        }
        
        for (let i = 0; i < datesToProcess.length; i++) {
            const date = datesToProcess[i];
            const records = recordsByDate[date];
            
            // 更新进度
            this.updateProgress(`正在处理 ${date} 的记录... (${i + 1}/${datesToProcess.length})`);
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            // 限制每天的记录数量
            const maxRecordsPerDay = 20;
            const recordsToProcess = records.slice(0, maxRecordsPerDay);
            
            for (let j = 0; j < recordsToProcess.length; j++) {
                const record = recordsToProcess[j];
                try {
                    const recordMarkdown = this.generateRecordMarkdown(record);
                    markdown += recordMarkdown;
                    markdown += '\n\n'; // 记录之间空两行
                } catch (error) {
                    console.warn('[MarkdownExporter] 生成记录Markdown失败:', error);
                    markdown += `### 记录处理失败: ${record.id || 'unknown'}\n\n`;
                }
                
                // 每处理5条记录就让出控制权
                if (j % 5 === 4) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
            
            // 每处理完一个日期就让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        return markdown;
    }

    /**
     * 生成 Markdown 内容（同步版本，保持兼容性）
     */
    generateMarkdownContent(recordsByDate) {
        let markdown = '# 练习记录导出\n\n';
        markdown += `导出时间: ${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        
        for (let i = 0; i < sortedDates.length; i++) {
            const date = sortedDates[i];
            const records = recordsByDate[date];
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            for (let j = 0; j < records.length; j++) {
                const record = records[j];
                markdown += this.generateRecordMarkdown(record);
                markdown += '\n\n'; // 记录之间空两行
            }
        }
        
        return markdown;
    }

    /**
     * 生成单个记录的 Markdown
     */
    generateRecordMarkdown(record) {
        const { title, category, frequency, realData } = record;
        const metrics = this.resolveScoreMetrics(record);
        
        // 标题行
        let markdown = `### ${category}-${frequency}-${title} ${metrics.correct}/${metrics.total} (${metrics.percentage}%)\n\n`;
        
        // 如果有详细答题数据，生成表格
        if (realData && realData.answers && realData.scoreInfo) {
            markdown += this.generateAnswerTable(realData, record);
        } else {
            // 如果没有详细数据，显示基本信息
            markdown += `**分数:** ${metrics.correct}/${metrics.total}\n`;
            markdown += `**准确率:** ${metrics.percentage}%\n`;
            markdown += `**用时:** ${record.duration || 0}秒\n`;
        }
        
        return markdown;
    }

    resolveScoreMetrics(record) {
        const rd = record.realData || {};
        const scoreInfo = record.scoreInfo || rd.scoreInfo || {};

        const totalFromRecord = typeof record.totalQuestions === 'number' ? record.totalQuestions : null;
        const totalFromScoreInfo = typeof scoreInfo.total === 'number' ? scoreInfo.total : null;
        const totalFromAnswers = record.answers ? Object.keys(record.answers).length
            : (rd.answers ? Object.keys(rd.answers).length : null);
        const totalFromComparison = record.answerComparison ? Object.keys(record.answerComparison).length : null;
        let total = totalFromRecord ?? totalFromScoreInfo ?? totalFromAnswers ?? totalFromComparison ?? 0;

        let correct = null;
        if (typeof record.correctAnswers === 'number') correct = record.correctAnswers;
        if (correct == null && typeof scoreInfo.correct === 'number') correct = scoreInfo.correct;
        if (correct == null && typeof record.score === 'number') {
            if (total && record.score <= total) {
                correct = record.score;
            }
        }
        if (correct == null && record.answerComparison) {
            try {
                correct = Object.values(record.answerComparison).filter(item => item && item.isCorrect).length;
            } catch (_) {}
        }
        if (correct == null) correct = 0;

        let percentage = null;
        if (typeof record.percentage === 'number') percentage = record.percentage;
        else if (typeof scoreInfo.percentage === 'number') percentage = scoreInfo.percentage;
        else if (typeof record.accuracy === 'number') percentage = Math.round(record.accuracy * 100);

        if ((!total || total <= 0) && percentage == null) {
            total = totalFromAnswers ?? totalFromComparison ?? 0;
        }
        if ((!total || total <= 0) && correct > 0) {
            total = correct;
        }
        if (!total || total <= 0) total = 0;

        if ((percentage == null || percentage > 100 || percentage < 0) && total > 0) {
            percentage = Math.round((correct / total) * 100);
        }
        if (percentage == null) percentage = 0;

        if (total > 0 && correct > total) {
            // 说明 score 字段可能是百分比
            correct = Math.round((percentage / 100) * total);
        }

        return {
            correct,
            total,
            percentage: Math.max(0, Math.min(100, Math.round(percentage)))
        };
    }

    /**
     * 生成答题表格
     */
    generateAnswerTable(realData, record) {
        try {
            // 优先使用answerComparison数据确保一致性（若有则合并补全缺失正确答案）
            if (record.answerComparison && Object.keys(record.answerComparison).length > 0) {
                const merged = this.mergeComparisonWithCorrections(record);
                return this.generateTableFromComparison(merged);
            }
            
            // 降级到原有逻辑
            const answers = record.answers || realData?.answers || {};
            const correctAnswers = this.getCorrectAnswers(record);
            
            let table = '| Question | Your Answer | Correct Answer | Result |\n';
            table += '| -------- | ----------- | -------------- | ------ |\n';
            
            // 获取所有题目编号并排序
            const questionNumbers = this.extractQuestionNumbers(answers, correctAnswers);
            
            // 限制题目数量避免表格过大
            const maxQuestions = 50;
            const questionsToProcess = questionNumbers.slice(0, maxQuestions);
            
            if (questionNumbers.length > maxQuestions) {
                console.warn(`[MarkdownExporter] 题目过多，只显示前${maxQuestions}题`);
            }
            
            for (let i = 0; i < questionsToProcess.length; i++) {
                const qNum = questionsToProcess[i];
                try {
                    const userAnswer = this.getUserAnswer(answers, qNum);
                    const correctAnswer = this.getCorrectAnswer(correctAnswers, qNum);
                    const result = this.compareAnswers(userAnswer, correctAnswer) ? '✓' : '✗';
                    
                    // 清理答案文本，避免Markdown格式问题
                    const cleanUserAnswer = this.cleanAnswerText(userAnswer || 'No Answer');
                    const cleanCorrectAnswer = this.cleanAnswerText(correctAnswer || 'N/A');
                    
                    table += `| ${qNum} | ${cleanUserAnswer} | ${cleanCorrectAnswer} | ${result} |\n`;
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理题目失败:', qNum, error);
                    table += `| ${qNum} | Error | Error | ✗ |\n`;
                }
            }
            
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 生成答题表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    /**
     * 从answerComparison生成表格
     */
    generateTableFromComparison(answerComparison) {
        // 支持将 keys 中的非数字后缀/前缀保留下来，比如 qa/qb 显示为 a/b

        try {
            let table = '| Question | Your Answer | Correct Answer | Result |\n';
            table += '| -------- | ----------- | -------------- | ------ |\n';
            
            // 按问题编号排序
            const sortedKeys = Object.keys(answerComparison).sort((a, b) => {
                const numA = parseInt(a.replace(/\D/g, '')) || 0;
                const numB = parseInt(b.replace(/\D/g, '')) || 0;
                return numA - numB;
            });
            
            // 限制处理的题目数量
            const maxQuestions = 50;
            const keysToProcess = sortedKeys.slice(0, maxQuestions);
            
            for (let i = 0; i < keysToProcess.length; i++) {
                const key = keysToProcess[i];
                try {
                    const comparison = answerComparison[key];
                    // 如果没有数字，fallback 使用去掉前缀 q 的字母编号
                    let questionNum = key.replace(/\D/g, '');
                    if (!questionNum) {
                        questionNum = key.replace(/^q/i, '');
                    }
                    const result = comparison.isCorrect ? '✓' : '✗';
                    
                    // 清理答案文本
                    const cleanUserAnswer = this.cleanAnswerText(comparison.userAnswer || 'No Answer');
                    const cleanCorrectAnswer = this.cleanAnswerText(comparison.correctAnswer || 'N/A');
                    
                    table += `| ${questionNum} | ${cleanUserAnswer} | ${cleanCorrectAnswer} | ${result} |\n`;
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理比较数据失败:', key, error);
                }
            }
            
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 从比较数据生成表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    /**
     * 清理答案文本，避免Markdown格式问题
     */
    cleanAnswerText(text) {
        if (!text) return '';
        
        return String(text)
            .replace(/\|/g, '\\|')  // 转义管道符
            .replace(/\n/g, ' ')    // 替换换行符
            .replace(/\r/g, '')     // 移除回车符
            .trim()
            .substring(0, 100);     // 限制长度
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswers(record) {
        // 优先使用顶级的correctAnswers
        if (record.correctAnswers && Object.keys(record.correctAnswers).length > 0) {
            return record.correctAnswers;
        }
        
        // 其次使用realData中的correctAnswers
        if (record.realData && record.realData.correctAnswers && Object.keys(record.realData.correctAnswers).length > 0) {
            return record.realData.correctAnswers;
        }
        
        // 尝试从answerComparison中提取
        if (record.answerComparison) {
            const correctAnswers = {};
            Object.keys(record.answerComparison).forEach(key => {
                const comparison = record.answerComparison[key];
                if (comparison.correctAnswer) {
                    correctAnswers[key] = comparison.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        // 尝试从 scoreInfo 的 details 中获取（优先 realData.scoreInfo，其次顶层 scoreInfo）
        const detailsSources = [];
        if (record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            detailsSources.push(record.realData.scoreInfo.details);
        }
        if (record.scoreInfo && record.scoreInfo.details) {
            detailsSources.push(record.scoreInfo.details);
        }
        for (const details of detailsSources) {
            const correctAnswers = {};
            Object.keys(details).forEach(key => {
                const detail = details[key];
                if (detail && detail.correctAnswer != null && String(detail.correctAnswer).trim() !== '') {
                    correctAnswers[key] = detail.correctAnswer;
                }
            });
            if (Object.keys(correctAnswers).length > 0) {
                return correctAnswers;
            }
        }
        
        console.warn('[MarkdownExporter] 未找到正确答案数据，记录ID:', record.id);
        return {};
    }

    /**
     * 提取题目编号
     */
    extractQuestionNumbers(userAnswers, correctAnswers) {
        const allQuestions = new Set();
        
        // 从用户答案中提取
        Object.keys(userAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        // 从正确答案中提取
        Object.keys(correctAnswers).forEach(key => {
            const num = this.extractNumber(key);
            if (num) allQuestions.add(num);
        });
        
        // 如果没有找到题目，生成默认序号
        if (allQuestions.size === 0) {
            const maxQuestions = Math.max(
                Object.keys(userAnswers).length,
                Object.keys(correctAnswers).length,
                13 // 默认最大题目数
            );
            for (let i = 1; i <= maxQuestions; i++) {
                allQuestions.add(i);
            }
        }
        
        return Array.from(allQuestions).sort((a, b) => a - b);
    }

    /**
     * 从键名中提取数字
     */
    extractNumber(key) {
        const match = key.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * 获取用户答案
     */
    getUserAnswer(answers, questionNum) {
        // 尝试不同的键名格式
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (answers[key] !== undefined) {
                const answer = answers[key];
                // 如果是数组（历史记录），取最后一个
                if (Array.isArray(answer)) {
                    return answer[answer.length - 1]?.value || answer[answer.length - 1];
                }
                return answer;
            }
        }
        
        return null;
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswer(correctAnswers, questionNum) {
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (correctAnswers[key] !== undefined) {
                return correctAnswers[key];
            }
        }
        
        return null;
    }

    /**
     * 比较答案
     */
    compareAnswers(userAnswer, correctAnswer) {
        if (!userAnswer || !correctAnswer) {
            return false;
        }
        
        // 标准化答案进行比较
        const normalize = (str) => String(str).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    /**
     * 显示进度指示器
     */
    showProgressIndicator() {
        // 移除已存在的进度指示器
        this.hideProgressIndicator();
        
        const progressHtml = `
            <div id="export-progress-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            ">
                <div style="
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    min-width: 300px;
                ">
                    <div style="margin-bottom: 15px;">
                        <div style="
                            width: 40px;
                            height: 40px;
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                            margin: 0 auto;
                        "></div>
                    </div>
                    <div id="export-progress-text">正在准备导出...</div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.insertAdjacentHTML('beforeend', progressHtml);
    }

    /**
     * 更新进度文本
     */
    updateProgress(text) {
        const progressText = document.getElementById('export-progress-text');
        if (progressText) {
            progressText.textContent = text;
        }
    }

    /**
     * 隐藏进度指示器
     */
    hideProgressIndicator() {
        const overlay = document.getElementById('export-progress-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * 下载 Markdown 文件
     */
    downloadMarkdownFile(content) {
        try {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            a.href = url;
            a.download = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('[MarkdownExporter] 文件下载完成');
        } catch (error) {
            console.error('[MarkdownExporter] 文件下载失败:', error);
            throw error;
        }
    }
}

// 导出类
window.MarkdownExporter = MarkdownExporter;