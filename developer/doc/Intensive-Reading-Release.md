# Intensive Reading v1: TXT and release qualification

This is the release contract for [#160](https://github.com/sallowayma-git/IELTS-practice/issues/160).
It combines the [vocabulary model](Intensive-Reading-Vocabulary-Contract.md),
[persistence](Intensive-Reading-Persistence.md),
[selection anchors](Intensive-Reading-Anchors.md), and
[entrypoints](Intensive-Reading-Entrypoints.md) contracts. The release PR targets
current `opensource`, references parent [#149](https://github.com/sallowayma-git/IELTS-practice/issues/149),
and closes #160 only when its prerequisites and the combined gate pass. Parent
#149 remains open until its full v1 acceptance is accepted.

## TXT contract

Exports contain UTF-8 plain text, one term per line, with LF separators, no BOM,
header, rich fields, or trailing newline. Each line uses the associated existing
canonical vocabulary record's display term. All whitespace runs in that display
term, including embedded CR/LF and Unicode line separators, become one space;
leading and trailing whitespace is removed. A multiline term cannot inject
another TXT entry. Export does not rewrite canonical vocabulary or review data.

Current-article export selects associations for the original source and article
identity. The explicitly labeled all-intensive-reading export selects the
distinct union of every article association. It includes manual additions and
selected occurrences, deduplicates by canonical term identity, and is independent
of Bookshelf filters. Unrelated review vocabulary and terms without remaining
reading associations are excluded. Missing-source articles retain downloadable
vocabulary.

Order is ascending by the model's `normalizedTerm`, using JavaScript UTF-16 code
unit comparison rather than locale collation. Canonical identity normalization
is defined in the model contract; export's whitespace formatting does not change
that identity. Clearing A preserves shared terms associated with B and changes
the A/global exports accordingly. Export uses acknowledged AppData state after
migration, concurrent changes, backup merge/replace, and reload. Empty results
produce no download or success acknowledgement; the UI explains that there are
no intensive-reading terms to export.

The tested format is plain UTF-8 TXT. No named third-party importer compatibility
is claimed. Such a claim requires a separately recorded actual import with the
application/version, field mapping, fixture, and observed result. Rich-field Anki
TSV, AI analysis, and cross-device synchronization are outside this v1 gate.

## Required checks

Run from the repository root. CI uses Node.js 22 and Python 3, with dependencies
installed from `developer/package-lock.json` and Python Playwright 1.56.0. Install
the Chromium revisions required by both Playwright packages. HTTPS fixtures also
require OpenSSL; Windows tests can use Git for Windows' bundled executable or
`OPENSSL_EXECUTABLE_PATH`. `PLAYWRIGHT_EXECUTABLE_PATH` can select a browser; record
its actual version in the evidence.

```sh
npm ci --prefix developer
python -m pip install playwright==1.56.0
python -m playwright install chromium
node developer/node_modules/playwright/cli.js install chromium --only-shell

node scripts/build-bundles.mjs
node scripts/build-bundles.mjs --check
npm test --prefix developer
python -m unittest discover -s developer/tests/py -p "test_*.py"
python developer/tests/ci/check_reading_data_integrity.py
python developer/tests/e2e/e2e_runner.py
```

The checked-in CI workflow is authoritative for required jobs. The older static
aggregator can additionally be run with
`python developer/tests/ci/run_static_suite.py`; it does not replace the formal
`npm test --prefix developer` entry point or the current CI checks.

After committing source and regenerated bundles, qualify that clean revision:

```sh
python developer/tests/ci/qualify_reading_release.py
```

The qualifier records `baseSha`, the actually tested revision in `headSha`, and
the reviewed PR revision in `reviewedHeadSha`, plus worktree cleanliness,
commands, runtime versions, archive SHA-256, and a manifest matching every
extracted file to the corresponding source bytes. Every packaged runtime file
must be tracked by Git; ignored or untracked local assets cannot qualify an exact
Git revision. Set `READING_RELEASE_BASE_SHA` to the reviewed base SHA when it
differs from the merge base with `origin/opensource`, and set
`READING_RELEASE_REVIEWED_HEAD_SHA` when the tested revision is a CI merge commit
rather than the reviewed PR head. It invokes
the platform release script, extracts into a fresh temporary directory, and runs
`reading_txt_release.node.js` against that extracted root. Browser reports and
logs are retained under `developer/tests/e2e/reports/reading-release-package/`.
A changed source or bundle revision requires another qualification run.

## Package contract

Windows uses `powershell -NoProfile -File developer/release.ps1 <version>`;
Linux/macOS use `bash developer/release.sh <version>`. Both rebuild and check all
14 generated bundles before packaging. Windows uses .NET ZIP support; the shell
builder requires `zip` and `zipinfo`. A repeated version replaces only its own
archive, retaining other versions and existing qualification evidence in `dist`.

The ZIP contains `index.html`, CSS (including `vocab-reader.css`), `js/bundles`,
runtime `assets` (including generated reading content/media, explanations,
dictionaries, images, and the Three.js vendor file), and local `ReadingPractice`
content when present. Developer files and test reports are not inputs. Runtime
JavaScript source directories, Python/Markdown development files, Python bytecode
(`*.pyc`) and `__pycache__` directories, temporary office files, and video files
are excluded. Locally packaged `ReadingPractice` content is optional; untracked
local content must be absent for the exact-revision qualifier. The default redistributable omits
local listening libraries; `INCLUDE_LOCAL_LISTENING=1` requires their generated
manifest and compatibility index before including available P1–P4 sources.

Users extract the ZIP and open `index.html`, or serve the same extracted tree
over local HTTP or static HTTPS. Node.js and development dependencies are only
required by the build/test process, not by the extracted application. The
package browser flow must traverse Browse → reader → select/manual add → close
and reopen → cold Bookshelf entry → TXT download with fresh browser storage.

## Evidence matrix

The following maps requirements to executable checks; it is not a pass record.
Publish observed outcomes in the PR after the fixed revision has been tested,
using the generated JSON/logs. Include the full reviewed base and head SHA,
browser/version, operating system, run mode, command, fixture names, result, and
remaining limitations. If CI tests a synthetic merge revision, record that SHA
separately from the reviewed PR head. Keeping exact run evidence in the PR and
reports avoids changing the tested commit merely to record its own SHA.

| Requirement | Command or suite | Fixture/evidence to record |
| --- | --- | --- |
| F1: practice answer and session isolation | `node developer/tests/e2e/reading_reader_isolation.node.js` (also unified E2E) | `p2-low-08`; radio/text/checkbox/select answers; question selection; repeated open/close; annotation, timer, recovery and score state in file/HTTP Chromium pages. |
| F2: canonical A/B membership and review integration | Formal npm suite: `readingVocabularyModel`, `readingVocabularyTxtExport`, `bookshelfRemoveVocabIsolation`, persistence/backup suites | Shared canonical term, different source libraries with the same exam ID, repeated occurrences, manual membership, clear A/preserve B, retained review progress. |
| F3: actual durable concurrency and failure acknowledgement | `npm run test:reading-persistence --prefix developer` (also formal npm suite) | Real Chromium IndexedDB; two stale readers; competing additions/deletions; replacement generation fences; quota/abort rollback; one-time migration; stale backup merge; empty replace, lazy initialization and reload. |
| F4: complete content and exact DOM restoration | `node developer/tests/e2e/reading_reader_occurrences.node.js` (also unified E2E) | Existing `bodyHtml` and repeated-label articles, ordered blocks/headings, exact split-inline Range, mouse/touch/keyboard paths, remove/undo, missing/changed/ambiguous anchors. |
| F5: reset failure protection and baseline data | Formal npm suite: `siteDataReset`, `externalBackupServiceV2`, annotation/vocabulary/recovery/timer/score regression files | Missing backup service fails closed; locking and write failures; canonical review data and established practice behavior. |
| F6: cold Bookshelf entry and formal working directory | `npm test --prefix developer`; `node developer/tests/e2e/reading_bookshelf_entrypoints.node.js` (also unified E2E) | Fresh More → Bookshelf without Browse preload; reader entry/return, complete search/counts, missing-source export, file/HTTP/local static HTTPS. |
| TXT and full source flow | `node developer/tests/e2e/reading_txt_release.node.js` (also unified E2E) | Actual downloaded UTF-8 bytes, article A/B/global scope, filters, migration, merge, empty replace, reload, missing source and empty download behavior in all three modes. |
| Fresh extracted runtime | `python developer/tests/ci/qualify_reading_release.py` | Exact archive and asset hashes; source-byte equality; clean integrated SHA; the release/TXT browser flow against extracted assets only in all three modes. |
| Full repository regression | Bundle check, formal npm suite, Python unit/data-integrity checks, unified E2E, package qualification | Final exit codes and counts plus required CI result at the recorded revision; preserve logs for any failed attempt and its corrected rerun. |

The static HTTPS fixture uses an ephemeral local certificate and isolated
Chromium contexts that ignore certificate validation. It verifies real TLS URL
and browser behavior, but does not establish a public host deployment or trusted
certificate configuration. Some existing DOM regression fixtures permit file
access to fixture HTML; the release flow must separately prove built-in generated
content and normal downloads from `file://` without relying on external source
access. Imported plain HTML remains subject to the browser's file restrictions;
an unavailable source must keep its vocabulary and show recoverable source state.
Do not generalize a recorded Chromium run to untested browser engines or devices.
