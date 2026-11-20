(function (global) {
    'use strict';

    const ratings = Object.freeze({
        easy: '简单',
        good: '一般',
        hard: '困难'
    });
    const defaults = Object.freeze({ easy: '1', good: '2', hard: '3' });
    // F is already the shortcut for revealing the definition.
    const keys = Object.freeze(Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ').filter((key) => key !== 'F'));
    let bindings = defaults;
    let preferenceTail = Promise.resolve();

    function isValid(value) {
        if (!value) return false;
        const assigned = Object.keys(ratings).map((rating) => value[rating]);
        return assigned.every((key) => keys.includes(key)) && new Set(assigned).size === assigned.length;
    }

    function enqueue(task) {
        const result = preferenceTail.then(task);
        preferenceTail = result.catch(() => undefined);
        return result;
    }

    function load() {
        return enqueue(async () => {
            try {
                const stored = await global.AppData.preferences.getVocabShortcuts();
                bindings = isValid(stored) ? Object.freeze(stored) : defaults;
            } catch (error) {
                console.warn('[VocabShortcutPreferences] 加载失败:', error);
            }
            return bindings;
        });
    }

    function save(next) {
        return enqueue(async () => {
            if (!isValid(next)) throw new Error('Invalid vocabulary shortcuts');
            await global.AppData.preferences.setVocabShortcuts(next);
            bindings = Object.freeze({ ...next });
        });
    }

    global.VocabShortcutPreferences = { ratings, keys, isValid, load, save, read: () => bindings };
})(window);
