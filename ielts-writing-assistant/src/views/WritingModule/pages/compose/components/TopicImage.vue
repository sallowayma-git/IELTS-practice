<template>
  <div class="topic-image" v-bind="$attrs">
    <img v-if="src" :src="src" alt="题目配图" />
    <el-empty v-else description="暂无配图" />
  </div>
</template>

<script setup>
defineProps({
  src: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.topic-image {
  border-radius: 12px;
  overflow: hidden;
  border: 1px dashed #dcdfe6;
  min-height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
}

.topic-image img {
  width: 100%;
  display: block;
}
</style>
