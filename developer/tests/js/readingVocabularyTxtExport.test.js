import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const modelCode = source('data/v2/readingVocabularyModel.js');
const readerCode = source('components/readingVocabReader.js');
const bookshelfCode = source('components/bookshelfView.js');
const SOURCE_A = { kind: 'builtin', id: 'default' };
const SOURCE_B = { kind: 'imported', id: 'missing-library' };
const EXAM = 'same-exam';
const AT = '2026-09-09T01:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));

async function fixture() {
    const downloads = [];
    const urls = new Map();
    const pendingCleanup = [];
    const attached = new Set();
    const listeners = new Map();
    const sandbox = {
        console: { warn() {} }, Blob,
        setTimeout(callback) { pendingCleanup.push(callback); }, clearTimeout() {},
        URL: {
            createObjectURL(blob) { const url = `blob:export-${urls.size}`; urls.set(url, blob); return url; },
            revokeObjectURL(url) { urls.delete(url); }
        },
        CustomEvent: class { constructor(type) { this.type = type; } },
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        dispatchEvent(event) { (listeners.get(event.type) || []).forEach((handler) => handler(event)); },
        document: {
            body: { appendChild(node) { attached.add(node); }, removeChild(node) { attached.delete(node); } },
            querySelector() { return null; }, getElementById() { return null; },
            createElement(tag) {
                assert.equal(tag, 'a');
                return { click() {
                    assert.ok(attached.has(this), 'download link is attached before activation');
                    assert.ok(urls.has(this.href), 'download URL has not been revoked');
                    downloads.push({ filename: this.download, blob: urls.get(this.href) });
                } };
            }
        }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(modelCode, sandbox);
    const model = sandbox.ReadingVocabularyModel;
    let snapshot = model.createSnapshot({ words: [
        { id: 'review-shared', word: 'Shared', meaning: 'Canonical definition', example: 'Rich\nfields stay out', note: 'No header' },
        { id: 'unrelated-review', word: 'unrelated', meaning: 'Never collected from an article' }
    ] });
    const collect = (base, word, sourceIdentity, extra = {}) => model.collect(base, {
        source: sourceIdentity, article: { examId: EXAM, title: sourceIdentity.id },
        word: { word, meaning: 'Definition', example: 'Not exported' }, at: AT, ...extra
    });
    const occurrence = (startOffset) => ({
        scopeId: 'passage', contentVersion: 'fixture-v1', startOffset,
        endOffset: startOffset + 6, quote: 'shared', before: '', after: ''
    });
    snapshot = collect(snapshot, 'zebra', SOURCE_A, { manual: true });
    snapshot = collect(snapshot, 'shared', SOURCE_A, { occurrence: occurrence(0) });
    snapshot = collect(snapshot, 'shared', SOURCE_A, { occurrence: occurrence(15) });
    snapshot = collect(snapshot, '  SHARED  ', SOURCE_B, { manual: true });
    snapshot = collect(snapshot, 'Alpha', SOURCE_B, { manual: true });
    snapshot = collect(snapshot, 'café\u00a0\r\n\t habitat\u2028zone', SOURCE_A, { manual: true });
    let canonical = { snapshot, revision: 1, generation: 'original' };
    let failure = null;
    let readGate = null;
    let reads = 0;
    sandbox.AppData = {
        ready: Promise.resolve(), backups: { onDataCommitted() {} },
        library: {
            async getActive() { return null; }, async listConfigurations() { return []; },
            async getIndex() { return []; }
        },
        vocab: {
            readingModel: model,
            async getReadingSnapshot() {
                reads += 1;
                if (readGate) await readGate;
                if (failure) throw failure;
                return clone(canonical);
            },
            async mutateReading(type, command) {
                if (failure) throw failure;
                canonical = { ...canonical, snapshot: model[type](canonical.snapshot, command), revision: canonical.revision + 1 };
                return { ...clone(canonical), saved: true };
            }
        }
    };
    vm.runInContext(readerCode, sandbox);
    vm.runInContext(bookshelfCode, sandbox);
    const reader = sandbox.ReadingVocabStore;
    const shelf = sandbox.ReadingBookshelfStore;
    await Promise.all([reader.init(), shelf.init()]);
    return {
        model, reader, shelf, sandbox, downloads, urls, attached, collect,
        get canonical() { return canonical; }, get reads() { return reads; },
        setSnapshot(value, generation = canonical.generation) {
            canonical = { snapshot: value, generation, revision: canonical.revision + 1 };
        },
        setFailure(value) { failure = value; }, setReadGate(value) { readGate = value; },
        cleanup() { pendingCleanup.splice(0).forEach((callback) => callback()); }
    };
}

async function assertDownload(f, result, expected) {
    assert.ok(result && result.filename.endsWith('.txt'));
    assert.equal(result.count, expected.split('\n').length);
    const download = f.downloads.at(-1);
    assert.equal(download.filename, result.filename);
    assert.equal(download.blob.type, 'text/plain;charset=utf-8');
    assert.deepEqual(Buffer.from(await download.blob.arrayBuffer()), Buffer.from(expected, 'utf8'));
    assert.equal(f.attached.size, 0, 'temporary anchor is removed');
    f.cleanup();
    assert.equal(f.urls.size, 0, 'object URL is released after activation');
}

test('TXT uses canonical display owners, source-scoped associations and one line per term', async () => {
    const f = await fixture();
    const articleA = 'café habitat zone\nShared\nzebra';
    const articleB = 'Alpha\nShared';
    const global = 'Alpha\ncafé habitat zone\nShared\nzebra';
    assert.equal(f.model.query(f.canonical.snapshot).occurrenceCount, 2);
    await assertDownload(f, await f.reader.exportTxt(EXAM, 'article-a.txt', '', SOURCE_A), articleA);
    await assertDownload(f, await f.reader.exportTxt(EXAM, null, '', SOURCE_B), articleB);
    await assertDownload(f, await f.reader.exportTxt(), global);
    await assertDownload(f, await f.shelf.exportExamTxt(EXAM, 'Article A', SOURCE_A), articleA);
    await assertDownload(f, await f.shelf.exportExamTxt(EXAM, 'Article B', SOURCE_B), articleB);
    await assertDownload(f, await f.shelf.exportAllBookshelfTxt(), global);
    assert.ok(f.downloads.at(-1).filename.includes('全部精读生词'));
});

test('Global TXT ignores shelf filters and preserves vocabulary for unavailable sources', async () => {
    const f = await fixture();
    f.sandbox.BookshelfView.state.searchQuery = 'nothing matches';
    f.sandbox.BookshelfView.state.filterMode = 'has-words';
    f.sandbox.BookshelfView.state.sortBy = 'title';
    assert.equal(f.shelf.getBookshelfExams().find((row) => row.source.id === SOURCE_B.id).sourceUnavailable, true);
    await assertDownload(f, await f.shelf.exportAllBookshelfTxt(), 'Alpha\ncafé habitat zone\nShared\nzebra');
    f.sandbox.AppData.library.getIndex = async () => { throw new Error('Source was removed'); };
    await assertDownload(f, await f.shelf.exportExamTxt(EXAM, 'Missing source', SOURCE_B), 'Alpha\nShared');
});

test('Clearing A preserves B and global export while empty A produces no download', async () => {
    const f = await fixture();
    await f.reader.clear(EXAM, SOURCE_A);
    const before = f.downloads.length;
    assert.equal(await f.reader.exportTxt(EXAM, null, '', SOURCE_A), false);
    assert.equal(await f.shelf.exportExamTxt(EXAM, 'A', SOURCE_A), false);
    assert.equal(f.downloads.length, before);
    await assertDownload(f, await f.reader.exportTxt(EXAM, null, '', SOURCE_B), 'Alpha\nShared');
    await assertDownload(f, await f.shelf.exportAllBookshelfTxt(), 'Alpha\nShared');
    assert.equal(f.canonical.snapshot.words.find((word) => word.id === 'review-shared').word, 'Shared');
});

test('TXT order is independent of collection order, table order, merge and reload', async () => {
    const f = await fixture();
    const incoming = f.collect(f.model.createSnapshot(), 'Beta', SOURCE_B);
    const merged = f.model.merge(f.canonical.snapshot, incoming);
    const reverseMerged = f.model.merge(incoming, f.canonical.snapshot);
    const expected = 'Alpha\nBeta\ncafé habitat zone\nShared\nzebra';
    assert.equal(f.model.toPlainText(merged).content, expected);
    assert.equal(f.model.toPlainText(reverseMerged).content, expected);
    merged.reading.terms.reverse();
    merged.reading.associations.reverse();
    assert.equal(f.model.toPlainText(merged).content, expected);
    f.setSnapshot(f.model.deserialize(f.model.serialize(merged)));
    await assertDownload(f, await f.reader.exportTxt(), expected);
    await assertDownload(f, await f.shelf.exportAllBookshelfTxt(), expected);
});

test('Export rereads persisted data after missed notifications and empty replacement', async () => {
    const f = await fixture();
    const current = f.collect(f.canonical.snapshot, 'Delta', SOURCE_B);
    f.setSnapshot(current);
    assert.equal(f.reader.getAll().some((word) => word.word === 'Delta'), false, 'reader starts stale');
    const reads = f.reads;
    await assertDownload(f, await f.reader.exportTxt(), 'Alpha\ncafé habitat zone\nDelta\nShared\nzebra');
    assert.ok(f.reads > reads, 'export reads authoritative persistence');
    f.setSnapshot(f.model.createSnapshot(), 'replacement');
    const before = f.downloads.length;
    assert.equal(await f.reader.exportTxt(), false);
    assert.equal(await f.shelf.exportAllBookshelfTxt(), false);
    assert.equal(f.downloads.length, before);
    assert.equal(f.reader.getAll().length, 0);
});

test('Export waits for a snapshot and failed reads never download the cached vocabulary', async () => {
    const f = await fixture();
    let release;
    f.setReadGate(new Promise((resolve) => { release = resolve; }));
    const pending = f.reader.exportTxt();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.downloads.length, 0);
    release();
    await assertDownload(f, await pending, 'Alpha\ncafé habitat zone\nShared\nzebra');
    f.setReadGate(null);
    f.setFailure(new Error('Persisted snapshot read failed'));
    const before = f.downloads.length;
    await assert.rejects(f.reader.exportTxt(), /Persisted snapshot read failed/);
    await assert.rejects(f.shelf.exportAllBookshelfTxt(), /Persisted snapshot read failed/);
    assert.equal(f.downloads.length, before);
});

for (const entryPoint of ['reader', 'shelf']) {
    test(`${entryPoint} export uses its fetched snapshot while a later refresh is still pending`, async () => {
        const f = await fixture();
        f.setSnapshot(f.collect(f.canonical.snapshot, 'Delta', SOURCE_B));
        let releaseExport;
        f.setReadGate(new Promise((resolve) => { releaseExport = resolve; }));
        const pending = entryPoint === 'reader' ? f.reader.exportTxt() : f.shelf.exportAllBookshelfTxt();
        await new Promise((resolve) => setImmediate(resolve));
        let releaseRefresh;
        f.setReadGate(new Promise((resolve) => { releaseRefresh = resolve; }));
        const background = f[entryPoint].init();
        await new Promise((resolve) => setImmediate(resolve));
        try {
            releaseExport();
            await assertDownload(f, await pending, 'Alpha\ncafé habitat zone\nDelta\nShared\nzebra');
        } finally {
            releaseRefresh();
            await background;
        }
    });
}

test('Download activation errors reject and still release temporary browser resources', async () => {
    const f = await fixture();
    f.sandbox.document.createElement = () => ({ click() { throw new Error('Download denied'); } });
    await assert.rejects(f.reader.exportTxt(), /Download denied/);
    await assert.rejects(f.shelf.exportAllBookshelfTxt(), /Download denied/);
    assert.equal(f.attached.size, 0);
    f.cleanup();
    assert.equal(f.urls.size, 0);
});
