const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const IPCHandlers = require('./ipc-handlers');

let mainWindow = null;
let ipcHandlers = null;

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

    // 初始化 IPC handlers
    ipcHandlers = new IPCHandlers(mainWindow);
    await ipcHandlers.initialize();
    ipcHandlers.register();

    // 默认加载 Legacy 页面
    loadLegacyPage();

    // 窗口准备好后再显示，避免白屏闪烁
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 【安全加固】拦截页面内导航/重定向，只允许我们主动的 loadFile
    mainWindow.webContents.on('will-navigate', (event, url) => {
        // 阻止所有页面内导航，只允许通过 loadFile 控制
        event.preventDefault();
        console.warn(`[Security] Prevented navigation to: ${url}`);
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
 * 加载写作页面（Vue 构建产物 或 占位页）
 * Phase 03: 优先加载 Vue 构建产物
 */
function loadWritingPage() {
    if (!mainWindow) return;

    const fs = require('fs');

    // 优先尝试加载 Vue 构建产物
    const vueBuildPath = path.join(__dirname, '..', 'dist', 'writing', 'index.html');

    if (fs.existsSync(vueBuildPath)) {
        mainWindow.loadFile(vueBuildPath);
    } else {
        // 后备：加载占位页
        const writingPath = path.join(__dirname, 'pages', 'writing.html');
        mainWindow.loadFile(writingPath);
    }
}

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

// Electron 应用生命周期
app.whenReady().then(() => {
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

    // macOS: 通常不在关闭所有窗口时退出应用
    if (process.platform !== 'darwin') {
    }
});

