const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

// 延迟导入，避免循环依赖导致 electron API 未初始化
let IPCHandlers = null;
let LocalApiServer = null;

let mainWindow = null;
let ipcHandlers = null;
let localApiServer = null;

// 安全配置：允许导航的文件白名单（防止恶意页面冒充导航）
const ALLOWED_NAVIGATION_SOURCES = [
    'index.html',           // Legacy 练习页面
    'writing.html',         // 写作评判占位页
    'dist/writing'          // Vue 写作模块构建目录
];

/**
 * 验证 IPC 消息来源是否合法
 * @param {Electron.IpcMainEvent} event - IPC 事件对象
 * @returns {boolean} 是否为合法来源
 */
function isValidNavigationSource(event) {
    const senderURL = event.senderFrame.url;

    // 必须是 file:// 协议
    if (!senderURL.startsWith('file://')) {
        console.warn(`[Security] IPC navigation rejected: non-file protocol (${senderURL})`);
        return false;
    }

    // 检查是否在白名单中
    const isAllowed = ALLOWED_NAVIGATION_SOURCES.some(allowed =>
        senderURL.includes(allowed)
    );

    if (!isAllowed) {
        console.warn(`[Security] IPC navigation rejected: unauthorized source (${senderURL})`);
    }

    return isAllowed;
}

/**
 * 创建主窗口
 */
async function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            // 安全配置
            contextIsolation: true,      // 隔离预加载脚本与网页上下文
            nodeIntegration: false,       // 禁用渲染进程的 Node.js 访问
            sandbox: false,               // 暂时关闭沙箱，等 Legacy + 写作稳定后再开启
            webSecurity: true,            // 启用同源策略
            preload: path.join(__dirname, 'preload.js')
        },
        show: false // 等待ready-to-show事件再显示
    });

    // 延迟导入模块，避免循环依赖
    IPCHandlers = require('./ipc-handlers');
    LocalApiServer = require('./local-api-server');

    // 初始化 IPC handlers
    ipcHandlers = new IPCHandlers(mainWindow);
    await ipcHandlers.initialize();
    ipcHandlers.register();

    // 启动本地 HTTP/SSE API（127.0.0.1）
    localApiServer = new LocalApiServer(ipcHandlers.getServiceBundle());
    const apiInfo = await localApiServer.start();
    ipcHandlers.setLocalApiInfo(apiInfo);

    // 默认加载 Legacy 页面
    loadLegacyPage();

    // 窗口准备好后再显示，避免白屏闪烁
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 【安全加固】拦截页面内导航/重定向
    // 允许本地 file:// 协议导航（Legacy 题目页面需要）
    // 阻止外部 http/https 导航
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // 允许本地 file:// 协议导航（项目内的 HTML 文件）
        if (url.startsWith('file://')) {
            // 检查是否在项目目录内
            const projectDir = path.resolve(__dirname, '..');
            try {
                const normalizedUrl = decodeURIComponent(url.replace('file://', ''));
                if (normalizedUrl.startsWith(projectDir)) {
                    console.log(`[Navigation] Allowing local file: ${url.substring(0, 100)}...`);
                    return; // 允许导航
                }
            } catch (e) {
                console.warn(`[Security] Failed to parse navigation URL: ${e.message}`);
            }
        }

        // 阻止其他所有导航（外部链接等）
        event.preventDefault();
        console.warn(`[Security] Prevented navigation to: ${url.substring(0, 100)}...`);
    });

    // 【安全加固】拦截 new-window 和 window.open，防止随意打开新窗口
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // TODO: 后续应添加白名单（如官方网站、帮助文档等）
        if (url.startsWith('http://') || url.startsWith('https://')) {
            // 可选：添加用户提示
            console.log(`[External] Opening in browser: ${url}`);
            shell.openExternal(url);
        } else {
            console.warn(`[Security] Blocked non-http(s) window.open: ${url}`);
        }
        return { action: 'deny' }; // 阻止在 Electron 中打开新窗口
    });

    // 开发环境下打开 DevTools（可选）
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;

        // 清理 IPC handlers
        if (ipcHandlers) {
            ipcHandlers.cleanup();
            ipcHandlers = null;
        }
        if (localApiServer) {
            localApiServer.stop().catch((error) => {
                console.error('[LocalApi] stop failed on window close:', error);
            });
            localApiServer = null;
        }
    });
}

/**
 * 加载 Legacy 页面（听力/阅读练习系统）
 */
function loadLegacyPage() {
    if (!mainWindow) return;
    const indexPath = path.join(__dirname, '..', 'index.html');
    mainWindow.loadFile(indexPath);
}

/**
 * 加载写作页面（Vue 构建产物 或 回退到 Legacy）
 * Phase 05: 增强错误处理，缺失时明确提示并回退 Legacy
 */
function loadWritingPage() {
    if (!mainWindow) return;

    const fs = require('fs');
    const { dialog } = require('electron');

    // 优先尝试加载 Vue 构建产物
    const vueBuildPath = path.join(__dirname, '..', 'dist', 'writing', 'index.html');

    if (fs.existsSync(vueBuildPath)) {
        console.log('[Navigation] Loading Vue writing module:', vueBuildPath);
        mainWindow.loadFile(vueBuildPath);
    } else {
        // 构建产物缺失：弹窗提示用户并回退到 Legacy
        console.error('[Navigation] Writing module build missing at:', vueBuildPath);

        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: '写作模块未构建',
            message: '写作模块构建文件缺失，将返回主界面',
            detail: '请运行 "npm run build:writing" 构建写作模块，或使用 "npm start" 启动应用。',
            buttons: ['确定']
        }).then(() => {
            // 回退到 Legacy 主界面
            loadLegacyPage();
        }).catch(err => {
            console.error('[Navigation] Dialog error:', err);
            loadLegacyPage();
        });
    }
}

/**
 * 注册导航 IPC 事件处理器
 * 必须在 app ready 后调用，确保 ipcMain 已完全初始化
 */
function registerNavigationHandlers() {
    // 【安全加固】IPC 事件处理：导航切换（含来源校验）
    ipcMain.on('navigate-to-legacy', (event) => {
        if (!isValidNavigationSource(event)) {
            return; // 拒绝非法来源
        }
        loadLegacyPage();
    });

    ipcMain.on('navigate-to-writing', (event) => {
        if (!isValidNavigationSource(event)) {
            return; // 拒绝非法来源
        }
        loadWritingPage();
    });

    console.log('[Navigation] IPC handlers registered');
}

// Electron 应用生命周期
app.whenReady().then(() => {
    // 注册导航处理器（必须在 app ready 后）
    registerNavigationHandlers();

    createMainWindow();

    app.on('activate', () => {
        // macOS: 点击 Dock 图标时重新创建窗口
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // 清理 IPC handlers
    if (ipcHandlers) {
        ipcHandlers.cleanup();
    }
    if (localApiServer) {
        localApiServer.stop().catch((error) => {
            console.error('[LocalApi] stop failed on app close:', error);
        });
        localApiServer = null;
    }

    // macOS: 通常不在关闭所有窗口时退出应用
    if (process.platform !== 'darwin') {
    }
});
