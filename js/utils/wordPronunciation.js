(function (global) {
    'use strict';

    function isAvailable() {
        return !!global.speechSynthesis && typeof global.SpeechSynthesisUtterance === 'function';
    }

    function speak(word) {
        if (!word || !isAvailable()) return;
        try {
            const utterance = new global.SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            global.speechSynthesis.cancel();
            global.speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn('[WordPronunciation] 朗读失败:', error);
        }
    }

    global.WordPronunciation = { isAvailable, speak };
})(window);
