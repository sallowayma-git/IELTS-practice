#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}
function createWebStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        },
        dump() {
            return new Map(map);
        }
    };
}
class ClassList {
    constructor(owner) {
        this.owner = owner;
        this._set = new Set();
    }
    add(...tokens) {
        tokens.forEach((token) => {
            if (token) {
                this._set.add(String(token));
            }
        });
        this._sync();
    }
    remove(...tokens) {
        tokens.forEach((token) => {
            this._set.delete(String(token));
        });
        this._sync();
    }
    toggle(token, force) {
        const normalized = String(token);
        if (force === true) {
            this._set.add(normalized);
            this._sync();
            return true;
        }
        if (force === false) {
            this._set.delete(normalized);
            this._sync();
            return false;
        }
        if (this._set.has(normalized)) {
            this._set.delete(normalized);
            this._sync();
            return false;
        }
        this._set.add(normalized);
        this._sync();
        return true;
    }
    contains(token) {
        return this._set.has(String(token));
    }
    _sync() {
        this.owner.className = Array.from(this._set).join(' ');
    }
}
class ElementStub {
    constructor(tagName, ownerDocument) {
        this.tagName = String(tagName || 'div').toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.parentNode = null;
        this.parentElement = null;
        this.dataset = {};
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
        this.classList = new ClassList(this);
        this.textContent = '';
        this.innerHTML = '';
        this.value = '';
        this.type = '';
        this.checked = false;
        this.disabled = false;
        this.selectedIndex = 0;
        this.scrollTop = 0;
        this.scrollHeight = 0;
        this.id = '';
    }
    appendChild(child) {
        if (!child) {
            return child;
        }
        child.parentNode = this;
        child.parentElement = this;
        this.children.push(child);
        if (child.id) {
            this.ownerDocument._register(child);
        }
        return child;
    }
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) {
            this.children.splice(index, 1);
            child.parentNode = null;
            child.parentElement = null;
        }
        return child;
    }
    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }
    insertBefore(child, referenceNode) {
        if (!referenceNode) {
            return this.appendChild(child);
        }
        const index = this.children.indexOf(referenceNode);
        if (index < 0) {
            return this.appendChild(child);
        }
        child.parentNode = this;
        child.parentElement = this;
        this.children.splice(index, 0, child);
        if (child.id) {
            this.ownerDocument._register(child);
        }
        return child;
    }
    normalize() {}
    setAttribute(name, value) {
        const normalized = String(name);
        const rawValue = String(value);
        this.attributes.set(normalized, rawValue);
        if (normalized === 'id') {
            this.id = rawValue;
            this.ownerDocument._register(this);
        } else if (normalized === 'class') {
            this.className = rawValue;
            this.classList = new ClassList(this);
            rawValue.split(/\s+/).filter(Boolean).forEach((token) => this.classList.add(token));
        } else if (normalized.startsWith('data-')) {
            const key = normalized
                .slice(5)
                .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            this.dataset[key] = rawValue;
        } else {
            this[normalized] = rawValue;
        }
    }
    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    removeAttribute(name) {
        this.attributes.delete(String(name));
    }
    addEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, []);
        }
        this.listeners.get(type).push(handler);
    }
    removeEventListener(type, handler) {
        if (!this.listeners.has(type)) {
            return;
        }
        this.listeners.set(type, this.listeners.get(type).filter((entry) => entry !== handler));
    }
    dispatchEvent(event) {
        const payload = event || {};
        payload.target = payload.target || this;
        payload.currentTarget = this;
        payload.preventDefault = payload.preventDefault || (() => {});
        payload.stopPropagation = payload.stopPropagation || (() => {});
        const handlers = this.listeners.get(payload.type) || [];
        handlers.forEach((handler) => handler.call(this, payload));
        return true;
    }
    click(options = {}) {
        return this.dispatchEvent({
            type: 'click',
            shiftKey: !!options.shiftKey,
            target: options.target || this
        });
    }
    focus() {
        this.ownerDocument.activeElement = this;
    }
    contains(node) {
        if (!node) {
            return false;
        }
        if (node === this) {
            return true;
        }
        return this.children.some((child) => child.contains(node));
    }
    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
    matches(selector) {
        return matchesSelector(this, selector);
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
        return queryAll(this, selector);
    }
    cloneNode(deep = false) {
        const clone = new ElementStub(this.tagName, this.ownerDocument);
        clone.className = this.className;
        clone.classList = new ClassList(clone);
        this.className.split(/\s+/).filter(Boolean).forEach((token) => clone.classList.add(token));
        clone.dataset = { ...this.dataset };
        clone.style = { ...this.style };
        clone.textContent = this.textContent;
        clone.innerHTML = this.innerHTML;
        clone.value = this.value;
        clone.type = this.type;
        clone.checked = this.checked;
        clone.disabled = this.disabled;
        if (deep) {
            this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
        }
        return clone;
    }
    getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 20 };
    }
    scrollTo() {}
    scrollIntoView() {}
}
function walk(node, visit) {
    if (!node) {
        return;
    }
    node.children.forEach((child) => {
        visit(child);
        walk(child, visit);
    });
}
function matchesSimpleSelector(element, selector) {
    if (!selector || !element) {
        return false;
    }
    const trimmed = selector.trim();
    if (!trimmed) {
        return false;
    }
    const attrMatch = trimmed.match(/^([a-z]+)?\[([^=\]]+)(?:=\"([^\"]*)\")?\]$/i);
    if (attrMatch) {
        const [, tagName, attribute, value] = attrMatch;
        if (tagName && element.tagName.toLowerCase() !== tagName.toLowerCase()) {
            return false;
        }
        if (attribute.startsWith('data-')) {
            const key = attribute
                .slice(5)
                .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) {
                return false;
            }
            return value === undefined ? true : String(element.dataset[key]) === value;
        }
        const actual = element[attribute] ?? element.getAttribute(attribute);
        return value === undefined ? actual != null : String(actual) === value;
    }
    const compoundMatch = trimmed.match(/^\.([a-z0-9_-]+)(\[.+\])$/i);
    if (compoundMatch) {
        return element.classList.contains(compoundMatch[1]) && matchesSimpleSelector(element, compoundMatch[2]);
    }
    if (trimmed.startsWith('.')) {
        return element.classList.contains(trimmed.slice(1));
    }
    if (trimmed.startsWith('#')) {
        return element.id === trimmed.slice(1);
    }
    return element.tagName.toLowerCase() === trimmed.toLowerCase();
}
function matchesSelector(element, selector) {
    if (!selector) {
        return false;
    }
    return selector
        .split(',')
        .some((part) => {
            const pieces = part.trim().split(/\s+/).filter(Boolean);
            if (pieces.length === 0) {
                return false;
            }
            let current = element;
            for (let index = pieces.length - 1; index >= 0; index -= 1) {
                const piece = pieces[index];
                while (current && !matchesSimpleSelector(current, piece)) {
                    current = current.parentElement;
                }
                if (!current) {
                    return false;
                }
                current = current.parentElement;
            }
            return true;
        });
}
function queryAll(root, selector) {
    const results = [];
    walk(root, (node) => {
        if (matchesSelector(node, selector)) {
            results.push(node);
        }
    });
    return results;
}
function createDocumentStub() {
    const listenerMap = new Map();
    const elementsById = new Map();
    const document = {
        readyState: 'loading',
        listeners: listenerMap,
        activeElement: null,
        head: null,
        body: null,
        documentElement: null,
        addEventListener(type, handler) {
            if (!listenerMap.has(type)) {
                listenerMap.set(type, []);
            }
            listenerMap.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            if (!listenerMap.has(type)) {
                return;
            }
            listenerMap.set(type, listenerMap.get(type).filter((entry) => entry !== handler));
        },
        dispatchEvent(event) {
            const payload = event || {};
            payload.target = payload.target || document;
            payload.currentTarget = document;
            payload.preventDefault = payload.preventDefault || (() => {});
            payload.stopPropagation = payload.stopPropagation || (() => {});
            const handlers = listenerMap.get(payload.type) || [];
            handlers.forEach((handler) => handler.call(document, payload));
            return true;
        },
        createElement(tagName) {
            return new ElementStub(tagName, document);
        },
        getElementById(id) {
            return elementsById.get(String(id)) || null;
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        querySelectorAll(selector) {
            const roots = [document.head, document.body].filter(Boolean);
            return roots.flatMap((root) => queryAll(root, selector));
        },
        _register(element) {
            if (element && element.id) {
                elementsById.set(String(element.id), element);
            }
        }
    };
    document.documentElement = new ElementStub('html', document);
    document.head = new ElementStub('head', document);
    document.body = new ElementStub('body', document);
    document.documentElement.appendChild(document.head);
    document.documentElement.appendChild(document.body);
    return document;
}
function createBaseElement(document, tagName, options = {}) {
    const element = document.createElement(tagName);
    if (options.id) {
        element.id = options.id;
        document._register(element);
    }
    if (options.className) {
        options.className.split(/\s+/).filter(Boolean).forEach((token) => element.classList.add(token));
    }
    if (options.dataset) {
        Object.assign(element.dataset, options.dataset);
    }
    if (options.textContent) {
        element.textContent = options.textContent;
    }
    if (options.type) {
        element.type = options.type;
    }
    if (options.value) {
        element.value = options.value;
    }
    if (options.style) {
        Object.assign(element.style, options.style);
    }
    return element;
}
function append(document, parent, tagName, options = {}) {
    const element = createBaseElement(document, tagName, options);
    parent.appendChild(element);
    return element;
}
function buildHarness(options = {}) {
    const document = createDocumentStub();
    document.body.dataset.examId = 'reading-p1';
    document.body.dataset.suiteMode = 'false';
    const windowListeners = new Map();
    const openerMessages = [];
    const shell = append(document, document.body, 'div', { className: 'shell' });
    append(document, shell, 'div', { id: 'left', className: 'pane' });
    const rightPane = append(document, shell, 'div', { id: 'right', className: 'pane' });
    const results = append(document, rightPane, 'div', { id: 'results' });
    append(document, document.body, 'div', { className: 'overlay' });
    append(document, document.body, 'div', { id: 'settings-panel' });
    append(document, document.body, 'div', { id: 'notes-panel' });
    append(document, document.body, 'div', { className: 'header-controls' });
    append(document, document.body, 'button', { id: 'settings-btn', type: 'button' });
    append(document, document.body, 'button', { id: 'note-btn', type: 'button' });
    append(document, document.body, 'button', { id: 'close-note', type: 'button' });
    const submitBtn = append(document, document.body, 'button', { id: 'submit-btn', type: 'button' });
    const resetBtn = append(document, document.body, 'button', { id: 'reset-btn', type: 'button' });
    const exitBtn = append(document, document.body, 'button', {
        id: 'exit-btn',
        type: 'button',
        style: { display: 'none' }
    });
    append(document, document.body, 'div', { id: 'suite-flow-mode-section' });
    const questionsContainer = append(document, document.body, 'div', { id: 'questions-container' });
    append(document, questionsContainer, 'input', { id: 'q1-input', type: 'text', value: 'A' });
    append(document, questionsContainer, 'textarea', { id: 'q2-input', value: 'note' });
    append(document, questionsContainer, 'select', { id: 'q3-input' });
    const navContainer = append(document, document.body, 'div', { className: 'practice-nav' });
    const q1 = append(document, navContainer, 'button', {
        id: 'q1-nav',
        className: 'q-item',
        type: 'button',
        dataset: { question: 'q1' },
        textContent: '1'
    });
    const q2 = append(document, navContainer, 'button', {
        id: 'q2-nav',
        className: 'q-item',
        type: 'button',
        dataset: { questionId: 'q2-anchor' },
        textContent: '2'
    });
    const q3 = append(document, navContainer, 'button', {
        id: 'q3-nav',
        className: 'q-item',
        type: 'button',
        dataset: { question: 'q3' },
        textContent: 'Question 3'
    });
    const sessionStorage = createWebStorage();
    const localStorage = createWebStorage();
    const closeLog = [];
    const locationReplaceLog = [];
    let electronOpenLegacyCalls = 0;
    const openerStub = {
        closed: false,
        messages: openerMessages,
        postMessage(message, origin) {
            openerMessages.push({ message, origin });
        },
        stopEndlessPracticeCalled: 0,
        stopEndlessPractice() {
            this.stopEndlessPracticeCalled += 1;
        }
    };
    if (options.markedQuestions) {
        sessionStorage.setItem(
            'practice_marked_questions::reading-p1',
            JSON.stringify(options.markedQuestions)
        );
    }
    const windowStub = {
        document,
        sessionStorage,
        localStorage,
        location: {
            href: 'file:///Users/test/practice.html',
            pathname: '/Users/test/practice.html',
            search: '?examId=reading-p1',
            origin: 'null',
            replace(nextUrl) {
                const normalized = String(nextUrl || '');
                this.href = normalized;
                if (normalized.startsWith('file://')) {
                    this.pathname = decodeURIComponent(normalized.replace(/^file:\/\//, '').split(/[?#]/)[0]);
                }
                locationReplaceLog.push(normalized);
            }
        },
        navigator: {},
        opener: options.withoutOpener ? null : openerStub,
        parent: null,
        console: {
            log() {},
            warn() {},
            error() {},
            info() {}
        },
        addEventListener(type, handler) {
            if (!windowListeners.has(type)) {
                windowListeners.set(type, []);
            }
            windowListeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            if (!windowListeners.has(type)) {
                return;
            }
            windowListeners.set(type, windowListeners.get(type).filter((entry) => entry !== handler));
        },
        getSelection() {
            return {
                removeAllRanges() {},
                toString() { return ''; }
            };
        },
        getComputedStyle() {
            return { position: 'relative', display: 'block' };
        },
        close() {
            closeLog.push('closed');
        },
        requestAnimationFrame(callback) {
            if (typeof callback === 'function') {
                callback();
            }
            return 1;
        },
        cancelAnimationFrame() {},
        MutationObserver: class MutationObserver {
            constructor(callback) {
                this.callback = callback;
            }
            observe() {}
            disconnect() {}
        },
        __UNIFIED_READING_SIMULATION_MODE__: options.simulationMode === true
    };
    if (options.withElectronAPI) {
        windowStub.electronAPI = {
            openLegacy() {
                electronOpenLegacyCalls += 1;
            }
        };
    }
    const sandbox = {
        window: windowStub,
        document,
        console: windowStub.console,
        localStorage,
        sessionStorage,
        URLSearchParams,
        MutationObserver: windowStub.MutationObserver,
        HTMLElement: ElementStub,
        Node: { TEXT_NODE: 3 },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: windowStub.requestAnimationFrame,
        cancelAnimationFrame: windowStub.cancelAnimationFrame,
        Math,
        JSON,
        Date
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.window = sandbox.window;
    sandbox.window.self = sandbox.window;
    sandbox.window.top = sandbox.window;
    sandbox.window.HTMLElement = ElementStub;
    sandbox.window.Node = sandbox.Node;
    sandbox.window.URLSearchParams = URLSearchParams;
    const context = vm.createContext(sandbox);
    loadScript('js/practice-page-ui.js', context);
    document.dispatchEvent({ type: 'DOMContentLoaded', target: document });
    return {
        context,
        windowStub,
        document,
        elements: { submitBtn, resetBtn, exitBtn, navContainer, q1, q2, q3, results },
        closeLog,
        locationReplaceLog,
        getElectronOpenLegacyCalls() {
            return electronOpenLegacyCalls;
        },
        openerMessages,
        openerStub,
        dispatchWindowMessage(message) {
            const handlers = windowListeners.get('message') || [];
            handlers.forEach((handler) => handler.call(windowStub, { type: 'message', data: message }));
        }
    };
}
function testMarkedQuestionsRestoreAndNormalize() {
    const harness = buildHarness({
        markedQuestions: ['1', 'q2-anchor', '3', '', null]
    });
    assert.deepStrictEqual(
        Array.from(harness.windowStub.getPracticeMarkedQuestions()),
        ['q1', 'q2', 'q3'],
        '初始化时应从 sessionStorage 恢复并规范化 marked questions'
    );
    assert.strictEqual(harness.elements.q1.classList.contains('marked'), true, 'q1 nav 应被标记');
    assert.strictEqual(harness.elements.q2.classList.contains('marked'), true, 'q2 nav 应被标记');
    assert.strictEqual(harness.elements.q3.classList.contains('marked'), true, 'q3 nav 应被标记');
    assert.strictEqual(harness.elements.q1.getAttribute('title'), '已标记（Shift+点击可取消）', '标记 nav 应写入 title');
}
function testSetMarkedQuestionsPersistsNormalizedPayload() {
    const harness = buildHarness();
    harness.windowStub.setPracticeMarkedQuestions(['Q1-anchor', '2', 'q2-target', null, '']);
    assert.deepStrictEqual(
        Array.from(harness.windowStub.getPracticeMarkedQuestions()),
        ['q1', 'q2'],
        'setPracticeMarkedQuestions 应只保留规范化后的题号'
    );
    assert.strictEqual(
        harness.windowStub.sessionStorage.getItem('practice_marked_questions::reading-p1'),
        JSON.stringify(['q1', 'q2']),
        'setPracticeMarkedQuestions 应把规范化结果写回 sessionStorage'
    );
    harness.elements.navContainer.dispatchEvent({
        type: 'click',
        target: harness.elements.q2,
        shiftKey: true
    });
    assert.deepStrictEqual(
        Array.from(harness.windowStub.getPracticeMarkedQuestions()),
        ['q1'],
        'Shift+点击 nav item 应切换 marked 状态'
    );
}
function testSimulationModeBlocksSubmitAndResetLock() {
    const harness = buildHarness({ simulationMode: true });
    harness.elements.submitBtn.click();
    harness.elements.resetBtn.click();
    assert.strictEqual(harness.elements.submitBtn.disabled, false, 'simulation mode 下 submit 不应锁死页面');
    assert.strictEqual(harness.elements.resetBtn.disabled, false, 'simulation mode 下 reset 不应被顺带锁死');
    assert.strictEqual(harness.elements.exitBtn.style.display, 'none', 'simulation mode 下 submit 不应显示 exit');
}
function testPracticeResultsReadyRendersSummaryAndNavState() {
    const harness = buildHarness();
    const q1Input = harness.document.getElementById('q1-input');
    const q2Input = harness.document.getElementById('q2-input');
    const q3Input = harness.document.getElementById('q3-input');
    harness.document.dispatchEvent({
        type: 'practiceResultsReady',
        detail: {
            status: 'final',
            allQuestionIds: ['q1', 'q2', 'q3'],
            answers: {
                q1: 'A',
                q2: 'B',
                q3: 'C'
            },
            correctAnswers: {
                q1: 'A',
                q2: 'D'
            },
            answerComparison: {
                q1: {
                    userAnswer: 'A',
                    correctAnswer: 'A',
                    isCorrect: true
                },
                q2: {
                    userAnswer: 'B',
                    correctAnswer: 'D',
                    isCorrect: false
                }
            }
        }
    });
    assert.strictEqual(harness.elements.results.style.display, 'block', 'final 结果事件后应显示 results 区域');
    assert.strictEqual(harness.elements.results.classList.contains('practice-results-visible'), true, 'results 区域应带可见标记');
    assert.strictEqual(harness.elements.q1.classList.contains('correct'), true, 'q1 应映射为 correct nav 状态');
    assert.strictEqual(harness.elements.q2.classList.contains('incorrect'), true, 'q2 应映射为 incorrect nav 状态');
    assert.strictEqual(harness.elements.q3.classList.contains('answered'), true, 'q3 无判分时应保留 answered nav 状态');
    assert.strictEqual(q1Input.classList.contains('answer-correct'), true, 'q1 输入应高亮为 correct');
    assert.strictEqual(q2Input.classList.contains('answer-wrong'), true, 'q2 输入应高亮为 wrong');
    assert.strictEqual(q3Input.classList.contains('answer-correct'), false, 'q3 无判分时不应错误标注为 correct');
    assert.strictEqual(q3Input.classList.contains('answer-wrong'), false, 'q3 无判分时不应错误标注为 wrong');
}
function testPracticeResultsPendingContract() {
    const harness = buildHarness();
    harness.document.dispatchEvent({
        type: 'practiceResultsReady',
        detail: {
            status: 'preliminary',
            answers: { q1: 'A' }
        }
    });
    assert.strictEqual(harness.elements.results.style.display, 'block', 'preliminary 事件也应显示 results 区域');
    assert.strictEqual(harness.elements.results.classList.contains('practice-results-pending'), true, 'preliminary 事件应进入 pending 状态');
    assert.strictEqual(harness.elements.submitBtn.disabled, false, 'preliminary 事件不应触发提交锁定');
    assert.strictEqual(harness.elements.resetBtn.disabled, false, 'preliminary 事件不应触发重置锁定');
}
function testLiveModeSubmitLocksButDoesNotRevealExitBeforeFinalization() {
    const harness = buildHarness({ simulationMode: false });
    harness.elements.submitBtn.click();
    assert.strictEqual(harness.elements.submitBtn.disabled, true, 'live mode 下 submit 后应禁用 submit');
    assert.strictEqual(harness.elements.resetBtn.disabled, true, 'live mode 下 submit 后应禁用 reset');
    assert.strictEqual(harness.elements.exitBtn.style.display, 'none', 'live mode 下 submit 后在最终结果落地前不应显示 exit');
}
function testEmbeddedModeSubmitKeepsExitVisible() {
    const harness = buildHarness({ simulationMode: false, withoutOpener: true });
    harness.windowStub.parent = harness.openerStub;
    harness.elements.submitBtn.click();
    assert.strictEqual(harness.elements.exitBtn.style.display, 'block', '内嵌模式下应在原生顶部栏保留可见 Exit');
}
function testSubmissionFinalizedRevealsExitAndClosesWindow() {
    const harness = buildHarness({ simulationMode: false });
    harness.elements.submitBtn.click();
    harness.document.dispatchEvent({
        type: 'practiceSubmissionFinalized',
        detail: { status: 'final' }
    });
    assert.strictEqual(harness.elements.exitBtn.style.display, 'block', '最终结果落地后应显示 exit');
    harness.elements.exitBtn.click();
    assert.strictEqual(harness.openerMessages.length, 1, '点击 exit 应先向父页发送 PRACTICE_EXIT');
    assert.strictEqual(harness.openerMessages[0].message.type, 'PRACTICE_EXIT', '退出消息类型应为 PRACTICE_EXIT');
    assert.strictEqual(harness.closeLog.length, 1, '点击 exit 应调用 window.close');
}
function testLiveModeExitUsesElectronNavigationWhenAvailable() {
    const harness = buildHarness({ simulationMode: false, withElectronAPI: true });
    harness.elements.submitBtn.click();
    harness.document.dispatchEvent({
        type: 'practiceSubmissionFinalized',
        detail: { status: 'final' }
    });
    harness.elements.exitBtn.click();
    assert.strictEqual(harness.openerMessages.length, 1, 'Electron 环境下有父页时应优先发送 PRACTICE_EXIT');
    assert.strictEqual(harness.openerMessages[0].message.type, 'PRACTICE_EXIT', 'Electron 环境下退出消息类型应为 PRACTICE_EXIT');
    assert.strictEqual(harness.getElectronOpenLegacyCalls(), 0, '有父页时不应触发 openLegacy');
    assert.strictEqual(harness.closeLog.length, 1, 'Electron 环境下有父页时应关闭当前窗口');
}
function testEmbeddedExitOnlyNotifiesParentAndDoesNotCloseSelf() {
    const harness = buildHarness({ simulationMode: false, withoutOpener: true, withElectronAPI: true });
    harness.windowStub.parent = harness.openerStub;
    harness.elements.submitBtn.click();
    harness.document.dispatchEvent({
        type: 'practiceSubmissionFinalized',
        detail: { status: 'final' }
    });
    harness.elements.exitBtn.click();
    assert.strictEqual(harness.openerMessages.length, 1, '内嵌模式应发送 PRACTICE_EXIT 到父页');
    assert.strictEqual(harness.openerMessages[0].message.type, 'PRACTICE_EXIT', '内嵌退出消息类型应为 PRACTICE_EXIT');
    assert.strictEqual(harness.getElectronOpenLegacyCalls(), 0, '内嵌模式不应触发 openLegacy');
    assert.strictEqual(harness.closeLog.length, 0, '内嵌模式不应尝试关闭自身窗口');
}
function testLiveModeExitFallsBackToIndexWhenNoElectronAndNoOpener() {
    const harness = buildHarness({ simulationMode: false, withoutOpener: true });
    harness.elements.submitBtn.click();
    harness.document.dispatchEvent({
        type: 'practiceSubmissionFinalized',
        detail: { status: 'final' }
    });
    harness.elements.exitBtn.click();
    assert.strictEqual(harness.closeLog.length, 0, '无 opener 且无 Electron API 时不应直接关闭窗口');
    assert.strictEqual(harness.locationReplaceLog.length, 1, '无 opener 且无 Electron API 时应回退到 index.html');
    assert.strictEqual(
        harness.locationReplaceLog[0],
        'file:///Users/test/index.html',
        '无 opener 且无 Electron API 时应回退到同目录 index.html'
    );
}
function testSuiteModeUiContractStaysHidden() {
    const harness = buildHarness();
    const suiteFlowModeSection = harness.document.getElementById('suite-flow-mode-section');
    harness.windowStub.updatePracticeSuiteModeUI(true);
    assert.strictEqual(suiteFlowModeSection.style.display, 'none', 'suite mode UI 同步后设置区入口仍应保持隐藏');
    harness.windowStub.updatePracticeSuiteModeUI(false);
    assert.strictEqual(suiteFlowModeSection.style.display, 'none', '非 suite mode 也不应重新暴露已废弃的 flow mode 切换');
}
function testEndlessCountdownExitContract() {
    const harness = buildHarness();
    harness.dispatchWindowMessage({
        type: 'ENDLESS_COUNTDOWN',
        data: { seconds: 4 }
    });
    assert.strictEqual(harness.elements.exitBtn.style.display, 'block', 'ENDLESS_COUNTDOWN 后应显示退出按钮');
    assert.strictEqual(harness.elements.exitBtn.textContent, '退出无尽模式', 'ENDLESS_COUNTDOWN 后应切换退出按钮文案');
    harness.elements.exitBtn.onclick();
    assert.strictEqual(harness.openerMessages.length, 1, '退出无尽模式时应通知 opener');
    assert.strictEqual(harness.openerMessages[0].message.type, 'ENDLESS_USER_EXIT', '退出无尽模式时应发送 ENDLESS_USER_EXIT');
    assert.strictEqual(harness.openerMessages[0].origin, '*', 'ENDLESS_USER_EXIT 仍应保持 file:// 兼容的 postMessage 目标');
    assert.strictEqual(harness.openerStub.stopEndlessPracticeCalled, 1, '退出无尽模式时应尝试调用 opener.stopEndlessPractice');
    assert.strictEqual(harness.closeLog.length, 1, '退出无尽模式后应关闭当前窗口');
}
function testEndlessCountdownCompletionRestoresExitVisibility() {
    const harness = buildHarness();
    harness.dispatchWindowMessage({
        type: 'ENDLESS_COUNTDOWN',
        data: { seconds: 1 }
    });
    assert.strictEqual(harness.elements.exitBtn.style.display, 'block', 'ENDLESS_COUNTDOWN 激活时应显示 exit');
    harness.dispatchWindowMessage({
        type: 'ENDLESS_COUNTDOWN_TICK',
        data: { seconds: 0 }
    });
    assert.strictEqual(harness.elements.exitBtn.style.display, 'none', 'ENDLESS_COUNTDOWN 结束后不应残留 exit');
}
function main() {
    try {
        testMarkedQuestionsRestoreAndNormalize();
        testSetMarkedQuestionsPersistsNormalizedPayload();
        testSimulationModeBlocksSubmitAndResetLock();
        testPracticeResultsReadyRendersSummaryAndNavState();
        testPracticeResultsPendingContract();
        testLiveModeSubmitLocksButDoesNotRevealExitBeforeFinalization();
        testEmbeddedModeSubmitKeepsExitVisible();
        testSubmissionFinalizedRevealsExitAndClosesWindow();
        testLiveModeExitUsesElectronNavigationWhenAvailable();
        testEmbeddedExitOnlyNotifiesParentAndDoesNotCloseSelf();
        testLiveModeExitFallsBackToIndexWhenNoElectronAndNoOpener();
        testSuiteModeUiContractStaysHidden();
        testEndlessCountdownExitContract();
        testEndlessCountdownCompletionRestoresExitVisibility();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'practice-page-ui 已覆盖 marked questions、practiceResultsReady 结果链路、simulation mode、suite mode UI、endless exit 与无 opener 回退 index 合同'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}
main();
