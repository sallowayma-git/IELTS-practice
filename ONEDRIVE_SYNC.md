# Optional OneDrive folder sync

This feature is built on `feature/multi-device-easy-deploy`. It adds an opt-in desktop folder transport alongside the branch's existing backend. It does not connect the backend record API or PostgreSQL to OneDrive.

## Choose a storage path

- The existing backend uses accounts, sessions and PostgreSQL for API records.
- Folder sync exchanges this browser's AppData / IndexedDB learning data through a folder that the OneDrive desktop client uploads and downloads.
- Signing into the backend does not grant folder permission, import server records into AppData, or send folder-synced records to PostgreSQL. There is no bridge between these stores.
- Download the GitHub ZIP, extract it, and put the entire project folder in your personal OneDrive. Open the site and authorize that project folder from the sync panel. The supplied backend excludes `user-data` from HTTP serving; when using another static server, exclude that directory yourself.

## First connection

1. Back up existing learning data with Export. Run the same version of this branch on each desktop computer, using Chrome / Edge with directory access and Web Locks support.
2. Open **Settings → Data management → OneDrive 自动同步** for first-time setup and full sync controls. A returning browser with expired folder permission also receives an automatic recovery dialog on the home page. No permanent sync button or separate banner container is added to the overview, browse, practice or more views. Attention notices reuse the existing disk-backup notification system.
3. Click **启用 OneDrive 同步**, select the project root in OneDrive, and allow read/write access. A compatible existing space connects automatically, including when selecting the old `user-data` directory directly. Existing space IDs and marker files are preserved.
4. Only for a complete project with no sync directory, the app asks before initializing a space. Confirm only if sync has never been enabled on another computer and OneDrive has finished downloading. On every other computer use the same **启用 OneDrive 同步** button after download; no separate create/join choice is needed.
5. Set `user-data` to **Always keep on this device** in OneDrive. Finish a synthetic practice on A, wait for local publication and OneDrive transfer, then verify it on B. Test the reverse direction too.

An existing `user-data` directory without a valid marker, empty/truncated markers and incompatible versions stop connection without creating a replacement. A project missing required root files cannot be initialized. If a sync directory arrives during confirmation, it is inspected again. A browser that has already used a space cannot initialize a different one through this entry. The browser cannot inspect OneDrive cloud status: if the entire sync directory has not arrived, cancel the initialization prompt and wait for the client. Never manually create or edit internal JSON files.

Every computer needs an initial grant. The binding and enabled setting are remembered in this browser. On later visits, valid permission resumes synchronization automatically without choosing a folder or clicking restore. If permission has expired, the home page automatically opens **恢复 OneDrive 同步** before any interaction; use its **恢复同步** button to authorize the saved folder directly, without visiting settings. If offered, choose **每次访问都允许 / Allow on every visit** to retain permission. A denial keeps pending data local and allows explicit retry. **稍后再说** or Escape defers recovery until the next visit; manual recovery remains available in settings. Startup displays **正在恢复本机同步设置** while loading. Once authorized, the panel shows **自动同步已开启** and hides setup / recovery actions. The browser controls permission persistence; authorization cannot be bypassed or guaranteed forever. When direct `file://` directory access is unavailable, use a fixed localhost address. Browser, origin, protocol and port changes can select a different local database; export from the old entry and use incremental import before connecting the new entry.

Completed commits schedule publication automatically. A visible page checks approximately every 15 seconds, and returning to the page also schedules a check. **立即同步** requests a check now. OneDrive transfer latency is separate; closed pages receive changes the next time they open.

## Data and merge rules

| Data in this branch | Behavior |
|---|---|
| Completed reading, listening and suite attempts | Keep summary, answer details and annotations together; separate attempt IDs remain separate |
| Vocabulary words, lists and user configuration | Merge independent entries; retain alternatives for competing edits, including word review-state conflicts |
| Goals, library configurations / imported indexes and manual achievement flags | Sync domain data; library configuration does not include question or audio files |
| Theme, reading display and timer preferences | Optional; only the selected portable preference fields are exchanged |
| Active practice windows, unfinished drafts, timing locks, device paths / handles and backend credentials | Remain local or under the existing backend's control |

This branch does not have the newer static edition's normalized reading-vocabulary graph or separate practice review-plan APIs. This contribution does not backport those features. Its workspace format is `ielts-atlas-folder-sync-multidevice`, deliberately different from the newer static prototype; use a new dedicated space. Do not connect both implementations to one data directory.

Changes and the durable outbox are written in one IndexedDB transaction. Failed publication or lost permission leaves queued changes available after a restart. Each browser writes immutable operation files under a separate writer ID. Operation IDs and SHA-256 detect duplicates or changed content; causal versions distinguish later changes from concurrent ones.

Independent records merge. Competing edits and edit/delete races retain alternatives in the panel. Selecting a version publishes a new resolution; it does not erase the original log. Explicit deletion creates a tombstone. Replaying older operations does not resurrect causally superseded records. Receiving one operation that deletes at least 10 attempts and at least half of local attempts requires confirmation.

**已写入同步文件夹** means the local file closed and passed a read-back check. It does not mean OneDrive uploaded it. The OneDrive client is the source of transfer status. SHA-256 checks consistency; files contain plaintext learning data and are not encrypted or authenticated.

## Backup, reset and recovery

Connecting first creates an application backup. Sync identity, queues and directory handles are not included in ordinary portable exports. Existing disk backups remain a separate snapshot feature with an independent binding.

Disconnecting preserves local learning data and on-disk logs. Reconnecting resumes that space. A fresh browser profile can reconstruct data from retained logs using a new writer ID. Do not manually edit workspace files or tombstones.

The application's local site reset coordinates with the worker under the existing reset lock and installs a durable barrier in the same IndexedDB system store used by every learning-write transaction. Earlier writes finish before the barrier and are published; later writes from other tabs are rejected before committing until reset completes. Failed reset releases the barrier. If the reset tab is interrupted, retry the site reset to finish recovery. Unbound browsers can still reset when AppData initialization fails; a binding, pending data or unreadable sync state fails closed. It refuses to clear while unpublished data cannot be flushed. Clearing a local browser is not published as remote deletion. This protection cannot prevent data loss from manually clearing browser storage outside the application.

History is retained without automatic checkpointing or garbage collection. A file larger than 32 MB is rejected and its pending operation remains queued. Long-running, large-history performance needs further evaluation.

## Build and test

Use this branch's existing lockfiles; no dependency version upgrade is required. From the source root:

```sh
npm ci --prefix developer
node developer/node_modules/playwright/cli.js install chromium --only-shell
node scripts/build-bundles.mjs
node scripts/build-bundles.mjs --check
npm --prefix developer run test:sync
npm --prefix developer test
```

On Windows use `npm.cmd` if PowerShell blocks the npm script. A process-scoped `PLAYWRIGHT_BROWSERS_PATH` may point to your configured shared browser cache for both installation and execution.

To test the real backend HTTP entry with isolated in-memory stores:

```sh
npm ci --prefix backend
npm --prefix backend test
npm --prefix developer run test:sync:backend
```

The last command requires both project-local dependency directories. It serves production pages through `backend/src/app.js`, substitutes the directory chooser with an isolated real browser directory and observes automatic publication. It does not verify PostgreSQL persistence, Docker or OneDrive transfer.

See [verification results](developer/doc/OneDrive-Sync-Verification.md) and the [two-computer manual checklist](developer/doc/OneDrive-Sync-Manual-Test.md).

Sync attention messages use the existing disk-backup notification system, with no global sync button or separate banner container. Identical ongoing attention states do not repeat on each poll; detailed controls remain in Settings → Data management.

Saved binding recovery starts as soon as the runtime loads, before DOMContentLoaded or settings navigation. With a valid grant, the first sync pass runs immediately during startup. If permission has expired, the home page automatically displays **恢复 OneDrive 同步**, without waiting for any click or settings visit. Click **恢复同步** in that dialog to request browser authorization for the saved folder. A successful grant closes the dialog and publishes queued records without choosing another folder or changing the space ID. A denial leaves the dialog available for an explicit retry and preserves the queue. **稍后再说** or Escape closes the dialog and suppresses automatic permission requests for the rest of this visit; a later visit offers recovery again. Unconfigured or explicitly disconnected browsers do not receive this dialog. Browser-required permission confirmation still cannot be skipped. See the [Chrome File System Access documentation](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#security_and_permissions).

Enable, restore, immediate sync, disconnect and preference actions use the same shared success/error notifications as other settings buttons. Permission recovery has a distinct in-progress state, so obsolete pause/error notices do not appear while permission is being restored. A later verified sync pass clears stale manual-action errors as well as background warnings, without dismissing an unrelated backup notification. Real remaining file errors, conflicts and deletion approvals still require attention.
