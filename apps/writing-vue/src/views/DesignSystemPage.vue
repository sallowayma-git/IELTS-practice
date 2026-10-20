<template>
  <div class="ds-page">
    <header class="page-header has-rule">
      <div class="page-header-top">
        <p class="page-header-kicker">Dev reference · /dev/design-system</p>
      </div>
      <h1>设计系统 · Design system</h1>
      <p class="page-header-desc">
        Every token and component on the design system, in each variant and state.
        Dev builds only. Source of truth: developer/docs/design-system.md.
      </p>
    </header>

    <section class="section" id="ds-notebook-art">
      <div class="section-head">
        <h2>札记手绘 · Notebook art</h2>
        <span class="section-meta">notebook/art/icons.js · objects.js, crayon</span>
      </div>
      <div v-for="set in notebookArtSets" :key="set.key" class="ds-art-set">
        <h3>{{ set.label }} <span class="t-num">{{ set.names.length }}</span></h3>
        <div class="ds-art-grid">
          <figure v-for="name in set.names" :key="name" class="ds-art-cell">
            <Doodle :name="name" :size="56" />
            <figcaption>{{ name }}</figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section" id="ds-mood-mascots">
      <div class="section-head">
        <h2>情绪角色 · Mood mascots</h2>
        <span class="section-meta">components/mascot/moods.js, MoodMascot.vue</span>
      </div>
      <div class="ds-art-grid">
        <figure v-for="name in MOOD_NAMES" :key="name" class="ds-art-cell">
          <MoodMascot :mood="name" :size="64" />
          <figcaption>{{ name }}</figcaption>
        </figure>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>颜色 · Colour</h2>
        <span class="section-meta">Tokens from tokens.css, .atlas-paper block</span>
      </div>
      <div class="ds-swatches">
        <div v-for="swatch in swatches" :key="swatch" class="ds-swatch">
          <span class="ds-swatch__chip" :style="{ background: `var(--anth-${swatch})` }"></span>
          <span class="ds-swatch__name">--anth-{{ swatch }}</span>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head">
        <h2>字体 · Type scale</h2>
        <span class="section-meta">Serif for headings and prose, sans for controls</span>
      </div>
      <div class="ds-type">
        <div v-for="role in typeRoles" :key="role.name" class="ds-type__row">
          <span class="ds-type__label">{{ role.name }}</span>
          <div :class="role.cls">{{ role.sample }}</div>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head">
        <h2>间距 · Spacing, radius, elevation</h2>
      </div>
      <div class="ds-scale">
        <div v-for="step in spaceSteps" :key="step" class="ds-scale__item">
          <span class="ds-scale__bar" :style="{ width: `var(--anth-space-${step})` }"></span>
          <span class="ds-type__label">space-{{ step }}</span>
        </div>
      </div>
      <div class="ds-scale">
        <div v-for="radius in radii" :key="radius" class="ds-scale__item">
          <span class="ds-scale__box" :style="{ borderRadius: `var(--anth-radius-${radius})` }"></span>
          <span class="ds-type__label">radius-{{ radius }}</span>
        </div>
        <div v-for="shadow in shadows" :key="shadow" class="ds-scale__item">
          <span class="ds-scale__box" :style="{ boxShadow: `var(--anth-shadow-${shadow})` }"></span>
          <span class="ds-type__label">shadow-{{ shadow }}</span>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>按钮 · Button</h2></div>
      <div class="ds-row">
        <button type="button" class="btn btn-primary">Primary</button>
        <button type="button" class="btn">Secondary</button>
        <button type="button" class="btn btn-ghost">Ghost</button>
        <button type="button" class="btn btn-danger">Danger</button>
        <button type="button" class="btn btn-danger-ghost">Danger ghost</button>
        <button type="button" class="btn btn-link">Link</button>
        <button type="button" class="btn btn-icon" aria-label="Icon button">+</button>
      </div>
      <div class="ds-row">
        <button type="button" class="btn btn-primary btn-sm">Small</button>
        <button type="button" class="btn btn-primary">Default</button>
        <button type="button" class="btn btn-primary btn-lg">Large</button>
      </div>
      <div class="ds-row">
        <button type="button" class="btn btn-primary" disabled>Disabled</button>
        <button type="button" class="btn" disabled>Disabled</button>
        <button type="button" class="btn btn-primary is-loading" aria-busy="true">Saving</button>
        <button type="button" class="btn is-loading" aria-busy="true">Loading</button>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>表单 · Inputs</h2></div>
      <div class="ds-grid">
        <label class="field">
          <span class="field-label">Field label</span>
          <input class="input" type="text" placeholder="Placeholder text" />
          <span class="field-help">Helper text in ink-muted.</span>
        </label>
        <label class="field">
          <span class="field-label">Invalid</span>
          <input class="input" type="text" value="Wrong value" aria-invalid="true" />
          <span class="field-error">Error message in danger.</span>
        </label>
        <label class="field">
          <span class="field-label">Disabled</span>
          <input class="input" type="text" value="Read only" disabled />
        </label>
        <label class="field">
          <span class="field-label">Select</span>
          <select class="select">
            <option>Newest first</option>
            <option>Oldest first</option>
          </select>
        </label>
        <label class="field ds-span-2">
          <span class="field-label">Textarea</span>
          <textarea class="textarea" rows="3" placeholder="Essay draft"></textarea>
        </label>
      </div>
      <div class="ds-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input class="input" type="search" placeholder="搜索题目 Search topics" aria-label="Search sample" />
      </div>
      <div class="ds-row">
        <label class="ds-check"><input type="checkbox" checked /> Checkbox</label>
        <label class="ds-check"><input type="radio" name="ds-radio" checked /> Radio</label>
        <label class="ds-check"><input type="radio" name="ds-radio" /> Radio</label>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>分段与标签页 · Segmented and tabs</h2></div>
      <div class="ds-row">
        <div class="segmented" role="group" aria-label="Segmented sample">
          <button type="button" class="segmented-item" aria-pressed="false">Academic</button>
          <button type="button" class="segmented-item" aria-pressed="true">General</button>
          <button type="button" class="segmented-item" aria-pressed="false" disabled>Locked</button>
        </div>
      </div>
      <div class="ds-row">
        <div class="segmented segmented--dark" role="group" aria-label="Dark segmented sample">
          <button type="button" class="segmented-item" aria-pressed="false">全部 All</button>
          <button type="button" class="segmented-item" aria-pressed="true">Task 1</button>
          <button type="button" class="segmented-item" aria-pressed="false">Task 2</button>
        </div>
      </div>
      <div class="tabs" role="tablist">
        <button type="button" class="tab" role="tab" aria-selected="true">Overview</button>
        <button type="button" class="tab" role="tab" aria-selected="false">Attempts</button>
        <button type="button" class="tab" role="tab" aria-selected="false">Notes</button>
      </div>
      <div class="tabs is-vertical" role="tablist" aria-orientation="vertical">
        <button type="button" class="tab" role="tab" aria-selected="true">Account</button>
        <button type="button" class="tab" role="tab" aria-selected="false">Models</button>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>卡片与列表 · Card and list</h2></div>
      <div class="card">
        <div class="panel-header">
          <h3>Panel title</h3>
          <div class="panel-header__actions">
            <button type="button" class="btn btn-ghost btn-sm">Edit</button>
          </div>
        </div>
        <p class="t-body">Cards hold one group. Never nest a card inside a card.</p>
      </div>
      <div class="card is-interactive" tabindex="0">
        <p class="t-body">Interactive card: hover to see the raised surface.</p>
      </div>
      <div class="list">
        <div class="list-group-title">Group · 2026-10</div>
        <div class="list-row">
          <span class="list-row-lead tag tag-accent">P1</span>
          <div class="list-row-main">
            <span class="list-row-title">The science of long-distance memory</span>
            <span class="list-row-meta"><span>Academic</span><span>8 min</span><span>Band 7.5</span></span>
          </div>
          <div class="list-row-trail">
            <button type="button" class="btn btn-danger-ghost btn-sm">Delete</button>
          </div>
        </div>
        <div class="list-row is-selected" aria-selected="true">
          <span class="list-row-lead tag tag-neutral">P2</span>
          <div class="list-row-main">
            <span class="list-row-title">Selected row</span>
            <span class="list-row-meta"><span>Selected</span><span>Clay bar on the left</span></span>
          </div>
          <div class="list-row-trail">
            <button type="button" class="btn btn-sm">Open</button>
          </div>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>内容卡片 · Topic and reading cards</h2><span class="section-meta">Static replicas: the real cards are scoped to their views</span></div>
      <div class="ds-card-demo">
        <article class="ds-topic-card">
          <div class="ds-card-body">
            <div class="ds-card-top">
              <div class="ds-row">
                <span class="tag tag-accent">Task 2</span>
                <span class="tag tag-neutral">Education</span>
              </div>
              <span class="ds-dots" role="img" aria-label="难度 3/5">
                <i class="is-filled"></i><i class="is-filled"></i><i class="is-filled"></i><i></i><i></i>
              </span>
            </div>
            <p class="ds-card-title">Some people think children should learn a foreign language at school. Do you agree?</p>
          </div>
          <footer class="ds-card-footer">
            <span>练过 12 次</span>
            <div class="ds-row">
              <button type="button" class="btn btn-primary btn-sm">开始写作</button>
              <button type="button" class="btn btn-ghost btn-sm">编辑</button>
            </div>
          </footer>
        </article>
        <article class="ds-reading-card">
          <div class="ds-card-body">
            <div class="ds-row">
              <span class="tag tag-neutral">Academic</span>
              <span class="tag tag-info">PDF</span>
            </div>
            <h4 class="ds-card-title">The science of long-distance memory</h4>
            <div class="ds-kinds">
              <span class="tag tag-outline">T / F / NG</span>
              <span class="tag tag-outline">Matching</span>
            </div>
          </div>
          <footer class="ds-card-footer">
            <span>Band 7.5 · 8 min</span>
            <button type="button" class="btn btn-primary btn-sm">查看 PDF</button>
          </footer>
        </article>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>统计与表格 · Stat and table</h2></div>
      <div class="ds-row ds-stats">
        <div class="stat">
          <span class="stat-label">Average band</span>
          <span class="stat-value">7.0</span>
          <span class="stat-delta is-up">+0.5 this month</span>
        </div>
        <div class="stat">
          <span class="stat-label">Essays</span>
          <span class="stat-value">24</span>
          <span class="stat-delta is-down">-2 vs last</span>
        </div>
        <div class="stat">
          <span class="stat-label">Streak</span>
          <span class="stat-value">6</span>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Criterion</th><th class="num">Band</th><th>Note</th></tr>
        </thead>
        <tbody>
          <tr><td>Task response</td><td class="num">7.0</td><td>Clear position</td></tr>
          <tr><td>Coherence</td><td class="num">6.5</td><td>Link devices</td></tr>
        </tbody>
      </table>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>标签与提示 · Tags and messages</h2></div>
      <div class="ds-row">
        <span class="tag tag-neutral">Neutral</span>
        <span class="tag tag-accent">Accent</span>
        <span class="tag tag-success">Success</span>
        <span class="tag tag-warning">Warning</span>
        <span class="tag tag-danger">Danger</span>
        <span class="tag tag-info">Info</span>
        <span class="tag tag-primary">Primary chip</span>
        <span class="tag tag-neutral">Default chip</span>
        <span class="tag tag-outline">Outline chip</span>
      </div>
      <div class="ds-grid">
        <div class="inline-message inline-message-info"><span class="inline-message__icon" aria-hidden="true">i</span>Info: a note about the current view.</div>
        <div class="inline-message inline-message-success"><span class="inline-message__icon" aria-hidden="true">✓</span>Success: the change was saved.</div>
        <div class="inline-message inline-message-warning"><span class="inline-message__icon" aria-hidden="true">!</span>Warning: this action cannot be undone.</div>
        <div class="inline-message inline-message-error"><span class="inline-message__icon" aria-hidden="true">×</span>Error: the request failed.</div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>对话框 · Dialog</h2><span class="section-meta">Shown inline; real dialogs use .dialog-overlay</span></div>
      <div class="dialog dialog-sm ds-dialog-demo">
        <div class="dialog-header">
          <h3>Delete this record?</h3>
          <button type="button" class="btn btn-icon btn-sm" aria-label="Close">×</button>
        </div>
        <div class="dialog-body">
          <p class="t-body">This removes the essay and its feedback. You cannot restore it.</p>
        </div>
        <div class="dialog-footer">
          <button type="button" class="btn">Cancel</button>
          <button type="button" class="btn btn-danger">Delete</button>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>空状态 · Empty state</h2></div>
      <div class="card">
        <div class="empty-state">
          <span class="empty-state-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg>
          </span>
          <h3>No essays yet</h3>
          <p class="empty-state-desc">Submit a writing task and it appears here with its band.</p>
          <div class="empty-state-action">
            <button type="button" class="btn btn-primary">Start a task</button>
          </div>
        </div>
      </div>
    </section>

    <section class="section has-rule">
      <div class="section-head"><h2>工作区 · Scroll region</h2></div>
      <div class="ds-scroll-demo">
        <div class="toolbar is-sticky">
          <button type="button" class="btn btn-ghost btn-sm">Filter</button>
          <button type="button" class="btn btn-sm">Export</button>
        </div>
        <div class="scroll-region ds-scroll-demo__body">
          <div v-for="n in 12" :key="n" class="list-row">
            <span class="list-row-title">Row {{ n }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import Doodle from '@/modules/notebook/components/Doodle.vue'
import MoodMascot from '@/components/mascot/MoodMascot.vue'
import { MOOD_NAMES } from '@/components/mascot/moods.js'
import { ICON_NAMES, OBJECT_NAMES } from '@/modules/notebook/doodles.js'

const notebookArtSets = [
  { key: 'icons', label: 'Icons', names: ICON_NAMES },
  { key: 'objects', label: 'Objects', names: OBJECT_NAMES }
]
const swatches = [
  'canvas', 'surface', 'surface-raised', 'surface-sunken',
  'ink', 'ink-soft', 'ink-muted', 'ink-faint',
  'rule', 'rule-strong', 'rule-ink',
  'accent', 'accent-hover', 'accent-press', 'accent-soft', 'accent-subtle', 'accent-ink',
  'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'info', 'info-soft'
]

const typeRoles = [
  { name: 'display', cls: 't-display', sample: '雅思写作 IELTS 34/42' },
  { name: 'h1', cls: 't-h1', sample: '页面标题 Page title 28/36' },
  { name: 'h2', cls: 't-h2', sample: '章节标题 Section title 21/28' },
  { name: 'h3', cls: 't-h3', sample: '卡片标题 Card title 16/24' },
  { name: 'body-lg', cls: 't-body-lg', sample: '长文阅读 Long-form reading 16/27' },
  { name: 'body', cls: 't-body', sample: '默认界面文字 Default UI text 14/22' },
  { name: 'small', cls: 't-small', sample: '元数据与辅助说明 Metadata 13/20' },
  { name: 'caption', cls: 't-caption', sample: 'Table header caption 11.5/16' },
  { name: 'stat', cls: 't-stat', sample: '7.5 30/34' }
]

const spaceSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const radii = ['xs', 'sm', 'md', 'lg']
const shadows = ['1', '2']
</script>

<style scoped>
.ds-page {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-6);
  padding-bottom: var(--anth-space-9);
}

.ds-art-set {
  display: grid;
  gap: var(--anth-space-3);
  margin-bottom: var(--anth-space-5);
}

.ds-art-set h3 {
  margin: 0;
}

.ds-art-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--anth-space-3);
}

.ds-art-cell {
  margin: 0;
  padding: var(--anth-space-3);
  display: grid;
  justify-items: center;
  gap: var(--anth-space-2);
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-sm);
}

.ds-art-cell figcaption {
  font-size: var(--anth-text-small-size);
  color: var(--anth-ink-muted);
}

.ds-swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: var(--anth-space-3);
}

.ds-swatch {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-1);
}

.ds-swatch__chip {
  height: 40px;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-sm);
}

.ds-swatch__name,
.ds-type__label {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  font-variant-numeric: tabular-nums;
}

.ds-type {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-3);
}

.ds-type__row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: baseline;
  gap: var(--anth-space-3);
}

.ds-scale {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--anth-space-5);
}

.ds-scale__item {
  display: flex;
  flex-direction: column;
  gap: var(--anth-space-1);
}

.ds-scale__bar {
  display: block;
  height: 12px;
  background: var(--anth-accent-soft);
  border-radius: var(--anth-radius-xs);
}

.ds-scale__box {
  display: block;
  width: 64px;
  height: 48px;
  border: 1px solid var(--anth-rule);
  background: var(--anth-surface-raised);
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--anth-space-3);
}

.ds-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--anth-space-4);
}

.ds-span-2 {
  grid-column: 1 / -1;
}

.ds-check {
  display: inline-flex;
  align-items: center;
  gap: var(--anth-space-2);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}

.ds-stats {
  align-items: stretch;
  gap: 0;
}

.ds-dialog-demo {
  max-width: 100%;
}

.ds-scroll-demo {
  display: flex;
  flex-direction: column;
  height: 240px;
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-md);
  background: var(--anth-surface);
  overflow: hidden;
}

.ds-scroll-demo__body {
  flex: 1 1 auto;
}

.ds-search {
  position: relative;
  max-width: 360px;
}

.ds-search svg {
  position: absolute;
  top: 50%;
  left: 12px;
  width: 16px;
  height: 16px;
  color: var(--anth-ink-faint);
  transform: translateY(-50%);
  pointer-events: none;
}

.ds-search .input {
  padding-left: 36px;
}

.ds-card-demo {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--anth-space-4);
}

.ds-topic-card,
.ds-reading-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--anth-card-border);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-raised);
  box-shadow: var(--anth-shadow-1);
  transition: transform var(--anth-duration-fast) var(--anth-ease), box-shadow var(--anth-duration-fast) var(--anth-ease);
}

.ds-topic-card:hover,
.ds-reading-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--anth-shadow-lift);
}

.ds-card-body {
  display: grid;
  gap: var(--anth-space-3);
  padding: var(--anth-space-4);
}

.ds-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-2);
}

.ds-card-title {
  margin: 0;
  color: var(--anth-ink);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  font-weight: var(--anth-weight-medium);
  line-height: var(--anth-text-body-lg-line);
}

.ds-card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-2) var(--anth-space-3);
  margin-top: auto;
  padding: var(--anth-space-3) var(--anth-space-4);
  border-top: 1px solid var(--anth-rule);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.ds-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: var(--anth-space-2);
}

.ds-dots {
  display: inline-flex;
  gap: 4px;
}

.ds-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--anth-surface-sunken);
}

.ds-dots i.is-filled {
  background: var(--anth-accent);
}
</style>
