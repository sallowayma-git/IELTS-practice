(function (global) {
    'use strict';

    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
    }

    function normalizeFilter(value) {
        if (!value || typeof value !== 'object') {
            return { category: 'all', type: 'all' };
        }
        const category = typeof value.category === 'string' ? value.category : 'all';
        const type = typeof value.type === 'string' ? value.type : 'all';
        return { category, type };
    }

    function toSet(value) {
        if (value instanceof Set) {
            return new Set(value);
        }
        if (Array.isArray(value)) {
            return new Set(value);
        }
        return new Set();
    }

    function emit(listeners, topic, payload) {
        const handlers = listeners[topic];
        if (!handlers) {
            return;
        }
        handlers.forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.error('[AppStateService] listener error for %s:', topic, error);
            }
        });
    }

    class AppStateService {
        constructor(options = {}) {
            this.options = Object.assign({
                onBrowseFilterChange: null
            }, options || {});

            this.legacyAdapter = this.options.legacyAdapter || (global.LegacyStateAdapter ? global.LegacyStateAdapter.getInstance() : null);

            this.state = {
                examIndex: [],
                practiceRecords: [],
                filteredExams: [],
                browseFilter: { category: 'all', type: 'all' },
                bulkDeleteMode: false,
                selectedRecords: new Set(),
                processedSessions: new Set(),
                fallbackExamSessions: new Map()
            };

            this.listeners = {
                examIndex: new Set(),
                practiceRecords: new Set(),
                filteredExams: new Set(),
                browseFilter: new Set(),
                bulkDeleteMode: new Set(),
                selectedRecords: new Set()
            };

            this.unsubscribeFns = [];

            this.bootstrapFromLegacy();
            this.subscribeToLegacy();
        }

        destroy() {
            this.unsubscribeFns.forEach((fn) => {
                try { fn(); } catch (_) {}
            });
            this.unsubscribeFns = [];
        }

        configure(options = {}) {
            if (!options || typeof options !== 'object') {
                return this;
            }

            const hasLegacyAdapter = Object.prototype.hasOwnProperty.call(options, 'legacyAdapter');
            const nextLegacyAdapter = hasLegacyAdapter
                ? (options.legacyAdapter || null)
                : this.legacyAdapter;

            const nextOptions = Object.assign({}, this.options, options);
            nextOptions.legacyAdapter = nextLegacyAdapter;

            const legacyChanged = nextLegacyAdapter !== this.legacyAdapter;

            this.options = nextOptions;
            this.legacyAdapter = nextLegacyAdapter;

            if (legacyChanged) {
                this.destroy();
                this.bootstrapFromLegacy();
                this.subscribeToLegacy();
            }

            return this;
        }

        subscribe(topic, handler) {
            if (!this.listeners[topic] || typeof handler !== 'function') {
                return () => {};
            }
            this.listeners[topic].add(handler);
            return () => this.listeners[topic].delete(handler);
        }

        getExamIndex() {
            return cloneArray(this.state.examIndex);
        }

        setExamIndex(list, options = {}) {
            const normalized = cloneArray(list);
            let nextValue = normalized;
            if (!options.skipLegacy && this.legacyAdapter && typeof this.legacyAdapter.setExamIndex === 'function') {
                try {
                    nextValue = this.legacyAdapter.setExamIndex(normalized) || normalized;
                } catch (error) {
                    console.warn('[AppStateService] legacy adapter setExamIndex failed:', error);
                    nextValue = normalized;
                }
            }
            this.state.examIndex = cloneArray(nextValue);
            emit(this.listeners, 'examIndex', this.getExamIndex());
            return this.getExamIndex();
        }

        getPracticeRecords() {
            return cloneArray(this.state.practiceRecords);
        }

        setPracticeRecords(records, options = {}) {
            const normalized = cloneArray(records);
            let nextValue = normalized;
            if (!options.skipLegacy && this.legacyAdapter && typeof this.legacyAdapter.setPracticeRecords === 'function') {
                try {
                    nextValue = this.legacyAdapter.setPracticeRecords(normalized) || normalized;
                } catch (error) {
                    console.warn('[AppStateService] legacy adapter setPracticeRecords failed:', error);
                    nextValue = normalized;
                }
            }
            this.state.practiceRecords = cloneArray(nextValue);
            emit(this.listeners, 'practiceRecords', this.getPracticeRecords());
            return this.getPracticeRecords();
        }

        getFilteredExams() {
            return cloneArray(this.state.filteredExams);
        }

        setFilteredExams(exams) {
            this.state.filteredExams = cloneArray(exams);
            emit(this.listeners, 'filteredExams', this.getFilteredExams());
            return this.getFilteredExams();
        }

        getBrowseFilter() {
            return Object.assign({}, this.state.browseFilter);
        }

        setBrowseFilter(filter, options = {}) {
            const normalized = normalizeFilter(filter);
            let nextValue = normalized;
            if (!options.skipLegacy && this.legacyAdapter && typeof this.legacyAdapter.setBrowseFilter === 'function') {
                try {
                    nextValue = this.legacyAdapter.setBrowseFilter(normalized) || normalized;
                } catch (error) {
                    console.warn('[AppStateService] legacy adapter setBrowseFilter failed:', error);
                    nextValue = normalized;
                }
            }
            this.state.browseFilter = normalizeFilter(nextValue);
            emit(this.listeners, 'browseFilter', this.getBrowseFilter());
            if (typeof this.options.onBrowseFilterChange === 'function') {
                try {
                    this.options.onBrowseFilterChange(this.state.browseFilter.category, this.state.browseFilter.type);
                } catch (error) {
                    console.error('[AppStateService] onBrowseFilterChange callback error:', error);
                }
            }
            return this.getBrowseFilter();
        }

        getBulkDeleteMode() {
            return !!this.state.bulkDeleteMode;
        }

        setBulkDeleteMode(value) {
            this.state.bulkDeleteMode = !!value;
            emit(this.listeners, 'bulkDeleteMode', this.getBulkDeleteMode());
            return this.getBulkDeleteMode();
        }

        toggleBulkDeleteMode() {
            return this.setBulkDeleteMode(!this.state.bulkDeleteMode);
        }

        getSelectedRecords() {
            return new Set(this.state.selectedRecords);
        }

        setSelectedRecords(records) {
            this.state.selectedRecords = toSet(records);
            emit(this.listeners, 'selectedRecords', this.getSelectedRecords());
            return this.getSelectedRecords();
        }

        addSelectedRecord(id) {
            if (id == null) {
                return this.getSelectedRecords();
            }
            this.state.selectedRecords.add(String(id));
            emit(this.listeners, 'selectedRecords', this.getSelectedRecords());
            return this.getSelectedRecords();
        }

        removeSelectedRecord(id) {
            if (id == null) {
                return this.getSelectedRecords();
            }
            this.state.selectedRecords.delete(String(id));
            emit(this.listeners, 'selectedRecords', this.getSelectedRecords());
            return this.getSelectedRecords();
        }

        clearSelectedRecords() {
            this.state.selectedRecords.clear();
            emit(this.listeners, 'selectedRecords', this.getSelectedRecords());
            return this.getSelectedRecords();
        }

        getProcessedSessions() {
            return new Set(this.state.processedSessions);
        }

        markSessionProcessed(id) {
            if (id == null) {
                return this.getProcessedSessions();
            }
            this.state.processedSessions.add(String(id));
            return this.getProcessedSessions();
        }

        getFallbackExamSessions() {
            return this.state.fallbackExamSessions;
        }

        setFallbackExamSessions(map) {
            if (map instanceof Map) {
                this.state.fallbackExamSessions = map;
            }
            return this.state.fallbackExamSessions;
        }

        bootstrapFromLegacy() {
            if (this.legacyAdapter) {
                try {
                    this.state.examIndex = cloneArray(this.legacyAdapter.getExamIndex());
                    this.state.practiceRecords = cloneArray(this.legacyAdapter.getPracticeRecords());
                    this.state.browseFilter = normalizeFilter(this.legacyAdapter.getBrowseFilter());
                } catch (error) {
                    console.warn('[AppStateService] unable to bootstrap from legacy adapter:', error);
                }
                return;
            }
            try { this.state.examIndex = cloneArray(global.examIndex); } catch (_) {}
            try { this.state.practiceRecords = cloneArray(global.practiceRecords); } catch (_) {}
            try { this.state.browseFilter = normalizeFilter(global.__browseFilter); } catch (_) {}
        }

        subscribeToLegacy() {
            if (!this.legacyAdapter || typeof this.legacyAdapter.subscribe !== 'function') {
                return;
            }
            this.unsubscribeFns.push(this.legacyAdapter.subscribe('examIndex', (value) => {
                this.setExamIndex(value, { skipLegacy: true });
            }));
            this.unsubscribeFns.push(this.legacyAdapter.subscribe('practiceRecords', (value) => {
                this.setPracticeRecords(value, { skipLegacy: true });
            }));
            this.unsubscribeFns.push(this.legacyAdapter.subscribe('browseFilter', (value) => {
                this.setBrowseFilter(value, { skipLegacy: true });
            }));
        }
    }

    AppStateService.getInstance = function getInstance(options = {}) {
        if (!global.__appStateServiceInstance) {
            global.__appStateServiceInstance = new AppStateService(options);
            return global.__appStateServiceInstance;
        }
        global.__appStateServiceInstance.configure(options);
        return global.__appStateServiceInstance;
    };

    if (typeof global.AppStateService !== 'function') {
        global.AppStateService = AppStateService;
    }
    if (!global.appStateService) {
        const defaultOptions = {
            legacyAdapter: global.LegacyStateAdapter ? global.LegacyStateAdapter.getInstance() : null
        };
        global.appStateService = AppStateService.getInstance(defaultOptions);
    }
})(typeof window !== 'undefined' ? window : this);
