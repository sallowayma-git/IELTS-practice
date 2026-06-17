import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:55432/ielts_practice';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'local-postgres-smoke-session-secret';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false';

const appModule = await import('../src/app.js');
const dbModule = await import('../src/db.js');
const migrationsModule = await import('../src/migrations.js');
const { createApp } = appModule.default || appModule;
const db = dbModule.default || dbModule;
const { runMigrations } = migrationsModule.default || migrationsModule;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function applyMigration() {
    await runMigrations(db, {
        migrationsDir: path.join(backendRoot, 'migrations')
    });
}

function listen(app, port = 0) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port, '127.0.0.1', () => resolve(server));
        server.once('error', reject);
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

function createClient(baseUrl) {
    let cookie = '';
    let csrfToken = '';

    return {
        async request(method, route, body) {
            const headers = {};
            if (cookie) {
                headers.cookie = cookie;
            }
            if (csrfToken && method !== 'GET') {
                headers['x-csrf-token'] = csrfToken;
            }
            if (body !== undefined) {
                headers['content-type'] = 'application/json';
            }
            const response = await fetch(`${baseUrl}${route}`, {
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
            if (json?.csrfToken) {
                csrfToken = json.csrfToken;
            }
            return { response, text, json };
        },
        csrf() {
            return this.request('GET', '/api/auth/csrf');
        }
    };
}

async function runSmoke() {
    await applyMigration();

    const app = createApp({ staticRoot: repoRoot });
    const requestedPort = Number(process.env.SMOKE_PORT || 0);
    const server = await listen(app, requestedPort);
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const username = `smoke_${Date.now()}`;
    const password = 'StrongPass1';
    const record = {
        id: `smoke-record-${Date.now()}`,
        sessionId: `smoke-session-${Date.now()}`,
        examId: 'smoke-reading-p1',
        type: 'reading',
        title: 'Smoke Reading P1',
        score: 88,
        totalQuestions: 40,
        correctAnswers: 35,
        duration: 1800,
        date: new Date().toISOString()
    };

    try {
        const first = createClient(baseUrl);
        await first.csrf();
        const registered = await first.request('POST', '/api/auth/register', { username, password });
        assert(registered.response.status === 201, `register failed: ${registered.response.status} ${registered.text}`);

        const home = await first.request('GET', '/');
        assert(home.response.status === 200 && home.text.includes('<title>IELTS Atlas</title>'), 'static index did not load');

        const replaced = await first.request('PUT', '/api/practice-records', { records: [record] });
        assert(replaced.response.status === 200, `replace failed: ${replaced.response.status} ${replaced.text}`);

        const firstRead = await first.request('GET', '/api/practice-records');
        assert(firstRead.json.records?.[0]?.id === record.id, 'same-session read did not return the saved record');

        const second = createClient(baseUrl);
        await second.csrf();
        const login = await second.request('POST', '/api/auth/login', { username, password });
        assert(login.response.status === 200, `second-session login failed: ${login.response.status} ${login.text}`);

        const secondRead = await second.request('GET', '/api/practice-records');
        assert(secondRead.json.records?.some((item) => item.id === record.id), 'second session did not see PostgreSQL record');

        console.log(JSON.stringify({
            status: 'pass',
            baseUrl,
            username,
            recordId: record.id,
            detail: 'PostgreSQL migration, auth, record persistence, and second-session read passed'
        }, null, 2));
    } finally {
        await closeServer(server);
        await db.pool.end();
    }
}

runSmoke().catch(async (error) => {
    try {
        await db.pool.end();
    } catch (_) {
        // ignore cleanup failures
    }
    console.error(JSON.stringify({
        status: 'fail',
        detail: error.message
    }, null, 2));
    process.exit(1);
});
