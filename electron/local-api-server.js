const logger = require('./utils/logger');

class LocalApiServer {
    constructor(services) {
        this.services = services;
        this.server = null;
        this.port = null;
        this.host = '127.0.0.1';
        this.preferredPort = this._resolvePreferredPort();
        this.app = null;
    }

    _resolvePreferredPort() {
        const raw = process.env.WRITING_API_PORT;
        if (raw === undefined || raw === null || raw === '') {
            return 3000;
        }

        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
            logger.warn('Invalid WRITING_API_PORT, fallback to 3000', null, { value: raw });
            return 3000;
        }

        return parsed;
    }

    async start() {
        if (this.server) {
            return this.getInfo();
        }

        // lazy load，避免在不需要时引入
        const express = require('express');

        this.app = express();
        this.app.use(express.json({ limit: '20mb' }));

        this.app.get('/health', (req, res) => {
            res.json({ success: true, data: { status: 'ok' } });
        });

        this._registerEvaluateRoutes();
        this._registerReadingCoachRoutes();
        this._registerConfigRoutes();
        this._registerPromptRoutes();
        this._registerEssayRoutes();
        this._registerTopicRoutes();
        this._registerSettingsRoutes();
        this._registerUploadRoutes();

        try {
            await this._listen(this.preferredPort);
        } catch (error) {
            if (error.code !== 'EADDRINUSE') {
                throw error;
            }

            logger.warn('Preferred local API port occupied, fallback to random port', null, {
                requestedPort: this.preferredPort
            });
            await this._listen(0);
        }

        return this.getInfo();
    }

    async stop() {
        if (!this.server) return;
        await new Promise((resolve) => this.server.close(resolve));
        logger.info('Local API server stopped');
        this.server = null;
        this.port = null;
    }

    getInfo() {
        return {
            host: this.host,
            port: this.port,
            baseUrl: this.port ? `http://${this.host}:${this.port}` : null
        };
    }

    async _listen(port) {
        await new Promise((resolve, reject) => {
            const server = this.app.listen(port, this.host);

            const cleanup = () => {
                server.removeListener('error', onError);
                server.removeListener('listening', onListening);
            };

            const onError = (error) => {
                cleanup();
                reject(error);
            };

            const onListening = () => {
                cleanup();
                this.server = server;
                const address = server.address();
                this.port = address.port;
                logger.info('Local API server started', null, this.getInfo());
                resolve();
            };

            server.once('error', onError);
            server.once('listening', onListening);
        });
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

    _registerReadingCoachRoutes() {
        const { readingCoachService } = this.services;
        if (!readingCoachService) {
            return;
        }

        this.app.post('/api/reading/coach/query', async (req, res) => {
            const wantsStream = req.query?.stream === '1' || req.query?.stream === 'true' || req.body?.stream === true;
            if (wantsStream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.flushHeaders?.();

                const writeEvent = (type, data = {}) => {
                    res.write(`event: ${type}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                };

                try {
                    writeEvent('start', { ts: Date.now() });
                    const payload = Object.assign({}, req.body || {});
                    delete payload.stream;
                    const data = await readingCoachService.query(payload, {
                        onEvent: (event) => {
                            writeEvent(event?.type || 'progress', event || {});
                        }
                    });
                    writeEvent('complete', { success: true, data });
                } catch (error) {
                    writeEvent('error', {
                        success: false,
                        error: {
                            code: error?.code || 'reading_coach_failed',
                            message: error?.message || 'reading_coach_failed'
                        }
                    });
                } finally {
                    res.end();
                }
                return;
            }

            try {
                const payload = req.body || {};
                const data = await readingCoachService.query(payload);
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

        this.app.post('/api/configs', async (req, res) => {
            try {
                const data = await configService.create(req.body || {});
                res.json({ success: true, data, message: 'API配置创建成功' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.put('/api/configs/:id', async (req, res) => {
            try {
                const id = Number(req.params.id);
                const body = req.body || {};
                const updates = { ...body };
                const shouldSetDefault = Number(body.is_default) === 1;
                delete updates.is_default;

                if (Object.keys(updates).length > 0) {
                    await configService.update(id, updates);
                }
                if (shouldSetDefault) {
                    await configService.setDefault(id);
                }

                res.json({ success: true, message: '配置更新成功' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.delete('/api/configs/:id', async (req, res) => {
            try {
                await configService.delete(Number(req.params.id));
                res.json({ success: true, message: '配置已删除' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.post('/api/configs/:id/test', async (req, res) => {
            try {
                const data = await configService.test(Number(req.params.id));
                res.json({ success: true, ...data });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerPromptRoutes() {
        const { promptService } = this.services;

        this.app.get('/api/prompts/active', async (req, res) => {
            try {
                const taskType = req.query.task_type || req.query.taskType;
                const data = await promptService.getActive(taskType);
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.post('/api/prompts/import', async (req, res) => {
            try {
                const data = await promptService.import(req.body);
                res.json({ success: true, ...data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/prompts/export', async (req, res) => {
            try {
                const data = await promptService.exportActive();
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.put('/api/prompts/:id/activate', async (req, res) => {
            try {
                const data = await promptService.activate(Number(req.params.id));
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerEssayRoutes() {
        const { essayService } = this.services;

        this.app.post('/api/essays', async (req, res) => {
            try {
                const essayId = await essayService.create(req.body || {});
                res.json({ success: true, essay_id: essayId, message: '评分记录已保存' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/essays', async (req, res) => {
            try {
                const { page = 1, limit = 20, ...filters } = req.query;
                const normalized = {
                    ...filters,
                    min_score: filters.min_score !== undefined ? Number(filters.min_score) : undefined,
                    max_score: filters.max_score !== undefined ? Number(filters.max_score) : undefined
                };
                const data = await essayService.list(normalized, {
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

        this.app.delete('/api/essays/:id', async (req, res) => {
            try {
                await essayService.delete(Number(req.params.id));
                res.json({ success: true, message: '记录已删除' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.post('/api/essays/batch-delete', async (req, res) => {
            try {
                const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
                const deletedCount = await essayService.batchDelete(ids);
                res.json({ success: true, deleted_count: deletedCount, message: `已删除${deletedCount}条记录` });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.delete('/api/essays/all', async (req, res) => {
            try {
                const deletedCount = await essayService.deleteAll();
                res.json({ success: true, deleted_count: deletedCount, message: '所有历史记录已清空' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/essays/statistics', async (req, res) => {
            try {
                const range = req.query.range || 'all';
                const taskType = req.query.task_type || null;
                const data = await essayService.getStatistics(range, taskType);
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.get('/api/essays/export', async (req, res) => {
            try {
                const data = await essayService.exportCSV(req.query || {});
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.send(data);
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerTopicRoutes() {
        const { topicService } = this.services;

        this.app.get('/api/topics', async (req, res) => {
            try {
                const { page = 1, limit = 20, ...filters } = req.query;
                const data = await topicService.list(filters, {
                    page: Number(page),
                    limit: Number(limit)
                });
                res.json({ success: true, ...data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.post('/api/topics', async (req, res) => {
            try {
                const topicId = await topicService.create(req.body || {});
                res.json({ success: true, topic_id: topicId, message: '题目创建成功' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.put('/api/topics/:id', async (req, res) => {
            try {
                await topicService.update(Number(req.params.id), req.body || {});
                res.json({ success: true, message: '题目更新成功' });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.delete('/api/topics/:id', async (req, res) => {
            try {
                await topicService.delete(Number(req.params.id));
                res.json({ success: true, message: '题目已删除' });
            } catch (error) {
                this._sendError(res, error);
            }
        });
    }

    _registerSettingsRoutes() {
        const { settingsService } = this.services;

        this.app.get('/api/settings', async (req, res) => {
            try {
                const data = await settingsService.getAll();
                res.json({ success: true, data });
            } catch (error) {
                this._sendError(res, error);
            }
        });

        this.app.put('/api/settings', async (req, res) => {
            try {
                await settingsService.update(req.body || {});
                res.json({ success: true, message: '设置已更新' });
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
                const deleted = await uploadService.deleteImage(req.params.filename);
                if (!deleted) {
                    const error = new Error('图片不存在或已删除');
                    error.code = 'image_not_found';
                    throw error;
                }
                res.json({ success: true, message: '图片已删除' });
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
            return {
                code: error.code,
                message: error.message
            };
        }

        if (typeof error === 'object' && error.message) {
            return {
                code: error.code || 'unknown_error',
                message: error.message
            };
        }

        return {
            code: 'unknown_error',
            message: String(error)
        };
    }
}

module.exports = LocalApiServer;
