import { computed, ref } from 'vue'
import { hasReadingPracticePayload } from './readingAssetCore'
import { libraryFailureMessage } from './libraryFailure'
import { useReadingHistory } from './useReadingHistory'
import { useReadingLibrary } from './useReadingLibrary'

/**
 * Reading library status plus the native archive export/import, for the
 * 设置 → 阅读题库 section. The library index and archives are owned by
 * Rust/SQLite; this only reads them and reports what happened.
 */
export function useReadingDataTools() {
  const { loadReadingAssets } = useReadingLibrary()
  const { exportReadingHistoryArchive, importReadingHistoryArchive } = useReadingHistory()

  const assets = ref([])
  const loadedAt = ref(null)
  const loading = ref(false)
  const busy = ref(false)
  const message = ref({ type: '', text: '' })

  const summary = computed(() => {
    if (!loadedAt.value) return loading.value ? '读取中…' : '尚未读取'
    const html = assets.value.filter(hasReadingPracticePayload).length
    const pdf = assets.value.filter((asset) => Boolean(asset?.pdfOnly)).length
    return `共 ${assets.value.length} 篇 · HTML ${html} · PDF ${pdf} · 最近读取 ${loadedAt.value.toLocaleString()}`
  })

  function report(type, text) {
    message.value = { type, text }
  }

  async function reload() {
    loading.value = true
    try {
      const result = await loadReadingAssets()
      if (!Array.isArray(result?.data)) throw new Error('reading library returned no asset list')
      assets.value = result.data
      loadedAt.value = new Date()
      return true
    } catch (error) {
      console.error('读取阅读题库失败:', error)
      report('error', libraryFailureMessage('阅读题库读取失败', error))
      return false
    } finally {
      loading.value = false
    }
  }

  async function reloadWithNotice() {
    if (await reload()) report('success', '已重新读取本机题库索引')
  }

  async function exportArchive() {
    if (busy.value) return
    busy.value = true
    try {
      const archive = requireReadingArchiveExport(await exportReadingHistoryArchive())
      downloadJsonFile(`ielts-reading-practice-export-${new Date().toISOString().slice(0, 10)}.json`, archive)
      report('success', `阅读记录已导出：${archive.count} 条`)
    } catch (error) {
      console.error('导出阅读记录失败:', error)
      report('error', libraryFailureMessage('导出失败', error))
    } finally {
      busy.value = false
    }
  }

  async function importArchiveFromInput(event) {
    const input = event?.target
    const file = input?.files?.[0]
    if (!file || busy.value) return
    busy.value = true
    try {
      const payload = JSON.parse(await file.text())
      const result = requireCommittedReadingArchiveImport(await importReadingHistoryArchive(payload))
      report('success', `阅读记录导入完成：${result?.imported || result?.importedCount || 0} 条`)
    } catch (error) {
      console.error('导入阅读记录失败:', error)
      report('error', libraryFailureMessage('导入失败', error, '请检查 JSON 文件'))
    } finally {
      busy.value = false
      if (input) input.value = ''
    }
  }

  return { summary, loading, busy, message, reload, reloadWithNotice, exportArchive, importArchiveFromInput }
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function requireReadingArchiveExport(value) {
  const archive = value && typeof value === 'object' ? value : null
  const count = Number(archive?.count)
  if (archive?.activity === 'reading' && Array.isArray(archive.submissions) && Number.isInteger(count) && count === archive.submissions.length) {
    return archive
  }
  const error = new Error('阅读归档导出未返回完整的 Rust 快照')
  error.code = 'reading.archive_export_failed'
  throw error
}

function requireCommittedReadingArchiveImport(result) {
  const failed = Number(result?.failed ?? result?.failedCount ?? 0)
  if (result?.committed === true && failed === 0) return result
  const report = Array.isArray(result?.report) ? result.report : []
  const error = new Error(report[0]?.message || '阅读记录导入未提交，原有数据未修改')
  error.code = 'reading.archive_import_failed'
  error.importResult = result
  throw error
}
