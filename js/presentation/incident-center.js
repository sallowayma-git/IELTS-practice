(function attachIncidentCenter(global) {
    'use strict';

    const LIMITS = Object.freeze({ notices: 5, dialogs: 5, groups: 20, identities: 200, aggregationMs: 60000 });
    const NOTICE = '诊断信息不包含答案，也不是练习备份。关闭提示仅表示已知悉，不代表操作成功。';
    const ID = /^evt_[a-f0-9]{32}_[1-9][0-9]{0,15}$/;
    const TITLES = { APP_BOOT_FAILED: '应用启动失败', RESOURCE_LOAD_FAILED: '所需资源加载失败',
        PRACTICE_SAVE_FAILED: '练习保存异常', RECOVERY_SAVE_FAILED: '恢复快照保存异常',
        PRACTICE_CHANNEL_TIMEOUT: '练习通信超时', DATA_IMPORT_FAILED: '数据导入失败',
        DATA_EXPORT_FAILED: '数据导出失败', UNEXPECTED_RUNTIME_ERROR: '操作遇到异常' };
    function field(value, key) {
        try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch (_) { return undefined; }
    }
    function isSave(event) {
        return ['PRACTICE_SAVE_FAILED', 'RECOVERY_SAVE_FAILED'].includes(event.code)
            || ['submit', 'save', 'save-draft', 'save-recovery'].includes(event.action);
    }
    function outcome(event, operation = event.persistence.operation) {
        const subject = event.action === 'save-draft' ? '本次草稿'
            : event.code === 'RECOVERY_SAVE_FAILED' || event.action === 'save-recovery' ? '本次恢复快照'
                : event.action === 'submit' || event.code === 'PRACTICE_SAVE_FAILED' ? '本次练习提交' : '本次保存';
        if (isSave(event)) {
            if (operation === 'committed') return subject + '已确认保存；相关操作仍有异常，请查看详情。';
            if (operation === 'not-committed') return subject + '已确认未保存。请保留此页面。';
            return subject + '尚未确认保存。请保留此页面。';
        }
        return operation === 'committed' ? '本次操作已确认提交，但仍有异常需要查看。'
            : operation === 'not-committed' ? '本次操作已确认未提交。' : '本次操作结果尚未确认。';
    }
    function kind(event) {
        const requested = event.notification.kind;
        if (requested === 'none' || requested === 'startup') return requested;
        if (event.notification.requiresDismissal || (isSave(event) && event.persistence.operation === 'unconfirmed')) return 'dialog';
        return requested;
    }
    function groupingKey(event) {
        return JSON.stringify([event.fingerprint, event.module, event.action, event.windowId,
            event.correlation, event.persistence.operation, kind(event)]);
    }
    function sameOperation(left, right) {
        return left && right && left.operationAlias === right.operationAlias
            && left.submissionAlias === right.submissionAlias;
    }
    function node(tag, text, className) {
        const result = global.document.createElement(tag);
        if (text !== undefined) result.textContent = text;
        if (className) result.className = className;
        return result;
    }
    function button(label, handler) {
        const result = node('button', label);
        result.type = 'button';
        result.addEventListener('click', () => { try { Promise.resolve(handler()).catch(() => {}); } catch (_) { } });
        return result;
    }
    function setText(target, value) {
        if (target.textContent !== value) target.textContent = value;
    }

    class IncidentCenter {
        constructor(options = {}) {
            this.transient = options.transient || (() => {});
            this.now = options.now || (() => Date.now());
            this.groups = new Map();
            this.seen = new Map();
            this.attempts = new Map();
            this.queue = [];
            this.overflow = 0;
            this.root = null;
            this.cardNodes = new Map();
            this.renderTask = null;
            this.dialog = null;
            this.returnFocus = null;
            this.inertNodes = [];
            this.fallbackText = '';
            this.normalizer = global.AppDiagnosticContract?.createNormalizer();
            this.reporter = global.AppDiagnostics || global.AppDiagnosticBootstrap?.current();
            this.unsubscribe = this.reporter?.subscribe?.((event) => this.show(event));
            try { this.reporter?.snapshot().events.forEach((event) => this.show(event)); } catch (_) { }
        }

        report(input, presentation = {}) {
            try {
                const data = {};
                ['code', 'module', 'action', 'error', 'newOccurrence', 'resource', 'correlation', 'correlationAliases',
                    'persistence', 'retry', 'collection', 'breadcrumbs', 'cancelled'].forEach((key) => { data[key] = field(input, key); });
                const impact = field(presentation, 'impact');
                data.notification = { kind: impact === 'expected' || impact === 'recovered' || data.cancelled === true
                    || (data.code === 'RESOURCE_LOAD_FAILED' && field(data.resource, 'optional') === true) ? 'none'
                    : data.code === 'APP_BOOT_FAILED' ? 'startup'
                        : isSave(data) && field(data.persistence, 'operation') !== 'committed'
                            && field(data.persistence, 'operation') !== 'not-committed' ? 'dialog' : 'persistent' };
                // The reporter owns identity, privacy and capture before any presentation.
                const id = this.reporter?.report(data);
                if (id) this.show(id, presentation);
                return id || null;
            } catch (_) { return null; }
        }

        show(reference, presentation = {}) {
            let event;
            try {
                event = this.normalizer?.sanitizeEvent(typeof reference === 'string' ? this.reporter?.getIncident(reference) : reference);
                if (!event) return null;
                const eventKind = kind(event);
                // Startup has an independent early panel, including export without this UI.
                if (eventKind === 'none') return event.eventId;
                if (eventKind === 'startup') { this.deferToStartup(); return event.eventId; }
                const time = this.now();
                const previous = this.seen.get(event.eventId);
                const key = groupingKey(event);
                let item = previous && this.groups.get(previous.id);
                let regrouped = false;
                let dismissed = false;
                if (item && item.key !== key && item.count > 1) {
                    dismissed = item.dismissed;
                    this.detachMember(item, event.eventId);
                    item = null;
                    regrouped = true;
                }
                if (item) {
                    if (item.event.eventId === event.eventId) {
                        if (item.key !== key) { item.operation = undefined; item.actionStatus = ''; }
                        item.event = event;
                        item.key = key;
                    }
                    item.kind = eventKind;
                } else if (!previous || regrouped) {
                    item = Array.from(this.groups.values()).find((candidate) => candidate.key === key
                        && (!dismissed || candidate.dismissed)
                        && time >= candidate.started && time - candidate.started < LIMITS.aggregationMs);
                    if (item) item.count = Math.min(Number.MAX_SAFE_INTEGER, item.count + 1);
                    else {
                        if (this.groups.size >= LIMITS.groups) {
                            const expired = Array.from(this.groups.values()).find((candidate) =>
                                (candidate.dismissed || candidate.kind === 'transient') && candidate.id !== this.dialog?.item?.id);
                            if (expired) this.groups.delete(expired.id);
                        }
                        if (this.groups.size < LIMITS.groups) {
                            item = { id: event.eventId, event, key, started: time, kind: eventKind, count: 1,
                                dismissed, transientShown: false, retry: null, busy: false, actionStatus: '' };
                            this.groups.set(item.id, item);
                        } else this.overflow = Math.min(Number.MAX_SAFE_INTEGER, this.overflow + 1);
                    }
                }
                if (item || !previous || regrouped) {
                    this.seen.set(event.eventId, { id: item?.id || event.eventId, event });
                    if (this.seen.size > LIMITS.identities) this.seen.delete(this.seen.keys().next().value);
                }
                if (item) {
                    // Functions stay only in bounded page UI state, never diagnostic records.
                    const retry = field(presentation, 'retry');
                    if (retry && event.eventId === item.id) item.retry = this.safeRetry(event, retry);
                    this.refreshRetry(item);
                    if (!item.dismissed && eventKind === 'transient' && !item.transientShown) {
                        if (item.count === 1) this.transient(TITLES[event.code] + '。' + outcome(event), 'info');
                        item.transientShown = true;
                    }
                    if (!item.dismissed && eventKind === 'dialog' && item.id !== this.dialog?.item?.id && !this.queue.includes(item.id)) {
                        if (this.queue.length < LIMITS.dialogs) this.queue.push(item.id);
                        // All other incidents remain reachable through history, without replay.
                    }
                }
                // Capture, grouping and retry bindings stay synchronous. Only
                // ordinary notice DOM work waits for the next rendering frame.
                if (this.dialog?.item === item) this.refreshDialog();
                this.scheduleRender(event);
                this.advance();
                return item?.id || event.eventId;
            } catch (_) {
                this.fallback(event);
                return event?.eventId || null;
            }
        }

        scheduleRender(event) {
            if (this.renderTask) { this.renderTask.event = event; return; }
            const task = { frame: null, timer: null, event };
            this.renderTask = task;
            const flush = () => {
                if (this.renderTask !== task) return;
                this.renderTask = null;
                if (task.frame !== null) global.cancelAnimationFrame?.(task.frame);
                if (task.timer !== null) global.clearTimeout?.(task.timer);
                try { this.render(); } catch (_) { this.fallback(this.dialog?.item?.event || task.event); }
            };
            if (typeof global.requestAnimationFrame === 'function') {
                task.frame = global.requestAnimationFrame(flush);
                // Background windows may pause animation frames; a timer keeps
                // notices deliverable subject to the browser's timer throttling.
                task.timer = global.setTimeout(flush, 100);
            } else task.timer = global.setTimeout(flush, 16);
        }

        detachMember(item, eventId) {
            item.count--;
            if (item.id !== eventId) return;
            // Keep the old group's reference attached to a remaining observation.
            // Identity snapshots share the existing bounded 200-entry bookkeeping.
            const survivor = Array.from(this.seen.values()).find((entry) => entry.id === item.id && entry.event.eventId !== eventId);
            this.groups.delete(item.id);
            if (survivor) {
                item.id = survivor.event.eventId;
                item.event = survivor.event;
                item.retry = null;
                item.operation = undefined;
                item.actionStatus = '';
                this.groups.set(item.id, item);
                for (const entry of this.seen.values()) if (entry.id === eventId) entry.id = item.id;
                this.queue = this.queue.map((id) => id === eventId ? item.id : id);
                this.refreshRetry(item);
            } else {
                // Old members may have aged out of UI bookkeeping; passive history
                // retains them without displaying the enriched ID under an old code.
                this.queue = this.queue.filter((id) => id !== eventId);
                if (this.dialog?.item === item) this.removeDialog();
            }
        }

        safeRetry(event, action) {
            const run = field(action, 'run');
            if (!event.retry.available || typeof run !== 'function' || event.persistence.operation === 'committed'
                || field(action, 'action') !== event.retry.action
                || field(action, 'operationAlias') !== event.retry.operationAlias
                || field(action, 'submissionAlias') !== event.retry.submissionAlias) return null;
            return { run, action: event.retry.action, operationAlias: event.retry.operationAlias,
                submissionAlias: event.retry.submissionAlias };
        }

        validatedRetry(item) {
            if (!item.retry) return null;
            try {
                item.retry = this.safeRetry(item.event, item.retry);
                const current = this.reporter?.getIncident(item.id);
                if (current) item.retry = this.safeRetry(current, item.retry);
            } catch (_) { item.retry = null; }
            if (!item.retry) item.actionStatus = '';
            return item.retry;
        }

        refreshRetry(item) {
            const retry = this.validatedRetry(item);
            // Attempts belong to incidents/operations, not mutable presentation groups.
            const busy = this.attempts.has(item.id) || Array.from(this.attempts.values())
                .some((attempt) => sameOperation(attempt.retry, retry));
            if (busy) item.actionStatus = '正在检查并重试原操作，请保留此页面。';
            else if (item.busy) item.actionStatus = '';
            item.busy = busy;
            return retry;
        }

        async retry(item) {
            const retry = this.refreshRetry(item);
            if (!retry || item.busy || item.count !== 1 || this.attempts.size >= LIMITS.groups
                || (item.operation || item.event.persistence.operation) === 'committed') return;
            const id = item.id;
            const key = item.key;
            this.attempts.set(id, { retry });
            this.refreshRetry(item);
            let result;
            let failed = false;
            try {
                this.refreshDialog();
                result = await retry.run();
            } catch (_) { failed = true; }
            finally {
                this.attempts.delete(id);
                // Clear every replacement control, including a detached/evicted item.
                for (const current of new Set([item, ...this.groups.values(), this.dialog?.item])) {
                    if (current) this.refreshRetry(current);
                }
                const current = this.groups.get(id);
                const bound = current && this.validatedRetry(current);
                if (current?.key === key && current.count === 1 && bound?.run === retry.run
                    && bound.action === retry.action && sameOperation(bound, retry)) {
                    const operation = field(result, 'operation');
                    if (failed) current.actionStatus = '重试未能确认结果，请保留此页面并导出诊断。';
                    else if (field(result, 'verified') === true && ['committed', 'not-committed', 'unconfirmed'].includes(operation)) {
                        current.operation = operation;
                        current.actionStatus = outcome(current.event, operation);
                    } else current.actionStatus = '重试尚未提供已验证的结果，请保留此页面。';
                }
                try { this.render(); } catch (_) { this.fallback(item.event); }
            }
        }

        render() {
            if (this.renderTask) {
                if (this.renderTask.frame !== null) global.cancelAnimationFrame?.(this.renderTask.frame);
                if (this.renderTask.timer !== null) global.clearTimeout?.(this.renderTask.timer);
                this.renderTask = null;
            }
            const active = Array.from(this.groups.values()).filter((item) => !item.dismissed && item.kind !== 'transient');
            if (!active.length && !this.overflow && !this.root) return;
            if (!this.root || !this.root.isConnected) {
                this.announcement = null;
                this.cardNodes.clear();
                this.root = node('section', undefined, 'incident-notifications');
                this.root.id = 'incident-notifications';
                this.root.setAttribute('aria-label', '操作异常通知');
                global.document.body.appendChild(this.root);
                if (this.dialog) this.makeInert(this.root);
            }
            // Keep one stable live region; announce text, never a subtree of controls.
            if (!this.announcement) {
                this.announcement = node('p', '', 'incident-announcement');
                this.announcement.setAttribute('role', 'status');
                this.announcement.setAttribute('aria-live', 'polite');
                this.root.appendChild(this.announcement);
                this.cards = node('div');
                this.root.appendChild(this.cards);
                this.historyButton = button('查看诊断历史', () => this.openHistory());
                this.root.appendChild(this.historyButton);
            }
            const focused = global.document.activeElement;
            const focusId = this.cards.contains(focused) ? focused?.getAttribute('data-incident') : null;
            const visible = active.slice(0, LIMITS.notices);
            const ids = new Set(visible.map((item) => item.id));
            for (const [id, entry] of this.cardNodes) {
                if (!ids.has(id)) { entry.card.remove(); this.cardNodes.delete(id); }
            }
            for (let index = 0; index < visible.length; index++) {
                const item = visible[index];
                let entry = this.cardNodes.get(item.id);
                if (!entry) {
                    entry = { card: node('article', undefined, 'incident-notice'),
                        title: node('strong'), outcome: node('p'), reference: node('p', undefined, 'incident-reference'), item };
                    entry.details = button('查看详情', () => this.open(entry.item));
                    entry.details.setAttribute('data-incident', item.id);
                    [entry.title, entry.outcome, entry.reference, entry.details].forEach((child) => entry.card.appendChild(child));
                    this.cardNodes.set(item.id, entry);
                }
                entry.item = item;
                const values = [TITLES[item.event.code], outcome(item.event, item.operation),
                    '事件编号：' + item.id + (item.count > 1 ? ' · 同类事件 ' + item.count + ' 次' : '')];
                [entry.title, entry.outcome, entry.reference].forEach((child, index) => {
                    if (child.textContent !== values[index]) child.textContent = values[index];
                });
                if (this.cards.children[index] !== entry.card) {
                    this.cards.insertBefore(entry.card, this.cards.children[index] || null);
                }
                if (focusId === item.id && global.document.activeElement !== entry.details) entry.details.focus();
            }
            const hidden = Math.max(0, active.length - LIMITS.notices) + this.overflow;
            const text = active.length || this.overflow ? '有操作异常需要查看。' + (hidden ? '另有 ' + hidden + ' 项，请查看诊断历史。' : '') : '提示已关闭，诊断历史仍可查看。';
            if (this.announcement.textContent !== text) this.announcement.textContent = text;
            this.refreshDialog();
        }

        advance() {
            if (this.dialog || this.startupActive()) return;
            while (this.queue.length) {
                const item = this.groups.get(this.queue.shift());
                if (item && !item.dismissed && item.kind === 'dialog') { this.open(item); return; }
            }
        }

        startupActive() {
            return global.document?.getElementById('diagnostic-startup-failure')?.getAttribute('role') === 'alert';
        }

        deferToStartup() {
            if (!this.startupActive()) return;
            const item = this.dialog?.item;
            if (item && !item.dismissed) {
                this.queue = [item.id, ...this.queue.filter((id) => id !== item.id)].slice(0, LIMITS.dialogs);
            }
            this.removeDialog();
            // The standalone startup panel must remain keyboard-accessible. Resume
            // queued dialogs only after the collector explicitly marks startup ready.
            const panel = global.document.getElementById('diagnostic-startup-failure');
            if (!this.startupObserver && global.MutationObserver) {
                this.startupObserver = new global.MutationObserver(() => {
                    if (this.startupActive()) return;
                    this.startupObserver.disconnect();
                    this.startupObserver = null;
                    try { this.advance(); } catch (_) { this.fallback(item?.event); }
                });
                this.startupObserver.observe(panel, { attributes: true, attributeFilter: ['role'] });
            }
        }

        makeInert(element) {
            this.inertNodes.push({ element, inert: element.inert });
            element.inert = true;
        }

        shell(title, item) {
            if (this.dialog) return null;
            const doc = global.document;
            if (!this.returnFocus) this.returnFocus = doc.activeElement;
            const overlay = node('div', undefined, 'incident-backdrop');
            const panel = node('section', undefined, 'incident-dialog');
            panel.setAttribute('role', item?.kind === 'dialog' ? 'alertdialog' : 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-labelledby', 'incident-dialog-title');
            panel.setAttribute('aria-describedby', 'incident-dialog-description');
            const heading = node('h2', title);
            heading.id = 'incident-dialog-title';
            heading.tabIndex = -1;
            const description = node('p', NOTICE);
            description.id = 'incident-dialog-description';
            panel.appendChild(heading);
            panel.appendChild(description);
            overlay.appendChild(panel);
            doc.body.appendChild(overlay);
            this.dialog = { overlay, panel, heading, item };
            for (const element of Array.from(doc.body.children)) if (element !== overlay) this.makeInert(element);
            this.keyHandler = (event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); return; }
                if (event.key !== 'Tab') return;
                const targets = Array.from(panel.querySelectorAll('button:not([disabled]):not([hidden]), textarea:not([hidden]), summary, [tabindex="0"]'));
                const first = targets[0] || heading;
                const last = targets[targets.length - 1] || heading;
                if (event.shiftKey && (doc.activeElement === first || doc.activeElement === heading || !panel.contains(doc.activeElement))) {
                    event.preventDefault(); last.focus();
                } else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === heading || !panel.contains(doc.activeElement))) {
                    event.preventDefault(); first.focus();
                }
            };
            this.focusHandler = (event) => { if (!panel.contains(event.target)) heading.focus(); };
            doc.addEventListener('keydown', this.keyHandler, true);
            doc.addEventListener('focusin', this.focusHandler, true);
            return this.dialog;
        }

        open(item) {
            if (this.dialog || this.startupActive()) return;
            try {
                const dialog = this.shell(TITLES[item.event.code], item);
                dialog.outcome = node('p');
                dialog.outcome.id = 'incident-dialog-outcome';
                dialog.panel.setAttribute('aria-describedby', 'incident-dialog-outcome incident-dialog-description');
                dialog.reference = node('p', undefined, 'incident-reference');
                dialog.panel.appendChild(dialog.outcome);
                dialog.panel.appendChild(dialog.reference);
                dialog.status = node('p');
                dialog.status.setAttribute('role', 'status');
                dialog.panel.appendChild(dialog.status);
                const technical = node('details');
                technical.appendChild(node('summary', '技术详情（仅文本）'));
                dialog.technical = node('pre');
                technical.appendChild(dialog.technical);
                dialog.panel.appendChild(technical);
                dialog.text = this.exportTarget(dialog.panel);
                const actions = node('div', undefined, 'incident-actions');
                actions.appendChild(button('导出诊断', () => this.deliver(item.id, dialog.text, 'download')));
                actions.appendChild(button('复制摘要', () => this.deliver(item.id, dialog.text, 'copySummary')));
                dialog.retryButton = button('安全重试原操作', () => this.retry(item));
                actions.appendChild(dialog.retryButton);
                actions.appendChild(button('关闭提示（不代表已保存）', () => this.close()));
                dialog.panel.appendChild(actions);
                this.refreshDialog();
                dialog.heading.focus();
            } catch (_) { this.removeDialog(); this.fallback(item.event); }
        }

        refreshDialog() {
            const dialog = this.dialog;
            const item = dialog?.item;
            if (!item || !dialog.outcome) return;
            setText(dialog.heading, TITLES[item.event.code]);
            const role = item.kind === 'dialog' ? 'alertdialog' : 'dialog';
            if (dialog.panel.getAttribute('role') !== role) dialog.panel.setAttribute('role', role);
            if (dialog.technicalEvent !== item.event) {
                dialog.technicalText = JSON.stringify(item.event, null, 2);
                dialog.technicalEvent = item.event;
            }
            setText(dialog.technical, dialog.technicalText);
            setText(dialog.outcome, outcome(item.event, item.operation));
            setText(dialog.reference, '事件编号：' + item.id + (item.count > 1 ? ' · 同类事件 ' + item.count + ' 次；各事件保留在诊断历史中。' : ''));
            const hidden = !this.refreshRetry(item) || item.count !== 1 || (item.operation || item.event.persistence.operation) === 'committed';
            const disabled = item.busy || this.attempts.size >= LIMITS.groups;
            if (dialog.retryButton.hidden !== hidden) dialog.retryButton.hidden = hidden;
            if (dialog.retryButton.disabled !== disabled) dialog.retryButton.disabled = disabled;
            setText(dialog.status, item.actionStatus);
        }

        exportTarget(parent) {
            const text = node('textarea');
            text.readOnly = true;
            text.rows = 6;
            text.hidden = true;
            text.setAttribute('aria-label', '可复制的诊断文本');
            parent.appendChild(text);
            return text;
        }

        async deliver(eventId, text, action) {
            try {
                const exporter = global.AppDiagnosticExport;
                if (typeof exporter?.[action] === 'function') {
                    // Expose the provided target before the exporter attempts focus/select.
                    text.hidden = false;
                    const result = await exporter[action](eventId ? { eventId } : {}, { textTarget: text });
                    if (result?.report && !result.report.issues?.includes('export-generation-failed')) {
                        if (result.text) text.value = result.text;
                        if (result.status === 'text-fallback') { text.focus(); text.select(); }
                        return result;
                    }
                }
            } catch (_) { }
            const value = this.minimalText(eventId);
            this.fallbackText = value;
            try { text.hidden = false; text.value = value; text.focus(); text.select(); } catch (_) { }
            return { status: 'text-fallback', text: value };
        }

        minimalText(eventId) {
            try { if (this.reporter?.exportText) return this.reporter.exportText(eventId); } catch (_) { }
            const event = this.groups.get(eventId)?.event;
            return NOTICE + '\n事件编号：' + (ID.test(eventId) ? eventId : '不可用') + (event ? '\n' + JSON.stringify(event) : '');
        }

        async openHistory() {
            if (this.dialog || this.startupActive()) return;
            try {
                const dialog = this.shell('诊断历史', null);
                const info = node('p', '正在读取保留的诊断记录…');
                dialog.panel.appendChild(info);
                const list = node('div', undefined, 'incident-history');
                dialog.panel.appendChild(list);
                const text = this.exportTarget(dialog.panel);
                dialog.panel.appendChild(button('导出保留的诊断历史', () => this.deliver(null, text, 'download')));
                dialog.panel.appendChild(button('关闭历史', () => this.close()));
                dialog.heading.focus();
                let snapshot;
                try { snapshot = await global.AppDiagnosticExport.snapshot(); } catch (_) { snapshot = this.reporter?.snapshot(); }
                if (this.dialog !== dialog) return;
                const events = (snapshot?.events || []).map((event) => this.normalizer.sanitizeEvent(event)).filter(Boolean)
                    .sort((a, b) => b.timestamp - a.timestamp || b.sequence - a.sequence || a.eventId.localeCompare(b.eventId));
                info.textContent = '保留 ' + events.length + ' 条记录，按记录时间排序，跨窗口时钟可能不同。历史受容量和保留期限限制，可能不完整。关闭提示不会删除诊断记录。';
                if (snapshot?.transport?.aggregation === 'incomplete') {
                    info.textContent += ' 跨窗口诊断汇总不完整，可导出本页已保留的记录。';
                }
                // Paginate the bounded export snapshot; DOM size stays small even with 2,000 events.
                let offset = 0;
                const previous = button('上一页', () => { offset = Math.max(0, offset - 20); renderPage(); });
                const more = button('下一页', () => { offset += 20; renderPage(); });
                const renderPage = () => {
                    list.replaceChildren();
                    for (const event of events.slice(offset, offset + 20)) {
                        const entry = button(TITLES[event.code] + ' · ' + event.eventId + ' · ' + outcome(event), () => {
                            this.removeDialog();
                            this.open({ id: event.eventId, event, count: 1, kind: kind(event), retry: null, busy: false, actionStatus: '' });
                        });
                        list.appendChild(entry);
                    }
                    previous.disabled = offset === 0;
                    more.disabled = offset + 20 >= events.length;
                };
                renderPage();
                dialog.panel.appendChild(previous);
                dialog.panel.appendChild(more);
            } catch (_) { this.removeDialog(); this.fallback(); }
        }

        removeDialog() {
            if (!this.dialog) return;
            global.document.removeEventListener('keydown', this.keyHandler, true);
            global.document.removeEventListener('focusin', this.focusHandler, true);
            this.dialog.overlay.remove();
            this.dialog = null;
            for (const { element, inert } of this.inertNodes) element.inert = inert;
            this.inertNodes = [];
        }

        close() {
            const item = this.dialog?.item;
            if (item) {
                item.dismissed = true;
                const original = this.groups.get(item.id);
                if (original) original.dismissed = true;
                this.queue = this.queue.filter((id) => id !== item.id);
            }
            this.removeDialog();
            try { this.render(); this.advance(); } catch (_) { this.fallback(item?.event); }
            if (!this.dialog) {
                const target = this.returnFocus;
                this.returnFocus = null;
                if (target?.isConnected && !target.inert && typeof target.focus === 'function') target.focus();
                if (global.document.activeElement === global.document.body) this.historyButton?.focus();
            }
        }

        fallback(event) {
            // Independent DOM/text path: no template, stylesheet, app readiness or logger.
            const id = event?.eventId;
            this.fallbackText = (event ? TITLES[event.code] + '\n' + outcome(event) + '\n' : '') + this.minimalText(id);
            try {
                this.removeDialog();
                let root = global.document.getElementById('incident-minimal-fallback');
                if (!root) { root = node('section'); root.id = 'incident-minimal-fallback'; global.document.body.appendChild(root); }
                root.setAttribute('role', 'alert');
                root.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:2147483646;max-height:85vh;overflow:auto;background:white;color:#17202a;padding:16px;border:2px solid #a11;font:16px/1.5 system-ui';
                root.replaceChildren(node('p', (event ? TITLES[event.code] + '。' + outcome(event) : '诊断界面暂时不可用。') + NOTICE));
                root.appendChild(node('p', '事件编号：' + (id || '请查看诊断历史')));
                const text = this.exportTarget(root);
                text.hidden = false;
                text.value = this.fallbackText;
                text.style.cssText = 'display:block;width:100%;color:#17202a;background:white';
                root.appendChild(button('导出诊断或显示文本', () => this.deliver(id, text, 'download')));
                root.appendChild(button('导出保留的诊断历史', () => this.deliver(null, text, 'download')));
                root.appendChild(button('关闭提示（不代表已保存）', () => {
                    const item = this.groups.get(id);
                    if (item) item.dismissed = true;
                    this.queue = this.queue.filter((entry) => entry !== id);
                    root.remove();
                    this.returnFocus?.focus?.();
                    this.returnFocus = null;
                    try { this.advance(); } catch (_) { }
                }));
            } catch (_) {
                try {
                    let text = global.document.getElementById('incident-minimal-text');
                    if (!text) {
                        text = node('pre');
                        text.id = 'incident-minimal-text';
                        text.tabIndex = 0;
                        text.setAttribute('role', 'alert');
                        text.style.cssText = 'position:fixed;inset:12px;z-index:2147483646;overflow:auto;white-space:pre-wrap;background:white;color:#17202a;padding:16px';
                        global.document.body.appendChild(text);
                    }
                    text.textContent = this.fallbackText;
                } catch (_) { }
            }
        }
    }
    IncidentCenter.LIMITS = LIMITS;
    global.IncidentCenter = IncidentCenter;
})(typeof window !== 'undefined' ? window : globalThis);
