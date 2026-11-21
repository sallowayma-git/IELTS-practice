(function installPracticeCloud(global) {
    'use strict';
    // The backend adds this marker. file:// and ordinary static hosting stay local.
    if (!global.document || !document.querySelector('meta[name="ielts-backend"][content="1"]')) return;
    const app = global.AppData;
    const lockName = 'ielts-practice-cloud-sync';
    const state = { phase: 'loading', user: null, message: '正在连接账号服务…', conflicts: [], lastSyncedAt: null };
    let csrfToken = null;
    let generation = 0;
    let running = null;
    let syncRequested = false;
    let timer = null;
    let registrationAllowed = false;
    let uiBusy = false;

    function canonical(value) {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
        return JSON.stringify(value);
    }
    function same(left, right) { return canonical(left) === canonical(right); }
    function ordered(records) { return records.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))); }
    function merge(base, local, remote, choices = {}) {
        const maps = [base, local, remote].map(records => new Map(records.map(record => [String(record.id), record])));
        const ids = new Set(maps.flatMap(map => Array.from(map.keys())));
        const records = [];
        const conflicts = [];
        for (const id of ids) {
            const [before, here, there] = maps.map(map => map.get(id));
            let value;
            if (same(here, before)) value = there;
            else if (same(there, before) || same(here, there)) value = here;
            else {
                const choice = choices[id];
                if (choice && choice.local === canonical(here) && choice.remote === canonical(there)) value = choice.keep === 'local' ? here : there;
                else {
                    conflicts.push({ id, title: (here || there || before).title || id, local: canonical(here), remote: canonical(there) });
                    continue;
                }
            }
            if (value) records.push(value);
        }
        return { records: ordered(records), conflicts };
    }
    function setState(phase, message) { state.phase = phase; state.message = message; render(); }
    async function request(path, options = {}) {
        const response = await fetch(path, {
            credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
            ...options,
            headers: { ...(options.body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' } : {}), ...options.headers }
        });
        let data;
        try { data = await response.json(); } catch (_) { throw new Error('服务器返回了无法识别的响应，请检查部署。'); }
        if (!response.ok) throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { status: response.status, data });
        return data;
    }
    function withLock(task) {
        return global.navigator?.locks ? navigator.locks.request(lockName, task) : task();
    }
    function checkOwner(captured, userId) {
        if (captured.state.userId && captured.state.userId !== userId) {
            throw new Error('此浏览器的记录已关联其他账号。请登录原账号，或在独立浏览器中使用当前账号。');
        }
    }
    function schedule() {
        clearTimeout(timer);
        if (state.user && state.phase !== 'conflict') timer = setTimeout(() => sync(), 300);
    }
    async function sync(choices = {}) {
        if (!state.user) return;
        if (running) {
            // A caller may have committed changes after the active pass captured them.
            syncRequested = true;
            return running;
        }
        const userId = state.user.id;
        const started = generation;
        const current = () => started === generation && state.user?.id === userId;
        running = withLock(async () => {
            for (let attempt = 0; attempt < 5 && current(); attempt += 1) {
                syncRequested = false;
                const captured = await app.cloudSync.capture();
                checkOwner(captured, userId);
                if (!captured.state.enabled) {
                    setState('unbound', `此浏览器有 ${captured.records.length} 条本地记录。确认后会先创建本地备份，再与当前账号合并并启用自动同步。`);
                    return;
                }
                setState('syncing', '正在同步完整练习记录…');
                const remote = await request('/api/practice-records/sync');
                if (!current()) return;
                if (remote.userId !== userId) throw Object.assign(new Error('账号会话已改变，请重新登录。'), { status: 401 });
                if (syncRequested) continue;
                const remoteRecords = app.cloudSync.normalize(remote.records);
                const merged = merge(captured.state.baseline || [], captured.records, remoteRecords, choices);
                if (merged.conflicts.length) {
                    state.conflicts = merged.conflicts;
                    setState('conflict', `${merged.conflicts.length} 条记录在两台设备上有不同修改，已暂停同步。请选择保留哪个版本，双方数据在选择前都会保留。`);
                    return;
                }
                let accepted = remote;
                // Persist legacy normalization once, including missing timestamps.
                // Otherwise each device could assign a new date on every download.
                if (!same(ordered(merged.records), ordered(remote.records))) {
                    try {
                        accepted = await request('/api/practice-records/sync', {
                            method: 'POST', body: JSON.stringify({ userId, revision: remote.revision, records: merged.records })
                        });
                    } catch (error) { if (error.status === 409) continue; throw error; }
                }
                if (!current()) return;
                const records = app.cloudSync.normalize(accepted.records);
                const nextState = { userId, enabled: true, baseline: records, lastSyncedAt: new Date().toISOString() };
                if (!same(ordered(captured.records), ordered(records)) || !same(ordered(captured.state.baseline || []), ordered(records))) {
                    try { await app.cloudSync.apply(captured, records, nextState); }
                    catch (error) { if (error.code === 'CONFLICT') continue; throw error; }
                    refreshViews();
                }
                if (!current()) return;
                if (syncRequested) continue;
                state.conflicts = [];
                state.lastSyncedAt = nextState.lastSyncedAt;
                setState('ready', `已同步 ${records.length} 条记录。新练习、答案、笔记、套题及删除操作会自动同步。`);
                return;
            }
            if (current()) setState('offline', '记录正在被其他窗口修改，稍后自动重试；本地数据已保留。');
        }).catch(error => {
            if (!current()) return;
            if (error.status === 401 || error.status === 403) {
                state.user = null; csrfToken = null; generation += 1;
                setState('signed-out', '登录已失效或账号已改变，请重新登录。未同步的本地记录已保留。');
            } else {
                setState('offline', `同步未完成：${error.message}。本地记录已保留，可重试。`);
            }
        }).finally(() => { running = null; render(); });
        return running;
    }
    async function connect() {
        if (!state.user) throw new Error('请先登录。');
        const userId = state.user.id;
        const started = generation;
        await withLock(async () => {
            let captured = await app.cloudSync.capture();
            checkOwner(captured, userId);
            if (captured.state.enabled) return;
            if (captured.records.length) {
                await app.backups.create({ id: `before-cloud-sync-${Date.now()}` });
                captured = await app.cloudSync.capture();
                checkOwner(captured, userId);
            }
            if (started !== generation || state.user?.id !== userId) return;
            await app.cloudSync.apply(captured, captured.records, { userId, enabled: true, baseline: [] });
        });
        return sync();
    }
    async function refreshAuth() {
        generation += 1;
        const started = generation;
        let me;
        try { me = await request('/api/auth/me'); }
        catch (error) { if (error.status === 401) me = error.data; else throw error; }
        if (started !== generation) return;
        csrfToken = me.csrfToken;
        state.user = me.user;
        registrationAllowed = (await request('/api/auth/registration')).allowed;
        if (!state.user) { setState('signed-out', '请登录同一账号以同步设备间的练习记录。未登录时仍可使用本地练习。'); return; }
        const captured = await app.cloudSync.capture();
        checkOwner(captured, state.user.id);
        if (!captured.state.userId && captured.records.length === 0) return connect();
        return sync();
    }
    async function authenticate(action, username, password) {
        csrfToken = (await request('/api/auth/csrf')).csrfToken;
        const result = await request(`/api/auth/${action}`, { method: 'POST', body: JSON.stringify({ username, password }) });
        csrfToken = result.csrfToken;
        return refreshAuth();
    }
    async function logout() {
        generation += 1;
        clearTimeout(timer);
        if (running) await running;
        csrfToken = (await request('/api/auth/csrf')).csrfToken;
        await request('/api/auth/logout', { method: 'POST', body: '{}' });
        state.user = null; csrfToken = null; state.conflicts = [];
        setState('signed-out', '已退出登录。此浏览器保留本地记录；再次登录原账号后继续同步。');
    }
    function refreshViews() {
        if (typeof global.syncPracticeRecords === 'function') Promise.resolve(global.syncPracticeRecords()).catch(() => {});
        document.dispatchEvent(new CustomEvent('practiceRecordsUpdated', { detail: { source: 'cloud-sync' } }));
    }
    function render() {
        const panel = document.getElementById('cloud-account-panel');
        if (!panel) return;
        panel.hidden = false;
        panel.querySelector('[data-cloud-status]').textContent = state.message;
        panel.querySelector('[data-cloud-user]').textContent = state.user ? `当前账号：${state.user.username}` : '尚未登录';
        panel.querySelector('[data-cloud-login]').hidden = Boolean(state.user);
        panel.querySelector('[data-cloud-register]').hidden = !registrationAllowed;
        panel.querySelector('[data-cloud-connect]').hidden = state.phase !== 'unbound';
        panel.querySelector('[data-cloud-sync]').hidden = !state.user || state.phase === 'unbound';
        panel.querySelector('[data-cloud-logout]').hidden = !state.user;
        panel.querySelector('[data-cloud-conflicts]').hidden = state.phase !== 'conflict';
        panel.querySelector('[data-cloud-conflict-list]').textContent = state.conflicts.map(item => item.title).join('、');
        panel.querySelector('[data-cloud-time]').textContent = state.lastSyncedAt ? `最近同步：${new Date(state.lastSyncedAt).toLocaleString()}` : '';
        for (const button of panel.querySelectorAll('button')) button.disabled = uiBusy || state.phase === 'syncing';
    }
    async function action(task) {
        if (uiBusy) return;
        uiBusy = true; render();
        try { await task(); }
        catch (error) { setState('error', error.message); }
        finally { uiBusy = false; render(); }
    }
    async function start() {
        await app.ready;
        const panel = document.getElementById('cloud-account-panel');
        if (!panel) return;
        const form = panel.querySelector('form');
        async function submit(kind) {
            if (!form.reportValidity()) return;
            const username = form.elements.username.value.trim();
            const password = form.elements.password.value;
            await action(async () => { await authenticate(kind, username, password); form.elements.password.value = ''; });
        }
        form.addEventListener('submit', event => { event.preventDefault(); submit('login'); });
        panel.querySelector('[data-cloud-register]').addEventListener('click', () => submit('register'));
        panel.querySelector('[data-cloud-connect]').addEventListener('click', () => action(connect));
        panel.querySelector('[data-cloud-sync]').addEventListener('click', () => action(() => sync()));
        panel.querySelector('[data-cloud-refresh]').addEventListener('click', () => action(refreshAuth));
        panel.querySelector('[data-cloud-logout]').addEventListener('click', () => action(logout));
        for (const button of panel.querySelectorAll('[data-cloud-resolve]')) button.addEventListener('click', () => {
            const choices = Object.fromEntries(state.conflicts.map(item => [item.id, { ...item, keep: button.dataset.cloudResolve }]));
            action(() => sync(choices));
        });
        app.backups.onDataCommitted(event => {
            if (String(event.operationId).startsWith('cloud-sync')) return;
            if (event.targets.some(target => ['practiceSummaries', 'practiceDetails', 'practiceAnnotations'].includes(target.store))) schedule();
        });
        global.addEventListener('online', schedule);
        global.addEventListener('focus', schedule);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
        setInterval(() => { if (!document.hidden && state.phase !== 'conflict') sync(); }, 15000);
        render();
        await action(refreshAuth);
    }
    global.PracticeCloud = Object.freeze({ sync, connect, refresh: refreshAuth, status: () => ({ ...state, conflicts: state.conflicts.map(({ id, title }) => ({ id, title })) }) });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})(typeof window !== 'undefined' ? window : globalThis);
