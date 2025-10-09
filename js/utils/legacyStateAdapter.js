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

    function createNotifier() {
        return {
            examIndex: new Set(),
            practiceRecords: new Set(),
            browseFilter: new Set()
        };
    }

    function safeEmit(listeners, topic, payload) {
        const handlers = listeners[topic];
        if (!handlers) {
            return;
        }
        handlers.forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.error('[LegacyStateAdapter] listener error', topic, error);
            }
        });
    }

    function defineFallbackProperty(globalRef, key, getter, setter) {
        const descriptor = Object.getOwnPropertyDescriptor(globalRef, key);
        if (descriptor && descriptor.get && !descriptor.configurable) {
            return;
        }
        Object.defineProperty(globalRef, key, {
            configurable: true,
            get: getter,
            set: setter
        });
    }

    function createAdapter(globalRef) {
        const bridge = globalRef.LegacyStateBridge ? globalRef.LegacyStateBridge.getInstance() : null;
        const listeners = createNotifier();

        let examIndexState = cloneArray(globalRef.examIndex);
        let practiceRecordsState = cloneArray(globalRef.practiceRecords);
        let browseFilterState = normalizeFilter(globalRef.__browseFilter);

        function snapshotArrays() {
            if (bridge) {
                examIndexState = cloneArray(bridge.getExamIndex ? bridge.getExamIndex() : globalRef.examIndex);
                practiceRecordsState = cloneArray(bridge.getPracticeRecords ? bridge.getPracticeRecords() : globalRef.practiceRecords);
                browseFilterState = normalizeFilter(bridge.getBrowseFilter ? bridge.getBrowseFilter() : globalRef.__browseFilter);
            } else {
                examIndexState = cloneArray(globalRef.examIndex);
                practiceRecordsState = cloneArray(globalRef.practiceRecords);
                browseFilterState = normalizeFilter(globalRef.__browseFilter);
            }
        }

        snapshotArrays();

        if (bridge) {
            bridge.on('examIndex', (value) => {
                examIndexState = cloneArray(value);
                safeEmit(listeners, 'examIndex', examIndexState.slice());
            });
            bridge.on('practiceRecords', (value) => {
                practiceRecordsState = cloneArray(value);
                safeEmit(listeners, 'practiceRecords', practiceRecordsState.slice());
            });
            bridge.on('browseFilter', (value) => {
                browseFilterState = normalizeFilter(value);
                safeEmit(listeners, 'browseFilter', Object.assign({}, browseFilterState));
            });
        } else {
            defineFallbackProperty(globalRef, 'examIndex', () => examIndexState, (value) => {
                examIndexState = cloneArray(value);
                safeEmit(listeners, 'examIndex', examIndexState.slice());
            });
            defineFallbackProperty(globalRef, 'practiceRecords', () => practiceRecordsState, (value) => {
                practiceRecordsState = cloneArray(value);
                safeEmit(listeners, 'practiceRecords', practiceRecordsState.slice());
            });
            defineFallbackProperty(globalRef, '__browseFilter', () => browseFilterState, (value) => {
                browseFilterState = normalizeFilter(value);
                safeEmit(listeners, 'browseFilter', Object.assign({}, browseFilterState));
            });
        }

        function subscribe(topic, handler) {
            if (!listeners[topic] || typeof handler !== 'function') {
                return () => {};
            }
            listeners[topic].add(handler);
            return () => listeners[topic].delete(handler);
        }

        function getExamIndex() {
            snapshotArrays();
            return examIndexState.slice();
        }

        function setExamIndex(list, options = {}) {
            const normalized = cloneArray(list);
            if (bridge && typeof bridge.setExamIndex === 'function') {
                bridge.setExamIndex(normalized, options);
                return bridge.getExamIndex ? bridge.getExamIndex() : normalized.slice();
            }
            examIndexState = normalized.slice();
            try { globalRef.examIndex = examIndexState.slice(); } catch (_) {}
            safeEmit(listeners, 'examIndex', examIndexState.slice());
            return examIndexState.slice();
        }

        function getPracticeRecords() {
            snapshotArrays();
            return practiceRecordsState.slice();
        }

        function setPracticeRecords(records, options = {}) {
            const normalized = cloneArray(records);
            if (bridge && typeof bridge.setPracticeRecords === 'function') {
                bridge.setPracticeRecords(normalized, options);
                return bridge.getPracticeRecords ? bridge.getPracticeRecords() : normalized.slice();
            }
            practiceRecordsState = normalized.slice();
            try { globalRef.practiceRecords = practiceRecordsState.slice(); } catch (_) {}
            safeEmit(listeners, 'practiceRecords', practiceRecordsState.slice());
            return practiceRecordsState.slice();
        }

        function getBrowseFilter() {
            snapshotArrays();
            return Object.assign({}, browseFilterState);
        }

        function setBrowseFilter(filter, options = {}) {
            const normalized = normalizeFilter(filter);
            if (bridge && typeof bridge.setBrowseFilter === 'function') {
                bridge.setBrowseFilter(normalized, options);
                return bridge.getBrowseFilter ? bridge.getBrowseFilter() : Object.assign({}, normalized);
            }
            browseFilterState = Object.assign({}, normalized);
            const descriptor = Object.getOwnPropertyDescriptor(globalRef, '__browseFilter');
            if (!descriptor || typeof descriptor.set !== 'function') {
                try { globalRef.__browseFilter = Object.assign({}, browseFilterState); } catch (_) {}
            }
            safeEmit(listeners, 'browseFilter', Object.assign({}, browseFilterState));
            return Object.assign({}, browseFilterState);
        }

        return {
            subscribe,
            getExamIndex,
            setExamIndex,
            getPracticeRecords,
            setPracticeRecords,
            getBrowseFilter,
            setBrowseFilter
        };
    }

    global.LegacyStateAdapter = {
        getInstance() {
            if (!global.__legacyStateAdapterInstance) {
                global.__legacyStateAdapterInstance = createAdapter(global);
            }
            return global.__legacyStateAdapterInstance;
        }
    };
})(typeof window !== 'undefined' ? window : this);
