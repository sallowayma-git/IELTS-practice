/**
 * 响应式布局管理器
 * 处理不同屏幕尺寸下的布局调整和字体缩放
 */
class ResponsiveManager {
    constructor() {
        this.breakpoints = {
            xs: 320,
            sm: 480,
            md: 768,
            lg: 1024,
            xl: 1200
        };
        
        this.currentBreakpoint = this.getCurrentBreakpoint();
        this.isLandscape = window.innerHeight < window.innerWidth;
        
        this.init();
    }
    
    init() {
        this.setupViewportMeta();
        this.setupResizeListener();
        this.setupOrientationListener();
        this.adjustInitialLayout();
        this.setupFontScaling();
        this.setupAccessibilityFeatures();
    }
    
    /**
     * 设置视口元标签
     */
    setupViewportMeta() {
        let viewport = document.querySelector('meta[name="viewport"]');
        if (!viewport) {
            viewport = document.createElement('meta');
            viewport.name = 'viewport';
            document.head.appendChild(viewport);
        }
        
        // 根据设备类型设置不同的视口配置
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isAndroid = /Android/.test(navigator.userAgent);
        
        if (isIOS) {
            viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
        } else if (isAndroid) {
            viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=2.0, user-scalable=yes';
        } else {
            viewport.content = 'width=device-width, initial-scale=1.0';
        }
    }
    
    /**
     * 设置窗口大小变化监听
     */
    setupResizeListener() {
        let resizeTimer;

        // Window resize events must use native addEventListener - global events cannot use delegation
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.handleResize();
            }, 250);
        });
    }
    
    /**
     * 设置屏幕方向变化监听
     */
    setupOrientationListener() {
        // Orientation change events must use native addEventListener - global events cannot use delegation
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleOrientationChange();
            }, 100);
        });

        // 现代浏览器的屏幕方向API
        if (screen.orientation) {
            screen.orientation.addEventListener('change', () => {
                this.handleOrientationChange();
            });
        }
    }
    
    /**
     * 处理窗口大小变化
     */
    handleResize() {
        const newBreakpoint = this.getCurrentBreakpoint();
        
        if (newBreakpoint !== this.currentBreakpoint) {
            this.currentBreakpoint = newBreakpoint;
            this.adjustLayoutForBreakpoint();
        }
        
        this.adjustDynamicElements();
        this.updateGridColumns();
    }
    
    /**
     * 处理屏幕方向变化
     */
    handleOrientationChange() {
        const wasLandscape = this.isLandscape;
        this.isLandscape = window.innerHeight < window.innerWidth;
        
        if (wasLandscape !== this.isLandscape) {
            this.adjustForOrientation();
        }
        
        // 修复iOS Safari的视口问题
        if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
            setTimeout(() => {
                window.scrollTo(0, 1);
                window.scrollTo(0, 0);
            }, 500);
        }
    }
    
    /**
     * 获取当前断点
     */
    getCurrentBreakpoint() {
        const width = window.innerWidth;
        
        if (width < this.breakpoints.xs) return 'xs';
        if (width < this.breakpoints.sm) return 'sm';
        if (width < this.breakpoints.md) return 'md';
        if (width < this.breakpoints.lg) return 'lg';
        return 'xl';
    }
    
    /**
     * 调整初始布局
     */
    adjustInitialLayout() {
        document.body.classList.add(`breakpoint-${this.currentBreakpoint}`);
        
        if (this.isLandscape) {
            document.body.classList.add('landscape');
        } else {
            document.body.classList.add('portrait');
        }
        
        this.adjustLayoutForBreakpoint();
    }
    
    /**
     * 根据断点调整布局
     */
    adjustLayoutForBreakpoint() {
        // 移除旧的断点类
        Object.keys(this.breakpoints).forEach(bp => {
            document.body.classList.remove(`breakpoint-${bp}`);
        });
        
        // 添加新的断点类
        document.body.classList.add(`breakpoint-${this.currentBreakpoint}`);
        
        // 根据断点调整特定元素
        this.adjustNavigation();
        this.adjustGrid();
        this.adjustModals();
        this.adjustCards();
    }
    
    /**
     * 调整导航栏
     */
    adjustNavigation() {
        const nav = document.querySelector('.main-nav');
        const navBtns = document.querySelectorAll('.nav-btn');
        
        if (!nav) return;
        
        switch (this.currentBreakpoint) {
            case 'xs':
            case 'sm':
                // 小屏设备：紧凑导航
                nav.classList.add('compact');
                navBtns.forEach(btn => {
                    const text = btn.textContent;
                    if (text.length > 4) {
                        btn.setAttribute('title', text);
                        btn.textContent = text.substring(0, 3) + '...';
                    }
                });
                break;
                
            case 'md':
                // 中等屏幕：恢复完整文本
                nav.classList.remove('compact');
                navBtns.forEach(btn => {
                    const title = btn.getAttribute('title');
                    if (title) {
                        btn.textContent = title;
                    }
                });
                break;
                
            default:
                // 大屏幕：完整导航
                nav.classList.remove('compact');
                navBtns.forEach(btn => {
                    const title = btn.getAttribute('title');
                    if (title) {
                        btn.textContent = title;
                    }
                });
        }
    }
    
    /**
     * 调整网格布局
     */
    adjustGrid() {
        const categoryGrid = document.querySelector('.category-grid');
        const examGrid = document.querySelector('.exam-grid');
        const statsGrid = document.querySelector('.stats-overview');
        
        if (categoryGrid) {
            this.adjustGridColumns(categoryGrid, 'category');
        }
        
        if (examGrid) {
            this.adjustGridColumns(examGrid, 'exam');
        }
        
        if (statsGrid) {
            this.adjustGridColumns(statsGrid, 'stats');
        }
    }
    
    /**
     * 调整网格列数
     */
    adjustGridColumns(grid, type) {
        const columnConfig = {
            category: {
                xs: 1, sm: 1, md: 1, lg: 2, xl: 3
            },
            exam: {
                xs: 1, sm: 1, md: 2, lg: 3, xl: 4
            },
            stats: {
                xs: 1, sm: 2, md: 4, lg: 4, xl: 4
            }
        };
        
        const columns = columnConfig[type][this.currentBreakpoint];
        grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    }
    
    /**
     * 更新网格列数（动态调整）
     */
    updateGridColumns() {
        const grids = document.querySelectorAll('.category-grid, .exam-grid, .stats-overview');
        
        grids.forEach(grid => {
            if (grid.classList.contains('category-grid')) {
                this.adjustGridColumns(grid, 'category');
            } else if (grid.classList.contains('exam-grid')) {
                this.adjustGridColumns(grid, 'exam');
            } else if (grid.classList.contains('stats-overview')) {
                this.adjustGridColumns(grid, 'stats');
            }
        });
    }
    
    /**
     * 调整模态框
     */
    adjustModals() {
        const modals = document.querySelectorAll('.modal');
        
        modals.forEach(modal => {
            if (this.currentBreakpoint === 'xs' || this.currentBreakpoint === 'sm') {
                modal.classList.add('mobile-modal');
            } else {
                modal.classList.remove('mobile-modal');
            }
        });
    }
    
    /**
     * 调整卡片布局
     */
    adjustCards() {
        const cards = document.querySelectorAll('.exam-card, .category-card');
        
        cards.forEach(card => {
            if (this.currentBreakpoint === 'xs') {
                card.classList.add('compact-card');
            } else {
                card.classList.remove('compact-card');
            }
        });
    }
    
    /**
     * 调整方向变化
     */
    adjustForOrientation() {
        document.body.classList.remove('landscape', 'portrait');
        document.body.classList.add(this.isLandscape ? 'landscape' : 'portrait');
        
        // 横屏时的特殊调整
        if (this.isLandscape && (this.currentBreakpoint === 'xs' || this.currentBreakpoint === 'sm')) {
            this.adjustLandscapeLayout();
        }
    }
    
    /**
     * 调整横屏布局
     */
    adjustLandscapeLayout() {
        const header = document.querySelector('.main-header');
        const statsGrid = document.querySelector('.stats-overview');
        
        if (header) {
            header.classList.add('landscape-header');
        }
        
        if (statsGrid) {
            statsGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
        }
    }
    
    /**
     * 调整动态元素
     */
    adjustDynamicElements() {
        // 调整搜索框宽度
        const searchInputs = document.querySelectorAll('.search-input, .search-input-sm');
        searchInputs.forEach(input => {
            if (this.currentBreakpoint === 'xs' || this.currentBreakpoint === 'sm') {
                input.style.width = '100%';
            } else {
                input.style.width = '';
            }
        });
        
        // 调整按钮组
        const buttonGroups = document.querySelectorAll('.category-actions, .exam-actions');
        buttonGroups.forEach(group => {
            if (this.currentBreakpoint === 'xs') {
                group.classList.add('vertical-buttons');
            } else {
                group.classList.remove('vertical-buttons');
            }
        });
    }
    
    /**
     * 设置字体缩放
     */
    setupFontScaling() {
        // 检测用户字体大小偏好
        const testElement = document.createElement('div');
        testElement.style.cssText = 'font-size: 1rem; position: absolute; visibility: hidden;';
        document.body.appendChild(testElement);
        
        const baseFontSize = parseFloat(getComputedStyle(testElement).fontSize);
        document.body.removeChild(testElement);
        
        // 如果用户设置了较大的字体，调整布局
        if (baseFontSize > 16) {
            document.body.classList.add('large-font');
            this.adjustForLargeFont();
        }
    }
    
    /**
     * 调整大字体布局
     */
    adjustForLargeFont() {
        const style = document.createElement('style');
        style.textContent = `
            .large-font .nav-btn {
                padding: var(--spacing-lg) var(--spacing-xl);
            }
            
            .large-font .btn {
                padding: var(--spacing-lg) var(--spacing-xl);
                min-height: 48px;
            }
            
            .large-font .exam-card,
            .large-font .category-card {
                padding: var(--spacing-xl);
            }
            
            .large-font .stats-overview {
                grid-template-columns: repeat(2, 1fr);
            }
            
            @media (max-width: 768px) {
                .large-font .stats-overview {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * 设置无障碍功能
     */
    setupAccessibilityFeatures() {
        // 检测用户偏好
        this.checkReducedMotion();
        this.checkHighContrast();
        this.setupKeyboardNavigation();
    }
    
    /**
     * 检测减少动画偏好
     */
    checkReducedMotion() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            document.body.classList.add('reduced-motion');
        }
    }
    
    /**
     * 检测高对比度偏好
     */
    checkHighContrast() {
        if (window.matchMedia('(prefers-contrast: high)').matches) {
            document.body.classList.add('high-contrast');
        }
    }
    
    /**
     * 设置键盘导航
     */
    setupKeyboardNavigation() {
        // 为可交互元素添加焦点样式
        const focusableElements = document.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        // focus/blur事件不在DOM委托支持范围内，必须使用原生 addEventListener
        // 并且需要使用capture: true来正确处理焦点事件
        focusableElements.forEach(element => {
            element.addEventListener('focus', () => {
                element.classList.add('keyboard-focus');
            }, true);

            element.addEventListener('blur', () => {
                element.classList.remove('keyboard-focus');
            }, true);
        });
    }
    
    /**
     * 获取当前设备信息
     */
    getDeviceInfo() {
        return {
            breakpoint: this.currentBreakpoint,
            isLandscape: this.isLandscape,
            screenWidth: window.innerWidth,
            screenHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            isTouchDevice: 'ontouchstart' in window,
            isRetina: window.devicePixelRatio > 1
        };
    }
    
    /**
     * 强制重新计算布局
     */
    recalculateLayout() {
        this.currentBreakpoint = this.getCurrentBreakpoint();
        this.isLandscape = window.innerHeight < window.innerWidth;
        this.adjustLayoutForBreakpoint();
        this.adjustForOrientation();
    }
}

// 添加响应式相关样式
const responsiveStyles = `
.vertical-buttons {
    flex-direction: column !important;
}

.vertical-buttons .btn {
    width: 100% !important;
}

.compact-card .exam-title,
.compact-card .category-header h2 {
    font-size: var(--font-size-sm) !important;
}

.mobile-modal {
    width: 95% !important;
    max-height: 85vh !important;
}

.landscape-header {
    padding: var(--spacing-sm) 0 !important;
}

.landscape-header .container {
    flex-direction: row !important;
    gap: var(--spacing-sm) !important;
}

.keyboard-focus {
    outline: 2px solid var(--primary-color) !important;
    outline-offset: 2px !important;
}

.reduced-motion * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
}

.high-contrast {
    filter: contrast(150%);
}

.high-contrast .btn,
.high-contrast .nav-btn {
    border-width: 2px !important;
}

@media (max-width: 320px) {
    .breakpoint-xs .nav-btn {
        font-size: 10px !important;
        padding: var(--spacing-xs) !important;
    }
}
`;

// 注入样式
const responsiveStyleSheet = document.createElement('style');
responsiveStyleSheet.textContent = responsiveStyles;
document.head.appendChild(responsiveStyleSheet);

// 导出类
window.ResponsiveManager = ResponsiveManager;