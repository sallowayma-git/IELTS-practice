(function() {
    const params = new URLSearchParams(window.location.search || '');
    const expectedAudience = getExpectedAudience(window.location.pathname);
    let handoffState = params.get('state') || '';
    const handoff = parseHandoffState(handoffState);
    const state = {
        csrfToken: '',
        mode: 'login'
    };

    const nodes = {
        title: document.getElementById('auth-title'),
        status: document.getElementById('auth-status'),
        tabs: document.getElementById('auth-tabs'),
        loginTab: document.getElementById('login-tab'),
        registerTab: document.getElementById('register-tab'),
        passwordForm: document.getElementById('password-form'),
        username: document.getElementById('username'),
        password: document.getElementById('password'),
        passwordSubmit: document.getElementById('password-submit'),
        totpForm: document.getElementById('totp-form'),
        totpToken: document.getElementById('totp-token'),
        totpSubmit: document.getElementById('totp-submit'),
        setupPanel: document.getElementById('totp-setup'),
        setupForm: document.getElementById('totp-setup-form'),
        setupQr: document.getElementById('totp-qr'),
        setupSecret: document.getElementById('totp-secret'),
        setupToken: document.getElementById('totp-setup-token'),
        setupSubmit: document.getElementById('totp-setup-submit'),
        recoveryPanel: document.getElementById('recovery'),
        recoveryCodes: document.getElementById('recovery-codes'),
        recoveryContinue: document.getElementById('recovery-continue'),
        sessionConflictPanel: document.getElementById('session-conflict'),
        sessionConflictMessage: document.getElementById('session-conflict-message'),
        sessionConflictRestart: document.getElementById('session-conflict-restart')
    };

    function setStatus(message, kind) {
        nodes.status.textContent = message || '';
        nodes.status.classList.toggle('is-error', kind === 'error');
        nodes.status.classList.toggle('is-success', kind === 'success');
    }

    function getExpectedAudience(pathname) {
        const path = String(pathname || '');
        if (/^\/auth\/admin\/login\/?$/i.test(path)) {
            return 'admin';
        }
        if (/^\/auth\/business\/login\/?$/i.test(path)) {
            return 'business';
        }
        return '';
    }

    function parseHandoffState(rawState) {
        const encoded = String(rawState || '').split('.')[0] || '';
        if (!encoded) {
            return null;
        }
        try {
            const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
            const payload = JSON.parse(atob(padded));
            return {
                audience: payload?.audience === 'admin' ? 'admin' : 'business',
                returnTo: typeof payload?.returnTo === 'string' ? payload.returnTo : ''
            };
        } catch (_) {
            return null;
        }
    }

    function setVisible(node, visible) {
        node.hidden = !visible;
    }

    function validateHandoffAudience() {
        if (!handoffState || !expectedAudience) {
            return true;
        }
        if (!handoff || handoff.audience !== expectedAudience) {
            handoffState = '';
            setMode('login', `This auth request does not match the ${expectedAudience} login entry. Start login again from the ${expectedAudience} site.`);
            setStatus('Auth request mismatch. Please start login again.', 'error');
            return false;
        }
        return true;
    }

    function redirectGenericHandoffLogin() {
        if (!handoffState || expectedAudience) {
            return false;
        }
        if (!handoff || !handoff.audience) {
            handoffState = '';
            setStatus('Auth request is invalid. Please start login again from the site you were visiting.', 'error');
            return false;
        }
        window.location.replace(`/auth/${handoff.audience}/login?state=${encodeURIComponent(handoffState)}`);
        return true;
    }

    function isAdminFlow() {
        return expectedAudience === 'admin' || handoff?.audience === 'admin';
    }

    function getFlowAudience() {
        return expectedAudience || handoff?.audience || '';
    }

    function getAudienceConflict(user) {
        const audience = getFlowAudience();
        if (audience === 'business' && user?.role === 'admin') {
            return {
                message: 'A learner account is required for this business login flow.',
                detail: 'The current auth session is an administrator account. Sign in below with a learner account, or sign out of the current auth session first.'
            };
        }
        if (audience === 'admin' && user?.role !== 'admin') {
            return {
                message: 'An administrator account is required for this admin login flow.',
                detail: 'The current auth session is not an administrator. Sign in below with an administrator account, or sign out of the current auth session first.'
            };
        }
        return null;
    }

    function getCurrentLoginPath() {
        const audience = getFlowAudience();
        if (audience && handoffState) {
            return `/auth/${audience}/login?state=${encodeURIComponent(handoffState)}`;
        }
        if (audience) {
            return `/auth/${audience}/login`;
        }
        return '/auth/login';
    }

    function showSessionSwitchNotice(conflict) {
        nodes.username.value = '';
        nodes.password.value = '';
        nodes.sessionConflictMessage.textContent = conflict?.detail || 'Sign out of the current auth session, then start this login flow again.';
        setMode('login', conflict?.message || 'Sign in with an account allowed for this login flow.');
        setVisible(nodes.sessionConflictPanel, true);
    }

    function requireAccountForCurrentFlow(user) {
        const conflict = getAudienceConflict(user);
        if (!conflict) {
            return true;
        }
        showSessionSwitchNotice(conflict);
        return false;
    }

    function setMode(mode, message) {
        if (isAdminFlow() && mode === 'register') {
            mode = 'login';
        }
        state.mode = mode;
        setVisible(nodes.tabs, (mode === 'login' || mode === 'register') && !isAdminFlow());
        setVisible(nodes.passwordForm, mode === 'login' || mode === 'register');
        setVisible(nodes.totpForm, mode === 'totp-login');
        setVisible(nodes.setupPanel, mode === 'setup');
        setVisible(nodes.recoveryPanel, mode === 'recovery');
        setVisible(nodes.sessionConflictPanel, mode === 'session-conflict');
        nodes.loginTab.classList.toggle('is-active', mode === 'login');
        nodes.registerTab.classList.toggle('is-active', mode === 'register');
        nodes.title.textContent = {
            login: 'Sign in',
            register: 'Create account',
            'totp-login': 'Verify TOTP',
            setup: 'Set up TOTP',
            recovery: 'Save recovery codes',
            'session-conflict': 'Session conflict'
        }[mode] || 'Sign in';
        nodes.passwordSubmit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
        nodes.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
        nodes.password.minLength = mode === 'register' ? 8 : 1;
        setStatus(message || (mode === 'register' ? 'Create a learner account.' : 'Sign in to continue.'));
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
            redirect: options.redirect,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        const payload = parseJson(text);
        if (payload && typeof payload.csrfToken === 'string') {
            state.csrfToken = payload.csrfToken;
        }
        return { response, payload, text };
    }

    function requestError(result, fallback) {
        const message = result?.payload?.error || fallback || 'Request failed';
        const status = result?.response?.status;
        if ((status === 401 || status === 403) && !String(message).startsWith(`${status}:`)) {
            return new Error(`${status}: ${message}`);
        }
        return new Error(message);
    }

    function withHandoffState(payload) {
        return handoffState
            ? Object.assign({}, payload, { authState: handoffState })
            : payload;
    }

    async function loadCsrf() {
        const result = await request('/api/auth/csrf', { csrf: false });
        if (!result.response.ok || !result.payload?.csrfToken) {
            throw requestError(result, 'Unable to start a secure auth session.');
        }
        state.csrfToken = result.payload.csrfToken;
    }

    function normalizeQrDataUrl(value) {
        const text = String(value || '').trim();
        return /^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text) ? text : '';
    }

    async function completeHandoff() {
        if (handoffState) {
            const completeParams = new URLSearchParams({
                state: handoffState,
                format: 'json'
            });
            if (expectedAudience) {
                completeParams.set('audience', expectedAudience);
            }
            const result = await request(`/auth/complete?${completeParams.toString()}`, {
                csrf: false
            });
            if (result.response.ok && typeof result.payload?.redirectTo === 'string' && result.payload.redirectTo) {
                window.location.assign(result.payload.redirectTo);
                return;
            }
            if (result.response.status === 403 && handoff?.audience === 'admin') {
                setMode('login');
                setStatus(`403: ${result.payload?.error || 'Admin verification required for this login flow.'}`, 'error');
                return;
            }
            if (result.response.status === 403) {
                setMode('login');
                setStatus(`403: ${result.payload?.error || 'Account type does not match this login flow.'}`, 'error');
                return;
            }
            if (!result.response.ok) {
                throw requestError(result, 'Unable to complete auth handoff.');
            }
            return;
        }
        setMode('login', 'Start from the business or admin site to continue.');
        setStatus('Auth session is active, but no destination was provided.', 'success');
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
        setMode('setup', 'Set up TOTP to continue.');
    }

    function showRecoveryCodes(codes) {
        nodes.recoveryCodes.textContent = '';
        (Array.isArray(codes) ? codes : []).forEach((code) => {
            const item = document.createElement('li');
            item.textContent = String(code || '');
            nodes.recoveryCodes.appendChild(item);
        });
        setMode('recovery', 'TOTP is enabled. Save the recovery codes before continuing.');
    }

    async function inspectCurrentUser() {
        if (!validateHandoffAudience()) {
            return;
        }
        const result = await request('/api/auth/me', { csrf: false });
        if (result.response.status === 401) {
            setMode('login');
            return;
        }
        if (!result.response.ok || !result.payload?.user) {
            throw requestError(result, 'Session check failed.');
        }
        if (!requireAccountForCurrentFlow(result.payload.user)) {
            return;
        }
        setStatus('Session active. Continuing...', 'success');
        await completeHandoff();
    }

    async function handlePasswordSubmit(event) {
        event.preventDefault();
        if (!validateHandoffAudience()) {
            return;
        }
        nodes.passwordSubmit.disabled = true;
        setStatus('Checking credentials...');
        try {
            const endpoint = state.mode === 'register' ? '/api/auth/register' : '/api/auth/login';
            const result = await request(endpoint, {
                method: 'POST',
                body: withHandoffState({
                    username: nodes.username.value,
                    password: nodes.password.value
                })
            });
            if (!result.response.ok) {
                throw requestError(result, state.mode === 'register' ? 'Registration failed.' : 'Login failed.');
            }
            nodes.password.value = '';
            if (result.payload.requiresTotp) {
                nodes.totpToken.value = '';
                setMode('totp-login', 'Enter the current TOTP code or a recovery code.');
                return;
            }
            if (result.payload.requiresTotpSetup) {
                await beginSetup();
                return;
            }
            if (!requireAccountForCurrentFlow(result.payload.user)) {
                return;
            }
            await completeHandoff();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.passwordSubmit.disabled = false;
        }
    }

    async function handleTotpSubmit(event) {
        event.preventDefault();
        if (!validateHandoffAudience()) {
            return;
        }
        nodes.totpSubmit.disabled = true;
        setStatus('Verifying TOTP...');
        try {
            const result = await request('/api/auth/totp/login', {
                method: 'POST',
                body: { token: nodes.totpToken.value.trim() }
            });
            if (!result.response.ok) {
                throw requestError(result, 'TOTP verification failed.');
            }
            if (!requireAccountForCurrentFlow(result.payload?.user)) {
                return;
            }
            await completeHandoff();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.totpSubmit.disabled = false;
        }
    }

    async function handleSetupSubmit(event) {
        event.preventDefault();
        if (!validateHandoffAudience()) {
            return;
        }
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
            showRecoveryCodes(result.payload.recoveryCodes);
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            nodes.setupSubmit.disabled = false;
        }
    }

    async function boot() {
        nodes.loginTab.addEventListener('click', () => setMode('login'));
        nodes.registerTab.addEventListener('click', () => setMode('register'));
        nodes.passwordForm.addEventListener('submit', handlePasswordSubmit);
        nodes.totpForm.addEventListener('submit', handleTotpSubmit);
        nodes.setupForm.addEventListener('submit', handleSetupSubmit);
        nodes.sessionConflictRestart.addEventListener('click', async () => {
            nodes.sessionConflictRestart.disabled = true;
            setStatus('Signing out of the current auth session...');
            try {
                await request('/api/auth/logout', { method: 'POST' });
            } finally {
                window.location.assign(getCurrentLoginPath());
            }
        });
        nodes.recoveryContinue.addEventListener('click', () => {
            completeHandoff().catch((error) => setStatus(error.message || 'Unable to complete auth handoff.', 'error'));
        });
        if (redirectGenericHandoffLogin()) {
            return;
        }
        await loadCsrf();
        await inspectCurrentUser();
    }

    boot().catch((error) => {
        setMode('login');
        setStatus(error.message || 'Auth page failed to initialize.', 'error');
    });
}());
