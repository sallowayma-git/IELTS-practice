// AppStore.js - Global class for file:// protocol compatibility
// Manages application state coordination and honest error handling

window.AppStore = class AppStore {
    constructor() {
        if (typeof markStoreInitStart === 'function') markStoreInitStart();
        this.currentView = 'overview';
        this.loading = false;
        this.errors = [];
        this.navigation = {
            history: [],
            currentIndex: -1
        };
        this.observers = new Set();
        
        // Application state
        this.initialized = false;
        this.initializationSteps = {
            stores: false,
            ui: false,
            events: false
        };
    }
    
    // Navigation management
    setView(viewName, data = null) {
        if (!viewName) {
            throw new Error('View name is required');
        }
        
        const previousView = this.currentView;
        this.currentView = viewName;
        
        // Add to navigation history
        this.navigation.history.push({
            view: viewName,
            data: data,
            timestamp: Date.now()
        });
        this.navigation.currentIndex = this.navigation.history.length - 1;
        
        this.notify({ 
            type: 'view_changed', 
            view: viewName, 
            previousView: previousView,
            data: data 
        });
        
        debugLog('[AppStore] View changed:', previousView, '→', viewName);
    }
    
    getCurrentView() {
        return {
            name: this.currentView,
            data: this.navigation.history[this.navigation.currentIndex]?.data || null
        };
    }
    
    canGoBack() {
        return this.navigation.currentIndex > 0;
    }
    
    goBack() {
        if (this.canGoBack()) {
            this.navigation.currentIndex--;
            const previousView = this.navigation.history[this.navigation.currentIndex];
            this.currentView = previousView.view;
            
            this.notify({ 
                type: 'view_changed', 
                view: previousView.view,
                data: previousView.data,
                isBack: true
            });
            
            debugLog('[AppStore] Navigated back to:', previousView.view);
        }
    }
    
    // Error handling - honest and actionable
    addError(error) {
        const errorInfo = {
            id: 'error_' + Date.now(),
            message: error.message || 'Unknown error occurred',
            context: error.context || 'Unknown context',
            timestamp: new Date().toISOString(),
            recoverable: error.recoverable !== false, // Default to recoverable
            userMessage: error.userMessage || this.getUserMessage(error),
            actions: error.actions || this.getRecoveryActions(error),
            stack: error.stack || new Error().stack
        };
        
        this.errors.push(errorInfo);
        
        // Log for developers - never hide errors
        console.error('[AppStore] Error added:', errorInfo);
        
        // Notify UI to show error
        this.notify({ type: 'error_added', error: errorInfo });
        
        return errorInfo;
    }
    
    getUserMessage(error) {
        if (error.name === 'QuotaExceededError') {
            return 'Storage is full. Please export your data and clear old records.';
        }
        if (error.message && error.message.includes('network')) {
            return 'Network error. Check your connection and try again.';
        }
        if (error.message && error.message.includes('Storage')) {
            return 'Data storage error. Your progress may not be saved.';
        }
        if (error.message && error.message.includes('not found')) {
            return 'The requested item could not be found.';
        }
        return `Something went wrong: ${error.message}`;
    }
    
    getRecoveryActions(error) {
        if (error.name === 'QuotaExceededError') {
            return ['Export data', 'Clear old records', 'Try again'];
        }
        if (error.message && error.message.includes('Storage')) {
            return ['Refresh page', 'Check browser settings', 'Export data as backup'];
        }
        if (error.message && error.message.includes('exam')) {
            return ['Refresh page', 'Try different exam', 'Report issue'];
        }
        if (error.message && error.message.includes('network')) {
            return ['Check connection', 'Try again', 'Work offline'];
        }
        return ['Refresh page', 'Try again', 'Report issue'];
    }
    
    clearError(errorId) {
        const index = this.errors.findIndex(error => error.id === errorId);
        if (index !== -1) {
            const removedError = this.errors.splice(index, 1)[0];
            this.notify({ type: 'error_cleared', error: removedError });
            debugLog('[AppStore] Error cleared:', errorId);
        }
    }
    
    clearAllErrors() {
        const errorCount = this.errors.length;
        this.errors = [];
        this.notify({ type: 'errors_cleared', count: errorCount });
        debugLog('[AppStore] All errors cleared:', errorCount);
    }
    
    getErrors(onlyRecoverable = false) {
        if (onlyRecoverable) {
            return this.errors.filter(error => error.recoverable);
        }
        return [...this.errors];
    }
    
    // Loading state management
    setLoading(isLoading, context = null) {
        const previousLoading = this.loading;
        this.loading = Boolean(isLoading);
        
        this.notify({ 
            type: 'loading_changed', 
            loading: this.loading, 
            previousLoading: previousLoading,
            context: context
        });
        
        if (context) {
            debugLog('[AppStore] Loading state:', this.loading, 'Context:', context);
        }
    }
    
    isLoading() {
        return this.loading;
    }
    
    // Initialization tracking
    setInitializationStep(step, completed) {
        if (!this.initializationSteps.hasOwnProperty(step)) {
            throw new Error(`Unknown initialization step: ${step}`);
        }
        
        this.initializationSteps[step] = Boolean(completed);
        
        // Check if all steps are complete
        const allComplete = Object.values(this.initializationSteps).every(step => step === true);
        if (allComplete && !this.initialized) {
            this.initialized = true;
            if (typeof markStoreInitEnd === 'function') markStoreInitEnd();
            this.notify({ type: 'initialization_complete' });
            console.log('[AppStore] Application initialization complete');
        }
        
        this.notify({ 
            type: 'initialization_step', 
            step: step, 
            completed: completed,
            allComplete: allComplete
        });
    }
    
    isInitialized() {
        return this.initialized;
    }
    
    getInitializationStatus() {
        return {
            initialized: this.initialized,
            steps: { ...this.initializationSteps }
        };
    }
    
    // Store coordination methods
    async coordinateStoreUpdate(storeName, operation, data) {
        try {
            this.setLoading(true, `${storeName}.${operation}`);
            
            // Log the operation for debugging
            console.log('[AppStore] Coordinating store update:', storeName, operation, data);
            
            // Notify other stores about the operation
            this.notify({
                type: 'store_operation',
                store: storeName,
                operation: operation,
                data: data,
                timestamp: Date.now()
            });
            
            return true;
        } catch (error) {
            this.addError({
                message: `Store coordination failed: ${error.message}`,
                context: `AppStore.coordinateStoreUpdate.${storeName}.${operation}`,
                recoverable: true,
                userMessage: `Failed to update ${storeName}. Please try again.`,
                actions: ['Try again', 'Refresh page']
            });
            throw error;
        } finally {
            this.setLoading(false, `${storeName}.${operation}`);
        }
    }
    
    // Simple observer pattern for UI updates
    subscribe(callback) {
        if (typeof callback !== 'function') {
            throw new Error('Observer callback must be a function');
        }
        this.observers.add(callback);
        return () => this.observers.delete(callback); // Return unsubscribe function
    }
    
    notify(event) {
        this.observers.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                // Don't use addError here to avoid infinite loops
                console.error('[AppStore] Observer error:', error);
            }
        });
    }
    
    // Utility methods
    reset() {
        this.currentView = 'overview';
        this.loading = false;
        this.errors = [];
        this.navigation = {
            history: [],
            currentIndex: -1
        };
        this.initialized = false;
        this.initializationSteps = {
            stores: false,
            ui: false,
            events: false
        };
        
        this.notify({ type: 'app_reset' });
        console.log('[AppStore] Application state reset');
    }
    
    getDebugInfo() {
        return {
            currentView: this.currentView,
            loading: this.loading,
            errorCount: this.errors.length,
            initialized: this.initialized,
            initializationSteps: { ...this.initializationSteps },
            navigationHistory: this.navigation.history.length,
            observerCount: this.observers.size
        };
    }
};