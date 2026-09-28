(function defineDiagnosticSettings(global) {
    'use strict';
    const root = global.document?.getElementById('diagnostic-settings');
    if (!root || global.DiagnosticSettingsPanel) return;
    const content = global.document.getElementById('diagnostic-settings-content');
    const ID = /^evt_[a-f0-9]{32}_[1-9][0-9]{0,15}$/;
    const NOTICE = '诊断报告用于排查问题，不包含答案，也不是学习数据备份。';
    const normalizer = global.AppDiagnosticContract?.createNormalizer();
    let built = false;
    let busy = false;
    let pendingEnabled = null;
    let events = [];
    let offset = 0;
    let selection = null;
    let readVersion = 0;
    let lookupVersion = 0;
    let timer;
    let lastGeneration;
    const ui = {};

    function node(tag, text, parent, className) {
        const element = global.document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        if (parent) parent.appendChild(element);
        return element;
    }
    function button(label, parent, action) {
        const element = node('button', label, parent, 'btn');
        element.type = 'button';
        element.addEventListener('click', () => { try { Promise.resolve(action()).catch(() => notify('操作未完成，请重试或选择诊断文本。')); } catch (_) { notify('操作未完成，请重试或选择诊断文本。'); } });
        return element;
    }
    function notify(text) { if (ui.feedback) ui.feedback.textContent = text; }
    function state() { try { return global.AppDiagnosticStore?.status(); } catch (_) { return null; } }
    function clean(rows) {
        return (Array.isArray(rows) ? rows.slice(0, 2000) : []).map((event) => normalizer?.sanitizeEvent(event)).filter(Boolean);
    }
    function renderStatus() {
        if (!built) return;
        const status = state();
        const mode = status?.detailedMode;
        ui.persistence.checked = pendingEnabled === null ? status?.enabled === true : pendingEnabled;
        ui.persistence.setAttribute('aria-busy', String(busy));
        ui.persistence.disabled = busy || !status || status.suspended;
        ui.clear.disabled = busy || !status || status.suspended;
        ui.retry.disabled = busy || !status?.enabled || status.suspended || typeof global.AppDiagnosticStore?.retry !== 'function';
        ui.detailed.disabled = busy || !mode || mode.coordination === 'unavailable';
        ui.detailed.textContent = mode?.active ? '关闭详细诊断' : '开启详细诊断（15 分钟）';
        const remaining = Math.ceil((mode?.remainingMs || 0) / 1000);
        ui.mode.textContent = mode?.active ? '详细诊断已开启，剩余 ' + Math.floor(remaining / 60) + ' 分 ' + (remaining % 60) + ' 秒。'
            : '详细诊断已关闭或已到期。';
        ui.mode.setAttribute('role', 'timer');
        // Countdown updates are visible without announcing every second.
        ui.mode.setAttribute('aria-live', 'off');
        ui.storage.textContent = !status ? '诊断存储不可用；仍可查看或导出当前页面可用的诊断信息。'
            : status.persistence === 'disabled' ? '持久化已关闭。仅保留短期当前页面上下文供即时提示和主动导出。'
                : status.persistence === 'memory-only' || status.persistence === 'failed' ? '当前为仅内存模式，诊断历史可能无法保存。请在离开页面前导出。'
                    : status.persistence === 'pending' ? '诊断记录正在保存；尚未确认所有记录已持久化。'
                        : '诊断历史持久化可用。保留上限：7 天、2,000 条或 2 MiB，以先达到的限制为准。';
        if (status?.failure) ui.storage.textContent += ' 存储状态：' + status.failure + '。';
        ui.coordination.textContent = mode?.coordination === 'supported-windows'
            ? '偏好与模式在支持协调、且共享此站点存储的窗口间同步。不同来源、部分 file:// 环境及未接入的练习窗口可能无法同步；不保证覆盖所有窗口。'
            : '当前环境无法确认跨窗口协调，相关更改可能不可用。请保留页面并导出当前上下文；不保证覆盖所有窗口。';
        if (lastGeneration !== undefined && status?.generation !== lastGeneration) {
            lastGeneration = status?.generation;
            if (root.open) void refresh();
        } else lastGeneration = status?.generation;
    }
    function selectEvent(event) {
        selection = normalizer?.sanitizeEvent(event) || null;
        ui.selected.hidden = false;
        ui.exportOne.disabled = !selection;
        ui.copyOne.disabled = !selection;
        ui.details.textContent = selection ? JSON.stringify(selection, null, 2) : '未找到该事件。它可能已过期、被清理或来自另一个窗口。';
        ui.selectedTitle.textContent = selection ? '事件编号：' + selection.eventId : '事件不可用';
        ui.outcome.textContent = selection ? '操作保存状态：' + ({ committed: '已确认保存', 'not-committed': '已确认未保存', unconfirmed: '尚未确认保存，请保留相关页面', 'not-applicable': '不适用' }[selection.persistence.operation] || '未知')
            + '。诊断记录状态：' + ({ persisted: '已保存', pending: '正在保存', disabled: '已禁用持久化', 'memory-only': '仅当前页面内存', failed: '保存失败' }[selection.persistence.diagnostics] || '未知') + '。' : '';
    }
    function renderPage() {
        ui.list.replaceChildren();
        for (const event of events.slice(offset, offset + 20)) {
            button(event.code + ' · ' + new Date(event.timestamp).toLocaleString() + ' · ' + event.eventId, ui.list, () => {
                lookupVersion += 1;
                selectEvent(event);
                ui.selectedTitle.focus();
            });
        }
        ui.previous.disabled = offset === 0;
        ui.next.disabled = offset + 20 >= events.length;
        ui.page.textContent = events.length ? '第 ' + (offset + 1) + '–' + Math.min(offset + 20, events.length) + ' 条，共 ' + events.length + ' 条' : '暂无可用事件。';
    }
    async function read(query) {
        try {
            const report = await global.AppDiagnosticExport.snapshot(query);
            return { events: clean(report.events), partial: report.issues?.some((issue) => issue !== 'incident-not-retained')
                || Object.values(report.sources || {}).some((source) => ['failed', 'timed-out', 'unavailable'].includes(source.state))
                || ['memory-only', 'failed', 'disabled'].includes(report.storage?.persistence), truncated: report.truncated };
        } catch (_) {
            let memory;
            try { memory = global.AppDiagnostics?.snapshot(query); } catch (_) { }
            return { events: clean(memory?.events), partial: true, truncated: memory?.truncated };
        }
    }
    async function refresh() {
        if (!built) return;
        const version = ++readVersion;
        const selected = selection;
        const selectedVersion = lookupVersion;
        ui.historyStatus.textContent = '正在读取诊断历史…';
        const result = await read({ limit: 2000 });
        if (version !== readVersion) return;
        events = result.events.sort((a, b) => b.timestamp - a.timestamp || b.sequence - a.sequence || a.eventId.localeCompare(b.eventId));
        offset = Math.min(offset, Math.max(0, Math.floor((events.length - 1) / 20) * 20));
        ui.historyStatus.textContent = (result.partial ? '诊断历史未能完整加载；以下是当前可用的记录，可重试诊断存储或直接导出。' : '最近事件与当前页面上下文。')
            + ' 按记录时间排序，跨窗口时钟可能不同。'
            + ' 历史受保留期限和容量限制，跨窗口汇总可能不完整。' + (result.truncated ? ' 结果已截断。' : '');
        renderPage();
        renderStatus();
        const stillSelected = () => version === readVersion && selectedVersion === lookupVersion && selection === selected;
        if (!selected || !stillSelected()) return;
        let event = events.find((entry) => entry.eventId === selected.eventId);
        let selectedResult = result;
        if (!event) {
            // The history report budgets metadata and context as well as events.
            // A missing row is not proof that its reference is no longer retained.
            selectedResult = await read({ eventId: selected.eventId, limit: 1 });
            if (!stillSelected()) return;
            event = selectedResult.events.find((entry) => entry.eventId === selected.eventId);
        }
        if (event || (!selectedResult.partial && !selectedResult.truncated)) selectEvent(event);
        else notify('暂时无法重新确认所选事件；保留上次读取的上下文，可重试诊断存储或导出。');
    }
    async function lookup() {
        const version = ++lookupVersion;
        const id = ui.reference.value.trim();
        if (!ID.test(id)) { selectEvent(null); notify('请输入完整的有效事件编号。'); return; }
        notify('正在查找事件…');
        const result = await read({ eventId: id });
        if (version !== lookupVersion) return;
        const event = result.events.find((entry) => entry.eventId === id);
        selectEvent(event);
        notify(event ? '已找到事件。' : result.partial ? '暂时无法完整查询诊断历史；未在当前可用记录中找到该事件。可重试或导出当前上下文。' : '未找到该事件；请核对编号、保留期限及窗口来源。');
        ui.selectedTitle.focus();
    }
    async function deliver(eventId, action) {
        ui.text.hidden = false;
        let result;
        try { result = await global.getMessageCenter?.().deliverDiagnostics(eventId, ui.text, action); } catch (_) { }
        if (!result) {
            try { result = await global.AppDiagnosticExport[action](eventId ? { eventId } : {}, { textTarget: ui.text }); } catch (_) { }
        }
        if (!result) {
            let text = NOTICE + '\n诊断导出暂不可用，请保留相关页面。';
            try { text = global.AppDiagnostics?.exportText(eventId) || text; } catch (_) { }
            result = { status: 'text-fallback', text };
        }
        ui.text.value = result.text || NOTICE;
        notify(result.status === 'download-started' ? '已请求下载诊断报告。' : result.status === 'copied' ? '诊断摘要已复制。' : '文件导出或剪贴板不可用；下方文本已可选择复制。');
        if (result.status === 'text-fallback') { ui.text.focus(); ui.text.select(); }
    }
    async function change(action, value) {
        if (busy) return;
        busy = true;
        if (action === 'setEnabled') pendingEnabled = value;
        renderStatus();
        notify('正在更新诊断设置；清理受阻时会等待其他窗口释放诊断数据库。');
        let result;
        try { result = await global.AppDiagnosticStore[action](value); } catch (_) { }
        busy = false;
        pendingEnabled = null;
        renderStatus();
        notify(result?.success ? action === 'clear' ? '保留的诊断历史已清理。学习数据未更改，当前页面上下文仍可导出。'
            : '诊断设置已更新。学习数据未更改。'
            : '操作未完成；无法确认诊断历史已移除或设置已生效。请查看存储状态并重试，当前上下文仍可导出。');
        await refresh();
    }
    async function retryStorage() {
        const status = state();
        if (busy || !status?.enabled || status.suspended) return;
        busy = true;
        renderStatus();
        notify('正在重试诊断存储…');
        let result;
        try { result = await global.AppDiagnosticStore.retry(); } catch (_) { }
        busy = false;
        renderStatus();
        notify(result?.success ? '诊断存储重试成功，正在重新读取历史。'
            : '诊断存储仍不可用；请稍后重试或导出当前页面上下文。');
        await refresh();
    }
    function build() {
        content.replaceChildren();
        ui.feedback = node('p', '', content);
        ui.feedback.setAttribute('role', 'status');
        ui.feedback.setAttribute('aria-live', 'polite');
        ui.storage = node('p', '', content);
        ui.storage.setAttribute('role', 'status');
        ui.coordination = node('p', '', content, 'hero-panel__muted');
        const controls = node('div', undefined, content, 'diagnostic-settings-controls');
        const label = node('label', undefined, controls);
        ui.persistence = node('input', undefined, label);
        ui.persistence.type = 'checkbox';
        ui.persistence.id = 'diagnostic-persistence';
        node('span', '在此浏览器保留诊断历史', label);
        node('p', '关闭持久化会移除已保留的诊断历史。短期当前页面上下文仍用于即时反馈和主动导出；重新开启不会恢复被清理的历史。', controls);
        ui.persistence.addEventListener('change', () => { void change('setEnabled', ui.persistence.checked); });
        ui.clear = button('仅清理诊断历史', controls, () => change('clear'));
        ui.detailed = button('开启详细诊断（15 分钟）', controls, () => change('setDetailedMode', !state()?.detailedMode?.active));
        ui.mode = node('p', '', controls);
        node('p', '详细模式额外保留语义操作线索，15 分钟后自动关闭；不记录按键或任意页面交互，不提高脱敏与容量上限。', controls, 'hero-panel__muted');
        const form = node('form', undefined, content, 'diagnostic-lookup');
        const referenceLabel = node('label', '事件编号', form);
        referenceLabel.htmlFor = 'diagnostic-reference';
        ui.reference = node('input', undefined, form);
        ui.reference.id = 'diagnostic-reference';
        ui.reference.type = 'text';
        ui.reference.maxLength = 70;
        ui.reference.autocomplete = 'off';
        ui.reference.spellcheck = false;
        const submit = node('button', '查找事件', form, 'btn');
        submit.type = 'submit';
        form.addEventListener('submit', (event) => { event.preventDefault(); void lookup(); });
        node('h4', '最近事件', content);
        ui.historyStatus = node('p', '', content);
        ui.historyStatus.setAttribute('role', 'status');
        button('刷新诊断历史', content, refresh);
        ui.retry = button('重试诊断存储', content, retryStorage);
        ui.list = node('div', undefined, content, 'diagnostic-event-list');
        const pages = node('div', undefined, content, 'diagnostic-settings-actions');
        ui.previous = button('上一页', pages, () => { offset = Math.max(0, offset - 20); renderPage(); });
        ui.page = node('span', '', pages);
        ui.page.setAttribute('role', 'status');
        ui.next = button('下一页', pages, () => { offset += 20; renderPage(); });
        ui.selected = node('section', undefined, content, 'diagnostic-selected');
        ui.selected.hidden = true;
        ui.selectedTitle = node('h4', '', ui.selected);
        ui.selectedTitle.tabIndex = -1;
        ui.outcome = node('p', '', ui.selected);
        const technical = node('details', undefined, ui.selected);
        node('summary', '技术详情与操作上下文（仅文本）', technical);
        ui.details = node('pre', '', technical);
        const selectedActions = node('div', undefined, ui.selected, 'diagnostic-settings-actions');
        ui.exportOne = button('导出此事件诊断', selectedActions, () => selection && deliver(selection.eventId, 'download'));
        ui.copyOne = button('复制此事件摘要', selectedActions, () => selection && deliver(selection.eventId, 'copySummary'));
        const historyActions = node('div', undefined, content, 'diagnostic-settings-actions');
        button('导出保留的诊断历史', historyActions, () => deliver(null, 'download'));
        button('复制诊断历史摘要', historyActions, () => deliver(null, 'copySummary'));
        ui.text = node('textarea', undefined, content);
        ui.text.readOnly = true;
        ui.text.rows = 8;
        ui.text.hidden = true;
        ui.text.setAttribute('aria-label', '可选择复制的诊断摘要');
        built = true;
        global.AppDiagnosticStore?.subscribe?.(renderStatus);
    }
    function open() {
        try {
            if (!built) build();
            renderStatus();
            void refresh();
            global.clearInterval(timer);
            timer = global.setInterval(renderStatus, 1000);
        } catch (_) {
            content.replaceChildren();
            node('p', '诊断设置加载失败。可保留页面并使用下方诊断文本；学习数据未更改。', content);
            const text = node('textarea', undefined, content);
            text.readOnly = true;
            text.rows = 8;
            text.setAttribute('aria-label', '诊断文本');
            try { text.value = global.AppDiagnostics?.exportText() || NOTICE; } catch (_) { text.value = NOTICE; }
            built = false;
        }
    }
    root.addEventListener('toggle', () => { if (root.open) open(); else global.clearInterval(timer); });
    global.addEventListener('pageshow', () => { if (root.open) open(); });
    global.addEventListener('pagehide', () => global.clearInterval(timer));
    global.document.addEventListener('visibilitychange', () => { if (!global.document.hidden && root.open) renderStatus(); });
    global.DiagnosticSettingsPanel = Object.freeze({ open(eventId) {
        root.open = true;
        open();
        if (built && typeof eventId === 'string') { ui.reference.value = eventId; void lookup(); }
    } });
})(typeof window !== 'undefined' ? window : this);
