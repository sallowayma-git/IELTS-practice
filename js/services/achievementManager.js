(function (window) {
    'use strict';

    /**
     * Presentation catalog + notifier for achievements.
     *
     * Unlock rules and persistence belong entirely to the `achievements.progress`
     * projector (js/data/v2/appData.js -> computeAchievementProgress). That projector
     * is declared `derived` in the data catalog, is listed in `derivedPending` for every
     * practice mutation, and records the historically accurate unlock timestamp for each
     * achievement id.
     *
     * This class therefore owns only display metadata (title / description / icon / tier)
     * and diffs successive projector reads so that newly unlocked achievements can be
     * surfaced as notifications. It deliberately does NOT re-derive unlock conditions:
     * a second rule engine here would drift from the projector (it previously did, which
     * left every streak achievement permanently locked) and would stamp "unlocked now"
     * instead of the real unlock time.
     */
    class AchievementManager {
        constructor() {
            this.achievements = this._defineAchievements();
            this.achievementIds = new Set(this.achievements.map((item) => item.id));
            this.listeners = [];
            this.initialized = false;
            // Newest read — what the achievements modal renders.
            this.unlocked = {};
            // Last read whose projector provenance was proven — what the unlock diff measures
            // against. Deliberately separate from `unlocked`: see syncFromAppData.
            this.baseline = {};
            this.baselineFresh = false;
            this._deliveryInitialized = false;
            this._pendingDelivery = {};
            this._initPromise = null;
            this._syncTail = Promise.resolve();
        }

        /**
         * Initialize the manager, loading persisted progress from storage.
         *
         * The first run seeds a durable delivery baseline so existing users are not greeted with
         * every historical unlock. Later runs diff against that persisted acknowledgement instead
         * of the first projector read, which lets a pending unlock survive a page restart.
         */
        async init() {
            if (this.initialized) return;
            if (this._initPromise) return this._initPromise;

            this._initPromise = this._enqueueSync(() => this._initialize()).finally(() => {
                this._initPromise = null;
            });
            return this._initPromise;
        }

        async _initialize() {
            try {
                let [state, delivery] = await Promise.all([
                    this._loadUnlockedState(),
                    this._loadDeliveryState()
                ]);
                state = await this._retryUntilFresh(state);
                this.unlocked = state.unlocked;
                if (delivery) {
                    this.baseline = delivery.acknowledged;
                    this.baselineFresh = true;
                    this._deliveryInitialized = true;
                } else {
                    this.baseline = state.unlocked;
                    this.baselineFresh = state.fresh;
                    // A brand-new store has no projector provenance yet, but its empty snapshot is
                    // still a safe delivery baseline: there is no historical unlock to suppress.
                    if (state.fresh || Object.keys(state.unlocked).length === 0) {
                        await this._persistDeliveryBaseline(state.unlocked);
                        this._deliveryInitialized = true;
                    }
                }
                console.log('[AchievementManager] Initialized. Unlocked:', Object.keys(this.unlocked).length);
                this.initialized = true;

                if (delivery) {
                    await this._syncFromAppDataNow({ notify: true, initialState: state });
                }
            } catch (e) {
                console.error('[AchievementManager] Init failed', e);
                this.unlocked = {};
                this.baseline = {};
                this.baselineFresh = false;
                this._deliveryInitialized = false;
                this.initialized = false;
                throw e;
            }
        }

        /**
         * Display metadata for every achievement the projector can unlock.
         * Ids must stay in sync with computeAchievementProgress in js/data/v2/appData.js.
         */
        _defineAchievements() {
            return [
                // --- Practice Count Milestones ---
                {
                    id: 'practice_bronze',
                    title: '初出茅庐',
                    description: '累计完成 10 次练习',
                    icon: '🥉',
                    tier: 1
                },
                {
                    id: 'practice_silver',
                    title: '渐入佳境',
                    description: '累计完成 50 次练习',
                    icon: '🥈',
                    tier: 2
                },
                {
                    id: 'practice_gold',
                    title: '百炼成钢',
                    description: '累计完成 100 次练习',
                    icon: '🥇',
                    tier: 3
                },
                {
                    id: 'practice_platinum',
                    title: '千锤百炼',
                    description: '累计完成 200 次练习',
                    icon: '🏅',
                    tier: 3
                },

                // --- Streak Milestones ---
                {
                    id: 'streak_bronze',
                    title: '持之以恒',
                    description: '连续学习 3 天',
                    icon: '🔥',
                    tier: 1
                },
                {
                    id: 'streak_silver',
                    title: '习惯养成',
                    description: '连续学习 7 天',
                    icon: '🔥',
                    tier: 2
                },
                {
                    id: 'streak_gold',
                    title: '意志如铁',
                    description: '连续学习 30 天',
                    icon: '🔥',
                    tier: 3
                },
                {
                    id: 'streak_platinum',
                    title: '长期主义',
                    description: '连续学习 60 天',
                    icon: '🗓️',
                    tier: 3
                },

                // --- Category Mastery: Listening ---
                {
                    id: 'listening_first',
                    title: '开耳第一篇',
                    description: '完成 1 篇听力练习',
                    icon: '🎧',
                    tier: 1
                },
                {
                    id: 'listening_bronze',
                    title: '顺风耳 (铜)',
                    description: '累计完成 10 篇听力练习',
                    icon: '👂',
                    tier: 1
                },
                {
                    id: 'listening_silver',
                    title: '顺风耳 (银)',
                    description: '累计完成 50 篇听力练习',
                    icon: '👂',
                    tier: 2
                },
                {
                    id: 'listening_gold',
                    title: '顺风耳 (金)',
                    description: '累计完成 100 篇听力练习',
                    icon: '👂',
                    tier: 3
                },

                // --- Category Mastery: Reading ---
                {
                    id: 'reading_first',
                    title: '开卷第一篇',
                    description: '完成 1 篇阅读练习',
                    icon: '📖',
                    tier: 1
                },
                {
                    id: 'reading_bronze',
                    title: '火眼金睛 (铜)',
                    description: '累计完成 10 篇阅读练习',
                    icon: '👁️',
                    tier: 1
                },
                {
                    id: 'reading_silver',
                    title: '火眼金睛 (银)',
                    description: '累计完成 50 篇阅读练习',
                    icon: '👁️',
                    tier: 2
                },
                {
                    id: 'reading_gold',
                    title: '火眼金睛 (金)',
                    description: '累计完成 100 篇阅读练习',
                    icon: '👁️',
                    tier: 3
                },

                // --- Balanced Practice ---
                {
                    id: 'balanced_foundation',
                    title: '双线推进',
                    description: '阅读与听力各完成 10 篇',
                    icon: '⚖️',
                    tier: 2
                },
                {
                    id: 'balanced_advanced',
                    title: '均衡进阶',
                    description: '阅读与听力各完成 30 篇',
                    icon: '🧭',
                    tier: 3
                },

                // --- Focus Time ---
                {
                    id: 'time_focus_60',
                    title: '专注一小时',
                    description: '累计学习 60 分钟',
                    icon: '⏱️',
                    tier: 1
                },
                {
                    id: 'time_focus_300',
                    title: '沉浸五小时',
                    description: '累计学习 300 分钟',
                    icon: '⏳',
                    tier: 2
                },
                {
                    id: 'time_focus_1000',
                    title: '深度备考',
                    description: '累计学习 1000 分钟',
                    icon: '⌛',
                    tier: 3
                },

                // --- Accuracy Milestones ---
                {
                    id: 'accuracy_stable',
                    title: '稳中有进',
                    description: '10 次练习后平均正确率 70%+',
                    icon: '📈',
                    tier: 2
                },
                {
                    id: 'accuracy_elite',
                    title: '高分稳定',
                    description: '20 次练习后平均正确率 85%+',
                    icon: '💎',
                    tier: 3
                },
                {
                    id: 'perfect_three',
                    title: '三次满分',
                    description: '累计 3 次练习获得满分',
                    icon: '🎯',
                    tier: 2
                },
                {
                    id: 'perfect_ten',
                    title: '十全十美',
                    description: '累计 10 次练习获得满分',
                    icon: '🏆',
                    tier: 3
                },
                {
                    id: 'speed_three',
                    title: '快速稳定',
                    description: '3 次 5 分钟内完成高分练习',
                    icon: '⚡',
                    tier: 2
                },
                {
                    id: 'speed_ten',
                    title: '闪电节奏',
                    description: '10 次 5 分钟内完成高分练习',
                    icon: '🌩️',
                    tier: 3
                },

                // --- Special Achievements ---
                {
                    id: 'first_step',
                    title: '迈出第一步',
                    description: '完成第一次练习',
                    icon: '🌱',
                    tier: 1
                },
                {
                    id: 'accuracy_perfect',
                    title: '神射手',
                    description: '单次练习获得 100% 正确率',
                    icon: '🎯',
                    tier: 3
                },
                {
                    id: 'speed_demon',
                    title: '唯快不破',
                    description: '5分钟内完成高分练习',
                    icon: '⚡',
                    tier: 3
                }
            ];
        }

        /**
         * Read projector-owned unlock progress from storage.
         *
         * `AppData.achievements.getAll()` attaches a non-enumerable `fresh` flag: false means the
         * projector was still pending and the payload is an inline recompute rather than the proven
         * cache. That distinction is load-bearing for the unlock diff and delivery retry.
         */
        async _loadUnlockedState() {
            const progress = await window.AppData.achievements.getAll();
            return {
                unlocked: this._normalizeProgress(progress),
                fresh: !progress || progress.fresh !== false
            };
        }

        async _loadDeliveryState() {
            const settings = await window.AppData.settings.getAll();
            const delivery = settings && settings.achievementDelivery;
            if (!delivery || delivery.version !== 1 || !delivery.acknowledged
                || typeof delivery.acknowledged !== 'object' || Array.isArray(delivery.acknowledged)) {
                return null;
            }
            return {
                acknowledged: Object.fromEntries(Object.entries(delivery.acknowledged)
                    .filter(([id]) => this.achievementIds.has(id))
                    .map(([id, unlockedAt]) => [id, { unlockedAt: unlockedAt || null }]))
            };
        }

        async _persistDeliveryBaseline(unlocked) {
            if (!window.AppData.achievements
                || typeof window.AppData.achievements.acknowledgeDelivery !== 'function') {
                throw new Error('AppData.achievements.acknowledgeDelivery is required');
            }
            await window.AppData.achievements.acknowledgeDelivery(unlocked);
        }

        _unionBaseline(...sources) {
            const merged = {};
            sources.forEach((source) => {
                Object.entries(source && typeof source === 'object' ? source : {}).forEach(([id, value]) => {
                    if (!this.achievementIds.has(id)) return;
                    const candidate = value && typeof value === 'object' ? value.unlockedAt : value;
                    const candidateTime = typeof candidate === 'string' ? Date.parse(candidate) : NaN;
                    const prior = merged[id] && merged[id].unlockedAt;
                    const priorTime = typeof prior === 'string' ? Date.parse(prior) : NaN;
                    if (!merged[id] || (Number.isFinite(candidateTime)
                        && (!Number.isFinite(priorTime) || candidateTime < priorTime))) {
                        merged[id] = { unlockedAt: Number.isFinite(candidateTime)
                            ? new Date(candidateTime).toISOString()
                            : null };
                    }
                });
            });
            return merged;
        }

        async _retryUntilFresh(initialState) {
            let state = initialState;
            if (state.fresh || !window.AppData.achievements
                || typeof window.AppData.achievements.retryPending !== 'function') {
                return state;
            }
            for (let attempt = 0; attempt < 3 && !state.fresh; attempt += 1) {
                try {
                    await window.AppData.achievements.retryPending();
                    state = await this._loadUnlockedState();
                } catch (err) {
                    console.warn('[AchievementManager] Failed to retry pending achievement projection', err);
                }
                if (!state.fresh && attempt < 2) {
                    await new Promise((resolve) => {
                        const schedule = window.setTimeout || ((callback) => callback());
                        schedule(resolve, 10 * (2 ** attempt));
                    });
                }
            }
            return state;
        }

        /**
         * Reduce the projector payload to `{ [id]: { unlockedAt } }` for ids this
         * catalog can render. Unknown ids (e.g. manual entries for retired achievements)
         * are dropped because there is no card to show them on.
         */
        _normalizeProgress(progress) {
            const source = progress && typeof progress === 'object' && !Array.isArray(progress)
                ? progress
                : {};
            const normalized = {};

            Object.entries(source).forEach(([id, value]) => {
                if (!value || id === 'updatedAt' || !this.achievementIds.has(id)) {
                    return;
                }
                const unlockedAt = value && typeof value === 'object' ? value.unlockedAt : null;
                normalized[id] = { unlockedAt: unlockedAt || null };
            });

            return normalized;
        }

        /**
         * Re-read projector progress and report achievements unlocked since the last proven read.
         *
         * Freshness gates the baseline, not the display. `this.unlocked` always tracks the newest
         * read so the achievements modal never renders yesterday's state, while `this.baseline` —
         * the set the unlock diff is measured against — only advances on a read whose provenance the
         * projector proved. An unproven read that quietly became the baseline would make the next
         * read see the unlock as "already known" and drop its notification for good, which is the
         * one failure mode with no recovery path: there is no later event that re-raises it.
         *
         * Consequences of that split: an unproven read never notifies (announcing an unlock the
         * proven projection has not confirmed risks a toast for something that never happened, e.g.
         * a source snapshot read mid-import), and it never consumes one either — the very next
         * proven read still sees the unlock as new and raises it exactly once.
         *
         * @param {Object} options
         * @param {boolean} [options.notify] - surface a toast for each new unlock
         */
        syncFromAppData(options = {}) {
            return this._enqueueSync(() => this._syncFromAppDataNow(options));
        }

        _enqueueSync(run) {
            const result = this._syncTail.then(run, run);
            this._syncTail = result.catch(() => {});
            return result;
        }

        async _syncFromAppDataNow(options = {}) {
            const { notify = false } = options;
            const baseline = this.baseline && typeof this.baseline === 'object' ? this.baseline : {};

            let state = options.initialState || null;
            try {
                if (!state) state = await this._loadUnlockedState();
            } catch (err) {
                console.warn('[AchievementManager] Failed to read achievement progress', err);
                return [];
            }

            state = await this._retryUntilFresh(state);

            const current = state.unlocked;
            this.unlocked = current;
            if (!state.fresh) {
                // Derived cache was unproven (projector pending): display refreshed, baseline held.
                this.baselineFresh = false;
                return [];
            }

            if (!this._deliveryInitialized) {
                await this._persistDeliveryBaseline(current);
                this.baseline = this._unionBaseline(baseline, current);
                this.baselineFresh = true;
                this._deliveryInitialized = true;
                return [];
            }

            const newUnlocks = this.achievements.filter((achievement) => (
                current[achievement.id] && !baseline[achievement.id]
            ));

            this.baselineFresh = true;

            if (newUnlocks.length > 0 && notify) {
                this._notify(newUnlocks);
                // Notification delivery is at-least-once across crashes. Within this session,
                // advance first so a failed persistence retry cannot repeatedly toast the user.
                this.baseline = this._unionBaseline(baseline, current);
                this._pendingDelivery = this._unionBaseline(this._pendingDelivery, current);
            } else if (newUnlocks.length === 0) {
                this.baseline = this._unionBaseline(baseline, current);
            }

            if (Object.keys(this._pendingDelivery).length > 0) {
                const pending = this._pendingDelivery;
                try {
                    await this._persistDeliveryBaseline(pending);
                    this._pendingDelivery = {};
                } catch (err) {
                    console.warn('[AchievementManager] Failed to persist delivery acknowledgement', err);
                }
            }

            return newUnlocks;
        }

        /**
         * Check for newly unlocked achievements after a practice completes.
         * The projector has already recomputed progress by this point; we only diff it.
         */
        async check() {
            if (!this.initialized) await this.init();
            return this.syncFromAppData({ notify: true });
        }

        /**
         * Notify listeners (UI) about new unlocks
         */
        _notify(newAchievements) {
            const event = new CustomEvent('achievements-unlocked', {
                detail: { achievements: newAchievements }
            });
            window.dispatchEvent(event);

            if (window.showMessage) {
                newAchievements.forEach(a => {
                    const msg = `🏆 解锁成就：${a.title} - ${a.description}`;
                    window.showMessage(msg, 'success', 5000);
                });
            }
        }

        /**
         * Get all achievements with status
         */
        getAll() {
            const unlocked = this.unlocked || {};
            return this.achievements.map(a => ({
                ...a,
                isUnlocked: !!unlocked[a.id],
                unlockedAt: unlocked[a.id] ? unlocked[a.id].unlockedAt : null
            }));
        }
    }

    // Export
    window.AchievementManager = new AchievementManager();

    // Auto-init specific listeners once execution context is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.AchievementManager.init());
    } else {
        window.AchievementManager.init();
    }

    // UI Helpers
    window.showAchievements = async function () {
        const modal = document.getElementById('achievements-modal');
        const list = document.getElementById('achievements-list');
        if (!modal || !list) return;

        if (!window.AchievementManager.initialized) {
            try {
                await window.AchievementManager.init();
            } catch (err) {
                console.warn('[AchievementManager] Init failed before showing modal', err);
            }
        }

        await window.AchievementManager.syncFromAppData({ notify: false });
        const all = window.AchievementManager.getAll();
        list.innerHTML = all.map(a => `
            <div class="achievement-card ${a.isUnlocked ? 'unlocked' : ''} ${a.tier ? 'tier-' + a.tier : ''}">
                <span class="achievement-icon">${a.icon}</span>
                <div class="achievement-title">${a.title}</div>
                <div class="achievement-desc">${a.description}</div>
                ${a.isUnlocked ? `<div style="font-size:0.7em; margin-top:5px; color:#10b981; font-weight:bold;">已解锁</div>` : ''}
                ${a.isUnlocked && a.unlockedAt ? `<div style="font-size:0.65em; color:#9ca3af; margin-top:2px;">${new Date(a.unlockedAt).toLocaleDateString()}</div>` : ''}
            </div>
        `).join('');

        modal.classList.add('show');
    };

    window.hideAchievements = function () {
        const modal = document.getElementById('achievements-modal');
        if (modal) {
            modal.classList.remove('show');
        }
    };

})(window);
