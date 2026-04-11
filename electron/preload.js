const { contextBridge, ipcRenderer } = require('electron');
const { toIpcSerializable } = require('./utils/ipc-serialize');

const evaluateEventListeners = new Map();
let evaluateEventListenerSeq = 0;
let rendererReadyReported = false;

function invoke(channel, ...args) {
    return ipcRenderer.invoke(
        channel,
        ...args.map((arg) => toIpcSerializable(arg))
    );
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

window.addEventListener('app-runtime-ready', reportRendererReady);

contextBridge.exposeInMainWorld('electronAPI', {
    openWriting: () => {
        ipcRenderer.send('navigate-to-writing');
    },
    openLegacy: () => {
        ipcRenderer.send('navigate-to-legacy');
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

contextBridge.exposeInMainWorld('writingAPI', {
    configs: {
        list: () => invoke('configs:list'),
        create: (data) => invoke('configs:create', data),
        update: (id, updates) => invoke('configs:update', id, updates),
        delete: (id) => invoke('configs:delete', id),
        setDefault: (id) => invoke('configs:setDefault', id),
        toggleEnabled: (id) => invoke('configs:toggleEnabled', id),
        test: (id) => invoke('configs:test', id)
    },
    prompts: {
        getActive: (taskType) => invoke('prompts:getActive', taskType),
        import: (jsonData) => invoke('prompts:import', jsonData),
        exportActive: () => invoke('prompts:exportActive'),
        listAll: (taskType) => invoke('prompts:listAll', taskType),
        activate: (id) => invoke('prompts:activate', id),
        delete: (id) => invoke('prompts:delete', id)
    },
    evaluate: {
        start: (payload) => invoke('evaluate:start', payload),
        getSessionState: (sessionId) => invoke('evaluate:getSessionState', sessionId),
        cancel: (sessionId) => invoke('evaluate:cancel', sessionId),
        onEvent: (callback) => {
            if (typeof callback !== 'function') {
                return null;
            }

            const listenerId = `evaluate:${Date.now()}:${++evaluateEventListenerSeq}`;
            const listener = (_event, data) => callback(data);
            evaluateEventListeners.set(listenerId, listener);
            ipcRenderer.on('evaluate:event', listener);
            return listenerId;
        },
        removeEventListener: (listenerId) => {
            const listener = evaluateEventListeners.get(listenerId);
            if (!listener) {
                return;
            }

            ipcRenderer.removeListener('evaluate:event', listener);
            evaluateEventListeners.delete(listenerId);
        }
    },
    topics: {
        list: (filters, pagination) => invoke('topics:list', filters, pagination),
        getById: (id) => invoke('topics:getById', id),
        create: (topicData) => invoke('topics:create', topicData),
        update: (id, updates) => invoke('topics:update', id, updates),
        delete: (id) => invoke('topics:delete', id),
        batchImport: (topics) => invoke('topics:batchImport', topics),
        getStatistics: () => invoke('topics:getStatistics')
    },
    essays: {
        list: (filters, pagination) => invoke('essays:list', filters, pagination),
        getById: (id) => invoke('essays:getById', id),
        create: (essayData) => invoke('essays:create', essayData),
        delete: (id) => invoke('essays:delete', id),
        batchDelete: (ids) => invoke('essays:batchDelete', ids),
        deleteAll: () => invoke('essays:deleteAll'),
        getStatistics: (range, taskType) => invoke('essays:getStatistics', range, taskType),
        exportCSV: (filters) => invoke('essays:exportCSV', filters)
    },
    settings: {
        getAll: () => invoke('settings:getAll'),
        get: (key) => invoke('settings:get', key),
        update: (updates) => invoke('settings:update', updates),
        reset: () => invoke('settings:reset')
    },
    upload: {
        uploadImage: (fileData) => invoke('upload:image', fileData),
        deleteImage: (filename) => invoke('upload:deleteImage', filename),
        getImagePath: (filename) => invoke('upload:getImagePath', filename)
    }
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
