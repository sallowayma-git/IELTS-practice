#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        toggle(value, enabled) {
            if (enabled) values.add(value);
            else values.delete(value);
        },
        contains(value) { return values.has(value); }
    };
}

function createLegacyControllerHarness() {
    const listeners = new Map();
    const warnings = [];
    const button = {
        dataset: { view: 'browse' },
        classList: createClassList(['active'])
    };
    const container = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener() {},
        contains(value) { return value === button; },
        querySelectorAll() { return [button]; }
    };
    const documentStub = {
        contains(value) { return value === container; },
        querySelector(selector) { return selector === '.main-nav' ? container : null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement() {
            return {
                classList: createClassList(),
                dataset: {},
                style: {},
                appendChild() {},
                setAttribute() {},
                addEventListener() {},
                removeEventListener() {}
            };
        },
        createTextNode(value) { return { textContent: String(value) }; }
    };
    const windowStub = {};
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: {
            log() {},
            error() {},
            info() {},
            warn(...args) { warnings.push(args); }
        },
        Node: function Node() {},
        Promise,
        Set,
        Map,
        Date,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = windowStub;
    sandbox.self = windowStub;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/views/legacyViewBundle.js' });
    return { windowStub, listeners, warnings, button, container };
}

function createBootFallbackHarness({ controllerPresent, resetPresent }) {
    const showViewCalls = [];
    const warnings = [];
    let navigationOptions = null;
    let fallbackHandler = null;
    let resetCalls = 0;
    const button = {
        classList: createClassList(['active']),
        getAttribute(name) { return name === 'data-view' ? 'browse' : null; }
    };
    const navRoot = {
        contains(value) { return value === button; },
        addEventListener(type, listener) {
            if (type === 'click') fallbackHandler = listener;
        },
        querySelectorAll() { return []; },
        querySelector() { return null; }
    };
    const documentStub = {
        readyState: 'loading',
        body: {},
        addEventListener() {},
        querySelector(selector) { return selector === '.main-nav' ? navRoot : null; },
        querySelectorAll() { return []; },
        getElementById() { return null; },
        createElement() { return {}; }
    };
    const windowStub = {
        document: documentStub,
        location: { search: '', hash: '' },
        showView(viewName, resetCategory) {
            showViewCalls.push({ viewName, resetCategory });
            return true;
        }
    };
    if (controllerPresent) {
        windowStub.ensureLegacyNavigationController = function ensureLegacyNavigationController(options) {
            navigationOptions = options;
            return { syncActive() {} };
        };
    }
    if (resetPresent) {
        windowStub.resetBrowseViewToAll = function resetBrowseViewToAll() {
            resetCalls += 1;
            return Promise.resolve(true);
        };
    }
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: {
            log() {},
            error() {},
            info() {},
            warn(...args) { warnings.push(args); }
        },
        Promise,
        Set,
        Map,
        Date,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        URL,
        URLSearchParams,
        Blob,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = windowStub;
    sandbox.self = windowStub;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/boot-fallbacks.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/boot-fallbacks.js' });
    return {
        navigationOptions,
        fallbackHandler,
        showViewCalls,
        warnings,
        button,
        getResetCalls: () => resetCalls
    };
}

test('legacy controller handles an active repeat before ordinary navigation and contains rejection', async () => {
    const harness = createLegacyControllerHarness();
    const calls = [];
    const controller = new harness.windowStub.LegacyNavigationController({
        container: harness.container,
        syncOnNavigate: false,
        onNavigate() { calls.push('navigate'); },
        onRepeatNavigate() {
            calls.push('repeat');
            return Promise.reject(new Error('reset failed'));
        }
    });
    controller.mount(harness.container);

    const event = {
        preventDefault() {},
        target: {
            closest() { return harness.button; }
        }
    };
    harness.listeners.get('click')(event);
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, ['repeat']);
    assert.equal(event.__browseNavigationHandled, true);
    assert.equal(harness.warnings.length, 1);
    assert.match(String(harness.warnings[0][0]), /onRepeatNavigate/);
});

test('legacy controller falls through when a repeat callback explicitly declines handling', () => {
    const harness = createLegacyControllerHarness();
    const calls = [];
    const controller = new harness.windowStub.LegacyNavigationController({
        container: harness.container,
        syncOnNavigate: false,
        onNavigate() { calls.push('navigate'); },
        onRepeatNavigate() {
            calls.push('repeat');
            return false;
        }
    });
    controller.mount(harness.container);

    harness.listeners.get('click')({
        preventDefault() {},
        target: {
            closest() { return harness.button; }
        }
    });

    assert.deepEqual(calls, ['repeat', 'navigate']);
});

test('boot fallback wires controller repeats and resets without a helper', async () => {
    const controllerHarness = createBootFallbackHarness({ controllerPresent: true, resetPresent: true });
    assert.equal(typeof controllerHarness.navigationOptions.onRepeatNavigate, 'function');
    await controllerHarness.navigationOptions.onRepeatNavigate('browse');
    assert.equal(controllerHarness.getResetCalls(), 1);
    assert.equal(controllerHarness.navigationOptions.onRepeatNavigate('settings'), false);
    assert.deepEqual(controllerHarness.showViewCalls, []);

    const manualHarness = createBootFallbackHarness({ controllerPresent: false, resetPresent: false });
    assert.equal(typeof manualHarness.fallbackHandler, 'function');
    manualHarness.fallbackHandler({
        preventDefault() {},
        target: {
            closest(selector) {
                return selector === '.nav-btn[data-view]' ? manualHarness.button : null;
            }
        }
    });
    await Promise.resolve();

    assert.deepEqual(
        manualHarness.showViewCalls,
        [{ viewName: 'browse', resetCategory: true }]
    );
});
