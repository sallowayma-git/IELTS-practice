(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    const gatedElements = new Map();
    const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{2,31}$/;
    const MAX_REMOTE_AUTH_ERROR_CHARS = 240;
    const MAX_BCRYPT_PASSWORD_BYTES = 72;

    function getImportMarkerKey(userId) {
        return `remote_import_completed:${userId}`;
    }

    function createImportMarkerStore(storage = window.localStorage) {
        return {
            async has(userId) {
                try {
                    return storage.getItem(getImportMarkerKey(userId)) === 'true';
                } catch (_) {
                    return false;
                }
            },
            async mark(userId) {
                try {
                    storage.setItem(getImportMarkerKey(userId), 'true');
                } catch (_) {
                    // localStorage may be disabled; import still succeeded remotely.
                }
            }
        };
    }

    function createElement(tag, className, text) {
        const element = window.document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    function getUtf8ByteLength(value) {
        const text = String(value || '');
        if (typeof window.TextEncoder === 'function') {
            return new window.TextEncoder().encode(text).length;
        }
        if (typeof window.Blob === 'function') {
            return new window.Blob([text]).size;
        }
        try {
            return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, 'x').length;
        } catch (_) {
            return text.length;
        }
    }

    function normalizeTotpQrDataUrl(value) {
        const text = String(value || '').trim();
        return /^data:image\/(?:png|gif|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(text) ? text : '';
    }

    function isAuthSurface(element) {
        return element.id === 'remote-auth-overlay'
            || element.classList.contains('remote-auth-account')
            || element.classList.contains('remote-auth-totp');
    }

    function setRemoteAuthGate(active) {
        const document = window.document;
        if (!document || !document.body) {
            return;
        }
        document.documentElement.classList.toggle('remote-auth-gated', Boolean(active));
        document.body.classList.toggle('remote-auth-gated', Boolean(active));

        Array.from(document.body.children).forEach((child) => {
            if (isAuthSurface(child)) {
                return;
            }
            if (active) {
                if (!gatedElements.has(child)) {
                    gatedElements.set(child, {
                        inert: child.inert,
                        ariaHidden: child.getAttribute('aria-hidden')
                    });
                }
                child.inert = true;
                child.setAttribute('aria-hidden', 'true');
                return;
            }
            const previous = gatedElements.get(child);
            if (previous) {
                child.inert = previous.inert;
                if (previous.ariaHidden === null) {
                    child.removeAttribute('aria-hidden');
                } else {
                    child.setAttribute('aria-hidden', previous.ariaHidden);
                }
                gatedElements.delete(child);
            } else {
                child.inert = false;
                child.removeAttribute('aria-hidden');
            }
        });

        if (!active) {
            gatedElements.clear();
        }
    }

    function validateRemoteAuthFields(username, password, mode) {
        const errors = [];
        const normalizedUsername = String(username || '').trim();
        const rawPassword = String(password || '');
        if (!USERNAME_PATTERN.test(normalizedUsername)) {
            errors.push('用户名需要 3-32 位，只能包含字母、数字、下划线或连字符。');
        }
        if (!rawPassword) {
            errors.push('请输入密码。');
        }
        if (mode === 'register') {
            if (rawPassword.length < 8) {
                errors.push('密码至少需要 8 个字符。');
            }
            if (getUtf8ByteLength(rawPassword) > MAX_BCRYPT_PASSWORD_BYTES) {
                errors.push('密码不能超过 72 个 UTF-8 字节。');
            }
            if (!/[a-z]/.test(rawPassword)) {
                errors.push('密码需要包含小写字母。');
            }
            if (!/[A-Z]/.test(rawPassword)) {
                errors.push('密码需要包含大写字母。');
            }
            if (!/[0-9]/.test(rawPassword)) {
                errors.push('密码需要包含数字。');
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            username: normalizedUsername
        };
    }

    function sanitizeRemoteAuthMessage(value, fallback = 'Authentication failed. Please retry.') {
        const text = String(value ?? fallback)
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const normalized = text || fallback;
        return normalized.length > MAX_REMOTE_AUTH_ERROR_CHARS
            ? `${normalized.slice(0, MAX_REMOTE_AUTH_ERROR_CHARS - 3)}...`
            : normalized;
    }

    function formatRemoteAuthError(error) {
        if (error && error.payload && Array.isArray(error.payload.details) && error.payload.details.length) {
            return sanitizeRemoteAuthMessage(error.payload.details.join('；'));
        }
        if (error && error.status === 429) {
            return '请求过于频繁，请稍后再试。';
        }
        if (error && error.status === 403) {
            return sanitizeRemoteAuthMessage(error.payload?.error, '当前操作被拒绝，请刷新后重试。');
        }
        return sanitizeRemoteAuthMessage(error?.payload?.error);
    }

    function normalizeCode(value) {
        return String(value || '').trim();
    }

    function formatTotpTime(value) {
        if (!value) {
            return '从未使用';
        }
        const date = new Date(value);
        if (Number.isNaN(Number(date))) {
            return '时间未知';
        }
        return date.toLocaleString();
    }

    function createRemoteAuthController(options = {}) {
        const apiClient = options.apiClient;
        const localDataSource = options.localDataSource;
        const markerStore = options.markerStore || createImportMarkerStore();
        const confirmImport = options.confirmImport || ((count) => window.confirm(`检测到本地有 ${count} 条练习记录，是否导入当前账号？`));
        const showMessage = options.showMessage || window.showMessage || function() {};
        let overlay = null;
        let account = null;
        let totpPanel = null;
        let accountFormsBound = false;
        let mode = 'login';
        let importPromptedInSession = false;
        let pendingRecoveryUser = null;
        let setOverlayMode = null;
        let clearOverlaySensitiveFields = null;

        function ensureUi() {
            if (overlay) {
                return;
            }

            overlay = createElement('div', 'remote-auth-overlay');
            overlay.id = 'remote-auth-overlay';
            overlay.hidden = true;

            const panel = createElement('section', 'remote-auth-panel');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('role', 'dialog');
            const title = createElement('h2', 'remote-auth-title', '登录 IELTS Atlas');
            const tabs = createElement('div', 'remote-auth-tabs');
            const loginTab = createElement('button', 'remote-auth-tab is-active', '登录');
            const registerTab = createElement('button', 'remote-auth-tab', '注册');
            loginTab.type = 'button';
            registerTab.type = 'button';
            tabs.append(loginTab, registerTab);

            const form = createElement('form', 'remote-auth-form');
            const usernameLabel = createElement('label', 'remote-auth-field');
            const usernameInput = createElement('input');
            usernameInput.name = 'username';
            usernameInput.autocomplete = 'username';
            usernameInput.required = true;
            usernameInput.minLength = 3;
            usernameInput.maxLength = 32;
            usernameInput.pattern = '[A-Za-z0-9_][A-Za-z0-9_-]{2,31}';
            usernameLabel.append(
                createElement('span', null, '用户名'),
                usernameInput,
                createElement('small', 'remote-auth-help', '3-32 位，支持字母、数字、下划线和连字符。')
            );

            const passwordLabel = createElement('label', 'remote-auth-field');
            const passwordInput = createElement('input');
            passwordInput.name = 'password';
            passwordInput.type = 'password';
            passwordInput.autocomplete = 'current-password';
            passwordInput.required = true;
            passwordLabel.append(
                createElement('span', null, '密码'),
                passwordInput,
                createElement('small', 'remote-auth-help', '请输入账号密码。')
            );

            const tokenLabel = createElement('label', 'remote-auth-field remote-auth-token-field');
            const tokenInput = createElement('input');
            tokenInput.name = 'totpToken';
            tokenInput.inputMode = 'numeric';
            tokenInput.autocomplete = 'one-time-code';
            tokenInput.maxLength = 32;
            tokenLabel.append(
                createElement('span', null, '验证码或恢复码'),
                tokenInput,
                createElement('small', 'remote-auth-help', '输入认证器中的 6 位验证码，也可输入恢复码。')
            );

            const setupBox = createElement('div', 'remote-auth-setup');
            const setupIntro = createElement('p', null, '管理员账号需要先绑定 TOTP。请用认证器扫描二维码，或手动输入密钥。');
            const setupQr = createElement('img', 'remote-auth-setup__qr');
            setupQr.alt = 'TOTP QR code';
            const setupSecret = createElement('code', 'remote-auth-setup__secret');
            setupBox.append(setupIntro, setupQr, setupSecret);

            const recoveryBox = createElement('div', 'remote-auth-recovery');
            const recoveryIntro = createElement('p', null, '请保存这些一次性恢复码。离开后不会再次显示。');
            const recoveryList = createElement('ol', 'remote-auth-recovery__list');
            const recoveryConfirm = createElement('button', 'remote-auth-recovery__confirm', '我已保存，继续');
            recoveryConfirm.type = 'button';
            recoveryBox.append(recoveryIntro, recoveryList, recoveryConfirm);

            const error = createElement('div', 'remote-auth-error');
            error.hidden = true;
            const submit = createElement('button', 'remote-auth-submit', '登录');
            submit.type = 'submit';

            form.append(usernameLabel, passwordLabel, setupBox, tokenLabel, recoveryBox, error, submit);
            panel.append(title, tabs, form);
            overlay.append(panel);
            window.document.body.appendChild(overlay);

            account = createElement('div', 'remote-auth-account');
            account.hidden = true;
            const accountToggle = createElement('button', 'remote-auth-account__trigger');
            accountToggle.type = 'button';
            accountToggle.setAttribute('aria-haspopup', 'menu');
            accountToggle.setAttribute('aria-expanded', 'false');
            accountToggle.setAttribute('aria-label', 'User menu');
            accountToggle.title = 'User menu';
            const accountAvatar = createElement('span', 'remote-auth-account__avatar', 'U');
            accountAvatar.setAttribute('aria-hidden', 'true');
            const accountIdentity = createElement('span', 'remote-auth-account__identity');
            const accountName = createElement('span', 'remote-auth-account__name');
            const accountRole = createElement('span', 'remote-auth-account__role', 'User');
            const accountChevron = createElement('span', 'remote-auth-account__chevron', 'v');
            accountChevron.setAttribute('aria-hidden', 'true');
            accountIdentity.append(accountName, accountRole);
            accountToggle.append(accountAvatar, accountIdentity, accountChevron);

            const accountMenu = createElement('div', 'remote-auth-account__menu');
            accountMenu.hidden = true;
            accountMenu.setAttribute('role', 'menu');
            const menuHead = createElement('div', 'remote-auth-account__menu-head');
            menuHead.setAttribute('role', 'presentation');
            const menuAvatar = createElement('span', 'remote-auth-account__menu-avatar', 'U');
            menuAvatar.setAttribute('aria-hidden', 'true');
            const menuIdentity = createElement('span', 'remote-auth-account__menu-identity');
            const menuName = createElement('strong', 'remote-auth-account__menu-name');
            const menuRole = createElement('span', 'remote-auth-account__menu-role', 'User');
            menuIdentity.append(menuName, menuRole);
            menuHead.append(menuAvatar, menuIdentity);

            function createAccountMenuItem(tag, className, titleText, descriptionText) {
                const item = createElement(tag, className);
                const text = createElement('span', 'remote-auth-account__menu-text');
                text.append(
                    createElement('span', 'remote-auth-account__menu-title', titleText),
                    createElement('span', 'remote-auth-account__menu-desc', descriptionText)
                );
                item.append(text);
                return item;
            }

            const accountHome = createAccountMenuItem('button', 'remote-auth-account__menu-item remote-auth-account__home', '账户', '查看学习数据和账户状态');
            accountHome.type = 'button';
            accountHome.setAttribute('role', 'menuitem');
            const practice = createAccountMenuItem('button', 'remote-auth-account__menu-item remote-auth-account__practice', '练习记录', '进入历史记录与统计视图');
            practice.type = 'button';
            practice.setAttribute('role', 'menuitem');
            const settings = createAccountMenuItem('button', 'remote-auth-account__menu-item remote-auth-account__settings', '设置', '管理题库、数据备份和安全');
            settings.type = 'button';
            settings.setAttribute('role', 'menuitem');
            const settingsTotp = window.document.getElementById('settings-totp-btn');
            const logout = createAccountMenuItem('button', 'remote-auth-account__menu-item remote-auth-account__logout', '退出', '结束当前登录会话');
            logout.type = 'button';
            logout.setAttribute('role', 'menuitem');
            accountMenu.append(menuHead, accountHome, practice, settings, logout);
            account.append(accountToggle, accountMenu);
            const accountHost = window.document.querySelector('.hero-header__actions') || window.document.body;
            accountHost.appendChild(account);

            totpPanel = createElement('section', 'remote-auth-totp');
            totpPanel.hidden = true;
            window.document.body.appendChild(totpPanel);

            function setError(message) {
                error.textContent = message || '';
                error.hidden = !message;
            }

            clearOverlaySensitiveFields = function (options = {}) {
                if (!options.keepUsername) {
                    usernameInput.value = '';
                }
                if (!options.keepPassword) {
                    passwordInput.value = '';
                }
                if (!options.keepToken) {
                    tokenInput.value = '';
                }
                if (!options.keepSetup) {
                    setupQr.removeAttribute('src');
                    setupSecret.textContent = '';
                }
                if (!options.keepRecovery) {
                    recoveryList.textContent = '';
                    pendingRecoveryUser = null;
                }
                usernameInput.setAttribute('aria-invalid', 'false');
                passwordInput.setAttribute('aria-invalid', 'false');
                tokenInput.setAttribute('aria-invalid', 'false');
                setError('');
            };

            function setMode(nextMode) {
                if (nextMode === 'login' || nextMode === 'register') {
                    clearOverlaySensitiveFields({ keepUsername: true });
                } else if (nextMode === 'totp') {
                    clearOverlaySensitiveFields({ keepUsername: true });
                } else if (nextMode === 'setup') {
                    clearOverlaySensitiveFields({ keepUsername: true, keepSetup: true });
                } else if (nextMode === 'recovery') {
                    clearOverlaySensitiveFields({ keepUsername: true, keepRecovery: true });
                }
                mode = nextMode;
                const isPasswordMode = mode === 'login' || mode === 'register';
                const isTokenMode = mode === 'totp' || mode === 'setup';
                const isSetupMode = mode === 'setup';
                const isRecoveryMode = mode === 'recovery';

                tabs.hidden = !isPasswordMode;
                usernameLabel.hidden = !isPasswordMode;
                passwordLabel.hidden = !isPasswordMode;
                tokenLabel.hidden = !isTokenMode;
                setupBox.hidden = !isSetupMode;
                recoveryBox.hidden = !isRecoveryMode;
                submit.hidden = isRecoveryMode;
                loginTab.classList.toggle('is-active', mode === 'login');
                registerTab.classList.toggle('is-active', mode === 'register');
                title.textContent = {
                    login: '登录 IELTS Atlas',
                    register: '注册 IELTS Atlas',
                    totp: '输入 TOTP 验证码',
                    setup: '绑定 TOTP 二次验证',
                    recovery: '保存恢复码'
                }[mode] || '登录 IELTS Atlas';
                submit.textContent = {
                    login: '登录',
                    register: '注册',
                    totp: '验证并登录',
                    setup: '验证并启用'
                }[mode] || '继续';
                passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
                passwordInput.minLength = mode === 'login' ? 1 : 8;
            }
            setOverlayMode = setMode;

            async function submitPasswordAuth() {
                const validation = validateRemoteAuthFields(usernameInput.value, passwordInput.value, mode);
                usernameInput.setAttribute('aria-invalid', validation.errors.some((message) => message.startsWith('用户名')) ? 'true' : 'false');
                passwordInput.setAttribute('aria-invalid', validation.errors.some((message) => message.startsWith('密码') || message.startsWith('请输入密码')) ? 'true' : 'false');
                if (!validation.valid) {
                    setError(validation.errors.join('；'));
                    return;
                }
                const payload = mode === 'login'
                    ? await apiClient.login(validation.username, passwordInput.value)
                    : await apiClient.register(validation.username, passwordInput.value);

                if (payload.requiresTotp) {
                    setMode('totp');
                    tokenInput.value = '';
                    window.setTimeout(() => tokenInput.focus({ preventScroll: true }), 0);
                    return;
                }
                if (payload.requiresTotpSetup) {
                    await beginOverlayTotpSetup();
                    return;
                }
                await handleAuthenticated(payload.user);
                showMessage(mode === 'login' ? '登录成功' : '注册成功', 'success');
            }

            async function submitTotpToken() {
                const token = normalizeCode(tokenInput.value);
                if (!token) {
                    tokenInput.setAttribute('aria-invalid', 'true');
                    setError('请输入验证码或恢复码。');
                    return;
                }
                if (mode === 'totp') {
                    const payload = await apiClient.completeTotpLogin(token);
                    await handleAuthenticated(payload.user);
                    showMessage('登录成功', 'success');
                    return;
                }
                if (mode === 'setup') {
                    const payload = await apiClient.verifyTotpSetup(token);
                    renderOverlayRecoveryCodes(payload.recoveryCodes || [], payload.user);
                }
            }

            async function beginOverlayTotpSetup() {
                const setup = await apiClient.startTotpSetup();
                setupQr.src = normalizeTotpQrDataUrl(setup.qrCodeDataUrl);
                setupSecret.textContent = setup.secret || '';
                tokenInput.value = '';
                setMode('setup');
                window.setTimeout(() => tokenInput.focus({ preventScroll: true }), 0);
            }

            function renderOverlayRecoveryCodes(codes, user) {
                pendingRecoveryUser = user;
                recoveryList.textContent = '';
                codes.forEach((code) => {
                    const item = createElement('li', null, code);
                    recoveryList.append(item);
                });
                setMode('recovery');
            }

            recoveryConfirm.addEventListener('click', async () => {
                await handleAuthenticated(pendingRecoveryUser || apiClient.user);
                pendingRecoveryUser = null;
                showMessage('TOTP 已启用', 'success');
            });

            setMode('login');
            loginTab.addEventListener('click', () => setMode('login'));
            registerTab.addEventListener('click', () => setMode('register'));

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                submit.disabled = true;
                setError('');
                try {
                    if (mode === 'login' || mode === 'register') {
                        await submitPasswordAuth();
                    } else {
                        await submitTotpToken();
                    }
                } catch (requestError) {
                    setError(formatRemoteAuthError(requestError));
                } finally {
                    submit.disabled = false;
                    if (mode !== 'recovery') {
                        submit.textContent = {
                            login: '登录',
                            register: '注册',
                            totp: '验证并登录',
                            setup: '验证并启用'
                        }[mode] || '继续';
                    }
                }
            });

            logout.addEventListener('click', async () => {
                logout.disabled = true;
                try {
                    setAccountMenuOpen(false);
                    await apiClient.logout();
                    updateAccount(null);
                    hideTotpPanel();
                    window.dispatchEvent(new CustomEvent('remote-auth-changed', { detail: { user: null } }));
                    const returnTo = getCurrentReturnTo();
                    window.location.href = `/auth/business/logout?return_to=${encodeURIComponent(returnTo)}`;
                } catch (requestError) {
                    showMessage(formatRemoteAuthError(requestError), 'error');
                } finally {
                    logout.disabled = false;
                }
            });

            if (settingsTotp) {
                settingsTotp.addEventListener('click', async () => {
                    if (totpPanel.hidden) {
                        totpPanel.hidden = false;
                        await loadTotpPanel();
                    } else {
                        hideTotpPanel();
                    }
                });
            }

            accountToggle.addEventListener('click', (event) => {
                event.stopPropagation();
                setAccountMenuOpen(!account.classList.contains('is-open'));
            });

            accountHome.addEventListener('click', () => {
                setAccountMenuOpen(false);
                syncAccountStats();
                if (typeof window.showView === 'function') {
                    window.showView('account');
                    return;
                }
                const accountView = window.document.getElementById('account-view');
                if (accountView) {
                    window.document.querySelectorAll('.view.active').forEach((view) => view.classList.remove('active'));
                    accountView.classList.add('active');
                }
            });

            practice.addEventListener('click', () => {
                setAccountMenuOpen(false);
                if (typeof window.showView === 'function') {
                    window.showView('practice');
                    return;
                }
                const practiceView = window.document.getElementById('practice-view');
                if (practiceView) {
                    window.document.querySelectorAll('.view.active').forEach((view) => view.classList.remove('active'));
                    practiceView.classList.add('active');
                }
            });

            settings.addEventListener('click', () => {
                setAccountMenuOpen(false);
                if (typeof window.showView === 'function') {
                    window.showView('settings');
                    return;
                }
                const settingsView = window.document.getElementById('settings-view');
                if (settingsView) {
                    window.document.querySelectorAll('.view.active').forEach((view) => view.classList.remove('active'));
                    settingsView.classList.add('active');
                }
            });

            window.document.addEventListener('click', (event) => {
                if (account && !account.hidden && !account.contains(event.target)) {
                    setAccountMenuOpen(false);
                }
            });

            window.document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    setAccountMenuOpen(false);
                }
            });

            bindAccountForms();

            window.addEventListener('storage-sync', syncAccountStats);
            window.addEventListener('remote-auth-changed', syncAccountStats);
        }

        function setAccountFormStatus(node, message, type) {
            if (!node) {
                return;
            }
            node.textContent = message || '';
            node.classList.toggle('is-error', type === 'error');
            node.classList.toggle('is-success', type === 'success');
        }

        function setFormBusy(form, busy) {
            if (!form) {
                return;
            }
            Array.from(form.querySelectorAll('button, input')).forEach((element) => {
                element.disabled = Boolean(busy);
            });
        }

        function bindAccountForms() {
            if (accountFormsBound) {
                return;
            }
            const management = window.document.getElementById('account-management');
            const usernameForm = window.document.getElementById('account-username-form');
            const passwordForm = window.document.getElementById('account-password-form');
            const deleteForm = window.document.getElementById('account-delete-form');
            if (!usernameForm && !passwordForm && !deleteForm) {
                return;
            }
            accountFormsBound = true;
            if (management) {
                management.innerHTML = [
                    '<h3 class="account-view__section-title">Account Management</h3>',
                    '<p class="account-view__form-status">Security settings are managed in the dedicated auth portal.</p>',
                    '<a class="btn hero-btn" href="/auth/business/account">Open auth account center</a>'
                ].join('');
                return;
            }

            if (usernameForm) {
                usernameForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const username = window.document.getElementById('account-username-input')?.value || '';
                    const password = window.document.getElementById('account-username-password')?.value || '';
                    const status = window.document.getElementById('account-username-status');
                    const normalizedUsername = String(username).trim();
                    if (!USERNAME_PATTERN.test(normalizedUsername)) {
                        setAccountFormStatus(status, 'Use 3-32 letters, numbers, "_" or "-".', 'error');
                        return;
                    }
                    if (!password) {
                        setAccountFormStatus(status, 'Current password is required.', 'error');
                        return;
                    }
                    setFormBusy(usernameForm, true);
                    setAccountFormStatus(status, 'Saving...', null);
                    try {
                        const payload = await apiClient.updateUsername(normalizedUsername, password);
                        updateAccount(payload.user || apiClient.user);
                        window.document.getElementById('account-username-password').value = '';
                        window.dispatchEvent(new CustomEvent('remote-auth-changed', { detail: { user: payload.user || apiClient.user } }));
                        setAccountFormStatus(status, 'Username updated.', 'success');
                        showMessage('Username updated', 'success');
                    } catch (requestError) {
                        setAccountFormStatus(status, formatRemoteAuthError(requestError), 'error');
                    } finally {
                        setFormBusy(usernameForm, false);
                    }
                });
            }

            if (passwordForm) {
                passwordForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const currentPassword = window.document.getElementById('account-current-password')?.value || '';
                    const newPassword = window.document.getElementById('account-new-password')?.value || '';
                    const confirmPassword = window.document.getElementById('account-confirm-password')?.value || '';
                    const status = window.document.getElementById('account-password-status');
                    if (!currentPassword || !newPassword) {
                        setAccountFormStatus(status, 'Current and new passwords are required.', 'error');
                        return;
                    }
                    if (newPassword !== confirmPassword) {
                        setAccountFormStatus(status, 'New password confirmation does not match.', 'error');
                        return;
                    }
                    setFormBusy(passwordForm, true);
                    setAccountFormStatus(status, 'Updating...', null);
                    try {
                        const payload = await apiClient.updatePassword(currentPassword, newPassword);
                        updateAccount(payload.user || apiClient.user);
                        passwordForm.reset();
                        setAccountFormStatus(status, 'Password updated.', 'success');
                        showMessage('Password updated', 'success');
                    } catch (requestError) {
                        setAccountFormStatus(status, formatRemoteAuthError(requestError), 'error');
                    } finally {
                        setFormBusy(passwordForm, false);
                    }
                });
            }

            if (deleteForm) {
                deleteForm.addEventListener('submit', async (event) => {
                    event.preventDefault();
                    const password = window.document.getElementById('account-delete-password')?.value || '';
                    const confirm = window.document.getElementById('account-delete-confirm')?.value || '';
                    const status = window.document.getElementById('account-delete-status');
                    const username = apiClient.user?.username || '';
                    if (!password || !confirm) {
                        setAccountFormStatus(status, 'Password and username confirmation are required.', 'error');
                        return;
                    }
                    if (confirm !== username) {
                        setAccountFormStatus(status, 'Type your current username exactly.', 'error');
                        return;
                    }
                    if (!window.confirm('Delete this account and all server-side practice records? This cannot be undone.')) {
                        return;
                    }
                    setFormBusy(deleteForm, true);
                    setAccountFormStatus(status, 'Deleting...', null);
                    try {
                        await apiClient.deleteAccount(password, confirm);
                        deleteForm.reset();
                        updateAccount(null);
                        hideTotpPanel();
                        window.dispatchEvent(new CustomEvent('remote-auth-changed', { detail: { user: null } }));
                        show();
                        showMessage('Account deleted', 'success');
                    } catch (requestError) {
                        setAccountFormStatus(status, formatRemoteAuthError(requestError), 'error');
                    } finally {
                        setFormBusy(deleteForm, false);
                    }
                });
            }
        }

        function getCurrentReturnTo() {
            const returnTo = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
            if (/^/(?:auth|admin|api/admin)(?:/|$)/i.test(returnTo)) {
                return '/';
            }
            return returnTo || '/';
        }

        function show() {
            const returnTo = getCurrentReturnTo();
            window.location.href = `/auth/business/start?return_to=${encodeURIComponent(returnTo)}`;
        }

        function hide() {
            ensureUi();
            if (typeof clearOverlaySensitiveFields === 'function') {
                clearOverlaySensitiveFields();
            }
            overlay.hidden = true;
            setRemoteAuthGate(false);
        }

        function hideTotpPanel() {
            if (totpPanel) {
                totpPanel.hidden = true;
                totpPanel.textContent = '';
            }
        }

        function getAccountInitial(username) {
            const normalized = String(username || '').trim();
            return normalized ? normalized.charAt(0).toUpperCase() : 'U';
        }

        function setAccountMenuOpen(open) {
            if (!account || account.hidden) {
                return;
            }
            const menu = account.querySelector('.remote-auth-account__menu');
            const trigger = account.querySelector('.remote-auth-account__trigger');
            if (!menu || !trigger) {
                return;
            }
            const nextOpen = Boolean(open);
            menu.hidden = !nextOpen;
            account.classList.toggle('is-open', nextOpen);
            trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
            if (nextOpen) {
                syncAccountStats();
            }
        }

        function syncAccountStats() {
            if (!account || account.hidden) {
                return;
            }
            const statMap = {
                'account-total-practiced': 'total-practiced',
                'account-avg-score': 'avg-score',
                'account-study-time': 'study-time',
                'account-streak-days': 'streak-days'
            };
            Object.entries(statMap).forEach(([targetId, sourceId]) => {
                const valueNode = window.document.getElementById(targetId);
                const sourceNode = window.document.getElementById(sourceId);
                if (valueNode && sourceNode) {
                    valueNode.textContent = sourceNode.textContent.trim() || valueNode.textContent;
                }
            });
        }

        function updateAccount(user) {
            ensureUi();
            const name = account.querySelector('.remote-auth-account__name');
            const role = account.querySelector('.remote-auth-account__role');
            const avatar = account.querySelector('.remote-auth-account__avatar');
            const menuName = account.querySelector('.remote-auth-account__menu-name');
            const menuRole = account.querySelector('.remote-auth-account__menu-role');
            const menuAvatar = account.querySelector('.remote-auth-account__menu-avatar');
            const settingsTotp = window.document.getElementById('settings-totp-btn');
            const profileName = window.document.getElementById('account-profile-name');
            const profileRole = window.document.getElementById('account-profile-role');
            const profileAvatar = window.document.getElementById('account-profile-avatar');
            const usernameInput = window.document.getElementById('account-username-input');
            const usernamePassword = window.document.getElementById('account-username-password');
            const passwordForm = window.document.getElementById('account-password-form');
            const deleteForm = window.document.getElementById('account-delete-form');
            if (user && user.username) {
                const displayRole = user.role === 'admin' ? 'Admin' : 'User';
                const initial = getAccountInitial(user.username);
                name.textContent = user.username;
                if (role) {
                    role.textContent = displayRole;
                }
                if (avatar) {
                    avatar.textContent = initial;
                }
                if (menuName) {
                    menuName.textContent = user.username;
                }
                if (menuRole) {
                    menuRole.textContent = displayRole;
                }
                if (menuAvatar) {
                    menuAvatar.textContent = initial;
                }
                if (profileName) {
                    profileName.textContent = user.username;
                }
                if (profileRole) {
                    profileRole.textContent = displayRole;
                }
                if (profileAvatar) {
                    profileAvatar.textContent = initial;
                }
                if (settingsTotp) {
                    settingsTotp.hidden = false;
                }
                if (usernameInput) {
                    usernameInput.value = user.username;
                }
                if (usernamePassword) {
                    usernamePassword.value = '';
                }
                account.hidden = false;
                syncAccountStats();
            } else {
                name.textContent = '';
                if (role) {
                    role.textContent = '';
                }
                if (avatar) {
                    avatar.textContent = 'U';
                }
                if (menuName) {
                    menuName.textContent = '';
                }
                if (menuRole) {
                    menuRole.textContent = '';
                }
                if (menuAvatar) {
                    menuAvatar.textContent = 'U';
                }
                if (profileName) {
                    profileName.textContent = '\u672a\u767b\u5f55';
                }
                if (profileRole) {
                    profileRole.textContent = 'User';
                }
                if (profileAvatar) {
                    profileAvatar.textContent = 'U';
                }
                if (settingsTotp) {
                    settingsTotp.hidden = true;
                }
                if (usernameInput) {
                    usernameInput.value = '';
                }
                if (usernamePassword) {
                    usernamePassword.value = '';
                }
                if (passwordForm) {
                    passwordForm.reset();
                }
                if (deleteForm) {
                    deleteForm.reset();
                }
                ['account-username-status', 'account-password-status', 'account-delete-status'].forEach((id) => {
                    setAccountFormStatus(window.document.getElementById(id), '', null);
                });
                setAccountMenuOpen(false);
                account.hidden = true;
            }
        }

        function renderRecoveryCodes(container, codes) {
            const list = createElement('ol', 'remote-auth-recovery__list');
            codes.forEach((code) => list.append(createElement('li', null, code)));
            container.append(
                createElement('p', 'remote-auth-totp__note', '请保存这些恢复码。它们只会显示一次。'),
                list
            );
        }

        function renderTotpActionForm(statusNode, body, options = {}) {
            body.textContent = '';
            const form = createElement('form', 'remote-auth-totp__form');
            const note = createElement('p', 'remote-auth-totp__note', options.note || '');
            const error = createElement('div', 'remote-auth-error');
            error.hidden = true;

            form.append(note);
            let passwordInput = null;
            if (options.requirePassword) {
                const passwordLabel = createElement('label', 'remote-auth-field');
                passwordInput = createElement('input');
                passwordInput.type = 'password';
                passwordInput.autocomplete = 'current-password';
                passwordInput.required = true;
                passwordLabel.append(createElement('span', null, '当前密码'), passwordInput);
                form.append(passwordLabel);
            }

            const tokenLabel = createElement('label', 'remote-auth-field');
            const tokenInput = createElement('input');
            tokenInput.type = 'text';
            tokenInput.inputMode = 'numeric';
            tokenInput.autocomplete = 'one-time-code';
            tokenInput.maxLength = 64;
            tokenInput.required = true;
            tokenLabel.append(createElement('span', null, 'TOTP 验证码或恢复码'), tokenInput);

            const actions = createElement('div', 'remote-auth-totp__actions');
            const submit = createElement('button', 'remote-auth-totp__primary', options.submitLabel || '确认');
            submit.type = 'submit';
            const cancel = createElement('button', 'remote-auth-totp__secondary', '取消');
            cancel.type = 'button';
            cancel.addEventListener('click', () => {
                if (typeof options.onCancel === 'function') {
                    options.onCancel();
                }
            });
            actions.append(submit, cancel);

            form.append(tokenLabel, error, actions);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const token = normalizeCode(tokenInput.value);
                const password = passwordInput ? passwordInput.value : '';
                if (options.requirePassword && !password) {
                    error.textContent = '请输入当前密码。';
                    error.hidden = false;
                    passwordInput.focus();
                    return;
                }
                if (!token) {
                    error.textContent = '请输入 TOTP 验证码或恢复码。';
                    error.hidden = false;
                    tokenInput.focus();
                    return;
                }
                error.hidden = true;
                submit.disabled = true;
                cancel.disabled = true;
                try {
                    await options.onSubmit({ password, token });
                } catch (requestError) {
                    const message = formatRemoteAuthError(requestError);
                    error.textContent = message;
                    error.hidden = false;
                    statusNode.textContent = message;
                } finally {
                    submit.disabled = false;
                    cancel.disabled = false;
                }
            });

            body.append(form);
            window.setTimeout(() => {
                const firstInput = passwordInput || tokenInput;
                firstInput.focus({ preventScroll: true });
            }, 0);
        }

        async function loadTotpPanel() {
            if (!totpPanel) {
                return;
            }
            totpPanel.textContent = '';
            const head = createElement('div', 'remote-auth-totp__head');
            head.append(createElement('h3', null, 'TOTP 二次验证'));
            const close = createElement('button', 'remote-auth-totp__close', '×');
            close.type = 'button';
            close.setAttribute('aria-label', '关闭');
            close.addEventListener('click', hideTotpPanel);
            head.append(close);
            const status = createElement('div', 'remote-auth-totp__status', '正在加载...');
            const body = createElement('div', 'remote-auth-totp__body');
            totpPanel.append(head, status, body);
            try {
                const payload = await apiClient.getTotpStatus();
                renderTotpStatus(payload, status, body);
            } catch (requestError) {
                status.textContent = formatRemoteAuthError(requestError);
            }
        }

        function renderTotpStatus(status, statusNode, body) {
            body.textContent = '';
            if (status.enabled) {
                statusNode.textContent = `已启用，剩余恢复码 ${status.recoveryCodesRemaining || 0} 个，上次使用：${formatTotpTime(status.lastUsedAt)}`;
                const regenerate = createElement('button', 'remote-auth-totp__primary', '重新生成恢复码');
                const disable = createElement('button', 'remote-auth-totp__danger', '关闭 TOTP');
                regenerate.type = 'button';
                disable.type = 'button';
                regenerate.addEventListener('click', () => {
                    renderTotpActionForm(statusNode, body, {
                        note: '输入验证器验证码或恢复码后，将生成一组新的恢复码。旧恢复码会立即失效。',
                        submitLabel: '重新生成恢复码',
                        onCancel: () => renderTotpStatus(status, statusNode, body),
                        onSubmit: async ({ token }) => {
                            const result = await apiClient.regenerateTotpRecoveryCodes(token);
                            body.textContent = '';
                            renderRecoveryCodes(body, result.recoveryCodes || []);
                            statusNode.textContent = `已重新生成恢复码，剩余 ${result.status?.recoveryCodesRemaining || 0} 个。`;
                        }
                    });
                });
                disable.addEventListener('click', () => {
                    if (apiClient.user?.role === 'admin') {
                        statusNode.textContent = '管理员不能在这里关闭 TOTP。';
                        return;
                    }
                    renderTotpActionForm(statusNode, body, {
                        requirePassword: true,
                        note: '关闭 TOTP 需要同时确认当前密码和验证码。',
                        submitLabel: '关闭 TOTP',
                        onCancel: () => renderTotpStatus(status, statusNode, body),
                        onSubmit: async ({ password, token }) => {
                            const result = await apiClient.disableTotp(password, token);
                            renderTotpStatus(result, statusNode, body);
                            showMessage('TOTP 已关闭', 'success');
                        }
                    });
                });
                body.append(regenerate, disable);
                return;
            }

            statusNode.textContent = '未启用。启用后，登录需要输入认证器验证码。';
            const enable = createElement('button', 'remote-auth-totp__primary', '启用 TOTP');
            enable.type = 'button';
            enable.addEventListener('click', async () => {
                enable.disabled = true;
                try {
                    const setup = await apiClient.startTotpSetup();
                    renderAccountTotpSetup(setup, statusNode, body);
                } catch (requestError) {
                    statusNode.textContent = formatRemoteAuthError(requestError);
                } finally {
                    enable.disabled = false;
                }
            });
            body.append(enable);
        }

        function renderAccountTotpSetup(setup, statusNode, body) {
            body.textContent = '';
            statusNode.textContent = '扫描二维码后输入 6 位验证码完成绑定。';
            const qr = createElement('img', 'remote-auth-totp__qr');
            qr.alt = 'TOTP QR code';
            qr.src = normalizeTotpQrDataUrl(setup.qrCodeDataUrl);
            const secret = createElement('code', 'remote-auth-totp__secret', setup.secret || '');
            const token = createElement('input', 'remote-auth-totp__input');
            token.inputMode = 'numeric';
            token.autocomplete = 'one-time-code';
            token.placeholder = '验证码';
            const verify = createElement('button', 'remote-auth-totp__primary', '验证并启用');
            verify.type = 'button';
            verify.addEventListener('click', async () => {
                verify.disabled = true;
                try {
                    const result = await apiClient.verifyTotpSetup(token.value);
                    body.textContent = '';
                    renderRecoveryCodes(body, result.recoveryCodes || []);
                    statusNode.textContent = 'TOTP 已启用。';
                    updateAccount(result.user || apiClient.user);
                } catch (requestError) {
                    statusNode.textContent = formatRemoteAuthError(requestError);
                } finally {
                    verify.disabled = false;
                }
            });
            body.append(qr, secret, token, verify);
            window.setTimeout(() => token.focus({ preventScroll: true }), 0);
        }

        async function maybeImportLocalRecords(user) {
            if (!user || !user.id || importPromptedInSession) {
                return;
            }
            importPromptedInSession = true;
            const completed = await markerStore.has(user.id);
            if (completed || !localDataSource || typeof localDataSource.read !== 'function') {
                return;
            }
            const localRecords = await localDataSource.read('practice_records', []);
            if (!Array.isArray(localRecords) || localRecords.length === 0) {
                return;
            }
            if (!confirmImport(localRecords.length)) {
                return;
            }
            const records = await apiClient.importPracticeRecords(localRecords);
            if (typeof localDataSource.write === 'function') {
                await localDataSource.write('practice_records', records);
            }
            await markerStore.mark(user.id);
            window.dispatchEvent(new CustomEvent('storage-sync', { detail: { key: 'practice_records' } }));
        }

        async function handleAuthenticated(user) {
            hide();
            updateAccount(user);
            await maybeImportLocalRecords(user);
            window.dispatchEvent(new CustomEvent('remote-auth-changed', { detail: { user } }));
        }

        return {
            show,
            hide,
            updateAccount,
            handleAuthenticated,
            loadTotpPanel
        };
    }

    ExamData.createRemoteAuthController = createRemoteAuthController;
    ExamData.createRemoteImportMarkerStore = createImportMarkerStore;
    ExamData.formatRemoteAuthError = formatRemoteAuthError;
    ExamData.getRemoteImportMarkerKey = getImportMarkerKey;
    ExamData.setRemoteAuthGate = setRemoteAuthGate;
    ExamData.validateRemoteAuthFields = validateRemoteAuthFields;
})(window);
