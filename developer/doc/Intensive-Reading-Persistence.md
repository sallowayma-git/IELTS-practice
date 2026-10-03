# Intensive Reading Persistence

This is the acknowledged persistence contract for [#156](https://github.com/sallowayma-git/IELTS-practice/issues/156).
The [vocabulary model contract](Intensive-Reading-Vocabulary-Contract.md) defines
the canonical owners, source identities, relationships and selected occurrences.
Parent [#149](https://github.com/sallowayma-git/IELTS-practice/issues/149) remains
the combined feature acceptance gate.

## Authority and operations

`AppData.vocab.getReadingSnapshot()` resolves to
`{snapshot: {words, lists, reading}, revision, generation}`.
Use that snapshot for queries and retain its revision and generation with the
user's intent. A snapshot is not a writable cache.

```js
const observed = await AppData.vocab.getReadingSnapshot();
const receipt = await AppData.vocab.mutateReading('collect', {
    source: { kind: 'builtin', id: 'default' },
    article: { examId: 'p1-example', title: 'An example article' },
    word: { word: 'apple', meaning: 'A fruit' },
    occurrence: {
        scopeId: 'passage:1/paragraph:2', contentVersion: 'revision-1',
        startOffset: 10, endOffset: 15, quote: 'apple',
        before: 'An ', after: ' grows here.'
    }
}, {
    observedRevision: observed.revision,
    observedGeneration: observed.generation
});
if (receipt.saved === true) {
    // The transaction is acknowledged; update the visible collection.
}
```

`mutateReading(type, command, options)` returns the kernel receipt plus
`{saved: true, snapshot, revision, generation, added, changed}`. It rejects on
validation, stale deletion/replace conflicts, quota errors and failed
transactions. `added` identifies a collect operation; it does not mean a new
distinct term was created. Stable term and occurrence IDs prevent duplicates.
An optional `operationId` can identify a retry of exactly the same command.

| Operation | Command and effect |
| --- | --- |
| `collect` | Model collection command; commits the canonical owner, relationship, optional occurrence and article visit together. Omit occurrence for manual membership. |
| `recordVisit` | `{source, article}`; visits an article even when it has zero words. |
| `removeOccurrence` | `{occurrenceId}`; applies the model's final-occurrence/manual-membership rules. |
| `removeArticleTerm` | `{articleId, termId}`; removes that article's membership and occurrences. |
| `clearArticle` | `{articleId}`; preserves the visit, canonical words, review progress and other articles. |
| `removeTermAssociations` | `{termId}`; removes reading membership across articles, preserving canonical vocabulary. |
| `clearReading` | `{}`; clears reading memberships and occurrences, preserving vocabulary and visits. |
| `removeArticle` | `{articleId, clearWords}`; removes the visit and, only when `clearWords: true`, the article's vocabulary. |
| `deleteCanonicalTerm` | `{termId}`; explicit global canonical deletion, including matching owners and all reading links. |

Every operation reads fresh IndexedDB state and checks revisions of
`vocab.words`, `vocab.lists`, `vocab.readingState` and the two legacy projection
documents in one kernel transaction. A write conflict reruns the transformation
against fresh state. Readers bracket their reads with the reading-state revision
to avoid exposing owners from a different committed state.

The old `saveReadingWords` and `saveReadingBookshelfExams` array APIs are
compatibility entry points only. They require `expectedRevision` from the
corresponding `list…({withMeta: true})` result; a stale array is rejected rather
than retried with a newer revision. Production reading and bookshelf consumers
use operation commands.

## Conflict and deletion precedence

`vocab.readingState` is a version 1 persistence envelope containing the model's
`reading` document, `generation`, `clockAt`, the default-vocabulary seed policy,
and deletion markers. The marker domains are `articles`, `visits`, `terms`,
`canonicalTerms`, `associations`, `occurrences`, and the global `all` membership
marker. Each marker stores `{at, revision}`.

Independent additions commute through fresh-state retry. A deletion wins against
an addition or visit that observed an older relevant deletion revision. Replacing
or importing reading data invalidates older generations. The rejected action
does not commit; reload the snapshot before a new, deliberate retry.

The operation clock advances beyond all stored activity and deletion clocks and
is at least the supplied timestamp at the write boundary. A fresh recollection therefore sorts after an earlier
deletion even if its caller's timestamp is old. Backup conflicts compare these
timestamps, with deletion winning a tie. Visit deletion has its own marker:
clearing vocabulary cannot delete a zero-word visit during a later merge.
Global vocabulary deletion has a separate marker from reading-only removal.
Portable deletion revisions are rebased to the receiving document's revision;
revision numbers from separate databases are not comparable.

## Migration and recovery

On first startup, AppData recognizes the prototype reading word/bookshelf arrays
in their existing documents or the two `ielts_reading_*_v1` localStorage keys.
Existing durable documents take precedence, including intentional empty arrays.
Legacy source descriptors are retained; entries without a source use
`{kind: 'builtin', id: 'default'}`. Legacy memberships are retained as manual
because the prototype did not distinguish their origin. Valid exact anchors also
become occurrences; removing their final occurrence retains that recovered manual membership.

Migration commits the model, canonical owners, projection documents and
`system.migrations.readingVocabularyV1` together. The marker is version 1 and
contains `completed`, `completedAt` and `recoverable`: original localStorage
bytes, original legacy documents, and rejected entries with reasons.
Unrecognized payloads are retained instead of discarded. These recovery records
remain local system data; they are not part of the portable vocabulary backup.
An interrupted transaction leaves no completed marker or partial model and can
be retried after the backend is available.

After the marker commits, startup, lazy-loaded components and backup export do
not import localStorage again. Full/vocabulary export and destructive recovery
require successful initial migration. An unrelated settings-only import/export
does not depend on reading migration.

## Backup and visible state

Native backup merge unions sources, articles, terms, manual memberships, selected
occurrences and zero-word visits by stable identities. Existing canonical owners
and their definitions/review progress take precedence. Conflicting incoming word
IDs are remapped without replacing an unrelated existing owner. Article titles
retain their separate title clock. Deletion markers filter both inputs before
union and the result afterward, so old backups cannot revive removed records or
undo a fresh recollection. Reimporting the same backup is idempotent.

Replace installs the requested state authoritatively, including empty data, and
changes the generation. Lazy vocabulary initialization cannot seed default words
over an authoritative empty replacement. The established AppData commit channel
invalidates reading, bookshelf and canonical vocabulary caches in other pages.
Import retains the existing preview revision and safety-backup protections.

UI consumers show success only after acknowledgement. Pending selection marks
are removed on failure; manual text and deletion controls remain available for
retry. Quota/conflict failures support retry in the same page. A latched
`BACKEND_UNAVAILABLE` failure requires refreshing the page before retry, as in
the existing DataKernel contract.

The reader resolves built-in generated content and source-scoped imported
content through the [entrypoint contract](Intensive-Reading-Entrypoints.md).
Original content references are persisted through the same acknowledged reading
operations. Missing, changed, or ambiguous source references leave vocabulary
reviewable/exportable and cannot silently resolve through the active library.

## Validation

`npm test --prefix developer` includes production model/AppData regressions,
real IndexedDB transaction faults, and two real Playwright pages sharing storage.
`npm run test:reading-persistence --prefix developer` runs the focused persistence
and backup suites. UI tests exercise pending, acknowledged, failed and retried
actions separately. Rebuild generated bundles with
`node scripts/build-bundles.mjs` and verify with `--check`.
