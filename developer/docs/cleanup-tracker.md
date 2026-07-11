# Cleanup Tracker (live)

Canonical subtractive cleanup checklist after the data-layer refactor.
Field contracts: [Global-Field-Inventory](../doc/Wiki/Global-Field-Inventory.md).

**Hard constraints**

- Do not rewrite storage backends in cleanup sprints.
- Do not change listening bridge / exam-window message protocol in Sprint A/B.
- Edit `js/**` sources only, then always run `node scripts/build-bundles.mjs`.
- Do not commit `.zcode/`.

---

## Sprint A — pure deletion / docs (zero UX change)

| Item | Status | Notes |
| --- | --- | --- |
| A1 Remove commented writing scorer tool card (`index.html` + e2e snapshot) | done | No WritingScorer module in tree |
| A2 Drop `typeChecker.js` / `codeStandards.js` from diagnostics bundle; delete sources | done | Outdated `userAnswer` schemas; zero prod callers |
| A3 Align wiki (ScoreStorage façade, dead legacy bridge / tracker links) | done | This file is the live tracker |
| A4 ScoreStorage header + AchievementManager rename (`…PracticeRecordAPI`, keep ScoreStorage aliases) | done | |
| A5 rebuild + commit + push `opensource` | done | `d5aa822` |

### Sprint A regression checklist

- [ ] Overview / browse / more / settings open
- [ ] Practice save → history → replay
- [ ] Import / export / local backup entry
- [ ] Onboarding demo inject + cleanup (`updateStats: false`)
- [ ] `file://` open still works

---

## Sprint B — façade thinning (needs tests)

| Item | Status | Notes |
| --- | --- | --- |
| B1 Prefer `listSummary` for history/overview stats | pending | Full `list` only for replay/detail/export |
| B2 Narrow ScoreStorage; drop duplicate normalize when contracts ready | pending | |
| B3 Audit `temp_practice_records` / `interrupted_records` producers | pending | PracticeRecorder vs runtime-fixes |
| B4 PracticeStore thin wrapper: deprecate or delete after tests | pending | |
| B5 Suite save/delete, listening complete, import merge, onboarding stats isolation | pending | |

---

## Sprint C — architecture convergence (after e2e green)

| Item | Status | Notes |
| --- | --- | --- |
| C1 Normalize only in PracticeCore; remove ScoreStorage duplicate body | pending | |
| C2 Evaluate deleting ScoreStorage class | pending | PracticeRecorder → API + contracts |
| C3 Optional monolith splits (`examSessionMixin`, `main.js`, `unifiedReadingPage`) | pending | One PR per slice |
| C4 AppState dual-mirror / `window.*` audit | pending | Global-Field-Inventory §6–7 |

**Explicit non-goals until C + tests:** listening bridge protocol change, multi-backend storage rewrite, bulk property-descriptor removal.

---

## Done recently (pre-Sprint A)

- Onboarding tour aligned to PracticeRecordAPI + full-replay demo + scroll lock
- Global-Field-Inventory written
- Practice dual-write path largely closed at API gates
