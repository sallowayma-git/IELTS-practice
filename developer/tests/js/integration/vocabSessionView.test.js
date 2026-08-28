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
let activeDocumentStub = null;
const modalFocusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
        getWordStatus,
        analyzeListWords,
        openListModal,
        closeListModal,
        exportCurrentList,
        renderListBrowser,
        renderCard,
        syncListSwitcherFromStore,
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
        disabled: false,
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
            if (activeDocumentStub) {
                activeDocumentStub.activeElement = this;
            }
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

    const documentStub = {
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
    activeDocumentStub = documentStub;
    return documentStub;
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
        setConfigCalls: 0,
        replaceProgressCalls: [],
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
        async mergeWords(incoming) {
            const indexByWord = new Map(this.words.map((word, index) => [String(word.word || '').trim().toLowerCase(), index]));
            let addedCount = 0;
            let updatedCount = 0;
            for (const entry of incoming) {
                const key = String(entry.word || '').trim().toLowerCase();
                if (!key) continue;
                if (indexByWord.has(key)) {
                    const index = indexByWord.get(key);
                    this.words[index] = { ...this.words[index], ...entry };
                    updatedCount += 1;
                } else {
                    const word = { id: entry.id || `word-${this.words.length + 1}`, ...entry };
                    indexByWord.set(key, this.words.length);
                    this.words.push(word);
                    addedCount += 1;
                }
            }
            return { words: this.words, addedCount, updatedCount };
        },
        async replaceProgress(next, nextConfig = {}, listId = null) {
            this.words = next.map((word, index) => ({
                id: word.id || `word-${index + 1}`,
                ...word
            }));
            const activeListId = listId || nextConfig.activeListId || this.config.activeListId || 'default';
            this.config = { ...this.config, ...nextConfig, activeListId };
            this.replaceProgressCalls.push({
                listId: activeListId,
                words: this.words.map((word) => ({ ...word })),
                config: { ...this.config }
            });
            return { words: this.words, config: this.config };
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
            return this.config.activeListId || 'default';
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
    const settingsClose = createElementStub('button');
    const settingsError = createElementStub('div');
    const settingsForm = createElementStub('form');

    const dailyField = createElementStub('input');
    const reviewField = createElementStub('input');
    const masteryField = createElementStub('input');
    const notifyField = createElementStub('input');

    const listSwitcher = createElementStub('div');
    const menuButton = createElementStub('button');
    const menu = createElementStub('div');
    const listModal = createElementStub('div');
    const listDialog = createElementStub('div');
    const listSubtitle = createElementStub('p');
    const listSearch = createElementStub('input');
    const listLearnedOnly = createElementStub('input');
    const listStats = createElementStub('div');
    const listBody = createElementStub('div');
    const listClose = createElementStub('button');

    settingsDialog.appendChild(dailyField);
    settingsDialog.appendChild(settingsClose);
    settingsDialog.__queryMap = {
        'input, button, select, textarea': dailyField
    };
    settingsDialog.__queryListMap = {
        [modalFocusableSelector]: [dailyField, settingsClose]
    };
    listDialog.appendChild(listSearch);
    listDialog.appendChild(listClose);
    listDialog.__queryListMap = {
        [modalFocusableSelector]: [listSearch, listClose]
    };

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
        menu,
        listModal,
        listDialog,
        listSubtitle,
        listSearch,
        listLearnedOnly,
        listStats,
        listBody,
        settingsClose,
        listClose
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
            'data-action="menu-view-list"',
            'data-vocab-role="list-modal"',
            'data-vocab-role="list-dialog"',
            'data-action="export-current-list"',
            'data-vocab-role="settings-modal"'
        ];
        markers.forEach((marker) => {
            assert.ok(source.includes(marker), `Missing marker: ${marker}`);
        });
    });

    await record('list modal body owns the table scroll', () => {
        const css = readSource('css/main.css');
        const bodyRule = css.match(/\.vocab-list-modal__body\s*\{([^}]*)\}/);
        const tableWrapRule = css.match(/\.vocab-list-table-wrap\s*\{([^}]*)\}/);
        assert.ok(bodyRule, 'Missing list modal body rule');
        assert.ok(tableWrapRule, 'Missing table wrapper rule');
        assert.match(bodyRule[1], /flex:\s*1 1 220px/);
        assert.match(bodyRule[1], /min-height:\s*0/);
        assert.match(bodyRule[1], /overflow:\s*hidden/);
        assert.match(tableWrapRule[1], /flex:\s*1/);
        assert.match(tableWrapRule[1], /min-height:\s*0/);
        assert.match(tableWrapRule[1], /overflow:\s*auto/);
        assert.doesNotMatch(css, /@media\s*\(max-height:\s*480px\)/);
        assert.doesNotMatch(css, /@media\s*\(max-height:\s*300px\)/);
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
        assert.strictEqual(hooks.state.session.lastAnswer.finalQuality, 'wrong');
        assert.strictEqual(store.words[0].correctCount, 0);
        assert.strictEqual(store.words[0].repetitions, 0);
        assert.strictEqual(store.words[0].interval, 1);
        assert.strictEqual(hooks.state.session.progress.wrong, 1);
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
        assert.strictEqual(hooks.state.session.lastAnswer.finalQuality, 'wrong');
        assert.strictEqual(store.words[0].correctCount, 0);
        assert.strictEqual(store.words[0].repetitions, 0);
        assert.strictEqual(hooks.state.session.progress.wrong, 1);
        hooks.renderCard();
        assert.ok(elements.sessionCard.innerHTML.includes('vocab-card--wrong'));
        assert.ok(elements.sessionCard.innerHTML.includes('已跳过，需要加强'));
        assert.ok(!elements.sessionCard.innerHTML.includes('vocab-card--correct'));
    });

    await record('session card escapes imported word fields', () => {
        hooks.resetSessionState();
        hooks.state.session.stage = 'recognition';
        hooks.state.session.meaningVisible = true;
        hooks.state.session.currentWord = {
            id: 'unsafe-1',
            word: '<img src=x onerror="window.__wordXss=1">',
            meaning: '<svg onload="window.__meaningXss=1"></svg>'
        };

        hooks.renderCard();

        assert.ok(elements.sessionCard.innerHTML.includes('&lt;img'));
        assert.ok(elements.sessionCard.innerHTML.includes('&lt;svg'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<img'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<svg'));

        hooks.state.session.stage = 'spelling';
        hooks.renderCard();
        assert.ok(elements.sessionCard.innerHTML.includes('&lt;svg'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<svg'));

        hooks.state.session.currentWord = {
            ...hooks.state.session.currentWord,
            easeFactor: 2.5,
            interval: 1,
            repetitions: 0,
            nextReview: '2026-08-11T00:00:00.000Z'
        };
        hooks.state.session.lastAnswer = {
            recognitionQuality: 'good',
            spellingAttempts: 0,
            spellingCorrect: true,
            saved: true
        };
        hooks.state.session.stage = 'feedback';
        hooks.renderCard();
        assert.ok(elements.sessionCard.innerHTML.includes('&lt;img'));
        assert.ok(elements.sessionCard.innerHTML.includes('&lt;svg'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<img'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<svg'));
    });

    await record('recognition renders a labeled phonetic below the word and spelling omits it', () => {
        hooks.resetSessionState();
        hooks.state.session.currentWord = {
            id: 'phonetic-1',
            word: 'alpha',
            meaning: '阿尔法',
            phonetic: ' /ˈæl.fə '
        };
        hooks.state.session.stage = 'recognition';

        hooks.renderCard();

        const recognitionMarkup = elements.sessionCard.innerHTML;
        assert.match(
            recognitionMarkup,
            /<div class="vocab-card__word">alpha<\/div>\s*<div class="vocab-card__phonetic">/,
            'Expected the phonetic block immediately below the word'
        );
        assert.ok(recognitionMarkup.includes('<span class="visually-hidden">音标：</span>'));
        assert.ok(recognitionMarkup.includes('<span>ˈæl.fə</span>'));
        assert.ok(!recognitionMarkup.includes('//'));
        assert.strictEqual((recognitionMarkup.match(/aria-hidden="true">\/<\/span>/g) || []).length, 2);
        const wordlineRule = readSource('css/main.css').match(/\.vocab-card__wordline\s*\{([^}]*)\}/);
        assert.ok(wordlineRule, 'Missing word-and-phonetic layout rule');
        assert.match(wordlineRule[1], /flex-direction:\s*column/);

        hooks.state.session.stage = 'spelling';
        hooks.renderCard();

        const spellingMarkup = elements.sessionCard.innerHTML;
        assert.ok(!spellingMarkup.includes('vocab-card__phonetic'));
        assert.ok(!spellingMarkup.includes('vocab-feedback__phonetic'));
        assert.ok(!spellingMarkup.includes('音标'));
        assert.ok(!spellingMarkup.includes('ˈæl.fə'));
    });

    await record('feedback renders phonetic as a labeled detail', () => {
        hooks.resetSessionState();
        hooks.state.session.currentWord = {
            id: 'phonetic-2',
            word: 'beta',
            meaning: '贝塔',
            phonetic: 'ˈbiː.tə/',
            easeFactor: 2.5,
            interval: 1,
            repetitions: 1,
            lastReviewed: '2026-08-19T00:00:00.000Z'
        };
        hooks.state.session.lastAnswer = {
            recognitionQuality: 'good',
            spellingAttempts: 0,
            spellingCorrect: true,
            finalQuality: 'good',
            finalEF: 2.5,
            saved: true
        };
        hooks.state.session.stage = 'feedback';

        hooks.renderCard();

        const markup = elements.sessionCard.innerHTML;
        assert.match(
            markup,
            /<div><dt>音标<\/dt><dd class="vocab-feedback__phonetic">[\s\S]*?<span>ˈbiː\.tə<\/span>[\s\S]*?<\/dd><\/div>/
        );
    });

    await record('missing blank and slash-only phonetics omit recognition blocks and feedback rows', () => {
        const omittedPhonetics = [undefined, '   ', ' /   / ', '/', '///'];

        omittedPhonetics.forEach((phonetic, index) => {
            hooks.resetSessionState();
            hooks.state.session.currentWord = {
                id: `phonetic-empty-${index}`,
                word: 'gamma',
                meaning: '伽马',
                phonetic,
                easeFactor: 2.5,
                interval: 1,
                repetitions: 1,
                lastReviewed: '2026-08-19T00:00:00.000Z'
            };
            hooks.state.session.stage = 'recognition';
            hooks.renderCard();

            assert.ok(!elements.sessionCard.innerHTML.includes('vocab-card__phonetic'));
            assert.ok(!elements.sessionCard.innerHTML.includes('//'));

            hooks.state.session.lastAnswer = {
                recognitionQuality: 'good',
                spellingAttempts: 0,
                spellingCorrect: true,
                finalQuality: 'good',
                finalEF: 2.5,
                saved: true
            };
            hooks.state.session.stage = 'feedback';
            hooks.renderCard();

            assert.ok(!elements.sessionCard.innerHTML.includes('vocab-feedback__phonetic'));
            assert.ok(!elements.sessionCard.innerHTML.includes('<dt>音标</dt>'));
            assert.ok(!elements.sessionCard.innerHTML.includes('//'));
        });
    });

    await record('recognition and feedback escape malicious phonetics', () => {
        const maliciousPhonetic = '/<img src=x onerror="window.__phoneticXss=1">/';
        hooks.resetSessionState();
        hooks.state.session.currentWord = {
            id: 'phonetic-unsafe',
            word: 'delta',
            meaning: '德尔塔',
            phonetic: maliciousPhonetic,
            easeFactor: 2.5,
            interval: 1,
            repetitions: 1,
            lastReviewed: '2026-08-19T00:00:00.000Z'
        };
        hooks.state.session.stage = 'recognition';

        hooks.renderCard();

        assert.ok(elements.sessionCard.innerHTML.includes('&lt;img'));
        assert.ok(elements.sessionCard.innerHTML.includes('&quot;window.__phoneticXss=1&quot;'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<img'));

        hooks.state.session.lastAnswer = {
            recognitionQuality: 'good',
            spellingAttempts: 0,
            spellingCorrect: true,
            finalQuality: 'good',
            finalEF: 2.5,
            saved: true
        };
        hooks.state.session.stage = 'feedback';
        hooks.renderCard();

        assert.ok(elements.sessionCard.innerHTML.includes('&lt;img'));
        assert.ok(elements.sessionCard.innerHTML.includes('&quot;window.__phoneticXss=1&quot;'));
        assert.ok(!elements.sessionCard.innerHTML.includes('<img'));
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

    await record('save note writes to store', async () => {
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

        await hooks.saveCurrentNote();
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
        hooks.openSettingsModal(elements.menuButton);
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

    await record('settings modal restores focus to visible menu trigger', () => {
        const hiddenMenuItem = createElementStub('button');
        const trigger = createElementStub('button');
        trigger.dataset.action = 'menu-settings';
        documentStub.activeElement = hiddenMenuItem;
        elements.menuButton._focused = false;

        elements.menu.dispatchEvent({
            type: 'click',
            target: {
                closest(selector) {
                    return selector === 'button[data-action]' ? trigger : null;
                }
            }
        });
        hooks.closeSettingsModal();

        assert.strictEqual(elements.menuButton._focused, true);
        assert.ok(!hiddenMenuItem._focused);
    });

    await record('list status keeps due mastered words in the review queue', () => {
        const config = { masteryCount: 4 };
        const dueMastered = hooks.getWordStatus({
            correctCount: 4,
            nextReview: new Date(Date.now() - 60_000).toISOString()
        }, config);
        const futureMastered = hooks.getWordStatus({
            correctCount: 4,
            nextReview: new Date(Date.now() + 60_000).toISOString()
        }, config);

        assert.strictEqual(dueMastered.tone, 'due');
        assert.strictEqual(futureMastered.tone, 'mastered');

        hooks.setStore(createMockStore([
            { word: 'alpha', meaning: 'A', correctCount: 4, nextReview: new Date(Date.now() - 60_000).toISOString() }
        ], config));
        const analysis = hooks.analyzeListWords();
        assert.strictEqual(analysis.masteredCount, 1);
        assert.strictEqual(analysis.dueCount, 1);
    });

    await record('list modal restores focus to visible menu trigger', async () => {
        const store = createMockStore([{ word: 'alpha', meaning: 'A' }]);
        const hiddenMenuItem = createElementStub('button');
        const trigger = createElementStub('button');
        trigger.dataset.action = 'menu-view-list';
        hooks.setStore(store);
        documentStub.activeElement = hiddenMenuItem;
        elements.menuButton._focused = false;

        elements.menu.dispatchEvent({
            type: 'click',
            target: {
                closest(selector) {
                    return selector === 'button[data-action]' ? trigger : null;
                }
            }
        });
        await flushPromises();
        hooks.closeListModal();

        assert.strictEqual(elements.menuButton._focused, true);
        assert.ok(!hiddenMenuItem._focused);
    });

    await record('Escape cancels a pending list modal open', async () => {
        let resolveInit;
        const store = createMockStore([{ word: 'alpha', meaning: 'A' }]);
        store.init = () => new Promise((resolve) => {
            resolveInit = resolve;
        });
        hooks.setStore(store);
        const opening = hooks.openListModal(elements.menuButton);
        let prevented = false;

        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Escape',
            preventDefault() {
                prevented = true;
            }
        });
        resolveInit(true);
        await opening;

        assert.strictEqual(prevented, true);
        assert.notStrictEqual(elements.listModal.dataset.open, 'true');
        assert.ok(elements.listModal.hidden);
    });

    await record('list and settings modals remain mutually exclusive', async () => {
        const store = createMockStore([{ word: 'alpha', meaning: 'A' }]);
        hooks.setStore(store);

        await hooks.openListModal(elements.menuButton);
        hooks.openSettingsModal(elements.menuButton);
        assert.strictEqual(elements.settingsModal.dataset.open, 'true');
        assert.strictEqual(elements.listModal.dataset.open, 'false');

        await hooks.openListModal(elements.menuButton);
        assert.strictEqual(elements.listModal.dataset.open, 'true');
        assert.strictEqual(elements.settingsModal.dataset.open, 'false');
        hooks.closeListModal();
    });

    await record('settings writes keep the latest submitted values', async () => {
        const pendingSaves = [];
        const store = createMockStore();
        store.setConfig = (config) => new Promise((resolve) => {
            pendingSaves.push(() => {
                store.config = { ...store.config, ...config };
                resolve(true);
            });
        });
        hooks.setStore(store);
        elements.settingsForm.__fields = {
            dailyNew: '10',
            reviewLimit: '50',
            masteryCount: '3'
        };
        hooks.openSettingsModal(elements.menuButton);
        const pendingSave = hooks.handleSettingsSubmit({
            preventDefault() {},
            currentTarget: elements.settingsForm
        });
        await flushPromises();

        hooks.closeSettingsModal();
        hooks.openSettingsModal(elements.menuButton);
        elements.settingsForm.__fields = {
            dailyNew: '30',
            reviewLimit: '80',
            masteryCount: '5',
            notify: '1'
        };
        const latestSave = hooks.handleSettingsSubmit({
            preventDefault() {},
            currentTarget: elements.settingsForm
        });
        assert.strictEqual(pendingSaves.length, 1);

        pendingSaves.shift()();
        await pendingSave;
        await flushPromises();
        assert.strictEqual(pendingSaves.length, 1);
        pendingSaves.shift()();
        await latestSave;

        assert.strictEqual(store.config.dailyNew, 30);
        assert.strictEqual(store.config.reviewLimit, 80);
        assert.strictEqual(store.config.masteryCount, 5);
        assert.strictEqual(store.config.notify, true);
        assert.strictEqual(elements.settingsModal.dataset.open, 'false');
    });

    await record('Tab stays inside the active modal', async () => {
        let prevented = false;
        hooks.openSettingsModal(elements.menuButton);
        elements.settingsClose.focus();
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Tab',
            key: 'Tab',
            shiftKey: false,
            preventDefault() {
                prevented = true;
            }
        });
        assert.strictEqual(prevented, true);
        assert.strictEqual(documentStub.activeElement, elements.settingsFields.dailyNew);

        prevented = false;
        elements.settingsFields.dailyNew.focus();
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Tab',
            key: 'Tab',
            shiftKey: true,
            preventDefault() {
                prevented = true;
            }
        });
        assert.strictEqual(prevented, true);
        assert.strictEqual(documentStub.activeElement, elements.settingsClose);
        hooks.closeSettingsModal();

        const store = createMockStore([{ word: 'alpha', meaning: 'A' }]);
        hooks.setStore(store);
        await hooks.openListModal(elements.menuButton);
        elements.listClose.focus();
        documentStub.dispatchEvent({
            type: 'keydown',
            code: 'Tab',
            key: 'Tab',
            shiftKey: false,
            preventDefault() {}
        });
        assert.strictEqual(documentStub.activeElement, elements.listSearch);
        hooks.closeListModal();
    });

    await record('list rendering is paged and resets after search', async () => {
        const words = Array.from({ length: 401 }, (_, index) => ({
            word: `word-${String(index + 1).padStart(3, '0')}`,
            meaning: `Meaning ${index + 1}`
        }));
        const store = createMockStore(words);
        let getWordsCalls = 0;
        const originalGetWords = store.getWords.bind(store);
        store.getWords = () => {
            getWordsCalls += 1;
            return originalGetWords();
        };
        hooks.setStore(store);
        hooks.state.ui.listBrowserQuery = '';
        hooks.state.ui.listBrowserLearnedOnly = false;
        hooks.state.ui.listBrowserPage = 1;

        hooks.renderListBrowser();
        const firstBody = elements.listBody.innerHTML.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
        assert.strictEqual((firstBody.match(/<tr>/g) || []).length, 200);
        assert.strictEqual(getWordsCalls, 1);

        hooks.state.ui.listBrowserPage = 2;
        hooks.renderListBrowser();
        assert.match(elements.listBody.innerHTML, /<td>201<\/td>/);
        elements.listSearch.dispatchEvent({ type: 'input', target: { value: 'word-401' } });
        assert.strictEqual(hooks.state.ui.listBrowserPage, 1);
        await new Promise((resolve) => setTimeout(resolve, 220));
        assert.match(elements.listBody.innerHTML, /word-401/);
    });

    await record('filtered list export remains a complete mergeable word list', async () => {
        const store = createMockStore([
            {
                word: 'alpha',
                meaning: 'A',
                example: 'First',
                phonetic: ' /ˈæl.fə ',
                freq: 0.8,
                correctCount: 2
            },
            {
                word: 'beta',
                meaning: 'B',
                phonetic: ' /   / ',
                note: 'private note',
                questionId: 'internal-id'
            },
            {
                word: 'gamma',
                meaning: 'C',
                phonetic: '/'
            },
            {
                word: 'delta',
                meaning: 'D',
                phonetic: '///'
            }
        ]);
        hooks.setStore(store);
        hooks.state.ui.listBrowserQuery = 'alpha';
        hooks.state.ui.listBrowserLearnedOnly = true;
        windowStub.URL.created.length = 0;
        const anchor = createElementStub('a');
        vocabContext.document.createElement = () => anchor;

        hooks.exportCurrentList();

        const download = windowStub.URL.created.at(-1);
        assert.ok(download, 'Expected an exported blob');
        const payload = JSON.parse(await download.blob.text());
        assert.strictEqual(payload.type, 'wordlist');
        assert.strictEqual(payload.category, 'external');
        assert.strictEqual(payload.entries.length, 4);
        assert.deepStrictEqual(Array.from(payload.entries, (entry) => entry.word), ['alpha', 'beta', 'gamma', 'delta']);
        assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'version'));
        assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'words'));
        assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[0], 'correctCount'));
        assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[1], 'questionId'));
        assert.strictEqual(payload.entries[0].phonetic, 'ˈæl.fə');
        assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[1], 'phonetic'));
        assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[2], 'phonetic'));
        assert.ok(!Object.prototype.hasOwnProperty.call(payload.entries[3], 'phonetic'));
        assert.match(windowStub.messages.at(-1).text, /可分享词表/);
    });

    await record('card actions are ignored while list modal is open', () => {
        hooks.state.session.stage = 'recognition';
        elements.listModal.dataset.open = 'true';
        let prevented = false;
        hooks.handleCardAction({
            target: {
                closest() {
                    return { dataset: { action: 'reveal-meaning' } };
                }
            },
            preventDefault() {
                prevented = true;
            }
        });
        assert.strictEqual(hooks.state.session.stage, 'recognition');
        assert.strictEqual(prevented, false);
        elements.listModal.dataset.open = 'false';
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
        let switcherSyncCalls = 0;
        hooks.state.ui.listSwitcher = {
            syncFromStore() {
                switcherSyncCalls += 1;
                return true;
            }
        };
        windowStub.VocabDataIO = {
            importWordList: async () => ({
                type: 'progress',
                entries: [{ word: 'theta', meaning: 'T', nextReview: '2026-07-25T00:00:00.000Z' }],
                meta: {
                    category: 'user',
                    listId: 'spelling-errors-p1',
                    config: { dailyNew: 5, reviewLimit: 10, masteryCount: 2, notify: false }
                }
            })
        };

        await hooks.performImport({ name: 'progress.json' });
        assert.strictEqual(store.words.length, 1);
        assert.strictEqual(store.config.dailyNew, 5);
        assert.strictEqual(store.config.activeListId, 'spelling-errors-p1');
        assert.strictEqual(store.replaceProgressCalls[0].listId, 'spelling-errors-p1');
        assert.strictEqual(store.replaceProgressCalls[0].words[0].nextReview, '2026-07-25T00:00:00.000Z');
        assert.strictEqual(switcherSyncCalls, 1);
        hooks.state.ui.listSwitcher = null;
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
