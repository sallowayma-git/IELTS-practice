(function() {
    const state = {
        csrfToken: '',
        selectedUserId: '',
        selectedUsername: '',
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
        summaryLatest: document.getElementById('summary-latest'),
        usersBody: document.getElementById('users-body'),
        usersPrev: document.getElementById('users-prev'),
        usersNext: document.getElementById('users-next'),
        usersRange: document.getElementById('users-range'),
        recordsBody: document.getElementById('records-body'),
        recordsTitle: document.getElementById('records-title'),
        recordsCount: document.getElementById('records-count'),
        recordsPrev: document.getElementById('records-prev'),
        recordsNext: document.getElementById('records-next'),
        recordsRange: document.getElementById('records-range'),
        recordDetailTitle: document.getElementById('record-detail-title'),
        recordDetailBody: document.getElementById('record-detail-body')
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
            }, kind === 'error' ? 6000 : 3500);
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
        nodes.recordsPrev.disabled = state.records.loading || state.records.offset <= 0 || !state.selectedUserId;
        nodes.recordsNext.disabled = state.records.loading || state.records.offset + state.records.limit >= state.records.total || !state.selectedUserId;
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
        state.users.total = Number(payload.total || 0);
        updatePagination();
        if (!payload.users.length) {
            setRowMessage(nodes.usersBody, 4, 'No users');
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
        setRowMessage(nodes.usersBody, 4, 'Loading users...');
        try {
            const query = new URLSearchParams({
                q: nodes.userSearch.value.trim(),
                limit: String(state.users.limit),
                offset: String(state.users.offset)
            });
            const payload = await request(`/api/admin/users?${query}`, { csrf: false });
            renderUsers(payload);
            const selectedStillVisible = payload.users.some((user) => user.id === state.selectedUserId);
            if ((!state.selectedUserId || !selectedStillVisible) && payload.users[0]) {
                await selectUser(payload.users[0], { resetRecords: true });
            }
            if (!payload.users.length) {
                clearRecordSelection();
            }
        } finally {
            state.users.loading = false;
            updatePagination();
        }
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
        nodes.recordsCount.textContent = String(state.records.total);
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
                    await request(`/api/admin/users/${encodeURIComponent(state.selectedUserId)}/practice-records/${encodeURIComponent(record.id)}`, {
                        method: 'DELETE'
                    });
                    setStatus('Record deleted');
                    if (state.records.offset >= state.records.total - 1 && state.records.offset > 0) {
                        state.records.offset = Math.max(0, state.records.offset - state.records.limit);
                    }
                    await loadSummary();
                    await loadRecords(state.selectedUserId, state.selectedUsername);
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
        state.selectedUserId = user.id;
        state.selectedUsername = user.username;
        if (options.resetRecords !== false) {
            state.records.offset = 0;
        }
        renderRecordDetails(null);
        await loadRecords(user.id, user.username);
        Array.from(nodes.usersBody.querySelectorAll('tr')).forEach((item) => {
            item.classList.toggle('is-selected', item.dataset.userId === user.id);
        });
    }

    function clearRecordSelection() {
        state.selectedUserId = '';
        state.selectedUsername = '';
        state.records.offset = 0;
        state.records.total = 0;
        nodes.recordsTitle.textContent = 'Practice Records';
        nodes.recordsCount.textContent = '0';
        setRowMessage(nodes.recordsBody, 5, 'Select a user');
        renderRecordDetails(null);
        updatePagination();
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
            refreshAll().catch((error) => setStatus(error.message, 'error'));
        });
        nodes.userSearch.addEventListener('input', () => {
            window.clearTimeout(nodes.userSearch._timer);
            nodes.userSearch._timer = window.setTimeout(() => {
                state.users.offset = 0;
                clearRecordSelection();
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
            loadRecords(state.selectedUserId, state.selectedUsername).catch((error) => setStatus(error.message, 'error'));
        });
        nodes.recordsNext.addEventListener('click', () => {
            state.records.offset += state.records.limit;
            loadRecords(state.selectedUserId, state.selectedUsername).catch((error) => setStatus(error.message, 'error'));
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
        clearRecordSelection();
        const ok = await loadAuth();
        if (!ok) return;
        await refreshAll();
    }

    boot().catch((error) => setStatus(error.message, 'error'));
})();
