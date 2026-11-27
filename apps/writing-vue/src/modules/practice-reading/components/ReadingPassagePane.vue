<template>
  <main id="left" ref="pane" class="pane reading-pane passage-panel">
    <p v-if="materialError" data-study-extra role="alert">{{ materialError }} <button type="button" class="btn-text" @click="$emit('retry-material')">重试</button></p>
    <article class="reading-html passage-html" ref="original">
      <section v-for="block in safeBlocks" :key="block.blockId" class="passage-block" v-html="block.html" />
    </article>
    <details v-if="material?.parts?.length" class="reading-html study-translations" data-study-transcript data-study-extra>
      <summary>{{ $slots['sentence-actions'] ? '逐句翻译与收藏' : '逐句翻译' }}</summary>
      <section v-for="part in material.parts" :key="part.id">
        <h2 v-if="part.title">{{ part.title }}</h2>
        <p v-for="paragraph in part.paragraphs" :key="paragraph.id">
          <span v-for="sentence in paragraph.sentences" :key="sentence.id" class="study-sentence"
            :class="{ 'has-actions': Boolean($slots['sentence-actions']), 'is-located': locatedSentences.includes(sentence.id),
              'is-annotated': highlightedSentences.includes(sentence.id) }"
            :data-translated-sentence="sentence.id">
            {{ sentence.text }}{{ ' ' }}
            <span v-if="sentence.translation" class="study-translation">{{ sentence.translation }}</span>
            <slot name="sentence-actions" :sentence="sentence" />
          </span>
        </p>
      </section>
    </details>
    <section
      v-if="officialPassageNotes.length"
      class="reading-explanation-panel reading-passage-explanations"
      data-reading-official-passage-explanations
    >
      <div
        v-for="note in officialPassageNotes"
        :key="note.label + note.text"
        class="reading-explanation-card reading-passage-explanation"
      >
        <div class="reading-explanation-card__label">{{ note.label }}</div>
        <div class="reading-explanation-card__text">{{ note.text }}</div>
      </div>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  passageBlocks: { type: Array, default: () => [] },
  officialPassageNotes: { type: Array, default: () => [] },
  material: { type: Object, default: null },
  materialError: { type: String, default: '' },
  locatedSentences: { type: Array, default: () => [] },
  highlightedSentences: { type: Array, default: () => [] }
})
defineEmits(['retry-material'])
const original = ref(null)
const pane = ref(null)

function readingPosition() {
  if (!pane.value) return null
  const top = pane.value.getBoundingClientRect().top + 40
  const blocks = [...original.value.querySelectorAll('[data-reader-text]')]
  const block = blocks.find(node => node.getBoundingClientRect().bottom > top) || blocks.at(-1)
  if (!block) return null
  const rect = block.getBoundingClientRect()
  const caret = document.caretRangeFromPoint?.(rect.left + 6, Math.max(top, rect.top + 8))
  let textOffset = 0
  if (caret && block.contains(caret.startContainer)) {
    const range = document.createRange()
    range.selectNodeContents(block)
    range.setEnd(caret.startContainer, caret.startOffset)
    textOffset = range.toString().length
  }
  return { blockKey: block.dataset.blockKey, textOffset }
}

function restoreReadingPosition(position) {
  if (!pane.value || !position) return
  const block = [...original.value.querySelectorAll('[data-reader-text]')]
    .find(node => node.dataset.blockKey === position.blockKey)
  if (!block) return
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let remaining = position.textOffset
  let top = block.getBoundingClientRect().top
  while (walker.nextNode()) {
    const text = walker.currentNode
    if (remaining > text.length) { remaining -= text.length; continue }
    const range = document.createRange()
    range.setStart(text, remaining)
    range.collapse(true)
    top = range.getClientRects()[0]?.top ?? top
    break
  }
  pane.value.scrollTop += top - pane.value.getBoundingClientRect().top - 40
}

defineExpose({ readingPosition, restoreReadingPosition })
watch([() => props.locatedSentences, () => props.highlightedSentences, () => props.passageBlocks], async ([ids, highlights]) => {
  await nextTick()
  original.value?.querySelectorAll('[data-study-sentence]').forEach(node => {
    node.classList.toggle('is-located', ids.includes(node.dataset.studySentence))
    node.classList.toggle('is-annotated', highlights.includes(node.dataset.studySentence))
  })
}, { immediate: true })

// Legacy exam exports embed the old standalone page skeleton in the passage
// html — e.g. a trailing `<div id="divider"></div>`. Those ids are owned by
// this app's layout, so `.runified #divider::after` would paint the splitter
// badge (and `#left`/`#right` would pick up pane styles) inside the passage.
// Drop only EMPTY reserved-id elements: real content is never touched.
const RESERVED_LAYOUT_IDS = new Set(['divider', 'left', 'right'])

function stripLegacySkeleton(html) {
  if (typeof html !== 'string' || !/id\s*=/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let removed = false
  doc.body.querySelectorAll('[id]').forEach((el) => {
    // NBSP counts as content; true whitespace-only shells still go.
    if (RESERVED_LAYOUT_IDS.has(el.id) && !el.children.length && !el.textContent.replace(/\u00a0/g, ' ').trim()) {
      el.remove()
      removed = true
    }
  })
  return removed ? doc.body.innerHTML : html
}

const safeBlocks = computed(() =>
  props.passageBlocks.map((block) => ({ ...block, html: stripLegacySkeleton(block.html) }))
)
</script>

<style scoped>
.study-translations { margin-top: 24px; }
.study-translations summary { cursor: pointer; }
.study-translation { display: block; margin: 4px 0 12px; color: var(--muted-ink); font-size: 0.92em; }
.study-sentence:is(.is-located,.is-annotated), :deep([data-study-sentence]:is(.is-located,.is-annotated)) { background: var(--highlight, #fff0a8); }
.study-sentence.has-actions { display: block; margin: .75rem 0; }
</style>
