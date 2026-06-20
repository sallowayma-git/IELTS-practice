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
    const nativeConsole = {
        log() {},
        info() {},
        warn() {},
        error() {},
        debug() {}
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
    return { window, localStorage };
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

assert(
    source.includes('function normalizeLogLevel') &&
    source.includes('function normalizeCategoryLevels') &&
    source.includes("UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    !source.includes('...(storedConfig.categories || {})'),
    'logger config must validate stored category levels before merging persisted data'
);

console.log('loggerConfig.test.js passed');
