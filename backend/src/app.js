const path = require('node:path');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const helmet = require('helmet');

const db = require('./db');
const { PostgresAuthStore, createAuthRouter, publicUser, requireAdmin } = require('./auth');
const { PostgresAdminStore, createAdminRouter } = require('./admin');
const { PostgresPracticeRecordStore, createPracticeRecordsRouter } = require('./practiceRecords');

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
    const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || 'development-session-secret-change-me';

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
    const practiceStore = options.practiceStore || new PostgresPracticeRecordStore(dbClient);
    const adminStore = options.adminStore || new PostgresAdminStore(dbClient);

    app.get('/api/health', (req, res) => {
        res.json({ ok: true });
    });
    app.use('/api/auth', createAuthRouter({
        store: authStore,
        cookieName,
        rateLimit: options.rateLimit
    }));
    app.use('/api/practice-records', createPracticeRecordsRouter({
        store: practiceStore
    }));
    app.use('/api/admin', createAdminRouter({
        store: adminStore
    }));

    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'API route not found' });
    });

    app.get(['/admin', '/admin/'], (req, res) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/');
        }
        req.session.user = publicUser(req.session.user);
        if (req.session.user.role !== 'admin') {
            return res.status(403).type('text/plain').send('Admin access required');
        }
        return res.sendFile(path.join(adminRoot, 'index.html'));
    });
    app.use('/admin', requireAdmin, express.static(adminRoot, {
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
