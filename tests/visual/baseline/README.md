# Visual Baseline Capture Contract

Phase 0 freezes the viewport matrix and page list. Binary screenshots are deferred until Playwright Python is available.

## Viewports

- `1440x960` desktop
- `1024x720` compact desktop
- `390x844` narrow

## Pages

- overview (`/`)
- reading library (`/?view=browse` and future `/reading/library`)
- writing compose
- history
- settings
- reading attempt chrome (immersive top bar hidden)

## Naming

```text
{page}__{viewport}.png
```

Example: `overview__1440x960.png`

## Status

| asset | status |
|---|---|
| capture script | pending Phase 2 harness |
| PNG baselines | not captured in Phase 0 environment (Playwright Python missing) |
| contract | frozen here and in `docs/rewrite/ux-contract.md` |
