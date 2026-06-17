(function() {
    const state = {
        csrfToken: '',
        selectedUserId: '',
        selectedUsername: ''
    };

    const nodes = {
        status: document.getElementById('status'),
        logoutButton: document.getElementById('logout-button'),
        refreshButton: document.getElementById('refresh-button'),
        userSearch: document.getElementById('user-search'),
        summaryUsers: document.getElementById('summary-users'),
        summaryAdmins: document.getElementById('summary-admins'),
        summaryRecords: document.getElementById('summary-records'),
        summaryLatest: document.getElementById('summary-latest'),
        usersBody: document.getElementById('users-body'),
        recordsBody: document.getElementById('records-body'),
        recordsTitle: document.getElementById('records-title'),
        recordsCount: document.getElementById('records-count')
    };

    function setStatus(message) {
        nodes.status.textContent = message || '';
        if (message) {
            window.setTimeout(() => {
                if (nodes.status.textContent === message) {
                    nodes.status.textContent = '';
                }
            }, 3500);
        }
    }

    function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(Number(date))) return '-';
        return date.toLocaleString();
    }

    function formatScore(record) {
        if (record.score === null || record.score === undefined || record.score === '') {
            return '-';
        }
        const suffix = record.totalQuestions ? ` / ${record.totalQuestions}` : '';
        return `${record.score}${suffix}`;
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
        const payload = text ? JSON.parse(text) : null;
        if (response.status === 401) {
            window.location.href = '/';
            return null;
        }
        if (!response.ok) {
            throw new Error(payload && payload.error ? payload.error : `Request failed with ${response.status}`);
        }
        return payload;
    }

    async function loadAuth() {
        const payload = await request('/api/auth/me', { csrf: false });
        if (!payload || !payload.user || payload.user.role !== 'admin') {
            document.body.innerHTML = '<main class="admin-layout"><section class="admin-panel"><h2>Admin access required</h2></section></main>';
            return false;
        }
        state.csrfToken = payload.csrfToken || '';
        return true;
    }

    async function loadSummary() {
        const summary = await request('/api/admin/summary', { csrf: false });
        nodes.summaryUsers.textContent = summary.userCount;
        nodes.summaryAdmins.textContent = summary.adminCount;
        nodes.summaryRecords.textContent = summary.practiceRecordCount;
        nodes.summaryLatest.textContent = formatDate(summary.latestRecordAt);
    }

    function renderUsers(payload) {
        nodes.usersBody.textContent = '';
        if (!payload.users.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.className = 'empty-cell';
            cell.colSpan = 4;
            cell.textContent = 'No users';
            row.append(cell);
            nodes.usersBody.append(row);
            return;
        }

        for (const user of payload.users) {
            const row = document.createElement('tr');
            row.className = 'user-row';
            row.tabIndex = 0;
            row.dataset.userId = user.id;
            row.classList.toggle('is-selected', user.id === state.selectedUserId);

            const username = document.createElement('td');
            username.textContent = user.username;
            const role = document.createElement('td');
            const pill = document.createElement('span');
            pill.className = `role-pill${user.role === 'admin' ? ' is-admin' : ''}`;
            pill.textContent = user.role;
            role.append(pill);
            const count = document.createElement('td');
            count.textContent = user.recordCount;
            const latest = document.createElement('td');
            latest.textContent = formatDate(user.latestRecordAt);
            row.append(username, role, count, latest);

            const select = () => {
                state.selectedUserId = user.id;
                state.selectedUsername = user.username;
                loadRecords(user.id, user.username).catch((error) => setStatus(error.message));
                Array.from(nodes.usersBody.querySelectorAll('tr')).forEach((item) => {
                    item.classList.toggle('is-selected', item.dataset.userId === user.id);
                });
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
        const query = new URLSearchParams({
            q: nodes.userSearch.value.trim(),
            limit: '50',
            offset: '0'
        });
        const payload = await request(`/api/admin/users?${query}`, { csrf: false });
        renderUsers(payload);
        if (!state.selectedUserId && payload.users[0]) {
            state.selectedUserId = payload.users[0].id;
            state.selectedUsername = payload.users[0].username;
            await loadRecords(state.selectedUserId, state.selectedUsername);
        }
    }

    function renderRecords(payload, username) {
        nodes.recordsBody.textContent = '';
        nodes.recordsTitle.textContent = username ? `${username} Records` : 'Practice Records';
        nodes.recordsCount.textContent = String(payload.total || 0);

        if (!payload.records.length) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.className = 'empty-cell';
            cell.colSpan = 5;
            cell.textContent = 'No records';
            row.append(cell);
            nodes.recordsBody.append(row);
            return;
        }

        for (const record of payload.records) {
            const row = document.createElement('tr');
            const title = document.createElement('td');
            title.textContent = record.title || record.examId || record.id;
            const type = document.createElement('td');
            type.textContent = record.type || '-';
            const score = document.createElement('td');
            score.textContent = formatScore(record);
            const updated = document.createElement('td');
            updated.textContent = formatDate(record.updatedAt);
            const action = document.createElement('td');
            const remove = document.createElement('button');
            remove.className = 'delete-button';
            remove.type = 'button';
            remove.textContent = 'Delete';
            remove.addEventListener('click', async () => {
                if (!window.confirm(`Delete record ${record.id}?`)) {
                    return;
                }
                await request(`/api/admin/users/${encodeURIComponent(state.selectedUserId)}/practice-records/${encodeURIComponent(record.id)}`, {
                    method: 'DELETE'
                });
                setStatus('Record deleted');
                await loadSummary();
                await loadRecords(state.selectedUserId, state.selectedUsername);
            });
            action.append(remove);
            row.append(title, type, score, updated, action);
            nodes.recordsBody.append(row);
        }
    }

    async function loadRecords(userId, username) {
        if (!userId) return;
        const payload = await request(`/api/admin/users/${encodeURIComponent(userId)}/practice-records?limit=50&offset=0`, { csrf: false });
        renderRecords(payload, username);
    }

    async function refreshAll() {
        await loadSummary();
        await loadUsers();
        if (state.selectedUserId) {
            await loadRecords(state.selectedUserId, state.selectedUsername);
        }
    }

    function bindEvents() {
        nodes.refreshButton.addEventListener('click', () => {
            refreshAll().catch((error) => setStatus(error.message));
        });
        nodes.userSearch.addEventListener('input', () => {
            window.clearTimeout(nodes.userSearch._timer);
            nodes.userSearch._timer = window.setTimeout(() => {
                state.selectedUserId = '';
                state.selectedUsername = '';
                loadUsers().catch((error) => setStatus(error.message));
            }, 200);
        });
        nodes.logoutButton.addEventListener('click', async () => {
            await request('/api/auth/logout', { method: 'POST' });
            window.location.href = '/';
        });
    }

    async function boot() {
        bindEvents();
        const ok = await loadAuth();
        if (!ok) return;
        await refreshAll();
    }

    boot().catch((error) => setStatus(error.message));
})();
