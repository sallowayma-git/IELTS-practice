/**
 * 设计页适配脚本
 * 处理不同主题页面的路径适配和存储初始化
 * 版本: 1.0.0
 */

// 设计页适配：确保 app.js 在首次统计时不会读到 null
// storage.js 默认会将 exam_index 初始化为 null，这里在 app 初始化前兜底为 []
(function () {
    try {
        if (window.storage && typeof storage.get === 'function') {
            var idx = storage.get('exam_index', null);
            if (idx === null) {
                storage.set('exam_index', []);
            }
            // 也确保活动配置键存在，避免后续读取为空
            var activeKey = storage.get('active_exam_index_key', null);
            if (!activeKey) {
                storage.set('active_exam_index_key', 'exam_index');
            }
        }
    } catch (e) {
        console.warn('[Design Adapt] 预填充存储失败:', e);
    }
})();

// 设计页适配：修正资源路径为项目根的绝对 file:// URL（本页位于 .superdesign/design_iterations/ 下）
// 使 buildResourcePath 产出的相对路径在子目录内也能正确指向根部资源，且避免 ".." 被 PDFHandler 拒绝
(function () {
    var BASE_URL = new URL('../../', window.location.href);
    try {
        var originalBuild = window.buildResourcePath;
        window.buildResourcePath = function (exam, kind) {
            var p = '';
            try {
                p = originalBuild ? originalBuild(exam, kind) : '';
            } catch (_) {
                // buildResourcePath失败，使用空字符串作为默认值
            }
            if (typeof p === 'string') {
                // 规范化为不含 ".." 的绝对 URL
                // 去掉开头的 "./"，并使用 URL 解析为绝对路径
                var rel = p.replace(/^\.\//, '');
                var abs = new URL(rel, BASE_URL).href;
                return abs;
            }
            return p;
        };

        // 进一步兜底：若 PDFHandler 已加载，则修正其 openPDF 参数路径
        if (window.PDFHandler && window.PDFHandler.prototype && !window.PDFHandler.prototype.__designPatched) {
            var _openPDF = window.PDFHandler.prototype.openPDF;
            window.PDFHandler.prototype.openPDF = function (pdfPath, examTitle, options) {
                try {
                    if (typeof pdfPath === 'string') {
                        // 将相对路径解析为绝对 file:// URL，消除 ".."，以通过 PDFHandler 的校验
                        var normalized = pdfPath.replace(/^\.\//, '');
                        pdfPath = new URL(normalized, BASE_URL).href;
                    }
                } catch (_) {
                // URL解析失败，使用原始路径
            }
                return _openPDF.call(this, pdfPath, examTitle, options);
            };
            window.PDFHandler.prototype.__designPatched = true;
        }
    } catch (e) {
        console.warn('[Design Adapt] 路径适配失败:', e);
    }

    // 规范化 showMessage 的第三参，避免字符串导致 0ms 立即消失
    try {
        var _showMessage = window.showMessage;
        if (typeof _showMessage === 'function' && !_showMessage.__designPatched) {
            window.showMessage = function (message, type, duration) {
                var d = (typeof duration === 'number' && isFinite(duration)) ? duration : 3000;
                return _showMessage(message, type, d);
            };
            window.showMessage.__designPatched = true;
        }
    } catch (_) {
                // URL解析失败，使用原始路径
            }
})();