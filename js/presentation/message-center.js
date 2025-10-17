(function (global) {
    'use strict';

    const DEFAULT_MAX_MESSAGES = 3;
    const MESSAGE_ICONS = {
        error: '❌',
        success: '✅',
        warning: '⚠️',
        info: 'ℹ️'
    };

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
        note.className = 'message ' + (type || 'info');
        const icon = document.createElement('strong');
        icon.textContent = MESSAGE_ICONS[type] || MESSAGE_ICONS.info;
        note.appendChild(icon);
        note.appendChild(document.createTextNode(' ' + String(message || '')));
        return note;
    }

    class MessageCenter {
        constructor(options = {}) {
            this.options = Object.assign({
                containerId: 'message-container',
                maxMessages: DEFAULT_MAX_MESSAGES
            }, options || {});
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
            container.appendChild(note);

            while (container.children.length > this.options.maxMessages) {
                container.removeChild(container.firstChild);
            }

            const timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
            window.setTimeout(() => {
                note.classList.add('message-leaving');
                window.setTimeout(() => {
                    if (note.parentNode) {
                        note.parentNode.removeChild(note);
                    }
                }, 320);
            }, timeout);

            return note;
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
