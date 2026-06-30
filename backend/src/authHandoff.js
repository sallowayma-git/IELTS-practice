const crypto = require('node:crypto');
const { publicUser } = require('./auth');
const { getSessionTotpVerification, markSessionTotpVerified } = require('./totp');

const DEFAULT_TICKET_TTL_MS = 60_000;
const MAX_RETURN_TO_LENGTH = 300;
const MAX_STATE_AGE_MS = 10 * 60_000;
const AUDIENCES = new Set(['business', 'admin']);
const CANONICAL_PROXY_HOSTS = {
    business: 'business.local',
    admin: 'admin.local',
    auth: 'auth.local'
};

function base64UrlJson(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function parseBase64UrlJson(value) {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
}

function signValue(secret, value) {
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeTokenEqual(expected, actual) {
    if (typeof expected !== 'string' || typeof actual !== 'string') {
        return false;
    }
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    return expectedBuffer.length > 0
        && expectedBuffer.length === actualBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function hashHandoffToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function hashVerifier(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function createSignedAuthState(secret, payload) {
    const encoded = base64UrlJson(payload);
    return `${encoded}.${signValue(secret, encoded)}`;
}

function verifySignedAuthState(secret, state) {
    const parts = String(state || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return null;
    }
    const expected = signValue(secret, parts[0]);
    if (!safeTokenEqual(expected, parts[1])) {
        return null;
    }
    try {
        const payload = parseBase64UrlJson(parts[0]);
        if (!payload || !AUDIENCES.has(payload.audience)) {
            return null;
        }
        const issuedAt = Number(payload.issuedAt);
        if (!Number.isFinite(issuedAt) || issuedAt <= 0 || Date.now() - issuedAt > MAX_STATE_AGE_MS) {
            return null;
        }
        return payload;
    } catch (_) {
        return null;
    }
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

function getUrlHost(value) {
    try {
        const url = new URL(value);
        return url.host.toLowerCase();
    } catch (_) {
        return '';
    }
}

function getHeaderHost(value) {
    const first = String(value || '').split(',', 1)[0].trim();
    if (!first || /[\s/\\]/.test(first)) {
        return '';
    }
    try {
        return new URL(`http://${first}`).host.toLowerCase();
    } catch (_) {
        return '';
    }
}

function getRequestHosts(req) {
    return {
        host: getHeaderHost(req.get('host')),
        forwardedHost: getHeaderHost(req.get('x-forwarded-host'))
    };
}

function getAllowedHosts(audience, configuredTargetUrls) {
    const hosts = new Set([CANONICAL_PROXY_HOSTS[audience]]);
    const publicHost = getUrlHost(configuredTargetUrls[audience]);
    if (publicHost) {
        hosts.add(publicHost);
    }
    return hosts;
}

function isLocalLoopbackHost(host) {
    const text = String(host || '').toLowerCase();
    return text === 'localhost'
        || text.startsWith('localhost:')
        || text === '127.0.0.1'
        || text.startsWith('127.0.0.1:')
        || text === '[::1]'
        || text.startsWith('[::1]:');
}

function validateExactAllowedHost(req, audience, configuredTargetUrls, options = {}) {
    const allowedHosts = getAllowedHosts(audience, configuredTargetUrls);
    const { host, forwardedHost } = getRequestHosts(req);
    if (host && !allowedHosts.has(host) && !(options.allowLocalLoopbackHost && isLocalLoopbackHost(host))) {
        return false;
    }
    if (forwardedHost && !allowedHosts.has(forwardedHost)) {
        return false;
    }
    const proxyAudience = parseProxyAudience(req.get('x-ielts-onion-audience'));
    if (proxyAudience && proxyAudience !== audience) {
        return false;
    }
    return true;
}

function isLocalDevelopment(options = {}) {
    const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
    return nodeEnv !== 'production';
}

function getVerifierCookieName(audience) {
    return `ielts.auth_handoff.${audience}`;
}

function parseCookies(req) {
    const header = String(req.get('cookie') || '');
    const cookies = new Map();
    header.split(';').forEach((part) => {
        const index = part.indexOf('=');
        if (index <= 0) return;
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (name) {
            cookies.set(name, decodeURIComponent(value));
        }
    });
    return cookies;
}

function setVerifierCookie(res, audience, nonce, maxAgeMs, secure) {
    res.cookie(getVerifierCookieName(audience), nonce, {
        httpOnly: true,
        sameSite: 'lax',
        secure: Boolean(secure),
        maxAge: maxAgeMs,
        path: `/auth/${audience}/callback`
    });
}

function clearVerifierCookie(res, audience, secure) {
    res.clearCookie(getVerifierCookieName(audience), {
        httpOnly: true,
        sameSite: 'lax',
        secure: Boolean(secure),
        path: `/auth/${audience}/callback`
    });
}

function getVerifierHashFromRequest(req, audience) {
    const verifier = parseCookies(req).get(getVerifierCookieName(audience));
    if (!verifier || verifier.length > 256) {
        return '';
    }
    return hashVerifier(verifier);
}

function sanitizeReturnTo(value, audience = 'business') {
    let text = String(value || '').trim();
    if (!text) {
        return audience === 'admin' ? '/admin' : '/';
    }
    try {
        text = decodeURIComponent(text);
    } catch (_) {
        // Use the raw value when it is not percent-encoded.
    }
    text = text.replace(/[\u0000-\u001F\u007F]+/g, '').trim();
    if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\')) {
        return audience === 'admin' ? '/admin' : '/';
    }
    if (text.length > MAX_RETURN_TO_LENGTH) {
        text = text.slice(0, MAX_RETURN_TO_LENGTH);
    }
    if (audience === 'business' && /^\/(?:admin|api\/admin|auth)(?:\/|$)/i.test(text)) {
        return '/';
    }
    if (audience === 'admin' && !/^\/admin(?:\/|$|\?)/i.test(text)) {
        return '/admin';
    }
    return text || (audience === 'admin' ? '/admin' : '/');
}

function appendQuery(url, params) {
    const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!entries.length) {
        return url;
    }
    const query = new URLSearchParams(entries).toString();
    return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function parseExpectedAudience(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    return AUDIENCES.has(text) ? text : null;
}

function parseProxyAudience(value) {
    const text = String(value || '').trim().toLowerCase();
    return AUDIENCES.has(text) ? text : '';
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function destroySession(req) {
    return new Promise((resolve, reject) => {
        if (!req.session || typeof req.session.destroy !== 'function') {
            resolve();
            return;
        }
        req.session.destroy((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

class PostgresAuthHandoffStore {
    constructor(db) {
        this.db = db;
    }

    async createTicket(ticket) {
        await this.db.query(
            `INSERT INTO auth_handoff_tickets (
                token_hash, user_id, audience, return_to,
                admin_totp_verified_at, expires_at, verifier_hash
            )
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                ticket.tokenHash,
                ticket.userId,
                ticket.audience,
                ticket.returnTo,
                ticket.adminTotpVerifiedAt || null,
                ticket.expiresAt,
                ticket.verifierHash
            ]
        );
    }

    async consumeTicket(tokenHash, audience, verifierHash) {
        const result = await this.db.query(
            `UPDATE auth_handoff_tickets
             SET used_at = now()
             WHERE token_hash = $1
               AND audience = $2
               AND verifier_hash = $3
               AND used_at IS NULL
               AND expires_at > now()
             RETURNING token_hash, user_id, audience, return_to,
                       admin_totp_verified_at, expires_at, verifier_hash, used_at, created_at`,
            [tokenHash, audience, verifierHash]
        );
        return result.rows[0] || null;
    }
}

class MemoryAuthHandoffStore {
    constructor() {
        this.tickets = new Map();
    }

    async createTicket(ticket) {
        this.tickets.set(ticket.tokenHash, {
            ...ticket,
            createdAt: new Date().toISOString(),
            usedAt: null
        });
    }

    async consumeTicket(tokenHash, audience, verifierHash) {
        const ticket = this.tickets.get(tokenHash);
        if (!ticket || ticket.audience !== audience || ticket.verifierHash !== verifierHash || ticket.usedAt) {
            return null;
        }
        if (new Date(ticket.expiresAt).getTime() <= Date.now()) {
            return null;
        }
        ticket.usedAt = new Date().toISOString();
        return {
            token_hash: tokenHash,
            user_id: ticket.userId,
            audience: ticket.audience,
            return_to: ticket.returnTo,
            admin_totp_verified_at: ticket.adminTotpVerifiedAt || null,
            expires_at: ticket.expiresAt,
            verifier_hash: ticket.verifierHash,
            used_at: ticket.usedAt,
            created_at: ticket.createdAt
        };
    }
}

function createAuthHandoffRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const stateSecret = options.stateSecret;
    const authStore = options.authStore;
    const totpStore = options.totpStore;
    const ticketStore = options.ticketStore;
    const ticketTtlMs = Number.isInteger(options.ticketTtlMs) && options.ticketTtlMs > 0
        ? options.ticketTtlMs
        : DEFAULT_TICKET_TTL_MS;
    const authPublicUrl = normalizePublicBaseUrl(options.authPublicUrl || process.env.AUTH_PUBLIC_URL || '');
    const configuredTargetUrls = {
        business: normalizePublicBaseUrl(options.businessPublicUrl || process.env.BUSINESS_PUBLIC_URL || ''),
        admin: normalizePublicBaseUrl(options.adminPublicUrl || process.env.ADMIN_PUBLIC_URL || '')
    };
    const localDevelopment = isLocalDevelopment(options);
    const totpVerificationMaxAgeMs = options.totpVerificationMaxAgeMs;
    const verifierCookieSecure = Boolean(options.cookieSecure);
    const sessionCookieName = options.sessionCookieName || 'ielts.sid';
    const clearSessionCookieOptions = options.clearSessionCookieOptions || {};
    const sessionVerifierCookieName = options.sessionVerifierCookieName || '';
    const clearSessionVerifierCookieOptions = options.clearSessionVerifierCookieOptions || clearSessionCookieOptions;

    function clearLocalSessionCookies(res) {
        res.clearCookie(sessionCookieName, clearSessionCookieOptions);
        if (sessionVerifierCookieName) {
            res.clearCookie(sessionVerifierCookieName, clearSessionVerifierCookieOptions);
        }
    }

    function requireConfig(res) {
        if (!stateSecret || !authStore || !ticketStore) {
            res.status(500).type('text/plain').send('Auth handoff is not configured');
            return false;
        }
        if (!localDevelopment && (!authPublicUrl || !configuredTargetUrls.business || !configuredTargetUrls.admin)) {
            res.status(500).type('text/plain').send('Auth handoff public URLs are not configured');
            return false;
        }
        return true;
    }

    function rejectInvalidHost(res) {
        res.status(400).type('text/plain').send('Invalid auth handoff host');
    }

    function createStartHandler(audience) {
        return (req, res) => {
            if (!requireConfig(res)) {
                return;
            }
            if ((configuredTargetUrls[audience] || !localDevelopment) && !validateExactAllowedHost(req, audience, configuredTargetUrls, {
                allowLocalLoopbackHost: localDevelopment
            })) {
                return rejectInvalidHost(res);
            }
            const returnTo = sanitizeReturnTo(req.query.return_to, audience);
            const targetBaseUrl = configuredTargetUrls[audience];
            const callbackPath = `/auth/${audience}/callback`;
            const verifier = crypto.randomBytes(32).toString('base64url');
            const verifierHash = hashVerifier(verifier);
            setVerifierCookie(res, audience, verifier, MAX_STATE_AGE_MS, verifierCookieSecure);
            const state = createSignedAuthState(stateSecret, {
                audience,
                returnTo,
                targetBaseUrl,
                callbackPath,
                issuedAt: Date.now(),
                nonce: crypto.randomBytes(16).toString('base64url'),
                verifierHash
            });
            const loginPath = appendQuery(`${authPublicUrl}/auth/${audience}/login`, { state });
            return res.redirect(loginPath);
        };
    }

    router.get('/business/start', createStartHandler('business'));
    router.get('/admin/start', createStartHandler('admin'));

    function createLogoutHandler(audience) {
        return async (req, res, next) => {
            try {
                if (!requireConfig(res)) {
                    return;
                }
                const stateParam = String(req.query.state || '').trim();
                if (stateParam) {
                    if (!localDevelopment && !validateExactAllowedHost(req, 'auth', { auth: authPublicUrl })) {
                        return rejectInvalidHost(res);
                    }
                    const state = verifySignedAuthState(stateSecret, stateParam);
                    if (!state || state.intent !== 'logout' || state.audience !== audience) {
                        return res.status(400).type('text/plain').send('Invalid auth logout state');
                    }
                    await destroySession(req);
                    clearLocalSessionCookies(res);
                    const targetBaseUrl = normalizePublicBaseUrl(state.targetBaseUrl) || configuredTargetUrls[audience] || '';
                    return res.redirect(`${targetBaseUrl}${sanitizeReturnTo(state.returnTo, audience)}`);
                }

                if ((configuredTargetUrls[audience] || !localDevelopment) && !validateExactAllowedHost(req, audience, configuredTargetUrls, {
                    allowLocalLoopbackHost: localDevelopment
                })) {
                    return rejectInvalidHost(res);
                }
                const returnTo = sanitizeReturnTo(req.query.return_to, audience);
                await destroySession(req);
                clearLocalSessionCookies(res);
                const state = createSignedAuthState(stateSecret, {
                    audience,
                    intent: 'logout',
                    returnTo,
                    targetBaseUrl: configuredTargetUrls[audience],
                    issuedAt: Date.now(),
                    nonce: crypto.randomBytes(16).toString('base64url')
                });
                return res.redirect(appendQuery(`${authPublicUrl}/auth/${audience}/logout`, { state }));
            } catch (error) {
                return next(error);
            }
        };
    }

    router.get('/business/logout', createLogoutHandler('business'));
    router.get('/admin/logout', createLogoutHandler('admin'));

    router.get('/complete', async (req, res, next) => {
        try {
            const wantsJson = req.query.format === 'json';
            if (!requireConfig(res)) {
                return;
            }
            if (!localDevelopment && !validateExactAllowedHost(req, 'auth', { auth: authPublicUrl })) {
                return rejectInvalidHost(res);
            }
            const state = verifySignedAuthState(stateSecret, req.query.state);
            if (!state) {
                if (wantsJson) {
                    return res.status(400).json({ error: 'Invalid auth handoff state' });
                }
                return res.status(400).type('text/plain').send('Invalid auth handoff state');
            }
            const expectedAudience = parseExpectedAudience(req.query.audience);
            if (expectedAudience === null || (expectedAudience && expectedAudience !== state.audience)) {
                if (wantsJson) {
                    return res.status(400).json({ error: 'Auth handoff audience mismatch' });
                }
                return res.status(400).type('text/plain').send('Auth handoff audience mismatch');
            }
            if (!req.session || !req.session.user) {
                const loginUrl = appendQuery(`/auth/${state.audience}/login`, { state: req.query.state });
                if (wantsJson) {
                    return res.status(401).json({ error: 'Authentication required', loginUrl });
                }
                return res.redirect(loginUrl);
            }
            const user = publicUser(req.session.user);
            if (!user?.id) {
                if (wantsJson) {
                    return res.status(401).json({ error: 'Authentication required' });
                }
                return res.status(401).type('text/plain').send('Authentication required');
            }
            if (state.audience === 'business' && user.role === 'admin') {
                if (wantsJson) {
                    return res.status(403).json({ error: 'Business account required' });
                }
                return res.status(403).type('text/plain').send('Business account required');
            }
            let adminTotpVerifiedAt = null;
            if (state.audience === 'admin') {
                if (user.role !== 'admin') {
                    if (wantsJson) {
                        return res.status(403).json({ error: 'Admin access required' });
                    }
                    return res.status(403).type('text/plain').send('Admin access required');
                }
                const status = totpStore && typeof totpStore.getStatus === 'function'
                    ? await totpStore.getStatus(user.id)
                    : { enabled: false };
                const totpVerification = getSessionTotpVerification(req, user, totpVerificationMaxAgeMs);
                if (!status.enabled || !totpVerification) {
                    if (wantsJson) {
                        return res.status(403).json({ error: 'Admin TOTP verification required' });
                    }
                    return res.status(403).type('text/plain').send('Admin TOTP verification required');
                }
                adminTotpVerifiedAt = new Date(totpVerification.verifiedAt).toISOString();
            }
            const token = crypto.randomBytes(32).toString('base64url');
            await ticketStore.createTicket({
                tokenHash: hashHandoffToken(token),
                userId: user.id,
                audience: state.audience,
                returnTo: sanitizeReturnTo(state.returnTo, state.audience),
                adminTotpVerifiedAt,
                expiresAt: new Date(Date.now() + ticketTtlMs).toISOString(),
                verifierHash: String(state.verifierHash || '')
            });
            const targetBaseUrl = normalizePublicBaseUrl(state.targetBaseUrl);
            const callbackPath = typeof state.callbackPath === 'string' && state.callbackPath.startsWith('/auth/')
                ? state.callbackPath
                : `/auth/${state.audience}/callback`;
            const redirectTo = appendQuery(`${targetBaseUrl}${callbackPath}`, { ticket: token });
            if (wantsJson) {
                return res.json({ redirectTo });
            }
            return res.redirect(redirectTo);
        } catch (error) {
            return next(error);
        }
    });

    function createCallbackHandler(audience) {
        return async (req, res, next) => {
            try {
                if (!requireConfig(res)) {
                    return;
                }
                const token = String(req.query.ticket || '');
                if (!token) {
                    return res.status(400).type('text/plain').send('Missing auth ticket');
                }
                const proxyAudience = parseProxyAudience(req.get('x-ielts-onion-audience'));
                const configuredTargetUrl = configuredTargetUrls[audience];
                if (proxyAudience && proxyAudience !== audience && configuredTargetUrl) {
                    const callbackUrl = appendQuery(`${configuredTargetUrl}/auth/${audience}/callback`, { ticket: token });
                    return res.redirect(callbackUrl);
                }
                const verifierHash = getVerifierHashFromRequest(req, audience);
                if (!verifierHash) {
                    return res.status(403).type('text/plain').send('Auth ticket is invalid or expired');
                }
                const ticket = await ticketStore.consumeTicket(hashHandoffToken(token), audience, verifierHash);
                if (!ticket) {
                    return res.status(403).type('text/plain').send('Auth ticket is invalid or expired');
                }
                clearVerifierCookie(res, audience, verifierCookieSecure);
                const user = await authStore.findById(ticket.user_id);
                if (!user) {
                    return res.status(401).type('text/plain').send('Authentication required');
                }
                const safeUser = publicUser(user);
                if (audience === 'business' && safeUser.role === 'admin') {
                    return res.status(403).type('text/plain').send('Business account required');
                }
                if (audience === 'admin' && safeUser.role !== 'admin') {
                    return res.status(403).type('text/plain').send('Admin access required');
                }
                await regenerateSession(req);
                req.session.user = safeUser;
                if (audience === 'admin' && ticket.admin_totp_verified_at) {
                    markSessionTotpVerified(req, safeUser, Date.parse(ticket.admin_totp_verified_at));
                }
                return res.redirect(sanitizeReturnTo(ticket.return_to, audience));
            } catch (error) {
                return next(error);
            }
        };
    }

    router.get('/business/callback', createCallbackHandler('business'));
    router.get('/admin/callback', createCallbackHandler('admin'));

    return router;
}

module.exports = {
    DEFAULT_TICKET_TTL_MS,
    MemoryAuthHandoffStore,
    PostgresAuthHandoffStore,
    createAuthHandoffRouter,
    createSignedAuthState,
    hashHandoffToken,
    sanitizeReturnTo,
    verifySignedAuthState
};
