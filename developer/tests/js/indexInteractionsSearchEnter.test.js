#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createHarness() {
    const documentListeners = new Map();
    const documentStub = {
        readyState: 'complete',
        body: {},
        fonts: null,
        addEventListener(type, handler) {
            if (!documentListeners.has(type)) {
                documentListeners.set(type, []);
            }
            documentListeners.get(type).push(handler);
        },
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        },
        getElementById() {
            return null;
        },
        createElement() {
            return {
                className: '',
                style: {},
                insertBefore() {},
                querySelector() {
                    return null;
                }
            };
        }
    };
    class MutationObserver {
        observe() {}
        disconnect() {}
    }
    const windowStub = {
        console,
        document: documentStub,
        addEventListener() {},
        removeEventListener() {},
        requestAnimationFrame() {
            return 1;
        },
        cancelAnimationFrame() {},
        matchMedia() {
            return { matches: false };
        },
        localStorage: {
            getItem() {
                return 'true';
            },
            setItem() {}
        }
    };
    const sandbox = {
        window: windowStub,
        document: documentStub,
        MutationObserver,
        console,
        setTimeout() {
            return 1;
        },
        clearTimeout() {},
        requestAnimationFrame() {
            return 1;
        },
        cancelAnimationFrame() {},
        Promise,
        Date,
        Math,
        JSON,
        Event: class Event {}
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/presentation/indexInteractions.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/presentation/indexInteractions.js' });
    return {
        windowStub,
        documentListeners
    };
}

function fire(listeners, event) {
    listeners.forEach((handler) => handler(event));
}

function describe(name, fn) {
    try {
        fn();
        console.log(`✔ ${name}`);
    } catch (error) {
        console.error(`✖ ${name}`);
        throw error;
    }
}

function it(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}`);
        throw error;
    }
}

describe('indexInteractions declarative search handlers', () => {
    it('keeps input-driven searches working', () => {
        const harness = createHarness();
        const calls = [];
        harness.windowStub.searchExams = function (query) {
            calls.push(query);
        };
        const target = {
            value: 'ocean',
            dataset: { indexAction: 'search-exams' }
        };

        fire(harness.documentListeners.get('input') || [], { target });

        assert.deepStrictEqual(calls, ['ocean'], 'input 事件应继续触发搜索');
    });

    it('triggers search when Enter is pressed without changing the input value', () => {
        const harness = createHarness();
        const calls = [];
        let prevented = false;
        harness.windowStub.searchExams = function (query) {
            calls.push(query);
        };
        const target = {
            value: 'ocean',
            dataset: { indexAction: 'search-exams' }
        };

        fire(harness.documentListeners.get('keydown') || [], {
            target,
            key: 'Enter',
            isComposing: false,
            preventDefault() {
                prevented = true;
            }
        });

        assert.deepStrictEqual(calls, ['ocean'], 'Enter 应显式触发一次搜索');
        assert.strictEqual(prevented, true, 'Enter 搜索应阻止默认提交行为');
    });
});
