(function installDictionaryLoader(global) {
    'use strict';
    // Capture the bundle URL while it is executing: reader HTML may live under
    // a nested directory or file://, and document.currentScript is null later.
    const source = document.currentScript && document.currentScript.src;
    const root = source ? new URL('../../', source) : new URL('./', document.baseURI);
    const version = source ? new URL(source).searchParams.get('v') : null;
    let pending = null;
    function load(path, available) {
        if (available()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const url = new URL(path, root);
            if (version) url.searchParams.set('v', version);
            script.src = url.href;
            script.onload = () => resolve();
            script.onerror = () => { script.remove(); reject(new Error('词典加载失败，请重试')); };
            document.head.appendChild(script);
        });
    }
    global.ensureReadingDictionary = function () {
        if (global.DictionaryService) return Promise.resolve(global.DictionaryService);
        if (!pending) pending = (async () => {
            await load('assets/wordlists/ielts_core.bundle.js', () => !!global.__EMBEDDED_WORDLISTS__?.ielts_core);
            await load('assets/wordlists/ecdict_reading.bundle.js', () => !!global.__LOCAL_DICTIONARIES__?.ecdict);
            await load('js/bundles/dictionary.bundle.js', () => !!global.DictionaryService);
            if (!global.DictionaryService) throw new Error('词典未就绪，请重试');
            return global.DictionaryService;
        })().catch(error => { pending = null; throw error; });
        return pending;
    };
})(typeof window !== 'undefined' ? window : globalThis);
