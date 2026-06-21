import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/environmentDetector.js'), 'utf8');

function createStorage(initial = {}) {
    const state = new Map(Object.entries(initial));
    const writes = [];
    const removes = [];
    return {
        state,
        writes,
        removes,
        api: {
            getItem(key) {
                return state.has(key) ? state.get(key) : null;
            },
            setItem(key, value) {
                writes.push([key, String(value)]);
                state.set(key, String(value));
            },
            removeItem(key) {
                removes.push(key);
                state.delete(key);
            }
        }
    };
}

function createHarness(options = {}) {
    const storage = createStorage(options.storage);
    const windowStub = {
        console: {
            log() {},
            warn() {},
            error() {}
        },
        location: {
            search: options.search || '',
            hash: options.hash || ''
        },
        localStorage: storage.api,
        navigator: {
            userAgent: options.userAgent || 'Mozilla/5.0'
        }
    };
    const context = vm.createContext({
        window: windowStub,
        console: windowStub.console
    });
    vm.runInContext(source, context, { filename: 'js/utils/environmentDetector.js' });
    return { window: windowStub, storage };
}

test('URL test environment hints do not persist beyond the current page load', () => {
    const { window, storage } = createHarness({ search: '?test_env=1' });

    assert.equal(window.EnvironmentDetector.isInTestEnvironment(), true);
    assert.deepEqual(storage.writes, [], 'URL hints must not write the persistent test flag');
    assert.equal(storage.state.get('__ielts_test_env__'), undefined);
    assert.notEqual(window.__IELTS_FORCE_TEST_ENV__, true, 'URL hints must not force later navigations into test mode');
});

test('explicit test environment enablement can still persist for harnesses', () => {
    const { window, storage } = createHarness();

    window.EnvironmentDetector.enableTestEnvironment();

    assert.equal(window.EnvironmentDetector.isInTestEnvironment(), true);
    assert.deepEqual(storage.writes, [['__ielts_test_env__', 'true']]);
    assert.equal(storage.state.get('__ielts_test_env__'), 'true');
});

test('stored test environment flag still activates compatibility mode', () => {
    const { window } = createHarness({ storage: { __ielts_test_env__: 'true' } });

    assert.equal(window.EnvironmentDetector.isInTestEnvironment(), true);
    assert.equal(window.__IELTS_FORCE_TEST_ENV__, true);
});
