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
    const eventListeners = new Map();
    const commitListeners = [];
    const sandbox = {
        console: { warn() {} }, setTimeout, clearTimeout,
        localStorage: {
            getItem() { throw new Error('A display consumer must not read legacy storage'); },
            setItem() { throw new Error('A display consumer must not write legacy storage'); }
        },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        addEventListener(type, listener) {
            if (!eventListeners.has(type)) eventListeners.set(type, []);
            eventListeners.get(type).push(listener);
        },
        dispatchEvent(event) {
            events.push(event);
            (eventListeners.get(event.type) || []).forEach((listener) => listener(event));
        },
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
        async commit(target = 'vocab.readingState') {
            commitListeners.forEach((listener) => listener({ targets: [{ logicalKey: target }] }));
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

test('Bookshelf counts distinct associated terms, searches beyond previews, and retains a cleared visit', async () => {
    const f = fixture();
    await f.store.init();
    let snapshot = clone(f.canonical.snapshot);
    for (let index = 2; index <= 8; index += 1) {
        snapshot = f.model.collect(snapshot, {
            source: sourceA, article: { examId: 'same-exam' }, word: { word: `word-${index}`, meaning: `Meaning ${index}` }, at
        });
    }
    snapshot = f.model.collect(snapshot, {
        source: sourceB, article: { examId: 'same-exam' }, word: { word: 'APPLE', meaning: 'apple' }, at
    });
    f.setCanonical({ snapshot, revision: 2, generation: 'original' });
    await f.commit();
    const rows = f.store.getBookshelfExams();
    assert.equal(rows[0].wordCount, 8);
    assert.equal(rows[1].wordCount, 2);
    assert.equal(f.store.getDistinctWordCount(), 9, 'shared terms count only once globally');
    assert.equal(rows[0].sampleWords.length, 6);
    assert.equal(rows[0].allWords.includes('word-8'), true);

    const root = { innerHTML: '' };
    f.sandbox.document.querySelector = () => root;
    const view = f.sandbox.BookshelfView;
    view.bindCardEvents = () => {};
    view.state.searchQuery = 'word-8';
    view.render();
    assert.match(root.innerHTML, /data-article-id=/);
    assert.doesNotMatch(root.innerHTML, /未找到匹配的篇目/);

    snapshot = f.model.clearArticle(snapshot, { articleId: f.model.articleId(sourceA, 'same-exam'), at });
    f.setCanonical({ snapshot, revision: 3, generation: 'original' });
    await f.commit();
    assert.equal(f.store.getBookshelfExams()[0].wordCount, 0);
    assert.equal(f.store.getBookshelfExams()[1].wordCount, 2);
    assert.equal(f.store.getDistinctWordCount(), 2);
    assert.equal(f.store.getBookshelfExams().length, 2, 'clearing terms preserves independent visits');
    assert.match(root.innerHTML, /未找到匹配的篇目/);
});

test('Bookshelf preserves stored titles and displays and searches source identity and imported category', async () => {
    const f = fixture();
    f.sandbox.AppData.library.listConfigurations = async () => [{ id: 'library-b', name: 'Research Collection' }];
    f.sandbox.AppData.library.getIndex = async () => [{ id: 'same-exam', title: 'Changed title', category: 'Science' }];
    await f.store.init();
    const article = f.store.getBookshelfExams().find((row) => row.source.id === 'library-b');
    assert.equal(article.title, 'library-b', 'the original stored article title remains visible');
    assert.equal(article.sourceLabel, '导入题库 · Research Collection (library-b)');
    assert.equal(article.category, 'Science');
    assert.equal(article.sourceUnavailable, false);
    const root = { innerHTML: '' };
    f.sandbox.document.querySelector = () => root;
    const view = f.sandbox.BookshelfView;
    view.bindCardEvents = () => {};
    for (const query of ['research collection', 'library-b', 'science']) {
        view.state.searchQuery = query;
        view.render();
        assert.match(root.innerHTML, /Research Collection \(library-b\)/);
        assert.doesNotMatch(root.innerHTML, /未找到匹配的篇目/);
    }
    f.sandbox.AppData.library.getIndex = async () => [];
    await f.commit('library.importedIndexes');
    const unavailable = f.store.getBookshelfExams().find((row) => row.source.id === 'library-b');
    assert.equal(unavailable.sourceUnavailable, true);
    assert.equal(unavailable.wordCount, 1, 'missing content never discards vocabulary');
    view.state.searchQuery = '';
    view.render();
    assert.match(root.innerHTML, /原题库内容不可用/);
});

test('Bookshelf adopts acknowledged reader changes immediately and refreshes merge and replacement counts', async () => {
    const f = fixture();
    await f.store.init();
    const added = f.model.collect(f.canonical.snapshot, {
        source: sourceA, article: { examId: 'same-exam' }, word: { word: 'cedar', meaning: 'A tree' }, at
    });
    f.sandbox.ReadingVocabStore = { _state: { snapshot: added, revision: 2, generation: 'original' } };
    f.sandbox.dispatchEvent({ type: 'reading-vocab-store-updated' });
    assert.equal(f.store.getDistinctWordCount(), 3);
    const incoming = f.model.recordVisit(f.model.createSnapshot(), {
        source: sourceA, article: { examId: 'zero-visit', title: 'No words yet' }, at
    });
    f.setCanonical({ snapshot: f.model.merge(added, incoming), revision: 3, generation: 'original' });
    await f.commit();
    assert.equal(f.store.getBookshelfExams().length, 3);
    assert.equal(f.store.getDistinctWordCount(), 3);
    f.setCanonical({ snapshot: incoming, revision: 4, generation: 'restored' });
    await f.commit();
    assert.equal(f.store.getBookshelfExams().length, 1);
    assert.equal(f.store.getBookshelfExams()[0].wordCount, 0);
    assert.equal(f.store.getDistinctWordCount(), 0);
});

test('Cold Bookshelf loads real runtime groups and only opens the latest source-scoped request', async () => {
    const f = fixture();
    await f.store.init();
    const loadedGroups = [];
    const opens = [];
    const gate = deferred();
    f.sandbox.AppLazyLoader = { async ensureGroup(group) {
        loadedGroups.push(group);
        await gate.promise;
        f.sandbox.ReadingVocabReader = { async open(examId, options) { opens.push({ examId, options: clone(options) }); } };
    } };
    const view = f.sandbox.BookshelfView;
    const first = view.launchExamVocabReader('same-exam', sourceA, f.model.articleId(sourceA, 'same-exam'));
    const second = view.launchExamVocabReader('same-exam', sourceB, f.model.articleId(sourceB, 'same-exam'));
    assert.equal(view.state.readerLoading, true);
    assert.deepEqual(loadedGroups, ['exam-data', 'browse-runtime']);
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(opens.length, 1);
    assert.equal(opens[0].examId, 'same-exam');
    assert.deepEqual(opens[0].options.source, sourceB);
    assert.equal(opens[0].options.articleId, f.model.articleId(sourceB, 'same-exam'));
    assert.equal(opens[0].options.fromView, 'bookshelf');
    assert.equal(opens[0].options.title, 'library-b');
    assert.equal(view.state.readerLoading, false);
});

test('Bookshelf exposes retry after lazy-load failure and cold global notebook uses the shared reader', async () => {
    const f = fixture();
    await f.store.init();
    const view = f.sandbox.BookshelfView;
    f.sandbox.AppLazyLoader = { async ensureGroup() { throw new Error('offline'); } };
    await view.launchGlobalNotebook();
    assert.match(view.state.readerError.message, /offline/);
    assert.equal(view.state.readerLoading, false);
    let options;
    f.sandbox.AppLazyLoader = { async ensureGroup() {
        f.sandbox.ReadingVocabReader = { async open() {}, async openNotebook(value) { options = value; } };
    } };
    await view.launchGlobalNotebook();
    assert.equal(options.fromView, 'bookshelf');
    assert.equal(view.state.readerError, null);
});

test('Bookshelf practice source guard refuses another active library and removed source content', async () => {
    const f = fixture();
    await f.store.init();
    const view = f.sandbox.BookshelfView;
    const toasts = [];
    view.showToast = (message) => toasts.push(message);
    const article = f.store.getBookshelfExams().find((row) => row.source.id === 'library-b');
    assert.equal(await view.canOpenOriginalSource(article), false);
    assert.match(toasts.pop(), /切换至原题库/);
    f.sandbox.AppData.library.getActive = async () => 'library-b';
    f.sandbox.AppData.library.getIndex = async () => [];
    assert.equal(await view.canOpenOriginalSource(article), false);
    assert.match(toasts.pop(), /原题库内容已不可用/);
    f.sandbox.AppData.library.getIndex = async () => [{ id: 'same-exam' }];
    f.sandbox.ReadingVocabReader = { async open() {} };
    assert.equal(await view.canOpenOriginalSource(article), true);
});

test('Leaving Bookshelf cancels a pending cold open and returns to the initiating view', async () => {
    const f = fixture();
    await f.store.init();
    const gate = deferred();
    let opens = 0;
    const navigations = [];
    f.sandbox.app = { async navigateToView(view) { navigations.push(view); } };
    f.sandbox.AppLazyLoader = { async ensureGroup() {
        await gate.promise;
        f.sandbox.ReadingVocabReader = { async open() { opens += 1; } };
    } };
    const view = f.sandbox.BookshelfView;
    view.state.fromView = 'overview';
    const pending = view.launchExamVocabReader('same-exam', sourceA);
    await view.navigateToMoreView();
    gate.resolve();
    await pending;
    assert.equal(opens, 0);
    assert.deepEqual(navigations, ['overview']);
    assert.equal(view.state.fromView, null);
    await view.navigateToMoreView();
    assert.deepEqual(navigations, ['overview', 'more']);
});

test('External navigation away and back cancels a pending Bookshelf reader launch', async () => {
    const f = fixture();
    await f.store.init();
    const gate = deferred();
    let navigation = 1;
    let opens = 0;
    f.sandbox.__getAppNavigationIntentGeneration = () => navigation;
    f.sandbox.AppLazyLoader = { async ensureGroup() {
        await gate.promise;
        f.sandbox.ReadingVocabReader = { async open() { opens += 1; } };
    } };
    const view = f.sandbox.BookshelfView;
    const pending = view.launchExamVocabReader('same-exam', sourceA);
    navigation += 1; // A navbar action leaves Bookshelf without its back button.
    navigation += 1; // Returning before the old load completes does not revive it.
    gate.resolve();
    await pending;
    assert.equal(opens, 0);
    assert.equal(view.state.readerLoading, false);
    assert.equal(view.state.readerError, null);
    await view.launchExamVocabReader('same-exam', sourceA);
    assert.equal(opens, 1, 'a fresh invocation from the returned view still opens normally');
});

test('Bookshelf practice source guard rechecks source and displayed index provenance after lazy loading', async () => {
    const f = fixture();
    await f.store.init();
    const gate = deferred();
    let activeId = 'library-b';
    f.sandbox.AppData.library.getActive = async () => activeId;
    f.sandbox.AppData.library.getIndex = async () => [{ id: 'same-exam' }];
    f.sandbox.AppLazyLoader = { async ensureGroup() {
        await gate.promise;
        f.sandbox.ReadingVocabReader = { async open() {} };
    } };
    const view = f.sandbox.BookshelfView;
    const toasts = [];
    view.showToast = (message) => toasts.push(message);
    const article = f.store.getBookshelfExams().find((row) => row.source.id === 'library-b');
    const pending = view.canOpenOriginalSource(article);
    await new Promise((resolve) => setTimeout(resolve, 0));
    activeId = null;
    gate.resolve();
    assert.equal(await pending, false, 'a library activation during lazy loading cancels the action');
    assert.match(toasts.pop(), /题库已切换或正在更新/);
    activeId = 'library-b';
    f.sandbox.examIndex = [{ id: 'same-exam', libraryConfigurationId: null }];
    assert.equal(await view.canOpenOriginalSource(article), false, 'a stale builtin index cannot supply an imported article');
    f.sandbox.examIndex = [{ id: 'same-exam', libraryConfigurationId: 'library-c' }];
    assert.equal(await view.canOpenOriginalSource(article), false, 'another imported index with the same exam ID is rejected');
    f.sandbox.examIndex = [{ id: 'same-exam', libraryConfigurationId: 'library-b' }];
    assert.equal(await view.canOpenOriginalSource(article), true);
});
