(function() {
    const ADMIN_PATH = '/admin';
    const LOGIN_PATH = '/admin/login';

    const state = {
        csrfToken: '',
        mode: 'password'
    };

    const nodes = {
        status: document.getElementById('admin-login-status'),
        passwordForm: document.getElementById('admin-password-form'),
        username: document.getElementById('admin-username'),
        password: document.getElementById('admin-password'),
        loginSubmit: document.getElementById('admin-login-submit'),
        totpForm: document.getElementById('admin-totp-form'),
        totpToken: document.getElementById('admin-totp-token'),
        totpSubmit: document.getElementById('admin-totp-submit'),
        setupPanel: document.getElementById('admin-totp-setup'),
        setupForm: document.getElementById('admin-totp-setup-form'),
        setupQr: document.getElementById('admin-totp-qr'),
        setupSecret: document.getElementById('admin-totp-secret'),
        setupToken: document.getElementById('admin-totp-setup-token'),
        setupSubmit: document.getElementById('admin-totp-setup-submit'),
        recoveryPanel: document.getElementById('admin-recovery'),
        recoveryCodes: document.getElementById('admin-recovery-codes'),
        recoveryContinue: document.getElementById('admin-recovery-continue')
    };

    function setStatus(message, kind) {
        nodes.status.textContent = message || '';
        nodes.status.classList.toggle('is-error', kind === 'error');
        nodes.status.classList.toggle('is-success', kind === 'success');
    }

    function setVisible(node, visible) {
        node.hidden = !visible;
    }

    function showOnly(mode) {
        setVisible(nodes.passwordForm, mode === 'password');
        setVisible(nodes.totpForm, mode === 'totp-login' || mode === 'totp-verify');
        setVisible(nodes.setupPanel, mode === 'setup');
        setVisible(nodes.recoveryPanel, mode === 'recovery');
        state.mode = mode;
    }

    function parseJson(text) {
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (_) {
            return null;
        }
    }

    async function request(path, options = {}) {
        const method = options.method || 'GET';
        const headers = Object.assign({}, options.headers || {});
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        if (options.csrf !== false && method !== 'GET') {
            if (!state.csrfToken) {
                await loadCsrf();
            }
            headers['X-CSRF-Token'] = state.csrfToken;
        }
        const response = await fetch(path, {
            method,
            credentials: 'same-origin',
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        const payload = parseJson(text);
        if (payload && typeof payload.csrfToken === 'string') {
            state.csrfToken = payload.csrfToken;
        }
        return { response, payload };
    }

    async function loadCsrf() {
        const result = await request('/api/auth/csrf', { csrf: false });
        if (!result.response.ok || !result.payload || typeof result.payload.csrfToken !== 'string') {
            throw new Error('Unable to start a secure admin session.');
        }
        state.csrfToken = result.payload.csrfToken;
    }

    function requestError(result, fallback) {
        const message = result && result.payload && typeof result.payload.error === 'string'
            ? result.payload.error
            : fallback;
        return new Error(message || 'Request failed');
    }

    function redirectAdmin() {
        window.location.assign(ADMIN_PATH);
    }

    function showPassword(message, kind) {
        showOnly('password');
        setStatus(message || 'Sign in with an admin account.', kind);
        window.setTimeout(() => nodes.username.focus({ preventScroll: true }), 0);
    }

    function showTotp(mode, message) {
        nodes.totpToken.value = '';
        showOnly(mode);
        setStatus(message || 'Enter the current TOTP code or a recovery code.');
        window.setTimeout(() => nodes.totpToken.focus({ preventScroll: true }), 0);
    }

    function normalizeQrDataUrl(value) {
        const text = String(value || '').trim();
        return /^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text) ? text : '';
    }

    async function beginSetup() {
        setStatus('Preparing TOTP setup...');
        const result = await request('/api/auth/totp/setup', { method: 'POST' });
        if (!result.response.ok) {
            throw requestError(result, 'TOTP setup could not be started.');
        }
        nodes.setupQr.src = normalizeQrDataUrl(result.payload.qrCodeDataUrl);
        nodes.setupSecret.textContent = result.payload.secret || '';
        nodes.setupToken.value = '';
        showOnly('setup');
        setStatus('Set up TOTP to continue.', 'success');
        window.setTimeout(() => nodes.setupToken.focus({ preventScroll: true }), 0);
    }

    function showRecoveryCodes(codes) {
        nodes.recoveryCodes.textContent = '';
        (Array.isArray(codes) ? codes : []).forEach((code) => {
            const item = document.createElement('li');
            item.textContent = String(code || '');
            nodes.recoveryCodes.appendChild(item);
        });
        showOnly('recovery');
        setStatus('TOTP is enabled. Save the recovery codes before continuing.', 'success');
    }

    async function inspectAdminSession() {
        const result = await request('/api/admin/summary', { csrf: false });
        if (result.response.ok) {
            redirectAdmin();
            return;
        }
        if (result.response.status === 403) {
            const statusResult = await request('/api/auth/totp/status', { csrf: false });
            const status = statusResult.response.ok ? statusResult.payload?.status : null;
            if (status && !status.enabled) {
                await beginSetup();
                return;
            }
            const error = String(result.payload?.error || '');
            if (status?.enabled || error.includes('verification')) {
                showTotp('totp-verify');
                return;
            }
        }
        if (result.response.status === 401) {
            showPassword('Sign in with an admin account.');
            return;
        }
        throw requestError(result, 'Admin access check failed.');
    }

    async function inspectCurrentUser() {
        const result = await request('/api/auth/me', { csrf: false });
        if (result.response.status === 401) {
            showPassword('Sign in with an admin account.');
            return;
        }
        if (!result.response.ok) {
            throw requestError(result, 'Session check failed.');
        }
        const user = result.payload && result.payload.user;
        if (!user || user.role !== 'admin') {
            showPassword('Admin credentials are required.', 'error');
            return;
        }
        await inspectAdminSession();
    }

    async function handlePasswordSubmit(event) {
        event.preventDefault();
        nodes.loginSubmit.disabled = true;
        setStatus('Checking credentials...');
        try {
            const result = await request('/api/auth/login', {
                method: 'POST',
                body: {
                    username: nodes.username.value,
                    password: nodes.password.value
                }
            });
            if (!result.response.ok) {
                throw requestError(result, 'Login failed.');
            }
            nodes.password.value = '';
            if (result.payload.requiresTotp) {
                showTotp('totp-login');
                return;
            }
            if (result.payload.requiresTotpSetup) {
                await beginSetup();
                return;
            }
            if (!result.payload.user || result.payload.user.role !== 'admin') {
                showPassword('Admin credentials are required.', 'error');
                return;
            }
            await inspectAdminSession();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.loginSubmit.disabled = false;
        }
    }

    async function handleTotpSubmit(event) {
        event.preventDefault();
        nodes.totpSubmit.disabled = true;
        const token = nodes.totpToken.value.trim();
        setStatus('Verifying TOTP...');
        try {
            const path = state.mode === 'totp-login'
                ? '/api/auth/totp/login'
                : '/api/auth/totp/verify';
            const result = await request(path, {
                method: 'POST',
                body: { token }
            });
            if (!result.response.ok) {
                throw requestError(result, 'TOTP verification failed.');
            }
            if (!result.payload.user || result.payload.user.role !== 'admin') {
                showPassword('Admin credentials are required.', 'error');
                return;
            }
            redirectAdmin();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.totpSubmit.disabled = false;
        }
    }

    async function handleSetupSubmit(event) {
        event.preventDefault();
        nodes.setupSubmit.disabled = true;
        setStatus('Enabling TOTP...');
        try {
            const result = await request('/api/auth/totp/verify-setup', {
                method: 'POST',
                body: { token: nodes.setupToken.value.trim() }
            });
            if (!result.response.ok) {
                throw requestError(result, 'TOTP setup failed.');
            }
            if (!result.payload.user || result.payload.user.role !== 'admin') {
                showPassword('Admin credentials are required.', 'error');
                return;
            }
            showRecoveryCodes(result.payload.recoveryCodes);
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.setupSubmit.disabled = false;
        }
    }

    async function boot() {
        nodes.passwordForm.addEventListener('submit', handlePasswordSubmit);
        nodes.totpForm.addEventListener('submit', handleTotpSubmit);
        nodes.setupForm.addEventListener('submit', handleSetupSubmit);
        nodes.recoveryContinue.addEventListener('click', redirectAdmin);
        try {
            await loadCsrf();
            await inspectCurrentUser();
        } catch (error) {
            showPassword(error.message, 'error');
        }
    }

    if (window.location.pathname !== LOGIN_PATH) {
        window.history.replaceState(null, '', LOGIN_PATH);
    }
    boot();
}());
