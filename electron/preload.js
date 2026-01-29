const { contextBridge, ipcRenderer } = require('electron');

/**
 * 预加载脚本：向渲染进程暴露最小 API
 *
 * 安全原则：
 * 1. 不直接暴露 ipcRenderer，避免渲染进程获得完整 IPC 能力
 * 2. 只提供必要的导航方法和写作功能
 * 3. 使用 contextBridge 进行安全的上下文隔离
 */

// Legacy 导航 API
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
    }
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
    }
});

