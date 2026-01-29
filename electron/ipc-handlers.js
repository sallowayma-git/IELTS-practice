const { ipcMain } = require('electron');
const path = require('path');
const { app } = require('electron');
const Migrator = require('./db/migrator');
const ConfigService = require('./services/config.service');
const PromptService = require('./services/prompt.service');
const EvaluateService = require('./services/evaluate.service');
const logger = require('./utils/logger');

/**
 * IPC 通信处理器
 * 
 * 统一注册所有 IPC 合约:
 * - configs.*
 * - prompts.*
 * - evaluate.*
 * 
 * 【安全边界】writingAPI 只接受来自写作页面的调用
 */
class IPCHandlers {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.db = null;
        this.configService = null;
        this.promptService = null;
        this.evaluateService = null;

        // 允许调用 writing API 的页面白名单
        this.ALLOWED_WRITING_SOURCES = [
            'writing.html',
            'test-ipc.html' // 测试页面,生产环境可移除
        ];
    }

    /**
     * 验证 sender 是否在白名单内
     * @param {Electron.IpcMainInvokeEvent} event - IPC 事件对象
     * @returns {boolean} 是否为合法来源
     */
    _isValidWritingSender(event) {
        const senderURL = event.sender.getURL();

        // 必须是 file:// 协议
        if (!senderURL.startsWith('file://')) {
            logger.warn(`[Security] IPC rejected: non-file protocol (${senderURL})`);
            return false;
        }

        // 检查是否在白名单中
        const isAllowed = this.ALLOWED_WRITING_SOURCES.some(allowed =>
            senderURL.includes(allowed)
        );

        if (!isAllowed) {
            logger.warn(`[Security] IPC rejected: unauthorized source (${senderURL})`);
        }

        return isAllowed;
    }

    /**
     * 初始化数据库和服务
     */
    async initialize() {
        try {
            // 1. 初始化数据库
            const dbPath = path.join(app.getPath('userData'), 'ielts-writing.db');
            const migrator = new Migrator(dbPath);
            migrator.migrate();
            this.db = migrator.getDatabase();

            logger.info('Database initialized successfully');

            // 2. 初始化服务
            this.configService = new ConfigService(this.db);
            this.promptService = new PromptService(this.db);
            this.evaluateService = new EvaluateService(
                this.db,
                this.mainWindow.webContents
            );

            logger.info('Services initialized successfully');

            // 3. 初始化默认提示词
            await this.promptService.initializeDefaults();

            logger.info('IPC handlers initialization completed');
        } catch (error) {
            logger.error('Failed to initialize IPC handlers', error);
            throw error;
        }
    }

    /**
     * 注册所有 IPC handlers
     */
    register() {
        this._registerConfigHandlers();
        this._registerPromptHandlers();
        this._registerEvaluateHandlers();

        logger.info('All IPC handlers registered');
    }

    /**
     * 注册 configs.* handlers
     */
    _registerConfigHandlers() {
        ipcMain.handle('configs:list', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.configService.list());
        });

        ipcMain.handle('configs:create', async (event, data) => {
            return this._handleAsyncWithAuth(event, () => this.configService.create(data));
        });

        ipcMain.handle('configs:update', async (event, id, updates) => {
            return this._handleAsyncWithAuth(event, () => this.configService.update(id, updates));
        });

        ipcMain.handle('configs:delete', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.configService.delete(id));
        });

        ipcMain.handle('configs:setDefault', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.configService.setDefault(id));
        });

        ipcMain.handle('configs:toggleEnabled', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.configService.toggleEnabled(id));
        });

        ipcMain.handle('configs:test', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.configService.test(id));
        });
    }

    /**
     * 注册 prompts.* handlers
     */
    _registerPromptHandlers() {
        ipcMain.handle('prompts:getActive', async (event, task_type) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.getActive(task_type));
        });

        ipcMain.handle('prompts:import', async (event, jsonData) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.import(jsonData));
        });

        ipcMain.handle('prompts:exportActive', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.exportActive());
        });

        ipcMain.handle('prompts:listAll', async (event, task_type) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.listAll(task_type));
        });

        ipcMain.handle('prompts:activate', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.activate(id));
        });

        ipcMain.handle('prompts:delete', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.promptService.delete(id));
        });
    }

    /**
     * 注册 evaluate.* handlers
     */
    _registerEvaluateHandlers() {
        ipcMain.handle('evaluate:start', async (event, payload) => {
            return this._handleAsyncWithAuth(event, () => this.evaluateService.start(payload));
        });

        ipcMain.handle('evaluate:cancel', async (event, sessionId) => {
            return this._handleAsyncWithAuth(event, () => this.evaluateService.cancel(sessionId));
        });

        // 注意: evaluate:event 通过 webContents.send 发送,不需要 handler
    }

    /**
     * 【带权限校验】统一处理异步请求
     * 
     * @param {Electron.IpcMainInvokeEvent} event - IPC 事件
     * @param {Function} fn - 业务函数
     */
    async _handleAsyncWithAuth(event, fn) {
        // 1. 校验 sender 来源
        if (!this._isValidWritingSender(event)) {
            return {
                success: false,
                error: {
                    code: 'unauthorized',
                    message: '未授权的页面调用此 API'
                }
            };
        }

        // 2. 执行业务逻辑
        return this._handleAsync(fn);
    }

    /**
     * 统一处理异步错误（内部使用）
     * 
     * 【IPC 合约】
     * - 成功: { success: true, data: <result> }
     * - 失败: { success: false, error: { code, message, latency? } }
     */
    async _handleAsync(fn) {
        try {
            const result = await fn();
            return { success: true, data: result };
        } catch (error) {
            logger.error('IPC handler error', error);
            return {
                success: false,
                error: {
                    code: error.code || 'unknown_error',
                    message: error.message,
                    // 可选字段透传
                    ...(error.latency !== undefined && { latency: error.latency })
                }
            };
        }
    }

    /**
     * 清理资源
     */
    cleanup() {
        if (this.db) {
            this.db.close();
            logger.info('Database connection closed');
        }
    }
}

module.exports = IPCHandlers;
