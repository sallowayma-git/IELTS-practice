import { computed, onMounted, ref } from 'vue'
import { listHistoryAll } from '@/api/history-repository.js'
import { toRecord } from '@/modules/history/records.js'
import { buildDashboard } from './dashboardCore.js'

/** One full-history load; every overview number derives from it. */
export function useDashboard() {
  const records = ref([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref('')
  const now = ref(new Date())
  const dashboard = computed(() => buildDashboard(records.value, now.value))

  async function load() {
    loading.value = true
    error.value = ''
    try {
      // The streak and this week's count span the whole history, not just the
      // newest page: listHistory caps at 200, so walk every page first.
      const page = await listHistoryAll({})
      records.value = (page.items || []).map(toRecord)
      loaded.value = true
    } catch (loadError) {
      // Technical detail goes to the console; the learner sees a fixed sentence.
      console.error('读取练习记录失败:', loadError)
      records.value = []
      error.value = '练习记录读取失败'
    } finally {
      now.value = new Date()
      loading.value = false
    }
  }

  onMounted(load)
  return { dashboard, loaded, loading, error, load }
}
