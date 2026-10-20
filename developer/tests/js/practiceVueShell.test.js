#!/usr/bin/env node
/**
 * Shipping shell contract: this test intentionally targets only the Tauri 2
 * host and the Vue frontend.  Electron/Fastify were retired and must not be
 * smuggled back into a product test as a second source of truth.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { featureFlags, resolveFeatureFlag } from '../../../apps/writing-vue/src/config/feature-flags.js'
import { unwrapCommandResponse } from '../../../apps/writing-vue/src/api/tauri-bridge.js'
import {
  formatPreferenceValue,
  summarizeApproval,
  summarizeEvidence,
  summarizeJournal
} from '../../../apps/writing-vue/src/modules/agent-console/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n')
}

function has(source, snippet, label) {
  assert.ok(source.includes(snippet), `${label} missing: ${snippet}`)
}

function lacks(source, snippet, label) {
  assert.ok(!source.includes(snippet), `${label} must not contain: ${snippet}`)
}

function testVueRoutesAndShell() {
  const routes = read('apps/writing-vue/src/main.js')
  const app = read('apps/writing-vue/src/App.vue')
  const nav = read('apps/writing-vue/src/components/NavBar.vue')
  const flags = read('apps/writing-vue/src/config/feature-flags.js')

  for (const route of [
    "path: '/library'",
    "path: '/reading/:assetId'",
    "path: '/reading-suite/:sessionId'",
    "path: '/reading/:assetId/review/:sessionId'",
    "path: '/writing'",
    "path: '/notebook'",
    "path: '/dev/agent'"
  ]) has(routes, route, 'Vue practice route')
  has(routes, "redirect: { name: 'Notebook' }", 'retired memory center lands on the notebook')

  has(app, 'showShellNav', 'shared App shell nav gate')
  has(app, 'framelessRouteNames', 'immersive-only shell escape hatch')
  lacks(app, "'PracticeLibrary'", 'Library must remain inside the shared App shell')
  has(nav, '<router-link to="/" class="brand-block">', 'product brand route')
  for (const label of ["label: '总览'", "label: '题库'", "label: '写作'", "label: '札记'", "label: '历史'", "label: '更多'", "label: '设置'"]) {
    has(nav, label, 'global product navigation')
  }
  // 题库 owns a secondary row (阅读 / 写作); 写作 no longer claims /topics.
  has(nav, "label: '阅读', match: ['/'], view: 'browse'", 'reading sub-entry under 题库')
  has(nav, "to: '/topics', label: '写作', match: ['/topics']", 'writing sub-entry under 题库')
  has(nav, "match: ['/writing', '/evaluating/', '/result/'] }", 'writing top entry without /topics')
  has(nav, 'aria-label="题库分类"', 'library sub-row landmark')
  lacks(nav, "'/result/', '/topics'", 'top-level writing must not match /topics')
  lacks(nav, "label: '智能体'", 'agent workbench is not a learner nav entry')
  lacks(nav, 'featureFlags.agentWorkspaceV1', 'agent workbench stays off the learner nav')
  has(routes, 'featureFlags.agentWorkspaceV1', 'Agent route feature flag')
  has(app, "'atlas-exam'", 'exam routes keep their frozen theme root')
  has(flags, 'VITE_FEATURE_AGENT_WORKSPACE_V1', 'Agent build-time rollback flag')
  has(flags, 'VITE_FEATURE_READING_ATTEMPT_REVIEW_V1', 'Attempt Review build-time rollback flag')
  const readingPage = read('apps/writing-vue/src/views/PracticeReadingPage.vue')
  const readingReview = read('apps/writing-vue/src/modules/practice-reading/components/ReadingReviewPanel.vue')
  const learningRepository = read('apps/writing-vue/src/api/learning-repository.js')
  has(readingPage, ':attempt-review-enabled="featureFlags.readingAttemptReviewV1"', 'Attempt Review UI flag gate')
  has(readingReview, 'v-if="attemptReviewEnabled"', 'Attempt Review panel flag gate')
  for (const command of ['learning_compare_attempts', 'agent_run_attempt_review', 'agent_get_run']) {
    has(learningRepository, command, 'Attempt Review Tauri repository command')
  }
  assert.equal(featureFlags.agentWorkspaceV1, false, 'developer agent workbench is off by default')
  assert.equal(resolveFeatureFlag(undefined, true), true, 'unset flags keep their default')
  assert.equal(resolveFeatureFlag('false', true), false, 'explicit false disables a flag')
  assert.equal(resolveFeatureFlag('TRUE', false), true, 'feature flag parsing is case-insensitive')
}

function testLibraryHasOneProductShell() {
  const library = read('apps/writing-vue/src/views/PracticeLibraryPage.vue')
  const librarySettings = read('apps/writing-vue/src/modules/practice-reading/useReadingDataTools.js')
  const navBar = read('apps/writing-vue/src/components/NavBar.vue')
  const client = read('apps/writing-vue/src/api/client.js')
  const skin = read('apps/writing-vue/src/styles/opensource-skin.css')

  has(library, 'data-practice-reading-home data-library-ready', 'stable Library ready marker')
  has(library, '<h1 class="library-workspace-header__title">{{ headerTitle }}</h1>', 'local workspace title is per view')
  has(library, "browse: Object.freeze({ kicker: '题库 · 阅读', title: '阅读题库' })", 'browse header is the reading library')
  has(library, "more: Object.freeze({ kicker: 'READING · 阅读', title: '阅读练习' })", 'more header is unchanged')
  lacks(library, 'library-view-tabs', 'Library views are top-nav entries, not an in-page tab strip')
  for (const view of ['browse', 'more']) has(navBar, `libraryView('${view}')`, `top nav entry for Library ${view}`)
  lacks(library, 'hero-brand-text', 'duplicate Library product brand')
  lacks(library, 'main-nav hero-nav', 'duplicate Library product navigation')
  lacks(library, 'practice-library-legacy', 'legacy Library shell ownership')
  lacks(library, 'practice-library-open-source', 'doubled Library skin ownership')
  assert.ok(!/^\.view\b/m.test(library), 'Library stylesheet leaks a naked .view selector')
  assert.ok(!/^\.btn\b/m.test(library), 'Library stylesheet leaks a naked .btn selector')
  has(skin, '.atlas-paper {', 'paper skin is scoped to non-exam routes')
  lacks(skin, '.atlas-source-ui .practice-library', 'Library owns its layout in PracticeLibraryPage.vue')
  assert.ok(/^\.atlas-paper \[data-practice-reading-home\] \.library-body \{/m.test(library), 'Library styles are rooted at the home root')
  for (const retired of [
    'clearPracticeCache',
    'clear-practice-cache',
    'practice_reading_answers_',
    'practice_reading_submission_'
  ]) {
    lacks(`${library}\n${librarySettings}`, retired, 'retired browser-owned Reading cache')
  }
  for (const retired of [
    'notImplemented(',
    'uploadImage()',
    'deleteImage()',
    'getImagePath()',
    'requestEventStream()'
  ]) {
    lacks(client, retired, 'dead Tauri API facade')
  }
}

function testWritingTopicCards() {
  const topics = read('apps/writing-vue/src/views/TopicManagePage.vue')

  has(topics, '<p class="page-header-kicker">题库 · 写作</p>', 'writing library kicker')
  has(topics, '<h1>写作题库</h1>', 'writing library title')
  has(topics, 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', 'practice card grid')
  has(topics, '<div class="topic-filter-bar" role="search"', 'filters live in one horizontal bar')
  has(topics, 'id="topic-search"', 'search keeps its id')
  has(topics, 'id="topic-filter-type" class="segmented', 'type filter is a segmented control')
  has(topics, 'id="topic-filter-category"', 'category filter keeps its id')
  has(topics, 'id="topic-filter-difficulty"', 'difficulty filter keeps its id')
  lacks(topics, 'has-rail', 'topics page has no filter rail layout')
  lacks(topics, 'topic-rail', 'topics page has no rail markup or CSS')
  has(topics, "router.push({ name: 'Compose', query: { topicId: topic.id, taskType: topic.type } })", 'practice entry hands topic to Compose')
  has(topics, ':aria-label="`难度 ${topic.difficulty || 0}/5`"', 'difficulty dots are labelled')
  lacks(topics, 'list-row', 'topic cards are not list rows')
  lacks(topics, '<router-link', 'topic cards are not links')
  has(topics, 'class="btn btn-ghost btn-sm edit"', 'edit action keeps its hook')
  has(topics, 'class="btn btn-danger-ghost btn-sm delete"', 'delete action keeps its hook')
}

function testReadingActionOwnership() {
  const page = read('apps/writing-vue/src/views/PracticeReadingPage.vue')
  const pageCss = read('apps/writing-vue/src/modules/practice-reading/styles/page.css')
  const examTheme = read('apps/writing-vue/src/styles/design-system/exam-theme.css')
  const designSystem = read('apps/writing-vue/src/styles/design-system/index.css')
  const nav = read('apps/writing-vue/src/modules/practice-reading/components/ReadingAnswerNav.vue')
  const interactions = read('apps/writing-vue/src/modules/practice-reading/useReadingInteractions.ts')
  const preferences = read('apps/writing-vue/src/modules/practice-reading/useReadingUiPreferences.ts')
  const preferenceStore = read('apps/writing-vue/src/composables/useTauriPreferences.js')

  has(nav, 'id="exit-btn"', 'stable Reading exit identifier')
  has(nav, '@click="handleLeave"', 'guarded Reading exit')
  has(nav, "emit('leave')", 'Reading exit event')
  has(page, '@leave="handleLeave"', 'page-owned guarded leave flow')
  has(page, 'const canSnapshot = computed', 'single snapshot capability')
  has(page, 'src="../modules/practice-reading/styles/page.css"', 'Reading layout stylesheet split')
  has(pageCss, 'grid-template-rows: minmax(0, 1fr);', 'constrained Reading workspace row')
  has(pageCss, 'overscroll-behavior: contain;', 'pane-local Reading scroll')
  has(designSystem, "./exam-theme.css", 'exam theme registered in design system')
  has(examTheme, '--exam-navy:', 'exam navy token')
  has(examTheme, '.reading-page.exam-mode #reading-coach-fab', 'exam mode hides coach chrome')
  has(designSystem, "./tokens.css", 'paper tokens registered in design system')
  has(read('apps/writing-vue/src/styles/main.css'), "./design-system/exam-frozen.css", 'exam freeze layer loaded before the paper skin')
  has(read('apps/writing-vue/src/styles/design-system/exam-frozen.css'), '.atlas-exam {', 'exam token pin')
  has(interactions, 'readOnlyModeSource', 'single read-only interaction source')
  lacks(interactions, 'reviewModeSource', 'split review-only interaction source')
  has(page, 'ref="settingsPanel"', 'Reading settings dialog element ref')
  has(page, '@keydown="handleSettingsDialogKeydown"', 'Reading settings Escape/focus handling')
  has(page, 'aria-controls="settings-panel"', 'Reading settings trigger relationship')
  has(preferences, 'function handleSettingsDialogKeydown', 'Reading settings keyboard controller')
  has(preferences, 'function focusFirstPanelControl', 'Reading settings initial focus')
  has(preferenceStore, 'async function setDurable', 'awaitable SQLite preference migration write')
  has(preferenceStore, 'async function hydrateStrict', 'fail-closed preference migration hydration')
  has(preferences, 'await preferences.setDurable(key, legacy)', 'durable legacy preference migration')
  lacks(preferences, 'function takeLocal', 'delete-before-persist legacy migration')
  const migrationSource = preferences.slice(
    preferences.indexOf('async function migrateLocalIfMissing'),
    preferences.indexOf('async function initializeReadingPreferences')
  )
  assert.ok(
    migrationSource.indexOf('await preferences.setDurable') < migrationSource.indexOf('removeLocal(key)'),
    'legacy storage must be removed only after SQLite confirms the write'
  )
  for (const copy of ["return '提交作答'", "return '清空作答'", "<h3 id=\"notes-panel-title\">阅读笔记</h3>"]) {
    has(page, copy, 'Chinese Reading product copy')
  }
}

function testTauriCommandBoundary() {
  const tauri = read('src-tauri/src/lib.rs')
  const ai = read('src-tauri/src/commands/ai.rs')
  const writing = read('src-tauri/src/commands/writing.rs')
  const settings = read('apps/writing-vue/src/api/settings-repository.js')

  for (const command of [
    'commands::ai::ai_list_configs',
    'commands::ai::ai_test_provider',
    'commands::writing::writing_start_evaluation',
    'commands::writing::writing_submit_attempt'
  ]) has(tauri, command, 'registered Tauri command')
  has(ai, 'config_id: String', 'selected AI config test command parameter')
  has(ai, 'load_runtime_for_config', 'selected AI config runtime loader')
  has(writing, 'load_provider_config(&db, &vault)', 'vault-aware writing preflight')
  has(settings, "invokeCommand('ai_test_provider', { configId })", 'Vue selected-config test command')
}

function testSettingsNativeBackupOwnership() {
  const settings = read('apps/writing-vue/src/views/SettingsPage.vue')

  for (const operation of [
    'createFullAppBackup',
    'restoreFullAppBackup',
    'showNativeBackupList',
    'createBackup(',
    'listBackups(',
    'pickBackupImportPath(',
    'importBackupPath('
  ]) has(settings, operation, 'native Settings backup operation')

  has(settings, 'Tauri 2 原生桌面客户端', 'current Tauri product identity')
  has(settings, 'Rust + SQLite', 'current Rust data identity')
  // Data operations live in the dedicated 数据管理 dialog, split by domain.
  for (const dialogPart of ['dataDialogOpen', 'dataDialogTab', 'openDataDialog(', 'CLEAR_SCOPES', 'confirmClearHistory(\'all\')']) {
    has(settings, dialogPart, 'data management dialog contract')
  }
  for (const retired of [
    'ielts_writing_settings_backups_v1',
    'settingsSnapshotListOpen',
    'settingsBackupListOpen',
    'settingsBackups',
    "openSettingsDetail('data')",
    "activeTab === 'data'",
    '清空所有历史',
    'backup-list-btn',
    'exportSettingsData',
    'handleSettingsImport',
    'clear-cache-btn',
    'force-refresh-btn',
    'herbal_green_flat_logo',
    'Phase 05'
  ]) lacks(settings, retired, 'retired Settings mirror or dead action')
}

function testNoRetiredHostBoundary() {
  const shipping = [
    read('apps/writing-vue/src/main.js'),
    read('apps/writing-vue/src/App.vue'),
    read('apps/writing-vue/src/api/tauri-bridge.js'),
    read('src-tauri/src/lib.rs'),
    read('src-tauri/Cargo.toml')
  ].join('\n')
  for (const retired of ['electronAPI', 'window.electron', 'ipcRenderer']) {
    lacks(shipping, retired, 'retired host boundary')
  }
  assert.ok(!/from\s*['"]fastify['"]/.test(shipping), 'shipping code imports Fastify')
  assert.ok(!/\bfastify\s*=/.test(read('src-tauri/Cargo.toml')), 'Tauri host declares Fastify')
}

function testAgentWorkspaceFailureContract() {
  const workspace = read('apps/writing-vue/src/views/AgentConsolePage.vue')
  const repository = read('apps/writing-vue/src/api/agent-repository.js')

  has(workspace, "workspaceBusy.value || runState.value === 'running'", 'Agent workspace run mutex')
  has(workspace, 'initializeWorkspace()', 'default workspace initializes without a picker')
  has(workspace, 'workspaceGrant.value = await agentRepository.getWorkspace()', 'default grant renews automatically')
  has(workspace, 'data-agent-workspace-path', 'default directory remains visible')
  lacks(workspace, 'pickWorkspace', 'no manual workspace selection')
  has(repository, "invokeCommand('agent_get_workspace')", 'host-owned default workspace')
  has(workspace, '!workspaceLocked.value', 'Agent run button shares workspace mutex')
  has(workspace, 'error?.context?.runId', 'failed Agent run hydration ID')
  has(workspace, 'agentRepository.getRun(runId)', 'failed Agent SQLite hydration')
  lacks(workspace, 'JSON.stringify(approval.payload)', 'approval payload must not dump JSON')
  lacks(workspace, 'JSON.stringify(value)', 'memory values must not dump JSON')
  lacks(workspace, '{{ journalSummary.facts }}', 'journal card must not interpolate raw facts')
  has(workspace, 'summarizeJournal', 'journal facts go through product copy')
  has(workspace, 'journalSummary.lede', 'journal card uses human lede')
  const consoleCss = read('apps/writing-vue/src/modules/agent-console/styles/console.css')
  has(
    consoleCss,
    'grid-template-columns: minmax(210px, 0.82fr) minmax(340px, 1.5fr) minmax(250px, 0.92fr)',
    'Agent workbench column layout'
  )
  has(workspace, 'src="../modules/agent-console/styles/console.css"', 'Agent console CSS extraction')
  lacks(repository, 'record?.model', 'requested model fallback for actual model')

  let thrown
  try {
    unwrapCommandResponse({
      ok: false,
      error: {
        code: 'agent.provider_failed',
        message: 'provider failed',
        retryable: true,
        context: { runId: 'run-failed' },
        causeId: 'cause-failed'
      }
    }, 'agent_run')
  } catch (error) {
    thrown = error
  }
  assert.equal(thrown?.code, 'agent.provider_failed')
  assert.equal(thrown?.retryable, true)
  assert.deepEqual(thrown?.context, { runId: 'run-failed' })
  assert.equal(thrown?.causeId, 'cause-failed')
}

function testMemoryMutationContract() {
  const page = read('apps/writing-vue/src/views/AgentConsolePage.vue')
  const repository = read('apps/writing-vue/src/api/memory-repository.js')
  const host = read('src-tauri/src/lib.rs')
  const archiveHandler = page.split('async function archiveEntry(entry)')[1].split('async function forgetEntry(entry)')[0]
  has(archiveHandler, 'await archiveMemory(', 'archive uses non-destructive command')
  lacks(archiveHandler, 'forgetMemory(', 'archive must not forget')
  has(page, 'window.confirm(', 'permanent forget requires confirmation')
  has(page, "submitMemoryFeedback(entry, 'accurate')", 'accurate verdict wire enum')
  has(page, "submitMemoryFeedback(entry, 'inaccurate')", 'inaccurate verdict wire enum')
  lacks(page, "submitMemoryFeedback(entry, 'helpful')", 'unsupported feedback enum')
  has(page, 'await refreshMemoryCatalog()', 'refresh authoritative lifecycle state')
  has(repository, "invokeCommand('memory_archive', { input: command })", 'archive bridge')
  has(repository, "invokeCommand('memory_forget', { input: command })", 'forget bridge remains separate')
  has(host, 'commands::memory::memory_archive,', 'archive registered in real command table')
}

function testDashboardReadsEveryHistoryPage() {
  const dashboard = read('apps/writing-vue/src/modules/dashboard/useDashboard.js')
  // Streak and this-week counts span the whole history; a single 100/200-record
  // page silently truncates them.
  has(dashboard, 'listHistoryAll({})', 'dashboard reads every history page')
  lacks(dashboard, 'listHistory(', 'dashboard must not cap at one history page')
  lacks(dashboard, 'LOAD_LIMIT', 'dashboard has no single-page record cap')
}

function testAgentConsoleCopy() {
  const quiet = summarizeJournal({
    journalDate: '2026-08-24',
    facts: {
      journalDate: '2026-08-24',
      attemptsCount: 0,
      writingEvalSummary: { completed: 0, degraded: 0, averageBand: null },
      skillDeltas: [],
      memoryChanges: {
        newCandidates: 0, promoted: 0, reinforced: 0, refined: 0,
        improved: 0, regressed: 0, contradicted: 0, superseded: 0
      },
      coachFeedbackCount: 0,
      coachReaskCount: 0,
      timeSpentMs: 0,
      sourceHash: 'deadbeef'
    }
  })
  assert.equal(quiet.dateLabel, '2026年8月24日')
  assert.equal(quiet.quiet, true)
  assert.ok(!quiet.lede.includes('{'))
  assert.ok(quiet.rows.every((row) => typeof row.value === 'string' && !row.value.trim().startsWith('{')))
  assert.ok(quiet.rows.every((row) => !String(row.value).includes('sourceHash')))
  assert.ok(quiet.rows.some((row) => row.label === '练习次数' && row.value === '还没有练习'))

  const active = summarizeJournal({
    journalDate: '2026-08-24',
    facts: {
      attemptsCount: 2,
      writingEvalSummary: { completed: 1, degraded: 0, averageBand: 6.5 },
      skillDeltas: [{ skillKey: 'reading.tfng', delta: 0.4, evidenceCount: 3 }],
      memoryChanges: { newCandidates: 1, promoted: 0, reinforced: 0, refined: 0, improved: 2, regressed: 0, contradicted: 0, superseded: 0 },
      coachFeedbackCount: 3,
      timeSpentMs: 180000
    }
  })
  assert.equal(active.quiet, false)
  assert.ok(active.rows.find((row) => row.label === '写作评测').value.includes('均分 6.5'))
  assert.ok(active.rows.find((row) => row.label === '技能变化').value.includes('判断题'))
  assert.ok(active.rows.find((row) => row.label === '记忆变更').value.includes('新候选'))

  assert.equal(formatPreferenceValue({ enabled: true }), '开启')
  assert.equal(formatPreferenceValue({ foo: 1, bar: 2 }), '已保存的偏好')
  const approval = summarizeApproval({
    actionKind: 'set_explicit_preference',
    payload: { preferenceKey: 'hint_density', path: 'C:\\\\notes\\\\plan.md' }
  })
  assert.equal(approval.title, '固定一条偏好')
  assert.ok(!approval.detail.includes('{'))
  const evidence = summarizeEvidence({
    observationIds: ['obs-1', 'obs-2'],
    assetIds: ['asset-1'],
    supportIds: [],
    links: []
  })
  assert.equal(evidence.empty, false)
  assert.ok(evidence.lines[0].includes('2 次练习观察'))
  assert.ok(!evidence.lines.join('').includes('obs-1'))
}

testVueRoutesAndShell()
testLibraryHasOneProductShell()
testWritingTopicCards()
testReadingActionOwnership()
testTauriCommandBoundary()
testSettingsNativeBackupOwnership()
testNoRetiredHostBoundary()
testAgentWorkspaceFailureContract()
testMemoryMutationContract()
testAgentConsoleCopy()
testDashboardReadsEveryHistoryPage()
console.log('Tauri Vue shell contract: ok')
