import type { Action, DiagnosticEvent, DiagnosticInput, OperationPersistence } from '../diagnostics/diagnosticContract';

export interface SafeIncidentRetry {
    /** Match the captured event's retry descriptor, including both original aliases. */
    action: Action;
    operationAlias: string;
    submissionAlias: string;
    /** The business layer owns reconciliation, original identifiers and idempotency. */
    run(): unknown | Promise<unknown>;
}
export interface VerifiedRetryResult {
    verified: true;
    operation: OperationPersistence;
}
export interface IncidentPresentation {
    /** reportIncident records expected/recovered observations without interrupting the user. */
    impact?: 'failure' | 'expected' | 'recovered';
    retry?: SafeIncidentRetry;
}
declare global {
    class MessageCenter {
        constructor(options?: { containerId?: string });
        static getInstance(options?: { containerId?: string }): MessageCenter;
        show(message: string, type?: string, duration?: number): HTMLElement | null;
        /** Only dismisses the legacy transient message. */
        dismiss(delay?: number, target?: HTMLElement): void;
        /** Captures first; returns this observation's event ID synchronously. */
        reportIncident(input: DiagnosticInput, presentation?: IncidentPresentation): string | null;
        /** Shows normalized evidence or an existing page reference; returns the notification group reference. */
        showIncident(eventOrId: DiagnosticEvent | string, presentation?: IncidentPresentation): string | null;
        showIncidentHistory(): Promise<void> | undefined;
        deliverDiagnostics(eventId: string | null, textTarget: HTMLTextAreaElement,
            action?: 'download' | 'copySummary'): Promise<{ status: string; text: string }> | undefined;
    }
    function getMessageCenter(): MessageCenter;
    function showMessage(message: string, type?: string, duration?: number): HTMLElement | null;
    function showIncident(eventOrId: DiagnosticEvent | string, presentation?: IncidentPresentation): string | null;
}
