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
const componentSource = fs.readFileSync(
    path.join(repoRoot, 'js', 'components', 'questionBankQuickPicker.js'),
    'utf8'
);
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const mainCssSource = fs.readFileSync(path.join(repoRoot, 'css', 'main.css'), 'utf8');

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class FakeStyle {
    constructor() {
        this.values = Object.create(null);
    }

    setProperty(name, value) {
        this.values[name] = String(value);
    }

    removeProperty(name) {
        delete this.values[name];
    }

    getPropertyValue(name) {
        return this.values[name] || '';
    }
}

function allDescendants(root) {
    const output = [];
    (root.children || []).forEach((child) => {
        output.push(child, ...allDescendants(child));
    });
    return output;
}

function matchesSimpleSelector(element, selector) {
    const trimmed = selector.trim();
    if (trimmed.startsWith('#')) {
        return element.id === trimmed.slice(1);
    }
    if (trimmed.startsWith('.')) {
        return String(element.className || '').split(/\s+/).includes(trimmed.slice(1));
    }
    const attribute = trimmed.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) {
        const value = element.getAttribute(attribute[1]);
        return attribute[2] === undefined ? value !== null : value === attribute[2];
    }
    return element.tagName.toLowerCase() === trimmed.toLowerCase();
}

class FakeElement {
    constructor(tagName, documentRef) {
        this.tagName = String(tagName || 'div').toUpperCase();
        this.ownerDocument = documentRef;
        this.parentNode = null;
        this.children = [];
        this.listeners = new Map();
        this.attributes = new Map();
        this.dataset = {};
        this.style = new FakeStyle();
        this.hidden = false;
        this.disabled = false;
        this.className = '';
        this.id = '';
        this.type = '';
        this.value = '';
        this.textContent = '';
        this.rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        this.scrollCalls = 0;
    }

    get firstChild() {
        return this.children[0] || null;
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        this.listeners.set(type, handlers.filter((candidate) => candidate !== handler));
    }

    fire(type, event = {}) {
        if (!event.target) {
            event.target = this;
        }
        (this.listeners.get(type) || []).forEach((handler) => handler(event));
    }

    setAttribute(name, value) {
        const stringValue = String(value);
        this.attributes.set(name, stringValue);
        if (name === 'id') {
            this.id = stringValue;
        }
        if (name.startsWith('data-')) {
            const dataName = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[dataName] = stringValue;
        }
    }

    getAttribute(name) {
        if (name === 'id' && this.id) {
            return this.id;
        }
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name.startsWith('data-')) {
            const dataName = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            delete this.dataset[dataName];
        }
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parentNode = null;
        }
        return child;
    }

    replaceChildren(...children) {
        this.children.forEach((child) => {
            child.parentNode = null;
        });
        this.children = [];
        children.forEach((child) => this.appendChild(child));
    }

    contains(candidate) {
        if (candidate === this) {
            return true;
        }
        return this.children.some((child) => child.contains(candidate));
    }

    querySelectorAll(selector) {
        const descendants = allDescendants(this);
        if (selector.includes('button:not([disabled])')) {
            return descendants.filter((element) => {
                const focusableTag = ['BUTTON', 'INPUT', 'A'].includes(element.tagName);
                const explicitTabIndex = element.getAttribute('tabindex');
                return !element.hidden && !element.disabled
                    && (focusableTag || (explicitTabIndex !== null && explicitTabIndex !== '-1'));
            });
        }
        const selectors = selector.split(',');
        return descendants.filter((element) => selectors.some((item) => matchesSimpleSelector(element, item)));
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    focus() {
        this.ownerDocument.activeElement = this;
    }

    getBoundingClientRect() {
        return { ...this.rect };
    }

    scrollIntoView() {
        this.scrollCalls += 1;
    }
}

class FakeDocument {
    constructor() {
        this.readyState = 'loading';
        this.listeners = new Map();
        this.selectorMap = new Map();
        this.idMap = new Map();
        this.documentElement = { clientWidth: 1200, clientHeight: 800 };
        this.body = new FakeElement('body', this);
        this.activeElement = this.body;
    }

    createElement(tagName) {
        return new FakeElement(tagName, this);
    }

    register(selector, element) {
        this.selectorMap.set(selector, element);
        if (selector.startsWith('#')) {
            element.id = selector.slice(1);
            this.idMap.set(element.id, element);
        }
        return element;
    }

    querySelector(selector) {
        if (this.selectorMap.has(selector)) {
            return this.selectorMap.get(selector);
        }
        return this.body.querySelector(selector);
    }

    getElementById(id) {
        return this.idMap.get(id) || null;
    }

    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(handler);
    }

    removeEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        this.listeners.set(type, handlers.filter((candidate) => candidate !== handler));
    }

    fire(type, event = {}) {
        (this.listeners.get(type) || []).forEach((handler) => handler(event));
    }
}

function createHarness(options = {}) {
    const documentStub = new FakeDocument();
    const trigger = documentStub.register('#question-bank-quick-trigger', documentStub.createElement('button'));
    const panel = documentStub.register('#question-bank-quick-picker', documentStub.createElement('section'));
    const dialog = documentStub.register('.question-bank-quick-picker__dialog', documentStub.createElement('div'));
    const title = documentStub.register('#question-bank-quick-title', documentStub.createElement('h2'));
    const close = documentStub.register('#question-bank-quick-close', documentStub.createElement('button'));
    const search = documentStub.register('#question-bank-quick-search', documentStub.createElement('input'));
    const status = documentStub.register('#question-bank-quick-status', documentStub.createElement('p'));
    const scopes = documentStub.register('#question-bank-quick-scopes', documentStub.createElement('div'));
    const results = documentStub.register('#question-bank-quick-results', documentStub.createElement('div'));
    trigger.rect = { left: 620, right: 760, top: 90, bottom: 134, width: 140, height: 44 };
    panel.appendChild(dialog);
    [title, close, search, status, scopes, results].forEach((element) => dialog.appendChild(element));
    documentStub.body.appendChild(trigger);
    documentStub.body.appendChild(panel);

    const windowListeners = new Map();
    const animationFrames = [];
    const warnings = [];
    const windowStub = {
        document: documentStub,
        innerWidth: 1200,
        innerHeight: 800,
        console: {
            log() {},
            warn(...args) {
                warnings.push(args);
            }
        },
        resolveActiveLibraryIndex: options.resolveActiveLibraryIndex || (() => Promise.resolve([])),
        addEventListener(type, handler) {
            if (!windowListeners.has(type)) {
                windowListeners.set(type, []);
            }
            windowListeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            const handlers = windowListeners.get(type) || [];
            windowListeners.set(type, handlers.filter((candidate) => candidate !== handler));
        },
        requestAnimationFrame(callback) {
            animationFrames.push(callback);
            return animationFrames.length;
        }
    };
    windowStub.window = windowStub;
    windowStub.globalThis = windowStub;

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console: windowStub.console,
        globalThis: windowStub,
        Promise,
        setTimeout,
        clearTimeout
    };
    vm.createContext(sandbox);
    vm.runInContext(componentSource, sandbox, {
        filename: 'js/components/questionBankQuickPicker.js'
    });
    const api = windowStub.QuestionBankQuickPicker;
    const picker = api.create({ document: documentStub, global: windowStub, resultLimit: 10 });
    assert.equal(picker.mount(), true);

    return {
        api,
        picker,
        windowStub,
        documentStub,
        warnings,
        elements: { trigger, panel, dialog, title, close, search, status, scopes, results },
        flushAnimationFrames() {
            while (animationFrames.length) {
                animationFrames.shift()();
            }
        },
        fireWindow(type, event = {}) {
            (windowListeners.get(type) || []).forEach((handler) => handler(event));
        }
    };
}

const activeIndex = [
    { id: 'r-p1', category: 'P1', type: 'reading', title: 'Ocean Life', path: 'Reading/One' },
    { id: 'r-p3', category: 'P3', type: 'reading', title: 'Target Passage', path: 'Reading/Three' },
    { id: 'r-p3-extra', category: 'P3', type: 'reading', title: 'Another Target', tags: ['science'] },
    { id: 'l-p1', category: 'P1', type: 'listening', title: 'Target Audio', filename: 'audio-one.html' },
    { id: 'custom', category: 'Custom', type: 'speaking', title: 'Community Interview' }
];

test('trigger naming and focus/scope styles preserve visible, discernible controls', () => {
    const triggerMarkup = indexSource.match(
        /<button(?=[^>]*\bid="question-bank-quick-trigger")[^>]*>[\s\S]*?<\/button>/
    );
    assert(triggerMarkup, 'quick-picker trigger markup must exist');
    const ariaLabel = triggerMarkup[0].match(/\baria-label="([^"]+)"/);
    assert(ariaLabel && ariaLabel[1].includes('题库速查'), 'accessible name must include the visible trigger label');

    assert.match(
        mainCssSource,
        /--question-bank-quick-focus:\s*var\(--question-bank-quick-accent\)/,
        'picker focus indicators must use the solid accent instead of a low-contrast transparent mix'
    );
    assert.match(
        mainCssSource,
        /\.question-bank-quick-trigger:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--color-brand-primary\)/s
    );
    const scopeRule = mainCssSource.match(
        /\.question-bank-quick-picker__scopes\s*>\s*button,\s*\.question-bank-quick-scope\s*\{([^}]*)\}/s
    );
    assert(scopeRule, 'scope button CSS rule must exist');
    assert.match(scopeRule[1], /display:\s*flex/);
    assert.match(scopeRule[1], /gap:\s*10px/);
});

test('pure search uses the full supplied active index and tokenized normalized text', () => {
    const { api, windowStub } = createHarness();
    windowStub.__browseFilter = { category: 'P1', type: 'reading' };
    windowStub.getCurrentCategory = () => {
        throw new Error('browse filter must not be consulted');
    };

    assert.deepEqual(
        api.filterExams(activeIndex, 'target passage').map((exam) => exam.id),
        ['r-p3']
    );
    assert.deepEqual(
        api.filterExams(activeIndex, 'ＴＡＲＧＥＴ 听力').map((exam) => exam.id),
        ['l-p1']
    );
    assert.deepEqual(api.filterExams(activeIndex, '').map((exam) => exam.id), activeIndex.map((exam) => exam.id));
});

test('deriveScopes keeps supported categories separate and omits unsupported Browse scopes', () => {
    const { api } = createHarness();
    const scopes = plain(api.deriveScopes(activeIndex));

    assert.deepEqual(scopes.types.map(({ type, count }) => [type, count]), [
        ['reading', 3],
        ['listening', 1]
    ]);
    assert.deepEqual(scopes.categories.map(({ key, count }) => [key, count]), [
        ['reading::P1', 1],
        ['reading::P3', 2],
        ['listening::P1', 1]
    ]);
});

test('position helpers clamp popovers and compute a desktop modal anchor', () => {
    const { api } = createHarness();
    const position = plain(api.computePanelPosition(
        { left: 950, right: 990, top: 720, bottom: 760 },
        { width: 400, height: 300 },
        { width: 1000, height: 800 }
    ));

    assert.equal(position.placement, 'top');
    assert.equal(position.left, 588);
    assert.ok(position.top >= 12);
    assert.equal(api.computeAnchorTop({ bottom: 120 }, { height: 800 }), 130);
    assert.equal(api.computeAnchorTop({ bottom: 780 }, { height: 800 }), 548);
});

test('open renders loading, dynamic flat scopes, global results, and keyboard selection', async () => {
    let resolveIndex;
    const pendingIndex = new Promise((resolve) => {
        resolveIndex = resolve;
    });
    const harness = createHarness({ resolveActiveLibraryIndex: () => pendingIndex });
    const { picker, elements, documentStub } = harness;
    elements.trigger.focus();

    const opening = picker.open();
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(elements.scopes.getAttribute('aria-busy'), 'true');
    assert.equal(elements.status.dataset.state, 'loading');
    assert.equal(documentStub.activeElement, elements.search);

    resolveIndex(activeIndex);
    await opening;
    assert.equal(elements.scopes.getAttribute('aria-busy'), 'false');
    assert.equal(elements.scopes.children.length, 1 + 2 + 3);
    elements.scopes.children.forEach((button) => {
        assert.equal(button.tagName, 'BUTTON');
        assert.match(button.className, /question-bank-quick-scope/);
        assert.doesNotMatch(button.className, /(?:^|\s)nav-btn(?:\s|$)/);
    });

    elements.search.value = 'target';
    elements.search.fire('input');
    assert.equal(elements.results.hidden, false);
    assert.deepEqual(picker.matches.map((exam) => exam.id), ['r-p3', 'r-p3-extra', 'l-p1']);
    assert.equal(picker.resultElements.length, 3);
    assert.equal(picker.resultElements[0].getAttribute('role'), 'option');
    assert.ok(picker.resultElements[0].id);

    let prevented = false;
    elements.search.fire('keydown', {
        key: 'ArrowDown',
        preventDefault() {
            prevented = true;
        }
    });
    assert.equal(prevented, true);
    assert.equal(picker.resultElements[0].getAttribute('aria-selected'), 'true');
    assert.equal(elements.search.getAttribute('aria-activedescendant'), picker.resultElements[0].id);

    ['Home', 'End'].forEach((key) => {
        let textEditingPrevented = false;
        elements.search.fire('keydown', {
            key,
            preventDefault() {
                textEditingPrevented = true;
            }
        });
        assert.equal(textEditingPrevented, false, `${key} must retain its native text-caret behavior`);
        assert.equal(picker.activeResultIndex, 0);
    });

    elements.search.fire('keydown', {
        key: 'End',
        keyCode: 229,
        isComposing: true,
        preventDefault() {
            throw new Error('IME composition must not move or open a result');
        }
    });
    assert.equal(picker.activeResultIndex, 0);

    picker.resultElements[0].focus();
    elements.results.fire('keydown', {
        target: picker.resultElements[0],
        key: 'End',
        preventDefault() {}
    });
    assert.equal(documentStub.activeElement, picker.resultElements[2]);
    assert.equal(picker.resultElements[2].getAttribute('aria-selected'), 'true');

    elements.search.value = 'no-such-question';
    elements.search.fire('input');
    assert.equal(elements.results.hidden, true);
    assert.equal(elements.search.getAttribute('aria-expanded'), 'false');
    assert.equal(elements.results.children.length, 0, 'an empty listbox must not contain a non-option placeholder');
    assert.equal(elements.status.dataset.state, 'empty');
});

test('reopening drops the previous library snapshot while the next index is pending', async () => {
    const nextIndex = deferred();
    let resolverCall = 0;
    const harness = createHarness({
        resolveActiveLibraryIndex() {
            resolverCall += 1;
            return resolverCall === 1
                ? Promise.resolve([{ id: 'old-exam', category: 'P1', type: 'reading', title: 'Legacy Target' }])
                : nextIndex.promise;
        }
    });
    const { picker, elements } = harness;

    await picker.open();
    elements.search.value = 'legacy';
    elements.search.fire('input');
    assert.deepEqual(picker.matches.map((exam) => exam.id), ['old-exam']);
    assert.equal(picker.resultElements.length, 1);

    picker.close();
    const reopening = picker.open();
    assert.deepEqual(plain(picker.index), []);
    assert.deepEqual(plain(picker.matches), []);
    assert.equal(elements.results.hidden, true);

    elements.search.fire('input');
    assert.deepEqual(plain(picker.matches), []);
    assert.equal(picker.resultElements.length, 0);
    assert.equal(elements.results.hidden, true, 'typing during refresh must not reveal the old library');

    nextIndex.resolve([{ id: 'new-exam', category: 'P2', type: 'reading', title: 'Fresh Target' }]);
    await reopening;
    assert.deepEqual(picker.index.map((exam) => exam.id), ['new-exam']);
    assert.deepEqual(plain(picker.matches), [], 'the retained query must not match the old snapshot after refresh');
});

test('settling an action from a closed session cannot close or overwrite a reopened picker', async () => {
    const successfulAction = deferred();
    const successfulActionStarted = deferred();
    const rejectedAction = deferred();
    const rejectedActionStarted = deferred();
    let actionCall = 0;
    const harness = createHarness({ resolveActiveLibraryIndex: () => Promise.resolve(activeIndex) });
    const { picker, windowStub, elements, warnings } = harness;
    windowStub.ensureBrowseGroup = () => Promise.resolve();
    windowStub.app = {
        openExam() {
            actionCall += 1;
            if (actionCall === 1) {
                successfulActionStarted.resolve();
                return successfulAction.promise;
            }
            rejectedActionStarted.resolve();
            return rejectedAction.promise;
        }
    };

    await picker.open();
    const staleSuccess = picker.openExam('r-p1');
    await successfulActionStarted.promise;
    picker.close();
    await picker.open();
    const readyStatusAfterSuccessReopen = elements.status.textContent;
    assert.equal(picker._actionPending, false, 'closing must release the action lock for the next session');

    successfulAction.resolve({ window: {} });
    assert.equal(await staleSuccess, false);
    assert.equal(picker.isOpen, true);
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.status.textContent, readyStatusAfterSuccessReopen);

    const staleFailure = picker.openExam('r-p3');
    await rejectedActionStarted.promise;
    picker.close();
    await picker.open();
    const readyStatusAfterFailureReopen = elements.status.textContent;
    const warningCount = warnings.length;

    rejectedAction.reject(new Error('stale open failed'));
    assert.equal(await staleFailure, false);
    assert.equal(picker.isOpen, true);
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.status.textContent, readyStatusAfterFailureReopen);
    assert.equal(warnings.length, warningCount, 'a stale rejection must not report against the new session');
});

test('category and exam actions await Browse, clear stale search, and call app APIs', async () => {
    const calls = [];
    const harness = createHarness({ resolveActiveLibraryIndex: () => Promise.resolve(activeIndex) });
    const { picker, windowStub, documentStub, elements } = harness;
    const browseSearch = documentStub.register('#exam-search-input', documentStub.createElement('input'));
    const browseClear = documentStub.register('#search-clear-btn', documentStub.createElement('button'));
    browseSearch.value = 'old filter';
    browseClear.hidden = false;
    windowStub.ensureBrowseGroup = async () => {
        calls.push('ensure');
    };
    windowStub.browseStateManager = {
        clearSearchState() {
            calls.push('clear');
        }
    };
    windowStub.app = {
        browseCategory(category, type) {
            calls.push(`browse:${category}:${type}`);
        },
        openExam(examId) {
            calls.push(`open:${examId}`);
            return { closed: false };
        }
    };

    elements.trigger.focus();
    await picker.open();
    assert.equal(await picker.browseScope('reading', 'P3'), true);
    assert.deepEqual(calls, ['ensure', 'clear', 'browse:P3:reading']);
    assert.equal(browseSearch.value, '');
    assert.equal(browseClear.hidden, true);
    assert.equal(elements.panel.hidden, true);
    assert.equal(documentStub.activeElement, elements.trigger);

    calls.length = 0;
    elements.trigger.focus();
    await picker.open();
    assert.equal(await picker.openExam('l-p1'), true);
    assert.deepEqual(calls, ['ensure', 'open:l-p1']);

    calls.length = 0;
    await picker.open();
    windowStub.app.openExam = (examId) => {
        calls.push(`open:${examId}`);
        return null;
    };
    assert.equal(await picker.openExam('l-p1'), false);
    assert.deepEqual(calls, ['ensure', 'open:l-p1']);
    assert.equal(picker.isOpen, true, 'a null production launch result must preserve the search context');
    assert.equal(elements.panel.hidden, false);
    assert.equal(elements.status.dataset.state, 'error');
});

test('empty and rejected active indexes expose stable empty/error states', async () => {
    const emptyHarness = createHarness({ resolveActiveLibraryIndex: () => Promise.resolve([]) });
    await emptyHarness.picker.open();
    assert.equal(emptyHarness.elements.status.dataset.state, 'empty');
    assert.equal(emptyHarness.elements.results.hidden, true);
    assert.equal(emptyHarness.elements.scopes.getAttribute('aria-busy'), 'false');

    const errorHarness = createHarness({
        resolveActiveLibraryIndex: () => Promise.reject(new Error('index failed'))
    });
    await errorHarness.picker.open();
    assert.equal(errorHarness.elements.status.dataset.state, 'error');
    assert.equal(errorHarness.elements.results.hidden, true);
    assert.equal(errorHarness.warnings.length, 1);
});

test('backdrop, outside click, Escape, focus trap, and resize preserve modal behavior', async () => {
    const harness = createHarness({ resolveActiveLibraryIndex: () => Promise.resolve(activeIndex) });
    const { picker, documentStub, windowStub, elements } = harness;
    elements.trigger.focus();
    await picker.open();

    assert.equal(elements.panel.style.getPropertyValue('--question-bank-quick-anchor-top'), '144px');
    documentStub.fire('pointerdown', { target: elements.dialog });
    assert.equal(picker.isOpen, true, 'clicking inside the dialog must keep it open');
    documentStub.fire('pointerdown', { target: elements.panel });
    assert.equal(picker.isOpen, false, 'clicking the backdrop must close it');
    assert.equal(documentStub.activeElement, elements.trigger);

    await picker.open();
    elements.search.value = 'target';
    picker.renderResults('target');
    const focusables = elements.dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    focusables.at(-1).focus();
    let tabPrevented = false;
    documentStub.fire('keydown', {
        key: 'Tab',
        shiftKey: false,
        preventDefault() {
            tabPrevented = true;
        }
    });
    assert.equal(tabPrevented, true);
    assert.equal(documentStub.activeElement, focusables[0]);

    elements.trigger.rect.bottom = 200;
    harness.fireWindow('resize');
    harness.flushAnimationFrames();
    assert.equal(elements.panel.style.getPropertyValue('--question-bank-quick-anchor-top'), '210px');
    windowStub.innerWidth = 600;
    harness.fireWindow('resize');
    harness.flushAnimationFrames();
    assert.equal(elements.panel.style.getPropertyValue('--question-bank-quick-anchor-top'), '');

    let composingEscapePrevented = false;
    documentStub.fire('keydown', {
        key: 'Escape',
        keyCode: 229,
        isComposing: true,
        preventDefault() {
            composingEscapePrevented = true;
        }
    });
    assert.equal(composingEscapePrevented, false, 'IME Escape must retain composition behavior');
    assert.equal(picker.isOpen, true, 'IME Escape must not close the picker');

    let escapePrevented = false;
    documentStub.fire('keydown', {
        key: 'Escape',
        preventDefault() {
            escapePrevented = true;
        }
    });
    assert.equal(escapePrevented, true);
    assert.equal(elements.panel.hidden, true);
    assert.equal(elements.trigger.getAttribute('aria-expanded'), 'false');
});
