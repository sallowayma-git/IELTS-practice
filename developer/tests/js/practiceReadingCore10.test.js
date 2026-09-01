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
    .replace(/^interface\s+\w+\s*\{[^\r\n]*\}\s*$/gm, '')
    .replace(/^interface\s+\w+\s*\{[\s\S]*?^\}\s*$/gm, '')
    .replace(/\bref<[^>]+>\(/g, 'ref(')
    .replace(/dependencies\s*:\s*(?:ReadingLibraryDependencies|ReadingHistoryDependencies|ReadingAssetDependencies)/g, 'dependencies')
    .replace(/assetId\s*:\s*string/g, 'assetId')
    .replace(/options\s*:\s*\{\s*afterLoad\?:\s*\(asset\s*:\s*ReadingAsset\)\s*=>\s*Promise<void>\s*\|\s*void\s*\}/g, 'options')
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
        listAssets: async () => {
          calls.push('default')
          return expected
        },
        getAsset: async () => null
      }
    }
  })

  return useReadingLibrary({ api: {
    listAssets: async () => {
      calls.push('injected')
      return expected
    },
    getAsset: async () => null
  } }).loadReadingAssets().then((result) => {
    assert.strictEqual(result, expected)
    assert.deepStrictEqual(calls, ['injected'])
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
      getAsset: async (assetId) => {
        successCalls.push({ assetId })
        return { id: assetId, payload: { questionOrder: [] } }
      },
      listAssets: async () => ({ data: [] })
    }
  })
  const loaded = await success.loadReadingAsset('  reading-01  ', {
    afterLoad: async (asset) => successCalls.push({ afterLoad: asset.id })
  })
  assert.strictEqual(loaded.id, 'reading-01')
  assert.strictEqual(success.asset.value.id, 'reading-01')
  assert.strictEqual(success.error.value, '')
  assert.strictEqual(success.loading.value, false)
  assert.deepStrictEqual(toPlain(successCalls), [
    { assetId: 'reading-01' },
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

function testReadingLibraryUsesOnlyNativeArchiveAndIndexTruth() {
  const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
  const page = read('apps/writing-vue/src/views/PracticeLibraryPage.vue')
  const settings = read('apps/writing-vue/src/modules/practice-reading/components/ReadingSettingsPanel.vue')
  const moreTools = read('apps/writing-vue/src/modules/practice-reading/components/ReadingMoreToolsPanel.vue')
  const client = read('apps/writing-vue/src/api/practice-client.js')
  const repository = read('apps/writing-vue/src/api/reading-repository.js')
  const api = read('apps/writing-vue/src/modules/practice-reading/api.ts')

  for (const required of [
    'requireReadingArchiveExport',
    'requireCommittedReadingArchiveImport',
    "{ value: 'settings', label: '数据工具'",
    "invokeCommand('reading_export_archive')",
    "invokeCommand('reading_import_archive'",
    "invokeCommand('reading_pick_practice_asset'",
    'Rust/SQLite 本地索引'
  ]) {
    assert.ok([page, settings, client, repository].some((source) => source.includes(required)), `native Reading boundary missing: ${required}`)
  }
  for (const retired of [
    'READING_BACKUP_STORAGE_KEY',
    'readReadingBackups',
    'persistReadingBackups',
    'createReadingBackup',
    'forceRefreshReadingData',
    'create-reading-backup',
    'show-reading-backup-list',
    'force-refresh-reading-data',
    'SM-2',
    'show-achievements-tool',
    'open-vocab-tool',
    'refresh: Boolean(options.refresh)',
    'Math.random() * pool.length'
  ]) {
    assert.ok(![page, settings, moreTools, api].some((source) => source.includes(retired)), `retired Reading UI truth remains: ${retired}`)
  }
  assert.ok(!page.includes("if (view === 'settings')"), 'Reading archive controls must remain reachable from Library data tools')
}

async function main() {
  await testUseReadingLibraryLoadsAssets()
  await testUseReadingHistoryLoadsHistoryAndComputesStats()
  testReadingBrowsePanelSearchAndFilter()
  await testReadingPageLoadAssetSuccessAndFailure()
  testReadingLibraryUsesOnlyNativeArchiveAndIndexTruth()
  console.log('practiceReadingCore10.test.js passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
