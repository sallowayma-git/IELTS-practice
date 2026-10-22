<template>
  <template v-for="(token, index) in tokens" :key="index">
    <button
      v-if="token.tag === 'ref'"
      type="button"
      class="weekly-citation"
      :aria-expanded="selected?.id === token.id"
      @click="select(token)"
    >{{ token.text }}</button>
    <component :is="token.tag" v-else-if="token.inner !== undefined">
      <WeeklyText :text="token.inner" :facts="facts" />
    </component>
    <component :is="token.tag" v-else>{{ token.text }}</component>
  </template>
  <span v-if="selected" class="weekly-source" role="note">依据：{{ sourceLabel(selected) }}</span>
</template>
<script setup>
import { computed, ref } from 'vue'
import { weeklyFactLabel, weeklyTokens } from '../weekly.js'

const props = defineProps({
  text: { type: String, default: '' },
  facts: { type: Object, default: () => ({}) }
})

const tokens = computed(() => weeklyTokens(props.text, props.facts))
const selected = ref(null)

function select(token) {
  selected.value = selected.value?.id === token.id ? null : token
}

// Prefer the fact's own name and provenance words; raw asset ids are a last
// resort only when the fact carries nothing else to name it.
function sourceLabel(fact) {
  const provenance = fact.provenance || {}
  const named = [provenance.date, provenance.title, provenance.task, weeklyFactLabel(fact)].filter(Boolean)
  if (named.length) return named.join(' · ')
  const firstAsset = provenance.assetId || provenance.assetIds?.[0]
  return firstAsset ? String(firstAsset) : '练习记录'
}
</script>
<style scoped>
.weekly-citation {
  padding: 0 2px;
  border: 0;
  border-bottom: 1px solid currentColor;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.weekly-source {
  display: block;
  margin: 8px 0;
  padding: 8px 12px;
  background: #eee4d3;
  font-family: var(--anth-font-sans);
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
