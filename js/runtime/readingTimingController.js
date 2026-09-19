(function installReadingTimingController(global) {
    'use strict';
    const timing = global.ReadingTiming;
    if (!timing) return;
    const now = () => global.performance.now();
    const token = () => global.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    class Controller {
        constructor(context) {
            this.context = context;
            this.writer = token();
            this.entries = new Map();
            this.loading = new Map();
            this.active = null;
            this.generation = 0;
            this.error = '';
            this.keyboardFocusAt = -Infinity;
            this.attach();
            this.interval = global.setInterval(() => {
                this.refresh();
                if (this.active && now() - this.active.savedClock >= 4500) this.save(this.active).catch(() => {});
            }, 1000);
        }
        key(ctx) { return JSON.stringify([ctx.parentAttemptId || ctx.sessionId, ctx.libraryConfigurationId, ctx.examId, ctx.sequenceIndex ?? null]); }
        eligible() {
            const ctx = this.context();
            return Boolean(ctx.editable && ctx.running && document.visibilityState === 'visible'
                && document.hasFocus() && this.active?.owned && this.active.key === this.key(ctx));
        }
        refresh() {
            this.active?.meter.eligibility(this.eligible(), now());
            if (this.active && !this.active.meter.value.frozen && this.active.meter.value.paused !== !this.context().running) {
                this.active.meter.value.paused = !this.context().running;
                this.active.meter.value.revision++;
            }
            this.render();
        }
        stop() {
            if (this.active) {
                this.active.meter.eligibility(false, now());
                this.save(this.active).catch(() => {});
            }
            this.render();
        }
        async loadEntry(ctx, draft) {
            const key = this.key(ctx);
            const existing = this.entries.get(key);
            if (existing) return existing;
            if (!this.loading.has(key)) {
                this.loading.set(key, this.createEntry(ctx, draft).finally(() => this.loading.delete(key)));
            }
            return this.loading.get(key);
        }
        async createEntry(ctx, draft) {
            const key = this.key(ctx);
            const previous = timing.normalize(draft?.readingTiming);
            if (draft?.readingTiming && (!previous || !timing.sameSource(previous, ctx))) throw new Error('草稿计时与题库来源不一致');
            const identity = { attemptId: previous?.attemptId || key, examId: ctx.examId,
                libraryConfigurationId: ctx.libraryConfigurationId, writer: this.writer,
                parentAttemptId: ctx.parentAttemptId || null, sequenceIndex: ctx.sequenceIndex ?? null };
            const initial = new timing.Meter(ctx.dataset, identity, previous);
            // Empty inline slots are created during rendering, even for a new
            // attempt. Only a restored draft or prior learner work predates v1.
            const legacyDraft = draft && (Number(draft.updatedAt) < global.performance.timeOrigin
                || Object.keys(draft.answers || {}).length || draft.noteText
                || draft.highlights?.length || draft.notes?.length || draft.markedQuestions?.length);
            if (legacyDraft && !previous) initial.partial('legacy-start');
            if (previous) initial.partial('recovery-tail');
            const row = await global.AppData.recovery.acquireReadingTiming(initial.snapshot(), previous);
            const entry = { key, meter: new timing.Meter(ctx.dataset, identity, row.snapshot), owned: true,
                savedAt: Date.parse(row.updatedAt), savedClock: now(), acknowledged: row.snapshot, pending: null, saving: null };
            this.entries.set(key, entry);
            return entry;
        }
        async activate(draft = null) {
            const ctx = this.context();
            if (!ctx.sessionId || !ctx.examId || !ctx.dataset || !ctx.editable
                || !Object.prototype.hasOwnProperty.call(ctx, 'libraryConfigurationId')
                || ctx.libraryConfigurationId === undefined) { this.stop(); return; }
            const key = this.key(ctx);
            if (this.active?.key === key) { this.refresh(); return; }
            this.stop();
            this.active = null;
            const generation = ++this.generation;
            try {
                const entry = await this.loadEntry(ctx, draft);
                if (generation !== this.generation || this.key(this.context()) !== key) return;
                this.active = entry;
                if (entry.meter.value.paused) ctx.restorePause?.();
                this.error = '';
                this.refresh();
            } catch (error) {
                if (generation !== this.generation) return;
                this.error = error.code === 'TIMING_FINALIZED' ? '该次计时已经提交' : `计时不可用：${error.message}`;
                this.render();
            }
        }
        snapshot(examId = null) {
            const entry = examId
                ? [...this.entries.values()].find(item => item.meter.value.examId === examId)
                : (this.active?.key === this.key(this.context()) ? this.active : null);
            return entry ? entry.meter.snapshot(now()) : null;
        }
        async save(entry = this.active) {
            if (!entry?.owned) return;
            const snapshot = entry.meter.snapshot(now());
            if (entry.acknowledged?.revision === snapshot.revision && !entry.pending) return;
            entry.pending = snapshot;
            if (entry.saving) return entry.saving;
            entry.saving = (async () => {
                while (entry.pending) {
                    const next = entry.pending;
                    entry.pending = null;
                    try {
                        const row = await global.AppData.recovery.saveReadingTiming(next);
                        entry.acknowledged = row.snapshot;
                        entry.savedAt = Date.parse(row.updatedAt);
                        entry.savedClock = now();
                        if (entry === this.active) this.error = '';
                    } catch (error) {
                        entry.meter.partial('save-failed');
                        if (['TIMING_STALE_WRITER', 'TIMING_FINALIZED'].includes(error.code)) {
                            entry.owned = false;
                            entry.meter.eligibility(false, now());
                        }
                        this.error = entry.owned ? '计时保存失败，未保存的尾段可能丢失；可重试保存。' : '计时已由另一窗口接管或提交。';
                        throw error;
                    } finally { this.render(); }
                }
            })().finally(() => { entry.saving = null; });
            return entry.saving;
        }
        select(questionId) {
            if (!this.active || !this.context().editable) return;
            // A fresh learner action after a failed submission explicitly resumes
            // answering. A retry without editing retains the same frozen snapshot.
            if (this.active.meter.value.frozen) this.active.meter.thaw(now());
            this.refresh();
            this.active.meter.select(questionId, now());
            this.save(this.active).catch(() => {});
            this.render();
        }
        async freezeAll(passages = []) {
            for (const entry of this.entries.values()) entry.meter.freeze(now());
            // A restored inline suite may submit without revisiting its inactive
            // children. Recover and seal their own committed totals as well.
            for (const passage of passages) {
                const entry = await this.loadEntry(passage.context, passage.draft);
                entry.meter.freeze(now());
            }
            this.render();
            await Promise.all([...this.entries.values()].map(entry => this.save(entry)));
        }
        attach() {
            const gesture = event => {
                if (event.isTrusted) this.keyboardFocusAt = event.type === 'keydown' && event.key === 'Tab' ? now() : -Infinity;
            };
            document.addEventListener('pointerdown', gesture, true);
            document.addEventListener('keydown', gesture, true);
            const select = event => {
                if (!event.isTrusted || !this.active || !this.context().editable) return;
                if (event.type === 'focusin' && now() - this.keyboardFocusAt > 150) return;
                const target = event.target;
                if (!target?.closest) return;
                if (target.closest('#reading-note-editor, #reading-note-drawer')) { this.select(null); return; }
                if (!target.closest('#question-groups, #left')) return;
                const control = target.closest('input,select,textarea,.dropzone,.drop-zone,.match-dropzone,.paragraph-dropzone,.drop-target-summary')
                    || target.closest('label')?.control;
                if (!control) { if (target.closest('#left')) this.select(null); return; }
                const name = control.getAttribute('name') || control.dataset.questionId || control.dataset.question || control.dataset.target || control.id || '';
                const order = this.active.meter.value.questionOrder;
                const question = order.find(q => q.replace(/^q/i, '') === name.replace(/^q/i, ''));
                const group = control.closest('[data-question-ids]');
                const members = (group?.dataset.questionIds || '').split(',').filter(Boolean);
                this.select(question || (members.length ? members[0] : null));
            };
            for (const type of ['pointerdown', 'focusin', 'input', 'change', 'drop']) document.addEventListener(type, select, true);
            global.addEventListener('blur', () => this.stop());
            global.addEventListener('focus', () => this.refresh());
            document.addEventListener('visibilitychange', () => document.hidden ? this.stop() : this.refresh());
            global.addEventListener('pagehide', () => this.stop());
            global.addEventListener('beforeunload', () => this.stop());
            document.addEventListener('freeze', () => this.stop());
            global.addEventListener('pageshow', async event => {
                if (event.persisted && this.active) {
                    const row = await global.AppData.recovery.getReadingTiming(this.active.meter.value.attemptId).catch(() => null);
                    if (!row || row.recordId || row.snapshot.writer !== this.writer) this.active.owned = false;
                }
                this.refresh();
            });
        }
        render() {
            const parent = document.getElementById('right');
            if (!parent) return;
            let panel = document.getElementById('reading-timing-status');
            if (!panel) {
                panel = document.createElement('details');
                panel.id = 'reading-timing-status';
                panel.style.cssText = 'margin:8px 12px;padding:8px 12px;border:1px solid #94a3b8;border-radius:8px;font-size:12px;line-height:1.6;';
                const title = document.createElement('summary');
                title.dataset.timingLabel = '';
                panel.appendChild(title);
                const help = document.createElement('p');
                help.textContent = timing.help;
                panel.appendChild(help);
                const status = document.createElement('p');
                status.dataset.timingSave = '';
                status.setAttribute('role', 'status');
                panel.appendChild(status);
                const clear = document.createElement('button');
                clear.type = 'button'; clear.textContent = '切换为未分配前台时长';
                clear.style.cssText = 'padding:4px 8px;border:1px solid #94a3b8;border-radius:4px;margin-right:8px;';
                clear.addEventListener('click', () => this.select(null));
                panel.appendChild(clear);
                const retry = document.createElement('button');
                retry.type = 'button'; retry.textContent = '重试计时保存';
                retry.style.cssText = 'padding:4px 8px;border:1px solid #94a3b8;border-radius:4px;';
                retry.addEventListener('click', () => this.save().catch(() => {}));
                panel.appendChild(retry);
                parent.prepend(panel);
            }
            const meter = this.active?.meter;
            const value = meter?.snapshot();
            const unit = value?.units.find(item => item.id === meter.active);
            const association = unit ? `${unit.kind === 'group' ? '题组' : '题目'} ${timing.label(unit)}` : '未分配前台时长';
            panel.querySelector('[data-timing-label]').textContent = !value ? '阅读前台关联时长：不可用'
                : `${meter.eligible ? `${association} · ${timing.format(unit?.durationMs ?? value.unallocatedMs)}`
                    : `计时停止 · 已测总时长 ${timing.format(value.totalMs)}`}${value.partialReasons.length ? ' · 部分计时' : ''}`;
            panel.querySelector('[data-timing-save]').textContent = this.error || (this.active?.savedAt
                ? `最近确认保存：${new Date(this.active.savedAt).toLocaleTimeString()}；已测总时长 ${timing.format(value.totalMs)}`
                : '等待练习初始化；尚无可靠计时数据。');
        }
    }
    global.ReadingTimingController = Controller;
})(typeof window !== 'undefined' ? window : globalThis);
