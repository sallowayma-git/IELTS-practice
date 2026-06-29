(function() {
    const MAX_ADMIN_STATUS_CHARS = 240;
    const MAX_ADMIN_RESPONSE_JSON_LENGTH = 1024 * 1024;
    const ADMIN_STATUS_AUTH_HEADER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]+/gi;
    const ADMIN_STATUS_SECRET_VALUE_PATTERN = /\b((?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?)\s*[:=]\s*([^&\s"'<>]+)/gi;
    const ADMIN_STATUS_SECRET_QUERY_PATTERN = /([?&](?:csrf|token|secret|password|recovery[_-]?code|totp)(?:[_-]?[A-Za-z0-9]*)?=)[^&\s"'<>]+/gi;

    const state = {
        csrfToken: '',
        currentUserId: '',
        selectedUser: null,
        users: {
            q: '',
            role: 'all',
            limit: 25,
            offset: 0,
            total: 0,
            loading: false,
            requestId: 0
        },
        dashboard: {
            loading: false
        },
        siteContent: {
            loading: false,
            content: null
        },
        confirmResolver: null
    };

    const nodes = {
        status: document.getElementById('status'),
        logoutButton: document.getElementById('logout-button'),
        refreshButton: document.getElementById('refresh-button'),
        newUserButton: document.getElementById('new-user-button'),
        userSearch: document.getElementById('user-search'),
        userRoleFilter: document.getElementById('user-role-filter'),
        usersBody: document.getElementById('users-body'),
        usersRange: document.getElementById('users-range'),
        usersPrev: document.getElementById('users-prev'),
        usersNext: document.getElementById('users-next'),
        selectedUserTitle: document.getElementById('selected-user-title'),
        selectedUserId: document.getElementById('selected-user-id'),
        selectedUserCreated: document.getElementById('selected-user-created'),
        selectedUserUpdated: document.getElementById('selected-user-updated'),
        openAccountCenter: document.getElementById('open-account-center'),
        editUserForm: document.getElementById('edit-user-form'),
        selectedUserRole: document.getElementById('selected-user-role'),
        selectedUserPassword: document.getElementById('selected-user-password'),
        saveUserButton: document.getElementById('save-user-button'),
        deleteUserButton: document.getElementById('delete-user-button'),
        userDialog: document.getElementById('user-dialog'),
        closeUserDialog: document.getElementById('close-user-dialog'),
        createUserForm: document.getElementById('create-user-form'),
        createUserSubmit: document.getElementById('create-user-submit'),
        createUsername: document.getElementById('create-username'),
        createPassword: document.getElementById('create-password'),
        createRole: document.getElementById('create-role'),
        metricRegisteredUsers: document.getElementById('metric-registered-users'),
        metricLoggedInUsers: document.getElementById('metric-logged-in-users'),
        metricLoginSuccesses: document.getElementById('metric-login-successes'),
        metricRegisterSuccesses: document.getElementById('metric-register-successes'),
        metricPracticeRecords: document.getElementById('metric-practice-records'),
        metricActiveUsers: document.getElementById('metric-active-users'),
        metricAverageScore: document.getElementById('metric-average-score'),
        metricStudyMinutes: document.getElementById('metric-study-minutes'),
        contentSaveButton: document.getElementById('content-save-button'),
        loginNoticeEnabled: document.getElementById('login-notice-enabled'),
        loginNoticeTitle: document.getElementById('login-notice-title'),
        loginNoticeBody: document.getElementById('login-notice-body'),
        loginNoticeCtaLabel: document.getElementById('login-notice-cta-label'),
        loginNoticeCtaHref: document.getElementById('login-notice-cta-href'),
        homeBannerEnabled: document.getElementById('home-banner-enabled'),
        homeBannerTitle: document.getElementById('home-banner-title'),
        homeBannerBody: document.getElementById('home-banner-body'),
        homeBannerCtaLabel: document.getElementById('home-banner-cta-label'),
        homeBannerCtaHref: document.getElementById('home-banner-cta-href'),
        exportButtons: Array.from(document.querySelectorAll('[data-export-dataset]')),
        confirmDialog: document.getElementById('confirm-dialog'),
        confirmTitle: document.getElementById('confirm-title'),
        confirmMessage: document.getElementById('confirm-message'),
        confirmCancel: document.getElementById('confirm-cancel'),
        confirmSubmit: document.getElementById('confirm-submit')
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

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(Number(date))) return '-';
        return date.toLocaleString();
    }

    function formatNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return '0';
        return new Intl.NumberFormat().format(number);
    }

    function formatMetric(value, fallback = '-') {
        if (value === null || value === undefined || value === '') return fallback;
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 1
        }).format(number);
    }

    function rangeLabel(offset, limit, total) {
        if (!total) return '0 of 0';
        const start = Math.min(total, offset + 1);
        const end = Math.min(total, offset + limit);
        return `${formatNumber(start)}-${formatNumber(end)} of ${formatNumber(total)}`;
    }

    function storeCsrfTokenFromPayload(payload) {
        if (payload && typeof payload.csrfToken === 'string' && payload.csrfToken) {
            state.csrfToken = payload.csrfToken;
            return true;
        }
        return false;
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
            window.location.href = '/auth/admin/start?return_to=/admin';
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
            window.location.href = '/auth/admin/start?return_to=/admin';
            return false;
        }
        state.currentUserId = payload.user.id;
        return true;
    }

    function updatePagination() {
        nodes.usersRange.textContent = rangeLabel(state.users.offset, state.users.limit, state.users.total);
        nodes.usersPrev.disabled = state.users.loading || state.users.offset <= 0;
        nodes.usersNext.disabled = state.users.loading || state.users.offset + state.users.limit >= state.users.total;
    }

    function setRowMessage(message) {
        nodes.usersBody.textContent = '';
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 4;
        cell.className = 'empty-cell';
        cell.textContent = message;
        row.append(cell);
        nodes.usersBody.append(row);
    }

    function rolePill(role) {
        const pill = document.createElement('span');
        pill.className = `role-pill${role === 'admin' ? ' is-admin' : ''}`;
        pill.textContent = role === 'admin' ? 'Admin' : 'User';
        return pill;
    }

    function renderUsers(payload) {
        nodes.usersBody.textContent = '';
        state.users.total = Number(payload.total || 0);
        updatePagination();

        if (!payload.users.length) {
            setRowMessage('No users');
            return;
        }

        for (const user of payload.users) {
            const row = document.createElement('tr');
            row.className = 'user-row';
            row.tabIndex = 0;
            row.dataset.userId = user.id;
            row.classList.toggle('is-selected', state.selectedUser && user.id === state.selectedUser.id);

            const username = document.createElement('td');
            const accountLink = document.createElement('a');
            accountLink.className = 'user-account-link';
            accountLink.href = `/admin/account?userId=${encodeURIComponent(user.id)}`;
            accountLink.textContent = user.username;
            accountLink.addEventListener('click', (event) => {
                event.stopPropagation();
            });
            username.append(accountLink);
            const role = document.createElement('td');
            role.append(rolePill(user.role));
            const created = document.createElement('td');
            created.textContent = formatDate(user.createdAt);
            const updated = document.createElement('td');
            updated.textContent = formatDate(user.updatedAt);
            row.append(username, role, created, updated);

            const select = () => selectUser(user);
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
        setRowMessage('Loading users...');
        try {
            const query = new URLSearchParams({
                q: state.users.q,
                role: state.users.role,
                limit: String(state.users.limit),
                offset: String(state.users.offset)
            });
            const payload = await request(`/api/admin/users?${query}`, { csrf: false });
            if (state.users.requestId !== requestId) {
                return;
            }
            renderUsers(payload);
            if (state.selectedUser && !payload.users.some((user) => user.id === state.selectedUser.id)) {
                clearSelection();
            }
        } finally {
            if (state.users.requestId === requestId) {
                state.users.loading = false;
                updatePagination();
            }
        }
    }

    function renderDashboard(summary) {
        const traffic = summary.traffic || {};
        nodes.metricRegisteredUsers.textContent = formatMetric(traffic.registeredUsers ?? summary.userCount);
        nodes.metricLoggedInUsers.textContent = formatMetric(traffic.loggedInUsers);
        nodes.metricLoginSuccesses.textContent = formatMetric(traffic.loginSuccesses);
        nodes.metricRegisterSuccesses.textContent = formatMetric(traffic.registerSuccesses);
        nodes.metricPracticeRecords.textContent = formatMetric(summary.practiceRecordCount);
        nodes.metricActiveUsers.textContent = formatMetric(summary.activeUserCount);
        nodes.metricAverageScore.textContent = summary.averageScore === null ? '-' : formatMetric(summary.averageScore);
        nodes.metricStudyMinutes.textContent = formatMetric(summary.totalStudyMinutes);
    }

    async function loadDashboard() {
        state.dashboard.loading = true;
        try {
            const summary = await request('/api/admin/summary', { csrf: false });
            renderDashboard(summary);
        } finally {
            state.dashboard.loading = false;
        }
    }

    function normalizeContentItem(item = {}) {
        return {
            enabled: Boolean(item.enabled),
            title: typeof item.title === 'string' ? item.title : '',
            body: typeof item.body === 'string' ? item.body : '',
            ctaLabel: typeof item.ctaLabel === 'string' ? item.ctaLabel : '',
            ctaHref: typeof item.ctaHref === 'string' ? item.ctaHref : ''
        };
    }

    function isSafeContentPath(value) {
        const text = String(value || '').trim();
        if (!text) return true;
        return text.startsWith('/')
            && !text.startsWith('//')
            && !text.includes('\\')
            && !/^\/(?:api|admin|auth\/admin)(?:\/|$)/i.test(text)
            && !/[\u0000-\u001F\u007F]/.test(text);
    }

    function renderSiteContent(content = {}) {
        const loginNotice = normalizeContentItem(content.loginNotice);
        const homeBanner = normalizeContentItem(content.homeBanner);
        nodes.loginNoticeEnabled.checked = loginNotice.enabled;
        nodes.loginNoticeTitle.value = loginNotice.title;
        nodes.loginNoticeBody.value = loginNotice.body;
        nodes.loginNoticeCtaLabel.value = loginNotice.ctaLabel;
        nodes.loginNoticeCtaHref.value = loginNotice.ctaHref;
        nodes.homeBannerEnabled.checked = homeBanner.enabled;
        nodes.homeBannerTitle.value = homeBanner.title;
        nodes.homeBannerBody.value = homeBanner.body;
        nodes.homeBannerCtaLabel.value = homeBanner.ctaLabel;
        nodes.homeBannerCtaHref.value = homeBanner.ctaHref;
    }

    function collectSiteContent() {
        const loginHref = nodes.loginNoticeCtaHref.value.trim();
        const bannerHref = nodes.homeBannerCtaHref.value.trim();
        if (!isSafeContentPath(loginHref) || !isSafeContentPath(bannerHref)) {
            throw new Error('Button path must be an internal path and cannot target admin or API routes.');
        }
        return {
            loginNotice: {
                enabled: nodes.loginNoticeEnabled.checked,
                title: nodes.loginNoticeTitle.value.trim(),
                body: nodes.loginNoticeBody.value.trim(),
                ctaLabel: nodes.loginNoticeCtaLabel.value.trim(),
                ctaHref: loginHref
            },
            homeBanner: {
                enabled: nodes.homeBannerEnabled.checked,
                title: nodes.homeBannerTitle.value.trim(),
                body: nodes.homeBannerBody.value.trim(),
                ctaLabel: nodes.homeBannerCtaLabel.value.trim(),
                ctaHref: bannerHref
            }
        };
    }

    async function loadSiteContent() {
        state.siteContent.loading = true;
        try {
            const payload = await request('/api/admin/site-content', { csrf: false });
            state.siteContent.content = payload.content || {};
            renderSiteContent(state.siteContent.content);
        } finally {
            state.siteContent.loading = false;
        }
    }

    async function saveSiteContent() {
        const body = collectSiteContent();
        await withButtonBusy(nodes.contentSaveButton, 'Saving...', async () => {
            const payload = await request('/api/admin/site-content', {
                method: 'PATCH',
                body
            });
            state.siteContent.content = payload.content || {};
            renderSiteContent(state.siteContent.content);
            setStatus('Business content updated');
        });
    }

    function getDownloadFilename(response, fallback) {
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match && match[1]) {
            return match[1].replace(/[^A-Za-z0-9._-]+/g, '-');
        }
        return fallback;
    }

    async function downloadExport(dataset, button) {
        const safeDataset = String(dataset || '').replace(/[^a-z-]/g, '');
        if (!safeDataset) return;
        await withButtonBusy(button, 'Exporting...', async () => {
            const response = await fetch(`/api/admin/export?dataset=${encodeURIComponent(safeDataset)}&format=csv`, {
                credentials: 'same-origin'
            });
            if (response.status === 401 || response.status === 403) {
                window.location.href = '/auth/admin/start?return_to=/admin';
                throw new Error('Admin session expired');
            }
            if (!response.ok) {
                throw new Error(`Export failed with ${response.status}`);
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = getDownloadFilename(response, `ielts-${safeDataset}.csv`);
            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            setStatus(`Exported ${safeDataset}`);
        });
    }

    function selectUser(user) {
        state.selectedUser = user;
        nodes.selectedUserTitle.textContent = user.username;
        nodes.selectedUserId.textContent = user.id;
        nodes.selectedUserCreated.textContent = formatDate(user.createdAt);
        nodes.selectedUserUpdated.textContent = formatDate(user.updatedAt);
        nodes.openAccountCenter.href = `/admin/account?userId=${encodeURIComponent(user.id)}`;
        nodes.openAccountCenter.classList.remove('is-disabled');
        nodes.openAccountCenter.setAttribute('aria-disabled', 'false');
        nodes.selectedUserRole.value = user.role;
        nodes.selectedUserRole.disabled = false;
        nodes.selectedUserPassword.value = '';
        nodes.selectedUserPassword.disabled = false;
        nodes.saveUserButton.disabled = false;
        nodes.deleteUserButton.disabled = user.id === state.currentUserId;
        Array.from(nodes.usersBody.querySelectorAll('tr')).forEach((row) => {
            row.classList.toggle('is-selected', row.dataset.userId === user.id);
        });
    }

    function clearSelection() {
        state.selectedUser = null;
        nodes.selectedUserTitle.textContent = 'No user selected';
        nodes.selectedUserId.textContent = '-';
        nodes.selectedUserCreated.textContent = '-';
        nodes.selectedUserUpdated.textContent = '-';
        nodes.openAccountCenter.href = '/admin/account';
        nodes.openAccountCenter.classList.add('is-disabled');
        nodes.openAccountCenter.setAttribute('aria-disabled', 'true');
        nodes.selectedUserRole.value = 'user';
        nodes.selectedUserRole.disabled = true;
        nodes.selectedUserPassword.value = '';
        nodes.selectedUserPassword.disabled = true;
        nodes.saveUserButton.disabled = true;
        nodes.deleteUserButton.disabled = true;
        Array.from(nodes.usersBody.querySelectorAll('tr')).forEach((row) => row.classList.remove('is-selected'));
    }

    function openUserDialog() {
        nodes.createUserForm.reset();
        nodes.userDialog.hidden = false;
        nodes.createUsername.focus();
    }

    function closeUserDialog() {
        nodes.userDialog.hidden = true;
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

    async function createUser(event) {
        event.preventDefault();
        const body = {
            username: nodes.createUsername.value.trim(),
            password: nodes.createPassword.value,
            role: nodes.createRole.value
        };
        await withButtonBusy(nodes.createUserSubmit, 'Creating...', async () => {
            const payload = await request('/api/admin/users', {
                method: 'POST',
                body
            });
            closeUserDialog();
            setStatus(`Created ${payload.user.username}`);
            state.users.offset = 0;
            await loadDashboard();
            await loadUsers();
            selectUser(payload.user);
        });
    }

    async function saveSelectedUser(event) {
        event.preventDefault();
        const user = state.selectedUser;
        if (!user) return;

        const body = {};
        if (nodes.selectedUserRole.value !== user.role) {
            body.role = nodes.selectedUserRole.value;
        }
        if (nodes.selectedUserPassword.value.trim()) {
            body.password = nodes.selectedUserPassword.value;
        }
        if (!Object.keys(body).length) {
            setStatus('No changes to save');
            return;
        }

        await withButtonBusy(nodes.saveUserButton, 'Saving...', async () => {
            const payload = await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
                method: 'PATCH',
                body
            });
            const nextUser = payload.user;
            setStatus(`Updated ${nextUser.username}`);
            state.selectedUser = nextUser;
            nodes.selectedUserPassword.value = '';
            await loadDashboard();
            await loadUsers();
            selectUser(nextUser);
        });
    }

    async function deleteSelectedUser() {
        const user = state.selectedUser;
        if (!user || user.id === state.currentUserId) return;
        const confirmed = await confirmAction({
            title: 'Delete user',
            message: `Delete "${user.username}"? This cannot be undone.`,
            confirmText: 'Delete user'
        });
        if (!confirmed) {
            return;
        }
        await withButtonBusy(nodes.deleteUserButton, 'Deleting...', async () => {
            await request(`/api/admin/users/${encodeURIComponent(user.id)}`, {
                method: 'DELETE'
            });
            setStatus(`Deleted ${user.username}`);
            clearSelection();
            if (state.users.offset >= state.users.total - 1 && state.users.offset > 0) {
                state.users.offset = Math.max(0, state.users.offset - state.users.limit);
            }
            await loadDashboard();
            await loadUsers();
        });
    }

    function bindEvents() {
        nodes.refreshButton.addEventListener('click', () => {
            withButtonBusy(nodes.refreshButton, 'Refreshing...', async () => {
                await loadDashboard();
                await loadSiteContent();
                await loadUsers();
            }).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.exportButtons.forEach((button) => {
            button.addEventListener('click', () => {
                downloadExport(button.dataset.exportDataset, button).catch((error) => setStatus(error.message, 'error'));
            });
        });
        nodes.contentSaveButton.addEventListener('click', () => {
            saveSiteContent().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.newUserButton.addEventListener('click', openUserDialog);
        nodes.closeUserDialog.addEventListener('click', closeUserDialog);
        nodes.userDialog.addEventListener('click', (event) => {
            if (event.target === nodes.userDialog) {
                closeUserDialog();
            }
        });
        nodes.userSearch.addEventListener('input', () => {
            window.clearTimeout(nodes.userSearch._timer);
            nodes.userSearch._timer = window.setTimeout(() => {
                state.users.q = nodes.userSearch.value.trim();
                state.users.offset = 0;
                loadUsers().catch((error) => setStatus(error.message, 'error'));
            }, 200);
        });
        nodes.userRoleFilter.addEventListener('change', () => {
            state.users.role = nodes.userRoleFilter.value;
            state.users.offset = 0;
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.usersPrev.addEventListener('click', () => {
            state.users.offset = Math.max(0, state.users.offset - state.users.limit);
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.usersNext.addEventListener('click', () => {
            state.users.offset += state.users.limit;
            loadUsers().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.createUserForm.addEventListener('submit', (event) => {
            createUser(event).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.editUserForm.addEventListener('submit', (event) => {
            saveSelectedUser(event).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.deleteUserButton.addEventListener('click', () => {
            deleteSelectedUser().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.confirmCancel.addEventListener('click', () => closeConfirm(false));
        nodes.confirmSubmit.addEventListener('click', () => closeConfirm(true));
        nodes.confirmDialog.addEventListener('click', (event) => {
            if (event.target === nodes.confirmDialog) {
                closeConfirm(false);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (!nodes.confirmDialog.hidden) {
                closeConfirm(false);
            } else if (!nodes.userDialog.hidden) {
                closeUserDialog();
            }
        });
        nodes.logoutButton.addEventListener('click', async () => {
            nodes.logoutButton.disabled = true;
            try {
                await request('/api/auth/logout', { method: 'POST' });
                window.location.href = '/auth/admin/start?return_to=/admin';
            } catch (error) {
                nodes.logoutButton.disabled = false;
                setStatus(error.message, 'error');
            }
        });
    }

    async function boot() {
        bindEvents();
        clearSelection();
        const ok = await loadAuth();
        if (!ok) return;
        await loadDashboard();
        await loadSiteContent();
        await loadUsers();
    }

    if (window.__IELTS_ADMIN_TEST__) {
        window.__IELTS_ADMIN_TEST_HOOKS__ = {
            formatDate,
            sanitizeStatusMessage,
            parseAdminResponseJson,
            request,
            loadAuth,
            loadDashboard,
            loadSiteContent,
            loadUsers,
            downloadExport,
            confirmAction,
            closeConfirm,
            state
        };
    } else {
        boot().catch((error) => setStatus(error.message, 'error'));
    }
})();
