import { computed, ref } from 'vue'
import { jiufen } from '@/api/jiufen.js'

export const connected = ref(false)
export const rows = ref([])
export const libraryError = ref('')
export const syncing = ref(false)
let generation = 0
let pending

export function resetLibrary() {
  generation++
  connected.value = false
  rows.value = []
  syncing.value = false
  libraryError.value = ''
  pending = null
}
export function syncLibrary() {
  if (pending) return pending
  const current = generation
  syncing.value = true
  libraryError.value = ''
  pending = (async () => {
    try {
      const active = await jiufen.restore()
      if (current !== generation) return
      connected.value = active
      if (!active) { rows.value = []; return }
      const cached = await jiufen.library(false)
      if (current !== generation) return
      rows.value = cached
      const fresh = await jiufen.library(true)
      if (current === generation) rows.value = fresh
    } catch (e) {
      if (current !== generation) return
      const active = await jiufen.connected().catch(() => false)
      if (current !== generation) return
      connected.value = active
      libraryError.value = e?.message || String(e)
      if (!active) rows.value = []
      else if (!rows.value.length) {
        const cached = await jiufen.library(false).catch(() => [])
        if (current === generation) rows.value = cached
      }
    } finally {
      if (current === generation) { syncing.value = false; pending = null }
    }
  })()
  return pending
}
export function remoteCards(channel) {
  return computed(() => rows.value.filter(row => row.channel === channel).map(row => ({
    ...row, unitId: row.id, id: `jiufen:${channel}:${row.id}`, provider: 'jiufen',
    activity: channel, category: row.parts.join(' / ') || '未分段', source: '九分学长',
    sourceTags: [...new Set((row.albums || []).map(album => album.title?.trim()).filter(Boolean))],
  })))
}
export async function openNativeUnit(asset) {
  const assetId = await jiufen.openUnit(asset.unitId, asset.activity)
  return { name: asset.activity === 'reading' ? 'PracticeReading' : 'PracticeListening', params: { assetId } }
}
