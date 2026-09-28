import type { DiagnosticSink, DiagnosticStorageStatus } from './diagnosticContract';
export as namespace AppDiagnosticStorage;
export interface Store extends DiagnosticSink {
    readonly controlKey: string;
    /** Verifies writable lifecycle coordination, then sweeps retention without creating an absent database. */
    readonly ready: Promise<void>;
    status(): DiagnosticStorageStatus;
    /** Retains current-page memory, fences queued/relayed events and removes only diagnostics. */
    clear(): Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
    /** Both disabling and re-enabling start a new generation; old evidence is never replayed. */
    setEnabled(enabled: boolean): Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
    /** Revalidates writable lifecycle coordination and probes an IndexedDB write transaction. */
    retry(): Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
    /** A shared 15-minute lease; enabling an active lease does not extend it or change event generations. */
    setDetailedMode(enabled: boolean): Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
    /** SiteDataReset only: holds coordination through deletion, web-storage cleanup and backup commit. */
    withFullReset<T extends { success: boolean }>(callback: () => Promise<T>): Promise<T>;
    close(): void;
}
export function create(options?: { databaseName?: string; controlKey?: string; lockName?: string;
    now?: () => number; timeoutMs?: number;
    /** May only lower the production ceilings, useful for isolated fixtures. */
    limits?: { ageMs?: number; events?: number; bytes?: number } }): Store;
export const DATABASE_NAME: 'IELTSAtlasDiagnosticsV1';
export const CONTROL_KEY: 'ielts-atlas-diagnostics-control-v1';
export const LOCK_NAME: 'ielts-atlas-diagnostics-lifecycle-v1';
export const DETAILED_MODE_MS: 900000;
export const LIMITS: Readonly<{ ageMs: number; events: 2000; bytes: number;
    batchEvents: 20; pendingEvents: 200; pendingBytes: number }>;
declare global { const AppDiagnosticStore: Store; }
