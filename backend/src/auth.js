const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/;

const credentialsSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(1).max(128)
});

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        role: user.role === 'admin' ? 'admin' : 'user'
    };
}

function normalizeUsername(username) {
    return String(username || '').trim();
}

function validatePasswordStrength(password) {
    const errors = [];
    if (typeof password !== 'string' || password.length < 8) {
        errors.push('密码至少需要 8 个字符');
    }
    if (typeof password === 'string' && password.length > 128) {
        errors.push('密码不能超过 128 个字符');
    }
    if (!/[a-z]/.test(password || '')) {
        errors.push('密码需要包含小写字母');
    }
    if (!/[A-Z]/.test(password || '')) {
        errors.push('密码需要包含大写字母');
    }
    if (!/[0-9]/.test(password || '')) {
        errors.push('密码需要包含数字');
    }
    return {
        valid: errors.length === 0,
        errors
    };
}

function createRateLimiter(options = {}) {
    const windowMs = options.windowMs || 10 * 60 * 1000;
    const maxAttempts = options.maxAttempts || 20;
    const attempts = new Map();

    return function checkRateLimit(key) {
        const now = Date.now();
        const entry = attempts.get(key);
        if (!entry || entry.resetAt <= now) {
            attempts.set(key, { count: 1, resetAt: now + windowMs });
            return;
        }
        entry.count += 1;
        if (entry.count > maxAttempts) {
            const error = new Error('请求过于频繁，请稍后再试');
            error.status = 429;
            throw error;
        }
    };
}

function ensureCsrfToken(req) {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
}

function verifyCsrfToken(req, res, next) {
    const expected = req.session && req.session.csrfToken;
    const actual = req.get('x-csrf-token');
    if (!expected || !actual || actual !== expected) {
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

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.user = publicUser(req.session.user);
    if (req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
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

class PostgresAuthStore {
    constructor(db) {
        this.db = db;
    }

    async findByUsernameLower(usernameLower) {
        const result = await this.db.query(
            'SELECT id, username, username_lower, password_hash, role FROM users WHERE username_lower = $1',
            [usernameLower]
        );
        return result.rows[0] || null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        const result = await this.db.query(
            `INSERT INTO users (username, username_lower, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, username, username_lower, password_hash, role`,
            [username, usernameLower, passwordHash]
        );
        return result.rows[0];
    }
}

class MemoryAuthStore {
    constructor() {
        this.users = new Map();
    }

    async findByUsernameLower(usernameLower) {
        return this.users.get(usernameLower) || null;
    }

    async createUser({ username, usernameLower, passwordHash }) {
        if (this.users.has(usernameLower)) {
            const error = new Error('duplicate user');
            error.code = '23505';
            throw error;
        }
        const user = {
            id: crypto.randomUUID(),
            username,
            username_lower: usernameLower,
            password_hash: passwordHash,
            role: 'user'
        };
        this.users.set(usernameLower, user);
        return user;
    }
}

function createAuthRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAuthStore(options.db);
    const checkRateLimit = options.checkRateLimit || createRateLimiter(options.rateLimit);
    const bcryptImpl = options.bcrypt || bcrypt;

    router.get('/csrf', (req, res) => {
        res.json({ csrfToken: ensureCsrfToken(req) });
    });

    router.get('/me', (req, res) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        return res.json({ user: publicUser(req.session.user), csrfToken: ensureCsrfToken(req) });
    });

    router.post('/register', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: '用户名或密码格式无效' });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            checkRateLimit(`register:${req.ip}:${usernameLower}`);

            const passwordCheck = validatePasswordStrength(parsed.data.password);
            if (!passwordCheck.valid) {
                return res.status(400).json({ error: '密码强度不足', details: passwordCheck.errors });
            }

            const passwordHash = await bcryptImpl.hash(parsed.data.password, 12);
            let user;
            try {
                user = await store.createUser({ username, usernameLower, passwordHash });
            } catch (error) {
                if (error && error.code === '23505') {
                    return res.status(409).json({ error: '用户名已存在' });
                }
                throw error;
            }

            await regenerateSession(req);
            req.session.user = publicUser(user);
            const csrfToken = ensureCsrfToken(req);
            return res.status(201).json({ user: publicUser(user), csrfToken });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/login', verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = credentialsSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return res.status(400).json({ error: '用户名或密码格式无效' });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            checkRateLimit(`login:${req.ip}:${usernameLower}`);

            const user = await store.findByUsernameLower(usernameLower);
            if (!user) {
                return res.status(401).json({ error: '用户名或密码错误' });
            }
            const ok = await bcryptImpl.compare(parsed.data.password, user.password_hash);
            if (!ok) {
                return res.status(401).json({ error: '用户名或密码错误' });
            }

            await regenerateSession(req);
            req.session.user = publicUser(user);
            const csrfToken = ensureCsrfToken(req);
            return res.json({ user: publicUser(user), csrfToken });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/logout', verifyCsrfToken, async (req, res, next) => {
        try {
            await destroySession(req);
            res.clearCookie(options.cookieName || 'ielts.sid');
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
    USERNAME_PATTERN,
    createAuthRouter,
    createRateLimiter,
    ensureCsrfToken,
    normalizeUsername,
    publicUser,
    requireAdmin,
    requireAuth,
    validatePasswordStrength,
    verifyCsrfToken
};
