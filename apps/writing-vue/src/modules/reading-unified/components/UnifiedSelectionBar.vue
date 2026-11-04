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
  </div>
</template>

<script setup>
defineProps({
  visible: { type: Boolean, default: false },
  position: { type: Object, default: () => ({}) }
})

defineEmits(['hold', 'note', 'remove', 'highlight'])
</script>
