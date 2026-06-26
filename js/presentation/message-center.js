(function (global) {
    'use strict';

    const MAX_MESSAGE_TEXT_LENGTH = 500;
    const MESSAGE_SECRET_QUERY_PATTERN = /([?&](?:access_token|auth|authorization|code|csrf|csrfToken|otp|passcode|password|recoveryCode|recovery_code|secret|session|sessionId|sid|state|ticket|totp|totpToken|token)=)[^&#\s'"<>]+/gi;
    const MESSAGE_SECRET_VALUE_PATTERN = /\b((?:access[_-]?token|auth|authorization|code|csrf(?:Token)?|otp|passcode|password|recovery[_-]?code|secret|session(?:Id)?|sid|state|ticket|totp(?:Token)?|token)(?:[_-]?[A-Za-z0-9]*)?)\s*[:=]\s*([^&\s'"<>]+)/gi;

    function ensureContainer(containerId) {
        if (typeof document === 'undefined') {
            return null;
        }
        let node = document.getElementById(containerId);
        if (!node) {
            node = document.createElement('div');
            node.id = containerId;
            node.className = 'message-container';
            document.body.appendChild(node);
        }
        return node;
    }

    function normalizeMessageType(type) {
        const value = String(type || '').trim().toLowerCase();
        return ['info', 'success', 'warning', 'error'].includes(value) ? value : 'info';
    }

    function truncateMessageText(text) {
        if (text.length <= MAX_MESSAGE_TEXT_LENGTH) {
            return text;
        }
        let truncated = text.slice(0, MAX_MESSAGE_TEXT_LENGTH - 3);
        if (/[\uD800-\uDBFF]$/.test(truncated)) {
            truncated = truncated.slice(0, -1);
        }
        return `${truncated}...`;
    }

    function normalizeMessageText(message) {
        const normalized = String(message == null ? '' : message)
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(MESSAGE_SECRET_QUERY_PATTERN, '$1[hidden]')
            .replace(MESSAGE_SECRET_VALUE_PATTERN, '$1=[hidden]')
            .replace(/\s+/g, ' ')
            .trim();
        return truncateMessageText(normalized);
    }

    function createMessageNode(message, type) {
        const safeType = normalizeMessageType(type);
        const safeMessage = normalizeMessageText(message);
        const note = document.createElement('div');
        note.className = 'message ' + safeType + ' message-entering';
        note.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
        note.setAttribute('aria-live', safeType === 'error' ? 'assertive' : 'polite');

        const indicator = document.createElement('span');
        indicator.className = 'message-indicator';
        indicator.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'message-text';
        text.textContent = safeMessage;
        note.title = safeMessage;

        note.appendChild(indicator);
        note.appendChild(text);
        return note;
    }

    class MessageCenter {
        constructor(options = {}) {
            this.options = Object.assign({
                containerId: 'message-container'
            }, options || {});
            this.activeMessage = null;
            this.activeTimer = null;
        }

        show(message, type = 'info', duration = 4000) {
            const safeType = normalizeMessageType(type);
            if (typeof document === 'undefined') {
                if (typeof console !== 'undefined') {
                    const logMethod = safeType === 'error' ? 'error' : 'log';
                    console[logMethod]('[Message:' + safeType + ']', normalizeMessageText(message));
                }
                return null;
            }

            const container = ensureContainer(this.options.containerId);
            if (!container) {
                return null;
            }

            const note = createMessageNode(message, safeType);
            this.dismiss(180);
            container.appendChild(note);
            this.activeMessage = note;
            window.setTimeout(() => {
                if (note.parentNode && !note.classList.contains('message-leaving')) {
                    note.classList.remove('message-entering');
                    note.classList.add('message-visible');
                }
            }, 760);

            const timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
            this.activeTimer = window.setTimeout(() => {
                this.dismiss(480, note);
            }, timeout);

            return note;
        }

        dismiss(delay = 480, target) {
            const note = target || this.activeMessage;
            if (!note) {
                return;
            }

            if (!target && this.activeTimer) {
                window.clearTimeout(this.activeTimer);
                this.activeTimer = null;
            }

            note.classList.add('message-leaving');
            note.classList.remove('message-entering', 'message-visible');
            window.setTimeout(() => {
                if (note.parentNode) {
                    note.parentNode.removeChild(note);
                }
                if (this.activeMessage === note) {
                    this.activeMessage = null;
                    this.activeTimer = null;
                }
            }, delay);
        }
    }

    MessageCenter.getInstance = function getInstance(options = {}) {
        if (!global.__messageCenterInstance) {
            global.__messageCenterInstance = new MessageCenter(options);
        }
        return global.__messageCenterInstance;
    };

    if (!global.MessageCenter) {
        global.MessageCenter = MessageCenter;
    }

    const sharedInstance = MessageCenter.getInstance();

    if (typeof global.getMessageCenter !== 'function') {
        global.getMessageCenter = function getMessageCenter() {
            return sharedInstance;
        };
    }

    global.showMessage = function showMessage(message, type, duration) {
        return sharedInstance.show(message, type, duration);
    };
})(typeof window !== 'undefined' ? window : this);
