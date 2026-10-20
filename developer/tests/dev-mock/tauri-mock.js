/**
 * Dev-only Tauri mock for the Vue app running in a plain browser.
 *
 * Injected only by apps/writing-vue/vite.config.js when VITE_TAURI_MOCK=1 on
 * the dev server. It is never part of a production build. Inside real Tauri
 * (window.__TAURI_INTERNALS__ already present) it does nothing.
 *
 * Installs the hooks @tauri-apps/api/core uses:
 *   __TAURI_INTERNALS__.invoke(cmd, args)      -> envelope { ok, data | error }
 *   __TAURI_INTERNALS__.transformCallback(fn)  -> id, used by Channel
 *   __TAURI_INTERNALS__.unregisterCallback(id)
 *   __TAURI_INTERNALS__.convertFileSrc(path)
 * and the legacy window.__TAURI__.core.invoke path used by tauri-bridge.js.
 *
 * State is seeded once per page load (seed.js) and lives only in memory.
 */
import { createSeedState } from './seed.js'
import { createHandlers } from './handlers.js'

function install() {
  const callbacks = new Map()
  let nextCallbackId = 1
  const state = createSeedState(Date.now())

  const transformCallback = (callback, once = false) => {
    const id = nextCallbackId
    nextCallbackId += 1
    callbacks.set(id, (payload) => {
      if (once) callbacks.delete(id)
      return callback?.(payload)
    })
    return id
  }

  const unregisterCallback = (id) => {
    callbacks.delete(id)
  }

  // Channel protocol: the backend sends { index, message } and the Channel
  // reorders by index, so the mock sends in order with an increasing index.
  const host = {
    send(channel, index, message) {
      const callback = callbacks.get(channel?.id)
      if (callback) callback({ index, message })
    },
  }

  const handlers = createHandlers(state, host)

  async function invoke(cmd, args = {}) {
    const handler = handlers[cmd]
    if (!handler) {
      console.warn('[dev-mock] unhandled', cmd, args)
      return { ok: false, error: { code: 'dev_mock.unhandled', message: `未实现的模拟命令：${cmd}`, retryable: false } }
    }
    try {
      const data = await handler(args ?? {})
      return { ok: true, data: data === undefined ? null : data }
    } catch (error) {
      if (error?.envelope) return { ok: false, error: error.envelope }
      console.error('[dev-mock] handler crashed', cmd, error)
      return { ok: false, error: { code: 'dev_mock.handler_error', message: String(error?.message || error), retryable: false } }
    }
  }

  const internals = {
    invoke,
    transformCallback,
    unregisterCallback,
    convertFileSrc: (path) => path,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  }

  window.__TAURI_INTERNALS__ = internals
  window.__TAURI__ = { core: { invoke } }
  console.info('[dev-mock] active: Tauri commands are served from developer/tests/dev-mock (in-memory, reset on reload)')
}

if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
  install()
}
