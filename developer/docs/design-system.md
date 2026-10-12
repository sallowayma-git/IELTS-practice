# IELTS Atlas Design System v2 — "Paper"

Status: spec, 2026-10-12. Scope: every non-exam route (`.atlas-paper` shell).
The three reading exam routes (`.atlas-exam`, `.reading-page`, `exam-frozen.css`,
`exam-theme.css`, `modules/practice-reading/**`) are frozen and must not change.

Direction: a warm, academic, print-inspired desktop app. Think a well-set
journal page laid on a desk: layered paper, ink typography, one clay accent.
No pills, no glassmorphism, no gradients, no chatbot chrome. Hierarchy comes
from type first, surfaces second, colour last.

---

## 1. Tokens

Namespace stays `--anth-*` (no churn). Everything else (`--atlas-*`, `--lg-*`,
`--shui-*`, `--color-*`, `--space-*`, `--radius-*`, `--shadow-*`) is an alias in
`aliases.css` and must not hold literal values.

### 1.1 Typography

Fonts are **bundled** (offline desktop app, no CDN):

| Role | Family | Source | Notes |
|---|---|---|---|
| Display / headings (Latin) | Source Serif 4 (variable, opsz) | `@fontsource-variable/source-serif-4` | |
| Display / headings (CJK) | Noto Serif SC 600 only | `@fontsource/noto-serif-sc/600.css` | unicode-range chunks; replaces SimSun fallback |
| UI / body (Latin) | Inter (variable) | `@fontsource-variable/inter` | `font-feature-settings: "cv11","ss01"` |
| UI / body (CJK) | system: Microsoft YaHei UI → PingFang SC → Noto Sans SC | system | |
| Mono | JetBrains Mono → Consolas | system | |

```
--anth-font-serif: "Source Serif 4 Variable", "Noto Serif SC", "Songti SC", Georgia, serif;
--anth-font-sans:  "Inter Variable", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
--anth-font-mono:  "JetBrains Mono", Consolas, ui-monospace, monospace;
```

Type scale (desktop density; px values, 1rem = 16px):

| Token | Size / Line | Weight | Family | Tracking | Use |
|---|---|---|---|---|---|
| `display` | 34 / 42 | 600 | serif | -0.015em | landing hero, big score |
| `h1` | 28 / 36 | 600 | serif | -0.01em | page title (one per page) |
| `h2` | 21 / 28 | 600 | serif | -0.005em | section title |
| `h3` | 16 / 24 | 600 | sans | 0 | card / panel / list-group title |
| `body-lg` | 16 / 27 | 400 | serif | 0 | long-form reading, essay, notebook prose |
| `body` | 14 / 22 | 400 | sans | 0 | default UI text |
| `small` | 13 / 20 | 400 | sans | 0 | metadata, helper text |
| `caption` | 11.5 / 16 | 600 | sans | 0.08em, uppercase (Latin) | kicker, table header, tag |
| `stat` | 30 / 34 | 600 | serif | -0.01em, tabular-nums | numeric KPI |

Tokens per row: `--anth-text-{name}-size`, `--anth-text-{name}-line`. Weights:
`--anth-weight-regular 400`, `--anth-weight-medium 500`, `--anth-weight-semibold 600`.
Utility classes: `.t-display .t-h1 .t-h2 .t-h3 .t-body-lg .t-body .t-small .t-caption .t-stat .t-num` (tabular).
Base element styles: `h1→h1`, `h2→h2`, `h3→h3`, `body→body`, `small→small`.

### 1.2 Colour

Ink (text) — never use pure black:

```
--anth-ink:        #1F1D1A   primary text, headings
--anth-ink-soft:   #46423B   secondary text, body on dense UI
--anth-ink-muted:  #6E685E   metadata, helper (>= 4.5:1 on canvas)
--anth-ink-faint:  #948D80   placeholder, disabled text ONLY
--anth-ink-inverse:#FFFDF8
```

Surfaces (4 tiers, each visibly distinct):

```
--anth-canvas:         #EEEAE1   app background
--anth-surface:        #F7F5EF   panels, cards, nav, sticky toolbars
--anth-surface-raised: #FFFDF8   dialogs, popovers, inputs, hovered rows
--anth-surface-sunken: #E6E1D6   wells, segmented track, code, progress track
```

Rules:

```
--anth-rule:        rgba(31,29,26,.12)  hairline divider
--anth-rule-strong: rgba(31,29,26,.22)  input / control border
--anth-rule-ink:    #1F1D1A             booktabs top/bottom rule on tables
```

Accent (clay, single brand hue):

```
--anth-accent:        #B4552F   primary button, active tab, links, focus
--anth-accent-hover:  #9C4626
--anth-accent-press:  #843A1F
--anth-accent-soft:   #F2E1D6   selected row bg, focus halo
--anth-accent-subtle: #F8EEE7   hover on accent-tinted items
--anth-accent-ink:    #8A3B1E   accent text on soft bg
```

Semantic (each has fg / soft bg / border):

| Name | fg | soft | border |
|---|---|---|---|
| success | #2F6B4A | #E3EEE6 | #B9D3C2 |
| warning | #8A6420 | #F4EAD3 | #E0CB9C |
| danger | #A23A2E | #F6E1DD | #E2B3AB |
| info | #34577F | #E2E9F1 | #B5C7DB |

Essay error highlight colours (existing four) stay as-is.

### 1.3 Spacing (4px grid)

`--anth-space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px.
Rules of thumb: inside a control 8–12; between related items 8–12; card padding
20–24; between sections 32–40; page top padding 32.

### 1.4 Radius

```
--anth-radius-xs: 2px   tags, kbd, checkboxes
--anth-radius-sm: 4px   inputs, small buttons, chips
--anth-radius-md: 6px   buttons, cards, list groups
--anth-radius-lg: 8px   dialogs, popovers
--anth-radius-pill: 6px (retired; alias only)
```

### 1.5 Elevation

```
--anth-shadow-0: none
--anth-shadow-1: 0 1px 0 rgba(31,29,26,.04), 0 1px 3px rgba(31,29,26,.07)          card, nav, secondary btn
--anth-shadow-2: 0 2px 6px rgba(31,29,26,.07), 0 12px 28px rgba(31,29,26,.10)       dialog, popover, menu
--anth-shadow-inset: inset 0 1px 2px rgba(31,29,26,.14)                             pressed, wells
--anth-highlight: inset 0 1px 0 rgba(255,255,255,.14)                               top sheen on filled buttons
--anth-focus-ring: 0 0 0 2px var(--anth-canvas), 0 0 0 4px var(--anth-accent)      keyboard focus (all controls)
```

### 1.6 Motion

`--anth-duration-fast 120ms` (hover, press), `--anth-duration-base 180ms`
(popover, row select), `--anth-duration-slow 240ms` (dialog, page).
Easing `--anth-ease: cubic-bezier(.2,0,0,1)`. Only opacity / transform /
background-color / box-shadow / border-color animate. Reduced motion → 0ms.

### 1.7 Layout

```
--anth-nav-height: 56px
--anth-shell-max: 1200px   page container
--anth-prose-max: 720px    long-form reading
--anth-sidebar-w: 280px    filter / index rail
--anth-gutter: 32px        page side padding (24px under 1024w)
```

---

## 2. Components

All components live in `apps/writing-vue/src/styles/design-system/components/*.css`,
imported by `index.css`, scoped under `.atlas-paper`. Legacy class names are
mapped to canonical ones in `components/legacy-map.css` with `:is(...)`; no
template rewrite is required to adopt them, but new code uses canonical names.

### 2.1 Button `.btn`

Sizes: `.btn-sm` 28h / 0 10px / small; default 36h / 0 14px / body 500;
`.btn-lg` 44h / 0 20px / 15px 500. `gap: 8px`, icon 16px, radius-md.

| Variant | Rest | Hover | Active | Notes |
|---|---|---|---|---|
| `.btn-primary` | accent bg, inverse text, `highlight + shadow-1` | accent-hover | accent-press, `shadow-inset`, translateY(1px) | one per view |
| `.btn-secondary` (default `.btn`) | raised bg, rule-strong border, ink, shadow-1 | surface bg, border ink 30% | sunken bg, shadow-inset | |
| `.btn-ghost` | transparent, ink-soft | sunken bg | rule-strong bg | toolbars, low emphasis |
| `.btn-danger` | danger fg bg, inverse text, highlight | 8% darker | inset | destructive confirm only |
| `.btn-danger-ghost` | transparent, danger fg text | danger soft bg | | row-level delete (NOT pale grey) |
| `.btn-link` | accent text, underline 1px offset 3px | accent-hover | | inline |
| `.btn-icon` | square, size = height | as ghost | | needs aria-label |

States: `:focus-visible` → `--anth-focus-ring`; `:disabled, [aria-disabled=true]`
→ opacity .45, no shadow, cursor not-allowed; primary and danger instead keep
opacity 1 and take bg `surface-sunken`, ink-muted text, `rule-strong` border, no
shadow (a faded white label reads as broken); `.is-loading` → text transparent +
14px spinner centered. Transition fast on bg/border/shadow/transform.
Legacy → canonical: `btn-brand, hero-btn(primary), submit-btn → btn-primary`;
`btn-warm-sand, btn-outline, page-btn, action-btn → btn-secondary`;
`btn-text → btn-link` (or ghost in toolbars); `btn-dark → btn-primary`;
`btn-warning → btn-secondary`.

**Touch floor.** On desktop the controls keep their spec sizes, with a 24px floor (WCAG 2.5.8). In touch contexts (`pointer: coarse` or width 640px and below) buttons, icon buttons (also 44px wide), segmented items, tabs, inputs, selects and checkbox/radio labels take a 44px minimum height (`--anth-touch-target`). Legacy `a11y-performance.css` sizing applies only outside `.atlas-paper`.

### 2.2 Inputs `.field`, `.input`, `.select`, `.textarea`

36h (textarea auto), raised bg, 1px rule-strong, radius-sm, padding 0 12px,
body text, placeholder ink-faint. Hover border ink 35%. Focus: border accent +
`0 0 0 3px accent-soft`. Invalid `[aria-invalid=true]`: danger border + danger
soft halo. Disabled: sunken bg, ink-faint.
Select: `appearance:none`, custom chevron (inline SVG data-URI, ink-muted),
padding-right 32px. Applies to all native `select` inside `.atlas-paper`.
`.field` = label (small, 500, ink-soft, mb 6px) + control + help (small ink-muted)
or error (small danger).
Checkbox/radio: `accent-color: var(--anth-accent)`, 16px.

### 2.3 Segmented control `.segmented`

Sunken track, radius-md, padding 3px; items 30h, transparent, ink-muted;
selected item raised bg + shadow-1 + ink + 500. Legacy `.shui-segmented*`,
`.mode-btn`, `.task-btn`, `.toggle-item` map here.

### 2.4 Tabs `.tabs`

Row of text buttons, 40h, body 500 ink-muted, bottom rule; active ink + 2px
accent underline (inset box-shadow, no layout shift).

### 2.5 Card / Panel `.card`, `.panel`

surface bg, 1px rule, radius-md, shadow-1, padding 20px 24px.
`.panel-header`: h3 + optional actions, padding-bottom 12px, bottom rule, mb 16px.
`.card.is-interactive`: hover raised bg + border rule-strong; cursor pointer.
Do not nest cards. Inside a card, group with rules and spacing only.

### 2.6 List `.list`, `.list-row`

`.list`: surface bg, 1px rule, radius-md, shadow-1, overflow clip (clips the
radius but lets group titles stick; never hidden).
`.list-row`: min-height 56px, padding 12px 16px, grid `[lead] 1fr [trail]`,
bottom 1px rule (last none). Title body 500 ink; meta small ink-muted with
`·` separators; trailing actions appear full-opacity always (no hover-only
critical actions). Hover: raised bg. Selected `.is-selected` / `[aria-selected=true]`:
accent-subtle bg + 3px accent strip on the left, drawn by `::before` (never an
inset box-shadow; the flat-surface gate rejects it). Group header
`.list-group-title`: caption, sunken bg, sticky top 0, padding 8px 16px.
Rows of one group must share one `.list` container: the last-child row drops
its bottom rule, so a row in its own container keeps no separator.

### 2.7 Page header `.page-header`

```
[caption kicker]                       [actions: btn…]
H1 serif title
small/body ink-soft description (max 64ch)
```
Padding-top 32, margin-bottom 24, optional bottom rule `.page-header.has-rule`.
Exactly one h1 per page.

### 2.8 Section `.section`

`h2` + optional `.section-meta` (small ink-muted) on one baseline row, then
content. Sections separated by 40px; optional top rule `.section.has-rule`.

### 2.9 Dialog `.dialog` (+ `.dialog-overlay`)

Overlay `rgba(31,29,26,.32)` fade. Dialog raised bg, radius-lg, shadow-2,
1px rule; widths `.dialog-sm 420`, default 560, `.dialog-lg 760`;
`max-height: min(86vh, 860px)`, flex column. Header (h3 + close icon btn,
padding 20 24 12), body (padding 0 24, overflow-y auto), footer (padding 16 24 20,
top rule, actions right-aligned, primary last). Enter: opacity + translateY(8px)
→ 0, slow.

### 2.10 Tag / Badge `.tag`

20h, padding 0 8px, radius-xs, caption-ish 12px 500 (no uppercase for CJK),
variants `.tag-neutral` (sunken bg, ink-soft), `.tag-accent`, `.tag-success`,
`.tag-warning`, `.tag-danger`, `.tag-info` (soft bg + fg). Band scores use
`.tag` + `.t-num`.

### 2.11 Stat `.stat`

`.stat-value` t-stat ink; `.stat-label` caption ink-muted above; optional
`.stat-delta` small success/danger. Stats in a row are separated by vertical
rules, not boxes.

### 2.12 Table `.table` (booktabs)

No vertical lines. 1.5px ink rule top and bottom, 1px rule under header,
hairline between rows only if > 6 rows. Header caption ink-muted. Numeric
columns right-aligned, tabular-nums. Row hover raised.

### 2.13 Inline message `.inline-message` (`-info/-success/-warning/-error`)

Soft bg, 1px semantic border, 3px left bar in fg colour, radius-sm, padding
10px 12px, small text. (`.inline-message-error` selector is used by tests —
keep it.)

### 2.14 Empty state `.empty-state`

Centered in its container, max-width 420, padding 48 24. Optional 40px glyph in
ink-faint, h3, small ink-muted description, primary or secondary action.
Never a bare grey sentence.

### 2.15 Scroll region & workspace layout

Workspace routes fill one screen with flex, not calc: `.app-shell:has(> .app-main > .workspace)` is `100vh`/`100dvh`, the `.app-main` frame is a flex column with 24px top / 8px bottom, and `.workspace` (`display:grid; grid-template-rows: auto 1fr;`) takes `flex: 1 1 0`. The nav row is 57px on desktop (56px plus its rule) and taller when it wraps on phones, so no page restates nav height. 
`grid-template-rows: auto 1fr;` (header/toolbar row, scrolling body).
Variant `.workspace.has-rail`: columns `var(--anth-sidebar-w) 1fr`.
`.scroll-region`: `min-height:0; overflow-y:auto; overscroll-behavior:contain;`
`scrollbar-gutter: stable;`. `.toolbar.is-sticky`: surface bg, bottom rule,
z sticky, padding 12px 0.
Scrollbars (all `.atlas-paper`): 10px, transparent track, thumb
`rgba(31,29,26,.18)` radius 6px with 2px transparent border (background-clip),
hover `.30`. Firefox: `scrollbar-width: thin; scrollbar-color`.

### 2.16 Navigation bar

surface bg, bottom rule + shadow-1, 56h. Brand wordmark serif 18 600.
Nav items body 500 ink-muted, 56h, active ink + 2px accent bottom bar; hover ink.

---

## 3. Page patterns

| Page | Pattern |
|---|---|
| Library `/` | page-header; stats row; list of passages grouped by P1/P2/P3 (`.list` + group titles); primary CTA "套题模式" `btn-primary`, "无尽模式" `btn-secondary` |
| Compose `/writing` | keep left-prompt / right-essay; prompt in `.card`; textarea raised + large; footer bar with word count + primary submit |
| Topics `/topics` | workspace has-rail: rail = filters (`.field` + `.select`), body = scroll-region `.list`; row delete = `btn-danger-ghost btn-sm` |
| History `/history` | workspace: sticky toolbar (filters, select, export as btn-secondary/ghost), scroll-region list grouped by day; empty-state |
| Result `/result` | page-header with band `.t-display`; criteria `.table` or stat row; feedback sections `.section`; essay in `.card` with body-lg |
| Evaluating | centered card, progress track sunken + accent bar, log in scroll-region |
| Notebook | prose column `--anth-prose-max`, week sections `.section.has-rule`, body-lg serif |
| Settings | rail tabs (vertical `.tabs` variant) + panel cards; destructive actions in a dedicated danger zone card |

## 4. Do / Don't

| Do | Don't |
|---|---|
| One h1, one primary button per view | Two filled buttons side by side |
| Use ink-muted for metadata | Use ink-faint (or lighter) for clickable text |
| Separate with rules and spacing inside a card | Nest cards |
| Put long lists in a scroll-region with a sticky toolbar | Let a 300-row list push the toolbar off-screen |
| Serif for headings and prose, sans for controls | Serif in buttons/inputs |
| Tokens only | Literal hex / px colours / shadows in components |
