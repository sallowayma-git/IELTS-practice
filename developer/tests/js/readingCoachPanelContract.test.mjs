import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

// Coach panel markup, keyboard/focus contract and styles (static checks; the
// behaviour behind them is covered by readingCoachLifecycle.test.mjs).

const readApp = (path) => readFileSync(new URL(`../../../apps/writing-vue/src/${path}`, import.meta.url), 'utf8')

// --- answer text rendering ---

test('coach text splits into text, fenced code, inline code and bold', async () => {
  const { parseCoachText } = await import(new URL('../../../apps/writing-vue/src/modules/practice-reading/coachText.js', import.meta.url))
  const blocks = parseCoachText('先看 `paraphrase` 和 **限定词**\n\n```\nQ7 -> C\n```\n结尾')
  assert.deepEqual(blocks.map((block) => block.type), ['text', 'code', 'text'])
  assert.deepEqual(blocks[0].parts, [
    { kind: 'text', text: '先看 ' }, { kind: 'code', text: 'paraphrase' },
    { kind: 'text', text: ' 和 ' }, { kind: 'strong', text: '限定词' }
  ])
  assert.equal(blocks[1].text, 'Q7 -> C')
  assert.equal(blocks[2].parts[0].text, '结尾')
})

test('an unfinished fence mid-stream is an open code block, and markup stays text', async () => {
  const { parseCoachText } = await import(new URL('../../../apps/writing-vue/src/modules/practice-reading/coachText.js', import.meta.url))
  const open = parseCoachText('intro\n```js\nconst a = 1')
  assert.deepEqual(open.map((block) => block.type), ['text', 'code'])
  assert.equal(open[1].text, 'const a = 1')
  const hostile = parseCoachText('<img src=x onerror=alert(1)> **b**')
  assert.equal(hostile[0].parts[0].text, '<img src=x onerror=alert(1)> ')
  assert.equal(hostile.length, 1)
})

// --- panel and styles ---

test('panel keyboard and focus contract', () => {
  const panel = readApp('modules/practice-reading/components/ReadingCoachPanel.vue')
  assert.ok(panel.includes('<textarea'), 'composer is a textarea so Shift+Enter breaks the line')
  assert.ok(panel.includes('event.isComposing') && panel.includes('229'), 'Enter that confirms an IME candidate must not send')
  assert.ok(panel.includes('event.shiftKey'))
  assert.ok(panel.includes('@keydown.esc.stop'), 'Esc collapses the panel')
  assert.ok(panel.includes(':aria-expanded="readingCoachOpen'), 'the toggle reports its state')
  assert.ok(panel.includes('aria-controls="reading-coach-panel"'))
  assert.ok(!/:disabled="coachLoading"\s*\n\s*@input/.test(panel), 'the box must stay enabled while loading (a disabled field drops focus)')
  assert.ok(!panel.includes('coach-response'), 'the answer is rendered once, from the transcript')
  assert.ok(panel.includes(':aria-busy="coachLoading'), 'the log is busy while a reply streams')
})

test('coach styles follow the Options font size and never use the 44px touch floor', () => {
  const css = readApp('modules/practice-reading/styles/host-extras.css')
  const block = css.slice(css.indexOf('/* ---- AI coach'), css.indexOf('/* ---- results and analysis'))
  assert.ok(block.includes('--coach-px: calc(var(--runified-rem) / 16)'))
  assert.ok(!/min-height:\s*44px/.test(block))
  assert.ok(!/\bfont-size:\s*\d+px/.test(block.replace(/\.reading-coach-panel__close[^}]*\}/, '')),
    'coach text sizes scale with --coach-px')
})
