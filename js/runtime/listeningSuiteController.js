(function (global) {
    'use strict';

    const controlSelector = 'input:not([type="button"]):not([type="submit"]):not([type="file"]), textarea, select';
    const slotSelector = '.match-slot, .flow-slot, .map-slot, .drop-zone, .dropzone';
    const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

    function capturePage(frame) {
        const doc = frame.contentDocument;
        return {
            controls: Array.from(doc.querySelectorAll(controlSelector), (el) => ({
                id: el.id, name: el.name || '', value: el.value, checked: el.checked === true
            })),
            slots: Array.from(doc.querySelectorAll(slotSelector), (el) => ({
                tags: Array.from(el.querySelectorAll('.tag, .token'), (tag) => ({
                    text: tag.textContent, className: tag.classList.contains('tag') ? 'tag' : 'token',
                    data: { ...tag.dataset }
                }))
            })),
            audio: Array.from(doc.querySelectorAll('audio, video'), (el) => ({
                time: Number(el.currentTime) || 0, rate: Number(el.playbackRate) || 1
            })),
            scroll: Array.from(doc.querySelectorAll('.shell, .main-content, .questions-container'), (el) => el.scrollTop)
        };
    }

    function restorePage(frame, saved) {
        if (!saved) return;
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        const controls = Array.from(doc.querySelectorAll(controlSelector));
        (saved.controls || []).forEach((value, index) => {
            const el = controls[index];
            if (!el || el.id !== value.id || (el.name || '') !== value.name) return;
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = value.checked === true;
            else el.value = String(value.value == null ? '' : value.value);
            el.dispatchEvent(new win.Event('input', { bubbles: true }));
            el.dispatchEvent(new win.Event('change', { bubbles: true }));
        });
        const slots = Array.from(doc.querySelectorAll(slotSelector));
        (saved.slots || []).forEach((value, index) => {
            const el = slots[index];
            if (!el) return;
            el.querySelectorAll('.tag, .token').forEach((tag) => tag.remove());
            (value.tags || []).forEach((savedTag) => {
                const tag = doc.createElement('span');
                tag.className = savedTag.className === 'token' ? 'token' : 'tag';
                tag.textContent = String(savedTag.text || '');
                Object.entries(savedTag.data || {}).forEach(([key, val]) => {
                    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) tag.dataset[key] = String(val);
                });
                el.appendChild(tag);
            });
        });
        Array.from(doc.querySelectorAll('audio, video')).forEach((el, index) => {
            const value = (saved.audio || [])[index];
            if (!value) return;
            const restoreAudio = () => {
                if (Number.isFinite(value.time) && value.time >= 0) el.currentTime = value.time;
                if (Number.isFinite(value.rate) && value.rate >= .25 && value.rate <= 4) el.playbackRate = value.rate;
            };
            if (el.readyState > 0) restoreAudio();
            else el.addEventListener('loadedmetadata', restoreAudio, { once: true });
        });
        Array.from(doc.querySelectorAll('.shell, .main-content, .questions-container')).forEach((el, index) => {
            el.scrollTop = Number((saved.scroll || [])[index]) || 0;
        });
    }

    function create(api) {
        const state = api.state;
        const slots = new Map();
        let initPayload = null;
        let sequence = [];
        let mode = '';
        let toolbar = null;
        let notice = '';
        let reviewContext = null;
        let pendingReplay = null;
        let expiredLock = false;
        let pendingSubmission = null;
        let finished = false;
        let draftInterval = null;
        let draftTimestamp = 0;
        const completionPayloads = new Map();
        const retries = [];
        const activeSlot = () => slots.get(state.examId);
        const simulation = () => mode === 'simulation';
        const recoveryKey = () => 'listening-suite-recovery:' + state.suiteSessionId;

        function restoreRecovery(payload) {
            const restored = clone(payload);
            try {
                const saved = JSON.parse(global.sessionStorage.getItem(recoveryKey()));
                const examIds = payload.suiteSequence.map((entry) => entry.examId);
                if (!saved || saved.version !== 1 || saved.suiteSessionId !== payload.suiteSessionId
                    || JSON.stringify(saved.examIds) !== JSON.stringify(examIds)) return restored;
                const drafts = restored.suiteDraftsByExam || {};
                const hostUpdatedAt = Math.max(0, ...Object.values(drafts).map((draft) => Number(draft?.updatedAt) || 0));
                for (const examId of examIds) {
                    const draft = saved.draftsByExam?.[examId];
                    if (Number(draft?.updatedAt) > (Number(drafts[examId]?.updatedAt) || 0)) drafts[examId] = draft;
                }
                restored.suiteDraftsByExam = drafts;
                if (Number(saved.updatedAt) >= hostUpdatedAt) {
                    Object.assign(restored, saved.timer);
                    restored.suiteElapsedByExam = saved.elapsedByExam;
                    if (payload.suiteFlowMode === 'simulation' && examIds.includes(saved.activeExamId)) {
                        restored.suiteActiveExamId = saved.activeExamId;
                    }
                }
            } catch (_) { /* The host recovery path still works when browser storage is unavailable. */ }
            return restored;
        }

        function saveRecovery() {
            const draftsByExam = { ...initPayload.suiteDraftsByExam };
            const elapsedByExam = { ...initPayload.suiteElapsedByExam };
            slots.forEach((slot, examId) => {
                if (slot.draft) draftsByExam[examId] = slot.draft;
                elapsedByExam[examId] = slot.elapsed + (slot === activeSlot()
                    ? Math.max(0, api.elapsedSeconds() - slot.activatedAt) : 0);
            });
            try {
                global.sessionStorage.setItem(recoveryKey(), JSON.stringify({
                    version: 1, suiteSessionId: state.suiteSessionId,
                    examIds: sequence.map((entry) => entry.examId), activeExamId: state.examId,
                    draftsByExam, elapsedByExam, timer: timerPayload(), updatedAt: draftTimestamp
                }));
            } catch (_) { /* Keep forwarding drafts even if the local recovery cache cannot be written. */ }
        }

        function clearRecovery() {
            try { global.sessionStorage.removeItem(recoveryKey()); } catch (_) {}
        }

        function post(type, data) {
            api.forwardToParent({ type, source: 'listening_record_bridge', data: {
                ...data, examId: data.examId || state.examId, sessionId: state.sessionId,
                suiteSessionId: state.suiteSessionId, windowSessionToken: state.windowSessionToken
            } });
        }

        function timerPayload() {
            return {
                globalTimerAnchorMs: state.startTime, suiteTimerAnchorMs: state.startTime,
                suiteTimerMode: state.suiteTimerPreferences.mode,
                suiteTimerLimitSeconds: initPayload.suiteTimerLimitSeconds,
                suiteTimerPausedOffsetMs: state.pausedOffsetMs, suiteTimerPausedAtMs: state.pausedAtMs,
                suiteTimerRunning: state.running,
                timerSnapshot: { anchorMs: state.startTime, pausedOffsetMs: state.pausedOffsetMs,
                    pausedAtMs: state.pausedAtMs, running: state.running }
            };
        }

        function pauseMedia(slot) {
            slot?.frame.contentDocument?.querySelectorAll('audio, video').forEach((el) => el.pause());
        }

        function draftFor(slot) {
            const snapshot = slot.frame.contentWindow.__listeningBridgeSnapshot?.();
            draftTimestamp = Math.max(Date.now(), draftTimestamp + 1);
            return {
                answers: snapshot?.answers || {}, listeningState: capturePage(slot.frame),
                updatedAt: draftTimestamp
            };
        }

        function syncDraft() {
            const slot = activeSlot();
            if (!slot?.ready || finished || pendingSubmission || slot.submitted || reviewContext?.readOnly) return;
            const draft = draftFor(slot);
            slot.draft = draft;
            // sessionStorage survives reload synchronously; postMessage delivery can race INIT.
            saveRecovery();
            post('SIMULATION_DRAFT_SYNC', { draft, draftUpdatedAt: draft.updatedAt,
                elapsed: api.elapsedSeconds(), ...timerPayload() });
        }

        function sendInit(slot) {
            slot.frame.contentWindow.postMessage({ type: 'INIT_SESSION', source: 'exam_host', data: {
                ...initPayload, examId: slot.entry.examId, parentOrigin: global.location.origin
            } }, global.location.origin);
        }

        function showNotice(message) {
            notice = message;
            renderToolbar();
        }

        function renderToolbar() {
            if (!initPayload) return;
            if (!toolbar) {
                toolbar = global.document.createElement('nav');
                toolbar.className = 'listening-suite-toolbar';
                toolbar.setAttribute('aria-label', 'Listening suite');
                api.getRoot().prepend(toolbar);
            }
            toolbar.replaceChildren();
            sequence.forEach((entry, index) => {
                const button = global.document.createElement('button');
                button.type = 'button';
                button.textContent = 'Part ' + (index + 1);
                button.dataset.suitePart = String(index + 1);
                button.title = entry.title || entry.examId;
                if (entry.examId === state.examId) button.setAttribute('aria-current', 'step');
                button.disabled = !simulation() || finished || Boolean(pendingSubmission);
                button.addEventListener('click', () => activate(entry.examId));
                toolbar.appendChild(button);
            });
            if (mode === 'stationary') {
                ['prev', 'next'].forEach((direction) => {
                    const button = global.document.createElement('button');
                    button.type = 'button';
                    button.dataset.suiteNavigate = direction;
                    button.textContent = direction === 'prev' ? 'Previous' : (reviewContext?.finalizeOnNext ? 'Finish suite' : 'Next');
                    button.disabled = finished || !(direction === 'prev' ? reviewContext?.canPrev : reviewContext?.canNext);
                    button.addEventListener('click', () => {
                        syncDraft();
                        pauseMedia(activeSlot());
                        post('REVIEW_NAVIGATE', { direction, ...timerPayload() });
                    });
                    toolbar.appendChild(button);
                });
            }
            if (simulation()) {
                const submit = global.document.createElement('button');
                submit.type = 'button';
                submit.dataset.suiteSubmit = 'true';
                submit.textContent = pendingSubmission ? 'Retry submit' : 'Submit suite';
                submit.disabled = finished;
                submit.addEventListener('click', () => submitSuite());
                toolbar.appendChild(submit);
            }
            const label = global.document.createElement('span');
            label.className = 'listening-suite-message';
            label.setAttribute('role', 'status');
            label.textContent = notice || ({ simulation: '模拟模式 · 四个 Part 统一提交', classic: '经典模式 · 提交后自动进入下一 Part', stationary: '驻足模式 · 提交后回看，再进入下一 Part' })[mode];
            toolbar.appendChild(label);
        }

        function activate(examId) {
            const next = slots.get(examId);
            if (!next || pendingSubmission || finished || !simulation()) return;
            const current = activeSlot();
            if (current === next) return;
            if (current && current !== next) {
                syncDraft();
                current.elapsed += Math.max(0, api.elapsedSeconds() - current.activatedAt);
                pauseMedia(current);
                current.frame.hidden = true;
            }
            state.examId = examId;
            state.activeFrame = next.frame;
            next.activatedAt = api.elapsedSeconds();
            next.frame.hidden = false;
            if (next.ready) api.adaptFrameUi();
            api.setStatus(next.ready ? '' : 'Loading listening part...', next.ready);
            post('SIMULATION_ACTIVE_EXAM_CHANGE', { examId, elapsed: api.elapsedSeconds() });
            renderToolbar();
            syncDraft();
        }

        function bindFrame(slot) {
            if (slot.bound || !slot.ready) return;
            slot.bound = true;
            const doc = slot.frame.contentDocument;
            doc.body.classList.add('listening-suite-ui');
            if (slot.draft?.listeningState) restorePage(slot.frame, slot.draft.listeningState);
            else {
                // A new suite must not inherit the native page's saved single-attempt answers.
                doc.querySelectorAll(controlSelector).forEach((el) => {
                    if (/^q\d|answer|question/i.test(el.name || el.id || '')) {
                        if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
                        else el.value = '';
                        el.dispatchEvent(new slot.frame.contentWindow.Event('input', { bubbles: true }));
                        el.dispatchEvent(new slot.frame.contentWindow.Event('change', { bubbles: true }));
                    }
                });
                doc.querySelectorAll(slotSelector).forEach((el) => el.querySelectorAll('.tag, .token').forEach((tag) => tag.remove()));
            }
            if (expiredLock) api.setLocked(doc, true);
            ['input', 'change'].forEach((type) => doc.addEventListener(type, () => {
                if (slot === activeSlot()) syncDraft();
            }));
            doc.addEventListener('click', (event) => {
                const finish = slot.frame.contentWindow.__listeningBridgeFindFinishControl?.(event.target);
                if (finish && simulation()) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    submitSuite();
                }
            }, true);
            doc.addEventListener('submit', (event) => {
                if (!simulation()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                submitSuite();
            }, true);
            doc.addEventListener('play', (event) => {
                if (slot !== activeSlot() || finished || pendingSubmission) event.target.pause?.();
            }, true);
            if (slot !== activeSlot()) pauseMedia(slot);
            if (slot === activeSlot() && pendingReplay) showReplay(pendingReplay);
        }

        function initialize(payload) {
            if (!payload.suiteSessionId || !Array.isArray(payload.suiteSequence) || !payload.suiteSequence.length) return false;
            if (initPayload) {
                // Repeated INIT is a handshake retry, never a draft rollback.
                initPayload = { ...initPayload, windowSessionToken: payload.windowSessionToken, sessionId: payload.sessionId };
                slots.forEach(sendInit);
                return true;
            }
            payload = restoreRecovery(payload);
            initPayload = clone(payload);
            draftTimestamp = Math.max(0, ...Object.values(payload.suiteDraftsByExam || {})
                .map((draft) => Number(draft?.updatedAt) || 0));
            mode = payload.suiteFlowMode || 'classic';
            sequence = payload.suiteSequence;
            state.suiteTimerPreferences = payload.suiteTimerPreferences || api.readTimerPreferences();
            state.startTime = Number(payload.suiteTimerAnchorMs || payload.globalTimerAnchorMs) || state.startTime;
            state.pausedOffsetMs = Math.max(0, Number(payload.suiteTimerPausedOffsetMs) || 0);
            state.pausedAtMs = payload.suiteTimerPausedAtMs == null ? null : Number(payload.suiteTimerPausedAtMs);
            state.running = payload.suiteTimerRunning !== false;
            const initialFrame = api.getFrame();
            for (const entry of sequence) {
                const isCurrent = entry.examId === state.examId;
                if (!simulation() && !isCurrent) continue;
                let source;
                try { source = new URL(entry.sourceUrl, global.location.href); } catch (_) { continue; }
                if (source.origin !== global.location.origin || !/^https?:$/.test(source.protocol)) continue;
                const frame = isCurrent ? initialFrame : global.document.createElement('iframe');
                frame.classList.add('listening-suite-frame');
                const slot = { entry, frame, ready: false, bound: false, draft: payload.suiteDraftsByExam?.[entry.examId] || null,
                    elapsed: Number(payload.suiteElapsedByExam?.[entry.examId]) || 0, activatedAt: api.elapsedSeconds() };
                slots.set(entry.examId, slot);
                if (!isCurrent) {
                    frame.hidden = true;
                    frame.title = entry.title || entry.category || 'Listening part';
                    frame.addEventListener('load', () => api.injectBridge(undefined, frame));
                    source.searchParams.set('examId', entry.examId);
                    frame.src = source.href;
                    api.getRoot().appendChild(frame);
                } else {
                    state.activeFrame = frame;
                    sendInit(slot);
                }
            }
            renderToolbar();
            if (simulation() && payload.suiteActiveExamId && slots.has(payload.suiteActiveExamId)) activate(payload.suiteActiveExamId);
            draftInterval = global.setInterval(syncDraft, 1200);
            global.addEventListener('pagehide', () => {
                if (!activeSlot()?.submitted && !pendingSubmission && !finished) {
                    // Saving a recovery draft preserves the user's running/paused choice.
                    syncDraft();
                }
                slots.forEach(pauseMedia);
                global.clearInterval(draftInterval);
                retries.forEach(global.clearTimeout);
            });
            return true;
        }

        function submitSuite() {
            if (finished) return;
            if (pendingSubmission) {
                post('SIMULATION_SUBMIT', pendingSubmission);
                showNotice('正在保存整套听力结果…');
                return;
            }
            const entries = [];
            for (const entry of sequence) {
                const slot = slots.get(entry.examId);
                const snapshot = slot?.ready && slot.frame.contentWindow.__listeningBridgeSnapshot?.();
                if (!snapshot?.scoreInfo?.total) {
                    showNotice('Part 尚未加载完成或答案不可用，请等待后重试。');
                    return;
                }
                const draft = draftFor(slot);
                const duration = slot.elapsed + (slot === activeSlot() ? Math.max(0, api.elapsedSeconds() - slot.activatedAt) : 0);
                entries.push({ ...snapshot, examId: entry.examId, duration, draft, ...draft });
            }
            syncDraft();
            api.updateClockPause(false);
            slots.forEach((slot) => { pauseMedia(slot); api.setLocked(slot.frame.contentDocument, true); });
            const submissionKey = global.crypto?.randomUUID?.()
                || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
            pendingSubmission = clone({
                suiteSubmission: true, submissionId: 'listening-suite-' + submissionKey,
                suiteEntries: entries, duration: api.elapsedSeconds(), type: 'listening', practiceType: 'listening',
                ...timerPayload()
            });
            post('SIMULATION_SUBMIT', pendingSubmission);
            showNotice('正在保存整套听力结果…');
            [1200, 3000, 6000].forEach((delay) => retries.push(global.setTimeout(() => {
                if (pendingSubmission && !finished) post('SIMULATION_SUBMIT', pendingSubmission);
            }, delay)));
        }

        function showReplay(payload) {
            // INIT restores an unfinished attempt once. Later host handshakes must
            // not overwrite answers entered since the frame became interactive.
            if (payload.readOnly === false) return;
            const slot = activeSlot();
            if (!slot?.ready) { pendingReplay = payload; return; }
            if (!payload.entry) return;
            pendingReplay = null;
            const entry = payload.entry;
            restorePage(slot.frame, slot.draft?.listeningState || entry.listeningState || entry.rawData?.draft?.listeningState);
            const doc = slot.frame.contentDocument;
            if (payload.readOnly !== false) {
                api.setLocked(doc, true);
                let report = doc.getElementById('listening-suite-review');
                if (report) report.remove();
                report = doc.createElement('section');
                report.id = 'listening-suite-review';
                report.style.cssText = 'padding:16px;overflow:auto;max-height:35vh;background:#fff;color:#0f172a;';
                const heading = doc.createElement('h3');
                heading.textContent = 'Part result';
                report.appendChild(heading);
                const table = doc.createElement('table');
                Object.entries(entry.answerComparison || {}).forEach(([questionId, result]) => {
                    const row = table.insertRow();
                    [questionId, result.userAnswer || '—', result.correctAnswer || '—', result.isCorrect ? '✓' : '✗'].forEach((value) => {
                        const cell = row.insertCell();
                        cell.textContent = String(value);
                        cell.style.padding = '4px 12px';
                    });
                });
                report.appendChild(table);
                (doc.querySelector('.shell') || doc.body).prepend(report);
            }
        }

        return {
            handleHostMessage(message) {
                const payload = message.data || message;
                if (message.type === 'INIT_SESSION' || message.type === 'init_exam_session') return initialize(payload);
                if (!initPayload) return false;
                if (message.type === 'SIMULATION_CONTEXT') return true; // INIT owns all four frames and their drafts.
                if (message.type === 'REPLAY_PRACTICE_RECORD') { showReplay(payload); return true; }
                if (message.type === 'REVIEW_CONTEXT') {
                    reviewContext = payload;
                    if (payload.readOnly && activeSlot()) {
                        activeSlot().submitted = true;
                        api.setLocked(activeSlot().frame.contentDocument, true);
                        activeSlot().frame.contentDocument.querySelectorAll('#clear-btn, #finish-btn').forEach((button) => { button.disabled = true; });
                    }
                    renderToolbar();
                    return true;
                }
                if (message.type === 'PRACTICE_SUBMIT_ACK' || message.type === 'PRACTICE_SUBMIT_FAILED') {
                    if (pendingSubmission && payload.submissionId === pendingSubmission.submissionId) {
                        if (message.type === 'PRACTICE_SUBMIT_ACK') {
                            finished = true;
                            clearRecovery();
                            retries.forEach(global.clearTimeout);
                            showNotice('整套听力已保存。');
                            global.close();
                        } else showNotice('保存失败，进度已保留。请点击 Retry submit 重试。');
                        return true;
                    }
                    if (message.type === 'PRACTICE_SUBMIT_ACK' && mode === 'classic'
                        && state.examId === sequence[sequence.length - 1].examId) {
                        clearRecovery();
                        global.close();
                    }
                }
                if (message.type === 'SUITE_FORCE_CLOSE') { finished = true; clearRecovery(); global.close(); return true; }
                return false;
            },
            handleFrameMessage(event) {
                if (!initPayload) return false;
                const slot = Array.from(slots.values()).find((item) => item.frame.contentWindow === event.source);
                if (!slot) return false;
                if (event.origin !== global.location.origin) return true;
                const message = event.data;
                const payload = message.data || {};
                if (message.type === 'REQUEST_INIT' || (message.type === 'SESSION_READY' && payload.initialized !== true)) {
                    sendInit(slot);
                    return true;
                }
                if (payload.windowSessionToken !== state.windowSessionToken || payload.examId !== slot.entry.examId) return true;
                if (message.type === 'SESSION_READY') {
                    slot.ready = true;
                    bindFrame(slot);
                    if (slot === activeSlot()) {
                        api.adaptFrameUi();
                        api.setStatus('', true);
                        api.forwardToParent(message);
                    }
                    return true;
                }
                if (message.type === 'PRACTICE_COMPLETE') {
                    if (simulation() || reviewContext?.readOnly) return true;
                    let completion = completionPayloads.get(payload.submissionId);
                    if (!completion) {
                        const draft = draftFor(slot);
                        completion = clone({ ...payload, draft, duration: api.elapsedSeconds(), ...timerPayload() });
                        delete completion.suiteId; // Sequential suite identity is distinct from legacy page-local suites.
                        completionPayloads.set(payload.submissionId, completion);
                        slot.submitted = true;
                        slot.draft = draft;
                    }
                    post(message.type, completion);
                    return true;
                }
                if (slot !== activeSlot()) return true;
                return false;
            },
            syncDraft,
            submitSuite,
            handleExpiry(preferences) {
                if (!initPayload) return false;
                if (preferences.expiryAction === 'lock') {
                    expiredLock = true;
                    slots.forEach((slot) => { if (slot.ready) { api.setLocked(slot.frame.contentDocument, true); pauseMedia(slot); } });
                    return true;
                }
                if (simulation() && preferences.expiryAction === 'auto-submit') { submitSuite(); return true; }
                return false;
            },
            isSimulation: simulation,
            hasSuite: () => Boolean(initPayload)
        };
    }

    global.ListeningSuiteController = { create, capturePage, restorePage };
})(typeof window !== 'undefined' ? window : globalThis);
