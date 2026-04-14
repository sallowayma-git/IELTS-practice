const TASK1_CATEGORY_OPTIONS = Object.freeze([
  Object.freeze({ value: 'bar_chart', label: '柱状图' }),
  Object.freeze({ value: 'pie_chart', label: '饼图' }),
  Object.freeze({ value: 'line_chart', label: '折线图' }),
  Object.freeze({ value: 'flow_chart', label: '流程图' }),
  Object.freeze({ value: 'map', label: '地图' }),
  Object.freeze({ value: 'table', label: '表格' }),
  Object.freeze({ value: 'process', label: '过程' }),
  Object.freeze({ value: 'mixed', label: '混合图' })
])

const TASK2_CATEGORY_OPTIONS = Object.freeze([
  Object.freeze({ value: 'education', label: '教育' }),
  Object.freeze({ value: 'technology', label: '科技' }),
  Object.freeze({ value: 'society', label: '社会' }),
  Object.freeze({ value: 'environment', label: '环境' }),
  Object.freeze({ value: 'health', label: '健康' }),
  Object.freeze({ value: 'culture', label: '文化' }),
  Object.freeze({ value: 'government', label: '政府' }),
  Object.freeze({ value: 'economy', label: '经济' })
])

export const WRITING_CATEGORY_OPTIONS = Object.freeze({
  task1: TASK1_CATEGORY_OPTIONS,
  task2: TASK2_CATEGORY_OPTIONS
})

export const WRITING_CATEGORY_LABELS = Object.freeze(
  Object.fromEntries(
    [...TASK1_CATEGORY_OPTIONS, ...TASK2_CATEGORY_OPTIONS].map((item) => [item.value, item.label])
  )
)

export function getWritingCategoryOptions(taskType) {
  return WRITING_CATEGORY_OPTIONS[taskType] || []
}

export function normalizeWritingCategory(taskType, category) {
  if (!category) return ''
  const nextCategory = String(category)
  return getWritingCategoryOptions(taskType).some((item) => item.value === nextCategory)
    ? nextCategory
    : ''
}

export function getWritingCategoryLabel(category) {
  return WRITING_CATEGORY_LABELS[category] || category
}
