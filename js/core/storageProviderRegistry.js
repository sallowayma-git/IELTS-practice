(function(window) {
    const listeners = new Set();
    let providers = null;

    function normalizeProviders(input) {
        if (!input || typeof input !== 'object') {
            return null;
        }
        const normalized = {
            storageManager: input.storageManager || window.storage || null,
            repositories: input.repositories || null,
            simpleStorageWrapper: input.simpleStorageWrapper || null
        };
        if (!normalized.repositories) {
            return null;
        }
        return normalized;
    }

    function notifyListeners(payload) {
        listeners.forEach((listener) => {
            try {
                listener(payload);
            } catch (error) {
                console.error('[StorageProviderRegistry] listener failed:', error);
            }
        });
    }

    function registerStorageProviders(input) {
        const normalized = normalizeProviders(input);
        if (!normalized) {
            throw new Error('registerStorageProviders requires repositories');
        }
        providers = normalized;

        if (!window.dataRepositories) {
            window.dataRepositories = normalized.repositories;
        }
        if (!window.storage && normalized.storageManager) {
            window.storage = normalized.storageManager;
        }
        if (normalized.simpleStorageWrapper && !window.simpleStorageWrapper) {
            window.simpleStorageWrapper = normalized.simpleStorageWrapper;
        }

        notifyListeners(Object.assign({}, providers));
        return providers;
    }

    function onProvidersReady(callback) {
        if (typeof callback !== 'function') {
            return () => {};
        }
        listeners.add(callback);
        if (providers) {
            try {
                callback(Object.assign({}, providers));
            } catch (error) {
                console.error('[StorageProviderRegistry] immediate callback failed:', error);
            }
        }
        return () => listeners.delete(callback);
    }

    function getCurrentProviders() {
        return providers ? Object.assign({}, providers) : null;
    }

    window.StorageProviderRegistry = {
        registerStorageProviders,
        onProvidersReady,
        getCurrentProviders
    };
})(window);
