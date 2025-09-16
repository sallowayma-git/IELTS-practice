
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

// 题库数据和状态
let examIndex = [];
let currentCategory = 'all';
let filteredExams = [];
let app = null; // 主应用实例
let pdfHandler = null; // PDF处理器实例
let browseStateManager = null; // 浏览状态管理器实例

// 练习记录数据（使用统一的键名）
let practiceRecords = JSON.parse(localStorage.getItem('practice_records') || '[]');
let practiceStats = {
    totalPracticed: 0,
    totalScore: 0,
    totalTime: 0,
    streakDays: 0,
    lastPracticeDate: null
};

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
    const messageContainer = document.getElementById('message-container');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    messageDiv.innerHTML = `<strong>${icon}</strong> ${message}`;

    messageContainer.appendChild(messageDiv);

    // 自动移除消息
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }
    }, duration);

    // 限制消息数量
    const messages = messageContainer.children;
    if (messages.length > 3) {
        messageContainer.removeChild(messages[0]);
    }
}

// 视图切换
function showView(viewName, resetCategory = true) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });

    document.getElementById(viewName + '-view').classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    const activeBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn =>
        btn.textContent.includes(getViewName(viewName))
    );
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    if (viewName === 'browse') {
        // 只有在resetCategory为true时才重置分类
        if (resetCategory) {
            currentCategory = 'all';
            document.getElementById('browse-title').textContent = '📚 题库浏览';
        }
        loadExamList();
    } else if (viewName === 'practice') {
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
function loadLibrary() {
    const startTime = performance.now();
    const activeConfigKey = getActiveLibraryConfigurationKey();

    // 尝试从localStorage加载当前活动的题库
    const cachedData = storage.get(activeConfigKey);
    if (cachedData) {
        console.log(`[System] 使用localStorage中key为'${activeConfigKey}'的题库数据`);
        examIndex = cachedData;

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

        examIndex = [...window.completeExamIndex];

        if (examIndex.length === 0) {
            throw new Error('默认题库数据为空');
        }

        // 将默认题库保存为 'exam_index' 配置，并设置为活动
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
        examIndex = [
            {
                id: 'fallback-notice',
                title: '题库加载异常，请刷新页面重试',
                category: 'P1',
                frequency: 'high',
                path: '',
                filename: '',
                hasHtml: false,
                hasPdf: false
            }
        ];

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
function getLibraryConfigurations() {
    return storage.get(EXAM_CONFIGS_KEY, []);
}

// 保存题库配置
function saveLibraryConfiguration(name, key, examCount) {
    const configs = getLibraryConfigurations();
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
function getActiveLibraryConfigurationKey() {
    return storage.get(ACTIVE_CONFIG_KEY, 'exam_index'); // 默认使用 'exam_index'
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

            examIndex = newExamIndex;

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
function showLibraryConfigList() {
    const configs = getLibraryConfigurations();

    if (configs.length === 0) {
        showMessage('暂无题库配置记录', 'info');
        return;
    }

    let configHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>📚 题库配置列表</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    configs.forEach(config => {
        const date = new Date(config.timestamp).toLocaleString();
        const isActive = getActiveLibraryConfigurationKey() === config.key;
        const activeIndicator = isActive ? '✅ (当前)' : '';

        configHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${config.name}</strong> ${activeIndicator}<br>
                            <small>${date} • ${config.examCount} 个题目</small>
                        </div>
                        <div>
                            <button class="btn btn-secondary" onclick="switchLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>切换</button>
                            <button class="btn btn-warning" onclick="deleteLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>删除</button>
                        </div>
                    </div>
                `;
    });

    configHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button>
                </div>
            `;

    // 显示配置列表
    const container = document.getElementById('settings-view');
    const existingList = container.querySelector('.library-config-list');
    if (existingList) {
        existingList.remove();
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'library-config-list';
    listDiv.innerHTML = configHtml;
    container.appendChild(listDiv);
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

    switch (filterType) {
        case 'all':
            filtered = examIndex;
            currentCategory = 'all';
            break;
        case 'P1':
        case 'P2':
        case 'P3':
            filtered = examIndex.filter(exam => exam.category === filterType);
            currentCategory = filterType;
            break;
        case 'high':
            filtered = examIndex.filter(exam => exam.frequency === 'high');
            currentCategory = 'all';
            break;
        case 'low':
            filtered = examIndex.filter(exam => exam.frequency === 'low');
            currentCategory = 'all';
            break;
        default:
            filtered = examIndex;
    }

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
function browseCategory(category) {
    currentCategory = category;
    document.getElementById('browse-title').textContent = `📚 ${category} 题库浏览`;
    showView('browse', false); // 不重置分类
}

// 加载题目列表
function loadExamList() {
    const container = document.getElementById('exam-list-container');
    const loadingElement = document.querySelector('#browse-view .loading');

    // 显示loading状态
    if (loadingElement) {
        loadingElement.style.display = 'block';
    }

    setTimeout(() => {
        let examsToShow = examIndex;

        if (currentCategory !== 'all') {
            examsToShow = examIndex.filter(exam => exam.category === currentCategory);
        }

        // 隐藏loading状态
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }

        if (examsToShow.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; background: rgba(255, 255, 255, 0.1); border-radius: 10px;">
                    <h3>📝 暂无题目</h3>
                    <p style="margin: 15px 0; opacity: 0.8;">请先扫描题库来加载题目列表</p>
                    <button class="btn" onclick="loadLibrary()">加载题库</button>
                </div>
            `;
            return;
        }

        filteredExams = examsToShow;
        displayExams(filteredExams);
    }, 500);
}

// 优化的题目列表显示函数
function displayExams(exams) {
    const startTime = performance.now();
    const container = document.getElementById('exam-list-container');

    if (exams.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; background: rgba(255, 255, 255, 0.1); border-radius: 10px;">
                <h3>🔍 未找到匹配的题目</h3>
                <p style="opacity: 0.8;">请尝试其他搜索关键词</p>
            </div>
        `;
        return;
    }

    // 清理之前的虚拟滚动器
    if (window.currentVirtualScroller) {
        window.currentVirtualScroller.destroy();
        window.currentVirtualScroller = null;
    }

    // 对于大量数据使用虚拟滚动
    if (exams.length > 50 && window.performanceOptimizer) {
        console.log(`[Display] 使用虚拟滚动显示 ${exams.length} 个题目`);
        setupVirtualScrolling(container, exams);
    } else {
        // 对于少量数据使用传统渲染
        renderExamList(container, exams);
    }

    const renderTime = performance.now() - startTime;
    if (window.performanceOptimizer) {
        window.performanceOptimizer.recordRenderTime(renderTime);
    }

    console.log(`[Display] 渲染完成: ${exams.length} 个题目 (${Math.round(renderTime)}ms)`);
}

// 设置虚拟滚动
function setupVirtualScrolling(container, exams) {
    // 创建滚动容器
    container.innerHTML = '<div id="virtual-scroll-container" style="height: 600px; overflow-y: auto;"></div>';
    const scrollContainer = document.getElementById('virtual-scroll-container');

    // 创建虚拟滚动器
    window.currentVirtualScroller = window.performanceOptimizer.createVirtualScroller(
        scrollContainer,
        exams,
        renderExamItem,
        {
            itemHeight: 120, // 每个题目项的高度
            bufferSize: 5   // 缓冲区大小
        }
    );
}

// 渲染单个题目项
function renderExamItem(exam, index) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'exam-item';
    itemDiv.dataset.examId = exam.id;

    const practiceColor = getPracticeRecordColor(exam.id);
    const dotHtml = practiceColor ? `<span class="practice-dot" style="background-color: ${practiceColor};" title="已练习"></span>` : '';

    itemDiv.innerHTML = `
                <div class="exam-info">
                    ${dotHtml}
                    <div>
                        <h4>${exam.title}</h4>
                        <div class="exam-meta">
                            ${exam.category} • ${exam.frequency === 'high' ? '高频' : '次高频'} • 
                            ${exam.hasHtml ? '🌐 HTML' : '📄 PDF'}
                            ${exam.note ? ` • ${exam.note}` : ''}
                        </div>
                    </div>
                </div>
                <div class="exam-actions">
                    <button class="btn ${exam.hasHtml ? '' : 'btn-secondary'}" 
                            onclick="openExam('${exam.id}')" 
                            ${exam.hasHtml ? '' : 'title="PDF文件，将在新标签页中打开"'}>
                        ${exam.hasHtml ? '开始练习' : '查看PDF'}
                    </button>
                    <button class="btn btn-secondary" onclick="viewPDF('${exam.id}')">
                        查看PDF
                    </button>
                    ${!exam.hasHtml ? `<button class="btn btn-info" onclick="generateHTML('${exam.id}')" title="为此PDF考试生成HTML练习版本">生成HTML</button>` : ''}
                </div>
            `;
    return itemDiv;
}

// 获取练习记录的颜色（根据最高分）
function getPracticeRecordColor(examId) {
    // 从当前题库中找到题目信息
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) return null;

    // 使用题目ID和标题进行双重匹配，确保能关联到记录
    const recordsForExam = practiceRecords.filter(r => r.examId === examId || r.title === exam.title);
    if (recordsForExam.length === 0) return null;

    // 找到最高分记录
    const bestRecord = recordsForExam.reduce((best, current) => {
        const bestAccuracy = best.percentage !== undefined ? best.percentage : -1;
        const currentAccuracy = current.percentage !== undefined ? current.percentage : -1;
        return currentAccuracy > bestAccuracy ? current : best;
    });

    const accuracy = bestRecord.percentage;

    if (accuracy === undefined || accuracy === null) return null;

    // 根据正确率返回颜色
    if (accuracy >= 80) return '#4ade80'; // 绿色
    if (accuracy >= 60) return '#fbbf24'; // 黄色
    return '#ff6b6b'; // 红色
}

// 传统列表渲染（用于少量数据）
function renderExamList(container, exams) {
    const getDotHtml = (examId) => {
        const color = getPracticeRecordColor(examId);
        return color ? `<span class="practice-dot" style="background-color: ${color};" title="已练习"></span>` : '';
    };

    // 使用批量处理避免阻塞UI
    if (window.performanceOptimizer && exams.length > 20) {
        container.innerHTML = '<div class="exam-list" id="exam-list-content"></div>';
        const listContainer = document.getElementById('exam-list-content');

        window.performanceOptimizer.batchProcess(
            exams,
            (exam, index) => {
                const itemElement = renderExamItem(exam, index);
                listContainer.appendChild(itemElement);
                return itemElement;
            },
            10, // 每批10个
            5   // 5ms延迟
        );
    } else {
        // 直接渲染小数据集
        container.innerHTML = `
            <div class="exam-list">
                ${exams.map(exam => `
                    <div class="exam-item" data-exam-id="${exam.id}">
                        <div class="exam-info">
                            ${getDotHtml(exam.id)}
                            <div>
                                <h4>${exam.title}</h4>
                                <div class="exam-meta">
                                    ${exam.category} • ${exam.frequency === 'high' ? '高频' : '次高频'} • 
                                    ${exam.hasHtml ? '🌐 HTML' : '📄 PDF'}
                                    ${exam.note ? ` • ${exam.note}` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="exam-actions">
                            <button class="btn ${exam.hasHtml ? '' : 'btn-secondary'}" 
                                    onclick="openExam('${exam.id}')" 
                                    ${exam.hasHtml ? '' : 'title="PDF文件，将在新标签页中打开"'}>
                                ${exam.hasHtml ? '开始练习' : '查看PDF'}
                            </button>
                            <button class="btn btn-secondary" onclick="viewPDF('${exam.id}')">
                                查看PDF
                            </button>
                            ${!exam.hasHtml ? `<button class="btn btn-info" onclick="generateHTML('${exam.id}')" title="为此PDF考试生成HTML练习版本">生成HTML</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
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
function validateAndFixDataConsistency() {
    console.log('[System] 开始数据一致性验证和修复...');

    if (!window.DataConsistencyManager) {
        console.error('[System] DataConsistencyManager未加载');
        showMessage('数据一致性管理器未加载', 'error');
        return;
    }

    try {
        const manager = new DataConsistencyManager();
        const practiceRecords = storage.get('practice_records', []);

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

// 查看PDF文件
function viewPDF(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) {
        showMessage('题目不存在', 'error');
        return;
    }

    let relativePdfPath;

    // 构造PDF文件路径
    const potentialPath = exam.path + exam.filename;

    if (potentialPath.toLowerCase().endsWith('.pdf')) {
        relativePdfPath = potentialPath;
    } else if (exam.pdfFilename) {
        if (typeof window.buildResourcePath === 'function') {
            const built = window.buildResourcePath(exam, 'pdf');
            showMessage(`正在打开PDF: ${exam.title}`, 'info');
            openPDFSafely(built, exam.title);
            return;
        }
        relativePdfPath = exam.path + exam.pdfFilename;
    } else {
        // Fallback if pdfFilename is missing
        relativePdfPath = exam.path + exam.filename.replace(/\.html?$/i, '.pdf');
    }

    const encodedPdfPath = './' + encodeURI(relativePdfPath).replace(/%252F/g, '/');

    console.log('[viewPDF] Attempting to open encoded pdfPath:', encodedPdfPath);
    showMessage(`正在打开PDF: ${exam.title}`, 'info');
    openPDFSafely(encodedPdfPath, exam.title);
}

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
function clearCache() {
    if (confirm('确定要清除所有缓存数据吗？')) {
        localStorage.clear();
        sessionStorage.clear();

        // 清除性能优化器缓存
        if (window.performanceOptimizer) {
            window.performanceOptimizer.cleanup();
        }

        showMessage('缓存已清除', 'success');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 显示性能报告
function showPerformanceReport() {
    if (!window.performanceOptimizer) {
        showMessage('性能优化器未初始化', 'warning');
        return;
    }

    const report = window.performanceOptimizer.getPerformanceReport();

    let reportHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>📊 系统性能报告</h3>
                    
                    <div style="margin: 15px 0;">
                        <h4>🗄️ 缓存统计</h4>
                        <p>缓存项数: ${report.cache.itemCount}</p>
                        <p>缓存大小: ${Math.round(report.cache.totalSize / 1024)} KB</p>
                        <p>命中率: ${Math.round(report.cache.hitRate)}%</p>
                    </div>

                    <div style="margin: 15px 0;">
                        <h4>⚡ 性能指标</h4>
                        <p>平均加载时间: ${report.performance.averageLoadTime} ms</p>
                        <p>平均渲染时间: ${report.performance.averageRenderTime} ms</p>
                        <p>加载样本数: ${report.performance.totalLoadSamples}</p>
                        <p>渲染样本数: ${report.performance.totalRenderSamples}</p>
                    </div>
            `;

    if (report.memory) {
        const usagePercent = Math.round((report.memory.used / report.memory.limit) * 100);
        reportHtml += `
                    <div style="margin: 15px 0;">
                        <h4>💾 内存使用</h4>
                        <p>已使用: ${report.memory.used} MB</p>
                        <p>总计: ${report.memory.total} MB</p>
                        <p>限制: ${report.memory.limit} MB</p>
                        <p>使用率: ${usagePercent}%</p>
                    </div>
                `;
    }

    reportHtml += `
                    <div style="margin-top: 20px;">
                        <button class="btn btn-secondary" onclick="this.parentElement.parentElement.remove()">关闭</button>
                    </div>
                </div>
            `;

    // 显示报告
    const container = document.getElementById('settings-view');
    const existingReport = container.querySelector('.performance-report');
    if (existingReport) {
        existingReport.remove();
    }

    const reportDiv = document.createElement('div');
    reportDiv.className = 'performance-report';
    reportDiv.innerHTML = reportHtml;
    container.appendChild(reportDiv);

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

// 显示备份列表
function showBackupList() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    const backups = window.dataIntegrityManager.getBackupList();

    if (backups.length === 0) {
        showMessage('暂无备份记录', 'info');
        return;
    }

    let backupHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>📋 备份列表</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    backups.forEach(backup => {
        const date = new Date(backup.timestamp).toLocaleString();
        const sizeKB = Math.round(backup.size / 1024);
        const typeIcon = backup.type === 'auto' ? '🔄' : backup.type === 'manual' ? '👤' : '⚠️';

        backupHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${typeIcon} ${backup.id}</strong><br>
                            <small>${date} • ${sizeKB} KB • v${backup.version}</small>
                        </div>
                        <button class="btn btn-secondary" onclick="restoreBackup('${backup.id}')" style="margin-left: 10px;">恢复</button>
                    </div>
                `;
    });

    backupHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.remove()">关闭</button>
                </div>
            `;

    // 显示备份列表
    const container = document.getElementById('settings-view');
    const existingList = container.querySelector('.backup-list');
    if (existingList) {
        existingList.remove();
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'backup-list';
    listDiv.innerHTML = backupHtml;
    container.appendChild(listDiv);
}

// 恢复备份
async function restoreBackup(backupId) {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    if (!confirm(`确定要恢复备份 ${backupId} 吗？当前数据将被覆盖。`)) {
        return;
    }

    try {
        showMessage('正在恢复备份...', 'info');
        await window.dataIntegrityManager.restoreBackup(backupId);
        showMessage('备份恢复成功，页面将刷新', 'success');

        setTimeout(() => {
            location.reload();
        }, 2000);
    } catch (error) {
        console.error('[DataManagement] 恢复备份失败:', error);
        showMessage('备份恢复失败: ' + error.message, 'error');
    }
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

// 验证所有数据
function validateAllData() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    try {
        showMessage('正在检查数据完整性...', 'info');
        const report = window.dataIntegrityManager.getIntegrityReport();

        let validationHtml = `
                    <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                        <h3>🔍 数据完整性报告</h3>
                        <p><strong>检查时间:</strong> ${new Date(report.timestamp).toLocaleString()}</p>
                        <p><strong>数据版本:</strong> ${report.dataVersion}</p>
                        <p><strong>备份数量:</strong> ${report.backups.length}</p>
                        
                        <div style="margin: 15px 0;">
                            <h4>验证结果:</h4>
                `;

        let totalErrors = 0;
        Object.entries(report.validation).forEach(([key, validation]) => {
            const status = validation.valid ? '✅' : '❌';
            const errorCount = validation.errors.length;
            totalErrors += errorCount;

            validationHtml += `
                        <div style="margin: 5px 0;">
                            ${status} <strong>${key}:</strong> ${validation.valid ? '正常' : `${errorCount} 个错误`}
                        </div>
                    `;

            if (!validation.valid) {
                validation.errors.forEach(error => {
                    validationHtml += `<div style="margin-left: 20px; font-size: 0.9em; opacity: 0.8;">• ${error}</div>`;
                });
            }
        });

        validationHtml += `
                        </div>
                        <div style="margin-top: 20px;">
                            <strong>总体状态:</strong> ${totalErrors === 0 ? '✅ 数据完整' : `⚠️ 发现 ${totalErrors} 个问题`}
                        </div>
                        <button class="btn btn-secondary" onclick="this.parentElement.parentElement.remove()">关闭</button>
                    </div>
                `;

        // 显示报告
        const container = document.getElementById('settings-view');
        const existingReport = container.querySelector('.validation-report');
        if (existingReport) {
            existingReport.remove();
        }

        const reportDiv = document.createElement('div');
        reportDiv.className = 'validation-report';
        reportDiv.innerHTML = validationHtml;
        container.appendChild(reportDiv);

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
    document.body.style.overflow = 'hidden';

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
    document.body.style.overflow = '';

    // 移除点击事件
    modal.onclick = null;
}



// 修复不完整的标题
function fixIncompleteTitles() {
    const records = storage.get('practice_records', []);
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
        storage.set('practice_records', records);
        practiceRecords = records;
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

// 计算练习统计（只统计真实数据）
function calculatePracticeStats() {
    // 只统计真实数据记录
    const realDataRecords = practiceRecords.filter(record =>
        record.dataSource === 'real' && record.realData
    );

    if (realDataRecords.length === 0) {
        practiceStats = {
            totalPracticed: 0,
            avgScore: 0,
            totalTime: 0,
            streakDays: 0
        };
        return;
    }

    practiceStats.totalPracticed = realDataRecords.length;

    // 只计算真实数据的统计
    let totalScore = 0;
    let totalTime = 0;

    realDataRecords.forEach(record => {
        const score = record.realData.percentage || record.percentage || Math.round((record.realData.accuracy || 0) * 100);
        const duration = Math.round((record.realData.duration || record.duration || 0) / 60); // 转换为分钟
        totalScore += score;
        totalTime += duration;
    });

    practiceStats.avgScore = Math.round(totalScore / realDataRecords.length);
    practiceStats.totalTime = totalTime;

    // 计算分类统计
    practiceStats.categoryStats = {
        P1: { count: 0, avgScore: 0, totalTime: 0 },
        P2: { count: 0, avgScore: 0, totalTime: 0 },
        P3: { count: 0, avgScore: 0, totalTime: 0 }
    };

    ['P1', 'P2', 'P3'].forEach(category => {
        const categoryRecords = realDataRecords.filter(record => record.category === category);
        if (categoryRecords.length > 0) {
            const categoryTotalScore = categoryRecords.reduce((sum, record) => {
                const score = record.realData.percentage || record.percentage || Math.round((record.realData.accuracy || 0) * 100);
                return sum + score;
            }, 0);
            const categoryTotalTime = categoryRecords.reduce((sum, record) => {
                const duration = Math.round((record.realData.duration || record.duration || 0) / 60);
                return sum + duration;
            }, 0);

            practiceStats.categoryStats[category] = {
                count: categoryRecords.length,
                avgScore: Math.round(categoryTotalScore / categoryRecords.length),
                totalTime: categoryTotalTime
            };
        }
    });

    // 计算连续学习天数
    const today = new Date();
    const dates = [...new Set(realDataRecords.map(record => new Date(record.date).toDateString()))];
    dates.sort((a, b) => new Date(b) - new Date(a));

    let streak = 0;
    let currentDate = new Date(today);

    for (let dateStr of dates) {
        const recordDate = new Date(dateStr);
        const diffDays = Math.floor((currentDate - recordDate) / (1000 * 60 * 60 * 24));

        if (diffDays === streak) {
            streak++;
            currentDate = recordDate;
        } else if (diffDays === streak + 1) {
            streak++;
            currentDate = recordDate;
        } else {
            break;
        }
    }

    practiceStats.streakDays = streak;
}

// 更新练习视图
function updatePracticeView() {
    calculatePracticeStats();

    // 更新统计卡片 - 添加安全检查
    const totalPracticedEl = document.getElementById('total-practiced');
    const avgScoreEl = document.getElementById('avg-score');
    const studyTimeEl = document.getElementById('study-time');
    const streakDaysEl = document.getElementById('streak-days');

    if (totalPracticedEl) totalPracticedEl.textContent = practiceStats.totalPracticed;
    if (avgScoreEl) avgScoreEl.textContent = practiceStats.avgScore + '%';
    if (studyTimeEl) studyTimeEl.textContent = practiceStats.totalTime;
    if (streakDaysEl) streakDaysEl.textContent = practiceStats.streakDays;

    // 更新练习历史
    const historyContainer = document.getElementById('practice-history-list');

    if (!historyContainer) {
        console.warn('practice-history-list element not found');
        return;
    }

    if (practiceRecords.length === 0) {
        historyContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; opacity: 0.7;">
                <div style="font-size: 3em; margin-bottom: 15px;">📋</div>
                <p>暂无练习记录</p>
                <p style="font-size: 0.9em; margin-top: 10px;">开始练习后，记录将自动保存在这里</p>
            </div>
        `;
        return;
    }

    // 只显示真实数据记录
    const realDataRecords = practiceRecords.filter(record =>
        record.dataSource === 'real' && record.realData
    );

    if (realDataRecords.length === 0) {
        historyContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; opacity: 0.7;">
                <div style="font-size: 3em; margin-bottom: 15px;">📋</div>
                <p>暂无练习记录</p>
                <p style="font-size: 0.9em; margin-top: 10px;">完成练习后，数据将自动保存在这里</p>
            </div>
        `;
        return;
    }

    historyContainer.innerHTML = realDataRecords.slice(0, 20).map(record => {
        const date = new Date(record.date);

        // 处理数据格式
        const score = record.realData.score || record.score || 0;
        const totalQuestions = record.realData.totalQuestions || record.totalQuestions || 0;
        const duration = Math.round((record.realData.duration || record.duration || 0) / 60); // 转换为分钟
        const accuracy = record.realData.percentage || record.percentage || Math.round((record.realData.accuracy || 0) * 100);

        const scoreColor = accuracy >= 80 ? '#4ade80' : accuracy >= 60 ? '#fbbf24' : '#ff6b6b';

        // 详细信息提示
        let detailsTooltip = '';
        if (record.realData) {
            const details = [];
            if (score !== undefined && totalQuestions !== undefined) {
                details.push(`得分: ${score}/${totalQuestions}`);
            }
            if (record.realData.source) {
                const sourceText = record.realData.source === 'page_extraction' ? '页面提取' :
                    record.realData.source === 'calculation' ? '自动计算' :
                        record.realData.source === 'manual_input' ? '手动输入' : record.realData.source;
                details.push(`来源: ${sourceText}`);
            }
            detailsTooltip = details.length > 0 ? `title="${details.join(' | ')}"` : '';
        }

        const isSelected = selectedRecords.has(record.id);
        const selectionStyle = bulkDeleteMode ?
            (isSelected ? 'background: rgba(255, 0, 0, 0.1); border: 2px solid #ff6b6b;' : 'border: 2px solid transparent;') : '';
        const clickHandler = bulkDeleteMode ? `toggleRecordSelection('${record.id}')` : '';

        return `
            <div class="history-item" ${detailsTooltip} 
                 data-record-id="${record.id}"
                 style="cursor: ${bulkDeleteMode ? 'pointer' : 'help'}; position: relative; ${selectionStyle}"
                 ${bulkDeleteMode ? `onclick="${clickHandler}"` : ''}> 
                <div>
                    <strong class="practice-record-title" onclick="event.stopPropagation(); showRecordDetails('${record.id}')" title="点击查看详情">${record.title}</strong><br>
                    <small>${record.category} • ${date.toLocaleDateString()} ${date.toLocaleTimeString()}</small>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${scoreColor}; font-weight: bold;">${accuracy}%</div>
                    <small>${duration}分钟</small>
                </div>
                ${bulkDeleteMode ?
                `<div style="position: absolute; top: 10px; right: 10px; font-size: 18px;">
                        ${isSelected ? '✅' : '⭕'}
                    </div>` :
                `<button class="delete-record-btn" onclick="deleteRecord('${record.id}')" title="删除此记录">
                        ❌
                    </button>`
            }
            </div>
        `;
    }).join('');
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

            alert(`练习记录详情：\n\n题目：${record.title}\n分类：${record.category}\n时间：${date.toLocaleString()}\n准确率：${accuracy}%\n用
