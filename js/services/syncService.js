(function installFolderSyncService(global) {
    'use strict';
    if (global.FolderSyncService) return;
    const adapter = global.SyncFolderAdapter, model = global.FolderSyncModel;
    const LOCK = 'ielts-atlas-external-backup-write'; // Shares the existing full-reset barrier.
    const POLL_MS = 5000;
    const listeners = new Set();
    let binding = null, timer = null, running = null, initPromise = null, suspended = false;
    let channel = null, resumeAttempted = false, earlyInteraction = false, recovery = null, skipInteractionClick = false;
    let view = { supported: adapter.supported(), enabled: false, bound: false, pending: 0, conflicts: [], blocked: [],
        permission: 'prompt', initializing: true, recovering: false, busy: false, completedSyncs: 0,
        errors: [], lastCheckAt: null, lastPublishAt: null, lastReceiveAt: null };
    function emit(patch = {}) {
        view = Object.assign({}, view, patch);
        for (const listener of listeners) { try { listener(getStatus()); } catch (_) { /* isolated UI */ } }
    }
    function getStatus() { return model.copy({ ...view, suspended }); }
    async function refresh() {
        const state = await global.AppData.folderSync.status();
        emit({ ...state, bound: !!binding, directoryName: binding?.name || null,
            lastPublishAt: binding?.lastPublishAt || null, lastReceiveAt: binding?.lastReceiveAt || null });
        return state;
    }
    function announce(type) { try { channel?.postMessage({ type }); } catch (_) { /* best effort */ } }
    function withLock(task, background = false) {
        if (!global.navigator?.locks?.request) throw new Error('当前浏览器缺少安全的跨标签页锁，请使用桌面 Chrome / Edge');
        return global.navigator.locks.request(LOCK, { mode: 'exclusive', ...(background ? { ifAvailable: true } : {}) },
            lock => lock ? task() : { skipped: true });
    }
    function schedule(delay = 1000) {
        if (suspended || timer || !binding || !view.enabled) return;
        timer = global.setTimeout(() => { timer = null; syncNow(true).catch(() => {}); }, delay);
    }
    async function runUnlocked() {
        if (suspended) return;
        binding = await adapter.binding();
        const state = await refresh();
        if (!binding || !state.enabled) return;
        if (binding.spaceId !== state.spaceId) throw new Error('本机绑定与数据空间不一致，请重新连接');
        const permission = await adapter.permission(binding.directory);
        emit({ permission });
        if (permission !== 'granted') return;
        const root = await adapter.workspace(binding);
        const pending = await global.AppData.folderSync.pending();
        const errors = [];
        const written = [];
        let received = 0;
        for (const operation of pending.slice(0, 100)) {
            try {
                await adapter.publish(root, operation);
                written.push(operation.id);
            } catch (error) { errors.push({ path: operation.id, message: error.message }); }
        }
        if (written.length) await global.AppData.folderSync.acknowledge(written);
        const published = written.length;
        const known = await global.AppData.folderSync.known();
        const scan = await adapter.scan(root, async (operation, hash) => {
            if (suspended) throw new Error('本机同步已暂停');
            if (operation.spaceId !== state.spaceId) throw new Error('该日志不属于当前数据空间');
            if (known[operation.id] === hash) return;
            await global.AppData.folderSync.receive(operation);
            known[operation.id] = hash;
            received++;
        });
        errors.push(...scan.errors);
        if (published) binding.lastPublishAt = new Date().toISOString();
        if (received) binding.lastReceiveAt = new Date().toISOString();
        if (published || received) await adapter.binding(binding);
        emit({ errors, lastCheckAt: new Date().toISOString(), completedSyncs: view.completedSyncs + (errors.length ? 0 : 1) });
        const latest = await refresh();
        if (received && typeof global.syncPracticeRecords === 'function') {
            try { await global.syncPracticeRecords({ forceRender: true }); } catch (_) { /* next view activation reads durable data */ }
        }
        if (latest.pending && !errors.length) schedule(1000);
        return { published, received, errors };
    }
    function syncNow(background = false) {
        if (running) return running;
        emit({ busy: true });
        running = init().then(() => withLock(runUnlocked, background)).then(result => {
            if (result?.skipped) schedule();
            return result;
        }).catch(error => {
            emit({ errors: [{ path: '', message: error.message }] });
            if (!background) throw error;
        }).finally(() => { running = null; emit({ busy: false }); });
        return running;
    }
    async function connect() {
        const selection = adapter.pick();
        const selected = await selection;
        await init();
        const result = await withLock(async () => {
            const current = await global.AppData.folderSync.status();
            const backup = global.ExternalBackupService;
            const space = await adapter.openWorkspace(selected, async () => {
                if (current.spaceId) throw new Error('本机已有同步空间，请选择原同步文件夹并等待 OneDrive 下载完成');
                await backup?.assertSyncDestination?.(selected);
                return global.confirm('这个专用文件夹为空。仅在首次启用、确认 OneDrive 已完成下载时创建。同步日志将以明文写入文件夹，确定创建空间吗？');
            });
            if (space.existing) await backup?.assertSyncDestination?.(space.directory);
            if (current.enabled && current.spaceId !== space.spaceId) throw new Error('请先断开当前空间，再连接其他空间');
            const previous = await adapter.binding();
            const next = { directory: space.directory, spaceId: space.spaceId, name: space.name };
            await adapter.binding(next);
            try { await global.AppData.folderSync.connect(space.spaceId); }
            catch (error) { await adapter.binding(previous); throw error; }
            binding = next;
            adapter.clearCache(); suspended = false; resumeAttempted = false;
            emit({ permission: await adapter.permission(binding.directory), errors: [], lastCheckAt: null });
            await refresh();
            return { existing: space.existing, spaceId: space.spaceId };
        });
        announce('binding-changed');
        await syncNow();
        return result;
    }
    // Starts requestPermission directly inside the click handler, before any asynchronous read.
    function reauthorize() {
        if (recovery) return recovery;
        if (!binding?.directory) return Promise.reject(new Error('请先连接同步文件夹'));
        resumeAttempted = true;
        emit({ recovering: true });
        let request;
        try { request = adapter.requestPermission(binding.directory); }
        catch (error) { request = Promise.reject(error); }
        recovery = Promise.resolve(request).then(async permission => {
            emit({ permission, ...(permission === 'granted' ? { errors: [] } : {}) });
            if (permission !== 'granted') throw new Error('尚未获得同步文件夹读写权限');
            announce('binding-changed');
            // A worker may already have observed prompt; finish it, then run with the new grant.
            if (running) await running.catch(() => {});
            return syncNow();
        }).catch(error => {
            if (error.name === 'SecurityError') resumeAttempted = false;
            throw error;
        }).finally(() => { recovery = null; emit({ recovering: false }); });
        return recovery;
    }
    async function disconnect() {
        await withLock(async () => {
            await global.AppData.folderSync.disconnect();
            await adapter.binding(null);
            binding = null; adapter.clearCache();
            emit({ errors: [], permission: 'prompt' }); await refresh();
        });
        announce('binding-changed');
    }
    async function resolve(key, headId) {
        await withLock(() => global.AppData.folderSync.resolve(key, headId));
        await refresh(); await syncNow();
    }
    async function setPreferences(enabled) {
        await withLock(() => global.AppData.folderSync.setPreferences(enabled));
        await refresh(); await syncNow();
    }
    async function approveDelete(id) {
        await withLock(() => global.AppData.folderSync.approveDelete(id));
        await refresh(); await syncNow();
    }
    async function withReset(task) {
        // Called while the shared full-reset lock is already held.
        // This durable flag and every learning write share the system-store transaction.
        // Earlier writes finish first; later writes abort even in another tab.
        let success = false;
        try {
            const state = await adapter.resetBarrier(true);
            binding = await adapter.binding();
            if (binding || state.enabled || state.pending) {
                await global.AppData.ready;
                let pending = state.pending;
                while (pending) {
                    const result = await runUnlocked();
                    const latest = await global.AppData.folderSync.status();
                    if (!latest.pending) break;
                    if (!result?.published || latest.pending >= pending) {
                        throw new Error('还有未写入 OneDrive 文件夹的记录，请连接原空间并同步后再清理本机');
                    }
                    pending = latest.pending;
                }
            }
            suspended = true; announce('reset-pause');
            if (timer) { global.clearTimeout(timer); timer = null; }
            const result = await task();
            success = result?.success === true;
            return result;
        } finally {
            if (!success) {
                await adapter.resetBarrier(false);
                suspended = false; announce('reset-resume');
            }
        }
    }
    function init() {
        if (!initPromise) initPromise = initialize().catch(error => { initPromise = null; emit({ initializing: false }); throw error; });
        return initPromise;
    }
    function resumeFromInteraction(event) {
        if (!event.isTrusted) return;
        // A failed activation request can retry on the next gesture, not its trailing click.
        if (event.type === 'click' && skipInteractionClick) { skipInteractionClick = false; return; }
        if (event.type === 'pointerdown' && event.pointerType !== 'mouse') return;
        if (event.type === 'pointerup' && event.pointerType === 'mouse') return;
        if (event.type === 'keydown' && (event.key === 'Escape' || event.ctrlKey || event.altKey || event.metaKey)) return;
        earlyInteraction = true;
        if (resumeAttempted || suspended || recovery
            || !binding || !view.enabled || view.permission !== 'prompt') return;
        // Explicit sync controls keep their own click handler, with no duplicate permission request.
        if (event.target?.closest?.('#folder-sync-permission-btn, #folder-sync-enable-btn, #folder-sync-disconnect-btn, #folder-sync-startup-dialog')) return;
        skipInteractionClick = ['pointerdown', 'pointerup', 'keydown'].includes(event.type);
        // Call synchronously during a trusted click: browsers require transient user activation.
        reauthorize().catch(error => {
            if (!['SecurityError', 'AbortError'].includes(error.name)) emit({ errors: [{ path: '', message: error.message }] });
        });
    }
    async function initialize() {
        // Read the saved handle as soon as the module loads, alongside data initialization.
        const [, savedBinding] = await Promise.all([
            adapter.supported() ? withLock(() => adapter.resetBarrier(false), true) : null,
            adapter.binding()
        ]);
        await global.AppData.ready;
        binding = savedBinding;
        if (binding) emit({ permission: await adapter.permission(binding.directory) });
        await refresh();
        if (earlyInteraction && global.navigator?.userActivation?.isActive) resumeFromInteraction({ isTrusted: true });
        if (typeof global.BroadcastChannel === 'function') {
            channel = new global.BroadcastChannel('ielts-atlas-folder-sync-control-v1');
            channel.onmessage = event => {
                if (event.data?.type === 'reset-pause') { suspended = true; emit(); }
                else if (event.data?.type === 'reset-resume') { suspended = false; schedule(); }
                else if (event.data?.type === 'binding-changed') {
                    adapter.binding().then(value => { binding = value; adapter.clearCache(); return refresh(); }).then(() => schedule()).catch(error => emit({ errors: [{ path: '', message: error.message }] }));
                }
            };
        }
        global.AppData.backups.onDataCommitted(event => {
            if (!event.targets?.some(target => target.syncOrigin)) schedule();
        });
        global.document?.addEventListener('visibilitychange', () => {
            if (global.document.visibilityState === 'visible') schedule(0);
        });
        global.addEventListener?.('online', () => schedule(0));
        global.addEventListener?.('focus', () => schedule(0));
        global.setInterval(() => {
            if (global.document?.visibilityState !== 'hidden') schedule(0);
        }, POLL_MS);
        // Complete the first background pass during startup, without waiting for settings or a timer.
        if (binding && view.enabled) {
            emit({ busy: true });
            try {
                const result = await withLock(runUnlocked, true);
                if (result?.skipped) schedule();
            }
            catch (error) { emit({ errors: [{ path: '', message: error.message }] }); }
            finally { emit({ busy: false }); }
        }
        emit({ initializing: false });
    }
    global.FolderSyncService = Object.freeze({ init, connect, disconnect, reauthorize, syncNow, resolve,
        setPreferences, approveDelete, withReset, getStatus,
        deferAutomaticRecovery() { resumeAttempted = true; },
        onStatusChange(listener) {
            listeners.add(listener); listener(getStatus()); return () => listeners.delete(listener);
        } });
    if (global.document) {
        for (const type of ['pointerdown', 'pointerup', 'keydown', 'click'])
            global.document.addEventListener(type, resumeFromInteraction, true);
        init().catch(error => emit({ errors: [{ path: '', message: error.message }] }));
    }
})(typeof window !== 'undefined' ? window : globalThis);
