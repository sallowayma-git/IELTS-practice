(function (global) {
    'use strict';

    var domAdapter = global.DOMAdapter || null;

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
            record.date, record.endTime, record.timestamp, record.createdAt, record.updatedAt,
            record.completedAt
        ];
        var rd = record.realData || {};
        candidates.push(rd.date, rd.endTime, rd.timestamp);

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

        var recordId = record && record.id != null ? String(record.id) : '';

        var item = createNode('div', {
            className: 'history-item history-record-item',
            dataset: { recordId: recordId }
        });

        var selection = createNode('div', {
            className: 'record-selection' + (bulkDeleteMode ? '' : ' record-selection-hidden')
        }, [
            createNode('input', {
                type: 'checkbox',
                checked: selectedRecords.has(recordId) ? '' : null,
                dataset: { recordId: recordId },
                tabindex: bulkDeleteMode ? '0' : '-1',
                'aria-label': '选择练习记录'
            })
        ]);

        if (bulkDeleteMode) {
            item.classList.add('history-item-selectable');
            if (recordId && selectedRecords.has(recordId)) {
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
            metaText = fallbackParts.join(' | ');
        }
        meta.textContent = metaText;

        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);

        var actions = this._createElement('div', { className: 'exam-actions' });
        var actionConfig = this._resolveActionConfig(exam, options);

        var startBtn = this._createElement('button', {
            className: actionConfig.startClass,
            dataset: { action: actionConfig.startAction, examId: exam.id },
            type: 'button'
        }, actionConfig.startLabel);
        actions.appendChild(startBtn);

        if (actionConfig.includePdfButton) {
            var pdfBtn = this._createElement('button', {
                className: 'btn btn-secondary exam-item-action-btn',
                dataset: { action: 'pdf', examId: exam.id },
                type: 'button',
                title: '查看PDF版本'
            }, '查看PDF');
            actions.appendChild(pdfBtn);
        }

        if (this._shouldShowGenerate(exam, options)) {
            var generateBtn = this._createElement('button', {
                className: 'btn btn-info exam-item-action-btn',
                dataset: { action: 'generate', examId: exam.id },
                type: 'button',
                title: '为此题目生成HTML版本'
            }, '生成HTML');
            actions.appendChild(generateBtn);
        }

        examItem.appendChild(info);
        examItem.appendChild(actions);
        return examItem;
    };

    LegacyExamListView.prototype._resolveActionConfig = function _resolveActionConfig(exam, options) {
        var hasHtml = !!(exam && exam.hasHtml);
        var config = {
            startAction: 'start',
            startLabel: hasHtml ? '开始练习' : '查看PDF',
            startClass: hasHtml ? 'btn exam-item-action-btn' : 'btn btn-secondary exam-item-action-btn',
            includePdfButton: true
        };

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
                                try { global.loadLibrary(false); } catch (_) {}
                            } else if (typeof global.showLibraryLoaderModal === 'function') {
                                global.showLibraryLoaderModal();
                            }
                        });
                    } catch (_) {}
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
            } else if (key === 'ariaLabel') {
                element.setAttribute('aria-label', value);
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
        var source = (typeof global.getPracticeRecordsState === 'function')
            ? global.getPracticeRecordsState()
            : global.practiceRecords;
        var records = ensureArray(source).filter(function (record) {
            return record && (record.examId === exam.id || record.title === exam.title);
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
        } catch (_) {}
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

        var metaText = this._formatTimestamp(config.timestamp) + ' · ' + (config.examCount || 0) + ' 个题目';
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
            (function(button, key) {
                button.addEventListener('click', function(event) {
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
                (function(button, key) {
                    button.addEventListener('click', function(event) {
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
        var findActionTarget = function(node) {
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
        if (attributes) {
            Object.keys(attributes).forEach(function (key) {
                var value = attributes[key];
                if (value == null || value === false) {
                    return;
                }
                if (key === 'className') {
                    element.className = value;
                    return;
                }
                if (key === 'dataset' && typeof value === 'object') {
                    Object.keys(value).forEach(function (dataKey) {
                        var dataValue = value[dataKey];
                        if (dataValue != null) {
                            element.dataset[dataKey] = String(dataValue);
                        }
                    });
                    return;
                }
                if (key === 'ariaLabel') {
                    element.setAttribute('aria-label', value);
                    return;
                }
                if (key === 'ariaHidden') {
                    element.setAttribute('aria-hidden', value);
                    return;
                }
                if (key === 'disabled') {
                    element.disabled = !!value;
                    return;
                }
                element.setAttribute(key, value === true ? '' : value);
            });
        }

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

    global.PracticeStats = PracticeStats;
    global.PracticeDashboardView = PracticeDashboardView;
    global.PracticeHistoryRenderer = historyRenderer;
    global.LegacyExamListView = LegacyExamListView;
    global.LibraryConfigView = LibraryConfigView;
    global.LegacyNavigationController = LegacyNavigationController;
    global.ensureLegacyNavigationController = ensureLegacyNavigationController;
})(window);
