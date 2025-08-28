const fs = require('fs');
const path = require('path');

// 模拟浏览器环境
global.window = {};

// 加载索引数据
const indexPath = path.join('0.3', 'complete-exam-data.js');
const indexContent = fs.readFileSync(indexPath, 'utf8');

// 执行索引文件以获取数据
eval(indexContent);

// 获取数据
const completeExamIndex = global.window.completeExamIndex;

console.log('=== IELTS题库验证报告 ===');
console.log(`总题目数量: ${completeExamIndex.length}`);

// 统计各分类题目数量
const stats = {
    P1: { high: 0, low: 0 },
    P2: { high: 0, low: 0 },
    P3: { high: 0, low: 0 }
};

let newExamsCount = 0;

completeExamIndex.forEach(exam => {
    if (exam.category && exam.frequency) {
        stats[exam.category][exam.frequency]++;
    }
    if (exam.isNewlyDiscovered && exam.discoveryDate === '2025-08-28T00:00:00.000Z') {
        newExamsCount++;
    }
});

console.log('\\n=== 分类统计 ===');
console.log(`P1 高频: ${stats.P1.high} 题`);
console.log(`P1 次高频: ${stats.P1.low} 题`);
console.log(`P2 高频: ${stats.P2.high} 题`);
console.log(`P2 次高频: ${stats.P2.low} 题`);
console.log(`P3 高频: ${stats.P3.high} 题`);
console.log(`P3 次高频: ${stats.P3.low} 题`);

console.log(`\\n=== 新增题目 ===`);
console.log(`今日新增题目数量: ${newExamsCount}`);

// 列出新增题目
console.log('\\n新增题目列表:');
completeExamIndex.forEach(exam => {
    if (exam.isNewlyDiscovered && exam.discoveryDate === '2025-08-28T00:00:00.000Z') {
        console.log(`- ${exam.category} ${exam.frequency}: ${exam.title}`);
    }
});

// 验证文件存在性
console.log('\\n=== 文件验证 ===');
let validFiles = 0;
let invalidFiles = 0;

const newExams = completeExamIndex.filter(exam => 
    exam.isNewlyDiscovered && exam.discoveryDate === '2025-08-28T00:00:00.000Z'
);

newExams.forEach(exam => {
    const htmlPath = path.join('0.3', exam.path, exam.filename);
    const pdfPath = exam.pdfFilename ? path.join('0.3', exam.path, exam.pdfFilename) : null;
    
    console.log(`\\n检查: ${exam.title}`);
    
    if (exam.hasHtml && exam.filename) {
        if (fs.existsSync(htmlPath)) {
            console.log(`  ✓ HTML文件存在: ${exam.filename}`);
            validFiles++;
        } else {
            console.log(`  ✗ HTML文件缺失: ${exam.filename}`);
            invalidFiles++;
        }
    }
    
    if (exam.hasPdf && exam.pdfFilename) {
        if (fs.existsSync(pdfPath)) {
            console.log(`  ✓ PDF文件存在: ${exam.pdfFilename}`);
            validFiles++;
        } else {
            console.log(`  ✗ PDF文件缺失: ${exam.pdfFilename}`);
            invalidFiles++;
        }
    }
});

console.log(`\\n=== 验证结果 ===`);
console.log(`有效文件: ${validFiles}`);
console.log(`无效文件: ${invalidFiles}`);
console.log(`验证成功率: ${Math.round((validFiles / (validFiles + invalidFiles)) * 100)}%`);

console.log('\\n=== 验证完成 ===');