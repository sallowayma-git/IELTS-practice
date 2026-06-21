#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/logger.js'), 'utf8');
const STORAGE_KEY = 'exam_system_log_config_v2';

function createLocalStorage(seed = {}) {
    const state = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

function createHarness(seed = {}, externalConfig = {}) {
    const localStorage = createLocalStorage(seed);
    const capturedLogs = [];
    function capture(method) {
        return (...args) => {
            capturedLogs.push({ method, args });
        };
    }
    const nativeConsole = {
        log: capture('log'),
        info: capture('info'),
        warn: capture('warn'),
        error: capture('error'),
        debug: capture('debug')
    };
    const window = {
        localStorage,
        console: { ...nativeConsole },
        __APP_LOG_CONFIG: externalConfig
    };
    const context = vm.createContext({
        window,
        localStorage,
        console: window.console
    });
    vm.runInContext(source, context, { filename: 'js/utils/logger.js' });
    return { window, localStorage, capturedLogs };
}

const maliciousStoredConfig = JSON.stringify({
    level: 'TRACE',
    categories: {
        System: 'debug',
        Storage: 'not-a-level',
        '__proto__': 'trace',
        constructor: 'trace',
        ['x'.repeat(120)]: 'debug',
        'Control\nCategory': 'debug',
        Custom: 'WARN'
    }
});

const storedHarness = createHarness({ [STORAGE_KEY]: maliciousStoredConfig });
const storedConfig = storedHarness.window.AppLogger.getConfig();
assert.equal(storedConfig.level, 'trace');
assert.equal(storedConfig.categories.System, 'debug');
assert.equal(storedConfig.categories.Storage, 'error');
assert.equal(storedConfig.categories.Custom, 'warn');
assert.equal(Object.prototype.hasOwnProperty.call(storedConfig.categories, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(storedConfig.categories, 'constructor'), false);
assert.equal(storedConfig.categories['x'.repeat(120)], undefined);
assert.equal(storedConfig.categories['Control\nCategory'], undefined);
assert.equal({}.trace, undefined);

const externalHarness = createHarness(
    { [STORAGE_KEY]: JSON.stringify({ level: 'error', categories: { System: 'error' } }) },
    {
        level: ' DEBUG ',
        categories: {
            System: ' info ',
            prototype: 'trace',
            External: 'TRACE'
        }
    }
);
const externalConfig = externalHarness.window.AppLogger.getConfig();
assert.equal(externalConfig.level, 'debug');
assert.equal(externalConfig.categories.System, 'info');
assert.equal(externalConfig.categories.External, 'trace');
assert.equal(Object.prototype.hasOwnProperty.call(externalConfig.categories, 'prototype'), false);

externalHarness.window.AppLogger.setGlobalLevel(' WARN ');
externalHarness.window.AppLogger.setCategoryLevel(' Runtime ', ' TRACE ');
externalHarness.window.AppLogger.setCategoryLevel('__proto__', 'trace');
externalHarness.window.AppLogger.setCategoryLevel('Unsafe', 'verbose');
const persisted = JSON.parse(externalHarness.localStorage.getItem(STORAGE_KEY));
assert.equal(persisted.level, 'warn');
assert.equal(persisted.categories.Runtime, 'trace');
assert.equal(Object.prototype.hasOwnProperty.call(persisted.categories, '__proto__'), false);
assert.equal(persisted.categories.Unsafe, undefined);

const arrayHarness = createHarness({ [STORAGE_KEY]: JSON.stringify(['trace']) }, ['debug']);
const arrayConfig = arrayHarness.window.AppLogger.getConfig();
assert.equal(arrayConfig.level, 'info');
assert.equal(arrayConfig.categories.System, 'info');

const redactionHarness = createHarness({}, { level: 'debug', categories: { PracticeRecorder: 'debug' } });
redactionHarness.window.console.log('[PracticeRecorder] sensitive event', {
    sessionId: 'session-123',
    csrfToken: 'csrf-123',
    password: 'StrongPass1',
    nested: {
        userInput: 'private answer',
        url: 'https://example.test/path?token=secret-token&ok=1',
        localPath: 'D:\\Users\\Alice\\IELTS\\private.html'
    },
    rows: [{ recordId: 'record-123', visible: 'count-only' }]
});
const sensitiveLog = redactionHarness.capturedLogs.find((entry) => entry.args[0] && String(entry.args[0]).includes('[PracticeRecorder]'));
assert(sensitiveLog, 'categorized logs should be captured through AppLogger');
const serializedLog = JSON.stringify(sensitiveLog.args);
assert(!serializedLog.includes('session-123'), 'logger must redact session identifiers');
assert(!serializedLog.includes('csrf-123'), 'logger must redact CSRF tokens');
assert(!serializedLog.includes('StrongPass1'), 'logger must redact passwords');
assert(!serializedLog.includes('private answer'), 'logger must redact answer text');
assert(!serializedLog.includes('secret-token'), 'logger must redact sensitive URL parameters');
assert(!serializedLog.includes('D:\\Users\\Alice'), 'logger must redact local filesystem paths');
assert(!serializedLog.includes('record-123'), 'logger must redact record identifiers');
assert(serializedLog.includes('[redacted]'), 'logger should preserve structure with redacted markers');
assert(serializedLog.includes('[local-path]'), 'logger should mark redacted local paths');

assert(
    source.includes('function normalizeLogLevel') &&
    source.includes('function normalizeCategoryLevels') &&
    source.includes('function sanitizeLogArg') &&
    source.includes('SENSITIVE_LOG_KEYS') &&
    source.includes("UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    !source.includes('...(storedConfig.categories || {})'),
    'logger config must validate stored category levels and sanitize categorized log output'
);

console.log('loggerConfig.test.js passed');
