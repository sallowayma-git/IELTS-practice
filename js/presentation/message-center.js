(function (global) {
    'use strict';

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

    function createMessageNode(message, type) {
        const note = document.createElement('div');
        note.className = 'message ' + (type || 'info') + ' message-entering';
        note.setAttribute('role', type === 'error' ? 'alert' : 'status');
        note.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

        const indicator = document.createElement('span');
        indicator.className = 'message-indicator';
        indicator.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'message-text';
        text.textContent = String(message || '');
        note.title = text.textContent;

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
            if (typeof document === 'undefined') {
                if (typeof console !== 'undefined') {
                    const logMethod = type === 'error' ? 'error' : 'log';
                    console[logMethod]('[Message:' + type + ']', message);
                }
                return null;
            }

            const container = ensureContainer(this.options.containerId);
            if (!container) {
                return null;
            }

            const note = createMessageNode(message, type);
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
