<template>
  <div
    id="suite-mode-selector-modal"
    class="theme-modal suite-mode-selector-modal"
    :class="{ show: suiteModeSelectorOpen }"
    role="dialog"
    aria-modal="true"
    aria-labelledby="suite-mode-selector-title"
    @click.self="$emit('close-suite-mode-selector', $event)"
  >
    <div class="theme-modal-content suite-mode-selector-content">
      <div class="theme-modal-header">
        <div>
          <h3 id="suite-mode-selector-title">选择套题流程</h3>
          <p class="suite-mode-selector-subtitle">本次会话将锁定所选流程，答题中不再切换。</p>
        </div>
        <button
          class="theme-modal-close"
          type="button"
          data-suite-flow-cancel="1"
          aria-label="取消套题流程选择"
          @click="$emit('close-suite-mode-selector', $event)"
        >
          ×
        </button>
      </div>
      <div class="theme-modal-body suite-mode-selector-body">
        <div class="suite-flow-options" aria-label="套题流程">
          <button
            v-for="option in suiteFlowOptions"
            :key="option.value"
            class="suite-flow-option"
            :class="{ active: selectedSuiteFlowMode === option.value }"
            type="button"
            :data-suite-flow-mode="option.value"
            :aria-pressed="selectedSuiteFlowMode === option.value ? 'true' : 'false'"
            @click="$emit('select-suite-flow-mode', option.value, { start: true })"
          >
            <span>{{ option.label }}</span>
            <small>{{ option.description }}</small>
          </button>
        </div>
        <label class="suite-frequency-selector" for="suite-frequency-scope">
          <span>抽题范围</span>
          <select
            id="suite-frequency-scope"
            :value="selectedSuiteFrequencyScope"
            class="suite-frequency-select"
            @change="$emit('update:selectedSuiteFrequencyScope', $event.target.value)"
          >
            <option
              v-for="option in suiteFrequencyOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <div class="suite-mode-selector-actions">
          <button class="btn btn-secondary" type="button" data-suite-flow-cancel="1" @click="$emit('close-suite-mode-selector', $event)">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  suiteModeSelectorOpen: { type: Boolean, default: false },
  suiteFlowOptions: { type: Array, required: true },
  selectedSuiteFlowMode: { type: String, required: true },
  suiteFrequencyOptions: { type: Array, required: true },
  selectedSuiteFrequencyScope: { type: String, required: true }
})

defineEmits([
  'update:selectedSuiteFrequencyScope',
  'close-suite-mode-selector',
  'select-suite-flow-mode'
])
</script>
