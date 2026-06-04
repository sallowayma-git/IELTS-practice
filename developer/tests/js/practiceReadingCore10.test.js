#!/usr/bin/env node
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..', '..')

function loadModule(relativePath, injected = {}) {
  const absolutePath = path.join(repoRoot, relativePath)
  const originalSource = fs.readFileSync(absolutePath, 'utf8')
  const exportNames = Array.from(originalSource.matchAll(/export function\s+([A-Za-z0-9_]+)/g)).map((match) => match[1])
  let source = originalSource

  source = source
    .replace(/import\s+\{([^}]+)\}\s+from\s+'vue'/g, 'const {$1} = __deps.vue')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/api'/g, 'const {$1} = __deps.api')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/contracts'/g, 'const {$1} = __deps.contracts')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/historyStats'/g, 'const {$1} = __deps.historyStats')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/historyStats\.js'/g, 'const {$1} = __deps.historyStats')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/readingLibraryCore\.js'/g, 'const {$1} = __deps.readingLibraryCore')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/readingAssetCore\.js'/g, 'const {$1} = __deps.readingAssetCore')
    .replace(/import\s+\{([^}]+)\}\s+from\s+'\.\/readingHistoryCore\.js'/g, 'const {$1} = __deps.readingHistoryCore')
    .replace(/export function /g, 'function ')
    .concat('\nmodule.exports = { ')
  source += exportNames.join(', ') + ' }\n'

  const context = {
    module: { exports: {} },
    exports: {},
    __deps: {
      vue: {
        ref: (value) => ({ value }),
        computed: (getter) => ({ get value() { return getter() } })
      },
      api: {},
      contracts: {},
      historyStats: {},
      readingLibraryCore: {},
      readingAssetCore: {},
      readingHistoryCore: {},
      ...injected
    }
  }
  vm.runInNewContext(source, context, { filename: absolutePath })
  return context.module.exports
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function testUseReadingLibraryLoadsAssets() {
  const calls = []
  const expected = { data: [{ id: 'p1-high-01' }] }
  const readingLibraryCore = loadModule('apps/writing-vue/src/modules/practice-reading/readingLibraryCore.js')
  const { useReadingLibrary } = loadModule('apps/writing-vue/src/modules/practice-reading/useReadingLibrary.ts', {
    readingLibraryCore,
    api: {
      readingLibraryApi: {
        listAssets: async (options) => {
          calls.push(options)
          return expected
        },
        getAsset: async () => null
      }
    }
  })

  return useReadingLibrary({ api: {
    listAssets: async (options) => {
      calls.push({ injected: options })
      return expected
    },
    getAsset: async () => null
  } }).loadReadingAssets({ refresh: true }).then((result) => {
    assert.strictEqual(result, expected)
    assert.deepStrictEqual(calls, [{ injected: { refresh: true } }])
  })
}

function testUseReadingHistoryLoadsHistoryAndComputesStats() {
  const historyStats = loadModule('apps/writing-vue/src/modules/practice-reading/historyStats.js')
  const readingHistoryCore = loadModule('apps/writing-vue/src/modules/practice-reading/readingHistoryCore.js', {
    historyStats
  })
  const { useReadingHistoryWithDependencies } = loadModule('apps/writing-vue/src/modules/practice-reading/useReadingHistory.ts', {
    readingHistoryCore
  })
  const records = [
    { id: 'r1', accuracy: 0.8, duration: 600, submittedAt: '2026-06-05T08:00:00.000Z' },
    { id: 'r2', accuracy: 0.6, duration: 300, submittedAt: '2026-06-04T08:00:00.000Z' }
  ]
  const history = useReadingHistoryWithDependencies({
    api: {
      listAll: async () => ({ data: records }),
      delete: async () => {},
      clear: async () => {},
      exportArchive: async () => ({}),
      importArchive: async () => ({})
    }
  })

  return history.loadReadingHistory().then((result) => {
    assert.deepStrictEqual(result, { data: records })
    assert.deepStrictEqual(toPlain(history.computeHistoryStats(result.data, {
      now: new Date('2026-06-05T12:00:00.000Z')
    })), {
      totalPracticed: 2,
      averageAccuracy: 70,
      studyMinutes: 15,
      streakDays: 2
    })
  })
}

function testReadingBrowsePanelSearchAndFilter() {
  const { buildBrowseTitle, filterReadingAssets } = loadModule('apps/writing-vue/src/modules/practice-reading/browseFilters.js')
  const assets = [
    { id: 'p2-low-02', activity: 'reading', category: 'P2', title: 'Trees', difficulty: 'low' },
    { id: 'p1-high-01', activity: 'reading', category: 'P1', title: 'Tea History', difficulty: 'high', metadata: { dataKey: 'tea' } },
    { id: 'listen-01', activity: 'listening', category: 'P1', title: 'Audio', difficulty: 'high' }
  ]

  assert.strictEqual(buildBrowseTitle('all', 'all'), '题库浏览')
  assert.deepStrictEqual(
    filterReadingAssets(assets, {
      keyword: 'tea',
      selectedType: 'reading',
      selectedCategory: 'P1',
      frequencyFilter: 'high',
      sortMode: 'frequency-desc'
    }).map((asset) => asset.id),
    ['p1-high-01']
  )
}

async function testReadingPageLoadAssetSuccessAndFailure() {
  const readingAssetCore = loadModule('apps/writing-vue/src/modules/practice-reading/readingAssetCore.js')
  const { useReadingAsset } = loadModule('apps/writing-vue/src/modules/practice-reading/useReadingAsset.ts', {
    readingAssetCore,
    contracts: {
      normalizeReadingRecordId: (value) => String(value || '').trim()
    }
  })

  const successCalls = []
  const success = useReadingAsset({
    api: {
      getAsset: async (assetId, options) => {
        successCalls.push({ assetId, options })
        return { id: assetId, payload: { questionOrder: [] } }
      },
      listAssets: async () => ({ data: [] })
    }
  })
  const loaded = await success.loadReadingAsset('  reading-01  ', {
    refresh: true,
    afterLoad: async (asset) => successCalls.push({ afterLoad: asset.id })
  })
  assert.strictEqual(loaded.id, 'reading-01')
  assert.strictEqual(success.asset.value.id, 'reading-01')
  assert.strictEqual(success.error.value, '')
  assert.strictEqual(success.loading.value, false)
  assert.deepStrictEqual(toPlain(successCalls), [
    { assetId: 'reading-01', options: { refresh: true } },
    { afterLoad: 'reading-01' }
  ])

  const failed = useReadingAsset({
    api: {
      getAsset: async () => { throw new Error('boom') },
      listAssets: async () => ({ data: [] })
    }
  })
  await assert.rejects(() => failed.loadReadingAsset('reading-02'), /boom/)
  assert.strictEqual(failed.asset.value, null)
  assert.strictEqual(failed.error.value, '阅读资源加载失败：boom')
  assert.strictEqual(failed.loading.value, false)

  const missing = useReadingAsset({
    api: {
      getAsset: async () => null,
      listAssets: async () => ({ data: [] })
    }
  })
  const result = await missing.loadReadingAsset('   ')
  assert.strictEqual(result, null)
  assert.strictEqual(missing.error.value, '缺少阅读资源编号')
}

async function main() {
  await testUseReadingLibraryLoadsAssets()
  await testUseReadingHistoryLoadsHistoryAndComputesStats()
  testReadingBrowsePanelSearchAndFilter()
  await testReadingPageLoadAssetSuccessAndFailure()
  console.log('practiceReadingCore10.test.js passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
