export interface AiProviderConfig {
  id: string
  configName: string
  provider: string
  baseUrl: string
  defaultModel: string
  isDefault: boolean
  isEnabled: boolean
  hasSecret: boolean
}

export interface UpsertAiProviderConfigCommand {
  id?: string
  configName: string
  provider: string
  baseUrl?: string
  defaultModel: string
  isEnabled?: boolean
  apiKey?: string
}

export interface AiProviderTestResult {
  provider: string
  model: string
  reachable: boolean
  authenticated: boolean
  latencyMs: number
}

export function listSettings(namespace?: string | null): Promise<{ source: 'tauri'; items: unknown[] }>
export function upsertSetting(namespace: string, key: string, value: unknown): Promise<unknown>
export interface HistoryRetentionPolicy {
  maxTerminalAttempts?: number | null
}
export interface SetHistoryRetentionPolicyResult {
  policy: HistoryRetentionPolicy
  prunedAttemptCount: number
}
export function getHistoryRetentionPolicy(): Promise<HistoryRetentionPolicy>
export function setHistoryRetentionPolicy(maxTerminalAttempts: number | null): Promise<SetHistoryRetentionPolicyResult>
export function migrateLocalPreferences(prefs: unknown): Promise<{ source: 'tauri'; count: number }>
export function setSecret(name: string, secret: string): Promise<unknown>
export function listSecretRefs(): Promise<unknown[]>
export function listAiConfigs(): Promise<AiProviderConfig[]>
export function upsertAiConfig(cmd: UpsertAiProviderConfigCommand): Promise<AiProviderConfig>
export function deleteAiConfig(id: string): Promise<unknown>
export function setDefaultAiConfig(id: string): Promise<unknown>
export function testAiProvider(configId: string): Promise<AiProviderTestResult>
export function createBackup(appVersion?: string | null): Promise<{ source: 'tauri'; manifest: unknown; path?: string | null }>
export function listBackups(): Promise<{ source: 'tauri'; items: Array<{ name: string; path: string; modifiedAt?: string | null; sizeBytes?: number }> }>
export interface BackupImportGrant {
  grantId: string
  displayPath: string
  expiresAt: string
}

export function pickBackupImportPath(): Promise<BackupImportGrant | null>
export function importBackupPath(grantId: string, dryRun?: boolean): Promise<{ source: 'tauri'; report: unknown }>

declare const settingsRepository: Record<string, unknown>
export default settingsRepository
