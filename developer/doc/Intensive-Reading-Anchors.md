# Intensive reading content and selected occurrences

Issue #158 extends the shared vocabulary and acknowledged persistence contracts
from #155–#157. It does not close the aggregate Intensive Reading v1 gate in #149.

## Content and identities

`ReadingVocabContent.normalizePassage` uses the practice renderer's ordered
`passage.blocks` contract and `bodyHtml || html` precedence. It preserves every
prose block, short paragraph, list, table, figure, heading and subtitle. Introductory
instructions and subtitles appear together above the passage. Reader questions
retain their `leadHtml`, body, instructions and displayed numbering through the
existing inert, non-answering conversion.

Internal paragraph IDs (`p-1`, `p-2`, …), question section IDs (`q-1`, `q-2`, …)
and nested text scopes are independent of displayed paragraph letters. An ordinary
sentence starting with “A” is not a structural label. Each source DOM ID is
namespaced before insertion. Paragraph tabs and translation containers use the
internal ID; a translation label is used only when it identifies one card.

Examples of persisted scopes are `passage/p-1`, `passage/p-1/p-2`, and
`questions/q-1/p-3`. The surrounding article association supplies the existing
library/source and article identity. The current payload loader still exposes
built-in content only; unavailable imported sources preserve vocabulary and show
the recoverable source error rather than displaying built-in content as imported.

## Selection and restoration

Mouse `mouseup`, touch `touchend`, and keyboard Shift release finish a selection.
Shift plus arrow keys may extend the selection without saving intermediate letters.
Keyboard-focusable text scopes support arrow-key caret movement and Shift selection
without enabling a browser-wide caret mode. Navigation stays within one scope. A selection must
contain English letters, span at most 45 UTF-16 code units after trimming boundary
whitespace/punctuation, stay in one text scope and logical block, and contain no
line break. Controls, answer blanks, hidden content, translation cards, paragraph
tags, existing vocabulary marks and practice `.hl` annotations are ineligible.
Manual addition remains available without an occurrence anchor.

`ReadingVocabAnchors` maps actual DOM Range boundaries, including element endpoints
and inline formatting, to exact UTF-16 offsets. It stores the exact quote and up to
48 characters on each side; the resulting context always includes the selected
text, even near the end of a long paragraph. Existing painted text contributes to
the same offset map. Multiple inline fragments share one occurrence ID without
splitting or rewriting the source's formatting.

New `contentVersion` values combine a fingerprint of the complete payload, the
scope text fingerprint, and an original-context uniqueness marker:

```
reader-scope-v2:<source fingerprint>:<text fingerprint>|context-unique
reader-scope-v2:<source fingerprint>:<text fingerprint>|context-scoped
```

The unchanged source and scope require an exact quote at the stored offsets.
After a source change, restoration requires a context that was unique when saved
and remains a unique complete quote/before/after match in the same passage or
question area. Missing or duplicated original scope IDs are unresolved. A context
that was duplicated when captured cannot migrate after source changes: deleting
one identical paragraph must not attach its highlight to the surviving paragraph.
No ordinal, nearest-score, case-insensitive, or first-match fallback is used.
Old anchors lacking a compatible scope or sufficient evidence remain recoverable
in the vocabulary list instead of guessing a new location.

Unresolved occurrences preserve the canonical term, article association and saved
anchor. The reader shows a status with a reload action, and the vocabulary list
shows the saved context and a per-occurrence removal action. Restoring the original
source makes its valid anchors visible again. A learner can remove an obsolete
anchor and select the intended current location.

## Acknowledgement, removal and undo

Collection waits for `ReadingVocabStore.mutate` / `AppData.vocab.mutateReading`
acknowledgement before painting success. Pending intervals in the same source,
article and text scope reject overlapping selections until acknowledgement;
adjacent or disjoint intervals remain eligible. Completed or failed saves release
their reservations. Reservations survive closing and reopening because their
durable writes can still succeed; other articles remain independently selectable.
Failed saves retain a retryable selection and do not create a saved-looking mark.
Store updates remove only `mark.vocab-highlight` wrappers and restore the current
article's acknowledged occurrences. Manual associations never invent highlights.

Click or keyboard-activate a mark to expose “remove this occurrence”; the list
also exposes removal for each resolved or unresolved occurrence. `removeOccurrence`
uses the shared final-occurrence/manual-membership semantics. Another article,
visited shelf records, and canonical definitions/review history remain intact.

The current-article tab lists that article's occurrences; the All tab lists every
occurrence of its global terms, including terms found only in another article.
Each All-tab occurrence identifies its owning article. Only current-article
anchors have been evaluated for restoration; other articles' anchors remain
unverified until opened. Removal and undo derive the owning article and library
from the saved occurrence association, including identical exam IDs in different
libraries, instead of using the currently open reader's identity.

The immediate undo action replays the original collection intent through the
same mutation API. It retains the removal transaction's committed reading-state
revision (`receipt.revisions['vocab.readingState']`) and the observed pre-removal
generation. A later clear or replacement must reject undo, even if it occurs
between that removal's commit and AppData's subsequent snapshot read. Save failures
leave the action available for retry; reopening/closing discards the local undo
action. No alternate persistence store is introduced.

## Regression entry points

- `npm test --prefix developer`: production content/anchor browser tests, reader
  lifecycle and safety tests, acknowledged persistence and vocabulary regressions.
- `python developer/tests/e2e/reading_reader_occurrences.py`: production bundles,
  actual DOM Range, IndexedDB receipts and page reloads over local HTTP and `file://`.
  Covers all seven named regression assets including Petri, ordered multi-block
  content, inline repeated terms, mouse/touch/keyboard paths, invalid selections,
  manual associations, occurrence removal/undo and unresolved recovery.
- `python developer/tests/e2e/e2e_runner.py`: the new occurrence case plus existing
  practice, isolation, recovery, listening, suite and backup flows.
- `node scripts/build-bundles.mjs --check`, Python unit tests and
  `developer/tests/ci/check_reading_data_integrity.py`: required consistency gates.

The combined static HTTPS and fresh extracted release acceptance remains owned
by #160; these browser regressions do not claim a mobile-device gesture matrix or
the aggregate release gate.
