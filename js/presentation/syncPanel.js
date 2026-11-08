(function installFolderSyncPanel(global) {
    'use strict';
    if (!global.document || !global.FolderSyncService) return;
    const service = global.FolderSyncService, doc = global.document;
    let modal = null, statusLine, conflictList, errorLine, preferences, setupGuide, versionSignature = '', actionError = '', lastAttention = '', attentionNote = null, actionNote = null;
    let actionErrorRevision = 0;
    const buttons = {};
    function element(tag, text, className) {
        const node = doc.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function dismissOwn(note) {
        if (!note) return;
        const center = global.getMessageCenter?.();
        if (center?.dismiss) center.dismiss(0, note);
        else note.remove?.();
    }
    function message(text, type = 'error') {
        actionError = type === 'error' ? text : '';
        actionErrorRevision = service.getStatus().completedSyncs;
        if (errorLine) errorLine.textContent = actionError;
        dismissOwn(actionNote);
        if (typeof global.showMessage === 'function') actionNote = global.showMessage(text, type);
    }
    function notifyAttention(status) {
        if (status.recovering) {
            dismissOwn(attentionNote); attentionNote = null; lastAttention = '';
            dismissOwn(actionNote); actionNote = null;
        }
        if (status.initializing || status.busy || status.recovering) return;
        let text = '', type = 'warning';
        if (status.enabled && status.bound) {
            const destination = '请前往设置 → 数据管理 → OneDrive 自动同步处理。';
            if (status.permission !== 'granted') text = 'OneDrive 同步已暂停，学习记录仍保存在本机。' + destination;
            else if (status.blocked.length) text = 'OneDrive 同步有批量删除请求需要确认。' + destination;
            else if (status.conflicts.length) text = 'OneDrive 同步有 ' + status.conflicts.length + ' 项内容需要选择版本。' + destination;
            else if (status.errors.length) {
                text = 'OneDrive 同步遇到问题，学习记录仍保存在本机。' + destination;
                type = 'error';
            }
        }
        // Use the same transient notification as disk backup; never add home-page controls.
        if (text !== lastAttention) {
            dismissOwn(attentionNote); attentionNote = null;
            if (text && typeof global.showMessage === 'function') attentionNote = global.showMessage(text, type);
        }
        lastAttention = text;
    }
    function action(button, task, successText) {
        button.addEventListener('click', () => {
            actionError = ''; dismissOwn(actionNote); actionNote = null;
            let operation;
            try { operation = task(); } catch (error) { message(error.message); return; }
            if (operation === undefined) { render(service.getStatus()); return; }
            button.disabled = true;
            Promise.resolve(operation).then(() => {
                const status = service.getStatus();
                if (successText && (!status.enabled || status.permission === 'granted')
                    && !status.errors.length && !status.conflicts.length && !status.blocked.length)
                    message(successText, 'success');
            }).catch(error => {
                if (error.name !== 'AbortError') message(error.message, 'error');
            }).finally(() => { button.disabled = false; render(service.getStatus()); });
        });
    }
    function ensureModal() {
        if (modal) return modal;
        modal = element('div', '', 'theme-modal folder-sync-modal shui-secondary-modal shui-secondary-modal--sm');
        modal.id = 'folder-sync-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'folder-sync-title');
        const content = element('div', '', 'theme-modal-content shui-secondary-modal__content');
        const header = element('div', '', 'theme-modal-header shui-secondary-modal__header');
        const title = element('h3', '☁️ OneDrive 自动同步'); title.id = 'folder-sync-title';
        const close = element('button', '×', 'theme-modal-close'); close.type = 'button'; close.setAttribute('aria-label', '关闭同步面板');
        close.addEventListener('click', () => modal.classList.remove('show'));
        header.append(title, close);
        const body = element('div', '', 'theme-modal-body shui-secondary-modal__body folder-sync-body');
        setupGuide = element('div'); setupGuide.id = 'folder-sync-setup-guide';
        setupGuide.append(element('p', '每台电脑首次选择 OneDrive 内的专用同步文件夹并允许读写，之后会自动合并已完成的练习、笔记和词汇。请先把解压后的整个项目文件夹放进 OneDrive。'));
        setupGuide.append(element('p', '点击“启用 OneDrive 同步”，选择 OneDrive 中的项目文件夹并授权。已有空间会自动连接；首次使用需确认初始化。其他电脑请等待下载完成，并设置“始终保留在此设备上”。', 'folder-sync-muted'));
        body.append(setupGuide);
        statusLine = element('p', '正在读取本机同步状态…', 'folder-sync-status');
        statusLine.setAttribute('role', 'status'); statusLine.setAttribute('aria-live', 'polite');
        body.append(statusLine);
        const actions = element('div', '', 'external-backup-panel__actions');
        for (const [key, label, task, successText] of [
            ['enable', '☁️ 启用 OneDrive 同步', () => service.connect(), 'OneDrive 自动同步已开启'],
            ['sync', '🔄 立即同步', () => service.syncNow(), 'OneDrive 同步检查已完成'],
            ['permission', '🔑 恢复同步', () => service.reauthorize(), 'OneDrive 自动同步已恢复'],
            ['disconnect', '断开本机同步', () => {
                if (global.confirm('断开后保留本机记录和 OneDrive 文件，下次连接可继续同步。是否断开？')) return service.disconnect();
            }, '已断开本机 OneDrive 同步']
        ]) {
            const button = element('button', label, 'btn data-mgmt-btn'); button.type = 'button'; button.id = 'folder-sync-' + key + '-btn';
            buttons[key] = button; action(button, task, successText); actions.append(button);
        }
        body.append(actions);
        const option = element('label', '', 'folder-sync-option');
        preferences = element('input'); preferences.type = 'checkbox'; preferences.id = 'folder-sync-preferences';
        option.append(preferences, doc.createTextNode(' 同步主题、阅读显示和计时偏好'));
        preferences.addEventListener('change', () => {
            actionError = '';
            dismissOwn(actionNote); actionNote = null;
            service.setPreferences(preferences.checked).then(() => {
                if (!service.getStatus().errors.length) message('OneDrive 同步偏好已更新', 'success');
            }).catch(error => message(error.message, 'error'))
                .finally(() => render(service.getStatus()));
        });
        body.append(option);
        errorLine = element('p', '', 'folder-sync-error'); errorLine.setAttribute('role', 'status'); body.append(errorLine);
        conflictList = element('div', '', 'folder-sync-conflicts'); body.append(conflictList);
        body.append(element('p', '“已写入同步文件夹”表示本机写入成功。云端上传进度由 OneDrive 客户端管理；其他电脑收到文件并打开网页后自动合并。未完成的练习窗口不会跨设备接管。', 'folder-sync-muted'));
        content.append(header, body); modal.append(content); doc.body.append(modal);
        modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('show'); });
        modal.addEventListener('keydown', event => { if (event.key === 'Escape') modal.classList.remove('show'); });
        render(service.getStatus());
        return modal;
    }
    function formatDate(value) { return value ? new Date(value).toLocaleString() : '尚无'; }
    function textStatus(status) {
        if (status.initializing) return '正在恢复本机同步设置…';
        if (!status.supported) return '当前环境不支持自动文件夹同步。请使用桌面 Chrome / Edge；必要时通过固定 localhost 地址打开。';
        if (!status.enabled || !status.bound) return '未连接同步空间，学习数据仍保存在当前浏览器。';
        if (status.recovering) return '正在恢复 OneDrive 自动同步…';
        if (status.permission !== 'granted') return '同步已暂停（自动同步设置仍为开启），等待浏览器授权。点击网页可自动请求恢复；若出现“每次访问都允许”，请选择以便下次自动连接。学习记录仍保存在本机，也可点击“恢复同步”。';
        if (status.busy) return '正在检查并合并同步文件…';
        return '自动同步已开启 · ' + status.directoryName + ' · 待发送 ' + status.pending + ' 条 · 待处理冲突 ' + status.conflicts.length
            + ' 项\n最近写入文件夹：' + formatDate(status.lastPublishAt) + '\n最近接收：' + formatDate(status.lastReceiveAt);
    }
    function render(status) {
        // A later verified pass also retires errors from a failed manual action.
        if (actionError && status.completedSyncs > actionErrorRevision && !status.errors.length) {
            actionError = ''; dismissOwn(actionNote); actionNote = null;
        }
        notifyAttention(status);
        const entry = doc.getElementById('folder-sync-entry-btn');
        if (entry) entry.textContent = status.initializing || status.recovering ? '☁️ OneDrive 同步 · 正在恢复' : !status.enabled || !status.bound ? '☁️ OneDrive 自动同步'
            : status.permission !== 'granted' ? '☁️ OneDrive 同步 · 已暂停'
                : status.blocked.length ? '☁️ OneDrive 同步 · 待确认删除'
                    : status.conflicts.length ? '☁️ OneDrive 同步 · 有冲突'
                        : status.errors.length ? '☁️ OneDrive 同步 · 需处理'
                            : status.pending ? '☁️ OneDrive 同步 · 待发送' : '☁️ OneDrive 同步 · 已开启';
        if (!modal) return;
        statusLine.textContent = textStatus(status);
        errorLine.textContent = [actionError, ...status.errors.map(error => (error.path ? error.path + '：' : '') + error.message)].filter(Boolean).slice(0, 5).join('\n');
        const connected = status.enabled && status.bound;
        const busy = status.busy || status.initializing || status.recovering;
        const needsPermission = connected && status.permission !== 'granted';
        setupGuide.hidden = connected;
        buttons.enable.hidden = connected;
        buttons.sync.hidden = buttons.disconnect.hidden = !connected;
        preferences.parentElement.hidden = !connected;
        buttons.permission.hidden = !needsPermission;
        buttons.enable.disabled = !status.supported || busy;
        buttons.sync.disabled = !connected || needsPermission || !status.supported || busy;
        buttons.disconnect.disabled = !connected || busy;
        buttons.permission.disabled = !status.supported || busy;
        preferences.disabled = !status.enabled || !status.bound || busy;
        preferences.checked = status.preferences === true;
        const signature = JSON.stringify([status.conflicts.map(item => [item.key, item.versions.map(version => version.id)]), status.blocked]);
        if (signature === versionSignature) return;
        versionSignature = signature; conflictList.replaceChildren();
        for (const blocked of status.blocked) {
            const item = element('section', '', 'folder-sync-conflict');
            item.append(element('p', '另一台电脑请求删除 ' + blocked.count + ' 条练习。为保护历史，已暂停应用这次删除。'));
            const approve = element('button', '确认应用这次批量删除', 'btn btn-secondary'); approve.type = 'button';
            action(approve, () => {
                if (global.confirm('确认从本机移除这次请求中的 ' + blocked.count + ' 条练习？原始同步日志仍保留。')) return service.approveDelete(blocked.id);
            });
            item.append(approve); conflictList.append(item);
        }
        if (status.conflicts.length) conflictList.append(element('h4', '选择需要保留的版本'));
        for (const conflict of status.conflicts) {
            const item = element('section', '', 'folder-sync-conflict');
            const first = conflict.versions.find(version => version.value.exists)?.value.value;
            const name = first?.practiceSummaries?.title || first?.title || ({ vocabulary: '词汇数据', libraries: '题库配置', achievements: '成就标记', preferences: '外观偏好' })[conflict.key] || conflict.key;
            item.append(element('strong', name));
            conflict.versions.forEach((version, index) => {
                const details = element('details');
                const label = (version.value.exists ? '版本 ' + (index + 1) : '删除此项') + ' · 来源 ' + version.id.slice(0, 8);
                details.append(element('summary', label));
                const raw = JSON.stringify(version.value, null, 2);
                details.append(element('pre', raw.length > 18000 ? raw.slice(0, 18000) + '\n…（预览已截断；完整版本保留在同步日志中）' : raw));
                const choose = element('button', '采用这个版本', 'btn btn-secondary'); choose.type = 'button';
                action(choose, () => {
                    if (global.confirm('采用所选版本并同步到其他电脑？其他原始版本仍保留在同步日志中。')) return service.resolve(conflict.key, version.id);
                });
                details.append(choose); item.append(details);
            });
            conflictList.append(item);
        }
    }
    function openModal() { ensureModal().classList.add('show'); }
    function boot() {
        doc.getElementById('folder-sync-entry-btn')?.addEventListener('click', openModal);
        service.onStatusChange(render);
    }
    global.FolderSyncPanel = Object.freeze({ open: openModal });
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
