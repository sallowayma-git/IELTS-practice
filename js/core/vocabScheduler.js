(function(window) {
    const REVIEW_INTERVAL_HOURS = Object.freeze({
        1: 6,
        2: 24,
        3: 72,
        4: 168,
        5: 720
    });
    const MAX_BOX = 5;
    const MIN_BOX = 1;

    function toDate(input, fallback = new Date()) {
        if (!input) {
            return new Date(fallback);
        }
        if (input instanceof Date) {
            return new Date(input.getTime());
        }
        const parsed = new Date(input);
        if (Number.isNaN(parsed.getTime())) {
            return new Date(fallback);
        }
        return parsed;
    }

    function calculateNextReview(box, referenceTime) {
        const normalizedBox = Math.max(MIN_BOX, Math.min(MAX_BOX, Number(box) || MIN_BOX));
        const base = toDate(referenceTime, new Date());
        const hours = REVIEW_INTERVAL_HOURS[normalizedBox] || REVIEW_INTERVAL_HOURS[MIN_BOX];
        const next = new Date(base.getTime());
        next.setHours(next.getHours() + hours);
        return next;
    }

    function promote(word) {
        const boxValue = word && typeof word.box !== 'undefined' ? Number(word.box) : MIN_BOX;
        const nextBox = Math.min(MAX_BOX, (Number.isFinite(boxValue) ? boxValue : MIN_BOX) + 1);
        const correctCountValue = word && typeof word.correctCount !== 'undefined' ? Number(word.correctCount) : 0;
        const normalizedCount = Number.isFinite(correctCountValue) ? correctCountValue : 0;
        return {
            ...word,
            box: nextBox,
            correctCount: normalizedCount + 1
        };
    }

    function demote(word) {
        return {
            ...word,
            box: MIN_BOX,
            correctCount: 0
        };
    }

    function scheduleAfterResult(word, isCorrect, referenceTime = new Date()) {
        const updated = isCorrect ? promote(word) : demote(word);
        const reviewedAt = toDate(referenceTime, new Date()).toISOString();
        const nextReview = calculateNextReview(updated.box, reviewedAt).toISOString();
        return {
            ...updated,
            lastReviewed: reviewedAt,
            nextReview
        };
    }

    function pickDailyTask(allWords, limit = 100, options = {}) {
        const words = Array.isArray(allWords) ? allWords.slice() : [];
        const reviewLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 100;
        const newLimit = typeof options.newLimit === 'number' && options.newLimit >= 0 ? Math.floor(options.newLimit) : 20;
        const now = toDate(options.now, new Date());

        const dueWords = [];
        const newWords = [];

        words.forEach((word) => {
            if (!word) {
                return;
            }
            const nextReview = word.nextReview ? new Date(word.nextReview) : null;
            const lastReviewed = word.lastReviewed ? new Date(word.lastReviewed) : null;
            if (nextReview && !Number.isNaN(nextReview.getTime()) && nextReview <= now) {
                dueWords.push(word);
                return;
            }
            if (!lastReviewed || Number.isNaN(lastReviewed.getTime())) {
                newWords.push(word);
            }
        });

        const sortByDue = (a, b) => {
            const nextA = a.nextReview ? new Date(a.nextReview).getTime() : 0;
            const nextB = b.nextReview ? new Date(b.nextReview).getTime() : 0;
            if (Number.isNaN(nextA) && Number.isNaN(nextB)) {
                return (Number(a.correctCount) || 0) - (Number(b.correctCount) || 0);
            }
            if (Number.isNaN(nextA)) {
                return -1;
            }
            if (Number.isNaN(nextB)) {
                return 1;
            }
            if (nextA === nextB) {
                return (Number(a.correctCount) || 0) - (Number(b.correctCount) || 0);
            }
            return nextA - nextB;
        };

        dueWords.sort(sortByDue);

        const tasks = dueWords.slice(0, reviewLimit);
        if (tasks.length < reviewLimit && newLimit > 0) {
            const remaining = Math.min(newLimit, reviewLimit - tasks.length);
            const sortedNew = newWords.sort((a, b) => {
                const freqA = typeof a.freq === 'number' ? a.freq : 0;
                const freqB = typeof b.freq === 'number' ? b.freq : 0;
                if (freqA === freqB) {
                    return (a.word || '').localeCompare(b.word || '');
                }
                return freqB - freqA;
            });
            for (let i = 0; i < sortedNew.length && tasks.length < reviewLimit && i < remaining; i += 1) {
                tasks.push(sortedNew[i]);
            }
        }

        return tasks;
    }

    const api = Object.freeze({
        REVIEW_INTERVAL_HOURS,
        MAX_BOX,
        MIN_BOX,
        calculateNextReview,
        promote,
        demote,
        scheduleAfterResult,
        pickDailyTask
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabScheduler = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
