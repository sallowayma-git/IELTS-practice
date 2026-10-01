import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const modelSource = fs.readFileSync(new URL('../../../js/data/v2/readingVocabularyModel.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../../js/data/v2/readingViewCache.js', import.meta.url), 'utf8');
function fixture() {
    const sandbox = { setTimeout, clearTimeout, __AppDataV2Internals: { checksum: JSON.stringify } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(modelSource, sandbox);
    vm.runInContext(source, sandbox);
    const model = sandbox.ReadingVocabularyModel;
    let snapshot = model.createSnapshot();
    const article = { examId: 'one', title: 'Article' };
    const owner = { kind: 'builtin', id: 'default' };
    for (let i = 0; i < 25; i++) snapshot = model.collect(snapshot, {
        source: owner, article, word: { word: `word${i}`, meaning: 'Meaning must never appear in a preview' }, at: '2026-09-30T00:00:00.000Z'
    });
    let token = 'original';
    let reads = 0;
    let readHook;
    const cache = sandbox.createReadingViewCache({
        readToken: async () => token,
        readSnapshot: async () => {
            reads++;
            const result = { snapshot: JSON.parse(JSON.stringify(snapshot)), revision: reads, generation: 'generation' };
            if (readHook) { const fn = readHook; readHook = null; fn(); }
            return result;
        }
    });
    return { cache, model, articleId: model.articleId(owner, article.examId), get reads() { return reads; },
        clear() { snapshot = model.createSnapshot(); token = 'deleted'; },
        race() { readHook = () => { snapshot = model.createSnapshot(); token = 'restored'; }; } };
}
test('reading cache builds once, reads ten words per page, and searches beyond previews', async () => {
    const f = fixture();
    const index = await f.cache.index();
    assert.equal(index.articles[0].wordCount, 25);
    assert.equal(index.distinctWordCount, 25);
    assert.ok(!JSON.stringify(index).includes('Meaning'));
    assert.ok(!JSON.stringify(index).includes('word24'));
    for (const [page, count] of [[0, 10], [1, 10], [2, 5], [3, 0]]) {
        assert.equal((await f.cache.words(f.articleId, page)).words.length, count);
    }
    assert.equal((await f.cache.search('word24'))[0], f.articleId);
    const first = await f.cache.words(f.articleId, 0);
    first.words[0] = 'caller mutation';
    assert.equal((await f.cache.words(f.articleId, 0)).words[0], 'word0');
    assert.equal(f.reads, 1, 'paging and search must not read the canonical snapshot again');
    await assert.rejects(f.cache.words(f.articleId, -1));
});
test('missed notifications and deletions invalidate both card and word pages', async () => {
    const f = fixture();
    await f.cache.index();
    f.clear();
    assert.equal((await f.cache.words(f.articleId, 0)).words.length, 0);
    assert.equal((await f.cache.index()).articles.length, 0);
    assert.equal((await f.cache.search('word')).length, 0);
    assert.equal(f.reads, 2);
});
test('a concurrent restore during backfill cannot publish obsolete cards', async () => {
    const f = fixture();
    f.race();
    const [a, b] = await Promise.all([f.cache.index(), f.cache.index()]);
    assert.equal(a.articles.length, 0);
    assert.equal(b.token, 'restored');
    assert.equal(f.reads, 2, 'concurrent consumers share one retrying rebuild');
});
