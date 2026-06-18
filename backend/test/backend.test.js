const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const otp = require('otplib');
const session = require('express-session');

const { createApp } = require('../src/app');
const { MemoryAuthStore } = require('../src/auth');
const { MemoryAdminStore } = require('../src/admin');
const { bootstrapAdmin } = require('../src/bootstrapAdmin');
const { MemoryPracticeRecordStore } = require('../src/practiceRecords');
const { MemoryTotpStore } = require('../src/totp');

async function createClient(options = {}) {
    const authStore = new MemoryAuthStore();
    const totpStore = new MemoryTotpStore();
    const practiceStore = new MemoryPracticeRecordStore();
    const app = createApp({
        authStore,
        totpStore,
        practiceStore,
        adminStore: new MemoryAdminStore({ authStore, practiceStore }),
        sessionStore: new session.MemoryStore(),
        sessionSecret: 'test-session-secret',
        staticRoot: options.staticRoot,
        rateLimit: options.rateLimit || { maxAttempts: 100, windowMs: 60_000 },
        totpRateLimit: options.totpRateLimit,
        totpEnabled: options.totpEnabled,
        totpEncryptionKey: options.totpEncryptionKey || 'test-totp-key',
        totpRecoveryHashRounds: 4
    });
    const server = await new Promise((resolve, reject) => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
        listener.once('error', reject);
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    let cookie = '';
    let csrfToken = '';

    async function request(method, path, body, options = {}) {
        const headers = {
            ...(options.headers || {})
        };
        if (cookie) {
            headers.cookie = cookie;
        }
        if (options.csrf !== false && csrfToken && method !== 'GET') {
            headers['x-csrf-token'] = csrfToken;
        }
        if (body !== undefined) {
            headers['content-type'] = 'application/json';
        }
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            cookie = setCookie.split(';')[0];
        }
        const text = await response.text();
        let json = null;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch (_) {
                json = null;
            }
        }
        if (json && json.csrfToken) {
            csrfToken = json.csrfToken;
        }
        return { response, json, text };
    }

    return {
        get csrfToken() {
            return csrfToken;
        },
        authStore,
        totpStore,
        practiceStore,
        request,
        async csrf() {
            return request('GET', '/api/auth/csrf');
        },
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
    };
}

async function register(client, username = 'alice', password = 'StrongPass1') {
    await client.csrf();
    return client.request('POST', '/api/auth/register', { username, password });
}

async function seedAdmin(client, username = 'admin_user', password = 'StrongPass1') {
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await client.authStore.createUser({
        username,
        usernameLower: username.toLowerCase(),
        passwordHash
    });
    user.role = 'admin';
    return user;
}

function generateTotpToken(secret) {
    return otp.generateSync({ secret });
}

async function enableTotpForCurrentSession(client) {
    const setup = await client.request('POST', '/api/auth/totp/setup', {});
    assert.equal(setup.response.status, 200);
    assert(setup.json.secret);
    assert.match(setup.json.otpauthUrl, /^otpauth:\/\/totp\//);

    const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
        token: generateTotpToken(setup.json.secret)
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.json.status.enabled, true);
    assert.equal(verified.json.recoveryCodes.length, 10);
    return {
        secret: setup.json.secret,
        recoveryCodes: verified.json.recoveryCodes,
        user: verified.json.user
    };
}

test('auth registration rejects weak and duplicate credentials', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const weak = await client.request('POST', '/api/auth/register', {
            username: 'weak_user',
            password: 'weak'
        });
        assert.equal(weak.response.status, 400);

        const created = await client.request('POST', '/api/auth/register', {
            username: 'alice',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);
        assert.equal(created.json.user.username, 'alice');

        const duplicate = await client.request('POST', '/api/auth/register', {
            username: 'Alice',
            password: 'StrongPass1'
        });
        assert.equal(duplicate.response.status, 409);
    } finally {
        await client.close();
    }
});

test('auth write endpoints require a valid CSRF token', async () => {
    const client = await createClient();
    try {
        const missing = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        });
        assert.equal(missing.response.status, 403);

        await client.csrf();
        const invalid = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        }, {
            csrf: false,
            headers: {
                'x-csrf-token': 'invalid-token'
            }
        });
        assert.equal(invalid.response.status, 403);

        const valid = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        });
        assert.equal(valid.response.status, 201);
    } finally {
        await client.close();
    }
});

test('login, logout, and authenticated practice API access', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'login_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const loggedInRecords = await client.request('GET', '/api/practice-records');
        assert.equal(loggedInRecords.response.status, 200);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const wrong = await client.request('POST', '/api/auth/login', {
            username: 'login_user',
            password: 'WrongPass1'
        });
        assert.equal(wrong.response.status, 401);

        const login = await client.request('POST', '/api/auth/login', {
            username: 'login_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'login_user');

        const logoutAgain = await client.request('POST', '/api/auth/logout');
        assert.equal(logoutAgain.response.status, 200);

        const meAfterLogout = await client.request('GET', '/api/auth/me');
        assert.equal(meAfterLogout.response.status, 401);

        const afterLogout = await client.request('GET', '/api/practice-records');
        assert.equal(afterLogout.response.status, 401);
    } finally {
        await client.close();
    }
});

test('auth login rate limit returns 429 after repeated attempts', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const created = await register(client, 'limited_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const firstFailure = await client.request('POST', '/api/auth/login', {
            username: 'limited_user',
            password: 'WrongPass1'
        });
        assert.equal(firstFailure.response.status, 401);

        const limited = await client.request('POST', '/api/auth/login', {
            username: 'limited_user',
            password: 'WrongPass1'
        });
        assert.equal(limited.response.status, 429);
    } finally {
        await client.close();
    }
});

test('TOTP setup requires auth, CSRF, and returns recovery codes once', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const anonymous = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(anonymous.response.status, 401);

        const created = await register(client, 'totp_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const missingCsrf = await client.request('POST', '/api/auth/totp/setup', {}, { csrf: false });
        assert.equal(missingCsrf.response.status, 403);

        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);
        assert(setup.json.secret);
        assert.match(setup.json.qrCodeDataUrl, /^data:image\/png;base64,/);

        const bad = await client.request('POST', '/api/auth/totp/verify-setup', { token: '000000' });
        assert.equal(bad.response.status, 401);

        const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(verified.response.status, 200);
        assert.equal(verified.json.status.enabled, true);
        assert.equal(verified.json.status.recoveryCodesRemaining, 10);
        assert.equal(verified.json.recoveryCodes.length, 10);

        const status = await client.request('GET', '/api/auth/totp/status');
        assert.equal(status.response.status, 200);
        assert.equal(status.json.status.enabled, true);
        assert.equal(status.json.status.recoveryCodesRemaining, 10);
    } finally {
        await client.close();
    }
});

test('TOTP login requires a second factor before full session access', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_login', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_login',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);
        assert.equal(passwordOnly.json.user, undefined);

        const blocked = await client.request('GET', '/api/practice-records');
        assert.equal(blocked.response.status, 401);

        const bad = await client.request('POST', '/api/auth/totp/login', { token: '000000' });
        assert.equal(bad.response.status, 401);

        const login = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'totp_login');

        const records = await client.request('GET', '/api/practice-records');
        assert.equal(records.response.status, 200);
    } finally {
        await client.close();
    }
});

test('TOTP recovery codes are one-time and can be regenerated', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_recovery', 'StrongPass1');
        const { recoveryCodes } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.json.requiresTotp, true);

        const recoveryLogin = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[0]
        });
        assert.equal(recoveryLogin.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        const reused = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[0]
        });
        assert.equal(reused.response.status, 401);

        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery',
            password: 'StrongPass1'
        });
        const login = await client.request('POST', '/api/auth/totp/login', {
            token: recoveryCodes[1]
        });
        assert.equal(login.response.status, 200);

        const regenerated = await client.request('POST', '/api/auth/totp/recovery-codes');
        assert.equal(regenerated.response.status, 200);
        assert.equal(regenerated.json.recoveryCodes.length, 10);
        assert.equal(regenerated.json.status.recoveryCodesRemaining, 10);
    } finally {
        await client.close();
    }
});

test('ordinary users can disable TOTP with password and current code', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_disable', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);

        const wrongPassword = await client.request('POST', '/api/auth/totp/disable', {
            password: 'WrongPass1',
            token: generateTotpToken(secret)
        });
        assert.equal(wrongPassword.response.status, 401);

        const disabled = await client.request('POST', '/api/auth/totp/disable', {
            password: 'StrongPass1',
            token: generateTotpToken(secret)
        });
        assert.equal(disabled.response.status, 200);
        assert.equal(disabled.json.status.enabled, false);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'totp_disable',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'totp_disable');
    } finally {
        await client.close();
    }
});

test('removed passkey API returns 404', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const response = await client.request('POST', '/api/auth/passkeys/login/options', {});
        assert.equal(response.response.status, 404);
    } finally {
        await client.close();
    }
});

test('practice API requires authentication', async () => {
    const client = await createClient();
    try {
        const response = await client.request('GET', '/api/practice-records');
        assert.equal(response.response.status, 401);
    } finally {
        await client.close();
    }
});

test('practice import deduplicates by id and non-empty sessionId', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'import_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const imported = await client.request('POST', '/api/practice-records/import', {
            records: [
                { id: 'record-a', sessionId: 'session-1', type: 'reading', score: 70, date: '2026-01-01T00:00:00.000Z' },
                { id: 'record-a', sessionId: 'session-1', type: 'reading', score: 80, date: '2026-01-02T00:00:00.000Z' },
                { id: 'record-b', sessionId: 'session-1', type: 'reading', score: 90, date: '2026-01-03T00:00:00.000Z' },
                { id: 'record-c', sessionId: 'session-2', type: 'listening', score: 60, date: '2026-01-04T00:00:00.000Z' }
            ]
        });
        assert.equal(imported.response.status, 201);
        assert.equal(imported.json.records.length, 2);
        assert.deepEqual(
            imported.json.records.map((record) => record.sessionId).sort(),
            ['session-1', 'session-2']
        );

        const listed = await client.request('GET', '/api/practice-records');
        assert.equal(listed.json.records.length, 2);
    } finally {
        await client.close();
    }
});

test('PUT practice records replaces the list returned by GET', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'replace_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const records = [
            { id: 'first', sessionId: 's-first', type: 'reading', score: 55, date: '2026-02-01T00:00:00.000Z' },
            { id: 'second', sessionId: 's-second', type: 'listening', score: 75, date: '2026-02-02T00:00:00.000Z' }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);
        assert.deepEqual(replaced.json.records, records);

        const listed = await client.request('GET', '/api/practice-records');
        assert.deepEqual(listed.json.records, records);
    } finally {
        await client.close();
    }
});

test('admin API rejects anonymous and non-admin users', async () => {
    const client = await createClient();
    try {
        const anonymous = await client.request('GET', '/api/admin/summary');
        assert.equal(anonymous.response.status, 401);

        const created = await register(client, 'ordinary_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        assert.equal(created.json.user.role, 'user');

        const forbidden = await client.request('GET', '/api/admin/summary');
        assert.equal(forbidden.response.status, 403);

        const adminPage = await client.request('GET', '/admin');
        assert.equal(adminPage.response.status, 403);
    } finally {
        await client.close();
    }
});

test('admin can list users, inspect records, and delete one record', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'admin_user', 'StrongPass1');
        const created = await register(client, 'managed_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const managedUserId = created.json.user.id;

        const records = [
            { id: 'managed-record', sessionId: 'managed-session', type: 'reading', title: 'Managed Reading', score: 82 }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'admin_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);

        const adminRecordsBeforeTotp = await client.request('GET', '/api/admin/summary');
        assert.equal(adminRecordsBeforeTotp.response.status, 401);

        const enabledAdminTotp = await enableTotpForCurrentSession(client);
        assert.equal(enabledAdminTotp.user.role, 'admin');

        const adminPage = await client.request('GET', '/admin');
        assert.equal(adminPage.response.status, 200);

        const summary = await client.request('GET', '/api/admin/summary');
        assert.equal(summary.response.status, 200);
        assert.equal(summary.json.userCount, 2);
        assert.equal(summary.json.adminCount, 1);
        assert.equal(summary.json.practiceRecordCount, 1);

        const users = await client.request('GET', '/api/admin/users?q=managed');
        assert.equal(users.response.status, 200);
        assert.equal(users.json.users.length, 1);
        assert.equal(users.json.users[0].id, managedUserId);

        const pagedUsers = await client.request('GET', '/api/admin/users?limit=1&offset=1');
        assert.equal(pagedUsers.response.status, 200);
        assert.equal(pagedUsers.json.limit, 1);
        assert.equal(pagedUsers.json.offset, 1);

        const listed = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(listed.response.status, 200);
        assert.equal(listed.json.records[0].id, 'managed-record');

        const blockedDelete = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`, undefined, {
            csrf: false
        });
        assert.equal(blockedDelete.response.status, 403);

        const removed = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`);
        assert.equal(removed.response.status, 200);
        assert.equal(removed.json.removed, 1);

        const afterDelete = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(afterDelete.json.records.length, 0);
    } finally {
        await client.close();
    }
});

test('admin can manage users and inspect learning and traffic stats', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'admin_user', 'StrongPass1');
        const created = await register(client, 'stats_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const managedUserId = created.json.user.id;

        const recentRecordAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const latestRecordAt = new Date().toISOString();
        const records = [
            {
                id: 'stats-record-1',
                sessionId: 'stats-session-1',
                type: 'reading',
                title: 'Stats Reading',
                score: 80,
                duration: 12,
                correctAnswers: 8,
                totalQuestions: 10,
                updatedAt: recentRecordAt
            },
            {
                id: 'stats-record-2',
                sessionId: 'stats-session-2',
                type: 'listening',
                title: 'Stats Listening',
                score: 60,
                duration: 8,
                correctAnswers: 6,
                totalQuestions: 10,
                updatedAt: latestRecordAt
            }
        ];
        const replaced = await client.request('PUT', '/api/practice-records', { records });
        assert.equal(replaced.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'admin_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(client);

        const weak = await client.request('POST', '/api/admin/users', {
            username: 'weak_created',
            password: 'weak',
            role: 'user'
        });
        assert.equal(weak.response.status, 400);

        const added = await client.request('POST', '/api/admin/users', {
            username: 'created_user',
            password: 'StrongPass1',
            role: 'user'
        });
        assert.equal(added.response.status, 201);
        assert.equal(added.json.user.role, 'user');

        const patched = await client.request('PATCH', `/api/admin/users/${added.json.user.id}`, {
            role: 'admin',
            password: 'StrongerPass2'
        });
        assert.equal(patched.response.status, 200);
        assert.equal(patched.json.user.role, 'admin');

        const adminUsers = await client.request('GET', '/api/admin/users?role=admin&limit=20&offset=0');
        assert.equal(adminUsers.response.status, 200);
        assert(adminUsers.json.users.length >= 2);
        assert(adminUsers.json.users.every((user) => user.role === 'admin'));
        assert(adminUsers.json.users.some((user) => user.id === patched.json.user.id));

        const regularUsers = await client.request('GET', '/api/admin/users?role=user&limit=20&offset=0');
        assert.equal(regularUsers.response.status, 200);
        assert(regularUsers.json.users.every((user) => user.role === 'user'));
        assert(regularUsers.json.users.some((user) => user.id === managedUserId));

        const selfDelete = await client.request('DELETE', `/api/admin/users/${login.json.user.id}`);
        assert.equal(selfDelete.response.status, 400);

        const userStats = await client.request('GET', `/api/admin/users/${managedUserId}/stats`);
        assert.equal(userStats.response.status, 200);
        assert.equal(userStats.json.recordCount, 2);
        assert.equal(userStats.json.averageScore, 70);
        assert.equal(userStats.json.totalStudyMinutes, 20);
        assert.equal(userStats.json.byType.length, 2);

        const globalStats = await client.request('GET', '/api/admin/stats');
        assert.equal(globalStats.response.status, 200);
        assert.equal(globalStats.json.practiceRecordCount, 2);
        assert.equal(globalStats.json.averageScore, 70);

        const analytics = await client.request('GET', '/api/admin/analytics?days=30&limit=5');
        assert.equal(analytics.response.status, 200);
        assert(analytics.json.dailyLearning.some((item) => item.records >= 1));
        assert(analytics.json.topUsers.some((user) => user.id === managedUserId));
        assert(analytics.json.scoreBuckets.some((item) => item.bucket === '60-79'));
        assert(analytics.json.scoreBuckets.some((item) => item.bucket === '80-100'));

        await client.request('GET', '/');
        await new Promise((resolve) => setTimeout(resolve, 20));
        const traffic = await client.request('GET', '/api/admin/traffic?days=7&limit=5');
        assert.equal(traffic.response.status, 200);
        assert(traffic.json.requests >= 1);
        assert(traffic.json.topPaths.length >= 1);
        assert(traffic.json.routeGroups.length >= 1);
        assert(traffic.json.statusCodes.length >= 1);

        const deleted = await client.request('DELETE', `/api/admin/users/${added.json.user.id}`);
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);
    } finally {
        await client.close();
    }
});

test('bootstrap admin creates and updates an admin user', async () => {
    const users = new Map();
    let totpDeletes = 0;
    const db = {
        async query(sql, params = []) {
            if (sql.includes('SELECT id FROM users')) {
                const user = users.get(params[0]);
                return { rows: user ? [{ id: user.id }] : [] };
            }
            if (sql.includes('UPDATE users')) {
                const [username, passwordHash, usernameLower] = params;
                const user = users.get(usernameLower);
                user.username = username;
                user.password_hash = passwordHash;
                user.role = 'admin';
                return { rows: [{ id: user.id, username: user.username, role: user.role }] };
            }
            if (sql.includes('INSERT INTO users')) {
                const [username, usernameLower, passwordHash] = params;
                const user = {
                    id: `user-${users.size + 1}`,
                    username,
                    username_lower: usernameLower,
                    password_hash: passwordHash,
                    role: 'admin'
                };
                users.set(usernameLower, user);
                return { rows: [{ id: user.id, username: user.username, role: user.role }] };
            }
            if (sql.includes('DELETE FROM user_totp_recovery_codes') || sql.includes('DELETE FROM user_totp_settings')) {
                totpDeletes += 1;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${sql}`);
        }
    };
    const bcryptStub = {
        async hash(password) {
            return `hash:${password}`;
        }
    };

    const created = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongPass1',
        bcrypt: bcryptStub
    });
    assert.equal(created.created, true);
    assert.equal(created.user.role, 'admin');

    const updated = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongerPass2',
        bcrypt: bcryptStub
    });
    assert.equal(updated.created, false);
    assert.equal(users.get('adminuser').password_hash, 'hash:StrongerPass2');

    const reset = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongestPass3',
        bcrypt: bcryptStub,
        resetTotp: true
    });
    assert.equal(reset.totpReset, true);
    assert.equal(totpDeletes, 2);
});

test('static hosting serves index and denies dotfiles with security headers', async () => {
    const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-static-'));
    fs.mkdirSync(path.join(staticRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'backend', 'src'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'js', 'bundles'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'ListeningPractice', 'P1'), { recursive: true });
    fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>IELTS Atlas</title>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'backend', 'src', 'app.js'), 'function createApp() {}\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'js', 'bundles', 'core-foundation.bundle.js'), 'Generated by scripts/build-bundles.mjs\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'ListeningPractice', 'P1', 'sample.html'), '<!doctype html><title>Listening Sample</title>', 'utf8');

    const client = await createClient({ staticRoot });
    try {
        const home = await client.request('GET', '/');
        assert.equal(home.response.status, 200);
        assert.match(home.text, /<title>IELTS Atlas<\/title>/);
        assert.equal(home.response.headers.get('x-content-type-options'), 'nosniff');

        const dotfile = await client.request('GET', '/.git/config');
        assert.notEqual(dotfile.response.status, 200);
        assert.doesNotMatch(dotfile.text, /\[core\]/);

        const backendSource = await client.request('GET', '/backend/src/app.js');
        assert.notEqual(backendSource.response.status, 200);
        assert.doesNotMatch(backendSource.text, /createApp/);

        const bundle = await client.request('GET', '/js/bundles/core-foundation.bundle.js');
        assert.equal(bundle.response.status, 200);
        assert.match(bundle.text, /Generated by scripts\/build-bundles\.mjs/);

        const listening = await client.request('GET', '/ListeningPractice/P1/sample.html');
        assert.equal(listening.response.status, 200);
        assert.match(listening.text, /Listening Sample/);
    } finally {
        await client.close();
        fs.rmSync(staticRoot, { recursive: true, force: true });
    }
});
