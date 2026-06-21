/**
 * DOM操作工具库
 * 统一事件委托、DOM创建和样式管理
 */

/**
 * 事件委托系统
 * 减少事件监听器数量，避免内存泄漏
 */
class DOMEvents {
    constructor() {
        this.delegates = new Map();
        this.setupGlobalDelegates();
    }

    setupGlobalDelegates() {
        // DOM委托工具核心监听器 - 必须使用原生 addEventListener
        // 这些是全局事件监听器，用于支持整个应用的事件委托系统
        document.addEventListener('click', (e) => {
            this.handleDelegatedEvent('click', e);
        });

        // 全局变更事件委托
        document.addEventListener('change', (e) => {
            this.handleDelegatedEvent('change', e);
        });

        // 全局输入事件委托
        document.addEventListener('input', (e) => {
            this.handleDelegatedEvent('input', e);
        });

        // 全局鼠标事件委托
        document.addEventListener('mouseenter', (e) => {
            this.handleDelegatedEvent('mouseenter', e);
        }, true);

        document.addEventListener('mouseleave', (e) => {
            this.handleDelegatedEvent('mouseleave', e);
        }, true);
    }

    handleDelegatedEvent(eventType, event) {
        const delegates = this.delegates.get(eventType);
        if (!delegates) return;

        for (const [selector, handler] of delegates) {
            const target = event.target.closest(selector);
            if (target) {
                handler.call(target, event);
                break; // 只执行第一个匹配的处理器
            }
        }
    }

    /**
     * 注册事件委托
     * @param {string} eventType 事件类型
     * @param {string} selector CSS选择器
     * @param {function} handler 事件处理函数
     */
    delegate(eventType, selector, handler) {
        if (!this.delegates.has(eventType)) {
            this.delegates.set(eventType, new Map());
        }

        this.delegates.get(eventType).set(selector, handler);

        return {
            remove: () => {
                this.delegates.get(eventType)?.delete(selector);
            }
        };
    }

    /**
     * 清理所有委托
     */
    cleanup() {
        this.delegates.clear();
    }
}

/**
 * 统一DOM创建和管理系统
 */
class DOMBuilder {
    constructor() {
        this.fragmentCache = new Map();
    }

    isUnsafeTagName(name) {
        const key = String(name || '').trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(key)) {
            return true;
        }
        return new Set([
            'script',
            'iframe',
            'object',
            'embed',
            'applet',
            'frame',
            'frameset',
            'base',
            'link',
            'meta',
            'style',
            'template'
        ]).has(key);
    }

    isUnsafeAttributeName(name) {
        const key = String(name || '').toLowerCase();
        return key.startsWith('on') || key === 'srcdoc';
    }

    isUnsafeUrlAttribute(name, value, tagName) {
        const key = String(name || '').toLowerCase();
        const urlAttributes = new Set(['href', 'src', 'srcset', 'imagesrcset', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'cite', 'longdesc', 'ping']);
        if (!urlAttributes.has(key)) {
            return false;
        }
        const text = String(value == null ? '' : value).trim();
        if (!text) {
            return false;
        }
        const compactAll = text.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
        if (compactAll.includes('javascript:')
            || compactAll.includes('vbscript:')
            || compactAll.includes('data:text/html')
            || compactAll.includes('data:application/xhtml+xml')
            || compactAll.includes('data:image/svg+xml')) {
            return true;
        }
        const candidates = (key === 'srcset' || key === 'imagesrcset')
            ? text.split(',').map((part) => part.trim().split(/\s+/, 1)[0]).filter(Boolean)
            : (key === 'ping' ? text.split(/\s+/).filter(Boolean) : [text]);
        return candidates.some((candidate) => {
            const compact = String(candidate).replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
            if (compact.startsWith('javascript:') || compact.startsWith('vbscript:')) {
                return true;
            }
            if (compact.startsWith('data:')) {
                const tag = String(tagName || '').toLowerCase();
                const imageLikeAttribute = key === 'src' || key === 'srcset' || key === 'imagesrcset';
                const imageLikeTag = tag === 'img' || tag === 'source';
                if (!imageLikeAttribute || !imageLikeTag) {
                    return true;
                }
                return /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i.test(compact);
            }
            return false;
        });
    }

    isUnsafeStyleValue(name, value) {
        if (this.isUnsafeObjectKey(name) || value == null) {
            return true;
        }
        const compact = String(value)
            .replace(/[\u0000-\u001f\u007f\s]+/g, '')
            .toLowerCase();
        return compact.includes('javascript:')
            || compact.includes('vbscript:')
            || compact.includes('expression(')
            || compact.includes('data:text/html')
            || compact.includes('data:application/xhtml+xml')
            || compact.includes('data:image/svg+xml');
    }

    isUnsafeObjectKey(name) {
        const key = String(name || '').toLowerCase();
        return key === '__proto__' || key === 'prototype' || key === 'constructor';
    }

    ensureBlankTargetRel(element) {
        if (!element || typeof element.getAttribute !== 'function' || typeof element.setAttribute !== 'function') {
            return;
        }
        const target = String(element.getAttribute('target') || '').toLowerCase();
        if (target !== '_blank') {
            return;
        }
        const rel = String(element.getAttribute('rel') || '')
            .split(/\s+/)
            .filter(Boolean);
        const relSet = new Set(rel.map((value) => value.toLowerCase()));
        if (!relSet.has('noopener')) {
            rel.push('noopener');
        }
        if (!relSet.has('noreferrer')) {
            rel.push('noreferrer');
        }
        element.setAttribute('rel', rel.join(' '));
    }

    /**
     * 创建DOM元素的简洁方法
     * @param {string} tag 标签名
     * @param {object} attributes 属性对象
     * @param {string|Node|Array} children 子元素
     */
    create(tag, attributes = {}, children = []) {
        const requestedTag = String(tag || '').trim().toLowerCase();
        const safeTag = this.isUnsafeTagName(tag) ? 'div' : requestedTag;
        if (safeTag !== requestedTag) {
            console.warn('[DOMBuilder] Replaced unsafe tag');
        }
        const element = document.createElement(safeTag);

        // 兼容旧调用：传入 null/undefined/非对象属性时直接跳过属性设置
        const hasDOMNode = typeof Node !== 'undefined' && attributes instanceof Node;
        const isPlainObject = attributes && typeof attributes === 'object' && !Array.isArray(attributes) && !hasDOMNode;
        const normalizedAttributes = isPlainObject ? attributes : {};

        // 如果第二个参数实际是子节点，进行回退处理
        const providedChildren = arguments.length >= 3;
        if (!isPlainObject && attributes != null && !providedChildren) {
            children = attributes;
        }

        // 设置属性
        for (const [key, value] of Object.entries(normalizedAttributes)) {
            if (this.isUnsafeAttributeName(key) || this.isUnsafeUrlAttribute(key, value, tag)) {
                console.warn('[DOMBuilder] Skipped unsafe attribute');
                continue;
            }
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset') {
                if (value && typeof value === 'object') {
                    Object.entries(value).forEach(([dataKey, dataValue]) => {
                        if (!this.isUnsafeObjectKey(dataKey) && dataValue != null) {
                            element.dataset[dataKey] = String(dataValue);
                        }
                    });
                }
            } else if (key === 'style' && typeof value === 'object') {
                Object.entries(value).forEach(([styleKey, styleValue]) => {
                    if (!this.isUnsafeStyleValue(styleKey, styleValue)) {
                        element.style[styleKey] = styleValue;
                    }
                });
            } else {
                element.setAttribute(key, value);
            }
        }

        // 添加子元素
        this.appendChildren(element, children);

        this.ensureBlankTargetRel(element);
        return element;
    }

    appendChildren(element, children) {
        const childArray = Array.isArray(children) ? children : [children];

        for (const child of childArray) {
            if (child == null) continue;

            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        }
    }

    /**
     * 批量创建DocumentFragment
     * @param {Array} items 元素数据数组
     * @param {function} createElement 创建元素的函数
     */
    createFragment(items, createElement) {
        const fragment = document.createDocumentFragment();

        for (const item of items) {
            const element = createElement(item);
            if (element) {
                fragment.appendChild(element);
            }
        }

        return fragment;
    }

    /**
     * 替换innerHTML的安全方法
     * @param {Element} container 容器元素
     * @param {Array|function} content 内容
     */
    replaceContent(container, content) {
        // 清空容器
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        if (typeof content === 'function') {
            const result = content();
            if (result instanceof Node) {
                container.appendChild(result);
            } else if (Array.isArray(result)) {
                this.appendChildren(container, result);
            }
        } else if (Array.isArray(content)) {
            this.appendChildren(container, content);
        } else if (content instanceof Node) {
            container.appendChild(content);
        } else if (typeof content === 'string') {
            // 只允许静态HTML，不是动态生成的
            container.appendChild(document.createTextNode(content));
        }
    }

    /**
     * 智能列表更新
     * @param {Element} container 容器
     * @param {Array} newData 新数据
     * @param {Array} oldData 旧数据
     * @param {function} createElement 创建元素函数
     * @param {function} updateElement 更新元素函数
     */
    updateList(container, newData, oldData = [], createElement, updateElement) {
        if (!newData || newData.length === 0) {
            this.replaceContent(container, []);
            return;
        }

        // 简单实现：清空重建
        // 复杂实现：可以添加diff算法进行增量更新
        if (newData.length > 50) {
            // 大数据集：分批处理
            this.batchUpdate(container, newData, createElement);
        } else {
            // 小数据集：直接重建
            const fragment = this.createFragment(newData, createElement);
            this.replaceContent(container, fragment);
        }
    }

    /**
     * 分批更新大数据集
     */
    batchUpdate(container, data, createElement, batchSize = 20) {
        this.replaceContent(container, []);

        let index = 0;
        const processBatch = () => {
            const endIndex = Math.min(index + batchSize, data.length);
            const batch = data.slice(index, endIndex);

            const fragment = this.createFragment(batch, createElement);
            container.appendChild(fragment);

            index = endIndex;

            if (index < data.length) {
                requestAnimationFrame(processBatch);
            }
        };

        requestAnimationFrame(processBatch);
    }
}

/**
 * 统一样式管理系统
 */
class DOMStyles {
    constructor() {
        this.computedStyles = new Map();
    }

    isUnsafeStyleValue(name, value) {
        if (window.DOMBuilder && typeof window.DOMBuilder.isUnsafeStyleValue === 'function') {
            return window.DOMBuilder.isUnsafeStyleValue(name, value);
        }
        const key = String(name || '').toLowerCase();
        if (key === '__proto__' || key === 'prototype' || key === 'constructor' || value == null) {
            return true;
        }
        const compact = String(value)
            .replace(/[\u0000-\u001f\u007f\s]+/g, '')
            .toLowerCase();
        return compact.includes('javascript:')
            || compact.includes('vbscript:')
            || compact.includes('expression(')
            || compact.includes('data:text/html')
            || compact.includes('data:application/xhtml+xml')
            || compact.includes('data:image/svg+xml');
    }

    /**
     * 设置样式的简洁方法
     * @param {Element} element 元素
     * @param {object} styles 样式对象
     */
    set(element, styles) {
        if (!element || !styles) return;

        Object.entries(styles).forEach(([styleKey, styleValue]) => {
            if (!this.isUnsafeStyleValue(styleKey, styleValue)) {
                element.style[styleKey] = styleValue;
            }
        });
    }

    /**
     * 获取计算样式
     */
    get(element, property) {
        if (!element) return null;

        const key = `${element.tagName}_${element.className}_${property}`;
        if (!this.computedStyles.has(key)) {
            const computed = window.getComputedStyle(element);
            this.computedStyles.set(key, computed[property]);
        }

        return this.computedStyles.get(key);
    }

    /**
     * 显示/隐藏元素
     */
    show(element, display = 'block') {
        if (element) element.style.display = display;
    }

    hide(element) {
        if (element) element.style.display = 'none';
    }

    toggle(element, display = 'block') {
        if (!element) return;
        element.style.display = element.style.display === 'none' ? display : 'none';
    }

    /**
     * 批量样式操作
     */
    batch(operations) {
        requestAnimationFrame(() => {
            for (const { element, styles } of operations) {
                this.set(element, styles);
            }
        });
    }
}

/**
 * 全局DOM工具实例
 */
const DOM = {
    events: new DOMEvents(),
    builder: new DOMBuilder(),
    styles: new DOMStyles(),

    // 便捷方法
    create: (tag, attrs, children) => DOM.builder.create(tag, attrs, children),
    delegate: (event, selector, handler) => DOM.events.delegate(event, selector, handler),
    show: (element, display) => DOM.styles.show(element, display),
    hide: (element) => DOM.styles.hide(element),
    setStyle: (element, styles) => DOM.styles.set(element, styles),
    replaceContent: (container, content) => DOM.builder.replaceContent(container, content),
    updateList: (container, newData, oldData, createElement, updateElement) =>
        DOM.builder.updateList(container, newData, oldData, createElement, updateElement)
};

// 导出到全局
window.DOM = DOM;

// 向后兼容别名
window.DOMBuilder = DOM.builder;
window.DOMEvents = DOM.events;
window.DOMStyles = DOM.styles;

console.log('[DOM] DOM工具库已加载，统一事件委托、DOM创建和样式管理');

// 聚合 DOMAdapter 回退实现，避免额外脚本文件
(function(global) {
    if (global.DOMAdapter || typeof document === 'undefined') {
        return;
    }

    function toArray(children) {
        if (Array.isArray(children)) {
            return children.filter(function(child) { return child != null; });
        }
        if (children == null) {
            return [];
        }
        return [children];
    }

    function ensureBlankTargetRel(element) {
        if (!element || typeof element.getAttribute !== 'function' || typeof element.setAttribute !== 'function') {
            return;
        }
        var target = String(element.getAttribute('target') || '').toLowerCase();
        if (target !== '_blank') {
            return;
        }
        var rel = String(element.getAttribute('rel') || '')
            .split(/\s+/)
            .filter(Boolean);
        var relMap = Object.create(null);
        rel.forEach(function(value) {
            relMap[String(value).toLowerCase()] = true;
        });
        if (!relMap.noopener) {
            rel.push('noopener');
        }
        if (!relMap.noreferrer) {
            rel.push('noreferrer');
        }
        element.setAttribute('rel', rel.join(' '));
    }

    function applyAttributes(element, attributes) {
        if (!attributes) return;
        Object.keys(attributes).forEach(function(key) {
            var value = attributes[key];
            if (value == null || value === false) return;
            if (global.DOMBuilder
                && typeof global.DOMBuilder.isUnsafeAttributeName === 'function'
                && global.DOMBuilder.isUnsafeAttributeName(key)) {
                console.warn('[DOMAdapter] Skipped unsafe attribute');
                return;
            }
            if (global.DOMBuilder
                && typeof global.DOMBuilder.isUnsafeUrlAttribute === 'function'
                && global.DOMBuilder.isUnsafeUrlAttribute(key, value, element.tagName)) {
                console.warn('[DOMAdapter] Skipped unsafe URL attribute');
                return;
            }
            if (key === 'className') {
                element.className = value;
                return;
            }
            if (key === 'dataset' && typeof value === 'object') {
                Object.keys(value).forEach(function(dataKey) {
                    var dataValue = value[dataKey];
                    if (dataValue != null
                        && (!global.DOMBuilder
                            || typeof global.DOMBuilder.isUnsafeObjectKey !== 'function'
                            || !global.DOMBuilder.isUnsafeObjectKey(dataKey))) {
                        element.dataset[dataKey] = String(dataValue);
                    }
                });
                return;
            }
            if (key === 'style' && typeof value === 'object') {
                Object.keys(value).forEach(function(styleKey) {
                    var styleValue = value[styleKey];
                    if (styleValue != null
                        && (!global.DOMBuilder
                            || typeof global.DOMBuilder.isUnsafeStyleValue !== 'function'
                            || !global.DOMBuilder.isUnsafeStyleValue(styleKey, styleValue))) {
                        element.style[styleKey] = styleValue;
                    }
                });
                return;
            }
            element.setAttribute(key, value === true ? '' : value);
        });
    }

    function appendChildren(element, children) {
        toArray(children).forEach(function(child) {
            if (child == null) return;
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
                return;
            }
            if (child instanceof Node) {
                element.appendChild(child);
            }
        });
    }

    function fallbackCreate(tag, attributes, children) {
        var requestedTag = String(tag || '').trim().toLowerCase();
        var unsafeTag = global.DOMBuilder
            && typeof global.DOMBuilder.isUnsafeTagName === 'function'
            && global.DOMBuilder.isUnsafeTagName(tag);
        var safeTag = unsafeTag ? 'div' : requestedTag;
        if (unsafeTag) {
            console.warn('[DOMAdapter] Replaced unsafe tag');
        }
        var element = document.createElement(safeTag || 'div');
        applyAttributes(element, attributes);
        ensureBlankTargetRel(element);
        appendChildren(element, children);
        return element;
    }

    function fallbackReplaceContent(container, content) {
        if (!container) return;
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
        var nodes = toArray(typeof content === 'function' ? content() : content);
        nodes.forEach(function(node) {
            if (!node) return;
            if (typeof node === 'string') {
                container.appendChild(document.createTextNode(node));
            } else if (node instanceof Node) {
                container.appendChild(node);
            }
        });
    }

    function fallbackFragment(items, factory) {
        var fragment = document.createDocumentFragment();
        (Array.isArray(items) ? items : []).forEach(function(item) {
            var node = factory(item);
            if (node instanceof Node) {
                fragment.appendChild(node);
            }
        });
        return fragment;
    }

    global.DOMAdapter = {
        create: function(tag, attributes, children) {
            if (global.DOM && typeof global.DOM.create === 'function') {
                return global.DOM.create(tag, attributes, children);
            }
            return fallbackCreate(tag, attributes, children);
        },
        replaceContent: function(container, content) {
            if (global.DOM && typeof global.DOM.replaceContent === 'function') {
                global.DOM.replaceContent(container, content);
                return;
            }
            fallbackReplaceContent(container, content);
        },
        fragment: function(items, factory) {
            if (global.DOM && global.DOM.builder && typeof global.DOM.builder.createFragment === 'function') {
                return global.DOM.builder.createFragment(items, factory);
            }
            return fallbackFragment(items, factory);
        },
        text: function(value) {
            return document.createTextNode(value == null ? '' : String(value));
        }
    };
})(window);
