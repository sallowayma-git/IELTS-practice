(function () {
    const FRAME_ID = 'app-frame';
    const SNAPSHOT_HTML = typeof window.__APP_INDEX_HTML_SNAPSHOT__ === 'string'
        ? window.__APP_INDEX_HTML_SNAPSHOT__
        : '';

    function ensureTrailingSlash(href) {
        if (!href) {
            return href;
        }
        return href.endsWith('/') ? href : href + '/';
    }

    function computeBaseHref() {
        try {
            const current = new URL(window.location.href);
            const marker = '/developer/tests/e2e/';
            if (current.pathname.includes(marker)) {
                const basePath = current.pathname.slice(0, current.pathname.indexOf(marker) + 1);
                current.pathname = basePath;
                current.search = '';
                current.hash = '';
                return ensureTrailingSlash(current.href);
            }
            return ensureTrailingSlash(new URL('./', current).href);
        } catch (error) {
            console.warn('[E2E] 无法计算 base href，使用当前目录', error);
            return './';
        }
    }

    function injectBaseHref(html, baseHref) {
        if (!html) {
            return html;
        }
        const sanitizedBase = ensureTrailingSlash(baseHref || './');
        if (/<base\s[^>]*>/i.test(html)) {
            return html.replace(/<base\s[^>]*>/i, `<base href="${sanitizedBase}">`);
        }
        return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n    <base href="${sanitizedBase}">`);
    }

    async function loadIndexFromNetwork(baseHref) {
        const indexUrl = new URL('index.html', baseHref);
        const response = await fetch(indexUrl.href, { credentials: 'same-origin' });
        if (!response.ok) {
            throw new Error(`加载 index.html 失败: ${response.status} ${response.statusText}`);
        }
        return response.text();
    }

    function shouldPreferSrcdoc(baseHref) {
        const iframe = document.createElement('iframe');
        const supportsSrcdoc = 'srcdoc' in iframe;
        if (!supportsSrcdoc) {
            return false;
        }

        try {
            const locationOrigin = window.location.origin;
            if (locationOrigin === 'null') {
                return true;
            }
        } catch (error) {
            console.warn('[E2E] 无法读取 window.location.origin', error);
        }

        if (typeof window.location !== 'undefined' && window.location.protocol === 'file:') {
            return true;
        }

        if (baseHref && baseHref.startsWith('file:')) {
            return true;
        }

        return false;
    }

    function setFrameSource(frame, html, options = {}) {
        const preferSrcdoc = options.preferSrcdoc === true;
        return new Promise((resolve, reject) => {
            let blobUrl = '';
            const onLoad = () => {
                cleanup();
                resolve();
            };
            const onError = (event) => {
                cleanup();
                reject(event?.error || new Error('iframe 加载失败'));
            };
            const cleanup = () => {
                frame.removeEventListener('load', onLoad);
                frame.removeEventListener('error', onError);
                if (blobUrl) {
                    try {
                        URL.revokeObjectURL(blobUrl);
                    } catch (error) {
                        console.warn('[E2E] 释放 iframe Blob URL 失败', error);
                    }
                }
            };

            frame.addEventListener('load', onLoad);
            frame.addEventListener('error', onError);

            try {
                if (preferSrcdoc) {
                    frame.removeAttribute('src');
                    frame.setAttribute('srcdoc', html);
                } else {
                    const blob = new Blob([html], { type: 'text/html' });
                    blobUrl = URL.createObjectURL(blob);
                    frame.removeAttribute('srcdoc');
                    frame.setAttribute('src', blobUrl);
                }
            } catch (error) {
                cleanup();
                reject(error);
            }
        });
    }

    window.__bootstrapAppFrame = async function __bootstrapAppFrame() {
        const frame = document.getElementById(FRAME_ID);
        if (!frame) {
            throw new Error('执行中断: 找不到测试 iframe 容器');
        }

        const baseHref = computeBaseHref();
        window.__APP_FRAME_BASE_HREF__ = baseHref;

        let proxyConfig = {};
        if (frame.dataset && frame.dataset.proxyConfig) {
            try {
                proxyConfig = JSON.parse(frame.dataset.proxyConfig);
            } catch (error) {
                console.warn('[E2E] 无法解析 iframe proxy 配置', error);
            }
        }
        if (window.__E2E_PROXY_CONFIG__ && typeof window.__E2E_PROXY_CONFIG__ === 'object') {
            proxyConfig = Object.assign({}, proxyConfig, window.__E2E_PROXY_CONFIG__);
        }
        window.__APP_FRAME_PROXY_CONFIG__ = proxyConfig;

        let html = '';
        let loadSource = 'snapshot';

        if (!baseHref.startsWith('file:')) {
            try {
                html = await loadIndexFromNetwork(baseHref);
                loadSource = 'network';
            } catch (error) {
                console.warn('[E2E] 网络加载 index.html 失败，回退至快照', error);
            }
        }

        if (!html) {
            if (!SNAPSHOT_HTML) {
                throw new Error('执行中断: 缺少 index.html 快照');
            }
            html = SNAPSHOT_HTML;
            loadSource = loadSource === 'network' ? 'network-fallback-snapshot' : 'snapshot';
        }

        let finalHtml = injectBaseHref(html, baseHref);

        if (proxyConfig && Object.keys(proxyConfig).length > 0) {
            try {
                const proxyScript = `\n<script>window.__APP_FRAME_PROXY_CONFIG__ = ${JSON.stringify(proxyConfig)};<\/script>`;
                if (/<\/body>/i.test(finalHtml)) {
                    finalHtml = finalHtml.replace(/<\/body>/i, proxyScript + '\n</body>');
                } else {
                    finalHtml += proxyScript;
                }
            } catch (error) {
                console.warn('[E2E] 注入代理配置脚本失败', error);
            }
        }

        const preferSrcdoc = shouldPreferSrcdoc(baseHref);
        await setFrameSource(frame, finalHtml, { preferSrcdoc });

        frame.dataset.loadSource = loadSource;
        frame.dataset.baseHref = baseHref;

        window.__APP_FRAME_LOAD_SOURCE__ = loadSource;

        const detail = { loadSource, baseHref, proxyConfig };
        window.dispatchEvent(new CustomEvent('app-frame-bootstrap:ready', { detail }));
        return detail;
    };
})();
