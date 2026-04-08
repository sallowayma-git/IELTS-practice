---
name: liquid-glass
description: Apple Liquid Glass design system. Use when building UI with translucent, depth-aware glass morphism following Apple's design language. Provides CSS tokens, component patterns, dark/light mode, and animation specs.
license: MIT
user-invocable: false
disable-model-invocation: false
---

# Liquid Glass Design System

Apple-inspired translucent glass UI with depth, refraction, and ambient light response.

## Core Principles

1. **Translucency** — Surfaces reveal layered content beneath via backdrop blur
2. **Depth** — Elements float on distinct z-layers with realistic shadows
3. **Ambient Response** — Glass tints shift based on underlying content color
4. **Minimal Chrome** — Borders are subtle; shape and blur define boundaries
5. **Motion** — Transitions feel physical: spring-based, with inertia

## Usage

Import the token file in your CSS:

```css
@import 'references/tokens.css';
```

## CSS Tokens Reference

All tokens are defined in `references/tokens.css`. Key categories:

| Category | Prefix | Example |
|---|---|---|
| Glass backgrounds | `--lg-bg-*` | `--lg-bg-primary` |
| Blur | `--lg-blur-*` | `--lg-blur-md` |
| Borders | `--lg-border-*` | `--lg-border-color` |
| Shadows | `--lg-shadow-*` | `--lg-shadow-elevated` |
| Radius | `--lg-radius-*` | `--lg-radius-lg` |
| Animation | `--lg-duration-*` | `--lg-duration-normal` |

## Component Patterns

### Glass Card

```css
.glass-card {
  background: var(--lg-bg-primary);
  backdrop-filter: blur(var(--lg-blur-md));
  -webkit-backdrop-filter: blur(var(--lg-blur-md));
  border: 1px solid var(--lg-border-color);
  border-radius: var(--lg-radius-lg);
  box-shadow: var(--lg-shadow-elevated);
  transition: transform var(--lg-duration-normal) var(--lg-easing-spring);
}

.glass-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--lg-shadow-high);
}
```

### Glass Toolbar

```css
.glass-toolbar {
  background: var(--lg-bg-toolbar);
  backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-lg)) saturate(var(--lg-saturate));
  border-bottom: 1px solid var(--lg-border-subtle);
}
```

### Glass Button

```css
.glass-btn {
  background: var(--lg-bg-interactive);
  backdrop-filter: blur(var(--lg-blur-sm));
  border: 1px solid var(--lg-border-color);
  border-radius: var(--lg-radius-md);
  transition: all var(--lg-duration-fast) var(--lg-easing-spring);
}

.glass-btn:active {
  transform: scale(0.97);
  background: var(--lg-bg-pressed);
}
```

### Glass Modal Overlay

```css
.glass-overlay {
  background: var(--lg-bg-scrim);
  backdrop-filter: blur(var(--lg-blur-xl));
}

.glass-modal {
  background: var(--lg-bg-elevated);
  border: 1px solid var(--lg-border-color);
  border-radius: var(--lg-radius-xl);
  box-shadow: var(--lg-shadow-high);
}
```

## Dark / Light Mode

Tokens auto-switch via `prefers-color-scheme`. Light mode uses white-tinted glass; dark mode uses dark-tinted glass with higher blur to maintain readability.

```css
/* Force a mode on a subtree */
.light-glass { color-scheme: light; }
.dark-glass  { color-scheme: dark; }
```

## Animations

Use spring-based easing for physical feel:

```css
/* Entry */
@keyframes glass-enter {
  from { opacity: 0; transform: scale(0.95) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.glass-animate-in {
  animation: glass-enter var(--lg-duration-normal) var(--lg-easing-spring) both;
}
```

## Accessibility

- Ensure `contrast-ratio ≥ 4.5:1` for text over glass surfaces
- Respect `prefers-reduced-motion` — disable blur animations, use opacity-only transitions
- Provide `prefers-contrast: high` overrides that replace translucent backgrounds with solid ones
