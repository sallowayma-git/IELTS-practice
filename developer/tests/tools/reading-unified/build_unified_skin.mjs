#!/usr/bin/env node
// Builds apps/writing-vue/src/modules/reading-unified/styles/unified.css from
// two sources:
//   1. the <style> block of assets/generated/reading-exams/reading-practice-unified.html
//      (the maintained opensource reading page; byte-preserved by the data generator),
//   2. developer/tests/tools/reading-unified/runtime-styles.css — the CSS strings that
//      opensource's js/bundles/reading-page.bundle.js injects at runtime via
//      ensure{Explanation,Memorize,ReadingNote,ReadingDisplayControl,OptionConsumed}Styles
//      (extracted once from the opensource branch; that bundle does not exist here).
//
// The page CSS is written for a standalone document: bare html/body/* selectors and
// html-root font scaling. The Vue app embeds it inside one SPA, so every selector is
// re-scoped under a single root class (.runified) and the rem scale is re-anchored to
// a --runified-rem variable that the font-size classes drive. Re-run after syncing a
// newer unified page:
//   node developer/tests/tools/reading-unified/build_unified_skin.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const unifiedHtml = resolve(repoRoot, 'assets/generated/reading-exams/reading-practice-unified.html')
const runtimeStyles = resolve(here, 'runtime-styles.css')
const outFile = resolve(repoRoot, 'apps/writing-vue/src/modules/reading-unified/styles/unified.css')

const html = readFileSync(unifiedHtml, 'utf8')
const pageCss = html.match(/<style>([\s\S]*?)<\/style>/)?.[1]
if (!pageCss) throw new Error('no <style> block found in unified page')
const runtimeCss = readFileSync(runtimeStyles, 'utf8')

// Split a stylesheet into (selector, body, atRule?) chunks. @media blocks are
// recursed; @keyframes bodies are passed through untouched.
function parseRules(css, atHeader = null) {
  const rules = []
  let i = 0
  while (i < css.length) {
    const brace = css.indexOf('{', i)
    if (brace === -1) break
    const head = css.slice(i, brace).trim()
    if (head.startsWith('/*')) {
      // keep comments attached to the next rule
      const end = css.indexOf('*/', i)
      i = end + 2
      continue
    }
    let depth = 1
    let j = brace + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    const body = css.slice(brace + 1, j - 1)
    if (head.startsWith('@media')) {
      rules.push({ selector: head, body, atRule: false, media: true, inner: body })
    } else if (head.startsWith('@')) {
      rules.push({ selector: head, body, atRule: true, inner: null })
    } else {
      rules.push({ selector: head, body, atRule: false, inner: atHeader })
    }
    i = j
  }
  return rules
}

// Re-scope one selector under .runified. Class hooks the runtime toggles on
// <body>/<html> (dark-mode, font-*, hide-reading-*, …) keep their names so the
// bundle-derived CSS and the page CSS stay in lockstep; only the element changes.
function prefixSelector(raw) {
  const sel = raw.trim()
  if (!sel) return null
  if (sel === ':root' || sel === 'html') return '.runified'
  if (sel === 'body') return '.runified'
  if (/^html[.\s>+~]/.test(sel)) return sel.replace(/^html/, '.runified')
  if (/^body[.\s>+~]/.test(sel)) return sel.replace(/^body/, '.runified')
  if (sel === '*') return ['RUNIFIED_SELF', '.runified *']
  return '.runified ' + sel
}

function prefixSelectorList(list) {
  const parts = list.split(',').map(prefixSelector)
  const flat = parts.flat().filter(Boolean)
  const self = flat.includes('RUNIFIED_SELF')
  const rest = flat.filter((s) => s !== 'RUNIFIED_SELF')
  return (self ? ['.runified', ...rest] : rest).join(', ')
}

// The page scales font sizes through the html root (14/16/18/20px). Inside the
// SPA the root element is off limits, so rem values are re-anchored to
// --runified-rem, which the font-size classes redefine on the page root.
function reanchorRem(cssBody) {
  return cssBody.replace(/(\d*\.?\d+)rem\b/g, (_, n) => `calc(${n} * var(--runified-rem))`)
}

function transform(css) {
  const out = []
  for (const rule of parseRules(css)) {
    if (rule.media) {
      const inner = transform(rule.body)
      if (inner.trim()) out.push(`${rule.selector} {\n${indent(inner)}\n}`)
      continue
    }
    if (rule.atRule) {
      out.push(`${rule.selector} { ${rule.body.trim()} }`)
      continue
    }
    const selector = prefixSelectorList(rule.selector)
    if (!selector) continue
    out.push(`${selector} { ${reanchorRem(rule.body).replace(/\s+/g, ' ').trim()} }`)
  }
  return out.join('\n')
}

function indent(text) {
  return text.split('\n').map((line) => '  ' + line).join('\n')
}

const remOverrides = `
/* ---- SPA embedding preamble (added by build_unified_skin.mjs) ----
   The standalone page scaled type via html{font-size}; the SPA root element is
   shared, so the scale is re-anchored here instead. The heading reset undoes
   the host app's global h1..h6 paper theme (serif face + fixed ink), which
   would otherwise punch through the skin: the unified page styles headings
   through inheritance and its own per-context rules. */
.runified {
    --runified-rem: 1rem;
    font-size: 16px;
}
.runified h1, .runified h2, .runified h3,
.runified h4, .runified h5, .runified h6 {
    color: inherit;
    font-family: inherit;
    /* UA default for headings — the original page relies on it wherever it
       does not set a weight itself. */
    font-weight: bold;
    letter-spacing: normal;
}
.runified.font-small { --runified-rem: 0.875rem; }
.runified.font-normal { --runified-rem: 1rem; }
.runified.font-large { --runified-rem: 1.125rem; }
.runified.font-xlarge { --runified-rem: 1.25rem; }
`

// Appended AFTER both source blocks: these must win the cascade over the page
// and runtime rules above (same specificity, later position).
const spaOverrides = `
/* ---- SPA visibility overrides (appended by build_unified_skin.mjs) ----
   The standalone page unhides #selbar and the note badge by setting inline
   display from the bundle; the Vue page drives visibility through reactive
   class/conditional rendering, so the stylesheet defaults need class-based
   escapes that land after the rules they beat. */
.runified #selbar.is-open { display: flex; }
.runified .reading-note-count { display: block; }
`

const banner = `/* GENERATED FILE — do not edit by hand.
   Source: developer/tests/tools/reading-unified/build_unified_skin.mjs
     1. <style> of assets/generated/reading-exams/reading-practice-unified.html
     2. developer/tests/tools/reading-unified/runtime-styles.css (opensource bundle)
   Re-scope root: .runified (dark mode: .runified.dark-mode, font sizes: .runified.font-*) */
`

const css = banner
  + remOverrides + '\n'
  + '/* ===== 1. page stylesheet (unified reading page) ===== */\n'
  + transform(pageCss) + '\n\n'
  + '/* ===== 2. runtime-injected styles (opensource reading-page.bundle.js) ===== */\n'
  + transform(runtimeCss) + '\n'
  + spaOverrides + '\n'

writeFileSync(outFile, css)
const lineCount = css.split('\n').length
console.log(`wrote ${outFile} (${css.length} chars, ${lineCount} lines)`)
