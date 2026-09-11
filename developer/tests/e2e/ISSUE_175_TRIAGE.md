# Issue #175: visual regression triage

The shipping target is the Tauri 2 Vue interface. Browser fixtures exercise the
same production build with mocked Tauri command responses; native acceptance
remains a separate gate.

## Reproduction and design authority

- Original failing commit: `617284eca6780d4069edb7a8af2a0246be22342e`.
- [Original Windows run](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34486620462)
  and [its report, logs, and screenshots](https://github.com/sallowayma-git/IELTS-practice/actions/runs/34486620462/artifacts/10156044200).
- Reproduced on integration commit `08bac3a3` using Playwright `1.61.0`:
  all 17 scripts executed, 16 failed, and Topic Manage passed.
- Current visual authority: `apps/writing-vue/src/styles/design-system/tokens.css`
  and `apps/writing-vue/src/styles/opensource-skin.css`. They define an opaque,
  warm surface theme with hairline elevation, clay accents, serif headings, and
  a named stacking scale. Old glass/gradient styling is not the target.

The reproduction screenshots show long History titles extending beyond their
cards, a two-column Writing Result squeezed into a phone viewport, mobile
Library tabs outside the visible container, and navigation above History detail.
Suite screenshots show distinct status colors on passage badges, with explicit
status text, rather than on the entire row background.

Navigation geometry is sampled after the routed view appears and its finite
entry animations finish; the active navigation label updates before that view
is ready. Pixel checks allow 0.5px rounding where a translated 44px target was
observed as `43.99993896484375px`. Neither readiness check waits for an expected
layout property or increases the timeout.

## Classification and retained coverage

| Script | Classification and resolution | Coverage retained or strengthened |
| --- | --- | --- |
| `agent_workspace_visual_check.py` | Stale command assertion omitted six initialization reads. These independent reads may run in either order; verify their exact multiset separately from the ordered user actions. | All console zones, workspace selection, failed and successful run hydration, original error, trace metadata, and exact pick/run/read sequence. |
| `nav_responsive_visual_check.py` | Product: the skin overrode the compact navigation overflow and touch size. The old test also treated programmatic focus as keyboard input and checked only an outline. Restore visible compact overflow, 44px targets, and a strong outline. | Actual Tab navigation and `:focus-visible`, all six entries, active-route semantics, no clipping from 320px upward. |
| `settings_modal_visual_check.py` | Mixed: fixed z-index 60/grid assertions were stale; document scroll locking and stacking were missing. Detail sections also retained translucent, heavy glass styling. Use the named overlay layer, lock the document, and remove residual nested glass. | Onboarding, updates, nested confirmation, modal bounds and scrolling, actual overlay hit testing above navigation, scroll restoration, five settings tabs, current flat surfaces. |
| `topic_manage_visual_check.py` | Passing baseline; no product or assertion change needed. | Existing desktop/tablet/mobile/small-screen interactions and screenshots. |
| `history_detail_visual_check.py` | Mixed: missing scroll lock, stacking, and bounded state surfaces were product defects. Gradient score and borderless/no-shadow-only rules were stale. The current theme permits opaque hairline surfaces. | Loading/error/empty/success, retry and recovery, persisted score and essay/feedback content, four metrics, analysis sections, responsive columns, topmost overlay and restored document scrolling. |
| `history_batch_visual_check.py` | Product: the batch bar did not wrap, and selection count did not own a narrow-screen row. | Selection count, two accessible actions, 44px targets, viewport bounds. |
| `history_filter_analytics_visual_check.py` | Product: comparison table lacked a horizontal scroll owner; narrow filter controls fell below the target size. | Mixed/writing/reading scales, native Band and percentage units, chart geometry, reset/filter behavior, horizontal table access and 44px controls. |
| `history_record_pagination_visual_check.py` | Product: unbroken title tokens overflowed the page, selection/icon targets were undersized, reading/unlabeled badges had no surface, and mobile pagination lost its row structure. | Full title wrapping, accessible 44px selection/actions, badge states, two-row mobile pagination, deletion on the last page and recovery to the first page. |
| `history_page_states_visual_check.py` | Product plus misleading wait: shared bounded state styles were missing, so loading remained `display: block`. Waiting for `display: grid` hid the CSS defect behind a timeout. Restore the shared grid surface and assert layout after the semantic state appears. | All four states at four widths, live-region/busy semantics, loading spinner, disabled destructive actions, retry and filter reset. No increased timeout. |
| `writing_result_visual_check.py` | Product plus misleading wait: the old fixed-height flex layout squeezed desktop columns into phones and the selected view had no distinct style. Waiting for `display: grid` hid the layout failure. Restore responsive grid layout, natural-height content, and selected-view contrast. Nonzero typography tracking is intentional in the current theme. | Original persisted essay, expandable/collapsible annotations, complete score/support content, nonoverlapping responsive columns, reachable content, selected-state contrast of at least 4.5:1 at rest and hover, exact history read command. No increased timeout. |
| `reading_library_surface_visual_check.py` | Stale theme assertions: current neutral tool cards and hairline shadows are intentional; tools are actions, not selected states. Validate opaque surfaces without glass/gradient/heavy shadows. | Tool and settings panel counts, bounds, clock/config/PDF interactions and overlays; screenshots now capture each of these states. |
| `reading_library_tabs_visual_check.py` | Product: mobile tabs used hidden horizontal scrolling. Restore three-column wrapping with 44px buttons. | All five entries remain visible from 320px, each view can be selected, active and `aria-current` agree, no page overflow. |
| `reading_suite_selector_visual_check.py` | Mixed: exact main z-index 130 was stale, but the selector really was below navigation. Raise the containing main layer while an overlay is open. Option descriptions also needed wrapping. | Actual topmost hit testing, document lock/release, modal bounds, three options and one active state, frequency selection, keyboard focus and dismissal. |
| `reading_custom_suite_visual_check.py` | Mixed: neutral card/shadow assertions were stale; long picked titles could escape the workflow surface. Constrain and wrap picked titles and give narrow actions stable columns. Readiness is shown by completion text and the enabled confirm button. | P1/P2/P3 progression, full long-title retention, confirm readiness and visible opacity change, mobile target geometry, cancellation. |
| `reading_suite_visual_check.py` | Stale theme assertions: status colors belong to passage badges; loading cards may use hairline shadows. | Distinct badges plus non-color status labels, active/start, submitted/review and pending/no-action contracts, frameless layout, loading/error/empty/retry/return flows. |
| `reading_history_widget_visual_check.py` | Product: narrow History actions were 40px high. Restore 44px targets and stable labels. | Widget front/back, heatmap/radar/priority selection, trend ranges, bulk selection, mobile action geometry. |
| `reading_history_record_visual_check.py` | Mixed: `scrollWidth > clientWidth` is expected for ellipsis, so the old overflow assertion was incorrect. The containing grid item also lacked a shrink boundary and the score surface was undersized. Constrain the item and expose the full title as a tooltip. | Card bounds, real ellipsis and full-title fallback, score/delete targets, selection toggling, review navigation and isolated delete action. |

## Validation and evidence

Run `python developer/tests/e2e/run_visual_regressions.py` against the production
Vue build. It still executes every one of the original 17 scripts. The artifact
contains each script's log, fresh screenshots, fresh per-case JSON reports,
and `visual-regression-report.json` with the checkout commit, dirty flag,
platform, Python/Playwright versions, and CI run URL.

The implementation PR records the tested commit and the clean Windows CI
artifact links. Run the repository regression commands in this order:

```text
python developer/tests/ci/run_static_suite.py
python developer/tests/e2e/suite_practice_flow.py
```

The existing Native release acceptance workflow runs this sequence against a
fresh native Windows build. Visual and native gates retain their own results;
a passing visual job does not imply that the aggregate CI or native gates pass.
Issue #171's sidecar preparation is unchanged.
