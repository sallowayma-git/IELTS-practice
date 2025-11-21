// Global State Management Service
// Extracted from main.js to improve modularity

(function (global) {
    'use strict';

    const legacyStateAdapter = global.LegacyStateAdapter ? global.LegacyStateAdapter.getInstance() : null;
    const localFallbackState = {
        filteredExams: [],
        selectedRecords: new Set(),
        bulkDeleteMode: false
    };

    // Helper: Sync global browse state
    function syncGlobalBrowseState(category, type) {
        const browseDescriptor = Object.getOwnPropertyDescriptor(global, '__browseFilter');
        if (!browseDescriptor || typeof browseDescriptor.set !== 'function') {
            try {
                global.__browseFilter = { category, type };
            } catch (_) { }
        }

        const legacyTypeDescriptor = Object.getOwnPropertyDescriptor(global, '__legacyBrowseType');
        if (!legacyTypeDescriptor || typeof legacyTypeDescriptor.set !== 'function') {
            try { global.__legacyBrowseType = type; } catch (_) { }
        }
    }

    // Resolve State Service
    const stateService = (function resolveStateService() {
        if (global.appStateService && typeof global.appStateService.getExamIndex === 'function') {
            return global.appStateService;
        }
        if (global.AppStateService && typeof global.AppStateService.getInstance === 'function') {
            return global.AppStateService.getInstance({
                legacyAdapter: legacyStateAdapter,
                onBrowseFilterChange: syncGlobalBrowseState
            });
        }
        return null;
    })();

    // --- State Accessors ---

    function getExamIndexState() {
        if (stateService) return stateService.getExamIndex();
        return Array.isArray(global.examIndex) ? global.examIndex : [];
    }

    function setExamIndexState(list) {
        const normalized = Array.isArray(list) ? list.slice() : [];
        assignExamSequenceNumbers(normalized);
        if (stateService) return stateService.setExamIndex(normalized);
        try { global.examIndex = normalized; } catch (_) { }
        return normalized;
    }

    function getPracticeRecordsState() {
        if (stateService) return stateService.getPracticeRecords();
        return Array.isArray(global.practiceRecords) ? global.practiceRecords : [];
    }

    function setPracticeRecordsState(records) {
        let normalized;
        if (stateService) {
            const enriched = Array.isArray(records) ? records.map(enrichPracticeRecordForUI) : [];
            normalized = stateService.setPracticeRecords(enriched);
        } else {
            normalized = Array.isArray(records) ? records.map(enrichPracticeRecordForUI) : [];
            try { global.practiceRecords = normalized; } catch (_) { }
        }
        const finalRecords = Array.isArray(normalized) ? normalized : [];
        if (typeof global.updateBrowseAnchorsFromRecords === 'function') {
            global.updateBrowseAnchorsFromRecords(finalRecords);
        }
        return finalRecords;
    }

    function getFilteredExamsState() {
        if (stateService) return stateService.getFilteredExams();
        return localFallbackState.filteredExams.slice();
    }

    function setFilteredExamsState(exams) {
        if (stateService) return stateService.setFilteredExams(exams);
        localFallbackState.filteredExams = Array.isArray(exams) ? exams.slice() : [];
        return localFallbackState.filteredExams.slice();
    }

    function getBrowseFilterState() {
        if (stateService) return stateService.getBrowseFilter();
        const category = typeof global.__browseFilter?.category === 'string' ? global.__browseFilter.category : 'all';
        const type = typeof global.__browseFilter?.type === 'string' ? global.__browseFilter.type : 'all';
        return { category, type };
    }

    function setBrowseFilterState(category = 'all', type = 'all') {
        const normalized = {
            category: typeof category === 'string' ? category : 'all',
            type: typeof type === 'string' ? type : 'all'
        };
        if (stateService) {
            stateService.setBrowseFilter(normalized);
            const latest = stateService.getBrowseFilter();
            const nextCategory = typeof latest?.category === 'string' ? latest.category : normalized.category;
            const nextType = typeof latest?.type === 'string' ? latest.type : normalized.type;
            if (typeof global.persistBrowseFilter === 'function') {
                global.persistBrowseFilter(nextCategory, nextType);
            }
            return { category: nextCategory, type: nextType };
        }
        syncGlobalBrowseState(normalized.category, normalized.type);
        if (typeof global.persistBrowseFilter === 'function') {
            global.persistBrowseFilter(normalized.category, normalized.type);
        }
        return normalized;
    }

    function getCurrentCategory() {
        return getBrowseFilterState().category || 'all';
    }

    function getCurrentExamType() {
        return getBrowseFilterState().type || 'all';
    }

    function getBulkDeleteModeState() {
        if (stateService) return stateService.getBulkDeleteMode();
        return !!localFallbackState.bulkDeleteMode;
    }

    function setBulkDeleteModeState(value) {
        if (stateService) return stateService.setBulkDeleteMode(value);
        localFallbackState.bulkDeleteMode = !!value;
        return localFallbackState.bulkDeleteMode;
    }

    function clearBulkDeleteModeState() {
        return setBulkDeleteModeState(false);
    }

    function getSelectedRecordsState() {
        if (stateService) return stateService.getSelectedRecords();
        return localFallbackState.selectedRecords;
    }

    function addSelectedRecordState(id) {
        if (stateService) return stateService.addSelectedRecord(id);
        if (id != null) localFallbackState.selectedRecords.add(String(id));
        return getSelectedRecordsState();
    }

    function removeSelectedRecordState(id) {
        if (stateService) return stateService.removeSelectedRecord(id);
        if (id != null) localFallbackState.selectedRecords.delete(String(id));
        return getSelectedRecordsState();
    }

    function clearSelectedRecordsState() {
        if (stateService) return stateService.clearSelectedRecords();
        localFallbackState.selectedRecords.clear();
        return getSelectedRecordsState();
    }

    // --- Helpers ---

    function assignExamSequenceNumbers(exams) {
        if (!Array.isArray(exams)) return exams;
        exams.forEach((exam, index) => {
            if (exam && typeof exam === 'object') {
                exam.sequenceNumber = index + 1;
            }
        });
        return exams;
    }

    function enrichPracticeRecordForUI(record) {
        if (!record || typeof record !== 'object') return record;
        if (global.DataConsistencyManager) {
            try {
                const manager = new global.DataConsistencyManager();
                return manager.enrichRecordData(record);
            } catch (error) {
                console.error('[GlobalStateService] enrichRecordData failed:', error);
            }
        }
        return record;
    }

    // --- Exports ---
    global.getExamIndexState = getExamIndexState;
    global.setExamIndexState = setExamIndexState;
    global.getPracticeRecordsState = getPracticeRecordsState;
    global.setPracticeRecordsState = setPracticeRecordsState;
    global.getFilteredExamsState = getFilteredExamsState;
    global.setFilteredExamsState = setFilteredExamsState;
    global.getBrowseFilterState = getBrowseFilterState;
    global.setBrowseFilterState = setBrowseFilterState;
    global.getCurrentCategory = getCurrentCategory;
    global.getCurrentExamType = getCurrentExamType;
    global.getBulkDeleteModeState = getBulkDeleteModeState;
    global.setBulkDeleteModeState = setBulkDeleteModeState;
    global.clearBulkDeleteModeState = clearBulkDeleteModeState;
    global.getSelectedRecordsState = getSelectedRecordsState;
    global.addSelectedRecordState = addSelectedRecordState;
    global.removeSelectedRecordState = removeSelectedRecordState;
    global.clearSelectedRecordsState = clearSelectedRecordsState;
    global.assignExamSequenceNumbers = assignExamSequenceNumbers;

})(typeof window !== "undefined" ? window : globalThis);
