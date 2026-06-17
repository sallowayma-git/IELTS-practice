(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

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

    function createRemoteAuthController(options = {}) {
        const apiClient = options.apiClient;
        const localDataSource = options.localDataSource;
        const markerStore = options.markerStore || createImportMarkerStore();
        const confirmImport = options.confirmImport || ((count) => window.confirm(`检测到本地有 ${count} 条练习记录，是否导入当前账号？`));
        const showMessage = options.showMessage || window.showMessage || function() {};
        let overlay = null;
        let account = null;
        let mode = 'login';
        let importPromptedInSession = false;

        function ensureUi() {
            if (overlay) {
                return;
            }

            overlay = createElement('div', 'remote-auth-overlay');
            overlay.id = 'remote-auth-overlay';
            overlay.hidden = true;

            const panel = createElement('section', 'remote-auth-panel');
            const title = createElement('h2', 'remote-auth-title', '登录 IELTS Atlas');
            const tabs = createElement('div', 'remote-auth-tabs');
            const loginTab = createElement('button', 'remote-auth-tab is-active', '登录');
            const registerTab = createElement('button', 'remote-auth-tab', '注册');
            loginTab.type = 'button';
            registerTab.type = 'button';
            tabs.append(loginTab, registerTab);

            const form = createElement('form', 'remote-auth-form');
            const usernameLabel = createElement('label', 'remote-auth-field');
            const usernameText = createElement('span', null, '用户名');
            const usernameInput = createElement('input');
            usernameInput.name = 'username';
            usernameInput.autocomplete = 'username';
            usernameInput.required = true;
            usernameInput.minLength = 3;
            usernameInput.maxLength = 32;
            usernameLabel.append(usernameText, usernameInput);

            const passwordLabel = createElement('label', 'remote-auth-field');
            const passwordText = createElement('span', null, '密码');
            const passwordInput = createElement('input');
            passwordInput.name = 'password';
            passwordInput.type = 'password';
            passwordInput.autocomplete = 'current-password';
            passwordInput.required = true;
            passwordInput.minLength = 8;
            passwordLabel.append(passwordText, passwordInput);

            const error = createElement('div', 'remote-auth-error');
            error.hidden = true;
            const submit = createElement('button', 'remote-auth-submit', '登录');
            submit.type = 'submit';

            form.append(usernameLabel, passwordLabel, error, submit);
            panel.append(title, tabs, form);
            overlay.append(panel);
            window.document.body.appendChild(overlay);

            account = createElement('div', 'remote-auth-account');
            account.hidden = true;
            const accountName = createElement('span', 'remote-auth-account__name');
            const adminLink = createElement('a', 'remote-auth-account__admin', 'Admin');
            adminLink.href = '/admin';
            adminLink.hidden = true;
            const logout = createElement('button', 'remote-auth-account__logout', '退出');
            logout.type = 'button';
            account.append(accountName, adminLink, logout);
            window.document.body.appendChild(account);

            function setMode(nextMode) {
                mode = nextMode;
                loginTab.classList.toggle('is-active', mode === 'login');
                registerTab.classList.toggle('is-active', mode === 'register');
                title.textContent = mode === 'login' ? '登录 IELTS Atlas' : '注册 IELTS Atlas';
                submit.textContent = mode === 'login' ? '登录' : '注册';
                passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
                error.hidden = true;
                error.textContent = '';
            }

            loginTab.addEventListener('click', () => setMode('login'));
            registerTab.addEventListener('click', () => setMode('register'));

            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                submit.disabled = true;
                error.hidden = true;
                error.textContent = '';
                try {
                    const username = usernameInput.value.trim();
                    const password = passwordInput.value;
                    const payload = mode === 'login'
                        ? await apiClient.login(username, password)
                        : await apiClient.register(username, password);
                    await handleAuthenticated(payload.user);
                    showMessage(mode === 'login' ? '登录成功' : '注册成功', 'success');
                } catch (requestError) {
                    error.textContent = requestError?.payload?.details?.join('；') || requestError.message || '认证失败';
                    error.hidden = false;
                } finally {
                    submit.disabled = false;
                }
            });

            logout.addEventListener('click', async () => {
                logout.disabled = true;
                try {
                    await apiClient.logout();
                    updateAccount(null);
                    show();
                } catch (error) {
                    showMessage(error.message || '退出失败', 'error');
                } finally {
                    logout.disabled = false;
                }
            });
        }

        function show() {
            ensureUi();
            overlay.hidden = false;
            updateAccount(null);
        }

        function hide() {
            ensureUi();
            overlay.hidden = true;
        }

        function updateAccount(user) {
            ensureUi();
            const name = account.querySelector('.remote-auth-account__name');
            const adminLink = account.querySelector('.remote-auth-account__admin');
            if (user && user.username) {
                name.textContent = user.username;
                adminLink.hidden = user.role !== 'admin';
                account.hidden = false;
            } else {
                name.textContent = '';
                adminLink.hidden = true;
                account.hidden = true;
            }
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
            handleAuthenticated
        };
    }

    ExamData.createRemoteAuthController = createRemoteAuthController;
    ExamData.createRemoteImportMarkerStore = createImportMarkerStore;
    ExamData.getRemoteImportMarkerKey = getImportMarkerKey;
})(window);
