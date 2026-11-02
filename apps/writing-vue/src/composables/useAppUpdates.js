/**
 * Tiered OTA state shared by the settings dialog and the startup prompt.
 *
 * - content: signed question-bank packs, applied live (no restart);
 * - app: signed in-place update (Rust core + frontend + sidecar), restart;
 * - reinstall: the release cannot be applied in place, open a download page.
 */
import { computed, reactive } from 'vue'
import { Channel } from '@tauri-apps/api/core'
import { invokeCommand, isTauriRuntime } from '@/api/tauri-bridge.js'

const STARTUP_DELAY_MS = 8000
const STARTUP_INTERVAL_MS = 6 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'ielts.ota.lastStartupCheck'
/** frontend-preferences key: false turns the background startup check off. */
export const AUTO_CHECK_KEY = 'otaAutoCheck'

const state = reactive({
  checking: false,
  status: null,
  message: '尚未检查更新。',
  app: { installing: false, restarting: false, restartReady: false, downloadedBytes: 0, contentLength: null },
  content: { installing: false, downloadedBytes: 0, totalBytes: 0, results: [] },
  promptVisible: false
})

const appTier = computed(() => state.status?.app?.tier || 'upToDate')
const availableContent = computed(() =>
  (state.status?.content || []).filter((item) => item.state === 'available')
)
const hasActionable = computed(
  () => appTier.value !== 'upToDate' || availableContent.value.length > 0
)
const appProgressPercent = computed(() => percent(state.app.downloadedBytes, state.app.contentLength))
const contentProgressPercent = computed(() => percent(state.content.downloadedBytes, state.content.totalBytes))

function percent(done, total) {
  if (!total) return null
  return Math.min(100, Math.round((Number(done) / Number(total)) * 100))
}

function errorText(error) {
  return error?.message || String(error)
}

async function check() {
  if (state.checking) return state.status
  state.checking = true
  try {
    const status = await invokeCommand('ota_check')
    if (typeof status?.configured !== 'boolean') throw new Error('更新服务返回了无法识别的结果')
    state.status = status
    state.message = status.message || ''
  } catch (error) {
    state.message = `更新检查失败：${errorText(error)}`
    await fallbackAppCheck()
  } finally {
    state.checking = false
  }
  return state.status
}

/** No channel manifest reachable: still ask the app updater directly. */
async function fallbackAppCheck() {
  try {
    const legacy = await invokeCommand('check_for_updates')
    if (!legacy?.updateAvailable) return
    state.status = {
      configured: true,
      currentVersion: legacy.currentVersion,
      app: { tier: 'ota', currentVersion: legacy.currentVersion, latestVersion: legacy.latestVersion, forced: false },
      notes: legacy.body,
      downloadPages: [],
      content: [],
      source: null,
      message: legacy.message
    }
    state.message = legacy.message
  } catch {
    // Keep the original failure message.
  }
}

async function installContent() {
  state.content.installing = true
  state.content.downloadedBytes = 0
  state.content.totalBytes = 0
  const onEvent = new Channel()
  onEvent.onmessage = (event) => {
    state.content.downloadedBytes = Number(event?.downloadedBytes || 0)
    state.content.totalBytes = Number(event?.totalBytes || 0)
    if (event?.message) state.message = event.message
  }
  try {
    const results = await invokeCommand('ota_install_content', { onEvent })
    state.content.results = results || []
    const failed = state.content.results.filter((item) => !item.ok)
    state.message = failed.length
      ? failed.map((item) => item.message).join('；')
      : '题库已更新，无需重启。'
    if (state.content.results.some((item) => item.ok) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ielts:content-updated', { detail: state.content.results }))
    }
    await check()
  } catch (error) {
    state.message = `题库更新失败，已保留当前题库：${errorText(error)}`
  } finally {
    state.content.installing = false
  }
}

async function installApp() {
  state.app.installing = true
  state.app.downloadedBytes = 0
  state.app.contentLength = null
  const onEvent = new Channel()
  onEvent.onmessage = (event) => {
    state.app.downloadedBytes = Number(event?.downloadedBytes || 0)
    state.app.contentLength = event?.contentLength == null ? null : Number(event.contentLength)
    if (event?.message) state.message = event.message
  }
  try {
    const result = await invokeCommand('install_update', { onEvent })
    state.app.restartReady = Boolean(result?.requiresRestart)
    state.message = result?.message || state.message
  } catch (error) {
    state.message = `更新安装失败，当前版本保持不变：${errorText(error)}`
  } finally {
    state.app.installing = false
  }
}

async function restart() {
  state.app.restarting = true
  try {
    await invokeCommand('restart_after_update')
  } catch (error) {
    state.message = `重启失败：${errorText(error)}`
    state.app.restarting = false
  }
}

async function openDownloadPage(index = 0) {
  try {
    await invokeCommand('ota_open_download_page', { index })
  } catch (error) {
    state.message = `无法打开下载页：${errorText(error)}`
  }
}

function readLastCheck() {
  try {
    return Number(window.localStorage.getItem(LAST_CHECK_KEY) || 0)
  } catch {
    return 0
  }
}

function writeLastCheck() {
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()))
  } catch {
    // Private mode: check again next launch.
  }
}

let startupScheduled = false

/** Quiet background check shortly after launch, at most every six hours. */
function scheduleStartupCheck() {
  if (startupScheduled || !isTauriRuntime()) return
  startupScheduled = true
  window.setTimeout(async () => {
    const forcedLastTime = state.status?.app?.forced
    if (!forcedLastTime && Date.now() - readLastCheck() < STARTUP_INTERVAL_MS) return
    try {
      const status = await invokeCommand('ota_check')
      if (typeof status?.configured !== 'boolean') return
      writeLastCheck()
      state.status = status
      state.message = status?.message || ''
      state.promptVisible = hasActionable.value
    } catch {
      // Offline or unconfigured: stay silent at startup.
    }
  }, STARTUP_DELAY_MS)
}

function dismissPrompt() {
  state.promptVisible = false
}

export function useAppUpdates() {
  return {
    state,
    appTier,
    availableContent,
    hasActionable,
    appProgressPercent,
    contentProgressPercent,
    check,
    installContent,
    installApp,
    restart,
    openDownloadPage,
    scheduleStartupCheck,
    dismissPrompt
  }
}
