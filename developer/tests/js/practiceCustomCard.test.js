#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import vm from 'vm';
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

function loadRadarCalculator(source) {
    const injected = source.replace(
        '})(window);',
        'global.__testCalculateReadingRadarData = calculateReadingRadarData;\n})(window);'
    );
    const sandboxWindow = {};
    const context = vm.createContext({
        window: sandboxWindow,
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        RegExp,
        Set,
        Map
    });
    vm.runInContext(injected, context, { filename: 'legacyViewBundle.js' });
    return sandboxWindow.__testCalculateReadingRadarData;
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
    assertContains(source, 'record.questionTypeMap', '雷达应优先读取记录自带 questionTypeMap');
    assertContains(source, 'getDetailSources(record)', '雷达应从 answerDetails/scoreInfo.details 提取错题');
    assertContains(source, 'addPerformanceCounts(counts, performanceMap)', '雷达应优先使用 questionTypePerformance');
    assertContains(source, "questionTypeAliases[compact] || questionTypeAliases[token] || 'other'", '未知题型必须归入固定 other 枚举，不能生成不可渲染分类');
    assertContains(source, "event.target.closest('.practice-custom-card__flip-btn')", '翻转只应绑定右上角按钮');
    assertContains(source, 'event.stopPropagation();', '整卡其他区域点击应阻止冒泡且不翻转');
    record('雷达业务逻辑守卫');

    const calculateReadingRadarData = loadRadarCalculator(source);
    assert.strictEqual(typeof calculateReadingRadarData, 'function', '雷达聚合函数应可被测试提取');
    const radarData = calculateReadingRadarData([{
        id: 'radar_question_type_regression',
        type: 'reading',
        examId: 'p1-low-radar',
        date: '2026-05-24T00:00:00.000Z',
        questionTypeMap: {
            q1: 'true_false_not_given',
            q2: 'short_answer',
            q3: 'sentence_completion'
        },
        scoreInfo: {
            details: {
                q1: { questionId: 'q1', userAnswer: 'FALSE', correctAnswer: 'TRUE', isCorrect: false },
                q2: { questionId: 'q2', userAnswer: 'museum', correctAnswer: 'library', isCorrect: false },
                q3: { questionId: 'q3', userAnswer: 'river', correctAnswer: 'river', isCorrect: true }
            }
        }
    }]);
    const radarCounts = Object.fromEntries(radarData.dataPoints.map((point) => [point.label, point.value]));
    assert.strictEqual(radarCounts['判断题'], 1, 'q1 应按 questionTypeMap 计入判断题错题');
    assert.strictEqual(radarCounts['简答题'], 1, 'q2 应按 questionTypeMap 计入简答题错题');
    assert.strictEqual(radarCounts['其他题型'] || 0, 0, '已定义题型不应落入其他题型');
    assert.strictEqual(radarData.totalErrors, 2, '雷达应只统计两道错题');
    record('雷达题型映射回归守卫');

    [
        'function calculateReadingRadarData(records)',
        'buildReadingQuestionTypeMap(record)',
        'record.questionTypeMap',
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
