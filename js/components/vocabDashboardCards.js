(function(window) {
    function resolveContainer(container) {
        if (!container) {
            return null;
        }
        if (typeof container === 'string') {
            return document.querySelector(container);
        }
        return container;
    }

    function createCard({ title, value, description }) {
        const card = document.createElement('div');
        card.className = 'vocab-dashboard-card';
        const heading = document.createElement('h3');
        heading.textContent = title;
        const valueEl = document.createElement('p');
        valueEl.style.fontSize = '1.6rem';
        valueEl.style.fontWeight = '600';
        valueEl.style.marginBottom = '0.25rem';
        valueEl.textContent = value;
        const descEl = document.createElement('p');
        descEl.textContent = description;
        card.appendChild(heading);
        card.appendChild(valueEl);
        card.appendChild(descEl);
        return card;
    }

    function render(container, stats = {}) {
        const target = resolveContainer(container);
        if (!target) {
            return null;
        }
        target.innerHTML = '';
        const totalWords = Number(stats.totalWords) || 0;
        const dueCount = Number(stats.dueCount) || 0;
        const masteredCount = Number(stats.masteredCount) || 0;
        const dailyNew = Number(stats.dailyNew) || 0;
        const reviewLimit = Number(stats.reviewLimit) || 0;
        const cards = [
            createCard({
                title: '词库总量',
                value: totalWords,
                description: `掌握 ${masteredCount} · 待学习 ${Math.max(totalWords - masteredCount, 0)}`
            }),
            createCard({
                title: '今日复习',
                value: dueCount,
                description: `复习上限 ${reviewLimit}`
            }),
            createCard({
                title: '新词计划',
                value: dailyNew,
                description: '每日新词目标'
            })
        ];
        cards.forEach((card) => target.appendChild(card));
        return target;
    }

    const api = Object.freeze({ render });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabDashboardCards = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
