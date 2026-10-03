# Intensive Reading Entrypoints and Bookshelf

This documents [#159](https://github.com/sallowayma-git/IELTS-practice/issues/159),
part of [#149](https://github.com/sallowayma-git/IELTS-practice/issues/149).
The implementation integrates the acknowledged vocabulary model, isolated reader,
and selected-occurrence contracts delivered by #156–#158.

## Entry and navigation

Browse cards preserve the library configuration and imported content reference
that produced the card, including the fallback card renderers. The launcher
loads `exam-data` and `browse-runtime` through `AppLazyLoader` and passes the
captured identity and initiating control to `ReadingVocabReader.open`.

More and Overview use the shared Bookshelf entry. Bookshelf reader and global
notebook controls load the required groups on their first use; no Browse visit
is required. Loading failures expose retry controls. Newer article requests and
navigation intents supersede pending lazy opens. Closing a reader returns focus
to its initiating control, or the replacement Bookshelf button after a live
render. Bookshelf returns to the view from which it was opened.

The practice header/floating vocabulary interface and results entry use the
same reader with the practice session's source identity. Selection, manual add,
removal, clearing, and export consume the shared vocabulary APIs. Reader use
does not start or submit a practice session.

## Shelf projections and updates

An acknowledged visit makes an article visible even with no vocabulary.
Clearing article A removes only A's relationships and occurrences; A's visit,
article B's collection, and canonical review records remain intact. Explicitly
removing an article from the shelf is a separate action.

Each article counts distinct associated term IDs; the global count counts
distinct intensive-reading terms across all articles. Search examines every
associated word, title, category, source name, and source ID. Six chips are only
a visual preview. AppData commits, backup merge/replace, and cross-window
notifications refresh the projection and source metadata. No localStorage
mirror is a second persistence authority.

## Source availability

Imported articles resolve through the original configuration's index, never
the currently active index. An explicit `generated-reading` entry with a
`dataKey` can reference generated content. Other imports use their original
HTML path or a current file-picker Blob identified by `importKey`.

The reader validates the article identity, saved title, and captured/persisted
content reference before opening. Changed references, conflicting backup
references, duplicate article IDs, ambiguous cross-library file-picker keys,
missing configurations/files, expired Blob sessions, and unsupported HTML
produce an explicit unavailable state. Stored vocabulary remains reviewable
and exportable. Existing backups without a content binding remain valid and
bind on the next acknowledged visit. Source text changes at the same locator
continue to use the independent unresolved-anchor behavior from #158.

Imported passage and question fragments are parsed and sanitized in inert
templates before content normalization. Retained image/resource URLs resolve
against the fetched article URL. Supported passage containers include
`#passage`, `#reading-passage`, `.reading-passage`, `#left`, and `.passage`.
Missing or unrecognized structure is reported rather than substituted with
another article sharing the same `examId`.

## Acceptance matrix and release boundary

Run `python developer/tests/e2e/reading_bookshelf_entrypoints.py` or the equivalent
Node script. It is also registered in `e2e_runner.py`. The runner writes its
browser version, named outcomes, and protocol evidence to
`developer/tests/e2e/reports/reading-bookshelf-entrypoints-report.json`.

| Run mode | Entry and storage coverage | Imported content |
| --- | --- | --- |
| `file://` | First Browse/practice entry, cold zero-word shelf, counts/search, backup and cross-window changes | Actual file-picker session Blobs, without permissive local-file browser flags |
| Local static HTTP | Same production entry and storage flow | Original static HTML paths |
| Local static HTTPS | Same production entry and storage flow | Original static HTML paths |

The HTTPS test serves actual TLS URLs using a temporary localhost certificate;
certificate validation is disabled only in the isolated test contexts. The
runner requires OpenSSL (or `OPENSSL_EXECUTABLE_PATH`). Plain static HTML reads
from `file://` remain subject to normal browser file-access restrictions; missing
access produces the recoverable unavailable state. Built-in generated content
and current file-picker Blobs do not require those browser flags.

The PR records the exact reviewed base/head and final test results. Unit and
regression validation uses `npm test --prefix developer`, bundle validation uses
`node scripts/build-bundles.mjs --check`, and the unified E2E runner exercises
the existing practice, reader, backup, and navigation flows. Actual deployment,
fresh release-package qualification, TXT format/import compatibility, and the
combined v1 release gate remain in #160; #149 stays open.
