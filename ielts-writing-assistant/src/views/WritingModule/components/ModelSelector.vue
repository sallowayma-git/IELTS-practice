<template>
  <div class="model-selector" v-bind="$attrs">
    <div class="model-selector__field">
      <span class="model-selector__label">AI 供应商</span>
      <el-select
        :model-value="provider"
        size="large"
        placeholder="选择供应商"
        @change="value => emit('update:provider', value)"
        data-test="provider-select"
      >
        <el-option
          v-for="item in providerOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        >
          <div class="option-row">
            <span class="option-label">{{ item.label }}</span>
            <span class="option-desc">{{ item.desc }}</span>
          </div>
        </el-option>
      </el-select>
    </div>

    <div class="model-selector__field">
      <span class="model-selector__label">模型</span>
      <el-select
        :model-value="model"
        size="large"
        placeholder="选择模型"
        :disabled="modelOptions.length === 0"
        @change="value => emit('update:model', value)"
        data-test="model-select"
      >
        <el-option
          v-for="item in modelOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        >
          <div class="option-row">
            <span class="option-label">{{ item.label }}</span>
            <span class="option-desc">{{ item.desc }}</span>
          </div>
        </el-option>
      </el-select>
    </div>
  </div>
</template>

<script setup>
defineProps({
  provider: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true
  },
  providerOptions: {
    type: Array,
    default: () => []
  },
  modelOptions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:provider', 'update:model'])
</script>

<style scoped>
.model-selector {
  display: flex;
  align-items: center;
  gap: 16px;
}

.model-selector__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-selector__label {
  font-size: 13px;
  color: #909399;
}

.option-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-label {
  color: #303133;
}

.option-desc {
  color: #909399;
  font-size: 12px;
}
</style>
