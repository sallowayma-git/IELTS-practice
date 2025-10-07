<template>
  <div class="topic-filter" v-bind="$attrs">
    <el-form label-width="80px" size="small">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="题目类型">
            <el-select
              v-model="localValue.category"
              placeholder="全部话题"
              @change="emitChange"
              data-test="topic-filter-category"
            >
              <el-option label="全部" value="all" />
              <el-option
                v-for="option in categoryOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="难度系数">
            <el-slider
              v-model="localValue.difficulty"
              range
              :min="1"
              :max="5"
              @change="emitChange"
              data-test="topic-filter-difficulty"
            />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
  </div>
</template>

<script setup>
import { computed, reactive, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({ category: 'all', difficulty: [1, 5] })
  },
  taskType: {
    type: String,
    default: 'task2'
  }
})

const emit = defineEmits(['update:modelValue'])

const localValue = reactive({
  category: props.modelValue.category,
  difficulty: [...props.modelValue.difficulty]
})

const categoryOptions = computed(() => {
  if (props.taskType === 'task1') {
    return [
      { value: 'bar_chart', label: '柱状图' },
      { value: 'line_chart', label: '折线图' },
      { value: 'pie_chart', label: '饼图' },
      { value: 'table', label: '数据表格' },
      { value: 'process', label: '流程图' },
      { value: 'map', label: '地图' }
    ]
  }
  return [
    { value: 'education', label: '教育' },
    { value: 'technology', label: '科技' },
    { value: 'society', label: '社会' },
    { value: 'environment', label: '环境' },
    { value: 'health', label: '健康' },
    { value: 'government', label: '政府' }
  ]
})

watch(
  () => props.modelValue,
  (value) => {
    localValue.category = value.category
    localValue.difficulty = [...value.difficulty]
  },
  { deep: true }
)

const emitChange = () => {
  emit('update:modelValue', {
    category: localValue.category,
    difficulty: [...localValue.difficulty]
  })
}
</script>

<style scoped>
.topic-filter {
  background: #f8f9fb;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
</style>
