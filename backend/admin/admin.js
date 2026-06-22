(function() {
    const MAX_ADMIN_STATUS_CHARS = 240;
    const MAX_ADMIN_RESPONSE_JSON_LENGTH = 1024 * 1024;
    const MAX_RECORD_DETAIL_PAYLOAD_CHARS = 20000;
    const MAX_RECORD_DETAIL_PAYLOAD_DEPTH = 8;
    const MAX_RECORD_DETAIL_PAYLOAD_NODES = 5000;
    const MAX_RECORD_DETAIL_ARRAY_ITEMS = 500;
    const MAX_RECORD_DETAIL_OBJECT_KEYS = 200;
    const RECORD_DETAIL_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const ADMIN_STATUS_AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]+/gi;
    const ADMIN_STATUS_SECRET_VALUE_PATTERN = /\b((?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?)\s*[:=]\s*([^&\s"'<>]+)/gi;
    const ADMIN_STATUS_SECRET_QUERY_PATTERN = /([?&](?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?=)[^&\s"'<>]+/gi;

    const state = {
        csrfToken: '',
        currentUserId: '',
        selectedUser: null,
        selectedRecord: null,
        users: {
            limit: 25,
            offset: 0,
            total: 0,
            role: 'all',
            loading: false,
            requestId: 0
        },
        records: {
            limit: 20,
            offset: 0,
            total: 0,
            loading: false,
            requestId: 0
        },
        analyticsDays: 30,
        trafficDays: 14,
        userStatsRequestId: 0,
        confirmResolver: null
    };

    const nodes = {
        status: document.getElementById('status'),
        logoutButton: document.getElementById('logout-button'),
        refreshButton: document.getElementById('refresh-button'),
        userSearch: document.getElementById('user-search'),
        userRoleFilter: document.getElementById('user-role-filter'),
        summaryUsers: document.getElementById('summary-users'),
        summaryAdmins: document.getElementById('summary-admins'),
        summaryRecords: document.getElementById('summary-records'),
        summaryActiveUsers: document.getElementById('summary-active-users'),
        summaryAvgScore: document.getElementById('summary-avg-score'),
        summaryStudyTime: document.getElementById('summary-study-time'),
        summaryPageviews: document.getElementById('summary-pageviews'),
        summaryRequestsToday: document.getElementById('summary-requests-today'),
        summaryLatest: document.getElementById('summary-latest'),
        usersBody: document.getElementById('users-body'),
        usersPrev: document.getElementById('users-prev'),
        usersNext: document.getElementById('users-next'),
        usersRange: document.getElementById('users-range'),
        createUserForm: document.getElementById('create-user-form'),
        createUserSubmit: document.getElementById('create-user-submit'),
        createUsername: document.getElementById('create-username'),
        createPassword: document.getElementById('create-password'),
        createRole: document.getElementById('create-role'),
        editUserForm: document.getElementById('edit-user-form'),
        selectedUserName: document.getElementById('selected-user-name'),
        selectedUserRole: document.getElementById('selected-user-role'),
        selectedUserPassword: document.getElementById('selected-user-password'),
        saveUserButton: document.getElementById('save-user-button'),
        deleteUserButton: document.getElementById('delete-user-button'),
        userStatsTitle: document.getElementById('user-stats-title'),
        userStatRecords: document.getElementById('user-stat-records'),
        userStatAverage: document.getElementById('user-stat-average'),
        userStatDuration: document.getElementById('user-stat-duration'),
        userStatLatest: document.getElementById('user-stat-latest'),
        userTypeStats: document.getElementById('user-type-stats'),
        globalTypeStats: document.getElementById('global-type-stats'),
        analyticsRange: document.getElementById('analytics-range'),
        analyticsWindow: document.getElementById('analytics-window'),
        analyticsLearningChart: document.getElementById('analytics-learning-chart'),
        analyticsLearningTrend: document.getElementById('analytics-learning-trend'),
        analyticsUserGrowthChart: document.getElementById('analytics-user-growth-chart'),
        analyticsUserGrowth: document.getElementById('analytics-user-growth'),
        analyticsTopUsers: document.getElementById('analytics-top-users'),
        analyticsScoreChart: document.getElementById('analytics-score-chart'),
        analyticsScoreBuckets: document.getElementById('analytics-score-buckets'),
        recordsBody: document.getElementById('records-body'),
        recordsTitle: document.getElementById('records-title'),
        recordsPrev: document.getElementById('records-prev'),
        recordsNext: document.getElementById('records-next'),
        recordsRange: document.getElementById('records-range'),
        recordDetailTitle: document.getElementById('record-detail-title'),
        recordDetailBody: document.getElementById('record-detail-body'),
        trafficRange: document.getElementById('traffic-range'),
        trafficWindow: document.getElementById('traffic-window'),
        trafficRequests: document.getElementById('traffic-requests'),
        trafficPageviews: document.getElementById('traffic-pageviews'),
        trafficVisitors: document.getElementById('traffic-visitors'),
        trafficErrors: document.getElementById('traffic-errors'),
        trafficDailyChart: document.getElementById('traffic-daily-chart'),
        trafficDaily: document.getElementById('traffic-daily'),
        trafficPaths: document.getElementById('traffic-paths'),
        trafficRouteChart: document.getElementById('traffic-route-chart'),
        trafficRouteGroups: document.getElementById('traffic-route-groups'),
        trafficStatusChart: document.getElementById('traffic-status-chart'),
        trafficStatusCodes: document.getElementById('traffic-status-codes'),
        confirmDialog: document.getElementById('confirm-dialog'),
        confirmTitle: document.getElementById('confirm-title'),
        confirmMessage: document.getElementById('confirm-message'),
        confirmCancel: document.getElementById('confirm-cancel'),
        confirmSubmit: document.getElementById('confirm-submit')
    };

    function sanitizeStatusMessage(value, fallback = '') {
        const text = String(value ?? fallback)
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(ADMIN_STATUS_SECRET_QUERY_PATTERN, '$1[redacted]')
            .replace(ADMIN_STATUS_SECRET_VALUE_PATTERN, '$1=[redacted]')
            .replace(ADMIN_STATUS_AUTH_HEADER_PATTERN, '$1 [redacted]')
            .replace(/\s+/g, ' ')
            .trim();
        const normalized = text || fallback;
        return normalized.length > MAX_ADMIN_STATUS_CHARS
            ? `${normalized.slice(0, MAX_ADMIN_STATUS_CHARS - 3)}...`
            : normalized;
    }

    function setStatus(message, kind = 'info') {
        const safeMessage = sanitizeStatusMessage(message);
        nodes.status.textContent = safeMessage;
        nodes.status.dataset.kind = kind;
        if (safeMessage) {
            window.setTimeout(() => {
                if (nodes.status.textContent === safeMessage) {
                    nodes.status.textContent = '';
                    nodes.status.removeAttribute('data-kind');
                }
            }, kind === 'error' ? 7000 : 3500);
        }
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(Number(date))) return '-';
        return date.toLocaleString();
    }

    function formatNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '0';
        return new Intl.NumberFormat().format(Math.round(number * 10) / 10);
    }

    function toFiniteNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatScoreValue(value) {
        if (value === null || value === undefined || value === '') return '-';
        const number = toFiniteNumber(value);
        if (number === null) return '-';
        return `${Math.round(number * 10) / 10}%`;
    }

    function formatScore(record) {
        const score = toFiniteNumber(record && record.score);
        if (score === null) {
            return '-';
        }
        const totalQuestions = toFiniteNumber(record && record.totalQuestions);
        const suffix = totalQuestions === null ? '' : ` / ${Math.max(0, Math.round(totalQuestions))}`;
        return `${Math.round(score * 10) / 10}${suffix}`;
    }

    function sanitizeRecordDetailValue(value, depth = 0, state = { seen: new WeakSet(), nodes: 0 }) {
        if (value == null) {
            return value;
        }
        const valueType = typeof value;
        if (valueType === 'string' || valueType === 'boolean') {
            return value;
        }
        if (valueType === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (valueType === 'bigint') {
            return value.toString();
        }
        if (valueType !== 'object') {
            return null;
        }
        if (depth > MAX_RECORD_DETAIL_PAYLOAD_DEPTH) {
            return '[MaxDepth]';
        }
        if (state.seen.has(value)) {
            return '[Circular]';
        }
        if (state.nodes >= MAX_RECORD_DETAIL_PAYLOAD_NODES) {
            return '[Truncated]';
        }
        state.seen.add(value);
        state.nodes++;

        try {
            if (Array.isArray(value)) {
                const safeItems = value
                    .slice(0, MAX_RECORD_DETAIL_ARRAY_ITEMS)
                    .map((item) => sanitizeRecordDetailValue(item, depth + 1, state));
                if (value.length > safeItems.length) {
                    safeItems.push(`[Truncated ${value.length - safeItems.length} items]`);
                }
                return safeItems;
            }

            let keys;
            try {
                keys = Object.keys(value);
            } catch (_) {
                return '[Unreadable]';
            }
            const safeObject = {};
            for (const key of keys.slice(0, MAX_RECORD_DETAIL_OBJECT_KEYS)) {
                if (RECORD_DETAIL_POLLUTION_KEYS.has(key)) {
                    continue;
                }
                try {
                    safeObject[key] = sanitizeRecordDetailValue(value[key], depth + 1, state);
                } catch (_) {
                    safeObject[key] = '[Unreadable]';
                }
            }
            if (keys.length > MAX_RECORD_DETAIL_OBJECT_KEYS) {
                safeObject.__truncatedKeys = keys.length - MAX_RECORD_DETAIL_OBJECT_KEYS;
            }
            return safeObject;
        } finally {
            state.seen.delete(value);
        }
    }

    function safeStringifyRecordPayload(payload) {
        let text;
        try {
            text = JSON.stringify(sanitizeRecordDetailValue(payload || {}), null, 2);
        } catch (_) {
            text = '"[Unable to render payload]"';
        }
        if (typeof text !== 'string') {
            text = String(text || '');
        }
        if (text.length > MAX_RECORD_DETAIL_PAYLOAD_CHARS) {
            return `${text.slice(0, MAX_RECORD_DETAIL_PAYLOAD_CHARS)}\n... truncated`;
        }
        return text;
    }

    function setRowMessage(tbody, colSpan, message) {
        tbody.textContent = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.className = 'empty-cell';
        cell.colSpan = colSpan;
        cell.textContent = message;
        row.append(cell);
        tbody.append(row);
    }

    function rangeLabel(offset, limit, total) {
        if (!total) return '0 of 0';
        const start = Math.min(offset + 1, total);
        const end = Math.min(offset + limit, total);
        return `${start}-${end} of ${total}`;
    }

    function setListMessage(container, message) {
        container.textContent = '';
        const row = document.createElement('div');
        row.className = 'mini-list__row is-empty';
        row.textContent = message;
        container.append(row);
    }

    function renderBarRows(container, items, options) {
        container.textContent = '';
        if (!items.length) {
            setListMessage(container, options.emptyText);
            return;
        }
        const values = items.map((item) => Math.max(0, Number(options.value(item)) || 0));
        const max = Math.max(1, ...values);
        for (const [index, item] of items.entries()) {
            const row = document.createElement('div');
            row.className = 'bar-row';
            const label = document.createElement('strong');
            label.textContent = options.label(item);
            const bar = document.createElement('span');
            bar.className = 'traffic-bar';
            bar.style.setProperty('--bar-width', `${Math.max(5, Math.round((values[index] / max) * 100))}%`);
            const meta = document.createElement('em');
            meta.textContent = options.meta(item);
            row.append(label, bar, meta);
            container.append(row);
        }
    }

    function svgElement(tag, attributes = {}) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, String(value));
        });
        return element;
    }

    function setChartMessage(container, message) {
        if (!container) return;
        container.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'admin-chart__empty';
        empty.textContent = message;
        container.append(empty);
    }

    function addChartAction(element, detailFactory, item) {
        const detail = detailFactory(item);
        element.setAttribute('tabindex', '0');
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', detail);
        const title = svgElement('title');
        title.textContent = detail;
        element.append(title);
        const activate = () => setStatus(detail, 'info');
        element.addEventListener('click', activate);
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                activate();
            }
        });
    }

    function renderLineChart(container, items, options) {
        if (!container) return;
        container.textContent = '';
        if (!items.length) {
            setChartMessage(container, options.emptyText);
            return;
        }
        const width = 360;
        const height = 160;
        const padding = { top: 16, right: 16, bottom: 28, left: 34 };
        const values = items.map((item) => Math.max(0, Number(options.value(item)) || 0));
        const max = Math.max(1, ...values);
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;
        const points = values.map((value, index) => {
            const x = padding.left + (items.length === 1 ? innerWidth / 2 : (index / (items.length - 1)) * innerWidth);
            const y = padding.top + innerHeight - (value / max) * innerHeight;
            return { x, y, value, item: items[index] };
        });

        const svg = svgElement('svg', {
            class: 'admin-chart__svg',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'none'
        });
        [0, 0.5, 1].forEach((ratio) => {
            const y = padding.top + ratio * innerHeight;
            svg.append(svgElement('line', {
                class: 'admin-chart__grid',
                x1: padding.left,
                x2: width - padding.right,
                y1: y,
                y2: y
            }));
        });
        if (points.length > 1) {
            const area = svgElement('polygon', {
                class: 'admin-chart__area',
                points: [
                    `${padding.left},${height - padding.bottom}`,
                    ...points.map((point) => `${point.x},${point.y}`),
                    `${width - padding.right},${height - padding.bottom}`
                ].join(' ')
            });
            svg.append(area);
            svg.append(svgElement('polyline', {
                class: 'admin-chart__line',
                points: points.map((point) => `${point.x},${point.y}`).join(' ')
            }));
        }
        points.forEach((point) => {
            const circle = svgElement('circle', {
                class: 'admin-chart__point',
                cx: point.x,
                cy: point.y,
                r: 4.5
            });
            addChartAction(circle, options.detail, point.item);
            svg.append(circle);
        });
        container.append(svg);
    }

    function renderColumnChart(container, items, options) {
        if (!container) return;
        container.textContent = '';
        if (!items.length) {
            setChartMessage(container, options.emptyText);
            return;
        }
        const width = 360;
        const height = 160;
        const padding = { top: 18, right: 16, bottom: 28, left: 24 };
        const values = items.map((item) => Math.max(0, Number(options.value(item)) || 0));
        const max = Math.max(1, ...values);
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;
        const gap = 5;
        const barWidth = Math.max(6, (innerWidth - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length));
        const svg = svgElement('svg', {
            class: 'admin-chart__svg',
            viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'none'
        });
        values.forEach((value, index) => {
            const barHeight = Math.max(2, (value / max) * innerHeight);
            const x = padding.left + index * (barWidth + gap);
            const y = padding.top + innerHeight - barHeight;
            const bar = svgElement('rect', {
                class: 'admin-chart__bar',
                x,
                y,
                width: barWidth,
                height: barHeight,
                rx: 4
            });
            addChartAction(bar, options.detail, items[index]);
            svg.append(bar);
        });
        container.append(svg);
    }

    function renderSegmentChart(container, items, options) {
        if (!container) return;
        container.textContent = '';
        if (!items.length) {
            setChartMessage(container, options.emptyText);
            return;
        }
        const values = items.map((item) => Math.max(0, Number(options.value(item)) || 0));
        const total = values.reduce((sum, value) => sum + value, 0);
        if (!total) {
            setChartMessage(container, options.emptyText);
            return;
        }
        const track = document.createElement('div');
        track.className = 'segment-chart';
        items.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `segment-chart__item segment-chart__item--${index % 6}`;
            button.style.flexGrow = Math.max(1, values[index]);
            button.title = options.detail(item);
            button.setAttribute('aria-label', options.detail(item));
            button.addEventListener('click', () => setStatus(options.detail(item), 'info'));
            track.append(button);
        });
        const legend = document.createElement('div');
        legend.className = 'segment-chart__legend';
        items.forEach((item, index) => {
            const entry = document.createElement('button');
            entry.type = 'button';
            entry.className = 'segment-chart__legend-item';
            entry.textContent = `${options.label(item)} ${Math.round((values[index] / total) * 100)}%`;
            entry.addEventListener('click', () => setStatus(options.detail(item), 'info'));
            legend.append(entry);
        });
        container.append(track, legend);
    }

    function closeConfirm(value) {
        if (!state.confirmResolver) return;
        const resolve = state.confirmResolver;
        state.confirmResolver = null;
        nodes.confirmDialog.hidden = true;
        resolve(value);
    }

    function confirmAction(options) {
        if (state.confirmResolver) {
            state.confirmResolver(false);
            state.confirmResolver = null;
        }
        nodes.confirmTitle.textContent = options.title || 'Confirm action';
        nodes.confirmMessage.textContent = options.message || '';
        nodes.confirmSubmit.textContent = options.confirmText || 'Confirm';
        nodes.confirmSubmit.classList.toggle('delete-button', options.kind !== 'normal');
        nodes.confirmDialog.hidden = false;
        nodes.confirmCancel.focus();
        return new Promise((resolve) => {
            state.confirmResolver = resolve;
        });
    }

    async function withButtonBusy(button, label, action) {
        const previous = button.textContent;
        button.disabled = true;
        button.textContent = label;
        try {
            return await action();
        } finally {
            button.textContent = previous;
            button.disabled = false;
        }
    }

    function updatePagination() {
        nodes.usersRange.textContent = rangeLabel(state.users.offset, state.users.limit, state.users.total);
        nodes.usersPrev.disabled = state.users.loading || state.users.offset <= 0;
        nodes.usersNext.disabled = state.users.loading || state.users.offset + state.users.limit >= state.users.total;

        nodes.recordsRange.textContent = rangeLabel(state.records.offset, state.records.limit, state.records.total);
        nodes.recordsPrev.disabled = state.records.loading || state.records.offset <= 0 || !state.selectedUser;
        nodes.recordsNext.disabled = state.records.loading || state.records.offset + state.records.limit >= state.records.total || !state.selectedUser;
    }

    function storeCsrfTokenFromPayload(payload) {
        if (payload && typeof payload.csrfToken === 'string' && payload.csrfToken) {
            state.csrfToken = payload.csrfToken;
            return true;
        }
        return false;
    }

    function formatRequestError(response, payload) {
        if (payload && typeof payload.error === 'string' && payload.error) {
            return sanitizeStatusMessage(`${payload.error} (${response.status})`);
        }
        return sanitizeStatusMessage(`Request failed with ${response.status}`);
    }

    function parseAdminResponseJson(text) {
        if (typeof text !== 'string' || !text) {
            return null;
        }
        if (text.length > MAX_ADMIN_RESPONSE_JSON_LENGTH) {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch (_) {
            return null;
        }
    }

    async function request(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        const requiresCsrf = options.csrf !== false && options.method && options.method !== 'GET';
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (requiresCsrf) {
            if (typeof state.csrfToken !== 'string' || !state.csrfToken) {
                throw new Error('CSRF token is unavailable');
            }
            headers['X-CSRF-Token'] = state.csrfToken;
        }
        const response = await fetch(path, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        const payload = parseAdminResponseJson(text);
        if (response.status === 401) {
            state.csrfToken = '';
            window.location.href = '/';
            return null;
        }
        if (response.status === 403 && payload && payload.error === 'CSRF token invalid') {
            state.csrfToken = '';
        }
        if (!response.ok) {
            throw new Error(formatRequestError(response, payload));
        }
        storeCsrfTokenFromPayload(payload);
        return payload;
    }

    async function loadAuth() {
        const payload = await request('/api/auth/me', { csrf: false });
        if (!payload || !payload.user || payload.user.role !== 'admin') {
            document.body.innerHTML = '<main class="admin-layout"><section class="admin-panel"><h2>Admin access required</h2></section></main>';
            return false;
        }
        state.currentUserId = payload.user.id;
        storeCsrfTokenFromPayload(payload);
        return true;
    }

    async function loadSummary() {
        const summary = await request('/api/admin/summary', { csrf: false });
        nodes.summaryUsers.textContent = formatNumber(summary.userCount);
        nodes.summaryAdmins.textContent = formatNumber(summary.adminCount);
        nodes.summaryRecords.textContent = formatNumber(summary.practiceRecordCount);
        nodes.summaryActiveUsers.textContent = formatNumber(summary.activeUserCount);
        nodes.summaryAvgScore.textContent = formatScoreValue(summary.averageScore);
        nodes.summaryStudyTime.textContent = formatNumber(summary.totalStudyMinutes);
        nodes.summaryPageviews.textContent = formatNumber(summary.traffic && summary.traffic.totalPageViews);
        nodes.summaryRequestsToday.textContent = formatNumber(summary.traffic && summary.traffic.requestsToday);
        nodes.summaryLatest.textContent = `Latest record: ${formatDate(summary.latestRecordAt)}`;
    }

    async function loadGlobalStats() {
        const stats = await request('/api/admin/stats', { csrf: false });
        renderTypeStats(nodes.globalTypeStats, stats.byType || [], 'No learning records yet.');
    }

    async function loadAnalytics() {
        const days = state.analyticsDays;
        nodes.analyticsWindow.textContent = `Last ${days} days`;
        setListMessage(nodes.analyticsLearningTrend, 'Loading...');
        setListMessage(nodes.analyticsUserGrowth, 'Loading...');
        setListMessage(nodes.analyticsTopUsers, 'Loading...');
        setListMessage(nodes.analyticsScoreBuckets, 'Loading...');
        const analytics = await request(`/api/admin/analytics?days=${days}&limit=10`, { csrf: false });
        nodes.analyticsWindow.textContent = `Last ${analytics.days} days`;
        renderLineChart(nodes.analyticsLearningChart, analytics.dailyLearning || [], {
            emptyText: 'No practice activity in this range.',
            value: (item) => Number(item.records || 0),
            detail: (item) => `${item.day}: ${formatNumber(item.records)} records, ${formatNumber(item.activeUsers)} active users, average ${formatScoreValue(item.averageScore)}`
        });
        renderColumnChart(nodes.analyticsUserGrowthChart, analytics.userGrowth || [], {
            emptyText: 'No new users in this range.',
            value: (item) => Number(item.users || 0),
            detail: (item) => `${item.day}: ${formatNumber(item.users)} new users, ${formatNumber(item.admins)} admins`
        });
        renderSegmentChart(nodes.analyticsScoreChart, analytics.scoreBuckets || [], {
            emptyText: 'No scored records in this range.',
            label: (item) => item.bucket,
            value: (item) => Number(item.records || 0),
            detail: (item) => `${item.bucket}: ${formatNumber(item.records)} scored records`
        });
        renderBarRows(nodes.analyticsLearningTrend, analytics.dailyLearning || [], {
            emptyText: 'No practice activity in this range.',
            label: (item) => item.day,
            value: (item) => Number(item.records || 0),
            meta: (item) => `${formatNumber(item.records)} records - ${formatNumber(item.activeUsers)} users - ${formatScoreValue(item.averageScore)}`
        });
        renderBarRows(nodes.analyticsUserGrowth, analytics.userGrowth || [], {
            emptyText: 'No new users in this range.',
            label: (item) => item.day,
            value: (item) => Number(item.users || 0),
            meta: (item) => `${formatNumber(item.users)} users - ${formatNumber(item.admins)} admins`
        });
        renderBarRows(nodes.analyticsTopUsers, analytics.topUsers || [], {
            emptyText: 'No active learners in this range.',
            label: (item) => item.username,
            value: (item) => Number(item.recordCount || 0),
            meta: (item) => `${formatNumber(item.recordCount)} records - ${formatScoreValue(item.averageScore)} - ${formatNumber(item.totalStudyMinutes)} min`
        });
        renderBarRows(nodes.analyticsScoreBuckets, analytics.scoreBuckets || [], {
            emptyText: 'No scored records in this range.',
            label: (item) => item.bucket,
            value: (item) => Number(item.records || 0),
            meta: (item) => `${formatNumber(item.records)} records`
        });
    }

    function renderUsers(payload) {
        nodes.usersBody.textContent = '';
        state.users.total = Number(payload.total || 0);
        updatePagination();
        if (!payload.users.length) {
            setRowMessage(nodes.usersBody, 5, 'No users');
            return;
        }

        for (const user of payload.users) {
            const row = document.createElement('tr');
            row.className = 'user-row';
            row.tabIndex = 0;
            row.dataset.userId = user.id;
            row.classList.toggle('is-selected', state.selectedUser && user.id === state.selectedUser.id);

            const username = document.createElement('td');
            username.textContent = user.username;
            const role = document.createElement('td');
            const pill = document.createElement('span');
            pill.className = `role-pill${user.role === 'admin' ? ' is-admin' : ''}`;
            pill.textContent = user.role;
            role.append(pill);
            const count = document.createElement('td');
            count.textContent = formatNumber(user.recordCount);
            const average = document.createElement('td');
            average.textContent = formatScoreValue(user.averageScore);
            const latest = document.createElement('td');
            latest.textContent = formatDate(user.latestRecordAt);
            row.append(username, role, count, average, latest);

            const select = () => {
                selectUser(user).catch((error) => setStatus(error.message, 'error'));
            };
            row.addEventListener('click', select);
            row.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    select();
                }
            });
            nodes.usersBody.append(row);
        }
    }

    async function loadUsers() {
        const requestId = state.users.requestId + 1;
        state.users.requestId = requestId;
        state.users.loading = true;
        updatePagination();
        setRowMessage(nodes.usersBody, 5, 'Loading users...');
        try {
            const query = new URLSearchParams({
                q: nodes.userSearch.value.trim(),
                role: state.users.role,
                limit: String(state.users.limit),
                offset: String(state.users.offset)
            });
            const payload = await request(`/api/admin/users?${query}`, { csrf: false });
            if (state.users.requestId !== requestId) {
                return;
            }
            renderUsers(payload);
            const selectedStillVisible = state.selectedUser && payload.users.some((user) => user.id === state.selectedUser.id);
            if ((!state.selectedUser || !selectedStillVisible) && payload.users[0]) {
                await selectUser(payload.users[0], { resetRecords: true });
            }
            if (!payload.users.length) {
                clearUserSelection();
            }
        } finally {
            if (state.users.requestId === requestId) {
                state.users.loading = false;
                updatePagination();
            }
        }
    }

    function renderTypeStats(container, items, emptyText) {
        container.textContent = '';
        if (!items.length) {
            container.textContent = emptyText;
            return;
        }
        for (const item of items) {
            const row = document.createElement('div');
            row.className = 'mini-list__row';
            const name = document.createElement('strong');
            name.textContent = item.type || 'unknown';
            const meta = document.createElement('span');
            meta.textContent = `${formatNumber(item.recordCount)} records - ${formatScoreValue(item.averageScore)} - ${formatNumber(item.totalStudyMinutes)} min`;
            row.append(name, meta);
            container.append(row);
        }
    }

    function isSelectedUser(userId) {
        return Boolean(state.selectedUser && state.selectedUser.id === userId);
    }

    async function loadUserStats(userId) {
        if (!userId) return;
        const requestId = state.userStatsRequestId + 1;
        state.userStatsRequestId = requestId;
        const stats = await request(`/api/admin/users/${encodeURIComponent(userId)}/stats`, { csrf: false });
        if (state.userStatsRequestId !== requestId || !isSelectedUser(userId)) {
            return;
        }
        nodes.userStatsTitle.textContent = stats.user.username;
        nodes.userStatRecords.textContent = formatNumber(stats.recordCount);
        nodes.userStatAverage.textContent = formatScoreValue(stats.averageScore);
        nodes.userStatDuration.textContent = formatNumber(stats.totalStudyMinutes);
        nodes.userStatLatest.textContent = formatDate(stats.latestRecordAt);
        renderTypeStats(nodes.userTypeStats, stats.byType || [], 'This user has no practice records.');
    }

    function updateSelectedUserPanel() {
        const user = state.selectedUser;
        const disabled = !user;
        nodes.selectedUserName.textContent = user ? `${user.username} - ${user.id}` : 'No user selected';
        nodes.selectedUserRole.disabled = disabled;
        nodes.selectedUserPassword.disabled = disabled;
        nodes.saveUserButton.disabled = disabled;
        nodes.deleteUserButton.disabled = disabled || (user && user.id === state.currentUserId);
        nodes.selectedUserRole.value = user ? user.role : 'user';
        nodes.selectedUserPassword.value = '';
    }

    function renderRecordDetails(record) {
        state.selectedRecord = record || null;
        if (!record) {
            nodes.recordDetailTitle.textContent = 'Record Detail';
            nodes.recordDetailBody.textContent = 'Select a record to inspect its stored payload.';
            return;
        }
        nodes.recordDetailTitle.textContent = record.title || record.examId || record.id;
        const fields = [
            ['Record ID', record.id],
            ['Session ID', record.sessionId || '-'],
            ['Exam ID', record.examId || '-'],
            ['Type', record.type || '-'],
            ['Score', formatScore(record)],
            ['Updated', formatDate(record.updatedAt)]
        ];
        const summary = document.createElement('dl');
        summary.className = 'record-detail-list';
        for (const [label, value] of fields) {
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            summary.append(term, description);
        }
        const payload = document.createElement('pre');
        payload.textContent = safeStringifyRecordPayload(record.payload || {});
        nodes.recordDetailBody.textContent = '';
        nodes.recordDetailBody.append(summary, payload);
    }

    function renderRecords(payload, username) {
        nodes.recordsBody.textContent = '';
        state.records.total = Number(payload.total || 0);
        nodes.recordsTitle.textContent = username ? `${username} Records` : 'Practice Records';
        updatePagination();

        if (!payload.records.length) {
            setRowMessage(nodes.recordsBody, 5, 'No records');
            renderRecordDetails(null);
            return;
        }

        for (const record of payload.records) {
            const row = document.createElement('tr');
            row.classList.toggle('is-selected', state.selectedRecord && state.selectedRecord.id === record.id);
            const title = document.createElement('td');
            title.textContent = record.title || record.examId || record.id;
            const type = document.createElement('td');
            type.textContent = record.type || '-';
            const score = document.createElement('td');
            score.textContent = formatScore(record);
            const updated = document.createElement('td');
            updated.textContent = formatDate(record.updatedAt);
            const action = document.createElement('td');
            action.className = 'record-actions';
            const details = document.createElement('button');
            details.type = 'button';
            details.textContent = 'Details';
            details.addEventListener('click', () => {
                renderRecordDetails(record);
                Array.from(nodes.recordsBody.querySelectorAll('tr')).forEach((item) => item.classList.remove('is-selected'));
                row.classList.add('is-selected');
            });
            const remove = document.createElement('button');
            remove.className = 'delete-button';
            remove.type = 'button';
            remove.textContent = 'Delete';
            remove.addEventListener('click', async () => {
                const selectedUser = state.selectedUser;
                if (!selectedUser) {
                    return;
                }
                const userId = selectedUser.id;
                const username = selectedUser.username;
                const label = record.title || record.examId || record.id;
                const confirmed = await confirmAction({
                    title: 'Delete practice record',
                    message: `Delete "${label}" updated ${formatDate(record.updatedAt)}? This cannot be undone.`,
                    confirmText: 'Delete record'
                });
                if (!confirmed) {
                    return;
                }
                await withButtonBusy(remove, 'Deleting...', async () => {
                    await request(`/api/admin/users/${encodeURIComponent(userId)}/practice-records/${encodeURIComponent(record.id)}`, {
                        method: 'DELETE'
                    });
                    setStatus('Record deleted');
                    if (state.selectedUser && state.selectedUser.id === userId && state.records.offset >= state.records.total - 1 && state.records.offset > 0) {
                        state.records.offset = Math.max(0, state.records.offset - state.records.limit);
                    }
                    await refreshAfterMutation();
                    if (state.selectedUser && state.selectedUser.id === userId) {
                        await loadRecords(userId, username);
                    }
                }).catch((error) => setStatus(error.message, 'error'));
            });
            action.append(details, remove);
            row.append(title, type, score, updated, action);
            nodes.recordsBody.append(row);
        }
    }

    async function loadRecords(userId, username) {
        if (!userId) return;
        const requestId = state.records.requestId + 1;
        state.records.requestId = requestId;
        state.records.loading = true;
        updatePagination();
        setRowMessage(nodes.recordsBody, 5, 'Loading records...');
        try {
            const payload = await request(`/api/admin/users/${encodeURIComponent(userId)}/practice-records?limit=${state.records.limit}&offset=${state.records.offset}`, { csrf: false });
            if (state.records.requestId !== requestId || !isSelectedUser(userId)) {
                return;
            }
            renderRecords(payload, username);
        } finally {
            if (state.records.requestId === requestId) {
                state.records.loading = false;
                updatePagination();
            }
        }
    }

    async function selectUser(user, options = {}) {
        state.selectedUser = user;
        if (options.resetRecords !== false) {
            state.records.offset = 0;
        }
        updateSelectedUserPanel();
        renderRecordDetails(null);
        await Promise.all([
            loadUserStats(user.id),
            loadRecords(user.id, user.username)
        ]);
        Array.from(nodes.usersBody.querySelectorAll('tr')).forEach((item) => {
            item.classList.toggle('is-selected', item.dataset.userId === user.id);
        });
    }

    function clearUserSelection() {
        state.selectedUser = null;
        state.records.offset = 0;
        state.records.total = 0;
        nodes.recordsTitle.textContent = 'Practice Records';
        nodes.userStatsTitle.textContent = 'Select a user';
        nodes.userStatRecords.textContent = '0';
        nodes.userStatAverage.textContent = '-';
        nodes.userStatDuration.textContent = '0';
        nodes.userStatLatest.textContent = '-';
        nodes.userTypeStats.textContent = 'No user selected.';
        setRowMessage(nodes.recordsBody, 5, 'Select a user');
        renderRecordDetails(null);
        updateSelectedUserPanel();
        updatePagination();
    }

    async function loadTraffic() {
        const days = state.trafficDays;
        nodes.trafficWindow.textContent = `Last ${days} days`;
        setListMessage(nodes.trafficDaily, 'Loading...');
        setListMessage(nodes.trafficPaths, 'Loading...');
        setListMessage(nodes.trafficRouteGroups, 'Loading...');
        setListMessage(nodes.trafficStatusCodes, 'Loading...');
        const traffic = await request(`/api/admin/traffic?days=${days}&limit=10`, { csrf: false });
        nodes.trafficWindow.textContent = `Last ${traffic.days} days`;
        nodes.trafficRequests.textContent = formatNumber(traffic.requests);
        nodes.trafficPageviews.textContent = formatNumber(traffic.pageViews);
        nodes.trafficVisitors.textContent = formatNumber(traffic.uniqueVisitors);
        nodes.trafficErrors.textContent = formatNumber(traffic.errors);
        renderLineChart(nodes.trafficDailyChart, traffic.daily || [], {
            emptyText: 'No traffic captured yet.',
            value: (item) => Number(item.requests || 0),
            detail: (item) => `${item.day}: ${formatNumber(item.requests)} requests, ${formatNumber(item.pageViews)} page views, ${formatNumber(item.errors)} errors`
        });
        renderSegmentChart(nodes.trafficRouteChart, traffic.routeGroups || [], {
            emptyText: 'No route groups captured yet.',
            label: (item) => item.group,
            value: (item) => Number(item.requests || 0),
            detail: (item) => `${item.group}: ${formatNumber(item.requests)} requests, ${formatNumber(item.errors)} errors, ${formatNumber(item.averageDurationMs)} ms avg`
        });
        renderSegmentChart(nodes.trafficStatusChart, traffic.statusCodes || [], {
            emptyText: 'No status codes captured yet.',
            label: (item) => item.statusClass,
            value: (item) => Number(item.requests || 0),
            detail: (item) => `${item.statusClass}: ${formatNumber(item.requests)} requests`
        });
        renderBarRows(nodes.trafficDaily, traffic.daily || [], {
            emptyText: 'No traffic captured yet.',
            label: (item) => item.day,
            value: (item) => Number(item.requests || 0),
            meta: (item) => `${formatNumber(item.requests)} req - ${formatNumber(item.pageViews)} views - ${formatNumber(item.errors)} errors`
        });
        renderBarRows(nodes.trafficPaths, traffic.topPaths || [], {
            emptyText: 'No paths captured yet.',
            label: (item) => item.path,
            value: (item) => Number(item.requests || 0),
            meta: (item) => `${item.routeGroup} - ${formatNumber(item.requests)} requests - ${formatNumber(item.uniqueVisitors)} visitors`
        });
        renderBarRows(nodes.trafficRouteGroups, traffic.routeGroups || [], {
            emptyText: 'No route groups captured yet.',
            label: (item) => item.group,
            value: (item) => Number(item.requests || 0),
            meta: (item) => `${formatNumber(item.requests)} requests - ${formatNumber(item.errors)} errors - ${formatNumber(item.averageDurationMs)} ms avg`
        });
        renderBarRows(nodes.trafficStatusCodes, traffic.statusCodes || [], {
            emptyText: 'No status codes captured yet.',
            label: (item) => item.statusClass,
            value: (item) => Number(item.requests || 0),
            meta: (item) => `${formatNumber(item.requests)} requests`
        });
    }

    async function refreshAfterMutation() {
        await Promise.all([
            loadSummary(),
            loadGlobalStats(),
            loadAnalytics(),
            loadTraffic()
        ]);
        if (state.selectedUser) {
            await loadUserStats(state.selectedUser.id);
        }
    }

    async function refreshAll() {
        await Promise.all([
            loadSummary(),
            loadGlobalStats(),
            loadAnalytics(),
            loadTraffic()
        ]);
        await loadUsers();
        if (state.selectedUser) {
            await Promise.all([
                loadUserStats(state.selectedUser.id),
                loadRecords(state.selectedUser.id, state.selectedUser.username)
            ]);
        }
    }

    function bindEvents() {
        nodes.refreshButton.addEventListener('click', () => {
            withButtonBusy(nodes.refreshButton, 'Refreshing...', refreshAll).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.userSearch.addEventListener('input', () => {
            window.clearTimeout(nodes.userSearch._timer);
            nodes.userSearch._timer = window.setTimeout(() => {
                state.users.offset = 0;
                clearUserSelection();
                loadUsers().catch((error) => setStatus(error.message, 'error'));
            }, 200);
        });
        nodes.userRoleFilter.addEventListener('change', () => {
            state.users.role = nodes.userRoleFilter.value;
            state.users.offset = 0;
            clearUserSelection();
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.analyticsRange.addEventListener('change', () => {
            state.analyticsDays = Number(nodes.analyticsRange.value) || 30;
            loadAnalytics().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.trafficRange.addEventListener('change', () => {
            state.trafficDays = Number(nodes.trafficRange.value) || 14;
            loadTraffic().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.usersPrev.addEventListener('click', () => {
            state.users.offset = Math.max(0, state.users.offset - state.users.limit);
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.usersNext.addEventListener('click', () => {
            state.users.offset += state.users.limit;
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.recordsPrev.addEventListener('click', () => {
            if (!state.selectedUser) return;
            const selectedUser = state.selectedUser;
            state.records.offset = Math.max(0, state.records.offset - state.records.limit);
            loadRecords(selectedUser.id, selectedUser.username).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.recordsNext.addEventListener('click', () => {
            if (!state.selectedUser) return;
            const selectedUser = state.selectedUser;
            state.records.offset += state.records.limit;
            loadRecords(selectedUser.id, selectedUser.username).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.createUserForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const body = {
                username: nodes.createUsername.value.trim(),
                password: nodes.createPassword.value,
                role: nodes.createRole.value
            };
            try {
                await withButtonBusy(nodes.createUserSubmit, 'Creating...', async () => {
                    const payload = await request('/api/admin/users', { method: 'POST', body });
                    nodes.createUserForm.reset();
                    setStatus(`Created ${payload.user.username}`);
                    state.users.offset = 0;
                    await refreshAll();
                });
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
        nodes.editUserForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const selectedUser = state.selectedUser;
            if (!selectedUser) return;
            const userId = selectedUser.id;
            const body = {
                role: nodes.selectedUserRole.value
            };
            if (nodes.selectedUserPassword.value.trim()) {
                body.password = nodes.selectedUserPassword.value;
            }
            try {
                await withButtonBusy(nodes.saveUserButton, 'Saving...', async () => {
                    const payload = await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
                        method: 'PATCH',
                        body
                    });
                    if (isSelectedUser(userId)) {
                        state.selectedUser = payload.user;
                        nodes.selectedUserPassword.value = '';
                        updateSelectedUserPanel();
                    }
                    setStatus(`Updated ${payload.user.username}`);
                    await refreshAll();
                });
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
        nodes.deleteUserButton.addEventListener('click', async () => {
            if (!state.selectedUser) return;
            const username = state.selectedUser.username;
            const userId = state.selectedUser.id;
            const confirmed = await confirmAction({
                title: 'Delete user',
                message: `Delete "${username}" and all related practice records? This cannot be undone.`,
                confirmText: 'Delete user'
            });
            if (!confirmed) {
                return;
            }
            try {
                await withButtonBusy(nodes.deleteUserButton, 'Deleting...', async () => {
                    await request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
                    setStatus(`Deleted ${username}`);
                    clearUserSelection();
                    await refreshAll();
                });
                updateSelectedUserPanel();
                updatePagination();
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
        nodes.confirmCancel.addEventListener('click', () => closeConfirm(false));
        nodes.confirmSubmit.addEventListener('click', () => closeConfirm(true));
        nodes.confirmDialog.addEventListener('click', (event) => {
            if (event.target === nodes.confirmDialog) {
                closeConfirm(false);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !nodes.confirmDialog.hidden) {
                closeConfirm(false);
            }
        });
        nodes.logoutButton.addEventListener('click', async () => {
            nodes.logoutButton.disabled = true;
            try {
                await request('/api/auth/logout', { method: 'POST' });
                window.location.href = '/';
            } catch (error) {
                nodes.logoutButton.disabled = false;
                setStatus(error.message, 'error');
            }
        });
    }

    async function boot() {
        bindEvents();
        clearUserSelection();
        const ok = await loadAuth();
        if (!ok) return;
        await refreshAll();
    }

    if (window.__IELTS_ADMIN_TEST__) {
        window.__IELTS_ADMIN_TEST_HOOKS__ = {
            formatNumber,
            formatScoreValue,
            formatScore,
            sanitizeStatusMessage,
            safeStringifyRecordPayload,
            parseAdminResponseJson,
            request,
            loadAuth,
            loadRecords,
            loadUserStats,
            confirmAction,
            closeConfirm,
            state
        };
    } else {
        boot().catch((error) => setStatus(error.message, 'error'));
    }
})();
