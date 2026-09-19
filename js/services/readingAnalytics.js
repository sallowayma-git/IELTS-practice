(function (global) {
    'use strict';

    const own = (value, key) => !!value && Object.prototype.hasOwnProperty.call(value, key);
    const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const list = (value) => Array.isArray(value) ? value : [];
    const number = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
        && Number.isFinite(Number(value)) ? Number(value) : null;
    const typeNames = Object.freeze({
        'heading-matching': '段落小标题', 'true-false-not-given': '判断题',
        'yes-no-not-given': '观点判断', 'multiple-choice': '单/多选题',
        'summary-completion': '摘要填空', 'sentence-completion': '句子填空',
        'short-answer': '简答题', 'diagram-labelling': '图表标注',
        'flow-chart': '流程图', 'table-completion': '表格填空',
        'matching-information': '信息配对', 'matching-features': '特征匹配',
        'matching-people-ideas': '人名观点配对'
    });
    const aliases = Object.fromEntries(Object.keys(typeNames).map(key => [key.replace(/-/g, ''), key]));
    Object.assign(aliases, {
        matchingheadings: 'heading-matching', headingsmatching: 'heading-matching',
        listofheadings: 'heading-matching', tfng: 'true-false-not-given', ynng: 'yes-no-not-given',
        mcq: 'multiple-choice', shortanswerquestions: 'short-answer',
        diagramlabeling: 'diagram-labelling', flowchartcompletion: 'flow-chart',
        matchingpeople: 'matching-people-ideas', matchingnames: 'matching-people-ideas'
    });

    function provenance(record, parent) {
        for (const candidate of [record, parent]) {
            if (!candidate) continue;
            const metadata = object(candidate.metadata);
            const source = own(metadata, 'libraryConfigurationId') ? metadata : candidate;
            if (!own(source, 'libraryConfigurationId')) continue;
            const id = source.libraryConfigurationId;
            if (id === null) return { known: true, id: null };
            return typeof id === 'string' && id.trim() ? { known: true, id: id.trim() } : { known: false };
        }
        return { known: false };
    }

    function identity(record, parent) {
        const id = record.examId || object(record.metadata).examId;
        const source = provenance(record, parent);
        return id && source.known ? JSON.stringify([source.id, 'reading', String(id)]) : null;
    }

    function eligible(record) {
        if (global.PracticeRecordSource && !global.PracticeRecordSource.isRealPracticeRecord(record)) return false;
        const status = String(record.status || object(record.metadata).status || '').trim().toLowerCase();
        return (!status || ['completed', 'submitted', 'graded'].includes(status))
            && record.graded !== false && record.gradable !== false;
    }

    function type(record, parent) {
        return String(record.type || record.examType || object(record.metadata).type
            || (parent && (parent.type || object(parent.metadata).type)) || '').toLowerCase().replace(/-suite$/, '');
    }

    function score(record) {
        const saved = own(record, 'browseScore') ? object(record.browseScore) : null;
        const info = object(record.scoreInfo || object(record.realData).scoreInfo);
        const earned = number(saved ? saved.earned : record.correctAnswers ?? info.correct ?? info.correctAnswers);
        const possible = number(saved ? saved.possible : record.totalQuestions ?? info.total ?? info.totalQuestions);
        return validPair({ earned, possible }) ? { earned, possible } : null;
    }

    function validPair(pair) {
        return pair.earned !== null && pair.possible !== null && pair.possible > 0
            && pair.earned >= 0 && pair.earned <= pair.possible;
    }

    function timestamp(record) {
        const candidates = own(record.browseScore, 'submittedAt') ? [record.browseScore.submittedAt]
            : [record.completedAt, record.endTime, record.date, record.timestamp];
        for (const value of candidates) {
            if (value == null || value === '') continue;
            const time = new Date(value).getTime();
            if (Number.isFinite(time) && time > 0) return time;
        }
        return null;
    }

    function children(record) {
        return (list(record.suiteEntrySummaries).length ? record.suiteEntrySummaries : list(record.suiteEntries))
            .filter(entry => entry && typeof entry === 'object');
    }

    function isSuite(record) {
        return object(record.readingAnalytics).isSuite === true || children(record).length > 0
            || record.suiteMode === true || /-suite$/.test(record.type || '')
            || Object.keys(object(record.suite)).length > 0;
    }

    function parentId(record) {
        return object(record.readingAnalytics).parentSessionId || record.suiteSessionId
            || object(record.metadata).suiteSessionId || null;
    }

    function measure() {
        return { earned: 0, possible: 0, attempts: 0, scored: 0, identities: new Set() };
    }

    function add(target, points, key) {
        target.attempts += 1;
        if (key) target.identities.add(key);
        if (points) {
            target.scored += 1;
            target.earned += points.earned;
            target.possible += points.possible;
        }
    }

    function finish(target) {
        const { identities, ...result } = target;
        return Object.assign(result, {
            distinctPassages: identities.size,
            accuracy: target.possible > 0 ? target.earned / target.possible : null
        });
    }

    function questionTypes(record) {
        const snapshot = object(record.readingAnalytics);
        if (snapshot.version === 1) return object(snapshot.questionTypes);
        return Object.fromEntries(Object.entries(object(record.questionTypePerformance)).map(([key, metrics]) => [key, {
            earned: number(object(metrics).correct ?? object(metrics).correctAnswers),
            possible: number(object(metrics).total ?? object(metrics).totalQuestions)
        }]));
    }

    function aggregate(records, options = {}) {
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        const days = [7, 30, 90].includes(Number(options.days)) ? Number(options.days) : null;
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        if (days) start.setDate(start.getDate() - days + 1);
        const query = String(options.query || '').trim().toLowerCase();
        const total = measure();
        const categories = Object.fromEntries(['P1', 'P2', 'P3'].map(key => [key, measure()]));
        const types = {};
        const suiteOnly = measure();
        const coverage = {
            unknownIdentity: 0, unknownCategory: 0, unknownDate: 0, excludedUndated: 0,
            completeQuestionTypes: 0, classifiedPossible: 0, unknownScore: 0,
            missingSuiteChildren: 0, suiteWithoutChildren: 0
        };
        const observations = [];
        const seen = new Set();
        const population = options.recordType === 'listening' ? [] : list(records).filter(record => record && typeof record === 'object');
        const parents = population.filter(isSuite);
        const singles = population.filter(record => !isSuite(record));
        const consumed = new Set();
        const seenParents = new Set();
        // History searches its visible record rows. A matching suite row brings
        // its children as a unit; child titles must not broaden that scope.
        const matchesQuery = (record, parent) => !query || [parent || record].some(item => item && [
            item.title, item.examId, item.category, item.frequency, item.date,
            object(item.metadata).examTitle, object(item.metadata).category
        ].some(value => String(value || '').toLowerCase().includes(query)));
        const inWindow = (record, parent) => {
            const time = timestamp(record) ?? (parent ? timestamp(parent) : null);
            if (time === null) {
                if (days) { coverage.excludedUndated += 1; return false; }
                coverage.unknownDate += 1;
            }
            return !days || (time >= start.getTime() && time <= now);
        };
        const addObservation = (record, parent = null) => {
            const key = identity(record, parent);
            // A session ID is evidence of the same submission, never of a retake.
            const tokens = key ? [record.id, record.sessionId].filter(Boolean).map(id => JSON.stringify([key, String(id)])) : [];
            if (parent && key) tokens.push(JSON.stringify([key, 'suite', String(parent.sessionId || parent.id)]));
            if (tokens.some(token => seen.has(token))) return;
            tokens.forEach(token => seen.add(token));
            if (!eligible(record) || type(record, parent) !== 'reading') return;
            if (!matchesQuery(record, parent) || !inWindow(record, parent)) return;
            observations.push({ record, key });
        };

        for (const parent of parents) {
            const source = provenance(parent);
            const parentToken = source.known && (parent.sessionId || parent.id)
                ? JSON.stringify([source.id, String(parent.sessionId || parent.id)]) : null;
            if (parentToken && seenParents.has(parentToken)) continue;
            if (parentToken) seenParents.add(parentToken);
            const linked = singles.filter(record => {
                const link = parentId(record);
                const childSource = provenance(record);
                return link && [parent.id, parent.sessionId].includes(link)
                    && !(source.known && childSource.known && source.id !== childSource.id);
            });
            linked.forEach(record => consumed.add(record));
            if (!eligible(parent) || type(parent) !== 'reading') continue;
            const entries = children(parent);
            // Exact parent linkage can recover passages when only standalone children survived.
            // This linkage also identifies duplicate representations when passage
            // provenance is unknown. Keep the saved child without enriching its identity.
            const passages = entries.slice();
            for (const record of linked) {
                const recordSource = provenance(record, parent);
                const recordExamId = record.examId || object(record.metadata).examId;
                const duplicate = passages.some(entry => {
                    const entrySource = provenance(entry, parent);
                    if (recordSource.known && entrySource.known && recordSource.id !== entrySource.id) return false;
                    const entryExamId = entry.examId || object(entry.metadata).examId;
                    if (recordExamId && entryExamId) return String(recordExamId) === String(entryExamId);
                    return [record.id, record.sessionId].filter(Boolean)
                        .some(id => [entry.id, entry.sessionId].includes(id));
                });
                if (!duplicate) passages.push(record);
            }
            for (const record of passages) addObservation(record, parent);
            if (!matchesQuery(parent) || type(parent) !== 'reading') continue;
            const expected = number(object(parent.readingAnalytics).expectedPassages
                ?? object(parent.metadata).suiteEntryCount);
            const available = new Set(passages.map((record, index) => identity(record, parent) || `unknown-${index}`)).size;
            if (!entries.length && !linked.length) {
                if (inWindow(parent)) {
                    coverage.suiteWithoutChildren += 1;
                    add(suiteOnly, score(parent));
                    if (expected > 0) coverage.missingSuiteChildren += expected;
                }
            } else if (expected > available) {
                const time = timestamp(parent);
                if (!days || (time !== null && time >= start.getTime() && time <= now)) {
                    coverage.missingSuiteChildren += expected - available;
                }
            }
        }
        for (const record of singles) if (!consumed.has(record)) addObservation(record);

        for (const { record, key } of observations) {
            const points = score(record);
            add(total, points, key);
            if (!key) coverage.unknownIdentity += 1;
            if (!points) coverage.unknownScore += 1;
            const snapshot = object(record.readingAnalytics);
            const category = snapshot.version === 1 ? snapshot.category
                : String(record.category || object(record.metadata).category || '').toUpperCase();
            if (own(categories, category)) add(categories[category], points, key);
            else coverage.unknownCategory += 1;
            if (!points) continue;
            const breakdown = new Map();
            for (const [label, raw] of Object.entries(questionTypes(record))) {
                const normalized = aliases[String(label).toLowerCase().replace(/[^a-z]/g, '')];
                const pair = { earned: number(object(raw).earned), possible: number(object(raw).possible) };
                if (!normalized || !validPair(pair)) continue;
                const previous = breakdown.get(normalized) || { earned: 0, possible: 0 };
                breakdown.set(normalized, { earned: previous.earned + pair.earned, possible: previous.possible + pair.possible });
            }
            const classified = Array.from(breakdown.values()).reduce((sum, pair) => ({
                earned: sum.earned + pair.earned, possible: sum.possible + pair.possible
            }), { earned: 0, possible: 0 });
            if (classified.earned > points.earned + 1e-9 || classified.possible > points.possible + 1e-9
                || points.earned - classified.earned > points.possible - classified.possible + 1e-9) continue;
            coverage.classifiedPossible += classified.possible;
            if (Math.abs(classified.possible - points.possible) < 1e-9
                && Math.abs(classified.earned - points.earned) < 1e-9) coverage.completeQuestionTypes += 1;
            for (const [key, pair] of breakdown) {
                if (!types[key]) types[key] = measure();
                add(types[key], pair);
            }
        }
        return {
            total: finish(total), categories: Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, finish(value)])),
            questionTypes: Object.fromEntries(Object.entries(types).map(([key, value]) => [key, finish(value)])),
            suiteOnly: finish(suiteOnly), coverage, days, recordType: options.recordType || 'all'
        };
    }

    global.ReadingAnalytics = { aggregate, typeNames };
})(window);
