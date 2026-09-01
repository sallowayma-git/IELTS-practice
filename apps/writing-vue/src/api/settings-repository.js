/**
 * Settings + backup + secret-ref client — Tauri only.
 */

import { invokeCommand, isTauriRuntime, unwrapCommandResponse } from '@/api/tauri-bridge.js'

export async function listSettings(namespace) {
  const response = await invokeCommand('list_settings', { namespace: namespace || null })
  return { source: 'tauri', items: unwrapCommandResponse(response, 'list_settings') || [] }
}

export async function upsertSetting(namespace, key, value) {
  const response = await invokeCommand('upsert_setting', {
    cmd: { namespace, key, value }
  })
  return { source: 'tauri', entry: unwrapCommandResponse(response, 'upsert_setting') }
}

/** SQLite-owned policy; intentionally separate from generic settings KV. */
export async function getHistoryRetentionPolicy() {
  const response = await invokeCommand('history_get_retention_policy')
  return unwrapCommandResponse(response, 'history_get_retention_policy')
}

export async function setHistoryRetentionPolicy(maxTerminalAttempts) {
  const response = await invokeCommand('history_set_retention_policy', {
    cmd: { maxTerminalAttempts }
  })
  return unwrapCommandResponse(response, 'history_set_retention_policy')
}

export async function migrateLocalPreferences(prefs) {
  const response = await invokeCommand('migrate_local_preferences', { prefs })
  return {
    source: 'tauri',
    count: unwrapCommandResponse(response, 'migrate_local_preferences') || 0
  }
}

export async function setSecret(name, secret) {
  const response = await invokeCommand('set_secret', { cmd: { name, secret } })
  return unwrapCommandResponse(response, 'set_secret')
}

export async function listSecretRefs() {
  const response = await invokeCommand('list_secret_refs')
  return unwrapCommandResponse(response, 'list_secret_refs') || []
}

export async function listAiConfigs() {
  const response = await invokeCommand('ai_list_configs')
  return unwrapCommandResponse(response, 'ai_list_configs') || []
}

export async function upsertAiConfig(cmd) {
  const response = await invokeCommand('ai_upsert_config', { cmd })
  return unwrapCommandResponse(response, 'ai_upsert_config')
}

export async function deleteAiConfig(id) {
  const response = await invokeCommand('ai_delete_config', { id })
  return unwrapCommandResponse(response, 'ai_delete_config')
}

export async function setDefaultAiConfig(id) {
  const response = await invokeCommand('ai_set_default_config', { id })
  return unwrapCommandResponse(response, 'ai_set_default_config')
}

export async function testAiProvider(configId) {
  const response = await invokeCommand('ai_test_provider', { configId })
  return unwrapCommandResponse(response, 'ai_test_provider')
}

export async function createBackup(appVersion) {
  const response = await invokeCommand('create_backup', { appVersion: appVersion || null })
  const data = unwrapCommandResponse(response, 'create_backup')
  // Backward compatible: either CreateBackupResult or bare manifest.
  if (data && data.manifest) {
    return { source: 'tauri', manifest: data.manifest, path: data.path || null }
  }
  return { source: 'tauri', manifest: data, path: null }
}

export async function listBackups() {
  const response = await invokeCommand('list_backups')
  return { source: 'tauri', items: unwrapCommandResponse(response, 'list_backups') || [] }
}

export async function pickBackupImportPath() {
  const response = await invokeCommand('pick_backup_import_path')
  return unwrapCommandResponse(response, 'pick_backup_import_path') || null
}

export async function importBackupPath(grantId, dryRun = true) {
  const response = await invokeCommand('import_backup_path', { grantId, dryRun })
  return { source: 'tauri', report: unwrapCommandResponse(response, 'import_backup_path') }
}

export const settingsRepository = {
  listSettings,
  upsertSetting,
  getHistoryRetentionPolicy,
  setHistoryRetentionPolicy,
  migrateLocalPreferences,
  setSecret,
  listSecretRefs,
  listAiConfigs,
  upsertAiConfig,
  deleteAiConfig,
  setDefaultAiConfig,
  testAiProvider,
  createBackup,
  listBackups,
  pickBackupImportPath,
  importBackupPath,
  isTauriRuntime
}

export default settingsRepository
