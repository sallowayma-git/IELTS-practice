<template>
  <h2 class="topic-title" v-bind="$attrs">{{ title }}</h2>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.topic-title {
  font-size: 20px;
  font-weight: 600;
  color: #1f2d3d;
  margin: 0;
}
</style>
