/**
 * Top-bar question-bank quick picker.
 *
 * The picker deliberately searches a snapshot returned by
 * resolveActiveLibraryIndex(). It does not read the browse view's current
 * category/type state, so a search remains global even while Browse is
 * filtered. Navigation still goes through the existing lazy Browse group and
 * app methods, keeping a single source of truth for opening exams and filters.
 */
(function registerQuestionBankQuickPicker(global) {
    'use strict';

    var SELECTORS = {
        trigger: '#question-bank-quick-trigger',
        panel: '#question-bank-quick-picker',
        dialog: '.question-bank-quick-picker__dialog',
        title: '#question-bank-quick-title',
        close: '#question-bank-quick-close',
        search: '#question-bank-quick-search',
        status: '#question-bank-quick-status',
        scopes: '#question-bank-quick-scopes',
        results: '#question-bank-quick-results'
    };
    var ACTION_ATTRIBUTE = 'data-question-bank-action';
    var DEFAULT_RESULT_LIMIT = 20;
    var TYPE_LABELS = {
        reading: '阅读',
        listening: '听力'
    };

    function normalizeSearchText(value) {
        var normalized = value === null || value === undefined ? '' : String(value);
        if (typeof normalized.normalize === 'function') {
            try {
                normalized = normalized.normalize('NFKC');
            } catch (_) { }
        }
        return normalized.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    }

    function normalizeScopeValue(value, fallback) {
        var normalized = value === null || value === undefined ? '' : String(value).trim();
        return normalized || fallback;
    }

    function getTypeLabel(type) {
        var normalized = normalizeScopeValue(type, 'other');
        return TYPE_LABELS[normalized.toLocaleLowerCase()] || normalized;
    }

    function flattenSearchValue(value) {
        if (Array.isArray(value)) {
            return value.join(' ');
        }
        if (value && typeof value === 'object') {
            return Object.keys(value).map(function mapSearchValue(key) {
                return value[key];
            }).join(' ');
        }
        return value;
    }

    function createExamSearchText(exam) {
        if (!exam || typeof exam !== 'object') {
            return '';
        }
        var fields = [
            exam.id,
            exam.examId,
            exam.dataKey,
            exam.title,
            exam.category,
            exam.type,
            getTypeLabel(exam.type),
            exam.frequency,
            exam.path,
            exam.filename,
            exam.pdfFilename,
            exam.sourceKind,
            flattenSearchValue(exam.keywords),
            flattenSearchValue(exam.tags),
            exam.searchText
        ];
        return normalizeSearchText(fields.filter(function filterSearchField(value) {
            return value !== null && value !== undefined && String(value).trim() !== '';
        }).join(' '));
    }

    /**
     * Filter an explicitly supplied active-library snapshot. No global browse
     * state is consulted here; this is the invariant that makes search global.
     */
    function filterExams(exams, query) {
        var source = Array.isArray(exams) ? exams : [];
        var tokens = normalizeSearchText(query).split(' ').filter(Boolean);
        var validExams = source.filter(function filterExam(exam) {
            return !!exam && typeof exam === 'object';
        });
        if (tokens.length === 0) {
            return validExams.slice();
        }
        return validExams.filter(function matchExam(exam) {
            var haystack = createExamSearchText(exam);
            return tokens.every(function matchToken(token) {
                return haystack.indexOf(token) !== -1;
            });
        });
    }

    function compareNatural(left, right) {
        return String(left).localeCompare(String(right), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function compareTypes(left, right) {
        var priority = { reading: 0, listening: 1 };
        var leftKey = String(left).toLocaleLowerCase();
        var rightKey = String(right).toLocaleLowerCase();
        var leftPriority = Object.prototype.hasOwnProperty.call(priority, leftKey)
            ? priority[leftKey]
            : 2;
        var rightPriority = Object.prototype.hasOwnProperty.call(priority, rightKey)
            ? priority[rightKey]
            : 2;
        return leftPriority - rightPriority || compareNatural(left, right);
    }

    /**
     * Derive every Browse-supported type and type/category pair from the
     * active index. The pair key includes type so identically named categories
     * in two sections never collapse into one target. Exams with other types
     * remain available to global search without exposing a scope that Browse
     * cannot represent.
     */
    function deriveScopes(exams) {
        var typeCounts = Object.create(null);
        var categoryCounts = Object.create(null);
        var categoryValues = Object.create(null);

        (Array.isArray(exams) ? exams : []).forEach(function countScope(exam) {
            if (!exam || typeof exam !== 'object') {
                return;
            }
            var type = normalizeScopeValue(exam.type, '').toLocaleLowerCase();
            if (type !== 'reading' && type !== 'listening') {
                return;
            }
            var category = normalizeScopeValue(exam.category, '');
            typeCounts[type] = (typeCounts[type] || 0) + 1;
            if (!category) {
                return;
            }
            var key = type + '\u0000' + category;
            categoryCounts[key] = (categoryCounts[key] || 0) + 1;
            categoryValues[key] = { type: type, category: category };
        });

        var types = Object.keys(typeCounts).sort(compareTypes).map(function mapType(type) {
            return {
                key: type,
                type: type,
                label: getTypeLabel(type),
                count: typeCounts[type]
            };
        });
        var categories = Object.keys(categoryCounts).map(function mapCategory(key) {
            var values = categoryValues[key];
            return {
                key: values.type + '::' + values.category,
                type: values.type,
                category: values.category,
                label: values.category,
                count: categoryCounts[key]
            };
        }).sort(function sortCategory(left, right) {
            return compareTypes(left.type, right.type)
                || compareNatural(left.category, right.category);
        });

        return { types: types, categories: categories };
    }

    function finiteNumber(value, fallback) {
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * Calculate a fixed-position popover location. The result is viewport
     * clamped and flips above the trigger when that side has materially more
     * room.
     */
    function computePanelPosition(triggerRect, panelRect, viewport, options) {
        var opts = options || {};
        var margin = Math.max(0, finiteNumber(opts.margin, 12));
        var gap = Math.max(0, finiteNumber(opts.gap, 8));
        var viewportWidth = Math.max(0, finiteNumber(viewport && viewport.width, 0));
        var viewportHeight = Math.max(0, finiteNumber(viewport && viewport.height, 0));
        var trigger = triggerRect || {};
        var triggerLeft = finiteNumber(trigger.left, margin);
        var triggerRight = finiteNumber(trigger.right, triggerLeft);
        var triggerTop = finiteNumber(trigger.top, margin);
        var triggerBottom = finiteNumber(trigger.bottom, triggerTop);
        var maxWidth = Math.max(0, viewportWidth - margin * 2);
        var panelWidth = Math.min(
            Math.max(0, finiteNumber(panelRect && panelRect.width, Math.min(520, maxWidth))),
            maxWidth
        );
        var panelHeight = Math.max(0, finiteNumber(panelRect && panelRect.height, 420));
        var belowSpace = Math.max(0, viewportHeight - triggerBottom - gap - margin);
        var aboveSpace = Math.max(0, triggerTop - gap - margin);
        var placement = belowSpace >= Math.min(panelHeight, 240) || belowSpace >= aboveSpace
            ? 'bottom'
            : 'top';
        var availableHeight = placement === 'bottom' ? belowSpace : aboveSpace;
        var maxHeight = Math.max(0, availableHeight);
        var visibleHeight = Math.min(panelHeight, maxHeight);
        var top = placement === 'bottom'
            ? triggerBottom + gap
            : triggerTop - gap - visibleHeight;
        var preferredLeft = triggerRight - panelWidth;
        var greatestLeft = Math.max(margin, viewportWidth - margin - panelWidth);
        var left = Math.min(Math.max(preferredLeft, margin), greatestLeft);

        return {
            left: Math.round(left),
            top: Math.round(Math.max(margin, top)),
            maxWidth: Math.round(maxWidth),
            maxHeight: Math.round(maxHeight),
            placement: placement
        };
    }

    function computeAnchorTop(triggerRect, viewport, options) {
        var opts = options || {};
        var gap = Math.max(0, finiteNumber(opts.gap, 10));
        var margin = Math.max(0, finiteNumber(opts.margin, 12));
        var minimumDialogSpace = Math.max(0, finiteNumber(opts.minimumDialogSpace, 240));
        var triggerBottom = finiteNumber(triggerRect && triggerRect.bottom, margin);
        var viewportHeight = Math.max(0, finiteNumber(viewport && viewport.height, 0));
        var greatestTop = Math.max(margin, viewportHeight - minimumDialogSpace - margin);
        return Math.round(Math.min(Math.max(triggerBottom + gap, margin), greatestTop));
    }

    function clearElement(element) {
        if (!element) {
            return;
        }
        if (typeof element.replaceChildren === 'function') {
            element.replaceChildren();
            return;
        }
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function setAttribute(element, name, value) {
        if (element && typeof element.setAttribute === 'function') {
            element.setAttribute(name, String(value));
        }
    }

    function setState(element, state) {
        if (!element) {
            return;
        }
        if (element.dataset) {
            element.dataset.state = state;
        } else {
            setAttribute(element, 'data-state', state);
        }
    }

    function createTextElement(documentRef, tagName, className, text) {
        var element = documentRef.createElement(tagName);
        element.className = className || '';
        element.textContent = text;
        return element;
    }

    function findActionTarget(start, container) {
        var current = start;
        while (current) {
            if (typeof current.getAttribute === 'function' && current.getAttribute(ACTION_ATTRIBUTE)) {
                return !container || current === container || (typeof container.contains === 'function' && container.contains(current))
                    ? current
                    : null;
            }
            if (current === container) {
                break;
            }
            current = current.parentNode;
        }
        return null;
    }

    function QuestionBankQuickPicker(options) {
        var opts = options || {};
        this.global = opts.global || global;
        this.document = opts.document || this.global.document || null;
        this.selectors = Object.assign({}, SELECTORS, opts.selectors || {});
        this.resultLimit = Math.max(1, Number(opts.resultLimit) || DEFAULT_RESULT_LIMIT);
        this.elements = {};
        this.index = [];
        this.scopes = { types: [], categories: [] };
        this.matches = [];
        this.resultElements = [];
        this.activeResultIndex = -1;
        this.isOpen = false;
        this._mounted = false;
        this._loadVersion = 0;
        this._actionVersion = 0;
        this._positionFrame = null;
        this._restoreFocus = null;
        this._actionPending = false;
        this._browseReady = false;
        this._browseLoading = false;
        this._browseLoadError = null;
        this._browsePreloadPromise = null;

        this._onTriggerClick = this._handleTriggerClick.bind(this);
        this._onCloseClick = this._handleCloseClick.bind(this);
        this._onSearchInput = this._handleSearchInput.bind(this);
        this._onSearchKeydown = this._handleSearchKeydown.bind(this);
        this._onScopesClick = this._handleScopesClick.bind(this);
        this._onResultsClick = this._handleResultsClick.bind(this);
        this._onResultsKeydown = this._handleResultsKeydown.bind(this);
        this._onDocumentPointerDown = this._handleDocumentPointerDown.bind(this);
        this._onDocumentKeydown = this._handleDocumentKeydown.bind(this);
        this._onViewportChange = this._handleViewportChange.bind(this);
    }

    QuestionBankQuickPicker.prototype._query = function query(selector) {
        return this.document && typeof this.document.querySelector === 'function'
            ? this.document.querySelector(selector)
            : null;
    };

    QuestionBankQuickPicker.prototype.mount = function mount() {
        if (this._mounted) {
            return true;
        }
        if (!this.document) {
            return false;
        }
        this.elements = {
            trigger: this._query(this.selectors.trigger),
            panel: this._query(this.selectors.panel),
            dialog: this._query(this.selectors.dialog),
            title: this._query(this.selectors.title),
            close: this._query(this.selectors.close),
            search: this._query(this.selectors.search),
            status: this._query(this.selectors.status),
            scopes: this._query(this.selectors.scopes),
            results: this._query(this.selectors.results)
        };
        var required = ['trigger', 'panel', 'dialog', 'close', 'search', 'status', 'scopes', 'results'];
        if (required.some(function missingElement(name) { return !this.elements[name]; }, this)) {
            return false;
        }

        this.elements.trigger.addEventListener('click', this._onTriggerClick);
        this.elements.close.addEventListener('click', this._onCloseClick);
        this.elements.search.addEventListener('input', this._onSearchInput);
        this.elements.search.addEventListener('keydown', this._onSearchKeydown);
        this.elements.scopes.addEventListener('click', this._onScopesClick);
        this.elements.results.addEventListener('click', this._onResultsClick);
        this.elements.results.addEventListener('keydown', this._onResultsKeydown);
        this.document.addEventListener('pointerdown', this._onDocumentPointerDown);
        this.document.addEventListener('keydown', this._onDocumentKeydown);
        if (typeof this.global.addEventListener === 'function') {
            this.global.addEventListener('resize', this._onViewportChange);
            this.global.addEventListener('scroll', this._onViewportChange, true);
        }

        setAttribute(this.elements.trigger, 'aria-expanded', 'false');
        setAttribute(this.elements.search, 'aria-expanded', 'false');
        this.elements.panel.hidden = true;
        this._mounted = true;
        return true;
    };

    QuestionBankQuickPicker.prototype.destroy = function destroy() {
        if (!this._mounted) {
            return;
        }
        this.close({ restoreFocus: false });
        this.elements.trigger.removeEventListener('click', this._onTriggerClick);
        this.elements.close.removeEventListener('click', this._onCloseClick);
        this.elements.search.removeEventListener('input', this._onSearchInput);
        this.elements.search.removeEventListener('keydown', this._onSearchKeydown);
        this.elements.scopes.removeEventListener('click', this._onScopesClick);
        this.elements.results.removeEventListener('click', this._onResultsClick);
        this.elements.results.removeEventListener('keydown', this._onResultsKeydown);
        this.document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        this.document.removeEventListener('keydown', this._onDocumentKeydown);
        if (typeof this.global.removeEventListener === 'function') {
            this.global.removeEventListener('resize', this._onViewportChange);
            this.global.removeEventListener('scroll', this._onViewportChange, true);
        }
        this._mounted = false;
    };

    QuestionBankQuickPicker.prototype._handleTriggerClick = function handleTriggerClick(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        this.toggle();
    };

    QuestionBankQuickPicker.prototype._handleCloseClick = function handleCloseClick(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        this.close();
    };

    QuestionBankQuickPicker.prototype._handleSearchInput = function handleSearchInput() {
        this.renderResults(this.elements.search.value);
    };

    QuestionBankQuickPicker.prototype._handleSearchKeydown = function handleSearchKeydown(event) {
        if (event && (event.isComposing || event.keyCode === 229)) {
            return;
        }
        if (!event || this.elements.results.hidden) {
            return;
        }
        var nextIndex = this.activeResultIndex;
        if (event.key === 'ArrowDown') {
            nextIndex = nextIndex < 0 ? 0 : nextIndex + 1;
        } else if (event.key === 'ArrowUp') {
            nextIndex = nextIndex < 0 ? this.resultElements.length - 1 : nextIndex - 1;
        } else if (event.key === 'Enter' && this.activeResultIndex >= 0) {
            event.preventDefault();
            this.openExam(this.resultElements[this.activeResultIndex].getAttribute('data-exam-id'));
            return;
        } else {
            return;
        }
        event.preventDefault();
        this._setActiveResult(nextIndex, false);
    };

    QuestionBankQuickPicker.prototype._handleScopesClick = function handleScopesClick(event) {
        var target = findActionTarget(event && event.target, this.elements.scopes);
        if (!target || target.getAttribute(ACTION_ATTRIBUTE) !== 'browse-scope') {
            return;
        }
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        this.browseScope(target.getAttribute('data-type'), target.getAttribute('data-category'));
    };

    QuestionBankQuickPicker.prototype._handleResultsClick = function handleResultsClick(event) {
        var target = findActionTarget(event && event.target, this.elements.results);
        if (!target || target.getAttribute(ACTION_ATTRIBUTE) !== 'open-exam') {
            return;
        }
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        this.openExam(target.getAttribute('data-exam-id'));
    };

    QuestionBankQuickPicker.prototype._handleResultsKeydown = function handleResultsKeydown(event) {
        if (!event || this.resultElements.length === 0) {
            return;
        }
        var currentIndex = this.resultElements.indexOf(event.target);
        if (currentIndex < 0) {
            return;
        }
        var nextIndex = currentIndex;
        if (event.key === 'ArrowDown') {
            nextIndex = currentIndex + 1;
        } else if (event.key === 'ArrowUp') {
            nextIndex = currentIndex - 1;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = this.resultElements.length - 1;
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.openExam(event.target.getAttribute('data-exam-id'));
            return;
        } else {
            return;
        }
        event.preventDefault();
        this._setActiveResult(nextIndex, true);
    };

    QuestionBankQuickPicker.prototype._setActiveResult = function setActiveResult(index, moveFocus) {
        if (this.resultElements.length === 0) {
            this.activeResultIndex = -1;
            if (typeof this.elements.search.removeAttribute === 'function') {
                this.elements.search.removeAttribute('aria-activedescendant');
            }
            return;
        }
        var length = this.resultElements.length;
        var safeIndex = ((index % length) + length) % length;
        this.activeResultIndex = safeIndex;
        this.resultElements.forEach(function updateSelected(element, elementIndex) {
            setAttribute(element, 'aria-selected', elementIndex === safeIndex ? 'true' : 'false');
        });
        var active = this.resultElements[safeIndex];
        setAttribute(this.elements.search, 'aria-activedescendant', active.id);
        if (typeof active.scrollIntoView === 'function') {
            try {
                active.scrollIntoView({ block: 'nearest' });
            } catch (_) { }
        }
        if (moveFocus && typeof active.focus === 'function') {
            active.focus();
        }
    };

    QuestionBankQuickPicker.prototype._handleDocumentPointerDown = function handleDocumentPointerDown(event) {
        if (!this.isOpen) {
            return;
        }
        var target = event && event.target;
        var insideDialog = target && typeof this.elements.dialog.contains === 'function'
            ? this.elements.dialog.contains(target)
            : target === this.elements.dialog;
        var insideTrigger = target && typeof this.elements.trigger.contains === 'function'
            ? this.elements.trigger.contains(target)
            : target === this.elements.trigger;
        if (!insideDialog && !insideTrigger) {
            this.close();
        }
    };

    QuestionBankQuickPicker.prototype._handleDocumentKeydown = function handleDocumentKeydown(event) {
        if (!this.isOpen || !event) {
            return;
        }
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        if (event.key === 'Escape') {
            if (typeof event.preventDefault === 'function') {
                event.preventDefault();
            }
            this.close();
            return;
        }
        if (event.key === 'Tab') {
            this._trapFocus(event);
        }
    };

    QuestionBankQuickPicker.prototype._trapFocus = function trapFocus(event) {
        if (!this.elements.dialog || typeof this.elements.dialog.querySelectorAll !== 'function') {
            return;
        }
        var candidates = Array.prototype.slice.call(this.elements.dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        ) || []).filter(function visibleCandidate(element) {
            return !element.hidden;
        });
        if (candidates.length === 0) {
            return;
        }
        var first = candidates[0];
        var last = candidates[candidates.length - 1];
        var active = this.document.activeElement;
        if (event.shiftKey && (active === first || !this.elements.dialog.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !this.elements.dialog.contains(active))) {
            event.preventDefault();
            first.focus();
        }
    };

    QuestionBankQuickPicker.prototype._handleViewportChange = function handleViewportChange() {
        if (!this.isOpen || this._positionFrame !== null) {
            return;
        }
        var self = this;
        var schedule = typeof this.global.requestAnimationFrame === 'function'
            ? this.global.requestAnimationFrame.bind(this.global)
            : function fallbackFrame(callback) { return setTimeout(callback, 0); };
        this._positionFrame = schedule(function repositionPicker() {
            self._positionFrame = null;
            if (self.isOpen) {
                self.position();
            }
        });
    };

    QuestionBankQuickPicker.prototype.toggle = function toggle() {
        if (this.isOpen) {
            this.close();
            return Promise.resolve(false);
        }
        return this.open();
    };

    QuestionBankQuickPicker.prototype.open = function open() {
        if (!this.mount()) {
            return Promise.resolve(false);
        }
        this._restoreFocus = this.document.activeElement || this.elements.trigger;
        this.isOpen = true;
        this.elements.panel.hidden = false;
        setAttribute(this.elements.trigger, 'aria-expanded', 'true');
        this.position();
        this._renderLoading();
        var browseReady = this._preloadBrowseGroup();
        if (typeof this.elements.search.focus === 'function') {
            this.elements.search.focus();
        }
        return Promise.all([this.refresh(), browseReady]).then(function opened() {
            return true;
        });
    };

    QuestionBankQuickPicker.prototype.close = function close(options) {
        if (!this._mounted) {
            return;
        }
        var opts = options || {};
        this.isOpen = false;
        this._loadVersion += 1;
        this._actionVersion += 1;
        this._actionPending = false;
        this.elements.panel.hidden = true;
        setAttribute(this.elements.trigger, 'aria-expanded', 'false');
        setAttribute(this.elements.search, 'aria-expanded', 'false');
        if (typeof this.elements.search.removeAttribute === 'function') {
            this.elements.search.removeAttribute('aria-activedescendant');
        }
        if (opts.restoreFocus !== false) {
            var focusTarget = this._restoreFocus && typeof this._restoreFocus.focus === 'function'
                ? this._restoreFocus
                : this.elements.trigger;
            if (focusTarget && typeof focusTarget.focus === 'function') {
                focusTarget.focus();
            }
        }
        this._restoreFocus = null;
    };

    QuestionBankQuickPicker.prototype.position = function position() {
        if (!this.isOpen || !this.elements.trigger || !this.elements.panel) {
            return null;
        }
        var triggerRect = typeof this.elements.trigger.getBoundingClientRect === 'function'
            ? this.elements.trigger.getBoundingClientRect()
            : {};
        var viewport = {
            width: finiteNumber(this.global.innerWidth, this.document.documentElement && this.document.documentElement.clientWidth || 0),
            height: finiteNumber(this.global.innerHeight, this.document.documentElement && this.document.documentElement.clientHeight || 0)
        };
        var anchorTop = computeAnchorTop(triggerRect, viewport);
        var style = this.elements.panel.style || {};
        if (viewport.width <= 768) {
            if (typeof style.removeProperty === 'function') {
                style.removeProperty('--question-bank-quick-anchor-top');
            } else {
                style['--question-bank-quick-anchor-top'] = '';
            }
            return { anchorTop: null };
        }
        if (typeof style.setProperty === 'function') {
            style.setProperty('--question-bank-quick-anchor-top', anchorTop + 'px');
        } else {
            style['--question-bank-quick-anchor-top'] = anchorTop + 'px';
        }
        return { anchorTop: anchorTop };
    };

    QuestionBankQuickPicker.prototype.refresh = function refresh() {
        var resolver = this.global.resolveActiveLibraryIndex;
        var version = ++this._loadVersion;
        var self = this;
        this._renderLoading();
        if (typeof resolver !== 'function') {
            this._renderError(new Error('resolveActiveLibraryIndex is unavailable'));
            return Promise.resolve([]);
        }
        return Promise.resolve().then(function resolveIndex() {
            return resolver.call(self.global);
        }).then(function indexResolved(index) {
            if (!self.isOpen || version !== self._loadVersion) {
                return [];
            }
            self.index = Array.isArray(index) ? index.slice() : [];
            self.scopes = deriveScopes(self.index);
            self.renderScopes();
            self.renderResults(self.elements.search.value);
            self._syncBrowseActionAvailability();
            if (self._browseLoadError) {
                self._setStatus('题库功能加载失败，请关闭后重试。', 'error');
            } else if (self._browseLoading) {
                self._setStatus('题库功能正在加载，搜索结果将在加载完成后可打开。', 'loading');
            }
            self.position();
            return self.index;
        }).catch(function indexFailed(error) {
            if (self.isOpen && version === self._loadVersion) {
                self._renderError(error);
            }
            return [];
        });
    };

    QuestionBankQuickPicker.prototype._setStatus = function setStatusText(text, state) {
        this.elements.status.textContent = text;
        setState(this.elements.status, state || 'ready');
    };

    QuestionBankQuickPicker.prototype._setBrowseAwareStatus = function setBrowseAwareStatus(text, state) {
        if (this._browseLoadError) {
            this._setStatus('题库功能加载失败，请关闭后重试。', 'error');
            return;
        }
        if (this._browseLoading) {
            this._setStatus('题库功能正在加载，搜索结果将在加载完成后可打开。', 'loading');
            return;
        }
        this._setStatus(text, state);
    };

    QuestionBankQuickPicker.prototype._renderLoading = function renderLoading() {
        // A reopened picker may be resolving a different active library. Drop
        // the previous snapshot immediately so input events during that wait
        // cannot reveal or launch stale results.
        this.index = [];
        this.scopes = { types: [], categories: [] };
        this.matches = [];
        this._setStatus('正在读取当前活动题库…', 'loading');
        setAttribute(this.elements.scopes, 'aria-busy', 'true');
        clearElement(this.elements.scopes);
        this.elements.scopes.appendChild(createTextElement(
            this.document,
            'p',
            'question-bank-quick-picker__placeholder',
            '正在读取题目分类…'
        ));
        clearElement(this.elements.results);
        this.resultElements = [];
        this.activeResultIndex = -1;
        this.elements.results.hidden = true;
        setAttribute(this.elements.search, 'aria-expanded', 'false');
        if (typeof this.elements.search.removeAttribute === 'function') {
            this.elements.search.removeAttribute('aria-activedescendant');
        }
    };

    QuestionBankQuickPicker.prototype._renderError = function renderError(error) {
        this.index = [];
        this.matches = [];
        this._setStatus('无法读取当前活动题库，请稍后重试。', 'error');
        setAttribute(this.elements.scopes, 'aria-busy', 'false');
        clearElement(this.elements.scopes);
        this.elements.scopes.appendChild(createTextElement(
            this.document,
            'p',
            'question-bank-quick-picker__placeholder question-bank-quick-picker__placeholder--error',
            '题库分类加载失败。'
        ));
        clearElement(this.elements.results);
        this.resultElements = [];
        this.activeResultIndex = -1;
        this.elements.results.hidden = true;
        setAttribute(this.elements.search, 'aria-expanded', 'false');
        if (this.global.console && typeof this.global.console.warn === 'function') {
            this.global.console.warn('[QuestionBankQuickPicker] Failed to load active index:', error);
        }
    };

    QuestionBankQuickPicker.prototype._createScopeButton = function createScopeButton(type, category, label, count) {
        var button = this.document.createElement('button');
        button.type = 'button';
        button.className = 'question-bank-quick-picker__scope question-bank-quick-scope';
        button.disabled = !this._browseReady;
        setAttribute(button, ACTION_ATTRIBUTE, 'browse-scope');
        setAttribute(button, 'data-type', type);
        setAttribute(button, 'data-category', category);
        button.appendChild(createTextElement(
            this.document,
            'span',
            'question-bank-quick-picker__scope-label',
            label
        ));
        button.appendChild(createTextElement(
            this.document,
            'span',
            'question-bank-quick-picker__scope-count',
            String(count)
        ));
        return button;
    };

    QuestionBankQuickPicker.prototype.renderScopes = function renderScopes() {
        clearElement(this.elements.scopes);
        setAttribute(this.elements.scopes, 'aria-busy', 'false');
        if (this.index.length === 0) {
            this.elements.scopes.appendChild(createTextElement(
                this.document,
                'p',
                'question-bank-quick-picker__placeholder',
                '当前活动题库没有可用题目。'
            ));
            this._setStatus('当前活动题库没有可用题目。', 'empty');
            return;
        }

        this.elements.scopes.appendChild(this._createScopeButton(
            'all',
            'all',
            '全部题目',
            this.index.length
        ));
        var self = this;
        this.scopes.types.forEach(function renderType(typeScope) {
            self.elements.scopes.appendChild(self._createScopeButton(
                typeScope.type,
                'all',
                '全部' + typeScope.label,
                typeScope.count
            ));
            self.scopes.categories.filter(function inType(categoryScope) {
                return categoryScope.type === typeScope.type;
            }).forEach(function renderCategory(categoryScope) {
                self.elements.scopes.appendChild(self._createScopeButton(
                    categoryScope.type,
                    categoryScope.category,
                    typeScope.label + ' · ' + categoryScope.label,
                    categoryScope.count
                ));
            });
        });
    };

    QuestionBankQuickPicker.prototype._createResultButton = function createResultButton(exam, index) {
        var examId = normalizeScopeValue(exam.id || exam.examId, '');
        var button = this.document.createElement('button');
        button.type = 'button';
        button.className = 'question-bank-quick-picker__result question-bank-quick-result';
        button.disabled = !this._browseReady;
        setAttribute(button, ACTION_ATTRIBUTE, 'open-exam');
        setAttribute(button, 'data-exam-id', examId);
        setAttribute(button, 'role', 'option');
        setAttribute(button, 'aria-selected', 'false');
        button.id = 'question-bank-quick-result-' + String(index) + '-' + examId.replace(/[^A-Za-z0-9_-]+/g, '-');
        button.appendChild(createTextElement(
            this.document,
            'span',
            'question-bank-quick-picker__result-title question-bank-quick-result__title',
            normalizeScopeValue(exam.title, examId || '未命名题目')
        ));
        button.appendChild(createTextElement(
            this.document,
            'span',
            'question-bank-quick-picker__result-meta question-bank-quick-result__meta',
            getTypeLabel(exam.type) + ' · ' + normalizeScopeValue(exam.category, '未分类')
        ));
        return button;
    };

    QuestionBankQuickPicker.prototype.renderResults = function renderResults(query) {
        var normalizedQuery = normalizeSearchText(query);
        clearElement(this.elements.results);
        this.resultElements = [];
        this.activeResultIndex = -1;
        if (typeof this.elements.search.removeAttribute === 'function') {
            this.elements.search.removeAttribute('aria-activedescendant');
        }
        if (this.index.length === 0) {
            this.matches = [];
            this.elements.results.hidden = true;
            setAttribute(this.elements.search, 'aria-expanded', 'false');
            return [];
        }
        if (!normalizedQuery) {
            this.matches = [];
            this.elements.results.hidden = true;
            setAttribute(this.elements.search, 'aria-expanded', 'false');
            this._setBrowseAwareStatus(
                '已加载 ' + this.index.length + ' 道题；选择分类，或输入关键词全局搜索。',
                'ready'
            );
            return [];
        }

        this.matches = filterExams(this.index, normalizedQuery);
        if (this.matches.length === 0) {
            this.elements.results.hidden = true;
            setAttribute(this.elements.search, 'aria-expanded', 'false');
            this._setBrowseAwareStatus('未找到与“' + String(query).trim() + '”匹配的题目。', 'empty');
            return [];
        }

        this.elements.results.hidden = false;
        setAttribute(this.elements.search, 'aria-expanded', 'true');

        var self = this;
        this.matches.slice(0, this.resultLimit).forEach(function renderResult(exam, index) {
            if (exam.id || exam.examId) {
                var result = self._createResultButton(exam, index);
                self.resultElements.push(result);
                self.elements.results.appendChild(result);
            }
        });
        var suffix = this.matches.length > this.resultLimit
            ? '，显示前 ' + this.resultLimit + ' 道'
            : '';
        this._setBrowseAwareStatus('找到 ' + this.matches.length + ' 道匹配题目' + suffix + '。', 'results');
        return this.matches.slice();
    };

    QuestionBankQuickPicker.prototype._ensureBrowseGroup = function ensureBrowseGroupReady() {
        var owner = this.global;
        var loader = this.global.ensureBrowseGroup;
        if (typeof loader !== 'function' && this.global.AppEntry) {
            owner = this.global.AppEntry;
            loader = owner.ensureBrowseGroup;
        }
        if (typeof loader !== 'function') {
            return Promise.reject(new Error('ensureBrowseGroup is unavailable'));
        }
        return Promise.resolve(loader.call(owner));
    };

    QuestionBankQuickPicker.prototype._syncBrowseActionAvailability = function syncBrowseActionAvailability() {
        var disabled = !this._browseReady;
        var containers = [this.elements.scopes, this.elements.results];
        containers.forEach(function updateContainer(container) {
            if (!container || typeof container.querySelectorAll !== 'function') {
                return;
            }
            Array.prototype.slice.call(container.querySelectorAll('[' + ACTION_ATTRIBUTE + ']') || [])
                .forEach(function updateAction(action) {
                    action.disabled = disabled;
                });
        });
        if (this.elements.panel) {
            setAttribute(this.elements.panel, 'aria-busy', this._browseLoading ? 'true' : 'false');
        }
    };

    QuestionBankQuickPicker.prototype._preloadBrowseGroup = function preloadBrowseGroup() {
        if (this._browseReady) {
            this._syncBrowseActionAvailability();
            return Promise.resolve(true);
        }
        if (this._browsePreloadPromise) {
            return this._browsePreloadPromise;
        }

        var self = this;
        var started;
        this._browseLoading = true;
        this._browseLoadError = null;
        this._syncBrowseActionAvailability();
        try {
            // Invoke the loader immediately when the panel opens. Result and
            // scope controls stay disabled until it settles, so their eventual
            // click handlers never spend transient user activation on loading.
            started = this._ensureBrowseGroup();
        } catch (error) {
            started = Promise.reject(error);
        }

        var preload = Promise.resolve(started).then(function browseLoaded() {
            self._browseReady = true;
            self._browseLoading = false;
            self._browseLoadError = null;
            self._syncBrowseActionAvailability();
            if (self.isOpen && self.index.length > 0) {
                self.renderResults(self.elements.search.value);
            }
            return true;
        }).catch(function browseLoadFailed(error) {
            self._browseReady = false;
            self._browseLoading = false;
            self._browseLoadError = error;
            self._syncBrowseActionAvailability();
            if (self.isOpen) {
                self._setStatus('题库功能加载失败，请关闭后重试。', 'error');
            }
            if (self.global.console && typeof self.global.console.warn === 'function') {
                self.global.console.warn('[QuestionBankQuickPicker] Failed to preload Browse:', error);
            }
            return false;
        });
        this._browsePreloadPromise = preload;
        preload.then(function clearPreload() {
            if (self._browsePreloadPromise === preload) {
                self._browsePreloadPromise = null;
            }
        });
        return preload;
    };

    QuestionBankQuickPicker.prototype._clearBrowseSearchState = function clearBrowseSearchState() {
        var manager = this.global.browseStateManager;
        if (manager && typeof manager.clearSearchState === 'function') {
            try {
                manager.clearSearchState();
            } catch (_) { }
        }
        var searchInput = this.document && typeof this.document.getElementById === 'function'
            ? this.document.getElementById('exam-search-input')
            : null;
        if (!searchInput && this.document && typeof this.document.querySelector === 'function') {
            searchInput = this.document.querySelector('.search-input');
        }
        if (searchInput) {
            searchInput.value = '';
        }
        var clearButton = this.document && typeof this.document.getElementById === 'function'
            ? this.document.getElementById('search-clear-btn')
            : null;
        if (clearButton) {
            clearButton.hidden = true;
        }
    };

    QuestionBankQuickPicker.prototype.browseScope = function browseScope(type, category) {
        if (this._actionPending || !this.isOpen || !this._browseReady) {
            if (this.isOpen && !this._browseReady) {
                this._setStatus('题库功能仍在加载，请稍候。', 'loading');
            }
            return Promise.resolve(false);
        }
        var safeType = normalizeScopeValue(type, 'all');
        var safeCategory = normalizeScopeValue(category, 'all');
        var self = this;
        var actionVersion = ++this._actionVersion;
        this._actionPending = true;
        this._setStatus('正在打开题目分类…', 'loading');
        var categoryAction;
        try {
            if (!self.global.app || typeof self.global.app.browseCategory !== 'function') {
                throw new Error('app.browseCategory is unavailable');
            }
            self._clearBrowseSearchState();
            categoryAction = self.global.app.browseCategory(safeCategory, safeType);
        } catch (error) {
            categoryAction = Promise.reject(error);
        }
        return Promise.resolve(categoryAction).then(function categoryOpened() {
            var opened = true;
            if (opened !== true || !self.isOpen || actionVersion !== self._actionVersion) {
                return false;
            }
            self.close();
            return true;
        }).catch(function categoryFailed(error) {
            if (self.isOpen && actionVersion === self._actionVersion) {
                self._setStatus('无法打开该题目分类，请稍后重试。', 'error');
                if (self.global.console && typeof self.global.console.warn === 'function') {
                    self.global.console.warn('[QuestionBankQuickPicker] Failed to browse category:', error);
                }
            }
            return false;
        }).then(function clearPending(result) {
            if (actionVersion === self._actionVersion) {
                self._actionPending = false;
            }
            return result;
        });
    };

    QuestionBankQuickPicker.prototype.openExam = function openExam(examId) {
        var safeExamId = normalizeScopeValue(examId, '');
        if (!safeExamId || this._actionPending || !this.isOpen || !this._browseReady) {
            if (this.isOpen && !this._browseReady) {
                this._setStatus('题库功能仍在加载，请稍候。', 'loading');
            }
            return Promise.resolve(false);
        }
        var self = this;
        var examDefinition = this.index.find(function findExam(exam) {
            return normalizeScopeValue(exam && (exam.id || exam.examId), '') === safeExamId;
        });
        var actionVersion = ++this._actionVersion;
        this._actionPending = true;
        this._setStatus('正在打开题目…', 'loading');
        var examAction;
        try {
            if (!self.global.app || typeof self.global.app.openExam !== 'function') {
                throw new Error('app.openExam is unavailable');
            }
            // Calling app.openExam synchronously preserves the click's transient
            // activation. Supplying the selected snapshot also skips its normal
            // asynchronous index lookup before window.open.
            examAction = self.global.app.openExam(safeExamId, examDefinition
                ? { examDefinition: examDefinition }
                : {});
        } catch (error) {
            examAction = Promise.reject(error);
        }
        return Promise.resolve(examAction).then(function examOpened(launchTarget) {
            // ExamSystemApp.openExam resolves to the opened Window (or a
            // launch-context object when requested) on success, and to
            // undefined/null when the exam cannot be launched.
            var opened = Boolean(launchTarget);
            if (!self.isOpen || actionVersion !== self._actionVersion) {
                return false;
            }
            if (opened !== true) {
                self._setStatus('无法打开该题目，请稍后重试。', 'error');
                return false;
            }
            self.close();
            return true;
        }).catch(function examFailed(error) {
            if (self.isOpen && actionVersion === self._actionVersion) {
                self._setStatus('无法打开该题目，请稍后重试。', 'error');
                if (self.global.console && typeof self.global.console.warn === 'function') {
                    self.global.console.warn('[QuestionBankQuickPicker] Failed to open exam:', error);
                }
            }
            return false;
        }).then(function clearPending(result) {
            if (actionVersion === self._actionVersion) {
                self._actionPending = false;
            }
            return result;
        });
    };

    var singleton = null;
    var api = {
        SELECTORS: Object.assign({}, SELECTORS),
        normalizeSearchText: normalizeSearchText,
        createExamSearchText: createExamSearchText,
        filterExams: filterExams,
        deriveScopes: deriveScopes,
        computePanelPosition: computePanelPosition,
        computeAnchorTop: computeAnchorTop,
        getTypeLabel: getTypeLabel,
        Controller: QuestionBankQuickPicker,
        create: function create(options) {
            return new QuestionBankQuickPicker(options);
        },
        init: function init(options) {
            if (!singleton) {
                singleton = new QuestionBankQuickPicker(options);
            }
            singleton.mount();
            return singleton;
        },
        getInstance: function getInstance() {
            return singleton;
        }
    };

    global.QuestionBankQuickPicker = api;

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', function initQuickPicker() {
                api.init();
            }, { once: true });
        } else {
            api.init();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
