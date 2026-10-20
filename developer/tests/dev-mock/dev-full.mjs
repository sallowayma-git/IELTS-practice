#!/usr/bin/env node
/**
 * Full dev stack in one process tree:
 *   - HTTP mock backend (server.js) on 127.0.0.1:4319
 *   - Vite dev server (apps/writing-vue) on 127.0.0.1:5173
 *   - opens the default browser once both answer
 *
 *   node developer/tests/dev-mock/dev-full.mjs [--no-open]
 *
 * Ports: DEV_BACKEND_PORT / DEV_FRONTEND_PORT. The backend owns the seeded
 * data; the page only carries the HTTP transport shim. Dev-only, never built.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const mockDir = import.meta.dirname
const root = resolve(mockDir, '../../..')
const viteBin = resolve(root, 'apps/writing-vue/node_modules/vite/bin/vite.js')
const backendPort = Number(process.env.DEV_BACKEND_PORT || 4319)
const frontendPort = Number(process.env.DEV_FRONTEND_PORT || 5173)
const open = !process.argv.slice(2).includes('--no-open')
const children = []

function launch(command, args, options, label) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) console.log(`[${label}] ${line}`)
    })
  }
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${label}] exited (${signal || code}); stopping the stack`)
      shutdown(code ?? 1)
    }
  })
  children.push(child)
  return child
}

let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  setTimeout(() => process.exit(code), 300).unref()
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await delay(200)
  }
  throw new Error(`${label} did not answer at ${url} within ${timeoutMs}ms`)
}

function openBrowser(url) {
  const [command, args] =
    process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true })
  child.on('error', (error) => console.warn(`[dev-full] could not open a browser: ${error.message}`))
  child.unref()
}

async function main() {
  if (!existsSync(viteBin)) {
    console.error('[dev-full] apps/writing-vue/node_modules/vite is missing; run npm install first')
    process.exitCode = 1
    return
  }

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  launch(process.execPath, [resolve(mockDir, 'server.js'), '--port', String(backendPort)],
    { cwd: root }, 'api')
  await waitFor(`http://127.0.0.1:${backendPort}/health`, 'mock backend')

  launch(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
    {
      cwd: resolve(root, 'apps/writing-vue'),
      env: { ...process.env, VITE_DEV_BACKEND: '1', VITE_DEV_BACKEND_PORT: String(backendPort) },
    }, 'web')
  const url = `http://127.0.0.1:${frontendPort}/`
  await waitFor(url, 'vite dev server')

  console.log(`[dev-full] backend http://127.0.0.1:${backendPort}  frontend ${url}`)
  if (open) openBrowser(url)
  await new Promise(() => {})
}

main().catch((error) => {
  console.error(`[dev-full] ${error.message}`)
  shutdown(1)
})
