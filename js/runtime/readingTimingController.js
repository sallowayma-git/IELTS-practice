(function installReadingTimingController(global) {
    'use strict';
    const timing = global.ReadingTiming;
    if (!timing) return;
    const now = () => global.performance.now();
    const token = () => global.crypto?.randomUUID?.() || `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const clone = value => JSON.parse(JSON.stringify(value));
    const immutable = value => {
        Object.values(value).forEach(child => { if (child && typeof child === 'object') immutable(child); });
        return Object.freeze(value);
    };
    const failure = (code, message) => Object.assign(new Error(message), { code });
    const ACQUISITION_RETRY_BASE_MS = 1000;
    const ACQUISITION_RETRY_MAX_MS = 30000;
    const NON_RETRYABLE_ACQUISITION_ERRORS = new Set([
        'TIMING_FINALIZED',
        'TIMING_STALE_WRITER',
        'TIMING_STALE_REVISION',
        'VALIDATION'
    ]);

    function isRetryableAcquisitionError(error) {
        return !NON_RETRYABLE_ACQUISITION_ERRORS.has(String(error?.code || '').trim().toUpperCase());
    }

    class Controller {
        constructor(context) {
            this.context = context;
            this.writer = token();
            this.entries = new Map();
            this.loading = new Map();
            this.pauseRestorations = new Map();
            this.failedActivation = null;
            this.active = null;
            this.generation = 0;
            this.submission = null;
            this.error = '';
            this.retryTimer = null;
            this.retryAttempt = 0;
            this.retryKey = null;
            this.keyboardFocusAt = -Infinity;
            this.attach();
            this.interval = global.setInterval(() => {
                this.refresh();
                if (this.active && now() - this.active.savedClock >= 4500) this.save(this.active).catch(() => {});
            }, 1000);
        }
        key(ctx) { return JSON.stringify([ctx.parentAttemptId || ctx.sessionId, ctx.libraryConfigurationId, ctx.examId, ctx.sequenceIndex ?? null]); }
        attemptKey(ctx) { return JSON.stringify([ctx.parentAttemptId || ctx.sessionId, ctx.libraryConfigurationId]); }
        locked(ctx = this.context()) { return this.submission?.attemptKey === this.attemptKey(ctx); }
        releaseSubmission(owner) {
            if (this.submission?.owner !== owner) return false;
            this.submission = null;
            return true;
        }
        eligible() {
            const ctx = this.context();
            return Boolean(!this.locked(ctx) && ctx.editable && ctx.running && document.visibilityState === 'visible'
                && document.hasFocus() && this.active?.owned && this.active.key === this.key(ctx));
        }
        refresh() {
            if (this.locked()) return;
            this.active?.meter.eligibility(this.eligible(), now());
            if (this.active && !this.active.meter.value.frozen && this.active.meter.value.paused !== !this.context().running) {
                this.active.meter.value.paused = !this.context().running;
                this.active.meter.value.revision++;
            }
            this.render();
        }
        stop() {
            if (this.locked()) return;
            if (this.active) {
                this.active.meter.eligibility(false, now());
                this.save(this.active).catch(() => {});
            }
            this.render();
        }
        clearAcquisitionRetry(resetAttempt = true) {
            if (this.retryTimer !== null && typeof global.clearTimeout === 'function') {
                global.clearTimeout(this.retryTimer);
            }
            this.retryTimer = null;
            if (resetAttempt) this.retryAttempt = 0;
            this.retryKey = null;
        }
        scheduleAcquisitionRetry(key, draft) {
            if (this.retryTimer !== null || typeof global.setTimeout !== 'function') return;
            const context = this.context();
            if (!this.failedActivation || this.failedActivation.key !== key
                || this.key(context) !== key || !context.editable) return;
            const attempt = this.retryAttempt++;
            const delay = Math.min(ACQUISITION_RETRY_MAX_MS,
                ACQUISITION_RETRY_BASE_MS * (2 ** Math.min(attempt, 5)));
            this.retryKey = key;
            this.retryTimer = global.setTimeout(() => {
                this.retryTimer = null;
                const current = this.context();
                if (!this.failedActivation || this.failedActivation.key !== key
                    || this.key(current) !== key || !current.editable) {
                    if (this.failedActivation?.key === key) this.failedActivation = null;
                    this.retryAttempt = 0;
                    this.retryKey = null;
                    return;
                }
                return this.activate(draft, { automaticRetry: true });
            }, delay);
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
            if (this.failedActivation?.key === key) initial.partial('save-failed');
            const row = await global.AppData.recovery.acquireReadingTiming(initial.snapshot(), previous);
            const entry = { key, context: { ...ctx }, meter: new timing.Meter(ctx.dataset, identity, row.snapshot), owned: true,
                savedAt: Date.parse(row.updatedAt), savedClock: now(), acknowledged: row.snapshot, pending: null, saving: null };
            this.entries.set(key, entry);
            return entry;
        }
        async activate(draft = null, options = {}) {
            const ctx = this.context();
            if (this.locked(ctx)) return;
            if (!ctx.sessionId || !ctx.examId || !ctx.dataset || !ctx.editable
                || !Object.prototype.hasOwnProperty.call(ctx, 'libraryConfigurationId')
                || ctx.libraryConfigurationId === undefined) {
                this.generation++;
                this.clearAcquisitionRetry();
                this.failedActivation = null;
                this.stop();
                return;
            }
            const key = this.key(ctx);
            if (this.active?.key === key) { this.refresh(); return; }
            const preservingRetryBackoff = options.automaticRetry === true && this.retryKey === key;
            this.clearAcquisitionRetry(!preservingRetryBackoff);
            const attemptKey = JSON.stringify([ctx.parentAttemptId || ctx.sessionId, ctx.libraryConfigurationId]);
            if (!this.pauseRestorations.has(attemptKey)) {
                this.pauseRestorations.set(attemptKey, { timerRevision: ctx.timerInteractionRevision ?? 0, handled: false });
            }
            const restoration = this.pauseRestorations.get(attemptKey);
            if (this.failedActivation?.key !== key) this.failedActivation = null;
            this.stop();
            this.active = null;
            const generation = ++this.generation;
            try {
                const entry = await this.loadEntry(ctx, draft);
                const current = this.context();
                if (generation !== this.generation || this.key(current) !== key || !current.editable || this.locked(current)) return;
                this.active = entry;
                // Retain the first activation's timer revision through failures,
                // retries and repeated INITs. Later learner actions supersede the
                // saved pause; inactive children also follow the live suite state.
                if (!restoration.handled) {
                    restoration.handled = true;
                    if (entry.meter.value.paused && (current.timerInteractionRevision ?? 0) === restoration.timerRevision) {
                        ctx.restorePause?.();
                    }
                }
                this.failedActivation = null;
                this.clearAcquisitionRetry();
                this.error = '';
                this.refresh();
            } catch (error) {
                if (generation !== this.generation || this.key(this.context()) !== key || !this.context().editable) return;
                this.failedActivation = { key, draft };
                this.error = error.code === 'TIMING_FINALIZED' ? '该次计时已经提交' : `计时不可用：${error.message}`;
                if (isRetryableAcquisitionError(error)) this.scheduleAcquisitionRetry(key, draft);
                this.render();
            }
        }
        async retry() {
            const ctx = this.context();
            if (!ctx.editable || this.locked(ctx)) return;
            const key = this.key(ctx);
            if (this.active?.key === key) return this.save();
            if (this.failedActivation?.key === key) {
                const draft = this.failedActivation.draft;
                this.clearAcquisitionRetry();
                return this.activate(draft);
            }
        }
        snapshot(examId = null) {
            const entry = examId
                ? [...this.entries.values()].find(item => item.meter.value.examId === examId
                    && this.attemptKey(item.context) === this.attemptKey(this.context()))
                : (this.active?.key === this.key(this.context()) ? this.active : null);
            return entry ? entry.meter.snapshot(this.locked(entry.context) ? undefined : now()) : null;
        }
        async save(entry = this.active, submission = null) {
            if (entry && this.locked(entry.context) && this.submission !== submission) return entry.saving;
            if (!entry?.owned) return;
            const snapshot = entry.meter.snapshot(submission ? undefined : now());
            if (entry.acknowledged?.revision === snapshot.revision && !entry.pending) return;
            entry.pending = snapshot;
            if (entry.saving) return entry.saving;
            entry.saving = (async () => {
                while (entry.pending) {
                    const next = entry.pending;
                    entry.pending = null;
                    try {
                        const row = await global.AppData.recovery.saveReadingTiming(next);
                        entry.acknowledged = clone(row.snapshot);
                        entry.savedAt = Date.parse(row.updatedAt);
                        entry.savedClock = now();
                        if (entry === this.active && this.key(this.context()) === entry.key) this.error = '';
                    } catch (error) {
                        entry.meter.partial('save-failed');
                        if (['TIMING_STALE_WRITER', 'TIMING_FINALIZED'].includes(error.code)) {
                            entry.owned = false;
                            entry.meter.eligibility(false, now());
                        }
                        if (this.attemptKey(entry.context) === this.attemptKey(this.context())) {
                            this.error = entry.owned ? '计时保存失败，未保存的尾段可能丢失；可重试保存。' : '计时已由另一窗口接管或提交。';
                        }
                        throw error;
                    } finally { this.render(); }
                }
            })().finally(() => { entry.saving = null; });
            return entry.saving;
        }
        select(questionId) {
            if (!this.active?.owned || this.active.key !== this.key(this.context()) || !this.context().editable || this.locked()) return;
            // A fresh learner action after a failed submission explicitly resumes
            // answering. A retry without editing retains the same frozen snapshot.
            if (this.active.meter.value.frozen) this.active.meter.thaw(now());
            this.refresh();
            this.active.meter.select(questionId, now());
            this.save(this.active).catch(() => {});
            this.render();
        }
        async freezeAll(passages = [], owner = {}) {
            if (this.submission) throw failure('TIMING_SUBMISSION_PENDING', 'Reading submission already owns timing');
            const ctx = this.context();
            const required = passages.length ? passages : [{ context: ctx, draft: this.failedActivation?.draft }];
            const submission = { owner, attemptKey: this.attemptKey(ctx), key: this.key(ctx), entries: [] };
            this.submission = submission;
            this.generation++; // Pending activation may load an entry, but cannot make it editable.
            this.clearAcquisitionRetry();
            const assertCurrent = () => {
                if (this.submission !== submission || this.key(this.context()) !== submission.key
                    || (owner.isCurrent && !owner.isCurrent())) {
                    throw failure('TIMING_SUBMISSION_STALE', 'Reading submission ownership changed');
                }
            };
            try {
                const keys = new Set();
                for (const passage of required) {
                    const source = passage.context;
                    if (!source.sessionId || !source.examId || !source.dataset
                        || source.libraryConfigurationId === undefined
                        || this.attemptKey(source) !== submission.attemptKey || keys.has(this.key(source))) {
                        throw failure('VALIDATION', 'Invalid required Reading passage');
                    }
                    keys.add(this.key(source));
                }
                // Stop all already acquired children synchronously, before any await.
                for (const key of keys) {
                    const entry = this.entries.get(key);
                    if (entry) { entry.meter.freeze(now()); submission.entries.push(entry); }
                }
                for (const passage of required) {
                    assertCurrent();
                    const entry = await this.loadEntry(passage.context, passage.draft);
                    assertCurrent();
                    if (!entry.owned) throw failure('TIMING_STALE_WRITER', 'Reading timing ownership lost');
                    entry.meter.freeze(now());
                    if (!submission.entries.includes(entry)) submission.entries.push(entry);
                }
                // Drain every write before releasing a failed barrier. A slow sibling
                // save must never arrive after the learner is allowed to edit again.
                const results = await Promise.allSettled(submission.entries.map(entry => this.save(entry, submission)));
                assertCurrent();
                const rejected = results.find(result => result.status === 'rejected');
                if (rejected) throw rejected.reason;
                return immutable(required.map(passage => {
                    const entry = this.entries.get(this.key(passage.context));
                    const snapshot = entry.meter.snapshot();
                    if (!entry.owned || !snapshot.frozen || snapshot.writer !== this.writer
                        || !timing.sameSource(snapshot, entry.context)
                        || JSON.stringify(snapshot) !== JSON.stringify(entry.acknowledged)) {
                        throw failure('TIMING_STALE_WRITER', 'Frozen Reading timing was not acknowledged');
                    }
                    return { key: entry.key, snapshot: clone(entry.acknowledged) };
                }));
            } catch (error) {
                await Promise.allSettled(submission.entries.map(entry => entry.saving));
                this.releaseSubmission(owner);
                throw error;
            }
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
                    || target.closest('.drag-item,.draggable-word,.card')
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
                    const entry = this.active;
                    const generation = this.generation;
                    const row = await global.AppData.recovery.getReadingTiming(entry.meter.value.attemptId).catch(() => null);
                    if (generation !== this.generation || entry !== this.active || this.key(this.context()) !== entry.key) return;
                    if (!row || row.recordId || row.snapshot.writer !== this.writer) entry.owned = false;
                }
                this.refresh();
            });
        }
        render() {
            // Timing remains a persistence concern, but the practice window no longer
            // renders an auxiliary status panel or developer-facing explanation.
        }
    }
    global.ReadingTimingController = Controller;
})(typeof window !== 'undefined' ? window : globalThis);
