const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

class SimpleEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        if (typeof handler !== 'function') {
            return;
        }
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(handler);
    }

    removeEventListener(type, handler) {
        const handlers = this.listeners.get(type);
        if (!handlers) {
            return;
        }
        handlers.delete(handler);
    }

    dispatchEvent(event) {
        if (!event || !event.type) {
            throw new Error('event.type is required');
        }
        const handlers = Array.from(this.listeners.get(event.type) || []);
        for (const handler of handlers) {
            handler.call(this, event);
        }
        return true;
    }
}

class SimpleCustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

function createWindowMock() {
    const win = new SimpleEventTarget();
    win.console = console;
    win.setTimeout = (handler) => {
        if (typeof handler === 'function') {
            handler();
        }
        return 1;
    };
    win.clearTimeout = () => {};
    win.requestIdleCallback = (handler) => {
        if (typeof handler === 'function') {
            handler();
        }
        return 1;
    };
    win.CustomEvent = SimpleCustomEvent;
    win.AppLazyLoader = {
        ensureGroup() {
            return Promise.resolve();
        }
    };
    win.storage = {
        ready: Promise.resolve(),
        setNamespace() {}
    };
    win.NavigationController = {
        ensure() {}
    };
    win.AppActions = {
        preloadPracticeSuite() {}
    };
    win.AppBootScreen = {
        complete() {
            win.__bootCompleted = (win.__bootCompleted || 0) + 1;
        }
    };
    win.loadExamList = function loadExamList() {};
    win.updateOverview = function updateOverview() {};
    win.refreshBrowseProgressFromRecords = function refreshBrowseProgressFromRecords() {};
    win.showMessage = function showMessage() {};
    return win;
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function createDocumentMock() {
    const document = new SimpleEventTarget();
    document.readyState = 'complete';
    document.body = {
        appendChild() {},
        classList: {
            add() {},
            remove() {}
        }
    };
    document.createElement = function createElement() {
        return {
            hidden: false,
            className: '',
            innerHTML: '',
            classList: {
                add() {},
                remove() {},
                contains() {
                    return false;
                }
            },
            setAttribute() {},
            appendChild() {},
            addEventListener() {},
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            }
        };
    };
    document.querySelector = function querySelector() {
        return null;
    };
    document.querySelectorAll = function querySelectorAll() {
        return [];
    };
    return document;
}

async function verifyMainEntryHandshake() {
    const win = createWindowMock();
    const document = createDocumentMock();

    global.window = win;
    global.document = document;
    global.CustomEvent = SimpleCustomEvent;
    global.setTimeout = win.setTimeout;
    global.clearTimeout = win.clearTimeout;

    let readyEventCount = 0;
    win.addEventListener('app-runtime-ready', () => {
        readyEventCount += 1;
    });

    require(path.resolve('js/app/main-entry.js'));
    win.dispatchEvent(new SimpleCustomEvent('examIndexLoaded'));
    win.dispatchEvent(new SimpleCustomEvent('examIndexLoaded'));
    await flushMicrotasks();

    assert.equal(win.__bootCompleted, 2, 'boot screen complete 应在题库加载事件后执行');
    assert.equal(readyEventCount, 1, 'app-runtime-ready 只应派发一次');
}

function verifyPreloadHandshake() {
    const win = createWindowMock();
    const sentChannels = [];
    const contextBridge = {
        exposeInMainWorld() {}
    };
    const ipcRenderer = {
        on() {},
        removeListener() {},
        invoke() {
            return Promise.resolve(null);
        },
        send(channel) {
            sentChannels.push(channel);
        }
    };

    const originalLoad = Module._load;
    global.window = win;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'electron') {
            return {
                contextBridge,
                ipcRenderer
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        require(path.resolve('electron/preload.js'));
    } finally {
        Module._load = originalLoad;
    }

    win.dispatchEvent(new SimpleCustomEvent('app-runtime-ready'));
    win.dispatchEvent(new SimpleCustomEvent('app-runtime-ready'));
    assert.deepEqual(sentChannels, ['update:renderer-ready'], 'preload 应只上报一次 renderer-ready');
}

async function verifyUpdateManagerSkipsAutoCheckWhileLocalActionPending() {
    const win = createWindowMock();
    const document = createDocumentMock();
    let checkCalls = 0;
    const checkPayloads = [];
    let stateFactory = null;

    win.updateAPI = {
        getState() {
            return Promise.resolve(null);
        },
        check(payload) {
            checkCalls += 1;
            checkPayloads.push(payload);
            return Promise.resolve(stateFactory ? stateFactory(payload) : { status: 'checking' });
        }
    };
    win.showMessage = function showMessage() {};
    global.window = win;
    global.document = document;
    global.CustomEvent = SimpleCustomEvent;
    global.setTimeout = win.setTimeout;
    global.clearTimeout = win.clearTimeout;

    require(path.resolve('js/integration/updateManager.js'));
    const manager = new win.AppUpdateManager();
    stateFactory = function resolveCurrentState() {
        return manager.getState();
    };

    manager.state = manager.normalizeState({
        status: 'ready-to-reload',
        lastCheckAt: '2026-04-11T00:00:00.000Z',
        shell: {
            supported: true,
            available: false,
            version: null,
            downloadAllowed: false,
            downloaded: false,
            assetName: null,
            error: null
        },
        resource: {
            available: true,
            version: 'v0.7.0',
            strategy: 'delta',
            selectedAssetName: null,
            downloadAllowed: false,
            downloaded: false,
            requiresShellUpdate: false,
            compatible: true,
            baseMismatch: false,
            error: null
        }
    });

    const reloadPrimaryAction = manager.getPrimaryAction();
    assert.equal(reloadPrimaryAction.action, 'apply-resource', 'ready-to-reload 时主操作应保持为 apply-resource');

    const pendingState = await manager.ensureAutoCheck();
    assert.equal(checkCalls, 0, 'renderer 侧存在待切换动作时不应触发自动检查');
    assert.equal(pendingState.status, 'ready-to-reload', 'renderer 自动检查跳过后应保留当前待切换状态');
    assert.equal(manager.getPrimaryAction().action, 'apply-resource', '跳过自动检查后主操作不应丢失');

    manager.state = manager.normalizeState({
        status: 'up-to-date',
        lastCheckAt: '2026-04-11T00:00:00.000Z',
        shell: {
            supported: true,
            available: false,
            version: null,
            downloadAllowed: false,
            downloaded: true,
            assetName: 'app-0.7.0.exe',
            error: null
        }
    });

    const restartPrimaryAction = manager.getPrimaryAction();
    assert.equal(restartPrimaryAction.action, 'restart-install', '壳层待重启时主操作应保持为 restart-install');

    const restartState = await manager.ensureAutoCheck();
    assert.equal(checkCalls, 0, 'renderer 侧壳层待重启时不应触发自动检查');
    assert.equal(restartState.shell.downloaded, true, 'renderer 自动检查跳过后应保留待重启事实');
    assert.equal(manager.getPrimaryAction().action, 'restart-install', '跳过自动检查后壳层主操作不应退化');

    await manager.checkForUpdates({ manual: true });
    assert.equal(checkCalls, 1, '手动重新检查仍应允许发起 updateAPI.check');
    assert.deepEqual(checkPayloads, [{ manual: true }], '手动重新检查必须显式带 manual=true');
}

function verifyUpdateModalCloseDestroysOverlay() {
    class MockHTMLElement {}
    const updateManagerPath = path.resolve('js/integration/updateManager.js');

    const win = createWindowMock();
    const document = createDocumentMock();
    global.window = win;
    global.document = document;
    global.CustomEvent = SimpleCustomEvent;
    global.HTMLElement = MockHTMLElement;

    delete require.cache[updateManagerPath];
    require(updateManagerPath);
    const manager = new win.AppUpdateManager();

    let focused = 0;
    const trigger = new MockHTMLElement();
    trigger.isConnected = true;
    trigger.focus = () => {
        focused += 1;
    };

    let removed = 0;
    const overlay = {
        isConnected: true,
        classList: {
            contains(token) {
                return token === 'show';
            },
            remove() {}
        },
        setAttribute() {},
        remove() {
            removed += 1;
            this.isConnected = false;
        }
    };

    manager.lastActiveTrigger = trigger;
    manager.modalOverlay = overlay;
    assert.equal(manager.isModalVisible(), true, '关闭前更新弹窗应视为可见');

    manager.hideModal();

    assert.equal(removed, 1, '关闭更新弹窗时应销毁 overlay，而不是仅隐藏');
    assert.equal(manager.modalOverlay, null, '关闭后不应保留陈旧 overlay 引用');
    assert.equal(focused, 1, '关闭后应把焦点还给触发按钮');
    assert.equal(manager.isModalVisible(), false, '关闭后更新弹窗不应继续占据可见状态');
}

async function verifyBrokenRecoveredStageRejected() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-update-recover-'));
    const userDataRoot = path.join(tempRoot, 'userData');
    const appRoot = path.join(tempRoot, 'app');
    fs.mkdirSync(path.join(appRoot, 'js'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'index.html'), '<!doctype html><html></html>');
    fs.writeFileSync(path.join(appRoot, 'js', 'boot.js'), 'console.log("ok");');

    const { ResourceOverlayManager } = require(path.resolve('electron/update/resourceOverlayManager.js'));
    const manager = new ResourceOverlayManager({
        app: {
            getPath(name) {
                if (name === 'userData') {
                    return userDataRoot;
                }
                throw new Error(`unexpected app path request: ${name}`);
            },
            getAppPath() {
                return appRoot;
            }
        },
        defaultResourceVersion: 'v0.0.0'
    });

    await manager.initialize();

    const stageRoot = path.join(userDataRoot, 'updates', 'staging', 'v1-broken');
    fs.mkdirSync(stageRoot, { recursive: true });
    fs.writeFileSync(path.join(stageRoot, '.overlay-manifest.json'), JSON.stringify({
        manifest: {
            resourceVersion: 'v1'
        },
        packageInfo: {
            mode: 'delta',
            managedPrefixes: ['js/'],
            files: [{
                path: 'js/boot.js',
                action: 'upsert',
                size: 999,
                sha256: 'broken'
            }]
        }
    }, null, 2));

    const recovered = await manager.recoverStagedUpdate();
    assert.equal(recovered, null, '损坏的 staged update 不应被恢复');
    assert.equal(fs.existsSync(stageRoot), false, '损坏的 staged 目录应被清理');
}

(async function main() {
    await verifyMainEntryHandshake();
    verifyPreloadHandshake();
    await verifyUpdateManagerSkipsAutoCheckWhileLocalActionPending();
    verifyUpdateModalCloseDestroysOverlay();
    await verifyBrokenRecoveredStageRejected();
    console.log('Renderer-ready handshake smoke passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
