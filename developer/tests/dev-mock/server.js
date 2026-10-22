#!/usr/bin/env node
/**
 * Dev-only HTTP backend for the browser UI.
 *
 * Serves the same command table as the in-page mock (tauri-mock.js), but the
 * seeded state lives here in the Node process instead of the page, so reloads
 * keep it and the browser only carries a transport shim. Never part of a build.
 *
 *   node developer/tests/dev-mock/server.js --port 4319
 *
 * Endpoints:
 *   GET  /health          -> { status: 'ok', commands: n }
 *   POST /invoke          { cmd, args } -> { ok, data | error }
 *   POST /api/invoke      same, for direct (non-proxied) use
 */
import { createServer } from 'node:http'
import { createSeedState } from './seed.js'
import { createHandlers } from './handlers.js'

const MAX_BODY_BYTES = 16 * 1024 * 1024

function portFromArgs(argv) {
  const index = argv.indexOf('--port')
  if (index >= 0 && argv[index + 1]) return Number(argv[index + 1])
  return Number(process.env.DEV_BACKEND_PORT || process.env.PORT || 4319)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  response.end(body)
}

function createBackend() {
  // The seed is created once: the backend is the owner of this state.
  const state = createSeedState(Date.now())
  const handlers = createHandlers(state, { send() {} })

  async function invoke(cmd, args) {
    const handler = handlers[cmd]
    if (!handler) {
      console.warn('[dev-backend] unhandled', cmd)
      return { ok: false, error: { code: 'dev_backend.unhandled', message: `未实现的后端命令：${cmd}`, retryable: false } }
    }
    try {
      const data = await handler(args ?? {})
      return { ok: true, data: data === undefined ? null : data }
    } catch (error) {
      if (error?.envelope) return { ok: false, error: error.envelope }
      console.error('[dev-backend] handler crashed', cmd, error)
      return { ok: false, error: { code: 'dev_backend.handler_error', message: String(error?.message || error), retryable: false } }
    }
  }

  return { state, handlers, invoke }
}

function main() {
  const port = portFromArgs(process.argv.slice(2))
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[dev-backend] invalid port: ${port}`)
    process.exitCode = 2
    return
  }
  const backend = createBackend()

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
    const path = url.pathname.replace(/^\/api(?=\/)/, '')

    if (request.method === 'OPTIONS') {
      send(response, 204, null)
      return
    }
    if (request.method === 'GET' && path === '/health') {
      send(response, 200, { status: 'ok', commands: Object.keys(backend.handlers).length })
      return
    }
    if (request.method !== 'POST' || path !== '/invoke') {
      send(response, 404, { ok: false, error: { code: 'dev_backend.not_found', message: `no route: ${request.method} ${url.pathname}`, retryable: false } })
      return
    }

    let payload
    try {
      payload = JSON.parse(await readBody(request))
    } catch (error) {
      send(response, error.status || 400, { ok: false, error: { code: 'dev_backend.bad_request', message: String(error.message || error), retryable: false } })
      return
    }
    const cmd = String(payload?.cmd || '')
    if (!cmd) {
      send(response, 400, { ok: false, error: { code: 'dev_backend.bad_request', message: 'cmd is required', retryable: false } })
      return
    }
    send(response, 200, await backend.invoke(cmd, payload.args))
  })

  server.on('error', (error) => {
    console.error(`[dev-backend] ${error.code === 'EADDRINUSE' ? `port ${port} is already in use` : error.message}`)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => {
    console.log(`[dev-backend] listening on http://127.0.0.1:${port} (state seeded once, ${Object.keys(backend.handlers).length} commands)`)
  })

  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
