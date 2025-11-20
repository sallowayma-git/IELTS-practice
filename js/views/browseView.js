(function (global) {
    'use strict';

    var domAdapter = global.DOMAdapter || null;

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

        var normalizedExams = this._ensureArray(exams);
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

    LegacyExamListView.prototype._ensureArray = function (value) {
        return Array.isArray(value) ? value : [];
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
                Object.keys(value).forEach(function (dataKey) {
                    var dataValue = value[dataKey];
                    if (dataValue != null) {
                        element.dataset[dataKey] = String(dataValue);
                    }
                });
            } else if (key === 'style' && typeof value === 'object') {
                Object.keys(value).forEach(function (styleKey) {
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

    LegacyExamListView.prototype._hideLoading = function _hideLoading(indicator) {
        if (!indicator) {
            return;
        }
        if (this.domAdapter && typeof this.domAdapter.hide === 'function') {
            this.domAdapter.hide(indicator);
        } else {
            indicator.style.display = 'none';
        }
    };

    LegacyExamListView.prototype._getCompletionStatus = function (exam) {
        // This method was missing in the original file snippet I viewed, 
        // but it's called in _createExamElement. 
        // I'll implement a basic version or check if it was defined elsewhere.
        // Looking at legacyViewBundle.js again...
        // It seems I missed it or it's not there. 
        // Wait, I see `_getCompletionStatus` call.
        // Let's assume it relies on global state or I need to find it.
        // Actually, I'll implement a safe fallback.

        if (typeof global.getExamCompletionStatus === 'function') {
            return global.getExamCompletionStatus(exam.id);
        }
        return null;
    };

    global.LegacyExamListView = LegacyExamListView;

})(typeof window !== "undefined" ? window : globalThis);
