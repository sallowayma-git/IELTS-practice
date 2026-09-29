import type { DiagnosticEvent, DiagnosticPersistence, DiagnosticStorageStatus, DiagnosticTransportStatus, Environment, EntryCoverage,
    Snapshot, SnapshotQuery } from './diagnosticContract';
export as namespace AppDiagnosticExport;

export interface SourceStatus {
    readonly state: 'available' | 'shared' | 'unavailable' | 'failed' | 'timed-out';
    readonly persistence: DiagnosticPersistence | 'unknown';
    readonly coverage: 'complete' | 'partial' | 'unknown';
    readonly events: number;
    readonly rejected: number;
    readonly truncated: boolean;
}
export interface Report {
    readonly schemaVersion: 1;
    readonly reportType: 'passive-diagnostics';
    readonly notice: string;
    readonly appVersion: string;
    readonly buildId: string;
    readonly environment: Partial<Environment>;
    readonly selection: { readonly kind: 'incident' | 'history' | 'unknown';
        readonly eventId: string | null; readonly found: boolean | null };
    readonly persistence: DiagnosticPersistence | 'unknown';
    readonly storage: Readonly<Omit<DiagnosticStorageStatus, 'enabled' | 'suspended' | 'phase' | 'failure' | 'coverage' | 'persistence'> & {
        enabled: boolean | 'unknown'; suspended: boolean | 'unknown'; phase: DiagnosticStorageStatus['phase'] | 'unknown';
        failure: DiagnosticStorageStatus['failure'] | 'unknown'; coverage: 'complete' | 'partial' | 'unknown';
        persistence: DiagnosticPersistence | 'unknown' }> | null;
    readonly sources: Readonly<Partial<Record<'memory' | 'bootstrap' | 'persisted', SourceStatus>>>;
    readonly transport?: DiagnosticTransportStatus;
    readonly collection: { readonly coverage: 'partial'; readonly aggregation: 'incomplete';
        readonly entryCoverage?: EntryCoverage;
        readonly connection: DiagnosticTransportStatus['connection'] | 'unverified' | 'not-applicable'; readonly limitations: readonly string[] };
    readonly truncated: boolean;
    readonly issues: readonly string[];
    readonly events: readonly DiagnosticEvent[];
    readonly timeline: { readonly ordering: string;
        readonly windows: readonly { readonly windowId: string; readonly eventIds: readonly string[] }[] };
}
export interface ExportResult {
    readonly status: 'ready' | 'fallback';
    readonly report: Report | null;
    readonly json: string | null;
    /** UTF-8 bounded to 8 KiB; available even if generation or the DOM fails. */
    readonly text: string;
}
export interface DeliveryResult extends Omit<ExportResult, 'status'> {
    readonly status: 'copied' | 'download-started' | 'text-fallback';
    readonly selectable: boolean;
}
export interface Exporter {
    /** Revalidates sources without flush, retry, probes, writes, or starting collection. */
    snapshot(query?: SnapshotQuery): Promise<Report>;
    getIncident(eventId: string): Promise<DiagnosticEvent | null>;
    exportJSON(query?: SnapshotQuery): Promise<ExportResult>;
    copySummary(query?: SnapshotQuery, presentation?: { textTarget?: HTMLTextAreaElement }): Promise<DeliveryResult>;
    download(query?: SnapshotQuery, presentation?: { textTarget?: HTMLTextAreaElement }): Promise<DeliveryResult>;
}
export const LIMITS: Readonly<{ events: 2000; bytes: number; context: 50; summaryBytes: 8192; readTimeoutMs: 3000 }>;
export function create(options?: {
    reporter?: { snapshot(query?: SnapshotQuery): Snapshot | Promise<Snapshot> };
    bootstrap?: { snapshot(query?: SnapshotQuery): Snapshot | Promise<Snapshot> };
    store?: { snapshot(query?: SnapshotQuery): Snapshot | Promise<Snapshot> };
    context?: Environment['context'];
    /** May only lower the per-source/clipboard deadline for tests. */
    timeoutMs?: number;
}): Exporter;
export const snapshot: Exporter['snapshot'];
export const getIncident: Exporter['getIncident'];
export const exportJSON: Exporter['exportJSON'];
export const copySummary: Exporter['copySummary'];
export const download: Exporter['download'];
