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

const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams,
    fetch() {
        throw new Error('fetch should not be called in this test');
    }
});
vm.runInContext(source, context, { filename: 'backend/admin/admin.js' });

const hooks = windowStub.__IELTS_ADMIN_TEST_HOOKS__;
assert(hooks, 'admin test hooks should be available');
assert.equal(typeof hooks.confirmAction, 'function');
assert.equal(typeof hooks.closeConfirm, 'function');

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

console.log('adminFrontendGuard.test.js passed');
