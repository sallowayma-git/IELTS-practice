(function initDeveloperTeamModal(global) {
    'use strict';

    function getModal() {
        return document.getElementById('developer-modal');
    }

    if (typeof global.showDeveloperTeam !== 'function') {
        global.showDeveloperTeam = function showDeveloperTeam() {
            var modal = getModal();
            if (modal) {
                modal.classList.add('show');
            }
        };
    }

    if (typeof global.hideDeveloperTeam !== 'function') {
        global.hideDeveloperTeam = function hideDeveloperTeam() {
            var modal = getModal();
            if (modal) {
                modal.classList.remove('show');
            }
        };
    }

    function setupDismissHandlers() {
        var modal = getModal();
        if (!modal || modal.dataset.dismissBound === '1') {
            return;
        }

        modal.addEventListener('click', function onBackdropClick(event) {
            if (event.target === modal) {
                global.hideDeveloperTeam();
            }
        });

        modal.dataset.dismissBound = '1';
    }

    function handleEscape(event) {
        if (event.key !== 'Escape') {
            return;
        }
        var modal = getModal();
        if (modal && modal.classList.contains('show')) {
            global.hideDeveloperTeam();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupDismissHandlers);
    } else {
        setupDismissHandlers();
    }

    document.addEventListener('keydown', handleEscape);
})(typeof window !== 'undefined' ? window : this);
