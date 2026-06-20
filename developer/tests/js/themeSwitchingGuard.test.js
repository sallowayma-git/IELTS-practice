#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createStorage(seed = {}) {
    const state = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(key, String(value));
        },
        removeItem(key) {
            state.delete(key);
        },
        dump() {
            return Object.fromEntries(state.entries());
        }
    };
}

function createClassList() {
    const values = new Set();
    return {
        add(value) {
            values.add(String(value));
        },
        contains(value) {
            return values.has(String(value));
        }
    };
}

function createThemeHarness(seed = {}) {
    const listeners = new Map();
    const attributes = new Map();
    const localStorage = createStorage(seed.localStorage);
    const sessionStorage = createStorage(seed.sessionStorage);
    const document = {
        documentElement: {
            setAttribute(name, value) {
                attributes.set(String(name), String(value));
            },
            removeAttribute(name) {
                attributes.delete(String(name));
            },
            getAttribute(name) {
                return attributes.has(String(name)) ? attributes.get(String(name)) : null;
            }
        },
        body: {
            contains() { return false; },
            classList: createClassList()
        },
        addEventListener(type, callback) {
            listeners.set(type, callback);
        },
        getElementById() {
            return null;
        }
    };
    const window = {
        document,
        localStorage,
        sessionStorage
    };
    const context = vm.createContext({
        window,
        document,
        localStorage,
        sessionStorage,
        console: {
            warn() {},
            error() {},
            log() {}
        }
    });
    vm.runInContext(readSource('js/theme-switcher.js'), context, { filename: 'js/theme-switcher.js' });
    return {
        window,
        document,
        localStorage,
        dispatchDOMContentLoaded() {
            const listener = listeners.get('DOMContentLoaded');
            if (listener) listener({ type: 'DOMContentLoaded' });
        }
    };
}

function createThreeHarness() {
    const localStorage = createStorage();
    const document = {
        readyState: 'loading',
        body: {
            classList: createClassList()
        },
        addEventListener() {}
    };
    const window = {
        document,
        localStorage,
        THREE: null,
        WebGLRenderingContext: null
    };
    const context = vm.createContext({
        window,
        document,
        localStorage,
        console: {
            warn() {},
            error() {},
            log() {}
        }
    });
    vm.runInContext(readSource('js/presentation/threeBackground.js'), context, {
        filename: 'js/presentation/threeBackground.js'
    });
    return { window, localStorage };
}

const themeHarness = createThemeHarness();
assert.equal(themeHarness.window.normalizeInternalTheme(' BLUE '), 'blue');
assert.equal(themeHarness.window.normalizeInternalTheme('default'), 'default');
assert.equal(themeHarness.window.normalizeInternalTheme('"><img src=x onerror=alert(1)>'), '');

themeHarness.window.applyTheme('blue');
assert.equal(themeHarness.document.documentElement.getAttribute('data-theme'), 'blue');
assert.equal(themeHarness.localStorage.getItem('theme'), 'blue');

themeHarness.window.applyTheme('"><img src=x onerror=alert(1)>');
assert.equal(themeHarness.document.documentElement.getAttribute('data-theme'), null);
assert.equal(themeHarness.localStorage.getItem('theme'), null);

const startupHarness = createThemeHarness({
    localStorage: {
        theme: 'javascript:alert(1)',
        preferred_theme_portal: '[]'
    }
});
startupHarness.dispatchDOMContentLoaded();
assert.equal(startupHarness.document.documentElement.getAttribute('data-theme'), null);
assert.equal(startupHarness.localStorage.getItem('theme'), null);
assert.equal(startupHarness.window.__themeSwitcher.load(), null);

startupHarness.window.__themeSwitcher.recordInternalTheme('blue');
assert.equal(JSON.parse(startupHarness.localStorage.getItem('preferred_theme_portal')).theme, 'blue');
startupHarness.window.__themeSwitcher.recordInternalTheme('not-a-theme');
assert.equal(JSON.parse(startupHarness.localStorage.getItem('preferred_theme_portal')).theme, 'blue');

const threeHarness = createThreeHarness();
assert.equal(threeHarness.window.normalizeBackgroundThemeName('teal-ocean'), 'teal-ocean');
assert.equal(threeHarness.window.normalizeBackgroundThemeName('bad-theme'), 'misty-mountain');
threeHarness.window.switchBgTheme('bad-theme');
assert.equal(threeHarness.localStorage.getItem('three_bg_theme'), 'misty-mountain');
threeHarness.window.switchBgTheme('floral-bloom');
assert.equal(threeHarness.localStorage.getItem('three_bg_theme'), 'floral-bloom');

const themeSource = readSource('js/theme-switcher.js');
assert(
    themeSource.includes('function normalizeInternalTheme') &&
    themeSource.includes("root.removeAttribute('data-theme')") &&
    !themeSource.includes("root.setAttribute('data-theme', theme)"),
    'theme switcher must validate persisted theme IDs before writing data-theme'
);

const threeSource = readSource('js/presentation/threeBackground.js');
assert(
    threeSource.includes('function normalizeBackgroundThemeName') &&
    threeSource.includes("localStorage.setItem('three_bg_theme', normalized)") &&
    !threeSource.includes("localStorage.setItem('three_bg_theme', themeName)"),
    '3D background switcher must validate theme IDs before persisting them'
);

console.log('themeSwitchingGuard.test.js passed');
