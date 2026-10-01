import type { Correlation, ModuleName, Action, OperationCode, CauseCode } from './diagnosticContract';
export as namespace AppPracticeDiagnostics;

export interface PracticeDiagnostics {
    /** Call only after business INIT source, origin and token validation. */
    connect(state: { parentWindow: Window; parentOrigin: string; parentOriginIsOpaque: boolean;
        sessionId: string; suiteSessionId?: string; windowSessionToken: string }, data: { diagnosticCorrelation?: unknown }): void;
    correlation(submission?: string): Correlation | undefined;
    step(action: Action, outcome: 'started' | 'succeeded' | 'failed' | 'unconfirmed' | 'cancelled', submission?: string): void;
    failure(code: OperationCode, action: Action, operation?: 'committed' | 'not-committed' | 'unconfirmed',
        submission?: string, retry?: () => unknown, error?: unknown, resource?: { url?: string; optional?: boolean }): string | null;
    /** Observes a business snapshot; never receives or persists the snapshot itself. */
    watch(submissionId: string, retry?: () => unknown): void;
    outcome(submissionId: string, committed: boolean, operation?: 'not-committed' | 'unconfirmed', causeCode?: CauseCode): void;
    ready(parent?: Window | null): void;
    /** Expose local export independently of asynchronous runtime initialization. */
    access(): void;
    dispose(): void;
}
export function create(module: ModuleName): PracticeDiagnostics;
