#!/usr/bin/env node
// Contract for the reading asset list boundary: `reading_list_assets` data is
// normalized once, and the page-facing failure copy never leaks engine errors.

import assert from 'node:assert/strict'
import {
  READING_ASSET_LIST_INVALID,
  normalizeReadingAssetList
} from '../../../apps/writing-vue/src/api/reading-asset-list.js'
import {
  LIBRARY_LOAD_FAILURE,
  libraryFailureMessage
} from '../../../apps/writing-vue/src/modules/practice-reading/libraryFailure.js'

const p1 = { id: 'p1-high-01', title: 'Tea', category: 'P1', activity: 'reading' }
const p2 = { id: 'p2-low-02', title: 'Trees', category: 'P2', activity: 'reading' }

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => warnings.push(args.join(' '))

try {
  // Real Rust shape: a bare Vec<AssetIndexEntry>.
  assert.deepEqual(normalizeReadingAssetList([p1, p2]), [p1, p2])
  assert.deepEqual(normalizeReadingAssetList([]), [])

  // Empty is not a failure.
  assert.deepEqual(normalizeReadingAssetList(null), [])
  assert.deepEqual(normalizeReadingAssetList(undefined), [])

  // Envelopes are not a contract: Rust returns a bare Vec, so an object is a
  // malformed response and must fail loudly (the page shows the retry copy).
  // Before the boundary was hardened, `rows.slice` on such an object crashed the
  // list with `n.slice is not a function`; that was only reachable with a
  // non-array mock, never from the real command.
  for (const bad of [
    {}, { total: 3 }, { items: 'nope' }, { items: null }, { items: [p1], total: 1 },
    { data: [p2] }, { assets: [p1, p2] }, 'oops', 42, true
  ]) {
    assert.throws(
      () => normalizeReadingAssetList(bad),
      (error) => error.code === READING_ASSET_LIST_INVALID && /unexpected response shape/.test(error.message),
      `expected ${JSON.stringify(bad)} to be rejected`
    )
  }

  // Unusable entries are dropped (and reported once), never handed to the page.
  warnings.length = 0
  assert.deepEqual(
    normalizeReadingAssetList([p1, null, 'x', 7, [], {}, { id: '  ' }, { title: 'no id' }, p2]),
    [p1, p2]
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /dropped 7 malformed entries/)

  // The same input must not be mutated.
  const input = [p1, null]
  normalizeReadingAssetList(input)
  assert.deepEqual(input, [p1, null])
} finally {
  console.warn = originalWarn
}

// Failure copy: engine exceptions stay out of the UI, authored errors keep their detail.
const engineErrors = [
  new TypeError('n.slice is not a function'),
  new ReferenceError('x is not defined'),
  new RangeError('Invalid array length'),
  new SyntaxError('Unexpected token < in JSON at position 0')
]
for (const error of engineErrors) {
  const copy = libraryFailureMessage('导入失败', error, '请检查 JSON 文件')
  assert.equal(copy, '导入失败，请检查 JSON 文件')
  assert.ok(!copy.includes(error.message), `engine text leaked: ${copy}`)
}
assert.equal(libraryFailureMessage('随机练习启动失败', new TypeError('boom')), '随机练习启动失败，请稍后重试')
assert.equal(libraryFailureMessage('导出失败', new Error('磁盘已满')), '导出失败：磁盘已满')
assert.equal(libraryFailureMessage('导出失败', new Error('   ')), '导出失败，请稍后重试')
assert.equal(libraryFailureMessage('导出失败', null), '导出失败，请稍后重试')
assert.equal(libraryFailureMessage('导出失败', 'plain string'), '导出失败，请稍后重试')

// The load-failure line is fixed copy: no exception vocabulary, ever.
assert.ok(LIBRARY_LOAD_FAILURE.startsWith('阅读题库读取失败'))
assert.ok(!/slice|TypeError|function|undefined|null|\bat\b/i.test(LIBRARY_LOAD_FAILURE))

console.log('reading asset list boundary: ok')
