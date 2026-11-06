<template>
  <template v-for="(block, index) in blocks" :key="index">
    <pre v-if="block.type === 'code'" class="reading-coach-msg__code" tabindex="0"><code>{{ block.text }}</code></pre>
    <div v-else class="reading-coach-msg__text"><template v-for="(part, partIndex) in block.parts" :key="partIndex"><code v-if="part.kind === 'code'">{{ part.text }}</code><strong v-else-if="part.kind === 'strong'">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template></div>
  </template>
</template>

<script setup>
import { computed } from 'vue'
import { parseCoachText } from '../coachText'

const props = defineProps({
  content: { type: String, default: '' }
})

const blocks = computed(() => parseCoachText(props.content))
</script>
