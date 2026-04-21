(function (global) {
    'use strict';

    const READING_CATEGORIES = ['P1', 'P2', 'P3'];
    const LISTENING_CATEGORIES = ['P3', 'P4'];

    // 新增：100 P1 和 100 P4 特殊分类
    const SPECIAL_LISTENING_CATEGORIES = [
        { id: 'listening-p1-100', category: '100 P1', type: 'listening', path: 'ListeningPractice/100 P1', filterMode: 'frequency-p1' },
        { id: 'listening-p4-100', category: '100 P4', type: 'listening', path: 'ListeningPractice/100 P4', filterMode: 'frequency-p4' }
    ];

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

        // 统计特殊听力分类（100 P1 和 100 P4）
        const specialListening = new Map();
        SPECIAL_LISTENING_CATEGORIES.forEach((spec) => {
            specialListening.set(spec.path, {
                id: spec.id,
                category: spec.category,
                type: spec.type,
                path: spec.path,
                filterMode: spec.filterMode,
                total: 0
            });
        });

        normalized.forEach((exam) => {
            if (!exam) {
                return;
            }

            const category = exam.category;
            const type = exam.type;
            const path = exam.path || '';

            // 检查是否属于特殊听力分类
            let matchedSpecial = false;
            for (const [specPath, specData] of specialListening.entries()) {
                if (path.includes(specPath)) {
                    specData.total += 1;
                    matchedSpecial = true;
                    break;
                }
            }

            // 如果不属于特殊分类，按原有逻辑处理
            if (!matchedSpecial) {
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
            }
        });

        return {
            reading: Array.from(reading.values()),
            listening: Array.from(listening.values()),
            specialListening: Array.from(specialListening.values()).filter(item => item.total > 0),
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
            listening: LISTENING_CATEGORIES.slice(),
            specialListening: SPECIAL_LISTENING_CATEGORIES.slice()
        },
        calculate
    };
})(window);
