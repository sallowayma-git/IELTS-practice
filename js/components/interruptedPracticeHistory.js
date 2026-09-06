/** Read-only presentation of recovery records, kept separate from scored history. */
(function (global) {
    'use strict';

    const renderGenerations = new WeakMap();

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

    function createDetails(document, recordId, expanded, onLoadDetails, isCurrentRender) {
        const details = create(document, 'details', 'interrupted-history__details');
        details.dataset.interruptedId = scalarText(recordId);
        const summary = create(document, 'summary', '', '查看已保存答案');
        const content = create(document, 'div', 'interrupted-history__detail-content');
        let requestGeneration = 0;

        function clearDetails() {
            requestGeneration += 1;
            summary.textContent = '查看已保存答案';
            content.replaceChildren();
            content.setAttribute('aria-busy', 'false');
        }

        async function loadDetails() {
            if (!details.open || !isCurrentRender()) return;
            clearDetails();
            const request = requestGeneration;
            const isCurrentRequest = () => request === requestGeneration && details.open && isCurrentRender();
            const loading = create(document, 'p', 'interrupted-history__message', '正在读取已保存答案…');
            loading.setAttribute('role', 'status');
            content.appendChild(loading);
            content.setAttribute('aria-busy', 'true');
            try {
                if (typeof onLoadDetails !== 'function') throw new Error('Interrupted record reader unavailable');
                const currentRecord = await onLoadDetails(recordId);
                if (!isCurrentRequest()) return;
                if (currentRecord != null && scalarText(currentRecord.id) !== scalarText(recordId)) {
                    throw new Error('Interrupted record identity mismatch');
                }
                content.replaceChildren();
                content.setAttribute('aria-busy', 'false');
                if (currentRecord == null) {
                    const missing = create(document, 'p', 'interrupted-history__message',
                        '此中断记录已删除或超过保留期限，无法查看已保存答案。');
                    missing.setAttribute('role', 'status');
                    content.appendChild(missing);
                    return;
                }
                const answers = savedAnswers(currentRecord);
                summary.textContent = `查看已保存答案（${answers.length}）`;
                if (!answers.length) {
                    content.appendChild(create(document, 'p', 'interrupted-history__empty-answers',
                        '此记录没有保存的答案。阅读草稿单独保存，重新打开同一篇阅读可尝试恢复草稿。'));
                } else {
                    const answerList = create(document, 'dl', 'interrupted-history__answers');
                    answers.forEach(answer => {
                        answerList.appendChild(create(document, 'dt', '', `题号 ${answer.questionId}`));
                        answerList.appendChild(create(document, 'dd', '', answer.userAnswer));
                    });
                    content.appendChild(answerList);
                }
            } catch (_error) {
                if (!isCurrentRequest()) return;
                content.replaceChildren();
                content.setAttribute('aria-busy', 'false');
                const failure = create(document, 'p', 'interrupted-history__message', '未完成记录详情读取失败，请重试。');
                failure.setAttribute('role', 'alert');
                content.appendChild(failure);
                const retry = create(document, 'button', 'btn btn-secondary interrupted-history__detail-retry', '重试读取答案');
                retry.type = 'button';
                retry.addEventListener('click', loadDetails);
                content.appendChild(retry);
            }
        }

        // Invalidate synchronously on native summary activation as toggle events
        // are queued. A pending read must not survive a rapid close/reopen click.
        summary.addEventListener('click', clearDetails);
        details.addEventListener('toggle', () => {
            if (details.open) loadDetails();
            else clearDetails();
        });
        details.appendChild(summary);
        details.appendChild(content);
        // Native toggle also reloads rows whose expansion survives a list render.
        details.open = expanded;
        return details;
    }

    function render(options) {
        const { container, error, onDelete, onRetry, onLoadDetails } = options;
        if (!container) return;
        const generation = {};
        renderGenerations.set(container, generation);
        const isCurrentRender = () => renderGenerations.get(container) === generation;
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

                item.appendChild(createDetails(document, record.id, expanded.has(scalarText(record.id)),
                    onLoadDetails, isCurrentRender));
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
