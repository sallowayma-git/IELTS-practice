<template>
  <el-button
    type="primary"
    plain
    :icon="Setting"
    @click="$emit('click')"
    v-bind="$attrs"
  >
    设置
  </el-button>
</template>

<script setup>
import { Setting } from '@element-plus/icons-vue'
</script>

<style scoped>
.el-button {
  display: inline-flex;
  align-items: center;
}
</style>
