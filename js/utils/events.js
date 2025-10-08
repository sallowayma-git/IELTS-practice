// events.js - Simple EventEmitter class for store-to-UI communication
// Provides event system for reactive architecture (file:// compatible)
// Canonical source - guarded against redefinition (Task 65)

if (!window.EventEmitter) {
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

} // End EventEmitter guard

// Global event bus for cross-component communication
// Guard against redefinition - single source of truth
if (!window.globalEventBus) {
    window.globalEventBus = new window.EventEmitter();
    console.log('[Events] EventEmitter initialized - canonical source');
}