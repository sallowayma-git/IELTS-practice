# HP Portal 视图截屏手记

记录本次为哈利主题 Welcome 门户捕获 Question Bank 与 Settings 视图截图的操作流程。

## 截屏步骤

1. 在仓库根目录启动简易静态服务：
   ```bash
   python -m http.server 8000
   ```
2. 使用 Playwright (browser_container) 载入 `Welcome.html`，执行以下脚本在浏览器端切换视图并抓取截图：
   ```python
   await page.evaluate('''
   (view) => {
     document.querySelectorAll('[data-view-section]').forEach((sec) => {
       sec.classList.add('hidden');
       sec.classList.remove('block');
     });
     const target = document.querySelector(`[data-view-section="${view}"]`);
     if (target) {
       target.classList.remove('hidden');
       target.classList.add('block');
     }
     document.querySelectorAll('[data-hp-view]').forEach((link) => {
       const key = link.getAttribute('data-hp-view');
       link.classList.toggle('hp-nav-active', key === view);
     });
   }
   ''', 'practice')
   ```
3. 分别对 `practice` 与 `settings` 视图执行脚本、调用 `page.screenshot` 保存图像。
4. 结束后关闭 Playwright 与本地服务器，清理临时进程。

## 备注
- 由于 hpPortal 初始化依赖 `hpCore.ready`，静态环境下可能停留在 Overview，故需在浏览器上下文手动切换视图。
- 以上流程确保题库卡片宽度与设置面板按钮排布能准确展示。
