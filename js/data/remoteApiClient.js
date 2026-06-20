(function(window) {
    const ExamData = window.ExamData = window.ExamData || {};

    class RemoteApiError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'RemoteApiError';
            this.status = options.status || 0;
            this.payload = options.payload || null;
        }
    }

    class RemoteApiClient {
        constructor(options = {}) {
            this.baseUrl = options.baseUrl || '';
            this.fetchImpl = options.fetchImpl || window.fetch?.bind(window);
            this.csrfToken = null;
            this.user = null;
            this.available = false;
            this.pendingTotp = null;
        }

        isAuthenticated() {
            return Boolean(this.user && this.user.id);
        }

        clearAuthState() {
            this.user = null;
            this.csrfToken = null;
            this.pendingTotp = null;
        }

        async getAuthState() {
            if (!this.fetchImpl) {
                return { available: false, authenticated: false, user: null };
            }
            try {
                const response = await this._fetch('/api/auth/me', { method: 'GET' });
                this.available = true;
                if (response.status === 401) {
                    this.clearAuthState();
                    return { available: true, authenticated: false, user: null };
                }
                const payload = await this._parseJson(response);
                if (!response.ok) {
                    throw new RemoteApiError(payload?.error || 'Authentication check failed', {
                        status: response.status,
                        payload
                    });
                }
                if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'user')) {
                    this.available = false;
                    this.clearAuthState();
                    return { available: false, authenticated: false, user: null };
                }
                this.user = payload.user || null;
                if (payload.csrfToken) {
                    this.csrfToken = payload.csrfToken;
                }
                return { available: true, authenticated: this.isAuthenticated(), user: this.user };
            } catch (error) {
                if (error instanceof RemoteApiError) {
                    throw error;
                }
                this.available = false;
                this.clearAuthState();
                return { available: false, authenticated: false, user: null, error };
            }
        }

        async ensureCsrfToken() {
            if (this.csrfToken) {
                return this.csrfToken;
            }
            const payload = await this.request('/api/auth/csrf', { method: 'GET', csrf: false });
            this.csrfToken = payload.csrfToken;
            return this.csrfToken;
        }

        async register(username, password) {
            const payload = await this.request('/api/auth/register', {
                method: 'POST',
                body: { username, password }
            });
            this.user = payload.user || null;
            this.pendingTotp = null;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async login(username, password) {
            const payload = await this.request('/api/auth/login', {
                method: 'POST',
                body: { username, password }
            });
            if (payload.requiresTotp || payload.requiresTotpSetup) {
                this.user = null;
                this.pendingTotp = {
                    requiresTotp: Boolean(payload.requiresTotp),
                    requiresTotpSetup: Boolean(payload.requiresTotpSetup),
                    user: payload.user || null
                };
            } else {
                this.user = payload.user || null;
                this.pendingTotp = null;
            }
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async getTotpStatus() {
            const payload = await this.request('/api/auth/totp/status', { method: 'GET', csrf: false });
            return payload.status || { enabled: false, recoveryCodesRemaining: 0 };
        }

        async startTotpSetup() {
            return this.request('/api/auth/totp/setup', { method: 'POST' });
        }

        async verifyTotpSetup(token) {
            const payload = await this.request('/api/auth/totp/verify-setup', {
                method: 'POST',
                body: { token }
            });
            this.user = payload.user || this.user;
            this.pendingTotp = null;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async completeTotpLogin(token) {
            const payload = await this.request('/api/auth/totp/login', {
                method: 'POST',
                body: { token }
            });
            this.user = payload.user || null;
            this.pendingTotp = null;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async regenerateTotpRecoveryCodes(token) {
            return this.request('/api/auth/totp/recovery-codes', {
                method: 'POST',
                body: { token }
            });
        }

        async disableTotp(password, token) {
            const payload = await this.request('/api/auth/totp/disable', {
                method: 'POST',
                body: { password, token }
            });
            this.user = payload.user || this.user;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload.status || { enabled: false, recoveryCodesRemaining: 0 };
        }

        async updateUsername(username, password) {
            const payload = await this.request('/api/auth/account/username', {
                method: 'PATCH',
                body: { username, password }
            });
            this.user = payload.user || this.user;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async updatePassword(currentPassword, newPassword) {
            const payload = await this.request('/api/auth/account/password', {
                method: 'PATCH',
                body: { currentPassword, newPassword }
            });
            this.user = payload.user || this.user;
            if (payload.csrfToken) {
                this.csrfToken = payload.csrfToken;
            }
            return payload;
        }

        async deleteAccount(password, confirm) {
            const payload = await this.request('/api/auth/account', {
                method: 'DELETE',
                body: { password, confirm }
            });
            this.clearAuthState();
            return payload;
        }

        async logout() {
            let payload;
            try {
                payload = await this.request('/api/auth/logout', {
                    method: 'POST'
                });
            } catch (error) {
                if (!(error instanceof RemoteApiError) || error.status !== 401) {
                    throw error;
                }
                payload = { ok: true, alreadyLoggedOut: true };
            }
            this.clearAuthState();
            return payload;
        }

        async listPracticeRecords() {
            const payload = await this.request('/api/practice-records', { method: 'GET', csrf: false });
            return Array.isArray(payload.records) ? payload.records : [];
        }

        async replacePracticeRecords(records) {
            const payload = await this.request('/api/practice-records', {
                method: 'PUT',
                body: { records: Array.isArray(records) ? records : [] }
            });
            return Array.isArray(payload.records) ? payload.records : [];
        }

        async importPracticeRecords(records) {
            const payload = await this.request('/api/practice-records/import', {
                method: 'POST',
                body: { records: Array.isArray(records) ? records : [] }
            });
            return Array.isArray(payload.records) ? payload.records : [];
        }

        async deletePracticeRecord(id) {
            return this.request(`/api/practice-records/${encodeURIComponent(String(id))}`, {
                method: 'DELETE'
            });
        }

        async clearPracticeRecords() {
            const payload = await this.request('/api/practice-records', {
                method: 'DELETE'
            });
            return Array.isArray(payload.records) ? payload.records : [];
        }

        async request(path, options = {}) {
            if (!this.fetchImpl) {
                throw new RemoteApiError('Fetch API is not available');
            }
            const method = options.method || 'GET';
            const headers = Object.assign({}, options.headers || {});
            if (options.body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }
            if (options.csrf !== false && method !== 'GET') {
                headers['X-CSRF-Token'] = await this.ensureCsrfToken();
            }
            const response = await this._fetch(path, {
                method,
                headers,
                credentials: 'same-origin',
                body: options.body === undefined ? undefined : JSON.stringify(options.body)
            });
            this.available = true;
            const payload = await this._parseJson(response);
            if (response.status === 401) {
                this.clearAuthState();
            }
            if (response.status === 403 && payload?.error === 'CSRF token invalid') {
                this.csrfToken = null;
            }
            if (!response.ok) {
                throw new RemoteApiError(payload?.error || `Request failed with ${response.status}`, {
                    status: response.status,
                    payload
                });
            }
            return payload;
        }

        _fetch(path, options) {
            return this.fetchImpl(`${this.baseUrl}${path}`, options);
        }

        async _parseJson(response) {
            const text = await response.text();
            if (!text) {
                return null;
            }
            try {
                return JSON.parse(text);
            } catch (_) {
                return null;
            }
        }
    }

    ExamData.RemoteApiClient = RemoteApiClient;
    ExamData.RemoteApiError = RemoteApiError;
})(window);
