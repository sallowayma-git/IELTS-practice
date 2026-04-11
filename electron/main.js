const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron');
const { registerAppProtocol } = require('./protocol');
const { UpdateService } = require('./update/updateService');

let IPCHandlers = null;
let LocalApiServer = null;

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            stream: true,
            corsEnabled: true
        }
    }
]);

let mainWindow = null;
let mainWindowCreation = null;
let updateService = null;
let ipcHandlers = null;
let localApiServer = null;
let navigationHandlersRegistered = false;
let rollbackAttempted = false;
let rendererReadyReceived = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
const STABLE_USER_DATA_DIR = 'ielts-practice';
const LEGACY_USER_DATA_DIRS = ['Electron', 'IELTS Practice'];

configureStableUserDataPath();

if (!hasSingleInstanceLock) {
    app.quit();
}

function configureStableUserDataPath() {
    const appDataPath = app.getPath('appData');
    const preferredUserDataPath = path.join(appDataPath, STABLE_USER_DATA_DIR);
    const preferredDbPath = path.join(preferredUserDataPath, 'ielts-writing.db');

    if (!fs.existsSync(preferredUserDataPath)) {
        fs.mkdirSync(preferredUserDataPath, { recursive: true });
    }

    for (const legacyDirName of LEGACY_USER_DATA_DIRS) {
        const legacyUserDataPath = path.join(appDataPath, legacyDirName);
        const legacyDbPath = path.join(legacyUserDataPath, 'ielts-writing.db');
        if (!fs.existsSync(legacyDbPath) || fs.existsSync(preferredDbPath)) {
            continue;
        }

        fs.cpSync(legacyUserDataPath, preferredUserDataPath, {
            recursive: true,
            force: false,
            errorOnExist: false
        });
        console.log(`[Bootstrap] Migrated userData from ${legacyUserDataPath} -> ${preferredUserDataPath}`);
        break;
    }

    app.setPath('userData', preferredUserDataPath);
}

function getProjectRoot() {
    return path.resolve(__dirname, '..');
}

function getAppAssetUrl(relativePath) {
    const normalizedPath = String(relativePath || 'index.html')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    return `app://app/${normalizedPath}`;
}

function resolveBundledPath(relativePath) {
    if (updateService && typeof updateService.resolveBundledAsset === 'function') {
        return updateService.resolveBundledAsset(relativePath);
    }
    return path.join(getProjectRoot(), relativePath);
}

function isProjectFileUrl(url) {
    if (!url || !url.startsWith('file://')) {
        return false;
    }

    try {
        const senderPath = decodeURIComponent(String(url).replace(/^file:\/\//, '').split(/[?#]/)[0]);
        const normalizedSenderPath = path.resolve(senderPath);
        const projectDir = getProjectRoot();
        return normalizedSenderPath === projectDir || normalizedSenderPath.startsWith(`${projectDir}${path.sep}`);
    } catch (_) {
        return false;
    }
}

function isInternalAppUrl(url) {
    return typeof url === 'string' && /^app:\/\/app(?:\/|$)/.test(url);
}

function isAllowedInternalUrl(url) {
    return isInternalAppUrl(url) || isProjectFileUrl(url);
}

function isValidNavigationSource(event) {
    const senderURL = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    if (isAllowedInternalUrl(senderURL)) {
        return true;
    }

    console.warn(`[Security] IPC navigation rejected: unauthorized source (${senderURL})`);
    return false;
}

function resetBootRecoveryState() {
    rollbackAttempted = false;
    rendererReadyReceived = false;
}

function isMainWindowSender(sender) {
    return !!(mainWindow && !mainWindow.isDestroyed() && sender && sender === mainWindow.webContents);
}

function shouldRollbackOnLoadFailure(errorCode, isMainFrame) {
    if (!isMainFrame || rendererReadyReceived || rollbackAttempted) {
        return false;
    }
    return errorCode !== -3;
}

function emitUpdateState(state) {
    for (const windowInstance of BrowserWindow.getAllWindows()) {
        if (!windowInstance.isDestroyed()) {
            windowInstance.webContents.send('update:state-changed', state);
        }
    }
}

function loadLegacyPage() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    mainWindow.loadURL(getAppAssetUrl('index.html'));
}

function loadWritingPage() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const writingRelativePath = path.join('dist', 'writing', 'index.html');
    const writingFilePath = resolveBundledPath(writingRelativePath);
    if (fs.existsSync(writingFilePath)) {
        mainWindow.loadURL(getAppAssetUrl(writingRelativePath));
        return;
    }

    console.error('[Navigation] Writing module build missing at:', writingFilePath);
    dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '写作模块未构建',
        message: '写作模块构建文件缺失，将返回主界面',
        detail: '请先构建写作模块，或检查发布产物是否完整。',
        buttons: ['确定']
    }).then(() => {
        loadLegacyPage();
    }).catch((error) => {
        console.error('[Navigation] Dialog error:', error);
        loadLegacyPage();
    });
}

function registerNavigationHandlers() {
    if (navigationHandlersRegistered) {
        return;
    }

    ipcMain.on('navigate-to-legacy', (event) => {
        if (!isValidNavigationSource(event)) {
            return;
        }
        loadLegacyPage();
    });

    ipcMain.on('navigate-to-writing', (event) => {
        if (!isValidNavigationSource(event)) {
            return;
        }
        loadWritingPage();
    });

    console.log('[Navigation] IPC handlers registered');
    navigationHandlersRegistered = true;
}

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    mainWindow.show();
    mainWindow.focus();
}

function cleanupWindowServices() {
    if (ipcHandlers) {
        ipcHandlers.cleanup();
        ipcHandlers = null;
    }

    if (localApiServer) {
        localApiServer.stop().catch((error) => {
            console.error('[LocalApi] stop failed:', error);
        });
        localApiServer = null;
    }
}

async function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow;
    }
    if (mainWindowCreation) {
        return mainWindowCreation;
    }

    mainWindowCreation = (async () => {
        mainWindow = new BrowserWindow({
            width: 1440,
            height: 960,
            minWidth: 1024,
            minHeight: 720,
            show: false,
            autoHideMenuBar: true,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                sandbox: false,
                nodeIntegration: false,
                webSecurity: true
            }
        });

        IPCHandlers = require('./ipc-handlers');
        LocalApiServer = require('./local-api-server');

        ipcHandlers = new IPCHandlers(mainWindow);
        await ipcHandlers.initialize();
        ipcHandlers.register();

        localApiServer = new LocalApiServer(ipcHandlers.getServiceBundle());
        const apiInfo = await localApiServer.start();
        ipcHandlers.setLocalApiInfo(apiInfo);

        mainWindow.once('ready-to-show', () => {
            mainWindow.show();
        });

        mainWindow.webContents.on('did-start-loading', () => {
            resetBootRecoveryState();
        });

        mainWindow.webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
            if (!shouldRollbackOnLoadFailure(errorCode, isMainFrame)) {
                return;
            }
            if (!updateService) {
                return;
            }

            rollbackAttempted = true;
            console.warn('[Updater] 检测到主框架启动失败，尝试回滚 overlay:', errorCode, errorDescription, validatedURL);
            try {
                await updateService.rollbackResourceOverlay();
                await mainWindow.loadURL(getAppAssetUrl('index.html'));
            } catch (error) {
                console.error('[Updater] overlay 回滚失败:', error);
            }
        });

        mainWindow.webContents.on('will-navigate', (event, url) => {
            if (isAllowedInternalUrl(url)) {
                return;
            }

            event.preventDefault();
            console.warn(`[Security] Prevented navigation to: ${url.substring(0, 100)}...`);
        });

        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http://') || url.startsWith('https://')) {
                shell.openExternal(url);
            } else {
                console.warn(`[Security] Blocked non-http(s) window.open: ${url}`);
            }
            return { action: 'deny' };
        });

        if (process.env.NODE_ENV === 'development') {
            mainWindow.webContents.openDevTools();
        }

        mainWindow.on('closed', () => {
            mainWindow = null;
            resetBootRecoveryState();
            cleanupWindowServices();
        });

        loadLegacyPage();
        return mainWindow;
    })().finally(() => {
        mainWindowCreation = null;
    });

    return mainWindowCreation;
}

async function createApp() {
    updateService = new UpdateService({ app });
    await updateService.initialize();
    updateService.on('state-changed', emitUpdateState);

    await registerAppProtocol((relativePath) => updateService.resolveBundledAsset(relativePath));

    ipcMain.handle('update:get-state', () => updateService.getState());
    ipcMain.handle('update:check', (_event, payload) => updateService.checkForUpdates(payload || {}));
    ipcMain.handle('update:download-resource', () => updateService.downloadResourceUpdate());
    ipcMain.handle('update:apply-resource', () => updateService.applyResourceUpdate());
    ipcMain.handle('update:download-shell', () => updateService.downloadShellUpdate());
    ipcMain.handle('update:quit-and-install', () => {
        updateService.quitAndInstall();
        return true;
    });
    ipcMain.on('update:renderer-ready', (event) => {
        if (!isMainWindowSender(event.sender)) {
            return;
        }

        rendererReadyReceived = true;
        updateService.markResourceBootSuccessful().catch((error) => {
            console.warn('[Updater] 标记 overlay 健康状态失败:', error);
        });
    });

    registerNavigationHandlers();
    await createMainWindow();

    setTimeout(() => {
        updateService.checkForUpdates({ manual: false }).catch((error) => {
            console.warn('[Updater] 启动静默检查失败:', error);
        });
    }, 1500);
}

if (hasSingleInstanceLock) {
    app.on('second-instance', () => {
        focusMainWindow();
    });
}

app.whenReady().then(async () => {
    await createApp();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            void createMainWindow();
            return;
        }
        focusMainWindow();
    });
}).catch((error) => {
    console.error('[Bootstrap] Electron app startup failed:', error);
    app.quit();
});

app.on('window-all-closed', () => {
    cleanupWindowServices();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
