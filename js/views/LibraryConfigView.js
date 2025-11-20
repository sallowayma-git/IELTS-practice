(function (global) {
    'use strict';

    var domAdapter = global.DOMAdapter || null;

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    // --- Library configuration view ---
    function LibraryConfigView(options) {
        options = options || {};
        this.domAdapter = options.domAdapter || domAdapter;
        this.classNames = Object.assign({
            host: 'library-config-list',
            panel: 'library-config-panel',
            header: 'library-config-panel__header',
            title: 'library-config-panel__title',
            badge: 'library-config-panel__badge',
            list: 'library-config-panel__list',
            item: 'library-config-panel__item',
            itemActive: 'library-config-panel__item--active',
            info: 'library-config-panel__info',
            meta: 'library-config-panel__meta',
            actions: 'library-config-panel__actions',
            footer: 'library-config-panel__footer',
            closeButton: 'library-config-panel__close',
            empty: 'library-config-panel__empty',
            emptyIcon: 'library-config-panel__empty-icon',
            emptyHint: 'library-config-panel__empty-hint'
        }, options.classNames || {});
    }

    LibraryConfigView.prototype.mount = function mount(container, configs, options) {
        if (!container) {
            return null;
        }

        var host = this._ensureHost(container);
        var panel = this._renderPanel(ensureArray(configs), options || {});
        this._replaceContent(host, [panel]);
        this._bindActions(host, options || {});
        return host;
    };

    LibraryConfigView.prototype._renderPanel = function _renderPanel(configs, options) {
        var panel = this._createElement('div', {
            className: this.classNames.panel,
            role: 'dialog',
            ariaLabel: '题库配置列表'
        });

        panel.appendChild(this._renderHeader());

        if (!configs.length) {
            panel.appendChild(this._renderEmptyState(options && options.emptyMessage));
        } else {
            panel.appendChild(this._renderList(configs, options));
        }

        panel.appendChild(this._renderFooter());
        return panel;
    };

    LibraryConfigView.prototype._renderHeader = function _renderHeader() {
        var header = this._createElement('div', { className: this.classNames.header });
        header.appendChild(this._createElement('h3', {
            className: this.classNames.title
        }, ['📚', this._createElement('span', null, ' 题库配置列表')]));
        return header;
    };

    LibraryConfigView.prototype._renderEmptyState = function _renderEmptyState(customMessage) {
        var message = typeof customMessage === 'string' && customMessage.trim().length
            ? customMessage
            : '暂无题库配置记录';

        return this._createElement('div', { className: this.classNames.empty }, [
            this._createElement('span', { className: this.classNames.emptyIcon, ariaHidden: 'true' }, '🗂️'),
            this._createElement('p', { className: this.classNames.emptyHint }, message)
        ]);
    };

    LibraryConfigView.prototype._renderList = function _renderList(configs, options) {
        var list = this._createElement('div', {
            className: this.classNames.list,
            role: 'list'
        });

        var activeKey = options && options.activeKey;
        var allowDelete = options && options.allowDelete !== false;

        for (var i = 0; i < configs.length; i += 1) {
            var config = configs[i];
            if (!config) {
                continue;
            }
            list.appendChild(this._renderItem(config, activeKey, allowDelete));
        }
        return list;
    };

    LibraryConfigView.prototype._renderItem = function _renderItem(config, activeKey, allowDelete) {
        var isActive = activeKey === config.key;
        var isDefault = config.key === 'exam_index';
        var className = this.classNames.item + (isActive ? ' ' + this.classNames.itemActive : '');

        var item = this._createElement('div', {
            className: className,
            role: 'listitem'
        });

        var info = this._createElement('div', { className: this.classNames.info });
        var titleChildren = [config.name || config.key || '未命名题库'];
        if (isDefault) {
            titleChildren.push(this._createElement('span', { className: this.classNames.badge }, '默认'));
        }
        if (isActive) {
            titleChildren.push(this._createElement('span', { className: this.classNames.badge }, '当前'));
        }

        info.appendChild(this._createElement('div', null, titleChildren));

        var metaText = this._formatTimestamp(config.timestamp) + ' · ' + (config.examCount || 0) + ' 个题目';
        info.appendChild(this._createElement('div', { className: this.classNames.meta }, metaText));

        var actions = this._createElement('div', { className: this.classNames.actions });
        var switchButton = this._createElement('button', {
            className: 'btn btn-secondary',
            type: 'button',
            dataset: {
                configAction: 'switch',
                configKey: config.key,
                configActive: isActive ? '1' : '0'
            }
        }, '切换');
        if (typeof switchButton.addEventListener === 'function') {
            (function (button, key) {
                button.addEventListener('click', function (event) {
                    if (event && typeof event.preventDefault === 'function') {
                        event.preventDefault();
                    }
                    if (event && typeof event.stopPropagation === 'function') {
                        event.stopPropagation();
                    }
                    if (typeof window.switchLibraryConfig === 'function') {
                        window.switchLibraryConfig(key);
                    }
                });
            })(switchButton, config.key);
        }
        actions.appendChild(switchButton);

        if (!isDefault && allowDelete !== false) {
            var deleteButton = this._createElement('button', {
                className: 'btn btn-warning',
                type: 'button',
                dataset: {
                    configAction: 'delete',
                    configKey: config.key,
                    configActive: isActive ? '1' : '0'
                }
            }, '删除');
            if (typeof deleteButton.addEventListener === 'function') {
                (function (button, key) {
                    button.addEventListener('click', function (event) {
                        if (event && typeof event.preventDefault === 'function') {
                            event.preventDefault();
                        }
                        if (event && typeof event.stopPropagation === 'function') {
                            event.stopPropagation();
                        }
                        if (typeof window.deleteLibraryConfig === 'function') {
                            window.deleteLibraryConfig(key);
                        }
                    });
                })(deleteButton, config.key);
            }
            actions.appendChild(deleteButton);
        }

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    };

    LibraryConfigView.prototype._renderFooter = function _renderFooter() {
        var footer = this._createElement('div', { className: this.classNames.footer });
        footer.appendChild(this._createElement('button', {
            className: 'btn btn-secondary ' + this.classNames.closeButton,
            type: 'button',
            dataset: { configAction: 'close' }
        }, '关闭'));
        return footer;
    };

    LibraryConfigView.prototype._ensureHost = function _ensureHost(container) {
        var host = container.querySelector('.' + this.classNames.host);
        if (!host) {
            host = this._createElement('div', { className: this.classNames.host });
            container.appendChild(host);
        }
        return host;
    };

    LibraryConfigView.prototype._replaceContent = function _replaceContent(container, nodes) {
        if (this.domAdapter && typeof this.domAdapter.replaceContent === 'function') {
            this.domAdapter.replaceContent(container, nodes);
            return;
        }

        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        var elements = Array.isArray(nodes) ? nodes : [nodes];
        for (var i = 0; i < elements.length; i += 1) {
            var node = elements[i];
            if (node instanceof Node) {
                container.appendChild(node);
            }
        }
    };

    LibraryConfigView.prototype._bindActions = function _bindActions(host, options) {
        if (!host) {
            return;
        }

        if (host._libraryConfigHandler) {
            host.removeEventListener('click', host._libraryConfigHandler);
        }

        var handlers = options && options.handlers ? options.handlers : {};
        var findActionTarget = function (node) {
            var current = node;
            while (current && current !== host) {
                if (current.dataset && current.dataset.configAction) {
                    return current;
                }
                current = current.parentNode;
            }
            return null;
        };

        var listener = function (event) {
            var target = findActionTarget(event.target);
            if (!target) {
                return;
            }

            var action = target.dataset.configAction;
            if (action === 'close') {
                event.preventDefault();
                host.remove();
                return;
            }

            var handler = handlers[action];
            if (typeof handler === 'function') {
                handler(target.dataset.configKey, event);
            }
        };

        host._libraryConfigHandler = listener;
        host.addEventListener('click', listener);
    };

    LibraryConfigView.prototype._createElement = function _createElement(tag, attributes, children) {
        if (this.domAdapter && typeof this.domAdapter.create === 'function') {
            return this.domAdapter.create(tag, attributes, children);
        }

        var element = document.createElement(tag);
        if (attributes) {
            Object.keys(attributes).forEach(function (key) {
                var value = attributes[key];
                if (value == null || value === false) {
                    return;
                }
                if (key === 'className') {
                    element.className = value;
                    return;
                }
                if (key === 'dataset' && typeof value === 'object') {
                    Object.keys(value).forEach(function (dataKey) {
                        var dataValue = value[dataKey];
                        if (dataValue != null) {
                            element.dataset[dataKey] = String(dataValue);
                        }
                    });
                    return;
                }
                if (key === 'ariaLabel') {
                    element.setAttribute('aria-label', value);
                    return;
                }
                if (key === 'ariaHidden') {
                    element.setAttribute('aria-hidden', value);
                    return;
                }
                if (key === 'disabled') {
                    element.disabled = !!value;
                    return;
                }
                element.setAttribute(key, value === true ? '' : value);
            });
        }

        var nodes = Array.isArray(children) ? children : (children != null ? [children] : []);
        for (var i = 0; i < nodes.length; i += 1) {
            var child = nodes[i];
            if (child == null) {
                continue;
            }
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        }
        return element;
    };

    LibraryConfigView.prototype._formatTimestamp = function _formatTimestamp(timestamp) {
        if (!timestamp) {
            return '未知时间';
        }
        try {
            return new Date(timestamp).toLocaleString();
        } catch (error) {
            return '未知时间';
        }
    };

    global.LibraryConfigView = LibraryConfigView;

})(typeof window !== "undefined" ? window : globalThis);
