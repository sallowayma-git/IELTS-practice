const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const otp = require('otplib');
const session = require('express-session');

const { createApp } = require('../src/app');
const { MemoryAuthStore, createRateLimiter } = require('../src/auth');
const { MemoryAdminStore, PostgresAdminStore, normalizeTrafficEvent } = require('../src/admin');
const { bootstrapAdmin } = require('../src/bootstrapAdmin');
const { runMigrations } = require('../src/migrations');
const { MemoryPracticeRecordStore, extractColumns, mergePracticeRecords, normalizePracticeRecord } = require('../src/practiceRecords');
const { MemoryTotpStore, PostgresTotpStore } = require('../src/totp');

test('docker image hardening excludes secrets and runs app as non-root', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const dockerfile = fs.readFileSync(path.join(repoRoot, 'backend', 'Dockerfile'), 'utf8');
    const appSource = fs.readFileSync(path.join(repoRoot, 'backend', 'src', 'app.js'), 'utf8');
    const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
    const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
    const compose = fs.readFileSync(path.join(repoRoot, 'backend', 'docker-compose.yml'), 'utf8');
    const bridgesTemplate = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'bridges.txt'), 'utf8');
    const torEntrypoint = fs.readFileSync(path.join(repoRoot, 'backend', 'tor', 'docker-entrypoint.sh'), 'utf8');
    const siteHealthWatcher = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'watch-site-health.ps1'), 'utf8');
    const bridgeTester = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'test-obfs4-bridges.ps1'), 'utf8');
    const smokePostgres = fs.readFileSync(path.join(repoRoot, 'backend', 'scripts', 'smoke-postgres.mjs'), 'utf8');

    assert.match(dockerfile, /^FROM node:24-alpine/m);
    assert.doesNotMatch(dockerfile, /^FROM node:20-alpine/m);
    assert.match(dockerfile, /\nUSER node\s*\n/);
    for (const pattern of ['.git', 'backend/.env', 'backend/.env.*', 'backend/logs', 'backend/node_modules', 'backend/tor/bridges.local.txt', 'ListeningPractice']) {
        assert(
            dockerignore.split(/\r?\n/).includes(pattern),
            `.dockerignore must exclude ${pattern}`
        );
    }
    assert(gitignore.split(/\r?\n/).includes('backend/tor/bridges.local.txt'));
    assert(compose.includes('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?'));
    assert(compose.includes('PGPASSWORD: ${POSTGRES_PASSWORD:?'));
    assert(!compose.includes(':-postgres'));
    assert(!compose.includes('POSTGRES_PASSWORD: postgres'));
    assert(!compose.includes('postgres://postgres:postgres@postgres'));
    assert(compose.includes('TOR_BRIDGES_LOCAL_FILE'));
    assert(compose.includes('target: /etc/tor/bridges.local.txt'));
    assert(!/obfs4\s+\S+\s+[A-Fa-f0-9]{40}\s+cert=/.test(bridgesTemplate));
    assert(torEntrypoint.includes('VALID_BRIDGES_FILE'));
    assert(torEntrypoint.includes('grep -Eq'));
    assert(torEntrypoint.includes('cert='));
    assert(torEntrypoint.includes('if [ -s "$VALID_BRIDGES_FILE" ]'));
    assert(!/Bridge\\ \*\)\s*printf '%s\\n' "\$bridge"/.test(torEntrypoint));
    assert(siteHealthWatcher.includes('$response.StatusCode -lt 400'));
    assert(!siteHealthWatcher.includes('$response.StatusCode -lt 500'));
    assert(siteHealthWatcher.includes('$env:SITE_HEALTH_BRIDGE_WARNING_THRESHOLD'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 86400)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(0, 1000)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 60)]'));
    assert(siteHealthWatcher.includes('[ValidateRange(1, 5000)]'));
    assert(siteHealthWatcher.includes('function Resolve-IntegerInRange'));
    assert(siteHealthWatcher.includes("-Name 'SITE_HEALTH_BRIDGE_WARNING_THRESHOLD'"));
    assert(siteHealthWatcher.includes('[switch]$IncludeBridgeFingerprints'));
    assert(siteHealthWatcher.includes('fingerprints = if ($IncludeBridgeFingerprints) { $fingerprints } else { @() }'));
    assert(siteHealthWatcher.includes('seenFingerprints = if ($IncludeBridgeFingerprints) { $seenFingerprints } else { @() }'));
    assert(bridgeTester.includes('[switch]$RevealBridgeLines'));
    assert(bridgeTester.includes('[ValidateRange(10, 600)]'));
    assert(bridgeTester.includes('[ValidateRange(1, 100)]'));
    assert(bridgeTester.includes('[int]$MaxCandidates = 20'));
    assert(bridgeTester.includes('Get-CandidateBridges | Select-Object -First $MaxCandidates'));
    assert.match(bridgeTester, /if \(\$RevealBridgeLines\) \{\s*\$result\.line = \$Candidate\.line\s*\}/);
    assert.match(bridgeTester, /\$seen\.Add\(\$item\.line\)/);
    assert.doesNotMatch(bridgeTester, /\$seen\.Add\(\$item\.fingerprint\)/);
    assert(smokePostgres.includes('dotenv.config'));
    assert(smokePostgres.includes('process.env.POSTGRES_PASSWORD'));
    assert(smokePostgres.includes('Set DATABASE_URL or POSTGRES_PASSWORD'));
    assert(!smokePostgres.includes("|| 'postgres'"));
    assert(appSource.includes('function createStaticBoundaryMiddleware(root)'));
    assert(appSource.includes('createStaticBoundaryMiddleware(staticDirectory), express.static(staticDirectory'));
    assert(appSource.includes('createStaticBoundaryMiddleware(adminRoot), express.static(adminRoot'));
});

async function createClient(options = {}) {
    const sessionStore = new session.MemoryStore();
    const authStore = new MemoryAuthStore({ sessionStore });
    const totpStore = new MemoryTotpStore();
    const practiceStore = new MemoryPracticeRecordStore();
    const adminStore = new MemoryAdminStore({ authStore, practiceStore, totpStore, sessionStore });
    const app = createApp({
        authStore,
        totpStore,
        practiceStore,
        adminStore,
        sessionStore,
        sessionSecret: 'test-session-secret',
        staticRoot: options.staticRoot,
        cookieSecure: options.cookieSecure,
        trustProxy: options.trustProxy,
        bcrypt: options.bcrypt,
        rateLimit: options.rateLimit || { maxAttempts: 100, windowMs: 60_000 },
        csrfRateLimit: options.csrfRateLimit,
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

    function createSessionClient() {
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
            const hasRawBody = Object.prototype.hasOwnProperty.call(options, 'rawBody');
            if (body !== undefined || hasRawBody) {
                headers['content-type'] = 'application/json';
            }
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers,
                body: hasRawBody ? options.rawBody : (body === undefined ? undefined : JSON.stringify(body))
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
            }
        };
    }

    const primarySession = createSessionClient();

    return {
        authStore,
        adminStore,
        totpStore,
        practiceStore,
        get csrfToken() {
            return primarySession.csrfToken;
        },
        request: primarySession.request,
        csrf: primarySession.csrf,
        createSession: createSessionClient,
        close() {
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
        }
    };
}

function getResponseSessionCookie(result) {
    return result.response.headers.get('set-cookie')?.split(';')[0] || '';
}

function createProductionAppWithSecret(sessionSecret, options = {}) {
    const sessionStore = new session.MemoryStore();
    const authStore = new MemoryAuthStore({ sessionStore });
    const totpStore = new MemoryTotpStore();
    const practiceStore = new MemoryPracticeRecordStore();
    return () => createApp({
        authStore,
        totpStore,
        practiceStore,
        adminStore: new MemoryAdminStore({ authStore, practiceStore, totpStore, sessionStore }),
        sessionStore,
        sessionSecret,
        nodeEnv: 'production',
        rateLimit: { maxAttempts: 100, windowMs: 60_000 },
        totpEncryptionKey: options.totpEncryptionKey || '0123456789abcdef0123456789abcdef'
    });
}

test('production app rejects missing or placeholder session secrets', () => {
    assert.throws(
        createProductionAppWithSecret('development-session-secret-change-me'),
        /SESSION_SECRET/
    );
    assert.throws(
        createProductionAppWithSecret('replace-with-a-long-random-session-secret'),
        /SESSION_SECRET/
    );
    assert.throws(
        createProductionAppWithSecret('short-secret'),
        /SESSION_SECRET/
    );
    assert.doesNotThrow(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef')
    );
});

test('production app rejects weak TOTP encryption keys', () => {
    assert.throws(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef', {
            totpEncryptionKey: 'short-totp-key'
        }),
        /TOTP_ENCRYPTION_KEY/
    );
    assert.doesNotThrow(
        createProductionAppWithSecret('0123456789abcdef0123456789abcdef', {
            totpEncryptionKey: 'fedcba9876543210fedcba9876543210'
        })
    );
});

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

function generateTotpToken(secret, epochOffsetMs = 0) {
    const options = { secret };
    if (epochOffsetMs) {
        options.epoch = Date.now() + epochOffsetMs;
    }
    return otp.generateSync(options);
}

async function withDateNowOffset(offsetMs, callback) {
    const realNow = Date.now;
    Date.now = () => realNow() + offsetMs;
    try {
        return await callback();
    } finally {
        Date.now = realNow;
    }
}

async function enableTotpForCurrentSession(client) {
    const setup = await client.request('POST', '/api/auth/totp/setup', {});
    assert.equal(setup.response.status, 200);
    assert(setup.json.secret);
    assert.match(setup.json.otpauthUrl, /^otpauth:\/\/totp\//);

    const setupToken = generateTotpToken(setup.json.secret);
    const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
        token: setupToken
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.json.status.enabled, true);
    assert.equal(verified.json.recoveryCodes.length, 10);
    return {
        secret: setup.json.secret,
        setupToken,
        recoveryCodes: verified.json.recoveryCodes,
        user: verified.json.user,
        sessionCookie: getResponseSessionCookie(verified),
        csrfToken: verified.json.csrfToken
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
        assert.equal(weak.json.error, 'Password strength is insufficient');
        assert(weak.json.details.includes('Password must be at least 8 characters long'));

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
        assert.equal(duplicate.json.error, 'Username already exists');
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

        const shortToken = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        }, {
            csrf: false,
            headers: {
                'x-csrf-token': client.csrfToken.slice(0, -1)
            }
        });
        assert.equal(shortToken.response.status, 403);

        const valid = await client.request('POST', '/api/auth/register', {
            username: 'csrf_user',
            password: 'StrongPass1'
        });
        assert.equal(valid.response.status, 201);
    } finally {
        await client.close();
    }
});

test('auth CSRF endpoint is rate limited to prevent session store flooding', async () => {
    const client = await createClient({
        csrfRateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const first = await client.request('GET', '/api/auth/csrf');
        assert.equal(first.response.status, 200);
        assert(first.json.csrfToken);

        const limited = await client.request('GET', '/api/auth/csrf');
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('rate limiter bounds tracked keys', () => {
    const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000, maxKeys: 2 });
    limiter('first');
    limiter('second');
    limiter('third');
    assert.equal(limiter.size(), 2);
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
        const logoutCookie = logout.response.headers.get('set-cookie') || '';
        assert.match(logoutCookie, /ielts\.sid=;/);
        assert.match(logoutCookie, /HttpOnly/);
        assert.match(logoutCookie, /SameSite=Lax/);

        await client.csrf();
        const wrong = await client.request('POST', '/api/auth/login', {
            username: 'login_user',
            password: 'WrongPass1'
        });
        assert.equal(wrong.response.status, 401);
        assert.equal(wrong.json.error, 'Username or password is incorrect');

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

test('sensitive API responses are not cacheable', async () => {
    const client = await createClient();
    try {
        const csrf = await client.request('GET', '/api/auth/csrf');
        assert.equal(csrf.response.status, 200);
        assert.equal(csrf.response.headers.get('cache-control'), 'no-store');
        assert.equal(csrf.response.headers.get('pragma'), 'no-cache');
        assert.equal(csrf.response.headers.get('expires'), '0');

        const created = await client.request('POST', '/api/auth/register', {
            username: 'cache_user',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);

        const records = await client.request('GET', '/api/practice-records');
        assert.equal(records.response.status, 200);
        assert.equal(records.response.headers.get('cache-control'), 'no-store');

        await seedAdmin(client, 'cache_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'cache_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const summary = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(summary.response.status, 200);
        assert.equal(summary.response.headers.get('cache-control'), 'no-store');
    } finally {
        await client.close();
    }
});

test('malformed JSON bodies return a stable validation error', async () => {
    const client = await createClient();
    try {
        const response = await client.request('POST', '/api/auth/register', undefined, {
            rawBody: '{"username":'
        });
        assert.equal(response.response.status, 400);
        assert.equal(response.json.error, 'Malformed request body');
        assert.doesNotMatch(response.text, /Unexpected token|JSON/i);
    } finally {
        await client.close();
    }
});

test('logout clears secure session cookies with matching attributes', async () => {
    const client = await createClient({ cookieSecure: true, trustProxy: true });
    const proxyHeaders = {
        'x-forwarded-proto': 'https'
    };
    try {
        const csrf = await client.request('GET', '/api/auth/csrf', undefined, {
            headers: proxyHeaders
        });
        assert.equal(csrf.response.status, 200);
        const csrfCookie = csrf.response.headers.get('set-cookie') || '';
        assert.match(csrfCookie, /Secure/);
        assert.match(csrfCookie, /SameSite=Lax/);

        const created = await client.request('POST', '/api/auth/register', {
            username: 'secure_cookie_user',
            password: 'StrongPass1'
        }, {
            headers: proxyHeaders
        });
        assert.equal(created.response.status, 201);

        const logout = await client.request('POST', '/api/auth/logout', undefined, {
            headers: proxyHeaders
        });
        assert.equal(logout.response.status, 200);
        const clearedCookie = logout.response.headers.get('set-cookie') || '';
        assert.match(clearedCookie, /ielts\.sid=;/);
        assert.match(clearedCookie, /HttpOnly/);
        assert.match(clearedCookie, /Secure/);
        assert.match(clearedCookie, /SameSite=Lax/);
    } finally {
        await client.close();
    }
});

test('login performs a dummy password check for unknown users', async () => {
    const compareCalls = [];
    const fakeBcrypt = {
        async hash(password) {
            return `hash:${password}`;
        },
        async compare(password, hash) {
            compareCalls.push({ password, hash });
            return hash === `hash:${password}`;
        }
    };
    const client = await createClient({ bcrypt: fakeBcrypt });
    try {
        await client.csrf();
        const missing = await client.request('POST', '/api/auth/login', {
            username: 'missing_user',
            password: 'StrongPass1'
        });
        assert.equal(missing.response.status, 401);
        assert.equal(missing.json.error, 'Username or password is incorrect');
        assert.equal(compareCalls.length, 1);
        assert.equal(compareCalls[0].password, 'StrongPass1');
        assert.match(compareCalls[0].hash, /^\$2[aby]\$12\$/);
    } finally {
        await client.close();
    }
});

test('users can update their own username and password', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'account_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        await client.authStore.createUser({
            username: 'taken_user',
            usernameLower: 'taken_user',
            passwordHash: await bcrypt.hash('StrongPass1', 4)
        });

        const wrongPasswordRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'renamed_user',
            password: 'WrongPass1'
        });
        assert.equal(wrongPasswordRename.response.status, 401);

        const duplicateRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'taken_user',
            password: 'StrongPass1'
        });
        assert.equal(duplicateRename.response.status, 409);

        const renamed = await client.request('PATCH', '/api/auth/account/username', {
            username: 'renamed_user',
            password: 'StrongPass1'
        });
        assert.equal(renamed.response.status, 200);
        assert.equal(renamed.json.user.username, 'renamed_user');

        const me = await client.request('GET', '/api/auth/me');
        assert.equal(me.response.status, 200);
        assert.equal(me.json.user.username, 'renamed_user');

        const weakPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'weak'
        });
        assert.equal(weakPassword.response.status, 400);

        const wrongCurrentPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(wrongCurrentPassword.response.status, 401);

        const samePassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongPass1'
        });
        assert.equal(samePassword.response.status, 400);

        const passwordChanged = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordChanged.response.status, 200);
        assert.equal(passwordChanged.json.user.username, 'renamed_user');

        const logout = await client.request('POST', '/api/auth/logout');
        assert.equal(logout.response.status, 200);

        await client.csrf();
        const oldUsernameLogin = await client.request('POST', '/api/auth/login', {
            username: 'account_user',
            password: 'StrongerPass2'
        });
        assert.equal(oldUsernameLogin.response.status, 401);

        const oldPasswordLogin = await client.request('POST', '/api/auth/login', {
            username: 'renamed_user',
            password: 'StrongPass1'
        });
        assert.equal(oldPasswordLogin.response.status, 401);

        const newPasswordLogin = await client.request('POST', '/api/auth/login', {
            username: 'renamed_user',
            password: 'StrongerPass2'
        });
        assert.equal(newPasswordLogin.response.status, 200);
        assert.equal(newPasswordLogin.json.user.username, 'renamed_user');
    } finally {
        await client.close();
    }
});

test('account username and password changes revoke other sessions', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'session_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const initialSessionCookie = getResponseSessionCookie(created);
        assert(initialSessionCookie);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const otherLogin = await otherSession.request('POST', '/api/auth/login', {
            username: 'session_user',
            password: 'StrongPass1'
        });
        assert.equal(otherLogin.response.status, 200);

        const renamed = await client.request('PATCH', '/api/auth/account/username', {
            username: 'session_user_renamed',
            password: 'StrongPass1'
        });
        assert.equal(renamed.response.status, 200);
        const renamedSessionCookie = getResponseSessionCookie(renamed);
        assert(renamedSessionCookie);
        assert.notEqual(renamedSessionCookie, initialSessionCookie);

        const otherAfterRename = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfterRename.response.status, 401);

        const anotherSession = client.createSession();
        await anotherSession.csrf();
        const anotherLogin = await anotherSession.request('POST', '/api/auth/login', {
            username: 'session_user_renamed',
            password: 'StrongPass1'
        });
        assert.equal(anotherLogin.response.status, 200);

        const passwordChanged = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordChanged.response.status, 200);
        const passwordChangedSessionCookie = getResponseSessionCookie(passwordChanged);
        assert(passwordChangedSessionCookie);
        assert.notEqual(passwordChangedSessionCookie, renamedSessionCookie);

        const anotherAfterPasswordChange = await anotherSession.request('GET', '/api/auth/me');
        assert.equal(anotherAfterPasswordChange.response.status, 401);

        const currentSession = await client.request('GET', '/api/auth/me');
        assert.equal(currentSession.response.status, 200);
        assert.equal(currentSession.json.user.username, 'session_user_renamed');
    } finally {
        await client.close();
    }
});

test('sensitive account password checks are rate limited', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        const created = await register(client, 'account_limited', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const wrongRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'account_limited_new',
            password: 'WrongPass1'
        });
        assert.equal(wrongRename.response.status, 401);

        const limitedRename = await client.request('PATCH', '/api/auth/account/username', {
            username: 'account_limited_new',
            password: 'WrongPass1'
        });
        assert.equal(limitedRename.response.status, 429);

        const wrongPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(wrongPassword.response.status, 401);

        const limitedPassword = await client.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'WrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(limitedPassword.response.status, 429);

        const wrongDelete = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'account_limited'
        });
        assert.equal(wrongDelete.response.status, 401);

        const limitedDelete = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'account_limited'
        });
        assert.equal(limitedDelete.response.status, 429);
    } finally {
        await client.close();
    }
});

test('authenticated APIs refresh stale session users before trusting them', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'stale_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const storedUser = client.authStore.users.get('stale_user');
        storedUser.role = 'admin';

        const refreshedRole = await client.request('GET', '/api/auth/me');
        assert.equal(refreshedRole.response.status, 200);
        assert.equal(refreshedRole.json.user.role, 'admin');

        client.authStore.users.delete('stale_user');

        const staleMe = await client.request('GET', '/api/auth/me');
        assert.equal(staleMe.response.status, 401);

        const stalePractice = await client.request('GET', '/api/practice-records');
        assert.equal(stalePractice.response.status, 401);
    } finally {
        await client.close();
    }
});

test('pending TOTP sessions refresh stale users before trusting them', async () => {
    const client = await createClient();
    try {
        await register(client, 'pending_totp_user', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const pendingLogin = await client.request('POST', '/api/auth/login', {
            username: 'pending_totp_user',
            password: 'StrongPass1'
        });
        assert.equal(pendingLogin.response.status, 200);
        assert.equal(pendingLogin.json.requiresTotp, true);

        client.authStore.users.delete('pending_totp_user');
        const deletedPendingLogin = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        });
        assert.equal(deletedPendingLogin.response.status, 400);
        assert.equal(deletedPendingLogin.json.error, 'TOTP login was not started');

        const adminSession = client.createSession();
        const adminCreated = await register(adminSession, 'pending_totp_admin', 'StrongPass1');
        assert.equal(adminCreated.response.status, 201);
        const storedAdmin = client.authStore.users.get('pending_totp_admin');
        storedAdmin.role = 'admin';
        await adminSession.request('POST', '/api/auth/logout');

        await adminSession.csrf();
        const pendingSetup = await adminSession.request('POST', '/api/auth/login', {
            username: 'pending_totp_admin',
            password: 'StrongPass1'
        });
        assert.equal(pendingSetup.response.status, 200);
        assert.equal(pendingSetup.json.requiresTotpSetup, true);

        client.authStore.users.delete('pending_totp_admin');
        const deletedPendingSetup = await adminSession.request('POST', '/api/auth/totp/setup', {});
        assert.equal(deletedPendingSetup.response.status, 401);
        assert.equal(deletedPendingSetup.json.error, 'Authentication required');
    } finally {
        await client.close();
    }
});

test('users can delete their own account and associated records', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'delete_user', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const userId = created.json.user.id;

        const replaced = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'delete-record', title: 'Delete me', score: 80 }]
        });
        assert.equal(replaced.response.status, 200);
        assert.equal(replaced.json.records.length, 1);

        const wrongConfirm = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'wrong_user'
        });
        assert.equal(wrongConfirm.response.status, 400);

        const wrongPassword = await client.request('DELETE', '/api/auth/account', {
            password: 'WrongPass1',
            confirm: 'delete_user'
        });
        assert.equal(wrongPassword.response.status, 401);

        const deleted = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'delete_user'
        });
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);

        const me = await client.request('GET', '/api/auth/me');
        assert.equal(me.response.status, 401);
        assert.equal(await client.authStore.findByUsernameLower('delete_user'), null);
        assert.deepEqual(await client.practiceStore.list(userId), []);

        await client.csrf();
        const login = await client.request('POST', '/api/auth/login', {
            username: 'delete_user',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 401);
    } finally {
        await client.close();
    }
});

test('the last admin account cannot delete itself', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        await seedAdmin(client, 'sole_admin', 'StrongPass1');
        const login = await client.request('POST', '/api/auth/login', {
            username: 'sole_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(client);

        const blocked = await client.request('DELETE', '/api/auth/account', {
            password: 'StrongPass1',
            confirm: 'sole_admin'
        });
        assert.equal(blocked.response.status, 409);
        assert(await client.authStore.findByUsernameLower('sole_admin'));
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
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('auth login rate limit applies across usernames from one IP', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        await client.csrf();
        const firstFailure = await client.request('POST', '/api/auth/login', {
            username: 'spray_one',
            password: 'WrongPass1'
        });
        assert.equal(firstFailure.response.status, 401);

        const limited = await client.request('POST', '/api/auth/login', {
            username: 'spray_two',
            password: 'WrongPass1'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
    } finally {
        await client.close();
    }
});

test('auth registration rate limit applies across usernames from one IP', async () => {
    const client = await createClient({
        rateLimit: { maxAttempts: 1, windowMs: 60_000 }
    });
    try {
        await client.csrf();
        const created = await client.request('POST', '/api/auth/register', {
            username: 'register_ip_one',
            password: 'StrongPass1'
        });
        assert.equal(created.response.status, 201);

        const limited = await client.request('POST', '/api/auth/register', {
            username: 'register_ip_two',
            password: 'StrongPass1'
        });
        assert.equal(limited.response.status, 429);
        assert.equal(limited.json.error, 'Too many requests, please try again later');
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
        const initialSessionCookie = getResponseSessionCookie(created);
        assert.match(initialSessionCookie, /^ielts\.sid=/);

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
        const verifiedSessionCookie = getResponseSessionCookie(verified);
        assert.match(verifiedSessionCookie, /^ielts\.sid=/);
        assert.notEqual(verifiedSessionCookie, initialSessionCookie);

        const status = await client.request('GET', '/api/auth/totp/status');
        assert.equal(status.response.status, 200);
        assert.equal(status.json.status.enabled, true);
        assert.equal(status.json.status.recoveryCodesRemaining, 10);

        const repeatedSetup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(repeatedSetup.response.status, 409);
    } finally {
        await client.close();
    }
});

test('enabling TOTP revokes other active sessions for the same user', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'totp_enable_revokes', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const otherLogin = await otherSession.request('POST', '/api/auth/login', {
            username: 'totp_enable_revokes',
            password: 'StrongPass1'
        });
        assert.equal(otherLogin.response.status, 200);
        assert.equal(otherLogin.json.user.username, 'totp_enable_revokes');

        const otherBefore = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherBefore.response.status, 200);

        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);
        const verified = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(verified.response.status, 200);
        assert.equal(verified.json.status.enabled, true);

        const currentAfter = await client.request('GET', '/api/auth/me');
        assert.equal(currentAfter.response.status, 200);
        const otherAfter = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfter.response.status, 401);
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

        const login = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        }));
        assert.equal(login.response.status, 200);
        assert.equal(login.json.user.username, 'totp_login');

        const records = await client.request('GET', '/api/practice-records');
        assert.equal(records.response.status, 200);
    } finally {
        await client.close();
    }
});

test('invalid TOTP codes do not trigger recovery code bcrypt checks', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_recovery_guard', 'StrongPass1');
        await enableTotpForCurrentSession(client);

        let recoveryChecks = 0;
        const originalConsumeRecoveryCode = client.totpStore.consumeRecoveryCode.bind(client.totpStore);
        client.totpStore.consumeRecoveryCode = async (...args) => {
            recoveryChecks += 1;
            return originalConsumeRecoveryCode(...args);
        };

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_recovery_guard',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.json.requiresTotp, true);

        const badTotp = await client.request('POST', '/api/auth/totp/login', { token: '000000' });
        assert.equal(badTotp.response.status, 401);
        assert.equal(recoveryChecks, 0);

        const recoveryShaped = await client.request('POST', '/api/auth/totp/login', {
            token: 'ABCD-EF12-3456-7890'
        });
        assert.equal(recoveryShaped.response.status, 401);
        assert.equal(recoveryChecks, 1);
    } finally {
        await client.close();
    }
});

test('TOTP setup code cannot be reused as a login code', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_setup_replay', 'StrongPass1');
        const { setupToken } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_setup_replay',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        const replay = await client.request('POST', '/api/auth/totp/login', {
            token: setupToken
        });
        assert.equal(replay.response.status, 401);
        assert.equal(replay.json.error, 'TOTP code is invalid');
    } finally {
        await client.close();
    }
});

test('TOTP login rejects replayed current time-step tokens', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_replay', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);
        await client.request('POST', '/api/auth/logout');

        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_replay',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        let token;
        const login = await withDateNowOffset(31_000, () => {
            token = generateTotpToken(secret);
            return client.request('POST', '/api/auth/totp/login', { token });
        });
        assert.equal(login.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        await client.request('POST', '/api/auth/login', {
            username: 'totp_replay',
            password: 'StrongPass1'
        });
        const replay = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/login', { token }));
        assert.equal(replay.response.status, 401);
        assert.equal(replay.json.error, 'TOTP code is invalid');
    } finally {
        await client.close();
    }
});

test('TOTP pending setup and login expire before verification', async () => {
    const client = await createClient();
    const realNow = Date.now;
    try {
        await register(client, 'totp_expire', 'StrongPass1');
        const setup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(setup.response.status, 200);

        Date.now = () => realNow() + 11 * 60 * 1000;
        const expiredSetup = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(setup.json.secret)
        });
        assert.equal(expiredSetup.response.status, 401);
        assert.equal(expiredSetup.json.error, 'TOTP setup expired');
        Date.now = realNow;

        const freshSetup = await client.request('POST', '/api/auth/totp/setup', {});
        assert.equal(freshSetup.response.status, 200);
        const enabled = await client.request('POST', '/api/auth/totp/verify-setup', {
            token: generateTotpToken(freshSetup.json.secret)
        });
        assert.equal(enabled.response.status, 200);

        await client.request('POST', '/api/auth/logout');
        await client.csrf();
        const passwordOnly = await client.request('POST', '/api/auth/login', {
            username: 'totp_expire',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);

        Date.now = () => realNow() + 11 * 60 * 1000;
        const expiredLogin = await client.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(freshSetup.json.secret)
        });
        assert.equal(expiredLogin.response.status, 401);
        assert.equal(expiredLogin.json.error, 'TOTP login expired');
    } finally {
        Date.now = realNow;
        await client.close();
    }
});

test('TOTP recovery codes are one-time and can be regenerated', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_recovery', 'StrongPass1');
        const { secret, recoveryCodes } = await enableTotpForCurrentSession(client);
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

        const missingToken = await client.request('POST', '/api/auth/totp/recovery-codes');
        assert.equal(missingToken.response.status, 401);

        const regenerated = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/recovery-codes', {
            token: generateTotpToken(secret)
        }));
        assert.equal(regenerated.response.status, 200);
        assert.equal(regenerated.json.recoveryCodes.length, 10);
        assert.equal(regenerated.json.status.recoveryCodesRemaining, 10);
    } finally {
        await client.close();
    }
});

test('Postgres TOTP recovery code consumption requires an unused row update', async () => {
    const calls = [];
    const makeDb = (updateRowCount) => ({
        markUsed: false,
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('SELECT id, code_hash')) {
                return { rows: [{ id: 'recovery-1', code_hash: 'stored-hash' }] };
            }
            if (sql.includes('UPDATE user_totp_recovery_codes')) {
                return { rowCount: updateRowCount };
            }
            if (sql.includes('UPDATE user_totp_settings')) {
                this.markUsed = true;
                return { rowCount: 1 };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    });
    const bcryptImpl = { compare: async () => true };

    const staleDb = makeDb(0);
    const staleStore = new PostgresTotpStore(staleDb);
    assert.equal(await staleStore.consumeRecoveryCode('user-id', 'AAAA-BBBB', bcryptImpl), false);
    assert.equal(calls.length, 0);
    assert.equal(await staleStore.consumeRecoveryCode('user-id', 'AAAA-BBBB-CCCC-DDDD', bcryptImpl), false);
    assert.equal(staleDb.markUsed, false);
    assert.match(
        calls.find((call) => call.sql.includes('UPDATE user_totp_recovery_codes')).sql,
        /used_at IS NULL/
    );

    calls.length = 0;
    const freshDb = makeDb(1);
    const freshStore = new PostgresTotpStore(freshDb);
    assert.equal(await freshStore.consumeRecoveryCode('user-id', 'AAAA-BBBB-CCCC-DDDD', bcryptImpl), true);
    assert.equal(freshDb.markUsed, true);
});

test('Postgres TOTP time-step consumption rejects stale updates', async () => {
    const calls = [];
    const makeDb = (updateRowCount) => ({
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes('UPDATE user_totp_settings')) {
                return { rowCount: updateRowCount };
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    });

    const staleStore = new PostgresTotpStore(makeDb(0));
    assert.equal(await staleStore.consumeTotpStep('user-id', 12345), false);
    assert.match(calls[0].sql, /last_totp_step IS NULL OR last_totp_step < \$2/);
    assert.deepEqual(calls[0].params, ['user-id', 12345]);

    calls.length = 0;
    const freshStore = new PostgresTotpStore(makeDb(1));
    assert.equal(await freshStore.consumeTotpStep('user-id', 12346), true);
});

test('ordinary users can disable TOTP with password and current code', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_disable', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);

        const wrongPassword = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: 'WrongPass1',
            token: generateTotpToken(secret)
        }));
        assert.equal(wrongPassword.response.status, 401);

        const disabled = await withDateNowOffset(31_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: 'StrongPass1',
            token: generateTotpToken(secret)
        }));
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

test('disabling TOTP revokes other active sessions for the same user', async () => {
    const client = await createClient();
    try {
        await register(client, 'totp_disable_revokes', 'StrongPass1');
        const { secret } = await enableTotpForCurrentSession(client);

        const otherSession = client.createSession();
        await otherSession.csrf();
        const passwordOnly = await otherSession.request('POST', '/api/auth/login', {
            username: 'totp_disable_revokes',
            password: 'StrongPass1'
        });
        assert.equal(passwordOnly.response.status, 200);
        assert.equal(passwordOnly.json.requiresTotp, true);
        const otherLogin = await withDateNowOffset(31_000, () => otherSession.request('POST', '/api/auth/totp/login', {
            token: generateTotpToken(secret)
        }));
        assert.equal(otherLogin.response.status, 200);

        const otherBefore = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherBefore.response.status, 200);

        const disabled = await withDateNowOffset(62_000, () => client.request('POST', '/api/auth/totp/disable', {
            password: 'StrongPass1',
            token: generateTotpToken(secret)
        }));
        assert.equal(disabled.response.status, 200);
        assert.equal(disabled.json.status.enabled, false);
        assert.equal(disabled.json.user.username, 'totp_disable_revokes');
        assert(disabled.json.csrfToken);

        const currentAfter = await client.request('GET', '/api/auth/me');
        assert.equal(currentAfter.response.status, 200);
        const otherAfter = await otherSession.request('GET', '/api/auth/me');
        assert.equal(otherAfter.response.status, 401);
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

test('PUT practice records deduplicates duplicate session ids before storing', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'replace_dedupe_user', 'StrongPass1');
        assert.equal(created.response.status, 201);

        const replaced = await client.request('PUT', '/api/practice-records', {
            records: [
                { id: 'older-record', sessionId: 'same-session', score: 40, date: '2026-02-01T00:00:00.000Z' },
                { id: 'newer-record', sessionId: 'same-session', score: 85, date: '2026-02-02T00:00:00.000Z' },
                { id: 'moved-record', sessionId: 'old-session', score: 50, date: '2026-02-03T00:00:00.000Z' },
                { id: 'moved-record', sessionId: 'new-session', score: 60, date: '2026-02-04T00:00:00.000Z' },
                { id: 'separate-record', sessionId: 'old-session', score: 70, date: '2026-02-05T00:00:00.000Z' }
            ]
        });
        assert.equal(replaced.response.status, 200);
        assert.equal(replaced.json.records.length, 3);
        assert.deepEqual(
            replaced.json.records.map((record) => [record.id, record.sessionId, record.score]),
            [
                ['newer-record', 'same-session', 85],
                ['moved-record', 'new-session', 60],
                ['separate-record', 'old-session', 70]
            ]
        );

        const listed = await client.request('GET', '/api/practice-records');
        assert.equal(listed.json.records.length, 3);
        assert.deepEqual(
            listed.json.records.map((record) => [record.id, record.sessionId, record.score]),
            [
                ['newer-record', 'same-session', 85],
                ['moved-record', 'new-session', 60],
                ['separate-record', 'old-session', 70]
            ]
        );
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

test('practice API rejects unsafe record identifiers and oversized batches', async () => {
    const client = await createClient();
    try {
        await register(client, 'practice_bounds', 'StrongPass1');

        const longId = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'x'.repeat(513), title: 'Too long' }]
        });
        assert.equal(longId.response.status, 400);

        const longSession = await client.request('POST', '/api/practice-records/import', {
            records: [{ id: 'safe-id', sessionId: 's'.repeat(513) }]
        });
        assert.equal(longSession.response.status, 400);

        const controlId = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'record\nheader', title: 'Bad id' }]
        });
        assert.equal(controlId.response.status, 400);
        assert.equal(controlId.json.error, 'id contains unsafe control characters');
        assert.equal(controlId.json.details.field, 'id');

        const controlSession = await client.request('POST', '/api/practice-records/import', {
            records: [{ id: 'safe-control-id', sessionId: 'session\rvalue' }]
        });
        assert.equal(controlSession.response.status, 400);
        assert.equal(controlSession.json.error, 'sessionId contains unsafe control characters');
        assert.equal(controlSession.json.details.field, 'sessionId');

        const controlTitle = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'safe-title-id', title: 'Bad\ntitle' }]
        });
        assert.equal(controlTitle.response.status, 400);
        assert.equal(controlTitle.json.error, 'title contains unsafe control characters');
        assert.equal(controlTitle.json.details.field, 'title');

        const controlType = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'safe-type-id', type: 'reading\ttab' }]
        });
        assert.equal(controlType.response.status, 400);
        assert.equal(controlType.json.error, 'type contains unsafe control characters');
        assert.equal(controlType.json.details.field, 'type');

        const oversized = await client.request('PUT', '/api/practice-records', {
            records: Array.from({ length: 5001 }, (_, index) => ({ id: `record-${index}` }))
        });
        assert.equal(oversized.response.status, 413);

        const polluted = JSON.parse('{"id":"polluted-record","payload":{"nested":{"__proto__":{"admin":true}}}}');
        const unsafePayload = await client.request('PUT', '/api/practice-records', {
            records: [polluted]
        });
        assert.equal(unsafePayload.response.status, 400);
        assert.equal(unsafePayload.json.error, 'practice record contains an unsafe key');
        assert.equal(unsafePayload.json.details.field, 'record.payload.nested.__proto__');

        const nullCharacterPayload = await client.request('PUT', '/api/practice-records', {
            records: [{ id: 'null-character-record', title: 'bad\u0000title' }]
        });
        assert.equal(nullCharacterPayload.response.status, 400);
        assert.equal(nullCharacterPayload.json.error, 'practice record payload contains an unsupported null character');
        assert.equal(nullCharacterPayload.json.details.field, 'record.title');
    } finally {
        await client.close();
    }
});

test('practice record import cannot grow beyond the batch record cap', () => {
    const existing = Array.from({ length: 5000 }, (_, index) => ({ id: `existing-${index}` }));
    assert.throws(
        () => mergePracticeRecords(existing, [{ id: 'one-too-many' }]),
        (error) => {
            assert.match(error.message, /too many practice records/);
            assert.equal(error.status, 413);
            assert.equal(error.details.maxRecords, 5000);
            return true;
        }
    );
});

test('practice record normalization rejects circular payloads without overflowing the stack', () => {
    const record = { id: 'cycle-record', payload: { ok: true } };
    record.payload.self = record.payload;
    assert.throws(
        () => normalizePracticeRecord(record),
        /circular reference/
    );
});

test('practice record normalization rejects non-JSON payload values before serialization', () => {
    assert.throws(
        () => normalizePracticeRecord({ id: 'bigint-record', payload: { value: 10n } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains a non-JSON value');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'symbol-record', payload: { value: Symbol('bad') } }),
        /non-JSON value/
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'nan-record', payload: { value: Number.NaN } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains a non-finite number');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'null-record', payload: { value: 'bad\u0000value' } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains an unsupported null character');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
    assert.throws(
        () => normalizePracticeRecord({ id: 'surrogate-record', payload: { value: 'bad\uD800value' } }),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.message, 'practice record payload contains invalid Unicode');
            assert.equal(error.details.field, 'record.payload.value');
            return true;
        }
    );
});

test('practice record normalization clamps numeric statistics', () => {
    const normalized = normalizePracticeRecord({
        id: 'numeric-record',
        score: 999,
        accuracy: -20,
        totalQuestions: 5.8,
        correctAnswers: 99,
        duration: -30
    });
    assert.equal(normalized.score, 100);
    assert.equal(normalized.accuracy, 0);
    assert.equal(normalized.totalQuestions, 5);
    assert.equal(normalized.correctAnswers, 5);
    assert.equal(normalized.duration, 0);

    const fallback = normalizePracticeRecord({
        id: 'score-info-record',
        scoreInfo: {
            percentage: -10,
            total: 20000,
            correct: 15000
        },
        duration: Number.MAX_VALUE
    });
    assert.equal(fallback.score, 0);
    assert.equal(fallback.totalQuestions, 10000);
    assert.equal(fallback.correctAnswers, 10000);
    assert.equal(fallback.duration, 365 * 24 * 60 * 60);

    assert.deepEqual(extractColumns(fallback), {
        sessionId: null,
        examId: null,
        type: null,
        title: null,
        score: 0,
        totalQuestions: 10000,
        correctAnswers: 10000,
        duration: 365 * 24 * 60 * 60
    });
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

        const missingUserId = '11111111-1111-4111-8111-111111111111';
        const missingUserRecords = await client.request('GET', `/api/admin/users/${missingUserId}/practice-records`);
        assert.equal(missingUserRecords.response.status, 404);
        assert.equal(missingUserRecords.json.error, 'User not found');

        const blockedDelete = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`, undefined, {
            csrf: false
        });
        assert.equal(blockedDelete.response.status, 403);

        const missingUserDelete = await client.request('DELETE', `/api/admin/users/${missingUserId}/practice-records/managed-record`);
        assert.equal(missingUserDelete.response.status, 404);
        assert.equal(missingUserDelete.json.error, 'User not found');

        const missingRecordDelete = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/missing-record`);
        assert.equal(missingRecordDelete.response.status, 404);
        assert.equal(missingRecordDelete.json.error, 'Record not found');

        const removed = await client.request('DELETE', `/api/admin/users/${managedUserId}/practice-records/managed-record`);
        assert.equal(removed.response.status, 200);
        assert.equal(removed.json.removed, 1);

        const afterDelete = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records`);
        assert.equal(afterDelete.json.records.length, 0);
    } finally {
        await client.close();
    }
});

test('admin routes require TOTP verification in the current session', async () => {
    const client = await createClient();
    try {
        const created = await register(client, 'stale_admin_session', 'StrongPass1');
        assert.equal(created.response.status, 201);
        const userId = created.json.user.id;
        const storedUser = client.authStore.users.get('stale_admin_session');
        storedUser.role = 'admin';
        await client.totpStore.saveEnabled(userId, 'not-needed-for-status-check', [], null);

        const blockedSummary = await client.request('GET', '/api/admin/summary');
        assert.equal(blockedSummary.response.status, 403);
        assert.equal(blockedSummary.json.error, 'Admin TOTP verification required');

        const blockedAdminPage = await client.request('GET', '/admin');
        assert.equal(blockedAdminPage.response.status, 403);
        assert.match(blockedAdminPage.text, /Admin TOTP verification required/);
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

        const invalidUsersQuery = await client.request('GET', '/api/admin/users?limit=0');
        assert.equal(invalidUsersQuery.response.status, 400);
        assert.equal(invalidUsersQuery.json.error, 'Invalid list query');
        assert(invalidUsersQuery.json.details.fieldErrors.limit.length >= 1);

        const longUsersQuery = await client.request('GET', `/api/admin/users?q=${'x'.repeat(81)}`);
        assert.equal(longUsersQuery.response.status, 400);
        assert.equal(longUsersQuery.json.error, 'Invalid list query');
        assert(longUsersQuery.json.details.fieldErrors.q.length >= 1);

        const wildcardUsersQuery = await client.request('GET', '/api/admin/users?q=%25');
        assert.equal(wildcardUsersQuery.response.status, 200);
        assert.equal(wildcardUsersQuery.json.total, 0);
        assert.equal(wildcardUsersQuery.json.users.length, 0);

        const invalidRecordsQuery = await client.request('GET', `/api/admin/users/${managedUserId}/practice-records?offset=-1`);
        assert.equal(invalidRecordsQuery.response.status, 400);
        assert.equal(invalidRecordsQuery.json.error, 'Invalid list query');
        assert(invalidRecordsQuery.json.details.fieldErrors.offset.length >= 1);

        const invalidTrafficQuery = await client.request('GET', '/api/admin/traffic?days=0');
        assert.equal(invalidTrafficQuery.response.status, 400);
        assert.equal(invalidTrafficQuery.json.error, 'Invalid traffic query');
        assert(invalidTrafficQuery.json.details.fieldErrors.days.length >= 1);

        const invalidAnalyticsQuery = await client.request('GET', '/api/admin/analytics?limit=many');
        assert.equal(invalidAnalyticsQuery.response.status, 400);
        assert.equal(invalidAnalyticsQuery.json.error, 'Invalid analytics query');
        assert(invalidAnalyticsQuery.json.details.fieldErrors.limit.length >= 1);

        const invalidUserId = await client.request('GET', '/api/admin/users/not-a-uuid/stats');
        assert.equal(invalidUserId.response.status, 400);
        assert.equal(invalidUserId.json.error, 'Invalid user id');

        const invalidRecordId = await client.request(
            'DELETE',
            `/api/admin/users/${managedUserId}/practice-records/${'x'.repeat(600)}`
        );
        assert.equal(invalidRecordId.response.status, 400);
        assert.equal(invalidRecordId.json.error, 'Invalid record id');

        const realDeleteUser = client.adminStore.deleteUser.bind(client.adminStore);
        client.adminStore.deleteUser = async () => null;
        const staleDelete = await client.request('DELETE', `/api/admin/users/${added.json.user.id}`);
        assert.equal(staleDelete.response.status, 404);
        assert.equal(staleDelete.json.error, 'User not found');
        client.adminStore.deleteUser = realDeleteUser;

        const deleted = await client.request('DELETE', `/api/admin/users/${added.json.user.id}`);
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);
    } finally {
        await client.close();
    }
});

test('admin user deletion clears target TOTP state in memory store', async () => {
    const client = await createClient();
    try {
        const targetSession = client.createSession();
        const createdTarget = await register(targetSession, 'delete_totp_user', 'StrongPass1');
        assert.equal(createdTarget.response.status, 201);
        const targetUserId = createdTarget.json.user.id;
        await enableTotpForCurrentSession(targetSession);
        const beforeDelete = await client.totpStore.getStatus(targetUserId);
        assert.equal(beforeDelete.enabled, true);
        assert.equal(beforeDelete.recoveryCodesRemaining, 10);

        await targetSession.request('POST', '/api/auth/logout');

        await seedAdmin(client, 'delete_totp_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'delete_totp_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const deleted = await adminSession.request('DELETE', `/api/admin/users/${targetUserId}`);
        assert.equal(deleted.response.status, 200);
        assert.equal(deleted.json.deleted, true);

        const afterDelete = await client.totpStore.getStatus(targetUserId);
        assert.equal(afterDelete.enabled, false);
        assert.equal(afterDelete.recoveryCodesRemaining, 0);
    } finally {
        await client.close();
    }
});

test('traffic middleware truncates untrusted request metadata', async () => {
    const client = await createClient();
    try {
        await client.csrf();
        const longPath = `/${'x'.repeat(1000)}?token=secret#fragment`;
        const longHeader = 'h'.repeat(1000);
        const response = await client.request('GET', longPath, undefined, {
            headers: {
                'user-agent': longHeader,
                referer: `https://example.test/${longHeader}?token=secret#fragment`
            }
        });
        assert.equal(response.response.status, 404);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const event = client.adminStore.trafficEvents.find((entry) => entry.path.startsWith('/xxx'));
        assert(event);
        assert.equal(event.path.length, 300);
        assert.equal(event.method, 'GET');
        assert.equal(event.routeGroup, 'page');
        assert.match(event.sessionId, /^[a-f0-9]{64}$/);
        assert.equal(event.userAgent.length, 500);
        assert.equal(event.referrer, 'https://example.test');
        assert(!event.path.includes('token=secret'));
        assert(!event.referrer.includes('token=secret'));
        assert(!event.referrer.includes(longHeader.slice(0, 20)));

        const normalized = normalizeTrafficEvent({
            method: 'po\nst',
            path: '/admin/\u0000users\r\nlist?token=secret',
            routeGroup: 'pa\tge',
            userAgent: 'Mozilla\r\nInjected: yes',
            referrer: 'not a url\r\nwith controls'
        });
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.method));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.path));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.routeGroup));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.userAgent));
        assert(!/[\u0000-\u001F\u007F]/.test(normalized.referrer));
        assert.equal(normalized.referrer, '/');

        assert.equal(normalizeTrafficEvent({ path: 'admin/users?token=secret' }).path, '/admin/users');
        assert.equal(normalizeTrafficEvent({ path: 'javascript:alert(1)' }).path, '/alert(1)');
        assert.equal(normalizeTrafficEvent({ path: 'https://example.test/admin?token=secret' }).path, '/admin');
        assert.equal(normalizeTrafficEvent({ path: '\r\n' }).path, '/');
    } finally {
        await client.close();
    }
});

test('Postgres traffic recent events respect the selected day window', async () => {
    const queries = [];
    const db = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            return { rows: [] };
        }
    };
    const store = new PostgresAdminStore(db);

    const traffic = await store.trafficSummary({ days: 3, limit: 7 });

    assert.equal(traffic.days, 3);
    const recent = queries.find((entry) => entry.text.startsWith('SELECT occurred_at, method, path'));
    assert(recent, 'recent traffic query was not executed');
    assert(recent.text.includes("WHERE occurred_at >= now() - ($1::int * interval '1 day')"));
    assert(recent.text.includes('LIMIT $2'));
    assert.deepEqual(recent.params, [3, 7]);
});

test('memory traffic store caps retained events', async () => {
    const client = await createClient();
    client.adminStore.maxTrafficEvents = 3;
    try {
        for (let index = 0; index < 5; index += 1) {
            await client.adminStore.recordTraffic({
                method: 'GET',
                path: `/event-${index}`,
                statusCode: 200,
                durationMs: 1
            });
        }
        assert.equal(client.adminStore.trafficEvents.length, 3);
        assert.deepEqual(
            client.adminStore.trafficEvents.map((event) => event.path),
            ['/event-2', '/event-3', '/event-4']
        );
    } finally {
        await client.close();
    }
});

test('admin user changes invalidate target sessions and stale admin roles', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'owner_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const ownerLogin = await adminSession.request('POST', '/api/auth/login', {
            username: 'owner_admin',
            password: 'StrongPass1'
        });
        assert.equal(ownerLogin.response.status, 200);
        assert.equal(ownerLogin.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const userSession = client.createSession();
        const createdUser = await register(userSession, 'reset_target', 'StrongPass1');
        assert.equal(createdUser.response.status, 201);
        const userRecords = await userSession.request('GET', '/api/practice-records');
        assert.equal(userRecords.response.status, 200);

        const resetPassword = await adminSession.request('PATCH', `/api/admin/users/${createdUser.json.user.id}`, {
            password: 'StrongerPass2'
        });
        assert.equal(resetPassword.response.status, 200);

        const staleUserSession = await userSession.request('GET', '/api/practice-records');
        assert.equal(staleUserSession.response.status, 401);

        const createdAdmin = await adminSession.request('POST', '/api/admin/users', {
            username: 'target_admin',
            password: 'StrongPass1',
            role: 'admin'
        });
        assert.equal(createdAdmin.response.status, 201);

        const targetAdminSession = client.createSession();
        await targetAdminSession.csrf();
        const targetLogin = await targetAdminSession.request('POST', '/api/auth/login', {
            username: 'target_admin',
            password: 'StrongPass1'
        });
        assert.equal(targetLogin.response.status, 200);
        assert.equal(targetLogin.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(targetAdminSession);

        const targetSummary = await targetAdminSession.request('GET', '/api/admin/summary');
        assert.equal(targetSummary.response.status, 200);

        const demoted = await adminSession.request('PATCH', `/api/admin/users/${createdAdmin.json.user.id}`, {
            role: 'user'
        });
        assert.equal(demoted.response.status, 200);
        assert.equal(demoted.json.user.role, 'user');

        const staleAdminSession = await targetAdminSession.request('GET', '/api/admin/summary');
        assert.equal(staleAdminSession.response.status, 401);
    } finally {
        await client.close();
    }
});

test('admin self password update rotates the current session', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'self_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        const enabled = await enableTotpForCurrentSession(adminSession);
        assert(enabled.sessionCookie);
        assert(enabled.csrfToken);

        const selfUpdate = await adminSession.request('PATCH', `/api/admin/users/${enabled.user.id}`, {
            password: 'StrongerPass2'
        });
        assert.equal(selfUpdate.response.status, 200);
        assert.equal(selfUpdate.json.user.id, enabled.user.id);
        assert.equal(selfUpdate.json.user.role, 'admin');
        assert(selfUpdate.json.csrfToken);
        assert.notEqual(selfUpdate.json.csrfToken, enabled.csrfToken);
        const rotatedCookie = getResponseSessionCookie(selfUpdate);
        assert(rotatedCookie);
        assert.notEqual(rotatedCookie, enabled.sessionCookie);

        const currentSummary = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(currentSummary.response.status, 200);

        const oldPasswordSession = client.createSession();
        await oldPasswordSession.csrf();
        const oldPasswordLogin = await oldPasswordSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongPass1'
        });
        assert.equal(oldPasswordLogin.response.status, 401);

        const newPasswordSession = client.createSession();
        await newPasswordSession.csrf();
        const newPasswordLogin = await newPasswordSession.request('POST', '/api/auth/login', {
            username: 'self_admin',
            password: 'StrongerPass2'
        });
        assert.equal(newPasswordLogin.response.status, 200);
        assert.equal(newPasswordLogin.json.requiresTotp, true);
    } finally {
        await client.close();
    }
});

test('admin account settings updates preserve current TOTP verification', async () => {
    const client = await createClient();
    try {
        await seedAdmin(client, 'account_admin', 'StrongPass1');
        const adminSession = client.createSession();
        await adminSession.csrf();
        const login = await adminSession.request('POST', '/api/auth/login', {
            username: 'account_admin',
            password: 'StrongPass1'
        });
        assert.equal(login.response.status, 200);
        assert.equal(login.json.requiresTotpSetup, true);
        await enableTotpForCurrentSession(adminSession);

        const beforeUpdate = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(beforeUpdate.response.status, 200);

        const rename = await adminSession.request('PATCH', '/api/auth/account/username', {
            username: 'account_admin_renamed',
            password: 'StrongPass1'
        });
        assert.equal(rename.response.status, 200);
        assert.equal(rename.json.user.username, 'account_admin_renamed');

        const afterRename = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(afterRename.response.status, 200);

        const passwordUpdate = await adminSession.request('PATCH', '/api/auth/account/password', {
            currentPassword: 'StrongPass1',
            newPassword: 'StrongerPass2'
        });
        assert.equal(passwordUpdate.response.status, 200);
        assert.equal(passwordUpdate.json.user.role, 'admin');

        const afterPasswordUpdate = await adminSession.request('GET', '/api/admin/summary');
        assert.equal(afterPasswordUpdate.response.status, 200);
    } finally {
        await client.close();
    }
});

test('migration runner serializes migrations with a PostgreSQL advisory lock', async () => {
    const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-migrations-'));
    fs.writeFileSync(path.join(migrationsDir, '001_first.sql'), 'SELECT 1;', 'utf8');
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text.includes('SELECT filename FROM schema_migrations')) {
                return { rows: [] };
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const db = {
        async withClient(handler) {
            return handler(client);
        }
    };

    const result = await runMigrations(db, { migrationsDir });

    assert.deepEqual(result.applied, ['001_first.sql']);
    assert.equal(result.total, 1);
    const texts = queries.map((item) => item.text);
    const lockIndex = texts.findIndex((text) => text.includes('pg_advisory_lock'));
    const unlockIndex = texts.findIndex((text) => text.includes('pg_advisory_unlock'));
    const beginIndex = texts.indexOf('BEGIN');
    const migrationIndex = texts.indexOf('SELECT 1;');
    const commitIndex = texts.indexOf('COMMIT');

    assert(lockIndex >= 0, 'migration lock was not acquired');
    assert(unlockIndex > lockIndex, 'migration lock was not released after acquisition');
    assert(beginIndex > lockIndex, 'migration transaction started before advisory lock');
    assert(migrationIndex > beginIndex, 'migration SQL did not run inside the transaction');
    assert(commitIndex > migrationIndex && commitIndex < unlockIndex);
});

test('migration runner releases the advisory lock after migration failure', async () => {
    const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-migrations-'));
    fs.writeFileSync(path.join(migrationsDir, '001_fail.sql'), 'SELECT fail;', 'utf8');
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (text.includes('SELECT filename FROM schema_migrations')) {
                return { rows: [] };
            }
            if (text === 'SELECT fail;') {
                throw new Error('migration failure');
            }
            return { rows: [], rowCount: 1 };
        }
    };
    const db = {
        async withClient(handler) {
            return handler(client);
        }
    };

    await assert.rejects(
        () => runMigrations(db, { migrationsDir }),
        /migration failure/
    );

    const texts = queries.map((item) => item.text);
    const rollbackIndex = texts.indexOf('ROLLBACK');
    const unlockIndex = texts.findIndex((text) => text.includes('pg_advisory_unlock'));
    assert(rollbackIndex >= 0, 'failed migration did not roll back');
    assert(unlockIndex > rollbackIndex, 'migration lock was not released after rollback');
    assert.equal(texts.includes('COMMIT'), false);
});

test('bootstrap admin creates and updates an admin user', async () => {
    const users = new Map();
    let totpDeletes = 0;
    let sessionDeletes = 0;
    const db = {
        async query(sql, params = []) {
            if (sql.includes('SELECT id, password_hash, role FROM users')) {
                const user = users.get(params[0]);
                return { rows: user ? [{ id: user.id, password_hash: user.password_hash, role: user.role }] : [] };
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
            if (sql.includes('DELETE FROM "session"')) {
                sessionDeletes += 1;
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`unexpected query: ${sql}`);
        }
    };
    const bcryptStub = {
        async hash(password) {
            return `hash:${password}`;
        },
        async compare(password, hash) {
            return hash === `hash:${password}`;
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
    assert.equal(updated.sessionsDeleted, 1);

    const unchanged = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongerPass2',
        bcrypt: bcryptStub
    });
    assert.equal(unchanged.created, false);
    assert.equal(unchanged.sessionsDeleted, 0);
    assert.equal(sessionDeletes, 1);

    const reset = await bootstrapAdmin({
        db,
        username: 'AdminUser',
        password: 'StrongestPass3',
        bcrypt: bcryptStub,
        resetTotp: true
    });
    assert.equal(reset.totpReset, true);
    assert.equal(totpDeletes, 2);
    assert.equal(reset.sessionsDeleted, 1);
    assert.equal(sessionDeletes, 2);
});

test('static hosting serves index and denies dotfiles with security headers', async (t) => {
    const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ielts-static-'));
    const outsideSecretPath = path.join(os.tmpdir(), `ielts-outside-secret-${path.basename(staticRoot)}.txt`);
    fs.mkdirSync(path.join(staticRoot, '.git'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'backend', 'src'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'js', 'bundles'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'templates'), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, 'ListeningPractice', 'P1'), { recursive: true });
    fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>IELTS Atlas</title>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'backend', 'src', 'app.js'), 'function createApp() {}\n', 'utf8');
    fs.writeFileSync(outsideSecretPath, 'outside secret\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'js', 'bundles', 'core-foundation.bundle.js'), 'Generated by scripts/build-bundles.mjs\n', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'templates', 'legacy.html'), '<!doctype html><script>window.ok=true</script>', 'utf8');
    fs.writeFileSync(path.join(staticRoot, 'ListeningPractice', 'P1', 'sample.html'), '<!doctype html><title>Listening Sample</title>', 'utf8');

    const client = await createClient({ staticRoot });
    try {
        const home = await client.request('GET', '/');
        assert.equal(home.response.status, 200);
        assert.match(home.text, /<title>IELTS Atlas<\/title>/);
        assert.equal(home.response.headers.get('x-content-type-options'), 'nosniff');
        const homeCsp = home.response.headers.get('content-security-policy') || '';
        assert.match(homeCsp, /default-src 'self'/);
        assert.match(homeCsp, /script-src 'self'(?:;|$)/);
        assert.match(homeCsp, /script-src-attr 'none'/);
        assert.match(homeCsp, /object-src 'none'/);
        assert.match(homeCsp, /frame-ancestors 'self'/);
        assert.doesNotMatch(homeCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(home.response.headers.get('permissions-policy') || '', /camera=\(\)/);

        const dotfile = await client.request('GET', '/.git/config');
        assert.notEqual(dotfile.response.status, 200);
        assert.doesNotMatch(dotfile.text, /\[core\]/);

        const backendSource = await client.request('GET', '/backend/src/app.js');
        assert.notEqual(backendSource.response.status, 200);
        assert.doesNotMatch(backendSource.text, /createApp/);

        let symlinkCreated = false;
        try {
            fs.symlinkSync(outsideSecretPath, path.join(staticRoot, 'assets', 'linked-secret.txt'));
            symlinkCreated = true;
        } catch (error) {
            t.diagnostic(`skipping symlink boundary assertion: ${error.message}`);
        }
        if (symlinkCreated) {
            const linkedSecret = await client.request('GET', '/assets/linked-secret.txt');
            assert.equal(linkedSecret.response.status, 403);
            assert.doesNotMatch(linkedSecret.text, /outside secret/);
        }

        const bundle = await client.request('GET', '/js/bundles/core-foundation.bundle.js');
        assert.equal(bundle.response.status, 200);
        assert.match(bundle.text, /Generated by scripts\/build-bundles\.mjs/);

        const listening = await client.request('GET', '/ListeningPractice/P1/sample.html');
        assert.equal(listening.response.status, 200);
        assert.match(listening.text, /Listening Sample/);
        const listeningCsp = listening.response.headers.get('content-security-policy') || '';
        assert.match(listeningCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(listeningCsp, /connect-src 'none'/);
        assert.match(listeningCsp, /form-action 'none'/);
        assert.match(listeningCsp, /base-uri 'none'/);
        assert.match(listeningCsp, /frame-src 'none'/);
        assert.match(listeningCsp, /child-src 'none'/);
        assert.match(listeningCsp, /sandbox allow-scripts allow-downloads/);
        assert.doesNotMatch(listeningCsp, /allow-same-origin/);

        const legacyTemplate = await client.request('GET', '/templates/legacy.html');
        assert.equal(legacyTemplate.response.status, 200);
        const templateCsp = legacyTemplate.response.headers.get('content-security-policy') || '';
        assert.match(templateCsp, /script-src 'self' 'unsafe-inline'/);
        assert.match(templateCsp, /connect-src 'self'/);
        assert.doesNotMatch(templateCsp, /sandbox/);
    } finally {
        await client.close();
        fs.rmSync(staticRoot, { recursive: true, force: true });
        fs.rmSync(outsideSecretPath, { force: true });
    }
});
