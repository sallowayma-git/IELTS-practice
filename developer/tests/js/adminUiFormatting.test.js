import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAdminHooks(options = {}) {
    const document = {
        getElementById() {
            return null;
        }
    };
    const windowStub = {
        __IELTS_ADMIN_TEST__: true,
        location: { href: '' },
        document
    };
    const context = vm.createContext({
        window: windowStub,
        document,
        fetch: options.fetch,
        console,
        Intl,
        Number,
        Date,
        Math,
        JSON
    });
    const source = fs.readFileSync(path.resolve(__dirname, '../../..', 'backend/admin/admin.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'backend/admin/admin.js' });
    assert(windowStub.__IELTS_ADMIN_TEST_HOOKS__, 'admin test hooks should be exposed in test mode');
    return windowStub.__IELTS_ADMIN_TEST_HOOKS__;
}

function readAdminSource() {
    return fs.readFileSync(path.resolve(__dirname, '../../..', 'backend/admin/admin.js'), 'utf8');
}

function testAdminScoreFormattingRejectsInvalidNumbers() {
    const hooks = loadAdminHooks();

    assert.equal(hooks.formatScoreValue(null), '-');
    assert.equal(hooks.formatScoreValue(''), '-');
    assert.equal(hooks.formatScoreValue('not-a-number'), '-');
    assert.equal(hooks.formatScoreValue(Infinity), '-');
    assert.equal(hooks.formatScoreValue(87.25), '87.3%');
}

function testAdminRecordScoreFormattingRejectsInvalidNumbers() {
    const hooks = loadAdminHooks();

    assert.equal(hooks.formatScore({ score: 'bad', totalQuestions: 40 }), '-');
    assert.equal(hooks.formatScore({ score: 31.24, totalQuestions: 40.2 }), '31.2 / 40');
    assert.equal(hooks.formatScore({ score: '7.5', totalQuestions: null }), '7.5');
}

function testAdminRecordPayloadFormattingIsSafeAndBounded() {
    const hooks = loadAdminHooks();
    const circular = {
        id: 'record-1',
        score: 10n,
        nested: {
            ok: true,
            constructor: 'drop-me'
        }
    };
    Object.defineProperty(circular, '__proto__', {
        enumerable: true,
        value: 'drop-me'
    });
    circular.self = circular;

    const text = hooks.safeStringifyRecordPayload(circular);
    assert.match(text, /"\[Circular\]"/);
    assert.match(text, /"score": "10"/);
    assert(!text.includes('drop-me'), 'unsafe prototype-related keys should not be rendered');

    const longText = hooks.safeStringifyRecordPayload({ text: 'a'.repeat(30000) });
    assert(longText.length <= 20020, 'record payload detail output should be capped');
    assert(longText.endsWith('... truncated'), 'record payload detail output should mark truncation');
}

function testAdminRecordDeleteUsesSelectionSnapshot() {
    const source = readAdminSource();

    assert(
        source.includes('const selectedUser = state.selectedUser;') &&
        source.includes('const userId = selectedUser.id;') &&
        source.includes('const username = selectedUser.username;'),
        'record delete confirmation must capture the selected user before awaiting confirmation'
    );
    assert(
        source.includes('/practice-records/${encodeURIComponent(record.id)}') &&
        source.includes('/api/admin/users/${encodeURIComponent(userId)}'),
        'record delete requests must use the captured user id and encoded record id'
    );
    assert(
        source.includes('state.selectedUser && state.selectedUser.id === userId') &&
        source.includes('await loadRecords(userId, username);'),
        'record delete refresh must not overwrite a newly selected user'
    );
}

async function testAdminRequestStoresRotatedCsrfToken() {
    const fetchCalls = [];
    const hooks = loadAdminHooks({
        async fetch(path, options = {}) {
            fetchCalls.push({ path, options });
            return {
                status: 200,
                ok: true,
                async text() {
                    return JSON.stringify({ ok: true, csrfToken: 'csrf-new' });
                }
            };
        }
    });
    hooks.state.csrfToken = 'csrf-old';

    const payload = await hooks.request('/api/admin/users/user-1', {
        method: 'PATCH',
        body: { password: 'StrongerPass2' }
    });

    assert.equal(payload.csrfToken, 'csrf-new');
    assert.equal(hooks.state.csrfToken, 'csrf-new');
    assert.equal(fetchCalls[0].options.headers['X-CSRF-Token'], 'csrf-old');
}

async function testAdminRequestClearsInvalidCsrfToken() {
    const hooks = loadAdminHooks({
        async fetch() {
            return {
                status: 403,
                ok: false,
                async text() {
                    return JSON.stringify({ error: 'CSRF token invalid' });
                }
            };
        }
    });
    hooks.state.csrfToken = 'csrf-stale';

    await assert.rejects(
        () => hooks.request('/api/admin/users/user-1', {
            method: 'DELETE'
        }),
        /CSRF token invalid/
    );
    assert.equal(hooks.state.csrfToken, '');
}

async function main() {
    testAdminScoreFormattingRejectsInvalidNumbers();
    testAdminRecordScoreFormattingRejectsInvalidNumbers();
    testAdminRecordPayloadFormattingIsSafeAndBounded();
    testAdminRecordDeleteUsesSelectionSnapshot();
    await testAdminRequestStoresRotatedCsrfToken();
    await testAdminRequestClearsInvalidCsrfToken();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'admin UI formatting tests passed'
    }, null, 2));
}

await main();
