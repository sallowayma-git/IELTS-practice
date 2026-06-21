(function (window) {
    'use strict';

    var STORAGE_KEY = 'learning_goals';
    var PROGRESS_KEY = 'goal_progress';
    var fallbackIdCounter = 0;

    function summarizeGoalManagerErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        var status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    var GOAL_TYPES = Object.freeze({
        PRACTICE_COUNT: 'practice_count',
        STUDY_TIME: 'study_time',
        ACCURACY: 'accuracy'
    });

    var GOAL_PERIODS = Object.freeze({
        DAILY: 'daily',
        WEEKLY: 'weekly',
        MONTHLY: 'monthly'
    });

    var PERIOD_MS = Object.freeze({
        daily: 24 * 60 * 60 * 1000,
        weekly: 7 * 24 * 60 * 60 * 1000,
        monthly: 30 * 24 * 60 * 60 * 1000
    });
    var GOAL_TYPE_VALUES = Object.freeze(Object.keys(GOAL_TYPES).map(function (key) {
        return GOAL_TYPES[key];
    }));
    var GOAL_PERIOD_VALUES = Object.freeze(Object.keys(GOAL_PERIODS).map(function (key) {
        return GOAL_PERIODS[key];
    }));
    var MAX_GOAL_TITLE_LENGTH = 80;
    var MAX_GOAL_ID_LENGTH = 160;
    var MAX_STORED_GOALS = 100;
    var MAX_PROGRESS_PERIODS = 400;
    var MAX_PROGRESS_VALUE = 1000000;
    var UNSAFE_OBJECT_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

    var PROGRESS_METRIC_VALUES = Object.freeze([
        GOAL_TYPES.PRACTICE_COUNT,
        GOAL_TYPES.STUDY_TIME,
        GOAL_TYPES.ACCURACY,
        GOAL_TYPES.ACCURACY + '_sum',
        GOAL_TYPES.ACCURACY + '_count'
    ]);

    function isAllowedGoalType(type) {
        return GOAL_TYPE_VALUES.indexOf(type) !== -1;
    }

    function isAllowedGoalPeriod(period) {
        return GOAL_PERIOD_VALUES.indexOf(period) !== -1;
    }

    function isUnsafeObjectKey(key) {
        return UNSAFE_OBJECT_KEYS.indexOf(String(key)) !== -1;
    }

    function isPlainObject(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        var prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    function isAllowedProgressMetric(metric) {
        return PROGRESS_METRIC_VALUES.indexOf(metric) !== -1;
    }

    function isValidDateKey(value) {
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) return false;
        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        var date = new Date(Date.UTC(year, month - 1, day));
        return date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day;
    }

    function isValidMonthKey(value) {
        var match = /^(\d{4})-(\d{2})$/.exec(value);
        if (!match) return false;
        var month = Number(match[2]);
        return month >= 1 && month <= 12;
    }

    function isValidWeekKey(value) {
        var match = /^(\d{4})-W(\d{2})$/.exec(value);
        if (!match) return false;
        var week = Number(match[2]);
        return week >= 1 && week <= 53;
    }

    function isSafeProgressPeriodKey(key) {
        var value = String(key || '');
        if (isUnsafeObjectKey(value)) return false;
        return isValidDateKey(value) || isValidMonthKey(value) || isValidWeekKey(value);
    }

    function clampProgressValue(metric, value) {
        var number = Number(value);
        if (!Number.isFinite(number) || number < 0) return 0;
        if (metric === GOAL_TYPES.ACCURACY) {
            return Math.min(1, number);
        }
        if (metric === GOAL_TYPES.ACCURACY + '_count') {
            return Math.min(MAX_PROGRESS_VALUE, Math.floor(number));
        }
        return Math.min(MAX_PROGRESS_VALUE, number);
    }

    function normalizeProgressEntry(entry) {
        if (!isPlainObject(entry)) return null;
        var normalized = {};
        PROGRESS_METRIC_VALUES.forEach(function (metric) {
            if (Object.prototype.hasOwnProperty.call(entry, metric)) {
                normalized[metric] = clampProgressValue(metric, entry[metric]);
            }
        });
        return Object.keys(normalized).length ? normalized : null;
    }

    function normalizeProgress(value) {
        if (!isPlainObject(value)) return {};
        var normalized = {};
        Object.keys(value).slice(0, MAX_PROGRESS_PERIODS).forEach(function (key) {
            if (!isSafeProgressPeriodKey(key)) return;
            var entry = normalizeProgressEntry(value[key]);
            if (entry) {
                normalized[key] = entry;
            }
        });
        return normalized;
    }

    function randomIdSuffix() {
        var cryptoObj = window.crypto || window.msCrypto;
        if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
            return cryptoObj.randomUUID();
        }
        if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
            var bytes = new Uint8Array(16);
            cryptoObj.getRandomValues(bytes);
            return Array.prototype.map.call(bytes, function (byte) {
                return byte.toString(16).padStart(2, '0');
            }).join('');
        }
        fallbackIdCounter += 1;
        return 'fallback_' + fallbackIdCounter.toString(36);
    }

    function getNow() {
        return new Date().toISOString();
    }

    function toNonNegativeInteger(value) {
        var number = Number(value);
        if (!Number.isFinite(number) || number < 0) return 0;
        return Math.floor(number);
    }

    function todayKey() {
        return new Date().toISOString().slice(0, 10);
    }

    function weekKey() {
        var d = new Date();
        var jan1 = new Date(d.getFullYear(), 0, 1);
        var week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
        return d.getFullYear() + '-W' + String(week).padStart(2, '0');
    }

    function monthKey() {
        return new Date().toISOString().slice(0, 7);
    }

    function periodKey(period) {
        if (period === GOAL_PERIODS.DAILY) return todayKey();
        if (period === GOAL_PERIODS.WEEKLY) return weekKey();
        if (period === GOAL_PERIODS.MONTHLY) return monthKey();
        return todayKey();
    }

    function generateId() {
        return 'goal_' + Date.now().toString(36) + '_' + randomIdSuffix();
    }

    function normalizeGoal(input) {
        if (!input || typeof input !== 'object') return null;
        var type = input.type;
        var period = input.period;
        if (!isAllowedGoalType(type)) return null;
        if (!isAllowedGoalPeriod(period)) return null;

        var target = Number(input.target);
        if (!Number.isFinite(target) || target <= 0) return null;
        var id = typeof input.id === 'string' && input.id.trim()
            ? input.id.trim().slice(0, MAX_GOAL_ID_LENGTH)
            : generateId();
        var title = typeof input.title === 'string'
            ? input.title.trim().slice(0, MAX_GOAL_TITLE_LENGTH)
            : '';

        return {
            id: id,
            type: type,
            period: period,
            target: Math.floor(target),
            title: title,
            createdAt: input.createdAt || getNow(),
            updatedAt: getNow()
        };
    }

    function normalizeGoalList(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, MAX_STORED_GOALS).map(normalizeGoal).filter(Boolean);
    }

    function normalizeStreak(value) {
        if (!value || typeof value !== 'object') {
            return { current: 0, best: 0, lastDate: null };
        }
        var lastDate = typeof value.lastDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastDate)
            ? value.lastDate
            : null;
        return {
            current: toNonNegativeInteger(value.current),
            best: toNonNegativeInteger(value.best),
            lastDate: lastDate
        };
    }

    function GoalManager() {
        this.goals = [];
        this.progress = {};
        this.streak = { current: 0, best: 0, lastDate: null };
        this.ready = false;
        this._readyPromise = this._init();
        this._listeners = [];
    }

    GoalManager.prototype._init = async function () {
        try {
            if (window.storage) {
                await window.storage.waitForInitialization();
                this.goals = normalizeGoalList(await window.storage.get(STORAGE_KEY, []));
                var saved = await window.storage.get(PROGRESS_KEY, null);
                if (saved && typeof saved === 'object') {
                    this.progress = normalizeProgress(saved.progress);
                    this.streak = normalizeStreak(saved.streak);
                }
            } else {
                try {
                    var raw = localStorage.getItem(STORAGE_KEY);
                    this.goals = normalizeGoalList(raw ? JSON.parse(raw) : []);
                    var rawP = localStorage.getItem(PROGRESS_KEY);
                    if (rawP) {
                        var parsed = JSON.parse(rawP);
                        this.progress = normalizeProgress(parsed.progress);
                        this.streak = normalizeStreak(parsed.streak);
                    }
                } catch (e) {
                    this.goals = [];
                    this.progress = {};
                }
            }
            this.ready = true;
            this._bindEvents();
        } catch (e) {
            console.error('[GoalManager] init failed:', summarizeGoalManagerErrorForLog(e));
            this.ready = true;
        }
    };

    GoalManager.prototype._bindEvents = function () {
        var self = this;
        window.addEventListener('practiceSessionCompleted', function (e) {
            self._onPracticeCompleted(e.detail);
        });
    };

    GoalManager.prototype._onPracticeCompleted = async function (detail) {
        if (!detail) return;
        await this._readyPromise;

        var record = detail.record || detail;
        var accuracy = this._extractAccuracy(record);
        var duration = this._extractDuration(record);
        var pk = todayKey();

        this._incrementProgress(pk, GOAL_TYPES.PRACTICE_COUNT, 1);
        this._updateStreak();
        this._incrementProgress(pk, GOAL_TYPES.STUDY_TIME, Math.round(duration / 60));

        var weekPk = weekKey();
        this._incrementProgress(weekPk, GOAL_TYPES.STUDY_TIME, Math.round(duration / 60));

        var monthPk = monthKey();
        this._incrementProgress(monthPk, GOAL_TYPES.STUDY_TIME, Math.round(duration / 60));

        if (accuracy > 0) {
            this._updateAccuracyProgress(GOAL_PERIODS.DAILY, accuracy);
            this._updateAccuracyProgress(GOAL_PERIODS.WEEKLY, accuracy);
            this._updateAccuracyProgress(GOAL_PERIODS.MONTHLY, accuracy);
        }

        await this._save();
        this._checkCompletions();
        this._emit('goalUpdated', { goals: this.goals, progress: this.progress, streak: this.streak });
    };

    GoalManager.prototype._extractAccuracy = function (record) {
        if (!record) return 0;
        var candidates = [
            record.accuracy,
            record.scoreInfo && record.scoreInfo.accuracy,
            record.realData && record.realData.accuracy,
            record.realData && record.realData.scoreInfo && record.realData.scoreInfo.accuracy
        ];
        for (var i = 0; i < candidates.length; i++) {
            var v = Number(candidates[i]);
            if (Number.isFinite(v) && v >= 0) {
                return v > 1 && v <= 100 ? v / 100 : v;
            }
        }
        return 0;
    };

    GoalManager.prototype._extractDuration = function (record) {
        if (!record) return 0;
        var candidates = [
            record.duration,
            record.scoreInfo && record.scoreInfo.duration,
            record.scoreInfo && record.scoreInfo.timeSpent,
            record.realData && record.realData.duration,
            record.realData && record.realData.scoreInfo && record.realData.scoreInfo.duration
        ];
        for (var i = 0; i < candidates.length; i++) {
            var v = Number(candidates[i]);
            if (Number.isFinite(v) && v >= 0) return v;
        }
        return 0;
    };

    GoalManager.prototype._incrementProgress = function (pk, type, amount) {
        if (!isSafeProgressPeriodKey(pk) || !isAllowedProgressMetric(type)) return;
        if (!isPlainObject(this.progress[pk])) this.progress[pk] = {};
        var current = clampProgressValue(type, this.progress[pk][type]);
        this.progress[pk][type] = clampProgressValue(type, current + (Number(amount) || 0));
    };

    GoalManager.prototype._updateAccuracyProgress = function (period, accuracy) {
        var pk = periodKey(period);
        if (!isSafeProgressPeriodKey(pk)) return;
        if (!isPlainObject(this.progress[pk])) this.progress[pk] = {};
        var acc = this.progress[pk];
        if (!acc[GOAL_TYPES.ACCURACY + '_sum']) {
            acc[GOAL_TYPES.ACCURACY + '_sum'] = 0;
            acc[GOAL_TYPES.ACCURACY + '_count'] = 0;
        }
        acc[GOAL_TYPES.ACCURACY + '_sum'] = clampProgressValue(GOAL_TYPES.ACCURACY + '_sum', acc[GOAL_TYPES.ACCURACY + '_sum'] + accuracy);
        acc[GOAL_TYPES.ACCURACY + '_count'] = clampProgressValue(GOAL_TYPES.ACCURACY + '_count', acc[GOAL_TYPES.ACCURACY + '_count'] + 1);
        acc[GOAL_TYPES.ACCURACY] = clampProgressValue(
            GOAL_TYPES.ACCURACY,
            acc[GOAL_TYPES.ACCURACY + '_count'] > 0
                ? acc[GOAL_TYPES.ACCURACY + '_sum'] / acc[GOAL_TYPES.ACCURACY + '_count']
                : 0
        );
    };

    GoalManager.prototype._updateStreak = function () {
        var today = todayKey();
        if (this.streak.lastDate === today) return;

        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        var yesterdayKey = yesterday.toISOString().slice(0, 10);

        if (this.streak.lastDate === yesterdayKey) {
            this.streak.current += 1;
        } else if (this.streak.lastDate !== today) {
            this.streak.current = 1;
        }
        this.streak.lastDate = today;
        if (this.streak.current > this.streak.best) {
            this.streak.best = this.streak.current;
        }
    };

    GoalManager.prototype._checkCompletions = function () {
        var self = this;
        this.goals.forEach(function (goal) {
            var pk = periodKey(goal.period);
            var current = self._getGoalCurrent(goal, pk);
            if (current >= goal.target) {
                self._emit('goalCompleted', { goal: goal, current: current });
            }
        });
    };

    GoalManager.prototype._getGoalCurrent = function (goal, pk) {
        if (!isSafeProgressPeriodKey(pk) || !isPlainObject(this.progress[pk])) return 0;
        return clampProgressValue(goal.type, this.progress[pk][goal.type]);
    };

    GoalManager.prototype._save = async function () {
        try {
            this.progress = normalizeProgress(this.progress);
            if (window.storage) {
                await window.storage.set(STORAGE_KEY, this.goals);
                await window.storage.set(PROGRESS_KEY, { progress: this.progress, streak: this.streak });
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.goals));
                localStorage.setItem(PROGRESS_KEY, JSON.stringify({ progress: this.progress, streak: this.streak }));
            }
        } catch (e) {
            console.error('[GoalManager] save failed:', summarizeGoalManagerErrorForLog(e));
        }
    };

    GoalManager.prototype._emit = function (name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail: detail }));
    };

    // Public API

    GoalManager.prototype.createGoal = async function (input) {
        await this._readyPromise;
        var goal = normalizeGoal(input);
        if (!goal) return null;
        this.goals.push(goal);
        await this._save();
        this._emit('goalUpdated', { goals: this.goals, progress: this.progress, streak: this.streak });
        return goal;
    };

    GoalManager.prototype.updateGoal = async function (id, updates) {
        await this._readyPromise;
        var idx = this.goals.findIndex(function (g) { return g.id === id; });
        if (idx < 0) return null;
        var existing = this.goals[idx];
        var merged = {
            id: existing.id,
            type: updates.type || existing.type,
            period: updates.period || existing.period,
            target: updates.target !== undefined ? Number(updates.target) : existing.target,
            title: updates.title !== undefined ? updates.title : existing.title,
            createdAt: existing.createdAt,
            updatedAt: getNow()
        };
        var normalized = normalizeGoal(merged);
        if (!normalized) return null;
        this.goals[idx] = normalized;
        await this._save();
        this._emit('goalUpdated', { goals: this.goals, progress: this.progress, streak: this.streak });
        return normalized;
    };

    GoalManager.prototype.deleteGoal = async function (id) {
        await this._readyPromise;
        var before = this.goals.length;
        this.goals = this.goals.filter(function (g) { return g.id !== id; });
        if (this.goals.length < before) {
            await this._save();
            this._emit('goalUpdated', { goals: this.goals, progress: this.progress, streak: this.streak });
            return true;
        }
        return false;
    };

    GoalManager.prototype.getGoals = function () {
        return this.goals.slice();
    };

    GoalManager.prototype.getGoalProgress = function (goalId) {
        var goal = this.goals.find(function (g) { return g.id === goalId; });
        if (!goal) return null;
        var pk = periodKey(goal.period);
        var current = this._getGoalCurrent(goal, pk);
        return {
            goal: goal,
            current: current,
            target: goal.target,
            percent: goal.target > 0 ? Math.min(100, Math.round(current / goal.target * 100)) : 0,
            completed: current >= goal.target,
            periodKey: pk
        };
    };

    GoalManager.prototype.getAllProgress = function () {
        var self = this;
        return this.goals.map(function (goal) {
            return self.getGoalProgress(goal.id);
        }).filter(Boolean);
    };

    GoalManager.prototype.getStreak = function () {
        return {
            current: this.streak.current,
            best: this.streak.best,
            lastDate: this.streak.lastDate
        };
    };

    GoalManager.prototype.on = function (eventName, callback) {
        this._listeners.push({ event: eventName, callback: callback });
        window.addEventListener(eventName, callback);
    };

    GoalManager.prototype.off = function (eventName, callback) {
        this._listeners = this._listeners.filter(function (l) {
            return !(l.event === eventName && l.callback === callback);
        });
        window.removeEventListener(eventName, callback);
    };

    GoalManager.prototype.destroy = function () {
        this._listeners.forEach(function (l) {
            window.removeEventListener(l.event, l.callback);
        });
        this._listeners = [];
    };

    GoalManager.TYPES = GOAL_TYPES;
    GoalManager.PERIODS = GOAL_PERIODS;

    window.GoalManager = GoalManager;
})(typeof window !== 'undefined' ? window : this);
