<template>
  <div class="task-type-tabs" v-bind="$attrs">
    <span class="task-type-tabs__label">写作任务</span>
    <el-radio-group
      class="task-type-tabs__group"
      :model-value="modelValue"
      size="large"
      @update:model-value="value => emit('update:modelValue', value)"
      data-test="task-type-group"
    >
      <el-radio-button label="task1" data-test="task-type-tab-task1">Task 1 图表描述</el-radio-button>
      <el-radio-button label="task2" data-test="task-type-tab-task2">Task 2 议论文</el-radio-button>
    </el-radio-group>
  </div>
</template>

<script setup>
defineProps({
  modelValue: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.task-type-tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.task-type-tabs__label {
  font-size: 14px;
  color: #606266;
}
</style>
