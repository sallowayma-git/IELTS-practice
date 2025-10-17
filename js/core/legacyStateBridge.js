(function (global) {
    'use strict';

    class LegacyStateBridge {
        constructor({ globalRef = global } = {}) {
            this.global = globalRef;
            this.app = null;
            this.state = {
                examIndex: [],
                practiceRecords: [],
                browseFilter: { category: 'all', type: 'all' }
            };
            this.pending = {
                examIndex: null,
                practiceRecords: null,
                browseFilter: null
            };
            this.listeners = {
                examIndex: new Set(),
                practiceRecords: new Set(),
                browseFilter: new Set()
            };
            this.isSyncing = false;
        }

        connect(appInstance) {
            if (!appInstance || this.app === appInstance) {
                return this;
            }

            this.app = appInstance;

            if (!this.app.__legacyBridgeNotifier) {
                const originalSetState = this.app.setState.bind(this.app);
                this.app.setState = (path, value) => {
                    originalSetState(path, value);
                    this.notifyFromApp(path, value);
                };
                this.app.__legacyBridgeNotifier = true;
            }

            this.applyPendingState();
            this.syncFromApp();
            return this;
        }

        applyPendingState() {
            if (!this.app) {
                return;
            }

            if (this.pending.examIndex) {
                this.setExamIndex(this.pending.examIndex, { fromPending: true });
                this.pending.examIndex = null;
            }

            if (this.pending.practiceRecords) {
                this.setPracticeRecords(this.pending.practiceRecords, { fromPending: true });
                this.pending.practiceRecords = null;
            }

            if (this.pending.browseFilter) {
                this.setBrowseFilter(this.pending.browseFilter, { fromPending: true });
                this.pending.browseFilter = null;
            }
        }

        syncFromApp() {
            if (!this.app) {
                return;
            }

            const examIndex = this.app.getState('exam.index') || [];
            const practiceRecords = this.app.getState('practice.records') || [];
            const browseFilter = this.app.getState('ui.browseFilter') || { category: 'all', type: 'all' };

            this.notifyFromApp('exam.index', examIndex);
            this.notifyFromApp('practice.records', practiceRecords);
            this.notifyFromApp('ui.browseFilter', browseFilter);
        }

        setExamIndex(exams, { fromPending = false } = {}) {
            const normalized = Array.isArray(exams) ? exams.slice() : [];

            if (!this.app) {
                this.pending.examIndex = normalized;
            }

            this.state.examIndex = normalized;
            this.emit('examIndex', normalized);

            try {
                this.global.examIndex = normalized;
            } catch (_) {}

            if (this.app && !this.isSyncing && !fromPending) {
                this.withSync(() => this.app.setState('exam.index', normalized));
            }

            return normalized;
        }

        getExamIndex() {
            if (Array.isArray(this.state.examIndex)) {
                return this.state.examIndex;
            }
            if (Array.isArray(this.global.examIndex)) {
                return this.global.examIndex;
            }
            return [];
        }

        setPracticeRecords(records, { fromPending = false } = {}) {
            const normalized = Array.isArray(records) ? records.slice() : [];

            if (!this.app) {
                this.pending.practiceRecords = normalized;
            }

            this.state.practiceRecords = normalized;
            this.emit('practiceRecords', normalized);

            try {
                this.global.practiceRecords = normalized;
            } catch (_) {}

            if (this.app && !this.isSyncing && !fromPending) {
                this.withSync(() => this.app.setState('practice.records', normalized));
            }

            return normalized;
        }

        getPracticeRecords() {
            if (Array.isArray(this.state.practiceRecords)) {
                return this.state.practiceRecords;
            }
            if (Array.isArray(this.global.practiceRecords)) {
                return this.global.practiceRecords;
            }
            return [];
        }

        setBrowseFilter(filter, { fromPending = false } = {}) {
            const normalized = {
                category: filter && typeof filter.category === 'string' ? filter.category : 'all',
                type: filter && typeof filter.type === 'string' ? filter.type : 'all'
            };

            if (!this.app) {
                this.pending.browseFilter = normalized;
            }

            this.state.browseFilter = normalized;
            this.emit('browseFilter', normalized);

            try {
                this.global.__browseFilter = normalized;
            } catch (_) {}

            if (this.app && !this.isSyncing && !fromPending) {
                this.withSync(() => this.app.setState('ui.browseFilter', normalized));
            }

            return normalized;
        }

        getBrowseFilter() {
            const filter = this.state.browseFilter || this.global.__browseFilter || { category: 'all', type: 'all' };
            return {
                category: filter.category || 'all',
                type: filter.type || 'all'
            };
        }

        notifyFromApp(path, value) {
            if (this.isSyncing) {
                switch (path) {
                    case 'exam.index':
                        this.state.examIndex = Array.isArray(value) ? value.slice() : [];
                        this.emit('examIndex', this.state.examIndex);
                        break;
                    case 'practice.records':
                        this.state.practiceRecords = Array.isArray(value) ? value.slice() : [];
                        this.emit('practiceRecords', this.state.practiceRecords);
                        break;
                    case 'ui.browseFilter':
                        this.state.browseFilter = {
                            category: value && typeof value.category === 'string' ? value.category : 'all',
                            type: value && typeof value.type === 'string' ? value.type : 'all'
                        };
                        this.emit('browseFilter', this.state.browseFilter);
                        break;
                    default:
                        break;
                }
                return;
            }

            switch (path) {
                case 'exam.index':
                    this.state.examIndex = Array.isArray(value) ? value.slice() : [];
                    {
                        const descriptor = Object.getOwnPropertyDescriptor(this.global, 'examIndex');
                        if (!descriptor || typeof descriptor.set !== 'function') {
                            try { this.global.examIndex = this.state.examIndex; } catch (_) {}
                        }
                    }
                    this.emit('examIndex', this.state.examIndex);
                    break;
                case 'practice.records':
                    this.state.practiceRecords = Array.isArray(value) ? value.slice() : [];
                    {
                        const descriptor = Object.getOwnPropertyDescriptor(this.global, 'practiceRecords');
                        if (!descriptor || typeof descriptor.set !== 'function') {
                            try { this.global.practiceRecords = this.state.practiceRecords; } catch (_) {}
                        }
                    }
                    this.emit('practiceRecords', this.state.practiceRecords);
                    break;
                case 'ui.browseFilter':
                    this.state.browseFilter = {
                        category: value && typeof value.category === 'string' ? value.category : 'all',
                        type: value && typeof value.type === 'string' ? value.type : 'all'
                    };
                    {
                        const descriptor = Object.getOwnPropertyDescriptor(this.global, '__browseFilter');
                        if (!descriptor || typeof descriptor.set !== 'function') {
                            try { this.global.__browseFilter = this.state.browseFilter; } catch (_) {}
                        }
                    }
                    this.emit('browseFilter', this.state.browseFilter);
                    break;
                default:
                    break;
            }
        }

        on(topic, handler) {
            if (!this.listeners[topic]) {
                return () => {};
            }

            this.listeners[topic].add(handler);
            return () => {
                this.listeners[topic].delete(handler);
            };
        }

        emit(topic, value) {
            const handlers = this.listeners[topic];
            if (!handlers) {
                return;
            }
            handlers.forEach(handler => {
                try { handler(value); } catch (_) {}
            });
        }

        withSync(fn) {
            if (this.isSyncing) {
                return fn();
            }
            this.isSyncing = true;
            try {
                return fn();
            } finally {
                this.isSyncing = false;
            }
        }
    }

    const bridgeInstance = new LegacyStateBridge();

    global.LegacyStateBridge = {
        getInstance() {
            return bridgeInstance;
        },
        connect(appInstance) {
            return bridgeInstance.connect(appInstance);
        }
    };
})(window);
