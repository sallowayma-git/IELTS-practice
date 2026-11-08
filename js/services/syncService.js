(function installFolderSyncService(global) {
    'use strict';
    if (global.FolderSyncService) return;
    const adapter = global.SyncFolderAdapter, model = global.FolderSyncModel;
    const LOCK = 'ielts-atlas-external-backup-write'; // Shares the existing full-reset barrier.
    const listeners = new Set();
    let binding = null, timer = null, polling = null, running = null, initPromise = null, initialized = false, suspended = false;
    let channel = null, resumeOnInteraction = false, resumeAttempted = false;
    let view = { supported: adapter.supported(), enabled: false, bound: false, pending: 0, conflicts: [], blocked: [],
        permission: 'prompt', initializing: true, busy: false, errors: [], lastPublishAt: null, lastReceiveAt: null };
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
        if (suspended || timer) return;
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
        let published = 0, received = 0;
        for (const operation of pending.slice(0, 100)) {
            try {
                await adapter.publish(root, operation);
                await global.AppData.folderSync.acknowledge([operation.id]);
                published++;
            } catch (error) { errors.push({ path: operation.id, message: error.message }); break; }
        }
        const known = await global.AppData.folderSync.known();
        const scan = await adapter.scan(root, async operation => {
            if (suspended) throw new Error('本机同步已暂停');
            if (operation.spaceId !== state.spaceId) throw new Error('该日志不属于当前数据空间');
            const hash = model.digest(operation);
            if (known[operation.id] === hash) return;
            await global.AppData.folderSync.receive(operation);
            known[operation.id] = hash;
            received++;
        });
        errors.push(...scan.errors);
        if (published) binding.lastPublishAt = new Date().toISOString();
        if (received) binding.lastReceiveAt = new Date().toISOString();
        if (published || received) await adapter.binding(binding);
        emit({ errors });
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
        running = init().then(() => withLock(runUnlocked, background)).catch(error => {
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
            const space = await adapter.openWorkspace(selected, () => {
                if (current.spaceId) throw new Error('本机已有同步空间，请选择原项目文件夹并等待 OneDrive 下载完成；不会创建其他空间');
                return global.confirm('尚未发现同步空间。只有从未在其他电脑启用过同步，且 OneDrive 已完成下载时才应新建。确认在此项目中初始化同步空间？');
            });
            if (current.enabled && current.spaceId !== space.spaceId) throw new Error('请先断开当前空间，再连接其他空间');
            binding = { directory: space.directory, spaceId: space.spaceId, name: space.name };
            await adapter.binding(binding);
            await global.AppData.folderSync.connect(space.spaceId);
            adapter.clearCache(); suspended = false;
            emit({ permission: await adapter.permission(binding.directory), errors: [] });
            await refresh();
            return { existing: space.existing, spaceId: space.spaceId };
        });
        announce('binding-changed');
        await syncNow();
        return result;
    }
    // Starts requestPermission directly inside the click handler, before any asynchronous read.
    function reauthorize() {
        if (!binding?.directory) return Promise.reject(new Error('请先连接同步文件夹'));
        resumeAttempted = true;
        const request = adapter.requestPermission(binding.directory);
        return request.then(permission => {
            emit({ permission });
            if (permission !== 'granted') throw new Error('尚未获得同步文件夹读写权限');
            announce('binding-changed'); return syncNow();
        });
    }
    async function disconnect() {
        await withLock(async () => {
            await global.AppData.folderSync.disconnect();
            await adapter.binding(null);
            binding = null; resumeOnInteraction = false; adapter.clearCache();
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
                await runUnlocked();
                const latest = await global.AppData.folderSync.status();
                if (latest.pending) throw new Error('还有未写入 OneDrive 文件夹的记录，请恢复权限并同步后再清理本机');
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
        if (!initPromise) initPromise = initialize().catch(error => { initPromise = null; initialized = false; emit({ initializing: false }); throw error; });
        return initPromise;
    }
    function resumeFromInteraction(event) {
        if (!event.isTrusted || !resumeOnInteraction || resumeAttempted || suspended || view.busy
            || !binding || !view.enabled || view.permission !== 'prompt') return;
        // Explicit sync controls keep their own click handler, with no duplicate permission request.
        if (event.target?.closest?.('#folder-sync-permission-btn, #folder-sync-enable-btn, #folder-sync-disconnect-btn')) return;
        // Call synchronously during a trusted click: browsers require transient user activation.
        reauthorize().catch(error => {
            if (!['SecurityError', 'AbortError'].includes(error.name)) emit({ errors: [{ path: '', message: error.message }] });
        });
    }
    async function initialize() {
        if (initialized) return;
        initialized = true;
        await global.AppData.ready;
        binding = await adapter.binding();
        if (binding) emit({ permission: await adapter.permission(binding.directory) });
        await refresh();
        resumeOnInteraction = !!binding && view.enabled;
        emit({ initializing: false });
        global.document?.addEventListener('click', resumeFromInteraction, true);
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
        polling = global.setInterval(() => {
            if (global.document?.visibilityState !== 'hidden') schedule(0);
        }, 15000);
        if (binding && view.enabled) schedule(0);
    }
    global.FolderSyncService = Object.freeze({ init, connect, disconnect, reauthorize, syncNow, resolve,
        setPreferences, approveDelete, withReset, getStatus, onStatusChange(listener) {
            listeners.add(listener); listener(getStatus()); return () => listeners.delete(listener);
        } });
    if (global.document) {
        const start = () => init().catch(error => emit({ errors: [{ path: '', message: error.message }] }));
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }
})(typeof window !== 'undefined' ? window : globalThis);
