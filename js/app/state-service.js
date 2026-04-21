(function (global) {
    'use strict';

    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
    }

    function cloneSet(value) {
        if (value instanceof Set) {
            return new Set(value);
        }
        if (Array.isArray(value)) {
            return new Set(value);
        }
        return new Set();
    }

    function cloneCustomSuiteExam(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        return {
            examId: typeof value.examId === 'string'
                ? value.examId
                : String(value.examId != null ? value.examId : (value.id == null ? '' : value.id)),
            title: typeof value.title === 'string' ? value.title : '',
            category: typeof value.category === 'string' ? value.category : '',
            frequency: typeof value.frequency === 'string' ? value.frequency : '',
            type: typeof value.type === 'string' ? value.type : '',
            hasHtml: value.hasHtml === true
        };
    }

    function getCustomSuiteCategories(value) {
        const categories = value && Array.isArray(value.categories) && value.categories.length
            ? value.categories.slice()
            : ['P1', 'P2', 'P3'];
        return categories.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean);
    }

    function normalizeCustomSuiteDraft(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }

        const categories = getCustomSuiteCategories(value);
        const rawPickedByCategory = value.pickedByCategory && typeof value.pickedByCategory === 'object'
            ? value.pickedByCategory
            : {};
        const pickedByCategory = {};
        const pickedOrder = [];

        categories.forEach((category) => {
            const exam = cloneCustomSuiteExam(rawPickedByCategory[category]);
            if (exam && exam.examId) {
                exam.category = category;
                pickedByCategory[category] = exam;
            }
        });

        let stageIndex = 0;
        for (let i = 0; i < categories.length; i += 1) {
            const category = categories[i];
            const exam = pickedByCategory[category];
            if (!exam) {
                break;
            }
            pickedOrder.push(exam);
            stageIndex = i + 1;
        }

        const rawStatus = typeof value.status === 'string' ? value.status.trim().toLowerCase() : 'selecting';
        const status = stageIndex >= categories.length
            ? 'ready'
            : (rawStatus && rawStatus !== 'ready' ? rawStatus : 'selecting');

        return {
            status,
            stageIndex,
            categories,
            pickedByCategory,
            pickedOrder,
            flowMode: typeof value.flowMode === 'string' && value.flowMode ? value.flowMode : 'classic',
            frequencyScope: typeof value.frequencyScope === 'string' && value.frequencyScope ? value.frequencyScope : 'custom',
            createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
            updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now()
        };
    }

    function normalizeFilter(value) {
        if (!value || typeof value !== 'object') {
            return { category: 'all', type: 'all' };
        }
        return {
            category: typeof value.category === 'string' ? value.category : 'all',
            type: typeof value.type === 'string' ? value.type : 'all'
        };
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

    function defineGlobalProperty(globalRef, key, descriptor) {
        try {
            Object.defineProperty(globalRef, key, Object.assign({
                configurable: true,
                enumerable: true
            }, descriptor || {}));
        } catch (error) {
            console.warn('[AppStateService] defineProperty failed:', key, error);
        }
    }

    function enrichPracticeRecordForUI(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        if (global.DataConsistencyManager) {
            try {
                const manager = new global.DataConsistencyManager();
                return manager.enrichRecordData(record);
            } catch (error) {
                console.warn('[AppStateService] enrichPracticeRecordForUI failed:', error);
            }
        }
        return record;
    }

    function assignExamSequenceNumbers(exams) {
        if (!Array.isArray(exams)) {
            return [];
        }
        exams.forEach((exam, index) => {
            if (exam && typeof exam === 'object') {
                exam.sequenceNumber = index + 1;
            }
        });
        return exams;
    }

    class AppStateService {
        constructor(options = {}) {
            this.options = Object.assign({
                onBrowseFilterChange: null
            }, options || {});

            this.app = null;
            this.globalRef = global;
            this.globalBindingsInstalled = false;

            this.state = {
                examIndex: cloneArray(global.examIndex),
                practiceRecords: cloneArray(global.practiceRecords),
                filteredExams: Array.isArray(global.filteredExams) ? global.filteredExams : [],
                browseFilter: normalizeFilter(global.__browseFilter),
                bulkDeleteMode: !!global.bulkDeleteMode,
                selectedRecords: cloneSet(global.selectedRecords),
                customSuiteDraft: normalizeCustomSuiteDraft(global.customSuiteDraft),
                processedSessions: global.processedSessions instanceof Set ? global.processedSessions : new Set(),
                fallbackExamSessions: global.fallbackExamSessions instanceof Map ? global.fallbackExamSessions : new Map()
            };

            this.listeners = {
                examIndex: new Set(),
                practiceRecords: new Set(),
                filteredExams: new Set(),
                browseFilter: new Set(),
                bulkDeleteMode: new Set(),
                selectedRecords: new Set(),
                customSuiteDraft: new Set(),
                processedSessions: new Set(),
                fallbackExamSessions: new Set()
            };
        }

        configure(options = {}) {
            if (!options || typeof options !== 'object') {
                return this;
            }
            this.options = Object.assign({}, this.options, options);
            return this;
        }

        subscribe(topic, handler) {
            if (!this.listeners[topic] || typeof handler !== 'function') {
                return function noop() {};
            }
            this.listeners[topic].add(handler);
            return () => this.listeners[topic].delete(handler);
        }

        connectApp(appInstance) {
            if (!appInstance || typeof appInstance !== 'object') {
                return this;
            }

            this.app = appInstance;

            if (!appInstance.__appStateServiceWrapped && typeof appInstance.setState === 'function') {
                const originalSetState = appInstance.setState.bind(appInstance);
                appInstance.setState = (path, value) => {
                    const result = originalSetState(path, value);
                    this.syncFromAppPath(path, value);
                    return result;
                };
                appInstance.__appStateServiceWrapped = true;
            }

            this.applyToApp();
            return this;
        }

        applyToApp() {
            const app = this.app;
            if (!app || !app.state) {
                return;
            }

            try {
                if (app.state.exam) {
                    app.state.exam.index = this.state.examIndex;
                    app.state.exam.currentCategory = this.state.browseFilter.category;
                    app.state.exam.currentExamType = this.state.browseFilter.type;
                    app.state.exam.filteredExams = this.state.filteredExams;
                }
                if (app.state.practice) {
                    app.state.practice.records = this.state.practiceRecords;
                    app.state.practice.selectedRecords = this.state.selectedRecords;
                    app.state.practice.bulkDeleteMode = this.state.bulkDeleteMode;
                }
                if (app.state.ui) {
                    app.state.ui.browseFilter = this.state.browseFilter;
                    app.state.ui.legacyBrowseType = this.state.browseFilter.type;
                    app.state.ui.customSuiteDraft = this.state.customSuiteDraft;
                }
                if (app.state.system) {
                    app.state.system.processedSessions = this.state.processedSessions;
                    app.state.system.fallbackExamSessions = this.state.fallbackExamSessions;
                }
            } catch (error) {
                console.warn('[AppStateService] applyToApp failed:', error);
            }
        }

        syncFromAppPath(path, value) {
            switch (path) {
                case 'exam.index':
                    this.setExamIndex(value, { syncApp: false });
                    break;
                case 'practice.records':
                    this.setPracticeRecords(value, { syncApp: false });
                    break;
                case 'exam.filteredExams':
                    this.setFilteredExams(value, { syncApp: false });
                    break;
                case 'ui.browseFilter':
                    this.setBrowseFilter(value, { syncApp: false });
                    break;
                case 'exam.currentCategory':
                    this.setBrowseFilter({
                        category: typeof value === 'string' ? value : this.state.browseFilter.category,
                        type: this.state.browseFilter.type
                    }, { syncApp: false });
                    break;
                case 'exam.currentExamType':
                case 'ui.legacyBrowseType':
                    this.setBrowseFilter({
                        category: this.state.browseFilter.category,
                        type: typeof value === 'string' ? value : this.state.browseFilter.type
                    }, { syncApp: false });
                    break;
                case 'ui.customSuiteDraft':
                    this.setCustomSuiteDraft(value, { syncApp: false });
                    break;
                case 'practice.bulkDeleteMode':
                    this.setBulkDeleteMode(value, { syncApp: false });
                    break;
                case 'practice.selectedRecords':
                    this.setSelectedRecords(value, { syncApp: false });
                    break;
                case 'system.processedSessions':
                    this.setProcessedSessions(value, { syncApp: false });
                    break;
                case 'system.fallbackExamSessions':
                    this.setFallbackExamSessions(value, { syncApp: false });
                    break;
                default:
                    break;
            }
        }

        getExamIndex() {
            return this.state.examIndex;
        }

        setExamIndex(list, options = {}) {
            const normalized = assignExamSequenceNumbers(cloneArray(list));
            this.state.examIndex = normalized;
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'examIndex', this.state.examIndex);
            return this.state.examIndex;
        }

        getPracticeRecords() {
            return this.state.practiceRecords;
        }

        setPracticeRecords(records, options = {}) {
            const normalized = Array.isArray(records) ? records.map(enrichPracticeRecordForUI) : [];
            this.state.practiceRecords = normalized;
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'practiceRecords', this.state.practiceRecords);
            if (typeof global.updateBrowseAnchorsFromRecords === 'function') {
                try {
                    global.updateBrowseAnchorsFromRecords(this.state.practiceRecords);
                } catch (error) {
                    console.warn('[AppStateService] updateBrowseAnchorsFromRecords failed:', error);
                }
            }
            return this.state.practiceRecords;
        }

        getFilteredExams() {
            return this.state.filteredExams;
        }

        setFilteredExams(exams, options = {}) {
            this.state.filteredExams = cloneArray(exams);
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'filteredExams', this.state.filteredExams);
            return this.state.filteredExams;
        }

        getBrowseFilter() {
            return this.state.browseFilter;
        }

        setBrowseFilter(filter, options = {}) {
            this.state.browseFilter = normalizeFilter(filter);
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'browseFilter', this.state.browseFilter);
            if (typeof global.persistBrowseFilter === 'function') {
                try {
                    global.persistBrowseFilter(this.state.browseFilter.category, this.state.browseFilter.type);
                } catch (error) {
                    console.warn('[AppStateService] persistBrowseFilter failed:', error);
                }
            }
            if (typeof this.options.onBrowseFilterChange === 'function') {
                try {
                    this.options.onBrowseFilterChange(this.state.browseFilter.category, this.state.browseFilter.type);
                } catch (error) {
                    console.warn('[AppStateService] onBrowseFilterChange failed:', error);
                }
            }
            return this.state.browseFilter;
        }

        getBulkDeleteMode() {
            return !!this.state.bulkDeleteMode;
        }

        setBulkDeleteMode(value, options = {}) {
            this.state.bulkDeleteMode = !!value;
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'bulkDeleteMode', this.state.bulkDeleteMode);
            return this.state.bulkDeleteMode;
        }

        clearBulkDeleteMode() {
            return this.setBulkDeleteMode(false);
        }

        getSelectedRecords() {
            return this.state.selectedRecords;
        }

        setSelectedRecords(records, options = {}) {
            this.state.selectedRecords = cloneSet(records);
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'selectedRecords', this.state.selectedRecords);
            return this.state.selectedRecords;
        }

        addSelectedRecord(id) {
            if (id != null) {
                this.state.selectedRecords.add(String(id));
                this.applyToApp();
                emit(this.listeners, 'selectedRecords', this.state.selectedRecords);
            }
            return this.state.selectedRecords;
        }

        removeSelectedRecord(id) {
            if (id != null) {
                this.state.selectedRecords.delete(String(id));
                this.applyToApp();
                emit(this.listeners, 'selectedRecords', this.state.selectedRecords);
            }
            return this.state.selectedRecords;
        }

        clearSelectedRecords() {
            this.state.selectedRecords.clear();
            this.applyToApp();
            emit(this.listeners, 'selectedRecords', this.state.selectedRecords);
            return this.state.selectedRecords;
        }

        getCustomSuiteDraft() {
            return this.state.customSuiteDraft;
        }

        setCustomSuiteDraft(draft, options = {}) {
            this.state.customSuiteDraft = normalizeCustomSuiteDraft(draft);
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'customSuiteDraft', this.state.customSuiteDraft);
            return this.state.customSuiteDraft;
        }

        updateCustomSuiteDraft(updater, options = {}) {
            const current = this.state.customSuiteDraft
                ? normalizeCustomSuiteDraft(this.state.customSuiteDraft)
                : null;
            const next = typeof updater === 'function'
                ? updater(current)
                : current;
            return this.setCustomSuiteDraft(next, options);
        }

        clearCustomSuiteDraft(options = {}) {
            this.state.customSuiteDraft = null;
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'customSuiteDraft', this.state.customSuiteDraft);
            return this.state.customSuiteDraft;
        }

        selectCustomSuiteExam(exam, options = {}) {
            if (!exam || typeof exam !== 'object') {
                return this.state.customSuiteDraft;
            }

            const normalizedExam = cloneCustomSuiteExam(exam);
            if (!normalizedExam || !normalizedExam.examId) {
                return this.state.customSuiteDraft;
            }

            return this.updateCustomSuiteDraft((current) => {
                const next = current ? normalizeCustomSuiteDraft(current) : normalizeCustomSuiteDraft({
                    status: 'selecting',
                    stageIndex: 0,
                    pickedByCategory: {},
                    pickedOrder: [],
                    flowMode: options.flowMode || 'classic',
                    frequencyScope: options.frequencyScope || 'custom'
                });

                if (!next) {
                    return null;
                }

                const categories = getCustomSuiteCategories(next);
                const expectedCategory = categories[Math.min(next.stageIndex, categories.length - 1)];
                const examCategory = typeof normalizedExam.category === 'string' ? normalizedExam.category.trim().toUpperCase() : '';
                if (expectedCategory && examCategory && expectedCategory !== examCategory) {
                    return next;
                }

                normalizedExam.category = expectedCategory || examCategory || normalizedExam.category;
                next.pickedByCategory = Object.assign({}, next.pickedByCategory, {
                    [normalizedExam.category]: normalizedExam
                });
                next.pickedOrder = categories
                    .map((category) => next.pickedByCategory[category])
                    .filter(Boolean);
                next.stageIndex = Math.min(next.pickedOrder.length, categories.length);
                next.status = next.stageIndex >= categories.length ? 'ready' : 'selecting';
                next.flowMode = options.flowMode || next.flowMode || 'classic';
                next.frequencyScope = options.frequencyScope || next.frequencyScope || 'custom';
                next.updatedAt = Date.now();
                return next;
            }, options);
        }

        removeCustomSuiteSelection(category, options = {}) {
            const normalizedCategory = typeof category === 'string' ? category.trim().toUpperCase() : '';
            if (!normalizedCategory || !this.state.customSuiteDraft) {
                return this.state.customSuiteDraft;
            }

            return this.updateCustomSuiteDraft((current) => {
                const next = current ? normalizeCustomSuiteDraft(current) : null;
                if (!next) {
                    return null;
                }
                if (next.pickedByCategory && Object.prototype.hasOwnProperty.call(next.pickedByCategory, normalizedCategory)) {
                    delete next.pickedByCategory[normalizedCategory];
                }
                next.pickedOrder = next.categories
                    .map((entryCategory) => next.pickedByCategory[entryCategory])
                    .filter(Boolean);
                next.stageIndex = Math.min(next.pickedOrder.length, next.categories.length);
                next.status = next.stageIndex >= next.categories.length ? 'ready' : 'selecting';
                next.updatedAt = Date.now();
                return next;
            }, options);
        }

        getProcessedSessions() {
            return this.state.processedSessions;
        }

        setProcessedSessions(value, options = {}) {
            this.state.processedSessions = value instanceof Set ? value : cloneSet(value);
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'processedSessions', this.state.processedSessions);
            return this.state.processedSessions;
        }

        markSessionProcessed(id) {
            if (id != null) {
                this.state.processedSessions.add(String(id));
                this.applyToApp();
                emit(this.listeners, 'processedSessions', this.state.processedSessions);
            }
            return this.state.processedSessions;
        }

        clearProcessedSessions() {
            this.state.processedSessions.clear();
            this.applyToApp();
            emit(this.listeners, 'processedSessions', this.state.processedSessions);
            return this.state.processedSessions;
        }

        getFallbackExamSessions() {
            return this.state.fallbackExamSessions;
        }

        setFallbackExamSessions(map, options = {}) {
            this.state.fallbackExamSessions = map instanceof Map ? map : new Map();
            if (options.syncApp !== false) {
                this.applyToApp();
            }
            emit(this.listeners, 'fallbackExamSessions', this.state.fallbackExamSessions);
            return this.state.fallbackExamSessions;
        }

        clearFallbackExamSessions() {
            this.state.fallbackExamSessions.clear();
            this.applyToApp();
            emit(this.listeners, 'fallbackExamSessions', this.state.fallbackExamSessions);
            return this.state.fallbackExamSessions;
        }

        installGlobalBindings(globalRef) {
            if (!globalRef || this.globalBindingsInstalled) {
                return this;
            }

            const service = this;

            globalRef.getExamIndexState = function getExamIndexState() {
                return service.getExamIndex();
            };
            globalRef.setExamIndexState = function setExamIndexState(list) {
                return service.setExamIndex(list);
            };
            globalRef.getPracticeRecordsState = function getPracticeRecordsState() {
                return service.getPracticeRecords();
            };
            globalRef.setPracticeRecordsState = function setPracticeRecordsState(records) {
                return service.setPracticeRecords(records);
            };
            globalRef.getFilteredExamsState = function getFilteredExamsState() {
                return service.getFilteredExams();
            };
            globalRef.setFilteredExamsState = function setFilteredExamsState(exams) {
                return service.setFilteredExams(exams);
            };
            globalRef.getBrowseFilterState = function getBrowseFilterState() {
                return service.getBrowseFilter();
            };
            globalRef.setBrowseFilterState = function setBrowseFilterState(category, type) {
                return service.setBrowseFilter({ category, type });
            };
            globalRef.getCurrentCategory = function getCurrentCategory() {
                return service.getBrowseFilter().category || 'all';
            };
            globalRef.getCurrentExamType = function getCurrentExamType() {
                return service.getBrowseFilter().type || 'all';
            };
            globalRef.getBulkDeleteModeState = function getBulkDeleteModeState() {
                return service.getBulkDeleteMode();
            };
            globalRef.setBulkDeleteModeState = function setBulkDeleteModeState(value) {
                return service.setBulkDeleteMode(value);
            };
            globalRef.clearBulkDeleteModeState = function clearBulkDeleteModeState() {
                return service.clearBulkDeleteMode();
            };
            globalRef.getSelectedRecordsState = function getSelectedRecordsState() {
                return service.getSelectedRecords();
            };
            globalRef.addSelectedRecordState = function addSelectedRecordState(id) {
                return service.addSelectedRecord(id);
            };
            globalRef.removeSelectedRecordState = function removeSelectedRecordState(id) {
                return service.removeSelectedRecord(id);
            };
            globalRef.clearSelectedRecordsState = function clearSelectedRecordsState() {
                return service.clearSelectedRecords();
            };
            globalRef.getCustomSuiteDraftState = function getCustomSuiteDraftState() {
                return service.getCustomSuiteDraft();
            };
            globalRef.setCustomSuiteDraftState = function setCustomSuiteDraftState(value) {
                return service.setCustomSuiteDraft(value);
            };
            globalRef.updateCustomSuiteDraftState = function updateCustomSuiteDraftState(updater) {
                return service.updateCustomSuiteDraft(updater);
            };
            globalRef.clearCustomSuiteDraftState = function clearCustomSuiteDraftState() {
                return service.clearCustomSuiteDraft();
            };
            globalRef.selectCustomSuiteExamState = function selectCustomSuiteExamState(exam, options) {
                return service.selectCustomSuiteExam(exam, options);
            };
            globalRef.removeCustomSuiteSelectionState = function removeCustomSuiteSelectionState(category, options) {
                return service.removeCustomSuiteSelection(category, options);
            };
            globalRef.assignExamSequenceNumbers = assignExamSequenceNumbers;

            defineGlobalProperty(globalRef, 'examIndex', {
                get: () => service.getExamIndex(),
                set: (value) => service.setExamIndex(value)
            });
            defineGlobalProperty(globalRef, 'practiceRecords', {
                get: () => service.getPracticeRecords(),
                set: (value) => service.setPracticeRecords(value)
            });
            defineGlobalProperty(globalRef, 'filteredExams', {
                get: () => service.getFilteredExams(),
                set: (value) => service.setFilteredExams(value)
            });
            defineGlobalProperty(globalRef, 'bulkDeleteMode', {
                get: () => service.getBulkDeleteMode(),
                set: (value) => service.setBulkDeleteMode(value)
            });
            defineGlobalProperty(globalRef, 'selectedRecords', {
                get: () => service.getSelectedRecords(),
                set: (value) => service.setSelectedRecords(value)
            });
            defineGlobalProperty(globalRef, 'customSuiteDraft', {
                get: () => service.getCustomSuiteDraft(),
                set: (value) => service.setCustomSuiteDraft(value)
            });
            defineGlobalProperty(globalRef, '__browseFilter', {
                get: () => service.getBrowseFilter(),
                set: (value) => service.setBrowseFilter(value)
            });
            defineGlobalProperty(globalRef, 'currentCategory', {
                get: () => service.getBrowseFilter().category || 'all',
                set: (value) => service.setBrowseFilter({
                    category: typeof value === 'string' ? value : 'all',
                    type: service.getBrowseFilter().type || 'all'
                })
            });
            defineGlobalProperty(globalRef, 'currentExamType', {
                get: () => service.getBrowseFilter().type || 'all',
                set: (value) => service.setBrowseFilter({
                    category: service.getBrowseFilter().category || 'all',
                    type: typeof value === 'string' ? value : 'all'
                })
            });
            defineGlobalProperty(globalRef, '__legacyBrowseType', {
                get: () => service.getBrowseFilter().type || 'all',
                set: (value) => service.setBrowseFilter({
                    category: service.getBrowseFilter().category || 'all',
                    type: typeof value === 'string' ? value : 'all'
                })
            });
            defineGlobalProperty(globalRef, 'fallbackExamSessions', {
                get: () => service.getFallbackExamSessions(),
                set: (value) => service.setFallbackExamSessions(value)
            });
            defineGlobalProperty(globalRef, 'processedSessions', {
                get: () => service.getProcessedSessions(),
                set: (value) => service.setProcessedSessions(value)
            });

            this.globalBindingsInstalled = true;
            return this;
        }
    }

    AppStateService.getInstance = function getInstance(options = {}) {
        if (!global.__appStateServiceInstance) {
            global.__appStateServiceInstance = new AppStateService(options);
        } else {
            global.__appStateServiceInstance.configure(options);
        }
        return global.__appStateServiceInstance;
    };

    global.AppStateService = AppStateService;
    global.appStateService = AppStateService.getInstance();
    global.appStateService.installGlobalBindings(global);
})(typeof window !== 'undefined' ? window : globalThis);
