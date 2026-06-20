const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const helmet = require('helmet');

const db = require('./db');
const { PostgresAuthStore, createAuthRouter, publicUser, requireAdmin } = require('./auth');
const { PostgresAdminStore, createAdminRouter, createTrafficMiddleware } = require('./admin');
const { PostgresPracticeRecordStore, createPracticeRecordsRouter } = require('./practiceRecords');
const { PostgresTotpStore, createRequireAdminTotp, createTotpRouter, hasSessionTotpVerification } = require('./totp');

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

function createContentSecurityPolicy(req) {
    const path = req.path || '';
    const listeningContent = path === '/ListeningPractice'
        || path.startsWith('/ListeningPractice/');
    const legacyTemplate = path === '/templates'
        || path.startsWith('/templates/');
    const legacyExercisePage = listeningContent || legacyTemplate;
    const scriptSrc = legacyExercisePage
        ? ["'self'", "'unsafe-inline'"]
        : ["'self'"];
    const connectSrc = listeningContent ? ["'none'"] : ["'self'"];
    const formAction = listeningContent ? ["'none'"] : ["'self'"];
    const directives = [
        ["default-src", ["'self'"]],
        ["base-uri", listeningContent ? ["'none'"] : ["'self'"]],
        ["object-src", ["'none'"]],
        ["frame-ancestors", ["'self'"]],
        ["form-action", formAction],
        ["script-src", scriptSrc],
        ["script-src-attr", legacyExercisePage ? ["'unsafe-inline'"] : ["'none'"]],
        ["style-src", ["'self'", "'unsafe-inline'"]],
        ["style-src-attr", ["'unsafe-inline'"]],
        ["img-src", ["'self'", 'data:', 'blob:']],
        ["font-src", ["'self'", 'data:']],
        ["media-src", ["'self'", 'data:', 'blob:']],
        ["connect-src", connectSrc],
        ["frame-src", listeningContent ? ["'none'"] : ["'self'"]],
        ["child-src", listeningContent ? ["'none'"] : ["'self'", 'blob:']],
        ["worker-src", ["'self'", 'blob:']],
        ["manifest-src", ["'self'"]]
    ];
    if (listeningContent) {
        directives.push(["sandbox", ['allow-scripts', 'allow-downloads']]);
    }
    return directives
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ');
}

function securityPolicyMiddleware(req, res, next) {
    res.setHeader('Content-Security-Policy', createContentSecurityPolicy(req));
    res.setHeader('Permissions-Policy', [
        'camera=()',
        'microphone=()',
        'geolocation=()',
        'payment=()',
        'usb=()',
        'serial=()'
    ].join(', '));
    next();
}

function noStoreSensitiveApiMiddleware(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
}

function isPathInside(parent, child) {
    const parentPath = path.resolve(parent);
    const childPath = path.resolve(child);
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function createStaticBoundaryMiddleware(root) {
    const rootPath = path.resolve(root);
    let rootRealpathPromise = null;

    function getRootRealpath() {
        if (!rootRealpathPromise) {
            rootRealpathPromise = fs.promises.realpath(rootPath).catch((error) => {
                if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
                    return null;
                }
                throw error;
            });
        }
        return rootRealpathPromise;
    }

    return async function staticBoundaryMiddleware(req, res, next) {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return next();
            }
            if (String(req.path || '').includes('\0')) {
                return res.status(400).type('text/plain').send('Invalid path');
            }
            const rootRealpath = await getRootRealpath();
            if (!rootRealpath) {
                return next();
            }
            const candidatePath = path.resolve(rootPath, `.${req.path || '/'}`);
            if (!isPathInside(rootPath, candidatePath)) {
                return res.status(403).type('text/plain').send('Forbidden');
            }
            let candidateRealpath;
            try {
                candidateRealpath = await fs.promises.realpath(candidatePath);
            } catch (error) {
                if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
                    return next();
                }
                throw error;
            }
            if (!isPathInside(rootRealpath, candidateRealpath)) {
                return res.status(403).type('text/plain').send('Forbidden');
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
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
    const sessionCookieOptions = {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000
    };
    const clearSessionCookieOptions = {
        httpOnly: sessionCookieOptions.httpOnly,
        sameSite: sessionCookieOptions.sameSite,
        secure: sessionCookieOptions.secure,
        path: '/'
    };

    app.disable('x-powered-by');
    app.set('trust proxy', trustProxy);
    app.use(helmet({
        contentSecurityPolicy: false
    }));
    app.use(securityPolicyMiddleware);
    app.use(express.json({ limit: '2mb' }));

    app.use(session({
        name: cookieName,
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        store: options.sessionStore || createDefaultSessionStore(pool),
        cookie: sessionCookieOptions
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

    async function refreshSessionUser(req, res, next) {
        try {
            if (!req.session || typeof authStore.findById !== 'function') {
                return next();
            }

            async function refreshStoredUser(key) {
                const sessionValue = req.session[key];
                const sessionUser = key === 'user' ? sessionValue : sessionValue?.user;
                if (!sessionUser?.id) {
                    return;
                }
                const user = await authStore.findById(sessionUser.id);
                if (!user) {
                    delete req.session[key];
                    return;
                }
                const refreshedUser = publicUser(user);
                if (key === 'user') {
                    req.session.user = refreshedUser;
                } else {
                    req.session[key] = {
                        ...sessionValue,
                        user: refreshedUser
                    };
                }
            }

            await refreshStoredUser('user');
            await refreshStoredUser('pendingTotpLogin');
            await refreshStoredUser('pendingTotpSetup');
            return next();
        } catch (error) {
            return next(error);
        }
    }

    app.use(['/api/auth', '/api/practice-records', '/api/admin'], noStoreSensitiveApiMiddleware);
    app.use(['/api/auth', '/api/practice-records', '/api/admin', '/admin'], refreshSessionUser);
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
        clearCookieOptions: clearSessionCookieOptions,
        bcrypt: options.bcrypt,
        rateLimit: options.rateLimit,
        csrfRateLimit: options.csrfRateLimit,
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
        nodeEnv: options.nodeEnv,
        recoveryHashRounds: options.totpRecoveryHashRounds
    }));
    app.use('/api/practice-records', createPracticeRecordsRouter({
        store: practiceStore
    }));
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
                if (!hasSessionTotpVerification(req, req.session.user)) {
                    return res.status(403).type('text/plain').send('Admin TOTP verification required');
                }
            }
            return res.sendFile(path.join(adminRoot, 'index.html'));
        } catch (error) {
            return next(error);
        }
    });
    app.use('/admin', requireAdmin, requireAdminTotp, createStaticBoundaryMiddleware(adminRoot), express.static(adminRoot, {
        dotfiles: 'deny',
        index: false
    }));

    app.get('/', (req, res) => {
        res.sendFile(path.join(repoRoot, 'index.html'));
    });

    for (const directory of ['assets', 'css', 'js', 'templates', 'ListeningPractice']) {
        const staticDirectory = path.join(repoRoot, directory);
        app.use(`/${directory}`, createStaticBoundaryMiddleware(staticDirectory), express.static(staticDirectory, {
            dotfiles: 'deny',
            index: false
        }));
    }

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        if (error && error.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Malformed request body' });
        }
        const isZodError = error && (error.name === 'ZodError' || Array.isArray(error.issues));
        const status = isZodError ? 400 : (error.status || error.statusCode || 500);
        if (status >= 500) {
            console.error('[backend] request failed:', error);
        }
        const payload = {
            error: status >= 500 ? 'Internal server error' : (error.message || 'Request failed')
        };
        if (status < 500 && error.details) {
            payload.details = error.details;
        }
        return res.status(status).json(payload);
    });

    return app;
}

module.exports = {
    createApp,
    createStaticBoundaryMiddleware
};
