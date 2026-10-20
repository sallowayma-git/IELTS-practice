import { computed, onMounted, ref } from 'vue'
import { listHistory } from '@/api/history-repository.js'
import { toRecord } from '@/modules/history/records.js'
import { buildDashboard } from './dashboardCore.js'

const LOAD_LIMIT = 100

/** One load of the newest records; every overview number derives from it. */
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
      const page = await listHistory({ limit: LOAD_LIMIT })
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
