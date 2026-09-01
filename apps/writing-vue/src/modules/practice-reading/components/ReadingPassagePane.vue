<template>
  <main id="left" class="pane reading-pane passage-panel">
    <article class="reading-html passage-html">
      <section
        v-for="block in passageBlocks"
        :key="block.blockId"
        class="passage-block"
        v-html="block.html"
      />
    </article>
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
defineProps({
  passageBlocks: { type: Array, default: () => [] },
  officialPassageNotes: { type: Array, default: () => [] }
})
</script>
