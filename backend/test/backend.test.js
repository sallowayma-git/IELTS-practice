const assert = require('node:assert/strict');
const test = require('node:test');

const { MemoryStore } = require('express-session');
const { createApp } = require('../src/app');
const { MemoryAuthStore } = require('../src/auth');
const { MemoryPracticeRecordStore } = require('../src/practiceRecords');

async function createClient(options = {}) {
    const authStore = options.authStore || new MemoryAuthStore();
    const practiceStore = options.practiceStore || new MemoryPracticeRecordStore();
    const app = createApp({
        authStore,
        practiceStore,
        sessionStore: new MemoryStore(),
        sessionSecret: 'test-session-secret-with-at-least-32-characters',
        repoRoot: process.cwd(),
        registrationMode: options.registrationMode || 'first-user'
    });
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookieJar = new Map();

    async function request(method, path, body, extraHeaders = {}) {
        const headers = { ...extraHeaders };
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (cookieJar.size) {
            headers.Cookie = Array.from(cookieJar.entries())
                .map(([name, value]) => `${name}=${value}`)
                .join('; ');
        }
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const setCookies = typeof response.headers.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
        for (const value of setCookies) {
            const [pair] = value.split(';');
            const [name, cookieValue] = pair.split('=');
            if (cookieValue) cookieJar.set(name, cookieValue);
            else cookieJar.delete(name);
        }
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        return { response, json };
    }

    return {
        authStore,
        practiceStore,
        close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
        async csrf() {
            const result = await request('GET', '/api/auth/csrf');
            return result.json.csrfToken;
        },
        request
    };
}

test('health endpoint is public', async () => {
    const client = await createClient();
    try {
        const result = await client.request('GET', '/api/health');
        assert.equal(result.response.status, 200);
        assert.deepEqual(result.json, { ok: true });
    } finally {
        await client.close();
    }
});

test('first-user registration, login, and practice records work', async () => {
    const client = await createClient();
    try {
        const csrf = await client.csrf();
        const registered = await client.request('POST', '/api/auth/register', {
            username: 'learner',
            password: 'StrongPass1'
        }, { 'X-CSRF-Token': csrf });
        assert.equal(registered.response.status, 201);
        assert.equal(registered.json.user.username, 'learner');

        const saved = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'record-1', sessionId: 'session-1', score: 8, totalQuestions: 10 }]
        }, { 'X-CSRF-Token': registered.json.csrfToken });
        assert.equal(saved.response.status, 200);
        assert.equal(saved.json.records.length, 1);

        const listed = await client.request('GET', '/api/practice-records');
        assert.equal(listed.response.status, 200);
        assert.equal(listed.json.records[0].id, 'record-1');

        const secondCsrf = await client.csrf();
        const blocked = await client.request('POST', '/api/auth/register', {
            username: 'second',
            password: 'StrongPass1'
        }, { 'X-CSRF-Token': secondCsrf });
        assert.equal(blocked.response.status, 403);
    } finally {
        await client.close();
    }
});

test('practice records require authentication and csrf on writes', async () => {
    const client = await createClient();
    try {
        const anonymous = await client.request('GET', '/api/practice-records');
        assert.equal(anonymous.response.status, 401);

        const csrf = await client.csrf();
        await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        }, { 'X-CSRF-Token': csrf });

        const blocked = await client.request('PUT', '/api/practice-records', { records: [] });
        assert.equal(blocked.response.status, 403);
    } finally {
        await client.close();
    }
});
