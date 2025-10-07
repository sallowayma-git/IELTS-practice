<template>
  <header class="top-bar" data-test="writing-top-bar">
    <div class="top-bar__left">
      <TaskTypeTabs
        :model-value="taskType"
        @update:model-value="value => emit('update:task-type', value)"
        data-test="task-type-tabs"
      />
      <el-divider direction="vertical" class="top-bar__divider" />
      <ModelSelector
        :provider="provider"
        :model="model"
        :provider-options="providerOptions"
        :model-options="modelOptions"
        @update:provider="value => emit('update:provider', value)"
        @update:model="value => emit('update:model', value)"
        data-test="model-selector"
      />
    </div>
    <div class="top-bar__right">
      <SettingsButton data-test="open-settings-button" @click="emit('open-settings')" />
    </div>
  </header>
</template>

<script setup>
import TaskTypeTabs from './TaskTypeTabs.vue'
import ModelSelector from './ModelSelector.vue'
import SettingsButton from './SettingsButton.vue'

defineProps({
  taskType: {
    type: String,
    required: true
  },
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

const emit = defineEmits(['update:task-type', 'update:provider', 'update:model', 'open-settings'])
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.top-bar__left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.top-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.top-bar__divider {
  height: 24px;
  margin: 0;
}
</style>
