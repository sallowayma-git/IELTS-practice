const { contextBridge, ipcRenderer } = require('electron');
const { toIpcSerializable } = require('./utils/ipc-serialize');
const evaluateEventListeners = new Map();
let evaluateEventListenerSeq = 0;

function invoke(channel, ...args) {
    return ipcRenderer.invoke(
        channel,
        ...args.map((arg) => toIpcSerializable(arg))
    );
}

/**
 * 预加载脚本：向渲染进程暴露最小 API
 *
 * 安全原则：
 * 1. 不直接暴露 ipcRenderer，避免渲染进程获得完整 IPC 能力
 * 2. 只提供必要的导航方法和写作功能
 * 3. 使用 contextBridge 进行安全的上下文隔离
 */

// Legacy 导航 API + 系统信息
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * 切换到写作评判页面
     */
    openWriting: () => {
        ipcRenderer.send('navigate-to-writing');
    },

    /**
     * 返回到 Legacy 练习页面
     */
    openLegacy: () => {
        ipcRenderer.send('navigate-to-legacy');
    },

    /**
     * 获取版本信息（安全方式）
     */
    getVersions: () => {
        return {
            electron: process.versions.electron || 'N/A',
            node: process.versions.node || 'N/A',
            chrome: process.versions.chrome || 'N/A'
        };
    },

    /**
     * 获取用户数据路径
     */
    getUserDataPath: () => invoke('app:getUserDataPath'),

    /**
     * 获取本地 API 服务地址
     */
    getLocalApiInfo: () => invoke('app:getLocalApiInfo')
});

// 写作模块 API
contextBridge.exposeInMainWorld('writingAPI', {
    /**
     * API 配置管理
     */
    configs: {
        list: () => invoke('configs:list'),
        create: (data) => invoke('configs:create', data),
        update: (id, updates) => invoke('configs:update', id, updates),
        delete: (id) => invoke('configs:delete', id),
        setDefault: (id) => invoke('configs:setDefault', id),
        toggleEnabled: (id) => invoke('configs:toggleEnabled', id),
        test: (id) => invoke('configs:test', id)
    },

    /**
     * 提示词管理
     */
    prompts: {
        getActive: (taskType) => invoke('prompts:getActive', taskType),
        import: (jsonData) => invoke('prompts:import', jsonData),
        exportActive: () => invoke('prompts:exportActive'),
        listAll: (taskType) => invoke('prompts:listAll', taskType),
        activate: (id) => invoke('prompts:activate', id),
        delete: (id) => invoke('prompts:delete', id)
    },

    /**
     * 评测功能
     */
    evaluate: {
        start: (payload) => invoke('evaluate:start', payload),
        getSessionState: (sessionId) => invoke('evaluate:getSessionState', sessionId),
        cancel: (sessionId) => invoke('evaluate:cancel', sessionId),
        onEvent: (callback) => {
            if (typeof callback !== 'function') {
                return null;
            }

            const listenerId = `evaluate:${Date.now()}:${++evaluateEventListenerSeq}`;
            const listener = (event, data) => callback(data);
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

    /**
     * 题目管理
     */
    topics: {
        list: (filters, pagination) => invoke('topics:list', filters, pagination),
        getById: (id) => invoke('topics:getById', id),
        create: (topicData) => invoke('topics:create', topicData),
        update: (id, updates) => invoke('topics:update', id, updates),
        delete: (id) => invoke('topics:delete', id),
        batchImport: (topics) => invoke('topics:batchImport', topics),
        getStatistics: () => invoke('topics:getStatistics')
    },

    /**
     * 作文记录/历史管理
     */
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

    /**
     * 应用设置
     */
    settings: {
        getAll: () => invoke('settings:getAll'),
        get: (key) => invoke('settings:get', key),
        update: (updates) => invoke('settings:update', updates),
        reset: () => invoke('settings:reset')
    },

    /**
     * 图片上传
     */
    upload: {
        uploadImage: (fileData) => invoke('upload:image', fileData),
        deleteImage: (filename) => invoke('upload:deleteImage', filename),
        getImagePath: (filename) => invoke('upload:getImagePath', filename)
    }
});
