(function (global) {
    'use strict';

    let records = [];
    let options = {};
    const points = value => Number(value.toFixed(4)).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
    const accuracy = value => value === null ? '暂无可用成绩' : `${(value * 100).toFixed(1)}%`;
    const fraction = value => value.scored ? `${points(value.earned)} / ${points(value.possible)} 分` : '分母未知或无有效成绩';

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function table(title, headers, rows) {
        const container = node('div', null, 'reading-analytics__table-wrap');
        const tableNode = node('table');
        tableNode.appendChild(node('caption', title));
        const head = node('thead');
        const header = node('tr');
        headers.forEach(text => {
            const cell = node('th', text);
            cell.scope = 'col';
            header.appendChild(cell);
        });
        head.appendChild(header);
        tableNode.appendChild(head);
        const body = node('tbody');
        rows.forEach(cells => {
            const row = node('tr');
            cells.forEach((text, index) => {
                const cell = node(index ? 'td' : 'th', text);
                if (!index) cell.scope = 'row';
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
        tableNode.appendChild(body);
        container.appendChild(tableNode);
        return container;
    }

    function render() {
        const container = document.getElementById('reading-analytics-content');
        const range = document.getElementById('reading-analytics-range');
        if (!container || !global.ReadingAnalytics) return;
        const result = global.ReadingAnalytics.aggregate(records, { ...options, days: range && range.value });
        const { total, coverage } = result;
        container.replaceChildren();
        const scope = node('p', null, 'reading-analytics__scope');
        scope.id = 'reading-analytics-scope';
        scope.textContent = `${result.days ? `近 ${result.days} 天（含今天，按本地日期）` : '全部保存历史'} · `
            + `${options.recordType === 'listening' ? '当前类型：听力' : '阅读记录'} · 每次有效提交均计入`
            + (options.query ? ` · 搜索：${options.query}` : '');
        container.appendChild(scope);
        if (options.recordType === 'listening') {
            container.appendChild(node('p', '当前选择的是听力记录，阅读统计不包含听力成绩。'));
            return;
        }
        if (!total.attempts) container.appendChild(node('p', '当前范围暂无可统计的阅读篇章提交。', 'reading-analytics__empty'));
        const cards = node('dl', null, 'reading-analytics__summary');
        const card = (label, value, note) => {
            const item = node('div');
            item.appendChild(node('dt', label));
            item.appendChild(node('dd', value));
            item.appendChild(node('p', note));
            cards.appendChild(item);
        };
        card('篇章加权正确率', accuracy(total.accuracy), `${fraction(total)} · 总得分 ÷ 总分`);
        card('篇章提交次数', `${total.attempts} 次`, `可评分 ${total.scored} / ${total.attempts} 次，包含重复练习`);
        card('已识别的不同篇章', total.attempts > coverage.unknownIdentity ? `${total.distinctPassages} 篇` : '暂无可用身份',
            `来源与篇章身份已知 ${total.attempts - coverage.unknownIdentity} / ${total.attempts} 次`);
        container.appendChild(cards);
        container.appendChild(table('P1 / P2 / P3 表现', ['分类', '加权正确率', '得分 / 总分', '可评分 / 提交', '已识别篇章'],
            Object.entries(result.categories).map(([category, value]) => [category, accuracy(value.accuracy),
                fraction(value), `${value.scored} / ${value.attempts} 次`, `${value.distinctPassages} 篇`])));
        container.appendChild(node('p', `分类已知 ${total.attempts - coverage.unknownCategory} / ${total.attempts} 次；`
            + `分类未知 ${coverage.unknownCategory} 次仍可参与有有效分母的篇章总分统计。`, 'reading-analytics__coverage'));
        const typeRows = Object.entries(result.questionTypes).map(([type, value]) => [
            global.ReadingAnalytics.typeNames[type], accuracy(value.accuracy), fraction(value), `${value.scored} 次`
        ]);
        if (typeRows.length) container.appendChild(table('题型表现', ['题型', '加权正确率', '得分 / 总分', '贡献提交'], typeRows));
        else container.appendChild(node('p', '题型表现暂无可用数据：需要保存各题型的得分与总分。', 'reading-analytics__empty'));
        container.appendChild(node('p', `题型完整覆盖 ${coverage.completeQuestionTypes} / ${total.scored} 次可评分提交；`
            + `已识别题型分值 ${points(coverage.classifiedPossible)} / ${points(total.possible)} 分。`
            + '缺失或无法识别的题型不计入题型表。', 'reading-analytics__coverage'));
        if (coverage.suiteWithoutChildren) {
            container.appendChild(node('p', `另有 ${coverage.suiteWithoutChildren} 条套题仅保存整体记录：`
                + `${accuracy(result.suiteOnly.accuracy)}（${fraction(result.suiteOnly)}，`
                + `可评分 ${result.suiteOnly.scored} / ${result.suiteOnly.attempts} 条）。`
                + '这些总分单独展示，不计入上方篇章或题型统计。', 'reading-analytics__coverage'));
        }
        container.appendChild(node('p', `成绩或分母不可用 ${coverage.unknownScore} 次；`
            + `已知缺失套题子篇 ${coverage.missingSuiteChildren} 篇；`
            + (result.days ? `日期未知而排除 ${coverage.excludedUndated} 条。` : `日期未知 ${coverage.unknownDate} 条。`),
        'reading-analytics__coverage'));
        container.appendChild(node('p', '统计仅使用已保存的阅读提交，排除草稿、中断、演示及明确不可评分记录。'
            + '套题按子篇统计；缺失信息保留为未知，不从当前题库推测。', 'reading-analytics__scope'));
    }

    function update(nextRecords, nextOptions = {}) {
        records = Array.isArray(nextRecords) ? nextRecords : [];
        options = nextOptions;
        const range = document.getElementById('reading-analytics-range');
        if (range && !range.dataset.analyticsBound) {
            range.dataset.analyticsBound = 'true';
            range.addEventListener('change', render);
        }
        render();
    }

    global.ReadingAnalyticsPanel = { update };
})(window);
