# Errors and diagnostics settings (B3 / #201)

The **Errors and diagnostics** disclosure in the existing settings view is a
passive, keyboard-accessible entry to recent incidents, reference lookup, context,
save and diagnostic persistence status, JSON export and selectable summaries.
It is separate from learning-data backup/import and the broader site-data reset.
Opening this view does not start active `SystemDiagnostics`, probe resources,
open practice windows, retry business operations or reset data.

The resident UI module is `js/components/diagnosticSettingsPanel.js`, shipped in
`ui-shell.bundle.js`. It uses the B1 passive exporter and the B2 notification
workflow's shared `MessageCenter.deliverDiagnostics(eventId, textTarget, action)`
fallback (`action` is `download` or `copySummary`). Failed history reads retain
available current-page events. Unknown references, missing storage, failed
clearing, file-download failures and denied clipboard access retain usable text
and export controls. Technical details are revalidated and rendered as text.
The UI sorts a copy of the bounded snapshot by descending timestamp, then
descending sequence and ascending event ID, before paginating in groups of 20.
The notification history uses the same display order; export timelines retain
their per-window sequence order and do not imply synchronized window clocks.
Refreshes revalidate a selected reference separately when it is absent from the
bounded history report. Incomplete revalidation preserves the last available
context with an explicit notice; superseded refreshes and lookups cannot replace
a newer selection. Current-page context can remain visible after
durable history is cleared or disabled, and the UI explains that distinction.

`AppActions.openDiagnosticsSettings(eventId?)` opens the settings view and can
preselect a reference. `DiagnosticSettingsPanel.open(eventId?)` opens the
disclosure directly. These are navigation helpers, not incident notifications.

## Persistence and coordination

**Retry diagnostic storage** explicitly calls `AppDiagnosticStore.retry()` before
refreshing history. It can recover latched transient failures without clearing
history, changing the persistence preference/generation, or retrying business
operations. The action reports success or continued failure and is disabled
during other lifecycle actions, while persistence is off, or after suspension.
Opening the panel, ordinary refreshes, lookups and exports remain passive reads.

The checkbox calls `AppDiagnosticStore.setEnabled`; diagnostic-only clearing
calls `AppDiagnosticStore.clear`. Both use the existing lifecycle lock,
generation fence and database deletion. A pending/blocked deletion never claims
completion. Failed operations reconcile to the store's actual status. Neither
action touches AppData, learning backups, practice sessions or recovery data.
Current-page memory remains available for immediate feedback and explicit export;
re-enabling does not replay evidence invalidated by the lifecycle fence.

The UI states the existing seven-day, 2,000-event and 2 MiB retention ceilings and
exposes memory-only/disabled/failure status. A cross-window guarantee is limited
to instrumented windows with shared origin storage and supported Web Locks and
Web Storage. Other origins, some file environments, and unintegrated practice
pages are not implied to be covered. The store remains the authoritative owner;
notifications are hints and status reads reconcile the durable control record.

## Detailed mode lease

`await AppDiagnosticStore.setDetailedMode(enabled)` returns `{ success, status }`.
`status.detailedMode` contains `active`, `expiresAt`, `remainingMs`, and
`coordination` (`supported-windows` or `unavailable`). Exported storage status
revalidates these fields. `AppDiagnosticStorage.DETAILED_MODE_MS` is 900,000.

The existing diagnostic control record additionally stores `detailedStartedAt`
and `detailedUntil`. Missing fields in older records mean mode off. Invalid or
overlong leases are ignored without invalidating the persistence/reset fence.
The fixed control-record reservation is 384 characters so future lifecycle and
mode changes still fit when other localStorage users fill the origin.

Mode updates acquire the same lifecycle lock, preserve current persistence
preferences and event generations, and publish the fixed expiry. Repeated enable
requests during an active lease do not renew it. Reload/new-window startup reads
the original expiry; no countdown timer is authoritative. Every detailed
breadcrumb checks the current lease, so background throttling and missed change
notifications do not extend capture. An observed expiry cannot be revived by a
backwards clock adjustment during that window's lifetime. Full reset clears the
lease and preserves the existing suspension of surviving writers.

`AppDiagnostics.breadcrumb(input, { detailed: true })` adds an optional gate to
the existing semantic breadcrumb API. Ordinary calls remain compatible. Declared
resource-load attempts supply additional `bootstrap/load-resource/started`
breadcrumbs in detailed mode. There are no key/input/click collectors. All input
still uses the same allowlist, redaction, 50-breadcrumb and 8 KiB event ceilings;
the 200-event / 256 KiB memory and durable limits are unchanged. History opt-out
can coexist with a shared detailed lease for bounded current-page context. An
unavailable IndexedDB does not prevent mode coordination when the lifecycle
control can still be safely written; unavailable coordination prevents enabling.

The open settings panel refreshes the visible remaining time each second and on
resume. It does not announce each tick to screen readers. Native disclosure,
form, checkbox and button controls provide keyboard access without another modal
or focus trap. Export fallbacks focus/select their read-only text field.

## Validation and handoff

- `developer/tests/js/diagnosticStore.test.js`: real IndexedDB, concurrent
  preference/mode changes, startup/reload, fixed expiry, clock rollback, missed
  notifications, unchanged redaction/capacity, invalid leases and denied writes.
- `developer/tests/e2e/diagnostic_settings.node.js`: extracts the diagnostic
  modules from shipped bundles using the generated source mapping and exercises
  file, root HTTP and subpath HTTP settings workflows, downloads, clipboard/text
  fallback, memory-only/disabled/failure states and mobile layout. Review
  regressions cover cross-window recency pagination in both history views,
  non-destructive retry after transient storage failures, references omitted by
  the report byte budget, and superseded asynchronous selection reads.
- Existing startup, passive export, notification, full-reset and suite-practice
  regressions cover the integration boundaries. CI runs the focused settings flow.

B2 (#200) remains the prerequisite. Concrete business boundary reporting is B4
(#202); validated practice transport/integration remain C1-C3 (#203-#205).
Final integrated release qualification remains C4 (#206).
