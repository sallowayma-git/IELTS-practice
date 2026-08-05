/**
 * Destructive browser-site reset.
 *
 * This path deliberately bypasses AppData domain mutations. A reset must not
 * append operation journals, rebuild projectors, or flush an empty snapshot to
 * the bound external backup folder.
 */
(function initSiteDataReset(global) {
    'use strict';

    if (global.SiteDataReset && global.SiteDataReset.__v2 === true) {
        if (typeof global.clearCache !== 'function') {
            global.clearCache = global.SiteDataReset.request;
        }
        return;
    }

    var DATABASE_NAMES = Object.freeze([
        'IELTSAtlasDataV2',
        'ExamSystemDB',
        'IELTSAtlasExternalBackupV2'
    ]);
    /**
     * How long a `blocked` deletion is allowed to keep waiting before it is
     * reported as a failure.
     *
     * A cooperative peer (data kernel connections install `onversionchange` and
     * close immediately) releases the database within a tick, while a peer that
     * is in the middle of a long write can legitimately hold it for a few
     * seconds. Waiting far beyond that only makes an unrecoverable block look
     * like a frozen UI, and every database is deleted in parallel, so this is
     * the worst case for the whole reset rather than a per-database cost.
     */
    var BLOCKED_DELETE_TIMEOUT_MS = 8000;
    var EXTERNAL_BACKUP_QUIESCE_TIMEOUT_MS = 8000;
    /**
     * `IDBFactory.deleteDatabase()` has no `abort()`. Once the blocked timeout
     * wins, the browser keeps the request armed and will drop the database the
     * moment the peer connection closes — possibly minutes later, possibly after
     * this page reloaded and started using a freshly created database.
     *
     * `pendingDeletions` is that un-cancellable tail: a database name stays here
     * from the moment we give up waiting until the browser actually reports the
     * request as done. While a name is listed the reset is "armed but not
     * finished", which is a materially different state from both "succeeded" and
     * "failed" and must be surfaced as such.
     */
    var pendingDeletions = new Map();
    var pendingDeletionSequence = 0;
    /**
     * Cross-refresh recovery marker.
     *
     * A reloaded page cannot observe the previous page's `IDBRequest` — that
     * object died with the old realm — so the in-memory registry above is lost on
     * every reload. The marker carries the *fact* that a reset is still armed
     * across the reload so the new page can tell the user the truth instead of
     * looking pristine.
     *
     * It never re-arms a delete by itself. A later realm must obtain explicit
     * recovery confirmation before it may queue a replacement deletion.
     */
    var PENDING_DELETION_MARKER_KEY = 'ielts_atlas:v2:site-reset:pending-deletions';
    var WINDOW_NAME_MARKER_PREFIX = '__IELTS_ATLAS_SITE_RESET__:';
    /**
     * The marker is written *after* `clearWebStorage()` (it would be wiped
     * otherwise), which means it is the one key that survives a "clear
     * everything" run. Age is used to strengthen the recovery warning, not to
     * guess that the underlying request completed. Explicit recovery confirmation
     * is the bounded escape hatch for a marker whose old realm is gone forever.
     */
    var PENDING_DELETION_MARKER_TTL_MS = 600000;
    var adoptedPendingDatabases = [];
    var adoptedPendingMarkerState = null;
    var resetPromise = null;

    function nowMs() {
        try {
            if (typeof Date === 'function' && typeof Date.now === 'function') return Date.now();
        } catch (_) { /* exotic host */ }
        return 0;
    }

    function notify(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type || 'info');
        } else if (global.console && typeof global.console.log === 'function') {
            global.console.log('[SiteDataReset] ' + message);
        }
    }

    // Timers are looked up defensively: this module is also loaded inside test
    // realms and worker-like hosts that do not expose the full window surface.
    function hostSetTimeout(callback, delay) {
        try {
            if (global && typeof global.setTimeout === 'function') {
                return { id: global.setTimeout(callback, delay), host: global };
            }
        } catch (_) { /* fall through to the ambient timer */ }
        if (typeof setTimeout === 'function') {
            return { id: setTimeout(callback, delay), host: null };
        }
        return null;
    }

    function hostClearTimeout(handle) {
        if (!handle) return null;
        try {
            if (handle.host && typeof handle.host.clearTimeout === 'function') {
                handle.host.clearTimeout(handle.id);
                return null;
            }
        } catch (_) {
            return null;
        }
        if (typeof clearTimeout === 'function') clearTimeout(handle.id);
        return null;
    }

    function createBlockedError(name) {
        var error = new Error(
            '数据库被其他 IELTS Atlas 标签页占用，未能删除：' + name
            + '（等待 ' + Math.round(BLOCKED_DELETE_TIMEOUT_MS / 1000) + ' 秒后放弃）。'
        );
        error.code = 'DELETE_DATABASE_BLOCKED';
        error.blocked = true;
        error.database = name;
        error.timeoutMs = BLOCKED_DELETE_TIMEOUT_MS;
        return error;
    }

    function createQuiesceTimeoutError() {
        var error = new Error(
            '外部备份停止写入超时（等待 '
            + Math.round(EXTERNAL_BACKUP_QUIESCE_TIMEOUT_MS / 1000) + ' 秒）。'
        );
        error.code = 'EXTERNAL_BACKUP_QUIESCE_TIMEOUT';
        error.timeoutMs = EXTERNAL_BACKUP_QUIESCE_TIMEOUT_MS;
        return error;
    }

    function readStorage(name) {
        try {
            var storage = global[name];
            if (storage && typeof storage.getItem === 'function') return storage;
        } catch (_) { /* storage disabled by policy or a sandboxed frame */ }
        return null;
    }

    function markerStorages() {
        return [readStorage('localStorage'), readStorage('sessionStorage')].filter(function (storage, index, all) {
            return !!storage && all.indexOf(storage) === index;
        });
    }

    function readWindowNameMarker() {
        var value = '';
        try { value = typeof global.name === 'string' ? global.name : ''; } catch (_) { return null; }
        var parts = value.split('\n');
        for (var index = parts.length - 1; index >= 0; index -= 1) {
            if (parts[index].indexOf(WINDOW_NAME_MARKER_PREFIX) === 0) {
                return parts[index].slice(WINDOW_NAME_MARKER_PREFIX.length);
            }
        }
        return null;
    }

    function replaceWindowNameMarker(raw) {
        var value = '';
        try { value = typeof global.name === 'string' ? global.name : ''; } catch (_) { return false; }
        var retained = value.split('\n').filter(function (part) {
            return part.indexOf(WINDOW_NAME_MARKER_PREFIX) !== 0;
        });
        if (retained.length === 1 && retained[0] === '') retained = [];
        if (raw) retained.push(WINDOW_NAME_MARKER_PREFIX + raw);
        try {
            global.name = retained.join('\n');
            return raw ? readWindowNameMarker() === raw : readWindowNameMarker() === null;
        } catch (_) {
            return false;
        }
    }

    /**
     * Persist the recovery marker. Called only from the tail of `perform`, after
     * `clearWebStorage()`, so the value is not immediately erased by the very
     * reset that produced it.
     */
    function writePendingDeletionMarker(names) {
        if (!names || !names.length) {
            clearPendingDeletionMarker();
            return true;
        }
        var value = JSON.stringify({ state: 'pending', databases: names.slice(), at: nowMs() });
        var persisted = false;
        markerStorages().forEach(function (storage) {
            if (typeof storage.setItem !== 'function') return;
            try {
                storage.setItem(PENDING_DELETION_MARKER_KEY, value);
                persisted = storage.getItem(PENDING_DELETION_MARKER_KEY) === value || persisted;
            } catch (_) { /* try the other storage */ }
        });
        persisted = replaceWindowNameMarker(value) || persisted;
        return persisted;
    }

    function clearPendingDeletionMarker() {
        markerStorages().forEach(function (storage) {
            if (typeof storage.removeItem !== 'function') return;
            try {
                storage.removeItem(PENDING_DELETION_MARKER_KEY);
            } catch (_) { /* best-effort */ }
        });
        replaceWindowNameMarker(null);
    }

    /**
     * Read a marker left by a previous page load.
     *
     * Expired or malformed evidence cannot prove that the old request completed.
     * Keep the page in a recoverable confirmation-required state instead of
     * silently turning uncertainty into "safe".
     */
    function readPendingDeletionMarker() {
        var sawMarker = false;
        var invalidMarker = false;
        var validCandidate = null;
        var rawMarkers = [];
        markerStorages().forEach(function (storage) {
            try { rawMarkers.push(storage.getItem(PENDING_DELETION_MARKER_KEY)); } catch (_) { /* unreadable */ }
        });
        rawMarkers.push(readWindowNameMarker());
        rawMarkers.forEach(function (raw) {
            if (!raw) return;
            sawMarker = true;
            var parsed = null;
            try { parsed = JSON.parse(raw); } catch (_) { invalidMarker = true; return; }
            var names = parsed && parsed.databases;
            var state = parsed && parsed.state;
            if (state && state !== 'pending' && state !== 'unknown') {
                invalidMarker = true;
                return;
            }
            if (!names || typeof names.length !== 'number' || !names.length) {
                invalidMarker = true;
                return;
            }
            var adopted = [];
            for (var index = 0; index < names.length; index += 1) {
                if (DATABASE_NAMES.indexOf(names[index]) !== -1 && adopted.indexOf(names[index]) === -1) {
                    adopted.push(names[index]);
                }
            }
            if (!adopted.length) { invalidMarker = true; return; }
            var at = Number(parsed.at);
            var age = nowMs() - (isFinite(at) ? at : 0);
            validCandidate = {
                databases: adopted,
                state: 'unknown',
                expired: !isFinite(at) || age < 0 || age > PENDING_DELETION_MARKER_TTL_MS
            };
        });
        if (validCandidate) return validCandidate;
        if (sawMarker || invalidMarker) {
            return { databases: DATABASE_NAMES.slice(), state: 'unknown', corrupt: true };
        }
        return { databases: [], state: 'retired' };
    }

    /**
     * Register a deletion request we stopped waiting for, and keep watching it.
     *
     * The handlers installed here are intentionally *not* the ones `settle()`
     * detached: those could still resolve the caller's promise and rewrite an
     * outcome that has already been reported. These are pure observers — their
     * only job is to notice that the un-cancellable request finally ran, so the
     * pending state can be retired truthfully instead of by timeout.
     */
    function trackPendingDeletion(name, request) {
        pendingDeletionSequence += 1;
        var token = pendingDeletionSequence;
        pendingDeletions.set(name, { token: token, at: nowMs(), request: request });

        function retire() {
            var entry = pendingDeletions.get(name);
            // A newer reset attempt may have replaced this entry; only the owner
            // of the current token may retire it.
            if (!entry || entry.token !== token) return;
            pendingDeletions.delete(name);
            var remaining = listLivePendingDeletions();
            if (remaining.length) {
                writePendingDeletionMarker(remaining);
            } else {
                clearPendingDeletionMarker();
            }
        }

        try {
            request.onsuccess = function () { retire(); };
            request.onerror = function () { retire(); };
            // A repeated `onblocked` means the peer is still holding on. Nothing
            // to retire yet, but swallow it so it cannot reach a stale handler.
            request.onblocked = function () { };
        } catch (_) {
            // Read-only handlers are rare, but guessing completion would be
            // unsafe. The entry therefore remains restricted until this realm is
            // torn down and the cross-refresh recovery flow takes over.
        }
        return token;
    }

    /**
     * Live pending deletions: requests this realm issued and can still observe.
     *
     * Only these gate a new reset. An entry leaves this list the moment the
     * browser reports the deletion done, so the common "close the other tab and
     * retry" path unblocks immediately rather than waiting out a timer.
     */
    function listLivePendingDeletions() {
        var names = [];
        pendingDeletions.forEach(function (_entry, name) {
            if (names.indexOf(name) === -1) names.push(name);
        });
        return names;
    }

    /** Live plus adopted names — everything worth telling the user about. */
    function listPendingDeletions() {
        var names = listLivePendingDeletions();
        for (var index = 0; index < adoptedPendingDatabases.length; index += 1) {
            if (names.indexOf(adoptedPendingDatabases[index]) === -1) names.push(adoptedPendingDatabases[index]);
        }
        return names;
    }

    function currentDeletionState() {
        if (listLivePendingDeletions().length) return 'pending';
        if (adoptedPendingDatabases.length) return 'unknown';
        return 'retired';
    }

    /**
     * The reason a caller must not start a new reset right now, or null.
     *
     * Live requests only retire on their real terminal event. Cross-refresh
     * evidence can be recovered from, but only after explicit confirmation; this
     * avoids both an automatic false-safe state and a permanent marker lockout.
     */
    function pendingDeletionBlock(options) {
        var live = listLivePendingDeletions();
        var adopted = adoptedPendingDatabases.slice();
        if (!live.length && !adopted.length) return null;
        var recoveryRequired = !live.length && adopted.length > 0
            && !(options && options.recoveryConfirmed === true);
        if (!live.length && !recoveryRequired) return null;
        return {
            success: false,
            reason: recoveryRequired ? 'recovery_confirmation_required' : 'deletion_pending',
            deletionPending: true,
            pendingDatabases: listPendingDeletions(),
            retryable: true,
            recoveryConfirmationRequired: recoveryRequired,
            deletionState: currentDeletionState(),
            markerExpired: !!(adoptedPendingMarkerState && adoptedPendingMarkerState.expired),
            markerCorrupt: !!(adoptedPendingMarkerState && adoptedPendingMarkerState.corrupt),
            terminal: false,
            databases: DATABASE_NAMES.slice(),
            externalBackupFilesPreserved: true
        };
    }

    function pendingDeletionMessage(names) {
        return '上一次清理仍在等待其他 IELTS Atlas 标签页关闭：' + names.join('、')
            + '。浏览器无法取消这个删除请求，它会在其他标签页关闭后自动执行；'
            + '在那之前请不要录入新数据，否则可能被这次迟到的删除一并清掉。';
    }

    function settleWithTimeout(value, timeoutMs, createTimeoutError) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = hostSetTimeout(function () {
                if (settled) return;
                settled = true;
                reject(createTimeoutError());
            }, timeoutMs);
            if (!timer) {
                reject(createTimeoutError());
                return;
            }
            Promise.resolve(value).then(function (result) {
                if (settled) return;
                settled = true;
                hostClearTimeout(timer);
                resolve(result);
            }, function (error) {
                if (settled) return;
                settled = true;
                hostClearTimeout(timer);
                reject(error);
            });
        });
    }

    function deleteDatabaseStrict(name) {
        return new Promise(function (resolve, reject) {
            var indexedDb;
            try {
                indexedDb = global.indexedDB || null;
            } catch (_) {
                indexedDb = null;
            }
            if (!indexedDb || typeof indexedDb.deleteDatabase !== 'function') {
                resolve({ name: name, skipped: true });
                return;
            }

            var request;
            try {
                request = indexedDb.deleteDatabase(name);
            } catch (error) {
                reject(error);
                return;
            }

            var settled = false;
            var blockedTimer = null;

            function settle(complete, payload) {
                if (settled) return;
                settled = true;
                blockedTimer = hostClearTimeout(blockedTimer);
                // An IndexedDB deleteDatabase request cannot be aborted. When the
                // blocked timeout wins, the browser keeps the request pending and
                // will still drop the database once the other tab releases its
                // connection. Detaching the handlers here stops a late event from
                // rewriting an outcome the caller already acted on; the request is
                // then handed to `trackPendingDeletion`, whose observer handlers do
                // nothing but retire the pending state when the delete really runs.
                try {
                    request.onsuccess = null;
                    request.onerror = null;
                    request.onblocked = null;
                } catch (_) { /* exotic hosts may expose read-only handlers */ }
                var abandoned = !!(payload && payload.code === 'DELETE_DATABASE_BLOCKED');
                if (abandoned) trackPendingDeletion(name, request);
                complete(payload);
            }

            request.onsuccess = function () {
                settle(resolve, { name: name, deleted: true });
            };
            request.onerror = function () {
                settle(reject, request.error || new Error('删除数据库失败：' + name));
            };
            request.onblocked = function () {
                if (settled || blockedTimer) return;
                notify(
                    '清理被其他 IELTS Atlas 标签页阻塞，请立即关闭其他标签页；'
                    + Math.round(BLOCKED_DELETE_TIMEOUT_MS / 1000) + ' 秒内未释放将中止本次清理。',
                    'warning'
                );
                blockedTimer = hostSetTimeout(function () {
                    settle(reject, createBlockedError(name));
                }, BLOCKED_DELETE_TIMEOUT_MS);
                if (!blockedTimer) {
                    // No timer API at all: fail fast rather than wait forever.
                    settle(reject, createBlockedError(name));
                }
            };
        });
    }

    function clearWebStorage() {
        var failures = [];
        ['localStorage', 'sessionStorage'].forEach(function (name) {
            var storage;
            try {
                storage = global[name];
            } catch (error) {
                failures.push({ storage: name, error: error });
                return;
            }
            if (!storage || typeof storage.clear !== 'function') return;
            try {
                storage.clear();
            } catch (error) {
                failures.push({ storage: name, error: error });
            }
        });
        return failures;
    }

    function reloadTerminal(options) {
        if (options && options.reload === false) return false;
        if (global.location && typeof global.location.reload === 'function') {
            global.location.reload();
            return true;
        }
        return false;
    }

    async function perform(options) {
        var opts = options || {};
        if (resetPromise) return resetPromise;
        // Refuse to queue a second un-cancellable deletion behind one that is
        // still armed. Checked before the singleton is installed so the refusal
        // is never cached as "the" result of a reset.
        var blockedByPending = pendingDeletionBlock(opts);
        if (blockedByPending) {
            notify(pendingDeletionMessage(blockedByPending.pendingDatabases), 'warning');
            return blockedByPending;
        }
        resetPromise = (async function () {
            var externalBackup = global.ExternalBackupService;
            var errors = [];
            try {
                if (externalBackup && typeof externalBackup.prepareForFullReset === 'function') {
                    await settleWithTimeout(
                        externalBackup.prepareForFullReset(),
                        EXTERNAL_BACKUP_QUIESCE_TIMEOUT_MS,
                        createQuiesceTimeoutError
                    );
                } else if (externalBackup && typeof externalBackup.unbindDirectory === 'function') {
                    await settleWithTimeout(
                        externalBackup.unbindDirectory(),
                        EXTERNAL_BACKUP_QUIESCE_TIMEOUT_MS,
                        createQuiesceTimeoutError
                    );
                }
            } catch (error) {
                errors.push({ stage: 'external-backup-quiesce', error: error });
            }

            var deletionResults = await Promise.allSettled(DATABASE_NAMES.map(deleteDatabaseStrict));
            var blockedDatabases = [];
            deletionResults.forEach(function (result, index) {
                if (result.status !== 'rejected') return;
                var reason = result.reason;
                var isBlocked = !!(reason && reason.code === 'DELETE_DATABASE_BLOCKED');
                if (isBlocked) blockedDatabases.push(DATABASE_NAMES[index]);
                errors.push({
                    stage: isBlocked ? 'delete-database-blocked' : 'delete-database',
                    database: DATABASE_NAMES[index],
                    blocked: isBlocked,
                    error: reason
                });
            });
            clearWebStorage().forEach(function (failure) {
                errors.push({
                    stage: 'clear-web-storage',
                    storage: failure.storage,
                    error: failure.error
                });
            });

            // Written after clearWebStorage() on purpose: the reset wipes every
            // key, so a marker persisted any earlier would erase itself. This is
            // the one key that legitimately survives a full reset, which is why
            // it carries its own TTL.
            //
            // Adopted names are dropped unconditionally here. This run issued a
            // fresh deleteDatabase() for every name, and the connection queue is
            // FIFO per database: whatever a previous realm queued was necessarily
            // processed ahead of the request we just awaited, so it is no longer
            // outstanding regardless of how this run ended.
            adoptedPendingDatabases = [];
            adoptedPendingMarkerState = null;
            var stillPending = listLivePendingDeletions();
            var markerPersisted = true;
            if (stillPending.length) {
                markerPersisted = writePendingDeletionMarker(stillPending);
                if (!markerPersisted) {
                    errors.push({
                        stage: 'pending-deletion-marker',
                        error: new Error('无法持久化仍在等待的数据库删除状态。')
                    });
                }
            } else {
                clearPendingDeletionMarker();
            }

            if (errors.length) {
                if (blockedDatabases.length) {
                    notify(
                        '清理未完成：' + blockedDatabases.join('、')
                        + ' 仍被其他 IELTS Atlas 标签页占用。浏览器无法取消该删除请求，'
                        + '它会在其他标签页关闭后自动执行。请关闭全部其他标签页（含练习/听力弹窗）后，'
                        + '等待当前页面确认删除完成后再重试，在此之前不要继续录入新数据。',
                        'error'
                    );
                } else {
                    notify('本地数据仅部分清除，页面将刷新；请刷新后再次执行清理。', 'error');
                }
                // Keep this realm alive while it owns observable delete requests.
                // Reloading would discard the only truthful success/error observer.
                var reloadedAfterFailure = stillPending.length ? false : reloadTerminal(opts);
                return {
                    success: false,
                    reason: 'partial_reset',
                    blocked: blockedDatabases.length > 0,
                    blockedDatabases: blockedDatabases,
                    deletionPending: stillPending.length > 0,
                    pendingDatabases: stillPending,
                    markerPersisted: markerPersisted,
                    deletionState: stillPending.length ? 'pending' : 'retired',
                    retryable: true,
                    // `terminal` means "this page was actually torn down". Callers
                    // use it to decide whether they still own a live document, so
                    // reporting a reload that never happened strands them on a
                    // page they believe is gone.
                    terminal: reloadedAfterFailure,
                    errors: errors,
                    databases: DATABASE_NAMES.slice(),
                    externalBackupFilesPreserved: true
                };
            }
            var reloaded = reloadTerminal(opts);
            return {
                success: true,
                terminal: reloaded,
                deletionState: 'retired',
                databases: DATABASE_NAMES.slice(),
                externalBackupFilesPreserved: true
            };
        })();
        try {
            var outcome = await resetPromise;
            // The singleton exists only to collapse duplicate clicks on one
            // in-flight run; it is not a result cache. Anything already settled
            // must be released, or the next click replays a stale outcome without
            // clearing a single byte.
            //
            // The one case worth keeping is a reset that really did call
            // location.reload(): the document is being torn down, and holding the
            // resolved promise suppresses clicks landing in that teardown window
            // rather than firing a second delete against a dying realm. Reload is
            // asynchronous, so those clicks are genuinely reachable.
            if (!outcome || outcome.terminal !== true) resetPromise = null;
            return outcome;
        } catch (error) {
            resetPromise = null;
            throw error;
        }
    }

    async function request(options) {
        var opts = options || {};
        // Checked before the confirm dialog: asking the user to authorise a
        // destructive action we are about to refuse is worse than useless, and a
        // second `deleteDatabase()` for a name that is already queued only grows
        // the un-cancellable backlog.
        var blockedByPending = pendingDeletionBlock(opts);
        if (blockedByPending) {
            if (blockedByPending.recoveryConfirmationRequired) {
                var recoveryConfirmed = false;
                try {
                    recoveryConfirmed = global.confirm(
                        '浏览器记录显示上一次数据库删除可能仍在等待。继续恢复会重新排队删除，'
                        + '请先关闭其他 IELTS Atlas 标签页；确定继续吗？'
                    );
                } catch (_) { recoveryConfirmed = false; }
                if (recoveryConfirmed) {
                    opts = Object.assign({}, opts, { recoveryConfirmed: true });
                } else {
                    notify(pendingDeletionMessage(blockedByPending.pendingDatabases), 'warning');
                    return blockedByPending;
                }
            } else {
                notify(pendingDeletionMessage(blockedByPending.pendingDatabases), 'warning');
                return blockedByPending;
            }
        }
        var confirmed = opts.confirmed === true;
        if (!confirmed) {
            try {
                confirmed = global.confirm(
                    '确定要清除全部浏览器本地数据并返回首次启动状态吗？\n\n'
                    + '练习记录、题库、词汇、设置、应用内备份和本地文件夹绑定都会清除；'
                    + '外部文件夹中的 JSON 备份不会删除。'
                );
            } catch (_) {
                confirmed = false;
            }
        }
        if (!confirmed) return {
            success: false,
            reason: 'cancelled',
            deletionState: currentDeletionState()
        };

        notify('正在清除全部本地数据…', 'info');
        try {
            return await perform(opts);
        } catch (error) {
            if (global.console && typeof global.console.error === 'function') {
                global.console.error('[SiteDataReset] full reset failed:', error);
            }
            notify('清除失败：' + (error && error.message ? error.message : '浏览器存储不可用'), 'error');
            return {
                success: false,
                reason: 'reset_failed',
                deletionState: currentDeletionState(),
                error: error
            };
        }
    }

    /**
     * Adopt a marker written before the last reload and warn once.
     *
     * It never issues a delete. It does require explicit confirmation before a
     * recovery reset, so stale evidence remains recoverable without being treated
     * as proof that the late-deletion hazard disappeared.
     *
     * The warning is deferred because this module ships in core-foundation,
     * which index.html loads *before* the ui-shell/legacy bundles that define
     * `showMessage`. Warning synchronously would route the one notice the user
     * actually needs into console.log instead of the message center.
     */
    function adoptPendingDeletionsFromPreviousPage() {
        adoptedPendingMarkerState = readPendingDeletionMarker();
        adoptedPendingDatabases = adoptedPendingMarkerState.databases;
        if (!adoptedPendingDatabases.length) return;
        var announced = false;
        function announce() {
            if (announced) return;
            announced = true;
            // Re-read: a reset may have completed and retired the marker while we
            // were waiting for the UI layer to come up.
            if (!adoptedPendingDatabases.length) return;
            notify(pendingDeletionMessage(adoptedPendingDatabases), 'warning');
        }
        if (typeof global.showMessage === 'function') {
            announce();
            return;
        }
        var attempts = 0;
        function poll() {
            attempts += 1;
            if (typeof global.showMessage === 'function' || attempts >= 20) {
                announce();
                return;
            }
            hostSetTimeout(poll, 250);
        }
        if (!hostSetTimeout(poll, 250)) announce();
    }

    global.SiteDataReset = Object.freeze({
        __v2: true,
        DATABASE_NAMES: DATABASE_NAMES,
        PENDING_DELETION_MARKER_KEY: PENDING_DELETION_MARKER_KEY,
        deleteDatabaseStrict: deleteDatabaseStrict,
        perform: perform,
        request: request,
        /** Names whose un-cancellable deletion has not reported back yet. */
        pendingDeletions: listPendingDeletions,
        /** True while a previous deletion is still armed; see `pendingDeletions`. */
        isDeletionPending: function () {
            return listPendingDeletions().length > 0;
        },
        recoveryConfirmationRequired: function () {
            return adoptedPendingDatabases.length > 0;
        },
        deletionState: currentDeletionState
    });
    global.clearCache = request;
    adoptPendingDeletionsFromPreviousPage();
})(typeof window !== 'undefined' ? window : globalThis);
