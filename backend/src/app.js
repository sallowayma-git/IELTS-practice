const path = require('node:path');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const helmet = require('helmet');

const db = require('./db');
const { PostgresAuthStore, createAuthRouter, publicUser, requireAdmin } = require('./auth');
const { PostgresAdminStore, createAdminRouter, createTrafficMiddleware } = require('./admin');
const { PostgresPracticeRecordStore, createPracticeRecordsRouter } = require('./practiceRecords');
const { PostgresTotpStore, createRequireAdminTotp, createTotpRouter } = require('./totp');

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function createDefaultSessionStore(pool) {
    const PgSession = connectPgSimple(session);
    return new PgSession({
        pool,
        tableName: 'session',
        createTableIfMissing: false
    });
}

const DEFAULT_SESSION_SECRET = 'development-session-secret-change-me';
const PLACEHOLDER_SESSION_SECRET = 'replace-with-a-long-random-session-secret';

function resolveSessionSecret(options = {}) {
    const secret = options.sessionSecret || process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
    const production = (options.nodeEnv || process.env.NODE_ENV) === 'production';
    const weakSecret = !secret
        || secret === DEFAULT_SESSION_SECRET
        || secret === PLACEHOLDER_SESSION_SECRET
        || String(secret).length < 32;

    if (production && weakSecret) {
        throw new Error('SESSION_SECRET must be set to a non-placeholder value of at least 32 characters in production');
    }

    return secret;
}

function createApp(options = {}) {
    const app = express();
    const repoRoot = options.staticRoot || path.resolve(__dirname, '..', '..');
    const adminRoot = options.adminRoot || path.resolve(__dirname, '..', 'admin');
    const pool = options.pool || db.pool;
    const dbClient = options.db || db;
    const cookieName = options.cookieName || 'ielts.sid';
    const cookieSecure = options.cookieSecure !== undefined
        ? options.cookieSecure
        : parseBoolean(process.env.COOKIE_SECURE, false);
    const trustProxy = options.trustProxy !== undefined
        ? options.trustProxy
        : parseBoolean(process.env.TRUST_PROXY, false);
    const sessionSecret = resolveSessionSecret(options);
    const totpEnabled = options.totpEnabled !== undefined
        ? Boolean(options.totpEnabled)
        : parseBoolean(process.env.TOTP_ENABLED, true);

    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy);
    app.use(helmet({
        contentSecurityPolicy: false
    }));
    app.use(express.json({ limit: '2mb' }));

    app.use(session({
        name: cookieName,
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        store: options.sessionStore || createDefaultSessionStore(pool),
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: cookieSecure,
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    }));

    const authStore = options.authStore || new PostgresAuthStore(dbClient);
    const totpStore = options.totpStore || new PostgresTotpStore(dbClient);
    const practiceStore = options.practiceStore || new PostgresPracticeRecordStore(dbClient);
    const adminStore = options.adminStore || new PostgresAdminStore(dbClient);
    const trafficStore = options.trafficStore || adminStore;
    const requireAdminTotp = options.requireAdminTotp || (
        totpEnabled ? createRequireAdminTotp(totpStore) : ((req, res, next) => next())
    );
    const trafficEnabled = options.trafficEnabled !== undefined
        ? Boolean(options.trafficEnabled)
        : parseBoolean(process.env.TRAFFIC_ENABLED, true);

    app.use(createTrafficMiddleware({
        store: trafficStore,
        enabled: trafficEnabled,
        secret: sessionSecret
    }));

    app.get('/api/health', (req, res) => {
        res.json({ ok: true });
    });
    app.use('/api/auth', createAuthRouter({
        store: authStore,
        totpStore,
        cookieName,
        rateLimit: options.rateLimit,
        totpEnabled,
        onDeleteUser: async (userId) => {
            if (practiceStore && typeof practiceStore.clear === 'function') {
                await practiceStore.clear(userId);
            }
            if (totpStore && typeof totpStore.disable === 'function') {
                await totpStore.disable(userId);
            }
        }
    }));
    app.use('/api/auth/totp', createTotpRouter({
        store: totpStore,
        authStore,
        rateLimit: options.totpRateLimit || options.rateLimit,
        bcrypt: options.bcrypt,
        enabled: totpEnabled,
        issuer: options.totpIssuer,
        encryptionKey: options.totpEncryptionKey,
        recoveryHashRounds: options.totpRecoveryHashRounds
    }));
    app.use('/api/practice-records', createPracticeRecordsRouter({
        store: practiceStore
    }));

    async function refreshSessionUser(req, res, next) {
        try {
            if (req.session?.user?.id && typeof authStore.findById === 'function') {
                const user = await authStore.findById(req.session.user.id);
                if (!user) {
                    delete req.session.user;
                    delete req.session.pendingTotpLogin;
                    delete req.session.pendingTotpSetup;
                    return next();
                }
                req.session.user = publicUser(user);
            }
            return next();
        } catch (error) {
            return next(error);
        }
    }

    app.use(['/api/admin', '/admin'], refreshSessionUser);
    app.use('/api/admin', createAdminRouter({
        store: adminStore,
        requireAdminTotp
    }));

    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'API route not found' });
    });

    app.get(['/admin', '/admin/'], async (req, res, next) => {
        try {
            if (!req.session || !req.session.user) {
                return res.redirect('/');
            }
            req.session.user = publicUser(req.session.user);
            if (req.session.user.role !== 'admin') {
                return res.status(403).type('text/plain').send('Admin access required');
            }
            if (totpEnabled) {
                const totpStatus = await totpStore.getStatus(req.session.user.id);
                if (!totpStatus.enabled) {
                    return res.status(403).type('text/plain').send('Admin TOTP setup required');
                }
            }
            return res.sendFile(path.join(adminRoot, 'index.html'));
        } catch (error) {
            return next(error);
        }
    });
    app.use('/admin', requireAdmin, requireAdminTotp, express.static(adminRoot, {
        dotfiles: 'deny',
        index: false
    }));

    app.get('/', (req, res) => {
        res.sendFile(path.join(repoRoot, 'index.html'));
    });

    for (const directory of ['assets', 'css', 'js', 'templates', 'ListeningPractice']) {
        app.use(`/${directory}`, express.static(path.join(repoRoot, directory), {
            dotfiles: 'deny',
            index: false
        }));
    }

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        const status = error.status || error.statusCode || 500;
        if (status >= 500) {
            console.error('[backend] request failed:', error);
        }
        return res.status(status).json({
            error: status >= 500 ? 'Internal server error' : (error.message || 'Request failed')
        });
    });

    return app;
}

module.exports = {
    createApp
};
