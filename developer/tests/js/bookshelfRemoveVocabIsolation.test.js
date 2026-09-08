import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bookshelfCode = fs.readFileSync(new URL('../../../js/components/bookshelfView.js', import.meta.url), 'utf8');
const modelCode = fs.readFileSync(new URL('../../../js/data/v2/readingVocabularyModel.js', import.meta.url), 'utf8');
const sourceA = { kind: 'builtin', id: 'default' };
const sourceB = { kind: 'imported', id: 'library-b' };
const at = '2026-09-08T00:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

function fixture() {
    const events = [];
    const commitListeners = [];
    const sandbox = {
        console: { warn() {} }, setTimeout, clearTimeout,
        localStorage: {
            getItem() { throw new Error('A display consumer must not read legacy storage'); },
            setItem() { throw new Error('A display consumer must not write legacy storage'); }
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        addEventListener() {}, dispatchEvent(event) { events.push(event); },
        document: { querySelector() { return null; }, getElementById() { return null; } }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(modelCode, sandbox);
    const model = sandbox.ReadingVocabularyModel;
    let snapshot = model.createSnapshot();
    for (const [source, word] of [[sourceA, 'apple'], [sourceB, 'banana']]) {
        const command = { source, article: { examId: 'same-exam', title: source.id }, word: { word, meaning: word }, at };
        snapshot = model.recordVisit(model.collect(snapshot, command), command);
    }
    let canonical = { snapshot, revision: 1, generation: 'original' };
    let failure = null;
    let gate = null;
    const calls = [];
    const practice = [{ id: 'practice-1', examId: 'same-exam', score: 11 }];
    sandbox.AppData = {
        ready: Promise.resolve(),
        backups: { onDataCommitted(listener) { commitListeners.push(listener); } },
        library: { async getActive() { return null; } },
        practice: { records: practice },
        vocab: {
            readingModel: model,
            async getReadingSnapshot() {
                if (failure) throw failure;
                return clone(canonical);
            },
            async mutateReading(type, command, options) {
                calls.push({ type, command: clone(command), options: clone(options) });
                if (gate) await gate.promise;
                if (failure) throw failure;
                let next = clone(canonical.snapshot);
                if (type === 'removeArticle') {
                    if (command.clearWords) next = model.clearArticle(next, command);
                    next.reading.visits = next.reading.visits.filter((row) => row.articleId !== command.articleId);
                } else if (type === 'recordVisit') {
                    next = model.recordVisit(next, { ...command, at });
                } else throw new Error('Unexpected operation');
                canonical = { ...canonical, snapshot: next, revision: canonical.revision + 1 };
                return { ...clone(canonical), saved: true };
            }
        }
    };
    vm.runInContext(bookshelfCode, sandbox);
    return {
        sandbox, model, events, calls, practice,
        store: sandbox.ReadingBookshelfStore,
        get canonical() { return canonical; },
        setCanonical(value) { canonical = value; },
        setFailure(value) { failure = value; },
        setGate(value) { gate = value; },
        async commit() {
            commitListeners.forEach((listener) => listener({ targets: [{ logicalKey: 'vocab.readingState' }] }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };
}

test('Bookshelf removal waits for one source-scoped durable operation and preserves practice records', async () => {
    const f = fixture();
    await f.store.init();
    const beforePractice = clone(f.practice);
    const before = clone(f.store.getBookshelfExams());
    assert.equal(before.length, 2, 'identical exam IDs from different libraries stay separate');
    assert.deepEqual(before.map((row) => row.sampleWords), [['apple'], ['banana']]);
    assert.equal(before[0].wordCount, 1);
    const gate = deferred();
    f.setGate(gate);
    const pending = f.store.removeExam('same-exam', true, sourceA);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(clone(f.store.getBookshelfExams()), before, 'pending removal must retain visible records');
    assert.equal(f.calls.length, 1, 'removal is one atomic operation');
    assert.equal(f.calls[0].command.articleId, f.model.articleId(sourceA, 'same-exam'));
    assert.equal(f.calls[0].options.observedRevision, 1);
    gate.resolve();
    assert.equal((await pending).saved, true);
    const after = clone(f.store.getBookshelfExams());
    assert.equal(after.length, 1);
    assert.deepEqual(after[0].source, sourceB);
    assert.deepEqual(after[0].sampleWords, ['banana']);
    assert.deepEqual(f.practice, beforePractice, 'practice history is independent from reading removal');
    assert.equal(f.canonical.snapshot.lists['reading-highlights'].words.length, 2, 'article removal preserves canonical review words');
});

test('Failed bookshelf writes retain the committed cache and retry without duplicate visits', async () => {
    const f = fixture();
    await f.store.init();
    const before = clone(f.store.getBookshelfExams());
    f.setFailure(new Error('quota'));
    await assert.rejects(f.store.removeExam('same-exam', true, sourceA), /quota/);
    assert.deepEqual(clone(f.store.getBookshelfExams()), before);
    await assert.rejects(f.store.recordExamUsed('new-exam', 'New', '', sourceA), /quota/);
    assert.deepEqual(clone(f.store.getBookshelfExams()), before);
    f.setFailure(null);
    assert.equal((await f.store.recordExamUsed('new-exam', 'New', '', sourceA)).saved, true);
    assert.equal((await f.store.recordExamUsed('new-exam', 'New', '', sourceA)).saved, true);
    assert.equal(f.store.getBookshelfExams().filter((row) => row.examId === 'new-exam').length, 1);
    assert.equal(f.store.getBookshelfExams().find((row) => row.examId === 'new-exam').wordCount, 0);
});

test('Bookshelf refresh adopts authoritative empty replacement and rejects stale same-generation snapshots', async () => {
    const f = fixture();
    await f.store.init();
    f.setFailure(new Error('read failed'));
    await assert.rejects(f.store.init(), /read failed/);
    assert.equal(f.store.getBookshelfExams().length, 2, 'failed loads retain the last committed view');
    f.setFailure(null);
    const stale = clone(f.canonical);
    f.setCanonical({ snapshot: f.model.createSnapshot(), revision: 2, generation: 'original' });
    await f.commit();
    assert.equal(f.store.getBookshelfExams().length, 0);
    f.store._adopt(stale);
    assert.equal(f.store.getBookshelfExams().length, 0, 'a slower stale response cannot restore removed cards');
    await f.store.init();
    assert.equal(f.store.getBookshelfExams().length, 0);
    assert.equal(f.calls.length, 0, 'reload and lazy initialization perform no writes');
});

test('Bookshelf retries reload the current generation after a missed replacement notification', async () => {
    const f = fixture();
    await f.store.init();
    const gate = deferred();
    f.setGate(gate);
    const pending = f.store.recordExamUsed('new-exam', 'New', '', sourceA);
    const rejection = assert.rejects(pending, /replaced/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.setCanonical({ snapshot: f.model.createSnapshot(), revision: 2, generation: 'replacement' });
    gate.reject(new Error('Reading data was replaced'));
    await rejection;
    assert.equal(f.store.getBookshelfExams().length, 0);
    f.setGate(null);
    assert.equal((await f.store.recordExamUsed('new-exam', 'New', '', sourceA)).saved, true);
    assert.equal(f.calls[1].options.observedGeneration, 'replacement');
    assert.equal(f.calls[1].options.observedRevision, 2);
});

test('Bookshelf confirmation shows pending, retains a retry after failure, and reports success only after acknowledgement', async () => {
    const f = fixture();
    await f.store.init();
    const elements = new Map([
        ['#bookshelf-confirm-text', { textContent: '' }],
        ['#bookshelf-confirm-ok', { textContent: '', disabled: false }],
        ['#bookshelf-confirm-cancel', { disabled: false }]
    ]);
    const classes = new Set(['is-hidden']);
    const overlay = {
        querySelector: (selector) => elements.get(selector),
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }
    };
    f.sandbox.document.getElementById = (id) => id === 'bookshelf-confirm-dialog' ? overlay : null;
    const view = f.sandbox.BookshelfView;
    const toasts = [];
    view.showToast = (message) => toasts.push(message);
    view.render = () => {};
    view.openConfirmDialog('same-exam', 'Article A', sourceA);
    const ok = elements.get('#bookshelf-confirm-ok');
    const gate = deferred();
    f.setGate(gate);
    f.setFailure(new Error('quota'));
    const pending = ok.onclick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(ok.disabled, true);
    assert.equal(classes.has('is-hidden'), false);
    assert.deepEqual(toasts, []);
    gate.resolve();
    await pending;
    assert.equal(ok.disabled, false);
    assert.match(ok.textContent, /重试/);
    assert.equal(classes.has('is-hidden'), false);
    assert.deepEqual(toasts, []);
    assert.equal(f.store.getBookshelfExams().length, 2);
    f.setFailure(null);
    await ok.onclick();
    assert.equal(classes.has('is-hidden'), true);
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /已从书架移除/);
    assert.equal(f.store.getBookshelfExams().length, 1);
});

test('Bookshelf backend failure offers page reload instead of retrying a latched connection', async () => {
    const f = fixture();
    await f.store.init();
    const elements = new Map([
        ['#bookshelf-confirm-text', { textContent: '' }],
        ['#bookshelf-confirm-ok', { textContent: '', disabled: false }],
        ['#bookshelf-confirm-cancel', { disabled: false }]
    ]);
    const classes = new Set(['is-hidden']);
    const overlay = {
        querySelector: (selector) => elements.get(selector),
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }
    };
    f.sandbox.document.getElementById = (id) => id === 'bookshelf-confirm-dialog' ? overlay : null;
    let reloads = 0;
    f.sandbox.location = { reload() { reloads += 1; } };
    const view = f.sandbox.BookshelfView;
    const toasts = [];
    view.showToast = (message) => toasts.push(message);
    view.openConfirmDialog('same-exam', 'Article A', sourceA);
    f.setFailure(Object.assign(new Error('Connection aborted'), { code: 'BACKEND_UNAVAILABLE' }));
    const ok = elements.get('#bookshelf-confirm-ok');
    await ok.onclick();
    assert.equal(ok.textContent, '刷新页面');
    assert.match(elements.get('#bookshelf-confirm-text').textContent, /刷新页面后重试/);
    assert.equal(classes.has('is-hidden'), false);
    assert.equal(f.store.getBookshelfExams().length, 2);
    assert.deepEqual(toasts, []);
    const attempts = f.calls.length;
    await ok.onclick();
    assert.equal(reloads, 1);
    assert.equal(f.calls.length, attempts, 'the recovery action does not repeat the doomed mutation');

    const root = { innerHTML: '' };
    f.sandbox.document.querySelector = () => root;
    view.bindCardEvents = () => {};
    view.render();
    assert.match(root.innerHTML, /data-action="reload-page"/);
    assert.doesNotMatch(root.innerHTML, /data-action="retry-load"/);
});
