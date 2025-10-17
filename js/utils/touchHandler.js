/**
 * 触摸交互处理器
 * 提供移动设备上的手势导航和触摸优化
 */
class TouchHandler {
    constructor() {
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchEndX = 0;
        this.touchEndY = 0;
        this.minSwipeDistance = 50;
        this.maxVerticalDistance = 100;
        
        this.init();
    }
    
    init() {
        // 检测触摸设备
        this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        
        if (this.isTouchDevice) {
            this.setupTouchEvents();
            this.optimizeForTouch();
        }
        
        // 设置手势导航
        this.setupSwipeNavigation();
        
        // 优化滚动性能
        this.optimizeScrolling();
    }
    
    /**
     * 设置触摸事件监听
     */
    setupTouchEvents() {
        // 全局触摸事件必须使用原生 addEventListener，不能使用事件委托
        document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: true });
        document.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: true });

        // 防止双击缩放
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (e) => {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        }, false);
    }
    
    /**
     * 处理触摸开始
     */
    handleTouchStart(e) {
        this.touchStartX = e.changedTouches[0].screenX;
        this.touchStartY = e.changedTouches[0].screenY;
    }
    
    /**
     * 处理触摸结束
     */
    handleTouchEnd(e) {
        this.touchEndX = e.changedTouches[0].screenX;
        this.touchEndY = e.changedTouches[0].screenY;
        
        this.handleSwipe();
    }
    
    /**
     * 处理滑动手势
     */
    handleSwipe() {
        const deltaX = this.touchEndX - this.touchStartX;
        const deltaY = Math.abs(this.touchEndY - this.touchStartY);
        
        // 检查是否为有效的水平滑动
        if (Math.abs(deltaX) > this.minSwipeDistance && deltaY < this.maxVerticalDistance) {
            if (deltaX > 0) {
                this.handleSwipeRight();
            } else {
                this.handleSwipeLeft();
            }
        }
    }
    
    /**
     * 右滑处理（返回上一页）
     */
    handleSwipeRight() {
        const currentView = document.querySelector('.view.active');
        if (!currentView) return;
        
        const viewId = currentView.id;
        
        // 根据当前视图决定返回行为
        switch (viewId) {
            case 'browse-view':
                const backBtn = document.getElementById('back-to-overview');
                if (backBtn) {
                    backBtn.click();
                }
                break;
            case 'practice-view':
            case 'analysis-view':
            case 'goals-view':
            case 'specialized-practice-view':
                this.navigateToView('overview');
                break;
        }
    }
    
    /**
     * 左滑处理（快速操作）
     */
    handleSwipeLeft() {
        // 可以实现快速切换到下一个视图或其他操作
        const currentView = document.querySelector('.view.active');
        if (!currentView) return;
        
        // 在总览页面左滑可以快速进入练习记录
        if (currentView.id === 'overview-view') {
            this.navigateToView('practice');
        }
    }
    
    /**
     * 导航到指定视图
     */
    navigateToView(viewName) {
        const navBtn = document.querySelector(`[data-view="${viewName}"]`);
        if (navBtn) {
            navBtn.click();
        }
    }
    
    /**
     * 设置滑动导航
     */
    setupSwipeNavigation() {
        // 为题目卡片添加滑动操作
        this.setupCardSwipe();
        
        // 为模态框添加滑动关闭
        this.setupModalSwipe();
    }
    
    /**
     * 设置卡片滑动操作
     */
    setupCardSwipe() {
        // DOMContentLoaded是全局事件，必须使用原生 addEventListener
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeCardSwipe();
        });
    }

    initializeCardSwipe() {
        const examCards = document.querySelectorAll('.exam-card');

        examCards.forEach(card => {
            let startX = 0;
            let currentX = 0;
            let cardBeingDragged = null;

            // 触摸事件不在DOM委托支持范围内，必须使用原生 addEventListener
            card.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                cardBeingDragged = card;
                card.style.transition = 'none';
            }, { passive: true });

            card.addEventListener('touchmove', (e) => {
                if (!cardBeingDragged) return;

                currentX = e.touches[0].clientX;
                const deltaX = currentX - startX;

                // 限制滑动距离
                const maxSlide = 100;
                const slideDistance = Math.max(-maxSlide, Math.min(maxSlide, deltaX));

                card.style.transform = `translateX(${slideDistance}px)`;

                // 显示操作提示
                if (Math.abs(slideDistance) > 30) {
                    this.showSwipeHint(card, slideDistance > 0 ? 'right' : 'left');
                }
            }, { passive: true });

            card.addEventListener('touchend', () => {
                if (!cardBeingDragged) return;

                const deltaX = currentX - startX;

                card.style.transition = 'transform 0.3s ease';
                card.style.transform = 'translateX(0)';

                // 执行滑动操作
                if (Math.abs(deltaX) > 50) {
                    if (deltaX > 0) {
                        this.handleCardSwipeRight(card);
                    } else {
                        this.handleCardSwipeLeft(card);
                    }
                }

                cardBeingDragged = null;
                this.hideSwipeHint();
            }, { passive: true });
        });
    }
    
    /**
     * 显示滑动提示
     */
    showSwipeHint(card, direction) {
        let hint = card.querySelector('.swipe-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'swipe-hint';
            card.appendChild(hint);
        }
        
        hint.textContent = direction === 'right' ? '👁️ 预览' : '▶️ 开始';
        hint.style.display = 'block';
    }
    
    /**
     * 隐藏滑动提示
     */
    hideSwipeHint() {
        const hints = document.querySelectorAll('.swipe-hint');
        hints.forEach(hint => {
            hint.style.display = 'none';
        });
    }
    
    /**
     * 处理卡片右滑
     */
    handleCardSwipeRight(card) {
        // 右滑预览题目
        const previewBtn = card.querySelector('[data-action="preview"]');
        if (previewBtn) {
            previewBtn.click();
        }
    }
    
    /**
     * 处理卡片左滑
     */
    handleCardSwipeLeft(card) {
        // 左滑开始练习
        const startBtn = card.querySelector('[data-action="start"]');
        if (startBtn) {
            startBtn.click();
        }
    }
    
    /**
     * 设置模态框滑动关闭
     */
    setupModalSwipe() {
        // DOMContentLoaded是全局事件，必须使用原生 addEventListener
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeModalSwipe();
        });
    }

    initializeModalSwipe() {
        const modals = document.querySelectorAll('.modal');

        modals.forEach(modal => {
            let startY = 0;
            let currentY = 0;

            // 触摸事件不在DOM委托支持范围内，必须使用原生 addEventListener
            modal.addEventListener('touchstart', (e) => {
                startY = e.touches[0].clientY;
            }, { passive: true });

            modal.addEventListener('touchmove', (e) => {
                currentY = e.touches[0].clientY;
                const deltaY = currentY - startY;

                // 只允许向下滑动关闭
                if (deltaY > 0) {
                    const opacity = Math.max(0.3, 1 - deltaY / 300);
                    modal.style.transform = `translateY(${deltaY}px)`;
                    modal.style.opacity = opacity;
                }
            }, { passive: true });

            modal.addEventListener('touchend', () => {
                const deltaY = currentY - startY;

                if (deltaY > 100) {
                    // 关闭模态框
                    const closeBtn = modal.querySelector('.modal-close, .close-preview, .close-sessions');
                    if (closeBtn) {
                        closeBtn.click();
                    }
                } else {
                    // 恢复位置
                    modal.style.transform = 'translateY(0)';
                    modal.style.opacity = '1';
                }
            }, { passive: true });
        });
    }
    
    /**
     * 优化触摸设备体验
     */
    optimizeForTouch() {
        // 添加触摸设备类名
        document.body.classList.add('touch-device');
        
        // 优化按钮大小
        const buttons = document.querySelectorAll('.btn, .nav-btn');
        buttons.forEach(btn => {
            btn.classList.add('touch-target');
        });
        
        // 添加触摸反馈
        this.addTouchFeedback();
    }
    
    /**
     * 添加触摸反馈效果
     */
    addTouchFeedback() {
        const interactiveElements = document.querySelectorAll('.btn, .nav-btn, .exam-card, .category-card');

        // 触摸事件不在DOM委托支持范围内，必须使用原生 addEventListener
        interactiveElements.forEach(element => {
            element.addEventListener('touchstart', () => {
                element.classList.add('touch-active');
            }, { passive: true });

            element.addEventListener('touchend', () => {
                setTimeout(() => {
                    element.classList.remove('touch-active');
                }, 150);
            }, { passive: true });

            element.addEventListener('touchcancel', () => {
                element.classList.remove('touch-active');
            }, { passive: true });
        });
    }
    
    /**
     * 优化滚动性能
     */
    optimizeScrolling() {
        // 使用 passive 监听器优化滚动性能
        const scrollableElements = document.querySelectorAll('.modal-body, .search-results, .record-list');

        // 触摸事件和滚动事件不在DOM委托支持范围内，必须使用原生 addEventListener
        scrollableElements.forEach(element => {
            element.addEventListener('touchstart', (e) => {
                // 记录滚动开始位置
                element.dataset.scrollTop = element.scrollTop;
            }, { passive: true });

            element.addEventListener('scroll', (e) => {
                // 优化滚动性能
                if (element.scrollTop === 0) {
                    element.style.overscrollBehavior = 'contain';
                }
            }, { passive: true });
        });

        // 防止过度滚动
        document.body.addEventListener('touchmove', (e) => {
            if (e.target === document.body) {
                e.preventDefault();
            }
        }, { passive: false });
    }
    
    /**
     * 添加快捷手势
     */
    addQuickGestures() {
        // 双击返回顶部
        let lastTap = 0;

        // 全局触摸事件必须使用原生 addEventListener
        document.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;

            if (tapLength < 500 && tapLength > 0) {
                // 双击事件
                if (e.target.closest('.main-content')) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
            lastTap = currentTime;
        });
    }
    
    /**
     * 获取设备信息
     */
    getDeviceInfo() {
        return {
            isTouchDevice: this.isTouchDevice,
            isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
            isAndroid: /Android/.test(navigator.userAgent),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            orientation: window.orientation || 0
        };
    }
}

// 添加触摸反馈样式
const touchStyles = `
.touch-active {
    transform: scale(0.98);
    opacity: 0.8;
    transition: all 0.1s ease;
}

.swipe-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--border-radius);
    font-size: var(--font-size-sm);
    z-index: 10;
    display: none;
    pointer-events: none;
}

.touch-device .btn,
.touch-device .nav-btn {
    min-height: 44px;
    min-width: 44px;
}

.touch-device .exam-card,
.touch-device .category-card {
    cursor: pointer;
}

@media (hover: none) and (pointer: coarse) {
    .exam-card:hover,
    .category-card:hover {
        transform: none;
    }
    
    .btn:hover,
    .nav-btn:hover {
        transform: none;
    }
}
`;

// 注入样式
const styleSheet = document.createElement('style');
styleSheet.textContent = touchStyles;
document.head.appendChild(styleSheet);

// 导出类
window.TouchHandler = TouchHandler;