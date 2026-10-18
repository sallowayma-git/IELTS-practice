import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const examActionsSource = fs.readFileSync(new URL('../../../js/app/examActions.js', import.meta.url), 'utf8');
const legacyViewSource = fs.readFileSync(new URL('../../../js/views/legacyViewBundle.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../../../js/main.js', import.meta.url), 'utf8');
const bookshelfSource = fs.readFileSync(new URL('../../../js/components/bookshelfView.js', import.meta.url), 'utf8');
const resourceCoreSource = fs.readFileSync(new URL('../../../js/core/resourceCore.js', import.meta.url), 'utf8');
const mainCss = fs.readFileSync(new URL('../../../css/main.css', import.meta.url), 'utf8');
const bookshelfCss = fs.readFileSync(new URL('../../../css/vocab-reader.css', import.meta.url), 'utf8');

class FakeNode {}

class FakeTextNode extends FakeNode {
    constructor(value) {
        super();
        this.value = String(value);
    }

    get textContent() {
        return this.value;
    }
}

class FakeElement extends FakeNode {
    constructor(tagName) {
        super();
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.dataset = {};
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        this._className = '';
        this._textContent = '';
        this.classList = {
            add: (...names) => {
                const values = new Set(this._className.split(/\s+/).filter(Boolean));
                names.forEach((name) => values.add(String(name)));
                this._className = Array.from(values).join(' ');
            },
            contains: (name) => this._className.split(/\s+/).includes(String(name))
        };
    }

    set className(value) {
        this._className = String(value || '');
    }

    get className() {
        return this._className;
    }

    set textContent(value) {
        this._textContent = String(value == null ? '' : value);
        this.children = [];
    }

    get textContent() {
        return this._textContent + this.children.map((child) => child.textContent || '').join('');
    }

    appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
    }

    getAttribute(name) {
        return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(String(name));
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }
}

function createDocument() {
    return {
        body: new FakeElement('body'),
        createElement(tagName) { return new FakeElement(tagName); },
        createTextNode(value) { return new FakeTextNode(value); },
        createDocumentFragment() { return new FakeElement('fragment'); },
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}
    };
}

function createSandbox() {
    const document = createDocument();
    const window = {
        document,
        console: { log() {}, warn() {}, error() {} },
        addEventListener() {},
        dispatchEvent() {},
        location: { protocol: 'file:', href: 'file:///test/index.html' }
    };
    const sandbox = {
        window,
        document,
        Node: FakeNode,
        console: window.console,
        setTimeout,
        clearTimeout,
        requestAnimationFrame(callback) { callback(); },
        CustomEvent: class {},
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise,
        URL,
        URLSearchParams,
        fetch: async () => ({ ok: true, status: 200 })
    };
    sandbox.globalThis = window;
    const context = vm.createContext(sandbox);
    vm.runInContext(resourceCoreSource, context, { filename: 'js/core/resourceCore.js' });
    return context;
}

function descendants(root) {
    const result = [];
    const visit = (node) => {
        if (!node || !Array.isArray(node.children)) return;
        node.children.forEach((child) => {
            if (child instanceof FakeElement) result.push(child);
            visit(child);
        });
    };
    visit(root);
    return result;
}

function elementsWithAction(root, action) {
    return descendants(root).filter((node) => node.dataset.action === action);
}

function unavailableStates(root) {
    return descendants(root).filter((node) => node.classList.contains('pdf-unavailable-state'));
}

function assertNonInteractiveUnavailableState(card) {
    const states = unavailableStates(card);
    assert.equal(states.length, 1, 'one visible unavailable state should replace the PDF action');
    const state = states[0];
    assert.equal(state.tagName, 'SPAN');
    assert.equal(state.textContent, '此PDF不存在');
    assert.equal(state.dataset.action, undefined);
    assert.equal(state.hasAttribute('role'), false);
    assert.equal(state.hasAttribute('tabindex'), false);
    assert.equal(state.listeners.size, 0);
    assert.equal(elementsWithAction(card, 'pdf').length, 0);
}

const available = {
    id: 'available-reading', title: 'Available', category: 'P1', type: 'reading',
    hasHtml: true, hasPdf: true, pdfFilename: 'ReadingPractice/PDF/available.pdf'
};
const unavailable = {
    id: 'missing-reading', title: 'Missing', category: 'P1', type: 'reading',
    hasHtml: true, hasPdf: false, pdfFilename: 'ReadingPractice/PDF/expected-but-missing.pdf'
};
const unavailablePdfOnly = { ...unavailable, id: 'missing-pdf-only', hasHtml: false };
const legacyListening = {
    id: 'listening-legacy', title: 'Legacy listening', category: 'P1', type: 'listening',
    hasHtml: true, pdfFilename: 'ListeningPractice/PDF/legacy.pdf'
};
const pathOnlyLegacyListening = {
    id: 'legacy-audio-set', title: 'Path-only legacy listening', category: 'P1',
    path: 'P1/legacy-set/', hasHtml: false, pdfFilename: 'ListeningPractice/PDF/path-only.pdf'
};

test('primary ExamActions cards expose only verified PDFs and keep unavailable HTML practice', () => {
    const context = createSandbox();
    vm.runInContext(examActionsSource, context, { filename: 'js/app/examActions.js' });

    const availableCard = context.window.ExamListView.createExamCard(available);
    assert.equal(elementsWithAction(availableCard, 'pdf').length, 1);
    assert.equal(elementsWithAction(availableCard, 'start').length, 1);
    assert.equal(unavailableStates(availableCard).length, 0);

    const unavailableCard = context.window.ExamListView.createExamCard(unavailable);
    assertNonInteractiveUnavailableState(unavailableCard);
    assert.equal(elementsWithAction(unavailableCard, 'start').length, 1,
        'missing PDF must not remove the independent HTML exercise');

    const pdfOnlyCard = context.window.ExamListView.createExamCard(unavailablePdfOnly);
    assertNonInteractiveUnavailableState(pdfOnlyCard);
    assert.equal(elementsWithAction(pdfOnlyCard, 'start').length, 0,
        'an unavailable PDF-only entry must not retain an implicit start action');

    const listeningCard = context.window.ExamListView.createExamCard(legacyListening);
    assert.equal(elementsWithAction(listeningCard, 'pdf').length, 1,
        'the reading-only contract must not hide legacy listening PDF actions');

    const pathOnlyListeningCard = context.window.ExamListView.createExamCard(pathOnlyLegacyListening);
    assert.equal(elementsWithAction(pathOnlyListeningCard, 'pdf').length, 1,
        'P1 path-only listening entries should retain their legacy PDF action');
    assert.equal(elementsWithAction(pathOnlyListeningCard, 'start').length, 1,
        'a path-only listening PDF should remain launchable without HTML');
    assert.equal(unavailableStates(pathOnlyListeningCard).length, 0);
});

test('LegacyExamListView fallback uses the same non-interactive unavailable state', () => {
    const context = createSandbox();
    vm.runInContext(legacyViewSource, context, { filename: 'js/views/legacyViewBundle.js' });
    const view = new context.window.LegacyExamListView({ supportsGenerate: false });
    view._getCompletionStatus = () => null;

    const availableCard = view._createExamElement(available, 0, {});
    assert.equal(elementsWithAction(availableCard, 'pdf').length, 1);

    const unavailableCard = view._createExamElement(unavailable, 0, {});
    assertNonInteractiveUnavailableState(unavailableCard);
    assert.equal(elementsWithAction(unavailableCard, 'start').length, 1);

    const pdfOnlyCard = view._createExamElement(unavailablePdfOnly, 0, {});
    assertNonInteractiveUnavailableState(pdfOnlyCard);
    assert.equal(elementsWithAction(pdfOnlyCard, 'start').length, 0);

    const listeningCard = view._createExamElement(legacyListening, 0, {});
    assert.equal(elementsWithAction(listeningCard, 'pdf').length, 1);

    const pathOnlyListeningCard = view._createExamElement(pathOnlyLegacyListening, 0, {});
    assert.equal(elementsWithAction(pathOnlyListeningCard, 'pdf').length, 1);
    assert.equal(elementsWithAction(pathOnlyListeningCard, 'start').length, 1);
    assert.equal(unavailableStates(pathOnlyListeningCard).length, 0);
});

function extractMainFallbackRenderer() {
    const start = mainSource.indexOf('function createFallbackExamCard(');
    const end = mainSource.indexOf('\nfunction loadExamListFallback(', start);
    assert.notEqual(start, -1, 'main fallback renderer should exist');
    assert.notEqual(end, -1, 'main fallback renderer boundary should exist');
    return mainSource.slice(start, end);
}

test('final main.js fallback never attaches a PDF handler to unavailable state', () => {
    const context = createSandbox();
    context.openExam = () => {};
    context.viewPDF = () => {};
    vm.runInContext(extractMainFallbackRenderer(), context, { filename: 'js/main.js#createFallbackExamCard' });

    const availableCard = context.createFallbackExamCard(available);
    const availablePdf = descendants(availableCard).find((node) => node.tagName === 'BUTTON' && node.textContent === 'PDF');
    assert.ok(availablePdf);
    assert.equal(availablePdf.listeners.get('click')?.length, 1);

    const unavailableCard = context.createFallbackExamCard(unavailable);
    assertNonInteractiveUnavailableState(unavailableCard);
    assert.ok(descendants(unavailableCard).some((node) => node.tagName === 'BUTTON' && node.textContent === '开始练习'));
    assert.equal(descendants(unavailableCard).some((node) => node.textContent === 'PDF'), false);

    const pdfOnlyCard = context.createFallbackExamCard(unavailablePdfOnly);
    assertNonInteractiveUnavailableState(pdfOnlyCard);
    assert.equal(descendants(pdfOnlyCard).some((node) => node.tagName === 'BUTTON' && node.textContent === '开始练习'), false);

    const listeningCard = context.createFallbackExamCard(legacyListening);
    assert.ok(descendants(listeningCard).some((node) => node.tagName === 'BUTTON' && node.textContent === 'PDF'));

    const pathOnlyListeningCard = context.createFallbackExamCard(pathOnlyLegacyListening);
    assert.ok(descendants(pathOnlyListeningCard).some((node) => node.tagName === 'BUTTON' && node.textContent === 'PDF'));
    assert.ok(descendants(pathOnlyListeningCard).some((node) => node.tagName === 'BUTTON' && node.textContent === '开始练习'));
    assert.equal(unavailableStates(pathOnlyListeningCard).length, 0);
});

test('bookshelf cards replace a missing PDF action with exact plain-text markup', () => {
    const context = createSandbox();
    vm.runInContext(bookshelfSource, context, { filename: 'js/components/bookshelfView.js' });
    const base = {
        articleId: 'article-1', examId: 'reading-1', title: 'Reading', category: 'P1',
        sourceLabel: '内置题库', wordCount: 0, sampleWords: [], lastActivityAt: 0
    };

    const missingMarkup = context.window.BookshelfView.renderExamCard({
        ...base, hasPdf: false, pdfFilename: 'ReadingPractice/PDF/missing.pdf'
    });
    assert.match(missingMarkup, /<span class="pdf-unavailable-state bookshelf-pdf-unavailable">此PDF不存在<\/span>/);
    assert.doesNotMatch(missingMarkup, /data-action="open-exam-pdf"/);
    assert.doesNotMatch(missingMarkup, /<button[^>]*>\s*此PDF不存在\s*<\/button>/);

    const availableMarkup = context.window.BookshelfView.renderExamCard({
        ...base, hasPdf: true, pdfFilename: 'ReadingPractice/PDF/available.pdf'
    });
    assert.match(availableMarkup, /data-action="open-exam-pdf"/);
    assert.match(availableMarkup, /📄 PDF/);
    assert.doesNotMatch(availableMarkup, /此PDF不存在/);
});

test('system PDF count follows the shared availability predicate, not a retained filename', () => {
    const start = mainSource.indexOf('function updateSystemInfo(');
    const end = mainSource.indexOf('\nfunction showMessage(', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    const context = createSandbox();
    const elements = new Map([
        ['total-exams', { textContent: '' }],
        ['html-exams', { textContent: '' }],
        ['pdf-exams', { textContent: '' }],
        ['last-update', { textContent: '' }]
    ]);
    context.document.getElementById = (id) => elements.get(id) || null;
    context.getResourceCore = () => context.window.ResourceCore;
    vm.runInContext(mainSource.slice(start, end), context, { filename: 'js/main.js#updateSystemInfo' });

    context.updateSystemInfo([
        available,
        unavailable,
        { ...unavailable, id: 'filename-only', hasPdf: undefined },
        legacyListening,
        pathOnlyLegacyListening
    ]);

    assert.equal(elements.get('total-exams').textContent, 5);
    assert.equal(elements.get('pdf-exams').textContent, 3);
});

test('unavailable-state CSS is present for question-bank and bookshelf surfaces', () => {
    assert.match(mainCss, /\.pdf-unavailable-state\s*\{/);
    assert.match(mainCss, /\.exam-item-pdf-unavailable\s*\{/);
    assert.match(bookshelfCss, /\.bookshelf-pdf-unavailable\s*\{/);
});
