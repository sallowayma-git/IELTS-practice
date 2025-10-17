(function (global) {
    'use strict';

    const READING_CATEGORIES = ['P1', 'P2', 'P3'];
    const LISTENING_CATEGORIES = ['P3', 'P4'];

    function normalizeExams(exams) {
        return Array.isArray(exams) ? exams : [];
    }

    function createCategoryMap(categories, type) {
        const map = new Map();
        categories.forEach((category) => {
            map.set(category, {
                category,
                type,
                total: 0
            });
        });
        return map;
    }

    function calculate(exams) {
        const normalized = normalizeExams(exams);
        const reading = createCategoryMap(READING_CATEGORIES, 'reading');
        const listening = createCategoryMap(LISTENING_CATEGORIES, 'listening');
        const readingUnknownEntries = [];
        const listeningUnknownEntries = [];

        normalized.forEach((exam) => {
            if (!exam) {
                return;
            }

            const category = exam.category;
            const type = exam.type;

            if (type === 'reading') {
                if (reading.has(category)) {
                    reading.get(category).total += 1;
                } else {
                    readingUnknownEntries.push(exam);
                }
            } else if (type === 'listening') {
                if (listening.has(category)) {
                    listening.get(category).total += 1;
                } else {
                    listeningUnknownEntries.push(exam);
                }
            }
        });

        return {
            reading: Array.from(reading.values()),
            listening: Array.from(listening.values()),
            meta: {
                readingUnknown: readingUnknownEntries.length,
                listeningUnknown: listeningUnknownEntries.length,
                total: normalized.length,
                readingUnknownEntries,
                listeningUnknownEntries
            }
        };
    }

    global.AppServices = global.AppServices || {};
    global.AppServices.overviewStats = {
        categories: {
            reading: READING_CATEGORIES.slice(),
            listening: LISTENING_CATEGORIES.slice()
        },
        calculate
    };
})(window);
