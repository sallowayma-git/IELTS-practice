(function(window) {
    const listeners = new Set();
    let providers = null;

    function summarizeStorageRegistryErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function normalizeProviders(input) {
        if (!input || typeof input !== 'object') {
            return null;
        }
        const normalized = {
            storageManager: input.storageManager || window.storage || null,
            persistentStore: input.persistentStore || window.persistentStore || null,
            preferenceStore: input.preferenceStore || window.preferenceStore || null,
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
                console.error('[StorageProviderRegistry] callback failed:', summarizeStorageRegistryErrorForLog(error));
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
        if (!window.persistentStore && normalized.persistentStore) {
            window.persistentStore = normalized.persistentStore;
        }
        if (!window.preferenceStore && normalized.preferenceStore) {
            window.preferenceStore = normalized.preferenceStore;
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
                console.error('[StorageProviderRegistry] callback failed:', summarizeStorageRegistryErrorForLog(error));
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
