/**
 * Library manager panel component.
 *
 * Unifies the three legacy settings buttons (#load-library-btn,
 * #library-config-btn, #force-refresh-btn) into a single "题库管理" entry.
 * Clicking the entry opens a theme-style modal that hosts:
 *   - the library configuration list (previously rendered inline into
 *     #settings-view, now mounted into the modal body),
 *   - the "加载题库" action (delegates to showLibraryLoaderModal / loadLibrary),
 *   - the "强制刷新题库" action (delegates to loadLibrary(true)).
 *
 * Follows the same modal pattern as practiceSettingsPanel.js: the component
 * owns its markup, appends the modal to document.body at load time, and
 * exposes open()/close() on a global. indexInteractions.js binds the entry
 * button to open(). The existing renderLibraryConfigList() in main.js mounts
 * the .library-config-list host into this modal's body container, so switching
 * / deleting a config still refreshes the list in place.
 *
 * Element ids / classes inside the modal are preserved where they predate
 * this component (the config list rendering depends on them). The two action
 * buttons keep their original ids (#load-library-btn, #force-refresh-btn) so
 * the existing indexInteractions.js bindings continue to resolve them after
 * they move into the modal — only the dedicated #library-config-btn is removed
 * (its handler is now the modal's own open() call).
 */
(function (global) {
    'use strict';

    var MODAL_ID = 'library-manager-modal';
    var ENTRY_ID = 'library-manager-btn';
    var BODY_ID = 'library-manager-modal-body';
    var modal = null;

    function buildModalMarkup() {
        return [
            '<div id="' + MODAL_ID + '" class="theme-modal library-manager-modal shui-secondary-modal shui-secondary-modal--lg" role="dialog" aria-modal="true" aria-labelledby="library-manager-title">',
            '    <div class="theme-modal-content shui-secondary-modal__content">',
            '        <div class="theme-modal-header shui-secondary-modal__header">',
            '            <div class="shui-secondary-modal__title-group">',
            '                <div class="shui-secondary-modal__eyebrow">LIBRARY</div>',
            '                <h3 id="library-manager-title">题库管理</h3>',
            '            </div>',
            '            <button class="theme-modal-close" type="button" aria-label="关闭">&times;</button>',
            '        </div>',
            '        <div class="theme-modal-body library-manager-modal__body shui-secondary-modal__body">',
            '            <div class="library-manager-modal__section">',
            '                <div class="library-manager-modal__section-head">',
            '                    <h4>题库配置列表</h4>',
            '                    <p class="library-manager-modal__hint">在下方切换或删除已导入的题库配置。</p>',
            '                </div>',
            '                <div id="' + BODY_ID + '" class="library-manager-modal__config-host"></div>',
            '            </div>',
            '            <div class="library-manager-modal__section library-manager-modal__actions">',
            '                <div class="library-manager-modal__section-head">',
            '                    <h4>题库操作</h4>',
            '                    <p class="library-manager-modal__hint">加载新题库或强制刷新当前题库索引。</p>',
            '                </div>',
            '                <div class="library-manager-modal__action-row">',
            '                    <button class="btn data-mgmt-btn" id="load-library-btn" type="button">📂 加载题库</button>',
            '                    <button class="btn data-mgmt-btn" id="force-refresh-btn" type="button">🔄 强制刷新题库</button>',
            '                </div>',
            '            </div>',
            '        </div>',
            '    </div>',
            '</div>'
        ].join('\n');
    }

    function openModal() {
        if (!modal) {
            return;
        }
        modal.classList.add('show');
        // Lazily render the config list once the modal is open, then refresh on
        // every subsequent open so it reflects the latest storage state.
        renderConfigListIntoModal();
    }

    function closeModal() {
        if (modal) {
            modal.classList.remove('show');
        }
    }

    function renderConfigListIntoModal() {
        var body = modal && modal.querySelector('#' + BODY_ID);
        if (!body) {
            return;
        }
        // showLibraryConfigListV2 (boot-fallback, always available once
        // legacy-app loads) accepts a containerId option and delegates to
        // renderLibraryConfigList when main.js has loaded, falling back to its
        // own inline renderer otherwise. Both paths mount the .library-config-list
        // host into the container we pass here.
        try {
            if (typeof global.showLibraryConfigListV2 === 'function') {
                global.showLibraryConfigListV2({ containerId: BODY_ID });
                return;
            }
        } catch (error) {
            console.warn('[LibraryManagerPanel] showLibraryConfigListV2 调用失败:', error);
        }

        // Direct fallback if the boot-fallback shim is somehow absent.
        try {
            if (typeof global.renderLibraryConfigList === 'function') {
                global.renderLibraryConfigList({ containerId: BODY_ID, allowDelete: true });
            }
        } catch (error) {
            console.warn('[LibraryManagerPanel] renderLibraryConfigList 调用失败:', error);
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
        if (global.__libraryManagerPanelInitialized) {
            return;
        }
        global.__libraryManagerPanelInitialized = true;

        var wrapper = document.createElement('div');
        wrapper.innerHTML = buildModalMarkup();
        modal = wrapper.firstElementChild;
        if (modal && document.body) {
            document.body.appendChild(modal);
        }
        bindEvents();
    }

    // Render synchronously at module load so the modal exists in the DOM before
    // indexInteractions.js binds the entry button and before the lazy-loaded
    // main.js renderLibraryConfigList resolves the container.
    init();

    global.LibraryManagerPanel = {
        open: openModal,
        close: closeModal,
        getBodyId: function () { return BODY_ID; },
        renderConfigList: renderConfigListIntoModal
    };
})(window);
