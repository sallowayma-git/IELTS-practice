<template>
  <Teleport to="body">
    <div v-if="open" class="atlas-paper notebook-sheet-backdrop" @mousedown.self="close">
      <div
        ref="sheetRef"
        class="notebook-sheet"
        :class="`notebook-sheet--${fill}`"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
        data-notebook-sheet
        @keydown.esc="close"
        @keydown.tab="keepFocus"
      >
        <button class="notebook-sheet__close" type="button" aria-label="关闭" @click="close">×</button>

        <header class="notebook-sheet__head">
          <MoodMascot v-if="mood" class="notebook-sheet__doodle" :mood="mood" :size="56" :label="moodLabel" />
          <Doodle v-else class="notebook-sheet__doodle" :name="doodleName" :size="56" />
          <div class="notebook-sheet__headtext">
            <p class="notebook-kicker">{{ kicker }}</p>
            <h2 class="notebook-sheet__title heading-serif">{{ title }}</h2>
          </div>
          <span class="notebook-sheet__numeral">{{ numeral }}</span>
        </header>

        <div class="notebook-sheet__body">
          <slot name="weekly" />
          <section v-if="$slots.observations" class="notebook-sheet__section">
            <h3><span class="notebook-mark" aria-hidden="true">§</span>观察</h3>
            <slot name="observations" />
          </section>

          <section v-if="$slots.reading" class="notebook-sheet__section" data-notebook-reading>
            <h3><span class="notebook-mark" aria-hidden="true">§</span>阅读</h3>
            <slot name="reading" />
          </section>

          <section v-if="$slots.writing" class="notebook-sheet__section" data-notebook-writing>
            <h3><span class="notebook-mark" aria-hidden="true">§</span>写作</h3>
            <slot name="writing" />
          </section>

          <section v-if="$slots.model" class="notebook-sheet__section" data-notebook-model>
            <h3><span class="notebook-mark" aria-hidden="true">§</span>学习模型</h3>
            <slot name="model" />
          </section>

          <section v-if="changeLead || (changes && (changes.improved.length || changes.recurring.length))" class="notebook-sheet__section">
            <h3><span class="notebook-mark" aria-hidden="true">§</span>变化</h3>
            <p v-if="changeLead" class="notebook-prose notebook-lead">{{ changeLead }}</p>
            <dl v-if="changes" class="notebook-changes">
              <div v-if="changes.improved.length">
                <dt>在变好</dt>
                <dd>
                  <span v-for="item in changes.improved" :key="item" class="notebook-pill notebook-pill--mint">{{ item }}</span>
                </dd>
              </div>
              <div v-if="changes.recurring.length">
                <dt>反复出现</dt>
                <dd>
                  <span v-for="item in changes.recurring" :key="item" class="notebook-pill notebook-pill--mustard">{{ item }}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section v-if="$slots.tomorrow" class="notebook-sheet__section" data-notebook-tomorrow>
            <h3><span class="notebook-mark" aria-hidden="true">§</span>行动</h3>
            <slot name="tomorrow" />
          </section>

          <section v-if="nextPractice.length || practiceItems.length" class="notebook-sheet__section" data-notebook-next>
            <h3><span class="notebook-mark" aria-hidden="true">§</span>下一步练习</h3>
            <ul v-if="nextPractice.length" class="notebook-notes">
              <li v-for="line in nextPractice" :key="line"><span>{{ line }}。</span></li>
            </ul>
            <p v-if="practiceLine" class="notebook-prose notebook-lead">{{ practiceLine }}</p>
            <ol v-if="practiceItems.length" class="notebook-practice">
              <li v-for="item in practiceItems" :key="item.id">
                <strong>{{ item.label }}</strong>
                <span v-if="item.why">{{ item.why }}</span>
                <span v-if="item.minutes" class="notebook-practice__time">约 {{ item.minutes }} 分钟</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import MoodMascot from '@/components/mascot/MoodMascot.vue'
import { nextTick, ref, watch } from 'vue'
import Doodle from './Doodle.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  doodleName: { type: String, default: 'open-book' },
  mood: { type: String, default: '' },
  moodLabel: { type: String, default: '' },
  numeral: { type: String, default: '' },
  kicker: { type: String, default: '' },
  title: { type: String, default: '' },
  fill: { type: String, default: 'cream' },
  changeLead: { type: String, default: '' },
  changes: { type: Object, default: null },
  nextPractice: { type: Array, default: () => [] },
  practiceLine: { type: String, default: '' },
  practiceItems: { type: Array, default: () => [] }
})
const emit = defineEmits(['close'])

const sheetRef = ref(null)
let lastFocused = null

function close() {
  emit('close')
}

function keepFocus(event) {
  const nodes = [...sheetRef.value.querySelectorAll('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]')]
    .filter((node) => node.getClientRects().length)
  const first = nodes[0], last = nodes.at(-1)
  if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    lastFocused = document.activeElement
    await nextTick()
    sheetRef.value?.focus()
  } else {
    lastFocused?.focus?.()
  }
})
</script>

<style scoped>
.notebook-sheet-backdrop {
  --nb-ink: #1E1A16;
  --nb-tomato: #E0643A;
  --nb-mustard: #E8B33A;
  --nb-mint: #A8D5BA;
  --nb-pink: #E9B9C4;
  --nb-sky: #9CC3DE;
  --nb-cream: #FFF8EA;
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(30, 26, 22, 0.45);
}

.notebook-sheet {
  position: relative;
  width: 100%;
  max-width: 720px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border: 2.5px solid var(--nb-ink);
  border-radius: 14px;
  background: var(--nb-cream);
  box-shadow: 8px 8px 0 var(--nb-ink);
  animation: notebook-sheet-flip 180ms ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  .notebook-sheet { animation: none; }
}

@keyframes notebook-sheet-flip {
  from { opacity: 0; transform: scale(0.96) rotate(-2deg); }
  to { opacity: 1; transform: scale(1) rotate(0deg); }
}

.notebook-sheet__close {
  position: absolute;
  top: 10px;
  right: 14px;
  border: none;
  background: transparent;
  color: var(--nb-ink);
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.notebook-sheet__head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 24px 56px 20px 24px;
  border-bottom: 2.5px solid var(--nb-ink);
  border-radius: 12px 12px 0 0;
  background: var(--nb-fill);
  color: var(--nb-ink);
}

.notebook-sheet--tomato { --nb-fill: var(--nb-tomato); }
.notebook-sheet--mustard { --nb-fill: var(--nb-mustard); }
.notebook-sheet--mint { --nb-fill: var(--nb-mint); }
.notebook-sheet--pink { --nb-fill: var(--nb-pink); }
.notebook-sheet--sky { --nb-fill: var(--nb-sky); }
.notebook-sheet--cream { --nb-fill: var(--nb-cream); }

.notebook-sheet__headtext { flex: 1 1 auto; min-width: 0; }

.notebook-sheet__title {
  margin: 2px 0 0;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.notebook-sheet__numeral {
  flex: none;
  font-family: var(--anth-font-serif);
  font-size: 40px;
  font-weight: 700;
  line-height: 1;
}

.notebook-sheet__body {
  display: grid;
  gap: 20px;
  padding: 22px 24px 28px;
}

@media (max-width: 600px) {
  .notebook-sheet-backdrop { padding: 12px; }
  .notebook-sheet { max-height: calc(100dvh - 24px); }
  .notebook-sheet__head { display: grid; grid-template-columns: 38px minmax(0, 1fr); padding: 20px 44px 16px 16px; }
  .notebook-sheet__doodle { width: 38px; height: 38px; }
  .notebook-sheet__title { font-size: 22px; }
  .notebook-sheet__numeral { grid-column: 2; font-size: 24px; }
  .notebook-sheet__body { padding: 20px 16px; }
}

.notebook-sheet__section h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--nb-ink);
  font-family: var(--anth-font-serif);
  font-weight: 700;
}
</style>

<style>
/* Shared, unscoped: these classes are also used inside slotted content that
   belongs to NotebookPage's own scope, and inside this sheet's own template,
   which is teleported outside NotebookPage's DOM subtree. One definition
   keeps weekly and daily markup identical with no duplicated rules. */
.notebook-kicker {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nb-ink, #1E1A16);
  opacity: 0.65;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-xs);
}

.notebook-mark {
  color: var(--nb-ink, #1E1A16);
  opacity: 0.6;
}

.notebook-prose,
.notebook-notes,
.notebook-changes,
.notebook-practice {
  max-width: var(--anth-measure);
  margin: 0;
  color: var(--nb-ink, #1E1A16);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-lg-size);
  line-height: var(--anth-text-body-lg-line);
}

.notebook-notes {
  display: grid;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  list-style: none;
}

.notebook-tail { white-space: nowrap; }

.notebook-ref {
  min-width: 1.4em;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: var(--anth-accent-strong);
  font-size: 0.72em;
  line-height: 1;
  vertical-align: super;
  cursor: pointer;
}

.notebook-ref[aria-expanded="true"] {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.notebook-footnote {
  display: grid;
  gap: 4px;
  margin: 6px 0 8px;
  padding-left: 14px;
  border-left: 1px solid var(--nb-ink, #1E1A16);
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
  line-height: var(--anth-leading-normal);
}

.notebook-changes > div {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  gap: 12px;
  margin-top: 4px;
}

.notebook-changes dt {
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}

.notebook-changes dd {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}

.notebook-pill {
  display: inline-block;
  padding: 2px 10px;
  border: 1.5px solid var(--nb-ink, #1E1A16);
  border-radius: 999px;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-xs);
}

.notebook-pill--mint { background: var(--nb-mint, #A8D5BA); }
.notebook-pill--mustard { background: var(--nb-mustard, #E8B33A); }

.notebook-practice {
  display: grid;
  gap: 10px;
  padding-left: 1.4em;
}

.notebook-practice strong {
  display: block;
  font-weight: var(--anth-weight-semibold);
}

.notebook-practice .notebook-practice__time {
  margin-left: 8px;
  color: var(--anth-ink-muted);
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-sm);
}
</style>
