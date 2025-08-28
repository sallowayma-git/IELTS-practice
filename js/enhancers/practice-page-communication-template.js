// 标准练习页面通信代码模板
// 此模板将被插入到缺少通信代码的练习页面中

const PRACTICE_PAGE_COMMUNICATION_TEMPLATE = `
<!-- 练习页面数据传输增强脚本 -->
<script>
// 检查是否已经有增强脚本
if (!window.practicePageEnhancer) {
    // 动态加载增强脚本
    const script = document.createElement('script');
    script.src = '../../js/practice-page-enhancer.js';
    script.onload = function() {
        console.log('练习页面增强脚本已加载');
    };
    script.onerror = function() {
        console.error('练习页面增强脚本加载失败');
        // 降级到内联增强
        loadInlineEnhancer();
    };
    document.head.appendChild(script);
}

// 内联增强器（降级方案）
function loadInlineEnhancer() {
    if (window.practicePageEnhancer) return;
    
    window.practicePageEnhancer = {
        initialize: function() {
            console.log('[InlineEnhancer] 内联增强器已初始化');
            this.setupCommunication();
            this.setupAnswerListeners();
            this.interceptSubmit();
        },
        
        setupCommunication: function() {
            this.parentWindow = window.opener || window.parent;
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'INIT_SESSION') {
                    this.sessionId = event.data.data.sessionId;
                    this.sendMessage('SESSION_READY', {
                        pageType: this.detectPageType(),
                        url: window.location.href
                    });
                }
            });
        },
        
        detectPageType: function() {
            const title = document.title || '';
            if (title.includes('P1')) return 'P1';
            if (title.includes('P2')) return 'P2';
            if (title.includes('P3')) return 'P3';
            return 'unknown';
        },
        
        setupAnswerListeners: function() {
            this.answers = {};
            this.startTime = Date.now();
            
            document.addEventListener('change', (e) => {
                if (e.target.name && e.target.name.startsWith('q')) {
                    this.answers[e.target.name] = e.target.value;
                }
            });
        },
        
        interceptSubmit: function() {
            // 拦截grade函数
            if (typeof window.grade === 'function') {
                const originalGrade = window.grade;
                window.grade = () => {
                    const result = originalGrade();
                    setTimeout(() => this.handleSubmit(), 200);
                    return result;
                };
            }
            
            // 监听提交按钮
            document.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON' && 
                    (e.target.textContent.includes('Submit') || 
                     e.target.onclick && e.target.onclick.toString().includes('grade'))) {
                    setTimeout(() => this.handleSubmit(), 300);
                }
            });
        },
        
        handleSubmit: function() {
            const results = {
                sessionId: this.sessionId,
                startTime: this.startTime,
                endTime: Date.now(),
                duration: Math.round((Date.now() - this.startTime) / 1000),
                answers: this.answers,
                scoreInfo: this.extractScore(),
                pageType: this.detectPageType(),
                url: window.location.href
            };
            
            this.sendMessage('PRACTICE_COMPLETE', results);
        },
        
        extractScore: function() {
            const resultsEl = document.getElementById('results');
            if (!resultsEl) return null;
            
            const text = resultsEl.textContent || '';
            const scoreMatch = text.match(/Score:\\s*(\\d+)\\/(\\d+)/i);
            if (scoreMatch) {
                const correct = parseInt(scoreMatch[1]);
                const total = parseInt(scoreMatch[2]);
                return {
                    correct: correct,
                    total: total,
                    accuracy: total > 0 ? correct / total : 0,
                    percentage: Math.round((correct / total) * 100),
                    source: 'inline_extraction'
                };
            }
            return null;
        },
        
        sendMessage: function(type, data) {
            if (this.parentWindow) {
                this.parentWindow.postMessage({
                    type: type,
                    data: data,
                    source: 'practice_page'
                }, '*');
            }
        }
    };
    
    // 初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.practicePageEnhancer.initialize();
        });
    } else {
        window.practicePageEnhancer.initialize();
    }
}
</script>
`;

// 导出模板
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PRACTICE_PAGE_COMMUNICATION_TEMPLATE };
}