import type { Correlation, DiagnosticInput, DiagnosticPersistence, DiagnosticReporter, DiagnosticSink,
    Environment, DiagnosticStorageStatus, DiagnosticTransportStatus, EntryCoverage } from './diagnosticContract';
export as namespace AppDiagnosticBootstrap;

export interface BootstrapOptions {
    entryCoverage?: Pick<EntryCoverage, 'entry' | 'capture'>;
    optionalMedia?: boolean;
    context?: Environment['context'];
    requiredResources?: readonly string[];
    optionalResources?: readonly string[];
}
export interface Collector extends DiagnosticReporter {
    readonly windowId: string;
    correlate(correlation?: DiagnosticInput['correlation'], aliases?: unknown): Correlation;
    /** Validated channel ingress only; preserves origin and generation, without UI or observers. */
    acceptRelayed(input: unknown): boolean;
    /** Passive status only: never a probe or delivery during export. */
    attachTransport(transport: { status(): DiagnosticTransportStatus }): void;
    /** Only recognized semantic input is retained, after normalization. */
    breadcrumb(input: NonNullable<DiagnosticInput['breadcrumbs']>[number], options?: { detailed?: boolean }): void;
    /** Call before assigning src/href or inserting a dynamic resource. */
    declareResource(target: string | object, declaration?: { url?: string; optional?: boolean }): void;
    /** Returns the capture-phase Error so a rejected loader can propagate the same identity. */
    resourceFailure(target: object, error?: unknown): unknown;
    startupFailed(error: unknown): string;
    markReady(): void;
    /** Idempotent; the collector itself becomes the full reporter without copying events. */
    handoff(): Collector;
    /** One asynchronous sink per page; upsert enriched records by event ID. Prototype append methods are supported. */
    attachSink(sink: Pick<DiagnosticSink, 'append'>): void;
    /** Retry only after a failed append; unchanged successfully delivered records are not replayed. */
    retrySink(): void | Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
    captureConsole(level: string, args: readonly unknown[]): void;
    /** Revalidated passive JSON, at most 32 KiB, with explicit truncation. */
    exportText(eventId?: string): string;
    status(): Readonly<{ events: number; bytes: number; dropped: number; persistence: DiagnosticPersistence;
        handedOff: boolean; fallbackFailed: boolean; storage?: DiagnosticStorageStatus; transport?: DiagnosticTransportStatus }>;
}
export function install(options?: BootstrapOptions): Collector;
/** Observe an existing collector without installing listeners or starting collection. */
export function current(): Collector | null;

declare global {
    const AppDiagnostics: Collector;
    const AppDiagnosticBuild: Readonly<{ appVersion: string; buildId: string;
        readingResources?: readonly string[];
        mappingPath: 'assets/generated/diagnostics/build-manifest.json' }>;
}
