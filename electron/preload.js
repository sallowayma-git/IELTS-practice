const { contextBridge, ipcRenderer } = require('electron');

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
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),

    /**
     * 获取本地 API 服务地址
     */
    getLocalApiInfo: () => ipcRenderer.invoke('app:getLocalApiInfo')
});

// 写作模块 API
contextBridge.exposeInMainWorld('writingAPI', {
    /**
     * API 配置管理
     */
    configs: {
        list: () => ipcRenderer.invoke('configs:list'),
        create: (data) => ipcRenderer.invoke('configs:create', data),
        update: (id, updates) => ipcRenderer.invoke('configs:update', id, updates),
        delete: (id) => ipcRenderer.invoke('configs:delete', id),
        setDefault: (id) => ipcRenderer.invoke('configs:setDefault', id),
        toggleEnabled: (id) => ipcRenderer.invoke('configs:toggleEnabled', id),
        test: (id) => ipcRenderer.invoke('configs:test', id)
    },

    /**
     * 提示词管理
     */
    prompts: {
        getActive: (taskType) => ipcRenderer.invoke('prompts:getActive', taskType),
        import: (jsonData) => ipcRenderer.invoke('prompts:import', jsonData),
        exportActive: () => ipcRenderer.invoke('prompts:exportActive'),
        listAll: (taskType) => ipcRenderer.invoke('prompts:listAll', taskType),
        activate: (id) => ipcRenderer.invoke('prompts:activate', id),
        delete: (id) => ipcRenderer.invoke('prompts:delete', id)
    },

    /**
     * 评测功能
     */
    evaluate: {
        start: (payload) => ipcRenderer.invoke('evaluate:start', payload),
        cancel: (sessionId) => ipcRenderer.invoke('evaluate:cancel', sessionId),
        onEvent: (callback) => {
            ipcRenderer.on('evaluate:event', (event, data) => callback(data));
        },
        removeEventListener: () => {
            ipcRenderer.removeAllListeners('evaluate:event');
        }
    },

    /**
     * 题目管理
     */
    topics: {
        list: (filters, pagination) => ipcRenderer.invoke('topics:list', filters, pagination),
        getById: (id) => ipcRenderer.invoke('topics:getById', id),
        create: (topicData) => ipcRenderer.invoke('topics:create', topicData),
        update: (id, updates) => ipcRenderer.invoke('topics:update', id, updates),
        delete: (id) => ipcRenderer.invoke('topics:delete', id),
        batchImport: (topics) => ipcRenderer.invoke('topics:batchImport', topics),
        getStatistics: () => ipcRenderer.invoke('topics:getStatistics')
    },

    /**
     * 作文记录/历史管理
     */
    essays: {
        list: (filters, pagination) => ipcRenderer.invoke('essays:list', filters, pagination),
        getById: (id) => ipcRenderer.invoke('essays:getById', id),
        create: (essayData) => ipcRenderer.invoke('essays:create', essayData),
        delete: (id) => ipcRenderer.invoke('essays:delete', id),
        batchDelete: (ids) => ipcRenderer.invoke('essays:batchDelete', ids),
        deleteAll: () => ipcRenderer.invoke('essays:deleteAll'),
        getStatistics: (range, taskType) => ipcRenderer.invoke('essays:getStatistics', range, taskType),
        exportCSV: (filters) => ipcRenderer.invoke('essays:exportCSV', filters)
    },

    /**
     * 应用设置
     */
    settings: {
        getAll: () => ipcRenderer.invoke('settings:getAll'),
        get: (key) => ipcRenderer.invoke('settings:get', key),
        update: (updates) => ipcRenderer.invoke('settings:update', updates),
        reset: () => ipcRenderer.invoke('settings:reset')
    },

    /**
     * 图片上传
     */
    upload: {
        uploadImage: (fileData) => ipcRenderer.invoke('upload:image', fileData),
        deleteImage: (filename) => ipcRenderer.invoke('upload:deleteImage', filename),
        getImagePath: (filename) => ipcRenderer.invoke('upload:getImagePath', filename)
    }
});
