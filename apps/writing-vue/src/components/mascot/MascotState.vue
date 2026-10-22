<template>
  <div class="empty-state mascot-state" role="status">
    <MoodMascot class="mascot-state__mascot" :mood="mood" :size="96" :label="title" />
    <h3 v-if="title">{{ title }}</h3>
    <p v-if="desc" class="empty-state-desc">{{ desc }}</p>
    <slot />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import MoodMascot from './MoodMascot.vue'
import { emptyMood } from './moodFor.js'

const props = defineProps({
  kind: { type: String, required: true },
  title: { type: String, default: '' },
  desc: { type: String, default: '' }
})

const mood = computed(() => emptyMood(props.kind))
</script>

<style scoped>
.mascot-state__mascot {
  margin-bottom: var(--anth-space-1);
}
</style>
