import { computed, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

export const readerRows = ref([])
export const readerBusy = ref(false)
export const readerError = ref('')
export const readerTrack = ref('a')
export const readerBook = ref(21)
export const readerPage = ref(1)
export const readerTotal = ref(0)
export const readerPageSize = ref(24)
let generation = 0

export function resetReaderLibrary() {
  generation++
  readerRows.value = []
  readerBusy.value = false
  readerError.value = ''
  readerPage.value = 1
  readerTotal.value = 0
}

export async function loadReaderCatalog(page = 1) {
  if (readerBusy.value) return
  const current = ++generation
  readerBusy.value = true
  readerError.value = ''
  readerRows.value = []
  readerTotal.value = 0
  try {
    const result = await idictation.readerCatalog(readerTrack.value, readerBook.value, page)
    if (current !== generation) return
    readerRows.value = result.items
    readerPage.value = result.page
    readerTotal.value = result.total
    readerPageSize.value = result.pageSize
  } catch (error) {
    if (current === generation) readerError.value = error?.message || String(error)
  } finally {
    if (current === generation) readerBusy.value = false
  }
}

export const readerCards = computed(() => readerRows.value.map(row => ({
  ...row, documentId: row.id, id: `idictation:reader:${row.id}`, provider: 'idictation',
  source: '爱听写', activity: 'reading', category: `P${row.part}`, practiceKind: 'material',
  sourceTags: [`剑${row.book} ${row.track.toUpperCase()}类`, `Test ${row.test}`, '精读'],
})))

export async function openReader(asset) {
  const current = generation
  const assetId = await idictation.openReader(asset.documentId)
  if (current !== generation) throw new Error('精读目录已改变，请重新选择文章')
  return { name: 'PracticeReading', params: { assetId } }
}
