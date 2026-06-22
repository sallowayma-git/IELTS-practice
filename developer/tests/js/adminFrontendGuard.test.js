#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'backend/admin/admin.js'), 'utf8');

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    toggle(name, active) {
        if (active) {
            this.values.add(name);
        } else {
            this.values.delete(name);
        }
    }

    contains(name) {
        return this.values.has(name);
    }
}

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.textContent = '';
        this.hidden = false;
        this.disabled = false;
        this.dataset = {};
        this.classList = new FakeClassList();
        this.children = [];
        this.listeners = new Map();
    }

    append(...children) {
        this.children.push(...children);
    }

    addEventListener(type, callback) {
        this.listeners.set(type, callback);
    }

    focus() {
        this.focused = true;
    }

    setAttribute(name, value) {
        this[name] = String(value);
    }
}

const elements = new Map();
const documentStub = {
    getElementById(id) {
        if (!elements.has(id)) {
            elements.set(id, new FakeElement(id));
        }
        return elements.get(id);
    },
    createElement(tag) {
        return new FakeElement(tag);
    },
    createElementNS(namespace, tag) {
        const element = new FakeElement(tag);
        element.namespaceURI = namespace;
        return element;
    },
    addEventListener() {},
    body: new FakeElement('body')
};

const windowStub = {
    __IELTS_ADMIN_TEST__: true,
    location: { href: 'http://127.0.0.1:3000/admin' },
    setTimeout() {},
    clearTimeout() {},
    document: documentStub
};
let fetchImpl = () => {
    throw new Error('fetch should not be called in this test');
};
const hostJson = globalThis.JSON;
let oversizedAdminResponseParsed = false;

const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    console: { log() {}, warn() {}, error() {} },
    JSON: {
        parse(value, reviver) {
            if (String(value).length > 1024 * 1024) {
                oversizedAdminResponseParsed = true;
            }
            return hostJson.parse(value, reviver);
        },
        stringify(value, replacer, space) {
            return hostJson.stringify(value, replacer, space);
        }
    },
    URLSearchParams,
    fetch(...args) {
        return fetchImpl(...args);
    }
});
vm.runInContext(source, context, { filename: 'backend/admin/admin.js' });

const hooks = windowStub.__IELTS_ADMIN_TEST_HOOKS__;
assert(hooks, 'admin test hooks should be available');
assert.equal(typeof hooks.confirmAction, 'function');
assert.equal(typeof hooks.closeConfirm, 'function');
assert.equal(typeof hooks.parseAdminResponseJson, 'function');
assert.equal(typeof hooks.sanitizeStatusMessage, 'function');

{
    assert.deepEqual(hooks.parseAdminResponseJson('{"ok":true}'), { ok: true });
    const oversized = `{"data":"${'x'.repeat(1024 * 1024 + 1)}"}`;
    assert.equal(hooks.parseAdminResponseJson(oversized), null);
    assert.equal(oversizedAdminResponseParsed, false, 'oversized admin API responses must be rejected before JSON.parse');
}

{
    const sanitized = hooks.sanitizeStatusMessage(
        'Request failed token=abc123 password:SecretPass1 Authorization: Bearer abc.def.ghi Basic dXNlcjpwYXNz https://example.test/cb?csrfToken=csrf-secret&keep=1'
    );
    assert(!sanitized.includes('abc123'));
    assert(!sanitized.includes('SecretPass1'));
    assert(!sanitized.includes('abc.def.ghi'));
    assert(!sanitized.includes('dXNlcjpwYXNz'));
    assert(!sanitized.includes('csrf-secret'));
    assert(sanitized.includes('token=[redacted]'));
    assert(sanitized.includes('password=[redacted]'));
    assert(sanitized.includes('Bearer [redacted]'));
    assert(sanitized.includes('Basic [redacted]'));
    assert(sanitized.includes('csrfToken=[redacted]'));
}

const first = hooks.confirmAction({
    title: 'Delete old',
    message: 'First confirm',
    confirmText: 'Delete'
});
assert.equal(elements.get('confirm-dialog').hidden, false);
assert.equal(elements.get('confirm-title').textContent, 'Delete old');

const second = hooks.confirmAction({
    title: 'Delete new',
    message: 'Second confirm',
    confirmText: 'Delete now',
    kind: 'normal'
});

assert.equal(await first, false, 'opening a second confirmation must cancel the first pending action');
assert.equal(elements.get('confirm-title').textContent, 'Delete new');
assert.equal(elements.get('confirm-submit').classList.contains('delete-button'), false);

hooks.closeConfirm(true);
assert.equal(await second, true);
assert.equal(elements.get('confirm-dialog').hidden, true);
assert.equal(hooks.state.confirmResolver, null);

assert(
    source.includes('if (state.confirmResolver)') &&
    source.includes('state.confirmResolver(false);') &&
    source.includes('confirmAction') &&
    source.includes('closeConfirm'),
    'admin confirm dialog must cancel any previous unresolved confirmation before opening a new one'
);

{
    const shared = { label: 'shared' };
    const rendered = JSON.parse(hooks.safeStringifyRecordPayload({
        first: shared,
        second: shared,
        list: [shared]
    }));
    assert.deepEqual(rendered.first, { label: 'shared' });
    assert.deepEqual(rendered.second, { label: 'shared' });
    assert.deepEqual(rendered.list[0], { label: 'shared' });

    const circular = { id: 'cycle' };
    circular.self = circular;
    const circularRendered = JSON.parse(hooks.safeStringifyRecordPayload(circular));
    assert.equal(circularRendered.self, '[Circular]');
}

function jsonResponse(payload) {
    return {
        status: 200,
        ok: true,
        async text() {
            return JSON.stringify(payload);
        }
    };
}

function createDeferredResponse(payload) {
    let resolve;
    const promise = new Promise((done) => {
        resolve = () => done(jsonResponse(payload));
    });
    return { promise, resolve };
}

{
    const stale = createDeferredResponse({
        records: [{ id: 'record-a', title: 'Alice stale record', updatedAt: '2026-01-01T00:00:00Z' }],
        total: 1
    });
    fetchImpl = async (url) => {
        if (String(url).includes('/user-a/practice-records')) {
            return stale.promise;
        }
        if (String(url).includes('/user-b/practice-records')) {
            return jsonResponse({
                records: [{ id: 'record-b', title: 'Bob current record', updatedAt: '2026-01-02T00:00:00Z' }],
                total: 1
            });
        }
        throw new Error(`unexpected fetch: ${url}`);
    };

    hooks.state.selectedUser = { id: 'user-a', username: 'Alice' };
    const firstLoad = hooks.loadRecords('user-a', 'Alice');
    await Promise.resolve();
    hooks.state.selectedUser = { id: 'user-b', username: 'Bob' };
    await hooks.loadRecords('user-b', 'Bob');
    assert.equal(elements.get('records-title').textContent, 'Bob Records');
    assert.equal(hooks.state.records.loading, false);

    stale.resolve();
    await firstLoad;
    assert.equal(elements.get('records-title').textContent, 'Bob Records');
    assert.equal(hooks.state.records.loading, false);
}

{
    const stale = createDeferredResponse({
        user: { id: 'user-a', username: 'Alice' },
        recordCount: 5,
        averageScore: 90,
        totalStudyMinutes: 120,
        latestRecordAt: '2026-01-01T00:00:00Z',
        byType: []
    });
    fetchImpl = async (url) => {
        if (String(url).includes('/user-a/stats')) {
            return stale.promise;
        }
        if (String(url).includes('/user-b/stats')) {
            return jsonResponse({
                user: { id: 'user-b', username: 'Bob' },
                recordCount: 1,
                averageScore: 80,
                totalStudyMinutes: 30,
                latestRecordAt: '2026-01-02T00:00:00Z',
                byType: []
            });
        }
        throw new Error(`unexpected fetch: ${url}`);
    };

    hooks.state.selectedUser = { id: 'user-a', username: 'Alice' };
    const firstLoad = hooks.loadUserStats('user-a');
    await Promise.resolve();
    hooks.state.selectedUser = { id: 'user-b', username: 'Bob' };
    await hooks.loadUserStats('user-b');
    assert.equal(elements.get('user-stats-title').textContent, 'Bob');
    assert.equal(elements.get('user-stat-records').textContent, '1');

    stale.resolve();
    await firstLoad;
    assert.equal(elements.get('user-stats-title').textContent, 'Bob');
    assert.equal(elements.get('user-stat-records').textContent, '1');
}

assert(
    source.includes('function isSelectedUser(userId)') &&
    source.includes('state.records.requestId !== requestId || !isSelectedUser(userId)') &&
    source.includes('state.userStatsRequestId !== requestId || !isSelectedUser(userId)') &&
    source.includes('const selectedUser = state.selectedUser;') &&
    source.includes('const userId = selectedUser.id;'),
    'admin async user/record refreshes must ignore stale responses and snapshot selected users for mutations'
);

console.log('adminFrontendGuard.test.js passed');
