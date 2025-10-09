
// 增强的全局错误处理器
window.handleError = function (error, context, options = {}) {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 错误详细信息
    const errorDetails = {
        id: errorId,
        timestamp: new Date().toISOString(),
        context: context,
        message: error.message || '发生未知错误',
        stack: error.stack,
        url: window.location.href,
        userAgent: navigator.userAgent,
        recoverable: options.recoverable !== false
    };

    // 记录错误到本地存储（用于调试和分析）
    try {
        const errorLog = JSON.parse(localStorage.getItem('system_error_log') || '[]');
        errorLog.push(errorDetails);
        // 只保留最近50个错误
        if (errorLog.length > 50) {
            errorLog.splice(0, errorLog.length - 50);
        }
        localStorage.setItem('system_error_log', JSON.stringify(errorLog));
    } catch (logError) {
        console.warn('无法记录错误日志:', logError);
    }

    // 开发模式下输出详细错误
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.error(`[${errorId}] Error in ${context}:`, error);
        console.error('Error details:', errorDetails);
    }

    // 显示用户友好的错误消息
    let userMessage = '';
    if (options.userMessage) {
        userMessage = options.userMessage;
    } else {
        userMessage = window.getErrorUserMessage(error, context);
    }

    window.showMessage(userMessage, 'error');

    // 尝试自动恢复
    if (errorDetails.recoverable && options.autoRecover !== false) {
        setTimeout(() => {
            window.attemptErrorRecovery(error, context, errorDetails);
        }, 1000);
    }

    return errorDetails;
};

// 获取用户友好的错误消息
window.getErrorUserMessage = function (error, context) {
    const errorType = error.name || 'Error';
    const errorMessage = error.message || '未知错误';

    // 根据错误类型和上下文提供友好消息
    const messageMap = {
        'NetworkError': '网络连接出现问题，请检查网络设置',
        'TypeError': '数据格式错误，正在尝试修复',
        'ReferenceError': '系统组件加载失败，正在重新加载',
        'SyntaxError': '数据解析错误，正在尝试修复',
        'QuotaExceededError': '存储空间不足，请清理浏览器数据',
        'SecurityError': '安全限制，请检查浏览器设置'
    };

    const contextMap = {
        '题库加载': '题库数据加载失败，正在尝试重新加载',
        '数据存储': '数据保存失败，请检查存储空间',
        '数据读取': '数据读取失败，正在尝试修复',
        '跨窗口通信': '页面通信失败，正在重新建立连接',
        '文件加载': '文件加载失败，正在尝试备用方案'
    };

    return contextMap[context] || messageMap[errorType] || `${context}出现问题: ${errorMessage}`;
};

// 错误恢复机制
window.attemptErrorRecovery = function (error, context, errorDetails) {
    console.log(`[Recovery] 尝试恢复错误: ${context}`);

    const recoveryStrategies = {
        '题库加载': () => {
            console.log('[Recovery] 重新加载题库数据');
            setTimeout(() => {
                if (typeof loadExamData === 'function') {
                    loadExamData();
                }
            }, 2000);
        },
        '数据存储': () => {
            console.log('[Recovery] 清理存储空间并重试');
            try {
                // 清理旧数据
                const keys = Object.keys(localStorage);
                const oldKeys = keys.filter(key => {
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        return data.timestamp && (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000);
                    } catch {
                        return false;
                    }
                });
                oldKeys.forEach(key => localStorage.removeItem(key));
                window.showMessage('已清理存储空间，请重试操作', 'info');
            } catch (recoveryError) {
                console.error('[Recovery] 存储恢复失败:', recoveryError);
            }
        },
        '跨窗口通信': () => {
            console.log('[Recovery] 重新建立跨窗口通信');
            // 重新初始化通信
            if (window.communicationManager && typeof window.communicationManager.reinitialize === 'function') {
                window.communicationManager.reinitialize();
            }
        },
        '文件加载': () => {
            console.log('[Recovery] 尝试备用文件加载方案');
            // 可以在这里实现备用加载逻辑
        }
    };

    const strategy = recoveryStrategies[context];
    if (strategy) {
        try {
            strategy();
        } catch (recoveryError) {
            console.error(`[Recovery] 恢复策略执行失败:`, recoveryError);
        }
    }
};

// 增强的全局JavaScript错误捕获
window.addEventListener('error', function (event) {
    const error = event.error || new Error(event.message);
    const context = event.filename ? `脚本加载 (${event.filename}:${event.lineno})` : '系统运行';

    // 检查是否是资源加载错误
    if (event.target && event.target !== window) {
        const resourceType = event.target.tagName.toLowerCase();
        const resourceSrc = event.target.src || event.target.href;
        window.handleResourceLoadError(resourceType, resourceSrc, event);
        return true;
    }

    window.handleError(error, context, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
    });
    return true; // 阻止默认错误处理
});

// 增强的Promise错误捕获
window.addEventListener('unhandledrejection', function (event) {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

    // 检查是否是网络请求错误
    if (event.reason && typeof event.reason === 'object' && event.reason.name === 'TypeError' &&
        event.reason.message.includes('fetch')) {
        window.handleError(error, '网络请求', {
            recoverable: true,
            userMessage: '网络请求失败，正在重试...'
        });
    } else {
        window.handleError(error, 'Promise处理', { recoverable: true });
    }

    event.preventDefault(); // 阻止默认错误处理
});

// 资源加载错误处理
window.handleResourceLoadError = function (resourceType, resourceSrc, event) {
    console.warn(`[ResourceError] ${resourceType} 加载失败:`, resourceSrc);

    const errorDetails = {
        type: 'resource_load_error',
        resourceType: resourceType,
        resourceSrc: resourceSrc,
        timestamp: Date.now()
    };

    // 尝试备用加载方案
    if (resourceType === 'script') {
        window.handleScriptLoadError(scriptSrc, event);
    } else if (resourceType === 'link') {
        window.handleStyleLoadError(resourceSrc, event);
    } else {
        window.showMessage(`资源加载失败: ${resourceSrc}`, 'warning');
    }
};

// 脚本加载错误处理
window.handleScriptLoadError = function (scriptSrc, event) {
    console.warn(`[ScriptError] 脚本加载失败: ${scriptSrc}`);

    // 记录失败的脚本
    if (!window.failedScripts) {
        window.failedScripts = new Set();
    }
    window.failedScripts.add(scriptSrc);

    // 尝试从备用路径加载
    const backupPaths = [
        scriptSrc.replace('/js/', '/backup/js/'),
        scriptSrc.replace('.js', '.min.js'),
        scriptSrc.replace('.min.js', '.js')
    ];

    let retryCount = 0;
    const maxRetries = backupPaths.length;

    const tryLoadScript = () => {
        if (retryCount >= maxRetries) {
            window.showMessage(`脚本加载失败，系统可能不稳定: ${scriptSrc}`, 'error');
            return;
        }

        const backupSrc = backupPaths[retryCount];
        retryCount++;

        const script = document.createElement('script');
        script.src = backupSrc;
        script.onload = () => {
            console.log(`[ScriptError] 备用脚本加载成功: ${backupSrc}`);
            window.showMessage('系统组件已恢复', 'success');
        };
        script.onerror = () => {
            console.warn(`[ScriptError] 备用脚本也失败: ${backupSrc}`);
            setTimeout(tryLoadScript, 1000);
        };
        document.head.appendChild(script);
    };

    // 延迟重试，避免立即重试
    setTimeout(tryLoadScript, 500);
};

// 样式加载错误处理
window.handleStyleLoadError = function (styleSrc, event) {
    console.warn(`[StyleError] 样式加载失败: ${styleSrc}`);
    window.showMessage('样式文件加载失败，界面可能显示异常', 'warning');
};

// 全局对象初始化
window.storage = {
    get: (key, defaultValue) => {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
        } catch (error) {
            window.handleError(error, '数据读取');
            return defaultValue;
        }
    },
    set: (key, value) => {
        try {
            // 检查存储空间
            const testKey = '_storage_test_';
            localStorage.setItem(testKey, 'test');
            localStorage.removeItem(testKey);

            // 存储数据
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                showMessage('存储空间不足，请清理浏览器数据', 'warning');
                // 尝试清理旧数据
                window.storage.cleanup();
                // 重试一次
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                    return true;
                } catch (retryError) {
                    window.handleError(retryError, '数据存储重试');
                    return false;
                }
            } else {
                window.handleError(error, '数据存储');
                return false;
            }
        }
    },
    remove: (key) => {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            window.handleError(error, '数据移除');
            return false;
        }
    },
    cleanup: () => {
        // 根据用户要求，禁用此功能以保留所有练习记录。
    }
};

// 错误处理器
window.errorHandler = {
    handle: (error, context) => {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error(`[${context}]`, error);
        }
        showMessage(`错误: ${error.message}`, 'error');
    }
};

// 工具函数已在 helpers.js 中定义，无需重复定义

const legacyStateAdapter = window.LegacyStateAdapter ? window.LegacyStateAdapter.getInstance() : null;
const initialLegacyFilter = legacyStateAdapter ? legacyStateAdapter.getBrowseFilter() : (window.__browseFilter || { category: 'all', type: 'all' });
const initialLegacyType = typeof window.__legacyBrowseType === 'string' ? window.__legacyBrowseType : (initialLegacyFilter.type || 'all');

// 题库数据和状态
let examIndex = legacyStateAdapter ? legacyStateAdapter.getExamIndex() : [];
let currentCategory = initialLegacyFilter.category || 'all';
let currentExamType = initialLegacyFilter.type || initialLegacyType || 'all';
let filteredExams = [];
let practiceRecords = legacyStateAdapter ? legacyStateAdapter.getPracticeRecords() : [];
let app = null; // 主应用实例
let pdfHandler = null; // PDF处理器实例
let browseStateManager = null; // 浏览状态管理器实例
function updateGlobalLegacyBrowseState(category, type) {
    const browseDescriptor = Object.getOwnPropertyDescriptor(window, '__browseFilter');
    if (!browseDescriptor || typeof browseDescriptor.set !== 'function') {
        try { window.__browseFilter = { category, type }; } catch (_) {}
    }

    const legacyTypeDescriptor = Object.getOwnPropertyDescriptor(window, '__legacyBrowseType');
    if (!legacyTypeDescriptor || typeof legacyTypeDescriptor.set !== 'function') {
        try { window.__legacyBrowseType = type; } catch (_) {}
    }
}

updateGlobalLegacyBrowseState(currentCategory, currentExamType);
let legacyExamListViewInstance = null;
let legacyExamActionsConfigured = false;
let legacyBackupDelegatesConfigured = false;

const LEGACY_EXAM_EMPTY_STATE = Object.freeze({
    icon: '📝',
    title: '暂无题目',
    description: '请先扫描题库来加载题目列表',
    actionGroupLabel: '题库操作',
    actions: [
        { action: 'load-library', label: '加载题库', variant: 'primary' }
    ]
});

if (typeof window !== 'undefined') {
    window.__legacyExamEmptyStateConfig = LEGACY_EXAM_EMPTY_STATE;
}

if (legacyStateAdapter) {
    legacyStateAdapter.subscribe('examIndex', (value) => {
        examIndex = Array.isArray(value) ? value : [];
    });
    legacyStateAdapter.subscribe('practiceRecords', (value) => {
        practiceRecords = Array.isArray(value) ? value : [];
    });
    legacyStateAdapter.subscribe('browseFilter', (value) => {
        const normalized = value && typeof value === 'object' ? value : { category: 'all', type: 'all' };
        currentCategory = typeof normalized.category === 'string' ? normalized.category : 'all';
        currentExamType = typeof normalized.type === 'string' ? normalized.type : 'all';
        updateGlobalLegacyBrowseState(currentCategory, currentExamType);
    });
}

function setExamIndexState(list) {
    const normalized = Array.isArray(list) ? list : [];
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setExamIndex(normalized);
        examIndex = Array.isArray(updated) ? updated : normalized;
        return examIndex;
    }
    examIndex = normalized;
    try { window.examIndex = normalized; } catch (_) {}
    return examIndex;
}

function setPracticeRecordsState(records) {
    const normalized = Array.isArray(records) ? records : [];
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setPracticeRecords(normalized);
        practiceRecords = Array.isArray(updated) ? updated : normalized;
        return practiceRecords;
    }
    practiceRecords = normalized;
    try { window.practiceRecords = normalized; } catch (_) {}
    return practiceRecords;
}

function setBrowseFilterState(category = 'all', type = 'all') {
    const normalized = {
        category: typeof category === 'string' ? category : 'all',
        type: typeof type === 'string' ? type : 'all'
    };
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setBrowseFilter(normalized);
        currentCategory = updated.category || 'all';
        currentExamType = updated.type || 'all';
        updateGlobalLegacyBrowseState(currentCategory, currentExamType);
    } else {
        currentCategory = normalized.category;
        currentExamType = normalized.type;
        updateGlobalLegacyBrowseState(currentCategory, currentExamType);
    }
    return { category: currentCategory, type: currentExamType };
}

// 练习记录数据（使用统一的键名）
let practiceRecordsInitialized = false;
let practiceStats = {
    totalPracticed: 0,
    totalScore: 0,
    totalTime: 0,
    streakDays: 0,
    lastPracticeDate: null
};

let practiceDashboardViewInstance = null;
let practiceHistoryScrollerInstance = null;
let practiceHistoryDelegatesBound = false;

const LEGACY_MESSAGE_ICONS = {
    error: '❌',
    success: '✅',
    warning: '⚠️',
    info: 'ℹ️'
};

function resolveDomAdapter() {
    if (typeof window === 'undefined') {
        return null;
    }
    const dom = window.DOM;
    if (dom && typeof dom.create === 'function' && typeof dom.replaceContent === 'function') {
        return dom;
    }
    return null;
}

function legacyAppendChildren(element, children) {
    const list = Array.isArray(children) ? children : [children];
    for (let i = 0; i < list.length; i += 1) {
        const child = list[i];
        if (child == null) continue;
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    }
}

function legacyCreateElement(tag, attributes = {}, children = []) {
    const adapter = resolveDomAdapter();
    if (adapter) {
        return adapter.create(tag, attributes, children);
    }

    const element = document.createElement(tag);
    const entries = Object.entries(attributes);
    for (let i = 0; i < entries.length; i += 1) {
        const [key, value] = entries[i];
        if (value == null) continue;

        if (key === 'className') {
            element.className = value;
            continue;
        }
        if (key === 'dataset' && typeof value === 'object') {
            Object.keys(value).forEach((dataKey) => {
                const dataValue = value[dataKey];
                if (dataValue != null) {
                    element.dataset[dataKey] = String(dataValue);
                }
            });
            continue;
        }
        if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
            continue;
        }
        element.setAttribute(key, value === true ? '' : value);
    }

    legacyAppendChildren(element, children);
    return element;
}

function legacyReplaceContent(container, content) {
    const adapter = resolveDomAdapter();
    if (adapter) {
        adapter.replaceContent(container, content);
        return;
    }

    if (!container) return;
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    legacyAppendChildren(container, content);
}

function toggleVisibility(element, shouldShow) {
    if (!element) return;
    if (element.classList && typeof element.classList.toggle === 'function') {
        element.classList.toggle('is-hidden', shouldShow === false);
        return;
    }
    element.style.display = shouldShow === false ? 'none' : '';
}

function lockBodyScroll(locked) {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }
    if (document.body.classList && typeof document.body.classList.toggle === 'function') {
        document.body.classList.toggle('no-scroll', Boolean(locked));
        return;
    }
    document.body.style.overflow = locked ? 'hidden' : '';
}

function ensureLegacyMessageContainer() {
    if (typeof document === 'undefined') {
        return null;
    }
    let container = document.getElementById('message-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'message-container';
        container.className = 'message-container';
        document.body.appendChild(container);
    }
    return container;
}

function createLegacyMessageNode(message, type) {
    const node = document.createElement('div');
    node.className = 'message ' + (type || 'info');
    const icon = document.createElement('strong');
    icon.textContent = LEGACY_MESSAGE_ICONS[type] || LEGACY_MESSAGE_ICONS.info;
    node.appendChild(icon);
    node.appendChild(document.createTextNode(' ' + String(message || '')));
    return node;
}

// PDF处理辅助函数
function openPDFSafely(pdfPath, examTitle) {
    if (!pdfHandler) {
        // 降级处理：直接在新窗口打开PDF
        const pdfWindow = window.open(pdfPath, `pdf_${Date.now()}`,
            'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
        if (pdfWindow) {
            showMessage(`正在打开PDF: ${examTitle}`, 'success');
        } else {
            showMessage('无法打开PDF文件，请允许弹窗或检查浏览器设置', 'error');
        }
        return pdfWindow;
    }

    // 使用PDF处理器打开
    return pdfHandler.openPDF(pdfPath, examTitle);
}

// 消息系统 - 改进版
function showMessage(message, type = 'info', duration = 4000) {
    if (typeof window !== 'undefined' && window.showMessage && window.showMessage !== showMessage) {
        window.showMessage(message, type, duration);
        return;
    }

    if (typeof document === 'undefined') {
        if (typeof console !== 'undefined') {
            const logMethod = type === 'error' ? 'error' : 'log';
            console[logMethod](`[LegacyMessage:${type}]`, message);
        }
        return;
    }

    const container = ensureLegacyMessageContainer();
    if (!container) {
        return;
    }

    const note = createLegacyMessageNode(message, type);
    container.appendChild(note);

    while (container.children.length > 3) {
        container.removeChild(container.firstChild);
    }

    const timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
    window.setTimeout(() => {
        note.classList.add('message-leaving');
        window.setTimeout(() => {
            if (note.parentNode) {
                note.parentNode.removeChild(note);
            }
        }, 320);
    }, timeout);
}

function ensureLegacyDataIntegrityManager() {
    if (typeof window === 'undefined') {
        return null;
    }

    if (!window.dataIntegrityManager && window.DataIntegrityManager) {
        try {
            window.dataIntegrityManager = new window.DataIntegrityManager();
        } catch (error) {
            console.warn('[LegacyBackup] 初始化 DataIntegrityManager 失败:', error);
        }
    }

    return window.dataIntegrityManager || null;
}

function legacyCreateElement(tag, attributes, children) {
    if (typeof document === 'undefined') {
        return null;
    }

    const element = document.createElement(tag);
    const attrs = attributes || {};

    Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value == null || value === false) {
            return;
        }

        if (key === 'className') {
            element.className = value;
            return;
        }

        if (key === 'dataset' && typeof value === 'object') {
            Object.keys(value).forEach((dataKey) => {
                const dataValue = value[dataKey];
                if (dataValue == null) {
                    return;
                }
                element.dataset[dataKey] = String(dataValue);
            });
            return;
        }

        if (key === 'ariaHidden') {
            element.setAttribute('aria-hidden', value === true ? 'true' : String(value));
            return;
        }

        if (key === 'ariaLabel') {
            element.setAttribute('aria-label', String(value));
            return;
        }

        if (key === 'text') {
            element.textContent = String(value);
            return;
        }

        element.setAttribute(key, value === true ? '' : String(value));
    });

    const normalizedChildren = Array.isArray(children) ? children : [children];
    normalizedChildren.forEach((child) => {
        if (child == null) {
            return;
        }

        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });

    return element;
}

function ensureLegacyBackupDelegates() {
    if (legacyBackupDelegatesConfigured || typeof document === 'undefined') {
        return;
    }

    const handler = (event) => {
        const target = event.target && event.target.closest
            ? event.target.closest('[data-backup-action]')
            : null;
        if (!target) {
            return;
        }

        const action = target.dataset.backupAction;
        if (action === 'restore') {
            event.preventDefault();
            const backupId = target.dataset.backupId;
            if (backupId) {
                legacyRestoreBackupById(backupId);
            }
            return;
        }

        if (action === 'close-modal') {
            event.preventDefault();
            const overlay = document.querySelector('.backup-modal-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    };

    document.addEventListener('click', handler);
    legacyBackupDelegatesConfigured = true;
}

async function legacyRestoreBackupById(backupId) {
    if (!backupId) {
        showMessage('无效的备份ID', 'error');
        return;
    }

    const manager = ensureLegacyDataIntegrityManager();
    if (!manager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    if (!confirm(`确定要恢复备份 ${backupId} 吗？当前数据将被覆盖。`)) {
        return;
    }

    try {
        showMessage('正在恢复备份...', 'info');
        await manager.restoreBackup(backupId);
        showMessage('备份恢复成功', 'success');
        setTimeout(() => {
            try {
                showBackupList();
            } catch (error) {
                console.warn('[LegacyBackup] 刷新备份列表失败:', error);
            }
        }, 1000);
    } catch (error) {
        console.error('[LegacyBackup] 恢复备份失败:', error);
        const detail = error && error.message ? error.message : error;
        showMessage('备份恢复失败: ' + detail, 'error');
    }
}

// 视图切换
function showView(viewName, resetCategory = true) {
    if (typeof document === 'undefined') {
        return;
    }

    const normalizedView = typeof viewName === 'string' && viewName ? viewName : 'overview';
    const targetId = normalizedView + '-view';
    const targetView = document.getElementById(targetId);

    if (!targetView) {
        console.warn('[Navigation] 未找到视图节点:', targetId);
        return;
    }

    document.querySelectorAll('.view.active').forEach(view => {
        view.classList.remove('active');
    });
    targetView.classList.add('active');

    let navSynced = false;
    if (typeof window.ensureLegacyNavigationController === 'function') {
        try {
            const controller = window.ensureLegacyNavigationController({
                containerSelector: '.main-nav',
                syncOnNavigate: false
            });
            if (controller && typeof controller.syncActive === 'function') {
                controller.syncActive(normalizedView);
                navSynced = true;
            }
        } catch (error) {
            console.warn('[Navigation] 同步导航状态失败:', error);
        }
    }

    if (!navSynced) {
        const navContainer = document.querySelector('.main-nav');
        if (navContainer) {
            const buttons = navContainer.querySelectorAll('.nav-btn');
            buttons.forEach(btn => {
                btn.classList.remove('active');
            });
            const navButton = navContainer.querySelector(`.nav-btn[data-view="${normalizedView}"]`);
            if (navButton) {
                navButton.classList.add('active');
            }
        }
    }

    if (normalizedView === 'browse') {
        // 只有在resetCategory为true时才重置分类
        if (resetCategory) {
            setBrowseFilterState('all', currentExamType);
            document.getElementById('browse-title').textContent = '📚 题库浏览';
        }
        loadExamList();
    } else if (normalizedView === 'practice') {
        updatePracticeView();
    }
}

function getViewName(viewName) {
    const names = {
        'overview': '总览',
        'browse': '题库浏览',
        'practice': '练习记录',
        'settings': '设置'
    };
    return names[viewName] || viewName;
}

// 优化的题库加载函数
async function loadLibrary() {
    const startTime = performance.now();
    const activeConfigKey = getActiveLibraryConfigurationKey();

    // 尝试从localStorage加载当前活动的题库
    const cachedData = await storage.get(activeConfigKey);
    if (cachedData) {
        console.log(`[System] 使用localStorage中key为'${activeConfigKey}'的题库数据`);
        examIndex = setExamIndexState(normalizeExamIndex(cachedData));
        storage.set(activeConfigKey, examIndex);

        let configName = '默认题库';
        if (activeConfigKey !== 'exam_index') {
            const timestamp = parseInt(activeConfigKey.replace('exam_index_', ''));
            if (!isNaN(timestamp)) {
                configName = `题库配置 ${new Date(timestamp).toLocaleString()}`;
            } else {
                configName = '自定义题库'; // Fallback name
            }
        }
        // 确保当前加载的配置存在于配置列表中
        saveLibraryConfiguration(configName, activeConfigKey, examIndex.length);

        updateOverview();
        updateSystemInfo();
        showMessage('题库已从本地存储加载', 'success');
        return;
    }

    showMessage('正在加载题库索引...', 'info');

    try {
        // 如果localStorage中没有，则尝试加载默认的 completeExamIndex
        if (!window.completeExamIndex || !Array.isArray(window.completeExamIndex)) {
            throw new Error('默认题库数据未正确加载');
        }

        const readingIndex = window.completeExamIndex.map(exam => ({
            ...exam,
            type: exam.type || 'reading'
        }));

        const listeningIndex = Array.isArray(window.listeningExamIndex)
            ? window.listeningExamIndex.map(exam => ({
                ...exam,
                type: exam.type || 'listening'
            }))
            : [];

        const combinedIndex = [...readingIndex, ...listeningIndex];

        if (combinedIndex.length === 0) {
            throw new Error('默认题库数据为空');
        }

        // 将默认题库保存为 'exam_index' 配置，并设置为活动
        examIndex = setExamIndexState(normalizeExamIndex(combinedIndex));
        storage.set('exam_index', examIndex);
        saveLibraryConfiguration('默认题库', 'exam_index', examIndex.length);
        setActiveLibraryConfiguration('exam_index');

        // 缓存题库数据 (如果performanceOptimizer存在)
        if (window.performanceOptimizer) {
            window.performanceOptimizer.setCache('exam_index', examIndex, {
                ttl: 1800000 // 30分钟缓存
            });
        }

        // 批量处理题库数据以避免阻塞UI
        if (window.performanceOptimizer && examIndex.length > 100) {
            window.performanceOptimizer.batchProcess(
                examIndex,
                (exam, index) => {
                    if (!exam.searchText) {
                        exam.searchText = `${exam.title} ${exam.category}`.toLowerCase();
                    }
                    return exam;
                },
                50, // 每批50个
                10  // 10ms延迟
            ).then(() => {
                finishLibraryLoading(startTime);
            });
        } else {
            examIndex.forEach(exam => {
                if (!exam.searchText) {
                    exam.searchText = `${exam.title} ${exam.category}`.toLowerCase();
                }
            });
            finishLibraryLoading(startTime);
        }

    } catch (error) {
        window.handleError(error, '题库加载');
        setTimeout(() => {
            showMessage('正在尝试备用加载方式...', 'info');
            loadLibraryFallback();
        }, 2000);
    }
}

// 完成题库加载
function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;

    if (window.performanceOptimizer) {
        window.performanceOptimizer.recordLoadTime(loadTime);
    }

    setExamIndexState(examIndex);

    const htmlCount = examIndex.filter(exam => exam.hasHtml).length;
    const pdfCount = examIndex.filter(exam => !exam.hasHtml).length;

    showMessage(
        `题库加载完成！共 ${examIndex.length} 个题目 (${htmlCount} 个HTML, ${pdfCount} 个PDF) - ${Math.round(loadTime)}ms`,
        'success'
    );

    updateOverview();
    updateSystemInfo();

    // ExamBrowser组件已移除，使用内置的题目列表功能
    console.log('[System] 题库数据已更新，题目列表将自动刷新');
}

// 题库加载降级方案
function loadLibraryFallback() {
    try {
        // 创建基本的题库结构
        examIndex = setExamIndexState(normalizeExamIndex([
            {
                id: 'fallback-notice',
                title: '题库加载异常，请刷新页面重试',
                category: 'P1',
                frequency: 'high',
                path: '',
                filename: '',
                hasHtml: false,
                hasPdf: false,
                type: 'reading'
            }
        ]));

        showMessage('已启用备用模式，功能可能受限', 'warning');
        updateOverview();

    } catch (error) {
        window.handleError(error, '备用加载');
        showMessage('系统初始化失败，请刷新页面', 'error');
    }
}

// 题库配置管理
const EXAM_CONFIGS_KEY = 'exam_index_configurations';
const ACTIVE_CONFIG_KEY = 'active_exam_index_key';

// 获取所有题库配置
async function getLibraryConfigurations() {
    return await storage.get(EXAM_CONFIGS_KEY, []);
}

// 保存题库配置
async function saveLibraryConfiguration(name, key, examCount) {
    const configs = await getLibraryConfigurations();
    const newConfig = { name, key, examCount, timestamp: Date.now() };
    // 避免重复添加
    if (!configs.some(config => config.key === key)) {
        configs.push(newConfig);
        storage.set(EXAM_CONFIGS_KEY, configs);
    }
}

// 设置活动题库配置
function setActiveLibraryConfiguration(key) {
    storage.set(ACTIVE_CONFIG_KEY, key);
}

// 获取活动题库配置的key
async function getActiveLibraryConfigurationKey() {
    return await storage.get(ACTIVE_CONFIG_KEY, 'exam_index'); // 默认使用 'exam_index'
}

// 触发文件夹选择器
function triggerFolderPicker() {
    const instructions = `请选择您的题库文件夹。

例如，名为 "睡着过项目组(9.4)[134篇]" 的文件夹。系统将自动扫描其中的题目。`;
    alert(instructions);
    document.getElementById('folder-picker').click();
}

// 处理文件夹选择
async function handleFolderSelection(event) {
    const files = event.target.files;
    if (files.length === 0) {
        showMessage('没有选择文件夹', 'warning');
        return;
    }

    const fileList = Array.from(files);
    const allowedExtensions = ['.html', '.htm', '.pdf'];

    // 验证文件夹内容
    let invalidFile = null;
    for (const file of fileList) {
        const fileName = file.name.toLowerCase();
        // 忽略macOS的.DS_Store文件和Windows的Thumbs.db
        if (fileName === '.ds_store' || fileName === 'thumbs.db') {
            continue;
        }
        const fileExt = fileName.substring(fileName.lastIndexOf('.'));
        if (!allowedExtensions.includes(fileExt)) {
            invalidFile = file.name;
            break;
        }
    }

    if (invalidFile) {
        showMessage(`错误：文件夹中包含不允许的文件类型 (${invalidFile})。请确保文件夹中只包含HTML和PDF文件。`, 'error');
        event.target.value = ''; // 重置选择器
        return;
    }

    const rootDirName = fileList.length > 0 ? fileList[0].webkitRelativePath.split('/')[0] : '新题库';
    showMessage(`正在扫描题库 "${rootDirName}"...`, 'info');

    setTimeout(() => {
        const commonBasePath = rootDirName ? `${rootDirName}/` : '';
        const newExamIndex = [];
        const seenDirectories = new Set();

        for (const file of fileList) {
            let fullRelativePath = file.webkitRelativePath;
            if (!fullRelativePath || !fullRelativePath.includes('/') || !file.name.toLowerCase().endsWith('.html')) continue;


            const pathParts = fullRelativePath.split('/');
            const htmlFileName = pathParts[pathParts.length - 1];
            const articleDir = pathParts[pathParts.length - 2];

            if (seenDirectories.has(articleDir)) continue;

            const match = articleDir.match(/^(?:[\d\.]+\s*)?(P[1-3])\s*-\s*(.*?)(?:【(.*?)】)?$/);

            if (match) {
                seenDirectories.add(articleDir);
                const category = match[1].trim();
                const title = match[2].trim();
                const frequency = match[3] ? (match[3] === '高' ? 'high' : 'low') : 'low';
                const id = `${category}_${title.replace(/\s/g, '_')}`;
                const relativePath = fullRelativePath.substring(0, fullRelativePath.lastIndexOf('/') + 1);

                newExamIndex.push({
                    id: id,
                    title: title,
                    category: category,
                    frequency: frequency,
                    path: relativePath,
                    filename: htmlFileName,
                    hasHtml: true,
                    hasPdf: true,
                    pdfFilename: htmlFileName.replace(/\.html?$/i, '.pdf')
                });
            }
        }

        if (newExamIndex.length > 0) {
            const configKey = `exam_index_${Date.now()}`;
            const configName = `题库: ${rootDirName}`;

            storage.set(configKey, newExamIndex);
            saveLibraryConfiguration(configName, configKey, newExamIndex.length);
            setActiveLibraryConfiguration(configKey);

            examIndex = setExamIndexState(newExamIndex);

            updateOverview();
            updateSystemInfo();
            if (document.getElementById('browse-view').classList.contains('active')) {
                loadExamList();
            }
            showMessage(`成功加载 ${newExamIndex.length} 个题目，并已切换到新题库！`, 'success');

            // 如果配置列表是打开的，则刷新它
            if (document.querySelector('.library-config-list')) {
                showLibraryConfigList();
            }

        } else {
            showMessage('在所选文件夹中未找到符合命名规范的HTML题目文件。', 'error');
        }
        event.target.value = '';
    }, 100);
}

// 显示题库配置列表
async function showLibraryConfigList(options) {
    if (typeof showLibraryConfigListV2 === 'function') {
        await showLibraryConfigListV2(Object.assign({ allowDelete: true }, options || {}));
        return;
    }

    const container = document.getElementById('settings-view');
    if (container && container.querySelector('.library-config-list')) {
        container.querySelector('.library-config-list').remove();
    }
    if (typeof showMessage === 'function') {
        showMessage('题库配置模块尚未准备就绪', 'warning');
    }
}

// 切换题库配置
function switchLibraryConfig(configKey) {
    if (confirm("确定要切换到此题库配置吗？")) {
        setActiveLibraryConfiguration(configKey);
        showMessage('正在切换题库配置，页面将刷新...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 删除题库配置
function deleteLibraryConfig(configKey) {
    if (confirm("确定要删除此题库配置吗？此操作不可恢复。")) {
        let configs = getLibraryConfigurations();
        configs = configs.filter(config => config.key !== configKey);
        storage.set(EXAM_CONFIGS_KEY, configs);
        storage.remove(configKey); // 移除实际的题库数据

        showMessage('题库配置已删除', 'success');
        showLibraryConfigList(); // 刷新列表
    }
}

// 加载题库数据（兼容性函数）
function loadExamData() {
    loadLibrary();
}

// 更新系统统计信息
function updateSystemInfo() {
    if (!examIndex || examIndex.length === 0) {
        return;
    }

    const totalExams = examIndex.length;
    const htmlExams = examIndex.filter(exam => exam.hasHtml).length;
    const pdfExams = examIndex.filter(exam => exam.hasPdf).length;

    // 更新显示
    const totalExamsEl = document.getElementById('total-exams');
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (totalExamsEl) totalExamsEl.textContent = totalExams;
    if (htmlExamsEl) htmlExamsEl.textContent = htmlExams;
    if (pdfExamsEl) pdfExamsEl.textContent = pdfExams;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}





// 随机练习 - 修复功能
function startRandomPractice(category) {
    const categoryExams = examIndex.filter(exam => exam.category === category);

    if (categoryExams.length === 0) {
        showMessage(`${category} 分类暂无可用题目，请先加载题库`, 'error');
        return;
    }

    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    showMessage(`随机选择: ${randomExam.title}`, 'info');

    // 延迟一下再打开，让用户看到选择的题目
    setTimeout(() => {
        openExam(randomExam.id);
    }, 1000);
}

// 筛选题目
function filterExams(filterType) {
    // 更新按钮状态
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    let filtered = [];
    let nextCategory = currentCategory;
    let nextType = currentExamType;

    switch (filterType) {
        case 'all':
            filtered = examIndex;
            nextCategory = 'all';
            break;
        case 'P1':
        case 'P2':
        case 'P3':
            filtered = examIndex.filter(exam => exam.category === filterType);
            nextCategory = filterType;
            break;
        case 'high':
            filtered = examIndex.filter(exam => exam.frequency === 'high');
            nextCategory = 'all';
            break;
        case 'low':
            filtered = examIndex.filter(exam => exam.frequency === 'low');
            nextCategory = 'all';
            break;
        default:
            filtered = examIndex;
    }

    setBrowseFilterState(nextCategory, nextType);

    filteredExams = filtered;
    displayExams(filteredExams);

    // 清空搜索框
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
        searchInput.value = '';
    }
}

// 优化的搜索题目函数
function searchExams(query) {
    // 使用防抖优化搜索性能
    if (window.performanceOptimizer) {
        const debouncedSearch = window.performanceOptimizer.debounce(
            performSearch,
            300,
            'exam_search'
        );
        debouncedSearch(query);
    } else {
        performSearch(query);
    }
}

// 执行搜索的核心函数
function performSearch(query) {
    const startTime = performance.now();

    if (!query.trim()) {
        displayExams(filteredExams);
        return;
    }

    const normalizedQuery = query.toLowerCase().trim();

    // 检查搜索缓存
    const cacheKey = `search_${normalizedQuery}_${currentCategory}`;
    if (window.performanceOptimizer) {
        const cachedResults = window.performanceOptimizer.getCache(cacheKey);
        if (cachedResults) {
            console.log('[Search] 使用缓存的搜索结果');
            displayExams(cachedResults);
            return;
        }
    }

    // 执行搜索
    const searchResults = filteredExams.filter(exam => {
        // 使用预处理的搜索文本提高性能
        if (exam.searchText) {
            return exam.searchText.includes(normalizedQuery);
        }

        // 降级到原始搜索方式
        return exam.title.toLowerCase().includes(normalizedQuery) ||
            exam.category.toLowerCase().includes(normalizedQuery);
    });

    // 缓存搜索结果
    if (window.performanceOptimizer && searchResults.length > 0) {
        window.performanceOptimizer.setCache(cacheKey, searchResults, {
            ttl: 300000 // 5分钟缓存
        });
    }

    const searchTime = performance.now() - startTime;
    console.log(`[Search] 搜索完成: ${searchResults.length} 个结果 (${Math.round(searchTime)}ms)`);

    displayExams(searchResults);
}

// 浏览分类
function browseCategory(category, type) {
    try {
        window.__pendingBrowseFilter = { category, type };
    } catch (_) {}

    // 优先使用 App 的统一处理
    if (window.app && typeof window.app.browseCategory === 'function') {
        window.app.browseCategory(category, type);
        return;
    }

    // 回退：直接展示浏览视图并应用筛选
    showView('browse', false); // 不重置分类
    if (typeof window.applyBrowseFilter === 'function') {
        window.applyBrowseFilter(category, type);
    } else {
        const normalizedType = typeof type === 'string' ? type : currentExamType;
        setBrowseFilterState(category || 'all', normalizedType);
        document.getElementById('browse-title').textContent = `📚 ${category} 题库浏览`;
        loadExamList();
    }
}

// 加载题目列表
function loadExamList() {
    const container = document.getElementById('exam-list-container');
    const loadingElement = document.querySelector('#browse-view .loading');

    // 显示loading状态
    if (loadingElement) {
        toggleVisibility(loadingElement, true);
    }

    setTimeout(() => {
        const pendingFilter = window.__pendingBrowseFilter || window.__browseFilter || {};
        const desiredCategory = (pendingFilter.category || currentCategory || 'all').toString().trim();
        const desiredType = (pendingFilter.type || window.__legacyBrowseType || 'all') || 'all';

        const sourceIndex = Array.isArray(window.examIndex) ? window.examIndex : examIndex;
        if (Array.isArray(sourceIndex) && sourceIndex !== examIndex) {
            examIndex = setExamIndexState(sourceIndex);
        }

        const normalizedCategory = desiredCategory ? desiredCategory.toUpperCase() : 'all';
        const normalizedType = desiredType || 'all';
        const activeFilter = setBrowseFilterState(normalizedCategory, normalizedType);

        let examsToShow = examIndex;

        if (activeFilter.type !== 'all') {
            examsToShow = examsToShow.filter(exam => (exam.type || 'reading') === activeFilter.type);
        }

        if (activeFilter.category !== 'all') {
            examsToShow = examsToShow.filter(exam => exam.category === activeFilter.category);
        }

        if (window.__pendingBrowseFilter) {
            delete window.__pendingBrowseFilter;
        }

        const browseTitle = document.getElementById('browse-title');
        if (browseTitle) {
            const categoryLabel = currentCategory !== 'all' ? `${currentCategory} ` : '';
            let typeLabel = '';
            if (desiredType === 'reading') typeLabel = '阅读';
            else if (desiredType === 'listening') typeLabel = '听力';
            browseTitle.textContent = categoryLabel
                ? `📚 ${categoryLabel}${typeLabel || '题库'}浏览`
                : '📚 题库浏览';
        }

        if (loadingElement) {
            toggleVisibility(loadingElement, false);
        }

        const sortedExams = sortExamsForDisplay(examsToShow);
        filteredExams = sortedExams;
        window.currentCategory = activeFilter.category;
        window.currentExamType = activeFilter.type;
        displayExams(sortedExams);
    }, 500);
}

function sortExamsForDisplay(exams) {
    const frequencyRank = { high: 0, medium: 1, low: 2 };
    return [...exams].sort((a, b) => {
        const rankA = frequencyRank[(a.frequency || '').toLowerCase()] ?? 3;
        const rankB = frequencyRank[(b.frequency || '').toLowerCase()] ?? 3;
        if (rankA !== rankB) return rankA - rankB;
        const pathA = (a.path || a.title || '').toString();
        const pathB = (b.path || b.title || '').toString();
        return pathA.localeCompare(pathB, 'zh-Hans-u-nu-latn', { numeric: true, sensitivity: 'base' });
    });
}

function normalizeExamIndex(list) {
    const listeningIds = new Set(
        Array.isArray(window.listeningExamIndex)
            ? window.listeningExamIndex.map(exam => exam.id)
            : []
    );

    return (Array.isArray(list) ? list : []).map(exam => {
        const normalized = { ...exam };
        if (!normalized.type) {
            normalized.type = listeningIds.has(normalized.id) ? 'listening' : 'reading';
        }
        if (!normalized.searchText) {
            normalized.searchText = `${normalized.title || ''} ${normalized.category || ''}`.toLowerCase();
        }
        return normalized;
    });
}

function cloneLegacyExamEmptyState() {
    const base = LEGACY_EXAM_EMPTY_STATE || {};
    const clonedActions = Array.isArray(base.actions)
        ? base.actions.map(action => ({
            action: action.action,
            label: action.label,
            variant: action.variant,
            ariaLabel: action.ariaLabel
        }))
        : [];

    return {
        icon: base.icon,
        title: base.title,
        description: base.description,
        actionGroupLabel: base.actionGroupLabel,
        actions: clonedActions
    };
}

function ensureLegacyExamListView() {
    if (!legacyExamListViewInstance && window.LegacyExamListView) {
        legacyExamListViewInstance = new window.LegacyExamListView({
            domAdapter: window.DOMAdapter,
            containerId: 'exam-list-container'
        });
    }
    return legacyExamListViewInstance;
}

function configureLegacyExamActionDelegation() {
    if (legacyExamActionsConfigured) {
        return;
    }

    const container = document.getElementById('exam-list-container');
    if (!container) {
        return;
    }

    container.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target || !container.contains(target)) {
            return;
        }

        const action = target.dataset.action;
        const examId = target.dataset.examId;
        if (!action || !examId) {
            return;
        }

        event.preventDefault();

        if (action === 'start' && typeof openExam === 'function') {
            openExam(examId);
            return;
        }

        if (action === 'pdf' && typeof viewPDF === 'function') {
            viewPDF(examId);
            return;
        }

        if (action === 'generate' && typeof generateHTML === 'function') {
            generateHTML(examId);
            return;
        }

        if (action === 'load-library') {
            if (typeof loadLibrary === 'function') {
                loadLibrary();
            } else if (typeof window.loadLibrary === 'function') {
                window.loadLibrary();
            }
        }
    });

    legacyExamActionsConfigured = true;
}

// 优化的题目列表显示函数
function displayExams(exams) {
    const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const normalizedExams = Array.isArray(exams) ? exams : [];
    const emptyStateConfig = cloneLegacyExamEmptyState();
    const view = ensureLegacyExamListView();

    if (view && typeof view.render === 'function') {
        view.render(normalizedExams, {
            loadingSelector: '#browse-view .loading',
            supportsGenerate: true,
            emptyState: emptyStateConfig
        });
        configureLegacyExamActionDelegation();
        finalizeExamRenderMetrics(startTime, normalizedExams.length);
        return;
    }

    renderLegacyExamListFallback(normalizedExams, emptyStateConfig);
    configureLegacyExamActionDelegation();
    finalizeExamRenderMetrics(startTime, normalizedExams.length);
}

function renderLegacyExamListFallback(exams, emptyStateConfig) {
    const container = document.getElementById('exam-list-container');
    if (!container) {
        return;
    }

    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    if (!exams.length) {
        const emptyNode = createLegacyExamEmptyStateNode(emptyStateConfig);
        if (emptyNode) {
            container.appendChild(emptyNode);
        }
        configureLegacyExamActionDelegation();
        hideLegacyLoadingIndicator('#browse-view .loading');
        return;
    }

    const list = document.createElement('div');
    list.className = 'exam-list';

    exams.forEach((exam) => {
        if (!exam) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'exam-item';
        if (exam.id) {
            item.dataset.examId = exam.id;
        }

        const info = document.createElement('div');
        info.className = 'exam-info';
        const infoContent = document.createElement('div');

        const title = document.createElement('h4');
        title.textContent = exam.title || '';
        const meta = document.createElement('div');
        meta.className = 'exam-meta';
        meta.textContent = `${exam.category || ''} | ${exam.type || ''}`;

        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);
        item.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'exam-actions';

        const hasHtml = !!exam.hasHtml;
        const startButton = document.createElement('button');
        startButton.className = hasHtml ? 'btn exam-item-action-btn' : 'btn btn-secondary exam-item-action-btn';
        startButton.type = 'button';
        startButton.dataset.action = 'start';
        if (exam.id) {
            startButton.dataset.examId = exam.id;
        }
        startButton.textContent = hasHtml ? '开始练习' : '查看PDF';
        actions.appendChild(startButton);

        const pdfButton = document.createElement('button');
        pdfButton.className = 'btn btn-secondary exam-item-action-btn';
        pdfButton.type = 'button';
        pdfButton.dataset.action = 'pdf';
        if (exam.id) {
            pdfButton.dataset.examId = exam.id;
        }
        pdfButton.textContent = '查看PDF';
        actions.appendChild(pdfButton);

        if (!hasHtml && typeof generateHTML === 'function') {
            const generateButton = document.createElement('button');
            generateButton.className = 'btn btn-info exam-item-action-btn';
            generateButton.type = 'button';
            generateButton.dataset.action = 'generate';
            if (exam.id) {
                generateButton.dataset.examId = exam.id;
            }
            generateButton.textContent = '生成HTML';
            actions.appendChild(generateButton);
        }

        item.appendChild(actions);
        list.appendChild(item);
    });

    container.appendChild(list);
    configureLegacyExamActionDelegation();
    hideLegacyLoadingIndicator('#browse-view .loading');
}

function createLegacyExamEmptyStateNode(emptyStateConfig) {
    const config = emptyStateConfig || cloneLegacyExamEmptyState();
    const wrapper = document.createElement('div');
    wrapper.className = 'exam-list-empty';
    wrapper.setAttribute('role', 'status');

    if (config.icon) {
        const icon = document.createElement('div');
        icon.className = 'exam-list-empty-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = config.icon;
        wrapper.appendChild(icon);
    }

    if (config.title) {
        const title = document.createElement('p');
        title.className = 'exam-list-empty-text';
        title.textContent = config.title;
        wrapper.appendChild(title);
    }

    if (config.description) {
        const description = document.createElement('p');
        description.className = 'exam-list-empty-hint';
        description.textContent = config.description;
        wrapper.appendChild(description);
    }

    if (Array.isArray(config.actions) && config.actions.length > 0) {
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'exam-list-empty-actions';
        actionsGroup.setAttribute('role', 'group');
        if (config.actionGroupLabel) {
            actionsGroup.setAttribute('aria-label', config.actionGroupLabel);
        }

        config.actions.forEach((action) => {
            if (!action || !action.action || !action.label) {
                return;
            }

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.action = action.action;
            button.className = 'btn exam-list-empty-action ' + (action.variant === 'secondary' ? 'btn-secondary' : 'btn-primary');
            button.textContent = action.label;
            if (action.ariaLabel) {
                button.setAttribute('aria-label', action.ariaLabel);
            }
            actionsGroup.appendChild(button);
        });

        if (actionsGroup.childNodes.length > 0) {
            wrapper.appendChild(actionsGroup);
        }
    }

    return wrapper;
}

function finalizeExamRenderMetrics(startTime, count) {
    const endTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const renderTime = Math.max(0, endTime - startTime);

    if (window.performanceOptimizer && typeof window.performanceOptimizer.recordRenderTime === 'function') {
        window.performanceOptimizer.recordRenderTime(renderTime);
    }

    console.log(`[Display] 渲染完成: ${count} 个题目 (${Math.round(renderTime)}ms)`);
}

function hideLegacyLoadingIndicator(selector) {
    const loading = document.querySelector(selector);
    if (loading) {
        toggleVisibility(loading, false);
    }
}



// 打开题目
function openExam(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) {
        showMessage('题目不存在', 'error');
        return;
    }

    showMessage(`正在打开: ${exam.title}`, 'info');

    try {
        // 如果是PDF文件，使用PDF查看功能
        if (!exam.hasHtml) {
            console.log('[System] 打开PDF文件:', exam.title);
            viewPDF(examId);
            return;
        }

        // Prefer unified path builder if available
        let fullPath;
        if (typeof window.buildResourcePath === 'function') {
            fullPath = window.buildResourcePath(exam, 'html');
        } else {
            const rawPath = exam.path + exam.filename;
            // Encode the path to handle special characters safely in file:/// URLs
            fullPath = './' + encodeURI(rawPath).replace(/%252F/g, '/');
        }

        // Add logging for the fullPath
        console.log('[openExam] Attempting to open encoded fullPath:', fullPath);

        const examWindow = window.open(fullPath, `exam_${exam.id}`,
            'width=1200,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=no,menubar=no,location=no'
        );

        if (examWindow) {
            showMessage(`题目已打开: ${exam.title}`, 'success');

            // 等待页面加载后发送初始化消息
            setTimeout(() => {
                if (examWindow && !examWindow.closed) {
                    try {
                        const initData = {
                            type: 'INIT_SESSION',
                            data: {
                                sessionId: examId + '_' + Date.now(),
                                examId: examId,
                                examTitle: exam.title,
                                examCategory: exam.category,
                                parentOrigin: window.location.origin,
                                timestamp: Date.now()
                            }
                        };
                        examWindow.postMessage(initData, '*');
                        console.log('[System] 发送初始化消息到练习页面:', initData);
                    } catch (error) {
                        console.warn('[System] 无法发送初始化消息:', error);
                    }
                }
            }, 2000);

        } else {
            showMessage('无法打开新窗口，请检查浏览器弹窗设置', 'error');
        }
    } catch (error) {
        console.error('[System] 打开题目失败:', error);
        showMessage('打开题目失败: ' + error.message, 'error');
    }
}

// 检查题目文件
function checkExamFile(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) {
        showMessage('题目不存在', 'error');
        return;
    }

    const fullPath = exam.path + exam.filename;
    showMessage(`检查文件: ${exam.filename}`, 'info');

    fetch(fullPath, { method: 'HEAD' })
        .then(response => {
            if (response.ok) {
                showMessage(`✅ 文件存在: ${exam.filename}`, 'success');
            } else {
                showMessage(`❌ 文件不存在 (${response.status}): ${exam.filename}`, 'error');
            }
        })
        .catch(error => {
            showMessage(`❌ 检查失败: ${error.message}`, 'error');
        });
}

// 生成HTML版本
function generateHTML(examId) {
    if (window.app && typeof window.app.generateHTMLForPDFExam === 'function') {
        window.app.generateHTMLForPDFExam(examId);
    } else {
        showMessage('HTML生成功能不可用', 'error');
    }
}



// 系统组件状态检查
function checkSystemStatus() {
    const components = {
        'ExamSystemApp': !!window.ExamSystemApp,
        'PracticeRecorder': !!window.PracticeRecorder,
        'PracticeHistory': !!window.PracticeHistory,
        'PracticePageEnhancer': !!window.practicePageEnhancer,
        'PracticeHistoryEnhancer': !!window.practiceHistoryEnhancer,
        'MarkdownExporter': !!window.MarkdownExporter,
        'PDFHandler': !!window.PDFHandler,
        'App Instance': !!window.app,
        'Practice Records': practiceRecords.length > 0,
        'Exam Index': examIndex.length > 0
    };

    let statusMessage = '系统组件状态:\n\n';
    let allGood = true;

    Object.entries(components).forEach(([name, status]) => {
        const icon = status ? '✅' : '❌';
        statusMessage += `${icon} ${name}: ${status ? '正常' : '未加载'}\n`;
        if (!status && name !== 'Practice Records') allGood = false;
    });

    if (window.app && window.app.components) {
        statusMessage += '\n应用组件:\n';
        Object.entries(window.app.components).forEach(([name, component]) => {
            const icon = component ? '✅' : '❌';
            statusMessage += `${icon} ${name}: ${component ? '已初始化' : '未初始化'}\n`;
        });
    }

    statusMessage += `
总体状态: ${allGood ? '✅ 系统正常' : '⚠️ 部分组件未加载'}`;

    alert(statusMessage);
    console.log('[System] 组件状态检查:', components);

    // 如果有组件未加载，尝试修复
    if (!allGood) {
        attemptComponentRecovery();
    }
}

// 数据一致性验证和修复
async function validateAndFixDataConsistency() {
    console.log('[System] 开始数据一致性验证和修复...');

    if (!window.DataConsistencyManager) {
        console.error('[System] DataConsistencyManager未加载');
        showMessage('数据一致性管理器未加载', 'error');
        return;
    }

    try {
        const manager = new DataConsistencyManager();
        const practiceRecords = await storage.get('practice_records', []);

        if (practiceRecords.length === 0) {
            showMessage('没有练习记录需要验证', 'info');
            return;
        }

        // 生成验证报告
        const report = manager.getDataQualityReport(practiceRecords);
        console.log('[System] 数据质量报告:', report);

        // 修复数据问题
        const fixedRecords = manager.fixDataInconsistencies(practiceRecords);

        // 保存修复后的数据
        storage.set('practice_records', fixedRecords);

        // 生成修复后报告
        const postFixReport = manager.getDataQualityReport(fixedRecords);
        console.log('[System] 修复后质量报告:', postFixReport);

        // 显示结果
        const improvedRecords = postFixReport.recordsWithCorrectAnswers - report.recordsWithCorrectAnswers;
        const improvedComparisons = postFixReport.recordsWithComparison - report.recordsWithComparison;

        let message = `数据验证完成！\n`;
        message += `总记录数: ${report.totalRecords}\n`;
        message += `有效记录: ${postFixReport.validRecords}\n`;
        message += `包含正确答案: ${postFixReport.recordsWithCorrectAnswers}`;

        if (improvedRecords > 0 || improvedComparisons > 0) {
            message += `\n\n修复结果:\n`;
            if (improvedRecords > 0) {
                message += `- 修复了 ${improvedRecords} 条记录的正确答案\n`;
            }
            if (improvedComparisons > 0) {
                message += `- 生成了 ${improvedComparisons} 条记录的答案比较数据\n`;
            }
        }

        showMessage('数据一致性验证和修复完成', 'success');
        alert(message);

    } catch (error) {
        console.error('[System] 数据验证修复失败:', error);
        showMessage('数据验证修复失败: ' + error.message, 'error');
    }
}

// 组件恢复尝试
function attemptComponentRecovery() {
    console.log('[System] 尝试修复未加载的组件...');

    // 检查并初始化PracticeHistory
    if (!window.PracticeHistory && window.practiceRecorder) {
        console.log('[System] 创建PracticeHistory降级实现');
        window.PracticeHistory = class {
            constructor() {
                this.initialized = true;
            }
            refreshHistory() {
                if (window.loadPracticeHistory) {
                    window.loadPracticeHistory();
                }
            }
        };
    }

    // 检查并初始化PracticePageEnhancer
    if (!window.practicePageEnhancer) {
        console.log('[System] 创建PracticePageEnhancer降级实现');
        window.practicePageEnhancer = {
            isInitialized: false,
            initialize: function () {
                this.isInitialized = true;
                console.log('[PracticePageEnhancer] 降级版本已初始化');
            },
            getStatus: function () {
                return {
                    isInitialized: this.isInitialized,
                    sessionId: null,
                    hasParentWindow: false,
                    answersCount: 0,
                    correctAnswersCount: 0,
                    interactionsCount: 0,
                    pageType: 'main'
                };
            }
        };
        window.practicePageEnhancer.initialize();
    }

    // 检查并初始化PracticeHistoryEnhancer
    if (!window.practiceHistoryEnhancer && window.MarkdownExporter) {
        console.log('[System] 创建PracticeHistoryEnhancer降级实现');
        window.practiceHistoryEnhancer = {
            initialized: false,
            initialize: function () {
                this.initialized = true;
                console.log('[PracticeHistoryEnhancer] 降级版本已初始化');
            },
            showExportDialog: function () {
                if (window.exportPracticeData) {
                    window.exportPracticeData();
                }
            }
        };
        window.practiceHistoryEnhancer.initialize();
    }

    console.log('[System] 组件恢复尝试完成');
}

// 查看PDF文件 - 函数已移至 main.js 以获得更好的维护性和一致性
// PDF viewing function moved to main.js for better maintenance and consistency

// 加载完整系统
function loadFullSystem() {
    if (confirm('确定要尝试加载完整系统吗？\n注意：如果index.html不存在，将显示错误页面。')) {
        showMessage('正在跳转到完整系统...', 'info');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }
}

// 清除缓存
async function clearCache() {
    if (confirm('确定要清除所有缓存数据并清空练习记录吗？')) {
        try {
            if (window.storage && typeof storage.set === 'function') {
                await storage.set('practice_records', []);
            } else {
                try { localStorage.removeItem('exam_system_practice_records'); } catch(_) {}
            }
        } catch (e) { console.warn('[clearCache] failed to clear practice_records:', e); }

        try { localStorage.clear(); } catch(_) {}
        try { sessionStorage.clear(); } catch(_) {}

        if (window.performanceOptimizer) {
            try { window.performanceOptimizer.cleanup(); } catch(_) {}
        }

        showMessage('缓存与练习记录已清除', 'success');
        setTimeout(() => { location.reload(); }, 1000);
    }
}

function createPerformanceMetric(label, value) {
    return legacyCreateElement('div', { className: 'performance-report__metric' }, [
        legacyCreateElement('span', { className: 'performance-report__metric-label' }, label),
        legacyCreateElement('span', { className: 'performance-report__metric-value' }, value)
    ]);
}

function buildPerformanceSection(title, metrics) {
    return legacyCreateElement('section', { className: 'performance-report__section' }, [
        legacyCreateElement('h4', { className: 'performance-report__section-title' }, title),
        legacyCreateElement('div', { className: 'performance-report__metrics' }, metrics)
    ]);
}

function bindPerformanceReportActions(element) {
    if (!element) {
        return;
    }

    element.addEventListener('click', (event) => {
        const target = event.target.closest('[data-performance-action]');
        if (!target || !element.contains(target)) {
            return;
        }

        if (target.dataset.performanceAction === 'dismiss') {
            event.preventDefault();
            element.remove();
        }
    });
}

// 显示性能报告
function showPerformanceReport() {
    if (!window.performanceOptimizer) {
        showMessage('性能优化器未初始化', 'warning');
        return;
    }

    const report = window.performanceOptimizer.getPerformanceReport() || {};
    const container = document.getElementById('settings-view');
    if (!container) {
        showMessage('设置视图未找到，无法显示性能报告', 'error');
        return;
    }

    const existingReport = container.querySelector('.performance-report');
    if (existingReport) {
        existingReport.remove();
    }

    const sections = [];

    if (report.cache) {
        sections.push(buildPerformanceSection('🗄️ 缓存统计', [
            createPerformanceMetric('缓存项数', String(report.cache.itemCount ?? 0)),
            createPerformanceMetric('缓存大小', `${Math.round((report.cache.totalSize || 0) / 1024)} KB`),
            createPerformanceMetric('命中率', `${Math.round(report.cache.hitRate || 0)}%`)
        ]));
    }

    if (report.performance) {
        sections.push(buildPerformanceSection('⚡ 性能指标', [
            createPerformanceMetric('平均加载时间', `${report.performance.averageLoadTime ?? 0} ms`),
            createPerformanceMetric('平均渲染时间', `${report.performance.averageRenderTime ?? 0} ms`),
            createPerformanceMetric('加载样本数', String(report.performance.totalLoadSamples ?? 0)),
            createPerformanceMetric('渲染样本数', String(report.performance.totalRenderSamples ?? 0))
        ]));
    }

    if (report.memory) {
        const usagePercent = report.memory.limit
            ? Math.round((report.memory.used / report.memory.limit) * 100)
            : 0;
        sections.push(buildPerformanceSection('💾 内存使用', [
            createPerformanceMetric('已使用', `${report.memory.used ?? 0} MB`),
            createPerformanceMetric('总计', `${report.memory.total ?? 0} MB`),
            createPerformanceMetric('限制', `${report.memory.limit ?? 0} MB`),
            createPerformanceMetric('使用率', `${usagePercent}%`)
        ]));
    }

    if (!sections.length) {
        sections.push(legacyCreateElement('p', { className: 'performance-report__empty' }, '暂无性能统计数据。'));
    }

    const card = legacyCreateElement('div', { className: 'performance-report__card' }, [
        legacyCreateElement('h3', { className: 'performance-report__title' }, [
            legacyCreateElement('span', { ariaHidden: 'true' }, '📊'),
            ' 系统性能报告'
        ]),
        ...sections,
        legacyCreateElement('div', { className: 'performance-report__actions' }, [
            legacyCreateElement('button', {
                type: 'button',
                className: 'btn btn-secondary',
                dataset: { performanceAction: 'dismiss' }
            }, '关闭')
        ])
    ]);

    const reportWrapper = legacyCreateElement('div', { className: 'performance-report' }, card);
    container.appendChild(reportWrapper);
    bindPerformanceReportActions(reportWrapper);

    showMessage('性能报告已生成', 'success');
}

// 数据管理功能

// 创建手动备份
async function createManualBackup() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    try {
        showMessage('正在创建备份...', 'info');
        const backup = await window.dataIntegrityManager.createBackup(null, 'manual');
        showMessage(`备份创建成功: ${backup.id}`, 'success');
    } catch (error) {
        console.error('[DataManagement] 创建备份失败:', error);
        showMessage('备份创建失败: ' + error.message, 'error');
    }
}

async function showBackupList() {
    const manager = ensureLegacyDataIntegrityManager();
    if (!manager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    ensureLegacyBackupDelegates();

    let backups = [];
    try {
        const list = await manager.getBackupList();
        backups = Array.isArray(list) ? list : [];
    } catch (error) {
        console.error('[LegacyBackup] 获取备份列表失败:', error);
        const detail = error && error.message ? error.message : error;
        showMessage('获取备份列表失败: ' + detail, 'error');
        return;
    }

    const domApi = (typeof window !== 'undefined' && window.DOM && typeof window.DOM.create === 'function')
        ? window.DOM
        : null;
    const create = domApi ? domApi.create.bind(window.DOM) : legacyCreateElement;

    const buildEntries = () => {
        if (!backups.length) {
            return [
                create('div', { className: 'backup-list-empty' }, [
                    create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
                    create('p', { className: 'backup-list-empty-text' }, '暂无备份记录。'),
                    create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
                ])
            ];
        }

        const nodes = backups.map((backup) => {
            if (!backup || !backup.id) {
                return null;
            }

            const timestamp = backup.timestamp ? new Date(backup.timestamp).toLocaleString() : '未知时间';
            const type = backup.type || 'unknown';
            const version = backup.version || '—';

            return create('div', {
                className: 'backup-entry',
                dataset: { backupId: backup.id }
            }, [
                create('div', { className: 'backup-entry-info' }, [
                    create('strong', { className: 'backup-entry-id' }, backup.id),
                    create('div', { className: 'backup-entry-meta' }, timestamp),
                    create('div', { className: 'backup-entry-meta' }, `类型: ${type} | 版本: ${version}`)
                ]),
                create('div', { className: 'backup-entry-actions' }, [
                    create('button', {
                        type: 'button',
                        className: 'btn btn-success backup-entry-restore',
                        dataset: {
                            backupAction: 'restore',
                            backupId: backup.id
                        }
                    }, '恢复')
                ])
            ]);
        }).filter(Boolean);

        if (!nodes.length) {
            return [
                create('div', { className: 'backup-list-empty' }, [
                    create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
                    create('p', { className: 'backup-list-empty-text' }, '暂无可恢复的备份记录。'),
                    create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
                ])
            ];
        }

        return nodes;
    };

    const settingsView = document.getElementById('settings-view');
    if (settingsView) {
        const legacyList = settingsView.querySelector('.backup-list');
        if (legacyList) {
            legacyList.remove();
        }
        const existingContainer = settingsView.querySelector('.backup-list-container');
        if (existingContainer) {
            existingContainer.remove();
        }
    }

    const existingOverlay = document.querySelector('.backup-modal-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const card = create('div', { className: 'backup-list-card' }, [
        create('div', { className: 'backup-list-header' }, [
            create('h3', { className: 'backup-list-title' }, [
                create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
                create('span', { className: 'backup-list-title-text' }, '备份列表')
            ])
        ]),
        create('div', { className: 'backup-list-scroll' }, buildEntries())
    ]);

    if (settingsView) {
        const container = create('div', { className: 'backup-list-container' }, card);
        const mainCard = settingsView.querySelector(':scope > div');
        if (mainCard) {
            mainCard.appendChild(container);
        } else {
            settingsView.appendChild(container);
        }

        if (!backups.length) {
            showMessage('暂无备份记录', 'info');
        }
        return;
    }

    const overlay = create('div', { className: 'backup-modal-overlay' }, [
        create('div', { className: 'backup-modal' }, [
            create('div', { className: 'backup-modal-header' }, [
                create('h3', { className: 'backup-modal-title' }, [
                    create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
                    create('span', { className: 'backup-list-title-text' }, '备份列表')
                ]),
                create('button', {
                    type: 'button',
                    className: 'btn btn-secondary backup-modal-close',
                    dataset: { backupAction: 'close-modal' },
                    ariaLabel: '关闭备份列表'
                }, '关闭')
            ]),
            create('div', { className: 'backup-modal-body' }, buildEntries()),
            create('div', { className: 'backup-modal-footer' }, [
                create('button', {
                    type: 'button',
                    className: 'btn btn-secondary backup-modal-close',
                    dataset: { backupAction: 'close-modal' }
                }, '关闭')
            ])
        ])
    ]);

    document.body.appendChild(overlay);

    if (!backups.length) {
        showMessage('暂无备份记录', 'info');
    }
}

async function restoreBackup(backupId) {
    await legacyRestoreBackupById(backupId);
}

// 导出所有数据
function exportAllData() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    try {
        showMessage('正在导出数据...', 'info');
        window.dataIntegrityManager.exportData();
        showMessage('数据导出成功', 'success');
    } catch (error) {
        console.error('[DataManagement] 导出数据失败:', error);
        showMessage('数据导出失败: ' + error.message, 'error');
    }
}

// 导入数据
function importData() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (!confirm('导入数据将覆盖当前数据，确定继续吗？')) {
            return;
        }

        try {
            showMessage('正在导入数据...', 'info');
            const result = await window.dataIntegrityManager.importData(file);
            showMessage(`数据导入成功: ${result.importedCount} 个项目`, 'success');

            setTimeout(() => {
                location.reload();
            }, 2000);
        } catch (error) {
            console.error('[DataManagement] 导入数据失败:', error);
            showMessage('数据导入失败: ' + error.message, 'error');
        }
    };

    input.click();
}

function buildValidationEntry(name, validation) {
    const normalized = validation || {};
    const errors = Array.isArray(normalized.errors) ? normalized.errors : [];
    const valid = normalized.valid !== false;
    const entry = legacyCreateElement('div', {
        className: 'validation-report__entry',
        dataset: { validationStatus: valid ? 'valid' : 'error' }
    }, [
        legacyCreateElement('div', { className: 'validation-report__entry-header' }, [
            legacyCreateElement('span', { ariaHidden: 'true' }, valid ? '✅' : '❌'),
            legacyCreateElement('span', null, `${name}: ${valid ? '正常' : `${errors.length} 个错误`}`)
        ]),
        !valid && errors.length
            ? legacyCreateElement('ul', { className: 'validation-report__errors' },
                errors.map((error) => legacyCreateElement('li', null, error)))
            : null
    ]);

    return { entry, errorCount: valid ? 0 : errors.length };
}

function createValidationReportElement(report) {
    const normalized = report || {};
    const timestamp = normalized.timestamp ? new Date(normalized.timestamp).toLocaleString() : '未知时间';
    const dataVersion = normalized.dataVersion || '未知';
    const backupCount = Array.isArray(normalized.backups) ? normalized.backups.length : 0;

    const validationEntries = normalized.validation && typeof normalized.validation === 'object'
        ? Object.entries(normalized.validation)
        : [];

    const listItems = [];
    let totalErrors = 0;

    for (let i = 0; i < validationEntries.length; i += 1) {
        const [name, validation] = validationEntries[i];
        const { entry, errorCount } = buildValidationEntry(name, validation);
        listItems.push(entry);
        totalErrors += errorCount;
    }

    if (!listItems.length) {
        listItems.push(legacyCreateElement('div', {
            className: 'validation-report__entry',
            dataset: { validationStatus: 'valid' }
        }, [
            legacyCreateElement('div', { className: 'validation-report__entry-header' }, [
                legacyCreateElement('span', { ariaHidden: 'true' }, 'ℹ️'),
                legacyCreateElement('span', null, '没有可用的验证条目')
            ])
        ]));
    }

    const statusText = totalErrors === 0
        ? '总体状态: ✅ 数据完整'
        : `总体状态: ⚠️ 发现 ${totalErrors} 个问题`;

    const element = legacyCreateElement('div', { className: 'validation-report' }, [
        legacyCreateElement('div', { className: 'validation-report__card' }, [
            legacyCreateElement('h3', { className: 'validation-report__title' }, [
                legacyCreateElement('span', { ariaHidden: 'true' }, '🔍'),
                ' 数据完整性报告'
            ]),
            legacyCreateElement('div', { className: 'validation-report__meta' }, [
                legacyCreateElement('div', { className: 'validation-report__meta-item' }, [
                    legacyCreateElement('strong', null, '检查时间'),
                    timestamp
                ]),
                legacyCreateElement('div', { className: 'validation-report__meta-item' }, [
                    legacyCreateElement('strong', null, '数据版本'),
                    dataVersion
                ]),
                legacyCreateElement('div', { className: 'validation-report__meta-item' }, [
                    legacyCreateElement('strong', null, '备份数量'),
                    String(backupCount)
                ])
            ]),
            legacyCreateElement('div', { className: 'validation-report__list' }, listItems),
            legacyCreateElement('div', { className: 'validation-report__status' }, statusText),
            legacyCreateElement('div', { className: 'validation-report__actions' }, [
                legacyCreateElement('button', {
                    type: 'button',
                    className: 'btn btn-secondary',
                    dataset: { validationAction: 'dismiss' }
                }, '关闭')
            ])
        ])
    ]);

    return { element, totalErrors };
}

function bindValidationReportActions(element) {
    if (!element) {
        return;
    }

    element.addEventListener('click', (event) => {
        const target = event.target.closest('[data-validation-action]');
        if (!target || !element.contains(target)) {
            return;
        }

        const action = target.dataset.validationAction;
        if (action === 'dismiss') {
            event.preventDefault();
            element.remove();
        }
    });
}

// 验证所有数据
function validateAllData() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    try {
        showMessage('正在检查数据完整性...', 'info');
        const report = window.dataIntegrityManager.getIntegrityReport();
        const container = document.getElementById('settings-view');

        if (!container) {
            console.warn('[DataManagement] settings-view 容器不存在，无法渲染数据完整性报告');
            return;
        }

        const existingReport = container.querySelector('.validation-report');
        if (existingReport) {
            existingReport.remove();
        }

        const { element: reportElement, totalErrors } = createValidationReportElement(report);
        container.appendChild(reportElement);
        bindValidationReportActions(reportElement);

        const messageType = totalErrors === 0 ? 'success' : 'warning';
        showMessage(`数据检查完成，${totalErrors === 0 ? '数据完整' : `发现 ${totalErrors} 个问题`}`, messageType);

    } catch (error) {
        console.error('[DataManagement] 数据验证失败:', error);
        showMessage('数据验证失败: ' + error.message, 'error');
    }
}



// 运行完整系统验证
function runCompleteSystemValidation() {
    if (typeof window.runSystemValidation !== 'function') {
        showMessage('系统验证脚本未加载', 'error');
        return;
    }

    showMessage('正在进行完整系统验证...', 'info');

    try {
        // 运行验证并显示结果
        const result = window.runSystemValidation();

        setTimeout(() => {
            const messageType = result.successRate >= 80 ? 'success' :
                result.successRate >= 60 ? 'info' : 'error';

            showMessage(
                `系统验证完成！通过率: ${result.successRate}% (${result.passed}/${result.total})`,
                messageType
            );

            if (result.successRate >= 80) {
                setTimeout(() => {
                    showMessage('🎉 系统功能完整，可以正常使用！', 'success');
                }, 1000);
            }
        }, 2000);

    } catch (error) {
        console.error('[SystemValidation] 验证失败:', error);
        showMessage('系统验证失败: ' + error.message, 'error');
    }
}

// 显示题库索引信息
function showExamIndexInfo() {
    console.log('[ExamIndex] 题库总数:', examIndex.length);

    if (examIndex.length > 0) {
        console.log('[ExamIndex] 前10个题目:');
        examIndex.slice(0, 10).forEach((exam, index) => {
            console.log(`${index + 1}. ID: ${exam.id}, 文件名: ${exam.filename}, 标题: ${exam.title}`);
        });

        // 检查是否有重复的文件名
        const filenames = examIndex.map(exam => exam.filename).filter(f => f);
        const uniqueFilenames = [...new Set(filenames)];
        if (filenames.length !== uniqueFilenames.length) {
            console.warn('[ExamIndex] 发现重复的文件名');
        }

        showMessage(`题库信息已输出到控制台，共 ${examIndex.length} 个题目`, 'info');
    } else {
        showMessage('题库为空，请先加载题库', 'error');
    }
}

// 显示开发团队弹窗
function showDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    modal.classList.add('show');

    // 阻止背景滚动
    lockBodyScroll(true);

    // 点击背景关闭弹窗
    modal.onclick = function (e) {
        if (e.target === modal) {
            hideDeveloperTeam();
        }
    };

    // ESC键关闭弹窗
    const handleEscape = function (e) {
        if (e.key === 'Escape') {
            hideDeveloperTeam();
            document.removeEventListener('keydown', handleEscape);
        }
    };
    document.addEventListener('keydown', handleEscape);
}

// 隐藏开发团队弹窗
function hideDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    modal.classList.remove('show');

    // 恢复背景滚动
    lockBodyScroll(false);

    // 移除点击事件
    modal.onclick = null;
}



// 修复不完整的标题
async function fixIncompleteTitles() {
    const records = await storage.get('practice_records', []);
    let fixedCount = 0;

    records.forEach(record => {
        if (record.dataSource === 'real' && record.realData) {
            // 检查是否需要修复标题
            const needsFix = record.title === 'P1' || record.title === 'P2' || record.title === 'P3' ||
                record.title === 'Unknown Practice' || record.title.includes('Unknown') ||
                record.title.length < 5; // 标题太短也需要修复

            if (needsFix && record.realData.url) {
                const urlParts = record.realData.url.split('/');
                let filename = urlParts[urlParts.length - 1];
                console.log(`[Fix] 原始文件名: ${filename}`);

                // URL解码
                try {
                    filename = decodeURIComponent(filename);
                    console.log(`[Fix] 解码后文件名: ${filename}`);
                } catch (e) {
                    console.log(`[Fix] URL解码失败，使用原始文件名`);
                }

                // 首先尝试通过文件名精确匹配
                let examInfo = examIndex.find(exam => exam.filename === filename);

                // 如果精确匹配失败，尝试不区分大小写匹配
                if (!examInfo) {
                    examInfo = examIndex.find(exam =>
                        exam.filename && exam.filename.toLowerCase() === filename.toLowerCase()
                    );
                }

                if (!examInfo) {
                    // 尝试从文件名中提取关键信息进行匹配
                    const cleanFilename = filename.replace(/\.(html?|php)$/i, '');
                    console.log(`[Fix] 清理后的文件名: ${cleanFilename}`);

                    // 提取分类和标题 - 处理格式如 "P2 - A new look for Talbot Park【高】"
                    const match = cleanFilename.match(/^(P[123])\s*[-–]\s*(.+?)(?:【.+】)?$/);
                    if (match) {
                        const [, category, titlePart] = match;
                        console.log(`[Fix] 提取的分类: ${category}, 标题部分: ${titlePart}`);

                        // 通过标题关键词匹配
                        const titleWords = titlePart.toLowerCase().split(/\s+/).filter(word => word.length > 2);
                        console.log(`[Fix] 标题关键词: ${titleWords.join(', ')}`);

                        examInfo = examIndex.find(exam => {
                            const examTitleLower = exam.title.toLowerCase();
                            const matchCount = titleWords.filter(word => examTitleLower.includes(word)).length;
                            return matchCount >= Math.min(2, titleWords.length);
                        });

                        if (examInfo) {
                            console.log(`[Fix] 通过关键词匹配找到: ${examInfo.title}`);
                        }
                    }
                }

                if (examInfo) {
                    console.log(`[Fix] 修复标题: "${record.title}" -> "${examInfo.title}"`);
                    record.title = examInfo.title;
                    record.category = examInfo.category;
                    record.frequency = examInfo.frequency;
                    fixedCount++;
                } else {
                    console.log(`[Fix] 无法找到匹配的题目: ${filename}`);
                }
            }
        }
    });

    if (fixedCount > 0) {
        await storage.set('practice_records', records);
        practiceRecords = setPracticeRecordsState(records);
        showMessage(`已修复 ${fixedCount} 个不完整的标题`, 'success');
        updatePracticeView();
    } else {
        showMessage('没有发现需要修复的标题', 'info');
    }
}

// 记录练习（已废弃，现在使用真实数据传输）
function recordPractice(exam, startTime) {
    console.log('[Practice] recordPractice函数已废弃，不再生成模拟数据');
    console.log('[Practice] 等待真实数据通过跨窗口通信传输');
    // 不再生成模拟数据，所有数据都通过跨窗口通信获取
}

// 计算练习统计与渲染辅助
function getPracticeRecordList() {
    return Array.isArray(practiceRecords) ? practiceRecords : [];
}

function filterRealPracticeRecords(records) {
    return records.filter((record) => record && record.dataSource === 'real' && record.realData);
}

function normalizePracticeRecord(record, index) {
    if (!record) {
        return null;
    }

    const payload = record.realData || {};
    const id = record.id || payload.id || `record-${index}`;
    const timestamp = record.date || payload.date || payload.completedAt || new Date().toISOString();
    const rawDuration = typeof payload.duration === 'number' ? payload.duration : (typeof record.duration === 'number' ? record.duration : 0);
    const accuracy = typeof payload.accuracy === 'number' ? payload.accuracy : record.accuracy;
    let percentage = 0;

    if (typeof payload.percentage === 'number') {
        percentage = payload.percentage;
    } else if (typeof record.percentage === 'number') {
        percentage = record.percentage;
    } else if (typeof accuracy === 'number') {
        percentage = accuracy <= 1 ? Math.round(accuracy * 100) : Math.round(accuracy);
    }

    return {
        id,
        title: record.title || payload.title || '未命名练习',
        date: timestamp,
        percentage,
        accuracy,
        duration: Number(rawDuration) || 0,
        category: (record.category || payload.category || '').toUpperCase(),
        examId: record.examId || payload.examId || null
    };
}

function calculateFallbackStreak(dateKeys) {
    if (!dateKeys.length) {
        return 0;
    }

    const sorted = dateKeys.map((key) => {
        const date = new Date(key);
        return isNaN(date.getTime()) ? null : date;
    }).filter(Boolean).sort((a, b) => b - a);

    if (!sorted.length) {
        return 0;
    }

    let streak = 0;
    let previous = new Date();

    for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const diff = Math.floor((previous - current) / (24 * 60 * 60 * 1000));
        if (diff <= 1) {
            streak += 1;
            previous = current;
        } else {
            break;
        }
    }

    return streak;
}

function fallbackCalculateSummary(records) {
    if (!records.length) {
        return {
            totalPracticed: 0,
            averageScore: 0,
            totalStudyMinutes: 0,
            streak: 0
        };
    }

    let totalScore = 0;
    let totalMinutes = 0;
    const dateKeys = new Set();

    for (let i = 0; i < records.length; i += 1) {
        const record = records[i];
        totalScore += Number(record.percentage) || 0;
        totalMinutes += (Number(record.duration) || 0) / 60;

        if (record.date) {
            const date = new Date(record.date);
            if (!isNaN(date.getTime())) {
                dateKeys.add(date.toISOString().slice(0, 10));
            }
        }
    }

    const averageScore = totalScore / records.length;
    const streak = calculateFallbackStreak(Array.from(dateKeys));

    return {
        totalPracticed: records.length,
        averageScore,
        totalStudyMinutes: totalMinutes,
        streak
    };
}

function computeCategoryStats(records) {
    const stats = {
        P1: { count: 0, avgScore: 0, totalTime: 0 },
        P2: { count: 0, avgScore: 0, totalTime: 0 },
        P3: { count: 0, avgScore: 0, totalTime: 0 }
    };

    ['P1', 'P2', 'P3'].forEach((category) => {
        const items = records.filter((record) => record.category === category);
        if (!items.length) {
            return;
        }

        const totalScore = items.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0);
        const totalMinutes = items.reduce((sum, item) => sum + ((Number(item.duration) || 0) / 60), 0);

        stats[category] = {
            count: items.length,
            avgScore: Math.round(totalScore / items.length),
            totalTime: Math.round(totalMinutes)
        };
    });

    return stats;
}

function calculatePracticeStats() {
    const rawRecords = getPracticeRecordList();
    const realRecords = filterRealPracticeRecords(rawRecords);
    const normalizedRecords = realRecords.map(normalizePracticeRecord).filter(Boolean);

    const statsApi = window.PracticeStats;
    const summary = statsApi && typeof statsApi.calculateSummary === 'function'
        ? statsApi.calculateSummary(normalizedRecords)
        : fallbackCalculateSummary(normalizedRecords);

    practiceStats.totalPracticed = summary.totalPracticed || 0;
    practiceStats.avgScore = Math.round(summary.averageScore || 0);
    practiceStats.totalTime = Math.round(summary.totalStudyMinutes || 0);
    practiceStats.streakDays = summary.streak || 0;
    practiceStats.categoryStats = computeCategoryStats(normalizedRecords);

    return { normalizedRecords, summary };
}

function ensurePracticeDashboardView() {
    if (practiceDashboardViewInstance) {
        return practiceDashboardViewInstance;
    }
    if (!window.PracticeDashboardView) {
        return null;
    }
    practiceDashboardViewInstance = new window.PracticeDashboardView({
        totalId: 'total-practiced',
        averageId: 'avg-score',
        durationId: 'study-time',
        streakId: 'streak-days'
    });
    return practiceDashboardViewInstance;
}

function updatePracticeSummaryFallback(summary) {
    const safeSummary = summary || {};
    const totalPracticedEl = document.getElementById('total-practiced');
    const avgScoreEl = document.getElementById('avg-score');
    const studyTimeEl = document.getElementById('study-time');
    const streakDaysEl = document.getElementById('streak-days');

    if (totalPracticedEl) {
        totalPracticedEl.textContent = safeSummary.totalPracticed || 0;
    }
    if (avgScoreEl) {
        const avgScore = Math.round(safeSummary.averageScore || 0);
        avgScoreEl.textContent = `${avgScore}%`;
    }
    if (studyTimeEl) {
        studyTimeEl.textContent = Math.round(safeSummary.totalStudyMinutes || 0);
    }
    if (streakDaysEl) {
        streakDaysEl.textContent = Math.round(safeSummary.streak || 0);
    }
}

function getBulkDeleteModeState() {
    if (typeof window.bulkDeleteMode === 'boolean') {
        return window.bulkDeleteMode;
    }
    if (window.app && typeof window.app.getState === 'function') {
        try {
            const stateValue = window.app.getState('practice.bulkDeleteMode');
            if (typeof stateValue === 'boolean') {
                return stateValue;
            }
        } catch (_) {}
    }
    if (typeof window.__legacyBulkDeleteMode === 'boolean') {
        return window.__legacyBulkDeleteMode;
    }
    return false;
}

function getSelectedRecordsSet() {
    if (window.selectedRecords instanceof Set) {
        return window.selectedRecords;
    }
    if (!window.__legacySelectedRecords) {
        window.__legacySelectedRecords = new Set();
    }
    return window.__legacySelectedRecords;
}

function ensurePracticeHistoryDelegates(container) {
    if (practiceHistoryDelegatesBound || !container) {
        return;
    }

    const dom = resolveDomAdapter();

    const bindSelection = (event, element) => {
        if (!element) {
            return;
        }
        handlePracticeHistoryItemSelection(element.dataset.recordId, event);
    };

    const bindAction = (event, element) => {
        if (!element) {
            return;
        }
        handlePracticeHistoryAction(element.dataset.recordAction, element.dataset.recordId, event);
    };

    if (dom && typeof dom.delegate === 'function') {
        dom.delegate('click', '#practice-history-list [data-record-action]', function(event) {
            bindAction(event, this);
        });
        dom.delegate('click', '#practice-history-list .history-item', function(event) {
            const actionTarget = event.target.closest('[data-record-action]');
            if (actionTarget) {
                return;
            }
            bindSelection(event, this);
        });
    } else {
        container.addEventListener('click', (event) => {
            const actionTarget = event.target.closest('[data-record-action]');
            if (actionTarget && container.contains(actionTarget)) {
                bindAction(event, actionTarget);
                return;
            }

            const item = event.target.closest('.history-item');
            if (item && container.contains(item)) {
                const nestedAction = event.target.closest('[data-record-action]');
                if (nestedAction) {
                    return;
                }
                bindSelection(event, item);
            }
        });
    }

    practiceHistoryDelegatesBound = true;
}

function handlePracticeHistoryAction(action, recordId, event) {
    if (!action || !recordId) {
        return;
    }
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (action === 'details') {
        if (typeof showRecordDetails === 'function') {
            showRecordDetails(recordId);
        }
        return;
    }

    if (action === 'delete') {
        if (typeof window.deleteRecord === 'function') {
            window.deleteRecord(recordId);
        } else {
            fallbackDeletePracticeRecord(recordId);
        }
    }
}

function handlePracticeHistoryItemSelection(recordId, event) {
    if (!getBulkDeleteModeState() || !recordId) {
        return;
    }
    if (event) {
        event.preventDefault();
    }

    if (typeof window.toggleRecordSelection === 'function') {
        window.toggleRecordSelection(recordId);
        return;
    }

    fallbackToggleRecordSelection(recordId);
}

function fallbackToggleRecordSelection(recordId) {
    const selectedSet = getSelectedRecordsSet();
    if (selectedSet.has(recordId)) {
        selectedSet.delete(recordId);
    } else {
        selectedSet.add(recordId);
    }
    window.__legacyBulkDeleteMode = true;
    requestAnimationFrame(updatePracticeView);
}

function fallbackDeletePracticeRecord(recordId) {
    const index = practiceRecords.findIndex((record) => record && record.id === recordId);
    if (index === -1) {
        showMessage('记录不存在', 'error');
        return;
    }

    practiceRecords.splice(index, 1);
    storage.set('practice_records', practiceRecords);
    showMessage('练习记录已删除', 'success');
    requestAnimationFrame(updatePracticeView);
}

function formatDurationShort(seconds) {
    if (window.PracticeHistoryRenderer && window.PracticeHistoryRenderer.helpers && typeof window.PracticeHistoryRenderer.helpers.formatDurationShort === 'function') {
        return window.PracticeHistoryRenderer.helpers.formatDurationShort(seconds);
    }

    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    if (totalSeconds < 60) {
        return `${totalSeconds}秒`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) {
        return `${minutes}分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const remain = minutes % 60;
    return `${hours}小时${remain}分钟`;
}

function renderPracticeHistoryFallback(container, records, options) {
    if (!container) {
        return;
    }

    const opts = Object.assign({
        bulkDeleteMode: false,
        selectedRecords: new Set()
    }, options || {});

    if (!records.length) {
        legacyReplaceContent(container, legacyCreateElement('div', { className: 'practice-history-empty' }, [
            legacyCreateElement('div', { className: 'practice-history-empty-icon' }, '📂'),
            legacyCreateElement('p', { className: 'practice-history-empty-text' }, '暂无任何练习记录')
        ]));
        return;
    }

    const fragment = [];
    const limit = Math.min(records.length, 50);

    for (let i = 0; i < limit; i += 1) {
        const record = records[i];
        if (!record) {
            continue;
        }

        const item = legacyCreateElement('div', {
            className: 'history-item',
            dataset: { recordId: record.id }
        });

        if (opts.bulkDeleteMode && item.classList) {
            item.classList.add('history-item-selectable');
            if (opts.selectedRecords && opts.selectedRecords.has(record.id)) {
                item.classList.add('history-item-selected');
            }
        }

        const info = legacyCreateElement('div', {
            className: 'record-info' + (opts.bulkDeleteMode ? ' record-info-selectable' : '')
        }, [
            legacyCreateElement('a', {
                href: '#',
                className: 'practice-record-title',
                dataset: { recordAction: 'details', recordId: record.id }
            }, legacyCreateElement('strong', null, record.title || '未命名练习')),
            legacyCreateElement('div', { className: 'record-meta-line' }, [
                legacyCreateElement('small', { className: 'record-date' }, record.date ? new Date(record.date).toLocaleString() : '未知时间'),
                legacyCreateElement('small', { className: 'record-duration-value' }, [
                    legacyCreateElement('strong', null, '用时'),
                    legacyCreateElement('strong', { className: 'duration-time' }, formatDurationShort(record.duration))
                ])
            ])
        ]);

        item.appendChild(info);

        item.appendChild(legacyCreateElement('div', { className: 'record-percentage-container' }, [
            legacyCreateElement('div', { className: 'record-percentage' }, `${Math.round(Number(record.percentage) || 0)}%`)
        ]));

        if (!opts.bulkDeleteMode) {
            item.appendChild(legacyCreateElement('div', { className: 'record-actions-container' }, [
                legacyCreateElement('button', {
                    type: 'button',
                    className: 'delete-record-btn',
                    title: '删除此记录',
                    dataset: { recordAction: 'delete', recordId: record.id }
                }, '🗑️')
            ]));
        }

        fragment.push(item);
    }

    legacyReplaceContent(container, fragment);
}

function filterRecordsByExamTypeFallback(records, exams, type) {
    if (!type || type === 'all') {
        return records;
    }

    const index = Array.isArray(exams) ? exams : [];
    return records.filter((record) => {
        const exam = index.find((item) => item && (item.id === record.examId || item.title === record.title));
        return exam ? exam.type === type : false;
    });
}

// 更新练习视图
function updatePracticeView() {
    const { normalizedRecords, summary } = calculatePracticeStats();

    const dashboard = ensurePracticeDashboardView();
    if (dashboard) {
        dashboard.updateSummary({
            totalPracticed: summary.totalPracticed || 0,
            averageScore: summary.averageScore || 0,
            totalStudyMinutes: summary.totalStudyMinutes || 0,
            streak: summary.streak || 0
        });
    } else {
        updatePracticeSummaryFallback(summary);
    }

    const historyContainer = document.getElementById('practice-history-list');
    if (!historyContainer) {
        return;
    }

    ensurePracticeHistoryDelegates(historyContainer);

    const renderer = window.PracticeHistoryRenderer;
    const examType = typeof window.currentExamType === 'string' ? window.currentExamType : 'all';
    const index = Array.isArray(window.examIndex) ? window.examIndex : examIndex;

    let recordsToRender = normalizedRecords;
    if (examType && examType !== 'all') {
        const statsApi = window.PracticeStats;
        if (statsApi && typeof statsApi.filterByExamType === 'function') {
            recordsToRender = statsApi.filterByExamType(recordsToRender, index, examType);
        } else {
            recordsToRender = filterRecordsByExamTypeFallback(recordsToRender, index, examType);
        }
    }

    const bulkDeleteMode = getBulkDeleteModeState();
    const selectedSet = getSelectedRecordsSet();

    if (!renderer) {
        renderPracticeHistoryFallback(historyContainer, recordsToRender, {
            bulkDeleteMode,
            selectedRecords: selectedSet
        });
        return;
    }

    renderer.destroyScroller(practiceHistoryScrollerInstance);
    practiceHistoryScrollerInstance = null;

    if (!recordsToRender.length) {
        renderer.renderEmptyState(historyContainer);
        return;
    }

    practiceHistoryScrollerInstance = renderer.renderList(historyContainer, recordsToRender, {
        bulkDeleteMode,
        selectedRecords: selectedSet,
        scrollerOptions: { itemHeight: 100, containerHeight: 650 }
    });
}

// 导出练习数据 - 使用异步导出处理器
async function exportPracticeData() {
    if (practiceRecords.length === 0) {
        showMessage('暂无练习数据可导出', 'info');
        return;
    }

    try {
        // 使用异步导出处理器
        if (window.AsyncExportHandler) {
            const exportHandler = new AsyncExportHandler();
            const result = await exportHandler.exportWithProgress(practiceRecords, 'markdown');
            showMessage(`导出成功: ${result.filename} (${result.recordCount}条记录)`, 'success');
        } else {
            // 降级到简单导出，但添加延迟避免冻结
            showMessage('正在准备导出...', 'info');

            setTimeout(() => {
                try {
                    const data = {
                        exportDate: new Date().toISOString(),
                        stats: practiceStats,
                        records: practiceRecords
                    };

                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `practice-records-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    showMessage('练习数据已导出', 'success');
                } catch (error) {
                    console.error('导出失败:', error);
                    showMessage('导出失败: ' + error.message, 'error');
                }
            }, 100);
        }
    } catch (error) {
        console.error('导出过程出错:', error);
        showMessage('导出失败: ' + error.message, 'error');
    }
}

// 显示练习记录详情
function showRecordDetails(recordId) {
    try {
        const record = practiceRecords.find(r => r.id === recordId);

        if (!record) {
            showMessage('记录不存在', 'error');
            return;
        }

        // 使用练习记录弹窗组件显示详情
        if (window.practiceRecordModal) {
            window.practiceRecordModal.show(record);
        } else {
            // 降级显示基本信息
            const date = new Date(record.date);
            const accuracy = Math.round(record.accuracy * 100);
            const duration = Math.round(record.duration / 60);

            alert(`练习记录详情：\n\n题目：${record.title}\n分类：${record.category}\n时间：${date.toLocaleString()}\n准确率：${accuracy}%\n用时：${duration}分钟`);
        }
    } catch (error) {
        console.error('[Practice] 显示记录详情失败:', error);
        showMessage('显示记录详情失败: ' + error.message, 'error');
    }
}

// 异步初始化练习记录数据
async function initializePracticeRecords() {
    if (practiceRecordsInitialized) return;

    try {
        practiceRecords = setPracticeRecordsState(await storage.get('practice_records', []));
        practiceRecordsInitialized = true;
        console.log('[Script] 练习记录数据初始化完成，共', practiceRecords.length, '条记录');
    } catch (error) {
        console.error('[Script] 练习记录初始化失败:', error);
        practiceRecords = setPracticeRecordsState([]);
        practiceRecordsInitialized = true;
    }
}

// 确保练习记录已初始化的辅助函数
async function ensurePracticeRecordsInitialized() {
    if (!practiceRecordsInitialized) {
        await initializePracticeRecords();
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initializePracticeRecords();
});
