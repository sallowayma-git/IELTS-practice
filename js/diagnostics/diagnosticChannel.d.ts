import type { Collector } from './bootstrapCollector';
import type { DiagnosticSink, DiagnosticTransportStatus } from './diagnosticContract';
export as namespace AppDiagnosticChannel;

export interface Binding {
    window: Window;
    sessionId: string;
    /** Control-envelope credential only. Never supply it to report(), breadcrumbs or export. */
    windowSessionToken: string;
    /** Exact HTTP(S) origin, or 'null' with explicitly allowed opaque file origin. */
    origin: string;
    allowOpaqueOrigin?: boolean;
}
export interface Host {
    /** Returns true for all reserved diagnostic envelopes, including ignored invalid input. */
    receive(event: MessageEvent): boolean;
    dispose(): void;
}
export interface Child extends Host {
    /** Call only AFTER the runtime validates INIT_SESSION. Replacement drops the old relay queue. */
    connect(binding: Binding): boolean;
    status(): DiagnosticTransportStatus;
}
export const TYPE: 'IELTS_DIAGNOSTIC_V1';
export const LIMITS: Readonly<{ envelopeBytes: number; batchEvents: 8; queueEvents: 200;
    queueBytes: number; attempts: 3; retryMs: 500; messagesPerInterval: 64; intervalMs: 10000 }>;
export function isMessage(input: unknown): boolean;
export function createHost(options: { reporter?: Collector; store?: DiagnosticSink; getBinding(): Binding | null }): Host;
/** Idempotent per reporter until disposed. Installs no business handlers. */
export function createChild(options?: { reporter?: Collector; store?: DiagnosticSink }): Child;
