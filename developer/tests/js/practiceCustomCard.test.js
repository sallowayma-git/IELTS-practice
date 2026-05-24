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

function loadCustomCardCalculators(source) {
    const injected = source.replace(
        '})(window);',
        [
            'global.__testCalculateReadingRadarData = calculateReadingRadarData;',
            'global.__testCalculatePracticeHeatmapData = calculatePracticeHeatmapData;',
            '})(window);'
        ].join('\n')
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
    return {
        calculateReadingRadarData: sandboxWindow.__testCalculateReadingRadarData,
        calculatePracticeHeatmapData: sandboxWindow.__testCalculatePracticeHeatmapData
    };
}

try {
    const indexHtml = read('index.html');
    const css = read('css/heroui-bridge.css');
    const source = read('js/views/legacyViewBundle.js');
    const bundle = read('js/bundles/browse.bundle.js');

    assertNotContains(indexHtml, 'id="practice-custom-widget-label"', '自定义胶囊按钮不应存在');
    assertNotContains(indexHtml, 'role="button"\n                            tabindex="0"\n                            aria-label="打开自定义练习组件选择"', '整卡不应伪装为按钮');
    assertNotContains(indexHtml, '<p class="practice-trend-card__eyebrow">Trend</p>', '练习趋势正面不应显示 Trend 英文标签');
    assertNotContains(indexHtml, '<p class="practice-trend-card__eyebrow">Focus</p>', '练习热力图正面不应显示 Focus 英文标签');
    assertContains(indexHtml, 'id="practice-heatmap"', '练习热力图容器应存在');
    assertContains(indexHtml, 'data-widget-type="heatmap"', '默认组件内容应包含热力图');
    assertContains(indexHtml, 'data-practice-widget="heatmap"', '背面组件选择入口应包含热力图');
    assertContains(indexHtml, 'practice-custom-option__icon', '背面组件选项应包含图标槽');
    assertContains(indexHtml, 'practice-custom-option__body', '背面组件选项应包含文本槽');
    assertContains(indexHtml, 'practice-custom-option__check', '背面组件选项应包含激活指示');
    assertContains(indexHtml, 'data-practice-heatmap-month="prev"', '热力图应提供上个月按钮');
    assertContains(indexHtml, 'data-practice-heatmap-month="next"', '热力图应提供下个月按钮');
    assertContains(indexHtml, 'id="practice-radar-canvas"', '阅读雷达 canvas 应存在');
    assertContains(indexHtml, 'data-practice-widget="radar"', '背面组件选择入口应包含阅读雷达');
    assertContains(indexHtml, 'practice-custom-card__flip-btn practice-custom-card__icon-btn', '翻转按钮应复用同尺寸图标按钮');
    record('自定义卡片 DOM 结构守卫');

    assertContains(css, '.practice-custom-card__icon-btn', '图标按钮样式应存在');
    assertContains(css, '.practice-custom-options {\n    display: grid;', '背面组件选择区应使用单列 grid，避免横向挤压');
    assertContains(css, 'grid-template-columns: 1fr;', '背面组件选择区应使用单列布局');
    assertContains(css, 'grid-template-columns: 38px minmax(0, 1fr) 18px;', '组件选项应有稳定的图标/文本/状态列');
    assertContains(css, '.practice-custom-option__icon', '组件选项图标样式应存在');
    assertContains(css, '.practice-custom-option__check', '组件选项激活指示样式应存在');
    assertContains(css, '.practice-custom-card__front {\n    gap: 12px;', '热力图正面应保持紧凑但不能靠强塞破坏对齐');
    assertContains(css, '.practice-trend-card__header {\n    display: flex;\n    align-items: center;', '两张洞察卡片头部应垂直居中对齐');
    assertContains(css, '.practice-trend-card__title-line {\n    display: flex;\n    flex: 1 1 auto;\n    align-items: center;', '趋势标题和指标胶囊应在同一水平线上');
    assertNotContains(css, '.practice-custom-card__front {\n    gap: 12px;\n    padding:', '自定义卡片正面不能单独改 padding 破坏标题对齐');
    assertNotContains(css, 'min-height: 372px;', '自定义卡片不能单独拉高，否则会破坏洞察卡片对齐');
    assertNotContains(css, '--practice-heatmap-cell: clamp(21px, 2.7vw, 28px);', '热力块不能靠 28px 强撑造成卡片错位');
    assertContains(css, '--practice-heatmap-cell: clamp(22px, 2.35vw, 26px);', '热力块应在原卡片高度内放大');
    assertContains(css, 'grid-template-columns: repeat(7, minmax(0, 1fr));', '热力图应使用横向 7 列月历布局');
    assertContains(css, 'grid-template-rows: repeat(var(--practice-heatmap-weeks, 5), var(--practice-heatmap-cell));', '热力图行数应随月份周数变化');
    assertContains(css, 'min-height: 194px;', '热力图主体高度应适配原卡片高度');
    assertContains(css, '.practice-heatmap__cell[data-level="4"]', '热力图深色等级样式应存在');
    assertContains(css, '.practice-heatmap__cell::after', '热力图悬浮提示样式应存在');
    assertContains(css, '.practice-radar-summary', '雷达摘要样式应存在');
    record('自定义卡片 CSS 守卫');

    assertContains(source, "this.activeWidget = options.defaultWidget || 'heatmap'", '自定义卡片默认组件应为热力图');
    assertContains(source, 'function calculatePracticeHeatmapData(records, monthDate)', '热力图数据聚合函数应存在');
    assertContains(source, 'aggregatePracticeHeatmapCounts(records, monthStart)', '热力图应按月份聚合练习记录');
    assertContains(source, "event.target.closest('[data-practice-heatmap-month]')", '月份按钮事件应单独绑定');
    assertContains(source, 'button.dataset.tooltip = cell.label', '热力图块应写入悬浮提示文案');
    assertContains(source, 'button.style.gridColumn = String(cell.weekday + 1);', '热力图应按星期横向铺开');
    assertContains(source, 'button.style.gridRow = String(cell.week + 1);', '热力图应按周数纵向换行');
    assertNotContains(source, 'button.style.gridColumn = String(cell.week + 1);', '热力图不能继续使用竖向周列布局');
    assertContains(source, 'resolvePracticeHeatmapQuestionCount(record)', '热力图深浅应按做题数量聚合');
    assertContains(source, 'function calculateReadingRadarData(records)', '雷达数据聚合函数应存在');
    assertContains(source, 'buildReadingQuestionTypeMap(record)', '雷达应从阅读题组建立题型映射');
    assertContains(source, 'window.__READING_EXAM_DATA__', '雷达应使用阅读题库注册数据兜底');
    assertContains(source, 'record.questionTypeMap', '雷达应优先读取记录自带 questionTypeMap');
    assertContains(source, 'getDetailSources(record)', '雷达应从 answerDetails/scoreInfo.details 提取错题');
    assertContains(source, 'addPerformanceCounts(counts, performanceMap)', '雷达应优先使用 questionTypePerformance');
    assertContains(source, "questionTypeAliases[compact] || questionTypeAliases[token] || 'other'", '未知题型必须归入固定 other 枚举，不能生成不可渲染分类');
    assertContains(source, "event.target.closest('.practice-custom-card__flip-btn')", '翻转只应绑定右上角按钮');
    assertContains(source, 'event.stopPropagation();', '整卡其他区域点击应阻止冒泡且不翻转');
    record('自定义卡片业务逻辑守卫');

    const { calculateReadingRadarData, calculatePracticeHeatmapData } = loadCustomCardCalculators(source);
    assert.strictEqual(typeof calculatePracticeHeatmapData, 'function', '热力图聚合函数应可被测试提取');
    const heatmapData = calculatePracticeHeatmapData([
        { id: 'h1', date: '2026-05-01T08:00:00', totalQuestions: 13 },
        { id: 'h2', startTime: '2026-05-01T11:00:00', scoreInfo: { total: 7 } },
        { id: 'h3', endTime: '2026-05-12T16:00:00', realData: { totalQuestions: 5 } },
        { id: 'h4', realData: { completedAt: '2026-04-30T23:00:00', totalQuestions: 9 } }
    ], new Date('2026-05-15T00:00:00.000Z'));
    const mayFirst = heatmapData.cells.find((cell) => cell.dateKey === '2026-05-01');
    const mayTwelfth = heatmapData.cells.find((cell) => cell.dateKey === '2026-05-12');
    assert.strictEqual(heatmapData.monthStart.getFullYear(), 2026, '热力图月份年份应来自选中月份');
    assert.strictEqual(heatmapData.monthStart.getMonth(), 4, '热力图月份应来自选中月份');
    assert.strictEqual(heatmapData.total, 25, '热力图应只统计选中月份的做题数量');
    assert.strictEqual(heatmapData.activeDays, 2, '热力图应统计活跃天数');
    assert.strictEqual(mayFirst.count, 20, '同一天多条记录的做题数量应累加');
    assert.strictEqual(mayTwelfth.count, 5, '单日做题数量应写入对应热力块');
    assert(mayFirst.level > mayTwelfth.level, '做题量更多的日期颜色等级应更深');
    record('热力图月份聚合回归守卫');

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
        "this.activeWidget = options.defaultWidget || 'heatmap'",
        'function calculatePracticeHeatmapData(records, monthDate)',
        'resolvePracticeHeatmapQuestionCount(record)',
        'practice-heatmap__cell',
        "event.target.closest('[data-practice-heatmap-month]')",
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
