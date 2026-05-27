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
                // --- Practice Count Milestones ---
                {
                    id: 'practice_bronze',
                    title: '初出茅庐',
                    description: '累计完成 10 次练习',
                    icon: '🥉',
                    tier: 1,
                    condition: (stats) => stats.totalPracticed >= 10
                },
                {
                    id: 'practice_silver',
                    title: '渐入佳境',
                    description: '累计完成 50 次练习',
                    icon: '🥈',
                    tier: 2,
                    condition: (stats) => stats.totalPracticed >= 50
                },
                {
                    id: 'practice_gold',
                    title: '百炼成钢',
                    description: '累计完成 100 次练习',
                    icon: '🥇',
                    tier: 3,
                    condition: (stats) => stats.totalPracticed >= 100
                },
                {
                    id: 'practice_platinum',
                    title: '千锤百炼',
                    description: '累计完成 200 次练习',
                    icon: '🏅',
                    tier: 3,
                    condition: (stats) => stats.totalPracticed >= 200
                },

                // --- Streak Milestones ---
                {
                    id: 'streak_bronze',
                    title: '持之以恒',
                    description: '连续学习 3 天',
                    icon: '🔥',
                    tier: 1,
                    condition: (stats) => stats.streakDays >= 3
                },
                {
                    id: 'streak_silver',
                    title: '习惯养成',
                    description: '连续学习 7 天',
                    icon: '🔥',
                    tier: 2,
                    condition: (stats) => stats.streakDays >= 7
                },
                {
                    id: 'streak_gold',
                    title: '意志如铁',
                    description: '连续学习 30 天',
                    icon: '🔥',
                    tier: 3,
                    condition: (stats) => stats.streakDays >= 30
                },
                {
                    id: 'streak_platinum',
                    title: '长期主义',
                    description: '连续学习 60 天',
                    icon: '🗓️',
                    tier: 3,
                    condition: (stats) => stats.streakDays >= 60
                },

                // --- Category Mastery: Listening ---
                {
                    id: 'listening_first',
                    title: '开耳第一篇',
                    description: '完成 1 篇听力练习',
                    icon: '🎧',
                    tier: 1,
                    condition: (stats) => stats.listeningCount >= 1
                },
                {
                    id: 'listening_bronze',
                    title: '顺风耳 (铜)',
                    description: '累计完成 10 篇听力练习',
                    icon: '👂',
                    tier: 1,
                    condition: (stats) => stats.listeningCount >= 10
                },
                {
                    id: 'listening_silver',
                    title: '顺风耳 (银)',
                    description: '累计完成 50 篇听力练习',
                    icon: '👂',
                    tier: 2,
                    condition: (stats) => stats.listeningCount >= 50
                },
                {
                    id: 'listening_gold',
                    title: '顺风耳 (金)',
                    description: '累计完成 100 篇听力练习',
                    icon: '👂',
                    tier: 3,
                    condition: (stats) => stats.listeningCount >= 100
                },

                // --- Category Mastery: Reading ---
                {
                    id: 'reading_first',
                    title: '开卷第一篇',
                    description: '完成 1 篇阅读练习',
                    icon: '📖',
                    tier: 1,
                    condition: (stats) => stats.readingCount >= 1
                },
                {
                    id: 'reading_bronze',
                    title: '火眼金睛 (铜)',
                    description: '累计完成 10 篇阅读练习',
                    icon: '👁️',
                    tier: 1,
                    condition: (stats) => stats.readingCount >= 10
                },
                {
                    id: 'reading_silver',
                    title: '火眼金睛 (银)',
                    description: '累计完成 50 篇阅读练习',
                    icon: '👁️',
                    tier: 2,
                    condition: (stats) => stats.readingCount >= 50
                },
                {
                    id: 'reading_gold',
                    title: '火眼金睛 (金)',
                    description: '累计完成 100 篇阅读练习',
                    icon: '👁️',
                    tier: 3,
                    condition: (stats) => stats.readingCount >= 100
                },

                // --- Balanced Practice ---
                {
                    id: 'balanced_foundation',
                    title: '双线推进',
                    description: '阅读与听力各完成 10 篇',
                    icon: '⚖️',
                    tier: 2,
                    condition: (stats) => stats.readingCount >= 10 && stats.listeningCount >= 10
                },
                {
                    id: 'balanced_advanced',
                    title: '均衡进阶',
                    description: '阅读与听力各完成 30 篇',
                    icon: '🧭',
                    tier: 3,
                    condition: (stats) => stats.readingCount >= 30 && stats.listeningCount >= 30
                },

                // --- Focus Time ---
                {
                    id: 'time_focus_60',
                    title: '专注一小时',
                    description: '累计学习 60 分钟',
                    icon: '⏱️',
                    tier: 1,
                    condition: (stats) => stats.totalStudyMinutes >= 60
                },
                {
                    id: 'time_focus_300',
                    title: '沉浸五小时',
                    description: '累计学习 300 分钟',
                    icon: '⏳',
                    tier: 2,
                    condition: (stats) => stats.totalStudyMinutes >= 300
                },
                {
                    id: 'time_focus_1000',
                    title: '深度备考',
                    description: '累计学习 1000 分钟',
                    icon: '⌛',
                    tier: 3,
                    condition: (stats) => stats.totalStudyMinutes >= 1000
                },

                // --- Accuracy Milestones ---
                {
                    id: 'accuracy_stable',
                    title: '稳中有进',
                    description: '10 次练习后平均正确率 70%+',
                    icon: '📈',
                    tier: 2,
                    condition: (stats) => stats.totalPracticed >= 10 && stats.averageAccuracy >= 0.7
                },
                {
                    id: 'accuracy_elite',
                    title: '高分稳定',
                    description: '20 次练习后平均正确率 85%+',
                    icon: '💎',
                    tier: 3,
                    condition: (stats) => stats.totalPracticed >= 20 && stats.averageAccuracy >= 0.85
                },
                {
                    id: 'perfect_three',
                    title: '三次满分',
                    description: '累计 3 次练习获得满分',
                    icon: '🎯',
                    tier: 2,
                    condition: (stats) => stats.perfectCount >= 3
                },
                {
                    id: 'perfect_ten',
                    title: '十全十美',
                    description: '累计 10 次练习获得满分',
                    icon: '🏆',
                    tier: 3,
                    condition: (stats) => stats.perfectCount >= 10
                },
                {
                    id: 'speed_three',
                    title: '快速稳定',
                    description: '3 次 5 分钟内完成高分练习',
                    icon: '⚡',
                    tier: 2,
                    condition: (stats) => stats.speedHighScoreCount >= 3
                },
                {
                    id: 'speed_ten',
                    title: '闪电节奏',
                    description: '10 次 5 分钟内完成高分练习',
                    icon: '🌩️',
                    tier: 3,
                    condition: (stats) => stats.speedHighScoreCount >= 10
                },

                // --- Special Achievements ---
                {
                    id: 'first_step',
                    title: '迈出第一步',
                    description: '完成第一次练习',
                    icon: '🌱',
                    tier: 1,
                    condition: (stats) => stats.totalPracticed >= 1
                },
                {
                    id: 'accuracy_perfect',
                    title: '神射手',
                    description: '单次练习获得 100% 正确率',
                    icon: '🎯',
                    tier: 3,
                    condition: (stats) => stats.hasPerfectAccuracy
                },
                {
                    id: 'speed_demon',
                    title: '唯快不破',
                    description: '5分钟内完成高分练习',
                    icon: '⚡',
                    tier: 3,
                    condition: (stats) => stats.hasSpeedDemon
                }
            ];
        }

        /**
         * Load unlocked state from storage
         */
        async _loadUnlockedState() {
            if (window.storage) {
                return await window.storage.get(this.storageKey, {});
            }
            const raw = localStorage.getItem(this.storageKey);
            return raw ? JSON.parse(raw) : {};
        }

        /**
         * Save unlocked state to storage
         */
        async _saveUnlockedState() {
            if (window.storage) {
                await window.storage.set(this.storageKey, this.unlocked);
                return;
            }
            localStorage.setItem(this.storageKey, JSON.stringify(this.unlocked));
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

        _normalizePracticeType(rawType) {
            if (!rawType) {
                return null;
            }

            const normalized = String(rawType).toLowerCase();
            if (normalized.includes('listen') || normalized.includes('audio') || normalized.includes('hearing')) {
                return 'listening';
            }
            if (normalized.includes('read')) {
                return 'reading';
            }
            return null;
        }

        _inferRecordPracticeType(record) {
            if (!record || typeof record !== 'object') {
                return null;
            }

            const metadata = record.metadata && typeof record.metadata === 'object'
                ? record.metadata
                : {};
            const candidates = [
                record.type,
                record.practiceType,
                metadata.type,
                metadata.examType,
                metadata.practiceType
            ];

            for (const candidate of candidates) {
                const normalized = this._normalizePracticeType(candidate);
                if (normalized) {
                    return normalized;
                }
            }

            const contextHints = [
                record.examId,
                record.url,
                record.title,
                metadata.url,
                metadata.examId,
                metadata.examTitle,
                metadata.title
            ]
                .filter(Boolean)
                .map((item) => String(item).toLowerCase())
                .join(' ');

            if (/listeningpractice|\/listening\/|listen|audio/.test(contextHints)) {
                return 'listening';
            }
            if (/reading|睡着过项目组/.test(contextHints)) {
                return 'reading';
            }

            return null;
        }

        _normalizeAccuracy(record) {
            if (!record || typeof record !== 'object') {
                return 0;
            }

            const scoreInfo = record.scoreInfo && typeof record.scoreInfo === 'object'
                ? record.scoreInfo
                : (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo === 'object'
                    ? record.realData.scoreInfo
                    : {});

            const candidates = [
                record.accuracy,
                scoreInfo.accuracy
            ];

            for (const candidate of candidates) {
                const value = Number(candidate);
                if (!Number.isFinite(value)) {
                    continue;
                }
                if (value > 1 && value <= 100) {
                    return value / 100;
                }
                return Math.max(0, Math.min(1, value));
            }

            return 0;
        }

        _getRecordDuration(record) {
            if (!record || typeof record !== 'object') {
                return 0;
            }

            const scoreInfo = record.scoreInfo && typeof record.scoreInfo === 'object'
                ? record.scoreInfo
                : (record.realData && record.realData.scoreInfo && typeof record.realData.scoreInfo === 'object'
                    ? record.realData.scoreInfo
                    : {});

            const candidates = [
                record.duration,
                record.realData && record.realData.duration,
                scoreInfo.duration,
                scoreInfo.timeSpent
            ];

            for (const candidate of candidates) {
                const value = Number(candidate);
                if (Number.isFinite(value) && value >= 0) {
                    return value;
                }
            }

            return 0;
        }

        _applyRecordsToDerivedStats(derived, records) {
            if (!derived || !Array.isArray(records) || records.length === 0) {
                return;
            }

            let listeningFromRecords = 0;
            let readingFromRecords = 0;
            let totalFromRecords = 0;
            let totalAccuracyFromRecords = 0;
            let accuracyRecordCount = 0;
            let totalDurationFromRecords = 0;

            records.forEach((record) => {
                if (!record || typeof record !== 'object') {
                    return;
                }

                totalFromRecords += 1;

                const practiceType = this._inferRecordPracticeType(record);
                if (practiceType === 'listening') {
                    listeningFromRecords += 1;
                } else if (practiceType === 'reading') {
                    readingFromRecords += 1;
                }

                const accuracy = this._normalizeAccuracy(record);
                const duration = this._getRecordDuration(record);
                totalAccuracyFromRecords += accuracy;
                accuracyRecordCount += 1;
                totalDurationFromRecords += duration;
                this._applyRecordToDerivedStats(derived, { accuracy, duration });
            });

            derived.totalPracticed = Math.max(Number(derived.totalPracticed) || 0, totalFromRecords);
            derived.listeningCount = Math.max(Number(derived.listeningCount) || 0, listeningFromRecords);
            derived.readingCount = Math.max(Number(derived.readingCount) || 0, readingFromRecords);
            derived.totalStudyMinutes = Math.max(
                Number(derived.totalStudyMinutes) || 0,
                totalDurationFromRecords / 60
            );
            if (accuracyRecordCount > 0) {
                derived.averageAccuracy = Math.max(
                    Number(derived.averageAccuracy) || 0,
                    totalAccuracyFromRecords / accuracyRecordCount
                );
            }
        }

        _buildDerivedStats(rawStats) {
            const stats = rawStats && typeof rawStats === 'object' ? rawStats : {};
            const averageScore = Number(stats.averageScore) || 0;
            return {
                totalPracticed: Number(stats.totalPractices) || 0,
                streakDays: Number(stats.streakDays) || 0,
                totalStudyMinutes: (Number(stats.totalTimeSpent) || 0) / 60,
                averageAccuracy: averageScore > 1 && averageScore <= 100 ? averageScore / 100 : averageScore,
                listeningCount: this._getCategoryPracticeCount(stats, 'listening'),
                readingCount: this._getCategoryPracticeCount(stats, 'reading'),
                hasPerfectAccuracy: false,
                hasSpeedDemon: false,
                perfectCount: 0,
                speedHighScoreCount: 0
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
                derived.perfectCount = (Number(derived.perfectCount) || 0) + 1;
            }
            if (duration > 0 && duration <= 300 && accuracy > 0.8) {
                derived.hasSpeedDemon = true;
                derived.speedHighScoreCount = (Number(derived.speedHighScoreCount) || 0) + 1;
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

            const records = await this._getPracticeRecordsFromScoreStorage();
            this._applyRecordsToDerivedStats(derivedStats, records);

            if (!includeRecords) {
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
         */
        async check(latestRecord) {
            if (!this.initialized) await this.init();
            return this.syncFromScoreStorage({ includeRecords: true, latestRecord, notify: true });
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

        await window.AchievementManager.syncFromScoreStorage({ includeRecords: true, notify: false });
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
