const assert = require('node:assert/strict');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const session = require('express-session');

const { createApp } = require('../src/app');
const { MemoryAuthStore } = require('../src/auth');
const { MemoryAdminStore } = require('../src/admin');
const { bootstrapAdmin } = require('../src/bootstrapAdmin');
const { MemoryPracticeRecordStore } = require('../src/practiceRecords');

async function createClient() {
    const authStore = new MemoryAuthStore();
    const practiceStore = new MemoryPracticeRecordStore();
    const app = createApp({
        authStore,
        practiceStore,
        adminStore: new MemoryAdminStore({ authStore, practiceStore }),
        sessionStore: new session.MemoryStore(),
        sessionSecret: 'test-session-secret',
        rateLimit: { maxAttempts: 100, windowMs: 60_000 }
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

        const afterLogout = await client.request('GET', '/api/practice-records');
        assert.equal(afterLogout.response.status, 401);
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
        assert.equal(login.json.user.role, 'admin');

        const summary = await client.request('GET', '/api/admin/summary');
        assert.equal(summary.response.status, 200);
        assert.equal(summary.json.userCount, 2);
        assert.equal(summary.json.adminCount, 1);
        assert.equal(summary.json.practiceRecordCount, 1);

        const users = await client.request('GET', '/api/admin/users?q=managed');
        assert.equal(users.response.status, 200);
        assert.equal(users.json.users.length, 1);
        assert.equal(users.json.users[0].id, managedUserId);

        const listed = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(listed.response.status, 200);
        assert.equal(listed.json.records[0].id, 'managed-record');

        const removed = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`);
        assert.equal(removed.response.status, 200);
        assert.equal(removed.json.removed, 1);

        const afterDelete = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(afterDelete.json.records.length, 0);
    } finally {
        await client.close();
    }
});

test('bootstrap admin creates and updates an admin user', async () => {
    const users = new Map();
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
});

test('static hosting serves index and denies dotfiles with security headers', async () => {
    const client = await createClient();
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
    } finally {
        await client.close();
    }
});
