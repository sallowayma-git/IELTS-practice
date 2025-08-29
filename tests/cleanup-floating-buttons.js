/**
 * 清理浮动按钮脚本
 * 删除所有可能的浮动返回按钮
 */
function cleanupFloatingButtons() {
    console.log('🧹 开始清理浮动按钮...');
    
    // 要清理的按钮选择器
    const buttonSelectors = [
        '.return-to-overview',
        '#back-to-overview', 
        '[class*="return"]',
        '[class*="back-to"]',
        'button[title*="返回总览"]',
        'button[title*="返回"]'
    ];
    
    let removedCount = 0;
    
    buttonSelectors.forEach(selector => {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(button => {
            // 检查是否是浮动按钮
            const style = window.getComputedStyle(button);
            if (style.position === 'fixed' || style.position === 'absolute') {
                console.log(`🗑️ 删除浮动按钮: ${selector}`, button);
                button.remove();
                removedCount++;
            }
        });
    });
    
    // 检查所有固定定位的按钮
    const allFixedElements = document.querySelectorAll('*');
    allFixedElements.forEach(element => {
        const style = window.getComputedStyle(element);
        if (style.position === 'fixed' && element.tagName === 'BUTTON') {
            const text = element.textContent || element.innerText || '';
            if (text.includes('返回') || text.includes('总览')) {
                console.log(`🗑️ 删除固定定位的返回按钮:`, element);
                element.remove();
                removedCount++;
            }
        }
    });
    
    console.log(`✅ 清理完成，共删除 ${removedCount} 个浮动按钮`);
    
    // 设置监听器，防止按钮被重新创建
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.tagName === 'BUTTON') {
                    const style = window.getComputedStyle(node);
                    const text = node.textContent || node.innerText || '';
                    
                    if ((style.position === 'fixed' || style.position === 'absolute') && 
                        (text.includes('返回') || text.includes('总览'))) {
                        console.log('🚫 阻止创建新的浮动返回按钮:', node);
                        node.remove();
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    console.log('👀 已设置监听器，防止浮动按钮重新出现');
    
    return removedCount;
}

// 页面加载完成后立即执行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanupFloatingButtons);
} else {
    cleanupFloatingButtons();
}

// 也在页面完全加载后再执行一次
window.addEventListener('load', () => {
    setTimeout(cleanupFloatingButtons, 1000);
});

// 导出函数供手动调用
window.cleanupFloatingButtons = cleanupFloatingButtons;