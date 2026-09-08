# Intensive Reading Vocabulary Contract

This document records the schema and relationship semantics implemented for
[#155](https://github.com/sallowayma-git/IELTS-practice/issues/155), part of
[#149](https://github.com/sallowayma-git/IELTS-practice/issues/149).

The production model is exposed as `ReadingVocabularyModel` and through
`AppData.vocab.readingModel`. Its operations are synchronous, pure transformations
of a snapshot containing the existing vocabulary records and the reading
relationships. They return a new snapshot and do not mutate the input. A returned
snapshot is not a durable save acknowledgement.

Implementation: [`js/data/v2/readingVocabularyModel.js`](../../js/data/v2/readingVocabularyModel.js).
Behavior tests: [`readingVocabularyModel.test.js`](../tests/js/readingVocabularyModel.test.js).

## Schema version 1

`SCHEMA_VERSION` is `1`. The complete contract snapshot is:

```json
{
  "words": [],
  "lists": {},
  "reading": {
    "schemaVersion": 1,
    "sources": [],
    "articles": [],
    "terms": [],
    "associations": [],
    "occurrences": [],
    "visits": []
  }
}
```

This is valid input to `deserialize`. `words` is the existing `vocab.words`
array; `lists` is the existing `vocab.lists` object. A list value may be an array
of word records or an object whose `words` property is that array. Existing word
and list metadata are preserved. `reading` has these tables:

| Table | Record fields | Responsibility |
| --- | --- | --- |
| `sources` | `id`, `kind`, `libraryId` | Stable built-in or imported library namespace. |
| `articles` | `id`, `sourceId`, `examId`, `title`, `titleUpdatedAt`, `createdAt`, `updatedAt` | Source-scoped article identity and display metadata, with a separate title update clock. |
| `terms` | `id`, `normalizedTerm`, `wordRef: {listId, wordId}`, `createdAt` | One normalized reading term linked to a live existing vocabulary record. |
| `associations` | `id`, `articleId`, `termId`, `manual`, `createdAt`, `updatedAt` | One article-term relationship, with independent manual membership. |
| `occurrences` | `id`, `associationId`, `scopeId`, `contentVersion`, `startOffset`, `endOffset`, `quote`, `before`, `after`, `createdAt`, `updatedAt` | A specifically selected occurrence belonging to one association. |
| `visits` | `id`, `articleId`, `firstVisitedAt`, `lastVisitedAt` | Bookshelf presence independent of collected terms; `id` equals `articleId`. |

Every table has unique record IDs. The validator rejects unsupported or missing
versions, missing tables, duplicate identities, mismatched derived IDs, dangling
relationships, unresolved canonical word references, invalid timestamps, and
occurrence-only associations without an occurrence. Snapshots must contain
JSON-serializable values. Mutations preserve their inputs and return detached
snapshots; queries also return detached copies. Returned objects are not frozen.

`articles.titleUpdatedAt` is required: `null` means that no command has supplied
a title, in which case `title` must be `""`. Otherwise it is a canonical UTC ISO
timestamp within the inclusive `createdAt` to `updatedAt` range. An explicitly
supplied empty title has a timestamp and is distinct from an omitted title.
Serialization preserves this field and validation rejects a missing or invalid
title clock.

## Identity and normalization

Identity helpers return opaque strings formed by `JSON.stringify` on tuples.
Use the helpers instead of concatenating IDs or parsing their contents:

| Helper | Identity tuple |
| --- | --- |
| `sourceId(source)` | `["source", source.kind, source.id.trim()]` |
| `articleId(source, examId)` | `["article", sourceId(source), examId.trim()]` |
| `termId(word)` | `["term", normalizeTerm(word)]` |
| Internal association identity | `["association", articleId, termId]` |
| `occurrenceId(articleId, termId, occurrence)` | `["occurrence", articleId, termId, scopeId, contentVersion, startOffset, endOffset]` |

`source` must explicitly contain `{kind: "builtin" | "imported", id: string}`.
The source ID must be nonempty and stable across reload and backup restoration.
For an imported library, pass the persisted configuration `id` assigned by
`AppData.library.import`; do not derive it from a display name, active-library
position, content path, or `examId`. Keep that ID when restoring the same
library. A separate imported library must have a separate ID.

The built-in library currently has a null configuration ID in the library UI.
A consumer must map it to the application namespace
`{kind: "builtin", id: "default"}`. The model does not infer this mapping.
Built-in and imported sources with the same textual ID remain distinct because
`kind` participates in identity. Identical `examId` values in two imported
libraries also remain distinct through query, deletion, and serialization.
Titles can change without changing identity. Source and article identifiers are
case-sensitive after trimming. Mutation inputs are trimmed; serialized
`libraryId`, `examId`, `scopeId`, and `contentVersion` fields must already be
canonical, with no surrounding whitespace.

`normalizeTerm(word)` requires a nonempty string and uses
`word.trim().toLowerCase()`, matching existing vocabulary deduplication. Thus
`" apple "` and `"APPLE"` share one reading term. It does not stem words, remove
punctuation, collapse internal whitespace, or apply Unicode normalization.
Case, surrounding whitespace, and display spelling do not replace the existing
canonical vocabulary record's contents.

An occurrence requires:

```json
{
  "scopeId": "passage:1/paragraph:2",
  "contentVersion": "revision-1",
  "startOffset": 12,
  "endOffset": 17,
  "quote": "apple",
  "before": "I picked an ",
  "after": " from the tree."
}
```

`scopeId` and `contentVersion` must be nonempty stable strings; both participate
in identity. The scope must distinguish passage/question sections and their
paragraphs, including repeated displayed paragraph labels. Offsets are safe
integer UTF-16 code-unit positions, with a nonnegative start and an exclusive
end greater than the start. `endOffset - startOffset` must equal `quote.length`,
and the quote's normalized term must equal the collected term. `before` and
`after` are optional strings defaulting to `""`.

The content producer owns scope assignment and revision generation. The model
does not inspect source text or resolve DOM anchors. A changed content revision
has a different occurrence identity even when offsets are unchanged. Repeating
the same article, term, scope, revision, and offsets upserts one occurrence;
quote/context are data, not identity. Restoration must later establish a safe
match before highlighting; this contract alone does not establish one.

## Canonical vocabulary and review ownership

`wordRef` is a live reference to exactly one word ID in one existing list.
For a term's first collection, an explicit `wordRef` can select the owner.
Otherwise the model searches `vocab.words` (`listId: "default"`) first and then
collection IDs in sorted order, selecting the first matching normalized term.
The chosen record must have a nonempty ID that resolves exactly once within
its list; a match without a valid ID is rejected rather than duplicated.
When supplied, `wordRef` must be an object with nonempty, unpadded `listId` and
`wordId`. After a term is bound, a different explicit owner is rejected.

Collecting an existing term preserves the owner's complete record, including
definition, phonetic data, review schedule, counters, and history. It does not
copy a review history into `reading.terms`, reset progress, or overwrite the
definition with the collection request. Queries resolve the current owner from
the supplied snapshot, so later review changes are visible without rewriting
reading relationships. Legacy duplicate records in other lists are not merged
or removed by collection.

If no existing owner matches, `collect` requires a nonempty `word.meaning` and
creates a standard word record in `lists["reading-highlights"]`, the established
reading vocabulary list. Its ID is `word.id` when supplied, otherwise
`JSON.stringify(["reading-word", normalizedTerm])`. An ID collision in that list
is rejected, as is an existing target collection with an invalid shape. The new
record uses `source: "reading-highlight"`,
`easeFactor: null`, `interval: 1`, `repetitions: 0`, `intraCycles: 0`,
`correctCount: 0`, `lastReviewed: null`, and `nextReview: null`; missing
`example` and `note` default to `""`. Collection time sets its creation and update
timestamps. Persisting this snapshot through the future acknowledged operation
API will make the record available to the existing vocabulary list/review path.

## Public operation signatures

All mutation methods return a complete new snapshot or throw an error with
`code: "VALIDATION"`. They perform no I/O. Even an absent-target deletion returns
a detached snapshot. `at` is supplied by the caller and must use canonical UTC
ISO format with milliseconds, such as `"2026-09-08T09:00:00.000Z"`.

| Method | Input and behavior |
| --- | --- |
| `createSnapshot({words?, lists?, reading?} = {})` | Clone and validate supplied state; default missing vocabulary containers and a missing reading document to the empty version 1 structure. An explicitly supplied reading document must already be valid. |
| `validate(snapshot)` | Return `true` or throw; does not repair, migrate, or silently drop records. |
| `collect(snapshot, {source, article: {examId, title?}, word: {word, meaning?, id?, ...}, wordRef?, occurrence?, manual?, at})` | Upsert source, article, canonical link, association, and optional occurrence. Without an occurrence, `manual` defaults to `true`; with one it defaults to `false`. `manual: false` without an occurrence is invalid. |
| `recordVisit(snapshot, {source, article: {examId, title?}, at})` | Upsert the source/article and one visit row. Retain the earliest first visit and latest last visit; retries do not create extra rows or increment a counter. |
| `removeOccurrence(snapshot, {occurrenceId})` | Remove that occurrence; remove its association only when it has no remaining occurrences and `manual` is false. |
| `removeArticleTerm(snapshot, {articleId, termId})` | Explicitly remove one association, including manual membership, and all occurrences owned by that association. |
| `clearArticle(snapshot, {articleId})` | Remove every association and occurrence for only that source-scoped article. |
| `deleteCanonicalTerm(snapshot, {termId})` | Explicit global removal of a normalized term, its associations/occurrences, and matching vocabulary records across the default list and all collections, whether or not previously collected in the reader. |
| `query(snapshot, {articleId?} = {})` | Return `{terms, distinctTermCount, occurrenceCount}` globally or for one article; only currently associated terms are included. |
| `listVisits(snapshot)` | Return a detached array of visit records, including zero-word articles. |
| `serialize(snapshot)` | Validate and return a JSON string of the complete `{words, lists, reading}` snapshot. |
| `deserialize(jsonString)` | Parse, strictly validate, and return a detached snapshot; missing versions/tables are rejected rather than filled in. |

Each entry of `query(...).terms` is
`{term, word, wordRef, associations, occurrences}`. An article-filtered query
includes only that article's associations and occurrences; the global query
combines associations for each distinct term. Queries for an unknown article
return zero counts. Results retain table order and do not promise a display sort.

Repeated collection never inflates distinct-term counts or duplicates an
occurrence identity. A manual request promotes the association's `manual` flag
to `true`; later occurrence-only collection cannot unset it. An older collection
request cannot move article, association, or occurrence update times backward or
overwrite newer article titles/occurrence context. Both `collect` and
`recordVisit` compare title-bearing commands against `titleUpdatedAt`, independently
of article activity in `updatedAt`. A command without `article.title` leaves the
title and its clock unchanged, so a delayed collection can supply the first title
or a rename after a later title-less visit. An explicit `title: ""` updates the
title clock and prevents an older title from being restored. Equal title update
timestamps retain the last processed title. Article `createdAt` and `updatedAt`
still retain the earliest and latest activity respectively. This timestamp
behavior is local upsert semantics, not a concurrent-write or deletion-conflict
policy.

`collect` does not implicitly record a visit. Record article opening with
`recordVisit`, independently of whether a word is collected. The persistence
layer may compose these transformations before its atomic write where required.

## Counts and deletion semantics

The global reading count is the number of distinct terms with at least one
active association, not the number of canonical vocabulary records or selected
occurrences. The article count is the number of distinct terms associated with
that article. If A and B each collect `apple`, the counts are A = 1, B = 1,
global = 1; two different selections in A still count as one term in A.

An association exists because it has at least one occurrence, because it is
manual, or both. Manual addition without an occurrence stores no anchor and
must not imply highlighting every matching string in an article.

| Action | Association/occurrence result | Preserved state |
| --- | --- | --- |
| Remove one occurrence | Only that occurrence disappears. Its association disappears only if it is occurrence-only and now empty. | Other occurrences, other articles, canonical words/reviews, source/article records, and visits. |
| Remove an article term | The selected association and all its occurrences disappear, including manual membership. | Other articles, canonical words/reviews, source/article records, and visits. |
| Clear article A | All A associations/occurrences disappear. B remains independent. | Canonical words/reviews, term-owner links, all source/article records, and both A/B visits. |
| Explicit global canonical deletion | The term link, if present, and every related association/occurrence disappear. Every vocabulary record with the same normalized term is removed across lists, including legacy duplicates. | Other normalized terms, list metadata, source/article records, and all visits. |

Ordinary reader removal retains canonical term-owner links even after their last
association disappears; `query` excludes those inactive links. Recollecting can
reuse the same owner and review progress. A global deletion is deliberately
broader and removes those vocabulary records and their progress. It must be
used only for the explicit global vocabulary action, not article clearing or
occurrence undo. This operation also removes matching vocabulary records when
the term was never collected in the reader. Generate its `termId` with the
helper: malformed or non-normalized identity tuples are rejected. A valid ID
with no matching records is a no-op.

Other vocabulary deletion paths must eventually apply the relationship cleanup
in the same persistence boundary. Supplying a snapshot with an already-deleted
owner is rejected as a dangling reference; this model does not silently repair
it. Source removal or missing source content is not canonical-word deletion.

## Executable serialization and relationship example

Run this JavaScript with Node from the repository root, or replace the first two
lines with the application's model and an assertion function in a browser. It
produces a complete, populated version 1 JSON snapshot containing two libraries
with the same `examId`, then proves the round trip and deletion behavior against
the production implementation.

```js
const assert = require('node:assert/strict');
const model = require('./js/data/v2/readingVocabularyModel.js');
const at = '2026-09-08T09:00:00.000Z';
const sourceA = { kind: 'imported', id: 'library-alpha' };
const sourceB = { kind: 'imported', id: 'library-beta' };
const article = { examId: 'shared-exam', title: 'An apple a day' };
const articleA = model.articleId(sourceA, article.examId);
const articleB = model.articleId(sourceB, article.examId);
const apple = model.termId('apple');
const existingWord = {
  id: 'apple-existing', word: 'apple', meaning: 'Existing definition',
  repetitions: 4, interval: 12, correctCount: 4,
  lastReviewed: '2026-09-07T09:00:00.000Z',
  nextReview: '2026-09-19T09:00:00.000Z'
};
let state = model.createSnapshot({ words: [existingWord] });
for (const source of [sourceA, sourceB]) {
  state = model.recordVisit(state, { source, article, at });
}
const occurrence = {
  scopeId: 'passage:1/paragraph:1', contentVersion: 'revision-1',
  startOffset: 0, endOffset: 5, quote: 'apple', after: ' a day'
};
const collectA = {
  source: sourceA, article, word: { word: 'apple' }, occurrence, at
};
state = model.collect(state, collectA);
state = model.collect(state, collectA); // The same selection is idempotent.
state = model.collect(state, {
  source: sourceB, article, word: { word: 'APPLE', meaning: 'Ignored replacement' },
  occurrence: { ...occurrence, quote: 'APPLE' }, at
});
assert.notEqual(articleA, articleB);
assert.equal(state.reading.terms.length, 1);
assert.equal(model.query(state).distinctTermCount, 1);
assert.equal(model.query(state).occurrenceCount, 2);
assert.equal(model.query(state, { articleId: articleA }).distinctTermCount, 1);
assert.equal(model.query(state, { articleId: articleB }).distinctTermCount, 1);
assert.deepEqual(state.words[0], existingWord);

const json = model.serialize(state);
console.log(json); // The complete populated serialization example.
state = model.deserialize(json);
assert.equal(model.serialize(state), json);

state = model.clearArticle(state, { articleId: articleA });
assert.equal(model.query(state, { articleId: articleA }).distinctTermCount, 0);
assert.equal(model.query(state, { articleId: articleB }).distinctTermCount, 1);
assert.equal(model.query(state).distinctTermCount, 1);
assert.equal(model.listVisits(state).length, 2);
assert.deepEqual(state.words[0], existingWord);

// Manual membership survives removal of the last selected occurrence.
state = model.collect(state, {
  source: sourceB, article, word: { word: 'apple' }, manual: true, at
});
const selected = model.query(state, { articleId: articleB }).terms[0].occurrences[0];
state = model.removeOccurrence(state, { occurrenceId: selected.id });
assert.equal(model.query(state, { articleId: articleB }).distinctTermCount, 1);
assert.equal(model.query(state).occurrenceCount, 0);
state = model.removeArticleTerm(state, { articleId: articleB, termId: apple });
assert.equal(model.query(state).distinctTermCount, 0);
assert.deepEqual(state.words[0], existingWord);

state = model.deleteCanonicalTerm(state, { termId: apple });
assert.equal(state.words.length, 0);
assert.equal(state.reading.terms.length, 0);
assert.equal(model.listVisits(state).length, 2);
```

The serializer is a contract transport format, not the application's backup
format or a migration routine. Backup merge must resolve identities and
conflicts through the persistence implementation; concatenating serialized
tables would violate uniqueness. An empty version 1 snapshot is valid and must
remain distinguishable from missing data when authoritative replace is added.

## Delivery boundary

- #155 defines canonical identity, article and occurrence identity, relationship
  mutations, counts, and serialization. Existing vocabulary records remain the
  owners of definitions and review progress.
- [#156](https://github.com/sallowayma-git/IELTS-practice/issues/156) owns
  authoritative AppData/IndexedDB writes, transactions or revision retries,
  conflict and deletion precedence, durable acknowledgement, migration, backup
  merge/replace, cache invalidation, and cross-window notifications.
- [#158](https://github.com/sallowayma-git/IELTS-practice/issues/158) owns content
  normalization, stable DOM scope identities, selection capture, occurrence
  restoration, removal/undo controls, and unresolved-anchor presentation.
- [#159](https://github.com/sallowayma-git/IELTS-practice/issues/159) owns reader
  entrypoints, Bookshelf integration, filtering, and refreshed UI counts.

This change does not switch reader or Bookshelf mutations to the new model or
introduce a storage key. Consumers must not persist a stale whole snapshot or
treat the synchronous model result as successful storage. The persistence work
must apply the user's operation to current authoritative state and commit all
affected vocabulary and reading records consistently.
