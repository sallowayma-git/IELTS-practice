(function() {
    const MAX_ADMIN_STATUS_CHARS = 240;
    const MAX_ADMIN_RESPONSE_JSON_LENGTH = 1024 * 1024;
    const ADMIN_STATUS_AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]+/gi;
    const ADMIN_STATUS_SECRET_VALUE_PATTERN = /\b((?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?)\s*[:=]\s*([^&\s"'<>]+)/gi;
    const ADMIN_STATUS_SECRET_QUERY_PATTERN = /([?&](?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?=)[^&\s"'<>]+/gi;
    const RECORD_LIMIT = 100;
    const ACCOUNT_REFRESH_INTERVAL_MS = 30 * 1000;

    const state = {
        csrfToken: '',
        userId: new URLSearchParams(window.location.search).get('userId') || '',
        loading: false
    };

    const nodes = {
        status: document.getElementById('status'),
        refreshButton: document.getElementById('refresh-button'),
        logoutButton: document.getElementById('logout-button'),
        accountTitle: document.getElementById('account-title'),
        profileAvatar: document.getElementById('profile-avatar'),
        profileUsername: document.getElementById('profile-username'),
        profileRole: document.getElementById('profile-role'),
        profileId: document.getElementById('profile-id'),
        profileCreated: document.getElementById('profile-created'),
        profileUpdated: document.getElementById('profile-updated'),
        metricRecords: document.getElementById('metric-records'),
        metricScore: document.getElementById('metric-score'),
        metricAccuracy: document.getElementById('metric-accuracy'),
        metricDuration: document.getElementById('metric-duration'),
        recordsRange: document.getElementById('records-range'),
        recordsBody: document.getElementById('records-body')
    };

    function truncateAdminText(value, maxLength, suffix = '') {
        const text = String(value ?? '');
        if (text.length <= maxLength) {
            return text;
        }
        const suffixText = String(suffix || '');
        const bodyLength = Math.max(0, maxLength - suffixText.length);
        let truncated = text.slice(0, bodyLength);
        if (/[\uD800-\uDBFF]$/.test(truncated)) {
            truncated = truncated.slice(0, -1);
        }
        return `${truncated}${suffixText}`;
    }

    function sanitizeStatusMessage(value, fallback = '') {
        const text = String(value ?? fallback)
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(ADMIN_STATUS_SECRET_QUERY_PATTERN, '$1[redacted]')
            .replace(ADMIN_STATUS_SECRET_VALUE_PATTERN, '$1=[redacted]')
            .replace(ADMIN_STATUS_AUTH_HEADER_PATTERN, '$1 [redacted]')
            .replace(/\s+/g, ' ')
            .trim();
        const normalized = text || fallback;
        return truncateAdminText(normalized, MAX_ADMIN_STATUS_CHARS, '...');
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

    async function request(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        const method = options.method || 'GET';
        const requiresCsrf = options.csrf !== false && method !== 'GET';
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (requiresCsrf) {
            if (!state.csrfToken) {
                throw new Error('CSRF token unavailable');
            }
            headers['X-CSRF-Token'] = state.csrfToken;
        }
        const response = await fetch(path, {
            method,
            headers,
            credentials: 'same-origin',
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        const payload = parseAdminResponseJson(text);
        storeCsrfTokenFromPayload(payload);
        if (response.status === 401 || response.status === 403) {
            window.location.href = '/admin/login';
            throw new Error('Admin session expired');
        }
        if (!response.ok) {
            throw new Error(formatRequestError(response, payload));
        }
        return payload || {};
    }

    async function loadAuth() {
        const response = await fetch('/api/auth/me', {
            credentials: 'same-origin'
        });
        const text = await response.text();
        const payload = parseAdminResponseJson(text);
        storeCsrfTokenFromPayload(payload);
        if (!response.ok || !payload || !payload.user || payload.user.role !== 'admin') {
            window.location.href = '/admin/login';
            return false;
        }
        return true;
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(Number(date))) return '-';
        return date.toLocaleString();
    }

    function formatNumber(value, digits = 0) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '-';
        return new Intl.NumberFormat(undefined, {
            maximumFractionDigits: digits
        }).format(number);
    }

    function formatPercent(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '-';
        return `${formatNumber(number, 1)}%`;
    }

    function calculateAccuracy(correctAnswers, totalQuestions, score = null) {
        const correct = Number(correctAnswers);
        const total = Number(totalQuestions);
        if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
            return (correct / total) * 100;
        }
        const scoreValue = Number(score);
        return Number.isFinite(scoreValue) ? scoreValue : null;
    }

    function formatDuration(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0) return '-';
        return `${formatNumber(number, 1)} min`;
    }

    function formatRecordTitle(record) {
        return record.title || record.payload?.title || record.examId || record.id || 'Untitled practice';
    }

    function renderUser(stats) {
        const user = stats.user || {};
        const username = user.username || 'Unknown user';
        const accuracy = calculateAccuracy(stats.correctAnswers, stats.totalQuestions, stats.averageScore);
        nodes.accountTitle.textContent = `${username} account`;
        nodes.profileAvatar.textContent = username.trim().charAt(0).toUpperCase() || '?';
        nodes.profileUsername.textContent = username;
        nodes.profileRole.textContent = user.role === 'admin' ? 'Admin' : 'User';
        nodes.profileId.textContent = user.id ? `ID ${user.id}` : 'ID -';
        nodes.profileCreated.textContent = `Created ${formatDate(user.createdAt)}`;
        nodes.profileUpdated.textContent = `Updated ${formatDate(user.updatedAt)}`;
        nodes.metricRecords.textContent = formatNumber(stats.recordCount);
        nodes.metricScore.textContent = stats.averageScore === null ? '-' : formatNumber(stats.averageScore, 1);
        nodes.metricAccuracy.textContent = formatPercent(accuracy);
        nodes.metricDuration.textContent = formatDuration(stats.totalStudyMinutes);
    }

    function setRecordsMessage(message) {
        nodes.recordsBody.textContent = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'empty-cell';
        cell.textContent = message;
        row.append(cell);
        nodes.recordsBody.append(row);
    }

    function renderRecords(payload) {
        const records = Array.isArray(payload.records) ? payload.records : [];
        const total = Number(payload.total || records.length || 0);
        nodes.recordsRange.textContent = `${formatNumber(total)} ${total === 1 ? 'record' : 'records'}`;
        nodes.recordsBody.textContent = '';
        if (!records.length) {
            setRecordsMessage('No completed practice records yet.');
            return;
        }
        for (const record of records) {
            const row = document.createElement('tr');
            const title = document.createElement('td');
            const titleText = document.createElement('strong');
            titleText.textContent = formatRecordTitle(record);
            const recordId = document.createElement('span');
            recordId.textContent = record.id ? `Record ${record.id}` : 'Record -';
            title.append(titleText, recordId);

            const type = document.createElement('td');
            type.textContent = record.type || record.payload?.type || '-';
            const score = document.createElement('td');
            score.textContent = record.score === null || record.score === undefined ? '-' : formatNumber(record.score, 1);
            const accuracy = document.createElement('td');
            accuracy.textContent = formatPercent(calculateAccuracy(record.correctAnswers, record.totalQuestions, record.score));
            const duration = document.createElement('td');
            duration.textContent = formatDuration(record.duration);
            const updated = document.createElement('td');
            updated.textContent = formatDate(record.updatedAt || record.createdAt);
            row.append(title, type, score, accuracy, duration, updated);
            nodes.recordsBody.append(row);
        }
    }

    async function loadAccount() {
        if (!state.userId) {
            setRecordsMessage('Select a user from the admin user list first.');
            nodes.profileUsername.textContent = 'No user selected';
            setStatus('Missing user id', 'error');
            return;
        }
        state.loading = true;
        nodes.refreshButton.disabled = true;
        setRecordsMessage('Loading practice records...');
        try {
            const [stats, records] = await Promise.all([
                request(`/api/admin/users/${encodeURIComponent(state.userId)}/stats`, { csrf: false }),
                request(`/api/admin/users/${encodeURIComponent(state.userId)}/practice-records?limit=${RECORD_LIMIT}&offset=0`, { csrf: false })
            ]);
            renderUser(stats);
            renderRecords(records);
            setStatus('Account data refreshed');
        } catch (error) {
            setStatus(error.message || 'Failed to load account data', 'error');
        } finally {
            state.loading = false;
            nodes.refreshButton.disabled = false;
        }
    }

    async function logout() {
        try {
            await request('/api/auth/logout', {
                method: 'POST'
            });
        } finally {
            window.location.href = '/admin/login';
        }
    }

    async function init() {
        const authorized = await loadAuth();
        if (!authorized) return;
        nodes.refreshButton.addEventListener('click', () => {
            if (!state.loading) {
                loadAccount();
            }
        });
        window.setInterval(() => {
            if (!state.loading && document.visibilityState === 'visible') {
                loadAccount();
            }
        }, ACCOUNT_REFRESH_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
            if (!state.loading && document.visibilityState === 'visible') {
                loadAccount();
            }
        });
        nodes.logoutButton.addEventListener('click', () => {
            logout().catch((error) => setStatus(error.message, 'error'));
        });
        await loadAccount();
    }

    init().catch((error) => setStatus(error.message || 'Admin account failed to initialize', 'error'));
})();
