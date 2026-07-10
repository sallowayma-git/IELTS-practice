/**
 * Practice settings panel component.
 *
 * Renders the "Practice header code" and "Practice timer" cards as secondary
 * cards inside a modal, opened from an entry button on the settings page.
 * This moves the previously-inline cards out of index.html into a component,
 * matching the theme-switcher.js pattern (the component owns its markup and
 * the open/close behaviour).
 *
 * All element ids / classes / data-attributes are preserved so the existing
 * setup logic in js/app/main-entry.js keeps working once the modal is in the DOM.
 */
(function (global) {
    'use strict';

    var MODAL_ID = 'practice-settings-modal';
    var ENTRY_ID = 'practice-settings-entry-btn';
    var modal = null;

    function buildModalMarkup() {
        return [
            '<div id="' + MODAL_ID + '" class="theme-modal" role="dialog" aria-modal="true" aria-labelledby="practice-settings-title">',
            '    <div class="theme-modal-content">',
            '        <div class="theme-modal-header">',
            '            <h3 id="practice-settings-title">练习设置</h3>',
            '            <button class="theme-modal-close" type="button" aria-label="关闭">&times;</button>',
            '        </div>',
            '        <div class="theme-modal-body">',
            '            <div class="practice-settings-cards">',

            '                <div class="practice-sub-card">',
            '                    <h3>练习头部编码</h3>',
            '                    <p class="hero-panel__muted">控制练习页顶部栏显示的 6 位编码。</p>',
            '                    <div class="reading-candidate-code-settings">',
            '                        <label class="reading-candidate-code-option">',
            '                            <input type="radio" name="reading-candidate-code-mode" value="auto" checked />',
            '                            <span><strong>自动</strong><small>根据当前练习会话自动生成 6 位编码。</small></span>',
            '                        </label>',
            '                        <label class="reading-candidate-code-option">',
            '                            <input type="radio" name="reading-candidate-code-mode" value="custom" />',
            '                            <span><strong>自定义</strong><small>始终显示你指定的 6 位编码。</small></span>',
            '                        </label>',
            '                        <div class="reading-candidate-code-controls">',
            '                            <input id="reading-candidate-code-input" class="reading-candidate-code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="797618" aria-label="练习页顶部栏 6 位编码" disabled />',
            '                            <button class="btn hero-btn data-mgmt-btn" id="reading-candidate-code-random-btn" type="button">随机</button>',
            '                            <button class="btn hero-btn data-mgmt-btn" id="reading-candidate-code-save-btn" type="button">保存</button>',
            '                        </div>',
            '                        <div class="reading-candidate-code-status" id="reading-candidate-code-status" role="status" aria-live="polite"></div>',
            '                    </div>',
            '                </div>',

            '                <div class="practice-sub-card">',
            '                    <h3>练习计时</h3>',
            '                    <p class="hero-panel__muted">阅读与听力保持各自的计时偏好。</p>',
            '                    <div class="practice-timer-settings">',
            '                        <section class="practice-timer-card" data-timer-scope="reading">',
            '                            <div class="practice-timer-card__header">',
            '                                <h4>阅读计时</h4>',
            '                                <span id="reading-timer-status" class="practice-timer-status" role="status" aria-live="polite"></span>',
            '                            </div>',
            '                            <div class="practice-timer-grid">',
            '                                <label class="practice-timer-field"><span>计时模式</span><select data-timer-field="mode"><option value="elapsed">正计时</option><option value="countdown">倒计时</option></select></label>',
            '                                <label class="practice-timer-field"><span>倒计时分钟数</span><input type="number" min="1" max="240" step="1" data-timer-field="countdownMinutes" /></label>',
            '                                <label class="practice-timer-field practice-timer-check"><input type="checkbox" data-timer-field="limitEnabled" /><span>启用最长用时限制</span></label>',
            '                                <label class="practice-timer-field"><span>最长用时分钟数</span><input type="number" min="1" max="240" step="1" data-timer-field="limitMinutes" /></label>',
            '                                <label class="practice-timer-field"><span>到时处理</span><select data-timer-field="expiryAction"><option value="warn">仅提醒</option><option value="auto-submit">自动提交</option><option value="lock">锁定答案</option></select></label>',
            '                            </div>',
            '                            <button class="btn hero-btn data-mgmt-btn practice-timer-save" type="button" data-timer-save>保存阅读设置</button>',
            '                        </section>',
            '                        <section class="practice-timer-card" data-timer-scope="listening">',
            '                            <div class="practice-timer-card__header">',
            '                                <h4>听力计时</h4>',
            '                                <span id="listening-timer-status" class="practice-timer-status" role="status" aria-live="polite"></span>',
            '                            </div>',
            '                            <div class="practice-timer-grid">',
            '                                <label class="practice-timer-field"><span>计时模式</span><select data-timer-field="mode"><option value="elapsed">正计时</option><option value="countdown">倒计时</option></select></label>',
            '                                <label class="practice-timer-field"><span>倒计时分钟数</span><input type="number" min="1" max="240" step="1" data-timer-field="countdownMinutes" /></label>',
            '                                <label class="practice-timer-field practice-timer-check"><input type="checkbox" data-timer-field="limitEnabled" /><span>启用最长用时限制</span></label>',
            '                                <label class="practice-timer-field"><span>最长用时分钟数</span><input type="number" min="1" max="240" step="1" data-timer-field="limitMinutes" /></label>',
            '                                <label class="practice-timer-field"><span>到时处理</span><select data-timer-field="expiryAction"><option value="warn">仅提醒</option><option value="auto-submit">自动提交</option><option value="lock">锁定答案</option></select></label>',
            '                            </div>',
            '                            <button class="btn hero-btn data-mgmt-btn practice-timer-save" type="button" data-timer-save>保存听力设置</button>',
            '                        </section>',
            '                    </div>',
            '                </div>',

            '            </div>',
            '        </div>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    function openModal() {
        if (modal) {
            modal.classList.add('show');
        }
    }

    function closeModal() {
        if (modal) {
            modal.classList.remove('show');
        }
    }

    function bindEvents() {
        var entry = document.getElementById(ENTRY_ID);
        if (entry) {
            entry.addEventListener('click', openModal);
        }
        if (!modal) {
            return;
        }
        var closeBtn = modal.querySelector('.theme-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        // Click on the backdrop (but not the content) closes the modal.
        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                closeModal();
            }
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && modal.classList.contains('show')) {
                closeModal();
            }
        });
    }

    function init() {
        if (global.__practiceSettingsPanelInitialized) {
            return;
        }
        global.__practiceSettingsPanelInitialized = true;

        var wrapper = document.createElement('div');
        wrapper.innerHTML = buildModalMarkup();
        modal = wrapper.firstElementChild;
        if (modal && document.body) {
            document.body.appendChild(modal);
        }
        bindEvents();
    }

    // Render synchronously at module load so the cards exist in the DOM before
    // main-entry.js runs its setup logic (which queries them by id / class).
    init();

    global.PracticeSettingsPanel = {
        open: openModal,
        close: closeModal
    };
})(window);
