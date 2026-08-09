(function(global) {
    const isFileProtocol = !!(global && global.location && global.location.protocol === 'file:');
    const multiSuiteRecoveryName = 'multi-suite-practice';
    const multiSuiteRecoverySchema = 'multi-suite-sessions-v2';
    const suiteRecoveryTtlMs = 30 * 24 * 60 * 60 * 1000;

    function normalizeRecoveryEntityRevision(value) {
        const revision = Number(value);
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    }

    function suiteRecoveryTimestamp(value) {
        for (const field of ['updatedAt', 'lastUpdate', 'timestamp', 'createdAt']) {
            const raw = value && value[field];
            const numeric = Number(raw);
            if (Number.isFinite(numeric) && numeric >= Date.UTC(2000, 0, 1)) return numeric;
            if (typeof raw === 'string' && raw.trim() && !Number.isFinite(numeric)) {
                const parsed = Date.parse(raw);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return null;
    }

    function getSuitePreferenceUtils() {
        return global.SuitePreferenceUtils || null;
    }

    function resolveSuitePreferenceForMixin(options = {}) {
        const suitePreferenceUtils = getSuitePreferenceUtils();
        if (suitePreferenceUtils && typeof suitePreferenceUtils.resolveSuitePreference === 'function') {
            return suitePreferenceUtils.ensurePracticeConfig().suite || {};
        }
        let flowMode = String(options && options.flowMode || '').trim().toLowerCase();
        if (!['classic', 'simulation', 'stationary'].includes(flowMode)) {
            flowMode = 'classic';
        }
        let frequencyScope = String(options && options.frequencyScope || '').trim().toLowerCase();
        if (!['high', 'high_medium', 'all', 'custom'].includes(frequencyScope)) {
            frequencyScope = 'all';
        }
        return {
            flowMode,
            frequencyScope,
            autoAdvanceAfterSubmit: flowMode !== 'stationary'
        };
    }

    function isFrequencyInScope(frequency, scope) {
        const suitePreferenceUtils = getSuitePreferenceUtils();
        if (suitePreferenceUtils && typeof suitePreferenceUtils.isFrequencyIncluded === 'function') {
            return suitePreferenceUtils.isFrequencyIncluded(frequency, scope);
        }
        const normalizedScope = ['high', 'high_medium', 'custom'].includes(scope) ? scope : 'all';
        const normalizedFrequency = String(frequency == null ? '' : frequency).trim().toLowerCase();
        if (!normalizedFrequency) {
            return true;
        }
        if (normalizedScope === 'high') {
            return ['high', '高频', 'ultra-high', '超高频', 'high frequency'].includes(normalizedFrequency);
        }
        if (normalizedScope === 'high_medium') {
            return ['high', 'medium', 'mid', '高频', '次高频', '中频', 'ultra-high', 'very-high', 'high frequency', 'medium frequency'].includes(normalizedFrequency);
        }
        return true;
    }

    const mixin = {
        initializeSuiteMode() {
            if (this._suiteModeReady) {
                return;
            }

            this._suiteModeReady = true;
            this.currentSuiteSession = null;
            this.suiteExamMap = new Map();
            this.multiSuiteSessionsMap = new Map(); // 新增：存储多套题会话
            this._multiSuiteCompletionTails = new Map();
            this._suiteSessionGeneration = Math.max(0, Number(this._suiteSessionGeneration) || 0);
            const restoredMultiSuiteSessions = this._restoreMultiSuiteSessionsFromStorage({ install: false });
            if (typeof this._clearSuiteHandshakes === 'function') {
                this._clearSuiteHandshakes();
            }

            const restored = this._restoreSessionFromStorage();
            // Window-session WAL is copyable when a browser tab is duplicated. Keep it
            // quarantined until this document holds the non-serializable Web Lock for
            // the exact AppData entity id; only then may it become a live runtime owner.
            this._suiteRecoveryReady = this._restorePersistentSuiteSession(
                restored,
                Array.isArray(restoredMultiSuiteSessions) ? restoredMultiSuiteSessions : []
            );
        },

        _suiteRecoveryClaimName(sessionOrId) {
            const id = sessionOrId && typeof sessionOrId === 'object'
                ? sessionOrId.id
                : sessionOrId;
            const normalizedId = String(id ?? '');
            return normalizedId ? `ielts-atlas:suite-recovery:${normalizedId}` : '';
        },

        _getSuiteRecoveryClaimState() {
            if (!(this._suiteRecoveryClaimsById instanceof Map)) {
                this._suiteRecoveryClaimsById = new Map();
            }
            if (!(this._suiteRecoveryClaimsBySession instanceof WeakMap)) {
                this._suiteRecoveryClaimsBySession = new WeakMap();
            }
            return {
                byId: this._suiteRecoveryClaimsById,
                bySession: this._suiteRecoveryClaimsBySession
            };
        },

        _multiSuiteBaseClaimName(baseExamId) {
            const normalizedBaseExamId = String(baseExamId || '').trim();
            return normalizedBaseExamId
                ? `ielts-atlas:multi-suite-base:${normalizedBaseExamId}`
                : '';
        },

        _getMultiSuiteBaseClaimState() {
            if (!(this._multiSuiteBaseClaimsByBase instanceof Map)) {
                this._multiSuiteBaseClaimsByBase = new Map();
            }
            if (!(this._multiSuiteBaseClaimsBySession instanceof WeakMap)) {
                this._multiSuiteBaseClaimsBySession = new WeakMap();
            }
            return {
                byBase: this._multiSuiteBaseClaimsByBase,
                bySession: this._multiSuiteBaseClaimsBySession
            };
        },

        _rejectMultiSuiteBaseClaimSession(session) {
            if (!session || typeof session !== 'object') return false;
            try {
                Object.defineProperty(session, '_multiSuiteBaseClaimRejected', {
                    value: true,
                    writable: true,
                    configurable: true,
                    enumerable: false
                });
            } catch (_) {
                session._multiSuiteBaseClaimRejected = true;
            }
            return true;
        },

        _ownsMultiSuiteBaseClaim(session) {
            if (isFileProtocol) return Boolean(session && String(session.baseExamId || '').trim());
            if (!session || !String(session.baseExamId || '').trim()) return false;
            const baseExamId = String(session.baseExamId).trim();
            const { byBase, bySession } = this._getMultiSuiteBaseClaimState();
            const claim = bySession.get(session);
            return Boolean(claim
                && claim.baseExamId === baseExamId
                && claim.ownerSession === session
                && claim.state === 'held'
                && byBase.get(baseExamId) === claim);
        },

        async _acquireMultiSuiteBaseClaim(session) {
            const baseExamId = String(session && session.baseExamId || '').trim();
            if (!session || !baseExamId || session._multiSuiteBaseClaimRejected === true) return false;
            session.baseExamId = baseExamId;
            if (isFileProtocol) return true;
            const lockName = this._multiSuiteBaseClaimName(baseExamId);
            const locks = global.navigator && global.navigator.locks;
            if (!lockName || !locks || typeof locks.request !== 'function') {
                this._rejectMultiSuiteBaseClaimSession(session);
                return false;
            }
            const { byBase, bySession } = this._getMultiSuiteBaseClaimState();
            const boundClaim = bySession.get(session);
            if (boundClaim) {
                if (boundClaim.ownerSession !== session || boundClaim.baseExamId !== baseExamId) return false;
                if (boundClaim.state === 'held') return this._ownsMultiSuiteBaseClaim(session);
                if (boundClaim.state === 'pending' && boundClaim.acquiredPromise) {
                    return boundClaim.acquiredPromise;
                }
                return false;
            }
            const existing = byBase.get(baseExamId);
            if (existing) {
                if (existing.ownerSession !== session) return false;
                if (existing.state === 'held') return true;
                if (existing.state === 'pending' && existing.acquiredPromise) {
                    return existing.acquiredPromise;
                }
                return false;
            }

            let settleAcquisition;
            let acquisitionSettled = false;
            const acquiredPromise = new Promise((resolve) => {
                settleAcquisition = (owned) => {
                    if (acquisitionSettled) return;
                    acquisitionSettled = true;
                    resolve(Boolean(owned));
                };
            });
            let releaseHold;
            const holdPromise = new Promise((resolve) => { releaseHold = resolve; });
            const claim = {
                baseExamId,
                lockName,
                ownerSession: session,
                state: 'pending',
                acquiredPromise,
                releaseHold,
                releaseRequested: false,
                contention: false,
                requestPromise: null
            };
            byBase.set(baseExamId, claim);
            bySession.set(session, claim);
            claim.requestPromise = Promise.resolve().then(() => locks.request(lockName, {
                mode: 'exclusive',
                ifAvailable: true
            }, async (lock) => {
                if (!lock || byBase.get(baseExamId) !== claim || bySession.get(session) !== claim) {
                    if (!lock) claim.contention = true;
                    settleAcquisition(false);
                    return false;
                }
                claim.state = 'held';
                settleAcquisition(true);
                await holdPromise;
                return true;
            })).catch(() => {
                settleAcquisition(false);
                return false;
            }).finally(() => {
                const endedUnexpectedly = claim.state === 'held' && claim.releaseRequested !== true;
                const ownerSession = claim.ownerSession;
                if (byBase.get(baseExamId) === claim) byBase.delete(baseExamId);
                if (bySession.get(ownerSession) === claim) bySession.delete(ownerSession);
                claim.state = 'released';
                if (endedUnexpectedly && ownerSession) {
                    this._terminalizeSuiteRecoverySession(ownerSession);
                    this._rejectMultiSuiteBaseClaimSession(ownerSession);
                    Promise.resolve().then(() => this._releaseSuiteRecoveryClaim('multi', ownerSession)).catch(() => {});
                }
                settleAcquisition(false);
            });
            const acquired = await acquiredPromise;
            if (!acquired) {
                if (byBase.get(baseExamId) === claim) byBase.delete(baseExamId);
                if (bySession.get(session) === claim) bySession.delete(session);
                this._rejectMultiSuiteBaseClaimSession(session);
                if (claim.contention === true) this._markSuiteRecoveryLeaseContended('multi', session);
            }
            return acquired;
        },

        _transferMultiSuiteBaseClaim(fromSession, toSession) {
            const fromBaseExamId = String(fromSession && fromSession.baseExamId || '').trim();
            const toBaseExamId = String(toSession && toSession.baseExamId || '').trim();
            if (!fromSession || !toSession || !fromBaseExamId || fromBaseExamId !== toBaseExamId) return false;
            if (isFileProtocol) {
                toSession._multiSuiteBaseClaimRejected = false;
                this._rejectMultiSuiteBaseClaimSession(fromSession);
                return true;
            }
            const { byBase, bySession } = this._getMultiSuiteBaseClaimState();
            const claim = bySession.get(fromSession);
            if (!claim || claim.ownerSession !== fromSession || claim.baseExamId !== fromBaseExamId
                || claim.state !== 'held' || byBase.get(fromBaseExamId) !== claim) {
                return false;
            }
            bySession.delete(fromSession);
            claim.ownerSession = toSession;
            bySession.set(toSession, claim);
            toSession._multiSuiteBaseClaimRejected = false;
            this._rejectMultiSuiteBaseClaimSession(fromSession);
            return true;
        },

        async _releaseMultiSuiteBaseClaim(session) {
            const baseExamId = String(session && session.baseExamId || '').trim();
            if (!session || !baseExamId) return false;
            if (isFileProtocol) {
                this._rejectMultiSuiteBaseClaimSession(session);
                return true;
            }
            const { byBase, bySession } = this._getMultiSuiteBaseClaimState();
            const claim = bySession.get(session);
            if (!claim || claim.ownerSession !== session || claim.baseExamId !== baseExamId
                || claim.state !== 'held' || byBase.get(baseExamId) !== claim) {
                return false;
            }
            this._rejectMultiSuiteBaseClaimSession(session);
            claim.releaseRequested = true;
            claim.state = 'releasing';
            byBase.delete(baseExamId);
            bySession.delete(session);
            claim.releaseHold();
            try {
                await claim.requestPromise;
            } catch (_) {}
            return true;
        },

        _terminalizeSuiteRecoverySession(session) {
            if (!session || typeof session !== 'object') return false;
            try {
                Object.defineProperties(session, {
                    _suiteRecoveryClaimRejected: {
                        value: true,
                        writable: true,
                        configurable: true,
                        enumerable: false
                    },
                    _suiteRecoveryWritesBlocked: {
                        value: true,
                        writable: true,
                        configurable: true,
                        enumerable: false
                    }
                });
            } catch (_) {
                session._suiteRecoveryClaimRejected = true;
                session._suiteRecoveryWritesBlocked = true;
            }
            return true;
        },

        _ownsSuiteRecoveryClaim(kind, session) {
            if (isFileProtocol) return Boolean(session && session.id);
            if (!session || !session.id) return false;
            const normalizedKind = kind === 'multi' ? 'multi' : 'single';
            const { byId, bySession } = this._getSuiteRecoveryClaimState();
            const id = String(session.id);
            const claim = bySession.get(session);
            return Boolean(claim
                && claim.kind === normalizedKind
                && claim.id === id
                && claim.state === 'held'
                && claim.ownerSession === session
                && byId.get(id) === claim);
        },

        _suiteRecoveryClaimOwner(kind, sessionOrId) {
            if (isFileProtocol) return null;
            const id = String(sessionOrId && typeof sessionOrId === 'object'
                ? sessionOrId.id ?? ''
                : sessionOrId ?? '');
            if (!id) return null;
            const normalizedKind = kind === 'multi' ? 'multi' : 'single';
            const { byId } = this._getSuiteRecoveryClaimState();
            const claim = byId.get(id);
            return claim && claim.kind === normalizedKind && claim.state === 'held'
                ? claim.ownerSession
                : null;
        },

        _markSuiteRecoveryLeaseContended(kind, session) {
            if (isFileProtocol || !session || !session.id) return false;
            const windowSession = global.AppData?.recovery?.windowSession;
            if (!windowSession || typeof windowSession.get !== 'function'
                || typeof windowSession.save !== 'function') return false;
            const id = String(session.id);
            try {
                if (kind !== 'multi') {
                    const snapshot = windowSession.get('simulation');
                    if (!snapshot || String(snapshot.id ?? '') !== id) return false;
                    return windowSession.save('simulation', {
                        ...snapshot,
                        recoveryLeaseContended: true
                    }) !== false;
                }
                const snapshot = windowSession.get(multiSuiteRecoveryName);
                if (!snapshot || !Array.isArray(snapshot.sessions)) return false;
                let matched = false;
                const sessions = snapshot.sessions.map((storedSession) => {
                    if (!storedSession || String(storedSession.id ?? '') !== id) return storedSession;
                    matched = true;
                    return { ...storedSession, recoveryLeaseContended: true };
                });
                if (!matched) return false;
                return windowSession.save(multiSuiteRecoveryName, { ...snapshot, sessions }) !== false;
            } catch (_) {
                return false;
            }
        },

        _removeSuiteRecoveryWindowWal(kind, session) {
            if (!session || !session.id) return false;
            const windowSession = global.AppData?.recovery?.windowSession;
            if (!windowSession || typeof windowSession.get !== 'function') return false;
            const id = String(session.id);
            try {
                if (kind !== 'multi') {
                    const snapshot = windowSession.get('simulation');
                    if (!snapshot || String(snapshot.id ?? '') !== id) return false;
                    return typeof windowSession.discard === 'function'
                        ? windowSession.discard('simulation') !== false
                        : false;
                }
                const snapshot = windowSession.get(multiSuiteRecoveryName);
                if (!snapshot || !Array.isArray(snapshot.sessions)) return false;
                const sessions = snapshot.sessions.filter((storedSession) => (
                    !storedSession || String(storedSession.id ?? '') !== id
                ));
                if (sessions.length === snapshot.sessions.length) return false;
                if (!sessions.length) {
                    return typeof windowSession.discard === 'function'
                        ? windowSession.discard(multiSuiteRecoveryName) !== false
                        : false;
                }
                return typeof windowSession.save === 'function'
                    ? windowSession.save(multiSuiteRecoveryName, { ...snapshot, sessions }) !== false
                    : false;
            } catch (_) {
                return false;
            }
        },

        async _readSuiteRecoveryFence(session) {
            const recovery = global.AppData && global.AppData.recovery;
            if (!session || session.id == null || !recovery
                || typeof recovery.getActiveSessionFence !== 'function') {
                return { supported: false, exists: false, tombstoned: false, revision: 0 };
            }
            try {
                const fence = await recovery.getActiveSessionFence(String(session.id));
                if (!fence || typeof fence !== 'object'
                    || String(fence.id ?? '') !== String(session.id)) {
                    return { supported: false, exists: false, tombstoned: false, revision: 0 };
                }
                return {
                    supported: true,
                    exists: fence.exists === true,
                    tombstoned: fence.exists === true && fence.tombstoned === true,
                    revision: normalizeRecoveryEntityRevision(fence.revision)
                };
            } catch (error) {
                console.warn('[SuitePractice] 读取恢复实体 fence 失败，保留窗口 WAL 供重试:', error);
                return { supported: false, exists: false, tombstoned: false, revision: 0 };
            }
        },

        async _acquireSuiteRecoveryClaim(kind, session) {
            if (isFileProtocol) return Boolean(session && session.id);
            if (!session || !session.id || session._suiteRecoveryClaimRejected === true) return false;
            const normalizedKind = kind === 'multi' ? 'multi' : 'single';
            const id = String(session.id);
            const lockName = this._suiteRecoveryClaimName(id);
            if (!lockName) return false;
            const { byId, bySession } = this._getSuiteRecoveryClaimState();
            const boundClaim = bySession.get(session);
            if (boundClaim) {
                if (boundClaim.kind !== normalizedKind || boundClaim.ownerSession !== session) return false;
                if (boundClaim.state === 'held') return this._ownsSuiteRecoveryClaim(normalizedKind, session);
                if (boundClaim.state === 'pending' && boundClaim.acquiredPromise) {
                    return boundClaim.acquiredPromise;
                }
                return false;
            }
            const existing = byId.get(id);
            if (existing) {
                if (existing.ownerSession !== session || existing.kind !== normalizedKind) return false;
                if (existing.state === 'held') return true;
                if (existing.state === 'pending' && existing.acquiredPromise) {
                    return existing.acquiredPromise;
                }
                return false;
            }

            const locks = global.navigator && global.navigator.locks;
            if (!locks || typeof locks.request !== 'function') {
                this._terminalizeSuiteRecoverySession(session);
                return false;
            }

            let settleAcquisition;
            let acquisitionSettled = false;
            const acquiredPromise = new Promise((resolve) => {
                settleAcquisition = (owned) => {
                    if (acquisitionSettled) return;
                    acquisitionSettled = true;
                    resolve(Boolean(owned));
                };
            });
            let releaseHold;
            const holdPromise = new Promise((resolve) => { releaseHold = resolve; });
            const claim = {
                id,
                kind: normalizedKind,
                lockName,
                ownerSession: session,
                state: 'pending',
                acquiredPromise,
                releaseHold,
                releaseRequested: false,
                contention: false,
                requestPromise: null
            };
            byId.set(id, claim);
            bySession.set(session, claim);

            claim.requestPromise = Promise.resolve().then(() => locks.request(lockName, {
                mode: 'exclusive',
                ifAvailable: true
            }, async (lock) => {
                if (!lock || byId.get(id) !== claim || bySession.get(session) !== claim) {
                    if (!lock) claim.contention = true;
                    settleAcquisition(false);
                    return false;
                }
                claim.state = 'held';
                settleAcquisition(true);
                await holdPromise;
                return true;
            })).catch((error) => {
                claim.error = error;
                settleAcquisition(false);
                return false;
            }).finally(() => {
                const endedUnexpectedly = claim.state === 'held' && claim.releaseRequested !== true;
                if (byId.get(id) === claim) byId.delete(id);
                if (bySession.get(claim.ownerSession) === claim) {
                    bySession.delete(claim.ownerSession);
                }
                claim.state = 'released';
                if (endedUnexpectedly && claim.ownerSession) {
                    this._terminalizeSuiteRecoverySession(claim.ownerSession);
                    if (normalizedKind === 'multi' && this._ownsMultiSuiteBaseClaim(claim.ownerSession)) {
                        Promise.resolve().then(() => this._releaseMultiSuiteBaseClaim(claim.ownerSession)).catch(() => {});
                    }
                }
                settleAcquisition(false);
            });

            const acquired = await acquiredPromise;
            if (!acquired) {
                if (byId.get(id) === claim) byId.delete(id);
                if (bySession.get(session) === claim) bySession.delete(session);
                this._terminalizeSuiteRecoverySession(session);
                if (claim.contention === true) {
                    this._markSuiteRecoveryLeaseContended(normalizedKind, session);
                }
            }
            return acquired;
        },

        async _ensureSuiteRecoveryClaim(kind, session) {
            return this._ownsSuiteRecoveryClaim(kind, session)
                || await this._acquireSuiteRecoveryClaim(kind, session);
        },

        _ownsMultiSuiteRecoveryOwnership(session) {
            return this._ownsMultiSuiteBaseClaim(session)
                && this._ownsSuiteRecoveryClaim('multi', session);
        },

        async _acquireMultiSuiteRecoveryOwnership(session) {
            if (!session || !session.id || !String(session.baseExamId || '').trim()) return false;
            if (!this._ownsMultiSuiteBaseClaim(session)
                && !await this._acquireMultiSuiteBaseClaim(session)) {
                return false;
            }
            if (this._ownsSuiteRecoveryClaim('multi', session)
                || await this._acquireSuiteRecoveryClaim('multi', session)) {
                const ownsCombined = this._ownsMultiSuiteRecoveryOwnership(session);
                if (!ownsCombined && this._ownsSuiteRecoveryClaim('multi', session)) {
                    // The base request may end unexpectedly while the exact request is
                    // pending. Never leave the late exact acquisition held on its own.
                    await this._releaseSuiteRecoveryClaim('multi', session);
                }
                return ownsCombined;
            }
            await this._releaseMultiSuiteBaseClaim(session);
            return false;
        },

        _transferSuiteRecoveryClaim(kind, fromSession, toSession) {
            const normalizedKind = kind === 'multi' ? 'multi' : 'single';
            if (isFileProtocol) {
                if (!fromSession || !toSession
                    || String(fromSession.id ?? '') !== String(toSession.id ?? '')) {
                    return false;
                }
                if (normalizedKind === 'multi') {
                    const fromBaseExamId = String(fromSession.baseExamId || '').trim();
                    const toBaseExamId = String(toSession.baseExamId || '').trim();
                    if (!fromBaseExamId || !toBaseExamId) return false;
                    if (fromBaseExamId === toBaseExamId) {
                        if (!this._transferMultiSuiteBaseClaim(fromSession, toSession)) return false;
                    } else {
                        toSession._multiSuiteBaseClaimRejected = false;
                        this._rejectMultiSuiteBaseClaimSession(fromSession);
                    }
                }
                toSession._suiteRecoveryClaimRejected = false;
                delete toSession._suiteRecoveryWritesBlocked;
                this._terminalizeSuiteRecoverySession(fromSession);
                return true;
            }
            if (!fromSession || !toSession || String(fromSession.id ?? '') !== String(toSession.id ?? '')) {
                return false;
            }
            const { byId, bySession } = this._getSuiteRecoveryClaimState();
            const claim = bySession.get(fromSession);
            const id = String(fromSession.id);
            if (!claim || claim.kind !== normalizedKind || claim.state !== 'held'
                || claim.ownerSession !== fromSession || byId.get(id) !== claim) {
                return false;
            }
            if (normalizedKind === 'multi') {
                const fromBaseExamId = String(fromSession.baseExamId || '').trim();
                const toBaseExamId = String(toSession.baseExamId || '').trim();
                if (!fromBaseExamId || !toBaseExamId || !this._ownsMultiSuiteBaseClaim(fromSession)) {
                    return false;
                }
                if (fromBaseExamId === toBaseExamId) {
                    if (!this._transferMultiSuiteBaseClaim(fromSession, toSession)) return false;
                } else if (!this._ownsMultiSuiteBaseClaim(toSession)) {
                    // A same-entity durable snapshot can correct a stale WAL base, but
                    // the authoritative base must be reserved before its exact-id claim
                    // moves. The caller releases the superseded base after the transfer.
                    return false;
                }
            }
            bySession.delete(fromSession);
            claim.ownerSession = toSession;
            bySession.set(toSession, claim);
            toSession._suiteRecoveryClaimRejected = false;
            delete toSession._suiteRecoveryWritesBlocked;
            this._terminalizeSuiteRecoverySession(fromSession);
            return true;
        },

        async _releaseSuiteRecoveryClaim(kind, session) {
            const normalizedKind = kind === 'multi' ? 'multi' : 'single';
            if (isFileProtocol) {
                if (!session || !session.id) return false;
                if (normalizedKind === 'multi') await this._releaseMultiSuiteBaseClaim(session);
                this._terminalizeSuiteRecoverySession(session);
                return true;
            }
            if (!session || !session.id) return false;
            const { byId, bySession } = this._getSuiteRecoveryClaimState();
            const id = String(session.id);
            const claim = bySession.get(session);
            if (!claim || claim.kind !== normalizedKind || claim.ownerSession !== session
                || byId.get(id) !== claim || claim.state !== 'held') {
                return normalizedKind === 'multi'
                    ? await this._releaseMultiSuiteBaseClaim(session)
                    : false;
            }
            // Releasing a runtime claim is terminal for that exact object. A stale
            // continuation must never reacquire the same id after reconciliation,
            // canonical alias eviction, or successful teardown (ABA protection).
            this._terminalizeSuiteRecoverySession(session);
            claim.releaseRequested = true;
            claim.state = 'releasing';
            byId.delete(id);
            bySession.delete(session);
            claim.releaseHold();
            try {
                await claim.requestPromise;
            } catch (_) {}
            if (normalizedKind === 'multi' && this._ownsMultiSuiteBaseClaim(session)) {
                await this._releaseMultiSuiteBaseClaim(session);
            }
            return true;
        },

        _installRestoredSuiteSession(restored) {
            if (!restored) return null;
            const restoredGeneration = Math.max(0, Number(restored._suiteGeneration) || 0);
            this._suiteSessionGeneration = Math.max(this._suiteSessionGeneration, restoredGeneration);
            restored._suiteGeneration = restoredGeneration || ++this._suiteSessionGeneration;
            this.currentSuiteSession = restored;
            this._registerSuiteSequence(restored);
            this._suiteResumeNoticeShown = false;
            return restored;
        },

        async _claimDurableSingleRecoveryGroup(recovery, rawItems, durableEntityId, preferredSession = null) {
            const firstItemsById = new Map();
            (Array.isArray(rawItems) ? rawItems : []).forEach((item) => {
                const id = durableEntityId(item);
                if (id && !firstItemsById.has(id)) firstItemsById.set(id, item);
            });
            const singleItems = Array.from(firstItemsById.values())
                .filter((item) => item
                    && item.schema === 'suite-session-v2'
                    && Number(item.version) === 2)
                .sort((left, right) => {
                    const leftTime = Number(left.lastUpdate) || Date.parse(left.updatedAt || '') || 0;
                    const rightTime = Number(right.lastUpdate) || Date.parse(right.updatedAt || '') || 0;
                    return rightTime - leftTime;
                });
            const preferredId = preferredSession && preferredSession.id != null
                ? String(preferredSession.id)
                : '';
            const preferredItem = preferredId ? firstItemsById.get(preferredId) : null;
            const preferredOwnsSingleItem = Boolean(preferredItem
                && preferredItem.schema === 'suite-session-v2'
                && Number(preferredItem.version) === 2);
            const newestValidItem = singleItems.find((item) => Boolean(this._restoreSessionFromStorage(item)));
            // A matching WAL is evidence for repairing that exact durable identity, not
            // authority to roll the singleton group back. A newer valid durable owner must
            // win even when this tab still carries an older matching WAL.
            const authoritativeItem = newestValidItem
                || (preferredOwnsSingleItem ? preferredItem : null);
            if (!authoritativeItem) {
                if (preferredId && singleItems.length) {
                    if (this._ownsSuiteRecoveryClaim('single', preferredSession)) {
                        await this._releaseSuiteRecoveryClaim('single', preferredSession);
                    } else {
                        this._terminalizeSuiteRecoverySession(preferredSession);
                    }
                    return { session: null, items: rawItems, acquired: false, attempted: true };
                }
                return { session: null, items: rawItems, acquired: false, attempted: false };
            }

            const authoritativeId = durableEntityId(authoritativeItem);
            const authoritativeUsesPreferredSession = Boolean(preferredSession
                && preferredId === authoritativeId);
            const authoritativeSession = authoritativeUsesPreferredSession
                ? preferredSession
                : this._restoreSessionFromStorage(authoritativeItem);
            const authoritativeNeedsWalRepair = !newestValidItem && authoritativeUsesPreferredSession;
            const initialSingleIds = new Set(singleItems.map((item) => durableEntityId(item)));
            const claimedSessions = [];
            if (preferredSession && !authoritativeUsesPreferredSession
                && this._ownsSuiteRecoveryClaim('single', preferredSession)) {
                // The copied/pre-first-save WAL has its own exact lock. Keep it through
                // reconciliation so it cannot race an expected=0 write, then terminalize
                // it when the durable singleton owner is selected (or coordination fails).
                claimedSessions.push(preferredSession);
            }
            const releaseClaims = async (keepAuthoritative = false) => {
                for (const session of claimedSessions) {
                    if (keepAuthoritative && session === authoritativeSession) continue;
                    if (this._ownsSuiteRecoveryClaim('single', session)) {
                        await this._releaseSuiteRecoveryClaim('single', session);
                    } else {
                        this._terminalizeSuiteRecoverySession(session);
                    }
                }
            };
            const claimsStillOwned = () => claimedSessions.every((session) => (
                this._ownsSuiteRecoveryClaim('single', session)
            ));

            try {
                // Claim the authoritative identity first. If it is live elsewhere, never
                // touch an older singleton or fall back to it.
                if (!this._ownsSuiteRecoveryClaim('single', authoritativeSession)
                    && !await this._acquireSuiteRecoveryClaim('single', authoritativeSession)) {
                    await releaseClaims();
                    return { session: null, items: rawItems, acquired: false, attempted: true };
                }
                if (!claimedSessions.includes(authoritativeSession)) {
                    claimedSessions.push(authoritativeSession);
                }
                for (const item of singleItems) {
                    const id = durableEntityId(item);
                    if (!id || id === authoritativeId) continue;
                    const groupSession = preferredSession && id === preferredId
                        ? preferredSession
                        : (this._restoreSessionFromStorage(item) || { id });
                    if (!await this._acquireSuiteRecoveryClaim('single', groupSession)) {
                        await releaseClaims();
                        return { session: null, items: rawItems, acquired: false, attempted: true };
                    }
                    if (!claimedSessions.includes(groupSession)) claimedSessions.push(groupSession);
                }

                // The first list may race with completion, TTL pruning, or an older
                // client. Re-read only after every exact identity is locked, and require
                // the complete singleton set and its newest valid owner to be unchanged.
                let refreshedItems = await recovery.listActiveSessions();
                const refreshedFirstItemsById = new Map();
                (Array.isArray(refreshedItems) ? refreshedItems : []).forEach((item) => {
                    const id = durableEntityId(item);
                    if (id && !refreshedFirstItemsById.has(id)) refreshedFirstItemsById.set(id, item);
                });
                const refreshedSingleItems = Array.from(refreshedFirstItemsById.values())
                    .filter((item) => item
                        && item.schema === 'suite-session-v2'
                        && Number(item.version) === 2)
                    .sort((left, right) => {
                        const leftTime = Number(left.lastUpdate) || Date.parse(left.updatedAt || '') || 0;
                        const rightTime = Number(right.lastUpdate) || Date.parse(right.updatedAt || '') || 0;
                        return rightTime - leftTime;
                    });
                const refreshedNewestValid = refreshedSingleItems.find((item) => (
                    Boolean(this._restoreSessionFromStorage(item))
                ));
                const refreshedRepairItem = authoritativeNeedsWalRepair
                    ? refreshedFirstItemsById.get(authoritativeId)
                    : null;
                const refreshedAuthoritative = refreshedNewestValid
                    || (refreshedRepairItem
                        && refreshedRepairItem.schema === 'suite-session-v2'
                        && Number(refreshedRepairItem.version) === 2
                        ? refreshedRepairItem
                        : null);
                const claimedIds = new Set(claimedSessions
                    .map((session) => String(session.id))
                    .filter((id) => initialSingleIds.has(id)));
                const refreshedIds = new Set(refreshedSingleItems.map((item) => durableEntityId(item)));
                if (!refreshedAuthoritative
                    || durableEntityId(refreshedAuthoritative) !== authoritativeId
                    || claimedIds.size !== refreshedIds.size
                    || Array.from(claimedIds).some((id) => !refreshedIds.has(id))
                    || !claimsStillOwned()) {
                    await releaseClaims();
                    return { session: null, items: refreshedItems, acquired: false, attempted: true };
                }

                if (refreshedSingleItems.length > 1
                    && typeof recovery.discardActiveSession !== 'function') {
                    await releaseClaims();
                    return { session: null, items: refreshedItems, acquired: false, attempted: true };
                }
                for (const item of refreshedSingleItems) {
                    const id = durableEntityId(item);
                    if (id === authoritativeId) continue;
                    const discardReceipt = await recovery.discardActiveSession(id, {
                        expectedEntityRevision: normalizeRecoveryEntityRevision(item.revision),
                        commitGuard: claimsStillOwned
                    });
                    if (!discardReceipt || discardReceipt.committed !== true || !claimsStillOwned()) {
                        await releaseClaims();
                        return { session: null, items: refreshedItems, acquired: false, attempted: true };
                    }
                }

                refreshedItems = await recovery.listActiveSessions();
                const remainingSingleIds = [];
                const finalFirstItemsById = new Map();
                (Array.isArray(refreshedItems) ? refreshedItems : []).forEach((item) => {
                    const id = durableEntityId(item);
                    if (id && !finalFirstItemsById.has(id)) finalFirstItemsById.set(id, item);
                });
                for (const item of finalFirstItemsById.values()) {
                    if (item && item.schema === 'suite-session-v2' && Number(item.version) === 2) {
                        remainingSingleIds.push(durableEntityId(item));
                    }
                }
                const finalAuthoritative = finalFirstItemsById.get(authoritativeId);
                if (remainingSingleIds.length !== 1
                    || remainingSingleIds[0] !== authoritativeId
                    || !finalAuthoritative
                    || (!authoritativeNeedsWalRepair && !this._restoreSessionFromStorage(finalAuthoritative))
                    || !this._ownsSuiteRecoveryClaim('single', authoritativeSession)) {
                    await releaseClaims();
                    return { session: null, items: refreshedItems, acquired: false, attempted: true };
                }

                await releaseClaims(true);
                if (!authoritativeUsesPreferredSession) {
                    authoritativeSession._restoredFromDurableClaim = true;
                }
                return {
                    session: authoritativeSession,
                    items: refreshedItems,
                    acquired: true,
                    attempted: true
                };
            } catch (error) {
                await releaseClaims();
                throw error;
            }
        },

        async _restorePersistentSuiteSession(fastSnapshotSession = null, multiWindowSessions = []) {
            const pendingMultiWindowSessions = Array.isArray(multiWindowSessions)
                ? multiWindowSessions
                : [];
            const claimedMultiWindowSessions = [];
            let singleWindowClaimUnavailable = false;
            if (fastSnapshotSession) {
                if (!await this._acquireSuiteRecoveryClaim('single', fastSnapshotSession)) {
                    singleWindowClaimUnavailable = true;
                    fastSnapshotSession = null;
                }
            }
            for (const session of pendingMultiWindowSessions) {
                if (session && await this._acquireMultiSuiteRecoveryOwnership(session)) {
                    claimedMultiWindowSessions.push(session);
                }
            }
            const recovery = global.AppData && global.AppData.recovery;
            if (!recovery || typeof recovery.listActiveSessions !== 'function') {
                if (!isFileProtocol) {
                    // HTTP(S) WAL is copyable across duplicated tabs. Without an
                    // authoritative durable enumeration we cannot distinguish a
                    // pre-first-save crash from a completed owner whose tombstone is
                    // temporarily unreadable, so keep the serialized WAL quarantined.
                    for (const session of claimedMultiWindowSessions) {
                        if (this._ownsSuiteRecoveryClaim('multi', session)) {
                            await this._releaseSuiteRecoveryClaim('multi', session);
                        } else if (this._ownsMultiSuiteBaseClaim(session)) {
                            await this._releaseMultiSuiteBaseClaim(session);
                        }
                    }
                    if (fastSnapshotSession && this._ownsSuiteRecoveryClaim('single', fastSnapshotSession)) {
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                    }
                    return null;
                }
                for (const session of claimedMultiWindowSessions) {
                    if (!this._ownsMultiSuiteRecoveryOwnership(session)) continue;
                    if (session._suiteRecoveryLeaseContended === true) {
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    this.multiSuiteSessionsMap.set(String(session.baseExamId || '').trim(), session);
                }
                if (fastSnapshotSession && this._ownsSuiteRecoveryClaim('single', fastSnapshotSession)) {
                    if (fastSnapshotSession._suiteRecoveryLeaseContended === true) {
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        fastSnapshotSession = null;
                    } else {
                        this._installRestoredSuiteSession(fastSnapshotSession);
                        this._notifySuiteResumeAvailable(fastSnapshotSession);
                    }
                }
                return fastSnapshotSession;
            }
            try {
                if (global.AppData.ready && typeof global.AppData.ready.then === 'function') {
                    await global.AppData.ready;
                }
                let items = await recovery.listActiveSessions();
                const durableEntityId = (item) => {
                    for (const field of ['id', 'sessionId', 'recordId']) {
                        if (item && item[field] !== undefined && item[field] !== null && item[field] !== '') {
                            return String(item[field]);
                        }
                    }
                    return '';
                };
                let acquiredDurableOnlyClaim = false;
                let retryDurableSingleAfterMulti = false;
                if (fastSnapshotSession && !singleWindowClaimUnavailable) {
                    const coordinatedWindowSingle = await this._claimDurableSingleRecoveryGroup(
                        recovery,
                        items,
                        durableEntityId,
                        fastSnapshotSession
                    );
                    if (coordinatedWindowSingle.attempted) {
                        items = coordinatedWindowSingle.items;
                        if (coordinatedWindowSingle.acquired) {
                            fastSnapshotSession = coordinatedWindowSingle.session;
                            acquiredDurableOnlyClaim = true;
                        } else {
                            // The exact WAL remains serialized, but it must not be exposed
                            // while another singleton identity is live or group cleanup
                            // cannot be confirmed.
                            fastSnapshotSession = null;
                            singleWindowClaimUnavailable = true;
                        }
                    }
                }
                if (!fastSnapshotSession && !singleWindowClaimUnavailable) {
                    // Durable-only singleton recovery must coordinate the complete group on
                    // file: as well. Web Locks are bypassed there, but AppData still enforces
                    // the same exclusive group and would otherwise reject the first resumed
                    // commit while an older id remained active.
                    const coordinatedSingle = await this._claimDurableSingleRecoveryGroup(
                        recovery,
                        items,
                        durableEntityId
                    );
                    items = coordinatedSingle.items;
                    if (coordinatedSingle.acquired) {
                        fastSnapshotSession = coordinatedSingle.session;
                        acquiredDurableOnlyClaim = true;
                    } else if (!isFileProtocol && coordinatedSingle.attempted) {
                        // A same-id multi WAL may have won this page's shared exact lock
                        // before raw durable ownership proved the id is single. Reconcile
                        // multi first, then retry the authoritative kind.
                        retryDurableSingleAfterMulti = true;
                    }
                }
                if (!isFileProtocol) {
                    const firstRawItemsById = new Map();
                    (Array.isArray(items) ? items : []).forEach((item) => {
                        const id = durableEntityId(item);
                        if (id && !firstRawItemsById.has(id)) firstRawItemsById.set(id, item);
                    });
                    const claimedMultiIds = new Set(claimedMultiWindowSessions
                        .filter(Boolean)
                        .map((session) => String(session.id ?? '')));
                    const claimedMultiBases = new Map();
                    for (const session of claimedMultiWindowSessions) {
                        const baseExamId = String(session && session.baseExamId || '').trim();
                        if (baseExamId && this._ownsMultiSuiteBaseClaim(session)
                            && !claimedMultiBases.has(baseExamId)) {
                            claimedMultiBases.set(baseExamId, session);
                        }
                    }
                    const authoritativeMultiByBase = new Map();
                    for (const candidate of firstRawItemsById.values()) {
                        if (!candidate
                            || candidate.schema !== multiSuiteRecoverySchema
                            || Number(candidate.version) !== 2
                            || !this._isValidMultiSuiteRecoverySnapshot(candidate)
                            || candidate.sessions.length !== 1
                            || durableEntityId(candidate) !== String(candidate.sessions[0].id ?? '')) {
                            continue;
                        }
                        const baseExamId = String(candidate.sessions[0].baseExamId || '').trim();
                        if (!baseExamId) continue;
                        const candidateTime = Number(candidate.sessions[0].lastUpdate)
                            || Date.parse(candidate.updatedAt || '') || 0;
                        const existing = authoritativeMultiByBase.get(baseExamId);
                        if (!existing || candidateTime > existing.time) {
                            authoritativeMultiByBase.set(baseExamId, { candidate, time: candidateTime });
                        }
                    }
                    // Multi-suite is singleton per canonical base, not globally. Claim
                    // exactly the newest valid raw-first identity for each base. A held
                    // newest lease suppresses that base; never fall back to an older id.
                    for (const { candidate } of authoritativeMultiByBase.values()) {
                        const candidateId = durableEntityId(candidate);
                        const baseExamId = String(candidate.sessions[0].baseExamId || '').trim();
                        const baseOwner = claimedMultiBases.get(baseExamId);
                        // HTTP startup may reconcile durable state only for bases proven by
                        // this tab's window WAL. Durable-only bases are claimed lazily by an
                        // explicit completion/restore request so an idle tab cannot starve
                        // the active submitter for every origin-wide recovery entity.
                        if (!baseOwner) continue;
                        if (claimedMultiIds.has(candidateId)) continue;
                        const durableSession = this._cloneSuitePlainObject(candidate.sessions[0]);
                        if (await this._acquireSuiteRecoveryClaim('multi', durableSession)
                            && this._transferMultiSuiteBaseClaim(baseOwner, durableSession)) {
                            // The base now belongs to the authoritative durable identity;
                            // retire the displaced WAL's otherwise-orphaned exact-id lock.
                            if (this._ownsSuiteRecoveryClaim('multi', baseOwner)) {
                                await this._releaseSuiteRecoveryClaim('multi', baseOwner);
                            }
                            durableSession._restoredFromDurableClaim = true;
                            claimedMultiWindowSessions.push(durableSession);
                            claimedMultiIds.add(String(durableSession.id));
                            claimedMultiBases.set(baseExamId, durableSession);
                            acquiredDurableOnlyClaim = true;
                        } else {
                            if (this._ownsSuiteRecoveryClaim('multi', durableSession)) {
                                await this._releaseSuiteRecoveryClaim('multi', durableSession);
                            }
                            // A same-base WAL is not authoritative while the newest durable
                            // identity is live elsewhere. Quarantine it without migration;
                            // a later refresh will retry the durable claim or, if it vanished,
                            // resume the WAL/fence path.
                            for (const windowSession of claimedMultiWindowSessions) {
                                if (!windowSession
                                    || windowSession._restoredFromDurableClaim === true
                                    || String(windowSession.baseExamId || '').trim() !== baseExamId) continue;
                                try {
                                    Object.defineProperty(windowSession, '_suiteRecoveryAuthoritativeClaimDeferred', {
                                        value: true,
                                        writable: true,
                                        configurable: true,
                                        enumerable: false
                                    });
                                } catch (_) {
                                    windowSession._suiteRecoveryAuthoritativeClaimDeferred = true;
                                }
                            }
                        }
                    }
                    // Acquiring may have waited behind a page that finalized/replaced the
                    // entity. Re-read under the exact locks before reconciling or installing.
                    if (acquiredDurableOnlyClaim) items = await recovery.listActiveSessions();
                }
                await this._restorePersistentMultiSuiteSessions(items, claimedMultiWindowSessions);
                if (!isFileProtocol && !fastSnapshotSession && retryDurableSingleAfterMulti) {
                    const retriedSingle = await this._claimDurableSingleRecoveryGroup(
                        recovery,
                        items,
                        durableEntityId
                    );
                    items = retriedSingle.items;
                    if (retriedSingle.acquired) {
                        fastSnapshotSession = retriedSingle.session;
                        acquiredDurableOnlyClaim = true;
                    }
                }
                const fastSnapshotSessionId = fastSnapshotSession && fastSnapshotSession.id != null
                    ? String(fastSnapshotSession.id)
                    : '';
                const scopedItems = singleWindowClaimUnavailable
                    ? []
                    : (Array.isArray(items) ? items : []).filter((item) => (
                        isFileProtocol || (fastSnapshotSessionId
                            && durableEntityId(item) === fastSnapshotSessionId)
                    ));
                const firstDurableItemsById = new Map();
                scopedItems.forEach((item) => {
                    const id = durableEntityId(item);
                    if (id && !firstDurableItemsById.has(id)) firstDurableItemsById.set(id, item);
                });
                const candidates = Array.from(firstDurableItemsById.values())
                    .filter((item) => item
                        && item.schema === 'suite-session-v2'
                        && Number(item.version) === 2
                        && item.id)
                    .sort((left, right) => {
                        const leftTime = Number(left.lastUpdate) || Date.parse(left.updatedAt || '') || 0;
                        const rightTime = Number(right.lastUpdate) || Date.parse(right.updatedAt || '') || 0;
                        return rightTime - leftTime;
                    });
                for (const candidate of candidates) {
                    const restored = this._restoreSessionFromStorage(candidate);
                    if (restored) {
                        restored._lastDurableRecoveryRevision = normalizeRecoveryEntityRevision(candidate.revision);
                        let selected = restored;
                        if (fastSnapshotSession
                            && String(fastSnapshotSession.id) === String(restored.id)
                            && normalizeRecoveryEntityRevision(fastSnapshotSession.revision)
                                > normalizeRecoveryEntityRevision(restored.revision)) {
                            selected = fastSnapshotSession;
                            fastSnapshotSession._lastDurableRecoveryRevision = restored._lastDurableRecoveryRevision;
                            const promoted = await this._commitSuiteRecovery(fastSnapshotSession, {
                                notify: false,
                                reason: 'window-wal-promotion'
                            });
                            if (!promoted) {
                                if (fastSnapshotSession._suiteRecoveryWritesBlocked === true) {
                                    selected = restored;
                                    this._mirrorSuiteRecoverySnapshot(candidate, fastSnapshotSession);
                                } else {
                                    console.warn('[SuitePractice] 最新窗口 WAL 暂未提升到持久 v2 recovery，恢复前将再次重试。');
                                }
                            }
                        }
                        if (fastSnapshotSession && selected !== fastSnapshotSession
                            && !this._transferSuiteRecoveryClaim('single', fastSnapshotSession, selected)) {
                            this._terminalizeSuiteRecoverySession(selected);
                            await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                            return null;
                        }
                        this._installRestoredSuiteSession(selected);
                        this._notifySuiteResumeAvailable(selected);
                        return selected;
                    }
                    if (fastSnapshotSession
                        && durableEntityId(candidate) === fastSnapshotSessionId) {
                        if (fastSnapshotSession._restoredFromDurableClaim === true) {
                            // This clone was valid only in the pre-claim read. If the
                            // refreshed raw first owner is now corrupt, it is not a WAL and
                            // must never repair/expected=0-resurrect itself.
                            await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                            return null;
                        }
                        // The WAL proves this tab owns the exact CAS identity. Repair an
                        // invalid durable payload in place instead of tombstoning it:
                        // AppData discard writes a higher-revision tombstone, so a later
                        // expected=0 migration could never safely restore this WAL.
                        const durableRevision = normalizeRecoveryEntityRevision(candidate.revision);
                        fastSnapshotSession._lastDurableRecoveryRevision = durableRevision;
                        fastSnapshotSession.revision = Math.max(
                            normalizeRecoveryEntityRevision(fastSnapshotSession.revision),
                            durableRevision
                        );
                        const repaired = await this._commitSuiteRecovery(fastSnapshotSession, {
                            notify: false,
                            reason: 'window-wal-repair'
                        });
                        if (!repaired) {
                            if (fastSnapshotSession._suiteRecoveryWritesBlocked === true) {
                                this._clearSessionStorage(fastSnapshotSession);
                                if (this.currentSuiteSession === fastSnapshotSession) {
                                    const ownedId = String(fastSnapshotSession.id);
                                    if (this.suiteExamMap instanceof Map) {
                                        for (const [examId, suiteId] of this.suiteExamMap) {
                                            if (String(suiteId) === ownedId) this.suiteExamMap.delete(examId);
                                        }
                                    }
                                    this.currentSuiteSession = null;
                                }
                                await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                                return null;
                            }
                            console.warn('[SuitePractice] 匹配窗口 WAL 的损坏 durable recovery 暂未修复，保留 WAL 供重试。');
                        }
                        this._installRestoredSuiteSession(fastSnapshotSession);
                        this._notifySuiteResumeAvailable(fastSnapshotSession);
                        return fastSnapshotSession;
                    }
                    if (typeof recovery.discardActiveSession === 'function') {
                        try {
                            const discardReceipt = await recovery.discardActiveSession(candidate.id, {
                                expectedEntityRevision: normalizeRecoveryEntityRevision(candidate.revision)
                            });
                            if (!discardReceipt || discardReceipt.committed !== true) {
                                console.warn('[SuitePractice] 无效 recovery 已被并发更新，跳过清理:', candidate.id);
                            }
                        } catch (discardError) {
                            console.warn('[SuitePractice] 无法清理无效的 v2 套题恢复实体:', discardError);
                        }
                    }
                }
                if (fastSnapshotSession) {
                    const firstOwner = firstDurableItemsById.get(fastSnapshotSessionId);
                    if (firstOwner) {
                        // Another schema owns the AppData findIndex slot for this exact
                        // identity. Never let legacy migration overwrite that first item.
                        const firstOwnerIsMultiSuite = firstOwner.schema === multiSuiteRecoverySchema
                            && Number(firstOwner.version) === 2;
                        const matchingMultiWindowSessions = firstOwnerIsMultiSuite
                            ? pendingMultiWindowSessions.filter((session) => (
                                session && String(session.id ?? '') === fastSnapshotSessionId
                            ))
                            : [];
                        fastSnapshotSession._suiteRecoveryWritesBlocked = true;
                        this._clearSessionStorage(fastSnapshotSession);
                        if (this.currentSuiteSession === fastSnapshotSession) {
                            if (this.suiteExamMap instanceof Map) {
                                for (const [examId, suiteId] of this.suiteExamMap) {
                                    if (String(suiteId) === fastSnapshotSessionId) this.suiteExamMap.delete(examId);
                                }
                            }
                            this.currentSuiteSession = null;
                        }
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        // A duplicated tab can carry both single- and multi-suite WALs with
                        // the same AppData identity. The single WAL is examined first, so it
                        // may temporarily hold the shared lock. Once the durable first owner
                        // proves that identity belongs to multi-suite, retry the quarantined
                        // multi WAL after releasing the wrong-schema claim. Reconcile against
                        // the already refreshed durable list so the authoritative entity is
                        // restored without a stale-read or expected=0 migration window.
                        if (!isFileProtocol && matchingMultiWindowSessions.length) {
                            const retriedMultiWindowSessions = [];
                            for (const session of matchingMultiWindowSessions) {
                                const retrySession = this._cloneSuitePlainObject(session);
                                if (await this._acquireMultiSuiteRecoveryOwnership(retrySession)) {
                                    retriedMultiWindowSessions.push(retrySession);
                                }
                            }
                            if (retriedMultiWindowSessions.length) {
                                await this._restorePersistentMultiSuiteSessions(items, retriedMultiWindowSessions);
                            }
                        }
                        return null;
                    }
                    if (fastSnapshotSession._restoredFromDurableClaim === true) {
                        // The entity vanished after the lock was acquired and the list was
                        // refreshed. Never reinterpret a stale durable clone as an expected=0 WAL.
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        return null;
                    }
                    if (fastSnapshotSession._suiteRecoveryTimestampKnown !== true) {
                        // Unknown-age WAL cannot outlive the durable tombstone horizon.
                        // Keep the bytes quarantined for manual recovery, but never expose
                        // or expected=0-promote it without a trustworthy timestamp.
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        return null;
                    }
                    const fence = await this._readSuiteRecoveryFence(fastSnapshotSession);
                    if (fence.supported && fence.tombstoned) {
                        // A confirmed CAS tombstone proves the prior owner completed
                        // cleanup. Clear the copied WAL instead of resurrecting it.
                        this._removeSuiteRecoveryWindowWal('single', fastSnapshotSession);
                        fastSnapshotSession._suiteRecoveryWritesBlocked = true;
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        return null;
                    }
                    if ((fence.supported && fence.exists)
                        || (!fence.supported && !isFileProtocol)) {
                        // Without a definitive fence result, keep the WAL quarantined.
                        // This avoids both unsafe resurrection and destructive cleanup.
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        return null;
                    }
                    // No durable owner has ever existed for this exact id. This tab now
                    // holds the lock, so expected=0 migration preserves either an
                    // ordinary same-tab crash WAL or a copied-tab pre-first-save WAL.
                    fastSnapshotSession._lastDurableRecoveryRevision = 0;
                    const migrated = await this._commitSuiteRecovery(fastSnapshotSession, {
                        notify: false,
                        reason: 'legacy-window-migration'
                    });
                    if (!migrated) {
                        if (fastSnapshotSession._suiteRecoveryWritesBlocked === true) {
                            this._clearSessionStorage(fastSnapshotSession);
                            await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                            return null;
                        }
                        console.warn('[SuitePractice] 未能将窗口恢复快照迁移到持久 v2 recovery。');
                    }
                    this._installRestoredSuiteSession(fastSnapshotSession);
                    this._notifySuiteResumeAvailable(fastSnapshotSession);
                    return fastSnapshotSession;
                }
                if (this.currentSuiteSession && this.currentSuiteSession._restoredFromStorage === true) {
                    this.currentSuiteSession = null;
                    this._clearSessionStorage();
                }
                return null;
            } catch (error) {
                console.warn('[SuitePractice] 读取持久 v2 套题恢复实体失败:', error);
                if (!isFileProtocol) {
                    // A failed HTTP(S) enumeration is not evidence that durable state is
                    // absent. Fail closed and preserve window WAL bytes for a later retry;
                    // never install or expected=0-migrate a potentially copied snapshot.
                    for (const session of claimedMultiWindowSessions) {
                        const baseExamId = String(session && session.baseExamId || '').trim();
                        if (baseExamId && this.multiSuiteSessionsMap instanceof Map
                            && this.multiSuiteSessionsMap.get(baseExamId) === session) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                        }
                        if (this._ownsSuiteRecoveryClaim('multi', session)) {
                            await this._releaseSuiteRecoveryClaim('multi', session);
                        } else if (this._ownsMultiSuiteBaseClaim(session)) {
                            await this._releaseMultiSuiteBaseClaim(session);
                        }
                    }
                    if (fastSnapshotSession) {
                        if (this.currentSuiteSession === fastSnapshotSession) {
                            this.currentSuiteSession = null;
                        }
                        if (this._ownsSuiteRecoveryClaim('single', fastSnapshotSession)) {
                            await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        }
                    }
                    return null;
                }
                for (const session of claimedMultiWindowSessions) {
                    if (!this._ownsMultiSuiteRecoveryOwnership(session)) continue;
                    if (session._suiteRecoveryLeaseContended === true
                        || session._restoredFromDurableClaim === true) {
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    this.multiSuiteSessionsMap.set(String(session.baseExamId || '').trim(), session);
                }
                if (fastSnapshotSession && this._ownsSuiteRecoveryClaim('single', fastSnapshotSession)) {
                    if (fastSnapshotSession._suiteRecoveryLeaseContended === true
                        || fastSnapshotSession._restoredFromDurableClaim === true) {
                        await this._releaseSuiteRecoveryClaim('single', fastSnapshotSession);
                        fastSnapshotSession = null;
                    } else {
                        this._installRestoredSuiteSession(fastSnapshotSession);
                        this._notifySuiteResumeAvailable(fastSnapshotSession);
                    }
                }
                return fastSnapshotSession;
            }
        },

        async _restorePersistentMultiSuiteSessions(items, windowSessions = []) {
            const rawItems = Array.isArray(items) ? items : [];
            const durableEntityId = (item) => {
                for (const field of ['id', 'sessionId', 'recordId']) {
                    if (item && item[field] !== undefined && item[field] !== null && item[field] !== '') {
                        return String(item[field]);
                    }
                }
                return '';
            };
            const tabOwnedWindowSessionIds = new Set();
            const windowSessionsByBase = new Map();
            for (const session of Array.isArray(windowSessions) ? windowSessions : []) {
                if (!session || session.id == null || !this._ownsMultiSuiteRecoveryOwnership(session)) continue;
                const baseExamId = String(session.baseExamId || '').trim();
                if (!baseExamId) {
                    await this._releaseSuiteRecoveryClaim('multi', session);
                    continue;
                }
                session.baseExamId = baseExamId;
                session._restoredFromWindowSession = true;
                if (!windowSessionsByBase.has(baseExamId)) windowSessionsByBase.set(baseExamId, []);
                windowSessionsByBase.get(baseExamId).push(session);
                const existingBaseSession = this.multiSuiteSessionsMap.get(baseExamId);
                if (!existingBaseSession
                    || (existingBaseSession._restoredFromDurableClaim === true
                        && session._restoredFromDurableClaim !== true)) {
                    // Keep the real window WAL visible until a separately claimed durable
                    // candidate survives the under-lock re-read. A stale durable clone must
                    // not displace the only crash fallback before that confirmation.
                    this.multiSuiteSessionsMap.set(baseExamId, session);
                }
                tabOwnedWindowSessionIds.add(String(session.id));
            }
            const hasWindowOwnerEvidence = (item) => (
                isFileProtocol || tabOwnedWindowSessionIds.has(durableEntityId(item))
            );
            const firstDurableItemsById = new Map();
            // AppData CAS 对整个 active-session 集合使用 findIndex，必须先锁定原始顺序中的首项再筛 schema。
            rawItems.forEach((item) => {
                const id = durableEntityId(item);
                if (id && !firstDurableItemsById.has(id)) firstDurableItemsById.set(id, item);
            });
            const allMultiSuiteItems = rawItems.filter((item) => item
                && item.schema === multiSuiteRecoverySchema
                && Number(item.version) === 2);
            const multiSuiteItems = Array.from(firstDurableItemsById.values())
                .filter((item) => item
                    && item.schema === multiSuiteRecoverySchema
                    && Number(item.version) === 2);
            // 所有 schema/version 匹配 multi-suite 的 durable 条目，无论有效与否，
            // 都代表该 base 曾有持久恢复；有效者覆盖 WAL，损坏者保留 WAL 回退。
            const durableBaseIds = new Set();
            const durableRevisionById = new Map();
            allMultiSuiteItems.forEach((item) => {
                const baseExamId = String(item.sessions && item.sessions[0] && item.sessions[0].baseExamId || '').trim();
                if (baseExamId) durableBaseIds.add(baseExamId);
            });
            multiSuiteItems.forEach((item) => {
                // CAS 所有权采用 AppData 的精确 active-session identity；base 相同并不代表是同一实体。
                const id = durableEntityId(item);
                if (!hasWindowOwnerEvidence(item)) return;
                durableRevisionById.set(id, normalizeRecoveryEntityRevision(item.revision));
            });
            const candidates = multiSuiteItems
                .filter((item) => hasWindowOwnerEvidence(item))
                .filter((item) => this._isValidMultiSuiteRecoverySnapshot(item) && item.sessions.length === 1)
                .filter((item) => durableEntityId(item) === String(item.sessions[0].id ?? ''))
                .sort((left, right) => {
                    const leftTime = Number(left.sessions[0].lastUpdate) || Date.parse(left.updatedAt || '') || 0;
                    const rightTime = Number(right.sessions[0].lastUpdate) || Date.parse(right.updatedAt || '') || 0;
                    return rightTime - leftTime;
                });
            const validDurableIds = new Set(candidates.map((candidate) => durableEntityId(candidate)));
            for (const [baseExamId, baseSessions] of windowSessionsByBase) {
                for (const session of baseSessions) {
                    if (!session || session._restoredFromDurableClaim !== true
                        || validDurableIds.has(String(session.id ?? ''))) continue;
                    if (this.multiSuiteSessionsMap.get(baseExamId) === session) {
                        this.multiSuiteSessionsMap.delete(baseExamId);
                    }
                    if (this._ownsSuiteRecoveryClaim('multi', session)) {
                        await this._releaseSuiteRecoveryClaim('multi', session);
                    }
                }
                if (!this.multiSuiteSessionsMap.has(baseExamId)) {
                    const fallbackWal = baseSessions.find((session) => session
                        && session._restoredFromDurableClaim !== true
                        && this._ownsMultiSuiteRecoveryOwnership(session));
                    if (fallbackWal) this.multiSuiteSessionsMap.set(baseExamId, fallbackWal);
                }
            }
            // durable 完全不存在（v2 枚举确认无此 base 的恢复）时丢弃 window-WAL；
            // durable 存在（无论有效损坏）时保留 WAL 回退：有效者随后覆盖，损坏者避免草稿丢失。
            if (this.multiSuiteSessionsMap instanceof Map) {
                // Older window snapshots may contain whitespace aliases. Canonicalize
                // both key and value before merging so one logical base cannot occupy
                // two Map entries or miss a corrupt-durable preservation marker.
                for (const [storedBaseExamId, session] of Array.from(this.multiSuiteSessionsMap.entries())) {
                    if (!session || session._restoredFromWindowSession !== true) continue;
                    const canonicalBaseExamId = String(session.baseExamId || storedBaseExamId || '').trim();
                    if (!canonicalBaseExamId) {
                        this.multiSuiteSessionsMap.delete(storedBaseExamId);
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    session.baseExamId = canonicalBaseExamId;
                    if (storedBaseExamId !== canonicalBaseExamId) {
                        this.multiSuiteSessionsMap.delete(storedBaseExamId);
                        if (!this.multiSuiteSessionsMap.has(canonicalBaseExamId)) {
                            this.multiSuiteSessionsMap.set(canonicalBaseExamId, session);
                        } else if (this.multiSuiteSessionsMap.get(canonicalBaseExamId) !== session) {
                            await this._releaseSuiteRecoveryClaim('multi', session);
                        }
                    }
                }
                for (const [baseExamId, session] of this.multiSuiteSessionsMap) {
                    if (!session || session._restoredFromWindowSession !== true) continue;
                    const sessionId = String(session.id ?? '');
                    const firstOwner = firstDurableItemsById.get(sessionId);
                    const firstOwnerIsMultiSuite = Boolean(firstOwner
                        && firstOwner.schema === multiSuiteRecoverySchema
                        && Number(firstOwner.version) === 2);
                    if (session._suiteRecoveryAuthoritativeClaimDeferred === true) {
                        // The newest valid durable identity for this base is actively
                        // leased elsewhere (or Locks failed). Keep the serialized WAL for
                        // retry, but do not expose or expected=0-migrate a competing id.
                        this.multiSuiteSessionsMap.delete(baseExamId);
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    if (!firstOwner) {
                        if (session._restoredFromDurableClaim === true) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                            await this._releaseSuiteRecoveryClaim('multi', session);
                            continue;
                        }
                        if (session._suiteRecoveryTimestampKnown !== true) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                            await this._releaseSuiteRecoveryClaim('multi', session);
                            continue;
                        }
                        const fence = await this._readSuiteRecoveryFence(session);
                        if (fence.supported && fence.tombstoned) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                            this._removeSuiteRecoveryWindowWal('multi', session);
                            await this._releaseSuiteRecoveryClaim('multi', session);
                            continue;
                        }
                        if ((fence.supported && fence.exists)
                            || (!fence.supported && !isFileProtocol)) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                            await this._releaseSuiteRecoveryClaim('multi', session);
                            continue;
                        }
                        // The exact lock is now held and no durable owner or tombstone has
                        // ever existed. Preserve any pre-first-save crash WAL by establishing
                        // its initial CAS entity before exposing it as the runtime owner;
                        // a contention marker is not ownership evidence and is not required.
                        session._lastDurableRecoveryRevision = 0;
                        session.revision = Math.max(1, normalizeRecoveryEntityRevision(session.revision));
                        const migrated = await this._commitMultiSuiteRecovery(session);
                        if (!migrated && session._suiteRecoveryWritesBlocked === true) {
                            this.multiSuiteSessionsMap.delete(baseExamId);
                            await this._releaseSuiteRecoveryClaim('multi', session);
                        }
                        continue;
                    }
                    if (session._restoredFromDurableClaim === true
                        && !validDurableIds.has(sessionId)) {
                        // The initial read supplied this clone, but the raw first owner
                        // changed or became invalid after its lock was acquired. It has no
                        // window WAL provenance and therefore cannot be repaired or exposed.
                        this.multiSuiteSessionsMap.delete(baseExamId);
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    // An AppData identity owned by another schema cannot safely be reused.
                    if (firstOwner && !firstOwnerIsMultiSuite) {
                        this.multiSuiteSessionsMap.delete(baseExamId);
                        session._suiteRecoveryWritesBlocked = true;
                        await this._releaseSuiteRecoveryClaim('multi', session);
                        continue;
                    }
                    // A valid durable candidate is authoritative for its exact CAS id and
                    // will be installed below; never retain a second WAL entry for that id.
                    if (validDurableIds.has(sessionId)) {
                        this.multiSuiteSessionsMap.delete(baseExamId);
                        // file: bypasses Web Locks, but the replaced WAL object must still
                        // become terminal. Otherwise an old in-memory reference can commit
                        // after the durable clone has become authoritative.
                        if (isFileProtocol) {
                            await this._releaseSuiteRecoveryClaim('multi', session);
                        }
                        continue;
                    }
                    const durableRevision = durableRevisionById.get(sessionId);
                    if (durableRevision != null) {
                        session._lastDurableRecoveryRevision = durableRevision;
                        session.revision = Math.max(durableRevision, normalizeRecoveryEntityRevision(session.revision));
                    }
                    const canonicalBaseExamId = String(session.baseExamId || baseExamId || '').trim();
                    if (durableRevision == null && !durableBaseIds.has(canonicalBaseExamId)) {
                        this.multiSuiteSessionsMap.delete(baseExamId);
                        await this._releaseSuiteRecoveryClaim('multi', session);
                    }
                }
            }
            const restoredBaseIds = new Set();
            for (const candidate of candidates) {
                const session = this._cloneSuitePlainObject(candidate.sessions[0]);
                const baseExamId = String(session.baseExamId || '').trim();
                if (!baseExamId || restoredBaseIds.has(baseExamId)) continue;
                const previousOwner = this._suiteRecoveryClaimOwner('multi', candidate.id);
                const previousBaseExamId = String(previousOwner && previousOwner.baseExamId || '').trim();
                let reservedAuthoritativeBase = false;
                if (!isFileProtocol && previousOwner && previousBaseExamId !== baseExamId) {
                    reservedAuthoritativeBase = await this._acquireMultiSuiteBaseClaim(session);
                    if (!reservedAuthoritativeBase) {
                        session._suiteRecoveryWritesBlocked = true;
                        await this._releaseSuiteRecoveryClaim('multi', previousOwner);
                        continue;
                    }
                }
                if (!isFileProtocol && (!previousOwner
                    || !this._transferSuiteRecoveryClaim('multi', previousOwner, session))) {
                    session._suiteRecoveryWritesBlocked = true;
                    if (reservedAuthoritativeBase && this._ownsMultiSuiteBaseClaim(session)) {
                        await this._releaseMultiSuiteBaseClaim(session);
                    }
                    if (previousOwner) await this._releaseSuiteRecoveryClaim('multi', previousOwner);
                    continue;
                }
                if (!isFileProtocol && reservedAuthoritativeBase
                    && this._ownsMultiSuiteBaseClaim(previousOwner)) {
                    await this._releaseMultiSuiteBaseClaim(previousOwner);
                }
                const displacedSessions = new Set(windowSessionsByBase.get(baseExamId) || []);
                const currentBaseOwner = this.multiSuiteSessionsMap.get(baseExamId);
                if (currentBaseOwner) displacedSessions.add(currentBaseOwner);
                for (const displaced of displacedSessions) {
                    if (!displaced || displaced === previousOwner || displaced === session) continue;
                    if (isFileProtocol || this._ownsSuiteRecoveryClaim('multi', displaced)) {
                        await this._releaseSuiteRecoveryClaim('multi', displaced);
                    }
                }
                session.baseExamId = baseExamId;
                session._restoredFromWindowSession = true;
                session._lastDurableRecoveryRevision = normalizeRecoveryEntityRevision(candidate.revision);
                session.revision = Math.max(
                    session._lastDurableRecoveryRevision,
                    normalizeRecoveryEntityRevision(session.revision)
                );
                this.multiSuiteSessionsMap.set(baseExamId, session);
                restoredBaseIds.add(baseExamId);
            }
        },

        async _ensureSuiteRecoveryReady() {
            if (!this._suiteModeReady) this.initializeSuiteMode();
            if (this._suiteRecoveryReady && typeof this._suiteRecoveryReady.then === 'function') {
                await this._suiteRecoveryReady;
            }
            return this.currentSuiteSession;
        },

        async _refreshSuiteRecoveryCandidates() {
            if (!this._suiteModeReady) this.initializeSuiteMode();
            if (this._suiteRecoveryReady && typeof this._suiteRecoveryReady.then === 'function') {
                await this._suiteRecoveryReady;
            }
            if (this.currentSuiteSession) return this.currentSuiteSession;
            const restored = this._restoreSessionFromStorage();
            const restoredMulti = this._restoreMultiSuiteSessionsFromStorage({ install: false });
            const refresh = this._restorePersistentSuiteSession(
                restored,
                Array.isArray(restoredMulti) ? restoredMulti : []
            );
            this._suiteRecoveryReady = refresh;
            await refresh;
            return this.currentSuiteSession;
        },

        async getSuiteRecoveryCandidate() {
            await this._ensureSuiteRecoveryReady();
            const session = this.currentSuiteSession;
            if (!session || !['active', 'initializing', 'finalizing'].includes(session.status)) return null;
            const sequence = Array.isArray(session.sequence) ? session.sequence : [];
            const index = Math.min(Math.max(0, Number(session.currentIndex) || 0), Math.max(0, sequence.length - 1));
            const entry = sequence[index] || null;
            return {
                id: session.id,
                status: session.status,
                currentIndex: index,
                total: sequence.length,
                title: entry && entry.exam && entry.exam.title ? entry.exam.title : (entry && entry.examId) || '未完成套题',
                completedCount: Array.isArray(session.results) ? session.results.length : 0
            };
        },

        async abandonSuiteRecovery(expectedSessionId = '') {
            await this._ensureSuiteRecoveryReady();
            const session = this.currentSuiteSession;
            const expectedId = String(expectedSessionId || '').trim();
            if (!session) return expectedId ? false : true;
            if (!expectedId) {
                window.showMessage && window.showMessage('请重新确认要放弃的未完成套题。', 'warning');
                return false;
            }
            if (expectedId && String(session.id) !== expectedId) {
                window.showMessage && window.showMessage('未完成套题已发生变化，请重新确认要放弃的套题。', 'warning');
                return false;
            }
            return this._abortSuiteSession(session, { reason: 'user_discard' });
        },

        async startSuitePractice(options = {}) {
            const suiteWindowName = 'ielts-suite-mode-tab';

            try {
                if (!this._suiteModeReady) {
                    this.initializeSuiteMode();
                }
                await this._ensureSuiteRecoveryReady();
                if (!this.currentSuiteSession) {
                    // A previous startup scan may have observed an active owner holding
                    // the authoritative durable lease. An explicit start is also a retry:
                    // rescan so a crashed/closed owner can be taken over instead of
                    // immediately creating a conflicting new singleton id.
                    await this._refreshSuiteRecoveryCandidates();
                }
                const recoveryAction = String(options.recoveryAction || '').trim().toLowerCase();
                const recoverySessionId = String(options.recoverySessionId || '').trim();
                const suitePreference = this._resolveSuitePreference(options);
                const flowMode = suitePreference.flowMode;
                const frequencyScope = suitePreference.frequencyScope;

                if (this.currentSuiteSession && ['active', 'initializing', 'finalizing'].includes(this.currentSuiteSession.status)) {
                    if ((recoveryAction === 'restart' || recoveryAction === 'discard'
                        || recoveryAction === 'continue' || recoveryAction === 'resume')
                        && !recoverySessionId) {
                        window.showMessage && window.showMessage('未完成套题已发生变化，请重新选择。', 'warning');
                        return false;
                    }
                    if (recoverySessionId && String(this.currentSuiteSession.id) !== recoverySessionId) {
                        window.showMessage && window.showMessage('未完成套题已发生变化，请重新选择。', 'warning');
                        return false;
                    }
                    if (recoveryAction === 'restart' || recoveryAction === 'discard') {
                        const abandoned = await this._abortSuiteSession(this.currentSuiteSession, { reason: 'user_discard' });
                        if (!abandoned || this.currentSuiteSession) {
                            window.showMessage && window.showMessage('未能安全清除上次套题，暂未创建新套题。', 'error');
                            return false;
                        }
                    } else if (recoveryAction === 'continue' || recoveryAction === 'resume') {
                        return this.resumeSuitePractice(recoverySessionId);
                    } else {
                        window.showMessage && window.showMessage('检测到未完成套题，请先选择继续或放弃并新建。', 'warning');
                        return false;
                    }
                }

                if (frequencyScope === 'custom') {
                    const enteredCustomMode = await this._startCustomSuiteSelection({
                        flowMode,
                        frequencyScope,
                        suiteWindowName
                    });
                    if (!enteredCustomMode && typeof global.loadExamList === 'function') {
                        try {
                            global.loadExamList();
                        } catch (_) {}
                    }
                    return;
                }

                if (typeof this.openExam !== 'function') {
                    window.showMessage && window.showMessage('当前版本暂不支持套题练习自动打开题目。', 'error');
                    return;
                }

                const examIndex = await this._fetchSuiteExamIndex();
                if (!examIndex.length) {
                    window.showMessage && window.showMessage('题库为空，无法开启套题练习。', 'warning');
                    return;
                }

                const normalizedIndex = examIndex
                    .map(item => {
                        if (!item || typeof item !== 'object') {
                            return null;
                        }
                        const normalizedType = (item.type || 'reading').toLowerCase();
                        const normalizedCategory = typeof item.category === 'string'
                            ? item.category.trim().toUpperCase()
                            : '';
                        if (normalizedType !== 'reading') {
                            return null;
                        }
                        return {
                            ...item,
                            type: 'reading',
                            category: normalizedCategory
                        };
                    })
                    .filter(Boolean);

                const frequencyFilteredIndex = normalizedIndex.filter(item => (
                    this._isSuiteFrequencyIncluded(item && item.frequency, frequencyScope)
                ));
                const practicedExamIds = await this._collectPracticedReadingExamIds();

                const categories = ['P1', 'P2', 'P3'];
                const sequence = [];
                for (const category of categories) {
                    const pool = frequencyFilteredIndex.filter(item => item.category === category);
                    if (!pool.length) {
                        const scopeLabel = frequencyScope === 'high'
                            ? '仅高频'
                            : (frequencyScope === 'high_medium' ? '高频+次高频' : '全部频率');
                        window.showMessage && window.showMessage('当前抽题范围（' + scopeLabel + '）缺少 ' + category + ' 阅读题目，无法开启套题练习。', 'warning');
                        return;
                    }
                    const unpracticedPool = pool.filter(item => !practicedExamIds.has(String(item.id)));
                    const selectionPool = unpracticedPool.length ? unpracticedPool : pool;
                    if (!unpracticedPool.length) {
                        const scopeLabel = frequencyScope === 'high'
                            ? '仅高频'
                            : (frequencyScope === 'high_medium' ? '高频+次高频' : '全部频率');
                        window.showMessage && window.showMessage(
                            '当前抽题范围（' + scopeLabel + '）中的 ' + category + ' 已全部练习过，已自动放宽为允许重复抽题。',
                            'warning'
                        );
                    }
                    const picked = selectionPool[Math.floor(Math.random() * selectionPool.length)];
                    sequence.push({ examId: picked.id, exam: picked });
                }

                const started = await this._launchSuiteSessionFromSequence(sequence, {
                    flowMode,
                    frequencyScope,
                    suiteWindowName,
                    launchLabel: flowMode === 'stationary'
                        ? '驻足模式'
                        : (flowMode === 'simulation' ? '模拟模式' : '经典模式')
                });
                return started;
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                if (this.currentSuiteSession && ['active', 'initializing'].includes(this.currentSuiteSession.status)) {
                    this.currentSuiteSession.windowRef = null;
                    this.currentSuiteSession._restoredFromStorage = true;
                    this.currentSuiteSession.lastUpdate = Date.now();
                    await this._commitSuiteRecovery(this.currentSuiteSession, { notify: false, reason: 'startup-error' });
                    window.showMessage && window.showMessage('首篇窗口未能打开，套题恢复快照已保留，可稍后重试。', 'warning');
                }
                return false;
            }
        },
        async handleSuitePracticeComplete(examId, data, sourceWindow = null) {
            const withSubmitOutcome = (handled, committed = handled, errorCode = '', extra = null) => (
                data && data.submissionId
                    ? Object.assign({
                        handled: Boolean(handled),
                        committed: Boolean(committed),
                        errorCode: errorCode || null
                    }, extra || {})
                    : Boolean(handled)
            );
            const completionWindowInfo = this.examWindows && this.examWindows.get(examId);
            const completionRegistration = completionWindowInfo
                && (!sourceWindow || completionWindowInfo.window === sourceWindow)
                && typeof this._captureExamSessionRegistration === 'function'
                ? this._captureExamSessionRegistration(examId, completionWindowInfo)
                : null;
            // Freeze the target launch before this event yields. Otherwise an ordinary
            // launch can win the shared named tab while persistence is pending, only for
            // this older completion continuation to begin a newer launch and steal it back.
            let preflightLaunch = null;
            const preflightSession = this.currentSuiteSession;
            if (preflightSession
                && preflightSession.status === 'active'
                && !(data && data.suiteId)
                && !(data && data.suiteSubmission === true)
                && Array.isArray(preflightSession.sequence)) {
                const preflightExamId = String(examId || '');
                const preflightActiveExamId = String(preflightSession.activeExamId || '');
                const preflightIndex = preflightSession.sequence.findIndex((entry) => (
                    entry && String(entry.examId) === preflightExamId
                ));
                const autoAdvance = this._shouldAutoAdvanceAfterSubmit();
                const targetIndex = preflightIndex + 1;
                const targetEntry = autoAdvance && preflightIndex >= 0
                    ? preflightSession.sequence[targetIndex]
                    : null;
                const reuseWindow = sourceWindow && !sourceWindow.closed
                    ? sourceWindow
                    : (preflightSession.windowRef && !preflightSession.windowRef.closed
                        ? preflightSession.windowRef
                        : null);
                if ((!preflightActiveExamId || preflightActiveExamId === preflightExamId)
                    && targetEntry && targetEntry.examId) {
                    const windowName = preflightSession.windowName || 'ielts-suite-mode-tab';
                    preflightLaunch = {
                        session: preflightSession,
                        targetExamId: String(targetEntry.examId),
                        targetIndex,
                        windowName,
                        reuseWindow,
                        ownership: this._beginSuiteExamLaunchOwnership(targetEntry.examId, { windowName })
                    };
                }
            }
            await this._ensureSuiteRecoveryReady();
            // First check whether this is multi-suite mode (detected via suiteId).
            if (data && data.suiteId) {
                const committed = await this.handleMultiSuitePracticeComplete(examId, data);
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed');
            }
            if (data && data.suiteSubmission === true && typeof this._handleInlineSimulationSuiteSubmit === 'function') {
                return await this._handleInlineSimulationSuiteSubmit(examId, data, sourceWindow);
            }

            const session = this.currentSuiteSession;
            if (!session || !await this._ensureSuiteRecoveryClaim('single', session)) {
                return false;
            }
            if (this.currentSuiteSession !== session
                || !this._ownsSuiteRecoveryClaim('single', session)) {
                return false;
            }

            const payloadSuiteSessionId = (data && typeof data.suiteSessionId === 'string')
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }
            if (session.status === 'finalizing') {
                session._finalizeSubmissionId = data && data.submissionId
                    ? String(data.submissionId)
                    : (session._finalizeSubmissionId || null);
                const committed = await this._finalizeSuiteRecordWithGate(session, {
                    deferTeardown: Boolean(
                        session._finalizeSubmissionId
                        && sourceWindow
                        && !sourceWindow.closed
                    )
                });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', data && data.submissionId ? {
                    teardownSession: committed ? session : null
                } : null);
            }
            if (session.status === 'completed') {
                return withSubmitOutcome(true, true, '', data && data.submissionId ? {
                    teardownSession: session
                } : null);
            }
            if (session.status !== 'active') {
                return withSubmitOutcome(true, false, 'suite_finalizing');
            }

            const mappingMissing = !this.suiteExamMap || !this.suiteExamMap.has(examId);
            if (mappingMissing && typeof this._registerSuiteSequence === 'function') {
                this._registerSuiteSequence(session);
            }

            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            const inActiveSequence = Array.isArray(session.sequence)
                ? session.sequence.some(item => item && item.examId === examId)
                : false;
            if ((mappedSessionId && mappedSessionId !== session.id) || (!mappedSessionId && !inActiveSequence)) {
                return false;
            }

            const sequenceEntry = session.sequence.find(item => item.examId === examId);
            if (!sequenceEntry) {
                await this._abortSuiteSession(session, { reason: 'missing_sequence' });
                return false;
            }

            const activeExamId = session.activeExamId ? String(session.activeExamId) : '';
            if (activeExamId && activeExamId !== String(examId)) {
                console.warn('[SuitePractice] 忽略非当前活动篇章的提交，防止错篇结算。', {
                    activeExamId,
                    submittedExamId: examId,
                    sessionId: session.id
                });
                return withSubmitOutcome(true, false, 'inactive_suite_exam');
            }

            const derivedDuration = this._deriveSuiteExamElapsedSeconds(session, examId, data && data.duration);
            const normalized = this._normalizeSuiteResult(sequenceEntry.exam, Object.assign({}, data, {
                duration: derivedDuration
            }));
            this._upsertSuiteResult(session, examId, normalized);
            this._syncSuiteTimerFromPayload(session, data);
            session.lastUpdate = Date.now();

            this._persistSuiteDraftSnapshot(session, examId, data);
            if (Number.isFinite(Number(data && data.duration))) {
                session.elapsedByExam[examId] = derivedDuration;
            }

            const currentIndex = session.sequence.findIndex(item => item.examId === examId);
            if (currentIndex < 0) {
                await this._abortSuiteSession(session, { reason: 'missing_sequence_index' });
                return false;
            }
            const previousIndex = session.currentIndex;
            const previousActiveExamId = session.activeExamId;
            const previousPendingAdvance = session.pendingAdvance;
            const shouldAutoAdvance = this._shouldAutoAdvanceAfterSubmit();
            if (!shouldAutoAdvance) {
                session.currentIndex = currentIndex;
                session.activeExamId = examId;
                const tentativePendingAdvance = {
                    completedExamId: examId,
                    finalReview: currentIndex >= session.sequence.length - 1,
                    updatedAt: Date.now()
                };
                session.pendingAdvance = tentativePendingAdvance;
                let passageDurableReceiptConfirmed = false;
                const committed = await this._commitSuiteRecovery(session, {
                    reason: 'passage-submit',
                    onDurableReceipt: () => { passageDurableReceiptConfirmed = true; }
                });
                if (!committed) {
                    if (!passageDurableReceiptConfirmed
                        && this.currentSuiteSession === session
                        && session.currentIndex === currentIndex
                        && String(session.activeExamId || '') === String(examId)
                        && session.pendingAdvance === tentativePendingAdvance) {
                        session.currentIndex = previousIndex;
                        session.activeExamId = previousActiveExamId;
                        session.pendingAdvance = previousPendingAdvance;
                    }
                    return passageDurableReceiptConfirmed
                        ? withSubmitOutcome(true, true, 'suite_advance_superseded')
                        : withSubmitOutcome(true, false, 'suite_recovery_save_failed');
                }
                if (!this._canContinueSuiteOperation(session)) {
                    return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
                }
                if (preflightLaunch && (preflightLaunch.session !== session
                    || preflightLaunch.targetIndex !== currentIndex
                    || preflightLaunch.targetExamId !== String(examId)
                    || !this._isSuiteExamLaunchOwnershipCurrent(
                        examId,
                        preflightLaunch.ownership,
                        preflightLaunch.reuseWindow
                    ))) {
                    return withSubmitOutcome(true, false, 'suite_advance_superseded');
                }
                this.updateExamStatus && this.updateExamStatus(examId, 'completed');
                const replayWindow = sourceWindow && !sourceWindow.closed
                    ? sourceWindow
                    : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
                if (replayWindow) {
                    await this._sendSuiteReviewState(session, examId, replayWindow);
                }
                if (!this._canContinueSuiteOperation(session)) {
                    return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
                }
                return withSubmitOutcome(true, true);
            }

            session.currentIndex = currentIndex + 1;
            session.activeExamId = session.currentIndex < session.sequence.length
                ? session.sequence[session.currentIndex].examId
                : null;
            session.pendingAdvance = null;
            let passageDurableReceiptConfirmed = false;
            const committed = await this._commitSuiteRecovery(session, {
                reason: 'passage-submit',
                onDurableReceipt: () => { passageDurableReceiptConfirmed = true; }
            });
            if (!committed) {
                const tentativeNext = session.sequence[currentIndex + 1];
                if (!passageDurableReceiptConfirmed
                    && this.currentSuiteSession === session
                    && session.currentIndex === currentIndex + 1
                    && String(session.activeExamId || '') === String(tentativeNext && tentativeNext.examId || '')
                    && session.pendingAdvance === null) {
                    session.currentIndex = previousIndex;
                    session.activeExamId = previousActiveExamId;
                    session.pendingAdvance = previousPendingAdvance;
                }
                return passageDurableReceiptConfirmed
                    ? withSubmitOutcome(true, true, 'suite_advance_superseded')
                    : withSubmitOutcome(true, false, 'suite_recovery_save_failed');
            }
            if (!this._canContinueSuiteOperation(session)) {
                return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
            }
            const nextEntry = session.currentIndex < session.sequence.length
                ? session.sequence[session.currentIndex]
                : null;
            if (nextEntry && preflightLaunch && (preflightLaunch.session !== session
                || preflightLaunch.targetIndex !== session.currentIndex
                || preflightLaunch.targetExamId !== String(nextEntry.examId)
                    || !this._isSuiteExamLaunchOwnershipCurrent(
                        nextEntry.examId,
                        preflightLaunch.ownership
                    ))) {
                return withSubmitOutcome(true, true, 'suite_advance_superseded');
            }
            if (nextEntry && preflightLaunch && preflightLaunch.reuseWindow
                && (!this._claimSuiteExamLaunchWindow(
                    preflightLaunch.ownership,
                    preflightLaunch.reuseWindow
                ) || !this._isSuiteExamLaunchOwnershipCurrent(
                    nextEntry.examId,
                    preflightLaunch.ownership,
                    preflightLaunch.reuseWindow
                ))) {
                return withSubmitOutcome(true, true, 'suite_advance_superseded');
            }
            this.updateExamStatus && this.updateExamStatus(examId, 'completed');

            // Last passage -> finalize the entire simulation
            if (session.currentIndex >= session.sequence.length) {
                const deferTeardown = Boolean(data && data.submissionId && sourceWindow && !sourceWindow.closed);
                session._finalizeSubmissionId = data && data.submissionId ? String(data.submissionId) : null;
                const committed = await this._finalizeSuiteRecordWithGate(session, { deferTeardown });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', deferTeardown ? {
                    teardownSession: session
                } : null);
            }

            // Not last -> advance to next passage
            if (typeof this.cleanupExamSession === 'function') {
                try {
                    if (completionRegistration) {
                        await this.cleanupExamSession(examId, {
                            expectedRegistration: completionRegistration,
                            recoverySessionId: completionRegistration.expectedSessionId
                        });
                    } else if (!(this.examWindows instanceof Map)) {
                        // Compatibility for lightweight hosts without managed registrations.
                        await this.cleanupExamSession(examId);
                    }
                } catch (cleanupError) {
                    console.warn('[SuitePractice] 清理上一篇会话失败:', cleanupError);
                }
            }
            if (!this._canContinueSuiteOperation(session)) {
                return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
            }

            const advanced = await this._advanceSuiteToNext(session, sequenceEntry.exam.title, examId, preflightLaunch ? {
                launchOwnership: preflightLaunch.ownership,
                windowName: preflightLaunch.windowName,
                reuseWindow: preflightLaunch.reuseWindow
            } : {});
            if (!this._canContinueSuiteOperation(session)) {
                return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
            }
            return withSubmitOutcome(true, true, advanced ? '' : 'suite_advance_failed');
        },

        async continueSuitePractice() {
            // Legacy stub - simulation mode auto-advances, but kept for backward compat
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') {
                return false;
            }
            if (!(session.currentIndex < session.sequence.length)) {
                return false;
            }
            return this._advanceSuiteToNext(session, 'previous section', null);
        },

        async resumeSuitePractice(expectedSessionId = '') {
            const expectedId = String(expectedSessionId || '').trim();
            if (!this._suiteResumeEntryPromises) this._suiteResumeEntryPromises = new Map();
            const existingEntry = this._suiteResumeEntryPromises.get(expectedId);
            if (existingEntry && existingEntry.promise
                && typeof existingEntry.promise.then === 'function') {
                return existingEntry.promise;
            }
            let resolveEntryPromise;
            let rejectEntryPromise;
            const entryPromise = new Promise((resolve, reject) => {
                resolveEntryPromise = resolve;
                rejectEntryPromise = reject;
            });
            const entryRecord = { promise: entryPromise };
            // Publish the per-entity entry gate before initialization, recovery, or
            // launch reservation can yield. A second resume must join this exact
            // continuation instead of superseding its pre-await ownership token.
            this._suiteResumeEntryPromises.set(expectedId, entryRecord);
            const runResumeEntry = async () => {
            if (!this._suiteModeReady && !this.currentSuiteSession) this.initializeSuiteMode();
            const currentPreflightSession = this.currentSuiteSession;
            if (currentPreflightSession && currentPreflightSession._resumePromise
                && typeof currentPreflightSession._resumePromise.then === 'function'
                && (!expectedId || String(currentPreflightSession.id) === expectedId)) {
                return currentPreflightSession._resumePromise;
            }
            const storedPreflightSession = !currentPreflightSession && expectedId
                ? this._restoreSessionFromStorage()
                : null;
            const preflightSession = currentPreflightSession
                && expectedId
                && String(currentPreflightSession.id) === expectedId
                ? currentPreflightSession
                : (storedPreflightSession && String(storedPreflightSession.id) === expectedId
                    ? storedPreflightSession
                    : null);
            const preflightSequence = preflightSession && Array.isArray(preflightSession.sequence)
                ? preflightSession.sequence
                : [];
            const preflightTarget = preflightSession
                && (preflightSession.status === 'finalizing'
                    || Number(preflightSession.currentIndex) >= preflightSequence.length)
                ? preflightSequence.find((entry) => entry && preflightSession.windowBinding
                    && String(entry.examId) === String(preflightSession.windowBinding.examId || ''))
                : (preflightSession ? preflightSequence[preflightSession.currentIndex] : null);
            let resumeLaunch = null;
            if (preflightSession && preflightTarget && preflightTarget.examId) {
                const baseWindowName = preflightSession.windowName || 'ielts-suite-mode-tab';
                const windowName = preflightSession._suiteWindowNameConflict
                    ? `${baseWindowName}-${preflightSession.id}`
                    : baseWindowName;
                const reuseWindow = preflightSession.windowRef && !preflightSession.windowRef.closed
                    ? preflightSession.windowRef
                    : null;
                const ownership = this._beginSuiteExamLaunchOwnership(preflightTarget.examId, {
                    windowName,
                    reuseWindow
                });
                let launchAccepted = false;
                try {
                    if (ownership && this._isSuiteExamLaunchOwnershipCurrent(
                        preflightTarget.examId,
                        ownership,
                        reuseWindow
                    )) {
                        resumeLaunch = {
                            session: preflightSession,
                            targetExamId: String(preflightTarget.examId),
                            windowName,
                            reuseWindow,
                            ownership
                        };
                        launchAccepted = true;
                    }
                } finally {
                    // This validation runs before the outer resume try/finally.  If
                    // begin succeeded but the target changed synchronously, do not
                    // strand an untracked exam/name/WindowProxy reservation.
                    if (ownership && !launchAccepted
                        && typeof this._rollbackExamLaunchOwnership === 'function') {
                        this._rollbackExamLaunchOwnership(ownership);
                    }
                }
            }
            const snapshotOwnershipMap = (ownershipMap) => new Map(
                ownershipMap && typeof ownershipMap.entries === 'function'
                    ? Array.from(ownershipMap.entries())
                    : []
            );
            const resumeEntryOwnershipEpoch = {
                sequence: Number(this._examLaunchOwnershipSequence) || 0,
                examOwners: snapshotOwnershipMap(this._examLaunchOwnerships),
                targetOwners: snapshotOwnershipMap(this._examLaunchTargetOwnerships)
            };
            const ownershipEpochStillCurrent = (targetEntry, windowName, reuseWindow = null) => {
                if (!targetEntry || !targetEntry.examId
                    || Number(this._examLaunchOwnershipSequence || 0) !== resumeEntryOwnershipEpoch.sequence) {
                    return false;
                }
                const targetExamId = String(targetEntry.examId);
                const currentExamOwner = this._examLaunchOwnerships
                    && this._examLaunchOwnerships.get(targetExamId) || null;
                const frozenExamOwner = resumeEntryOwnershipEpoch.examOwners.get(targetExamId) || null;
                if (currentExamOwner !== frozenExamOwner) return false;
                const targetLeaseKeys = typeof this._resolveExamLaunchTargetLeaseKeys === 'function'
                    ? this._resolveExamLaunchTargetLeaseKeys(targetExamId, { windowName, reuseWindow })
                    : [`window-name:${String(windowName || '').trim()}`];
                return Array.from(targetLeaseKeys || []).every((targetLeaseKey) => {
                    const currentTargetOwner = this._examLaunchTargetOwnerships
                        && this._examLaunchTargetOwnerships.get(targetLeaseKey) || null;
                    const frozenTargetOwner = resumeEntryOwnershipEpoch.targetOwners.get(targetLeaseKey) || null;
                    return currentTargetOwner === frozenTargetOwner;
                });
            };
            const rollbackResumeLaunch = () => {
                const ownership = resumeLaunch && resumeLaunch.ownership;
                if (!ownership || typeof this._rollbackExamLaunchOwnership !== 'function') return false;
                return this._rollbackExamLaunchOwnership(ownership) === true;
            };

            try {
                if (this._suiteRecoveryReady && typeof this._suiteRecoveryReady.then === 'function') {
                    await this._suiteRecoveryReady;
                }
                const session = this.currentSuiteSession;
                if (!session || !['active', 'initializing', 'finalizing'].includes(session.status)) {
                    return false;
                }
                if (!expectedId) {
                    window.showMessage && window.showMessage('请重新选择要继续的未完成套题。', 'warning');
                    return false;
                }
                if (String(session.id) !== expectedId) {
                    window.showMessage && window.showMessage('未完成套题已发生变化，请重新选择。', 'warning');
                    return false;
                }
                if (session._resumePromise && typeof session._resumePromise.then === 'function') {
                    return session._resumePromise;
                }

                const resolveResumeLaunch = (targetEntry) => {
                    if (!targetEntry || !targetEntry.examId) return null;
                    const baseWindowName = session.windowName || 'ielts-suite-mode-tab';
                    const windowName = session._suiteWindowNameConflict
                        ? `${baseWindowName}-${session.id}`
                        : baseWindowName;
                    const reuseWindow = session.windowRef && !session.windowRef.closed
                        ? session.windowRef
                        : null;
                    if (resumeLaunch) {
                        if (String(resumeLaunch.session && resumeLaunch.session.id || '') !== String(session.id)
                            || resumeLaunch.targetExamId !== String(targetEntry.examId)
                            || resumeLaunch.windowName !== windowName
                            || resumeLaunch.reuseWindow !== reuseWindow
                            || !resumeLaunch.ownership
                            || !this._isSuiteExamLaunchOwnershipCurrent(
                                targetEntry.examId,
                                resumeLaunch.ownership,
                                resumeLaunch.reuseWindow
                            )) {
                            return null;
                        }
                        resumeLaunch.session = session;
                        return resumeLaunch;
                    }
                    if (!ownershipEpochStillCurrent(targetEntry, windowName, reuseWindow)) return null;
                    const ownership = this._beginSuiteExamLaunchOwnership(targetEntry.examId, {
                        windowName,
                        reuseWindow
                    });
                    if (!ownership || !this._isSuiteExamLaunchOwnershipCurrent(
                        targetEntry.examId,
                        ownership,
                        reuseWindow
                    )) {
                        if (ownership && typeof this._rollbackExamLaunchOwnership === 'function') {
                            this._rollbackExamLaunchOwnership(ownership);
                        }
                        return null;
                    }
                    resumeLaunch = {
                        session,
                        targetExamId: String(targetEntry.examId),
                        windowName,
                        reuseWindow,
                        ownership
                    };
                    return resumeLaunch;
                };

                const resumePromise = (async () => {
                const sequence = Array.isArray(session.sequence) ? session.sequence : [];
                if (!sequence.length) {
                    window.showMessage && window.showMessage('未完成套题缺少可恢复的题序，恢复数据仍会保留；如需重新开始，请选择“放弃并新建”。', 'warning');
                    return false;
                }

                // A terminal snapshot is deliberately never clamped back to P3. The
                // aggregate record and operation id are replayed until v2 confirms it.
                if (session.status === 'finalizing' || session.currentIndex >= sequence.length) {
                    const boundEntry = session.windowBinding && sequence.find((entry) => (
                        entry && String(entry.examId) === String(session.windowBinding.examId || '')
                    ));
                    const finalizingLaunch = boundEntry ? resolveResumeLaunch(boundEntry) : null;
                    if (boundEntry && !finalizingLaunch) return false;
                    session.status = 'finalizing';
                    session.currentIndex = sequence.length;
                    session.activeExamId = null;
                    if (!await this._commitSuiteRecovery(session, { reason: 'finalize-resume' })) {
                        return false;
                    }
                    if (!session.windowRef && boundEntry) {
                        const rebound = finalizingLaunch
                            ? await this._tryRebindSuiteWindow(session, boundEntry, finalizingLaunch)
                            : null;
                        if (rebound && rebound.window && !rebound.window.closed) {
                            finalizingLaunch.ownership = rebound.ownership || finalizingLaunch.ownership;
                            session.windowRef = rebound.window;
                        }
                    }
                    return this._finalizeSuiteRecordWithGate(session, { fromRecovery: true });
                }
                if (typeof this.openExam !== 'function') return false;

                const initialTargetEntry = sequence[session.currentIndex];
                const activeLaunch = resolveResumeLaunch(initialTargetEntry);
                if (!activeLaunch) return false;
                let currentExamIndex = null;
                if (session._restoredFromStorage === true && typeof this._fetchSuiteExamIndex === 'function') {
                    try {
                        currentExamIndex = await this._fetchSuiteExamIndex();
                    } catch (validationError) {
                        console.warn('[SuitePractice] 无法验证恢复目标，保留快照供稍后重试:', validationError);
                        window.showMessage && window.showMessage('暂时无法读取当前题库，未完成套题仍会保留。', 'warning');
                        return false;
                    }
                    if (!this._isSuiteExamLaunchOwnershipCurrent(
                        activeLaunch.targetExamId,
                        activeLaunch.ownership,
                        activeLaunch.reuseWindow
                    )) return false;
                    if (Array.isArray(currentExamIndex)) {
                        const byId = new Map(currentExamIndex.map((entry) => {
                            const id = entry && (entry.id ?? entry.examId);
                            return id == null ? null : [String(id), entry];
                        }).filter(Boolean));
                        const targetId = String(sequence[session.currentIndex].examId);
                        const missingSequenceEntry = sequence.some((entry) => !byId.has(String(entry.examId)));
                        if (missingSequenceEntry || !byId.has(targetId)) {
                            window.showMessage && window.showMessage('未完成套题与当前题库不一致，恢复数据仍会保留；如需重新开始，请选择“放弃并新建”。', 'warning');
                            return false;
                        }
                        session.sequence = sequence.map((entry) => {
                            const indexed = byId.get(String(entry.examId));
                            return indexed
                                ? { ...entry, exam: indexed, title: entry.title || indexed.title, category: entry.category || indexed.category }
                                : entry;
                        });
                    }
                }

                const targetEntry = session.sequence[session.currentIndex];
                if (!targetEntry || !targetEntry.examId) return false;
                if (String(targetEntry.examId) !== activeLaunch.targetExamId
                    || !this._isSuiteExamLaunchOwnershipCurrent(
                        targetEntry.examId,
                        activeLaunch.ownership,
                        activeLaunch.reuseWindow
                    )) return false;
                session.status = 'active';
                session.activeExamId = targetEntry.examId;
                session.windowRef = null;
                session.lastUpdate = Date.now();
                const resumeStillOwned = () => this.currentSuiteSession === session
                    && session.status === 'active'
                    && String(session.activeExamId || '') === String(targetEntry.examId)
                    && this._isSuiteExamLaunchOwnershipCurrent(
                        targetEntry.examId,
                        activeLaunch.ownership,
                        activeLaunch.reuseWindow
                    );
                if (!await this._commitSuiteRecovery(session, {
                    reason: 'suite-resume',
                    commitGuard: resumeStillOwned
                }) || !resumeStillOwned()) {
                    return false;
                }

                let examWindow = null;
                let reboundExistingWindow = false;
                let targetRegistration = null;
                const installedRegistrationStillCurrent = (targetWindow = null) => Boolean(
                    targetRegistration
                    && (!targetWindow || targetRegistration.window === targetWindow)
                    && !targetRegistration.window.closed
                    && this._isSuiteNavigationRegistrationCurrent(
                        targetEntry.examId,
                        targetRegistration,
                        session
                    )
                );
                const hadWindowNameConflict = session._suiteWindowNameConflict === true;
                const rebound = session.windowBinding
                    ? await this._tryRebindSuiteWindow(session, targetEntry, activeLaunch)
                    : {
                        window: null,
                        ownership: activeLaunch.ownership,
                        fallbackAllowed: true
                    };
                let rebindFallbackAllowed = false;
                if (rebound && rebound.window && !rebound.window.closed) {
                    activeLaunch.ownership = rebound.ownership || activeLaunch.ownership;
                    examWindow = rebound.window;
                    targetRegistration = rebound.registration || null;
                    if (!installedRegistrationStillCurrent(examWindow)) return false;
                    reboundExistingWindow = true;
                } else if (rebound
                    && rebound.fallbackAllowed === true
                    && rebound.ownership === activeLaunch.ownership
                    && resumeStillOwned()) {
                    rebindFallbackAllowed = true;
                } else {
                    return false;
                }
                if (!examWindow && !hadWindowNameConflict && session._suiteWindowNameConflict === true) {
                    // The named window proved it belongs to another page. This launch only
                    // reserved the old name, so abort and let an explicit retry reserve the
                    // conflict-safe suffix before opening anything.
                    return false;
                }
                try {
                    if (!examWindow && rebindFallbackAllowed && resumeStillOwned()) {
                        const openOptions = {
                        target: 'tab',
                        examDefinition: targetEntry.exam,
                        windowName: activeLaunch.windowName,
                        suiteSessionId: session.id,
                        suiteFlowMode: session.flowMode || 'simulation',
                        suiteTimerMode: session.suiteTimerMode || 'countdown',
                        suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds))
                            ? Number(session.suiteTimerLimitSeconds)
                            : 3600,
                        sequenceIndex: session.currentIndex,
                        sequenceTotal: session.sequence.length
                        };
                        if (activeLaunch.ownership) openOptions.launchOwnership = activeLaunch.ownership;
                        examWindow = await this.openExam(targetEntry.examId, openOptions);
                        if (examWindow && !examWindow.closed) {
                            targetRegistration = this._captureSuiteNavigationRegistration(
                                targetEntry.examId,
                                examWindow,
                                session,
                                activeLaunch.ownership
                            );
                        }
                    }
                } catch (error) {
                    console.warn('[SuitePractice] 恢复套题窗口失败:', error);
                }
                if (!examWindow || examWindow.closed
                    || !installedRegistrationStillCurrent(examWindow)) {
                    session.windowRef = null;
                    session._restoredFromStorage = true;
                    window.showMessage && window.showMessage('未能打开未完成套题，请检查弹窗权限后再次点击套题模式。', 'warning');
                    return false;
                }

                session.windowRef = examWindow;
                session._restoredFromStorage = false;
                this._ensureSuiteWindowGuard(session, examWindow);
                this._focusSuiteWindow(examWindow);
                if (reboundExistingWindow) {
                    const reboundReady = await this._waitForSuiteWindowExamReady(session, targetEntry.examId, examWindow);
                    if (!installedRegistrationStillCurrent(examWindow)) return false;
                    if (!reboundReady) {
                        session._restoredFromStorage = true;
                        window.showMessage && window.showMessage('题目页仍在，但重新绑定尚未完成；页面未被重载，请稍后重试。', 'warning');
                        return false;
                    }
                }
                if (!installedRegistrationStillCurrent(examWindow)) return false;
                if (session.flowMode === 'simulation') {
                    this._sendSimulationContext(session, targetEntry.examId, examWindow);
                } else if (session.pendingAdvance || (session.results || []).some((entry) => entry && entry.examId === targetEntry.examId)) {
                    await this._sendSuiteReviewState(session, targetEntry.examId, examWindow).catch((error) => {
                        console.warn('[SuitePractice] 恢复套题回看状态失败:', error);
                    });
                }
                if (!installedRegistrationStillCurrent(examWindow)) return false;
                window.showMessage && window.showMessage(`已恢复未完成套题：${targetEntry.exam?.title || targetEntry.examId}`, 'success');
                return true;
            })();
            session._resumePromise = resumePromise;
            try {
                return await resumePromise;
            } finally {
                if (session._resumePromise === resumePromise) delete session._resumePromise;
            }
            } finally {
                rollbackResumeLaunch();
            }
            };
            runResumeEntry().then((value) => {
                if (this._suiteResumeEntryPromises.get(expectedId) === entryRecord) {
                    this._suiteResumeEntryPromises.delete(expectedId);
                }
                resolveEntryPromise(value);
            }, (error) => {
                if (this._suiteResumeEntryPromises.get(expectedId) === entryRecord) {
                    this._suiteResumeEntryPromises.delete(expectedId);
                }
                rejectEntryPromise(error);
            });
            return await entryPromise;
        },

        async _handleInlineSimulationSuiteSubmit(examId, data, sourceWindow = null) {
            const withSubmitOutcome = (handled, committed = handled, errorCode = '', extra = null) => (
                data && data.submissionId
                    ? Object.assign({
                        handled: Boolean(handled),
                        committed: Boolean(committed),
                        errorCode: errorCode || null
                    }, extra || {})
                    : Boolean(handled)
            );
            await this._ensureSuiteRecoveryReady();
            const session = this.currentSuiteSession;
            if (!session || !await this._ensureSuiteRecoveryClaim('single', session)) return false;
            if (this.currentSuiteSession !== session
                || !this._ownsSuiteRecoveryClaim('single', session)) return false;
            if (!session || session.flowMode !== 'simulation') {
                return false;
            }
            const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }
            if (session.status === 'finalizing') {
                session._finalizeSubmissionId = data && data.submissionId
                    ? String(data.submissionId)
                    : (session._finalizeSubmissionId || null);
                const committed = await this._finalizeSuiteRecordWithGate(session, {
                    deferTeardown: Boolean(
                        session._finalizeSubmissionId
                        && sourceWindow
                        && !sourceWindow.closed
                    )
                });
                return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', session._finalizeSubmissionId ? {
                    teardownSession: committed ? session : null
                } : null);
            }
            if (session.status === 'completed') {
                return withSubmitOutcome(true, true, '', data && data.submissionId ? {
                    teardownSession: session
                } : null);
            }
            if (session.status !== 'active') {
                return false;
            }
            const suiteEntries = Array.isArray(data && data.suiteEntries) ? data.suiteEntries : [];
            if (!suiteEntries.length) {
                return withSubmitOutcome(true, false, 'suite_entries_missing');
            }
            const entriesByExam = new Map();
            suiteEntries.forEach((entry) => {
                const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
                if (entryExamId) {
                    entriesByExam.set(entryExamId, entry);
                }
            });
            if (!entriesByExam.size) {
                return withSubmitOutcome(true, false, 'suite_entries_missing');
            }
            const hasEverySequenceEntry = Array.isArray(session.sequence)
                && session.sequence.length > 0
                && session.sequence.every((sequenceEntry) => {
                    const entryExamId = sequenceEntry && sequenceEntry.examId != null ? String(sequenceEntry.examId) : '';
                    return entryExamId && entriesByExam.has(entryExamId);
                });
            if (!hasEverySequenceEntry) {
                console.warn('[SuitePractice] inline simulation suite submit missing sequence entries:', {
                    sessionId: session.id,
                    expected: session.sequence.map(item => item && item.examId).filter(Boolean),
                    received: Array.from(entriesByExam.keys())
                });
                return withSubmitOutcome(true, false, 'suite_entries_incomplete');
            }

            session.results = [];
            session.sequence.forEach((sequenceEntry) => {
                if (!sequenceEntry || !sequenceEntry.examId) {
                    return;
                }
                const entryExamId = String(sequenceEntry.examId);
                const entryPayload = entriesByExam.get(entryExamId);
                if (!entryPayload) {
                    return;
                }
                const normalized = this._normalizeSuiteResult(sequenceEntry.exam, Object.assign({}, entryPayload, {
                    duration: Number.isFinite(Number(entryPayload.duration))
                        ? Number(entryPayload.duration)
                        : Number(data.duration || 0)
                }));
                this._upsertSuiteResult(session, entryExamId, normalized);
                this._persistSuiteDraftSnapshot(session, entryExamId, {
                    draft: {
                        answers: entryPayload.answers || {},
                        highlights: Array.isArray(entryPayload.highlights) ? entryPayload.highlights.slice() : [],
                        noteText: typeof entryPayload.noteText === 'string' ? entryPayload.noteText : '',
                        notes: Array.isArray(entryPayload.notes) ? entryPayload.notes.slice() : [],
                        noteOutlines: Array.isArray(entryPayload.noteOutlines) ? entryPayload.noteOutlines.slice() : [],
                        scrollY: Number.isFinite(Number(entryPayload.scrollY)) ? Number(entryPayload.scrollY) : 0,
                        markedQuestions: Array.isArray(entryPayload.markedQuestions) ? entryPayload.markedQuestions.slice() : []
                    },
                    draftUpdatedAt: Number.isFinite(Number(entryPayload.updatedAt))
                        ? Number(entryPayload.updatedAt)
                        : Date.now()
                });
                const entryDuration = Number(entryPayload.duration);
                if (Number.isFinite(entryDuration)) {
                    session.elapsedByExam[entryExamId] = Math.max(0, entryDuration);
                }
            });

            this._syncSuiteTimerFromPayload(session, data);
            session.currentIndex = session.sequence.length;
            session.pendingAdvance = null;
            session.activeExamId = examId || session.sequence[session.sequence.length - 1]?.examId || session.activeExamId;
            session.lastUpdate = Date.now();
            if (sourceWindow && !sourceWindow.closed) {
                session.windowRef = sourceWindow;
            }
            const recoveryCommitted = await this._commitSuiteRecovery(session, {
                reason: 'inline-suite-submit'
            });
            if (!recoveryCommitted) {
                return withSubmitOutcome(true, false, 'suite_recovery_save_failed');
            }
            if (!this._isSuiteOperationOwner(session)) {
                return withSubmitOutcome(true, false, 'suite_teardown_in_progress');
            }
            session.sequence.forEach((entry) => {
                if (entry && entry.examId) this.updateExamStatus && this.updateExamStatus(entry.examId, 'completed');
            });
            const deferTeardown = Boolean(data && data.submissionId && sourceWindow && !sourceWindow.closed);
            session._finalizeSubmissionId = data && data.submissionId ? String(data.submissionId) : null;
            const committed = await this._finalizeSuiteRecordWithGate(session, { deferTeardown });
            return withSubmitOutcome(true, committed, committed ? '' : 'suite_save_failed', deferTeardown ? {
                teardownSession: session
            } : null);
        },

        _resolveSuitePreference(options = {}) {
            return resolveSuitePreferenceForMixin(options);
        },

        _resolveSuiteFlowMode(options = {}) {
            return this._resolveSuitePreference(options).flowMode;
        },

        _resolveSuiteFrequencyScope(options = {}) {
            return this._resolveSuitePreference(options).frequencyScope;
        },

        _isSuiteFrequencyIncluded(frequency, scope) {
            return isFrequencyInScope(frequency, scope);
        },

        _readSuiteAutoAdvancePreference() {
            return this._resolveSuitePreference().autoAdvanceAfterSubmit !== false;
        },

        _shouldAutoAdvanceAfterSubmit() {
            const activeSession = this.currentSuiteSession;
            if (activeSession && typeof activeSession.autoAdvanceAfterSubmit === 'boolean') {
                return activeSession.autoAdvanceAfterSubmit;
            }
            return this._readSuiteAutoAdvancePreference();
        },

        _hasMeaningfulSuiteAnswer(value) {
            if (Array.isArray(value)) {
                return value.some(item => this._hasMeaningfulSuiteAnswer(item));
            }
            if (value == null) {
                return false;
            }
            return String(value).trim() !== '';
        },

        _resolveSuiteEntryDraft(session, examId) {
            if (!session || !session.draftsByExam || !examId) {
                return null;
            }
            const draft = session.draftsByExam[examId];
            return draft && typeof draft === 'object' ? draft : null;
        },

        _hasSuiteDraftPayload(data = {}) {
            if (!data || typeof data !== 'object') {
                return false;
            }
            if (data.draft && typeof data.draft === 'object' && !Array.isArray(data.draft)) {
                return true;
            }
            return ['answers', 'highlights', 'noteText', 'notes', 'noteOutlines', 'scrollY', 'markedQuestions', 'draftUpdatedAt'].some((key) => (
                Object.prototype.hasOwnProperty.call(data, key)
            ));
        },

        _cloneSuiteDraftPlainObject(source) {
            if (!source || typeof source !== 'object' || Array.isArray(source)) {
                return {};
            }
            const SourceConstructor = typeof source.constructor === 'function'
                ? source.constructor
                : Object;
            try {
                return Object.assign(new SourceConstructor(), source);
            } catch (_) {
                return Object.assign({}, source);
            }
        },

        _buildSuiteDraftSnapshot(data = {}) {
            const draftSource = data && data.draft && typeof data.draft === 'object' && !Array.isArray(data.draft)
                ? data.draft
                : {};
            const answerSource = draftSource.answers && typeof draftSource.answers === 'object' && !Array.isArray(draftSource.answers)
                ? draftSource.answers
                : (data && data.answers && typeof data.answers === 'object' && !Array.isArray(data.answers) ? data.answers : {});
            const highlightSource = Array.isArray(draftSource.highlights)
                ? draftSource.highlights
                : (Array.isArray(data && data.highlights) ? data.highlights : []);
            const noteTextSource = typeof draftSource.noteText === 'string'
                ? draftSource.noteText
                : (data && typeof data.noteText === 'string' ? data.noteText : '');
            const notesSource = Array.isArray(draftSource.notes)
                ? draftSource.notes
                : (Array.isArray(data && data.notes) ? data.notes : []);
            const noteOutlinesSource = Array.isArray(draftSource.noteOutlines)
                ? draftSource.noteOutlines
                : (Array.isArray(data && data.noteOutlines) ? data.noteOutlines : []);
            const scrollSource = Number.isFinite(Number(draftSource.scrollY))
                ? Number(draftSource.scrollY)
                : (Number.isFinite(Number(data && data.scrollY)) ? Number(data.scrollY) : 0);
            const markedQuestionsSource = Array.isArray(draftSource.markedQuestions)
                ? draftSource.markedQuestions
                : (Array.isArray(data && data.markedQuestions) ? data.markedQuestions : []);
            const updatedAt = Number(
                data && (data.draftUpdatedAt ?? draftSource.updatedAt ?? data.updatedAt)
            );
            return {
                answers: this._cloneSuiteDraftPlainObject(answerSource),
                highlights: highlightSource.slice(),
                noteText: noteTextSource,
                notes: this._cloneSuitePlainObject(notesSource),
                noteOutlines: this._cloneSuitePlainObject(noteOutlinesSource),
                scrollY: scrollSource,
                markedQuestions: markedQuestionsSource.slice(),
                updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
            };
        },

        _persistSuiteDraftSnapshot(session, examId, data = {}) {
            if (!session || !examId || !this._hasSuiteDraftPayload(data)) {
                return false;
            }
            if (!session.draftsByExam || typeof session.draftsByExam !== 'object') {
                session.draftsByExam = {};
            }
            const normalizedExamId = String(examId).trim();
            if (!normalizedExamId) {
                return false;
            }
            const nextDraft = this._buildSuiteDraftSnapshot(data);
            const previousDraft = session.draftsByExam[normalizedExamId] || null;
            const previousUpdatedAt = Number(previousDraft && previousDraft.updatedAt);
            const nextUpdatedAt = Number(nextDraft.updatedAt);
            const suppliedUpdatedAt = Number(data && (data.draftUpdatedAt
                ?? (data.draft && data.draft.updatedAt)
                ?? data.updatedAt));
            if (previousDraft && !Number.isFinite(suppliedUpdatedAt)) {
                return false;
            }
            if (
                previousDraft
                && Number.isFinite(previousUpdatedAt)
                && Number.isFinite(nextUpdatedAt)
                && nextUpdatedAt <= previousUpdatedAt
            ) {
                return false;
            }
            nextDraft.updatedAt = Number.isFinite(suppliedUpdatedAt) ? suppliedUpdatedAt : nextDraft.updatedAt;
            session.draftsByExam[normalizedExamId] = nextDraft;
            session.draftRevision = Math.max(0, Number(session.draftRevision) || 0) + 1;
            const previousUpdate = Number(session.lastUpdate);
            session.lastUpdate = Math.max(
                Number.isFinite(previousUpdate) ? previousUpdate : 0,
                Number.isFinite(suppliedUpdatedAt) ? suppliedUpdatedAt : Date.now(),
                Date.now()
            );
            return true;
        },

        async _handleSuiteDraftSync(examId, data = {}, windowInfo = null, sourceWindow = null) {
            const session = this.currentSuiteSession;
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            const registeredWindowInfo = !this.examWindows
                || (typeof this.examWindows.values === 'function'
                    ? Array.from(this.examWindows.values()).includes(windowInfo)
                    : Object.values(this.examWindows).includes(windowInfo));
            const payloadSuiteId = data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
            const expectedSuiteId = windowInfo && windowInfo.suiteSessionId != null
                ? String(windowInfo.suiteSessionId).trim()
                : '';
            const incomingUpdatedAt = Number(data && (data.draftUpdatedAt
                ?? (data.draft && data.draft.updatedAt)
                ?? data.updatedAt));
            if (
                !session
                || session._suiteRecoveryWritesBlocked === true
                || !['active', 'initializing'].includes(session.status)
                || !normalizedExamId
                || !payloadSuiteId
                || payloadSuiteId !== String(session.id)
                || (expectedSuiteId && expectedSuiteId !== String(session.id))
                || !windowInfo
                || (this.examWindows && !registeredWindowInfo)
                || !windowInfo.window
                || windowInfo.window.closed
                || (sourceWindow && sourceWindow !== windowInfo.window)
                || (session.windowRef && session.windowRef.closed)
                || (session.flowMode !== 'simulation' && session.windowRef && session.windowRef !== windowInfo.window)
                || (session.flowMode !== 'simulation' && !session.windowRef && session.status !== 'initializing')
                || !Number.isFinite(incomingUpdatedAt)
                || incomingUpdatedAt <= 0
                || !Array.isArray(session.sequence)
                || !session.sequence.some((entry) => entry && String(entry.examId) === normalizedExamId)
                || !data.draft
                || typeof data.draft !== 'object'
            ) {
                return false;
            }
            if (!await this._ensureSuiteRecoveryClaim('single', session)) {
                return false;
            }
            const stillRegisteredWindowInfo = !this.examWindows
                || (typeof this.examWindows.values === 'function'
                    ? Array.from(this.examWindows.values()).includes(windowInfo)
                    : Object.values(this.examWindows).includes(windowInfo));
            if (this.currentSuiteSession !== session
                || !this._ownsSuiteRecoveryClaim('single', session)
                || !stillRegisteredWindowInfo
                || (sourceWindow && sourceWindow !== windowInfo.window)) {
                return false;
            }
            if (!this._persistSuiteDraftSnapshot(session, normalizedExamId, data)) {
                return false;
            }
            if (Number.isFinite(Number(data.elapsed))) {
                session.elapsedByExam[normalizedExamId] = typeof this._deriveSuiteExamElapsedSeconds === 'function'
                    ? this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, Number(data.elapsed))
                    : Math.max(0, Number(data.elapsed));
            }
            this._syncSuiteTimerFromPayload(session, data);
            session.windowRef = windowInfo.window;
            const indexedEntry = Number.isInteger(session.currentIndex)
                ? session.sequence[session.currentIndex]
                : null;
            if (indexedEntry && String(indexedEntry.examId) === normalizedExamId) {
                session.activeExamId = normalizedExamId;
            }
            this._mirrorSessionToStorage(session);
            return this._commitSuiteRecovery(session, {
                reason: 'draft-sync'
            });
        },

        receiveSuiteDraftSnapshotFromChild(examId, data = {}, sourceWindow = null) {
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            const windowInfo = normalizedExamId && this.examWindows && this.examWindows.get(normalizedExamId);
            if (!windowInfo || !sourceWindow || windowInfo.window !== sourceWindow || sourceWindow.closed) {
                return false;
            }
            const payloadSuiteSessionId = data && data.suiteSessionId != null ? String(data.suiteSessionId).trim() : '';
            const payloadToken = data && data.windowSessionToken != null ? String(data.windowSessionToken).trim() : '';
            const payloadGeneration = Number(data && data.windowSessionGeneration);
            if (!payloadSuiteSessionId
                || payloadSuiteSessionId !== String(windowInfo.suiteSessionId || '')
                || !payloadToken
                || payloadToken !== String(windowInfo.windowSessionToken || '')
                || !Number.isInteger(payloadGeneration)
                || payloadGeneration !== Number(windowInfo.sessionGeneration)) {
                return false;
            }
            return this._handleSuiteDraftSync(normalizedExamId, data, windowInfo, sourceWindow);
        },

        _buildSuiteSequencePayload(session) {
            const sequence = session && Array.isArray(session.sequence) ? session.sequence : [];
            return sequence
                .map((entry) => {
                    if (!entry || !entry.examId) {
                        return null;
                    }
                    const exam = entry.exam && typeof entry.exam === 'object' ? entry.exam : {};
                    let dataKey = entry.dataKey || exam.dataKey || '';
                    if (!dataKey && typeof this._getUnifiedReadingManifestEntry === 'function') {
                        const manifestEntry = this._getUnifiedReadingManifestEntry(exam);
                        dataKey = manifestEntry && (manifestEntry.dataKey || manifestEntry.examId) || '';
                    }
                    return {
                        examId: String(entry.examId),
                        dataKey: dataKey ? String(dataKey) : String(entry.examId),
                        title: entry.title || exam.title || String(entry.examId),
                        category: entry.category || exam.category || ''
                    };
                })
                .filter(Boolean);
        },

        _cloneSuitePlainObject(value) {
            if (!value || typeof value !== 'object') {
                return value;
            }
            try {
                return JSON.parse(JSON.stringify(value));
            } catch (_) {
                return Array.isArray(value) ? value.slice() : { ...value };
            }
        },

        _suiteComparableValue(value) {
            if (Array.isArray(value)) {
                return value.map((item) => this._suiteComparableValue(item));
            }
            if (value && typeof value === 'object') {
                return Object.keys(value).sort().reduce((result, key) => {
                    result[key] = this._suiteComparableValue(value[key]);
                    return result;
                }, {});
            }
            return value;
        },

        _suiteValuesEqual(left, right) {
            try {
                return JSON.stringify(this._suiteComparableValue(left))
                    === JSON.stringify(this._suiteComparableValue(right));
            } catch (_) {
                return false;
            }
        },

        _sanitizeSuiteRawData(rawData) {
            const cloned = this._cloneSuitePlainObject(rawData || {});
            if (!cloned || typeof cloned !== 'object') {
                return {};
            }
            delete cloned.highlights;
            delete cloned.scrollY;
            delete cloned.noteText;
            delete cloned.notes;
            delete cloned.noteOutlines;
            return cloned;
        },

        _buildSuiteEntryIndividualPayload(session, entry) {
            const rawData = this._sanitizeSuiteRawData(entry && entry.rawData);
            const draft = this._resolveSuiteEntryDraft(session, entry && entry.examId);
            const highlights = this._resolveSuiteEntryHighlights(entry, draft);
            if (highlights.length > 0) {
                rawData.highlights = highlights;
            }
            const scrollY = this._resolveSuiteEntryScrollY(entry, draft);
            if (Number.isFinite(Number(scrollY))) {
                rawData.scrollY = Number(scrollY);
            }
            const noteText = this._resolveSuiteEntryNoteText(entry, draft);
            if (noteText) {
                rawData.noteText = noteText;
            }
            const notes = this._resolveSuiteEntryNotes(entry, draft);
            if (notes.length > 0) {
                rawData.notes = notes;
            }
            const noteOutlines = this._resolveSuiteEntryNoteOutlines(entry, draft);
            if (noteOutlines.length > 0) {
                rawData.noteOutlines = noteOutlines;
            }
            return rawData;
        },

        _resolveSuiteEntryHighlights(entry, draft = null) {
            const sources = [
                draft && draft.highlights,
                entry && entry.highlights,
                entry && entry.rawData && entry.rawData.highlights
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已清空高亮），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 highlights: []
            // 被跳过而回落到旧 entry.rawData.highlights，复活已删除的高亮。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return source.slice();
                }
            }
            return [];
        },

        _resolveSuiteEntryScrollY(entry, draft = null) {
            if (draft && Array.isArray(draft.highlights) && draft.highlights.length > 0) {
                const normalized = Number(draft.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            if (entry && Array.isArray(entry.highlights) && entry.highlights.length > 0) {
                const normalized = Number(entry.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            if (entry && entry.rawData && Array.isArray(entry.rawData.highlights) && entry.rawData.highlights.length > 0) {
                const normalized = Number(entry.rawData.scrollY);
                return Number.isFinite(normalized) ? normalized : 0;
            }
            const sources = [
                draft && draft.scrollY,
                entry && entry.scrollY,
                entry && entry.rawData && entry.rawData.scrollY
            ];
            for (const source of sources) {
                const normalized = Number(source);
                if (Number.isFinite(normalized)) {
                    return normalized;
                }
            }
            return 0;
        },

        _resolveSuiteEntryNoteText(entry, draft = null) {
            const sources = [
                draft && draft.noteText,
                entry && entry.noteText,
                entry && entry.rawData && entry.rawData.noteText
            ];
            for (const source of sources) {
                if (typeof source === 'string' && source.trim()) {
                    return source;
                }
            }
            return '';
        },

        _resolveSuiteEntryNotes(entry, draft = null) {
            const sources = [
                draft && draft.notes,
                entry && entry.notes,
                entry && entry.rawData && entry.rawData.notes
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已删除最后一条结构笔记），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 notes: []
            // 被跳过而回落到旧 entry.rawData.notes，复活已删除的笔记。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return this._cloneSuitePlainObject(source);
                }
            }
            return [];
        },

        _resolveSuiteEntryNoteOutlines(entry, draft = null) {
            const sources = [
                draft && draft.noteOutlines,
                entry && entry.noteOutlines,
                entry && entry.rawData && entry.rawData.noteOutlines
            ];
            // 把“存在数组”视为权威来源（即使为空也可代表用户已删除最后一条笔记大纲），
            // 与 _buildSuiteDraftSnapshot 的写路径语义保持一致；避免显式 noteOutlines: []
            // 被跳过而回落到旧 entry.rawData.noteOutlines，复活已删除的大纲。
            for (const source of sources) {
                if (source != null && Array.isArray(source)) {
                    return this._cloneSuitePlainObject(source);
                }
            }
            return [];
        },

        _buildSuiteReplayEntry(session, examId) {
            if (!session || !Array.isArray(session.results)) {
                return null;
            }
            const result = session.results.find(item => item && item.examId === examId) || null;
            const draft = this._resolveSuiteEntryDraft(session, examId);
            const sequenceEntry = Array.isArray(session.sequence)
                ? session.sequence.find(item => item && item.examId === examId)
                : null;
            if (!result && !draft) {
                return null;
            }

            const answerComparison = result && result.answerComparison && typeof result.answerComparison === 'object'
                ? result.answerComparison
                : {};
            const answers = result && result.answers && typeof result.answers === 'object'
                ? result.answers
                : {};

            const filteredComparison = {};
            const filteredAnswers = {};

            Object.keys(answerComparison).forEach((questionId) => {
                const comparisonEntry = answerComparison[questionId];
                if (!comparisonEntry || typeof comparisonEntry !== 'object') {
                    return;
                }
                const userAnswer = Object.prototype.hasOwnProperty.call(comparisonEntry, 'userAnswer')
                    ? comparisonEntry.userAnswer
                    : answers[questionId];
                if (!this._hasMeaningfulSuiteAnswer(userAnswer)) {
                    return;
                }
                filteredComparison[questionId] = comparisonEntry;
                filteredAnswers[questionId] = userAnswer;
            });

            Object.keys(answers).forEach((questionId) => {
                if (Object.prototype.hasOwnProperty.call(filteredAnswers, questionId)) {
                    return;
                }
                const value = answers[questionId];
                if (!this._hasMeaningfulSuiteAnswer(value)) {
                    return;
                }
                filteredAnswers[questionId] = value;
            });

            if (draft && draft.answers && typeof draft.answers === 'object') {
                Object.keys(draft.answers).forEach((questionId) => {
                    if (Object.prototype.hasOwnProperty.call(filteredAnswers, questionId)) {
                        return;
                    }
                    const value = draft.answers[questionId];
                    if (!this._hasMeaningfulSuiteAnswer(value)) {
                        return;
                    }
                    filteredAnswers[questionId] = value;
                });
            }

            const highlights = this._resolveSuiteEntryHighlights(result, draft);
            const noteText = this._resolveSuiteEntryNoteText(result, draft);
            const notes = this._resolveSuiteEntryNotes(result, draft);
            const noteOutlines = this._resolveSuiteEntryNoteOutlines(result, draft);
            const scrollY = this._resolveSuiteEntryScrollY(result, draft);
            const markedQuestions = result && Array.isArray(result.markedQuestions)
                ? result.markedQuestions.slice()
                : (draft && Array.isArray(draft.markedQuestions) ? draft.markedQuestions.slice() : []);
            const hasReplayData = Boolean(
                Object.keys(filteredAnswers).length
                || Object.keys(filteredComparison).length
                || markedQuestions.length
                || highlights.length
                || noteText
                || notes.length
                || noteOutlines.length
                || (Number.isFinite(Number(scrollY)) && Number(scrollY) > 0)
            );
            if (!hasReplayData) {
                return null;
            }
            return {
                examId: (result && result.examId) || examId,
                title: (result && result.title) || (sequenceEntry && sequenceEntry.exam && sequenceEntry.exam.title) || examId,
                answers: filteredAnswers,
                answerComparison: filteredComparison,
                scoreInfo: (result && result.scoreInfo) || {},
                markedQuestions,
                highlights,
                noteText,
                notes,
                noteOutlines,
                scrollY
            };
        },

        _buildSuiteReviewContext(session, examId) {
            if (!session || !Array.isArray(session.sequence) || !session.sequence.length) {
                return null;
            }
            const sequenceIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (sequenceIndex < 0) {
                return null;
            }
            const sequenceEntry = session.sequence[sequenceIndex] || {};
            const hasResult = Array.isArray(session.results) && session.results.some(item => item && item.examId === examId);
            const viewMode = hasResult ? 'review' : 'answering';
            const isLast = sequenceIndex === session.sequence.length - 1;
            const pendingAdvance = session.pendingAdvance && typeof session.pendingAdvance === 'object'
                ? session.pendingAdvance
                : null;
            const allowFinalizeFromNav = Boolean(
                viewMode === 'review'
                && isLast
                && pendingAdvance
                && pendingAdvance.completedExamId === examId
                && pendingAdvance.finalReview === true
            );
            return {
                reviewSessionId: null,
                suiteSessionId: session.id,
                suiteReviewMode: true,
                showNav: true,
                viewMode,
                index: sequenceIndex + 1,
                currentIndex: sequenceIndex,
                total: session.sequence.length,
                canPrev: sequenceIndex > 0,
                canNext: viewMode === 'review' && (sequenceIndex < session.sequence.length - 1 || allowFinalizeFromNav),
                finalizeOnNext: allowFinalizeFromNav,
                title: (sequenceEntry.exam && sequenceEntry.exam.title) || sequenceEntry.examId || '',
                examId: examId,
                readOnly: viewMode === 'review'
            };
        },

        async _sendSuiteReviewState(session, examId, targetWindow = null) {
            if (!session || !examId) {
                return false;
            }
            const contextPayload = this._buildSuiteReviewContext(session, examId);
            if (!contextPayload) {
                return false;
            }
            const replayEntry = this._buildSuiteReplayEntry(session, examId);
            const resolvedWindow = targetWindow && !targetWindow.closed
                ? targetWindow
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            if (!resolvedWindow || resolvedWindow.closed) {
                return false;
            }
            try {
                if (replayEntry) {
                    this._postExamMessage(examId, resolvedWindow, 'REPLAY_PRACTICE_RECORD', {
                        suiteSessionId: session.id,
                        reviewEntryIndex: contextPayload.currentIndex,
                        readOnly: contextPayload.readOnly !== false,
                        markedQuestions: Array.isArray(replayEntry.markedQuestions) ? replayEntry.markedQuestions : [],
                        entry: replayEntry
                    });
                }
                this._postExamMessage(examId, resolvedWindow, 'REVIEW_CONTEXT', contextPayload);
                return true;
            } catch (error) {
                console.warn('[SuitePractice] 发送套题回看上下文失败:', error);
                return false;
            }
        },

        async _waitForSuiteWindowExamReady(session, examId, targetWindow = null, timeoutMs = 2500) {
            if (!session || !examId || !targetWindow || targetWindow.closed) {
                return false;
            }
            const expectedExamId = String(examId);
            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
                if (targetWindow.closed) {
                    return false;
                }
                const windowExamId = this._readSuiteWindowExamId(targetWindow);
                if (windowExamId && windowExamId !== expectedExamId) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    continue;
                }
                const windowInfo = this.examWindows && this.examWindows.get(expectedExamId)
                    ? this.examWindows.get(expectedExamId)
                    : null;
                const readyMatches = Boolean(
                    windowInfo
                    && windowInfo.window
                    && !windowInfo.window.closed
                    && windowInfo.window === targetWindow
                    && windowInfo.lastMessageType === 'SESSION_READY'
                    && Number(windowInfo.lastMessageAt) >= startedAt
                    && (!windowInfo.suiteSessionId || windowInfo.suiteSessionId === session.id)
                    && (!windowInfo.windowSessionToken || !windowInfo.lastWindowSessionToken || windowInfo.windowSessionToken === windowInfo.lastWindowSessionToken)
                    && (!windowInfo.pageType || /unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(String(windowInfo.pageType)))
                );
                if (readyMatches) {
                    return true;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            return false;
        },

        _readSuiteWindowExamId(targetWindow = null) {
            try {
                if (!targetWindow || targetWindow.closed || !targetWindow.location) {
                    return '';
                }
                const href = typeof targetWindow.location.href === 'string' ? targetWindow.location.href : '';
                if (!href || href === 'about:blank') {
                    return '';
                }
                const parsed = new URL(href, (global && global.location && global.location.href) ? global.location.href : undefined);
                return String(parsed.searchParams.get('examId') || '').trim();
            } catch (_) {
                return '';
            }
        },

        _canFallbackSendSuiteContext(examId, targetWindow = null) {
            const expectedExamId = examId != null ? String(examId).trim() : '';
            if (!expectedExamId || !targetWindow || targetWindow.closed) {
                return false;
            }
            const windowExamId = this._readSuiteWindowExamId(targetWindow);
            if (!windowExamId || windowExamId !== expectedExamId) {
                return false;
            }
            const windowInfo = this.examWindows && this.examWindows.get(expectedExamId)
                ? this.examWindows.get(expectedExamId)
                : null;
            if (windowInfo && windowInfo.window && !windowInfo.window.closed && windowInfo.window !== targetWindow) {
                return false;
            }
            const pageType = windowInfo && typeof windowInfo.pageType === 'string'
                ? windowInfo.pageType.toLowerCase()
                : '';
            if (pageType && !/unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(pageType)) {
                return false;
            }
            return true;
        },

        async _maybeRestoreSuiteReviewState(examId, targetWindow = null, windowInfo = null, options = {}) {
            if (!examId || this._shouldAutoAdvanceAfterSubmit()) {
                return false;
            }
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active' || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }

            const resolvedWindowInfo = (windowInfo && typeof windowInfo === 'object')
                ? windowInfo
                : (this.examWindows && this.examWindows.get(examId));
            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            const targetSessionId = resolvedWindowInfo && typeof resolvedWindowInfo.suiteSessionId === 'string'
                ? resolvedWindowInfo.suiteSessionId
                : '';
            if ((mappedSessionId && mappedSessionId !== session.id) || (targetSessionId && targetSessionId !== session.id)) {
                return false;
            }
            const inActiveSequence = session.sequence.some(item => item && item.examId === examId);
            if (!inActiveSequence) {
                return false;
            }

            const resolvedWindow = targetWindow && !targetWindow.closed
                ? targetWindow
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            if (!resolvedWindow || resolvedWindow.closed) {
                return false;
            }

            const expectedRegistration = options && options.expectedRegistration || null;
            const externalCommitGuard = options && typeof options.commitGuard === 'function'
                ? options.commitGuard
                : null;
            const ownsReviewRegistration = () => {
                if (externalCommitGuard && externalCommitGuard() !== true) return false;
                if (!expectedRegistration) return true;
                if (expectedRegistration.window !== resolvedWindow) return false;
                return typeof this._isExamSessionRegistrationCurrent !== 'function'
                    || this._isExamSessionRegistrationCurrent(examId, expectedRegistration) === true;
            };
            if (!ownsReviewRegistration()) return false;

            const previousActiveExamId = session.activeExamId;
            const previousIndex = session.currentIndex;
            session.activeExamId = examId;
            const sessionIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (sessionIndex >= 0) {
                session.currentIndex = sessionIndex;
                let durableReceiptConfirmed = false;
                const restoreStillOwned = () => this.currentSuiteSession === session
                    && session.status === 'active'
                    && session.currentIndex === sessionIndex
                    && String(session.activeExamId || '') === String(examId)
                    && ownsReviewRegistration();
                if (!await this._commitSuiteRecovery(session, {
                    reason: 'review-restore',
                    commitGuard: restoreStillOwned,
                    onDurableReceipt: () => { durableReceiptConfirmed = true; }
                })) {
                    if (!durableReceiptConfirmed
                        && this.currentSuiteSession === session
                        && session.currentIndex === sessionIndex
                        && String(session.activeExamId || '') === String(examId)) {
                        session.currentIndex = previousIndex;
                        session.activeExamId = previousActiveExamId;
                    }
                    return false;
                }
                if (!this._canContinueSuiteOperation(session) || !restoreStillOwned()) {
                    return false;
                }
            }
            if (!ownsReviewRegistration()) return false;
            return this._sendSuiteReviewState(session, examId, resolvedWindow);
        },

        _beginSuiteExamLaunchOwnership(examId, options = {}) {
            if (!examId || typeof this._beginExamLaunchOwnership !== 'function') return null;
            const launchOptions = {};
            if (typeof options.windowName === 'string' && options.windowName.trim()) {
                launchOptions.windowName = options.windowName;
            }
            if (options.reuseWindow && !options.reuseWindow.closed) {
                launchOptions.reuseWindow = options.reuseWindow;
            }
            return this._beginExamLaunchOwnership(examId, launchOptions);
        },

        _claimSuiteExamLaunchWindow(ownership, targetWindow) {
            if (!ownership) return true;
            if (!targetWindow || targetWindow.closed
                || typeof this._claimExamLaunchWindowOwnership !== 'function') {
                return false;
            }
            return this._claimExamLaunchWindowOwnership(ownership, targetWindow) === true;
        },

        _isSuiteExamLaunchOwnershipCurrent(examId, ownership, targetWindow = null) {
            if (!ownership) return true;
            if (typeof this._isExamLaunchOwnershipCurrent !== 'function') return false;
            return this._isExamLaunchOwnershipCurrent(examId, ownership, null, targetWindow) === true;
        },

        _isSuiteCallerRegistrationCurrent(examId, sourceWindow, options = {}) {
            const commitGuard = options && typeof options.commitGuard === 'function'
                ? options.commitGuard
                : null;
            if (commitGuard && commitGuard() !== true) return false;
            const expectedRegistration = options && options.expectedRegistration || null;
            if (!expectedRegistration) return true;
            if (sourceWindow && expectedRegistration.window !== sourceWindow) return false;
            return commitGuard
                ? true
                : (typeof this._isExamSessionRegistrationCurrent !== 'function'
                    || this._isExamSessionRegistrationCurrent(examId, expectedRegistration) === true);
        },

        _captureSuiteNavigationRegistration(
            examId,
            targetWindow,
            expectedSuiteSessionId = '',
            launchOwnership = null
        ) {
            const expectedSuiteSession = expectedSuiteSessionId
                && typeof expectedSuiteSessionId === 'object'
                ? expectedSuiteSessionId
                : null;
            const normalizedSuiteSessionId = String(
                expectedSuiteSession
                    ? expectedSuiteSession.id || ''
                    : expectedSuiteSessionId || ''
            ).trim();
            if (!examId
                || !normalizedSuiteSessionId
                || (expectedSuiteSession && this.currentSuiteSession !== expectedSuiteSession)
                || !targetWindow
                || targetWindow.closed
                || !launchOwnership
                || typeof this._captureExamLaunchRegistrationReceipt !== 'function'
                || typeof this._isExamSessionRegistrationCurrent !== 'function') return null;
            const registration = this._captureExamLaunchRegistrationReceipt(
                examId,
                launchOwnership,
                targetWindow
            );
            if (!registration
                || registration.window !== targetWindow
                || String(registration.suiteSessionId || '').trim() !== normalizedSuiteSessionId) return null;
            // Consume the frozen registration produced by this exact openExam launch.
            // Re-reading examWindows here could adopt a newer same-window registration.
            return this._isExamSessionRegistrationCurrent(examId, registration) === true
                ? registration
                : null;
        },

        _isSuiteNavigationRegistrationCurrent(examId, registration, expectedSuiteSessionId = '') {
            const expectedSuiteSession = expectedSuiteSessionId
                && typeof expectedSuiteSessionId === 'object'
                ? expectedSuiteSessionId
                : null;
            const normalizedSuiteSessionId = String(
                expectedSuiteSession
                    ? expectedSuiteSession.id || ''
                    : expectedSuiteSessionId || ''
            ).trim();
            if (!registration
                || !normalizedSuiteSessionId
                || (expectedSuiteSession && this.currentSuiteSession !== expectedSuiteSession)
                || String(registration.suiteSessionId || '').trim() !== normalizedSuiteSessionId) return false;
            return typeof this._isExamSessionRegistrationCurrent === 'function'
                && this._isExamSessionRegistrationCurrent(examId, registration) === true;
        },

        async handleSuiteReviewNavigate(examId, data = {}, sourceWindow = null, options = {}) {
            if (this._shouldAutoAdvanceAfterSubmit()) {
                return false;
            }
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active' || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }
            const sourceRegistrationStillOwned = () => this._isSuiteCallerRegistrationCurrent(
                examId,
                sourceWindow,
                options
            );
            if (!sourceRegistrationStillOwned()) return false;
            const reviewWindowInfo = this.examWindows && this.examWindows.get(examId);
            const suppliedSourceRegistration = options && options.expectedRegistration || null;
            const reviewSourceRegistration = suppliedSourceRegistration
                && (!sourceWindow || suppliedSourceRegistration.window === sourceWindow)
                ? suppliedSourceRegistration
                : (reviewWindowInfo
                    && (!sourceWindow || reviewWindowInfo.window === sourceWindow)
                    && typeof this._captureExamSessionRegistration === 'function'
                    ? this._captureExamSessionRegistration(examId, reviewWindowInfo)
                    : null);

            const payloadSuiteSessionId = data && typeof data.suiteSessionId === 'string'
                ? data.suiteSessionId.trim()
                : '';
            if (payloadSuiteSessionId && payloadSuiteSessionId !== session.id) {
                return false;
            }

            const currentIndex = session.sequence.findIndex(item => item && item.examId === examId);
            if (currentIndex < 0) {
                return false;
            }
            const direction = String(data.direction || '').trim().toLowerCase();
            let targetIndex = currentIndex;
            if (direction === 'next') {
                targetIndex += 1;
            } else if (direction === 'prev' || direction === 'previous') {
                targetIndex -= 1;
            } else {
                return false;
            }
            const hasCurrentResult = Array.isArray(session.results)
                ? session.results.some(item => item && item.examId === examId)
                : false;
            if (direction === 'next' && !hasCurrentResult) {
                return false;
            }
            const requestedFinalizeOnNext = Boolean(
                direction === 'next'
                && currentIndex === session.sequence.length - 1
                && data
                && data.finalizeOnNext === true
                && hasCurrentResult
            );
            const targetEntry = targetIndex >= 0 && targetIndex < session.sequence.length
                ? session.sequence[targetIndex]
                : null;
            const initialTargetWindow = sourceWindow && !sourceWindow.closed
                ? sourceWindow
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            const launchWindowName = session.windowName || 'ielts-suite-mode-tab';
            const launchOwnership = targetEntry && targetEntry.examId
                ? this._beginSuiteExamLaunchOwnership(targetEntry.examId, {
                    windowName: launchWindowName
                })
                : null;
            session.currentIndex = currentIndex;
            session.activeExamId = examId;
            this._persistSuiteDraftSnapshot(session, examId, data);
            if (Number.isFinite(Number(data && data.elapsed))) {
                session.elapsedByExam[examId] = this._deriveSuiteExamElapsedSeconds(session, examId, Number(data.elapsed));
            }
            this._syncSuiteTimerFromPayload(session, data);
            const reviewDraftStillOwned = () => this.currentSuiteSession === session
                && session.status === 'active'
                && sourceRegistrationStillOwned();
            if (!await this._commitSuiteRecovery(session, {
                reason: 'review-draft',
                commitGuard: reviewDraftStillOwned
            })) {
                return false;
            }
            if (!this._canContinueSuiteOperation(session) || !reviewDraftStillOwned()) {
                return false;
            }
            if (targetEntry && !this._isSuiteExamLaunchOwnershipCurrent(
                targetEntry.examId,
                launchOwnership
            )) return false;
            if (requestedFinalizeOnNext) {
                if (!this._canContinueSuiteOperation(session)) return false;
                session.pendingAdvance = null;
                await this._finalizeSuiteRecordWithGate(session);
                return true;
            }

            if (targetIndex < 0 || targetIndex >= session.sequence.length) {
                const canFinalize = Boolean(
                    direction === 'next'
                    && currentIndex === session.sequence.length - 1
                    && session.pendingAdvance
                    && session.pendingAdvance.completedExamId === examId
                    && session.pendingAdvance.finalReview === true
                );
                if (canFinalize) {
                    if (!this._canContinueSuiteOperation(session)) return false;
                    session.pendingAdvance = null;
                    await this._finalizeSuiteRecordWithGate(session);
                    return true;
                }
                return true;
            }

            if (!targetEntry || !targetEntry.examId) {
                return false;
            }

            const previousIndex = session.currentIndex;
            const previousActiveExamId = session.activeExamId;
            let sourceRegistrationReleased = false;
            let targetRegistration = null;
            const navigationRegistrationStillOwned = (targetWindow = null) => targetRegistration
                ? ((!targetWindow || targetRegistration.window === targetWindow)
                    && !targetRegistration.window.closed
                    && this._isSuiteNavigationRegistrationCurrent(
                        targetEntry.examId,
                        targetRegistration,
                        session
                    ))
                : (sourceRegistrationReleased || sourceRegistrationStillOwned());
            session.currentIndex = targetIndex;
            session.activeExamId = targetEntry.examId;
            session.lastUpdate = Date.now();
            let reviewDurableReceiptConfirmed = false;
            const reviewLaunchStillOwned = (targetWindow = null) => (
                this.currentSuiteSession === session
                && session.status === 'active'
                && session.currentIndex === targetIndex
                && String(session.activeExamId || '') === String(targetEntry.examId)
                && navigationRegistrationStillOwned(targetWindow)
                && (targetRegistration
                    ? true
                    : this._isSuiteExamLaunchOwnershipCurrent(
                        targetEntry.examId,
                        launchOwnership,
                        targetWindow
                    ))
            );
            const reviewCommitted = await this._commitSuiteRecovery(session, {
                reason: 'review-navigate',
                commitGuard: reviewLaunchStillOwned,
                onDurableReceipt: () => { reviewDurableReceiptConfirmed = true; }
            });
            if (!reviewCommitted || !reviewLaunchStillOwned()) {
                if (!reviewDurableReceiptConfirmed
                    && this.currentSuiteSession === session
                    && session.currentIndex === targetIndex
                    && String(session.activeExamId || '') === String(targetEntry.examId)) {
                    session.currentIndex = previousIndex;
                    session.activeExamId = previousActiveExamId;
                }
                return false;
            }
            if (!this._canContinueSuiteOperation(session)) {
                return false;
            }

            let targetWindow = initialTargetWindow;
            if (targetWindow && (!this._claimSuiteExamLaunchWindow(launchOwnership, targetWindow)
                || !reviewLaunchStillOwned(targetWindow))) return false;

            const isCrossExamNavigation = targetEntry.examId !== examId;
            if (isCrossExamNavigation) {
                if (typeof this.cleanupExamSession !== 'function' || !reviewSourceRegistration) {
                    return false;
                }
                let sourceCleanupConfirmed = false;
                try {
                    sourceCleanupConfirmed = await this.cleanupExamSession(examId, {
                        expectedRegistration: reviewSourceRegistration,
                        recoverySessionId: reviewSourceRegistration.expectedSessionId
                    }) === true;
                } catch (cleanupError) {
                    console.warn('[SuitePractice] review 跨篇切换清理旧会话失败:', cleanupError);
                    return false;
                }
                if (!sourceCleanupConfirmed) return false;
                if (!this._canContinueSuiteOperation(session)
                    || !this._isSuiteExamLaunchOwnershipCurrent(
                        targetEntry.examId,
                        launchOwnership,
                        targetWindow
                    )) return false;
                sourceRegistrationReleased = true;
            }
            if (isCrossExamNavigation || !targetWindow) {
                const openOptions = {
                    examDefinition: targetEntry.exam,
                    target: 'tab',
                    windowName: launchWindowName,
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: targetIndex,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: targetWindow || undefined
                };
                if (!targetWindow) delete openOptions.reuseWindow;
                if (launchOwnership) openOptions.launchOwnership = launchOwnership;
                targetWindow = await this.openExam(targetEntry.examId, openOptions);
                if (targetWindow && !targetWindow.closed) {
                    targetRegistration = this._captureSuiteNavigationRegistration(
                        targetEntry.examId,
                        targetWindow,
                        session,
                        launchOwnership
                    );
                    if (!targetRegistration) return false;
                }
                if (!this._canContinueSuiteOperation(session)
                    || !targetWindow
                    || targetWindow.closed
                    || !reviewLaunchStillOwned(targetWindow)) return false;
            }

            if (!targetWindow || targetWindow.closed) {
                return false;
            }
            if (!reviewLaunchStillOwned(targetWindow)) return false;

            session.windowRef = targetWindow;
            this._focusSuiteWindow(targetWindow);
            if (isCrossExamNavigation) {
                const ready = await this._waitForSuiteWindowExamReady(session, targetEntry.examId, targetWindow);
                if (!this._canContinueSuiteOperation(session) || !reviewLaunchStillOwned(targetWindow)) return false;
                if (!ready) {
                    if (!this._canFallbackSendSuiteContext(targetEntry.examId, targetWindow)) {
                        console.warn('[SuitePractice] 套题切换等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                        return true;
                    }
                    console.warn('[SuitePractice] 套题切换未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                }
            }
            if (!reviewLaunchStillOwned(targetWindow)) return false;
            if (session.flowMode === 'simulation') {
                session._contextSentExamId = targetEntry.examId;
                session._contextSentAt = Date.now();
                this._sendSimulationContext(session, targetEntry.examId, targetWindow);
            } else {
                await this._sendSuiteReviewState(session, targetEntry.examId, targetWindow);
            }
            if (!reviewLaunchStillOwned(targetWindow)) return false;
            return true;
        },

        async _advanceSuiteToNext(session, completedTitle, skipExamIdForAbort, options = {}) {
            if (!this._canContinueSuiteOperation(session)) {
                return false;
            }
            if (typeof this.openExam !== 'function') {
                window.showMessage && window.showMessage('当前篇已保存，但下一篇未能打开；可从套题模式继续。', 'warning');
                return false;
            }

            const nextEntry = session.sequence[session.currentIndex];
            if (!nextEntry || !nextEntry.examId) {
                await this._abortSuiteSession(session, { reason: 'missing_next_entry', skipExamId: skipExamIdForAbort || null });
                return false;
            }

            const frozenIndex = session.currentIndex;
            const windowName = typeof options.windowName === 'string' && options.windowName.trim()
                ? options.windowName
                : (session.windowName || 'ielts-suite-mode-tab');
            const reuseWindow = Object.prototype.hasOwnProperty.call(options, 'reuseWindow')
                ? (options.reuseWindow && !options.reuseWindow.closed ? options.reuseWindow : null)
                : (session.windowRef && !session.windowRef.closed ? session.windowRef : null);
            const launchOwnership = options.launchOwnership
                || this._beginSuiteExamLaunchOwnership(nextEntry.examId, { windowName, reuseWindow });
            let targetRegistration = null;
            const launchStillCurrent = (targetWindow = null) => (
                this._canContinueSuiteOperation(session)
                && session.currentIndex === frozenIndex
                && String(session.activeExamId || nextEntry.examId) === String(nextEntry.examId)
                && (targetRegistration
                    ? ((!targetWindow || targetRegistration.window === targetWindow)
                        && !targetRegistration.window.closed
                        && this._isSuiteNavigationRegistrationCurrent(
                            nextEntry.examId,
                            targetRegistration,
                            session
                        ))
                    : this._isSuiteExamLaunchOwnershipCurrent(nextEntry.examId, launchOwnership, targetWindow))
            );
            if (!this._isSuiteExamLaunchOwnershipCurrent(nextEntry.examId, launchOwnership, reuseWindow)) {
                return false;
            }
            session.activeExamId = nextEntry.examId;
            let openError = null;

            const attemptOpen = async (candidateWindow = null) => {
                if (candidateWindow && !this._claimSuiteExamLaunchWindow(launchOwnership, candidateWindow)) {
                    return null;
                }
                if (!launchStillCurrent(candidateWindow)) return null;
                const options = {
                    target: 'tab',
                    windowName,
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: session.currentIndex,
                    sequenceTotal: session.sequence.length
                };

                if (candidateWindow && !candidateWindow.closed) {
                    options.reuseWindow = candidateWindow;
                }
                if (launchOwnership) options.launchOwnership = launchOwnership;

                try {
                    const opened = await this.openExam(nextEntry.examId, {
                        ...options,
                        examDefinition: nextEntry.exam
                    });
                    if (opened && !opened.closed) {
                        targetRegistration = this._captureSuiteNavigationRegistration(
                            nextEntry.examId,
                            opened,
                            session,
                            launchOwnership
                        );
                        if (!targetRegistration) return null;
                    }
                    if (!launchStillCurrent(opened && !opened.closed ? opened : candidateWindow)) return null;
                    if (opened && !opened.closed) {
                        return opened;
                    }
                } catch (error) {
                    openError = error;
                    console.warn('[SuitePractice] 套题下一篇打开失败:', error);
                }

                return null;
            };

            let nextWindow = null;
            if (reuseWindow) {
                nextWindow = await attemptOpen(reuseWindow);
            }

            if ((!nextWindow || nextWindow.closed) && windowName) {
                if (!launchStillCurrent(reuseWindow)) return false;
                const fallbackWindow = typeof this._reacquireSuiteWindow === 'function'
                    ? this._reacquireSuiteWindow(windowName, session)
                    : this._openNamedSuiteWindow(windowName, session);
                if (fallbackWindow && !fallbackWindow.closed) {
                    nextWindow = await attemptOpen(fallbackWindow);
                }
            }

            if (!nextWindow || nextWindow.closed) {
                if (!launchStillCurrent()) return false;
                if (openError) {
                    console.warn('[SuitePractice] 套题无法打开下一篇:', openError);
                }
                window.showMessage && window.showMessage('当前篇已保存，但下一篇未能打开；可从套题模式继续。', 'warning');
                return false;
            }

            if (!launchStillCurrent(nextWindow)) return false;
            session.windowRef = nextWindow;
            this._ensureSuiteWindowGuard(session, session.windowRef);
            this._focusSuiteWindow(session.windowRef);
            const reusedNextWindow = Boolean(reuseWindow && nextWindow === reuseWindow);
            if (reusedNextWindow) {
                const ready = await this._waitForSuiteWindowExamReady(session, nextEntry.examId, session.windowRef);
                if (!launchStillCurrent(session.windowRef)) return false;
                if (!ready) {
                    if (!this._canFallbackSendSuiteContext(nextEntry.examId, session.windowRef)) {
                        window.showMessage && window.showMessage('已完成' + (completedTitle || '上一篇') + '，正在继续：' + nextEntry.exam.title + '。', 'success');
                        console.warn('[SuitePractice] 自动切题等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                        return true;
                    }
                    console.warn('[SuitePractice] 自动切题未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                }
            }
            if (!launchStillCurrent(session.windowRef)) return false;
            session._contextSentExamId = nextEntry.examId;
            session._contextSentAt = Date.now();
            this._sendSimulationContext(session, nextEntry.examId, session.windowRef);
            if (!launchStillCurrent(session.windowRef)) return false;
            window.showMessage && window.showMessage('已完成' + (completedTitle || '上一篇') + '，正在继续：' + nextEntry.exam.title + '。', 'success');
            return true;
        },

        _buildSuiteRecoverySnapshot(session, options = {}) {
            if (!session) return null;
            try {
                const now = Date.now();
                const previousUpdate = Number(session.lastUpdate);
                session.lastUpdate = Number.isFinite(previousUpdate)
                    ? Math.max(now, previousUpdate + 1)
                    : now;
                const currentRevision = normalizeRecoveryEntityRevision(session.revision);
                session.revision = options.bumpRevision !== false
                    ? Math.min(Number.MAX_SAFE_INTEGER, currentRevision + 1)
                    : currentRevision;
                const hasWindowBindingOverride = Object.prototype.hasOwnProperty.call(
                    options,
                    'windowBindingSnapshotOverride'
                );
                const windowBinding = this._buildSuiteWindowBinding(session, hasWindowBindingOverride ? {
                    override: options.windowBindingSnapshotOverride,
                    strict: true
                } : {});
                if (hasWindowBindingOverride && !windowBinding) {
                    throw new Error('Explicit suite window binding snapshot is invalid');
                }
                const snapshot = {
                    schema: 'suite-session-v2',
                    version: 2,
                    id: session.id,
                    generation: Math.max(0, Number(session._suiteGeneration) || 0),
                    status: session.status || 'active',
                    sequence: this._cloneSuitePlainObject(session.sequence || []),
                    suiteSequence: this._buildSuiteSequencePayload(session),
                    currentIndex: Number.isInteger(session.currentIndex) ? session.currentIndex : 0,
                    draftsByExam: this._cloneSuitePlainObject(session.draftsByExam || {}),
                    elapsedByExam: this._cloneSuitePlainObject(session.elapsedByExam || {}),
                    globalTimerAnchorMs: Number(session.globalTimerAnchorMs) || Number(session.startTime) || now,
                    suiteTimerAnchorMs: Number(session.suiteTimerAnchorMs) || Number(session.globalTimerAnchorMs) || Number(session.startTime) || now,
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds))
                        ? Number(session.suiteTimerLimitSeconds)
                        : 3600,
                    suiteTimerPausedOffsetMs: Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0),
                    suiteTimerPausedAtMs: Number.isFinite(Number(session.suiteTimerPausedAtMs)) ? Number(session.suiteTimerPausedAtMs) : null,
                    suiteTimerRunning: session.suiteTimerRunning !== false,
                    flowMode: session.flowMode || 'simulation',
                    frequencyScope: session.frequencyScope || 'all',
                    autoAdvanceAfterSubmit: typeof session.autoAdvanceAfterSubmit === 'boolean'
                        ? session.autoAdvanceAfterSubmit
                        : true,
                    results: (session.results || []).map(r => ({
                        examId: r.examId, title: r.title, category: r.category,
                        duration: r.duration, scoreInfo: r.scoreInfo,
                        answers: r.answers, answerComparison: r.answerComparison,
                        markedQuestions: Array.isArray(r.markedQuestions) ? r.markedQuestions.slice() : [],
                        rawData: this._sanitizeSuiteRawData(r.rawData)
                    })),
                    startTime: Number(session.startTime) || now,
                    activeExamId: session.activeExamId || null,
                    pendingAdvance: session.pendingAdvance && typeof session.pendingAdvance === 'object'
                        ? this._cloneSuitePlainObject(session.pendingAdvance)
                        : null,
                    windowBinding,
                    windowName: session.windowName || 'ielts-suite-mode-tab',
                    lastUpdate: session.lastUpdate,
                    revision: normalizeRecoveryEntityRevision(session.revision),
                    draftRevision: Math.max(0, Number(session.draftRevision) || 0),
                    finalizeOperationId: session.finalizeOperationId || null,
                    finalizeRecord: session.finalizeRecord
                        ? this._cloneSuitePlainObject(session.finalizeRecord)
                        : null
                };
                return snapshot;
            } catch (error) {
                console.warn('[SuitePractice] 无法构建套题恢复快照:', error);
                return null;
            }
        },

        _mirrorSuiteRecoverySnapshot(snapshot, ownerSession = null) {
            if (!snapshot || !global.AppData?.recovery?.windowSession) return false;
            if (!isFileProtocol && (!ownerSession
                || String(snapshot.id ?? '') !== String(ownerSession.id ?? '')
                || !this._ownsSuiteRecoveryClaim('single', ownerSession))) {
                return false;
            }
            try {
                const saved = global.AppData.recovery.windowSession.save('simulation', snapshot) !== false;
                if (!saved) {
                    this._showSuiteRecoveryMirrorFailure();
                }
                return saved;
            } catch (error) {
                this._showSuiteRecoveryMirrorFailure(error);
                return false;
            }
        },

        _showSuiteRecoveryMirrorFailure(error = null) {
            if (error) {
                console.warn('[SuitePractice] 窗口级套题恢复镜像写入失败，持久 v2 恢复仍会继续尝试:', error);
            }
            const now = Date.now();
            if (now - Number(this._lastSuiteRecoveryMirrorFailureAt || 0) < 30000) {
                return;
            }
            this._lastSuiteRecoveryMirrorFailureAt = now;
            try {
                window.showMessage && window.showMessage(
                    '浏览器已拒绝临时恢复存储。系统仍会尝试保存到主数据层；若再次提示保存失败，本次操作会暂停，请先处理存储权限或空间。',
                    'warning'
                );
            } catch (_) { /* the v2 recovery path must not depend on presentation helpers */ }
        },

        _mirrorSessionToStorage(session) {
            if (!session || session._suiteRecoveryWritesBlocked === true
                || !this._ownsSuiteRecoveryClaim('single', session)) return false;
            const snapshot = this._buildSuiteRecoverySnapshot(session);
            return this._mirrorSuiteRecoverySnapshot(snapshot, session);
        },

        _buildSuiteWindowBinding(session, options = {}) {
            const hasOverride = Object.prototype.hasOwnProperty.call(options, 'override');
            const fallbackSource = hasOverride ? options.override : session && session.windowBinding;
            const fallback = fallbackSource && typeof fallbackSource === 'object'
                ? fallbackSource
                : null;
            const validatedFallback = () => {
                const fallbackGeneration = Number(fallback && fallback.sessionGeneration);
                const fallbackExamId = String(fallback && fallback.examId || '').trim();
                if (!fallback
                    || !fallbackExamId
                    || !Array.isArray(session.sequence)
                    || !session.sequence.some((entry) => entry && String(entry.examId) === fallbackExamId)
                    || !String(fallback.expectedSessionId || '').trim()
                    || !String(fallback.windowSessionToken || '').trim()
                    || !Number.isInteger(fallbackGeneration)
                    || fallbackGeneration <= 0) {
                    return null;
                }
                return { ...this._cloneSuitePlainObject(fallback), examId: fallbackExamId };
            };
            if (hasOverride && options.strict === true) {
                return validatedFallback();
            }
            const examId = session && session.activeExamId != null
                ? String(session.activeExamId)
                : String(fallback && fallback.examId || '');
            const info = examId && this.examWindows && this.examWindows.get(examId);
            if (!info || !info.window || info.window.closed) {
                return validatedFallback();
            }
            const expectedSessionId = typeof info.expectedSessionId === 'string' ? info.expectedSessionId.trim() : '';
            const windowSessionToken = typeof info.windowSessionToken === 'string' ? info.windowSessionToken.trim() : '';
            const generation = Number(info.sessionGeneration);
            if (!expectedSessionId || !windowSessionToken || !Number.isInteger(generation) || generation <= 0) {
                return validatedFallback();
            }
            if (Object.prototype.hasOwnProperty.call(info, 'suiteSessionId')) {
                if (String(info.suiteSessionId ?? '') !== String(session.id)) {
                    return validatedFallback();
                }
            } else {
                // A truly legacy registration has no suiteSessionId field. It may only
                // refresh a binding whose exact non-secret credentials were already
                // persisted; never infer suite ownership from the global current session.
                const legacyFallback = validatedFallback();
                if (!legacyFallback
                    || String(legacyFallback.examId) !== String(examId)
                    || String(legacyFallback.expectedSessionId) !== expectedSessionId
                    || String(legacyFallback.windowSessionToken) !== windowSessionToken
                    || Number(legacyFallback.sessionGeneration) !== generation) {
                    return legacyFallback;
                }
            }
            return {
                examId,
                expectedSessionId,
                windowSessionToken,
                sessionGeneration: generation,
                expectedUrl: info.expectedUrl || '',
                expectedOrigin: info.expectedOrigin || '',
                allowOpaqueOrigin: info.allowOpaqueOrigin === true
            };
        },

        async _commitSuiteWindowBindingBeforeHandshake(suiteSessionId, examId, examWindow, windowInfo = null, options = {}) {
            const session = this.currentSuiteSession;
            const normalizedSuiteId = String(suiteSessionId || '').trim();
            const normalizedExamId = String(examId || '').trim();
            if (!session
                || !normalizedSuiteId
                || String(session.id) !== normalizedSuiteId
                || !this._isSuiteSessionCurrentOwner(session)
                || !normalizedExamId
                || String(session.activeExamId || '') !== normalizedExamId
                || !examWindow
                || examWindow.closed) {
                return false;
            }
            const registeredInfo = windowInfo || (this.examWindows && this.examWindows.get(normalizedExamId));
            if (!registeredInfo
                || registeredInfo.window !== examWindow
                || String(registeredInfo.suiteSessionId || '') !== normalizedSuiteId) {
                return false;
            }
            const previousWindowRef = session.windowRef || null;
            const previousBinding = session.windowBinding
                ? this._cloneSuitePlainObject(session.windowBinding)
                : null;
            const expectedStatus = session.status;
            session.windowRef = examWindow;
            const binding = this._buildSuiteWindowBinding(session);
            if (!binding) {
                session.windowRef = previousWindowRef;
                return false;
            }
            session.windowBinding = binding;
            session.lastUpdate = Date.now();
            const suppliedGuard = typeof options.commitGuard === 'function' ? options.commitGuard : null;
            const bindingStillOwned = () => {
                let suppliedAllows = true;
                try {
                    suppliedAllows = !suppliedGuard || suppliedGuard() !== false;
                } catch (_) {
                    suppliedAllows = false;
                }
                const liveRegistration = this.examWindows && this.examWindows.get(normalizedExamId);
                return suppliedAllows
                    && this.currentSuiteSession === session
                    && this._isSuiteSessionCurrentOwner(session)
                    && this._ownsSuiteRecoveryClaim('single', session)
                    && session.status === expectedStatus
                    && String(session.activeExamId || '') === normalizedExamId
                    && session.windowRef === examWindow
                    && session.windowBinding === binding
                    && liveRegistration === registeredInfo
                    && registeredInfo.window === examWindow
                    && String(registeredInfo.suiteSessionId || '') === normalizedSuiteId;
            };
            let bindingDurableReceiptConfirmed = false;
            const committed = await this._commitSuiteRecovery(session, {
                reason: 'window-binding',
                commitGuard: bindingStillOwned,
                onDurableReceipt: () => { bindingDurableReceiptConfirmed = true; }
            });
            if (!committed || !bindingStillOwned()) {
                if (bindingDurableReceiptConfirmed) return false;
                if (this.currentSuiteSession !== session
                    || !this._isSuiteSessionCurrentOwner(session)
                    || session.windowRef !== examWindow
                    || session.windowBinding !== binding) {
                    return false;
                }
                session.windowRef = previousWindowRef;
                session.windowBinding = previousBinding;
                return false;
            }
            return true;
        },

        _isSuiteRecoveryQuotaError(error) {
            const code = String(error && (error.code || error.name) || '').toUpperCase();
            return code === 'QUOTA_EXCEEDED'
                || code === 'QUOTAEXCEEDEDERROR'
                || code === 'NS_ERROR_DOM_QUOTA_REACHED';
        },

        _showSuiteRecoveryPersistenceFailure(error, phase = 'update') {
            const quota = this._isSuiteRecoveryQuotaError(error);
            const recoveryCode = String(error && error.code || '').toUpperCase();
            const stale = recoveryCode === 'STALE_RECOVERY_WRITE'
                || recoveryCode === 'RECOVERY_GROUP_CONFLICT';
            const message = stale
                ? '另一页面已更新这套练习。为避免旧进度覆盖新进度，本页面的操作已暂停；请返回最新页面继续。'
                : (quota
                    ? '浏览器存储空间不足。系统已尝试清理过期恢复数据，但仍无法安全保存套题；本次操作已暂停，练习记录不会被删除。'
                    : '浏览器拒绝或无法使用持久存储。为避免套题进度丢失，本次操作已暂停；请允许站点存储，file:// 下也可改用本地静态服务器后重试。');
            const key = (stale ? 'stale:' : (quota ? 'quota:' : 'backend:')) + String(phase || 'update');
            const now = Date.now();
            if (this._lastSuiteRecoveryFailureKey === key
                && now - Number(this._lastSuiteRecoveryFailureAt || 0) < 5000) {
                return;
            }
            this._lastSuiteRecoveryFailureKey = key;
            this._lastSuiteRecoveryFailureAt = now;
            window.showMessage && window.showMessage(message, 'error');
        },

        async _commitSuiteRecovery(session, options = {}) {
            if (!session || !session.id) return false;
            if (session._suiteRecoveryWritesBlocked === true) return false;
            const hasWindowBindingOverride = Object.prototype.hasOwnProperty.call(
                options,
                'windowBindingSnapshotOverride'
            );
            const windowBindingOverrideRef = hasWindowBindingOverride
                ? options.windowBindingSnapshotOverride
                : null;
            let windowBindingSnapshotOverride = null;
            if (hasWindowBindingOverride) {
                try {
                    windowBindingSnapshotOverride = this._cloneSuitePlainObject(windowBindingOverrideRef);
                } catch (_) {
                    return false;
                }
            }
            const previous = session._suiteRecoveryCommitTail && typeof session._suiteRecoveryCommitTail.then === 'function'
                ? session._suiteRecoveryCommitTail
                : Promise.resolve();
            const commit = previous.catch(() => undefined).then(async () => {
                if (session._suiteRecoveryWritesBlocked === true) return false;
                if (!this._ownsSuiteRecoveryClaim('single', session)
                    && !await this._acquireSuiteRecoveryClaim('single', session)) {
                    return false;
                }
                const commitGuard = typeof options.commitGuard === 'function'
                    ? options.commitGuard
                    : null;
                const guardAllowsCommit = () => {
                    if (hasWindowBindingOverride && session.windowBinding !== windowBindingOverrideRef) {
                        return false;
                    }
                    if (!commitGuard) return true;
                    try {
                        return commitGuard() !== false;
                    } catch (_) {
                        return false;
                    }
                };
                if (!guardAllowsCommit() || !this._ownsSuiteRecoveryClaim('single', session)) return false;
                const recovery = global.AppData && global.AppData.recovery;
                if (!recovery || typeof recovery.saveActiveSession !== 'function') {
                    const unavailable = new Error('AppData v2 recovery.saveActiveSession is unavailable');
                    unavailable.code = 'BACKEND_UNAVAILABLE';
                    throw unavailable;
                }
                const snapshot = this._buildSuiteRecoverySnapshot(session, hasWindowBindingOverride ? {
                    windowBindingSnapshotOverride
                } : {});
                if (!snapshot) {
                    const invalid = new Error('Suite recovery snapshot could not be built');
                    invalid.code = 'VALIDATION';
                    throw invalid;
                }
                const snapshotRevision = normalizeRecoveryEntityRevision(snapshot.revision);
                const operationId = `suite-recovery:${String(session.id)}:${snapshotRevision}`;
                const expectedEntityRevision = normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision);
                const save = async () => {
                    if (!guardAllowsCommit() || !this._ownsSuiteRecoveryClaim('single', session)) {
                        return { committed: false, code: 'COMMIT_GUARD_REJECTED' };
                    }
                    const receipt = await recovery.saveActiveSession(snapshot, {
                        operationId,
                        expectedEntityRevision,
                        exclusiveGroup: 'suite-practice',
                        ...(commitGuard ? { commitGuard } : {})
                    });
                    if (!receipt || receipt.committed !== true) {
                        const notCommitted = new Error('Suite recovery commit was not confirmed');
                        notCommitted.code = receipt && receipt.reason === 'COMMIT_GUARD_REJECTED'
                            ? 'COMMIT_GUARD_REJECTED'
                            : (receipt && receipt.code
                                ? String(receipt.code)
                                : 'RECOVERY_COMMIT_NOT_CONFIRMED');
                        if (notCommitted.code === 'STALE_RECOVERY_WRITE'
                            || notCommitted.code === 'RECOVERY_GROUP_CONFLICT') {
                            session._suiteRecoveryWritesBlocked = true;
                        }
                        throw notCommitted;
                    }
                    return receipt;
                };
                try {
                    await save();
                } catch (error) {
                    if (!this._isSuiteRecoveryQuotaError(error)) throw error;
                    if (typeof recovery.cleanupForRetry === 'function') {
                        try {
                            await recovery.cleanupForRetry({
                                preserve: { activeSession: [String(session.id)] }
                            });
                        } catch (cleanupError) {
                            console.warn('[SuitePractice] 清理过期 v2 recovery 后重试失败:', cleanupError);
                        }
                    }
                    await save();
                }
                // A confirmed receipt has already advanced the AppData CAS owner even
                // when a caller-level launch guard is lost before this continuation
                // resumes. Adopt that durable revision (and mirror the authoritative
                // snapshot while the recovery claim is still ours) before reporting the
                // business operation as stale, so a rollback can retry from the new CAS
                // base instead of becoming permanently write-blocked.
                session._lastDurableRecoveryRevision = snapshotRevision;
                this._mirrorSuiteRecoverySnapshot(snapshot, session);
                if (typeof options.onDurableReceipt === 'function') {
                    try {
                        options.onDurableReceipt({
                            revision: snapshotRevision,
                            snapshot: this._cloneSuitePlainObject(snapshot)
                        });
                    } catch (_) {
                        // Receipt bookkeeping must not turn a confirmed durable commit
                        // into an application-level persistence failure.
                    }
                }
                if (!guardAllowsCommit() || !this._ownsSuiteRecoveryClaim('single', session)) return false;
                return true;
            });
            session._suiteRecoveryCommitTail = commit;
            try {
                return await commit;
            } catch (error) {
                if (String(error && error.code || '').startsWith('COMMIT_GUARD')) {
                    return false;
                }
                console.warn('[SuitePractice] 持久 v2 套题恢复写入失败:', error);
                if (options.notify !== false) {
                    this._showSuiteRecoveryPersistenceFailure(error, options.reason || 'update');
                }
                return false;
            } finally {
                if (session._suiteRecoveryCommitTail === commit) {
                    delete session._suiteRecoveryCommitTail;
                }
            }
        },

        _restoreSessionFromStorage(providedSnapshot = null) {
            const clearInvalidWindowSnapshot = () => {
                if (providedSnapshot == null) this._clearSessionStorage();
            };
            try {
                const snapshot = providedSnapshot || global.AppData.recovery.windowSession.get('simulation');
                if (!snapshot || typeof snapshot !== 'object' || !snapshot.id) return null;
                const recoveryTime = suiteRecoveryTimestamp(snapshot);
                if (recoveryTime !== null && recoveryTime <= Date.now() - suiteRecoveryTtlMs) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                if (snapshot.schema !== 'suite-session-v2' || Number(snapshot.version) !== 2) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                const statusValue = String(snapshot.status || 'active').trim().toLowerCase();
                if (!['initializing', 'active', 'finalizing'].includes(statusValue)) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                const rawSequence = Array.isArray(snapshot.sequence)
                    ? snapshot.sequence
                    : (Array.isArray(snapshot.suiteSequence) ? snapshot.suiteSequence : []);
                const sequence = rawSequence.map((entry) => {
                    if (!entry || typeof entry !== 'object') return null;
                    const exam = entry.exam && typeof entry.exam === 'object' ? entry.exam : entry;
                    const examId = String(entry.examId ?? exam.id ?? '').trim();
                    if (!examId) return null;
                    return {
                        ...this._cloneSuitePlainObject(entry),
                        examId,
                        exam: { ...this._cloneSuitePlainObject(exam), id: exam.id || examId }
                    };
                }).filter(Boolean);
                const sequenceIds = sequence.map((entry) => String(entry.examId));
                const flowMode = String(snapshot.flowMode || 'simulation').trim().toLowerCase();
                const timerMode = String(snapshot.suiteTimerMode || 'countdown').trim().toLowerCase();
                const timerLimit = Number(snapshot.suiteTimerLimitSeconds);
                if (
                    !sequence.length
                    || new Set(sequenceIds).size !== sequenceIds.length
                    || !['classic', 'simulation', 'stationary'].includes(flowMode)
                    || !['countdown', 'elapsed'].includes(timerMode)
                    || !Number.isFinite(timerLimit)
                    || timerLimit <= 0
                ) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                const rawIndex = Number(snapshot.currentIndex);
                if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex > sequence.length) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                const results = Array.isArray(snapshot.results)
                    ? this._cloneSuitePlainObject(snapshot.results)
                    : [];
                if (results.some((entry) => !this._isValidSuiteRecoveryResult(entry, sequenceIds))) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                const expectedOperationId = `practice-suite:${String(snapshot.id)}:finalize`;
                if (snapshot.finalizeOperationId && snapshot.finalizeOperationId !== expectedOperationId) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                if (snapshot.finalizeRecord) {
                    const finalizeRecord = snapshot.finalizeRecord;
                    if (!this._isValidSuiteFinalizeRecord({
                        id: snapshot.id,
                        sequence,
                        results
                    }, finalizeRecord)) {
                        clearInvalidWindowSnapshot();
                        return null;
                    }
                }
                const autoAdvance = snapshot.autoAdvanceAfterSubmit !== false;
                const activeId = snapshot.activeExamId != null ? String(snapshot.activeExamId).trim() : '';
                const activeIndex = activeId
                    ? sequence.findIndex((entry) => String(entry.examId) === activeId)
                    : -1;
                const resultIds = results
                    .map((entry) => entry && String(entry.examId || '').trim())
                    .filter(Boolean);
                const terminalSnapshot = statusValue === 'finalizing' || rawIndex === sequence.length;
                if (
                    new Set(resultIds).size !== resultIds.length
                    || resultIds.some((examId) => !sequenceIds.includes(examId))
                    || (terminalSnapshot && (
                        resultIds.length !== sequenceIds.length
                        || sequenceIds.some((examId) => !resultIds.includes(examId))
                    ))
                    || (statusValue !== 'finalizing' && activeId && activeIndex < 0)
                    || (terminalSnapshot && rawIndex !== sequence.length)
                ) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                if (
                    statusValue !== 'finalizing'
                    && activeIndex >= 0
                    && activeIndex !== rawIndex
                    && !(autoAdvance && rawIndex === activeIndex + 1 && results.some((entry) => entry && String(entry.examId) === activeId))
                ) {
                    clearInvalidWindowSnapshot();
                    return null;
                }
                let currentIndex = rawIndex;
                let status = statusValue;
                if (status === 'finalizing' || currentIndex === sequence.length) {
                    status = 'finalizing';
                    currentIndex = sequence.length;
                } else if (
                    autoAdvance
                    && activeIndex >= 0
                    && currentIndex === activeIndex
                    && results.some((entry) => entry && String(entry.examId) === activeId)
                    && currentIndex + 1 < sequence.length
                ) {
                    currentIndex += 1;
                }
                const activeExamId = status === 'finalizing'
                    ? null
                    : (sequence[currentIndex] && sequence[currentIndex].examId) || activeId || sequence[0].examId;
                const now = Date.now();
                return {
                    id: String(snapshot.id),
                    status,
                    startTime: Number(snapshot.startTime) || now,
                    sequence,
                    currentIndex,
                    results,
                    draftsByExam: snapshot.draftsByExam && typeof snapshot.draftsByExam === 'object'
                        ? this._cloneSuitePlainObject(snapshot.draftsByExam)
                        : {},
                    elapsedByExam: snapshot.elapsedByExam && typeof snapshot.elapsedByExam === 'object'
                        ? this._cloneSuitePlainObject(snapshot.elapsedByExam)
                        : {},
                    globalTimerAnchorMs: Number(snapshot.globalTimerAnchorMs) || Number(snapshot.startTime) || now,
                    suiteTimerAnchorMs: Number(snapshot.suiteTimerAnchorMs) || Number(snapshot.globalTimerAnchorMs) || Number(snapshot.startTime) || now,
                    suiteTimerMode: timerMode,
                    suiteTimerLimitSeconds: timerLimit,
                    suiteTimerPausedOffsetMs: Math.max(0, Number(snapshot.suiteTimerPausedOffsetMs) || 0),
                    suiteTimerPausedAtMs: Number.isFinite(Number(snapshot.suiteTimerPausedAtMs)) ? Number(snapshot.suiteTimerPausedAtMs) : null,
                    suiteTimerRunning: snapshot.suiteTimerRunning !== false,
                    flowMode,
                    frequencyScope: snapshot.frequencyScope || 'all',
                    autoAdvanceAfterSubmit: autoAdvance,
                    pendingAdvance: snapshot.pendingAdvance && typeof snapshot.pendingAdvance === 'object'
                        ? this._cloneSuitePlainObject(snapshot.pendingAdvance)
                        : null,
                    activeExamId,
                    windowRef: null,
                    windowBinding: snapshot.windowBinding && typeof snapshot.windowBinding === 'object'
                        ? this._cloneSuitePlainObject(snapshot.windowBinding)
                        : null,
                    windowName: this._resolveSuiteWindowName(snapshot.id, snapshot.windowName),
                    lastUpdate: Number.isFinite(Number(snapshot.lastUpdate)) ? Number(snapshot.lastUpdate) : now,
                    revision: normalizeRecoveryEntityRevision(snapshot.revision),
                    draftRevision: Math.max(0, Number(snapshot.draftRevision) || 0),
                    finalizeOperationId: snapshot.finalizeOperationId || (snapshot.finalizeRecord ? expectedOperationId : null),
                    finalizeRecord: snapshot.finalizeRecord && typeof snapshot.finalizeRecord === 'object'
                        ? this._cloneSuitePlainObject(snapshot.finalizeRecord)
                        : null,
                    _suiteGeneration: Math.max(0, Number(snapshot.generation) || 0),
                    _restoredFromStorage: true,
                    _suiteRecoveryTimestampKnown: recoveryTime !== null,
                    _suiteRecoveryLeaseContended: snapshot.recoveryLeaseContended === true
                };
            } catch (error) {
                console.warn('[SuitePractice] 套题恢复快照读取失败:', error);
                clearInvalidWindowSnapshot();
                return null;
            }
        },

        _clearSessionStorage(session = null) {
            try {
                if (session && global.AppData?.recovery?.windowSession
                    && typeof global.AppData.recovery.windowSession.get === 'function') {
                    const snapshot = global.AppData.recovery.windowSession.get('simulation');
                    if (snapshot && typeof snapshot === 'object' && snapshot.id
                        && String(snapshot.id) !== String(session.id)) {
                        return false;
                    }
                    const snapshotGeneration = Number(snapshot && snapshot.generation);
                    const sessionGeneration = Number(session._suiteGeneration);
                    if (Number.isFinite(snapshotGeneration) && snapshotGeneration > 0
                        && Number.isFinite(sessionGeneration) && sessionGeneration > 0
                        && snapshotGeneration !== sessionGeneration) {
                        return false;
                    }
                }
                global.AppData.recovery.windowSession.discard('simulation');
                return true;
            } catch (_) { /* ignore */ }
            return false;
        },

        async _discardPersistentSuiteRecovery(session) {
            if (!session || !session.id) return false;
            if (!this._ownsSuiteRecoveryClaim('single', session)
                && !await this._acquireSuiteRecoveryClaim('single', session)) return false;
            const recovery = global.AppData && global.AppData.recovery;
            if (!recovery || typeof recovery.discardActiveSession !== 'function') return false;
            try {
                const receipt = await recovery.discardActiveSession(String(session.id), {
                    expectedEntityRevision: normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision)
                });
                if (receipt && receipt.committed === true) return true;
                const notCommitted = new Error('Suite recovery discard was not confirmed');
                notCommitted.code = receipt && receipt.code
                    ? String(receipt.code)
                    : 'RECOVERY_DISCARD_NOT_CONFIRMED';
                throw notCommitted;
            } catch (error) {
                console.warn('[SuitePractice] 无法清除持久 v2 套题恢复实体:', error);
                this._showSuiteRecoveryPersistenceFailure(error, 'discard');
                return false;
            }
        },

        async _discardStoredSuiteSession(session) {
            if (!session) return false;
            if (this.currentSuiteSession && !this._isSuiteSessionCurrentOwner(session)) {
                return false;
            }
            const writesWereBlocked = session._suiteRecoveryWritesBlocked === true;
            session._suiteTeardownInProgress = true;
            await this._freezeSuiteRecoveryWrites(session);
            if (!await this._discardPersistentSuiteRecovery(session)) {
                session._suiteRecoveryWritesBlocked = writesWereBlocked;
                session._suiteTeardownInProgress = false;
                return false;
            }
            if (this.suiteExamMap && Array.isArray(session.sequence)) {
                session.sequence.forEach((entry) => {
                    if (entry && entry.examId != null
                        && this.suiteExamMap.get(String(entry.examId)) === session.id) {
                        this.suiteExamMap.delete(String(entry.examId));
                    }
                });
            }
            if (this.currentSuiteSession === session) this.currentSuiteSession = null;
            this._clearSessionStorage(session);
            session._suiteTeardownInProgress = false;
            await this._releaseSuiteRecoveryClaim('single', session);
            return true;
        },

        _notifySuiteResumeAvailable(session) {
            if (!session || this._suiteResumeNoticeShown) return;
            this._suiteResumeNoticeShown = true;
            const activeEntry = Array.isArray(session.sequence)
                ? session.sequence.find((entry) => entry && String(entry.examId) === String(session.activeExamId))
                : null;
            const title = activeEntry && activeEntry.exam && activeEntry.exam.title
                ? activeEntry.exam.title
                : (session.activeExamId || '当前篇章');
            window.showMessage && window.showMessage(`检测到未完成套题：${title}。再次点击“套题模式”可选择继续或放弃并新建。`, 'info');
        },

        _syncSuiteTimerFromPayload(session, data = {}) {
            if (!session || !data || typeof data !== 'object') return;
            const timerSnapshot = data.timerSnapshot && typeof data.timerSnapshot === 'object'
                ? data.timerSnapshot
                : null;
            const anchorMs = Number(
                (timerSnapshot && (timerSnapshot.anchorMs ?? timerSnapshot.effectiveStartTimeMs))
                ?? data.suiteTimerAnchorMs
                ?? data.globalTimerAnchorMs
            );
            const existingAnchorMs = Number(session.globalTimerAnchorMs);
            if ((!Number.isFinite(existingAnchorMs) || existingAnchorMs <= 0) && Number.isFinite(anchorMs) && anchorMs > 0) {
                session.globalTimerAnchorMs = Math.floor(anchorMs);
            }
            const pausedOffsetMs = Number(
                (timerSnapshot && timerSnapshot.pausedOffsetMs)
                ?? data.suiteTimerPausedOffsetMs
                ?? data.pausedOffsetMs
            );
            if (Number.isFinite(pausedOffsetMs) && pausedOffsetMs >= 0) {
                const existingOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
                session.suiteTimerPausedOffsetMs = Math.max(existingOffsetMs, Math.max(0, pausedOffsetMs));
            }
            const hasExplicitRunning = Boolean(
                (timerSnapshot && Object.prototype.hasOwnProperty.call(timerSnapshot, 'running'))
                || Object.prototype.hasOwnProperty.call(data, 'suiteTimerRunning')
            );
            const hasExplicitPausedAt = Boolean(
                (timerSnapshot && Object.prototype.hasOwnProperty.call(timerSnapshot, 'pausedAtMs'))
                || Object.prototype.hasOwnProperty.call(data, 'suiteTimerPausedAtMs')
                || Object.prototype.hasOwnProperty.call(data, 'pausedAtMs')
            );
            if (hasExplicitRunning || hasExplicitPausedAt) {
                const pausedAtMs = Number(
                    (timerSnapshot && timerSnapshot.pausedAtMs)
                    ?? data.suiteTimerPausedAtMs
                    ?? data.pausedAtMs
                );
                const running = hasExplicitRunning
                    ? (timerSnapshot ? timerSnapshot.running : data.suiteTimerRunning)
                    : !(Number.isFinite(pausedAtMs) && pausedAtMs > 0);
                session.suiteTimerRunning = running !== false;
                session.suiteTimerPausedAtMs = (
                    session.suiteTimerRunning === false
                    && Number.isFinite(pausedAtMs)
                    && pausedAtMs > 0
                ) ? Math.floor(pausedAtMs) : null;
            }
        },

        _computeSuiteElapsedSeconds(session, referenceNow = Date.now()) {
            if (!session || typeof session !== 'object') return 0;
            const anchorMs = Number(session.globalTimerAnchorMs) > 0
                ? Number(session.globalTimerAnchorMs)
                : Number(session.startTime) || Number(referenceNow) || Date.now();
            const pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
            const pausedAtMs = Number(session.suiteTimerPausedAtMs);
            const endMs = Number.isFinite(pausedAtMs) && pausedAtMs > 0
                ? pausedAtMs
                : (Number(referenceNow) || Date.now());
            return Math.max(0, Math.round((endMs - anchorMs - pausedOffsetMs) / 1000));
        },

        _deriveSuiteExamElapsedSeconds(session, examId, suiteElapsedSeconds, options = {}) {
            if (!session || !examId) {
                return 0;
            }
            const normalizedExamId = String(examId).trim();
            const totalElapsedSeconds = Number(suiteElapsedSeconds);
            const previousElapsedSeconds = Number(
                session.elapsedByExam && session.elapsedByExam[normalizedExamId]
            );
            if (!Number.isFinite(totalElapsedSeconds) || totalElapsedSeconds < 0) {
                return Number.isFinite(previousElapsedSeconds) && previousElapsedSeconds >= 0
                    ? Math.max(0, previousElapsedSeconds)
                    : 0;
            }
            let consumedByOtherExams = 0;
            const sequence = Array.isArray(session.sequence) ? session.sequence : [];
            sequence.forEach((entry) => {
                const entryExamId = entry && entry.examId != null ? String(entry.examId).trim() : '';
                if (!entryExamId || entryExamId === normalizedExamId) {
                    return;
                }
                const value = Number(session.elapsedByExam && session.elapsedByExam[entryExamId]);
                if (Number.isFinite(value) && value > 0) {
                    consumedByOtherExams += Math.max(0, value);
                }
            });
            const derivedElapsedSeconds = Math.max(0, totalElapsedSeconds - consumedByOtherExams);
            if (options.allowDecrease === true) {
                return derivedElapsedSeconds;
            }
            if (Number.isFinite(previousElapsedSeconds) && previousElapsedSeconds > derivedElapsedSeconds) {
                return Math.max(0, previousElapsedSeconds);
            }
            return derivedElapsedSeconds;
        },

        _sendSimulationContext(session, examId, targetWindow) {
            if (!session || !examId || !targetWindow || targetWindow.closed) return false;
            if (session.flowMode !== 'simulation') return false;
            const idx = session.sequence.findIndex(e => e && e.examId === examId);
            if (idx < 0) return false;
            const windowInfo = typeof this.ensureExamWindowSession === 'function'
                ? this.ensureExamWindowSession(examId, targetWindow)
                : null;
            const messageIssuedAtMs = Date.now();
            const draft = session.draftsByExam && session.draftsByExam[examId] || null;
            const timerAnchorMs = Number(session.globalTimerAnchorMs) > 0
                ? Number(session.globalTimerAnchorMs)
                : Number(session.startTime) || Date.now();
            const elapsed = Number.isFinite(Number(session.elapsedByExam && session.elapsedByExam[examId]))
                ? Math.max(0, Number(session.elapsedByExam[examId]))
                : this._computeSuiteElapsedSeconds(session, Date.now());
            const pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
            const pausedAtMs = Number.isFinite(Number(session.suiteTimerPausedAtMs)) ? Number(session.suiteTimerPausedAtMs) : null;
            const suiteTimerRunning = session.suiteTimerRunning !== false;
            const payload = {
                    suiteSessionId: session.id,
                    flowMode: session.flowMode || 'simulation',
                    examId,
                    sessionId: windowInfo && windowInfo.expectedSessionId ? windowInfo.expectedSessionId : null,
                    windowSessionToken: windowInfo && windowInfo.windowSessionToken ? windowInfo.windowSessionToken : null,
                    windowSessionGeneration: windowInfo && Number.isInteger(windowInfo.sessionGeneration)
                        ? windowInfo.sessionGeneration
                        : 0,
                    messageIssuedAtMs,
                    suiteSequence: this._buildSuiteSequencePayload(session),
                    currentIndex: idx,
                    total: session.sequence.length,
                    isLast: idx === session.sequence.length - 1,
                    canPrev: idx > 0,
                    canNext: idx < session.sequence.length - 1,
                    draft,
                    draftsByExam: this._cloneSuitePlainObject(session.draftsByExam || {}),
                    elapsed,
                    globalTimerAnchorMs: timerAnchorMs,
                    suiteTimerAnchorMs: timerAnchorMs,
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    suiteTimerPausedOffsetMs: pausedOffsetMs,
                    suiteTimerPausedAtMs: pausedAtMs,
                    suiteTimerRunning,
                    timerSnapshot: {
                        anchorMs: timerAnchorMs,
                        effectiveStartTimeMs: timerAnchorMs,
                        pausedOffsetMs,
                        pausedAtMs,
                        running: suiteTimerRunning
                    }
            };
            try {
                this._postExamMessage(examId, targetWindow, 'SIMULATION_CONTEXT', payload);
                return true;
            } catch (e) {
                console.warn('[SuitePractice] 发送模拟上下文失败:', e);
                return false;
            }
        },

        async _handleSimulationNavigate(examId, data, sourceWindow, options = {}) {
            const session = this.currentSuiteSession;
            if (!session || session.status !== 'active') return false;
            if (session.flowMode !== 'simulation') return false;
            const sourceRegistrationStillOwned = () => this._isSuiteCallerRegistrationCurrent(
                examId,
                sourceWindow,
                options
            );
            if (!sourceRegistrationStillOwned()) return false;
            if (session.simulationNavigateLocked === true) {
                const inFlight = this._simulationNavigateInFlight;
                if (!inFlight || typeof inFlight.then !== 'function') return false;
                try {
                    await inFlight;
                } catch (_) {
                    // The queued request still gets its own validation and error path.
                }
                return this._handleSimulationNavigate(examId, data, sourceWindow, options);
            }
            const normalizedExamId = examId != null ? String(examId).trim() : '';
            const activeExamId = session.activeExamId != null ? String(session.activeExamId).trim() : '';
            if (!normalizedExamId) return false;
            const currentIdx = session.sequence.findIndex(e => e && e.examId === normalizedExamId);
            if (currentIdx < 0) return false;
            const direction = String(data && data.direction || '').toLowerCase();
            if (direction !== 'next' && direction !== 'prev' && direction !== 'previous') return false;
            const targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;
            if (targetIdx < 0 || targetIdx >= session.sequence.length) return false;
            const targetEntry = session.sequence[targetIdx];
            if (!targetEntry || !targetEntry.examId) return false;
            // Self-heal when activeExamId drifts but the index still points to the current page.
            let shouldSelfHealActiveExamId = false;
            if (activeExamId && normalizedExamId !== activeExamId) {
                const allowSelfHeal = Number.isInteger(session.currentIndex) && session.currentIndex === currentIdx;
                if (!allowSelfHeal) {
                    return false;
                }
                shouldSelfHealActiveExamId = true;
            }
            let releaseNavigation;
            const navigationInFlight = new Promise((resolve) => {
                releaseNavigation = resolve;
            });
            this._simulationNavigateInFlight = navigationInFlight;
            session.simulationNavigateLocked = true;
            const launchWindowName = session.windowName || 'ielts-suite-mode-tab';
            const initialSourceWindow = sourceWindow && !sourceWindow.closed ? sourceWindow : null;
            // Reserve the target exam/name synchronously, but do not claim the current
            // WindowProxy until the durable navigation commit succeeds; claiming it here
            // would invalidate the message handler that still owes the completion ACK.
            const launchOwnership = this._beginSuiteExamLaunchOwnership(targetEntry.examId, {
                windowName: launchWindowName
            });
            try {
                await this._ensureSuiteRecoveryReady();
                if (this.currentSuiteSession !== session
                    || !await this._ensureSuiteRecoveryClaim('single', session)
                    || !this._ownsSuiteRecoveryClaim('single', session)
                    || session.status !== 'active'
                    || !sourceRegistrationStillOwned()
                    || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)) {
                    return false;
                }
                if (shouldSelfHealActiveExamId) session.activeExamId = normalizedExamId;

                this._persistSuiteDraftSnapshot(session, normalizedExamId, data);
                if (data && typeof data.elapsed === 'number') {
                    session.elapsedByExam[normalizedExamId] = this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, data.elapsed);
                }
                this._syncSuiteTimerFromPayload(session, data);
                const currentEntry = session.sequence.find(e => e && e.examId === normalizedExamId);
                if (currentEntry && data && data.resultSnapshot) {
                    const draftSnapshot = data.draft && typeof data.draft === 'object' ? data.draft : {};
                    const derivedSnapshotDuration = this._deriveSuiteExamElapsedSeconds(session, normalizedExamId, data.elapsed);
                    const snapshot = {
                        ...data.resultSnapshot,
                        duration: Number.isFinite(Number(data.elapsed)) ? derivedSnapshotDuration : data.resultSnapshot.duration,
                        answers: data.resultSnapshot.answers || data.answers || draftSnapshot.answers || {},
                        highlights: Array.isArray(data.resultSnapshot.highlights)
                            ? data.resultSnapshot.highlights
                            : (Array.isArray(data.highlights)
                                ? data.highlights
                                : (Array.isArray(draftSnapshot.highlights) ? draftSnapshot.highlights : [])),
                        scrollY: Number.isFinite(Number(data.resultSnapshot.scrollY))
                            ? Number(data.resultSnapshot.scrollY)
                            : (Number.isFinite(Number(data.scrollY))
                                ? Number(data.scrollY)
                                : (Number.isFinite(Number(draftSnapshot.scrollY)) ? Number(draftSnapshot.scrollY) : 0))
                    };
                    const normalizedSnapshot = this._normalizeSuiteResult(currentEntry.exam, snapshot);
                    this._upsertSuiteResult(session, normalizedExamId, normalizedSnapshot);
                }

                const previousIndex = session.currentIndex;
                const previousActiveExamId = session.activeExamId;
                let simulationDurableReceiptConfirmed = false;
                let targetRegistration = null;
                const navigationRegistrationStillOwned = (targetWindow = null) => targetRegistration
                    ? ((!targetWindow || targetRegistration.window === targetWindow)
                        && !targetRegistration.window.closed
                        && this._isSuiteNavigationRegistrationCurrent(
                            targetEntry.examId,
                            targetRegistration,
                            session
                        ))
                    : sourceRegistrationStillOwned();
                session.currentIndex = targetIdx;
                session.activeExamId = targetEntry.examId;
                const simulationLaunchStillOwned = (targetWindow = null) => (
                    this.currentSuiteSession === session
                    && session.status === 'active'
                    && session.currentIndex === targetIdx
                    && String(session.activeExamId || '') === String(targetEntry.examId)
                    && navigationRegistrationStillOwned(targetWindow)
                    && (targetRegistration
                        ? true
                        : this._isSuiteExamLaunchOwnershipCurrent(
                            targetEntry.examId,
                            launchOwnership,
                            targetWindow
                        ))
                );
                const recoveryCommitted = await this._commitSuiteRecovery(session, {
                    reason: 'simulation-navigate',
                    commitGuard: simulationLaunchStillOwned,
                    onDurableReceipt: () => { simulationDurableReceiptConfirmed = true; }
                });
                if (!recoveryCommitted) {
                    if (!simulationDurableReceiptConfirmed
                        && this.currentSuiteSession === session
                        && session.currentIndex === targetIdx
                        && String(session.activeExamId || '') === String(targetEntry.examId)) {
                        session.currentIndex = previousIndex;
                        session.activeExamId = previousActiveExamId;
                    }
                    return false;
                }
                if (!simulationLaunchStillOwned()) return false;
                if (initialSourceWindow
                    && (!this._claimSuiteExamLaunchWindow(launchOwnership, initialSourceWindow)
                        || !simulationLaunchStillOwned(initialSourceWindow))) {
                    return false;
                }

                const openOptions = {
                    examDefinition: targetEntry.exam,
                    target: 'tab',
                    windowName: launchWindowName,
                    suiteSessionId: session.id,
                    suiteFlowMode: session.flowMode || 'simulation',
                    suiteTimerMode: session.suiteTimerMode || 'countdown',
                    suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds)) ? Number(session.suiteTimerLimitSeconds) : 3600,
                    sequenceIndex: targetIdx,
                    sequenceTotal: session.sequence.length,
                    reuseWindow: initialSourceWindow || undefined
                };
                if (!initialSourceWindow) delete openOptions.reuseWindow;
                if (launchOwnership) openOptions.launchOwnership = launchOwnership;
                const targetWindow = await this.openExam(targetEntry.examId, openOptions);
                if (targetWindow && !targetWindow.closed) {
                    targetRegistration = this._captureSuiteNavigationRegistration(
                        targetEntry.examId,
                        targetWindow,
                        session,
                        launchOwnership
                    );
                    if (!targetRegistration) return false;
                }

                if (!targetWindow || targetWindow.closed || !simulationLaunchStillOwned(targetWindow)) return false;

                session.windowRef = targetWindow;
                const reusedSourceWindow = Boolean(
                    sourceWindow
                    && !sourceWindow.closed
                    && sourceWindow === targetWindow
                    && targetEntry.examId !== normalizedExamId
                );
                if (reusedSourceWindow) {
                    const ready = await this._waitForSuiteWindowExamReady(session, targetEntry.examId, targetWindow);
                    if (!simulationLaunchStillOwned(targetWindow)) return false;
                    if (!ready) {
                        if (!this._canFallbackSendSuiteContext(targetEntry.examId, targetWindow)) {
                            console.warn('[SuitePractice] 模拟模式切题等待 ready 超时，延后上下文下发，等待 SESSION_READY 兜底');
                            this._focusSuiteWindow(targetWindow);
                            return true;
                        }
                        console.warn('[SuitePractice] 模拟模式切题未收到 fresh ready，但窗口已切到目标篇，继续下发上下文');
                    }
                }
                if (!simulationLaunchStillOwned(targetWindow)) return false;
                session._contextSentExamId = targetEntry.examId;
                session._contextSentAt = Date.now();
                this._sendSimulationContext(session, targetEntry.examId, targetWindow);
                if (!simulationLaunchStillOwned(targetWindow)) return false;
                this._focusSuiteWindow(targetWindow);
                return true;
            } finally {
                session.simulationNavigateLocked = false;
                if (this._simulationNavigateInFlight === navigationInFlight) {
                    this._simulationNavigateInFlight = null;
                }
                releaseNavigation();
            }
        },

        _upsertSuiteResult(session, examId, normalizedResult) {
            if (!session || !Array.isArray(session.results) || !examId || !normalizedResult) {
                return;
            }
            const existingIndex = session.results.findIndex(entry => entry && entry.examId === examId);
            if (existingIndex >= 0) {
                session.results[existingIndex] = normalizedResult;
                return;
            }
            session.results.push(normalizedResult);
        },

        _handleSuiteSessionReady(examId) {
            const session = this.currentSuiteSession;
            if (!session || (session.status !== 'active' && session.status !== 'initializing') || !examId) {
                return false;
            }
            if (session.flowMode !== 'simulation' && session.flowMode !== 'stationary') {
                return false;
            }
            if (!Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }
            const mappedSessionId = this.suiteExamMap && this.suiteExamMap.has(examId)
                ? this.suiteExamMap.get(examId)
                : null;
            if (mappedSessionId && mappedSessionId !== session.id) {
                return false;
            }
            const idx = session.sequence.findIndex(item => item && item.examId === examId);
            if (idx < 0) {
                return false;
            }
            const windowInfo = this.examWindows && this.examWindows.get(examId)
                ? this.examWindows.get(examId)
                : null;
            const pageType = windowInfo && typeof windowInfo.pageType === 'string'
                ? windowInfo.pageType.toLowerCase()
                : '';
            if (pageType && !/unified-reading|suite-placeholder|^p[1-4]$|^practice$/i.test(pageType)) {
                return false;
            }
            let targetWindow = session.windowRef && !session.windowRef.closed ? session.windowRef : null;
            if (windowInfo) {
                const info = windowInfo;
                if (info && info.window && !info.window.closed) {
                    targetWindow = info.window;
                }
            }
            if (!targetWindow || targetWindow.closed) {
                return false;
            }
            const resolveWindowExamId = (target) => {
                if (!target || target.closed) {
                    return '';
                }
                try {
                    const href = target.location && typeof target.location.href === 'string'
                        ? target.location.href
                        : '';
                    if (!href || href === 'about:blank') {
                        return '';
                    }
                    const parsed = new URL(href, (global && global.location && global.location.href) ? global.location.href : undefined);
                    const value = parsed.searchParams.get('examId');
                    return value ? String(value).trim() : '';
                } catch (_) {
                    return '';
                }
            };
            const windowExamId = this._readSuiteWindowExamId(targetWindow) || resolveWindowExamId(targetWindow);
            if (windowExamId && windowExamId !== String(examId)) {
                // Ignore late SESSION_READY events from previously active pages.
                return false;
            }
            const activeExamId = session.activeExamId ? String(session.activeExamId) : '';
            const indexAligned = Number.isInteger(session.currentIndex) && session.currentIndex === idx;
            if (activeExamId && activeExamId !== String(examId) && !indexAligned) {
                return false;
            }
            session.currentIndex = idx;
            session.activeExamId = examId;
            session.windowRef = targetWindow;
            if (session.flowMode === 'simulation' && session._contextSentExamId === examId
                && Number.isFinite(Number(session._contextSentAt))
                && Date.now() - session._contextSentAt < 3000) {
                return true;
            }
            if (session.flowMode === 'stationary') {
                return this._sendSuiteReviewState(session, examId, targetWindow);
            }
            return this._sendSimulationContext(session, examId, targetWindow);
        },

        _serializeMultiSuiteSession(session) {
            return {
                id: String(session.id),
                baseExamId: String(session.baseExamId),
                status: session.status || 'active',
                startTime: Number(session.startTime) || Date.now(),
                suiteResults: (Array.isArray(session.suiteResults) ? session.suiteResults : []).map((result) => ({
                    suiteId: String(result.suiteId),
                    examId: String(result.examId),
                    answers: this._cloneSuitePlainObject(result.answers || {}),
                    correctAnswers: this._cloneSuitePlainObject(result.correctAnswers || {}),
                    answerComparison: this._cloneSuitePlainObject(result.answerComparison || {}),
                    scoreInfo: this._cloneSuitePlainObject(result.scoreInfo || {}),
                    spellingErrors: this._cloneSuitePlainObject(Array.isArray(result.spellingErrors) ? result.spellingErrors : []),
                    timestamp: Number(result.timestamp) || 0,
                    duration: Number(result.duration) || 0,
                    metadata: this._cloneSuitePlainObject(result.metadata || {}),
                    rawData: this._cloneSuitePlainObject(result.rawData || null)
                })),
                expectedSuiteCount: session.expectedSuiteCount == null
                    ? null
                    : Number(session.expectedSuiteCount),
                metadata: this._cloneSuitePlainObject(session.metadata || {}),
                lastUpdate: Number(session.lastUpdate) || Date.now(),
                revision: normalizeRecoveryEntityRevision(session.revision),
                finalizeOperationId: session.finalizeOperationId || null,
                finalizeRecord: session.finalizeRecord
                    ? this._cloneSuitePlainObject(session.finalizeRecord)
                    : null
            };
        },

        _mirrorMultiSuiteSessionsToStorage() {
            const windowSession = global.AppData?.recovery?.windowSession;
            if (!windowSession || typeof windowSession.save !== 'function') return false;
            try {
                const sessions = Array.from(this.multiSuiteSessionsMap instanceof Map
                    ? this.multiSuiteSessionsMap.values()
                    : [])
                    .filter((session) => Boolean(session)
                        && (isFileProtocol || this._ownsMultiSuiteRecoveryOwnership(session)))
                    .sort((left, right) => String(left.baseExamId || '').localeCompare(String(right.baseExamId || '')))
                    .map((session) => this._serializeMultiSuiteSession(session));
                if (!sessions.length) {
                    return typeof windowSession.discard === 'function'
                        ? windowSession.discard(multiSuiteRecoveryName) !== false
                        : false;
                }
                return windowSession.save(multiSuiteRecoveryName, {
                    schema: multiSuiteRecoverySchema,
                    version: 2,
                    sessions,
                    updatedAt: Date.now()
                }) !== false;
            } catch (error) {
                console.warn('[MultiSuite] 多套题恢复快照写入失败:', error);
                return false;
            }
        },

        async _commitMultiSuiteRecovery(session) {
            const recovery = global.AppData && global.AppData.recovery;
            if (!session || !session.id || session._suiteRecoveryWritesBlocked === true
                || !recovery || typeof recovery.saveActiveSession !== 'function') {
                return false;
            }
            if (!this._ownsMultiSuiteRecoveryOwnership(session)
                && !await this._acquireMultiSuiteRecoveryOwnership(session)) {
                return false;
            }
            const revision = normalizeRecoveryEntityRevision(session.revision);
            const snapshot = {
                schema: multiSuiteRecoverySchema,
                version: 2,
                id: String(session.id),
                revision,
                sessions: [this._serializeMultiSuiteSession(session)],
                updatedAt: Date.now()
            };
            try {
                if (!this._ownsMultiSuiteRecoveryOwnership(session)) return false;
                const receipt = await recovery.saveActiveSession(snapshot, {
                    operationId: `multi-suite-recovery:${String(session.id)}:${revision}`,
                    expectedEntityRevision: normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision),
                    commitGuard: () => this._ownsMultiSuiteRecoveryOwnership(session)
                });
                if (!receipt || receipt.committed !== true) {
                    const error = new Error('Multi-suite recovery commit was not confirmed');
                    error.code = receipt && receipt.code ? String(receipt.code) : 'RECOVERY_COMMIT_NOT_CONFIRMED';
                    if (error.code === 'STALE_RECOVERY_WRITE' || error.code === 'RECOVERY_GROUP_CONFLICT') {
                        session._suiteRecoveryWritesBlocked = true;
                    }
                    throw error;
                }
                session._lastDurableRecoveryRevision = revision;
                if (!this._ownsMultiSuiteRecoveryOwnership(session)) return false;
                this._mirrorMultiSuiteSessionsToStorage();
                return true;
            } catch (error) {
                console.warn('[MultiSuite] 持久 v2 恢复写入失败:', error);
                this._showSuiteRecoveryPersistenceFailure(error, 'multi-suite');
                return false;
            }
        },

        _restoreMultiSuiteSessionsFromStorage(options = {}) {
            const windowSession = global.AppData?.recovery?.windowSession;
            if (!windowSession || typeof windowSession.get !== 'function') {
                return options.install === false ? [] : false;
            }
            try {
                const snapshot = windowSession.get(multiSuiteRecoveryName);
                if (!snapshot) return options.install === false ? [] : false;
                if (!this._isValidMultiSuiteRecoverySnapshot(snapshot)) {
                    if (typeof windowSession.discard === 'function') windowSession.discard(multiSuiteRecoveryName);
                    return options.install === false ? [] : false;
                }
                const snapshotTime = suiteRecoveryTimestamp(snapshot);
                const cutoff = Date.now() - suiteRecoveryTtlMs;
                const retainedStoredSessions = snapshot.sessions.filter((storedSession) => {
                    const sessionTime = suiteRecoveryTimestamp(storedSession);
                    const recoveryTime = sessionTime === null ? snapshotTime : sessionTime;
                    return recoveryTime === null || recoveryTime > cutoff;
                });
                if (retainedStoredSessions.length !== snapshot.sessions.length) {
                    if (!retainedStoredSessions.length) {
                        if (typeof windowSession.discard === 'function') {
                            windowSession.discard(multiSuiteRecoveryName);
                        }
                        return options.install === false ? [] : false;
                    }
                    if (typeof windowSession.save === 'function') {
                        windowSession.save(multiSuiteRecoveryName, {
                            ...snapshot,
                            sessions: retainedStoredSessions,
                            updatedAt: Date.now()
                        });
                    }
                }
                const restoredSessions = retainedStoredSessions.map((storedSession) => {
                    const session = this._cloneSuitePlainObject(storedSession);
                    const sessionTime = suiteRecoveryTimestamp(storedSession);
                    const recoveryTime = sessionTime === null ? snapshotTime : sessionTime;
                    session.baseExamId = String(session.baseExamId || '').trim();
                    session.revision = normalizeRecoveryEntityRevision(session.revision);
                    session._restoredFromWindowSession = true;
                    session._suiteRecoveryTimestampKnown = recoveryTime !== null;
                    session._suiteRecoveryLeaseContended = storedSession.recoveryLeaseContended === true;
                    if (options.install !== false) {
                        this.multiSuiteSessionsMap.set(session.baseExamId, session);
                    }
                    return session;
                });
                return options.install === false ? restoredSessions : true;
            } catch (error) {
                console.warn('[MultiSuite] 多套题恢复快照读取失败:', error);
                try {
                    if (typeof windowSession.discard === 'function') windowSession.discard(multiSuiteRecoveryName);
                } catch (_) {}
                return options.install === false ? [] : false;
            }
        },

        _isValidMultiSuiteRecoverySnapshot(snapshot) {
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
                || snapshot.schema !== multiSuiteRecoverySchema
                || Number(snapshot.version) !== 2
                || !Array.isArray(snapshot.sessions)) {
                return false;
            }
            const sessionIds = new Set();
            const baseExamIds = new Set();
            return snapshot.sessions.every((session) => {
                if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
                const id = String(session.id || '').trim();
                const baseExamId = String(session.baseExamId || '').trim();
                const status = String(session.status || '').trim().toLowerCase();
                const expectedCount = session.expectedSuiteCount == null ? null : Number(session.expectedSuiteCount);
                if (!id || !baseExamId || sessionIds.has(id) || baseExamIds.has(baseExamId)
                    || !['active', 'finalizing', 'completed'].includes(status)
                    || !Number.isFinite(Number(session.startTime))
                    || !Array.isArray(session.suiteResults)
                    || (expectedCount != null && (!Number.isInteger(expectedCount) || expectedCount <= 0))) {
                    return false;
                }
                const suiteIds = new Set();
                if (!session.suiteResults.every((result) => {
                    const suiteId = String(result && result.suiteId || '').trim();
                    if (suiteIds.has(suiteId)) return false;
                    suiteIds.add(suiteId);
                    return this._isValidMultiSuiteRecoveryResult(result);
                })) return false;
                const operationId = `practice-multisuite:${id}:finalize`;
                if (session.finalizeOperationId && session.finalizeOperationId !== operationId) return false;
                if (Boolean(session.finalizeOperationId) !== Boolean(session.finalizeRecord)) return false;
                if (session.finalizeRecord && (!session.finalizeOperationId
                    || !this._isValidMultiSuiteFinalizeRecord(session, session.finalizeRecord))) return false;
                if (status === 'finalizing' && (!session.finalizeOperationId || !session.finalizeRecord)) return false;
                if (status === 'completed' && (!expectedCount || session.suiteResults.length < expectedCount
                    || !session.finalizeOperationId || !session.finalizeRecord)) return false;
                sessionIds.add(id);
                baseExamIds.add(baseExamId);
                return true;
            });
        },

        _isValidMultiSuiteRecoveryResult(result) {
            if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
            const suiteId = String(result.suiteId || '').trim();
            const examId = String(result.examId || '').trim();
            const answers = result.answers;
            const comparison = result.answerComparison;
            return Boolean(
                suiteId
                && examId
                && this._isValidSuiteScoreInfo(result.scoreInfo)
                && answers && typeof answers === 'object' && !Array.isArray(answers)
                && comparison && typeof comparison === 'object' && !Array.isArray(comparison)
                && (!result.correctAnswers || (typeof result.correctAnswers === 'object' && !Array.isArray(result.correctAnswers)))
                && (!result.spellingErrors || Array.isArray(result.spellingErrors))
                && Number.isFinite(Number(result.timestamp)) && Number(result.timestamp) >= 0
                && Number.isFinite(Number(result.duration)) && Number(result.duration) >= 0
                && (!result.metadata || (typeof result.metadata === 'object' && !Array.isArray(result.metadata)))
                && (result.rawData == null || (typeof result.rawData === 'object' && !Array.isArray(result.rawData)))
            );
        },

        _isValidMultiSuiteFinalizeRecord(session, record) {
            if (!session || !record || typeof record !== 'object' || Array.isArray(record)) return false;
            const results = Array.isArray(session.suiteResults) ? session.suiteResults : [];
            const expectedScores = this.aggregateScores(results);
            const expectedAnswers = this.aggregateAnswers(results);
            const expectedComparison = this.aggregateAnswerComparisons(results);
            const expectedSpellingErrors = this.aggregateSpellingErrors(results);
            const expectedDuration = results.reduce((sum, result) => sum + (Number(result.duration) || 0), 0);
            const operationId = `practice-multisuite:${String(session.id)}:finalize`;
            const numericMatches = (left, right) => Number.isFinite(Number(left)) && Number(left) === Number(right);
            const spellingContent = (errors) => (Array.isArray(errors) ? errors : []).map(({ timestamp, ...error }) => error);
            const entries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
            return Boolean(
                String(record.id || '') === String(session.id)
                && String(record.examId || '') === String(session.baseExamId)
                && record.type === 'listening'
                && record.multiSuite === true
                && typeof record.title === 'string'
                && typeof record.date === 'string'
                && typeof record.startTime === 'string'
                && typeof record.endTime === 'string'
                && numericMatches(record.duration, expectedDuration)
                && this._isValidSuiteScoreInfo(record.scoreInfo)
                && numericMatches(record.totalQuestions, expectedScores.total)
                && numericMatches(record.correctAnswers, expectedScores.correct)
                && Math.abs(Number(record.accuracy) - Number(expectedScores.accuracy)) < 1e-9
                && Number(record.percentage) === Number(expectedScores.percentage)
                && numericMatches(record.scoreInfo.correct, expectedScores.correct)
                && numericMatches(record.scoreInfo.total, expectedScores.total)
                && Math.abs(Number(record.scoreInfo.accuracy) - Number(expectedScores.accuracy)) < 1e-9
                && Number(record.scoreInfo.percentage) === Number(expectedScores.percentage)
                && this._suiteValuesEqual(record.answers, expectedAnswers)
                && this._suiteValuesEqual(record.answerComparison, expectedComparison)
                && Array.isArray(record.spellingErrors)
                && this._suiteValuesEqual(spellingContent(record.spellingErrors), spellingContent(expectedSpellingErrors))
                && entries.length === results.length
                && entries.every((entry, index) => {
                    const result = results[index];
                    return entry && String(entry.suiteId || '') === String(result.suiteId)
                        && String(entry.examId || '') === String(result.examId)
                        && numericMatches(entry.duration, result.duration)
                        && this._suiteValuesEqual(entry.scoreInfo, result.scoreInfo)
                        && this._suiteValuesEqual(entry.answers, result.answers)
                        && this._suiteValuesEqual(entry.answerComparison, result.answerComparison)
                        && this._suiteValuesEqual(entry.spellingErrors, result.spellingErrors || [])
                        && (entry.metadata
                            ? this._suiteValuesEqual(entry.metadata, result.metadata || {})
                            : !result.metadata?.submissionId)
                        && numericMatches(entry.timestamp, result.timestamp)
                        && this._suiteValuesEqual(entry.rawData, result.rawData || null);
                })
                && record.metadata && typeof record.metadata === 'object'
                && String(record.metadata.sessionId || '') === String(session.id)
                && record.metadata.frequency === 'multi-suite'
                && (!session.metadata || !session.metadata.source || record.metadata.source === session.metadata.source)
                && Number(record.metadata.suiteCount) === results.length
                && Number(record.metadata.expectedSuiteCount) === Number(session.expectedSuiteCount)
                && record.realData && typeof record.realData === 'object'
                && record.realData.source === 'multi_suite_mode'
                && numericMatches(record.realData.correct, expectedScores.correct)
                && numericMatches(record.realData.total, expectedScores.total)
                && Math.abs(Number(record.realData.accuracy) - Number(expectedScores.accuracy)) < 1e-9
                && Number(record.realData.percentage) === Number(expectedScores.percentage)
                && numericMatches(record.realData.duration, expectedDuration)
                && Number(record.realData.suiteCount) === results.length
                && record.operationId === operationId
            );
        },

        /**
         * 处理多套题练习完成（用于100 P1/P4等包含多套题的HTML页面）
         * @param {string} examId - 考试ID（可能包含套题后缀）
         * @param {object} suiteData - 套题数据
         * @returns {boolean} 是否成功处理
         */
        async _refreshPersistentMultiSuiteBase(baseExamId, fallbackSession = null) {
            const normalizedBaseExamId = String(baseExamId || '').trim();
            const recovery = global.AppData && global.AppData.recovery;
            if (!normalizedBaseExamId || !recovery
                || typeof recovery.listActiveSessions !== 'function') {
                return { session: null, blocked: true };
            }
            const baseOwner = fallbackSession && typeof fallbackSession === 'object'
                ? fallbackSession
                : { baseExamId: normalizedBaseExamId };
            baseOwner.baseExamId = normalizedBaseExamId;
            if (!await this._acquireMultiSuiteBaseClaim(baseOwner)) {
                return { session: null, blocked: true };
            }
            let claimedSession = null;
            let restoredSession = null;
            const releaseOwnership = async () => {
                for (const session of [restoredSession, claimedSession, baseOwner]) {
                    if (!session) continue;
                    if (this._ownsSuiteRecoveryClaim('multi', session)) {
                        await this._releaseSuiteRecoveryClaim('multi', session);
                    } else if (this._ownsMultiSuiteBaseClaim(session)) {
                        await this._releaseMultiSuiteBaseClaim(session);
                    }
                }
            };
            const selectAuthoritative = (rawItems) => {
                const firstItemsById = new Map();
                (Array.isArray(rawItems) ? rawItems : []).forEach((item) => {
                    const id = String(item && (item.id ?? item.sessionId ?? item.recordId) || '');
                    if (id && !firstItemsById.has(id)) firstItemsById.set(id, item);
                });
                let authoritative = null;
                let authoritativeTime = -1;
                for (const item of firstItemsById.values()) {
                    if (!item
                        || item.schema !== multiSuiteRecoverySchema
                        || Number(item.version) !== 2
                        || !this._isValidMultiSuiteRecoverySnapshot(item)
                        || item.sessions.length !== 1
                        || String(item.id ?? '') !== String(item.sessions[0].id ?? '')
                        || String(item.sessions[0].baseExamId || '').trim() !== normalizedBaseExamId) {
                        continue;
                    }
                    const candidateTime = Number(item.sessions[0].lastUpdate)
                        || Date.parse(item.updatedAt || '') || 0;
                    if (!authoritative || candidateTime > authoritativeTime) {
                        authoritative = item;
                        authoritativeTime = candidateTime;
                    }
                }
                return authoritative;
            };
            try {
                if (global.AppData.ready && typeof global.AppData.ready.then === 'function') {
                    await global.AppData.ready;
                }
                const initialItems = await recovery.listActiveSessions();
                const authoritative = selectAuthoritative(initialItems);
                if (!authoritative) {
                    if (!fallbackSession || !fallbackSession.id
                        || !await this._acquireSuiteRecoveryClaim('multi', fallbackSession)) {
                        await releaseOwnership();
                        return { session: null, blocked: !fallbackSession };
                    }
                    return { session: fallbackSession, blocked: false, created: true };
                }

                claimedSession = this._cloneSuitePlainObject(authoritative.sessions[0]);
                if (!await this._acquireSuiteRecoveryClaim('multi', claimedSession)
                    || !this._transferMultiSuiteBaseClaim(baseOwner, claimedSession)) {
                    await releaseOwnership();
                    return { session: null, blocked: true };
                }
                claimedSession._restoredFromDurableClaim = true;
                const refreshedItems = await recovery.listActiveSessions();
                const refreshedAuthoritative = selectAuthoritative(refreshedItems);
                if (!refreshedAuthoritative
                    || String(refreshedAuthoritative.id ?? '') !== String(authoritative.id ?? '')) {
                    await releaseOwnership();
                    return { session: null, blocked: true };
                }
                await this._restorePersistentMultiSuiteSessions(refreshedItems, [claimedSession]);
                restoredSession = this.multiSuiteSessionsMap instanceof Map
                    ? this.multiSuiteSessionsMap.get(normalizedBaseExamId)
                    : null;
                if (restoredSession
                    && String(restoredSession.id ?? '') === String(authoritative.id ?? '')
                    && this._ownsMultiSuiteRecoveryOwnership(restoredSession)) {
                    return { session: restoredSession, blocked: false, created: false };
                }
                await releaseOwnership();
                return { session: null, blocked: true };
            } catch (error) {
                console.warn('[MultiSuite] 恢复当前 base 的持久会话失败:', error);
                await releaseOwnership();
                return { session: null, blocked: true };
            }
        },

        async handleMultiSuitePracticeComplete(examId, suiteData) {
            if (!suiteData || !suiteData.suiteId) {
                console.warn('[MultiSuite] 缺少suiteId，无法处理多套题完成');
                return false;
            }

            await this._ensureSuiteRecoveryReady();
            const baseExamId = String(this._extractBaseExamId(examId) || '').trim();
            if (!baseExamId) return false;

            const previous = this._multiSuiteCompletionTails.get(baseExamId) || Promise.resolve();
            const task = previous.catch(() => false)
                .then(() => this._handleMultiSuitePracticeCompleteInternal(examId, suiteData, baseExamId));
            this._multiSuiteCompletionTails.set(baseExamId, task);
            try {
                return await task;
            } finally {
                if (this._multiSuiteCompletionTails.get(baseExamId) === task) {
                    this._multiSuiteCompletionTails.delete(baseExamId);
                }
            }
        },

        async _handleMultiSuitePracticeCompleteInternal(examId, suiteData, baseExamId) {

            console.log('[MultiSuite] 处理套题完成:', examId, '套题ID:', suiteData.suiteId);

            const normalizedSuiteId = String(suiteData.suiteId).trim();
            const childSessionId = String(suiteData.sessionId || '').trim();
            const submissionId = String(suiteData.submissionId || '').trim();
            const isSubmissionReplay = (result) => Boolean(
                childSessionId
                && submissionId
                && String(result?.suiteId || '').trim() === normalizedSuiteId
                && String(result?.metadata?.sessionId || result?.rawData?.sessionId || '').trim() === childSessionId
                && String(result?.metadata?.submissionId || result?.rawData?.submissionId || '').trim() === submissionId
            );

            let session = this.multiSuiteSessionsMap.get(baseExamId);
            let pendingFreshSession = false;
            if (!session) {
                const fallbackSession = this.getOrCreateMultiSuiteSession(examId, { install: false });
                if (!fallbackSession) return false;
                const refreshed = await this._refreshPersistentMultiSuiteBase(baseExamId, fallbackSession);
                if (refreshed.blocked || !refreshed.session) return false;
                session = refreshed.session;
                if (refreshed.created === true) {
                    // Do not publish a brand-new empty owner until canonical receipt
                    // replay has been checked. A stale child replay must not strand an
                    // empty WAL plus the base and exact leases for the page lifetime.
                    pendingFreshSession = true;
                }
            }
            if (!this._ownsMultiSuiteRecoveryOwnership(session)
                && !await this._acquireMultiSuiteRecoveryOwnership(session)) return false;
            const currentSuiteResult = session && session.suiteResults.find(
                result => String(result?.suiteId || '').trim() === normalizedSuiteId
            );
            const replaysCurrentSession = Boolean(currentSuiteResult
                && ((!childSessionId || !submissionId) || isSubmissionReplay(currentSuiteResult)));

            // v2 聚合记录是 durable submission receipt。恢复实体已清理或新流程已开始时，
            // 旧窗口的精确重放仍由 canonical 记录识别，不能创建第二条聚合记录。
            if (!replaysCurrentSession && childSessionId && submissionId) {
                let records;
                try {
                    records = await this._listPracticeRecordsViaAPI();
                } catch (_) {
                    if (pendingFreshSession) await this._releaseSuiteRecoveryClaim('multi', session);
                    return false;
                }
                const alreadyCommitted = records.some((record) => record && record.multiSuite === true
                    && String(record.examId || '').trim() === baseExamId
                    && Array.isArray(record.suiteEntries)
                    && record.suiteEntries.some(isSubmissionReplay));
                if (alreadyCommitted) {
                    if (pendingFreshSession) await this._releaseSuiteRecoveryClaim('multi', session);
                    return true;
                }
            }
            if (pendingFreshSession) {
                this.multiSuiteSessionsMap.set(session.baseExamId, session);
                this._mirrorMultiSuiteSessionsToStorage();
            }

            // baseExamId 只负责定位当前流程，不能把已经完成的流程变成下一次练习的业务身份。
            // 恢复的 active 会话若结果已齐但尚未聚合（finalize 前崩溃窗口），先幂等收敛，
            // 避免同 base 新一轮被已记录的同 suiteId 阻塞。
            if (session.status === 'active' && this.isMultiSuiteComplete(session)) {
                const converged = await this.finalizeMultiSuiteRecord(session);
                if (!converged) return false;
            }

            if (session.status === 'finalizing'
                && !await this.finalizeMultiSuiteRecord(session)) {
                return false;
            }

            if (session.status === 'completed') {
                if (replaysCurrentSession) {
                    console.warn('[MultiSuite] 已完成套题的原提交重放，跳过:', suiteData.suiteId);
                    return true;
                }
                if (this.multiSuiteSessionsMap.get(session.baseExamId)?.id === session.id) {
                    this.multiSuiteSessionsMap.delete(session.baseExamId);
                }
                const previousSession = session;
                const nextSession = this.getOrCreateMultiSuiteSession(examId, { install: false });
                if (!nextSession) return false;
                if (this._ownsMultiSuiteBaseClaim(previousSession)) {
                    if (!this._transferMultiSuiteBaseClaim(previousSession, nextSession)) return false;
                    if (this._ownsSuiteRecoveryClaim('multi', previousSession)) {
                        await this._releaseSuiteRecoveryClaim('multi', previousSession);
                    } else {
                        this._terminalizeSuiteRecoverySession(previousSession);
                    }
                    if (!await this._acquireSuiteRecoveryClaim('multi', nextSession)) {
                        await this._releaseMultiSuiteBaseClaim(nextSession);
                        return false;
                    }
                } else if (!await this._acquireMultiSuiteRecoveryOwnership(nextSession)) {
                    return false;
                }
                session = nextSession;
                this.multiSuiteSessionsMap.set(session.baseExamId, session);
                this._mirrorMultiSuiteSessionsToStorage();
            }

            // 检查是否已经记录过这个套题
            const alreadyRecorded = session.suiteResults.some(
                result => String(result.suiteId) === normalizedSuiteId
            );

            if (alreadyRecorded) {
                if (childSessionId && submissionId && !replaysCurrentSession) {
                    console.warn('[MultiSuite] 同一套题收到不同提交，拒绝误 ACK:', suiteData.suiteId);
                    return false;
                }
                console.warn('[MultiSuite] 套题已记录，跳过:', suiteData.suiteId);
                if (normalizeRecoveryEntityRevision(session.revision)
                    > normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision)
                    && !await this._commitMultiSuiteRecovery(session)) {
                    return false;
                }
                if (session.status !== 'completed' && this.isMultiSuiteComplete(session)) {
                    return await this.finalizeMultiSuiteRecord(session);
                }
                return true;
            }

            // 添加套题结果到会话
            const suiteResult = {
                suiteId: normalizedSuiteId,
                examId: String(examId),
                answers: suiteData.answers || {},
                correctAnswers: suiteData.correctAnswers || {},
                answerComparison: suiteData.answerComparison || {},
                scoreInfo: suiteData.scoreInfo || { correct: 0, total: 0, accuracy: 0, percentage: 0 },
                spellingErrors: suiteData.spellingErrors || [],
                timestamp: Date.now(),
                duration: suiteData.duration || 0,
                metadata: {
                    sessionId: suiteData.sessionId,
                    submissionId: suiteData.submissionId,
                    completedAt: new Date().toISOString()
                },
                rawData: (() => {
                    try {
                        return JSON.parse(JSON.stringify(suiteData));
                    } catch (_) {
                        return suiteData ? { ...suiteData } : null;
                    }
                })()
            };

            session.suiteResults.push(suiteResult);
            session.lastUpdate = Date.now();


            console.log('[MultiSuite] added suite result', suiteData.suiteId, 'current progress:', session.suiteResults.length + ' suite(s)');

            // 如果这是第一个套题，尝试从数据中确定预期套题数量
            if (session.suiteResults.length === 1 && !session.expectedSuiteCount) {
                session.expectedSuiteCount = this._detectExpectedSuiteCount(examId, suiteData);
                console.log('[MultiSuite] 检测到预期套题数量:', session.expectedSuiteCount);
            }
            session.revision = normalizeRecoveryEntityRevision(session.revision) + 1;
            this._mirrorMultiSuiteSessionsToStorage();
            if (!await this._commitMultiSuiteRecovery(session)) {
                return false;
            }

            // 检查是否所有套题都已完成
            if (this.isMultiSuiteComplete(session)) {
                console.log('[MultiSuite] all suite entries completed, finalizing consolidated record.');
                return await this.finalizeMultiSuiteRecord(session);
            }

            // 还有套题未完成，保存当前进度
            console.log('[MultiSuite] waiting for more suite entries... completed ' + session.suiteResults.length + '/' + (session.expectedSuiteCount || '?'));


            return true;
        },

        /**
         * 检测预期的套题数量
         * @param {string} examId - 考试ID
         * @param {object} suiteData - 套题数据
         * @returns {number} 预期套题数量
         */
        _detectExpectedSuiteCount(examId, suiteData) {
            // 尝试从suiteData中获取总套题数
            if (suiteData.totalSuites && Number.isFinite(Number(suiteData.totalSuites))) {
                return Math.max(1, Math.floor(Number(suiteData.totalSuites)));
            }

            // 尝试从metadata中获取
            if (suiteData.metadata && suiteData.metadata.totalSuites) {
                const count = Number(suiteData.metadata.totalSuites);
                if (Number.isFinite(count) && count > 0) {
                    return Math.max(1, Math.floor(count));
                }
            }

            // 根据examId推断：100 P1/P4 通常包含10套题
            const lowerExamId = (examId || '').toLowerCase();
            if (lowerExamId.includes('100') && (lowerExamId.includes('p1') || lowerExamId.includes('p4'))) {
                return 10; // 默认10套题
            }

            // 默认返回1（单套题）
            return 1;
        },

        /**
         * 完成并聚合多套题记录
         * @param {object} session - 多套题会话
         */
        async finalizeMultiSuiteRecord(session) {
            if (!session || !Array.isArray(session.suiteResults) || session.suiteResults.length === 0) {
                console.warn('[MultiSuite] 无效的会话或无结果，跳过聚合');
                return false;
            }
            if (!this._ownsMultiSuiteRecoveryOwnership(session)
                && !await this._acquireMultiSuiteRecoveryOwnership(session)) return false;
            if (session._finalizePromise && typeof session._finalizePromise.then === 'function') {
                return session._finalizePromise;
            }
            const finalizePromise = this._finalizeMultiSuiteRecordInternal(session);
            session._finalizePromise = finalizePromise;
            try {
                return await finalizePromise;
            } finally {
                if (session._finalizePromise === finalizePromise) {
                    session._finalizePromise = null;
                }
            }
        },

        async _finalizeMultiSuiteRecordInternal(session) {
            if (!session || !Array.isArray(session.suiteResults) || session.suiteResults.length === 0) {
                console.warn('[MultiSuite] 无效的会话或无结果，跳过聚合');
                return false;
            }
            if (!this._ownsMultiSuiteRecoveryOwnership(session)
                && !await this._acquireMultiSuiteRecoveryOwnership(session)) return false;

            const operationId = `practice-multisuite:${String(session.id)}:finalize`;
            const hasFinalizeState = Boolean(session.finalizeRecord || session.finalizeOperationId);
            const hasFrozenRecord = Boolean(session.finalizeRecord
                && session.finalizeOperationId === operationId
                && this._isValidMultiSuiteFinalizeRecord(session, session.finalizeRecord));
            if ((session.status === 'finalizing' || hasFinalizeState) && !hasFrozenRecord) {
                console.warn('[MultiSuite] 聚合快照与当前会话不一致，拒绝使用相同 operationId 重建');
                return false;
            }

            session.status = 'finalizing';
            session.lastUpdate = Date.now();
            this._mirrorMultiSuiteSessionsToStorage();
            console.log('[MultiSuite] 开始聚合多套题记录:', session.id);

            let record = null;
            try {
                const completionTime = Date.now();
                const startTime = session.startTime || completionTime;

                // 聚合分数
                const aggregatedScores = this.aggregateScores(session.suiteResults);

                // 聚合答案
                const aggregatedAnswers = this.aggregateAnswers(session.suiteResults);

                // 聚合答案比较
                const aggregatedComparison = this.aggregateAnswerComparisons(session.suiteResults);

                // 聚合拼写错误
                const aggregatedSpellingErrors = this.aggregateSpellingErrors(session.suiteResults);

                // 计算总时长
                const totalDuration = session.suiteResults.reduce(
                    (sum, result) => sum + (result.duration || 0),
                    0
                );

                // 生成记录标题
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const source = session.metadata?.source || 'listening';
                const sourceLabel = source.toUpperCase();
                const displayTitle = dateLabel + ' ' + sourceLabel + ' multi-suite practice';

                // 构建聚合记录
                record = {
                    id: session.id,
                    operationId: `practice-multisuite:${String(session.id)}:finalize`,
                    examId: session.baseExamId,
                    title: displayTitle,
                    type: 'listening',
                    multiSuite: true,
                    date: new Date(completionTime).toISOString(),
                    startTime: new Date(startTime).toISOString(),
                    endTime: new Date(completionTime).toISOString(),
                    duration: totalDuration,

                    // 聚合的分数信息
                    scoreInfo: aggregatedScores,
                    totalQuestions: aggregatedScores.total,
                    correctAnswers: aggregatedScores.correct,
                    accuracy: aggregatedScores.accuracy,
                    percentage: aggregatedScores.percentage,

                    // 聚合的答案数据
                    answers: aggregatedAnswers,
                    answerComparison: aggregatedComparison,

                    // 套题详情
                    suiteEntries: session.suiteResults.map(result => ({
                        suiteId: result.suiteId,
                        examId: result.examId,
                        scoreInfo: result.scoreInfo,
                        answers: result.answers,
                        answerComparison: result.answerComparison,
                        spellingErrors: result.spellingErrors || [],
                        metadata: this._cloneSuitePlainObject(result.metadata || {}),
                        duration: result.duration || 0,
                        timestamp: result.timestamp,
                        rawData: result.rawData || null
                    })),

                    // 拼写错误汇总
                    spellingErrors: aggregatedSpellingErrors,

                    // 元数据
                    metadata: {
                        examTitle: displayTitle,
                        category: sourceLabel,
                        source: source,
                        frequency: 'multi-suite',
                        suiteCount: session.suiteResults.length,
                        expectedSuiteCount: session.expectedSuiteCount,
                        sessionId: session.id,
                        startedAt: new Date(startTime).toISOString(),
                        completedAt: new Date(completionTime).toISOString()
                    },

                    realData: {
                        isRealData: true,
                        source: 'multi_suite_mode',
                        duration: totalDuration,
                        correct: aggregatedScores.correct,
                        total: aggregatedScores.total,
                        accuracy: aggregatedScores.accuracy,
                        percentage: aggregatedScores.percentage,
                        suiteCount: session.suiteResults.length
                    }
                };

                const frozenRecord = hasFrozenRecord
                    ? this._cloneSuitePlainObject(session.finalizeRecord)
                    : record;
                frozenRecord.operationId = operationId;
                session.finalizeOperationId = operationId;
                session.finalizeRecord = this._cloneSuitePlainObject(frozenRecord);
                session.lastUpdate = Date.now();
                if (!hasFrozenRecord) {
                    session.revision = normalizeRecoveryEntityRevision(session.revision) + 1;
                }
                this._mirrorMultiSuiteSessionsToStorage();
                if (normalizeRecoveryEntityRevision(session.revision)
                    > normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision)
                    && !await this._commitMultiSuiteRecovery(session)) {
                    throw new Error('Multi-suite finalize recovery was not committed');
                }

                // v2 finalizeSuite is idempotent only when the record and operation
                // id remain byte-for-byte stable across retries.
                await this._saveSuitePracticeRecord(frozenRecord);
                record = frozenRecord;
                session.status = 'completed';
                session.lastUpdate = Date.now();
                this._mirrorMultiSuiteSessionsToStorage();
            } catch (error) {
                console.error('[MultiSuite] 聚合记录失败:', error);
                session.status = 'finalizing';
                session.lastUpdate = Date.now();
                this._mirrorMultiSuiteSessionsToStorage();
                try {
                    window.showMessage && window.showMessage('多套题记录保存失败，请稍后重试。', 'error');
                } catch (notificationError) {
                    console.warn('[MultiSuite] 显示聚合保存失败通知时出错:', notificationError);
                }
                return false;
            }

            // From here on the aggregate record is authoritative. Every remaining action is best-effort
            // and must not turn the committed submission into a NACK or another persistence attempt.
            const aggregatedSpellingErrors = Array.isArray(record.spellingErrors) ? record.spellingErrors : [];
            if (aggregatedSpellingErrors.length > 0 && window.spellingErrorCollector) {
                await this._runSuitePostCommitStep('保存多套题拼写错误', async () => {
                    await window.spellingErrorCollector.saveErrors(aggregatedSpellingErrors);
                    console.log('[MultiSuite] 已保存拼写错误到词表:', aggregatedSpellingErrors.length);
                });
            }
            await this._runSuitePostCommitStep('同步多套题练习记录', () => this._updatePracticeRecordsState());
            await this._runSuitePostCommitStep('刷新多套题总览', () => {
                this.refreshOverviewData && this.refreshOverviewData();
            });
            await this._runSuitePostCommitStep('清理多套题会话', async () => {
                // Old v2 frozen entries have no canonical submission metadata, so recovery remains their durable receipt.
                if (session.suiteResults.some((result) => result?.rawData?.submissionId
                    && !result?.metadata?.submissionId)) return;
                const recovery = global.AppData && global.AppData.recovery;
                if (recovery && typeof recovery.discardActiveSession === 'function') {
                    if (!this._ownsMultiSuiteRecoveryOwnership(session)) {
                        throw new Error('Multi-suite recovery lease is not owned');
                    }
                    const receipt = await recovery.discardActiveSession(String(session.id), {
                        operationId: `multi-suite-recovery:${String(session.id)}:discard`,
                        expectedEntityRevision: normalizeRecoveryEntityRevision(session._lastDurableRecoveryRevision),
                        commitGuard: () => this._ownsMultiSuiteRecoveryOwnership(session)
                    });
                    if (!receipt || receipt.committed !== true) {
                        throw new Error('Multi-suite recovery discard was not confirmed');
                    }
                }
                if (this.multiSuiteSessionsMap
                    && this.multiSuiteSessionsMap.get(session.baseExamId)?.id === session.id) {
                    this.multiSuiteSessionsMap.delete(session.baseExamId);
                }
                this._mirrorMultiSuiteSessionsToStorage();
                await this._releaseSuiteRecoveryClaim('multi', session);
            });
            await this._runSuitePostCommitStep('显示多套题完成通知', () => {
                window.showMessage && window.showMessage('多套题练习已完成，已保存 ' + session.suiteResults.length + ' 条套题记录。', 'success');
            });

            console.log('[MultiSuite] consolidated record saved:', record.id);
            return true;
        },

        async _runSuitePostCommitStep(label, callback) {
            try {
                await callback();
                return true;
            } catch (error) {
                console.warn(`[SuitePractice] ${label}失败（聚合记录已保存）:`, error);
                return false;
            }
        },

        /**
         * 聚合多套题的分数
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的分数信息
         */
        aggregateScores(suiteResults) {
            if (!Array.isArray(suiteResults) || suiteResults.length === 0) {
                return { correct: 0, total: 0, accuracy: 0, percentage: 0 };
            }

            let totalCorrect = 0;
            let totalQuestions = 0;

            suiteResults.forEach(result => {
                const scoreInfo = result.scoreInfo || {};
                totalCorrect += Number(scoreInfo.correct) || 0;
                totalQuestions += Number(scoreInfo.total) || 0;
            });

            const accuracy = totalQuestions > 0 ? totalCorrect / totalQuestions : 0;
            const percentage = Math.round(accuracy * 100);

            return {
                correct: totalCorrect,
                total: totalQuestions,
                accuracy: accuracy,
                percentage: percentage,
                source: 'multi_suite_aggregated'
            };
        },

        /**
         * 聚合多套题的答案
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的答案对象
         */
        aggregateAnswers(suiteResults) {
            const aggregated = {};

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const suiteId = result.suiteId || 'unknown';
                const answers = result.answers || {};

                Object.entries(answers).forEach(([questionId, answer]) => {
                    const normalizedQuestionId = questionId == null ? '' : String(questionId);
                    if (!normalizedQuestionId) {
                        return;
                    }

                    // Use "suiteId::questionId" format so prefixed child-page IDs still work.
                    const key = normalizedQuestionId.indexOf(suiteId + '::') === 0
                        ? normalizedQuestionId
                        : suiteId + '::' + normalizedQuestionId;
                    aggregated[key] = answer;
                });
            });

            return aggregated;
        },

        /**
         * 聚合多套题的答案比较
         * @param {Array} suiteResults - 套题结果数组
         * @returns {object} 聚合的答案比较对象
         */
        aggregateAnswerComparisons(suiteResults) {
            const aggregated = {};

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const suiteId = result.suiteId || 'unknown';
                const comparison = result.answerComparison || {};

                Object.entries(comparison).forEach(([questionId, comparisonData]) => {
                    const normalizedQuestionId = questionId == null ? '' : String(questionId);
                    if (!normalizedQuestionId) {
                        return;
                    }

                    const key = normalizedQuestionId.indexOf(suiteId + '::') === 0
                        ? normalizedQuestionId
                        : suiteId + '::' + normalizedQuestionId;
                    aggregated[key] = comparisonData;
                });
            });

            return aggregated;
        },

        /**
         * 聚合多套题的拼写错误
         * @param {Array} suiteResults - 套题结果数组
         * @returns {Array} 聚合的拼写错误数组
         */
        aggregateSpellingErrors(suiteResults) {
            const aggregated = [];
            const errorMap = new Map(); // 用于去重和合并相同单词的错误

            if (!Array.isArray(suiteResults)) {
                return aggregated;
            }

            suiteResults.forEach(result => {
                const errors = result.spellingErrors || [];

                errors.forEach(error => {
                    if (!error || !error.word) {
                        return;
                    }

                    const key = error.word.toLowerCase();

                    if (errorMap.has(key)) {
                        // 更新已存在的错误记录
                        const existing = errorMap.get(key);
                        const existingTimestamp = Number(existing.timestamp) || 0;
                        const incomingTimestamp = Number(error.timestamp) || 0;
                        existing.errorCount = (existing.errorCount || 1) + 1;

                        // 保留最新的用户输入
                        if (incomingTimestamp >= existingTimestamp) {
                            existing.userInput = error.userInput;
                            existing.questionId = error.questionId || existing.questionId;
                            existing.suiteId = error.suiteId || result.suiteId || existing.suiteId;
                            existing.examId = error.examId || result.examId || existing.examId;
                            existing.acceptedAnswers = Array.isArray(error.acceptedAnswers)
                                ? error.acceptedAnswers.slice()
                                : existing.acceptedAnswers;
                            existing.canonicalAnswer = error.canonicalAnswer || existing.canonicalAnswer;
                            existing.reasonCode = error.reasonCode || existing.reasonCode;
                            existing.confidence = typeof error.confidence === 'number' ? error.confidence : existing.confidence;
                            existing.tokenIndex = Number.isFinite(error.tokenIndex) ? error.tokenIndex : existing.tokenIndex;
                            existing.metadata = error.metadata || existing.metadata;
                        }
                        existing.timestamp = Math.max(existingTimestamp, incomingTimestamp);
                    } else {
                        // 添加新的错误记录
                        errorMap.set(key, {
                            word: error.word,
                            userInput: error.userInput,
                            questionId: error.questionId,
                            suiteId: error.suiteId || result.suiteId,
                            examId: error.examId || result.examId,
                            timestamp: error.timestamp || result.timestamp || 0,
                            errorCount: error.errorCount || 1,
                            source: error.source || this._detectMultiSuiteSource(result.examId),
                            acceptedAnswers: Array.isArray(error.acceptedAnswers) ? error.acceptedAnswers.slice() : undefined,
                            canonicalAnswer: error.canonicalAnswer,
                            reasonCode: error.reasonCode,
                            confidence: typeof error.confidence === 'number' ? error.confidence : undefined,
                            tokenIndex: Number.isFinite(error.tokenIndex) ? error.tokenIndex : undefined,
                            metadata: error.metadata
                        });
                    }
                });
            });

            // 转换为数组
            errorMap.forEach(error => aggregated.push(error));

            return aggregated;
        },

        async _finalizeSuiteRecordWithGate(session, options = {}) {
            if (!session) return false;
            if (!this._ownsSuiteRecoveryClaim('single', session)
                && !await this._acquireSuiteRecoveryClaim('single', session)) return false;
            if (session._finalizePromise && typeof session._finalizePromise.then === 'function') {
                return session._finalizePromise;
            }
            const finalizePromise = this.finalizeSuiteRecord(session, options);
            session._finalizePromise = finalizePromise;
            try {
                return await finalizePromise;
            } finally {
                if (session._finalizePromise === finalizePromise) {
                    session._finalizePromise = null;
                }
            }
        },

        async finalizeSuiteRecord(session, options = {}) {
            if (!session || !Array.isArray(session.sequence) || !session.sequence.length) {
                return false;
            }
            if (!this._ownsSuiteRecoveryClaim('single', session)
                && !await this._acquireSuiteRecoveryClaim('single', session)) return false;

            const sequenceIds = session.sequence
                .map((entry) => entry && String(entry.examId || '').trim())
                .filter(Boolean);
            const results = Array.isArray(session.results) ? session.results : [];
            const resultIds = results
                .map((entry) => entry && String(entry.examId || '').trim())
                .filter(Boolean);
            const invalidResultIndex = results.findIndex((entry) => !this._isValidSuiteRecoveryResult(entry, sequenceIds));
            const invalidResultExamId = invalidResultIndex >= 0 && results[invalidResultIndex]
                ? String(results[invalidResultIndex].examId || '').trim()
                : '';
            const invalidSequenceIndex = invalidResultExamId ? sequenceIds.indexOf(invalidResultExamId) : -1;
            const missingResultIndex = session.sequence.findIndex((entry) => (
                entry && !resultIds.includes(String(entry.examId))
            ));
            const completeResults = Boolean(
                sequenceIds.length === session.sequence.length
                && resultIds.length === sequenceIds.length
                && new Set(resultIds).size === resultIds.length
                && invalidResultIndex < 0
                && sequenceIds.every((examId) => resultIds.includes(examId))
            );
            if (!completeResults) {
                delete session._suiteTeardownRegistrations;
                const recoveryIndex = invalidSequenceIndex >= 0 ? invalidSequenceIndex : missingResultIndex;
                const safeIndex = recoveryIndex >= 0
                    ? recoveryIndex
                    : Math.min(Math.max(0, Number(session.currentIndex) || 0), session.sequence.length - 1);
                session.status = 'active';
                session.currentIndex = safeIndex;
                session.activeExamId = session.sequence[safeIndex] && session.sequence[safeIndex].examId || null;
                session.finalizeOperationId = null;
                session.finalizeRecord = null;
                session.lastUpdate = Date.now();
                await this._commitSuiteRecovery(session, { reason: 'incomplete-finalize' });
                window.showMessage && window.showMessage('套题结果不完整，请完成缺失篇章后再提交。', 'warning');
                return false;
            }

            if (!(session._suiteTeardownRegistrations instanceof Map)) {
                // Freeze the exact suite-owned WindowProxy before finalization performs
                // its first durable write. Receipt replay may delay teardown, but late
                // messages must never replace the ownership snapshot in that interval.
                session._suiteTeardownRegistrations = this._captureSuiteTeardownRegistrations(session);
            }
            session.status = 'finalizing';
            session.currentIndex = session.sequence.length;
            session.activeExamId = null;
            session.lastUpdate = Date.now();
            if (!await this._commitSuiteRecovery(session, { reason: 'finalize-start' })) {
                return false;
            }

            let committed = false;
            try {
                const completionTime = Date.now();
                const suiteEntries = session.results.map(entry => {
                    const draft = this._resolveSuiteEntryDraft(session, entry && entry.examId);
                    return {
                        examId: entry.examId,
                        title: entry.title,
                        category: entry.category,
                        duration: entry.duration,
                        scoreInfo: entry.scoreInfo,
                        answers: entry.answers,
                        answerComparison: entry.answerComparison,
                        markedQuestions: Array.isArray(entry.markedQuestions) ? entry.markedQuestions.slice() : [],
                        highlights: this._resolveSuiteEntryHighlights(entry, draft),
                        noteText: this._resolveSuiteEntryNoteText(entry, draft),
                        notes: this._resolveSuiteEntryNotes(entry, draft),
                        noteOutlines: this._resolveSuiteEntryNoteOutlines(entry, draft),
                        scrollY: this._resolveSuiteEntryScrollY(entry, draft),
                        rawData: this._sanitizeSuiteRawData(entry.rawData)
                    };
                });

                const timerAnchorMs = Number(session.globalTimerAnchorMs) > 0
                    ? Number(session.globalTimerAnchorMs)
                    : Number(session.startTime) || completionTime;
                const startTimestamp = timerAnchorMs;
                let pausedOffsetMs = Math.max(0, Number(session.suiteTimerPausedOffsetMs) || 0);
                const pausedAtMs = Number(session.suiteTimerPausedAtMs);
                if (Number.isFinite(pausedAtMs) && pausedAtMs > 0 && completionTime > pausedAtMs) {
                    pausedOffsetMs += (completionTime - pausedAtMs);
                }
                const elapsedMs = Math.max(0, completionTime - startTimestamp - pausedOffsetMs);
                const totalDuration = Math.max(0, Math.round(elapsedMs / 1000));
                const totalCorrect = session.results.reduce((sum, entry) => sum + entry.scoreInfo.correct, 0);
                const totalQuestions = session.results.reduce((sum, entry) => sum + entry.scoreInfo.total, 0);
                const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) : 0;
                const percentage = Math.round(accuracy * 100);

                const aggregatedAnswers = {};
                const aggregatedComparison = {};
                session.results.forEach(entry => {
                    const prefix = entry.examId ? entry.examId + '::' : '';
                    const answersSource = entry.answers && typeof entry.answers === 'object'
                        ? entry.answers
                        : Array.isArray(entry.answers)
                            ? entry.answers.reduce((map, item) => {
                                if (item && item.questionId) {
                                    map[item.questionId] = item.answer || item.userAnswer || '';
                                }
                                return map;
                            }, {})
                            : {};
                    Object.keys(answersSource || {}).forEach(questionId => {
                        aggregatedAnswers[prefix + questionId] = answersSource[questionId];
                    });

                    const comparisonSource = entry.answerComparison && typeof entry.answerComparison === 'object'
                        ? entry.answerComparison
                        : {};
                    Object.keys(comparisonSource).forEach(questionId => {
                        aggregatedComparison[prefix + questionId] = comparisonSource[questionId];
                    });
                });

                const startTime = startTimestamp;
                const startTimeIso = new Date(startTime).toISOString();
                const endTimeIso = new Date(completionTime).toISOString();
                const suiteSequence = await this._resolveSuiteSequenceNumber(startTime);
                const dateLabel = this._formatSuiteDateLabel(startTime);
                const displayTitle = dateLabel + '套题练习' + suiteSequence;

                const builtRecord = {
                    id: session.id,
                    examId: 'suite-' + session.id,
                    title: displayTitle,
                    type: 'reading',
                    suiteMode: true,
                    date: endTimeIso,
                    startTime: startTimeIso,
                    endTime: endTimeIso,
                    duration: totalDuration,
                    totalQuestions,
                    correctAnswers: totalCorrect,
                    accuracy,
                    percentage,
                    scoreInfo: { correct: totalCorrect, total: totalQuestions, accuracy, percentage },
                    answers: aggregatedAnswers,
                    answerComparison: aggregatedComparison,
                    suiteEntries,
                    frequency: 'suite',
                    metadata: {
                        examTitle: displayTitle,
                        category: '套题练习',
                        frequency: 'suite',
                        suiteSequence,
                        suiteDisplayDate: dateLabel,
                        suiteSessionId: session.id,
                        suiteEntryCount: suiteEntries.length,
                        startedAt: startTimeIso,
                        completedAt: endTimeIso
                    },
                    realData: {
                        isRealData: true,
                        source: 'suite_mode',
                        duration: totalDuration,
                        correct: totalCorrect,
                        total: totalQuestions,
                        accuracy,
                        percentage,
                        suiteEntryCount: suiteEntries.length
                    },
                    sessionId: session.id
                };

                const expectedOperationId = `practice-suite:${String(session.id)}:finalize`;
                session.finalizeOperationId = expectedOperationId;
                const persistedRecord = session.finalizeRecord && this._isValidSuiteFinalizeRecord(session, session.finalizeRecord)
                    ? this._cloneSuitePlainObject(session.finalizeRecord)
                    : builtRecord;
                const record = persistedRecord;
                record.operationId = expectedOperationId;
                session.finalizeRecord = this._cloneSuitePlainObject(record);
                if (!await this._commitSuiteRecovery(session, { reason: 'finalize-record' })) {
                    const recoveryError = new Error('Suite finalize recovery state was not committed');
                    recoveryError.code = 'RECOVERY_COMMIT_NOT_CONFIRMED';
                    throw recoveryError;
                }

                await this._saveSuitePracticeRecord(record);
                committed = true;
                session.status = 'completed';
            } catch (error) {
                console.error('[SuitePractice] 保存套题记录失败:', error);
                try {
                    window.showMessage && window.showMessage('套题记录保存失败，恢复快照已保留，请稍后重试。', 'error');
                } catch (notificationError) {
                    console.warn('[SuitePractice] 显示套题保存失败通知时出错:', notificationError);
                }
                session.status = 'finalizing';
                session.lastUpdate = Date.now();
                await this._commitSuiteRecovery(session, { notify: false, reason: 'finalize-error' });
            }

            if (committed) {
                await this._runSuitePostCommitStep('同步套题练习记录', () => this._updatePracticeRecordsState());
                await this._runSuitePostCommitStep('刷新套题总览', () => {
                    this.refreshOverviewData && this.refreshOverviewData();
                });
                await this._runSuitePostCommitStep('显示套题完成通知', () => {
                    window.showMessage && window.showMessage('套题练习已完成，记录已保存。', 'success');
                });
            }

            if (committed && !options.deferTeardown) {
                await this._runSuitePostCommitStep('清理套题会话窗口', () => this._teardownSuiteSession(session));
            }
            return committed;
        },

        async _fetchSuiteExamIndex() {
            const list = await window.resolveActiveLibraryIndex();
            return Array.isArray(list) ? list.filter(Boolean) : [];
        },

        async _listPracticeRecordsViaAPI() {
            const normalizeList = (list) => (Array.isArray(list) ? list : []);

            // Filtering needs suiteEntries and suite markers, but never highlights or notes.
            // The detail projection contains those fields without loading the annotation layer.
            return normalizeList(await window.AppData.practice.list({ projection: 'detail' }));
        },

        async _recalculatePracticeStatsFromRecords() {
            await window.AppData.practice.getStats();
            return true;
        },

        async _loadSuitePracticeRecordsForFiltering() {
            return this._listPracticeRecordsViaAPI();
        },

        _isSuitePracticeRecord(record) {
            if (!record || typeof record !== 'object') {
                return false;
            }
            if (record.suiteMode === true) {
                return true;
            }
            const freq = String(record.frequency || '').toLowerCase();
            const metaFreq = String(record.metadata && record.metadata.frequency || '').toLowerCase();
            return freq === 'suite' || metaFreq === 'suite';
        },

        _collectExamIdsFromPracticeRecord(record, collector) {
            if (!record || typeof record !== 'object' || !(collector instanceof Set)) {
                return;
            }

            const pushExamId = (value) => {
                const normalized = String(value == null ? '' : value).trim();
                if (normalized) {
                    collector.add(normalized);
                }
            };

            pushExamId(record.examId);

            const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : null;
            if (metadata) {
                pushExamId(metadata.examId);
            }

            const rawData = record.rawData && typeof record.rawData === 'object' ? record.rawData : null;
            if (rawData) {
                pushExamId(rawData.examId);
            }

            const suiteEntries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
            suiteEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                pushExamId(entry.examId);
                const entryRawData = entry.rawData && typeof entry.rawData === 'object' ? entry.rawData : null;
                if (entryRawData) {
                    pushExamId(entryRawData.examId);
                }
            });
        },

        async _collectPracticedReadingExamIds() {
            const records = await this._loadSuitePracticeRecordsForFiltering();
            const practicedExamIds = new Set();
            records.forEach((record) => this._collectExamIdsFromPracticeRecord(record, practicedExamIds));
            return practicedExamIds;
        },

        _getCustomSuiteDraftState() {
            if (typeof global.getCustomSuiteDraftState === 'function') {
                return global.getCustomSuiteDraftState();
            }
            if (global.appStateService && typeof global.appStateService.getCustomSuiteDraft === 'function') {
                return global.appStateService.getCustomSuiteDraft();
            }
            if (global.app && global.app.state && global.app.state.ui) {
                return global.app.state.ui.customSuiteDraft || null;
            }
            return global.customSuiteDraft || null;
        },

        _setCustomSuiteDraftState(draft) {
            if (typeof global.setCustomSuiteDraftState === 'function') {
                return global.setCustomSuiteDraftState(draft);
            }
            if (global.appStateService && typeof global.appStateService.setCustomSuiteDraft === 'function') {
                return global.appStateService.setCustomSuiteDraft(draft);
            }
            if (global.app && global.app.state && global.app.state.ui) {
                global.app.state.ui.customSuiteDraft = draft || null;
            }
            try {
                global.customSuiteDraft = draft || null;
            } catch (_) {}
            return draft || null;
        },

        _clearCustomSuiteDraftState() {
            return this._setCustomSuiteDraftState(null);
        },

        _getCustomSuiteCategories() {
            return ['P1', 'P2', 'P3'];
        },

        _buildCustomSuiteExamEntry(exam) {
            if (!exam || typeof exam !== 'object') {
                return null;
            }
            return {
                examId: String(exam.id == null ? '' : exam.id),
                title: typeof exam.title === 'string' ? exam.title : '',
                category: typeof exam.category === 'string' ? exam.category.trim().toUpperCase() : '',
                frequency: typeof exam.frequency === 'string' ? exam.frequency : '',
                type: typeof exam.type === 'string' ? exam.type : 'reading',
                hasHtml: !!exam.hasHtml
            };
        },

        _buildCustomSuiteSelectionDraft(flowMode, frequencyScope) {
            const categories = this._getCustomSuiteCategories();
            const now = Date.now();
            return {
                status: 'selecting',
                stageIndex: 0,
                categories,
                pickedByCategory: {},
                pickedOrder: [],
                flowMode: flowMode || 'classic',
                frequencyScope: frequencyScope || 'custom',
                createdAt: now,
                updatedAt: now
            };
        },

        async _startCustomSuiteSelection(options = {}) {
            const flowMode = options.flowMode || 'classic';
            const frequencyScope = options.frequencyScope || 'custom';
            const examIndex = await this._fetchSuiteExamIndex();
            if (!examIndex.length) {
                window.showMessage && window.showMessage('题库为空，无法启动自选流程。', 'warning');
                return false;
            }

            const normalizedIndex = examIndex
                .map(item => {
                    if (!item || typeof item !== 'object') {
                        return null;
                    }
                    const normalizedType = String(item.type || 'reading').toLowerCase();
                    const normalizedCategory = typeof item.category === 'string'
                        ? item.category.trim().toUpperCase()
                        : '';
                    if (normalizedType !== 'reading') {
                        return null;
                    }
                    return {
                        ...item,
                        type: 'reading',
                        category: normalizedCategory
                    };
                })
                .filter(Boolean);

            const categories = this._getCustomSuiteCategories();
            for (const category of categories) {
                const pool = normalizedIndex.filter(item => item.category === category);
                if (!pool.length) {
                    window.showMessage && window.showMessage('当前题库缺少 ' + category + ' 阅读题目，无法启动自选流程。', 'warning');
                    return false;
                }
            }

            this._setCustomSuiteDraftState(this._buildCustomSuiteSelectionDraft(flowMode, frequencyScope));

            if (typeof global.setBrowseTitle === 'function') {
                try {
                    global.setBrowseTitle('套题自选');
                } catch (_) {}
            }

            const firstCategory = categories[0];
            if (typeof global.browseCategory === 'function') {
                global.browseCategory(firstCategory, 'reading');
            } else if (typeof global.showView === 'function') {
                global.__pendingBrowseFilter = {
                    category: firstCategory,
                    type: 'reading',
                    filterMode: null,
                    path: null
                };
                global.showView('browse', false);
            }

            if (typeof global.loadExamList === 'function') {
                try {
                    global.loadExamList();
                } catch (_) {}
            }

            return true;
        },

        async _buildCustomSuiteSequenceFromDraft(draft) {
            const examIndex = await this._fetchSuiteExamIndex();
            const examMap = new Map(
                Array.isArray(examIndex)
                    ? examIndex
                        .filter(item => item && item.id != null)
                        .map(item => [String(item.id), item])
                    : []
            );

            const pickedOrder = draft && Array.isArray(draft.pickedOrder) ? draft.pickedOrder : [];
            return pickedOrder
                .map((entry) => {
                    if (!entry || !entry.examId) {
                        return null;
                    }
                    const exam = examMap.get(String(entry.examId));
                    if (!exam) {
                        return null;
                    }
                    return {
                        examId: exam.id,
                        exam
                    };
                })
                .filter(Boolean);
        },

        async confirmCustomSuiteSelection() {
            const draft = this._getCustomSuiteDraftState();
            if (!draft || draft.status !== 'ready') {
                window.showMessage && window.showMessage('当前尚未完成三篇自选，请继续选择后再确认。', 'warning');
                return false;
            }

            const sequence = await this._buildCustomSuiteSequenceFromDraft(draft);
            if (!sequence.length) {
                window.showMessage && window.showMessage('自选题目无法启动，请重新选择。', 'warning');
                return false;
            }

            const started = await this._launchSuiteSessionFromSequence(sequence, {
                flowMode: draft.flowMode || 'classic',
                frequencyScope: draft.frequencyScope || 'custom',
                suiteWindowName: 'ielts-suite-mode-tab',
                launchLabel: '自选套题'
            });

            if (started) {
                this._clearCustomSuiteDraftState();
            }

            return started;
        },

        async cancelCustomSuiteSelection() {
            this._clearCustomSuiteDraftState();
            if (typeof global.resetBrowseViewToAll === 'function') {
                try {
                    global.resetBrowseViewToAll();
                } catch (_) {}
            }
            return true;
        },

        async _launchSuiteSessionFromSequence(sequence, options = {}) {
            const requestedSuiteWindowName = options.suiteWindowName || 'ielts-suite-mode-tab';
            const flowMode = options.flowMode || 'simulation';
            const frequencyScope = options.frequencyScope || 'all';
            const launchLabel = options.launchLabel || (
                flowMode === 'stationary'
                    ? '驻足模式'
                    : (flowMode === 'simulation' ? '模拟模式' : '经典模式')
            );
            const normalizedSequence = Array.isArray(sequence)
                ? sequence.filter(item => item && item.examId && item.exam)
                : [];
            if (!normalizedSequence.length) {
                window.showMessage && window.showMessage('未找到可用的套题题目。', 'warning');
                return false;
            }
            if (typeof this.openExam !== 'function') {
                window.showMessage && window.showMessage('当前版本暂不支持套题练习自动打开题目。', 'error');
                return false;
            }
            if (this.currentSuiteSession
                && ['active', 'initializing', 'finalizing'].includes(this.currentSuiteSession.status)) {
                window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                return false;
            }
            const suiteSessionId = this._generateSuiteSessionId();
            const suiteWindowName = this._resolveSuiteWindowName(suiteSessionId, requestedSuiteWindowName);
            const firstEntry = normalizedSequence[0];
            let launchOwnership = null;
            let launchSession = null;
            let initialDurableReceiptConfirmed = false;

            try {
                if (this.currentSuiteSession && this.currentSuiteSession.status === 'completed') {
                    const completedSession = this.currentSuiteSession;
                    const tornDown = await this._teardownSuiteSession(completedSession);
                    if (!tornDown || this.currentSuiteSession) {
                        window.showMessage && window.showMessage('上一套题记录已保存，但恢复状态尚未安全清理，请稍后重试。', 'warning');
                        return false;
                    }
                }
                if (this.currentSuiteSession && ['active', 'initializing', 'finalizing'].includes(this.currentSuiteSession.status)) {
                    window.showMessage && window.showMessage('套题练习正在进行中，请先完成当前套题。', 'warning');
                    return false;
                }

                // Completed-session teardown may yield and fail. Reserve the first target
                // only after it succeeds, but before the first launch-related await.
                launchOwnership = this._beginSuiteExamLaunchOwnership(firstEntry.examId, {
                    windowName: suiteWindowName
                });

                this._clearSuiteHandshakes();

                const lockedAutoAdvance = flowMode === 'stationary'
                    ? false
                    : true;
                const timerAnchorMs = Date.now();
                const suiteTimerMode = 'countdown';
                const suiteTimerLimitSeconds = 3600;
                const session = {
                    id: suiteSessionId,
                    _suiteGeneration: (this._suiteSessionGeneration = Math.max(0, Number(this._suiteSessionGeneration) || 0) + 1),
                    _lastDurableRecoveryRevision: 0,
                    status: 'active',
                    startTime: timerAnchorMs,
                    sequence: normalizedSequence,
                    currentIndex: 0,
                    results: [],
                    draftsByExam: {},
                    elapsedByExam: {},
                    globalTimerAnchorMs: timerAnchorMs,
                    suiteTimerAnchorMs: timerAnchorMs,
                    suiteTimerMode,
                    suiteTimerLimitSeconds,
                    suiteTimerPausedOffsetMs: 0,
                    suiteTimerPausedAtMs: null,
                    suiteTimerRunning: true,
                    flowMode,
                    frequencyScope,
                    autoAdvanceAfterSubmit: lockedAutoAdvance,
                    activeExamId: firstEntry.examId,
                    windowRef: null,
                    windowName: suiteWindowName
                };
                launchSession = session;
                if (!await this._acquireSuiteRecoveryClaim('single', session)) {
                    if (launchOwnership && typeof this._rollbackExamLaunchOwnership === 'function') {
                        this._rollbackExamLaunchOwnership(launchOwnership);
                    }
                    return false;
                }
                if (!this._isSuiteExamLaunchOwnershipCurrent(firstEntry.examId, launchOwnership)) {
                    if (launchOwnership && typeof this._rollbackExamLaunchOwnership === 'function') {
                        this._rollbackExamLaunchOwnership(launchOwnership);
                    }
                    await this._releaseSuiteRecoveryClaim('single', session);
                    return false;
                }
                this.currentSuiteSession = session;
                session.lastUpdate = Date.now();
                const initialLaunchStillOwned = () => this.currentSuiteSession === session
                    && String(session.activeExamId || '') === String(firstEntry.examId)
                    && this._isSuiteExamLaunchOwnershipCurrent(firstEntry.examId, launchOwnership);
                const recoveryCommitted = await this._commitSuiteRecovery(session, {
                    reason: 'suite-start',
                    commitGuard: initialLaunchStillOwned,
                    onDurableReceipt: () => { initialDurableReceiptConfirmed = true; }
                });
                if (!recoveryCommitted) {
                    if (initialDurableReceiptConfirmed) {
                        session.windowRef = null;
                        session._restoredFromStorage = true;
                        this._registerSuiteSequence(session);
                        return false;
                    }
                    if (launchOwnership && typeof this._rollbackExamLaunchOwnership === 'function') {
                        this._rollbackExamLaunchOwnership(launchOwnership);
                    }
                    if (this.currentSuiteSession === session) this.currentSuiteSession = null;
                    this._clearSessionStorage(session);
                    await this._releaseSuiteRecoveryClaim('single', session);
                    return false;
                }
                if (!this._isSuiteExamLaunchOwnershipCurrent(firstEntry.examId, launchOwnership)) {
                    session.windowRef = null;
                    session._restoredFromStorage = true;
                    this._registerSuiteSequence(session);
                    return false;
                }
                this._registerSuiteSequence(session);

                window.showMessage && window.showMessage(launchLabel + ' 已启动，正在打开第一篇。', 'info');

                let examWindow = null;
                let targetRegistration = null;
                try {
                    const openOptions = {
                        examDefinition: firstEntry.exam,
                        target: 'tab',
                        windowName: suiteWindowName,
                        suiteSessionId,
                        suiteFlowMode: flowMode,
                        suiteTimerMode,
                        suiteTimerLimitSeconds,
                        sequenceIndex: 0,
                        sequenceTotal: normalizedSequence.length
                    };
                    if (launchOwnership) openOptions.launchOwnership = launchOwnership;
                    examWindow = await this.openExam(firstEntry.examId, openOptions);
                    if (examWindow && !examWindow.closed) {
                        targetRegistration = this._captureSuiteNavigationRegistration(
                            firstEntry.examId,
                            examWindow,
                            session,
                            launchOwnership
                        );
                    }
                } catch (openError) {
                    console.error('[SuitePractice] 打开首篇失败:', openError);
                    examWindow = null;
                }

                if (!examWindow || examWindow.closed
                    || !targetRegistration
                    || targetRegistration.window !== examWindow
                    || !this._isSuiteNavigationRegistrationCurrent(
                        firstEntry.examId,
                        targetRegistration,
                        session
                    )) {
                    session.windowRef = null;
                    session._restoredFromStorage = true;
                    window.showMessage && window.showMessage('首篇窗口未能打开，套题已安全保存；允许弹窗后可继续。', 'warning');
                    return false;
                }

                session.windowRef = examWindow;
                this._ensureSuiteWindowGuard(session, session.windowRef);
                session._restoredFromStorage = false;
                session.lastUpdate = Date.now();
                this._focusSuiteWindow(session.windowRef);
                if (flowMode === 'simulation') {
                    this._sendSimulationContext(session, firstEntry.examId, session.windowRef);
                }
                return this._isSuiteNavigationRegistrationCurrent(
                    firstEntry.examId,
                    targetRegistration,
                    session
                );
            } catch (error) {
                console.error('[SuitePractice] 启动失败:', error);
                if (!initialDurableReceiptConfirmed) {
                    if (launchOwnership && typeof this._rollbackExamLaunchOwnership === 'function') {
                        this._rollbackExamLaunchOwnership(launchOwnership);
                    }
                    if (launchSession && this.currentSuiteSession === launchSession) {
                        this.currentSuiteSession = null;
                        this._clearSessionStorage(launchSession);
                    }
                    if (launchSession && this._ownsSuiteRecoveryClaim('single', launchSession)) {
                        await this._releaseSuiteRecoveryClaim('single', launchSession);
                    }
                }
                window.showMessage && window.showMessage('套题练习启动失败，请稍后重试。', 'error');
                return false;
            }
        },
        _generateSuiteSessionId() {
            return 'suite_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 8);
        },

        _resolveSuiteWindowName(sessionId, requestedName = 'ielts-suite-mode-tab') {
            const id = String(sessionId || '').trim();
            const base = String(requestedName || 'ielts-suite-mode-tab').trim() || 'ielts-suite-mode-tab';
            if (!id || base.endsWith(`-${id}`)) return base;
            return `${base}-${id}`;
        },

        _registerSuiteSequence(session) {
            if (!this.suiteExamMap) {
                this.suiteExamMap = new Map();
            }

            session.sequence.forEach(item => {
                this.suiteExamMap.set(item.examId, session.id);
            });
        },

        _resolveSuiteSessionId(examId, windowInfo = {}) {
            if (windowInfo && windowInfo.suiteSessionId) {
                return windowInfo.suiteSessionId;
            }

            if (this.suiteExamMap && this.suiteExamMap.has(examId)) {
                return this.suiteExamMap.get(examId);
            }

            if (this.currentSuiteSession && this.currentSuiteSession.activeExamId === examId) {
                return this.currentSuiteSession.id;
            }

            return null;
        },

        _normalizeSuiteResult(exam, rawData) {
            const toNumber = (value, fallback = 0) => {
                if (value == null) {
                    return fallback;
                }
                const normalized = typeof value === 'string' && value.trim() !== ''
                    ? Number(value.trim())
                    : Number(value);
                return Number.isFinite(normalized) ? normalized : fallback;
            };

            const score = rawData && rawData.scoreInfo ? rawData.scoreInfo : {};
            const answers = rawData && rawData.answers ? rawData.answers : {};
            const comparison = rawData && rawData.answerComparison
                ? rawData.answerComparison
                : (score && score.details ? score.details : {});
            const correctAnswerMap = typeof this._resolveReplayCorrectAnswerMap === 'function'
                ? this._resolveReplayCorrectAnswerMap(rawData, { examId: exam && exam.id, comparison })
                : {};

            const correct = toNumber(score.correct, 0);
            const total = toNumber(score.total, Object.keys(answers).length);

            const normalizedAccuracy = Number.isFinite(score.accuracy)
                ? score.accuracy
                : toNumber(score.accuracy, Number.NaN);
            const accuracy = Number.isFinite(normalizedAccuracy)
                ? normalizedAccuracy
                : (total > 0 ? correct / total : 0);

            const normalizedPercentage = Number.isFinite(score.percentage)
                ? score.percentage
                : toNumber(score.percentage, accuracy * 100);
            const percentageBase = Number.isFinite(normalizedPercentage)
                ? normalizedPercentage
                : (accuracy * 100);
            const percentage = Math.round(percentageBase);
            const duration = toNumber(rawData?.duration, 0);

            return {
                examId: exam.id,
                title: exam.title,
                category: exam.category,
                duration,
                scoreInfo: {
                    correct,
                    total,
                    accuracy,
                    percentage,
                    source: score && score.source ? score.source : 'suite_mode_aggregated'
                },
                answers,
                correctAnswerMap,
                answerComparison: comparison,
                markedQuestions: Array.isArray(rawData?.metadata?.markedQuestions)
                    ? rawData.metadata.markedQuestions.slice()
                    : (Array.isArray(rawData?.markedQuestions) ? rawData.markedQuestions.slice() : []),
                rawData: this._sanitizeSuiteRawData(rawData)
            };
        },

        _isValidSuiteScoreInfo(scoreInfo) {
            if (!scoreInfo || typeof scoreInfo !== 'object' || Array.isArray(scoreInfo)) return false;
            const correct = Number(scoreInfo.correct);
            const total = Number(scoreInfo.total);
            const accuracy = Number(scoreInfo.accuracy);
            const percentage = Number(scoreInfo.percentage);
            return Boolean(
                Number.isFinite(correct)
                && Number.isFinite(total)
                && Number.isFinite(accuracy)
                && Number.isFinite(percentage)
                && correct >= 0
                && total >= 0
                && correct <= total
                && accuracy >= 0
                && accuracy <= 1
                && percentage >= 0
                && percentage <= 100
            );
        },

        _isValidSuiteRecoveryResult(entry, sequenceIds = []) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
            const examId = String(entry.examId || '').trim();
            const duration = Number(entry.duration);
            return Boolean(
                examId
                && (!sequenceIds.length || sequenceIds.includes(examId))
                && Number.isFinite(duration)
                && duration >= 0
                && this._isValidSuiteScoreInfo(entry.scoreInfo)
                && entry.answers
                && typeof entry.answers === 'object'
                && entry.answerComparison
                && typeof entry.answerComparison === 'object'
            );
        },

        _isValidSuiteFinalizeEntry(entry, sequenceIds = []) {
            return Boolean(
                this._isValidSuiteRecoveryResult(entry, sequenceIds)
                && Array.isArray(entry.markedQuestions)
                && Array.isArray(entry.highlights)
                && typeof entry.noteText === 'string'
                && Array.isArray(entry.notes)
                && Array.isArray(entry.noteOutlines)
                && Number.isFinite(Number(entry.scrollY))
            );
        },

        _isValidSuiteFinalizeRecord(session, record) {
            if (!session || !record || typeof record !== 'object') return false;
            const sequenceIds = Array.isArray(session.sequence)
                ? session.sequence.map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean)
                : [];
            const recordEntries = Array.isArray(record.suiteEntries) ? record.suiteEntries : [];
            const recordIds = recordEntries
                .map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean);
            const results = Array.isArray(session.results) ? session.results : [];
            const resultIds = results.map((entry) => entry && String(entry.examId || '').trim()).filter(Boolean);
            const expectedAnswers = {};
            const expectedComparison = {};
            let expectedCorrect = 0;
            let expectedTotal = 0;
            results.forEach((entry) => {
                const examId = String(entry && entry.examId || '').trim();
                const prefix = examId ? `${examId}::` : '';
                expectedCorrect += Number(entry && entry.scoreInfo && entry.scoreInfo.correct) || 0;
                expectedTotal += Number(entry && entry.scoreInfo && entry.scoreInfo.total) || 0;
                Object.entries(entry && entry.answers && typeof entry.answers === 'object' ? entry.answers : {})
                    .forEach(([questionId, answer]) => {
                        expectedAnswers[prefix + questionId] = answer;
                    });
                Object.entries(entry && entry.answerComparison && typeof entry.answerComparison === 'object' ? entry.answerComparison : {})
                    .forEach(([questionId, comparison]) => {
                        expectedComparison[prefix + questionId] = comparison;
                    });
            });
            const expectedAccuracy = expectedTotal > 0 ? expectedCorrect / expectedTotal : 0;
            const expectedPercentage = Math.round(expectedAccuracy * 100);
            const scoreInfo = record.scoreInfo;
            const numericMatches = (left, right) => Number.isFinite(Number(left)) && Number(left) === Number(right);
            return Boolean(
                session.id
                && String(record.id || '') === String(session.id)
                && String(record.sessionId || '') === String(session.id)
                && sequenceIds.length > 0
                && record.examId === `suite-${String(session.id)}`
                && record.type === 'reading'
                && record.suiteMode === true
                && record.frequency === 'suite'
                && typeof record.title === 'string'
                && typeof record.date === 'string'
                && typeof record.startTime === 'string'
                && typeof record.endTime === 'string'
                && Number.isFinite(Number(record.duration))
                && Number(record.duration) >= 0
                && this._isValidSuiteScoreInfo(scoreInfo)
                && numericMatches(record.totalQuestions, expectedTotal)
                && numericMatches(record.correctAnswers, expectedCorrect)
                && numericMatches(scoreInfo.correct, expectedCorrect)
                && numericMatches(scoreInfo.total, expectedTotal)
                && Math.abs(Number(scoreInfo.accuracy) - expectedAccuracy) < 1e-9
                && Number(scoreInfo.percentage) === expectedPercentage
                && this._suiteValuesEqual(record.answers, expectedAnswers)
                && this._suiteValuesEqual(record.answerComparison, expectedComparison)
                && recordEntries.length === sequenceIds.length
                && recordIds.length === sequenceIds.length
                && new Set(recordIds).size === recordIds.length
                && recordIds.every((examId, index) => examId === sequenceIds[index])
                && resultIds.length === sequenceIds.length
                && new Set(resultIds).size === resultIds.length
                && resultIds.every((examId) => sequenceIds.includes(examId))
                && recordEntries.every((entry, index) => {
                    const result = results.find((candidate) => String(candidate && candidate.examId || '').trim() === sequenceIds[index]);
                    return this._isValidSuiteFinalizeEntry(entry, sequenceIds)
                        && result
                        && numericMatches(entry.duration, result.duration)
                        && this._suiteValuesEqual(entry.scoreInfo, result.scoreInfo)
                        && this._suiteValuesEqual(entry.answers, result.answers)
                        && this._suiteValuesEqual(entry.answerComparison, result.answerComparison);
                })
                && record.metadata
                && typeof record.metadata === 'object'
                && String(record.metadata.suiteSessionId || '') === String(session.id)
                && Number(record.metadata.suiteEntryCount) === sequenceIds.length
                && record.realData
                && typeof record.realData === 'object'
                && record.realData.source === 'suite_mode'
                && numericMatches(record.realData.correct, expectedCorrect)
                && numericMatches(record.realData.total, expectedTotal)
                && numericMatches(record.realData.duration, record.duration)
                && typeof record.operationId === 'string'
                && record.operationId === `practice-suite:${String(session.id)}:finalize`
            );
        },

        async _saveSuitePracticeRecord(record) {
            const childSessionIds = [];
            (Array.isArray(record && record.suiteEntries) ? record.suiteEntries : []).forEach((entry) => {
                const raw = entry && entry.rawData || {};
                const sessionId = raw.sessionId || (entry && (entry.sessionId || entry.suiteEntrySessionId));
                if (sessionId && String(sessionId) !== String(record.sessionId || '')) childSessionIds.push(String(sessionId));
            });
            const receipt = await window.AppData.practice.finalizeSuite({
                record,
                childSessionIds,
                operationId: record.operationId
            });
            if (!receipt || receipt.committed !== true) {
                const error = new Error('Suite aggregate commit was not confirmed');
                error.code = 'SUITE_COMMIT_NOT_CONFIRMED';
                throw error;
            }
            return receipt.record || record;
        },

        async _cleanupSuiteEntryRecords(record) {
            if (!record || !Array.isArray(record.suiteEntries) || record.suiteEntries.length === 0) {
                return;
            }

            const entrySessionIds = new Set();

            record.suiteEntries.forEach((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const raw = entry.rawData || {};
                const sessionId = raw.sessionId || entry.sessionId || entry.suiteEntrySessionId || null;
                if (sessionId) {
                    entrySessionIds.add(String(sessionId));
                }
            });

            if (entrySessionIds.size === 0) {
                console.warn('[SuitePractice] 跳过套题子记录清理：suiteEntries 缺少 sessionId，不能用 examId/时间窗口猜测删除');
                return;
            }

            if (record.sessionId) {
                entrySessionIds.delete(String(record.sessionId));
            }
            if (entrySessionIds.size === 0) {
                return;
            }

            // Child cleanup is committed atomically by practice.finalizeSuite.
        },

        async _updatePracticeRecordsState() {
            try {
                if (typeof window.syncPracticeRecords === 'function') {
                    await window.syncPracticeRecords({ forceRender: true });
                    return;
                } else {
                    const [latest, index] = await Promise.all([
                        window.AppData.practice.list({ projection: 'light' }),
                        window.resolveActiveLibraryIndex()
                    ]);
                    if (typeof window.refreshBrowseProgressFromRecords === 'function') {
                        window.refreshBrowseProgressFromRecords(latest, index);
                    }
                    if (typeof window.updatePracticeView === 'function') {
                        window.updatePracticeView(latest, index);
                    }
                }
            } catch (error) {
                console.warn('[SuitePractice] 同步练习记录失败:', error);
            }
        },

        _formatSuiteDateLabel(timestamp) {
            const date = new Date(timestamp);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return month + '月' + day + '日';
        },

        async _resolveSuiteSequenceNumber(timestamp) {
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) {
                return 1;
            }

            const targetYear = date.getFullYear();
            const targetMonth = date.getMonth();
            const targetDate = date.getDate();

            const existingRecords = await this._listPracticeRecordsViaAPI();

            const resolveRecordDate = record => {
                const candidates = [
                    record.startTime,
                    record.metadata && record.metadata.startedAt,
                    record.date,
                    record.endTime,
                    record.metadata && record.metadata.completedAt
                ];

                for (const value of candidates) {
                    if (!value) {
                        continue;
                    }
                    const parsed = new Date(value);
                    if (!Number.isNaN(parsed.getTime())) {
                        return parsed;
                    }
                }

                return null;
            };

            let count = 0;
            for (const record of existingRecords) {
                if (!this._isSuitePracticeRecord(record)) {
                    continue;
                }

                const recordDate = resolveRecordDate(record);
                if (!recordDate) {
                    continue;
                }

                if (
                    recordDate.getFullYear() === targetYear
                    && recordDate.getMonth() === targetMonth
                    && recordDate.getDate() === targetDate
                ) {
                    count += 1;
                }
            }

            return count + 1;
        },

        _focusSuiteWindow(targetWindow) {
            if (!targetWindow || targetWindow.closed) {
                return;
            }

            try {
                if (typeof targetWindow.focus === 'function') {
                    targetWindow.focus();
                }
            } catch (_) {}
        },

        _safelyCloseWindow(targetWindow) {
            if (!targetWindow) {
                return;
            }

            if (typeof window !== 'undefined' && targetWindow === window) {
                return;
            }

            if (targetWindow.closed) {
                return;
            }

            try {
                targetWindow.close();
            } catch (error) {
                console.warn('[SuitePractice] 关闭套题窗口被拦截:', error);
            }
        },

        _isSuiteSessionCurrentOwner(session) {
            if (!session || !this.currentSuiteSession) {
                return true;
            }
            const current = this.currentSuiteSession;
            if (current === session) {
                return true;
            }
            if (String(current.id || '') !== String(session.id || '')) {
                return false;
            }
            const currentGeneration = Number(current._suiteGeneration);
            const sessionGeneration = Number(session._suiteGeneration);
            return Number.isFinite(currentGeneration)
                && currentGeneration > 0
                && currentGeneration === sessionGeneration;
        },

        _captureSuiteTeardownRegistrations(session) {
            const registrations = new Map();
            const binding = session && session.windowBinding && typeof session.windowBinding === 'object'
                ? session.windowBinding
                : null;
            const examId = String(binding && binding.examId || '').trim();
            const expectedSessionId = String(binding && binding.expectedSessionId || '').trim();
            const windowSessionToken = String(binding && binding.windowSessionToken || '').trim();
            const sessionGeneration = Number(binding && binding.sessionGeneration);
            if (!examId
                || !expectedSessionId
                || !windowSessionToken
                || !Number.isInteger(sessionGeneration)
                || sessionGeneration <= 0) {
                return registrations;
            }

            const current = this.examWindows && this.examWindows.get(examId);
            const suiteWindow = session.windowRef || (current && current.window) || null;
            const exactCurrent = Boolean(
                current
                && current.window === suiteWindow
                && String(current.suiteSessionId || '') === String(session.id || '')
                && String(current.expectedSessionId || '') === expectedSessionId
                && String(current.windowSessionToken || '') === windowSessionToken
                && Number(current.sessionGeneration) === sessionGeneration
            );
            registrations.set(examId, {
                windowInfo: exactCurrent ? current : null,
                window: suiteWindow,
                suiteSessionId: session.id,
                expectedSessionId,
                windowSessionToken,
                sessionGeneration
            });
            return registrations;
        },

        _isSuiteTeardownRegistrationCurrent(examId, registration) {
            if (typeof this._isExamSessionRegistrationCurrent === 'function') {
                return this._isExamSessionRegistrationCurrent(examId, registration);
            }
            const current = this.examWindows && this.examWindows.get(examId);
            return Boolean(
                registration
                && registration.windowInfo
                && current === registration.windowInfo
                && current.window === registration.window
                && String(current.suiteSessionId || '') === String(registration.suiteSessionId || '')
                && String(current.expectedSessionId || '') === String(registration.expectedSessionId || '')
                && String(current.windowSessionToken || '') === String(registration.windowSessionToken || '')
                && Number(current.sessionGeneration) === Number(registration.sessionGeneration)
            );
        },

        _isSuiteWindowReassigned(targetWindow, registrations) {
            if (!targetWindow) {
                return false;
            }
            const remembered = this._reassignedExamWindowRegistrations
                && this._reassignedExamWindowRegistrations.get(targetWindow);
            if (remembered && remembered.size) {
                for (const [examId, registration] of registrations || []) {
                    const marker = typeof this._buildExamWindowRegistrationMarker === 'function'
                        ? this._buildExamWindowRegistrationMarker(examId, registration)
                        : JSON.stringify([
                            String(examId || ''),
                            String(registration && registration.suiteSessionId || ''),
                            String(registration && registration.expectedSessionId || ''),
                            String(registration && registration.windowSessionToken || ''),
                            Number.isInteger(Number(registration && registration.sessionGeneration))
                                ? Number(registration.sessionGeneration)
                                : null
                        ]);
                    if (remembered.has(marker)) {
                        return true;
                    }
                }
            }
            if (!this.examWindows) {
                return false;
            }
            for (const [examId, current] of this.examWindows.entries()) {
                if (!current || current.window !== targetWindow) {
                    continue;
                }
                const registration = registrations && registrations.get(String(examId));
                if (!registration || !this._isSuiteTeardownRegistrationCurrent(examId, registration)) {
                    return true;
                }
            }
            return false;
        },

        _clearSuiteWindowReassignmentMarkers(targetWindow, registrations) {
            const remembered = targetWindow
                && this._reassignedExamWindowRegistrations
                && this._reassignedExamWindowRegistrations.get(targetWindow);
            if (!remembered || !remembered.size) return;
            for (const [examId, registration] of registrations || []) {
                const marker = typeof this._buildExamWindowRegistrationMarker === 'function'
                    ? this._buildExamWindowRegistrationMarker(examId, registration)
                    : JSON.stringify([
                        String(examId || ''),
                        String(registration && registration.suiteSessionId || ''),
                        String(registration && registration.expectedSessionId || ''),
                        String(registration && registration.windowSessionToken || ''),
                        Number.isInteger(Number(registration && registration.sessionGeneration))
                            ? Number(registration.sessionGeneration)
                            : null
                    ]);
                remembered.delete(marker);
            }
            if (!remembered.size) {
                this._reassignedExamWindowRegistrations.delete(targetWindow);
            }
        },

        _isSuiteOperationOwner(session) {
            return Boolean(
                session
                && this.currentSuiteSession
                && this._isSuiteSessionCurrentOwner(session)
                && session._suiteTeardownInProgress !== true
                && session._suiteRecoveryWritesBlocked !== true
            );
        },

        _canContinueSuiteOperation(session) {
            return this._isSuiteOperationOwner(session) && session.status === 'active';
        },

        async _teardownSuiteSession(session) {
            if (!session) {
                return false;
            }
            if (session._teardownPromise && typeof session._teardownPromise.then === 'function') {
                return session._teardownPromise;
            }
            const teardownPromise = this._teardownSuiteSessionInternal(session);
            session._teardownPromise = teardownPromise;
            try {
                return await teardownPromise;
            } finally {
                if (session._teardownPromise === teardownPromise) {
                    session._teardownPromise = null;
                }
            }
        },

        async _freezeSuiteRecoveryWrites(session) {
            if (!session) return false;
            session._suiteRecoveryWritesBlocked = true;
            const pending = session._suiteRecoveryCommitTail;
            if (pending && typeof pending.then === 'function') {
                try {
                    await pending;
                } catch (_) {}
            }
            return true;
        },

        async _teardownSuiteSessionInternal(session) {
            // A delayed receipt teardown must never own a newer suite session.
            if (!this._isSuiteSessionCurrentOwner(session)) {
                return false;
            }

            // Capture the completed suite's exact binding before teardown yields. A normal
            // practice may reuse both the exam id and WindowProxy while persistence drains.
            const teardownRegistrations = session._suiteTeardownRegistrations instanceof Map
                ? session._suiteTeardownRegistrations
                : this._captureSuiteTeardownRegistrations(session);
            session._suiteTeardownRegistrations = teardownRegistrations;
            const frozenWindowEntry = Array.from(teardownRegistrations.entries())
                .find(([, registration]) => registration && registration.window);
            const frozenWindowRegistration = frozenWindowEntry && frozenWindowEntry[1];
            const suiteWindow = frozenWindowRegistration
                ? frozenWindowRegistration.window
                : session.windowRef;

            const writesWereBlocked = session._suiteRecoveryWritesBlocked === true;
            session._suiteTeardownInProgress = true;
            await this._freezeSuiteRecoveryWrites(session);
            if (!this._isSuiteSessionCurrentOwner(session)) {
                session._suiteRecoveryWritesBlocked = writesWereBlocked;
                session._suiteTeardownInProgress = false;
                return false;
            }
            if (!await this._discardPersistentSuiteRecovery(session)) {
                session._suiteRecoveryWritesBlocked = writesWereBlocked;
                session._suiteTeardownInProgress = false;
                return false;
            }
            if (session.submitReceiptTeardownTimer) {
                clearTimeout(session.submitReceiptTeardownTimer);
                session.submitReceiptTeardownTimer = null;
            }

            this._clearSuiteHandshakes();

            const suiteWindowWasReassigned = this._isSuiteWindowReassigned(suiteWindow, teardownRegistrations);
            const suiteWindowRegistrationIsCurrent = Boolean(
                frozenWindowEntry
                && this._isSuiteTeardownRegistrationCurrent(frozenWindowEntry[0], frozenWindowRegistration)
            );
            const currentFrozenExamRegistration = frozenWindowEntry && this.examWindows
                ? this.examWindows.get(frozenWindowEntry[0])
                : null;
            const suiteWindowWasDisplaced = Boolean(
                frozenWindowEntry
                && currentFrozenExamRegistration
                && currentFrozenExamRegistration !== frozenWindowRegistration.windowInfo
                && currentFrozenExamRegistration.window
                && currentFrozenExamRegistration.window !== suiteWindow
            );
            const suiteWindowCloseOwnershipProven = suiteWindowRegistrationIsCurrent || suiteWindowWasDisplaced;
            if (!suiteWindowWasReassigned
                && suiteWindowRegistrationIsCurrent
                && suiteWindow
                && !suiteWindow.closed
                && typeof suiteWindow.postMessage === 'function') {
                try {
                    this._postExamMessage(frozenWindowEntry[0], suiteWindow, 'SUITE_FORCE_CLOSE', {
                        suiteSessionId: session.id || null
                    });
                } catch (forceCloseError) {
                    console.warn('[SuitePractice] 无法通知套题窗口关闭:', forceCloseError);
                }
            }

            this._releaseSuiteWindowGuard(suiteWindow, session.id);
            if (!suiteWindowWasReassigned && suiteWindowCloseOwnershipProven) {
                this._safelyCloseWindow(suiteWindow);
            }
            this._clearSuiteWindowReassignmentMarkers(suiteWindow, teardownRegistrations);

            if (this.cleanupExamSession && teardownRegistrations.size) {
                const cleanupTasks = Array.from(teardownRegistrations.entries()).map(([examId, expectedRegistration]) => (
                    this.cleanupExamSession(examId, { expectedRegistration })
                ));
                await Promise.allSettled(cleanupTasks);
            }

            if (this.suiteExamMap) {
                session.sequence && session.sequence.forEach(item => {
                    if (item && item.examId != null
                        && this.suiteExamMap.get(String(item.examId)) === session.id) {
                        this.suiteExamMap.delete(String(item.examId));
                    }
                });
            }

            if (this.currentSuiteSession && this._isSuiteSessionCurrentOwner(session)) {
                if (session._suitePendingTerminalStatus) {
                    session.status = session._suitePendingTerminalStatus;
                }
                this.currentSuiteSession = null;
            }

            session.windowRef = null;
            session._suiteTeardownInProgress = false;
            delete session._suiteTeardownRegistrations;
            delete session._suitePendingTerminalStatus;
            if (typeof this._clearSuiteHandshakes === 'function') {
                this._clearSuiteHandshakes();
            }
            this._clearSessionStorage(session);
            await this._releaseSuiteRecoveryClaim('single', session);
            return true;
        },

        async _abortSuiteSession(session, options = {}) {
            if (!session) {
                return false;
            }
            if (session._finalizePromise && typeof session._finalizePromise.then === 'function') {
                if (options.reason === 'user_discard') {
                    window.showMessage && window.showMessage('套题正在完成保存，请稍候。', 'warning');
                }
                return false;
            }

            session._suitePendingTerminalStatus = 'aborted';
            const tornDown = await this._teardownSuiteSession(session);
            if (!tornDown) {
                delete session._suitePendingTerminalStatus;
                // A failed user abort leaves an active suite free to navigate or
                // rebind before the next attempt. Re-capture that live ownership
                // instead of reusing the failed attempt's stale window snapshot.
                // Completed receipt teardown retries intentionally keep theirs.
                if (session.status !== 'completed') {
                    delete session._suiteTeardownRegistrations;
                }
            }
            return tornDown;
        },

        _openNamedSuiteWindow(windowName, session = null) {
            const normalizedName = typeof windowName === 'string' && windowName.trim()
                ? windowName.trim()
                : 'ielts-suite-mode-tab';

            let reopened = null;
            try {
                reopened = window.open('', normalizedName);
            } catch (error) {
                console.warn('[SuitePractice] 无法重建套题标签:', error);
                reopened = null;
            }

            if (!reopened) {
                return null;
            }

            try {
                if (typeof reopened.focus === 'function') {
                    reopened.focus();
                }
            } catch (_) {}

            if (session) {
                this._ensureSuiteWindowGuard(session, reopened);
            }

            return reopened;
        },

        _reacquireSuiteWindow(windowName, session = null) {
            return this._openNamedSuiteWindow(windowName, session);
        },

        async _verifySuiteWindowBinding(candidate, session, targetEntry, binding) {
            if (!candidate || candidate.closed || !session || !targetEntry || !binding
                || typeof global.addEventListener !== 'function'
                || typeof global.removeEventListener !== 'function'
                || typeof candidate.postMessage !== 'function'
                || typeof this.generateWindowSessionToken !== 'function') {
                return false;
            }
            const challenge = this.generateWindowSessionToken(`rebind-${String(targetEntry.examId)}`);
            const expectedSuiteId = String(session.id || '');
            const expectedExamId = String(targetEntry.examId || '');
            const expectedSessionId = String(binding.expectedSessionId || '');
            const expectedToken = String(binding.windowSessionToken || '');
            const expectedGeneration = Number(binding.sessionGeneration);
            if (!challenge || !expectedSuiteId || !expectedExamId || !expectedSessionId
                || !expectedToken || !Number.isInteger(expectedGeneration) || expectedGeneration <= 0) {
                return false;
            }
            return new Promise((resolve) => {
                let settled = false;
                const finish = (verified) => {
                    if (settled) return;
                    settled = true;
                    try { global.removeEventListener('message', onMessage); } catch (_) {}
                    if (timer) clearTimeout(timer);
                    resolve(Boolean(verified));
                };
                const onMessage = (event) => {
                    const envelope = event && event.data;
                    const data = envelope && envelope.data;
                    if (!envelope || String(envelope.type || '').toUpperCase() !== 'SUITE_REBIND_PROOF'
                        || String(envelope.source || '') !== 'practice_page'
                        || event.source !== candidate
                        || !data
                        || String(data.challenge || '') !== challenge
                        || String(data.suiteSessionId || '') !== expectedSuiteId
                        || String(data.examId || '') !== expectedExamId
                        || String(data.sessionId || '') !== expectedSessionId
                        || String(data.windowSessionToken || '') !== expectedToken
                        || Number(data.windowSessionGeneration) !== expectedGeneration) {
                        return;
                    }
                    finish(true);
                };
                const timer = setTimeout(() => finish(false), 800);
                global.addEventListener('message', onMessage);
                try {
                    candidate.postMessage({
                        type: 'SUITE_REBIND_CHALLENGE',
                        source: 'exam_host',
                        timestamp: Date.now(),
                        data: {
                            challenge,
                            suiteSessionId: expectedSuiteId,
                            examId: expectedExamId,
                            windowSessionToken: expectedToken
                        }
                    }, '*');
                } catch (_) {
                    finish(false);
                }
            });
        },

        async _tryRebindSuiteWindow(session, targetEntry, options = {}) {
            if (!session || !targetEntry || !targetEntry.examId || !session.windowBinding) return null;
            const binding = session.windowBinding;
            const bindingExamId = String(binding.examId || '').trim();
            if (!bindingExamId
                || !Array.isArray(session.sequence)
                || !session.sequence.some((entry) => entry && String(entry.examId) === bindingExamId)
                || !session.sequence.some((entry) => entry && String(entry.examId) === String(targetEntry.examId))) {
                return null;
            }
            const expectedSessionId = typeof binding.expectedSessionId === 'string'
                ? binding.expectedSessionId.trim()
                : '';
            const previousToken = typeof binding.windowSessionToken === 'string'
                ? binding.windowSessionToken.trim()
                : '';
            const previousGeneration = Number(binding.sessionGeneration);
            if (!expectedSessionId || !previousToken || !Number.isInteger(previousGeneration) || previousGeneration <= 0) {
                return null;
            }
            const windowName = typeof options.windowName === 'string' && options.windowName.trim()
                ? options.windowName
                : (session.windowName || 'ielts-suite-mode-tab');
            const suppliedLaunchOwnership = options.ownership || options.launchOwnership || null;
            const launchOwnership = suppliedLaunchOwnership
                || this._beginSuiteExamLaunchOwnership(targetEntry.examId, { windowName });
            let launchReservationSettled = false;
            const rollbackRebindLaunchOwnership = () => {
                if (launchReservationSettled) return false;
                launchReservationSettled = true;
                if (!launchOwnership
                    || typeof this._rollbackExamLaunchOwnership !== 'function') {
                    return false;
                }
                return this._rollbackExamLaunchOwnership(launchOwnership) === true;
            };
            const abortRebindReservation = () => {
                rollbackRebindLaunchOwnership();
                return null;
            };
            const allowSuppliedFallback = () => {
                if (!suppliedLaunchOwnership
                    || launchOwnership !== suppliedLaunchOwnership
                    || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)) {
                    return abortRebindReservation();
                }
                launchReservationSettled = true;
                return {
                    window: null,
                    ownership: launchOwnership,
                    fallbackAllowed: true
                };
            };
            try {
                if (!launchOwnership
                    || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)) {
                    return abortRebindReservation();
                }
                if (!await this._ensureSuiteRecoveryClaim('single', session)
                    || this.currentSuiteSession !== session
                    || session.windowBinding !== binding
                    || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)) {
                    return abortRebindReservation();
                }
                const candidate = this._reacquireSuiteWindow(windowName, null);
                if (!candidate || candidate.closed) return allowSuppliedFallback();
            let candidateIsBlank = false;
            try {
                candidateIsBlank = !candidate.location || candidate.location.href === 'about:blank';
            } catch (_) {
                candidateIsBlank = false;
            }
            if (candidateIsBlank) {
                const existingLaunchOwner = this._examLaunchWindowOwnerships
                    && this._examLaunchWindowOwnerships.get(candidate);
                if (!existingLaunchOwner && typeof this._safelyCloseWindow === 'function') {
                    // window.open('', name) creates about:blank when no named target
                    // exists. Close only that unmanaged probe; an ordinary launch that
                    // already owns the proxy must remain untouched.
                    this._safelyCloseWindow(candidate);
                }
                return allowSuppliedFallback();
            }
            if (typeof this._captureExamSessionRegistration !== 'function'
                || typeof this._isExamSessionRegistrationCurrent !== 'function') {
                return abortRebindReservation();
            }
            const challengedBinding = binding;
            const challengedRegistrations = [];
            const challengedEntries = this.examWindows && typeof this.examWindows.entries === 'function'
                ? Array.from(this.examWindows.entries())
                : [];
            for (const [registeredExamId, windowInfo] of challengedEntries) {
                if (!windowInfo || windowInfo.window !== candidate) continue;
                const registration = this._captureExamSessionRegistration(registeredExamId, windowInfo);
                if (!registration) return abortRebindReservation();
                challengedRegistrations.push({
                    examId: registeredExamId,
                    registration
                });
            }
            const challengedNavigationOwnership = this._examWindowCommittedNavigationOwners
                && typeof this._examWindowCommittedNavigationOwners.get === 'function'
                ? this._examWindowCommittedNavigationOwners.get(candidate) || null
                : null;
            const challengedCandidateStillCurrent = (expectedBinding = challengedBinding) => {
                if (this.currentSuiteSession !== session
                    || !this._ownsSuiteRecoveryClaim('single', session)
                    || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)
                    || session.windowBinding !== expectedBinding
                    || !candidate
                    || candidate.closed) {
                    return false;
                }
                const currentEntries = this.examWindows && typeof this.examWindows.entries === 'function'
                    ? Array.from(this.examWindows.entries())
                    : [];
                const currentCandidateEntries = currentEntries
                    .filter(([, windowInfo]) => windowInfo && windowInfo.window === candidate);
                if (currentCandidateEntries.length !== challengedRegistrations.length) {
                    return false;
                }
                if (!challengedRegistrations.every(({ examId, registration }) => (
                    registration.window === candidate
                    && this._isExamSessionRegistrationCurrent(examId, registration) === true
                ))) {
                    return false;
                }
                const currentNavigationOwnership = this._examWindowCommittedNavigationOwners
                    && typeof this._examWindowCommittedNavigationOwners.get === 'function'
                    ? this._examWindowCommittedNavigationOwners.get(candidate) || null
                    : null;
                return currentNavigationOwnership === challengedNavigationOwnership;
            };
            if (!challengedCandidateStillCurrent()) return abortRebindReservation();
            let bindingVerified = false;
            try {
                bindingVerified = await this._verifySuiteWindowBinding(candidate, session, targetEntry, binding);
            } catch (error) {
                throw error;
            }
            if (!challengedCandidateStillCurrent()) {
                return abortRebindReservation();
            }
            if (!bindingVerified) {
                session._suiteWindowNameConflict = true;
                return abortRebindReservation();
            }
            // Reserve the target name before the asynchronous proof, but do not claim
            // the candidate WindowProxy or replace its installed registration until
            // the proof succeeds. A newer launch reservation therefore invalidates
            // this continuation without disturbing the page currently in the tab.
            if (!this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership)
                || !this._claimSuiteExamLaunchWindow(launchOwnership, candidate)
                || !this._isSuiteExamLaunchOwnershipCurrent(targetEntry.examId, launchOwnership, candidate)
                || !challengedCandidateStillCurrent()) {
                return abortRebindReservation();
            }
            if (typeof this.setupExamWindowManagement !== 'function'
                || typeof this.generateWindowSessionToken !== 'function') {
                return abortRebindReservation();
            }
            const nextToken = this.generateWindowSessionToken(targetEntry.examId);
            const nextGeneration = previousGeneration + 1;
            const previousBinding = this._cloneSuitePlainObject(binding);
            const nextBinding = {
                examId: String(targetEntry.examId),
                expectedSessionId,
                windowSessionToken: nextToken,
                sessionGeneration: nextGeneration,
                expectedUrl: binding.expectedUrl || '',
                expectedOrigin: binding.expectedOrigin || '',
                allowOpaqueOrigin: binding.allowOpaqueOrigin === true
            };
            const rebindStillOwned = () => this.currentSuiteSession === session
                && this._ownsSuiteRecoveryClaim('single', session)
                && session.windowBinding === nextBinding
                && challengedCandidateStillCurrent(nextBinding)
                && this._isSuiteExamLaunchOwnershipCurrent(
                    targetEntry.examId,
                    launchOwnership,
                    candidate
                );
            session.windowBinding = nextBinding;
            let rebindDurableReceiptConfirmed = false;
            let rebindCommitted = false;
            try {
                rebindCommitted = await this._commitSuiteRecovery(session, {
                    reason: 'window-rebind',
                    commitGuard: rebindStillOwned,
                    windowBindingSnapshotOverride: nextBinding,
                    onDurableReceipt: () => { rebindDurableReceiptConfirmed = true; }
                });
            } catch (error) {
                if (!rebindDurableReceiptConfirmed
                    && this.currentSuiteSession === session
                    && this._ownsSuiteRecoveryClaim('single', session)
                    && session.windowBinding === nextBinding) {
                    session.windowBinding = previousBinding;
                }
                throw error;
            }
            if (!rebindCommitted || !rebindStillOwned()) {
                if (!rebindDurableReceiptConfirmed
                    && this.currentSuiteSession === session
                    && this._ownsSuiteRecoveryClaim('single', session)
                    && session.windowBinding === nextBinding) {
                    session.windowBinding = previousBinding;
                }
                return abortRebindReservation();
            }
            if (!rebindStillOwned()) return abortRebindReservation();
            const setupOptions = {
                target: 'tab',
                expectedUrl: nextBinding.expectedUrl,
                suiteSessionId: session.id,
                suiteFlowMode: session.flowMode || 'simulation',
                suiteTimerMode: session.suiteTimerMode || 'countdown',
                suiteTimerLimitSeconds: Number.isFinite(Number(session.suiteTimerLimitSeconds))
                    ? Number(session.suiteTimerLimitSeconds)
                    : 3600,
                sequenceIndex: session.currentIndex,
                sequenceTotal: session.sequence.length,
                adoptWindowBinding: {
                    expectedSessionId,
                    windowSessionToken: nextToken,
                    sessionGeneration: nextGeneration
                }
            };
            if (!rebindStillOwned()) return abortRebindReservation();
            const reboundRegistration = this.setupExamWindowManagement(
                candidate,
                targetEntry.examId,
                targetEntry.exam,
                setupOptions
            );
            const reboundInfo = reboundRegistration && reboundRegistration.windowInfo;
            if (!reboundInfo
                || reboundInfo.window !== candidate
                || reboundInfo.expectedSessionId !== expectedSessionId
                || reboundInfo.windowSessionToken !== nextToken
                || reboundInfo.sessionGeneration !== nextGeneration
                || String(reboundInfo.suiteSessionId || '') !== String(session.id)) {
                return abortRebindReservation();
            }
            if (!reboundRegistration
                || !this._isSuiteNavigationRegistrationCurrent(
                    targetEntry.examId,
                    reboundRegistration,
                    session
                )) {
                return abortRebindReservation();
            }
            if (typeof this._commitExamLaunchOwnership !== 'function'
                || this._commitExamLaunchOwnership(launchOwnership) !== true) {
                return abortRebindReservation();
            }
            launchReservationSettled = true;
            if (!this._isSuiteNavigationRegistrationCurrent(
                targetEntry.examId,
                reboundRegistration,
                session
            )) {
                return abortRebindReservation();
            }
            session.windowBinding = nextBinding;
            return {
                window: candidate,
                binding: session.windowBinding,
                ownership: launchOwnership,
                registration: reboundRegistration
            };
            } finally {
                rollbackRebindLaunchOwnership();
            }
        },

        _ensureSuiteWindowGuard(session, targetWindow) {
            if (!session || !targetWindow || targetWindow.closed) {
                return;
            }

            if (isFileProtocol) {
                return;
            }

            try {
                const existingGuard = targetWindow.__IELTS_SUITE_PARENT_GUARD__;
                if (existingGuard && existingGuard.sessionId === session.id) {
                    return;
                }

                const guardInfo = {
                    sessionId: session.id,
                    installedAt: Date.now(),
                    nativeClose: typeof targetWindow.close === 'function'
                        ? targetWindow.close.bind(targetWindow)
                        : null,
                    nativeOpen: typeof targetWindow.open === 'function'
                        ? targetWindow.open.bind(targetWindow)
                        : null,
                    windowName: typeof targetWindow.name === 'string'
                        ? targetWindow.name.trim().toLowerCase()
                        : ''
                };

                const recordAttempt = (reason) => {
                    this._recordSuiteCloseAttempt(session, reason);
                    if (session.status === 'completed' && typeof this._teardownSuiteSession === 'function') {
                        this._teardownSuiteSession(session).catch((teardownError) => {
                            console.warn('[SuitePractice] 已完成套题窗口清理失败:', teardownError);
                        });
                    }
                };

                const isSelfTarget = (rawTarget) => {
                    if (rawTarget == null) {
                        return true;
                    }

                    const normalized = typeof rawTarget === 'string'
                        ? rawTarget.trim().toLowerCase()
                        : String(rawTarget).trim().toLowerCase();

                    if (!normalized) {
                        return true;
                    }

                    if (normalized === guardInfo.windowName && normalized) {
                        return true;
                    }

                    if (['_self', 'self', '_parent', 'parent', '_top', 'top', 'window', 'this'].includes(normalized)) {
                        return true;
                    }

                    return false;
                };

                const guardedClose = () => {
                    recordAttempt('script_request');
                    return undefined;
                };

                try { targetWindow.close = guardedClose; } catch (_) {}
                try {
                    if (targetWindow.self && targetWindow.self !== targetWindow) {
                        targetWindow.self.close = guardedClose;
                    }
                } catch (_) {}

                try {
                    if (targetWindow.top && targetWindow.top !== targetWindow) {
                        targetWindow.top.close = guardedClose;
                    }
                } catch (_) {}

                if (guardInfo.nativeOpen) {
                    const nativeOpen = guardInfo.nativeOpen;
                    targetWindow.open = (url = '', target = '', features = '') => {
                        if (isSelfTarget(target)) {
                            recordAttempt('self_target_open');
                            return targetWindow;
                        }
                        return nativeOpen(url, target, features);
                    };
                }

                targetWindow.__IELTS_SUITE_PARENT_GUARD__ = guardInfo;
            } catch (error) {
                console.warn('[SuitePractice] 安装套题窗口防护失败:', error);
            }
        },

        _releaseSuiteWindowGuard(targetWindow, expectedSuiteSessionId = '') {
            if (!targetWindow) {
                return;
            }

            let guardInfo = null;
            try {
                guardInfo = targetWindow.__IELTS_SUITE_PARENT_GUARD__;
            } catch (error) {
                const message = String(error && error.message ? error.message : error);
                if (!message || !message.toLowerCase().includes('cross-origin')) {
                    console.warn('[SuitePractice] Unable to read suite window guard data:', error);
                } else {
                    console.debug('[SuitePractice] Suite window guard is cross-origin; skipping guard release.');
                }
                guardInfo = null;
            }

            if (!guardInfo) {
                return;
            }
            const normalizedExpectedSuiteSessionId = String(expectedSuiteSessionId || '').trim();
            if (normalizedExpectedSuiteSessionId
                && String(guardInfo.sessionId || '') !== normalizedExpectedSuiteSessionId) {
                return;
            }

            try {
                if (guardInfo.nativeClose) {
                    targetWindow.close = guardInfo.nativeClose;
                } else {
                    delete targetWindow.close;
                }
            } catch (_) {}

            try {
                if (guardInfo.nativeOpen) {
                    targetWindow.open = guardInfo.nativeOpen;
                } else {
                    delete targetWindow.open;
                }
            } catch (_) {}

            try {
                delete targetWindow.__IELTS_SUITE_PARENT_GUARD__;
            } catch (_) {
                try {
                    targetWindow.__IELTS_SUITE_PARENT_GUARD__ = null;
                } catch (_) {}
            }
        },

        _recordSuiteCloseAttempt(session, reason) {
            if (!session) {
                return;
            }

            if (!Array.isArray(session.closeAttempts)) {
                session.closeAttempts = [];
            }

            session.closeAttempts.push({
                reason: reason || 'unknown',
                timestamp: Date.now()
            });
        },

        _clearSuiteHandshakes() {
            if (this._suiteHandshakeWaiters && typeof this._suiteHandshakeWaiters.clear === 'function') {
                try {
                    this._suiteHandshakeWaiters.clear();
                } catch (_) {}
            }
        },

        /**
         * 获取或创建多套题会话
         * @param {string} examId - 考试ID（基础ID，不含套题后缀）
         * @returns {object} 多套题会话对象
         */
        getOrCreateMultiSuiteSession(examId, options = {}) {
            if (!this.multiSuiteSessionsMap) {
                this.multiSuiteSessionsMap = new Map();
            }

            // 提取基础examId（移除可能的套题后缀如 _set1, _suite1 等）
            const baseExamId = String(this._extractBaseExamId(examId) || '').trim();
            if (!baseExamId) {
                return null;
            }

            if (this.multiSuiteSessionsMap.has(baseExamId)) {
                return this.multiSuiteSessionsMap.get(baseExamId);
            }

            // 创建新的多套题会话
            const session = {
                id: this._generateMultiSuiteSessionId(baseExamId),
                baseExamId: baseExamId,
                status: 'active',
                startTime: Date.now(),
                suiteResults: [],
                expectedSuiteCount: null, // 将在第一次提交时确定
                metadata: {
                    source: this._detectMultiSuiteSource(baseExamId),
                    createdAt: new Date().toISOString()
                }
            };

            if (options.install !== false) {
                this.multiSuiteSessionsMap.set(baseExamId, session);
                this._mirrorMultiSuiteSessionsToStorage();
            }
            console.log('[MultiSuite] 创建新会话:', session.id, '基础ID:', baseExamId);

            return session;
        },

        /**
         * 检查多套题是否全部完成
         * @param {object} session - 多套题会话对象
         * @returns {boolean} 是否所有套题都已完成
         */
        isMultiSuiteComplete(session) {
            if (!session || !Array.isArray(session.suiteResults)) {
                return false;
            }

            // 如果还没有确定预期套题数量，则未完成
            if (!session.expectedSuiteCount || session.expectedSuiteCount <= 0) {
                return false;
            }

            // 检查已完成的套题数量是否达到预期
            const completedCount = session.suiteResults.length;
            const isComplete = completedCount >= session.expectedSuiteCount;

            if (isComplete) {

                console.log('[MultiSuite] session completed:', session.id, 'completed ' + completedCount + '/' + session.expectedSuiteCount + ' suite(s)');
            }

            return isComplete;
        },

        /**
         * 提取基础examId（移除套题后缀）
         * @param {string} examId - 完整的examId
         * @returns {string} 基础examId
         */
        _extractBaseExamId(examId) {
            if (!examId || typeof examId !== 'string') {
                return examId;
            }

            // 移除常见的套题后缀模式：_set1, _suite1, _s1, ::set1 等
            const patterns = [
                /_set\d+$/i,
                /_suite\d+$/i,
                /_s\d+$/i,
                /::set\d+$/i,
                /::suite\d+$/i,
                /-set\d+$/i,
                /-suite\d+$/i
            ];

            let baseId = examId;
            for (const pattern of patterns) {
                baseId = baseId.replace(pattern, '');
            }

            return baseId;
        },

        /**
         * 生成多套题会话ID
         * @param {string} baseExamId - 基础examId
         * @returns {string} 会话ID
         */
        _generateMultiSuiteSessionId(baseExamId) {
            const timestamp = Date.now().toString(36);
            const random = Math.random().toString(16).slice(2, 8);
            const prefix = baseExamId ? baseExamId + '_' : '';
            return 'multi_' + prefix + timestamp + '_' + random;
        },

        /**
         * 检测多套题来源（P1/P4等）
         * @param {string} examId - 考试ID
         * @returns {string} 来源标识
         */
        _detectMultiSuiteSource(examId) {
            if (!examId || typeof examId !== 'string') {
                return 'unknown';
            }

            const lowerExamId = examId.toLowerCase();

            if (lowerExamId.includes('p1') || lowerExamId.includes('part1')) {
                return 'p1';
            }
            if (lowerExamId.includes('p4') || lowerExamId.includes('part4')) {
                return 'p4';
            }
            if (lowerExamId.includes('p2') || lowerExamId.includes('part2')) {
                return 'p2';
            }
            if (lowerExamId.includes('p3') || lowerExamId.includes('part3')) {
                return 'p3';
            }

            return 'listening';
        }
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.suitePractice = mixin;
})(typeof window !== 'undefined' ? window : globalThis);
