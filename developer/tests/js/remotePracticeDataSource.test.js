#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createContext() {
    const windowStub = {
        ExamData: {
            cloneValue(value) {
                return value == null ? value : JSON.parse(JSON.stringify(value));
            }
        },
        console: { log() {}, warn() {}, error() {}, info() {} },
        dispatchEvent() {},
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };
    const context = vm.createContext({
        window: windowStub,
        console: windowStub.console,
        JSON,
        Map,
        Promise,
        Error
    });
    loadScript('js/data/dataSources/remotePracticeDataSource.js', context);
    return { context, window: windowStub };
}

function createRemoteApiContext(fetchImpl) {
    const windowStub = {
        ExamData: {},
        fetch: fetchImpl,
        console: { log() {}, warn() {}, error() {}, info() {} }
    };
    const context = vm.createContext({
        window: windowStub,
        console: windowStub.console,
        JSON,
        Promise,
        Error
    });
    loadScript('js/data/remoteApiClient.js', context);
    return { context, window: windowStub };
}

function createClassList(initial = '') {
    const values = new Set(String(initial).split(/\s+/).filter(Boolean));
    return {
        contains(value) {
            return values.has(value);
        },
        toggle(value, force) {
            if (force) values.add(value);
            else values.delete(value);
        }
    };
}

function createElementStub(className = '') {
    const attrs = new Map();
    return {
        id: '',
        inert: false,
        classList: createClassList(className),
        getAttribute(name) {
            return attrs.has(name) ? attrs.get(name) : null;
        },
        setAttribute(name, value) {
            attrs.set(name, String(value));
        },
        removeAttribute(name) {
            attrs.delete(name);
        }
    };
}

function createLocalDataSource(initial = {}) {
    const state = new Map(Object.entries(initial));
    const calls = [];
    return {
        state,
        calls,
        async read(key, defaultValue) {
            calls.push(['read', key]);
            return state.has(key) ? state.get(key) : defaultValue;
        },
        async write(key, value) {
            calls.push(['write', key, value]);
            state.set(key, value);
            return true;
        },
        async remove(key) {
            calls.push(['remove', key]);
            state.delete(key);
            return true;
        }
    };
}

async function testPracticeRecordsUseRemoteAndMirrorLocal() {
    const { window } = createContext();
    const local = createLocalDataSource({ settings: { theme: 'light' } });
    const remoteRecords = [{ id: 'remote-1', type: 'reading', score: 90, date: '2026-01-01T00:00:00.000Z' }];
    const apiCalls = [];
    const apiClient = {
        user: { id: 'user-1' },
        isAuthenticated() {
            return true;
        },
        async listPracticeRecords() {
            apiCalls.push(['list']);
            return remoteRecords;
        },
        async replacePracticeRecords(records) {
            apiCalls.push(['replace', records]);
            return records;
        }
    };

    const dataSource = new window.ExamData.RemotePracticeDataSource(local, apiClient);
    assert.deepStrictEqual(await dataSource.read('practice_records', []), remoteRecords);
    assert.deepStrictEqual(local.state.get('practice_records'), remoteRecords);

    await dataSource.write('settings', { theme: 'dark' });
    assert.deepStrictEqual(apiCalls, [['list']]);
    assert.deepStrictEqual(local.state.get('settings'), { theme: 'dark' });

    const replacement = [{ id: 'remote-2', type: 'listening', score: 70, date: '2026-01-02T00:00:00.000Z' }];
    await dataSource.write('practice_records', replacement);
    assert.deepStrictEqual(apiCalls[1], ['replace', replacement]);
    assert.deepStrictEqual(local.state.get('practice_records'), replacement);
}

async function testUnauthorizedReadFallsBackToLocal() {
    const { window } = createContext();
    const fallbackRecords = [{ id: 'local-1', type: 'reading', score: 50, date: '2026-01-01T00:00:00.000Z' }];
    const local = createLocalDataSource({ practice_records: fallbackRecords });
    const apiClient = {
        user: { id: 'user-1' },
        csrfToken: 'csrf-old',
        pendingTotp: { requiresTotp: true },
        isAuthenticated() {
            return Boolean(this.user);
        },
        async listPracticeRecords() {
            const error = new Error('Authentication required');
            error.status = 401;
            throw error;
        }
    };

    const dataSource = new window.ExamData.RemotePracticeDataSource(local, apiClient);
    assert.deepStrictEqual(await dataSource.read('practice_records', []), fallbackRecords);
    assert.strictEqual(apiClient.user, null);
    assert.strictEqual(apiClient.csrfToken, null);
    assert.strictEqual(apiClient.pendingTotp, null);
}

async function testImportMarkersAreScopedByUserId() {
    const windowStub = {
        ExamData: {},
        localStorage: null
    };
    const context = vm.createContext({
        window: windowStub,
        console,
        JSON,
        Map,
        Promise
    });
    loadScript('js/data/authOverlay.js', context);

    const storage = new Map();
    const markerStore = windowStub.ExamData.createRemoteImportMarkerStore({
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        }
    });

    assert.notStrictEqual(
        windowStub.ExamData.getRemoteImportMarkerKey('user-a'),
        windowStub.ExamData.getRemoteImportMarkerKey('user-b')
    );
    assert.strictEqual(await markerStore.has('user-a'), false);
    await markerStore.mark('user-a');
    assert.strictEqual(await markerStore.has('user-a'), true);
    assert.strictEqual(await markerStore.has('user-b'), false);
}

async function testRemoteApiClientClearsAuthStateOnUnauthorized() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        return {
            status: 401,
            ok: false,
            async text() {
                return JSON.stringify({ error: 'Authentication required' });
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();
    client.user = { id: 'user-1', username: 'alice' };
    client.csrfToken = 'csrf-old';
    client.pendingTotp = { requiresTotp: true };

    await assert.rejects(
        () => client.request('/api/practice-records', { method: 'GET', csrf: false }),
        (error) => error && error.status === 401
    );
    assert.strictEqual(client.user, null);
    assert.strictEqual(client.csrfToken, null);
    assert.strictEqual(client.pendingTotp, null);
    assert.deepStrictEqual(fetchCalls[0][0], '/api/practice-records');
}

async function testRemoteApiClientClearsAuthStateOnMalformedAuthCheck() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        return {
            status: 200,
            ok: true,
            async text() {
                return JSON.stringify({ ok: true });
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();
    client.user = { id: 'user-1', username: 'alice' };
    client.csrfToken = 'csrf-old';
    client.pendingTotp = { requiresTotpSetup: true };

    const state = await client.getAuthState();

    assert.strictEqual(state.available, false);
    assert.strictEqual(state.authenticated, false);
    assert.strictEqual(state.user, null);
    assert.strictEqual(client.user, null);
    assert.strictEqual(client.csrfToken, null);
    assert.strictEqual(client.pendingTotp, null);
    assert.deepStrictEqual(fetchCalls[0][0], '/api/auth/me');
}

async function testRemoteApiClientTreatsUnauthorizedLogoutAsLocalLogout() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        if (url === '/api/auth/csrf') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ csrfToken: 'csrf-new' });
                }
            };
        }
        return {
            status: 401,
            ok: false,
            async text() {
                return JSON.stringify({ error: 'Authentication required' });
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();
    client.user = { id: 'user-1', username: 'alice' };
    client.csrfToken = 'csrf-old';
    client.pendingTotp = { requiresTotp: true };

    const payload = await client.logout();

    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.alreadyLoggedOut, true);
    assert.strictEqual(client.user, null);
    assert.strictEqual(client.csrfToken, null);
    assert.strictEqual(client.pendingTotp, null);
    assert.deepStrictEqual(fetchCalls.map(([url]) => url), ['/api/auth/logout']);
    assert.strictEqual(fetchCalls[0][1].headers['X-CSRF-Token'], 'csrf-old');
}

async function testRemoteApiClientAddsCsrfToWrites() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        if (url === '/api/auth/csrf') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ csrfToken: 'csrf-new' });
                }
            };
        }
        return {
            status: 200,
            ok: true,
            async text() {
                return JSON.stringify({ records: [] });
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();
    await client.replacePracticeRecords([{ id: 'record-1' }]);

    assert.deepStrictEqual(fetchCalls.map(([url]) => url), ['/api/auth/csrf', '/api/practice-records']);
    assert.strictEqual(fetchCalls[1][1].headers['X-CSRF-Token'], 'csrf-new');
    assert.strictEqual(fetchCalls[1][1].credentials, 'same-origin');
}

async function testRemoteApiClientRejectsMalformedCsrfResponse() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        return {
            status: 200,
            ok: true,
            async text() {
                return JSON.stringify({});
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();

    await assert.rejects(
        () => client.replacePracticeRecords([{ id: 'record-1' }]),
        (error) => error && error.name === 'RemoteApiError' && /CSRF token response is invalid/.test(error.message)
    );
    assert.deepStrictEqual(fetchCalls.map(([url]) => url), ['/api/auth/csrf']);
    assert.strictEqual(client.csrfToken, null);
}

async function testRemoteApiClientIgnoresMalformedCsrfFieldsOnAuthResponses() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        if (url === '/api/auth/login') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ requiresTotp: true, csrfToken: { bad: 'token' } });
                }
            };
        }
        if (url === '/api/auth/totp/login') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        user: { id: 'user-1', username: 'alice' },
                        csrfToken: ['bad-token']
                    });
                }
            };
        }
        if (url === '/api/auth/me') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        user: { id: 'user-1', username: 'alice' },
                        csrfToken: 12345
                    });
                }
            };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    const client = new window.ExamData.RemoteApiClient();
    client.csrfToken = 'csrf-existing';

    await client.login('alice', 'StrongPass1');
    assert.strictEqual(client.csrfToken, 'csrf-existing');
    assert.strictEqual(client.pendingTotp.requiresTotp, true);
    assert.strictEqual(fetchCalls[0][1].headers['X-CSRF-Token'], 'csrf-existing');

    await client.completeTotpLogin('123456');
    assert.strictEqual(client.csrfToken, 'csrf-existing');
    assert.strictEqual(client.user.username, 'alice');
    assert.strictEqual(fetchCalls[1][1].headers['X-CSRF-Token'], 'csrf-existing');

    const state = await client.getAuthState();
    assert.strictEqual(state.authenticated, true);
    assert.strictEqual(client.csrfToken, 'csrf-existing');
}

async function testRemoteApiClientClearsInvalidCsrfTokenOnly() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        if (url === '/api/auth/csrf') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ csrfToken: 'csrf-new' });
                }
            };
        }
        if (fetchCalls.filter(([path]) => path === '/api/practice-records').length === 1) {
            return {
                status: 403,
                ok: false,
                async text() {
                    return JSON.stringify({ error: 'CSRF token invalid' });
                }
            };
        }
        return {
            status: 200,
            ok: true,
            async text() {
                return JSON.stringify({ records: [] });
            }
        };
    });
    const client = new window.ExamData.RemoteApiClient();
    client.user = { id: 'user-1', username: 'alice' };
    client.csrfToken = 'csrf-stale';
    client.pendingTotp = { requiresTotp: true };

    await assert.rejects(
        () => client.replacePracticeRecords([{ id: 'record-1' }]),
        (error) => error && error.status === 403
    );
    assert.deepStrictEqual(client.user, { id: 'user-1', username: 'alice' });
    assert.strictEqual(client.pendingTotp.requiresTotp, true);
    assert.strictEqual(client.csrfToken, null);

    await client.replacePracticeRecords([{ id: 'record-2' }]);
    assert.deepStrictEqual(fetchCalls.map(([url]) => url), [
        '/api/practice-records',
        '/api/auth/csrf',
        '/api/practice-records'
    ]);
    assert.strictEqual(fetchCalls[2][1].headers['X-CSRF-Token'], 'csrf-new');
}

async function testRemoteApiClientHandlesTotpFlow() {
    const fetchCalls = [];
    const { window } = createRemoteApiContext(async (url, options = {}) => {
        fetchCalls.push([url, options]);
        if (url === '/api/auth/csrf') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ csrfToken: 'csrf-totp' });
                }
            };
        }
        if (url === '/api/auth/login') {
            const body = JSON.parse(options.body);
            assert.strictEqual(body.username, 'alice');
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ requiresTotp: true, csrfToken: 'csrf-after-password' });
                }
            };
        }
        if (url === '/api/auth/totp/login') {
            const body = JSON.parse(options.body);
            assert.strictEqual(body.token, '123456');
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        user: { id: 'user-1', username: 'alice' },
                        csrfToken: 'csrf-after-login'
                    });
                }
            };
        }
        if (url === '/api/auth/totp/status') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ status: { enabled: true, recoveryCodesRemaining: 8 } });
                }
            };
        }
        if (url === '/api/auth/totp/setup') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        secret: 'ABC',
                        otpauthUrl: 'otpauth://totp/test',
                        qrCodeDataUrl: 'data:image/png;base64,AA=='
                    });
                }
            };
        }
        if (url === '/api/auth/totp/verify-setup') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        user: { id: 'user-1', username: 'alice' },
                        recoveryCodes: ['AAAA-BBBB'],
                        csrfToken: 'csrf-after-setup',
                        status: { enabled: true, recoveryCodesRemaining: 1 }
                    });
                }
            };
        }
        if (url === '/api/auth/totp/recovery-codes') {
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        recoveryCodes: ['CCCC-DDDD'],
                        status: { enabled: true, recoveryCodesRemaining: 1 }
                    });
                }
            };
        }
        if (url === '/api/auth/totp/disable') {
            const body = JSON.parse(options.body);
            assert.strictEqual(body.password, 'StrongPass1');
            assert.strictEqual(body.token, '123456');
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({
                        user: { id: 'user-1', username: 'alice' },
                        csrfToken: 'csrf-after-disable',
                        status: { enabled: false, recoveryCodesRemaining: 0 }
                    });
                }
            };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    const apiClient = new window.ExamData.RemoteApiClient();

    const passwordStep = await apiClient.login('alice', 'StrongPass1');
    assert.strictEqual(passwordStep.requiresTotp, true);
    assert.strictEqual(apiClient.user, null);
    assert.strictEqual(apiClient.pendingTotp.requiresTotp, true);
    assert.strictEqual(apiClient.csrfToken, 'csrf-after-password');

    const loggedIn = await apiClient.completeTotpLogin('123456');
    assert.strictEqual(loggedIn.user.username, 'alice');
    assert.strictEqual(apiClient.user.username, 'alice');
    assert.strictEqual(apiClient.csrfToken, 'csrf-after-login');
    assert.strictEqual(apiClient.pendingTotp, null);

    const status = await apiClient.getTotpStatus();
    assert.strictEqual(status.recoveryCodesRemaining, 8);
    const setup = await apiClient.startTotpSetup();
    assert.strictEqual(setup.secret, 'ABC');
    const verified = await apiClient.verifyTotpSetup('123456');
    assert.deepStrictEqual(verified.recoveryCodes, ['AAAA-BBBB']);
    assert.strictEqual(apiClient.csrfToken, 'csrf-after-setup');
    const regenerated = await apiClient.regenerateTotpRecoveryCodes();
    assert.deepStrictEqual(regenerated.recoveryCodes, ['CCCC-DDDD']);
    const disabled = await apiClient.disableTotp('StrongPass1', '123456');
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(apiClient.csrfToken, 'csrf-after-disable');
    assert.strictEqual(apiClient.user.username, 'alice');

    assert(fetchCalls.some(([url]) => url === '/api/auth/totp/login'));
    assert(fetchCalls.some(([url]) => url === '/api/auth/totp/verify-setup'));
}

async function testAuthGateLocksAndRestoresBackgroundElements() {
    const app = createElementStub('app-shell');
    const overlay = createElementStub('remote-auth-overlay');
    overlay.id = 'remote-auth-overlay';
    const body = createElementStub('');
    body.children = [app, overlay];
    const documentElement = createElementStub('');
    const windowStub = {
        ExamData: {},
        localStorage: null,
        document: {
            body,
            documentElement
        }
    };
    const context = vm.createContext({
        window: windowStub,
        console,
        JSON,
        Map,
        Promise
    });
    loadScript('js/data/authOverlay.js', context);

    windowStub.ExamData.setRemoteAuthGate(true);
    assert.strictEqual(app.inert, true);
    assert.strictEqual(app.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(overlay.inert, false);
    assert.strictEqual(body.classList.contains('remote-auth-gated'), true);

    windowStub.ExamData.setRemoteAuthGate(false);
    assert.strictEqual(app.inert, false);
    assert.strictEqual(app.getAttribute('aria-hidden'), null);
    assert.strictEqual(body.classList.contains('remote-auth-gated'), false);
}

async function testAuthOverlayValidationAndErrorFormatting() {
    const windowStub = {
        ExamData: {},
        localStorage: null
    };
    const context = vm.createContext({
        window: windowStub,
        console,
        JSON,
        Map,
        Promise
    });
    loadScript('js/data/authOverlay.js', context);

    const invalidUsername = windowStub.ExamData.validateRemoteAuthFields('a!', 'StrongPass1', 'login');
    assert.strictEqual(invalidUsername.valid, false);
    assert.match(invalidUsername.errors.join(' '), /用户名/);

    const weakRegister = windowStub.ExamData.validateRemoteAuthFields('valid_user', 'weak', 'register');
    assert.strictEqual(weakRegister.valid, false);
    assert(weakRegister.errors.length >= 3);

    assert.strictEqual(
        windowStub.ExamData.formatRemoteAuthError({ status: 429, message: 'Too many requests' }),
        '请求过于频繁，请稍后再试。'
    );
    assert.strictEqual(
        windowStub.ExamData.formatRemoteAuthError({ payload: { details: ['a', 'b'] } }),
        'a；b'
    );
    assert.strictEqual(
        windowStub.ExamData.formatRemoteAuthError({ message: 'SECRET_TOKEN_12345 <script>alert(1)</script>' }),
        'Authentication failed. Please retry.'
    );
    const longError = `bad\r\n${'x'.repeat(400)}`;
    const formattedLongError = windowStub.ExamData.formatRemoteAuthError({ payload: { error: longError } });
    assert(formattedLongError.length <= 240);
    assert(!/[\u0000-\u001F\u007F]/.test(formattedLongError));
    assert(formattedLongError.endsWith('...'));
}

async function main() {
    await testPracticeRecordsUseRemoteAndMirrorLocal();
    await testUnauthorizedReadFallsBackToLocal();
    await testImportMarkersAreScopedByUserId();
    await testRemoteApiClientClearsAuthStateOnUnauthorized();
    await testRemoteApiClientClearsAuthStateOnMalformedAuthCheck();
    await testRemoteApiClientTreatsUnauthorizedLogoutAsLocalLogout();
    await testRemoteApiClientAddsCsrfToWrites();
    await testRemoteApiClientRejectsMalformedCsrfResponse();
    await testRemoteApiClientIgnoresMalformedCsrfFieldsOnAuthResponses();
    await testRemoteApiClientClearsInvalidCsrfTokenOnly();
    await testRemoteApiClientHandlesTotpFlow();
    await testAuthGateLocksAndRestoresBackgroundElements();
    await testAuthOverlayValidationAndErrorFormatting();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'remote practice data source tests passed'
    }, null, 2));
}

main().catch((error) => {
    console.log(JSON.stringify({
        status: 'fail',
        detail: error.message
    }, null, 2));
    process.exit(1);
});
