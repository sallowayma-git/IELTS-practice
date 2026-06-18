(function() {
    const state = {
        csrfToken: '',
        currentUserId: '',
        selectedUser: null,
        selectedRecord: null,
        users: {
            limit: 25,
            offset: 0,
            total: 0,
            loading: false
        },
        records: {
            limit: 20,
            offset: 0,
            total: 0,
            loading: false
        }
    };

    const nodes = {
        status: document.getElementById('status'),
        logoutButton: document.getElementById('logout-button'),
        refreshButton: document.getElementById('refresh-button'),
        userSearch: document.getElementById('user-search'),
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
        createUsername: document.getElementById('create-username'),
        createPassword: document.getElementById('create-password'),
        createRole: document.getElementById('create-role'),
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
        recordsBody: document.getElementById('records-body'),
        recordsTitle: document.getElementById('records-title'),
        recordsPrev: document.getElementById('records-prev'),
        recordsNext: document.getElementById('records-next'),
        recordsRange: document.getElementById('records-range'),
        recordDetailTitle: document.getElementById('record-detail-title'),
        recordDetailBody: document.getElementById('record-detail-body'),
        trafficWindow: document.getElementById('traffic-window'),
        trafficRequests: document.getElementById('traffic-requests'),
        trafficPageviews: document.getElementById('traffic-pageviews'),
        trafficVisitors: document.getElementById('traffic-visitors'),
        trafficErrors: document.getElementById('traffic-errors'),
        trafficDaily: document.getElementById('traffic-daily'),
        trafficPaths: document.getElementById('traffic-paths')
    };

    function setStatus(message, kind = 'info') {
        nodes.status.textContent = message || '';
        nodes.status.dataset.kind = kind;
        if (message) {
            window.setTimeout(() => {
                if (nodes.status.textContent === message) {
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

    function formatScoreValue(value) {
        if (value === null || value === undefined || value === '') return '-';
        return `${Math.round(Number(value) * 10) / 10}%`;
    }

    function formatScore(record) {
        if (record.score === null || record.score === undefined || record.score === '') {
            return '-';
        }
        const suffix = record.totalQuestions ? ` / ${record.totalQuestions}` : '';
        return `${record.score}${suffix}`;
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

    function updatePagination() {
        nodes.usersRange.textContent = rangeLabel(state.users.offset, state.users.limit, state.users.total);
        nodes.usersPrev.disabled = state.users.loading || state.users.offset <= 0;
        nodes.usersNext.disabled = state.users.loading || state.users.offset + state.users.limit >= state.users.total;

        nodes.recordsRange.textContent = rangeLabel(state.records.offset, state.records.limit, state.records.total);
        nodes.recordsPrev.disabled = state.records.loading || state.records.offset <= 0 || !state.selectedUser;
        nodes.recordsNext.disabled = state.records.loading || state.records.offset + state.records.limit >= state.records.total || !state.selectedUser;
    }

    async function request(path, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (options.csrf !== false && options.method && options.method !== 'GET') {
            headers['X-CSRF-Token'] = state.csrfToken;
        }
        const response = await fetch(path, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        let payload = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch (_) {
            payload = null;
        }
        if (response.status === 401) {
            window.location.href = '/';
            return null;
        }
        if (!response.ok) {
            const detail = payload && payload.details ? ` ${JSON.stringify(payload.details)}` : '';
            throw new Error(payload && payload.error ? `${payload.error}${detail}` : `Request failed with ${response.status}`);
        }
        return payload;
    }

    async function loadAuth() {
        const payload = await request('/api/auth/me', { csrf: false });
        if (!payload || !payload.user || payload.user.role !== 'admin') {
            document.body.innerHTML = '<main class="admin-layout"><section class="admin-panel"><h2>Admin access required</h2></section></main>';
            return false;
        }
        state.currentUserId = payload.user.id;
        state.csrfToken = payload.csrfToken || '';
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
        state.users.loading = true;
        updatePagination();
        setRowMessage(nodes.usersBody, 5, 'Loading users...');
        try {
            const query = new URLSearchParams({
                q: nodes.userSearch.value.trim(),
                limit: String(state.users.limit),
                offset: String(state.users.offset)
            });
            const payload = await request(`/api/admin/users?${query}`, { csrf: false });
            renderUsers(payload);
            const selectedStillVisible = state.selectedUser && payload.users.some((user) => user.id === state.selectedUser.id);
            if ((!state.selectedUser || !selectedStillVisible) && payload.users[0]) {
                await selectUser(payload.users[0], { resetRecords: true });
            }
            if (!payload.users.length) {
                clearUserSelection();
            }
        } finally {
            state.users.loading = false;
            updatePagination();
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
            meta.textContent = `${formatNumber(item.recordCount)} records · ${formatScoreValue(item.averageScore)} · ${formatNumber(item.totalStudyMinutes)} min`;
            row.append(name, meta);
            container.append(row);
        }
    }

    async function loadUserStats(userId) {
        if (!userId) return;
        const stats = await request(`/api/admin/users/${encodeURIComponent(userId)}/stats`, { csrf: false });
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
        nodes.selectedUserName.textContent = user ? `${user.username} · ${user.id}` : 'No user selected';
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
        payload.textContent = JSON.stringify(record.payload || {}, null, 2);
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
                const label = record.title || record.examId || record.id;
                if (!window.confirm(`Delete record "${label}" updated ${formatDate(record.updatedAt)}?`)) {
                    return;
                }
                remove.disabled = true;
                try {
                    await request(`/api/admin/users/${encodeURIComponent(state.selectedUser.id)}/practice-records/${encodeURIComponent(record.id)}`, {
                        method: 'DELETE'
                    });
                    setStatus('Record deleted');
                    if (state.records.offset >= state.records.total - 1 && state.records.offset > 0) {
                        state.records.offset = Math.max(0, state.records.offset - state.records.limit);
                    }
                    await refreshAfterMutation();
                    await loadRecords(state.selectedUser.id, state.selectedUser.username);
                } catch (error) {
                    setStatus(error.message, 'error');
                } finally {
                    remove.disabled = false;
                }
            });
            action.append(details, remove);
            row.append(title, type, score, updated, action);
            nodes.recordsBody.append(row);
        }
    }

    async function loadRecords(userId, username) {
        if (!userId) return;
        state.records.loading = true;
        updatePagination();
        setRowMessage(nodes.recordsBody, 5, 'Loading records...');
        try {
            const payload = await request(`/api/admin/users/${encodeURIComponent(userId)}/practice-records?limit=${state.records.limit}&offset=${state.records.offset}`, { csrf: false });
            renderRecords(payload, username);
        } finally {
            state.records.loading = false;
            updatePagination();
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
        const traffic = await request('/api/admin/traffic?days=14&limit=10', { csrf: false });
        nodes.trafficWindow.textContent = `Last ${traffic.days} days`;
        nodes.trafficRequests.textContent = formatNumber(traffic.requests);
        nodes.trafficPageviews.textContent = formatNumber(traffic.pageViews);
        nodes.trafficVisitors.textContent = formatNumber(traffic.uniqueVisitors);
        nodes.trafficErrors.textContent = formatNumber(traffic.errors);
        nodes.trafficDaily.textContent = '';
        if (!traffic.daily.length) {
            nodes.trafficDaily.textContent = 'No traffic captured yet.';
        } else {
            const maxRequests = Math.max(1, ...traffic.daily.map((item) => item.requests));
            for (const item of traffic.daily) {
                const row = document.createElement('div');
                row.className = 'traffic-row';
                const label = document.createElement('strong');
                label.textContent = item.day;
                const bar = document.createElement('span');
                bar.className = 'traffic-bar';
                bar.style.setProperty('--bar-width', `${Math.max(6, Math.round((item.requests / maxRequests) * 100))}%`);
                const meta = document.createElement('em');
                meta.textContent = `${formatNumber(item.requests)} req · ${formatNumber(item.pageViews)} views`;
                row.append(label, bar, meta);
                nodes.trafficDaily.append(row);
            }
        }
        nodes.trafficPaths.textContent = '';
        if (!traffic.topPaths.length) {
            nodes.trafficPaths.textContent = 'No paths captured yet.';
        } else {
            for (const item of traffic.topPaths) {
                const row = document.createElement('div');
                row.className = 'mini-list__row';
                const name = document.createElement('strong');
                name.textContent = item.path;
                const meta = document.createElement('span');
                meta.textContent = `${item.routeGroup} · ${formatNumber(item.requests)} requests · ${formatNumber(item.uniqueVisitors)} visitors`;
                row.append(name, meta);
                nodes.trafficPaths.append(row);
            }
        }
    }

    async function refreshAfterMutation() {
        await Promise.all([
            loadSummary(),
            loadGlobalStats(),
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
            refreshAll().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.userSearch.addEventListener('input', () => {
            window.clearTimeout(nodes.userSearch._timer);
            nodes.userSearch._timer = window.setTimeout(() => {
                state.users.offset = 0;
                clearUserSelection();
                loadUsers().catch((error) => setStatus(error.message, 'error'));
            }, 200);
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
            state.records.offset = Math.max(0, state.records.offset - state.records.limit);
            loadRecords(state.selectedUser.id, state.selectedUser.username).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.recordsNext.addEventListener('click', () => {
            state.records.offset += state.records.limit;
            loadRecords(state.selectedUser.id, state.selectedUser.username).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.createUserForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const body = {
                username: nodes.createUsername.value.trim(),
                password: nodes.createPassword.value,
                role: nodes.createRole.value
            };
            try {
                const payload = await request('/api/admin/users', { method: 'POST', body });
                nodes.createUserForm.reset();
                setStatus(`Created ${payload.user.username}`);
                state.users.offset = 0;
                await refreshAll();
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
        document.getElementById('edit-user-form').addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!state.selectedUser) return;
            const body = {
                role: nodes.selectedUserRole.value
            };
            if (nodes.selectedUserPassword.value.trim()) {
                body.password = nodes.selectedUserPassword.value;
            }
            try {
                const payload = await request(`/api/admin/users/${encodeURIComponent(state.selectedUser.id)}`, {
                    method: 'PATCH',
                    body
                });
                state.selectedUser = payload.user;
                nodes.selectedUserPassword.value = '';
                setStatus(`Updated ${payload.user.username}`);
                await refreshAll();
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
        nodes.deleteUserButton.addEventListener('click', async () => {
            if (!state.selectedUser) return;
            if (!window.confirm(`Delete user "${state.selectedUser.username}" and all related records?`)) {
                return;
            }
            try {
                await request(`/api/admin/users/${encodeURIComponent(state.selectedUser.id)}`, { method: 'DELETE' });
                setStatus(`Deleted ${state.selectedUser.username}`);
                clearUserSelection();
                await refreshAll();
            } catch (error) {
                setStatus(error.message, 'error');
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

    boot().catch((error) => setStatus(error.message, 'error'));
})();
