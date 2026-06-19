const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/;

const credentialsSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(1).max(128)
});

const updateUsernameSchema = z.object({
    username: z.string().trim().min(3).max(32).regex(USERNAME_PATTERN),
    password: z.string().min(1).max(128)
});

const updatePasswordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(1).max(128)
});

const deleteAccountSchema = z.object({
    password: z.string().min(1).max(128),
    confirm: z.string().trim().min(1).max(64)
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

function parseBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
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

    async findById(userId) {
        const result = await this.db.query(
            'SELECT id, username, username_lower, password_hash, role FROM users WHERE id = $1',
            [userId]
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

    async updateUsername(userId, { username, usernameLower }) {
        const result = await this.db.query(
            `UPDATE users
             SET username = $2, username_lower = $3
             WHERE id = $1
             RETURNING id, username, username_lower, password_hash, role`,
            [userId, username, usernameLower]
        );
        return result.rows[0] || null;
    }

    async updatePassword(userId, passwordHash) {
        const result = await this.db.query(
            `UPDATE users
             SET password_hash = $2
             WHERE id = $1
             RETURNING id, username, username_lower, password_hash, role`,
            [userId, passwordHash]
        );
        return result.rows[0] || null;
    }

    async countAdmins() {
        const result = await this.db.query('SELECT count(*)::int AS total FROM users WHERE role = $1', ['admin']);
        return result.rows[0]?.total || 0;
    }

    async deleteSessionsForUser(userId, exceptSid = null) {
        const params = [userId];
        let exceptClause = '';
        if (exceptSid) {
            params.push(exceptSid);
            exceptClause = ` AND sid <> $${params.length}`;
        }
        await this.db.query(
            `DELETE FROM "session"
             WHERE (sess->'user'->>'id' = $1
                OR sess->'pendingTotpLogin'->'user'->>'id' = $1
                OR sess->'pendingTotpSetup'->'user'->>'id' = $1)
                ${exceptClause}`,
            params
        );
    }

    async deleteUser(userId) {
        const result = await this.db.query(
            'DELETE FROM users WHERE id = $1 RETURNING id, username, username_lower, password_hash, role',
            [userId]
        );
        return result.rows[0] || null;
    }
}

class MemoryAuthStore {
    constructor(options = {}) {
        this.users = new Map();
        this.sessionStore = options.sessionStore || null;
    }

    async findByUsernameLower(usernameLower) {
        return this.users.get(usernameLower) || null;
    }

    async findById(userId) {
        return Array.from(this.users.values()).find((user) => user.id === userId) || null;
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

    async updateUsername(userId, { username, usernameLower }) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        const currentKey = String(existing.username_lower || existing.username || '').toLowerCase();
        const nextOwner = this.users.get(usernameLower);
        if (nextOwner && nextOwner.id !== userId) {
            const error = new Error('duplicate user');
            error.code = '23505';
            throw error;
        }
        this.users.delete(currentKey);
        existing.username = username;
        existing.username_lower = usernameLower;
        this.users.set(usernameLower, existing);
        return existing;
    }

    async updatePassword(userId, passwordHash) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        existing.password_hash = passwordHash;
        return existing;
    }

    async countAdmins() {
        return Array.from(this.users.values()).filter((user) => user.role === 'admin').length;
    }

    async deleteSessionsForUser(userId, exceptSid = null) {
        const store = this.sessionStore;
        if (!store) return;

        const shouldDestroy = (value) => {
            return value?.user?.id === userId
                || value?.pendingTotpLogin?.user?.id === userId
                || value?.pendingTotpSetup?.user?.id === userId;
        };

        const parseSession = (raw) => {
            if (!raw) return null;
            if (typeof raw === 'string') {
                try {
                    return JSON.parse(raw);
                } catch (_) {
                    return null;
                }
            }
            return raw;
        };

        const destroy = (sid) => new Promise((resolve) => {
            store.destroy(sid, () => resolve());
        });

        if (store.sessions && typeof store.sessions === 'object') {
            const sids = Object.entries(store.sessions)
                .filter(([sid, raw]) => sid !== exceptSid && shouldDestroy(parseSession(raw)))
                .map(([sid]) => sid);
            await Promise.all(sids.map(destroy));
            return;
        }

        if (typeof store.all === 'function') {
            await new Promise((resolve) => {
                store.all(async (error, sessions) => {
                    if (!error && sessions) {
                        const entries = Object.entries(sessions);
                        const sids = entries
                            .filter(([sid, value]) => sid !== exceptSid && shouldDestroy(parseSession(value)))
                            .map(([sid]) => sid);
                        await Promise.all(sids.map(destroy));
                    }
                    resolve();
                });
            });
        }
    }

    async deleteUser(userId) {
        const existing = await this.findById(userId);
        if (!existing) return null;
        this.users.delete(String(existing.username_lower || existing.username || '').toLowerCase());
        return existing;
    }
}

function sendValidationError(res, parsed, fallbackMessage) {
    return res.status(400).json({
        error: fallbackMessage,
        details: parsed.error.flatten()
    });
}

async function getCurrentStoredUser(store, sessionUser) {
    if (!sessionUser || !sessionUser.id || typeof store.findById !== 'function') {
        return null;
    }
    return store.findById(sessionUser.id);
}

function createAuthRouter(options = {}) {
    const express = require('express');
    const router = express.Router();
    const store = options.store || new PostgresAuthStore(options.db);
    const checkRateLimit = options.checkRateLimit || createRateLimiter(options.rateLimit);
    const bcryptImpl = options.bcrypt || bcrypt;
    const totpStore = options.totpStore || null;
    const onDeleteUser = typeof options.onDeleteUser === 'function'
        ? options.onDeleteUser
        : async () => {};
    const totpEnabled = options.totpEnabled !== undefined
        ? Boolean(options.totpEnabled)
        : parseBoolean(process.env.TOTP_ENABLED, true);

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

            const safeUser = publicUser(user);
            if (totpEnabled && totpStore && typeof totpStore.getStatus === 'function') {
                const status = await totpStore.getStatus(user.id);
                if (status.enabled) {
                    await regenerateSession(req);
                    req.session.pendingTotpLogin = { user: safeUser };
                    return res.json({
                        requiresTotp: true,
                        csrfToken: ensureCsrfToken(req)
                    });
                }
                if (safeUser.role === 'admin') {
                    await regenerateSession(req);
                    req.session.pendingTotpSetup = {
                        user: safeUser,
                        forced: true,
                        startedAt: Date.now()
                    };
                    return res.json({
                        requiresTotpSetup: true,
                        user: safeUser,
                        csrfToken: ensureCsrfToken(req)
                    });
                }
            }

            await regenerateSession(req);
            req.session.user = safeUser;
            const csrfToken = ensureCsrfToken(req);
            return res.json({ user: safeUser, csrfToken });
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

    router.patch('/account/username', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = updateUsernameSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid account update payload');
            }
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.password, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const username = normalizeUsername(parsed.data.username);
            const usernameLower = username.toLowerCase();
            if (usernameLower === String(currentUser.username_lower || '').toLowerCase()) {
                req.session.user = publicUser(currentUser);
                return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
            }

            let updatedUser;
            try {
                updatedUser = await store.updateUsername(currentUser.id, { username, usernameLower });
            } catch (error) {
                if (error && error.code === '23505') {
                    return res.status(409).json({ error: 'Username already exists' });
                }
                throw error;
            }
            if (!updatedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id, req.sessionID);
            }
            req.session.user = publicUser(updatedUser);
            return res.json({ user: req.session.user, csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.patch('/account/password', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = updatePasswordSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid password update payload');
            }
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.currentPassword, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            const passwordCheck = validatePasswordStrength(parsed.data.newPassword);
            if (!passwordCheck.valid) {
                return res.status(400).json({ error: 'Password strength is insufficient', details: passwordCheck.errors });
            }
            if (parsed.data.currentPassword === parsed.data.newPassword) {
                return res.status(400).json({ error: 'New password must be different from the current password' });
            }
            const passwordHash = await bcryptImpl.hash(parsed.data.newPassword, 12);
            const updatedUser = await store.updatePassword(currentUser.id, passwordHash);
            if (!updatedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id, req.sessionID);
            }
            req.session.user = publicUser(updatedUser);
            return res.json({ ok: true, user: req.session.user, csrfToken: ensureCsrfToken(req) });
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/account', requireAuth, verifyCsrfToken, async (req, res, next) => {
        try {
            const parsed = deleteAccountSchema.safeParse(req.body || {});
            if (!parsed.success) {
                return sendValidationError(res, parsed, 'Invalid account deletion payload');
            }
            const currentUser = await getCurrentStoredUser(store, req.session.user);
            if (!currentUser) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const passwordOk = await bcryptImpl.compare(parsed.data.password, currentUser.password_hash);
            if (!passwordOk) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            if (String(parsed.data.confirm || '').trim() !== currentUser.username) {
                return res.status(400).json({ error: 'Type your current username to confirm account deletion' });
            }
            if (publicUser(currentUser).role === 'admin'
                && typeof store.countAdmins === 'function'
                && await store.countAdmins() <= 1) {
                return res.status(409).json({ error: 'The last admin account cannot be deleted' });
            }
            if (typeof store.deleteSessionsForUser === 'function') {
                await store.deleteSessionsForUser(currentUser.id);
            }
            const deletedUser = await store.deleteUser(currentUser.id);
            if (!deletedUser) {
                return res.status(404).json({ error: 'User not found' });
            }
            await onDeleteUser(currentUser.id, deletedUser);
            await destroySession(req);
            res.clearCookie(options.cookieName || 'ielts.sid');
            return res.json({ ok: true, deleted: true });
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
