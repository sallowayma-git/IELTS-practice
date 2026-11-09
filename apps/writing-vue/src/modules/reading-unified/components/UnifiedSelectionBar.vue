<template>
  <!-- Selection toolbar over the passage: mirrors #selbar (Note / Remove /
       Highlight). mousedown is swallowed so the text selection survives. -->
  <div
    id="selbar"
    :class="{ 'is-open': visible }"
    :style="position"
    @mousedown.prevent="$emit('hold', true)"
    @mouseup="$emit('hold', false)"
  >
    <button type="button" id="btnNote" data-role="note" @click="$emit('note')">Note</button>
    <button type="button" id="btnUH" data-role="remove-highlight" @click="$emit('remove')">Remove</button>
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
defineProps({
  visible: { type: Boolean, default: false },
  position: { type: Object, default: () => ({}) },
  canAskCoach: { type: Boolean, default: false }
})

defineEmits(['hold', 'note', 'remove', 'highlight', 'ask-coach'])
</script>
