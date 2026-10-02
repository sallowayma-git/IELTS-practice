import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), context, { filename: relativePath });
}

function progressHarness() {
    const elements = new Map();
    const document = {
        addEventListener() {},
        querySelector(selector) {
            if (!elements.has(selector)) elements.set(selector, { style: {}, dataset: {}, textContent: '' });
            return elements.get(selector);
        }
    };
    const window = { addEventListener() {} };
    const context = vm.createContext({ window, document, console });
    loadScript('js/app.js', context);
    return { app: vm.runInContext('new ExamSystemApp()', context), elements };
}

function legacyProgress(exams, records, category) {
    const total = exams.filter((exam) => exam.category === category).length;
    const completed = new Set(records.filter((record) => {
        const exam = exams.find((item) => item.id === record.examId);
        return exam && exam.category === category;
    }).map((record) => record.examId)).size;
    return { total, completed, progress: total ? completed / total * 100 : 0 };
}

test('category progress preserves duplicate IDs, record deduplication, unknown IDs and strict ID matching', () => {
    const { app, elements } = progressHarness();
    const exams = [
        { id: 'duplicate', category: 'P1' }, { id: 'duplicate', category: 'P2' },
        { id: 'unknown-first', category: 'Custom' }, { id: 'unknown-first', category: 'P3' },
        { id: 12, category: 'P2' }, { id: '12', category: 'P3' },
        { id: NaN, category: 'P1' }, { category: 'P2' }
    ];
    const records = ['duplicate', 'duplicate', 'unknown-first', 12, '12', NaN, undefined, 'missing']
        .map((examId) => ({ examId }));
    app.updateCategoryStats(exams, records);
    for (const category of ['P1', 'P2', 'P3']) {
        const expected = legacyProgress(exams, records, category);
        const fill = elements.get(`[data-category="${category}"] .progress-fill`);
        const text = elements.get(`[data-category="${category}"] .progress-text`);
        assert.equal(fill.style.width, `${expected.progress}%`);
        assert.equal(fill.dataset.progress, expected.progress);
        assert.equal(text.textContent, `${expected.completed}/${expected.total} 已完成`);
    }
});

test('category progress accesses index IDs once instead of once per practice record', () => {
    const { app } = progressHarness();
    let idReads = 0;
    const exams = Array.from({ length: 2000 }, (_, index) => ({
        get id() { idReads += 1; return index; },
        category: `P${index % 3 + 1}`
    }));
    const records = Array.from({ length: 5000 }, (_, index) => ({ examId: index % exams.length }));
    app.updateCategoryStats(exams, records);
    assert.equal(idReads, exams.length, 'index IDs must be read exactly once regardless of record count');
});

function renderHarness() {
    const document = { createDocumentFragment() {
        return { childNodes: [], appendChild(node) { this.childNodes.push(node); } };
    } };
    const window = {};
    const context = vm.createContext({ window, document });
    loadScript('js/views/overviewView.js', context);
    let replacements = 0;
    const dom = { replaceContent(container, fragment) {
        replacements += 1;
        container.childNodes = fragment.childNodes.slice();
    } };
    const view = new window.AppViews.OverviewView({ domBuilder: dom });
    // Keep the real render/invalidation path; card construction itself isn't
    // relevant to deciding whether to replace existing focus-bearing nodes.
    view.createSection = ({ entries }) => ({ entries });
    view.createBookshelfButton = view.createEndlessModeButton = view.createSuiteModeButton = () => ({});
    return { view, container: { childNodes: [] }, replacements: () => replacements };
}

test('overview keeps unchanged nodes and applies updated callbacks without rebuilding cards', () => {
    const { view, container, replacements } = renderHarness();
    const stats = { reading: [{ category: 'P1', type: 'reading', total: 4 }] };
    view.render(stats, { container });
    const node = container.childNodes[0];
    const callback = () => {};
    view.render({ reading: [{ ...stats.reading[0] }], meta: { readingUnknown: 9 } }, {
        container, actions: { onRandomPractice: callback }
    });
    assert.equal(replacements(), 1);
    assert.equal(container.childNodes[0], node);
    assert.equal(view.actions.onRandomPractice, callback);
});

test('overview invalidates on in-place count/category/type edits, container replacement and external clearing', () => {
    const { view, container, replacements } = renderHarness();
    const entry = { category: 'P1', type: 'reading', total: 4 };
    const stats = { reading: [entry] };
    view.render(stats, { container });
    entry.total = 5;
    view.render(stats, { container });
    entry.category = 'P2';
    view.render(stats, { container });
    entry.type = 'listening';
    view.render(stats, { container });
    container.childNodes = [];
    view.render(stats, { container });
    view.render(stats, { container: { childNodes: [] } });
    assert.equal(replacements(), 6);
});
