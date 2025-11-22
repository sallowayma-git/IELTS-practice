(function initMiniGames(global) {
    'use strict';

    var DEFAULT_VOCAB_SPARK_WORDS = [
        { word: 'meticulous', meaning: '一丝不苟的' },
        { word: 'resilient', meaning: '有韧性的' },
        { word: 'articulate', meaning: '善于表达的' },
        { word: 'pragmatic', meaning: '务实的' },
        { word: 'immerse', meaning: '沉浸' },
        { word: 'synthesize', meaning: '综合' },
        { word: 'discern', meaning: '辨别' },
        { word: 'alleviate', meaning: '缓解' },
        { word: 'coherent', meaning: '连贯的' },
        { word: 'scrutinize', meaning: '仔细审查' },
        { word: 'fortify', meaning: '强化' },
        { word: 'contemplate', meaning: '深思' },
        { word: 'mitigate', meaning: '减轻' },
        { word: 'propel', meaning: '推动' },
        { word: 'elaborate', meaning: '详尽阐述' },
        { word: 'culminate', meaning: '达到顶点' },
        { word: 'bolster', meaning: '支撑' },
        { word: 'artistry', meaning: '艺术技巧' },
        { word: 'vigilant', meaning: '警觉的' },
        { word: 'versatile', meaning: '多才多艺的' }
    ];

    var vocabSparkLexicon = null;
    var vocabSparkLoadingPromise = null;
    var vocabSparkState = null;
    var vocabSparkFallbackNoticeShown = false;
    var vocabSparkInputBound = false;
    var vocabSparkDeck = [];

    function shuffleArray(list) {
        var array = Array.isArray(list) ? list.slice() : [];
        for (var i = array.length - 1; i > 0; i -= 1) {
            var j = getSecureRandomInt(i + 1);
            var tmp = array[i];
            array[i] = array[j];
            array[j] = tmp;
        }
        return array;
    }

    function getSecureRandomInt(maxExclusive) {
        var max = typeof maxExclusive === 'number' && maxExclusive > 0 ? Math.floor(maxExclusive) : 0;
        if (!max) {
            return 0;
        }

        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            var buffer = new Uint32Array(1);
            crypto.getRandomValues(buffer);
            return buffer[0] % max;
        }

        return Math.floor(Math.random() * max);
    }

    function normalizeVocabEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        var word = typeof entry.word === 'string' ? entry.word.trim() : '';
        var meaning = typeof entry.meaning === 'string' ? entry.meaning.trim() : '';
        if (!word || !meaning) {
            return null;
        }
        return { word: word, meaning: meaning };
    }

    function ensureVocabSparkInputBindings() {
        if (vocabSparkInputBound) {
            return;
        }
        var input = document.getElementById('mini-game-answer');
        if (!input) {
            return;
        }
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                handleMiniGameNext('next');
            }
        });
        vocabSparkInputBound = true;
    }

    function clearVocabSparkRevealTimer() {
        if (vocabSparkState && vocabSparkState.revealTimer) {
            clearTimeout(vocabSparkState.revealTimer);
            vocabSparkState.revealTimer = null;
        }
    }

    function resetVocabSparkDeck() {
        vocabSparkDeck = [];
    }

    async function ensureVocabSparkLexicon() {
        if (Array.isArray(vocabSparkLexicon) && vocabSparkLexicon.length) {
            return vocabSparkLexicon.slice();
        }

        if (vocabSparkLoadingPromise) {
            return vocabSparkLoadingPromise.then(function (list) { return list.slice(); });
        }

        var loader = async function () {
            try {
                var response = await fetch('assets/data/vocabulary.json', { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                var payload = await response.json();
                var normalized = Array.isArray(payload)
                    ? payload.map(normalizeVocabEntry).filter(Boolean)
                    : [];

                if (!normalized.length) {
                    throw new Error('词汇表为空');
                }

                vocabSparkLexicon = normalized;
                resetVocabSparkDeck();
                return vocabSparkLexicon.slice();
            } catch (error) {
                console.warn('[VocabSpark] 词汇表加载失败，使用内置词库:', error);
                vocabSparkLexicon = DEFAULT_VOCAB_SPARK_WORDS.map(normalizeVocabEntry).filter(Boolean);
                if (!vocabSparkLexicon.length) {
                    throw error;
                }
                if (!vocabSparkFallbackNoticeShown && typeof global.showMessage === 'function') {
                    global.showMessage('词汇表加载失败，已使用内置词库', 'warning');
                    vocabSparkFallbackNoticeShown = true;
                }
                resetVocabSparkDeck();
                return vocabSparkLexicon.slice();
            }
        };

        vocabSparkLoadingPromise = loader().finally(function () {
            vocabSparkLoadingPromise = null;
        });

        return vocabSparkLoadingPromise.then(function (list) { return list.slice(); });
    }

    function drawVocabSparkQueue(lexicon, desiredCount) {
        if (desiredCount === void 0) { desiredCount = 10; }
        if (!Array.isArray(lexicon) || !lexicon.length) {
            return [];
        }

        var total = Math.min(Math.max(1, desiredCount), lexicon.length);

        if (!Array.isArray(vocabSparkDeck)) {
            vocabSparkDeck = [];
        }

        var normalizeKey = function (entry) { return String(entry.word || '').toLowerCase(); };

        var ensureDeck = function () {
            var base = shuffleArray(lexicon);
            vocabSparkDeck = base.slice();
        };

        if (!vocabSparkDeck.length) {
            ensureDeck();
        }

        if (vocabSparkDeck.length < total) {
            var carry = vocabSparkDeck.slice();
            ensureDeck();

            if (carry.length) {
                var used = new Set(carry.map(normalizeKey));
                for (var i = 0; i < vocabSparkDeck.length; i += 1) {
                    var entry = vocabSparkDeck[i];
                    var key = normalizeKey(entry);
                    if (!used.has(key)) {
                        carry.push(entry);
                        used.add(key);
                    }
                    if (carry.length >= total) {
                        break;
                    }
                }
                vocabSparkDeck = carry;
            }
        }

        if (vocabSparkDeck.length < total) {
            var filler = shuffleArray(lexicon);
            for (var j = 0; j < filler.length && vocabSparkDeck.length < total; j += 1) {
                vocabSparkDeck.push(filler[j]);
            }
        }

        var queue = vocabSparkDeck.splice(0, total).map(function (entry) { return Object.assign({}, entry); });
        return queue;
    }

    async function startVocabSparkGame() {
        var modal = document.getElementById('mini-game-modal');
        var questionEl = document.getElementById('mini-game-question');
        var feedbackEl = document.getElementById('mini-game-feedback');
        var progressEl = document.getElementById('mini-game-progress');
        var inputWrapper = document.getElementById('mini-game-input-wrapper');
        var answerInput = document.getElementById('mini-game-answer');
        var nextBtn = document.querySelector('.mini-game-next');

        if (!modal || !questionEl || !feedbackEl || !progressEl || !inputWrapper || !answerInput || !nextBtn) {
            if (typeof global.showMessage === 'function') {
                global.showMessage('小游戏容器缺失', 'error');
            }
            return;
        }

        ensureVocabSparkInputBindings();
        clearVocabSparkRevealTimer();

        modal.removeAttribute('hidden');
        modal.classList.add('active');

        questionEl.textContent = '词库加载中，请稍候...';
        questionEl.classList.remove('reveal');
        inputWrapper.classList.remove('hidden');
        answerInput.value = '';
        answerInput.disabled = true;
        answerInput.classList.remove('is-error');
        feedbackEl.textContent = '';
        progressEl.textContent = '';
        nextBtn.textContent = '下一题';
        nextBtn.disabled = true;
        nextBtn.dataset.gameAction = 'next';

        try {
            var lexicon = await ensureVocabSparkLexicon();
            if (!lexicon.length) {
                throw new Error('词汇表为空');
            }

            var queue = drawVocabSparkQueue(lexicon, 10);
            if (!queue.length) {
                throw new Error('词汇表为空');
            }

            vocabSparkState = {
                queue: queue,
                total: queue.length,
                completed: 0,
                score: 0,
                current: null,
                phase: 'answering',
                revealTimer: null
            };

            renderVocabSparkQuestion(true);
        } catch (error) {
            console.error('[VocabSpark] 初始化失败:', error);
            if (typeof global.showMessage === 'function') {
                global.showMessage('词汇挑战初始化失败，请稍后重试', 'error');
            }
            closeMiniGame();
        }
    }

    function renderVocabSparkQuestion(initial) {
        if (initial === void 0) { initial = false; }
        if (!vocabSparkState || !Array.isArray(vocabSparkState.queue)) {
            return;
        }

        var questionEl = document.getElementById('mini-game-question');
        var feedbackEl = document.getElementById('mini-game-feedback');
        var progressEl = document.getElementById('mini-game-progress');
        var nextBtn = document.querySelector('.mini-game-next');
        var inputWrapper = document.getElementById('mini-game-input-wrapper');
        var answerInput = document.getElementById('mini-game-answer');

        if (!questionEl || !feedbackEl || !progressEl || !nextBtn || !inputWrapper || !answerInput) {
            return;
        }

        if (!vocabSparkState.queue.length) {
            renderVocabSparkSummary();
            return;
        }

        clearVocabSparkRevealTimer();

        vocabSparkState.current = vocabSparkState.queue[0];
        vocabSparkState.phase = 'answering';

        questionEl.textContent = vocabSparkState.current.meaning;
        questionEl.classList.remove('reveal');
        inputWrapper.classList.remove('hidden');
        answerInput.disabled = false;
        answerInput.value = '';
        answerInput.classList.remove('is-error');
        answerInput.focus();

        feedbackEl.textContent = initial
            ? '请根据中文释义输入英文单词'
            : '继续输入下一题的英文拼写';

        progressEl.textContent = '第 ' + (vocabSparkState.completed + 1) + ' / ' + vocabSparkState.total + ' 题';
        nextBtn.textContent = '下一题';
        nextBtn.disabled = false;
        nextBtn.dataset.gameAction = 'next';
    }

    function renderVocabSparkSummary() {
        var questionEl = document.getElementById('mini-game-question');
        var feedbackEl = document.getElementById('mini-game-feedback');
        var progressEl = document.getElementById('mini-game-progress');
        var nextBtn = document.querySelector('.mini-game-next');
        var inputWrapper = document.getElementById('mini-game-input-wrapper');
        var answerInput = document.getElementById('mini-game-answer');

        if (!questionEl || !feedbackEl || !progressEl || !nextBtn || !inputWrapper || !answerInput || !vocabSparkState) {
            return;
        }

        clearVocabSparkRevealTimer();

        questionEl.textContent = '🎉 恭喜完成词汇火花挑战！';
        questionEl.classList.remove('reveal');
        inputWrapper.classList.add('hidden');
        answerInput.disabled = true;
        answerInput.value = '';
        answerInput.classList.remove('is-error');

        feedbackEl.textContent = '本轮共答对 ' + vocabSparkState.score + ' / ' + vocabSparkState.total + ' 题';
        progressEl.textContent = '';
        nextBtn.textContent = '再来一局';
        nextBtn.disabled = false;
        nextBtn.dataset.gameAction = 'restart';
        vocabSparkState.phase = 'summary';
    }

    function evaluateVocabSparkAnswer() {
        if (!vocabSparkState || !vocabSparkState.current) {
            return;
        }

        var questionEl = document.getElementById('mini-game-question');
        var feedbackEl = document.getElementById('mini-game-feedback');
        var nextBtn = document.querySelector('.mini-game-next');
        var answerInput = document.getElementById('mini-game-answer');

        if (!questionEl || !feedbackEl || !nextBtn || !answerInput) {
            return;
        }

        var raw = answerInput.value || '';
        var normalized = raw.trim();
        if (!normalized) {
            feedbackEl.textContent = '请先输入与释义对应的英文单词。';
            answerInput.focus();
            return;
        }

        var expected = String(vocabSparkState.current.word || '').trim();
        if (normalized.toLowerCase() === expected.toLowerCase()) {
            vocabSparkState.queue.shift();
            vocabSparkState.completed += 1;
            vocabSparkState.score += 1;
            feedbackEl.textContent = '✅ 正确，继续下一题！';
            answerInput.value = '';
            answerInput.classList.remove('is-error');

            if (!vocabSparkState.queue.length) {
                renderVocabSparkSummary();
                return;
            }

            setTimeout(function () {
                renderVocabSparkQuestion();
            }, 360);
            return;
        }

        feedbackEl.textContent = '❌ 正确拼写：' + expected;
        answerInput.classList.add('is-error');
        answerInput.disabled = true;
        nextBtn.disabled = true;
        questionEl.classList.add('reveal');
        questionEl.textContent = '正确拼写：' + expected;
        vocabSparkState.phase = 'revealing';

        clearVocabSparkRevealTimer();
        vocabSparkState.revealTimer = setTimeout(function () {
            if (!vocabSparkState || vocabSparkState.phase === 'summary') {
                return;
            }

            questionEl.textContent = vocabSparkState.current.meaning;
            questionEl.classList.remove('reveal');
            answerInput.disabled = false;
            answerInput.value = '';
            answerInput.classList.remove('is-error');
            answerInput.focus();
            feedbackEl.textContent = '再试一次，把拼写牢记于心。';
            nextBtn.disabled = false;
            vocabSparkState.phase = 'answering';
        }, 3000);
    }

    function handleMiniGameNext(action) {
        if (action === 'restart') {
            startVocabSparkGame();
            return;
        }

        if (!vocabSparkState) {
            return;
        }

        if (vocabSparkState.phase === 'summary') {
            startVocabSparkGame();
            return;
        }

        if (vocabSparkState.phase === 'revealing') {
            return;
        }

        evaluateVocabSparkAnswer();
    }

    function closeMiniGame() {
        var modal = document.getElementById('mini-game-modal');
        if (!modal) {
            return;
        }

        clearVocabSparkRevealTimer();
        modal.classList.remove('active');
        modal.setAttribute('hidden', 'hidden');

        var questionEl = document.getElementById('mini-game-question');
        var feedbackEl = document.getElementById('mini-game-feedback');
        var progressEl = document.getElementById('mini-game-progress');
        var inputWrapper = document.getElementById('mini-game-input-wrapper');
        var answerInput = document.getElementById('mini-game-answer');

        if (questionEl) {
            questionEl.textContent = '准备好点燃词汇力了吗？';
            questionEl.classList.remove('reveal');
        }
        if (feedbackEl) {
            feedbackEl.textContent = '';
        }
        if (progressEl) {
            progressEl.textContent = '';
        }
        if (inputWrapper) {
            inputWrapper.classList.remove('hidden');
        }
        if (answerInput) {
            answerInput.value = '';
            answerInput.disabled = false;
            answerInput.classList.remove('is-error');
        }

        vocabSparkState = null;
    }

    function bindMiniGameModal() {
        var modal = document.getElementById('mini-game-modal');
        if (!modal) {
            return;
        }

        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                closeMiniGame();
                return;
            }

            var control = event.target.closest('[data-game-action]');
            if (control) {
                event.preventDefault();
                var action = control.dataset.gameAction;
                if (action === 'close') {
                    closeMiniGame();
                    return;
                }
                handleMiniGameNext(action);
            }
        });

        ensureVocabSparkInputBindings();
    }

    async function launchMiniGame(gameId) {
        if (gameId === 'vocab-spark') {
            await startVocabSparkGame();
            return;
        }

        if (typeof global.showMessage === 'function') {
            global.showMessage('小游戏即将上线，敬请期待', 'info');
        }
    }

    function init() {
        bindMiniGameModal();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.__legacyLaunchMiniGame = launchMiniGame;
    global.launchMiniGame = launchMiniGame;
    global.VocabSparkGame = {
        start: startVocabSparkGame,
        close: closeMiniGame
    };
})(typeof window !== 'undefined' ? window : this);
