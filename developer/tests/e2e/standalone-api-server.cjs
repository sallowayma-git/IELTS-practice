#!/usr/bin/env node
/**
 * Standalone API Server for E2E Testing
 * 
 * 独立的 API 服务器，不依赖 Electron，直接使用真实服务层
 * 用于 E2E 测试验证真实 DB 和文件系统操作
 */

const path = require('path');
const os = require('os');
const express = require('express');

// 设置数据目录（使用与 Electron 应用相同的路径）
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', 'ielts-practice');
process.env.IELTS_USER_DATA_PATH = userDataPath;

// 导入服务层
const Database = require('better-sqlite3');
const ConfigService = require('../../../electron/services/config.service');
const PromptService = require('../../../electron/services/prompt.service');
const EvaluateService = require('../../../electron/services/evaluate.service');
const TopicService = require('../../../electron/services/topic.service');
const EssayService = require('../../../electron/services/essay.service');
const SettingsService = require('../../../electron/services/settings.service');
const UploadService = require('../../../electron/services/upload.service');

const logger = {
    info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args)
};

class StandaloneApiServer {
    constructor(port = 3000) {
        this.port = port;
        this.host = '127.0.0.1';
        this.app = null;
        this.server = null;
        this.db = null;
        this.services = {};
    }

    async initialize() {
        // 初始化数据库
        const dbPath = path.join(userDataPath, 'ielts-writing.db');
        logger.info(`Database path: ${dbPath}`);

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');

        // 跳过迁移（数据库应该已经由 Electron 应用初始化）
        // 如果需要迁移，Migrator 接受 dbPath 而不是 db 实例
        logger.info('Using existing database (migrations should be done by Electron app)');

        // 初始化服务
        this.services.configService = new ConfigService(this.db);
        this.services.promptService = new PromptService(this.db);
        this.services.topicService = new TopicService(this.db);
        this.services.essayService = new EssayService(this.db);
        this.services.settingsService = new SettingsService(this.db);
        this.services.uploadService = new UploadService(userDataPath);

        // EvaluateService 需要特殊处理（依赖 LLM 调用）
        this.services.evaluateService = new EvaluateService(
            this.db,
            this.services.configService,
            this.services.promptService,
            this.services.essayService
        );

        logger.info('Services initialized');
    }

    async start() {
        await this.initialize();

        this.app = express();
        this.app.use(express.json({ limit: '20mb' }));

        // 健康检查
        this.app.get('/health', (req, res) => {
            res.json({ success: true, data: { status: 'ok' } });
        });

        // 注册路由
        this._registerEvaluateRoutes();
        this._registerUploadRoutes();
        this._registerEssayRoutes();
        this._registerConfigRoutes();

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, this.host, () => {
                logger.info(`API server started at http://${this.host}:${this.port}`);
                resolve({
                    host: this.host,
                    port: this.port,
                    baseUrl: `http://${this.host}:${this.port}`
                });
            });
            this.server.on('error', reject);
        });
    }

    async stop() {
        if (this.server) {
            await new Promise(resolve => this.server.close(resolve));
            logger.info('API server stopped');
        }
        if (this.db) {
            this.db.close();
            logger.info('Database closed');
        }
    }

    _registerEvaluateRoutes() {
        const { evaluateService } = this.services;

        this.app.post('/api/evaluate', async (req, res) => {
            try {
                const payload = {
                    ...req.body,
                    config_id: req.body?.api_config_id || req.body?.config_id || null
                };
                const result = await evaluateService.start(payload);
                res.json({ success: true, session_id: result.sessionId, message: '评分任务已创建' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/evaluate/:sessionId/stream', async (req, res) => {
            const { sessionId } = req.params;

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();

            const unsubscribe = evaluateService.subscribeSession(sessionId, (event) => {
                res.write(`event: ${event.type}\n`);
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            });

            const heartbeat = setInterval(() => {
                res.write(`event: heartbeat\n`);
                res.write(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`);
            }, 25000);

            req.on('close', () => {
                clearInterval(heartbeat);
                unsubscribe();
                res.end();
            });
        });

        this.app.delete('/api/evaluate/:sessionId', async (req, res) => {
            try {
                const result = await evaluateService.cancel(req.params.sessionId);
                res.json({ success: true, data: result, message: '评分任务已取消' });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerUploadRoutes() {
        const { uploadService } = this.services;

        this.app.post('/api/upload/image', async (req, res) => {
            try {
                const body = req.body || {};
                const fileData = {
                    name: body.name,
                    type: body.type,
                    data: body.data
                        ? Buffer.from(body.data)
                        : Buffer.from(body.data_base64 || '', 'base64')
                };
                const data = await uploadService.uploadImage(fileData);
                res.json({ success: true, ...data, message: '图片上传成功' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.delete('/api/upload/image/:filename', async (req, res) => {
            try {
                await uploadService.deleteImage(req.params.filename);
                res.json({ success: true, message: '图片已删除' });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerEssayRoutes() {
        const { essayService } = this.services;

        this.app.get('/api/essays', async (req, res) => {
            try {
                const { page = 1, limit = 20, ...filters } = req.query;
                const data = await essayService.list(filters, {
                    page: Number(page),
                    limit: Number(limit)
                });
                res.json({ success: true, ...data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/essays/:id', async (req, res) => {
            try {
                const data = await essayService.getById(Number(req.params.id));
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerConfigRoutes() {
        const { configService } = this.services;

        this.app.get('/api/configs', async (req, res) => {
            try {
                const data = await configService.list();
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _sendError(res, error) {
        const normalized = this._normalizeError(error);
        res.status(200).json({
            success: false,
            error_code: normalized.code,
            code: normalized.code,
            message: normalized.message
        });
    }

    _normalizeError(error) {
        if (!error) {
            return { code: 'unknown_error', message: '未知错误' };
        }
        if (error.code && error.message) {
            return { code: error.code, message: error.message };
        }
        if (typeof error === 'object' && error.message) {
            return { code: error.code || 'unknown_error', message: error.message };
        }
        return { code: 'unknown_error', message: String(error) };
    }
}

// 启动服务器
async function main() {
    const port = process.env.WRITING_API_PORT || 3000;
    const server = new StandaloneApiServer(Number(port));

    try {
        await server.start();
        console.log(JSON.stringify({
            success: true,
            message: 'Standalone API server started',
            port: server.port,
            baseUrl: `http://${server.host}:${server.port}`
        }));
    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            error: error.message,
            stack: error.stack
        }));
        process.exit(1);
    }

    // 优雅关闭
    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await server.stop();
        process.exit(0);
    });
}

// 如果直接运行此脚本
if (require.main === module) {
    main();
}

module.exports = StandaloneApiServer;
