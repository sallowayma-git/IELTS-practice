/** Shared virtual scrolling runtime; available without performance diagnostics. */
(function (global) {
    'use strict';
    if (global.VirtualScroller) return;

class VirtualScroller {
    constructor(container, items, renderer, options = {}) {
        this.container = container;
        this.items = items;
        this.renderer = renderer;
        this.itemHeight = options.itemHeight || 120;
        this.baseItemHeight = this.itemHeight;
        this.bufferSize = options.bufferSize || 5;
        this.containerHeight = options.containerHeight || this.getContainerHeight();
        this.layoutCalculator = typeof options.layoutCalculator === 'function' ? options.layoutCalculator : null;

        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.renderedItems = new Map();
        this.scrollTop = 0;
        this.totalHeight = 0;
        this.itemsPerRow = 1;
        this.layoutMetrics = null;
        this.gap = 0;
        this.scrollTimer = null;
        this.destroyed = false;

        this.handleResize = this.recalculateLayout.bind(this);

        this.initialize();
    }
    
    /**
     * 初始化虚拟滚动器
     */
    initialize() {
        console.log('[VirtualScroller] 初始化虚拟滚动器', {
            items: this.items.length,
            itemHeight: this.itemHeight,
            containerHeight: this.containerHeight
        });
        
        this.setupScrollContainer();
        this.calculateVisibleRange();
        this.renderVisible();
        this.setupScrollListener();
    }
    
    /**
     * 设置滚动容器
     */
    setupScrollContainer() {
        this.updateLayoutMetrics();

        // 计算总高度
        this.totalHeight = this.getTotalHeight();

        // 设置容器样式
        this.container.style.display = 'block';
        this.container.style.gridTemplateColumns = 'none';
        this.container.style.gap = '0px';
        this.container.style.position = 'relative';
        this.container.style.overflowY = 'auto';
        this.container.style.overflowX = 'hidden';
        this.container.style.height = `${this.containerHeight}px`;

        // 创建虚拟内容区域
        this.viewport = document.createElement('div');
        this.viewport.style.position = 'relative';
        this.viewport.style.height = `${this.totalHeight}px`;
        this.viewport.style.width = '100%';

        // 清空容器并添加视窗
        this.container.innerHTML = '';
        this.container.appendChild(this.viewport);
    }
    
    /**
     * 计算可见范围
     */
    calculateVisibleRange() {
        const scrollTop = this.container.scrollTop;
        const metrics = this.layoutMetrics;
        const rowHeight = metrics && metrics.rowHeight ? metrics.rowHeight : this.itemHeight;
        const itemsPerRow = metrics && metrics.itemsPerRow ? metrics.itemsPerRow : 1;
        const totalRows = metrics && metrics.totalRows ? metrics.totalRows : Math.ceil(this.items.length / itemsPerRow);
        const visibleRows = Math.ceil(this.containerHeight / rowHeight);
        const bufferRows = this.bufferSize;

        const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - bufferRows);
        const endRow = Math.min(totalRows - 1, startRow + visibleRows + bufferRows * 2);

        this.visibleStart = Math.max(0, startRow * itemsPerRow);
        this.visibleEnd = Math.min(this.items.length - 1, ((endRow + 1) * itemsPerRow) - 1);

        this.scrollTop = scrollTop;
    }
    
    /**
     * 渲染可见元素
     */
    renderVisible() {
        const applyPosition = (element, index) => {
            const position = this.getItemPosition(index);
            element.style.position = 'absolute';
            const topValue = position.top != null ? position.top : (index * this.itemHeight);
            if (typeof topValue === 'number') {
                element.style.top = `${topValue}px`;
            } else if (typeof topValue === 'string') {
                element.style.top = topValue;
            } else {
                element.style.top = `${index * this.itemHeight}px`;
            }
            const leftValue = position.left != null ? position.left : 0;
            if (typeof leftValue === 'number') {
                element.style.left = `${leftValue}px`;
            } else if (typeof leftValue === 'string') {
                element.style.left = leftValue;
            } else {
                element.style.left = '0px';
            }
            const widthValue = position.width !== undefined ? position.width : '100%';
            element.style.width = typeof widthValue === 'number' ? `${widthValue}px` : widthValue;
            if (position.height) {
                element.style.height = typeof position.height === 'number' ? `${position.height}px` : position.height;
            }
            element.style.boxSizing = 'border-box';
        };

        // 清理不可见的元素
        this.renderedItems.forEach((element, index) => {
            if (index < this.visibleStart || index > this.visibleEnd) {
                element.remove();
                this.renderedItems.delete(index);
            }
        });
        
        // 渲染可见的元素
        for (let i = this.visibleStart; i <= this.visibleEnd; i++) {
            let element = this.renderedItems.get(i);
            if (!element) {
                element = this.renderer(this.items[i], i);
                this.renderedItems.set(i, element);
            }
            applyPosition(element, i);
            if (!element.parentNode) {
                this.viewport.appendChild(element);
            }
        }
    }
    
    /**
     * 设置滚动监听器
     */
    setupScrollListener() {
        const onScroll = () => {
            // 使用防抖优化滚动性能
            if (this.destroyed) return;
            if (this.scrollTimer !== null) {
                clearTimeout(this.scrollTimer);
            }

            this.scrollTimer = setTimeout(() => {
                this.scrollTimer = null;
                if (this.destroyed) return;
                this.calculateVisibleRange();
                this.renderVisible();
            }, 10);
        };

        this.handleScroll = onScroll;
        this.container.addEventListener('scroll', onScroll, { passive: true });

        window.addEventListener('resize', this.handleResize, { passive: true });
    }

    /**
     * 更新数据
     */
    updateItems(newItems) {
        if (this.destroyed) return;
        this.items = newItems;
        this.updateLayoutMetrics();
        this.totalHeight = this.getTotalHeight();
        this.viewport.style.height = `${this.totalHeight}px`;
        this.container.scrollTop = Math.min(this.container.scrollTop, Math.max(0, this.totalHeight - this.containerHeight));

        // 清除所有渲染的元素
        this.renderedItems.forEach(element => element.remove());
        this.renderedItems.clear();

        // 重新计算并渲染
        this.calculateVisibleRange();
        this.renderVisible();
    }

    /**
     * 重新计算布局
     */
    recalculateLayout() {
        if (this.destroyed) return;
        this.updateLayoutMetrics();
        this.totalHeight = this.getTotalHeight();
        if (this.viewport) {
            this.viewport.style.height = `${this.totalHeight}px`;
        }
        this.calculateVisibleRange();
        this.renderVisible();
    }

    /**
     * 对外暴露的重新计算方法
     */
    recalculate() {
        this.recalculateLayout();
    }
    
    /**
     * 滚动到指定索引
     */
    scrollToIndex(index) {
        if (this.destroyed || this.items.length === 0) return;
        const targetIndex = Math.max(0, Math.min(this.items.length - 1, Math.floor(Number(index) || 0)));
        const position = this.getItemPosition(targetIndex);
        const targetScrollTop = typeof position.top === 'number'
            ? position.top
            : Math.floor(targetIndex / this.itemsPerRow) * this.itemHeight;
        this.container.scrollTop = Math.min(targetScrollTop, Math.max(0, this.totalHeight - this.containerHeight));
        this.calculateVisibleRange();
        this.renderVisible();
    }
    
    /**
     * 获取容器高度
     */
    getContainerHeight() {
        const computedStyle = window.getComputedStyle(this.container);
        const height = parseFloat(computedStyle.height);
        return height > 0 ? height : 600; // 默认600px
    }
    
    /**
     * 销毁虚拟滚动器
     */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.scrollTimer !== null) {
            clearTimeout(this.scrollTimer);
            this.scrollTimer = null;
        }
        console.log('[VirtualScroller] 销毁虚拟滚动器');

        // 清除所有渲染的元素
        this.renderedItems.forEach(element => element.remove());
        this.renderedItems.clear();

        // 移除滚动监听器
        this.container.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('resize', this.handleResize);

        // 清空容器
        this.container.innerHTML = '';
    }

    /**
     * 计算元素位置
     */
    getItemPosition(index) {
        if (this.layoutMetrics && typeof this.layoutMetrics.positionFor === 'function') {
            const position = this.layoutMetrics.positionFor(index) || {};
            const normalizeAxis = (value) => {
                if (value === undefined || value === null) return null;
                if (typeof value === 'number' && !isNaN(value)) return value;
                if (typeof value === 'string' && value.trim() !== '') return value;
                return null;
            };
            return {
                top: normalizeAxis(position.top),
                left: normalizeAxis(position.left),
                width: position.width !== undefined ? position.width : '100%',
                height: position.height !== undefined ? position.height : null
            };
        }
        return {
            top: index * this.itemHeight,
            left: 0,
            width: '100%',
            height: null
        };
    }

    updateLayoutMetrics() {
        if (!this.layoutCalculator) {
            this.layoutMetrics = null;
            this.itemsPerRow = 1;
            return;
        }

        try {
            const metrics = this.layoutCalculator({
                container: this.container,
                items: this.items.slice()
            }) || {};
            if (metrics && typeof metrics === 'object') {
                if (typeof metrics.rowHeight === 'number' && metrics.rowHeight > 0) {
                    this.itemHeight = metrics.rowHeight;
                }
                this.itemsPerRow = Math.max(1, Number(metrics.itemsPerRow) || 1);
                this.gap = Math.max(0, Number(metrics.gap) || 0);
                this.layoutMetrics = Object.assign({}, metrics, {
                    itemsPerRow: this.itemsPerRow,
                    rowHeight: metrics.rowHeight || this.itemHeight,
                    totalRows: metrics.totalRows || Math.ceil(this.items.length / this.itemsPerRow)
                });
                return;
            }
        } catch (error) {
            console.warn('[VirtualScroller] layoutCalculator 计算失败，回退至单列布局', error);
        }

        this.layoutMetrics = null;
        this.itemsPerRow = 1;
    }

    getTotalHeight() {
        if (this.layoutMetrics && typeof this.layoutMetrics.totalHeight === 'number') {
            return this.layoutMetrics.totalHeight;
        }
        return this.items.length * this.itemHeight;
    }
}


    global.VirtualScroller = VirtualScroller;
})(window);
