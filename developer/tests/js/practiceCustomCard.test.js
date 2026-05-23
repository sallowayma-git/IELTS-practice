#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const checks = [];

function record(name, detail = {}) {
    checks.push({ name, detail });
}

function assertContains(source, snippet, message) {
    assert(source.includes(snippet), message);
}

function assertNotContains(source, snippet, message) {
    assert(!source.includes(snippet), message);
}

try {
    const indexHtml = read('index.html');
    const css = read('css/heroui-bridge.css');
    const source = read('js/views/legacyViewBundle.js');
    const bundle = read('js/bundles/browse.bundle.js');

    assertNotContains(indexHtml, 'id="practice-custom-widget-label"', '自定义胶囊按钮不应存在');
    assertNotContains(indexHtml, 'role="button"\n                            tabindex="0"\n                            aria-label="打开自定义练习组件选择"', '整卡不应伪装为按钮');
    assertContains(indexHtml, 'id="practice-radar-canvas"', '阅读雷达 canvas 应存在');
    assertContains(indexHtml, 'data-practice-widget="radar"', '背面组件选择入口应包含阅读雷达');
    assertContains(indexHtml, 'class="practice-custom-card__flip-btn"', '翻转按钮应存在');
    record('自定义卡片 DOM 结构守卫');

    assertContains(css, '.practice-custom-card__flip-btn', '翻转按钮样式应存在');
    assertContains(css, '.practice-radar-summary', '雷达摘要样式应存在');
    record('自定义卡片 CSS 守卫');

    assertContains(source, 'function calculateReadingRadarData(records)', '雷达数据聚合函数应存在');
    assertContains(source, 'buildReadingQuestionTypeMap(record)', '雷达应从阅读题组建立题型映射');
    assertContains(source, 'window.__READING_EXAM_DATA__', '雷达应使用阅读题库注册数据兜底');
    assertContains(source, 'getDetailSources(record)', '雷达应从 answerDetails/scoreInfo.details 提取错题');
    assertContains(source, 'addPerformanceCounts(counts, performanceMap)', '雷达应优先使用 questionTypePerformance');
    assertContains(source, "questionTypeAliases[compact] || questionTypeAliases[token] || 'other'", '未知题型必须归入固定 other 枚举，不能生成不可渲染分类');
    assertContains(source, "event.target.closest('.practice-custom-card__flip-btn')", '翻转只应绑定右上角按钮');
    assertContains(source, 'event.stopPropagation();', '整卡其他区域点击应阻止冒泡且不翻转');
    record('雷达业务逻辑守卫');

    [
        'function calculateReadingRadarData(records)',
        'buildReadingQuestionTypeMap(record)',
        'practice-radar-summary',
        "event.target.closest('.practice-custom-card__flip-btn')"
    ].forEach((snippet) => {
        assertContains(bundle, snippet, `browse bundle 缺少同步片段: ${snippet}`);
    });
    record('browse bundle 同步守卫');

    console.log(JSON.stringify({
        status: 'pass',
        detail: `${checks.length}/${checks.length} 测试通过`,
        passed: checks.length,
        total: checks.length
    }, null, 2));
} catch (error) {
    console.log(JSON.stringify({
        status: 'fail',
        detail: error.message,
        checks
    }, null, 2));
    process.exit(1);
}
