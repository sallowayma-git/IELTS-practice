/**
 * Dev-only Tauri transport for the browser UI: every command goes to the HTTP
 * mock backend (server.js). No data lives on this side; the backend owns the
 * seeded state, so reloading the page keeps it.
 *
 * Injected only by apps/writing-vue/vite.config.js when VITE_DEV_BACKEND=1.
 * Inside real Tauri (window.__TAURI_INTERNALS__ already present) it does nothing.
 */
function install() {
  const callbacks = new Map()
  let nextCallbackId = 1

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

  async function invoke(cmd, args = {}) {
    let response
    try {
      response = await fetch('/api/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args: args ?? {} }),
      })
    } catch (error) {
      return { ok: false, error: { code: 'dev_backend.unreachable', message: `开发后端不可达：${error?.message || error}`, retryable: true } }
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'dev_backend.http_error', message: `开发后端返回 HTTP ${response.status}`, retryable: true } }
    }
    try {
      return await response.json()
    } catch (error) {
      return { ok: false, error: { code: 'dev_backend.bad_response', message: `开发后端响应不是 JSON：${error?.message || error}`, retryable: false } }
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
  console.info('[dev-backend] active: Tauri commands are served by the HTTP mock backend')
}

if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) {
  install()
}
