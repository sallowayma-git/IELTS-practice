(function (global) {
    'use strict';

    var domAdapter = global.DOMAdapter || null;

    function isLegacyUnsafeAttributeName(name) {
        var key = String(name || '').toLowerCase();
        return key.indexOf('on') === 0 || key === 'srcdoc';
    }

    function isLegacyUnsafeUrlAttribute(name, value, tagName) {
        var key = String(name || '').toLowerCase();
        var urlAttributes = {
            href: true,
            src: true,
            srcset: true,
            imagesrcset: true,
            'xlink:href': true,
            action: true,
            formaction: true,
            poster: true,
            background: true,
            cite: true,
            longdesc: true,
            ping: true
        };
        if (!urlAttributes[key]) {
            return false;
        }
        var text = String(value == null ? '' : value).trim();
        if (!text) {
            return false;
        }
        var compactAll = text.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
        if (compactAll.indexOf('javascript:') !== -1
            || compactAll.indexOf('vbscript:') !== -1
            || compactAll.indexOf('data:text/html') !== -1
            || compactAll.indexOf('data:application/xhtml+xml') !== -1
            || compactAll.indexOf('data:image/svg+xml') !== -1) {
            return true;
        }
        var candidates = (key === 'srcset' || key === 'imagesrcset')
            ? text.split(',').map(function (part) { return part.trim().split(/\s+/, 1)[0]; }).filter(Boolean)
            : (key === 'ping' ? text.split(/\s+/).filter(Boolean) : [text]);
        return candidates.some(function (candidate) {
            var compact = String(candidate).replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
            if (compact.indexOf('javascript:') === 0 || compact.indexOf('vbscript:') === 0) {
                return true;
            }
            if (compact.indexOf('data:') === 0) {
                var tag = String(tagName || '').toLowerCase();
                var imageLikeAttribute = key === 'src' || key === 'srcset' || key === 'imagesrcset';
                var imageLikeTag = tag === 'img' || tag === 'source';
                if (!imageLikeAttribute || !imageLikeTag) {
                    return true;
                }
                return /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(compact);
            }
            return false;
        });
    }

    function isLegacyUnsafeObjectKey(name) {
        var key = String(name || '').toLowerCase();
        return key === '__proto__' || key === 'prototype' || key === 'constructor';
    }

    function isLegacyUnsafeStyleValue(name, value) {
        if (isLegacyUnsafeObjectKey(name) || value == null) {
            return true;
        }
        var compact = String(value).replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
        return compact.indexOf('javascript:') !== -1
            || compact.indexOf('vbscript:') !== -1
            || compact.indexOf('expression(') !== -1
            || compact.indexOf('data:text/html') !== -1
            || compact.indexOf('data:application/xhtml+xml') !== -1
            || compact.indexOf('data:image/svg+xml') !== -1;
    }

    function applyLegacyElementAttributes(element, attributes) {
        if (!element || !attributes || typeof attributes !== 'object') {
            return;
        }
        Object.keys(attributes).forEach(function (key) {
            var value = attributes[key];
            if (value == null || value === false) {
                return;
            }
            if (isLegacyUnsafeAttributeName(key) || isLegacyUnsafeUrlAttribute(key, value, element.tagName)) {
                console.warn('[LegacyView] Skipped unsafe attribute: ' + key);
                return;
            }
            if (key === 'className') {
                element.className = value;
                return;
            }
            if (key === 'dataset' && typeof value === 'object') {
                Object.keys(value).forEach(function (dataKey) {
                    var dataValue = value[dataKey];
                    if (dataValue != null && !isLegacyUnsafeObjectKey(dataKey)) {
                        element.dataset[dataKey] = String(dataValue);
                    }
                });
                return;
            }
            if (key === 'style' && typeof value === 'object') {
                Object.keys(value).forEach(function (styleKey) {
                    if (!isLegacyUnsafeStyleValue(styleKey, value[styleKey])) {
                        element.style[styleKey] = value[styleKey];
                    }
                });
                return;
            }
            if (key === 'ariaHidden') {
                element.setAttribute('aria-hidden', value === true ? 'true' : String(value));
                return;
            }
            if (key === 'ariaLabel') {
                element.setAttribute('aria-label', String(value));
                return;
            }
            if (key === 'disabled') {
                element.disabled = !!value;
                return;
            }
            element.setAttribute(key, value === true ? '' : String(value));
        });
    }

    // --- Practice statistics service ---
    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function normalizeTypeValue(value) {
        if (!value) {
            return '';
        }
        var normalized = String(value).toLowerCase();
        if (normalized.indexOf('read') !== -1 || normalized.indexOf('阅读') !== -1) {
            return 'reading';
        }
        if (normalized.indexOf('listen') !== -1 || normalized.indexOf('听力') !== -1) {
            return 'listening';
        }
        return normalized;
    }

    function toDateKey(value) {
        if (!value) {
            return null;
        }
        var date = new Date(value);
        if (isNaN(date.getTime())) {
            return null;
        }
        return date.toISOString().slice(0, 10);
    }

    function getRecordTimestamp(record) {
        if (!record || typeof record !== 'object') {
            return 0;
        }
        var candidates = [
            record.date, record.startTime, record.endTime, record.timestamp, record.createdAt, record.updatedAt,
            record.completedAt, record.startedAt
        ];
        var rd = record.realData || {};
        var metadata = record.metadata || {};
        candidates.push(
            rd.date, rd.startTime, rd.endTime, rd.timestamp, rd.createdAt, rd.completedAt,
            metadata.startedAt, metadata.completedAt, metadata.createdAt
        );

        var maxTs = 0;
        for (var i = 0; i < candidates.length; i += 1) {
            var candidate = candidates[i];
            if (candidate == null) {
                continue;
            }
            var parsed = new Date(candidate).getTime();
            if (!isNaN(parsed) && parsed > maxTs) {
                maxTs = parsed;
                continue;
            }
            if (typeof candidate === 'number' && isFinite(candidate) && candidate > maxTs) {
                maxTs = candidate;
            }
        }
        return maxTs;
    }

    function normalizePathValue(path) {
        if (!path) {
            return '';
        }
        var normalized = String(path).replace(/\\/g, '/').trim().toLowerCase();
        normalized = normalized.replace(/^\.?\//, '');
        return normalized;
    }

    function getPathTail(path) {
        var normalized = normalizePathValue(path);
        var parts = normalized.split('/').filter(Boolean);
        if (!parts.length) {
            return '';
        }
        if (parts.length === 1) {
            return parts[0];
        }
        return parts.slice(-2).join('/');
    }

    function recordMatchesExam(exam, record) {
        if (!exam || !record) {
            return false;
        }
        if (exam.id && record.examId && exam.id === record.examId) {
            return true;
        }
        var examTitle = exam.title || '';
        var recordTitle = record.title || record.examTitle || '';
        if (examTitle && recordTitle && examTitle === recordTitle) {
            return true;
        }
        var examPath = normalizePathValue(exam.path || exam.resourcePath || exam.basePath);
        var recordPath = normalizePathValue(
            record.path ||
            record.examPath ||
            record.resourcePath ||
            (record.realData && (record.realData.path || record.realData.examPath))
        );
        if (examPath && recordPath) {
            if (examPath === recordPath) {
                return true;
            }
            if (recordPath.endsWith('/' + examPath) || examPath.endsWith('/' + recordPath)) {
                return true;
            }
            var examTail = getPathTail(examPath);
            var recordTail = getPathTail(recordPath);
            if (examTail && recordTail && (examTail === recordTail || examTail.endsWith(recordTail) || recordTail.endsWith(examTail))) {
                return true;
            }
        }
        var examFile = (exam.filename || exam.pdfFilename || '').toLowerCase();
        var recordFile = (record.filename || record.examFile || record.examFilename || '').toLowerCase();
        if (!recordFile && record.realData) {
            recordFile = (record.realData.filename || record.realData.examFile || record.realData.pdfFilename || '').toLowerCase();
        }
        if (examFile && recordFile && examFile === recordFile) {
            return true;
        }
        return false;
    }

    function calculateStreak(uniqueDateKeys) {
        if (!uniqueDateKeys.length) {
            return 0;
        }
        var sorted = uniqueDateKeys.slice().sort(function (a, b) {
            return new Date(b) - new Date(a);
        });
        var today = new Date();
        var streak = 0;
        var previousDate = null;

        for (var i = 0; i < sorted.length; i += 1) {
            var currentDate = new Date(sorted[i]);
            if (i === 0) {
                var differenceFromToday = Math.floor((today - currentDate) / (24 * 60 * 60 * 1000));
                if (differenceFromToday > 1) {
                    break;
                }
                streak = 1;
                previousDate = currentDate;
                continue;
            }

            var diff = Math.floor((previousDate - currentDate) / (24 * 60 * 60 * 1000));
            if (diff === 1) {
                streak += 1;
                previousDate = currentDate;
            } else {
                break;
            }
        }

        return streak;
    }

    function calculateSummary(records) {
        var normalized = ensureArray(records);
        var totalPracticed = normalized.length;
        var totalScore = 0;
        var totalMinutes = 0;
        var uniqueDates = [];
        var seenDates = new Set();

        for (var i = 0; i < normalized.length; i += 1) {
            var record = normalized[i];
            var percentage = typeof record.percentage === 'number' ? record.percentage : 0;
            var duration = typeof record.duration === 'number' ? record.duration : 0;
            totalScore += percentage;
            totalMinutes += duration;

            var dateKey = toDateKey(record.date);
            if (dateKey && !seenDates.has(dateKey)) {
                seenDates.add(dateKey);
                uniqueDates.push(dateKey);
            }
        }

        var avgScore = totalPracticed > 0 ? totalScore / totalPracticed : 0;
        var streak = calculateStreak(uniqueDates);

        return {
            totalPracticed: totalPracticed,
            averageScore: avgScore,
            totalStudyMinutes: totalMinutes / 60,
            streak: streak
        };
    }

    function sortByDateDesc(records) {
        return ensureArray(records).slice().sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });
    }

    function filterByExamType(records, exams, type) {
        if (!type || type === 'all') {
            return ensureArray(records);
        }
        var targetType = normalizeTypeValue(type);
        var index = ensureArray(exams);
        return ensureArray(records).filter(function (record) {
            if (!record) {
                return false;
            }
            var exam = index.find(function (item) {
                return item && (item.id === record.examId || item.title === record.title);
            });
            var examType = exam ? normalizeTypeValue(exam.type) : '';
            if (examType) {
                return examType === targetType;
            }
            var recordType = normalizeTypeValue(
                record.type ||
                record.examType ||
                (record.metadata && record.metadata.type) ||
                (record.realData && record.realData.type)
            );
            if (recordType) {
                return recordType === targetType;
            }
            // 无法确定类型时保持展示，避免题库切换导致历史记录被过滤掉
            return true;
        });
    }

    var PracticeStats = {
        calculateSummary: calculateSummary,
        sortByDateDesc: sortByDateDesc,
        filterByExamType: filterByExamType
    };

    // --- Practice dashboard view ---
    function PracticeDashboardView(options) {
        options = options || {};
        this.domAdapter = options.domAdapter || domAdapter;
        this.ids = {
            total: options.totalId || 'total-practiced',
            average: options.averageId || 'avg-score',
            duration: options.durationId || 'study-time',
            streak: options.streakId || 'streak-days'
        };
    }

    PracticeDashboardView.prototype.updateSummary = function updateSummary(summary) {
        summary = summary || {};
        this._setText(this.ids.total, typeof summary.totalPracticed === 'number' ? summary.totalPracticed : 0);
        this._setText(this.ids.average, formatPercentage(summary.averageScore));
        this._setText(this.ids.duration, formatMinutes(summary.totalStudyMinutes));
        this._setText(this.ids.streak, typeof summary.streak === 'number' ? summary.streak : 0);
    };

    PracticeDashboardView.prototype._setText = function _setText(id, value) {
        if (!id || typeof document === 'undefined') {
            return;
        }
        var element = document.getElementById(id);
        if (!element) {
            return;
        }
        if (this.domAdapter && typeof this.domAdapter.setText === 'function') {
            this.domAdapter.setText(element, value);
        } else {
            element.textContent = value;
        }
    };

    function formatPercentage(value) {
        if (typeof value !== 'number' || isNaN(value)) {
            return '0.0%';
        }
        return value.toFixed(1) + '%';
    }

    function formatMinutes(minutes) {
        if (typeof minutes !== 'number' || isNaN(minutes)) {
            return '0';
        }
        return Math.round(minutes).toString();
    }

    // --- Practice trend renderer ---
    var practiceTrendRanges = [
        { key: 'recent10', label: '最近十次', mode: 'count', value: 10 },
        { key: 'last7d', label: '最近七天', mode: 'days', value: 7 },
        { key: 'last30d', label: '最近一月', mode: 'days', value: 30 },
        { key: 'recent20', label: '最近20次', mode: 'count', value: 20 }
    ];
    var practiceTrendRangeByKey = practiceTrendRanges.reduce(function buildRangeMap(map, range) {
        map[range.key] = range;
        return map;
    }, {});

    function PracticeTrendRenderer(options) {
        options = options || {};
        this.ids = {
            card: options.cardId || 'practice-trend-card',
            canvas: options.canvasId || 'practice-trend-canvas',
            empty: options.emptyId || 'practice-trend-empty',
            rangeLabel: options.rangeLabelId || 'practice-trend-range-label',
            count: options.countId || 'practice-trend-count',
            average: options.averageId || 'practice-trend-average'
        };
        this.rangeKey = options.defaultRange || 'recent10';
        this.records = [];
        this.bound = false;
        this.resizeHandler = null;
    }

    PracticeTrendRenderer.ranges = practiceTrendRanges.slice();

    PracticeTrendRenderer.prototype.update = function update(records) {
        this.records = Array.isArray(records) ? records.slice() : [];
        this._ensureInteractions();
        this.render();
    };

    PracticeTrendRenderer.prototype.render = function render() {
        if (typeof document === 'undefined') {
            return;
        }
        var card = this._getElement('card');
        var canvas = this._getElement('canvas');
        if (!card || !canvas || !canvas.getContext) {
            return;
        }

        var range = practiceTrendRangeByKey[this.rangeKey] || practiceTrendRangeByKey.recent10;
        var points = this._selectPoints(range);
        this._setText('rangeLabel', range.label);
        this._setText('count', String(points.length));
        this._setText('average', this._formatAverage(points));
        this._syncOptionState();

        if (points.length === 0) {
            card.classList.add('is-empty');
            this._drawEmpty(canvas);
            return;
        }
        card.classList.remove('is-empty');
        this._drawChart(canvas, points);
    };

    PracticeTrendRenderer.prototype.flipToBack = function flipToBack() {
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        card.classList.add('is-flipped');
        card.setAttribute('aria-pressed', 'true');
        card.setAttribute('aria-label', '关闭练习趋势筛选范围');
    };

    PracticeTrendRenderer.prototype.flipToFront = function flipToFront() {
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        card.classList.remove('is-flipped');
        card.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-label', '打开练习趋势筛选范围');
    };

    PracticeTrendRenderer.prototype.setRange = function setRange(rangeKey) {
        if (!practiceTrendRangeByKey[rangeKey]) {
            return;
        }
        this.rangeKey = rangeKey;
        this.render();
        this.flipToFront();
    };

    PracticeTrendRenderer.prototype._ensureInteractions = function _ensureInteractions() {
        if (this.bound || typeof document === 'undefined') {
            return;
        }
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        this.bound = true;
        var self = this;

        card.addEventListener('click', function onTrendCardClick(event) {
            var option = event.target && event.target.closest
                ? event.target.closest('[data-practice-trend-range]')
                : null;
            if (option) {
                event.preventDefault();
                event.stopPropagation();
                self.setRange(option.dataset.practiceTrendRange);
                return;
            }
            if (card.classList.contains('is-flipped')) {
                self.flipToFront();
            } else {
                self.flipToBack();
            }
        });

        card.addEventListener('keydown', function onTrendCardKeydown(event) {
            var key = event.key || '';
            if (key !== 'Enter' && key !== ' ') {
                return;
            }
            var option = event.target && event.target.closest
                ? event.target.closest('[data-practice-trend-range]')
                : null;
            event.preventDefault();
            if (option) {
                self.setRange(option.dataset.practiceTrendRange);
                return;
            }
            if (card.classList.contains('is-flipped')) {
                self.flipToFront();
            } else {
                self.flipToBack();
            }
        });

        this.resizeHandler = function onTrendResize() {
            self.render();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.resizeHandler);
        }
    };

    PracticeTrendRenderer.prototype._selectPoints = function _selectPoints(range) {
        var points = this.records
            .map(function mapRecord(record, index) {
                var timestamp = getRecordTimestamp(record);
                var value = normalizePracticeTrendPercentage(record);
                if (!Number.isFinite(value)) {
                    return null;
                }
                return {
                    timestamp: timestamp,
                    order: index,
                    value: Math.max(0, Math.min(100, value))
                };
            })
            .filter(Boolean)
            .sort(function sortPoints(a, b) {
                if (a.timestamp !== b.timestamp) {
                    return a.timestamp - b.timestamp;
                }
                return a.order - b.order;
            });

        if (!range || points.length === 0) {
            return points;
        }

        if (range.mode === 'count') {
            return points.slice(-range.value);
        }

        if (range.mode === 'days') {
            var latestTimestamp = points.reduce(function findLatest(max, point) {
                return point.timestamp > max ? point.timestamp : max;
            }, 0);
            var now = Date.now();
            var anchor = latestTimestamp > 0 ? Math.max(now, latestTimestamp) : now;
            var cutoff = anchor - range.value * 24 * 60 * 60 * 1000;
            return points.filter(function inWindow(point) {
                return point.timestamp > 0 && point.timestamp >= cutoff;
            });
        }

        return points;
    };

    PracticeTrendRenderer.prototype._drawEmpty = function _drawEmpty(canvas) {
        var ctx = preparePracticeTrendCanvas(canvas);
        if (!ctx) {
            return;
        }
        var palette = getPracticeTrendPalette(canvas);
        var width = canvas.__practiceTrendCssWidth || canvas.clientWidth || 320;
        var height = canvas.__practiceTrendCssHeight || canvas.clientHeight || 180;
        ctx.clearRect(0, 0, width, height);
        drawPracticeTrendGrid(ctx, width, height, palette);
    };

    PracticeTrendRenderer.prototype._drawChart = function _drawChart(canvas, points) {
        var ctx = preparePracticeTrendCanvas(canvas);
        if (!ctx) {
            return;
        }
        var palette = getPracticeTrendPalette(canvas);
        var width = canvas.__practiceTrendCssWidth || canvas.clientWidth || 320;
        var height = canvas.__practiceTrendCssHeight || canvas.clientHeight || 180;
        ctx.clearRect(0, 0, width, height);
        drawPracticeTrendGrid(ctx, width, height, palette);

        var inset = { left: 18, right: 18, top: 16, bottom: 22 };
        var usableWidth = Math.max(1, width - inset.left - inset.right);
        var usableHeight = Math.max(1, height - inset.top - inset.bottom);
        var values = points.map(function valueOf(point) { return point.value; });
        var minValue = Math.min.apply(Math, values);
        var maxValue = Math.max.apply(Math, values);
        var spread = Math.max(8, maxValue - minValue);
        var floor = Math.max(0, minValue - spread * 0.28);
        var ceiling = Math.min(100, maxValue + spread * 0.28);
        if (ceiling - floor < 12) {
            var mid = (ceiling + floor) / 2;
            floor = Math.max(0, mid - 6);
            ceiling = Math.min(100, mid + 6);
        }
        if (ceiling <= floor) {
            ceiling = floor + 1;
        }

        var coords = points.map(function toCoord(point, index) {
            var x = points.length === 1
                ? inset.left + usableWidth / 2
                : inset.left + usableWidth * (index / (points.length - 1));
            var y = inset.top + usableHeight * (1 - (point.value - floor) / (ceiling - floor));
            return { x: x, y: y, value: point.value };
        });

        drawPracticeTrendFill(ctx, coords, height - inset.bottom, palette);
        drawPracticeTrendLine(ctx, coords, palette);
        drawPracticeTrendPoints(ctx, coords, palette);
    };

    PracticeTrendRenderer.prototype._formatAverage = function _formatAverage(points) {
        if (!Array.isArray(points) || points.length === 0) {
            return '0%';
        }
        var total = points.reduce(function sum(acc, point) {
            return acc + point.value;
        }, 0);
        return Math.round(total / points.length) + '%';
    };

    PracticeTrendRenderer.prototype._syncOptionState = function _syncOptionState() {
        var card = this._getElement('card');
        if (!card || !card.querySelectorAll) {
            return;
        }
        var buttons = card.querySelectorAll('[data-practice-trend-range]');
        for (var i = 0; i < buttons.length; i += 1) {
            var button = buttons[i];
            var active = button.dataset.practiceTrendRange === this.rangeKey;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    };

    PracticeTrendRenderer.prototype._getElement = function _getElement(key) {
        var id = this.ids[key];
        return id ? document.getElementById(id) : null;
    };

    PracticeTrendRenderer.prototype._setText = function _setText(key, value) {
        var element = this._getElement(key);
        if (element) {
            element.textContent = value;
        }
    };

    // --- Helpers for Radar Chart ---
    function hexToRgba(hex, alpha) {
        var cleanHex = String(hex || '').trim().replace('#', '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
        }
        var r = parseInt(cleanHex.slice(0, 2), 16) || 102;
        var g = parseInt(cleanHex.slice(2, 4), 16) || 126;
        var b = parseInt(cleanHex.slice(4, 6), 16) || 234;
        return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
    }

    var questionTypeNames = {
        'heading-matching': '段落小标题',
        'true-false-not-given': '判断题',
        'yes-no-not-given': '观点判断',
        'multiple-choice': '单/多选题',
        'summary-completion': '摘要填空',
        'sentence-completion': '句子填空',
        'short-answer': '简答题',
        'diagram-labelling': '图表标注',
        'flow-chart': '流程图',
        'table-completion': '表格填空',
        'matching-information': '信息配对',
        'matching-features': '特征匹配',
        'matching-people-ideas': '人名观点配对',
        other: '其他题型'
    };

    var readingQuestionTypeOrder = [
        'heading-matching',
        'true-false-not-given',
        'yes-no-not-given',
        'multiple-choice',
        'matching-information',
        'matching-features',
        'matching-people-ideas',
        'summary-completion',
        'sentence-completion',
        'short-answer',
        'diagram-labelling',
        'flow-chart',
        'table-completion',
        'other'
    ];

    var questionTypeAliases = {
        headingmatching: 'heading-matching',
        headingsmatching: 'heading-matching',
        matchingheadings: 'heading-matching',
        listofheadings: 'heading-matching',
        truefalsenotgiven: 'true-false-not-given',
        tfng: 'true-false-not-given',
        yesnonotgiven: 'yes-no-not-given',
        ynng: 'yes-no-not-given',
        multiplechoice: 'multiple-choice',
        mcq: 'multiple-choice',
        summarycompletion: 'summary-completion',
        sentencecompletion: 'sentence-completion',
        shortanswer: 'short-answer',
        shortanswerquestions: 'short-answer',
        diagramlabelling: 'diagram-labelling',
        diagramlabeling: 'diagram-labelling',
        flowchart: 'flow-chart',
        flowchartcompletion: 'flow-chart',
        tablecompletion: 'table-completion',
        matchinginformation: 'matching-information',
        matchingfeatures: 'matching-features',
        matchingpeopleideas: 'matching-people-ideas',
        matchingpeople: 'matching-people-ideas',
        matchingnames: 'matching-people-ideas',
        matching: 'matching-features',
        general: 'other',
        unknown: 'other',
        other: 'other'
    };

    function formatQuestionTypeStr(type) {
        return questionTypeNames[type] || type || '其他题型';
    }

    function normalizeQuestionTypeToken(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
    }

    function normalizeReadingQuestionType(value) {
        var token = normalizeQuestionTypeToken(value);
        if (!token) {
            return 'other';
        }
        if (questionTypeNames[token]) {
            return token;
        }
        var compact = token.replace(/-/g, '');
        return questionTypeAliases[compact] || questionTypeAliases[token] || 'other';
    }

    function textFromHtml(value) {
        return String(value || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function inferReadingQuestionTypeFromGroup(group) {
        group = group || {};
        var text = textFromHtml([group.leadHtml, group.bodyHtml, group.html, group.title, group.kind].join(' '));
        if (/which paragraph contains|paragraph contains the following information|contains the following information/.test(text)) {
            return 'matching-information';
        }
        if (/list of headings|choose the correct heading|match.*heading|headings/.test(text)) {
            return 'heading-matching';
        }
        if (/true\s+if|false\s+if|not given/.test(text) && /true/.test(text) && /false/.test(text)) {
            return 'true-false-not-given';
        }
        if (/yes\s+if|no\s+if|not given/.test(text) && /yes/.test(text) && /no/.test(text)) {
            return 'yes-no-not-given';
        }
        if (/choose the correct letter|choose the correct answer|multiple choice/.test(text)) {
            return 'multiple-choice';
        }
        if (/complete the summary|summary below/.test(text)) {
            return 'summary-completion';
        }
        if (/complete each sentence|complete the sentences|sentence endings|correct ending/.test(text)) {
            return 'sentence-completion';
        }
        if (/complete the table|table below/.test(text)) {
            return 'table-completion';
        }
        if (/flow[- ]?chart|flow chart/.test(text)) {
            return 'flow-chart';
        }
        if (/diagram|label the diagram|labelling|labeling|map below/.test(text)) {
            return 'diagram-labelling';
        }
        if (/answer the questions|short answer/.test(text)) {
            return 'short-answer';
        }
        if (/look at the following people|list of people|match each person|match each statement with the correct person|list of ideas/.test(text)) {
            return 'matching-people-ideas';
        }
        if (/match each|match the following|classify the following|list of (points|features|options|events)/.test(text)) {
            return 'matching-features';
        }
        return normalizeReadingQuestionType(group.kind || group.type);
    }

    function normalizeQuestionId(value) {
        var raw = String(value == null ? '' : value).trim().toLowerCase();
        if (!raw) {
            return '';
        }
        var match = raw.match(/^q?(\d+)/);
        if (match) {
            return 'q' + String(Number(match[1]));
        }
        return raw;
    }

    function addQuestionTypeMapEntry(map, questionId, type) {
        var normalized = normalizeQuestionId(questionId);
        if (!normalized || !type) {
            return;
        }
        map[normalized] = type;
        map[String(questionId).trim().toLowerCase()] = type;
    }

    function buildReadingQuestionTypeMap(record) {
        var map = {};
        var recordMap = record && record.questionTypeMap && typeof record.questionTypeMap === 'object'
            ? record.questionTypeMap
            : (record && record.realData && record.realData.questionTypeMap && typeof record.realData.questionTypeMap === 'object'
                ? record.realData.questionTypeMap
                : null);
        if (recordMap) {
            Object.keys(recordMap).forEach(function addSavedQuestionType(questionId) {
                addQuestionTypeMapEntry(map, questionId, normalizeReadingQuestionType(recordMap[questionId]));
            });
        }

        var registry = typeof window !== 'undefined' ? window.__READING_EXAM_DATA__ : null;
        var getPayload = registry && typeof registry.get === 'function' ? registry.get.bind(registry) : null;
        if (!getPayload) {
            return map;
        }
        var metadata = record && record.metadata ? record.metadata : {};
        var realData = record && record.realData ? record.realData : {};
        var candidates = [
            record && record.examId,
            metadata.examId,
            metadata.originalExamId,
            metadata.derivedExamId,
            realData.examId,
            record && record.originalExamId,
            record && record.derivedExamId
        ];
        var payload = null;
        for (var i = 0; i < candidates.length; i += 1) {
            if (!candidates[i]) {
                continue;
            }
            payload = getPayload(candidates[i]);
            if (payload) {
                break;
            }
        }
        if (!payload || !Array.isArray(payload.questionGroups)) {
            return map;
        }
        payload.questionGroups.forEach(function indexQuestionGroup(group) {
            var type = inferReadingQuestionTypeFromGroup(group);
            var questionIds = Array.isArray(group && group.questionIds) ? group.questionIds : [];
            questionIds.forEach(function addQuestion(questionId) {
                addQuestionTypeMapEntry(map, questionId, type);
            });
        });
        return map;
    }

    function getDetailSources(record) {
        var sources = [];
        if (record && record.answerDetails) {
            sources.push(record.answerDetails);
        }
        if (record && record.scoreInfo && record.scoreInfo.details) {
            sources.push(record.scoreInfo.details);
        }
        if (record && record.realData && record.realData.scoreInfo && record.realData.scoreInfo.details) {
            sources.push(record.realData.scoreInfo.details);
        }
        return sources;
    }

    function isWrongAnswerDetail(detail) {
        if (!detail || typeof detail !== 'object') {
            return false;
        }
        if (detail.isCorrect === false || detail.correct === false) {
            return true;
        }
        if (detail.isCorrect === true || detail.correct === true) {
            return false;
        }
        var userAnswer = String(detail.userAnswer || detail.answer || detail.value || '').trim().toLowerCase();
        var correctAnswer = String(detail.correctAnswer || detail.expectedAnswer || detail.expected || '').trim().toLowerCase();
        return Boolean(correctAnswer && userAnswer && userAnswer !== correctAnswer);
    }

    function addRadarCount(counts, type, value) {
        var normalizedType = normalizeReadingQuestionType(type);
        var amount = Math.max(0, Number(value) || 0);
        if (amount <= 0) {
            return;
        }
        counts[normalizedType] = (counts[normalizedType] || 0) + amount;
    }

    function addPerformanceCounts(counts, performanceMap) {
        if (!performanceMap || typeof performanceMap !== 'object') {
            return false;
        }
        var used = false;
        Object.keys(performanceMap).forEach(function addPerformance(type) {
            var performance = performanceMap[type] || {};
            var total = Number(performance.total != null ? performance.total : performance.totalQuestions);
            var correct = Number(performance.correct != null ? performance.correct : performance.correctAnswers);
            if (!Number.isFinite(total) || !Number.isFinite(correct)) {
                return;
            }
            var wrong = Math.max(0, total - correct);
            if (wrong > 0) {
                addRadarCount(counts, type, wrong);
                used = true;
            }
        });
        return used;
    }

    function addDetailCounts(counts, record) {
        var questionTypeMap = buildReadingQuestionTypeMap(record);
        var sources = getDetailSources(record);
        var seenQuestions = {};
        var used = false;
        sources.forEach(function scanDetails(source) {
            Object.keys(source || {}).forEach(function addDetail(questionId) {
                var normalizedId = normalizeQuestionId(questionId);
                if (seenQuestions[normalizedId]) {
                    return;
                }
                var detail = source[questionId];
                if (!isWrongAnswerDetail(detail)) {
                    return;
                }
                seenQuestions[normalizedId] = true;
                var type = (detail && (detail.questionType || detail.type)) || questionTypeMap[normalizedId] || 'other';
                addRadarCount(counts, type, 1);
                used = true;
            });
        });
        return used;
    }

    function calculateReadingRadarData(records) {
        var counts = {};
        var recentReadingRecords = ensureArray(records)
            .filter(function filterReading(record) {
                var metadata = record && record.metadata ? record.metadata : {};
                var realData = record && record.realData ? record.realData : {};
                var recordType = normalizeTypeValue(
                    record && (record.type || record.examType ||
                    metadata.type || metadata.examType || realData.type)
                );
                if (recordType) {
                    return recordType === 'reading';
                }
                var examId = String((record && record.examId) || metadata.examId || realData.examId || '').toLowerCase();
                return /^p[1-3][-_]/.test(examId);
            })
            .sort(function sortRecent(a, b) {
                return getRecordTimestamp(b) - getRecordTimestamp(a);
            })
            .slice(0, 10);

        recentReadingRecords.forEach(function collectRecord(record) {
            var performanceMap = record && (record.questionTypePerformance ||
                (record.realData && record.realData.questionTypePerformance));
            if (addPerformanceCounts(counts, performanceMap)) {
                return;
            }
            addDetailCounts(counts, record);
        });

        var nonZeroTypes = readingQuestionTypeOrder.filter(function hasError(type) {
            return (counts[type] || 0) > 0;
        });
        if (!nonZeroTypes.length) {
            nonZeroTypes = readingQuestionTypeOrder.slice(0, 8);
        }
        if (nonZeroTypes.length > 8) {
            nonZeroTypes = nonZeroTypes
                .sort(function sortByCount(a, b) {
                    return (counts[b] || 0) - (counts[a] || 0);
                })
                .slice(0, 8)
                .sort(function sortByOrder(a, b) {
                    return readingQuestionTypeOrder.indexOf(a) - readingQuestionTypeOrder.indexOf(b);
                });
        }

        var totalErrors = Object.keys(counts).reduce(function sum(total, type) {
            return total + (counts[type] || 0);
        }, 0);

        return {
            dataPoints: nonZeroTypes.map(function mapType(type) {
                return {
                    label: formatQuestionTypeStr(type),
                    value: counts[type] || 0
                };
            }),
            totalErrors: totalErrors,
            recordCount: recentReadingRecords.length
        };
    }

    function drawRadarChart(canvas, dataPoints) {
        var ctx = canvas.getContext('2d');
        if (!ctx) return;

        var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        var cssWidth = Math.max(1, Math.round(rect && rect.width ? rect.width : (canvas.clientWidth || 320)));
        var cssHeight = Math.max(1, Math.round(rect && rect.height ? rect.height : (canvas.clientHeight || 200)));
        var ratio = typeof window !== 'undefined' && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1;

        canvas.width = cssWidth * ratio;
        canvas.height = cssHeight * ratio;
        ctx.scale(ratio, ratio);

        var cx = cssWidth / 2;
        var cy = cssHeight / 2;
        var radius = Math.min(cssWidth, cssHeight) * 0.35;
        var totalAxes = dataPoints.length;

        var maxValue = dataPoints.reduce(function(max, p) { return Math.max(max, p.value); }, 0);
        var maxScale = maxValue < 4 ? 4 : Math.ceil(maxValue / 4) * 4;

        var isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-theme');
        var gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.06)';
        var axisColor = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.08)';
        var labelColor = isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(15, 23, 42, 0.6)';

        // 1. Draw Concentric Grid
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        for (var i = 1; i <= 4; i++) {
            var r = (radius / 4) * i;
            ctx.beginPath();
            for (var j = 0; j < totalAxes; j++) {
                var angle = (Math.PI * 2 / totalAxes) * j - Math.PI / 2;
                var x = cx + Math.cos(angle) * r;
                var y = cy + Math.sin(angle) * r;
                if (j === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }

        // 2. Draw Axes
        ctx.strokeStyle = axisColor;
        for (var j = 0; j < totalAxes; j++) {
            var angle = (Math.PI * 2 / totalAxes) * j - Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
            ctx.stroke();
        }

        // 3. Draw Labels
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = labelColor;
        for (var j = 0; j < totalAxes; j++) {
            var angle = (Math.PI * 2 / totalAxes) * j - Math.PI / 2;
            var labelRadius = radius + 14;
            var lx = cx + Math.cos(angle) * labelRadius;
            var ly = cy + Math.sin(angle) * labelRadius;

            var cosVal = Math.cos(angle);
            var sinVal = Math.sin(angle);

            ctx.textAlign = Math.abs(cosVal) < 0.1 ? 'center' : (cosVal > 0 ? 'left' : 'right');
            ctx.textBaseline = Math.abs(sinVal) < 0.1 ? 'middle' : (sinVal > 0 ? 'top' : 'bottom');
            
            ctx.fillText(dataPoints[j].label, lx, ly);
        }

        // 4. Draw Data Area
        var accentColor = '#667eea';
        if (typeof window !== 'undefined') {
            var rootStyle = window.getComputedStyle(document.documentElement);
            var customAccent = rootStyle.getPropertyValue('--shui-accent').trim();
            if (customAccent) accentColor = customAccent;
        }

        ctx.beginPath();
        for (var j = 0; j < totalAxes; j++) {
            var val = dataPoints[j].value;
            var valRadius = (val / maxScale) * radius;
            var angle = (Math.PI * 2 / totalAxes) * j - Math.PI / 2;
            var x = cx + Math.cos(angle) * valRadius;
            var y = cy + Math.sin(angle) * valRadius;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Stroke + Glow
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 8;
        ctx.stroke();

        // Fill without shadow
        ctx.shadowBlur = 0;
        ctx.fillStyle = hexToRgba(accentColor, 0.18);
        ctx.fill();

        // 5. Draw Data Points Highlight
        for (var j = 0; j < totalAxes; j++) {
            var val = dataPoints[j].value;
            var valRadius = (val / maxScale) * radius;
            var angle = (Math.PI * 2 / totalAxes) * j - Math.PI / 2;
            var x = cx + Math.cos(angle) * valRadius;
            var y = cy + Math.sin(angle) * valRadius;

            // Outer highlight circle
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = hexToRgba(accentColor, 0.4);
            ctx.fill();

            // Inner solid dot
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
    }

    // --- Practice custom priority renderer ---
    function PracticePriorityRenderer(options) {
        options = options || {};
        this.ids = {
            card: options.cardId || 'practice-custom-card',
            heatmap: options.heatmapId || 'practice-heatmap',
            heatmapSummary: options.heatmapSummaryId || 'practice-heatmap-summary',
            heatmapMonthLabel: options.heatmapMonthLabelId || 'practice-heatmap-month-label',
            heatmapMonthControls: options.heatmapMonthControlsId || 'practice-heatmap-month-controls',
            radarSummary: options.radarSummaryId || 'practice-radar-summary',
            highCount: options.highCountId || 'practice-priority-high-count',
            mediumCount: options.mediumCountId || 'practice-priority-medium-count',
            highFill: options.highFillId || 'practice-priority-high-fill',
            mediumFill: options.mediumFillId || 'practice-priority-medium-fill',
            highAccuracy: options.highAccuracyId || 'practice-priority-high-accuracy',
            mediumAccuracy: options.mediumAccuracyId || 'practice-priority-medium-accuracy'
        };
        this.records = [];
        this.exams = [];
        this.examType = 'all';
        this.activeWidget = options.defaultWidget || 'heatmap';
        this.heatmapMonth = normalizePracticeHeatmapMonth(options.defaultHeatmapMonth || new Date());
        this.bound = false;
        this.resizeHandler = null;
    }

    PracticePriorityRenderer.prototype.update = function update(records, exams, options) {
        options = options || {};
        this.records = Array.isArray(records) ? records.slice() : [];
        this.exams = Array.isArray(exams) ? exams.slice() : [];
        this.examType = options.examType || 'all';
        this._ensureInteractions();
        this.render();
    };

    PracticePriorityRenderer.prototype.render = function render() {
        if (typeof document === 'undefined') {
            return;
        }
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        var titleElem = document.getElementById('practice-custom-card-title');
        if (titleElem) {
            titleElem.textContent = this.activeWidget === 'radar'
                ? '阅读错题雷达'
                : (this.activeWidget === 'priority' ? '中高频余量' : '练习热力图');
        }
        
        var contents = card.querySelectorAll('.practice-custom-widget-content');
        for (var i = 0; i < contents.length; i++) {
            if (contents[i].dataset.widgetType === this.activeWidget) {
                contents[i].removeAttribute('hidden');
            } else {
                contents[i].setAttribute('hidden', 'hidden');
            }
        }
        
        if (this.activeWidget === 'heatmap') {
            this._renderHeatmap();
        } else if (this.activeWidget === 'priority') {
            var stats = calculatePriorityPracticeStats(this.records, this.exams, this.examType);
            this._renderGroup('high', stats.high);
            this._renderGroup('medium', stats.medium);
        } else if (this.activeWidget === 'radar') {
            this._renderRadarChart();
        }
        
        this._syncOptionState();
        this._syncHeatmapControls();
        this._syncFlipButtonState(card.classList.contains('is-flipped'));
    };
    
    PracticePriorityRenderer.prototype.setWidget = function setWidget(widget) {
        if (!widget) return;
        this.activeWidget = widget;
        this.render();
    };

    PracticePriorityRenderer.prototype.shiftHeatmapMonth = function shiftHeatmapMonth(direction) {
        var offset = direction === 'next' ? 1 : -1;
        this.heatmapMonth = addPracticeHeatmapMonths(this.heatmapMonth, offset);
        this.render();
    };

    PracticePriorityRenderer.prototype._renderHeatmap = function _renderHeatmap() {
        var container = this._getElement('heatmap');
        if (!container || typeof document === 'undefined') {
            return;
        }
        var heatmapData = calculatePracticeHeatmapData(this.records, this.heatmapMonth);
        this.heatmapMonth = heatmapData.monthStart;
        container.textContent = '';
        if (container.style) {
            container.style.setProperty('--practice-heatmap-weeks', String(heatmapData.weekCount));
        }

        var body = document.createElement('div');
        body.className = 'practice-heatmap__body';
        var weekdays = document.createElement('div');
        weekdays.className = 'practice-heatmap__weekdays';
        ['日', '一', '二', '三', '四', '五', '六'].forEach(function addWeekday(label) {
            var weekday = document.createElement('span');
            weekday.className = 'practice-heatmap__weekday';
            weekday.textContent = label;
            weekdays.appendChild(weekday);
        });

        var grid = document.createElement('div');
        grid.className = 'practice-heatmap__grid';
        grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', formatPracticeHeatmapMonthLabel(heatmapData.monthStart) + '练习热力图');

        heatmapData.cells.forEach(function appendCell(cell) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'practice-heatmap__cell' + (cell.inMonth ? '' : ' is-outside-month');
            button.style.gridColumn = String(cell.weekday + 1);
            button.style.gridRow = String(cell.week + 1);
            button.dataset.date = cell.dateKey;
            button.dataset.count = String(cell.count);
            button.dataset.level = String(cell.level);
            button.dataset.tooltip = cell.label + '，做题 ' + cell.count + ' 套';
            button.setAttribute('aria-label', button.dataset.tooltip);
            button.setAttribute('title', button.dataset.tooltip);
            grid.appendChild(button);
        });

        body.appendChild(weekdays);
        body.appendChild(grid);
        container.appendChild(body);

        this._setText('heatmapMonthLabel', formatPracticeHeatmapMonthLabel(heatmapData.monthStart));
        this._setText(
            'heatmapSummary',
            heatmapData.total > 0
                ? formatPracticeHeatmapMonthLabel(heatmapData.monthStart) + ' 共做题 ' + heatmapData.total + ' 套，活跃 ' + heatmapData.activeDays + ' 天'
                : formatPracticeHeatmapMonthLabel(heatmapData.monthStart) + ' 暂无练习记录'
        );
    };
    
    PracticePriorityRenderer.prototype._renderRadarChart = function _renderRadarChart() {
        var canvas = document.getElementById('practice-radar-canvas');
        var empty = document.getElementById('practice-radar-empty');
        if (!canvas || !canvas.getContext) return;

        var radarData = calculateReadingRadarData(this.records);
        var dataPoints = radarData.dataPoints;
        var hasData = radarData.totalErrors > 0;
        if (!hasData && empty) {
            empty.style.display = 'flex';
            canvas.style.opacity = '0.22';
        } else if (empty) {
            empty.style.display = 'none';
            canvas.style.opacity = '1';
        }
        this._setText(
            'radarSummary',
            hasData
                ? '最近' + radarData.recordCount + '次阅读共 ' + radarData.totalErrors + ' 道错题'
                : '最近10次阅读暂无可分类错题'
        );
        
        drawRadarChart(canvas, dataPoints);
    };

    PracticePriorityRenderer.prototype.flipToBack = function flipToBack() {
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        card.classList.add('is-flipped');
        this._syncFlipButtonState(true);
    };

    PracticePriorityRenderer.prototype.flipToFront = function flipToFront() {
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        card.classList.remove('is-flipped');
        this._syncFlipButtonState(false);
    };

    PracticePriorityRenderer.prototype._renderGroup = function _renderGroup(key, stats) {
        stats = stats || { done: 0, total: 0, accuracy: 0 };
        var done = Math.max(0, Number(stats.done) || 0);
        var total = Math.max(0, Number(stats.total) || 0);
        var pct = total > 0 ? Math.max(0, Math.min(100, done / total * 100)) : 0;
        var accuracy = Math.max(0, Math.min(100, Number(stats.accuracy) || 0));
        this._setText(key + 'Count', done + '/' + total);
        this._setText(key + 'Accuracy', Math.round(accuracy) + '%');
        this._setProgress(key + 'Fill', pct);
        this._setAccuracyLevel(key + 'Accuracy', accuracy);
    };

    PracticePriorityRenderer.prototype._ensureInteractions = function _ensureInteractions() {
        if (this.bound || typeof document === 'undefined') {
            return;
        }
        var card = this._getElement('card');
        if (!card) {
            return;
        }
        this.bound = true;
        var self = this;

        card.addEventListener('click', function onPriorityCardClick(event) {
            var monthButton = event.target && event.target.closest
                ? event.target.closest('[data-practice-heatmap-month]')
                : null;
            if (monthButton) {
                event.preventDefault();
                event.stopPropagation();
                self.shiftHeatmapMonth(monthButton.dataset.practiceHeatmapMonth);
                return;
            }

            var option = event.target && event.target.closest
                ? event.target.closest('[data-practice-widget]')
                : null;
            if (option) {
                event.preventDefault();
                event.stopPropagation();
                self.setWidget(option.dataset.practiceWidget);
                self.flipToFront();
                return;
            }
            
            var flipBtn = event.target && event.target.closest
                ? event.target.closest('.practice-custom-card__flip-btn')
                : null;
            
            if (flipBtn) {
                event.preventDefault();
                event.stopPropagation();
                if (card.classList.contains('is-flipped')) {
                    self.flipToFront();
                } else {
                    self.flipToBack();
                }
                return;
            }

            // 对整卡任何其他区域的点击，阻止其冒泡以防父组件捕获，且不做翻转操作
            event.stopPropagation();
        });

        card.addEventListener('keydown', function onPriorityCardKeydown(event) {
            var key = event.key || '';
            if (key !== 'Enter' && key !== ' ') {
                return;
            }
            var monthButton = event.target && event.target.closest
                ? event.target.closest('[data-practice-heatmap-month]')
                : null;
            if (monthButton) {
                event.preventDefault();
                event.stopPropagation();
                self.shiftHeatmapMonth(monthButton.dataset.practiceHeatmapMonth);
                return;
            }

            var option = event.target && event.target.closest
                ? event.target.closest('[data-practice-widget]')
                : null;
            if (option) {
                event.preventDefault();
                event.stopPropagation();
                self.setWidget(option.dataset.practiceWidget);
                self.flipToFront();
                return;
            }
            var flipBtn = event.target && event.target.closest
                ? event.target.closest('.practice-custom-card__flip-btn')
                : null;
            if (flipBtn) {
                event.preventDefault();
                event.stopPropagation();
                if (card.classList.contains('is-flipped')) {
                    self.flipToFront();
                } else {
                    self.flipToBack();
                }
                return;
            }
            event.stopPropagation();
        });
        
        this.resizeHandler = function onPriorityResize() {
            self.render();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.resizeHandler);
        }
    };

    PracticePriorityRenderer.prototype._syncFlipButtonState = function _syncFlipButtonState(isFlipped) {
        var card = this._getElement('card');
        if (!card || !card.querySelectorAll) {
            return;
        }
        var buttons = card.querySelectorAll('.practice-custom-card__flip-btn');
        for (var i = 0; i < buttons.length; i += 1) {
            buttons[i].setAttribute('aria-pressed', isFlipped ? 'true' : 'false');
        }
    };

    PracticePriorityRenderer.prototype._syncHeatmapControls = function _syncHeatmapControls() {
        var controls = this._getElement('heatmapMonthControls');
        if (!controls) {
            return;
        }
        if (this.activeWidget === 'heatmap') {
            controls.removeAttribute('hidden');
        } else {
            controls.setAttribute('hidden', 'hidden');
        }
    };

    PracticePriorityRenderer.prototype._syncOptionState = function _syncOptionState() {
        var card = this._getElement('card');
        if (!card || !card.querySelectorAll) {
            return;
        }
        var buttons = card.querySelectorAll('[data-practice-widget]');
        for (var i = 0; i < buttons.length; i += 1) {
            var active = buttons[i].dataset.practiceWidget === this.activeWidget;
            if (active) {
                buttons[i].classList.add('active');
                buttons[i].setAttribute('aria-pressed', 'true');
            } else {
                buttons[i].classList.remove('active');
                buttons[i].setAttribute('aria-pressed', 'false');
            }
        }
    };

    PracticePriorityRenderer.prototype._getElement = function _getElement(key) {
        var id = this.ids[key];
        return id ? document.getElementById(id) : null;
    };

    PracticePriorityRenderer.prototype._setText = function _setText(key, value) {
        var element = this._getElement(key);
        if (element) {
            element.textContent = value;
        }
    };

    PracticePriorityRenderer.prototype._setProgress = function _setProgress(key, value) {
        var element = this._getElement(key);
        if (element && element.style) {
            element.style.setProperty('--priority-progress-value', Math.round(value) + '%');
        }
    };

    PracticePriorityRenderer.prototype._setAccuracyLevel = function _setAccuracyLevel(key, value) {
        var element = this._getElement(key);
        var orb = element && element.closest ? element.closest('.priority-accuracy__orb') : null;
        if (orb && orb.style) {
            var bounded = Math.max(0, Math.min(100, Number(value) || 0));
            orb.style.setProperty('--priority-accuracy-level', Math.round(bounded) + '%');
        }
    };

    function calculatePracticeHeatmapData(records, monthDate) {
        var monthStart = normalizePracticeHeatmapMonth(monthDate);
        var leadingDays = monthStart.getDay();
        var monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
        var daysInMonth = monthEnd.getDate();
        var weekCount = Math.ceil((leadingDays + daysInMonth) / 7);
        var aggregate = aggregatePracticeHeatmapSets(records, monthStart);
        var counts = aggregate.monthCounts;

        var cells = [];
        var total = 0;
        var activeDays = 0;

        for (var index = 0; index < weekCount * 7; index += 1) {
            var dayOffset = index - leadingDays;
            var date = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 + dayOffset);
            var inMonth = date.getMonth() === monthStart.getMonth();
            var dateKey = toPracticeHeatmapDateKey(date);
            var count = inMonth ? (counts[dateKey] || 0) : 0;
            if (inMonth) {
                total += count;
                if (count > 0) {
                    activeDays += 1;
                }
            }
            cells.push({
                date: date,
                dateKey: dateKey,
                label: formatPracticeHeatmapDateLabel(date),
                count: count,
                level: inMonth ? resolvePracticeHeatmapLevel(count, aggregate.averageSetsPerActiveDay) : 0,
                inMonth: inMonth,
                week: Math.floor(index / 7),
                weekday: index % 7
            });
        }

        return {
            monthStart: monthStart,
            weekCount: weekCount,
            cells: cells,
            total: total,
            activeDays: activeDays,
            averageSetsPerActiveDay: aggregate.averageSetsPerActiveDay
        };
    }

    function aggregatePracticeHeatmapSets(records, monthStart) {
        var monthCounts = {};
        var allCounts = {};
        var monthKey = toPracticeHeatmapMonthKey(monthStart);
        ensureArray(records).forEach(function collect(record) {
            var timestamp = getRecordTimestamp(record);
            if (!timestamp) {
                return;
            }
            var date = new Date(timestamp);
            var key = toPracticeHeatmapDateKey(date);
            allCounts[key] = (allCounts[key] || 0) + 1;
            if (toPracticeHeatmapMonthKey(date) === monthKey) {
                monthCounts[key] = (monthCounts[key] || 0) + 1;
            }
        });
        var activeDayKeys = Object.keys(allCounts);
        var totalSets = activeDayKeys.reduce(function sumSets(total, key) {
            return total + allCounts[key];
        }, 0);
        return {
            monthCounts: monthCounts,
            averageSetsPerActiveDay: activeDayKeys.length > 0 ? totalSets / activeDayKeys.length : 0
        };
    }

    function normalizePracticeHeatmapMonth(value) {
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) {
            date = new Date();
        }
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function addPracticeHeatmapMonths(value, offset) {
        var month = normalizePracticeHeatmapMonth(value);
        return new Date(month.getFullYear(), month.getMonth() + offset, 1);
    }

    function resolvePracticeHeatmapLevel(count, avg) {
        var safeCount = Math.max(0, Number(count) || 0);
        var safeAvg = Math.max(0, Number(avg) || 0);
        if (safeCount <= 0) {
            return 0;
        }
        if (safeAvg <= 0) {
            return 1;
        }
        var ratio = safeCount / safeAvg;
        if (ratio < 0.8) {
            return 1;
        }
        if (ratio < 1.5) {
            return 2;
        }
        if (ratio < 2.5) {
            return 3;
        }
        return 4;
    }

    function toPracticeHeatmapDateKey(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function toPracticeHeatmapMonthKey(date) {
        var normalized = normalizePracticeHeatmapMonth(date);
        return normalized.getFullYear() + '-' + String(normalized.getMonth() + 1).padStart(2, '0');
    }

    function formatPracticeHeatmapMonthLabel(date) {
        return date.getFullYear() + '年' + (date.getMonth() + 1) + '月';
    }

    function formatPracticeHeatmapDateLabel(date) {
        return (date.getMonth() + 1) + '月' + date.getDate() + '日';
    }

    function calculatePriorityPracticeStats(records, exams, examType) {
        var groups = {
            high: createPriorityBucket(),
            medium: createPriorityBucket()
        };
        var eligibleExams = ensureArray(exams).filter(function filterExam(exam) {
            if (!exam) {
                return false;
            }
            if (examType && examType !== 'all' && normalizeTypeValue(exam.type) !== normalizeTypeValue(examType)) {
                return false;
            }
            return Boolean(normalizePriorityFrequency(exam.frequency || (exam.metadata && exam.metadata.frequency)));
        });
        var examByKey = {};

        eligibleExams.forEach(function indexExam(exam) {
            var priority = normalizePriorityFrequency(exam.frequency || (exam.metadata && exam.metadata.frequency));
            if (!groups[priority]) {
                return;
            }
            var identity = getPracticeEntityIdentity(exam);
            if (!identity || groups[priority].totalIds.has(identity)) {
                return;
            }
            groups[priority].totalIds.add(identity);
            addExamLookupKeys(examByKey, exam, priority);
        });

        ensureArray(records).forEach(function collectRecord(record) {
            if (!record) {
                return;
            }
            var match = resolvePriorityRecordMatch(record, examByKey, eligibleExams);
            var priority = match.priority || normalizePriorityFrequency(
                record.frequency ||
                (record.metadata && record.metadata.frequency) ||
                (record.realData && record.realData.frequency)
            );
            if (!groups[priority]) {
                return;
            }
            var identity = match.identity || getPracticeRecordEntityIdentity(record);
            if (identity) {
                groups[priority].doneIds.add(identity);
            }
            var accuracy = normalizePracticeTrendPercentage(record);
            if (Number.isFinite(accuracy)) {
                groups[priority].accuracyValues.push(Math.max(0, Math.min(100, accuracy)));
            }
        });

        return {
            high: summarizePriorityBucket(groups.high),
            medium: summarizePriorityBucket(groups.medium)
        };
    }

    function createPriorityBucket() {
        return {
            totalIds: new Set(),
            doneIds: new Set(),
            accuracyValues: []
        };
    }

    function summarizePriorityBucket(bucket) {
        var total = bucket.totalIds.size;
        var done = bucket.doneIds.size;
        done = total > 0 ? Math.min(done, total) : 0;
        var accuracy = 0;
        if (bucket.accuracyValues.length) {
            accuracy = bucket.accuracyValues.reduce(function sum(acc, value) {
                return acc + value;
            }, 0) / bucket.accuracyValues.length;
        }
        return {
            done: done,
            total: total,
            accuracy: accuracy
        };
    }

    function normalizePriorityFrequency(value) {
        var raw = String(value || '').trim().toLowerCase();
        if (!raw) {
            return '';
        }
        var compact = raw.replace(/[\s_-]+/g, '');
        if (raw.indexOf('非高频') !== -1 || compact === 'low' || compact === 'nonhigh' || compact === 'unknown') {
            return '';
        }
        if (raw.indexOf('次高频') !== -1 || raw.indexOf('中频') !== -1) {
            return 'medium';
        }
        if (compact === 'medium' || compact === 'mid' || compact === 'mediumfrequency') {
            return 'medium';
        }
        if (raw.indexOf('高频') !== -1) {
            return 'high';
        }
        if (compact === 'high' || compact === 'ultrahigh' || compact === 'veryhigh' || compact === 'highfrequency') {
            return 'high';
        }
        return '';
    }

    function getPracticeEntityIdentity(item) {
        if (!item) {
            return '';
        }
        var metadata = item.metadata || {};
        var realData = item.realData || {};
        var candidates = [
            item.id,
            item.examId,
            item.dataKey,
            item.title,
            item.examTitle,
            metadata.examId,
            metadata.examTitle,
            realData.examId,
            realData.title,
            item.path,
            item.resourcePath,
            item.sourcePath,
            realData.path,
            realData.examPath
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var value = candidates[i];
            if (value != null && String(value).trim()) {
                return String(value).trim().toLowerCase();
            }
        }
        return '';
    }

    function getPracticeRecordEntityIdentity(record) {
        if (!record) {
            return '';
        }
        var metadata = record.metadata || {};
        var realData = record.realData || {};
        var candidates = [
            record.examId,
            record.title,
            record.examTitle,
            metadata.examId,
            metadata.examTitle,
            realData.examId,
            realData.title,
            record.path,
            record.examPath,
            realData.path,
            realData.examPath,
            record.filename,
            record.examFile,
            realData.filename,
            realData.examFile
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var value = candidates[i];
            if (value != null && String(value).trim()) {
                return String(value).trim().toLowerCase();
            }
        }
        return '';
    }

    function addExamLookupKeys(map, exam, priority) {
        var keys = [
            exam.id,
            exam.examId,
            exam.dataKey,
            exam.title,
            exam.path,
            exam.resourcePath,
            exam.sourcePath,
            exam.filename,
            exam.pdfFilename
        ];
        var identity = getPracticeEntityIdentity(exam);
        keys.forEach(function addKey(key) {
            var normalized = normalizePriorityLookupKey(key);
            if (normalized) {
                map[normalized] = {
                    priority: priority,
                    identity: identity
                };
            }
        });
    }

    function resolvePriorityRecordMatch(record, map, exams) {
        var metadata = record.metadata || {};
        var realData = record.realData || {};
        var keys = [
            record.examId,
            record.title,
            record.examTitle,
            metadata.examId,
            metadata.examTitle,
            realData.examId,
            realData.title,
            record.path,
            record.examPath,
            realData.path,
            realData.examPath,
            record.filename,
            record.examFile,
            realData.filename,
            realData.examFile
        ];
        for (var i = 0; i < keys.length; i += 1) {
            var normalized = normalizePriorityLookupKey(keys[i]);
            if (normalized && map[normalized]) {
                return map[normalized];
            }
        }
        for (var j = 0; j < exams.length; j += 1) {
            var exam = exams[j];
            if (recordMatchesExam(exam, record)) {
                return {
                    priority: normalizePriorityFrequency(exam.frequency || (exam.metadata && exam.metadata.frequency)),
                    identity: getPracticeEntityIdentity(exam)
                };
            }
        }
        return {};
    }

    function normalizePriorityLookupKey(value) {
        if (value == null) {
            return '';
        }
        return String(value).replace(/\\/g, '/').trim().toLowerCase();
    }

    function normalizePracticeTrendPercentage(record) {
        if (!record || typeof record !== 'object') {
            return NaN;
        }
        var rd = record.realData && typeof record.realData === 'object' ? record.realData : {};
        var scoreInfo = record.scoreInfo && typeof record.scoreInfo === 'object'
            ? record.scoreInfo
            : (rd.scoreInfo && typeof rd.scoreInfo === 'object' ? rd.scoreInfo : {});
        var candidates = [
            record.percentage,
            rd.percentage,
            record.accuracy != null ? Number(record.accuracy) * 100 : undefined,
            rd.accuracy != null ? Number(rd.accuracy) * 100 : undefined,
            scoreInfo.percentage,
            scoreInfo.accuracy != null ? Number(scoreInfo.accuracy) * 100 : undefined
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var value = Number(candidates[i]);
            if (Number.isFinite(value)) {
                return value;
            }
        }
        var correct = Number.isFinite(Number(record.correctAnswers))
            ? Number(record.correctAnswers)
            : (Number.isFinite(Number(scoreInfo.correct)) ? Number(scoreInfo.correct) : Number(record.score));
        var total = Number.isFinite(Number(record.totalQuestions))
            ? Number(record.totalQuestions)
            : (Number.isFinite(Number(scoreInfo.total)) ? Number(scoreInfo.total) : Number(record.total));
        if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
            return correct / total * 100;
        }
        return NaN;
    }

    function preparePracticeTrendCanvas(canvas) {
        var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
        var cssWidth = Math.max(1, Math.round(rect && rect.width ? rect.width : (canvas.clientWidth || 320)));
        var cssHeight = Math.max(1, Math.round(rect && rect.height ? rect.height : (canvas.clientHeight || 180)));
        var ratio = typeof window !== 'undefined' && window.devicePixelRatio ? Math.min(window.devicePixelRatio, 2) : 1;
        if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
            canvas.width = Math.round(cssWidth * ratio);
            canvas.height = Math.round(cssHeight * ratio);
        }
        canvas.__practiceTrendCssWidth = cssWidth;
        canvas.__practiceTrendCssHeight = cssHeight;
        var ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        return ctx;
    }

    function getPracticeTrendPalette(canvas) {
        var host = canvas && canvas.closest ? canvas.closest('.practice-trend-card') : null;
        var computed = host && typeof window !== 'undefined' && window.getComputedStyle
            ? window.getComputedStyle(host)
            : null;
        var fallback = {
            start: '#667eea',
            mid: '#6accc7',
            end: '#764ba2',
            point: '#667eea',
            shadow: 'rgba(102, 126, 234, 0.28)',
            fillStart: 'rgba(102, 126, 234, 0.24)',
            fillMid: 'rgba(106, 204, 199, 0.15)',
            fillEnd: 'rgba(255, 255, 255, 0.02)',
            grid: 'rgba(15, 23, 42, 0.08)'
        };
        if (!computed) {
            return fallback;
        }
        var start = resolvePracticeTrendColor(computed, '--practice-trend-line-start', fallback.start);
        var mid = resolvePracticeTrendColor(computed, '--practice-trend-line-mid', fallback.mid);
        var end = resolvePracticeTrendColor(computed, '--practice-trend-line-end', fallback.end);
        var point = resolvePracticeTrendColor(computed, '--practice-trend-point', start);
        return {
            start: start,
            mid: mid,
            end: end,
            point: point,
            shadow: colorWithAlpha(start, 0.28),
            fillStart: colorWithAlpha(start, 0.24),
            fillMid: colorWithAlpha(mid, 0.15),
            fillEnd: fallback.fillEnd,
            grid: fallback.grid
        };
    }

    function resolvePracticeTrendColor(computed, variableName, fallback) {
        var raw = computed.getPropertyValue(variableName).trim();
        if (!raw) {
            return fallback;
        }
        return normalizeCanvasColor(raw, fallback);
    }

    function normalizeCanvasColor(value, fallback) {
        var trimmed = String(value || '').trim();
        if (!trimmed) {
            return fallback;
        }
        if (trimmed.indexOf('var(') === -1) {
            return trimmed;
        }
        var match = trimmed.match(/var\((--[^,\)]+)/);
        if (!match || typeof window === 'undefined' || !window.getComputedStyle) {
            return fallback;
        }
        var resolved = window.getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
        return resolved || fallback;
    }

    function colorWithAlpha(color, alpha) {
        var parsed = parseColorToRgb(color);
        if (!parsed) {
            return color;
        }
        return 'rgba(' + parsed.r + ', ' + parsed.g + ', ' + parsed.b + ', ' + alpha + ')';
    }

    function parseColorToRgb(color) {
        var value = String(color || '').trim();
        var hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            var raw = hex[1];
            if (raw.length === 3) {
                raw = raw.split('').map(function doubleHex(char) { return char + char; }).join('');
            }
            return {
                r: parseInt(raw.slice(0, 2), 16),
                g: parseInt(raw.slice(2, 4), 16),
                b: parseInt(raw.slice(4, 6), 16)
            };
        }
        var rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (rgb) {
            return {
                r: Math.round(Number(rgb[1])),
                g: Math.round(Number(rgb[2])),
                b: Math.round(Number(rgb[3]))
            };
        }
        return null;
    }

    function drawPracticeTrendGrid(ctx, width, height, palette) {
        palette = palette || {};
        var gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = palette.grid || 'rgba(15, 23, 42, 0.08)';
        ctx.lineWidth = 1;
        for (var i = 1; i <= 3; i += 1) {
            var y = Math.round(height * i / 4) + 0.5;
            ctx.beginPath();
            ctx.moveTo(14, y);
            ctx.lineTo(width - 14, y);
            ctx.stroke();
        }
    }

    function drawPracticeTrendFill(ctx, coords, baseline, palette) {
        if (!coords.length) {
            return;
        }
        palette = palette || {};
        var gradient = ctx.createLinearGradient(0, 0, 0, baseline);
        gradient.addColorStop(0, palette.fillStart || 'rgba(102, 126, 234, 0.24)');
        gradient.addColorStop(0.52, palette.fillMid || 'rgba(106, 204, 199, 0.15)');
        gradient.addColorStop(1, palette.fillEnd || 'rgba(255, 255, 255, 0.02)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(coords[0].x, baseline);
        ctx.lineTo(coords[0].x, coords[0].y);
        appendSmoothPracticeTrendCurves(ctx, coords);
        ctx.lineTo(coords[coords.length - 1].x, baseline);
        ctx.closePath();
        ctx.fill();
    }

    function drawPracticeTrendLine(ctx, coords, palette) {
        if (!coords.length) {
            return;
        }
        palette = palette || {};
        var gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, 0);
        gradient.addColorStop(0, palette.start || '#667eea');
        gradient.addColorStop(0.52, palette.mid || '#6accc7');
        gradient.addColorStop(1, palette.end || '#764ba2');
        ctx.save();
        ctx.shadowColor = palette.shadow || 'rgba(102, 126, 234, 0.28)';
        ctx.shadowBlur = 14;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 4;
        ctx.beginPath();
        drawSmoothPracticeTrendPath(ctx, coords);
        ctx.stroke();
        ctx.restore();
    }

    function drawPracticeTrendPoints(ctx, coords, palette) {
        if (!coords.length) {
            return;
        }
        palette = palette || {};
        var markers = coords.length <= 2 ? coords : [coords[0], coords[coords.length - 1]];
        markers.forEach(function drawPoint(point) {
            ctx.beginPath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
            ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.fillStyle = palette.point || palette.start || '#667eea';
            ctx.arc(point.x, point.y, 3.1, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function drawSmoothPracticeTrendPath(ctx, coords) {
        if (!coords.length) {
            return;
        }
        ctx.moveTo(coords[0].x, coords[0].y);
        appendSmoothPracticeTrendCurves(ctx, coords);
    }

    function appendSmoothPracticeTrendCurves(ctx, coords) {
        if (coords.length === 1) {
            ctx.lineTo(coords[0].x + 0.1, coords[0].y);
            return;
        }
        for (var i = 0; i < coords.length - 1; i += 1) {
            var current = coords[i];
            var next = coords[i + 1];
            var previous = coords[i - 1] || current;
            var following = coords[i + 2] || next;
            var cp1x = current.x + (next.x - previous.x) / 6;
            var cp1y = current.y + (next.y - previous.y) / 6;
            var cp2x = next.x - (following.x - current.x) / 6;
            var cp2y = next.y - (following.y - current.y) / 6;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
        }
    }

    // --- Practice history renderer ---
    var historyRenderer = { helpers: {} };

    historyRenderer.helpers.getScoreColor = function (percentage) {
        var pct = Number(percentage) || 0;
        if (pct >= 90) return '#10b981';
        if (pct >= 75) return '#f59e0b';
        if (pct >= 60) return '#f97316';
        return '#ef4444';
    };

    historyRenderer.helpers.formatDurationShort = function (seconds) {
        var s = Math.max(0, Math.floor(Number(seconds) || 0));
        if (s < 60) return s + '秒';
        var m = Math.floor(s / 60);
        if (m < 60) return m + '分钟';
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return h + '小时' + mm + '分钟';
    };

    historyRenderer.helpers.getDurationColor = function (seconds) {
        var minutes = (Number(seconds) || 0) / 60;
        if (minutes < 20) return '#10b981';
        if (minutes < 23) return '#f59e0b';
        if (minutes < 26) return '#f97316';
        if (minutes < 30) return '#ef4444';
        return '#dc2626';
    };

    historyRenderer.helpers.createGridLayoutCalculator = function (options) {
        options = options || {};
        var baseHeight = Number(options.itemHeight) || 120;
        var desktopGap = options.desktopGap != null ? Number(options.desktopGap) : 16;
        var mobileGap = options.mobileGap != null ? Number(options.mobileGap) : 12;

        return function (context) {
            context = context || {};
            var items = Array.isArray(context.items) ? context.items : [];
            var container = context.container;
            var containerWidth = container && container.clientWidth ? container.clientWidth : 0;
            var isMobile = false;
            if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
                isMobile = window.innerWidth <= 768;
            }
            if (!isMobile && containerWidth > 0) {
                isMobile = containerWidth <= 768;
            }

            var itemsPerRow = isMobile ? 1 : 2;
            var gap = isMobile ? mobileGap : desktopGap;
            var rowStride = baseHeight + gap;
            var totalRows = itemsPerRow > 0 ? Math.ceil(items.length / itemsPerRow) : 0;
            var totalHeight = totalRows > 0 ? (totalRows * rowStride - gap) : 0;

            return {
                itemsPerRow: itemsPerRow,
                rowHeight: rowStride,
                gap: gap,
                totalRows: totalRows,
                totalHeight: totalHeight,
                positionFor: function (index) {
                    var row = Math.floor(index / itemsPerRow);
                    var col = index % itemsPerRow;
                    var top = row * rowStride;
                    if (itemsPerRow === 1) {
                        return { top: top, left: 0, width: '100%', height: baseHeight };
                    }
                    var halfGap = gap / 2;
                    return {
                        top: top,
                        left: col === 0 ? 0 : 'calc(50% + ' + halfGap + 'px)',
                        width: 'calc(50% - ' + halfGap + 'px)',
                        height: baseHeight
                    };
                }
            };
        };
    };

    function createNode(tag, attributes, children) {
        if (domAdapter && typeof domAdapter.create === 'function') {
            return domAdapter.create(tag, attributes, children);
        }
        var element = document.createElement(tag);
        applyLegacyElementAttributes(element, attributes);

        var list = Array.isArray(children) ? children : [children];
        list.forEach(function (child) {
            if (child == null) return;
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    }

    function replaceContent(container, content) {
        if (domAdapter && typeof domAdapter.replaceContent === 'function') {
            domAdapter.replaceContent(container, content);
            return;
        }
        if (!container) return;
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        var nodes = Array.isArray(content) ? content : [content];
        nodes.forEach(function (node) {
            if (!node) return;
            if (typeof node === 'string') {
                container.appendChild(document.createTextNode(node));
            } else if (node instanceof Node) {
                container.appendChild(node);
            }
        });
    }

    historyRenderer.createRecordNode = function (record, options) {
        options = options || {};
        var bulkDeleteMode = Boolean(options.bulkDeleteMode);
        var selectedRecordsInput = options.selectedRecords;
        var selectedRecords = new Set();
        if (selectedRecordsInput && typeof selectedRecordsInput.forEach === 'function') {
            selectedRecordsInput.forEach(function (value) {
                if (value == null) return;
                selectedRecords.add(String(value));
            });
        }
        var helpers = historyRenderer.helpers;
        var durationInSeconds = Number(record && record.duration) || 0;
        var percentage = typeof record.percentage === 'number'
            ? record.percentage
            : Math.round((record.accuracy || 0) * 100);

        var recordId = '';
        if (record && record.id != null) {
            recordId = String(record.id);
        } else if (record && record.sessionId != null) {
            recordId = String(record.sessionId);
        } else if (record && record.realData && record.realData.sessionId != null) {
            recordId = String(record.realData.sessionId);
        } else if (record && record.timestamp != null) {
            recordId = String(record.timestamp);
        } else if (record && record.realData && record.realData.timestamp != null) {
            recordId = String(record.realData.timestamp);
        }

        var item = createNode('div', {
            className: 'history-item history-record-item',
            dataset: { recordId: recordId }
        });

        var isSelected = recordId && selectedRecords.has(recordId);
        var selection = createNode('div', {
            className: 'record-selection' + (bulkDeleteMode ? '' : ' record-selection-hidden')
        }, [
            createNode('input', {
                type: 'checkbox',
                checked: isSelected ? 'checked' : null,
                dataset: { recordId: recordId },
                tabindex: bulkDeleteMode ? '0' : '-1',
                'aria-label': '选择练习记录'
            })
        ]);
        var checkboxNode = selection && selection.querySelector ? selection.querySelector('input[type="checkbox"]') : null;
        if (checkboxNode) {
            checkboxNode.checked = !!isSelected;
            checkboxNode.defaultChecked = !!isSelected;
            checkboxNode.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        }

        if (bulkDeleteMode) {
            item.classList.add('history-item-selectable');
            if (isSelected) {
                item.classList.add('history-item-selected');
            }
        }

        item.appendChild(selection);
        var infoClass = 'record-info' + (bulkDeleteMode ? ' record-info-selectable' : '');
        var info = createNode('div', { className: infoClass }, [
            createNode('a', {
                href: '#',
                className: 'practice-record-title',
                dataset: { recordAction: 'details', recordId: recordId }
            }, [
                createNode('strong', null, record && record.title ? record.title : '无标题')
            ]),
            createNode('div', { className: 'record-meta-line' }, [
                createNode('small', { className: 'record-date' }, record && record.date ? new Date(record.date).toLocaleString() : '未知时间'),
                createNode('small', { className: 'record-duration-value' }, [
                    createNode('strong', null, '用时'),
                    createNode('strong', {
                        className: 'duration-time',
                        style: { color: helpers.getDurationColor(durationInSeconds) }
                    }, helpers.formatDurationShort(durationInSeconds))
                ])
            ])
        ]);

        var percentageNode = createNode('div', { className: 'record-percentage-container' }, [
            createNode('div', {
                className: 'record-percentage',
                style: { color: helpers.getScoreColor(percentage) }
            }, percentage + '%')
        ]);

        var actions = null;
        if (!bulkDeleteMode) {
            actions = createNode('div', { className: 'record-actions-container' }, [
                createNode('button', {
                    type: 'button',
                    className: 'delete-record-btn',
                    title: '删除此记录',
                    dataset: { recordAction: 'delete', recordId: recordId }
                }, '🗑️')
            ]);
        }

        item.appendChild(info);
        item.appendChild(percentageNode);
        if (actions) {
            item.appendChild(actions);
        }
        return item;
    };

    historyRenderer.renderEmptyState = function (container) {
        if (!container) return;
        replaceContent(container, createNode('div', { className: 'practice-history-empty' }, [
            createNode('div', { className: 'practice-history-empty-icon' }, '📂'),
            createNode('p', { className: 'practice-history-empty-text' }, '暂无任何练习记录')
        ]));
    };

    historyRenderer.renderList = function (container, records, options) {
        options = options || {};
        if (!container) return null;
        var list = Array.isArray(records) ? records : [];
        if (list.length === 0) {
            historyRenderer.renderEmptyState(container);
            return null;
        }

        var itemFactory = typeof options.itemFactory === 'function'
            ? options.itemFactory
            : function (record) {
                return historyRenderer.createRecordNode(record, options);
            };

        function measureMaxItemHeight(list) {
            if (!container || !itemFactory || !Array.isArray(list) || list.length === 0) return null;
            var containerWidth = container.clientWidth || container.offsetWidth || 0;
            var isMobile = false;
            if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
                isMobile = window.innerWidth <= 768;
            }
            if (!isMobile && containerWidth > 0) {
                isMobile = containerWidth <= 768;
            }
            var gapPx = isMobile ? 12 : 16;
            var targetWidth = 0;
            if (containerWidth > 0) {
                targetWidth = isMobile ? containerWidth : Math.max(0, (containerWidth - gapPx) / 2);
            }

            var wrapper = document.createElement('div');
            wrapper.style.position = 'absolute';
            wrapper.style.visibility = 'hidden';
            wrapper.style.pointerEvents = 'none';
            wrapper.style.width = '100%';
            container.appendChild(wrapper);

            var maxHeight = 0;
            var samples = Math.min(list.length, 30);
            for (var i = 0; i < samples; i += 1) {
                var node = itemFactory(list[i], i);
                if (!node || !(node instanceof Node)) continue;
                node.style.position = 'relative';
                node.style.width = targetWidth > 0 ? (targetWidth + 'px') : '100%';
                wrapper.appendChild(node);
                var h = node.offsetHeight || node.clientHeight || 0;
                if (h > maxHeight) {
                    maxHeight = h;
                }
                node.remove();
            }
            wrapper.remove();
            return maxHeight > 0 ? maxHeight : null;
        }

        var useVirtualScroller = global.VirtualScroller && options.scrollerOptions !== false;
        if (useVirtualScroller) {
            var scrollerOpts = Object.assign(
                { itemHeight: 120, containerHeight: 650, bufferSize: 4 },
                options.scrollerOptions || {}
            );
            var measuredHeight = measureMaxItemHeight(list);
            if (measuredHeight && measuredHeight > 0) {
                scrollerOpts.itemHeight = measuredHeight + 8; // 留出安全空间避免文字溢出
            }
            scrollerOpts.layoutCalculator = historyRenderer.helpers.createGridLayoutCalculator(scrollerOpts);
            var scrollerFactory = (global.performanceOptimizer && typeof global.performanceOptimizer.createVirtualScroller === 'function')
                ? global.performanceOptimizer.createVirtualScroller.bind(global.performanceOptimizer)
                : function (c, items, renderer, opts) {
                    return new global.VirtualScroller(c, items, renderer, opts);
                };

            if (options.scroller && typeof options.scroller.updateItems === 'function') {
                options.scroller.renderer = itemFactory;
                options.scroller.layoutCalculator = scrollerOpts.layoutCalculator;
                options.scroller.updateItems(list);
                if (typeof options.scroller.recalculate === 'function') {
                    options.scroller.recalculate();
                }
                return options.scroller;
            }
            return scrollerFactory(container, list, itemFactory, scrollerOpts);
        }

        historyRenderer.destroyScroller(options.scroller);

        if (domAdapter && typeof domAdapter.fragment === 'function') {
            domAdapter.replaceContent(container, domAdapter.fragment(list, itemFactory));
        } else {
            replaceContent(container, list.map(itemFactory));
        }
        return null;
    };

    historyRenderer.helpers.getRecordTimestampSafe = function (record) {
        if (!record || typeof record !== 'object') {
            return 0;
        }
        var candidates = [
            record.date, record.endTime, record.timestamp, record.createdAt, record.updatedAt, record.completedAt
        ];
        var rd = record.realData || {};
        candidates.push(rd.date, rd.endTime, rd.timestamp);
        var maxTs = 0;
        for (var i = 0; i < candidates.length; i += 1) {
            var candidate = candidates[i];
            if (candidate == null) continue;
            var parsed = new Date(candidate).getTime();
            if (!isNaN(parsed) && parsed > maxTs) {
                maxTs = parsed;
                continue;
            }
            if (typeof candidate === 'number' && isFinite(candidate) && candidate > maxTs) {
                maxTs = candidate;
            }
        }
        return maxTs;
    };

    historyRenderer.helpers.computeRecordsSignature = function (records) {
        var list = Array.isArray(records) ? records : [];
        var tokens = list.map(function (record, index) {
            var id = record && record.id != null ? record.id : ('idx' + index);
            var ts = historyRenderer.helpers.getRecordTimestampSafe(record);
            var pct = Number(record && record.percentage) || 0;
            var dur = Number(record && record.duration) || 0;
            return id + ':' + ts + ':' + pct + ':' + dur;
        });
        return list.length + '|' + tokens.join(';');
    };

    /**
     * 渲染练习历史列表（简化版，不使用VirtualScroller以支持Grid布局）
     */
    historyRenderer.renderWithState = function (container, records, options) {
        options = options || {};
        if (!container) return null;

        var list = Array.isArray(records) ? records : [];

        if (list.length === 0) {
            historyRenderer.destroyScroller(options.scroller);
            historyRenderer.renderEmptyState(container);
            return null;
        }

        var scrollerOptions = options.scrollerOptions;
        if (scrollerOptions === undefined) {
            scrollerOptions = { itemHeight: 120, containerHeight: 650 };
        }

        return historyRenderer.renderList(container, list, {
            bulkDeleteMode: options.bulkDeleteMode,
            selectedRecords: options.selectedRecords,
            scrollerOptions: scrollerOptions,
            itemFactory: options.itemFactory,
            scroller: options.scroller
        });
    };

    /**
     * 高阶封装：渲染练习历史视图并返回最新 scroller。
     */
    historyRenderer.renderView = function (params) {
        params = params || {};
        var container = params.container;
        if (!container) {
            return { scroller: null };
        }
        var list = Array.isArray(params.records) ? params.records : [];
        var itemFactory = typeof params.itemFactory === 'function'
            ? params.itemFactory
            : function (record) {
                return historyRenderer.createRecordNode(record, {
                    bulkDeleteMode: params.bulkDeleteMode,
                    selectedRecords: params.selectedRecords
                });
            };
        var scroller = historyRenderer.renderWithState(container, list, {
            bulkDeleteMode: params.bulkDeleteMode,
            selectedRecords: params.selectedRecords,
            scrollerOptions: params.scrollerOptions,
            itemFactory: itemFactory,
            scroller: params.scroller
        });
        return { scroller: scroller };
    };

    historyRenderer.destroyScroller = function (scroller) {
        if (!scroller) return;
        if (typeof scroller.destroy === 'function') {
            try {
                scroller.destroy();
            } catch (error) {
                console.warn('[PracticeHistoryRenderer] 销毁虚拟滚动器失败', error);
            }
        }
    };

    // --- Exam list view ---
    var DEFAULT_CONTAINER_ID = 'exam-list-container';
    var DEFAULT_LOADING_SELECTOR = '#browse-view .loading';
    var DEFAULT_BATCH_SIZE = 20;

    function LegacyExamListView(options) {
        options = options || {};
        this.containerId = options.containerId || DEFAULT_CONTAINER_ID;
        this.loadingSelector = options.loadingSelector || DEFAULT_LOADING_SELECTOR;
        this.batchSize = typeof options.batchSize === 'number' && options.batchSize > 0
            ? options.batchSize
            : DEFAULT_BATCH_SIZE;
        this.domAdapter = options.domAdapter || domAdapter;
        this.supportsGenerate = options.supportsGenerate !== false;
    }

    LegacyExamListView.prototype.render = function render(exams, options) {
        options = options || {};
        var container = this._getContainer();
        if (!container) {
            return;
        }

        var loadingSelector = options.loadingSelector || this.loadingSelector;
        var loadingIndicator = this._getLoadingIndicator(loadingSelector);

        var normalizedExams = ensureArray(exams);
        if (normalizedExams.length === 0) {
            this._renderEmptyState(container, options.emptyState);
            this._hideLoading(loadingIndicator);
            return;
        }

        var examList = this._createExamList();
        if (normalizedExams.length > this.batchSize) {
            this._renderBatched(normalizedExams, examList, options);
        } else {
            var fragment = document.createDocumentFragment();
            for (var i = 0; i < normalizedExams.length; i += 1) {
                var element = this._createExamElement(normalizedExams[i], i, options);
                if (element) {
                    fragment.appendChild(element);
                }
            }
            examList.appendChild(fragment);
        }

        this._replaceContent(container, [examList]);
        this._hideLoading(loadingIndicator);
    };

    LegacyExamListView.prototype._createExamList = function _createExamList() {
        return this._createElement('div', { className: 'exam-list' });
    };

    LegacyExamListView.prototype._renderBatched = function _renderBatched(exams, listElement, options) {
        var view = this;
        var index = 0;

        function processBatch() {
            var endIndex = Math.min(index + view.batchSize, exams.length);
            var fragment = document.createDocumentFragment();

            for (var i = index; i < endIndex; i += 1) {
                var element = view._createExamElement(exams[i], i, options);
                if (element) {
                    fragment.appendChild(element);
                }
            }

            listElement.appendChild(fragment);
            index = endIndex;

            if (index < exams.length) {
                requestAnimationFrame(processBatch);
            }
        }

        requestAnimationFrame(processBatch);
    };

    LegacyExamListView.prototype._createExamElement = function _createExamElement(exam, index, options) {
        if (!exam) {
            return null;
        }

        var status = this._getCompletionStatus(exam);
        var selectionMode = options && options.selectionMode ? String(options.selectionMode) : '';
        var draft = options && options.customSuiteDraft ? options.customSuiteDraft : null;
        var categories = draft && Array.isArray(draft.categories) && draft.categories.length
            ? draft.categories
            : ['P1', 'P2', 'P3'];
        var stageIndex = draft && Number.isInteger(draft.stageIndex) ? draft.stageIndex : 0;
        var currentCategory = draft && draft.status !== 'ready' && stageIndex < categories.length
            ? categories[stageIndex]
            : null;
        var examCategory = exam && typeof exam.category === 'string'
            ? exam.category.trim().toUpperCase()
            : '';
        var isSelecting = selectionMode === 'custom-suite' && !!draft && draft.status !== 'ready';
        var isMemorizeSelecting = selectionMode === 'reading-memorize';
        var isSelected = !!draft && draft.pickedByCategory && examCategory && draft.pickedByCategory[examCategory]
            && String(draft.pickedByCategory[examCategory].examId) === String(exam.id);
        var examItem = this._createElement('div', {
            className: 'exam-item'
                + (isSelecting ? ' exam-item--suite-selecting' : '')
                + (isMemorizeSelecting ? ' exam-item--memorize-selecting' : '')
                + (isSelected ? ' exam-item--suite-selected' : ''),
            dataset: { examId: exam.id }
        });
        if (isSelecting) {
            examItem.dataset.action = 'suite-custom-select';
            examItem.setAttribute('role', 'button');
            examItem.setAttribute('tabindex', '0');
        }

        var info = this._createElement('div', { className: 'exam-info' });
        var infoContent = this._createElement('div');

        var title = this._createElement('h4');
        if (status) {
            var dot = this._createCompletionDot(status.percentage);
            if (dot) {
                title.appendChild(dot);
            }
        }
        title.appendChild(document.createTextNode(exam.title || ''));

        var meta = this._createElement('div', { className: 'exam-meta' });
        var metaText;
        if (typeof window !== 'undefined' && typeof window.formatExamMetaText === 'function') {
            metaText = window.formatExamMetaText(exam);
        } else {
            var fallbackParts = [];
            if (exam && typeof exam.sequenceNumber === 'number') {
                fallbackParts.push(String(exam.sequenceNumber));
            }
            if (exam && exam.category) {
                fallbackParts.push(exam.category);
            }
            if (exam && exam.type) {
                fallbackParts.push(exam.type);
            }

            // Add frequency text for reading materials
            if (exam && exam.type === 'reading' && exam.frequency) {
                var frequencyLabels = {
                    'ultra-high': '超高频',
                    'very-high': '次高频',
                    'high': '高频',
                    'medium': '中频',
                    'mid': '中频',
                    'low': '低频',
                    'standard': '标准',
                    '超高频': '超高频',
                    '次高频': '次高频',
                    '高频': '高频',
                    '中频': '中频',
                    '低频': '低频'
                };
                var label = frequencyLabels[exam.frequency] || exam.frequency;
                fallbackParts.push(label);
            }
            if (exam && exam.type === 'reading' && typeof exam.difficultyScore === 'number' && isFinite(exam.difficultyScore)) {
                fallbackParts.push('难度 ' + exam.difficultyScore);
            }

            metaText = fallbackParts.join(' | ');
        }
        meta.textContent = metaText;

        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);
        if (isSelecting && currentCategory) {
            info.appendChild(this._createElement('div', { className: 'suite-custom-selection-badge' }, currentCategory + ' Pending'));
        }
        if (isMemorizeSelecting) {
            info.appendChild(this._createElement('div', { className: 'suite-custom-selection-badge' }, '背题模式'));
        }

        var actions = this._createElement('div', { className: 'exam-actions' });
        var actionConfig = this._resolveActionConfig(exam, options);

        var startBtn = this._createElement('button', {
            className: actionConfig.startClass,
            dataset: { action: actionConfig.startAction, examId: exam.id },
            type: 'button'
        }, actionConfig.startLabel);
        if (isSelecting) {
            startBtn.disabled = true;
            startBtn.setAttribute('aria-disabled', 'true');
        }
        actions.appendChild(startBtn);

        if (actionConfig.includePdfButton) {
            var pdfBtn = this._createElement('button', {
                className: 'btn btn-secondary exam-item-action-btn',
                dataset: { action: 'pdf', examId: exam.id },
                type: 'button',
                title: '查看PDF版本'
            }, '查看PDF');
            if (isSelecting) {
                pdfBtn.disabled = true;
                pdfBtn.setAttribute('aria-disabled', 'true');
            }
            actions.appendChild(pdfBtn);
        }

        if (this._shouldShowGenerate(exam, options)) {
            var generateBtn = this._createElement('button', {
                className: 'btn btn-info exam-item-action-btn',
                dataset: { action: 'generate', examId: exam.id },
                type: 'button',
                title: '为此题目生成HTML版本'
            }, '生成HTML');
            if (isSelecting) {
                generateBtn.disabled = true;
                generateBtn.setAttribute('aria-disabled', 'true');
            }
            actions.appendChild(generateBtn);
        }

        examItem.appendChild(info);
        examItem.appendChild(actions);
        return examItem;
    };

    LegacyExamListView.prototype._resolveActionConfig = function _resolveActionConfig(exam, options) {
        var hasHtml = !!(exam && exam.hasHtml);
        var selectionMode = options && options.selectionMode ? String(options.selectionMode) : '';
        var config = {
            startAction: 'start',
            startLabel: hasHtml ? '开始练习' : '查看PDF',
            startClass: hasHtml ? 'btn exam-item-action-btn' : 'btn btn-secondary exam-item-action-btn',
            includePdfButton: true
        };
        if (selectionMode === 'reading-memorize') {
            config = {
                startAction: 'reading-memorize-select',
                startLabel: '选择背题',
                startClass: 'btn exam-item-action-btn',
                includePdfButton: false
            };
        }

        if (options && typeof options.configureStartButton === 'function') {
            try {
                var override = options.configureStartButton(exam, config) || {};
                config = Object.assign({}, config, override);
            } catch (error) {
                console.warn('[LegacyExamListView] 自定义开始按钮配置失败', error);
            }
        }

        return config;
    };

    LegacyExamListView.prototype._shouldShowGenerate = function _shouldShowGenerate(exam, options) {
        if (!this.supportsGenerate) {
            return false;
        }
        if (options && String(options.selectionMode || '') === 'reading-memorize') {
            return false;
        }
        if (options && options.supportsGenerate === false) {
            return false;
        }
        if (!exam || exam.hasHtml) {
            return false;
        }

        if (options && typeof options.canGenerate === 'function') {
            try {
                return !!options.canGenerate(exam);
            } catch (error) {
                console.warn('[LegacyExamListView] canGenerate 回调执行失败', error);
                return false;
            }
        }

        if (typeof global.generateHTML === 'function') {
            return true;
        }

        var app = global.app || (global.window && global.window.app);
        return !!(app && typeof app.generateHTMLForPDFExam === 'function');
    };

    LegacyExamListView.prototype._createCompletionDot = function _createCompletionDot(percentage) {
        if (typeof percentage !== 'number') {
            return null;
        }
        var className = 'completion-dot';
        var levelClass = this._getCompletionClass(percentage);
        if (levelClass) {
            className += ' ' + levelClass;
        }
        var dot = this._createElement('span', {
            className: className,
            ariaHidden: 'true'
        });
        dot.title = '最近正确率 ' + Math.round(percentage) + '%';
        return dot;
    };

    LegacyExamListView.prototype._getCompletionClass = function _getCompletionClass(percentage) {
        if (typeof percentage !== 'number') {
            return '';
        }
        if (percentage >= 90) return 'completion-dot--excellent';
        if (percentage >= 75) return 'completion-dot--strong';
        if (percentage >= 60) return 'completion-dot--average';
        return 'completion-dot--weak';
    };

    LegacyExamListView.prototype._renderEmptyState = function _renderEmptyState(container, config) {
        var safeConfig = config || {};
        var icon = safeConfig.icon || '🔍';
        var title = safeConfig.title || '未找到匹配的题目';
        var description = safeConfig.description || '请调整筛选条件或搜索词后再试';
        var actions = Array.isArray(safeConfig.actions) ? safeConfig.actions.slice() : [];

        if (!actions.length && safeConfig.disableDefaultActions !== true) {
            actions.push({
                action: 'load-library',
                label: safeConfig.defaultActionLabel || '📂 加载题库',
                variant: 'primary',
                ariaLabel: safeConfig.defaultActionAriaLabel || '加载题库'
            });
        }

        var children = [
            this._createElement('div', { className: 'exam-list-empty-icon', ariaHidden: 'true' }, icon),
            this._createElement('p', { className: 'exam-list-empty-text' }, title)
        ];

        if (description) {
            children.push(this._createElement('p', { className: 'exam-list-empty-hint' }, description));
        }

        if (actions.length > 0) {
            var actionContainer = this._createElement('div', {
                className: 'exam-list-empty-actions',
                role: 'group',
                ariaLabel: safeConfig.actionGroupLabel || '题库操作'
            });

            for (var i = 0; i < actions.length; i += 1) {
                var action = actions[i];
                if (!action || !action.action || !action.label) {
                    continue;
                }

                var buttonClasses = ['btn', 'exam-list-empty-action'];
                if (action.variant === 'primary') {
                    buttonClasses.push('btn-primary');
                } else if (action.variant === 'secondary') {
                    buttonClasses.push('btn-secondary');
                }

                var button = this._createElement('button', {
                    className: buttonClasses.join(' '),
                    type: 'button',
                    dataset: { action: action.action },
                    ariaLabel: action.ariaLabel || action.label
                }, action.label);

                if (button && action.action === 'load-library') {
                    try {
                        button.addEventListener('click', function handleLoadLibraryClick(event) {
                            if (event && typeof event.preventDefault === 'function') {
                                event.preventDefault();
                            }
                            if (typeof global.loadLibrary === 'function') {
                                try { global.loadLibrary(false); } catch (_) { }
                            } else if (typeof global.showLibraryLoaderModal === 'function') {
                                global.showLibraryLoaderModal();
                            }
                        });
                    } catch (_) { }
                }

                actionContainer.appendChild(button);
            }

            if (actionContainer.childNodes.length > 0) {
                children.push(actionContainer);
            }
        }

        var emptyState = this._createElement('div', {
            className: 'exam-list-empty',
            role: 'status'
        }, children);

        this._replaceContent(container, [emptyState]);
    };

    LegacyExamListView.prototype._replaceContent = function _replaceContent(container, children) {
        if (!container) {
            return;
        }

        if (this.domAdapter && typeof this.domAdapter.replaceContent === 'function') {
            this.domAdapter.replaceContent(container, children);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        var normalized = Array.isArray(children) ? children : [children];
        for (var i = 0; i < normalized.length; i += 1) {
            if (normalized[i]) {
                container.appendChild(normalized[i]);
            }
        }
    };

    LegacyExamListView.prototype._createElement = function _createElement(tag, attributes, children) {
        if (this.domAdapter && typeof this.domAdapter.create === 'function') {
            return this.domAdapter.create(tag, attributes, children);
        }

        var element = document.createElement(tag);
        applyLegacyElementAttributes(element, attributes);

        if (children != null) {
            var normalizedChildren = Array.isArray(children) ? children : [children];
            for (var c = 0; c < normalizedChildren.length; c += 1) {
                var child = normalizedChildren[c];
                if (child == null) {
                    continue;
                }
                if (typeof child === 'string') {
                    element.appendChild(document.createTextNode(child));
                } else if (child instanceof Node) {
                    element.appendChild(child);
                }
            }
        }

        return element;
    };

    LegacyExamListView.prototype._getContainer = function _getContainer() {
        return typeof document !== 'undefined'
            ? document.getElementById(this.containerId)
            : null;
    };

    LegacyExamListView.prototype._getLoadingIndicator = function _getLoadingIndicator(selector) {
        if (!selector || typeof document === 'undefined') {
            return null;
        }
        try {
            return document.querySelector(selector);
        } catch (_) {
            return null;
        }
    };

    LegacyExamListView.prototype._hideLoading = function _hideLoading(element) {
        if (!element) {
            return;
        }
        if (this.domAdapter && typeof this.domAdapter.hide === 'function') {
            this.domAdapter.hide(element);
        } else {
            element.style.display = 'none';
        }
    };

    LegacyExamListView.prototype._getCompletionStatus = function _getCompletionStatus(exam) {
        var source = (typeof global.getPracticeRecordsState === 'function')
            ? global.getPracticeRecordsState()
            : global.practiceRecords;
        var records = ensureArray(source).filter(function (record) {
            return recordMatchesExam(exam, record);
        });
        if (records.length === 0) {
            return null;
        }
        records.sort(function (a, b) {
            return getRecordTimestamp(b) - getRecordTimestamp(a);
        });
        var latest = records[0] || {};
        return {
            percentage: typeof latest.percentage === 'number' ? latest.percentage : 0,
            date: latest.date || latest.endTime || latest.timestamp || latest.createdAt || null
        };
    };

    // --- Legacy navigation controller ---
    function LegacyNavigationController(options) {
        options = options || {};
        this.options = {
            containerSelector: options.containerSelector || '.main-nav',
            navButtonSelector: options.navButtonSelector || '.nav-btn[data-view]',
            activeClass: options.activeClass || 'active',
            syncOnNavigate: options.syncOnNavigate !== false,
            onNavigate: typeof options.onNavigate === 'function' ? options.onNavigate : null,
            onRepeatNavigate: typeof options.onRepeatNavigate === 'function' ? options.onRepeatNavigate : null
        };
        this.container = options.container || null;
        this._boundClickHandler = this._handleClick.bind(this);
        this._isMounted = false;
    }

    LegacyNavigationController.prototype.updateOptions = function updateOptions(options) {
        if (!options) {
            return;
        }
        this.options = Object.assign({}, this.options, {
            containerSelector: options.containerSelector || this.options.containerSelector,
            navButtonSelector: options.navButtonSelector || this.options.navButtonSelector,
            activeClass: options.activeClass || this.options.activeClass,
            syncOnNavigate: options.syncOnNavigate === undefined ? this.options.syncOnNavigate : options.syncOnNavigate,
            onNavigate: typeof options.onNavigate === 'function' ? options.onNavigate : this.options.onNavigate,
            onRepeatNavigate: typeof options.onRepeatNavigate === 'function' ? options.onRepeatNavigate : this.options.onRepeatNavigate
        });
        if (options.container) {
            this.container = options.container;
        }
    };

    LegacyNavigationController.prototype.mount = function mount(container) {
        if (typeof document === 'undefined') {
            return null;
        }

        var targetContainer = container;
        if (!targetContainer) {
            if (this.container && document.contains(this.container)) {
                targetContainer = this.container;
            } else if (this.options.containerSelector) {
                targetContainer = document.querySelector(this.options.containerSelector);
            }
        }

        if (!targetContainer) {
            this.unmount();
            return null;
        }

        if (this.container && this.container !== targetContainer) {
            this.unmount();
        }

        this.container = targetContainer;
        if (!this._isMounted) {
            this.container.addEventListener('click', this._boundClickHandler);
        }
        this._isMounted = true;
        return this.container;
    };

    LegacyNavigationController.prototype.unmount = function unmount() {
        if (!this.container) {
            return;
        }
        try {
            this.container.removeEventListener('click', this._boundClickHandler);
        } catch (_) { }
        this.container = null;
        this._isMounted = false;
    };

    LegacyNavigationController.prototype.navigate = function navigate(viewName, event) {
        var handler = this.options.onNavigate;
        if (typeof handler === 'function') {
            handler(viewName, event);
            return;
        }

        if (typeof window.showView === 'function') {
            window.showView(viewName);
            return;
        }

        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView(viewName);
        }
    };

    LegacyNavigationController.prototype.syncActive = function syncActive(viewName) {
        if (typeof document === 'undefined') {
            return;
        }
        var selector = this.options.navButtonSelector || '.nav-btn[data-view]';
        var activeClass = this.options.activeClass || 'active';
        var container = this.container || document.querySelector(this.options.containerSelector || '.main-nav');
        if (!container) {
            return;
        }

        var buttons = container.querySelectorAll(selector);
        for (var i = 0; i < buttons.length; i += 1) {
            var button = buttons[i];
            if (!button) {
                continue;
            }
            if (button.classList) {
                button.classList.toggle(activeClass, button.dataset.view === viewName);
            } else if (typeof button.className === 'string') {
                if (button.dataset.view === viewName) {
                    if ((' ' + button.className + ' ').indexOf(' ' + activeClass + ' ') === -1) {
                        button.className += ' ' + activeClass;
                    }
                } else {
                    button.className = button.className.replace(new RegExp('(?:^|\\s)' + activeClass + '(?:$|\\s)', 'g'), ' ').trim();
                }
            }
        }
    };

    LegacyNavigationController.prototype._handleClick = function _handleClick(event) {
        if (!event) {
            return;
        }
        var selector = this.options.navButtonSelector || '.nav-btn[data-view]';
        var target = event.target && event.target.closest ? event.target.closest(selector) : null;
        if (!target || (this.container && !this.container.contains(target))) {
            return;
        }

        var viewName = target.dataset ? target.dataset.view : null;
        if (!viewName) {
            return;
        }

        var activeClass = this.options.activeClass || 'active';
        var alreadyActive = false;
        if (target.classList && target.classList.contains(activeClass)) {
            alreadyActive = true;
        } else if (typeof target.className === 'string') {
            alreadyActive = new RegExp('(?:^|\\s)' + activeClass + '(?:$|\\s)').test(target.className);
        }

        event.preventDefault();
        this.navigate(viewName, event);
        if (alreadyActive && typeof this.options.onRepeatNavigate === 'function') {
            try {
                this.options.onRepeatNavigate(viewName, event);
            } catch (repeatError) {
                console.warn('[LegacyNavigationController] onRepeatNavigate 执行失败', repeatError);
            }
        }
        if (this.options.syncOnNavigate !== false) {
            this.syncActive(viewName);
        }
    };

    var legacyNavigationControllerInstance = null;

    function ensureLegacyNavigationController(options) {
        options = options || {};
        if (!legacyNavigationControllerInstance) {
            legacyNavigationControllerInstance = new LegacyNavigationController(options);
        } else {
            legacyNavigationControllerInstance.updateOptions(options);
        }

        var container = options.container;
        if (!container && options.containerSelector && typeof document !== 'undefined') {
            container = document.querySelector(options.containerSelector);
        }
        legacyNavigationControllerInstance.mount(container);

        if (options.initialView) {
            legacyNavigationControllerInstance.syncActive(options.initialView);
        }

        global.__legacyNavigationController = legacyNavigationControllerInstance;
        return legacyNavigationControllerInstance;
    }

    // --- Library configuration view ---
    function LibraryConfigView(options) {
        options = options || {};
        this.domAdapter = options.domAdapter || domAdapter;
        this.classNames = Object.assign({
            host: 'library-config-list',
            panel: 'library-config-panel',
            header: 'library-config-panel__header',
            title: 'library-config-panel__title',
            badge: 'library-config-panel__badge',
            list: 'library-config-panel__list',
            item: 'library-config-panel__item',
            itemActive: 'library-config-panel__item--active',
            info: 'library-config-panel__info',
            meta: 'library-config-panel__meta',
            actions: 'library-config-panel__actions',
            footer: 'library-config-panel__footer',
            closeButton: 'library-config-panel__close',
            empty: 'library-config-panel__empty',
            emptyIcon: 'library-config-panel__empty-icon',
            emptyHint: 'library-config-panel__empty-hint'
        }, options.classNames || {});
    }

    LibraryConfigView.prototype.mount = function mount(container, configs, options) {
        if (!container) {
            return null;
        }

        var host = this._ensureHost(container);
        var panel = this._renderPanel(ensureArray(configs), options || {});
        this._replaceContent(host, [panel]);
        this._bindActions(host, options || {});
        return host;
    };

    LibraryConfigView.prototype._renderPanel = function _renderPanel(configs, options) {
        var panel = this._createElement('div', {
            className: this.classNames.panel,
            role: 'dialog',
            ariaLabel: '题库配置列表'
        });

        panel.appendChild(this._renderHeader());

        if (!configs.length) {
            panel.appendChild(this._renderEmptyState(options && options.emptyMessage));
        } else {
            panel.appendChild(this._renderList(configs, options));
        }

        panel.appendChild(this._renderFooter());
        return panel;
    };

    LibraryConfigView.prototype._renderHeader = function _renderHeader() {
        var header = this._createElement('div', { className: this.classNames.header });
        header.appendChild(this._createElement('h3', {
            className: this.classNames.title
        }, ['📚', this._createElement('span', null, ' 题库配置列表')]));
        return header;
    };

    LibraryConfigView.prototype._renderEmptyState = function _renderEmptyState(customMessage) {
        var message = typeof customMessage === 'string' && customMessage.trim().length
            ? customMessage
            : '暂无题库配置记录';

        return this._createElement('div', { className: this.classNames.empty }, [
            this._createElement('span', { className: this.classNames.emptyIcon, ariaHidden: 'true' }, '🗂️'),
            this._createElement('p', { className: this.classNames.emptyHint }, message)
        ]);
    };

    LibraryConfigView.prototype._renderList = function _renderList(configs, options) {
        var list = this._createElement('div', {
            className: this.classNames.list,
            role: 'list'
        });

        var activeKey = options && options.activeKey;
        var allowDelete = options && options.allowDelete !== false;

        for (var i = 0; i < configs.length; i += 1) {
            var config = configs[i];
            if (!config) {
                continue;
            }
            list.appendChild(this._renderItem(config, activeKey, allowDelete));
        }
        return list;
    };

    LibraryConfigView.prototype._renderItem = function _renderItem(config, activeKey, allowDelete) {
        var isActive = activeKey === config.key;
        var isDefault = config.key === 'exam_index';
        var className = this.classNames.item + (isActive ? ' ' + this.classNames.itemActive : '');

        var item = this._createElement('div', {
            className: className,
            role: 'listitem'
        });

        var info = this._createElement('div', { className: this.classNames.info });
        var titleChildren = [config.name || config.key || '未命名题库'];
        if (isDefault) {
            titleChildren.push(this._createElement('span', { className: this.classNames.badge }, '默认'));
        }
        if (isActive) {
            titleChildren.push(this._createElement('span', { className: this.classNames.badge }, '当前'));
        }

        info.appendChild(this._createElement('div', null, titleChildren));

        var metaText = this._formatConfigMeta(config);
        info.appendChild(this._createElement('div', { className: this.classNames.meta }, metaText));

        var actions = this._createElement('div', { className: this.classNames.actions });
        var switchButton = this._createElement('button', {
            className: 'btn btn-secondary',
            type: 'button',
            dataset: {
                configAction: 'switch',
                configKey: config.key,
                configActive: isActive ? '1' : '0'
            }
        }, '切换');
        if (typeof switchButton.addEventListener === 'function') {
            (function (button, key) {
                button.addEventListener('click', function (event) {
                    if (event && typeof event.preventDefault === 'function') {
                        event.preventDefault();
                    }
                    if (event && typeof event.stopPropagation === 'function') {
                        event.stopPropagation();
                    }
                    if (typeof window.switchLibraryConfig === 'function') {
                        window.switchLibraryConfig(key);
                    }
                });
            })(switchButton, config.key);
        }
        actions.appendChild(switchButton);

        if (!isDefault && allowDelete !== false) {
            var deleteButton = this._createElement('button', {
                className: 'btn btn-warning',
                type: 'button',
                dataset: {
                    configAction: 'delete',
                    configKey: config.key,
                    configActive: isActive ? '1' : '0'
                }
            }, '删除');
            if (typeof deleteButton.addEventListener === 'function') {
                (function (button, key) {
                    button.addEventListener('click', function (event) {
                        if (event && typeof event.preventDefault === 'function') {
                            event.preventDefault();
                        }
                        if (event && typeof event.stopPropagation === 'function') {
                            event.stopPropagation();
                        }
                        if (typeof window.deleteLibraryConfig === 'function') {
                            window.deleteLibraryConfig(key);
                        }
                    });
                })(deleteButton, config.key);
            }
            actions.appendChild(deleteButton);
        }

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    };

    LibraryConfigView.prototype._renderFooter = function _renderFooter() {
        var footer = this._createElement('div', { className: this.classNames.footer });
        footer.appendChild(this._createElement('button', {
            className: 'btn btn-secondary ' + this.classNames.closeButton,
            type: 'button',
            dataset: { configAction: 'close' }
        }, '关闭'));
        return footer;
    };

    LibraryConfigView.prototype._ensureHost = function _ensureHost(container) {
        var host = container.querySelector('.' + this.classNames.host);
        if (!host) {
            host = this._createElement('div', { className: this.classNames.host });
            container.appendChild(host);
        }
        return host;
    };

    LibraryConfigView.prototype._replaceContent = function _replaceContent(container, nodes) {
        if (this.domAdapter && typeof this.domAdapter.replaceContent === 'function') {
            this.domAdapter.replaceContent(container, nodes);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        var elements = Array.isArray(nodes) ? nodes : [nodes];
        for (var i = 0; i < elements.length; i += 1) {
            var node = elements[i];
            if (node instanceof Node) {
                container.appendChild(node);
            }
        }
    };

    LibraryConfigView.prototype._bindActions = function _bindActions(host, options) {
        if (!host) {
            return;
        }

        if (host._libraryConfigHandler) {
            host.removeEventListener('click', host._libraryConfigHandler);
        }

        var handlers = options && options.handlers ? options.handlers : {};
        var findActionTarget = function (node) {
            var current = node;
            while (current && current !== host) {
                if (current.dataset && current.dataset.configAction) {
                    return current;
                }
                current = current.parentNode;
            }
            return null;
        };

        var listener = function (event) {
            var target = findActionTarget(event.target);
            if (!target) {
                return;
            }

            var action = target.dataset.configAction;
            if (action === 'close') {
                event.preventDefault();
                host.remove();
                return;
            }

            var handler = handlers[action];
            if (typeof handler === 'function') {
                handler(target.dataset.configKey, event);
            }
        };

        host._libraryConfigHandler = listener;
        host.addEventListener('click', listener);
    };

    LibraryConfigView.prototype._createElement = function _createElement(tag, attributes, children) {
        if (this.domAdapter && typeof this.domAdapter.create === 'function') {
            return this.domAdapter.create(tag, attributes, children);
        }

        var element = document.createElement(tag);
        applyLegacyElementAttributes(element, attributes);

        var nodes = Array.isArray(children) ? children : (children != null ? [children] : []);
        for (var i = 0; i < nodes.length; i += 1) {
            var child = nodes[i];
            if (child == null) {
                continue;
            }
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        }
        return element;
    };

    LibraryConfigView.prototype._formatTimestamp = function _formatTimestamp(timestamp) {
        if (!timestamp) {
            return '未知时间';
        }
        try {
            return new Date(timestamp).toLocaleString();
        } catch (error) {
            return '未知时间';
        }
    };

    LibraryConfigView.prototype._formatConfigMeta = function _formatConfigMeta(config) {
        config = config || {};
        var counts = config.counts && typeof config.counts === 'object' ? config.counts : {};
        var total = Number.isFinite(Number(config.examCount)) ? Number(config.examCount) : (Number(counts.total) || 0);
        var parts = [this._formatTimestamp(config.timestamp), total + ' 个题目'];
        if (Number.isFinite(Number(counts.reading)) || Number.isFinite(Number(counts.listening))) {
            parts.push('阅读 ' + (Number(counts.reading) || 0));
            parts.push('听力 ' + (Number(counts.listening) || 0));
        }
        var lastImport = config.lastImport && typeof config.lastImport === 'object' ? config.lastImport : null;
        if (lastImport && (lastImport.type || lastImport.mode)) {
            var typeLabel = lastImport.type === 'reading' ? '阅读' : (lastImport.type === 'listening' ? '听力' : '题库');
            var modeLabel = lastImport.mode === 'incremental' ? '增量' : (lastImport.mode === 'full' ? '全量' : '导入');
            parts.push(typeLabel + modeLabel);
        }
        return parts.join(' · ');
    };

    global.PracticeStats = PracticeStats;
    global.PracticeDashboardView = PracticeDashboardView;
    global.PracticeTrendRenderer = PracticeTrendRenderer;
    global.PracticePriorityRenderer = PracticePriorityRenderer;
    global.PracticeHistoryRenderer = historyRenderer;
    global.LegacyExamListView = LegacyExamListView;
    global.LibraryConfigView = LibraryConfigView;
    global.LegacyNavigationController = LegacyNavigationController;
    global.ensureLegacyNavigationController = ensureLegacyNavigationController;
})(window);
