# OneDrive sync: two-computer acceptance

These cases are pending manual execution. Automated file copying is not a substitute for OneDrive upload/download.

## Setup

Use two desktops with the same code from this contribution, Chrome / Edge, the OneDrive client and separate test browser profiles. Export any existing data first. Put the extracted GitHub ZIP project folder in personal OneDrive, and set its `user-data` to Always keep on this device. The supplied backend excludes that directory from HTTP serving.

On A and B, use Settings → Data management → OneDrive 自动同步 → **启用 OneDrive 同步** and select the project root. Only the first initialization needs confirmation. On B wait for the existing space to download. Keep a fixed entry URL on each computer. Do not use the earlier static prototype's space: this branch has a distinct protocol profile and vocabulary schema.

## Cases

| Case | Action | Expected result | Actual |
|---|---|---|---|
| 1 | A completes a synthetic practice; wait for local write and OneDrive transfer; open B | B has the full summary, answers and annotations once; statistics are not duplicated | Pending |
| 2 | B completes another attempt, including a second attempt of the same article | Both attempts eventually appear on both devices | Pending |
| 3 | Both work offline, then reconnect | Independent additions merge; pending queues drain when folder permission and transport are available | Pending |
| 4 | Make a local commit without folder permission, close/reopen, then reauthorize | Queued data survives and publishes after reauthorization | Pending |
| 5 | From a shared baseline, edit the same annotation offline on both devices | Both alternatives are visible; selecting one converges on the other device | Pending |
| 6 | One device deletes while the other edits the same attempt offline | Delete/edit alternatives survive; an ordinary causal deletion is not undone by old log replay | Pending |
| 7 | A sends one operation deleting at least 10 attempts and at least half of B's attempts | B waits for explicit confirmation before applying that operation | Pending |
| 8 | Add vocabulary independently; then edit the same word review state offline on both | Independent words merge; competing review states remain complete alternatives | Pending |
| 9 | Disconnect/reconnect; also join from a fresh browser profile | Disconnect does not delete files or local records; a new writer can reconstruct retained history | Pending |
| 10 | Use the app's local site reset while pending data cannot be flushed | Reset refuses to discard the queue; local clearing is not a remote deletion | Pending |
| 11 | Export/import and use disk backup with sync disabled and enabled | Existing workflows remain usable; portable exports omit sync metadata; bindings remain independent | Pending |
| 13 | On B pause OneDrive with a partial user-data directory / missing marker, then enable sync | Connection stops; no replacement marker or space is created | Pending |
| 14 | Upgrade an existing synced browser and select either project root or old user-data directory | Same space ID and marker; existing history preserved | Pending |
| 15 | Pause reset preparation, then submit a practice from another tab | Later write rejected; all earlier accepted writes published before deletion | Pending |
| 12 | Pause OneDrive after a local publication | The app reports local folder write only; it does not claim cloud delivery | Pending |

Test both direct file:// (where supported) and the deployed frontend through a secure context. Remote HTTP without a secure context may not expose the directory APIs; mobile browsers and backend API / PostgreSQL bridging are outside this feature.

## Reporting

Record commit SHA, both OS/browser/OneDrive versions, entry URLs, case number, exact steps, expected/actual results, queue counts and conflicts. Separate local write, OneDrive transfer and receiver application. Remove personal answers, account details and full question material from public attachments.

Damage/reordering tests should use copies in an isolated test space only. Do not edit or remove production operation logs or tombstones.
