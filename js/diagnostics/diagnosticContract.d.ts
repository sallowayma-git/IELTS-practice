export as namespace AppDiagnosticContract;

export type OperationCode = 'APP_BOOT_FAILED' | 'RESOURCE_LOAD_FAILED' | 'PRACTICE_SAVE_FAILED'
    | 'RECOVERY_SAVE_FAILED' | 'PRACTICE_CHANNEL_TIMEOUT' | 'DATA_IMPORT_FAILED'
    | 'DATA_EXPORT_FAILED' | 'UNEXPECTED_RUNTIME_ERROR';
export type CauseCode = 'BACKEND_UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'CONFLICT'
    | 'CORRUPT_RECORD' | 'VALIDATION' | 'INITIALIZATION_BLOCKED'
    | 'TIMING_FINALIZED' | 'TIMING_STALE_WRITER' | 'TIMING_STALE_REVISION' | 'unknown';
export type OperationPersistence = 'committed' | 'not-committed' | 'unconfirmed';
export type DiagnosticPersistence = 'memory-only' | 'pending' | 'persisted' | 'disabled' | 'failed';
export type CorrelationKind = 'session' | 'suite' | 'submission' | 'operation';
export type ModuleName = 'bootstrap' | 'main' | 'practice' | 'reading' | 'listening' | 'suite'
    | 'logger' | 'data-kernel' | 'storage' | 'import' | 'export' | 'diagnostics' | 'channel' | 'unknown';
export type Action = 'initialize' | 'load-resource' | 'open-practice' | 'handshake' | 'submit'
    | 'host-receipt' | 'acknowledgement' | 'save' | 'save-draft' | 'save-recovery' | 'storage-confirmed'
    | 'suite-navigation' | 'import' | 'export' | 'retry' | 'reset' | 'report' | 'unknown';
export interface Correlation {
    readonly scopeId: string;
    readonly session: string;
    readonly suite: string;
    readonly submission: string;
    readonly operation: string;
}
export interface SourceLocation {
    readonly path: string;
    readonly line: number | null;
    readonly column: number | null;
}
export interface ErrorDetails {
    readonly name: string;
    /** Fixed catalog text or [redacted]; never arbitrary exception text. */
    readonly message: string;
    readonly code: CauseCode;
    readonly kind: string;
    readonly stack: readonly SourceLocation[];
    readonly cause: ErrorDetails | null;
}
export interface Environment {
    readonly runMode: 'file' | 'http' | 'subpath' | 'unknown';
    readonly browser: 'chromium' | 'firefox' | 'safari' | 'unknown';
    readonly browserVersion: string;
    readonly platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown';
    readonly online: 'online' | 'offline' | 'unknown';
    readonly context: 'main' | 'reading' | 'listening' | 'legacy' | 'worker' | 'unknown';
}
export interface Breadcrumb {
    readonly action: Action;
    readonly module: ModuleName;
    readonly timestamp: number | null;
    readonly outcome: 'started' | 'succeeded' | 'failed' | 'unconfirmed' | 'cancelled' | 'unknown';
    readonly correlation: Correlation;
}
export interface CollectionStatus {
    readonly entryCoverage?: EntryCoverage;
    readonly source: 'bootstrap' | 'business' | 'console' | 'global' | 'resource' | 'storage' | 'relay' | 'unknown';
    readonly coverage: 'complete' | 'partial' | 'unknown';
    readonly aggregation: 'local' | 'complete' | 'incomplete' | 'unknown';
    readonly redaction: 'allowlist-v1';
    readonly limitations: readonly string[];
    readonly issues: readonly string[];
}
export interface DiagnosticEvent {
    readonly schemaVersion: 1;
    readonly appVersion: string;
    readonly buildId: string;
    readonly eventId: string;
    readonly windowId: string;
    readonly sequence: number;
    readonly timestamp: number;
    readonly fingerprint: string;
    readonly code: OperationCode;
    readonly causeCode: CauseCode;
    readonly module: ModuleName;
    readonly action: Action;
    /** One independent occurrence per event; duplicate observations do not increment it. */
    readonly repetitionCount: 1;
    readonly error: ErrorDetails;
    readonly resource: SourceLocation & { readonly status: number | 'unknown'; readonly optional: boolean | 'unknown' };
    readonly correlation: Correlation;
    readonly environment: Environment;
    readonly persistence: { readonly operation: OperationPersistence; readonly diagnostics: DiagnosticPersistence;
        /** Relays preserve the originating generation; unknown is not durable input. */
        readonly generation: string };
    readonly notification: {
        readonly kind: 'none' | 'transient' | 'persistent' | 'dialog' | 'startup';
        readonly requiresDismissal: boolean;
    };
    readonly retry: {
        readonly available: boolean;
        readonly action: Action;
        readonly operationAlias: string;
        readonly submissionAlias: string;
    };
    readonly breadcrumbs: readonly Breadcrumb[];
    readonly collection: CollectionStatus;
}
export interface DiagnosticInput {
    readonly code?: OperationCode;
    readonly module?: ModuleName;
    readonly action?: Action;
    readonly error?: unknown;
    /** Use when a reused Error object represents another operation attempt. */
    readonly newOccurrence?: boolean;
    readonly resource?: { readonly url?: unknown; readonly line?: number; readonly column?: number; readonly status?: number; readonly optional?: boolean };
    /** Explicit user cancellation suppresses critical notification in the reporter. */
    readonly cancelled?: boolean;
    readonly correlation?: Partial<Record<CorrelationKind, string>>;
    /** Aliases received through the validated session/channel handshake. */
    readonly correlationAliases?: Correlation;
    readonly persistence?: Partial<DiagnosticEvent['persistence']>;
    readonly notification?: Partial<DiagnosticEvent['notification']>;
    readonly retry?: { readonly available?: boolean; readonly action?: Action };
    readonly breadcrumbs?: readonly {
        readonly action: Action;
        readonly module?: ModuleName;
        readonly timestamp?: number;
        readonly outcome?: Breadcrumb['outcome'];
        readonly correlation?: Partial<Record<CorrelationKind, string>>;
        readonly correlationAliases?: Correlation;
    }[];
    readonly collection?: Partial<CollectionStatus>;
}
export interface CorrelationScope {
    readonly id: string;
    alias(kind: CorrelationKind, value: unknown): string;
    dispose(): void;
}
export interface Normalizer {
    readonly windowId: string;
    /** Synchronous, immutable, <= 8 KiB of serialized UTF-8. No I/O. */
    normalize(input: DiagnosticInput | unknown): DiagnosticEvent;
    /** Revalidate storage, relay, or export input. Invalid identity/version returns null. */
    sanitizeEvent(input: unknown): DiagnosticEvent | null;
}
export interface WindowIdentity { readonly windowId: string; }
export function createCorrelationScope(): CorrelationScope;
export function createWindowIdentity(): WindowIdentity;
export function createNormalizer(options?: {
    appVersion?: string;
    buildId?: string;
    environment?: Partial<Environment>;
    correlationScope?: CorrelationScope;
    windowIdentity?: WindowIdentity;
}): Normalizer;
export function utf8Bytes(value: string): number;
export const SCHEMA_VERSION: 1;
export const LIMITS: Readonly<{
    eventBytes: 8192; stackFrames: 20; causeDepth: 3; breadcrumbs: 50;
    inputStringUnits: 8192; correlationEntries: 1024; correlationIdUnits: 512;
    repetitionWindowMs: 60000; snapshotEvents: 200;
}>;
export const CODES: readonly OperationCode[];
export const CAUSE_CODES: readonly CauseCode[];
export const MESSAGES: Readonly<Record<OperationCode, string>>;
export const PROJECT_PATHS: readonly string[];
export const COVERAGE_LIMITATIONS: readonly string[];

// Interfaces for A2/A3/B1/B2/C1. Implementations belong to their work packages.
export interface Snapshot {
    readonly entryCoverage?: EntryCoverage;
    readonly schemaVersion: 1;
    readonly events: readonly DiagnosticEvent[];
    readonly persistence: DiagnosticPersistence;
    readonly coverage: 'complete' | 'partial' | 'unknown';
    readonly truncated: boolean;
    readonly storage?: DiagnosticStorageStatus;
    readonly transport?: DiagnosticTransportStatus;
}
export interface EntryCoverage {
    readonly entry: 'listening-wrapper' | 'listening-bridge' | 'legacy-enhancer' | 'unknown';
    readonly capture: 'before-dependencies' | 'late-injection' | 'unknown';
    readonly limitations: readonly string[];
}
export function sanitizeEntryCoverage(input: unknown): EntryCoverage;
export interface DiagnosticTransportStatus {
    readonly connection: 'waiting' | 'connected' | 'disconnected' | 'unavailable' | 'incomplete' | 'unknown';
    readonly aggregation: 'incomplete';
    readonly pendingEvents: number;
    readonly pendingBytes: number;
    readonly dropped: number;
}
export function sanitizeTransportStatus(input: unknown): DiagnosticTransportStatus | null;
export interface DiagnosticStorageStatus {
    readonly persistence: DiagnosticPersistence;
    readonly enabled: boolean;
    readonly generation: string;
    readonly cutoff: number;
    readonly suspended: boolean;
    readonly phase: 'active' | 'resetting' | 'reset-complete';
    readonly failure: 'COORDINATION_UNAVAILABLE' | 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'TRANSACTION_ABORTED'
        | 'TRANSACTION_FAILED' | 'OPEN_BLOCKED' | 'OPEN_TIMEOUT' | 'TRANSACTION_TIMEOUT' | 'DELETE_BLOCKED' | null;
    readonly coverage: 'complete' | 'partial';
    readonly pendingEvents: number;
    readonly pendingBytes: number;
    readonly dropped: number;
    readonly detailedMode?: Readonly<{ active: boolean; expiresAt: number; remainingMs: number;
        coordination: 'supported-windows' | 'unavailable' }>;
}
export interface SnapshotQuery {
    readonly eventId?: string;
    readonly limit?: number;
}
export interface IncidentReader {
    /** Passive memory lookup, keyed by event identity, without active diagnostics. */
    getIncident(eventId: string): DiagnosticEvent | null;
    /** Passive immutable copy; no resource probes, writes, or practice windows. */
    snapshot(query?: SnapshotQuery): Snapshot;
}
export interface DiagnosticSink {
    /** Async, identity-keyed upsert of already normalized events; may reject. */
    append(events: readonly DiagnosticEvent[]): Promise<{ persistence: DiagnosticPersistence;
        persistedEventIds?: readonly string[]; status?: DiagnosticStorageStatus }>;
    /** Passive durable lookup/snapshot; readers revalidate every returned record. */
    getIncident(eventId: string): Promise<DiagnosticEvent | null>;
    snapshot(query?: SnapshotQuery): Promise<Snapshot>;
    status?(): DiagnosticStorageStatus;
    subscribe?(listener: (change: { type: 'barrier' | 'retry' | 'status'; status: DiagnosticStorageStatus }) => void): () => void;
    retry?(): Promise<{ success: boolean; status: DiagnosticStorageStatus }>;
}
export interface DiagnosticReporter extends IncidentReader {
    /** Normalize before any buffer/queue. Always return the event ID synchronously. */
    report(input: DiagnosticInput): string;
    /** Bounded, isolated observers of normalized reports, not persistence acknowledgements. */
    subscribe(listener: (event: DiagnosticEvent) => void): () => void;
    /** Await pending writes; isolate sink failures without recursively reporting them. */
    flush(): Promise<{ persistence: DiagnosticPersistence }>;
}
export interface RepetitionGroup {
    readonly fingerprint: string;
    readonly firstTimestamp: number;
    readonly lastTimestamp: number;
    /** Unique event IDs in the 60-second notification window, never observations. */
    readonly eventIds: readonly string[];
    readonly repetitionCount: number;
}
