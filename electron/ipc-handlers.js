const { ipcMain } = require('electron');
const path = require('path');
const { app } = require('electron');
const Migrator = require('./db/migrator');
const ConfigService = require('./services/config.service');
const PromptService = require('./services/prompt.service');
const EvaluateService = require('./services/evaluate.service');
const TopicService = require('./services/topic.service');
const EssayService = require('./services/essay.service');
const SettingsService = require('./services/settings.service');
const UploadService = require('./services/upload.service');
const ReadingCoachService = require('./services/reading-coach.service');
const logger = require('./utils/logger');

const IPC_HANDLE_CHANNELS = [
    'app:getUserDataPath',
    'app:getLocalApiInfo',
    'reading:coach-query',
    'configs:list',
    'configs:create',
    'configs:update',
    'configs:delete',
    'configs:setDefault',
    'configs:toggleEnabled',
    'configs:test',
    'prompts:getActive',
    'prompts:import',
    'prompts:exportActive',
    'prompts:listAll',
    'prompts:activate',
    'prompts:delete',
    'evaluate:start',
    'evaluate:getSessionState',
    'evaluate:cancel',
    'topics:list',
    'topics:getById',
    'topics:create',
    'topics:update',
    'topics:delete',
    'topics:batchImport',
    'topics:getStatistics',
    'essays:list',
    'essays:getById',
    'essays:create',
    'essays:delete',
    'essays:batchDelete',
    'essays:deleteAll',
    'essays:getStatistics',
    'essays:exportCSV',
    'settings:getAll',
    'settings:get',
    'settings:update',
    'settings:reset',
    'upload:image',
    'upload:deleteImage',
    'upload:getImagePath'
];

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
        this.topicService = null;
        this.essayService = null;
        this.settingsService = null;
        this.uploadService = null;
        this.readingCoachService = null;
        this.localApiInfo = null;

        // 允许调用 writing API 的页面白名单
        this.ALLOWED_WRITING_SOURCES = [
            'writing.html',
            'dist/writing/index.html',
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

        const isAllowedProtocol = senderURL.startsWith('file://') || senderURL.startsWith('app://app/');
        if (!isAllowedProtocol) {
            logger.warn(`[Security] IPC rejected: unsupported protocol (${senderURL})`);
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
            this.topicService = new TopicService(this.db);
            this.essayService = new EssayService(this.db);
            this.settingsService = new SettingsService(this.db);
            this.uploadService = new UploadService(app);
            this.readingCoachService = new ReadingCoachService(this.configService);

            logger.info('Services initialized successfully');

            // 3. 初始化默认提示词
            await this.promptService.initializeDefaults();
            await this.topicService.initializeDefaults();

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
        this._removeRegisteredHandlers();
        this._registerAppHandlers();
        this._registerConfigHandlers();
        this._registerPromptHandlers();
        this._registerEvaluateHandlers();
        this._registerTopicHandlers();
        this._registerEssayHandlers();
        this._registerSettingsHandlers();
        this._registerUploadHandlers();

        logger.info('All IPC handlers registered');
    }

    _removeRegisteredHandlers() {
        for (const channel of IPC_HANDLE_CHANNELS) {
            ipcMain.removeHandler(channel);
        }
    }

    /**
     * 注册 app.* handlers（系统级API）
     */
    _registerAppHandlers() {
        ipcMain.handle('app:getUserDataPath', async () => {
            return { success: true, data: app.getPath('userData') };
        });

        ipcMain.handle('app:getLocalApiInfo', async () => {
            return { success: true, data: this.localApiInfo };
        });

        ipcMain.handle('reading:coach-query', async (_event, payload) => {
            try {
                const data = await this.readingCoachService.query(payload || {});
                return { success: true, data };
            } catch (error) {
                logger.error('Reading coach IPC error', error);
                return {
                    success: false,
                    error: {
                        code: error.code || 'reading_coach_failed',
                        message: error.message || 'reading_coach_failed'
                    }
                };
            }
        });
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

        ipcMain.handle('evaluate:getSessionState', async (event, sessionId) => {
            return this._handleAsyncWithAuth(event, () => this.evaluateService.getSessionState(sessionId));
        });

        ipcMain.handle('evaluate:cancel', async (event, sessionId) => {
            return this._handleAsyncWithAuth(event, () => this.evaluateService.cancel(sessionId));
        });

        // 注意: evaluate:event 通过 webContents.send 发送,不需要 handler
    }

    /**
     * 注册 topics.* handlers
     */
    _registerTopicHandlers() {
        ipcMain.handle('topics:list', async (event, filters, pagination) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.list(filters, pagination));
        });

        ipcMain.handle('topics:getById', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.getById(id));
        });

        ipcMain.handle('topics:create', async (event, topicData) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.create(topicData));
        });

        ipcMain.handle('topics:update', async (event, id, updates) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.update(id, updates));
        });

        ipcMain.handle('topics:delete', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.delete(id));
        });

        ipcMain.handle('topics:batchImport', async (event, topics) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.batchImport(topics));
        });

        ipcMain.handle('topics:getStatistics', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.topicService.getStatistics());
        });
    }

    /**
     * 注册 essays.* handlers
     */
    _registerEssayHandlers() {
        ipcMain.handle('essays:list', async (event, filters, pagination) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.list(filters, pagination));
        });

        ipcMain.handle('essays:getById', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.getById(id));
        });

        ipcMain.handle('essays:create', async (event, essayData) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.create(essayData));
        });

        ipcMain.handle('essays:delete', async (event, id) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.delete(id));
        });

        ipcMain.handle('essays:batchDelete', async (event, ids) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.batchDelete(ids));
        });

        ipcMain.handle('essays:deleteAll', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.deleteAll());
        });

        ipcMain.handle('essays:getStatistics', async (event, range, taskType) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.getStatistics(range, taskType));
        });

        ipcMain.handle('essays:exportCSV', async (event, filters) => {
            return this._handleAsyncWithAuth(event, () => this.essayService.exportCSV(filters));
        });
    }

    /**
     * 注册 settings.* handlers
     */
    _registerSettingsHandlers() {
        ipcMain.handle('settings:getAll', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.settingsService.getAll());
        });

        ipcMain.handle('settings:get', async (event, key) => {
            return this._handleAsyncWithAuth(event, () => this.settingsService.get(key));
        });

        ipcMain.handle('settings:update', async (event, updates) => {
            return this._handleAsyncWithAuth(event, () => this.settingsService.update(updates));
        });

        ipcMain.handle('settings:reset', async (event) => {
            return this._handleAsyncWithAuth(event, () => this.settingsService.reset());
        });
    }

    /**
     * 注册 upload.* handlers
     */
    _registerUploadHandlers() {
        ipcMain.handle('upload:image', async (event, fileData) => {
            return this._handleAsyncWithAuth(event, () => this.uploadService.uploadImage(fileData));
        });

        ipcMain.handle('upload:deleteImage', async (event, filename) => {
            return this._handleAsyncWithAuth(event, async () => {
                const deleted = await this.uploadService.deleteImage(filename);
                if (!deleted) {
                    const error = new Error('图片不存在或已删除');
                    error.code = 'image_not_found';
                    throw error;
                }
                return deleted;
            });
        });

        ipcMain.handle('upload:getImagePath', async (event, filename) => {
            return this._handleAsyncWithAuth(event, () => Promise.resolve(this.uploadService.getImagePath(filename)));
        });
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
        this._removeRegisteredHandlers();
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('Database connection closed');
        }
    }

    setLocalApiInfo(info) {
        this.localApiInfo = info;
    }

    getServiceBundle() {
        return {
            configService: this.configService,
            promptService: this.promptService,
            evaluateService: this.evaluateService,
            topicService: this.topicService,
            essayService: this.essayService,
            settingsService: this.settingsService,
            uploadService: this.uploadService,
            readingCoachService: this.readingCoachService
        };
    }
}

module.exports = IPCHandlers;
