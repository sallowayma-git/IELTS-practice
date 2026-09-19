(function installReadingTiming(global) {
    'use strict';
    const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const text = value => typeof value === 'string' && value.trim().length > 0;
    const sameSource = (a, b) => a?.examId === b?.examId
        && Object.prototype.hasOwnProperty.call(a || {}, 'libraryConfigurationId')
        && Object.prototype.hasOwnProperty.call(b || {}, 'libraryConfigurationId')
        && a.libraryConfigurationId === b.libraryConfigurationId;

    function normalize(value) {
        if (!value || value.version !== 1 || value.measurement !== 'foreground-selection'
            || !text(value.attemptId) || !text(value.examId) || !text(value.writer)
            || !(value.libraryConfigurationId === null || text(value.libraryConfigurationId))
            || !integer(value.revision) || !integer(value.unallocatedMs) || !integer(value.totalMs)
            || (value.paused !== undefined && typeof value.paused !== 'boolean')
            || (value.parentAttemptId != null && !text(value.parentAttemptId))
            || (value.sequenceIndex != null && !integer(value.sequenceIndex))
            || typeof value.frozen !== 'boolean' || !Array.isArray(value.units)
            || !Array.isArray(value.questionOrder) || !Array.isArray(value.unsupportedQuestionIds)
            || !Array.isArray(value.partialReasons) || !value.partialReasons.every(text)) return null;
        const order = new Set(value.questionOrder);
        if (!order.size || order.size !== value.questionOrder.length || !value.questionOrder.every(text)) return null;
        const seen = new Set();
        const ids = new Set();
        let total = value.unallocatedMs;
        for (const unit of value.units) {
            if (!unit || !text(unit.id) || ids.has(unit.id) || !integer(unit.durationMs)
                || !Array.isArray(unit.questionIds) || !unit.questionIds.length
                || unit.kind !== (unit.questionIds.length === 1 ? 'question' : 'group')) return null;
            ids.add(unit.id);
            for (const q of unit.questionIds) {
                if (!order.has(q) || seen.has(q)) return null;
                seen.add(q);
            }
            total += unit.durationMs;
        }
        for (const q of value.unsupportedQuestionIds) {
            if (!order.has(q) || seen.has(q)) return null;
            seen.add(q);
        }
        if (seen.size !== order.size || !integer(total) || total !== value.totalMs
            || (value.unsupportedQuestionIds.length && !value.partialReasons.includes('unsupported-mapping'))) return null;
        return clone(value);
    }

    function mapping(dataset) {
        const raw = Array.isArray(dataset?.questionOrder) ? dataset.questionOrder : [];
        const order = [...new Set(raw.filter(text))];
        const parent = new Map(order.map(q => [q, q]));
        const unsupported = new Set(order.filter(q => raw.filter(v => v === q).length !== 1));
        const root = q => parent.get(q) === q ? q : root(parent.get(q));
        for (const group of Array.isArray(dataset?.questionGroups) ? dataset.questionGroups : []) {
            const members = Array.isArray(group?.questionIds) ? group.questionIds : [];
            if (!members.length) continue;
            const known = members.filter(q => parent.has(q));
            if (known.length !== members.length || new Set(members).size !== members.length) {
                known.forEach(q => unsupported.add(q));
                continue;
            }
            known.slice(1).forEach(q => parent.set(root(q), root(known[0])));
        }
        // An ambiguous member makes its entire overlapping authored group unsupported.
        const badRoots = new Set([...unsupported].map(root));
        const groups = new Map();
        for (const q of order) {
            if (badRoots.has(root(q))) { unsupported.add(q); continue; }
            if (!groups.has(root(q))) groups.set(root(q), []);
            groups.get(root(q)).push(q);
        }
        return {
            questionOrder: order,
            unsupportedQuestionIds: order.filter(q => unsupported.has(q)),
            units: [...groups.values()].map(questionIds => ({
                id: `unit:${JSON.stringify(questionIds)}`, questionIds,
                kind: questionIds.length > 1 ? 'group' : 'question', durationMs: 0
            }))
        };
    }

    class Meter {
        constructor(dataset, identity, saved = null) {
            const previous = normalize(saved);
            if (saved && (!previous || !sameSource(previous, identity) || previous.attemptId !== identity.attemptId
                || (previous.parentAttemptId ?? null) !== (identity.parentAttemptId ?? null)
                || (previous.sequenceIndex ?? null) !== (identity.sequenceIndex ?? null))) {
                throw new Error('Invalid Reading timing identity or snapshot');
            }
            this.value = previous || {
                version: 1, measurement: 'foreground-selection', ...clone(identity),
                ...mapping(dataset), revision: 0, unallocatedMs: 0, totalMs: 0,
                frozen: false, partialReasons: []
            };
            this.value.writer = identity.writer;
            this.eligible = false;
            this.active = null;
            this.anchor = null;
            if (this.value.unsupportedQuestionIds.length) this.partial('unsupported-mapping');
        }
        partial(reason) {
            if (!this.value.partialReasons.includes(reason)) {
                this.value.partialReasons.push(reason);
                this.value.revision++;
            }
        }
        tick(now) {
            if (!Number.isFinite(now)) { this.partial('invalid-clock'); this.anchor = null; this.active = null; return; }
            if (this.anchor !== null) {
                const delta = now - this.anchor;
                if (delta < 0 || delta > 5000) {
                    if (this.eligible) this.partial(delta < 0 ? 'invalid-clock' : 'unobserved-gap');
                    this.active = null;
                } else if (this.eligible && !this.value.frozen && delta > 0) {
                    const unit = this.value.units.find(item => item.id === this.active);
                    if (unit) unit.durationMs += delta;
                    else this.value.unallocatedMs += delta;
                    this.value.revision++;
                }
            }
            this.anchor = now;
        }
        eligibility(enabled, now) {
            this.tick(now);
            const next = Boolean(enabled && !this.value.frozen);
            if (next !== this.eligible || !next) this.active = null;
            this.eligible = next;
        }
        select(questionId, now) {
            this.tick(now);
            if (!this.eligible || this.value.frozen) return;
            this.active = this.value.units.find(unit => unit.questionIds.includes(questionId))?.id || null;
        }
        freeze(now) {
            this.eligibility(false, now);
            if (!this.value.frozen) { this.value.frozen = true; this.value.revision++; }
        }
        thaw(now) {
            this.anchor = now;
            this.active = null;
            if (this.value.frozen) { this.value.frozen = false; this.value.revision++; }
        }
        snapshot(now) {
            if (now !== undefined) this.tick(now);
            const value = clone(this.value);
            value.unallocatedMs = Math.floor(value.unallocatedMs);
            value.units.forEach(unit => { unit.durationMs = Math.floor(unit.durationMs); });
            value.totalMs = value.unallocatedMs + value.units.reduce((sum, unit) => sum + unit.durationMs, 0);
            return value;
        }
    }

    function extract(record) {
        for (const source of [record, record?.realData, record?.rawData]) {
            if (source && Object.prototype.hasOwnProperty.call(source, 'readingTiming')) {
                const value = normalize(source.readingTiming);
                if (!value || (record.examId && record.examId !== value.examId)
                    || (Object.prototype.hasOwnProperty.call(record.metadata || {}, 'libraryConfigurationId')
                        && record.metadata.libraryConfigurationId !== value.libraryConfigurationId)) return null;
                return value;
            }
        }
        return null;
    }

    function summary(value) {
        const timing = normalize(value);
        if (!timing) return null;
        const { version, measurement, attemptId, examId, libraryConfigurationId, parentAttemptId,
            sequenceIndex, revision, totalMs, unallocatedMs, partialReasons } = timing;
        return { version, measurement, attemptId, examId, libraryConfigurationId, parentAttemptId,
            sequenceIndex, revision, totalMs, unallocatedMs, attributedMs: totalMs - unallocatedMs,
            coverage: partialReasons.length ? 'partial' : 'complete', partialReasons };
    }

    function aggregate(entries) {
        const unique = new Map();
        const conflicted = new Set();
        const fingerprint = value => JSON.stringify([value.writer, value.revision, value.parentAttemptId,
            value.sequenceIndex, value.frozen, value.paused, value.totalMs, value.unallocatedMs,
            value.questionOrder, value.unsupportedQuestionIds, value.partialReasons,
            value.units.map(unit => [unit.id, unit.kind, unit.questionIds, unit.durationMs])]);
        let unavailable = 0;
        for (const entry of entries || []) {
            const value = extract(entry);
            if (!value) { unavailable++; continue; }
            const key = JSON.stringify([value.libraryConfigurationId, value.examId, value.attemptId]);
            if (conflicted.has(key)) continue;
            const previous = unique.get(key);
            if (previous && previous.revision === value.revision && fingerprint(previous) !== fingerprint(value)) {
                unique.delete(key);
                conflicted.add(key);
                continue;
            }
            if (!previous || value.revision > previous.revision) unique.set(key, value);
        }
        unavailable += conflicted.size;
        const values = [...unique.values()];
        return { totalMs: values.reduce((n, value) => n + value.totalMs, 0),
            unallocatedMs: values.reduce((n, value) => n + value.unallocatedMs, 0),
            measuredChildren: values.length, unavailable,
            partial: unavailable > 0 || values.some(value => value.partialReasons.length > 0) };
    }

    function format(ms) {
        if (!integer(ms)) return '不可用';
        if (ms > 0 && ms < 1000) return '不足 1 秒';
        const seconds = Math.floor(ms / 1000);
        return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
    }
    const help = '仅累计阅读页可见、窗口有焦点且练习运行时的前台时长。题目选择只表示时间关联，不代表注意力或思考时间；无操作时仍可能累计。操作文章或通用笔记会取消关联。后台、失焦、暂停、复盘及关闭页面的时间不计入。多题共用题组不拆分。每 5 秒及状态切换时请求保存，恢复可能丢失未保存尾段，超过 5 秒的未观测间隔会被舍弃。显示取整，合计使用原始毫秒。';
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const label = unit => unit.questionIds.map(q => /^q/i.test(q) ? q.toUpperCase() : `Q${q}`).join('、');
    function render(record) {
        const suite = Array.isArray(record?.suiteEntries) && record.suiteEntries.length;
        if (suite) {
            const total = aggregate(record.suiteEntries);
            const totals = total.measuredChildren
                ? `已测总时长 ${format(total.totalMs)}；已关联 ${format(total.totalMs - total.unallocatedMs)}；未分配 ${format(total.unallocatedMs)}`
                : '总时长不可用：无可靠计时数据';
            return `<section class="reading-timing-record"><h4>阅读前台关联时长</h4><p>已计时篇章 ${total.measuredChildren}；不可用 ${total.unavailable}${total.partial ? ' · 部分计时' : ''}。${totals}。</p><p>${help}</p>${record.suiteEntries.map(entry => `<details><summary>${escape(entry.title || entry.examId || '篇章')}</summary>${render(entry)}</details>`).join('')}</section>`;
        }
        const value = extract(record);
        if (!value) return '<section class="reading-timing-record"><h4>阅读前台关联时长</h4><p>不可用：无可靠计时数据。不会从整场用时估算分题时间。</p></section>';
        return `<section class="reading-timing-record"><h4>阅读前台关联时长${value.partialReasons.length ? ' · 部分计时' : ''}</h4><p>${help}</p>${value.partialReasons.length ? '<p>仅展示已恢复或已观测的累计时间，未覆盖的时段不可用。</p>' : ''}<p>已测总时长：${format(value.totalMs)}；已关联：${format(value.totalMs - value.unallocatedMs)}；未分配前台时长：${format(value.unallocatedMs)}</p><table class="answer-table"><thead><tr><th>计时单位</th><th>关联前台时长</th></tr></thead><tbody>${value.units.map(unit => `<tr><td>${unit.kind === 'group' ? '题组' : '题目'} ${escape(label(unit))}${unit.kind === 'group' ? `<small>（${unit.questionIds.map(q => `${escape(q)} 计入本题组`).join('；')}）</small>` : ''}</td><td>${format(unit.durationMs)}</td></tr>`).join('')}${value.unsupportedQuestionIds.map(q => `<tr><td>${escape(q)}</td><td>不可用：无法可靠关联</td></tr>`).join('')}</tbody></table></section>`;
    }

    global.ReadingTiming = Object.freeze({ normalize, mapping, Meter, extract, summary, aggregate, sameSource, format, help, label });
    global.ReadingTimingView = Object.freeze({ render });
})(typeof window !== 'undefined' ? window : globalThis);
