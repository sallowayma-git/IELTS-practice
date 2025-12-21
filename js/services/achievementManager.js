(function (window) {
    'use strict';

    class AchievementManager {
        constructor() {
            this.storageKey = 'user_achievements';
            this.achievements = this._defineAchievements();
            this.listeners = [];
            this.initialized = false;
            this.unlocked = {};
        }

        /**
         * Initialize the manager, loading state from storage
         */
        async init() {
            if (this.initialized) return;

            try {
                // Ensure Storage is available (using our app's storage abstraction if possible, fallback to localStorage)
                // For simplicity in this standalone service, we'll try to use the global 'storage' if present, 
                // but since it might not be ready, we design this to vary. 
                // Let's assume global 'storage' object from js/utils/storage.js is available as per index.html order.

                this.unlocked = await this._loadUnlockedState();
                console.log('[AchievementManager] Initialized. Unlocked:', Object.keys(this.unlocked).length);
                this.initialized = true;
            } catch (e) {
                console.error('[AchievementManager] Init failed', e);
                this.unlocked = {};
            }
        }

        /**
         * Define the list of available achievements
         */
        _defineAchievements() {
            return [
                {
                    id: 'first_step',
                    title: '初出茅庐',
                    description: '完成第一次练习',
                    icon: '🌱',
                    condition: (stats, lastRecord) => stats.totalPracticed >= 1
                },
                {
                    id: 'getting_started',
                    title: '渐入佳境',
                    description: '累计完成 10 次练习',
                    icon: '🚀',
                    condition: (stats, lastRecord) => stats.totalPracticed >= 10
                },
                {
                    id: 'centurion',
                    title: '百炼成钢',
                    description: '累计完成 100 次练习',
                    icon: '💯',
                    condition: (stats, lastRecord) => stats.totalPracticed >= 100
                },
                {
                    id: 'accuracy_master',
                    title: '神射手',
                    description: '在一次练习中获得 100% 正确率',
                    icon: '🎯',
                    condition: (stats, lastRecord) => stats.hasPerfectAccuracy
                },
                {
                    id: 'accuracy_expert',
                    title: '精准打击',
                    description: '在一次练习中获得 90% 以上正确率',
                    icon: '🏹',
                    condition: (stats, lastRecord) => stats.hasHighAccuracy
                },
                {
                    id: 'persistent_learner',
                    title: '持之以恒',
                    description: '连续学习 3 天',
                    icon: '🔥',
                    condition: (stats, lastRecord) => stats.streakDays >= 3
                },
                {
                    id: 'weekly_warrior',
                    title: '周更战士',
                    description: '连续学习 7 天',
                    icon: '📅',
                    condition: (stats, lastRecord) => stats.streakDays >= 7
                },
                {
                    id: 'speed_demon',
                    title: '唯快不破',
                    description: '在 5 分钟内完成一次高分练习 (正确率>80%)',
                    icon: '⚡',
                    condition: (stats, lastRecord) => stats.hasSpeedDemon
                },
                {
                    id: 'listening_ear',
                    title: '顺风耳',
                    description: '累计完成 50 篇听力练习',
                    icon: '👂',
                    condition: (stats, lastRecord) => stats.listeningCount >= 50
                },
                {
                    id: 'reading_eye',
                    title: '火眼金睛',
                    description: '累计完成 50 篇阅读练习',
                    icon: '👁️',
                    condition: (stats, lastRecord) => stats.readingCount >= 50
                }
            ];
        }

        /**
         * Load unlocked state from storage
         */
        async _loadUnlockedState() {
            if (window.storage) {
                return await window.storage.get(this.storageKey, {});
            } else {
                const raw = localStorage.getItem(this.storageKey);
                return raw ? JSON.parse(raw) : {};
            }
        }

        /**
         * Save unlocked state to storage
         */
        async _saveUnlockedState() {
            if (window.storage) {
                await window.storage.set(this.storageKey, this.unlocked);
            } else {
                localStorage.setItem(this.storageKey, JSON.stringify(this.unlocked));
            }
        }

        _getDefaultUserStats() {
            return {
                totalPractices: 0,
                totalTimeSpent: 0,
                averageScore: 0,
                categoryStats: {},
                questionTypeStats: {},
                streakDays: 0,
                practiceDays: [],
                lastPracticeDate: null,
                achievements: []
            };
        }

        _getPracticeRecorder() {
            const app = window.app;
            if (app && app.components && app.components.practiceRecorder) {
                return app.components.practiceRecorder;
            }
            return null;
        }

        async _getUserStatsFromScoreStorage() {
            const recorder = this._getPracticeRecorder();
            if (recorder && typeof recorder.getUserStats === 'function') {
                return await recorder.getUserStats();
            }
            if (window.storage) {
                return await window.storage.get('user_stats', this._getDefaultUserStats());
            }
            return this._getDefaultUserStats();
        }

        async _getPracticeRecordsFromScoreStorage() {
            const recorder = this._getPracticeRecorder();
            if (recorder && typeof recorder.getPracticeRecords === 'function') {
                return await recorder.getPracticeRecords();
            }
            if (window.storage) {
                return await window.storage.get('practice_records', []);
            }
            return [];
        }

        _getCategoryPracticeCount(stats, targetKey) {
            if (!stats || !stats.categoryStats || typeof stats.categoryStats !== 'object') {
                return 0;
            }

            const normalizedTarget = String(targetKey || '').toLowerCase();
            let count = 0;

            Object.entries(stats.categoryStats).forEach(([key, value]) => {
                const normalizedKey = String(key || '').toLowerCase();
                if (normalizedKey !== normalizedTarget) {
                    return;
                }
                const practices = value && Number(value.practices);
                if (Number.isFinite(practices)) {
                    count += practices;
                }
            });

            return count;
        }

        _buildDerivedStats(rawStats) {
            const stats = rawStats && typeof rawStats === 'object' ? rawStats : {};
            return {
                totalPracticed: Number(stats.totalPractices) || 0,
                streakDays: Number(stats.streakDays) || 0,
                listeningCount: this._getCategoryPracticeCount(stats, 'listening'),
                readingCount: this._getCategoryPracticeCount(stats, 'reading'),
                hasPerfectAccuracy: false,
                hasHighAccuracy: false,
                hasSpeedDemon: false
            };
        }

        _applyRecordToDerivedStats(derived, record) {
            if (!derived || !record) {
                return;
            }

            const accuracy = Number(record.accuracy) || 0;
            const duration = Number(record.duration) || 0;

            if (accuracy >= 1) {
                derived.hasPerfectAccuracy = true;
            }
            if (accuracy >= 0.9) {
                derived.hasHighAccuracy = true;
            }
            if (duration > 0 && duration <= 300 && accuracy > 0.8) {
                derived.hasSpeedDemon = true;
            }
        }

        async syncFromScoreStorage(options = {}) {
            const {
                includeRecords = false,
                latestRecord = null,
                notify = false
            } = options;

            const rawStats = await this._getUserStatsFromScoreStorage();
            const derivedStats = this._buildDerivedStats(rawStats);

            if (includeRecords) {
                const records = await this._getPracticeRecordsFromScoreStorage();
                if (Array.isArray(records)) {
                    records.forEach(record => this._applyRecordToDerivedStats(derivedStats, record));
                }
            } else {
                this._applyRecordToDerivedStats(derivedStats, latestRecord);
            }

            return this._unlockByStats(derivedStats, { notify });
        }

        async _unlockByStats(stats, options = {}) {
            const { notify = false } = options;
            const newUnlocks = [];

            for (const achievement of this.achievements) {
                if (this.unlocked[achievement.id]) continue;

                try {
                    if (achievement.condition(stats, null)) {
                        this.unlocked[achievement.id] = {
                            unlockedAt: new Date().toISOString()
                        };
                        newUnlocks.push(achievement);
                    }
                } catch (err) {
                    console.error(`[AchievementManager] Error checking ${achievement.id}`, err);
                }
            }

            if (newUnlocks.length > 0) {
                await this._saveUnlockedState();
                if (notify) {
                    this._notify(newUnlocks);
                }
            }

            return newUnlocks;
        }

        /**
         * Check for new achievements based on latest activity
         * @param {Object} latestRecord - The practice record just completed
         * @param {Object} allStats - Aggregated stats (optional, will calculate if missing)
         */
        async check(latestRecord) {
            if (!this.initialized) await this.init();

            return this.syncFromScoreStorage({ latestRecord, notify: true });
        }

        /**
         * Notify listeners (UI) about new unlocks
         */
        _notify(newAchievements) {
            // Dispatch custom event
            const event = new CustomEvent('achievements-unlocked', {
                detail: { achievements: newAchievements }
            });
            window.dispatchEvent(event);

            // Also use global message if available
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

        // Ensure init
        if (!window.AchievementManager.initialized) {
            try {
                await window.AchievementManager.init();
            } catch (err) {
                console.warn('[AchievementManager] Init failed before showing modal', err);
            }
        }

        await window.AchievementManager.syncFromScoreStorage({ includeRecords: true, notify: false });
        const all = window.AchievementManager.getAll();
        list.innerHTML = all.map(a => `
            <div class="achievement-card ${a.isUnlocked ? 'unlocked' : ''}">
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
