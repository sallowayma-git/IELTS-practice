import type { Action, Correlation, DiagnosticInput, ModuleName, OperationCode, OperationPersistence } from './diagnosticContract';
import type { VerifiedRetryResult } from '../presentation/message-center';

export interface OperationFailure {
    code: OperationCode;
    module: ModuleName;
    action: Action;
    error?: unknown;
    correlation?: DiagnosticInput['correlation'] | Correlation;
    resource?: DiagnosticInput['resource'];
    /** Explicit business evidence; otherwise the facade's known failure state or unconfirmed. */
    operation?: OperationPersistence;
    cancelled?: boolean;
    expected?: boolean;
    retryAction?: Action;
}
declare global {
    const AppOperationDiagnostics: Readonly<{
        /** Synchronous reference; capture and presentation failures never escape. */
        failure(input: OperationFailure, retry?: () => Promise<VerifiedRetryResult>): string | null;
        breadcrumb(module: ModuleName, action: Action,
            outcome: 'started' | 'succeeded' | 'failed' | 'unconfirmed' | 'cancelled',
            correlation?: DiagnosticInput['correlation'] | Correlation): void;
    }>;
}
