import { computed, ref } from 'vue'
import { idictation } from '@/api/idictation.js'

const rows = ref({ academic: [], jijing: [] })
export const listeningBusy = ref(false)
export const listeningError = ref('')
let generation = 0

export function resetListeningLibrary() {
  generation++
  rows.value = { academic: [], jijing: [] }
  listeningBusy.value = false
  listeningError.value = ''
}

export async function loadListeningCatalog(bank = 'academic') {
  if (listeningBusy.value) return
  const current = ++generation
  listeningBusy.value = true
  listeningError.value = ''
  rows.value[bank] = []
  try {
    const result = await idictation.listeningCatalog(bank)
    if (current === generation) rows.value[bank] = result
  } catch (error) {
    if (current === generation) listeningError.value = error?.message || String(error)
  } finally {
    if (current === generation) listeningBusy.value = false
  }
}

export const listeningExamCards = computed(() => Object.entries(rows.value).flatMap(([bank, cards]) => cards.map(row => ({
  ...row,
  id: `idictation:listening:${bank}:${row.testId}${row.paperId ? ':' + row.paperId : ''}`,
  bank,
  provider: bank === 'jijing' ? 'idictation-jijing' : 'idictation-exam',
  category: row.paperId ? (row.section ? 'P' + row.section : '单 Part') : '整套',
  parts: row.paperId ? (row.section ? ['P' + row.section] : []) : ['P1', 'P2', 'P3', 'P4'],
  sourceTags: [bank === 'jijing' ? '机经听力' : '剑雅 A 类']
}))))

export async function openListening(asset) {
  const current = generation
  const assetId = await idictation.openListening(asset.testId, asset.bank, asset.paperId)
  if (current !== generation) throw new Error('听力目录已改变，请重新选择套卷')
  return { name: 'PracticeListening', params: { assetId } }
}
