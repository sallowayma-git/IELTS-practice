import type { PracticeMigrationStatus } from './contracts.js'

export const PRACTICE_MIGRATION_STATUS: PracticeMigrationStatus = {
  schemaVersion: '2026-05-21.practice-migration.v1',
  defaultRenderer: 'vue',
  legacyFallbackEnabled: true,
  legacyDeletionAllowed: false,
  legacyProductEntrypointVisible: false,
  legacyReadingFallbackEnabled: false,
  normalVueReadingUsesLegacy: false,
  electronEntrypoints: {
    primary: 'dist/writing/index.html',
    fallback: null,
    fallbackIpc: null,
    bootRecovery: 'index.html',
    diagnosticFallbackIpc: null,
    practiceRouteIpc: 'navigate-to-practice-route'
  },
  capabilities: [
    {
      id: 'single-reading-practice',
      label: '单篇阅读练习',
      domain: 'reading',
      renderer: 'vue',
      support: 'primary',
      routePattern: '/library -> /reading/:assetId',
      apiSurface: [
        '/api/practice/assets/reading/:assetId',
        'server/src/lib/practice/reading/ReadingAssetProvider.ts reading library provider contract',
        'server/src/lib/practice/reading/BuiltinReadingAssetProvider.ts builtin provider',
        'server/src/lib/practice/reading/reading-generated-loader.ts VM-free JSON parser',
        'server/src/lib/practice/reading/reading-generated-loader.ts bounded payload cache',
        'server/src/lib/shared/reading-generated-data.ts shared parser',
        '/api/practice/sessions',
        '/api/practice/history',
        'PracticeHistorySummary list without submission_json parsing',
        'practice_history_records submission_json-only session replay',
        '/api/practice/coach',
        'server/src/lib/reading/coach-service.ts VM-free generated data loader',
        'server/src/lib/reading/coach-service.ts bounded coach caches',
        'electronAPI.openPracticeReading()',
        'electronAPI.openPracticeRoute()'
      ],
      verifiedBy: [
        'developer/tests/js/practiceApiFacade.test.js',
        'developer/tests/js/practiceVueShell.test.js',
        'developer/tests/e2e/practice_reading_vue_flow.py'
      ],
      deletionGate: 'Product single-reading no longer uses legacy fallback; physical unified runtime deletion remains blocked only by listening, diagnostics, and explicit legacy test surfaces.'
    },
    {
      id: 'writing-practice',
      label: '写作练习与评测',
      domain: 'writing',
      renderer: 'vue',
      support: 'primary',
      routePattern: '/ 或 /writing',
      apiSurface: [
        "electronAPI.openPracticeRoute('/writing')",
        '/api/practice/assets?activity=writing',
        '/api/practice/sessions/:activity/:sessionId/stream',
        '/api/writing/evaluations',
        'server/src/lib/writing/evaluate-service.ts bounded SSE replay cache',
        'Essay history summary list without content/evaluation_json parsing'
      ],
      verifiedBy: [
        'developer/tests/e2e/writing_compose_draft_restore_e2e.py',
        'developer/tests/js/practiceVueShell.test.js'
      ],
      deletionGate: 'Writing remains Vue primary while its evaluation internals continue through the existing writing adapter.'
    },
    {
      id: 'suite-reading-practice',
      label: '阅读套题/模拟链路',
      domain: 'reading-suite',
      renderer: 'vue',
      support: 'primary',
      routePattern: '/library -> /reading-suite/:sessionId -> /reading/:assetId?suiteSessionId=:sessionId',
      apiSurface: [
        '/api/practice/reading-suite',
        '/api/practice/reading-suite/:sessionId',
        '/api/practice/reading-suite/:sessionId/passages/:assetId',
        'practice_reading_suite_sessions SQLite table',
        'server/src/lib/practice/reading-suite-store.ts',
        'electronAPI.openPracticeRoute()',
        'js/presentation/app-actions.js -> /reading-suite/:sessionId',
        'apps/writing-vue/src/views/PracticeReadingSuitePage.vue',
        'apps/writing-vue/src/views/PracticeReadingPage.vue'
      ],
      legacyFallbackSurface: [
        'explicit test_env/suite_test/ci legacy suite regression only',
        'js/app/suitePracticeMixin.js',
        'js/runtime/unifiedReadingPage.js'
      ],
      verifiedBy: [
        'developer/tests/e2e/practice_reading_suite_vue_flow.py',
        'developer/tests/js/practiceApiFacade.test.js',
        'developer/tests/js/practiceVueShell.test.js',
        'developer/tests/js/legacySuiteVueRoute.test.js',
        'developer/tests/e2e/suite_practice_flow.py',
        'developer/tests/js/suiteModeFlow.test.js',
        'developer/tests/js/suiteModeRegression.test.js'
      ],
      deletionGate: 'Product suite reading is Vue-only; Vue/API/route failure surfaces an error and never starts legacy. Explicit test_env/suite_test/ci keeps legacy suite regression verified until listening exits legacy.'
    },
    {
      id: 'listening-practice',
      label: '听力练习',
      domain: 'listening',
      renderer: 'legacy',
      support: 'fallback',
      routePattern: 'index.html listening library routes',
      apiSurface: [
        'assets/scripts/listening-exam-data.js',
        'ListeningPractice/**'
      ],
      verifiedBy: [
        'developer/tests/e2e/listening_practice_flow.py',
        'developer/tests/e2e/suite_practice_flow.py'
      ],
      fallbackReason: 'Listening has not been migrated into the Vue Practice API or Vue session renderer.',
      deletionGate: 'Legacy fallback remains mandatory until listening assets, answer capture, scoring, history, and replay are Vue-native.'
    }
  ],
  deletionCriteria: [
    'Electron default entry loads the Vue Practice Shell and emits app-runtime-ready.',
    'Single reading render, answer capture, drag/drop, submit, score, review, coach, history, replay, and analysis artifacts pass Vue E2E.',
    'Vue reading suite creation, P1/P2/P3 progression, submit aggregation, and review navigation pass E2E while the legacy suite fallback remains verified.',
    'Vue product navigation exposes no legacy standby button or legacy navigation IPC.',
    'Writing product entry uses the Practice route IPC and exposes no standalone writing navigation IPC.',
    'Normal reading and suite product paths do not fall back to reading-practice-unified.html.',
    'Legacy homepage suite launch uses /api/practice/reading-suite plus electronAPI.openPracticeRoute(), and only explicit test_env/suite_test/ci regression mode may call suitePracticeMixin.',
    'Runtime assets/scripts contains only exam index JS data; reading explanation generators live under developer/tests/tools.',
    'Electron debug test runners have been deleted; no electron/test_*.js or electron/test-*.js package exclusions remain.',
    'Practice shared/data layer owns HTTP errors, pagination, route response envelopes, JSON persistence, and Vue Practice API path construction.',
    'Practice history stores reading replay, analysis artifacts, and coach transcripts in canonical submission_json only; the Vue Practice history chain has no legacy shadow payload.',
    'Practice history list returns lightweight PracticeHistorySummary rows; only detail and session replay read canonical submission_json.',
    'Reading generated exam payloads are normalized through a bounded loader cache, so repeated detail/submit/suite hot-path calls do not re-read and re-parse the same asset.',
    'ReadingCoach generated exam bundles and query responses are bounded LRU caches, so AI coaching cannot grow unbounded in a long-running Electron process.',
    'Writing evaluation SSE replay events are bounded by event count and session count, so writing evaluation hydration cannot grow unbounded in a long-running Electron process.',
    'Writing essay history list returns summary rows with topic_text snapshots and does not read or parse essay content/evaluation_json unless detail or export is requested.',
    'Single reading submitted session state is restored from PracticeHistoryStore/practice_history_records and PracticeService does not own a reading-session Map.',
    'Reading suite session state is persisted in practice_reading_suite_sessions and PracticeService does not own a suite-session Map.',
    'Reading manifest, generated exam assets, and reading coach explanation assets are parsed as JSON data without node:vm or runInNewContext in Practice and ReadingCoach runtime paths.',
    'Packaged release bundle contains dist/writing/index.html and the Practice API facade.'
  ]
}

export function getPracticeMigrationStatus(): PracticeMigrationStatus {
  return PRACTICE_MIGRATION_STATUS
}
