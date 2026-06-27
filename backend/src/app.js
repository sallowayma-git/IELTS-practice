const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const helmet = require('helmet');

const db = require('./db');
const { PostgresAuthStore, createAuthRouter, publicUser, requireAuth, requireAdmin } = require('./auth');
const { PostgresAuthHandoffStore, createAuthHandoffRouter, verifySignedAuthState } = require('./authHandoff');
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
const ONION_HOSTNAME_PATTERN = /^[a-z2-7]{56}\.onion$/i;
const BOOLEAN_TRUE_STRINGS = new Set(['1', 'true', 'yes', 'on']);
const BOOLEAN_FALSE_STRINGS = new Set(['0', 'false', 'no', 'off']);

function isProduction(options = {}) {
    return (options.nodeEnv || process.env.NODE_ENV) === 'production';
}

function isWeakSecret(secret) {
    return !secret
        || secret === DEFAULT_SESSION_SECRET
        || secret === PLACEHOLDER_SESSION_SECRET
        || String(secret).length < 32;
}

function normalizePublicBaseUrl(value) {
    const text = String(value || '').trim().replace(/\/+$/g, '');
    if (!text) {
        return '';
    }
    try {
        const url = new URL(text);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        url.pathname = url.pathname.replace(/\/+$/g, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/+$/g, '');
    } catch (_) {
        return '';
    }
}

function getOptionOrEnv(options, optionName, envName) {
    if (Object.prototype.hasOwnProperty.call(options, optionName)) {
        return options[optionName];
    }
    return process.env[envName];
}

function resolveAuthPublicUrls(options = {}) {
    const urls = {
        authPublicUrl: normalizePublicBaseUrl(getOptionOrEnv(options, 'authPublicUrl', 'AUTH_PUBLIC_URL')),
        businessPublicUrl: normalizePublicBaseUrl(getOptionOrEnv(options, 'businessPublicUrl', 'BUSINESS_PUBLIC_URL')),
        adminPublicUrl: normalizePublicBaseUrl(getOptionOrEnv(options, 'adminPublicUrl', 'ADMIN_PUBLIC_URL'))
    };
    if (isProduction(options)) {
        const missing = [];
        if (!urls.authPublicUrl) missing.push('AUTH_PUBLIC_URL');
        if (!urls.businessPublicUrl) missing.push('BUSINESS_PUBLIC_URL');
        if (!urls.adminPublicUrl) missing.push('ADMIN_PUBLIC_URL');
        if (missing.length) {
            throw new Error(`${missing.join(', ')} must be set to valid http(s) public URLs in production`);
        }
    }
    return urls;
}

function resolveSessionSecret(options = {}) {
    const secret = options.sessionSecret || process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;

    if (isProduction(options) && isWeakSecret(secret)) {
        throw new Error('SESSION_SECRET must be set to a non-placeholder value of at least 32 characters in production');
    }

    return secret;
}

function getPublicUrlEntries(urls) {
    return [
        ['AUTH_PUBLIC_URL', urls.authPublicUrl],
        ['BUSINESS_PUBLIC_URL', urls.businessPublicUrl],
        ['ADMIN_PUBLIC_URL', urls.adminPublicUrl]
    ].filter(([, value]) => value);
}

function isValidOnionHostname(hostname) {
    return ONION_HOSTNAME_PATTERN.test(String(hostname || '').toLowerCase());
}

function classifyPublicUrl(urlText) {
    try {
        const url = new URL(urlText);
        if (url.protocol === 'https:') {
            return 'https';
        }
        if (url.protocol === 'http:' && isValidOnionHostname(url.hostname)) {
            return 'onion-http';
        }
        if (url.protocol === 'http:') {
            return 'clearnet-http';
        }
    } catch (_) {
        return 'invalid';
    }
    return 'invalid';
}

function resolvePublicUrlPolicy(urls, options = {}) {
    const entries = getPublicUrlEntries(urls);
    const profiles = entries.map(([name, value]) => [name, classifyPublicUrl(value)]);
    const hasHttps = profiles.some(([, profile]) => profile === 'https');
    if (!isProduction(options)) {
        return {
            profile: hasHttps ? 'https' : 'development',
            cookieSecure: hasHttps ? true : null
        };
    }

    const unsafe = profiles.filter(([, profile]) => profile !== 'https' && profile !== 'onion-http');
    if (unsafe.length) {
        throw new Error(`${unsafe.map(([name]) => name).join(', ')} must use HTTPS or a valid http://*.onion public URL in production`);
    }
    if (profiles.every(([, profile]) => profile === 'https')) {
        return { profile: 'https', cookieSecure: true };
    }
    if (profiles.every(([, profile]) => profile === 'onion-http')) {
        return { profile: 'onion-http', cookieSecure: false };
    }
    throw new Error('AUTH_PUBLIC_URL, BUSINESS_PUBLIC_URL, and ADMIN_PUBLIC_URL must all use the same production public URL mode: HTTPS or valid http://*.onion');
}

function resolveCookieSecure(options = {}, publicUrlPolicy = { cookieSecure: null }) {
    if (publicUrlPolicy.cookieSecure !== null && publicUrlPolicy.cookieSecure !== undefined) {
        return publicUrlPolicy.cookieSecure;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'cookieSecure')) {
        return Boolean(options.cookieSecure);
    }
    return parseBoolean(process.env.COOKIE_SECURE, false);
}

function resolveAuthHandoffSecret(options = {}, sessionSecret, urls = {}) {
    const configured = getOptionOrEnv(options, 'authHandoffSecret', 'AUTH_HANDOFF_STATE_SECRET');
    const secret = configured || sessionSecret;
    const publicUrlConfigured = getPublicUrlEntries(urls).length > 0;
    if ((isProduction(options) || publicUrlConfigured) && isWeakSecret(secret)) {
        throw new Error('AUTH_HANDOFF_STATE_SECRET or SESSION_SECRET must be set to a non-placeholder value of at least 32 characters when auth handoff public URLs are configured');
    }
    return secret;
}

function parseTrustedProxyEntries(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function isBooleanLikeString(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return BOOLEAN_TRUE_STRINGS.has(normalized) || BOOLEAN_FALSE_STRINGS.has(normalized);
}

function resolveTrustedProxyEntries(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'trustedProxyIps')) {
        return parseTrustedProxyEntries(options.trustedProxyIps);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'trustedProxyCidrs')) {
        return parseTrustedProxyEntries(options.trustedProxyCidrs);
    }
    return parseTrustedProxyEntries(process.env.TRUSTED_PROXY_IPS || process.env.TRUSTED_PROXY_CIDRS || '');
}

function resolveTrustProxy(options = {}) {
    const raw = Object.prototype.hasOwnProperty.call(options, 'trustProxy')
        ? options.trustProxy
        : process.env.TRUST_PROXY;
    const trustedEntries = resolveTrustedProxyEntries(options);

    if (Array.isArray(raw)) {
        const entries = parseTrustedProxyEntries(raw);
        return entries.length === 1 ? entries[0] : entries;
    }
    if (typeof raw === 'string' && raw.trim() && !isBooleanLikeString(raw)) {
        const entries = parseTrustedProxyEntries(raw);
        return entries.length === 1 ? entries[0] : entries;
    }

    const enabled = typeof raw === 'boolean'
        ? raw
        : parseBoolean(raw, false);
    if (!enabled) {
        return false;
    }
    if (trustedEntries.length) {
        return trustedEntries.length === 1 ? trustedEntries[0] : trustedEntries;
    }
    if (isProduction(options)) {
        throw new Error('TRUST_PROXY=true requires TRUSTED_PROXY_IPS or TRUSTED_PROXY_CIDRS in production');
    }
    return 'loopback';
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
    const returnTo = encodeURIComponent(req.originalUrl || req.url || '/');
    const loginUrl = `/auth/business/start?return_to=${returnTo}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Refresh', `3; url=${loginUrl}`);
    return res.status(401).type('html').send(`<!doctype html>
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
        <h1>401 Unauthorized</h1>
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
    const authPublicUrls = resolveAuthPublicUrls(options);
    const repoRoot = options.staticRoot || path.resolve(__dirname, '..', '..');
    const adminRoot = options.adminRoot || path.resolve(__dirname, '..', 'admin');
    const authRoot = options.authRoot || path.resolve(__dirname, '..', 'auth');
    const pool = options.pool || db.pool;
    const dbClient = options.db || db;
    const cookieName = options.cookieName || 'ielts.sid';
    const cookieSecure = resolveCookieSecure(options, publicUrlPolicy);
    const trustProxy = resolveTrustProxy(options);
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
    const authHandoffStore = options.authHandoffStore || new PostgresAuthHandoffStore(dbClient);
    const authHandoffSecret = resolveAuthHandoffSecret(options, sessionSecret, authPublicUrls);
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
    const publicUrlPolicy = resolvePublicUrlPolicy(authPublicUrls, options);
            await refreshStoredUser('pendingTotpLogin');
            await refreshStoredUser('pendingTotpSetup');
            return next();
        } catch (error) {
            return next(error);
        }
    }

    app.use(['/api/auth', '/api/practice-records', '/api/admin', '/admin', '/auth'], noStoreSensitiveApiMiddleware);
    app.use(['/api/auth', '/api/practice-records', '/api/admin', '/admin', '/auth'], refreshSessionUser);
    app.use(createTrafficMiddleware({
        store: trafficStore,
        enabled: trafficEnabled,
        secret: options.trafficSecret || process.env.TRAFFIC_SECRET || sessionSecret,
        nodeEnv: options.nodeEnv
    }));

    app.get('/api/health', (req, res) => {
        res.json({ ok: true });
    });
    app.use('/auth', createAuthHandoffRouter({
        authStore,
        totpStore,
        ticketStore: authHandoffStore,
        stateSecret: authHandoffSecret,
        ticketTtlMs: options.authHandoffTicketTtlMs,
        authPublicUrl: authPublicUrls.authPublicUrl,
        businessPublicUrl: authPublicUrls.businessPublicUrl,
        adminPublicUrl: authPublicUrls.adminPublicUrl,
        nodeEnv: options.nodeEnv,
        totpVerificationMaxAgeMs
    }));
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

    app.get('/admin/login', async (req, res, next) => {
        try {
            if (req.session && req.session.user) {
                req.session.user = publicUser(req.session.user);
                if (req.session.user.role === 'admin') {
                    if (!totpEnabled) {
                        return res.redirect('/admin');
                    }
                    const totpStatus = await totpStore.getStatus(req.session.user.id);
                    if (totpStatus.enabled && hasSessionTotpVerification(req, req.session.user, totpVerificationMaxAgeMs)) {
                        return res.redirect('/admin');
                    }
                }
            }
            return res.redirect('/auth/admin/start?return_to=/admin');
        } catch (error) {
            return next(error);
        }
    });
    app.get('/admin/login.js', (req, res) => {
        res.sendFile(path.join(adminRoot, 'login.js'));
    });
    app.get('/admin/login.css', (req, res) => {
        res.sendFile(path.join(adminRoot, 'login.css'));
    });

    async function sendProtectedAdminPage(req, res, next, fileName) {
        const returnTo = encodeURIComponent(req.originalUrl || '/admin');
        const adminStartUrl = `/auth/admin/start?return_to=${returnTo}`;
        try {
            if (!req.session || !req.session.user) {
                return res.redirect(adminStartUrl);
            }
            req.session.user = publicUser(req.session.user);
            if (req.session.user.role !== 'admin') {
                return res.status(403).type('text/plain').send('Admin access required');
            }
            if (totpEnabled) {
                const totpStatus = await totpStore.getStatus(req.session.user.id);
                if (!totpStatus.enabled) {
                    return res.redirect(adminStartUrl);
                }
                if (!hasSessionTotpVerification(req, req.session.user, totpVerificationMaxAgeMs)) {
                    return res.redirect(adminStartUrl);
                }
            }
            return res.sendFile(path.join(adminRoot, fileName));
        } catch (error) {
            return next(error);
        }
        cookieSecure,
    }

    app.get(['/admin', '/admin/'], (req, res, next) => {
        return sendProtectedAdminPage(req, res, next, 'index.html');
    });
    app.get(['/admin/account', '/admin/account/'], (req, res, next) => {
        return sendProtectedAdminPage(req, res, next, 'account.html');
    });
    app.use('/admin', requireAdmin, requireAdminTotp, createStaticBoundaryMiddleware(adminRoot), express.static(adminRoot, {
        dotfiles: 'deny',
        index: false
    }));

    app.get(['/auth/login', '/auth/login/'], (req, res) => {
        const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
        if (stateParam) {
            const state = verifySignedAuthState(authHandoffSecret, stateParam);
            if (!state) {
                return res.status(400).type('text/plain').send('Invalid auth handoff state');
            }
            const query = new URLSearchParams({ state: stateParam }).toString();
            return res.redirect(`/auth/${state.audience}/login?${query}`);
        }
        res.sendFile(path.join(authRoot, 'login.html'));
    });
    app.get(['/auth/business/login', '/auth/business/login/'], (req, res) => {
        res.sendFile(path.join(authRoot, 'login.html'));
    });
    app.get(['/auth/admin/login', '/auth/admin/login/'], (req, res) => {
        res.sendFile(path.join(authRoot, 'login.html'));
    });
    app.get('/auth/login.js', (req, res) => {
        res.sendFile(path.join(authRoot, 'login.js'));
    });
    app.get('/auth/login.css', (req, res) => {
        res.sendFile(path.join(authRoot, 'login.css'));
    });
    app.get(['/auth/account', '/auth/account/'], requireAuth, (req, res) => {
        res.sendFile(path.join(authRoot, 'account.html'));
    });
    app.get('/auth/account.js', requireAuth, (req, res) => {
        res.sendFile(path.join(authRoot, 'account.js'));
    });
    app.get('/auth/account.css', requireAuth, (req, res) => {
        res.sendFile(path.join(authRoot, 'account.css'));
    });

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
