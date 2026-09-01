/**
 * Tauri invoke bridge — product path is Tauri only.
 * Electron / Fastify / file:// fallbacks are not supported.
 */

export function isTauriRuntime() {
  return typeof window !== 'undefined' && !!(window.__TAURI_INTERNALS__ || window.__TAURI__)
}

export function assertTauriRuntime(label = 'command') {
  if (!isTauriRuntime()) {
    const err = new Error(
      `${label}: requires Tauri runtime (Electron/Fastify removed; use cargo tauri dev)`
    )
    err.code = 'tauri.required'
    throw err
  }
}

function normalizeError(err, label) {
  if (err instanceof Error) return err
  // Tauri reject payloads can be strings or plain objects without a `.message`.
  if (typeof err === 'string') {
    const error = new Error(err || `${label} failed`)
    error.code = 'tauri.string'
    return error
  }
  const message =
    err?.message || err?.error?.message || err?.error || `${label} failed`
  const error = new Error(String(message))
  error.code = err?.code || err?.error?.code || 'tauri.unknown'
  error.retryable = !!err?.retryable
  error.context = err?.context
  error.causeId = err?.causeId
  return error
}

export async function invokeCommand(cmd, args = {}) {
  assertTauriRuntime(cmd)
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke(cmd, args)
  } catch (err) {
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.invoke) {
      try {
        return await window.__TAURI__.core.invoke(cmd, args)
      } catch (retryErr) {
        throw normalizeError(retryErr, cmd)
      }
    }
    throw normalizeError(err, cmd)
  }
}

/**
 * Unwrap CommandResponse envelope from Rust commands.
 */
export function unwrapCommandResponse(response, label = 'command') {
  if (response == null) {
    const err = new Error(`${label}: empty response`)
    err.code = 'tauri.empty'
    throw err
  }
  if (typeof response === 'object' && 'ok' in response) {
    if (response.ok) return response.data
    const envelope = response.error || {}
    const message =
      envelope.message ||
      envelope.code ||
      `${label} failed (no detail provided by backend)`
    const error = new Error(String(message))
    error.code = envelope.code
    error.retryable = !!envelope.retryable
    error.context = envelope.context
    error.causeId = envelope.causeId
    throw error
  }
  return response
}
