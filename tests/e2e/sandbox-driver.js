(function () {
    const iframe = document.getElementById('sandbox-frame');
    const runButton = document.getElementById('run-tests');
    const reloadButton = document.getElementById('reload-frame');
    const clearButton = document.getElementById('clear-log');
    const statusEl = document.getElementById('run-status');
    const logContainer = document.getElementById('log');

    let currentBridge = null;
    let activeRunToken = 0;
    let readyProbeToken = 0;

    function log(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.dataset.level = level;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
        const consoleLevel = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
        console[consoleLevel]('[Sandbox]', message);
    }

    function setStatus(text, state = 'info') {
        statusEl.textContent = text;
        statusEl.dataset.state = state;
    }

    function clearLog() {
        logContainer.innerHTML = '';
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitFor(predicate, timeout = 5000, interval = 50) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            function check() {
                let result = false;
                try {
                    result = predicate();
                } catch (error) {
                    reject(error);
                    return;
                }
                if (result) {
                    resolve(result);
                    return;
                }
                if (Date.now() - start >= timeout) {
                    reject(new Error('操作超时'));
                    return;
                }
                setTimeout(check, interval);
            }
            check();
        });
    }

    function teardownBridge(win = iframe?.contentWindow) {
        if (currentBridge && typeof currentBridge.cleanup === 'function') {
            try { currentBridge.cleanup(); } catch (_) {}
            currentBridge = null;
        }
        if (win && win.__sandboxBridge && typeof win.__sandboxBridge.cleanup === 'function') {
            try { win.__sandboxBridge.cleanup(); } catch (_) {}
            delete win.__sandboxBridge;
        }
    }

    function installBridge(win) {
        if (!win || !win.console) {
            return;
        }
        if (win.__sandboxBridge) {
            currentBridge = win.__sandboxBridge;
            return;
        }

        const originalConsole = {};
        const levels = ['log', 'info', 'warn', 'error'];
        levels.forEach((level) => {
            originalConsole[level] = win.console[level];
            win.console[level] = (...args) => {
                try {
                    log(`${level}: ${args.map(formatArg).join(' ')}`, level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info');
                } catch (_) {}
                if (typeof originalConsole[level] === 'function') {
                    try {
                        originalConsole[level].apply(win.console, args);
                    } catch (_) {}
                }
            };
        });

        let pendingMutations = 0;
        let flushTimer = null;
        const observer = new win.MutationObserver((mutations) => {
            pendingMutations += mutations.length;
            if (!flushTimer) {
                flushTimer = win.setTimeout(() => {
                    log(`DOM 更新 ${pendingMutations} 次`, 'dom');
                    pendingMutations = 0;
                    flushTimer = null;
                }, 120);
            }
        });

        waitFor(() => win.document && win.document.body, 2000)
            .then(() => {
                try {
                    observer.observe(win.document.body, {
                        attributes: true,
                        childList: true,
                        subtree: true
                    });
                } catch (error) {
                    log(`DOM 观察器初始化失败: ${error.message}`, 'warn');
                }
            })
            .catch(() => {
                log('等待 DOM 准备超时，放弃安装 MutationObserver', 'warn');
            });

        currentBridge = {
            cleanup() {
                levels.forEach((level) => {
                    if (originalConsole[level]) {
                        win.console[level] = originalConsole[level];
                    }
                });
                try { observer.disconnect(); } catch (_) {}
                if (flushTimer) {
                    win.clearTimeout(flushTimer);
                }
            }
        };
        win.__sandboxBridge = currentBridge;
        log('已注入 console 与 DOM 监控桥接器。');
    }

    function formatArg(value) {
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch (_) {
            return String(value);
        }
    }

    async function ensureAppReady() {
        const win = iframe.contentWindow;
        if (!win) {
            throw new Error('iframe 尚未加载');
        }
        await waitFor(() => win.document && win.document.readyState === 'complete', 5000);
        installBridge(win);
        if (win.app && win.app.isInitialized) {
            return win;
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            let timeoutId = null;

            const cleanup = () => {
                try { win.removeEventListener('app:ready', onReady); } catch (_) {}
            };

            const onReady = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                cleanup();
                installBridge(win);
                resolve(win);
            };

            timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                reject(new Error('App 初始化超时'));
            }, 6000);

            try {
                win.addEventListener('app:ready', onReady, { once: true });
            } catch (error) {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                cleanup();
                reject(error);
            }
        });
    }

    async function runScenario() {
        const token = ++activeRunToken;
        setStatus('正在执行端到端流程...', 'running');
        runButton.disabled = true;
        try {
            const win = await ensureAppReady();
            if (token !== activeRunToken) {
                return;
            }
            log('App 已经完成初始化，开始模拟交互。');
            const doc = win.document;

            await waitFor(() => doc.querySelector('nav.main-nav'), 4000);
            const browseButton = doc.querySelector('nav.main-nav button[data-view="browse"]');
            if (browseButton) {
                log('点击导航：题库浏览');
                browseButton.click();
                await waitFor(() => doc.getElementById('browse-view')?.classList.contains('active'), 4000);
            } else {
                log('未找到题库浏览导航按钮', 'warn');
            }

            if (typeof win.filterByType === 'function') {
                log('筛选题型：reading');
                win.filterByType('reading');
                await delay(350);
            }

            if (typeof win.searchExams === 'function') {
                log('执行搜索：IELTS');
                win.searchExams('IELTS');
                await delay(350);
            }

            if (typeof win.applyBrowseFilter === 'function') {
                log('应用筛选：分类=all，题型=reading');
                win.applyBrowseFilter('all', 'reading');
                await delay(350);
            }

            const firstExam = await waitFor(() => {
                const title = doc.querySelector('.exam-card .exam-title');
                return title ? title.textContent.trim() : false;
            }, 5000).catch(() => null);
            if (firstExam) {
                log(`当前首个题目：${firstExam}`, 'dom');
            } else {
                log('未能捕获题目卡片，题库可能尚未加载完成。', 'warn');
            }

            setStatus('默认流程执行完毕', 'pass');
            log('端到端交互完成。');
        } catch (error) {
            if (token !== activeRunToken) {
                return;
            }
            setStatus(`测试失败：${error.message}`, 'fail');
            log(`测试失败：${error.stack || error.message}`, 'error');
        } finally {
            if (token === activeRunToken) {
                runButton.disabled = false;
            }
        }
    }

    async function probeAppReady() {
        const token = ++readyProbeToken;
        setStatus('等待应用初始化...', 'running');
        runButton.disabled = true;
        try {
            await ensureAppReady();
            if (token !== readyProbeToken) {
                return;
            }
            setStatus('应用已准备就绪，可以运行测试。', 'pass');
            runButton.disabled = false;
            log('✅ 应用初始化完成，可执行端到端测试。');
        } catch (error) {
            if (token !== readyProbeToken) {
                return;
            }
            setStatus(`等待应用失败：${error.message}`, 'fail');
            runButton.disabled = false;
            log(`等待应用失败：${error.message}`, 'warn');
        }
    }

    function reloadFrame() {
        activeRunToken++;
        readyProbeToken++;
        setStatus('重新加载沙箱...', 'running');
        runButton.disabled = true;
        teardownBridge();
        const timestamp = Date.now();
        iframe.src = `index.html?ts=${timestamp}`;
    }

    iframe.addEventListener('load', () => {
        log('iframe 已重新加载。');
        probeAppReady();
    });

    runButton.addEventListener('click', () => {
        runScenario();
    });

    reloadButton.addEventListener('click', () => {
        reloadFrame();
    });

    clearButton.addEventListener('click', () => {
        clearLog();
        log('日志已清空。');
    });

    // 初始探测
    if (iframe.contentDocument?.readyState === 'complete') {
        probeAppReady();
    }
})();
