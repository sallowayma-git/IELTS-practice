(function initMoreView(global) {
    'use strict';

    var moreViewInteractionsConfigured = false;

    var analogClockState = {
        overlay: null,
        canvas: null,
        ctx: null,
        frameId: null,
        running: false,
        cssSize: 0,
        ratio: typeof global !== 'undefined' && global.devicePixelRatio ? global.devicePixelRatio : 1
    };

    var CLOCK_VIEWS = ['analog', 'flip', 'digital', 'ambient'];

    var clockUIState = {
        overlayInner: null,
        viewStack: null,
        dots: [],
        activeView: 'analog',
        hideControlsTimer: null,
        pointerHandlersBound: false,
        fullscreenBtn: null,
        fullscreenEventsBound: false
    };

    var flipClockState = {
        container: null,
        digits: [],
        timerId: null,
        initialized: false
    };

    var digitalClockState = {
        container: null,
        timerId: null,
        lastRendered: '',
        renderOptions: {
            colonClass: 'digital-pulse'
        }
    };

    var ambientClockState = {
        container: null,
        timerId: null,
        lastRendered: '',
        renderOptions: {
            colonClass: 'ambient-clock__colon'
        }
    };

    function setupMoreViewInteractions() {
        if (moreViewInteractionsConfigured) {
            return;
        }

        var moreView = document.getElementById('more-view');
        var overlay = document.getElementById('fullscreen-clock-overlay');
        var canvas = document.getElementById('analog-clock-canvas');

        if (!moreView || !overlay || !canvas) {
            return;
        }

        var clockTrigger = moreView.querySelector('[data-action="open-clock"]');
        var vocabTrigger = moreView.querySelector('[data-action="open-vocab"]');
        var closeTrigger = overlay.querySelector('[data-action="close-clock"]');
        var overlayInner = overlay.querySelector('[data-clock-role="overlay-inner"]');
        var viewStack = overlay.querySelector('[data-clock-role="view-stack"]');
        var pagination = overlay.querySelector('[data-clock-role="pagination"]');
        var flipContainer = overlay.querySelector('#flip-clock');
        var digitalContainer = overlay.querySelector('#digital-clock');
        var ambientContainer = overlay.querySelector('#ambient-clock');
        var dots = pagination ? Array.from(pagination.querySelectorAll('.clock-dot')) : [];
        var fullscreenTrigger = overlay.querySelector('[data-action="toggle-clock-fullscreen"]');

        analogClockState.overlay = overlay;
        analogClockState.canvas = canvas;
        analogClockState.ratio = typeof global !== 'undefined' && global.devicePixelRatio ? global.devicePixelRatio : 1;

        clockUIState.overlayInner = overlayInner;
        clockUIState.viewStack = viewStack;
        clockUIState.dots = dots;
        clockUIState.activeView = 'analog';
        clockUIState.fullscreenBtn = fullscreenTrigger;
        updateClockFullscreenButtonState(isClockFullscreenActive());

        flipClockState.container = flipContainer;
        digitalClockState.container = digitalContainer;
        ambientClockState.container = ambientContainer;

        initializeFlipClock(flipContainer);

        if (clockTrigger) {
            clockTrigger.addEventListener('click', openClockOverlay);
        }

        if (closeTrigger) {
            closeTrigger.addEventListener('click', closeClockOverlay);
        }

        if (fullscreenTrigger) {
            fullscreenTrigger.addEventListener('click', handleClockFullscreenToggle);
        }

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                closeClockOverlay();
            }
        });

        if (dots.length) {
            dots.forEach(function (dot) {
                dot.addEventListener('click', function () { return handleClockPagination(dot.dataset.targetView); });
                dot.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleClockPagination(dot.dataset.targetView);
                    }
                });
            });
        }

        if (!clockUIState.pointerHandlersBound) {
            overlay.addEventListener('mousemove', handleClockPointerActivity, { passive: true });
            overlay.addEventListener('touchstart', handleClockPointerActivity, { passive: true });
            clockUIState.pointerHandlersBound = true;
        }

        bindClockFullscreenEvents();

        document.addEventListener('keydown', handleClockKeydown);
        global.addEventListener('resize', handleClockResize);

        if (vocabTrigger) {
            vocabTrigger.addEventListener('click', handleVocabEntry);
        }

        moreViewInteractionsConfigured = true;
    }

    function handleVocabEntry(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        var mountView = function () {
            if (global.VocabSessionView && typeof global.VocabSessionView.mount === 'function') {
                global.VocabSessionView.mount('#vocab-view');
            }
        };

        var vocabView = document.getElementById('vocab-view');
        if (vocabView) {
            vocabView.removeAttribute('hidden');
        }

        if (global.app && typeof global.app.navigateToView === 'function') {
            global.app.navigateToView('vocab');
            var moreNavBtn = document.querySelector('.nav-btn[data-view="more"]');
            if (moreNavBtn) {
                moreNavBtn.classList.add('active');
            }
            mountView();
            return;
        }

        var moreView = document.getElementById('more-view');
        if (vocabView && moreView) {
            moreView.classList.remove('active');
            vocabView.classList.add('active');
            var moreNavBtn2 = document.querySelector('.nav-btn[data-view="more"]');
            if (moreNavBtn2) {
                moreNavBtn2.classList.add('active');
            }
            mountView();
            return;
        }

        if (typeof global.showMessage === 'function') {
            global.showMessage('未能打开词汇视图，请检查页面结构。', 'warning');
        } else if (typeof global.alert === 'function') {
            global.alert('未能打开词汇视图，请检查页面结构。');
        }
    }

    function handleClockPagination(targetView) {
        if (!targetView) {
            return;
        }

        var normalized = String(targetView).toLowerCase();
        if (CLOCK_VIEWS.indexOf(normalized) === -1) {
            return;
        }

        setActiveClockView(normalized);
        showClockControlsTemporarily();
    }

    function handleClockPointerActivity() {
        if (!analogClockState.overlay || analogClockState.overlay.classList.contains('is-hidden')) {
            return;
        }
        showClockControlsTemporarily();
    }

    function showClockControlsTemporarily() {
        if (!clockUIState.overlayInner) {
            return;
        }

        clockUIState.overlayInner.classList.remove('controls-hidden');

        if (clockUIState.hideControlsTimer) {
            global.clearTimeout(clockUIState.hideControlsTimer);
        }

        clockUIState.hideControlsTimer = global.setTimeout(function () {
            if (analogClockState.overlay && !analogClockState.overlay.classList.contains('is-hidden')) {
                if (clockUIState.overlayInner) {
                    clockUIState.overlayInner.classList.add('controls-hidden');
                }
            }
        }, 2400);
    }

    function hideClockControlsImmediately() {
        if (clockUIState.hideControlsTimer) {
            global.clearTimeout(clockUIState.hideControlsTimer);
            clockUIState.hideControlsTimer = null;
        }

        if (clockUIState.overlayInner) {
            clockUIState.overlayInner.classList.add('controls-hidden');
        }
    }

    function resetClockViewsToAnalog() {
        if (clockUIState.viewStack) {
            var panels = clockUIState.viewStack.querySelectorAll('.clock-view');
            panels.forEach(function (panel) {
                if (panel.dataset.clockView === 'analog') {
                    panel.classList.add('is-active');
                } else {
                    panel.classList.remove('is-active');
                }
            });
        }

        if (clockUIState.dots.length) {
            clockUIState.dots.forEach(function (dot) {
                if (dot.dataset.targetView === 'analog') {
                    dot.classList.add('is-active');
                } else {
                    dot.classList.remove('is-active');
                }
            });
        }

        clockUIState.activeView = 'analog';
    }

    function setActiveClockView(viewName, options) {
        if (options === void 0) { options = {}; }
        var normalized = viewName ? String(viewName).toLowerCase() : '';
        if (CLOCK_VIEWS.indexOf(normalized) === -1) {
            return;
        }

        var force = Boolean(options.force);
        if (!force && clockUIState.activeView === normalized) {
            return;
        }

        stopClockView(clockUIState.activeView);

        if (clockUIState.viewStack) {
            var panels = clockUIState.viewStack.querySelectorAll('.clock-view');
            panels.forEach(function (panel) {
                if (panel.dataset.clockView === normalized) {
                    panel.classList.add('is-active');
                } else {
                    panel.classList.remove('is-active');
                }
            });
        }

        if (clockUIState.dots.length) {
            clockUIState.dots.forEach(function (dot) {
                if (dot.dataset.targetView === normalized) {
                    dot.classList.add('is-active');
                } else {
                    dot.classList.remove('is-active');
                }
            });
        }

        clockUIState.activeView = normalized;
        startClockView(normalized);
    }

    function startClockView(viewName) {
        if (viewName === 'analog') {
            startAnalogClock();
            return;
        }

        if (viewName === 'flip') {
            startFlipClock();
            return;
        }

        if (viewName === 'digital') {
            startDigitalClock();
            return;
        }

        if (viewName === 'ambient') {
            startAmbientClock();
        }
    }

    function stopClockView(viewName) {
        if (viewName === 'analog') {
            stopAnalogClock();
            return;
        }

        if (viewName === 'flip') {
            stopFlipClock();
            return;
        }

        if (viewName === 'digital') {
            stopDigitalClock();
            return;
        }

        if (viewName === 'ambient') {
            stopAmbientClock();
        }
    }

    function initializeFlipClock(container) {
        if (!container || flipClockState.initialized) {
            return;
        }

        var template = [
            { type: 'digit', slot: 'hours-ten' },
            { type: 'digit', slot: 'hours-one' },
            { type: 'separator', label: ':' },
            { type: 'digit', slot: 'minutes-ten' },
            { type: 'digit', slot: 'minutes-one' },
            { type: 'separator', label: ':' },
            { type: 'digit', slot: 'seconds-ten' },
            { type: 'digit', slot: 'seconds-one' }
        ];

        container.innerHTML = '';

        var digits = [];

        template.forEach(function (item) {
            if (item.type === 'separator') {
                var separator = document.createElement('span');
                separator.className = 'flip-separator';
                separator.textContent = item.label;
                separator.setAttribute('aria-hidden', 'true');
                container.appendChild(separator);
                return;
            }

            var digit = document.createElement('div');
            digit.className = 'flip-digit';
            digit.dataset.slot = item.slot;
            digit.dataset.currentValue = '0';
            digit.dataset.nextValue = '';
            digit.dataset.isRolling = 'false';
            digit.dataset.pendingValue = '';

            var current = document.createElement('span');
            current.className = 'digit-current';
            current.textContent = '0';

            var next = document.createElement('span');
            next.className = 'digit-next';
            next.textContent = '0';

            digit.appendChild(current);
            digit.appendChild(next);

            var record = { root: digit, current: current, next: next };
            digit.__clockDigit = record;

            bindRollingDigitAnimations(digit);
            container.appendChild(digit);
            digits.push(record);
        });

        flipClockState.container = container;
        flipClockState.digits = digits;
        flipClockState.initialized = true;
        renderFlipClock(true);
    }

    function bindRollingDigitAnimations(digitEl) {
        if (!digitEl || digitEl.dataset.animationBound === 'true') {
            return;
        }

        digitEl.addEventListener('animationend', function (event) {
            if (!digitEl.classList.contains('is-rolling')) {
                return;
            }

            if (!event.target.classList.contains('digit-next')) {
                return;
            }

            finalizeRollingDigit(digitEl);
        });

        digitEl.dataset.animationBound = 'true';
    }

    function finalizeRollingDigit(digitEl) {
        var record = digitEl.__clockDigit;
        if (!record) {
            return;
        }

        var committed = digitEl.dataset.nextValue || digitEl.dataset.currentValue || '0';
        digitEl.dataset.currentValue = committed;
        digitEl.dataset.nextValue = '';
        digitEl.dataset.isRolling = 'false';
        digitEl.classList.remove('is-rolling');

        record.current.textContent = committed;
        record.next.textContent = committed;

        var pending = digitEl.dataset.pendingValue;
        if (pending && pending !== committed) {
            digitEl.dataset.pendingValue = '';
            global.requestAnimationFrame(function () {
                rollDigitToValue(record, pending);
            });
        } else {
            digitEl.dataset.pendingValue = '';
        }
    }

    function startFlipClock() {
        if (!flipClockState.container) {
            return;
        }

        stopFlipClock();
        renderFlipClock(true);
        scheduleFlipClockTick();
    }

    function scheduleFlipClockTick() {
        var now = new Date();
        var delay = Math.max(50, 1000 - now.getMilliseconds());
        flipClockState.timerId = global.setTimeout(function () {
            renderFlipClock(false);
            scheduleFlipClockTick();
        }, delay);
    }

    function renderFlipClock(initialRender) {
        if (!flipClockState.container || !flipClockState.digits.length) {
            return;
        }

        var now = new Date();
        var hours = formatTwoDigits(now.getHours());
        var minutes = formatTwoDigits(now.getMinutes());
        var seconds = formatTwoDigits(now.getSeconds());
        var values = [
            hours.charAt(0),
            hours.charAt(1),
            minutes.charAt(0),
            minutes.charAt(1),
            seconds.charAt(0),
            seconds.charAt(1)
        ];

        flipClockState.digits.forEach(function (digitRecord, index) {
            var nextValue = values[index] || '0';
            if (initialRender) {
                setRollingDigitImmediate(digitRecord, nextValue);
            } else {
                rollDigitToValue(digitRecord, nextValue);
            }
        });
    }

    function setRollingDigitImmediate(digitRecord, value) {
        if (!digitRecord || !digitRecord.root) {
            return;
        }

        var digitEl = digitRecord.root;
        digitEl.dataset.currentValue = value;
        digitEl.dataset.nextValue = '';
        digitEl.dataset.isRolling = 'false';
        digitEl.dataset.pendingValue = '';
        digitEl.classList.remove('is-rolling');

        if (digitRecord.current) {
            digitRecord.current.textContent = value;
        }

        if (digitRecord.next) {
            digitRecord.next.textContent = value;
        }
    }

    function rollDigitToValue(digitRecord, value) {
        if (!digitRecord || !digitRecord.root) {
            return;
        }

        var digitEl = digitRecord.root;
        var currentValue = digitEl.dataset.currentValue || '0';

        if (digitEl.dataset.isRolling === 'true') {
            digitEl.dataset.pendingValue = value;
            return;
        }

        if (currentValue === value) {
            return;
        }

        digitEl.dataset.pendingValue = '';
        digitEl.dataset.nextValue = value;
        digitEl.dataset.isRolling = 'true';

        if (digitRecord.current) {
            digitRecord.current.textContent = currentValue;
        }

        if (digitRecord.next) {
            digitRecord.next.textContent = value;
        }

        digitEl.classList.remove('is-rolling');
        void digitEl.offsetWidth;
        digitEl.classList.add('is-rolling');
    }

    function stopFlipClock() {
        if (flipClockState.timerId) {
            global.clearTimeout(flipClockState.timerId);
            flipClockState.timerId = null;
        }

        flipClockState.digits.forEach(function (digitRecord) {
            if (!digitRecord || !digitRecord.root) {
                return;
            }
            var digitEl = digitRecord.root;
            digitEl.classList.remove('is-rolling');
            digitEl.dataset.isRolling = 'false';
            digitEl.dataset.nextValue = '';
            digitEl.dataset.pendingValue = '';
            var currentValue = digitEl.dataset.currentValue || '0';
            if (digitRecord.current) {
                digitRecord.current.textContent = currentValue;
            }
            if (digitRecord.next) {
                digitRecord.next.textContent = currentValue;
            }
        });
    }

    function startDigitalClock() {
        startSimpleDigitalClock(digitalClockState);
    }

    function stopDigitalClock() {
        stopSimpleDigitalClock(digitalClockState);
    }

    function startAmbientClock() {
        startSimpleDigitalClock(ambientClockState);
    }

    function stopAmbientClock() {
        stopSimpleDigitalClock(ambientClockState);
    }

    function startSimpleDigitalClock(state) {
        if (!state || !state.container) {
            return;
        }

        stopSimpleDigitalClock(state);
        renderSimpleDigitalClock(state);
        scheduleSimpleDigitalClockTick(state);
    }

    function scheduleSimpleDigitalClockTick(state) {
        if (!state) {
            return;
        }

        var now = new Date();
        var delay = Math.max(50, 1000 - now.getMilliseconds());
        state.timerId = global.setTimeout(function () {
            renderSimpleDigitalClock(state);
            scheduleSimpleDigitalClockTick(state);
        }, delay);
    }

    function renderSimpleDigitalClock(state) {
        if (!state || !state.container) {
            return;
        }

        var now = new Date();
        var hours = formatTwoDigits(now.getHours());
        var minutes = formatTwoDigits(now.getMinutes());
        var seconds = formatTwoDigits(now.getSeconds());
        var timeString = hours + ':' + minutes + ':' + seconds;

        if (state.lastRendered === timeString) {
            return;
        }

        state.lastRendered = timeString;
        var colonClass = state.renderOptions && state.renderOptions.colonClass ? state.renderOptions.colonClass : '';
        var colonMarkup = colonClass ? '<span class=\"' + colonClass + '\">:</span>' : ':';
        state.container.innerHTML = '' + hours + colonMarkup + minutes + colonMarkup + seconds;
    }

    function stopSimpleDigitalClock(state) {
        if (!state) {
            return;
        }

        if (state.timerId) {
            global.clearTimeout(state.timerId);
            state.timerId = null;
        }

        state.lastRendered = '';
    }

    function formatTwoDigits(value) {
        return String(value).padStart(2, '0');
    }

    function openClockOverlay(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (!analogClockState.overlay) {
            return;
        }

        analogClockState.overlay.classList.remove('is-hidden');
        document.body.classList.add('no-scroll');
        setActiveClockView('analog', { force: true });
        showClockControlsTemporarily();
        updateClockFullscreenButtonState(isClockFullscreenActive());
    }

    function closeClockOverlay() {
        if (!analogClockState.overlay) {
            return;
        }

        exitClockFullscreen();
        analogClockState.overlay.classList.add('is-hidden');
        document.body.classList.remove('no-scroll');
        stopAnalogClock();
        stopFlipClock();
        stopDigitalClock();
        stopAmbientClock();
        hideClockControlsImmediately();
        resetClockViewsToAnalog();
    }

    function handleClockKeydown(event) {
        if (!analogClockState.overlay || !event) {
            return;
        }

        if (event.key === 'Escape' && !analogClockState.overlay.classList.contains('is-hidden')) {
            event.preventDefault();
            closeClockOverlay();
        }
    }

    function handleClockResize() {
        if (!analogClockState.overlay || analogClockState.overlay.classList.contains('is-hidden')) {
            return;
        }

        if (clockUIState.activeView !== 'analog') {
            return;
        }

        resizeClockCanvas(false);
        drawAnalogClock();
    }

    function resizeClockCanvas(force) {
        if (!analogClockState.canvas) {
            return;
        }

        var ratio = typeof global !== 'undefined' && global.devicePixelRatio ? global.devicePixelRatio : 1;
        var viewportMin = Math.min(global.innerWidth || 0, global.innerHeight || 0) || 0;
        var targetSize = viewportMin || 600;
        var cssSize = viewportMin ? Math.round(targetSize) : 600;

        if (!force && analogClockState.cssSize === cssSize && analogClockState.ratio === ratio && analogClockState.ctx) {
            return;
        }

        analogClockState.cssSize = cssSize;
        analogClockState.ratio = ratio;

        var canvas = analogClockState.canvas;
        canvas.style.width = cssSize + 'px';
        canvas.style.height = cssSize + 'px';
        canvas.width = Math.floor(cssSize * ratio);
        canvas.height = Math.floor(cssSize * ratio);

        var context = canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(ratio, ratio);
        analogClockState.ctx = context;
    }

    function startAnalogClock() {
        resizeClockCanvas(true);

        if (analogClockState.running) {
            return;
        }

        analogClockState.running = true;

        var tick = function () {
            if (!analogClockState.running) {
                return;
            }
            drawAnalogClock();
            analogClockState.frameId = global.requestAnimationFrame(tick);
        };

        tick();
    }

    function stopAnalogClock() {
        analogClockState.running = false;
        if (analogClockState.frameId) {
            global.cancelAnimationFrame(analogClockState.frameId);
            analogClockState.frameId = null;
        }
    }

    function drawAnalogClock() {
        var ctx = analogClockState.ctx;
        var size = analogClockState.cssSize;

        if (!ctx || !size) {
            return;
        }

        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);
        ctx.translate(size / 2, size / 2);

        var radius = size / 2;
        renderClockDial(ctx, radius);
        renderClockTicks(ctx, radius);
        renderMinuteNumerals(ctx, radius);
        renderHourNumerals(ctx, radius);
        renderClockHands(ctx, radius);

        ctx.restore();
    }

    function renderClockDial(ctx, radius) {
        // 保留空实现以兼容原逻辑
    }

    function renderClockTicks(ctx, radius) {
        var outerRadius = radius * 0.9;
        var majorInner = radius * 0.68;
        var minorInner = radius * 0.76;

        for (var i = 0; i < 60; i += 1) {
            var angle = (Math.PI / 30) * i;
            ctx.save();
            ctx.rotate(angle);
            ctx.beginPath();
            if (i % 5 === 0) {
                ctx.lineWidth = Math.max(4, radius * 0.013);
                ctx.strokeStyle = '#ffffff';
                ctx.moveTo(0, -outerRadius);
                ctx.lineTo(0, -majorInner);
            } else {
                ctx.lineWidth = Math.max(2, radius * 0.006);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                ctx.moveTo(0, -outerRadius);
                ctx.lineTo(0, -minorInner);
            }
            ctx.stroke();
            ctx.restore();
        }
    }

    function renderMinuteNumerals(ctx, radius) {
        var fontSize = Math.max(14, radius * 0.078);
        ctx.font = '600 ' + fontSize + 'px \"Inter\", \"SF Pro Display\", \"Segoe UI\", sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (var minute = 5; minute <= 60; minute += 5) {
            var label = minute === 60 ? '60' : String(minute);
            var angle = (Math.PI / 30) * (minute - 15);
            var radialOffset = radius * 0.96;
            var x = Math.cos(angle) * radialOffset;
            var y = Math.sin(angle) * radialOffset;
            ctx.fillText(label, x, y);
        }
    }

    function bindClockFullscreenEvents() {
        if (clockUIState.fullscreenEventsBound) {
            return;
        }

        var handler = handleClockFullscreenChange;
        var eventNames = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
        eventNames.forEach(function (eventName) {
            if (typeof document.addEventListener === 'function') {
                document.addEventListener(eventName, handler);
            }
        });

        clockUIState.fullscreenEventsBound = true;
    }

    function handleClockFullscreenToggle(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        if (isClockFullscreenActive()) {
            exitClockFullscreen();
        } else {
            requestClockFullscreen();
        }
    }

    function handleClockFullscreenChange() {
        updateClockFullscreenButtonState(isClockFullscreenActive());
    }

    function requestClockFullscreen() {
        var overlay = analogClockState.overlay;
        if (!overlay) {
            return;
        }

        var request = overlay.requestFullscreen
            || overlay.webkitRequestFullscreen
            || overlay.mozRequestFullScreen
            || overlay.msRequestFullscreen;

        if (typeof request !== 'function') {
            return;
        }

        try {
            var result = request.call(overlay, { navigationUI: 'hide' });
            if (result && typeof result.catch === 'function') {
                result.catch(function () { });
            }
        } catch (error) {
            try {
                var fallback = request.call(overlay);
                if (fallback && typeof fallback.catch === 'function') {
                    fallback.catch(function () { });
                }
            } catch (_) {
                // ignore unsupported fullscreen options
            }
        }
    }

    function exitClockFullscreen() {
        if (!isClockFullscreenActive()) {
            updateClockFullscreenButtonState(false);
            return;
        }

        var exit = document.exitFullscreen
            || document.webkitExitFullscreen
            || document.mozCancelFullScreen
            || document.msExitFullscreen;

        if (typeof exit !== 'function') {
            return;
        }

        try {
            var result = exit.call(document);
            if (result && typeof result.catch === 'function') {
                result.catch(function () { });
            }
        } catch (_) {
            // ignore errors from exiting fullscreen
        }
    }

    function updateClockFullscreenButtonState(active) {
        var button = clockUIState.fullscreenBtn;
        if (!button) {
            return;
        }

        var isActive = typeof active === 'boolean' ? active : isClockFullscreenActive();
        button.classList.toggle('is-fullscreen', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        button.setAttribute('aria-label', isActive ? '退出全屏模式' : '切换全屏模式');
    }

    function isClockFullscreenActive() {
        var element = getFullscreenElement();
        if (!element || !analogClockState.overlay) {
            return false;
        }

        return element === analogClockState.overlay || analogClockState.overlay.contains(element);
    }

    function getFullscreenElement() {
        return document.fullscreenElement
            || document.webkitFullscreenElement
            || document.mozFullScreenElement
            || document.msFullscreenElement
            || null;
    }

    function renderHourNumerals(ctx, radius) {
        var fontSize = Math.max(28, radius * 0.18);
        ctx.font = '700 ' + fontSize + 'px \"Inter\", \"SF Pro Display\", \"Segoe UI\", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (var hour = 1; hour <= 12; hour += 1) {
            var angle = (Math.PI / 6) * (hour - 3);
            var x = Math.cos(angle) * (radius * 0.52);
            var y = Math.sin(angle) * (radius * 0.52);
            ctx.fillText(String(hour), x, y);
        }
    }

    function renderClockHands(ctx, radius) {
        var now = new Date();
        var milliseconds = now.getMilliseconds();
        var seconds = now.getSeconds() + milliseconds / 1000;
        var minutes = now.getMinutes() + seconds / 60;
        var hours = (now.getHours() % 12) + minutes / 60;

        drawClockHand(ctx, (Math.PI / 6) * hours, radius * 0.5, Math.max(10, radius * 0.04), '#7ddad3');
        drawClockHand(ctx, (Math.PI / 30) * minutes, radius * 0.72, Math.max(8, radius * 0.028), '#ffffff');
        drawSecondHand(ctx, (Math.PI / 30) * seconds, radius * 0.82, '#f5a623');

        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(0, 0, Math.max(6, radius * 0.04), 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.fillStyle = '#f5a623';
        ctx.arc(0, 0, Math.max(3, radius * 0.022), 0, Math.PI * 2);
        ctx.fill();
    }

    function drawClockHand(ctx, angle, length, width, color) {
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.moveTo(0, length * 0.12);
        ctx.lineTo(0, -length);
        ctx.stroke();
        ctx.restore();
    }

    function drawSecondHand(ctx, angle, length, color) {
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, length * 0.02);
        ctx.lineCap = 'round';
        ctx.moveTo(0, length * 0.18);
        ctx.lineTo(0, -length);
        ctx.stroke();
        ctx.restore();
    }

    function init() {
        setupMoreViewInteractions();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    global.ensureMoreView = setupMoreViewInteractions;
})(typeof window !== 'undefined' ? window : this);
