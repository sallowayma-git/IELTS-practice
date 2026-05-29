const { contextBridge, ipcRenderer } = require('electron');
let rendererReadyReported = false;

function invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
}

function reportRendererReady() {
    if (rendererReadyReported) {
        return;
    }
    rendererReadyReported = true;
    ipcRenderer.send('update:renderer-ready');
}

function onUpdateStateChange(listener) {
    if (typeof listener !== 'function') {
        return function noop() {};
    }

    const handler = (_event, state) => {
        listener(state);
    };

    ipcRenderer.on('update:state-changed', handler);
    return function unsubscribe() {
        ipcRenderer.removeListener('update:state-changed', handler);
    };
}

const PRACTICE_ASSET_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

window.addEventListener('app-runtime-ready', reportRendererReady);

contextBridge.exposeInMainWorld('electronAPI', {
    openPracticeRoute: (route) => {
        return invoke('navigate-to-practice-route', route);
    },
    openPracticeReading: (assetId) => {
        const normalizedAssetId = String(assetId || '').trim();
        if (!PRACTICE_ASSET_ID_PATTERN.test(normalizedAssetId)) {
            return Promise.resolve({
                success: false,
                error: 'invalid_practice_asset_id'
            });
        }
        return invoke('navigate-to-practice-route', `/reading/${encodeURIComponent(normalizedAssetId)}`);
    },
    getVersions: () => {
        return {
            electron: process.versions.electron || 'N/A',
            node: process.versions.node || 'N/A',
            chrome: process.versions.chrome || 'N/A'
        };
    },
    getUserDataPath: () => invoke('app:getUserDataPath'),
    getLocalApiInfo: () => invoke('app:getLocalApiInfo')
});

contextBridge.exposeInMainWorld('updateAPI', {
    getState() {
        return ipcRenderer.invoke('update:get-state');
    },
    check(payload = {}) {
        return ipcRenderer.invoke('update:check', payload);
    },
    downloadResourceUpdate() {
        return ipcRenderer.invoke('update:download-resource');
    },
    applyResourceUpdate() {
        return ipcRenderer.invoke('update:apply-resource');
    },
    downloadShellUpdate() {
        return ipcRenderer.invoke('update:download-shell');
    },
    quitAndInstall() {
        return ipcRenderer.invoke('update:quit-and-install');
    },
    onStateChange: onUpdateStateChange
});
