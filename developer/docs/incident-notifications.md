# Persistent incident notifications (B2 / #200)

`MessageCenter` preserves `showMessage(message, type, duration)`, including its
replacement and timeout behavior. Incident notifications have a separate owner,
`IncidentCenter`, shipped immediately before MessageCenter in `ui-shell.bundle.js`.
A transient success/info message, its timer, or `MessageCenter.dismiss()` cannot
close an incident. The early startup collector still owns its independent failure
panel and export controls; B2 does not replace it or hide an unresolved startup
failure when initialization reports success.
An active startup failure takes priority over modal presentation so its independent
export stays reachable. Pending dialogs resume when the collector explicitly marks
startup ready; their save outcomes and dismissal states remain unchanged.

## Reporting and presentation

```js
const messages = getMessageCenter();
const eventId = messages.reportIncident({
    code: 'PRACTICE_SAVE_FAILED', module: 'practice', action: 'submit', error,
    correlation: { operation: originalOperationId, submission: originalSubmissionId },
    persistence: { operation: 'unconfirmed' }
});

// If the boundary already captured the error, reuse its event identity:
messages.showIncident(eventId);
// The same method accepts a schema-validated DiagnosticEvent from passive lookup.
messages.showIncidentHistory();

// Expected conditions and successful recovery are still recorded:
messages.reportIncident(input, { impact: 'expected' });
messages.reportIncident(input, { impact: 'recovered' });
```

The declarations are in [`message-center.d.ts`](../../js/presentation/message-center.d.ts).
`reportIncident` records synchronously through the existing reporter before any
UI work, and returns that observation's event ID. Error propagation therefore
retains the existing Error-object identity rules. `showIncident` revalidates the
event and returns the first reference of its notification group; this may differ
from the newer observation's ID. It does not write diagnostic or practice data.

The new `AppDiagnostics.subscribe(listener)` interface observes normalized reports
after capture, including identity-preserving enrichments. It is bounded to 16
subscribers, isolates synchronous throws and Promise rejections, and returns an
unsubscribe function. Reentrant reports from observers cannot create recursive
events. This is a report stream, not a storage-commit acknowledgement stream.
MessageCenter subscribes once and reads the existing memory snapshot at creation,
so an explicitly classified failure captured before UI initialization can surface.

Presentation follows the impact policy:

| Observation | Presentation |
| --- | --- |
| Expected/recovered, explicit cancellation, declared optional resource | Recorded without a critical notification |
| Operation failure with a confirmed outcome | Persistent notification with details/export |
| Unconfirmed submission, save, draft or recovery snapshot | One critical dialog requiring user handling or explicit dismissal |
| Startup failure | Existing persistent bootstrap panel and independent export |

Callers using `AppDiagnostics.report` directly opt into presentation with
`notification.kind`. `none` remains record-only. `requiresDismissal` and unconfirmed
save outcomes promote visible notifications to dialogs. B4 (#202) owns migration
of concrete business boundaries; changing a legacy `showMessage` call is not proof
that the operation was instrumented. B3 (#201) owns the full settings workflow.

## Outcomes and safe actions

Save wording distinguishes submission, draft and recovery snapshot. Only the
business layer's explicit `committed` state produces confirmed-save wording.
`not-committed` says the operation was not saved; `unconfirmed` asks the user to
keep the page open. Diagnostic persistence never proves that answers were saved.
Closing a dialog, including Escape, acknowledges its presentation only. It neither
rewrites the event nor promotes the operation's outcome nor deletes history.

Details, export, summary copy and dismissal are built-in actions. Retry is absent
unless the business operation supplies a safe callback matching the captured
operation alias, submission alias and allowlisted retry action:

```js
const event = AppDiagnostics.getIncident(eventId);
messages.showIncident(eventId, {
    retry: {
        action: event.retry.action,
        operationAlias: event.retry.operationAlias,
        submissionAlias: event.retry.submissionAlias,
        run: async () => {
            // Reconcile commit state and reuse original operation/submission IDs.
            // Only the business operation can implement this safely.
            return businessRetryOriginalOperation();
        }
    }
});
```

The captured event must already have `retry.available: true`, a valid operation
alias and an allowlisted action. Callbacks stay in bounded page UI state, outside
diagnostic buffers, storage and exports. A click invokes one callback at a time;
there is no automatic retry, reload, storage clearing or practice-window closure.
Committed and multi-occurrence notification groups cannot replay a callback.
Bindings retain their action and correlation aliases and are revalidated against
the current event before presentation and execution. Enrichment that disables
retry or changes those aliases clears the callback. A result arriving after its
binding was invalidated or its notification became an aggregate cannot confirm
the displayed outcome.
Active attempts are tracked separately from notification groups, by incident
identity and operation/submission aliases. Splitting a group, replacing its
representative, or supplying a new callback wrapper cannot start a second attempt
for that incident or operation while the first is pending. Replacement controls
stay disabled until fulfillment or rejection; closing or evicting a notification
does not release the attempt. Settlement clears the lock and only updates an
incident whose original grouping key and callback binding still match.

An ordinary fulfilled Promise or `{ success: true }` does not confirm persistence.
Only `{ verified: true, operation: 'committed' | 'not-committed' | 'unconfirmed' }`
updates the displayed retry outcome, and even that does not silently close the
incident. Callback failures use fixed text. The callback owns reporting its new
business result; historical capture is immutable. Closing a dialog during an
ongoing retry neither cancels nor replays that operation.

## Bounded notifications and history

| UI capacity | Limit |
| --- | --- |
| Visible persistent cards | 5 |
| Active modal | 1 |
| Waiting critical dialogs | 5 |
| Retained UI groups / callback slots | 20 |
| Pending retry attempts, including evicted notifications | 20 |
| Recently observed identities | 200 |
| Aggregation window | 60,000 ms from the first observation |
| History page | 20 events from the exporter's bounded snapshot |

When all retry slots are occupied, additional retry controls remain disabled until
an attempt settles. Group eviction cannot bypass this bound or replay a pending
operation under a new incident reference.

Repeating the same event ID does not increase the occurrence count. Independent
events aggregate only when their fingerprint, window, action, correlation aliases,
outcome and presentation match within the fixed window. Different known operations
never merge. A dismissed group stays dismissed for the remaining window. A later
independent occurrence can create a new notification.
Identity-preserving enrichment rechecks the grouping key: a member whose
classification, action, correlation, outcome or presentation changes leaves its
old aggregate. If it was the representative, another retained member supplies the
old group's reference. Open details refresh their heading, role and technical
text with the current representative. Transient completion is separate from user
dismissal, so a later unconfirmed-save classification still opens a critical
dialog unless the user explicitly acknowledged the incident.

Overflow does not schedule more modals or discard diagnostic events. The notification
region points to passive history, where retained events can be paged, opened by
reference and exported. History availability still follows A2/A3's documented
retention limits and storage capabilities. UI dismissal is page-local; it is not a
persisted resolution. Cross-window collection remains C1-C3's responsibility.

## Accessibility, text safety and failures

There is one `dialog`/`alertdialog` with a named heading and a description containing
the operation outcome. Tab and Shift+Tab remain within it, Escape dismisses it,
background nodes become inert with prior values restored, and focus returns to the
original control after the queue drains (or the history control if that control
was removed). Stable polite status text announces notifications and retry progress.
Details and actions wrap and scroll on narrow screens.

Captured events pass through the diagnostic allowlist again. Technical details use
`textContent`/textarea values only. Caller-owned getters and arbitrary markup are
never executed. Export and copy delegate to B1's passive bounded APIs, with the
selectable fallback textarea inside the dialog's focus boundary.

A rendering/details failure leaves a separate minimal DOM panel with the outcome,
incident reference, incident/history export, selectable text and explicit dismissal.
If richer export also fails, the bootstrap reporter's independent bounded text
snapshot remains available. Complete DOM failure still leaves bounded text on
`getMessageCenter().incidents.fallbackText`; in-page UI cannot display without a
working DOM. Neither fallback logs/reports its own failure recursively.

## Validation

```sh
node --test developer/tests/js/incidentCenter.test.js
node developer/tests/e2e/incident_notifications.node.js
node developer/tests/e2e/diagnostic_startup.node.js
node developer/tests/e2e/diagnostic_export.node.js
node scripts/build-bundles.mjs --check
```

Unit tests cover policy, identity, aggregation, capacity, privacy, callback binding,
verified outcomes and observer failure isolation. The browser fixture exercises
real keyboard/focus behavior, dismissals, history overflow, malicious markup,
single-flight retry across aggregation/enrichment and both settlement paths,
actual downloads, clipboard/file/renderer failures and mobile
layout in file, root HTTP and subpath HTTP modes. These are focused B2 checks;
final integrated release qualification remains C4 (#206).
