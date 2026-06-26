const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const helmet = require('helmet');

const db = require('./db');
const { PostgresAuthStore, createAuthRouter, publicUser, requireAuth, requireAdmin } = require('./auth');
const { PostgresAdminStore, createAdminRouter, createTrafficMiddleware } = require('./admin');
const { PostgresPracticeRecordStore, createPracticeRecordsRouter } = require('./practiceRecords');
const {
    PostgresTotpStore,
    createRequireAdminTotp,
    createTotpRouter,
    hasSessionTotpVerification,
    resolveTotpVerificationMaxAgeMs
} = require('./totp');

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
    const requestPath = String(req.path || '').toLowerCase();
    const listeningContent = requestPath === '/listeningpractice'
        || requestPath.startsWith('/listeningpractice/')
        || requestPath === '/practice/listening'
        || requestPath.startsWith('/practice/listening/');
    const legacyTemplate = requestPath === '/templates'
        || requestPath.startsWith('/templates/');
    const legacyExercisePage = listeningContent || legacyTemplate;
    const scriptSrc = legacyExercisePage
        ? ["'self'", "'unsafe-inline'"]
        : ["'self'"];
    const connectSrc = listeningContent ? ["'none'"] : ["'self'"];
    const formAction = listeningContent ? ["'none'"] : ["'self'"];
    const directives = [
        ["default-src", ["'self'"]],
        ["base-uri", ["'self'"]],
        ["object-src", ["'none'"]],
        ["frame-ancestors", ["'none'"]],
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
        directives.push(["sandbox", ['allow-scripts', 'allow-downloads', 'allow-same-origin']]);
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

function summarizeErrorForLog(error) {
    if (!error || typeof error !== 'object') {
        return { name: typeof error };
    }
    const summary = {
        name: typeof error.name === 'string' && error.name ? error.name : 'Error'
    };
    if (error.code !== undefined) {
        summary.code = String(error.code);
    }
    if (error.status !== undefined || error.statusCode !== undefined) {
        summary.status = Number(error.status || error.statusCode);
    }
    return summary;
}

function isPathInside(parent, child) {
    const parentPath = path.resolve(parent);
    const childPath = path.resolve(child);
    const relative = path.relative(parentPath, childPath);
    return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeStaticRequestPath(value) {
    const raw = String(value || '/').split(/[?#]/, 1)[0].replace(/\\/g, '/');
    const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
    const normalized = path.posix.normalize(withLeadingSlash).replace(/\/+$/g, '');
    return (normalized || '/').toLowerCase();
}

function decodeStaticPathSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch (_) {
        return value;
    }
}

function getStaticRequestSegments(value) {
    const rawPath = String(value || '/')
        .split(/[?#]/, 1)[0]
        .replace(/\\/g, '/');
    const decodedPath = decodeStaticPathSegment(rawPath).replace(/\\/g, '/');
    return Array.from(new Set([rawPath, decodedPath]))
        .flatMap((candidate) => candidate
            .split('/')
            .filter(Boolean)
            .map((segment) => decodeStaticPathSegment(segment).toLowerCase()));
}

function normalizeBlockedStaticPrefix(value) {
    const normalized = normalizeStaticRequestPath(value);
    return normalized === '/' ? '' : normalized;
}

function getBlockedStaticPrefixSegments(value) {
    return normalizeBlockedStaticPrefix(value)
        .split('/')
        .filter(Boolean);
}

function createStaticBoundaryMiddleware(root, options = {}) {
    const rootPath = path.resolve(root);
    let rootRealpathPromise = null;
    const blockedPrefixEntries = Array.isArray(options.blockedPrefixes)
        ? options.blockedPrefixes.map(normalizeBlockedStaticPrefix).filter(Boolean)
            .map((prefix) => ({
                prefix,
                segments: getBlockedStaticPrefixSegments(prefix)
            }))
        : [];

    function hasBlockedStaticSegments(segments, blockedSegments) {
        if (!blockedSegments.length || segments.length < blockedSegments.length) {
            return false;
        }
        for (let index = 0; index <= segments.length - blockedSegments.length; index += 1) {
            let matches = true;
            for (let offset = 0; offset < blockedSegments.length; offset += 1) {
                if (segments[index + offset] !== blockedSegments[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return true;
            }
        }
        return false;
    }

    function isBlockedRequestPath(requestPath, requestUrl) {
        if (!blockedPrefixEntries.length) {
            return false;
        }
        return [requestPath, requestUrl].some((candidate) => {
            const normalized = normalizeStaticRequestPath(candidate);
            const segments = getStaticRequestSegments(candidate);
            return blockedPrefixEntries.some(({ prefix, segments: blockedSegments }) => {
                return normalized === prefix
                    || normalized.startsWith(`${prefix}/`)
                    || hasBlockedStaticSegments(segments, blockedSegments);
            });
        });
    }

    function getRootRealpath() {
        if (!rootRealpathPromise) {
            rootRealpathPromise = fs.promises.realpath(rootPath).catch((error) => {
                if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
                    rootRealpathPromise = null;
                    return null;
                }
                rootRealpathPromise = null;
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
            if (isBlockedRequestPath(req.path || '/', req.url || '/')) {
                return res.status(404).type('text/plain').send('Not found');
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

function normalizeHttpErrorStatus(error, fallback = 500) {
    const status = Number(error?.status ?? error?.statusCode ?? fallback);
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback;
}

function loadGeneratedManifest(filePath, globalKey) {
    const source = fs.readFileSync(filePath, 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, {
        filename: filePath,
        timeout: 1000
    });
    const manifest = sandbox[globalKey];
    return manifest && typeof manifest === 'object' ? manifest : {};
}

function escapeHtmlAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function injectBaseHref(html, baseHref) {
    const baseTag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
    if (/<base\s/i.test(html)) {
        return html.replace(/<base\b[^>]*>/i, baseTag);
    }
    if (/<head(\s[^>]*)?>/i.test(html)) {
        return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    ${baseTag}`);
    }
    return `${baseTag}\n${html}`;
}

function sendHtmlFileWithBase(res, filePath, baseHref, next) {
    fs.readFile(filePath, 'utf8', (error, html) => {
        if (error) {
            return next(error);
        }
        res.type('html').send(injectBaseHref(html, baseHref));
    });
}

function requireContentAuth(req, res, next) {
    if (req.session && req.session.user) {
        req.session.user = publicUser(req.session.user);
        return next();
    }
    const loginUrl = '/?auth=login';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Refresh', `3; url=${loginUrl}`);
    return res.status(403).type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="3; url=${escapeHtmlAttribute(loginUrl)}">
    <title>需要登录</title>
    <style>
        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f8fafc;
            color: #1f2937;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
            width: min(520px, calc(100vw - 32px));
            border: 1px solid #d7dde5;
            border-radius: 8px;
            background: #fff;
            padding: 28px;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        }
        h1 {
            margin: 0 0 12px;
            font-size: 1.25rem;
        }
        p {
            margin: 0 0 18px;
            color: #64748b;
            line-height: 1.6;
        }
        a {
            color: #2563eb;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <main>
        <h1>403 Forbidden</h1>
        <p>题库内容需要登录后访问。页面将在 3 秒后跳转到登录入口。</p>
        <a href="${escapeHtmlAttribute(loginUrl)}">立即前往登录</a>
    </main>
</body>
</html>`);
}

function encodePublicPathSegments(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .map((segment) => {
            try {
                return encodeURIComponent(decodeURIComponent(segment));
            } catch (_) {
                return encodeURIComponent(segment);
            }
        })
        .join('/');
}

function createListeningExamResolver(staticRoot) {
    const manifestPath = path.join(staticRoot, 'assets', 'generated', 'listening-exams', 'manifest.js');
    const listeningRoots = [
        {
            root: path.resolve(staticRoot, 'ListeningPractice'),
            publicRoot: '/ListeningPractice'
        },
        {
            root: path.resolve(staticRoot, 'ListeningPractice', 'vip special', 'ListeningPractice'),
            publicRoot: '/ListeningPractice/vip%20special/ListeningPractice'
        }
    ];
    let cachedManifest = null;

    function getManifest() {
        if (!cachedManifest) {
            try {
                cachedManifest = loadGeneratedManifest(manifestPath, '__LISTENING_EXAM_MANIFEST__');
            } catch (error) {
                if (error && error.code === 'ENOENT') {
                    cachedManifest = {};
                } else {
                    throw error;
                }
            }
        }
        return cachedManifest;
    }

    return function resolveListeningExam(examId) {
        const normalizedExamId = String(examId || '').trim();
        if (!normalizedExamId || !/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(normalizedExamId)) {
            return null;
        }
        const entry = getManifest()[normalizedExamId];
        if (!entry || entry.type !== 'listening' || entry.hasHtml === false) {
            return null;
        }
        const folder = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/g, '');
        const filename = String(entry.filename || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!folder || !filename || !filename.toLowerCase().endsWith('.html')) {
            return null;
        }
        for (const { root: listeningRoot, publicRoot } of listeningRoots) {
            const targetPath = path.resolve(listeningRoot, folder, filename);
            if (!isPathInside(listeningRoot, targetPath)) {
                continue;
            }
            try {
                const rootRealpath = fs.realpathSync(listeningRoot);
                const targetRealpath = fs.realpathSync(targetPath);
                if (isPathInside(rootRealpath, targetRealpath)) {
                    const publicFolder = encodePublicPathSegments(folder);
                    return {
                        targetPath: targetRealpath,
                        baseHref: `${publicRoot}${publicFolder ? `/${publicFolder}` : ''}/`
                    };
                }
            } catch (error) {
                if (!error || (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')) {
                    throw error;
                }
            }
        }
        return null;
    };
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
    const totpVerificationMaxAgeMs = resolveTotpVerificationMaxAgeMs({
        verificationMaxAgeMs: options.totpVerificationMaxAgeMs
    });
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
        totpEnabled
            ? createRequireAdminTotp(totpStore, {
                verificationMaxAgeMs: totpVerificationMaxAgeMs
            })
            : ((req, res, next) => next())
    );
    const trafficEnabled = options.trafficEnabled !== undefined
        ? Boolean(options.trafficEnabled)
        : parseBoolean(process.env.TRAFFIC_ENABLED, true);
    const resolveListeningExam = createListeningExamResolver(repoRoot);

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

    app.use(['/api/auth', '/api/practice-records', '/api/admin', '/admin'], noStoreSensitiveApiMiddleware);
    app.use(['/api/auth', '/api/practice-records', '/api/admin', '/admin'], refreshSessionUser);
    app.use(createTrafficMiddleware({
        store: trafficStore,
        enabled: trafficEnabled,
        secret: options.trafficSecret || process.env.TRAFFIC_SECRET || sessionSecret,
        nodeEnv: options.nodeEnv
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
        verificationMaxAgeMs: totpVerificationMaxAgeMs,
        nodeEnv: options.nodeEnv,
        recoveryHashRounds: options.totpRecoveryHashRounds
    }));
    app.use('/api/practice-records', createPracticeRecordsRouter({
        store: practiceStore
    }));
    app.use('/api/admin', createAdminRouter({
        store: adminStore,
        requireAdminTotp,
        rateLimit: options.adminRateLimit || options.rateLimit,
        totpVerificationMaxAgeMs
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
                if (!hasSessionTotpVerification(req, req.session.user, totpVerificationMaxAgeMs)) {
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

    const protectedContentRoutes = [
        '/practice',
        '/assets/generated/reading-exams',
        '/assets/generated/reading-explanations',
        '/assets/generated/listening-exams',
        '/ListeningPractice',
        '/listeningpractice',
        '/templates',
        '/Templates'
    ];
    app.use(protectedContentRoutes, requireContentAuth);

    app.get([
        '/practice/reading/:examId',
        '/practice/reading/:examId/',
        '/practice/reading/:examId/:mode',
        '/practice/reading/:examId/:mode/'
    ], (req, res, next) => {
        const targetPath = path.join(repoRoot, 'assets', 'generated', 'reading-exams', 'reading-practice-unified.html');
        return sendHtmlFileWithBase(res, targetPath, '/assets/generated/reading-exams/', next);
    });

    app.get(['/practice/listening/:examId', '/practice/listening/:examId/'], (req, res, next) => {
        try {
            const target = resolveListeningExam(req.params.examId);
            if (!target) {
                return res.status(404).type('text/plain').send('Not found');
            }
            return sendHtmlFileWithBase(res, target.targetPath, target.baseHref, next);
        } catch (error) {
            return next(error);
        }
    });

    for (const directory of ['assets', 'css', 'js', 'templates', 'ListeningPractice']) {
        const staticDirectory = path.join(repoRoot, directory);
        const staticBoundaryOptions = directory === 'templates'
            ? { blockedPrefixes: ['/ci-practice-fixtures'] }
            : {};
        app.use(`/${directory}`, createStaticBoundaryMiddleware(staticDirectory, staticBoundaryOptions), express.static(staticDirectory, {
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
        if (error && error.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body too large' });
        }
        const isZodError = error && (error.name === 'ZodError' || Array.isArray(error.issues));
        const status = isZodError ? 400 : normalizeHttpErrorStatus(error);
        if (status >= 500) {
            console.error('[backend] request failed:', summarizeErrorForLog(error));
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
