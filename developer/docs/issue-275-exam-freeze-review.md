# Issue #275: exam-freeze review and CI repair

This repair restores the CI evidence and native runner for [#275](https://github.com/sallowayma-git/IELTS-practice/issues/275), tracked by [#274](https://github.com/sallowayma-git/IELTS-practice/issues/274). The repair PR targets `claude/project-thread-9g6hio`; integration into [#264](https://github.com/sallowayma-git/IELTS-practice/pull/264) and final parent/child acceptance remain a separate review step.

## Reproduction and provenance

- Refreshed #264 source: `d429179866e07f4b27d22532a1ccc534a08eea24`.
- Refreshed #264 base (`IELTS-WRITING-FEAT`): `996f323f629115e5ece25fba3c8ba9edc38442d9`.
- Original integration merge: `f0a741cb6c215ce5c4490c614760f95267e4b60d`.
- Original failing integration evidence: [run 42193806328, attempt 2](https://github.com/sallowayma-git/IELTS-practice/actions/runs/42193806328/attempts/2).
- Runner/collector repair source used for baseline capture: `d3737f2aa28a8b14ef8803c167e170b5948d03cb`.
- Temporary evidence revision: `b2569a1d0b5e47aea7c51f3300a75ad9faaa0f49`. Its only additional file is the isolated capture workflow; it does not change application or comparator code.
- Matching Windows capture: [baseline-review job](https://github.com/sallowayma-git/IELTS-practice/actions/runs/42234344449/job/127947990218), [artifact `issue-275-baseline-review`](https://github.com/sallowayma-git/IELTS-practice/actions/runs/42234344449/artifacts/13512935024).

The capture workflow builds the production Vue assets, runs the original full matrix, and preserves its failed evidence before invoking the official `python developer/tests/e2e/exam_freeze_visual_check.py --update-baseline` command. It then runs the ordinary comparison and full matrix again. The artifact contains original baselines (`baseline-before/`), the original complete matrix (`before/`), generated baseline candidates (`baseline-after/`), the ordinary comparison report, the update log, and the final matrix (`after/`). This temporary workflow is not part of the repair PR.

The required capture environment is Windows Server 2022, Python 3.12, Playwright 1.61.0, and Chromium `149.0.7827.55`. Capture metadata must match the committed metadata. Candidate generation asserts that exactly the six review JSON/PNG pairs change, while metadata and all twelve practice/suite pairs remain byte-for-byte unchanged.

Downloaded evidence confirms Python **3.12.10**, an **18/18** passing ordinary comparison and a **20/20** passing full matrix after the update. All twelve generated review files are byte-identical to the current snapshots already audited in the original failure artifact. The other 25 baseline files (twelve JSON/PNG pairs plus metadata) are byte-for-byte unchanged. The candidate-run metadata correctly reports a dirty tree because the official updater has just changed tracked baselines; final clean-commit qualification is recorded separately in the repair PR.

## Seven added elements

The fixture marks the fifth answer (`index === 4`) and returns no coach history. The original baseline predates two intentional source changes:

| Current indices | Elements | Source and decision |
| --- | --- | --- |
| 302–304 | `div.reading-coach-panel__notice`, its `span`, and its reload `button.reading-coach-chip` | [d42ae007](https://github.com/sallowayma-git/IELTS-practice/commit/d42ae0074fbb8e6d2eaad7f95a015e75c77ddfd5) separates a history-load notice from message failures and supplies a reload action. Accept. All three elements have zero rectangles while the coach panel is closed. |
| 336–339 | Read-only `span.q-flag.is-marked`, its `svg`, and two `path` elements | [a0c4a08c](https://github.com/sallowayma-git/IELTS-practice/commit/a0c4a08c86fdba2a426ea65bad07ab4a52821e2a) restores question flags. Accept: review displays the fixture's saved mark as a read-only image. |

The net count increase is exactly seven. After pairing the documented input-to-textarea replacement, removing only those seven additions aligns all 371 original elements with the 378-element current capture. Each aligned element's entire recorded style dictionary and rectangle is compared; the audit does not stop at the count mismatch. Desktop/tablet each have ten changed retained elements; mobile has eleven. Both entry paths produce the same conclusions.

## Retained-element differences and decisions

| Original → current element | Difference | Decision |
| --- | --- | --- |
| 301 → 301: coach status | The obsolete `is-error` class is removed; its recorded styles and rectangle are unchanged. | Accept the separate notice introduced in d42ae007. |
| 304 → 307: coach action row, mobile only | Top padding `10px → 8px`; left padding `16px → 12px`. | Accept d42ae007's narrow-screen action row. Its closed-panel rectangle remains zero. |
| 305–308 → 308–311: four coach chips | Line height `20.8px → 17.55px`; top padding `0px → 3px`. | Accept d42ae007's wrapping chip styles. Rectangles remain zero while closed. |
| 310 → 313: coach composer | `input → textarea`; line height `22.4px → 19.6px`; top padding `0px → 6px`. | Accept multiline editing and IME-safe keyboard behavior from d42ae007. The hidden rectangle remains zero. |
| 311 → 314: disabled send button | Text `rgb(51,51,51) → rgb(165,165,165)`; top/bottom/left border color `rgb(239,239,239) → rgb(213,213,213)`. | Accept disabled styling. The fixture has an empty query, so `canAskCoach` is false. |
| 317 → 320: question row | Adds `has-flag`. Desktop/tablet styles and rectangles are unchanged. Mobile top padding `0px → 12px`, top margin `0px → -12px`, rectangle `[63.5,805,20,27.5] → [63.5,793,20,51.5]`. | Accept a0c4a08c's enlarged clipping area for the flag. The negative margin preserves the nav and question-number geometry. |
| 330 → 333: fifth question column | Adds `has-flag`; `position: static → relative`. | Accept the flag's positioning anchor. The column rectangle is unchanged. |
| 332 → 335: fifth question number | Adds a red `1px` inset box shadow (`rgb(198,40,40)`). | Accept the saved-mark indication; its rectangle is unchanged. |

No other retained styles or rectangles change. In particular, desktop/tablet have no retained-element rectangle changes; mobile changes only the flagged row's clipping rectangle. The seven additions and all retained-element changes come from the two documented source changes, so this repair does not modify production UI code.

## PNG review

The downloaded [failed-run visual artifact](https://github.com/sallowayma-git/IELTS-practice/actions/runs/42234344256/artifacts/13510889537) contains the complete current snapshots and generated pixel masks. The original/current PNGs and diff masks were inspected at all three sizes. Each viewport's cold and via-library PNGs are byte-identical, as are their JSON snapshots, covering both entry paths with the same review.

| Viewport | Original pixel difference ratio, both entries | Visual decision |
| --- | --- | --- |
| Desktop, 1440 × 900 | 0.00065 (0.065%) | Accept the saved flag and inset mark on question 5. Passage, answer layout, divider and navigation geometry are unchanged. Remaining mask pixels are sparse glyph-edge differences. |
| Tablet, 1024 × 768 | 0.00094 (0.094%) | Same flag/mark decision and unchanged retained rectangles. |
| Mobile, 390 × 844 | 0.00092 (0.092%) | The initial horizontal nav viewport shows question 1; question 5 and its flag are outside that clip. The enlarged row clip does not move the visible controls. The mask contains sparse text-edge differences. |

All six original pixel comparisons already pass the 0.005 limit. Baselines are refreshed because the intentional DOM/style changes fail the exact style gate, not because the pixel threshold needs relaxing.

## Evidence collection and gates

The collector retains its top-level screenshots/reports and also selects fresh JSON/PNG files below `reports/exam-freeze/`. It copies every selected file relative to `reports/`, preserving `exam-freeze/current/` and its metadata, element JSON, screenshots, and generated diff PNGs. Selection excludes the aggregate report, older timestamps, unrelated report archives, and the evidence destination. The aggregate report lists every copied artifact.

The downloaded failed-run manifest resolves all **199** copied files. Its exam-freeze subtree contains **50** files: eighteen element JSON snapshots, eighteen screenshots, twelve generated diff PNGs, capture metadata and the comparison report. There is no recursively copied evidence destination.

`visual_evidence_test.py` exercises successful, failed, timed-out and repeated matrix execution. It checks old-file exclusion, original bytes and relative paths, nested report/snapshot/metadata/diff coverage, and exclusion of the destination. The CI visual job executes this test before the matrix.

The sidecar matrix uses `macos-15`, retaining `aarch64-apple-darwin` and Python `arm64`. The existing release-contract test checks that tuple. Linux coverage and the aggregate CI dependency remain intact.

Clean-run qualification also exposed a cache prerequisite: the static gate's offline domain tests need the locked `ppv-lite86` test dependency, which the earlier workspace check does not fetch. The Windows static job now runs `cargo fetch --locked --target x86_64-pc-windows-msvc` before the gate. This prepares all locked test dependencies while preserving the offline tests, assertions and lockfile.

`exam_freeze_visual_check.py` is unchanged: exact style/rectangle comparison, channel tolerance **32**, maximum pixel difference ratio **0.005**, all **18** scenarios, and the complete **20**-script visual matrix are preserved. The ordinary comparison, rather than the baseline-update command's exit code, determines whether the accepted baselines pass.

Final repair head, qualification runs, downloaded artifact verification, and the review decision are recorded in the repair PR. A repair-branch CI result does not claim that #264's later integration revision has passed; #274 and #275 stay open until that separate acceptance is complete.
