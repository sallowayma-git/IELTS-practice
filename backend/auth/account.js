(function() {
    const state = {
        csrfToken: '',
        user: null
    };

    const nodes = {
        profileName: document.getElementById('profile-name'),
        profileRole: document.getElementById('profile-role'),
        logoutButton: document.getElementById('logout-button'),
        usernameForm: document.getElementById('username-form'),
        usernameInput: document.getElementById('username-input'),
        usernamePassword: document.getElementById('username-password'),
        usernameStatus: document.getElementById('username-status'),
        passwordForm: document.getElementById('password-form'),
        currentPassword: document.getElementById('current-password'),
        newPassword: document.getElementById('new-password'),
        passwordStatus: document.getElementById('password-status'),
        totpStatus: document.getElementById('totp-status'),
        totpActions: document.getElementById('totp-actions')
    };

    function parseJson(text) {
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (_) {
            return null;
        }
    }

    function setStatus(node, message, kind) {
        node.textContent = message || '';
        node.classList.toggle('is-error', kind === 'error');
        node.classList.toggle('is-success', kind === 'success');
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
        if (payload?.csrfToken) {
            state.csrfToken = payload.csrfToken;
        }
        if (response.status === 401) {
            window.location.href = '/auth/login';
            throw new Error('Authentication required');
        }
        if (!response.ok) {
            throw new Error(payload?.error || `Request failed with ${response.status}`);
        }
        return payload || {};
    }

    async function loadCsrf() {
        const payload = await request('/api/auth/csrf', { csrf: false });
        if (!payload.csrfToken) {
            throw new Error('Unable to start a secure auth session.');
        }
        state.csrfToken = payload.csrfToken;
    }

    function renderUser(user) {
        state.user = user || null;
        nodes.profileName.textContent = user?.username || 'Not signed in';
        nodes.profileRole.textContent = user ? `Role: ${user.role || 'user'}` : 'Sign in required';
        nodes.usernameInput.value = user?.username || '';
    }

    async function loadUser() {
        const payload = await request('/api/auth/me', { csrf: false });
        renderUser(payload.user);
    }

    function normalizeQrDataUrl(value) {
        const text = String(value || '').trim();
        return /^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text) ? text : '';
    }

    async function loadTotpStatus() {
        nodes.totpActions.textContent = '';
        const payload = await request('/api/auth/totp/status', { csrf: false });
        const status = payload.status || { enabled: false };
        setStatus(
            nodes.totpStatus,
            status.enabled
                ? `TOTP enabled. Recovery codes remaining: ${status.recoveryCodesRemaining || 0}`
                : 'TOTP is not enabled.',
            status.enabled ? 'success' : null
        );
        if (status.enabled) {
            renderTotpEnabled();
        } else {
            renderTotpSetupButton();
        }
    }

    function renderTotpSetupButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Enable TOTP';
        button.addEventListener('click', () => startTotpSetup().catch((error) => setStatus(nodes.totpStatus, error.message, 'error')));
        nodes.totpActions.appendChild(button);
    }

    function renderTotpEnabled() {
        const box = document.createElement('form');
        box.className = 'totp-box';
        const passwordLabel = document.createElement('label');
        const passwordText = document.createElement('span');
        passwordText.textContent = 'Password';
        const passwordInput = document.createElement('input');
        passwordInput.id = 'totp-disable-password';
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'current-password';
        passwordInput.required = true;
        passwordLabel.append(passwordText, passwordInput);

        const tokenLabel = document.createElement('label');
        const tokenText = document.createElement('span');
        tokenText.textContent = 'TOTP code or recovery code';
        const tokenInput = document.createElement('input');
        tokenInput.id = 'totp-disable-token';
        tokenInput.inputMode = 'numeric';
        tokenInput.autocomplete = 'one-time-code';
        tokenInput.required = true;
        tokenLabel.append(tokenText, tokenInput);

        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Disable TOTP';
        box.append(passwordLabel, tokenLabel, submit);
        box.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const password = passwordInput.value;
                const token = tokenInput.value;
                await request('/api/auth/totp/disable', {
                    method: 'POST',
                    body: { password, token }
                });
                await loadTotpStatus();
            } catch (error) {
                setStatus(nodes.totpStatus, error.message, 'error');
            }
        });
        nodes.totpActions.appendChild(box);
    }

    async function startTotpSetup() {
        const payload = await request('/api/auth/totp/setup', { method: 'POST' });
        nodes.totpActions.textContent = '';
        const box = document.createElement('form');
        box.className = 'totp-box';
        const instructions = document.createElement('p');
        instructions.textContent = 'Scan the QR code, then enter the current code.';
        const qrCode = document.createElement('img');
        qrCode.alt = 'TOTP QR code';
        qrCode.src = normalizeQrDataUrl(payload.qrCodeDataUrl);
        const secret = document.createElement('code');
        secret.textContent = String(payload.secret || '');
        const tokenLabel = document.createElement('label');
        const tokenText = document.createElement('span');
        tokenText.textContent = 'TOTP code';
        const tokenInput = document.createElement('input');
        tokenInput.id = 'totp-setup-token';
        tokenInput.inputMode = 'numeric';
        tokenInput.autocomplete = 'one-time-code';
        tokenInput.required = true;
        tokenLabel.append(tokenText, tokenInput);
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Verify and enable';
        box.append(instructions, qrCode, secret, tokenLabel, submit);
        box.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const token = tokenInput.value;
                await request('/api/auth/totp/verify-setup', {
                    method: 'POST',
                    body: { token }
                });
                await loadTotpStatus();
            } catch (error) {
                setStatus(nodes.totpStatus, error.message, 'error');
            }
        });
        nodes.totpActions.appendChild(box);
    }

    async function init() {
        await loadCsrf();
        await loadUser();
        await loadTotpStatus();

        nodes.usernameForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            setStatus(nodes.usernameStatus, 'Updating...');
            try {
                const payload = await request('/api/auth/account/username', {
                    method: 'PATCH',
                    body: {
                        username: nodes.usernameInput.value,
                        password: nodes.usernamePassword.value
                    }
                });
                renderUser(payload.user);
                nodes.usernamePassword.value = '';
                setStatus(nodes.usernameStatus, 'Username updated.', 'success');
            } catch (error) {
                setStatus(nodes.usernameStatus, error.message, 'error');
            }
        });

        nodes.passwordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            setStatus(nodes.passwordStatus, 'Updating...');
            try {
                await request('/api/auth/account/password', {
                    method: 'PATCH',
                    body: {
                        currentPassword: nodes.currentPassword.value,
                        newPassword: nodes.newPassword.value
                    }
                });
                nodes.passwordForm.reset();
                setStatus(nodes.passwordStatus, 'Password updated.', 'success');
            } catch (error) {
                setStatus(nodes.passwordStatus, error.message, 'error');
            }
        });

        nodes.logoutButton.addEventListener('click', async () => {
            try {
                await request('/api/auth/logout', { method: 'POST' });
            } finally {
                window.location.href = '/auth/login';
            }
        });
    }

    init().catch((error) => setStatus(nodes.profileRole, error.message || 'Account page failed to initialize.', 'error'));
}());
