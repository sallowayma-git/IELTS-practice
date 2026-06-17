const assert = require('node:assert/strict');
const { test } = require('node:test');
const session = require('express-session');

const { createApp } = require('../src/app');
const { MemoryAuthStore } = require('../src/auth');
const { MemoryPracticeRecordStore } = require('../src/practiceRecords');

async function createClient() {
    const app = createApp({
        authStore: new MemoryAuthStore(),
        practiceStore: new MemoryPracticeRecordStore(),
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
    } finally {
        await client.close();
    }
});
