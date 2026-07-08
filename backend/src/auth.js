const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const DUMMY_PASSWORD_HASH = '$2a$12$OOrmAQgyb0OR42FfRf/D6.GOTtaUGKbmYgyZT2MoQOJMTFTxYjNG.';
const MAX_BCRYPT_PASSWORD_BYTES = 72;
const REGISTRATION_MODES = new Set(['first-user', 'open', 'disabled']);

const credentialsSchema = z.object({
    username: z.string().trim().min(1).max(80),
    password: z.string().min(1).max(128)
});

function normalizeUsername(username) {
    return String(username || '').trim();
}

function normalizeUsernameLower(username) {
    return normalizeUsername(username).toLocaleLowerCase('en-US');
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        createdAt: user.created_at || user.createdAt || null
    };
}

function isPasswordWithinBcryptByteLimit(password) {
    return typeof password === 'string'
        && Buffer.byteLength(password, 'utf8') <= MAX_BCRYPT_PASSWORD_BYTES;
}

function validatePasswordStrength(password) {
    const errors = [];
    if (typeof password !== 'string' || password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    if (typeof password === 'string' && password.length > 128) {
        errors.push('Password must not exceed 128 characters');
    }
    if (!isPasswordWithinBcryptByteLimit(password)) {
        errors.push('Password must not exceed 72 UTF-8 bytes');
    }
    if (!/[a-z]/.test(password || '')) {
        errors.push('Password must include a lowercase letter');
    }
    if (!/[A-Z]/.test(password || '')) {
        errors.push('Password must include an uppercase letter');
    }
    if (!/[0-9]/.test(password || '')) {
        errors.push('Password must include a number');
    }
    return { valid: errors.length === 0, errors };
}

function ensureCsrfToken(req) {
    if (!req.session) {
        throw Object.assign(new Error('Session unavailable'), { status: 500 });
    }
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function verifyCsrfToken(req, res, next) {
    const expected = req.session && req.session.csrfToken;
    const actual = req.get('x-csrf-token');
    const expectedBuffer = Buffer.from(String(expected || ''));
    const actualBuffer = Buffer.from(String(actual || ''));
    if (!expected
        || !actual
        || expectedBuffer.length !== actualBuffer.length
        || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        return res.status(403).json({ error: 'CSRF token invalid' });
    }
    return next();
}

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.user = publicUser(req.session.user);
    return next();
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
        req.session.destroy((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function createRateLimiter({ limit = 20, windowMs = 60_000 } = {}) {
    const hits = new Map();
    return (key) => {
        const now = Date.now();
        const windowStart = now - windowMs;
        const recent = (hits.get(key) || []).filter((value) => value > windowStart);
        recent.push(now);
        hits.set(key, recent);
        if (recent.length > limit) {
            const error = new Error('Too many attempts. Try again later.');
            error.status = 429;
            throw error;
        }
    };
}

class PostgresAuthStore {
    constructor(db) {
        this.db = db;
    }

    async countUsers() {
        const result = await this.db.query('SELECT count(*)::int AS count FROM users');
        return Number(result.rows[0]?.count || 0);
    }

    async findByUsername(usernameLower) {
        const result = await this.db.query(
            `SELECT id, username, username_lower, password_hash, created_at
             FROM users
             WHERE username_lower = $1`,
            [usernameLower]
        );
        return result.rows[0] || null;
    }

    async findById(userId) {
        const result = await this.db.query(
            `SELECT id, username, username_lower, password_hash, created_at
             FROM users
             WHERE id = $1`,
            [userId]
        );
        return result.rows[0] || null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        const result = await this.db.query(
            `INSERT INTO users (username, username_lower, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, username, username_lower, password_hash, created_at`,
            [username, usernameLower, passwordHash]
        );
        return result.rows[0];
    }
}

class MemoryAuthStore {
    constructor() {
        this.users = new Map();
    }

    async countUsers() {
        return this.users.size;
    }

    async findByUsername(usernameLower) {
        return this.users.get(usernameLower) || null;
    }

    async findById(userId) {
        for (const user of this.users.values()) {
            if (user.id === userId) return user;
        }
        return null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        if (this.users.has(usernameLower)) {
            const error = new Error('Username already exists');
            error.code = '23505';
            throw error;
        }
        const user = {
            id: crypto.randomUUID(),
            username,
            username_lower: usernameLower,
            password_hash: passwordHash,
            created_at: new Date().toISOString()
        };
        this.users.set(usernameLower, user);
        return user;
    }
}

function resolveRegistrationMode(value) {
    const mode = String(value || process.env.REGISTRATION_MODE || 'first-user').trim().toLowerCase();
    return REGISTRATION_MODES.has(mode) ? mode : 'first-user';
}

function createAuthRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAuthStore(options.db);
    const checkRateLimit = options.rateLimiter || createRateLimiter(options.rateLimit);
    const registrationMode = resolveRegistrationMode(options.registrationMode);
    const bcryptImpl = options.bcrypt || bcrypt;

    router.get('/csrf', (req, res) => {
        return res.json({ csrfToken: ensureCsrfToken(req) });
    });

    router.get('/me', (req, res) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ user: null, csrfToken: ensureCsrfToken(req) });
        }
        req.session.user = publicUser(req.session.user);
        return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
    });

    router.post('/register', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid registration payload' });
            }
            if (registrationMode === 'disabled') {
                return res.status(403).json({ error: 'Registration is disabled' });
            }
            if (registrationMode === 'first-user' && await store.countUsers() > 0) {
                return res.status(403).json({ error: 'Registration is limited to the first user' });
            }

            const username = normalizeUsername(parsed.data.username);
            const usernameLower = normalizeUsernameLower(username);
            checkRateLimit(`register:${req.ip}:${usernameLower}`);
            const passwordCheck = validatePasswordStrength(parsed.data.password);
            if (!passwordCheck.valid) {
                return res.status(400).json({
                    error: 'Password strength is insufficient',
                    details: passwordCheck.errors
                });
            }

            const passwordHash = await bcryptImpl.hash(parsed.data.password, 12);
            const user = await store.createUser({ username, usernameLower, passwordHash });
            await regenerateSession(req);
            req.session.user = publicUser(user);
            return res.status(201).json({
                user: req.session.user,
                csrfToken: ensureCsrfToken(req)
            });
        } catch (error) {
            if (error && error.code === '23505') {
                return res.status(409).json({ error: 'Username already exists' });
            }
            return next(error);
        }
    });

    router.post('/login', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: 'Invalid login payload' });
            }
            const usernameLower = normalizeUsernameLower(parsed.data.username);
            checkRateLimit(`login:${req.ip}:${usernameLower}`);

            if (!isPasswordWithinBcryptByteLimit(parsed.data.password)) {
                await bcryptImpl.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
                return res.status(401).json({ error: 'Username or password is incorrect' });
            }

            const user = await store.findByUsername(usernameLower);
            const hash = user ? user.password_hash : DUMMY_PASSWORD_HASH;
            const ok = await bcryptImpl.compare(parsed.data.password, hash);
            if (!user || !ok) {
                return res.status(401).json({ error: 'Username or password is incorrect' });
            }

            await regenerateSession(req);
            req.session.user = publicUser(user);
            return res.json({
                user: req.session.user,
                csrfToken: ensureCsrfToken(req)
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/logout', verifyCsrfToken, async (req, res, next) => {
        try {
            await destroySession(req);
            res.clearCookie(options.cookieName || 'ielts.sid', options.clearCookieOptions || {});
            return res.json({ ok: true });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

module.exports = {
    MemoryAuthStore,
    PostgresAuthStore,
    createAuthRouter,
    ensureCsrfToken,
    isPasswordWithinBcryptByteLimit,
    publicUser,
    requireAuth,
    validatePasswordStrength,
    verifyCsrfToken
};
