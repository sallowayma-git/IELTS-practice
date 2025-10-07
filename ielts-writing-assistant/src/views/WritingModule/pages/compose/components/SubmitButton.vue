<template>
  <el-button
    type="primary"
    size="large"
    :loading="loading"
    :disabled="disabled"
    @click="$emit('click')"
    v-bind="$attrs"
  >
    <slot />
  </el-button>
</template>

<script setup>
defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped>
.el-button {
  padding: 0 32px;
}
</style>
