(function (global) {
    'use strict';

    var domAdapter = global.DOMAdapter || null;

    // --- Practice statistics service ---
    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
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
        var index = ensureArray(exams);
        return ensureArray(records).filter(function (record) {
            var exam = index.find(function (item) {
                return item && (item.id === record.examId || item.title === record.title);
            });
            return exam ? exam.type === type : false;
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

    // --- Practice history renderer ---
    var historyRenderer = { helpers: {} };

    historyRenderer.helpers.getScoreColor = function(percentage) {
        var pct = Number(percentage) || 0;
        if (pct >= 90) return '#10b981';
        if (pct >= 75) return '#f59e0b';
        if (pct >= 60) return '#f97316';
        return '#ef4444';
    };

    historyRenderer.helpers.formatDurationShort = function(seconds) {
        var s = Math.max(0, Math.floor(Number(seconds) || 0));
        if (s < 60) return s + '秒';
        var m = Math.floor(s / 60);
        if (m < 60) return m + '分钟';
        var h = Math.floor(m / 60);
        var mm = m % 60;
        return h + '小时' + mm + '分钟';
    };

    historyRenderer.helpers.getDurationColor = function(seconds) {
        var minutes = (Number(seconds) || 0) / 60;
        if (minutes < 20) return '#10b981';
        if (minutes < 23) return '#f59e0b';
        if (minutes < 26) return '#f97316';
        if (minutes < 30) return '#ef4444';
        return '#dc2626';
    };

    function createNode(tag, attributes, children) {
        if (domAdapter && typeof domAdapter.create === 'function') {
            return domAdapter.create(tag, attributes, children);
        }
        var element = document.createElement(tag);
        var attrs = attributes || {};
        Object.keys(attrs).forEach(function(key) {
            var value = attrs[key];
            if (value == null) return;
            if (key === 'className') {
                element.className = value;
                return;
            }
            if (key === 'dataset' && typeof value === 'object') {
                Object.keys(value).forEach(function(dataKey) {
                    var dataValue = value[dataKey];
                    if (dataValue != null) {
                        element.dataset[dataKey] = String(dataValue);
                    }
                });
                return;
            }
            if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
                return;
            }
            element.setAttribute(key, value === true ? '' : value);
        });

        var list = Array.isArray(children) ? children : [children];
        list.forEach(function(child) {
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
        nodes.forEach(function(node) {
            if (!node) return;
            if (typeof node === 'string') {
                container.appendChild(document.createTextNode(node));
            } else if (node instanceof Node) {
                container.appendChild(node);
            }
        });
    }

    historyRenderer.createRecordNode = function(record, options) {
        options = options || {};
        var bulkDeleteMode = Boolean(options.bulkDeleteMode);
        var selectedRecords = options.selectedRecords || new Set();
        var helpers = historyRenderer.helpers;
        var durationInSeconds = Number(record && record.duration) || 0;
        var percentage = typeof record.percentage === 'number'
            ? record.percentage
            : Math.round((record.accuracy || 0) * 100);

        var item = createNode('div', {
            className: 'history-item',
            dataset: { recordId: record && record.id ? record.id : '' }
        });

        if (bulkDeleteMode) {
            item.classList.add('history-item-selectable');
            if (record && record.id && selectedRecords.has(record.id)) {
                item.classList.add('history-item-selected');
            }
        }

        var infoClass = 'record-info' + (bulkDeleteMode ? ' record-info-selectable' : '');
        var info = createNode('div', { className: infoClass }, [
            createNode('a', {
                href: '#',
                className: 'practice-record-title',
                dataset: { recordAction: 'details', recordId: record && record.id ? record.id : '' }
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
                    dataset: { recordAction: 'delete', recordId: record && record.id ? record.id : '' }
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

    historyRenderer.renderEmptyState = function(container) {
        if (!container) return;
        replaceContent(container, createNode('div', { className: 'practice-history-empty' }, [
            createNode('div', { className: 'practice-history-empty-icon' }, '📂'),
            createNode('p', { className: 'practice-history-empty-text' }, '暂无任何练习记录')
        ]));
    };

    historyRenderer.renderList = function(container, records, options) {
        options = options || {};
        if (!container) return null;
        var list = Array.isArray(records) ? records : [];
        if (list.length === 0) {
            historyRenderer.renderEmptyState(container);
            return null;
        }

        var itemFactory = typeof options.itemFactory === 'function'
            ? options.itemFactory
            : function(record) {
                return historyRenderer.createRecordNode(record, options);
            };

        if (global.VirtualScroller && options.scrollerOptions !== false) {
            var scrollerOpts = Object.assign({ itemHeight: 100, containerHeight: 650 }, options.scrollerOptions || {});
            replaceContent(container, []);
            return new global.VirtualScroller(container, list, itemFactory, scrollerOpts);
        }

        if (domAdapter && typeof domAdapter.fragment === 'function') {
            domAdapter.replaceContent(container, domAdapter.fragment(list, itemFactory));
        } else {
            replaceContent(container, list.map(itemFactory));
        }
        return null;
    };

    historyRenderer.destroyScroller = function(scroller) {
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
            this._renderEmptyState(container);
            this._hideLoading(loadingIndicator);
            return;
        }

        var examList = this._createExamList();
        if (normalizedExams.length > this.batchSize) {
            this._renderBatched(normalizedExams, examList);
        } else {
            var fragment = document.createDocumentFragment();
            for (var i = 0; i < normalizedExams.length; i += 1) {
                var element = this._createExamElement(normalizedExams[i], i);
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

    LegacyExamListView.prototype._renderBatched = function _renderBatched(exams, listElement) {
        var view = this;
        var index = 0;

        function processBatch() {
            var endIndex = Math.min(index + view.batchSize, exams.length);
            var fragment = document.createDocumentFragment();

            for (var i = index; i < endIndex; i += 1) {
                var element = view._createExamElement(exams[i], i);
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

    LegacyExamListView.prototype._createExamElement = function _createExamElement(exam) {
        if (!exam) {
            return null;
        }

        var status = this._getCompletionStatus(exam);
        var examItem = this._createElement('div', {
            className: 'exam-item',
            dataset: { examId: exam.id }
        });

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
        meta.textContent = (exam.category || '') + ' | ' + (exam.type || '');

        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);

        var actions = this._createElement('div', { className: 'exam-actions' });
        var startBtn = this._createElement('button', {
            className: 'btn exam-item-action-btn',
            dataset: { action: 'start', examId: exam.id },
            type: 'button'
        }, '开始');

        var pdfBtn = this._createElement('button', {
            className: 'btn btn-secondary exam-item-action-btn',
            dataset: { action: 'pdf', examId: exam.id },
            type: 'button'
        }, 'PDF');

        actions.appendChild(startBtn);
        actions.appendChild(pdfBtn);

        examItem.appendChild(info);
        examItem.appendChild(actions);
        return examItem;
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

    LegacyExamListView.prototype._renderEmptyState = function _renderEmptyState(container) {
        var emptyState = this._createElement('div', {
            className: 'exam-list-empty',
            role: 'status'
        }, [
            this._createElement('div', { className: 'exam-list-empty-icon', ariaHidden: 'true' }, '🔍'),
            this._createElement('p', { className: 'exam-list-empty-text' }, '未找到匹配的题目'),
            this._createElement('p', { className: 'exam-list-empty-hint' }, '请调整筛选条件或搜索词后再试')
        ]);

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
        var attrs = attributes || {};
        var keys = Object.keys(attrs);
        for (var i = 0; i < keys.length; i += 1) {
            var key = keys[i];
            var value = attrs[key];
            if (value == null) {
                continue;
            }
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset' && typeof value === 'object') {
                Object.keys(value).forEach(function(dataKey) {
                    var dataValue = value[dataKey];
                    if (dataValue != null) {
                        element.dataset[dataKey] = String(dataValue);
                    }
                });
            } else if (key === 'style' && typeof value === 'object') {
                Object.keys(value).forEach(function(styleKey) {
                    element.style[styleKey] = value[styleKey];
                });
            } else if (key === 'ariaHidden') {
                element.setAttribute('aria-hidden', value);
            } else {
                element.setAttribute(key, value === true ? '' : value);
            }
        }

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
        var records = ensureArray(global.practiceRecords).filter(function (record) {
            return record && (record.examId === exam.id || record.title === exam.title);
        });
        if (records.length === 0) {
            return null;
        }
        records.sort(function (a, b) {
            return new Date(b.date) - new Date(a.date);
        });
        return {
            percentage: records[0].percentage || 0,
            date: records[0].date
        };
    };

    global.PracticeStats = PracticeStats;
    global.PracticeDashboardView = PracticeDashboardView;
    global.PracticeHistoryRenderer = historyRenderer;
    global.LegacyExamListView = LegacyExamListView;
})(window);
