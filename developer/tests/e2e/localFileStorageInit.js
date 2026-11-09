// Test chooser plumbing only. FileJournal, IndexedDB handle serialization and
// native FileSystem reads/writes remain the shipped implementations.
(() => {
    if (location.protocol !== 'file:') return;
    const picker = window.showDirectoryPicker;
    window.showDirectoryPicker = function(options) {
        if (options?.id === 'ielts-atlas-local-data' && window.__testLocalDirectory) {
            if (!navigator.userActivation.isActive) throw new DOMException('Activation required', 'SecurityError');
            return window.__testLocalDirectory;
        }
        return picker.call(this, options);
    };
    addEventListener('dragover', event => { if (window.__testDirectoryDrop) event.preventDefault(); }, true);
    addEventListener('drop', event => {
        if (!window.__testDirectoryDrop) return;
        event.preventDefault(); event.stopImmediatePropagation();
        window.__testLocalDirectory = event.dataTransfer.items[0].getAsFileSystemHandle();
        window.__testDirectoryDrop = false;
    }, true);
})();
