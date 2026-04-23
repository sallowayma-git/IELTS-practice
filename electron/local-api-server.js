const path = require('node:path');
const logger = require('./utils/logger');
const { ensureTsRuntime } = require('./tsx-register');

class LocalApiServer {
    constructor(services) {
        this.services = services;
        this.server = null;
        this.port = null;
        this.host = '127.0.0.1';
        this.preferredPort = this._resolvePreferredPort();
        this.app = null;
        this._tsxUnregister = null;
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

    async _loadServerAppFactory() {
        const { require: tsxRequire } = require('tsx/cjs/api');
        if (!this._tsxUnregister) {
            this._tsxUnregister = ensureTsRuntime();
        }
        const appModulePath = path.join(__dirname, '..', 'server', 'src', 'app.ts');
        const loaded = tsxRequire(appModulePath, __filename);
        return loaded.createServerApp;
    }

    async start() {
        if (this.server) {
            return this.getInfo();
        }

        const createServerApp = await this._loadServerAppFactory();
        this.app = await createServerApp(this.services);

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
        await this.app.close();
        logger.info('Local API server stopped');
        this.server = null;
        this.port = null;
        this.app = null;
        if (this._tsxUnregister) {
            if (typeof this._tsxUnregister === 'function') {
                this._tsxUnregister();
            } else if (typeof this._tsxUnregister.unregister === 'function') {
                this._tsxUnregister.unregister();
            }
            this._tsxUnregister = null;
        }
    }

    getInfo() {
        return {
            host: this.host,
            port: this.port,
            baseUrl: this.port ? `http://${this.host}:${this.port}` : null
        };
    }

    async _listen(port) {
        await this.app.listen({
            host: this.host,
            port
        });
        const addresses = this.app.addresses();
        const firstAddress = Array.isArray(addresses) && addresses.length > 0
            ? addresses[0]
            : null;
        this.server = this.app.server;
        this.port = firstAddress && typeof firstAddress === 'object'
            ? firstAddress.port
            : port;
        logger.info('Local API server started', null, this.getInfo());
    }
}

module.exports = LocalApiServer;
