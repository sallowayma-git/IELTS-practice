import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Execute the production composable with only its external dependencies mocked.
const source = readFileSync(new URL('../../../apps/writing-vue/src/composables/useAppUpdates.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')

function harness(invokeCommand) {
  const timers = []
  const events = []
  const window = {
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => timers.push(fn),
    dispatchEvent: (event) => events.push(event)
  }
  const updates = new Function('computed', 'reactive', 'Channel', 'invokeCommand', 'isTauriRuntime', 'window', 'CustomEvent', source + '\nreturn useAppUpdates()')(
    (fn) => ({ get value() { return fn() } }),
    (value) => value, class {}, invokeCommand, () => true, window,
    class { constructor(type, options) { this.type = type; this.detail = options.detail } }
  )
  return { updates, timers, events }
}
const available = {
  configured: true, app: { tier: 'upToDate' },
  content: [{ id: 'reading', state: 'available' }],
  message: 'A content update is available'
}

test('an unavailable signed policy never falls back to an unverified OTA offer', async () => {
  const calls = []
  const { updates } = harness(async (command) => {
    calls.push(command)
    if (command === 'ota_check') throw new Error('signed channel unavailable')
    return { updateAvailable: true, latestVersion: '0.3.0' }
  })
  updates.state.status = { ...available, app: { tier: 'ota', latestVersion: '0.2.0' } }
  await updates.check()
  assert.deepEqual(calls, ['ota_check'])
  assert.equal(updates.state.status, null)
  assert.equal(updates.hasActionable.value, false)
  assert.match(updates.state.message, /signed channel unavailable/)
})

test('a successful availability refresh preserves a failed install result', async () => {
  const calls = []
  const { updates } = harness(async (command) => {
    calls.push(command)
    if (command === 'ota_install_content') return [{ id: 'reading', ok: false, message: 'Checksum failed' }]
    return available
  })
  await updates.installContent()
  assert.deepEqual(calls, ['ota_install_content', 'ota_check'])
  assert.equal(updates.state.message, 'Checksum failed')
  assert.equal(updates.availableContent.value.length, 1)
  assert.equal(updates.state.content.installing, false)
})

test('partial success preserves errors and notifies content consumers', async () => {
  const { updates, events } = harness(async (command) => {
    if (command === 'ota_install_content') return [
      { id: 'reading', ok: true, message: 'Installed' },
      { id: 'writing-topics', ok: false, message: 'Import failed' }
    ]
    return available
  })
  await updates.installContent()
  assert.equal(updates.state.message, 'Import failed')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'ielts:content-updated')
})

test('an availability network failure does not hide the install failure', async () => {
  const { updates } = harness(async (command) => {
    if (command === 'ota_install_content') return [{ id: 'reading', ok: false, message: 'Checksum failed' }]
    throw new Error('Offline')
  })
  await updates.installContent()
  assert.equal(updates.state.message, 'Checksum failed')
})

test('disabled and unreadable preferences prevent background network calls', async () => {
  for (const preference of [async () => false, async () => { throw new Error('settings unavailable') }]) {
    let calls = 0
    const { updates, timers } = harness(async () => { calls += 1 })
    updates.scheduleStartupCheck(preference)
    await timers[0]()
    assert.equal(calls, 0)
  }
})
