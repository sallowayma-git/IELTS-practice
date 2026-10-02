import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const contract = require(path.join(root, 'js/diagnostics/diagnosticContract.js'));
const source = fs.readFileSync(path.join(root, 'js/diagnostics/diagnosticContract.js'), 'utf8');
const secret = 'PRIVATE_学习答案_😀_do_not_collect';
const fixturePath = path.join(root, 'developer/tests/js/fixtures/diagnostic-events.json');

function loadAppDataError() {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(root, 'js/data/v2/dataCatalog.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/data/v2/dataKernel.js'), 'utf8'), context);
    return context.__AppDataV2Internals.AppDataError;
}

function error(fields = {}) {
    return { name: 'AppDataError', message: secret, code: 'QUOTA_EXCEEDED',
        stack: 'AppDataError: private text\n    at save (file:///C:/Users/private/project/js/data/v2/dataKernel.js:757:12)',
        ...fields };
}
function assertSafe(event) {
    const serialized = JSON.stringify(event);
    for (const forbidden of [secret, 'private.internal', 'C:/Users', 'C:\\Users', '/home/alice',
        'password=', 'token=', 'clipboardContents', 'answers', 'passage', 'importContents']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.ok(Buffer.byteLength(serialized, 'utf8') <= 8192);
    assert.ok(event.breadcrumbs.length <= 50);
    let count = 0;
    let frames = 0;
    for (let current = event.error; current; current = current.cause) {
        count += 1;
        frames += current.stack.length;
    }
    assert.ok(count <= 4, 'root plus three causes');
    assert.ok(frames <= 20, 'twenty frames across the complete event');
    assert.ok(Object.isFrozen(event));
    return serialized;
}

test('installs in a DOM-free realm without storage, AppData, console, timers, or browser startup', () => {
    const context = vm.createContext({});
    vm.runInContext(source, context);
    const first = context.AppDiagnosticContract;
    vm.runInContext(source, context);
    assert.equal(context.AppDiagnosticContract, first);
    const event = first.createNormalizer().normalize({ error: 'an unhandled rejection' });
    assert.equal(event.code, 'UNEXPECTED_RUNTIME_ERROR');
    assert.equal(event.collection.coverage, 'unknown');
    assert.equal(event.buildId, 'unknown');
    assertSafe(event);
});

test('preserves actual AppDataError cause codes separately from operation codes', () => {
    const AppDataError = loadAppDataError();
    const normalizer = contract.createNormalizer();
    // Enumerated from dataKernel.js and appData.js producers, independently of the contract.
    const producerCodes = ['BACKEND_UNAVAILABLE', 'QUOTA_EXCEEDED', 'CONFLICT', 'CORRUPT_RECORD',
        'VALIDATION', 'INITIALIZATION_BLOCKED', 'TIMING_FINALIZED', 'TIMING_STALE_WRITER', 'TIMING_STALE_REVISION'];
    for (const code of contract.CODES) {
        for (const cause of producerCodes) {
            const underlying = new AppDataError(cause, secret, { answers: secret });
            const event = normalizer.normalize({ code, error: underlying });
            assert.equal(event.code, code);
            assert.equal(event.causeCode, cause);
            assert.equal(event.error.code, cause);
            assert.equal(event.error.name, 'AppDataError');
            assert.equal(event.persistence.operation, 'unconfirmed', 'committed=false on AppDataError is not proof');
            assert.deepEqual(normalizer.sanitizeEvent(JSON.parse(JSON.stringify(event))), event);
            assertSafe(event);
        }
    }
    const wrapped = normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', error: error({
        name: 'Error', code: 'IGNORED', cause: new AppDataError('CONFLICT', secret)
    }) });
    assert.equal(wrapped.causeCode, 'CONFLICT');
    assert.equal(wrapped.error.code, 'unknown');
});

test('recognized cause codes require AppDataError names at every normalization boundary', () => {
    const AppDataError = loadAppDataError();
    const normalizer = contract.createNormalizer();
    for (const unrelated of [Object.assign(new Error(secret), { code: 'CONFLICT' }),
        Object.assign(new TypeError(secret), { code: 'CONFLICT' }), { code: 'CONFLICT' },
        { name: 'LibraryError', code: 'CONFLICT' }]) {
        const plain = normalizer.normalize({ error: unrelated });
        assert.equal(plain.error.code, 'unknown');
        assert.equal(plain.causeCode, 'unknown');
        unrelated.cause = new AppDataError('TIMING_STALE_WRITER', secret);
        const wrapped = normalizer.normalize({ error: unrelated });
        assert.equal(wrapped.error.code, 'unknown');
        assert.equal(wrapped.causeCode, 'TIMING_STALE_WRITER');
        assert.equal(wrapped.error.cause.code, 'TIMING_STALE_WRITER');
        const poisoned = JSON.parse(JSON.stringify(wrapped));
        poisoned.error.code = 'CONFLICT';
        poisoned.causeCode = 'CONFLICT';
        assert.deepEqual(normalizer.sanitizeEvent(poisoned), wrapped);
        assertSafe(wrapped);
    }
    assert.equal(normalizer.normalize({ error: new AppDataError(secret, secret) }).causeCode, 'unknown');
});

test('excludes learning data and arbitrary fields before memory, persistence, relay, and export', async () => {
    const normalizer = contract.createNormalizer({
        appVersion: '0.6.3', buildId: `git:${'a'.repeat(40)}`,
        environment: { runMode: 'subpath', browser: 'chromium', platform: 'windows',
            browserVersion: '140.0', context: 'main', url: `https://private.internal/${secret}` }
    });
    const payload = { answers: secret, passage: secret, notes: secret, importContents: secret,
        clipboardContents: secret, token: secret, payload: { message: secret } };
    const raw = { ...payload, code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit',
        error: error({ ...payload, cause: error({ ...payload, details: payload }) }),
        correlation: { session: secret, suite: secret, submission: secret, operation: secret, token: secret },
        resource: { url: `https://private.internal/private/js/bundles/practice.bundle.js?token=${secret}#${secret}` },
        notification: { kind: 'dialog', requiresDismissal: true, message: secret, details: payload },
        retry: { available: true, action: 'submit', callback() { throw Error('must not run'); }, ...payload },
        breadcrumbs: [{ action: 'submit', module: 'practice', message: secret, ...payload,
            correlation: { session: secret } }, { action: 'keydown', ...payload }],
        collection: { source: 'business', coverage: 'partial', token: secret } };
    const memory = [normalizer.normalize(raw)];
    assert.equal(memory[0].resource.path, 'js/bundles/practice.bundle.js');
    assert.equal(memory[0].resource.status, 'unknown');
    assert.equal(memory[0].breadcrumbs.length, 1);
    assert.equal(memory[0].retry.available, true);
    assertSafe(memory[0]);
    const persisted = await Promise.resolve(JSON.parse(JSON.stringify(memory[0])));
    // Stored/forwarded records are untrusted even if their schema version looks correct.
    persisted.answers = secret;
    persisted.error.message = secret;
    persisted.error.stack.push({ path: `/home/alice/${secret}`, line: 4, content: secret });
    const forwarded = normalizer.sanitizeEvent(persisted);
    assertSafe(forwarded);
    const exported = normalizer.sanitizeEvent(JSON.parse(JSON.stringify(forwarded)));
    assertSafe(exported);
    assert.deepEqual(exported, forwarded);
    assert.equal(exported.eventId, memory[0].eventId);
    assert.deepEqual(exported.correlation, memory[0].correlation);
    assert.equal(exported.error.message, '[redacted]');
    assert.equal(exported.environment.runMode, 'subpath');
    assert.throws(() => { memory[0].error.message = secret; }, TypeError);
});

test('free-form message/name/module/action fields cannot smuggle plain, encoded, or unlabeled content', () => {
    const normalizer = contract.createNormalizer();
    for (const value of [secret, JSON.stringify({ answer: secret }), 'Bearer abc', 'eyJ0b2tlbiI6MQ',
        'The learner wrote an arbitrary sentence', '<div>private note</div>', 'https://private.internal/x',
        'cHJpdmF0ZQ==', 1n, Symbol(secret), () => secret]) {
        const event = normalizer.normalize({ code: value, causeCode: value, module: value, action: value,
            error: { name: value, message: value, code: value, cause: value },
            environment: { userAgent: value }, notification: { kind: value } });
        assert.equal(event.code, 'UNEXPECTED_RUNTIME_ERROR');
        assert.equal(event.causeCode, 'unknown');
        assert.equal(event.error.message, '[redacted]');
        assert.equal(event.module, 'unknown');
        assertSafe(event);
    }
    const event = normalizer.normalize({ error: { message: contract.MESSAGES.DATA_EXPORT_FAILED } });
    assert.equal(event.error.message, 'Data export failed.');
});

test('retains only known project resource paths and safe line/column information', () => {
    const normalizer = contract.createNormalizer();
    const inputs = [
        ['file:///C:/Users/private/app/js/app.js:954:9', 'js/app.js', 954, 9],
        ['C:\\Users\\private\\app\\js\\app.js:954:9', 'js/app.js', 954, 9],
        ['/home/alice/app/js/app.js:20', 'js/app.js', 20, null],
        ['https://private.internal/subpath/js/app.js:20:2?token=secret#private', 'js/app.js', 20, 2],
        ['//private.internal/project/js/app.js', 'js/app.js', null, null],
        ['js/app.js?token=private#fragment', 'js/app.js', null, null],
        ['js/app.js?token=private:954:9', 'js/app.js', null, null],
        ['js/app.js#private:954:9', 'js/app.js', null, null],
        ['https://private.internal/unknown?path=js/app.js', 'unknown', null, null],
        ['file:///home/alice/private.txt', 'unknown', null, null],
        [`js/${secret}.js`, 'unknown', null, null],
        ['https://[fd00::1]/private.txt', 'unknown', null, null],
        ['data:text/plain,secret', 'unknown', null, null],
        ['blob:https://private.internal/secret', 'unknown', null, null],
        ['js/app.js:9999999999:9999999999', 'js/app.js', null, null]
    ];
    for (const [url, path, line, column] of inputs) {
        const event = normalizer.normalize({ code: 'RESOURCE_LOAD_FAILED', resource: { url } });
        assert.deepEqual(event.resource, { path, line, column, status: 'unknown', optional: 'unknown' }, url);
        assertSafe(event);
    }
    const event = normalizer.normalize({ resource: { url: 'js/app.js', status: 404, optional: true } });
    assert.equal(event.resource.status, 404, 'only explicit observed status is retained');
    assert.equal(event.resource.optional, true);
    assert.equal(normalizer.normalize({ resource: { status: '404' } }).resource.status, 'unknown');
});

test('browser stacks retain terminal coordinates after version queries and fragments', () => {
    const normalizer = contract.createNormalizer();
    const bundle = 'js/bundles/practice-page-enhancer.bundle.js';
    const inputs = [
        [`    at save (https://private.internal/subpath/${bundle}?v=build:954:9)`, bundle, 954, 9],
        [`    at https://private.internal/${bundle}?v=build:954:9`, bundle, 954, 9],
        [`save@https://private.internal/subpath/${bundle}?v=build:954:9`, bundle, 954, 9],
        [`@file:///C:/Users/private/project/${bundle}?v=build#private:954:9`, bundle, 954, 9],
        ['    at save (file:///home/alice/js/app.js?token=private:20)', 'js/app.js', 20, null],
        ['save@https://private.internal/js/main.js?token=private#private:8:2', 'js/main.js', 8, 2],
        ['    at save (https://private.internal/unknown?path=js/app.js:954:9)', 'unknown', null, null],
        ['save@https://private.internal/unknown#js/app.js:954:9', 'unknown', null, null],
        ['    at save (https://private.internal/unknown?path=(js/app.js:954:9)', 'unknown', null, null],
        ['save@https://private.internal/unknown?path=@js/app.js:954:9', 'unknown', null, null],
        ['    at save (https://private.internal/js/app.js?v=build:0:9999999999)', 'js/app.js', null, null]
    ];
    for (const [stack, path, line, column] of inputs) {
        const event = normalizer.normalize({ error: error({ stack, cause: error({ stack }) }) });
        assert.deepEqual(event.error.stack, [{ path, line, column }], stack);
        assert.deepEqual(event.error.cause.stack, [{ path, line, column }], stack);
        assert.deepEqual(normalizer.sanitizeEvent(JSON.parse(JSON.stringify(event))), event);
        assertSafe(event);
    }
});

test('all causes, stacks, and AppDataError details.cause pass through the same privacy boundary', () => {
    const event = contract.createNormalizer().normalize({ error: error({
        stack: `Error: ${secret}\n at ${secret} (https://private.internal/js/app.js:5:7)\n${secret}@file:///home/alice/js/main.js:8:2`,
        cause: error({ code: 'CONFLICT', details: { cause: error({ code: 'VALIDATION',
            stack: `Error: ${secret}\n at secret (C:\\Users\\private\\js\\app.js:9:1)` }) } })
    }) });
    assert.equal(event.error.stack.length, 2);
    assert.deepEqual(event.error.stack[0], { path: 'js/app.js', line: 5, column: 7 });
    assert.equal(event.error.cause.cause.code, 'VALIDATION');
    assertSafe(event);
});

test('same propagated Error reuses its ID; independent occurrences keep IDs despite matching fingerprints', () => {
    const normalizer = contract.createNormalizer();
    const failure = error();
    const observations = ['business', 'console', 'global', 'storage'].map((source) => normalizer.normalize({
        code: 'PRACTICE_SAVE_FAILED', error: failure, collection: { source }
    }));
    assert.equal(new Set(observations.map((event) => event.eventId)).size, 1);
    assert.equal(new Set(observations.map((event) => event.timestamp)).size, 1);
    assert.equal(observations[0].repetitionCount, 1);
    const relayed = contract.createNormalizer().sanitizeEvent(JSON.parse(JSON.stringify(observations[0])));
    assert.equal(relayed.eventId, observations[0].eventId);
    assert.equal(relayed.windowId, observations[0].windowId);
    const wrapped = normalizer.normalize({ error: { cause: failure } });
    assert.equal(wrapped.eventId, observations[0].eventId);
    const second = normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', error: error() });
    assert.notEqual(second.eventId, observations[0].eventId);
    assert.equal(second.fingerprint, observations[0].fingerprint);
    const third = normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', error: failure, newOccurrence: true });
    assert.notEqual(third.eventId, observations[0].eventId);
    assert.equal(third.fingerprint, observations[0].fingerprint);
    assert.equal(normalizer.normalize({ error: failure }).eventId, third.eventId);
    assert.notEqual(normalizer.normalize({ error: secret }).eventId, normalizer.normalize({ error: secret }).eventId);
    assert.equal(new Set([...observations, relayed, second].map((event) => event.eventId)).size, 2,
        'notification repetition counts unique identities, not propagation observations');
});

test('AppDataError details.cause wrappers retain identity in either observation order and across handoff', () => {
    const AppDataError = loadAppDataError();
    for (const wrapperFirst of [false, true]) {
        const windowIdentity = contract.createWindowIdentity();
        const bootstrap = contract.createNormalizer({ windowIdentity });
        const runtime = contract.createNormalizer({ windowIdentity });
        const failure = new Error(secret);
        const wrapper = new AppDataError('BACKEND_UNAVAILABLE', secret, { cause: failure });
        const first = bootstrap.normalize({ error: wrapperFirst ? wrapper : failure });
        const second = runtime.normalize({ error: wrapperFirst ? failure : wrapper });
        const mixed = runtime.normalize({ error: { cause: new AppDataError('CONFLICT', secret, { cause: wrapper }) } });
        for (const event of [second, mixed]) {
            assert.equal(event.eventId, first.eventId);
            assert.equal(event.timestamp, first.timestamp);
            assert.equal(event.sequence, first.sequence);
            assertSafe(event);
        }
        const independent = runtime.normalize({ error: new AppDataError('BACKEND_UNAVAILABLE', secret, { cause: new Error(secret) }) });
        assert.notEqual(independent.eventId, first.eventId);
        const retry = runtime.normalize({ error: wrapper, newOccurrence: true });
        assert.notEqual(retry.eventId, first.eventId);
        assert.equal(runtime.normalize({ error: wrapper }).eventId, retry.eventId);
        assert.equal(runtime.normalize({ error: failure }).eventId, first.eventId, 'retry does not rebind a shared cause');
    }
});

test('cause identity uses the same precedence, cycle limit, and depth limit as error details', () => {
    const normalizer = contract.createNormalizer();
    const direct = error();
    const fallback = error();
    const directEvent = normalizer.normalize({ error: direct });
    const fallbackEvent = normalizer.normalize({ error: fallback });
    const wrapper = error({ cause: direct, details: { cause: fallback } });
    const event = normalizer.normalize({ error: wrapper });
    assert.equal(event.eventId, directEvent.eventId);
    assert.equal(normalizer.normalize({ error: fallback }).eventId, fallbackEvent.eventId);
    assert.equal(normalizer.normalize({ error: { cause: null, details: { cause: fallback } } }).eventId, fallbackEvent.eventId);
    const primitive = normalizer.normalize({ error: { cause: false, details: { cause: fallback } } });
    assert.notEqual(primitive.eventId, fallbackEvent.eventId);
    assert.equal(primitive.error.cause.kind, 'boolean');
    const cyclic = error({ details: {} });
    cyclic.details.cause = cyclic;
    const cycle = normalizer.normalize({ error: cyclic });
    assert.ok(cycle.collection.issues.includes('cause-cycle'));
    assert.equal(normalizer.normalize({ error: cyclic }).eventId, cycle.eventId);
    const leaf = error();
    let nested = leaf;
    for (let depth = 0; depth < 4; depth += 1) nested = { details: { cause: nested } };
    const bounded = normalizer.normalize({ error: nested });
    assert.ok(bounded.collection.issues.includes('causes-truncated'));
    assert.notEqual(normalizer.normalize({ error: leaf }).eventId, bounded.eventId);
    [event, primitive, cycle, bounded].forEach(assertSafe);
});

test('details.cause identity traversal skips accessors and contains throwing descriptors', () => {
    const normalizer = contract.createNormalizer();
    let getterCalls = 0;
    const accessor = { get cause() { getterCalls += 1; throw new Error(secret); } };
    const detailsAccessor = { get details() { getterCalls += 1; throw new Error(secret); } };
    const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(secret); } });
    for (const [failure, marker] of [[{ details: accessor }, 'accessor-skipped'],
        [detailsAccessor, 'accessor-skipped'], [{ details: hostile }, 'unreadable']]) {
        const event = normalizer.normalize({ error: failure });
        assert.ok(event.collection.issues.includes(marker));
        assert.equal(normalizer.normalize({ error: failure }).eventId, event.eventId);
        assertSafe(event);
    }
    assert.equal(getterCalls, 0);
});

test('aliases stay consistent within a shared scope and survive a validated cross-window handoff', () => {
    const scope = contract.createCorrelationScope();
    const main = contract.createNormalizer({ correlationScope: scope });
    const bootstrap = contract.createNormalizer({ correlationScope: scope });
    const input = { correlation: { session: secret, suite: secret, submission: secret, operation: secret } };
    const event = main.normalize(input);
    assert.deepEqual(bootstrap.normalize(input).correlation, event.correlation);
    assert.equal(new Set(Object.values(event.correlation)).size, 5, 'aliases are separated by identifier kind');
    const practice = contract.createNormalizer();
    const childEvent = practice.normalize({ correlationAliases: event.correlation });
    assert.deepEqual(childEvent.correlation, event.correlation);
    assert.notEqual(childEvent.windowId, event.windowId);
    const other = contract.createNormalizer().normalize(input);
    assert.notEqual(other.correlation.session, event.correlation.session, 'no global cross-session tracking');
    for (const value of [null, 1, 1n, Symbol(secret), {}, secret.repeat(100)]) assert.equal(scope.alias('session', value), 'unknown');
    const prior = scope.alias('session', secret);
    for (let i = 0; i < contract.LIMITS.correlationEntries; i += 1) scope.alias('session', String(i));
    assert.equal(scope.alias('session', 'overflow'), 'unknown');
    assert.equal(scope.alias('session', secret), prior, 'capacity does not evict existing associations');
    scope.dispose();
    assert.equal(scope.alias('session', secret), 'unknown');
    assertSafe(event);
});

test('bootstrap handoff and session changes can share the same window identity and sequence', () => {
    const windowIdentity = contract.createWindowIdentity();
    const bootstrap = contract.createNormalizer({ windowIdentity });
    const runtime = contract.createNormalizer({ windowIdentity });
    const failure = error();
    const early = bootstrap.normalize({ error: failure });
    const adopted = runtime.normalize({ code: 'APP_BOOT_FAILED', error: failure });
    assert.equal(early.eventId, adopted.eventId);
    assert.equal(early.timestamp, adopted.timestamp);
    assert.equal(early.windowId, windowIdentity.windowId);
    const next = runtime.normalize({ error: error() });
    assert.equal(next.windowId, early.windowId);
    assert.equal(next.sequence, early.sequence + 1);
    assert.notEqual(next.eventId, early.eventId);
    const forged = contract.createNormalizer({ windowIdentity: { windowId: early.windowId } });
    assert.notEqual(forged.windowId, early.windowId, 'only code-owned handles share identity state');
});

test('operation persistence and retry remain explicit metadata, with no invocation or inferred save success', () => {
    const normalizer = contract.createNormalizer();
    let calls = 0;
    const event = normalizer.normalize({ error: { committed: true },
        retry: { available: true, callback() { calls += 1; } }, notification: { requiresDismissal: true } });
    assert.equal(event.persistence.operation, 'unconfirmed');
    assert.equal(event.retry.available, false, 'safe retry needs an operation association');
    assert.equal(calls, 0);
    const unsafeRetry = normalizer.normalize({ correlation: { operation: secret }, retry: { available: true, action: 'reset' } });
    assert.equal(unsafeRetry.retry.available, false);
    assert.equal(unsafeRetry.retry.action, 'unknown');
    for (const operation of ['committed', 'not-committed', 'unconfirmed']) {
        const explicit = normalizer.normalize({ persistence: { operation, diagnostics: 'failed' } });
        assert.equal(explicit.persistence.operation, operation);
        assert.equal(explicit.persistence.diagnostics, 'failed');
    }
});

test('hostile getters, proxies, toJSON, coercion hooks, and DOM references cannot escape or execute accessors', () => {
    let calls = 0;
    const getter = () => { calls += 1; throw Error(secret); };
    const accessors = Object.fromEntries(['error', 'code', 'message', 'name', 'stack', 'cause', 'details',
        'resource', 'correlation', 'breadcrumbs', 'notification'].map((key) => [key, { get: getter }]));
    const hostile = Object.defineProperties({}, accessors);
    const nativeError = new Error();
    Object.defineProperty(nativeError, 'message', { get: getter });
    const dom = { nodeType: 1, textContent: secret, outerHTML: secret, get innerText() { return getter(); } };
    const proxy = new Proxy({}, { get: getter, getOwnPropertyDescriptor: getter, ownKeys: getter, getPrototypeOf: getter });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hooks = { toJSON: getter, toString: getter, valueOf: getter, [Symbol.toPrimitive]: getter,
        answers: secret, message: secret, code: 1n };
    const normalizer = contract.createNormalizer();
    for (const value of [hostile, nativeError, dom, hooks]) {
        assertSafe(normalizer.normalize(value));
        assertSafe(normalizer.normalize({ error: value, resource: value, breadcrumbs: value }));
    }
    assert.equal(calls, 0, 'getters and coercion hooks were never invoked');
    assert.equal(normalizer.normalize({ error: dom }).error.kind, 'dom');
    for (const value of [proxy, revoked.proxy]) {
        assert.doesNotThrow(() => assertSafe(normalizer.normalize(value)));
        assert.doesNotThrow(() => assertSafe(normalizer.normalize({ error: value, resource: value, breadcrumbs: value })));
        assert.equal(normalizer.sanitizeEvent(value), null);
    }
    assert.ok(calls < 200, 'proxy traps are caught and bounded, never enumerated');
    assert.ok(normalizer.normalize(hostile).collection.issues.includes('accessor-skipped'));
});

test('cycles, BigInt, huge arrays, long strings, and cause chains have explicit bounded markers', () => {
    const normalizer = contract.createNormalizer();
    const cycle = error();
    cycle.cause = cycle;
    const cyclic = normalizer.normalize({ error: cycle });
    assert.equal(cyclic.error.cause.kind, 'cycle');
    assert.ok(cyclic.collection.issues.includes('cause-cycle'));
    assert.equal(normalizer.normalize({ error: 123456789012345678901234567890n }).error.kind, 'bigint');
    const long = normalizer.normalize({ error: error({ message: secret.repeat(2000), stack: secret.repeat(2000) }),
        resource: { url: secret.repeat(2000) }, breadcrumbs: new Array(4294967295) });
    assert.ok(long.collection.issues.includes('input-truncated'));
    assert.ok(long.collection.issues.includes('breadcrumbs-truncated'));
    let nested = error();
    for (let i = 0; i < 20; i += 1) nested = error({ cause: nested });
    const chain = normalizer.normalize({ error: nested });
    assert.ok(chain.collection.issues.includes('causes-truncated'));
    [cyclic, long, chain].forEach(assertSafe);
});

test('UTF-8 byte counts include surrogate pairs, replacement characters, and JSON escape overhead', () => {
    for (const text of ['', 'abc', '中文😀é', '\ud800', '\udfff', '\ud800a\udfff', secret.repeat(500), '\"\\\n\t']) {
        assert.equal(contract.utf8Bytes(text), Buffer.byteLength(text, 'utf8'));
        assert.equal(contract.utf8Bytes(JSON.stringify(text)), Buffer.byteLength(JSON.stringify(text), 'utf8'));
    }
});

test('large valid events trim to 8 KiB and keep identity, causeCode, fingerprint, and stable revalidation', () => {
    const normalizer = contract.createNormalizer();
    const frame = ' at hidden (file:///home/alice/js/bundles/listening-record-bridge.bundle.js:2147483647:2147483647)';
    const event = normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', error: error({ stack: Array(30).fill(frame).join('\n'),
        cause: error({ stack: Array(20).fill(frame).join('\n') }) }),
        breadcrumbs: Array.from({ length: 80 }, (_, i) => ({ action: 'submit', module: 'practice', timestamp: i,
            correlation: { session: `private ${i}`, suite: `private ${i}`, submission: `private ${i}`, operation: `private ${i}` } })) });
    assertSafe(event);
    for (const marker of ['event-truncated', 'stack-truncated', 'breadcrumbs-truncated']) assert.ok(event.collection.issues.includes(marker));
    assert.equal(event.error.stack.length, 20);
    assert.equal(event.error.cause.stack.length, 0);
    assert.ok(event.breadcrumbs.length < 50);
    assert.equal(event.breadcrumbs.at(-1).timestamp, 79, 'newest relevant context survives');
    const checked = normalizer.sanitizeEvent(JSON.parse(JSON.stringify(event)));
    assert.deepEqual(checked, event);
});

test('wire records reject invalid schema/identity and reconstruct allowlisted metadata', () => {
    const normalizer = contract.createNormalizer();
    const event = normalizer.normalize({ error: error(), correlation: { session: secret } });
    for (const patch of [{ schemaVersion: 2 }, { eventId: secret }, { windowId: secret },
        { sequence: 0 }, { sequence: 2 }, { timestamp: Infinity }, { timestamp: secret }]) {
        assert.equal(normalizer.sanitizeEvent({ ...event, ...patch }), null);
    }
    const checked = normalizer.sanitizeEvent({ ...event, fingerprint: secret, repetitionCount: 900,
        correlationAliases: { ...event.correlation, session: secret },
        collection: { ...event.collection, limitations: [secret], issues: [secret] } });
    assert.equal(checked.fingerprint, event.fingerprint);
    assert.equal(checked.repetitionCount, 1);
    assert.deepEqual(checked.correlation, event.correlation);
    assertSafe(checked);
});

test('published sanitized fixtures are usable unchanged by runtime, store, UI, export, and channel', () => {
    const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const normalizer = contract.createNormalizer();
    for (const event of fixtures) {
        assertSafe(normalizer.sanitizeEvent(event));
        assert.deepEqual(normalizer.sanitizeEvent(event), event);
    }
});

test('every shipped execution context includes the shared contract and reviewed resource paths', () => {
    for (const name of ['core-foundation', 'reading-page', 'practice-page-enhancer', 'listening-record-bridge', 'listening-wrapper']) {
        const bundle = fs.readFileSync(path.join(root, `js/bundles/${name}.bundle.js`), 'utf8');
        const start = bundle.indexOf('/* ===== js/diagnostics/diagnosticContract.js ===== */');
        assert.ok(start >= 0, name);
        assert.ok(bundle.indexOf('function installDiagnosticContract', start) > start, name);
    }
    const optionalDistributionResources = new Set([
        'assets/generated/listening-exams/manifest.js',
        'assets/generated/listening-exams/listening-index.compat.js'
    ]);
    for (const resource of contract.PROJECT_PATHS) {
        assert.ok(optionalDistributionResources.has(resource) || fs.existsSync(path.join(root, resource)), resource);
    }
});

test('only internally validated immutable events reuse sanitization and cached byte sizing across normalizers', () => {
    let serializations = 0;
    const context = vm.createContext({ JSON: {
        stringify(...args) { serializations++; return JSON.stringify(...args); }
    } });
    vm.runInContext(source, context);
    const api = context.AppDiagnosticContract;
    const normalizer = api.createNormalizer();
    const event = normalizer.normalize({ code: 'PRACTICE_SAVE_FAILED', error: error() });
    const before = serializations;
    const otherNormalizer = api.createNormalizer();
    for (let i = 0; i < 200; i++) {
        assert.equal(otherNormalizer.sanitizeEvent(event), event);
        assert.equal(api.eventBytes(event), Buffer.byteLength(JSON.stringify(event), 'utf8'));
    }
    assert.equal(serializations, before, 'Repeated trusted reads must not reserialize or reconstruct events');
    assert.equal(Object.isFrozen(event.error), true);
    assert.equal(Object.isFrozen(event.error.stack), true);
    assert.equal(api.eventBytes(null), null);
    assert.equal(api.eventBytes(42), null);
});

test('frozen external impostors, accessors and proxies never inherit internal event trust', () => {
    const normalizer = contract.createNormalizer();
    const event = normalizer.normalize({ error: error() });
    const external = Object.freeze({ ...JSON.parse(JSON.stringify(event)), answers: secret });
    assert.equal(contract.eventBytes(external), null);
    const first = normalizer.sanitizeEvent(external);
    assert.notEqual(first, external);
    assertSafe(first);
    external.error.code = 'CONFLICT';
    const second = normalizer.sanitizeEvent(external);
    assert.notEqual(second, first, 'Mutable external children must be revalidated on every read');
    assert.equal(second.causeCode, 'CONFLICT');
    assert.equal(first.causeCode, 'QUOTA_EXCEEDED');
    assert.equal(contract.eventBytes(external), null, 'External inputs themselves must never be memoized');

    let getters = 0;
    const hostile = Object.freeze({ ...event, error: Object.freeze({
        get name() { getters++; return 'AppDataError'; },
        get message() { getters++; return secret; },
        get stack() { getters++; return secret; }
    }) });
    const checked = normalizer.sanitizeEvent(hostile);
    assert.notEqual(checked, hostile);
    assert.equal(getters, 0);
    assert.ok(checked.collection.issues.includes('accessor-skipped'));
    assertSafe(checked);
    assert.equal(contract.eventBytes(hostile), null);

    let descriptors = 0;
    const proxy = new Proxy(event, { getOwnPropertyDescriptor(target, key) {
        descriptors++; return Object.getOwnPropertyDescriptor(target, key);
    } });
    const copied = normalizer.sanitizeEvent(proxy);
    assert.notEqual(copied, event);
    assert.ok(descriptors > 0);
    const before = descriptors;
    normalizer.sanitizeEvent(proxy);
    assert.ok(descriptors > before, 'Proxies around trusted events still require full revalidation');
    assert.equal(contract.eventBytes(proxy), null);
});

test('cached sizes include final truncation issues and newly sanitized persistence revisions', () => {
    const normalizer = contract.createNormalizer();
    const event = normalizer.normalize({ error: error(), breadcrumbs: Array.from({ length: 50 }, () => ({
        action: 'submit', module: 'practice', timestamp: 8640000000000000,
        correlation: { session: 'long-session', suite: 'long-suite', submission: 'long-submission', operation: 'long-operation' }
    })) });
    assert.ok(event.collection.issues.includes('event-truncated'));
    assert.equal(contract.eventBytes(event), Buffer.byteLength(JSON.stringify(event), 'utf8'));
    assert.ok(contract.eventBytes(event) <= contract.LIMITS.eventBytes);
    const revised = normalizer.sanitizeEvent({ ...event,
        persistence: { ...event.persistence, diagnostics: 'persisted', generation: 'dg-' + 'a'.repeat(32) } });
    assert.notEqual(revised, event);
    assert.equal(revised.eventId, event.eventId);
    assert.equal(revised.timestamp, event.timestamp);
    assert.equal(revised.persistence.diagnostics, 'persisted');
    assert.equal(event.persistence.diagnostics, 'memory-only');
    assert.equal(contract.eventBytes(revised), Buffer.byteLength(JSON.stringify(revised), 'utf8'));
});
