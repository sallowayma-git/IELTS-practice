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
        // 全局点击事件委托
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

    /**
     * 创建DOM元素的简洁方法
     * @param {string} tag 标签名
     * @param {object} attributes 属性对象
     * @param {string|Node|Array} children 子元素
     */
    create(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);

        // 设置属性
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset') {
                Object.assign(element.dataset, value);
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('on') && typeof value === 'function') {
                console.warn(`[DOMBuilder] Use event delegation instead of direct event binding`);
            } else {
                element.setAttribute(key, value);
            }
        }

        // 添加子元素
        this.appendChildren(element, children);

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
            container.innerHTML = content;
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

    /**
     * 设置样式的简洁方法
     * @param {Element} element 元素
     * @param {object} styles 样式对象
     */
    set(element, styles) {
        if (!element || !styles) return;

        Object.assign(element.style, styles);
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