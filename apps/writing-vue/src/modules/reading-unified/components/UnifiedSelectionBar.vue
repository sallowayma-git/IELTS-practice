<template>
  <!-- Selection toolbar over the passage: mirrors #selbar (Note / Remove /
       Highlight). mousedown is swallowed so the text selection survives. -->
  <div
    id="selbar"
    :class="{ 'is-open': visible, 'is-above': Boolean(position.isAbove) }"
    :style="barStyle"
    @mousedown.prevent="$emit('hold', true)"
    @mouseup="$emit('hold', false)"
  >
    <button type="button" id="btnNote" data-role="note" @click="$emit('note')">Note</button>
    <!-- Remove only applies when the selection covers an existing highlight/note. -->
    <button v-if="canRemove" type="button" id="btnUH" data-role="remove-highlight" @click="$emit('remove')">Remove</button>
    <button type="button" id="btnHL" data-role="highlight" @click="$emit('highlight')">Highlight</button>
    <button
      v-if="canAskCoach"
      type="button"
      id="btnAskCoach"
      data-role="ask-coach"
      @click="$emit('ask-coach')"
    >问教练</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  position: { type: Object, default: () => ({}) },
  canRemove: { type: Boolean, default: false },
  canAskCoach: { type: Boolean, default: false }
})

// position carries the isAbove flag for the class binding; only top/left are CSS.
const barStyle = computed(() => {
  const { isAbove: _isAbove, ...style } = props.position
  return style
})

defineEmits(['hold', 'note', 'remove', 'highlight', 'ask-coach'])
</script>
