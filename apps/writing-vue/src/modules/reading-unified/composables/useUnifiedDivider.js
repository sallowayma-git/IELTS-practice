/**
 * Pane splitter for the unified reading layout — a port of the opensource
 * attachPaneResizer: the left pane width is written in pixels to
 * --reading-left-pane-width on .shell, clamped so the passage keeps 280px
 * and the questions keep 320px (both shrink proportionally on narrow shells).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const BASE_MIN_LEFT = 280
const BASE_MIN_RIGHT = 320
const MIN_PANE = 220

export function useUnifiedDivider() {
  const shellRef = ref(null)
  const dividerRef = ref(null)
  const dragging = ref(false)
  const valueNow = ref(50)

  function isResizable() {
    const shell = shellRef.value
    const divider = dividerRef.value
    if (!shell || !divider || typeof window === 'undefined') return false
    return window.getComputedStyle(divider).display !== 'none'
      && window.getComputedStyle(shell).display === 'grid'
  }

  function constraints() {
    const shellRect = shellRef.value.getBoundingClientRect()
    const dividerWidth = Math.max(1, Math.round(dividerRef.value.getBoundingClientRect().width || 10))
    const contentWidth = Math.max(0, Math.round(shellRect.width - dividerWidth))
    let minLeft = BASE_MIN_LEFT
    let minRight = BASE_MIN_RIGHT
    if (contentWidth < minLeft + minRight) {
      minLeft = Math.max(MIN_PANE, Math.floor(contentWidth * 0.42))
      minRight = Math.max(0, contentWidth - minLeft)
    }
    return { shellRect, contentWidth, minLeft, maxLeft: Math.max(minLeft, contentWidth - minRight) }
  }

  function applyWidth(leftWidth) {
    if (!isResizable()) return
    const limits = constraints()
    const clamped = Math.max(limits.minLeft, Math.min(limits.maxLeft, Math.round(leftWidth)))
    shellRef.value.style.setProperty('--reading-left-pane-width', `${clamped}px`)
    valueNow.value = Math.max(0, Math.min(100, Math.round((clamped / (limits.contentWidth || 1)) * 100)))
  }

  function leftPaneWidth() {
    return shellRef.value?.querySelector('#left')?.getBoundingClientRect().width || 0
  }

  function handlePointerMove(event) {
    if (!dragging.value || !event) return
    event.preventDefault()
    applyWidth(event.clientX - constraints().shellRect.left)
  }

  function stopDrag(event) {
    if (!dragging.value) return
    dragging.value = false
    removeListeners()
    try {
      if (event) dividerRef.value?.releasePointerCapture?.(event.pointerId)
    } catch (_) {
      // Pointer capture may already be released by the browser.
    }
  }

  function removeListeners() {
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', stopDrag)
    document.removeEventListener('pointercancel', stopDrag)
  }

  function startDrag(event) {
    if (!isResizable() || !event || (Number.isFinite(Number(event.button)) && event.button > 0)) return
    event.preventDefault()
    dragging.value = true
    try {
      dividerRef.value?.setPointerCapture?.(event.pointerId)
    } catch (_) {
      // Pointer capture is progressive enhancement.
    }
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', stopDrag)
    document.addEventListener('pointercancel', stopDrag)
    applyWidth(event.clientX - constraints().shellRect.left)
  }

  function handleKeydown(event) {
    if (!isResizable()) return
    const step = event.shiftKey ? 80 : 32
    const targets = {
      ArrowLeft: () => leftPaneWidth() - step,
      ArrowRight: () => leftPaneWidth() + step,
      Home: () => constraints().contentWidth * 0.36,
      End: () => constraints().contentWidth * 0.64
    }
    if (!targets[event.key]) return
    event.preventDefault()
    applyWidth(targets[event.key]())
  }

  function handleResize() {
    if (isResizable()) applyWidth(leftPaneWidth())
  }

  onMounted(() => window.addEventListener('resize', handleResize))
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
    removeListeners()
  })

  return { shellRef, dividerRef, dragging, valueNow, startDrag, handleKeydown }
}
