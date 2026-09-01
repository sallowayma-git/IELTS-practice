/**
 * Phase 9: lightweight windowed list for large history/library collections.
 * Caller supplies total height math; this only virtualizes row windows.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export function useVirtualWindow(options = {}) {
  const itemCount = computed(() => Math.max(0, Number(options.itemCount?.value ?? options.itemCount ?? 0)))
  const itemHeight = computed(() => Math.max(1, Number(options.itemHeight?.value ?? options.itemHeight ?? 48)))
  const overscan = computed(() => Math.max(0, Number(options.overscan?.value ?? options.overscan ?? 6)))
  const viewportHeight = ref(Number(options.viewportHeight ?? 480))
  const scrollTop = ref(0)
  const rootEl = ref(null)

  const totalHeight = computed(() => itemCount.value * itemHeight.value)
  const startIndex = computed(() => {
    const raw = Math.floor(scrollTop.value / itemHeight.value) - overscan.value
    return Math.max(0, raw)
  })
  const visibleCount = computed(() => Math.ceil(viewportHeight.value / itemHeight.value) + overscan.value * 2)
  const endIndex = computed(() => Math.min(itemCount.value, startIndex.value + visibleCount.value))
  const offsetY = computed(() => startIndex.value * itemHeight.value)

  function onScroll(event) {
    const target = event?.target
    if (!target) return
    scrollTop.value = target.scrollTop || 0
    viewportHeight.value = target.clientHeight || viewportHeight.value
  }

  function scrollToIndex(index) {
    if (!rootEl.value) return
    const top = Math.max(0, Math.min(itemCount.value - 1, index)) * itemHeight.value
    rootEl.value.scrollTop = top
    scrollTop.value = top
  }

  function bind(el) {
    rootEl.value = el
    if (!el) return
    viewportHeight.value = el.clientHeight || viewportHeight.value
    el.addEventListener('scroll', onScroll, { passive: true })
  }

  function unbind() {
    if (rootEl.value) {
      rootEl.value.removeEventListener('scroll', onScroll)
    }
    rootEl.value = null
  }

  onBeforeUnmount(unbind)

  watch(itemCount, () => {
    if (scrollTop.value > totalHeight.value) {
      scrollTop.value = Math.max(0, totalHeight.value - viewportHeight.value)
      if (rootEl.value) rootEl.value.scrollTop = scrollTop.value
    }
  })

  return {
    rootEl,
    bind,
    unbind,
    onScroll,
    scrollToIndex,
    totalHeight,
    startIndex,
    endIndex,
    offsetY,
    viewportHeight,
    scrollTop,
    slice(items) {
      const list = Array.isArray(items) ? items : []
      return list.slice(startIndex.value, endIndex.value)
    }
  }
}

/**
 * Performance budget constants (ms). Used for diagnostics, not hard failures in UI.
 */
export const PERFORMANCE_BUDGETS_MS = Object.freeze({
  coldStartInteractive: 2500,
  warmStartInteractive: 1200,
  libraryFirstPaint: 500,
  answerLocalSave: 50,
  historyFirstPage: 500,
  resultOpen: 300,
  evaluationUiLatency: 100
})

export function measureBudget(label, budgetMs, startedAt = performance.now()) {
  const elapsed = Math.max(0, performance.now() - startedAt)
  const ok = elapsed <= budgetMs
  if (!ok && typeof console !== 'undefined') {
    console.warn(`[perf-budget] ${label}: ${elapsed.toFixed(1)}ms > ${budgetMs}ms`)
  }
  return { label, elapsed, budgetMs, ok }
}

export default useVirtualWindow
