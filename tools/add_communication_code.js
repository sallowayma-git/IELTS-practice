const fs = require('fs');
const path = require('path');

// 基于Rubber橡胶模板的正确通信代码
const communicationCodeTemplate = `
<script>
// 检查是否已经有增强脚本
if (!window.practicePageEnhancer) {
    // 动态加载增强脚本
    const script = document.createElement('script');
    script.src = '../../../js/practice-page-enhancer.js';
    script.onload = function() {
        console.log('[PracticePageEnhancer] 外部脚本加载成功');
        if (window.practicePageEnhancer) {
            window.practicePageEnhancer.initialize();
        }
    };
    script.onerror = function() {
        console.log('[PracticePageEnhancer] 外部脚本加载失败，使用内联版本');
        loadInlineEnhancer();
    };
    document.head.appendChild(script);
    
    // 超时降级
    setTimeout(function() {
        if (!window.practicePageEnhancer) {
            console.log('[PracticePageEnhancer] 超时降级到内联版本');
            loadInlineEnhancer();
        }
    }, 2000);
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
                     e.target.textContent.includes('提交') ||
                     e.target.textContent.includes('完成') ||
                     e.target.textContent.includes('Check') ||
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
</script>`;

// 检查文件是否已包含通信代码
function hasCommuncationCode(content) {
    return content.includes('postMessage') || 
           content.includes('PRACTICE_COMPLETE') ||
           content.includes('practicePageEnhancer');
}

// 为HTML文件添加通信代码
function enhanceHtmlFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // 检查是否已有通信代码
        if (hasCommuncationCode(content)) {
            console.log(`跳过 ${filePath} - 已包含通信代码`);
            return false;
        }
        
        // 在</body>标签前插入通信代码
        const bodyCloseIndex = content.lastIndexOf('</body>');
        if (bodyCloseIndex === -1) {
            console.log(`跳过 ${filePath} - 未找到</body>标签`);
            return false;
        }
        
        const enhancedContent = content.slice(0, bodyCloseIndex) + 
                               communicationCodeTemplate + 
                               content.slice(bodyCloseIndex);
        
        // 写入增强后的内容
        fs.writeFileSync(filePath, enhancedContent, 'utf8');
        console.log(`已增强 ${filePath}`);
        return true;
        
    } catch (error) {
        console.error(`处理文件 ${filePath} 时出错:`, error.message);
        return false;
    }
}

// 需要处理的新文件列表
const newFiles = [
    'P1（12+8）/2.次高频(网页由窦立盛老师制作)/P1 - Bovids(0810)牛科动物/P1 - Bovids(0810).html',
    'P1（12+8）/2.次高频(网页由窦立盛老师制作)/P1 - Dolls through the ages(8.27)玩偶的变迁史/P1 - Dolls through the ages玩偶变迁史.html',
    'P1（12+8）/2.次高频(网页由窦立盛老师制作)/P1 - Footprints in the Mud(0823)恐龙脚印/P1 - Footprints in the Mud(0823).html',
    'P1（12+8）/2.次高频(网页由窦立盛老师制作)/P1 - Investing in the Future（8.26）投资未来/P1 - Investing in the Future(0826).html',
    'P1（12+8）/2.次高频(网页由窦立盛老师制作)/P1 - The extinction of the cave bear(8.25)洞熊的灭绝/P1 - The extinction of the cave bear(0825).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - Biomimicry(0807)仿生学/P2 - Biomimicry(0807).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - Herbal Medicines(0815)新西兰草药/P2 - Herbal Medicines(0815).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - Should space be explored by robots or by humans(0812)人机太空探索/P2 - Should space be explored by robots or by humans(0812).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - The Constant Evolution of the Humble Tomato(0821)番茄的演化/P2 - The Constant Evolution of the Humble Tomato(0821).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - The Importance of Law(0814)法律的意义/P2 - The Importance of Law(0814).html',
    'P2（14+2）/1.高频(网页由窦立盛老师制作)/P2 - Will Eating Less Make You Live Longer(0822)节食与长寿/P2 - Will Eating Less Make You Live Longer(0822).html',
    'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Humanities and the health professional(0811)人文医学/P3 - Humanities and the health professional(0811).html',
    'P3 （20+6）/1.高频(网页由🕊️制作)/P3 - Star Performers(0808)明星员工/P3 - Star Performers(0808).html',
    'P3 （20+6）/2.次高频(网页由🕊️制作)/P3 - Images and Places(8.24)风景与印记/P3 - Images and Places（0824）.html'
];

// 主函数
function main() {
    console.log('开始为新文件添加通信代码...');
    
    let enhancedCount = 0;
    
    for (const filePath of newFiles) {
        const fullPath = path.join('0.3', filePath);
        if (fs.existsSync(fullPath)) {
            if (enhanceHtmlFile(fullPath)) {
                enhancedCount++;
            }
        } else {
            console.log(`文件不存在: ${fullPath}`);
        }
    }
    
    console.log(`\\n增强完成！总共增强了 ${enhancedCount} 个HTML文件`);
}

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = {
    enhanceHtmlFile,
    hasCommuncationCode
};