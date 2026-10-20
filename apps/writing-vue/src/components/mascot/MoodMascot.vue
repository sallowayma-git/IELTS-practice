<template>
  <span
    ref="root"
    class="mood-mascot"
    role="img"
    tabindex="0"
    :aria-label="label || moodName"
    :style="{ width: `${size}px`, height: `${size}px` }"
    @click="play"
    @keydown.enter.prevent="play"
    @keydown.space.prevent="play"
  >
    <svg class="mood-mascot__svg" viewBox="0 0 64 64" aria-hidden="true" filter="url(#crayon-wax-soft)" v-html="markup" />
    <span class="mood-mascot__tip" aria-hidden="true">{{ tooltip }}</span>
  </span>
</template>

<script setup>
import { computed, ref } from 'vue'
import { MOODS, MOOD_NAMES, MOOD_LABELS } from './moods.js'
import { crayonize } from '../../modules/notebook/crayon.js'

const props = defineProps({
  mood: { type: String, required: true },
  size: { type: Number, default: 64 },
  label: { type: String, default: '' }
})

const root = ref(null)

const moodName = computed(() => props.mood.charAt(0).toUpperCase() + props.mood.slice(1))
const tooltip = computed(() => (MOOD_LABELS[props.mood] ? `${moodName.value} · ${MOOD_LABELS[props.mood]}` : moodName.value))

// The first element of every mood source is its body; the rest are face features.
const BODY_RE = /^\s*<[^>]*\/>/

function splitParts(source) {
  const match = BODY_RE.exec(source)
  if (!match) return { body: source, face: '' }
  return { body: match[0], face: source.slice(match[0].length) }
}

const markup = computed(() => {
  const source = MOODS[props.mood] || MOODS[MOOD_NAMES[0]]
  const { body, face } = splitParts(source)
  const seed = props.mood
  return `<g class="mood-body">${crayonize(body, { seed, intensity: 'soft' })}</g>`
    + `<g class="mood-face">${crayonize(face, { seed, intensity: 'soft' })}</g>`
})

/** Restart the wobble + grin on every click, including while one is running. */
function play() {
  const el = root.value
  if (!el) return
  el.classList.remove('is-playing')
  void el.offsetWidth
  el.classList.add('is-playing')
}
</script>

<style scoped>
.mood-mascot {
  position: relative;
  display: inline-block;
  flex: none;
  vertical-align: middle;
  border-radius: var(--anth-radius-pill);
  cursor: pointer;
  outline: none;
}

.mood-mascot:focus-visible {
  box-shadow: 0 0 0 2px var(--anth-accent, #C75B2D);
}

.mood-mascot__svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* Tooltip: ink chip above the mascot, fades in on hover or keyboard focus. */
.mood-mascot__tip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 20;
  padding: 4px 8px;
  border-radius: var(--anth-radius-md);
  background: var(--anth-ink);
  color: var(--anth-paper, #FFFDF8);
  font: 500 12px/1.2 var(--anth-font-sans);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, 2px);
  transition: opacity 120ms var(--anth-ease), transform 120ms var(--anth-ease);
}

.mood-mascot__tip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -4px;
  border: 4px solid transparent;
  border-top-color: var(--anth-ink);
}

.mood-mascot:hover .mood-mascot__tip,
.mood-mascot:focus-visible .mood-mascot__tip {
  opacity: 1;
  transform: translate(-50%, 0);
}

/* Squash-and-stretch wobble on the body; grin on the face. ~600ms. */
/* Body/face groups come from v-html, so they need :deep() to escape scoping. */
.mood-mascot.is-playing :deep(.mood-body) {
  animation: mood-wobble 600ms var(--anth-ease) both;
}

.mood-mascot.is-playing :deep(.mood-face) {
  animation: mood-grin 600ms var(--anth-ease) both;
}

:deep(.mood-body),
:deep(.mood-face) {
  transform-box: view-box;
}

:deep(.mood-body) { transform-origin: 32px 32px; }
:deep(.mood-face) { transform-origin: 32px 36px; }

@keyframes mood-wobble {
  0%   { transform: rotate(0deg) scale(1, 1); }
  25%  { transform: rotate(-8deg) scale(1.03, 0.92); }
  50%  { transform: rotate(6deg) scale(0.98, 1.06); }
  75%  { transform: rotate(-3deg) scale(1, 0.98); }
  100% { transform: rotate(0deg) scale(1, 1); }
}

@keyframes mood-grin {
  0%   { transform: scale(1, 1); }
  35%  { transform: scale(1.1, 1.25); }
  100% { transform: scale(1, 1); }
}

@media (prefers-reduced-motion: reduce) {
  .mood-mascot.is-playing :deep(.mood-body),
  .mood-mascot.is-playing :deep(.mood-face) {
    animation: none;
  }
  .mood-mascot__tip {
    transition: opacity 120ms linear;
    transform: translate(-50%, 0);
  }
}
</style>
