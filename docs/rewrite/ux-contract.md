# UX Contract — IELTS Practice Rust + Tauri Rewrite

> Phase 0 deliverable  
> Source of truth: `developer/docs/IELTS_Practice_Rust_Tauri_重构任务书.md` §4  
> Baseline commit: `2e3cf0872b8f67cb6c82d1799d7043578f77157c`  
> Generated: 2026-07-12  

This document freezes **user-visible behavior** for the rewrite. Any change that violates a row below is a regression unless the contract is explicitly revised.

## 1. Global product and navigation

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-G-01 | Product name is **IELTS Practice** | Startup, top bar, reading home, window title, exports do not mix IELTS Atlas / Practice Shell / Writing Excellence | `practiceVueShell.test.js`; visual baseline |
| UX-G-02 | Primary nav: 总览 / 阅读 / 写作 / 历史 / 设置 | Any normal page can reach all five without losing saved state | `practiceVueShell.test.js`; E2E shell flows |
| UX-G-03 | Immersive attempt pages may hide global top bar | Reading attempt/suite/review have explicit back targets | `practice_reading_vue_flow.py`; suite E2E |
| UX-G-04 | Back/forward and deep links work | Refresh restores page; illegal IDs show error page, no silent bounce | route contract tests (Phase 1+); E2E deep link |
| UX-G-05 | Legacy routes remain redirected for one major version | `/?view=browse`, `/library`, old review/memorize query redirect | `legacySuiteVueRoute.test.js`; `readingLaunchVueRoute.test.js` |

## 2. Reading library

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-RL-01 | Show P1/P2/P3 categories and counts | Counts from one index snapshot; no negative/flicker counts | library unit + reading integrity |
| UX-RL-02 | Keyword / type / category / frequency / sort | Combinations reproducible; restored after return | browse preference E2E |
| UX-RL-03 | Restore last browse position | Optional; safe if asset deleted | browse preference flow |
| UX-RL-04 | PDF-only vs answerable assets | PDF opens viewer only; excluded from endless/suite answerable pool | fixtures: `p3-medium-169`; library filters |
| UX-RL-05 | Library refresh / import / source switch | Progress, error, rollback; history mapping preserved | import/backup tests |

## 3. Single reading attempt

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-R-01 | Left passage / right questions | Default 50/50; drag + keyboard resize; reflow on narrow | visual + reading page E2E |
| UX-R-02 | radio / checkbox / text / select / dragdrop | Save, restore, submit, replay for all | representative assets fixtures |
| UX-R-03 | Answer navigator states | answered / unanswered / marked / result; keyboard focus | reading E2E |
| UX-R-04 | Mark questions | Persist in draft + submission; visible in review | reading submit parity |
| UX-R-05 | Reset and snapshot | Confirm/feedback; snapshot not memory-only | draft restore tests |
| UX-R-06 | Submit de-dupe | One attempt per user action; failures keep answers | idempotent submit (Phase 6) |
| UX-R-07 | Font size + light/dark | Cross-session; controls/highlights adapt | settings preference tests |
| UX-R-08 | Highlights + notes | Create/delete/restore; bound to asset, not path | annotation fixtures (Phase 8) |
| UX-R-09 | Local dictionary + vocab list | Offline lookup; duplicate word updates | dictionaryService tests |

## 4. Timer and modes

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-T-01 | Count-up and count-down | Monotonic/reliable clock, not setInterval accumulation | timer unit (Phase 7) |
| UX-T-02 | Pause / resume | Paused time excluded; survives navigation restore | suite/timer restore |
| UX-T-03 | Expiry policy configurable | warn / lock / auto-submit; accessible pre-submit notice | timer policy tests |
| UX-T-04 | Suite shared timer | No reset across 3 passages; review stops timer | suite E2E |
| UX-T-05 | Timer optional / adjustable | A11y; informal practice not forced auto-submit | settings + a11y |

## 5. Suite / endless / memorize

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-M-01 | simulation / classic / stationary | Mode fixed at create; post-submit routing consistent | suite mode tests |
| UX-M-02 | high / high_medium / all / custom | Custom requires P1+P2+P3; invalid combo blocked | suite creation tests |
| UX-M-03 | Suite interrupt recovery | Restore passage, drafts, submitted items, shared timer | suite restore E2E |
| UX-M-04 | Endless uses answerable pool only | Countdown to next or manual exit | endless mode tests |
| UX-M-05 | Memorize read-only, no normal history | Prefill + explanations; exit returns source | memorize route tests |

## 6. Reading review

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-RV-01 | correct / total / accuracy / duration | Single canonical scoring result | scoring parity |
| UX-RV-02 | User vs correct answers | Multi-select, alternatives, empty answers consistent | answer normalization |
| UX-RV-03 | Official explanation + passage locate | Missing explanation shows empty state | explanation assets |
| UX-RV-04 | Question-type performance | Recomputable from answer records | analysis tests |
| UX-RV-05 | AI coach + retry | Coach failure does not break base submit | coach tests (Phase 8) |
| UX-RV-06 | Suite review prev/next | Only among submitted passages | suite review E2E |

## 7. Writing

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-W-01 | Task 1 / Task 2 switch | Category, min words, prompts update | compose E2E |
| UX-W-02 | Bank + freeform | Bank stores assetId; freeform stores prompt snapshot | writing fixtures |
| UX-W-03 | Draft autosave / restore | Malformed draft self-heal; no body loss | `writing_compose_draft_restore_e2e.py` |
| UX-W-04 | Submit de-dupe | One evaluation attempt per action | evaluate service tests |
| UX-W-05 | Structured stage progress | No log-string stage parsing; restart recover/retry | evaluation state machine |
| UX-W-06 | Stage-2 degradable | Keep scores + plan; mark missing sentence review | degraded fixture |
| UX-W-07 | Results reopen from DB | No sessionStorage dependence | history/result E2E |
| UX-W-08 | Result sections complete | essay, scores, diagnosis, paragraphs, sentences, plan; empty states | result page + fixtures |

## 8. History / data / settings

| ID | Contract | Acceptance | Test mapping |
|---|---|---|---|
| UX-H-01 | One unified history list | Reading + writing same timeline pagination | history page (Phase 4) |
| UX-H-02 | Distinct scales | Reading Accuracy vs Writing Band | history UI tests |
| UX-H-03 | Delete protections | Single/batch/clear confirm; stats consistent | history delete tests |
| UX-H-04 | Export/backup restore | Schema validate; failed import no pollution; report | backup tests |
| UX-H-05 | Legacy data readable | Old SQLite, reading archive v1, browser export via adapters | `tests/fixtures/legacy-data/**` |
| UX-S-01 | Settings layered | Learning prefs vs advanced AI/provider | settings page |
| UX-S-02 | Secrets not in normal export | OS keychain/Stronghold; no key in logs | security checklist |
| UX-S-03 | Update rollback | Signed packages; failed boot recovers | updater tests (Phase 2/10) |

## 9. Non-goals for Phase 0

- No production UI behavior change in this phase.
- No Tauri/Rust runtime required to validate this contract file.
- Known baseline failures (missing Playwright Python, missing `tsc`/native modules) are **pre-existing environment defects**, not rewrite regressions.

## 10. Change control

1. Changing any UX ID requires updating this file and the task book together.
2. New features may only add IDs; they must not silently reinterpret existing IDs.
3. Phase exit gates must cite IDs from this file.
