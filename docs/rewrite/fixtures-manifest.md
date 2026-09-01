# Fixtures Manifest — Phase 0 Rewrite Baseline

> Generated: 2026-07-12  
> Baseline commit: `2e3cf0872b8f67cb6c82d1799d7043578f77157c`  
> Purpose: inventory of golden inputs for domain adapters, migrations, and UX parity.

## 1. Reading representative assets

Source index: `tests/fixtures/reading/representative-assets.json`  
Raw assets live in `assets/generated/reading-exams/*.js` (not duplicated).

| examId | category | frequency | signature / traits | role |
|---|---|---|---|---|
| p1-high-01 | P1 | high | radio, text, textarea, dragdrop, table | primary single-attempt fixture |
| p1-high-24 | P1 | high | non-drag sample | drag vs non-drag control |
| p1-low-02 | P1 | low | low-frequency coverage | library filter / pool |
| p2-high-09 | P2 | high | checkbox, textarea, dragdrop, table | multi-select + drag |
| p2-high-14 | P2 | high | checkbox, text, textarea, dragdrop, table | mixed inputs |
| p2-medium-10 | P2 | medium | text, textarea, dragdrop, table | medium frequency |
| p2-low-06 | P2 | low | low-frequency P2 | pool diversity |
| p3-high-15 | P3 | high | radio, checkbox, text, textarea, dragdrop, table | dense mixed types |
| p3-high-32 | P3 | high | radio, textarea, select, dragdrop, table | includes select |
| p3-low-07 | P3 | low | low-frequency P3 | pool diversity |
| p3-low-44 | P3 | low | radio, text, textarea, table | no dragdrop control |
| p3-medium-169 | P3 | medium | radio/textarea/dragdrop/table; **pdf/no-question style** | UX-RL-04 PDF-only exclusion |

Selection rationale:

- ≥10 assets
- covers P1/P2/P3 and high/medium/low
- includes drag reusable patterns and non-drag controls
- includes explanation-present and explanation-absent signals via `assets/generated/reading-explanations/`
- includes a non-answerable / 无题目 style asset

Related existing pilot list: `developer/tests/fixtures/reading-pilot-selection.json`.

## 2. Writing evaluation fixtures

Directory: `tests/fixtures/writing/`

| file | task | mode | status | role |
|---|---|---|---|---|
| `writing-task1-bank-normal.json` | Task 1 | bank | completed | bank assetId path |
| `writing-task1-freeform-normal.json` | Task 1 | freeform | completed | freeform prompt snapshot |
| `writing-task2-bank-normal.json` | Task 2 | bank | completed | full v3 alias surface |
| `writing-task2-freeform-degraded.json` | Task 2 | freeform | completed + degraded | stage-2 degradation |
| `writing-task2-freeform-failed.json` | Task 2 | freeform | failed | provider failure / retryable |

Each completed fixture intentionally contains **legacy aliases** (`score`/`scorecard`/`total_score`, `feedback`/`overall_feedback`, nested `analysis.task_analysis`, etc.) so Phase 1 adapters can prove old → v4 equivalence.

## 3. Legacy migration samples

| path | kind | notes |
|---|---|---|
| `tests/fixtures/legacy-data/browser-export/legacy-browser-export-v1.json` | browser localStorage export | practice records + settings + vocab + notes |
| `tests/fixtures/legacy-data/reading-archive/reading-archive-v1-sample.json` | reading archive v1 | duplicated scoreInfo / metadata fields for adapter deletion rules |
| `tests/fixtures/legacy-data/sqlite-samples/schema-snapshot.json` | SQLite schema inventory | points at `electron/db/schema.sql`; no production binary in-repo |
| `developer/tests/e2e/fixtures/data-integrity-import-sample.json` | existing E2E import sample | retained as secondary import shape |

SQLite binary note:

- Repository does not ship a real user `ielts-writing.db`.
- Phase 3 will synthesize DBs from `electron/db/schema.sql` + essay/history fixtures.
- If a local app-data DB is available on a developer machine, drop a redacted copy under `tests/fixtures/legacy-data/sqlite-samples/` and update this manifest.

## 4. Existing in-repo fixtures retained as evidence

| path | use |
|---|---|
| `developer/tests/fixtures/reading-pilot-selection.json` | question-type signature pilot |
| `developer/tests/fixtures/reading-migration-report.json` | historical migration evidence |
| `developer/tests/fixtures/reading-crosswalk*.json` | asset identity crosswalk |
| `developer/tests/baseline/*` | older Phase0 selenium/playwright scripts (legacy file:// era) |

## 5. Visual baseline

Directory: `tests/visual/baseline/`

Phase 0 establishes the **capture contract**, not full screenshot binaries (Playwright Python is currently unavailable in this environment):

| viewport | pages |
|---|---|
| 1440×960 | overview, reading library, compose, history, settings |
| 1024×720 | same set |
| narrow (390×844) | overview + compose + reading attempt chrome |

Capture command target (Phase 2+ when Playwright is installed):

```bash
python developer/tests/e2e/capture_visual_baseline.py
```

Placeholder tracker: `tests/visual/baseline/README.md`.

## 6. Generator

Regenerate synthetic fixtures:

```bash
python developer/tests/ci/generate_phase0_rewrite_fixtures.py
```

Do not hand-edit generated JSON unless also updating the generator.
