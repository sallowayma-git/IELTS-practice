#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the production contract; fixtures below contain storage data only.
const modelUrl = new URL('../../../js/data/v2/readingVocabularyModel.js', import.meta.url);
const storeUrl = new URL('../../../js/core/vocabStore.js', import.meta.url);
const sandbox = { console, Date, JSON, module: { exports: {} } };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(modelUrl, 'utf8'), sandbox, { filename: modelUrl.pathname });
const model = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const SOURCE_A = { kind: 'imported', id: 'library-a' };
const SOURCE_B = { kind: 'imported', id: 'library-b' };
const ARTICLE = { examId: 'shared-exam', title: 'A shared exam ID' };
const AT = '2026-09-08T01:00:00.000Z';
const LATER = '2026-09-08T02:00:00.000Z';
const APPLE = {
    id: 'existing-apple', word: 'apple', meaning: 'An existing definition',
    phonetic: 'æpəl', note: 'Keep my note', example: 'An apple a day.',
    easeFactor: 2.35, interval: 21, repetitions: 7, intraCycles: 1, correctCount: 9,
    lastReviewed: '2026-09-01T01:00:00.000Z', nextReview: '2026-09-22T01:00:00.000Z',
    createdAt: '2026-07-01T01:00:00.000Z', updatedAt: '2026-09-01T01:00:00.000Z',
    reviewHistory: [{ at: '2026-09-01T01:00:00.000Z', grade: 4 }]
};
const occurrence = (overrides = {}) => ({
    scopeId: 'passage-1', contentVersion: 'sha256:original',
    startOffset: 10, endOffset: 15, quote: 'apple', before: 'An ', after: ' a day.',
    ...overrides
});
const command = (overrides = {}) => Object.fromEntries(Object.entries({
    source: SOURCE_A, article: ARTICLE, word: { word: 'apple', meaning: 'A fruit' },
    occurrence: occurrence(), at: AT, ...overrides
}).filter(([, value]) => value !== undefined));

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

function mutate(name, snapshot, input) {
    const before = JSON.stringify(snapshot);
    const inputBefore = JSON.stringify(input);
    const result = model[name](deepFreeze(snapshot), deepFreeze(input));
    assert.equal(JSON.stringify(snapshot), before, `${name} must preserve its input snapshot`);
    assert.equal(JSON.stringify(input), inputBefore, `${name} must preserve its command`);
    assert.notEqual(result, snapshot, `${name} returns an independent snapshot`);
    assert.equal(model.validate(result), true, `${name} produces a valid snapshot`);
    return result;
}

function articleId(source = SOURCE_A) {
    return model.articleId(source, ARTICLE.examId);
}

function query(snapshot, source) {
    return model.query(snapshot, source ? { articleId: articleId(source) } : {});
}

function twoArticles(seed = { words: [APPLE] }) {
    let snapshot = model.createSnapshot(seed);
    for (const source of [SOURCE_A, SOURCE_B]) {
        snapshot = mutate('recordVisit', snapshot, { source, article: ARTICLE, at: AT });
    }
    snapshot = mutate('collect', snapshot, command());
    return mutate('collect', snapshot, command({
        source: SOURCE_B, word: { word: '  APPLE  ', meaning: 'Must not replace the definition' },
        occurrence: occurrence({ quote: 'APPLE', scopeId: 'passage-b' }), at: LATER
    }));
}

test('versioned identity includes source kind, stable library ID, article, scope and revision', () => {
    assert.equal(model.SCHEMA_VERSION, 1);
    assert.equal(model.READING_LIST_ID, 'reading-highlights');
    assert.equal(model.normalizeTerm('  APPLE  '), 'apple');
    assert.equal(model.normalizeTerm('  two  words  '), 'two  words', 'normalization preserves internal whitespace');
    assert.notEqual(model.termId('apple'), model.termId('apples'), 'normalization does not stem distinct vocabulary words');
    assert.equal(model.termId('apple'), model.termId('  APPLE  '));
    assert.notEqual(model.sourceId(SOURCE_A), model.sourceId(SOURCE_B));
    assert.notEqual(model.sourceId(SOURCE_A), model.sourceId({ kind: 'builtin', id: SOURCE_A.id }));
    assert.equal(model.articleId(SOURCE_A, ARTICLE.examId), articleId());
    assert.notEqual(articleId(SOURCE_A), articleId(SOURCE_B));
    assert.notEqual(model.articleId({ kind: 'imported', id: 'a:b' }, 'c'),
        model.articleId({ kind: 'imported', id: 'a' }, 'b:c'), 'delimiter-bearing IDs must not collide');

    const id = model.occurrenceId(articleId(), model.termId('apple'), occurrence());
    assert.equal(id, model.occurrenceId(articleId(), model.termId(' APPLE '), occurrence()));
    for (const selected of [
        occurrence({ scopeId: 'passage-2' }), occurrence({ contentVersion: 'sha256:revision-2' }),
        occurrence({ startOffset: 30, endOffset: 35 })
    ]) {
        assert.notEqual(id, model.occurrenceId(articleId(), model.termId('apple'), selected));
    }
    assert.notEqual(id, model.occurrenceId(articleId(SOURCE_B), model.termId('apple'), occurrence()));
});

test('same normalized term in two libraries has one owner and independent article collections', () => {
    const snapshot = twoArticles();
    assert.equal(snapshot.reading.terms.length, 1);
    assert.equal(snapshot.words.length, 1);
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot).occurrenceCount, 2);
    for (const source of [SOURCE_A, SOURCE_B]) {
        const result = query(snapshot, source);
        assert.equal(result.distinctTermCount, 1);
        assert.equal(result.occurrenceCount, 1);
        assert.equal(result.terms[0].associations[0].articleId, articleId(source));
        assert.equal(result.terms[0].occurrences[0].associationId, result.terms[0].associations[0].id);
        assert.deepEqual(plain(result.terms[0].wordRef), { listId: 'default', wordId: APPLE.id });
        assert.deepEqual(plain(result.terms[0].word), APPLE, 'collection preserves every existing vocabulary/review field');
    }
    assert.equal(snapshot.reading.sources.length, 2);
    assert.equal(snapshot.reading.articles.length, 2);
    assert.equal(model.listVisits(snapshot).length, 2);
    assert.deepEqual(plain(snapshot.words[0]), APPLE);
    assert.equal(snapshot.lists[model.READING_LIST_ID], undefined, 'linking an existing owner must not create a duplicate review row');
});

test('content references use source locator fields and ignore article presentation metadata', () => {
    const exam = {
        sourceKind: ' imported ', dataKey: ' data-key ', path: ' folder\\nested ',
        filename: ' section\\article.html ', importKey: ' import-id ', title: 'Original title'
    };
    assert.equal(model.contentRef(exam), JSON.stringify([
        'imported', 'data-key', 'folder/nested', 'section/article.html', 'import-id'
    ]));
    assert.equal(model.contentRef(exam), model.contentRef({ ...exam, title: 'Renamed', id: 'another-id' }));
    for (const field of ['sourceKind', 'dataKey', 'path', 'filename', 'importKey']) {
        assert.notEqual(model.contentRef(exam), model.contentRef({ ...exam, [field]: 'changed' }), field);
    }
    assert.equal(model.contentRef({}), JSON.stringify(['', '', '', '', '']));
});

test('visits and collections bind the first source reference while keeping legacy article identities', () => {
    const ref = model.contentRef({ sourceKind: 'imported', path: 'library', filename: 'article.html' });
    for (const operation of ['recordVisit', 'collect']) {
        const input = operation === 'collect'
            ? command({ article: { ...ARTICLE, contentRef: ref } })
            : { source: SOURCE_A, article: { ...ARTICLE, contentRef: ref }, at: AT };
        for (const legacy of [false, true]) {
            let snapshot = model.createSnapshot();
            if (legacy) snapshot = mutate('recordVisit', snapshot, { source: SOURCE_A, article: ARTICLE, at: AT });
            snapshot = mutate(operation, snapshot, input);
            assert.equal(snapshot.reading.articles[0].id, articleId());
            assert.deepEqual(plain(snapshot.reading.articles[0].contentRefs), [ref]);
            const once = plain(snapshot);
            snapshot = mutate(operation, snapshot, input);
            assert.deepEqual(plain(snapshot), once, 'binding retries must be idempotent');
            assert.deepEqual(plain(model.deserialize(model.serialize(snapshot))), once);
            snapshot = mutate('recordVisit', snapshot, { source: SOURCE_A, article: ARTICLE, at: LATER });
            snapshot = mutate('collect', snapshot, command());
            snapshot = mutate('clearArticle', snapshot, { articleId: articleId() });
            assert.deepEqual(plain(snapshot.reading.articles[0].contentRefs), [ref],
                'legacy commands and relationship deletion retain the content binding');
        }
    }
});

test('changed and ambiguous content bindings reject visits and collections without partial mutation', () => {
    const bound = mutate('collect', model.createSnapshot(), command({ article: { ...ARTICLE, contentRef: 'source-a' } }));
    for (const refs of [['source-a'], ['source-a', 'source-b']]) {
        const snapshot = plain(bound);
        snapshot.reading.articles[0].contentRefs = refs;
        const before = plain(snapshot);
        for (const operation of ['recordVisit', 'collect']) {
            const ref = refs.length === 1 ? 'source-b' : 'source-a';
            const input = operation === 'collect'
                ? command({ article: { ...ARTICLE, title: 'Changed', contentRef: ref }, at: LATER })
                : { source: SOURCE_A, article: { ...ARTICLE, title: 'Changed', contentRef: ref }, at: LATER };
            assert.throws(() => model[operation](deepFreeze(snapshot), deepFreeze(input)),
                /content reference has changed or is ambiguous/);
            assert.deepEqual(plain(snapshot), before, `${operation} preserves all existing data on conflict`);
        }
    }
});

test('article reference validation accepts legacy snapshots and rejects malformed bindings', () => {
    const legacy = mutate('recordVisit', model.createSnapshot(), { source: SOURCE_A, article: ARTICLE, at: AT });
    assert.equal(Object.hasOwn(legacy.reading.articles[0], 'contentRefs'), false);
    assert.deepEqual(plain(model.deserialize(model.serialize(legacy))), plain(legacy));
    for (const contentRefs of [null, 'source', [''], [' padded '], [1], ['same', 'same'], ['z', 'a']]) {
        const invalid = plain(legacy);
        invalid.reading.articles[0].contentRefs = contentRefs;
        assert.throws(() => model.validate(invalid));
        assert.throws(() => model.deserialize(JSON.stringify(invalid)));
    }
    const unbound = plain(legacy);
    unbound.reading.articles[0].contentRefs = [];
    const bound = mutate('recordVisit', unbound, {
        source: SOURCE_A, article: { ...ARTICLE, contentRef: 'source-a' }, at: AT
    });
    assert.deepEqual(plain(bound.reading.articles[0].contentRefs), ['source-a']);
    for (const contentRef of [undefined, null, '', ' ', ' padded ', 1, []]) {
        for (const operation of ['recordVisit', 'collect']) {
            const input = operation === 'collect' ? command({ article: { ...ARTICLE, contentRef } })
                : { source: SOURCE_A, article: { ...ARTICLE, contentRef }, at: AT };
            assert.throws(() => model[operation](deepFreeze(legacy), input));
        }
    }
});

test('backup merges union content bindings without choosing a newer conflicting source', () => {
    const withRef = (contentRef, at) => mutate('recordVisit', model.createSnapshot(), {
        source: SOURCE_A, article: { ...ARTICLE, contentRef }, at
    });
    const left = withRef('source-z', AT);
    const right = withRef('source-a', LATER);
    const legacy = mutate('recordVisit', model.createSnapshot(), { source: SOURCE_A, article: ARTICLE, at: LATER });
    for (const [existing, incoming] of [[left, right], [right, left]]) {
        const merged = mutate('merge', existing, incoming);
        assert.deepEqual(plain(merged.reading.articles[0].contentRefs), ['source-a', 'source-z']);
        assert.equal(merged.reading.articles.length, 1);
        assert.deepEqual(plain(mutate('merge', merged, incoming)), plain(merged));
        const restored = model.deserialize(model.serialize(merged));
        for (const ref of ['source-a', 'source-z']) {
            assert.throws(() => model.recordVisit(restored, {
                source: SOURCE_A, article: { ...ARTICLE, contentRef: ref }, at: LATER
            }), /ambiguous/);
        }
        assert.deepEqual(plain(mutate('merge', merged, legacy).reading.articles[0].contentRefs), ['source-a', 'source-z']);
    }
    for (const [existing, incoming] of [[left, legacy], [legacy, left], [left, left]]) {
        const merged = mutate('merge', existing, incoming);
        assert.deepEqual(plain(merged.reading.articles[0].contentRefs), ['source-z']);
    }
    assert.equal(Object.hasOwn(mutate('merge', legacy, legacy).reading.articles[0], 'contentRefs'), false);
});

test('repeated selection and repeated requests are idempotent while separate positions, scopes and revisions survive', () => {
    let snapshot = mutate('collect', model.createSnapshot(), command());
    const once = plain(snapshot);
    snapshot = mutate('collect', snapshot, command());
    assert.deepEqual(plain(snapshot), once, 'retrying the same collection command must be idempotent');
    snapshot = mutate('collect', snapshot, command({
        occurrence: occurrence({ before: 'Updated context: ', after: ' remains the same selection.' }), at: LATER
    }));
    assert.equal(query(snapshot).occurrenceCount, 1, 'context updates do not manufacture another occurrence');
    assert.equal(query(snapshot).terms[0].occurrences[0].before, 'Updated context: ');
    for (const selected of [
        occurrence({ startOffset: 30, endOffset: 35 }),
        occurrence({ scopeId: 'question-1' }),
        occurrence({ contentVersion: 'sha256:revision-2' })
    ]) {
        snapshot = mutate('collect', snapshot, command({ occurrence: selected }));
    }
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot).occurrenceCount, 4);
    assert.equal(snapshot.reading.associations.length, 1);
    assert.equal(snapshot.lists[model.READING_LIST_ID].words.length, 1);
});

test('occurrence deletion is local and final occurrence removes only an occurrence-only association', () => {
    let snapshot = twoArticles();
    snapshot = mutate('collect', snapshot, command({ occurrence: occurrence({ startOffset: 30, endOffset: 35 }) }));
    const first = query(snapshot, SOURCE_A).terms[0].occurrences[0];
    snapshot = mutate('removeOccurrence', snapshot, { occurrenceId: first.id });
    assert.equal(query(snapshot, SOURCE_A).distinctTermCount, 1);
    assert.equal(query(snapshot, SOURCE_A).occurrenceCount, 1);
    assert.equal(query(snapshot, SOURCE_B).occurrenceCount, 1);
    const final = query(snapshot, SOURCE_A).terms[0].occurrences[0];
    snapshot = mutate('removeOccurrence', snapshot, { occurrenceId: final.id });
    assert.equal(query(snapshot, SOURCE_A).distinctTermCount, 0);
    assert.equal(query(snapshot, SOURCE_B).distinctTermCount, 1);
    assert.deepEqual(plain(snapshot.words[0]), APPLE);
    assert.equal(model.listVisits(snapshot).length, 2);
});

test('manual additions need no anchor and survive final occurrence deletion until explicitly removed', () => {
    let snapshot = mutate('recordVisit', model.createSnapshot(), { source: SOURCE_A, article: ARTICLE, at: AT });
    snapshot = mutate('collect', snapshot, command({ occurrence: undefined }));
    snapshot = mutate('collect', snapshot, command({ occurrence: undefined, manual: true }));
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot).occurrenceCount, 0);
    assert.equal(snapshot.reading.occurrences.length, 0, 'manual additions must never invent a passage anchor');
    assert.equal(snapshot.reading.associations[0].manual, true);
    snapshot = mutate('collect', snapshot, command());
    snapshot = mutate('removeOccurrence', snapshot, { occurrenceId: query(snapshot).terms[0].occurrences[0].id });
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot).occurrenceCount, 0);
    snapshot = mutate('removeArticleTerm', snapshot, { articleId: articleId(), termId: model.termId('apple') });
    assert.equal(query(snapshot).distinctTermCount, 0);
    assert.equal(snapshot.lists[model.READING_LIST_ID].words.length, 1, 'article removal preserves the review owner');
    assert.equal(model.listVisits(snapshot).length, 1);
});

test('manual promotion of a selected term retains the association after removing its final occurrence', () => {
    let snapshot = mutate('collect', model.createSnapshot(), command());
    snapshot = mutate('collect', snapshot, command({ manual: true, occurrence: undefined }));
    snapshot = mutate('removeOccurrence', snapshot, { occurrenceId: query(snapshot).terms[0].occurrences[0].id });
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot).terms[0].associations[0].manual, true);
});

test('explicit article-term removal preserves other terms in that article and the same term in another article', () => {
    let snapshot = twoArticles();
    snapshot = mutate('collect', snapshot, command({ occurrence: occurrence({ startOffset: 30, endOffset: 35 }) }));
    snapshot = mutate('collect', snapshot, command({
        word: { word: 'pear', meaning: 'Another fruit' }, occurrence: undefined
    }));
    const removal = { articleId: articleId(), termId: model.termId('apple') };
    snapshot = mutate('removeArticleTerm', snapshot, removal);
    assert.equal(query(snapshot, SOURCE_A).distinctTermCount, 1);
    assert.equal(query(snapshot, SOURCE_A).terms[0].word.word, 'pear');
    assert.equal(query(snapshot, SOURCE_A).occurrenceCount, 0);
    assert.equal(query(snapshot, SOURCE_B).distinctTermCount, 1);
    assert.equal(query(snapshot, SOURCE_B).occurrenceCount, 1);
    assert.equal(query(snapshot).distinctTermCount, 2);
    assert.equal(model.listVisits(snapshot).length, 2);
    const once = plain(snapshot);
    snapshot = mutate('removeArticleTerm', snapshot, removal);
    assert.deepEqual(plain(snapshot), once, 'retrying an article-term removal is idempotent');
});

test('clearing an article preserves both visits, the other library and canonical review history', () => {
    let snapshot = twoArticles();
    const visits = plain(model.listVisits(snapshot));
    const otherArticle = plain(query(snapshot, SOURCE_B));
    snapshot = mutate('clearArticle', snapshot, { articleId: articleId(SOURCE_A) });
    assert.equal(query(snapshot, SOURCE_A).distinctTermCount, 0);
    assert.equal(query(snapshot, SOURCE_A).occurrenceCount, 0);
    assert.deepEqual(plain(query(snapshot, SOURCE_B)), otherArticle);
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.deepEqual(plain(model.listVisits(snapshot)), visits);
    assert.deepEqual(plain(snapshot.words), [APPLE]);
    snapshot = mutate('clearArticle', snapshot, { articleId: articleId(SOURCE_B) });
    assert.equal(query(snapshot).distinctTermCount, 0, 'global reader count includes active associations only');
    assert.equal(snapshot.reading.terms.length, 1, 'the canonical link remains available for recollection');
    assert.deepEqual(plain(snapshot.words), [APPLE]);
    assert.deepEqual(plain(model.listVisits(snapshot)), visits);
    snapshot = mutate('collect', snapshot, command({ occurrence: undefined, word: { word: 'APPLE' } }));
    assert.deepEqual(plain(query(snapshot).terms[0].word), APPLE);
});

test('visiting an article is independent of collecting vocabulary and repeated visits remain one bookshelf record', () => {
    let snapshot = model.createSnapshot();
    const visit = { source: SOURCE_A, article: ARTICLE, at: AT };
    snapshot = mutate('recordVisit', snapshot, visit);
    const once = plain(snapshot);
    snapshot = mutate('recordVisit', snapshot, visit);
    assert.deepEqual(plain(snapshot), once);
    snapshot = mutate('recordVisit', snapshot, { ...visit, at: LATER });
    snapshot = mutate('recordVisit', snapshot, { ...visit, at: '2026-09-07T01:00:00.000Z' });
    const firstVisit = model.listVisits(snapshot)[0];
    assert.equal(firstVisit.firstVisitedAt, '2026-09-07T01:00:00.000Z');
    assert.equal(firstVisit.lastVisitedAt, LATER, 'older visit retries must not move the latest visit backwards');
    snapshot = mutate('recordVisit', snapshot, { ...visit, source: SOURCE_B });
    assert.equal(model.listVisits(snapshot).length, 2);
    assert.equal(query(snapshot).distinctTermCount, 0);
    assert.equal(snapshot.reading.terms.length, 0);
    assert.equal(snapshot.words.length, 0);
    assert.deepEqual(plain(snapshot.lists), {});
    assert.equal(new Set(model.listVisits(snapshot).map((entry) => entry.articleId)).size, 2);
    snapshot = mutate('clearArticle', snapshot, { articleId: articleId() });
    assert.equal(model.listVisits(snapshot).length, 2);
});

test('a delayed first title survives a later title-less visit in either event order', () => {
    const events = [
        ['recordVisit', { source: SOURCE_A, article: { examId: ARTICLE.examId }, at: LATER }],
        ['collect', command()]
    ];
    const snapshots = [events, [...events].reverse()].map((ordered) => {
        let snapshot = model.createSnapshot();
        for (const [operation, input] of ordered) snapshot = mutate(operation, snapshot, input);
        const article = snapshot.reading.articles[0];
        assert.equal(article.title, ARTICLE.title);
        assert.equal(article.titleUpdatedAt, AT);
        assert.equal(article.createdAt, AT);
        assert.equal(article.updatedAt, LATER);
        assert.equal(model.listVisits(snapshot)[0].lastVisitedAt, LATER);
        return plain(snapshot);
    });
    assert.deepEqual(snapshots[0], snapshots[1], 'reordering title-less activity preserves the same article metadata');
});

test('title-less activity preserves an unknown title until an explicit title arrives', () => {
    let snapshot = mutate('recordVisit', model.createSnapshot(), {
        source: SOURCE_A, article: { examId: ARTICLE.examId }, at: AT
    });
    assert.equal(snapshot.reading.articles[0].title, '');
    assert.equal(snapshot.reading.articles[0].titleUpdatedAt, null);
    snapshot = mutate('collect', snapshot, command({ article: { examId: ARTICLE.examId }, at: LATER }));
    assert.equal(snapshot.reading.articles[0].titleUpdatedAt, null, 'collecting without a title must not create a title clock');
    assert.equal(snapshot.reading.articles[0].updatedAt, LATER);
    snapshot = mutate('recordVisit', snapshot, { source: SOURCE_A, article: ARTICLE, at: AT });
    assert.equal(snapshot.reading.articles[0].title, ARTICLE.title);
    assert.equal(snapshot.reading.articles[0].titleUpdatedAt, AT);
    assert.equal(snapshot.reading.articles[0].updatedAt, LATER);
});

test('a delayed rename uses its title clock after unrelated visits and rejects older titles', () => {
    const renamedAt = '2026-09-08T01:30:00.000Z';
    const rename = command({ article: { ...ARTICLE, title: 'Renamed article' }, at: renamedAt });
    const visit = { source: SOURCE_A, article: { examId: ARTICLE.examId }, at: LATER };
    for (const events of [
        [['recordVisit', visit], ['collect', rename]],
        [['collect', rename], ['recordVisit', visit]]
    ]) {
        let snapshot = mutate('collect', model.createSnapshot(), command());
        for (const [operation, input] of events) snapshot = mutate(operation, snapshot, input);
        assert.equal(snapshot.reading.articles[0].title, 'Renamed article');
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, renamedAt);
        assert.equal(snapshot.reading.articles[0].updatedAt, LATER);
        for (const operation of ['recordVisit', 'collect']) {
            const input = operation === 'collect' ? command() : { source: SOURCE_A, article: ARTICLE, at: AT };
            snapshot = mutate(operation, snapshot, input);
            assert.equal(snapshot.reading.articles[0].title, 'Renamed article', `${operation} must not restore an older title`);
            assert.equal(snapshot.reading.articles[0].titleUpdatedAt, renamedAt);
            assert.equal(snapshot.reading.articles[0].updatedAt, LATER);
        }
    }
});

test('an explicit empty title is a dated update and equal title timestamps use the last processed value', () => {
    for (const operation of ['recordVisit', 'collect']) {
        const input = (title, at) => operation === 'collect'
            ? command({ article: { ...ARTICLE, title }, at })
            : { source: SOURCE_A, article: { ...ARTICLE, title }, at };
        let snapshot = mutate(operation, model.createSnapshot(), input('', LATER));
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, LATER, 'an initially empty explicit title is known');
        snapshot = mutate(operation, snapshot, input(ARTICLE.title, AT));
        assert.equal(snapshot.reading.articles[0].title, '', 'older nonempty titles must not overwrite an explicit empty title');
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, LATER);
        snapshot = mutate(operation, snapshot, input('Same-time title', LATER));
        assert.equal(snapshot.reading.articles[0].title, 'Same-time title');
        snapshot = mutate(operation, snapshot, input('', LATER));
        assert.equal(snapshot.reading.articles[0].title, '', 'an existing title can be explicitly cleared at the same timestamp');
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, LATER);
    }
});

test('serialization preserves title provenance for delayed metadata replay', () => {
    const renamedAt = '2026-09-08T01:30:00.000Z';
    for (const initiallyKnown of [false, true]) {
        let snapshot = model.createSnapshot();
        if (initiallyKnown) snapshot = mutate('collect', snapshot, command());
        snapshot = mutate('recordVisit', snapshot, {
            source: SOURCE_A, article: { examId: ARTICLE.examId }, at: LATER
        });
        snapshot = model.deserialize(model.serialize(snapshot));
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, initiallyKnown ? AT : null);
        snapshot = mutate('collect', snapshot, command({
            article: { ...ARTICLE, title: 'Restored article title' }, at: renamedAt
        }));
        assert.equal(snapshot.reading.articles[0].title, 'Restored article title');
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, renamedAt);
        assert.equal(snapshot.reading.articles[0].updatedAt, LATER);
        snapshot = model.deserialize(model.serialize(snapshot));
        snapshot = mutate('collect', snapshot, command());
        assert.equal(snapshot.reading.articles[0].title, 'Restored article title', 'restoration must retain protection from stale titles');
        assert.equal(snapshot.reading.articles[0].titleUpdatedAt, renamedAt);
    }
});

test('validation and serialization reject missing, malformed or inconsistent title clocks', () => {
    let valid = mutate('collect', model.createSnapshot(), command());
    valid = mutate('recordVisit', valid, { source: SOURCE_A, article: { examId: ARTICLE.examId }, at: LATER });
    const corruptions = [
        ['missing clock', (article) => { delete article.titleUpdatedAt; }],
        ['nonempty title with unknown clock', (article) => { article.titleUpdatedAt = null; }],
        ['invalid timestamp', (article) => { article.titleUpdatedAt = 'invalid-date'; }],
        ['noncanonical timestamp', (article) => { article.titleUpdatedAt = '2026-09-08T01:00:00Z'; }],
        ['non-string timestamp', (article) => { article.titleUpdatedAt = Date.parse(AT); }],
        ['clock before article creation', (article) => { article.titleUpdatedAt = '2026-09-08T00:59:59.999Z'; }],
        ['clock after article update', (article) => { article.titleUpdatedAt = '2026-09-08T02:00:00.001Z'; }]
    ];
    for (const [label, corrupt] of corruptions) {
        const invalid = plain(valid);
        corrupt(invalid.reading.articles[0]);
        assert.throws(() => model.validate(invalid), `validate must reject ${label}`);
        assert.throws(() => model.deserialize(JSON.stringify(invalid)), `deserialize must reject ${label}`);
        assert.throws(() => model.serialize(invalid), `serialize must reject ${label}`);
    }
});

test('existing named-list owners and explicit owner selection retain their own IDs and review progress', () => {
    const customApple = { ...APPLE, id: 'custom-apple', meaning: 'My custom definition', interval: 45 };
    const lists = { custom: { id: 'custom', name: 'Personal words', words: [customApple] } };
    let snapshot = mutate('collect', model.createSnapshot({ lists }), command({ word: { word: 'APPLE' } }));
    assert.deepEqual(plain(query(snapshot).terms[0].wordRef), { listId: 'custom', wordId: customApple.id });
    assert.deepEqual(plain(snapshot.lists), lists);
    assert.equal(snapshot.words.length, 0);

    snapshot = mutate('collect', model.createSnapshot({ words: [APPLE], lists }), command({
        wordRef: { listId: 'custom', wordId: customApple.id }
    }));
    snapshot = mutate('collect', snapshot, command({ source: SOURCE_B }));
    assert.deepEqual(plain(query(snapshot).terms[0].wordRef), { listId: 'custom', wordId: customApple.id },
        'subsequent collection must keep the already selected review owner');
    assert.deepEqual(plain(snapshot.words), [APPLE]);
    assert.deepEqual(plain(snapshot.lists), lists);
});

test('legacy array-shaped lists remain valid canonical owners through serialization and explicit deletion', () => {
    const legacy = [{ ...APPLE, id: 'legacy-owner' }];
    let snapshot = mutate('collect', model.createSnapshot({ lists: { custom: legacy } }), command());
    assert.deepEqual(plain(query(snapshot).terms[0].wordRef), { listId: 'custom', wordId: 'legacy-owner' });
    assert.deepEqual(plain(snapshot.lists.custom), legacy);
    snapshot = model.deserialize(model.serialize(snapshot));
    snapshot = mutate('deleteCanonicalTerm', snapshot, { termId: model.termId('apple') });
    assert.deepEqual(plain(snapshot.lists.custom), []);
    assert.equal(query(snapshot).distinctTermCount, 0);
});

test('backup merge preserves independent same-term vocabulary memberships and the incoming explicit reader owner', () => {
    const customApple = { ...APPLE, meaning: 'Personal definition', repetitions: 2,
        reviewHistory: [{ at: AT, grade: 2 }] };
    const spellingApple = { ...APPLE, id: 'spelling-apple', word: 'APPLE', repetitions: 4,
        reviewHistory: [{ at: AT, grade: 3 }] };
    const anotherCustomApple = { ...APPLE, id: 'another-custom-apple', note: 'Independent record in the same list' };
    const incoming = mutate('collect', model.createSnapshot({
        words: [APPLE],
        lists: {
            custom: [customApple, anotherCustomApple],
            'spelling-errors': { id: 'spelling-errors', name: 'Spelling errors', words: [spellingApple] }
        }
    }), command({ wordRef: { listId: 'spelling-errors', wordId: spellingApple.id } }));
    const merged = mutate('merge', model.createSnapshot(), incoming);
    assert.deepEqual(plain(merged.words), [APPLE]);
    assert.deepEqual(plain(merged.lists), plain(incoming.lists));
    assert.deepEqual(plain(query(merged).terms[0].wordRef), { listId: 'spelling-errors', wordId: spellingApple.id });
    assert.deepEqual(plain(query(merged).terms[0].word.reviewHistory), spellingApple.reviewHistory);
    assert.deepEqual(plain(mutate('merge', merged, incoming)), plain(merged), 'repeated merge retains every record exactly once');
});

test('backup merge keeps local per-list progress and reader ownership while importing other same-term records', () => {
    const localCustom = { ...APPLE, id: 'custom-apple', meaning: 'Local custom definition', repetitions: 12,
        reviewHistory: [{ at: LATER, grade: 5 }] };
    const existing = mutate('collect', model.createSnapshot({
        words: [APPLE], lists: { custom: { id: 'custom', name: 'Local list', words: [localCustom] } }
    }), command({ wordRef: { listId: 'custom', wordId: localCustom.id } }));
    const importedDefault = { ...APPLE, repetitions: 0, reviewHistory: [] };
    const importedCustom = { ...localCustom, repetitions: 0, reviewHistory: [] };
    const importedSpelling = { ...APPLE, id: 'spelling-apple', repetitions: 3,
        reviewHistory: [{ at: AT, grade: 1 }] };
    const incoming = mutate('collect', model.createSnapshot({
        words: [importedDefault], lists: {
            custom: { id: 'custom', words: [importedCustom] },
            'spelling-errors': { id: 'spelling-errors', words: [importedSpelling] }
        }
    }), command({ source: SOURCE_B }));
    const merged = mutate('merge', existing, incoming);
    assert.deepEqual(plain(merged.words), [APPLE]);
    assert.deepEqual(plain(merged.lists.custom), plain(existing.lists.custom));
    assert.deepEqual(plain(merged.lists['spelling-errors'].words), [importedSpelling]);
    assert.deepEqual(plain(query(merged).terms[0].wordRef), { listId: 'custom', wordId: localCustom.id });
    assert.equal(merged.reading.terms.length, 1);
    assert.equal(merged.reading.associations.length, 2);
    assert.deepEqual(plain(mutate('merge', merged, incoming)), plain(merged));
});

test('backup merge remaps list-scoped ID collisions and reuses the same imported owner after review and retry', () => {
    const collisionId = 'shared-record-id';
    const existing = model.createSnapshot({ lists: { custom: [{ ...APPLE, id: collisionId }] } });
    const incomingPear = { ...APPLE, id: collisionId, word: 'pear', meaning: 'Another fruit' };
    const incoming = mutate('collect', model.createSnapshot({ lists: { custom: [incomingPear] } }), command({
        word: { word: 'pear' }, occurrence: undefined, wordRef: { listId: 'custom', wordId: collisionId }
    }));
    const merged = mutate('merge', existing, incoming);
    assert.equal(merged.lists.custom.length, 2);
    assert.deepEqual(plain(merged.lists.custom[0]), plain(existing.lists.custom[0]));
    const importedRef = query(merged).terms[0].wordRef;
    assert.equal(importedRef.listId, 'custom');
    assert.notEqual(importedRef.wordId, collisionId);
    assert.equal(query(merged).terms[0].word.word, 'pear');
    const reviewed = plain(merged);
    reviewed.lists.custom[1].repetitions = 10;
    reviewed.lists.custom[1].reviewHistory.push({ at: LATER, grade: 5 });
    assert.deepEqual(plain(mutate('merge', reviewed, incoming)), reviewed,
        'retry must resolve the original collision to the existing renamed record without replacing progress');
});

test('explicit global deletion cascades all reader relationships and same-term vocabulary rows, preserving other terms and visits', () => {
    const pear = { id: 'pear', word: 'pear', meaning: 'Another fruit', interval: 12 };
    let snapshot = twoArticles({
        words: [APPLE, pear],
        lists: {
            custom: { id: 'custom', name: 'Personal', words: [{ ...APPLE, id: 'custom-apple', word: 'APPLE' }, pear] },
            'reading-highlights': { id: 'reading-highlights', words: [{ ...APPLE, id: 'reader-apple' }] }
        }
    });
    snapshot = mutate('collect', snapshot, command({ word: { word: 'pear' }, occurrence: undefined }));
    const visits = plain(model.listVisits(snapshot));
    snapshot = mutate('deleteCanonicalTerm', snapshot, { termId: model.termId('apple') });
    assert.equal(query(snapshot).distinctTermCount, 1);
    assert.equal(query(snapshot, SOURCE_A).terms[0].word.word, 'pear');
    assert.equal(query(snapshot, SOURCE_B).distinctTermCount, 0);
    assert.equal(snapshot.reading.occurrences.length, 0);
    assert.deepEqual(plain(snapshot.words), [pear]);
    assert.deepEqual(plain(snapshot.lists.custom.words), [pear]);
    assert.equal(snapshot.lists['reading-highlights'].words.length, 0);
    assert.deepEqual(plain(model.listVisits(snapshot)), visits);
    assert.equal(snapshot.reading.terms.some((term) => term.id === model.termId('apple')), false);
});

test('global vocabulary deletion also handles terms never collected by the reader and rejects malformed identities', () => {
    const pear = { id: 'pear', word: 'pear', meaning: 'Another fruit' };
    let snapshot = model.createSnapshot({ words: [APPLE, pear], lists: { custom: [{ ...APPLE, id: 'custom-apple' }] } });
    assert.equal(snapshot.reading.terms.length, 0);
    snapshot = mutate('deleteCanonicalTerm', snapshot, { termId: model.termId('apple') });
    assert.deepEqual(plain(snapshot.words), [pear]);
    assert.deepEqual(plain(snapshot.lists.custom), []);
    const once = plain(snapshot);
    snapshot = mutate('deleteCanonicalTerm', snapshot, { termId: model.termId('apple') });
    assert.deepEqual(plain(snapshot), once, 'repeated canonical deletion is idempotent');
    for (const invalid of ['apple', '["term","APPLE"]', '["article","apple"]', '["term","apple","extra"]']) {
        assert.throws(() => model.deleteCanonicalTerm(deepFreeze(snapshot), { termId: invalid }));
    }
});

test('serialization preserves source-scoped identities and supports selective deletion after restore', () => {
    const original = twoArticles();
    const serialized = model.serialize(deepFreeze(original));
    assert.equal(typeof serialized, 'string');
    const restored = model.deserialize(serialized);
    assert.deepEqual(plain(restored), plain(original));
    assert.equal(restored.reading.schemaVersion, model.SCHEMA_VERSION);
    assert.notEqual(restored, original);
    assert.equal(query(restored, SOURCE_A).distinctTermCount, 1);
    assert.equal(query(restored, SOURCE_B).distinctTermCount, 1);
    const cleared = mutate('clearArticle', restored, { articleId: articleId(SOURCE_A) });
    assert.equal(query(cleared, SOURCE_A).distinctTermCount, 0);
    assert.equal(query(cleared, SOURCE_B).distinctTermCount, 1);
    assert.deepEqual(plain(model.deserialize(model.serialize(cleared))), plain(cleared));
});

test('validation and deserialization reject incompatible versions, duplicate identities and dangling relationships', () => {
    const valid = twoArticles();
    const corruptions = [
        ['schema version', (value) => { value.reading.schemaVersion = 999; }],
        ['source normalization', (value) => { value.reading.sources[0].libraryId += ' '; }],
        ['article normalization', (value) => { value.reading.articles[0].examId += ' '; }],
        ['canonical owner', (value) => { value.reading.terms[0].wordRef.wordId = 'missing-word'; }],
        ['article source', (value) => { value.reading.articles[0].sourceId = 'missing-source'; }],
        ['association term', (value) => { value.reading.associations[0].termId = 'missing-term'; }],
        ['association article', (value) => { value.reading.associations[0].articleId = 'missing-article'; }],
        ['occurrence association', (value) => { value.reading.occurrences[0].associationId = 'missing-association'; }],
        ['occurrence scope normalization', (value) => { value.reading.occurrences[0].scopeId += ' '; }],
        ['occurrence revision normalization', (value) => { value.reading.occurrences[0].contentVersion += ' '; }],
        ['visit article', (value) => { value.reading.visits[0].articleId = 'missing-article'; }],
        ['duplicate term', (value) => { value.reading.terms.push(plain(value.reading.terms[0])); }],
        ['duplicate occurrence', (value) => { value.reading.occurrences.push(plain(value.reading.occurrences[0])); }]
    ];
    for (const [label, corrupt] of corruptions) {
        const invalid = plain(valid);
        corrupt(invalid);
        assert.throws(() => model.validate(invalid), `validate must reject ${label}`);
        assert.throws(() => model.deserialize(JSON.stringify(invalid)), `deserialize must reject ${label}`);
        assert.throws(() => model.serialize(invalid), `serialize must reject ${label}`);
    }
    assert.throws(() => model.deserialize('{invalid-json'));
});

test('invalid collection inputs fail without altering vocabulary or creating partial relationships', () => {
    const snapshot = deepFreeze(model.createSnapshot());
    const before = plain(snapshot);
    const invalidCommands = [
        command({ source: { kind: 'imported', id: '' } }),
        command({ source: { kind: 'unknown', id: 'library' } }),
        command({ article: { examId: '' } }),
        command({ word: { word: ' ' } }),
        command({ word: { word: 'unknown' } }),
        command({ at: 'invalid-date' }),
        command({ occurrence: occurrence({ scopeId: '' }) }),
        command({ occurrence: occurrence({ contentVersion: '' }) }),
        command({ occurrence: occurrence({ startOffset: -1 }) }),
        command({ occurrence: occurrence({ startOffset: 1.5 }) }),
        command({ occurrence: occurrence({ endOffset: 10 }) }),
        command({ occurrence: occurrence({ endOffset: 20 }) }),
        command({ occurrence: occurrence({ quote: 'pears' }) }),
        command({ manual: false, occurrence: undefined }),
        command({ wordRef: null }),
        command({ wordRef: { listId: 'default', wordId: 'missing' } })
    ];
    for (const input of invalidCommands) {
        assert.throws(() => model.collect(snapshot, deepFreeze(input)));
        assert.deepEqual(plain(snapshot), before);
    }
});

test('new collection rejects a malformed existing reading list without replacing its data', () => {
    const snapshot = deepFreeze(model.createSnapshot({
        lists: { 'reading-highlights': { id: 'reading-highlights', words: { preserved: 'invalid legacy data' } } }
    }));
    const before = plain(snapshot);
    assert.throws(() => model.collect(snapshot, command()));
    assert.deepEqual(plain(snapshot), before);
});

test('JSON metadata cannot become inherited canonical word properties during collection', () => {
    const word = JSON.parse('{"word":"apple","meaning":"A fruit","__proto__":{"phonetic":"injected"}}');
    const snapshot = mutate('collect', model.createSnapshot(), command({ word, occurrence: undefined }));
    const owner = snapshot.lists[model.READING_LIST_ID].words[0];
    assert.equal(owner.phonetic, undefined);
    assert.equal(Object.getPrototypeOf(owner).phonetic, undefined);
    assert.equal(Object.hasOwn(owner, '__proto__'), true, 'JSON metadata remains an ordinary own property');
    assert.deepEqual(plain(model.deserialize(model.serialize(snapshot))), plain(snapshot));
});

test('snapshot construction and query results do not expose mutable aliases to canonical data', () => {
    const seed = { words: [plain(APPLE)], lists: {} };
    let snapshot = model.createSnapshot(seed);
    seed.words[0].reviewHistory[0].grade = 0;
    assert.deepEqual(plain(snapshot.words[0]), APPLE);
    snapshot = mutate('recordVisit', snapshot, { source: SOURCE_A, article: ARTICLE, at: AT });
    snapshot = mutate('collect', snapshot, command());
    const result = query(snapshot);
    result.terms[0].word.meaning = 'Changed projection';
    result.terms[0].word.reviewHistory[0].grade = 0;
    result.terms[0].associations.length = 0;
    result.terms[0].occurrences[0].quote = 'Changed quote';
    const visits = model.listVisits(snapshot);
    visits.length = 0;
    assert.deepEqual(plain(query(snapshot).terms[0].word), APPLE);
    assert.equal(query(snapshot).terms[0].associations.length, 1);
    assert.equal(query(snapshot).terms[0].occurrences[0].quote, 'apple');
    assert.equal(model.listVisits(snapshot).length, 1);
});

test('new canonical terms load and review through the production VocabStore reading list', async () => {
    let snapshot = mutate('collect', model.createSnapshot({ words: [APPLE] }), command({
        word: { word: 'orchard', meaning: 'A place where fruit trees grow', phonetic: 'ɔːtʃəd' },
        occurrence: undefined
    }));
    const owner = plain(query(snapshot).terms[0].wordRef);
    assert.equal(owner.listId, model.READING_LIST_ID);
    const config = { activeListId: 'default' };
    // Storage seam only: all normalization, list projection and review access below
    // run through the existing VocabStore implementation.
    const vocab = {
        async getConfig() { return plain(config); },
        async listWords() { return plain(snapshot.words); },
        async listCollections() { return plain(snapshot.lists); },
        async activateList(listId) { config.activeListId = listId; return { committed: true }; },
        async patchWord({ listId, wordId, patch }) {
            const words = listId === 'default' ? snapshot.words : snapshot.lists[listId].words;
            const index = words.findIndex((word) => word.id === wordId);
            assert.notEqual(index, -1, 'VocabStore must address the canonical owner ID');
            words[index] = { ...words[index], ...plain(patch) };
            return { committed: true, word: plain(words[index]) };
        }
    };
    const quietConsole = { log() {}, warn() {}, error() {} };
    const window = {
        console: quietConsole, Date, Math, JSON, setTimeout, clearTimeout,
        location: { protocol: 'file:' }, __EMBEDDED_WORDLISTS__: { ielts_core: [] },
        AppData: { ready: Promise.resolve(), vocab }
    };
    const context = { window, console: quietConsole, Date, Math, JSON, setTimeout, clearTimeout };
    context.globalThis = window;
    vm.runInNewContext(fs.readFileSync(storeUrl, 'utf8'), context, { filename: storeUrl.pathname });
    const store = window.VocabStore;
    await store.init();
    const list = await store.loadList(owner.listId);
    assert.equal(list.words.length, 1);
    assert.equal(list.words[0].id, owner.wordId);
    assert.equal(list.words[0].meaning, 'A place where fruit trees grow');
    assert.equal(await store.setActiveList(list), true);
    assert.equal(store.getNewWords()[0].id, owner.wordId);
    const review = {
        easeFactor: 2.4, interval: 7, repetitions: 1, correctCount: 1,
        lastReviewed: AT, nextReview: '2026-09-15T01:00:00.000Z'
    };
    const updated = await store.updateWord(owner.wordId, review);
    assert.equal(updated.repetitions, 1);
    assert.equal(store.getDueWords(new Date('2026-09-16T01:00:00.000Z'))[0].id, owner.wordId);
    assert.equal(query(snapshot).terms[0].word.nextReview, review.nextReview,
        'reader queries resolve live canonical review progress, not a copied history');
    snapshot = mutate('clearArticle', snapshot, { articleId: articleId() });
    snapshot = mutate('collect', snapshot, command({ source: SOURCE_B, word: { word: ' ORCHARD ' }, occurrence: undefined }));
    assert.equal(query(snapshot).terms[0].word.repetitions, 1);
    assert.equal(query(snapshot).terms[0].word.nextReview, review.nextReview);
    assert.equal(snapshot.lists[owner.listId].words.length, 1);
});
