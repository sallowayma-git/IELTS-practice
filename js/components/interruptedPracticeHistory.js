/** Read-only presentation of recovery records, kept separate from scored history. */
(function (global) {
    'use strict';

    function scalarText(value) {
        return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
    }

    function answerText(value) {
        if (Array.isArray(value)) {
            return value.map(scalarText).filter(Boolean).join(', ');
        }
        return scalarText(value);
    }

    // Never pass recovery payloads through scored-answer or replay normalizers:
    // their fallbacks may substitute a correct answer for a missing user answer.
    function savedAnswers(record) {
        const answers = record.answers;
        const entries = Array.isArray(answers)
            ? answers.map((entry, index) => {
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                    return [entry.questionId == null ? index + 1 : entry.questionId,
                        Object.prototype.hasOwnProperty.call(entry, 'userAnswer') ? entry.userAnswer : entry.answer];
                }
                return [index + 1, entry];
            })
            : (answers && typeof answers === 'object' ? Object.entries(answers) : []);

        return entries.map(([questionId, value]) => {
            const userAnswer = value && typeof value === 'object' && !Array.isArray(value)
                ? value.userAnswer
                : value;
            return { questionId: scalarText(questionId), userAnswer: answerText(userAnswer) };
        }).filter(entry => entry.questionId && entry.userAnswer.trim());
    }

    function create(document, tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function render(options) {
        const { container, error, onDelete, onRetry } = options;
        if (!container) return;
        const document = container.ownerDocument || global.document;
        const records = Array.isArray(options.records) ? options.records : [];
        const expanded = new Set(Array.from(container.querySelectorAll('details[data-interrupted-id]'))
            .filter(details => details.open).map(details => details.dataset.interruptedId));
        const fragment = document.createDocumentFragment();
        const heading = create(document, 'div', 'hero-panel__header');
        const title = create(document, 'h3', 'hero-panel__title', '未完成 / 中断');
        title.id = 'interrupted-practice-history-title';
        container.setAttribute('aria-labelledby', title.id);
        heading.appendChild(title);
        heading.appendChild(create(document, 'span', 'interrupted-history__count', error ? '读取失败' : `${records.length} 条`));
        fragment.appendChild(heading);
        fragment.appendChild(create(document, 'p', 'hero-panel__muted interrupted-history__note',
            '中断记录保留 30 天；保存新记录时最多保留 100 条。未提交成绩，不计入正式练习统计。'));

        if (error) {
            const failure = create(document, 'div', 'interrupted-history__message');
            const message = create(document, 'p', '', '未完成记录读取失败，请重试。');
            message.setAttribute('role', 'alert');
            failure.appendChild(message);
            if (typeof onRetry === 'function') {
                const retry = create(document, 'button', 'btn btn-secondary', '重试');
                retry.type = 'button';
                retry.addEventListener('click', () => onRetry());
                failure.appendChild(retry);
            }
            fragment.appendChild(failure);
        } else if (!records.length) {
            const empty = create(document, 'p', 'interrupted-history__message', '暂无未完成 / 中断记录');
            empty.setAttribute('role', 'status');
            fragment.appendChild(empty);
        } else {
            const list = create(document, 'ul', 'interrupted-history__list');
            records.forEach(record => {
                const item = create(document, 'li', 'interrupted-history__item');
                const metadata = record.metadata || {};
                const recordTitle = scalarText(record.title) || scalarText(metadata.examTitle)
                    || scalarText(metadata.title) || scalarText(record.examId) || '未知练习';
                const rowHeader = create(document, 'div', 'interrupted-history__row-header');
                rowHeader.appendChild(create(document, 'h4', 'interrupted-history__title', recordTitle));
                rowHeader.appendChild(create(document, 'span', 'interrupted-history__status', '中断'));
                item.appendChild(rowHeader);

                const date = new Date(record.endTime || record.createdAt || record.startTime || NaN);
                const time = create(document, 'time', 'interrupted-history__meta',
                    Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '时间未知');
                if (Number.isFinite(date.getTime())) time.dateTime = date.toISOString();
                item.appendChild(time);
                const reasons = { timeout: '会话超时', window_closed: '练习窗口已关闭',
                    user_closed: '练习窗口已关闭', page_unload: '练习页面已离开' };
                const reason = scalarText(record.reason);
                item.appendChild(create(document, 'p', 'interrupted-history__meta',
                    `中断原因：${Object.prototype.hasOwnProperty.call(reasons, reason) ? reasons[reason] : (reason || '未记录')}`));

                const answers = savedAnswers(record);
                const details = create(document, 'details', 'interrupted-history__details');
                details.dataset.interruptedId = scalarText(record.id);
                details.open = expanded.has(details.dataset.interruptedId);
                details.appendChild(create(document, 'summary', '', `查看已保存答案（${answers.length}）`));
                if (!answers.length) {
                    details.appendChild(create(document, 'p', 'interrupted-history__empty-answers',
                        '此记录没有保存的答案。阅读草稿单独保存，重新打开同一篇阅读可尝试恢复草稿。'));
                } else {
                    const answerList = create(document, 'dl', 'interrupted-history__answers');
                    answers.forEach(answer => {
                        answerList.appendChild(create(document, 'dt', '', `题号 ${answer.questionId}`));
                        answerList.appendChild(create(document, 'dd', '', answer.userAnswer));
                    });
                    details.appendChild(answerList);
                }
                item.appendChild(details);
                if (typeof onDelete === 'function' && scalarText(record.id)) {
                    const remove = create(document, 'button', 'btn btn-secondary interrupted-history__delete', '删除中断记录');
                    remove.type = 'button';
                    remove.setAttribute('aria-label', `删除中断记录：${recordTitle}`);
                    remove.addEventListener('click', () => onDelete(record.id));
                    item.appendChild(remove);
                }
                list.appendChild(item);
            });
            fragment.appendChild(list);
        }
        container.replaceChildren(fragment);
    }

    global.InterruptedPracticeHistory = { render };
})(typeof window !== 'undefined' ? window : globalThis);
