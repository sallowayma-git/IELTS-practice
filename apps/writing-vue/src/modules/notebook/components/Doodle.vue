<template>
  <svg
    class="notebook-doodle"
    :style="{ width: `${size}px`, height: `${size}px` }"
    viewBox="0 0 64 64"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    filter="url(#crayon-wax)"
    v-html="markup"
  />
</template>

<script setup>
import { computed } from 'vue'
import { doodleMarkup } from '../doodles.js'
import { crayonize } from '../crayon.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 64 }
})

const markup = computed(() => crayonize(doodleMarkup(props.name), { seed: props.name }))
</script>

<style scoped>
.notebook-doodle {
  display: block;
  color: inherit;
}
</style>
