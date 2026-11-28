import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

export function useDraftLeaveGuard(flush, changesDraft) {
  onBeforeRouteLeave(flush)
  onBeforeRouteUpdate((to, from) => changesDraft(to, from) ? flush() : undefined)

  let disposed = false
  let unlisten
  let closing = false
  onMounted(async () => {
    if (!isTauri()) return
    try {
      const remove = await getCurrentWindow().onCloseRequested(async event => {
        if (closing) { event.preventDefault(); return }
        closing = true
        try {
          if (await flush() === false) event.preventDefault()
        } catch {
          event.preventDefault()
        } finally {
          closing = false
        }
      })
      if (disposed) remove()
      else unlisten = remove
    } catch (failure) {
      console.warn('无法监听窗口关闭以保存草稿', failure)
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    unlisten?.()
  })
}
