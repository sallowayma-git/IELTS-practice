#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');

const originalConsoleLog = (console && typeof console.log === 'function')
    ? console.log.bind(console)
    : null;

function emitResult(payload) {
    const text = JSON.stringify(payload, null, 2);
    try {
        if (process && process.stdout && typeof process.stdout.write === 'function') {
            process.stdout.write(text + '\n');
            return;
        }
    } catch (_) {}
    if (typeof originalConsoleLog === 'function') {
        originalConsoleLog(text);
    }
}

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function patchVocabSessionView(source) {
    const hook = `
    window.__VocabSessionViewTestHooks = {
        state,
        resetSessionState,
        handlePrimaryButtonClick,
        updatePrimaryAction,
        prepareSessionQueue,
        startReviewFlow,
        startBatch,
        moveToNextWord,
        revealMeaning,
        submitSpelling,
        applyResult,
        handleCardAction,
        toggleSidePanel,
        saveCurrentNote,
        openSettingsModal,
        closeSettingsModal,
        handleSettingsSubmit,
        handleImportRequest,
        handleImportInputChange,
        performImport,
        handleExportRequest,
        updateProgressStats,
        setSidePanelExpanded,
        showDueBanner,
        hideDueBanner,
        ensureListSwitcher,
        handleListSwitch,
        updateSidePanelContent,
        updateSidePanelMode,
        closeMenu,
        bindEvents,
        toggleMenu,
        setElements: (elements) => { state.elements = elements || {}; },
        setStore: (store) => { state.store = store; },
        setScheduler: (scheduler) => { state.scheduler = scheduler; },
        setContainer: (container) => { state.container = container; },
        setRender: (fn) => { render = fn; },
        setViewport: (isMobile) => { state.viewport.isMobile = !!isMobile; }
    };
`;

    return source.replace('const api = {', `${hook}\n    const api = {`);
}

function patchMoreView(source) {
    const hook = `
    global.__MoreViewTestHooks = {
        handleVocabEntry,
        setupMoreViewInteractions
    };
`;
    return source.replace('function init() {', `${hook}\n    function init() {`);
}

function createClassList(initial = []) {
    const set = new Set(initial);
    return {
        add: (...names) => names.forEach((name) => set.add(name)),
        remove: (...names) => names.forEach((name) => set.delete(name)),
        toggle: (name, force) => {
            if (typeof force === 'boolean') {
                if (force) {
                    set.add(name);
                } else {
                    set.delete(name);
                }
                return force;
            }
            if (set.has(name)) {
                set.delete(name);
                return false;
            }
            set.add(name);
            return true;
        },
        contains: (name) => set.has(name)
    };
}

function dataKeyFromAttribute(attr) {
    return attr
        .slice(5)
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function createElementStub(tag = 'div', overrides = {}) {
    const attributes = new Map();
    const dataset = {};
    const classList = createClassList();
    const listeners = new Map();
    const element = {
        tagName: tag.toUpperCase(),
        dataset,
        style: {},
        classList,
        attributes,
        children: [],
        parentNode: null,
        textContent: '',
        value: '',
        hidden: false,
        appendChild(child) {
            if (!child) {
                return child;
            }
            this.children.push(child);
            child.parentNode = this;
            return child;
        },
        removeChild(child) {
            this.children = this.children.filter((item) => item !== child);
            if (child) {
                child.parentNode = null;
            }
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
            if (name === 'hidden') {
                this.hidden = true;
            }
            if (name.startsWith('data-')) {
                dataset[dataKeyFromAttribute(name)] = String(value);
            }
        },
        removeAttribute(name) {
            attributes.delete(name);
            if (name === 'hidden') {
                this.hidden = false;
            }
            if (name.startsWith('data-')) {
                delete dataset[dataKeyFromAttribute(name)];
            }
        },
        getAttribute(name) {
            return attributes.get(name);
        },
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, []);
            }
            listeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            if (!listeners.has(type)) {
                return;
            }
            listeners.set(type, listeners.get(type).filter((fn) => fn !== handler));
        },
        dispatchEvent(event) {
            const handlers = listeners.get(event.type) || [];
            handlers.forEach((handler) => handler(event));
        },
        querySelector(selector) {
            if (this.__queryMap && this.__queryMap[selector]) {
                return this.__queryMap[selector];
            }
            return null;
        },
        querySelectorAll(selector) {
            if (this.__queryListMap && this.__queryListMap[selector]) {
                return this.__queryListMap[selector];
            }
            return [];
        },
        closest(selector) {
            if (selector === '[data-action]' && this.dataset && this.dataset.action) {
                return this;
            }
            return null;
        },
        contains(target) {
            if (!target) {
                return false;
            }
            if (target === this) {
                return true;
            }
            return this.children.some((child) => child.contains && child.contains(target));
        },
        focus() {
            this._focused = true;
        },
        click() {
            this._clicked = true;
            const handlers = listeners.get('click') || [];
            handlers.forEach((handler) => handler({ target: this }));
        },
        setSelectionRange() {}
    };
    return Object.assign(element, overrides);
}

function createDocumentStub() {
    const elementsById = new Map();
    const selectorMap = new Map();
    const listeners = new Map();
    const body = createElementStub('body');

    return {
        body,
        activeElement: null,
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, []);
            }
            listeners.get(type).push(handler);
        },
        removeEventListener(type, handler) {
            if (!listeners.has(type)) {
                return;
            }
            listeners.set(type, listeners.get(type).filter((fn) => fn !== handler));
        },
        dispatchEvent(event) {
            const handlers = listeners.get(event.type) || [];
            handlers.forEach((handler) => handler(event));
        },
        createElement(tag) {
            return createElementStub(tag);
        },
        getElementById(id) {
            return elementsById.get(id) || null;
        },
        querySelector(selector) {
            return selectorMap.get(selector) || null;
        },
        querySelectorAll() {
            return [];
        },
        registerElement(id, element) {
            elementsById.set(id, element);
            return element;
        },
        registerSelector(selector, element) {
            selectorMap.set(selector, element);
            return element;
        }
    };
}

function createWindowStub(documentStub) {
    const messages = [];
    const URLStub = {
        created: [],
        createObjectURL(blob) {
            const url = `blob:mock-${this.created.length + 1}`;
            this.created.push({ url, blob });
            return url;
        },
        revokeObjectURL() {}
    };
    const BlobCtor = global.Blob || class Blob {
        constructor(parts = []) {
            this.parts = parts;
        }
    };
    class FormDataStub {
        constructor(form) {
            this._data = new Map(Object.entries(form && form.__fields ? form.__fields : {}));
        }
        get(key) {
            return this._data.has(key) ? this._data.get(key) : null;
        }
    }

    return {
        document: documentStub,
        URL: URLStub,
        Blob: BlobCtor,
        FormData: FormDataStub,
        messages,
        showToast(text, type) {
            messages.push({ channel: 'toast', text, type });
        },
        showMessage(text, type) {
            messages.push({ channel: 'message', text, type });
        },
        addEventListener() {},
        removeEventListener() {},
        setTimeout,
        clearTimeout,
        requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        location: { href: 'file:///index.html' }
    };
}

function createMockStore(words = [], config = {}) {
    const baseConfig = {
        dailyNew: 20,
        reviewLimit: 100,
        masteryCount: 4,
        notify: true
    };
    const store = {
        words: words.map((word, index) => ({
            id: word.id || `word-${index + 1}`,
            ...word
        })),
        config: { ...baseConfig, ...config },
        reviewQueue: [],
        setConfigCalls: 0,
        init: async () => true,
        getWords() {
            return this.words;
        },
        getConfig() {
            return this.config;
        },
        async setConfig(next) {
            this.config = { ...this.config, ...next };
            this.setConfigCalls += 1;
        },
        async setWords(next) {
            this.words = next.map((word, index) => ({
                id: word.id || `word-${index + 1}`,
                ...word
            }));
            return true;
        },
        async updateWord(id, patch) {
            const idx = this.words.findIndex((word) => word.id === id);
            if (idx === -1) {
                return null;
            }
            const updated = { ...this.words[idx], ...patch };
            this.words[idx] = updated;
            return updated;
        },
        setReviewQueue(queue) {
            this.reviewQueue = Array.isArray(queue) ? queue.slice() : [];
        },
        getDueWords(now) {
            const nowTime = now instanceof Date ? now.getTime() : Date.now();
            return this.words.filter((word) => {
                if (!word.nextReview) {
                    return false;
                }
                const time = new Date(word.nextReview).getTime();
                return Number.isFinite(time) && time <= nowTime;
            });
        },
        getNewWords(limit) {
            const items = this.words.filter((word) => !word.lastReviewed && !word.nextReview);
            return items.slice(0, limit);
        },
        getActiveListId() {
            return 'default';
        },
        getAvailableLists() {
            return [];
        }
    };
    return store;
}

function createSessionElements() {
    const primaryButton = createElementStub('button');
    const progressBar = createElementStub('div');
    const progressContainer = createElementStub('div');
    progressBar.closest = (selector) => (selector === '.vocab-progress' ? progressContainer : null);

    const chipNew = createElementStub('span');
    chipNew.dataset.chip = 'new';
    const chipReview = createElementStub('span');
    chipReview.dataset.chip = 'review';
    const chipAccuracy = createElementStub('span');
    chipAccuracy.dataset.chip = 'accuracy';

    const progressStats = createElementStub('div');
    progressStats.__queryListMap = {
        '[data-chip]': [chipNew, chipReview, chipAccuracy]
    };

    const dueBanner = createElementStub('section');
    const dueText = createElementStub('p');

    const sessionCard = createElementStub('div');
    const answerInput = createElementStub('input');
    sessionCard.__queryMap = {
        'input[name="answer"]': answerInput
    };

    const sidePanel = createElementStub('aside');
    const sideSurface = createElementStub('div');
    const toggleButton = createElementStub('button');
    toggleButton.dataset.action = 'toggle-side-panel';
    sidePanel.__queryMap = {
        '[data-action="toggle-side-panel"]': toggleButton
    };

    const noteInput = createElementStub('textarea');
    const noteStatus = createElementStub('span');
    const meaningEl = createElementStub('p');
    const exampleEl = createElementStub('p');
    const metaEl = createElementStub('p');

    const sideBody = createElementStub('div');
    sideBody.__queryMap = {
        '[data-field="meaning"]': meaningEl,
        '[data-field="example"]': exampleEl,
        '[data-field="meta"]': metaEl,
        '[data-field="note"]': noteInput,
        '[data-field="note-status"]': noteStatus
    };

    const importInput = createElementStub('input', {
        click() {
            this._clicked = true;
        }
    });

    const settingsModal = createElementStub('div');
    const settingsDialog = createElementStub('div');
    const settingsError = createElementStub('div');
    const settingsForm = createElementStub('form');

    const dailyField = createElementStub('input');
    const reviewField = createElementStub('input');
    const masteryField = createElementStub('input');
    const notifyField = createElementStub('input');

    const listSwitcher = createElementStub('div');
    const menuButton = createElementStub('button');
    const menu = createElementStub('div');

    return {
        root: createElementStub('div'),
        primaryButton,
        progressBar,
        progressStats,
        dueBanner,
        dueText,
        sessionCard,
        sidePanel,
        sideSurface,
        sideBody,
        noteInput,
        noteStatus,
        importInput,
        settingsModal,
        settingsDialog,
        settingsError,
        settingsForm,
        settingsFields: {
            dailyNew: dailyField,
            reviewLimit: reviewField,
            masteryCount: masteryField,
            notify: notifyField
        },
        listSwitcher,
        menuButton,
        menu
    };
}

function createVocabContext() {
    const documentStub = createDocumentStub();
    const windowStub = createWindowStub(documentStub);
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        setTimeout,
        clearTimeout,
        URL: windowStub.URL,
        Blob: windowStub.Blob,
        FormData: windowStub.FormData
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    vm.runInContext(readSource('js/core/vocabScheduler.js'), context, { filename: 'js/core/vocabScheduler.js' });
    vm.runInContext(patchVocabSessionView(readSource('js/components/vocabSessionView.js')),
        context,
        { filename: 'js/components/vocabSessionView.js' }
    );

    return {
        context,
        window: windowStub,
        document: documentStub,
        hooks: windowStub.__VocabSessionViewTestHooks
    };
}

function createMoreViewContext() {
    const documentStub = createDocumentStub();
    const windowStub = createWindowStub(documentStub);
    windowStub.document.readyState = 'complete';
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    vm.runInContext(patchMoreView(readSource('js/presentation/moreView.js')),
        context,
        { filename: 'js/presentation/moreView.js' }
    );

    return {
        context,
        window: windowStub,
        document: documentStub,
        hooks: windowStub.__MoreViewTestHooks
    };
}

function flushPromises() {
    return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
    const results = [];
    const record = async (name, fn) => {
        try {
            await fn();
            results.push({ name, status: 'pass' });
        } catch (error) {
            results.push({
                name,
                status: 'fail',
                detail: error instanceof Error ? error.message : String(error)
            });
        }
    };

    await record('layout template markers', () => {
        const source = readSource('js/components/vocabSessionView.js');
        const markers = [
            'data-vocab-role="topbar"',
            'data-action="primary-cta"',
            'data-action="toggle-menu"',
            'data-action="menu-import"',
            'data-action="menu-export"',
            'data-action="menu-settings"',
            'data-vocab-role="due-banner"',
            'data-action="start-review"',
            'data-vocab-role="session-card"',
            'data-vocab-role="side-panel"',
            'data-action="toggle-side-panel"',
            'data-action="save-note"',
            'data-vocab-role="import-input"',
            'data-vocab-role="settings-modal"'
        ];
        markers.forEach((marker) => {
            assert.ok(source.includes(marker), `Missing marker: ${marker}`);
        });
    });

    const vocabContext = createVocabContext();
    const hooks = vocabContext.hooks;
    const windowStub = vocabContext.window;
    const documentStub = vocabContext.document;

    const elements = createSessionElements();
    hooks.setElements(elements);
    hooks.setRender(() => {});
    hooks.setScheduler(windowStub.VocabScheduler);
    hooks.setContainer(createElementStub('div'));
    hooks.bindEvents();

    await record('primary CTA sets review intent', () => {
        const now = Date.now();
        const store = createMockStore([
            {
                id: 'due-1',
                word: 'alpha',
                meaning: 'A',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1,
                lastReviewed: new Date(now - 86400000).toISOString(),
                nextReview: new Date(now - 3600000).toISOString()
            },
            { id: 'new-1', word: 'beta', meaning: 'B' }
        ], { dailyNew: 5, reviewLimit: 10 });

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.updatePrimaryAction();

        assert.strictEqual(elements.primaryButton.dataset.intent, 'review');
    });

    await record('primary CTA sets new intent', () => {
        const store = createMockStore([
            { id: 'new-1', word: 'gamma', meaning: 'G' },
            { id: 'new-2', word: 'delta', meaning: 'D' }
        ], { dailyNew: 1, reviewLimit: 10 });

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.updatePrimaryAction();

        assert.strictEqual(elements.primaryButton.dataset.intent, 'new');
    });

    await record('primary CTA sets import intent', () => {
        const store = createMockStore([]);
        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.updatePrimaryAction();

        assert.strictEqual(elements.primaryButton.dataset.intent, 'import');
        assert.ok(elements.primaryButton.classList.contains('btn-outline'));
    });

    await record('progress stats update chips and bar', () => {
        hooks.resetSessionState();
        hooks.state.session.progress = {
            total: 10,
            completed: 4,
            correct: 3,
            near: 1,
            wrong: 0
        };
        hooks.state.session.newTotal = 2;
        hooks.state.session.dueTotal = 8;

        hooks.updateProgressStats();

        const chips = elements.progressStats.__queryListMap['[data-chip]'];
        assert.ok(chips[0].textContent.includes('2'));
        assert.ok(chips[1].textContent.includes('8'));
        assert.ok(chips[2].textContent.includes('30'));
        assert.strictEqual(elements.progressBar.style.width, '40%');
    });

    await record('due banner toggles visibility', () => {
        hooks.resetSessionState();
        hooks.showDueBanner(3);

        assert.ok(!elements.dueBanner.hidden);
        assert.ok(elements.dueText.textContent.includes('3'));

        hooks.showDueBanner(0);
        assert.ok(elements.dueBanner.hidden);
    });

    await record('primary CTA click respects intent', () => {
        const now = Date.now();
        const store = createMockStore([
            {
                id: 'due-cta',
                word: 'alpha',
                meaning: 'A',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1,
                lastReviewed: new Date(now - 86400000).toISOString(),
                nextReview: new Date(now - 3600000).toISOString()
            },
            { id: 'new-cta', word: 'beta', meaning: 'B' }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.state.ui.importing = false;
        elements.importInput._clicked = false;

        elements.primaryButton.dataset.intent = 'import';
        hooks.handlePrimaryButtonClick({
            preventDefault() {},
            currentTarget: elements.primaryButton
        });
        assert.strictEqual(elements.importInput._clicked, true);

        elements.primaryButton.dataset.intent = 'new';
        hooks.handlePrimaryButtonClick({
            preventDefault() {},
            currentTarget: elements.primaryButton
        });

        assert.strictEqual(hooks.state.session.dueTotal, 0);
        assert.ok(hooks.state.session.newTotal > 0);
    });

    await record('start review flow populates session', () => {
        const now = Date.now();
        const store = createMockStore([
            {
                id: 'due-1',
                word: 'alpha',
                meaning: 'A',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1,
                lastReviewed: new Date(now - 86400000).toISOString(),
                nextReview: new Date(now - 3600000).toISOString()
            },
            { id: 'new-1', word: 'beta', meaning: 'B' }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.startReviewFlow();

        assert.strictEqual(hooks.state.session.stage, 'recognition');
        assert.ok(hooks.state.session.currentWord);
        assert.strictEqual(hooks.state.session.dueTotal, 1);
        assert.strictEqual(hooks.state.session.newTotal, 1);
    });

    await record('recognition to spelling transition', () => {
        hooks.resetSessionState();
        hooks.state.session.stage = 'recognition';
        hooks.state.session.currentWord = { id: 'w-1', word: 'alpha', meaning: 'A' };

        const event = {
            preventDefault() {},
            target: {
                closest: () => ({ dataset: { action: 'recognize-good' } })
            }
        };

        hooks.handleCardAction(event);

        assert.strictEqual(hooks.state.session.stage, 'spelling');
        assert.strictEqual(hooks.state.session.recognitionQuality, 'good');
    });

    await record('submit spelling correct answer', async () => {
        const store = createMockStore([
            {
                id: 'w-1',
                word: 'alpha',
                meaning: 'A',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 2
            }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.state.session.stage = 'spelling';
        hooks.state.session.recognitionQuality = 'easy';
        hooks.state.session.currentWord = store.words[0];
        elements.sessionCard.__queryMap['input[name="answer"]'].value = 'alpha';

        hooks.submitSpelling();
        await flushPromises();

        assert.strictEqual(hooks.state.session.stage, 'feedback');
        assert.ok(hooks.state.session.lastAnswer);
        assert.strictEqual(hooks.state.session.lastAnswer.spellingCorrect, true);
        assert.strictEqual(hooks.state.session.progress.completed, 1);
    });

    await record('submit spelling attempts limit', async () => {
        const store = createMockStore([
            {
                id: 'w-2',
                word: 'bravo',
                meaning: 'B',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1
            }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.state.session.stage = 'spelling';
        hooks.state.session.recognitionQuality = 'easy';
        hooks.state.session.currentWord = store.words[0];

        elements.sessionCard.__queryMap['input[name="answer"]'].value = 'wrong';
        hooks.submitSpelling();
        assert.strictEqual(hooks.state.session.spellingAttempts, 1);
        assert.strictEqual(hooks.state.session.stage, 'spelling');

        elements.sessionCard.__queryMap['input[name="answer"]'].value = 'wrong';
        hooks.submitSpelling();
        assert.strictEqual(hooks.state.session.spellingAttempts, 2);
        assert.strictEqual(hooks.state.session.stage, 'spelling');

        elements.sessionCard.__queryMap['input[name="answer"]'].value = 'wrong';
        hooks.submitSpelling();
        await flushPromises();

        assert.strictEqual(hooks.state.session.stage, 'feedback');
        assert.strictEqual(hooks.state.session.lastAnswer.spellingAttempts, 3);
    });

    await record('skip spelling triggers feedback', async () => {
        const store = createMockStore([
            {
                id: 'w-3',
                word: 'charlie',
                meaning: 'C',
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1
            }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.state.session.stage = 'spelling';
        hooks.state.session.recognitionQuality = 'good';
        hooks.state.session.currentWord = store.words[0];

        const event = {
            preventDefault() {},
            target: {
                closest: () => ({ dataset: { action: 'skip-spelling' } })
            }
        };

        hooks.handleCardAction(event);
        await flushPromises();

        assert.strictEqual(hooks.state.session.stage, 'feedback');
        assert.strictEqual(hooks.state.session.lastAnswer.skipped, true);
    });

    await record('move to next word handles completion', () => {
        hooks.resetSessionState();
        hooks.state.session.activeQueue = [];
        hooks.state.session.backlog = [];

        hooks.moveToNextWord();
        assert.strictEqual(hooks.state.session.stage, 'complete');

        hooks.resetSessionState();
        hooks.state.session.activeQueue = [];
        hooks.state.session.backlog = [{ id: 'w-4', word: 'delta', meaning: 'D' }];

        hooks.moveToNextWord();
        assert.strictEqual(hooks.state.session.stage, 'batch-finished');
    });

    await record('side panel toggle updates state', () => {
        elements.sidePanel.dataset.expanded = 'false';
        hooks.setSidePanelExpanded(true);
        assert.strictEqual(elements.sidePanel.dataset.expanded, 'true');

        hooks.toggleSidePanel();
        assert.strictEqual(elements.sidePanel.dataset.expanded, 'false');
    });

    await record('side panel content updates fields', () => {
        const word = {
            word: 'alpha',
            meaning: 'Meaning',
            example: 'Example',
            source: 'Source',
            note: 'Note text'
        };
        hooks.updateSidePanelContent(word);

        const meaningEl = elements.sideBody.__queryMap['[data-field=\"meaning\"]'];
        const exampleEl = elements.sideBody.__queryMap['[data-field=\"example\"]'];
        const metaEl = elements.sideBody.__queryMap['[data-field=\"meta\"]'];

        assert.strictEqual(meaningEl.textContent, 'Meaning');
        assert.strictEqual(exampleEl.textContent, 'Example');
        assert.strictEqual(metaEl.textContent, 'Source');
        assert.strictEqual(elements.noteInput.value, 'Note text');
    });

    await record('save note writes to store', () => {
        const store = createMockStore([
            {
                id: 'w-5',
                word: 'echo',
                meaning: 'E'
            }
        ]);

        hooks.setStore(store);
        hooks.resetSessionState();
        hooks.state.session.currentWord = store.words[0];
        elements.noteInput.value = 'remember this';

        hooks.saveCurrentNote();
        assert.strictEqual(store.words[0].note, 'remember this');
        assert.ok(elements.noteStatus.textContent.length > 0);
    });

    await record('settings modal open and close', () => {
        const store = createMockStore([], { dailyNew: 12, reviewLimit: 50, masteryCount: 5, notify: false });
        hooks.setStore(store);

        hooks.openSettingsModal();
        assert.strictEqual(elements.settingsModal.dataset.open, 'true');
        assert.strictEqual(elements.settingsFields.dailyNew.value, 12);
        assert.strictEqual(elements.settingsFields.reviewLimit.value, 50);
        assert.strictEqual(elements.settingsFields.masteryCount.value, 5);
        assert.strictEqual(elements.settingsFields.notify.checked, false);

        hooks.closeSettingsModal();
        assert.strictEqual(elements.settingsModal.dataset.open, 'false');
        assert.ok(elements.settingsModal.hidden);
    });

    await record('settings submit validates ranges', async () => {
        const store = createMockStore();
        hooks.setStore(store);

        elements.settingsForm.__fields = {
            dailyNew: 'invalid',
            reviewLimit: '10',
            masteryCount: '3'
        };

        await hooks.handleSettingsSubmit({
            preventDefault() {},
            currentTarget: elements.settingsForm
        });

        assert.ok(elements.settingsError.textContent.length > 0);
        assert.strictEqual(store.setConfigCalls, 0);

        elements.settingsForm.__fields = {
            dailyNew: '10',
            reviewLimit: '50',
            masteryCount: '3',
            notify: '1'
        };

        hooks.state.session.batchSize = 1;
        await hooks.handleSettingsSubmit({
            preventDefault() {},
            currentTarget: elements.settingsForm
        });

        assert.strictEqual(store.setConfigCalls, 1);
        assert.strictEqual(hooks.state.session.batchSize, 24);
        assert.strictEqual(elements.settingsModal.dataset.open, 'false');
    });

    await record('menu toggle opens and closes', () => {
        hooks.resetSessionState();
        hooks.state.menuOpen = false;
        hooks.toggleMenu({ stopPropagation() {} });
        assert.strictEqual(hooks.state.menuOpen, true);
        assert.ok(!elements.menu.hidden);

        hooks.toggleMenu({ stopPropagation() {} });
        assert.strictEqual(hooks.state.menuOpen, false);
        assert.ok(elements.menu.hidden);
    });

    await record('import request triggers input', () => {
        const store = createMockStore();
        hooks.setStore(store);
        hooks.state.ui.importing = false;
        hooks.handleImportRequest();
        assert.strictEqual(elements.importInput._clicked, true);
    });

    await record('perform import wordlist merges entries', async () => {
        const store = createMockStore([
            { id: 'w-6', word: 'alpha', meaning: 'Old' }
        ]);
        hooks.setStore(store);
        hooks.state.ui.importing = false;
        windowStub.VocabDataIO = {
            importWordList: async () => ({
                type: 'wordlist',
                entries: [{ word: 'alpha', meaning: 'New' }, { word: 'beta', meaning: 'B' }],
                meta: { category: 'external', name: 'demo' }
            })
        };

        await hooks.performImport({ name: 'mock.json' });
        assert.strictEqual(store.words.length, 2);
        assert.strictEqual(store.words.find((word) => word.word === 'alpha').meaning, 'New');
    });

    await record('perform import progress restores config', async () => {
        const store = createMockStore();
        hooks.setStore(store);
        hooks.state.ui.importing = false;
        windowStub.VocabDataIO = {
            importWordList: async () => ({
                type: 'progress',
                entries: [{ word: 'theta', meaning: 'T' }],
                meta: {
                    category: 'user',
                    config: { dailyNew: 5, reviewLimit: 10, masteryCount: 2, notify: false },
                    reviewQueue: ['x']
                }
            })
        };

        await hooks.performImport({ name: 'progress.json' });
        assert.strictEqual(store.words.length, 1);
        assert.strictEqual(store.config.dailyNew, 5);
        assert.strictEqual(store.reviewQueue.length, 1);
    });

    await record('export progress triggers download', async () => {
        const store = createMockStore();
        hooks.setStore(store);
        hooks.state.ui.exporting = false;
        windowStub.VocabDataIO = {
            exportProgress: async () => new windowStub.Blob(['data'])
        };

        const anchor = createElementStub('a', {
            click() {
                this._clicked = true;
            }
        });
        vocabContext.document.createElement = () => anchor;
        vocabContext.document.body.appendChild = () => {};
        vocabContext.document.body.removeChild = () => {};

        await hooks.handleExportRequest();
        assert.strictEqual(anchor._clicked, true);
    });

    await record('keyboard Enter triggers feedback action', () => {
        hooks.resetSessionState();
        hooks.state.session.stage = 'feedback';
        documentStub.activeElement = null;

        const nextButton = createElementStub('button');
        nextButton.dataset.action = 'next-word';
        elements.sessionCard.__queryMap['[data-action="next-word"]'] = nextButton;

        let prevented = false;
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Enter',
            preventDefault() {
                prevented = true;
            }
        });

        assert.strictEqual(nextButton._clicked, true);
        assert.strictEqual(prevented, true);
    });

    await record('keyboard Enter triggers batch summary primary action', () => {
        hooks.resetSessionState();
        hooks.state.session.stage = 'batch-finished';
        documentStub.activeElement = null;

        const nextBatch = createElementStub('button');
        nextBatch.dataset.action = 'next-batch';
        const endSession = createElementStub('button');
        endSession.dataset.action = 'end-session';

        elements.sessionCard.__queryMap['[data-action="next-batch"]'] = nextBatch;
        elements.sessionCard.__queryMap['[data-action="end-session"]'] = endSession;

        let prevented = false;
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Enter',
            preventDefault() {
                prevented = true;
            }
        });

        assert.strictEqual(nextBatch._clicked, true);
        assert.ok(!endSession._clicked);
        assert.strictEqual(prevented, true);
    });

    await record('keyboard Enter triggers completion action', () => {
        hooks.resetSessionState();
        hooks.state.session.stage = 'complete';
        documentStub.activeElement = null;

        const endSession = createElementStub('button');
        endSession.dataset.action = 'end-session';
        elements.sessionCard.__queryMap['[data-action="end-session"]'] = endSession;

        let prevented = false;
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Enter',
            preventDefault() {
                prevented = true;
            }
        });

        assert.strictEqual(endSession._clicked, true);
        assert.strictEqual(prevented, true);
    });

    await record('list switcher attaches handler', () => {
        const store = createMockStore([
            { id: 'w-7', word: 'zeta', meaning: 'Z' }
        ]);
        hooks.setStore(store);
        hooks.resetSessionState();

        let renderCalled = false;
        windowStub.VocabListSwitcher = class {
            constructor() {}
            render(container) {
                renderCalled = true;
                container.rendered = true;
            }
        };

        hooks.ensureListSwitcher();
        assert.strictEqual(renderCalled, true);
        assert.strictEqual(elements.listSwitcher.rendered, true);
    });

    await record('more view vocab entry navigates', () => {
        const moreContext = createMoreViewContext();
        const moreHooks = moreContext.hooks;
        const moreDoc = moreContext.document;
        const moreWindow = moreContext.window;

        const moreView = createElementStub('div', { classList: createClassList(['active']) });
        const vocabView = createElementStub('section');
        vocabView.setAttribute('hidden', 'hidden');
        const navButton = createElementStub('button', { classList: createClassList() });
        moreDoc.registerElement('more-view', moreView);
        moreDoc.registerElement('vocab-view', vocabView);
        moreDoc.registerSelector('.nav-btn[data-view="more"]', navButton);

        let navigatedTo = null;
        moreWindow.app = {
            navigateToView(view) {
                navigatedTo = view;
            }
        };
        moreWindow.VocabSessionView = {
            mount() {
                this._mounted = true;
            }
        };

        moreHooks.handleVocabEntry({ preventDefault() {} });

        assert.strictEqual(navigatedTo, 'vocab');
        assert.ok(!vocabView.hidden);
        assert.ok(moreWindow.VocabSessionView._mounted);
        assert.ok(navButton.classList.contains('active'));
    });

    await record('more view fallback without app', () => {
        const moreContext = createMoreViewContext();
        const moreHooks = moreContext.hooks;
        const moreDoc = moreContext.document;
        const moreWindow = moreContext.window;

        const moreView = createElementStub('div', { classList: createClassList(['active']) });
        const vocabView = createElementStub('section');
        vocabView.setAttribute('hidden', 'hidden');
        const navButton = createElementStub('button', { classList: createClassList() });
        moreDoc.registerElement('more-view', moreView);
        moreDoc.registerElement('vocab-view', vocabView);
        moreDoc.registerSelector('.nav-btn[data-view="more"]', navButton);

        moreWindow.app = null;
        moreWindow.VocabSessionView = {
            mount() {
                this._mounted = true;
            }
        };

        moreHooks.handleVocabEntry({ preventDefault() {} });

        assert.ok(vocabView.classList.contains('active'));
        assert.ok(!vocabView.hidden);
        assert.ok(navButton.classList.contains('active'));
        assert.ok(moreWindow.VocabSessionView._mounted);
    });

    const failed = results.filter((item) => item.status === 'fail');
    const payload = {
        status: failed.length ? 'fail' : 'pass',
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        results,
        detail: failed.length ? 'Some tests failed' : 'All tests passed'
    };

    emitResult(payload);
    process.exit(failed.length ? 1 : 0);
}

run().catch((error) => {
    emitResult({
        status: 'fail',
        total: 1,
        passed: 0,
        failed: 1,
        results: [{ name: 'test runner', status: 'fail', detail: error.message }],
        detail: 'Unhandled error'
    });
    process.exit(1);
});
