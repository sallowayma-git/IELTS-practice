// events.js - Simple event system for file:// protocol compatibility
// Pure functions and classes for store notifications and UI updates

// Simple EventEmitter class for store-to-UI communication
window.EventEmitter = class EventEmitter {
    constructor() {
        this.listeners = new Map();
    }
    
    // Subscribe to events
    on(eventType, callback) {
        if (typeof callback !== 'function') {
            throw new Error('Event callback must be a function');
        }
        
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        
        this.listeners.get(eventType).add(callback);
        
        // Return unsubscribe function
        return () => this.off(eventType, callback);
    }
    
    // Unsubscribe from events
    off(eventType, callback) {
        if (this.listeners.has(eventType)) {
            this.listeners.get(eventType).delete(callback);
            
            // Clean up empty event types
            if (this.listeners.get(eventType).size === 0) {
                this.listeners.delete(eventType);
            }
        }
    }
    
    // Emit events to all listeners
    emit(eventType, data = null) {
        if (this.listeners.has(eventType)) {
            const callbacks = this.listeners.get(eventType);
            
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[EventEmitter] Error in ${eventType} listener:`, error);
                }
            });
        }
    }
    
    // Remove all listeners for an event type
    removeAllListeners(eventType) {
        if (eventType) {
            this.listeners.delete(eventType);
        } else {
            this.listeners.clear();
        }
    }
    
    // Get listener count for debugging
    listenerCount(eventType) {
        return this.listeners.has(eventType) ? this.listeners.get(eventType).size : 0;
    }
    
    // Get all event types for debugging
    eventTypes() {
        return Array.from(this.listeners.keys());
    }
};

// Global event bus for cross-component communication
window.globalEventBus = new window.EventEmitter();

// Utility functions for common event patterns
window.createEventHandler = function(eventType, handler) {
    if (typeof handler !== 'function') {
        throw new Error('Event handler must be a function');
    }
    
    return function(data) {
        try {
            handler(data);
        } catch (error) {
            console.error(`[EventHandler] Error handling ${eventType}:`, error);
            
            // Emit error event for global error handling
            window.globalEventBus.emit('error', {
                type: 'event_handler_error',
                eventType: eventType,
                error: error,
                data: data
            });
        }
    };
};

// Debounced event handler for performance
window.createDebouncedHandler = function(handler, delay = 300) {
    let timeoutId = null;
    
    return function(data) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            try {
                handler(data);
            } catch (error) {
                console.error('[DebouncedHandler] Error:', error);
            }
        }, delay);
    };
};

// Throttled event handler for performance
window.createThrottledHandler = function(handler, delay = 100) {
    let lastCall = 0;
    
    return function(data) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            try {
                handler(data);
            } catch (error) {
                console.error('[ThrottledHandler] Error:', error);
            }
        }
    };
};

// Event aggregator for batching multiple events
window.EventAggregator = class EventAggregator {
    constructor(flushInterval = 100) {
        this.events = [];
        this.flushInterval = flushInterval;
        this.flushTimer = null;
        this.handlers = new Set();
    }
    
    add(event) {
        this.events.push({
            ...event,
            timestamp: Date.now()
        });
        
        this.scheduleFlush();
    }
    
    scheduleFlush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        
        this.flushTimer = setTimeout(() => {
            this.flush();
        }, this.flushInterval);
    }
    
    flush() {
        if (this.events.length === 0) return;
        
        const eventsToFlush = [...this.events];
        this.events = [];
        
        this.handlers.forEach(handler => {
            try {
                handler(eventsToFlush);
            } catch (error) {
                console.error('[EventAggregator] Handler error:', error);
            }
        });
    }
    
    subscribe(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
};

// Store event types for type safety and documentation
window.StoreEvents = {
    // ExamStore events
    EXAMS_LOADED: 'exams_loaded',
    EXAMS_UPDATED: 'exams_updated',
    CATEGORIES_UPDATED: 'categories_updated',
    EXAM_SEARCH: 'exam_search',
    
    // RecordStore events
    RECORDS_LOADED: 'records_loaded',
    RECORD_SAVED: 'record_saved',
    RECORD_DELETED: 'record_deleted',
    RECORDS_CLEARED: 'records_cleared',
    RECORDS_IMPORTED: 'records_imported',
    STATS_UPDATED: 'stats_updated',
    
    // AppStore events
    VIEW_CHANGED: 'view_changed',
    LOADING_CHANGED: 'loading_changed',
    ERROR_ADDED: 'error_added',
    ERROR_CLEARED: 'error_cleared',
    ERRORS_CLEARED: 'errors_cleared',
    INITIALIZATION_STEP: 'initialization_step',
    INITIALIZATION_COMPLETE: 'initialization_complete',
    STORE_OPERATION: 'store_operation',
    APP_RESET: 'app_reset'
};

// UI event types for user interactions
window.UIEvents = {
    // Navigation events
    NAVIGATE_TO: 'navigate_to',
    NAVIGATE_BACK: 'navigate_back',
    
    // Exam events
    EXAM_START: 'exam_start',
    EXAM_COMPLETE: 'exam_complete',
    EXAM_SEARCH: 'exam_search',
    EXAM_FILTER: 'exam_filter',
    
    // Record events
    RECORD_VIEW: 'record_view',
    RECORD_DELETE: 'record_delete',
    RECORD_EXPORT: 'record_export',
    
    // Settings events
    SETTINGS_OPEN: 'settings_open',
    SETTINGS_SAVE: 'settings_save',
    DATA_EXPORT: 'data_export',
    DATA_IMPORT: 'data_import',
    DATA_CLEAR: 'data_clear'
};

// Event validation helpers
window.validateEvent = function(event) {
    if (!event || typeof event !== 'object') {
        throw new Error('Event must be an object');
    }
    
    if (!event.type || typeof event.type !== 'string') {
        throw new Error('Event must have a type string');
    }
    
    return true;
};

// Event logging for debugging
window.EventLogger = class EventLogger {
    constructor(enabled = false) {
        this.enabled = enabled;
        this.logs = [];
        this.maxLogs = 1000;
    }
    
    log(event) {
        if (!this.enabled) return;
        
        const logEntry = {
            timestamp: new Date().toISOString(),
            event: event,
            stack: new Error().stack
        };
        
        this.logs.push(logEntry);
        
        // Keep only recent logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        console.log('[EventLogger]', event.type, event);
    }
    
    getLogs(eventType = null) {
        if (eventType) {
            return this.logs.filter(log => log.event.type === eventType);
        }
        return [...this.logs];
    }
    
    clearLogs() {
        this.logs = [];
    }
    
    enable() {
        this.enabled = true;
    }
    
    disable() {
        this.enabled = false;
    }
};

// Global event logger instance
window.eventLogger = new window.EventLogger(false); // Disabled by default

// Helper function to enable event logging for debugging
window.enableEventLogging = function() {
    window.eventLogger.enable();
    console.log('[Events] Event logging enabled');
};

window.disableEventLogging = function() {
    window.eventLogger.disable();
    console.log('[Events] Event logging disabled');
};

// Cross-window communication helpers for exam windows
window.createWindowMessenger = function(targetWindow, origin = '*') {
    return {
        send: function(type, data) {
            if (!targetWindow || targetWindow.closed) {
                throw new Error('Target window is not available');
            }
            
            const message = {
                type: type,
                data: data,
                timestamp: Date.now(),
                source: 'ielts-main'
            };
            
            targetWindow.postMessage(message, origin);
        },
        
        listen: function(callback) {
            const handler = function(event) {
                // Basic security check
                if (event.data && event.data.source === 'ielts-exam') {
                    try {
                        callback(event.data);
                    } catch (error) {
                        console.error('[WindowMessenger] Message handler error:', error);
                    }
                }
            };
            
            window.addEventListener('message', handler);
            
            // Return cleanup function
            return () => window.removeEventListener('message', handler);
        }
    };
};

// Event bus for store coordination
window.storeEventBus = new window.EventEmitter();

// Helper to connect stores to the event bus
window.connectStoreToEventBus = function(store, storeName) {
    if (!store || !store.subscribe) {
        throw new Error('Store must have a subscribe method');
    }
    
    // Forward store events to global event bus
    store.subscribe(function(event) {
        const globalEvent = {
            ...event,
            source: storeName,
            timestamp: Date.now()
        };
        
        window.storeEventBus.emit(event.type, globalEvent);
        window.eventLogger.log(globalEvent);
    });
    
    console.log(`[Events] Connected ${storeName} to event bus`);
};