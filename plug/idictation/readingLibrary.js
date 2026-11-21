import { computed, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

const rows = ref([])
export const readingBusy = ref(false)
export const readingError = ref('')
let generation = 0

export function resetReadingLibrary() {
  generation++
  rows.value = []
  readingBusy.value = false
  readingError.value = ''
}

export async function loadReadingCatalog() {
  if (readingBusy.value) return
  const current = ++generation
  readingBusy.value = true
  readingError.value = ''
  try {
    const result = await idictation.readingCatalog()
    if (current === generation) rows.value = result
  } catch (error) {
    if (current === generation) readingError.value = error?.message || String(error)
  } finally {
    if (current === generation) readingBusy.value = false
  }
}

export const examCards = computed(() => rows.value.map(row => ({
  ...row, id: `idictation:reading:${row.testId}`, provider: 'idictation-exam',
  source: '爱听写', activity: 'reading', category: '整套', parts: ['P1', 'P2', 'P3'],
  sourceTags: ['剑雅 A 类'],
})))

export async function openReading(asset) {
  const current = generation
  const assetId = await idictation.openReading(asset.testId)
  if (current !== generation) throw new Error('真题目录已改变，请重新选择套卷')
  return { name: 'PracticeReading', params: { assetId } }
}
